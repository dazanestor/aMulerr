# Desplegar aMulerr en un servidor nuevo

Guía para levantar aMulerr + aMule e integrarlo con Radarr/Sonarr y Cleanuparr
desde cero. Los valores concretos (hosts, puertos, contraseñas) son ejemplos:
sustitúyelos por los tuyos.

---

## 1. Qué vas a montar

```
Radarr / Sonarr ──Torznab (búsqueda) ──▶ aMulerr ──EC──▶ aMule ──▶ eD2k / Kad
       │          ──qBittorrent API ────▶
       ▼
   biblioteca (import por Copy/Move desde /downloads)

Cleanuparr ──qBittorrent API──▶ aMulerr   (limpia descargas atascadas)
```

- **aMule**: el cliente eD2k/Kad de verdad. Puede ir detrás de una VPN.
- **aMulerr**: traduce la API de qBittorrent + un feed Torznab a la conexión EC
  de aMule. **NO debe compartir el namespace de red de un contenedor VPN**
  (ver [gotchas](#4-gotchas-imprescindibles)).
- Radarr/Sonarr lo usan como _download client_ (tipo qBittorrent) **y** como
  _indexer_ (Torznab).

Imagen: **`ghcr.io/dazanestor/amulerr:latest`** (se construye desde la rama `main`
del repo). Usa `:sha-<short>` para fijar una versión concreta.

---

## 2. `docker-compose.yaml`

```yaml
services:
  amulerr:
    container_name: amulerr
    image: ghcr.io/dazanestor/amulerr:latest
    restart: unless-stopped
    environment:
      - AMULE_HOST=amule # host/red por el que se llega a aMule
      - AMULE_PORT=4712 # External Connections de aMule
      - AMULE_PWD=CAMBIA_ESTO # == GUI_PWD de aMule
      - PORT=3000
      - ALLOWED_CATEGORIES=radarr-amule,sonarr-amule # deben coincidir con las categorías del download client en Radarr/Sonarr
      - DATA_DIR=/config # persiste el tracking de hashes borrados
      - NODE_OPTIONS=--import /keepalive.mjs # workaround de arranque (ver gotchas)
    ports:
      - '4714:3000' # expón el puerto que quieras; Radarr/Sonarr/Cleanuparr apuntan aquí
    volumes:
      - amulerr_config:/config
      - ./keepalive.mjs:/keepalive.mjs:ro
      - downloads:/downloads # MISMO volumen que aMule; necesario para deleteFiles=true
    networks:
      - media # red bridge normal, NO la de la VPN

  amule:
    container_name: amule
    image: ngosang/amule:latest
    restart: unless-stopped
    environment:
      - PUID=1000
      - PGID=1000
      - GUI_PWD=CAMBIA_ESTO # == AMULE_PWD de amulerr
      - WEBUI_PWD=CAMBIA_ESTO
      - MOD_AUTO_RESTART_ENABLED=true
      - MOD_AUTO_RESTART_CRON=0 6 * * *
      # - MOD_AUTO_SHARE_ENABLED=false  # ponlo si aMule crashea con muchos ficheros compartidos
    ports:
      - '4711:4711' # amuleweb
      - '4712:4712' # External Connections (lo usa amulerr)
      - '4662:4662' # ED2K TCP cliente-a-cliente (necesario para High ID)
      - '4665:4665/udp' # ED2K servidor UDP
      - '4672:4672/udp' # eMule extendido + Kademlia UDP
    volumes:
      - downloads:/downloads
      - amule_data:/home/amule/.aMule
    networks:
      - media # o la red de la VPN si quieres a aMule detrás de VPN

volumes:
  downloads:
  amule_data:
  amulerr_config:

networks:
  media:
```

`keepalive.mjs` (fichero junto al compose):

```js
setInterval(() => {}, 2147483647)
```

> Si aMule va detrás de VPN (gluetun, nordlynx…), pon **solo `amule`** en la red
> de la VPN y apunta `AMULE_HOST`/`AMULE_PORT` de amulerr a esa red. aMulerr se
> queda en la red bridge normal.

---

## 3. Variables de entorno

| Variable                               | Descripción                                                                                                                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AMULE_HOST`                           | Host del contenedor de aMule.                                                                                                                                                                           |
| `AMULE_PORT`                           | Puerto de External Connections de aMule (por defecto `4712`).                                                                                                                                           |
| `AMULE_PWD`                            | Contraseña de External Connections (= `GUI_PWD` de aMule).                                                                                                                                              |
| `PORT`                                 | Puerto en el que escucha aMulerr (por defecto `3000`).                                                                                                                                                  |
| `ALLOWED_CATEGORIES`                   | Lista separada por comas de categorías que aMulerr puede crear/tocar en aMule. **Deben ser exactamente las que uses como "Category" en el download client de Radarr/Sonarr.** Cualquier otra se ignora. |
| `DATA_DIR`                             | Directorio de estado persistente (`deleted_hashes.json`). Por defecto `/config`. Monta un volumen o las eliminaciones no se recuerdan al reiniciar.                                                     |
| `NODE_OPTIONS=--import /keepalive.mjs` | Workaround de arranque, ver gotchas.                                                                                                                                                                    |

---

## 4. Gotchas imprescindibles

1. **aMulerr NO detrás de la red de una VPN.** Si comparte el namespace de red
   de un contenedor VPN (`network_mode: service:X` / `container:X`), su servidor
   puede no registrar las rutas de la API al arrancar (todo da 404, incluido
   `/api/v2/auth/login`) de forma intermitente. En red bridge normal funciona
   siempre. aMule sí puede ir tras la VPN.
2. **`keepalive.mjs` + `NODE_OPTIONS=--import /keepalive.mjs`.** Sin esto el
   contenedor puede arrancar, no loguear nada y salir con código 0 en un
   segundo, entrando en bucle de reinicio silencioso.
3. **Monta el mismo volumen `downloads` en aMulerr y en aMule.** Si no,
   `deleteFiles=true` es un no-op silencioso cuando el fichero ya salió de la
   cola activa de aMule.
4. **`ALLOWED_CATEGORIES` debe coincidir** con las categorías del download
   client en Radarr/Sonarr, o los grabs fallan con "categoría no permitida".
5. **`AMULE_PWD` (amulerr) == `GUI_PWD` (aMule).**
6. Si aMule crashea al arrancar con muchísimos ficheros en
   `downloads/complete`: `MOD_AUTO_SHARE_ENABLED=false`.

---

## 5. Configurar Radarr / Sonarr

### Download client (Settings → Download Clients → Add → qBittorrent)

| Campo               | Valor                                                                 |
| ------------------- | --------------------------------------------------------------------- |
| Type                | `qBittorrent`                                                         |
| Name                | `aMulerr`                                                             |
| Host                | host de aMulerr (contenedor o IP)                                     |
| Port                | el que hayas publicado (p. ej. `4714`)                                |
| Username / Password | **vacío** (aMulerr no tiene auth real)                                |
| Category            | `radarr-amule` / `sonarr-amule` (deben estar en `ALLOWED_CATEGORIES`) |
| Priority            | `50` (o menor prioridad que tu qBittorrent real, si tienes)           |

**Remote Path Mappings** (del mismo download client):

| Campo       | Valor                                                             |
| ----------- | ----------------------------------------------------------------- |
| Host        | host de aMulerr                                                   |
| Remote Path | `/downloads`                                                      |
| Local Path  | la ruta a `/downloads` **dentro del contenedor de Radarr/Sonarr** |

### Indexer (Settings → Indexers → Add → Torznab)

| Campo              | Valor                             |
| ------------------ | --------------------------------- |
| Type               | `Torznab`                         |
| Name               | `aMulerr`                         |
| URL                | `http://<host-amulerr>:<puerto>/` |
| RSS                | `No`                              |
| Automatic Search   | `No`                              |
| Interactive Search | `Yes`                             |
| Download Client    | `aMulerr`                         |

> Este fork arregla el _blocklist_ de Radarr/Sonarr (antes bloquear una descarga
> solo la borraba, no la bloqueaba) y el matching de import. No hay que
> configurar nada extra para ello.

---

## 6. Integrar Cleanuparr (limpiar descargas que no avanzan)

### Alta del download client

Settings → Download Clients → Add:

| Campo                | Valor                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------ |
| Type                 | `qBittorrent`                                                                                                |
| URL                  | `http://<host-amulerr>:<puerto>` (usa la **IP del host** si Cleanuparr y aMulerr no comparten red de Docker) |
| Usuario / contraseña | **vacío**                                                                                                    |

### Queue Cleaner

- Activa la regla **Stalled**. Una descarga de aMule sin fuentes se reporta como
  `stalledDL`; tras `max_strikes` pasadas sin progreso, Cleanuparr la elimina +
  blocklist + nueva búsqueda en el _\*rr_.
- La regla Stalled es **global** (afecta también a tus qBittorrent reales, solo
  distingue por `privacy_type`). Elige un `max_strikes` que valga para ambos:

  `tiempo hasta actuar = max_strikes × intervalo del cron` (por defecto 5 min)

  ~10 (≈50 min) es un punto de partida razonable. Súbelo si sueles descargar
  contenido raro (fuentes ed2k lentas) o si prefieres que aMule tenga días para
  encontrar fuentes.

### Qué NO asociar a aMulerr

- **Content / Malware Blocker**: una descarga ed2k es un único fichero; con
  `delete_if_any_file_blocked` podría borrar una descarga de aMule solo por su
  nombre. Excluye las categorías de aMulerr en `ignored_downloads` del job
  (p. ej. `sonarr-amule`, `radarr-amule`) o no lo asocies.
- **Download Cleaner** (seeding por ratio / tiempo / inactividad): aMule no tiene
  modelo de seeding de BitTorrent → esas reglas no evalúan nada útil.

---

## 7. Verificación

```bash
# aMulerr vivo
curl -s http://<host-amulerr>:<puerto>/health          # -> {"ok":true}
curl -s http://<host-amulerr>:<puerto>/api/v2/app/version   # -> v4.6.7

# El feed Torznab responde
curl -s "http://<host-amulerr>:<puerto>/api?t=caps"
```

En Radarr/Sonarr:

1. Test del download client y del indexer → OK.
2. Búsqueda interactiva de una peli/episodio → aparecen resultados de aMule.
3. Grab de uno → aparece en Activity → Queue con progreso/estado.
4. Al completarse → import (Move) y desaparece de la cola.
5. Bloquear una descarga desde la cola → aparece en Activity → Blocklist y no se
   vuelve a coger.

Cleanuparr: en sus logs debe conectar al cliente sin error y, en cada pasada del
Queue Cleaner, loggear `Item on strike number N | reason Stalled` sobre las
descargas atascadas de aMule (no `Download not found in any torrent client`).

---

## 8. Actualizar / rollback

**Actualizar:** `docker compose pull amulerr && docker compose up -d amulerr`
(o Watchtower). El estado persistente (`deleted_hashes.json`) sobrevive.

**Fijar versión:** cambia la imagen a `ghcr.io/dazanestor/amulerr:sha-<short>`.

**Rollback:** vuelve a un `:sha-<short>` anterior y `up -d`.

---

## 9. Notas del fork

- Rama canónica: **`main`** (`combined-auth-categories` es legado).
- CI (`.github/workflows/docker-build.yml`): typecheck + lint + prettier + tests,
  y publica `:latest` (push a `main`) o `:combined` (push a la rama legado), más
  `:sha-<short>` en ambos casos.
- Detalle técnico de todos los arreglos (consistencia de hash, crash de aMule al
  crear categorías, Copy vs Move, `eta`, `clearCompleted`, endpoints para
  Cleanuparr, etc.): ver [`README.md`](../README.md).
