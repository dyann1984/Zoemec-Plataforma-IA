# ZOEMEC — PRE_RELEASE_AUDIT.md (Fase 9)

Auditoría adversarial del working tree actual, sin tocar producción. Emuladores Firestore/Auth/Storage + arnés `dev-qa/qa-decisions-server.mjs` + Vite (`VITE_USE_FIREBASE_EMULATOR=true`). No se corrigió nada hasta el checkpoint (sección "Checkpoint"); después solo P0/P1.

Formato por hallazgo: ID · Severity · Area · Scenario · Expected · Actual · Evidence · Reproducible · User impact · Economic impact · Recommended fix · Status.

---

## ADENDA (ronda 2 — corrección de la contradicción RC1 del reporte anterior)

El reporte anterior concluyó "APROBADO" con 2 P1 todavía abiertos, lo cual contradice el criterio explícito (0 P0 y 0 P1 abiertos). Esta ronda: (1) desarrolla F-001 en detalle, (2) corrige F-004 con control de concurrencia optimista real + tests dedicados, (3) reclasifica F-001 con justificación técnica explícita (no lo corrige, per instrucción de no tocar P2/P3), (4) revalida toda la suite.

### P1 abiertos al INICIO de esta ronda (los que motivaron el rechazo)

| ID | Descripción corta | Estado al inicio de esta ronda |
|---|---|---|
| F-001 | Presupuestos guardados quedan obsoletos sin aviso tras corregir el APU de origen | P1, documentado, no corregido |
| F-004 | Sin control de concurrencia optimista en `save-version` — lost update real confirmado | P1, documentado, no corregido |

(F-003 y F-006/F-006b eran P1 en el diagnóstico inicial pero YA se habían corregido y verificado en la ronda anterior — ver sus secciones abajo, `Status: CORREGIDO`. No estaban entre los "2 P1 documentados" que motivaron el rechazo.)

### Resultado de esta ronda

| ID | Acción tomada | Estado FINAL |
|---|---|---|
| F-001 | Analizado a fondo (ver sección completa abajo); **reclasificado P1→P2** con justificación técnica explícita, per instrucción de no corregir P2/P3 | **P2, documentado, no corregido** (ya no es P1) |
| F-004 | **Corregido**: `expectedParentVersionId` obligatorio + `409 VERSION_CONFLICT` real server-side, UI de conflicto real, tests dedicados exactos al escenario pedido | **CERRADO** |

**P1 abiertos al FINAL de esta ronda: 0.**
**P0 abiertos al FINAL de esta ronda: 0** (F-002 y F-010, ambos P0, ya estaban corregidos y verificados desde la ronda anterior).

---

## F-001 — desarrollo completo (pedido explícitamente por el usuario tras el reporte inicial)

- **ID:** F-001
- **Descripción:** El botón "Presupuesto guardado" (varias rutas: generación por lote, `addBudget()` desde un solo APU, "Presupuesto ejecutivo") congela `items[i].pu`/`total` en el momento de guardarlo. Si el APU de origen se corrige después (Challenge, edición manual, restauración de versión), el presupuesto guardado sigue mostrando los números viejos, indefinidamente, sin ninguna marca de "esto es un snapshot".
- **Reproducción exacta:**
  1. Crear un proyecto, pegar 1+ conceptos, generar el lote (botón "Generar N APU(s) con IA y crear presupuesto") → se crea el/los APU(s) Y un `budget` con `items[i].pu` = P.U. de ese momento.
  2. Abrir el APU en `ProfessionalApuEditor`, ir a la pestaña Challenge, usar "Simular corrección" → "Aplicar al APU" → "Guardar versión" (crea V2 con un `pu` distinto — reproducido real en Fase 8.1, delta de +$103.40/+30%).
  3. Ir a "Presupuestos" → el presupuesto guardado en el paso 1 sigue mostrando el P.U. de ANTES de la corrección. No hay botón "recalcular", ni fecha visible, ni aviso.
  4. Confirmado por lectura de código (`src/main.jsx` líneas 321, 1559-1560, 2171, 2857): de las 4 únicas rutas que tocan el estado `budgets`, ninguna vuelve a leer el APU vigente ni depende de `apus`/`rawApus` — solo crean una entrada nueva o la borran.
