import BN from "bn.js";
import * as anchor from "@coral-xyz/anchor";
import {
  Ed25519Program,
  Signer,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Bucket,
  STORE_MINT,
  ZINC_ATA_PROGRAM,
  ZINC_MINT,
  ZINC_TOKEN_PROGRAM,
} from "./constants";
import { CwrVaultClient } from "./client";
import {
  deriveBucketAddresses,
  findBucket,
  findFeeBucket,
  findFeeSchedule,
  findMiningAuthority,
  findPendingDeposit,
  findPendingWithdrawOre,
  findPendingWithdrawZinc,
  findPendingWithdrawState,
  findShareEscrow,
  findPendingState,
  findPendingTreasury,
  findPosition,
  findReferralConfig,
  findReferralTreasury,
  findReferrerState,
  oreMinerPda,
  zincCustodyAta,
  zincPoolPda,
  zincPositionPda,
  zincUserAta,
} from "./pdas";

export class UserApi {
  constructor(private readonly c: CwrVaultClient) {}

  /**
   * Deposit lamports into a bucket and receive shares.
   * Creates the user's share-token ATA idempotently if missing. The V5
   * entry-fee is skimmed by the program from `amount` into the global fee
   * bucket BEFORE shares are minted (so shares reflect the net deposited).
   *
   * V6 - also threads the per-user Position PDA (created lazily on first
   * deposit) and the ORE Miner read account, which the handler uses for the
   * derived NAV. The miner is read-only; it need not exist before
   * `init_mining_pda` (validated in-handler only when mining is initialized).
   *
   * Wires Deposit: config, bucket, treasury, share_mint, user_share_ata, user,
   * position, ore_miner, fee_bucket, fee_schedule, token_program,
   * system_program.
   */
  async deposit(args: {
    bucket: Bucket;
    amount: BN;
    user: Signer;
  }): Promise<string> {
    const addrs = deriveBucketAddresses(this.c.programId, args.bucket);
    const [feeSchedule] = findFeeSchedule(this.c.programId);
    const [feeBucket] = findFeeBucket(this.c.programId);
    const [position] = findPosition(this.c.programId, args.bucket, args.user.publicKey);
    const [miningAuthority] = findMiningAuthority(this.c.programId, args.bucket);
    const [oreMiner] = oreMinerPda(miningAuthority);
    const userAta = getAssociatedTokenAddressSync(addrs.shareMint, args.user.publicKey);

    const ataInfo = await this.c.connection.getAccountInfo(userAta);
    const pre: TransactionInstruction[] = [];
    if (!ataInfo) {
      pre.push(
        createAssociatedTokenAccountIdempotentInstruction(
          args.user.publicKey,
          userAta,
          args.user.publicKey,
          addrs.shareMint,
        ),
      );
    }

    return this.c.program.methods
      .deposit(args.amount)
      .accountsPartial({
        config: this.c.configPda,
        bucket: addrs.bucket,
        treasury: addrs.treasury,
        shareMint: addrs.shareMint,
        userShareAta: userAta,
        user: args.user.publicKey,
        position,
        oreMiner,
        feeBucket,
        feeSchedule,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions(pre)
      .signers([args.user])
      .rpc();
  }

  /**
   * Burn shares and withdraw the underlying SOL payout, minus the V5 flat exit
   * fee (→ global fee bucket). Also pays out the pro-rata stORE held in the
   * bucket's store_treasury into the user's stORE ATA. Only callable while
   * `claims_open` on the bucket.
   *
   * Wires Withdraw: bucket, treasury, share_mint, user_share_ata, user,
   * position, fee_bucket, fee_schedule, config, store_treasury, user_store_ata,
   * store_mint, token_program, system_program.
   */
  async withdraw(args: {
    bucket: Bucket;
    shares: BN;
    user: Signer;
  }): Promise<string> {
    const addrs = deriveBucketAddresses(this.c.programId, args.bucket);
    const userShareAta = getAssociatedTokenAddressSync(addrs.shareMint, args.user.publicKey);
    const [feeSchedule] = findFeeSchedule(this.c.programId);
    const [feeBucket] = findFeeBucket(this.c.programId);
    const [position] = findPosition(this.c.programId, args.bucket, args.user.publicKey);
    const cfg = await this.c.program.account.config.fetch(this.c.configPda);
    const userStoreAta = getAssociatedTokenAddressSync(cfg.storeMint, args.user.publicKey);

    // Idempotently ensure the user's stORE ATA exists so withdraw can
    // transfer the pro-rata stORE payout into it without failing.
    const pre: TransactionInstruction[] = [];
    const ataInfo = await this.c.connection.getAccountInfo(userStoreAta);
    if (!ataInfo) {
      pre.push(
        createAssociatedTokenAccountIdempotentInstruction(
          args.user.publicKey,
          userStoreAta,
          args.user.publicKey,
          cfg.storeMint,
        ),
      );
    }

    return this.c.program.methods
      .withdraw(args.shares)
      .accountsPartial({
        bucket: addrs.bucket,
        treasury: addrs.treasury,
        shareMint: addrs.shareMint,
        userShareAta,
        user: args.user.publicKey,
        position,
        feeBucket,
        feeSchedule,
        config: this.c.configPda,
        storeTreasury: addrs.storeTreasury,
        userStoreAta,
        storeMint: cfg.storeMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions(pre)
      .signers([args.user])
      .rpc();
  }

  // ════════════════════════════════════════════════════════════════════
  // dZINC pool (bucket 1) deposit / withdraw. Mirror deposit / withdraw but
  // route through the ZincPool + per-user ZincPosition; withdraw pays the
  // pro-rata SMELTED ZINC in-kind (no stORE leg, no ore_miner).
  // ════════════════════════════════════════════════════════════════════

  /**
   * Deposit lamports into a dZINC bucket and receive (dZINC) shares. Creates
   * the user's share-token ATA idempotently if missing. The V5 entry fee is
   * skimmed from `amount` into the global fee bucket BEFORE shares are minted.
   * Threads the per-user ZincPosition PDA (created lazily on first deposit),
   * which is set to the pool's CURRENT acc_zinc_per_share watermark (no
   * backdating of pre-deposit smelted ZINC). No ore_miner is involved.
   *
   * Wires DepositZinc: config, bucket, zinc_pool, treasury, share_mint,
   * user_share_ata, user, zinc_position, fee_bucket, fee_schedule,
   * token_program, system_program.
   */
  async depositZinc(args: {
    bucket: Bucket;
    amount: BN;
    user: Signer;
  }): Promise<string> {
    const addrs = deriveBucketAddresses(this.c.programId, args.bucket);
    const [zincPool] = zincPoolPda(this.c.programId, args.bucket);
    const [zincPosition] = zincPositionPda(
      this.c.programId,
      args.bucket,
      args.user.publicKey,
    );
    const [feeSchedule] = findFeeSchedule(this.c.programId);
    const [feeBucket] = findFeeBucket(this.c.programId);
    const userShareAta = getAssociatedTokenAddressSync(
      addrs.shareMint,
      args.user.publicKey,
    );

    const pre: TransactionInstruction[] = [];
    const ataInfo = await this.c.connection.getAccountInfo(userShareAta);
    if (!ataInfo) {
      pre.push(
        createAssociatedTokenAccountIdempotentInstruction(
          args.user.publicKey,
          userShareAta,
          args.user.publicKey,
          addrs.shareMint,
        ),
      );
    }

    return this.c.program.methods
      .depositZinc(args.amount)
      .accountsPartial({
        config: this.c.configPda,
        bucket: addrs.bucket,
        zincPool,
        treasury: addrs.treasury,
        shareMint: addrs.shareMint,
        userShareAta,
        user: args.user.publicKey,
        zincPosition,
        feeBucket,
        feeSchedule,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions(pre)
      .signers([args.user])
      .rpc();
  }

  /**
   * Burn dZINC shares and withdraw the underlying SOL payout (minus the V5 flat
   * exit fee -> global fee bucket) PLUS the pro-rata SMELTED ZINC paid IN-KIND
   * from the custody ATA into the user's ZINC ATA. Mirrors `withdraw` but with
   * the ZINC leg instead of stORE. Only callable while `claims_open`. The
   * user's ZINC ATA (classic SPL token program) is created idempotently so the
   * in-kind transfer cannot fail.
   *
   * Wires WithdrawZinc: bucket, zinc_pool, treasury, share_mint,
   * user_share_ata, user, zinc_position, fee_bucket, fee_schedule, config,
   * mining_authority, zinc_custody_ata, user_zinc_ata, zinc_mint,
   * token_program, system_program.
   */
  async withdrawZinc(args: {
    bucket: Bucket;
    shares: BN;
    user: Signer;
  }): Promise<string> {
    const addrs = deriveBucketAddresses(this.c.programId, args.bucket);
    const [zincPool] = zincPoolPda(this.c.programId, args.bucket);
    const [zincPosition] = zincPositionPda(
      this.c.programId,
      args.bucket,
      args.user.publicKey,
    );
    const [feeSchedule] = findFeeSchedule(this.c.programId);
    const [feeBucket] = findFeeBucket(this.c.programId);
    const [miningAuthority] = findMiningAuthority(this.c.programId, args.bucket);
    const custodyAta = zincCustodyAta(miningAuthority);
    const userShareAta = getAssociatedTokenAddressSync(
      addrs.shareMint,
      args.user.publicKey,
    );
    const userZincAta = zincUserAta(args.user.publicKey);

    // Idempotently ensure the user's ZINC ATA (classic SPL token program)
    // exists so the in-kind smelted-ZINC payout can land.
    const pre: TransactionInstruction[] = [];
    const zincAtaInfo = await this.c.connection.getAccountInfo(userZincAta);
    if (!zincAtaInfo) {
      pre.push(
        createAssociatedTokenAccountIdempotentInstruction(
          args.user.publicKey,
          userZincAta,
          args.user.publicKey,
          ZINC_MINT,
          ZINC_TOKEN_PROGRAM,
          ZINC_ATA_PROGRAM,
        ),
      );
    }

    return this.c.program.methods
      .withdrawZinc(args.shares)
      .accountsPartial({
        bucket: addrs.bucket,
        zincPool,
        treasury: addrs.treasury,
        shareMint: addrs.shareMint,
        userShareAta,
        user: args.user.publicKey,
        zincPosition,
        feeBucket,
        feeSchedule,
        config: this.c.configPda,
        miningAuthority,
        zincCustodyAta: custodyAta,
        userZincAta,
        zincMint: ZINC_MINT,
        tokenProgram: ZINC_TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions(pre)
      .signers([args.user])
      .rpc();
  }

  /**
   * Park SOL into the buffer during the BETTING (cranking) phase, when normal
   * `deposit` is closed. NO shares are minted and NAV is untouched: the SOL
   * sits in the per-bucket `pending_treasury` escrow until `finalizePending`
   * converts it at the next settled OPEN window. Repeat parks accumulate.
   * Reversible any time via `cancelPending`.
   *
   * Wires ParkDeposit: config, bucket, pending_state, pending_treasury,
   * ore_miner, user, pending_deposit, system_program.
   */
  async parkDeposit(args: {
    bucket: Bucket;
    amount: BN;
    user: Signer;
  }): Promise<string> {
    const [bucketPda] = findBucket(this.c.programId, args.bucket);
    const [pendingState] = findPendingState(this.c.programId, args.bucket);
    const [pendingTreasury] = findPendingTreasury(this.c.programId, args.bucket);
    const [pendingDeposit] = findPendingDeposit(this.c.programId, args.bucket, args.user.publicKey);
    const [miningAuthority] = findMiningAuthority(this.c.programId, args.bucket);
    const [oreMiner] = oreMinerPda(miningAuthority);

    return this.c.program.methods
      .parkDeposit(args.amount)
      .accountsPartial({
        config: this.c.configPda,
        bucket: bucketPda,
        pendingState,
        pendingTreasury,
        oreMiner,
        user: args.user.publicKey,
        pendingDeposit,
        systemProgram: SystemProgram.programId,
      })
      .signers([args.user])
      .rpc();
  }

  /**
   * QUEUE AN EXIT (v1.5.0, ORE bucket). Usable in ANY phase - the whole point
   * is that a user never has to race the short OPEN window: share tokens move
   * into the program escrow now (they stay minted + keep earning), and the
   * keeper executes the exit permissionlessly in the next settled OPEN window
   * at that window's frozen NPS - economically identical to a live withdraw
   * there (exit fee = min(queue-time cap, live)). Cancellable any time via
   * cancelQueuedWithdraw. Repeat queues accumulate into one ticket.
   *
   * Wires QueueWithdraw: config, bucket, pending_withdraw_state, share_escrow,
   * share_mint, user_share_ata, user, position, pending_withdraw,
   * user_store_ata (created here, payer = user), store_mint + programs.
   */
  async queueWithdraw(args: {
    bucket: Bucket;
    shares: BN;
    user: Signer;
  }): Promise<string> {
    const addrs = deriveBucketAddresses(this.c.programId, args.bucket);
    const [pendingWithdrawState] = findPendingWithdrawState(this.c.programId, args.bucket);
    const [shareEscrow] = findShareEscrow(this.c.programId, args.bucket);
    const [pendingWithdraw] = findPendingWithdrawOre(this.c.programId, args.bucket, args.user.publicKey);
    const [position] = findPosition(this.c.programId, args.bucket, args.user.publicKey);
    const userShareAta = getAssociatedTokenAddressSync(addrs.shareMint, args.user.publicKey);
    const userStoreAta = getAssociatedTokenAddressSync(STORE_MINT, args.user.publicKey);

    return this.c.program.methods
      .queueWithdraw(args.shares)
      .accountsPartial({
        config: this.c.configPda,
        bucket: addrs.bucket,
        pendingWithdrawState,
        shareEscrow,
        shareMint: addrs.shareMint,
        userShareAta,
        user: args.user.publicKey,
        position,
        pendingWithdraw,
        userStoreAta,
        storeMint: STORE_MINT,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([args.user])
      .rpc();
  }

  /**
   * QUEUE AN EXIT (v1.5.0, dZINC bucket). Twin of queueWithdraw; also creates
   * the user's ZINC payout ATA at queue time (payer = user) so the
   * permissionless finalize never creates user accounts.
   */
  async queueWithdrawZinc(args: {
    bucket: Bucket;
    shares: BN;
    user: Signer;
  }): Promise<string> {
    const addrs = deriveBucketAddresses(this.c.programId, args.bucket);
    const [zincPool] = zincPoolPda(this.c.programId, args.bucket);
    const [zincPosition] = zincPositionPda(this.c.programId, args.bucket, args.user.publicKey);
    const [pendingWithdrawState] = findPendingWithdrawState(this.c.programId, args.bucket);
    const [shareEscrow] = findShareEscrow(this.c.programId, args.bucket);
    const [pendingWithdraw] = findPendingWithdrawZinc(this.c.programId, args.bucket, args.user.publicKey);
    const userShareAta = getAssociatedTokenAddressSync(addrs.shareMint, args.user.publicKey);
    const userZincAta = zincUserAta(args.user.publicKey);

    return this.c.program.methods
      .queueWithdrawZinc(args.shares)
      .accountsPartial({
        config: this.c.configPda,
        bucket: addrs.bucket,
        zincPool,
        pendingWithdrawState,
        shareEscrow,
        shareMint: addrs.shareMint,
        userShareAta,
        user: args.user.publicKey,
        zincPosition,
        pendingWithdraw,
        userZincAta,
        zincMint: ZINC_MINT,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([args.user])
      .rpc();
  }

  /**
   * Cancel a queued exit (ORE bucket): escrowed shares return to the owner's
   * share ATA (created idempotently, payer = owner). ANY phase, EVEN PAUSED -
   * the unconditional no-stuck-shares escape.
   */
  async cancelQueuedWithdraw(args: {
    bucket: Bucket;
    owner: Signer;
  }): Promise<string> {
    const addrs = deriveBucketAddresses(this.c.programId, args.bucket);
    const [pendingWithdrawState] = findPendingWithdrawState(this.c.programId, args.bucket);
    const [shareEscrow] = findShareEscrow(this.c.programId, args.bucket);
    const [pendingWithdraw] = findPendingWithdrawOre(this.c.programId, args.bucket, args.owner.publicKey);
    const ownerShareAta = getAssociatedTokenAddressSync(addrs.shareMint, args.owner.publicKey);

    return this.c.program.methods
      .cancelQueuedWithdraw()
      .accountsPartial({
        bucket: addrs.bucket,
        pendingWithdrawState,
        shareEscrow,
        shareMint: addrs.shareMint,
        owner: args.owner.publicKey,
        ownerShareAta,
        pendingWithdraw,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([args.owner])
      .rpc();
  }

  /** dZINC twin of cancelQueuedWithdraw (zinc ticket seeds). */
  async cancelQueuedWithdrawZinc(args: {
    bucket: Bucket;
    owner: Signer;
  }): Promise<string> {
    const addrs = deriveBucketAddresses(this.c.programId, args.bucket);
    const [pendingWithdrawState] = findPendingWithdrawState(this.c.programId, args.bucket);
    const [shareEscrow] = findShareEscrow(this.c.programId, args.bucket);
    const [pendingWithdraw] = findPendingWithdrawZinc(this.c.programId, args.bucket, args.owner.publicKey);
    const ownerShareAta = getAssociatedTokenAddressSync(addrs.shareMint, args.owner.publicKey);

    return this.c.program.methods
      .cancelQueuedWithdrawZinc()
      .accountsPartial({
        bucket: addrs.bucket,
        pendingWithdrawState,
        shareEscrow,
        shareMint: addrs.shareMint,
        owner: args.owner.publicKey,
        ownerShareAta,
        pendingWithdraw,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([args.owner])
      .rpc();
  }

  /**
   * Pull a parked (not-yet-finalized) deposit back out. Owner-signed, allowed
   * in ANY phase and even when paused - escrow is returned in full and the
   * ticket is closed (rent -> owner). The unconditional no-stuck-capital escape.
   *
   * Wires CancelPending: bucket, pending_state, pending_treasury, owner,
   * pending_deposit, system_program.
   */
  async cancelPending(args: {
    bucket: Bucket;
    owner: Signer;
  }): Promise<string> {
    const [bucketPda] = findBucket(this.c.programId, args.bucket);
    const [pendingState] = findPendingState(this.c.programId, args.bucket);
    const [pendingTreasury] = findPendingTreasury(this.c.programId, args.bucket);
    const [pendingDeposit] = findPendingDeposit(this.c.programId, args.bucket, args.owner.publicKey);

    return this.c.program.methods
      .cancelPending()
      .accountsPartial({
        bucket: bucketPda,
        pendingState,
        pendingTreasury,
        owner: args.owner.publicKey,
        pendingDeposit,
        systemProgram: SystemProgram.programId,
      })
      .signers([args.owner])
      .rpc();
  }

  /**
   * Claim accrued referral rewards. The referrer signs and receives the payout.
   * Authorized by a settlement-authority attestation of the referrer's
   * CUMULATIVE owed (the off-chain claim API serves the message + signature);
   * pays cumulative - claimed from the bounded referral_treasury. Idempotent:
   * a stale/replayed attestation pays 0.
   */
  async claimReferral(args: {
    referrer: Signer;
    attestationMessage: Uint8Array;
    attestationSignature: Uint8Array;
  }): Promise<string> {
    const [referralConfig] = findReferralConfig(this.c.programId);
    const [referralTreasury] = findReferralTreasury(this.c.programId);
    const [referrerState] = findReferrerState(this.c.programId, args.referrer.publicKey);
    const rc: any = await this.c.program.account.referralConfig.fetch(referralConfig);
    const edIx = Ed25519Program.createInstructionWithPublicKey({
      publicKey: rc.settlementAuthority.toBytes(),
      message: args.attestationMessage,
      signature: args.attestationSignature,
    });
    const claimIx = await this.c.program.methods
      .claimReferral()
      .accountsPartial({
        referrer: args.referrer.publicKey,
        referrerState,
        referralConfig,
        referralTreasury,
        systemProgram: SystemProgram.programId,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
    const tx = new Transaction().add(edIx, claimIx);
    return (this.c.program.provider as anchor.AnchorProvider).sendAndConfirm(
      tx,
      [args.referrer],
      { commitment: "confirmed" },
    );
  }
}
