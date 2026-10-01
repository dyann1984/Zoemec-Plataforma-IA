# Auditoría independiente — Integración Nebius × NVIDIA (Codex) sobre ZOEMEC

**Fecha:** 2026-09-29 · **Revisor:** agente independiente (no autor del código) · **Rama:** `feature/visor3d-profesional` · **HEAD:** `677304d`
**Regla observada:** sin commit, sin revert, sin reset/checkout/clean/stash, sin force-push, **sin deploy**. Trabajo previo sin commit conservado intacto.

---

## 1. ESTADO GENERAL

La integración Nebius/NVIDIA de Codex es **ADITIVA, grounded y correcta en arquitectura**. No sustituye ningún motor determinístico, no amplía accesos de Firestore, mantiene la clave server-side y la demo es imposible de sembrar en producción por diseño (fail-closed real). Todas las verificaciones ejecutables **PASAN**. La única parte no comprobada es la **llamada real a Nebius/NVIDIA**, que está **BLOQUEADA POR CREDENCIAL** (no existe `NEBIUS_API_KEY`), exactamente como Codex reportó.

**Recomendación: GO para conservar e integrar la capa; NO-GO para deploy** hasta ejecutar el smoke real con clave y validar semántica (ver §19–20).

El árbol de trabajo NO estaba limpio (el snapshot inicial de git estaba desactualizado): contiene una mezcla de **trabajo V1 previo sin commit** (F1–F5: paridad de roles, cantidad económica, generadores, levantamientos CAD, reportes, biblioteca empresarial, actividades/programa) **y** la **capa Nebius de Codex**. La auditoría separó ambas.

---

## 2. AUDITORÍA DE CAMBIOS DE CODEX (archivo · cambio · necesidad · riesgo)

### Archivos NUEVOS de Codex (capa IA) — todos necesarios, riesgo LOW
| Archivo | Cambio | Clasificación | Riesgo |
|---|---|---|---|
| `server/api-lib/_nebiusProvider.mjs` | Proveedor desacoplado: config, schema, validación, fetch con allowlist de host + `redirect:'error'`, timeout 45s | A (aditivo) | LOW |
| `server/api-lib/_engineeringContext.mjs` | Context Builder: assertScope, minimización PII, límites, refs inmutables con `value` | A | LOW |
| `server/api-lib/_engineeringOrchestrator.mjs` | Auth/scope, carga autorizada, audit fail-closed antes de gastar créditos, rate limit | A | LOW |
| `server/api-lib/_route-engineering-ai.mjs` | Endpoint `/api/engineering-ai` (GET estado, GET admin superadmin, POST análisis) | A | LOW |
| `src/features/apu/EngineeringCopilot.jsx` + `engineeringCopilot.css` | UI Copilot grounded, estados completos, sin morado | A | LOW |
| `src/features/admin/NebiusAdminStatus.jsx` | Telemetría admin sin inventar costos | A | LOW |
| `src/domain/nebiusDemo.js` | Datos sintéticos DEMO (`isDemo:true`) | B (demo) | LOW |
| `scripts/seed-nebius-demo.mjs` | Seed fail-closed (aborta sin emuladores) | B | LOW |
| `scripts/nebius-smoke.mjs` | Smoke manual (consume 1 llamada real, solo DEMO) | B | LOW |
| `test/nebiusEngineering.test.mjs`, `nebiusApi.test.mjs`, `nebiusRules.test.mjs`, `nebiusUi.mjs`, `nebiusDemoUi.mjs`, `test/qa/nebius/*` | Pruebas con proveedor MOCK (no consumen crédito) | B | LOW |
| `docs/HACKATHON_NEBIUS_NVIDIA.md`, `docs/NEBIUS_BASELINE.md` | Documentación honesta (marca pendientes) | C | LOW |

### Archivos MODIFICADOS por Codex (hunks aislados del trabajo previo)
| Archivo | Hunk de Codex | Clasificación | Riesgo |
|---|---|---|---|
| `firestore.rules` | Catch-all `match /{document=**}` → `match /{collection}/{document=**}` con `isSuperAdmin() && collection != 'engineeringAiAudit'` | D (endurece) | **LOW** |
| `api/gateway.mjs` | +1 ruta `/api/engineering-ai` | A | LOW |
| `server/openai-apu-server.mjs` | +`/api/engineering-ai` a GATEWAY_PATHS; +`setHeader` en el shim HTTP local (dev) | A/B | LOW (solo dev local) |
| `vercel.json` | +rewrite `/api/engineering-ai` → gateway | A | LOW |
| `package.json` | +5 scripts nebius (`test:nebius*`, `demo:nebius-seed`, `nebius:smoke`); pruebas nebius **fuera** de `npm test` | B | LOW |
| `.env.example` | +`NEBIUS_API_KEY=` (vacío), base URL, modelo; comentario "SOLO SERVIDOR, nunca VITE_" | C | LOW |
| `README.md` | Documentación | C | LOW |
| `src/features/apu/ZoemecIntelligencePanel.jsx` | +2 líneas (import + `<details>` con Copilot) | A | LOW |
| `src/features/projects/workspace/ProjectWorkspace.jsx` | +3 líneas (import + `<details>` Copilot) | A | LOW |
| `src/features/admin/AdminPanel.jsx` | +2 líneas (monta NebiusAdminStatus) | A | LOW |

> Nota de atribución: en `firestore.rules`, `gateway.mjs`, `openai-apu-server.mjs`, `vercel.json` y `package.json` **también** hay cambios PREVIOS (F4 levantamientos, biblioteca empresarial orgLibrary, paridad P0 generate-apu, tests F1–F5). Se identificaron por contenido y se listan en §16.

**Ningún hunk de Codex es de tipo E (riesgo producción) ni F (innecesario).** No se encontró cambio destructivo ni regresión.

---

## 3. REGRESIONES ENCONTRADAS

