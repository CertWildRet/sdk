import BN from "bn.js";
import { PublicKey, Signer, SystemProgram } from "@solana/web3.js";
import { Bucket } from "./constants";
import { CwrVaultClient } from "./client";
import { deriveBucketAddresses } from "./pdas";

export class BackendApi {
  constructor(private readonly c: CwrVaultClient) {}

  /**
   * Move SOL from the bucket's treasury into the operator wallet for
   * external deployment (ORE board, jitoSOL staking, etc.). Increases
   * `external_value` by the same amount — NAV per share unchanged.
   */
  async pull(args: {
    bucket: Bucket;
    amount: BN;
    backend: Signer;
    operator: PublicKey;
  }): Promise<string> {
    const addrs = deriveBucketAddresses(this.c.programId, args.bucket);
    return this.c.program.methods
      .pull(args.amount)
      .accountsPartial({
        bucket: addrs.bucket,
        treasury: addrs.treasury,
        config: this.c.configPda,
        backend: args.backend.publicKey,
        operatorWallet: args.operator,
        systemProgram: SystemProgram.programId,
      })
      .signers([args.backend])
      .rpc();
  }

  /**
   * Return SOL from the operator wallet into the treasury. Reduces
   * `external_value` by the push amount (saturating at 0 — any excess past
   * `external_value` becomes new NAV / share appreciation).
   */
  async push(args: {
    bucket: Bucket;
    amount: BN;
    operator: Signer;
  }): Promise<string> {
    const addrs = deriveBucketAddresses(this.c.programId, args.bucket);
    return this.c.program.methods
      .push(args.amount)
      .accountsPartial({
        bucket: addrs.bucket,
        treasury: addrs.treasury,
        operatorWallet: args.operator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([args.operator])
      .rpc();
  }

  /**
   * Set the bucket's `external_value` to mark-to-market off-vault holdings
   * (operator SOL + jitoSOL × oracle + ORE × oracle + in-flight deploys).
   * Rate-limited and bounded by `max_nav_jump_up_bps` / `max_nav_drop_down_bps`.
   */
  async reportNav(args: {
    bucket: Bucket;
    externalValue: BN;
    backend: Signer;
  }): Promise<string> {
    const addrs = deriveBucketAddresses(this.c.programId, args.bucket);
    return this.c.program.methods
      .reportNav(args.externalValue)
      .accountsPartial({
        bucket: addrs.bucket,
        config: this.c.configPda,
        backend: args.backend.publicKey,
      })
      .signers([args.backend])
      .rpc();
  }
}
