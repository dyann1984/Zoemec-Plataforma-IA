# ZOEMEC V1 — Backlog de hallazgos

Registro formal de hallazgos detectados durante el cierre de V1 que **no** se
corrigen en la fase en la que se encontraron. Cada entrada conserva la evidencia
y el criterio de aceptación para corregirse como cambio separado.

---

## P1-001 · Etiqueta "VERIFICADO" en renglones cuyo precio no coincide con la referencia que lo verifica

- **Estado:** ABIERTO (registrado en F1, 2026-09-26; corrección separada pendiente de autorización).
- **Severidad:** P1 — integridad de la evidencia de precios.
- **Área:** `src/domain/materialPriceIntelligence2.js` (`resolveResourcePrice`,
  `attachIntelligence2FieldsToRow`), `src/domain/priceStatus.js` (`derivePriceStatus`).

**Comportamiento actual.** El estado de precio se deriva de `precioRecomendado`
(mediana de las referencias de mercado aceptadas) y se traduce a
`fuente.estado = 'VERIFICADO'`, pero el número económico del renglón
(`precioUnitario` / `salarioBase` / `tarifa`) sigue siendo el que propuso la IA
o la biblioteca. El enriquecimiento nunca reemplaza el precio (regla vigente
de F1), así que la etiqueta y el número pueden no corresponder.

**Evidencia ejecutada (arnés F0/F1, OpenAI simulado de forma determinista).**

| Insumo | Precio usado en el APU | Referencia de mercado | Estado mostrado |
|---|---|---|---|
| Varilla corrugada 3/8" | 28.00 (estimado IA) | 25.70 | VERIFICADO |

**Riesgo.** Un usuario, auditor o cliente lee "VERIFICADO" y asume que el
precio usado está respaldado por mercado cuando no lo está. Esto afecta a
Confidence, Auditor, Challenge, Bid Risk y Bid Readiness, que leen `fuente.estado`.

**Criterio de aceptación de la corrección.**
1. "VERIFICADO" solo se muestra cuando el precio **usado** coincide con la
   referencia que lo verifica, dentro de una tolerancia documentada.
2. Si no coincide, se muestra un estado distinto (p. ej. "REFERENCIA DISTINTA"),
   con ambos valores y la diferencia en porcentaje.
3. El enriquecimiento sigue sin modificar campos económicos (regla F1).
4. Hay tests para precio igual, precio dentro de tolerancia, precio fuera de
   tolerancia y precio de biblioteca vs referencia.

---

## Otros pendientes detectados en F0/F1 (no bloquean F1)

- **P2-001 · Presupuesto diario global de búsquedas** (`server/api-lib/_priceIntelligenceCache.mjs`,
  `PRICE_INTELLIGENCE_MAX_DAILY_SEARCHES`, 200 por día para **toda** la plataforma).
  Es igual para todos los roles, pero su efecto depende del orden de uso entre
  empresas. Desde F1 su agotamiento ya es visible (`PRICE_SEARCH_FAILED` con
  código `DAILY_SEARCH_BUDGET_EXHAUSTED` + `ENRICHMENT_PARTIAL`). Falta decidir
  si se reparte por organización.
- **P2-002 · Unidad de rate limit consumida sin búsqueda.** Si el rate limit
  por usuario permite la consulta pero el presupuesto diario global está agotado,
  la unidad ya se cobró. El impacto es menor (solo ocurre con el presupuesto
  global agotado).
- **P2-004 · (F2) Sentinel y Construction DNA siguen usando `apu.cantidadObra`.**
  `server/api-lib/_route-sentinel.mjs` y `_route-construction-dna.mjs` llaman
  `computeExplosionData(apuDocs)` con documentos APU sueltos, que es el modo
  compatible "APU independiente". Son módulos V1.5/V2; no se tocaron en F2.
  Al activarlos deben usar `computeScopedExplosion` (budgetScope.js).
- **P2-005 · (F2) El snapshot guardado del Presupuesto se calcula en el cliente.**
  El servidor persiste lo que envía el cliente, sin recalcularlo con
  `buildBudgetScope` (ya mencionado en la auditoría).
- **P2-006 · (F2) APUs con renglones v1 (arreglos posicionales).** `calcAPUv2`
  no los lee. El servidor siempre guarda v2 (`finalizeProfessionalAPU`), pero un
  APU legado no migrado mostraría P.U. 0 en el Presupuesto. Conviene verificar con datos reales.
