/* Explosion de maquinaria/equipo/herramienta menor (Fase A, punto 3 del
   pedido). Separa SIEMPRE 3 categorias (nunca mezcla herramienta menor
   dentro de maquinaria, ya estan modeladas por separado en el esquema del
   APU -- ver apuSchema.js#makeEmptyAPUv2):
     - equipment[] con integracion AMORTIZABLE o POR_JORNADA  -> MAQUINARIA
       (equipo propio amortizado o rentado por jornada: tipicamente equipo
       pesado -- retroexcavadora, grua, compactadora -- cuyo costo se prorratea
       por vida util o por dia de renta, nunca por una unidad de obra
       aislada).
     - equipment[] con integracion POR_UNIDAD_OBRA o POR_LOTE -> EQUIPO
       (equipo de apoyo cuyo costo escala directo con cada unidad de obra, o
       un cargo fijo por lote -- tipicamente andamios, equipo de bombeo
       menor, herramienta electrica de apoyo).
     - apu.herramientaMenor (modo 'detalle' o 'porcentaje')    -> HERRAMIENTA
       MENOR, categoria totalmente aparte, nunca fusionada con equipment[].

   Esta separacion MAQUINARIA/EQUIPO es una heuristica explicita basada
   UNICAMENTE en el campo `integracion` ya capturado en el APU (nunca se
   infiere del texto de la descripcion): se documenta aqui, se expone el
   campo `integracion` de cada origen en el desglose para que el usuario
   pueda verificar/objetar la clasificacion, y clasifyEquipmentRow queda
   exportada para que la UI pueda mostrar exactamente el criterio aplicado
   (regla del usuario: "si la clasificacion actual no es suficientemente
   confiable, agrega una clasificacion explicita y documentada"). */
import { toSafeNonNegativeNumber, calcEquipmentRow, calcLaborRow, calcHerramientaDetalleRow } from '../lib/apuCalc.js';
import {
  assertSingleTenantScope, groupKeyFor, reconcilePrice, buildExplosionSnapshot
} from './explosionEngine.js';

export const MACHINERY_CATEGORY = Object.freeze({
  MAQUINARIA_PESADA: 'MAQUINARIA_PESADA',
  EQUIPO: 'EQUIPO'
});

const HEAVY_INTEGRATIONS = new Set(['AMORTIZABLE', 'POR_JORNADA']);

export function classifyEquipmentRow(row){
  const integracion = row?.integracion || 'POR_UNIDAD_OBRA';
  return HEAVY_INTEGRATIONS.has(integracion) ? MACHINERY_CATEGORY.MAQUINARIA_PESADA : MACHINERY_CATEGORY.EQUIPO;
}

function priceConfidenceOf(row){
  const fromRecord = row?.priceRecord?.confidence;
  if(Number.isFinite(fromRecord)) return fromRecord;
  const fromFuente = row?.fuente?.confidence;
  return Number.isFinite(fromFuente) ? fromFuente : 0;
}

/* Agrupa un subconjunto de renglones de equipment[] (ya filtrados por
   categoria) reutilizando calcEquipmentRow TAL CUAL (nunca reimplementa las
   4 formulas por integracion) -- el costo por unidad de concepto que ya
   calcula ese motor se multiplica por cantidadObra para obtener el costo
   real aportado al proyecto (mismo truco que ya usa POR_LOTE internamente:
   dividir entre cantidadContractual y luego multiplicar por esa misma
   cantidad recupera el costo total del lote sin duplicarlo). */
