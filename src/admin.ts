/**
 * AdminApi — admin + governance instruction builders for Diamond Pools.
 *
 * `initialize` bootstraps every singleton PDA (pools, window 0, fee schedule,
 * referral config, mining authority, vaults). The remaining methods mutate Config
 * governance state. Most are COSIGNED: they are gated on-chain by an Ed25519
 * fee-holder second factor (the `AdminCosigned` context reads the instructions
 * sysvar). For every cosigned ix, prepend `buildCosignEd25519Ix({cosigner, ix,
 * nonce, signedTs})` in the SAME transaction, immediately before the ix returned
 * here. The two plain admin-transfer legs (`confirmAdminTransfer`, `acceptAdmin`)
 * are the only non-cosigned methods.
 *
 * Every method returns an unsigned `TransactionInstruction`; the caller assembles,
 * signs (admin/confirmer signs), and sends the transaction.
 */
import BN from "bn.js";
import {
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  BPS_DENOMINATOR,
  FEE_ASSET_SOL,
  FEE_ASSET_STORE,
  FEE_EXEMPT_VALID_MASK,
  STORE_MINT,
  TOKEN_PROGRAM_ID,
  POOL_MINING,
  POOL_PROTOCOL,
  type FeeAsset,
} from "./constants";
import {
  pdaConfig,
  pdaMiningPool,
  pdaStakingPool,
  pdaProtocolPool,
  pdaFeeSchedule,
  pdaReferralConfig,
  pdaReferralTreasury,
  pdaWindow,
  pdaPhantomMember,
  pdaMiningAuthority,
  pdaVault,
  pdaWhitelist,
  pdaFeeBucket,
  pdaFeeExempt,
  pdaPosition,
} from "./pdas";
import type { DiamondPoolsClient } from "./client";

/** BPF upgradeable loader — used to derive the program's ProgramData account. */
const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);
/** The canonical ProgramData PDA (`initialize` checks admin == upgrade authority). */
const programDataAddress = (programId: PublicKey): PublicKey =>
  PublicKey.findProgramAddressSync([programId.toBuffer()], BPF_LOADER_UPGRADEABLE_PROGRAM_ID)[0];

/** One fee-schedule recipient (`recipient` gets `bpsShare` / 10_000 of protocol fees). */
export interface FeeRecipientArg {
  recipient: PublicKey;
  bpsShare: number;
}

export class AdminApi {
  constructor(private readonly client: DiamondPoolsClient) {}

