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
  { id: 'glb', label: 'GLB', extensions: ['.glb'], status: 'planned' },
  { id: 'gltf', label: 'GLTF', extensions: ['.gltf'], status: 'planned' },
  { id: 'obj', label: 'OBJ', extensions: ['.obj'], status: 'planned' }
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
