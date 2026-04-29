// Fetch a single DEX pool account by address and decode it.
//
//   SOLANA_RPC=https://your-rpc.com node examples/decode-pool.js <pool-address>
//
// Try with a known pool from each DEX:
//   AMM v4 SOL/USDC:  58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2
//   CPMM IMOUT/SOL:   2i1CtveDHPVVyrdyZT26vSAVD17H6Ctqs9EQ9xoYXFMR
//   CLMM RAY/SOL:     2AXXcN6oN9bBT5owwmTH53C7QHUXvhLeu718Kqt8rvY2
//   Whirlpool SOL/USDC: Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE

import { Connection, PublicKey } from '@solana/web3.js';
import { decodeAccount } from '../src/index.js';

const rpc = process.env.SOLANA_RPC ?? 'https://api.mainnet-beta.solana.com';
const addr = process.argv[2];

if (!addr) {
  console.error('Usage: SOLANA_RPC=... node examples/decode-pool.js <pool-address>');
  process.exit(1);
}

const conn = new Connection(rpc, 'confirmed');
const info = await conn.getAccountInfo(new PublicKey(addr));
if (!info) {
  console.error(`Account ${addr} not found`);
  process.exit(1);
}

const result = decodeAccount(info.owner, info.data);
if (!result) {
  console.error(`Owner ${info.owner.toBase58()} is not a supported DEX program`);
  process.exit(1);
}

console.log(`type: ${result.type}`);
console.log(`dex:  ${result.dex ?? 'n/a'}`);
console.log(`size: ${info.data.length} bytes`);
console.log(`owner: ${info.owner.toBase58()}`);

if (result.error) {
  console.error('error:', result.error);
  process.exit(1);
}

if (result.decoded) {
  // Print a few useful fields if present
  const d = result.decoded;
  const fields = [
    'base_mint', 'quote_mint', 'token_x_mint', 'token_y_mint',
    'reserve_x', 'reserve_y',
    'tick_spacing', 'tick_current', 'liquidity', 'sqrt_price_x64',
    'active_id', 'bin_step',
    'mint', 'owner', 'amount',
  ];
  for (const f of fields) {
    if (d[f] === undefined) continue;
    const v = d[f];
    const repr = v?.toBase58 ? v.toBase58() : v?.toString ? v.toString() : v;
    console.log(`  ${f}: ${repr}`);
  }
}
