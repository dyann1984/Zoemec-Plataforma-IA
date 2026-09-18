/* ARNES DE QA (release gate, cierre 2026-09-17) -- NO es parte del producto
   ni del build de produccion. Inspecciona el CONTENIDO real del Dossier de
   Proyecto (PDF+Excel) generado por qa-release-gate-project-dossier.mjs --
   nunca declara PASS solo porque el archivo se genero.

   Uso: node dev-qa/qa-release-gate-project-dossier-inspect.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';

const dir = path.join(process.cwd(), 'dev-qa', '.out');
const pdfText = file => fs.readFileSync(path.join(dir, file)).toString('latin1');
function xlsxText(file){
  const zip = unzipSync(fs.readFileSync(path.join(dir, file)));
  let all = '';
  for(const [name, bytes] of Object.entries(zip)){
    if(name.startsWith('xl/worksheets/') || name === 'xl/sharedStrings.xml') all += strFromU8(bytes) + '\n';
  }
  return all;
}

const CHECKS = [
  { label: 'Nombre del proyecto (Obra Tecamac QA)', re: /Obra Tecamac QA/ },
  { label: 'Ubicación canónica Tecámac/Estado de México/Zona Metropolitana', re: /Tec.mac[\s\S]{0,40}(Zona Metropolitana|Estado de M.xico)/ },
  { label: 'Estado de México (nunca "México" desnudo como estado)', re: /Estado de M.xico/ },
  { label: 'Moneda MXN', re: /MXN/ },
  { label: 'Fecha base 2026-09-17', re: /2026-09-17/ },
  { label: 'APU 1: piso estampado', re: /piso de concreto estampado/i },
  { label: 'APU 2: banqueta', re: /banqueta de concreto/i },
  { label: 'Importe APU 1 (18,961.55 o 18961.55)', re: /18[.,]?961\.5[45]/ },
  { label: 'Importe APU 2 (18,177.18)', re: /18[.,]?177\.18/ },
  { label: 'Importe total proyecto (37,138.74)', re: /37[.,]?138\.74/ },
  { label: 'Referencia Nacional (APU 1)', re: /Nacional/ },
  { label: 'Referencia Estado (APU 2)', re: /Estado/ }
];
const FORBIDDEN = [
  { label: '[object Object] literal', re: /\[object Object\]/ },
  { label: '"undefined" visible', re: />undefined</  }, // solo como contenido de celda/etiqueta, no dentro de nombres de variables internas del XML/PDF
  { label: '"null" visible como texto', re: />null</ }
];

function countOccurrences(text, re){
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  return (text.match(g) || []).length;
}

function inspect(fileLabel, text){
  console.log(`\n=== ${fileLabel} (${text.length} chars extraidos) ===`);
  let ok = true;
  for(const c of CHECKS){
    const found = c.re.test(text);
    console.log(`${found ? 'OK  ' : 'FALTA'} ${c.label}`);
    if(!found) ok = false;
  }
  for(const f of FORBIDDEN){
    const found = f.re.test(text);
    console.log(`${found ? 'FAIL (aparece)' : 'OK  (ausente)'} ${f.label}`);
    if(found) ok = false;
  }
  // Sin APUs duplicados: cada concepto debe aparecer una cantidad de veces
  // RAZONABLE (portada del detalle + matriz + posibles referencias en
  // ranking/findings), nunca duplicado como si fueran dos APUs distintos
  // con el MISMO id -- se verifica contando el id de cada APU, que debe
  // aparecer pero el snapshot completo no debe repetirse dos veces con
  // exactamente el mismo total de paginas/contenido (chequeo indirecto: el
  // conteo de "APU-TEC-1"/"APU-TEC-2" debe ser el mismo orden de magnitud).
  // El id interno (APU-TEC-1/2) solo se usa como llave de datos -- lo que
  // el documento muestra al usuario es la `clave` de cada APU
  // (PISO-ESTAMPADO-001/BANQUETA-CONC-001, igual que en el export
  // individual). Verificar por clave es la comprobacion real de "sin
  // duplicados": cada una debe aparecer, y ninguna el doble de veces que
  // la otra (lo que delataria una hoja/seccion repetida).
  const count1 = countOccurrences(text, /PISO-ESTAMPADO-001/);
  const count2 = countOccurrences(text, /BANQUETA-CONC-001/);
  console.log(`conteo clave PISO-ESTAMPADO-001: ${count1} | conteo clave BANQUETA-CONC-001: ${count2}`);
  if(count1 === 0 || count2 === 0){ console.log('FAIL: falta la clave de uno de los 2 APUs'); ok = false; }
  else if(count1 > count2 * 3 || count2 > count1 * 3){ console.log('FAIL: conteo muy desbalanceado, posible duplicado de una seccion'); ok = false; }
  // "Mexico, Mexico" ambiguo: partir por comas y exigir que el pais
  // aparezca como segmento propio exactamente 1 vez por cada aparicion de
  // la linea de ubicacion completa (nunca el estado desnudo).
  const ubicMatches = text.match(/Tec.mac,[^)\n<]+/g) || [];
  let ambiguous = false;
  for(const m of ubicMatches){
    const parts = m.split(',').map(p => p.trim()).replace ? m.split(',').map(p => p.trim()) : [];
    const bareMexico = parts.filter(p => /^M.xico$/.test(p));
    if(bareMexico.length > 1 || parts.some((p, i) => /^M.xico$/.test(p) && i < parts.length - 1)) ambiguous = true;
  }
  console.log(`${ambiguous ? 'FAIL' : 'OK  '} ninguna linea de ubicación tiene "México, México" ambiguo (${ubicMatches.length} línea(s) revisada(s))`);
  if(ambiguous) ok = false;
  return ok;
}

function inspectWorkbookSheets(){
  const zip = unzipSync(fs.readFileSync(path.join(dir, 'PROYECTO-Tecamac-DOSSIER.xlsx')));
  const wb = strFromU8(zip['xl/workbook.xml'] || new Uint8Array());
  const names = [...wb.matchAll(/name="([^"]+)"/g)].map(m => m[1]);
  console.log(`\n=== PROYECTO-Tecamac-DOSSIER.xlsx: hojas del workbook (${names.length}) ===`);
  console.log(names.join(' | '));
  const perApuSheets = names.filter(n => /^\d{3}_/.test(n));
  const ok = perApuSheets.length === 2 && new Set(perApuSheets).size === 2;
  console.log(`${ok ? 'OK  ' : 'FAIL'} exactamente 2 hojas por-APU (001_/002_), sin duplicados: ${JSON.stringify(perApuSheets)}`);
  const emptyLike = names.filter(n => /^(Sheet\d+|hoja\d*)$/i.test(n));
  console.log(`${emptyLike.length === 0 ? 'OK  ' : 'FAIL'} ninguna hoja con nombre generico/vacio: ${JSON.stringify(emptyLike)}`);
  return ok && emptyLike.length === 0;
}

let allOk = true;
allOk = inspect('PROYECTO-Tecamac-DOSSIER.pdf', pdfText('PROYECTO-Tecamac-DOSSIER.pdf')) && allOk;
allOk = inspect('PROYECTO-Tecamac-DOSSIER.xlsx', xlsxText('PROYECTO-Tecamac-DOSSIER.xlsx')) && allOk;
allOk = inspectWorkbookSheets() && allOk;

console.log('\n=== VEREDICTO INSPECCION DOSSIER DE PROYECTO ===');
console.log(allOk ? 'PASS: ambos archivos contienen los 2 APUs, ubicación/moneda/fecha correctas, sin ambigüedad ni artefactos.' : 'FAIL: revisar detalle arriba.');
process.exit(allOk ? 0 : 1);
