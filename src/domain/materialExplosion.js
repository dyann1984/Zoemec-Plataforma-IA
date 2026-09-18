/* Explosion de materiales (Fase A, punto 1 del pedido) + Explosion de
   Auxiliares/consumibles (categoria E de apuSchema.js -- "Consumibles y
   auxiliares": discos de corte, combustible, electrodos... misma forma de
   renglon que materials, misma formula de costo -- calcConsumableRow es un
   alias literal de calcMaterialRow, ver src/lib/apuCalc.js). Un solo motor
   parametrizado por `kind` para no duplicar la logica de agrupacion/
   reconciliacion entre las dos pestañas "Materiales" y "Auxiliares".

   Consolida el MISMO material a traves de uno o varios APU (o de un
   proyecto/presupuesto completo, que es simplemente "todos los APU de ese
   proyecto" -- ver loadProjectApus en apuProjectDossierData.js, unica fuente
   de verdad server-side ya usada por el Dossier de Proyecto). Nunca aplica
   el desperdicio mas de una vez (se aplica UNA sola vez por renglon de
   origen, igual que calcMaterialRow) y nunca fusiona materiales con
   unidades incompatibles (ver explosionEngine.js#groupKeyFor). */
import { toSafeNonNegativeNumber } from '../lib/apuCalc.js';
import {
  assertSingleTenantScope, groupKeyFor, reconcilePrice, round2, buildExplosionSnapshot
} from './explosionEngine.js';

const POR_LOTE = 'POR_LOTE';

/* Aporte de UN renglon de material/auxiliar de UN APU a la Explosion:
   - caso normal (integracion !== POR_LOTE): el renglon esta expresado POR
     UNIDAD del concepto (consumo), asi que su cantidad real en el proyecto
     escala con `cantidadObra` (cantidad contratada de ese concepto) -- misma
     formula del punto 1 del pedido: "cantidad material por unidad x volumen
     de obra". El desperdicio se aplica UNA sola vez, exactamente igual que
     calcMaterialRow (nunca se vuelve a aplicar al sumar entre APUs).
   - caso POR_LOTE (ej. "material de proteccion temporal comprado una sola
     vez para toda la obra", ver calcMaterialRow en apuCalc.js): la cantidad
     YA es la cantidad total del lote, NO escala con cantidadObra (escalarla
     de nuevo duplicaria el lote tantas veces como unidades de obra tenga el
     concepto -- ver comentario de calcMaterialRow: el importe se reparte
     ENTRE cantidadObra para el precio unitario del concepto, asi que
     multiplicar de vuelta por cantidadObra solo recupera el costo total del
     lote, nunca lo escala). */
function computeContribution(snapshot, row){
  const consumo = toSafeNonNegativeNumber(row?.consumo);
  const desperdicioPct = toSafeNonNegativeNumber(row?.desperdicioPct);
  const precioUnitario = toSafeNonNegativeNumber(row?.precioUnitario);
  const cantidadObra = toSafeNonNegativeNumber(snapshot?.cantidadObra);
  const esPorLote = row?.integracion === POR_LOTE;
  const factor = esPorLote ? 1 : cantidadObra;
  const cantidadBaseAportada = consumo * factor;
  const cantidadFinalAportada = consumo * (1 + desperdicioPct / 100) * factor;
  const importeAportadoReal = cantidadFinalAportada * precioUnitario; // al precio REAL de este origen (nunca al consolidado)
  return { cantidadBaseAportada, cantidadFinalAportada, importeAportadoReal };
}

function priceConfidenceOf(row){
  const fromRecord = row?.priceRecord?.confidence;
  if(Number.isFinite(fromRecord)) return fromRecord;
  const fromFuente = row?.fuente?.confidence;
  return Number.isFinite(fromFuente) ? fromFuente : 0;
}

