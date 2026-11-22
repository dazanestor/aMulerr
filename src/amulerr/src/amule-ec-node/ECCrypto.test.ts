import { describe, expect, it } from 'vitest'
import {
  AeadSession,
  CIPHER_AES128_GCM,
  CIPHER_CHACHA20_POLY1305,
  SrpClient,
  buildTranscript,
  generateX25519,
  x25519Agree,
} from './ECCrypto.mjs'

describe('EC AEAD session', () => {
  for (const cipher of [CIPHER_AES128_GCM, CIPHER_CHACHA20_POLY1305]) {
    it(`derives matching directional keys (cipher ${cipher})`, () => {
      const a = generateX25519()
      const b = generateX25519()
      const shared = x25519Agree(a.privateKey, b.publicKey)
      expect(shared.equals(x25519Agree(b.privateKey, a.publicKey))).toBe(true)
      const sn = Buffer.alloc(32, 1)
      const cn = Buffer.alloc(32, 2)
      const t = buildTranscript(
        [1, 2],
        cipher,
        cn,
        sn,
        a.publicKey,
        b.publicKey,
      )
      const client = new AeadSession(cipher, shared, sn, cn, t)
      const sealed = client.seal(Buffer.from('hello'))
      expect(sealed.length).toBe(5 + 16)
      sealed[0] ^= 1
      // Tampering must be detected.
      expect(() => client.open(sealed)).toThrow()
    })
  }
})

describe('SRP client', () => {
  it('produces a 384-byte A and a 32-byte proof', () => {
    const srp = new SrpClient()
    expect(srp.A.length).toBe(384)
    // B = g^b mod N for a throwaway b is not needed: any 0 < B < N is valid input.
    const B = Buffer.alloc(384, 0x11)
    const m1 = srp.respond(
      Buffer.alloc(16, 7),
      0,
      Buffer.alloc(16, 3),
      B,
      Buffer.alloc(8, 9),
    )
    expect(m1.length).toBe(32)
    expect(srp.verify(Buffer.alloc(32))).toBe(false)
  })
  it('rejects an out-of-range B', () => {
    const srp = new SrpClient()
    expect(() =>
      srp.respond(
        Buffer.alloc(16, 7),
        0,
        Buffer.alloc(16),
        Buffer.alloc(384),
        Buffer.alloc(1),
      ),
    ).toThrow()
  })
})
