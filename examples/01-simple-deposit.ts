/**
 * Example: deposit 0.1 SOL into the Liquid bucket and print resulting share balance.
 *
 *   ts-node 01-simple-deposit.ts
 *
 * Requires:
 *   - SOLANA_RPC_URL (default: http://127.0.0.1:8899)
 *   - DEPOSITOR_KEYPAIR_PATH (default: ~/.config/solana/id.json)
 *   - CWR_PROGRAM_ID (default: from @cwr/abi mainnet entry)
 */
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import BN from "bn.js";
import { Bucket, CwrVault, lamportsToSol, navPerShareToNumber } from "../src";

async function main() {
  const rpc = process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899";
  const keyPath =
    process.env.DEPOSITOR_KEYPAIR_PATH ?? join(homedir(), ".config/solana/id.json");
  const programId = new PublicKey(
    process.env.CWR_PROGRAM_ID ?? "BLi7NKqekZGh5zWNwmUK2bzs2tAR3sPC7A1VrgQdEaYL",
  );
  const depositor = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(keyPath, "utf8"))),
  );

  const connection = new Connection(rpc, "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(depositor), {
    commitment: "confirmed",
  });
  const vault = new CwrVault({ connection, programId, provider });

  const amount = new BN(0.1 * LAMPORTS_PER_SOL);

  const previewShares = await vault.read.previewDeposit(Bucket.Liquid, amount);
  console.log(`Will receive ~${previewShares.toString()} share-lamports`);

  const snapBefore = await vault.read.navSnapshot(Bucket.Liquid);
  console.log(
    `Pre  NAV/share = ${navPerShareToNumber(snapBefore!.navPerShareX18).toFixed(9)}`,
  );

  const sig = await vault.user.deposit({
    bucket: Bucket.Liquid,
    amount,
    user: depositor,
  });
  console.log(`Deposit tx: ${sig}`);

  const shares = await vault.read.userShares(Bucket.Liquid, depositor.publicKey);
  console.log(
    `User now holds ${shares.toString()} share-lamports (${lamportsToSol(shares)} cwr units)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
