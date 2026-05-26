import BN from "bn.js";

export enum Bucket {
  Liquid = 0,
  Staked = 1,
  Locked = 2,
}

export const BUCKET_LABELS: Record<Bucket, string> = {
  [Bucket.Liquid]: "liquid",
  [Bucket.Staked]: "staked",
  [Bucket.Locked]: "locked",
};

export const CONFIG_SEED = Buffer.from("config");
export const BUCKET_SEED = Buffer.from("bucket");
export const TREASURY_SEED = Buffer.from("treasury");
export const SHARE_MINT_SEED = Buffer.from("share_mint");
export const ESCROW_SEED = Buffer.from("escrow");
export const WITHDRAW_SEED = Buffer.from("withdraw");

export const NAV_SCALE = new BN("1000000000000000000");
export const BPS_DENOMINATOR = new BN(10_000);

export const SHARE_DECIMALS = 9;
export const MAX_BUCKETS = 8;
