import BN from "bn.js";

/**
 * Canonical CWR bucket IDs. Names mirror the V1 "Simple/Refined/Ultra" rename
 * (2026-05-22) but the legacy ergonomic aliases `Liquid/Staked/Locked` are kept
 * as numeric synonyms so older brain/frontend code keeps building.
 */
export enum Bucket {
  Simple = 0,
  Refined = 1,
  Ultra = 2,
  // Legacy aliases — same numeric values, kept for backwards-compat.
  Liquid = 0,
  Staked = 1,
  Locked = 2,
}

export const BUCKET_LABELS: Record<number, string> = {
  0: "simple",
  1: "refined",
  2: "ultra",
};

export const CONFIG_SEED = Buffer.from("config");
export const BUCKET_SEED = Buffer.from("bucket");
export const TREASURY_SEED = Buffer.from("treasury");
export const SHARE_MINT_SEED = Buffer.from("share_mint");
// V5 fee model
export const FEE_SCHEDULE_SEED = Buffer.from("fee_schedule");
export const FEE_BUCKET_SEED = Buffer.from("fee_bucket");
// V5 stORE basket payout
export const STORE_TREASURY_SEED = Buffer.from("store_treasury");

export const NAV_SCALE = new BN("1000000000000000000");
export const BPS_DENOMINATOR = new BN(10_000);

export const SHARE_DECIMALS = 9;
export const MAX_BUCKETS = 64;
export const MAX_FEE_RECIPIENTS = 4;
export const MAX_ENTRY_FEE_BPS = 500;
export const MAX_EXIT_FEE_BPS = 500;
export const YEAR_ONE_SWITCHOVER_SECS = 365 * 86_400;
