// Proves our sealed box opens with real libsodium — the library GitHub uses.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import sodium from 'libsodium-wrappers'
import { b64decode, encryptSecret } from './sealedbox.ts'

test('sealed box opens with libsodium crypto_box_seal_open', async () => {
  await sodium.ready
  const kp = sodium.crypto_box_keypair()
  const pkB64 = sodium.to_base64(kp.publicKey, sodium.base64_variants.ORIGINAL)
  for (const value of ['ghp_example-not-a-real-token', 'x', 'ü'.repeat(300)]) {
    const sealed = b64decode(encryptSecret(value, pkB64))
    const opened = sodium.crypto_box_seal_open(sealed, kp.publicKey, kp.privateKey)
    assert.equal(new TextDecoder().decode(opened), value)
  }
})

test('two encryptions of the same value differ (fresh ephemeral key)', async () => {
  await sodium.ready
  const kp = sodium.crypto_box_keypair()
  const pkB64 = sodium.to_base64(kp.publicKey, sodium.base64_variants.ORIGINAL)
  assert.notEqual(encryptSecret('same', pkB64), encryptSecret('same', pkB64))
})
