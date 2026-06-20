/**
 * Example: dashboard / analytics. Subscribe to NAV updates across all three
 * buckets and print a live tape.
 *
 * Read-only — no signer required.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { Bucket, BUCKET_LABELS, CwrVault, navPerShareToNumber } from "../src";

async function main() {
  const rpc = process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899";
  const programId = new PublicKey(
    process.env.CWR_PROGRAM_ID ?? "CLDmHatW3uszqHqCYgMkAk9jFW1Zse5yPV6RWdTArx2E",
  );
  const connection = new Connection(rpc, "confirmed");
  const vault = new CwrVault({ connection, programId });

  // Snapshot once for context.
  for (const bucket of [Bucket.Liquid, Bucket.Staked, Bucket.Locked]) {
    const snap = await vault.read.navSnapshot(bucket);
    if (!snap) {
      console.log(`[${BUCKET_LABELS[bucket]}] not initialized`);
      continue;
    }
    console.log(
      `[${BUCKET_LABELS[bucket]}] paused=${snap.paused} nav/share=${navPerShareToNumber(snap.navPerShareX18).toFixed(9)} ` +
        `vault=${snap.solInVault.toString()} ext=${snap.externalValue.toString()} ` +
        `shares=${snap.totalShares.toString()}`,
    );
  }

  // Stream future updates.
  const unsubs = [
    vault.events.onReportNav((evt: any) => {
      const bucket = evt.bucketId as Bucket;
      const nps = navPerShareToNumber(evt.navPerShare);
      console.log(
        `${new Date().toISOString()} [${BUCKET_LABELS[bucket]}] NAV update: ` +
          `nav/share=${nps.toFixed(9)} ext=${evt.externalValue.toString()}`,
      );
    }),
    vault.events.onDeposit((evt: any) => {
      const bucket = evt.bucketId as Bucket;
      console.log(
        `${new Date().toISOString()} [${BUCKET_LABELS[bucket]}] DEPOSIT ` +
          `${evt.amountLamports.toString()} lamports → ${evt.sharesMinted.toString()} shares`,
      );
    }),
    vault.events.onClaimWithdraw((evt: any) => {
      const bucket = evt.bucketId as Bucket;
      console.log(
        `${new Date().toISOString()} [${BUCKET_LABELS[bucket]}] CLAIM ` +
          `${evt.payoutLamports.toString()} lamports for ${evt.sharesBurned.toString()} shares`,
      );
    }),
  ];

  console.log("Listening… (Ctrl+C to exit)");

  process.on("SIGINT", async () => {
    for (const u of unsubs) await u();
    process.exit(0);
  });

  // Keep the process alive.
  await new Promise(() => {});
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
