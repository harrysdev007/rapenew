export const limits = {
  tokenName: 32,
  ticker: 10,
  description: 2000,
  socialUrl: 300,
  metadataUri: 200,
  imageBytes: 3 * 1024 * 1024,
  walletName: 40,
  privateKeyInput: 1024,
  backupBytes: 150000,
};

export const byteLength = value => new TextEncoder().encode(value).length;
export function tokenNameError(value) {
  if (typeof value !== 'string' || !value.trim()) return 'Enter a token name.';
  return byteLength(value.trim()) > limits.tokenName ? 'Name is too long. Shorten it.' : '';
}
export const tickerError = value => typeof value !== 'string' || !/^[A-Z0-9]{1,10}$/.test(value)
  ? 'Use 1–10 letters (A–Z) or numbers.' : '';
export const descriptionError = value => typeof value !== 'string' || value.length > limits.description
  ? 'Max 2,000 characters.' : '';
export const metadataUriError = value => typeof value !== 'string' || byteLength(value.trim()) > limits.metadataUri || !/^(https:\/\/|ipfs:\/\/|ar:\/\/)\S+$/i.test(value.trim())
  ? 'Invalid or oversized metadata link.' : '';

export function socialUrlError(value, twitter = false) {
  if (value === undefined || value === '') return '';
  const rule = twitter ? 'Enter a valid X / Twitter link.' : 'Enter a valid https:// URL.';
  if (typeof value !== 'string') return rule;
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length > limits.socialUrl) return 'Max 300 characters.';
  try {
    if (!/^https:\/\/\S+$/i.test(trimmed)) return rule;
    const url = new URL(trimmed);
    if (url.username || url.password) return rule;
    if (twitter && (!['x.com','www.x.com','twitter.com','www.twitter.com'].includes(url.hostname) || url.port || url.pathname.length < 2)) return rule;
    return '';
  } catch {
    return rule;
  }
}
