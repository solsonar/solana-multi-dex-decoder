# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — Unreleased

Initial release.

### Added

- `decodeAccount(ownerProgram, dataBuf)` — synchronous decoder dispatching by owner program ID.
- Pool account decoders for: Meteora DLMM, Orca Whirlpool, Pump AMM, Raydium AMM v4, Raydium CPMM, Raydium CLMM.
- Token account decoders for SPL Token and Token-2022.
- TickArray decoder skeletons for Whirlpool and Raydium CLMM.
- `parseSwapInstruction` and `parseSwapsFromTx` — extract swap calls from compiled instructions.
- `deriveDlmmDirection` — ATA-based direction extraction for DLMM swaps without RPC.
- Vault-based direction extraction for Raydium CPMM and CLMM.
- Constants module exposing all program IDs, account discriminators, account sizes, and swap-instruction discriminators.
- Examples: `decode-pool`, `parse-tx`.
