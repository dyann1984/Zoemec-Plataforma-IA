/* Versionado del Construction DNA (Fase F, seccion 4 del pedido). Mismo
   patron exacto que src/domain/presupuestoVersioning.js/planoTakeoffVersioning.js
   (clonado deliberadamente, no generalizado -- ver el comentario de esos
   dos archivos: acoplar dominios distintos a una sola abstraccion cuesta
   mas de lo que ahorra). "DNA v1", "v2"... nunca se sobreescribe una
   version anterior, solo se agrega una nueva al historial. */
import { computeSnapshotHash } from './snapshotHash.js';

const clone = (value) => structuredClone(value);
const stamp = () => new Date().toISOString();

export async function createConstructionDnaVersion(snapshot, history = [], { user = 'Usuario', reason = 'Snapshot generado', at = stamp(), sources = [], engineVersion = 'construction-dna-v1' } = {}){
  const number = history.reduce((max, v) => Math.max(max, Number(String(v.version || '').replace(/\D/g, '')) || 0), 0) + 1;
  const snapshotClone = clone(snapshot);
  const hash = await computeSnapshotHash(snapshotClone);
  const previous = history[history.length - 1] || null;
  const entry = {
    version: `V${number}`, at, user, reason, sources, engineVersion, hash,
    changes: previous ? diffConstructionDna(previous.snapshot, snapshotClone) : [],
    snapshot: snapshotClone
  };
  return { snapshot: clone(entry.snapshot), history: [...history, entry], entry };
}

export async function restoreConstructionDnaVersion(entry, history, options = {}){
  if(!entry?.snapshot) throw new Error('La version seleccionada no contiene snapshot.');
  return createConstructionDnaVersion(entry.snapshot, history, { ...options, reason: options.reason || `Restauracion de ${entry.version}` });
}

/* Diff superficial por campo hoja (ver constructionDnaSchema.js#field):
   compara `value` de cada campo en las 5 secciones; un cambio de `origin`
   sin cambio de `value` tambien cuenta (ej. DETECTED -> USER_CONFIRMED es
   un cambio real de procedencia, aunque el valor no se haya tocado). Nunca
   hace un diff profundo genérico -- el DNA tiene una forma fija y conocida,
   no vale la pena una libreria de diff generica para esto. */
export function diffConstructionDna(prev, next){
  const changes = [];
  const sections = ['geometria', 'sistemaConstructivo', 'instalaciones', 'recursos', 'costos'];
  sections.forEach(section => {
    const prevSection = prev?.[section] || {};
    const nextSection = next?.[section] || {};
    const keys = new Set([...Object.keys(prevSection), ...Object.keys(nextSection)]);
    keys.forEach(key => {
      const before = prevSection[key] ?? { value: null, origin: null };
      const after = nextSection[key] ?? { value: null, origin: null };
      const beforeStr = JSON.stringify(before.value);
      const afterStr = JSON.stringify(after.value);
      if(beforeStr !== afterStr || before.origin !== after.origin){
        changes.push({ path: `${section}.${key}`, before, after });
      }
    });
  });
  return changes;
}
