/**
 * EvacApi — §5.5 emergency evacuation instructions.
 *
 * The evacuation hatch drains all three pools to stORE held in a program-owned
 * custody account, then lets each depositor redeem their pro-rata share and, once
 * everyone has redeemed, lets admin sweep the custody dust to the fee bucket.
 *
 *   const dp = new DiamondPoolsClient({ connection, wallet });
 *   const ed  = buildCosignEd25519Ix({ cosigner, ix: await dp.evac.evacuateClaimAll(admin), nonce, signedTs });
 *   await dp.connection.sendTransaction(new Transaction().add(ed, ix), [adminKp]);
 */
import {
  AccountMeta,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import BN from "bn.js";
import type { DiamondPoolsClient } from "./client";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  POOL_MINING,
  POOL_PROTOCOL,
  POOL_STAKING,
  STORE_MINT,
  TOKEN_PROGRAM_ID,
} from "./constants";
import {
  pdaConfig,
  pdaEvacCustody,
  pdaFeeBucket,
  pdaFeeSchedule,
  pdaMiningAuthority,
  pdaMiningPool,
  pdaPhantomMember,
  pdaPosition,
  pdaProtocolPool,
  pdaStakingPool,
  pdaUnclaimed,
  pdaVault,
  pdaWindow,
  miningAuthorityMinerPda,
} from "./pdas";

/** The upgradeable BPF loader — owner of every program's `ProgramData` account. */
const BPF_LOADER_UPGRADEABLE = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);

/** stORE ATA of `owner` (allowOwnerOffCurve — every owner here is a PDA). */
const storeAta = (owner: PublicKey): PublicKey =>
  getAssociatedTokenAddressSync(STORE_MINT, owner, true);

export class EvacApi {
  constructor(private readonly client: DiamondPoolsClient) {}

  /** The diamond_pools `ProgramData` account (holds `upgrade_authority`, gated by evacuate). */
  private programData(): PublicKey {
    return PublicKey.findProgramAddressSync(
      [this.client.programId.toBuffer()],
      BPF_LOADER_UPGRADEABLE,
    )[0];
  }

