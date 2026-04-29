// Mock-based tests — no real RPC needed. Verifies public API surface and core
// decoding paths that don't depend on Anchor IDL (Pump AMM, Raydium AMM v4 / CPMM / CLMM,
// SPL Token).
//
// Run with: node --test test/

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { PublicKey } from '@solana/web3.js';
import {
  decodeAccount,
  parseSwapInstruction,
  parseSwapsFromTx,
  deriveDlmmDirection,
  METEORA_DLMM_PROGRAM,
  ORCA_WHIRLPOOL_PROGRAM,
  PUMP_AMM_PROGRAM,
  RAYDIUM_AMM_V4_PROGRAM,
  RAYDIUM_CPMM_PROGRAM,
  RAYDIUM_CLMM_PROGRAM,
  SPL_TOKEN_PROGRAM,
  DISC_PUMP_POOL,
  DISC_RAYDIUM_POOL_STATE,
  DISC_PUMP_AMM_BUY,
  DISC_PUMP_AMM_SELL,
  DISC_CPMM_SWAP_IN,
  DISC_CPMM_SWAP_OUT,
  DISC_CLMM_SWAP_V2,
  RAYDIUM_AMM_V4_DISC_SWAP_BASE_IN_V2,
  RAYDIUM_AMM_V4_DISC_SWAP_BASE_OUT_V2,
  SIZE_PUMP_POOL_MIN,
  SIZE_RAYDIUM_AMM_V4,
  SIZE_RAYDIUM_CPMM_MIN,
  SIZE_RAYDIUM_CLMM_MIN,
  SIZE_SPL_TOKEN_ACCOUNT,
} from '../src/index.js';

// ─── Constants ─────────────────────────────────────────────────────────────

