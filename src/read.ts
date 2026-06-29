import BN from "bn.js";
import { utils } from "@coral-xyz/anchor";
import { AccountInfo, PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync, getMint } from "@solana/spl-token";
import { Bucket } from "./constants";
import { CwrVaultClient } from "./client";
import {
  findBucket,
  findFeeBucket,
  findFeeSchedule,
  findMiningAuthority,
  findPendingDeposit,
  findPendingState,
  findPendingTreasury,
  findReferralConfig,
  findReferralTreasury,
  findReferrerState,
  findShareMint,
  findTreasury,
  oreMinerPda,
  zincPoolPda,
  zincPositionPda,
} from "./pdas";
import {
  navPerShare as computeNavPerShare,
  payoutForShares,
  sharesForDeposit,
} from "./math";
import type { BucketState, ConfigState, FeeScheduleState } from "./types";

export type NavSnapshot = {
  solInVault: BN;
  externalValue: BN;
  totalNav: BN;
  totalShares: BN;
  navPerShareX18: BN;
  paused: boolean;
};

export class ReadApi {
  constructor(private readonly c: CwrVaultClient) {}

  async config(): Promise<ConfigState> {
    return this.c.program.account.config.fetch(this.c.configPda);
  }

  async bucket(bucket: Bucket): Promise<BucketState | null> {
    const [pda] = findBucket(this.c.programId, bucket);
    return this.c.program.account.bucket.fetchNullable(pda);
  }

  async navSnapshot(bucket: Bucket): Promise<NavSnapshot | null> {
    const b = await this.bucket(bucket);
    if (!b) return null;
    const solInVault = new BN(b.solInVault.toString());
    const externalValue = new BN(b.externalValue.toString());
    const totalShares = new BN(b.totalShares.toString());
    const totalNav = solInVault.add(externalValue);
    return {
      solInVault,
      externalValue,
      totalNav,
      totalShares,
      navPerShareX18: computeNavPerShare(totalNav, totalShares),
      paused: b.paused,
    };
  }

  async userShares(bucket: Bucket, user: PublicKey): Promise<BN> {
    const [mint] = findShareMint(this.c.programId, bucket);
    const ata = getAssociatedTokenAddressSync(mint, user);
    try {
      const acc = await getAccount(this.c.connection, ata);
      return new BN(acc.amount.toString());
    } catch {
      return new BN(0);
    }
  }

  async mintSupply(bucket: Bucket): Promise<BN> {
    const [mint] = findShareMint(this.c.programId, bucket);
    const m = await getMint(this.c.connection, mint);
    return new BN(m.supply.toString());
  }

  async treasuryLamports(bucket: Bucket): Promise<BN> {
    const [pda] = findTreasury(this.c.programId, bucket);
    const info = await this.c.connection.getAccountInfo(pda);
    return new BN(info?.lamports ?? 0);
  }

  /**
   * Preview the shares a user would receive for depositing `amount`, given the
   * current bucket state. Does not account for the V5 entry fee - caller should
   * subtract the fee before calling if it's enabled on the target bucket.
   */
  async previewDeposit(bucket: Bucket, amount: BN): Promise<BN> {
    const snap = await this.navSnapshot(bucket);
    if (!snap) throw new Error(`Bucket ${bucket} not initialized`);
    return sharesForDeposit(amount, snap.totalShares, snap.totalNav);
  }

  /**
   * Preview the gross SOL payout for redeeming `shares`. Does not subtract
   * the perf-fee or V5 exit fee - caller should apply those separately for
   * a final user-visible payout estimate.
   */
  async previewWithdraw(bucket: Bucket, shares: BN): Promise<BN> {
    const snap = await this.navSnapshot(bucket);
    if (!snap) throw new Error(`Bucket ${bucket} not initialized`);
    return payoutForShares(shares, snap.totalShares, snap.totalNav);
  }

  /**
   * V6 - raw ORE Miner account for a bucket's mining authority. NAV is now
   * derived on-chain from this account (no more `report_nav`); this helper
   * returns the raw account info so a caller can decode the documented miner
   * byte layout off-chain (len 544, disc 103 - see ore_cpi.rs offsets) if it
   * needs to mirror the on-chain derived NAV. Returns null before
   * `init_mining_pda` / first deploy creates the miner.
   */
  async oreMiner(bucket: Bucket): Promise<AccountInfo<Buffer> | null> {
    const [miningAuthority] = findMiningAuthority(this.c.programId, bucket);
    const [miner] = oreMinerPda(miningAuthority);
    return this.c.connection.getAccountInfo(miner);
  }

