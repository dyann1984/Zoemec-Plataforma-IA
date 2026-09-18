/* Explosion de mano de obra (Fase A, punto 2 del pedido). Un solo motor de
   consolidacion (buildLaborExplosion) alimenta las DOS vistas pedidas --
   "Economica" (cuanto cuesta) y "Recursos/jornadas" (cuantos trabajadores y
   jornadas) -- via dos formateadores puros (laborEconomicView/
   laborResourceView) que leen el MISMO resultado, nunca dos calculos
   paralelos que puedan divergir.

   Reusa laborUnitQty (misma formula que calcLaborRow, ver src/lib/apuCalc.js):
   jornadas por unidad de concepto = cuadrilla/rendimiento si hay rendimiento
   declarado, o "cantidad" (jornadas/unidad) en otro caso -- exactamente como
   ya calcula el precio unitario de cada APU individual, solo que aqui se
   multiplica por `cantidadObra` para obtener las jornadas REALES de todo el
   proyecto/presupuesto. */
import { toSafeNonNegativeNumber } from '../lib/apuCalc.js';
import {
  assertSingleTenantScope, groupKeyFor, reconcilePrice, foldDescription, buildExplosionSnapshot
} from './explosionEngine.js';

/* Clasificacion heuristica de "categoria" de oficio -- SOLO para agrupar/
   mostrar en pantalla, nunca sustituye la descripcion real capturada en el
   APU (se muestra siempre junto a `descripcion`, nunca en su lugar). Basada
   en palabras clave explicitas y documentadas (regla del usuario: "si la
   clasificacion actual no es suficientemente confiable, agrega una
   clasificacion explicita y documentada" -- aplicado aqui tambien a mano de
   obra, mismo criterio que a maquinaria en machineryExplosion.js). Un oficio
   que no calce ningun patron cae en 'OTRO', nunca se inventa una categoria. */
const LABOR_CATEGORY_PATTERNS = [
  ['OFICIAL', /\b(oficial|maestro|albanil|carpintero|plomero|electricista|fierrero|herrero|soldador|yesero|pintor|impermeabilizador)\b/],
  ['AYUDANTE', /\b(ayudante|peon)\b/],
  ['OPERADOR', /\b(operador|maquinista|operario de\s?)\b/],
  ['ESPECIALISTA', /\b(especialista|tecnico|ingeniero|topografo|supervisor)\b/]
];
export function laborCategory(descripcion){
  const text = foldDescription(descripcion);
  for(const [category, pattern] of LABOR_CATEGORY_PATTERNS){
    if(pattern.test(text)) return category;
  }
  return 'OTRO';
}

/* Jornadas por unidad de concepto (misma formula que apuCalc.js#laborUnitQty,
   no se reimplementa distinto: si hay rendimiento>0 se deriva de
   cuadrilla/rendimiento, si no se usa "cantidad" tal cual). */
function laborUnitQty(row){
  const cuadrilla = toSafeNonNegativeNumber(row?.cuadrilla);
  const rendimiento = toSafeNonNegativeNumber(row?.rendimiento);
  if(rendimiento > 0) return cuadrilla / rendimiento;
  return toSafeNonNegativeNumber(row?.cantidad);
}

function priceConfidenceOf(row){
  const fromRecord = row?.priceRecord?.confidence;
  if(Number.isFinite(fromRecord)) return fromRecord;
  const fromFuente = row?.fuente?.confidence;
  return Number.isFinite(fromFuente) ? fromFuente : 0;
}

