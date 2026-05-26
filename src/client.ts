import {
  AnchorProvider,
  Program,
  Wallet as AnchorWallet,
} from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  CWR_VAULT_IDL,
  CwrVault,
  Cluster,
  getProgramId,
} from "@cwr/abi";
import { findConfig } from "./pdas";

export type CwrVaultConfig = {
  connection: Connection;
  programId?: PublicKey;
  cluster?: Cluster;
  /**
   * Anchor provider for signing transactions. Optional; if omitted, only
   * read-only methods are available.
   */
  provider?: AnchorProvider;
};

/**
 * Read-only-by-default client. Pass a provider to enable transaction
 * submission; pass a keypair to deposit/withdraw/etc.
 */
export class CwrVaultClient {
  readonly connection: Connection;
  readonly programId: PublicKey;
  readonly program: Program<CwrVault>;
  readonly configPda: PublicKey;
  private readonly providerOrNull: AnchorProvider | null;

  constructor(cfg: CwrVaultConfig) {
    this.connection = cfg.connection;
    if (cfg.programId) {
      this.programId = cfg.programId;
    } else if (cfg.cluster) {
      this.programId = new PublicKey(getProgramId(cfg.cluster));
    } else {
      throw new Error("CwrVaultClient: must pass either programId or cluster");
    }

    const provider =
      cfg.provider ??
      new AnchorProvider(
        this.connection,
        readOnlyWallet(),
        AnchorProvider.defaultOptions(),
      );
    this.providerOrNull = cfg.provider ?? null;

    this.program = new Program<CwrVault>(CWR_VAULT_IDL as any, provider);
    this.configPda = findConfig(this.programId)[0];
  }

  get provider(): AnchorProvider {
    if (!this.providerOrNull) {
      throw new Error(
        "CwrVaultClient: no provider configured. Pass a provider to enable signing.",
      );
    }
    return this.providerOrNull;
  }

  hasProvider(): boolean {
    return this.providerOrNull !== null;
  }
}

function readOnlyWallet(): AnchorWallet {
  const dummy = Keypair.generate();
  return {
    publicKey: dummy.publicKey,
    signTransaction: async (tx) => tx,
    signAllTransactions: async (txs) => txs,
    payer: dummy,
  } as unknown as AnchorWallet;
}
