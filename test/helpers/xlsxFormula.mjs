/* Evaluador minimo de formulas de Excel para pruebas de integracion.
   Soporta exactamente la gramatica que usa src/lib/apuExport.js al escribir
   la hoja auditable del APU: referencias de celda (H16), + - * /,
   parentesis y SUM(rango) de una sola columna. No es un motor de formulas
   de proposito general: existe para poder ejecutar, de verdad, las formulas
   que quedaron escritas en el .xlsx real generado por la app, y comparar el
   resultado contra calcAPU — sin volver a escribir la formula "a mano". */

function tokenize(formula){
  const tokens = [];
  const re = /([0-9]+\.?[0-9]*)|([A-Z]+[0-9]+)|([A-Z]+)|([()+\-*/:])/g;
  let m;
  while((m = re.exec(formula))){
    if(m[1] !== undefined) tokens.push({ type:'num', value: Number(m[1]) });
    else if(m[2] !== undefined) tokens.push({ type:'ref', value: m[2] });
    else if(m[3] !== undefined) tokens.push({ type:'ident', value: m[3] });
    else if(m[4] !== undefined) tokens.push({ type: (m[4] === '(' || m[4] === ')') ? 'paren' : (m[4] === ':' ? 'colon' : 'op'), value: m[4] });
  }
  return tokens;
}

export function createSheetEvaluator(cells){
  const cache = new Map();

  function getCellValue(ref){
    if(cache.has(ref)) return cache.get(ref);
    const cell = cells[ref];
    if(!cell){ cache.set(ref, 0); return 0; }
    let value = 0;
    if(cell.formula !== undefined) value = evaluateFormula(cell.formula);
    else if(cell.value !== undefined) value = cell.value;
    cache.set(ref, value);
    return value;
  }

  function sumRange(startRef, endRef){
    const startCol = startRef.match(/^[A-Z]+/)[0];
    const endCol = endRef.match(/^[A-Z]+/)[0];
    if(startCol !== endCol) throw new Error(`SUM de rango multi-columna no soportado: ${startRef}:${endRef}`);
    const startRow = Number(startRef.match(/\d+$/)[0]);
    const endRow = Number(endRef.match(/\d+$/)[0]);
    let sum = 0;
    for(let r = startRow; r <= endRow; r++) sum += getCellValue(`${startCol}${r}`);
    return sum;
  }

  function evaluateFormula(formula){
    const tokens = tokenize(formula);
    let pos = 0;
    const peek = () => tokens[pos];
    const advance = () => tokens[pos++];
    const expect = (value) => {
      const tok = advance();
      if(!tok || tok.value !== value) throw new Error(`Se esperaba "${value}" en formula "${formula}"`);
    };

    function parseExpr(){
      let value = parseTerm();
      while(peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')){
        const op = advance().value;
        const rhs = parseTerm();
        value = op === '+' ? value + rhs : value - rhs;
      }
      return value;
    }
    function parseTerm(){
      let value = parseFactor();
      while(peek() && peek().type === 'op' && (peek().value === '*' || peek().value === '/')){
        const op = advance().value;
        const rhs = parseFactor();
        value = op === '*' ? value * rhs : value / rhs;
      }
      return value;
    }
    function parseFactor(){
      const tok = peek();
      if(!tok) throw new Error(`Formula incompleta: "${formula}"`);
      if(tok.type === 'num'){ advance(); return tok.value; }
      if(tok.type === 'ref'){ advance(); return getCellValue(tok.value); }
      if(tok.type === 'ident' && tok.value === 'SUM'){
        advance();
        expect('(');
        const startTok = advance();
        expect(':');
        const endTok = advance();
        expect(')');
        return sumRange(startTok.value, endTok.value);
      }
      if(tok.type === 'paren' && tok.value === '('){
        advance();
        const value = parseExpr();
        expect(')');
        return value;
      }
      throw new Error(`Token inesperado ${JSON.stringify(tok)} en formula "${formula}"`);
    }

    return parseExpr();
  }

  return { getCellValue };
}
