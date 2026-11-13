import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,dirname,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Transaction,PublicKey} from '@solana/web3.js';
import {createWalletArchiveService, WalletRequestError} from './privy-wallets.mjs';
import {validateCreatorFeeUpdate} from './creator-fees.mjs';
import {sameOrigin,readJsonBody as body} from './request-policy.mjs';
import {descriptionError, limits, socialUrlError, tickerError, tokenNameError} from '../shared/form-rules.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
try{for(const line of (await readFile(resolve(root,'.env'),'utf8')).replace(/^\uFEFF/,'').split(/\r?\n/)){const match=line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);if(match&&!process.env[match[1]])process.env[match[1]]=match[2].trim().replace(/^(["'])(.*)\1$/,'$2');}}catch{}
const rpc=process.env.SOLANA_RPC_URL||'https://api.mainnet-beta.solana.com';
const jito='https://mainnet.block-engine.jito.wtf/api/v1/bundles';
const walletArchive=createWalletArchiveService(process.env.VITE_PRIVY_APP_ID, process.env.PRIVY_APP_SECRET);
const allowedRpc=new Set(['getAccountInfo','getMultipleAccounts','getBalance','getLatestBlockhash','getMinimumBalanceForRentExemption','getSignatureStatuses','getBlockHeight','getGenesisHash','getTokenSupply','getFeeForMessage','simulateTransaction','getTransaction','getSlot']);
const program='LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj';
const allowedPrograms=new Set([program,'11111111111111111111111111111111','ComputeBudget111111111111111111111111111111','TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA','ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL']);
export function validateBundle(encoded){
  if(!Array.isArray(encoded)||encoded.length<1||encoded.length>5)throw Error('A bundle must contain one to five transactions.');
  const transactions=encoded.map(value=>{
    if(typeof value!=='string'||value.length>1700||!/^[A-Za-z0-9+/]+=*$/.test(value))throw Error('Invalid transaction encoding.');
    const bytes=Buffer.from(value,'base64');if(bytes.length>1232)throw Error('Transaction exceeds the packet limit.');
    const tx=Transaction.from(bytes);if(!tx.verifySignatures())throw Error('Every transaction must be fully signed.');
    if(tx.instructions.some(ix=>!allowedPrograms.has(ix.programId.toBase58())))throw Error('Unexpected program in launch bundle.');
    return tx;
  });
  const first=transactions[0],creates=transactions.flatMap(t=>t.instructions).filter(ix=>ix.programId.toBase58()===program&&ix.data.subarray(0,8).equals(Buffer.from([67,153,175,39,218,16,38,32])));
  if(creates.length!==1||!first.instructions.includes(creates[0]))throw Error('The first transaction must create one LaunchLab token.');
  if(transactions.some(tx=>!tx.feePayer?.equals(first.feePayer)||tx.recentBlockhash!==first.recentBlockhash))throw Error('Bundle payer and blockhash must match.');
  return transactions;
}
async function requestJson(url,body,headers={}){
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
  if(!response.ok)throw Error(`Upstream service returned HTTP ${response.status}.`);
  return response.json();
}
async function jitoCall(method,params){
  const result=await requestJson(jito,{jsonrpc:'2.0',id:1,method,params},process.env.JITO_AUTH_UUID?{'x-jito-auth':process.env.JITO_AUTH_UUID}:{});
  if(result.error)throw Error(`Jito: ${String(result.error.message||'request failed').slice(0,300)}`);return result.result;
}
function respond(res,status,data){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
export function metadataCheck(data){
  const error=tokenNameError(data.name)||tickerError(data.symbol)||descriptionError(data.description)||socialUrlError(data.website)||socialUrlError(data.twitter,true);
  if(error)throw Error(error);
  if(data.image&&!/^(ipfs:\/\/|https:\/\/)\S{1,500}$/.test(data.image))throw Error('Invalid image URI.');
  const website=data.website?.trim();
  const twitter=data.twitter?.trim()?new URL(data.twitter.trim()).href:undefined;
  return {name:data.name.trim(),symbol:data.symbol,description:data.description,...(data.image?{image:data.image}:{}),...(website?{external_url:website}:{}),...(twitter?{twitter,extensions:{twitter}}:{})};
}
async function pin(path,init){if(!process.env.PINATA_JWT)throw Error('Pinata is not configured. Set PINATA_JWT on the server.');const response=await fetch(`https://api.pinata.cloud/pinning/${path}`,{...init,headers:{Authorization:`Bearer ${process.env.PINATA_JWT}`,...init.headers},signal:AbortSignal.timeout(45000)});if(!response.ok)throw Error(`Metadata host returned HTTP ${response.status}.`);const result=await response.json();if(!/^[A-Za-z0-9]{20,120}$/.test(result.IpfsHash||''))throw Error('Invalid metadata host response.');return {uri:`ipfs://${result.IpfsHash}`};}

let solPrice, solPriceRequest;
async function getSolPrice(){
  if(solPrice && Date.now()-solPrice.quotedAt<60_000)return solPrice;
  solPriceRequest??=(async()=>{
    const response=await fetch('https://api.kraken.com/0/public/Ticker?pair=SOLUSD',{signal:AbortSignal.timeout(6000)});
    if(!response.ok)throw Error('SOL/USD quote unavailable.');
    const ticker=await response.json();
    const usd=Number(ticker.result?.SOLUSD?.c?.[0]);
    if(!Number.isFinite(usd)||usd<=0)throw Error('SOL/USD quote unavailable.');
    solPrice={usd,quotedAt:Date.now()};
    return solPrice;
  })().finally(()=>{solPriceRequest=undefined;});
  return solPriceRequest;
}

async function api(req,res,url){
  if(!sameOrigin(req))return respond(res,403,{error:'This origin cannot use the launcher API.'});
  if(process.env.VERCEL&&['/api/image','/api/metadata'].includes(url.pathname)){
    if(!walletArchive)return respond(res,503,{error:'Privy server configuration is required for uploads.'});
    try{await walletArchive.verifyUser(req.headers.authorization);}
    catch(error){return respond(res,error instanceof WalletRequestError?error.status:401,{error:'Sign in to Privy before uploading artwork or metadata.'});}
  }
  if(url.pathname==='/api/health'&&req.method==='GET')return respond(res,200,{rpcConfigured:!!process.env.SOLANA_RPC_URL,pinataConfigured:!!process.env.PINATA_JWT,walletArchiveConfigured:!!walletArchive,version:'1.0.0'});
  if(url.pathname==='/api/sol-price'&&req.method==='GET'){
    try{return respond(res,200,await getSolPrice());}
    catch{return respond(res,503,{error:'SOL/USD quote unavailable.'});}
  }
  if(url.pathname==='/api/wallet-archive'&&['GET','POST'].includes(req.method)){
    if(!walletArchive)return respond(res,503,{error:'Privy wallet archiving is not configured on this server.'});
    try {
      if(req.method==='GET')return respond(res,200,{addresses:await walletArchive.archivedAddresses(req.headers.authorization)});
      const input=await body(req,1000);
      return respond(res,200,await walletArchive.archive(req.headers.authorization,input?.address));
    } catch(error) {
      if(error instanceof WalletRequestError)return respond(res,error.status,{error:error.message});
      return respond(res,502,{error:'Privy could not verify the wallet or confirm the archive. Refresh Wallets and retry.'});
    }
  }
  if(url.pathname==='/api/rpc'&&req.method==='POST'){
    const data=await body(req,50000);if(!allowedRpc.has(data.method)||Array.isArray(data))throw Error('This RPC method is not allowed.');
    const result=await requestJson(rpc,{jsonrpc:'2.0',id:data.id,method:data.method,params:data.params||[]});
    // Never return provider URLs or credentials embedded in RPC errors.
    if(result.error)result.error={code:result.error.code||-32000,message:'Solana RPC request failed. Check the RPC provider or retry.'};
    return respond(res,200,result);
  }
  if(url.pathname==='/api/tip-accounts'&&req.method==='GET')return respond(res,200,{accounts:await jitoCall('getTipAccounts',[])});
  if(url.pathname==='/api/creator-fees'&&req.method==='POST'){
    const data=await body(req,2500);validateCreatorFeeUpdate(data.transaction);
    const result=await requestJson(rpc,{jsonrpc:'2.0',id:1,method:'sendTransaction',params:[data.transaction,{encoding:'base64',skipPreflight:false,preflightCommitment:'confirmed',maxRetries:2}]});
    if(result.error||typeof result.result!=='string')throw Error('Solana RPC did not confirm submission of the creator-fee update.');
    return respond(res,200,{signature:result.result});
  }
  if(url.pathname==='/api/bundle'&&req.method==='POST'){
    const data=await body(req);validateBundle(data.transactions);
    return respond(res,200,{bundleId:await jitoCall('sendBundle',[data.transactions,{encoding:'base64'}])});
  }
  if(url.pathname==='/api/bundle-status'&&req.method==='GET'){
    const id=url.searchParams.get('id');if(!id||!/^[a-fA-F0-9]{64}$/.test(id))throw Error('Invalid bundle ID.');
    const [inflight,confirmed]=await Promise.allSettled([jitoCall('getInflightBundleStatuses',[[id]]),jitoCall('getBundleStatuses',[[id]])]);
    return respond(res,200,{inflight:inflight.status==='fulfilled'?inflight.value:null,confirmed:confirmed.status==='fulfilled'?confirmed.value:null});
  }
  if(url.pathname==='/api/metadata'&&req.method==='POST'){
    const metadata=metadataCheck(await body(req));return respond(res,200,await pin('pinJSONToIPFS',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pinataContent:metadata,pinataOptions:{cidVersion:1}})}));
  }
  if(url.pathname==='/api/image'&&req.method==='POST'){
    const data=await body(req,4300000),bytes=Buffer.from(data.base64||'','base64');
    const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255,webp=bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
    if(bytes.length>limits.imageBytes||!bytes.length||!(png||jpeg||webp))throw Error('Choose a PNG, JPEG or WebP image up to 3 MiB.');
    const form=new FormData();form.append('file',new Blob([bytes],{type:png?'image/png':jpeg?'image/jpeg':'image/webp'}),`token.${png?'png':jpeg?'jpg':'webp'}`);form.append('pinataOptions',JSON.stringify({cidVersion:1}));
    return respond(res,200,await pin('pinFileToIPFS',{method:'POST',body:form}));
  }
  return respond(res,404,{error:'API route not found.'});
}
export async function start(){
  const dev=process.argv.includes('--dev');const vite=dev?await(await import('vite')).createServer({root,server:{middlewareMode:true},appType:'spa'}):null;
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url||'/','http://127.0.0.1');
    try{
      if(url.pathname.startsWith('/api/'))return await handleApi(req,res);
      if(vite)return vite.middlewares(req,res);
      const dist=resolve(root,'dist'),candidate=resolve(dist,'.'+decodeURIComponent(url.pathname));
      if(candidate!==dist&&!candidate.startsWith(dist+sep))return respond(res,403,{error:'Invalid path.'});
      let file=candidate;try{if(!(await stat(file)).isFile())file=resolve(dist,'index.html');}catch{file=resolve(dist,'index.html');}
      const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
      res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});res.end(await readFile(file));
    }catch(error){respond(res,400,{error:error instanceof Error?error.message.replace(/https?:\/\/\S+/g,'[service]'):'Request failed.'});}
  });
  const port=Number(process.env.PORT||5188);server.listen(port,'127.0.0.1',()=>console.log(`rapelaunch ready at http://127.0.0.1:${port}`));return server;
}
export async function handleApi(req,res,route){
  try{
    const url=new URL(req.url||'/','http://127.0.0.1');
    if(route!==undefined){
      if(typeof route!=='string'||!/^[a-z-]+$/.test(route))return respond(res,404,{error:'API route not found.'});
      url.pathname=`/api/${route}`;url.searchParams.delete('__api');
    }
    return await api(req,res,url);
  }catch(error){return respond(res,400,{error:error instanceof Error?error.message.replace(/https?:\/\/\S+/g,'[service]'):'Request failed.'});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await start();
