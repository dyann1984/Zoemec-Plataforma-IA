/* ---------- Importación real de Excel + emparejado de precios ----------
   Modulo puro: sin React ni estado de UI. Solo parsing de archivos y texto. */
import readXlsxFile from 'read-excel-file/browser';
import { unzipSync, strFromU8 } from 'fflate';

export function tokenize(s){return (s||'').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').split(/[^a-z0-9]+/).filter(w=>w.length>2);}
export function jaccard(a,b){const A=new Set(a),B=new Set(b);let inter=0;A.forEach(x=>{if(B.has(x))inter++;});const uni=new Set([...a,...b]).size||1;return inter/uni;}
export function matchPrice(desc,catalog){ if(!catalog||!catalog.length) return null; const dt=tokenize(desc); let best=null,bs=0; for(const it of catalog){const s=jaccard(dt,tokenize(it.desc)); if(s>bs){bs=s;best=it;}} return bs>=0.34?best:null; }
export function parseExcelToCatalog(file){
  const name=(file?.name||'').toLowerCase();
  if(name.endsWith('.csv')){
    return file.text().then(text=>parseCatalogRows(parseCSV(text)));
  }
  return readSpreadsheetRows(file).then(parseCatalogRows);
}
export function parseXml(text){
  return new DOMParser().parseFromString(text, 'application/xml');
}
export function xmlText(node){
  if(!node) return '';
  return Array.from(node.getElementsByTagName('t')).map(t=>t.textContent || '').join('');
}
export function colIndexFromRef(ref=''){
  const letters = String(ref).match(/[A-Z]+/i)?.[0]?.toUpperCase() || '';
  let index = 0;
  for(let i=0;i<letters.length;i++) index = index * 26 + (letters.charCodeAt(i) - 64);
  return Math.max(0, index - 1);
}
export function numericSheetSort(a,b){
  const an = Number(a.match(/sheet(\d+)\.xml$/i)?.[1] || 0);
  const bn = Number(b.match(/sheet(\d+)\.xml$/i)?.[1] || 0);
  return an - bn || a.localeCompare(b);
}
/* Mapea el orden REAL de declaracion de hojas (xl/workbook.xml, <sheet name="..."
   r:id="rIdN"/>) contra sus archivos xl/worksheets/sheetM.xml a traves de las
   relaciones (xl/_rels/workbook.xml.rels, rIdN -> Target). El nombre de archivo
   sheetM.xml NO siempre coincide con el orden de declaracion (Excel/Google Sheets
   pueden reordenar hojas sin renombrar sus archivos internos), asi que ordenar
   solo por numero de archivo (numericSheetSort) puede asignarle el nombre de hoja
   equivocado a un bloque de filas. Si no se puede resolver el mapa real (rels
   ausentes o formato inesperado), se cae de vuelta al orden por nombre de archivo
   con nombres vacios, igual que el comportamiento anterior. */
function readWorkbookSheetOrder(zip, readZipText){
  try{
    const workbookXml = readZipText('xl/workbook.xml');
    const relsXml = readZipText('xl/_rels/workbook.xml.rels');
    if(!workbookXml || !relsXml) return null;
    const relMap = new Map();
    for(const m of relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/?>/g)){
      relMap.set(m[1], m[2].replace(/^\/?xl\//,''));
    }
    const declared = [...workbookXml.matchAll(/<sheet\b[^>]*name="([^"]*)"[^>]*r:id="([^"]+)"[^>]*\/?>/g)]
      .map(m => ({ name: m[1], rId: m[2] }));
    if(!declared.length) return null;
    const order = declared.map(({name, rId}) => {
      const target = relMap.get(rId);
      if(!target) return null;
      const path = target.startsWith('worksheets/') ? `xl/${target}` : `xl/worksheets/${target.split('/').pop()}`;
      return { name, path };
    }).filter(Boolean);
    return order.length ? order : null;
  }catch{
    return null;
  }
}
export async function readXlsxXmlSheetBlocks(file){
  const zip = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const readZipText = (path) => zip[path] ? strFromU8(zip[path]) : '';
  const sharedDoc = readZipText('xl/sharedStrings.xml') ? parseXml(readZipText('xl/sharedStrings.xml')) : null;
  const sharedStrings = sharedDoc
    ? Array.from(sharedDoc.getElementsByTagName('si')).map(si => xmlText(si))
    : [];
  const declaredOrder = readWorkbookSheetOrder(zip, readZipText);
  const sheetOrder = declaredOrder || Object.keys(zip)
    .filter(path => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path))
    .sort(numericSheetSort)
    .map(path => ({ name:'', path }));
  return sheetOrder.map(({name, path}) => {
    const doc = parseXml(readZipText(path));
    const rowNodes = Array.from(doc.getElementsByTagName('row'));
    const rows = [];
    rowNodes.forEach(rowNode => {
      const rowIndex = Number(rowNode.getAttribute('r') || 0) || (rows.length + 1);
      const row = [];
      Array.from(rowNode.getElementsByTagName('c')).forEach(cell => {
        const ref = cell.getAttribute('r') || '';
        const idx = colIndexFromRef(ref);
        const type = cell.getAttribute('t') || '';
        const vNode = cell.getElementsByTagName('v')[0];
        const raw = vNode?.textContent ?? '';
        let value = raw;
        if(type === 's') value = sharedStrings[Number(raw)] ?? '';
        else if(type === 'inlineStr') value = xmlText(cell);
        else if(type === 'str') value = raw;
        else if(raw !== ''){
          const n = Number(raw);
          value = Number.isFinite(n) ? n : raw;
        }
        row[idx] = cleanText(value);
      });
      rows[rowIndex - 1] = row.map(cell => cell == null ? '' : cell);
    });
    return { sheetName: name, rows: rows.map(r => r || []) };
  });
}
export async function readXlsxXmlRows(file){
  const zip = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const readZipText = (path) => zip[path] ? strFromU8(zip[path]) : '';
  const sharedDoc = readZipText('xl/sharedStrings.xml') ? parseXml(readZipText('xl/sharedStrings.xml')) : null;
  const sharedStrings = sharedDoc
    ? Array.from(sharedDoc.getElementsByTagName('si')).map(si => xmlText(si))
    : [];
  const sheetPaths = Object.keys(zip).filter(path => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path)).sort(numericSheetSort);
  const allRows = [];
  sheetPaths.forEach((path, sheetIndex) => {
    const doc = parseXml(readZipText(path));
    const rows = Array.from(doc.getElementsByTagName('row'));
    if(sheetIndex > 0 && allRows.some(row => row.some(cell => String(cell ?? '').trim()))) allRows.push([]);
    rows.forEach(rowNode => {
      const row = [];
      Array.from(rowNode.getElementsByTagName('c')).forEach(cell => {
        const ref = cell.getAttribute('r') || '';
        const idx = colIndexFromRef(ref);
        const type = cell.getAttribute('t') || '';
        const vNode = cell.getElementsByTagName('v')[0];
        const raw = vNode?.textContent ?? '';
        let value = raw;
        if(type === 's') value = sharedStrings[Number(raw)] ?? '';
        else if(type === 'inlineStr') value = xmlText(cell);
        else if(type === 'str') value = raw;
        else if(raw !== ''){
          const n = Number(raw);
          value = Number.isFinite(n) ? n : raw;
        }
        row[idx] = cleanText(value);
      });
      allRows.push(row.map(cell => cell == null ? '' : cell));
    });
  });
  return normalizeSpreadsheetRows(allRows);
}
export async function readSpreadsheetRows(file){
  const name=(file?.name||'').toLowerCase();
  if(name.endsWith('.csv')) return normalizeSpreadsheetRows(parseCSV(await file.text()));
  const primary = await readXlsxFile(file).then(normalizeSpreadsheetRows).catch(()=>[]);
  const meaningful = primary.filter(row => (row || []).some(cell => String(cell ?? '').trim())).length;
  if(meaningful > 5) return primary;
  return readXlsxXmlRows(file);
}
/* Igual que readSpreadsheetRows, pero SIN aplanar todas las hojas en un solo
   arreglo: cada hoja se conserva como un bloque propio {sheetName, rows}, con
   numeros de fila reales (1-indexados) dentro de esa hoja. Necesario para
   catalogos reales con varias hojas candidatas del mismo catalogo (p. ej.
   "... P.U. PROFORMA" y "... P.U. VENTA"): procesar cada hoja por separado
   evita que el encabezado repetido de una segunda hoja se cuele como fila de
   datos de la primera (ver extractConceptsFromSheetRows), y conserva la
   identidad sourceSheet+rowNumber que pide la trazabilidad de un catalogo
   masivo (claves repetidas en renglones distintos nunca deben fusionarse). */