  /** V5 - fetch the global fee schedule. */
  async feeSchedule(): Promise<FeeScheduleState | null> {
    const [pda] = findFeeSchedule(this.c.programId);
    return this.c.program.account.feeSchedule.fetchNullable(pda);
  }

  /** V5 - current SOL balance accumulated in the global fee bucket. */
  async feeBucketLamports(): Promise<BN> {
    const [pda] = findFeeBucket(this.c.programId);
    const info = await this.c.connection.getAccountInfo(pda);
    return new BN(info?.lamports ?? 0);
  }

  // ─── Parked-capital buffer reads ──────────────────────────────────────

  /** Buffer state (pending_total + pending_count) for a bucket, or null if the
   *  buffer was never initialized (`initPending` not yet run for it). */
  async pendingState(bucket: Bucket): Promise<any | null> {
    const [pda] = findPendingState(this.c.programId, bucket);
    return this.c.program.account.pendingState.fetchNullable(pda);
  }

  /** Lamports held in the per-bucket parked-SOL escrow (incl. the rent seed). */
  async pendingTreasuryLamports(bucket: Bucket): Promise<BN> {
    const [pda] = findPendingTreasury(this.c.programId, bucket);
    const info = await this.c.connection.getAccountInfo(pda);
    return new BN(info?.lamports ?? 0);
  }

  /** A single owner's parked-deposit ticket, or null if none open. */
  async pendingDeposit(bucket: Bucket, owner: PublicKey): Promise<any | null> {
    const [pda] = findPendingDeposit(this.c.programId, bucket, owner);
    return this.c.program.account.pendingDeposit.fetchNullable(pda);
  }

  /**
   * Scan ALL open parked-deposit tickets for a bucket (the keeper uses this to
   * auto-finalize parkers after settle). Filters on the ticket's bucket_id via
   * a memcmp at offset 40 (8 disc + 32 owner).
   */
  async allPending(
    bucket: Bucket,
  ): Promise<Array<{ publicKey: PublicKey; account: any }>> {
    const bucketByte = utils.bytes.bs58.encode(Buffer.from([(bucket as number) & 0xff]));
    return this.c.program.account.pendingDeposit.all([
      { memcmp: { offset: 8 + 32, bytes: bucketByte } },
    ]);
  }

  // ─── Referral program reads ───────────────────────────────────────────

  /** Global referral config (settlement authority + treasury bump + swept), or
   *  null if `initReferral` was never run. */
  async referralConfig(): Promise<any | null> {
    const [pda] = findReferralConfig(this.c.programId);
    return this.c.program.account.referralConfig.fetchNullable(pda);
  }

  /** Lamports in the bounded referral payout pool (incl. the rent seed). */
  async referralTreasuryLamports(): Promise<BN> {
    const [pda] = findReferralTreasury(this.c.programId);
    const info = await this.c.connection.getAccountInfo(pda);
    return new BN(info?.lamports ?? 0);
  }

  /** A referrer's claim watermark (`claimed` lamports), or null if never claimed. */
  async referrerState(referrer: PublicKey): Promise<any | null> {
    const [pda] = findReferrerState(this.c.programId, referrer);
    return this.c.program.account.referrerState.fetchNullable(pda);
  }

  // ─── dZINC pool (bucket 1) reads ──────────────────────────────────────

  /**
   * The per-bucket dZINC pool sidecar (ZincPool), or null if `initZincPool`
   * was never run for this bucket. Its existence is what makes a bucket a
   * dZINC pool. Holds the smelted-ZINC-per-share accumulator, custody mirror,
   * caps, and the cached zinc_profile / zinc_custody_ata pubkeys.
   */
  async zincPool(bucket: Bucket): Promise<any | null> {
    const [pda] = zincPoolPda(this.c.programId, bucket);
    return this.c.program.account.zincPool.fetchNullable(pda);
  }

  /**
   * A single owner's dZINC position (reward-debt watermark + carried grams),
   * or null if the owner never deposited into the dZINC pool.
   */
  async zincPosition(bucket: Bucket, owner: PublicKey): Promise<any | null> {
    const [pda] = zincPositionPda(this.c.programId, bucket, owner);
    return this.c.program.account.zincPosition.fetchNullable(pda);
  }
}
