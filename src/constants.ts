import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";

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

// ─── V6 non-custodial mining ────────────────────────────────────────────
/** Seed for the per-bucket mining authority PDA: PDA([MINING_SEED, bucket_id]). */
export const MINING_SEED = Buffer.from("mining");
/** Seed for the per-user Position PDA: PDA([POSITION_SEED, bucket_id, user]). */
export const POSITION_SEED = Buffer.from("position");

// ─── Parked-capital buffer (deposit while cranking) ──────────────────────
/** Per-bucket buffer state PDA: PDA([PENDING_STATE_SEED, bucket_id]). */
export const PENDING_STATE_SEED = Buffer.from("pending_state");
/** Per-bucket escrow PDA holding parked SOL: PDA([PENDING_TREASURY_SEED, bucket_id]). */
export const PENDING_TREASURY_SEED = Buffer.from("pending_treasury");
/** Per-user parked-deposit ticket: PDA([PENDING_SEED, bucket_id, owner]). */
export const PENDING_SEED = Buffer.from("pending");

// ─── External program ids (V6 non-custodial mining CPI targets) ──────────
// VERIFIED on-chain constants — must match programs/cwr-vault/src/constants.rs
// EXACTLY. A wrong id is a runtime CPI failure on mainnet.

/** The ORE program (board v3 mining model). */
export const ORE_PROGRAM_ID = new PublicKey(
  "oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv",
);
/** The ore-lst program (wraps ORE -> stORE). */
export const ORE_LST_PROGRAM_ID = new PublicKey(
  "LStwN2E5Uw6MCtuxHRLhy8RY9hxqW2XRpLzettb696y",
);
/** The ore-stake program (holds the stake/treasury/vesting PDAs for ore-lst). */
export const ORE_STAKE_PROGRAM_ID = new PublicKey(
  "STkEAu2cEyQp5ktgUauRVq8es6mEP2w6ixw4NEd5tDJ",
);
/** The Entropy program (touched by ORE Deploy on the first deploy of a round). */
export const ENTROPY_PROGRAM_ID = new PublicKey(
  "3jSkUuYBoJzQPMEzTvkDFXCZUBksPamrVhrnHR9igu2X",
);
/** The singleton Entropy `var` account. Passed as-is in `crank_mine`. */
export const ENTROPY_VAR = new PublicKey(
  "BWCaDY96Xe4WkFq1M7UiCCRcChsJ3p51L5KrGzhxgm2E",
);

/** The ORE token mint (SPL Token, 11 decimals). */
export const ORE_MINT = new PublicKey(
  "oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp",
);
/** The stORE token mint (SPL Token, 11 decimals). */
export const STORE_MINT = new PublicKey(
  "sTorERYB6xAZ1SSbwpK3zoK2EEwbBrc7TZAzg1uCGiH",
);

/** ORE PDA seeds (all under ORE_PROGRAM_ID). */
export const ORE_SEED_MINER = Buffer.from("miner");
export const ORE_SEED_BOARD = Buffer.from("board");
export const ORE_SEED_CONFIG = Buffer.from("config");
export const ORE_SEED_ROUND = Buffer.from("round");
export const ORE_SEED_TREASURY = Buffer.from("treasury");
export const ORE_SEED_AUTOMATION = Buffer.from("automation");

/** ore-lst PDA seed (under ORE_LST_PROGRAM_ID). */
export const ORE_LST_SEED_VAULT = Buffer.from("vault");
/** ore-stake PDA seeds (all under ORE_STAKE_PROGRAM_ID). */
export const ORE_STAKE_SEED_STAKE = Buffer.from("stake");
export const ORE_STAKE_SEED_TREASURY = Buffer.from("treasury");
export const ORE_STAKE_SEED_VESTING = Buffer.from("vesting");

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
export const ADMIN_TRANSFER_CONFIRMER = new PublicKey(
  "9T6bE4qzmnSzLgH9LFuV5S5wLab5QTtMBcvREg5gWBUb",
);

/** Lamports the confirmer must deposit on `confirm_admin_transfer`.
 *  Routed to the global fee_bucket; not burned. */
export const ADMIN_TRANSFER_CONFIRMATION_LAMPORTS = new BN(100_000_000);

/** Seconds within which `confirm_admin_transfer` + `accept_admin` must
 *  occur after the original `propose_admin` call (else the proposal
 *  silently expires and must be re-proposed). */
export const ADMIN_TRANSFER_TIMEOUT_SECS = 86_400; // 24 hours