export async function readSpreadsheetSheetBlocks(file){
  const name=(file?.name||'').toLowerCase();
  if(name.endsWith('.csv')){
    const rows = normalizeSpreadsheetRows(parseCSV(await file.text()));
    return [{ sheetName:'', rows }];
  }
  const raw = await readXlsxFile(file).catch(()=>null);
  if(Array.isArray(raw) && raw.length && raw.every(r => r && Array.isArray(r.data))){
    return raw.map(s => ({
      sheetName: s.sheet || '',
      rows: (s.data || []).map(row => Array.isArray(row) ? row.map(cell => cell == null ? '' : cell) : [row])
    }));
  }
  if(Array.isArray(raw)){
    const normalized = normalizeSpreadsheetRows(raw);
    const meaningful = normalized.filter(row => (row || []).some(cell => String(cell ?? '').trim())).length;
    if(meaningful > 5) return [{ sheetName:'', rows: normalized }];
  }
  return readXlsxXmlSheetBlocks(file);
}
export function normalizeSpreadsheetRows(rows){
  const source = Array.isArray(rows) ? rows : [];
  const expanded = [];
  const hasContent = () => expanded.some(r => (r || []).some(cell => String(cell ?? '').trim()));
  source.forEach((row, sheetIndex) => {
    if(Array.isArray(row)){
      expanded.push(row);
      return;
    }
    if(row && Array.isArray(row.data)){
      // Cada elemento aqui es una HOJA completa (formato {sheet,data} de read-excel-file).
      // Se inserta un renglon separador entre hojas para no mezclar columnas de una
      // hoja con la siguiente cuando el detector de encabezados corre sobre todo el arreglo.
      if(sheetIndex > 0 && hasContent()) expanded.push([]);
      row.data.forEach(inner => expanded.push(Array.isArray(inner) ? inner : [inner]));
      return;
    }
    if(row && typeof row === 'object'){
      expanded.push(Object.values(row));
      return;
    }
    expanded.push([row]);
  });
  return expanded
    .map(row => row.map(cell => cell == null ? '' : cell));
}
export function cleanText(v){
  const fixes = [
    ['\u00C3\u00A1','\u00E1'], ['\u00C3\u00A9','\u00E9'], ['\u00C3\u00AD','\u00ED'], ['\u00C3\u00B3','\u00F3'], ['\u00C3\u00BA','\u00FA'], ['\u00C3\u00B1','\u00F1'],
    ['\u00C3\u0081','\u00C1'], ['\u00C3\u0089','\u00C9'], ['\u00C3\u008D','\u00CD'], ['\u00C3\u0093','\u00D3'], ['\u00C3\u009A','\u00DA'], ['\u00C3\u0091','\u00D1'],
    ['\u00C3\u00BC','\u00FC'], ['\u00C3\u009C','\u00DC'], ['\u00C2\u00BF','\u00BF'], ['\u00C2\u00A1','\u00A1'], ['\u00C2\u00B0','\u00B0'],
    ['\u00C2\u00B2','\u00B2'], ['\u00C2\u00B3','\u00B3'], ['\u00C3\u201A\u00C2\u00B2','\u00B2'], ['\u00C3\u201A\u00C2\u00B3','\u00B3'],
    ['m\u00C3\u0192\u00E2\u20AC\u0161\u00C2\u00B2','m\u00B2'], ['m\u00C3\u0192\u00E2\u20AC\u0161\u00C2\u00B3','m\u00B3'], ['m\u00C3\u201A\u00C2\u00B2','m\u00B2'], ['m\u00C3\u201A\u00C2\u00B3','m\u00B3'], ['m\u00C2\u00B2','m\u00B2'], ['m\u00C2\u00B3','m\u00B3'],
    ['d\u00C3\u0192\u00C6\u2019\u00C3\u201A\u00C2\u00ADa','d\u00EDa'], ['d\u00C3\u00ADa','d\u00EDa'], ['\u00C3\u00ADa','\u00EDa'],
    ['\u00E2\u20AC\u201C','-'], ['\u00E2\u20AC\u201D','-'], ['\u00E2\u20AC\u00A2','\u2022'], ['\u00E2\u20AC\u00A6','...'],
    ['\u00E2\u20AC\u02DC',"'"], ['\u00E2\u20AC\u2122',"'"], ['\u00E2\u20AC\u0153','"'], ['\u00E2\u20AC\u009D','"'], ['\u00E2\u20AC','"'],
    ['\u00C2\u00B7','\u00B7'], ['\u00C2','']
  ];
  let text = String(v ?? '');
  fixes.forEach(([bad, good]) => { text = text.split(bad).join(good); });
  return text.normalize('NFC');
}
export function normalizeUnitLabel(v){
  const raw = cleanText(v).trim();
  if(/^(m2|m²)$/i.test(raw)) return 'm²';
  if(/^(m3|m³)$/i.test(raw)) return 'm³';
  if(/^dia$/i.test(raw)) return 'día';
  if(/^pza$/i.test(raw)) return 'pza';
  if(/^ml$/i.test(raw)) return 'ml';
  return raw || 'u';
}
export async function parseExcelToAPU(file, currentCatalog=[]){
  const rows = await readSpreadsheetRows(file);
  const catalog = parseCatalogRows(rows);
  const flatRows = normalizeSpreadsheetRows(rows)
    .map((row, index)=>({ index, cells:(row||[]).map(v=>v==null?'':String(v).trim()).filter(Boolean) }))
    .filter(r=>r.cells.length);
  const conceptRow = flatRows.find(r=>/concepto|descripci[oó]n|partida/.test(r.cells.join(' ').toLowerCase()))
    || flatRows.find(r=>r.cells.join(' ').length > 35)
    || flatRows[0];
  const numeric = (value)=>{
    const raw=String(value ?? '').trim();
    if(/^(m2|m²|m3|m³|kg|pza|pieza|ml|l|lote|jgo|hr)$/i.test(raw)) return NaN;
    return parseFloat(raw.replace(/[^0-9.\-]/g,''));
  };
  const conceptCells = conceptRow?.cells || [];
  const unit = conceptCells.find(c=>/^(m2|m²|m3|m³|kg|pza|pieza|ml|l|lote|jgo|hr)$/i.test(c)) || '';
  const nums = conceptCells.map(numeric).filter(n=>!Number.isNaN(n) && n>0);
  const rawConcept = conceptCells
    .filter(c=>Number.isNaN(numeric(c)) && !/^(m2|m²|m3|m³|kg|pza|pieza|ml|l|lote|jgo|hr)$/i.test(c))
    .join(' ')
    .replace(/concepto|descripci[oó]n|partida/ig,'')
    .replace(/\s+/g,' ')
    .trim();
  const merged = mergeCatalogs(currentCatalog, catalog);
  return {
    rows,
    catalog,
    mergedCatalog: merged,
    concept: rawConcept || 'Concepto importado desde Excel',
    unit: unit || 'm²',
    qty: nums[0] || 1,
    referencePU: nums.length>1 ? nums[nums.length-1] : 0,
    fileName: file?.name || 'Excel importado'
  };
}
export async function parseExcelConcepts(file){
  const rows = await readSpreadsheetRows(file);
  const normalized = normalizeSpreadsheetRows(rows);
  let header = -1;
  let cCode = -1, cConcept = -1, cUnit = -1, cQty = -1, cPU = -1, cImporte = -1;
  const clean = (v) => String(v ?? '').trim();
  const asNumber = (v) => {
    if(v == null || v === '') return 0;
    if(typeof v === 'number') return v;
    const n = parseFloat(String(v).replace(/[^0-9.\-]/g,''));
    return Number.isFinite(n) ? n : 0;
  };
  for(let i=0;i<Math.min(normalized.length,60);i++){
    const r = normalized[i].map(v=>clean(v).toLowerCase());
    const conceptIdx = r.findIndex(x=>/concepto|descripci[oó]n/.test(x));
    const unitIdx = r.findIndex(x=>/^(und\.?|unidad|u\.m\.?)$/.test(x));
    const qtyIdx = r.findIndex(x=>/cantidad|cant\.?/.test(x));
    const puIdx = r.findIndex(x=>/^(p\.?u\.?|precio unitario|precio|p u)$/.test(x));
    const importeIdx = r.findIndex(x=>/importe|total/.test(x));
    if(conceptIdx>-1 && unitIdx>-1 && qtyIdx>-1){
      header = i;
      cConcept = conceptIdx;
      cUnit = unitIdx;
      cQty = qtyIdx;
      cPU = puIdx;
      cImporte = importeIdx;
      cCode = r.findIndex(x=>/codigo|c[oó]digo|clave/.test(x));
      break;
    }
  }
  if(header < 0) throw new Error('No detecte encabezados de catalogo con Concepto, Unidad y Cantidad.');
  const concepts = [];
  for(let i=header+1;i<normalized.length;i++){
    const row = normalized[i] || [];
    const code = clean(row[cCode]);
    const concept = clean(row[cConcept]);
    const unit = clean(row[cUnit]).replace(/^M2$/i,'m²').replace(/^M3$/i,'m³') || 'u';
    const qty = asNumber(row[cQty]) || 1;
    let pu = cPU>-1 ? asNumber(row[cPU]) : 0;
    const importe = cImporte>-1 ? asNumber(row[cImporte]) : 0;
    if(!pu && importe && qty) pu = importe / qty;
    const looksLikeSection = !code && concept && concept.length < 50 && concept === concept.toUpperCase();
    if(!concept || looksLikeSection) continue;
    if(concept.length < 12 || !unit) continue;
    concepts.push({
      code: code || `CON-${String(concepts.length+1).padStart(3,'0')}`,
      concept,
      unit,
      qty,
      referencePU: pu,
      importe
    });
  }
  if(!concepts.length) throw new Error('No encontre conceptos validos debajo del encabezado.');
  return { fileName:file?.name || 'Catalogo importado', rows:normalized, concepts };
}
/* Identidad de un concepto extraido de UN catalogo real: nunca el contenido
   (clave/concepto/cantidad), sino la posicion fisica (hoja + numero de fila)
   -- un catalogo real puede repetir la misma clave en renglones distintos con
   cantidades iguales o distintas (el mismo trabajo en dos areas del
   inmueble) y ninguno de esos renglones debe fusionarse jamas solo porque
   coincida el contenido. La UNICA fusion valida es entre HOJAS que
   representan el mismo catalogo con otro precio (p. ej. "... P.U. PROFORMA"
   y "... P.U. VENTA"): ver dedupeAcrossSheets, que compara contenido pero
   SOLO entre hojas distintas, nunca dentro de la misma hoja. */
