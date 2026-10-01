# Plan de empaquetado F1–F5 (auditoría de los 131 cambios pendientes) — 2026-09-29

Estado: análisis. **Sin commits, sin push, sin deploy, sin junctions.** Baseline vigente: working tree **1977/1977 PASS**; `3ba73d7` aislado **1687/1687 PASS**. Nebius congelado en `3ba73d7`.

Nota de entrelazado: la integración Nebius (`3ba73d7`) YA committeó 3 archivos que pertenecen a fases: `_authGuard.mjs` (F1), `src/domain/rateLimitStatus.js` (F1) y **`src/domain/orgLibraryPermissions.js` (F5)**. Por tanto esos 3 NO están entre los 131 y NO deben re-empaquetarse.

---

## 1. MAPA DE LOS 131 CAMBIOS

### F1 — Paridad de roles / rate-limit justo / price-intelligence
- **Objetivo:** superadmin ya no exento del límite anti-abuso en endpoints de datos; price-intelligence cobra solo búsqueda web real; búsquedas fallidas no se cachean; lotes 429 → `PENDIENTE_LIMITE`/`pendiente_limite` con `retryAfterSeconds`.
- **Archivos:** `api/price-intelligence.mjs` (M), `server/api-lib/_priceIntelligenceCache.mjs` (M), `src/domain/materialPriceIntelligence2.js` (M), `src/domain/apuBatchQueue.js` (M), `src/features/catalogo/catalogBatchRunner.js` (??), hunk F1 de `src/services/apiClient.js` (`err.status`, `retryAfterSeconds`).
- **Dependencias:** `_authGuard.mjs` + `rateLimitStatus.js` (YA committed en `3ba73d7`).
- **Tests:** `test/f1RoleParity.e2e.test.mjs` + `test/helpers/roleParityHarness/{hooks,memdb,shim-admin,shim-client-firebase,world}.mjs`.
- **Impacto prod:** cambia comportamiento de rate-limit (el `_authGuard` ya está committed). **Depende de:** F0.

### F2 — Cantidad económica única
- **Objetivo:** una sola cantidad económica (linked APU → `concepto.qty`, PU = `calcAPUv2`; independiente → `cantidadObra`; explosión solo conceptos activos con APU). Motores toman `lines`; exportadores aceptan `explosion` precomputado + `scope` PRESUPUESTO|PROYECTO.
- **Archivos:** `src/domain/budgetScope.js` (??), `src/domain/presupuestoView.js` (??), `src/domain/presupuestoAggregation.js` (M), `src/domain/{explosionData,explosionEngine,laborExplosion,machineryExplosion,materialExplosion}.js` (M), `src/lib/explosionInputs.js` (??), `src/lib/{apuExportV2,apuDossierPdf,apuProjectDossierPdf,explosionPdf,explosionXlsx}.js` (M), `src/features/explosions/ExplosionsPanel.jsx` (M), `src/features/presupuesto/PresupuestoModule.jsx` (M).
- **Tests:** `test/f2EconomicQuantity.test.mjs`.
- **Impacto prod:** cambia el contrato de entrada de explosión/exportadores (mantener retrocompatibilidad). **Depende de:** F0.

### F3 — Generadores de cantidad persistentes
- **Objetivo:** generadores persistentes dentro de `catalogConceptos` (`generadores[]`, `elementIds`, `quantitySource` MANUAL|GENERATORS, `generatorRevisions` por plano → 409, `quantityHistory`); acción `set-generators`; qty manual en concepto GENERATORS → 409.
- **Archivos:** `src/domain/quantityGenerators.js` (??), `src/domain/catalogConceptoSchema.js` (M), `server/api-lib/_route-catalogo-conceptos.mjs` (M), `src/features/catalogo/{GeneratorsViewer.jsx (??),generateApuForConcepto.js (M),CatalogoModule.jsx (M)}`, `src/lib/generatorsExport.js` (??), hunk F3 de `src/services/apiClient.js` (`currentRevision`).
- **Tests:** `test/f3Generators.e2e.test.mjs`.
- **Depende de:** F2.