function buildEquipmentGroup(docs, categoryFilter){
  const groups = new Map();
  for(const doc of docs){
    const snapshot = doc?.snapshot || {};
    const cantidadObra = toSafeNonNegativeNumber(snapshot.cantidadObra);
    const ctx = { cantidadContractual: cantidadObra };
    const rows = Array.isArray(snapshot.equipment) ? snapshot.equipment : [];
    for(const row of rows){
      if(classifyEquipmentRow(row) !== categoryFilter) continue;
      const key = groupKeyFor(row, 'equipment');
      if(!groups.has(key)){
        groups.set(key, { key, clave: row?.clave ?? null, descripcion: row?.descripcion ?? '', unidad: row?.unidad ?? '', origenes: [] });
      }
      const costoPorUnidadConcepto = toSafeNonNegativeNumber(calcEquipmentRow(row, ctx));
      const importeAportadoReal = costoPorUnidadConcepto * cantidadObra;
      // "horas" solo se reporta cuando SI representa horas reales (equipo
      // POR_UNIDAD_OBRA con unidad declarada en horas) -- en el resto de
      // integraciones "cantidad" es conteo de equipos/lotes, no horas, y
      // reportarlo como horas seria un dato inventado.
      const esHoras = row?.integracion !== 'AMORTIZABLE' && row?.integracion !== 'POR_JORNADA' && /\b(hr|hora|horas)\b/i.test(String(row?.unidad || ''));
      const horasAportadas = esHoras ? toSafeNonNegativeNumber(row?.cantidad) * cantidadObra : null;
      groups.get(key).origenes.push({
        apuId: doc.id, apuClave: snapshot.clave ?? null, apuConcept: snapshot.concept ?? '',
        integracion: row?.integracion || 'POR_UNIDAD_OBRA',
        cantidadDeclarada: row?.cantidad ?? null,
        tarifa: toSafeNonNegativeNumber(row?.tarifa),
        rendimientoDiario: row?.rendimientoDiario ?? null,
        vidaUtilDias: row?.vidaUtilDias ?? null,
        horasAportadas,
        priceConfidence: priceConfidenceOf(row),
        importeAportadoReal,
        fuente: row?.fuente || null
      });
    }
  }
  return finalizeGroups(groups);
}

function finalizeGroups(groups){
  return [...groups.values()].map(group => {
    const importeReal = group.origenes.reduce((s, o) => s + o.importeAportadoReal, 0);
    const totalHoras = group.origenes.some(o => o.horasAportadas != null)
      ? group.origenes.reduce((s, o) => s + (o.horasAportadas || 0), 0)
      : null;
    const candidatosTarifa = group.origenes.filter(o => o.tarifa > 0).map(o => ({ precioUnitario: o.tarifa, confidence: o.priceConfidence }));
    const reconciliation = reconcilePrice(candidatosTarifa);
    return {
      clave: group.clave,
      descripcion: group.descripcion,
      unidad: group.unidad,
      horas: totalHoras,
      tarifaReferencia: reconciliation.precioUnitario,
      importe: importeReal,
      reconciliationRule: reconciliation.rule,
      reconciliationEmpatados: reconciliation.empatados,
      confianza: reconciliation.confidence,
      apusOrigen: [...new Set(group.origenes.map(o => o.apuId))],
      origenes: group.origenes
    };
  }).sort((a, b) => b.importe - a.importe);
}

/* Herramienta menor: modo 'detalle' se agrupa igual que un recurso normal
   (reusando calcHerramientaDetalleRow); modo 'porcentaje' no tiene renglones
   individuales que consolidar por clave -- cada APU en ese modo aporta UNA
   sola linea "Herramienta menor (% de mano de obra)" (el costo directo de
   mano de obra de ESE apu x su propio porcentaje), y todas esas lineas se
   consolidan entre si (mismo texto, misma "clave" sintetica) para que un
   presupuesto con 20 APUs en modo porcentaje siga mostrando UN solo renglon
   consolidado, no 20. */
const PORCENTAJE_SYNTHETIC_KEY = 'desc:herramienta menor (% de mano de obra)|unidad:global';

