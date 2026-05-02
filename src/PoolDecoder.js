// SPDX-License-Identifier: MIT

import { createRequire } from 'node:module';
import { PublicKey } from '@solana/web3.js';
import {
  METEORA_DLMM_PROGRAM,
  ORCA_WHIRLPOOL_PROGRAM,
  PUMP_AMM_PROGRAM,
  RAYDIUM_AMM_V4_PROGRAM,
  RAYDIUM_CPMM_PROGRAM,
  RAYDIUM_CLMM_PROGRAM,
  SPL_TOKEN_PROGRAM,
  SPL_TOKEN_2022_PROGRAM,
  DISC_LB_PAIR,
  DISC_WHIRLPOOL,
  DISC_PUMP_POOL,
  DISC_RAYDIUM_POOL_STATE,
  DISC_RAYDIUM_TICK_ARRAY,
  SIZE_LB_PAIR,
  SIZE_WHIRLPOOL,
  SIZE_PUMP_POOL_MIN,
  SIZE_RAYDIUM_AMM_V4,
  SIZE_RAYDIUM_CPMM_MIN,
  SIZE_RAYDIUM_CLMM_MIN,
  SIZE_SPL_TOKEN_ACCOUNT,
} from './constants.js';

const require = createRequire(import.meta.url);

// Lazy-load Anchor + Meteora/Orca SDKs only when actually needed. They are
// peer-deps so users may not install them if they don't need DLMM/Whirlpool.
let _anchor;
let _dlmmCoder;
let _whirlpoolCoder;

function lazyDlmmCoder() {
  if (_dlmmCoder !== undefined) return _dlmmCoder;
  try {
    if (!_anchor) _anchor = require('@coral-xyz/anchor');
    const dlmmPkg = require('@meteora-ag/dlmm');
    _dlmmCoder = new _anchor.BorshAccountsCoder(dlmmPkg.IDL);
  } catch {
    _dlmmCoder = null;
  }
  return _dlmmCoder;
}