function dedupeAcrossSheets(perSheetResults){
  const seenFromPriorSheets = new Set();
  const merged = [];
  (perSheetResults || []).forEach(({ concepts }) => {
    const thisSheetKeys = new Set();
    (concepts || []).forEach(item => {
      const key = [
        item.code,
        item.concept.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,''),
        item.unit,
        Number(item.qty).toFixed(4)
      ].join('|');
      if(!seenFromPriorSheets.has(key)){
        merged.push(item);
      }
      thisSheetKeys.add(key);
    });
    thisSheetKeys.forEach(k => seenFromPriorSheets.add(k));
  });
  return merged;
}
/* Extrae los conceptos de UNA sola hoja ya normalizada (nunca de varias hojas
   concatenadas): asi el encabezado repetido de una segunda hoja candidata
   jamas se procesa como si fuera un renglon de datos de la primera (antes,
   al concatenar todas las hojas en un solo arreglo, el encabezado de la
   segunda hoja caia dentro del rango de datos de la primera y se
   malinterpretaba como una "seccion" espuria, ensuciando la trazabilidad de
   los renglones de esa segunda hoja). */
export function extractConceptsFromSheetRows(normalized, sheetName=''){
  const clean = (v) => cleanText(v).trim();
  const norm = (v) => clean(v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
  const unitRe = /^(m2|m²|m3|m³|kg|ton|tonelada|pza|pieza|pzas|ml|m|l|lt|lote|jgo|hr|hora|dia|día|jor|jornal|serv|servicio|sal|salida|salidas)$/i;
  const normalizeUnit = (v) => {
    const raw = clean(v);
    if(/^m2$/i.test(raw)) return 'm²';
    if(/^m3$/i.test(raw)) return 'm³';
    if(/^dia$/i.test(raw)) return 'día';
    return raw || 'u';
  };
  const asNumber = (v) => {
    if(v == null || v === '') return 0;
    if(typeof v === 'number') return v;
    let raw = String(v).trim();
    if(!raw || raw.startsWith('=')) return 0;
    raw = raw.replace(/[^0-9,.\-]/g,'');
    if(raw.includes(',') && !raw.includes('.')) raw = raw.replace(',', '.');
    else raw = raw.replace(/,/g, '');
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : 0;
  };
  const isNoiseConcept = (text) => {
    const value = norm(text).replace(/\s+/g,' ').trim();
    if(!value) return true;
    if(/^(presupuesto|catalogo|catalogo de conceptos|cedula|analisis|analisis de precio unitario|total|subtotal|gran total|importe|concepto|descripcion|clave|codigo|unidad|cantidad|precio unitario|pu|p u)$/.test(value)) return true;
    if(/^(materiales|mano de obra|equipo|herramienta|maquinaria|resumen|notas|familia|partida)$/.test(value)) return true;
    if(/^(total|subtotal|gran total)\b/.test(value)) return true;
    if(/\b(total partida|total zona|total area|total capitulo|total capitulo|subtotal partida|gran total)\b/.test(value)) return true;
    return false;
  };
  const addConcept = (list, item) => {
    const concept = clean(item.concept).replace(/\s+/g,' ');
    if(isNoiseConcept(concept) || concept.length < 12) return;
    const rawUnit = clean(item.unit);
    if(!unitRe.test(rawUnit)) return;
    const rawQty = Number(item.qty) || 0;
    if(rawQty <= 0) return;
    const unit = normalizeUnitLabel(normalizeUnit(rawUnit));
    const qty = rawQty;
    let referencePU = Number(item.referencePU) || 0;
    const importe = Number(item.importe) || 0;
    const derivedPU = importe && qty ? importe / qty : 0;
    if(derivedPU && (!referencePU || referencePU <= 1 || referencePU < derivedPU * 0.25)) referencePU = derivedPU;
    // Sin deduplicacion por contenido aqui: dentro de UNA hoja, cada renglon
    // fisico valido se conserva siempre (identidad = hoja + numero de fila),
    // aunque otro renglon ya tenga la misma clave/concepto/cantidad (un
    // catalogo real repite claves legitimamente). La unica fusion de
    // duplicados ocurre entre hojas distintas (dedupeAcrossSheets).
    list.push({
      code: clean(item.code) || `CON-${String(list.length+1).padStart(3,'0')}`,
      concept,
      unit,
      qty,
      referencePU,
      importe,
      section: clean(item.section),
      sourceSheet: sheetName || '',
      rowNumber: Number(item.rowNumber || 0) || list.length + 1
    });
  };
  const looksLikeItemRow = (row) => {
    const code = clean(row[cCode]);
    const concept = clean(row[cConcept]);
    const unit = cUnit > -1 ? clean(row[cUnit]) : '';
    const qty = cQty > -1 ? asNumber(row[cQty]) : 0;
    return Boolean(concept && !isNoiseConcept(concept) && unitRe.test(unit) && qty > 0);
  };
  const looksLikeContinuationRow = (row) => {
    const code = cCode > -1 ? clean(row[cCode]) : '';
    const concept = cConcept > -1 ? clean(row[cConcept]) : '';
    const unit = cUnit > -1 ? clean(row[cUnit]) : '';
    const qty = cQty > -1 ? asNumber(row[cQty]) : 0;
    const pu = cPU > -1 ? asNumber(row[cPU]) : 0;
    const importe = cImporte > -1 ? asNumber(row[cImporte]) : 0;
    return Boolean(!code && concept && concept.length > 4 && !unitRe.test(unit) && !qty && !pu && !importe && !isNoiseConcept(concept));
  };
  // Encabezados reales casi siempre agregan un calificativo despues de "P.U."
  // o "Unidad" (p. ej. "P.U. PROFORMA", "P.U. VENTA", "PRECIO UNITARIO CON
  // IVA", "Unidad de medida"): una coincidencia exacta anclada nunca los
  // reconoce. Se compara sin puntos y permitiendo texto adicional despues
  // del prefijo esperado.
  const startsWithHeaderPrefix = (text, prefixes) => {
    const flat = text.replace(/\./g,'').replace(/\s+/g,' ').trim();
    return prefixes.some(p => flat === p || flat.startsWith(p + ' '));
  };
  let header = -1;
  let cCode = -1, cConcept = -1, cUnit = -1, cQty = -1, cPU = -1, cImporte = -1;
  // Mejor candidato PARCIAL visto mientras se busca un encabezado completo:
  // permite un diagnostico util ("encontre Descripcion en la fila N pero
  // ninguna Unidad ni Cantidad") en vez de un error generico cuando ninguna
  // fila junta las tres columnas minimas.
  let bestPartial = null;
  const rowsScanned = Math.min(normalized.length, 120);
  for(let i=0;i<rowsScanned;i++){
    const row = normalized[i].map(norm);
    const conceptIdx = row.findIndex(x=>/concepto|descripcion|descrip/.test(x));
    const unitIdx = row.findIndex(x=>startsWithHeaderPrefix(x, ['unidad','und','u m','um']));
    const qtyIdx = row.findIndex(x=>/cantidad|cant\.?|volumen|cantid/.test(x));
    const puIdx = row.findIndex(x=>startsWithHeaderPrefix(x, ['pu','p u','precio unitario','precio','costo unitario']));
    const importeIdx = row.findIndex(x=>/importe|total|monto/.test(x));
    if(conceptIdx > -1 && !bestPartial){
      bestPartial = { row: i, unitIdx, qtyIdx };
    }
    if(conceptIdx > -1 && (unitIdx > -1 || qtyIdx > -1)){
      header = i;
      cConcept = conceptIdx;
      cUnit = unitIdx;
      cQty = qtyIdx;
      cPU = puIdx;
      cImporte = importeIdx;
      cCode = row.findIndex(x=>/codigo|clave|^no\.?$|^numero$|^num\.?$|partida/.test(x));
      break;
    }
  }
  const concepts = [];
  if(header >= 0){
    let pending = null;
    let section = '';
    const flush = () => {
      if(pending){
        addConcept(concepts, pending);
        pending = null;
      }
    };
    for(let i=header+1;i<normalized.length;i++){
      const row = normalized[i] || [];
      const concept = cConcept > -1 ? clean(row[cConcept]) : '';
      const code = cCode > -1 ? clean(row[cCode]) : '';
      const unit = cUnit > -1 ? clean(row[cUnit]) : '';
      const qty = cQty > -1 ? asNumber(row[cQty]) : 0;
      const pu = cPU > -1 ? asNumber(row[cPU]) : 0;
      const importe = cImporte > -1 ? asNumber(row[cImporte]) : 0;
      const looksLikeSection = concept && !unitRe.test(unit) && !qty && !pu && !importe && concept.length < 80 && concept === concept.toUpperCase();
      if(looksLikeItemRow(row)){
        flush();
        pending = { code, concept, unit, qty, referencePU:pu, importe, section, rowNumber:i+1 };
        continue;
      }
      if(pending && looksLikeContinuationRow(row)){
        pending.concept = `${pending.concept} ${concept}`;
        continue;
      }
      if(looksLikeSection){
        flush();
        section = code ? `${code} ${concept}` : concept;
      }
    }
    flush();
  }
  // Sin respaldo posicional: si ninguna fila junta descripcion/concepto +
  // (unidad o cantidad), NO se adivinan columnas por posicion (requisito
  // explicito: la confianza estructural insuficiente debe reportarse, nunca
  // completarse con una suposicion). El diagnostico es estructurado (hoja,
  // filas inspeccionadas, fila de encabezado candidata, y que columna
  // minima si/no se reconocio) para que el motivo de rechazo sea accionable
  // sin tener que adivinar -- ver formatCatalogDiagnostic.
  let diagnostic = null;
  if(header < 0){
    if(bestPartial){
      diagnostic = {
        sheetName,
        rowsScanned,
        headerRow: bestPartial.row + 1,
        descriptionFound: true,
        unitFound: bestPartial.unitIdx > -1,
        qtyFound: bestPartial.qtyIdx > -1,
        reason: 'se reconocio Descripcion/Concepto en esa fila, pero ninguna columna de Unidad ni de Cantidad en la misma fila.'
      };
    }else{
      diagnostic = {
        sheetName,
        rowsScanned,
        headerRow: null,
        descriptionFound: false,
        unitFound: false,
        qtyFound: false,
        reason: `no se encontro ninguna columna de Descripcion/Concepto reconocible en las primeras ${rowsScanned} filas analizadas.`
      };
    }
  }else if(!concepts.length){
    diagnostic = {
      sheetName,
      rowsScanned,
      headerRow: header + 1,
      descriptionFound: true,
      unitFound: cUnit > -1,
      qtyFound: cQty > -1,
      reason: 'se reconocio un encabezado valido, pero ninguna fila debajo tuvo a la vez descripcion, unidad valida y cantidad mayor a cero.'
    };
  }
  return { concepts, diagnostic };
}
/* Formato legible del diagnostico de UNA hoja (ver extractConceptsFromSheetRows):
   hoja, filas inspeccionadas, fila de encabezado candidata (si hubo alguna)
   y que columna minima si/no se reconocio, para que el usuario pueda
   corregir el catalogo sin que el sistema tenga que adivinar por el. */
export function formatCatalogDiagnostic(diagnostic){
  const found = (v) => v ? 'detectada' : 'no detectada';
  const lines = [
    `Hoja: ${diagnostic.sheetName || '(sin nombre)'}`,
    `Filas inspeccionadas: ${diagnostic.rowsScanned}`,
    `Encabezado candidato: ${diagnostic.headerRow ? `fila ${diagnostic.headerRow}` : 'ninguno detectado'}`,
    `Descripcion: ${found(diagnostic.descriptionFound)}`,
    `Unidad: ${found(diagnostic.unitFound)}`,
    `Cantidad: ${found(diagnostic.qtyFound)}`,
    `Motivo: ${diagnostic.reason}`
  ];
  return lines.join('\n');
}
/* Punto de entrada testeable sin navegador: recibe bloques ya leidos
   {sheetName, rows} (p. ej. desde read-excel-file/node en pruebas, o desde
   readSpreadsheetSheetBlocks en la app real) y aplica extraccion por hoja +
   deduplicacion SOLO entre hojas distintas. */
export function extractConceptsFromWorkbookRows(sheetBlocks){
  const perSheet = (sheetBlocks || []).map(({ sheetName, rows }) => {
    const { concepts, diagnostic } = extractConceptsFromSheetRows(normalizeSpreadsheetRows(rows), sheetName || '');
    return { sheetName: sheetName || '', concepts, diagnostic };
  });
  const concepts = dedupeAcrossSheets(perSheet);
  const diagnostics = perSheet.filter(s => s.diagnostic).map(s => s.diagnostic);
  return { concepts, diagnostics };
}
export async function parseRobustConceptCatalog(file){
  const blocks = await readSpreadsheetSheetBlocks(file);
  const { concepts, diagnostics } = extractConceptsFromWorkbookRows(blocks);
  if(!concepts.length){
    const blocksText = diagnostics.map(d => formatCatalogDiagnostic(d)).join('\n\n');
    throw new Error(`No pude identificar un catalogo de conceptos reconocible.\n\n${blocksText}`);
  }
  return { fileName:file?.name || 'Catalogo importado', rows: blocks.flatMap(b => b.rows), concepts, diagnostics };
}
export function mergeCatalogs(base=[], incoming=[]){
  const map=new Map();
  [...base,...incoming].forEach(item=>{
    const key=tokenize(item.desc).join('|') || item.desc;
    if(key) map.set(key,item);
  });
  return [...map.values()];
}
export function parseCatalogRows(rows){
  rows = normalizeSpreadsheetRows(rows);
  let hi=-1,cD=-1,cU=-1,cP=-1;
  for(let i=0;i<Math.min(rows.length,10);i++){
    const r=(rows[i]||[]).map(x=>(x==null?'':x).toString().toLowerCase());
    const d=r.findIndex(x=>/descrip|concepto|insumo|material/.test(x));
    const p=r.findIndex(x=>/precio|costo|unitario|importe|p\.?u/.test(x));
    if(d>-1&&p>-1){hi=i;cD=d;cP=p;cU=r.findIndex(x=>/unidad|u\.m|^u$/.test(x));break;}
  }
  const out=[]; const start=hi>-1?hi+1:0;
  for(let i=start;i<rows.length;i++){
    const r=rows[i]||[]; let desc,unidad,precio;
    if(cD>-1){desc=r[cD];unidad=cU>-1?r[cU]:'';precio=r[cP];}
    else{desc=r[0];unidad=r[1];precio=r.find((v,idx)=>idx>0&&!isNaN(parseFloat(v)));}
    precio=parseFloat((precio==null?'':precio).toString().replace(/[^0-9.\-]/g,''));
    if(desc&&!isNaN(precio)&&precio>0) out.push({desc:desc.toString().trim(),unidad:(unidad||'').toString().trim(),precio});
  }
  return out;
}
export function parseCSV(text){
  const rows=[]; let row=[], cell='', q=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i], next=text[i+1];
    if(ch==='"' && q && next==='"'){ cell+='"'; i++; }
    else if(ch==='"'){ q=!q; }
    else if(ch===',' && !q){ row.push(cell); cell=''; }
    else if((ch==='\n'||ch==='\r') && !q){ if(ch==='\r'&&next==='\n') i++; row.push(cell); if(row.some(x=>String(x).trim())) rows.push(row); row=[]; cell=''; }
    else cell+=ch;
  }
  row.push(cell); if(row.some(x=>String(x).trim())) rows.push(row);
  return rows;
}
// Distancia de acarreo ("distancia 25m", "distancia de 25 m"): describe el
// concepto, nunca es la cantidad principal ni un P.U. de referencia -- se
// excluye de ambos aunque el texto no traiga ninguna otra unidad/numero.
// Con grupo de captura (numero, unidad) para poder exponerla como variable
// estructurada (distance/distanceUnit), ademas de excluirla de qty/PU.
const DISTANCE_CAPTURE_RE = /distancia\s*(?:de)?\s*(\d+(?:[.,]\d+)?)\s*(m|mts?|metros?)\b/i;
const DISTANCE_RE = /distancia\s*(?:de)?\s*\d+(?:[.,]\d+)?\s*(?:m|mts?|metros?)\b/gi;
// Sustantivos de conteo (costales, sacos, viajes...) que funcionan como
// "unidad operativa" del concepto cuando no hay ninguna unidad tecnica
// (m2/m3/kg/pza...) explicita -- ej. "acarreo de 46 costales".
const COUNTING_UNIT_RE = /\b(costales?|sacos?|bultos?|viajes?|piezas?|pzas?)\b/i;
const COUNTING_UNIT_SINGULAR = { costales:'costal', costal:'costal', sacos:'saco', saco:'saco', bultos:'bulto', bulto:'bulto', viajes:'viaje', viaje:'viaje', piezas:'pieza', pieza:'pieza', pzas:'pza', pza:'pza' };
/* Extractor determinista de variables de UN concepto de texto libre.

   Regla explicita (RC5, corrige perdida de informacion detectada en RC4):
   `originalDescription`/`concept` es SIEMPRE el texto de entrada completo,
   con normalizacion superficial de espacios unicamente -- jamas se recorta
   distancia, volumen, dimensiones, numero de piezas, espesores,
   resistencias, diametros, alturas, longitudes ni ninguna especificacion.
   Antes (RC4) `concept` se cortaba en el indice de la unidad detectada
   (`text.slice(0, unitIndex)`), lo que perdia texto que viniera DESPUES de
   la unidad (ej. "distancia 25m" en "acarreo de loseta 1.5m3 distancia
   25m"). `normalizedDescription` es una version aparte, en minusculas y sin
   acentos, pensada para matching/deduplicacion -- nunca reemplaza a
   `concept`.

   Ademas de unit/qty/referencePU (ya existentes, sin cambios de
   comportamiento), expone variables tipadas cuando son detectables --
   ninguna es obligatoria: distance/distanceUnit, volume/volumeUnit,
   pieceCount/pieceUnit, dimensions (medidas/proporciones tecnicas
   detectadas en el texto, ej. "15 x 20 x 40 cm", "1:4", "3/4 in"). */
