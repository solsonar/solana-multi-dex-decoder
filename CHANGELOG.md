# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.3] — 2026-05-04

### Fixed

- Pump AMM pool decoder now treats an all-zeros `protocol_fee_recipient`
  field (offset 243-275 on post-cashback pools) as `null` rather than
  returning a `PublicKey` containing 32 zero bytes (which equals
  `SystemProgram::id()`). Pump's swap instruction validates the recipient
  via set-membership against `PUMP_AMM_GLOBAL_CONFIG.protocol_fee_recipients`,
  and `11111111…` is never in that list, so sending it deterministically
  fails with Anchor 6013 `InvalidProtocolFeeRecipient`. Returning `null`
  lets callers fall back to a known-recipient list. Observed on TROLL/SOL
  Pump pool `4w2cysotX6czaUGmmWg13hDpY4QEMG2CzeKYEQyK9Ama` (data length 301,
  field at 243-275 was all zeros).

## [0.2.2] — 2026-05-03

### Added

- `SwapParser` exposes `victimFeeRecipient` on parsed Pump AMM swap
  instructions (account index 9). Pump rotates fee recipients per slot;
  using the value from the victim's own ix guarantees validity at the
  current slot. Consumers (e.g. backrun arb executors) override the
  pool-data default with this value when present.

## [0.2.1] — 2026-05-02

### Added

- Pump AMM pool decoder now exposes `protocol_fee_recipient` (offset 243-275)
  for pools created post-cashback upgrade. Older 243-byte pools fall back
  to `null` so callers can use a known-recipient list. Required by swap
  instruction builders that must populate the per-pool fee recipient
  account in the Pump AMM `buy` / `sell` ix.

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
