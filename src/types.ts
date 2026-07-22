/**
 * Typed views of the on-chain accounts + events, derived from the IDL via Anchor's
 * type helpers. `DiamondAccounts["config"]` etc. are fully typed (camelCase fields).
 */
import type { IdlAccounts, IdlEvents } from "@coral-xyz/anchor";
import type { DiamondPools } from "@diamond/abi";

export type DiamondAccounts = IdlAccounts<DiamondPools>;
export type DiamondEvents = IdlEvents<DiamondPools>;

// Account aliases (the 14 program accounts).
export type Config = DiamondAccounts["config"];
export type FeeExemptEntry = DiamondAccounts["feeExemptEntry"];
export type FeeSchedule = DiamondAccounts["feeSchedule"];
export type MiningPool = DiamondAccounts["miningPool"];
export type Order = DiamondAccounts["order"];
export type PhantomMember = DiamondAccounts["phantomMember"];
export type Position = DiamondAccounts["position"];
export type PpExitNotice = DiamondAccounts["ppExitNotice"];
export type ProtocolPool = DiamondAccounts["protocolPool"];
export type ReferralConfig = DiamondAccounts["referralConfig"];
export type ReferrerState = DiamondAccounts["referrerState"];
export type StakingPool = DiamondAccounts["stakingPool"];
export type WhitelistEntry = DiamondAccounts["whitelistEntry"];
export type Window = DiamondAccounts["window"];
