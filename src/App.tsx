import {cloneElement,useEffect,useId,useRef,useState,type FormEvent,type MouseEvent,type ReactElement} from 'react';
import {PublicKey} from '@solana/web3.js';
import {api,connection} from './lib/api';
import {JITO_TIP,SOLD,SUPPLY,POOL_SUPPLY,readConfig,parseSol,formatSol,openingFdv,migrationFdv,quoteBuyers,transactionSize,type Buyer,type Config} from './lib/launchlab';
import {VAULT_KEY,unseal,walletFromSecret,type LocalWallet,type SealedVault} from './lib/vault';
import type {PrivyWallets} from './Root';
import Docs from './Docs';
import WalletSelect from './WalletSelect';
import {applyCreatorFeeUpdate} from './lib/creator-fees';
import {descriptionError,limits,socialUrlError,tickerError,tokenNameError} from '../shared/form-rules.mjs';
import {prepare,signReview,recordFor,refreshRecord,activeRecord,awaitingLaunchConfirmation,loadHistory,HISTORY_KEY,type Review,type LaunchRecord} from './lib/launch';

const short=(address:string)=>address?`${address.slice(0,5)}…${address.slice(-5)}`:'Not connected';
const message=(error:unknown)=>error instanceof Error?error.message:'Something went wrong. Retry the action.';
const stageLabel=(stage:string)=>({'migration-pending':'Migration pending',migrated:'Migrated',curve:'Curve open',submitted:'Awaiting confirmation',failed:'Not landed'}[stage]||stage);
function Field({label,children,hint,error}:{label:string;children:ReactElement<{id?:string;'aria-describedby'?:string;'aria-invalid'?:boolean}>;hint?:string;error?:string}){
  const id=useId();
  return <div className="field">
    <label htmlFor={id}>{label}</label>
    {cloneElement(children,{id,'aria-invalid':error?true:undefined,'aria-describedby':[hint?`${id}-hint`:'',error?`${id}-error`:''].filter(Boolean).join(' ')||undefined})}
    {hint&&<small id={`${id}-hint`}>{hint}</small>}
    {error&&<small id={`${id}-error`} className="field-error" role="alert">{error}</small>}
  </div>;
}

function solError(value:string, optional=false){
  if(optional&&!value.trim())return '';
  try {
    const amount=parseSol(value);
    if(!optional&&amount===0n)return 'Enter an amount greater than zero.';
    return '';
  } catch(error) { return message(error); }
}
function Brand({onClick}:{onClick:(event:MouseEvent<HTMLAnchorElement>)=>void}){
  return <a className="brand" href="/launch" onClick={onClick} aria-label="rayxento home, create a token">
    <img src="/rayxento-logo.png" alt="" width="30" height="30"/>
    <span>rayxento</span>
  </a>;
}

const supplyShare = new Intl.NumberFormat('en-US',{style:'percent',maximumFractionDigits:0});
const tokenCount = new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:0});
const marketCap = new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',minimumFractionDigits:0,maximumFractionDigits:1});
const formatTokenAmount = (amount:bigint) => tokenCount.format(Number(amount)/1_000_000);

function LaunchParameters({config,loading}:{config:Config|null;loading:boolean}){
  const poolSupply=POOL_SUPPLY;
  const unavailable=loading?'Checking Raydium…':'Raydium config unavailable';
  const [solUsd,setSolUsd]=useState<number|null|undefined>();
  useEffect(()=>{
    let active=true;
    async function refreshPrice(){
      try{
        const {usd}=await api<{usd:number}>('sol-price');
        if(active)setSolUsd(usd);
      }catch{
        if(active)setSolUsd(null);
      }
    }
    void refreshPrice();
    const timer=window.setInterval(refreshPrice,60_000);
    return()=>{active=false;window.clearInterval(timer);};
  },[]);
  const cap=config&&solUsd?marketCap.format(Number(openingFdv(config))/1e9*solUsd):'—';
  const migrationCap=config&&solUsd?marketCap.format(Number(migrationFdv(config))/1e9*solUsd):'—';
  const quoteStatus=solUsd===null?'SOL/USD price unavailable':'Checking SOL/USD…';
  return <dl className="launch-parameters" aria-label="Launch parameters">
    <div>
      <dt>Sold on the curve</dt>
      <dd>{supplyShare.format(Number(SOLD)/Number(SUPPLY))}</dd>
      <dd className="parameter-detail">{formatTokenAmount(SOLD)} tokens available to buy</dd>
    </div>
    <div>
      <dt>Reserved for the Raydium pool</dt>
      <dd>{supplyShare.format(Number(poolSupply)/Number(SUPPLY))}</dd>
      <dd className="parameter-detail">{formatTokenAmount(poolSupply)} tokens seed liquidity at migration</dd>
    </div>
    <div>
      <dt>Starting market cap</dt>
      <dd>{cap}</dd>
      <dd className="parameter-detail">{!config?unavailable:solUsd?`Before any buys, based on ${formatTokenAmount(SUPPLY)} tokens`:quoteStatus}</dd>
    </div>
    <div>
      <dt>Migration market cap</dt>
      <dd>{migrationCap}</dd>
      <dd className="parameter-detail">{!config?unavailable:solUsd?'Estimated at migration':quoteStatus}</dd>
    </div>
    <div className="parameter-fees">
      <dt>Trading fees</dt>
      <dd><strong>Creator: 0.5% before &amp; after migration.</strong> Dev net: 0.5% / 0.475%.{config&&<> Total: {Number(config.feeRate)/10000}% before / {Number(config.postMigrationFeeRate||0n)/10000}% after.</>}</dd>
    </div>
  </dl>;
}

