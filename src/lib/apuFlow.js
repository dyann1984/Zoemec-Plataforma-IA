import { matchPrice, normalizeUnitLabel, cleanText } from './excelImport.js';

export const ALERT_LEVELS = { critical: 'critical', warning: 'warning', informative: 'informative' };

const normalizeText = (value = '') => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const normalizeConcept = (value = '') => normalizeText(value).replace(/\s+/g, ' ');
const stableHash = (value = '') => {
  const text = normalizeConcept(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(6, '0').slice(0, 6);
};

function buildAlert(code, message, level = ALERT_LEVELS.warning, metadata = {}) {
  return { code, message, level, ...metadata };
}

function matchAny(text, keywords = []){
  const lower = normalizeText(text);
  return keywords.some(k => lower.includes(normalizeText(k)));
}

function classifyApuType(concept = ''){
  const t = normalizeText(concept);
  if (matchAny(t, ['plafon', 'tablaroca', 'durock', 'falso plaf', 'trasdosado', 'panel yeso'])) return { type:'tablaroca', discipline:'acabados', family:'Tablaroca / plafón' };
  if (matchAny(t, ['pintura', 'pintar', 'recubrimiento', 'esmalte', 'vinil', 'primario'])) return { type:'pintura', discipline:'acabados', family:'Pintura y recubrimientos' };
  if (matchAny(t, ['concreto', 'losa', 'zapata', 'firme', 'cimbra', 'colado', 'cimentacion', 'mortero'])) return { type:'concreto', discipline:'obra civil', family:'Concreto estructural' };
  if (matchAny(t, ['acero', 'varilla', 'estructura metalica', 'soldadura', 'perfil', 'armazon', 'armadura'])) return { type:'acero', discipline:'estructura', family:'Acero estructural' };
  if (matchAny(t, ['excavacion', 'zanja', 'terrapl', 'despalme', 'nivelacion', 'retiro de tierra'])) return { type:'excavacion', discipline:'obra civil', family:'Excavación y terracerías' };
  if (matchAny(t, ['tuberia', 'tubo', 'red hidraulica', 'drenaje', 'sanitario', 'valvula', 'calentador'])) return { type:'tuberia', discipline:'instalaciones', family:'Tuberías e instalaciones' };
  if (matchAny(t, ['bomba', 'electrobomba', 'motobomba', 'bombeo'])) return { type:'bomba', discipline:'instalaciones', family:'Bombas e hidráulica' };
  if (matchAny(t, ['piso', 'loseta', 'ceramica', 'porcelanato', 'marmol', 'granito', 'zoclo'])) return { type:'piso', discipline:'acabados', family:'Pisos y alicatados' };
  if (matchAny(t, ['lavabo', 'sanitario', 'mueble baño', 'lavabo', 'regadera', 'compostura'])) return { type:'sanitario', discipline:'instalaciones', family:'Sanitarios e instalaciones' };
  return { type:'generico', discipline:'multidisciplinario', family:'APU genérico' };
}

function isSimilarConcept(a = '', b = ''){
  try{
    const stop = new Set(['de','el','la','los','las','y','con','para','por','un','una','unos','unas','cm','m2','m','mm','metros','metro']);
    const ta = normalizeText(a).split(/[^a-z0-9]+/).filter(Boolean).filter(t=>!stop.has(t));
    const tb = normalizeText(b).split(/[^a-z0-9]+/).filter(Boolean).filter(t=>!stop.has(t));
    if(!ta.length || !tb.length) return false;
    const setB = new Set(tb);
    const common = ta.filter(t=>setB.has(t));
    return common.length >= 1;
  }catch(e){return false}
}

function buildDefaultData(concept) {
  return {
    concept,
    materials: [{ description: 'Material base de referencia', quantity: 1, unit: 'pza', price: 0 }],
    labor: [{ description: 'Mano de obra base', quantity: 1, unit: 'jor', price: 0 }],
    machinery: [{ description: 'Maquinaria base', quantity: 1, unit: 'hr', price: 0 }],
    auxiliaries: [{ description: 'Auxiliar base', quantity: 1, unit: 'lote', price: 0 }],
    performance: 1,
    price: 0,
    source: 'deterministic_template',
    confidence: 0.45,
    isProposal: true,
    assumptions: ['Propuesta demostrativa sin coincidencia exacta'],
    warnings: ['Validación pendiente'],
    traceability: []
  };
}

const APU_TEMPLATES = {
  generico:{ unit:'pza', materials:[['Insumo principal para el concepto',1,'pza',0,0],['Materiales de fijación y soporte',1,'lote',0,0]], labor:[['Oficial técnico',0.12,'jor',380,1.85],['Ayudante',0.12,'jor',258,1.82]], equipment:[['Herramienta menor y apoyo',0.04,'día',110]] },
  tablaroca:{ unit:'m²', materials:[['Panel de yeso / tablaroca',1.05,'m²',210,5],['Canal metálico y accesorios',1.15,'m',38,5],['Tornillería y fijaciones',0.18,'jgo',85,3],['Cinta y masilla de juntas',0.22,'kg',42,5]], labor:[['Instalador de panel',0.12,'jor',420,1.85],['Ayudante',0.12,'jor',285,1.82],['Tratamiento de juntas',0.05,'jor',380,1.85]], equipment:[['Herramienta de fijación y corte',0.03,'día',150],['Andamio o escalera',0.04,'día',120]] },
  pintura:{ unit:'m²', materials:[['Pintura vinílica o acrílica',0.18,'L',85,5],['Sellador o primario',0.06,'L',70,5],['Lija y protección',0.08,'pza',18,0]], labor:[['Pintor oficial',0.055,'jor',360,1.85],['Ayudante',0.045,'jor',258,1.82]], equipment:[['Andamio o escalera',0.04,'día',120],['Herramientas de aplicación',0.025,'día',75]] },
  concreto:{ unit:'m³', materials:[['Cemento CPC 30R',7,'bulto',225,3],['Arena',0.55,'m³',480,5],['Grava 19 mm',0.75,'m³',520,5],['Agua',0.18,'m³',65,0]], labor:[['Albañil oficial',0.22,'jor',380,1.85],['Ayudante',0.22,'jor',258,1.82],['Cabo de obra',0.03,'jor',520,1.85]], equipment:[['Revolvedora / vibrador',0.25,'hr',95],['Herramienta de nivelación',0.05,'día',90]] },
  acero:{ unit:'kg', materials:[['Acero de refuerzo',1.05,'kg',26.5,2],['Soldadura y consumibles',0.03,'kg',120,0]], labor:[['Fierrero oficial',0.018,'jor',400,1.85],['Ayudante',0.018,'jor',258,1.82]], equipment:[['Cizalla o dobladora',0.01,'día',180]] },
  excavacion:{ unit:'m³', materials:[['Tierra removida',1,'m³',0,0]], labor:[['Peón',0.6,'jor',258,1.82]], equipment:[['Herramienta de excavación',0.05,'día',60]] },
  tuberia:{ unit:'m', materials:[['Tubo según material y diámetro',1.05,'m',95,3],['Accesorios y conexiones',0.3,'pza',45,3],['Soportes y abrazaderas',0.25,'pza',38,3]], labor:[['Tubero oficial',0.09,'jor',400,1.85],['Ayudante',0.09,'jor',258,1.82]], equipment:[['Herramienta de corte y unión',0.03,'día',110],['Equipo de prueba de presión',0.02,'día',150]] },
  bomba:{ unit:'pza', materials:[['Bomba industrial o sumergible',1,'pza',8500,0],['Base antivibratoria',1,'jgo',420,0],['Conexiones y valvulería',2,'pza',380,0],['Protección eléctrica',1,'lote',650,0]], labor:[['Instalador electromecánico',0.8,'jor',520,1.85],['Ayudante',0.8,'jor',285,1.82],['Pruebas y ajuste',0.2,'jor',520,1.85]], equipment:[['Polipasto y izaje',0.15,'día',220],['Herramienta eléctrica',0.1,'día',150]] },
  piso:{ unit:'m²', materials:[['Loseta o piso cerámico',1.05,'m²',135,8],['Adhesivo',0.18,'bulto',135,5],['Boquilla',0.3,'kg',28,5]], labor:[['Colocador oficial',0.12,'jor',400,1.85],['Ayudante',0.12,'jor',258,1.82]], equipment:[['Cortadora de losetas',0.03,'día',150]] },
  sanitario:{ unit:'pza', materials:[['Sanitario / lavabo / mueble',1,'pza',1200,0],['Accesorios de instalación',1,'jgo',450,0],['Tuberías y juntas',1,'lote',220,0]], labor:[['Instalador sanitario',0.4,'jor',420,1.85],['Ayudante',0.4,'jor',285,1.82],['Pruebas hidráulicas',0.1,'jor',420,1.85]], equipment:[['Herramienta de unión y prueba',0.03,'día',130]] }
};

function enrichApuWithCatalog(apu, catalog = []){
  const apply = (row) => {
    const match = matchPrice(row[0], catalog);
    if (match && Number(match.precio) > 0) {
      row[3] = Number(match.precio);
      if (match.unidad) row[2] = normalizeUnitLabel(match.unidad);
    }
    return row;
  };
  return {
    ...apu,
    materials: (apu.materials||[]).map(apply),
    labor: (apu.labor||[]).map(apply),
    equipment: (apu.equipment||[]).map(apply)
  };
}

export function buildUniversalAPU(item = {}, catalog = [], index = 0, sourceFile = 'Plantilla técnica ZOEMEC'){
  const concept = cleanText(item.concept || item.description || String(item || '')).replace(/\s+/g,' ').trim() || 'Concepto genérico';
  const detected = classifyApuType(concept);
  const template = APU_TEMPLATES[detected.type] || APU_TEMPLATES.generico;
  const base = {
    id:`APU-${stableHash(concept)}-${index+1}`,
    clave:`APU-${stableHash(concept).slice(0,4)}${index+1}`,
    concept,
    unit: normalizeUnitLabel(item.unit || template.unit),
    materials: template.materials.map(r => [cleanText(r[0]), Number(r[1]) || 0, normalizeUnitLabel(r[2]), Number(r[3]) || 0, Number(r[4]) || 0]),
    labor: template.labor.map(r => [cleanText(r[0]), Number(r[1]) || 0, normalizeUnitLabel(r[2]), Number(r[3]) || 0, Number(r[4]) || 1]),
    equipment: template.equipment.map(r => [cleanText(r[0]), Number(r[1]) || 0, normalizeUnitLabel(r[2]), Number(r[3]) || 0]),
    herramienta: 3,
    indCampo: 8,
    indOficina: 7,
    finance: 2,
    utility: 10,
    cargos: 0.5,
    iva: 16,
    family: detected.family,
    confidence: detected.type === 'generico' ? 76 : 92,
    sat: '72100000',
    templateGenerated: true,
    aiGenerated: false,
    templateFallback: true,
    sourceFile,
    sourceSection: item.section || '',
    sourceQty: Number(item.qty || 1) || 1,
    referencePU: Number(item.referencePU || 0) || 0,
    aiNotes: [
      `Concepto clasificado como ${detected.family} en especialidad ${detected.discipline}.`,`Matriz APU generada localmente como respaldo operativo. Revisa precios y rendimientos.`
    ],
    date: new Date().toLocaleDateString('es-MX')
  };
  return enrichApuWithCatalog(base, catalog);
}

export async function processApuConcept({ concept = '', library = [], openai = null }) {
  const normalizedConcept = normalizeConcept(concept);
  const exactMatch = library.find(item => normalizeConcept(item.concept) === normalizedConcept);
  const similarMatch = !exactMatch ? library.find(item => isSimilarConcept(normalizedConcept, normalizeConcept(item.concept))) : null;

  const alerts = [];
  const data = buildDefaultData(concept);

  if (exactMatch) {
    data.materials = [{ description: exactMatch.concept, quantity: 1, unit: exactMatch.unit || 'pza', price: Number(exactMatch.price || 0) }];
    data.price = Number(exactMatch.price || 0);
    data.source = 'exact_library';
    data.confidence = 0.95;
    data.isProposal = false;
    data.assumptions = ['Coincidencia exacta en biblioteca'];
    data.traceability = [{ file: 'biblioteca', sheet: 'catalogo', row: 1, source: 'exact_library' }];
  } else if (similarMatch) {
    data.materials = [{ description: similarMatch.concept, quantity: 1, unit: similarMatch.unit || 'pza', price: Number(similarMatch.price || 0) }];
    data.price = Number(similarMatch.price || 0);
    data.source = 'similar_library';
    data.confidence = 0.8;
    data.isProposal = false;
    data.assumptions = ['Coincidencia similar en biblioteca'];
    data.traceability = [{ file: 'biblioteca', sheet: 'catalogo', row: 1, source: 'similar_library' }];
  } else {
    try {
      const aiResult = openai ? await openai({ concept, catalog: library }) : null;
      if (aiResult?.ok) {
        Object.assign(data, aiResult.data || {});
        data.source = 'ai_generated';
        data.confidence = Number(aiResult.confidence || 0.65);
        data.isProposal = false;
        data.assumptions = Array.isArray(aiResult.data?.assumptions) ? aiResult.data.assumptions : ['Propuesta generada por IA'];
        data.traceability = aiResult.data?.traceability || [];
      } else {
        data.source = 'deterministic_template';
        data.confidence = 0.6;
        data.isProposal = true;
        data.assumptions = ['Fallback determinista por falta de coincidencia o servicio no disponible'];
      }
    } catch (error) {
      data.source = 'deterministic_template';
      data.confidence = 0.55;
      data.isProposal = true;
      data.assumptions = ['Fallback determinista por error del servicio'];
      data.warnings = ['Se registró el fallo del servicio en admin'];
    }
  }

  if (data.price <= 0) alerts.push(buildAlert('price_zero', 'Precio cero o no encontrado en referencia.', ALERT_LEVELS.critical, { field: 'price' }));
  if (normalizedConcept.includes('bomba') || normalizedConcept.includes('sumergible')) alerts.push(buildAlert('machinery_missing', 'Maquinaria obligatoria no especificada.', ALERT_LEVELS.warning, { field: 'machinery' }));
  if (!concept || concept.length < 5) alerts.push(buildAlert('incomplete_apu', 'Concepto incompleto para procesar.', ALERT_LEVELS.warning));
  if ((data.materials || []).some(item => String(item.description || '').toLowerCase().includes('genérico'))) alerts.push(buildAlert('generic_material', 'Material genérico detectado.', ALERT_LEVELS.warning));
  if (data.performance < 0.8 || data.performance > 1.2) alerts.push(buildAlert('performance_out_of_range', 'Rendimiento fuera de rango.', ALERT_LEVELS.warning));
  if (!data.source) alerts.push(buildAlert('missing_source', 'Fuente ausente.', ALERT_LEVELS.informative));
  if (!data.materials?.length || !data.labor?.length) alerts.push(buildAlert('incomplete_apu', 'APU incompleto.', ALERT_LEVELS.critical));

  const warnings = [...(data.warnings || []), ...alerts.map(alert => alert.message)];
  return {
    ok: true,
    source: data.source,
    confidence: data.confidence,
    data: { ...data, warnings },
    warnings,
    alerts,
    error: null
  };
}

export function validateApu({ concept = '', items = [] }) {
  const alerts = [];
  const normalized = normalizeConcept(concept);
  const duplicateConcepts = items.filter(item => normalizeConcept(item.concept) === normalized);
  if (duplicateConcepts.length > 1) alerts.push(buildAlert('duplicate_concept', 'Concepto duplicado dentro del APU.', ALERT_LEVELS.warning));
  if (items.some(item => !item.clave)) alerts.push(buildAlert('missing_key', 'Falta clave en una partida.', ALERT_LEVELS.warning));
  if (items.some(item => !item.unit)) alerts.push(buildAlert('unit_incompatible', 'Unidad incompatible o ausente.', ALERT_LEVELS.warning));
  return { ok: alerts.every(alert => alert.level !== ALERT_LEVELS.critical), alerts };
}

export function canExportApu({ alerts = [] }) {
  return !alerts.some(alert => alert.level === ALERT_LEVELS.critical);
}

export function buildZoeResponse({ intent = 'review', context = {} }) {
  const alerts = Array.isArray(context.alerts) ? context.alerts : [];
  const libraryCount = Array.isArray(context.library) ? context.library.length : 0;
  const activeApu = context.activeApu || {};
  const projectName = context.project?.name || null;
  const hasCritical = alerts.some(item => item.level === ALERT_LEVELS.critical);
  const warningCount = alerts.filter(item => item.level === ALERT_LEVELS.warning).length;
  const informativeCount = alerts.filter(item => item.level === ALERT_LEVELS.informative).length;
  const summary = [];
  if (projectName) summary.push(`Proyecto: ${projectName}.`);
  if (activeApu.concept) summary.push(`APU: ${activeApu.concept}.`);
  if (libraryCount) summary.push(`Biblioteca con ${libraryCount} referencias cargadas.`);
  if (!libraryCount) summary.push('Sin biblioteca técnica cargada.');
  const statusLine = hasCritical
    ? `Hay ${alerts.length} alertas en total, incluidas ${warningCount} advertencias y ${alerts.filter(item => item.level === ALERT_LEVELS.critical).length} críticas.`
    : alerts.length
      ? `Hay ${warningCount} advertencias y ${informativeCount} avisos. Revisar la trazabilidad antes de exportar.`
      : 'No se detectaron alertas críticas en el APU.';

  if (intent === 'review') {
    return {
      message: `Analizo el APU activo ${activeApu.concept || 'sin concepto definido'}. ${summary.join(' ')} ${statusLine} Mi recomendación: revisar y validar precios, unidades, maquinaria y trazabilidad, y documenta las fuentes antes de aprobar.`,
      actions: hasCritical ? ['validateApu', 'reviewCriticalAlerts'] : ['validateApu', 'prepareExport'],
      alerts
    };
  }
  if (intent === 'explain_price') {
    const evidence = activeApu.evidence || { file: 'sin archivo', sheet: 'sin hoja', row: 'sin fila' };
    return {
      message: `El precio del APU ${activeApu.concept || 'actual'} es ${activeApu.price || 0} MXN. Fuente: ${activeApu.source || 'manual'}. Evidencia: ${evidence.file}, hoja ${evidence.sheet}, fila ${evidence.row}. Si quieres, puedo validar si coincide con el catálogo y la unidad técnica.`,
      actions: ['explainPrice', hasCritical ? 'highlightCriticalAlerts' : 'suggestCorrections'],
      alerts
    };
  }
  if (intent === 'export_pdf') {
    return {
      message: hasCritical
        ? 'No exportes aún: hay alertas críticas que requieren revisión técnica antes de entregar el APU como documento oficial.'
        : 'El APU puede exportarse. Revisa los avisos y asegúrate de que el presupuesto, la biblioteca y la trazabilidad estén completos.',
      actions: hasCritical ? ['validateApu'] : ['exportPdf', 'createBudget'],
      alerts
    };
  }
  return {
    message: `Soy ZOE, tu ingeniero de costos senior. ${summary.join(' ')} Pídeme revisar un APU, explicar precios, validar trazabilidad, preparar presupuesto o usar la biblioteca técnica como fuente.`,
    actions: ['reviewApu', 'openLibrary', 'prepareBudget'],
    alerts
  };
}

export function createDemoContext() {
  return {
    projectLabel: 'Demo: Proyecto demostrativo',
    activity: ['Importación de catálogo', 'Validación de APU', 'Presupuesto listo'],
    activeApu: {
      concept: 'Muro de block 15 cm',
      confidence: 0.92,
      price: 825,
      source: 'exact_library'
    },
    budget: 1250000,
    showTraceability: true,
    showValidatedApu: true,
    zoeTools: ['getActiveApu', 'validateApu', 'findSimilarMatrices', 'explainPrice', 'updateApuItem', 'recalculateApu', 'saveApu', 'createBudget', 'exportPdf', 'exportExcel', 'openTechnicalOffice']
  };
}
