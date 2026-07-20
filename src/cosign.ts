/**
 * Admin cosign (Ed25519 fee-holder second factor) + referral settlement-authority
 * attestations. Cosigned admin ixs must be bundled AS `[ed25519Ix, adminIx]` in one
 * transaction; the program reads the Ed25519 instruction from the instructions sysvar
 * and checks it binds the exact ix (data ‖ account pubkeys), the current nonce, and a
 * fresh timestamp. Mirrors `tests/dp/flows.ts` (bankrun-proven).
 */
import { Ed25519Program, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { createHash } from "crypto";
import {
  DIAMOND_POOLS_PROGRAM_ID, COSIGN_TAG, REFERRAL_CLAIM_TAG, REFERRAL_SWEEP_TAG, u64le, i64le,
} from "./constants";

export interface CosignSigner {
  publicKey: PublicKey;
  secretKey: Uint8Array;
}

/** sha256(ix.data ‖ each account pubkey) — the exact-ix binding the program re-derives. */
export function hashInstruction(ix: TransactionInstruction): Buffer {
  return createHash("sha256")
    .update(Buffer.concat([Buffer.from(ix.data), ...ix.keys.map((k) => k.pubkey.toBuffer())]))
    .digest();
}

/**
 * Build the Ed25519 precompile instruction that cosigns `ix`. Prepend it to the
 * cosigned ix in the SAME transaction.
 *
 *   const ix = await dp.admin.setParamIx(field, value);
 *   const ed = buildCosignEd25519Ix({ cosigner, ix, nonce, signedTs });
 *   await dp.connection.sendTransaction(new Transaction().add(ed, ix), [admin]);
 */
export function buildCosignEd25519Ix(args: {
  cosigner: CosignSigner;
  ix: TransactionInstruction;
  nonce: bigint | number;
  signedTs: bigint | number;
  programId?: PublicKey;
}): TransactionInstruction {
  const programId = args.programId ?? DIAMOND_POOLS_PROGRAM_ID;
  const msg = Buffer.concat([
    COSIGN_TAG,
    programId.toBuffer(),
    u64le(args.nonce),
    i64le(args.signedTs),
    hashInstruction(args.ix),
  ]);
  return Ed25519Program.createInstructionWithPrivateKey({
    privateKey: args.cosigner.secretKey,
    message: msg,
  });
}

/** Referral CLAIM/PUSH attestation (settlement authority signs cumulative+expiry). */
export function buildReferralClaimAttestation(args: {
  settlementAuthority: CosignSigner;
  referrer: PublicKey;
  cumulative: bigint | number;
  expiry: bigint | number;
  programId?: PublicKey;
}): TransactionInstruction {
  const programId = args.programId ?? DIAMOND_POOLS_PROGRAM_ID;
  const msg = Buffer.concat([
    REFERRAL_CLAIM_TAG,
    programId.toBuffer(),
    args.referrer.toBuffer(),
    u64le(args.cumulative),
    i64le(args.expiry),
  ]);
  return Ed25519Program.createInstructionWithPrivateKey({
    privateKey: args.settlementAuthority.secretKey,
    message: msg,
  });
}

/** Referral SWEEP attestation (settlement authority signs an all-time target). */
export function buildReferralSweepAttestation(args: {
  settlementAuthority: CosignSigner;
  targetCumulative: bigint | number;
  expiry: bigint | number;
  programId?: PublicKey;
}): TransactionInstruction {
  const programId = args.programId ?? DIAMOND_POOLS_PROGRAM_ID;
  const msg = Buffer.concat([
    REFERRAL_SWEEP_TAG,
    programId.toBuffer(),
    u64le(args.targetCumulative),
    i64le(args.expiry),
  ]);
  return Ed25519Program.createInstructionWithPrivateKey({
    privateKey: args.settlementAuthority.secretKey,
    message: msg,
  });
}
