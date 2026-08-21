# ZOEMEC RC4 — Fase 2: Planos IA / Takeoff asistido (informe de cierre)

Rama: `rc4-biblioteca-planos` (misma rama de Fase 1). RC3 intacto. Sin deploy.

## 1. Arquitectura implementada (según lo aprobado)

- **Sin rasterización propia.** Hallazgo de diseño clave: la Responses API de OpenAI acepta `input_file` con el PDF en base64 y, para modelos con visión, extrae automáticamente texto + imagen de cada página server-side (en OpenAI, no en nuestra función). Esto evitó por completo el problema de canvas nativo que motivó la decisión de `pdfjs-dist` en Biblioteca.
- **Persistencia: Opción A aprobada.** Reutiliza `visual_requests` (cero cambios a `firestore.rules`). Campos nuevos: `mode:'takeoff'`, `takeoffSchemaVersion:1`, `elementos[]`, `resumenAnalisis`, `numPages`, `resultadoParcial`, `elementosDescartados`, `elementosInvalidosCount`, `usage`.
- **Endpoint único ampliado:** `api/visual-ai.mjs` gana `action:'takeoff'` y `action:'reviewElement'` (además de la acción por defecto, sin `action`, que es 100% el comportamiento actual de fachada/render — verificado sin cambios). Cero funciones serverless nuevas (**12/12** confirmado).
- **`runTakeoffAnalysis` extraída como función independiente** (llamada real a OpenAI + validación determinista, sin tocar Firestore) para poder probarse de forma aislada — esta separación fue la que permitió ejecutar la validación real de este informe sin necesitar credenciales de Firebase Admin.
- **Tope de 10 páginas:** implementado como rechazo duro (`assertPageLimit`, HTTP 413) con el mensaje exacto que pediste. **El selector "Página inicial → Página final" NO se implementó** — usaste tú mismo la cláusula de escape ("puede quedar como mejora inmediata posterior").
- **Tope de elementos y tamaño de documento:** máximo 60 elementos por análisis; presupuesto de ~700KB de JSON serializado, con truncado controlado.
- **Validación determinista server-side** (`server/api-lib/_planoValidate.mjs`): el modelo **nunca** propone `estado`; siempre lo calcula el validador.
- **Regla dura de escala** (`enforceScaleRule`): si `fuenteEscala==='no_determinada'`, la cantidad se anula y el estado pasa a `REQUIERE_REVISION`, sin importar lo que el modelo haya puesto. **Confirmado también con una llamada real (§5).**
- **`confianzaIA` y `estadoRevision` separados** en todo momento.
- **Sin overlays ni bounding boxes.**
- **Gate único hacia el APU** (`toApuSeed`): solo `VALIDADO_POR_USUARIO` produce una semilla.
- **Puente a Biblioteca:** reutiliza `action:'similarMatrices'` de `api/upload-library.mjs`.
- **Puente a APU (UI):** semilla vía `localStorage` + precarga del panel de IA, sin auto-generar.

## 2. Archivos modificados / agregados

**Modificados:** `api/visual-ai.mjs` (+`action` dispatch, `runTakeoffAnalysis`, `storeOriginalPlano`, `takeoffAnalyze` corregido y con almacenamiento, `reviewTakeoffElement`, comportamiento por defecto intacto), `server/api-lib/_libraryExtract.mjs` (+`countPdfPages`), `server/api-lib/_libraryClassify.mjs` (sin cambios nuevos en esta ronda, reutilizado), `src/main.jsx` (pestaña "Takeoff de plano", componente `PlanoTakeoff` con botón "Abrir plano original", precarga en `APU`), `test/firestore.rules.test.mjs` (+4 pruebas).

**Nuevos:** `src/domain/planoReview.js` + test (14 casos), `server/api-lib/_planoValidate.mjs` + test (19 casos), `test/plano-takeoff.e2e.test.mjs` (3 casos E2E simulados), `test/planoStorage.test.mjs` (3 casos de almacenamiento).

**Sin cambios (protegido, verificado con `git diff --stat`):** `firestore.rules`, `storage.rules`, `src/lib/apuCalc.js`, `src/lib/apuExportV2.js`, `src/lib/apuExport.js`, `server/api-lib/_authGuard.mjs`, `server/api-lib/_firebaseAdmin.mjs`, `vercel.json`.

## 3. Pruebas automatizadas

