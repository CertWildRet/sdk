import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Signer, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Bucket } from "./constants";
import { CwrVaultClient } from "./client";
import { deriveBucketAddresses, findBucket } from "./pdas";
import type { BucketParamsInput } from "./types";

export class AdminApi {
  constructor(private readonly c: CwrVaultClient) {}

  async initialize(args: {
    admin: Signer;
    backend: PublicKey;
    feeRecipient: PublicKey;
  }): Promise<string> {
    return this.c.program.methods
      .initialize(args.backend, args.feeRecipient)
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([args.admin])
      .rpc();
  }

  async initBucket(args: {
    bucketId: number;
    params: BucketParamsInput;
    admin: Signer;
  }): Promise<string> {
    const addrs = deriveBucketAddresses(this.c.programId, args.bucketId);
    return this.c.program.methods
      .initBucket(args.bucketId, args.params as any)
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        bucket: addrs.bucket,
        treasury: addrs.treasury,
        shareMint: addrs.shareMint,
        escrowAta: addrs.escrow,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([args.admin])
      .rpc();
  }

  async setBackend(args: {
    newBackend: PublicKey;
    admin: Signer;
  }): Promise<string> {
    return this.c.program.methods
      .setBackend(args.newBackend)
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
      })
      .signers([args.admin])
      .rpc();
  }

  async setAdmin(args: { newAdmin: PublicKey; admin: Signer }): Promise<string> {
    return this.c.program.methods
      .setAdmin(args.newAdmin)
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
      })
      .signers([args.admin])
      .rpc();
  }

  async setFeeRecipient(args: {
    newFeeRecipient: PublicKey;
    admin: Signer;
  }): Promise<string> {
    return this.c.program.methods
      .setFeeRecipient(args.newFeeRecipient)
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
      })
      .signers([args.admin])
      .rpc();
  }

  async setBucketParams(args: {
    bucket: Bucket;
    params: BucketParamsInput;
    admin: Signer;
  }): Promise<string> {
    const [bucketPda] = findBucket(this.c.programId, args.bucket);
    return this.c.program.methods
      .setBucketParams(args.params as any)
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        bucket: bucketPda,
      })
      .signers([args.admin])
      .rpc();
  }

  async setPause(args: {
    bucket: Bucket;
    paused: boolean;
    admin: Signer;
  }): Promise<string> {
    const [bucketPda] = findBucket(this.c.programId, args.bucket);
    return this.c.program.methods
      .setPause(args.paused)
      .accountsPartial({
        config: this.c.configPda,
        admin: args.admin.publicKey,
        bucket: bucketPda,
      })
      .signers([args.admin])
      .rpc();
  }
}
