/**
 * UserApi — the user-facing instruction builders for Diamond Pools. Every method here
 * is signed by the end user (the `owner` / `referrer`): pool deposits, withdrawals, the
 * two-step protocol-pool exit, and referral reward claims. Each returns a plain
 * `TransactionInstruction` the caller assembles into a transaction and signs.
 *
 * Account maps are PORTED from the bankrun-proven `tests/dp/flows.ts`; the `order` PDA
 * (which is not IDL-auto-resolvable — its seeds include the live window id) is derived
 * against the current window, so the deposit/withdraw/exit builders fetch
 * `config.current_window_id` once before building.
 */
import BN from "bn.js";
import {
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import type { DiamondPoolsClient } from "./client";
import {
  POOL_MINING,
  POOL_PROTOCOL,
  ORDER_KIND_DEPOSIT,
  ORDER_KIND_WITHDRAW,
  STORE_MINT,
  PoolId,
} from "./constants";
import {
  pdaConfig,
  pdaWindow,
  pdaMiningPool,
  pdaProtocolPool,
  pdaPosition,
  pdaOrder,
  pdaVault,
  pdaReferrer,
  pdaReferralConfig,
  pdaReferralTreasury,
} from "./pdas";

const bn = (v: bigint): BN => new BN(v.toString());

export class UserApi {
  constructor(private readonly client: DiamondPoolsClient) {}

  /** Fetch the live intake window id from `config` (needed to derive `order` PDAs). */
  private async currentWindowId(): Promise<bigint> {
    const cfg = await this.client.program.account.config.fetch(pdaConfig()[0]);
    return BigInt(cfg.currentWindowId.toString());
  }

  /**
   * Mining-pool deposit: escrow `amount` lamports (SOL) into the current INTAKE window.
   * Settled to shares later by the crank. `owner` signs.
   */
  async depositMining(owner: PublicKey, amount: bigint): Promise<TransactionInstruction> {
    const wid = await this.currentWindowId();
    return this.client.program.methods
      .submitMiningDeposit(bn(amount))
      .accountsPartial({
        config: pdaConfig()[0],
        window: pdaWindow(wid)[0],
        position: pdaPosition(POOL_MINING, owner)[0],
        order: pdaOrder(wid, owner, POOL_MINING, ORDER_KIND_DEPOSIT)[0],
        miningPool: pdaMiningPool()[0],
        owner,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /**
   * stORE deposit into the Staking (poolId=1) or Protocol (poolId=2) pool: transfers
   * `amount` stORE from the owner's ATA into the pool vault ATA and books a deposit order
   * in the current INTAKE window. `owner` signs.
   *
   * Protocol deposits supply `protocolPool` (the SOL-leg intake gate) and, when the pool
   * is in whitelist mode, `whitelistEntry` (pass the wallet's `pdaWhitelist(owner)[0]`).
   * Staking deposits pass neither (both null). The optional `stakingPool` gate is unused
   * by the tested flows and is left None.
   */
  async depositStore(
    poolId: PoolId,
    owner: PublicKey,
    amount: bigint,
    whitelistEntry: PublicKey | null = null,
  ): Promise<TransactionInstruction> {
    const wid = await this.currentWindowId();
    const vaultAuthority = pdaVault(poolId)[0];
    return this.client.program.methods
      .submitStoreDeposit(poolId, bn(amount))
      .accountsPartial({
        config: pdaConfig()[0],
        window: pdaWindow(wid)[0],
        vaultAuthority,
        storeMint: STORE_MINT,
        vaultStoreAta: getAssociatedTokenAddressSync(STORE_MINT, vaultAuthority, true),
        ownerStoreAta: getAssociatedTokenAddressSync(STORE_MINT, owner, true),
        position: pdaPosition(poolId, owner)[0],
        order: pdaOrder(wid, owner, poolId, ORDER_KIND_DEPOSIT)[0],
        whitelistEntry: whitelistEntry ?? null,
        protocolPool: poolId === POOL_PROTOCOL ? pdaProtocolPool()[0] : null,
        stakingPool: null,
        owner,
      })
      .instruction();
  }

  /**
   * Lock `shares` from the owner's position in `poolId` for withdrawal, booking a
   * withdraw order in the current INTAKE window. Settled/paid out later by the crank.
   * `owner` signs.
   */
  async submitWithdraw(
    poolId: PoolId,
    owner: PublicKey,
    shares: bigint,
  ): Promise<TransactionInstruction> {
    const wid = await this.currentWindowId();
    return this.client.program.methods
      .submitWithdraw(poolId, bn(shares))
      .accountsPartial({
        config: pdaConfig()[0],
        window: pdaWindow(wid)[0],
        position: pdaPosition(poolId, owner)[0],
        order: pdaOrder(wid, owner, poolId, ORDER_KIND_WITHDRAW)[0],
        owner,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /**
   * Step 1 of the Protocol-pool exit: post the aging exit notice for `owner`. After the
   * notice matures (epoch boundary), call {@link submitPpExit}. `owner` signs. The
   * `notice` PDA (seeds = ["pp_exit_notice", owner]) is auto-resolved by Anchor.
   */
  async submitPpExitNotice(owner: PublicKey): Promise<TransactionInstruction> {
    return this.client.program.methods
      .submitPpExitNotice()
      .accountsPartial({
        config: pdaConfig()[0],
        owner,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /**
   * Step 2 of the Protocol-pool exit: with a matured notice, book a withdraw order for
   * `shares` in the current INTAKE window (POOL_PROTOCOL / withdraw). `owner` signs. The
   * `notice` PDA is auto-resolved by Anchor.
   */
  async submitPpExit(owner: PublicKey, shares: bigint): Promise<TransactionInstruction> {
    const wid = await this.currentWindowId();
    return this.client.program.methods
      .submitPpExit(bn(shares))
      .accountsPartial({
        config: pdaConfig()[0],
        window: pdaWindow(wid)[0],
        protocolPool: pdaProtocolPool()[0],
        position: pdaPosition(POOL_PROTOCOL, owner)[0],
        order: pdaOrder(wid, owner, POOL_PROTOCOL, ORDER_KIND_WITHDRAW)[0],
        owner,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /**
   * Referrer self-claims accrued referral rewards. The settlement authority's Ed25519
   * attestation is read from the instructions sysvar, so the caller MUST prepend
   * `buildReferralClaimAttestation({ settlementAuthority, referrer, cumulative, expiry })`
   * as a preInstruction in the SAME transaction, before this ix. `referrer` signs.
   */
  async claimReferral(referrer: PublicKey): Promise<TransactionInstruction> {
    return this.client.program.methods
      .claimReferral()
      .accountsPartial({
        referrer,
        referrerState: pdaReferrer(referrer)[0],
        referralConfig: pdaReferralConfig()[0],
        referralTreasury: pdaReferralTreasury()[0],
        ixSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }
}
