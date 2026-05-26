import { CwrVaultClient } from "./client";

export type CwrEventName =
  | "InitializedEvent"
  | "BucketInitializedEvent"
  | "DepositEvent"
  | "RequestWithdrawEvent"
  | "ClaimWithdrawEvent"
  | "PullEvent"
  | "PushEvent"
  | "ReportNavEvent"
  | "SetBackendEvent"
  | "SetAdminEvent"
  | "SetBucketParamsEvent"
  | "SetPauseEvent";

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

  onRequestWithdraw(handler: EventHandler) {
    return this.on("RequestWithdrawEvent", handler);
  }

  onClaimWithdraw(handler: EventHandler) {
    return this.on("ClaimWithdrawEvent", handler);
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
}
