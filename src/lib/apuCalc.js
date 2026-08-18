/* Motor de calculo determinista del APU (Analisis de Precio Unitario) y su
   configuracion de porcentajes por defecto.

   Modulo puro: sin React, sin DOM, sin acceso a red. Se importa tanto desde
   el cliente (src/main.jsx) como desde las funciones serverless
   (api/_openaiApuCore.mjs, server/openai-apu-server.mjs) para que formulario
   en blanco, plantilla local, importacion de Excel e IA compartan siempre
   los mismos valores por defecto y exactamente la misma formula. Antes
   existian 3 conjuntos de porcentajes por defecto distintos segun el origen
   del APU (ver auditoria: APU_STANDARD_FACTORS vs los literales de
   normalizeAIAPU vs los de makeEmptyAPU en src/main.jsx, y un cuarto set mas
   en api/_openaiApuCore.mjs), lo que hacia que dos APUs "estandar" del mismo
   tipo de concepto terminaran con indirectos/utilidad distintos solo por la
   ruta de generacion.

   La formula en si (calcAPU) NO cambia respecto a la version anterior en
   src/main.jsx: costo directo -> indirectos -> financiamiento -> utilidad ->
   cargos, en cascada, cada uno sobre el acumulado anterior. Lo unico que se
   agrega aqui es saneamiento de numeros de entrada (ver toSafeNonNegativeNumber)
   para que un valor negativo, NaN o Infinity en un renglon no se propague
   silenciosamente al total. */

export const APU_DEFAULT_FACTORS = Object.freeze({
  herramienta: 3,
  indCampo: 8,
  indOficina: 7,
  finance: 2,
  utility: 10,
  cargos: 0.5,
  iva: 16
});

export const DEFAULT_IVA_RATE = APU_DEFAULT_FACTORS.iva;

/* Convierte cualquier valor a un numero finito >= 0, o 0 si no se puede.
   Equivalente a `Number(x)||0` para cualquier numero positivo finito valido
   (mismo resultado que antes en todos los casos correctos), pero ademas
   descarta negativos e Infinity en vez de dejarlos pasar:
     - Number(-5)||0        -> -5   (un porcentaje o precio negativo invertia
                                      el signo del total en cascada sin aviso)
     - Number(Infinity)||0  -> Infinity (se mostraba como "$∞" o "NaN" en la
                                          UI/PDF/Excel sin ningun error visible)
     - toSafeNonNegativeNumber(-5)        -> 0
     - toSafeNonNegativeNumber(Infinity)  -> 0
     - toSafeNonNegativeNumber(12.5)      -> 12.5 (igual que antes) */
