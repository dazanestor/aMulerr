# aMulerr

[![Latest Release](https://img.shields.io/github/v/release/isc30/amulerr)](https://github.com/isc30/amulerr/releases/latest)

Integrate your *rr apps with aMule (eD2k/KAD). Compatible with:

- Radarr
- Sonarr

> aMulerr is the successor of eMulerr, which no longer exists. If you want a full UI for amule, try [AmuTorrent](https://github.com/got3nks/amutorrent)

## This fork

This is [dazanestor/aMulerr](https://github.com/dazanestor/aMulerr), branch `combined-auth-categories` —
a combination of two upstream PRs that hadn't been merged yet, plus a few additional fixes:

- **qBittorrent auth/version endpoints** (upstream PR [#60](https://github.com/isc30/aMulerr/pull/60)) — without these, Radarr/Sonarr's connection test for the download client fails outright (`POST /api/v2/auth/login` 404s).
- **`ALLOWED_CATEGORIES` category filtering** (upstream PR [#51](https://github.com/isc30/aMulerr/pull/51)) — prevents category cross-contamination when aMulerr is used alongside a real qBittorrent client of the same type.
- Concurrent `sendPacket()` calls on the same EC connection could resolve with the *wrong* response (the EC wire protocol has no request/response correlation ID) — now serialized with a mutex.
- `deleted_hashes.json` is now stored under `DATA_DIR` (default `/config`, meant to be a mounted volume) instead of the OS tmpdir, so deleted-torrent tracking survives container restarts.
- Torznab `total` count now matches the actual `<item>` count rendered (previously could overcount if an item's hash failed validation).
- `/api/v2/torrents/files` now reports `progress` as a 0-1 fraction, matching the real qBittorrent API.

Cross-checked byte-for-byte against aMule's own source (`ExternalConn.cpp`, `Preferences.cpp`, `ECSpecialCoreTags.cpp`) and Radarr/Sonarr's actual `QBittorrentProxyV2.cs`/Torznab parser, which surfaced several deeper issues:

- **aMule daemon crash on category creation** — `createCategory` used to create-then-immediately-delete a throwaway category just to read its default path. Category storage is a plain `std::vector`, and deletion does a `vector::erase`, shifting every later index down by one; two categories being provisioned around the same time (the normal case when both Radarr and Sonarr point at the same aMulerr instance) could interleave and leave a stale, now out-of-range category id — reproducing the exact `Assertion '__n < this->size()' failed` → `Aborted` crash reported in [isc30/aMulerr#17](https://github.com/isc30/aMulerr/issues/17). Now reads aMule's incoming directory directly (`EC_TAG_DIRECTORIES_INCOMING`) instead of creating anything.
- **Completed downloads always imported via Copy instead of Move, and never auto-removed from the queue** — `HasReachedSeedLimit` on Radarr/Sonarr's side always evaluated to false against our responses (no per-torrent limit was ever reported, and the global one is correctly disabled), so `CanMoveFiles`/`CanBeRemoved` were always false — silently doubling disk usage on every single grab and defeating "remove completed downloads" regardless of that setting. Fixed by reporting a satisfied (`0`) per-torrent seeding-time limit, an honest reflection of aMule having no seed enforcement at all.
- **`clearCompleted()` was a permanent no-op** — `getDownloadQueue()`/`getSharedFiles()` never populated `.ecid` (the file's own container tag carries it as its value in the EC wire format, confirmed against `ECSpecialCoreTags.cpp`), so `/torrents/delete` could never explicitly clear an already-known/shared file via `EC_OP_CLEAR_COMPLETED`.
- **`deleteFiles=false` silently deleted the file anyway** — a redundant, unconditional physical-delete code path (left over from merging two PRs) ran before the properly-gated one.
- **`eta` sent as a fractional number** — Radarr/Sonarr's `QBittorrentTorrent.Eta` is a `BigInteger`, which Newtonsoft.Json can't deserialize from a JSON float; now floored.
- **Torznab `pubDate` always exactly "now"** — any clock skew with Radarr/Sonarr computes a negative release age; backdated by 24h for a safety margin (same fix as upstream [commit `58fd56a`](https://github.com/isc30/aMulerr/commit/58fd56a)).
- **Unhandled promise rejection on reconnect** — the EC socket's `close`/`error` listeners `await`ed `reconnect()` with nothing to catch a final failure (all retries exhausted); now caught and logged.
- Added the `infohash` Torznab attribute (Sonarr/Radarr's parser reads it exclusively for dedup/history, no magnet-link fallback for Torznab specifically), and implemented the remaining real qBittorrent endpoints Radarr/Sonarr can call depending on download-client settings: `/torrents/properties`, `/torrents/topPrio` (mapped to aMule's real per-download priority), `/torrents/setForceStart`, `/torrents/setShareLimits`, `/torrents/addTags` (the last two are accept-only no-ops — aMule has no per-torrent seed-ratio/time enforcement or multi-tag concept to honor them with).
- `lint`, `typecheck`, and `prettier --check` now run in CI alongside the test suite (none of the three were wired up before), and a real test suite now covers all of the above.
- **`torrents/delete`'s physical-delete fallback needs the `downloads` volume mounted into aMulerr too** — before this, `deleteFiles=true` silently no-op'd (`fs.rm(..., { force: true })` swallows the "path doesn't exist" error) whenever a file had already transitioned out of aMule's active download queue into its known/shared-files list, since aMulerr itself had no filesystem access to the actual data. The normal case (removing a still-active/just-completed download) already worked via `cancelDownload()`, which runs inside the `amule` container where the mount does exist — but this edge case had zero disk access to fall back on. The compose example below now mounts the same `downloads` volume into `amulerr` as `amule` already has.

Published image: **`ghcr.io/dazanestor/amulerr:combined`** (public, auto-built by [this repo's GitHub Action](.github/workflows/docker-build.yml) on every push to `combined-auth-categories`).

### ⚠️ Don't put aMulerr behind a VPN container's network namespace

If aMulerr shares another container's network stack (`network_mode: service:X` / `container:X` — e.g. to route it through a VPN container like gluetun), its TanStack Start server can intermittently fail to register its API routes on startup (every route 404s, including `/api/v2/auth/login`, even though the process is running and healthy). This isn't consistently reproducible and we couldn't pin down the exact trigger, but it goes away entirely when aMulerr runs on a normal bridge network. **aMule itself can still sit behind a VPN** — only point `AMULE_HOST`/`AMULE_PORT` at it over the docker network; aMulerr itself doesn't need VPN protection since it does no P2P networking on its own.

## Example `docker-compose.yaml`

> Note: aMulerr connects to aMule, you should run it in a separate container. `amule` may be placed behind a VPN container; `amulerr` should not be (see warning above).

```yaml
services:
  amulerr:
    container_name: amulerr
    image: ghcr.io/dazanestor/amulerr:combined
    user: "1000:1000" # optional
    environment:
      - AMULE_HOST=amule
      - AMULE_PORT=4712
      - AMULE_PWD=api-secret # API Password
      - ALLOWED_CATEGORIES=tv-sonarr-aMulerr,radarr-aMulerr # Optional: Filter categories to prevent contamination
      - DATA_DIR=/config # Optional: persist deleted-hash tracking across restarts
      - NODE_OPTIONS=--import /keepalive.mjs # Workaround, see "Troubleshooting" below
    ports:
      - "3000:3000" # API
    volumes:
      - amulerr_config:/config
      - ./keepalive.mjs:/keepalive.mjs:ro
      - downloads:/downloads # Required for `deleteFiles=true` to work once a file leaves aMule's active queue
  amule:
    container_name: amule
    image: ngosang/amule:latest
    environment:
      - PUID=1000
      - PGID=1000
      - GUI_PWD=api-secret # API Password
      - WEBUI_PWD=web-secret
      - MOD_AUTO_RESTART_ENABLED=true
      - MOD_AUTO_RESTART_CRON=0 6 * * *
    ports:
      - "4711:4711" # Web interface (amuleweb)
      - "4712:4712" # External connections (amulerr)
      - "4662:4662" # ED2K client-to-client TCP (required for High ID)
      - "4665:4665/udp" # ED2K server UDP (global searches, TCP port +3)
      - "4672:4672/udp" # Extended eMule protocol and Kademlia UDP
    volumes:
      - downloads:/downloads
      - amule_data:/home/amule/.aMule
volumes:
  downloads:
  amule_data:
  amulerr_config:
```

`keepalive.mjs` (see "Troubleshooting" below for why it's needed):

```js
setInterval(() => {}, 2147483647);
```

## Environment Variables

| Variable | Description |
| --- | --- |
| `AMULE_HOST` | Hostname of the aMule container. |
| `AMULE_PORT` | Port for External Connections (default: `4712`). |
| `AMULE_PWD` | Password for External Connections (GUI_PWD in aMule). |
| `ALLOWED_CATEGORIES` | Comma-separated list of categories allowed to be created/modified in aMule (e.g. `tv-sonarr,radarr,tv-4k`). If set, any category not matching this list will be ignored. |
| `DATA_DIR` | *(this fork)* Directory for persisted state (currently just `deleted_hashes.json`). Default `/config`. Mount a volume here, or deletions won't be remembered across restarts. |

## Configuring *rr

In order to get started, configure the Download Client in *RR:

- Type: `qBittorrent`
- Name: `aMulerr`
- Host: `amulerr`
- Port: `3000`
- Priority: `50`

Also set the Download Client's `Remote Path Mappings`:

- Host: `amulerr`
- Remote Path: `/downloads`
- Local Path: `{The /downloads folder inside MOUNTED PATH FOR RADARR}`

Then, add a new Indexer in *RR:

- Type: `Torznab`
- Name: `aMulerr`
- RSS: `No`
- Automatic Search: `No`
- Interactive Search: `Yes`
- URL: `http://amulerr:3000/`
- Download Client: `aMulerr`

## Removing stale downloads

Since aMulerr simulates a qBittorrent api, it is fully compatible with:
- [Decluttarrr](https://github.com/ManiMatter/decluttarr)
- [aMulerrStalledChecker](https://github.com/Jorman/aMulerrStalledChecker)

## Troubleshooting

### Container exits immediately with no log output at all

We occasionally saw the container start, print nothing, and exit cleanly (code 0) within a second —
Docker's `restart: unless-stopped` would just loop forever with no error to go on. This looks like a
startup race in the underlying Nitro/srvx server (the process exits before the listener is fully up if
nothing else is keeping the event loop alive). Mounting a trivial keep-alive script and preloading it
via `NODE_OPTIONS=--import /keepalive.mjs` (see the compose example above) reliably avoids it — once the
real server finishes starting, it keeps the process alive on its own; the import is a no-op after that.
We couldn't identify the exact root cause upstream, so treat this as a workaround, not a fix.

### Container crashes when sharing too many files

If you have a large number of files in your `downloads/complete` directory, aMule may crash when trying to load all shared files at startup. This is a known limitation of aMule itself when handling a high volume of shared files.

**Symptoms:**
- Container keeps restarting in a crash loop
- Logs show `FetchError: Invalid response body` or `ECONNRESET` errors when fetching `api.php?get=downloads`
- Files are only partially visible in the web UI before it becomes unavailable

**Workaround:**

Disable the automatic file sharing feature by setting `MOD_AUTO_SHARE_ENABLED=false` in your docker-compose environment:

```yml
environment:
  - MOD_AUTO_SHARE_ENABLED=false
```
