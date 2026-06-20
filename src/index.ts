export * from "./constants";
export * from "./pdas";
export * from "./math";
export * from "./errors";
export * from "./types";
export { CwrVaultClient } from "./client";
export type { CwrVaultConfig } from "./client";
export { UserApi } from "./user";
export { CrankApi } from "./crank";
export { AdminApi } from "./admin";
export { ReadApi } from "./read";
export type { NavSnapshot } from "./read";
export { EventsApi } from "./events";
export type { CwrEventName, EventHandler, Unsubscribe } from "./events";

import { CwrVaultClient, CwrVaultConfig } from "./client";
import { UserApi } from "./user";
import { CrankApi } from "./crank";
import { AdminApi } from "./admin";
import { ReadApi } from "./read";
import { EventsApi } from "./events";

/**
 * High-level facade. Construct once, reuse — bundles a client with all
 * domain APIs.
 *
 *   const vault = new CwrVault({ connection, cluster: "mainnet", provider });
 *   await vault.user.deposit({ bucket: Bucket.Liquid, amount, user });
 *   const state = await vault.read.bucket(Bucket.Liquid);
 *   const unsub = vault.events.onDeposit(evt => console.log(evt));
 */
export class CwrVault {
  readonly client: CwrVaultClient;
  readonly user: UserApi;
  readonly crank: CrankApi;
  readonly admin: AdminApi;
  readonly read: ReadApi;
  readonly events: EventsApi;

  constructor(cfg: CwrVaultConfig) {
    this.client = new CwrVaultClient(cfg);
    this.user = new UserApi(this.client);
    this.crank = new CrankApi(this.client);
    this.admin = new AdminApi(this.client);
    this.read = new ReadApi(this.client);
    this.events = new EventsApi(this.client);
  }

  get programId() {
    return this.client.programId;
  }

  get configPda() {
    return this.client.configPda;
  }

  get program() {
    return this.client.program;
  }
}
