/**
 * EventsApi — live event subscription + offline log decoding for diamond_pools.
 *
 * The program emits 26 Anchor events (Borsh-encoded, base64, on the `Program data:`
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

/** Every event the diamond_pools program emits (mirrors the IDL `events` table). */
export type EventName =
  | "AdminCosignEvent"
  | "BatchCrystallized"
  | "CapOverflow"
  | "CapStressed"
  | "ConfigChanged"
  | "DefensiveModeChanged"
  | "DepositSettled"
  | "EvacRedeemed"
  | "EvacuationExecuted"
  | "FeeDistributed"
  | "MiningExitSettled"
  | "MonetizeFolded"
  | "MonetizeSold"
  | "MonetizeStaged"
  | "OrderSubmitted"
  | "PhantomDustCeilingBreached"
  | "PhantomRemarked"
  | "PoolsInitialized"
  | "PpExitNoticeSubmitted"
  | "PpExitSettled"
  | "ReferralClaimed"
  | "ReferralSwept"
  | "StakingExitSettled"
  | "TreasuryAdvance"
  | "WindowFrozen"
  | "WindowPhaseAdvanced";

/** A single decoded event, as returned by {@link EventsApi.parseLogs}. */
export interface DecodedEvent {
  /** The event name (one of {@link EventName}). */
  name: string;
  /** The decoded, camelCased event fields (typed via `DiamondEvents[name]`). */
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
    // NOTE: Anchor 0.31's `addEventListener` type camelCases event names, but the
    // runtime `BorshEventCoder` emits — and this listener map matches on — the IDL's
    // PascalCase names (what `decode()` returns as `event.name`). We keep the public
    // API PascalCase (runtime-correct, matches the IDL) and bridge the type here.
    return this.client.program.addEventListener(name as never, handler);
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
      out.push({ name: event.name, data: event.data });
    }
    return out;
  }
}
