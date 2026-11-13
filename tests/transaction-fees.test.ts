import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,SystemProgram,Transaction} from '@solana/web3.js';
import {estimateNetworkFee} from '../src/lib/transaction-fees.ts';

const owner=Keypair.generate(),hash=Keypair.generate().publicKey.toBase58(),freshHash=Keypair.generate().publicKey.toBase58();
function fixture(){return {transactions:[1,2].map(lamports=>new Transaction({feePayer:owner.publicKey,recentBlockhash:hash}).add(SystemProgram.transfer({fromPubkey:owner.publicKey,toPubkey:Keypair.generate().publicKey,lamports}))),blockhash:{blockhash:hash,lastValidBlockHeight:100}};}

test('successful fee quotes use confirmed commitment without modifying the review',async()=>{
  const plan=fixture(),messages=plan.transactions.map(tx=>tx.serializeMessage());
  const fee=await estimateNetworkFee({getFeeForMessage:async(_message,commitment)=>{assert.equal(commitment,'confirmed');return {context:{slot:1},value:11000};},getLatestBlockhash:async()=>{throw Error('Unexpected refresh');}},plan);
  assert.equal(fee,22000n);assert.equal(plan.blockhash.lastValidBlockHeight,100);
  plan.transactions.forEach((tx,i)=>assert.deepEqual(tx.serializeMessage(),messages[i]));
});

test('null fees refresh every unsigned message and expiry, then reprice the entire bundle',async()=>{
  const plan=fixture(),instructions=plan.transactions.map(tx=>tx.instructions),initial=plan.transactions.map(tx=>tx.serializeMessage());
  let calls=0,refreshes=0;
  const fee=await estimateNetworkFee({getFeeForMessage:async message=>{calls++;return {context:{slot:2},value:message.recentBlockhash===hash?null:16000};},getLatestBlockhash:async commitment=>{assert.equal(commitment,'finalized');refreshes++;return {blockhash:freshHash,lastValidBlockHeight:200};}},plan);
  assert.equal(calls,4);assert.equal(refreshes,1);assert.equal(fee,32000n);assert.deepEqual(plan.blockhash,{blockhash:freshHash,lastValidBlockHeight:200});
  plan.transactions.forEach((tx,i)=>{assert.equal(tx.recentBlockhash,freshHash);assert.deepEqual(tx.instructions,instructions[i]);assert.notDeepEqual(tx.serializeMessage(),initial[i]);assert.ok(tx.signatures.every(s=>s.signature===null));});
});

test('persistent nulls fail closed instead of inventing a fee or returning zero',async()=>{
  let quotes=0,refreshes=0;
  await assert.rejects(estimateNetworkFee({getFeeForMessage:async()=>{quotes++;return {context:{slot:1},value:null};},getLatestBlockhash:async()=>{refreshes++;return {blockhash:freshHash,lastValidBlockHeight:200};}},fixture()),/after retrying.*Nothing was signed or sent/);
  assert.equal(quotes,6);assert.equal(refreshes,2);
});

test('an RPC error recovers through a fresh blockhash, but signed messages are never changed',async()=>{
  let calls=0;
  const fee=await estimateNetworkFee({getFeeForMessage:async()=>{if(++calls===1)throw Error('Temporary RPC error');return {context:{slot:1},value:11000};},getLatestBlockhash:async()=>({blockhash:freshHash,lastValidBlockHeight:200})},fixture());
  assert.equal(fee,22000n);
  const signed=fixture();signed.transactions[0].sign(owner);
  const message=signed.transactions[0].serializeMessage(),signature=signed.transactions[0].signature;
  await assert.rejects(estimateNetworkFee({getFeeForMessage:async()=>({context:{slot:1},value:null}),getLatestBlockhash:async()=>{throw Error('Must not refresh');}},signed),/signed review cannot be refreshed/);
  assert.deepEqual(signed.transactions[0].serializeMessage(),message);assert.deepEqual(signed.transactions[0].signature,signature);
});
