// F4-QA -- shim de 'firebase/app' para el servidor QA local (nunca en build).
export function initializeApp(config = {}){ return { name: '[qa]', options: config }; }
export function getApps(){ return []; }
export function getApp(){ return { name: '[qa]' }; }
