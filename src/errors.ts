/**
 * DiamondError code ⇄ name/message map, built from the IDL's error table (88 codes),
 * plus a parser that turns a thrown Anchor/SendTransaction error into its named code.
 */
import { DIAMOND_POOLS_IDL } from "@diamond/abi";

export interface DiamondErrorInfo {
  code: number;
  name: string;
  msg: string;
}

const idlErrors = ((DIAMOND_POOLS_IDL as any).errors ?? []) as Array<{
  code: number;
  name: string;
  msg?: string;
}>;

/** code → {code, name, msg} */
export const DIAMOND_ERRORS: Record<number, DiamondErrorInfo> = Object.fromEntries(
  idlErrors.map((e) => [e.code, { code: e.code, name: e.name, msg: e.msg ?? e.name }]),
);

/** name → code (e.g. `ERROR_CODE.WrongPhase`). */
export const ERROR_CODE: Record<string, number> = Object.fromEntries(
  idlErrors.map((e) => [e.name, e.code]),
);

export function errorInfo(code: number): DiamondErrorInfo | undefined {
  return DIAMOND_ERRORS[code];
}

/**
 * Best-effort extraction of a diamond_pools error name from a thrown error. Handles
 * AnchorError (`error.errorCode.code`), numeric custom-program codes in the logs, and
 * falls back to the stringified error.
 */
export function parseError(e: any): string {
  const code = e?.error?.errorCode?.code;
  if (typeof code === "string") return code;
  const num = e?.error?.errorCode?.number ?? e?.code;
  if (typeof num === "number" && DIAMOND_ERRORS[num]) return DIAMOND_ERRORS[num].name;
  const s = String(e?.message ?? e ?? "");
  const hex = s.match(/custom program error: 0x([0-9a-fA-F]+)/);
  if (hex) {
    const n = parseInt(hex[1], 16);
    if (DIAMOND_ERRORS[n]) return DIAMOND_ERRORS[n].name;
  }
  for (const info of Object.values(DIAMOND_ERRORS)) {
    if (s.includes(info.name)) return info.name;
  }
  return s;
}
