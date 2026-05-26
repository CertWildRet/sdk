import BN from "bn.js";
import { BPS_DENOMINATOR, NAV_SCALE } from "./constants";

// Mirrors programs/cwr-vault/src/math.rs. Kept in sync manually; if you change
// math.rs, mirror it here and run the SDK tests.

export const MAX_NAV_PER_SHARE_X18 = new BN("1000000000000000000000000000000");

const ZERO = new BN(0);
const ONE = new BN(1);

/**
 * Compute shares minted for a deposit of `amount` lamports at the current
 * pre-deposit vault state. Floor division — favors vault by ≤ 1 lamport.
 */
export function sharesForDeposit(
  amount: BN,
  totalShares: BN,
  totalNav: BN,
): BN {
  if (amount.isZero()) return ZERO;
  if (totalShares.isZero()) return amount;
  if (totalNav.isZero()) {
    throw new Error("EmptyVault: shares outstanding but total_nav = 0");
  }
  return amount.mul(totalShares).div(totalNav);
}

/**
 * Compute SOL payout for a share redemption. Floor division — favors vault.
 */
export function payoutForShares(
  shares: BN,
  totalShares: BN,
  totalNav: BN,
): BN {
  if (shares.isZero()) return ZERO;
  if (totalShares.isZero()) {
    throw new Error("EmptyVault: cannot redeem from empty vault");
  }
  return totalNav.mul(shares).div(totalShares);
}

/**
 * NAV per share in 1e18 fixed point. Empty vault returns NAV_SCALE (1.0).
 */
export function navPerShare(totalNav: BN, totalShares: BN): BN {
  if (totalShares.isZero()) return NAV_SCALE;
  const nps = totalNav.mul(NAV_SCALE).div(totalShares);
  if (nps.gt(MAX_NAV_PER_SHARE_X18)) {
    throw new Error(`MathOverflow: nav_per_share ${nps} exceeds cap`);
  }
  return nps;
}

/**
 * Verify a NAV transition is within the bucket's jump bounds. Returns the
 * direction-classified result for telemetry; throws if out of bounds.
 */
export function checkNavJump(
  prevNps: BN,
  newNps: BN,
  maxUpBps: number,
  maxDownBps: number,
): { direction: "up" | "down" | "flat"; deltaAbs: BN } {
  if (prevNps.isZero()) return { direction: "flat", deltaAbs: ZERO };
  if (newNps.gt(prevNps)) {
    const delta = newNps.sub(prevNps);
    const allowed = prevNps.muln(maxUpBps).div(BPS_DENOMINATOR);
    if (delta.gt(allowed)) {
      throw new Error(
        `NavJumpExceeded: +${delta} exceeds allowed +${allowed} (${maxUpBps} bps)`,
      );
    }
    return { direction: "up", deltaAbs: delta };
  }
  if (newNps.lt(prevNps)) {
    const delta = prevNps.sub(newNps);
    const allowed = prevNps.muln(maxDownBps).div(BPS_DENOMINATOR);
    if (delta.gt(allowed)) {
      throw new Error(
        `NavJumpExceeded: -${delta} exceeds allowed -${allowed} (${maxDownBps} bps)`,
      );
    }
    return { direction: "down", deltaAbs: delta };
  }
  return { direction: "flat", deltaAbs: ZERO };
}

/**
 * Human-readable NAV per share as a JS number. Lossy for display only.
 * NAV/share is stored as 1e18 fixed point; divide to get the scalar.
 */
export function navPerShareToNumber(npsX18: BN): number {
  const scale = NAV_SCALE.toString();
  const npsStr = npsX18.toString();
  if (npsStr.length <= scale.length) {
    const padded = npsStr.padStart(scale.length + 1, "0");
    const wholeLen = padded.length - scale.length + 1;
    const whole = padded.slice(0, wholeLen);
    const frac = padded.slice(wholeLen);
    return Number(`${whole}.${frac}`);
  }
  const wholeLen = npsStr.length - scale.length + 1;
  const whole = npsStr.slice(0, wholeLen);
  const frac = npsStr.slice(wholeLen);
  return Number(`${whole}.${frac}`);
}

/**
 * For display: lamports → SOL as a JS number (loses precision past ~1B SOL).
 */
export function lamportsToSol(lamports: BN | number | bigint): number {
  const bn = BN.isBN(lamports) ? lamports : new BN(lamports.toString());
  return Number(bn.toString()) / 1_000_000_000;
}
