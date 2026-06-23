import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
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
  SHARE_MINT_SEED,
  STORE_TREASURY_SEED,
  TREASURY_SEED,
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

/** V5 — per-bucket stORE-holding token account (authority = bucket PDA). */
export function findStoreTreasury(
  programId: PublicKey,
  bucketId: number,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [STORE_TREASURY_SEED, Buffer.from([bucketId])],
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
// External ORE / ore-lst / ore-stake PDAs — these MUST mirror
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
