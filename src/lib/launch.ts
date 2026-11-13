import {Buffer} from 'buffer';
import {Keypair,PublicKey,Transaction} from '@solana/web3.js';
import bs58 from 'bs58';
import {api,connection} from './api';
import {JITO_TIP,PROGRAM,SOLD,VESTED,buildBundle,readConfig,decodePool,decodeVesting,verifyDeveloperPlatform,inspectMigration,type Buyer,type BundlePlan,type Config,formatSol} from './launchlab';
import {applyWalletSignature, type WalletSigner} from './wallet-signatures';
import {estimateNetworkFee} from './transaction-fees';
export type Review={plan:BundlePlan;mint:Keypair;config:Config;networkFee:bigint;balances:Record<string,bigint>;simulation:string;createdAt:number;threshold:bigint};
export type LaunchRecord={mint:string;name:string;symbol:string;creator:string;cpmmConfig:string;platform?:string;createdAt:number;signatures:string[];lastValidBlockHeight:number;bundleId?:string;stage:string;pool?:string;detail?:string};
export const HISTORY_KEY='zeroblock.launches.v1';
export const activeRecord=(record:LaunchRecord)=>!['migrated','failed'].includes(record.stage);
export const awaitingLaunchConfirmation=(record:LaunchRecord)=>record.stage==='submitted';
export function loadHistory():LaunchRecord[]{try{const list=JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]');return Array.isArray(list)?list.slice(0,100):[];}catch{return [];}}
export async function prepare(input:{dev:string;name:string;symbol:string;uri:string;configFingerprint:string;buyers:Buyer[];onProgress:(message:string)=>void}):Promise<Review>{
  input.onProgress('Verifying the live Raydium configuration…');
  if(await connection.getGenesisHash()!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw Error('The RPC must point to Solana mainnet.');
  const config=await readConfig(connection,new PublicKey(input.dev)),mint=Keypair.generate();
  if(config.fingerprint!==input.configFingerprint)throw Error('Raydium settings changed. Reload the configuration and review again.');
  const threshold=config.minimum;
  const {accounts}=await api<{accounts:string[]}>('tip-accounts');
  if(!accounts?.length)throw Error('Jito tip accounts are unavailable. Retry shortly.');
  const plan=await buildBundle({...input,threshold,dev:new PublicKey(input.dev),mint:mint.publicKey,connection,config,tipAccount:new PublicKey(accounts[crypto.getRandomValues(new Uint32Array(1))[0]%accounts.length])});
  const balances:Record<string,bigint>={};
  const infos=await connection.getMultipleAccountsInfo(input.buyers.map(b=>new PublicKey(b.address)));
  input.buyers.forEach((b,i)=>{balances[b.address]=BigInt(infos[i]?.lamports||0);});
  const networkFee=await estimateNetworkFee(connection,plan);
  for(const [i,buyer] of input.buyers.entries()){
    const required=buyer.budget+(i===0?50_000_000n+JITO_TIP+networkFee:4_100_000n);
    if(balances[buyer.address]<required)throw Error(`${buyer.label} needs ${formatSol(required)} SOL available (purchase budget plus temporary account/setup reserve). Current balance: ${formatSol(balances[buyer.address])} SOL.`);
  }
  const developerQuote=plan.quotes[0];
  const simulationLabel=(config.createsPlatform?'Creator-fee setup + ':config.updatesPlatform?'Creator-fee update + ':'')+(plan.creationIncludesDevBuy?'creation + vesting + dev buy':'creation + vesting');
  input.onProgress(`Simulating ${simulationLabel.toLowerCase()}…`);
  // Standard RPC can simulate the first transaction, not dependent transactions
  // across a whole bundle. Never call this a full bundle simulation.
  const tx=plan.transactions[0];
  const simulation=await api<{result?:{value:{err:unknown;logs:string[];accounts?:({data:[string,string];owner:string}|null)[];unitsConsumed?:number}};error?:unknown}>('rpc',{jsonrpc:'2.0',id:1,method:'simulateTransaction',params:[tx.serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64'),{encoding:'base64',sigVerify:false,commitment:'confirmed',accounts:{encoding:'base64',addresses:[plan.pool,plan.vesting,config.platform!.toBase58()]}}]});
  const value=simulation.result?.value;
  if(!value||value.err)throw Error(`Creation simulation failed: ${JSON.stringify(value?.err||'RPC unavailable')}. ${value?.logs?.filter(s=>/Error|failed|insufficient/i.test(s)).slice(-2).join(' ')||''}`);
  const account=value.accounts?.[0],vestingAccount=value.accounts?.[1],platformAccount=value.accounts?.[2];
  if(!account||account.owner!==PROGRAM.toBase58()||!vestingAccount||vestingAccount.owner!==PROGRAM.toBase58()||!platformAccount||platformAccount.owner!==PROGRAM.toBase58())throw Error('Simulation did not return the launch, vesting and developer fee accounts.');
  verifyDeveloperPlatform(Buffer.from(platformAccount.data[0],'base64'),new PublicKey(input.dev));
  const pool=decodePool(Buffer.from(account.data[0],'base64'),mint.publicKey,config.platform);
  const vesting=decodeVesting(Buffer.from(vestingAccount.data[0],'base64'),new PublicKey(plan.pool),new PublicKey(input.dev));
  const expected=plan.creationIncludesDevBuy?developerQuote:{tokens:0n,net:0n,completes:false};
  if(pool.sold!==expected.tokens||pool.reserve!==expected.net||pool.threshold!==threshold||pool.status!==(expected.completes?1:0)||pool.totalSell!==SOLD||pool.vested!==VESTED||pool.allocatedVesting!==VESTED||pool.cliffPeriod!==0n||pool.unlockPeriod!==0n||vesting.amount!==VESTED||vesting.claimed!==0n)throw Error('Simulated pool or vesting differs from the reviewed launch. Signing is disabled.');
  const remaining=plan.quotes.slice(plan.creationIncludesDevBuy?1:0).some(quote=>quote.tokens>0n)?' The RPC simulated the first transaction. Additional purchases are checked when the bundle executes.':'';
  return {plan,mint,config,balances,networkFee,simulation:`${simulationLabel} passed (${(value.unitsConsumed||0).toLocaleString()} compute units).${remaining}`,createdAt:Date.now(),threshold};
}
export async function signReview(review:Review,privySigners:ReadonlyMap<string, WalletSigner>):Promise<Transaction[]>{
  const config=await readConfig(connection,new PublicKey(review.plan.quotes[0].address));if(config.fingerprint!==review.config.fingerprint)throw Error('Raydium settings changed. Create a fresh review.');
  if(Date.now()-review.createdAt>55000||await connection.getBlockHeight('confirmed')>review.plan.blockhash.lastValidBlockHeight-25)throw Error('This review expired. Refresh the review before signing.');
  for (const buyer of review.plan.quotes) {
    if (!privySigners.has(buyer.address)) throw Error(`${buyer.label} is unavailable. Sign in to Privy and review the launch again.`);
  }
  const txs=review.plan.transactions.map(t=>Transaction.from(t.serialize({requireAllSignatures:false,verifySignatures:false})));
  const messages=txs.map(tx=>tx.serializeMessage().toString('base64'));
  const accounts=await connection.getMultipleAccountsInfo(review.plan.quotes.map(q=>new PublicKey(q.address)));
  for(const [i,q] of review.plan.quotes.entries()){const reserve=i===0?50_000_000n+JITO_TIP+review.networkFee:4_100_000n;if(BigInt(accounts[i]?.lamports||0)<q.budget+reserve)throw Error(`${q.label}: balance changed. Fund the wallet and refresh the review.`);}
  txs[0].partialSign(review.mint);
  for (const tx of txs) {
    for (const signer of tx.signatures) {
      const address = signer.publicKey.toBase58();
      if (address === review.mint.publicKey.toBase58()) continue;
      const sign = privySigners.get(address);
      if (!sign) throw Error('A required Privy wallet is unavailable.');
      await applyWalletSignature(tx, signer.publicKey, sign);
    }
  }
  if(txs.some((tx,i)=>tx.serializeMessage().toString('base64')!==messages[i]||!tx.verifySignatures()))throw Error('Wallet signatures or transaction messages could not be verified. Nothing was sent.');
  if(await connection.getBlockHeight('confirmed')>review.plan.blockhash.lastValidBlockHeight-10)throw Error('Signing took too long and the blockhash is expiring. Nothing was sent. Refresh the review.');
  return txs;
}
export function recordFor(review:Review,signed:Transaction[],name:string,symbol:string):LaunchRecord{return {mint:review.plan.mint,name,symbol,creator:review.plan.quotes[0].address,cpmmConfig:review.config.cpmmConfig.toBase58(),platform:review.config.platform?.toBase58(),createdAt:Date.now(),signatures:signed.map(tx=>bs58.encode(tx.signature!)),lastValidBlockHeight:review.plan.blockhash.lastValidBlockHeight,stage:'submitted',detail:'Signed bundle submission is in progress.'};}
export async function refreshRecord(record:LaunchRecord):Promise<LaunchRecord>{
  const signatures=await connection.getSignatureStatuses(record.signatures,{searchTransactionHistory:true});
  const migration=await inspectMigration(connection,record.mint,record.cpmmConfig,record.platform?new PublicKey(record.platform):undefined);
  if(migration.stage!=='not-found'){
    const detail=migration.stage==='migrated'?'LaunchLab status 2 and the destination Raydium CPMM pool are verified.':migration.stage==='migration-pending'?'Curve is complete. Raydium’s migration keeper has not yet finalized the CPMM pool.':'A LaunchLab pool exists; curve completion is not yet confirmed.';
    return {...record,stage:migration.stage,pool:migration.pool,cpmmConfig:migration.stage==='migrated'?migration.cpmmConfig:record.cpmmConfig,detail};
  }
  if(signatures.value.some(status=>status?.err))return {...record,stage:'failed',detail:'An on-chain transaction failed. No launch pool was found.'};
  const height=await connection.getBlockHeight('finalized');
  if(height>record.lastValidBlockHeight+32&&signatures.value.every(s=>!s))return {...record,stage:'failed',detail:'The bundle expired without a confirmed transaction or launch pool. No new launch was submitted automatically.'};
  let detail='Awaiting on-chain confirmation. Do not create another token while the outcome is unknown.';
  if(record.bundleId){try{const status=await api<{inflight?:{value?:{status:string}[]}}>(`bundle-status?id=${encodeURIComponent(record.bundleId)}`);const state=status.inflight?.value?.[0]?.status;if(state)detail=`Jito: ${state}. Checking on-chain pool state.`;}catch{}}
  return {...record,stage:'submitted',detail};
}
