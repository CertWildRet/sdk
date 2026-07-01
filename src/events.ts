import { CwrVaultClient } from "./client";

/** Event names emitted by the V6 cwr_vault program (mirrors the IDL `events`). */
export type CwrEventName =
  | "InitializedEvent"
  | "BucketInitializedEvent"
  | "DepositEvent"
  | "WithdrawEvent"
  | "SetBucketOperatorEvent"
  | "SetFeeRecipientEvent"
  | "SetBucketParamsEvent"
  | "SetPauseEvent"
  | "SetDepositsOpenEvent"
  | "SetClaimsOpenEvent"
  | "SetFeesEvent"
  | "SetPullFeeEvent"
  | "SetPerfFeeEvent"
  | "FeeScheduleInitializedEvent"
  | "FeeScheduleUpdatedEvent"
  | "FeesDistributedEvent"
  // Two-step admin handover
  | "AdminProposedEvent"
  | "AdminTransferConfirmedEvent"
  | "AdminTransferAcceptedEvent"
  | "AdminTransferCancelledEvent"
  // V6 non-custodial mining
  | "MiningPdaInitializedEvent"
  | "CrankMineEvent"
  | "CheckpointEvent"
  | "SettleUoreEvent"
  | "BatchReplenishEvent"
  | "PhaseChangedEvent"
  // Admin-cosigned pool recapitalize / resolve
  | "ReseedPoolEvent"
  | "ResolvePoolEvent"
  // v1.2.0 dZINC staking + Stockpile
  | "ClaimZincYieldEvent"
  | "JoinZincStockpileEvent"
  | "PayoutZincStockpileEvent"
  | "ZincPoolStockpileCfgEvent"
  | "ZincPoolMigratedEvent";

export type EventHandler<T = any> = (event: T, slot: number, signature: string) => void;

export type Unsubscribe = () => Promise<void>;

export class EventsApi {
  constructor(private readonly c: CwrVaultClient) {}

  on<T = any>(name: CwrEventName, handler: EventHandler<T>): Unsubscribe {
    // Cast the program to `any` for this call: Anchor types addEventListener over
    // IdlEvents<CwrVault>, a deep mapped type that now exceeds TS's instantiation
    // depth (TS2589) as the IDL has grown. The event name is already validated by
    // the CwrEventName union above, so no type safety is lost here.
    const program = this.c.program as any;
    const id = program.addEventListener(name as any, handler as any);
    return async () => {
      await program.removeEventListener(id);
    };
  }

  onDeposit(handler: EventHandler) {
    return this.on("DepositEvent", handler);
  }

  onWithdraw(handler: EventHandler) {
    return this.on("WithdrawEvent", handler);
  }

  // V6 mining helpers
  onCrankMine(handler: EventHandler) {
    return this.on("CrankMineEvent", handler);
  }

  onCheckpoint(handler: EventHandler) {
    return this.on("CheckpointEvent", handler);
  }

  onSettleUore(handler: EventHandler) {
    return this.on("SettleUoreEvent", handler);
  }

  onBatchReplenish(handler: EventHandler) {
    return this.on("BatchReplenishEvent", handler);
  }

  onPhaseChanged(handler: EventHandler) {
    return this.on("PhaseChangedEvent", handler);
  }

  // V5 fee helpers
  onSetFees(handler: EventHandler) {
    return this.on("SetFeesEvent", handler);
  }

  onFeesDistributed(handler: EventHandler) {
    return this.on("FeesDistributedEvent", handler);
  }

  // v1.2.0 dZINC staking + Stockpile helpers
  onClaimZincYield(handler: EventHandler) {
    return this.on("ClaimZincYieldEvent", handler);
  }

  onJoinZincStockpile(handler: EventHandler) {
    return this.on("JoinZincStockpileEvent", handler);
  }

  onPayoutZincStockpile(handler: EventHandler) {
    return this.on("PayoutZincStockpileEvent", handler);
  }

  onZincPoolMigrated(handler: EventHandler) {
    return this.on("ZincPoolMigratedEvent", handler);
  }
}