- **`npm test`: 218/218 PASS** (incluye 3 pruebas de almacenamiento agregadas en la ronda de esta sesión, ver §7). **`npm run test:security` (emulador real): 32/32 PASS.** **Build: PASS.** `npm audit`: 11 vulnerabilidades moderadas preexistentes, cero nuevas.
- Casos cubiertos: sin escala → `cantidad=null`+`REQUIERE_REVISION`; escala válida → `PROPUESTO_POR_IA`; rechazado/pendiente → nunca `apuSeed`; validado → sí `apuSeed`; cantidad negativa/NaN/Infinity → rechazo determinista; página inválida → no se persiste; PDF >10 páginas → rechazo controlado; respuesta fuera de schema → error controlado; >60 elementos → parcial controlado.

## 4. Trazabilidad

Cada elemento conserva: `visualRequestId`, `fileName`, `pagina`, `evidencia`, `tipo`, `descripcion`+`descripcionOriginalIA`, `cantidadPropuesta`/`cantidadOriginalIA`, `unidad`/`unidadOriginalIA`, `confianzaIA`, `fuenteEscala`, `cantidadCorregida`, `unidadCorregida`, `estado`, `validatedBy`, `validatedAt`, `motivo`. **No implementado:** vínculo automático `matriz seleccionada → apuId` escrito de vuelta al documento del plano (el usuario selecciona y genera manualmente).

---

## 5. VALIDACIÓN REAL con OpenAI (nueva evidencia de esta ronda)

Se generó un **plano de prueba real** (PDF vectorial válido, no simulado, con texto real embebido — verificado con nuestro propio extractor de PDF antes de usarlo) con **ground truth conocido de antemano**, y se llamó **tres veces** a la API real de OpenAI vía `runTakeoffAnalysis` (sin mocks). Se entregaron al usuario el plano de prueba y los archivos XLSX/PDF generados como evidencia.

### Llamada #1 — Plano "Oficina 1" (con cotas y escala reales)

| Métrica | Valor real medido |
|---|---|
| Modelo | `gpt-4.1-mini` |
| Tamaño del PDF | 6,184 bytes |
| Páginas | 1 |
| Tiempo de respuesta | 10,474 ms |
| Tokens entrada / salida | 834 / 686 |

**Ground truth (definido al construir el plano) vs. detección real de OpenAI:**

| Elemento | Ground truth | Detectado por OpenAI | Coincide |
|---|---|---|---|
| Muro Norte | 8.00 m | 8 m, confianza 95%, `cotas_texto` | ✅ exacto |
| Muro Sur | 8.00 m | 8 m, confianza 95%, `cotas_texto` | ✅ exacto |
| Muro Este | 5.00 m | 5 m, confianza 95%, `cotas_texto` | ✅ exacto |
| Muro Oeste | 5.00 m | 5 m, confianza 95%, `cotas_texto` | ✅ exacto |
| Piso (8.00×5.00) | 40.00 m² | 40 m², confianza 98%, `cotas_texto` | ✅ exacto |
| Puerta P1 | 1 pieza (0.90×2.10 m) | 1 unidad, confianza 98%, `cotas_texto` | ✅ exacto |
| Ventanas V1+V2 | 2 piezas (1.20×1.00 m c/u) | agrupadas: 2 unidades, confianza 98%, `cotas_texto` | ✅ exacto (agrupó correctamente, como autoriza el prompt) |

**7 de 7 elementos coincidieron exactamente con el ground truth. Cero dimensiones inventadas. Ningún elemento llegó con `estado` distinto de `PROPUESTO_POR_IA` (el modelo nunca se autoasignó validación).** Toda la evidencia citada por el modelo correspondía textualmente al texto real que se dibujó en el PDF.

### Llamada #2 — Croquis sin cotas ni escala ("BODEGA")

El modelo, correctamente, **no propuso ningún elemento** ante la ausencia total de cotas o escala — comportamiento conservador válido, aunque no ejercitó la ruta de "elemento identificado pero sin cantidad".

### Llamada #3 — Muro y puerta rotulados explícitamente, sin cotas

| Elemento | Respuesta real del modelo | Después del validador determinista |
|---|---|---|
| "Muro perimetral" | `cantidadPropuesta:null`, `fuenteEscala:"no_determinada"` | `estado:"REQUIERE_REVISION"` (el modelo ya lo puso bien; el validador lo confirma) |
| "Puerta de acceso" | `cantidadPropuesta:null`, `fuenteEscala:"no_determinada"` | `estado:"REQUIERE_REVISION"` |

