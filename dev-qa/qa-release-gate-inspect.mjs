/* ARNES DE QA (release gate 2026-09-17) -- NO es parte del producto ni del
   build de produccion. Inspecciona el CONTENIDO REAL de archivos PDF/XLSX
   generados por qa-release-gate-exports.mjs (o cualquier otro export real
   colocado en dev-qa/.out/) -- nunca declara PASS solo porque el archivo
   existe. Verifica presencia de cada campo geografico/moneda/fecha/
   referencia requerido, y ausencia explicita de "Mexico, Mexico" o
   duplicados ambiguos.

   Uso:
     node dev-qa/qa-release-gate-inspect.mjs                  (los 4 del APU individual)
     node dev-qa/qa-release-gate-inspect.mjs archivo1.pdf archivo2.xlsx ...  (archivos especificos en dev-qa/.out/) */
import fs from 'node:fs';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';

const dir = path.join(process.cwd(), 'dev-qa', '.out');
const DEFAULT_FILES = ['APU-Tecamac.pdf', 'APU-Tecamac.xlsx', 'APU-Tecamac-DOSSIER.pdf', 'APU-Tecamac-DOSSIER.xlsx'];
const files = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_FILES;

function pdfText(file){
  return fs.readFileSync(path.join(dir, file)).toString('latin1');
}
function xlsxText(file){
  const zip = unzipSync(fs.readFileSync(path.join(dir, file)));
  let all = '';
  for(const [name, bytes] of Object.entries(zip)){
    if(name.startsWith('xl/worksheets/') || name === 'xl/sharedStrings.xml'){
      all += strFromU8(bytes) + '\n';
    }
  }
  return all;
}

const REQUIRED = [
  { label: 'Tecámac (ciudad)', re: /Tec.mac/ },
  { label: 'México (país)', re: /M.xico/ },
  { label: 'Estado de México', re: /Estado de M.xico/ },
  { label: 'Zona Metropolitana (región)', re: /Zona Metropolitana/ },
  { label: 'MXN (moneda)', re: /MXN/ },
  { label: 'Fecha base 2026-09 / 17/9/2026', re: /2026-09-17|17\/9\/2026|septiembre.*2026/i },
  { label: 'Referencia Nacional', re: /Nacional/ }
];
/* OJO: la cadena CORRECTA "Tecamac, Zona Metropolitana, Estado de Mexico,
   Mexico" contiene legitimamente la subcadena "Mexico, Mexico" en su cola
   (fin de "Estado de Mexico" + el pais "Mexico") -- un regex ingenuo sobre
   esa subcadena da FALSO POSITIVO. La prueba real del bug original es:
   al partir el texto de ubicacion por ", ", el pais "Mexico" debe aparecer
   EXACTAMENTE UNA VEZ como segmento propio, y el estado NUNCA debe
   aparecer como el segmento ambiguo desnudo "Mexico" (debe ser "Estado de
   Mexico"). */
function checkUbicacionLine(text){
  // Busca especificamente la linea con el VALOR real (contiene "Tecamac"),
  // no la celda/label suelto "(Ubicacion:) Tj" que jsPDF a veces separa del
  // valor en un bloque de texto distinto cuando arma un layout de dos
  // columnas -- por eso se ancla a "Tecamac", no solo a la palabra
  // "Ubicacion:".
  // Cubre dos formas: "Ubicacion: Tecamac..." (header de drawApuSections,
  // label+valor en el mismo Tj) y "(Tecamac...)" suelto (portada del
  // Dossier, jsPDF dibuja el label y el valor en Tj separados en la misma
  // fila -- ver drawPortada#field).
  const m = text.match(/(?:Ubicacion:\s*)?\(?Tec.mac,[^)\n<]*?(?:\s{2,}Referencia[^)\n<]*)?\)?(?=\s*Tj|\)|<|$)/) || text.match(/Tec.mac,[^)\n<]+/);
  if(!m) return { found: false };
  const line = m[0].replace(/^Ubicacion:\s*/, '').replace(/^\(/, '').replace(/\)$/, '').replace(/\s{2,}Referencia.*$/, '').trim();
  const parts = line.split(',').map(p => p.trim()).filter(Boolean);
  const bareMexicoCount = parts.filter(p => /^M.xico$/.test(p)).length;
  const hasAmbiguousState = parts.some((p, i) => /^M.xico$/.test(p) && i < parts.length - 1); // "Mexico" que NO es el ultimo segmento (pais) es el estado ambiguo
  return { found: true, line, parts, bareMexicoCount, hasAmbiguousState, ok: bareMexicoCount === 1 && !hasAmbiguousState };
}

function check(fileLabel, text){
  console.log(`\n=== ${fileLabel} (${text.length} chars extraidos) ===`);
  let ok = true;
  for(const r of REQUIRED){
    const found = r.re.test(text);
    console.log(`${found ? 'OK  ' : 'FALTA'} ${r.label}`);
    if(!found) ok = false;
  }
  const ubic = checkUbicacionLine(text);
  if(!ubic.found){
    console.log('AVISO: no se encontro una linea "Ubicacion:" explicita en este archivo (puede estar en celdas separadas de Excel, se valida por separado)');
  } else {
    console.log(`linea Ubicacion real: "${ubic.line}"`);
    console.log(`${ubic.ok ? 'OK  ' : 'FAIL'} pais "Mexico" aparece exactamente 1 vez, estado nunca ambiguo (segmentos: ${JSON.stringify(ubic.parts)})`);
    if(!ubic.ok) ok = false;
  }
  return ok;
}

let allOk = true;
for(const f of files){
  const text = f.toLowerCase().endsWith('.xlsx') ? xlsxText(f) : pdfText(f);
  allOk = check(f, text) && allOk;
}

console.log('\n=== VEREDICTO INSPECCION ===');
console.log(allOk ? `PASS: los ${files.length} archivo(s) contienen todos los campos requeridos y ningun label ambiguo.` : 'FAIL: revisar detalle arriba.');
process.exit(allOk ? 0 : 1);
