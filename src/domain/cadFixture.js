/* Fixture visual obligatorio del Plano Inteligente (punto 19): local de
   8.00 x 8.00 m (a ejes), altura 3.00 m, espesor 0.15 m, una puerta 0.90 x
   2.10 m y una ventana 2.00 x 1.20 m (antepecho 0.90 m). Se construye con
   las MISMAS mutaciones publicas de cadModel.js que usa la UI -- si el
   fixture se ve bien, es porque el camino real funciona, no por un atajo.

   Muros en sentido horario en pantalla (y hacia abajo): M-01 arriba, M-02
   derecha, M-03 abajo, M-04 izquierda -- la normal "izquierda" de cada muro
   apunta al interior, asi que las cotas usan desfase negativo (afuera). */
import { createEmptyCadModel, addWall, addOpening, addSpace, addDimension, CAD_SOURCE, OPENING_TYPE } from './cadModel.js';

export const FIXTURE_SPEC = Object.freeze({
  side: 8, height: 3, thickness: 0.15,
  door: { width: 0.9, height: 2.1, wallId: 'M-01', offset: 1.0 },
  window: { width: 2.0, height: 1.2, sill: 0.9, wallId: 'M-03', offset: 3.0 }
});

export function buildFixtureCadModel(){
  const { side, height, thickness, door, window } = FIXTURE_SPEC;
  let model = createEmptyCadModel({ defaults: { wallHeight: height, wallThickness: thickness } });
  const corners = [{ x: 0, y: 0 }, { x: side, y: 0 }, { x: side, y: side }, { x: 0, y: side }];
  for(let i = 0; i < 4; i++){
    const a = corners[i], b = corners[(i + 1) % 4];
    ({ model } = addWall(model, { x1: a.x, y1: a.y, x2: b.x, y2: b.y, thickness, height, source: CAD_SOURCE.FIXTURE }));
  }
  ({ model } = addOpening(model, { type: OPENING_TYPE.DOOR, wallId: door.wallId, offset: door.offset, width: door.width, height: door.height, sill: 0, source: CAD_SOURCE.FIXTURE }));
  ({ model } = addOpening(model, { type: OPENING_TYPE.WINDOW, wallId: window.wallId, offset: window.offset, width: window.width, height: window.height, sill: window.sill, source: CAD_SOURCE.FIXTURE }));
  ({ model } = addSpace(model, { name: 'Local 8×8', points: corners, source: CAD_SOURCE.FIXTURE }));
  ({ model } = addDimension(model, { wallId: 'M-01', offset: -0.7, source: CAD_SOURCE.FIXTURE }));
  ({ model } = addDimension(model, { wallId: 'M-02', offset: -0.7, source: CAD_SOURCE.FIXTURE }));
  return model;
}
