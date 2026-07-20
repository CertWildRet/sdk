/**
 * DiamondPoolsClient — the SDK entry point. Wraps an Anchor `Program<DiamondPools>`
 * (built from the @diamond/abi IDL, which auto-resolves every account PDA) and exposes the
 * domain APIs. Construct once, reuse:
 *
 *   const dp = new DiamondPoolsClient({ connection, wallet });
 *   await dp.user.depositMining({ owner, amount });
 *   const cfg = await dp.read.config();
 *   const unsub = dp.events.on("WindowFrozen", (e) => console.log(e));
 */
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { DIAMOND_POOLS_IDL, DiamondPools, DiamondPoolsProgram } from "./idl";
import { UserApi } from "./user";
import { CrankApi } from "./crank";
import { AdminApi } from "./admin";
import { EvacApi } from "./evac";
import { ReadApi } from "./read";
import { EventsApi } from "./events";

export interface DiamondPoolsClientConfig {
  connection: Connection;
  /** Anchor wallet (signs). Omit for read-only usage (a throwaway keypair is used). */
  wallet?: Wallet;
  /** Provide a fully-built provider instead of {connection, wallet}. */
  provider?: AnchorProvider;
  /** AnchorProvider commitment/preflight opts (when constructing from connection). */
  opts?: ConstructorParameters<typeof AnchorProvider>[2];
}

/** A minimal read-only wallet (never signs anything the caller does not opt into). */
export class ReadonlyWallet implements Wallet {
  readonly payer = Keypair.generate();
  get publicKey(): PublicKey {
    return this.payer.publicKey;
  }
  async signTransaction<T>(tx: T): Promise<T> {
    return tx;
  }
  async signAllTransactions<T>(txs: T[]): Promise<T[]> {
    return txs;
  }
}

export class DiamondPoolsClient {
  readonly connection: Connection;
  readonly provider: AnchorProvider;
  readonly program: DiamondPoolsProgram;
  readonly programId: PublicKey;

  private _user?: UserApi;
  private _crank?: CrankApi;
  private _admin?: AdminApi;
  private _evac?: EvacApi;
  private _read?: ReadApi;
  private _events?: EventsApi;

  constructor(cfg: DiamondPoolsClientConfig) {
    this.connection = cfg.connection;
    this.provider =
      cfg.provider ??
      new AnchorProvider(cfg.connection, cfg.wallet ?? new ReadonlyWallet(), cfg.opts ?? {});
    this.program = new Program(DIAMOND_POOLS_IDL as DiamondPools, this.provider) as DiamondPoolsProgram;
    this.programId = this.program.programId;
  }

  get user(): UserApi {
    return (this._user ??= new UserApi(this));
  }
  get crank(): CrankApi {
    return (this._crank ??= new CrankApi(this));
  }
  get admin(): AdminApi {
    return (this._admin ??= new AdminApi(this));
  }
  get evac(): EvacApi {
    return (this._evac ??= new EvacApi(this));
  }
  get read(): ReadApi {
    return (this._read ??= new ReadApi(this));
  }
  get events(): EventsApi {
    return (this._events ??= new EventsApi(this));
  }
}
