# ZOEMEC RC4 — Biblioteca MVP (informe de cierre)

Rama: `rc4-biblioteca-planos` (creada desde RC3 = `29bef1f` / tag `ZOEMEC-CONCURSO-RC3`). RC3 no fue tocado. Planos/Takeoff **no** se inició — queda como Fase 2 pendiente de autorización.

## 1. Inventario de biblioteca (evidencia entregada por el usuario)

No se pudo inventariar en vivo (conector Drive de esta sesión sin scope, credenciales de la app no configuradas ni local ni en producción). El usuario aportó evidencia real de las carpetas 01, 02, 04, 06, 10 y 11: ZIPs de 8 MB a ~1.96 GB, carpetas OPUS/NEODATA/CMIC/BIMSA/Construbase/Prisma, y archivos pequeños (`FASAR OPUS.xlsx`, PDF/TXT de instrucciones). Esta evidencia definió la estrategia híbrida implementada (§3).

## 2. Qué ya existía (Fase 1, confirmado por auditoría de código)

| Función | Estado antes de RC4 |
|---|---|
| Listar/importar Google Drive (1 archivo) | Real, con autorización de árbol y export de Docs/Sheets nativos |
| OneDrive (OAuth + import) | Real, pero solo listaba la raíz |
| Subida manual | Real (1 archivo, base64) |
| Clasificación por nombre | Real pero heurística, sin leer contenido |
| Búsqueda en Biblioteca | Real solo sobre metadata (cliente); "Buscar con IA" era `alert()` |
| Matrices similares / Extraer insumos / Usar para generar APU | **Placeholder** (`alert()` literal) |
| Trazabilidad de ruta/carpeta origen | No existía (solo nombre de archivo) |
| Visual IA | Generador de render + narrativa (OpenAI), sin relación con Biblioteca ni takeoff |

## 3. Qué se implementó en RC4

**Estrategia híbrida (autorizada):** archivos ≤15 MB y no-ZIP se descargan, extraen e indexan; ZIP (cualquier tamaño) y archivos >15 MB quedan como `REFERENCIA EXTERNA` (metadata real, sin copiar contenido).

- **Importación selectiva Google Drive** (`api/google-drive.mjs`): decide descarga vs. referencia externa (`decideImportMode`), construye breadcrumb real de carpeta origen (`buildDriveBreadcrumb`), extrae contenido cuando aplica.
- **Extracción real** (`server/api-lib/_libraryExtract.mjs`): Excel/CSV (heurística de encabezados propia, sin duplicar `parseCatalogRows` del navegador) y PDF de texto (`pdfjs-dist`, solo API de texto — ver §4). DOCX/DOC: `extraction.status='unsupported'`, el documento sigue visible en Biblioteca.
- **Búsqueda por contenido y "matrices similares"** (`server/api-lib/_librarySearch.mjs`): keyword/heurística determinista, explícitamente **no** semántica ni IA; cada resultado expone score, términos e insumos coincidentes (nunca un número opaco).
- **Revisión humana** (`src/domain/libraryReview.js`): estados `PROPUESTO/VALIDADO/RECHAZADO`; `extractValidatedCatalogRows` es la ÚNICA puerta hacia el catálogo, y exige usuario+fecha para validar/rechazar.
- **Puente Biblioteca → APU**: reutiliza el mecanismo real ya existente (`matchPrice` + `catalog` que consumen `domain/apuGeneration.js` y el prompt de `_openaiApuCore.mjs`). Cero motor nuevo. Solo insumos `VALIDADO` se fusionan al catálogo (`Library.handleUseValidatedInApu` en `src/main.jsx`).
- **Endpoint único ampliado** (`api/upload-library.mjs`): mismo archivo, acciones nuevas (`search`, `similarMatrices`, `extractInsumos`, `confirmInsumos`) además de la subida original (retrocompatible). `validatedBy` siempre viene de la sesión autenticada, nunca del body del cliente.
- **UI real** (`src/main.jsx`, componente `Library`): botones placeholder reemplazados por llamadas reales; tabla de revisión de insumos (Validar/Rechazar); panel de matrices similares; panel de búsqueda por contenido (etiquetado explícitamente como keyword, no IA); badge de `REFERENCIA EXTERNA`.

