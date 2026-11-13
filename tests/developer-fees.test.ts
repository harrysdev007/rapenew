import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Buffer} from 'buffer';
import {Connection,Keypair,PublicKey} from '@solana/web3.js';
import {DEV_CPMM_CONFIG,LEGACY_DEV_CPMM_CONFIG,DEV_FEE_RATE,PROGRAM,CPMM,CONFIG,WSOL,poolAddress,inspectMigration,developerPlatform,developerPlatformData,verifyDeveloperPlatform,needsDeveloperFeeUpdate,verifyDestinationFees,buildBundle,transactionSize,quoteBuyers,grossFunding,type Config} from '../src/lib/launchlab.ts';

const dev=Keypair.generate(),mint=Keypair.generate(),tip=Keypair.generate();
const config:Config={minimum:24000000000n,feeRate:7500n,migrateFee:0n,cpmmConfig:DEV_CPMM_CONFIG,lockedPercent:10,burnPercent:90,fingerprint:'fees',platform:developerPlatform(dev.publicKey),developer:dev.publicKey,createsPlatform:true,postMigrationFeeRate:12500n};
const connection={getLatestBlockhash:async()=>({blockhash:tip.publicKey.toBase58(),lastValidBlockHeight:100}),getMultipleAccountsInfo:async(keys:PublicKey[])=>keys.map(()=>null)} as unknown as Connection;

test('developer config fixes fee recipients and rejects a changed fee, pool tier or vesting share',()=>{
  const original=developerPlatformData(dev.publicKey);
  verifyDeveloperPlatform(original,dev.publicKey);
  assert.equal(original.readBigUInt64LE(104),0n);
  assert.equal(original.readBigUInt64LE(720),DEV_FEE_RATE);
  for(const offset of [16,48,80,88,96,104,688,720,760,792,800,832,833]){
    const changed=Buffer.from(original);changed[offset]^=1;
    assert.throws(()=>verifyDeveloperPlatform(changed,dev.publicKey));
  }
});

test('CPMM 0.5% creator fee nets 0.475% and checks per-developer protocol-share overrides',()=>{
  const cp=Buffer.alloc(236);cp.writeBigUInt64LE(7500n,12);cp.writeBigUInt64LE(5000n,108);cp.writeBigUInt64LE(50000n,116);
  assert.equal(verifyDestinationFees(cp,null,dev.publicKey),12500n);
  const share=Buffer.alloc(145);dev.publicKey.toBuffer().copy(share,9);DEV_CPMM_CONFIG.toBuffer().copy(share,41);share.writeBigUInt64LE(50000n,73);
  assert.equal(verifyDestinationFees(cp,share,dev.publicKey),12500n);
  share.writeBigUInt64LE(100000n,73);assert.throws(()=>verifyDestinationFees(cp,share,dev.publicKey),/deduction changed/);
  cp.writeBigUInt64LE(500n,108);assert.throws(()=>verifyDestinationFees(cp,null,dev.publicKey),/no longer 0.5%/);
  cp.writeBigUInt64LE(5000n,108);cp[9]=1;assert.throws(()=>verifyDestinationFees(cp,null,dev.publicKey));
});

test('new and reused developer platforms keep dev plus six buyers in one signed bundle',async()=>{
  for(const stage of ['new','existing'])for(const existingWsol of [true,false]){
    const createsPlatform=stage==='new';
    const extra=Array.from({length:6},()=>Keypair.generate());
    const roster=[dev,...extra],buyers=roster.map((k,i)=>({address:k.publicKey.toBase58(),label:`Buyer ${i}`,budget:i===0?1000000000n:100000000n}));
    const current={...config,createsPlatform,updatesPlatform:false};
    const rpc={...connection,getMultipleAccountsInfo:async(keys:PublicKey[])=>keys.map(()=>existingWsol?{data:Buffer.alloc(165)}:null)} as unknown as Connection;
    const plan=await buildBundle({connection:rpc,dev:dev.publicKey,mint:mint.publicKey,name:'N'.repeat(32),symbol:'FULLTICKER',uri:'ipfs://bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',threshold:config.minimum,buyers,config:current,tipAccount:tip.publicKey});
    assert.ok(plan.transactions.length<=5);assert.ok(plan.transactions.every(tx=>transactionSize(tx)<=1232));
    const instructions=plan.transactions.flatMap(tx=>tx.instructions).filter(ix=>ix.programId.equals(PROGRAM));
    const setup=instructions.filter(ix=>ix.data.subarray(0,8).equals(Buffer.from([176,90,196,175,253,113,220,20])));
    assert.equal(setup.length,createsPlatform?1:0);
    const upgrades=instructions.filter(ix=>ix.data.subarray(0,8).equals(Buffer.from([195,60,76,129,146,45,67,143])));
    assert.equal(upgrades.length,0);
    const create=instructions.find(ix=>ix.data.subarray(0,8).equals(Buffer.from([67,153,175,39,218,16,38,32])))!;
    assert.equal(create.keys[3].pubkey.toBase58(),config.platform!.toBase58());
    for(const buy of instructions.filter(ix=>ix.data[0]===24))assert.equal(buy.keys[3].pubkey.toBase58(),config.platform!.toBase58());
    for(const tx of plan.transactions){tx.sign(...tx.signatures.map(s=>[...roster,mint].find(k=>k.publicKey.equals(s.publicKey))!));assert.ok(tx.verifySignatures());}
  }
});

