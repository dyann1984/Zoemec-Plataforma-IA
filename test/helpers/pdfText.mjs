/* Lectura de texto de PDFs generados con jsPDF SIN compresion (los reportes
   F5 se generan con compress:false): cada fragmento "(texto) Tj" del flujo
   de contenido, por pagina. Solo para pruebas de cuadre. */
export function pdfPages(doc){
  const raw = Buffer.from(doc.output('arraybuffer')).toString('latin1');
  const texts = s => [...s.matchAll(/\((?:[^()\\]|\\.)*\)\s*Tj/g)].map(m => m[0].replace(/\)\s*Tj$/, '').slice(1).replace(/\\([()\\])/g, '$1'));
  const pages = [];
  const n = doc.getNumberOfPages();
  for(let i = 1; i <= n; i++){
    // jsPDF guarda el contenido de cada pagina en su propio stream; se reconstruye por pagina.
    const content = doc.internal.pages[i].join('\n');
    pages.push(texts(content));
  }
  return { pages, all: texts(raw) };
}
export const pdfText = doc => pdfPages(doc).all.join('\n');

/* Montos "$1,234.56" / "USD 1,234.56" -> numeros. */
export function amountsIn(text){
  return [...String(text).matchAll(/(?:\$|USD\s?|US\$)\s?(-?[\d,]+\.\d{2})/g)].map(m => Number(m[1].replace(/,/g, '')));
}
export const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
