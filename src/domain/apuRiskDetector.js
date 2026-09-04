/* Detector de costos no contemplados (Parte F del requerimiento de
   produccion): motor DETERMINISTA (decision explicita del usuario,
   2026-09-03 -- ver AskUserQuestion de la sesion), corre BAJO DEMANDA (boton
   explicito, nunca automatico), nunca por IA -- no hay OPENAI_API_KEY en
   este entorno y el usuario excluyo explicitamente IA nueva en esta ronda
   (Parte M). Cada regla solo reporta AUSENCIA ESTRUCTURAL real en el propio
   APU (nunca un juicio semantico inventado): "no hay renglon de EPP",
   "no hay costos de campo capturados", etc. -- nunca "esto seguramente
   cuesta $X", salvo cuando el impacto es calculable con datos ya presentes
   en el propio APU. */
export const RISK_SEVERITY = Object.freeze({ CRITICAL: 'CRITICAL', HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW' });
const SEVERITY_ORDER = [RISK_SEVERITY.CRITICAL, RISK_SEVERITY.HIGH, RISK_SEVERITY.MEDIUM, RISK_SEVERITY.LOW];

function textIncludesAny(text, keywords){
  const t = String(text || '').toLowerCase();
  return keywords.some(k => t.includes(k));
}
function joinTexts(...values){ return values.filter(Boolean).join(' '); }

const HEIGHT_RISK_KEYWORDS = ['altura', 'andamio', 'azotea', 'techumbre', 'cubierta', 'torre', 'fachada'];
const FALL_PROTECTION_KEYWORDS = ['arnes', 'arnés', 'linea de vida', 'línea de vida', 'anticaidas', 'anticaídas'];
const TRANSPORT_KEYWORDS = ['flete', 'transporte', 'acarreo', 'traslado', 'volteo'];
const SUPERVISION_KEYWORDS = ['residente', 'supervisor', 'cabo', 'sobrestante', 'encargado de obra'];
const PERMIT_DISCIPLINES = ['electrica', 'gas', 'contraincendio', 'elevadores', 'voz_datos', 'cctv', 'hvac'];

/* Cada regla recibe el APU finalizado (con .calculated) y regresa un
   hallazgo o null. Se define como lista para que agregar una regla nueva
   sea sumar una entrada, nunca editar logica existente (mismo criterio de
   registro extensible ya usado en technicalQualityRules.js). */
const RULES = [
  apu => {
    const tieneManoDeObra = (apu.labor || []).length > 0;
    const tieneEPP = (apu.seguridad || []).length > 0;
    if(!tieneManoDeObra || tieneEPP) return null;
    const riesgoAltura = textIncludesAny(joinTexts(apu.concept, ...(apu.procedimientoConstructivo || [])), HEIGHT_RISK_KEYWORDS);
    return {
      id: 'epp_ausente', severidad: riesgoAltura ? RISK_SEVERITY.CRITICAL : RISK_SEVERITY.HIGH,
      hallazgo: 'No hay renglones de Seguridad/EPP registrados pese a tener mano de obra en el APU.',
      evidencia: `${apu.labor.length} renglón(es) de mano de obra, 0 de seguridad.`,
      impactoPotencial: riesgoAltura ? 'El concepto/procedimiento menciona trabajo en altura -- el EPP de protección contra caídas suele ser costo real y obligatorio, no opcional.' : 'El EPP básico (casco, guantes, botas, lentes) suele representar un costo real que falta en el precio unitario.',
      recomendacion: 'Agregar los renglones de EPP correspondientes en la categoría F (Seguridad).',
      incluirEnAPU: false, confianza: riesgoAltura ? 'ALTA' : 'MEDIA'
    };
  },
  apu => {
    const riesgoAltura = textIncludesAny(joinTexts(apu.concept, ...(apu.procedimientoConstructivo || [])), HEIGHT_RISK_KEYWORDS);
    if(!riesgoAltura) return null;
    const tieneProteccionCaida = (apu.seguridad || []).some(r => textIncludesAny(r?.descripcion, FALL_PROTECTION_KEYWORDS));
    if(tieneProteccionCaida) return null;
    return {
      id: 'proteccion_caida_ausente', severidad: RISK_SEVERITY.CRITICAL,
      hallazgo: 'El concepto involucra trabajo en altura pero ningún renglón de Seguridad es protección contra caídas (arnés/línea de vida).',
      evidencia: 'Palabra clave de altura detectada en el concepto/procedimiento; sin renglón de arnés/línea de vida en seguridad.',
      impactoPotencial: 'Riesgo de seguridad real y posible costo de EPP especializado no contemplado.',
      recomendacion: 'Verificar si el procedimiento requiere arnés, línea de vida u otro sistema anticaídas, y agregarlo si aplica.',
      incluirEnAPU: false, confianza: 'MEDIA'
    };
  },
  apu => {
    if((apu.costosCampo || []).length > 0) return null;
    return {
      id: 'costos_campo_ausentes', severidad: RISK_SEVERITY.MEDIUM,
      hallazgo: 'No se han registrado Costos de Campo (viáticos, alimentos, traslados, consumibles menores, etc.).',
      evidencia: 'apu.costosCampo está vacío.',
      impactoPotencial: 'Gastos operativos reales de obra que típicamente no están en el costo directo inicial podrían quedar fuera del precio final.',
      recomendacion: 'Revisar si el concepto amerita registrar Costos de Campo en la sección correspondiente.',
      incluirEnAPU: false, confianza: 'BAJA'
    };
  },
  apu => {
    if((apu.normativa || []).length > 0) return null;
    return {
      id: 'normativa_ausente', severidad: RISK_SEVERITY.MEDIUM,
      hallazgo: 'No se ha registrado normativa potencialmente aplicable para este concepto.',
      evidencia: 'apu.normativa está vacío.',
      impactoPotencial: 'Requisitos normativos (materiales, EPP, pruebas, documentación) podrían no estar contemplados en el precio.',
      recomendacion: 'Revisar si aplica alguna normativa (NOM, reglamento local, código) y capturarla en la sección Normativa y Cumplimiento.',
      incluirEnAPU: false, confianza: 'BAJA'
    };
  },
  apu => {
    const tieneRecursos = (apu.materials || []).length > 0 || (apu.equipment || []).length > 0;
    if(!tieneRecursos || (apu.consumables || []).length > 0) return null;
    return {
      id: 'consumibles_ausentes', severidad: RISK_SEVERITY.LOW,
      hallazgo: 'No hay renglones de Consumibles y auxiliares registrados.',
      evidencia: `${(apu.materials || []).length} material(es), ${(apu.equipment || []).length} equipo(s), 0 consumibles.`,
      impactoPotencial: 'Insumos menores (discos de corte, combustible, lubricantes, cinta, electrodos) suelen quedar fuera si no se revisan explícitamente.',
      recomendacion: 'Confirmar si el procedimiento requiere consumibles y, de ser así, registrarlos.',
      incluirEnAPU: false, confianza: 'BAJA'
    };
  },
  apu => {
    const tieneRecursos = (apu.materials || []).length > 0 || (apu.labor || []).length > 0;
    const mencionaTransporte = textIncludesAny(joinTexts(apu.concept), TRANSPORT_KEYWORDS);
    const tieneTransporteEnRecursos = [...(apu.materials || []), ...(apu.equipment || [])].some(r => textIncludesAny(r?.descripcion, TRANSPORT_KEYWORDS));
    if(!tieneRecursos || mencionaTransporte || tieneTransporteEnRecursos) return null;
    return {
      id: 'transporte_no_contemplado', severidad: RISK_SEVERITY.LOW,
      hallazgo: 'No se identifica ningún renglón ni mención de transporte/flete/acarreo.',
      evidencia: 'Sin coincidencias de "flete/transporte/acarreo/traslado" en concepto ni en materiales/equipo.',
      impactoPotencial: 'Logística de materiales o equipo hacia el sitio podría representar un costo real no reflejado.',
      recomendacion: 'Confirmar si el concepto incluye o requiere transporte, y registrarlo si corresponde.',
      incluirEnAPU: false, confianza: 'BAJA'
    };
  },
  apu => {
    const tieneManoDeObra = (apu.labor || []).length > 0;
    if(!tieneManoDeObra) return null;
    const tieneSupervision = (apu.labor || []).some(r => textIncludesAny(r?.descripcion, SUPERVISION_KEYWORDS));
    if(tieneSupervision) return null;
    return {
      id: 'supervision_no_contemplada', severidad: RISK_SEVERITY.LOW,
      hallazgo: 'Ningún renglón de mano de obra corresponde a un rol de supervisión (residente/supervisor/cabo).',
      evidencia: `${apu.labor.length} renglón(es) de mano de obra, ninguno con rol de supervisión identificado por descripción.`,
      impactoPotencial: 'Si la partida requiere supervisión dedicada, ese costo podría no estar prorrateado en el precio unitario.',
      recomendacion: 'Confirmar si aplica un renglón de supervisión (directo o prorrateado como indirecto).',
      incluirEnAPU: false, confianza: 'BAJA'
    };
  },
  apu => {
    if(!apu.family || !PERMIT_DISCIPLINES.includes(apu.primaryActivity)) return null;
    const tienePermisos = (apu.normativa || []).some(n => n?.requiereDocumentacion);
    if(tienePermisos) return null;
    return {
      id: 'permisos_no_verificados', severidad: RISK_SEVERITY.MEDIUM,
      hallazgo: `La disciplina detectada (${apu.primaryActivity}) suele requerir permisos/trámites, y no hay ninguna normativa marcada con documentación requerida.`,
      evidencia: `primaryActivity="${apu.primaryActivity}"; normativa con requiereDocumentacion=true: 0.`,
      impactoPotencial: 'Trámites, permisos o dictámenes de terceros pueden implicar costo y tiempo no contemplados.',
      recomendacion: 'Verificar con el área normativa/legal si esta disciplina requiere permisos en la jurisdicción del proyecto.',
      incluirEnAPU: false, confianza: 'BAJA'
    };
  },
  apu => {
    const sinMerma = (apu.materials || []).filter(r => !(Number(r?.desperdicioPct) > 0));
    if(!sinMerma.length) return null;
    return {
      id: 'merma_no_registrada', severidad: RISK_SEVERITY.LOW,
      hallazgo: `${sinMerma.length} de ${apu.materials.length} material(es) tienen 0% de desperdicio/merma registrado.`,
      evidencia: sinMerma.slice(0, 5).map(r => r.descripcion || r.clave).join('; '),
      impactoPotencial: 'Un desperdicio real de 0% es poco común en obra; podría subestimar el consumo real del material.',
      recomendacion: 'Confirmar si 0% es intencional (material sin merma esperada) o si falta capturar el porcentaje real.',
      incluirEnAPU: false, confianza: 'BAJA'
    };
  }
];

/* analyzeApuRisks: corre las reglas deterministas y regresa la lista de
   hallazgos ordenada por severidad (nunca por orden de deteccion, para que
   lo mas critico siempre aparezca primero en UI/exportacion). */
export function analyzeApuRisks(apu = {}){
  const findings = RULES.map(rule => rule(apu)).filter(Boolean);
  findings.sort((a, b) => SEVERITY_ORDER.indexOf(a.severidad) - SEVERITY_ORDER.indexOf(b.severidad));
  return {
    analizadoEn: new Date().toISOString(),
    resumen: findings.length === 0
      ? 'ZOEMEC no detectó costos potenciales no contemplados con la información actual del APU.'
      : `ZOEMEC detectó ${findings.length} costo${findings.length === 1 ? '' : 's'} potencial${findings.length === 1 ? '' : 'es'} no contemplado${findings.length === 1 ? '' : 's'}.`,
    hallazgos: findings
  };
}
