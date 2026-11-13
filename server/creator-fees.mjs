import {Transaction,ComputeBudgetProgram} from '@solana/web3.js';
import {PROGRAM,updateDeveloperPlatformInstruction} from '../shared/developer-platform.mjs';

export function validateCreatorFeeUpdate(encoded){
  if(typeof encoded!=='string'||encoded.length>1700||!/^[A-Za-z0-9+/]+=*$/.test(encoded))throw Error('Invalid fee update transaction.');
  const bytes=Buffer.from(encoded,'base64');
  if(bytes.length>1232)throw Error('Fee update exceeds the packet limit.');
  const tx=Transaction.from(bytes);
  if(!tx.feePayer||!tx.verifySignatures()||tx.signatures.length!==1)throw Error('The developer must sign the fee update.');
  const expected=updateDeveloperPlatformInstruction(tx.feePayer),updates=tx.instructions.filter(ix=>ix.programId.equals(PROGRAM));
  if(updates.length!==1||!updates[0].data.equals(expected.data)||updates[0].keys.length!==expected.keys.length||updates[0].keys.some((key,i)=>!key.pubkey.equals(expected.keys[i].pubkey)||key.isSigner!==expected.keys[i].isSigner||key.isWritable!==(expected.keys[i].isWritable||key.pubkey.equals(tx.feePayer))))throw Error('Fee update differs from the fixed creator-fee settings.');
  if(tx.instructions.length!==3||tx.instructions[2]!==updates[0])throw Error('Unexpected instructions in fee update.');
  const [limit,price]=tx.instructions;
  if(!limit.programId.equals(ComputeBudgetProgram.programId)||!price.programId.equals(ComputeBudgetProgram.programId)||limit.data.length!==5||limit.data[0]!==2||limit.data.readUInt32LE(1)!==600000||price.data.length!==9||price.data[0]!==3||price.data.readBigUInt64LE(1)!==10000n||limit.keys.length||price.keys.length)throw Error('Unexpected network fee in creator-fee update.');
  return tx;
}
