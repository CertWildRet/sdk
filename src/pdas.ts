import { PublicKey } from "@solana/web3.js";
import {
  BUCKET_SEED,
  CONFIG_SEED,
  FEE_BUCKET_SEED,
  FEE_SCHEDULE_SEED,
  SHARE_MINT_SEED,
  STORE_TREASURY_SEED,
  TREASURY_SEED,
} from "./constants";

export function findConfig(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([CONFIG_SEED], programId);
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
