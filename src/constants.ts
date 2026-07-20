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
