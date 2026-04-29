// SPDX-License-Identifier: MIT

// ─── Program IDs ────────────────────────────────────────────────────────────

export const METEORA_DLMM_PROGRAM     = 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo';
export const ORCA_WHIRLPOOL_PROGRAM   = 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc';
export const PUMP_AMM_PROGRAM         = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
export const RAYDIUM_AMM_V4_PROGRAM   = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
export const RAYDIUM_CPMM_PROGRAM     = 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C';
export const RAYDIUM_CLMM_PROGRAM     = 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK';
export const SPL_TOKEN_PROGRAM        = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const SPL_TOKEN_2022_PROGRAM   = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const ASSOCIATED_TOKEN_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

// ─── Account discriminators (8 bytes hex) ───────────────────────────────────

/** Meteora DLMM `LbPair` Anchor discriminator. */
export const DISC_LB_PAIR        = '210b3162b565b10d';
/** Orca Whirlpool `Whirlpool` Anchor discriminator. */
export const DISC_WHIRLPOOL      = '3f95d10ce1806309';
/** Pump AMM `Pool` Anchor-style discriminator. */
export const DISC_PUMP_POOL      = 'f19a6d0411b16dbc';
/**
 * Raydium `PoolState` discriminator — same hex for both CPMM and CLMM since
 * Anchor derives it from `sha256("account:PoolState")[:8]`. Disambiguate by
 * the **owner program ID**.
 */
export const DISC_RAYDIUM_POOL_STATE = 'f7ede3f5d7c3de46';
/** Raydium CLMM `TickArrayState` discriminator. */
export const DISC_RAYDIUM_TICK_ARRAY = 'c09b55cd31f9812a';

// ─── Account sizes ──────────────────────────────────────────────────────────

export const SIZE_LB_PAIR              = 904;
export const SIZE_WHIRLPOOL            = 653;
export const SIZE_PUMP_POOL_MIN        = 243;   // 243 data; pool may be padded to 300
export const SIZE_RAYDIUM_AMM_V4       = 752;
export const SIZE_RAYDIUM_CPMM_MIN     = 320;
export const SIZE_RAYDIUM_CLMM_MIN     = 1500;
export const SIZE_SPL_TOKEN_ACCOUNT    = 165;

// ─── Direct DEX swap instruction discriminators ─────────────────────────────

/** Meteora DLMM `swap` (8-byte Anchor disc, hex). */
export const DISC_DLMM_SWAP            = 'f8c69e91e17587c8';
/** Meteora DLMM `swap2` (8-byte Anchor disc, hex). */
export const DISC_DLMM_SWAP2           = '414b3f4ceb5b5b88';

/** Orca Whirlpool `swap` (8-byte Anchor disc, hex). */
export const DISC_WHIRLPOOL_SWAP       = 'f8c69e91e17587c8';
/** Orca Whirlpool `swap_v2` (8-byte Anchor disc, hex). */
export const DISC_WHIRLPOOL_SWAP_V2    = '2b04ed0b1ac91e62';

/** Pump AMM buy (8-byte Anchor-style disc, hex). */
export const DISC_PUMP_AMM_BUY         = '66063d1201daebea';
/** Pump AMM sell (8-byte Anchor-style disc, hex). */
export const DISC_PUMP_AMM_SELL        = '33e685a4017f83ad';

/**
 * Raydium AMM v4 — single-byte u8 discriminator (NOT 8-byte Anchor).
 *   9  = SwapBaseIn  (V1, with OpenBook orderbook integration)
 *   11 = SwapBaseOut (V1)
 *   16 = SwapBaseInV2  (V2, orderbook-disabled, modern)
 *   17 = SwapBaseOutV2 (V2)
 */
export const RAYDIUM_AMM_V4_DISC_SWAP_BASE_IN_V1   = 9;
export const RAYDIUM_AMM_V4_DISC_SWAP_BASE_OUT_V1  = 11;
export const RAYDIUM_AMM_V4_DISC_SWAP_BASE_IN_V2   = 16;
export const RAYDIUM_AMM_V4_DISC_SWAP_BASE_OUT_V2  = 17;