**Confirmado con datos reales (no solo simulados):** cuando no hay escala confiable, el resultado final es siempre `cantidad=null` + `REQUIERE_REVISION`. En estas dos llamadas el modelo ya se comportó correctamente por sí solo; la garantía dura de que esto ocurre **aunque el modelo se equivoque** sigue estando probada de forma determinista en `_planoValidate.test.mjs` (con entradas construidas a propósito para violar la regla), que es el lugar correcto para probar el caso adversarial sin depender de que un modelo real "falle a propósito".

### E2E completo con datos reales (Llamada #1)

1. **Revisión humana real:** "Muro Norte" → `VALIDADO_POR_USUARIO` con corrección de cantidad **8.00 → 8.05 m** (simulando medición en obra), `validatedBy:"diana@zoemec.com"`. "Ventanas V1 y V2" → `RECHAZADO` con motivo ("se cotizarán por separado en el paquete de cancelería").
2. **Gate hacia APU:** de los 7 elementos detectados, **solo 1 produjo una semilla de concepto** (el validado); los 6 restantes (incluido el rechazado) quedaron fuera, confirmado en código real, no simulado.
3. **Biblioteca (motor real, `searchLibrary`/`findSimilarMatrices`):** con un catálogo de prueba de 2 matrices, encontró **"Muro de block hueco 15cm.xlsx"** como coincidencia real (score 5–7, término coincidente "muro"), con evidencia explicable.
4. **Motor APU real:** `templateFallbackAPU → migrateLegacyApuToV2 → applyConceptMetadataV2 → finalizeProfessionalAPU` generó un APU real: clave `APU-1VRLXR`, concepto "Muro Norte", unidad "m", **cantidad 8.05** (la corregida, no la original de 8 de la IA), **Costo directo $767.14, Precio Unitario $994.79, Importe total $8,008.07** (= 994.79 × 8.05, verificado).
5. **Exportadores RC3 reales (sin tocar):** XLSX de 11,429 bytes y PDF de 34,259 bytes generados exitosamente. **El PDF contiene literalmente "8.05" y "Muro Norte"** — la cantidad corregida por el usuario, no la original de la IA, quedó trazable hasta el documento final.

Los tres archivos (plano de prueba, XLSX y PDF generados) se entregaron al usuario como evidencia adjunta a este informe.

## 6. Costo — ahora con mediciones reales (ya no solo teórico)

| Llamada | Páginas | Tamaño PDF | Tiempo | Tokens entrada/salida | Costo estimado (`gpt-4.1-mini`: $0.40/$1.60 por 1M) |
|---|---|---|---|---|---|
| #1 (con cotas) | 1 | 6,184 B | 10.47 s | 834 / 686 | ≈ $0.00034 + $0.00110 = **$0.00144 USD** |
| #2 (sin cotas, 0 elementos) | 1 | 3,701 B | 2.60 s | — (no capturado, respuesta vacía) | — |
| #3 (rotulado, sin cotas) | 1 | 3,859 B | 4.48 s | 700 / 248 | ≈ $0.00028 + $0.00040 = **$0.00068 USD** |

**Advertencia honesta:** estas 3 llamadas son sobre un plano sintético simple de 1 página. El costo real con planos profesionales multipágina (más texto, imágenes más densas) será mayor — la estimación previa de $0.005–0.01 por análisis de 3 páginas sigue siendo razonable como orden de magnitud, ahora respaldada por al menos una medición real, pero **sigue sin ser una métrica validada contra planos de producción reales**.

## 7. Almacenamiento del plano — IMPLEMENTADO

Exactamente la solución mínima propuesta, sin ampliar alcance:

