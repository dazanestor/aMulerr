'use strict'

/*
 * Client side of aMule >= 3.3 External Connections (EC) authentication and
 * transport encryption:
 *   - X25519 key exchange + HKDF-SHA256 -> per-direction AEAD keys
 *   - SRP-6a (3072-bit group, SHA-256, scrypt-derived x) proving the password
 * Mirrors src/libs/ec/cpp/{ECCrypt,ECSRP}.cpp and RemoteConnect.cpp from
 * amule-org/amule.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto'

export const CIPHER_AES128_GCM = 1
export const CIPHER_CHACHA20_POLY1305 = 2
export const AEAD_TAG_LEN = 16
export const NONCE_TAG_LEN = 32
export const SRP_WIDTH = 384
export const SRP_PROFILE = Buffer.from([1, 15, 8, 1])
export const SRP_CREDENTIAL_PASSWORD = 0

const N = BigInt(
  '0xFFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7EDEE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3BE39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA051015728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6BF12FFA06D98A0864D87602733EC86A64521F2B18177B200CBBE117577A615D6C770988C0BAD946E208E24FA074E5AB3143DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF',
)
const G = 5n

// ---- helpers --------------------------------------------------------------

const toInt = (buf) => (buf.length ? BigInt('0x' + buf.toString('hex')) : 0n)

const toBytes = (n, width) => {
  const hex = n.toString(16).padStart(width * 2, '0')
  if (hex.length > width * 2) throw new Error('Integer too wide')
  return Buffer.from(hex, 'hex')
}

const sha256 = (...parts) => {
  const h = createHash('sha256')
  for (const p of parts) h.update(p)
  return h.digest()
}

const hmac256 = (key, ...parts) => {
  const h = createHmac('sha256', key)
  for (const p of parts) h.update(p)
  return h.digest()
}

const modPow = (base, exp, mod) => {
  let result = 1n
  base %= mod
  if (base < 0n) base += mod
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod
    exp >>= 1n
    base = (base * base) % mod
  }
  return result
}

const equal = (a, b) =>
  a.length === b.length && a.length > 0 && timingSafeEqual(a, b)

// ---- X25519 / AEAD --------------------------------------------------------

const SPKI_X25519_PREFIX = Buffer.from('302a300506032b656e032100', 'hex')

export const generateX25519 = () => {
  const { privateKey, publicKey } = generateKeyPairSync('x25519')
  const pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)
  return { privateKey, publicKey: Buffer.from(pub) }
}

export const x25519Agree = (privateKey, peerPub) => {
  if (peerPub.length !== 32) throw new Error('Bad X25519 public key length')
  const peer = createPublicKey({
    key: Buffer.concat([SPKI_X25519_PREFIX, peerPub]),
    format: 'der',
    type: 'spki',
  })
  const shared = diffieHellman({ privateKey, publicKey: peer })
  if (shared.every((b) => b === 0)) throw new Error('Degenerate X25519 secret')
  return shared
}

export const buildTranscript = (
  offered,
  chosen,
  clientNonce,
  serverNonce,
  clientPub,
  serverPub,
) =>
  Buffer.concat([
    Buffer.from([offered.length]),
    Buffer.from(offered),
    Buffer.from([chosen]),
    clientNonce,
    serverNonce,
    clientPub,
    serverPub,
  ])

const cipherSpec = (cipher) => {
  switch (cipher) {
    case CIPHER_AES128_GCM:
      return { name: 'aes-128-gcm', keyLen: 16 }
    case CIPHER_CHACHA20_POLY1305:
      return { name: 'chacha20-poly1305', keyLen: 32 }
    default:
      return null
  }
}

export const isCipherSupported = (cipher) => cipherSpec(cipher) !== null

/** Per-direction AEAD session; the packet counter is implicit (nonce suffix). */
export class AeadSession {
  constructor(cipher, ikm, serverNonce, clientNonce, transcript) {
    const spec = cipherSpec(cipher)
    if (!spec) throw new Error('Unsupported AEAD cipher')
    if (
      serverNonce.length !== NONCE_TAG_LEN ||
      clientNonce.length !== NONCE_TAG_LEN
    )
      throw new Error('Bad AEAD nonce length')
    this.spec = spec
    const salt = Buffer.concat([serverNonce, clientNonce])
    const info = Buffer.concat([
      Buffer.from('aMule EC AEAD v1'),
      Buffer.from([cipher]),
      transcript,
    ])
    const need = spec.keyLen * 2 + 8
    const okm = Buffer.from(hkdfSync('sha256', ikm, salt, info, need))
    const k = spec.keyLen
    // Client is the only role implemented here: tx = client->server.
    this.txKey = okm.subarray(0, k)
    this.rxKey = okm.subarray(k, 2 * k)
    this.txPrefix = okm.subarray(2 * k, 2 * k + 4)
    this.rxPrefix = okm.subarray(2 * k + 4, 2 * k + 8)
    this.txCounter = 0n
    this.rxCounter = 0n
  }

