import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  BUCKET_SEED,
  CONFIG_SEED,
  FEE_BUCKET_SEED,
  FEE_SCHEDULE_SEED,
  MINING_SEED,
  PENDING_SEED,
  PENDING_STATE_SEED,
  PENDING_TREASURY_SEED,
  ORE_LST_PROGRAM_ID,
  ORE_LST_SEED_VAULT,
  ORE_PROGRAM_ID,
  ORE_SEED_AUTOMATION,
  ORE_SEED_BOARD,
  ORE_SEED_CONFIG,
  ORE_SEED_MINER,
  ORE_SEED_ROUND,
  ORE_SEED_TREASURY,
  ORE_STAKE_PROGRAM_ID,
  ORE_STAKE_SEED_STAKE,
  ORE_STAKE_SEED_TREASURY,
  ORE_STAKE_SEED_VESTING,
  POSITION_SEED,
  REFERRAL_CONFIG_SEED,
  REFERRAL_TREASURY_SEED,
  REFERRER_SEED,
  SHARE_MINT_SEED,
  STORE_TREASURY_V2_SEED,
  TREASURY_SEED,
  ZINC_ATA_PROGRAM,
  ZINC_MINT,
  ZINC_POOL_SEED,
  ZINC_POSITION_SEED,
  ZINC_PROGRAM_ID,
  ZINC_SEED_BONANZA_SOL_VAULT,
  ZINC_SEED_BUYBACK_SOL_VAULT,
  ZINC_SEED_MINER,
  ZINC_SEED_PLAYER_PROFILE,
  ZINC_SEED_ROUND,
  ZINC_SEED_ROUND_REWARD_TA,
  ZINC_SEED_STOCKPILE_SOL_VAULT,
  ZINC_SEED_STAKE_POSITION,
  ZINC_SEED_STAKING_TA,
  ZINC_SEED_STAKING_REWARD_TA,
  ZINC_SEED_STOCKPILE,
  ZINC_SEED_STOCKPILE_WINNERS,
  ZINC_SEED_STOCKPILE_EXTRAS,
  ZINC_SEED_STOCKPILE_TA,
  ZINC_SEED_TREASURY,
  ZINC_TOKEN_PROGRAM,
} from "./constants";

export function findConfig(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([CONFIG_SEED], programId);
}

/**
 * External-audit hardening (2026-06): derive the BPFLoaderUpgradeable
 * ProgramData PDA for a given program id. Required by `initialize()` so
 * the contract can verify the caller is the upgrade authority.
 */
const BPF_LOADER_UPGRADEABLE = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);
export function deriveProgramData(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    BPF_LOADER_UPGRADEABLE,
  )[0];
}

export function findBucket(programId: PublicKey, bucketId: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [BUCKET_SEED, Buffer.from([bucketId])],
    programId,
  );
}

export function findTreasury(programId: PublicKey, bucketId: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [TREASURY_SEED, Buffer.from([bucketId])],
    programId,
  );
}

export function findShareMint(programId: PublicKey, bucketId: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SHARE_MINT_SEED, Buffer.from([bucketId])],
    programId,
  );
}

export function findFeeSchedule(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([FEE_SCHEDULE_SEED], programId);
}

export function findFeeBucket(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([FEE_BUCKET_SEED], programId);
}

/** V5 - per-bucket stORE-holding token account (authority = bucket PDA). */
export function findStoreTreasury(
  programId: PublicKey,
  bucketId: number,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [STORE_TREASURY_V2_SEED, Buffer.from([bucketId])],
    programId,
  );
}

export type BucketAddresses = {
  bucket: PublicKey;
  treasury: PublicKey;
  shareMint: PublicKey;
  storeTreasury: PublicKey;
};

export function deriveBucketAddresses(
  programId: PublicKey,
  bucketId: number,
): BucketAddresses {
  return {
    bucket: findBucket(programId, bucketId)[0],
    treasury: findTreasury(programId, bucketId)[0],
    shareMint: findShareMint(programId, bucketId)[0],
    storeTreasury: findStoreTreasury(programId, bucketId)[0],
  };
}