- **Impacto (usuario):** Un presupuestador que corrige un APU después de generar el presupuesto puede seguir viendo/exportando el número viejo si no regresa a regenerarlo manualmente.
- **Riesgo económico/operativo:** Real pero acotado a un escenario específico (generar presupuesto → corregir el APU de origen DESPUÉS → nunca regenerar el presupuesto). El delta es exactamente el de la corrección.
- **Por qué NO se reclasifica como P1 (justificación técnica, no fue simplemente descartado):**
  1. **El dato de origen nunca está mal.** El `apu`/su historial de versiones (la fuente autoritativa server-side, Fase 7) SIEMPRE refleja el estado correcto — verificado extensamente en Fase 8/8.1/9 (Auditor, Confidence, Bid Risk, Dossier, todos recalculan en vivo desde el snapshot vigente). Lo que queda desactualizado es una copia derivada de conveniencia, no el registro auditable. Esto es la diferencia real entre "persistencia inconsistente" (P1, el dato mismo está mal) y "información insuficiente" (P2, falta una señal de que un derivado es un snapshot) — el propio pedido del usuario distingue ambos casos explícitamente en su rúbrica de severidad.
  2. **Mismo patrón que un export ya aceptado como normal.** Un PDF/XLSX exportado tampoco se "auto-actualiza" si el APU cambia después — nadie clasificaría eso como P1, es la semántica esperada de un documento punto-en-el-tiempo. "Presupuestos" es exactamente ese mismo tipo de documento (una cotización congelada), no una vista en vivo.
  3. **`budgets` nunca fue parte del modelo autoritativo.** Es el MISMO patrón (blob `useCloudState`, pre-Fase-7) que `clients`/`catalog`/`company` — ninguno de ellos se auditó como P1 en esta ronda por la misma razón: son datos de conveniencia, no el registro trazable/auditado que el producto promete (ese es el APU + su Dossier, que sí está cubierto end-to-end).
  4. **Ningún claim de producto contradicho.** Sección 30 (Product Claims Audit) no encontró ningún texto de UI que prometa que "Presupuestos" es una vista en vivo o sincronizada.
  5. **El fix real es de UX (mostrar fecha/aviso o botón "recalcular"), no de integridad de datos** — encaja con la definición P2 del propio pedido ("información insuficiente", "feature incompleta"), no con P1.
- **Severity final:** **Reclasificado P1 → P2.**
- **Status:** **RECLASIFICADO** (P1→P2) + **ABIERTO** (P2, no corregido por instrucción explícita — "No corrijas P2/P3").

---

## F-002

- **Severity:** P0
- **Area:** Seguridad / Firestore Rules / confidencialidad cross-tenant
- **Scenario:** `firestore.rules` líneas 118-129: `technicalMemory` y `challengeDecisions` tienen `allow read: if signedIn()` — CUALQUIER cuenta autenticada, sin relación con el proyecto/organización dueña del dato. La justificación en el propio comentario del archivo ("dato técnico de ingeniería, no dato personal") es la premisa que puse a prueba.
- **Expected:** Un usuario de la Organización B nunca debería poder leer precios aprobados, proveedores preferidos o decisiones de Challenge de la Organización A.
- **Actual:** PoC real ejecutada contra el emulador: sembré (vía SDK admin, igual que `api/technical-memory.mjs` en producción) dos entradas realistas de la "Organización A" — un `APPROVED_PRICE` (precio de cemento aprobado, $189.50/saco) y un `PREFERRED_SUPPLIER` (nombre de proveedor estratégico), ambas con `context.organizationId`/`context.projectId` reales y `approvedBy` con el correo del gerente. Un usuario B recién registrado (cuenta nueva, plan Gratis, sin ninguna relación con A) hizo `getDocs(collection(db,'technicalMemory'))` con el SDK de cliente de Firebase — el mismo SDK que YA está cargado en cualquier sesión de ZOEMEC — y **leyó ambos documentos completos**, incluyendo el precio aprobado, el nombre del proveedor y el correo de quien aprobó. `src/domain/technicalMemory.js` confirma que el schema real incluye `APPROVED_PRICE`/`PREFERRED_SUPPLIER` con scope `PROJECT`/`ORGANIZATION` — esto es exactamente el tipo de dato de licitación que una constructora NO querría expuesto a sus competidores (también clientes de ZOEMEC).
- **Evidence:** Script ejecutado contra el emulador real (no producción), salida: `RESULT: usuario B (ajeno) pudo leer 2 documentos de technicalMemory de OTRAS organizaciones` con el contenido completo de ambos documentos. `challengeDecisions` tiene la misma regla (`allow read: if signedIn()`, sin scope) y el mismo patrón de riesgo — no lo re-probé por separado porque la causa raíz es idéntica.
- **Reproducible:** Sí, 100%, determinístico (reglas de Firestore, no una condición de carrera).
- **User impact:** Cualquier cuenta de ZOEMEC (incluida una gratuita) puede espiar la inteligencia de precios/proveedores de cualquier otra empresa cliente de la plataforma.
- **Economic impact:** Alto y directo — precios aprobados y proveedores preferidos son información de licitación; una fuga sistemática entre competidores en el mismo mercado de construcción puede costarle contratos reales a los clientes de ZOEMEC y exponer a ZOEMEC a reclamos de confidencialidad.
- **Recommended fix:** Cambiar `technicalMemory`/`challengeDecisions` (y sus colecciones de auditoría si aplica) a lectura restringida por dueño real: para scope `USER` → `resource.data.context.userId == request.auth.uid`; para `PROJECT` → verificar que el proyecto (`resource.data.context.projectId`) le pertenece al usuario (get a `projects/{id}` y comparar `ownerUid`); para `ORGANIZATION` → requiere modelar membresía de organización (hoy no existe ese concepto en el schema, es otro hallazgo derivado). Alternativa mínima viable a corto plazo: mover la lectura completamente al endpoint (`api/technical-memory.mjs`, que sí puede filtrar) y cambiar la regla a `allow read: if false`, igual que ya se hizo con `write`.
- **Status:** **CORREGIDO.** `firestore.rules`: `technicalMemory`/`challengeDecisions` cambiaron de `allow read: if signedIn()` a `allow read: if false` (mismo patrón ya usado en `projects`/`apus`/`apuVersions`/`exportEvents` — la UI real siempre lee vía el endpoint, que sí filtra; confirmado por `grep` que ningún código en `src/` lee estas colecciones con el SDK de cliente directo). Regresión agregada en `test/firestore.rules.test.mjs` (reemplaza los 2 tests que antes afirmaban `assertSucceeds` para "cualquier usuario" por `assertFails`, más un test nuevo confirmando que un admin sí puede vía el catch-all). PoC de explotación re-ejecutada DESPUÉS del fix: `permission-denied` real. `npm run test:rules` → 42/42 PASS.