export function parseConceptText(input){
  const text=(input||'').replace(/\s+/g,' ').trim();
  const distanceRanges=[...text.matchAll(DISTANCE_RE)].map(m=>[m.index??0,(m.index??0)+m[0].length]);
  const insideDistanceRange=index=>distanceRanges.some(([start,end])=>index>=start&&index<end);
  // (?!\s*\/\s*cm) evita capturar el "kg" de una resistencia de material tipo
  // f'c=250 kg/cm² o fy=4200 kg/cm², que no es la unidad de medida del concepto.
  // (?<![a-z]) / (?![a-z]) en vez de \b: \b NUNCA marca frontera entre un
  // digito y la letra siguiente, asi que una unidad pegada al numero sin
  // espacio (64m2, 1.5m3 -- catalogos reales pegados como texto) jamas
  // matcheaba con \b(m2)\b. Con estos lookarounds si se reconoce, y sigue
  // rechazando "cm2"/"promedio" (precedidos por otra letra).
  const unitMatch=text.match(/(?:(?<![a-z])(m2|m3|kg|pza|pieza|ml|lote|jgo|hr)(?![a-z])|(?<!\w)(m²|m³)(?!\w))(?!\s*\/\s*cm)/i);
  // Proporciones (1:4), dimensiones (15 x 20 x 40) y medidas tecnicas
  // (15 cm, 3/4 in) describen el concepto: nunca son cantidad ni P.U. Se
  // conserva tambien el texto original de cada coincidencia (dimensions).
  const technicalMatches=[
    /\b\d+(?:\.\d+)?\s*:\s*\d+(?:\.\d+)?\b/g,
    /\b\d+(?:\.\d+)?(?:\s*[x×]\s*\d+(?:\.\d+)?){1,3}\b/gi,
    /\b\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?\s*(?:mm|cm|in|pulg(?:adas?)?|dia(?:metro)?|ø)\b/gi
  ].flatMap(re=>[...text.matchAll(re)].map(m=>({start:m.index??0, end:(m.index??0)+m[0].length, text:m[0]})));
  const technicalRanges=technicalMatches.map(m=>[m.start,m.end]);
  const insideTechnicalRange=index=>technicalRanges.some(([start,end])=>index>=start&&index<end);
  const moneyMatches=[...text.matchAll(/\$?\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)/g)]
    .map(m=>({raw:m[0], value:parseFloat(m[1].replace(/,/g,'')), index:(m.index ?? 0)+m[0].indexOf(m[1])}))
    .filter(x=>!Number.isNaN(x.value)&&!insideTechnicalRange(x.index)&&!insideDistanceRange(x.index));
  const unitIndex=unitMatch?.index ?? -1;
  const unitEnd=unitIndex>=0?unitIndex+unitMatch[0].length:-1;
  const afterUnit=unitIndex>=0 ? moneyMatches.filter(n=>n.index>=unitEnd) : moneyMatches;
  // Cantidad "pegada" al frente de la unidad sin espacio (64m2, 1.5m3): ese
  // numero es la cantidad del concepto y nunca se busca "despues" de la
  // unidad como en el caso con espacio -- salvo que forme parte de una
  // dimension/proporcion tecnica (15x20x40, 1:4), en cuyo caso se ignora.
  const gluedQtyMatch = unitIndex>=0 ? text.slice(0,unitIndex).match(/(\d+(?:[.,]\d+)?)\s*$/) : null;
  const gluedQtyIndex = gluedQtyMatch ? unitIndex-gluedQtyMatch[0].length : -1;
  const gluedQty = gluedQtyMatch && !insideTechnicalRange(gluedQtyIndex) ? parseFloat(gluedQtyMatch[1].replace(',','.')) : null;
  let qty, referencePU;
  if(gluedQty != null){
    qty = gluedQty;
    referencePU = afterUnit.length ? afterUnit[afterUnit.length-1].value : 0;
  }else{
    qty=afterUnit[0]?.value || 1;
    referencePU=afterUnit.length>1 ? afterUnit[afterUnit.length-1].value : 0;
  }
  let unit = unitMatch ? (unitMatch[1]||unitMatch[2]).replace(/m2/i,'m²').replace(/m3/i,'m³') : '';
  let unitFromCounting = false;
  if(!unit){
    const countingMatch = text.match(COUNTING_UNIT_RE);
    if(countingMatch && !insideDistanceRange(countingMatch.index)){
      unit = COUNTING_UNIT_SINGULAR[countingMatch[1].toLowerCase()] || countingMatch[1].toLowerCase();
      unitFromCounting = true;
    }
  }
  const distanceMatch = text.match(DISTANCE_CAPTURE_RE);
  const distance = distanceMatch ? parseFloat(distanceMatch[1].replace(',','.')) : null;
  const distanceUnit = distanceMatch ? 'm' : null;
  const isVolumeUnit = unit === 'm³';
  const volume = isVolumeUnit ? qty : null;
  const volumeUnit = isVolumeUnit ? unit : null;
  const pieceCount = unitFromCounting ? qty : null;
  const pieceUnit = unitFromCounting ? unit : null;
  const dimensions = technicalMatches.map(m=>m.text.trim());
  // originalDescription/concept: SIEMPRE el texto completo (ver comentario de
  // funcion). normalizedDescription: version aparte para matching, minuscula
  // y sin acentos, con el prefijo de etiqueta ("Concepto:", "Descripcion:")
  // removido -- ese prefijo es una etiqueta de captura, no una especificacion
  // tecnica, asi que quitarlo no viola la regla de "nunca recortar".
  const originalDescription = text || 'Concepto nuevo';
  const normalizedDescription = originalDescription
    .replace(/^(concepto|descripci[oó]n|partida)\s*[:\-]?\s*/i,'')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g,'')
    .replace(/\s+/g,' ')
    .trim();
  return {
    concept: originalDescription,
    originalDescription,
    normalizedDescription,
    // Vacio (no 'm²') cuando el texto no trae una unidad explicita, para que la
    // clasificacion automatica del concepto (bomba->pza, tuberia->m, etc.) decida
    // la unidad en vez de que este valor por defecto la pise siempre.
    unit,
    qty,
    quantity: qty,
    referencePU,
    distance,
    distanceUnit,
    volume,
    volumeUnit,
    pieceCount,
    pieceUnit,
    dimensions
  };
}
/* Subconjunto de parseConceptText pensado para adjuntarse tal cual como
   `variables` en un item de catalogo o en un APU (item.variables /
   apu.variables): mismo contenido, forma estable y explicita para no exponer
   los campos internos de compatibilidad (concept/unit/qty/referencePU) que
   ya tienen su propio lugar en el resto del objeto. */