- **Ruta:** `visual/{uid}/{visualRequestId}/{fileName}` — coincide con la regla **ya vigente** en `storage.rules` (`match /visual/{uid}/{fileId}/{fileName} { allow read, write: if isOwner(uid); }`). **Cero cambios a `storage.rules` ni a `firestore.rules`** (confirmado con `git diff --stat`, ambos archivos sin diferencias).
- **Función nueva** `storeOriginalPlano()` en `api/visual-ai.mjs`: reutiliza `getAdminStorage()` (ya existente en `_firebaseAdmin.mjs`, mismo mecanismo que Biblioteca) para `bucket.file(path).save(buffer)` + `getSignedUrl` de larga duración, y `sanitizeFileName()`/`MAX_UPLOAD_BYTES` (ya existentes en `_libraryClassify.mjs`, reutilizados tal cual de Biblioteca).
- **Campos nuevos en el mismo documento `visual_requests`** (cero colección nueva): `storagePath`, `downloadURL`, `fileHash` (SHA-256 con `node:crypto`, sin dependencia nueva), `fileSize`, `fileStored`, `storageError`.
- **Límite:** mismo `MAX_UPLOAD_BYTES` (15 MB) de Biblioteca. Si el plano lo excede, el análisis se guarda igual; el archivo original no, con la razón explícita en `storageError` — nunca falla el análisis completo por esto.
- **Nunca finge éxito:** si Storage falla por cualquier motivo, `fileStored:false` + `storageError` con el mensaje real, y el análisis (ya calculado y validado) se persiste de todos modos.
- **UI mínima:** en el resultado de Takeoff se muestra el nombre del plano y, si `fileStored`, un botón "Abrir plano original" (usa la infraestructura existente — el mismo patrón `window.open(downloadURL)` que Biblioteca). Si no se pudo almacenar, se muestra la razón en vez de un botón roto.
- **Bug real encontrado y corregido en este paso:** al revisar `takeoffAnalyze` para agregar el almacenamiento, encontré que la persistencia a `visual_requests` referenciaba una variable `data` fuera de alcance (arrastrada de un refactor anterior) — habría lanzado un error en cualquier análisis real vía HTTP. **Nunca se había ejercitado porque la validación real de la ronda anterior llamó directamente a `runTakeoffAnalysis` (sin Firestore), no al endpoint HTTP completo.** Corregido como parte de este cambio.

### Hallazgo durante la prueba de almacenamiento: credenciales de Firebase Admin redactadas en este entorno

Al intentar probar una escritura real a Storage, `FIREBASE_SERVICE_ACCOUNT_JSON` en `.env.local` resultó ser un **placeholder redactado** (`"[SENSITIVE]"`, 13 caracteres), no una credencial real — coherente con las prácticas de manejo de secretos, pero significa que **no pude verificar una escritura EXITOSA real a Firebase Storage en este entorno**, igual que ya ocurrió con Google Drive/OneDrive en la Fase 1. Lo que sí verifiqué con pruebas reales:
- Un archivo que excede 15 MB nunca intenta Storage (probado, determinista).
- Con la credencial redactada presente, la función intenta Storage y **falla honestamente** (`fileStored:false` + `storageError` con el mensaje real de la falla) — nunca reporta éxito falso. Este es exactamente el comportamiento defensivo requerido, verificado con una condición de fallo real (no simulada).
- El cálculo de hash SHA-256 es determinista para el mismo contenido (probado).
- **Repetí la llamada REAL a OpenAI** (`runTakeoffAnalysis`) después del refactor para confirmar que decodificar el buffer una sola vez (reutilizado ahora también para Storage) no rompió nada: numPages, tamaño de buffer devuelto (exacto) y elementos detectados, todo correcto.

## 8. Limitaciones conocidas (actualizado)

- Sin selector de rango de páginas (autorizado diferir).
- **Almacenamiento del plano implementado**, pero su éxito real en producción (escritura efectiva a Firebase Storage) no se pudo verificar en este entorno por credenciales redactadas — sí se verificó el comportamiento de fallo honesto y el límite de tamaño.
- Sin vista lado a lado del plano.
- Sin edición del campo "tipo".
- La ruta adversarial (modelo intentando reportar una cantidad pese a `no_determinada`) está probada de forma determinista y exhaustiva en `_planoValidate.test.mjs`, no en una llamada real — en las 2 llamadas reales sin escala, el modelo ya se comportó honestamente por sí solo, sin necesitar el correctivo.
- No se probó aún con un plano profesional de producción real (CAD/escaneado), solo con un plano de prueba sintético pero vectorial-real.

## 9. Diferencia RC3 → RC4 (Fase 1 + Fase 2 combinadas)

RC3: Biblioteca básica + Visual IA como generador de render/narrativa. RC4: Biblioteca con extracción/búsqueda/matrices reales; Planos IA con detección real (validada con OpenAI real y ground truth conocido), barrera determinista contra medidas inventadas, y flujo completo `PLANO → TAKEOFF IA REAL → REVISIÓN → BIBLIOTECA → MATRIZ → APU → MOTOR → XLSX/PDF`, sin tocar motor, exportadores, reglas ni el límite de 12 funciones.

