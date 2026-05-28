import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import {
  AccountMeta,
  PublicKey,
  Signer,
  SystemProgram,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Bucket, MAX_FEE_RECIPIENTS } from "./constants";
import { CwrVaultClient } from "./client";
import {
  deriveBucketAddresses,
  findBucket,
  findFeeBucket,
  findFeeSchedule,
} from "./pdas";
import type { BucketParamsInput, FeeRecipientInput } from "./types";

export class AdminApi {
  constructor(private readonly c: CwrVaultClient) {}

  async initialize(args: {
    admin: Signer;
    backend: PublicKey;
    operatorWallet: PublicKey;
    feeRecipient: PublicKey;
    /** V5 — stORE mint pinned at init. Pass PublicKey.default for environments
     *  without ore-lst deployed (push_store + withdraw store will no-op). */
    storeMint: PublicKey;
  }): Promise<string> {
    return this.c.program.methods
      .initialize(args.backend, args.operatorWallet, args.feeRecipient, args.storeMint)
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([args.admin])
      .rpc();
  }

  async initBucket(args: {
    bucketId: number;
    params: BucketParamsInput;
    admin: Signer;
  }): Promise<string> {
    const addrs = deriveBucketAddresses(this.c.programId, args.bucketId);
    // Read cfg to find the storeMint pinned at initialize-time.
    const cfg = await this.c.program.account.config.fetch(this.c.configPda);
    return this.c.program.methods
      .initBucket(args.bucketId, args.params as any)
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

  async setAdmin(args: { newAdmin: PublicKey; admin: Signer }): Promise<string> {
    return this.c.program.methods
      .setAdmin(args.newAdmin)
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
      })
      .signers([args.admin])
      .rpc();
  }

  async setOperatorWallet(args: {
    newOperatorWallet: PublicKey;
    admin: Signer;
  }): Promise<string> {
    return this.c.program.methods
      .setOperatorWallet(args.newOperatorWallet)
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
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
   * Audit C3 — bounded admin write-off of `bucket.external_value`. Per-call
   * bound is `MAX_WRITE_OFF_BPS` (5%) of CURRENT external_value AND rate-
   * limited by `min_nav_update_interval`. Blocked while `claims_open == true`.
   */
  async adminWriteOff(args: {
    bucket: Bucket;
    amount: BN;
    admin: Signer;
  }): Promise<string> {
    const [bucketPda] = findBucket(this.c.programId, args.bucket);
    return this.c.program.methods
      .adminWriteOff(args.amount)
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        bucket: bucketPda,
      })
      .signers([args.admin])
      .rpc();
  }

  /**
   * One-time init of the global fee schedule. Both splits must sum to
   * exactly 10000 bps over non-empty slots; empty slots must have
   * recipient=PublicKey.default() AND bpsShare=0.
   */
  async initFeeSchedule(args: {
    genesis: FeeRecipientInput[];
    yearOne: FeeRecipientInput[];
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
      .initFeeSchedule(pad(args.genesis) as any, pad(args.yearOne) as any)
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
   * Audit C2 — admin update of an already-initialised fee schedule.
   * Preserves `genesis_ts` so the year-one switchover clock is not reset.
   * Both arrays must sum to exactly 10000 bps over non-empty slots.
   */
  async setFeeSchedule(args: {
    genesis: FeeRecipientInput[];
    yearOne: FeeRecipientInput[];
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
      .setFeeSchedule(pad(args.genesis) as any, pad(args.yearOne) as any)
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