function buildHandToolGroup(docs){
  const groups = new Map();
  for(const doc of docs){
    const snapshot = doc?.snapshot || {};
    const cantidadObra = toSafeNonNegativeNumber(snapshot.cantidadObra);
    const hm = snapshot.herramientaMenor || { modo: 'porcentaje', porcentaje: 0, detalle: [] };
    if(hm.modo === 'detalle'){
      for(const row of (Array.isArray(hm.detalle) ? hm.detalle : [])){
        const key = groupKeyFor(row, 'herramientaMenor');
        if(!groups.has(key)){
          groups.set(key, { key, clave: row?.clave ?? null, descripcion: row?.descripcion ?? '', unidad: row?.unidad ?? '', origenes: [] });
        }
        const costoPorUnidadConcepto = toSafeNonNegativeNumber(calcHerramientaDetalleRow(row));
        groups.get(key).origenes.push({
          apuId: doc.id, apuClave: snapshot.clave ?? null, apuConcept: snapshot.concept ?? '',
          modo: 'detalle', cantidadDeclarada: row?.cantidad ?? null,
          priceConfidence: priceConfidenceOf(row),
          importeAportadoReal: costoPorUnidadConcepto * cantidadObra,
          fuente: row?.fuente || null
        });
      }
    } else {
      const moPerUnit = (Array.isArray(snapshot.labor) ? snapshot.labor : []).reduce((s, r) => s + toSafeNonNegativeNumber(calcLaborRow(r)), 0);
      const porcentaje = toSafeNonNegativeNumber(hm.porcentaje);
      if(!groups.has(PORCENTAJE_SYNTHETIC_KEY)){
        groups.set(PORCENTAJE_SYNTHETIC_KEY, { key: PORCENTAJE_SYNTHETIC_KEY, clave: null, descripcion: 'Herramienta menor (% de mano de obra)', unidad: 'global', origenes: [] });
      }
      groups.get(PORCENTAJE_SYNTHETIC_KEY).origenes.push({
        apuId: doc.id, apuClave: snapshot.clave ?? null, apuConcept: snapshot.concept ?? '',
        modo: 'porcentaje', porcentajeAplicado: porcentaje,
        priceConfidence: 0,
        importeAportadoReal: moPerUnit * porcentaje / 100 * cantidadObra,
        fuente: null
      });
    }
  }
  return [...groups.values()].map(group => ({
    clave: group.clave,
    descripcion: group.descripcion,
    unidad: group.unidad,
    importe: group.origenes.reduce((s, o) => s + o.importeAportadoReal, 0),
    apusOrigen: [...new Set(group.origenes.map(o => o.apuId))],
    origenes: group.origenes
  })).sort((a, b) => b.importe - a.importe);
}

export function buildMachineryExplosion(apuDocs){
  const docs = Array.isArray(apuDocs) ? apuDocs.filter(Boolean) : [];
  assertSingleTenantScope(docs);
  return {
    maquinaria: buildEquipmentGroup(docs, MACHINERY_CATEGORY.MAQUINARIA_PESADA),
    equipo: buildEquipmentGroup(docs, MACHINERY_CATEGORY.EQUIPO),
    herramientaMenor: buildHandToolGroup(docs)
  };
}

export function summarizeMachineryExplosion({ maquinaria, equipo, herramientaMenor }){
  const importeTotal = [...maquinaria, ...equipo, ...herramientaMenor].reduce((s, r) => s + r.importe, 0);
  return { totalMaquinaria: maquinaria.length, totalEquipo: equipo.length, totalHerramientaMenor: herramientaMenor.length, importeTotal };
}

export async function buildMachineryExplosionSnapshot({ apuDocs, projectId, organizationId }){
  const docs = Array.isArray(apuDocs) ? apuDocs.filter(Boolean) : [];
  const machinery = buildMachineryExplosion(docs);
  return buildExplosionSnapshot({
    projectId, organizationId,
    sourceApuIds: docs.map(d => d.id),
    totals: { machinery: summarizeMachineryExplosion(machinery) },
    rows: { machinery }
  });
}