---

## Verificación final de esta ronda

- **`npm test`: 218/218 PASS** (215 anteriores + 3 nuevas de `test/planoStorage.test.mjs`).
- **`npm run test:security` (emulador real): 32/32 PASS** (sin cambios: el almacenamiento reutiliza reglas ya probadas, no se necesitaron casos nuevos).
- **Build: PASS.**
- **12/12 funciones serverless** confirmado (`ls api/*.mjs`).
- **Takeoff real sigue funcionando:** repetí una llamada real a OpenAI después del refactor (necesario para reutilizar el buffer decodificado también para Storage) — resultado correcto, sin regresión.
- **El archivo queda realmente "en camino a almacenarse":** la ruta de código se ejecuta de verdad contra Firebase Storage (no es una simulación en el código), pero no pude confirmar una escritura exitosa real en este entorno por la credencial redactada (ver §7). Si tienes credenciales reales de `FIREBASE_SERVICE_ACCOUNT_JSON` disponibles para probar antes del deploy, puedo repetir esta verificación específica bajo tu autorización.
- **Aislamiento entre usuarios:** cubierto por las 4 pruebas ya existentes de `visual_requests` en `test/firestore.rules.test.mjs` (un documento privado de otro usuario, con `storagePath`/`downloadURL` incluidos, sigue siendo ilegible) — no fue necesario agregar una prueba nueva porque el archivo es un campo más del mismo documento ya protegido.
- **XLSX/PDF sin regresión:** `npm test` incluye `test/apuExport.*.test.mjs` y `test/apuExportV2.integration.test.mjs` sin cambios, todos PASS; el E2E real de la ronda anterior (Muro Norte, PU $994.79) sigue siendo válido — no se tocó ningún exportador en este paso.

## 10. Deploy final y validación productiva real (commit `d5264d9`, tag `ZOEMEC-CONCURSO-RC4`)

### 10.1 Dos defectos reales encontrados en producción tras el primer deploy — corregidos

Al validar el candidato en Vercel (no en local) aparecieron dos fallas reales, ambas causadas por cómo `pdfjs-dist` se comporta en el runtime serverless Linux de Vercel (nunca aparecieron en local porque el disco de desarrollo sí tenía el binario nativo opcional `@napi-rs/canvas` instalado):

1. **`DOMMatrix is not defined`.** `pdfjs-dist` define `const SCALE_MATRIX = new DOMMatrix()` a nivel de módulo; sin el polyfill nativo de `@napi-rs/canvas` (que Vercel no empaqueta porque su `require` es dinámico y no rastreable), esto rompía la carga del extractor antes de leer una sola página. **Corregido** con `server/api-lib/_pdfEnvPolyfill.mjs`: una implementación pura en JavaScript de los métodos exactos que `pdfjs-dist` invoca sobre `DOMMatrix` (`multiplySelf`, `preMultiplySelf`, `invertSelf`, `translate`, `scale`, `rotate`), verificada con 10 pruebas unitarias contra matemática de matrices calculada de forma independiente.
2. **`Setting up fake worker failed: Cannot find module '.../pdf.worker.mjs'`.** Tras el fix anterior, `pdfjs-dist` intenta cargar su worker (real o "fake") con un `import()` dinámico no rastreable por el empaquetador de funciones de Vercel. **Corregido** usando la salida oficial documentada por `pdfjs-dist` para bundlers: un `import` **estático** (literal, sí rastreable) de `WorkerMessageHandler` desde `pdfjs-dist/legacy/build/pdf.worker.mjs`, expuesto en `globalThis.pdfjsWorker.WorkerMessageHandler` antes de invocar `getDocument()` — con eso `pdfjs-dist` nunca intenta el `import()` dinámico.

Ambos fixes se verificaron localmente **reproduciendo exactamente la condición de fallo** (moviendo `node_modules/@napi-rs` fuera de sitio para simular la ausencia del binario que existe en Vercel pero no en el disco de desarrollo) antes de reincluirlo, y luego con una validación productiva real en el navegador (ver 10.3).

### 10.2 Decisión del usuario: Firebase Storage NO se activa para este concurso

Un tercer hallazgo — `"The specified bucket does not exist"` — **no es un defecto de código**: Firebase Storage nunca se habilitó para este proyecto (plan Spark, requiere upgrade de facturación para activarse). El usuario verificó esto personalmente en Firebase Console y decidió, de forma explícita y definitiva:

