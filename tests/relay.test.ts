import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Connection,Keypair,PublicKey} from '@solana/web3.js';
import {buildBundle} from '../src/lib/launchlab.ts';
// @ts-expect-error The local HTTP server is plain JavaScript.
import {validateBundle} from '../server/index.mjs';
test('relay rejects unsigned or non-launch transactions and accepts a fully signed launch fixture',async()=>{
  const dev=Keypair.generate(),mint=Keypair.generate(),tip=Keypair.generate();
  const connection={getLatestBlockhash:async()=>({blockhash:tip.publicKey.toBase58(),lastValidBlockHeight:100}),getMultipleAccountsInfo:async(addresses:PublicKey[])=>addresses.map(()=>null)} as unknown as Connection;
  const plan=await buildBundle({connection,dev:dev.publicKey,mint:mint.publicKey,name:'Test',symbol:'TEST',uri:'ipfs://bafkreitest',threshold:24_000_000_000n,buyers:[{address:dev.publicKey.toBase58(),budget:24_260_000_000n,label:'Dev'}],config:{minimum:24_000_000_000n,feeRate:10500n,migrateFee:0n,cpmmConfig:tip.publicKey,lockedPercent:100,burnPercent:0,fingerprint:''},tipAccount:tip.publicKey});
  assert.throws(()=>validateBundle(plan.transactions.map(tx=>tx.serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64'))),/fully signed/);
  for(const tx of plan.transactions)tx.sign(...tx.signatures.map(s=>s.publicKey.equals(dev.publicKey)?dev:mint));
  assert.equal(validateBundle(plan.transactions.map(tx=>tx.serialize().toString('base64'))).length,plan.transactions.length);
  assert.throws(()=>validateBundle([]),/one to five/);
});