### F4 — Levantamientos en servidor + Survey CAD 2D/3D
- **Objetivo:** `/api/levantamientos` (revision + 409 REVISION_CONFLICT, migración perezosa); CAD por espacio (`planoTakeoffs` doc `survey:{surveyId}:{spaceId}`); `save-draft` (autosave) vs `save-version` (checkpoint); `set-generators` reconstruye desde `cadModel` persistido → 409 GEOMETRY_CHANGED; `generatorStaleness` automático.
- **Archivos:** `server/api-lib/{_route-levantamientos.mjs (??),_route-plano-takeoffs.mjs (M),_generatorStaleness.mjs (??)}`, `src/domain/{surveyToCadModel.js,levantamientoCadLink.js}` (??), `src/domain/cadModel.js` (M), `src/domain/levantamientoSchema.js` (M), `src/features/levantamiento/{LevantamientoCard,LevantamientoModule,SurveyDetail}.jsx (M),{SurveyCadTab.jsx,levantamientoCloud.js}(??)`, `src/features/planos/{PlanoTakeoffWorkspace.jsx (M),useCadDraftPersistence.js (??),cadPlanoCloud.js (??)}`, `src/features/planos/cad/{CadWorkspace.jsx,CadPropertiesPanel.jsx,cad.css,cadConceptService.js}(M),{CadGeneratorsSection.jsx,budgetBaselineService.js}(??)`.
- **Tests:** `test/f4SurveyCad.e2e.test.mjs`, `test/qa/f4/*` (harness dev), `test/helpers/pdfText.mjs`.
- **Depende de:** F3 (generadores), F2, y el núcleo CAD ya committed en HEAD.

### F5 — Reportes + Biblioteca empresarial + Programa/Actividades + Change orders + Paridad P0
Submódulos (candidatos a commits separados):
- **F5a Reportes:** `src/features/reportes/ReportCenter.jsx` (??), `src/lib/reports/{reportExports,reportModels,reportPdfKit,reportRenderers,reportXlsxKit}.js` (??), `test/f5Reports.test.mjs`, `test/qa/f5/render-pdf.mjs`.
- **F5b Biblioteca empresarial (paridad ADMIN/COLLABORATOR):** `server/api-lib/{_route-org-library.mjs,_orgLibraryCore.mjs}` (??), `src/domain/orgLibrarySchema.js` (??), `src/features/library/{OrgLibraryPanel.jsx,orgLibraryCloud.js}` (??), `src/domain/libraryReview.js` (M), tests `orgLibrarySchema.test.js`, `orgLibraryPermissions.test.js`, `test/orgLibrary.rules.test.mjs`, `test/orgLibraryCore.test.mjs`. (`orgLibraryPermissions.js` YA committed en `3ba73d7`.)
- **F5c Programa/Actividades/Curva S:** `src/domain/activity{Schema,Duration,Scheduling,Progress,Alerts}.js` + tests, `workingCalendar.js` + test, `programaFromCatalog.js` + test, `programaPipeline.test.js`, `sCurveWithBaseline.js` + test, `src/features/programa/ProgramaModule.jsx`.
- **F5d Change orders / baseline / impacto económico:** `src/domain/{changeOrderFromGeometry.js,budgetBaselineLookup.js,economicImpact.js}` + tests, `baselineChangeOrderPipeline.test.js`, `src/features/planos/cad/budgetBaselineService.js` (frontera F4/F5).
- **F5e Paridad de contexto APU (P0):** `src/domain/{apuContextResolution.js,apuGenerationContext.js}` + tests, `apuServerSideParity.test.js`, `server/api-lib/{_apuContextResolver.mjs,_apuGenerateCore.mjs}`, `api/generate-apu.mjs` (M), `test/apuOrgContextParity.e2e.test.mjs`.
- **Depende de:** F1–F4.

