# ZOEMEC — Vercel Hobby Compatibility Patch

**Tipo:** parche de compatibilidad de despliegue (deployment compatibility patch). **NO** es una feature, **NO** es una correccion funcional, **NO** es un cambio de comportamiento. No modifica el RC1 congelado (`ef079b6f29b2147c7e42b0174ec9f791f940683f`, tag `ZOEMEC-PRE-RELEASE-RC1`) de forma conceptual: este commit se agrega ENCIMA de RC1, RC1 en si no se mueve ni se reescribe.

## Problema

El intento real de `vercel deploy --prod --yes` sobre el commit RC1 fallo con el error explicito del propio Vercel:

> `No more than 12 Serverless Functions can be added to a Deployment on the Hobby plan. Create a team (Pro plan) to deploy more.`

## Causa

Cada archivo bajo `api/*.mjs` es, por convencion de Vercel, una Serverless Function fisica independiente. Antes de este parche, `api/` contenia 17 archivos: 12 que ya existian antes de RC1 (asistente IA, generacion de APU, inteligencia de precios, precio de mercado, checkout, webhook de pago, Google Drive, OneDrive, subida de biblioteca, IA visual, status, health) mas 5 nuevos de las Fases 7/8 (`apus.mjs`, `projects.mjs`, `challenge-decisions.mjs`, `technical-memory.mjs`, `export-events.mjs`). 12 + 5 = 17, uno mas que el limite de 12 del plan Hobby.

## Arquitectura antes

```
api/
├── apus.mjs                (Fase 7)
├── projects.mjs             (Fase 7)
├── challenge-decisions.mjs  (Fase 6/6.1)
├── technical-memory.mjs     (Fase 6)
├── export-events.mjs        (Fase 8)
├── health.mjs
├── status.mjs
├── assistant.mjs
├── generate-apu.mjs
├── price-intelligence.mjs
├── market-price.mjs
├── create-checkout.mjs
├── payment-webhook.mjs
├── google-drive.mjs
├── onedrive.mjs
├── upload-library.mjs
└── visual-ai.mjs
```
17 archivos = 17 funciones serverless fisicas.

## Arquitectura despues

Los 5 endpoints de Fases 7/8 mas `health.mjs` (el candidato de menor riesgo: cero llamadores desde el frontend, cero tests dedicados antes de este parche, solo diagnostico manual de administrador) se reubicaron **sin modificar su logica** a `server/api-lib/_route-*.mjs` (fuera de `api/`, por lo tanto Vercel deja de contarlos como funciones independientes). `api/gateway.mjs` es un **router/adapter puro** — no contiene logica de negocio, unicamente importa los 6 handlers reubicados y despacha segun el `pathname` de la solicitud:

```js
const ROUTES = {
  '/api/apus': apusHandler,
  '/api/projects': projectsHandler,
  '/api/challenge-decisions': challengeDecisionsHandler,
  '/api/technical-memory': technicalMemoryHandler,
  '/api/export-events': exportEventsHandler,
  '/api/health': healthHandler,
};
export default async function handler(req, res){
  const pathname = new URL(req.url, 'http://internal.zoemec').pathname;
  const route = ROUTES[pathname];
  if(!route){ res.status(404).json({ error: `Ruta no reconocida: ${pathname}` }); return; }
  return route(req, res);
}
```

`vercel.json` gana 6 `rewrites` explicitos (evaluados ANTES del passthrough generico `/api/:path*`) que mapean cada ruta publica original hacia `/api/gateway`, preservando el `pathname` original visible para la funcion (comportamiento estandar y documentado de `rewrites` en Vercel: el `dest` selecciona que funcion se invoca, pero no altera `req.url`, que sigue reflejando la ruta original solicitada por el cliente):

```
/api/apus               -> /api/gateway
/api/projects           -> /api/gateway
/api/challenge-decisions -> /api/gateway
/api/technical-memory   -> /api/gateway
/api/export-events      -> /api/gateway
/api/health             -> /api/gateway
```

