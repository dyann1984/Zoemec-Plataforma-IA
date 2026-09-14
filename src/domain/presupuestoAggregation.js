/* Agregacion PURA del Presupuesto (Fase D). Suma renglones de concepto ya
   resueltos (cada uno con el `direct`/`pu`/`iva` que YA calculo
   calcAPU/calcAPUv2 -- src/lib/apuCalc.js#applyCascade -- para el APU
   asociado a ese concepto) en subtotales por capitulo y en el costo directo
   total del proyecto. Este modulo NUNCA vuelve a aplicar la cascada de
   indirectos/financiamiento/utilidad/cargos/IVA -- esos ya estan
   incorporados en `pu` de cada APU (metodologia RLOPSRM: el precio unitario
   de cada partida ya trae todo eso). "Cantidad x Precio Unitario = Importe"
   es la UNICA formula nueva que calcula esta capa. */
import { PRESUPUESTO_CAPITULOS, normalizeCapitulo } from './presupuestoCapitulos.js';

function toNumber(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }

/* rows: [{conceptoId, clave, capitulo, concept, unit, qty, apuId, apuVersionId,
   pu, direct, iva, confidenceStatus, confidenceScore, bidRiskSeverity,
   origenCantidad, origenPrecio}]. Un renglon sin apuId (concepto aun
   PENDIENTE) participa en la tabla con pu/direct/importe en 0 y
   `hasApu:false` -- nunca se excluye de la vista, solo no aporta importe. */
export function aggregatePresupuesto(rows = []){
  const safeRows = (Array.isArray(rows) ? rows : []).map(r => {
    const qty = toNumber(r?.qty);
    const pu = toNumber(r?.pu);
    const direct = toNumber(r?.direct);
    const iva = toNumber(r?.iva);
    const capitulo = normalizeCapitulo(r?.capitulo);
    return {
      ...r,
      capitulo,
      qty, pu, direct, iva,
      hasApu: Boolean(r?.apuId),
      importe: qty * pu,
      directoImporte: qty * direct
    };
  });

  const byCapitulo = new Map(PRESUPUESTO_CAPITULOS.map(c => [c.key, { capitulo: c.key, label: c.label, direct: 0, importe: 0, conceptCount: 0 }]));
  safeRows.forEach(r => {
    const bucket = byCapitulo.get(r.capitulo) || byCapitulo.get('OTROS');
    bucket.direct += r.directoImporte;
    bucket.importe += r.importe;
    bucket.conceptCount += 1;
  });
  const capituloSubtotals = [...byCapitulo.values()].filter(b => b.conceptCount > 0);

  const costoDirectoTotal = safeRows.reduce((s, r) => s + r.directoImporte, 0);
  const importeTotal = safeRows.reduce((s, r) => s + r.importe, 0);

  return { rows: safeRows, capituloSubtotals, costoDirectoTotal, importeTotal };
}