export function conceptVariablesFromParsed(parsed={}){
  return {
    originalDescription: parsed.originalDescription ?? parsed.concept ?? '',
    normalizedDescription: parsed.normalizedDescription ?? '',
    quantity: parsed.quantity ?? parsed.qty ?? null,
    unit: parsed.unit || null,
    distance: parsed.distance ?? null,
    distanceUnit: parsed.distanceUnit ?? null,
    volume: parsed.volume ?? null,
    volumeUnit: parsed.volumeUnit ?? null,
    pieceCount: parsed.pieceCount ?? null,
    pieceUnit: parsed.pieceUnit ?? null,
    dimensions: Array.isArray(parsed.dimensions) ? parsed.dimensions : []
  };
}
/* Prefijo de numeracion de lista al inicio de un renglon pegado a mano
   ("1-", "1.", "1)", "01 Movimiento..."). El renglon completo se conserva
   sin tocar cuando lo que sigue al numero es en realidad una unidad tecnica
   (ej. "25 m2 de piso"): ahi el numero es la cantidad real del concepto, no
   un indice de lista. */
// Renglon con "forma" de indice de lista al inicio (secuencia numerica corta
// + separador de puntuacion o espacio + contenido): usado SOLO para decidir
// el contexto del bloque completo (ver isNumberedListContext en
// parseConceptListText), nunca para decidir por si solo si un renglon en
// particular debe recortarse -- esa decision especifica siempre pasa por el
// guard de unidad tecnica de stripLineNumbering.
const LIST_INDEX_SHAPE_RE = /^\d{1,4}\s*(?:[.\-)]\s*|\s+)\S/;
function looksLikeListIndexLine(line){
  return LIST_INDEX_SHAPE_RE.test(line.trim());
}
/* listContext=true: el bloque completo (ver parseConceptListText) ya se
   reconocio como una lista numerada por su forma (mayoria de renglones con
   "numero + separador + contenido"), asi que un renglon "02 demolicion de
   loseta" se reconoce como indice aunque la palabra siguiente empiece en
   minuscula -- "no dependas solo de mayusculas/minusculas" (RC5). Sin
   contexto de lista, se mantiene el criterio conservador anterior (requiere
   mayuscula) para no recortar un renglon suelto por accidente.

   El guard de unidad tecnica es la UNICA verdad final en ambos casos: si lo
   que sigue al numero es una unidad reconocida (ej. "25 m² de piso"), el
   numero es la cantidad real del concepto, nunca un indice -- el renglon se
   devuelve intacto sin importar el contexto. */
