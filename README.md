# @cwr/sdk

TypeScript SDK for the CWR multi-tranche vault on Solana. Wraps [@cwr/abi](../cwr-abi/) with typed methods, PDA derivation, event subscriptions, and off-chain math previews.

## Install

```bash
npm install @cwr/sdk
```

## Quick start

```ts
import { CwrVault, Bucket } from "@cwr/sdk";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair } from "@solana/web3.js";
import BN from "bn.js";

const connection = new Connection("https://api.mainnet-beta.solana.com");
const user = Keypair.fromSecretKey(/* ... */);
const provider = new AnchorProvider(connection, new Wallet(user), {});

const vault = new CwrVault({ connection, cluster: "mainnet", provider });

// Deposit 0.5 SOL into the Liquid bucket
const sig = await vault.user.deposit({
  bucket: Bucket.Liquid,
  amount: new BN(500_000_000),
  user,
});

// Read state
const snap = await vault.read.navSnapshot(Bucket.Liquid);
console.log("nav/share:", snap?.navPerShareX18.toString());

// Preview without submitting
const expectedShares = await vault.read.previewDeposit(Bucket.Liquid, new BN(1_000_000));
```

## Architecture

```
cwr-solana (contracts)
        ↓ anchor build
cwr-abi (canonical IDL + types)        ← published as @cwr/abi
        ↓ imports
cwr-sdk (this package)                 ← published as @cwr/sdk
        ↓ imports
   consumers (crank operator, frontend, third-party automators)
```

## API surface

The SDK is grouped by who can actually call each instruction:

### `vault.user.*` — anyone with their own keypair

| Method | Notes |
|---|---|
| `deposit({ bucket, amount, user })` | Mints shares at current NAV. Auto-creates user's ATA. |
| `requestWithdraw({ bucket, shares, user })` | Escrows shares, starts lockup timer. |
| `claimWithdraw({ bucket, user })` | Burns shares, pays SOL at live NAV. Reverts with `InsufficientVaultSol` if treasury underfunded. |

### `vault.crank.*` — the crank / operator surface

`crankMine` is signed by the bucket operator; the window/round pokes are
permissionless (the operator key fee-pays them — there is no separate signer key).

| Method | Notes |
|---|---|
| `crankMine({ bucket, amount, operator })` | Deploy SOL uniformly across all 25 ORE squares (BETTING phase, outside the guard band). |
| `checkpoint({ bucket, caller })` | Permissionless ORE Checkpoint CPI — settle the round. |
| `openWindow({ bucket, caller })` | BETTING → OPEN once the betting window elapses and the round is settled. |
| `closeWindow({ bucket, caller })` | OPEN → BETTING once the open window elapses. |
| `settleHarvest({ bucket, caller })` | Claim all SOL+ORE, wrap → stORE, advance the accumulator (first OPEN-window action). |

### `vault.admin.*` — only the admin authority (registered in `Config.admin`)

| Method | Notes |
|---|---|
| `initialize({ admin, feeRecipient, storeMint })` | One-shot config creation. |
| `initBucket({ bucketId, params, admin })` | Spin up a tranche (PDA + treasury + mint + escrow). |
| `setAdmin({ newAdmin, admin })` | Transfer admin role. |
| `setFeeRecipient({ newFeeRecipient, admin })` | Update fee destination. |
| `setBucketParams({ bucket, params, admin })` | Retune lockup, fees, jump bounds. |
| `setPause({ bucket, paused, admin })` | Kill switch — blocks deposits/requests/pulls/NAV updates. Claims still work. |

### `vault.read.*` — read-only, no signer required

| Method | Returns |
|---|---|
| `config()` | `Config` PDA |
| `bucket(b)` | `Bucket` PDA or null |
| `navSnapshot(b)` | Computed `{ solInVault, externalValue, totalNav, totalShares, navPerShareX18, paused, pendingWithdrawShares }` |
| `withdrawRequest(b, user)` | `WithdrawRequest` PDA or null |
| `userShares(b, user)` | u64 BN balance from user's share ATA |
| `mintSupply(b)` | u64 BN total supply |
| `treasuryLamports(b)` | Raw lamport balance of treasury PDA |
| `escrowBalance(b)` | Shares currently locked across all users |
| `previewDeposit(b, amount)` | Off-chain calc: shares minted for `amount` |
| `previewWithdraw(b, shares)` | Off-chain calc: SOL paid for `shares` |

### `vault.events.*` — log subscriptions

```ts
const unsub = vault.events.onDeposit(evt => console.log(evt));
const unsub2 = vault.events.onReportNav(evt => console.log(evt));
// ...
await unsub();
```

Supported: `onDeposit`, `onRequestWithdraw`, `onClaimWithdraw`, `onPull`, `onPush`, `onReportNav`, plus generic `on(name, handler)`.

## Off-chain math helpers

These mirror the contract's [math.rs](../cwr-solana/programs/cwr-vault/src/math.rs):

```ts
import { sharesForDeposit, payoutForShares, navPerShare, checkNavJump } from "@cwr/sdk";

const shares = sharesForDeposit(amount, totalShares, totalNav);
const payout = payoutForShares(shares, totalShares, totalNav);
const nps = navPerShare(totalNav, totalShares);
```

Use for previews, simulations, and front-end estimates. They throw on overflow / empty-vault / jump-exceeded just like the program.

## Error handling

Anchor errors are auto-decoded into typed `CwrSdkError`:

```ts
import { decodeCwrError, CwrErrorCode } from "@cwr/sdk";

try {
  await vault.user.claimWithdraw({ bucket: Bucket.Liquid, user });
} catch (err) {
  const cwrErr = decodeCwrError(err);
  if (cwrErr?.code === CwrErrorCode.InsufficientVaultSol) {
    console.log("Wait for operator top-up and retry");
  } else if (cwrErr?.code === CwrErrorCode.LockupActive) {
    console.log("Still locked, come back later");
  } else {
    throw err;
  }
}
```

## Examples

- [`01-simple-deposit.ts`](examples/01-simple-deposit.ts) — single deposit
- [`02-auto-claim.ts`](examples/02-auto-claim.ts) — watcher that auto-claims unlocked requests
- [`03-nav-subscriber.ts`](examples/03-nav-subscriber.ts) — dashboard / event tape

Run with `npx tsx examples/01-simple-deposit.ts`.

## Versioning

`@cwr/sdk` major version tracks `@cwr/abi` (which tracks the deployed program). Breaking program changes → both bump major. Method additions on the SDK without contract changes → minor bump.
