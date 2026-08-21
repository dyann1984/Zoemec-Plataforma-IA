/* Extraccion real de contenido para documentos de Biblioteca (RC4).
   Cada extractor recibe un Buffer (ya descargado por google-drive.mjs u
   onedrive.mjs o subido por upload-library.mjs) y regresa texto/insumos
   reales, nunca inventados. Si el formato no es soportado o el archivo no
   se puede leer, se regresa un estado explicito en vez de fingir exito.

   contentInsumos usa exactamente el shape {desc, unidad, precio} que ya
   consume matchPrice() en src/lib/excelImport.js (motor real de matching,
   sin duplicarlo aqui): esta capa solo produce candidatos, nunca decide
   coincidencias de precio. */

import readXlsxFile from 'read-excel-file/node';
import { ensurePdfEnvPolyfills } from './_pdfEnvPolyfill.mjs';

export const MAX_CONTENT_TEXT_CHARS = 200000; // limite practico para no inflar el documento de Firestore (1 MiB por doc)
export const MAX_INSUMOS_PER_DOC = 500;

const HEADER_SCAN_ROWS = 15;
const DESC_HEADER_RE = /descrip|concepto|insumo|material|partida/;
const PRICE_HEADER_RE = /precio|costo|unitario|importe|p\.?u\b/;
const UNIT_HEADER_RE = /unidad|u\.m\b|^u$/;
const CODE_HEADER_RE = /clave|codigo|c[oó]digo/;

function toCell(v){
  if(v == null) return '';
  if(v instanceof Date) return v.toISOString().slice(0,10);
  return String(v).trim();
}

const UNIT_LABEL_RE = /^(m2|m²|m3|m³|kg|pza|pieza|ml|l|lote|jgo|hr|día|dia|u)$/i;

function toNumber(v){
  const raw = toCell(v).trim();
  // Etiquetas de unidad como "m3"/"m2" contienen digitos (el "3"/"2") y no
  // deben leerse como precio: sin este descarte, la heuristica posicional de
  // respaldo confundia la columna de unidad con la de precio.
  if(UNIT_LABEL_RE.test(raw)) return NaN;
  const n = parseFloat(raw.replace(/[^0-9.\-]/g,''));
  return Number.isFinite(n) ? n : NaN;
}

/* Heuristica de extraccion propia para Biblioteca (independiente de
   parseCatalogRows de excelImport.js, que es codigo de navegador con
   dependencias de browser y no se puede importar tal cual en una funcion
   serverless). No es un "segundo motor de matching": esto solo propone
   candidatos con confianza <100%, la decision de que precio usar sigue
   siendo matchPrice() del lado del cliente sobre insumos ya VALIDADOS. */
export function rowsToInsumos(rows){
  const out = [];
  if(!Array.isArray(rows) || !rows.length) return out;
  let headerRow = -1, cDesc = -1, cPrice = -1, cUnit = -1, cCode = -1;
  for(let i = 0; i < Math.min(rows.length, HEADER_SCAN_ROWS); i++){
    const cells = (rows[i] || []).map(v => toCell(v).toLowerCase());
    const d = cells.findIndex(x => DESC_HEADER_RE.test(x));
    const p = cells.findIndex(x => PRICE_HEADER_RE.test(x));
    if(d > -1 && p > -1){
      headerRow = i; cDesc = d; cPrice = p;
      cUnit = cells.findIndex(x => UNIT_HEADER_RE.test(x));
      cCode = cells.findIndex(x => CODE_HEADER_RE.test(x));
      break;
    }
  }
  const start = headerRow > -1 ? headerRow + 1 : 0;
  for(let i = start; i < rows.length && out.length < MAX_INSUMOS_PER_DOC; i++){
    const row = rows[i] || [];
    let desc, unidad, precio, clave;
    if(cDesc > -1){
      desc = toCell(row[cDesc]);
      unidad = cUnit > -1 ? toCell(row[cUnit]) : '';
      precio = toNumber(row[cPrice]);
      clave = cCode > -1 ? toCell(row[cCode]) : '';
    }else{
      desc = toCell(row[0]);
      unidad = toCell(row[1]);
      const numericCell = row.find((v, idx) => idx > 0 && Number.isFinite(toNumber(v)) && toNumber(v) > 0);
      precio = numericCell != null ? toNumber(numericCell) : NaN;
    }
    if(desc && Number.isFinite(precio) && precio > 0){
      out.push({
        desc,
        unidad: unidad || '',
        precio,
        clave: clave || '',
        rowRef: i + 1,
        // Confianza baja porque es un candidato sin revision humana: nunca se
        // presenta como precio verificado (Fase 3). Sube un poco si la hoja
        // tenia encabezados reconocibles (headerRow>-1) frente a la
        // heuristica posicional de respaldo.
        confidence: headerRow > -1 ? 65 : 40
      });
    }
  }
  return out;
}

