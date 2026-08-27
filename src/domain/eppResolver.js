/* Resolver de EPP dinamico (Prioridad 2, fase de correccion): concepto +
   sistema constructivo -> riesgo -> EPP aplicable -> catalogo -> prorrateo
   -> renglon de seguridad para el APU. Reutilizable para CUALQUIER
   disciplina sin hardcodear cada concepto ni cada una de las ~40 plantillas
   de constructionSystems.js: un registro PEQUEÑO y extensible de riesgos
   (por palabra clave sobre el texto normalizado del concepto, o sobre el
   `tipo` ya clasificado) decide que EPP aplica -- una disciplina nueva no
   necesita una entrada propia aqui, hereda las reglas de riesgo que su
   propio texto dispare.

   El costeo NO reinventa ninguna formula: usa el mismo modelo AMORTIZABLE
   que ya existe en calcSeguridadRow (src/lib/apuCalc.js) --
   costo = (precioUnitario * cantidad * factorReposicion) / vidaUtilDias / rendimientoDiario
   -- exactamente "costo adquisicion / vida util * factor utilizacion /
   produccion" que pidio el usuario. */
import { findCatalogMatches } from './catalogLookup.js';

// EPP base para practicamente cualquier trabajo fisico en obra.
const BASELINE_EPP = [
  { clave: 'EPP-CASCO', descripcion: 'Casco de seguridad', vidaUtilDias: 365 },
  { clave: 'EPP-BOTAS', descripcion: 'Botas de seguridad con casquillo', vidaUtilDias: 180 },
  { clave: 'EPP-GUANTES', descripcion: 'Guantes de protección general', vidaUtilDias: 30 }
];

/* vidaUtilDias son valores de REFERENCIA editables (mismo criterio que
   HAUL_MODEL en apuGeneration.js: constantes documentadas, no una
   cotizacion real) -- lo que NUNCA se inventa es el PRECIO (ver
   resolveEppRows: sin match de catalogo, precioUnitario queda en 0 y el
   renglon se marca REQUIERE_VALIDACION). */
const RISK_RULES = [
  { riesgo: 'polvo_particulas', test: ctx => /corte|demolic|lij|esmeril|concreto|cemento|tablaroca|yeso|polvo|barrenad|taladr/.test(ctx.text),
    epp: [{ clave: 'EPP-MASCARILLA', descripcion: 'Mascarilla contra polvo N95', vidaUtilDias: 1 }] },
  { riesgo: 'corte_esmerilado', test: ctx => /corte|esmeril|disco|sierra|segueta/.test(ctx.text),
    epp: [{ clave: 'EPP-LENTES', descripcion: 'Lentes de seguridad', vidaUtilDias: 90 }] },
  { riesgo: 'altura', test: ctx => /plaf[oó]n|azotea|fachada|andamio|altura|techo|cubierta/.test(ctx.text),
    epp: [{ clave: 'EPP-ARNES', descripcion: 'Arnés de seguridad con línea de vida', vidaUtilDias: 365 }] },
  { riesgo: 'electrico', test: ctx => ctx.tipo === 'electrico' || /el[eé]ctric/.test(ctx.text),
    epp: [{ clave: 'EPP-GUANTES-DIEL', descripcion: 'Guantes dieléctricos', vidaUtilDias: 180 }] },
  { riesgo: 'ruido', test: ctx => /compactador|rompedora|martillo|demolic|perforac/.test(ctx.text),
    epp: [{ clave: 'EPP-AUDITIVA', descripcion: 'Protección auditiva', vidaUtilDias: 180 }] },
  { riesgo: 'manejo_manual_cargas', test: ctx => /acarreo|carga manual|manejo manual/.test(ctx.text),
    epp: [{ clave: 'EPP-FAJA', descripcion: 'Faja lumbar de protección', vidaUtilDias: 180 }] },
  { riesgo: 'quimicos', test: ctx => /pintura|solvente|impermeabiliz|adhesivo|resina|epox/.test(ctx.text),
    epp: [{ clave: 'EPP-GUANTES-QUIM', descripcion: 'Guantes resistentes a químicos', vidaUtilDias: 30 }] }
];

function dedupeByClave(items){
  const seen = new Map();
  items.forEach(it => seen.set(it.clave, it));
  return [...seen.values()];
}

/* Determina QUE EPP aplica -- nunca decide precio aqui (eso lo hace
   resolveEppRows, consultando catalogo). Puro, sin Firebase/React. */
export function detectApplicableEpp({ text, tipo } = {}){
  const ctx = { text: String(text || '').toLowerCase(), tipo: tipo || null };
  const applicable = [...BASELINE_EPP];
  const risks = [];
  RISK_RULES.forEach(rule => {
    if(rule.test(ctx)){ risks.push(rule.riesgo); applicable.push(...rule.epp); }
  });
  return { epp: dedupeByClave(applicable), risks };
}

/* Construye los renglones de seguridad v2 para un concepto: EPP aplicable
   (detectApplicableEpp) + precio real de catalogo (findCatalogMatches,
   tipo='epp') + prorrateo AMORTIZABLE usando el MISMO rendimiento diario ya
   usado para mano de obra (rendimientoDiario/cuadrilla vienen de
   laborDetails[0] en apuGeneration.js -- de Prioridad 1 cuando hay
   rendimiento real de Biblioteca, o de la plantilla si no -- nunca una
   cifra nueva inventada aqui).

   Sin match de catalogo O sin rendimiento diario valido: el renglon queda
   con precioUnitario=0, fuente.estado=REQUIERE_VALIDACION y
   observaciones explicitas -- NUNCA se fabrica un precio de mercado ni un
   rendimiento. */
export function resolveEppRows({ concept, tipo, catalog, rendimientoDiario, cuadrilla } = {}){
  const { epp, risks } = detectApplicableEpp({ text: concept, tipo });
  const rendimientoValido = Number.isFinite(rendimientoDiario) && rendimientoDiario > 0;
  const rows = epp.map(item => {
    const found = findCatalogMatches(catalog, { desc: item.descripcion, tipo: 'epp' });
    const datosSuficientes = Boolean(found) && rendimientoValido;
    return {
      clave: found?.match.clave || item.clave,
      descripcion: item.descripcion,
      unidad: 'pza',
      cantidad: cuadrilla > 0 ? cuadrilla : 1,
      precioUnitario: found ? found.match.precio : 0,
      integracion: 'AMORTIZABLE',
      vidaUtilDias: item.vidaUtilDias,
      rendimientoDiario: rendimientoValido ? rendimientoDiario : 0,
      factorReposicion: 1,
      observaciones: !found
        ? 'REQUIERE VALIDACIÓN: no se encontró precio real en catálogo para este EPP -- no se fabricó un precio de mercado.'
        : !rendimientoValido
          ? 'REQUIERE VALIDACIÓN: no hay rendimiento diario de la cuadrilla para prorratear este EPP.'
          : `EPP aplicable por riesgo detectado en el concepto (match de catálogo: ${found.matchMethod}).`,
      fuente: {
        proveedor: found?.match.traceability?.sourceDocName || null,
        fecha: found?.match.traceability?.validatedAt || null,
        region: null,
        estado: !found ? 'REQUIERE_VALIDACION' : (found.match.estado === 'VERIFICADO' ? 'VERIFICADO' : 'IMPORTADO')
      },
      requiereValidacion: !datosSuficientes
    };
  });
  return { rows, risks };
}
