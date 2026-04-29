// Fetch a transaction by signature and extract every supported DEX swap.
// Account keys are resolved by combining static keys with the loaded ALT addresses
// returned by `connection.getTransaction(...)`.
//
//   SOLANA_RPC=https://your-rpc.com node examples/parse-tx.js <signature>
//
// Pool tracking: this example tracks a small built-in set of well-known SOL/USDC
// pools. To run with a different set, edit `TRACKED_POOLS` below.

import { Connection } from '@solana/web3.js';
import { parseSwapsFromTx } from '../src/index.js';

const rpc = process.env.SOLANA_RPC ?? 'https://api.mainnet-beta.solana.com';
const sig = process.argv[2];
if (!sig) {
  console.error('Usage: SOLANA_RPC=... node examples/parse-tx.js <signature>');
  process.exit(1);
}

const TRACKED_POOLS = new Set([
  'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE',  // Whirlpool SOL/USDC
  'BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y',   // Meteora DLMM SOL/USDC
  '58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2',  // Raydium AMM v4 SOL/USDC
  '2i1CtveDHPVVyrdyZT26vSAVD17H6Ctqs9EQ9xoYXFMR',  // Raydium CPMM IMOUT/SOL
  '2AXXcN6oN9bBT5owwmTH53C7QHUXvhLeu718Kqt8rvY2',  // Raydium CLMM RAY/SOL
  'B5K3qfft5ALRJBskL7qJPDzbbW76TXLkfKSd1mP4MtgN',  // Pump AMM SCAM/SOL
]);

const conn = new Connection(rpc, 'confirmed');
const tx = await conn.getTransaction(sig, {
  commitment: 'confirmed',
  maxSupportedTransactionVersion: 0,
});

if (!tx) {
  console.error(`Tx ${sig} not found`);
  process.exit(1);
}

// Build resolved key list: [static..., loaded.writable..., loaded.readonly...].
const msg = tx.transaction.message;
const resolvedKeys = msg.staticAccountKeys.map((k) => k.toBase58());
for (const k of tx.meta?.loadedAddresses?.writable ?? []) {
  resolvedKeys.push(k.toBase58());
}
for (const k of tx.meta?.loadedAddresses?.readonly ?? []) {
  resolvedKeys.push(k.toBase58());
}

const swaps = parseSwapsFromTx(tx.transaction, resolvedKeys, TRACKED_POOLS);
console.log(`tx ${sig.slice(0, 16)} → ${swaps.length} matching swap(s)`);
for (const s of swaps) {
  console.log(
    `  ${s.dex.padEnd(16)} pool=${s.poolAddr.slice(0, 8)}.. dir=${s.direction.padEnd(7)} input=${s.inputAmount}`,
  );
}
