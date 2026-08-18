/* Orquestador cliente de Price Intelligence: toma un APU v2 ya generado por
   IA (precios ESTIMADO_IA, sin evidencia externa) y busca precio real de
   mercado para cada recurso via /api/price-intelligence (busqueda web real,
   ver api/_priceIntelligenceCore.mjs). OpenAI propone la matriz de recursos;
   este modulo es quien decide, con datos reales, que precio queda.

   Regla explicita (ver src/domain/apuSchema.js#PRICE_EVIDENCE_LEVEL): un
   precio nunca se marca VERIFICADO solo por venir de una busqueda web -- eso
   sigue reservado a que un humano confirme la fuente. Si la busqueda encontro
   evidencia real (MERCADO/REFERENCIAL) el renglon pasa a REQUIERE_VALIDACION
   (evidencia real, pendiente de aprobar) en vez de quedarse en ESTIMADO_IA. */
import { apiPost } from '../services/apiClient.js';
import { APU_DATA_STATE } from './apuSchema.js';
import { priceRecordFromMarketIntelligence } from './priceRecordAdapters.js';

const PRICE_FIELD_BY_KIND = { materials: 'precioUnitario', seguridad: 'precioUnitario', labor: 'salarioBase', equipment: 'tarifa' };
const UNIT_BY_KIND = (row, kind) => kind === 'labor' ? 'jornada' : (row?.unidad || '');

function targetKey(kind, descripcion){ return `${kind}::${String(descripcion || '').trim().toLowerCase()}`; }

/* Cola con maximo N busquedas simultaneas, igual patron que mapWithConcurrency
   en main.jsx: evita saturar OpenAI/el navegador cuando un APU trae muchos
   recursos distintos. */
async function runWithConcurrency(items, worker, limit){
  const out = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while(next < items.length){
      const i = next++;
      out[i] = await worker(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return out;
}

/* Enriquece (no muta) un APU v2 con precios de mercado reales. Deduplica
   busquedas por descripcion+tipo de recurso (varios renglones iguales
   comparten una sola consulta real). Nunca lanza: si la busqueda de un
   recurso falla, ese renglon simplemente conserva su precio ESTIMADO_IA
   original y el error queda en el resultado para reportarlo, no oculta. */
export async function enrichAPUWithMarketPrices(apuV2, { location = '', dateBase = '', concurrency = 3, onProgress } = {}){
  const apu = structuredClone(apuV2);
  const kinds = ['materials', 'labor', 'equipment', 'seguridad'];
  const targets = new Map();
  for(const kind of kinds){
    for(const row of apu[kind] || []){
      const key = targetKey(kind, row.descripcion);
      if(!targets.has(key)) targets.set(key, { kind, descripcion: row.descripcion, unit: UNIT_BY_KIND(row, kind) });
    }
  }
  const targetList = [...targets.entries()];
  let done = 0;
  const results = new Map();
  const errors = [];
  await runWithConcurrency(targetList, async ([key, target]) => {
    try{
      const result = await apiPost('/api/price-intelligence', {
        description: target.descripcion, unit: target.unit, kind: target.kind, location, dateBase
      });
      results.set(key, result);
    }catch(error){
      errors.push({ kind: target.kind, descripcion: target.descripcion, message: error?.message || 'No se pudo consultar precio de mercado.' });
    }finally{
      done++;
      onProgress?.(done, targetList.length);
    }
  }, concurrency);

  let found = 0;
  for(const kind of kinds){
    const priceField = PRICE_FIELD_BY_KIND[kind];
    for(const row of apu[kind] || []){
      const key = targetKey(kind, row.descripcion);
      const result = results.get(key);
      if(!result) continue; // busqueda fallo para este recurso: se deja tal cual, error ya esta en errors[]
      const precioEstimadoIA = Number(row[priceField]) || 0;
      if(result.nivelEvidencia === 'ESTIMADO_IA' || !(result.precioRecomendado > 0)){
        // Se intento la busqueda real y no hubo evidencia: se conserva el
        // precio de la IA, pero se deja constancia auditable del intento.
        row.priceRecord = priceRecordFromMarketIntelligence({
          description: row.descripcion, unit: row.unidad, price: precioEstimadoIA,
          references: [], stats: null, evidenceLevel: 'ESTIMADO_IA'
        });
        continue;
      }
      found++;
      row[`${priceField}EstimadoIA`] = precioEstimadoIA; // conserva el numero original de la IA para comparar
      row[priceField] = result.precioRecomendado;
      row.priceRecord = priceRecordFromMarketIntelligence({
        description: row.descripcion, unit: row.unidad, price: result.precioRecomendado,
        references: result.referencias, stats: result.estadisticas, evidenceLevel: result.nivelEvidencia
      });
      row.fuente = { ...(row.fuente || {}), estado: APU_DATA_STATE.REQUIERE_VALIDACION };
    }
  }

  return { apu, searched: targetList.length, found, errors };
}