**Ninguna.** Suite existente `npm test` = **1977 PASS / 0 fail / 0 skipped** (46 s), idéntica al baseline. Build de producción PASS. Ningún motor determinístico modificado por Codex.

---

## 4. CORRECCIONES REALIZADAS

**Ninguna necesaria.** No se modificó ningún archivo durante esta auditoría (salvo la creación de este informe). La preocupación de Fase 7 ("¿la validación rechaza cifras de forma demasiado restrictiva?") se analizó y se concluyó que **NO requiere corrección** (ver §12/anti-hallucination).

---

## 5. PRUEBAS

| Suite | Comando ejecutado | Resultado |
|---|---|---|
| Regresión existente | `node --test` (194 archivos del script `test`) | **1977 PASS**, 0 fail, 0 skip (46 s) |
| Nebius unitaria (mock) | `test/nebiusEngineering.test.mjs` | **17 PASS**, 0 fail (Codex reportó 15) |
| Nebius reglas + API (emulador real) | `firebase emulators:exec … nebiusRules + nebiusApi` | **10 PASS**, 0 fail |
| Seguridad ejecutada | Incluida en las 10 anteriores: tenant B≠A, miembro desactivado DENY, superadmin no evade scope, audit no falsificable ni legible directo (PERMISSION_DENIED @ L615 confirmado en emulador), telemetría solo superadmin, rate limit atómico, método no soportado 405 | **PASS** |
| UI | No re-ejecutada aquí (requiere Playwright/Edge); revisada por código: estados loading/error/no-config/no-evidence/late-response/project-switch presentes | Revisión estática PASS; ejecución **NOT RE-VERIFIED** en esta sesión |

Logs guardados en el scratchpad de la sesión: `phase3-fullsuite.log`, `phase17-nebius-engineering.log`, `phase5-nebius-api-rules.log`, `phase18-build.log`.

---

## 6. BUILD

`vite build` → **✓ built in ~1.1 s**. Solo advertencias **preexistentes** (`INEFFECTIVE_DYNAMIC_IMPORT` en `apuProjectDossierPdf/Xlsx`, `cameraCapture`, `levantamientoMediaUpload/ModelLoader`; chunks > 650 kB). **Ninguna advertencia nueva** referida a archivos Nebius/engineering.

---

## 7. FIRESTORE / MULTI-TENANT

- Cambio de Codex = **endurecimiento**, no ampliación. `engineeringAiAudit` (colección de nivel superior) queda excluida del catch-all de superadmin → solo Admin SDK escribe/lee. Confirmado en emulador (PERMISSION_DENIED @ L615 al intentar crear/actualizar como superadmin).
- `match /{collection}/{document=**}` cubre lo mismo que `match /{document=**}` (todo documento vive bajo una colección de nivel superior) salvo la exclusión intencional. Sin IDOR, sin lectura entre tenants, sin escritura de telemetría desde cliente.
- Reglas nuevas de trabajo PREVIO (levantamientos, orgLibrary) también son server-only (`allow write: if false`) y scoped por `organizationId`/`ownerUid`. Bien formadas.
- **Tenant isolation PASS** (evidencia emulador).

---

## 8. DEMO ISOLATION

**PASS (fail-closed real).** `scripts/seed-nebius-demo.mjs` **lanza excepción** si faltan `FIRESTORE_EMULATOR_HOST` y `FIREBASE_AUTH_EMULATOR_HOST` en localhost/127.0.0.1; usa `create()` solo `if (!exists)` (nunca sobrescribe). Con host de emulador, el Admin SDK habla con el emulador → no puede alcanzar producción. Datos marcados `isDemo:true`, fuentes "Cotización DEMO sintética/ESTIMADO", material sin fuente para disparar hallazgos reales.

---

## 9. NEBIUS

- Proveedor server-side desacoplado. `NEBIUS_API_KEY` solo `process.env`, server-side. **0 apariciones** del literal en `dist/`; el frontend nunca llama a `tokenfactory`/`chat/completions`.
- Allowlist de host (2 URLs oficiales) + `redirect:'error'` evita fuga de la clave a destino arbitrario. Timeout 45 s, sin reintentos. Validación estricta de respuesta (modelo, finish_reason, refusal, schema, refs).
- Sin clave: endpoint devuelve estado **"Nebius no configurado"** (código específico), sin simular explicación ni fallback a OpenAI.

---

## 10. NVIDIA / NEMOTRON

- Modelo por defecto `nvidia/nemotron-3-super-120b-a12b`, exigido por regex `^nvidia\/…nemotron…$`.
- Transporte `POST {baseUrl}/chat/completions`, `response_format: json_schema strict`. Documentación oficial citada en `docs/HACKATHON_NEBIUS_NVIDIA.md`.
- **Disponibilidad del modelo para la cuenta, aceptación exacta del schema y latencia: NO VERIFICADAS** (requieren clave).
- ⚠️ Observación técnica (§13 P1): el proveedor exige `data.model === config.model` exacto; si Nebius devuelve un id versionado, la respuesta se rechazaría como `INVALID_MODEL_OUTPUT`. Verificar en el smoke real.

---

## 11. LLAMADA REAL

**BLOQUEADA POR CREDENTIAL.** No existe `NEBIUS_API_KEY` en el proceso ni en `.env.local`; `docs/NEBIUS_REAL_CALL.json` no existe. Consistente con lo reportado. No se consumió crédito. Fase 15 y Fase 16 (E2E real) quedan pendientes de credencial.

---

## 12. SEGURIDAD (grounding · anti-alucinación · prompt injection · PII · clave)

