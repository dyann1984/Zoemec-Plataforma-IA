/* Clasificacion y validacion compartida por los endpoints que meten archivos
   reales a la Biblioteca (api/upload-library.mjs y api/google-drive-import.mjs).
   Espejo simplificado del classify() de src/main.jsx (Library), para que un
   documento clasificado desde el navegador y uno importado desde el servidor
   caigan en la misma categoria. */

export const ALLOWED_EXTENSIONS = ['pdf', 'xlsx', 'xls', 'csv', 'docx', 'doc', 'zip', 'jpg', 'jpeg', 'png', 'webp'];

export const MIME_BY_EXT = {
  pdf: ['application/pdf'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  xls: ['application/vnd.ms-excel'],
  csv: ['text/csv', 'application/vnd.ms-excel', 'text/plain'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  doc: ['application/msword'],
  zip: ['application/zip', 'application/x-zip-compressed'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  png: ['image/png'],
  webp: ['image/webp']
};

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB: limite practico de body en funciones serverless

export function extOf(name){
  return (String(name || '').split('.').pop() || '').toLowerCase();
}

const UNSAFE_FILENAME_CHARS = new RegExp('[\\\\/<>:"|?*\\x00-\\x1f]', 'g');

export function sanitizeFileName(name){
  const raw = String(name || 'archivo').normalize('NFC');
  const clean = raw.replace(UNSAFE_FILENAME_CHARS, '_').trim();
  return clean.slice(0, 180) || 'archivo';
}

export function assertAllowedFile(input){
  const name = input && input.name;
  const mimeType = input && input.mimeType;
  const size = input && input.size;
  const ext = extOf(name);
  if(ALLOWED_EXTENSIONS.indexOf(ext) === -1){
    const error = new Error('Extension no permitida: .' + (ext || '(sin extension)') + '. Permitidas: ' + ALLOWED_EXTENSIONS.join(', ') + '.');
    error.status = 400;
    throw error;
  }
  if(size != null && Number(size) > MAX_UPLOAD_BYTES){
    const error = new Error('El archivo pesa ' + (Number(size) / 1048576).toFixed(1) + ' MB; el maximo por carga directa es ' + (MAX_UPLOAD_BYTES / 1048576).toFixed(0) + ' MB.');
    error.status = 413;
    throw error;
  }
  return ext;
}

/* Familia tecnica compartida con la Biblioteca (ver LIBRARY_DISCIPLINES en
   src/main.jsx). Clasifica por nombre de archivo cuando no hay mas contexto. */
export function classifyLibraryFile(name){
  const n = String(name || '').toLowerCase();
  const ext = extOf(name);
  if(ext === 'zip') return { cat: 'Documentos', family: 'Paquete pendiente de extraccion' };
  if(/opus|neodata/.test(n)) return { cat: 'Costos', family: 'Bases tecnicas (OPUS/NEODATA)' };
  if(/mp4|mov|avi|mkv|webm/.test(ext) || /video|tutorial|curso/.test(n)) return { cat: 'Academia', family: 'Video / curso' };
  if(/matriz|matrices|precio unitario|analisis|apu/.test(n)) return { cat: 'Matrices APU', family: 'Matrices APU' };
  if(/rendimiento|mano de obra|cuadrilla/.test(n)) return { cat: 'Mano de obra', family: 'Mano de obra' };
  if(ext === 'xlsx' || ext === 'xls' || ext === 'csv') return { cat: 'Costos', family: 'Catalogo / costos' };
  if(/norma|sct|cfe|conagua|reglamento|ntc/.test(n)) return { cat: 'Normas', family: 'Normas' };
  if(ext === 'docx' || ext === 'doc' || ext === 'pdf') return { cat: 'Formatos', family: 'Documentos y formatos' };
  if(ext === 'jpg' || ext === 'jpeg' || ext === 'png' || ext === 'webp') return { cat: 'Documentos', family: 'Imagen de referencia' };
  return { cat: 'Documentos', family: 'General' };
}
