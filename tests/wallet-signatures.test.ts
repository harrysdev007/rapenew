import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Keypair, SystemProgram, Transaction} from '@solana/web3.js';
import {applyWalletSignature} from '../src/lib/wallet-signatures.ts';

function makeTransaction() {
  const developer = Keypair.generate();
  const buyer = Keypair.generate();
  const destination = Keypair.generate().publicKey;
  const transaction = new Transaction({feePayer: developer.publicKey, recentBlockhash: destination.toBase58()});
  transaction.add(SystemProgram.transfer({fromPubkey: buyer.publicKey, toPubkey: destination, lamports: 1}));
  transaction.partialSign(developer);
  return {transaction, developer, buyer};
}

test('adding a wallet signature preserves existing signatures even if the wallet drops them', async () => {
  const {transaction, developer, buyer} = makeTransaction();
  await applyWalletSignature(transaction, buyer.publicKey, async bytes => {
    const signed = Transaction.from(bytes);
    signed.signatures.find(entry => entry.publicKey.equals(developer.publicKey))!.signature = null;
    signed.partialSign(buyer);
    return signed.serialize({requireAllSignatures: false, verifySignatures: false});
  });
  assert.equal(transaction.verifySignatures(), true);
});

test('wallet cannot replace a reviewed transaction message', async () => {
  const {transaction, buyer} = makeTransaction();
  await assert.rejects(applyWalletSignature(transaction, buyer.publicKey, async bytes => {
    const signed = Transaction.from(bytes);
    signed.recentBlockhash = Keypair.generate().publicKey.toBase58();
    signed.partialSign(buyer);
    return signed.serialize({requireAllSignatures: false, verifySignatures: false});
  }), /changed the reviewed transaction/);
});
