/* Deteccion de baseline aprobado para un concepto (Fase 2 del plan integral).
   Modulo puro, sin React ni Firebase.

   PROPOSITO (regla 1 del encargo): responder de forma verificable si un
   `conceptoId` pertenece a un presupuesto (borrador o baseline aprobado),
   leyendo la MISMA fuente que ya produce el servidor -- documento
   `presupuestos/{id}` con { baselineVersion, snapshot: { rows: [...] } }
   -- sin inventar textos ni asumir por UI. Un `baselineVersion` no nulo
   marca al presupuesto como aprobado (regla server-side documentada en
   _route-presupuestos.mjs#handleApproveBaseline).

   FORMA DEL RESULTADO (regla 1 del encargo -- "devolver contexto"):
     { status: 'no-budget' | 'draft' | 'approved',
       presupuestoId, presupuestoNombre, presupuestoVersion,
       baselineVersion, capitulo, cantidadContractual, puContractual,
       apuId, unit, row (renglon completo del snapshot) }

   Cuando un concepto aparece en varios presupuestos, la resolucion prefiere
   siempre APROBADO sobre BORRADOR -- el proposito del lookup es detectar
   proteccion contractual, y basta con que UNO de los presupuestos activos
   ya sea baseline para que el cambio necesite Orden de Cambio. Devuelve
   ademas `otherAppearances` (los otros presupuestos donde aparece), para
   que la UI pueda mostrar el detalle si el usuario lo pide sin volver a
   llamar la funcion. */

export const BASELINE_STATUS = Object.freeze({
  NO_BUDGET: 'no-budget',
  DRAFT: 'draft',
  APPROVED: 'approved'
});

function toNumber(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function findConceptRow(presupuesto, conceptoId){
  const rows = presupuesto?.snapshot?.rows || [];
  return rows.find(r => String(r?.conceptoId) === String(conceptoId)) || null;
}

function summarizeAppearance(presupuesto, row){
  const isApproved = !!presupuesto?.baselineVersion;
  return {
    presupuestoId: presupuesto?.id || null,
    presupuestoNombre: presupuesto?.name || presupuesto?.snapshot?.name || presupuesto?.id || null,
    presupuestoVersion: presupuesto?.currentVersion || null,
    baselineVersion: presupuesto?.baselineVersion || null,
    isApproved,
    capitulo: row?.capitulo || null,
    cantidadContractual: toNumber(row?.qty),
    puContractual: toNumber(row?.pu),
    apuId: row?.apuId || null,
    apuVersionId: row?.apuVersionId || null,
    unit: row?.unit || null,
    row
  };
}

/* Resuelve el estado baseline de un `conceptoId` sobre un arreglo de
   presupuestos ya cargados desde /api/presupuestos?projectId=... (nunca hace
   red por su cuenta -- la red vive en presupuestoCloud.js/budgetBaselineService.js).
   El caller filtra por proyecto ANTES de llamar. */
export function isConceptInApprovedBudget(presupuestos, conceptoId){
  if(!conceptoId){
    return { status: BASELINE_STATUS.NO_BUDGET, presupuestoId: null, otherAppearances: [] };
  }
  const list = Array.isArray(presupuestos) ? presupuestos : [];
  const appearances = [];
  for(const p of list){
    if(!p || p.archivedAt) continue;
    const row = findConceptRow(p, conceptoId);
    if(!row) continue;
    // Un renglon con qty <= 0 no protege nada: solo esta enlistado por
    // arrastre pero no aporta cantidad contractual real. Se ignora.
    if(toNumber(row?.qty) <= 0) continue;
    appearances.push(summarizeAppearance(p, row));
  }
  if(!appearances.length){
    return { status: BASELINE_STATUS.NO_BUDGET, presupuestoId: null, otherAppearances: [] };
  }
  // Prioridad: APROBADO > BORRADOR. Cuando hay varios aprobados, el mas
  // reciente por currentVersion (V1 < V2 < ...) es el que se reporta como
  // principal -- los otros van en otherAppearances.
  const approved = appearances.filter(a => a.isApproved);
  const drafts = appearances.filter(a => !a.isApproved);
  const primary = approved.length
    ? approved.sort((a, b) => String(b.baselineVersion).localeCompare(String(a.baselineVersion)))[0]
    : drafts[0];
  const status = primary.isApproved ? BASELINE_STATUS.APPROVED : BASELINE_STATUS.DRAFT;
  const others = appearances.filter(a => a !== primary);
  return { status, ...primary, otherAppearances: others };
}

/* Deteccion de cambio de ESPECIFICACION (regla 12 del encargo). Compara la
   unidad del renglon contractual contra la unidad de la cantidad vigente
   en CAD. Si divergen (m2 vs pza, ml vs m3...), es un concepto distinto en
   la practica y NO se debe reutilizar el P.U. contractual -- se marca
   `requiresNewApu: true` y la Orden de Cambio queda como "extraordinaria"
   (regla 11: no inventar precio). No detecta cambios de material (ej. block
   12 vs block 15) porque eso vive en el texto del concepto, no en la
   estructura del renglon -- ese diagnostico queda para la revision humana
   que el brief pide explicitamente. */
export function detectSpecChange({ contractualUnit, currentUnit, contractualApuId, currentApuId }){
  const changed = [];
  if(contractualUnit && currentUnit && String(contractualUnit).toLowerCase() !== String(currentUnit).toLowerCase()){
    changed.push('unidad');
  }
  if(contractualApuId && currentApuId && String(contractualApuId) !== String(currentApuId)){
    changed.push('apu');
  }
  return {
    requiresNewApu: changed.length > 0,
    changedFields: changed,
    reason: changed.length
      ? `Cambio de especificacion detectado (${changed.join(', ')}). El P.U. contractual no aplica: registrar como concepto extraordinario con APU propio.`
      : null
  };
}
