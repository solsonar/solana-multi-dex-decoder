// SPDX-License-Identifier: MIT

import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { deriveDlmmDirection } from './DlmmDirection.js';
import {
  METEORA_DLMM_PROGRAM,
  ORCA_WHIRLPOOL_PROGRAM,
  PUMP_AMM_PROGRAM,
  RAYDIUM_AMM_V4_PROGRAM,
  RAYDIUM_CPMM_PROGRAM,
  RAYDIUM_CLMM_PROGRAM,
  DISC_DLMM_SWAP,
  DISC_DLMM_SWAP2,
  DISC_WHIRLPOOL_SWAP,
  DISC_WHIRLPOOL_SWAP_V2,
  DISC_PUMP_AMM_BUY,
  DISC_PUMP_AMM_SELL,
  RAYDIUM_AMM_V4_DISC_SWAP_BASE_IN_V1,
  RAYDIUM_AMM_V4_DISC_SWAP_BASE_OUT_V1,
  RAYDIUM_AMM_V4_DISC_SWAP_BASE_IN_V2,
  RAYDIUM_AMM_V4_DISC_SWAP_BASE_OUT_V2,
} from './constants.js';

// ─── Anchor-derived discriminators ──────────────────────────────────────────
function _sha8(s) {
  return createHash('sha256').update(s).digest().subarray(0, 8).toString('hex');
}

/** Raydium CPMM `swap_base_input` Anchor discriminator. */
export const DISC_CPMM_SWAP_IN  = _sha8('global:swap_base_input');
/** Raydium CPMM `swap_base_output` Anchor discriminator. */
export const DISC_CPMM_SWAP_OUT = _sha8('global:swap_base_output');
/** Raydium CLMM `swap_v2` Anchor discriminator. */
export const DISC_CLMM_SWAP_V2  = _sha8('global:swap_v2');
/** Raydium CLMM legacy `swap` Anchor discriminator. */
export const DISC_CLMM_SWAP_V1  = _sha8('global:swap');

// ─── Account-position constants by DEX ──────────────────────────────────────
//
// Where each instruction's POOL address lives within `accountKeyIndexes`.
const DLMM_POOL_IDX            = 0;
const WHIRLPOOL_SWAP_POOL_IDX  = 2;
const WHIRLPOOL_SWAP_V2_POOL_IDX = 4;
const PUMP_AMM_POOL_IDX        = 0;
const RAYDIUM_AMM_V4_POOL_IDX  = 1;   // both V1 (17-18 acc) and V2 (8 acc)
// Raydium AMM v4 user-side account positions (per raydium-amm/program/src/instruction.rs).
// Used to derive direction via ATA matching (no RPC needed — owner + mint + tokenProgram → ATA).
//   V1 layout (with Serum/OpenBook): 17-18 accounts
//     [0] SPL Token Program
//     [1] AMM Pool      [2] AMM Authority   [3] Open Orders
//     [4] Coin Vault    [5] PC Vault        [6..13] Market accounts
//     [14] User Source Token   [15] User Dest Token   [16] User Wallet (signer)
//   V2 layout (orderbook-disabled): 8 accounts
//     [0] SPL Token Program  [1] AMM Pool  [2] AMM Authority
//     [3] Coin Vault  [4] PC Vault
//     [5] User Source Token   [6] User Dest Token   [7] User Wallet (signer)
const RAYDIUM_AMM_V4_USER_SOURCE_IDX_V1 = 14;
const RAYDIUM_AMM_V4_USER_WALLET_IDX_V1 = 16;
const RAYDIUM_AMM_V4_USER_SOURCE_IDX_V2 = 5;
const RAYDIUM_AMM_V4_USER_WALLET_IDX_V2 = 7;
const RAYDIUM_CPMM_POOL_IDX    = 3;
const RAYDIUM_CPMM_INPUT_VAULT_IDX = 6;
const RAYDIUM_CLMM_POOL_IDX    = 2;
const RAYDIUM_CLMM_INPUT_VAULT_IDX = 5;

