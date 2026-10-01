/* F5 -- Kit PDF COMUN del Centro de Reportes (jsPDF, A4 vertical, mm).
   Identidad: SOLO el logo oficial existente (public/images/zoemec-logo-
   oficial.png, proporcion leida del propio PNG: nunca se deforma) y la
   paleta de marca (petroleo #0B2F4A / azul #123F78). Sin morado.
   - Encabezado en cada pagina (salvo portada): logo + tipo de reporte +
     proyecto. Pie: Proyecto · Tipo · Fecha · Pagina X de Y · ZOEMEC®.
   - Tablas: encabezado repetido al cambiar de pagina, numeros alineados a
     la derecha, texto envuelto (nunca cortado), subtotales/totales
     diferenciados.
   - BORRADOR: franja roja en cada pagina + marca de agua diagonal. */
import { jsPDF } from 'jspdf';
import { BRAND, DRAFT_MARK } from './reportModels.js';

export const PETROL = [11, 47, 74];
export const BLUE = [18, 63, 120];
const SOFT = [230, 238, 244];
const SOFTER = [244, 247, 250];
const INK = [28, 33, 40];
const MUTED = [110, 118, 128];
const RED = [178, 34, 34];

/* jsPDF con fuentes estandar codifica Latin-1: se conservan acentos, ñ, ², ³,
   ×, ®, ·; lo demas se sustituye por su equivalente legible. */
const MAP = { '−': '-', '—': '-', '–': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '•': '·', '…': '...', '→': '>', '⚠': '!', '≥': '>=', '≤': '<=', '≈': '~', ' ': ' ', ' ': ' ' };
export function pdfT(v){
  return String(v ?? '').normalize('NFC').replace(/[^\u0000-ÿ]/g, ch => MAP[ch] ?? '');
}

/* Dimensiones reales del PNG (cabecera IHDR) para respetar la proporcion. */
export function pngSize(dataUrl){
  try{
    const b64 = String(dataUrl).split(',')[1] || '';
    const bin = typeof atob === 'function' ? atob(b64.slice(0, 64)) : Buffer.from(b64.slice(0, 64), 'base64').toString('binary');
    const u32 = o => ((bin.charCodeAt(o) << 24) | (bin.charCodeAt(o + 1) << 16) | (bin.charCodeAt(o + 2) << 8) | bin.charCodeAt(o + 3)) >>> 0;
    const w = u32(16), h = u32(20);
    return w > 0 && h > 0 ? { w, h } : null;
  }catch{ return null; }
}

let logoCache = null;
export async function loadOfficialLogo(){
  if(logoCache) return logoCache;
  try{
    const res = await fetch(BRAND.logoPath);
    if(!res.ok) return null;
    const blob = await res.blob();
    logoCache = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob); });
    return logoCache;
  }catch{ return null; }
}

