import type {BlockhashWithExpiryBlockHeight,Connection,Transaction} from '@solana/web3.js';

type UnsignedPlan={transactions:Transaction[];blockhash:BlockhashWithExpiryBlockHeight};
type FeeConnection=Pick<Connection,'getFeeForMessage'|'getLatestBlockhash'>;

export async function estimateNetworkFee(connection:FeeConnection,plan:UnsignedPlan):Promise<bigint>{
  for(let attempt=0;attempt<3;attempt++){
    const fees=await Promise.allSettled(plan.transactions.map(tx=>connection.getFeeForMessage(tx.compileMessage(),'confirmed')));
    if(fees.every(result=>result.status==='fulfilled'&&result.value.value!==null&&Number.isSafeInteger(result.value.value)&&result.value.value>=0)){
      return fees.reduce((sum,result)=>sum+BigInt(result.status==='fulfilled'?result.value.value!:0),0n);
    }
    if(attempt===2)break;
    if(plan.transactions.some(tx=>tx.signatures.some(signature=>signature.signature!==null)))throw Error('A signed review cannot be refreshed. Prepare a new review.');
    // A null fee can mean this RPC backend does not recognize the message's
    // blockhash yet. A finalized hash is older and visible across RPC backends.
    // Refresh every unsigned message and its expiry together before reviewing.
    let fresh:BlockhashWithExpiryBlockHeight;
    try{fresh=await connection.getLatestBlockhash('finalized');}
    catch{throw Error('Solana RPC could not refresh the fee estimate. Nothing was signed or sent. Retry the review shortly.');}
    for(const tx of plan.transactions)tx.recentBlockhash=fresh.blockhash;
    plan.blockhash=fresh;
  }
  throw Error('Solana RPC could not estimate network fees after retrying. Nothing was signed or sent. Retry the review shortly.');
}
