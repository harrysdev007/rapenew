import {Keypair} from '@solana/web3.js';
import bs58 from 'bs58';
export type LocalWallet={id:string;name:string;address:string;secret:string};
export type SealedVault={version:1;salt:string;iv:string;data:string};
export const VAULT_KEY='zeroblock.vault.v1';
const to64=(data:Uint8Array)=>btoa(String.fromCharCode(...data));
const from64=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
async function derive(password:string,salt:Uint8Array){const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt:salt as BufferSource,iterations:310000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
export async function seal(wallets:LocalWallet[],password:string):Promise<SealedVault>{
  if(password.length<10)throw Error('Use a vault password of at least 10 characters.');
  const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),key=await derive(password,salt);
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(wallets)));
  return {version:1,salt:to64(salt),iv:to64(iv),data:to64(new Uint8Array(encrypted))};
}
export async function unseal(vault:SealedVault,password:string):Promise<LocalWallet[]>{
  if(vault.version!==1||vault.data.length>100000)throw Error('Unsupported vault file.');
  try{
    const key=await derive(password,from64(vault.salt)),plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:from64(vault.iv) as BufferSource},key,from64(vault.data) as BufferSource);
    const wallets=JSON.parse(new TextDecoder().decode(plain));
    if(!Array.isArray(wallets)||wallets.length>50)throw Error();
    for(const wallet of wallets)if(!wallet.name||!wallet.id||Keypair.fromSecretKey(bs58.decode(wallet.secret)).publicKey.toBase58()!==wallet.address)throw Error();
    return wallets;
  }catch{throw Error('Could not unlock the vault. Check your password and backup file.');}
}
export function walletFromSecret(name:string,value?:string):LocalWallet{
  let keypair:Keypair;
  if(value){let bytes:Uint8Array;try{if(value.trim().startsWith('[')){const values=JSON.parse(value);if(!Array.isArray(values)||values.some(v=>!Number.isInteger(v)||v<0||v>255))throw Error();bytes=Uint8Array.from(values);}else bytes=bs58.decode(value.trim());}catch{throw Error('Enter a valid base58 private key or Solana JSON keypair.');}
    if(bytes.length!==64)throw Error('Enter a complete Solana private key in Base58 or JSON keypair format.');
    try{keypair=Keypair.fromSecretKey(bytes);}catch{throw Error('Private key verification failed.');}
  }else keypair=Keypair.generate();
  return {id:crypto.randomUUID(),name:name.trim().slice(0,40)||'New wallet',address:keypair.publicKey.toBase58(),secret:bs58.encode(keypair.secretKey)};
}
