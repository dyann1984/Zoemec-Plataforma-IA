/* Lector minimo de .xlsx real (formato OOXML) para pruebas de integracion:
   desempaca el zip con fflate (ya es dependencia del proyecto), lee las
   celdas de una hoja y resuelve textos compartidos (sharedStrings.xml). Solo
   entiende lo que esta prueba necesita leer de vuelta: celdas de texto,
   numero y formula. No es un lector de Excel de proposito general. */
import { unzipSync } from 'fflate';

function decodeXmlEntities(s){
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseSharedStrings(xml){
  const strings = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while((m = siRe.exec(xml))){
    const text = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('');
    strings.push(decodeXmlEntities(text));
  }
  return strings;
}

/* Devuelve { ref: { formula?, value?, str? } } para todas las celdas con
   contenido de la hoja indicada (por defecto la primera hoja del libro). */
export function readXlsxCells(buffer, sheetFile = 'xl/worksheets/sheet1.xml'){
  const files = unzipSync(new Uint8Array(buffer));
  const decode = (u8) => Buffer.from(u8).toString('utf8');
  if(!files[sheetFile]) throw new Error(`No se encontro ${sheetFile} dentro del xlsx`);
  const sheetXml = decode(files[sheetFile]);
  const sharedStrings = files['xl/sharedStrings.xml'] ? parseSharedStrings(decode(files['xl/sharedStrings.xml'])) : [];

  // El grupo de atributos usa un cuantificador perezoso (*?): con uno
  // codicioso, una celda autocerrada como <c r="B31" s="6"/> se traga la
  // barra de cierre dentro del grupo de atributos y la alternancia entra
  // por error en la rama "contenido hasta </c>", devorando varias celdas
  // vecinas de un tiron y perdiendo la celda real que buscabamos.
  const cellBlockRe = /<c r="([A-Z]+\d+)"([^>]*?)(?:\s*\/>|>((?:(?!<\/c>)[\s\S])*?)<\/c>)/g;
  const cells = {};
  let m;
  while((m = cellBlockRe.exec(sheetXml))){
    const [, ref, attrs, inner] = m;
    const typeMatch = attrs.match(/t="([a-z]+)"/);
    const type = typeMatch ? typeMatch[1] : null;
    const cell = {};
    if(inner){
      const f = inner.match(/<f>([^<]*)<\/f>/);
      const v = inner.match(/<v>([^<]*)<\/v>/);
      if(f) cell.formula = decodeXmlEntities(f[1]);
      if(v){
        if(type === 's') cell.str = sharedStrings[Number(v[1])];
        else cell.value = Number(v[1]);
      }
    }
    cells[ref] = cell;
  }
  return cells;
}

/* Busca, en las columnas A y B (donde el generador de la hoja siempre pone
   la etiqueta de cada renglon resumen/subtotal), la celda cuyo texto sea
   exactamente `label`, y devuelve la referencia de esa fila en la columna
   indicada (por defecto H, donde vive el importe/formula de cada renglon). */
export function findRowByLabel(cells, label, valueColumn = 'H'){
  for(const [ref, cell] of Object.entries(cells)){
    const col = ref.match(/^[A-Z]+/)[0];
    if((col === 'A' || col === 'B') && cell.str === label){
      const row = ref.match(/\d+$/)[0];
      return `${valueColumn}${row}`;
    }
  }
  return null;
}