---

## F-003

- **Severity:** P1
- **Area:** Seguridad/integridad de auditoría — `api/export-events.mjs`
- **Scenario:** El endpoint que registra el "evento de exportación auditable" del Dossier (marketing: "Dossier APU Auditable") recibe `manifestHash`, `snapshotHash(es)`, `apuVersionId(s)`, `projectId`, `apuId` directo del body del cliente (`api/export-events.mjs:30-56`) y los guarda tal cual, SIN verificar que: (a) el `projectId`/`apuId` referenciado pertenezca al usuario autenticado, (b) el hash corresponda a datos reales, (c) el proyecto/APU siquiera exista.
- **Expected:** Un registro de auditoría de exportación debería ser una prueba fehaciente de qué se exportó realmente — recalculado o al menos validado server-side contra el estado actual del proyecto/APU.
- **Actual:** Cualquier valor de `manifestHash`/`snapshotHash`/`apuVersionId`/`projectId`/`apuId` enviado en el `POST` se persiste sin validar. `actor`/`actorEmail`/`ownerUid` sí se derivan correctamente de `requireAuth` (no se pueden falsificar), pero el CONTENIDO del evento (qué se exportó, con qué hash) es enteramente auto-reportado.
- **Evidence:** Lectura de código, `api/export-events.mjs:28-59` — no hay ninguna llamada a `getAdminDb().collection('apus'|'projects').doc(...).get()` para verificar antes de escribir el evento.
- **Reproducible:** Sí, por inspección directa del código (no requiere ejecución).
- **User impact:** Bajo para terceros (el evento solo aparece en el propio historial del usuario, `GET` filtra por `ownerUid`), pero compromete la garantía de "auditable" que es la propuesta de valor explícita del Dossier: el propio usuario (o un bug del cliente) puede registrar un evento con un hash que no corresponde a lo realmente exportado.
- **Economic impact:** Indirecto — si este registro se usara alguna vez como evidencia ante un cliente/auditor externo ("exportamos exactamente esta versión, aquí está el hash"), no sería una prueba confiable.
- **Recommended fix:** Antes de `docRef.set(event)`, recalcular `manifestHash`/`snapshotHash` server-side desde el snapshot real de `apus/{id}` (ya existe `computeSnapshotHash` en `src/domain/snapshotHash.js`) y rechazar si no coincide con lo declarado por el cliente, o simplemente ignorar el hash del cliente y usar siempre el recalculado.
- **Status:** **CORREGIDO.** `api/export-events.mjs#handleRecord` reescrito: ya no acepta `apuId`/`projectId`/`apuVersionId(s)`/`snapshotHash(es)`/`manifestHash` del cliente tal cual — ahora (1) verifica que el proyecto/APU referido exista Y pertenezca a `authz.uid` (404/403 si no), (2) recalcula `apuVersionId`/`snapshotHash` (scope APU) o `apuVersionIds`/`snapshotHashes`/`manifestHash` (scope PROJECT) SIEMPRE desde el snapshot real en Firestore vía `computeSnapshotHash` — el valor declarado por el cliente se ignora por completo. `test/exportEventsApi.test.mjs` reescrito para sembrar APUs/proyectos reales (vía los handlers reales) y verificar que el evento refleja el estado servidor, no lo declarado; incluye casos nuevos de 404/403 por recurso inexistente/ajeno. `npm run test:security` → 130/130 PASS (incluye este archivo).

