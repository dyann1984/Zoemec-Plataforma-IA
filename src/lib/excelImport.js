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
export async function parseRobustConceptCatalog(file){
  const rows = await readSpreadsheetRows(file);
  const normalized = normalizeSpreadsheetRows(rows);
  const clean = (v) => cleanText(v).trim();
  const norm = (v) => clean(v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
  const unitRe = /^(m2|m²|m3|m³|kg|ton|tonelada|pza|pieza|pzas|ml|m|l|lt|lote|jgo|hr|hora|dia|día|jor|jornal|serv|servicio|sal)$/i;
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
    const key = [
      clean(item.code),
      concept.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,''),
      unit,
      qty.toFixed(4),
      clean(item.section).toLowerCase()
    ].join('|');
    if(list.some(x => x.__key === key)) return;
    list.push({
      __key:key,
      code: clean(item.code) || `CON-${String(list.length+1).padStart(3,'0')}`,
      concept,
      unit,
      qty,
      referencePU,
      importe,
      section: clean(item.section),
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
  let header = -1;
  let cCode = -1, cConcept = -1, cUnit = -1, cQty = -1, cPU = -1, cImporte = -1;
  for(let i=0;i<Math.min(normalized.length,120);i++){
    const row = normalized[i].map(norm);
    const conceptIdx = row.findIndex(x=>/concepto|descripcion|descrip/.test(x));
    const unitIdx = row.findIndex(x=>/^(und\.?|unidad|u\.?m\.?|um)$/.test(x));
    const qtyIdx = row.findIndex(x=>/cantidad|cant\.?|volumen|cantid/.test(x));
    const puIdx = row.findIndex(x=>/^(p\.?u\.?|pu|precio unitario|precio|p u|precio u\.?|costo unitario)$/.test(x));
    const importeIdx = row.findIndex(x=>/importe|total|monto/.test(x));
    if(conceptIdx > -1 && (unitIdx > -1 || qtyIdx > -1)){
      header = i;
      cConcept = conceptIdx;
      cUnit = unitIdx;
      cQty = qtyIdx;
      cPU = puIdx;
      cImporte = importeIdx;
      cCode = row.findIndex(x=>/codigo|clave/.test(x));
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
  if(!concepts.length){
    for(let i=0;i<normalized.length;i++){
      const row = normalized[i] || [];
      for(let j=0;j<row.length;j++){
        const concept = clean(row[j]);
        if(isNoiseConcept(concept) || concept.length < 18) continue;
        const lookAhead = row.slice(j+1, Math.min(row.length, j+12));
        const relUnit = lookAhead.findIndex(v=>unitRe.test(clean(v)));
        if(relUnit < 0) continue;
        const unitIndex = j + 1 + relUnit;
        let qtyIndex = -1;
        for(let k=unitIndex+1;k<Math.min(row.length, unitIndex+6);k++){
          if(asNumber(row[k]) > 0){ qtyIndex = k; break; }
        }
        if(qtyIndex < 0) continue;
        let pu = 0;
        let importe = 0;
        for(let k=qtyIndex+1;k<Math.min(row.length, qtyIndex+7);k++){
          const n = asNumber(row[k]);
          if(n > 0 && !pu) pu = n;
          else if(n > 0 && !importe) importe = n;
        }
        const previous = row.slice(Math.max(0,j-4), j).map(clean).filter(Boolean);
        const code = previous.find(v=>/^[A-Z0-9][A-Z0-9._\-\/]{1,20}$/i.test(v)) || '';
        addConcept(concepts, { code, concept, unit:row[unitIndex], qty:asNumber(row[qtyIndex]), referencePU:pu, importe, rowNumber:i+1 });
        break;
      }
    }
  }
  const flattened = normalized.map((row, i) => ({
    row,
    rowNumber:i+1,
    cells:(row || []).map(clean),
    nonEmpty:(row || []).map(clean).filter(Boolean)
  })).filter(r => r.nonEmpty.length);
  const codeRe = /^[A-Z0-9][A-Z0-9._\-\/]{1,24}$/i;
  flattened.forEach(({rowNumber, nonEmpty}) => {
    for(let i=0;i<nonEmpty.length;i++){
      const value = nonEmpty[i];
      if(!unitRe.test(value)) continue;
      const before = nonEmpty.slice(Math.max(0, i-6), i);
      const after = nonEmpty.slice(i+1, i+8);
      const qty = asNumber(after.find(v => asNumber(v) > 0));
      if(!(qty > 0)) continue;
      const conceptParts = before.filter(v => !unitRe.test(v) && !codeRe.test(v) && asNumber(v) === 0);
      const concept = conceptParts.join(' ').replace(/\s+/g,' ').trim();
      if(concept.length < 12 || isNoiseConcept(concept)) continue;
      const code = before.find(v => codeRe.test(v)) || '';
      const nums = after.map(asNumber).filter(n => n > 0);
      const referencePU = nums[1] || 0;
      const importe = nums[2] || (referencePU && qty ? referencePU * qty : 0);
      addConcept(concepts, { code, concept, unit:value, qty, referencePU, importe, rowNumber });
      break;
    }
  });
  const unique = concepts.map(({__key, ...item}) => item);
  if(!unique.length) throw new Error('No encontre conceptos validos con descripcion, unidad y cantidad.');
  return { fileName:file?.name || 'Catalogo importado', rows:normalized, concepts:unique };
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
export function parseConceptText(input){
  const text=(input||'').replace(/\s+/g,' ').trim();
  // (?!\s*\/\s*cm) evita capturar el "kg" de una resistencia de material tipo
  // f'c=250 kg/cm² o fy=4200 kg/cm², que no es la unidad de medida del concepto.
  const unitMatch=text.match(/\b(m2|m²|m3|m³|kg|pza|pieza|ml|lote|jgo|hr)\b(?!\s*\/\s*cm)/i);
  const moneyMatches=[...text.matchAll(/\$?\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)/g)]
    .map(m=>({raw:m[0], value:parseFloat(m[1].replace(/,/g,'')), index:m.index ?? 0}))
    .filter(x=>!Number.isNaN(x.value));
  const unitIndex=unitMatch?.index ?? -1;
  const afterUnit=unitIndex>=0 ? moneyMatches.filter(n=>n.index>unitIndex) : moneyMatches;
  const qty=afterUnit[0]?.value || 1;
  const referencePU=afterUnit.length>1 ? afterUnit[afterUnit.length-1].value : 0;
  let concept=text;
  if(unitIndex>=0) concept=text.slice(0,unitIndex).trim();
  concept=concept
    .replace(/^(concepto|descripci[oó]n|partida)\s*[:\-]?\s*/i,'')
    .replace(/\s+/g,' ')
    .trim();
  return {
    concept: concept || text || 'Concepto nuevo',
    // Vacio (no 'm²') cuando el texto no trae una unidad explicita, para que la
    // clasificacion automatica del concepto (bomba->pza, tuberia->m, etc.) decida
    // la unidad en vez de que este valor por defecto la pise siempre.
    unit: unitMatch ? unitMatch[1].replace(/m2/i,'m²').replace(/m3/i,'m³') : '',
    qty,
    referencePU
  };
}