// ════════════════════════════════════════════════════════════════════════
// V6 non-custodial mining PDAs.
//
// cwr-program PDAs (under `programId`):
//   - mining authority: PDA([MINING_SEED, bucket_id])
//   - position:         PDA([POSITION_SEED, bucket_id, user])
//
// External ORE / ore-lst / ore-stake PDAs - these MUST mirror
// programs/cwr-vault/src/ore_cpi.rs EXACTLY. A wrong seed/program is a
// runtime CPI failure on mainnet.
// ════════════════════════════════════════════════════════════════════════

/** Per-bucket mining authority PDA (== `bucket.mining_authority`). SOL source
 *  + signer of all ORE/ore-lst CPIs. */
export function findMiningAuthority(
  programId: PublicKey,
  bucketId: number,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [MINING_SEED, Buffer.from([bucketId])],
    programId,
  );
}

/** Per-user Position PDA (V6 share + stORE-debt watermark accounting). */
export function findPosition(
  programId: PublicKey,
  bucketId: number,
  user: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [POSITION_SEED, Buffer.from([bucketId]), user.toBuffer()],
    programId,
  );
}

// ─── Parked-capital buffer PDAs (deposit while cranking) ─────────────────

/** Per-bucket buffer state PDA (== pending_total + pending_count counter). */
export function findPendingState(
  programId: PublicKey,
  bucketId: number,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [PENDING_STATE_SEED, Buffer.from([bucketId])],
    programId,
  );
}

/** Per-bucket escrow PDA holding parked SOL (separate from `treasury`). */
export function findPendingTreasury(
  programId: PublicKey,
  bucketId: number,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [PENDING_TREASURY_SEED, Buffer.from([bucketId])],
    programId,
  );
}

/** Per-user parked-deposit ticket PDA. */
export function findPendingDeposit(
  programId: PublicKey,
  bucketId: number,
  owner: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [PENDING_SEED, Buffer.from([bucketId]), owner.toBuffer()],
    programId,
  );
}

// ─── Referral program PDAs ──────────────────────────────────────────────

/** Global referral config PDA (settlement authority + treasury bump + swept). */
export function findReferralConfig(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([REFERRAL_CONFIG_SEED], programId);
}

/** Global referral escrow PDA - the bounded payout pool (10 bps carve). */
export function findReferralTreasury(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([REFERRAL_TREASURY_SEED], programId);
}

/** Per-referrer claim-watermark PDA. */
export function findReferrerState(
  programId: PublicKey,
  referrer: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [REFERRER_SEED, referrer.toBuffer()],
    programId,
  );
}

// ─── ORE program PDAs (mirror ore_cpi.rs) ───────────────────────────────

/** ORE Miner PDA for a mining authority (== `bucket.ore_miner`). */
export function oreMinerPda(miningAuthority: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ORE_SEED_MINER, miningAuthority.toBuffer()],
    ORE_PROGRAM_ID,
  );
}

/** ORE board PDA (singleton). */
export function oreBoardPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([ORE_SEED_BOARD], ORE_PROGRAM_ID);
}

/** ORE config PDA (singleton). */
export function oreConfigPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([ORE_SEED_CONFIG], ORE_PROGRAM_ID);
}

/** ORE treasury PDA (singleton). */
export function oreTreasuryPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([ORE_SEED_TREASURY], ORE_PROGRAM_ID);
}

/** ORE automation PDA for a mining authority. */
export function oreAutomationPda(miningAuthority: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ORE_SEED_AUTOMATION, miningAuthority.toBuffer()],
    ORE_PROGRAM_ID,
  );
}

/** ORE round PDA for a given round id (u64 LE). */
export function oreRoundPda(roundId: BN): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ORE_SEED_ROUND, roundId.toArrayLike(Buffer, "le", 8)],
    ORE_PROGRAM_ID,
  );
}

// ─── ore-lst / ore-stake PDAs (mirror ore_cpi.rs) ───────────────────────

/** ore-lst vault PDA. Derives to 7taXpXz6eqYzscXEi1d1fgwATQMqAR6Nku9pJCjb8gQN. */
export function oreLstVaultPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ORE_LST_SEED_VAULT],
    ORE_LST_PROGRAM_ID,
  );
}

