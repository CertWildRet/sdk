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
  // Legacy aliases - same numeric values, kept for backwards-compat.
  Liquid = 0,
  Staked = 1,
  Locked = 2,
  // Diamond Pools product aliases. Bucket 0 = dORE (ORE exposure),
  // bucket 1 = dZINC (ZINC exposure). Same numeric values as Simple/Refined.
  DOre = 0,
  Zinc = 1,
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
// V2 stORE reserve (post 2026-06-15 ore-stake-hack migration; NEW mint).
export const STORE_TREASURY_V2_SEED = Buffer.from("store_treasury_v2");

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

/** Per-bucket queued-exit state PDA: PDA([PENDING_WITHDRAW_STATE_SEED, bucket_id]). */
export const PENDING_WITHDRAW_STATE_SEED = Buffer.from("pending_withdraw_state");
/** Per-bucket SPL escrow of queued share tokens: PDA([PENDING_SHARES_SEED, bucket_id]). */
export const PENDING_SHARES_SEED = Buffer.from("pending_shares");
/** Per-user queued-exit tickets, seed-split by bucket flavor. */
export const PENDING_WITHDRAW_ORE_SEED = Buffer.from("pending_withdraw_ore");
export const PENDING_WITHDRAW_ZINC_SEED = Buffer.from("pending_withdraw_zinc");

// ─── Referral program ────────────────────────────────────────────────────
/** Global referral config PDA: PDA([REFERRAL_CONFIG_SEED]). */
export const REFERRAL_CONFIG_SEED = Buffer.from("referral_config");
/** Global referral escrow PDA (the bounded payout pool): PDA([REFERRAL_TREASURY_SEED]). */
export const REFERRAL_TREASURY_SEED = Buffer.from("referral_treasury");
/** Per-referrer claim-watermark PDA: PDA([REFERRER_SEED, referrer]). */
export const REFERRER_SEED = Buffer.from("referrer");
/** Fixed referral carve (bps of gross deploy volume) and the pull-fee ceiling. */
export const REFERRAL_BPS = 10;
export const REFERRAL_PULL_FEE_BPS = 110;

// ─── External program ids (V6 non-custodial mining CPI targets) ──────────
// VERIFIED on-chain constants - must match programs/cwr-vault/src/constants.rs
// EXACTLY. A wrong id is a runtime CPI failure on mainnet.

