/**
 * Typed views of the on-chain accounts + events, derived from the IDL via Anchor's
 * type helpers. `DiamondAccounts["config"]` etc. are fully typed (camelCase fields).
 */
import type { IdlAccounts } from "@coral-xyz/anchor";
import type { DiamondPools } from "@diamond/abi";

export type DiamondAccounts = IdlAccounts<DiamondPools>;
// EVENT TYPES ARE NOT DERIVED FROM THE IDL. This exported `IdlEvents<DiamondPools>` map, and every
// deferred variant of it, fails to compile at the current IDL size:
//
//   src/types.ts: error TS2589: Type instantiation is excessively deep and possibly infinite
//
// It is the EVENTS map specifically — `IdlAccounts<DiamondPools>` above is fine. At 48 events
// Anchor's mapped type exceeds TypeScript's instantiation depth, and the limit is not configurable.
// Deferring behind a generic or a conditional does NOT help: TS still checks the branch, so merely
// naming `IdlEvents<DiamondPools>` anywhere in the file is enough to fail.
//
// This was invisible for a while and is worth knowing WHY: a warm tree keeps building from a stale
// `dist`, so `npm run build` reported success. It only surfaces on a CLEAN build — which is exactly
// what a consumer gets, because installing this package from git runs its `prepare` script. The
// symptom appeared as "crank cannot install the sdk", three repos away from the cause.
//
// If you need an event's shape, decode at runtime with the Anchor event coder (see `events.ts`) or
// hand-write the handful of fields you consume. Do not reintroduce the map.

// Account aliases (all 15 program accounts — `check-interface` now enforces completeness).
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
/** rev-13 segregated unclaimed pot: totals only; the per-beneficiary picture is
 *  reconstructed off-chain from `UnclaimedRecorded` / `UnclaimedOreRecorded`. */
export type Unclaimed = DiamondAccounts["unclaimed"];
export type WhitelistEntry = DiamondAccounts["whitelistEntry"];
export type Window = DiamondAccounts["window"];
