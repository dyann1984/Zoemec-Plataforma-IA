/* F4-QA -- genera fixtures/qa-2-paginas.pdf: PDF vectorial de 2 paginas.
   Pagina 1: "PLANTA BAJA" (6.00 x 4.00 m). Pagina 2: "PLANTA ALTA"
   (Recamara 4.00 x 3.50 m). Escala 1:50 (1 m = 20 mm). Solo QA. */
import { jsPDF } from 'jspdf';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const M = 20; // mm por metro (1:50)
const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
function room(x0, y0, L, W, title, label){
  doc.setFontSize(16); doc.text(title, 20, 20);
  doc.setFontSize(10); doc.text('ESCALA 1:50', 20, 28);
  doc.setLineWidth(0.8);
  doc.rect(x0, y0, L * M, W * M);
  doc.setLineWidth(0.2);
  doc.text(`${L.toFixed(2)} m`, x0 + (L * M) / 2 - 6, y0 - 4);
  doc.text(`${W.toFixed(2)} m`, x0 + L * M + 3, y0 + (W * M) / 2);
  doc.setFontSize(12); doc.text(label, x0 + 8, y0 + 12);
}
room(40, 50, 6, 4, 'PLANTA BAJA - PAGINA 1', 'Estancia 6.00 x 4.00');
doc.addPage('a4', 'landscape');
room(60, 50, 4, 3.5, 'PLANTA ALTA - PAGINA 2', 'Recamara 4.00 x 3.50');
fs.mkdirSync(path.join(HERE, 'fixtures'), { recursive: true });
fs.writeFileSync(path.join(HERE, 'fixtures', 'qa-2-paginas.pdf'), Buffer.from(doc.output('arraybuffer')));
console.log('fixtures/qa-2-paginas.pdf (2 paginas)');
