import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Keypair} from '@solana/web3.js';
// @ts-expect-error The local server is written in JavaScript.
import {walletArchiveService} from '../server/privy-wallets.mjs';

const address = Keypair.generate().publicKey.toBase58();
const otherAddress = Keypair.generate().publicKey.toBase58();
const wallet = {id: 'privy-wallet', address, chain_type: 'solana', archived_at: null as number | null};

function fixture() {
  const archived: string[] = [];
  const wallets = [{...wallet}];
  const service = walletArchiveService({
    utils: () => ({auth: () => ({verifyAccessToken: async (token: string) => {
      if (token !== 'valid-token') throw Error('Invalid access token');
      return {user_id: 'did:privy:verified-user'};
    }})}),
    wallets: () => ({
      async *list(query: {user_id: string; chain_type: string; address?: string; include_archived: boolean}) {
        assert.equal(query.user_id, 'did:privy:verified-user');
        assert.equal(query.chain_type, 'solana');
        assert.equal(query.include_archived, true);
        yield* wallets.filter(item => !query.address || item.address === query.address);
      },
      async archive(id: string, options: {body: Record<string, never>}) {
        assert.deepEqual(options, {body: {}});
        archived.push(id);
        wallets[0].archived_at = 1234;
        return wallets[0];
      },
    }),
  });
  return {service, archived};
}

test('an unverified user or a wallet outside that user cannot trigger an archive', async () => {
  const {service, archived} = fixture();
  await assert.rejects(service.archive('Bearer wrong-token', address), {status: 401});
  await assert.rejects(service.archive('Bearer valid-token', otherAddress), {status: 404});
  assert.deepEqual(archived, []);
});

test('archive uses the Privy wallet ID, reports its address and tolerates a retry', async () => {
  const {service, archived} = fixture();
  assert.deepEqual(await service.archivedAddresses('Bearer valid-token'), []);
  assert.deepEqual(await service.archive('Bearer valid-token', address), {address, archived: true});
  assert.deepEqual(await service.archive('Bearer valid-token', address), {address, archived: true});
  assert.deepEqual(await service.archivedAddresses('Bearer valid-token'), [address]);
  assert.deepEqual(archived, [wallet.id]);
});
