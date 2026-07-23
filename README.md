# @diamond/sdk

TypeScript SDK for **Diamond Pools** — a non-custodial three-pool ORE vault on Solana (Mining / Staking / Protocol). Wraps [@diamond/abi](../abi/)'s IDL with a typed Anchor client: instruction builders, PDA derivation, account + event decoding, error mapping, and off-chain NAV previews.

Program: `FMecQfZ1qbt87GNGVU1xNDnsFnHH78Dwz74qaTumSRsB`.

## Install

```bash
npm install @diamond/sdk
```

## Quickstart

```ts
import { DiamondPoolsClient } from "@diamond/sdk";
import { Connection, Transaction } from "@solana/web3.js";

const dp = new DiamondPoolsClient({ connection, wallet }); // wallet optional (read-only without)

// user — build an instruction, then sign+send however you like
const ix = await dp.user.depositMining(owner.publicKey, 1_000_000n);
await dp.provider.sendAndConfirm(new Transaction().add(ix), [owner]);

// read
const cfg = await dp.read.config();
const wid = await dp.read.currentWindowId();
const nav = await dp.read.miningNav();

// events
const id = dp.events.on("WindowFrozen", (e) => console.log(e));
await dp.events.off(id);
```

## API surface

Every builder returns a `Promise<TransactionInstruction>` — compose, sign, and send with your own wallet/relayer. The IDL embeds all PDA seeds, so PDAs are resolved for you; you pass only the signers, mints, and external ORE accounts.

- **`dp.user`** — `depositMining`, `depositStore(poolId, …)`, `submitWithdraw(poolId, …)`, `submitPpExitNotice`, `submitPpExit`, `claimReferral`, `claimExternalFeeRebate`.
- **`dp.crank`** — the cascade + keeper cranks: `crankFreeze`, `crankAdvancePhase`, `settleMiningDeposit` / `settleStakingDeposit` / `settleProtocolDeposit`, `measureMiningExit`, `payMiningExit`, `settleStakingExit`, `settlePpExit`, `crankCapRebalance`, `crankBatch`, `crankRemarkPhantom`, `crankCheckpoint`, `crankMine`, the monetize cranks (`crankMonetizeSell/ClaimResidual/Stage/Fold/Abort`), `distributeFees` / `distributeFeesStore`, `distributeReferrals`, `sweepReferralSurplus`, `fundMiningAuthority`, `closeMiningPosition`.
- **`dp.admin`** — `initialize`, `setParam`, `setEmergency`, `setFeeSchedule`, `setFeePolicy`, `opsWithdraw`, `setFeeExempt` / `clearFeeExempt`, `topUpProtocolLiquidity`, `setKeeper`, `setSettlementAuthority`, `setAdminTransferConfirmer`, `proposeAdmin` / `confirmAdminTransfer` / `acceptAdmin` / `cancelAdminTransfer`, `addWhitelist` / `removeWhitelist`, `initReferral`.
- **`dp.evac`** — `evacuateClaimAll`, `redeemEvacuated{Mining,Staking,Protocol}`, `sweepEvacCustody`.
- **`dp.read`** — typed account fetchers (`config`, `miningPool`, `stakingPool`, `protocolPool`, `feeExemptEntry(wallet)`, `position(poolId, owner)`, `window(id)`, …) + `currentWindowId()` + `miningNav()`.
- **`dp.events`** — `on(name, handler)`, `off(id)`, `parseLogs(logs)`.

## Cosigned instructions

Admin config mutations (`setParam`, `setEmergency`, `setFeeSchedule`, `setKeeper`, `setSettlementAuthority`, `addWhitelist`, `removeWhitelist`, `initReferral`), `evacuateClaimAll` / `sweepEvacCustody`, and `crankMonetizeAbort` require an Ed25519 fee-holder second factor. ABORT is cosigned because the admin becomes the recovery counterparty and receives the full staged stORE custody. Build the cosign and prepend it in the **same** transaction:

```ts
import { buildCosignEd25519Ix } from "@diamond/sdk";

const ix = await dp.admin.setParam(admin.publicKey, field, value);
const cfg = await dp.read.config();
const ed = buildCosignEd25519Ix({
  cosigner,                       // a current fee holder (Keypair)
  ix,
  nonce: BigInt(cfg.adminAuthNonce.toString()),
  signedTs: BigInt(Math.floor(Date.now() / 1000)),
});
await dp.provider.sendAndConfirm(new Transaction().add(ed, ix), [admin]);
```

Referral `claimReferral` / `distributeReferrals` / `sweepReferralSurplus` similarly need a settlement-authority attestation — see `buildReferralClaimAttestation` / `buildReferralSweepAttestation`.

## Errors

```ts
import { parseError } from "@diamond/sdk";

try {
  await dp.provider.sendAndConfirm(tx, signers);
} catch (e) {
  const name = parseError(e);           // e.g. "WrongPhase"
  if (name === "WrongPhase") { /* … */ }
}
```

`DIAMOND_ERRORS` (code → {name, msg}) and `ERROR_CODE` (name → code) are exported for the full 92-code table.

The SDK's build gate checks that all 56 ABI instructions have a builder. The pinned ABI currently exposes 14 accounts, 33 events, and 92 errors.

## Versioning

`@diamond/sdk` tracks `@diamond/abi` (which tracks the deployed program). Breaking program changes → both bump major; SDK-only additions → minor.