- **Grounding:** el cliente envía solo `{projectId, apuId?, question, scenario?}`. El servidor resuelve proyecto/APUs/memoria PROJECT/evidencia con autorización, ejecuta motores determinísticos (`calcAPUv2`, `computeZoemecIntelligence`, `runScenarioLab`) y construye refs inmutables. El modelo **solo selecciona referencias**, no escribe FACT.
- **Anti-alucinación:** `prose()` rechaza cualquier dígito/enlace/HTML/norma en el texto del modelo. **Análisis de la duda de Fase 7:** esto NO es demasiado restrictivo porque **los números se muestran de forma determinística** desde `evidenceRefs → refs.get(id).value` en la UI (§EngineeringAnswer). El modelo no necesita repetir cifras; ZOEMEC las renderiza. Permitir cifras en el texto libre **aumentaría** la superficie de alucinación. → **No requiere cambio.**
- **Prompt injection:** SYSTEM_PROMPT declara pregunta/recursos/evidencia como DATOS NO CONFIABLES; prueba `nebiusEngineering` cubre "instrucción incrustada permanece como dato". Sin herramientas ejecutables. React escapa; sin `dangerouslySetInnerHTML`.
- **PII:** `flatten()` descarta claves `email|owner|user|createdBy|approvedBy|storage|url|token|secret`; `cleanText()` redacta URL/correo/secretos. No universal (revisar antes de datos privados reales).
- **Clave:** server-side, nunca en bundle/logs/response/Firestore. Audit guarda hash de contexto, nunca prompts ni claves.

---

## 13. P0 PENDIENTES

Ninguno bloqueante en código. El único P0 abierto es **operativo**: ejecutar la llamada real con clave (§19). Checklist P0 al final.

## 13-bis. P1 PENDIENTES (no bloqueantes)
- **P1-A:** verificar en smoke real la igualdad `data.model === config.model` (posible id versionado de Nebius). Si difiere, relajar a comparación por prefijo/normalización documentada.
- **P1-B:** re-ejecutar la suite UI (`test:nebius-ui`) en esta máquina para confirmar 1440/390/320 px (requiere Playwright/Edge). Revisión estática OK.
- **P1-C:** el endpoint usa `deferRateLimit` de `_authGuard.mjs`, que es **trabajo PREVIO sin commit** (F1). La capa Nebius depende de él; considerarlo al planear commits.

---

## 14. (ver §13-bis)

## 15. ARCHIVOS QUE MODIFIQUÉ YO (revisor)
- `docs/AUDITORIA_NEBIUS_2026-09-29.md` (este informe). **Ningún archivo de código fue tocado.**

## 16. ARCHIVOS QUE YA HABÍA MODIFICADO/PREVIOS (NO Codex)
Trabajo V1 previo sin commit (F1–F5 y otros), conservado intacto. Ejemplos:
- Reglas: hunks de `levantamientos`, `levantamientosAudit`, `orgLibrary`, `orgLibraryAudit` en `firestore.rules`.
- Rutas previas: `_route-org-library.mjs`, `_route-levantamientos.mjs`, `_apuGenerateCore.mjs`, `_apuContextResolver.mjs`, `_orgLibraryCore.mjs`, `_generatorStaleness.mjs`.
- Dominio: `budgetScope.js`, `quantityGenerators.js`, `surveyToCadModel.js`, `economicImpact.js`, `activity*.js`, `programaFromCatalog.js`, `orgLibrary*.js`, `sCurve*.js`, `changeOrderFromGeometry.js`, `budgetBaselineLookup.js` (+ sus `.test.js`).
- Features/lib: `programa/`, `reportes/ReportCenter.jsx`, `library/OrgLibraryPanel.jsx`, `catalogo/GeneratorsViewer.jsx`, `planos/cad/CadGeneratorsSection.jsx`, `lib/reports/*`, etc.
- Tests: `f1RoleParity`, `f2EconomicQuantity`, `f3Generators`, `f4SurveyCad`, `f5Reports`, `orgLibrary*`, `apuOrgContextParity`, `test/qa/f4/*`, `test/qa/f5/*`, harness `roleParityHarness`.
- `.env.example`/`gateway.mjs`/`openai-apu-server.mjs`/`vercel.json`/`package.json`: partes NO-Nebius (generate-apu real, org-library, F4).

(Listado completo del working tree en el respaldo `phase0-backup/status.txt`.)

---

## 17. QUÉ PODEMOS AFIRMAR EN DEVPOST CON EVIDENCIA
1. Capa de IA **aditiva** sobre ZOEMEC en producción; no reemplaza motores determinísticos (APU, Confidence, Bid Risk, Auditoría, Scenario, evidencia).
2. Arquitectura grounded: Context Builder autorizado → motores determinísticos → Nebius Token Factory → NVIDIA/Nemotron → validación estructural + de referencias → UI basada en evidencia.
3. Aislamiento multi-tenant verificado en emulador (tenant B no lee A, miembro desactivado denegado, superadmin no evade scope).
4. Clave **solo server-side** (0 en bundle); frontend nunca llama al proveedor directo.
5. Anti-alucinación por diseño: el modelo referencia evidencia; las cifras las renderiza ZOEMEC; textos sin dígitos/enlaces/normas.
6. Prompt injection tratado: documentos/preguntas como datos no confiables (con prueba).
7. Demo **fail-closed** imposible de sembrar en producción; datos marcados DEMO.
8. Telemetría admin sin inventar costos/tokens.
9. Regresión: **1977 pruebas existentes PASS**; build PASS; 27 pruebas nuevas (17 mock + 10 emulador) PASS.

## 18. QUÉ NO DEBEMOS AFIRMAR TODAVÍA
- Que la llamada real a Nebius/NVIDIA funciona (no ejecutada; sin clave).
- Que el modelo `nvidia/nemotron-3-super-120b-a12b` está disponible para la cuenta y acepta el JSON Schema exacto.
- Latencia/tokens/costos reales.
- Que la validación garantiza **corrección semántica** (solo formato + referencias; requiere revisión humana).
- Capturas de mocks NO son evidencia de integración real.

---

