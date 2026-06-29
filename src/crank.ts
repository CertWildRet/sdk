import BN from "bn.js";
import * as anchor from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  Ed25519Program,
  PublicKey,
  Signer,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Bucket,
  ENTROPY_PROGRAM_ID,
  ENTROPY_VAR,
  ORE_LST_PROGRAM_ID,
  ORE_MINT,
  ORE_PROGRAM_ID,
  ORE_STAKE_PROGRAM_ID,
  STORE_MINT,
  ZINC_ATA_PROGRAM,
  ZINC_BOARD,
  ZINC_CONFIG,
  ZINC_MINT,
  ZINC_PROGRAM_ID,
  ZINC_TOKEN_PROGRAM,
  ZINC_TREASURY,
} from "./constants";
import { CwrVaultClient } from "./client";
import {
  deriveBucketAddresses,
  findFeeBucket,
  findFeeSchedule,
  findMiningAuthority,
  findPendingDeposit,
  findPendingState,
  findPendingTreasury,
  findPosition,
  findReferralConfig,
  findReferralTreasury,
  findReferrerState,
  oreAutomationPda,
  oreBoardPda,
  oreConfigPda,
  oreLstVaultPda,
  oreMinerPda,
  oreRoundPda,
  oreStakeStakePda,
  oreStakeTreasuryPda,
  oreStakeVestingPda,
  oreTreasuryPda,
  zincBonanzaSolVaultPda,
  zincBuybackSolVaultPda,
  zincCustodyAta,
  zincMinerPda,
  zincPlayerProfilePda,
  zincPoolPda,
  zincRoundPda,
  zincRoundRewardTokenAccountPda,
  zincStockpileSolVaultPda,
} from "./pdas";

const ALL_SQUARES: boolean[] = Array.from({ length: 25 }, () => true);

/**
 * Operator / crank API for the V6 non-custodial mining vault.
 *
 * The vault PDA mines ORE directly on-chain via CPI. The operator only signs
 * the OUTER crank (`crank_mine`) - it controls WHEN, never WHERE; funds can
 * only flow PDA ↔ ORE/stORE. `checkpoint` / `settle_harvest` / `open_window` /
 * `close_window` are permissionless (any signer pays the tx fee).
 *
 * Account lists below mirror the on-chain `#[derive(Accounts)]` structs
 * EXACTLY (CrankMine / CheckpointCtx / SettleHarvest / OpenWindow / CloseWindow
 * in programs/cwr-vault/src/lib.rs). Anchor auto-derives the seed-pinned
 * cwr/ORE PDAs; the externally-keyed accounts (ATAs, vault-seeded stake PDA,
 * mints, programs, signers) are supplied explicitly.
 */
export class CrankApi {
  constructor(private readonly c: CwrVaultClient) {}

