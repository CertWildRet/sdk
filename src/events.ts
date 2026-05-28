import { CwrVaultClient } from "./client";

export type CwrEventName =
  | "InitializedEvent"
  | "BucketInitializedEvent"
  | "DepositEvent"
  | "WithdrawEvent"
  | "PullEvent"
  | "PushEvent"
  | "ReportNavEvent"
  | "SetBackendEvent"
  | "SetAdminEvent"
  | "SetOperatorWalletEvent"
  | "SetFeeRecipientEvent"
  | "SetBucketParamsEvent"
  | "SetPauseEvent"
  | "SetDepositsOpenEvent"
  | "SetClaimsOpenEvent"
  // V5
  | "SetFeesEvent"
  | "FeeScheduleInitializedEvent"
  | "FeesDistributedEvent"
  | "PushStoreEvent";

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

  onPull(handler: EventHandler) {
    return this.on("PullEvent", handler);
  }

  onPush(handler: EventHandler) {
    return this.on("PushEvent", handler);
  }

  onReportNav(handler: EventHandler) {
    return this.on("ReportNavEvent", handler);
  }

  // V5 helpers
  onSetFees(handler: EventHandler) {
    return this.on("SetFeesEvent", handler);
  }

  onFeesDistributed(handler: EventHandler) {
    return this.on("FeesDistributedEvent", handler);
  }
}
