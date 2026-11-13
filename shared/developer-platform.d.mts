import type {PublicKey,TransactionInstruction} from '@solana/web3.js';
export const PROGRAM:PublicKey;
export const DEV_CPMM_CONFIG:PublicKey;
export const DEV_FEE_RATE:bigint;
export function developerPlatform(developer:PublicKey):PublicKey;
export function updateDeveloperPlatformInstruction(developer:PublicKey):TransactionInstruction;
