import {Buffer} from 'buffer';
import {PublicKey} from '@solana/web3.js';
import bs58 from 'bs58';
import {api,connection} from './api';
import {makeTransaction,readConfig,PROGRAM,updateDeveloperPlatformInstruction,verifyDeveloperPlatform} from './launchlab';
import {estimateNetworkFee} from './transaction-fees';
import {applyWalletSignature,type WalletSigner} from './wallet-signatures';

export async function applyCreatorFeeUpdate(developer:string,sign:WalletSigner,onProgress:(value:string)=>void,onSubmitted:(signature:string)=>void){
  onProgress('Verifying creator-fee settings…');
  if(await connection.getGenesisHash()!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw Error('Expected Solana mainnet.');
  const owner=new PublicKey(developer),config=await readConfig(connection,owner);
  if(!config.updatesPlatform)throw Error('This wallet does not need a creator-fee update. Refresh the settings.');
  const blockhash=await connection.getLatestBlockhash('confirmed');
  const tx=makeTransaction(owner,blockhash.blockhash,[updateDeveloperPlatformInstruction(owner)]),plan={transactions:[tx],blockhash};
  const fee=await estimateNetworkFee(connection,plan);
  if(BigInt(await connection.getBalance(owner,'confirmed'))<fee)throw Error('The developer wallet needs enough SOL for the network fee.');
  onProgress('Simulating the creator-fee update…');
  const simulation=await api<{result?:{value:{err:unknown;accounts?:({owner:string;data:[string,string]}|null)[]}}}>('rpc',{jsonrpc:'2.0',id:1,method:'simulateTransaction',params:[tx.serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64'),{encoding:'base64',sigVerify:false,commitment:'confirmed',accounts:{encoding:'base64',addresses:[config.platform!.toBase58()]}}]});
  const result=simulation.result?.value,account=result?.accounts?.[0];
  if(!result||result.err||!account||account.owner!==PROGRAM.toBase58())throw Error('Creator-fee update simulation failed. Nothing was signed or sent.');
  verifyDeveloperPlatform(Buffer.from(account.data[0],'base64'),owner);
  if((await readConfig(connection,owner)).fingerprint!==config.fingerprint)throw Error('Fee settings changed. Refresh before signing.');
  const original=tx.serializeMessage();
  onProgress('Signing the creator-fee update through Privy…');
  await applyWalletSignature(tx,owner,sign);
  if(!tx.serializeMessage().equals(original)||!tx.verifySignatures())throw Error('The signed fee update could not be verified. Nothing was sent.');
  if(await connection.getBlockHeight('confirmed')>plan.blockhash.lastValidBlockHeight-10)throw Error('The fee update expired before submission. Retry the update.');
  // Save a public signature before submission so an uncertain response can be
  // checked without automatically signing or submitting a different update.
  const signature=bs58.encode(tx.signature!);onSubmitted(signature);
  onProgress('Submitting the creator-fee update…');
  const response=await api<{signature:string}>('creator-fees',{transaction:tx.serialize().toString('base64')});
  if(response.signature!==signature)throw Error('Unexpected fee update signature. Check the transaction before retrying.');
  for(let i=0;i<40;i++){
    const status=(await connection.getSignatureStatuses([signature],{searchTransactionHistory:true})).value[0];
    if(status?.err)throw Error('The creator-fee update failed on-chain. Refresh settings before retrying.');
    if(status?.confirmationStatus==='confirmed'||status?.confirmationStatus==='finalized'){
      const updated=await readConfig(connection,owner);
      if(updated.updatesPlatform)throw Error('The fee update is confirmed; refresh settings to check its final state.');
      return updated;
    }
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  throw Error('Confirmation is pending. Check the transaction and refresh settings before retrying.');
}
