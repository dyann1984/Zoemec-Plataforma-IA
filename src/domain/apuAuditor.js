/* ZOEMEC AUDITOR (Fase 1): motor de auditoria consolidado. No reemplaza
   ninguna logica existente -- combina en un solo punto de entrada las 4
   fuentes de "issues" que ya existian dispersas (validateApuSchemaV2,
   findApuNumericIssuesV2, runTechnicalQualityRules, y los checks de negocio
   ahora extraidos como collectApuBusinessIssues en apuProfessional.js) y las
   normaliza a un vocabulario unico de severidad (CRITICAL/HIGH/MEDIUM/LOW/
   INFO), que ninguna de esas 4 fuentes comparte hoy entre si:
   - technicalQualityRules.js ya usa severity:'error' (string).
   - findApuNumericIssuesV2 no emite severity en absoluto.
   - los checks de negocio usan severity:'warning'|'error'.
   validateAPU (apuProfessional.js) sigue funcionando exactamente igual que
   antes -- este modulo es aditivo, no lo toca. */
import { calcAPUv2, findApuNumericIssuesV2 } from '../lib/apuCalc.js';
import { validateApuSchemaV2 } from './apuSchema.js';
import { runTechnicalQualityRules } from './technicalQualityRules.js';
import { collectApuBusinessIssues } from './apuProfessional.js';

export const AUDIT_SEVERITY = Object.freeze({
  CRITICAL: 'CRITICAL', HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW', INFO: 'INFO'
});

/* Tabla de severidad por codigo, documentada y auditable a simple vista --
   nunca se infiere severidad por instancia (eso seria "inventar" criterio).
   Los codigos vienen de las 4 fuentes reales (ver imports arriba); agrupados
   aqui por fuente para que sea facil verificar cobertura contra el codigo
   fuente de cada modulo. */
const SEVERITY_BY_CODE = {
  // findApuNumericIssuesV2 (src/lib/apuCalc.js): valores numericos rotos o
  // un rendimiento en cero hacen que el importe calculado sea incorrecto o
  // $0 -- no son observaciones, son bloqueos reales.
  non_finite_value: AUDIT_SEVERITY.CRITICAL,
  negative_value: AUDIT_SEVERITY.CRITICAL,
  zero_rendimiento: AUDIT_SEVERITY.CRITICAL,
  rendimiento_sin_cuadrilla: AUDIT_SEVERITY.HIGH,
  possible_crew_fragmentation: AUDIT_SEVERITY.HIGH,
  missing_integration: AUDIT_SEVERITY.MEDIUM,
  missing_rendimiento_diario: AUDIT_SEVERITY.MEDIUM,
  missing_vida_util: AUDIT_SEVERITY.MEDIUM,
  missing_cantidad_lote: AUDIT_SEVERITY.MEDIUM,
  epp_reusable_sin_amortizar: AUDIT_SEVERITY.MEDIUM,
  // technicalQualityRules.js: un recurso esperado por disciplina que falta
  // por completo (ej. "acero sin acero") es un defecto tecnico grave.
  discipline_missing_expected_resource: AUDIT_SEVERITY.CRITICAL,
  // collectApuBusinessIssues (src/domain/apuProfessional.js)
  missing_labor: AUDIT_SEVERITY.CRITICAL,
  missing_unit: AUDIT_SEVERITY.CRITICAL,
  missing_concept: AUDIT_SEVERITY.CRITICAL,
  missing_materials: AUDIT_SEVERITY.HIGH,
  zero_cantidad_obra: AUDIT_SEVERITY.HIGH,
  price_without_source: AUDIT_SEVERITY.MEDIUM,
  stale_price: AUDIT_SEVERITY.MEDIUM,
  duplicate_resource: AUDIT_SEVERITY.LOW,
  price_without_date: AUDIT_SEVERITY.LOW
};

/* Codigo no catalogado arriba (ej. un codigo nuevo de validateApuSchemaV2
   como negative_cantidad_obra/verified_without_source/empty_herramienta_detalle,
   que hoy no traen severity propio): nunca se degrada en silencio a INFO --
   un error de esquema que no sabemos clasificar debe verse (CRITICAL) para
   que un humano lo revise, no perderse entre las observaciones menores. */
function resolveSeverity(code){
  return SEVERITY_BY_CODE[code] || AUDIT_SEVERITY.CRITICAL;
}

function normalizeFinding(raw, origin){
  const severity = resolveSeverity(raw.code);
  const location = [raw.kind, raw.index != null ? `#${raw.index + 1}` : null].filter(Boolean).join(' ');
  return {
    id: `${origin}:${raw.code}${raw.index != null ? ':' + raw.index : ''}`,
    severity,
    category: raw.category || raw.kind || origin,
    code: raw.code,
    message: raw.message,
    evidence: location || null,
    kind: raw.kind ?? null,
    index: raw.index ?? null,
    field: raw.field ?? null,
    recommendation: raw.message,
    status: 'OPEN'
  };
}

export function runApuAudit(apu = {}, options = {}){
  const totals = options.totals || calcAPUv2(apu);
  const now = options.now ? new Date(options.now) : new Date();
  const findings = [
    ...validateApuSchemaV2(apu).map(i => normalizeFinding(i, 'schema')),
    ...findApuNumericIssuesV2(apu, totals).map(i => normalizeFinding(i, 'numeric')),
    ...runTechnicalQualityRules(apu).map(i => normalizeFinding(i, 'technical_quality')),
    ...collectApuBusinessIssues(apu, { now }).map(i => normalizeFinding(i, 'business'))
  ];
  const summary = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  findings.forEach(f => { summary[f.severity.toLowerCase()]++; });
  // Generaliza el precedente ya existente en calculateAPUConfidence
  // (apuProfessional.js), que cappea la confianza global a 40 si hay una
  // falla critica de QA tecnico: aqui CUALQUIER finding CRITICAL, de
  // cualquiera de las 4 fuentes, bloquea el estado global -- nunca se
  // promedia como si el problema no existiera.
  const status = summary.critical > 0 ? 'REQUIERE_REVISION_CRITICA'
    : findings.length ? 'CON_OBSERVACIONES' : 'VALIDADO';
  return { status, findings, summary, totals };
}
