import {
  Ed25519Program,
  PublicKey,
  Signer,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { AnchorProvider } from "@coral-xyz/anchor";
import { sha256 } from "@noble/hashes/sha256";

/**
 * Fee-holder co-sign second factor — client side.
 *
 * Every post-bootstrap admin ix requires a fresh Ed25519 signature from a
 * current fee holder over an 88-byte message bound to that exact instruction.
 * The fee holder signs a MESSAGE (wallet `signMessage` — no transaction, works
 * air-gapped); the admin bundles it into the tx via the native Ed25519
 * precompile. The on-chain check is in cwr-vault/src/cosign.rs.
 *
 * Message layout (matches the contract byte-for-byte):
 *   [0..8]   tag = "CWRCOSGN"
 *   [8..40]  program id (32)
 *   [40..48] nonce (u64 LE)         — must equal Config.admin_auth_nonce
 *   [48..56] signed_ts (i64 LE)     — fresh vs the on-chain Clock (±30s/5s)
 *   [56..88] sha256(admin ix data)  — binds to the exact action + args
 */
export const COSIGN_TAG = Buffer.from("CWRCOSGN", "utf8");
export const COSIGN_MSG_LEN = 88;
export { SYSVAR_INSTRUCTIONS_PUBKEY };

/**
 * A fee holder that can authorize an admin action. Either a wallet adapter
 * (`{ publicKey, signMessage }`) or a thin wrapper over a Keypair — the SDK
 * never touches the private key, it only asks for a detached message signature.
 */
export interface FeeCosigner {
  publicKey: PublicKey;
  signMessage(message: Uint8Array): Promise<Uint8Array> | Uint8Array;
}

function writeU64LE(buf: Buffer, offset: number, value: bigint): void {
  let v = value;
  for (let i = 0; i < 8; i++) {
    buf[offset + i] = Number(v & 0xffn);
    v >>= 8n;
  }
}

/**
 * Build the 88-byte message a fee holder must sign to authorize an admin ix.
 *
 * The binding hash is sha256(ix data || each account pubkey in order) — it
 * commits to the EXACT action + args AND the target accounts (e.g. the specific
 * bucket), matching the on-chain check in cwr-vault/src/cosign.rs. Pass the
 * admin instruction's `data` and the ordered list of its account pubkeys
 * (`ix.keys.map(k => k.pubkey)`).
 */
export function buildCosignMessage(args: {
  programId: PublicKey;
  nonce: bigint | number | string;
  signedTs: bigint | number | string;
  /** The admin instruction's wire data (8-byte discriminator + borsh args). */
  adminIxData: Uint8Array;
  /** The admin instruction's account pubkeys, in instruction order. */
  adminIxAccounts: PublicKey[];
}): Buffer {
  const msg = Buffer.alloc(COSIGN_MSG_LEN);
  COSIGN_TAG.copy(msg, 0);
  Buffer.from(args.programId.toBytes()).copy(msg, 8);
  writeU64LE(msg, 40, BigInt(args.nonce.toString()));
  // signed_ts is a positive unix-seconds value → i64 LE == u64 LE.
  writeU64LE(msg, 48, BigInt(args.signedTs.toString()));
  const hashInput = Buffer.concat([
    Buffer.from(args.adminIxData),
    ...args.adminIxAccounts.map((k) => k.toBuffer()),
  ]);
  Buffer.from(sha256(hashInput)).copy(msg, 56);
  return msg;
}

/** Native Ed25519 verify instruction proving `publicKey` signed `message`. */
export function cosignEd25519Ix(args: {
  publicKey: PublicKey;
  message: Uint8Array;
  signature: Uint8Array;
}): TransactionInstruction {
  return Ed25519Program.createInstructionWithPublicKey({
    publicKey: args.publicKey.toBytes(),
    message: args.message,
    signature: args.signature,
  });
}

/**
 * Read the current nonce, build the cosign message + Ed25519 ix, and send
 * `[ed25519, adminIx]` signed by `admin`. Returns the tx signature.
 *
 * The admin instruction must already include the Instructions sysvar account
 * (`SYSVAR_INSTRUCTIONS_PUBKEY`) — see the admin methods.
 */
export async function sendCosignedAdminIx(args: {
  provider: AnchorProvider;
  programId: PublicKey;
  /** Reads Config.admin_auth_nonce as a bigint. */
  fetchNonce: () => Promise<bigint>;
  adminIx: TransactionInstruction;
  feeCosigner: FeeCosigner;
  admin: Signer;
}): Promise<string> {
  const nonce = await args.fetchNonce();
  const signedTs = BigInt(Math.floor(Date.now() / 1000));
  const message = buildCosignMessage({
    programId: args.programId,
    nonce,
    signedTs,
    adminIxData: args.adminIx.data,
    adminIxAccounts: args.adminIx.keys.map((k) => k.pubkey),
  });
  const signature = await args.feeCosigner.signMessage(message);
  const edIx = cosignEd25519Ix({
    publicKey: args.feeCosigner.publicKey,
    message,
    signature,
  });
  const tx = new Transaction().add(edIx, args.adminIx);
  return args.provider.sendAndConfirm(tx, [args.admin], { commitment: "confirmed" });
}
