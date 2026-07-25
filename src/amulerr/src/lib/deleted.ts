import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Persisted under DATA_DIR (expected to be a mounted volume) so the deleted-hash
// list survives container restarts. Falls back to the OS tmpdir (ephemeral) only
// if DATA_DIR isn't writable, so the app still works without a volume — it just
// won't remember deletions across restarts in that case.
const PRIMARY_DATA_DIR = process.env.DATA_DIR || '/config';
const FALLBACK_DATA_DIR = os.tmpdir();

function resolveDataDir(): string {
  try {
    fs.mkdirSync(PRIMARY_DATA_DIR, { recursive: true });
    fs.accessSync(PRIMARY_DATA_DIR, fs.constants.W_OK);
    return PRIMARY_DATA_DIR;
  } catch (err: any) {
    console.error(`Data dir "${PRIMARY_DATA_DIR}" not writable/available (${err.message}), falling back to ${FALLBACK_DATA_DIR} (not persisted across restarts)`);
    return FALLBACK_DATA_DIR;
  }
}

const DELETED_HASHES_FILE = path.join(resolveDataDir(), 'deleted_hashes.json');

const deletedHashes = new Set<string>();

// Load initially on startup
try {
  if (fs.existsSync(DELETED_HASHES_FILE)) {
    const data = JSON.parse(fs.readFileSync(DELETED_HASHES_FILE, 'utf-8'));
    if (Array.isArray(data)) {
      data.forEach((h: string) => deletedHashes.add(h.toUpperCase()));
    }
  }
} catch (err: any) {
  console.error('Failed to load deleted hashes:', err.message);
}

export function isHashDeleted(hash: string): boolean {
  return deletedHashes.has(hash.toUpperCase());
}

export function addDeletedHash(hash: string) {
  const upper = hash.toUpperCase();
  if (!deletedHashes.has(upper)) {
    deletedHashes.add(upper);
    saveDeletedHashes();
  }
}

function saveDeletedHashes() {
  try {
    fs.writeFileSync(DELETED_HASHES_FILE, JSON.stringify(Array.from(deletedHashes)), 'utf-8');
  } catch (err: any) {
    console.error('Failed to save deleted hashes:', err.message);
  }
}
