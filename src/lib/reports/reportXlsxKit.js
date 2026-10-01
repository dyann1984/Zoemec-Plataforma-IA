/* F5 -- Kit XLSX COMUN del Centro de Reportes. Reusa write-excel-file (misma
   libreria de toda la app). Agrega lo que la libreria no hace:
   - bloque de encabezado de proyecto uniforme;
   - formato monetario segun la moneda del proyecto;
   - filtros automaticos (<autoFilter>) inyectados en el propio .xlsx;
   - devuelve los BYTES del archivo (las pruebas los leen de vuelta). */
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { excelCell } from '../apuExport.js';
import { BRAND, DRAFT_MARK } from './reportModels.js';

export function moneyFormat(currency = 'MXN'){
  // Mismo simbolo que el PDF (Intl es-MX): "$" solo para MXN; el resto con su codigo.
  return currency === 'MXN' || !currency ? '"$"#,##0.00' : `"${currency} "#,##0.00`;
}
export const RX = {
  title: { fontWeight: 'bold', fontSize: 14, color: '#FFFFFF', backgroundColor: '#0B2F4A', alignVertical: 'center', height: 24 },
  brand: { fontWeight: 'bold', color: '#0B2F4A' },
  label: { fontWeight: 'bold', color: '#0B2F4A', backgroundColor: '#F1F5F8' },
  value: { color: '#1C2128' },
  head: { fontWeight: 'bold', color: '#FFFFFF', backgroundColor: '#0B2F4A', align: 'center', alignVertical: 'center', wrap: true },
  group: { fontWeight: 'bold', color: '#0B2F4A', backgroundColor: '#E6EEF4' },
  subtotal: { fontWeight: 'bold', color: '#0B2F4A', backgroundColor: '#F4F7FA', topBorderColor: '#123F78', topBorderStyle: 'thin' },
  total: { fontWeight: 'bold', color: '#FFFFFF', backgroundColor: '#0B2F4A' },
  trace: { color: '#6E7680', wrap: true },
  note: { color: '#6E7680', wrap: true },
  draft: { fontWeight: 'bold', color: '#B22222', backgroundColor: '#FDECEA' },
  qty: { format: '#,##0.00' },
  qty4: { format: '#,##0.0000' },
  pct: { format: '0.0%' }
};
export const c = (value, style = {}) => ({ value, ...style });
export const pad = (row, width) => { const r = [...row]; while(r.length < width) r.push(null); return r.slice(0, Math.max(width, row.length)); };

/* Encabezado de proyecto uniforme. Devuelve { rows, headerRowIndex } donde
   headerRowIndex (1-based) es la fila de los titulos de columna de la tabla
   que se agregue a continuacion. */
export function headerBlock({ header, reportLabel, revision, draft = false, width }){
  const rows = [
    pad([c(`${reportLabel.toUpperCase()}`, { ...RX.title, columnSpan: width })], width),
    pad([c(BRAND.full, RX.brand)], width),
    pad([c('Proyecto', RX.label), c(header.proyecto, RX.value), null, c('Cliente', RX.label), c(header.cliente, RX.value)], width),
    pad([c('Ubicación', RX.label), c(header.ubicacion, RX.value), null, c('Moneda', RX.label), c(header.moneda, RX.value)], width),
    pad([c('Fecha', RX.label), c(header.fecha, RX.value), null, c('Responsable', RX.label), c(header.responsable, RX.value)], width),
    pad([c('Revisión', RX.label), c(revision || '', RX.value)], width)
  ];
  if(draft) rows.push(pad([c(DRAFT_MARK, { ...RX.draft, columnSpan: width })], width));
  rows.push(pad([], width));
  return { rows, nextRow: rows.length + 1 };
}

const colLetter = n => { let s = ''; n += 1; while(n > 0){ const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
export const cellRef = (col0, row1) => `${colLetter(col0)}${row1}`;

/* Inyecta <autoFilter> (y su nombre definido) en las hojas que lo pidan. */
export function injectAutoFilters(bytes, sheets){
  const targets = sheets.map((s, i) => ({ i, ref: s.autoFilter, name: s.sheet })).filter(t => t.ref);
  if(!targets.length) return bytes;
  const files = unzipSync(bytes);
  const defined = [];
  for(const t of targets){
    const path = `xl/worksheets/sheet${t.i + 1}.xml`;
    if(!files[path]) continue;
    let xml = strFromU8(files[path]);
    if(xml.includes('<autoFilter')) continue;
    xml = xml.replace('</sheetData>', `</sheetData><autoFilter ref="${t.ref}"/>`);
    files[path] = strToU8(xml);
    const [a, b] = t.ref.split(':').map(r => r.replace(/^([A-Z]+)(\d+)$/, '$$$1$$$2'));
    defined.push(`<definedName name="_xlnm._FilterDatabase" localSheetId="${t.i}" hidden="1">'${t.name.replace(/'/g, "''")}'!${a}:${b}</definedName>`);
  }
  if(defined.length && files['xl/workbook.xml']){
    let wb = strFromU8(files['xl/workbook.xml']);
    wb = wb.includes('<definedNames>') ? wb.replace('<definedNames>', `<definedNames>${defined.join('')}`) : wb.replace('</sheets>', `</sheets><definedNames>${defined.join('')}</definedNames>`);
    files['xl/workbook.xml'] = strToU8(wb);
  }
  return zipSync(files);
}

/* sheets: [{ sheet, rows, widths, stickyRowsCount, autoFilter }] -> Uint8Array */
export async function writeWorkbookBytes(sheets, writeImpl){
  const workbook = sheets.map(s => ({
    sheet: s.sheet, data: s.rows.map(row => row.map(excelCell)),
    columns: s.widths?.map(width => ({ width })), stickyRowsCount: s.stickyRowsCount || 0,
    orientation: s.orientation || 'portrait', showGridLines: false, zoomScale: 1
  }));
  const res = writeImpl(workbook, { fontFamily: 'Arial', fontSize: 10 });
  let bytes;
  if(res && typeof res.toBuffer === 'function') bytes = new Uint8Array(await res.toBuffer());
  else if(res && typeof res.toBlob === 'function') bytes = new Uint8Array(await (await res.toBlob()).arrayBuffer());
  else bytes = new Uint8Array(await res);
  return injectAutoFilters(bytes, sheets);
}

export function saveBytes(bytes, fileName, mime){
  const blob = new Blob([bytes], { type: mime || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName.replace(/[\\/:*?"<>|]/g, '-');
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
