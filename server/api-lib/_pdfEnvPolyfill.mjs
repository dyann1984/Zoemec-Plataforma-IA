/* Polyfill minimo y puro (sin binarios nativos) de DOMMatrix 2D para que
   pdfjs-dist pueda cargarse y operar en el runtime serverless de Vercel.

   Hallazgo real (RC4, validacion productiva post-deploy): pdfjs-dist intenta
   usar `@napi-rs/canvas` (dependencia nativa OPCIONAL) para polyfillar
   `globalThis.DOMMatrix` cuando el entorno no lo trae de forma nativa
   (Node no tiene DOMMatrix). Localmente ese binario SI estaba instalado en
   disco (Windows), asi que todo funcionaba; en el runtime Linux de Vercel el
   empaquetador de la funcion serverless no lo incluyo (require dinamico
   dentro de pdfjs-dist, no detectable por el tracer estatico de Vercel), y
   pdfjs-dist fallaba con "DOMMatrix is not defined" -- incluso antes de leer
   una sola pagina del PDF (pdfjs-dist define `const SCALE_MATRIX = new
   DOMMatrix()` a nivel de modulo).

   Esta implementacion cubre EXACTAMENTE los metodos que pdfjs-dist invoca
   sobre DOMMatrix (verificado por grep sobre el propio pdf.mjs empaquetado):
   multiplySelf, preMultiplySelf, invertSelf, translate, scale, rotate.
   Es matematica de transformaciones afines 2D estandar (formulas CSS
   matrix(a,b,c,d,e,f)), no un recorte -- probada con casos de
   identidad/inversa/composicion en _pdfEnvPolyfill.test.mjs. No sustituye
   render a canvas (no se usa en este proyecto: solo texto/paginas), por eso
   no se polyfilla Path2D -- getTextContent() no lo requiere. */

function multiplyMatrices(m1, m2){
  // r = m1 x m2 (aplicar m2 primero, luego m1 -- misma convencion que
  // DOMMatrix.multiply del spec WHATWG Geometry Interfaces)
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f
  };
}

function invertMatrix(m){
  const det = m.a * m.d - m.b * m.c;
  if(!det){
    // Matriz no invertible: el spec real marca la matriz como "no
    // invertible" (todos NaN); para el uso interno de pdfjs-dist (texto)
    // esto es un caso extremo que no debe fingirse como valido.
    return { a: NaN, b: NaN, c: NaN, d: NaN, e: NaN, f: NaN };
  }
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det
  };
}

class MinimalDOMMatrix {
  constructor(init){
    if(Array.isArray(init) && init.length >= 6){
      [this.a, this.b, this.c, this.d, this.e, this.f] = init;
    }else if(init && typeof init === 'object'){
      this.a = init.a ?? 1; this.b = init.b ?? 0; this.c = init.c ?? 0;
      this.d = init.d ?? 1; this.e = init.e ?? 0; this.f = init.f ?? 0;
    }else{
      this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
    }
    this.is2D = true;
  }

  #assign(m){ this.a = m.a; this.b = m.b; this.c = m.c; this.d = m.d; this.e = m.e; this.f = m.f; return this; }

  multiply(other){ return new MinimalDOMMatrix(multiplyMatrices(this, other)); }
  multiplySelf(other){ return this.#assign(multiplyMatrices(this, other)); }
  preMultiplySelf(other){ return this.#assign(multiplyMatrices(other, this)); }

  invertSelf(){ return this.#assign(invertMatrix(this)); }
  inverse(){ return new MinimalDOMMatrix(invertMatrix(this)); }

  translate(tx = 0, ty = 0){ return this.multiply({ a: 1, b: 0, c: 0, d: 1, e: tx, f: ty }); }
  translateSelf(tx = 0, ty = 0){ return this.multiplySelf({ a: 1, b: 0, c: 0, d: 1, e: tx, f: ty }); }

  scale(sx = 1, sy = sx){ return this.multiply({ a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 }); }
  scaleSelf(sx = 1, sy = sx){ return this.multiplySelf({ a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 }); }

  rotate(angleDegrees = 0){
    const theta = (angleDegrees * Math.PI) / 180;
    const cos = Math.cos(theta), sin = Math.sin(theta);
    return this.multiply({ a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 });
  }
  rotateSelf(angleDegrees = 0){
    const theta = (angleDegrees * Math.PI) / 180;
    const cos = Math.cos(theta), sin = Math.sin(theta);
    return this.multiplySelf({ a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 });
  }

  transformPoint(point = { x: 0, y: 0 }){
    return { x: this.a * point.x + this.c * point.y + this.e, y: this.b * point.x + this.d * point.y + this.f, z: 0, w: 1 };
  }
}

export function ensurePdfEnvPolyfills(){
  if(!globalThis.DOMMatrix){
    globalThis.DOMMatrix = MinimalDOMMatrix;
  }
}

export { MinimalDOMMatrix };