```
api/
├── gateway.mjs           (NUEVO -- router/adapter puro)
├── status.mjs
├── assistant.mjs
├── generate-apu.mjs
├── price-intelligence.mjs
├── market-price.mjs
├── create-checkout.mjs
├── payment-webhook.mjs
├── google-drive.mjs
├── onedrive.mjs
├── upload-library.mjs
└── visual-ai.mjs           (11 sin tocar + 1 router = 12)

server/api-lib/
├── _route-apus.mjs              (reubicado, logica identica)
├── _route-projects.mjs          (reubicado, logica identica)
├── _route-challenge-decisions.mjs (reubicado, logica identica)
├── _route-technical-memory.mjs  (reubicado, logica identica)
├── _route-export-events.mjs     (reubicado, logica identica)
└── _route-health.mjs            (reubicado, logica identica)
```

## Conteo de funciones — evidencia real (no inferida por conteo de archivos)

Verificado con `vercel build` (build local real de Vercel, sin desplegar) contando los directorios `.func` que Vercel genero de verdad en `.vercel/output/functions/api/`:

| | Conteo |
|---|---|
| **ANTES** (antes de este parche, 17 archivos en `api/`) | 17 |
| **DESPUES** (evidencia real de `vercel build`) | **12** |

```
$ vercel build
{"status":"ok", ..., "message":"Build completed successfully."}

$ find .vercel/output/functions/api -maxdepth 1 -name "*.func" -type d | wc -l
12
```
Funciones fisicas resultantes: `assistant.func create-checkout.func gateway.func generate-apu.func google-drive.func market-price.func onedrive.func payment-webhook.func price-intelligence.func status.func upload-library.func visual-ai.func`.

`vercel.json` -> `.vercel/output/config.json` confirma que los 6 rewrites nuevos se generaron correctamente y se evaluan ANTES del passthrough generico (`"src": "^/api/apus$", "dest": "/api/gateway", "check": true`, etc.).

## Rutas consolidadas

| Ruta publica (sin cambio) | Handler fisico antes | Handler fisico despues |
|---|---|---|
| `POST/GET /api/apus` | `api/apus.mjs` | `server/api-lib/_route-apus.mjs` via `api/gateway.mjs` |
| `POST/GET /api/projects` | `api/projects.mjs` | `server/api-lib/_route-projects.mjs` via `api/gateway.mjs` |
| `POST/GET /api/challenge-decisions` | `api/challenge-decisions.mjs` | `server/api-lib/_route-challenge-decisions.mjs` via `api/gateway.mjs` |
| `POST/GET /api/technical-memory` | `api/technical-memory.mjs` | `server/api-lib/_route-technical-memory.mjs` via `api/gateway.mjs` |
| `POST/GET /api/export-events` | `api/export-events.mjs` | `server/api-lib/_route-export-events.mjs` via `api/gateway.mjs` |
| `GET /api/health` | `api/health.mjs` | `server/api-lib/_route-health.mjs` via `api/gateway.mjs` |

**Contrato HTTP visible al frontend: SIN CAMBIO.** Ninguna URL, metodo, forma de request/response, codigo de estado o codigo de error (incluido `409 VERSION_CONFLICT`) cambio. El frontend nunca sabe que 6 rutas fisicamente resuelven a 1 funcion.

**Logica de dominio: SIN CAMBIO.** `calcAPUv2`, Auditor, Challenge, Confidence, Bid Risk, Scenario Engine, Memoria Tecnica, versionado inmutable, `expectedParentVersionId`/`VERSION_CONFLICT`, hashes de snapshot — ningun archivo de dominio (`src/domain/*`) se modifico. Los 6 handlers reubicados son copias mecanicas byte-identicas en su logica (solo cambiaron las rutas relativas de `import`).

**Logica de seguridad: SIN CAMBIO.** `requireAuth`/`requireAdmin`, verificacion de ownership (`ownerUid === authz.uid`), aislamiento por proyecto/APU, `expectedParentVersionId` obligatorio, recalculo server-side de hashes/actor/`approvedBy` — todo se preserva porque son los MISMOS handlers, solo invocados desde un archivo fisico distinto.

## Tests

`test/apiGateway.test.mjs` (nuevo, 13 casos) prueba especificamente el comportamiento del router (no repite la cobertura funcional ya existente en `apusApi.test.mjs`/`projectsApi.test.mjs`/etc, que siguen corriendo tal cual con su import path actualizado):

