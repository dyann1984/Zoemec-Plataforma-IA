/* Configuracion y datos de arranque/demo de la aplicacion. Sin logica, sin
   React: constantes puras que antes vivian sueltas en src/main.jsx. */

export const defaultCompany = {
  name: 'ZOEMEC', rfc: 'RFC pendiente', phone: '55 0000 0000', email: 'contacto@zoemec.mx', address: 'México', logo: '/images/logo-web.png?v=zoemec-2026'
};

export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';

export const demoCatalog = [
  { desc: 'Muro de block 15 cm', unidad: 'm²', precio: 825 },
  { desc: 'Pintura vinílica en muros', unidad: 'm²', precio: 95 },
  { desc: 'Bomba sumergible 1 HP', unidad: 'pza', precio: 12500 },
  { desc: 'Tubería PVC sanitaria 1/2"', unidad: 'm', precio: 85 }
];

// Nombres de registros sembrados en versiones anteriores del proyecto (antes de que
// existiera cuenta real por usuario). Se usan solo para depurarlos de datos reales
// preexistentes en el primer render; no se usan para mostrar contenido en la interfaz.
export const legacySeedClientNames = ['Municipio de Tlalmanalco','Grupo Residencial Volcanes','Cliente particular','Constructora del Centro','Desarrollos Industriales del Valle'];
export const legacySeedProjectNames = ['Local comercial','Rehabilitación de plaza','Casa habitación 180 m²'];

export const libraryFolders = [
  ['Bases OPUS', 'Importación y catálogos de precios unitarios', '124 archivos'],
  ['Bases NEODATA', 'Catálogos, presupuestos y formatos compatibles', '86 archivos'],
  ['Excel de precios', 'CMIC, BIMSA, ECOSTOS y bases propias', '300+ archivos'],
  ['Formatos Word / Excel', 'APU, generadores, estimaciones y bitácoras', '78 plantillas'],
  ['Normas y manuales', 'NTC, SCT, CFE, CONAGUA y reglamentos', '42 documentos'],
  ['Cursos y videos', 'Capacitación para costos, obra e ingeniería', '24 cursos']
];

export const courses = [
  ['Precios Unitarios desde cero', 'APU, indirectos, utilidad, FSR y formatos', 68],
  ['Presupuestos profesionales', 'Catálogo, partidas, explosión de insumos y reportes', 42],
  ['OPUS / NEODATA para obra', 'Importación, revisión y exportación de catálogos', 25],
  ['IA aplicada a construcción', 'Cómo generar APUs, memorias y reportes con IA', 10]
];
