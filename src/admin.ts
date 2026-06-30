import * as anchor from "@coral-xyz/anchor";
import {
  AccountMeta,
  PublicKey,
  Signer,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  Bucket,
  MAX_FEE_RECIPIENTS,
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
  findPendingState,
  findPendingTreasury,
  findReferralConfig,
  findReferralTreasury,
  findTreasury,
  zincCustodyAta,
  zincPoolPda,
} from "./pdas";
import {
  FeeCosigner,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  sendCosignedAdminIx,
} from "./cosign";
import type { BucketParamsInput, FeeRecipientInput } from "./types";

export class AdminApi {
  constructor(private readonly c: CwrVaultClient) {}

  /** Build the cosign + send [ed25519, adminIx] signed by admin (+ any extra). */
  private async cosign(
    adminIx: TransactionInstruction,
    feeCosigner: FeeCosigner,
    admin: Signer,
    extraSigners?: Signer[],
  ): Promise<string> {
    return sendCosignedAdminIx({
      provider: this.c.program.provider as anchor.AnchorProvider,
      programId: this.c.programId,
      fetchNonce: async () =>
        BigInt(
          (await this.c.program.account.config.fetch(this.c.configPda)).adminAuthNonce.toString(),
        ),
      adminIx,
      feeCosigner,
      admin,
      extraSigners,
    });
  }

  /**
   * One-time global setup for the referral program (cosigned). Creates
   * referral_config (settlement authority + treasury bump) and rent-seeds the
   * bounded referral_treasury.
   */
  async initReferral(args: {
    settlementAuthority: PublicKey;
    admin: Signer;
    feeCosigner: FeeCosigner;
  }): Promise<string> {
    const [referralConfig] = findReferralConfig(this.c.programId);
    const [referralTreasury] = findReferralTreasury(this.c.programId);
    const ix = await this.c.program.methods
      .initReferral(args.settlementAuthority)
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        referralConfig,
        referralTreasury,
        systemProgram: SystemProgram.programId,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
    return this.cosign(ix, args.feeCosigner, args.admin);
  }

  /** Rotate the off-chain settlement authority (cosigned). Moves no funds. */
  async setSettlementAuthority(args: {
    newAuthority: PublicKey;
    admin: Signer;
    feeCosigner: FeeCosigner;
  }): Promise<string> {
    const [referralConfig] = findReferralConfig(this.c.programId);
    const ix = await this.c.program.methods
      .setSettlementAuthority(args.newAuthority)
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        referralConfig,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
    return this.cosign(ix, args.feeCosigner, args.admin);
  }