export function buildLaborExplosion(apuDocs){
  const docs = Array.isArray(apuDocs) ? apuDocs.filter(Boolean) : [];
  assertSingleTenantScope(docs);
  const groups = new Map();

  for(const doc of docs){
    const snapshot = doc?.snapshot || {};
    const cantidadObra = toSafeNonNegativeNumber(snapshot.cantidadObra);
    const rows = Array.isArray(snapshot.labor) ? snapshot.labor : [];
    for(const row of rows){
      const key = groupKeyFor(row, 'labor');
      if(!groups.has(key)){
        groups.set(key, {
          key,
          clave: row?.clave ?? null,
          descripcion: row?.descripcion ?? '',
          categoria: laborCategory(row?.descripcion),
          unidad: row?.unidad ?? 'jor',
          origenes: []
        });
      }
      const jornadasUnitarias = laborUnitQty(row);
      const jornadasAportadas = jornadasUnitarias * cantidadObra;
      const horasPorJornada = toSafeNonNegativeNumber(row?.jornada) || 8;
      const costoPorJornada = toSafeNonNegativeNumber(row?.salarioBase) * (toSafeNonNegativeNumber(row?.fsr) || 1);
      groups.get(key).origenes.push({
        apuId: doc.id,
        apuClave: snapshot.clave ?? null,
        apuConcept: snapshot.concept ?? '',
        cuadrilla: row?.cuadrilla ?? null,
        rendimiento: row?.rendimiento ?? null,
        jornadaHoras: horasPorJornada,
        jornadasAportadas,
        horasAportadas: jornadasAportadas * horasPorJornada,
        costoPorJornada,
        priceConfidence: priceConfidenceOf(row),
        importeAportadoReal: jornadasAportadas * costoPorJornada,
        fuente: row?.fuente || null
      });
    }
  }

  return [...groups.values()].map(group => {
    const totalJornadas = group.origenes.reduce((s, o) => s + o.jornadasAportadas, 0);
    const totalHoras = group.origenes.reduce((s, o) => s + o.horasAportadas, 0);
    const candidatosCosto = group.origenes
      .filter(o => o.jornadasAportadas > 0)
      .map(o => ({ precioUnitario: o.costoPorJornada, confidence: o.priceConfidence }));
    const reconciliation = reconcilePrice(candidatosCosto);
    const origenesConImporteConsolidado = group.origenes.map(o => ({
      ...o,
      importeConsolidado: o.jornadasAportadas * reconciliation.precioUnitario
    }));
    const importe = origenesConImporteConsolidado.reduce((s, o) => s + o.importeConsolidado, 0);
    const cuadrillasDistintas = [...new Set(group.origenes.map(o => o.cuadrilla).filter(v => v != null))];
    return {
      clave: group.clave,
      descripcion: group.descripcion,
      categoria: group.categoria,
      unidad: group.unidad,
      cuadrillas: cuadrillasDistintas,
      totalJornadas,
      totalHoras,
      costoPorJornada: reconciliation.precioUnitario,
      importe,
      reconciliationRule: reconciliation.rule,
      reconciliationEmpatados: reconciliation.empatados,
      confianza: reconciliation.confidence,
      apusOrigen: [...new Set(group.origenes.map(o => o.apuId))],
      origenes: origenesConImporteConsolidado
    };
  }).sort((a, b) => b.importe - a.importe);
}

/* Vista "Economica" (punto 2 del pedido): oficio, categoria, costo unitario,
   cantidad/jornadas, importe. Formateador puro sobre el MISMO resultado de
   buildLaborExplosion -- no recalcula nada. */
export function laborEconomicView(rows){
  return (rows || []).map(r => ({
    oficio: r.descripcion,
    categoria: r.categoria,
    costoUnitarioPorJornada: r.costoPorJornada,
    jornadas: r.totalJornadas,
    importe: r.importe,
    reconciliationRule: r.reconciliationRule,
    confianza: r.confianza
  }));
}

/* Vista "Recursos" (punto 2 del pedido): oficio, cuadrilla, horas, jornadas,
   trabajadores equivalentes, conceptos de origen. `projectWorkingDays`
   (opcional, jornadas habiles reales del proyecto/programa de obra) es el
   UNICO dato que permite calcular "trabajadores equivalentes" de forma
   honesta (jornadas totales entre jornadas disponibles). Sin ese dato real
   NUNCA se inventa un numero -- trabajadoresEquivalentes queda null con el
   motivo explicito, siguiendo el mismo principio que el resto del dominio
   (ej. riesgosNoContemplados=null en apuSchema.js: "no calculado" y "cero"
   son estados distintos, nunca se confunden). */
export function laborResourceView(rows, { projectWorkingDays = null } = {}){
  const hasDuration = Number.isFinite(projectWorkingDays) && projectWorkingDays > 0;
  return (rows || []).map(r => ({
    oficio: r.descripcion,
    categoria: r.categoria,
    cuadrilla: r.cuadrillas.length === 1 ? r.cuadrillas[0] : r.cuadrillas,
    horas: r.totalHoras,
    jornadas: r.totalJornadas,
    trabajadoresEquivalentes: hasDuration ? r.totalJornadas / projectWorkingDays : null,
    trabajadoresEquivalentesNota: hasDuration ? null : 'Requiere la duracion (jornadas habiles) del proyecto para calcularse -- no se estima sin ese dato real.',
    conceptosOrigen: r.origenes.map(o => ({ apuId: o.apuId, apuClave: o.apuClave, apuConcept: o.apuConcept, jornadas: o.jornadasAportadas }))
  }));
}

export function summarizeLaborExplosion(rows){
  return {
    totalOficios: rows.length,
    totalJornadas: rows.reduce((s, r) => s + r.totalJornadas, 0),
    importeTotal: rows.reduce((s, r) => s + r.importe, 0),
    conCostoDivergente: rows.filter(r => r.reconciliationRule !== 'UNICO').length
  };
}

export async function buildLaborExplosionSnapshot({ apuDocs, projectId, organizationId }){
  const docs = Array.isArray(apuDocs) ? apuDocs.filter(Boolean) : [];
  const labor = buildLaborExplosion(docs);
  return buildExplosionSnapshot({
    projectId, organizationId,
    sourceApuIds: docs.map(d => d.id),
    totals: { labor: summarizeLaborExplosion(labor) },
    rows: { labor }
  });
}
