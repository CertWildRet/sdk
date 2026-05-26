import type { IdlAccounts } from "@coral-xyz/anchor";
import type { CwrVault } from "@cwr/abi";

export type ConfigState = IdlAccounts<CwrVault>["config"];
export type BucketState = IdlAccounts<CwrVault>["bucket"];
export type WithdrawRequestState = IdlAccounts<CwrVault>["withdrawRequest"];

export type BucketParamsInput = {
  lockupSeconds: import("bn.js");
  performanceFeeBps: number;
  maxNavJumpUpBps: number;
  maxNavDropDownBps: number;
  minNavUpdateInterval: import("bn.js");
  minDeposit: import("bn.js");
  depositCap: import("bn.js");
};
