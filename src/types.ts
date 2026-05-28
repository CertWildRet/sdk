import type { IdlAccounts } from "@coral-xyz/anchor";
import type { PublicKey } from "@solana/web3.js";
import type BN from "bn.js";
import type { CwrVault } from "@cwr/abi";

export type ConfigState = IdlAccounts<CwrVault>["config"];
export type BucketState = IdlAccounts<CwrVault>["bucket"];
export type FeeScheduleState = IdlAccounts<CwrVault>["feeSchedule"];

/**
 * Input shape for `initBucket` / `setBucketParams`.
 *
 * Mirrors `programs/cwr-vault/src/state.rs` `BucketParams`. V5 added the
 * entry/exit/pull fee fields; all fees default to 0 + disabled so existing
 * call-sites that omit them get pre-V5 behaviour. The pull (volume) fee is
 * the only active monetisation in the V5 baseline product.
 */
export type BucketParamsInput = {
  performanceFeeBps: number;
  maxNavJumpUpBps: number;
  maxNavDropDownBps: number;
  minNavUpdateInterval: BN;
  minDeposit: BN;
  depositCap: BN;
  // V5
  entryFeeBps: number;
  exitFeeBps: number;
  entryFeeEnabled: boolean;
  exitFeeEnabled: boolean;
  /** V5 — per-`pull` volume fee in bps. Capped at MAX_PULL_FEE_BPS (500). */
  pullFeeBps: number;
  pullFeeEnabled: boolean;
};

/** A single entry in the genesis or year-one fee-distribution split. */
export type FeeRecipientInput = {
  recipient: PublicKey;
  bpsShare: number;
};

/** Default empty slot used to pad fee schedules up to MAX_FEE_RECIPIENTS. */
export const EMPTY_FEE_RECIPIENT = (PublicKeyZero: PublicKey): FeeRecipientInput => ({
  recipient: PublicKeyZero,
  bpsShare: 0,
});
