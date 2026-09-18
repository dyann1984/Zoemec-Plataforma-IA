/* Capitulado estandar del Presupuesto (Fase D). Lista fija y ordenada -- el
   orden ES el orden de presentacion (subtotales por capitulo, tabla del
   Presupuesto, exportadores PDF/Excel), nunca se reordena por conteo ni
   alfabeticamente. Un concepto sin capitulo reconocido cae en OTROS (ultimo
   de la lista) en vez de perderse o romper el agrupamiento -- nunca se
   inventa un capitulo nuevo silenciosamente. */

export const PRESUPUESTO_CAPITULOS = Object.freeze([
  { key: 'PRELIMINARES', label: 'Preliminares' },
  { key: 'CIMENTACION', label: 'Cimentación' },
  { key: 'ESTRUCTURA', label: 'Estructura' },
  { key: 'ALBANILERIA', label: 'Albañilería' },
  { key: 'INSTALACIONES', label: 'Instalaciones' },
  { key: 'ACABADOS', label: 'Acabados' },
  { key: 'CANCELERIA_CARPINTERIA', label: 'Cancelería/Carpintería' },
  { key: 'OBRAS_EXTERIORES', label: 'Obras exteriores' },
  { key: 'LIMPIEZA', label: 'Limpieza' },
  { key: 'OTROS', label: 'Otros' }
]);

export const PRESUPUESTO_CAPITULO_KEYS = Object.freeze(PRESUPUESTO_CAPITULOS.map(c => c.key));

export function isKnownCapitulo(key){
  return PRESUPUESTO_CAPITULO_KEYS.includes(key);
}

export function capituloLabel(key){
  return PRESUPUESTO_CAPITULOS.find(c => c.key === key)?.label || PRESUPUESTO_CAPITULOS[PRESUPUESTO_CAPITULOS.length - 1].label;
}

/* Normaliza cualquier valor de capitulo capturado a mano (texto libre,
   variantes de mayusculas/acentos) a una de las claves conocidas, o a
   'OTROS' si no coincide con ninguna -- nunca lanza, nunca deja el campo
   vacio en la agregacion. */
export function normalizeCapitulo(value){
  const key = String(value || '').trim().toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if(isKnownCapitulo(key)) return key;
  const alias = {
    CARPINTERIA: 'CANCELERIA_CARPINTERIA', CANCELERIA: 'CANCELERIA_CARPINTERIA',
    EXTERIORES: 'OBRAS_EXTERIORES', OBRA_EXTERIOR: 'OBRAS_EXTERIORES'
  }[key];
  return alias && isKnownCapitulo(alias) ? alias : 'OTROS';
}