## 4. Decisión de librería PDF (protocolo seguido)

`pdf-parse@1.1.4` (sin binarios) **falló** una prueba real: `FormatError: bad XRef entry` al leer un PDF generado con jsPDF (motor de 2016, no soporta variantes modernas de xref). `pdf-parse@2.4.5` requiere `@napi-rs/canvas` (binario obligatorio) — descartado sin probar por violar la restricción. Se reportó el hallazgo y, con tu autorización explícita, se adoptó **`pdfjs-dist`, usando únicamente su API de texto** (`getTextContent`, nunca la ruta de renderizado que necesita canvas). Prueba aislada: extracción exitosa y exacta. Riesgo residual documentado: `@napi-rs/canvas` es dependencia *opcional* de pdfjs-dist y se instala en disco si la plataforma coincide, aunque el código nunca la importa/ejecuta; no verificable al 100% sin un deploy real a Vercel (el bundler de Vercel solo empaqueta lo que se `require`/`import` desde el handler).

## 5. Archivos modificados / agregados

**Modificados:** `api/google-drive.mjs`, `api/upload-library.mjs`, `server/api-lib/_googleDrive.mjs` (+`buildDriveBreadcrumb`), `server/api-lib/_libraryClassify.mjs` (+`decideImportMode`), `src/main.jsx` (props de `Library`, mapeo de campos Firestore, handlers reales, UI), `package.json`/`package-lock.json` (+`pdfjs-dist`, scripts de test), `test/security.unit.test.mjs`, `test/firestore.rules.test.mjs`.

**Nuevos:** `server/api-lib/_libraryExtract.mjs` + test, `server/api-lib/_librarySearch.mjs` + test, `src/domain/libraryReview.js` + test, `test/library.e2e.test.mjs`.

**Sin cambios (protegidos, verificado con `git diff --stat`):** `firestore.rules`, `storage.rules`, `src/lib/apuCalc.js`, `src/lib/apuExportV2.js`, `src/lib/apuExport.js`, `server/api-lib/_authGuard.mjs`, `server/api-lib/_firebaseAdmin.mjs`, `vercel.json`.

## 6. Firestore rules

**No se modificaron.** Todo (`contentText`, `contentInsumos`, `insumosReview`, `driveParentPath`, `refOnly`, `extraction`) son campos nuevos dentro del mismo documento `library/{docId}`, ya gobernado por las reglas existentes de `ownerUid`/`visibility`. Se agregó una prueba explícita confirmando que un usuario no-dueño sigue sin poder leer ni escribir estos campos nuevos en un documento privado ajeno (`test/firestore.rules.test.mjs`, 21 casos, todos PASS contra el emulador real).

## 7. Pruebas

- **`npm test`: 177/177 PASS** (140 base RC3 + 5 `decideImportMode` + 11 `libraryReview` + 11 `_libraryExtract` + 9 `_librarySearch` + 1 E2E).
- **`npm run test:security` (emulador real): 28/28 PASS** (20 firestore.rules incl. el caso nuevo RC4, 8 authGuard).
- Casos explícitos cubiertos: PROPUESTO→no entra al APU, RECHAZADO→no entra al APU, VALIDADO→sí alimenta catálogo/APU; ZIP <15MB→referencia, ZIP >15MB→referencia, PDF >15MB→referencia, XLSX válido <15MB→importa/extrae; acceso cruzado entre usuarios→denegado (nuevo caso + los 6 preexistentes).
- **E2E real** (`test/library.e2e.test.mjs`): Excel real → extracción real → revisión humana (1 validado, 1 rechazado) → matriz similar (evidencia explicable) → fusión con catálogo real vía `matchPrice` → motor `calcAPUv2` real → exportadores XLSX/PDF reales (RC3, sin tocar) → precio y clave trazables en el PDF final. La única pieza que este test no ejerce es el salto de red real a Drive/Firebase (sin credenciales en este entorno); se documenta como limitación, no se simula.
- **Build (`npm run build`): PASS.** Bundle del frontend sin crecimiento por `pdfjs-dist` (queda solo server-side).
- **`npm audit`: 11 vulnerabilidades moderadas, las mismas 11 preexistentes (Firebase/Google Cloud). Cero nuevas.**