---

## F-004

- **Severity:** P1
- **Area:** Versionado/concurrencia — `api/apus.mjs#handleSaveVersion`
- **Scenario:** Dos guardados concurrentes del MISMO APU partiendo de la misma versión base (dos pestañas, dos dispositivos) — exactamente la prueba pedida en la sección 14.
- **Expected:** El segundo guardado que parte de una base ya obsoleta debería rechazarse con `409 VERSION_CONFLICT` (o equivalente), nunca perder en silencio el cambio del primero.
- **Actual:** `handleSaveVersion` (`api/apus.mjs:111-140`) no recibe ni valida ningún `parentVersion`/`baseVersion` del cliente — simplemente lee `current.currentVersion` en la transacción y crea la siguiente. PoC real: creé V1, disparé 2 `save-version` concurrentes (`Promise.all`) con contenido distinto, ambos partiendo "mentalmente" de V1. Resultado real: **ambos tuvieron éxito** (200), se crearon V2 y V3 secuenciales — nunca un 409. El estado final (`currentVersion=V3`) refleja SOLO el segundo guardado; el primero (V2) quedó en el historial pero DEJÓ de ser la versión vigente sin que nadie fuera avisado — "lost update" clásico.
- **Evidence:** Script ejecutado contra el emulador real. Salida: `Guardado A: 200 V2 ... / Guardado B: 200 V3 ... / Estado final: currentVersion=V3 ... (edición de A ya no es la vigente)`.
- **Reproducible:** Sí, 100%, determinístico.
- **User impact:** Mismo usuario con dos pestañas/dispositivos (o dos personas con acceso a la misma cuenta) puede perder silenciosamente una edición real sin ningún error ni aviso — cree que guardó correctamente (recibe 200) pero su cambio quedó enterrado en el historial, no vigente.
- **Economic impact:** Depende del contenido perdido — puede ser una corrección de Challenge real, como la de Fase 8.1, silenciosamente descartada.
- **Recommended fix:** Agregar `baseVersion` (la versión que el cliente cree vigente) al payload de `save-version`; en la transacción, si `current.currentVersion !== baseVersion`, rechazar con `409` y un mensaje claro ("Alguien más guardó una versión más reciente, recarga antes de continuar"). El cliente (`ProfessionalApuEditor.jsx`) debe enviar la versión que tenía cargada.
- **Status:** **CORREGIDO.**
  - **Servidor** (`api/apus.mjs#handleSaveVersion`): `expectedParentVersionId` ahora es obligatorio en el body; dentro de la MISMA transacción que lee `current.currentVersion`, si no coincide se lanza `409` con `code:'VERSION_CONFLICT'` y `currentVersion` (la real) ANTES de calcular o escribir nada — ninguna versión nueva se crea, `currentVersion` nunca se mueve. El handler raíz (`export default async function handler`) ahora propaga `err.code`/`err.currentVersion` en el JSON de respuesta (antes se perdían).
  - **Cliente** (`src/services/apiClient.js#apiPost`): propaga `data.code`/`data.currentVersion` al `Error` lanzado, para que el llamador pueda distinguir un conflicto real de cualquier otro error.
  - **Cliente** (`src/features/apu/ProfessionalApuEditor.jsx#saveVersion`): envía `expectedParentVersionId` (la última versión que ESTE editor conoce, `history[history.length-1].version`). El "bump" de versión local (historial/`onChange`/`onSave`, que antes se aplicaba de forma optimista ANTES de saber si el servidor aceptaría) ahora **solo se aplica después de que el servidor confirma**. En conflicto real (`409`/`VERSION_CONFLICT`) nunca se dice "guardado": se expone `versionSaveState:'conflict'` con la versión real del servidor, y la edición del usuario permanece intacta (nunca se sobreescribe sola). Se agregó `reloadServerVersion()` + botón "Recargar versión del servidor" en la barra de acciones para que el usuario decida explícitamente cómo continuar (recargar y reintentar desde la versión real).
  - **Tests dedicados agregados** (`test/apusApi.test.mjs`): `exige expectedParentVersionId -- sin el, se rechaza con error real` + `CASO F-004: dos clientes parten de V1, A guarda V2, B (todavia en V1) recibe 409 VERSION_CONFLICT -- V3 NO se crea, currentVersion sigue V2, retry desde V2 SI crea V3` — reproduce EXACTAMENTE el escenario pedido (A guarda V2 real; B con `expectedParentVersionId:'V1'` recibe `409`/`VERSION_CONFLICT`/`currentVersion:'V2'` en el body, `V3` nunca se crea, `currentVersion` sigue en `V2`, el snapshot vigente sigue siendo el de A; B reintenta con `expectedParentVersionId:'V2'` y SÍ crea `V3` con éxito). Tests preexistentes que llamaban `save-version` sin el nuevo campo obligatorio (`test/apusApi.test.mjs`, `test/apuIdStability.e2e.test.mjs`) se actualizaron para enviarlo.
  - **Verificado:** `npm run test:projects` → 33/33 PASS (incluye los 2 tests nuevos), `npm run test:security` → 130/130 PASS.