## 19. PASOS EXACTOS PARA COMPLETAR LA ENTREGA
1. Configurar `NEBIUS_API_KEY` en el entorno del servidor / `.env.local` (nunca commitear, nunca pegar en chat).
2. Consultar documentación oficial vigente de Nebius Token Factory y confirmar el id exacto del modelo y el schema.
3. Ejecutar smoke con solo datos DEMO: `node --env-file=.env.local scripts/nebius-smoke.mjs`. Verificar HTTP 200, `data.model`, respuesta válida, refs, latencia. Ajustar P1-A si el id difiere.
4. Levantar emuladores + `npm run ai` + `npm run dev` con proyecto `demo-zoemec-nebius`; recorrer login → APU DEMO → ZOEMEC AI → evidencia → escenario → "Analizar proyecto con IA".
5. Validar semántica con varios APUs; confirmar que las cifras provienen de indicadores/evidencia (no del texto del modelo).
6. Re-ejecutar `test:nebius-ui` (Playwright/Edge) para 1440/390/320 px.
7. Grabar demo real (modelo e id visibles); NO usar mocks como evidencia.
8. Solo entonces crear `docs/NEBIUS_REAL_CALL.json` con la evidencia (sin claves ni prompts).

## 20. RECOMENDACIÓN GO / NO-GO PARA DESPLIEGUE
- **Integración de la capa (conservar el trabajo de Codex):** **GO.** Es segura, aislada y aditiva.
- **Despliegue a producción:** **NO-GO** hasta completar §19 (clave + smoke real + validación semántica + demo real). **No se desplegó nada.** zoemecia.com permanece intacto.

---

## Checklist P0
- [x] ZOEMEC preexistente sigue funcionando (1977 PASS, build PASS)
- [x] No se sustituyó ningún motor determinístico
- [x] Demo aislada
- [x] Demo imposible de sembrar accidentalmente en producción (fail-closed)
- [x] Firestore seguro (endurecido)
- [x] Tenant isolation PASS (emulador)
- [x] API key server-side (0 en bundle)
- [x] Copilot grounded
- [x] Evidence refs validadas
- [x] Anti-hallucination probado
- [x] Prompt injection mitigado (con prueba)
- [x] Nebius provider funcional (mock + estructura)
- [ ] NVIDIA/Nemotron real — **BLOCKED BY CREDENTIAL**
- [ ] Smoke test real PASS — **BLOCKED BY CREDENTIAL**
- [ ] E2E real PASS — **BLOCKED BY CREDENTIAL**
- [x] Suite existente PASS
- [x] Suite nueva PASS (mock 17 + emulador 10)
- [x] Build PASS
- [~] Responsive — revisión estática OK; re-ejecución UI pendiente (P1-B)
- [x] Documentación correcta y honesta
- [x] No deployment realizado

---
---

# CIERRE TÉCNICO (Fase 2 · 2026-09-29) — continuación

Continuación autorizada para cerrar pendientes y determinar readiness para prueba real. **No se desplegó, no se hizo commit/push/merge, no se tocó ningún motor. No se modificó código; solo este informe.**

## Estado confirmado
Branch `feature/visor3d-profesional`, HEAD `677304d` sin cambios. Working tree = 157 entradas previas + este informe. Respaldo no destructivo conservado en scratchpad (`phase0-backup/`).

### NEBIUS/NVIDIA (capa del hackathon)
| Archivo | Función | Estado |
|---|---|---|
| `_nebiusProvider.mjs` | Cliente proveedor: config, schema, validación, fetch fail-closed | OK (real call sin verificar) |
| `_engineeringContext.mjs` | Context Builder autorizado + minimización | OK |
| `_engineeringOrchestrator.mjs` | Orquestación, audit fail-closed, rate limit | OK (depende de F1, ver P1-C) |
| `_route-engineering-ai.mjs` | Endpoint `/api/engineering-ai` | OK |
| `EngineeringCopilot.jsx` + `engineeringCopilot.css` | UI grounded | **PASS UI real (Edge)** |
| `NebiusAdminStatus.jsx` | Telemetría admin | OK |
| `nebiusDemo.js`, `seed-nebius-demo.mjs`, `nebius-smoke.mjs` | Demo fail-closed + smoke manual | OK |
| `test/nebius*.mjs`, `test/qa/nebius/*` | Pruebas mock/emulador | PASS |
| Hunks en `firestore.rules` (exclusión audit), `gateway.mjs`, `openai-apu-server.mjs`, `vercel.json`, `package.json`, `.env.example`, 3 JSX (+7 líneas) | Puntuales | OK |

### PREEXISTENTE / F1–F5 (NO TOCAR)
F1 paridad de roles (incl. `deferRateLimit`/`consumeRateLimit` en `_authGuard.mjs`), F2 cantidad económica, F3 generadores, F4 levantamientos CAD + reglas, F5 reportes; biblioteca empresarial (`orgLibrary*`), actividades/programa, `budgetScope`, `economicImpact`, etc. Listado completo en `phase0-backup/status.txt`.

## Resolución de pendientes P1

### P1-A — `data.model === config.model` → **SE DEJA INTACTA (fail-closed)**
- Evidencia oficial (docs Nebius Token Factory, API reference, 2026-09-29): el ejemplo de respuesta **devuelve el id exacto solicitado** (`"model":"meta-llama/Llama-3.3-70B-Instruct"`). El catálogo confirma que el id del modelo es exactamente `nvidia/nemotron-3-super-120b-a12b` (minúsculas).
- La documentación **NO garantiza** eco exacto universal, y los backends compatibles con OpenAI (vLLM/NIM) pueden devolver un id versionado/normalizado. No es verificable sin clave.
- **Decisión:** no se relaja sin evidencia de fallo real (regla del usuario). La igualdad estricta mantiene fail-closed y el ejemplo documentado la respalda. **Es la verificación #1 del smoke real.**
- **Cambio mínimo LISTO (aplicar SOLO si el smoke real devuelve un id legítimo distinto):** en `_nebiusProvider.mjs`, sustituir `data.model !== config.model` por una comprobación de que `data.model` cumple el mismo regex `^nvidia\/…nemotron…$` (y comparte familia con `config.model`). Sigue rechazando cualquier modelo no-nvidia/no-nemotron → **no rompe fail-closed**, solo tolera sufijo de versión/casing. No se aplica ahora.

