// libsodium's crypto_box_seal, which GitHub requires for Actions secrets:
//   ephemeral keypair; nonce = BLAKE2b-192(ephemeral_pk || recipient_pk);
//   output = ephemeral_pk || crypto_box(message, nonce, recipient_pk, ephemeral_sk)
// Built from tweetnacl + blakejs (~10 KB) instead of the 200 KB libsodium build.
import nacl from 'tweetnacl'
import { blake2b } from 'blakejs'

export function sealedBox(message: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array {
  if (recipientPublicKey.length !== nacl.box.publicKeyLength) throw new Error('bad public key')
  const eph = nacl.box.keyPair()
  const nonceInput = new Uint8Array(64)
  nonceInput.set(eph.publicKey, 0)
  nonceInput.set(recipientPublicKey, 32)
  const nonce = blake2b(nonceInput, undefined, nacl.box.nonceLength)
  const boxed = nacl.box(message, nonce, recipientPublicKey, eph.secretKey)
  const out = new Uint8Array(32 + boxed.length)
  out.set(eph.publicKey, 0)
  out.set(boxed, 32)
  eph.secretKey.fill(0)
  return out
}

export const b64encode = (bytes: Uint8Array): string => {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

export const b64decode = (text: string): Uint8Array => Uint8Array.from(atob(text), (c) => c.charCodeAt(0))

/** Encrypts a secret value for GitHub's PUT /actions/secrets/{name}. */
export function encryptSecret(value: string, repoPublicKeyB64: string): string {
  return b64encode(sealedBox(new TextEncoder().encode(value), b64decode(repoPublicKeyB64)))
}
