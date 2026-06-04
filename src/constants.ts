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

// ─── Two-step admin handover (2026-06) ──────────────────────────────────

/** Pubkey hardcoded into the on-chain contract. The only signer allowed
 *  to invoke `confirm_admin_transfer`. Held offline by the protocol
 *  owner; never published anywhere except in this constant. */
export const ADMIN_TRANSFER_CONFIRMER = new (require("@solana/web3.js").PublicKey)(
  "9T6bE4qzmnSzLgH9LFuV5S5wLab5QTtMBcvREg5gWBUb",
);

/** Lamports the confirmer must deposit on `confirm_admin_transfer`.
 *  Routed to the global fee_bucket; not burned. */
export const ADMIN_TRANSFER_CONFIRMATION_LAMPORTS = new BN(100_000_000);

/** Seconds within which `confirm_admin_transfer` + `accept_admin` must
 *  occur after the original `propose_admin` call (else the proposal
 *  silently expires and must be re-proposed). */
export const ADMIN_TRANSFER_TIMEOUT_SECS = 86_400; // 24 hours
