import { PublicKey } from "@solana/web3.js";
import {
  BUCKET_SEED,
  CONFIG_SEED,
  ESCROW_SEED,
  SHARE_MINT_SEED,
  TREASURY_SEED,
  WITHDRAW_SEED,
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

export function findEscrow(programId: PublicKey, bucketId: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ESCROW_SEED, Buffer.from([bucketId])],
    programId,
  );
}

export function findWithdrawRequest(
  programId: PublicKey,
  bucketId: number,
  user: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [WITHDRAW_SEED, Buffer.from([bucketId]), user.toBuffer()],
    programId,
  );
}

export type BucketAddresses = {
  bucket: PublicKey;
  treasury: PublicKey;
  shareMint: PublicKey;
  escrow: PublicKey;
};

export function deriveBucketAddresses(
  programId: PublicKey,
  bucketId: number,
): BucketAddresses {
  return {
    bucket: findBucket(programId, bucketId)[0],
    treasury: findTreasury(programId, bucketId)[0],
    shareMint: findShareMint(programId, bucketId)[0],
    escrow: findEscrow(programId, bucketId)[0],
  };
}
