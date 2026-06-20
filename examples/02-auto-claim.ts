/**
 * Example: auto-claim service. Watches all WithdrawRequest accounts that are
 * unlocked AND have sufficient vault SOL, calls claim_withdraw on behalf of
 * the user. Useful as a third-party UX utility (claimer collects tips off-band
 * or runs it as a goodwill service).
 *
 * IMPORTANT: claim_withdraw must be signed by the request's user. This example
 * assumes the user has delegated signing (e.g., shared a derived keypair).
 * In practice, third-party cranking is usually done via a separate
 * "permissionless claim crank" pattern (not in V1 — would need a contract update).
 *
 * As-is, this example only claims requests where the runner *is* the user.
 */
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { Bucket, BUCKET_LABELS, CwrVault, decodeCwrError } from "../src";

const POLL_INTERVAL_MS = 30_000;

async function main() {
  const rpc = process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899";
  const keyPath =
    process.env.CLAIMER_KEYPAIR_PATH ?? join(homedir(), ".config/solana/id.json");
  const programId = new PublicKey(
    process.env.CWR_PROGRAM_ID ?? "CLDmHatW3uszqHqCYgMkAk9jFW1Zse5yPV6RWdTArx2E",
  );
  const claimer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(keyPath, "utf8"))),
  );

  const connection = new Connection(rpc, "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(claimer), {
    commitment: "confirmed",
  });
  const vault = new CwrVault({ connection, programId, provider });

  console.log(`Auto-claim watcher live. User: ${claimer.publicKey.toBase58()}`);

  while (true) {
    for (const bucket of [Bucket.Liquid, Bucket.Staked, Bucket.Locked]) {
      const req = await vault.read.withdrawRequest(bucket, claimer.publicKey);
      if (!req || req.shares.isZero()) continue;
      const now = Math.floor(Date.now() / 1000);
      if (now < Number(req.unlockAt.toString())) {
        const remaining = Number(req.unlockAt.toString()) - now;
        console.log(`[${BUCKET_LABELS[bucket]}] locked for ${remaining}s more`);
        continue;
      }
      const snap = await vault.read.navSnapshot(bucket);
      if (!snap) continue;
      const owed = req.shares
        .mul(snap.totalNav)
        .div(snap.totalShares);
      if (snap.solInVault.lt(owed)) {
        console.log(
          `[${BUCKET_LABELS[bucket]}] vault short (${snap.solInVault} < ${owed}) — waiting for operator top-up`,
        );
        continue;
      }
      try {
        const sig = await vault.user.claimWithdraw({ bucket, user: claimer });
        console.log(`[${BUCKET_LABELS[bucket]}] claimed: ${sig}`);
      } catch (err) {
        const cwrErr = decodeCwrError(err);
        console.error(
          `[${BUCKET_LABELS[bucket]}] claim failed: ${cwrErr?.message ?? err}`,
        );
      }
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
