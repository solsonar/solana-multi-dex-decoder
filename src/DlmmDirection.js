// SPDX-License-Identifier: MIT

import { PublicKey } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM } from './constants.js';

const ASSOCIATED_TOKEN_PROGRAM_PK = new PublicKey(ASSOCIATED_TOKEN_PROGRAM);

// Account indices inside Meteora DLMM `swap`/`swap2` instructions
// (verified against @meteora-ag/dlmm SDK source).
export const DLMM_IX_LB_PAIR_IDX        = 0;
export const DLMM_IX_USER_TOKEN_IN_IDX  = 4;
export const DLMM_IX_USER_TOKEN_OUT_IDX = 5;
export const DLMM_IX_TOKEN_X_MINT_IDX   = 6;
export const DLMM_IX_TOKEN_Y_MINT_IDX   = 7;
export const DLMM_IX_USER_IDX           = 10;
export const DLMM_IX_TOKEN_X_PROGRAM_IDX = 11;
export const DLMM_IX_TOKEN_Y_PROGRAM_IDX = 12;

const MIN_DLMM_IX_ACCOUNTS = 13;

function deriveAtaBase58(ownerStr, tokenProgramStr, mintStr) {
  const owner = new PublicKey(ownerStr);
  const tokenProgram = new PublicKey(tokenProgramStr);
  const mint = new PublicKey(mintStr);
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_PK,
  );
  return ata.toBase58();
}

/**
 * Derive Meteora DLMM swap direction (`'XtoY'` or `'YtoX'`) **without an RPC
 * call**, by inspecting the swap instruction's outer account list.
 *
 * Solana DLMM swap data does not contain an explicit `swap_for_y` flag, so
 * direction must be inferred. We use the fact that:
 *
 *   - `accounts[4]` is `user_token_in` — the user's ATA for the input mint.
 *   - `accounts[6]` and `accounts[7]` are the pool's X and Y token mints.
 *   - `accounts[10]` is the user (signer / ATA owner).
 *   - `accounts[11]` and `accounts[12]` are the X and Y token programs.
 *
 * Compute `ATA(user, mint, tokenProgram)` for both X and Y mints and compare to
 * `accounts[4]`. Whichever matches identifies the input mint and therefore
 * the direction.
 *
 * Returns `'unknown'` for non-standard wallets, multisig signers, or
 * Token-2022 mints with transfer hooks where ATA derivation differs.
 *
 * @param {number[]} accountIdxs   `ix.accountKeyIndexes` from a compiled instruction.
 * @param {string[]} resolvedKeys  Full key list (static + ALT-loaded).
 * @returns {'XtoY' | 'YtoX' | 'unknown'}
 */
export function deriveDlmmDirection(accountIdxs, resolvedKeys) {
  if (!accountIdxs || accountIdxs.length < MIN_DLMM_IX_ACCOUNTS) return 'unknown';

  const userTokenIn  = resolvedKeys[accountIdxs[DLMM_IX_USER_TOKEN_IN_IDX]];
  const tokenXMint   = resolvedKeys[accountIdxs[DLMM_IX_TOKEN_X_MINT_IDX]];
  const tokenYMint   = resolvedKeys[accountIdxs[DLMM_IX_TOKEN_Y_MINT_IDX]];
  const user         = resolvedKeys[accountIdxs[DLMM_IX_USER_IDX]];
  const tokenXProg   = resolvedKeys[accountIdxs[DLMM_IX_TOKEN_X_PROGRAM_IDX]];
  const tokenYProg   = resolvedKeys[accountIdxs[DLMM_IX_TOKEN_Y_PROGRAM_IDX]];

  if (!userTokenIn || !tokenXMint || !tokenYMint || !user || !tokenXProg || !tokenYProg) {
    return 'unknown';
  }

  let ataX, ataY;
  try {
    ataX = deriveAtaBase58(user, tokenXProg, tokenXMint);
    ataY = deriveAtaBase58(user, tokenYProg, tokenYMint);
  } catch {
    return 'unknown';
  }

  if (userTokenIn === ataX) return 'XtoY';
  if (userTokenIn === ataY) return 'YtoX';
  return 'unknown';
}