/** ore-stake stake PDA (seeds [b"stake", vault]). Derives to
 *  DfdZYzgLuqRickq57fyb4dX88VgPkhoEs1uuBKdxzaaJ for the mainnet vault. */
export function oreStakeStakePda(vault: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ORE_STAKE_SEED_STAKE, vault.toBuffer()],
    ORE_STAKE_PROGRAM_ID,
  );
}

/** ore-stake treasury PDA. Derives to ANX3pRkcGipsZjcWVBvRaHFasBMw8FDPBvJHoubpWym6. */
export function oreStakeTreasuryPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ORE_STAKE_SEED_TREASURY],
    ORE_STAKE_PROGRAM_ID,
  );
}

/** ore-stake vesting PDA (Wrap account [12], re-added Jun-17-2026).
 *  MUST derive to 8QSVpUWkRBmX6yUdAqUCcaZzj6JwNJoctSRcR1AYE8f3. */
export function oreStakeVestingPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ORE_STAKE_SEED_VESTING],
    ORE_STAKE_PROGRAM_ID,
  );
}

// ════════════════════════════════════════════════════════════════════════
// dZINC pool (bucket 1) PDAs.
//
// cwr-program PDAs (under `programId`):
//   - zinc pool:     PDA([ZINC_POOL_SEED, bucket_id])
//   - zinc position: PDA([ZINC_POSITION_SEED, bucket_id, owner])
//
// External ZINC PDAs - these MUST mirror programs/cwr-vault/src/zinc_cpi.rs
// EXACTLY. A wrong seed/program is a runtime CPI failure on mainnet. ZINC is
// not an Anchor program, so none of these are auto-resolvable by the IDL.
// ════════════════════════════════════════════════════════════════════════

/** Per-bucket dZINC pool sidecar PDA (== the ZincPool account). */
export function zincPoolPda(
  programId: PublicKey,
  bucketId: number,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ZINC_POOL_SEED, Buffer.from([bucketId])],
    programId,
  );
}

/** Per-user dZINC position PDA (reward-debt watermark + carried grams). */
export function zincPositionPda(
  programId: PublicKey,
  bucketId: number,
  owner: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ZINC_POSITION_SEED, Buffer.from([bucketId]), owner.toBuffer()],
    programId,
  );
}

// ─── External ZINC program PDAs (mirror zinc_cpi.rs) ─────────────────────

/** ZINC round PDA for a given round id (u64 LE): PDA([b"round", round_id]). */
export function zincRoundPda(roundId: BN): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ZINC_SEED_ROUND, roundId.toArrayLike(Buffer, "le", 8)],
    ZINC_PROGRAM_ID,
  );
}

/** ZINC miner PDA for a (round_id, player): PDA([b"miner", round_id, player]).
 *  `player` is the per-bucket mining authority PDA. */
export function zincMinerPda(
  roundId: BN,
  player: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ZINC_SEED_MINER, roundId.toArrayLike(Buffer, "le", 8), player.toBuffer()],
    ZINC_PROGRAM_ID,
  );
}

/** ZINC round-bonus PDA for a round: PDA([b"round-bonus", round_id]). Required
 *  by close_miner (readonly account 4). */
export function zincRoundBonusPda(roundId: BN): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("round-bonus"), roundId.toArrayLike(Buffer, "le", 8)],
    ZINC_PROGRAM_ID,
  );
}

/** ZINC player-profile PDA for a player: PDA([b"player-profile", player]). */
export function zincPlayerProfilePda(player: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ZINC_SEED_PLAYER_PROFILE, player.toBuffer()],
    ZINC_PROGRAM_ID,
  );
}

/** ZINC stockpile SOL vault PDA (singleton): PDA([b"stockpile-sol-vault"]). */
export function zincStockpileSolVaultPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ZINC_SEED_STOCKPILE_SOL_VAULT],
    ZINC_PROGRAM_ID,
  );
}

/** ZINC bonanza SOL vault PDA (singleton): PDA([b"bonanza-sol-vault"]). */
export function zincBonanzaSolVaultPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ZINC_SEED_BONANZA_SOL_VAULT],
    ZINC_PROGRAM_ID,
  );
}

