import {test} from 'node:test';
import assert from 'node:assert/strict';
import {seal,unseal,walletFromSecret} from '../src/lib/vault.ts';
test('vault backup is encrypted, authenticated and restores the exact wallet',async()=>{
  const wallet=walletFromSecret('Dev'),encrypted=await seal([wallet],'test-password-2948');
  assert.ok(!JSON.stringify(encrypted).includes(wallet.secret));assert.ok(!JSON.stringify(encrypted).includes(wallet.address));
  assert.deepEqual(await unseal(encrypted,'test-password-2948'),[wallet]);
  await assert.rejects(unseal(encrypted,'wrong-password'),/Could not unlock/);
  await assert.rejects(unseal({...encrypted,data:encrypted.data.slice(0,-8)+'AAAAAAAA'},'test-password-2948'),/Could not unlock/);
});
test('private key imports reject addresses, accept validated 64-byte keypairs',()=>{
  const wallet=walletFromSecret('Original');assert.equal(walletFromSecret('Imported',wallet.secret).address,wallet.address);
  assert.throws(()=>walletFromSecret('Address',wallet.address),/complete Solana private key/);
  assert.throws(()=>walletFromSecret('Bad JSON','[999,-1]'),/valid/);
});
