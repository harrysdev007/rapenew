import {PrivyClient} from '@privy-io/node';
import {PublicKey} from '@solana/web3.js';

export class WalletRequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createWalletArchiveService(appId, appSecret) {
  if (!appId || !appSecret) return null;
  const client = new PrivyClient({appId, appSecret, timeout: 10000, maxRetries: 0});
  return walletArchiveService(client);
}

export function walletArchiveService(client) {
  async function userId(authorization) {
    const token = typeof authorization === 'string' && /^Bearer ([^\s]+)$/.exec(authorization)?.[1];
    if (!token) throw new WalletRequestError(401, 'Sign in to Privy first.');
    try {
      const claims = await client.utils().auth().verifyAccessToken(token);
      if (!claims.user_id) throw Error('Missing Privy user ID.');
      return claims.user_id;
    } catch {
      throw new WalletRequestError(401, 'Your Privy session could not be verified. Sign in again.');
    }
  }

  async function walletsForUser(user, address) {
    const wallets = [];
    for await (const wallet of client.wallets().list({
      user_id: user,
      chain_type: 'solana',
      include_archived: true,
      ...(address ? {address} : {}),
    })) {
      if (wallet.chain_type === 'solana' && (!address || wallet.address === address)) wallets.push(wallet);
    }
    return wallets;
  }

  return {
    verifyUser: userId,
    async archivedAddresses(authorization) {
      const user = await userId(authorization);
      const wallets = await walletsForUser(user);
      const activeAddresses = new Set(wallets.filter(wallet => !wallet.archived_at).map(wallet => wallet.address));
      return [...new Set(wallets.filter(wallet => wallet.archived_at && !activeAddresses.has(wallet.address)).map(wallet => wallet.address))];
    },

    async archive(authorization, address) {
      const user = await userId(authorization);
      if (typeof address !== 'string' || address.length > 44) throw new WalletRequestError(400, 'Enter a valid Solana wallet address.');
      try {
        if (new PublicKey(address).toBase58() !== address) throw Error('Invalid address.');
      } catch {
        throw new WalletRequestError(400, 'Enter a valid Solana wallet address.');
      }

      const wallets = await walletsForUser(user, address);
      const active = wallets.filter(wallet => !wallet.archived_at);
      if (active.length === 0 && wallets.length > 0) return {address, archived: true};
      if (active.length !== 1) throw new WalletRequestError(404, 'Could not identify an active wallet in your Privy account.');
      const wallet = active[0];
      // Privy's archive endpoint expects a JSON body, even with no fields.
      const archived = await client.wallets().archive(wallet.id, {body: {}});
      if (archived.id !== wallet.id || archived.address !== address || !archived.archived_at) {
        throw new WalletRequestError(502, 'Privy did not confirm the archive. Refresh Wallets before retrying.');
      }
      return {address, archived: true};
    },
  };
}