- **P1-002 · (F3) Baseline aprobado no se protege en el servidor para los generadores.**
  La UI del CAD bloquea "Sincronizar cantidad" cuando el concepto está en un
  presupuesto aprobado y lo manda a una Orden de Cambio. `set-generators` en el
  servidor (y "Recalcular generadores") todavía no consulta el baseline.
- **P2-007 · (F3) `sourceRevision` del generador queda en null.** La versión del
  plano (`plano-takeoffs.currentVersion`) no llega al panel del CAD. Hoy la
  identidad de lo medido es `geometryHash` más la revisión de generadores por plano.
- **P2-008 · (F3) El servidor verifica la aritmética del generador, pero no
  regenera desde la geometría.** El CAD de Levantamiento vive en el bloque del
  usuario (F4) y el servidor no puede leerlo. Para planos en `plano-takeoffs`
  sí se podría hacer una verificación cruzada.
- **P2-009 · (F3) Criterio de medición de muros por eje.** La longitud es la
  del eje entre nodos: no se descuentan traslapes en esquinas ni se agregan las
  extensiones de espesor. Falta documentarlo en el reporte o hacerlo configurable.
- **P2-010 · (F3) La altura del muro no tiene atributo de origen.** El espesor sí
  lo tiene (`thicknessSource`); la altura toma el default de 2.70 al dibujar si
  no se captura, y el generador no puede distinguirla.
- **P2-011 · (F3) La detección de desactualización se hace a pedido.** "Revisar
  generadores" en la pestaña Revisión del CAD compara lo guardado con la
  geometría vigente, pero editar el plano no avisa automáticamente en el
  Catálogo, que no tiene la geometría.
### Estado tras F4 (2026-09-26)

- **P2-008 · RESUELTO en F4** para planos persistidos en `planoTakeoffs` (incluye el
  CAD de Levantamiento, que ya vive ahí): `set-generators` reconstruye los
  generadores desde el `cadModel` guardado y responde 409 `GEOMETRY_CHANGED`
  si `planoRevision`, `elementId` o `geometryHash` no coinciden
  (test `f4SurveyCad` "GEOMETRY_CHANGED"). Para un `planoId` que no existe en el
  servidor se conserva la verificación aritmética de F3.
- **P2-007 · RESUELTO en F4** en el mismo caso: el servidor guarda
  `sourceRevision` = revisión del plano y el historial registra `planoRevision`.
- **P2-010 · RESUELTO en F4:** `heightSource` / `ceilingHeightSource`
  (USUARIO / LEVANTAMIENTO / DIBUJO / IMPORTADO / DEFAULT). El generador marca
  `DIMENSION_POR_DEFECTO` y `usesDefaults` (test T17).
- **P2-011 · RESUELTO en F4:** cada guardado del plano (borrador, versión o
  restauración) marca `generatorStaleness` en los conceptos dependientes, y el
  Catálogo y el Presupuesto lo muestran. No cambia `qty` (tests T7/T8).
- **Defecto encontrado y corregido dentro de F4 (evidencia: tests "Carrera").**
  La marca automática leía los conceptos fuera de transacción y reescribía el
  documento completo. Una confirmación concurrente 14.00 → 15.75 se revertía a
  14.00, y la evaluación tardía de una revisión vieja borraba la marca vigente.
  Ahora cada concepto se marca en su propia transacción, se relee y se omite si
  el plano ya avanzó de revisión.
- **P1-002 · SIGUE ABIERTO:** `set-generators` y "Recalcular generadores"
  siguen sin consultar el baseline aprobado. F4 no lo cambió.

### Nuevos pendientes detectados en F4

- **P2-012 · Test F1 T7 intermitente (limitación del arnés, no del producto).**
  `retryAfterSeconds` se calcula con el reloj real, y el test compara el valor
  exacto entre tres roles. Bajo carga de la suite completa, una corrida dio
  3600 vs 3599 (evidencia: `f4-evidence/reg-test-run1-flaky.tap`). La segunda
  corrida completa dio 1974/1974, y F1 aislado pasó 3/3. Corrección propuesta:
  congelar el reloj del arnés durante el lote o comparar con tolerancia de ±1 s.
- **P2-013 · PDF multipágina: el análisis automático recibe el PDF completo.**
  Solo la página elegida entra al modelo (`underlay.page` se persiste), pero
  `/api/visual-ai` recibe todo el archivo. Los PDF grandes pueden exceder el
  límite del endpoint; el trazo manual sigue disponible. No se amplió en F4.
