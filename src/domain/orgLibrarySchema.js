/* Biblioteca EMPRESARIAL (Fase P0 -- resolucion definitiva del bug ADMIN vs
   COLLABORATOR). Puro, sin React ni Firebase.

   ARQUITECTURA: coleccion Firestore `orgLibrary` con cada documento scoped
   por `organizationId`. Mismo patron que `catalogConceptos`/`presupuestos`/
   `apus` (org-scoped, Admin SDK server-side, RBAC via _orgGuard).

   Reglas de negocio (encargo P0):
   - Un COLLABORATOR de la organizacion LEE la biblioteca completa (misma
     evidencia que el ADMIN para generar APU).
   - Un COMPANY_MANAGER CREA, EDITA, ARCHIVA.
   - Un usuario de OTRA organizacion nunca ve nada.
   - Un usuario individual (sin organizationId) NO ve `orgLibrary`
     -- sigue usando su catalogo personal (comportamiento intacto).

   Dedupe (regla 18 del encargo): REUTILIZA la identidad que la Biblioteca
   ya usa (libraryReview.js#catalogDedupeKey: `clave:<clave>` si existe, si
   no `du:<descripcion>|<unidad>`) y solo le agrega la region -- el mismo
   insumo con precio de otra region es otro registro, nunca un duplicado. */
import { uid } from '../utils/id.js';
import { catalogDedupeKey } from './libraryReview.js';

export const ORG_LIBRARY_TYPE = Object.freeze({
  MATERIAL: 'material',
  LABOR: 'labor',
  EQUIPMENT: 'equipment',
  CONSUMABLE: 'consumable',
  SAFETY: 'safety',
  AUXILIARY: 'auxiliary'
});

export const ORG_LIBRARY_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED'
});

