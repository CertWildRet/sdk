/**
 * Diamond Pools PDA derivations. All program PDAs are auto-resolved by Anchor at
 * instruction-build time (the IDL embeds every seed), so callers rarely need these
 * directly — they are exported for read paths, account subscriptions, and tests.
 * Mirrors `tests/dp/sdk.ts` (bankrun-proven) 1:1.
 */
import { PublicKey } from "@solana/web3.js";
import {
  DIAMOND_POOLS_PROGRAM_ID, ORE_PROGRAM_ID, ORE_LST_PROGRAM_ID, ORE_STAKE_PROGRAM_ID,
  SEED, ORE_SEED_MINER, ORE_SEED_BOARD, ORE_SEED_TREASURY, ORE_LST_SEED_VAULT, ORE_STAKE_SEED_STAKE,
  u64le, PoolId,
} from "./constants";

const pda = (seeds: (Buffer | Uint8Array)[], programId = DIAMOND_POOLS_PROGRAM_ID): [PublicKey, number] =>
  PublicKey.findProgramAddressSync(seeds, programId);

// ─── singleton PDAs ──────────────────────────────────────────────────────────
export const pdaConfig = () => pda([SEED.config]);
export const pdaMiningPool = () => pda([SEED.miningPool]);
export const pdaStakingPool = () => pda([SEED.stakingPool]);
export const pdaProtocolPool = () => pda([SEED.protocolPool]);
export const pdaFeeSchedule = () => pda([SEED.feeSchedule]);
export const pdaReferralConfig = () => pda([SEED.referralConfig]);
export const pdaReferralTreasury = () => pda([SEED.referralTreasury]);
export const pdaMiningAuthority = () => pda([SEED.miningAuthority]);
export const pdaPhantomMember = () => pda([SEED.phantomMember]);
export const pdaEvacCustody = () => pda([SEED.evacCustody]);
export const pdaFeeBucket = () => pda([SEED.feeBucket]);

// ─── parameterized PDAs ──────────────────────────────────────────────────────
export const pdaWindow = (id: bigint | number) => pda([SEED.window, u64le(id)]);
export const pdaPosition = (poolId: PoolId, owner: PublicKey) =>
  pda([SEED.position, Buffer.from([poolId]), owner.toBuffer()]);
export const pdaOrder = (windowId: bigint | number, owner: PublicKey, poolId: PoolId, kind: number) =>
  pda([SEED.order, u64le(windowId), owner.toBuffer(), Buffer.from([poolId]), Buffer.from([kind])]);
export const pdaVault = (poolId: PoolId) => pda([SEED.vault, Buffer.from([poolId])]);
export const pdaReferrer = (referrer: PublicKey) => pda([SEED.referrer, referrer.toBuffer()]);
export const pdaWhitelist = (wallet: PublicKey) => pda([SEED.whitelist, wallet.toBuffer()]);
export const pdaFeeExempt = (wallet: PublicKey) => pda([SEED.feeExempt, wallet.toBuffer()]);

// ─── ORE-side PDAs (external programs; needed for freeze / mine / self-claim exits) ──
export const oreMinerPda = (authority: PublicKey) =>
  pda([ORE_SEED_MINER, authority.toBuffer()], ORE_PROGRAM_ID);
export const oreBoardPda = () => pda([ORE_SEED_BOARD], ORE_PROGRAM_ID);
export const oreTreasuryPda = () => pda([ORE_SEED_TREASURY], ORE_PROGRAM_ID);
export const oreLstVaultPda = () => pda([ORE_LST_SEED_VAULT], ORE_LST_PROGRAM_ID);
export const oreStakeStakePda = () =>
  pda([ORE_STAKE_SEED_STAKE, oreLstVaultPda()[0].toBuffer()], ORE_STAKE_PROGRAM_ID);

/** The mining authority's ORE Miner PDA (its checkpoint/deploy target). */
export const miningAuthorityMinerPda = () => oreMinerPda(pdaMiningAuthority()[0]);
