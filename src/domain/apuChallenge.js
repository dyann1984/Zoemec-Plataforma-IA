/* ZOEMEC CHALLENGE (Fase 1): segundo mecanismo de revision, distinto del
   Auditor (apuAuditor.js). El Auditor detecta omisiones/inconsistencias
   objetivas; Challenge intenta ACTIVAMENTE demostrar que un renglon ya
   presente puede estar mal -- cuestiona rendimiento y precio, nunca
   cantidad/omision (eso ya lo cubre el Auditor, no se duplica).

   Decision de diseño central (ver Fase 0): la unica base de comparacion real
   para "rendimiento historico" son 2 disciplinas calibradas contra un Excel
   real de biblioteca (concreto, acero -- ver LIBRARY_CALIBRATED_TIPOS en
   crewModel.js). El resto de las disciplinas solo tiene la plantilla tecnica
   ZOEMEC (SYSTEM_RESOURCES[tipo] en constructionSystems.js), NO un historico
   de campo. Este modulo etiqueta esa diferencia de forma honesta (regla 24
   del prompt maestro: nunca presentar una plantilla como si fuera un
   historico real) en vez de fabricar una fuente de datos que no existe. */
import { calcAPUv2, calcMaterialRow, calcLaborRow, calcEquipmentRow, calcConsumableRow } from '../lib/apuCalc.js';
import { SYSTEM_RESOURCES } from './constructionSystems.js';
import { deriveCrewFromLaborRows, LIBRARY_CALIBRATED_TIPOS } from './crewModel.js';

// Umbral de desviacion de rendimiento que dispara un challenge (documentado,
// no magico): 15% -- por debajo de este orden de magnitud una diferencia es
// ruido de captura normal, no una senal de riesgo economico real. Ajustable
// aqui, en un solo lugar, si la experiencia de uso indica otro valor.
const YIELD_DEVIATION_THRESHOLD_PCT = 15;

