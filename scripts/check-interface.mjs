import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ─────────────────────────────────────────────────────────────────────────────
// Interface drift check: does the hand-maintained SDK surface still match the IDL?
//
// rev-14: this script used to inspect `idl.instructions` ONLY. That blind spot let the
// hand-written `EventName` union in src/events.ts drift by ELEVEN live event names — the entire
// unclaimed-pot family plus the conservation observer's two — while the check reported green.
// Events are not cosmetic here: the ratified undeliverable-payout policy keeps only TOTALS
// on-chain, so the per-beneficiary picture is reconstructed OFF-CHAIN from those events. A name
// missing from the union is a claim an indexer cannot see.
//
// It now checks instructions, events and accounts, and reports EVERY category before exiting so
// one run tells you the whole story rather than one class at a time.
// ─────────────────────────────────────────────────────────────────────────────

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const idl = JSON.parse(
  readFileSync(join(root, "node_modules/@diamond/abi/src/idl/diamond_pools.json"), "utf8"),
);
const source = readdirSync(join(root, "src"))
  .filter((name) => name.endsWith(".ts"))
  .map((name) => readFileSync(join(root, "src", name), "utf8"))
  .join("\n");

const camel = (name) => name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
const pascal = (name) => {
  const c = camel(name);
  return c.charAt(0).toUpperCase() + c.slice(1);
};

const problems = [];

// 1. every instruction needs a builder that actually invokes it
const missingIx = idl.instructions
  .map((i) => camel(i.name))
  .filter((n) => !new RegExp(`\\.${n}\\s*\\(`).test(source));
if (missingIx.length) problems.push(`Missing SDK instruction builders: ${missingIx.join(", ")}`);

// 2. every IDL event must appear in the EventName union — the drift that went unseen
const events = (idl.events ?? []).map((e) => pascal(e.name));
const missingEv = events.filter((n) => !new RegExp(`"${n}"`).test(source));
if (missingEv.length)
  problems.push(
    `Missing from the EventName union (src/events.ts): ${missingEv.join(", ")}\n` +
      `  These events CAN be emitted on-chain but no consumer can name them.`,
  );

// 3. and the reverse — a name in the union the program can no longer emit is a stale promise
const unionNames = [...source.matchAll(/^\s*\|\s*"([A-Za-z0-9_]+)"/gm)].map((m) => m[1]);
const knownEvents = new Set(events);
const phantomEv = [...new Set(unionNames)].filter(
  (n) => !knownEvents.has(n) && /^[A-Z]/.test(n) && new RegExp(`"${n}"`).test(source),
);
// only flag names that look like events (present in events.ts specifically)
const eventsSrc = readFileSync(join(root, "src", "events.ts"), "utf8");
const staleEv = phantomEv.filter((n) => new RegExp(`"${n}"`).test(eventsSrc));
if (staleEv.length)
  problems.push(
    `EventName union names events the IDL no longer declares: ${staleEv.join(", ")}\n` +
      `  Delete them, or the SDK advertises events that can never arrive.`,
  );

// 4. every IDL account should have a type alias, so consumers can name what they fetch
const missingAcc = (idl.accounts ?? [])
  .map((a) => pascal(a.name))
  .filter((n) => !new RegExp(`\\b${n}\\b`).test(source));
if (missingAcc.length) problems.push(`Missing account type aliases (src/types.ts): ${missingAcc.join(", ")}`);

if (problems.length) {
  for (const p of problems) console.error(p);
  process.exit(1);
}
console.log(
  `SDK matches the IDL: ${idl.instructions.length} instructions, ${events.length} events, ` +
    `${(idl.accounts ?? []).length} accounts.`,
);