const navigation = [
  {id:'launch', label:'Launch token', shortLabel:'Launch'},
  {id:'wallets', label:'Wallets', shortLabel:'Wallets'},
  {id:'activity', label:'Activity', shortLabel:'Activity'},
  {id:'docs', label:'Documentation', shortLabel:'Docs'},
] as const;

type View = (typeof navigation)[number]['id'];
const viewPath = (view:View) => `/${view}`;
function currentView():View {
  const path=window.location.pathname.replace(/\/+$/,'');
  return navigation.find(item=>viewPath(item.id)===path)?.id ?? 'launch';
}

export default function App({privy}: {privy?: PrivyWallets}){
  const [view,setCurrentView]=useState(currentView);
  function setView(next:View){
    if(window.location.pathname!==viewPath(next))window.history.pushState(null,'',viewPath(next));
    setCurrentView(next);
  }
  function followTab(event:MouseEvent<HTMLAnchorElement>,next:View){
    if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();
    setView(next);
  }
  const [config,setConfig]=useState<Config|null>(null),[configError,setConfigError]=useState(''),[loadingConfig,setLoadingConfig]=useState(false);
  const configRequest=useRef(0);
  const [hosting,setHosting]=useState(false),[name,setName]=useState(''),[symbol,setSymbol]=useState(''),[description,setDescription]=useState(''),[website,setWebsite]=useState(''),[twitter,setTwitter]=useState(''),[image,setImage]=useState(''),[preview,setPreview]=useState(''),[uploading,setUploading]=useState(false);
  const [localWallets,setLocalWallets]=useState<LocalWallet[]>([]);
  const [legacyVault,setLegacyVault]=useState(() => localStorage.getItem(VAULT_KEY));
  const [password,setPassword]=useState('');
  const [walletName,setWalletName]=useState('');
  const privateKeyField=useRef<HTMLInputElement>(null);
  const [walletBusy,setWalletBusy]=useState(false);
  const [walletError,setWalletError]=useState('');
  const [walletNotice,setWalletNotice]=useState('');
  const [walletNameError,setWalletNameError]=useState('');
  const [privateKeyError,setPrivateKeyError]=useState('');
  const [backupError,setBackupError]=useState('');
  const [backupPasswordError,setBackupPasswordError]=useState('');
  const [imageError,setImageError]=useState('');
  const [checkedFields,setCheckedFields]=useState<Record<string,boolean>>({});
  const [reviewAttempted,setReviewAttempted]=useState(false);
  const [archiveAddress,setArchiveAddress]=useState('');
  const walletOperation=useRef(false);
  const wallets=privy?.wallets;
  const [dev,setDev]=useState(''),[buyers,setBuyers]=useState<string[]>(Array(6).fill('')),[budgets,setBudgets]=useState<string[]>(Array(7).fill(''));
  const [balances,setBalances]=useState<Record<string,string>>({});
  const [review,setReview]=useState<Review|null>(null),[busy,setBusy]=useState(false),[progress,setProgress]=useState('');
  const [pageErrors,setPageErrors]=useState<Partial<Record<View,string>>>({});
  const [feeUpdateSignature,setFeeUpdateSignature]=useState('');
  const error=pageErrors[view]||'';
  function setError(value:string,target:View='launch'){setPageErrors(current=>({...current,[target]:value}));}
  const [history,setHistory]=useState<LaunchRecord[]>(loadHistory),[refreshing,setRefreshing]=useState(false),[copied,setCopied]=useState('');
  const mintReview=useRef<Review|null>(null),metadataCache=useRef<{key:string;uri:string}|null>(null),refreshLock=useRef(false);
  const count=(dev?1:0)+buyers.filter(Boolean).length,blocked=history.some(awaitingLaunchConfirmation);
  const devAddress=wallets?.find(wallet=>wallet.id===dev)?.address || '';
  const fieldErrors={
    name:tokenNameError(name), symbol:tickerError(symbol), description:descriptionError(description),
    website:socialUrlError(website), twitter:socialUrlError(twitter,true),
    dev:devAddress?'':'Select a developer wallet from Wallets.',
  };
  const budgetErrors=budgets.map((value,index)=>index===0||buyers[index-1]?solError(value,index===0):'');
  const checkField=(id:string)=>setCheckedFields(current=>current[id]?current:{...current,[id]:true});
  const visibleError=(id:string,value:string)=>reviewAttempted||checkedFields[id]?value:'';

  async function getConfig(){
    const request=++configRequest.current;setLoadingConfig(true);setConfig(null);setConfigError('');
    try{const next=await readConfig(connection,devAddress?new PublicKey(devAddress):undefined);if(request===configRequest.current)setConfig(next);}
    catch(e){if(request===configRequest.current)setConfigError(message(e));}
    finally{if(request===configRequest.current)setLoadingConfig(false);}
  }
  useEffect(()=>{setFeeUpdateSignature('');void getConfig();return()=>{configRequest.current++;};},[devAddress]);
  useEffect(()=>{api<{pinataConfigured:boolean}>('health').then(h=>setHosting(h.pinataConfigured)).catch(()=>{});},[]);
  useEffect(()=>{
    const syncView=()=>setCurrentView(currentView());
    if(window.location.pathname==='/')window.history.replaceState(null,'',`/launch${window.location.search}${window.location.hash}`);
    window.addEventListener('popstate',syncView);
    return()=>window.removeEventListener('popstate',syncView);
  },[]);
  useEffect(()=>{window.scrollTo({top:0,behavior:'instant'});},[view]);
  useEffect(()=>{const listener=(event:StorageEvent)=>{if(event.key===HISTORY_KEY)setHistory(loadHistory());};window.addEventListener('storage',listener);return()=>window.removeEventListener('storage',listener);},[]);
  useEffect(()=>{localStorage.setItem(HISTORY_KEY,JSON.stringify(history));},[history]);
  useEffect(()=>{setReview(null);mintReview.current=null;setError('');},[name,symbol,description,website,twitter,image,config,dev,buyers,budgets,devAddress]);
  useEffect(()=>{return()=>{if(preview.startsWith('blob:'))URL.revokeObjectURL(preview);};},[preview]);
  async function refreshHistory(){
    if(refreshLock.current)return;refreshLock.current=true;setRefreshing(true);
    try{const results=await Promise.all(history.map(async record=>{try{return await refreshRecord(record);}catch(e){return {...record,detail:`Status check: ${message(e)}`};}}));
      setHistory(current=>current.map(record=>results.find(r=>r.mint===record.mint)||record));
    }finally{refreshLock.current=false;setRefreshing(false);}
  }
  useEffect(()=>{if(!history.some(activeRecord))return;const timer=setInterval(()=>void refreshHistory(),12000);return()=>clearInterval(timer);},[history]);
  useEffect(()=>{
    const addresses=[devAddress,...buyers.map(id=>wallets?.find(w=>w.id===id)?.address||'')].filter(Boolean);if(!addresses.length)return;
    let cancelled=false;connection.getMultipleAccountsInfo(addresses.map(a=>new PublicKey(a))).then(infos=>{if(!cancelled)setBalances(Object.fromEntries(addresses.map((a,i)=>[a,formatSol(BigInt(infos[i]?.lamports||0),5)])));}).catch(()=>{});return()=>{cancelled=true;};
  },[devAddress,buyers,wallets]);
  useEffect(()=>{const listener=()=>{if(document.visibilityState==='visible')void refreshHistory();};document.addEventListener('visibilitychange',listener);return()=>document.removeEventListener('visibilitychange',listener);},[history]);

  let totalBudget=0n,estimateError='';
  try{totalBudget=budgets.reduce((sum,v,i)=>sum+((i===0||buyers[i-1])&&v.trim()?parseSol(v):0n),0n);}catch(e){estimateError=message(e);}
  const lookup=(id:string)=>wallets?.find(w=>w.id===id);
  function chooseBuyer(i:number,id:string){setBuyers(current=>current.map((value,index)=>index===i?id:value));}
  function chooseDev(id:string){setDev(id);setBuyers(current=>current.map(b=>b===id?'':b));}
  function budget(index:number,value:string){setBudgets(values=>values.map((v,i)=>i===index?value:v));}
  function archiveWallet(wallet: {id: string; address: string; name: string}) {
    if (!privy?.archiveEnabled) return;
    void runWalletOperation(async () => {
      await privy.archiveWallet(wallet.address);
      if (dev===wallet.id) setDev('');
      setBuyers(current=>current.map(id=>id===wallet.id?'':id));
      setBudgets(current=>current.map((value,index)=>(index===0 ? dev : buyers[index-1])===wallet.id?'':value));
      setReview(null);
      mintReview.current=null;
      setArchiveAddress('');
      setWalletNotice(`${wallet.name} archived in Privy.`);
    });
  }
  async function runWalletOperation(action: () => Promise<void>){
    if(walletOperation.current || busy) return;
    walletOperation.current=true;
    setWalletBusy(true);
    setWalletError('');
    setWalletNotice('');
    try { await action(); }
    catch (error) { setWalletError(message(error)); }
    finally { walletOperation.current=false; setWalletBusy(false); }
  }

  function signOutOfPrivy(){
    if(!privy?.authenticated||walletOperation.current||busy)return;
    setView('wallets');
    return runWalletOperation(async()=>{
      await privy.logout();
      setDev('');
      setBuyers(Array(6).fill(''));
      setWalletName('');
      setLocalWallets([]);
      setPassword('');
      setReview(null);
      mintReview.current=null;
      if(privateKeyField.current)privateKeyField.current.value='';
    });
  }

  function unlockSavedWallets(event:FormEvent){
    event.preventDefault();
    if(!legacyVault) return;
    setBackupPasswordError('');
    if(password.length<10){setBackupPasswordError('Enter the original password, at least 10 characters.');return;}
    void runWalletOperation(async () => {
      try {setLocalWallets(await unseal(JSON.parse(legacyVault),password));}
      catch {setBackupPasswordError('The password could not unlock this backup.');return;}
      setPassword('');
      setWalletNotice('Backup unlocked. Choose a saved wallet to import into Privy.');
    });
  }

  async function restoreBackup(file:File){
    setBackupError('');
    setBackupPasswordError('');
    if(file.size>limits.backupBytes){setBackupError('Choose a backup up to 150 KB.');return;}
    await runWalletOperation(async () => {
      let value:SealedVault;
      try {value=JSON.parse(await file.text());}
      catch {setBackupError('Choose a valid encrypted backup JSON file.');return;}
      if(value?.version!==1||typeof value.data!=='string'||typeof value.iv!=='string'||typeof value.salt!=='string'){setBackupError('Choose a rayxento encrypted wallet backup.');return;}
      setLocalWallets([]);
      setLegacyVault(JSON.stringify(value));
      setWalletNotice('Backup loaded. Enter its original password to use the saved wallets.');
    });
  }

  async function importWallet(wallet: LocalWallet){
    if(!privy?.authenticated || !privy.ready) throw Error('Sign in to Privy to add a wallet.');
    if(privy.wallets.some(entry=>entry.address===wallet.address)) throw Error('This address is already in your Privy account.');
    let importedAddress: string;
    try {
      importedAddress=await privy.importKey(wallet.secret);
    } catch {
      throw Error('Privy could not finish the import. Check your wallet list before retrying.');
    }
    if(importedAddress!==wallet.address) throw Error('Privy returned a different wallet address. Check your wallet list.');
    const saved=privy.saveName(wallet.address,wallet.name);
    setLocalWallets(current=>current.filter(entry=>entry.address!==wallet.address));
    setWalletNotice(saved?`Added ${wallet.name}.`:'Wallet added. The browser could not save its name beyond this session.');
  }

  function addWallet(event: FormEvent<HTMLFormElement>){
    event.preventDefault();
    const keyInput=privateKeyField.current;
    if(!privy?.authenticated || !privy.ready || !keyInput || walletOperation.current || busy) return;
    const nameError=!walletName.trim()||walletName.trim().length>limits.walletName?'Enter a wallet name from 1 to 40 characters.':'';
    setWalletNameError(nameError);
    setPrivateKeyError('');
    if(nameError)return;
    const privateKey=keyInput.value.trim();
    if(!privateKey){setPrivateKeyError('Enter a Solana private key.');return;}
    let wallet:LocalWallet;
    try {wallet=walletFromSecret(walletName,privateKey);}
    catch(error){setPrivateKeyError(message(error));return;}
    if(wallets?.some(entry=>entry.address===wallet.address)){setPrivateKeyError('This address is already in your Privy account.');return;}
    keyInput.value='';
    void runWalletOperation(async () => {
      await importWallet(wallet);
      setWalletName('');
    });
  }
  async function upload(file:File){
    setImageError('');
    if(!file.size||file.size>limits.imageBytes||!['image/png','image/jpeg','image/webp'].includes(file.type)){
      setImageError('Choose a PNG, JPEG or WebP image up to 3 MiB.');return;
    }
    setUploading(true);
    try {
      const bytes=new Uint8Array(await file.arrayBuffer());
      let binary='';
      for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
      const result=await api<{uri:string}>('image',{base64:btoa(binary)},await privy?.getAccessToken()||undefined);
      setImage(result.uri);
      setPreview(URL.createObjectURL(file));
    } catch(error){setImageError(message(error));}
    finally{setUploading(false);}
  }
  function getBuyers():Buyer[]{if(!devAddress)throw Error('Choose a developer wallet from Wallets.');return [{address:devAddress,budget:budgets[0].trim()?parseSol(budgets[0]):0n,label:'Dev wallet'},...buyers.flatMap((id,i)=>{if(!id)return [];const wallet=lookup(id);if(!wallet)throw Error('Sign in to Privy to use the selected buyers.');if(!budgets[i+1].trim())throw Error(`Enter a purchase budget for Buyer ${i+1}.`);return [{address:wallet.address,budget:parseSol(budgets[i+1]),label:`Buyer ${i+1}`}];})];}
  async function reviewLaunch(event?:FormEvent){event?.preventDefault();if(busy||blocked||uploading||walletOperation.current)return;
    setReviewAttempted(true);
    if(Object.values(fieldErrors).some(Boolean)||budgetErrors.some(Boolean)){
      setError('Check the highlighted fields before reviewing the launch.');return;
    }
    setError('');setBusy(true);setProgress('Checking launch details…');setReview(null);try{
    if(!config)throw Error('Load a verified Raydium configuration first.');
    const roster=getBuyers();quoteBuyers(roster,config.minimum,config);
    if(!hosting)throw Error('Pinata must be configured to publish token metadata.');
    const metadata={name:name.trim(),symbol,description,image,website:website.trim(),twitter:twitter.trim()};
    const key=JSON.stringify(metadata);
    if(metadataCache.current?.key!==key){
      setProgress('Publishing token metadata…');
      const result=await api<{uri:string}>('metadata',metadata,await privy?.getAccessToken()||undefined);
      metadataCache.current={key,uri:result.uri};
    }
    const metadataUri=metadataCache.current.uri;
    const next=await prepare({dev:devAddress,name:name.trim(),symbol,uri:metadataUri,configFingerprint:config.fingerprint,buyers:roster,onProgress:setProgress});mintReview.current=next;setReview(next);setProgress('Review ready. Check the amounts before signing.');
  }catch(e){setError(message(e));setProgress('');}finally{setBusy(false);}}
  async function updateCreatorFees(){
    if(busy||walletBusy||blocked||!devAddress||!config?.updatesPlatform)return;
    const sign=privy?.signers.get(devAddress);
    if(!sign){setError('Sign in to Privy to update this developer wallet.');return;}
    await navigator.locks.request('zeroblock-launch',{ifAvailable:true},async lock=>{
      if(!lock){setError('A wallet operation is running in another tab. Finish it there first.');return;}
      setBusy(true);setError('');setReview(null);mintReview.current=null;
      try{const next=await applyCreatorFeeUpdate(devAddress,sign,setProgress,setFeeUpdateSignature);setConfig(next);setProgress('Creator fees updated: 0.5% creator fee and 0% platform fee.');}
      catch(e){setError(message(e));setProgress('');}
      finally{setBusy(false);}
    });
  }
  async function launch(){await navigator.locks.request('zeroblock-launch',{ifAvailable:true},async lock=>{if(!lock){setError('A launch is being signed in another tab. Finish it there before continuing.');return;}await launchInternal();});}
  async function launchInternal(){if(!review||review!==mintReview.current||busy||blocked||walletOperation.current)return;setBusy(true);setError('');setProgress('Signing the reviewed bundle…');let record:LaunchRecord|null=null;
    try{if(loadHistory().some(awaitingLaunchConfirmation))throw Error('Another launch is awaiting confirmation. Check Activity before signing.');const currentBuyers=getBuyers();if(currentBuyers.some((buyer,i)=>buyer.address!==review.plan.quotes[i]?.address)||currentBuyers.length!==review.plan.quotes.length)throw Error('The selected wallets changed. Review the launch again.');if(!privy?.authenticated)throw Error('Sign in to Privy before signing.');const signed=await signReview(review,privy.signers);record=recordFor(review,signed,name.trim(),symbol);
      // Persist public recovery information before making a submission request.
      const records=[record,...loadHistory()].slice(0,100);localStorage.setItem(HISTORY_KEY,JSON.stringify(records));setHistory(records);setProgress('Submitting one atomic bundle to Jito…');
      const result=await api<{bundleId:string}>('bundle',{transactions:signed.map(tx=>tx.serialize().toString('base64'))});
      record={...record,bundleId:result.bundleId,detail:'Jito accepted the bundle request. On-chain confirmation is pending.'};localStorage.setItem(HISTORY_KEY,JSON.stringify([record,...records.filter(r=>r.mint!==record!.mint)]));setHistory(current=>current.map(r=>r.mint===record!.mint?record!:r));setView('activity');setProgress('Bundle submitted. Tracking the launch on-chain.');setReview(null);mintReview.current=null;
      try{const next=await refreshRecord(record);setHistory(current=>current.map(r=>r.mint===next.mint?next:r));}catch{}
    }catch(e){if(record){const detail=`Submission outcome is not confirmed: ${message(e)}. The mint is saved; check its status before another launch.`;setHistory(current=>current.map(r=>r.mint===record!.mint?{...r,detail}:r));setView('activity');setError(detail,'activity');}else setError(message(e));setProgress('');}finally{setBusy(false);}
  }
  async function copy(value:string){try{await navigator.clipboard.writeText(value);setCopied(value);setTimeout(()=>setCopied(''),1600);}catch{setError('Clipboard access is unavailable. Select and copy the address manually.',view);}}
  const launchDisabled=busy||walletBusy||uploading||!config||!!config.updatesPlatform||blocked;
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand-links">
        <Brand onClick={event=>followTab(event,'launch')}/>
        <a className="brand-social" href="https://x.com/rayxento" target="_blank" rel="noreferrer" aria-label="rayxento on X" title="@rayxento">
          <img src="/x-logo.svg" alt="" width="14" height="14"/>
          <span>@rayxento</span>
        </a>
      </div>
      <nav aria-label="Main navigation">
        {navigation.map(item => <a
          key={item.id}
          aria-label={item.label}
          aria-current={view===item.id?'page':undefined}
          className={view===item.id?'nav-item selected':'nav-item'}
          href={viewPath(item.id)}
          onClick={event=>followTab(event,item.id)}
        >
          <span className="nav-label">{item.label}</span>
          <span className="nav-label-compact">{item.shortLabel}</span>
          {item.id==='activity'&&history.length>0&&<b>{history.length}</b>}
        </a>)}
      </nav>
      <div className="sidebar-note">
        <a href="https://docs.raydium.io/user-flows/creating-a-launchlab-token" target="_blank" rel="noreferrer">How migration works</a>
      </div>
      <div className="network">
        <img className="network-logo" src="/solana-logo.svg" alt="" width="24" height="21"/>
        <span>Solana mainnet</span>
      </div>
    </aside>
    <main><header className="topbar"><span className="breadcrumb">Workspace / <strong>{view==='launch'?'New launch':navigation.find(item=>item.id===view)?.label}</strong></span><div className="topbar-actions"><button className="wallet-pill" onClick={()=>setView('wallets')}>{devAddress?short(devAddress):'Manage wallets'}</button>{privy?.authenticated&&<button type="button" className="wallet-pill" disabled={busy||walletBusy} onClick={()=>void signOutOfPrivy()}>Sign out of Privy</button>}</div></header>
      <div className="workspace">
        <div className={view==='launch'?'page-heading launch-heading':view==='docs'?'page-heading docs-heading':'page-heading'}>
          <div>
            <h1>{view==='launch'?'Launch a token':view==='docs'?'Documentation':view==='wallets'?<>Your wallets.<br/>Your launch.</>:<>Every launch.<br/>On the record.</>}</h1>
            <p>{view==='launch'
              ? 'Launch on Raydium with no developer token allocation. The dev wallet and up to six additional wallets can buy in one bundle. All initial buys are optional.'
              : view==='docs'?'How launches, token supply, wallets and migration work on rayxento.'
              : view==='wallets'?'Choose a developer wallet and prepare up to six first-block buyers.':'Follow the bundle, the curve and the real migration state.'}</p>
          </div>
          <div className="protocol-tag"><img src="/raydium-logo.svg" alt="" width="29" height="33"/><span>Raydium LaunchLab</span></div>
        </div>
        {view==='launch'&&<LaunchParameters config={config} loading={loadingConfig}/>}
        {error&&<div className="alert error" role="alert"><span>{error}</span><button onClick={()=>setError('',view)}>Dismiss</button></div>}
        {(view==='launch'||view==='docs')&&configError&&<div className="alert error" role="alert"><span>Could not verify mainnet settings: {configError}</span><button onClick={()=>void getConfig()}>Retry</button></div>}
        {view==='docs'&&<Docs config={config} loading={loadingConfig}/>}
        {view==='launch'&&<div className="launch-grid"><form className="launch-form" onSubmit={reviewLaunch} noValidate><fieldset disabled={busy||walletBusy}>
          <section className="form-section">
            <div className="section-heading"><h2>Token identity</h2></div>
            <div className="identity-grid">
              <div className="image-field">
                <label className={`image-upload ${preview?'has-image':''}`}>
                  <input type="file" aria-label="Token image" aria-describedby={imageError?'image-rules image-error':'image-rules'} aria-invalid={!!imageError} accept="image/png,image/jpeg,image/webp" disabled={!hosting||uploading} onChange={event=>{
                    const file=event.target.files?.[0];
                    if(file)void upload(file);
                    event.target.value='';
                  }}/>
                  {preview?<img src={preview} alt="Token artwork"/>:uploading?<strong role="status">Uploading image…</strong>:<strong>Upload token image</strong>}
                </label>
                <small id="image-rules" className="field-hint">{hosting?'Optional. PNG, JPEG or WebP, up to 3 MiB.':'Image upload unavailable. Pinata is not configured.'}</small>
                {imageError&&<small id="image-error" className="field-error" role="alert">{imageError}</small>}
              </div>
              <div className="identity-fields">
                <Field label="Token name" hint="Required." error={visibleError('name',fieldErrors.name)}>
                  <input value={name} onChange={event=>setName(event.target.value)} onBlur={()=>checkField('name')} placeholder="Token name" maxLength={limits.tokenName} autoComplete="off" required/>
                </Field>
                <Field label="Ticker" hint="1–10 characters. A–Z, 0–9." error={visibleError('symbol',fieldErrors.symbol)}>
                  <input value={symbol} onChange={event=>setSymbol(event.target.value.toUpperCase())} onBlur={()=>checkField('symbol')} placeholder="TICKER" maxLength={limits.ticker} autoComplete="off" required/>
                </Field>
              </div>
            </div>
            <Field label="Description" hint={`Optional. ${description.length}/2,000 characters.`} error={visibleError('description',fieldErrors.description)}>
              <textarea value={description} onChange={event=>setDescription(event.target.value)} onBlur={()=>checkField('description')} placeholder="What is your token about?" maxLength={limits.description} rows={2}/>
            </Field>
            <div className="social-fields">
                <Field label="Website" hint="Optional. HTTPS, max 300 characters." error={visibleError('website',fieldErrors.website)}>
                  <input type="url" value={website} onChange={event=>setWebsite(event.target.value)} onBlur={()=>checkField('website')} placeholder="https://your-token.com" maxLength={limits.socialUrl}/>
                </Field>
                <Field label="X / Twitter" hint="Optional. x.com or twitter.com link." error={visibleError('twitter',fieldErrors.twitter)}>
                  <input type="url" value={twitter} onChange={event=>setTwitter(event.target.value)} onBlur={()=>checkField('twitter')} placeholder="https://x.com/your-token" maxLength={limits.socialUrl}/>
                </Field>
            </div>
            {image&&<p className="success-text">Image uploaded to IPFS</p>}
          </section>
          <section className="form-section buyer-section">
            <div className="section-heading">
              <div><h2>First-block buyers</h2><p>One developer wallet and up to six distinct buyers.</p></div>
              <button className="text-button" type="button" onClick={()=>setView('wallets')}>Manage wallets</button>
            </div>
            <p className="field-note budget-rules" id="budget-rules">SOL, up to 9 decimals. Dev buy is optional.</p>
            <div className="roster-labels"><span>Wallet</span><span>Buy budget / SOL</span></div>
            <div className="buyer-row dev-row">
              <span className="buyer-order">D</span>
              <div className="buyer-wallet">
                <label className="sr-only" htmlFor="dev-wallet">Developer wallet</label>
                <WalletSelect id="dev-wallet" label="Developer wallet" value={dev} wallets={wallets||[]} placeholder="Select developer wallet" onChange={chooseDev} onBlur={()=>checkField('dev')} describedBy={visibleError('dev',fieldErrors.dev)?'dev-rule dev-error':'dev-rule'} invalid={!!visibleError('dev',fieldErrors.dev)} required disabled={busy||walletBusy}/>
                <small id="dev-rule">{devAddress?`${short(devAddress)} · ${balances[devAddress]??'…'} SOL available`:'Required. Choose one wallet from Wallets.'}</small>
                {visibleError('dev',fieldErrors.dev)&&<small id="dev-error" className="field-error" role="alert">{fieldErrors.dev}</small>}
              </div>
              <div className="buyer-budget">
                <input aria-label="Developer buy budget in SOL (optional)" placeholder="Optional" inputMode="decimal" value={budgets[0]} onChange={event=>budget(0,event.target.value)} onBlur={()=>checkField('budget-0')} aria-invalid={!!visibleError('budget-0',budgetErrors[0])} aria-describedby={visibleError('budget-0',budgetErrors[0])?'budget-rules budget-error-0':'budget-rules'}/>
                {visibleError('budget-0',budgetErrors[0])&&<small id="budget-error-0" className="field-error" role="alert">{budgetErrors[0]}</small>}
              </div>
            </div>
            {buyers.map((id,i)=>{
              const wallet=lookup(id);
              const index=i+1;
              const budgetError=visibleError(`budget-${index}`,budgetErrors[index]);
              return <div key={i} className={`buyer-row ${id?'':'empty'}`}>
                <span className="buyer-order">{index}</span>
                <div className="buyer-wallet">
                  <label className="sr-only" htmlFor={`buyer-${i}`}>Buyer {index}</label>
                  <WalletSelect id={`buyer-${i}`} label={`Buyer ${index}`} value={id} wallets={wallets?.filter(wallet=>wallet.id===id||(wallet.id!==dev&&!buyers.includes(wallet.id)))||[]} placeholder={`Add buyer ${index} (optional)`} onChange={next=>chooseBuyer(i,next)} describedBy="buyer-wallet-rules" disabled={busy||walletBusy}/>
                  {wallet&&<small>{short(wallet.address)} · {balances[wallet.address]??'…'} SOL available</small>}
                </div>
                <div className="buyer-budget">
                  <input aria-label={`Buyer ${index} budget in SOL`} disabled={!id} required={!!id} inputMode="decimal" value={budgets[index]} onChange={event=>budget(index,event.target.value)} onBlur={()=>checkField(`budget-${index}`)} aria-invalid={!!budgetError} aria-describedby={budgetError?`budget-rules budget-error-${index}`:'budget-rules'}/>
                  {budgetError&&<small id={`budget-error-${index}`} className="field-error" role="alert">{budgetError}</small>}
                </div>
              </div>;
            })}
            <div className="roster-footer" id="buyer-wallet-rules">
              <span>{(devAddress?1:0)+buyers.filter(Boolean).length} / 7 wallets selected</span>
              <span>One role per wallet.</span>
            </div>
            <p className="field-note">Selected buyers share one atomic Jito bundle. Inclusion in the first block and protection from every competing bot are not guaranteed.</p>
          </section>
          </fieldset><button type="submit" className="mobile-review" disabled={launchDisabled}>Review launch</button></form>
          <aside className="launch-summary"><h2>Launch summary</h2><dl className="summary-breakdown"><div><dt>Net SOL from this launch</dt><dd>{review?formatSol(review.plan.quotes.reduce((sum,quote)=>sum+quote.net,0n),6)+' SOL':'—'}</dd></div><div><dt>Buyers</dt><dd>Dev + {buyers.filter(Boolean).length}</dd></div><div><dt>Purchase budgets (max)</dt><dd>{formatSol(totalBudget,5)} SOL</dd></div><div><dt>Temporary setup reserve</dt><dd>0.05 SOL</dd></div>{review&&<div><dt>Network fees</dt><dd>{formatSol(review.networkFee)} SOL</dd></div>}<div><dt>Dev fees, before / after</dt><dd>0.5% / 0.475% net</dd></div><div><dt>Jito tip per bundle</dt><dd>{formatSol(JITO_TIP)} SOL</dd></div></dl><p className="summary-note">The setup reserve is a balance allowance, not a fixed charge. Actual rent and fees are paid on-chain.</p>
            {config?.createsPlatform&&devAddress&&<p className="summary-note">First launch from this wallet includes one-time fee configuration rent.</p>}
            {config?.updatesPlatform&&devAddress&&<p className="summary-warning">Update this dev wallet to 0.5% creator fee, 0% platform fee. Its existing LaunchLab curves and future migrations also use the new settings. Already-migrated pools keep their tier. This is a separate transaction; no new token is created.</p>}
            {estimateError&&<p className="summary-warning">{estimateError}</p>}
            {blocked?<div className="pending-box"><p>A launch is awaiting confirmation.</p><button onClick={()=>setView('activity')}>View activity</button></div>:config?.updatesPlatform?<button className="primary-button" onClick={()=>void updateCreatorFees()} disabled={busy||walletBusy||!devAddress}>{busy?'Updating fees…':'Update creator fees'}</button>:review?<div className="review-box"><span className="review-check">Creation simulation passed</span><p>{review.plan.transactions.length} transactions · {count} buyers · one bundle</p><div className="packet-sizes">{review.plan.transactions.map((tx,i)=><span key={i}>Tx {i+1}: {transactionSize(tx)} B</span>)}</div><p>{review.simulation}</p><p className="mint-line">Mint: {short(review.plan.mint)}</p><button className="primary-button" onClick={()=>void launch()} disabled={busy||walletBusy}>{busy?'Signing bundle…':'Sign and send bundle'}</button><button className="summary-secondary" onClick={()=>void reviewLaunch()} disabled={busy||walletBusy}>Refresh review</button></div>:<button className="primary-button" onClick={()=>void reviewLaunch()} disabled={launchDisabled}>{busy?'Preparing review…':'Review launch'}</button>}
            {feeUpdateSignature&&<p className="summary-note"><a href={`https://solscan.io/tx/${feeUpdateSignature}`} target="_blank" rel="noreferrer">View fee update transaction</a> · <button className="text-button" disabled={busy} onClick={()=>void getConfig()}>Refresh settings</button></p>}
            {progress&&<p className="progress" role="status">{progress}</p>}<p className="indexer-note">“Migrated” requires a verified CPMM pool. Axiom and GMGN control their own badges and indexing.</p>
          </aside></div>}
        {view==='wallets'&&<div className="wallets-grid">
          <section className="wallet-security" aria-label="Wallet security with Privy">
            <a href="https://www.privy.io/" target="_blank" rel="noreferrer" aria-label="Visit Privy">
              <img className="wallet-security-logo" src="/privy-logo.svg" alt="Privy" width="81" height="18"/>
            </a>
            <p>Wallet imports and transaction signing are handled through Privy.</p>
            <a href="https://docs.privy.io/security/overview" target="_blank" rel="noreferrer">Security details</a>
          </section>
          <section className="wallet-vault">
            <div className="section-heading"><h2>Add wallet</h2></div>
            {walletError&&<div className="alert error" role="alert">{walletError}</div>}
            {walletNotice&&<p className="notice" role="status">{walletNotice}</p>}
            {!privy?.authenticated ? <div className="wallet-access">
              <p>Sign in with email to import your Solana wallets through Privy.</p>
              <button className="blue-button" onClick={()=>privy?.login()} disabled={!privy?.ready}>
                {privy?.ready?'Continue with email':privy?'Connecting to Privy…':'Privy is not configured'}
              </button>
            </div> : <form className="wallet-import-form" onSubmit={addWallet} method="post" noValidate>
              <Field label="Wallet name" hint="1–40 characters." error={walletNameError}>
                <input value={walletName} onChange={event=>{setWalletName(event.target.value);setWalletNameError('');}} placeholder="e.g. Dev wallet" maxLength={limits.walletName} autoComplete="off" required disabled={walletBusy||busy}/>
              </Field>
              <Field label="Private key" hint="Base58 or JSON keypair." error={privateKeyError}>
                <input ref={privateKeyField} type="password" placeholder="Paste Solana private key" onChange={()=>setPrivateKeyError('')} autoComplete="off" autoCapitalize="off" spellCheck={false} maxLength={limits.privateKeyInput} required disabled={walletBusy||busy}/>
              </Field>
              <button className="blue-button" disabled={!privy.ready||walletBusy||busy}>
                {walletBusy?'Working…':'Add wallet'}
              </button>
            </form>}
            <details className="advanced saved-wallets">
              <summary>Import from an old backup</summary>
              {legacyVault&&localWallets.length===0&&<form className="vault-unlock" onSubmit={unlockSavedWallets} noValidate>
                <Field label="Original backup password" hint="Min 10 characters." error={backupPasswordError}>
                  <input type="password" value={password} onChange={event=>{setPassword(event.target.value);setBackupPasswordError('');}} autoComplete="off" required disabled={walletBusy||busy}/>
                </Field>
                <button className="soft-button" disabled={walletBusy||busy}>Unlock backup</button>
              </form>}
              {localWallets.map(wallet=><div className="wallet-list-row" key={wallet.id}>
                <div>
                  <strong>{wallet.name}</strong>
                  <small>{short(wallet.address)}</small>
                </div>
                {wallets?.some(entry=>entry.address===wallet.address)
                  ? <span className="verified-label">In Privy</span>
                  : <button className="text-button" disabled={!privy?.authenticated||!privy.ready||walletBusy||busy} onClick={()=>void runWalletOperation(()=>importWallet(wallet))}>Import into Privy</button>}
              </div>)}
              <label className="backup-restore">Choose an encrypted backup
                <input type="file" aria-describedby={backupError?'backup-rules backup-error':'backup-rules'} aria-invalid={!!backupError} accept="application/json,.json" disabled={walletBusy||busy} onChange={event=>{
                  const file=event.target.files?.[0];
                  if(file)void restoreBackup(file);
                  event.target.value='';
                }}/>
              </label>
              <small id="backup-rules" className="field-hint">Encrypted rayxento JSON backup, up to 150 KB.</small>
              {backupError&&<small id="backup-error" className="field-error" role="alert">{backupError}</small>}
            </details>
          </section>
          <section className="wallet-vault">
            <div className="section-heading">
              <h2>My wallets</h2>
              {privy?.authenticated&&<button className="text-button" disabled={busy||walletBusy} onClick={()=>void signOutOfPrivy()}>Sign out</button>}
            </div>
            {wallets?.length ? <div className="wallet-list">
              {wallets.map(wallet=><div className="wallet-list-row" key={wallet.id}>
                <div className="wallet-list-identity">
                  <strong>{wallet.name}</strong>
                  <button className="address-copy" title="Copy wallet address" onClick={()=>void copy(wallet.address)}>
                    {short(wallet.address)} <span>{copied===wallet.address?'Copied':'Copy'}</span>
                  </button>
                </div>
                <div className="wallet-row-actions">
                  <button className="text-button" disabled={busy||walletBusy} onClick={()=>{chooseDev(wallet.id);setView('launch');}}>Use as dev</button>
                  <button className="text-button" disabled={busy||walletBusy} onClick={()=>void runWalletOperation(()=>privy!.exportKey(wallet.address))}>Export key</button>
                  {privy?.archiveEnabled&&<button className="text-button danger-text" disabled={busy||walletBusy} onClick={()=>setArchiveAddress(wallet.address)}>Remove</button>}
                </div>
                {archiveAddress===wallet.address&&<div className="wallet-archive-confirm">
                  <p>Archive {wallet.name} in Privy? It will no longer be able to sign. Export the key before archiving if you still need access.</p>
                  <button className="soft-button" disabled={busy||walletBusy} onClick={()=>setArchiveAddress('')}>Cancel</button>
                  <button className="soft-button danger-text" disabled={busy||walletBusy} onClick={()=>archiveWallet(wallet)}>{walletBusy?'Archiving…':'Archive in Privy'}</button>
                </div>}
              </div>)}
            </div> : <p className="muted">{privy?.authenticated?'Add a wallet to see it here.':'Sign in to view your Privy wallets.'}</p>}
            {privy?.authenticated&&!!wallets?.length&&!privy.archiveEnabled&&<p className="field-note">Wallet archiving requires Privy server configuration.</p>}
          </section>
        </div>}
        {view==='activity'&&<section className="activity-section"><div className="section-heading"><h2>Launch activity</h2><button className="text-button" onClick={()=>void refreshHistory()} disabled={refreshing||history.length===0}>{refreshing?'Refreshing…':'Refresh status'}</button></div>{history.length===0?<div className="empty-state large"><h3>Your first launch starts here.</h3><p>Submitted bundles and on-chain migration checks will appear here.</p><button className="blue-button" onClick={()=>setView('launch')}>Create a token</button></div>:history.map(record=><article className="launch-record" key={record.mint}><div className="record-title"><div><h3>{record.name} <span>${record.symbol}</span></h3><small>{new Date(record.createdAt).toLocaleString()}</small></div><span className={`stage-badge ${record.stage}`}>{stageLabel(record.stage)}</span></div><button className="full-address" onClick={()=>void copy(record.mint)} title="Copy token mint">{record.mint}<span>{copied===record.mint?'Copied':'Copy'}</span></button><p>{record.detail}</p><div className="record-links"><a href={`https://solscan.io/token/${record.mint}`} target="_blank" rel="noreferrer">View token</a>{record.pool&&<a href={`https://solscan.io/account/${record.pool}`} target="_blank" rel="noreferrer">Verified CPMM pool</a>}<a href={`https://solscan.io/tx/${record.signatures[0]}`} target="_blank" rel="noreferrer">Creation transaction</a></div>{record.bundleId&&<small className="bundle-id">Bundle {record.bundleId}</small>}</article>)}</section>}
        <footer className="page-footer"><span>rayxento / Raydium launcher</span><a href="https://x.com/rayxento" target="_blank" rel="noreferrer">X / @rayxento</a></footer>
      </div>
    </main>
  </div>;
}


