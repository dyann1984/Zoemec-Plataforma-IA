/* Motor de control de calidad tecnico (motor universal de APUs): reglas
   semanticas del tipo "cimbra sin material de cimbra", "acero sin acero",
   "tuberia sin tubo" -- EXTENSIBLE porque se derivan automaticamente de
   `requiredResourceKeywords` de cada entrada de
   src/domain/constructionSystems.js#SYSTEM_META, nunca de una lista cerrada
   de casos escritos a mano aqui. Agregar una disciplina nueva a
   SYSTEM_META con su requiredResourceKeywords le da cobertura de QA gratis,
   sin tocar este archivo.

   Complementa (no duplica) las reglas transversales que ya existen en
   src/domain/apuProfessional.js#validateAPU (labor vacio, materiales
   vacios, precio sin fuente, precio viejo, recurso duplicado) y en
   src/lib/apuCalc.js#findApuNumericIssuesV2 (valores negativos/NaN,
   integracion faltante de equipo/seguridad). Este modulo solo agrega la
   pieza que faltaba: "¿los recursos que SI hay tienen sentido para la
   disciplina que se detecto?". */
import { SYSTEM_META } from './constructionSystems.js';

function foldAccents(value){
  return String(value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/* Verifica, para cada categoria con requiredResourceKeywords declarado en
   la disciplina detectada, que exista AL MENOS un renglon cuya descripcion
   contenga alguna de esas palabras. Si la disciplina no tiene
   requiredResourceKeywords para una categoria (objeto vacio), esa categoria
   no se valida -- no toda disciplina necesita materiales propios (ej.
   acarreo_manual, excavacion manual). Nunca se ejecuta para un APU sin
   `primaryActivity` conocido (AI/legacy sin clasificacion): en ese caso no
   hay disciplina de referencia contra la cual validar, se omite en
   silencio (no es un error, es informacion que no existe todavia). */
export function runTechnicalQualityRules(apu = {}){
  const issues = [];
  const tipo = apu.primaryActivity;
  const meta = tipo ? SYSTEM_META[tipo] : null;
  if(!meta || !meta.requiredResourceKeywords) return issues;

  for(const [category, keywords] of Object.entries(meta.requiredResourceKeywords)){
    if(!Array.isArray(keywords) || !keywords.length) continue;
    const rows = Array.isArray(apu[category]) ? apu[category] : [];
    // Se compara sin acentos de ambos lados (foldAccents): un renglon real
    // como "Cámara de seguridad" no debe fallar la regla solo porque la
    // palabra clave se escribio sin tilde ("camara") -- ver caso VAL-020 en
    // la evidencia del motor universal.
    const haystack = foldAccents(rows.map(r => String(r?.descripcion || '')).join(' | '));
    const matched = keywords.some(kw => haystack.includes(foldAccents(kw)));
    if(!matched){
      issues.push({
        code: 'discipline_missing_expected_resource',
        severity: 'error',
        category,
        discipline: meta.discipline,
        message: `${meta.discipline}: no se encontro ningun renglon de "${category}" que corresponda a esta disciplina (se esperaba alguna palabra como: ${keywords.join(', ')}). Revisa si el recurso principal falta o esta mal descrito.`
      });
    }
  }
  return issues;
}
