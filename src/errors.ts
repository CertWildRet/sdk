// Mirror of programs/cwr-vault/src/errors.rs. Numeric codes match the IDL.
// Keep in sync manually when CwrError variants change.

export enum CwrErrorCode {
  NotAdmin = 6000,
  NotBackend = 6001,
  BucketPaused = 6002,
  BucketAlreadyInitialized = 6003,
  InvalidBucketId = 6004,
  DepositBelowMinimum = 6005,
  DepositExceedsCap = 6006,
  ZeroShares = 6007,
  LockupActive = 6008,
  OutstandingWithdraw = 6009,
  NoOutstandingWithdraw = 6010,
  InsufficientVaultSol = 6011,
  InsufficientPullable = 6012,
  MathOverflow = 6013,
  MathUnderflow = 6014,
  BadPerformanceFee = 6015,
  NavJumpExceeded = 6016,
  NavRateLimited = 6017,
  BadLockup = 6018,
  EmptyVault = 6019,
  BucketNotEmpty = 6020,
}

export const CWR_ERROR_NAMES: Record<number, string> = {
  6000: "NotAdmin",
  6001: "NotBackend",
  6002: "BucketPaused",
  6003: "BucketAlreadyInitialized",
  6004: "InvalidBucketId",
  6005: "DepositBelowMinimum",
  6006: "DepositExceedsCap",
  6007: "ZeroShares",
  6008: "LockupActive",
  6009: "OutstandingWithdraw",
  6010: "NoOutstandingWithdraw",
  6011: "InsufficientVaultSol",
  6012: "InsufficientPullable",
  6013: "MathOverflow",
  6014: "MathUnderflow",
  6015: "BadPerformanceFee",
  6016: "NavJumpExceeded",
  6017: "NavRateLimited",
  6018: "BadLockup",
  6019: "EmptyVault",
  6020: "BucketNotEmpty",
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
