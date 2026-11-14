// Read-only: simulation disables signature verification and never broadcasts.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {Connection,Keypair,PublicKey} from '@solana/web3.js';
import {CONFIG,SOLD,VESTED,buildBundle,readConfig,decodePool,decodeVesting,verifyDeveloperPlatform,grossFunding,parseSol,formatSol,transactionSize,initialReserves} from '../src/lib/launchlab.ts';
const env=Object.fromEntries((await readFile(new URL('../.env',import.meta.url),'utf8')).split(/\r?\n/).flatMap(line=>{const m=line.trim().match(/^([A-Z_]+)=(.*)$/);return m?[[m[1],m[2].replace(/^["']|["']$/g,'')]]:[];}));
const connection=new Connection(env.SOLANA_RPC_URL||'https://api.mainnet-beta.solana.com','confirmed');
if(await connection.getGenesisHash()!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw Error('Expected mainnet.');
const account=await connection.getAccountInfo(CONFIG);
const candidates=[211,115,147,179].map(offset=>new PublicKey(account.data.subarray(offset,offset+32)));
let payer;for(const candidate of candidates){if(await connection.getBalance(candidate)>80e9){payer=candidate;break;}}
if(!payer)throw Error('No public funded simulation payer available. No transaction was sent.');
const config=await readConfig(connection,payer);
const results=[];
const fullBudget=grossFunding(config.minimum,config.feeRate)+parseSol('0.005');
for(const {name,devBudget,extraBuyers,expectedStatus} of [
  {name:'Creation only',devBudget:0n,extraBuyers:0,expectedStatus:0},
  {name:'1 SOL dev buy',devBudget:parseSol('1'),extraBuyers:0,expectedStatus:0},
  {name:'Full dev buy',devBudget:fullBudget,extraBuyers:0,expectedStatus:1},
  {name:'Dev plus six buyers',devBudget:parseSol('1'),extraBuyers:6,expectedStatus:0},
]){
  const mint=Keypair.generate(),buyers=[{address:payer.toBase58(),budget:devBudget,label:'Simulation payer'},...Array.from({length:extraBuyers},(_,i)=>({address:Keypair.generate().publicKey.toBase58(),budget:parseSol('0.1'),label:`Buyer ${i+1}`}))];
  const compact=extraBuyers===0&&devBudget>0n;
  const plan=await buildBundle({connection,dev:payer,mint:mint.publicKey,name:compact?'SIM':'Zeroblock simulation',symbol:'SIM',uri:compact?'ipfs://sim':'ipfs://bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',threshold:config.minimum,buyers,config,tipAccount:candidates[1]});
  const unsigned=plan.transactions[0].serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64');
  const response=await fetch(env.SOLANA_RPC_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'simulateTransaction',params:[unsigned,{encoding:'base64',sigVerify:false,commitment:'confirmed',accounts:{encoding:'base64',addresses:[plan.pool,plan.vesting,config.platform.toBase58()]}}]})});
  const result=await response.json(),value=result.result?.value;
  if(!value||value.err)throw Error(`Simulation failed: ${JSON.stringify(value?.err||result.error?.code)} ${value?.logs?.slice(-4).join(' ')||''}`);
  const data=Buffer.from(value.accounts[0].data[0],'base64'),state=decodePool(data,mint.publicKey,config.platform);
  if(!plan.creationIncludesDevBuy){const local=initialReserves(config.minimum,config.migrateFee);if(data.readBigUInt64LE(37)!==local.a||data.readBigUInt64LE(45)!==local.b)throw Error('On-chain starting reserves differ from the FDV calculation.');}
  verifyDeveloperPlatform(Buffer.from(value.accounts[2].data[0],'base64'),payer);
  const expected=plan.creationIncludesDevBuy?plan.quotes[0]:{tokens:0n,net:0n,completes:false};
  const vesting=VESTED>0n?decodeVesting(Buffer.from(value.accounts[1].data[0],'base64'),new PublicKey(plan.pool),payer):{amount:0n,claimed:0n};
  if(VESTED===0n&&value.accounts[1])throw Error('Unexpected developer vesting account.');
  if(state.status!==(plan.creationIncludesDevBuy?expectedStatus:0)||state.threshold!==config.minimum||state.sold!==expected.tokens||state.reserve!==expected.net||state.creator!==payer.toBase58()||state.totalSell!==SOLD||state.vested!==VESTED||state.allocatedVesting!==VESTED||state.cliffPeriod!==0n||state.unlockPeriod!==0n||vesting.amount!==VESTED||vesting.claimed!==0n)throw Error(`${name}: simulated state differs from the local quote or developer vesting allocation.`);
  results.push({scenario:name,buyers:buyers.length,devBudgetSOL:formatSol(devBudget),simulatedTransactions:1,totalBundleTransactions:plan.transactions.length,creationIncludesDevBuy:plan.creationIncludesDevBuy,bytes:plan.transactions.map(transactionSize),units:value.unitsConsumed,status:state.status,sold:state.sold.toString(),reserveSOL:formatSol(state.reserve),thresholdSOL:formatSol(state.threshold),vested:vesting.amount.toString(),mint:mint.publicKey.toBase58(),creator:payer.toBase58(),poolDataBase64:data.toString('base64')});
}
const report={broadcast:false,coverage:'First transaction only; subsequent dependent buys are not simulated.',minimumSOL:formatSol(config.minimum),feePercent:Number(config.feeRate)/10000,postMigrationFeePercent:Number(config.postMigrationFeeRate)/10000,developerNetPercent:{before:0.5,after:0.475},createsPlatform:config.createsPlatform,updatesPlatform:config.updatesPlatform,migrationFeeSOL:formatSol(config.migrateFee),results};
await mkdir(new URL('../outputs/',import.meta.url),{recursive:true});await writeFile(new URL('../outputs/mainnet-simulation.json',import.meta.url),JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,results:results.map(({poolDataBase64,mint,creator,...result})=>result)},null,2));
