/**
 * EventsApi — live event subscription + offline log decoding for diamond_pools.
 *
 * The program emits 43 Anchor events (Borsh-encoded, base64, on the `Program data:`
 * log line). This API is a thin, typed wrapper over Anchor's own event machinery:
 *   - `on` / `off` subscribe to a named event over the connection's `onLogs` firehose
 *     (delegates to `program.addEventListener` / `program.removeEventListener`).
 *   - `parseLogs` decodes an already-fetched log array (e.g. from
 *     `connection.getTransaction(...).meta.logMessages`) into `{name, data}` records,
 *     using Anchor's `EventParser` so CPI/program-context framing is handled correctly.
 *
 * NO instruction building lives here.
 *
 *   const id = dp.events.on("WindowFrozen", (e, slot, sig) => console.log(e, slot, sig));
 *   // ...later...
 *   await dp.events.off(id);
 *
 *   const tx = await dp.connection.getTransaction(sig, { maxSupportedTransactionVersion: 0 });
 *   const events = dp.events.parseLogs(tx?.meta?.logMessages ?? []);
 */
import { EventParser } from "@coral-xyz/anchor";
import type { DiamondPoolsClient } from "./client";

// ─── name casing: THE BUG THIS FILE USED TO HAVE ────────────────────────────
//
// Anchor 0.31's `BorshEventCoder` decodes an event's name to camelCase (`ppExitSettled`), NOT the
// IDL's PascalCase. `EventManager` then dispatches with
// `this._eventListeners.get(event.name)` — i.e. keyed on the CAMELCASE name.
//
// This file previously registered listeners under the PascalCase `EventName` and asserted in a
// comment that "the runtime BorshEventCoder emits the IDL's PascalCase names". That was backwards,
// and the consequence was silent: `on()` registered under a key dispatch never looks up, so **every
// listener registered through this API never fired**. Nothing threw; handlers simply never ran.
//
// Verified empirically, not from docs: `contracts/tests/dp/34-failsoft-events.test.ts` decodes real
// program logs through the same coder and gets `unclaimedRecorded` / `depositRefundUndeliverable`.
//
// The public API stays PascalCase — it mirrors the IDL and is what a reader expects — and the
// casing is normalised at the two boundaries instead.
const toCoderName = (n: string): string => n.charAt(0).toLowerCase() + n.slice(1);
const toIdlName = (n: string): string => n.charAt(0).toUpperCase() + n.slice(1);

/** Every event the diamond_pools program emits (mirrors the IDL `events` table). */
export type EventName =
  | "AdminCosignEvent"
  | "CapOverflow"
  | "CapStressed"
  | "ConfigChanged"
  | "DefensiveModeChanged"
  | "DepositRefundUndeliverable"
  | "DepositSettled"
  | "EvacOrphanProtocolSolSwept"
  | "EvacOrphanProtocolStoreSwept"
  | "EvacRedeemed"
  | "EvacuationExecuted"
  | "ExitCancelledUnusableAta"
  | "ExitTokenLegForfeited"
  | "ExternalFeeRebateClaimed"
  | "FeeDistributed"
  | "FeeExemptCleared"
  | "FeeExemptSet"
  | "FeePolicyChanged"
  | "MiningExitSettled"
  | "MonetizeFoldPricedAtPar"
  | "MonetizeFolded"
  | "MonetizePageSkipped"
  | "MonetizeResidualClaimed"
  | "MonetizeSold"
  | "MonetizeStaged"
  | "NavPerShareClamped"
  | "OpsWithdrawn"
  | "OrderSubmitted"
  | "PhantomDustCeilingBreached"
  | "PhantomRemarked"
  // ─── w3 increment (beta-week3) ───
  | "AccountSpaceMigrated"
  | "HarvestDustQuarantined"
  | "MonetizeDustSkipped"
  | "PoolsInitialized"
  | "PpExitNoticeSubmitted"
  | "PpExitSettled"
  | "ProtocolLiquidityToppedUp"
  | "ReferralClaimed"
  | "ReferralSwept"
  | "StakingExitSettled"
  | "WindowClosed"
  | "WindowFrozen"
  | "ConservationGateArmed"
  | "ConservationObserved"
  | "ExitDeferredReservedLiquidity"
  | "PpOreWrapped"
  | "PpSolConverted"
  | "UnclaimedClawedBack"
  | "UnclaimedOreClawedBack"
  | "UnclaimedOreRecorded"
  | "UnclaimedOreRestored"
  | "UnclaimedPaidOut"
  | "UnclaimedRecorded"
  // ─── fee surface rev 4 ───
  /** A performance charge landed. `stream` separates the exit trigger (0) from the weekly pass (1). */
  | "PerfFeeCharged"
  /** A weekly pass opened: `k` and the mark are sealed for every page of that cycle. */
  | "PerfPassOpened"
  /** The pass could not collect from a position — all-or-nothing, no ratchet, merges next cycle. */
  | "PerfPositionSkipped"
  /** The 50 bps staking-pool exit fee, stORE-denominated. */
  | "StakingExitFeeCharged"
  | "WindowPhaseAdvanced"
  // ─── genesis-2 increment ───
  /**
   * C1 — the LITE phantom was re-anchored to `physical − books` at a drained state.
   *
   * DELIBERATELY WIDE, and the width is the point: the write makes the conservation residual zero
   * BY CONSTRUCTION, so this event is the ONLY surviving evidence of what the books actually said
   * at the moment of the re-anchor. `absorbedOverClaim` is the field to read first — true means the
   * clear absorbed a provable over-claim and latched `defensiveMode` MANUAL-class, false means it
   * tidied pool-favour dust and escalated nothing.
   */
  | "PhantomReanchored"
  /**
   * C2 — the mining-exit fee, charged on the SOL leg at `pay_mining_exit`.
   *
   * `clamped` is the field that matters operationally: the fee is bounded by
   * `sol_out − perf_fee`, and that bound genuinely binds (`perf_fee` can equal `sol_out`), so a
   * short charge is the underflow guard doing its job rather than a misconfigured rate. Emitted
   * even when the fee lands at zero after clamping — "the rate was live and took nothing" is the
   * reading that is hardest to infer from anything else.
   */
  | "MiningExitFeeCharged"
  /**
   * The campaign re-init is ARMED — `set_emergency(EMERGENCY_END_OF_CAMPAIGN, true)`.
   *
   * A reviewable marker on chain BEFORE anything irreversible happens: at this point the decision
   * is still withdrawable. Treat it as the operational trigger to run the carry-over census, since
   * a `PpExitNotice` filed after the arm can never be cleared — its only closer is
   * `submit_pp_exit`, which requires `!wind_down`.
   */
  | "EndOfCampaignArmed"
  /**
   * A campaign ENDED and the next one began, on the same program id — `reinit_for_campaign`.
   *
   * The two monotonic latches an evacuation arms (`evacuated`, `wind_down`) are now cleared, so
   * the cascade and the intake rails are live again. It does NOT reopen the closed campaign: every
   * `redeem_evacuated_*` and `sweep_evac_custody` requires `evacuated == true` and refuses from
   * here on.
   *
   * The `prevEvac*` fields carry the CLOSED campaign's final evacuation snapshot, which the
   * re-establishment resets moments later — read them here or lose them. `campaignVersion` is the
   * new version; it advances by exactly one, so this event is the campaign boundary itself.
   */
  | "CampaignReinitialised";