test('only the known developer-owned legacy profile can be upgraded automatically',()=>{
  const native=developerPlatformData(dev.publicKey);
  assert.equal(needsDeveloperFeeUpdate(native,dev.publicKey),false);
  const legacy=Buffer.from(native);legacy.writeBigUInt64LE(9500n,104);legacy.writeBigUInt64LE(0n,720);LEGACY_DEV_CPMM_CONFIG.toBuffer().copy(legacy,688);
  assert.equal(needsDeveloperFeeUpdate(legacy,dev.publicKey),true);
  const changed=Buffer.from(legacy);changed[16]^=1;assert.throws(()=>needsDeveloperFeeUpdate(changed,dev.publicKey),/recipient/);
  const custom=Buffer.from(legacy);custom[112]^=1;assert.throws(()=>needsDeveloperFeeUpdate(custom,dev.publicKey),/Custom developer settings/);
  legacy.writeBigUInt64LE(9000n,104);assert.throws(()=>needsDeveloperFeeUpdate(legacy,dev.publicKey));
});

test('migration finds the updated CPMM tier while retaining already-migrated legacy pools',async()=>{
  const state=Buffer.alloc(429),platform=config.platform!,settings=developerPlatformData(dev.publicKey);
  state[17]=2;state[20]=1;CONFIG.toBuffer().copy(state,141);platform.toBuffer().copy(state,173);mint.publicKey.toBuffer().copy(state,205);WSOL.toBuffer().copy(state,237);dev.publicKey.toBuffer().copy(state,333);
  const [a,b]=[mint.publicKey,WSOL].sort((x,y)=>Buffer.compare(x.toBuffer(),y.toBuffer()));
  const oldPool=PublicKey.findProgramAddressSync([Buffer.from('pool'),LEGACY_DEV_CPMM_CONFIG.toBuffer(),a.toBuffer(),b.toBuffer()],CPMM)[0];
  const newPool=PublicKey.findProgramAddressSync([Buffer.from('pool'),DEV_CPMM_CONFIG.toBuffer(),a.toBuffer(),b.toBuffer()],CPMM)[0];
  const migrated=Buffer.alloc(637);a.toBuffer().copy(migrated,168);b.toBuffer().copy(migrated,200);
  let legacyExists=false;
  const rpc={getAccountInfo:async(key:PublicKey)=>key.equals(poolAddress(mint.publicKey))?{owner:PROGRAM,data:state}:key.equals(platform)?{owner:PROGRAM,data:settings}:key.equals(newPool)||(legacyExists&&key.equals(oldPool))?{owner:CPMM,data:migrated}:null} as unknown as Connection;
  const updated=await inspectMigration(rpc,mint.publicKey.toBase58(),LEGACY_DEV_CPMM_CONFIG.toBase58(),platform);
  assert.equal(updated.pool,newPool.toBase58());assert.equal(updated.stage,'migrated');
  legacyExists=true;
  assert.equal((await inspectMigration(rpc,mint.publicKey.toBase58(),LEGACY_DEV_CPMM_CONFIG.toBase58(),platform)).pool,oldPool.toBase58());
});

test('24 SOL target stays net of the new curve fees, and a different dev cannot reuse a review',async()=>{
  const budget=grossFunding(config.minimum,config.feeRate);
  assert.equal(budget,24181360202n);
  const [quote]=quoteBuyers([{address:dev.publicKey.toBase58(),label:'Dev',budget}],config.minimum,config);
  assert.equal(quote.completes,true);assert.ok(quote.gross<=budget);
  assert.equal(quoteBuyers([{address:dev.publicKey.toBase58(),label:'Dev',budget:1000000000n}],config.minimum,config)[0].net,992500000n);
  await assert.rejects(buildBundle({connection,dev:dev.publicKey,mint:mint.publicKey,name:'X',symbol:'X',uri:'ipfs://x',threshold:config.minimum,buyers:[{address:dev.publicKey.toBase58(),label:'Dev',budget:0n}],config:{...config,createsPlatform:false,updatesPlatform:true},tipAccount:tip.publicKey}),/Update creator fees/);
  await assert.rejects(buildBundle({connection,dev:mint.publicKey,mint:tip.publicKey,name:'X',symbol:'X',uri:'ipfs://x',threshold:config.minimum,buyers:[{address:mint.publicKey.toBase58(),label:'Dev',budget:0n}],config,tipAccount:tip.publicKey}),/selected developer/);
});