### Infra MIXTA (cross-phase — requiere split quirúrgico de hunks por commit)
- `api/gateway.mjs` (M): F4 (`/api/levantamientos`) + F5 (`/api/org-library`).
- `vercel.json` (M): rewrites F4/F5.
- `server/openai-apu-server.mjs` (M): F4 (`/api/org-library`) + P0 (generate-apu real handler).
- `firestore.rules` (M): reglas F4 (`levantamientos*`) + F5 (`orgLibrary*`).
- `package.json` (M): scripts de test F1–F5 + línea `test`.
- `src/main.jsx` (M): cableado UI de módulos nuevos (programa, reportes, biblioteca, survey CAD).
- `src/services/apiClient.js` (M): F1 (`err.status`/`retryAfterSeconds`) + F3 (`currentRevision`).
- `test/organizationsApi.test.mjs` (M): actualización de test (F1/F5).

### Documentación / Temporal
- `docs/V1_BACKLOG.md` (??) — backlog V1 (doc de proyecto; conservar).
- `docs/AUDITORIA_NEBIUS_2026-09-29.md` (??), `docs/PLAN_F1-F5_PACKAGING.md` (este) — **generados por esta sesión** (internos; eliminables).
- `test/nebiusDemoUi.mjs` (??) — test Nebius huérfano (excluido de `3ba73d7`); NO es F1–F5.
- `test/qa/f4/fixtures/qa-2-paginas.pdf` (??) — fixture binario generado por `make-fixtures.mjs`.
- `test/qa/f4/{qa-server.mjs,pdf-viewer.html,shims/*}`, `test/qa/f5/render-pdf.mjs` — harnesses de QA/dev (no producción).

---

## 2. MATRIZ CAD / 2D / 3D

| Capacidad | Impl. | Parcial | No existe | Archivo/módulo | Tests |
|---|:-:|:-:|:-:|---|---|
| Modelo geométrico común (`cadModel`) | ✅ | | | `src/domain/cadModel.js` (HEAD + F4) | `cadModel.test.js` (HEAD) |
| Edición de espacios | ✅ | | | `CadWorkspace`, `CadCanvas2D`, `SurveyCadTab` | `f4SurveyCad` |
| Selección sincronizada 2D/3D | ✅ | | | `CadCanvas2D` + `CadViewer3D` (`selectedElement`) | HEAD plano tests |
| Muros | ✅ | | | `CadCanvas2D`, `cadModel`, `planoElementBuilder` | `planoElementBuilder.test` |
| Puertas / Ventanas | ✅ | | | `CadCanvas2D`, `cadModel` (openings) | HEAD |
| Cotas / dimensiones | ✅ | | | `CadCanvas2D` (dimension) | `planoMeasurement.test` |
| Medidas manuales / calibración | ✅ | | | `planoMeasurement`, `PlanoTakeoffWorkspace` | `planoMeasurement`, `visualAiVectorTakeoff` |
| Snap | ✅ | | | `CadCanvas2D` (snap) | HEAD |
| Historial / undo-redo | ✅ | | | `CadCanvas2D` (undo/redo/history) | HEAD |
| Cuantificación | ✅ | | | `planoQuantification`, `cadConceptService` (area/perímetro/volumen) | `planoQuantification.test` |
| APU desde geometría | ✅ | | | `cadConceptService` (toApu), `quantityGenerators`, `CadGeneratorsSection` | `f3Generators`, `f4SurveyCad` |
| Persistencia / autosave | ✅ | | | `useCadDraftPersistence`, `_route-plano-takeoffs` (save-draft) | `f4SurveyCad` |
| Revisiones / checkpoints | ✅ | | | `_route-plano-takeoffs` (save-version, REVISION_CONFLICT), `cadPlanoCloud` | `f4SurveyCad` |
| Visor 3D profesional | ✅ | | | `Technical3DViewer`, `CadViewer3D`, `Model3DPreview` (Realista/Técnico) | `model3dDiagnostics`, `geometry3d` |
| Vistas interior / perspectiva | ✅ | | | `Technical3DViewer` (`CAMERA_VIEW_PRESETS`, perspective, orbit/pan/zoom) | HEAD |
| Materiales (3D) | | ⚠️ | | `Model3DPreview`/`Technical3DViewer` (material técnico; render realista aún no) | `model3dDiagnostics` |
| Modo corte / sección | | ⚠️ | | `CadViewer3D` (clip/section — verificar alcance) | verificar |
| Reconocimiento / importación de planos | ✅ | | | `planoVectorGeometry`, `visual-ai` vector takeoff, `PlanoTakeoffWorkspace` | `visualAiVectorTakeoff`, `planoVectorGeometry` |