/** The ORE program (board v3 mining model). */
export const ORE_PROGRAM_ID = new PublicKey(
  "oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv",
);
/** The ore-lst program (wraps ORE -> stORE). */
export const ORE_LST_PROGRAM_ID = new PublicKey(
  "storeD7bEkywTTMrje19WRoyrkEhbhrvyjVnLxWih6a",
);
/** The ore-stake program (holds the stake/treasury/vesting PDAs for ore-lst). */
export const ORE_STAKE_PROGRAM_ID = new PublicKey(
  "stakecNP3FpiExZPCgZfqRgumVzi6dNqnfrjwXyTgeH",
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
  "storenSbvkfzircixnaosc5CbzNZVrHJ6S3EKrS1yqR",
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

// ─── dZINC pool (bucket 1) ──────────────────────────────────────────────
// cwr-program seeds for the dZINC sidecar PDAs (under `programId`).
/** Per-bucket dZINC pool sidecar PDA: PDA([ZINC_POOL_SEED, bucket_id]). */
export const ZINC_POOL_SEED = Buffer.from("zinc_pool");
/** Per-user dZINC position PDA: PDA([ZINC_POSITION_SEED, bucket_id, owner]). */
export const ZINC_POSITION_SEED = Buffer.from("zinc_position");

// ─── ZINC (zinc.cash) external program ids + pinned accounts ─────────────
// VERIFIED on-chain - must match programs/cwr-vault/src/zinc_cpi.rs EXACTLY
// (pinned from the ZINC handover, live 2026-06-25). A wrong id is a runtime
// CPI failure on mainnet. ZINC is NOT Anchor (Codama-generated, no on-chain
// IDL); like ORE we derive its PDAs by hand from the decoded seeds.

/** The ZINC program id (board mining model; CPI target + affiliate=None sentinel). */
export const ZINC_PROGRAM_ID = new PublicKey(
  "zincUFpnqYwdYMc1KfH6rKcBvbcdVtHKckKhvrHLDsV",
);
/** The ZINC token mint (classic SPL Token, 9 decimals). */
export const ZINC_MINT = new PublicKey(
  "zinc155BS4mSPk8GXQj4R5hkVDQXcW253pTYq5SGyfi",
);
/** ZINC global config PDA (pinned). */
export const ZINC_CONFIG = new PublicKey(
  "48W7ZVgfdqmpVfTxdoRKuVg7gqGk5GHF3QpmxhHCUieG",
);
/** ZINC board PDA (active_round_id / next_round_id). */
export const ZINC_BOARD = new PublicKey(
  "DnryjThdeJbK4qfrVooTPRgWcjgAnQ5cVm2pF5mbeCeF",
);
/** ZINC treasury PDA (supply state; also the Unstake out-transfer authority). */
export const ZINC_TREASURY = new PublicKey(
  "4Ucw8BNkLWBu6gxkQsw3BRG2qRtw5WrG1UxiKpQjScH5",
);
/** Classic SPL Token program (the ZINC mint is a classic Token mint, NOT
 *  Token-2022). Used for the ZINC custody / user ATAs. */
export const ZINC_TOKEN_PROGRAM = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
/** The Associated Token Account program ZINC ATAs are derived under. */
export const ZINC_ATA_PROGRAM = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

/** ZINC PDA seeds (all under ZINC_PROGRAM_ID), verbatim from zinc_cpi.rs. */
export const ZINC_SEED_ROUND = Buffer.from("round");
export const ZINC_SEED_MINER = Buffer.from("miner");
export const ZINC_SEED_PLAYER_PROFILE = Buffer.from("player-profile");
export const ZINC_SEED_STOCKPILE_SOL_VAULT = Buffer.from("stockpile-sol-vault");
export const ZINC_SEED_BONANZA_SOL_VAULT = Buffer.from("bonanza-sol-vault");
export const ZINC_SEED_BUYBACK_SOL_VAULT = Buffer.from("buyback-sol-vault");
/** Two-part seed for the round-zinc-reward token account:
 *  PDA([b"treasury", b"round-zinc-reward-token-account"], ZINC_PROGRAM_ID). */
export const ZINC_SEED_TREASURY = Buffer.from("treasury");
export const ZINC_SEED_ROUND_REWARD_TA = Buffer.from(
  "round-zinc-reward-token-account",
);

/** ZINC staking + stockpile PDA seeds (v1.2.0), verbatim from zinc_cpi.rs. */
export const ZINC_SEED_STAKE_POSITION = Buffer.from("stake-position");
/** Second half of PDA([b"treasury", b"staking-token-account"]). */
export const ZINC_SEED_STAKING_TA = Buffer.from("staking-token-account");
/** Second half of PDA([b"treasury", b"staking-reward-token-account"]). */
export const ZINC_SEED_STAKING_REWARD_TA = Buffer.from(
  "staking-reward-token-account",
);
export const ZINC_SEED_STOCKPILE = Buffer.from("stockpile");
export const ZINC_SEED_STOCKPILE_WINNERS = Buffer.from("stockpile-winners");
export const ZINC_SEED_STOCKPILE_EXTRAS = Buffer.from("stockpile-extras");
/** Second half of PDA([b"treasury", b"stockpile-token-account"]). */
export const ZINC_SEED_STOCKPILE_TA = Buffer.from("stockpile-token-account");

/** config.min_deploy_lamports (live 0.05 SOL) - per-ROUND floor, NOT per-tile. */
export const ZINC_MIN_DEPLOY_LAMPORTS = new BN(50_000_000);

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