/** A single decoded event, as returned by {@link EventsApi.parseLogs}. */
export interface DecodedEvent {
  /** The event name (one of {@link EventName}). */
  name: string;
  /** The decoded, camelCased event fields. Untyped by design — see the note in `types.ts`
   *  on why the IDL event map cannot be instantiated at this size. */
  data: any;
}

/** The handler invoked for every matching live event. */
export type EventHandler = (event: any, slot: number, signature: string) => void;

export class EventsApi {
  constructor(private readonly client: DiamondPoolsClient) {}

  /** Lazily-built parser (programId + coder are stable for the life of the client). */
  private _parser?: EventParser;
  private get parser(): EventParser {
    return (this._parser ??= new EventParser(this.client.programId, this.client.program.coder));
  }

  /**
   * Subscribe to a named event over the connection's log firehose. The handler
   * receives the decoded event data, the slot it was emitted in, and the tx
   * signature. Returns a listener id — pass it to {@link off} to unsubscribe.
   */
  on(name: EventName, handler: EventHandler): number {
    // The public API is PascalCase (matches the IDL); the runtime is camelCase. See the casing
    // note at the top of this file — getting this backwards is what made every listener silently
    // never fire.
    // The cast is also what keeps this file COMPILING. Anchor's `addEventListener` signature
    // instantiates the same `IdlEvents<DiamondPools>` map that `types.ts` had to drop — at 48
    // events that exceeds TypeScript's depth limit (TS2589), and it fails only on a clean build,
    // which is precisely what a consumer installing from git gets. Narrowing the method to its
    // runtime shape stops TS expanding the map without changing behaviour.
    const p = this.client.program as unknown as {
      addEventListener(name: string, handler: EventHandler): number;
    };
    // Register under the CAMELCASE name, because that is the key `EventManager` dispatches on.
    return p.addEventListener(toCoderName(name), handler);
  }

  /** Unsubscribe a listener previously registered with {@link on}. */
  off(listenerId: number): Promise<void> {
    return this.client.program.removeEventListener(listenerId);
  }

  /**
   * Decode diamond_pools events out of an already-fetched log array (the
   * `Program data:` base64 lines). Ignores logs from other programs / CPIs.
   * Returns `{name, data}` for every decodable event, in log order.
   */
  parseLogs(logs: string[]): DecodedEvent[] {
    const out: DecodedEvent[] = [];
    for (const event of this.parser.parseLogs(logs)) {
      // Back to PascalCase so a caller can compare against `EventName` and switch on the same
      // strings they pass to `on()`. Returning the coder's camelCase here would mean the two halves
      // of this API disagreed about what an event is called.
      out.push({ name: toIdlName(event.name), data: event.data });
    }
    return out;
  }
}
