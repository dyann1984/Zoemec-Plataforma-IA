/* Visor 2D de plano con overlays por capa (Fase B, punto 8). Dibuja la
   pagina PDF (canvas, pdfClientRender.js) como fondo y superpone un SVG con
   un shape por elemento -- CADA shape se rotula visualmente segun su
   `origin` (VECTOR_DETECTED/AI_APPROXIMATION/USER_DRAWN/USER_CORRECTED,
   ver planoReview.js) para nunca presentar una aproximacion de IA como si
   fuera geometria exacta (punto 4, regla explicita del usuario): solo
   VECTOR_DETECTED se dibuja con linea solida; el resto usa trazo punteado +
   una etiqueta "aprox." visible al seleccionarlo.

   Modo calibracion (punto 3): dos clics sobre el canvas capturan Punto A y
   Punto B en coordenadas PDF reales (canvasPointToPdfPoint), listos para
   calibrateScale(pixelDistancePdf, distanciaReal) en el llamador. */
import { useEffect, useRef, useState } from 'react';
import { loadPdfDocument, pdfPointToCanvasPoint, canvasPointToPdfPoint } from '../../lib/pdfClientRender.js';

const LAYER_BY_TIPO = {
  muro: 'muros', puerta: 'puertas', ventana: 'ventanas', columna: 'columnas',
  piso: 'areas', losa: 'areas', plafon: 'areas', habitacion: 'areas',
  cota: 'cotas', eje: 'ejes', trabe: 'muros', otro: 'muros'
};

const COLOR_BY_TIPO = {
  muro: '#2A1740', puerta: '#B45309', ventana: '#0369A1', columna: '#7C2D12',
  piso: '#166534', losa: '#166534', plafon: '#166534', habitacion: '#7C3AED',
  cota: '#6B7280', eje: '#DC2626', trabe: '#2A1740', otro: '#6D6078'
};

function isDashedOrigin(origin){
  return origin !== 'VECTOR_DETECTED';
}

function elementCanvasShape(el, viewport){
  if(el.geometry?.kind === 'segments'){
    const points = [];
    el.geometry.segments.forEach((seg, i) => {
      const a = pdfPointToCanvasPoint(viewport, seg.x1, seg.y1);
      const b = pdfPointToCanvasPoint(viewport, seg.x2, seg.y2);
      if(i === 0) points.push(a);
      points.push(b);
    });
    return { kind: 'polyline', points };
  }
  if(el.geometry?.kind === 'bbox' && viewport){
    const box = el.geometry.bbox;
    // bbox de IA: fraccion 0-1 de la pagina completa -- se escala directo al
    // tamano del canvas (NO pasa por convertToViewportPoint: no es un punto
    // PDF real, es una aproximacion visual relativa, ver punto 4).
    return {
      kind: 'rect',
      x: box.x0 * viewport.width, y: box.y0 * viewport.height,
      width: (box.x1 - box.x0) * viewport.width, height: (box.y1 - box.y0) * viewport.height
    };
  }
  return null;
}