### P1-B — UI real → **PASS**
`node test/nebiusUi.mjs` con Playwright (runtime) + Edge (`msedge`), exit 0. Validó: carga, estado sin configurar (botón deshabilitado), pregunta sugerida y libre, evidencia expandible, escenario determinístico (value 8), error recuperable (502→alert "validación"), evidencia insuficiente (422), loading, **cambio de proyecto descarta respuesta tardía**, responsive 1440/390/320 sin overflow horizontal, **0 errores de consola**. El router de prueba **aborta cualquier host ≠127.0.0.1** → confirma ausencia de llamadas directas navegador→Nebius. Capturas en `.tmp/nebius-ui/copilot-{1440,390,320}.png`. Log: `p1b-nebius-ui.log`.

### P1-C — dependencia `deferRateLimit` → **DEPENDENCIA REAL DE F1 (no reorganizado)**
- **Dónde:** `deferRateLimit` es opción de `requireFeature(req, feature, { deferRateLimit })` en `server/api-lib/_authGuard.mjs`; `consumeRateLimit()` es el callback devuelto por esa función.
- **Qué cambio lo introdujo:** el trabajo **F1/P0 sin commit**. Verificado: en HEAD `677304d`, `deferRateLimit`=0 y `consumeRateLimit`=0 apariciones; ambos existen solo en la copia de trabajo. El límite `assistant: {max:40}` sí es preexistente/committed.
- **Acoplamiento:** `_route-engineering-ai.mjs` llama `requireFeature(req,'assistant',{deferRateLimit:true})` y pasa `authz.consumeRateLimit` al orquestador, que hace `await consumeRateLimit()` antes de la llamada al proveedor.
- **¿Puede Nebius funcionar sin F1?** En el árbol ACTUAL sí (F1 está presente → funciona; mock/emulador/UI lo confirman). Pero si se **separaran** los cambios Nebius y se desplegaran sobre HEAD sin F1: `requireFeature` ignoraría el 3er argumento (comportamiento HEAD) y **`authz.consumeRateLimit` sería `undefined`** → el orquestador ejecutaría `await undefined()` → **TypeError → 500 en cada POST**. El rate limit inline seguiría cobrándose, así que NO hay fuga de seguridad, pero el endpoint quedaría inoperante.
- **Conclusión:** F1 (`_authGuard.mjs`) **debe viajar junto con (o antes de) la capa Nebius** en cualquier commit/deploy. No se reorganiza ahora (regla del usuario). Alternativa de desacople mínimo, si algún día se quiere Nebius independiente de F1: en el orquestador `if (typeof consumeRateLimit === 'function') await consumeRateLimit();` y en la ruta no pasar `deferRateLimit` (dejar que `requireFeature` cobre inline). **No se aplica ahora — solo análisis.**

## Credencial (Fase 3)
`NEBIUS_API_KEY`: **AUSENTE** en proceso y en todos los `.env*` (`.env`, `.env.local`, `.env.development.local`, `.env.example`, backup). `.gitignore` cubre `.env*`; ninguno rastreado → sin secretos en git. `VITE_NEBIUS`=0 en `src`. `docs/NEBIUS_REAL_CALL.json` no existe.

**Dónde configurarla de forma segura (sin pegarla en el chat):**
- **Local (para el smoke):** añadir `NEBIUS_API_KEY=<clave>` a `.env.local` (gitignored; lo cargan `npm run ai` y `node --env-file=.env.local scripts/nebius-smoke.mjs`). Nunca commitear.
- **Producción (más adelante, no ahora):** variable de entorno server-side en Vercel (**sin** prefijo `VITE_`), igual que `FIREBASE_SERVICE_ACCOUNT_JSON`/`SUPERADMIN_EMAILS`.

## Smoke real (Fase 4) y Grounding con respuesta real (Fase 5)
**BLOQUEADO POR CREDENCIAL.** No se ejecutó ninguna llamada real ni se simuló. El grounding queda verificado **estructuralmente** (context→engines→refs→renderer; UI muestra cifras desde indicadores/`evidenceRefs`, texto del modelo sin dígitos) pero la verificación con **respuesta real** queda pendiente de clave.

## Tabla de entrega
| Verificación | Estado | Evidencia |
|---|---|---|
| 1977 pruebas base | **PASS** | `node --test` 194 archivos → 1977/0/0 (46s), `phase3-fullsuite.log` |
| Nebius mock | **PASS** | `nebiusEngineering` 17/0, `phase17-nebius-engineering.log` |
| Emulador (reglas+API) | **PASS** | `nebiusRules`+`nebiusApi` 10/0 con Firestore/Auth emulados, `phase5-nebius-api-rules.log` |
| UI Playwright | **PASS** | `test/nebiusUi.mjs` exit 0, Edge, 1440/390/320, `p1b-nebius-ui.log`, screenshots |
| API key | **AUSENTE** | proceso + `.env*` sin valor (no mostrada) |
| Smoke real | **BLOCKED** | falta `NEBIUS_API_KEY` |
| Grounding | **PASS (estructural)** | refs inmutables + `prose()` sin dígitos; real pendiente de clave |
| Secretos frontend | **PASS** | 0 `NEBIUS_API_KEY` en `dist/`, 0 `VITE_NEBIUS`, sin fetch directo a tokenfactory |
| Tenant isolation | **PASS** | emulador: B≠A, miembro desactivado DENY, superadmin no evade |
| Rate limit | **PASS** | emulador: cuota atómica `assistant` aplicada entre requests |
| Build | **PASS** | `vite build` OK, solo warnings preexistentes, `phase18-build.log` |