  /**
   * §5.5 evacuate hatch — drains mining/staking/protocol into custody stORE.
   *
   * Cosigned — bundle buildCosignEd25519Ix({cosigner, ix, nonce, signedTs}) BEFORE this ix in the same tx.
   *
   * `authorizer` is the fee-holder admin (it fills both the `admin` and `cranker`
   * signer slots). `remainingAccounts` are the 17 ORE accounts required to unwind
   * the miner/stake positions — the last two MUST be ore_stake_program (stakecNP3)
   * then ore_lst_program (storeD7 = ORE_LST_PROGRAM_ID, the ix_wrap CPI callee);
   * pass `[]` only for gate-reject probes that revert before touching them. The
   * `window` PDA is passed explicitly (derived from the live
   * `config.current_window_id`), matching the bankrun-proven flow.
   */
  async evacuateClaimAll(
    authorizer: PublicKey,
    remainingAccounts: AccountMeta[] = [],
  ): Promise<TransactionInstruction> {
    const custody = pdaEvacCustody()[0];
    const cfg: any = await this.client.program.account.config.fetch(pdaConfig()[0]);
    const wid = BigInt(cfg.currentWindowId.toString());
    return this.client.program.methods
      .evacuateClaimAll()
      .accountsPartial({
        config: pdaConfig()[0],
        window: pdaWindow(wid)[0],
        miningPool: pdaMiningPool()[0],
        stakingPool: pdaStakingPool()[0],
        protocolPool: pdaProtocolPool()[0],
        phantomMember: pdaPhantomMember()[0],
        miningAuthority: pdaMiningAuthority()[0],
        miningVault: pdaVault(POOL_MINING)[0],
        storeMint: STORE_MINT,
        custodyAuthority: custody,
        custodyAta: storeAta(custody),
        admin: authorizer,
        programData: this.programData(),
        ixSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        cranker: authorizer,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(remainingAccounts)
      .instruction();
  }

  /**
   * Redeem an evacuated MINING position — pays `owner` their pro-rata stORE out of
   * custody. Permissionless: `cranker` signs and pays, `owner` need not sign.
   */
  async redeemEvacuatedMining(
    owner: PublicKey,
    cranker: PublicKey,
  ): Promise<TransactionInstruction> {
    const custody = pdaEvacCustody()[0];
    return this.client.program.methods
      .redeemEvacuatedMining()
      .accountsPartial({
        config: pdaConfig()[0],
        miningPool: pdaMiningPool()[0],
        position: pdaPosition(POOL_MINING, owner)[0],
        miningVault: pdaVault(POOL_MINING)[0],
        custodyAuthority: custody,
        custodyAta: storeAta(custody),
        storeMint: STORE_MINT,
        exiter: owner,
        exiterStoreAta: storeAta(owner),
        cranker,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /**
   * Redeem an evacuated STAKING position — pays `owner` their pro-rata stORE out of
   * custody. Permissionless: `cranker` signs and pays, `owner` need not sign.
   */
  async redeemEvacuatedStaking(
    owner: PublicKey,
    cranker: PublicKey,
  ): Promise<TransactionInstruction> {
    const custody = pdaEvacCustody()[0];
    const stakingVaultAuthority = pdaVault(POOL_STAKING)[0];
    return this.client.program.methods
      .redeemEvacuatedStaking()
      .accountsPartial({
        config: pdaConfig()[0],
        miningPool: pdaMiningPool()[0],
        stakingPool: pdaStakingPool()[0],
        position: pdaPosition(POOL_STAKING, owner)[0],
        stakingVaultAuthority,
        stakingVaultAta: storeAta(stakingVaultAuthority),
        custodyAuthority: custody,
        custodyAta: storeAta(custody),
        storeMint: STORE_MINT,
        exiter: owner,
        exiterStoreAta: storeAta(owner),
        cranker,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /**
   * Redeem an evacuated PROTOCOL position — pays `owner` their pro-rata stORE out of
   * custody. Permissionless: `cranker` signs and pays, `owner` need not sign.
   */
  async redeemEvacuatedProtocol(
    owner: PublicKey,
    cranker: PublicKey,
  ): Promise<TransactionInstruction> {
    const custody = pdaEvacCustody()[0];
    const protocolVaultAuthority = pdaVault(POOL_PROTOCOL)[0];
    return this.client.program.methods
      .redeemEvacuatedProtocol()
      .accountsPartial({
        config: pdaConfig()[0],
        miningPool: pdaMiningPool()[0],
        protocolPool: pdaProtocolPool()[0],
        position: pdaPosition(POOL_PROTOCOL, owner)[0],
        protocolVaultAuthority,
        protocolVaultAta: storeAta(protocolVaultAuthority),
        custodyAuthority: custody,
        custodyAta: storeAta(custody),
        storeMint: STORE_MINT,
        exiter: owner,
        exiterStoreAta: storeAta(owner),
        cranker,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /**
   * Sweep leftover custody stORE to the fee bucket after every position has been
   * redeemed (the on-chain all-redeemed guard reads staking + protocol pools).
   * `amount` is the stORE amount to move.
   *
   * Cosigned — bundle buildCosignEd25519Ix({cosigner, ix, nonce, signedTs}) BEFORE this ix in the same tx.
   */
  async sweepEvacCustody(
    admin: PublicKey,
    amount: bigint | number | BN,
  ): Promise<TransactionInstruction> {
    const custody = pdaEvacCustody()[0];
    const feeBucket = pdaFeeBucket()[0];
    return this.client.program.methods
      .sweepEvacCustody(new BN(amount.toString()))
      .accountsPartial({
        config: pdaConfig()[0],
        miningPool: pdaMiningPool()[0],
        stakingPool: pdaStakingPool()[0],
        protocolPool: pdaProtocolPool()[0],
        custodyAuthority: custody,
        custodyAta: storeAta(custody),
        storeMint: STORE_MINT,
        feeBucket,
        feeStoreAta: storeAta(feeBucket),
        admin,
        ixSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /**
   * END ONE CAMPAIGN AND START THE NEXT, ON THE SAME PROGRAM ID. Cosigned, admin-only.
   *
   * ⛔ THE INSTRUCTION THAT MAKES AN EVACUATION SURVIVABLE. An evacuation arms two MONOTONIC
   * latches — `mining_pool.evacuated` and `config.wind_down` — and both were cleared only by
   * `initialize`, which can never run again on a deployed program id (constant, non-campaign-
   * scoped seeds; hard `init` on eight singletons; no close path for any of them). Without this
   * instruction an evacuation is terminal for the PROGRAM, not merely for the campaign:
   * `crank_freeze` refuses while `evacuated`, so the entire cascade stops, and
   * `submit_store_deposit` refuses while `wind_down`, so the pool can never be re-seeded.
   *
   * It does NOT undo an evacuation — it records that one is FINISHED. All four
   * `redeem_evacuated_*` and `sweep_evac_custody` require `evacuated == true`, so once this runs
   * they refuse forever: there is no path back into the closed campaign's accounting.
   * **SWEEP CUSTODY FIRST or that stORE is stranded permanently.**
   *
   * ONE-SHOT PER TRANSITION, not once ever: `next_version` must be exactly `current + 1`, so a
   * replay cannot re-run it, and campaign 3 is reached by the same call again. The ceiling is
   * `u8` — at 255 the guard refuses rather than wrapping.
   *
   * TEN GATES, in order. Every one of them is a state the operator must reach FIRST:
   *   1  `config.end_of_campaign` armed via `set_emergency(5, true)` → `ReinitNotArmed`
   *   2  `next_version == campaign_version + 1`                     → `ReinitVersionMismatch`
   *   3  the pool is evacuated                                      → `AlreadyEvacuated`
   *   4  all three pools at `total_shares <= MIN_LIQUIDITY_SHARES`
   *   5  `mining_position_count == 0` — every zombie position reaped
   *   6  the evac custody ATA is EMPTY                              → `ReopenCustodyNotEmpty`
   *   7  the miner reads zero, proving `physical == 0`              → `ReopenMinerNotDrained`
   *   8  ALL FOUR unclaimed-pot ledgers zero                        → `ReopenUnclaimedOreOutstanding`
   *   9  no admin transfer in flight                               → `AdminTransferTimelockActive`
   *  10  the live window is INTAKE with no registered orders        → `EvacCycleBusy`
   *
   * ⚠ GATE 8 HAS NO POST-EVACUATION CLEAR PATH — DISCHARGE THE POT BEFORE YOU EVACUATE.
   * Both rails that could discharge it afterwards now refuse, because both were traps:
   * `restore_unclaimed_ore` left a position at `shares == 0, uore_base > 0` that NOTHING could
   * ever close (making gate 5 unsatisfiable forever), and `sweep_unclaimed_*_to_pool` credited a
   * pool with no holders, where the value is stranded or annihilated. So the pot must be settled
   * while the campaign is still live.
   *
   * ⚠ AND RUN THE CARRY-OVER CENSUS IMMEDIATELY BEFORE ARMING. A `PpExitNotice` is closed only by
   * `submit_pp_exit`, which requires `!wind_down` — so after the arm nothing can clear one, while
   * filing one stays completely ungated. A survivor is pre-aged against the surviving
   * `current_window_id` and skips both the notice period and the epoch wait in the next campaign.
   *
   * Emits `CampaignReinitialised`, carrying the previous evacuation snapshot so the closed
   * campaign's final numbers stay recoverable after the fields are reset.
   */
  async reinitForCampaign(
    admin: PublicKey,
    nextVersion: number,
  ): Promise<TransactionInstruction> {
    const custody = pdaEvacCustody()[0];
    // The window is resolved from `config.current_window_id` rather than taken as an argument:
    // gate 10 asserts against whichever window the seeds resolve to, and a caller passing a
    // stale id would be asserting quiescence on an account the instruction never meant to see.
    const cfg: any = await this.client.program.account.config.fetch(pdaConfig()[0]);
    const wid = BigInt(cfg.currentWindowId.toString());
    return this.client.program.methods
      .reinitForCampaign(nextVersion)
      .accountsPartial({
        config: pdaConfig()[0],
        miningPool: pdaMiningPool()[0],
        stakingPool: pdaStakingPool()[0],
        protocolPool: pdaProtocolPool()[0],
        unclaimed: pdaUnclaimed()[0],
        phantomMember: pdaPhantomMember()[0],
        feeSchedule: pdaFeeSchedule()[0],
        custodyAuthority: custody,
        custodyAta: storeAta(custody),
        storeMint: STORE_MINT,
        oreMiner: miningAuthorityMinerPda()[0],
        window: pdaWindow(wid)[0],
        admin,
        ixSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
  }
}
