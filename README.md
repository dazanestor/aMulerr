# aMulerr

Conecta tus aplicaciones _\*rr_ con **aMule** (eD2k / Kademlia). aMulerr expone
una API **compatible con qBittorrent** (`/api/v2/...`) y un **feed Torznab**, de
forma que Radarr y Sonarr hablan con aMule como si fuera un cliente de descargas
qBittorrent normal.

Compatible con:

- Radarr
- Sonarr
- Cleanuparr (limpieza de descargas atascadas) — ver [Integración con Cleanuparr](#integración-con-cleanuparr)
- Decluttarr / aMulerrStalledChecker

> aMulerr es el sucesor de eMulerr, que ya no existe. Si lo que quieres es una
> interfaz completa para aMule, prueba
> [AmuTorrent](https://github.com/got3nks/amutorrent).

---

## Sobre este fork

Este es [`dazanestor/aMulerr`](https://github.com/dazanestor/aMulerr). La rama
**`main` es la canónica** (`combined-auth-categories` queda como legado y se puede
borrar).

Combina dos PRs de upstream que aún no estaban mergeadas y añade un buen número
de correcciones propias, verificadas contra el código fuente real de aMule
(`ExternalConn.cpp`, `Preferences.cpp`, `ECSpecialCoreTags.cpp`) y de
Radarr/Sonarr (`QBittorrentProxyV2.cs`, el parser de Torznab) y de Cleanuparr
(`QBitService*.cs`, `QBittorrent.Client`).

### Imagen Docker

| Tag                                      | Origen                            | Uso                        |
| ---------------------------------------- | --------------------------------- | -------------------------- |
| **`ghcr.io/dazanestor/amulerr:latest`**  | push a `main`                     | **recomendado**            |
| `ghcr.io/dazanestor/amulerr:combined`    | push a `combined-auth-categories` | legado                     |
| `ghcr.io/dazanestor/amulerr:sha-<short>` | cualquier push                    | fijar una versión concreta |

Las construye automáticamente
[el workflow del repo](.github/workflows/docker-build.yml), que además pasa
`typecheck`, `lint`, `prettier --check` y la batería de tests antes de publicar.

---

## Novedades respecto a upstream

### Endpoints qBittorrent que faltaban

- **Autenticación / versión** (PR upstream
  [#60](https://github.com/isc30/aMulerr/pull/60)): sin `POST /api/v2/auth/login`,
  `GET /api/v2/app/version` y `webapiVersion`, el test de conexión del cliente de
  descargas en Radarr/Sonarr (y Cleanuparr) falla directamente.
- **Filtrado de categorías `ALLOWED_CATEGORIES`** (PR upstream
  [#51](https://github.com/isc30/aMulerr/pull/51)): evita que aMulerr toque
  categorías que no son suyas cuando convive con un qBittorrent real del mismo
  tipo.
- Implementados los endpoints reales que Radarr/Sonarr/Cleanuparr pueden llamar
  según su configuración: `torrents/properties`, `torrents/topPrio` (mapeado a la
  prioridad real por descarga de aMule), `torrents/setForceStart`,
  `torrents/setShareLimits`, `torrents/addTags`, `torrents/trackers`,
  `torrents/filePrio`, `transfer/speedLimitsMode`, `app/setPreferences`.
  (Los que aMule no puede honrar —ratio/tiempo de seed por torrent, tags
  múltiples, prioridad por fichero en una descarga de un solo fichero— aceptan la
  petición y no hacen nada, en vez de devolver 404.)

### Consistencia de hash (arreglo del blocklist de Radarr/Sonarr)

aMule usa hashes **MD4 de 16 bytes** (32 hex). El magnet sintético que genera
aMulerr mete ese hash rellenado a 20 bytes y codificado en base32 dentro de
`xt=urn:btih:`. Cuando Radarr/Sonarr hacen _grab_, **decodifican ese `btih` a un
infohash de 40 hex** y lo guardan como `downloadId` (historial, blocklist,
correlación para el import).

Antes, `torrents/info` devolvía el hash ed2k crudo de 32 hex → **nunca casaba**
con el `downloadId` de 40 → consecuencias:

- Bloquear una descarga desde Radarr/Sonarr **solo la borraba, no la añadía al
  blocklist**, así que se volvía a coger el mismo release.
- El _Completed Download Handling_ no correlacionaba la descarga completada con
  su registro de _grab_ → problemas de import.

Ahora:

- Todas las rutas exponen la forma de **40 hex** (`<ed2k32>` + `00000000`) y la
  traducen de vuelta al hash ed2k al hablar con aMule (`delete`, `pause`,
  `resume`, `start`, `stop`, `setCategory`, `topPrio`, `setForceStart`,
  `properties`, `files`).
- El atributo `infohash` del feed Torznab emite esa misma forma de 40 hex (antes
  emitía el `btih` base32, que tampoco casaba con el `downloadId` post-grab).
- `fromMagnetLink` reescrito con `URLSearchParams`: tolera parámetros
  reordenados o extra y ya no exige `&tr=http://amulerr`; acepta el `btih` en
  base32, 40 hex o 32 hex.

### Correcciones de fondo

- **Crash del demonio de aMule al crear categorías.** `createCategory` creaba y
  borraba de inmediato una categoría temporal solo para leer su ruta por
  defecto. El almacén de categorías de aMule es un `std::vector` y el borrado
  hace `vector::erase` (desplaza todos los índices posteriores); dos categorías
  provisionándose a la vez (lo normal si Radarr y Sonarr apuntan al mismo
  aMulerr) podían entrelazarse y dejar un id de categoría obsoleto y fuera de
  rango → el `Assertion '__n < this->size()' failed` → `Aborted` de
  [isc30/aMulerr#17](https://github.com/isc30/aMulerr/issues/17). Ahora lee el
  directorio de entrada de aMule directamente (`EC_TAG_DIRECTORIES_INCOMING`).
- **Descargas completadas importadas siempre por Copia en vez de Movimiento, y
  nunca auto-eliminadas de la cola.** `HasReachedSeedLimit` en Radarr/Sonarr
  siempre daba false contra nuestras respuestas → `CanMoveFiles`/`CanBeRemoved`
  siempre false → se duplicaba el uso de disco en cada grab. Arreglado
  reportando un límite de tiempo de seed por torrent ya alcanzado (`0`), reflejo
  honesto de que aMule no tiene ninguna imposición de seed.
- **`torrents/info` siempre emite `category`, `save_path` y `content_path` como
  string** (qBittorrent real nunca devuelve null ahí; Cleanuparr peta con NRE si
  la categoría es null y tiene algún patrón de "ignorados").
- **`torrents/info` respeta `?hashes=` y `?filter=`** (Cleanuparr consulta un
  torrent cada vez y filtra por estado).
- **`clearCompleted()` era un no-op permanente.** `getDownloadQueue()` /
  `getSharedFiles()` no rellenaban `.ecid`, así que `torrents/delete` nunca podía
  limpiar un fichero ya conocido/compartido vía `EC_OP_CLEAR_COMPLETED`.
- **`deleteFiles=false` borraba el fichero igualmente** — había un borrado físico
  incondicional redundante (residuo de mergear dos PRs) que corría antes del
  bien condicionado.
- **`eta` enviado como número fraccional** — `QBittorrentTorrent.Eta` en
  Radarr/Sonarr es un `BigInteger` y Newtonsoft.Json no lo deserializa desde un
  float JSON; ahora va redondeado hacia abajo.
- **`pubDate` de Torznab siempre "ahora"** — cualquier desfase de reloj con
  Radarr/Sonarr da una edad de release negativa; retrasado 24 h por seguridad.
- **`torrents/files` reporta `progress` como fracción 0-1**, como la API real.
- **Conteo `total` de Torznab** coincide con el nº de `<item>` renderizados.
- **Llamadas `sendPacket()` concurrentes** sobre la misma conexión EC podían
  resolverse con la respuesta equivocada (el protocolo EC no tiene id de
  correlación) — ahora serializadas con un mutex.
- **Rechazo de promesa sin gestionar al reconectar** — los listeners
  `close`/`error` del socket EC hacían `await reconnect()` sin nada que
  capturase el fallo final; ahora se captura y loguea.
- **`deleted_hashes.json`** se guarda bajo `DATA_DIR` (por defecto `/config`, un
  volumen montado) en vez del tmpdir del SO, para que sobreviva a reinicios.
- **El borrado físico de `torrents/delete` necesita el volumen `downloads`
  montado también en aMulerr** — si no, `deleteFiles=true` era un no-op silencioso
  cuando el fichero ya había salido de la cola activa de aMule. El compose de
  ejemplo ya monta el mismo volumen `downloads` en `amulerr`.
- `lint`, `typecheck` y `prettier --check` corren en CI junto a los tests
  (ninguno estaba conectado antes); hay una batería de tests que cubre todo lo
  anterior.

---

## ⚠️ No pongas aMulerr dentro del namespace de red de un contenedor VPN

Si aMulerr comparte la pila de red de otro contenedor (`network_mode:
service:X` / `container:X` — p. ej. para enrutarlo por gluetun), su servidor
TanStack Start puede fallar de forma intermitente al registrar sus rutas de API
al arrancar (todas las rutas dan 404, incluida `/api/v2/auth/login`, aunque el
proceso esté vivo y "healthy"). No es reproducible de forma consistente y no
hemos localizado el disparador exacto, pero desaparece por completo con aMulerr
en una red bridge normal.

**aMule sí puede ir detrás de la VPN** — apunta `AMULE_HOST` / `AMULE_PORT` a él
por la red de Docker; aMulerr no necesita protección VPN porque no hace P2P por
su cuenta.

---

## `docker-compose.yaml` de ejemplo

> aMulerr se conecta a aMule; ejecútalos en contenedores separados. `amule`
> puede ir detrás de una VPN; `amulerr` **no** (ver aviso de arriba).

```yaml
services:
  amulerr:
    container_name: amulerr
    image: ghcr.io/dazanestor/amulerr:latest
    user: '1000:1000' # opcional
    environment:
      - AMULE_HOST=amule
      - AMULE_PORT=4712
      - AMULE_PWD=api-secret # contraseña de External Connections
      - ALLOWED_CATEGORIES=tv-sonarr-amule,radarr-amule # opcional: evita contaminación de categorías
      - DATA_DIR=/config # opcional: persiste el tracking de hashes borrados
      - NODE_OPTIONS=--import /keepalive.mjs # workaround, ver "Solución de problemas"
    ports:
      - '3000:3000' # API
    volumes:
      - amulerr_config:/config
      - ./keepalive.mjs:/keepalive.mjs:ro
      - downloads:/downloads # necesario para que deleteFiles=true funcione al salir el fichero de la cola de aMule
  amule:
    container_name: amule
    image: ngosang/amule:latest
    environment:
      - PUID=1000
      - PGID=1000
      - GUI_PWD=api-secret # contraseña de External Connections
      - WEBUI_PWD=web-secret
      - MOD_AUTO_RESTART_ENABLED=true
      - MOD_AUTO_RESTART_CRON=0 6 * * *
    ports:
      - '4711:4711' # interfaz web (amuleweb)
      - '4712:4712' # External Connections (lo usa amulerr)
      - '4662:4662' # ED2K cliente-a-cliente TCP (necesario para High ID)
      - '4665:4665/udp' # ED2K servidor UDP (búsquedas globales, puerto TCP +3)
      - '4672:4672/udp' # protocolo eMule extendido y Kademlia UDP
    volumes:
      - downloads:/downloads
      - amule_data:/home/amule/.aMule
volumes:
  downloads:
  amule_data:
  amulerr_config:
```

`keepalive.mjs` (ver "Solución de problemas" para saber por qué hace falta):

```js
setInterval(() => {}, 2147483647)
```

---

## Variables de entorno

| Variable             | Descripción                                                                                                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AMULE_HOST`         | Host del contenedor de aMule.                                                                                                                                                       |
| `AMULE_PORT`         | Puerto de External Connections (por defecto `4712`).                                                                                                                                |
| `AMULE_PWD`          | Contraseña de External Connections (`GUI_PWD` en aMule).                                                                                                                            |
| `PORT`               | Puerto en el que escucha aMulerr (por defecto `3000`).                                                                                                                              |
| `ALLOWED_CATEGORIES` | Lista separada por comas de categorías que aMulerr puede crear/modificar en aMule (p. ej. `tv-sonarr,radarr,tv-4k`). Si se define, cualquier categoría fuera de la lista se ignora. |
| `DATA_DIR`           | Directorio de estado persistente (ahora mismo solo `deleted_hashes.json`). Por defecto `/config`. Monta un volumen aquí o las eliminaciones no se recuerdan entre reinicios.        |

---

## Configurar Radarr / Sonarr

**Cliente de descargas** (Settings → Download Clients → Add → qBittorrent):

- Type: `qBittorrent`
- Name: `aMulerr`
- Host: `amulerr` (o la IP del host)
- Port: `3000` (o el que hayas publicado)
- Username / Password: **en blanco** (aMulerr no tiene autenticación real)
- Priority: `50`

**Remote Path Mappings** del cliente de descargas:

- Host: `amulerr`
- Remote Path: `/downloads`
- Local Path: _(la ruta a `/downloads` dentro del contenedor de Radarr/Sonarr)_

**Indexer** (Settings → Indexers → Add → Torznab):

- Type: `Torznab`
- Name: `aMulerr`
- RSS: `No`
- Automatic Search: `No`
- Interactive Search: `Yes`
- URL: `http://amulerr:3000/`
- Download Client: `aMulerr`

---

## Integración con Cleanuparr

[Cleanuparr](https://github.com/Cleanuparr/Cleanuparr) puede reapear las
descargas de aMule que no avanzan (Queue Cleaner). Su cliente qBittorrent
llama, por cada item de la cola de Radarr/Sonarr, a `torrents/info?hashes=`,
`torrents/trackers`, `torrents/properties`, `torrents/files` y `torrents/delete`
— todos implementados en este fork.

### Configuración

1. **Settings → Download Clients → Add**
   - Type: `qBittorrent`
   - URL: `http://<host>:<puerto>` de aMulerr (usa la IP del host si Cleanuparr
     y aMulerr no comparten red de Docker)
   - Usuario / contraseña: **en blanco**
2. **Settings → Queue Cleaner**
   - Activa la regla **Stalled**. Un download de aMule sin fuentes se reporta
     como `stalledDL`; tras `max_strikes` pasadas sin progreso, Cleanuparr lo
     elimina del cliente + blocklist + nueva búsqueda en el _\*rr_.
   - La regla Stalled es **global** (también afecta a tus qBittorrent reales,
     solo distingue por `privacy_type`). Elige un `max_strikes` que valga para
     ambos: `tiempo hasta actuar = max_strikes × intervalo del cron` (por
     defecto 5 min). ~10 (≈50 min) es un punto de partida razonable.

### Lo que NO aporta para aMule

- **Content / Malware Blocker**: una descarga ed2k es un único fichero, y
  `filePrio` es un no-op. Con `delete_if_any_file_blocked` podría borrar una
  descarga de aMule solo por su nombre. Excluye las categorías de aMulerr en
  `ignored_downloads` (p. ej. `sonarr-amule`, `radarr-amule`) o no asocies
  aMulerr a ese job.
- **Download Cleaner** (seeding por ratio / tiempo / inactividad): aMule no tiene
  modelo de seeding de BitTorrent, así que estas reglas no evalúan nada útil.

---

## Solución de problemas

### El contenedor sale al instante sin loguear nada

Vimos ocasionalmente que el contenedor arranca, no imprime nada y sale limpio
(código 0) en un segundo — con `restart: unless-stopped` esto es un bucle
infinito sin pista de error. Parece una carrera de arranque en el servidor
Nitro/srvx subyacente (el proceso sale antes de que el listener esté del todo
levantado si nada más mantiene vivo el event loop). Montar un script trivial de
keep-alive y precargarlo con `NODE_OPTIONS=--import /keepalive.mjs` (ver el
compose de ejemplo) lo evita de forma fiable. Es un workaround, no un arreglo de
raíz.

### El contenedor de aMule crashea con demasiados ficheros compartidos

Con muchos ficheros en `downloads/complete`, aMule puede crashear al cargar
todos los ficheros compartidos al arrancar. Es una limitación del propio aMule.

**Síntomas:**

- El contenedor de aMule entra en bucle de reinicio.
- Los logs muestran `FetchError: Invalid response body` o `ECONNRESET` al pedir
  `api.php?get=downloads`.
- Los ficheros solo se ven parcialmente en la interfaz web antes de caerse.

**Workaround:** desactiva el compartir automático con
`MOD_AUTO_SHARE_ENABLED=false` en el entorno de aMule.

---

## Desarrollo

El código de la aplicación está en `src/amulerr/` (TanStack Start, las rutas de
la API en `src/amulerr/src/routes/`, el cliente EC de aMule en
`src/amulerr/src/amule-ec-node/`).

```bash
cd src/amulerr
pnpm install
pnpm dev         # servidor de desarrollo en :3000
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint
pnpm check       # prettier --check
```

El workflow de CI (`.github/workflows/docker-build.yml`) corre esos cuatro
checks y, si pasan, construye y publica la imagen:

- push a `main` → `ghcr.io/dazanestor/amulerr:latest` (+ `:sha-<short>`)
- push a `combined-auth-categories` → `:combined` (+ `:sha-<short>`)
