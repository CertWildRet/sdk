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
import { Bucket } from "./constants";
import { CwrVaultClient } from "./client";
import {
  deriveBucketAddresses,
  findBucket,
  findFeeBucket,
  findFeeSchedule,
  findMiningAuthority,
  findPendingDeposit,
  findPendingState,
  findPendingTreasury,
  findPosition,
  findReferralConfig,
  findReferralTreasury,
  findReferrerState,
  oreMinerPda,
} from "./pdas";

export class UserApi {
  constructor(private readonly c: CwrVaultClient) {}

  /**
   * Deposit lamports into a bucket and receive shares.
   * Creates the user's share-token ATA idempotently if missing. The V5
   * entry-fee is skimmed by the program from `amount` into the global fee
   * bucket BEFORE shares are minted (so shares reflect the net deposited).
   *
   * V6 — also threads the per-user Position PDA (created lazily on first
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
   * Pull a parked (not-yet-finalized) deposit back out. Owner-signed, allowed
   * in ANY phase and even when paused — escrow is returned in full and the
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