  nonce(prefix, counter) {
    const n = Buffer.alloc(12)
    prefix.copy(n, 0)
    n.writeBigUInt64BE(counter, 4)
    return n
  }

  /** @returns ciphertext || tag */
  seal(plain) {
    const c = createCipheriv(
      this.spec.name,
      this.txKey,
      this.nonce(this.txPrefix, this.txCounter),
      { authTagLength: AEAD_TAG_LEN },
    )
    const body = Buffer.concat([c.update(plain), c.final()])
    const tag = c.getAuthTag()
    this.txCounter++
    return Buffer.concat([body, tag])
  }

  /** @param sealed ciphertext || tag; throws on authentication failure */
  open(sealed) {
    if (sealed.length < AEAD_TAG_LEN) throw new Error('Sealed body too short')
    const body = sealed.subarray(0, sealed.length - AEAD_TAG_LEN)
    const tag = sealed.subarray(sealed.length - AEAD_TAG_LEN)
    const d = createDecipheriv(
      this.spec.name,
      this.rxKey,
      this.nonce(this.rxPrefix, this.rxCounter),
      { authTagLength: AEAD_TAG_LEN },
    )
    d.setAuthTag(tag)
    const plain = Buffer.concat([d.update(body), d.final()])
    this.rxCounter++
    return plain
  }
}

// ---- SRP-6a ---------------------------------------------------------------

const srpX = (digest16, salt) => {
  if (digest16.length !== 16 || salt.length !== 16)
    throw new Error('Invalid SRP input')
  return scryptSync(digest16, salt, 32, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 128 * 1024 * 1024,
  })
}

const srpContext = (credential, salt, transcript, A, B) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(transcript.length, 0)
  return Buffer.concat([
    Buffer.from([SRP_PROFILE[0], credential, ...SRP_PROFILE.subarray(1)]),
    salt,
    len,
    transcript,
    A,
    B,
  ])
}

export class SrpClient {
  constructor() {
    this.a = randomBytes(32)
    this.A = toBytes(modPow(G, toInt(this.a), N), SRP_WIDTH)
    this.expected = null
  }

  /**
   * @param digest16  MD5 digest (16 raw bytes) of the EC password
   * @returns M1 proof (32 bytes); stores the expected server proof M2
   */
  respond(digest16, credential, salt, B, transcript) {
    if (B.length !== SRP_WIDTH) throw new Error('Invalid SRP public value')
    const Bn = toInt(B)
    if (Bn <= 0n || Bn >= N) throw new Error('Invalid SRP public value')
    const u = toInt(sha256(this.A, B))
    if (u === 0n) throw new Error('Invalid SRP scrambling value')
    const k = toInt(sha256(toBytes(N, SRP_WIDTH), toBytes(G, SRP_WIDTH)))
    const x = toInt(srpX(digest16, salt))
    const base = (((Bn - k * modPow(G, x, N)) % N) + N) % N
    const S = toBytes(modPow(base, toInt(this.a) + u * x, N), SRP_WIDTH)
    const key = sha256(S)
    const ctx = srpContext(credential, salt, transcript, this.A, B)
    const m1 = hmac256(key, 'ec-srp-client', ctx)
    this.expected = hmac256(key, 'ec-srp-server', ctx, m1)
    return m1
  }

  verify(m2) {
    const ok = this.expected !== null && equal(m2, this.expected)
    this.expected = null
    return ok
  }
}

/** aMule 3.0-3.2 key-confirmation tag: HKDF(secret, salt=transcript, info=label). */
export const confirmTag = (secret, transcript, label) =>
  Buffer.from(hkdfSync('sha256', secret, transcript, Buffer.from(label), 32))
