import * as anchor from "@coral-xyz/anchor";
import {
  AccountMeta,
  PublicKey,
  Signer,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Bucket, MAX_FEE_RECIPIENTS } from "./constants";
import { CwrVaultClient } from "./client";
import {
  deriveBucketAddresses,
  findBucket,
  findFeeBucket,
  findFeeSchedule,
  findMiningAuthority,
} from "./pdas";
import type { BucketParamsInput, FeeRecipientInput } from "./types";

export class AdminApi {
  constructor(private readonly c: CwrVaultClient) {}

  async initialize(args: {
    admin: Signer;
    backend: PublicKey;
    feeRecipient: PublicKey;
    /** V5 — stORE mint pinned at init. Must be a real SPL mint
     *  (Pubkey::default() is rejected — see audit C1). */
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
      .initialize(args.backend, args.feeRecipient, args.storeMint)
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
   * V5 — `operatorWallet` is now PER-BUCKET (pinned at init time, mutable
   * via `setBucketOperator`). Each bucket having its own operator gives
   * it its own ORE Miner PDA, so `claim_ore` cadence + refining-yield
   * accumulation are isolated across Simple / Refined / Ultra.
   */
  async initBucket(args: {
    bucketId: number;
    params: BucketParamsInput;
    operatorWallet: PublicKey;
    admin: Signer;
  }): Promise<string> {
    const addrs = deriveBucketAddresses(this.c.programId, args.bucketId);
    // Read cfg to find the storeMint pinned at initialize-time.
    const cfg = await this.c.program.account.config.fetch(this.c.configPda);
    return this.c.program.methods
      .initBucket(args.bucketId, args.params as any, args.operatorWallet)
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        bucket: addrs.bucket,
        treasury: addrs.treasury,
        shareMint: addrs.shareMint,
        storeTreasury: addrs.storeTreasury,
        storeMint: cfg.storeMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([args.admin])
      .rpc();
  }

  /**
   * V6 — one-time init of a bucket's per-bucket mining authority PDA. Derives
   * `mining_authority` (and, on-chain, the ORE Miner key it stores on the
   * bucket). Admin-signed.
   *
   * Wires InitMiningPda: config, admin, bucket, mining_authority,
   * system_program.
   */
  async initMiningPda(args: { bucket: Bucket; admin: Signer }): Promise<string> {
    const [bucketPda] = findBucket(this.c.programId, args.bucket);
    const [miningAuthority] = findMiningAuthority(this.c.programId, args.bucket);
    return this.c.program.methods
      .initMiningPda()
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        bucket: bucketPda,
        miningAuthority,
        systemProgram: SystemProgram.programId,
      })
      .signers([args.admin])
      .rpc();
  }

