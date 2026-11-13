import {Buffer} from 'buffer';
import {PublicKey,TransactionInstruction} from '@solana/web3.js';

export const PROGRAM=new PublicKey('LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj');
export const DEV_CPMM_CONFIG=new PublicKey('52MZUkNsRYzP4gn2mCaLTVtJQy2tpoF79hp5K1HhAxxX');
export const DEV_FEE_RATE=5000n;
export const developerPlatform=developer=>PublicKey.findProgramAddressSync([Buffer.from('platform_config'),developer.toBuffer()],PROGRAM)[0];
const key=(pubkey,isWritable=false,isSigner=false)=>({pubkey,isWritable,isSigner});
const u64=n=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(n);return b;};
const str=s=>{const b=Buffer.from(s),n=Buffer.alloc(4);n.writeUInt32LE(b.length);return Buffer.concat([n,b]);};

export function updateDeveloperPlatformInstruction(developer){
  // Official SDK UpdatePlatformConfig::AllInfo (variant 8). Shared by the
  // browser signer and native Node validator, without a runtime TS import.
  return new TransactionInstruction({programId:PROGRAM,keys:[key(developer,false,true),key(developerPlatform(developer),true),key(DEV_CPMM_CONFIG)],data:Buffer.concat([Buffer.from([195,60,76,129,146,45,67,143,8]),developer.toBuffer(),developer.toBuffer(),u64(100000n),u64(0n),u64(900000n),u64(0n),str('rapelaunch'),str('https://x.com/rapelaunch_xyz'),str(''),PublicKey.default.toBuffer(),u64(DEV_FEE_RATE),u64(0n),developer.toBuffer()])});
}
