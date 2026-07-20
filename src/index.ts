/**
 * @diamond/sdk — TypeScript SDK for Diamond Pools, the non-custodial three-pool ORE vault
 * on Solana (Mining / Staking / Protocol).
 *
 *   import { DiamondPoolsClient } from "@diamond/sdk";
 *   const dp = new DiamondPoolsClient({ connection, wallet });
 *   const ix = await dp.user.depositMining(owner.publicKey, 1_000_000n);
 *   const cfg = await dp.read.config();
 *   const id = dp.events.on("WindowFrozen", (e) => console.log(e));
 */
export * from "./constants";
export * from "./pdas";
export * from "./idl";
export * from "./types";
export * from "./errors";
export * from "./cosign";

export { DiamondPoolsClient, ReadonlyWallet } from "./client";
export type { DiamondPoolsClientConfig } from "./client";

export { UserApi } from "./user";
export { CrankApi } from "./crank";
export { AdminApi } from "./admin";
export { EvacApi } from "./evac";
export { ReadApi } from "./read";
export { EventsApi } from "./events";
export type { EventName } from "./events";
