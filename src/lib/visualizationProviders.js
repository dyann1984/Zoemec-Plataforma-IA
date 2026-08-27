/* Interfaz de visualizacion (punto 18 del spec del usuario): separa
   deliberadamente DOS salidas distintas, para nunca confundir una con otra:

     MODELO TECNICO      -- geometria parametrica determinista (implementado
                             en esta fase, ver src/domain/geometry3d.js).
     VISUALIZACION IA     -- un render fotorrealista generado por un
                             proveedor externo de imagenes. NO se implementa
                             en esta fase (requiere elegir proveedor +
                             credenciales, decision explicita del usuario) --
                             solo se deja la interfaz lista para conectarlo
                             despues sin tocar el motor de APU ni el modelo
                             tecnico.

   getAIRenderProvider() SIEMPRE devuelve NullAIRenderProvider mientras no
   haya una variable de entorno VITE_AI_RENDER_PROVIDER apuntando a un
   proveedor real registrado en AI_RENDER_PROVIDERS -- nunca se simula un
   render ni se marca como disponible sin credenciales configuradas. */
import { deriveGeometryFromApu } from '../domain/geometry3d.js';

/* TechnicalModelProvider: unico proveedor real de esta fase. Envuelve
   geometry3d.js sin agregar logica propia -- el "proveedor" existe para que
   el consumidor (Technical3DViewer.jsx) trate ambos tipos de visualizacion
   con la misma forma de llamada, sin acoplarse a un motor concreto. */
export const TechnicalModelProvider = Object.freeze({
  kind: 'MODELO_TECNICO',
  name: 'technical-parametric',
  available: true,
  async generate(apu){
    return deriveGeometryFromApu(apu);
  }
});

/* AIRenderProvider (interfaz): cualquier proveedor real (OpenAI Images,
   Stability, etc.) debe implementar esta forma -- {kind:'VISUALIZACION_IA',
   name, available:true, async generate(apu, options) => {available:true,
   image, provider, disclaimer}}. Ningun proveedor real esta registrado en
   esta fase (ver AI_RENDER_PROVIDERS abajo, vacio a proposito). */
export const NullAIRenderProvider = Object.freeze({
  kind: 'VISUALIZACION_IA',
  name: 'none',
  available: false,
  async generate(){
    return { available: false, reason: 'NO_PROVIDER_CONFIGURED', image: null };
  }
});

/* Registro de proveedores de render IA reales -- vacio en esta fase. Un
   proveedor futuro se agrega aqui por nombre (ej. AI_RENDER_PROVIDERS['openai-images']
   = {...}) y se activa por variable de entorno, nunca hardcodeado como
   "el" proveedor. */
export const AI_RENDER_PROVIDERS = Object.freeze({});

export function getAIRenderProvider(name){
  const key = name || (typeof import.meta !== 'undefined' ? import.meta.env?.VITE_AI_RENDER_PROVIDER : null);
  return (key && AI_RENDER_PROVIDERS[key]) || NullAIRenderProvider;
}