  /**
   * Deploy bucket SOL into the current ORE round (CPI Deploy). The operator
   * (== `bucket.operator_wallet`) signs. `amount` is per-square lamports;
   * `squares` is a 25-element mask (default: all-true, the simple-pool layout).
   *
   * Wires CrankMine: config, operator, bucket, operator_wallet, treasury,
   * mining_authority, fee_bucket, fee_schedule, ore_miner, ore_automation,
   * ore_board, ore_config, ore_round(round_id), ore_program, entropy_var,
   * entropy_program, system_program.
   */
  async crankMine(args: {
    bucket: Bucket;
    amount: BN;
    roundId: BN;
    squares?: boolean[];
    operator: Signer;
  }): Promise<string> {
    const addrs = deriveBucketAddresses(this.c.programId, args.bucket);
    const [feeBucket] = findFeeBucket(this.c.programId);
    const [feeSchedule] = findFeeSchedule(this.c.programId);
    const [referralTreasury] = findReferralTreasury(this.c.programId);
    const [miningAuthority] = findMiningAuthority(this.c.programId, args.bucket);
    const [oreMiner] = oreMinerPda(miningAuthority);
    const [oreAutomation] = oreAutomationPda(miningAuthority);
    const [oreBoard] = oreBoardPda();
    const [oreConfig] = oreConfigPda();
    const [oreRound] = oreRoundPda(args.roundId);

    const squares = (args.squares ?? ALL_SQUARES).slice(0, 25);

    return this.c.program.methods
      .crankMine(args.amount, args.roundId, squares as any)
      .accountsPartial({
        config: this.c.configPda,
        operator: args.operator.publicKey,
        bucket: addrs.bucket,
        operatorWallet: args.operator.publicKey,
        treasury: addrs.treasury,
        miningAuthority,
        feeBucket,
        feeSchedule,
        referralTreasury,
        oreMiner,
        oreAutomation,
        oreBoard,
        oreConfig,
        oreRound,
        oreProgram: ORE_PROGRAM_ID,
        entropyVar: ENTROPY_VAR,
        entropyProgram: ENTROPY_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([args.operator])
      .rpc();
  }

  /**
   * Settle a finished ORE round into the miner (CPI Checkpoint). Permissionless.
   *
   * Wires CheckpointCtx: bucket, mining_authority, ore_miner, ore_board,
   * ore_round(round_id), ore_treasury, ore_program, caller, system_program.
   */
  async checkpoint(args: {
    bucket: Bucket;
    roundId: BN;
    caller: Signer;
  }): Promise<string> {
    const addrs = deriveBucketAddresses(this.c.programId, args.bucket);
    const [miningAuthority] = findMiningAuthority(this.c.programId, args.bucket);
    const [oreMiner] = oreMinerPda(miningAuthority);
    const [oreBoard] = oreBoardPda();
    const [oreRound] = oreRoundPda(args.roundId);
    const [oreTreasury] = oreTreasuryPda();

    return this.c.program.methods
      .checkpoint(args.roundId)
      .accountsPartial({
        bucket: addrs.bucket,
        miningAuthority,
        oreMiner,
        oreBoard,
        oreRound,
        oreTreasury,
        oreProgram: ORE_PROGRAM_ID,
        caller: args.caller.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([args.caller])
      .rpc();
  }

  /**
   * dORE Stage 2: per-cycle settle. Claims the won SOL (working capital) and
   * advances the two uORE accumulators from the GROWTH of the unclaimed miner
   * legs (rewards_ore / refined_ore). Does NOT claim or wrap ORE - the miner is
   * left unclaimed so refining compounds. Permissionless; the keeper runs it
   * first in each OPEN window (deposit/withdraw are blocked until window_settled).
   *
   * Wires SettleUore (slim): bucket, treasury, mining_authority, ore_miner,
   * ore_board, ore_program, caller, system_program.
   */
  async settleUore(args: { bucket: Bucket; caller: Signer }): Promise<string> {
    const addrs = deriveBucketAddresses(this.c.programId, args.bucket);
    const [miningAuthority] = findMiningAuthority(this.c.programId, args.bucket);
    const [oreMiner] = oreMinerPda(miningAuthority);
    const [oreBoard] = oreBoardPda();

    return this.c.program.methods
      .settleUore()
      .accountsPartial({
        bucket: addrs.bucket,
        treasury: addrs.treasury,
        miningAuthority,
        oreMiner,
        oreBoard,
        oreProgram: ORE_PROGRAM_ID,
        caller: args.caller.publicKey,
        systemProgram: SystemProgram.programId,
      })
      // ClaimSOL + read_miner + two accumulator advances; modest CU, but raise
      // the ceiling defensively (free - no CU price set).
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
      .signers([args.caller])
      .rpc();
  }

  /**
   * dORE Stage 2: operator-gated reserve top-up. Claims the WHOLE unclaimed
   * miner (all-or-nothing ClaimORE) + ore-lst Wraps it to stORE folded into the
   * bucket's reserve. The ONLY claim+wrap site; operator-gated so the 10% claim
   * fee / refining reset cannot be griefed. Run on a low-water trigger and
   * before serving any exit the current reserve cannot cover.
   *
   * Wires BatchReplenish (same account set as the old harvest, operator-signed):
   * bucket, treasury, mining_authority, store_treasury, mining_authority_ore_ata,
   * mining_authority_store_ata, ore_mint, store_mint, ore_miner, ore_board,
   * ore_treasury, ore_treasury_ore_ata, ore_program, ore_lst_vault,
   * ore_lst_vault_ore_ata, ore_lst_stake, ore_lst_stake_ore_ata, ore_lst_treasury,
   * ore_lst_treasury_ore_ata, ore_lst_vesting, ore_stake_program, ore_lst_program,
   * operator, token_program, associated_token_program, system_program.
   */
  async batchReplenish(args: { bucket: Bucket; operator: Signer }): Promise<string> {
    const addrs = deriveBucketAddresses(this.c.programId, args.bucket);
    const [miningAuthority] = findMiningAuthority(this.c.programId, args.bucket);
    const [oreMiner] = oreMinerPda(miningAuthority);
    const [oreBoard] = oreBoardPda();
    const [oreTreasury] = oreTreasuryPda();
    const [oreLstVault] = oreLstVaultPda();
    const [oreLstStake] = oreStakeStakePda(oreLstVault);
    const [oreLstTreasury] = oreStakeTreasuryPda();
    const [oreLstVesting] = oreStakeVestingPda();

    const miningAuthorityOreAta = getAssociatedTokenAddressSync(ORE_MINT, miningAuthority, true);
    const miningAuthorityStoreAta = getAssociatedTokenAddressSync(STORE_MINT, miningAuthority, true);
    const oreTreasuryOreAta = getAssociatedTokenAddressSync(ORE_MINT, oreTreasury, true);
    const oreLstVaultOreAta = getAssociatedTokenAddressSync(ORE_MINT, oreLstVault, true);
    const oreLstStakeOreAta = getAssociatedTokenAddressSync(ORE_MINT, oreLstStake, true);
    const oreLstTreasuryOreAta = getAssociatedTokenAddressSync(ORE_MINT, oreLstTreasury, true);

    return this.c.program.methods
      .batchReplenish()
      .accountsPartial({
        bucket: addrs.bucket,
        treasury: addrs.treasury,
        miningAuthority,
        storeTreasury: addrs.storeTreasury,
        miningAuthorityOreAta,
        miningAuthorityStoreAta,
        oreMint: ORE_MINT,
        storeMint: STORE_MINT,
        oreMiner,
        oreBoard,
        oreTreasury,
        oreTreasuryOreAta,
        oreProgram: ORE_PROGRAM_ID,
        oreLstVault,
        oreLstVaultOreAta,
        oreLstStake,
        oreLstStakeOreAta,
        oreLstTreasury,
        oreLstTreasuryOreAta,
        oreLstVesting,
        oreStakeProgram: ORE_STAKE_PROGRAM_ID,
        oreLstProgram: ORE_LST_PROGRAM_ID,
        operator: args.operator.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      // ClaimORE + the 17-account ore-lst Wrap + up to 2 ATA creates: well past
      // the 200k default CU. Raise the ceiling (free - no CU price set).
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 })])
      .signers([args.operator])
      .rpc();
  }

  /**
   * Transition a bucket into its OPEN window (deposits + withdrawals).
   * Permissionless. Reads `bucket.ore_miner` (read-only) to gate the phase.
   *
   * Wires OpenWindow: bucket, ore_miner, caller.
   */
  async openWindow(args: { bucket: Bucket; caller: Signer }): Promise<string> {
    const addrs = deriveBucketAddresses(this.c.programId, args.bucket);
    const [miningAuthority] = findMiningAuthority(this.c.programId, args.bucket);
    const [oreMiner] = oreMinerPda(miningAuthority);

    return this.c.program.methods
      .openWindow()
      .accountsPartial({
        bucket: addrs.bucket,
        oreMiner,
        caller: args.caller.publicKey,
      })
      .signers([args.caller])
      .rpc();
  }

  /**
   * Transition a bucket into its BETTING window (mining live; deposits +
   * withdrawals closed). Permissionless.
   *
   * Wires CloseWindow: bucket, caller.
   */
  async closeWindow(args: { bucket: Bucket; caller: Signer }): Promise<string> {
    const addrs = deriveBucketAddresses(this.c.programId, args.bucket);

    return this.c.program.methods
      .closeWindow()
      .accountsPartial({
        bucket: addrs.bucket,
        caller: args.caller.publicKey,
      })
      .signers([args.caller])
      .rpc();
  }

  // ════════════════════════════════════════════════════════════════════
  // dZINC pool (bucket 1) crank / harvest / window. Operator-signed crank +
  // permissionless harvest/window, mirroring the dORE crankMine / settleUore /
  // openWindow / closeWindow. The bucket's `mining_authority` PDA is the ZINC
  // player + Deploy/smelt CPI signer (invoke_signed).
  // ════════════════════════════════════════════════════════════════════

  /**
   * Deploy `amount` SOL into the ZINC board for `round_id` (CPI Deploy). The
   * operator (== `bucket.operator_wallet`, the SAME operator as the dORE pool)
   * signs the OUTER crank - it controls WHEN, never WHERE. ZINC deploys a
   * single net total via an ENCRYPTED mask that the keeper precomputes
   * off-chain (Arcium X25519+Rescue to the live MXE key) and threads in as
   * args; there is no 25-square split. `amount` is the gross SOL (the program
   * skims the 1% volume fee + the referral carve, then deploys the net).
   *
   * `stockpile` is keeper-supplied: the live stockpile PDA when
   * `board.active_stockpile_id` is Some, else the ZINC_PROGRAM_ID sentinel.
   * Passing the sentinel while a stockpile is active fails on-chain with
   * MissingCurrentStockpile, so the keeper must read the board first.
   *
   * Wires CrankMineZinc: config, operator, bucket, operator_wallet, zinc_pool,
   * treasury, mining_authority, fee_bucket, fee_schedule, referral_treasury,
   * zinc_program, zinc_round(round_id), zinc_config, zinc_miner(round_id,
   * mining_authority), zinc_player_profile(mining_authority), zinc_board,
   * zinc_treasury, zinc_stockpile_sol_vault, zinc_bonanza_sol_vault,
   * zinc_buyback_sol_vault, zinc_stockpile, system_program.
   */
  async crankMineZinc(args: {
    bucket: Bucket;
    amount: BN;
    roundId: BN;
    maskEncryptionKey: number[] | Uint8Array;
    maskNonce: BN;
    maskCiphertext: number[] | Uint8Array;
    /** Live stockpile PDA (board.active_stockpile_id) or the ZINC_PROGRAM_ID
     *  sentinel. Keeper-supplied; cannot be PDA-pinned (ZINC validates it). */
    stockpile: PublicKey;
    operator: Signer;
  }): Promise<string> {
    const addrs = deriveBucketAddresses(this.c.programId, args.bucket);
    const [zincPool] = zincPoolPda(this.c.programId, args.bucket);
    const [feeBucket] = findFeeBucket(this.c.programId);
    const [feeSchedule] = findFeeSchedule(this.c.programId);
    const [referralTreasury] = findReferralTreasury(this.c.programId);
    const [miningAuthority] = findMiningAuthority(this.c.programId, args.bucket);
    const [zincRound] = zincRoundPda(args.roundId);
    const [zincMiner] = zincMinerPda(args.roundId, miningAuthority);
    const [zincPlayerProfile] = zincPlayerProfilePda(miningAuthority);
    const [zincStockpileSolVault] = zincStockpileSolVaultPda();
    const [zincBonanzaSolVault] = zincBonanzaSolVaultPda();
    const [zincBuybackSolVault] = zincBuybackSolVaultPda();

    const maskKey = Array.from(args.maskEncryptionKey);
    const maskCt = Array.from(args.maskCiphertext);

    return this.c.program.methods
      .crankMineZinc(
        args.amount,
        args.roundId,
        maskKey as any,
        args.maskNonce,
        maskCt as any,
      )
      .accountsPartial({
        config: this.c.configPda,
        operator: args.operator.publicKey,
        bucket: addrs.bucket,
        operatorWallet: args.operator.publicKey,
        zincPool,
        treasury: addrs.treasury,
        miningAuthority,
        feeBucket,
        feeSchedule,
        referralTreasury,
        zincProgram: ZINC_PROGRAM_ID,
        zincRound,
        zincConfig: ZINC_CONFIG,
        zincMiner,
        zincPlayerProfile,
        zincBoard: ZINC_BOARD,
        zincTreasury: ZINC_TREASURY,
        zincStockpileSolVault,
        zincBonanzaSolVault,
        zincBuybackSolVault,
        zincStockpile: args.stockpile,
        systemProgram: SystemProgram.programId,
      })
      // The ZINC Deploy CPI (lazy miner/profile creation + the encrypted mask)
      // is well past the 200k default CU. Raise the ceiling (free - no CU price).
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 800_000 })])
      .signers([args.operator])
      .rpc();
  }

  /**
   * dZINC harvest: claim the round's won SOL (working capital) and SMELT the
   * accrued ZINC (-10%) into the custody ATA (HOLD path), advancing the
   * pool's smelted-ZINC-per-share accumulator over the blended total_shares.
   * Mirrors `settleUore` (permissionless; the keeper runs it first each OPEN
   * window before deposits/withdrawals are served). Skips the claim/smelt CPI
   * when nothing accrued, so a losing/zero round never bricks the barrier.
   *
   * Wires SettleHarvestZinc: bucket, zinc_pool, treasury, mining_authority,
   * zinc_custody_ata, zinc_mint, zinc_player_profile(mining_authority),
   * zinc_config, zinc_treasury, zinc_round_zinc_reward_token_account,
   * zinc_program, caller, token_program, associated_token_program,
   * system_program.
   */
  async settleHarvestZinc(args: { bucket: Bucket; caller: Signer }): Promise<string> {
    const addrs = deriveBucketAddresses(this.c.programId, args.bucket);
    const [zincPool] = zincPoolPda(this.c.programId, args.bucket);
    const [miningAuthority] = findMiningAuthority(this.c.programId, args.bucket);
    const custodyAta = zincCustodyAta(miningAuthority);
    const [zincPlayerProfile] = zincPlayerProfilePda(miningAuthority);
    const [zincRewardTa] = zincRoundRewardTokenAccountPda();

    return this.c.program.methods
      .settleHarvestZinc()
      .accountsPartial({
        bucket: addrs.bucket,
        zincPool,
        treasury: addrs.treasury,
        miningAuthority,
        zincCustodyAta: custodyAta,
        zincMint: ZINC_MINT,
        zincPlayerProfile,
        zincConfig: ZINC_CONFIG,
        zincTreasury: ZINC_TREASURY,
        zincRoundZincRewardTokenAccount: zincRewardTa,
        zincProgram: ZINC_PROGRAM_ID,
        caller: args.caller.publicKey,
        tokenProgram: ZINC_TOKEN_PROGRAM,
        associatedTokenProgram: ZINC_ATA_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      // claim SOL + smelt CPI + accumulator advance + (first-settle) ATA create.
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
      .signers([args.caller])
      .rpc();
  }

  /**
   * Transition a dZINC bucket into its OPEN window (deposits + withdrawals).
   * Permissionless. Mirrors `openWindow` but reads the ZincPool (no ore_miner).
   *
   * Wires OpenWindowZinc: bucket, zinc_pool, caller.
   */
  async openWindowZinc(args: { bucket: Bucket; caller: Signer }): Promise<string> {
    const addrs = deriveBucketAddresses(this.c.programId, args.bucket);
    const [zincPool] = zincPoolPda(this.c.programId, args.bucket);

    return this.c.program.methods
      .openWindowZinc()
      .accountsPartial({
        bucket: addrs.bucket,
        zincPool,
        caller: args.caller.publicKey,
      })
      .signers([args.caller])
      .rpc();
  }

  /**
   * Transition a dZINC bucket into its BETTING window (ZINC mining live;
   * deposits + withdrawals closed). Permissionless. Mirrors `closeWindow`.
   *
   * Wires CloseWindowZinc: bucket, zinc_pool, caller.
   */
  async closeWindowZinc(args: { bucket: Bucket; caller: Signer }): Promise<string> {
    const addrs = deriveBucketAddresses(this.c.programId, args.bucket);
    const [zincPool] = zincPoolPda(this.c.programId, args.bucket);

    return this.c.program.methods
      .closeWindowZinc()
      .accountsPartial({
        bucket: addrs.bucket,
        zincPool,
        caller: args.caller.publicKey,
      })
      .signers([args.caller])
      .rpc();
  }

  /**
   * Convert a parked ticket into a real position. PERMISSIONLESS - the keeper
   * runs this for parkers right after `settleHarvest` in the OPEN window. Mints
   * CWR to `owner` at the settled price; `finalizer` pays the tx fee + the
   * owner's Position rent (gains nothing, never a fund destination). Idempotently
   * creates the owner's share ATA so the mint can land.
   *
   * Wires FinalizePending: config, bucket, treasury, pending_state,
   * pending_treasury, share_mint, owner_share_ata, owner, finalizer, position,
   * pending_deposit, ore_miner, fee_bucket, fee_schedule, token_program,
   * system_program.
   */
  async finalizePending(args: {
    bucket: Bucket;
    owner: PublicKey;
    finalizer: Signer;
  }): Promise<string> {
    const addrs = deriveBucketAddresses(this.c.programId, args.bucket);
    const [pendingState] = findPendingState(this.c.programId, args.bucket);
    const [pendingTreasury] = findPendingTreasury(this.c.programId, args.bucket);
    const [pendingDeposit] = findPendingDeposit(this.c.programId, args.bucket, args.owner);
    const [position] = findPosition(this.c.programId, args.bucket, args.owner);
    const [feeBucket] = findFeeBucket(this.c.programId);
    const [feeSchedule] = findFeeSchedule(this.c.programId);
    const [miningAuthority] = findMiningAuthority(this.c.programId, args.bucket);
    const [oreMiner] = oreMinerPda(miningAuthority);
    const ownerShareAta = getAssociatedTokenAddressSync(addrs.shareMint, args.owner);

    const pre = [
      createAssociatedTokenAccountIdempotentInstruction(
        args.finalizer.publicKey, // payer
        ownerShareAta,
        args.owner, // ata owner
        addrs.shareMint,
      ),
    ];

    return this.c.program.methods
      .finalizePending()
      .accountsPartial({
        config: this.c.configPda,
        bucket: addrs.bucket,
        treasury: addrs.treasury,
        pendingState,
        pendingTreasury,
        shareMint: addrs.shareMint,
        ownerShareAta,
        owner: args.owner,
        finalizer: args.finalizer.publicKey,
        position,
        pendingDeposit,
        oreMiner,
        feeBucket,
        feeSchedule,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions(pre)
      .signers([args.finalizer])
      .rpc();
  }

  /**
   * Sweep the protocol's surplus (carve on non-referred volume + dust) from
   * referral_treasury -> fee_bucket. PERMISSIONLESS; authorized by a
   * settlement-authority attestation of `target_cumulative` (the off-chain
   * settlement service produces the message + signature). The relayer fee-pays.
   */
  async sweepReferralSurplus(args: {
    relayer: Signer;
    attestationMessage: Uint8Array;
    attestationSignature: Uint8Array;
  }): Promise<string> {
    const [referralConfig] = findReferralConfig(this.c.programId);
    const [referralTreasury] = findReferralTreasury(this.c.programId);
    const [feeBucket] = findFeeBucket(this.c.programId);
    const [feeSchedule] = findFeeSchedule(this.c.programId);
    const rc: any = await this.c.program.account.referralConfig.fetch(referralConfig);
    const edIx = Ed25519Program.createInstructionWithPublicKey({
      publicKey: rc.settlementAuthority.toBytes(),
      message: args.attestationMessage,
      signature: args.attestationSignature,
    });
    const sweepIx = await this.c.program.methods
      .sweepReferralSurplus()
      .accountsPartial({
        referralConfig,
        referralTreasury,
        feeBucket,
        feeSchedule,
        systemProgram: SystemProgram.programId,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
    const tx = new Transaction().add(edIx, sweepIx);
    return (this.c.program.provider as anchor.AnchorProvider).sendAndConfirm(
      tx,
      [args.relayer],
      { commitment: "confirmed" },
    );
  }

  /**
   * PUSH a referrer their accrued rewards (the referrer does NOT sign). The
   * relayer (keeper) signs + fee-pays; funds go to `referrer`. Authorized by a
   * settlement-authority attestation (binds `referrer` + cumulative) - the same
   * attestation a referrer would use to pull-claim, sharing the watermark so no
   * double-collect. Drives both the "selective" (specific referrers) and "all
   * opted-in" keeper payout modes (the mode = which referrers you loop over).
   */
  async distributeReferrals(args: {
    relayer: Signer;
    referrer: PublicKey;
    attestationMessage: Uint8Array;
    attestationSignature: Uint8Array;
  }): Promise<string> {
    const [referralConfig] = findReferralConfig(this.c.programId);
    const [referralTreasury] = findReferralTreasury(this.c.programId);
    const [referrerState] = findReferrerState(this.c.programId, args.referrer);
    const rc: any = await this.c.program.account.referralConfig.fetch(referralConfig);
    const edIx = Ed25519Program.createInstructionWithPublicKey({
      publicKey: rc.settlementAuthority.toBytes(),
      message: args.attestationMessage,
      signature: args.attestationSignature,
    });
    const distIx = await this.c.program.methods
      .distributeReferrals()
      .accountsPartial({
        relayer: args.relayer.publicKey,
        referrer: args.referrer,
        referrerState,
        referralConfig,
        referralTreasury,
        systemProgram: SystemProgram.programId,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
    const tx = new Transaction().add(edIx, distIx);
    return (this.c.program.provider as anchor.AnchorProvider).sendAndConfirm(
      tx,
      [args.relayer],
      { commitment: "confirmed" },
    );
  }
}