/** ZINC buyback SOL vault PDA (singleton): PDA([b"buyback-sol-vault"]). */
export function zincBuybackSolVaultPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ZINC_SEED_BUYBACK_SOL_VAULT],
    ZINC_PROGRAM_ID,
  );
}

/** ZINC staking SOL-reward vault PDA (singleton; source of the stZINC SOL-yield
 *  leg): PDA([b"staking-sol-reward-vault"]) == 4xzryReuJRamP4zKEdJagsWQaCYQQvN7aT64LFmu2b4A. */
export function zincStakingSolRewardVaultPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("staking-sol-reward-vault")],
    ZINC_PROGRAM_ID,
  );
}

/** ZINC round-zinc-reward token account PDA (smelt source):
 *  PDA([b"treasury", b"round-zinc-reward-token-account"]). */
export function zincRoundRewardTokenAccountPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ZINC_SEED_TREASURY, ZINC_SEED_ROUND_REWARD_TA],
    ZINC_PROGRAM_ID,
  );
}

/**
 * The dZINC custody ATA = ATA(mining_authority, ZINC_MINT) under the CLASSIC
 * SPL token program (the ZINC mint is a classic Token mint, not Token-2022).
 * This is the smelt destination + in-kind withdraw source. `allowOwnerOffCurve`
 * is true because the owner is a PDA. Mirrors zinc_cpi::zinc_player_ata.
 */
export function zincCustodyAta(miningAuthority: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(
    ZINC_MINT,
    miningAuthority,
    true,
    ZINC_TOKEN_PROGRAM,
    ZINC_ATA_PROGRAM,
  );
}

/** A holder's own ZINC ATA (classic SPL token program). The in-kind
 *  withdraw_zinc payout destination. */
export function zincUserAta(owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(
    ZINC_MINT,
    owner,
    false,
    ZINC_TOKEN_PROGRAM,
    ZINC_ATA_PROGRAM,
  );
}

// ─── ZINC staking + Stockpile PDAs (v1.2.0; mirror zinc_cpi.rs) ──────────

/** The pool's single StakePosition PDA (mining_authority IS the staker):
 *  PDA([b"stake-position", authority]). */
export function zincStakePositionPda(authority: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ZINC_SEED_STAKE_POSITION, authority.toBuffer()],
    ZINC_PROGRAM_ID,
  );
}

/** ZINC pooled staking token account (restake dest / unstake source):
 *  PDA([b"treasury", b"staking-token-account"]). */
export function zincStakingTokenAccountPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ZINC_SEED_TREASURY, ZINC_SEED_STAKING_TA],
    ZINC_PROGRAM_ID,
  );
}

/** ZINC staking-reward token account (yield source):
 *  PDA([b"treasury", b"staking-reward-token-account"]). */
export function zincStakingRewardTokenAccountPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ZINC_SEED_TREASURY, ZINC_SEED_STAKING_REWARD_TA],
    ZINC_PROGRAM_ID,
  );
}

/** The Stockpile PDA for a cycle id: PDA([b"stockpile", stockpile_id]). */
export function zincStockpilePda(stockpileId: BN): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ZINC_SEED_STOCKPILE, stockpileId.toArrayLike(Buffer, "le", 8)],
    ZINC_PROGRAM_ID,
  );
}

/** The StockpileWinners PDA for a cycle id:
 *  PDA([b"stockpile-winners", stockpile_id]). */
export function zincStockpileWinnersPda(stockpileId: BN): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ZINC_SEED_STOCKPILE_WINNERS, stockpileId.toArrayLike(Buffer, "le", 8)],
    ZINC_PROGRAM_ID,
  );
}

/** The stockpile-extras PDA (singleton): PDA([b"stockpile-extras"]). */
export function zincStockpileExtrasPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ZINC_SEED_STOCKPILE_EXTRAS],
    ZINC_PROGRAM_ID,
  );
}

/** ZINC stockpile token account (entry-fee dest):
 *  PDA([b"treasury", b"stockpile-token-account"]). */
export function zincStockpileTokenAccountPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ZINC_SEED_TREASURY, ZINC_SEED_STOCKPILE_TA],
    ZINC_PROGRAM_ID,
  );
}
