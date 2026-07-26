/**
 * Diamond Pools — canonical program ids, external ids, PDA seeds, and scalar
 * constants. Mirrors `contracts/programs/diamond_pools/src/constants.rs` 1:1 (and the
 * bankrun-proven `tests/dp/sdk.ts`). Do not drift these from the on-chain source.
 */
import { PublicKey } from "@solana/web3.js";

// ─── the diamond_pools program ───────────────────────────────────────────────
export const DIAMOND_POOLS_PROGRAM_ID = new PublicKey(
  "FMecQfZ1qbt87GNGVU1xNDnsFnHH78Dwz74qaTumSRsB",
);

// ─── external immutable ids (constants.rs §1) ────────────────────────────────
export const ORE_PROGRAM_ID = new PublicKey("oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv");
export const ORE_MINT = new PublicKey("oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp");
export const ORE_LST_PROGRAM_ID = new PublicKey("storeD7bEkywTTMrje19WRoyrkEhbhrvyjVnLxWih6a");
export const ORE_STAKE_PROGRAM_ID = new PublicKey("stakecNP3FpiExZPCgZfqRgumVzi6dNqnfrjwXyTgeH");
export const STORE_MINT = new PublicKey("storenSbvkfzircixnaosc5CbzNZVrHJ6S3EKrS1yqR");
export const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
/** Jupiter v6 — the approved SOL->ORE route for `crank_pp_convert_sol_to_ore`. The program pins
 *  this address on-chain, so passing anything else aborts the CPI. */
export const JUPITER_V6_PROGRAM_ID = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

// ─── decimals / scales (constants.rs) ────────────────────────────────────────
export const ORE_DECIMALS = 11;
export const STORE_DECIMALS = 11;
export const BPS_DENOMINATOR = 10_000;
export const MIN_LIQUIDITY_SHARES = 1_000n;
export const UORE_ACC_SCALE = 1_000_000_000_000_000_000n; // 1e18
export const NAV_SCALE = 1_000_000_000_000_000_000n; // 1e18
export const FS_SCALE_PPM = 1_000_000; // mining_fs_bps stored in ppm; fs=1.0 → 1_000_000

// Fee defaults and immutable ceilings.
export const DEFAULT_CLAIM_FEE_BPS = 1_000;
export const DEFAULT_ADMIN_FEE_BPS = 25;
export const DEFAULT_PP_SHARE_MINING_BPS = 5_000;
export const DEFAULT_PP_SHARE_STAKING_BPS = 5_000;
export const DEFAULT_ENTRY_FEE_MINING_BPS = 0;
export const DEFAULT_ENTRY_FEE_STAKING_BPS = 100;
export const DEFAULT_ENTRY_FEE_PROTOCOL_BPS = 0;
export const DEFAULT_FEE_RETAIN_BPS = 10_000;
export const MAX_ADMIN_FEE_BPS = 25;

// SPL layout offsets (for raw reads where needed)
export const SPL_TOKEN_ACCOUNT_OFF_AMOUNT = 64;
export const SPL_MINT_OFF_SUPPLY = 36;

// ─── pool ids (state.rs) ─────────────────────────────────────────────────────
export const POOL_MINING = 0;
export const POOL_STAKING = 1;
export const POOL_PROTOCOL = 2;
export type PoolId = typeof POOL_MINING | typeof POOL_STAKING | typeof POOL_PROTOCOL;

// ─── order kinds (state.rs) ──────────────────────────────────────────────────
export const ORDER_KIND_DEPOSIT = 0;
export const ORDER_KIND_WITHDRAW = 1;

// ─── window phases (state.rs) ────────────────────────────────────────────────
export const PHASE = {
  INTAKE: 0,
  FROZEN: 1,
  DEPOSITS: 2,
  MINING_EXITS: 3,
  STAKING_EXITS: 4,
  TREASURY_ADV: 5,
  PP_EXITS: 6,
  BATCH: 7,
  OPEN: 8,
} as const;

// ─── exit-delivery toggle (constants.rs) ─────────────────────────────────────
export const EXIT_DELIVERY_ORE = 0;
export const EXIT_DELIVERY_STORE = 1;

// ─── pp_deposit_mode (constants.rs §5.4) ─────────────────────────────────────
export const PP_DEPOSIT_MODE_DISABLED = 0;
export const PP_DEPOSIT_MODE_WHITELIST = 1;
export const PP_DEPOSIT_MODE_OPEN = 2;

// Protocol Pool access mode.
export const PP_MODE_WHITELIST = 0;
export const PP_MODE_PUBLIC = 1;

// Team Ops Treasury withdrawal assets.
export const FEE_ASSET_SOL = 0;
export const FEE_ASSET_STORE = 1;
export type FeeAsset = typeof FEE_ASSET_SOL | typeof FEE_ASSET_STORE;