  async initialize(args: {
    admin: Signer;
    feeRecipient: PublicKey;
    /** V5 - stORE mint pinned at init. Must be a real SPL mint
     *  (Pubkey::default() is rejected - see audit C1). */
    storeMint: PublicKey;
    /**
     * External-audit hardening (2026-06): the program data account that
     * proves `admin` is the upgrade authority for cwr_vault. Required to
     * prevent `initialize` frontrun. Derived as:
     *   PublicKey.findProgramAddressSync(
     *     [programId.toBuffer()],
     *     new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
     *   )[0]
     * Helpers: deriveProgramData(programId).
     */
    programData: PublicKey;
  }): Promise<string> {
    return this.c.program.methods
      .initialize(args.feeRecipient, args.storeMint)
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        programData: args.programData,
        systemProgram: SystemProgram.programId,
      })
      .signers([args.admin])
      .rpc();
  }

  /**
   * V5 - `operatorWallet` is now PER-BUCKET (pinned at init time, mutable
   * via `setBucketOperator`). Each bucket having its own operator gives
   * it its own ORE Miner PDA, so `claim_ore` cadence + refining-yield
   * accumulation are isolated across Simple / Refined / Ultra.
   */
  async initBucket(args: {
    bucketId: number;
    params: BucketParamsInput;
    operatorWallet: PublicKey;
    // dORE: on-chain SPL token metadata for this pool's share mint
    // (bucket 0 -> "dORE", bucket 1 -> "dZINC"). name <=32, symbol <=10, uri <=200.
    name: string;
    symbol: string;
    uri: string;
    admin: Signer;
    feeCosigner: FeeCosigner;
  }): Promise<string> {
    const addrs = deriveBucketAddresses(this.c.programId, args.bucketId);
    // Read cfg to find the storeMint pinned at initialize-time.
    const cfg = await this.c.program.account.config.fetch(this.c.configPda);
    // Metaplex Token-Metadata program + the metadata PDA for the share mint.
    const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
      "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
    );
    const [metadata] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        addrs.shareMint.toBuffer(),
      ],
      TOKEN_METADATA_PROGRAM_ID,
    );
    const ix = await this.c.program.methods
      .initBucket(
        args.bucketId,
        args.params as any,
        args.operatorWallet,
        args.name,
        args.symbol,
        args.uri,
      )
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        bucket: addrs.bucket,
        treasury: addrs.treasury,
        shareMint: addrs.shareMint,
        storeTreasury: addrs.storeTreasury,
        storeMint: cfg.storeMint,
        metadata,
        tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
    return this.cosign(ix, args.feeCosigner, args.admin);
  }

  /**
   * V6 - one-time init of a bucket's per-bucket mining authority PDA. Derives
   * `mining_authority` (and, on-chain, the ORE Miner key it stores on the
   * bucket). Admin-signed.
   *
   * Wires InitMiningPda: config, admin, bucket, mining_authority,
   * system_program.
   */
  async initMiningPda(args: {
    bucket: Bucket;
    admin: Signer;
    feeCosigner: FeeCosigner;
  }): Promise<string> {
    const [bucketPda] = findBucket(this.c.programId, args.bucket);
    const [miningAuthority] = findMiningAuthority(this.c.programId, args.bucket);
    const ix = await this.c.program.methods
      .initMiningPda()
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        bucket: bucketPda,
        miningAuthority,
        systemProgram: SystemProgram.programId,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
    return this.cosign(ix, args.feeCosigner, args.admin);
  }

  /**
   * One-time (per bucket) bootstrap of the parked-capital buffer. Cosigned
   * admin op. Creates the `pending_state` counter and rent-seeds the
   * `pending_treasury` escrow from admin. MUST be run after `initBucket`
   * before parking is available for that bucket.
   *
   * Wires InitPending: config, admin, bucket, pending_state, pending_treasury,
   * system_program, instructions.
   */
  async initPending(args: {
    bucket: Bucket;
    admin: Signer;
    feeCosigner: FeeCosigner;
  }): Promise<string> {
    const [bucketPda] = findBucket(this.c.programId, args.bucket);
    const [pendingState] = findPendingState(this.c.programId, args.bucket);
    const [pendingTreasury] = findPendingTreasury(this.c.programId, args.bucket);
    const ix = await this.c.program.methods
      .initPending(args.bucket)
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        bucket: bucketPda,
        pendingState,
        pendingTreasury,
        systemProgram: SystemProgram.programId,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
    return this.cosign(ix, args.feeCosigner, args.admin);
  }

  // ─── Two-step admin handover (external-audit hardening, 2026-06) ────────
  //
  // The single-call `setAdmin` was removed. Rotation now requires three
  // independent actions within 24h of the proposal:
  //   1) proposeAdmin(newAdmin)           current admin signs
  //   2) confirmAdminTransfer()           hardcoded ADMIN_TRANSFER_CONFIRMER
  //                                       signs + deposits 0.1 SOL into fee_bucket
  //   3) acceptAdmin()                    new admin signs to commit
  // Any pending proposal can be revoked via cancelAdminTransfer().
  //
  // The ADMIN_TRANSFER_CONFIRMER private key is intentionally off-the-books;
  // calling step (2) requires its signer to be loaded by the caller.

  async proposeAdmin(args: { newAdmin: PublicKey; admin: Signer }): Promise<string> {
    return this.c.program.methods
      .proposeAdmin(args.newAdmin)
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .signers([args.admin])
      .rpc();
  }

  async confirmAdminTransfer(args: { confirmer: Signer }): Promise<string> {
    const { findFeeBucket, findFeeSchedule } = await import("./pdas");
    const [feeBucket] = findFeeBucket(this.c.programId);
    const [feeSchedule] = findFeeSchedule(this.c.programId);
    return this.c.program.methods
      .confirmAdminTransfer()
      .accountsPartial({
        config: this.c.configPda,
        confirmer: args.confirmer.publicKey,
        feeBucket,
        feeSchedule,
        systemProgram: SystemProgram.programId,
      })
      .signers([args.confirmer])
      .rpc();
  }

  async acceptAdmin(args: { newAdmin: Signer }): Promise<string> {
    return this.c.program.methods
      .acceptAdmin()
      .accountsPartial({
        config: this.c.configPda,
        newAdmin: args.newAdmin.publicKey,
      })
      .signers([args.newAdmin])
      .rpc();
  }

  async cancelAdminTransfer(args: { admin: Signer }): Promise<string> {
    return this.c.program.methods
      .cancelAdminTransfer()
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .signers([args.admin])
      .rpc();
  }

  /**
   * V5 - rotate a single bucket's operator wallet. Blocked while
   * `claims_open == true` (NAV frozen). Per-bucket: rotating Simple's
   * operator does NOT touch Refined or Ultra.
   */
  async setBucketOperator(args: {
    bucket: Bucket;
    newOperator: PublicKey;
    admin: Signer;
    feeCosigner: FeeCosigner;
  }): Promise<string> {
    const [bucketPda] = findBucket(this.c.programId, args.bucket);
    const ix = await this.c.program.methods
      .setBucketOperator(args.newOperator)
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        bucket: bucketPda,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
    return this.cosign(ix, args.feeCosigner, args.admin);
  }

  /**
   * Admin-tunable per-bucket window timing - change OPEN/BETTING window
   * lengths + the crank guard band without a program upgrade. Validated
   * on-chain (durations in [30s, 7d]; guard band must leave >= ~1 ORE round
   * crankable). All values in their native units: seconds / seconds / slots.
   */
  async setBucketWindowTiming(args: {
    bucket: Bucket;
    openSecs: anchor.BN | number;
    bettingSecs: anchor.BN | number;
    guardBandSlots: anchor.BN | number;
    admin: Signer;
    feeCosigner: FeeCosigner;
  }): Promise<string> {
    const [bucketPda] = findBucket(this.c.programId, args.bucket);
    const ix = await this.c.program.methods
      .setBucketWindowTiming(
        new anchor.BN(args.openSecs.toString()),
        new anchor.BN(args.bettingSecs.toString()),
        new anchor.BN(args.guardBandSlots.toString()),
      )
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        bucket: bucketPda,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
    return this.cosign(ix, args.feeCosigner, args.admin);
  }

  async setFeeRecipient(args: {
    newFeeRecipient: PublicKey;
    admin: Signer;
    feeCosigner: FeeCosigner;
  }): Promise<string> {
    const ix = await this.c.program.methods
      .setFeeRecipient(args.newFeeRecipient)
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
    return this.cosign(ix, args.feeCosigner, args.admin);
  }

  async setBucketParams(args: {
    bucket: Bucket;
    params: BucketParamsInput;
    admin: Signer;
    feeCosigner: FeeCosigner;
  }): Promise<string> {
    const [bucketPda] = findBucket(this.c.programId, args.bucket);
    const ix = await this.c.program.methods
      .setBucketParams(args.params as any)
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        bucket: bucketPda,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
    return this.cosign(ix, args.feeCosigner, args.admin);
  }

  async setPause(args: {
    bucket: Bucket;
    paused: boolean;
    admin: Signer;
    feeCosigner: FeeCosigner;
  }): Promise<string> {
    const [bucketPda] = findBucket(this.c.programId, args.bucket);
    const ix = await this.c.program.methods
      .setPause(args.paused)
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        bucket: bucketPda,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
    return this.cosign(ix, args.feeCosigner, args.admin);
  }

  async setDepositsOpen(args: {
    bucket: Bucket;
    open: boolean;
    admin: Signer;
    feeCosigner: FeeCosigner;
  }): Promise<string> {
    const [bucketPda] = findBucket(this.c.programId, args.bucket);
    const ix = await this.c.program.methods
      .setDepositsOpen(args.open)
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        bucket: bucketPda,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
    return this.cosign(ix, args.feeCosigner, args.admin);
  }

  async setClaimsOpen(args: {
    bucket: Bucket;
    open: boolean;
    admin: Signer;
    feeCosigner: FeeCosigner;
  }): Promise<string> {
    const [bucketPda] = findBucket(this.c.programId, args.bucket);
    const ix = await this.c.program.methods
      .setClaimsOpen(args.open)
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        bucket: bucketPda,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
    return this.cosign(ix, args.feeCosigner, args.admin);
  }

  // ─── V5 flat fee model ──────────────────────────────────────────────

  /**
   * Narrow admin setter for the V5 entry/exit fees. Doesn't touch other
   * bucket params. Bps capped at MAX_ENTRY_FEE_BPS / MAX_EXIT_FEE_BPS.
   */
  async setFees(args: {
    bucket: Bucket;
    entryFeeBps: number;
    entryFeeEnabled: boolean;
    exitFeeBps: number;
    exitFeeEnabled: boolean;
    admin: Signer;
    feeCosigner: FeeCosigner;
  }): Promise<string> {
    const [bucketPda] = findBucket(this.c.programId, args.bucket);
    const ix = await this.c.program.methods
      .setFees(
        args.entryFeeBps,
        args.entryFeeEnabled,
        args.exitFeeBps,
        args.exitFeeEnabled,
      )
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        bucket: bucketPda,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
    return this.cosign(ix, args.feeCosigner, args.admin);
  }

  /**
   * V5 - narrow admin setter for the per-pull VOLUME fee. This is the
   * ONLY active monetisation in the V5 baseline product (entry / exit /
   * perf all default to 0 bps). Bps capped at MAX_PULL_FEE_BPS (500).
   * Bumps blocked while `claims_open == true` (raising is gated; lowering OK).
   */
  async setPullFee(args: {
    bucket: Bucket;
    pullFeeBps: number;
    pullFeeEnabled: boolean;
    admin: Signer;
    feeCosigner: FeeCosigner;
  }): Promise<string> {
    const [bucketPda] = findBucket(this.c.programId, args.bucket);
    const ix = await this.c.program.methods
      .setPullFee(args.pullFeeBps, args.pullFeeEnabled)
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        bucket: bucketPda,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
    return this.cosign(ix, args.feeCosigner, args.admin);
  }

  /**
   * V5 - apply the same `set_pull_fee` (bps + enabled flag) to every passed
   * bucket. Each gated ix now needs its own fresh nonce + cosign, so they can
   * no longer share one atomic transaction; this loops SEQUENTIALLY, awaiting
   * a separately-cosigned `setPullFee` per bucket. Returns the LAST signature.
   */
  async setPullFeeAll(args: {
    buckets: Bucket[];
    pullFeeBps: number;
    pullFeeEnabled: boolean;
    admin: Signer;
    feeCosigner: FeeCosigner;
  }): Promise<string> {
    let lastSig = "";
    for (const bucket of args.buckets) {
      lastSig = await this.setPullFee({
        bucket,
        pullFeeBps: args.pullFeeBps,
        pullFeeEnabled: args.pullFeeEnabled,
        admin: args.admin,
        feeCosigner: args.feeCosigner,
      });
    }
    return lastSig;
  }

  /**
   * Narrow admin setter for the performance fee bps. Default for V5 is 0.
   * Bumps blocked while `claims_open == true` (raising is gated; lowering OK).
   * Bps capped at MAX_PERFORMANCE_FEE_BPS (5000).
   */
  async setPerfFee(args: {
    bucket: Bucket;
    performanceFeeBps: number;
    admin: Signer;
    feeCosigner: FeeCosigner;
  }): Promise<string> {
    const [bucketPda] = findBucket(this.c.programId, args.bucket);
    const ix = await this.c.program.methods
      .setPerfFee(args.performanceFeeBps)
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        bucket: bucketPda,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
    return this.cosign(ix, args.feeCosigner, args.admin);
  }

  /**
   * One-time init of the global fee schedule. `recipients` must sum to
   * exactly 10000 bps over non-empty slots; empty slots must have
   * recipient=PublicKey.default() AND bpsShare=0. To change the split
   * later, call `setFeeSchedule(...)`.
   */
  async initFeeSchedule(args: {
    recipients: FeeRecipientInput[];
    admin: Signer;
  }): Promise<string> {
    const [feeSchedule] = findFeeSchedule(this.c.programId);
    const [feeBucket] = findFeeBucket(this.c.programId);
    const pad = (xs: FeeRecipientInput[]): FeeRecipientInput[] => {
      const arr = xs.slice(0, MAX_FEE_RECIPIENTS);
      while (arr.length < MAX_FEE_RECIPIENTS) {
        arr.push({ recipient: PublicKey.default, bpsShare: 0 });
      }
      return arr;
    };
    return this.c.program.methods
      .initFeeSchedule(pad(args.recipients) as any)
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        feeSchedule,
        feeBucket,
        systemProgram: SystemProgram.programId,
      })
      .signers([args.admin])
      .rpc();
  }

  /**
   * Admin update of the fee schedule. Replaces the recipient array.
   * `genesis_ts` is preserved unchanged (telemetry only - when the
   * schedule was first initialized). Non-empty slots must sum to
   * exactly 10000 bps. To migrate to a multi-sig later, rotate the
   * admin pubkey via `setAdmin(...)` first and have the multi-sig
   * call this method.
   */
  async setFeeSchedule(args: {
    recipients: FeeRecipientInput[];
    admin: Signer;
    feeCosigner: FeeCosigner;
  }): Promise<string> {
    const [feeSchedule] = findFeeSchedule(this.c.programId);
    const pad = (xs: FeeRecipientInput[]): FeeRecipientInput[] => {
      const arr = xs.slice(0, MAX_FEE_RECIPIENTS);
      while (arr.length < MAX_FEE_RECIPIENTS) {
        arr.push({ recipient: PublicKey.default, bpsShare: 0 });
      }
      return arr;
    };
    const ix = await this.c.program.methods
      .setFeeSchedule(pad(args.recipients) as any)
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        feeSchedule,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
    return this.cosign(ix, args.feeCosigner, args.admin);
  }

  /**
   * Permissionless. Drains the global fee bucket per the active split.
   * Caller must supply every non-empty recipient as a writable account.
   */
  async distributeFees(args: {
    recipients: PublicKey[];
    caller: Signer;
  }): Promise<string> {
    const [feeSchedule] = findFeeSchedule(this.c.programId);
    const [feeBucket] = findFeeBucket(this.c.programId);
    const remaining: AccountMeta[] = args.recipients.map((r) => ({
      pubkey: r,
      isSigner: false,
      isWritable: true,
    }));
    return this.c.program.methods
      .distributeFees()
      .accountsPartial({
        feeSchedule,
        feeBucket,
        caller: args.caller.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(remaining)
      .signers([args.caller])
      .rpc();
  }

  // ════════════════════════════════════════════════════════════════════
  // dZINC pool (bucket 1) admin. All cosigned, mirroring initBucket /
  // setBucketOperator (the same fee-holder Ed25519 second factor).
  // ════════════════════════════════════════════════════════════════════

  /**
   * One-time setup of a bucket's dZINC pool sidecar (cosigned). Mirrors
   * `initMiningPda` for ORE: pins the bucket's `mining_authority` PDA as the
   * ZINC player / CPI signer + SOL escrow (so a bucket can be EITHER an ORE or
   * a ZINC pool, never both - the first init to claim mining_authority wins),
   * creates the ZincPool account + the custody ZINC ATA, and seeds the mining
   * authority rent-exempt. `minRoundLamports = 0` falls back to the pool
   * default; `maxInflightLamports` is the per-window SOL exposure ceiling
   * (<= MAX_ZINC_INFLIGHT_CEIL, validated on-chain).
   *
   * Wires InitZincPool: config, admin, bucket, zinc_pool, mining_authority,
   * zinc_mint, zinc_custody_ata, instructions, token_program,
   * associated_token_program, system_program.
   */
  async initZincPool(args: {
    bucket: Bucket;
    minRoundLamports: anchor.BN | number;
    maxInflightLamports: anchor.BN | number;
    admin: Signer;
    feeCosigner: FeeCosigner;
  }): Promise<string> {
    const [bucketPda] = findBucket(this.c.programId, args.bucket);
    const [zincPool] = zincPoolPda(this.c.programId, args.bucket);
    const [miningAuthority] = findMiningAuthority(this.c.programId, args.bucket);
    const custodyAta = zincCustodyAta(miningAuthority);
    const ix = await this.c.program.methods
      .initZincPool(
        args.bucket as number,
        new anchor.BN(args.minRoundLamports.toString()),
        new anchor.BN(args.maxInflightLamports.toString()),
      )
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        bucket: bucketPda,
        zincPool,
        miningAuthority,
        zincMint: ZINC_MINT,
        zincCustodyAta: custodyAta,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        tokenProgram: ZINC_TOKEN_PROGRAM,
        associatedTokenProgram: ZINC_ATA_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    return this.cosign(ix, args.feeCosigner, args.admin);
  }

  /**
   * Cosigned: tune the dZINC pool's per-round + per-window SOL caps. Mirrors
   * `set_adapter_caps`. A 0 `minRoundLamports` falls back to the pool default.
   *
   * Wires ZincPoolAdmin: config, admin, bucket, zinc_pool, instructions.
   */
  async setZincPoolCaps(args: {
    bucket: Bucket;
    minRoundLamports: anchor.BN | number;
    maxInflightLamports: anchor.BN | number;
    admin: Signer;
    feeCosigner: FeeCosigner;
  }): Promise<string> {
    const [bucketPda] = findBucket(this.c.programId, args.bucket);
    const [zincPool] = zincPoolPda(this.c.programId, args.bucket);
    const ix = await this.c.program.methods
      .setZincPoolCaps(
        new anchor.BN(args.minRoundLamports.toString()),
        new anchor.BN(args.maxInflightLamports.toString()),
      )
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        bucket: bucketPda,
        zincPool,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
    return this.cosign(ix, args.feeCosigner, args.admin);
  }

  /**
   * Cosigned: flip the dZINC pool drawdown halt (refuses the ZINC crank).
   *
   * Wires ZincPoolAdmin: config, admin, bucket, zinc_pool, instructions.
   */
  async setZincPoolDdHalt(args: {
    bucket: Bucket;
    ddHalt: boolean;
    admin: Signer;
    feeCosigner: FeeCosigner;
  }): Promise<string> {
    const [bucketPda] = findBucket(this.c.programId, args.bucket);
    const [zincPool] = zincPoolPda(this.c.programId, args.bucket);
    const ix = await this.c.program.methods
      .setZincPoolDdHalt(args.ddHalt)
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        bucket: bucketPda,
        zincPool,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
    return this.cosign(ix, args.feeCosigner, args.admin);
  }

  /**
   * Cosigned: flip the dZINC pool pause (INDEPENDENT of the bucket-level
   * pause; kills the ZINC crank without touching the dORE pool).
   *
   * Wires ZincPoolAdmin: config, admin, bucket, zinc_pool, instructions.
   */
  async setZincPoolPause(args: {
    bucket: Bucket;
    paused: boolean;
    admin: Signer;
    feeCosigner: FeeCosigner;
  }): Promise<string> {
    const [bucketPda] = findBucket(this.c.programId, args.bucket);
    const [zincPool] = zincPoolPda(this.c.programId, args.bucket);
    const ix = await this.c.program.methods
      .setZincPoolPause(args.paused)
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        bucket: bucketPda,
        zincPool,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
    return this.cosign(ix, args.feeCosigner, args.admin);
  }

  /**
   * Admin+cosign: inject external SOL into a pool's treasury, raising
   * `sol_in_vault` 1:1 with NO mint and NO `total_shares` change (the no-mint
   * recapitalize that makes a drained/shortfalling pool's holders whole at their
   * original price). BETTING-only and NPS-bounded on-chain. `funder` defaults to
   * the admin; if distinct it is added to the tx signer set.
   *
   * Wires ReseedPool: config, admin, bucket, zinc_pool, treasury, funder,
   * system_program, instructions.
   */
  async reseedPool(args: {
    bucket: Bucket;
    amount: anchor.BN | number;
    admin: Signer;
    feeCosigner: FeeCosigner;
    funder?: Signer;
  }): Promise<string> {
    const [bucketPda] = findBucket(this.c.programId, args.bucket);
    const [zincPool] = zincPoolPda(this.c.programId, args.bucket);
    const [treasury] = findTreasury(this.c.programId, args.bucket);
    const funder = args.funder ?? args.admin;
    const ix = await this.c.program.methods
      .reseedPool(new anchor.BN(args.amount.toString()))
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        bucket: bucketPda,
        zincPool,
        treasury,
        funder: funder.publicKey,
        systemProgram: SystemProgram.programId,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
    return this.cosign(ix, args.feeCosigner, args.admin, [funder]);
  }

  /**
   * Admin+cosign: reconcile a pool's `sol_in_vault` DOWN to the treasury PDA's
   * real balance (realize a shortfall). Moves NO SOL, mints/burns nothing, never
   * changes `total_shares` (no orphaned tokens); NPS falls uniformly and holders
   * exit at the corrected price via the normal withdraw path. Requires the bucket
   * be paused first (separate `setPause`) and runs in BETTING. A move beyond the
   * per-call drop bound requires `acknowledgeFullWriteDown = true`.
   *
   * Wires ResolvePool: config, admin, bucket, zinc_pool, treasury, instructions.
   */
  async resolvePool(args: {
    bucket: Bucket;
    targetSolInVault: anchor.BN | number;
    acknowledgeFullWriteDown: boolean;
    admin: Signer;
    feeCosigner: FeeCosigner;
  }): Promise<string> {
    const [bucketPda] = findBucket(this.c.programId, args.bucket);
    const [zincPool] = zincPoolPda(this.c.programId, args.bucket);
    const [treasury] = findTreasury(this.c.programId, args.bucket);
    const ix = await this.c.program.methods
      .resolvePool(
        new anchor.BN(args.targetSolInVault.toString()),
        args.acknowledgeFullWriteDown,
      )
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        bucket: bucketPda,
        zincPool,
        treasury,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
    return this.cosign(ix, args.feeCosigner, args.admin);
  }
}