export default function PlanoOverlayViewer({
  dataUrl, mimeType, pageNumber = 1, elementos = [], visibleLayers, selectedElementId,
  onElementClick, calibrationMode = false, onCalibrationPoints, scale = 1.4
}){
  const canvasRef = useRef(null);
  const renderGenerationRef = useRef(0);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [viewport, setViewport] = useState(null);
  const [calibPoints, setCalibPoints] = useState([]);
  const [error, setError] = useState('');

  const isPdf = /pdf/i.test(mimeType || '');

  useEffect(() => {
    setCalibPoints([]);
  }, [calibrationMode]);

  useEffect(() => {
    if(calibPoints.length === 2) onCalibrationPoints?.(calibPoints);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calibPoints]);

  useEffect(() => {
    let cancelled = false;
    if(!isPdf || !dataUrl) return;
    loadPdfDocument(dataUrl).then(doc => { if(!cancelled) setPdfDoc(doc); }).catch(err => setError(err.message || 'No se pudo abrir el PDF.'));
    return () => { cancelled = true; };
  }, [dataUrl, isPdf]);

  useEffect(() => {
    if(!pdfDoc || !canvasRef.current) return;
    // Contador de generacion (en vez de renderTask.cancel()): probado en
    // vivo que pdfjs-dist puede dejar un SEGUNDO render() colgado
    // indefinidamente (nunca resuelve ni rechaza) cuando el PRIMERO se
    // cancela a medio render sobre el mismo objeto Page -- exactamente el
    // patron que dispara React 18 StrictMode (monta, desmonta, remonta el
    // efecto una vez en desarrollo). En vez de pelear con esa cancelacion
    // interna, cada corrida de este efecto reclama un numero de generacion
    // propio; el render se deja correr hasta el final SIEMPRE (nunca se
    // cancela), pero solo la generacion MAS RECIENTE puede publicar su
    // resultado con setViewport -- una generacion vieja que termina tarde
    // se descarta en silencio, nunca pisa un resultado mas nuevo ni cuelga
    // la UI esperando una promesa que pdfjs nunca resuelve.
    const myGeneration = ++renderGenerationRef.current;
    (async () => {
      const page = await pdfDoc.getPage(pageNumber);
      if(renderGenerationRef.current !== myGeneration || !canvasRef.current) return;
      const vp = page.getViewport({ scale });
      canvasRef.current.width = vp.width;
      canvasRef.current.height = vp.height;
      const ctx = canvasRef.current.getContext('2d');
      try{
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        if(renderGenerationRef.current === myGeneration) setViewport(vp);
      }catch(err){
        if(renderGenerationRef.current === myGeneration){
          setError(err.message || 'No se pudo renderizar la pagina.');
        }
      }
    })();
  }, [pdfDoc, pageNumber, scale]);

  if(!isPdf){
    return <div className="plano-overlay-viewer-fallback"><img src={dataUrl} alt="Plano" style={{ maxWidth: '100%' }} /></div>;
  }
  if(error) return <p style={{ color: 'var(--danger)' }}>{error}</p>;

  const handleCanvasClick = (ev) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    const canvasX = (ev.clientX - rect.left) * scaleX;
    const canvasY = (ev.clientY - rect.top) * scaleY;
    if(calibrationMode && viewport){
      const pdfPoint = canvasPointToPdfPoint(viewport, canvasX, canvasY);
      // Forma funcional (prev => ...), nunca `[...calibPoints, ...]` leyendo
      // el closure: dos clics muy seguidos (o incluso un solo evento
      // 'dblclick' del sistema operativo) pueden despachar dos eventos
      // 'click' ANTES de que React re-renderice entre ellos -- con el
      // closure stale, ambos verian el mismo `calibPoints` viejo y el
      // segundo clic pisaria al primero en vez de acumularse (bug real,
      // reproducido con clics sinteticos consecutivos).
      setCalibPoints(prev => [...prev, { canvasX, canvasY, ...pdfPoint }].slice(-2));
      return;
    }
  };

  const elementsForPage = elementos.filter(el => (el.pagina ?? 1) === pageNumber);

  return <div className="plano-overlay-viewer" style={{ position: 'relative', display: 'inline-block' }}>
    <canvas ref={canvasRef} onClick={handleCanvasClick} style={{ display: 'block', maxWidth: '100%', cursor: calibrationMode ? 'crosshair' : 'default' }} />
    {viewport && <svg
      width={viewport.width} height={viewport.height}
      style={{ position: 'absolute', top: 0, left: 0, width: canvasRef.current?.style.width || '100%', pointerEvents: 'none' }}
      viewBox={`0 0 ${viewport.width} ${viewport.height}`}
    >
      {elementsForPage.map(el => {
        const layer = LAYER_BY_TIPO[el.tipo] || 'muros';
        if(visibleLayers && visibleLayers[layer] === false) return null;
        const shape = elementCanvasShape(el, viewport);
        if(!shape) return null;
        const color = COLOR_BY_TIPO[el.tipo] || '#6D6078';
        const isSelected = el.id === selectedElementId;
        const dashed = isDashedOrigin(el.origin);
        const common = {
          stroke: color, strokeWidth: isSelected ? 3.5 : 2, fill: 'none',
          strokeDasharray: dashed ? '6,4' : undefined,
          opacity: el.estado === 'RECHAZADO' ? 0.3 : 1,
          style: { pointerEvents: 'stroke', cursor: 'pointer' },
          onClick: () => onElementClick?.(el)
        };
        if(shape.kind === 'polyline'){
          const pointsAttr = shape.points.map(p => `${p.x},${p.y}`).join(' ');
          return <polyline key={el.id} points={pointsAttr} {...common} />;
        }
        return <rect key={el.id} x={shape.x} y={shape.y} width={shape.width} height={shape.height}
          {...common} style={{ ...common.style, pointerEvents: 'stroke' }} />;
      })}
      {calibrationMode && calibPoints.map((p, i) => <circle key={i} cx={p.canvasX} cy={p.canvasY} r={5} fill="#DC2626" />)}
      {calibrationMode && calibPoints.length === 2 && (
        <line x1={calibPoints[0].canvasX} y1={calibPoints[0].canvasY} x2={calibPoints[1].canvasX} y2={calibPoints[1].canvasY} stroke="#DC2626" strokeWidth={2} strokeDasharray="4,3" />
      )}
    </svg>}
  </div>;
}