## Clasificación
- **P0 (bloquea integración):** ninguno de código. Único bloqueo = credencial para la prueba real (operativo).
- **P1 (resolver antes del hackathon):**
  - P1-C: asegurar que F1 (`_authGuard.mjs`) se integre junto con la capa Nebius (dependencia `consumeRateLimit`).
  - P1-A: confirmar `data.model` en el smoke real; aplicar el cambio mínimo solo si aparece un id legítimo distinto.
- **P2 (mejora posterior):**
  - `cleanText` no es detector universal de PII: revisar contenido técnico antes de usar datos privados reales.
  - Considerar tolerancia de versión de modelo documentada tras confirmar el comportamiento real de Nebius.

## ESTADO FINAL
**C) BLOCKED BY CREDENTIAL.**
Todas las verificaciones ejecutables PASAN y la integración es funcional en el árbol actual; el **único** obstáculo para la prueba real es la ausencia de `NEBIUS_API_KEY`. En cuanto se configure la clave server-side, el sistema queda **listo para la prueba real** (READY FOR REAL TEST) sin cambios adicionales de código. **No se desplegó nada; zoemecia.com intacto.**

---
---

# CIERRE — LLAMADA REAL Y ESTABILIZACIÓN (Fases 4–5 · 2026-09-29)

Con `NEBIUS_API_KEY` configurada server-side (en `.env.local`, nunca commiteada ni mostrada). Cambios de código SOLO en `_nebiusProvider.mjs` (dos parámetros del request) + un archivo de pruebas nuevo. Motores, schema, evidenceRefs, prose y validaciones fail-closed **intactos**. Sin commit/push/deploy.

## Iteración de la llamada real
1. **401 Unauthorized** — primera clave inválida/incompleta (18 chars). Corregida por el usuario.
2. **INVALID_MODEL_OUTPUT por truncación** — causa: `finish_reason:"length"`; modelo de razonamiento agotó `max_tokens:4096` (3511 reasoning tokens). **Fix autorizado:** `max_tokens 4096→16384`. Truncación eliminada (`finish_reason:"stop"` estable).
3. **INVALID_MODEL_OUTPUT intermitente (~23%)** — causa raíz identificada empíricamente (no hipótesis): **`REFS_TOO_MANY`**. El modelo, de forma no determinista, sobre-cita: en el caso capturado puso **256 evidenceRefs** en `summary.evidenceRefs` y 256 en `facts`, superando el tope de 30 de `checkedRefs`. `finish_reason` era `"stop"` y el JSON válido → no era dígito, ref inexistente ni schema. **Fix autorizado:** añadir `temperature: 0` (documentado, soportado 0–2, no desactiva reasoning; `seed` NO añadido por no estar documentado).

## Cambio final aplicado (mínimo)
`server/api-lib/_nebiusProvider.mjs`, cuerpo del request:
`max_tokens: 4096` → `16384`, y `+ temperature: 0`. Nada más.

## Tests añadidos (`test/nebiusValidatorGuards.test.mjs`)
A dígitos en prose → DENY · A2 norma/enlace/HTML → DENY · B evidenceRef inventado → DENY · C schema inválido → DENY · **REFS_TOO_MANY (>30) → DENY** (la causa raíz) · >15 statements → DENY · refs vacíos → DENY · **D respuesta grounded válida → PASS**. 8/8 PASS. Guardrails NO debilitados.

## Resultados verificados
| Verificación | Estado | Evidencia |
|---|---|---|
| Guard tests + mock | **25 PASS** / 0 fail | `p5-guardtests.log` |
| Emulador (reglas+API) | **10 PASS** / 0 fail | `p5-emulator.log` |
| Build | **PASS** (1.21s, sin impacto: cambio server-only) | `p5-build.log` |
| **Smoke real oficial** | **PASS (exit 0)** | `docs/NEBIUS_REAL_CALL.json` |
| HTTP status | **200** | proveedor solo retorna éxito con `ok`+`stop` |
| finish_reason | **stop** | validación superada |
| Modelo solicitado/devuelto | `nvidia/nemotron-3-super-120b-a12b` / idéntico (**MATCH**) | proof |
| Latencia | 23.5 s | proof |
| Usage | prompt 12 771 · completion 4 524 · total 17 295 | proof (reasoning incluido en completion; el proveedor solo registra los 3 totales) |
| evidenceRefs | **17** (E1,E4,E21,E228,E24,E46,E203,E170,E181,E192,E35,E214,E178,E188,E199,E211,E222) — enfocado, <30 | proof |
| Guardrail result | **PASS** | finish stop + model match + schema + refs≤30 + prose sin dígitos + sin refusal |
| Grounding | **PASS** | las 17 refs resuelven a valores deterministas: E4=cantidad 800, E21=importeTotal 29765.68 (calcAPUv2), E228=Bid Risk "…concentra 69.8%…", E24/E46/E35=hallazgos auditoría, E170/E181/E192/E214=Bid Risk/Challenge |
| Cifras desde texto libre | **NO** | los números provienen solo de `evidenceRefs.value` (motores), no del texto del modelo |
| Secretos (clave) | **ausente** | 0 en `dist/`, 0 en el proof, 0 en logs; el proof no guarda prompt/mensajes/clave |

## ESTADO FINAL: **REAL PROVIDER VERIFIED**
La llamada real oficial pasa completamente con el modelo NVIDIA/Nemotron vía Nebius; grounding y guardarraíles verificados. **Retries automáticos NO añadidos** (no autorizados): si alguna vez reaparece la no-determinación, el guardarraíl fail-closed la convierte en un error recuperable en UI. **No se desplegó; HEAD `677304d` y zoemecia.com intactos.**

---
---

# INVENTARIO Y PLAN DE INTEGRACIÓN (Fase final · 2026-09-29)

Sin commit/push/deploy/merge. Sin nuevas llamadas reales. Grafo de importación trazado.