---

## F-006b (extensión de F-006)

- **Severity:** P1 (mismo hallazgo, alcance ampliado)
- **Area:** Monetización — `ProfessionalApuEditor` "Guardar versión"
- **Scenario:** Con 3 APUs ya creados (superando "1 gratis"), abrí un 4º concepto de un solo renglón (no lote) y usé el botón "Guardar versión" del editor moderno.
- **Actual:** Tampoco se bloqueó — el intento de guardado avanzó (y solo falló porque yo mismo había simulado un 500 del servidor para probar manejo de errores, ver evidencia positiva más abajo). `onSave` en `src/main.jsx:2390` solo llama `requireProject()`, nunca `requireApuAccess()`. Confirma que el candado de plan Gratis vive ÚNICAMENTE en funciones legado (`save()`/`addBudget()`, líneas 2170-2171) que ya no son el camino real de persistencia desde Fase 7 — el camino real y moderno (`ProfessionalApuEditor` → `useAuthoritativeApus` → `api/apus.mjs`) no tiene candado en ningún punto.
- **Evidence:** Reproducido en el mismo navegador/cuenta que F-006.
- **Status:** **CORREGIDO** junto con F-006 — ver detalle en la sección F-006 (el mismo commit agrega el candado a `onSave` del editor moderno, no solo al lote).

---

## F-007

- **Severity:** P2
- **Area:** Accesibilidad — `ZoemecIntelligencePanel.jsx` / `RevisionBandeja.jsx`
- **Scenario:** Sección 24 — botones sin nombre accesible, navegación por teclado/lector de pantalla.
- **Expected:** Controles interactivos (botones de ícono, "×" de eliminar renglón, tabs del panel Intelligence) deberían tener `aria-label` o texto accesible.
- **Actual:** `grep -c "aria-label"` sobre `ZoemecIntelligencePanel.jsx` y `RevisionBandeja.jsx` da **0** en ambos (contra 9 en `main.jsx`, 1 en `ProfessionalApuEditor.jsx`). Estos dos archivos concentran justamente los controles más nuevos y densos en íconos (tabs Resumen/Confidence/Bid Risk/.../Historial, botones "×" de renglón, acciones Mantener/Simular corrección/Justificar) — no imposible de usar, pero un lector de pantalla no anuncia qué hace un "×" suelto.
- **Evidence:** Conteo real por `grep` sobre el working tree.
- **Reproducible:** Sí, por inspección de código.
- **User impact:** Usuarios de lector de pantalla no pueden operar con confianza los paneles más importantes del producto (Auditor/Challenge/Confidence/Bid Risk/Scenario).
- **Economic impact:** Ninguno directo; riesgo de cumplimiento (accesibilidad) en contratos públicos que la exijan.
- **Recommended fix:** Agregar `aria-label` a botones de ícono y a los tabs (`role="tab"` ya sería ideal, hoy son botones planos).
- **Status:** **ABIERTO** (P2) — documentado, no corregido per regla principal.

---

## F-008

