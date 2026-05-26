/**
 * Example skeleton: backend cycle (the Render service shape).
 *
 * This is INTERNAL — the auth keys are checked by the program. External
 * automators running this will get NotBackend on `pull` and `reportNav`.
 *
 * Strategy logic (edge.md formula, ORE deploy) is OUT OF SCOPE here. This is
 * just the on-chain choreography you'd wrap your strategy worker around.
 */
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { readFileSync } from "fs";
import BN from "bn.js";
import { Bucket, BUCKET_LABELS, CwrVault, lamportsToSol } from "../src";

const ROUND_INTERVAL_MS = 30_000;
const NAV_UPDATE_INTERVAL_MS = 5 * 60_000;

async function main() {
  const rpc = process.env.SOLANA_RPC_URL!;
  const programId = new PublicKey(process.env.CWR_PROGRAM_ID!);
  const backend = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(process.env.BACKEND_KEYPAIR_PATH!, "utf8"))),
  );
  const operator = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(process.env.OPERATOR_KEYPAIR_PATH!, "utf8"))),
  );

  const connection = new Connection(rpc, "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(backend), {
    commitment: "confirmed",
  });
  const vault = new CwrVault({ connection, programId, provider });

  console.log(
    `Backend loop live: backend=${backend.publicKey.toBase58()} operator=${operator.publicKey.toBase58()}`,
  );

  let lastNavUpdateAt: Partial<Record<Bucket, number>> = {};

  while (true) {
    for (const bucket of [Bucket.Liquid, Bucket.Staked, Bucket.Locked]) {
      const snap = await vault.read.navSnapshot(bucket);
      if (!snap) continue;
      console.log(
        `[${BUCKET_LABELS[bucket]}] vault=${lamportsToSol(snap.solInVault).toFixed(4)} ` +
          `ext=${lamportsToSol(snap.externalValue).toFixed(4)} ` +
          `paused=${snap.paused}`,
      );

      if (snap.paused) continue;

      // YOUR STRATEGY:
      // 1. Decide how much to pull / push this round.
      // 2. Call the ORE program with the operator key.
      // 3. Compute new external_value from operator wallet + ORE holdings + jitoSOL.
      // 4. reportNav on a periodic cadence (respect min_nav_update_interval).
      //
      // Below is just a no-op template.

      const lastNav = lastNavUpdateAt[bucket] ?? 0;
      const now = Date.now();
      if (now - lastNav >= NAV_UPDATE_INTERVAL_MS && snap.totalShares.gtn(0)) {
        // Placeholder: simply re-report current external_value (no-op).
        try {
          await vault.backend.reportNav({
            bucket,
            externalValue: snap.externalValue,
            backend,
          });
          lastNavUpdateAt[bucket] = now;
        } catch (err) {
          console.warn(`[${BUCKET_LABELS[bucket]}] reportNav failed:`, err);
        }
      }
    }

    await sleep(ROUND_INTERVAL_MS);
  }
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
