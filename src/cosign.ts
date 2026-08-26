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
 *
 * ⛔ THAT ONE-LINE SEND IS NOT A COMPLETE FLOW — RE-SIGN ON EXPIRY, DO NOT JUST RESEND.
 *
 * The program accepts the proof only while `signed_ts <= now + 5s` and `now <= signed_ts + 30s`
 * (`COSIGN_MAX_AGE_SECS`, `COSIGN_MAX_FUTURE_SECS`). **That window is roughly 4x SHORTER than the
 * transaction's own life:** a blockhash stays valid ~150 slots, which at the p99 slot interval
 * measured on mainnet this week (813 ms) is ~122 s. So a transaction can be perfectly valid to the
 * network and still be refused by this gate — under congestion, which is exactly when an admin
 * action matters most.
 *
 * Resending the SAME bytes cannot fix it: `signed_ts` is inside the signed message. The retry must
 * rebuild — re-read `admin_auth_nonce`, re-read the CHAIN clock, and construct a fresh ed25519 ix:
 *
 *   for (let attempt = 1; attempt <= 3; attempt++) {
 *     const nonce = (await dp.read.config()).adminAuthNonce;   // a landed send consumed it
 *     const signedTs = await chainNowSecs(connection);         // NOT Date.now() — chain clock
 *     const ed = buildCosignEd25519Ix({ cosigner, ix, nonce, signedTs });
 *     try { return await send(new Transaction().add(ed, ix), [admin]); }
 *     catch (e) { if (attempt === 3 || !/CosignExpired|BadCosign|blockhash/i.test(String(e))) throw e; }
 *   }
 *
 * Re-reading the NONCE each attempt is not optional either: if an earlier attempt actually landed
 * while the client saw a timeout, the nonce has moved and a stale one fails `BadCosignNonce`.
 *
 * With this loop the 30 s bound is three independent re-signed attempts rather than one shot, which
 * is why the constant is sound as built (results §3bg) — the mitigation lives in the CALLER, so a
 * consumer that copies only the three lines above inherits the tight window and none of the escape.
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