function stripLineNumbering(line, listContext=false){
  const trimmed = line.trim();
  let m = trimmed.match(/^(\d{1,4})\s*[.\-)]\s*(.*)$/s);
  if(!m && listContext) m = trimmed.match(/^(\d{1,4})\s+(.*)$/s);
  if(!m) m = trimmed.match(/^(\d{1,4})\s+(?=[A-ZÁÉÍÓÚÑ])(.*)$/s);
  if(!m) return trimmed;
  const rest = m[2].trim();
  // \b nunca marca frontera despues de "²"/"³" (no son caracteres \w para el
  // motor de regex de JS), asi que "m²"/"m³" necesitan su propio chequeo con
  // (?!\w) en vez de \b -- mismo defecto ya corregido en parseConceptText.
  if(/^(m2|m3|kg|pza|pieza|piezas|ml|lote|jgo|hr|costales?|sacos?|bultos?|viajes?)(?![a-z])/i.test(rest) || /^(m²|m³)(?!\w)/.test(rest)) return trimmed;
  return rest || trimmed;
}
function isNoiseConceptLine(text){
  const v = (text||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').trim();
  if(!v || v.length < 4) return true;
  if(/^(concepto|descripci[oó]n|partida|clave|c[oó]digo|unidad|cantidad|precio unitario|pu|p u|cat[aá]logo|cat[aá]logo de conceptos|presupuesto)$/.test(v)) return true;
  return false;
}
/* Segmentador determinista de texto pegado a mano con VARIOS conceptos
   (numerados "1-"/"1."/"01 ", o simplemente un concepto por renglon): corre
   ANTES de mandar cualquier cosa a la IA o al motor APU, para que "1
   concepto de entrada = 1 concepto normalizado" tambien se cumpla cuando el
   catalogo no viene de un Excel sino de texto pegado directo en el panel de
   generacion (ver src/main.jsx#generate / generateAI). Devuelve el mismo
   shape que parseRobustConceptCatalog ({fileName, rows, concepts}) para
   alimentar el mismo panel de revision de lote y el mismo motor de cola
   (apuBatchQueue.js) que ya usa el catalogo de Excel -- ningun pipeline
   paralelo nuevo. Si el texto trae un solo renglon con contenido, devuelve
   un solo concepto (el llamador sigue el camino de concepto suelto sin
   ningun cambio de comportamiento). */
export function parseConceptListText(text){
  const lines = String(text||'').split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  // Contexto de catalogo: si la mayoria (>=60%) de los renglones del bloque
  // completo tienen forma de indice numerico, se trata TODO el bloque como
  // lista numerada -- asi "02 demolicion de loseta" (minuscula, sin
  // puntuacion) se reconoce igual que "1-Movimiento..." o "2. Demolición...".
  // Nunca decide un renglon aislado por si solo (requiere >1 renglon) y
  // nunca sustituye al guard de unidad tecnica de stripLineNumbering.
  const numberedCount = lines.filter(looksLikeListIndexLine).length;
  const isNumberedListContext = lines.length > 1 && (numberedCount / lines.length) >= 0.6;
  const concepts = [];
  lines.forEach((rawLine, i) => {
    const stripped = stripLineNumbering(rawLine, isNumberedListContext);
    if(isNoiseConceptLine(stripped)) return;
    const parsed = parseConceptText(stripped);
    if(!parsed.concept || isNoiseConceptLine(parsed.concept)) return;
    concepts.push({
      code: `CON-${String(concepts.length+1).padStart(3,'0')}`,
      concept: parsed.concept,
      unit: parsed.unit || '',
      qty: parsed.qty || 1,
      referencePU: parsed.referencePU || 0,
      rowNumber: i+1,
      // Variables estructuradas (RC5): nunca sustituyen concept/unit/qty
      // (que siguen siendo la fuente de verdad para el resto del pipeline
      // ya existente), solo agregan tipado adicional cuando es detectable.
      variables: conceptVariablesFromParsed(parsed)
    });
  });
  return { fileName:'Texto pegado', rows: lines.map(l=>[l]), concepts };
}
