# Baseline Nebius / NVIDIA — 2026-09-29

Antes de implementar: React 18 / Vite 8, JavaScript ESM, Firebase Auth,
Firestore y Storage; endpoints Node en Vercel y servidor local en puerto 8787.
El gateway conserva el límite de funciones de Vercel. El árbol contiene numerosos
cambios anteriores sin commit; esta entrega no los revierte ni los atribuye al hackathon.

Validaciones ejecutadas antes de cambios:
- `npm test`: 1977 pruebas, 0 fallos, 0 omitidas; salida en `.tmp/nebius-baseline-tests.log`.
- `npm run build`: éxito; advertencias preexistentes de importación dinámica/estática.
- Lint y typecheck: no hay scripts ni configuración; no se declara PASS.

Mapa de arquitectura:
- UI: `src/main.jsx`, `src/features/projects/workspace`, `src/features/apu`.
- APU determinístico: `src/lib/apuCalc.js`, `src/domain/apuProfessional.js`.
- Confidence, Bid Risk, auditoría, Challenge y escenarios: `src/domain/apuConfidence.js`,
  `bidRisk.js`, `apuAuditor.js`, `apuChallenge.js`, `apuScenario.js`.
- Orquestación existente: `src/features/apu/zoemecIntelligence.js`.
- Memoria técnica: `src/domain/technicalMemory.js`, `_route-technical-memory.mjs`.
- Biblioteca/evidencia: `src/features/library`, `src/domain/evidenceItem.js`.
- Visual IA: `api/visual-ai.mjs`; levantamientos: `src/features/levantamiento`.
- 2D/3D: `src/features/planos/cad`, `src/features/visual3d`.
- Reportes: `src/features/reportes`, `src/lib/reports`, exportadores PDF/XLSX.
- IA previa OpenAI: `api/assistant.mjs`, `api/generate-apu.mjs`, `_openaiApuCore.mjs`.
- Auth/RBAC: `_authGuard.mjs`, `_orgGuard.mjs`, `src/domain/permissions.js`, Firestore rules.
- Pruebas: node:test; integración Firebase requiere emuladores.

Riesgos observados: `canAccessOrgScopedDoc` permite dueño sin comprobar membresía activa;
el nuevo endpoint aplicará una comprobación más estricta sin cambiar ese contrato legado.
El catch-all de Firestore permite al superadmin escribir colecciones: los nuevos registros
de IA se excluirán explícitamente de ese catch-all para que sean solo del servidor.
La memoria y el APU deben leerse desde el servidor; no confiar en indicadores del cliente.
No hay variables Nebius en los archivos de entorno inspeccionados. Una llamada real no está verificada.

Plan: proveedor desacoplado, contexto autorizado y minimizado, validación de referencias,
endpoint con cuotas, panel contextual, resumen y escenarios mediante motores existentes,
telemetría administrativa sin prompts, demo aislada, pruebas mock y documentación.
