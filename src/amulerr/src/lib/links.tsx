import base32 from "hi-base32"

function parseEd2kHash(value: string) {
  const normalized = value.trim().toUpperCase()
  if (!/^[0-9A-F]{32}$/.test(normalized)) {
    return null
  }
  
  return normalized
}

export function toMagnetLink(hash: string, name: string, size: number) {
  const ed2kHash = parseEd2kHash(hash)
  if (!ed2kHash) { return null }

  const hashBuffer = Buffer.from(ed2kHash, "hex")
  const base32Buffer = Buffer.alloc(20, "\0")
  hashBuffer.copy(base32Buffer)
  const base32Hash = base32.encode(base32Buffer).toUpperCase()

  return `magnet:?xt=urn:btih:${base32Hash}&dn=${encodeURIComponent(name)}&xl=${size}&tr=http://amulerr`
}

/**
 * Extract the 32 hex char ed2k hash from a magnet `btih` value. Accepts our
 * synthetic base32 form, a 40 hex char form (some clients normalise the magnet
 * to hex before forwarding it), and a bare 32 hex char ed2k hash.
 */
export function btihToEd2kHash(btih: string): string | null {
  const value = btih.trim().toUpperCase()

  if (/^[0-9A-F]{40}$/.test(value)) {
    // 20-byte infohash: first 16 bytes are the ed2k hash, last 4 are padding.
    return value.slice(0, 32)
  }

  if (/^[A-Z2-7]{32}$/.test(value)) {
    // base32 alphabet (our synthetic form). A pure-hex string with 0/1/8/9
    // falls through to the hex branch below; a [2-7A-F]-only string is
    // ambiguous and treated as base32, which is what toMagnetLink emits.
    try {
      const bytes = Buffer.from(base32.decode.asBytes(value))
      return bytes.length >= 16
        ? bytes.toString("hex").slice(0, 32).toUpperCase()
        : null
    } catch {
      return null
    }
  }

  if (/^[0-9A-F]{32}$/.test(value)) {
    return value
  }

  return null
}

export function fromMagnetLink(magnetLink: string) {
  const queryStart = magnetLink.indexOf("?")
  const params = new URLSearchParams(
    queryStart >= 0 ? magnetLink.slice(queryStart + 1) : magnetLink,
  )

  const btih = params
    .getAll("xt")
    .find((xt) => xt.toLowerCase().startsWith("urn:btih:"))
    ?.slice("urn:btih:".length)
  const name = params.get("dn")
  const size = params.get("xl")

  if (!btih || !name || !size) {
    throw new Error("Invalid magnet link")
  }

  const hash = btihToEd2kHash(btih)
  if (!hash) {
    throw new Error("Invalid magnet link hash")
  }

  return { hash, name, size: parseInt(size, 10) }
}

/**
 * aMule uses 16-byte MD4 hashes (32 hex chars). The synthetic btih magnets we
 * emit pad that hash to 20 bytes, so Radarr/qBittorrent derive a 40 hex char
 * "infohash" from the magnet and key their history/blocklist on it. To keep the
 * download-client hash consistent between grab time (magnet) and queue listing
 * (EC), expose the padded 40-char form to clients and strip it back for aMule.
 */
export function ed2kHashToClientHash(ed2kHash: string | undefined | null) {
  return (ed2kHash ?? "").trim().toUpperCase().padEnd(40, "0")
}

export function clientHashToEd2kHash(clientHash: string) {
  return clientHash.trim().toUpperCase().slice(0, 32)
}

export function toEd2kLink(hash: string, name: string, size: number) {
  return `ed2k://|file|${name}|${size}|${hash}|/`
}

export function fromEd2kLink(ed2kLink: string) {
  const extractEd2kLinkInfo =
    /ed2k:\/\/\|file\|(?<name>[^|]+)\|(?<size>[^|]+)\|(?<hash>[^|]+)\|/

  const { hash, name, size } = extractEd2kLinkInfo.exec(ed2kLink)?.groups ?? {}

  if (!hash || !name || !size) {
    throw new Error("Invalid ed2k link")
  }

  const ed2kHash = parseEd2kHash(hash)
  if (ed2kHash == null) {
    throw new Error("Invalid ed2k hash")
  }

  return { hash: ed2kHash, name: decodeURIComponent(name), size: parseInt(size) }
}
