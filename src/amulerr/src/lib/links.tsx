import base32 from 'hi-base32'

function parseEd2kHash(value: string) {
  const normalized = value.trim().toUpperCase()
  if (!/^[0-9A-F]{32}$/.test(normalized)) {
    return null
  }

  return normalized
}

export function toMagnetLink(hash: string, name: string, size: number) {
  const ed2kHash = parseEd2kHash(hash)
  if (!ed2kHash) {
    return null
  }

  const hashBuffer = Buffer.from(ed2kHash, 'hex')
  const base32Buffer = Buffer.alloc(20, '\0')
  hashBuffer.copy(base32Buffer)
  const base32Hash = base32.encode(base32Buffer).toUpperCase()

  return `magnet:?xt=urn:btih:${base32Hash}&dn=${encodeURIComponent(name)}&xl=${size}&tr=http://amulerr`
}

export function fromMagnetLink(magnetLink: string) {
  const extractMagnetLinkInfo =
    /magnet:\?xt=urn:btih:(?<hash>.*)&dn=(?<name>.*)&xl=(?<size>[^&]+)&tr=http:\/\/amulerr/
  const {
    hash: base32Hash,
    name,
    size,
  } = extractMagnetLinkInfo.exec(magnetLink)?.groups ?? {}

  if (!base32Hash || !name || !size) {
    throw new Error('Invalid magnet link')
  }

  const hash = Buffer.from(base32.decode.asBytes(base32Hash))
    .toString('hex')
    .substring(0, 32)
    .toUpperCase()
  return { hash, name: decodeURIComponent(name), size: parseInt(size) }
}

export function toEd2kLink(hash: string, name: string, size: number) {
  return `ed2k://|file|${name}|${size}|${hash}|/`
}
