import BN from "bn.js";
import {
  Keypair,
  PublicKey,
  Signer,
  SystemProgram,
  Transaction,
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
  findWithdrawRequest,
} from "./pdas";

export class UserApi {
  constructor(private readonly c: CwrVaultClient) {}

  /**
   * Deposit lamports into a bucket and receive shares.
   * Creates the user's share-token ATA idempotently if missing.
   */
  async deposit(args: {
    bucket: Bucket;
    amount: BN;
    user: Signer;
  }): Promise<string> {
    const addrs = deriveBucketAddresses(this.c.programId, args.bucket);
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
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions(pre)
      .signers([args.user])
      .rpc();
  }

  /**
   * Move `shares` into escrow and start the lockup timer. The shares stay in
   * `total_shares` (NAV exposure preserved) until `claimWithdraw`.
   */
  async requestWithdraw(args: {
    bucket: Bucket;
    shares: BN;
    user: Signer;
  }): Promise<string> {
    const addrs = deriveBucketAddresses(this.c.programId, args.bucket);
    const [requestPda] = findWithdrawRequest(
      this.c.programId,
      args.bucket,
      args.user.publicKey,
    );
    const userAta = getAssociatedTokenAddressSync(addrs.shareMint, args.user.publicKey);

    return this.c.program.methods
      .requestWithdraw(args.shares)
      .accountsPartial({
        bucket: addrs.bucket,
        userShareAta: userAta,
        escrowAta: addrs.escrow,
        withdrawRequest: requestPda,
        user: args.user.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([args.user])
      .rpc();
  }

  /**
   * After `unlock_at` elapses, burn escrowed shares and receive SOL at the
   * current NAV. Will fail with InsufficientVaultSol if the backend hasn't
   * topped up enough; caller should retry once vault is funded.
   */
  async claimWithdraw(args: { bucket: Bucket; user: Signer }): Promise<string> {
    const addrs = deriveBucketAddresses(this.c.programId, args.bucket);
    const [requestPda] = findWithdrawRequest(
      this.c.programId,
      args.bucket,
      args.user.publicKey,
    );
    return this.c.program.methods
      .claimWithdraw()
      .accountsPartial({
        bucket: addrs.bucket,
        treasury: addrs.treasury,
        shareMint: addrs.shareMint,
        escrowAta: addrs.escrow,
        withdrawRequest: requestPda,
        user: args.user.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([args.user])
      .rpc();
  }
}