export function createReport({ reportLabel, header, draft = false, logo = null }){
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: false });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 14;
  const TOP = draft ? 30 : 26, BOTTOM = H - 17;
  const size = logo ? pngSize(logo) : null;
  const ratio = size ? size.w / size.h : null;
  let y = TOP;
  let coverPages = new Set();

  const setText = (rgb = INK, sizePt = 8, style = 'normal') => { doc.setTextColor(...rgb); doc.setFontSize(sizePt); doc.setFont('helvetica', style); };
  const drawLogo = (x, yy, h, align = 'left') => {
    if(!logo || !ratio) return 0;
    const w = h * ratio;
    doc.addImage(logo, 'PNG', align === 'center' ? x - w / 2 : x, yy, w, h, 'zoemec-logo', 'FAST');
    return w;
  };
  const newPage = () => { doc.addPage(); y = TOP; };
  const ensure = h => { if(y + h > BOTTOM){ newPage(); return true; } return false; };

  /* ---- portada ---- */
  const cover = ({ title, subtitle = '', fields = [], note = '' }) => {
    coverPages.add(doc.getNumberOfPages());
    let yy = 26;
    const lw = drawLogo(W / 2, yy, 30, 'center');
    if(!lw){ setText(PETROL, 22, 'bold'); doc.text(pdfT(BRAND.name), W / 2, yy + 14, { align: 'center' }); setText(MUTED, 9); doc.text(pdfT(BRAND.tagline), W / 2, yy + 21, { align: 'center' }); }
    yy += 44;
    doc.setFillColor(...PETROL); doc.rect(M, yy, W - 2 * M, 14, 'F');
    setText([255, 255, 255], 15, 'bold'); doc.text(pdfT(title.toUpperCase()), W / 2, yy + 9.4, { align: 'center' });
    yy += 20;
    if(subtitle){ setText(MUTED, 9); doc.text(pdfT(subtitle), W / 2, yy, { align: 'center' }); yy += 8; }
    yy += 2;
    fields.forEach(([label, value]) => {
      const lines = doc.splitTextToSize(pdfT(value), W - 2 * M - 58);
      doc.setDrawColor(225); doc.line(M, yy + 2.5, W - M, yy + 2.5);
      setText(PETROL, 9, 'bold'); doc.text(pdfT(label), M, yy);
      setText(INK, 9); doc.text(lines, M + 58, yy);
      yy += Math.max(7.5, lines.length * 4.4 + 3);
    });
    if(draft){
      yy += 4; doc.setFillColor(253, 236, 234); doc.setDrawColor(...RED); doc.rect(M, yy, W - 2 * M, 12, 'FD');
      setText(RED, 10, 'bold'); doc.text(pdfT(DRAFT_MARK), W / 2, yy + 7.6, { align: 'center' }); yy += 16;
    }
    if(note){ yy += 4; setText(MUTED, 7.5, 'italic'); const l = doc.splitTextToSize(pdfT(note), W - 2 * M); doc.text(l, M, yy); }
    newPage();
  };

  /* ---- bloques ---- */
  const section = title => {
    ensure(16);
    doc.setFillColor(...BLUE); doc.rect(M, y, W - 2 * M, 8, 'F');
    setText([255, 255, 255], 9.5, 'bold'); doc.text(pdfT(title), M + 3, y + 5.5);
    y += 11;
  };
  const subsection = title => { ensure(12); setText(PETROL, 9, 'bold'); doc.text(pdfT(title), M, y + 3); y += 7; };
  const paragraph = (text, { size: fs = 7.8, color = INK, style = 'normal' } = {}) => {
    setText(color, fs, style);
    const lines = doc.splitTextToSize(pdfT(text), W - 2 * M);
    lines.forEach(line => { ensure(fs * 0.45); doc.text(line, M, y + 3); y += fs * 0.45; });
    y += 2;
  };
  const empty = text => { ensure(12); doc.setFillColor(...SOFTER); doc.rect(M, y, W - 2 * M, 10, 'F'); setText(MUTED, 8.5, 'italic'); doc.text(pdfT(text), W / 2, y + 6.3, { align: 'center' }); y += 14; };
  /* Pares etiqueta/valor: el ancho de la etiqueta se MIDE (nunca se encima
     con el valor) y ambos se envuelven si no caben. */
  const kv = (pairs, { cols = 2 } = {}) => {
    const colW = (W - 2 * M) / cols;
    setText(PETROL, 7.8, 'bold');
    const labelW = Math.min(colW * 0.55, Math.max(24, ...pairs.map(([k]) => doc.getTextWidth(pdfT(k)))) + 4);
    for(let i = 0; i < pairs.length; i += cols){
      const chunk = pairs.slice(i, i + cols);
      setText(PETROL, 7.8, 'bold');
      const labels = chunk.map(([k]) => doc.splitTextToSize(pdfT(k), labelW - 3));
      setText(INK, 7.8);
      const values = chunk.map(([, v]) => doc.splitTextToSize(pdfT(v), colW - labelW - 4));
      const rh = Math.max(6, Math.max(...labels.map(l => l.length), ...values.map(v => v.length)) * 3.6 + 2.4);
      ensure(rh);
      chunk.forEach((_, j) => {
        const x = M + j * colW;
        setText(PETROL, 7.8, 'bold'); doc.text(labels[j], x, y + 3.5);
        setText(INK, 7.8); doc.text(values[j], x + labelW, y + 3.5);
      });
      y += rh;
    }
    y += 2;
  };

  /* table({ columns:[{head, w, align}], rows:[{cells, kind}] })
     kind: data | group | subtotal | total | trace | note */
  const table = ({ columns, rows, fontSize = 7.4 }) => {
    const totalW = W - 2 * M;
    const ratios = columns.map(c => c.w || 1); const sumR = ratios.reduce((a, b) => a + b, 0);
    const colW = ratios.map(r => totalW * r / sumR);
    const colX = colW.reduce((acc, w, i) => { acc.push(i ? acc[i - 1] + colW[i - 1] : M); return acc; }, []);
    const lh = fontSize * 0.42;
    const drawHead = () => {
      const heads = columns.map((c, i) => doc.splitTextToSize(pdfT(c.head), colW[i] - 2));
      const hh = Math.max(6.5, Math.max(...heads.map(h => h.length)) * lh + 3);
      doc.setFillColor(...PETROL); doc.rect(M, y, totalW, hh, 'F');
      setText([255, 255, 255], fontSize, 'bold');
      heads.forEach((h, i) => { const al = columns[i].align === 'right' ? 'right' : 'left'; doc.text(h, al === 'right' ? colX[i] + colW[i] - 1.2 : colX[i] + 1.2, y + 4.2, { align: al }); });
      y += hh;
    };
    ensure(14); drawHead();
    rows.forEach((row, idx) => {
      const kind = row.kind || 'data';
      const style = kind === 'data' || kind === 'trace' || kind === 'note' ? 'normal' : 'bold';
      const fsz = kind === 'trace' ? fontSize - 0.8 : fontSize;
      setText(INK, fsz, style);
      let cells = row.cells;
      if(kind === 'group' || kind === 'note') cells = [row.cells[0], ...columns.slice(1).map(() => '')];
      const wrapped = cells.map((v, i) => {
        const width = (kind === 'group' || kind === 'note') && i === 0 ? totalW - 2.4 : colW[i] - 2.4;
        return v == null || v === '' ? [] : doc.splitTextToSize(pdfT(v), width);
      });
      const rh = Math.max(kind === 'trace' ? 4.2 : 5.2, Math.max(1, ...wrapped.map(w => w.length)) * (fsz * 0.42) + 2.2);
      const next = rows[idx + 1];
      const keep = kind === 'group' && next ? 6 : 0; // un titulo de grupo nunca queda solo al pie
      if(y + rh + keep > BOTTOM){ newPage(); drawHead(); }
      // El encabezado repetido deja texto blanco/negrita: se restablece el estilo del renglon.
      //__QA_REVERT__ setText(INK, fsz, style);
      if(kind === 'group'){ doc.setFillColor(...SOFT); doc.rect(M, y, totalW, rh, 'F'); }
      if(kind === 'subtotal'){ doc.setFillColor(...SOFTER); doc.rect(M, y, totalW, rh, 'F'); doc.setDrawColor(...BLUE); doc.line(M, y, M + totalW, y); }
      if(kind === 'total'){ doc.setFillColor(...PETROL); doc.rect(M, y, totalW, rh, 'F'); setText([255, 255, 255], fsz + 0.4, 'bold'); }
      if(kind === 'trace' || kind === 'note') doc.setTextColor(...MUTED);
      if(kind === 'group') doc.setTextColor(...PETROL);
      if(row.color) doc.setTextColor(...row.color);
      wrapped.forEach((lines, i) => {
        if(!lines.length) return;
        const al = columns[i]?.align === 'right' && kind !== 'group' && kind !== 'note' ? 'right' : 'left';
        const x = al === 'right' ? colX[i] + colW[i] - 1.2 : colX[i] + 1.2 + (kind === 'trace' && i === 1 ? 3 : 0);
        doc.text(lines, x, y + fsz * 0.42 + 0.9, { align: al });
      });
      if(kind === 'data'){ doc.setDrawColor(232); doc.line(M, y + rh, M + totalW, y + rh); }
      y += rh;
    });
    y += 4;
  };

  /* ---- sellado final: encabezado, pie, BORRADOR ---- */
  const finish = () => {
    const total = doc.getNumberOfPages();
    for(let p = 1; p <= total; p++){
      doc.setPage(p);
      const isCover = coverPages.has(p);
      if(!isCover){
        const lw = drawLogo(M, 7, 9);
        if(!lw){ setText(PETROL, 11, 'bold'); doc.text(pdfT(BRAND.name), M, 13); }
        setText(PETROL, 9.5, 'bold'); doc.text(pdfT(reportLabel.toUpperCase()), W - M, 11, { align: 'right' });
        setText(MUTED, 7.4); doc.text(pdfT(header.proyecto), W - M, 15.5, { align: 'right' });
        doc.setDrawColor(...PETROL); doc.setLineWidth(0.5); doc.line(M, 19, W - M, 19); doc.setLineWidth(0.2);
        if(draft){ setText(RED, 8, 'bold'); doc.text(pdfT(DRAFT_MARK), W / 2, 24.5, { align: 'center' }); }
      }
      if(draft){
        setText([236, 200, 200], 34, 'bold');
        doc.text(pdfT('BORRADOR'), W / 2, H / 2, { align: 'center', angle: 35 });
      }
      doc.setDrawColor(210); doc.line(M, H - 12, W - M, H - 12);
      setText(MUTED, 6.6);
      doc.text(doc.splitTextToSize(pdfT(`${header.proyecto} · ${reportLabel} · ${header.fecha}`), 110), M, H - 8);
      doc.text(pdfT(BRAND.full), W / 2 + 22, H - 8, { align: 'center' });
      setText(INK, 7, 'bold'); doc.text(pdfT(`Página ${p} de ${total}`), W - M, H - 8, { align: 'right' });
    }
    return doc;
  };

  return { doc, W, H, M, get y(){ return y; }, set y(v){ y = v; }, ensure, newPage, cover, section, subsection, paragraph, empty, kv, table, finish };
}

