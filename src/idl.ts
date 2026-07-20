/**
 * The diamond_pools IDL + program type, re-exported from @diamond/abi (the single source
 * of truth, synced from the on-chain build). The SDK builds an Anchor `Program` from
 * this; every account PDA is auto-resolved because the IDL embeds each seed.
 */
import type { Program } from "@coral-xyz/anchor";
import { DIAMOND_POOLS_IDL, DIAMOND_POOLS_PROGRAM_IDS } from "@diamond/abi";
import type { DiamondPools } from "@diamond/abi";

export { DIAMOND_POOLS_IDL, DIAMOND_POOLS_PROGRAM_IDS };
export type { DiamondPools };
export type DiamondPoolsProgram = Program<DiamondPools>;
