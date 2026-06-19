import BN from "bn.js";
import { AccountInfo, PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync, getMint } from "@solana/spl-token";
import { Bucket } from "./constants";
import { CwrVaultClient } from "./client";
import {
  findBucket,
  findFeeBucket,
  findFeeSchedule,
  findMiningAuthority,
  findShareMint,
  findTreasury,
  oreMinerPda,
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
   * current bucket state. Does not account for the V5 entry fee — caller should
   * subtract the fee before calling if it's enabled on the target bucket.
   */
  async previewDeposit(bucket: Bucket, amount: BN): Promise<BN> {
    const snap = await this.navSnapshot(bucket);
    if (!snap) throw new Error(`Bucket ${bucket} not initialized`);
    return sharesForDeposit(amount, snap.totalShares, snap.totalNav);
  }

  /**
   * Preview the gross SOL payout for redeeming `shares`. Does not subtract
   * the perf-fee or V5 exit fee — caller should apply those separately for
   * a final user-visible payout estimate.
   */
  async previewWithdraw(bucket: Bucket, shares: BN): Promise<BN> {
    const snap = await this.navSnapshot(bucket);
    if (!snap) throw new Error(`Bucket ${bucket} not initialized`);
    return payoutForShares(shares, snap.totalShares, snap.totalNav);
  }

  /**
   * V6 — raw ORE Miner account for a bucket's mining authority. NAV is now
   * derived on-chain from this account (no more `report_nav`); this helper
   * returns the raw account info so a caller can decode the documented miner
   * byte layout off-chain (len 544, disc 103 — see ore_cpi.rs offsets) if it
   * needs to mirror the on-chain derived NAV. Returns null before
   * `init_mining_pda` / first deploy creates the miner.
   */
  async oreMiner(bucket: Bucket): Promise<AccountInfo<Buffer> | null> {
    const [miningAuthority] = findMiningAuthority(this.c.programId, bucket);
    const [miner] = oreMinerPda(miningAuthority);
    return this.c.connection.getAccountInfo(miner);
  }

  /** V5 — fetch the global fee schedule. */
  async feeSchedule(): Promise<FeeScheduleState | null> {
    const [pda] = findFeeSchedule(this.c.programId);
    return this.c.program.account.feeSchedule.fetchNullable(pda);
  }

  /** V5 — current SOL balance accumulated in the global fee bucket. */
  async feeBucketLamports(): Promise<BN> {
    const [pda] = findFeeBucket(this.c.programId);
    const info = await this.c.connection.getAccountInfo(pda);
    return new BN(info?.lamports ?? 0);
  }
}
