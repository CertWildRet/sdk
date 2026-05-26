import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync, getMint } from "@solana/spl-token";
import { Bucket } from "./constants";
import { CwrVaultClient } from "./client";
import {
  findBucket,
  findEscrow,
  findShareMint,
  findTreasury,
  findWithdrawRequest,
} from "./pdas";
import {
  navPerShare as computeNavPerShare,
  payoutForShares,
  sharesForDeposit,
} from "./math";
import type {
  BucketState,
  ConfigState,
  WithdrawRequestState,
} from "./types";

export type NavSnapshot = {
  solInVault: BN;
  externalValue: BN;
  totalNav: BN;
  totalShares: BN;
  pendingWithdrawShares: BN;
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
      pendingWithdrawShares: new BN(b.pendingWithdrawShares.toString()),
      navPerShareX18: computeNavPerShare(totalNav, totalShares),
      paused: b.paused,
    };
  }

  async withdrawRequest(
    bucket: Bucket,
    user: PublicKey,
  ): Promise<WithdrawRequestState | null> {
    const [pda] = findWithdrawRequest(this.c.programId, bucket, user);
    return this.c.program.account.withdrawRequest.fetchNullable(pda);
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

  async escrowBalance(bucket: Bucket): Promise<BN> {
    const [pda] = findEscrow(this.c.programId, bucket);
    const acc = await getAccount(this.c.connection, pda);
    return new BN(acc.amount.toString());
  }

  /**
   * Preview the shares a user would receive for depositing `amount`, given the
   * current bucket state. No on-chain call after the first state fetch.
   */
  async previewDeposit(bucket: Bucket, amount: BN): Promise<BN> {
    const snap = await this.navSnapshot(bucket);
    if (!snap) throw new Error(`Bucket ${bucket} not initialized`);
    return sharesForDeposit(amount, snap.totalShares, snap.totalNav);
  }

  /**
   * Preview the SOL payout for redeeming `shares`, given current bucket state.
   * Subject to InsufficientVaultSol at claim time if `sol_in_vault < payout`.
   */
  async previewWithdraw(bucket: Bucket, shares: BN): Promise<BN> {
    const snap = await this.navSnapshot(bucket);
    if (!snap) throw new Error(`Bucket ${bucket} not initialized`);
    return payoutForShares(shares, snap.totalShares, snap.totalNav);
  }
}