// Generic per-wallet external-fee exemption scopes.
export const FEE_EXEMPT_SCOPE_EXTERNAL_DEPLOY = 1 << 0;
export const FEE_EXEMPT_SCOPE_PERF_FEE = 1 << 1;
export const FEE_EXEMPT_VALID_MASK =
  FEE_EXEMPT_SCOPE_EXTERNAL_DEPLOY | FEE_EXEMPT_SCOPE_PERF_FEE;

/** Stable `setParam` selectors. Values are append-only on-chain. */
export const CONFIG_FIELD = {
  CLAIM_FEE_BPS: 0,
  ADMIN_FEE_BPS: 1,
  PP_SHARE_MINING_BPS: 2,
  PP_SHARE_STAKING_BPS: 3,
  ENTRY_FEE_MINING_BPS: 4,
  ENTRY_FEE_STAKING_BPS: 5,
  ENTRY_FEE_PROTOCOL_BPS: 6,
  WINDOW_PERIOD_SECS: 7,
  EPOCH_LEN_WINDOWS: 8,
  PP_EXIT_NOTICE_WINDOWS: 9,
  ADVANCE_CAP_R_BPS: 10,
  TREASURY_ADVANCE_BUDGET_BPS: 11,
  PP_SOL_SLEEVE_MAX_BPS: 12,
  MAX_DEPLOY_PER_ROUND: 13,
  MAX_DEPLOY_PER_WINDOW: 14,
  MAX_PER_TILE: 15,
  MIN_TILES: 16,
  MAX_TILES: 17,
  BANKROLL_FLOOR: 18,
  MAX_DEPLOY_IXS_PER_CRANK: 19,
  GUARD_BAND_SLOTS: 20,
  CLAIM_GRANULARITY: 21,
  EXIT_DELIVERY_ASSET: 22,
  PP_MODE: 23,
  PP_DEPOSIT_MODE: 24,
  RUNG3_ENABLED: 25,
  MONETIZE_SHARE_BPS: 26,
  LITE_PHANTOM_ENABLED: 27,
  PHANTOM_DUST_CEILING_GRAMS: 28,
  CAP_BREACH_MAX_WINDOWS: 29,
  CAP_HARD_CEILING_BPS: 30,
  I10_FLOOR_BPS: 31,
  ST_TVL_CAP: 32,
  PP_SHORTFALL_CRYSTALLIZE_ENABLED: 33,
} as const;
export type ConfigField = (typeof CONFIG_FIELD)[keyof typeof CONFIG_FIELD];

// ─── emergency switches (set_emergency selector; constants.rs) ───────────────
export const EMERGENCY_MINING = 0;
export const EMERGENCY_STAKING = 1;
export const EMERGENCY_DEFENSIVE = 2;
export const EMERGENCY_WIND_DOWN = 3;

// ─── cosign / referral attestation domain tags (constants.rs) ───────────────
export const COSIGN_TAG = Buffer.from("DP_COSGN", "utf8");
export const REFERRAL_CLAIM_TAG = Buffer.from("DPREFCLM", "utf8");
export const REFERRAL_SWEEP_TAG = Buffer.from("DPREFSWP", "utf8");

// ─── PDA seeds (constants.rs §1) ─────────────────────────────────────────────
const S = (s: string) => Buffer.from(s, "utf8");
export const SEED = {
  config: S("config"),
  miningPool: S("mining_pool"),
  stakingPool: S("staking_pool"),
  protocolPool: S("protocol_pool"),
  position: S("position"),
  order: S("order"),
  window: S("window"),
  miningAuthority: S("mining_authority"),
  vault: S("vault"),
  feeBucket: S("fee_bucket"),
  feeSchedule: S("fee_schedule"),
  referralConfig: S("referral_config"),
  referralTreasury: S("referral_treasury"),
  referrer: S("referrer"),
  whitelist: S("whitelist"),
  feeExempt: S("fee_exempt"),
  phantomMember: S("phantom_member"),
  evacCustody: S("evac_custody"),
} as const;

// ORE / ore-lst seeds (for external PDA derivation)
export const ORE_SEED_MINER = S("miner");
export const ORE_SEED_BOARD = S("board");
export const ORE_SEED_TREASURY = S("treasury");
export const ORE_LST_SEED_VAULT = S("vault");
export const ORE_STAKE_SEED_STAKE = S("stake");

// ─── little-endian encoders (for window ids etc.) ────────────────────────────
export const u64le = (n: bigint | number): Buffer => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n.toString()));
  return b;
};
export const i64le = (n: bigint | number): Buffer => {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(BigInt(n.toString()));
  return b;
};