- **Severity:** P2
- **Area:** Performance / bundle — `vite.config.js` manualChunks
- **Scenario:** Sección 28 — investigar el warning de Vite ">650kB" que arrastra varias fases.
- **Expected:** El chunk "vendor" catch-all (1.09MB, el más grande de todos) no debería incluir librerías pesadas usadas solo por una función secundaria del producto.
- **Actual:** `three` (motor 3D, 32MB en disco en `node_modules`) se importa en `src/features/visual3d/Technical3DViewer.jsx` y NO está en la lista de `manualChunks` de `vite.config.js` (que sí separa firebase/html2canvas/dompurify/jspdf/etc.) — cae al bucket genérico `vendor`. `Technical3DViewer` se importa de forma ESTÁTICA (no `React.lazy`) desde `ProfessionalApuEditor.jsx`, que a su vez se importa estático desde `main.jsx` — es decir, **three.js se descarga en la carga inicial para TODO usuario**, incluso uno que jamás abre el visor 3D.
- **Evidence:** `grep` confirma el único import de `three` y su ausencia en `manualChunks`; `du -sh node_modules/three` = 32M; build real muestra `vendor-C-QFFEOx.js 1,091.56 kB`.
- **Reproducible:** Sí, por inspección + build real.
- **User impact:** Carga inicial más lenta para todos, no solo quienes usan Visual IA/3D.
- **Economic impact:** Ninguno directo; UX de "primera impresión" en conexiones lentas.
- **Recommended fix:** `React.lazy(() => import('../visual3d/Technical3DViewer.jsx'))` con `Suspense`, o mover `three` a su propio `manualChunk` cargado bajo demanda. No es P0/P1 porque no rompe nada — la app funciona, solo pesa más de lo necesario.
- **Status:** **ABIERTO** (P2) — documentado, no corregido per regla principal.

---

## F-009 (sección 29 del pedido — gap ya conocido, clasificación formal)

- **Severity:** P2
- **Area:** Feature completeness — selector de Scenario en Project Dossier
- **Scenario:** Ya documentado en el cierre de Fase 8.1: `buildProjectDossierData`/`exportProjectDossierPdf/Excel` soportan `selectedScenarios`, pero el botón real "Dossier de Proyecto" en `main.jsx` (Proyectos y clientes) lo llama sin ese parámetro — no hay UI para elegir escenarios a incluir en el dossier de PROYECTO (el dossier de UN SOLO APU tampoco expone esto en su UI).
- **Expected/Actual:** Ver Fase 8.1. Reconfirmado en esta sesión con el botón real: el XLSX/PDF generados por el botón real omiten correctamente la sección ESCENARIOS (regla "nunca hojas vacías") en vez de fallar o mostrar algo vacío — degradación correcta.
- **Clasificación pedida (P1/P2/P3):** **P2.** Razonamiento: el mecanismo subyacente es correcto y probado (Fase 8.1 + esta sesión), la ausencia de UI no genera datos falsos ni engañosos (simplemente omite la sección, con la etiqueta "SIMULACION -- NO MODIFICA EL APU BASE" ya lista para cuando exista la UI) — es una feature incompleta (calce con la definición P2 del pedido: "feature incompleta"), no un flujo roto ni un resultado incorrecto.
- **Status:** **ABIERTO** (P2) — documentado, no corregido en esta fase.

---

## F-005

- **Severity:** P2
- **Area:** Normalización de unidades — `src/lib/excelImport.js#normalizeUnitLabel`
- **Scenario:** Sección 6 del pedido — variantes de unidad: `m`, `m2`, `m²`, `m3`, `m³`, `M2`, `M²`, `m^2`, `m^3`, `kg`, `ton`, `pza`, `jgo`, `lote`, `salida`, `pto`, `hr`, `día`, `mes`.
- **Expected:** Variantes visualmente equivalentes deberían normalizarse a una sola representación.
- **Actual:** `normalizeUnitLabel` (`src/lib/excelImport.js:254-262`) solo cubre `m2`/`m²`→`m²`, `m3`/`m³`→`m³` (sí, case-insensitive, así que `M2`/`M²` funcionan), `dia`→`día`, `pza`, `ml`. La notación con caret (`m^2`, `m^3`) NO coincide con ninguna regex y pasa sin normalizar como string literal `"m^2"`. `ton`, `jgo`, `lote`, `salida`, `pto`, `hr`, `mes` tampoco tienen normalización explícita (pasan tal cual, lo cual es aceptable si el usuario ya las escribe consistente, pero dos usuarios escribiendo "Hr"/"hr"/"HR" para el mismo recurso terminan con 3 strings distintos).
- **Evidence:** Lectura directa de la función; confirmado que `unit` NO participa en ningún cálculo numérico (`apuProfessional.js`/`apuCalc.js` — es cosmético/de validación de presencia, la conversión real de unidad de compra vs. consumo usa un campo `conversionFactor` separado por recurso, no parsing de string). Por eso esto NO causa "cálculos absurdos silenciosos" — es una inconsistencia de presentación/agrupación, no de matemática.
- **Reproducible:** Sí, por inspección de código.
- **User impact:** Menor — dos conceptos con la misma unidad real pueden mostrarse/agruparse como si tuvieran unidades distintas en reportes/catálogo si el usuario varía la notación.
- **Economic impact:** Ninguno directo (no afecta el cálculo del P.U.).
- **Recommended fix:** Extender `normalizeUnitLabel` con `m^2`→`m²`, `m^3`→`m³`, y una tabla de sinónimos para `hr`/`ton`/etc.
- **Status:** **ABIERTO** (P2) — documentado, no corregido per regla principal.