## A. NEBIUS PURO
### A.1 Archivos NUEVOS (untracked) — obligatorios para producción salvo nota
| Ruta | Estado | Propósito | Prod | Depende de |
|---|---|---|---|---|
| `server/api-lib/_nebiusProvider.mjs` | untracked | Proveedor: config, schema, validación, fetch (`max_tokens:16384`, `temperature:0`, allowlist, redirect:error, timeout 45s) | **SÍ** | `_engineeringContext` (aiError) |
| `server/api-lib/_engineeringContext.mjs` | untracked | Context Builder: scope, PII, límites, refs inmutables | **SÍ** | `zoemecIntelligence.js`, `technicalMemory.js`, `apuCalc.js` (todos COMMITTED) |
| `server/api-lib/_engineeringOrchestrator.mjs` | untracked | Orquestación, audit fail-closed, `consumeRateLimit()` | **SÍ** | `_engineeringContext`, `_nebiusProvider`, `node:crypto` |
| `server/api-lib/_route-engineering-ai.mjs` | untracked | Endpoint `/api/engineering-ai` | **SÍ** | `_authGuard`(**F1**), `_orgGuard`(committed), `_firebaseAdmin`(committed), `_nebiusProvider`, `_engineeringOrchestrator`, `_engineeringContext` |
| `src/features/apu/EngineeringCopilot.jsx` | untracked | UI copiloto grounded | **SÍ** | `apiClient.js` (versión COMMITTED sirve), `engineeringCopilot.css` |
| `src/features/apu/engineeringCopilot.css` | untracked | Estilos (azul, sin morado) | **SÍ** | — |
| `src/features/admin/NebiusAdminStatus.jsx` | untracked | Telemetría admin | **SÍ** (panel admin) | `apiClient.js` (committed) |

### A.2 Puntos de montaje (tracked, MODIFICADOS, aditivos)
| Ruta | Estado | Propósito | Prod | Nota |
|---|---|---|---|---|
| `src/features/apu/ZoemecIntelligencePanel.jsx` | M (+2) | Monta Copilot en `<details>` | **SÍ** | solo Nebius |
| `src/features/projects/workspace/ProjectWorkspace.jsx` | M (+3) | Monta Copilot | **SÍ** | solo Nebius |
| `src/features/admin/AdminPanel.jsx` | M (+2) | Monta NebiusAdminStatus | **SÍ** | solo Nebius |

### A.3 Infra MIXTA (tracked, MODIFICADOS) — extraer SOLO el hunk Nebius
| Ruta | Hunk Nebius | Prod | Contaminación a EVITAR |
|---|---|---|---|
| `api/gateway.mjs` | import + ruta `/api/engineering-ai` | **SÍ** | rutas F4/F5 `org-library`, `levantamientos` |
| `vercel.json` | rewrite `/api/engineering-ai` → gateway | **SÍ** | rewrites F4/F5 |
| `firestore.rules` | catch-all excluye `engineeringAiAudit` | **SÍ** | reglas F4/F5 `levantamientos*`, `orgLibrary*` |
| `server/openai-apu-server.mjs` | path `/api/engineering-ai` + shim `setHeader` | **NO** (solo dev local) | swap generate-apu, `org-library` (pre-existentes) |
| `package.json` | 5 scripts `test:nebius*`/`nebius:smoke`/`demo:nebius-seed` | **NO** (dev/test) | scripts y tests F1–F5 en `test` |
| `.env.example` | `NEBIUS_API_KEY=`, base URL, modelo | **NO** (plantilla) | — |
| `README.md` | documentación | **NO** | — |

## B. DEPENDENCIAS F1 NECESARIAS — conjunto MÍNIMO (evita `TypeError 500`)
El orquestador hace `await consumeRateLimit()`. En HEAD `677304d`, `requireFeature` NO devuelve `consumeRateLimit` → sería `undefined` → **`TypeError 500` en cada POST**. Conjunto mínimo:
| Ruta | Estado | Aporta | Prod | Depende de |
|---|---|---|---|---|
| `server/api-lib/_authGuard.mjs` | M | `requireFeature(...,{deferRateLimit})` + `consumeRateLimit()` | **SÍ** | `rateLimitStatus.js`, `orgLibraryPermissions.js`, `_firebaseAdmin`(committed), `organization.js`(committed) |
| `src/domain/rateLimitStatus.js` | untracked | `RATE_LIMIT_CODE`, `computeRetryAfterSeconds` (HOJA, sin imports) | **SÍ** | — |
| `src/domain/orgLibraryPermissions.js` | untracked | `resolvePaidFeatureEntitlement` | **SÍ** | `organization.js` (COMMITTED) |

**Advertencia (P1):** el `_authGuard.mjs` de F1 también trae la **paridad de roles** (superadmin ya no exento de rate limit; entitlement por membresía) que afecta a TODOS los endpoints que usan `requireFeature` (`apu`,`assistant`,`visual`,`ai`,`library`,`price-intelligence`), no solo Nebius. No es puramente aditivo a Nebius. Dos caminos (decisión, no bloqueo):
- **(a)** Integrar los 3 archivos F1 como bundle deliberado (acepta el cambio de comportamiento de paridad, que era un fix P0 previo).
- **(b) Desacople mínimo (requiere autorización, cambio de código):** en `_route-engineering-ai.mjs` no usar `deferRateLimit` (cobro inline de `requireFeature`) y en `_engineeringOrchestrator.mjs` hacer `if (typeof consumeRateLimit === 'function') await consumeRateLimit();`. Entonces Nebius **no necesita ningún archivo F1**.

## C. TESTS (untracked)
`test/nebiusEngineering.test.mjs` (17, mock) · `test/nebiusValidatorGuards.test.mjs` (8, NUEVO: guardrails A/B/C/D + REFS_TOO_MANY) · `test/nebiusApi.test.mjs` + `test/nebiusRules.test.mjs` (10, emulador) · `test/nebiusUi.mjs`, `test/nebiusDemoUi.mjs`, `test/qa/nebius/{index.html,main.jsx}` (UI) · `scripts/nebius-smoke.mjs` (real manual) · `scripts/seed-nebius-demo.mjs` + `src/domain/nebiusDemo.js` (demo, fail-closed, **NO prod**).