export function normalizeText(v){
  return String(v ?? '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}
const UNIT_ALIAS = Object.freeze({ 'm2': 'm²', 'm²': 'm²', 'm3': 'm³', 'm³': 'm³', 'pz': 'pza', 'pza': 'pza', 'pieza': 'pza', 'kg': 'kg', 'ton': 'ton', 't': 'ton', 'lt': 'l', 'l': 'l', 'ml': 'ml', 'm': 'm', 'jor': 'jor', 'jornada': 'jor', 'hr': 'hr', 'h': 'hr', 'dia': 'dia', 'saco': 'saco', 'bulto': 'saco' });
export function normalizeUnit(v){
  const t = normalizeText(v).replace(/\.$/, '');
  return UNIT_ALIAS[t] || t;
}
export function normalizeRegion(v){
  return normalizeText(v);
}

/* Identidad logica para DEDUPE dentro de la biblioteca empresarial: la de
   catalogDedupeKey (clave o descripcion|unidad, ya usada por la Biblioteca)
   + region normalizada. Deliberadamente NO incluye price/date: dos precios
   del mismo insumo en la misma region son la MISMA identidad, la diferencia
   es cual precio esta vigente. */
export function orgLibraryEntryKey({ code = '', description = '', unit = '', region = '' } = {}){
  const base = catalogDedupeKey({ clave: String(code || '').trim() || undefined, desc: normalizeText(description), unidad: normalizeUnit(unit) });
  return `${base}|region:${normalizeRegion(region)}`;
}

/* Identidad para PRECEDENCIA ENTRE CAPAS (proyecto > empresa > personal >
   global): solo descripcion|unidad normalizadas -- las claves NO se
   comparten entre fuentes distintas (la clave de la empresa no es la del
   catalogo personal ni la de la biblioteca global), asi que compararlas
   impediria que "Cemento CPC 30R" de proyecto le gane al de empresa. */
export function resolutionKey({ description = '', unit = '' } = {}){
  return `du:${normalizeText(description)}|${normalizeUnit(unit)}`;
}

/* projectId (opcional): null = recurso de la EMPRESA (aplica a todos sus
   proyectos); con valor = precio PROPIO de ese proyecto (capa "proyecto",
   la de mayor precedencia). Misma coleccion, dos alcances -- no hace falta
   una segunda coleccion para "precios de proyecto".
   validUntil (opcional): vigencia de la cotizacion/precio. Un precio vencido
   no se usa y la resolucion cae a la siguiente capa (nunca se usa un precio
   vencido en silencio). */
export function makeEmptyOrgLibraryEntry({
  id = null, organizationId = null, projectId = null, type = ORG_LIBRARY_TYPE.MATERIAL,
  code = '', description = '', unit = '', price = 0, currency = 'MXN',
  region = '', source = '', date = null, validUntil = null,
  evidence = null, origin = null, createdBy = null, updatedBy = null
} = {}){
  const now = new Date().toISOString();
  return {
    id: id || ('OLIB-' + uid()),
    organizationId,
    projectId: projectId || null,
    type,
    code: String(code || '').trim(),
    description: String(description || '').trim(),
    unit: String(unit || '').trim(),
    price: Number(price) || 0,
    currency: String(currency || 'MXN').toUpperCase(),
    region: String(region || '').trim(),
    source: String(source || '').trim(),
    date: date || now,
    validUntil: validUntil || null,
    evidence,
    // origin: de donde vino el registro (ej. { kind:'personal-import',
    // fromUid, fromKey:'zoemec-catalogo' } al copiar un catalogo personal).
    origin: origin || null,
    createdBy, updatedBy,
    status: ORG_LIBRARY_STATUS.ACTIVE,
    createdAt: now,
    updatedAt: now,
    archivedAt: null
  };
}

export function validateOrgLibraryEntry(entry){
  const errors = [];
  if(!entry || typeof entry !== 'object') errors.push('El recurso no tiene una forma valida.');
  if(!entry?.organizationId) errors.push('El recurso debe pertenecer a una organizacion.');
  if(!Object.values(ORG_LIBRARY_TYPE).includes(entry?.type)) errors.push('type invalido.');
  if(!entry?.description?.trim() && !entry?.code?.trim()) errors.push('El recurso necesita descripcion o codigo.');
  if(!entry?.unit?.trim()) errors.push('El recurso necesita unidad.');
  if(!(Number(entry?.price) >= 0)) errors.push('El precio debe ser >= 0.');
  if(!Object.values(ORG_LIBRARY_STATUS).includes(entry?.status)) errors.push('status invalido.');
  return { valid: errors.length === 0, errors };
}

/* Convierte una fila del catalogo PERSONAL (blob users/{uid}/state/
   zoemec-catalogo: {desc, unidad, precio, clave?, categoria?, tipo?, fecha?,
   traceability?}) en un candidato de biblioteca empresarial. No escribe
   nada: el candidato pasa por planOrgLibraryImport antes de persistirse. */
const CATEGORY_TO_TYPE = Object.freeze({
  material: ORG_LIBRARY_TYPE.MATERIAL, materiales: ORG_LIBRARY_TYPE.MATERIAL,
  labor: ORG_LIBRARY_TYPE.LABOR, 'mano de obra': ORG_LIBRARY_TYPE.LABOR, mo: ORG_LIBRARY_TYPE.LABOR,
  equipment: ORG_LIBRARY_TYPE.EQUIPMENT, equipo: ORG_LIBRARY_TYPE.EQUIPMENT, maquinaria: ORG_LIBRARY_TYPE.EQUIPMENT,
  consumable: ORG_LIBRARY_TYPE.CONSUMABLE, consumible: ORG_LIBRARY_TYPE.CONSUMABLE,
  safety: ORG_LIBRARY_TYPE.SAFETY, seguridad: ORG_LIBRARY_TYPE.SAFETY, epp: ORG_LIBRARY_TYPE.SAFETY
});
export function personalRowToOrgCandidate(row, { organizationId, region = '', fromUid = null } = {}){
  const typeHint = normalizeText(row?.tipo || row?.categoria || '');
  return makeEmptyOrgLibraryEntry({
    organizationId,
    type: CATEGORY_TO_TYPE[typeHint] || ORG_LIBRARY_TYPE.MATERIAL,
    code: row?.clave || '',
    description: row?.desc || row?.description || '',
    unit: row?.unidad || row?.unit || '',
    price: Number(row?.precio ?? row?.price) || 0,
    currency: row?.moneda || row?.currency || 'MXN',
    region: row?.region || region || '',
    source: row?.traceability?.sourceDocName || row?.fuente || row?.source || 'Catalogo personal',
    date: row?.traceability?.validatedAt || row?.fecha || row?.date || null,
    evidence: row?.traceability || null,
    origin: { kind: 'personal-import', fromUid, fromKey: 'zoemec-catalogo' }
  });
}

/* Plan de importacion NO destructivo y determinista (reglas 4, 17 y 18 del
   encargo). Compara candidatos contra la biblioteca empresarial existente
   (misma organizacion, mismo alcance proyecto/empresa) usando
   orgLibraryEntryKey y clasifica cada candidato:
     toCreate  -- identidad nueva en la biblioteca de la empresa.
     toUpdate  -- ya existe, el candidato trae precio > 0 DISTINTO y es MAS
                  RECIENTE: se propone actualizar el precio del existente
                  (conserva su id; nunca crea una copia).
     unchanged -- ya existe con el mismo precio: no se toca.
     conflicts -- ya existe con precio distinto pero el candidato es igual o
                  mas viejo: se conserva el de la empresa (nunca se pisa un
                  precio empresarial con uno personal mas viejo).
     invalid   -- sin descripcion/unidad o sin precio > 0.
     duplicatesInBatch -- el propio lote trae la misma identidad dos veces:
                  gana el mas reciente (y a igual fecha, el de mayor precio
                  conocido se descarta a favor del primero en orden estable).
   Nunca muta los arreglos recibidos. */
export function planOrgLibraryImport(candidates, existing = []){
  const existingByKey = new Map();
  (existing || []).filter(e => !e?.archivedAt).forEach(e => existingByKey.set(orgLibraryEntryKey(e), e));

  const invalid = [];
  const duplicatesInBatch = [];
  const batchByKey = new Map();
  (candidates || []).forEach((c, index) => {
    const hasText = String(c?.description || c?.code || '').trim();
    if(!hasText || !String(c?.unit || '').trim() || !(Number(c?.price) > 0)){
      invalid.push({ index, candidate: c, reason: !hasText ? 'SIN_DESCRIPCION' : !String(c?.unit || '').trim() ? 'SIN_UNIDAD' : 'SIN_PRECIO' });
      return;
    }
    const key = orgLibraryEntryKey(c);
    const prior = batchByKey.get(key);
    if(!prior){ batchByKey.set(key, c); return; }
    const keepNew = String(c.date || '') > String(prior.date || '');
    duplicatesInBatch.push({ key, kept: keepNew ? c : prior, dropped: keepNew ? prior : c });
    if(keepNew) batchByKey.set(key, c);
  });

  const toCreate = [], toUpdate = [], unchanged = [], conflicts = [];
  [...batchByKey.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([key, c]) => {
    const current = existingByKey.get(key);
    if(!current){ toCreate.push(c); return; }
    const samePrice = Math.abs(Number(current.price) - Number(c.price)) < 0.005;
    if(samePrice){ unchanged.push({ key, existing: current, candidate: c }); return; }
    const candidateNewer = String(c.date || '') > String(current.date || '');
    if(candidateNewer){
      toUpdate.push({ key, existingId: current.id, from: Number(current.price), to: Number(c.price), candidate: c });
    }else{
      conflicts.push({ key, existingId: current.id, existingPrice: Number(current.price), candidatePrice: Number(c.price), resolution: 'KEEP_ORGANIZATION' });
    }
  });

  const regions = [...new Set([...batchByKey.values()].map(c => c.region || '(sin region)'))].sort();
  const sources = [...new Set([...batchByKey.values()].map(c => c.source || '(sin fuente)'))].sort();
  const dates = [...batchByKey.values()].map(c => c.date).filter(Boolean).sort();
  return {
    toCreate, toUpdate, unchanged, conflicts, invalid, duplicatesInBatch,
    summary: {
      candidates: (candidates || []).length,
      toCreate: toCreate.length, toUpdate: toUpdate.length, unchanged: unchanged.length,
      conflicts: conflicts.length, invalid: invalid.length, duplicatesInBatch: duplicatesInBatch.length,
      regions, sources,
      dateRange: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null
    }
  };
}