  async setBackend(args: { newBackend: PublicKey; admin: Signer }): Promise<string> {
    return this.c.program.methods
      .setBackend(args.newBackend)
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
      })
      .signers([args.admin])
      .rpc();
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
      })
      .signers([args.admin])
      .rpc();
  }

  /**
   * V5 — rotate a single bucket's operator wallet. Blocked while
   * `claims_open == true` (NAV frozen). Per-bucket: rotating Simple's
   * operator does NOT touch Refined or Ultra.
   */
  async setBucketOperator(args: {
    bucket: Bucket;
    newOperator: PublicKey;
    admin: Signer;
  }): Promise<string> {
    const [bucketPda] = findBucket(this.c.programId, args.bucket);
    return this.c.program.methods
      .setBucketOperator(args.newOperator)
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        bucket: bucketPda,
      })
      .signers([args.admin])
      .rpc();
  }

  /**
   * Admin-tunable per-bucket window timing — change OPEN/BETTING window
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
  }): Promise<string> {
    const [bucketPda] = findBucket(this.c.programId, args.bucket);
    return this.c.program.methods
      .setBucketWindowTiming(
        new anchor.BN(args.openSecs.toString()),
        new anchor.BN(args.bettingSecs.toString()),
        new anchor.BN(args.guardBandSlots.toString()),
      )
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        bucket: bucketPda,
      })
      .signers([args.admin])
      .rpc();
  }

  async setFeeRecipient(args: {
    newFeeRecipient: PublicKey;
    admin: Signer;
  }): Promise<string> {
    return this.c.program.methods
      .setFeeRecipient(args.newFeeRecipient)
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
      })
      .signers([args.admin])
      .rpc();
  }

  async setBucketParams(args: {
    bucket: Bucket;
    params: BucketParamsInput;
    admin: Signer;
  }): Promise<string> {
    const [bucketPda] = findBucket(this.c.programId, args.bucket);
    return this.c.program.methods
      .setBucketParams(args.params as any)
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        bucket: bucketPda,
      })
      .signers([args.admin])
      .rpc();
  }

  async setPause(args: {
    bucket: Bucket;
    paused: boolean;
    admin: Signer;
  }): Promise<string> {
    const [bucketPda] = findBucket(this.c.programId, args.bucket);
    return this.c.program.methods
      .setPause(args.paused)
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        bucket: bucketPda,
      })
      .signers([args.admin])
      .rpc();
  }

  async setDepositsOpen(args: {
    bucket: Bucket;
    open: boolean;
    admin: Signer;
  }): Promise<string> {
    const [bucketPda] = findBucket(this.c.programId, args.bucket);
    return this.c.program.methods
      .setDepositsOpen(args.open)
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        bucket: bucketPda,
      })
      .signers([args.admin])
      .rpc();
  }

  async setClaimsOpen(args: {
    bucket: Bucket;
    open: boolean;
    admin: Signer;
  }): Promise<string> {
    const [bucketPda] = findBucket(this.c.programId, args.bucket);
    return this.c.program.methods
      .setClaimsOpen(args.open)
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        bucket: bucketPda,
      })
      .signers([args.admin])
      .rpc();
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
  }): Promise<string> {
    const [bucketPda] = findBucket(this.c.programId, args.bucket);
    return this.c.program.methods
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
      })
      .signers([args.admin])
      .rpc();
  }

  /**
   * V5 — narrow admin setter for the per-pull VOLUME fee. This is the
   * ONLY active monetisation in the V5 baseline product (entry / exit /
   * perf all default to 0 bps). Bps capped at MAX_PULL_FEE_BPS (500).
   * Bumps blocked while `claims_open == true` (raising is gated; lowering OK).
   */
  async setPullFee(args: {
    bucket: Bucket;
    pullFeeBps: number;
    pullFeeEnabled: boolean;
    admin: Signer;
  }): Promise<string> {
    const [bucketPda] = findBucket(this.c.programId, args.bucket);
    return this.c.program.methods
      .setPullFee(args.pullFeeBps, args.pullFeeEnabled)
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        bucket: bucketPda,
      })
      .signers([args.admin])
      .rpc();
  }

  /**
   * V5 — bundle a `set_pull_fee` ix for every passed bucket into a single
   * atomic transaction. Same bps + enabled flag applied to all targets.
   * Convenient for setting Simple/Refined/Ultra in one shot from the admin
   * console. Fails atomically if any bucket rejects (e.g. claims-open lock).
   */
  async setPullFeeAll(args: {
    buckets: Bucket[];
    pullFeeBps: number;
    pullFeeEnabled: boolean;
    admin: Signer;
  }): Promise<string> {
    const tx = new Transaction();
    for (const bucket of args.buckets) {
      const [bucketPda] = findBucket(this.c.programId, bucket);
      const ix = await this.c.program.methods
        .setPullFee(args.pullFeeBps, args.pullFeeEnabled)
        .accountsPartial({
          config: this.c.configPda,
          admin: args.admin.publicKey,
          bucket: bucketPda,
        })
        .instruction();
      tx.add(ix);
    }
    return this.c.program.provider.sendAndConfirm!(tx, [args.admin]);
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
  }): Promise<string> {
    const [bucketPda] = findBucket(this.c.programId, args.bucket);
    return this.c.program.methods
      .setPerfFee(args.performanceFeeBps)
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        bucket: bucketPda,
      })
      .signers([args.admin])
      .rpc();
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
   * `genesis_ts` is preserved unchanged (telemetry only — when the
   * schedule was first initialized). Non-empty slots must sum to
   * exactly 10000 bps. To migrate to a multi-sig later, rotate the
   * admin pubkey via `setAdmin(...)` first and have the multi-sig
   * call this method.
   */
  async setFeeSchedule(args: {
    recipients: FeeRecipientInput[];
    admin: Signer;
  }): Promise<string> {
    const [feeSchedule] = findFeeSchedule(this.c.programId);
    const pad = (xs: FeeRecipientInput[]): FeeRecipientInput[] => {
      const arr = xs.slice(0, MAX_FEE_RECIPIENTS);
      while (arr.length < MAX_FEE_RECIPIENTS) {
        arr.push({ recipient: PublicKey.default, bpsShare: 0 });
      }
      return arr;
    };
    return this.c.program.methods
      .setFeeSchedule(pad(args.recipients) as any)
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        feeSchedule,
      })
      .signers([args.admin])
      .rpc();
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
}
