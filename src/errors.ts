// Mirror of programs/cwr-vault/src/errors.rs. Numeric codes match the IDL.
// Keep in sync manually when CwrError variants change.

export enum CwrErrorCode {
  NotAdmin = 6000,
  /** Reserved slot for a removed V5 role error; kept so later codes don't renumber. */
  ReservedRoleErr = 6001,
  NotOperator = 6002,
  BucketPaused = 6003,
  BucketAlreadyInitialized = 6004,
  InvalidBucketId = 6005,
  DepositsClosed = 6006,
  ClaimsClosed = 6007,
  NavFrozen = 6008,
  DepositBelowMinimum = 6009,
  DepositExceedsCap = 6010,
  ZeroShares = 6011,
  ZeroAmount = 6012,
  InsufficientVaultSol = 6013,
  InsufficientPullable = 6014,
  MathOverflow = 6015,
  MathUnderflow = 6016,
  BadPerformanceFee = 6017,
  NavJumpExceeded = 6018,
  NavRateLimited = 6019,
  NavIntervalTooShort = 6020,
  EmptyVault = 6021,
  BucketNotEmpty = 6022,
  BadDepositBounds = 6023,
  // V5 flat fee model
  BadEntryFee = 6024,
  BadExitFee = 6025,
  FeeScheduleSplitInvalid = 6026,
  FeeScheduleAlreadyInit = 6027,
  FeeBucketEmpty = 6028,
  FeeRecipientMismatch = 6029,
  FeeRecipientCountMismatch = 6030,
  // V5 basket payout
  InsufficientStoreInVault = 6031,
  StoreMintNotConfigured = 6032,
}

export const CWR_ERROR_NAMES: Record<number, string> = {
  6000: "NotAdmin",
  6001: "ReservedRoleErr",
  6002: "NotOperator",
  6003: "BucketPaused",
  6004: "BucketAlreadyInitialized",
  6005: "InvalidBucketId",
  6006: "DepositsClosed",
  6007: "ClaimsClosed",
  6008: "NavFrozen",
  6009: "DepositBelowMinimum",
  6010: "DepositExceedsCap",
  6011: "ZeroShares",
  6012: "ZeroAmount",
  6013: "InsufficientVaultSol",
  6014: "InsufficientPullable",
  6015: "MathOverflow",
  6016: "MathUnderflow",
  6017: "BadPerformanceFee",
  6018: "NavJumpExceeded",
  6019: "NavRateLimited",
  6020: "NavIntervalTooShort",
  6021: "EmptyVault",
  6022: "BucketNotEmpty",
  6023: "BadDepositBounds",
  6024: "BadEntryFee",
  6025: "BadExitFee",
  6026: "FeeScheduleSplitInvalid",
  6027: "FeeScheduleAlreadyInit",
  6028: "FeeBucketEmpty",
  6029: "FeeRecipientMismatch",
  6030: "FeeRecipientCountMismatch",
  6031: "InsufficientStoreInVault",
  6032: "StoreMintNotConfigured",
};

export class CwrSdkError extends Error {
  readonly code: number | undefined;
  readonly name: string;
  constructor(message: string, code?: number) {
    super(message);
    this.name = "CwrSdkError";
    this.code = code;
  }
}

/**
 * Extract a CWR program error from an Anchor / web3 rejection. Returns null if
 * the error came from somewhere else (network, account validation, etc).
 */
export function decodeCwrError(err: unknown): CwrSdkError | null {
  if (!err || typeof err !== "object") return null;
  const anyErr = err as any;
  const code: number | undefined =
    anyErr?.error?.errorCode?.number ??
    anyErr?.errorCode?.number ??
    (typeof anyErr?.code === "number" ? anyErr.code : undefined);
  if (code === undefined) return null;
  const name = CWR_ERROR_NAMES[code];
  if (!name) return null;
  return new CwrSdkError(
    `${name} (${code}): ${anyErr?.error?.errorMessage ?? anyErr?.message ?? "no message"}`,
    code,
  );
}
