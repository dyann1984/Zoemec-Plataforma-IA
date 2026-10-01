/* F5-QA -- renderiza paginas de un PDF a PNG en Node (pdf.js legacy +
   @napi-rs/canvas, ambas ya instaladas como dependencias del proyecto) para
   inspeccion visual sin depender del navegador.
   Uso: node test/qa/f5/render-pdf.mjs <archivo.pdf> [paginas "1-3"] [escala] */
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

export async function renderPdfToPngs(file, { pages = null, scale = 1.6, outDir = path.dirname(file) } = {}){
  const data = new Uint8Array(fs.readFileSync(file));
  const pkgDir = path.dirname(decodeURIComponent(new URL(import.meta.resolve('pdfjs-dist/package.json')).pathname).replace(/^\/([A-Z]:)/, '$1'));
  const standardFontDataUrl = `${path.join(pkgDir, 'standard_fonts').replace(/\\/g, '/')}/`;
  const doc = await pdfjs.getDocument({ data, standardFontDataUrl, disableFontFace: true, verbosity: 0 }).promise;
  const [a, b] = (pages || `1-${doc.numPages}`).split('-').map(Number);
  const base = path.basename(file).replace(/\.pdf$/i, '');
  const written = [];
  for(let i = a; i <= Math.min(b || a, doc.numPages); i++){
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const out = path.join(outDir, `${base}-p${i}.png`);
    fs.writeFileSync(out, canvas.toBuffer('image/png'));
    written.push(out);
  }
  return { pages: doc.numPages, written };
}

if(process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())){
  const [file, pages, scale] = process.argv.slice(2);
  const r = await renderPdfToPngs(file, { pages, scale: Number(scale) || 1.6 });
  console.log(`${path.basename(file)}: ${r.pages} pagina(s) -> ${r.written.length} PNG`);
}
