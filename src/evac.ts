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
  pdaMiningAuthority,
  pdaMiningPool,
  pdaPhantomMember,
  pdaPosition,
  pdaProtocolPool,
  pdaStakingPool,
  pdaVault,
  pdaWindow,
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
}