## 8. Serverless functions

**12/12, sin cambios.** Ningún archivo nuevo bajo `api/`; todo se agregó como `action` dentro de `api/google-drive.mjs` y `api/upload-library.mjs`.

## 9. Limitaciones conocidas del MVP (alcance deliberado, no descuido)

- Extracción: solo Excel/CSV y PDF de texto. DOCX/DOC y PDFs escaneados (imagen) quedan `unsupported`/sin texto — no es OCR ni visión, eso es Fase 2 (Planos).
- Revisión humana: Validar/Rechazar por insumo. **No** incluye edición inline de descripción/unidad/precio antes de validar (el ejemplo `Muro block | 126.40 | m² | 86% | REVISAR` de la Fase 5 original sugiere edición; en este MVP el usuario debe rechazar y corregir en la fuente si el valor extraído no es correcto). Se documenta como recorte consciente de alcance, no como omisión.
- Búsqueda/matrices similares: keyword/heurística sobre metadata + contenido ya extraído. No es semántica ni vectorial; escalará mal más allá de cientos de documentos sin una capa de embeddings (fuera de alcance de este MVP, mencionado como posible iteración futura).
- OneDrive: sigue limitado a listar solo la raíz (no se tocó en este MVP; tu evidencia fue exclusivamente de Google Drive).
- Costo de almacenamiento estimado: solo los archivos ≤15MB efectivamente descargados consumen Firebase Storage (el conjunto representativo usado — FASAR OPUS.xlsx y similares — pesa unos pocos MB en total). Los ZIPs de cientos de MB a ~2GB inventariados **no** se copian a Firebase bajo esta arquitectura: quedan como referencia, costo de storage ≈ 0 para ellos.
- Riesgo residual de `pdfjs-dist`/canvas opcional en Vercel: descrito en §4, no verificable sin un deploy real.

## 10. Diferencia RC3 → RC4

RC3: Biblioteca = subida/importación básica + metadata; Visual IA = generador de imagen/narrativa. RC4 (este MVP): Biblioteca con extracción real de contenido, búsqueda/matrices similares reales y explicables, revisión humana con estados y trazabilidad completa (documento, fila, usuario, fecha), y puente real (no simulado) hacia el motor APU existente — todo sin tocar el motor, los exportadores, las reglas de Firebase ni el límite de 12 funciones.

---

## ¿BIBLIOTECA MVP ESTÁ LISTA?

**SÍ, CON LIMITACIONES** (documentadas en §9). El criterio de cierre pedido (`DRIVE → IMPORTAR FASAR/EXCEL → EXTRAER → REVISAR → VALIDAR → BUSCAR MATRIZ SIMILAR → USAR EN APU → CALCULAR → XLSX/PDF`) está probado de punta a punta con código real en `test/library.e2e.test.mjs`, con la única salvedad de que el salto de red real a Drive no se ejercitó en este entorno (sin credenciales), consistente con lo ya reportado en la Fase 1.

**No se ha hecho deploy.** Esperando tu autorización para: (a) desplegar este MVP de Biblioteca, y/o (b) autorizar el inicio de la Fase 2 (Planos IA / Takeoff).
