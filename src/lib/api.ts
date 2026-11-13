import {Connection} from '@solana/web3.js';
export const connection=new Connection(`${location.origin}/api/rpc`,{commitment:'confirmed',disableRetryOnRateLimit:true});
export async function api<T>(path:string,data?:unknown,accessToken?:string):Promise<T>{
  const headers = new Headers();
  if (data!==undefined) headers.set('Content-Type','application/json');
  if (accessToken) headers.set('Authorization',`Bearer ${accessToken}`);
  const response=await fetch(`/api/${path}`,{method:data===undefined?'GET':'POST',headers,body:data===undefined?undefined:JSON.stringify(data)});
  const result=await response.json();if(!response.ok||result.error)throw Error(result.error||`Request failed (${response.status}).`);return result;
}
