# ZOEMEC PRE-RELEASE RC1

## Estado

Release Candidate validado. Auditoría pre-release completa (Fase 9, dos rondas) cerrada con **0 P0 abiertos y 0 P1 abiertos**.

## Capacidades incluidas

- Generación de APUs desde concepto (individual y por lote), con motor de plantillas determinista y ruta de IA opcional.
- Cálculo determinista de precio unitario (materiales, mano de obra, equipo, herramienta menor, consumibles, seguridad/EPP, indirectos, financiamiento, utilidad, cargos adicionales) — verificado con recálculo independiente línea por línea, coincidencia exacta.
- Auditor (`apuAuditor.js`) — hallazgos de calidad matemática/estructural por severidad.
- Challenge (`apuChallenge.js`) — cuestionamiento de desviaciones (precio/rendimiento) con decisión y trazabilidad de actor.
- Confidence (`apuConfidence.js`) — score de confianza por dimensión, nunca inventa un número donde no hay evidencia (`INSUFFICIENT_EVIDENCE` explícito).
- Bid Risk (`bidRisk.js`) — severidad y exposición estimada por APU y por proyecto.
- Scenario Engine (`apuScenario.js`) — simulaciones de precio/rendimiento/mano de obra/desperdicio/reemplazo de recurso, nunca muta el APU base, rechaza NaN/Infinity/negativos.
- Technical Memory (`technicalMemory.js` + `api/technical-memory.mjs`) — memoria técnica aprobada por scope (usuario/proyecto/organización), con flujo de aprobación auditado.
- Decisiones profesionales — Challenge decisions con identidad real del actor, nunca falsificable desde el cliente.
- Persistencia autoritativa (Fase 7) — proyectos y APUs viven en documentos reales de Firestore (no en blobs sin validar), con transacciones server-side.
- Versionado inmutable — cada guardado crea una versión nueva, nunca sobreescribe una anterior; restaurar crea una versión nueva con el contenido restaurado.
- **Control de concurrencia optimista** (agregado en esta ronda) — `expectedParentVersionId` obligatorio en cada guardado de versión; un guardado que parte de una base obsoleta se rechaza con `409 VERSION_CONFLICT` real, nunca pierde en silencio el cambio de otro guardado.
- Migración legacy — datos del blob anterior (pre-Fase 7) se migran de forma transparente e idempotente a proyectos/APUs autoritativos, sin duplicar en reintentos, sin tocar el blob original.
- Dossier individual (PDF/XLSX) — documento auditable por APU con portada, matriz completa, Auditor, Challenge, Confidence, Bid Risk, Memoria, historial de versiones.
- Dossier de proyecto (PDF/XLSX) — multi-APU: portada, resumen de proyecto, ranking de riesgo, hallazgos, distribución de confianza, escenarios seleccionados (cuando se piden explícitamente), una hoja por concepto — probado a escala (100 APUs).
- Trazabilidad — cada renglón de recurso registra fuente/estado/fecha; cada versión registra actor, razón y snapshot completo.
- Hashes de integridad de snapshot (`snapshotHash.js`) — determinísticos, recalculados server-side (nunca aceptados tal cual del cliente tras esta ronda).
- Export events — registro auditable de cada exportación, con identidad real del actor y contenido (versiones/hashes) recalculado server-side contra el estado real del recurso.

## Validación

| Suite | Resultado |
|---|---|
| `npm test` | 638/638 PASS |
| `test:projects` | 33/33 PASS |
| `test:security` | 130/130 PASS |
| `test:rules` | 42/42 PASS |
| `test:memory` | 3/3 PASS |
| `rm -rf dist && npm run build` | PASS |

**Pruebas de escala (Fase 9):**
- 500 conceptos → 500 resultados generados, 0 perdidos, 0 fallidos (pipeline local determinista, ~313ms).
- Project Dossier con 100 APUs → 100 hojas de concepto en XLSX (107 hojas totales), 0 perdidos, 0 duplicados, sin NaN/Infinity; PDF de 808 páginas. Sin timeout, sin crash.

## Seguridad corregida

Durante la auditoría pre-release se encontraron y corrigieron 2 hallazgos P0 y 4 P1 (ver `PRE_RELEASE_AUDIT.md` para el detalle técnico completo, evidencia y tests de regresión):

- **Confidencialidad cross-tenant en Memoria Técnica/Challenge Decisions** — una cuenta sin relación con un proyecto podía leer precios aprobados y proveedores preferidos de otra organización directamente vía Firestore. Cerrado a nivel de reglas de seguridad.
- **Integridad de eventos de exportación** — el contenido de un evento de exportación (versiones, hashes) ahora se recalcula siempre server-side contra el estado real, nunca se acepta tal cual del cliente.
- **Evasión del límite del plan gratuito** — la generación de APUs por lote y el guardado desde el editor moderno no aplicaban el límite de plan; ambos caminos ahora lo respetan.
- **Concurrencia optimista en el guardado de versiones** — dos guardados concurrentes ya no pueden perder en silencio el cambio de uno de ellos; el segundo recibe un conflicto real y explícito.
- **Pérdida silenciosa de APUs al generar un segundo lote en el mismo proyecto** — corregido (causa raíz: colisión de claves de posición entre lotes distintos).

## Limitaciones conocidas

Hallazgos P2 abiertos (documentados, no corregidos en esta ronda — no bloquean RC1):

- **F-001** — Los presupuestos derivados (generados desde uno o varios APUs) pueden quedar desactualizados si el APU de origen se corrige después; no hay indicador visual de "esto es un snapshot" ni botón de recálculo. (Reclasificado de P1 a P2 tras análisis: el registro autoritativo del APU nunca está mal, solo esta copia de conveniencia.)
- **F-005** — Normalización de unidades incompleta (ej. notación `m^2` no se normaliza a `m²`); no afecta ningún cálculo, solo presentación/agrupación.
- **F-007** — Accesibilidad: algunos controles de ícono en los paneles de Auditor/Challenge/Confidence/Bid Risk/Scenario no tienen `aria-label`.
- **F-008** — El bundle inicial carga la librería 3D (`three`) para todos los usuarios aunque no usen el visor 3D; falta code-splitting.
- **F-009** — El mecanismo para incluir escenarios seleccionados en el Dossier de Proyecto existe y está probado, pero no hay control de UI para elegirlos desde el botón real del proyecto.

No se marcan como "bugs resueltos" — quedan documentados como pendientes de una fase futura.

## Deployment

**NO desplegado todavía.** Esta es una congelación (freeze) local del estado validado, no una publicación.
