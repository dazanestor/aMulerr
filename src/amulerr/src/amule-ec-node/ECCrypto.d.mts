import type { KeyObject } from 'node:crypto'

export const CIPHER_AES128_GCM: 1
export const CIPHER_CHACHA20_POLY1305: 2
export const AEAD_TAG_LEN: number
export const NONCE_TAG_LEN: number
export const SRP_WIDTH: number
export const SRP_PROFILE: Buffer
export const SRP_CREDENTIAL_PASSWORD: number

export function generateX25519(): { privateKey: KeyObject; publicKey: Buffer }
export function x25519Agree(privateKey: KeyObject, peerPub: Buffer): Buffer
export function buildTranscript(
  offered: number[],
  chosen: number,
  clientNonce: Buffer,
  serverNonce: Buffer,
  clientPub: Buffer,
  serverPub: Buffer,
): Buffer
export function isCipherSupported(cipher: number): boolean
export function confirmTag(
  secret: Buffer,
  transcript: Buffer,
  label: string,
): Buffer

export class AeadSession {
  constructor(
    cipher: number,
    ikm: Buffer,
    serverNonce: Buffer,
    clientNonce: Buffer,
    transcript: Buffer,
  )
  seal(plain: Buffer): Buffer
  open(sealed: Buffer): Buffer
}

export class SrpClient {
  A: Buffer
  respond(
    digest16: Buffer,
    credential: number,
    salt: Buffer,
    B: Buffer,
    transcript: Buffer,
  ): Buffer
  verify(m2: Buffer): boolean
}
