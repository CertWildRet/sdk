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
  | "SettleHarvestEvent"
  | "PhaseChangedEvent";

export type EventHandler<T = any> = (event: T, slot: number, signature: string) => void;

export type Unsubscribe = () => Promise<void>;

export class EventsApi {
  constructor(private readonly c: CwrVaultClient) {}

  on<T = any>(name: CwrEventName, handler: EventHandler<T>): Unsubscribe {
    const id = this.c.program.addEventListener(name as any, handler as any);
    return async () => {
      await this.c.program.removeEventListener(id);
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

  onSettleHarvest(handler: EventHandler) {
    return this.on("SettleHarvestEvent", handler);
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
}