  /**
   * Bootstrap the whole program: Config, the three pools, fee schedule, referral
   * config, window 0, phantom member, mining authority, and the mining/protocol
   * vaults. `admin` must be the program's upgrade authority (checked vs ProgramData).
   */
  async initialize(
    admin: PublicKey,
    settlementAuthority: PublicKey,
    adminConfirmer: PublicKey,
    keeper: PublicKey,
  ): Promise<TransactionInstruction> {
    return this.client.program.methods
      .initialize(settlementAuthority, adminConfirmer, keeper)
      .accountsPartial({
        config: pdaConfig()[0],
        miningPool: pdaMiningPool()[0],
        stakingPool: pdaStakingPool()[0],
        protocolPool: pdaProtocolPool()[0],
        feeSchedule: pdaFeeSchedule()[0],
        referralConfig: pdaReferralConfig()[0],
        window: pdaWindow(0)[0],
        phantomMember: pdaPhantomMember()[0],
        miningAuthority: pdaMiningAuthority()[0],
        miningVault: pdaVault(POOL_MINING)[0],
        protocolVault: pdaVault(POOL_PROTOCOL)[0],
        storeMint: STORE_MINT,
        programData: programDataAddress(this.client.programId),
        admin,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /**
   * Set a scalar Config parameter (`field` selector → `value`).
   * Cosigned — bundle buildCosignEd25519Ix({cosigner, ix, nonce, signedTs}) BEFORE this ix in the same tx.
   */
  async setParam(admin: PublicKey, field: number, value: bigint): Promise<TransactionInstruction> {
    return this.client.program.methods
      .setParam(field, new BN(value.toString()))
      .accountsPartial({
        config: pdaConfig()[0],
        admin,
        ixSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
  }

  /**
   * Flip an emergency switch (0=mining, 1=staking, 2=defensive, 3=wind_down).
   * Cosigned — bundle buildCosignEd25519Ix({cosigner, ix, nonce, signedTs}) BEFORE this ix in the same tx.
   */
  async setEmergency(admin: PublicKey, sw: number, value: boolean): Promise<TransactionInstruction> {
    return this.client.program.methods
      .setEmergency(sw, value)
      .accountsPartial({
        config: pdaConfig()[0],
        admin,
        ixSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
  }

  /**
   * Rewrite the protocol fee schedule (exactly 4 recipients; bps shares sum to 10_000).
   * Cosigned — bundle buildCosignEd25519Ix({cosigner, ix, nonce, signedTs}) BEFORE this ix in the same tx.
   */
  async setFeeSchedule(
    admin: PublicKey,
    recipients: [FeeRecipientArg, FeeRecipientArg, FeeRecipientArg, FeeRecipientArg],
  ): Promise<TransactionInstruction> {
    return this.client.program.methods
      .setFeeSchedule(recipients)
      .accountsPartial({
        config: pdaConfig()[0],
        feeSchedule: pdaFeeSchedule()[0],
        admin,
        ixSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
  }

  /**
   * Rotate the keeper (the monetization/settlement bot authority).
   * Cosigned — bundle buildCosignEd25519Ix({cosigner, ix, nonce, signedTs}) BEFORE this ix in the same tx.
   */
  async setKeeper(admin: PublicKey, newKeeper: PublicKey): Promise<TransactionInstruction> {
    return this.client.program.methods
      .setKeeper(newKeeper)
      .accountsPartial({
        config: pdaConfig()[0],
        admin,
        ixSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
  }

  /**
   * Rotate the referral settlement authority (also stamped into ReferralConfig).
   * Cosigned — bundle buildCosignEd25519Ix({cosigner, ix, nonce, signedTs}) BEFORE this ix in the same tx.
   */
  async setSettlementAuthority(
    admin: PublicKey,
    newAuthority: PublicKey,
  ): Promise<TransactionInstruction> {
    return this.client.program.methods
      .setSettlementAuthority(newAuthority)
      .accountsPartial({
        config: pdaConfig()[0],
        referralConfig: pdaReferralConfig()[0],
        admin,
        ixSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
  }

  /**
   * Set the admin-transfer confirmer (the second party in the 2-of-2 handoff).
   * Cosigned — bundle buildCosignEd25519Ix({cosigner, ix, nonce, signedTs}) BEFORE this ix in the same tx.
   */
  async setAdminTransferConfirmer(
    admin: PublicKey,
    confirmer: PublicKey,
  ): Promise<TransactionInstruction> {
    return this.client.program.methods
      .setAdminTransferConfirmer(confirmer)
      .accountsPartial({
        config: pdaConfig()[0],
        admin,
        ixSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
  }

  /**
   * Propose a new admin (step 1 of the admin handoff; confirmer + acceptor follow).
   * Cosigned — bundle buildCosignEd25519Ix({cosigner, ix, nonce, signedTs}) BEFORE this ix in the same tx.
   */
  async proposeAdmin(admin: PublicKey, newAdmin: PublicKey): Promise<TransactionInstruction> {
    return this.client.program.methods
      .proposeAdmin(newAdmin)
      .accountsPartial({
        config: pdaConfig()[0],
        admin,
        ixSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
  }

  /**
   * Confirm a pending admin transfer (step 2; the confirmer signs). Not cosigned.
   */
  async confirmAdminTransfer(confirmer: PublicKey): Promise<TransactionInstruction> {
    return this.client.program.methods
      .confirmAdminTransfer()
      .accountsPartial({
        config: pdaConfig()[0],
        confirmer,
      })
      .instruction();
  }

  /**
   * Accept the admin role (step 3; the proposed new admin signs). Not cosigned.
   */
  async acceptAdmin(newAdmin: PublicKey): Promise<TransactionInstruction> {
    return this.client.program.methods
      .acceptAdmin()
      .accountsPartial({
        config: pdaConfig()[0],
        newAdmin,
      })
      .instruction();
  }

  /**
   * Cancel a pending admin transfer.
   * Cosigned — bundle buildCosignEd25519Ix({cosigner, ix, nonce, signedTs}) BEFORE this ix in the same tx.
   */
  async cancelAdminTransfer(admin: PublicKey): Promise<TransactionInstruction> {
    return this.client.program.methods
      .cancelAdminTransfer()
      .accountsPartial({
        config: pdaConfig()[0],
        admin,
        ixSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
  }

  /**
   * Whitelist `wallet` for PP deposits (creates its WhitelistEntry PDA).
   * Cosigned — bundle buildCosignEd25519Ix({cosigner, ix, nonce, signedTs}) BEFORE this ix in the same tx.
   */
  async addWhitelist(admin: PublicKey, wallet: PublicKey): Promise<TransactionInstruction> {
    return this.client.program.methods
      .addWhitelist(wallet)
      .accountsPartial({
        config: pdaConfig()[0],
        whitelistEntry: pdaWhitelist(wallet)[0],
        admin,
        ixSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /**
   * Remove `wallet` from the PP whitelist (closes its WhitelistEntry PDA).
   * Cosigned — bundle buildCosignEd25519Ix({cosigner, ix, nonce, signedTs}) BEFORE this ix in the same tx.
   */
  async removeWhitelist(admin: PublicKey, wallet: PublicKey): Promise<TransactionInstruction> {
    return this.client.program.methods
      .removeWhitelist(wallet)
      .accountsPartial({
        config: pdaConfig()[0],
        whitelistEntry: pdaWhitelist(wallet)[0],
        admin,
        ixSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
  }

  /**
   * Initialize the referral subsystem (ReferralConfig + ReferralTreasury PDAs).
   * Cosigned — bundle buildCosignEd25519Ix({cosigner, ix, nonce, signedTs}) BEFORE this ix in the same tx.
   */
  async initReferral(admin: PublicKey): Promise<TransactionInstruction> {
    return this.client.program.methods
      .initReferral()
      .accountsPartial({
        config: pdaConfig()[0],
        referralConfig: pdaReferralConfig()[0],
        referralTreasury: pdaReferralTreasury()[0],
        admin,
        ixSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /** Set retained-fee policy and the Team Ops Treasury destination. Cosigned. */
  async setFeePolicy(
    admin: PublicKey,
    retainBps: number,
    opsTreasury: PublicKey,
  ): Promise<TransactionInstruction> {
    if (!Number.isInteger(retainBps) || retainBps < 0 || retainBps > BPS_DENOMINATOR) {
      throw new RangeError(`retainBps must be an integer from 0 to ${BPS_DENOMINATOR}`);
    }
    if (opsTreasury.equals(PublicKey.default)) {
      throw new RangeError("opsTreasury must not be the default public key");
    }
    return this.client.program.methods
      .setFeePolicy(retainBps, opsTreasury)
      .accountsPartial({
        config: pdaConfig()[0],
        feeSchedule: pdaFeeSchedule()[0],
        admin,
        ixSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
  }

  /** Withdraw retained SOL or stORE to the configured Team Ops Treasury. Cosigned. */
  async opsWithdraw(
    admin: PublicKey,
    asset: FeeAsset,
    amount: bigint,
    opsTreasury: PublicKey,
  ): Promise<TransactionInstruction> {
    if (asset !== FEE_ASSET_SOL && asset !== FEE_ASSET_STORE) {
      throw new RangeError("asset must be FEE_ASSET_SOL or FEE_ASSET_STORE");
    }
    if (amount <= 0n) throw new RangeError("amount must be positive");
    const feeBucket = pdaFeeBucket()[0];
    return this.client.program.methods
      .opsWithdraw(asset, new BN(amount.toString()))
      .accountsPartial({
        config: pdaConfig()[0],
        feeSchedule: pdaFeeSchedule()[0],
        feeBucket,
        storeMint: STORE_MINT,
        feeStore: getAssociatedTokenAddressSync(STORE_MINT, feeBucket, true),
        opsTreasury,
        opsStoreAta: getAssociatedTokenAddressSync(STORE_MINT, opsTreasury, true),
        admin,
        ixSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /** Create/update wallet-scoped external deploy/performance fee exemption flags. Cosigned. */
  async setFeeExempt(
    admin: PublicKey,
    wallet: PublicKey,
    flags: number,
  ): Promise<TransactionInstruction> {
    if (flags === 0 || (flags & ~FEE_EXEMPT_VALID_MASK) !== 0) {
      throw new RangeError("flags must contain only supported fee-exemption scope bits");
    }
    return this.client.program.methods
      .setFeeExempt(wallet, flags)
      .accountsPartial({
        config: pdaConfig()[0],
        miningPool: pdaMiningPool()[0],
        feeExemptEntry: pdaFeeExempt(wallet)[0],
        miningPosition: pdaPosition(POOL_MINING, wallet)[0],
        admin,
        ixSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /** Clear a wallet exemption after its materialized rebate has been claimed. Cosigned. */
  async clearFeeExempt(admin: PublicKey, wallet: PublicKey): Promise<TransactionInstruction> {
    return this.client.program.methods
      .clearFeeExempt(wallet)
      .accountsPartial({
        config: pdaConfig()[0],
        miningPool: pdaMiningPool()[0],
        feeExemptEntry: pdaFeeExempt(wallet)[0],
        miningPosition: pdaPosition(POOL_MINING, wallet)[0],
        admin,
        ixSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
  }

  /** Sponsor PP liquidity without minting shares. Admin cosigns; `funder` also signs. */
  async topUpProtocolLiquidity(
    admin: PublicKey,
    funder: PublicKey,
    amount: bigint,
  ): Promise<TransactionInstruction> {
    if (amount <= 0n) throw new RangeError("amount must be positive");
    const protocolVaultAuthority = pdaVault(POOL_PROTOCOL)[0];
    return this.client.program.methods
      .topUpProtocolLiquidity(new BN(amount.toString()))
      .accountsPartial({
        config: pdaConfig()[0],
        miningPool: pdaMiningPool()[0],
        protocolPool: pdaProtocolPool()[0],
        protocolVaultAuthority,
        storeMint: STORE_MINT,
        protocolVaultAta: getAssociatedTokenAddressSync(
          STORE_MINT,
          protocolVaultAuthority,
          true,
        ),
        funderStoreAta: getAssociatedTokenAddressSync(STORE_MINT, funder),
        admin,
        funder,
        ixSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }
}