- Ruta desconocida -> 404 del router.
- `/api/health` con metodo no soportado -> 405 real del handler (nunca 404 del router).
- `/api/health` sin admin -> 401/403 real del handler.
- `/api/projects` sin token -> 401 real del handler.
- `POST/GET /api/projects` -> llega al handler real, crea y lista correctamente.
- `POST /api/apus` create + save-version -> llega al handler real, version avanza correctamente.
- **`VERSION_CONFLICT` (409)** -> se propaga intacto (`code`, `currentVersion`) a traves del router; el estado del servidor NO avanza con el intento fallido (verificado releyendo el APU).
- `/api/apus` con metodo no soportado -> 405 real del handler.
- `POST /api/technical-memory` action=proposal -> llega al handler real.
- `POST /api/challenge-decisions` action=record -> llega al handler real.
- `POST/GET /api/export-events` -> llega al handler real, registra y lista correctamente.

Ningun test existente fue eliminado; solo se actualizo el import path de 7 archivos de test (`apusApi.test.mjs`, `projectsApi.test.mjs`, `challengeDecisionsApi.test.mjs`, `technicalMemoryApi.test.mjs`, `exportEventsApi.test.mjs`, `apuIdStability.e2e.test.mjs`, `legacyMigrationRetry.e2e.test.mjs`) para apuntar a la nueva ubicacion de los handlers.

### Resultados (regresion completa, con emuladores reales de Firestore+Auth)

| Suite | Antes de este parche (baseline) | Despues de este parche |
|---|---|---|
| `npm test` | 638/638 | 638/638 |
| `npm run test:projects` | 33/33 | 33/33 |
| `npm run test:security` | 130/130 | **143/143** (130 + 13 nuevos del router) |
| `npm run test:rules` | 42/42 | 42/42 |
| `npm run test:memory` | 3/3 | 3/3 |
| `rm -rf dist && npm run build` | PASS | PASS |

## Riesgos

1. **Margen cero.** Este parche llega EXACTAMENTE a 12 funciones (el limite exacto del plan Hobby). Cualquier archivo NUEVO agregado a `api/` en el futuro (una feature nueva, otro endpoint) volvera a romper el limite y necesitara sumarse al router existente (o crear un segundo router) antes de poder desplegarse.
2. **Comportamiento de `req.url` bajo `rewrites` verificado por configuracion, no por una solicitud HTTP real en produccion.** Se confirmo con evidencia real que `vercel build` genera la configuracion de rutas esperada (`.vercel/output/config.json` con los 6 rewrites hacia `/api/gateway`, evaluados antes del passthrough generico) y que esto corresponde al comportamiento oficial y documentado de Vercel (`dest` en un rewrite no altera `req.url`, que sigue reflejando la ruta original). No fue posible verificarlo con una solicitud HTTP real contra una funcion Vercel en ejecucion en esta etapa: `vercel dev` en este proyecto delega el manejo de rutas a `vite --port $PORT` (el `devCommand` del framework detectado), no a la emulacion de funciones lambda de Vercel, por lo que una prueba local de extremo a extremo del router requiere un despliegue real — explicitamente fuera de alcance de esta etapa ("No deploy todavia"). Queda como verificacion pendiente para la etapa de publicacion/QA en produccion.
3. **`health.mjs` se selecciono como el 6o endpoint a consolidar por ser el de menor riesgo (cero llamadores en el frontend, cero tests antes de este parche, uso exclusivo de un administrador para diagnostico manual) — no por ser candidato natural del mismo dominio que los otros 5.** Se documenta explicitamente para que quede claro que fue una decision de minimizar riesgo de la migracion, no una agrupacion arquitectonica "logica".

## Rollback

Este commit se agrega ENCIMA de RC1 sin mover el tag `ZOEMEC-PRE-RELEASE-RC1`. Revertir el parche completo (volver al estado exacto de RC1) es un `git revert` de este commit unico, o simplemente desplegar el commit RC1 original (`ef079b6f29b2147c7e42b0174ec9f791f940683f`) en vez de este. No se elimino informacion: los 6 archivos originales de `api/*.mjs` existen intactos en el historial de git bajo el commit RC1.