test('exports program ID constants', () => {
  assert.equal(METEORA_DLMM_PROGRAM, 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo');
  assert.equal(ORCA_WHIRLPOOL_PROGRAM, 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');
  assert.equal(PUMP_AMM_PROGRAM, 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
  assert.equal(RAYDIUM_AMM_V4_PROGRAM, '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');
  assert.equal(RAYDIUM_CPMM_PROGRAM, 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C');
  assert.equal(RAYDIUM_CLMM_PROGRAM, 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK');
});

test('Anchor-derived swap discriminators are stable', () => {
  // sha256("global:swap_base_input")[:8] = 8fbe5adac41e33de
  assert.equal(DISC_CPMM_SWAP_IN.length, 16);
  assert.equal(DISC_CPMM_SWAP_OUT.length, 16);
  assert.equal(DISC_CLMM_SWAP_V2.length, 16);
});

// ─── decodeAccount ─────────────────────────────────────────────────────────

test('decodeAccount returns null for unknown owners', () => {
  const buf = Buffer.alloc(100);
  assert.equal(decodeAccount('11111111111111111111111111111111', buf), null);
});

test('decodeAccount returns null for too-small buffers', () => {
  assert.equal(decodeAccount(PUMP_AMM_PROGRAM, Buffer.alloc(4)), null);
});

test('decodeAccount handles SPL Token account', () => {
  const buf = Buffer.alloc(SIZE_SPL_TOKEN_ACCOUNT);
  const mint = PublicKey.unique();
  const owner = PublicKey.unique();
  mint.toBuffer().copy(buf, 0);
  owner.toBuffer().copy(buf, 32);
  buf.writeBigUInt64LE(123_456_789n, 64);

  const r = decodeAccount(SPL_TOKEN_PROGRAM, buf);
  assert.equal(r.type, 'tokenAccount');
  assert.equal(r.decoded.mint, mint.toBase58());
  assert.equal(r.decoded.owner, owner.toBase58());
  assert.equal(r.decoded.amount, 123_456_789n);
});

// ─── Pump AMM ──────────────────────────────────────────────────────────────

function buildPumpPoolBuf({ baseMint, quoteMint, lpMint, baseVault, quoteVault }) {
  const buf = Buffer.alloc(300);
  Buffer.from(DISC_PUMP_POOL, 'hex').copy(buf, 0);
  buf.writeUInt8(255, 8);          // pool_bump
  buf.writeUInt16LE(1, 9);         // index
  PublicKey.unique().toBuffer().copy(buf, 11);  // creator
  baseMint.toBuffer().copy(buf, 43);
  quoteMint.toBuffer().copy(buf, 75);
  lpMint.toBuffer().copy(buf, 107);
  baseVault.toBuffer().copy(buf, 139);
  quoteVault.toBuffer().copy(buf, 171);
  buf.writeBigUInt64LE(1_000_000n, 203);  // lp_supply
  PublicKey.unique().toBuffer().copy(buf, 211);  // coin_creator
  return buf;
}

test('decodeAccount handles Pump AMM pool', () => {
  const baseMint = PublicKey.unique();
  const quoteMint = PublicKey.unique();
  const lpMint = PublicKey.unique();
  const baseVault = PublicKey.unique();
  const quoteVault = PublicKey.unique();
  const buf = buildPumpPoolBuf({ baseMint, quoteMint, lpMint, baseVault, quoteVault });

  const r = decodeAccount(PUMP_AMM_PROGRAM, buf);
  assert.equal(r.type, 'pool');
  assert.equal(r.dex, 'pump-amm');
  assert.equal(r.decoded.base_mint.toBase58(), baseMint.toBase58());
  assert.equal(r.decoded.quote_mint.toBase58(), quoteMint.toBase58());
  assert.equal(r.decoded.token_x_mint.toBase58(), baseMint.toBase58(), 'X = base alias');
  assert.equal(r.decoded.token_y_mint.toBase58(), quoteMint.toBase58(), 'Y = quote alias');
  assert.equal(r.decoded.reserve_x.toBase58(), baseVault.toBase58());
  assert.equal(r.decoded.reserve_y.toBase58(), quoteVault.toBase58());
  assert.equal(r.decoded.lp_supply, 1_000_000n);
});

test('decodeAccount marks Pump AMM with bad disc as unknown', () => {
  const buf = Buffer.alloc(SIZE_PUMP_POOL_MIN);
  // disc = 0
  const r = decodeAccount(PUMP_AMM_PROGRAM, buf);
  assert.equal(r.type, 'unknown');
});

// ─── Raydium AMM v4 ────────────────────────────────────────────────────────

test('decodeAccount handles Raydium AMM v4', () => {
  const buf = Buffer.alloc(SIZE_RAYDIUM_AMM_V4);
  const coinMint = PublicKey.unique();
  const pcMint = PublicKey.unique();
  const coinVault = PublicKey.unique();
  const pcVault = PublicKey.unique();
  buf.writeBigUInt64LE(6n, 0);                 // status = swap-only
  buf.writeBigUInt64LE(9n, 32);                // coin_decimals
  buf.writeBigUInt64LE(6n, 40);                // pc_decimals
  buf.writeBigUInt64LE(25n, 144);              // trade_fee_numerator
  buf.writeBigUInt64LE(10000n, 152);           // trade_fee_denominator
  coinVault.toBuffer().copy(buf, 336);
  pcVault.toBuffer().copy(buf, 368);
  coinMint.toBuffer().copy(buf, 400);
  pcMint.toBuffer().copy(buf, 432);

  const r = decodeAccount(RAYDIUM_AMM_V4_PROGRAM, buf);
  assert.equal(r.type, 'pool');
  assert.equal(r.dex, 'raydium-amm-v4');
  assert.equal(r.decoded.status, 6n);
  assert.equal(r.decoded.token_x_mint.toBase58(), coinMint.toBase58());
  assert.equal(r.decoded.token_y_mint.toBase58(), pcMint.toBase58());
  assert.equal(r.decoded.reserve_x.toBase58(), coinVault.toBase58());
  assert.equal(r.decoded.reserve_y.toBase58(), pcVault.toBase58());
});

test('decodeAccount marks AMM v4 wrong-size as unknown', () => {
  const buf = Buffer.alloc(500);
  const r = decodeAccount(RAYDIUM_AMM_V4_PROGRAM, buf);
  assert.equal(r.type, 'unknown');
});

// ─── Raydium CPMM ──────────────────────────────────────────────────────────

test('decodeAccount handles Raydium CPMM pool', () => {
  const buf = Buffer.alloc(637);
  Buffer.from(DISC_RAYDIUM_POOL_STATE, 'hex').copy(buf, 0);
  const ammConfig = PublicKey.unique();
  const v0 = PublicKey.unique();
  const v1 = PublicKey.unique();
  const m0 = PublicKey.unique();
  const m1 = PublicKey.unique();
  const d = buf.subarray(8);
  ammConfig.toBuffer().copy(d, 0);
  v0.toBuffer().copy(d, 64);
  v1.toBuffer().copy(d, 96);
  m0.toBuffer().copy(d, 160);
  m1.toBuffer().copy(d, 192);
  d.writeUInt8(9, 323);   // mint_0 decimals
  d.writeUInt8(6, 324);   // mint_1 decimals

  const r = decodeAccount(RAYDIUM_CPMM_PROGRAM, buf);
  assert.equal(r.type, 'pool');
  assert.equal(r.dex, 'raydium-cpmm');
  assert.equal(r.decoded.token_x_mint.toBase58(), m0.toBase58());
  assert.equal(r.decoded.token_y_mint.toBase58(), m1.toBase58());
  assert.equal(r.decoded.reserve_x.toBase58(), v0.toBase58());
  assert.equal(r.decoded.reserve_y.toBase58(), v1.toBase58());
  assert.equal(r.decoded.mint_0_decimals, 9);
  assert.equal(r.decoded.mint_1_decimals, 6);
});

// ─── Raydium CLMM ──────────────────────────────────────────────────────────

test('decodeAccount handles Raydium CLMM pool', () => {
  const buf = Buffer.alloc(1544);
  Buffer.from(DISC_RAYDIUM_POOL_STATE, 'hex').copy(buf, 0);
  const m0 = PublicKey.unique();
  const m1 = PublicKey.unique();
  const v0 = PublicKey.unique();
  const v1 = PublicKey.unique();
  const d = buf.subarray(8);
  m0.toBuffer().copy(d, 65);
  m1.toBuffer().copy(d, 97);
  v0.toBuffer().copy(d, 129);
  v1.toBuffer().copy(d, 161);
  d.writeUInt16LE(60, 227);  // tick_spacing
  // liquidity (u128, low part only for simple test)
  d.writeBigUInt64LE(1_000_000_000n, 229);
  d.writeBigUInt64LE(0n, 237);
  // sqrt_price_x64 (u128)
  d.writeBigUInt64LE(1n << 32n, 245);
  d.writeBigUInt64LE(0n, 253);
  d.writeInt32LE(-12345, 261);

  const r = decodeAccount(RAYDIUM_CLMM_PROGRAM, buf);
  assert.equal(r.type, 'pool');
  assert.equal(r.dex, 'raydium-clmm');
  assert.equal(r.decoded.token_x_mint.toBase58(), m0.toBase58());
  assert.equal(r.decoded.reserve_x.toBase58(), v0.toBase58());
  assert.equal(r.decoded.tick_spacing, 60);
  assert.equal(r.decoded.tick_current, -12345);
  assert.equal(r.decoded.liquidity, 1_000_000_000n);
  assert.ok(r.decoded.sqrt_price_x64 > 0n);
});

// ─── parseSwapInstruction ──────────────────────────────────────────────────

test('parseSwapInstruction returns null when pool not tracked', () => {
  const ix = {
    programIdIndex: 0,
    accountKeyIndexes: [1, 2, 3],
    data: Buffer.concat([Buffer.from(DISC_PUMP_AMM_BUY, 'hex'), Buffer.alloc(17)]),
  };
  const keys = [PUMP_AMM_PROGRAM, 'someUnrelatedPool', 'b', 'c'];
  const r = parseSwapInstruction(ix, keys, new Set(['otherPool']));
  assert.equal(r, null);
});

test('parseSwapInstruction parses Pump AMM SELL', () => {
  const poolAddr = PublicKey.unique().toBase58();
  const ix = {
    programIdIndex: 0,
    accountKeyIndexes: [1],
    data: (() => {
      const b = Buffer.alloc(24);
      Buffer.from(DISC_PUMP_AMM_SELL, 'hex').copy(b, 0);
      b.writeBigUInt64LE(500_000n, 8);   // base_amount_in
      b.writeBigUInt64LE(0n, 16);
      return b;
    })(),
  };
  const keys = [PUMP_AMM_PROGRAM, poolAddr];
  const r = parseSwapInstruction(ix, keys, new Set([poolAddr]));
  assert.equal(r.dex, 'pump-amm');
  assert.equal(r.poolAddr, poolAddr);
  assert.equal(r.direction, 'XtoY');  // sell = base→quote
  assert.equal(r.inputAmount, 500_000n);
});

test('parseSwapInstruction parses Pump AMM BUY', () => {
  const poolAddr = PublicKey.unique().toBase58();
  const ix = {
    programIdIndex: 0,
    accountKeyIndexes: [1],
    data: (() => {
      const b = Buffer.alloc(25);
      Buffer.from(DISC_PUMP_AMM_BUY, 'hex').copy(b, 0);
      b.writeBigUInt64LE(0n, 8);              // base_amount_out
      b.writeBigUInt64LE(2_000_000n, 16);     // max_quote_amount_in
      b.writeUInt8(1, 24);                    // track_volume
      return b;
    })(),
  };
  const keys = [PUMP_AMM_PROGRAM, poolAddr];
  const r = parseSwapInstruction(ix, keys, new Set([poolAddr]));
  assert.equal(r.direction, 'YtoX');  // buy = quote→base
  assert.equal(r.inputAmount, 2_000_000n);
});

test('parseSwapInstruction parses Raydium AMM v4 V2 SwapBaseIn', () => {
  const poolAddr = PublicKey.unique().toBase58();
  const ix = {
    programIdIndex: 0,
    accountKeyIndexes: [99, 1, 2, 3, 4, 5, 6, 7],  // pool @ idx 1
    data: (() => {
      const b = Buffer.alloc(17);
      b.writeUInt8(RAYDIUM_AMM_V4_DISC_SWAP_BASE_IN_V2, 0);
      b.writeBigUInt64LE(1_000_000n, 1);
      b.writeBigUInt64LE(0n, 9);
      return b;
    })(),
  };
  const keys = [
    RAYDIUM_AMM_V4_PROGRAM, poolAddr, 'auth', 'coin_v', 'pc_v', 'src', 'dst', 'user',
  ];
  // dummy index 99 maps to 'tok'
  keys[99] = 'tok';
  const r = parseSwapInstruction(ix, keys, new Set([poolAddr]));
  assert.equal(r.dex, 'raydium-amm-v4');
  assert.equal(r.poolAddr, poolAddr);
  assert.equal(r.ammV4Variant, 'v2');
  assert.equal(r.isBaseIn, true);
  assert.equal(r.inputAmount, 1_000_000n);
});

// ─── deriveDlmmDirection ───────────────────────────────────────────────────

test('deriveDlmmDirection returns unknown for short ix', () => {
  assert.equal(deriveDlmmDirection([1, 2, 3], ['a', 'b', 'c']), 'unknown');
  assert.equal(deriveDlmmDirection(null, []), 'unknown');
});

// ─── parseSwapsFromTx ──────────────────────────────────────────────────────

test('parseSwapsFromTx walks compiledInstructions', () => {
  const poolAddr = PublicKey.unique().toBase58();
  const buy = {
    programIdIndex: 0,
    accountKeyIndexes: [1],
    data: (() => {
      const b = Buffer.alloc(25);
      Buffer.from(DISC_PUMP_AMM_BUY, 'hex').copy(b, 0);
      b.writeBigUInt64LE(0n, 8);
      b.writeBigUInt64LE(1n, 16);
      return b;
    })(),
  };
  const vtx = { message: { compiledInstructions: [buy, buy] } };
  const keys = [PUMP_AMM_PROGRAM, poolAddr];
  const out = parseSwapsFromTx(vtx, keys, new Set([poolAddr]));
  assert.equal(out.length, 2);
});