> "CAMBIO DE DECISIÓN PARA RC4 — NO ACTIVAR FIREBASE STORAGE. Ya verifiqué personalmente Firebase Console. El proyecto zoemec-plataforma-ia está en plan Spark y Firebase muestra: 'Para usar Storage, actualiza el plan de precios de tu proyecto'. Por lo tanto: NO voy a activar Storage, NO voy a actualizar el plan y NO quiero introducir facturación para presentar ZOEMEC al concurso."

En consecuencia, el almacenamiento del archivo original del plano se implementó como **completamente opcional**: `storeOriginalPlano()` nunca lanza; cuando Storage no está disponible devuelve `fileStored:false`, `storagePath:null`, `downloadURL:null` y un `storageError` con un mensaje claro para el usuario — pero **siempre** calcula el hash SHA-256 del archivo (con `node:crypto`, sin dependencia nueva), que es la trazabilidad que sobrevive incluso sin bucket. El soporte de Storage **no se eliminó**: el código sigue intacto y listo para funcionar el día que se active el plan, sin ningún cambio adicional.

**Prueba de regresión obligatoria** (`test/planoStorage.test.mjs`, prueba `REGRESION: Storage no configurado no bloquea Takeoff -> revision humana -> APU -> XLSX/PDF`): ejercita el pipeline completo — Storage falla de forma controlada → resultado de Takeoff se conserva íntegro → revisión humana (`VALIDADO_POR_USUARIO`) → semilla real de APU → motor real (`finalizeProfessionalAPU`) → exportadores reales XLSX/PDF — sin una sola excepción no controlada en ningún punto, confirmando que un bucket ausente nunca produce un HTTP 500 ni pérdida de resultados.

### 10.3 Validación productiva real (navegador, `https://zoemec-plataforma-ia.vercel.app/`, deployment `dpl_CA6uHjX6nxg2UJJohYaypF814qHF`)

Con un PDF vectorial real de prueba (`MURO NORTE: 8.00 m`, `MURO SUR: 8.00 m`, altura 2.50 m, escala 1:75) subido directamente en producción:

1. **Takeoff real vía OpenAI:** análisis exitoso, **2/2 elementos detectados exactos** contra el ground truth conocido (Muro Norte 8 m, Muro Sur 8 m, ambos `fuenteEscala:cotas_texto`, confianza 90%, estado inicial `Propuesto por IA`, evidencia textual correcta).
2. **Mensaje de Storage deshabilitado, mostrado correctamente:** *"Plano original no almacenado: Firebase Storage no esta habilitado en este entorno (plan Spark, sin bucket). El plano original no se almaceno; el analisis, la revision humana y el APU funcionan igual con la evidencia y el hash SHA-256 del archivo."* — y el botón **"Abrir plano original" correctamente ausente** (nunca se ofrece un botón que no funcionaría).
3. **Revisión humana real:** "Muro Norte" → clic en "Validar" → estado cambió a `Validado · dianalopez161184@gmail.com` (el validador se registra en el servidor a partir de la sesión autenticada, nunca del cliente).
4. **Biblioteca (motor real):** "Matrices similares" sobre "Muro Norte" → `Sin matrices similares reales encontradas` (resultado válido: no hay conceptos de biblioteca cargados que coincidan por palabra clave en este proyecto de prueba — el motor de búsqueda respondió, simplemente no había coincidencias).
5. **Puente real a APU Inteligente:** "Usar en APU" navegó al módulo, mostró las dos notificaciones de precarga, y abrió el formulario con concepto `"Muro Norte"`, unidad `"m"`, cantidad `"8"` precargados — **sin auto-generar**, exactamente como se diseñó.
6. **Generación real con OpenAI:** clic en "Generar APU con IA real" produjo un APU real y completo (`APU-NYSXHD`, "Generado con OpenAI"): unidad final `m²` (decisión propia del motor de generación de APU de RC3, sin tocar — un muro se valora profesionalmente por superficie, no por longitud; el "m" de Takeoff fue solo una pista, no una imposición), cantidad `8.00`, **Precio Unitario $795.51, Costo Directo $613.47, Importe $6,364.11, Confianza IA 69% MEDIA, estado "Revisión necesaria"** (26 observaciones — el motor de RC3 exige igualmente revisión profesional antes de dar por bueno un precio, un segundo nivel de control independiente del de Takeoff).
7. **Exportadores reales, verificados byte a byte:** Excel y PDF descargados desde producción. **PANTALLA = XLSX = PDF, verificado numéricamente:** `795.5138202` → `$795.51`; `6364.1105616` → `$6,364.11`; costo directo `$613.47` reconstruido por suma de categorías (mano de obra $240.00 + materiales $357.15 + equipo $7.40 + herramienta $7.20 + seguridad $1.71 = $613.46 ≈ $613.47); "Muro Norte", "8.00", "69% MEDIA" presentes en ambos archivos.

