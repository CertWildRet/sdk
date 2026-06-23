import BN from "bn.js";
import { ComputeBudgetProgram, PublicKey, Signer, SystemProgram } from "@solana/web3.js";
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
} from "./pdas";

const ALL_SQUARES: boolean[] = Array.from({ length: 25 }, () => true);

/**
 * Operator / crank API for the V6 non-custodial mining vault.
 *
 * The vault PDA mines ORE directly on-chain via CPI. The operator only signs
 * the OUTER crank (`crank_mine`) — it controls WHEN, never WHERE; funds can
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
   * Claim accumulated ORE rewards and wrap them into stORE held by the bucket
   * (CPI ClaimORE + ore-lst Wrap). Permissionless.
   *
   * Wires SettleHarvest: bucket, treasury, mining_authority, store_treasury,
   * mining_authority_ore_ata, mining_authority_store_ata, ore_mint, store_mint,
   * ore_miner, ore_board, ore_treasury, ore_treasury_ore_ata, ore_program,
   * ore_lst_vault, ore_lst_vault_ore_ata, ore_lst_stake, ore_lst_stake_ore_ata,
   * ore_lst_treasury, ore_lst_treasury_ore_ata, ore_lst_vesting,
   * ore_stake_program, caller, token_program, associated_token_program,
   * system_program.
   */
  async settleHarvest(args: {
    bucket: Bucket;
    caller: Signer;
  }): Promise<string> {
    const addrs = deriveBucketAddresses(this.c.programId, args.bucket);
    const [miningAuthority] = findMiningAuthority(this.c.programId, args.bucket);
    const [oreMiner] = oreMinerPda(miningAuthority);
    const [oreBoard] = oreBoardPda();
    const [oreTreasury] = oreTreasuryPda();
    const [oreLstVault] = oreLstVaultPda();
    const [oreLstStake] = oreStakeStakePda(oreLstVault);
    const [oreLstTreasury] = oreStakeTreasuryPda();
    const [oreLstVesting] = oreStakeVestingPda();

    const miningAuthorityOreAta = getAssociatedTokenAddressSync(
      ORE_MINT,
      miningAuthority,
      true,
    );
    const miningAuthorityStoreAta = getAssociatedTokenAddressSync(
      STORE_MINT,
      miningAuthority,
      true,
    );
    const oreTreasuryOreAta = getAssociatedTokenAddressSync(ORE_MINT, oreTreasury, true);
    const oreLstVaultOreAta = getAssociatedTokenAddressSync(ORE_MINT, oreLstVault, true);
    const oreLstStakeOreAta = getAssociatedTokenAddressSync(ORE_MINT, oreLstStake, true);
    const oreLstTreasuryOreAta = getAssociatedTokenAddressSync(
      ORE_MINT,
      oreLstTreasury,
      true,
    );

    return this.c.program.methods
      .settleHarvest()
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
        caller: args.caller.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      // settle does a lot in one tx (up to 2 ATA creates + ClaimSOL + ClaimORE +
      // the 17-account ore-lst Wrap), well past the 200k default CU. Raise the
      // ceiling (free — no CU price set, so no extra priority fee).
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 })])
      .signers([args.caller])
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

  /**
   * Convert a parked ticket into a real position. PERMISSIONLESS — the keeper
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
}
