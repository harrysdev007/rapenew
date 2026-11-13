import {Buffer} from 'buffer';
import {PublicKey, Transaction} from '@solana/web3.js';

export type WalletSigner = (transaction: Uint8Array) => Promise<Uint8Array>;

export async function applyWalletSignature(
  transaction: Transaction,
  signer: PublicKey,
  sign: WalletSigner,
) {
  const message = transaction.serializeMessage();
  const bytes = transaction.serialize({requireAllSignatures: false, verifySignatures: false});
  const signed = Transaction.from(Buffer.from(await sign(new Uint8Array(bytes))));
  if (!signed.serializeMessage().equals(message)) throw Error('The wallet changed the reviewed transaction.');

  const signature = signed.signatures.find(entry => entry.publicKey.equals(signer))?.signature;
  if (!signature) throw Error('The wallet did not return the requested signature.');

  // Preserve signatures already collected from the mint and other buyers.
  transaction.addSignature(signer, signature);
  if (!transaction.verifySignatures(false)) throw Error('A wallet returned an invalid signature.');
}