## D. DOCUMENTACIÓN / EVIDENCIA (untracked)
`docs/HACKATHON_NEBIUS_NVIDIA.md` · `docs/NEBIUS_BASELINE.md` · `docs/NEBIUS_REAL_CALL.json` (evidencia sanitizada) · `docs/AUDITORIA_NEBIUS_2026-09-29.md` (este informe).

## E. CAMBIOS PREEXISTENTES QUE DEBEN QUEDAR FUERA (NO Nebius)
- **`src/services/apiClient.js` (M):** cambio F1/F3 (`currentRevision`, `err.status`, `retryAfterSeconds`). Nebius usa la versión COMMITTED (`apiPost`/`apiGetSafe` ya existen en HEAD; el Copilot solo usa `err.message`). **NO incluir.**
- **`src/domain/catalogConceptoSchema.js` (M):** cambio F2/F3; solo lo toca `nebiusDemo` (demo, no prod). **NO incluir en prod.**
- Motores/dominio modificados (F1–F5): `materialPriceIntelligence2.js`, `presupuestoAggregation.js`, `explosion*.js`, `cadModel.js`, `labor/machinery/materialExplosion.js`, `levantamientoSchema.js`, `libraryReview.js`, `apuBatchQueue.js`, etc.
- Nuevos dominio F1–F5: `budgetScope`, `quantityGenerators`, `surveyToCadModel`, `economicImpact`, `activity*`, `programa*`, `orgLibrarySchema`, `orgLibraryCore`, `sCurve*`, `changeOrder*`, `budgetBaselineLookup`, `presupuestoView`, `apuContextResolution`, `apuGenerationContext`, `rateLimitStatus`/`orgLibraryPermissions` (**estos dos SÍ entran, ver B**).
- Rutas/servicios F4/F5: `_route-levantamientos`, `_route-org-library`, `_apuGenerateCore`, `_apuContextResolver`, `_orgLibraryCore`, `_generatorStaleness`.
- Features F4/F5: `programa/`, `reportes/`, `library/OrgLibraryPanel`, `catalogo/GeneratorsViewer`, `planos/cad/CadGeneratorsSection`, `lib/reports/*`, etc.
- Tests F1–F5: `f1RoleParity`, `f2`, `f3`, `f4`, `f5`, `orgLibrary*`, `apuOrgContextParity`, `test/qa/f4`, `test/qa/f5`, `helpers/roleParityHarness`.
- Hunks F4/F5 dentro de archivos mixtos (reglas/gateway/vercel/openai-apu-server/package.json). `docs/V1_BACKLOG.md`.

## VERIFICACIÓN DE ESTADO FINAL
| Ítem | Estado |
|---|---|
| `max_tokens: 16384` | ✅ |
| `temperature: 0` | ✅ |
| sin `seed` | ✅ (0 ocurrencias) |
| sin retry | ✅ (0 ocurrencias) |
| modelo `nvidia/nemotron-3-super-120b-a12b` | ✅ DEFAULT_MODEL + regex |
| API key solo server-side | ✅ (0 `VITE_NEBIUS`, 0 en `dist`) |
| ningún secreto en frontend/dist | ✅ (0 literal, 0 `NEBIUS_API_KEY`) |
| guardarraíles intactos | ✅ (finish stop, model ===, refusal, schema, refs≤30, prose sin dígitos, host allowlist, redirect error, timeout, fail-closed, sin fallback) |
| grounding determinístico | ✅ (refs→valores de motores) |
| rate limit funcional | ✅ (emulador: cuota atómica) |
| tenant isolation funcional | ✅ (emulador: B≠A, desactivado, superadmin no evade) |

## ESTADO DE TESTS/BUILD (sin llamadas reales)
guards+mock **25/25** · emulador **10/10** · build **PASS** (1.12s) · UI Playwright PASS (previo). Evidencia real ya generada (`NEBIUS_REAL_CALL.json`).

## RIESGOS
- **P0:** ninguno bloqueante.
- **P1:** (a) acoplamiento F1 `_authGuard` — enviar los 3 archivos F1 juntos **o** desacoplar (opción b). (b) Archivos MIXTOS requieren extracción quirúrgica de hunks para no arrastrar F4/F5. (c) `REFS_TOO_MANY` mitigado por `temperature:0`; sin retry, un caso raro se muestra como error recuperable en UI.
- **P2:** (a) `cleanText` no es detector universal de PII. (b) `nebiusDemo`/`catalogConceptoSchema` no requeridos en prod. (c) tolerancia de versión de modelo (hoy `===` estricto, verificado que coincide).

## PLAN PARA COMMIT LIMPIO (posterior — NO ejecutar ahora)
1. Rama de integración desde la base deseada.
2. Añadir A.1 (7 archivos nuevos) + A.2 (montajes) aplicando SOLO sus hunks.
3. Añadir B (3 archivos F1) **o** aplicar desacople (b) para no depender de F1.
4. Aplicar SOLO hunks Nebius en A.3 (gateway, vercel, firestore.rules, package.json, .env.example; openai-apu-server/README opcionales).
5. Añadir C (tests) + D (docs).
6. Excluir explícitamente todo E (apiClient, catalogConceptoSchema, motores/dominio/rutas/features/tests F1–F5).
7. Configurar `NEBIUS_API_KEY` en env server-side de Vercel (sin `VITE_`).
8. Correr suite completa + nebius mock/guards + emulador + UI + build; luego 1 smoke real en el entorno destino.
9. Verificar guardarraíles/grounding/tenant/rate limit → decisión de deploy.

## PRODUCCIÓN
`zoemecia.com` **intacto**: HEAD `677304d` sin cambios, nada en staging, sin commit/push/merge/deploy.

## ESTADO: **READY FOR CLEAN INTEGRATION**
Aislamiento correcto y dependency set F1 mínimo definido (3 archivos, con opción de desacople). No se detectó bloqueador nuevo.
