import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEngineeringResponse } from '../server/api-lib/_nebiusProvider.mjs';

// Minimal authorized context: the model may only reference these ids.
const context = { refs: [
  { id: 'E1', path: 'apu.x.calculated.total', value: 12345 },
  { id: 'E2', path: 'apu.x.engines.confidence', value: 'low' },
  { id: 'E3', path: 'apu.x.resource.materials.0.precioUnitario', value: 24 }
] };

const valid = () => ({
  summary: { text: 'Resumen de riesgos sin cifras en el texto.', evidenceRefs: ['E1'] },
  confidence: 'medium',
  facts: ['E1', 'E2'],
  inferences: [{ text: 'Una inferencia basada en evidencia.', evidenceRefs: ['E2'] }],
  risks: [{ text: 'Un riesgo relevante.', evidenceRefs: ['E3'] }],
  recommendedActions: [{ text: 'Una acción recomendada.', evidenceRefs: ['E1'] }],
  missingData: ['Falta evidencia adicional del proyecto.']
});
const throwsInvalid = (raw) => assert.throws(() => validateEngineeringResponse(raw, context), e => e.code === 'INVALID_MODEL_OUTPUT' && e.status === 502);

test('D. respuesta grounded válida -> PASS y resuelve evidenceRefs desde el contexto', () => {
  const out = validateEngineeringResponse(valid(), context);
  assert.equal(out.confidence, 'medium');
  assert.ok(Array.isArray(out.evidenceRefs) && out.evidenceRefs.every(r => typeof r.id === 'string' && 'value' in r));
  // Los valores provienen del contexto determinístico, no del texto del modelo.
  assert.equal(out.evidenceRefs.find(r => r.id === 'E1').value, 12345);
});

test('A. texto con dígitos en prose -> DENY (PROSE_DIGIT)', () => {
  const r = valid(); r.summary.text = 'El costo del acero es 24 por kg.';
  throwsInvalid(r);
});

test('A2. patrón de norma/enlace/HTML en prose -> DENY', () => {
  for (const bad of ['Cumple la norma NOM-001 aplicable.', 'Ver https://x.test para detalle.', 'Contiene <b>markup</b> real.']) {
    const r = valid(); r.risks[0].text = bad; throwsInvalid(r);
  }
});

test('B. evidenceRef inventado (fuera del contexto) -> DENY (UNKNOWN_EVIDENCE_REF)', () => {
  const r = valid(); r.facts = ['E1', 'E999']; throwsInvalid(r);
  const r2 = valid(); r2.summary.evidenceRefs = ['E1', 'E404']; throwsInvalid(r2);
});

test('C. schema inválido (clave faltante / confidence inválida / clave extra) -> DENY', () => {
  const missing = valid(); delete missing.risks; throwsInvalid(missing);
  const badConf = valid(); badConf.confidence = 'muy alta'; throwsInvalid(badConf);
  const extra = valid(); extra.hackField = true; throwsInvalid(extra);
  const badStmt = valid(); badStmt.inferences = [{ text: 'x', evidenceRefs: ['E1'], note: 'y' }]; throwsInvalid(badStmt);
});

test('RAÍZ. demasiados evidenceRefs (>30) -> DENY (REFS_TOO_MANY) — causa real del fallo intermitente', () => {
  const r = valid(); r.summary.evidenceRefs = Array(31).fill('E1'); throwsInvalid(r);
  const r2 = valid(); r2.facts = Array(40).fill('E1'); throwsInvalid(r2);
});

test('E. lista con más de 15 statements -> DENY', () => {
  const r = valid(); r.risks = Array(16).fill(0).map(() => ({ text: 'riesgo', evidenceRefs: ['E1'] })); throwsInvalid(r);
});

test('F. evidenceRefs vacío donde se requiere -> DENY', () => {
  const r = valid(); r.summary.evidenceRefs = []; throwsInvalid(r);
  const r2 = valid(); r2.facts = []; throwsInvalid(r2);
});