### 10.4 Regresión final completa (post-fix, sobre el candidato ya desplegado)

- **`npm test`: 230/230 PASS.**
- **`npm run test:security` (emulador real de Firestore/Auth): 32/32 PASS.**
- **`npm run build`: PASS.**
- **12/12 funciones serverless** (`ls api/*.mjs`), sin cambios respecto al límite de Vercel Hobby.
- **Cero cambios** desde `ZOEMEC-CONCURSO-RC3` en: `firestore.rules`, `storage.rules`, `src/lib/apuCalc.js`, `src/lib/apuExportV2.js`, `src/lib/apuExport.js`, `server/api-lib/_authGuard.mjs`, `vercel.json`, `src/domain/apuGeneration.js`, `src/domain/apuSchema.js`, `src/domain/apuProfessional.js` (confirmado con `git diff --stat`).
- **Aislamiento entre usuarios:** cubierto por las pruebas ya existentes de `visual_requests` en `test/firestore.rules.test.mjs` (sin necesidad de una prueba productiva adicional de Storage, ya que Storage está deshabilitado por decisión y el documento de Firestore — con o sin campos de almacenamiento — ya está probado como privado por usuario).

## ¿RC4 ESTÁ LISTO PARA DEPLOY DE CONCURSO?

**ZOEMEC RC4 — LISTO PARA CONCURSO.**

Commit `d5264d9`, tag `ZOEMEC-CONCURSO-RC4`, deployment `dpl_CA6uHjX6nxg2UJJohYaypF814qHF`, URL `https://zoemec-plataforma-ia.vercel.app/`.

Quedó demostrado con evidencia real de producción (no simulada): la llamada a OpenAI funciona en el runtime real de Vercel tras corregir dos defectos reales de empaquetado de `pdfjs-dist`; la detección de elementos es exacta contra el ground truth conocido; la regla de "no inventar medidas" y la barrera determinista de escala se sostienen; el gate único hacia el APU es real (solo `VALIDADO_POR_USUARIO` pasa, con validador registrado por el servidor); Biblioteca responde con su motor real; el flujo completo `PLANO → TAKEOFF IA REAL → REVISIÓN HUMANA → BIBLIOTECA → PUENTE A APU → MOTOR REAL → XLSX/PDF` corrió de punta a punta en producción con números verificados PANTALLA=XLSX=PDF; y el sistema completo sigue funcionando de forma correcta y honesta con Firebase Storage deshabilitado.

**Limitación a comunicar textualmente ante el jurado:**

> "La persistencia del archivo original del plano mediante Firebase Storage está preparada pero deshabilitada en el despliegue actual por infraestructura del plan Spark. El análisis Takeoff, la evidencia, la revisión humana y la generación APU funcionan independientemente."

**Otras limitaciones conocidas, sin prometer de más:**
1. Sin selector de rango de páginas — un PDF de más de 10 páginas se rechaza completo.
2. Sin vista lado a lado del plano — solo tabla de elementos + página + evidencia textual.
3. Sin overlays, bounding boxes, CAD/BIM ni medición geométrica por píxeles — por diseño, es el alcance declarado del producto (Takeoff asistido, no un CAD).
4. Sin edición del campo "tipo" en la revisión humana (sí: descripción, cantidad, unidad, motivo de rechazo).
5. No se probó con un plano profesional de producción real (CAD exportado o escaneado) — los planos usados fueron sintéticos pero vectoriales-reales, con ground truth conocido de antemano.
6. Vínculo automático "matriz seleccionada → apuId" no se escribe de vuelta al documento del plano — el usuario selecciona y genera el APU manualmente.

**RC4 está desplegado y congelado para el concurso.** No se desarrollarán nuevas funcionalidades ni se creará RC5 salvo que aparezca un defecto bloqueante real.
