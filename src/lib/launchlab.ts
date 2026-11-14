import {Buffer} from 'buffer';
import {metadataUriError, tickerError, tokenNameError} from '../../shared/form-rules.mjs';
import {PROGRAM,DEV_CPMM_CONFIG,DEV_FEE_RATE,developerPlatform} from '../../shared/developer-platform.mjs';
export {PROGRAM,DEV_CPMM_CONFIG,DEV_FEE_RATE,developerPlatform,updateDeveloperPlatformInstruction} from '../../shared/developer-platform.mjs';
import {Connection,PublicKey,Transaction,TransactionInstruction,SystemProgram,SYSVAR_RENT_PUBKEY,ComputeBudgetProgram,type BlockhashWithExpiryBlockHeight} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,createAssociatedTokenAccountIdempotentInstruction,createSyncNativeInstruction,createCloseAccountInstruction,getAssociatedTokenAddressSync} from '@solana/spl-token';

export const CONFIG=new PublicKey('6s1xP3hpbAfFoNtUNF8mfHsjr2Bd97JxFJRWLbL6aHuX');
export const PLATFORM=new PublicKey('4Bu96XjU84XjPDSpveTVf6LYGCkfW5FK7SNkREWcEfV4');
export const WSOL=new PublicKey('So11111111111111111111111111111111111111112');
export const CPMM=new PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C');
export const LEGACY_DEV_CPMM_CONFIG=new PublicKey('CRRS5ieQmBrZjWhcj99JuGrT5tyuWDaGAXLXLFjbAtjQ');
export const CPMM_CREATOR_FEE_RATE=5000n;
export const CPMM_PROTOCOL_SHARE=50000n;
const META=new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
export const SUPPLY=1_000_000_000_000_000n;
// No developer allocation. At SOL near $75, 73 SOL prices the curve near $5K to $15K.
export const LAUNCH_TARGET=73_000_000_000n;
export const SOLD=633_974_596_215_561n;
export const VESTED=0n;
export const POOL_SUPPLY=SUPPLY-SOLD-VESTED;
export const DENOMINATOR=1_000_000n;
export const JITO_TIP=1_000_000n;
const U64_MAX=18_446_744_073_709_551_615n;
const pda=(...seeds:Buffer[])=>PublicKey.findProgramAddressSync(seeds,PROGRAM)[0];
export const creatorFeeShareAddress=(developer:PublicKey)=>PublicKey.findProgramAddressSync([Buffer.from('creator_fee_share'),developer.toBuffer(),DEV_CPMM_CONFIG.toBuffer()],CPMM)[0];
const auth=pda(Buffer.from('vault_auth_seed')),event=pda(Buffer.from('__event_authority'));
export const poolAddress=(mint:PublicKey)=>pda(Buffer.from('pool'),mint.toBuffer(),WSOL.toBuffer());
export const vestingAddress=(pool:PublicKey,beneficiary:PublicKey)=>pda(Buffer.from('pool_vesting'),pool.toBuffer(),beneficiary.toBuffer());
const vault=(pool:PublicKey,mint:PublicKey)=>pda(Buffer.from('pool_vault'),pool.toBuffer(),mint.toBuffer());
const key=(pubkey:PublicKey,isWritable=false,isSigner=false)=>({pubkey,isWritable,isSigner});
const u64=(n:bigint)=>{if(n<0n||n>U64_MAX)throw Error('Amount is outside u64.');const b=Buffer.alloc(8);b.writeBigUInt64LE(n);return b;};
const str=(s:string)=>{const b=Buffer.from(s);const n=Buffer.alloc(4);n.writeUInt32LE(b.length);return Buffer.concat([n,b]);};
export const ceilDiv=(a:bigint,b:bigint)=>{if(a<0n||b<=0n)throw Error('Invalid division.');return (a+b-1n)/b;};
export function parseSol(value:string):bigint{
  if(!/^\d+(\.\d{1,9})?$/.test(value.trim()))throw Error('Enter a SOL amount with up to 9 decimal places.');
  const [whole,fraction='']=value.trim().split('.');
  const amount=BigInt(whole)*1_000_000_000n+BigInt(fraction.padEnd(9,'0'));
  if(amount>BigInt(Number.MAX_SAFE_INTEGER)-10_000_000n)throw Error('SOL amount is too large.');
  return amount;
}
export function formatSol(n:bigint,maxDecimals=9){
  const negative=n<0n;const v=negative?-n:n;
  const fraction=(v%1_000_000_000n).toString().padStart(9,'0').slice(0,maxDecimals).replace(/0+$/,'');
  return `${negative?'-':''}${v/1_000_000_000n}${fraction?'.'+fraction:''}`;
}
export type Config={minimum:bigint;feeRate:bigint;migrateFee:bigint;cpmmConfig:PublicKey;lockedPercent:number;burnPercent:number;fingerprint:string;platform?:PublicKey;developer?:PublicKey;createsPlatform?:boolean;updatesPlatform?:boolean;postMigrationFeeRate?:bigint};
export function decodeConfig(c:Buffer,p:Buffer):Config{
  if(c.length<115||p.length<834||c[16]!==0||!new PublicKey(c.subarray(83,115)).equals(WSOL))throw Error('The SOL constant-product configuration could not be verified.');
  if(p[832]||p[833])throw Error('Raydium platform restrictions changed. Launch is disabled until reviewed.');
  if(!new PublicKey(p.subarray(800,832)).equals(PublicKey.default))throw Error('Creator-fee recipient must be the developer wallet.');
  const minimum=c.readBigUInt64LE(75),feeRate=c.readBigUInt64LE(27)+p.readBigUInt64LE(104)+p.readBigUInt64LE(720);
  const lock=p.readBigUInt64LE(80)+p.readBigUInt64LE(88),burn=p.readBigUInt64LE(96);
  if(minimum<=0n||feeRate>=DENOMINATOR||lock+burn!==DENOMINATOR)throw Error('Invalid Raydium funding or liquidity configuration.');
  if(VESTED*DENOMINATOR>SUPPLY*c.readBigUInt64LE(51)||SOLD*DENOMINATOR<SUPPLY*c.readBigUInt64LE(59)||POOL_SUPPLY*DENOMINATOR<SUPPLY*c.readBigUInt64LE(67))throw Error('Raydium allocation limits changed. This launch configuration is unavailable.');
  if(p.readBigUInt64LE(792)!==0n)throw Error('The platform now requires a vesting share. This launch configuration must be reviewed.');
  return {minimum,feeRate,migrateFee:c.readBigUInt64LE(19),cpmmConfig:new PublicKey(p.subarray(688,720)),lockedPercent:Number(lock)/10000,burnPercent:Number(burn)/10000,fingerprint:c.toString('hex')+p.toString('hex')};
}
// Developer-owned settings enable native creator fees; platform trading fees are zero.
export function developerPlatformData(developer:PublicKey){
  const data=Buffer.alloc(944);
  developer.toBuffer().copy(data,16);developer.toBuffer().copy(data,48);
  data.writeBigUInt64LE(100000n,80);data.writeBigUInt64LE(900000n,96);
  data.writeBigUInt64LE(DEV_FEE_RATE,720);Buffer.from('rapelaunch').copy(data,112);
  Buffer.from('https://x.com/rapelaunch_xyz').copy(data,176);
  DEV_CPMM_CONFIG.toBuffer().copy(data,688);developer.toBuffer().copy(data,760);
  return data;
}
export function verifyDeveloperPlatform(data:Buffer,developer:PublicKey){
  const expected=developerPlatformData(developer);
  if(data.length<944||![16,48,688,760,800].every(offset=>data.subarray(offset,offset+32).equals(expected.subarray(offset,offset+32))))throw Error('Developer fee recipient or destination pool config changed.');
  if(![80,88,96,104,720,792].every(offset=>data.readBigUInt64LE(offset)===expected.readBigUInt64LE(offset))||data[832]||data[833])throw Error('Developer settings differ from the reviewed 0.5% creator-fee configuration.');
}
export function needsDeveloperFeeUpdate(data:Buffer,developer:PublicKey){
  if(data.length<944)throw Error('Developer fee settings are unavailable.');
  const legacy=data.readBigUInt64LE(104)===9500n&&data.readBigUInt64LE(720)===0n&&new PublicKey(data.subarray(688,720)).equals(LEGACY_DEV_CPMM_CONFIG);
  if(!legacy){verifyDeveloperPlatform(data,developer);return false;}
  const patched=Buffer.from(data);
  patched.writeBigUInt64LE(0n,104);patched.writeBigUInt64LE(DEV_FEE_RATE,720);DEV_CPMM_CONFIG.toBuffer().copy(patched,688);
  verifyDeveloperPlatform(patched,developer);
  // AllInfo writes these fields too. Only upgrade the exact legacy launcher
  // profile, so custom branding or token-extension settings are not overwritten.
  const expected=developerPlatformData(developer);
  if(!data.subarray(112,688).equals(expected.subarray(112,688))||!data.subarray(728,760).equals(expected.subarray(728,760)))throw Error('Custom developer settings need a separate fee update.');
  return true;
}
export function verifyDestinationFees(cp:Buffer,share:Buffer|null,developer:PublicKey){
  if(cp.length<124||cp[9]||cp.readBigUInt64LE(108)!==CPMM_CREATOR_FEE_RATE)throw Error('The destination creator fee is no longer 0.5%.');
  let rate=cp.readBigUInt64LE(116);
  if(share){
    if(share.length<145||!share.subarray(9,41).equals(developer.toBuffer())||!share.subarray(41,73).equals(DEV_CPMM_CONFIG.toBuffer()))throw Error('The developer creator-fee share could not be verified.');
    rate=share.readBigUInt64LE(73);
  }
  if(rate!==CPMM_PROTOCOL_SHARE)throw Error('The destination protocol deduction changed. Expected 0.475% net for the developer.');
  return cp.readBigUInt64LE(12)+CPMM_CREATOR_FEE_RATE;
}
export async function readConfig(connection:Connection,developer?:PublicKey):Promise<Config>{
  const owner=developer||PublicKey.default,platform=developerPlatform(owner);
  const [c,p,wsol,cp,share]=await connection.getMultipleAccountsInfo([CONFIG,platform,WSOL,DEV_CPMM_CONFIG,creatorFeeShareAddress(owner)],'confirmed');
  if(!c||!wsol||!cp||!c.owner.equals(PROGRAM)||!cp.owner.equals(CPMM)||!wsol.owner.equals(TOKEN_PROGRAM_ID)||wsol.data[44]!==9)throw Error('Raydium mainnet configuration is unavailable.');
  if(p&&!p.owner.equals(PROGRAM))throw Error('Unexpected developer platform owner.');
  const updatesPlatform=p?needsDeveloperFeeUpdate(p.data,owner):false;
  const data=p&&!updatesPlatform?p.data:developerPlatformData(owner);
  verifyDeveloperPlatform(data,owner);
  const postMigrationFeeRate=verifyDestinationFees(cp.data,share?.owner.equals(CPMM)&&share.data.length?share.data:null,owner);
  const config=decodeConfig(c.data,data);
  if(config.minimum>LAUNCH_TARGET)throw Error('Raydium now requires more than the configured 73 SOL target.');
  config.minimum=LAUNCH_TARGET;
  config.fingerprint+=':73-sol-no-dev-reserve';
  config.platform=platform;config.developer=developer;config.createsPlatform=!p;config.updatesPlatform=updatesPlatform;config.postMigrationFeeRate=postMigrationFeeRate;
  config.fingerprint+=(p?.data.toString('hex')||'new')+cp.data.toString('hex')+(share?.data.toString('hex')||'');
  initialReserves(config.minimum,config.migrateFee);
  return config;
}
export function createDeveloperPlatformInstruction(developer:PublicKey){
  return new TransactionInstruction({programId:PROGRAM,keys:[key(developer,true,true),key(developer),key(developer),key(developerPlatform(developer),true),key(DEV_CPMM_CONFIG,true),key(SystemProgram.programId),key(PublicKey.default),key(developer)],data:Buffer.concat([Buffer.from([176,90,196,175,253,113,220,20]),u64(100000n),u64(0n),u64(900000n),u64(0n),str('rapelaunch'),str('https://x.com/rapelaunch_xyz'),str(''),u64(DEV_FEE_RATE),u64(0n)])});
}
export function grossFunding(threshold:bigint,rate:bigint){if(rate<0n||rate>=DENOMINATOR)throw Error('Invalid trade fee.');return ceilDiv(threshold*DENOMINATOR,DENOMINATOR-rate);}
export type Buyer={address:string;budget:bigint;label:string};
export type BuyQuote=Buyer&{tokens:bigint;net:bigint;gross:bigint;completes:boolean};
// Exact integer arithmetic and rounding order from Raydium's official
// launchpad/curve/constantProductCurve.ts and curve.ts (getInitParam/buyExactOut).
export function initialReserves(threshold:bigint,migrateFee:bigint){
  const remaining=POOL_SUPPLY,f=threshold-migrateFee;
  const denominator=f*SOLD/remaining-threshold;
  if(f<=0n||denominator<=0n)throw Error('Invalid migration curve.');
  const a=(f*SOLD*SOLD/remaining)/denominator,b=threshold*threshold/denominator;
  if(a>U64_MAX||b>U64_MAX-threshold||a<=SOLD||b===0n)throw Error('Migration curve reserves are outside the supported range.');
  return {a,b};
}
export function openingFdv(config:Config){
  const {a,b}=initialReserves(config.minimum,config.migrateFee);
  return b*SUPPLY/a;
}
export function migrationFdv(config:Config){
  return (config.minimum-config.migrateFee)*SUPPLY/POOL_SUPPLY;
}
export function quoteBuyers(buyers:Buyer[],threshold:bigint,config:Config):BuyQuote[]{
  if(buyers.length<1||buyers.length>7)throw Error('Choose a dev wallet and up to six additional wallets.');
  if(new Set(buyers.map(b=>b.address)).size!==buyers.length)throw Error('Every buyer must use a different wallet.');
  if(threshold<config.minimum)throw Error(`The current minimum migration target is ${formatSol(config.minimum)} SOL.`);
  let {a,b}=initialReserves(threshold,config.migrateFee),sold=0n;
  return buyers.map((buyer,i)=>{
    new PublicKey(buyer.address);
    if (i===0 && buyer.budget===0n) return {...buyer,tokens:0n,net:0n,gross:0n,completes:false};
    if(buyer.budget<=0n)throw Error(`${buyer.label}: enter a positive purchase budget.`);
    const remaining=SOLD-sold;
    const netBudget=buyer.budget-ceilDiv(buyer.budget*config.feeRate,DENOMINATOR);
    const affordable=netBudget*a/(b+netBudget);
    const tokens=affordable>=remaining?remaining:affordable;
    if(tokens<=0n)throw Error(`${buyer.label}: budget is too small to purchase a token unit.`);
    if(tokens===remaining && i<buyers.length-1)throw Error(`${buyer.label} would fill the curve before the other buyers. Reduce this budget or remove the later buyers.`);
    const net=ceilDiv(b*tokens,a-tokens),gross=grossFunding(net,config.feeRate);
    if(gross>buyer.budget)throw Error(`${buyer.label}: the quoted purchase exceeds the budget.`);
    a-=tokens;b+=net;sold+=tokens;
    return {...buyer,tokens,net,gross,completes:tokens===remaining};
  });
}
export function createInstruction(owner:PublicKey,mint:PublicKey,name:string,symbol:string,uri:string,threshold:bigint,platform=PLATFORM){
  const error=tokenNameError(name)||tickerError(symbol)||metadataUriError(uri);
  if(error)throw Error(error);
  name=name.trim();
  uri=uri.trim();
  const pool=poolAddress(mint),metadata=PublicKey.findProgramAddressSync([Buffer.from('metadata'),META.toBuffer(),mint.toBuffer()],META)[0];
  const data=Buffer.concat([Buffer.from([67,153,175,39,218,16,38,32,6]),str(name),str(symbol),str(uri),Buffer.from([0]),u64(SUPPLY),u64(SOLD),u64(threshold),Buffer.from([1]),u64(VESTED),u64(0n),u64(0n),Buffer.from([0])]);
  return new TransactionInstruction({programId:PROGRAM,data,keys:[key(owner,true,true),key(owner),key(CONFIG),key(platform),key(auth),key(pool,true),key(mint,true,true),key(WSOL),key(vault(pool,mint),true),key(vault(pool,WSOL),true),key(metadata,true),key(TOKEN_PROGRAM_ID),key(TOKEN_PROGRAM_ID),key(META),key(SystemProgram.programId),key(SYSVAR_RENT_PUBKEY),key(event),key(PROGRAM)]});
}
export function allocateVestingInstruction(creator:PublicKey,mint:PublicKey){
  const pool=poolAddress(mint);
  return new TransactionInstruction({
    programId:PROGRAM,
    data:Buffer.concat([Buffer.from([129,178,2,13,217,172,230,218]),u64(VESTED)]),
    keys:[key(creator,true,true),key(creator,true),key(pool,true),key(vestingAddress(pool,creator),true),key(SystemProgram.programId)],
  });
}
function buyInstructions(creator:PublicKey,mint:PublicKey,quote:BuyQuote,quoteExists:boolean,platform=PLATFORM):TransactionInstruction[]{
  const owner=new PublicKey(quote.address),pool=poolAddress(mint),baseAta=getAssociatedTokenAddressSync(mint,owner),quoteAta=getAssociatedTokenAddressSync(WSOL,owner);
  const purchase=new TransactionInstruction({programId:PROGRAM,data:Buffer.concat([Buffer.from([24,211,116,40,105,3,153,56]),u64(quote.tokens),u64(quote.budget),u64(0n)]),keys:[key(owner,true,true),key(auth),key(CONFIG),key(platform),key(pool,true),key(baseAta,true),key(quoteAta,true),key(vault(pool,mint),true),key(vault(pool,WSOL),true),key(mint),key(WSOL),key(TOKEN_PROGRAM_ID),key(TOKEN_PROGRAM_ID),key(event),key(PROGRAM),key(SystemProgram.programId),key(pda(platform.toBuffer(),WSOL.toBuffer()),true),key(pda(creator.toBuffer(),WSOL.toBuffer()),true)]});
  const instructions=[createAssociatedTokenAccountIdempotentInstruction(owner,quoteAta,owner,WSOL),SystemProgram.transfer({fromPubkey:owner,toPubkey:quoteAta,lamports:Number(quote.budget)}),createSyncNativeInstruction(quoteAta),createAssociatedTokenAccountIdempotentInstruction(owner,baseAta,owner,mint),purchase];
  if(!quoteExists)instructions.push(createCloseAccountInstruction(quoteAta,owner,owner));
  return instructions;
}
export function makeTransaction(payer:PublicKey,blockhash:string,instructions:TransactionInstruction[]){
  return new Transaction({feePayer:payer,recentBlockhash:blockhash}).add(ComputeBudgetProgram.setComputeUnitLimit({units:600000}),ComputeBudgetProgram.setComputeUnitPrice({microLamports:10000}),...instructions);
}
export function transactionSize(tx:Transaction){
  try{return tx.serialize({requireAllSignatures:false,verifySignatures:false}).length;}catch(error){if(error instanceof Error&&/too large|encoding overruns/i.test(error.message))return Infinity;throw error;}
}
export type BundlePlan={transactions:Transaction[];quotes:BuyQuote[];mint:string;pool:string;vesting:string;creationIncludesDevBuy:boolean;blockhash:BlockhashWithExpiryBlockHeight;configFingerprint:string;quoteAccountsPreserved:string[]};
export async function buildBundle(input:{connection:Connection;dev:PublicKey;mint:PublicKey;name:string;symbol:string;uri:string;threshold:bigint;buyers:Buyer[];config:Config;tipAccount:PublicKey}):Promise<BundlePlan>{
  const {connection,dev,mint,name,symbol,uri,threshold,buyers,config,tipAccount}=input;
  if(config.updatesPlatform)throw Error('Update creator fees for this developer wallet before reviewing a launch.');
  if(buyers[0]?.address!==dev.toBase58())throw Error('The developer must be the first buyer.');
  if(config.platform&&(!config.developer?.equals(dev)||!config.platform.equals(developerPlatform(dev))))throw Error('Reload the fee configuration for the selected developer wallet.');
  const platform=config.platform||PLATFORM;
  const quotes=quoteBuyers(buyers,threshold,config);
  const blockhash=await connection.getLatestBlockhash('confirmed');
  const purchases=quotes.filter(quote=>quote.tokens>0n);
  const quoteAccounts=purchases.length?await connection.getMultipleAccountsInfo(purchases.map(b=>getAssociatedTokenAddressSync(WSOL,new PublicKey(b.address))),'confirmed'):[];
  const groups=quotes.map(quote=>{
    const index=purchases.indexOf(quote);
    return index<0?[]:buyInstructions(dev,mint,quote,!!quoteAccounts[index],platform);
  });
  const creation=[...(config.createsPlatform?[createDeveloperPlatformInstruction(dev)]:[]),createInstruction(dev,mint,name,symbol,uri,threshold,platform),...(VESTED>0n?[allocateVestingInstruction(dev,mint)]:[])];
  const first=makeTransaction(dev,blockhash.blockhash,creation);
  if(transactionSize(first)>1232)throw Error('Metadata is too long for token creation. Use a shorter metadata link.');
  const combined=makeTransaction(dev,blockhash.blockhash,[...creation,...groups[0]]);
  const creationIncludesDevBuy=quotes[0].tokens>0n&&transactionSize(combined)<=1232;
  if(creationIncludesDevBuy)first.add(...groups[0]);
  const transactions=[first];
  let current:TransactionInstruction[]=[];
  for(const instructions of groups.slice(creationIncludesDevBuy?1:0).filter(group=>group.length>0)){
    const candidate=makeTransaction(dev,blockhash.blockhash,[...current,...instructions]);
    if(transactionSize(candidate)<=1232){current.push(...instructions);continue;}
    if(!current.length)throw Error('A buyer transaction does not fit the Solana packet limit.');
    transactions.push(makeTransaction(dev,blockhash.blockhash,current));current=[...instructions];
    if(transactionSize(makeTransaction(dev,blockhash.blockhash,current))>1232)throw Error('A buyer transaction is too large.');
  }
  if(current.length)transactions.push(makeTransaction(dev,blockhash.blockhash,current));
  const tipInstruction=SystemProgram.transfer({fromPubkey:dev,toPubkey:tipAccount,lamports:JITO_TIP});
  const last=transactions[transactions.length-1];last.add(tipInstruction);
  if(transactionSize(last)>1232){last.instructions.pop();transactions.push(makeTransaction(dev,blockhash.blockhash,[tipInstruction]));}
  if(transactions.length>5)throw Error('This wallet configuration exceeds Jito’s five-transaction limit. Reduce buyers; the launcher will never split a launch into separate bundles.');
  return {transactions,quotes,mint:mint.toBase58(),pool:poolAddress(mint).toBase58(),vesting:vestingAddress(poolAddress(mint),dev).toBase58(),creationIncludesDevBuy,blockhash,configFingerprint:config.fingerprint,quoteAccountsPreserved:purchases.filter((_b,i)=>!!quoteAccounts[i]).map(b=>b.address)};
}
export function decodePool(data:Buffer,mint:PublicKey,platform=PLATFORM){
  if(data.length<365||data[20]!==1||!new PublicKey(data.subarray(141,173)).equals(CONFIG)||!new PublicKey(data.subarray(173,205)).equals(platform)||!new PublicKey(data.subarray(205,237)).equals(mint)||!new PublicKey(data.subarray(237,269)).equals(WSOL))throw Error('The pool does not match this LaunchLab token.');
  return {status:data[17],sold:data.readBigUInt64LE(53),reserve:data.readBigUInt64LE(61),threshold:data.readBigUInt64LE(69),creator:new PublicKey(data.subarray(333,365)).toBase58(),totalSell:data.readBigUInt64LE(29),vested:data.readBigUInt64LE(101),cliffPeriod:data.readBigUInt64LE(109),unlockPeriod:data.readBigUInt64LE(117),allocatedVesting:data.readBigUInt64LE(133)};
}
export function decodeVesting(data:Buffer,pool:PublicKey,beneficiary:PublicKey){
  if(data.length<96||!new PublicKey(data.subarray(16,48)).equals(pool)||!new PublicKey(data.subarray(48,80)).equals(beneficiary))throw Error('The vesting account does not match the launch and developer wallet.');
  return {claimed:data.readBigUInt64LE(80),amount:data.readBigUInt64LE(88)};
}
export async function inspectMigration(connection:Connection,mintAddress:string,cpmmConfig:string,platform=PLATFORM){
  const mint=new PublicKey(mintAddress),account=await connection.getAccountInfo(poolAddress(mint),'confirmed');
  if(!account)return {stage:'not-found' as const,pool:''};
  if(!account.owner.equals(PROGRAM))throw Error('Unexpected launch pool owner.');
  const state=decodePool(account.data,mint,platform);
  if(state.status===0)return {stage:'curve' as const,pool:'',...state};
  if(state.status===1)return {stage:'migration-pending' as const,pool:'',...state};
  if(state.status!==2)throw Error('Unknown LaunchLab migration status.');
  const [a,b]=[mint,WSOL].sort((x,y)=>Buffer.compare(x.toBuffer(),y.toBuffer()));
  const destination=PublicKey.findProgramAddressSync([Buffer.from('pool'),new PublicKey(cpmmConfig).toBuffer(),a.toBuffer(),b.toBuffer()],CPMM)[0];
  const matches=(account:Awaited<ReturnType<Connection['getAccountInfo']>>)=>account&&account.owner.equals(CPMM)&&account.data.length>=232&&new PublicKey(account.data.subarray(168,200)).equals(a)&&new PublicKey(account.data.subarray(200,232)).equals(b);
  const pool=await connection.getAccountInfo(destination,'confirmed');
  if(matches(pool))return {stage:'migrated' as const,pool:destination.toBase58(),cpmmConfig,...state};
  // A developer-signed fee upgrade may have selected a new tier after an older
  // token was launched. Preserve the recorded tier for already-migrated pools,
  // and check the current platform tier only when that destination is absent.
  const settings=await connection.getAccountInfo(platform,'confirmed');
  if(settings?.owner.equals(PROGRAM)&&settings.data.length>=720){
    const current=new PublicKey(settings.data.subarray(688,720));
    if(current.toBase58()!==cpmmConfig){
      const updated=PublicKey.findProgramAddressSync([Buffer.from('pool'),current.toBuffer(),a.toBuffer(),b.toBuffer()],CPMM)[0];
      if(matches(await connection.getAccountInfo(updated,'confirmed')))return {stage:'migrated' as const,pool:updated.toBase58(),cpmmConfig:current.toBase58(),...state};
    }
  }
  throw Error('LaunchLab reports migration, but the destination CPMM pool is not yet verified. Refresh shortly.');
}