- **P2-014 · El plano original (fondo) vive solo en el dispositivo que lo cargó.**
  La geometría, las revisiones y las cantidades sí están en el servidor, y la UI
  avisa "Plano original disponible únicamente en este dispositivo". Otro
  usuario ve el CAD sin fondo hasta que exista almacenamiento en la nube.
- **P2-015 · Migración perezosa solo del proyecto que se abre.** Un
  levantamiento del bloque local sin `projectId`, o de un proyecto que nunca se
  abre, no se migra. El bloque local no se borra (rollback lógico de V1). Antes
  de retirarlo hace falta un reporte de pendientes por usuario.
- **P2-016 · Costo de la marca automática.** Cada autosave consulta todos los
  conceptos del proyecto y abre una transacción por cada concepto que depende
  del plano. Es correcto, pero en proyectos grandes con autosave frecuente
  conviene un índice `planoIds` en el concepto o un debounce en el servidor. La
  marca es best-effort: si falla, el plano igual se guarda, y el
  409 `GEOMETRY_CHANGED` sigue impidiendo confirmar geometría vieja.

### F4-QA en navegador (2026-09-26)

QA en navegador contra un **servidor QA local** (`test/qa/f4/qa-server.mjs`):
app real con Vite, handlers `/api` reales y Firestore en memoria. Los paquetes
`firebase/*` del navegador se sustituyen por shims con sesión QA fija. No se
tocó producción.

**Corregidos en F4-QA (con prueba de regresión en `test/f4SurveyCad.e2e.test.mjs`):**
- **P1 · Avisos del CAD invisibles.** "Generadores desactualizados" y "Escala
  sin confirmar" no tenían `grid-area` dentro de `.cad-ws`, que tiene altura
  fija y `overflow:hidden`. Quedaban recortados en una columna de 136 px bajo la
  barra de estado. Ahora tienen su propia fila `banners`, también en móvil.
- **P1 · La revisión no mostraba la operación.** Ahora muestra
  "ANTES 4.00 × 3.50 = 14.00 m² / NUEVO 4.50 × 3.50 = 15.75 m²"
  (`generatorOperationText`).
- **P1 · La tarjeta del levantamiento usaba la captura manual** (14.00) aunque
  el CAD autoritativo midiera 15.75. Ahora usa `computeSurveyQuantities` e
  indica el origen.
- **P2 · La cabecera del levantamiento no seguía al CAD** mientras se editaba.
  Solo se actualizaba al cambiar de pestaña.
- **P2 · "rev. N del plano"** en el visor de generadores mostraba en realidad la
  revisión de generadores. Ahora muestra ambas, cada una con su nombre.
- **P2 · `GET /api/levantamientos` ×3 por carga** y migraciones concurrentes: la
  recarga dependía de la identidad del objeto `user`. El aviso de migración se
  perdía en una carrera.

**Pendientes nuevos (no se corrigieron: no son de F4 o requieren diseño):**
- **P2-017 · "Sin P.U." en el panel del CAD** cuando el APU se asoció desde el
  Catálogo. `apuPu` solo se estampa si se asocia desde el CAD; el Presupuesto sí
  muestra el P.U. correcto. Comportamiento preexistente.
- **P2-018 · El panel de muro muestra "Volumen neto"** calculado con el espesor
  por defecto, sin marca junto al número. La nota de origen sí aparece en
  "Espesor", y el generador lo marca INCOMPLETO.
- **P2-019 · Peticiones duplicadas preexistentes** en cada carga:
  `GET /api/organizations` (2–3) y `POST /api/onedrive status`.
- **P2-020 · Aviso de pdf.js en el servidor** (`standardFontDataUrl`) durante la
  extracción vectorial. No bloquea.
- **P2-021 · Texto:** el visor dice "Confirma en el plano con 'Revisar
  generadores'", pero el botón del aviso se llama "Revisar cambios" (en el CAD
  existen ambos).
- **QA-001 · Falta QA con Firebase real** (Auth, Firestore y reglas) en
  staging o con emuladores, que requieren Java. El QA en navegador de F4 usó
  shims.

- **P2-003 · `retryAfterSeconds` en otros endpoints** (`visual-ai`, `assistant`,
  `upload-library`, `market-price`). Ya reciben el 429 con `code` y
  `retryAfterSeconds` desde `_authGuard.mjs`, pero sus handlers no los propagan
  al cuerpo de la respuesta.
