export const limits: Record<'tokenName'|'ticker'|'description'|'socialUrl'|'metadataUri'|'imageBytes'|'walletName'|'privateKeyInput'|'backupBytes', number>;
export function byteLength(value: string): number;
export function tokenNameError(value: unknown): string;
export function tickerError(value: unknown): string;
export function descriptionError(value: unknown): string;
export function metadataUriError(value: unknown): string;
export function socialUrlError(value: unknown, twitter?: boolean): string;
