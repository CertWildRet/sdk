import BN from "bn.js";
import { PublicKey, Signer, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Bucket } from "./constants";
import { CwrVaultClient } from "./client";
import { deriveBucketAddresses, findFeeBucket, findFeeSchedule } from "./pdas";

export class BackendApi {
  constructor(private readonly c: CwrVaultClient) {}

  /**
   * Move SOL from the bucket's treasury into the operator wallet for
   * external deployment.
   *
   * V5 — if `pull_fee_enabled = true`, the contract automatically skims
   * `amount × pull_fee_bps / 10000` to the global fee_bucket PDA. The
   * operator wallet receives the NET (amount - fee). `external_value`
   * increments by NET, so total NAV drops by exactly the fee — that's
   * where the user pays this volume fee, transparently, via NPS.
   *
   * Pinned to `bucket.operator_wallet` via on-chain `has_one` constraint
   * (V5: per-bucket — each bucket has its own operator for ORE Miner PDA
   * isolation, so Simple's hourly claim doesn't reset Refined/Ultra).
   */
  async pull(args: {
    bucket: Bucket;
    amount: BN;
    backend: Signer;
    operator: PublicKey;
  }): Promise<string> {
    const addrs = deriveBucketAddresses(this.c.programId, args.bucket);
    const [feeBucket] = findFeeBucket(this.c.programId);
    const [feeSchedule] = findFeeSchedule(this.c.programId);
    return this.c.program.methods
      .pull(args.amount)
      .accountsPartial({
        bucket: addrs.bucket,
        treasury: addrs.treasury,
        config: this.c.configPda,
        backend: args.backend.publicKey,
        operatorWallet: args.operator,
        feeBucket,
        feeSchedule,
        systemProgram: SystemProgram.programId,
      })
      .signers([args.backend])
      .rpc();
  }

  /**
   * Return SOL from the operator wallet into the treasury. Both backend
   * and operator must sign (audit fix #1).
   */
  async push(args: {
    bucket: Bucket;
    amount: BN;
    backend: Signer;
    operator: Signer;
  }): Promise<string> {
    const addrs = deriveBucketAddresses(this.c.programId, args.bucket);
    return this.c.program.methods
      .push(args.amount)
      .accountsPartial({
        bucket: addrs.bucket,
        treasury: addrs.treasury,
        config: this.c.configPda,
        backend: args.backend.publicKey,
        operatorWallet: args.operator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([args.backend, args.operator])
      .rpc();
  }

  /**
   * Set the bucket's `external_value` to mark-to-market off-vault holdings.
   * Rate-limited and bounded by `max_nav_jump_up_bps` / `max_nav_drop_down_bps`.
   */
  /**
   * V5 — push wrapped stORE from the operator's stORE ATA into the
   * per-bucket store_treasury account. Mirrors `push` but in the stORE
   * leg; increments `bucket.store_in_vault`. Both backend and operator
   * must sign (operator is the authority of the source ATA).
   */
  async pushStore(args: {
    bucket: Bucket;
    amount: BN;
    backend: Signer;
    operator: Signer;
  }): Promise<string> {
    const addrs = deriveBucketAddresses(this.c.programId, args.bucket);
    const cfg = await this.c.program.account.config.fetch(this.c.configPda);
    const operatorStoreAta = getAssociatedTokenAddressSync(
      cfg.storeMint,
      args.operator.publicKey,
    );
    return this.c.program.methods
      .pushStore(args.amount)
      .accountsPartial({
        bucket: addrs.bucket,
        storeTreasury: addrs.storeTreasury,
        operatorStoreAta,
        storeMint: cfg.storeMint,
        config: this.c.configPda,
        backend: args.backend.publicKey,
        operatorWallet: args.operator.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([args.backend, args.operator])
      .rpc();
  }

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