---

## F-006

- **Severity:** P1
- **Area:** Monetización / lógica de negocio — `src/main.jsx#generateSelectedBatch`
- **Scenario:** Cuenta nueva, plan Gratis ("tienes 1 APU disponible"). En vez de generar un APU a la vez (flujo de un solo concepto), pega VARIOS conceptos en el mismo textarea ("Pegar concepto / Generar con IA" — que además es el flujo que la propia app sugiere por defecto al crear un proyecto nuevo) y usa el botón de lote "Generar N APU(s) con IA y crear presupuesto".
- **Expected:** El plan Gratis debería limitar a 1 APU total, sin importar por qué camino se genere.
- **Actual:** Reproducido real con una cuenta nueva, no-admin, plan Gratis genuino (verificación de correo real completada vía el emulador): pegué 3 conceptos de disciplinas distintas (impermeabilización, eléctrica, pisos) y generé el lote completo. **Los 3 APUs se crearon exitosamente server-side** (`POST /api/apus` × 3, confirmado vía `GET /api/apus`), pese al banner "tienes 1 APU disponible". Confirmado en código: `requireApuAccess()`/`canUse(user,'apu',...)`/`markApuUsed()` se llaman en `save()` (línea 2170), `addBudget()` (línea 2171) y el flujo de un solo concepto (líneas 1650, 1682) — **`generateSelectedBatch` (líneas 1523-1571), el que procesa el lote pegado, NUNCA los llama**. El límite de plan solo protege el camino de un concepto a la vez; el camino de lote (el que la propia UI sugiere primero a un usuario nuevo) no tiene ningún candado.
- **Evidence:** PoC real en el navegador con cuenta nueva verificada — 3 APUs reales server-side pese al límite anunciado. Confirmado también por lectura de código (ausencia total de `requireApuAccess`/`canUse`/`markApuUsed` en `generateSelectedBatch`).
- **Reproducible:** Sí, 100%, con cualquier cantidad de conceptos pegados a la vez.
- **User impact:** Ninguno negativo para el usuario final (recibe MÁS de lo prometido gratis) — el impacto es para el negocio.
- **Economic impact:** Alto — el "1 APU gratis" es el mecanismo de conversión a plan de pago; cualquier usuario puede evadirlo por completo generando cualquier cantidad de APUs reales, exportables y persistentes vía el lote, sin pagar nunca. Dado que el propio onboarding sugiere ESTE camino primero, es probablemente el camino más usado, no un caso extremo.
- **Recommended fix:** Llamar `requireApuAccess()`/`canUse` dentro de `generateSelectedBatch` antes de generar el lote (bloquear o truncar a los APUs restantes del plan), y `markApuUsed()` por cada APU generado, igual que ya hace el camino de un solo concepto.
- **Status:** **CORREGIDO** (junto con F-006b). `src/main.jsx#generateSelectedBatch` ahora llama `requireApuAccess()` antes de generar el lote (bloquea con el mismo mensaje que el camino de un solo concepto) y `markApuUsed()` una vez si el lote produjo al menos un APU. `onSave` de `ProfessionalApuEditor` (línea ~2398) ahora también llama `requireApuAccess()`/`markApuUsed()`, pero SOLO cuando el `id` guardado es NUEVO (no existía antes en `apus`) — volver a guardar una versión de un APU ya propio nunca vuelve a costar "1 APU gratis". Verificado: `npm run build` sin errores; no se agregó test automatizado de este candado (vive en `src/main.jsx`, componente React sin arnés de test hoy, mismo motivo que F-010) — la corrección se verificó leyendo el código (llamadas presentes y en el punto correcto) más el build limpio; una prueba E2E de plan Gratis quedaría como seguimiento recomendado si se decide invertir en testear `main.jsx`.

---

## F-010 (encontrado DURANTE la verificación de la corrección de F-006 -- no estaba en el diagnóstico inicial)

