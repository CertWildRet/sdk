import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const idl = JSON.parse(
  readFileSync(join(root, "node_modules/@diamond/abi/src/idl/diamond_pools.json"), "utf8"),
);
const source = readdirSync(join(root, "src"))
  .filter((name) => name.endsWith(".ts"))
  .map((name) => readFileSync(join(root, "src", name), "utf8"))
  .join("\n");
const camel = (name) => name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
const missing = idl.instructions
  .map((instruction) => camel(instruction.name))
  .filter((name) => !new RegExp(`\\.${name}\\s*\\(`).test(source));

if (missing.length > 0) {
  console.error(`Missing SDK instruction builders: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`SDK covers all ${idl.instructions.length} Diamond Pools instructions.`);
