import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Buffer} from 'buffer';
import {readFileSync} from 'node:fs';
import {Connection,Keypair,PublicKey,SystemInstruction,SystemProgram} from '@solana/web3.js';
import {CONFIG,PLATFORM,WSOL,CPMM,PROGRAM,SOLD,VESTED,POOL_SUPPLY,vestingAddress,parseSol,formatSol,grossFunding,decodeConfig,decodePool,openingFdv,migrationFdv,quoteBuyers,buildBundle,transactionSize,inspectMigration,type Config} from '../src/lib/launchlab.ts';
const keys=Array.from({length:10},()=>Keypair.generate());
const config:Config={minimum:24_000_000_000n,feeRate:10500n,migrateFee:0n,cpmmConfig:keys[8].publicKey,lockedPercent:100,burnPercent:0,fingerprint:'fixture'};
const buyers=(n:number)=>keys.slice(0,n).map((k,i)=>({address:k.publicKey.toBase58(),budget:n===1?parseSol('24.26'):i===n-1?parseSol('24.26')-parseSol('3')*BigInt(n-1):parseSol('3'),label:`Buyer ${i}`}));
test('73 SOL launch completes through purchases with zero developer reserve and a threefold FDV curve',()=>{
  const current={...config,minimum:73_000_000_000n,feeRate:7500n};
  assert.equal(grossFunding(current.minimum,current.feeRate),73_551_637_280n);
  const [quote]=quoteBuyers([{address:keys[0].publicKey.toBase58(),budget:grossFunding(current.minimum,current.feeRate)+100n,label:'Buyer'}],current.minimum,current);
  assert.equal(quote.completes,true);assert.equal(quote.tokens,SOLD);
  assert.ok(quote.net>=current.minimum-10n);assert.ok(quote.net<=current.minimum+10n);
  assert.equal(VESTED,0n);assert.equal(SOLD+POOL_SUPPLY,1_000_000_000_000_000n);
  assert.ok(Math.abs(Number(migrationFdv(current))/Number(openingFdv(current))-3)<0.000001);
});
test('SOL input uses exact lamports, rejects precision loss and exponent notation',()=>{assert.equal(parseSol('24.254674078'),24254674078n);assert.equal(formatSol(parseSol('0.000000001')),'0.000000001');for(const value of ['-1','1e2','0.0000000001','NaN','Infinity'])assert.throws(()=>parseSol(value));});
test('24 SOL net at 1.05% requires 24.254674078 SOL gross',()=>{assert.equal(grossFunding(config.minimum,config.feeRate),24_254_674_078n);assert.throws(()=>grossFunding(1n,1_000_000n));});
test('decodes an account captured from the real mainnet program simulation',()=>{
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/launchlab-mainnet-simulation.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
  const state=decodePool(Buffer.from(fixture.poolDataBase64,'base64'),new PublicKey(fixture.mint));
  assert.equal(state.creator,fixture.creator);assert.equal(state.status,1);assert.equal(state.sold,793_100_000_000_000n);assert.equal(state.threshold,24_000_000_000n);assert.equal(state.reserve,23_999_999_998n);
});
test('ordered exact-output buyers fill the entire curve without exceeding any budget',()=>{
  for(let n=1;n<=7;n++){const quotes=quoteBuyers(buyers(n),config.minimum,config);assert.equal(quotes.reduce((sum,q)=>sum+q.tokens,0n),SOLD);assert.equal(quotes.filter(q=>q.completes).length,1);assert.ok(quotes.every(q=>q.gross<=q.budget));assert.ok(quotes.reduce((sum,q)=>sum+q.net,0n)>=config.minimum-10n);}
});
test('rejects sub-minimum targets, duplicate wallets and completion before the last buyer',()=>{
  assert.throws(()=>quoteBuyers(buyers(1),23_000_000_000n,config),/minimum/);
  assert.throws(()=>quoteBuyers([buyers(1)[0],buyers(1)[0]],config.minimum,config),/different/);
  assert.throws(()=>quoteBuyers([{...buyers(2)[0],budget:30_000_000_000n},buyers(2)[1]],config.minimum,config),/before/);
  assert.equal(quoteBuyers([{...buyers(1)[0],budget:26_000_000_000n}],25_000_000_000n,config)[0].tokens,SOLD);
});
test('a 1 SOL initial purchase leaves the 24 SOL curve open',()=>{
  const [quote]=quoteBuyers([{...buyers(1)[0],budget:parseSol('1')}],config.minimum,config);
  assert.equal(quote.gross,parseSol('1'));
  assert.equal(quote.net,parseSol('0.9895'));
  assert.ok(quote.tokens>0n && quote.tokens<SOLD);
  assert.equal(quote.completes,false);
});
test('a zero-budget developer creates the token without a buy while other wallets can still buy',async()=>{
  const connection={getLatestBlockhash:async()=>({blockhash:keys[9].publicKey.toBase58(),lastValidBlockHeight:100}),getMultipleAccountsInfo:async(addresses:PublicKey[])=>{assert.equal(addresses.length,1);return [null];}} as unknown as Connection;
  const [developer,buyer]=buyers(2);
  const plan=await buildBundle({connection,dev:keys[0].publicKey,mint:keys[7].publicKey,name:'Partial curve',symbol:'PARTIAL',uri:'ipfs://bafkreitest',threshold:config.minimum,buyers:[{...developer,budget:0n},{...buyer,budget:parseSol('1')}],config,tipAccount:keys[9].publicKey});
  assert.equal(plan.quotes[0].tokens,0n);
  assert.equal(plan.quotes[1].gross,parseSol('1'));
  assert.equal(plan.quotes[1].completes,false);
  assert.equal(plan.transactions.length,2);
  assert.equal(plan.transactions[0].instructions.filter(ix=>ix.programId.equals(PROGRAM)).length,1);
  assert.equal(plan.transactions[1].instructions.filter(ix=>ix.programId.equals(PROGRAM)).length,1);
  const initialize=plan.transactions[0].instructions.find(ix=>ix.programId.equals(PROGRAM))!;
  const curve=initialize.data.subarray(-51);
  assert.equal(curve.readBigUInt64LE(9),SOLD);
  assert.equal(curve.readBigUInt64LE(17),24_000_000_000n);
  assert.equal(curve.readBigUInt64LE(26),0n); // serialized vesting total is zero
  assert.equal(VESTED,0n);
  assert.equal(POOL_SUPPLY,366_025_403_784_439n);
  assert.equal(plan.transactions.flatMap(tx=>tx.instructions).filter(ix=>ix.programId.equals(PROGRAM)&&ix.data.subarray(0,8).equals(Buffer.from([129,178,2,13,217,172,230,218]))).length,0);
  const liveTarget={...config,minimum:73_000_000_000n};
  assert.ok(Number(migrationFdv(liveTarget))/Number(openingFdv(liveTarget))>2.99999);
  assert.ok(Number(migrationFdv(liveTarget))/Number(openingFdv(liveTarget))<3.00001);
});
test('dev + six buyers fit one <=5 transaction bundle with and without existing WSOL accounts',async()=>{
  for(const existing of [false,true]){
    const connection={getLatestBlockhash:async()=>({blockhash:keys[9].publicKey.toBase58(),lastValidBlockHeight:100}),getMultipleAccountsInfo:async(addresses:PublicKey[])=>addresses.map(()=>existing?{data:Buffer.alloc(165)}:null)} as unknown as Connection;
    const plan=await buildBundle({connection,dev:keys[0].publicKey,mint:keys[7].publicKey,name:'N'.repeat(32),symbol:'FULLTICKER',uri:'ipfs://bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',threshold:config.minimum,buyers:buyers(7),config,tipAccount:keys[9].publicKey});
    assert.ok(plan.transactions.length<=5);assert.ok(plan.transactions.every(tx=>transactionSize(tx)<=1232));
    const quoteMap=new Map(keys.map(k=>[k.publicKey.toBase58(),k]));
    for(const tx of plan.transactions){tx.sign(...tx.signatures.map(s=>quoteMap.get(s.publicKey.toBase58())!));assert.ok(tx.verifySignatures());}
    assert.equal(plan.quoteAccountsPreserved.length,existing?7:0);
    const closes=plan.transactions.flatMap(t=>t.instructions).filter(ix=>ix.programId.toBase58()==='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'&&ix.data[0]===9);
    assert.equal(closes.length,existing?0:7);
    const tips=plan.transactions.flatMap(tx=>tx.instructions)
      .filter(ix=>ix.programId.equals(SystemProgram.programId)&&SystemInstruction.decodeInstructionType(ix)==='Transfer')
      .map(ix=>SystemInstruction.decodeTransfer(ix))
      .filter(transfer=>transfer.toPubkey.equals(keys[9].publicKey));
    assert.equal(tips.length,1);
    assert.equal(tips[0].lamports,1_000_000n);
  }
});
test('long metadata keeps creation and dev buy inside packet limits in the same bundle',async()=>{
  const connection={getLatestBlockhash:async()=>({blockhash:keys[9].publicKey.toBase58(),lastValidBlockHeight:100}),getMultipleAccountsInfo:async()=>[null]} as unknown as Connection;
  const plan=await buildBundle({connection,dev:keys[0].publicKey,mint:keys[7].publicKey,name:'X',symbol:'X',uri:'https://example.com/'+ 'a'.repeat(178),threshold:config.minimum,buyers:buyers(1),config,tipAccount:keys[9].publicKey});
  assert.equal(plan.creationIncludesDevBuy,false);
  assert.ok(plan.transactions.every(tx=>transactionSize(tx)<=1232));
  assert.ok(plan.transactions.length<=5);
});
test('changed configuration restrictions fail closed',()=>{
  const c=Buffer.alloc(371),p=Buffer.alloc(946);WSOL.toBuffer().copy(c,83);c.writeBigUInt64LE(24_000_000_000n,75);c.writeBigUInt64LE(2500n,27);c.writeBigUInt64LE(800000n,51);p.writeBigUInt64LE(500000n,80);p.writeBigUInt64LE(500000n,88);p.writeBigUInt64LE(8000n,104);keys[8].publicKey.toBuffer().copy(p,688);
  assert.equal(decodeConfig(c,p).feeRate,10500n);
  keys[0].publicKey.toBuffer().copy(p,800);
  assert.throws(()=>decodeConfig(c,p),/recipient must be the developer/);
  PublicKey.default.toBuffer().copy(p,800);
  p[832]=1;assert.throws(()=>decodeConfig(c,p),/restrictions/);p[832]=0;p.writeBigUInt64LE(1n,96);assert.throws(()=>decodeConfig(c,p),/liquidity/);
});
test('migration requires both status 2 and a matching CPMM pool',async()=>{
  const mint=keys[7].publicKey,data=Buffer.alloc(429);data[20]=1;CONFIG.toBuffer().copy(data,141);PLATFORM.toBuffer().copy(data,173);mint.toBuffer().copy(data,205);WSOL.toBuffer().copy(data,237);keys[0].publicKey.toBuffer().copy(data,333);
  let destination:Buffer|null=null;
  const connection={getAccountInfo:async(pubkey:PublicKey)=>{if(pubkey.equals(PublicKey.findProgramAddressSync([Buffer.from('pool'),mint.toBuffer(),WSOL.toBuffer()],PROGRAM)[0]))return {owner:PROGRAM,data};return destination?{owner:CPMM,data:destination}:null;}} as unknown as Connection;
  data[17]=1;assert.equal((await inspectMigration(connection,mint.toBase58(),config.cpmmConfig.toBase58())).stage,'migration-pending');
  data[17]=2;await assert.rejects(inspectMigration(connection,mint.toBase58(),config.cpmmConfig.toBase58()),/not yet verified/);
  destination=Buffer.alloc(637);const [a,b]=[mint,WSOL].sort((x,y)=>Buffer.compare(x.toBuffer(),y.toBuffer()));a.toBuffer().copy(destination,168);b.toBuffer().copy(destination,200);
  assert.equal((await inspectMigration(connection,mint.toBase58(),config.cpmmConfig.toBase58())).stage,'migrated');
  data[17]=9;await assert.rejects(inspectMigration(connection,mint.toBase58(),config.cpmmConfig.toBase58()),/Unknown/);
});
