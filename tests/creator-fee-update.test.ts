import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,SystemProgram,ComputeBudgetProgram} from '@solana/web3.js';
import {makeTransaction,updateDeveloperPlatformInstruction} from '../src/lib/launchlab.ts';
// @ts-expect-error Server validator is plain JavaScript.
import {validateCreatorFeeUpdate} from '../server/creator-fees.mjs';

const dev=Keypair.generate(),hash=Keypair.generate().publicKey.toBase58();
const create=()=>makeTransaction(dev.publicKey,hash,[updateDeveloperPlatformInstruction(dev.publicKey)]);
const signed=(tx:ReturnType<typeof create>)=>{tx.sign(dev);return tx.serialize().toString('base64');};

test('fee-update endpoint accepts only the signed fixed creator configuration',()=>{
  const tx=create();
  assert.throws(()=>validateCreatorFeeUpdate(tx.serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64')),/developer must sign/);
  assert.equal(validateCreatorFeeUpdate(signed(tx)).feePayer.toBase58(),dev.publicKey.toBase58());
  const transfer=create().add(SystemProgram.transfer({fromPubkey:dev.publicKey,toPubkey:Keypair.generate().publicKey,lamports:1}));
  assert.throws(()=>validateCreatorFeeUpdate(signed(transfer)),/Unexpected instructions/);
  const changed=create();changed.instructions[2].data[changed.instructions[2].data.length-41]^=1;
  assert.throws(()=>validateCreatorFeeUpdate(signed(changed)),/fixed creator-fee/);
  const redirected=create();redirected.instructions[2].keys[2].pubkey=Keypair.generate().publicKey;
  assert.throws(()=>validateCreatorFeeUpdate(signed(redirected)),/fixed creator-fee/);
  const costly=create();costly.instructions[1]=ComputeBudgetProgram.setComputeUnitPrice({microLamports:100000000});
  assert.throws(()=>validateCreatorFeeUpdate(signed(costly)),/Unexpected network fee/);
});