const fold = value => String(value ?? '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/* Emparejamiento renglon actual <-> renglon de plantilla: por indice
   posicional (la generacion original preserva el orden de SYSTEM_RESOURCES),
   VERIFICADO por descripcion normalizada antes de confiar en el. Si un APU
   fue editado (renglones agregados/quitados/reordenados) y el indice ya no
   corresponde a la misma descripcion, el renglon se omite del challenge en
   vez de compararlo contra una plantilla que no le corresponde -- nunca se
   fabrica una comparacion. */
function matchTemplateLaborRow(apuLaborRows, templateLaborRows, index){
  const apuRow = apuLaborRows[index];
  const templateRow = templateLaborRows[index];
  if(!apuRow || !templateRow) return null;
  if(fold(apuRow.descripcion) !== fold(templateRow[0])) return null;
  return templateRow;
}

function describeBaselineSource(tipo){
  return LIBRARY_CALIBRATED_TIPOS.has(tipo)
    ? 'Historico calibrado (Biblioteca ZOEMEC, matriz real)'
    : 'Plantilla tecnica ZOEMEC (no calibrada contra historico real -- unica base disponible hoy)';
}

/* Impacto economico de reemplazar UN renglon de labor por su baseline:
   clona el APU, sustituye cuadrilla/rendimiento de ese renglon (nunca
   descripcion/salarioBase/fsr -- el challenge de rendimiento no cuestiona el
   salario), recalcula con calcAPUv2 (el mismo motor determinista que usa
   toda la plataforma, nunca un calculo aproximado aparte) y compara contra
   el original. */
function computeYieldImpact(apu, laborIndex, baselineCuadrilla, baselineRendimiento){
  const original = calcAPUv2(apu);
  const withBaseline = structuredClone(apu);
  withBaseline.labor[laborIndex] = { ...withBaseline.labor[laborIndex], cuadrilla: baselineCuadrilla, rendimiento: baselineRendimiento };
  const recalculated = calcAPUv2(withBaseline);
  return {
    unitImpact: recalculated.pu - original.pu,
    projectImpact: recalculated.importeTotal - original.importeTotal
  };
}

/* Integracion con Memoria Tecnica (Fase 4, ver technicalMemory.js): este
   modulo NUNCA importa technicalMemory.js -- el llamador resuelve la
   memoria y pasa un baseline ya normalizado por descripcion (fold) via
   options.memoryBaselines. Cuando existe, sustituye a la plantilla generica
   de SYSTEM_RESOURCES: un rendimiento aprobado por el PROYECTO es mas
   especifico/confiable que la plantilla tecnica ZOEMEC (misma jerarquia que
   ya usa Memoria: PROJECT > ORGANIZATION > USER > GLOBAL) -- pero el
   calculo de impacto sigue siendo exactamente el mismo (computeYieldImpact),
   Memoria solo aporta EL NUMERO del baseline, nunca la logica de deteccion
   ni el calculo economico (no duplica Challenge). */
function yieldChallenges(apu, options = {}){
  const tipo = apu.primaryActivity;
  const templateResources = tipo ? SYSTEM_RESOURCES[tipo] : null;
  const hasTemplate = templateResources && Array.isArray(templateResources.labor) && templateResources.labor.length;
  const laborRows = Array.isArray(apu.labor) ? apu.labor : [];
  const templateDerived = hasTemplate ? deriveCrewFromLaborRows(templateResources.labor, tipo) : null;
  const findings = [];
  laborRows.forEach((row, index) => {
    const memoryBaseline = options.memoryBaselines?.[fold(row.descripcion)];
    let baseline, baselineSourceLabel;
    if(memoryBaseline && memoryBaseline.rendimiento > 0){
      baseline = { cuadrilla: memoryBaseline.cuadrilla ?? row.cuadrilla ?? 1, rendimiento: memoryBaseline.rendimiento };
      baselineSourceLabel = memoryBaseline.sourceLabel || 'Memoria tecnica aprobada';
    }else if(hasTemplate){
      const templateRow = matchTemplateLaborRow(laborRows, templateResources.labor, index);
      if(!templateRow) return;
      baseline = templateDerived[index];
      baselineSourceLabel = describeBaselineSource(tipo);
    }else{
      // Sin clasificacion conocida, sin plantilla propia y sin memoria: no
      // hay ninguna base independiente contra la cual comparar -- se omite
      // en silencio, nunca se inventa un rendimiento de referencia.
      return;
    }
    const currentRendimiento = Number(row.rendimiento) || 0;
    if(!(currentRendimiento > 0) || !(baseline.rendimiento > 0)) return;
    const deltaPct = ((currentRendimiento - baseline.rendimiento) / baseline.rendimiento) * 100;
    if(Math.abs(deltaPct) < YIELD_DEVIATION_THRESHOLD_PCT) return;
    const { unitImpact, projectImpact } = computeYieldImpact(apu, index, baseline.cuadrilla, baseline.rendimiento);
    // cantidadObra<=0 en este esquema significa "no capturada todavia" (ver
    // zero_cantidad_obra en apuProfessional.js), no "cantidad real de cero"
    // -- escalar el impacto de proyecto sobre una cantidad no capturada
    // seria inventar un numero. El impacto por unidad (unitImpact) si es
    // valido siempre: no depende de cuanta obra se vaya a construir.
    const hasCantidad = Number(apu.cantidadObra) > 0;
    findings.push({
      id: `yield:${index}`,
      category: 'rendimiento',
      title: `Rendimiento de "${row.descripcion}" se desvia ${deltaPct.toFixed(1)}% de la referencia`,
      // resourceDescripcion/resourceKind (Fase 5): identificador estructurado
      // del renglon, no solo el titulo humano -- lo necesita la UI (Scenario
      // Lab) para construir un selector exacto sin parsear el titulo con
      // regex (fragil). Aditivo, no cambia ningun campo ni calculo existente.
      resourceDescripcion: row.descripcion, resourceKind: 'labor',
      currentValue: currentRendimiento,
      baselineValue: baseline.rendimiento,
      baselineSource: baselineSourceLabel,
      deltaPct: Number(deltaPct.toFixed(1)),
      unitImpact: Number(unitImpact.toFixed(2)),
      projectImpact: hasCantidad ? Number(projectImpact.toFixed(2)) : null,
      actions: ['MANTENER', 'CORREGIR', 'JUSTIFICAR']
    });
  });
  return findings;
}

/* Challenge de precio: reusa la evidencia de Price Intelligence ya calculada
   por el resto de la plataforma (priceRecord.evidenceLevel / referencias con
   verdict, ver apuProfessional.js#rowEvidenceQuality) -- no crea un sistema
   de confianza de precios paralelo. Un renglon sin ninguna referencia ALTO
   (o sin ninguna referencia) es un precio que el proyecto no puede defender
   si se le cuestiona. */
// Costo real del renglon (por unidad de concepto), un solo lugar por tipo de
// recurso -- el mismo que usa calcAPUv2/apuProfessional.js#sourceRows, nunca
// un "precio x cantidad" hecho a mano que ignore consumo/desperdicio/integracion.
const ROW_COST_FN = { materials: calcMaterialRow, labor: calcLaborRow, equipment: calcEquipmentRow, consumables: calcConsumableRow };

function priceChallenges(apu){
  const ctx = { cantidadContractual: Number(apu.cantidadObra) || 0 };
  const rows = ['materials', 'labor', 'equipment', 'consumables'].flatMap(kind =>
    (Array.isArray(apu[kind]) ? apu[kind] : []).map((row, index) => ({ kind, row, index })));
  const cantidadObra = Number(apu.cantidadObra);
  const findings = [];
  rows.forEach(({ kind, row, index }) => {
    const estado = row.fuente?.estado;
    if(estado === 'VERIFICADO' || estado === 'IMPORTADO') return; // precio real de catalogo, no cuestionable por este mecanismo
    const references = Array.isArray(row.priceRecord?.references) ? row.priceRecord.references : [];
    const hasHighEvidence = references.some(r => r.match?.verdict === 'ALTO');
    if(hasHighEvidence) return;
    const unitImpact = Math.max(0, Number(ROW_COST_FN[kind]?.(row, ctx)) || 0);
    if(!(unitImpact > 0)) return;
    findings.push({
      id: `price:${kind}:${index}`,
      category: 'precio',
      title: `Precio de "${row.descripcion || row.clave || kind}" sin respaldo suficiente de mercado`,
      resourceDescripcion: row.descripcion, resourceKind: kind,
      currentValue: Number(row.precioUnitario ?? row.salarioBase ?? row.tarifa ?? 0),
      baselineValue: null,
      baselineSource: references.length ? 'Referencias de mercado disponibles, ninguna con verdict ALTO' : 'Sin fuente ni referencia de mercado',
      deltaPct: null,
      unitImpact: Number(unitImpact.toFixed(2)),
      projectImpact: cantidadObra > 0 ? Number((unitImpact * cantidadObra).toFixed(2)) : null,
      actions: ['MANTENER', 'CORREGIR', 'JUSTIFICAR']
    });
  });
  return findings;
}

export function runApuChallenge(apu = {}, options = {}){
  const challenges = [...yieldChallenges(apu, options), ...priceChallenges(apu)];
  return { challenges };
}

/* Fase 6.1: mapeo de severidad por categoria, extraido del ternario que ya
   vivia inline en ZoemecIntelligencePanel.jsx#ChallengeTab -- se reusa aqui
   tambien server-side (api/challenge-decisions.mjs, verificacion de
   snapshot) para no tener la misma regla de negocio duplicada en dos
   lugares. No es un cambio de la logica de Challenge en si, solo su unico
   punto de origen. */
export function challengeSeverity(category){
  return category === 'rendimiento' ? 'HIGH' : 'MEDIUM';
}