/* read-excel-file/node regresa un arreglo de HOJAS ({sheet,data}), no un
   arreglo plano de filas (a diferencia de lo que recibe rowsToInsumos). Se
   aplana concatenando todas las hojas, con una fila separadora entre ellas
   para no mezclar columnas de una hoja con la siguiente. */
function flattenSheets(sheets){
  const rows = [];
  (Array.isArray(sheets) ? sheets : []).forEach((sheet, i) => {
    const data = Array.isArray(sheet?.data) ? sheet.data : (Array.isArray(sheet) ? sheet : []);
    if(i > 0 && rows.length) rows.push([]);
    data.forEach(row => rows.push(Array.isArray(row) ? row : [row]));
  });
  return rows;
}

export async function extractExcelInsumos(buffer){
  const sheets = await readXlsxFile(buffer);
  const rows = flattenSheets(sheets);
  const insumos = rowsToInsumos(rows);
  return {
    status: insumos.length ? 'done' : 'empty',
    method: 'excel',
    contentInsumos: insumos,
    contentText: '',
    error: insumos.length ? '' : 'No se detectaron filas con descripcion y precio reconocibles.'
  };
}

export async function extractCsvInsumos(buffer){
  const text = buffer.toString('utf8');
  const rows = text.split(/\r?\n/).filter(l => l.trim()).map(line => {
    // CSV simple (sin comillas escapadas complejas): suficiente para
    // catalogos de precios reales, que son tabulares y sin texto libre.
    return line.split(',').map(c => c.replace(/^"|"$/g,''));
  });
  const insumos = rowsToInsumos(rows);
  return {
    status: insumos.length ? 'done' : 'empty',
    method: 'csv',
    contentInsumos: insumos,
    contentText: '',
    error: insumos.length ? '' : 'No se detectaron filas con descripcion y precio reconocibles.'
  };
}

/* Extraccion de texto de PDF usando SOLO la API de texto de pdfjs-dist
   (getTextContent), nunca su ruta de renderizado a imagen: esa ruta es la
   unica que requiere @napi-rs/canvas (dependencia nativa opcional). Al no
   importarla nunca desde aqui, el bundler de Vercel no la incluye en la
   funcion serverless. Probado de forma aislada antes de integrarse (PDF real
   generado con jsPDF, texto recuperado exacto). No sirve para planos
   escaneados (esos son imagen, no texto) — eso es alcance de Planos IA
   (Fase 2), no de este extractor. */
/* Cuenta paginas de un PDF sin renderizar nada (solo estructura del
   documento, misma API/import que extractPdfText). Reutilizado por Planos IA
   / Takeoff (api/visual-ai.mjs) para aplicar el tope de MAX_PAGES_PER_ANALYSIS
   antes de gastar una llamada a OpenAI. */
export async function countPdfPages(buffer){
  ensurePdfEnvPolyfills();
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(buffer);
  const task = getDocument({ data, useWorkerFetch: false, isEvalSupported: false, disableFontFace: true });
  const pdf = await task.promise;
  return pdf.numPages;
}

export async function extractPdfText(buffer){
  ensurePdfEnvPolyfills();
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(buffer);
  let pdf;
  try{
    const task = getDocument({ data, useWorkerFetch: false, isEvalSupported: false, disableFontFace: true });
    pdf = await task.promise;
  }catch(err){
    return { status: 'error', method: 'pdf-text', contentText: '', contentInsumos: [], error: err.message || 'No se pudo abrir el PDF.' };
  }
  let fullText = '';
  const maxPages = Math.min(pdf.numPages, 200); // tope defensivo: PDFs de miles de paginas no deben colgar la funcion serverless
  for(let i = 1; i <= maxPages; i++){
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    fullText += content.items.map(it => it.str).join(' ') + '\n';
    if(fullText.length > MAX_CONTENT_TEXT_CHARS) break;
  }
  const trimmed = fullText.trim();
  return {
    status: trimmed ? 'done' : 'empty',
    method: 'pdf-text',
    contentText: trimmed.slice(0, MAX_CONTENT_TEXT_CHARS),
    contentInsumos: [],
    error: trimmed ? '' : 'El PDF no contiene texto extraible (posible plano/escaneo: fuera de alcance de este extractor).'
  };
}

const EXCEL_EXT = new Set(['xlsx','xls']);

export async function extractLibraryContent({ buffer, ext }){
  const e = String(ext || '').toLowerCase();
  try{
    if(EXCEL_EXT.has(e)) return await extractExcelInsumos(buffer);
    if(e === 'csv') return await extractCsvInsumos(buffer);
    if(e === 'pdf') return await extractPdfText(buffer);
    return { status: 'unsupported', method: 'none', contentText: '', contentInsumos: [], error: `Extraccion no soportada para .${e || '(sin extension)'} en este MVP.` };
  }catch(err){
    return { status: 'error', method: 'none', contentText: '', contentInsumos: [], error: err.message || 'Error inesperado durante la extraccion.' };
  }
}
