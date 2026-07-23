/**
 * CrankApi — the permissionless / keeper cranks that drive a window through its
 * cascade (freeze → advance → settle deposits → exits → cap-rebalance → batch → open)
 * plus the keeper-gated ORE mining loop (checkpoint / mine / fund) and the §5.6b
 * monetization cranks. Every builder returns an unsigned `TransactionInstruction`;
 * the caller adds fee-payer + signatures and sends.
 *
 * A `cranker` (fee-payer) is a normal signer for the permissionless cranks; the
 * ORE mining cranks (`crankMine`, `fundMiningAuthority`) require the configured
 * keeper as signer. Account maps are ported 1:1 from the bankrun-proven
 * `tests/dp/flows.ts`, or derived from the @diamond/abi IDL where no flow exists.
 */
import BN from "bn.js";
import {
  type AccountMeta,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import type { DiamondPoolsClient } from "./client";
import {
  ORE_PROGRAM_ID,
  STORE_MINT,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  POOL_MINING,
  POOL_STAKING,
  POOL_PROTOCOL,
  ORDER_KIND_DEPOSIT,
  ORDER_KIND_WITHDRAW,
  u64le,
} from "./constants";
import {
  pdaConfig,
  pdaMiningPool,
  pdaStakingPool,
  pdaProtocolPool,
  pdaFeeSchedule,
  pdaFeeBucket,
  pdaReferralConfig,
  pdaReferralTreasury,
  pdaMiningAuthority,
  pdaPhantomMember,
  pdaWindow,
  pdaPosition,
  pdaOrder,
  pdaVault,
  pdaReferrer,
  oreBoardPda,
  oreTreasuryPda,
  oreStakeStakePda,
  miningAuthorityMinerPda,
} from "./pdas";

const bn = (n: bigint | number) => new BN(n.toString());
const storeAta = (owner: PublicKey) => getAssociatedTokenAddressSync(STORE_MINT, owner, true);

// ─── ORE-side PDAs not covered by pdas.ts (crank_checkpoint / crank_mine) ─────
const oreAutomationPda = (authority: PublicKey): PublicKey =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("automation", "utf8"), authority.toBuffer()],
    ORE_PROGRAM_ID,
  )[0];
const oreConfigPda = (): PublicKey =>
  PublicKey.findProgramAddressSync([Buffer.from("config", "utf8")], ORE_PROGRAM_ID)[0];
const oreRoundPda = (roundId: bigint | number): PublicKey =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("round", "utf8"), u64le(roundId)],
    ORE_PROGRAM_ID,
  )[0];

/**
 * ORE entropy accounts for `crank_mine`'s Deploy CPI. Only touched on the first
 * deploy of a round, but the ORE handler destructures both metas so they are always
 * required. These are ORE's immutable mainnet addresses; override for other clusters.
 */
export const ORE_ENTROPY_VAR = new PublicKey("BWCaDY96Xe4WkFq1M7UiCCRcChsJ3p51L5KrGzhxgm2E");
export const ORE_ENTROPY_PROGRAM = new PublicKey("3jSkUuYBoJzQPMEzTvkDFXCZUBksPamrVhrnHR9igu2X");

export class CrankApi {
  constructor(private readonly client: DiamondPoolsClient) {}

  // ─── cascade cranks ─────────────────────────────────────────────────────────