function buildResourceExplosion(apuDocs, kind){
  const docs = Array.isArray(apuDocs) ? apuDocs.filter(Boolean) : [];
  assertSingleTenantScope(docs);
  const groups = new Map();

  for(const doc of docs){
    const snapshot = doc?.snapshot || {};
    const rows = Array.isArray(snapshot[kind]) ? snapshot[kind] : [];
    for(const row of rows){
      const key = groupKeyFor(row, kind);
      if(!groups.has(key)){
        groups.set(key, {
          key,
          clave: row?.clave ?? null,
          descripcion: row?.descripcion ?? '',
          unidad: row?.unidad ?? '',
          origenes: []
        });
      }
      const contribution = computeContribution(snapshot, row);
      groups.get(key).origenes.push({
        apuId: doc.id,
        apuClave: snapshot.clave ?? null,
        apuConcept: snapshot.concept ?? '',
        rowClave: row?.clave ?? null,
        cantidadBaseAportada: contribution.cantidadBaseAportada,
        cantidadFinalAportada: contribution.cantidadFinalAportada,
        precioUnitario: toSafeNonNegativeNumber(row?.precioUnitario),
        priceConfidence: priceConfidenceOf(row),
        importeAportadoReal: contribution.importeAportadoReal,
        fuente: row?.fuente || null,
        integracion: row?.integracion || null,
        origen: row?.origen || null
      });
    }
  }

  return [...groups.values()].map(group => {
    const cantidadBase = group.origenes.reduce((s, o) => s + o.cantidadBaseAportada, 0);
    const cantidadFinal = group.origenes.reduce((s, o) => s + o.cantidadFinalAportada, 0);
    const candidatosPrecio = group.origenes
      .filter(o => o.cantidadFinalAportada > 0)
      .map(o => ({ precioUnitario: o.precioUnitario, confidence: o.priceConfidence }));
    const reconciliation = reconcilePrice(candidatosPrecio);
    // Cada renglon del desglose usa el precio CONSOLIDADO (una sola compra
    // real para todo el presupuesto) aplicado a la cantidad que SI aporto
    // ese origen -- garantiza que sum(desglose.importe) === importe total
    // del grupo de forma exacta y trazable (regla explicita del usuario),
    // sin perder el precio/confianza REAL de cada origen (import(eAportadoReal)
    // se conserva aparte para auditoria, "conserva precio de cada origen").
    const origenesConImporteConsolidado = group.origenes.map(o => ({
      ...o,
      importeConsolidado: o.cantidadFinalAportada * reconciliation.precioUnitario
    }));
    const importe = origenesConImporteConsolidado.reduce((s, o) => s + o.importeConsolidado, 0);
    const fuentesDistintas = [...new Map(
      group.origenes.filter(o => o.fuente).map(o => [`${o.fuente.estado || ''}|${o.fuente.proveedor || ''}`, { estado: o.fuente.estado || null, proveedor: o.fuente.proveedor || null }])
    ).values()];
    const regionesDistintas = [...new Set(group.origenes.map(o => o.fuente?.region).filter(Boolean))];
    return {
      clave: group.clave,
      descripcion: group.descripcion,
      unidad: group.unidad,
      cantidadBase,
      desperdicioPct: cantidadBase > 0 ? round2((cantidadFinal / cantidadBase - 1) * 100) : 0,
      cantidadFinal,
      precioUnitario: reconciliation.precioUnitario,
      importe,
      reconciliationRule: reconciliation.rule,
      reconciliationEmpatados: reconciliation.empatados,
      confianza: reconciliation.confidence,
      fuentes: fuentesDistintas,
      regiones: regionesDistintas,
      apusOrigen: [...new Set(group.origenes.map(o => o.apuId))],
      origenes: origenesConImporteConsolidado
    };
  }).sort((a, b) => b.importe - a.importe);
}

/* API publica: Explosion de Materiales (tab "Materiales"). */
export function buildMaterialExplosion(apuDocs){
  return buildResourceExplosion(apuDocs, 'materials');
}

/* API publica: Explosion de Auxiliares (tab "Auxiliares" -- categoria E de
   apuSchema.js, consumibles que no quedan integrados en la obra). */
export function buildAuxiliariesExplosion(apuDocs){
  return buildResourceExplosion(apuDocs, 'consumables');
}

/* Totales de presentacion (encabezado de la pestaña, no reemplaza el
   desglose por renglon). */
export function summarizeMaterialExplosion(rows){
  return {
    totalMateriales: rows.length,
    importeTotal: rows.reduce((s, r) => s + r.importe, 0),
    conPrecioDivergente: rows.filter(r => r.reconciliationRule !== 'UNICO').length
  };
}

/* Empaqueta materiales + auxiliares en el objeto snapshot serializable
   comun (ver explosionEngine.js#buildExplosionSnapshot) -- listo para que
   una subfase futura lo persista en `explosionSnapshots/{id}` sin tocar
   este motor. */
export async function buildMaterialExplosionSnapshot({ apuDocs, projectId, organizationId }){
  const docs = Array.isArray(apuDocs) ? apuDocs.filter(Boolean) : [];
  const materials = buildMaterialExplosion(docs);
  const auxiliares = buildAuxiliariesExplosion(docs);
  return buildExplosionSnapshot({
    projectId, organizationId,
    sourceApuIds: docs.map(d => d.id),
    totals: { materials: summarizeMaterialExplosion(materials), auxiliares: summarizeMaterialExplosion(auxiliares) },
    rows: { materials, auxiliares }
  });
}