export function toSafeNonNegativeNumber(value){
  const n = Number(value);
  if(!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/* Importe de un renglon de materiales/mano de obra/equipo. Firma de renglon:
   [descripcion, cantidad, unidad, precioBase, mermaOFsr]. Identica logica a
   la version anterior (cantidad x precio x (1+merma%) para materiales;
   cantidad x salario x FSR para mano de obra; cantidad x costo horario para
   equipo), solo con los numeros saneados. */
export function rowImporte(kind, row){
  const cant = toSafeNonNegativeNumber(row?.[1]);
  const base = toSafeNonNegativeNumber(row?.[3]);
  if(kind === 'materials'){
    const merma = toSafeNonNegativeNumber(row?.[4]);
    return cant * base * (1 + merma / 100);
  }
  if(kind === 'labor'){
    const fsr = toSafeNonNegativeNumber(row?.[4]);
    return cant * base * fsr;
  }
  return cant * base; // equipo: cantidad x costo horario
}

/* Cascada RLOPSRM compartida: a partir de un costo directo ya sumado, aplica
   indirectos (campo+oficina) -> financiamiento -> utilidad -> cargos
   adicionales -> precio unitario (sin IVA) -> IVA informativo, cada rubro
   sobre el acumulado anterior (nunca todos sobre el costo directo). Extraida
   de calcAPU para que el motor v2 (renglones-objeto, ver calcAPUv2 mas abajo)
   use exactamente la misma formula: una sola cascada, dos formas de sumar el
   costo directo segun el esquema de renglones (v1 arrays / v2 objetos). */
export function applyCascade(direct, pcts = {}){
  const safeDirect = toSafeNonNegativeNumber(direct);
  const indPct = toSafeNonNegativeNumber(pcts.indCampo) + toSafeNonNegativeNumber(pcts.indOficina);
  const indirect = safeDirect * indPct / 100;
  const finance = (safeDirect + indirect) * toSafeNonNegativeNumber(pcts.finance) / 100;
  const utility = (safeDirect + indirect + finance) * toSafeNonNegativeNumber(pcts.utility) / 100;
  const cargos = (safeDirect + indirect + finance + utility) * toSafeNonNegativeNumber(pcts.cargos) / 100;
  const pu = safeDirect + indirect + finance + utility + cargos;
  const iva = pu * toSafeNonNegativeNumber(pcts.iva) / 100;
  return { indirect, finance, utility, cargos, pu, iva, total: pu };
}

/* Calculo completo de un APU: materiales, mano de obra, equipo, herramienta
   menor, costo directo, indirectos, financiamiento, utilidad, cargos
   adicionales, precio unitario (sin IVA) e IVA informativo. Metodologia
   RLOPSRM estandar en cascada: cada rubro se calcula sobre el acumulado
   anterior, nunca todos sobre el costo directo. */
export function calcAPU(apu = {}){
  const sumKind = (kind) => (apu[kind] || []).reduce((a, r) => a + rowImporte(kind, r), 0);
  const mat = sumKind('materials');
  const mo = sumKind('labor');
  const equipo = sumKind('equipment');
  const herramienta = mo * toSafeNonNegativeNumber(apu.herramienta) / 100;     // % de mano de obra
  const direct = mat + mo + equipo + herramienta;                             // Costo Directo
  const cascade = applyCascade(direct, apu);
  return { mat, mo, equipo, herramienta, direct, ...cascade };
}

/* ---------- Motor v2: renglones-objeto (ver src/domain/apuSchema.js) ----------
   Mismas formulas de negocio que las funciones de arriba, solo que los
   renglones son objetos con nombre de campo (clave, cuadrilla, rendimiento,
   fuente, etc.) en vez de arrays posicionales. calcAPU (v1) sigue siendo el
   motor que usa la UI/exportacion actuales sin ningun cambio; calcAPUv2 es
   aditivo y todavia no esta conectado a ninguna pantalla. */

/* Semantica de integracion de un recurso al precio unitario (RESOURCE_INTEGRATION
   en src/domain/apuSchema.js, no importado aqui para mantener este modulo sin
   dependencias -- se compara por el string literal). Un renglon sin
   "integracion" NUNCA se interpreta como "ya revisado": calcula con el valor
   por defecto POR_UNIDAD_OBRA (identico al comportamiento historico de este
   motor, asi que los APUs existentes sin este campo no cambian de precio),
   pero queda marcado para revision en findApuNumericIssuesV2 -- ver ahi. */
const POR_UNIDAD_OBRA = 'POR_UNIDAD_OBRA';
const POR_JORNADA = 'POR_JORNADA';
const POR_LOTE = 'POR_LOTE';
const AMORTIZABLE = 'AMORTIZABLE';

/* Material: importe = consumo x (1 + %desperdicio) x precio unitario, igual
   que siempre (POR_UNIDAD_OBRA, el caso normal: el consumo YA esta expresado
   por unidad de concepto). Si el renglon declara integracion:'POR_LOTE'
   (ej. "materiales de proteccion temporal del area" comprados una sola vez
   para toda la obra), el importe se reparte entre ctx.cantidadContractual en
   vez de aplicarse completo a cada unidad. */
export function calcMaterialRow(row = {}, ctx = {}){
  const consumo = toSafeNonNegativeNumber(row?.consumo);
  const desperdicioPct = toSafeNonNegativeNumber(row?.desperdicioPct);
  const precioUnitario = toSafeNonNegativeNumber(row?.precioUnitario);
  const importeBase = consumo * (1 + desperdicioPct / 100) * precioUnitario;
  if(row?.integracion === POR_LOTE){
    const cantidadContractual = toSafeNonNegativeNumber(ctx.cantidadContractual);
    return cantidadContractual > 0 ? importeBase / cantidadContractual : 0;
  }
  return importeBase;
}

/* Cantidad de jornadas por unidad de concepto: si hay cuadrilla+rendimiento
   (formato "hoja de analisis profesional": N trabajadores / rendimiento de la
   cuadrilla por jornada) se deriva cuadrilla/rendimiento; si no, se usa
   "cantidad" (jornadas por unidad) directamente, igual que el renglon v1. */
function laborUnitQty(row = {}){
  const cuadrilla = toSafeNonNegativeNumber(row?.cuadrilla);
  const rendimiento = toSafeNonNegativeNumber(row?.rendimiento);
  if(rendimiento > 0) return cuadrilla / rendimiento;
  return toSafeNonNegativeNumber(row?.cantidad);
}

/* Mano de obra: salario real = salario base x FSR; importe = cantidad
   (derivada de cuadrilla/rendimiento o explicita) x salario real. */
export function calcLaborRow(row = {}){
  const cant = laborUnitQty(row);
  const salarioReal = toSafeNonNegativeNumber(row?.salarioBase) * toSafeNonNegativeNumber(row?.fsr);
  return cant * salarioReal;
}

/* Equipo/maquinaria: la formula depende de integracion (nunca se infiere):
   - POR_UNIDAD_OBRA (por defecto, comportamiento historico): cantidad x tarifa.
     Correcto para equipo cuyo uso realmente escala con cada unidad (ej. una
     herramienta consumible por unidad).
   - POR_JORNADA: costo de uso diario (tarifa, ya multiplicada por "cantidad"
     de equipos identicos si aplica) / rendimiento diario de la cuadrilla que
     lo usa. Ej: renta de andamio $500/dia, cuadrilla rinde 20 m/dia -> $25/m.
   - POR_LOTE: costo fijo (renta o compra puntual) repartido entre la cantidad
     contractual total del concepto (ctx.cantidadContractual), no entre cada
     unidad individualmente.
   - AMORTIZABLE: equipo propiedad del contratista. Se amortiza el precio de
     adquisicion x factor de uso entre su vida util en jornadas y lo que la
     cuadrilla produce por jornada. */
export function calcEquipmentRow(row = {}, ctx = {}){
  const integracion = row?.integracion || POR_UNIDAD_OBRA;
  // "cantidad" solo se asume 1 (un equipo) cuando esta ausente -- un 0
  // explicito significa "cero equipos" y debe seguir dando importe 0.
  const cantidad = row?.cantidad == null ? 1 : toSafeNonNegativeNumber(row.cantidad);
  const tarifa = toSafeNonNegativeNumber(row?.tarifa);
  if(integracion === POR_JORNADA){
    const rendimientoDiario = toSafeNonNegativeNumber(row?.rendimientoDiario);
    return rendimientoDiario > 0 ? (tarifa * cantidad) / rendimientoDiario : 0;
  }
  if(integracion === POR_LOTE){
    const cantidadContractual = toSafeNonNegativeNumber(ctx.cantidadContractual);
    return cantidadContractual > 0 ? (tarifa * cantidad) / cantidadContractual : 0;
  }
  if(integracion === AMORTIZABLE){
    const vidaUtilDias = toSafeNonNegativeNumber(row?.vidaUtilDias);
    const rendimientoDiario = toSafeNonNegativeNumber(row?.rendimientoDiario);
    const factorUso = toSafeNonNegativeNumber(row?.factorUso) || 1;
    if(!(vidaUtilDias > 0) || !(rendimientoDiario > 0)) return 0;
    return (tarifa * cantidad * factorUso) / vidaUtilDias / rendimientoDiario;
  }
  return cantidad * tarifa; // POR_UNIDAD_OBRA
}

/* Herramienta menor por renglon de detalle (modo 'detalle'): importe =
   cantidad x costo (valor/reposicion) x %depreciacion. */
export function calcHerramientaDetalleRow(row = {}){
  const cantidad = toSafeNonNegativeNumber(row?.cantidad);
  const costo = toSafeNonNegativeNumber(row?.costo);
  const pctDepreciacion = toSafeNonNegativeNumber(row?.pctDepreciacion);
  return cantidad * costo * pctDepreciacion / 100;
}

/* Seguridad y EPP: por defecto (POR_UNIDAD_OBRA) importe = cantidad x precio
   unitario -- correcto solo para EPP desechable/consumible por unidad real
   (ej. tapabocas por m2 en un area contaminada). Para EPP REUTILIZABLE
   (casco, botas, lentes, arnes, careta, proteccion auditiva) un trabajador NO
   compra un casco nuevo por cada unidad de obra: el costo se amortiza sobre
   la cuadrilla completa y se reparte entre lo que esa cuadrilla produce por
   jornada (integracion:'AMORTIZABLE'):
     costoAmortizadoCuadrilla = precioUnitario x cantidad(trabajadores/piezas) x factorReposicion
     costoPorJornada          = costoAmortizadoCuadrilla / vidaUtilDias
     costoPorUnidadDeObra     = costoPorJornada / rendimientoDiario
   Formula auditable: cada factor queda visible en el renglon del APU (fuente
   de datos: propuesta explicita de la IA, nunca inferida por el motor). Si
   falta vidaUtilDias o rendimientoDiario el importe amortizado es 0 (no se
   inventa un valor) y el renglon se marca en findApuNumericIssuesV2. */
export function calcSeguridadRow(row = {}, ctx = {}){
  const integracion = row?.integracion || POR_UNIDAD_OBRA;
  const cantidad = row?.cantidad == null ? 1 : toSafeNonNegativeNumber(row.cantidad);
  const precioUnitario = toSafeNonNegativeNumber(row?.precioUnitario);
  if(integracion === AMORTIZABLE){
    const vidaUtilDias = toSafeNonNegativeNumber(row?.vidaUtilDias);
    const rendimientoDiario = toSafeNonNegativeNumber(row?.rendimientoDiario);
    const factorReposicion = toSafeNonNegativeNumber(row?.factorReposicion) || 1;
    if(!(vidaUtilDias > 0) || !(rendimientoDiario > 0)) return 0;
    const costoAmortizadoCuadrilla = precioUnitario * cantidad * factorReposicion;
    const costoPorJornada = costoAmortizadoCuadrilla / vidaUtilDias;
    return costoPorJornada / rendimientoDiario;
  }
  if(integracion === POR_LOTE){
    const cantidadContractual = toSafeNonNegativeNumber(ctx.cantidadContractual);
    return cantidadContractual > 0 ? (precioUnitario * cantidad) / cantidadContractual : 0;
  }
  return cantidad * precioUnitario; // POR_UNIDAD_OBRA
}

/* Calculo completo de un APU en esquema v2: agrega seguridad al costo
   directo (no existia en v1) y soporta herramienta menor por % de mano de
   obra o por detalle de renglones segun apu.herramientaMenor.modo. Cuando hay
   cantidadObra, agrega importeTotal = precio unitario x cantidad de obra. */
export function calcAPUv2(apu = {}){
  // Contexto compartido por renglones POR_LOTE: la cantidad contractual total
  // del concepto (no de cada renglon) es lo que reparte un costo fijo.
  const ctx = { cantidadContractual: toSafeNonNegativeNumber(apu.cantidadObra) };
  const sum = (rows, calcRow) => (Array.isArray(rows) ? rows : []).reduce((a, r) => a + calcRow(r, ctx), 0);
  const mat = sum(apu.materials, calcMaterialRow);
  const mo = sum(apu.labor, calcLaborRow);
  const equipo = sum(apu.equipment, calcEquipmentRow);
  const seguridad = sum(apu.seguridad, calcSeguridadRow);
  const hm = apu.herramientaMenor || {};
  const herramienta = hm.modo === 'detalle'
    ? sum(hm.detalle, calcHerramientaDetalleRow)
    : mo * toSafeNonNegativeNumber(hm.porcentaje) / 100;
  const direct = mat + mo + equipo + herramienta + seguridad;
  const cascade = applyCascade(direct, apu.factores || {});
  const cantidadObra = toSafeNonNegativeNumber(apu.cantidadObra);
  const importeTotal = cantidadObra > 0 ? cascade.pu * cantidadObra : 0;
  return { mat, mo, equipo, herramienta, seguridad, direct, ...cascade, importeTotal };
}

/* Validaciones deterministas de "casos limite" sobre un APU ya calculado:
   no altera ningun numero, solo describe que valores merecen revision
   humana antes de aprobar/exportar. Pura y testeable; no esta conectada
   todavia a ninguna pantalla (conectarla es una decision de UX/producto,
   fuera del alcance de esta fase). */
export function findApuNumericIssues(apu = {}, totals = calcAPU(apu)){
  const issues = [];
  const rows = [...(apu.materials || []).map(r => ['materials', r]), ...(apu.labor || []).map(r => ['labor', r]), ...(apu.equipment || []).map(r => ['equipment', r])];
  rows.forEach(([kind, row], index) => {
    const cant = Number(row?.[1]);
    const base = Number(row?.[3]);
    if(Number.isFinite(cant) && cant < 0) issues.push({ code: 'negative_quantity', kind, index, message: `Cantidad negativa en renglon ${index + 1} de ${kind}: se trata como 0.` });
    if(Number.isFinite(base) && base < 0) issues.push({ code: 'negative_price', kind, index, message: `Precio/costo negativo en renglon ${index + 1} de ${kind}: se trata como 0.` });
    if(!Number.isFinite(cant) || !Number.isFinite(base)) issues.push({ code: 'non_finite_value', kind, index, message: `Valor no numerico (NaN/Infinity) en renglon ${index + 1} de ${kind}: se trata como 0.` });
  });
  ['herramienta', 'indCampo', 'indOficina', 'finance', 'utility', 'cargos', 'iva'].forEach((field) => {
    const value = Number(apu[field]);
    if(Number.isFinite(value) && value < 0) issues.push({ code: 'negative_percentage', field, message: `Porcentaje "${field}" negativo (${value}%): se trata como 0.` });
  });
  if(totals.pu <= 0) issues.push({ code: 'zero_or_negative_price', message: 'El precio unitario resultante es cero o negativo.' });
  return issues;
}

/* Equivalente de findApuNumericIssues para renglones-objeto del esquema v2.
   Solo revisa campos presentes (undefined/null se ignora): a diferencia de
   los arrays v1 -donde cada posicion siempre existe por convencion-, en v2
   cuadrilla/rendimiento y cantidad son alternativos entre si, asi que un
   campo ausente no es un error, es una via valida distinta. */
/* Verifica que un renglon de equipo/seguridad traiga "integracion" explicita
   y, segun cual sea, los campos que esa formula necesita (ver calcEquipmentRow
   / calcSeguridadRow arriba). Nunca corrige el renglon: solo reporta que
   falta, para que quede visible antes de aprobar/exportar el APU (punto de
   validacion "equipo fijo prorrateado correctamente" / "EPP amortizado"). */
function checkResourceIntegration(issues, kind, index, row){
  const integracion = row?.integracion;
  if(!integracion){
    issues.push({ code: 'missing_integration', kind, index, message: `Renglon ${index + 1} de ${kind} no trae "integracion" explicita: se calculo como POR_UNIDAD_OBRA por defecto, revisar si corresponde.` });
    return;
  }
  if(integracion === 'POR_JORNADA' || integracion === 'AMORTIZABLE'){
    if(!(Number(row?.rendimientoDiario) > 0)){
      issues.push({ code: 'missing_rendimiento_diario', kind, index, message: `Renglon ${index + 1} de ${kind} usa integracion "${integracion}" pero no trae "rendimientoDiario" (>0): el importe se calcula como 0 hasta que se indique.` });
    }
  }
  if(integracion === 'AMORTIZABLE' && !(Number(row?.vidaUtilDias) > 0)){
    issues.push({ code: 'missing_vida_util', kind, index, message: `Renglon ${index + 1} de ${kind} usa integracion "AMORTIZABLE" pero no trae "vidaUtilDias" (>0): el importe se calcula como 0 hasta que se indique.` });
  }
  if(integracion === 'POR_LOTE' && !(Number(row?.cantidad) >= 0)){
    issues.push({ code: 'missing_cantidad_lote', kind, index, message: `Renglon ${index + 1} de ${kind} usa integracion "POR_LOTE" pero "cantidad" no es un numero valido.` });
  }
}

function checkV2Field(issues, kind, index, field, rawValue){
  if(rawValue === undefined || rawValue === null) return;
  const value = Number(rawValue);
  if(!Number.isFinite(value)){
    issues.push({ code: 'non_finite_value', kind, index, field, message: `Valor no numerico (NaN/Infinity) en "${field}" del renglon ${index + 1} de ${kind}: se trata como 0.` });
    return;
  }
  if(value < 0){
    issues.push({ code: 'negative_value', kind, index, field, message: `Valor negativo en "${field}" del renglon ${index + 1} de ${kind}: se trata como 0.` });
  }
}
export function findApuNumericIssuesV2(apu = {}, totals = calcAPUv2(apu)){
  const issues = [];
  (Array.isArray(apu.materials) ? apu.materials : []).forEach((row, index) => {
    checkV2Field(issues, 'materials', index, 'consumo', row?.consumo);
    checkV2Field(issues, 'materials', index, 'desperdicioPct', row?.desperdicioPct);
    checkV2Field(issues, 'materials', index, 'precioUnitario', row?.precioUnitario);
  });
  (Array.isArray(apu.labor) ? apu.labor : []).forEach((row, index) => {
    checkV2Field(issues, 'labor', index, 'cuadrilla', row?.cuadrilla);
    checkV2Field(issues, 'labor', index, 'rendimiento', row?.rendimiento);
    checkV2Field(issues, 'labor', index, 'cantidad', row?.cantidad);
    checkV2Field(issues, 'labor', index, 'salarioBase', row?.salarioBase);
    checkV2Field(issues, 'labor', index, 'fsr', row?.fsr);
  });
  (Array.isArray(apu.equipment) ? apu.equipment : []).forEach((row, index) => {
    checkV2Field(issues, 'equipment', index, 'cantidad', row?.cantidad);
    checkV2Field(issues, 'equipment', index, 'tarifa', row?.tarifa);
    checkResourceIntegration(issues, 'equipment', index, row);
  });
  (Array.isArray(apu.seguridad) ? apu.seguridad : []).forEach((row, index) => {
    checkV2Field(issues, 'seguridad', index, 'cantidad', row?.cantidad);
    checkV2Field(issues, 'seguridad', index, 'precioUnitario', row?.precioUnitario);
    checkResourceIntegration(issues, 'seguridad', index, row);
  });
  // Cuadrilla no duplicada (punto de validacion explicito): mas de 2 renglones
  // de mano de obra suele significar que se fragmento un mismo ciclo de
  // produccion (corte + traslado + limpieza) en "cuadrillas" separadas en vez
  // de una sola cuadrilla con un rendimiento combinado. No es un error duro
  // (pueden ser oficios realmente distintos, ej. electricista + plomero), asi
  // que se reporta como advertencia para revision humana, no se corrige solo.
  const laborRows = Array.isArray(apu.labor) ? apu.labor : [];
  if(laborRows.length > 2){
    issues.push({ code: 'possible_crew_fragmentation', kind: 'labor', message: `${laborRows.length} renglones de mano de obra: verificar que representen oficios realmente distintos y no el mismo ciclo de produccion fragmentado en varias "cuadrillas".` });
  }
  laborRows.forEach((row, index) => {
    if(row?.cuadrilla != null && Number(row.cuadrilla) > 0 && (row?.rendimiento == null || Number(row.rendimiento) <= 0)){
      issues.push({ code: 'zero_rendimiento', kind: 'labor', index, message: `Renglon ${index + 1} de mano de obra tiene cuadrilla pero rendimiento ausente o 0: no se puede prorratear el costo por unidad de obra.` });
    }
  });
  const hm = apu.herramientaMenor || {};
  if(hm.modo === 'detalle'){
    (Array.isArray(hm.detalle) ? hm.detalle : []).forEach((row, index) => {
      checkV2Field(issues, 'herramientaMenor', index, 'cantidad', row?.cantidad);
      checkV2Field(issues, 'herramientaMenor', index, 'costo', row?.costo);
      checkV2Field(issues, 'herramientaMenor', index, 'pctDepreciacion', row?.pctDepreciacion);
    });
  } else {
    checkV2Field(issues, 'herramientaMenor', 0, 'porcentaje', hm.porcentaje);
  }
  ['indCampo', 'indOficina', 'finance', 'utility', 'cargos', 'iva'].forEach((field) => {
    const value = Number(apu.factores?.[field]);
    if(Number.isFinite(value) && value < 0) issues.push({ code: 'negative_percentage', field, message: `Porcentaje "${field}" negativo (${value}%): se trata como 0.` });
  });
  if(totals.pu <= 0) issues.push({ code: 'zero_or_negative_price', message: 'El precio unitario resultante es cero o negativo.' });
  return issues;
}