  /**
   * Freeze the current INTAKE window (warp past its cutoff first). Snapshots the
   * pool ratios, harvests the ORE miner, and opens the next intake window. Reads the
   * current window id from Config unless `windowId` is supplied (saves one RPC).
   */
  async crankFreeze(cranker: PublicKey, windowId?: bigint): Promise<TransactionInstruction> {
    const wid = windowId ?? (await this.currentWindowId());
    const miningAuthority = pdaMiningAuthority()[0];
    return this.client.program.methods
      .crankFreeze()
      .accountsPartial({
        config: pdaConfig()[0],
        window: pdaWindow(wid)[0],
        nextWindow: pdaWindow(wid + 1n)[0],
        miningPool: pdaMiningPool()[0],
        stakingPool: pdaStakingPool()[0],
        protocolPool: pdaProtocolPool()[0],
        phantomMember: pdaPhantomMember()[0],
        miningAuthority,
        miningVault: pdaVault(POOL_MINING)[0],
        oreMiner: miningAuthorityMinerPda()[0],
        oreBoard: oreBoardPda()[0],
        oreTreasury: oreTreasuryPda()[0],
        oreStakeStake: oreStakeStakePda()[0],
        storeMint: STORE_MINT,
        oreProgram: ORE_PROGRAM_ID,
        cranker,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /** Advance a processed window one phase (FROZEN → DEPOSITS → … → OPEN). */
  async crankAdvancePhase(windowId: bigint, cranker: PublicKey): Promise<TransactionInstruction> {
    return this.client.program.methods
      .crankAdvancePhase()
      .accountsPartial({ window: pdaWindow(windowId)[0], cranker })
      .instruction();
  }

  /** TREASURY_ADV → BATCH: rebalance the ST/PP stORE reserves to their caps. */
  async crankCapRebalance(windowId: bigint, cranker: PublicKey): Promise<TransactionInstruction> {
    const stAuth = pdaVault(POOL_STAKING)[0];
    const ppAuth = pdaVault(POOL_PROTOCOL)[0];
    return this.client.program.methods
      .crankCapRebalance()
      .accountsPartial({
        config: pdaConfig()[0],
        window: pdaWindow(windowId)[0],
        miningPool: pdaMiningPool()[0],
        stakingPool: pdaStakingPool()[0],
        protocolPool: pdaProtocolPool()[0],
        storeMint: STORE_MINT,
        stakingVaultAuthority: stAuth,
        stakingVaultAta: storeAta(stAuth),
        protocolVaultAuthority: ppAuth,
        protocolVaultAta: storeAta(ppAuth),
        cranker,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
  }

  /** BATCH → OPEN: finalize the window's batched mining bookkeeping. */
  async crankBatch(windowId: bigint, cranker: PublicKey): Promise<TransactionInstruction> {
    return this.client.program.methods
      .crankBatch()
      .accountsPartial({
        window: pdaWindow(windowId)[0],
        miningPool: pdaMiningPool()[0],
        cranker,
      })
      .instruction();
  }

  /** §5.2 LITE: refine the phantom member + fold any pure surplus into the PP book. */
  async crankRemarkPhantom(cranker: PublicKey): Promise<TransactionInstruction> {
    return this.client.program.methods
      .crankRemarkPhantom()
      .accountsPartial({
        config: pdaConfig()[0],
        miningPool: pdaMiningPool()[0],
        protocolPool: pdaProtocolPool()[0],
        phantomMember: pdaPhantomMember()[0],
        cranker,
      })
      .instruction();
  }

  // ─── deposit settlement ─────────────────────────────────────────────────────

  /** Settle a queued mining deposit for `owner` (mints shares, takes the deposit fee). */
  async settleMiningDeposit(
    owner: PublicKey,
    windowId: bigint,
    cranker: PublicKey,
  ): Promise<TransactionInstruction> {
    return this.client.program.methods
      .settleMiningDeposit()
      .accountsPartial({
        config: pdaConfig()[0],
        window: pdaWindow(windowId)[0],
        miningPool: pdaMiningPool()[0],
        position: pdaPosition(POOL_MINING, owner)[0],
        order: pdaOrder(windowId, owner, POOL_MINING, ORDER_KIND_DEPOSIT)[0],
        miningVault: pdaVault(POOL_MINING)[0],
        feeBucket: pdaFeeBucket()[0],
        owner,
        cranker,
      })
      .instruction();
  }

  /** Settle a queued staking (stORE) deposit for `owner`. */
  async settleStakingDeposit(
    owner: PublicKey,
    windowId: bigint,
    cranker: PublicKey,
  ): Promise<TransactionInstruction> {
    const stAuth = pdaVault(POOL_STAKING)[0];
    const ppAuth = pdaVault(POOL_PROTOCOL)[0];
    const feeBucket = pdaFeeBucket()[0];
    return this.client.program.methods
      .settleStakingDeposit()
      .accountsPartial({
        config: pdaConfig()[0],
        window: pdaWindow(windowId)[0],
        stakingPool: pdaStakingPool()[0],
        protocolPool: pdaProtocolPool()[0],
        position: pdaPosition(POOL_STAKING, owner)[0],
        order: pdaOrder(windowId, owner, POOL_STAKING, ORDER_KIND_DEPOSIT)[0],
        stakingVaultAuthority: stAuth,
        protocolVaultAuthority: ppAuth,
        feeBucket,
        storeMint: STORE_MINT,
        stakingVaultAta: storeAta(stAuth),
        ppVaultAta: storeAta(ppAuth),
        feeStoreAta: storeAta(feeBucket),
        owner,
        cranker,
      })
      .instruction();
  }

  /** Settle a queued protocol (stORE, in-kind) deposit for `owner`. */
  async settleProtocolDeposit(
    owner: PublicKey,
    windowId: bigint,
    cranker: PublicKey,
  ): Promise<TransactionInstruction> {
    const ppAuth = pdaVault(POOL_PROTOCOL)[0];
    const feeBucket = pdaFeeBucket()[0];
    return this.client.program.methods
      .settleProtocolDeposit()
      .accountsPartial({
        config: pdaConfig()[0],
        window: pdaWindow(windowId)[0],
        protocolPool: pdaProtocolPool()[0],
        position: pdaPosition(POOL_PROTOCOL, owner)[0],
        order: pdaOrder(windowId, owner, POOL_PROTOCOL, ORDER_KIND_DEPOSIT)[0],
        protocolVaultAuthority: ppAuth,
        feeBucket,
        storeMint: STORE_MINT,
        protocolVaultAta: storeAta(ppAuth),
        feeStoreAta: storeAta(feeBucket),
        owner,
        ownerStoreAta: storeAta(owner),
        cranker,
      })
      .instruction();
  }

  // ─── exit settlement ────────────────────────────────────────────────────────

  /** MINING_EXITS phase, step 1: measure `owner`'s mining exit (prices the withdrawal). */
  async measureMiningExit(
    owner: PublicKey,
    windowId: bigint,
    cranker: PublicKey,
  ): Promise<TransactionInstruction> {
    return this.client.program.methods
      .measureMiningExit()
      .accountsPartial({
        config: pdaConfig()[0],
        window: pdaWindow(windowId)[0],
        miningPool: pdaMiningPool()[0],
        stakingPool: pdaStakingPool()[0],
        protocolPool: pdaProtocolPool()[0],
        position: pdaPosition(POOL_MINING, owner)[0],
        order: pdaOrder(windowId, owner, POOL_MINING, ORDER_KIND_WITHDRAW)[0],
        cranker,
      })
      .instruction();
  }

  /** MINING_EXITS phase, step 2: pay `owner`'s measured mining exit in stORE. */
  async payMiningExit(
    owner: PublicKey,
    windowId: bigint,
    cranker: PublicKey,
  ): Promise<TransactionInstruction> {
    const stAuth = pdaVault(POOL_STAKING)[0];
    const ppAuth = pdaVault(POOL_PROTOCOL)[0];
    return this.client.program.methods
      .payMiningExit()
      .accountsPartial({
        config: pdaConfig()[0],
        window: pdaWindow(windowId)[0],
        miningPool: pdaMiningPool()[0],
        stakingPool: pdaStakingPool()[0],
        protocolPool: pdaProtocolPool()[0],
        phantomMember: pdaPhantomMember()[0],
        position: pdaPosition(POOL_MINING, owner)[0],
        order: pdaOrder(windowId, owner, POOL_MINING, ORDER_KIND_WITHDRAW)[0],
        miningVault: pdaVault(POOL_MINING)[0],
        storeMint: STORE_MINT,
        stakingVaultAuthority: stAuth,
        stakingVaultAta: storeAta(stAuth),
        protocolVaultAuthority: ppAuth,
        protocolVaultAta: storeAta(ppAuth),
        exiter: owner,
        exiterStoreAta: storeAta(owner),
        cranker,
      })
      .instruction();
  }

  /** STAKING_EXITS phase: settle `owner`'s staking exit (rung-3 self-claim ORE accounts,
   *  if any, go in `remainingAccounts` — empty on v1). When populated (monetize/LITE
   *  un-darkening), it is the 18-account rung-3 set: the last two MUST be
   *  ore_stake_program (stakecNP3) then ore_lst_program (storeD7 = the ix_wrap callee). */
  async settleStakingExit(
    owner: PublicKey,
    windowId: bigint,
    cranker: PublicKey,
  ): Promise<TransactionInstruction> {
    const stAuth = pdaVault(POOL_STAKING)[0];
    const ppAuth = pdaVault(POOL_PROTOCOL)[0];
    return this.client.program.methods
      .settleStakingExit()
      .accountsPartial({
        config: pdaConfig()[0],
        window: pdaWindow(windowId)[0],
        stakingPool: pdaStakingPool()[0],
        protocolPool: pdaProtocolPool()[0],
        position: pdaPosition(POOL_STAKING, owner)[0],
        order: pdaOrder(windowId, owner, POOL_STAKING, ORDER_KIND_WITHDRAW)[0],
        storeMint: STORE_MINT,
        stakingVaultAuthority: stAuth,
        stakingVaultAta: storeAta(stAuth),
        protocolVaultAuthority: ppAuth,
        protocolVaultAta: storeAta(ppAuth),
        exiter: owner,
        exiterStoreAta: storeAta(owner),
        cranker,
      })
      .instruction();
  }

  /** PP_EXITS phase: settle `owner`'s protocol-pool exit (stORE + accrued SOL leg). */
  async settlePpExit(
    owner: PublicKey,
    windowId: bigint,
    cranker: PublicKey,
  ): Promise<TransactionInstruction> {
    const ppAuth = pdaVault(POOL_PROTOCOL)[0];
    return this.client.program.methods
      .settlePpExit()
      .accountsPartial({
        config: pdaConfig()[0],
        window: pdaWindow(windowId)[0],
        protocolPool: pdaProtocolPool()[0],
        position: pdaPosition(POOL_PROTOCOL, owner)[0],
        order: pdaOrder(windowId, owner, POOL_PROTOCOL, ORDER_KIND_WITHDRAW)[0],
        storeMint: STORE_MINT,
        protocolVaultAuthority: ppAuth,
        protocolVaultAta: storeAta(ppAuth),
        exiter: owner,
        exiterStoreAta: storeAta(owner),
        cranker,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  // ─── keeper-gated ORE mining loop ───────────────────────────────────────────

  /**
   * Settle an ORE round via checkpoint (permissionless; unblocks the next FREEZE).
   * `roundId` selects the ORE round PDA to settle. The ORE automation/board/miner/
   * round/treasury accounts are derived from the pinned mining authority.
   */
  async crankCheckpoint(cranker: PublicKey, roundId: bigint): Promise<TransactionInstruction> {
    const miningAuthority = pdaMiningAuthority()[0];
    return this.client.program.methods
      .crankCheckpoint(bn(roundId))
      .accountsPartial({
        miningPool: pdaMiningPool()[0],
        miningAuthority,
        oreAutomation: oreAutomationPda(miningAuthority),
        oreBoard: oreBoardPda()[0],
        oreMiner: miningAuthorityMinerPda()[0],
        oreRound: oreRoundPda(roundId),
        oreTreasury: oreTreasuryPda()[0],
        oreProgram: ORE_PROGRAM_ID,
        cranker,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /**
   * Keeper-gated bounded ORE Deploy: deploy `perTile` lamports to each tile set in
   * `tilesMask` (25-bit mask) for round `roundId`. Signer MUST be the configured keeper.
   * `entropyVar`/`entropyProgram` default to ORE's immutable mainnet accounts.
   */
  async crankMine(
    keeper: PublicKey,
    roundId: bigint,
    tilesMask: number,
    perTile: bigint,
    entropyVar: PublicKey = ORE_ENTROPY_VAR,
    entropyProgram: PublicKey = ORE_ENTROPY_PROGRAM,
  ): Promise<TransactionInstruction> {
    const wid = await this.currentWindowId();
    const miningAuthority = pdaMiningAuthority()[0];
    return this.client.program.methods
      .crankMine(bn(roundId), tilesMask, bn(perTile))
      .accountsPartial({
        config: pdaConfig()[0],
        window: pdaWindow(wid)[0],
        miningPool: pdaMiningPool()[0],
        protocolPool: pdaProtocolPool()[0],
        miningVault: pdaVault(POOL_MINING)[0],
        miningAuthority,
        protocolVault: pdaVault(POOL_PROTOCOL)[0],
        feeBucket: pdaFeeBucket()[0],
        oreAutomation: oreAutomationPda(miningAuthority),
        oreBoard: oreBoardPda()[0],
        oreConfig: oreConfigPda(),
        oreMiner: miningAuthorityMinerPda()[0],
        oreRound: oreRoundPda(roundId),
        oreProgram: ORE_PROGRAM_ID,
        entropyVar,
        entropyProgram,
        keeper,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /**
   * Top up the mining authority hot wallet's rent + checkpoint-fee reserve from the
   * mining SOL vault. Keeper-gated: `funder` MUST be the configured keeper.
   */
  async fundMiningAuthority(funder: PublicKey, amount: bigint): Promise<TransactionInstruction> {
    return this.client.program.methods
      .fundMiningAuthority(bn(amount))
      .accountsPartial({
        miningPool: pdaMiningPool()[0],
        config: pdaConfig()[0],
        miningVault: pdaVault(POOL_MINING)[0],
        miningAuthority: pdaMiningAuthority()[0],
        keeper: funder,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  // ─── §5.6b monetization (dark path) ─────────────────────────────────────────

  /**
   * SELL one mining position (`owner`) through ST first, PP second, and the
   * attributed claim residual. Paged; signer is the keeper.
   */
  async crankMonetizeSell(
    keeper: PublicKey,
    owner: PublicKey,
    windowId: bigint,
  ): Promise<TransactionInstruction> {
    const stAuth = pdaVault(POOL_STAKING)[0];
    const ppAuth = pdaVault(POOL_PROTOCOL)[0];
    const miningAuthority = pdaMiningAuthority()[0];
    return this.client.program.methods
      .crankMonetizeSell()
      .accountsPartial({
        config: pdaConfig()[0],
        window: pdaWindow(windowId)[0],
        miningPool: pdaMiningPool()[0],
        stakingPool: pdaStakingPool()[0],
        protocolPool: pdaProtocolPool()[0],
        phantomMember: pdaPhantomMember()[0],
        oreMiner: miningAuthorityMinerPda()[0],
        position: pdaPosition(POOL_MINING, owner)[0],
        storeMint: STORE_MINT,
        stakingVaultAuthority: stAuth,
        stakingVaultAta: storeAta(stAuth),
        protocolVaultAuthority: ppAuth,
        protocolVaultAta: storeAta(ppAuth),
        miningAuthority,
        monetizeStoreAta: storeAta(miningAuthority),
        keeper,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();
  }

  /**
   * CLAIM_RESIDUAL: after all SELL pages, remove the attributed residual from
   * the shared miner, reconcile its measured leg mix through LITE, and wrap the
   * credited amount into monetize custody. `remainingAccounts` must be the
   * canonical 18-account ORE claim/wrap set.
   */
  async crankMonetizeClaimResidual(
    cranker: PublicKey,
    windowId: bigint,
    remainingAccounts: AccountMeta[] = [],
  ): Promise<TransactionInstruction> {
    return this.client.program.methods
      .crankMonetizeClaimResidual()
      .accountsPartial({
        config: pdaConfig()[0],
        window: pdaWindow(windowId)[0],
        miningPool: pdaMiningPool()[0],
        phantomMember: pdaPhantomMember()[0],
        storeMint: STORE_MINT,
        cranker,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(remainingAccounts)
      .instruction();
  }

  /**
   * STAGE: keeper deposits `solIn` swap-return SOL and takes the custody stORE to swap
   * off-chain. Signer is the keeper.
   */
  async crankMonetizeStage(keeper: PublicKey, solIn: bigint): Promise<TransactionInstruction> {
    const miningAuthority = pdaMiningAuthority()[0];
    return this.client.program.methods
      .crankMonetizeStage(bn(solIn))
      .accountsPartial({
        config: pdaConfig()[0],
        miningPool: pdaMiningPool()[0],
        miningVault: pdaVault(POOL_MINING)[0],
        miningAuthority,
        storeMint: STORE_MINT,
        monetizeStoreAta: storeAta(miningAuthority),
        keeperStoreAta: storeAta(keeper),
        keeper,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /** FOLD one monetizing position (`owner`): mint shares at the settled frozen NAV. */
  async crankMonetizeFold(
    owner: PublicKey,
    windowId: bigint,
    cranker: PublicKey,
  ): Promise<TransactionInstruction> {
    return this.client.program.methods
      .crankMonetizeFold()
      .accountsPartial({
        config: pdaConfig()[0],
        window: pdaWindow(windowId)[0],
        miningPool: pdaMiningPool()[0],
        position: pdaPosition(POOL_MINING, owner)[0],
        cranker,
      })
      .instruction();
  }

  /**
   * ABORT: `admin` becomes the swap counterparty (deposits `solIn`) for a cycle stuck
   * post-SELL, pre-STAGE. Signer is the admin, and callers must prepend the standard
   * fresh fee-holder cosign attestation over the returned instruction.
   */
  async crankMonetizeAbort(solIn: bigint, admin: PublicKey): Promise<TransactionInstruction> {
    const miningAuthority = pdaMiningAuthority()[0];
    return this.client.program.methods
      .crankMonetizeAbort(bn(solIn))
      .accountsPartial({
        config: pdaConfig()[0],
        miningPool: pdaMiningPool()[0],
        miningVault: pdaVault(POOL_MINING)[0],
        miningAuthority,
        storeMint: STORE_MINT,
        monetizeStoreAta: storeAta(miningAuthority),
        adminStoreAta: storeAta(admin),
        admin,
        ixSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  // ─── protocol-fee distribution ──────────────────────────────────────────────

  /**
   * Distribute the accrued SOL protocol fee to the fee-schedule recipients. Pass each
   * non-empty recipient WALLET in `recipients` (matched by pubkey; order-free) — they
   * become writable `remainingAccounts`.
   */
  async distributeFees(
    cranker: PublicKey,
    recipients: PublicKey[] = [],
  ): Promise<TransactionInstruction> {
    return this.client.program.methods
      .distributeFees()
      .accountsPartial({
        feeSchedule: pdaFeeSchedule()[0],
        feeBucket: pdaFeeBucket()[0],
        caller: cranker,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(
        recipients.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })),
      )
      .instruction();
  }

  /**
   * Distribute the accrued stORE protocol fee to the fee-schedule recipients. Pass each
   * recipient's stORE ATA in `recipientAtas`, in fee-schedule slot order — they become
   * writable `remainingAccounts`.
   */
  async distributeFeesStore(
    cranker: PublicKey,
    recipientAtas: PublicKey[] = [],
  ): Promise<TransactionInstruction> {
    const feeBucket = pdaFeeBucket()[0];
    return this.client.program.methods
      .distributeFeesStore()
      .accountsPartial({
        feeSchedule: pdaFeeSchedule()[0],
        feeBucket,
        storeMint: STORE_MINT,
        feeStore: storeAta(feeBucket),
        caller: cranker,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts(
        recipientAtas.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })),
      )
      .instruction();
  }

  // ─── referral push / sweep ──────────────────────────────────────────────────

  /**
   * PUSH a referral payout: a relayer pays the attestation-bound `referrer` (the
   * referrer is NOT a signer). The settlement-authority attestation is a SEPARATE
   * preInstruction — bundle `buildReferralClaimAttestation({ settlementAuthority,
   * referrer, cumulative, expiry })` BEFORE this ix in the same tx.
   */
  async distributeReferrals(
    relayer: PublicKey,
    referrer: PublicKey,
  ): Promise<TransactionInstruction> {
    return this.client.program.methods
      .distributeReferrals()
      .accountsPartial({
        relayer,
        referrer,
        referrerState: pdaReferrer(referrer)[0],
        referralConfig: pdaReferralConfig()[0],
        referralTreasury: pdaReferralTreasury()[0],
        ixSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /**
   * SWEEP referral surplus into the fee bucket. The settlement-authority attestation is
   * a SEPARATE preInstruction — bundle `buildReferralSweepAttestation({
   * settlementAuthority, targetCumulative, expiry })` BEFORE this ix in the same tx.
   */
  async sweepReferralSurplus(caller: PublicKey): Promise<TransactionInstruction> {
    return this.client.program.methods
      .sweepReferralSurplus()
      .accountsPartial({
        referralConfig: pdaReferralConfig()[0],
        referralTreasury: pdaReferralTreasury()[0],
        feeBucket: pdaFeeBucket()[0],
        caller,
        ixSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  // ─── position cleanup ───────────────────────────────────────────────────────

  /** Close (reap) `owner`'s fully-empty mining Position; rent refunds to the owner. */
  async closeMiningPosition(
    owner: PublicKey,
    cranker: PublicKey,
  ): Promise<TransactionInstruction> {
    return this.client.program.methods
      .closeMiningPosition()
      .accountsPartial({
        miningPool: pdaMiningPool()[0],
        position: pdaPosition(POOL_MINING, owner)[0],
        owner,
        cranker,
      })
      .instruction();
  }

  // ─── internal ───────────────────────────────────────────────────────────────

  /** Read the current (open) window id from Config. */
  private async currentWindowId(): Promise<bigint> {
    const cfg = await this.client.program.account.config.fetch(pdaConfig()[0]);
    return BigInt(cfg.currentWindowId.toString());
  }
}
