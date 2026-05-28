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
 * Mirrors `programs/cwr-vault/src/state.rs` `BucketParams`. V5 added the four
 * `entry_fee_*` / `exit_fee_*` fields; all fees default to 0 + disabled so
 * existing call-sites that omit them get pre-V5 behaviour.
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
