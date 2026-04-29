# @solsonar/solana-multi-dex-decoder

Synchronous, zero-RPC decoder for Solana DEX pool accounts and swap instructions across six major DEXes: **Meteora DLMM**, **Orca Whirlpool**, **Pump AMM**, **Raydium AMM v4**, **Raydium CPMM**, and **Raydium CLMM**.

```js
import { decodeAccount, parseSwapsFromTx } from '@solsonar/solana-multi-dex-decoder';

// Decode any DEX pool account by its owner program
const result = decodeAccount(accountInfo.owner, accountInfo.data);
// → { type: 'pool', dex: 'raydium-amm-v4', decoded: { token_x_mint, token_y_mint, reserve_x, ... } }
// → { type: 'pool', dex: 'meteora-dlmm',   decoded: { active_id, bin_step, ... } }
// → { type: 'tokenAccount', decoded: { mint, owner, amount } }
// → null if owner is not a supported program

// Walk a VersionedTransaction and pull every supported swap
const swaps = parseSwapsFromTx(vtx, resolvedKeys, trackedPools);
// → [{ poolAddr, dex, inputAmount, direction, via }, ...]
```

## What this package does

Two pieces, both **synchronous, zero-RPC, no SDK runtime calls**:

1. **`decodeAccount(ownerProgram, dataBuf)`** — given any account's owner program ID and raw data buffer, returns a normalized decoded shape. Supports:
   - Meteora DLMM (`LbPair`, `BinArray`)
   - Orca Whirlpool (`Whirlpool`, `TickArray`)
   - Pump AMM (`Pool`)
   - Raydium AMM v4 (legacy CP, optional OpenBook)
   - Raydium CPMM (`PoolState`)
   - Raydium CLMM (`PoolState`, `TickArrayState`)
   - SPL Token + Token-2022 token accounts

2. **`parseSwapsFromTx(vtx, resolvedKeys, trackedPools)`** — walks a `VersionedTransaction.message.compiledInstructions`, identifies swap calls into any of the supported DEXes, and returns one row per swap with `{ poolAddr, dex, inputAmount, direction }`.

The decoded output uses **uniform snake_case field names with X/Y aliases** so consumer code doesn't need to special-case each DEX:

```js
// All pool decoders expose these (where applicable):
decoded.token_x_mint   // alias for base / token_0 / coin
decoded.token_y_mint   // alias for quote / token_1 / pc
decoded.reserve_x      // alias for the X-side vault address
decoded.reserve_y      // alias for the Y-side vault address
decoded.base_mint      // alias for token_x_mint
decoded.quote_mint     // alias for token_y_mint
```

## What this package does not do

