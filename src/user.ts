import BN from "bn.js";
import {
  Signer,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Bucket } from "./constants";
import { CwrVaultClient } from "./client";
import {
  deriveBucketAddresses,
  findFeeBucket,
  findFeeSchedule,
} from "./pdas";

export class UserApi {
  constructor(private readonly c: CwrVaultClient) {}

  /**
   * Deposit lamports into a bucket and receive shares.
   * Creates the user's share-token ATA idempotently if missing. The V5
   * entry-fee is skimmed by the program from `amount` into the global fee
   * bucket BEFORE shares are minted (so shares reflect the net deposited).
   */
  async deposit(args: {
    bucket: Bucket;
    amount: BN;
    user: Signer;
  }): Promise<string> {
    const addrs = deriveBucketAddresses(this.c.programId, args.bucket);
    const [feeSchedule] = findFeeSchedule(this.c.programId);
    const [feeBucket] = findFeeBucket(this.c.programId);
    const userAta = getAssociatedTokenAddressSync(addrs.shareMint, args.user.publicKey);

    const ataInfo = await this.c.connection.getAccountInfo(userAta);
    const pre: TransactionInstruction[] = [];
    if (!ataInfo) {
      pre.push(
        createAssociatedTokenAccountIdempotentInstruction(
          args.user.publicKey,
          userAta,
          args.user.publicKey,
          addrs.shareMint,
        ),
      );
    }

    return this.c.program.methods
      .deposit(args.amount)
      .accountsPartial({
        bucket: addrs.bucket,
        treasury: addrs.treasury,
        shareMint: addrs.shareMint,
        userShareAta: userAta,
        user: args.user.publicKey,
        feeBucket,
        feeSchedule,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions(pre)
      .signers([args.user])
      .rpc();
  }

  /**
   * Burn shares and withdraw the underlying SOL payout, minus the
   * performance fee (legacy → `cfg.fee_recipient`) and V5 flat exit fee
   * (→ global fee bucket). Only callable while `claims_open` on the bucket.
   */
  async withdraw(args: {
    bucket: Bucket;
    shares: BN;
    user: Signer;
  }): Promise<string> {
    const addrs = deriveBucketAddresses(this.c.programId, args.bucket);
    const userShareAta = getAssociatedTokenAddressSync(addrs.shareMint, args.user.publicKey);
    const [feeSchedule] = findFeeSchedule(this.c.programId);
    const [feeBucket] = findFeeBucket(this.c.programId);
    const cfg = await this.c.program.account.config.fetch(this.c.configPda);
    const userStoreAta = getAssociatedTokenAddressSync(cfg.storeMint, args.user.publicKey);

    // Idempotently ensure the user's stORE ATA exists so withdraw can
    // transfer the pro-rata stORE payout into it without failing.
    const pre: TransactionInstruction[] = [];
    const ataInfo = await this.c.connection.getAccountInfo(userStoreAta);
    if (!ataInfo) {
      pre.push(
        createAssociatedTokenAccountIdempotentInstruction(
          args.user.publicKey,
          userStoreAta,
          args.user.publicKey,
          cfg.storeMint,
        ),
      );
    }

    return this.c.program.methods
      .withdraw(args.shares)
      .accountsPartial({
        bucket: addrs.bucket,
        treasury: addrs.treasury,
        shareMint: addrs.shareMint,
        userShareAta: userShareAta,
        user: args.user.publicKey,
        feeRecipient: cfg.feeRecipient,
        feeBucket,
        feeSchedule,
        config: this.c.configPda,
        storeTreasury: addrs.storeTreasury,
        userStoreAta,
        storeMint: cfg.storeMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions(pre)
      .signers([args.user])
      .rpc();
  }
}