// SPL Token program IDs (legacy + Token-2022) — both used in production for ATAs.
const SPL_TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const SPL_TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const ATOKEN_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Compare `accounts[inputVaultIdx]` with the pool's known `reserve_x` / `reserve_y`
 * to derive direction (`'XtoY'` or `'YtoX'`). Used by Raydium CPMM/CLMM/AMM v4.
 */
function deriveDirectionByVault(accountIdxs, resolvedKeys, inputVaultIdx, poolDecoded) {
  if (!accountIdxs || accountIdxs.length <= inputVaultIdx) return 'unknown';
  const inputVault = resolvedKeys[accountIdxs[inputVaultIdx]];
  if (!inputVault || !poolDecoded) return 'unknown';
  const reserveX = poolDecoded.reserve_x?.toBase58?.();
  const reserveY = poolDecoded.reserve_y?.toBase58?.();
  if (inputVault === reserveX) return 'XtoY';
  if (inputVault === reserveY) return 'YtoX';
  return 'unknown';
}

/**
 * Derive the canonical Associated Token Account for (owner, mint, tokenProgram).
 * Returns base58 string, or null if any input is invalid.
 */
function deriveAtaBase58(ownerStr, tokenProgramStr, mintStr) {
  try {
    const owner = new PublicKey(ownerStr);
    const tokenProgram = new PublicKey(tokenProgramStr);
    const mint = new PublicKey(mintStr);
    const [ata] = PublicKey.findProgramAddressSync(
      [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
      ATOKEN_PROGRAM,
    );
    return ata.toBase58();
  } catch {
    return null;
  }
}

/**
 * Derive Raydium AMM v4 swap direction by matching the user's source-token ATA
 * against derived ATAs for the pool's base/quote mints. Pure-math (no RPC).
 *
 * Returns `'XtoY'` if user is paying base (X) → receiving quote (Y),
 *         `'YtoX'` if paying quote → receiving base, or `'unknown'` if no match.
 */
function deriveAmmV4Direction(accountIdxs, resolvedKeys, isV2, poolDecoded) {
  if (!accountIdxs || !poolDecoded) return 'unknown';
  const userSrcIdx = isV2 ? RAYDIUM_AMM_V4_USER_SOURCE_IDX_V2 : RAYDIUM_AMM_V4_USER_SOURCE_IDX_V1;
  const userWalletIdx = isV2 ? RAYDIUM_AMM_V4_USER_WALLET_IDX_V2 : RAYDIUM_AMM_V4_USER_WALLET_IDX_V1;
  if (accountIdxs.length <= userWalletIdx) return 'unknown';
  const userSrcAta = resolvedKeys[accountIdxs[userSrcIdx]];
  const owner = resolvedKeys[accountIdxs[userWalletIdx]];
  if (!userSrcAta || !owner) return 'unknown';

  // Pool decoder exposes base/quote mints under both raw fields and X/Y aliases.
  const baseMint = poolDecoded.base_mint?.toBase58?.()
    ?? poolDecoded.token_x_mint?.toBase58?.();
  const quoteMint = poolDecoded.quote_mint?.toBase58?.()
    ?? poolDecoded.token_y_mint?.toBase58?.();
  if (!baseMint || !quoteMint) return 'unknown';

  // Try both token program flavors — Raydium v4 only uses legacy SPL but be defensive.
  for (const tokenProgram of [SPL_TOKEN, SPL_TOKEN_2022]) {
    const baseAta = deriveAtaBase58(owner, tokenProgram, baseMint);
    if (baseAta === userSrcAta) return 'XtoY'; // user pays base = X → receives Y
    const quoteAta = deriveAtaBase58(owner, tokenProgram, quoteMint);
    if (quoteAta === userSrcAta) return 'YtoX'; // user pays quote = Y → receives X
  }
  return 'unknown';
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * @typedef {object} ParsedSwap
 * @property {string} poolAddr             Pool/lb_pair/whirlpool address (base58).
 * @property {bigint} inputAmount          Input amount in native units (worst-case for buy variants).
 * @property {'XtoY'|'YtoX'|'AtoB'|'BtoA'|'unknown'} direction
 *           Direction. DLMM/Pump/Raydium use `XtoY`/`YtoX` (X = base/0).
 *           Whirlpool uses `AtoB`/`BtoA` matching its SDK convention.
 * @property {'meteora-dlmm'|'orca-whirlpool'|'pump-amm'|'raydium-amm-v4'|'raydium-cpmm'|'raydium-clmm'} dex
 * @property {'direct'} via                Always `'direct'` for now (Jupiter/aggregator parsers TBD).
 * @property {boolean} [amountSpecifiedIsInput]   Whirlpool only.
 * @property {boolean} [isBaseIn]                 Raydium only — true if amount is input, false if output.
 * @property {boolean} [isBaseInput]              CLMM only — `is_base_input` flag from ix data.
 * @property {'v1'|'v2'} [ammV4Variant]           Raydium AMM v4 only.
 */

/**
 * @typedef {object} PoolMintLookup
 * @property {(poolAddr: string) => { decoded?: object } | null | undefined} get
 *           A function that returns an object with `.decoded.reserve_x` /
 *           `.decoded.reserve_y` for a tracked pool, or null/undefined. Used by
 *           Raydium swap parsers to derive direction by matching the input
 *           vault. Pass a `Map`-shaped object or your own cache wrapper.
 *           When omitted, Raydium swaps return `direction: 'unknown'`.
 */

/**
 * Parse a single compiled instruction. If it is a swap on a supported DEX and
 * the pool is in `trackedPools`, return a `ParsedSwap`. Otherwise return null.
 *
 * @param {{programIdIndex: number, accountKeyIndexes: number[], data: Buffer | Uint8Array}} ix
 * @param {string[]} resolvedKeys
 * @param {Set<string>} trackedPools  Pool addresses (base58) to filter by.
 * @param {PoolMintLookup} [poolLookup]  Optional pool reserve lookup for Raydium direction.
 * @returns {ParsedSwap | null}
 */
export function parseSwapInstruction(ix, resolvedKeys, trackedPools, poolLookup = null) {
  const programIdx = ix.programIdIndex;
  const accountIdxs = ix.accountKeyIndexes;
  const data = Buffer.isBuffer(ix.data) ? ix.data : Buffer.from(ix.data);

  if (programIdx == null || data.length < 1) return null;
  const programId = resolvedKeys[programIdx];
  if (!programId) return null;

  // Anchor-style discriminator (8 bytes hex). For Raydium AMM v4 we use a single
  // u8 — handled separately below.
  const disc8 = data.length >= 8 ? data.slice(0, 8).toString('hex') : null;

  if (programId === METEORA_DLMM_PROGRAM) {
    if (disc8 !== DISC_DLMM_SWAP && disc8 !== DISC_DLMM_SWAP2) return null;
    if (data.length < 24) return null;
    const amountIn = data.readBigUInt64LE(8);
    const poolAddr = resolvedKeys[accountIdxs[DLMM_POOL_IDX]];
    if (!poolAddr || !trackedPools.has(poolAddr)) return null;
    const direction = deriveDlmmDirection(accountIdxs, resolvedKeys);
    return { poolAddr, inputAmount: amountIn, direction, dex: 'meteora-dlmm', via: 'direct' };
  }

  if (programId === ORCA_WHIRLPOOL_PROGRAM) {
    let poolIdx;
    if (disc8 === DISC_WHIRLPOOL_SWAP) poolIdx = WHIRLPOOL_SWAP_POOL_IDX;
    else if (disc8 === DISC_WHIRLPOOL_SWAP_V2) poolIdx = WHIRLPOOL_SWAP_V2_POOL_IDX;
    else return null;

    if (data.length < 8 + 8 + 8 + 16 + 1 + 1) return null;
    const amount = data.readBigUInt64LE(8);
    const amountSpecifiedIsInput = data.readUInt8(8 + 8 + 8 + 16) !== 0;
    const aToB = data.readUInt8(8 + 8 + 8 + 16 + 1) !== 0;

    const poolAddr = resolvedKeys[accountIdxs[poolIdx]];
    if (!poolAddr || !trackedPools.has(poolAddr)) return null;

    return {
      poolAddr,
      inputAmount: amount,
      direction: aToB ? 'AtoB' : 'BtoA',
      dex: 'orca-whirlpool',
      via: 'direct',
      amountSpecifiedIsInput,
    };
  }

  if (programId === PUMP_AMM_PROGRAM) {
    if (disc8 !== DISC_PUMP_AMM_BUY && disc8 !== DISC_PUMP_AMM_SELL) return null;
    if (data.length < 24) return null;

    const poolAddr = resolvedKeys[accountIdxs[PUMP_AMM_POOL_IDX]];
    if (!poolAddr || !trackedPools.has(poolAddr)) return null;

    const isBuy = disc8 === DISC_PUMP_AMM_BUY;
    // BUY: input is `max_quote_amount_in` (worst-case cap)
    // SELL: input is `base_amount_in`
    const inputAmount = isBuy ? data.readBigUInt64LE(16) : data.readBigUInt64LE(8);

    // Extract protocol_fee_recipient (acc[9]) — rotates per slot through 8 known recipients.
    const victimFeeRecipient = accountIdxs.length > 9
      ? resolvedKeys[accountIdxs[9]] ?? null
      : null;

    // Extract buyback_fee_recipient — also rotates per slot through 8 known recipients.
    // BUY layout: acc[23] = buyback_fee_recipient (25 total + 1 remaining).
    // SELL layout: acc[21] = buyback_fee_recipient (23 total + 1 remaining).
    const buybackIdx = isBuy ? 23 : 21;
    const victimBuybackRecipient = accountIdxs.length > buybackIdx
      ? resolvedKeys[accountIdxs[buybackIdx]] ?? null
      : null;

    return {
      poolAddr,
      inputAmount,
      direction: isBuy ? 'YtoX' : 'XtoY',
      dex: 'pump-amm',
      via: 'direct',
      victimFeeRecipient,
      victimBuybackRecipient,
    };
  }

  if (programId === RAYDIUM_AMM_V4_PROGRAM) {
    // Single u8 discriminator at byte 0.
    if (data.length < 17) return null;
    const ammDisc = data.readUInt8(0);
    let isV2;
    if (ammDisc === RAYDIUM_AMM_V4_DISC_SWAP_BASE_IN_V2 ||
        ammDisc === RAYDIUM_AMM_V4_DISC_SWAP_BASE_OUT_V2) {
      isV2 = true;
    } else if (ammDisc === RAYDIUM_AMM_V4_DISC_SWAP_BASE_IN_V1 ||
               ammDisc === RAYDIUM_AMM_V4_DISC_SWAP_BASE_OUT_V1) {
      isV2 = false;
    } else {
      return null;
    }
    const isBaseIn = ammDisc === RAYDIUM_AMM_V4_DISC_SWAP_BASE_IN_V1 ||
                     ammDisc === RAYDIUM_AMM_V4_DISC_SWAP_BASE_IN_V2;

    const poolAddr = resolvedKeys[accountIdxs[RAYDIUM_AMM_V4_POOL_IDX]];
    if (!poolAddr || !trackedPools.has(poolAddr)) return null;

    const amount = data.readBigUInt64LE(1);

    // Direction: derive from user's source-token ATA (matches input token to
    // pool's base/quote mint). `isBaseIn` discriminator means "exact-input
    // amount specified" — input token can still be EITHER base OR quote, so
    // it's not a reliable direction signal. ATA matching is.
    //
    // Requires `poolLookup` (caller passes PoolStateCache). Falls back to
    // 'unknown' if pool not cached — better than wrong direction.
    //
    // Bug #19 fix (2026-05-07): previously used `isBaseIn ? 'XtoY' : 'YtoX'`
    // which gave wrong direction in ~50% of v4 swaps. Verified on-chain
    // against 2 SUSPECT cases — both flipped after this change.
    const poolEntry = poolLookup?.get?.(poolAddr);
    const direction = poolEntry?.decoded
      ? deriveAmmV4Direction(accountIdxs, resolvedKeys, isV2, poolEntry.decoded)
      : 'unknown';

    return {
      poolAddr,
      inputAmount: amount,
      direction,
      dex: 'raydium-amm-v4',
      via: 'direct',
      ammV4Variant: isV2 ? 'v2' : 'v1',
      isBaseIn,
    };
  }

  if (programId === RAYDIUM_CPMM_PROGRAM) {
    if (disc8 !== DISC_CPMM_SWAP_IN && disc8 !== DISC_CPMM_SWAP_OUT) return null;
    if (data.length < 24) return null;

    const poolAddr = resolvedKeys[accountIdxs[RAYDIUM_CPMM_POOL_IDX]];
    if (!poolAddr || !trackedPools.has(poolAddr)) return null;

    const amount = data.readBigUInt64LE(8);
    const isBaseIn = disc8 === DISC_CPMM_SWAP_IN;

    const poolEntry = poolLookup?.get?.(poolAddr);
    const direction = poolEntry?.decoded
      ? deriveDirectionByVault(accountIdxs, resolvedKeys, RAYDIUM_CPMM_INPUT_VAULT_IDX, poolEntry.decoded)
      : 'unknown';

    return {
      poolAddr,
      inputAmount: amount,
      direction,
      dex: 'raydium-cpmm',
      via: 'direct',
      isBaseIn,
    };
  }

  if (programId === RAYDIUM_CLMM_PROGRAM) {
    if (disc8 !== DISC_CLMM_SWAP_V2 && disc8 !== DISC_CLMM_SWAP_V1) return null;
    if (data.length < 41) return null;

    const poolAddr = resolvedKeys[accountIdxs[RAYDIUM_CLMM_POOL_IDX]];
    if (!poolAddr || !trackedPools.has(poolAddr)) return null;

    const amount = data.readBigUInt64LE(8);
    const isBaseInput = data.readUInt8(40) !== 0;

    const poolEntry = poolLookup?.get?.(poolAddr);
    const direction = poolEntry?.decoded
      ? deriveDirectionByVault(accountIdxs, resolvedKeys, RAYDIUM_CLMM_INPUT_VAULT_IDX, poolEntry.decoded)
      : 'unknown';

    return {
      poolAddr,
      inputAmount: amount,
      direction,
      dex: 'raydium-clmm',
      via: 'direct',
      isBaseInput,
    };
  }

  return null;
}

/**
 * Walk a `VersionedTransaction.message`'s compiled instructions and return all
 * supported swaps that touch a tracked pool.
 *
 * @param {{ message: { compiledInstructions?: any[] } }} vtx
 * @param {string[]} resolvedKeys  Account keys after ALT resolution. Pair this
 *   package with [@solsonar/solana-alt-cache](https://www.npmjs.com/package/@solsonar/solana-alt-cache)
 *   for the resolution step.
 * @param {Set<string>} trackedPools
 * @param {PoolMintLookup} [poolLookup]
 * @returns {ParsedSwap[]}
 */
export function parseSwapsFromTx(vtx, resolvedKeys, trackedPools, poolLookup = null) {
  const ixs = vtx?.message?.compiledInstructions || [];
  const out = [];
  for (const ix of ixs) {
    const parsed = parseSwapInstruction(ix, resolvedKeys, trackedPools, poolLookup);
    if (parsed) out.push(parsed);
  }
  return out;
}