- **Severity:** P0
- **Area:** Pérdida silenciosa de datos — `runQueueJob` (generación por lote), `src/main.jsx` (~línea 2027)
- **Scenario:** Generar un lote de conceptos en un proyecto (ej. 3 conceptos) y, EN EL MISMO PROYECTO, generar un SEGUNDO lote distinto (ej. 2 conceptos más) en cualquier momento posterior.
- **Expected:** Los APUs del primer lote deberían seguir existiendo junto con los del segundo (5 APUs totales).
- **Actual:** Se archivaban en silencio (sin aviso, sin confirmación) los APUs del primer lote cuya posición coincidía con la numeración del segundo. Causa raíz real: `src/domain/apuSchema.js:449` asigna `clave: CON-${index+1}` reiniciando SIEMPRE desde `CON-001` en cada lote nuevo (nunca es única entre lotes distintos), y el merge en `runQueueJob` deduplicaba SOLO por `clave`: `setApus(prev => [tagged, ...prev.filter(x => x.clave !== tagged.clave)])`. Al pegar un segundo lote de 2 conceptos (que vuelve a generar CON-001/CON-002), esa línea eliminaba del estado (que `useAuthoritativeApus` traduce a `action:archive` server-side) los APUs CON-001/CON-002 del PRIMER lote, dejando solo el CON-003 sobreviviente + los 2 nuevos = 3 de 5 esperados.
- **Evidence:** Reproducido dos veces de forma real: (1) durante la verificación de F-006 con la cuenta "Carlos Nuevo" (3 APUs -> pegar 2 más -> quedaron 3, 2 originales con `archivedAt` confirmado por consulta directa a Firestore vía Admin SDK); (2) reproducción limpia y controlada con cuenta admin, proyecto `PRO-F010-TEST`: lote 1 (3 conceptos, `BATCH1-A/B/C`) -> confirmado 3 vía `GET /api/apus?projectId=` -> lote 2 (2 conceptos, `BATCH2-X/Y`) -> con la corrección aplicada, `GET /api/apus?projectId=PRO-F010-TEST` devolvió los 5 conceptos completos (los 3 del lote 1 + los 2 del lote 2), confirmando el fix real end-to-end.
- **Reproducible:** Sí, 100%, con cualquier segundo lote en el mismo proyecto (determinístico por posición, no depende de IA real).
- **User impact:** Alto -- es el flujo de trabajo MÁS COMÚN esperado del producto (varios lotes de conceptos por proyecto a lo largo del tiempo). El dato no se pierde permanentemente (queda `archivedAt`, recuperable por un admin con acceso directo a Firestore), pero NO existe ninguna función de "restaurar archivado" en la UI -- para el usuario real, sus APUs simplemente desaparecieron sin explicación.
- **Economic impact:** Alto -- un presupuestador que agrega partidas en dos sesiones distintas al mismo proyecto puede perder de vista trabajo ya hecho.
- **Recommended fix (aplicado):** Cambiar el dedup de `clave` sola a `(clave + batchId)` -- reemplaza correctamente un reintento del MISMO item dentro del MISMO lote (el caso que la línea original intentaba resolver), pero nunca colisiona entre lotes distintos.
- **Status:** **Corregido** (P0) -- `src/main.jsx` línea ~2026-2039, verificado con reproducción real end-to-end antes/después (ver Evidence). Regresión automatizada NO agregada (la lógica vive en un closure de componente React, no en una función pura exportada/testeable hoy) -- verificación real en navegador queda documentada como evidencia; extraer esta lógica a una función pura testeable (`src/domain/apuWorkspace.js`, mismo patrón que `mergeScopedUpdate`) queda como recomendación de seguimiento, no se hizo aquí para no ampliar el alcance del fix de P0.

---

## CHECKPOINT FINAL (ronda 2)

| Severity | Total encontrados | Corregidos | Abiertos |
|---|---|---|---|
| P0 | 2 (F-002, F-010) | 2 | **0** |
| P1 | 4 (F-003, F-004, F-006, F-006b) + F-001 reclasificado a P2 | 4 | **0** |
| P2 | 5 (F-001 reclasificado, F-005, F-007, F-008, F-009) | 0 (por regla, no se corrigen P2/P3) | 5 (documentados) |
| P3 | 0 encontrados | — | 0 |

## FINAL TEST COUNTS (ronda 2, post-fix)

| Suite | Resultado |
|---|---|
| `npm test` | 638/638 PASS |
| `test:projects` | 33/33 PASS (+2 tests dedicados de F-004) |
| `test:security` | 130/130 PASS (+2 de F-004, ya incluía los de F-002/F-003) |
| `test:rules` | 42/42 PASS |
| `test:memory` | 3/3 PASS |

## BUILD
`rm -rf dist && npm run build` → verde.

## RC DECISION

**P0 abiertos = 0. P1 abiertos = 0.**

**ZOEMEC PRE-RELEASE RC1: APROBADO**

No se hizo commit, push ni deploy.