function lazyWhirlpoolCoder() {
  if (_whirlpoolCoder !== undefined) return _whirlpoolCoder;
  try {
    if (!_anchor) _anchor = require('@coral-xyz/anchor');
    const wpPkg = require('@orca-so/whirlpools-sdk');
    _whirlpoolCoder = new _anchor.BorshAccountsCoder(wpPkg.WHIRLPOOL_IDL);
  } catch {
    _whirlpoolCoder = null;
  }
  return _whirlpoolCoder;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function readU128LE(buf, off) {
  const lo = buf.readBigUInt64LE(off);
  const hi = buf.readBigUInt64LE(off + 8);
  return lo + (hi << 64n);
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * @typedef {object} DecodedAccount
 * @property {'pool' | 'binArray' | 'tickArray' | 'tokenAccount' | 'unknown'} type
 * @property {'meteora-dlmm' | 'orca-whirlpool' | 'pump-amm' | 'raydium-amm-v4' | 'raydium-cpmm' | 'raydium-clmm' | undefined} [dex]
 * @property {object} [decoded]   Parsed fields. Snake_case throughout, with `token_x_mint`/`token_y_mint`/`reserve_x`/`reserve_y` aliases populated when applicable so consumers can use a uniform shape across DEXes.
 * @property {string} [error]
 */

/**
 * Decode a Solana account by its owner program. Returns a normalized result with
 * snake_case field names. Where pools have a "base/quote" or "0/1" naming, we
 * also expose `token_x_mint`/`token_y_mint`/`reserve_x`/`reserve_y` aliases
 * (X = base / 0, Y = quote / 1) so consumer code can reuse a single shape.
 *
 * Supported owner programs: Meteora DLMM, Orca Whirlpool, Pump AMM, Raydium
 * AMM v4, Raydium CPMM, Raydium CLMM, SPL Token, Token-2022.
 *
 * Returns `null` if the owner program is not recognized.
 *
 * @param {PublicKey | string} ownerProgram
 * @param {Buffer} dataBuf
 * @returns {DecodedAccount | null}
 */
export function decodeAccount(ownerProgram, dataBuf) {
  const owner = ownerProgram instanceof PublicKey ? ownerProgram.toBase58() : String(ownerProgram);
  if (!dataBuf || dataBuf.length < 8) return null;

  if (owner === SPL_TOKEN_PROGRAM || owner === SPL_TOKEN_2022_PROGRAM) {
    return decodeTokenAccount(dataBuf, owner);
  }

  const disc = dataBuf.slice(0, 8).toString('hex');

  switch (owner) {
    case METEORA_DLMM_PROGRAM:   return decodeDlmmAccount(dataBuf, disc);
    case ORCA_WHIRLPOOL_PROGRAM: return decodeWhirlpoolAccount(dataBuf, disc);
    case PUMP_AMM_PROGRAM:       return decodePumpAmmAccount(dataBuf, disc);
    case RAYDIUM_AMM_V4_PROGRAM: return decodeRaydiumAmmV4Account(dataBuf);
    case RAYDIUM_CPMM_PROGRAM:   return decodeRaydiumCpmmAccount(dataBuf, disc);
    case RAYDIUM_CLMM_PROGRAM:   return decodeRaydiumClmmAccount(dataBuf, disc);
    default:                     return null;
  }
}

// ─── SPL Token / Token-2022 ─────────────────────────────────────────────────

function decodeTokenAccount(buf, ownerProgram) {
  if (buf.length < SIZE_SPL_TOKEN_ACCOUNT) {
    return { type: 'unknown', error: `token account too small: ${buf.length}` };
  }
  const mint = new PublicKey(buf.slice(0, 32)).toBase58();
  const accOwner = new PublicKey(buf.slice(32, 64)).toBase58();
  const amount = buf.readBigUInt64LE(64);
  return {
    type: 'tokenAccount',
    decoded: { mint, owner: accOwner, amount, tokenProgram: ownerProgram },
  };
}

// ─── Meteora DLMM ───────────────────────────────────────────────────────────

function decodeDlmmAccount(buf, disc) {
  const coder = lazyDlmmCoder();
  if (!coder) {
    return { type: 'unknown', error: 'Meteora DLMM SDK not installed; install @meteora-ag/dlmm to decode DLMM accounts' };
  }
  if (disc === DISC_LB_PAIR && buf.length === SIZE_LB_PAIR) {
    try {
      const decoded = coder.decode('LbPair', buf);
      return { type: 'pool', dex: 'meteora-dlmm', decoded };
    } catch (e) {
      return { type: 'unknown', error: `LbPair decode failed: ${e.message}` };
    }
  }
  try {
    const decoded = coder.decode('BinArray', buf);
    return { type: 'binArray', dex: 'meteora-dlmm', decoded };
  } catch {
    // not a BinArray
  }
  return { type: 'unknown', dex: 'meteora-dlmm', size: buf.length };
}

// ─── Orca Whirlpool ─────────────────────────────────────────────────────────

function decodeWhirlpoolAccount(buf, disc) {
  const coder = lazyWhirlpoolCoder();
  if (!coder) {
    return { type: 'unknown', error: 'Orca Whirlpool SDK not installed; install @orca-so/whirlpools-sdk to decode Whirlpool accounts' };
  }
  if (disc === DISC_WHIRLPOOL && buf.length === SIZE_WHIRLPOOL) {
    try {
      const decoded = coder.decode('Whirlpool', buf);
      return { type: 'pool', dex: 'orca-whirlpool', decoded };
    } catch (e) {
      return { type: 'unknown', error: `Whirlpool decode failed: ${e.message}` };
    }
  }
  try {
    const decoded = coder.decode('TickArray', buf);
    return { type: 'tickArray', dex: 'orca-whirlpool', decoded };
  } catch {
    // not a TickArray
  }
  return { type: 'unknown', dex: 'orca-whirlpool', size: buf.length };
}

// ─── Pump AMM (graduated pool) ──────────────────────────────────────────────
//
// Layout (allocated 301 bytes; 275 used + 26 reserved):
//   [0..8]    discriminator        f19a6d0411b16dbc
//   [8]       pool_bump            u8
//   [9..11]   index                u16 LE
//   [11..43]  creator              pubkey
//   [43..75]  base_mint            pubkey  (X)
//   [75..107] quote_mint           pubkey  (Y)
//   [107..139] lp_mint             pubkey
//   [139..171] pool_base_token_account   pubkey  (base vault, X)
//   [171..203] pool_quote_token_account  pubkey  (quote vault, Y)
//   [203..211] lp_supply           u64 LE
//   [211..243] coin_creator        pubkey
//   [243..275] fee_recipient       pubkey  (pool's protocol fee recipient — varies per pool!)
function decodePumpAmmAccount(buf, disc) {
  if (disc !== DISC_PUMP_POOL) {
    return { type: 'unknown', dex: 'pump-amm', size: buf.length };
  }
  if (buf.length < SIZE_PUMP_POOL_MIN) {
    return { type: 'unknown', error: `Pump AMM pool too small: ${buf.length}` };
  }
  try {
    const decoded = {
      pool_bump:        buf.readUInt8(8),
      index:            buf.readUInt16LE(9),
      creator:          new PublicKey(buf.slice(11, 43)),
      token_x_mint:     new PublicKey(buf.slice(43, 75)),
      token_y_mint:     new PublicKey(buf.slice(75, 107)),
      base_mint:        new PublicKey(buf.slice(43, 75)),
      quote_mint:       new PublicKey(buf.slice(75, 107)),
      lp_mint:          new PublicKey(buf.slice(107, 139)),
      reserve_x:        new PublicKey(buf.slice(139, 171)),
      reserve_y:        new PublicKey(buf.slice(171, 203)),
      pool_base_token_account:  new PublicKey(buf.slice(139, 171)),
      pool_quote_token_account: new PublicKey(buf.slice(171, 203)),
      lp_supply:        buf.readBigUInt64LE(203),
      coin_creator:     new PublicKey(buf.slice(211, 243)),
      // protocol_fee_recipient: pool field at off 243+ when allocated >= 275.
      // Only present for pools created post-cashback upgrade. Older 243-byte
      // pools fall back to null (caller should use a known recipient list).
      protocol_fee_recipient: buf.length >= 275
        ? new PublicKey(buf.slice(243, 275))
        : null,
    };
    return { type: 'pool', dex: 'pump-amm', decoded };
  } catch (e) {
    return { type: 'unknown', error: `Pump AMM decode failed: ${e.message}` };
  }
}

// ─── Raydium AMM v4 (legacy CP, optional OpenBook) ──────────────────────────
//
// LIQUIDITY_STATE_LAYOUT_V4 — fixed 752 bytes, NOT Anchor (manual binary).
//   [0..8]    status               u64 LE  (1 enabled, 6 swap-only)
//   [128..192] Fees struct (64B)
//     [144..152] trade_fee_numerator
//     [152..160] trade_fee_denominator
//     [176..184] swap_fee_numerator
//     [184..192] swap_fee_denominator
//   [336..368] coin_vault    (X reserve)
//   [368..400] pc_vault      (Y reserve)
//   [400..432] coin_vault_mint  (X mint)
//   [432..464] pc_vault_mint    (Y mint)
//   [464..496] lp_mint
//   [496..528] open_orders   (Serum/OpenBook)
//   [528..560] market
//   [560..592] market_program
function decodeRaydiumAmmV4Account(buf) {
  if (buf.length !== SIZE_RAYDIUM_AMM_V4) {
    return { type: 'unknown', error: `Raydium AMM v4 wrong size: ${buf.length}` };
  }
  try {
    const decoded = {
      status:                buf.readBigUInt64LE(0),
      coin_decimals:         buf.readBigUInt64LE(32),
      pc_decimals:           buf.readBigUInt64LE(40),
      trade_fee_numerator:   buf.readBigUInt64LE(144),
      trade_fee_denominator: buf.readBigUInt64LE(152),
      swap_fee_numerator:    buf.readBigUInt64LE(176),
      swap_fee_denominator:  buf.readBigUInt64LE(184),
      reserve_x:    new PublicKey(buf.slice(336, 368)),  // coin_vault
      reserve_y:    new PublicKey(buf.slice(368, 400)),  // pc_vault
      coin_vault:   new PublicKey(buf.slice(336, 368)),
      pc_vault:     new PublicKey(buf.slice(368, 400)),
      token_x_mint: new PublicKey(buf.slice(400, 432)),
      token_y_mint: new PublicKey(buf.slice(432, 464)),
      base_mint:    new PublicKey(buf.slice(400, 432)),
      quote_mint:   new PublicKey(buf.slice(432, 464)),
      lp_mint:      new PublicKey(buf.slice(464, 496)),
      open_orders:  new PublicKey(buf.slice(496, 528)),
      market:       new PublicKey(buf.slice(528, 560)),
      market_program: new PublicKey(buf.slice(560, 592)),
    };
    return { type: 'pool', dex: 'raydium-amm-v4', decoded };
  } catch (e) {
    return { type: 'unknown', error: `Raydium AMM v4 decode failed: ${e.message}` };
  }
}

// ─── Raydium CPMM (constant product, Anchor) ────────────────────────────────
//
// PoolState account, ~637 bytes (8 disc + ~629 data + padding).
// After 8-byte discriminator (data offsets):
//   [0..32]   amm_config
//   [32..64]  pool_creator
//   [64..96]  token_0_vault   (X)
//   [96..128] token_1_vault   (Y)
//   [128..160] lp_mint
//   [160..192] token_0_mint   (X)
//   [192..224] token_1_mint   (Y)
//   [224..256] token_0_program
//   [256..288] token_1_program
//   [288..320] observation_key
//   [320..325] auth_bump, status, lp_decimals, mint_0_decimals, mint_1_decimals (u8 each)
//   [325..333] lp_supply (u64)
function decodeRaydiumCpmmAccount(buf, disc) {
  if (disc !== DISC_RAYDIUM_POOL_STATE) {
    return { type: 'unknown', dex: 'raydium-cpmm', size: buf.length };
  }
  if (buf.length < SIZE_RAYDIUM_CPMM_MIN) {
    return { type: 'unknown', error: `Raydium CPMM too small: ${buf.length}` };
  }
  try {
    const d = buf.subarray(8);
    const decoded = {
      amm_config:        new PublicKey(d.slice(0, 32)),
      pool_creator:      new PublicKey(d.slice(32, 64)),
      reserve_x:         new PublicKey(d.slice(64, 96)),
      reserve_y:         new PublicKey(d.slice(96, 128)),
      token_0_vault:     new PublicKey(d.slice(64, 96)),
      token_1_vault:     new PublicKey(d.slice(96, 128)),
      lp_mint:           new PublicKey(d.slice(128, 160)),
      token_x_mint:      new PublicKey(d.slice(160, 192)),
      token_y_mint:      new PublicKey(d.slice(192, 224)),
      base_mint:         new PublicKey(d.slice(160, 192)),
      quote_mint:        new PublicKey(d.slice(192, 224)),
      token_0_program:   new PublicKey(d.slice(224, 256)),
      token_1_program:   new PublicKey(d.slice(256, 288)),
      observation_key:   new PublicKey(d.slice(288, 320)),
      auth_bump:         d.readUInt8(320),
      status:            d.readUInt8(321),
      lp_mint_decimals:  d.readUInt8(322),
      mint_0_decimals:   d.readUInt8(323),
      mint_1_decimals:   d.readUInt8(324),
      lp_supply:         d.readBigUInt64LE(325),
    };
    return { type: 'pool', dex: 'raydium-cpmm', decoded };
  } catch (e) {
    return { type: 'unknown', error: `Raydium CPMM decode failed: ${e.message}` };
  }
}

// ─── Raydium CLMM (concentrated liquidity, Anchor) ──────────────────────────
//
// PoolState account, ~1544 bytes (8 disc + 1536 data).
// After 8-byte discriminator (data offsets):
//   [0]       bump
//   [1..33]   amm_config
//   [33..65]  owner
//   [65..97]  token_mint_0   (X)
//   [97..129] token_mint_1   (Y)
//   [129..161] token_vault_0  (X)
//   [161..193] token_vault_1  (Y)
//   [193..225] observation_key
//   [225]     mint_decimals_0
//   [226]     mint_decimals_1
//   [227..229] tick_spacing (u16)
//   [229..245] liquidity (u128)
//   [245..261] sqrt_price_x64 (u128)
//   [261..265] tick_current (i32)
//
// TickArrayState (separate account, ~10456 bytes, disc c09b55cd31f9812a):
//   [0..32]   pool_id
//   [32..36]  start_tick_index (i32)
//   ...60 ticks × 168 bytes each (skipped here — exposed as `_raw` for
//   downstream multi-tick quote engines).
function decodeRaydiumClmmAccount(buf, disc) {
  if (disc === DISC_RAYDIUM_POOL_STATE && buf.length >= SIZE_RAYDIUM_CLMM_MIN) {
    try {
      const d = buf.subarray(8);
      const decoded = {
        bump:              d.readUInt8(0),
        amm_config:        new PublicKey(d.slice(1, 33)),
        owner:             new PublicKey(d.slice(33, 65)),
        token_x_mint:      new PublicKey(d.slice(65, 97)),
        token_y_mint:      new PublicKey(d.slice(97, 129)),
        base_mint:         new PublicKey(d.slice(65, 97)),
        quote_mint:        new PublicKey(d.slice(97, 129)),
        reserve_x:         new PublicKey(d.slice(129, 161)),
        reserve_y:         new PublicKey(d.slice(161, 193)),
        token_vault_0:     new PublicKey(d.slice(129, 161)),
        token_vault_1:     new PublicKey(d.slice(161, 193)),
        observation_key:   new PublicKey(d.slice(193, 225)),
        mint_decimals_0:   d.readUInt8(225),
        mint_decimals_1:   d.readUInt8(226),
        tick_spacing:      d.readUInt16LE(227),
        liquidity:         readU128LE(d, 229),
        sqrt_price_x64:    readU128LE(d, 245),
        tick_current:      d.readInt32LE(261),
      };
      return { type: 'pool', dex: 'raydium-clmm', decoded };
    } catch (e) {
      return { type: 'unknown', error: `Raydium CLMM pool decode failed: ${e.message}` };
    }
  }
  if (disc === DISC_RAYDIUM_TICK_ARRAY) {
    try {
      const d = buf.subarray(8);
      const decoded = {
        pool_id:           new PublicKey(d.slice(0, 32)),
        start_tick_index:  d.readInt32LE(32),
        // Full 60-tick parsing on demand; expose raw payload for a downstream
        // multi-tick quote engine.
        _raw: d,
      };
      return { type: 'tickArray', dex: 'raydium-clmm', decoded };
    } catch (e) {
      return { type: 'unknown', error: `Raydium CLMM tickArray decode failed: ${e.message}` };
    }
  }
  return { type: 'unknown', dex: 'raydium-clmm', size: buf.length };
}