**Cadena Levantamiento → Modelo → 2D/3D → Cuantificación → Conceptos → APU → Presupuesto → Confidence/Bid Risk/Auditoría → Copilot: presente de extremo a extremo.** Faltantes = pulido: render realista de materiales (hoy solo modelo técnico; no hay proveedor de render real — `NullAIRenderProvider`), y confirmar alcance del modo corte/sección.

### 3. Terminado / Parcial / No existe
- **Terminado:** modelo geométrico, edición, selección 2D/3D, muros/puertas/ventanas, cotas, snap, undo/redo, cuantificación, APU-desde-geometría, autosave, checkpoints, visor 3D técnico, importación/reconocimiento de planos.
- **Parcial:** materiales realistas (render), modo corte/sección (verificar).
- **No existe (aún):** render fotorrealista con proveedor real; edición 3D directa (hoy el 3D es visor derivado, la edición es 2D).

---

## 4. PROPUESTA DE COMMITS (no crear todavía)
No se necesita un commit "restore baseline": los 13 fallos eran corrupción de `node_modules`, ya reparada; no hay fix de baseline.

Orden por dependencias: **F1 → F2 → F3 → F4 → F5(a–e)**. Cada commit con split quirúrgico de los archivos MIXTOS (solo su hunk).

| # | Commit | Archivos (núcleo) | Depende | Tests que deben pasar | Riesgo |
|---|---|---|---|---|---|
| C1 | `feat(pricing): F1 role-parity rate limiting` | price-intelligence, _priceIntelligenceCache, materialPriceIntelligence2, apuBatchQueue, catalogBatchRunner, apiClient(hunk F1), harness, f1 test | `_authGuard` (ya en 3ba73d7) | `test:f1`, suite base | MEDIO (comportamiento rate-limit) |
| C2 | `feat(budget): F2 single economic quantity` | budgetScope, presupuestoView, presupuestoAggregation, explosion*, explosionInputs, exportadores(scope), ExplosionsPanel, PresupuestoModule, f2 test | F0 | `test:f2`, explosion/export integ. | MEDIO (contrato de explosión) |
| C3 | `feat(catalog): F3 persistent quantity generators` | quantityGenerators, catalogConceptoSchema, _route-catalogo-conceptos(hunk), GeneratorsViewer, generateApuForConcepto, CatalogoModule, generatorsExport, apiClient(hunk F3), f3 test | C2 | `test:f3` | MEDIO (409 conflictos) |
| C4 | `feat(survey-cad): F4 levantamientos + CAD 2D/3D` | _route-levantamientos, _route-plano-takeoffs(hunk), _generatorStaleness, surveyToCadModel, levantamientoCadLink, cadModel(hunk), levantamientoSchema, UI levantamiento/planos/cad, firestore.rules(hunk F4), gateway(hunk F4), vercel(hunk F4), openai-apu-server(hunk F4), f4 test + qa/f4 | C3 | `test:f4`, emulador reglas | ALTO (reglas + rutas nuevas) |
| C5a | `feat(reports): F5 report center` | reportes/ReportCenter, lib/reports/*, f5 test, qa/f5 | C2–C4 | `test:f5` | BAJO |
| C5b | `feat(org-library): F5 enterprise library parity` | _route-org-library, _orgLibraryCore, orgLibrarySchema, OrgLibraryPanel, orgLibraryCloud, libraryReview, firestore.rules(hunk F5), gateway/vercel/openai(hunk F5), org tests | C1 (entitlement), C4 | `test:orglibraryrules`, `test:apuparity` | ALTO (reglas orgLibrary) |
| C5c | `feat(schedule): F5 programa/actividades/curva S` | activity*, workingCalendar, programaFromCatalog, sCurveWithBaseline, ProgramaModule, tests | C2 | tests de dominio | BAJO |
| C5d | `feat(change-orders): F5 geometry change orders + baseline` | changeOrderFromGeometry, budgetBaselineLookup, economicImpact, budgetBaselineService, tests | C4 | tests de dominio | MEDIO |
| C5e | `feat(apu-context): P0 admin/collaborator parity` | apuContextResolution, apuGenerationContext, _apuContextResolver, _apuGenerateCore, generate-apu(hunk), apuServerSideParity/apuOrgContextParity tests | C1, C5b | `test:apuparity` | MEDIO |
| Cx | `chore: package.json test scripts + main.jsx wiring` | package.json(hunks por fase — idealmente repartidos en C1–C5), main.jsx(hunks por fase) | — | suite base | MEDIO (mejor repartir, no un commit suelto) |

Nota: `package.json`, `src/main.jsx`, `apiClient.js`, `gateway.mjs`, `vercel.json`, `firestore.rules`, `openai-apu-server.mjs` son MIXTOS: sus hunks deben repartirse en el commit de su fase (método de staging quirúrgico ya probado en `3ba73d7`).

---

## 5. TEMPORALES (eliminables después, con seguridad)
- `docs/AUDITORIA_NEBIUS_2026-09-29.md` y `docs/PLAN_F1-F5_PACKAGING.md` — informes de esta sesión; internos. Motivo: no son código ni parte de F1–F5.
- `test/nebiusDemoUi.mjs` — test Nebius huérfano (ningún script lo invoca; excluido de `3ba73d7`). Motivo: redundante con `nebiusUi.mjs`.
- Worktrees temporales `D:\ztpre`, `D:\zthead`, `D:\PROYECTOS\ZOEMEC IA APU\.tmp\predeploy-3ba73d7` — ya sin `node_modules`; eliminables con `git worktree remove` (sin junctions). Motivo: artefactos de validación.
- `test/qa/f4/*` y `test/qa/f5/render-pdf.mjs` — NO eliminar: son harnesses de QA de F4/F5 (mantener con su fase, aunque no van a producción runtime).

---

## 6. RIESGOS
- **P0:** ninguno bloqueante. La separación es factible con split quirúrgico (método probado).
- **P1:** (a) 7 archivos MIXTOS requieren repartir hunks por fase (apiClient F1/F3, main.jsx multi-módulo, firestore.rules F4/F5, gateway/vercel/openai F4/F5, package.json F1–F5). (b) `orgLibraryPermissions.js` (F5) ya quedó en `3ba73d7` — la F5 debe excluirlo. (c) F4 toca reglas Firestore + rutas nuevas (validar en emulador por commit).
- **P2:** materiales realistas / modo corte (pulido futuro); temporales a limpiar.

---

## 7. RECOMENDACIÓN DE SIGUIENTE DESARROLLO (tras integrar F1–F5)
La cadena determinista Levantamiento→APU→Presupuesto ya existe. Prioridad post-integración para el "Taller de Proyecto 2D/3D":
1. **Cerrar el lazo survey→CAD→generators→APU en UX** (ya funcional; pulir).
2. **Modo corte/sección 3D** y **materiales** (pulido del visor).
3. **Render realista** solo si se justifica (hoy `NullAIRenderProvider`; no inventar render IA).
4. Recién entonces, integrar `3ba73d7` (Copilot Nebius) sobre esta base verde para explicar la cadena.

## Estado
`F1-F5 READY FOR PACKAGING` — separables limpiamente con split quirúrgico; sin contaminación bloqueante. La única atadura (orgLibraryPermissions ya committed en Nebius) es menor y contemplada.