- It does not **fetch** account data — you bring the bytes (from RPC, Yellowstone, shred parser, etc.).
- It does not **resolve Address Lookup Tables**. Pair with [`@solsonar/solana-alt-cache`](https://www.npmjs.com/package/@solsonar/solana-alt-cache).
- It does not **subscribe** to anything. Pair with [`@solsonar/yellowstone-grpc-client`](https://www.npmjs.com/package/@solsonar/yellowstone-grpc-client) for live updates.
- It does not **compute swap quotes** (no `expected_out_amount` calculation). Quote engines per DEX are deferred to a separate package.
- It does not **parse Jupiter aggregator routes**. Direct DEX swaps only.
- The Raydium CLMM `TickArrayState` decoder exposes `_raw` payload only — full 60-tick parsing is left to a downstream multi-tick quote engine.

## Install

```sh
npm install @solsonar/solana-multi-dex-decoder @solana/web3.js
# Optional: only if you need DLMM / Whirlpool decoding
npm install @meteora-ag/dlmm @orca-so/whirlpools-sdk @coral-xyz/anchor
```

`@meteora-ag/dlmm` and `@orca-so/whirlpools-sdk` are **optional peer deps** — they are loaded lazily and only when the decoder encounters a DLMM or Whirlpool account. Pump AMM and all three Raydium variants decode entirely from raw bytes without any SDK.

Requires Node 18+.

## How direction extraction works

Three different strategies depending on what the swap instruction itself encodes:

| DEX | Direction source | RPC needed |
|-----|------------------|------------|
| Orca Whirlpool | `a_to_b` byte in instruction data | no |
| Meteora DLMM | derive ATA(user, mint, tokenProgram) and match outer accounts | no |
| Pump AMM | discriminator: `buy` vs `sell` | no |
| Raydium CPMM / CLMM | match input vault account against pool's known `reserve_x` / `reserve_y` | requires pool lookup |
| Raydium AMM v4 | not derivable from outer ix alone (left as `'unknown'`) | — |

For the Raydium DEXes that need a pool lookup, pass an optional `poolLookup` object as the fourth argument to `parseSwapsFromTx` / `parseSwapInstruction`:

```js
const poolLookup = {
  get(poolAddr) {
    // Return your cached pool entry shape: { decoded: { reserve_x, reserve_y } }
    return myPoolCache.get(poolAddr);
  }
};
const swaps = parseSwapsFromTx(vtx, resolvedKeys, trackedPools, poolLookup);
```

## API

### `decodeAccount(ownerProgram, dataBuf)`

Returns `{ type, dex?, decoded?, error? }` or `null` if the program is not recognized.

`type` is one of: `'pool'`, `'binArray'`, `'tickArray'`, `'tokenAccount'`, `'unknown'`.

### `parseSwapInstruction(ix, resolvedKeys, trackedPools, poolLookup?)`

Returns `ParsedSwap` or `null`. See the `ParsedSwap` typedef in [SwapParser.js](./src/SwapParser.js).

### `parseSwapsFromTx(vtx, resolvedKeys, trackedPools, poolLookup?)`

Walks `vtx.message.compiledInstructions` and returns an array of `ParsedSwap`s.

### `deriveDlmmDirection(accountIdxs, resolvedKeys)`

Standalone helper: given a DLMM swap's account list, derive `'XtoY' | 'YtoX' | 'unknown'` by deterministically computing the user's expected ATAs.

### Constants

```js
import {
  METEORA_DLMM_PROGRAM,        // 'LBUZKhRx...'
  ORCA_WHIRLPOOL_PROGRAM,      // 'whirLbMii...'
  PUMP_AMM_PROGRAM,            // 'pAMMBay6...'
  RAYDIUM_AMM_V4_PROGRAM,      // '675kPX9MHT...'
  RAYDIUM_CPMM_PROGRAM,        // 'CPMMoo8L3F4N...'
  RAYDIUM_CLMM_PROGRAM,        // 'CAMMCzo5YL8w...'
  SPL_TOKEN_PROGRAM,
  SPL_TOKEN_2022_PROGRAM,
  ASSOCIATED_TOKEN_PROGRAM,
  // Account discriminators (hex)
  DISC_LB_PAIR, DISC_WHIRLPOOL, DISC_PUMP_POOL,
  DISC_RAYDIUM_POOL_STATE, DISC_RAYDIUM_TICK_ARRAY,
  // Account sizes
  SIZE_LB_PAIR, SIZE_WHIRLPOOL, SIZE_PUMP_POOL_MIN,
  SIZE_RAYDIUM_AMM_V4, SIZE_RAYDIUM_CPMM_MIN, SIZE_RAYDIUM_CLMM_MIN,
  // Swap discriminators
  DISC_DLMM_SWAP, DISC_DLMM_SWAP2,
  DISC_WHIRLPOOL_SWAP, DISC_WHIRLPOOL_SWAP_V2,
  DISC_PUMP_AMM_BUY, DISC_PUMP_AMM_SELL,
  RAYDIUM_AMM_V4_DISC_SWAP_BASE_IN_V1,
  RAYDIUM_AMM_V4_DISC_SWAP_BASE_OUT_V1,
  RAYDIUM_AMM_V4_DISC_SWAP_BASE_IN_V2,
  RAYDIUM_AMM_V4_DISC_SWAP_BASE_OUT_V2,
} from '@solsonar/solana-multi-dex-decoder';
```

## Examples

See [`examples/`](./examples):

- `decode-pool.js` — fetch a pool account by address, decode it.
- `parse-tx.js` — fetch a transaction by signature, walk its instructions, print every swap.

## Pairs well with

- [`@solsonar/solana-shred-parser`](https://www.npmjs.com/package/@solsonar/solana-shred-parser) — emit `VersionedTransaction`s from raw shreds.
- [`@solsonar/solana-alt-cache`](https://www.npmjs.com/package/@solsonar/solana-alt-cache) — synchronous Address Lookup Table resolution.
- [`@solsonar/yellowstone-grpc-client`](https://www.npmjs.com/package/@solsonar/yellowstone-grpc-client) — live account/tx feed.

Together they form a complete pipeline: shreds → reconstructed `VersionedTransaction` → ALT-resolved keys → decoded swaps & pool state.

## License

MIT
