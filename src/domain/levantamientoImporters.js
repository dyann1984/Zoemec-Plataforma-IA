/* Registro de formatos de importacion 3D para Levantamiento IA (seccion 3A y
   8 del sprint original). Fase 1 NO implementa ningun parser real -- solo
   deja la arquitectura extensible declarada.

   Nota (portado sobre origin/main): `three` YA es una dependencia real del
   proyecto (usada por src/features/visual3d/Technical3DViewer.jsx para
   visualizar APUs). Fase 2 de Levantamiento IA no necesita agregar una
   libreria 3D nueva -- debe reusar esa misma dependencia. Technical3DViewer
   hoy solo acepta un `apu` y deriva geometria via
   src/lib/visualizationProviders.js + src/domain/geometry3d.js (cajas
   parametricas desde una cantidad de obra escalar); para visualizar un
   levantamiento real (poligonos/espacios importados) lo correcto es agregar
   un provider nuevo junto a TechnicalModelProvider en visualizationProviders.js
   que regrese el mismo contrato {ok, elements:[...]}, no modificar
   Technical3DViewer.jsx ni crear un segundo visor. */
export const SURVEY_IMPORT_FORMATS = Object.freeze([
  { id: 'glb', label: 'GLB', extensions: ['.glb'], status: 'available' },
  { id: 'gltf', label: 'GLTF', extensions: ['.gltf'], status: 'available' },
  { id: 'obj', label: 'OBJ', extensions: ['.obj'], status: 'available' }
]);

/* Formatos documentados para fases futuras, fuera de alcance de Fase 1/2:
   no tienen entrada funcional todavia, solo constancia de que la
   arquitectura los contempla (seccion 3A: "A futuro queremos soportar..."). */
export const PLANNED_FUTURE_FORMATS = Object.freeze([
  { id: 'polycam', label: 'Polycam (export)' },
  { id: 'roomplan', label: 'Apple RoomPlan' },
  { id: 'ifc', label: 'IFC' },
  { id: 'dxf_dwg', label: 'DXF / DWG' },
  { id: 'point_cloud', label: 'Nube de puntos' }
]);

export function isImportFormatAvailable(formatId){
  const format = SURVEY_IMPORT_FORMATS.find(f => f.id === formatId);
  return format?.status === 'available';
}

/* Fase 2A: tamano maximo de un archivo 3D importado (confirmado con el
   usuario: 50MB). Vive aqui, no en el modulo de carga con Three.js, porque
   es una regla de negocio pura -- debe poder probarse con node --test sin
   tocar el DOM/File real. */
export const MAX_IMPORT_FILE_SIZE_BYTES = 50 * 1024 * 1024;

/* Busca en SURVEY_IMPORT_FORMATS por extension de archivo (case-insensitive),
   SIN filtrar por status -- una extension de un formato 'planned' debe
   reportarse como "reconocido pero no disponible todavia", distinto de una
   extension que no pertenece a ningun formato conocido (ver validateImportFile). */
export function getImportFormatByFileName(fileName){
  const lower = String(fileName || '').toLowerCase();
  return SURVEY_IMPORT_FORMATS.find(f => f.extensions.some(ext => lower.endsWith(ext))) || null;
}

/* Valida un archivo antes de intentar cargarlo con Three.js (seccion
   "validacion de formato"/"tamano maximo" del pedido de Fase 2A). Pure: solo
   lee `name`/`size`, funciona igual con un File real del navegador o con un
   objeto plano en los tests. Nunca lanza -- siempre regresa {valid,errors,format}
   para que la UI muestre el mensaje exacto sin try/catch.

   Deliberadamente NO revisa `format.status` -- esa es una decision de
   disponibilidad de la FEATURE (ya cubierta por isImportFormatAvailable,
   que gatea si la opcion del wizard esta activa), no del ARCHIVO en si. Un
   archivo .glb bien formado sigue siendo un .glb valido aunque la feature
   todavia diga 'planned'; mezclar ambos checks aqui haria que este modulo
   dejara de ser probable de forma estable antes del commit de activacion. */
export function validateImportFile(file){
  const errors = [];
  const name = file?.name || '';
  const size = Number(file?.size);
  const format = getImportFormatByFileName(name);

  if(!name) errors.push('sin_nombre');
  if(!format) errors.push('formato_no_reconocido');

  if(!Number.isFinite(size) || size <= 0) errors.push('tamano_invalido');
  else if(size > MAX_IMPORT_FILE_SIZE_BYTES) errors.push('excede_tamano_maximo');

  return { valid: errors.length === 0, errors, format };
}
