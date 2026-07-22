/**
 * ReadApi — account fetchers + NAV previews for Diamond Pools. Read-only: this module
 * builds NO instructions. It wraps Anchor's `program.account.<name>.fetch` decoders
 * (fully typed via the IDL) over the pdas.ts derivations.
 *
 * Singleton getters fetch the unique on-chain account (they throw if it is somehow
 * missing — Config/pools always exist on a live program). Parameterized getters derive
 * the PDA and fetch NULLABLE, returning `null` when the account has not been created
 * yet (e.g. an owner with no position, a window that has been cleaned up).
 */
import { PublicKey } from "@solana/web3.js";
import type { DiamondPoolsClient } from "./client";
import { DIAMOND_POOLS_PROGRAM_ID, type PoolId } from "./constants";
import {
  pdaConfig,
  pdaMiningPool,
  pdaStakingPool,
  pdaProtocolPool,
  pdaFeeSchedule,
  pdaReferralConfig,
  pdaPhantomMember,
  pdaPosition,
  pdaWindow,
  pdaOrder,
  pdaReferrer,
  pdaWhitelist,
  pdaFeeExempt,
} from "./pdas";
import type {
  Config,
  FeeSchedule,
  FeeExemptEntry,
  MiningPool,
  Order,
  PhantomMember,
  Position,
  PpExitNotice,
  ProtocolPool,
  ReferralConfig,
  ReferrerState,
  StakingPool,
  WhitelistEntry,
  Window,
} from "./types";

export class ReadApi {
  constructor(private readonly client: DiamondPoolsClient) {}

  // ─── singletons ─────────────────────────────────────────────────────────────

  /** The global Config singleton (admin, all params, current_window_id, pending set). */
  config(): Promise<Config> {
    return this.client.program.account.config.fetch(pdaConfig()[0]);
  }

  /** The Mining pool (SOL vault, share supply, ORE miner book, monetize/evac state). */
  miningPool(): Promise<MiningPool> {
    return this.client.program.account.miningPool.fetch(pdaMiningPool()[0]);
  }

  /** The Staking pool (stORE vault, share supply, book, cap-breach counter). */
  stakingPool(): Promise<StakingPool> {
    return this.client.program.account.stakingPool.fetch(pdaStakingPool()[0]);
  }

  /** The Protocol pool (stORE vault, SOL sleeve, share supply, book, accrued fees). */
  protocolPool(): Promise<ProtocolPool> {
    return this.client.program.account.protocolPool.fetch(pdaProtocolPool()[0]);
  }

  /** The immutable launch FeeSchedule (genesis ts + recipient split). */
  feeSchedule(): Promise<FeeSchedule> {
    return this.client.program.account.feeSchedule.fetch(pdaFeeSchedule()[0]);
  }

  /** The ReferralConfig singleton (settlement authority, swept total, treasury bump). */
  referralConfig(): Promise<ReferralConfig> {
    return this.client.program.account.referralConfig.fetch(pdaReferralConfig()[0]);
  }

  /** The LITE phantom member singleton (aggregate (u,r) magnitudes + factor checkpoint). */
  phantomMember(): Promise<PhantomMember> {
    return this.client.program.account.phantomMember.fetch(pdaPhantomMember()[0]);
  }

  // ─── parameterized (nullable) ───────────────────────────────────────────────

  /** A pool position for `owner`; `null` if the owner holds no shares in that pool. */
  position(poolId: PoolId, owner: PublicKey): Promise<Position | null> {
    return this.client.program.account.position.fetchNullable(pdaPosition(poolId, owner)[0]);
  }

  /** The Window account for `id`; `null` if it does not exist (future/cleaned-up). */
  window(id: bigint): Promise<Window | null> {
    return this.client.program.account.window.fetchNullable(pdaWindow(id)[0]);
  }

  /** A queued deposit/withdraw Order for (window, owner, pool, kind); `null` if none. */
  order(
    windowId: bigint,
    owner: PublicKey,
    poolId: PoolId,
    kind: number,
  ): Promise<Order | null> {
    return this.client.program.account.order.fetchNullable(
      pdaOrder(windowId, owner, poolId, kind)[0],
    );
  }

  /** The pending PP-exit notice for `owner`; `null` if no notice is outstanding. */
  ppExitNotice(owner: PublicKey): Promise<PpExitNotice | null> {
    return this.client.program.account.ppExitNotice.fetchNullable(
      this.ppExitNoticePda(owner),
    );
  }

  /** The per-referrer claim state for `referrer`; `null` if never claimed. */
  referrerState(referrer: PublicKey): Promise<ReferrerState | null> {
    return this.client.program.account.referrerState.fetchNullable(pdaReferrer(referrer)[0]);
  }

  /** The whitelist entry for `wallet`; `null` if not whitelisted. */
  whitelistEntry(wallet: PublicKey): Promise<WhitelistEntry | null> {
    return this.client.program.account.whitelistEntry.fetchNullable(pdaWhitelist(wallet)[0]);
  }

  /** Wallet-scoped external-fee exemption state; `null` when no flags are configured. */
  feeExemptEntry(wallet: PublicKey): Promise<FeeExemptEntry | null> {
    return this.client.program.account.feeExemptEntry.fetchNullable(pdaFeeExempt(wallet)[0]);
  }

  // ─── derived views ──────────────────────────────────────────────────────────

  /** The current (open) window id, read from Config. */
  async currentWindowId(): Promise<bigint> {
    const cfg = await this.config();
    return BigInt(cfg.currentWindowId.toString());
  }

  /**
   * Mining NAV preview. Returns the raw vault SOL and share supply plus a convenience
   * SOL-per-share ratio computed with JS floats.
   *
   * NOTE: `navPerShare` is a lossy PREVIEW for display only — it is `solInVault /
   * totalShares` in plain floating point, NOT the exact 1e18-scaled fixed-point NAV the
   * program uses on-chain. Do not settle money against it; read the frozen window NPS
   * for exact figures.
   */
  async miningNav(): Promise<{ solInVault: bigint; totalShares: bigint; navPerShare: number }> {
    const pool = await this.miningPool();
    const solInVault = BigInt(pool.solInVault.toString());
    const totalShares = BigInt(pool.totalShares.toString());
    const navPerShare = totalShares > 0n ? Number(solInVault) / Number(totalShares) : 0;
    return { solInVault, totalShares, navPerShare };
  }

  // ─── internal ───────────────────────────────────────────────────────────────

  /** Derive the pp_exit_notice PDA (seeds: ["pp_exit_notice", owner]). */
  private ppExitNoticePda(owner: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("pp_exit_notice", "utf8"), owner.toBuffer()],
      DIAMOND_POOLS_PROGRAM_ID,
    )[0];
  }
}
