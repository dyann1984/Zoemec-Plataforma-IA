/* Prueba estructural del diccionario ES/EN completo, aislada bajo node --test.
   Motivada por esta ronda: se agregaron ~500 claves nuevas (apu, library,
   academy, visualAi, takeoff, takeoffManual, gdrive, onedrive, clients, dash,
   budget, config, zoe, projects) a mano, en bloques grandes -- un typo en una
   sola clave EN (o un bloque ES sin su espejo EN) rompe t() en silencio para
   ese modulo (translate() cae a la clave cruda), y con este volumen de
   ediciones no es realista revisar cada clave a ojo. Esta prueba recorre TODO
   el arbol, no solo un puñado de "claves criticas" a mano. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { translations } from './translations.js';

function collectLeafPaths(obj, prefix = ''){
  const paths = [];
  for(const key of Object.keys(obj)){
    const value = obj[key];
    const path = prefix ? `${prefix}.${key}` : key;
    if(Array.isArray(value)){
      paths.push(path);
    }else if(value && typeof value === 'object'){
      paths.push(...collectLeafPaths(value, path));
    }else{
      paths.push(path);
    }
  }
  return paths;
}

function getByPathLocal(obj, path){
  return path.split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);
}

test('todas las claves hoja de ES existen en EN (sin huecos de traduccion)', () => {
  const esPaths = collectLeafPaths(translations.es);
  const missing = esPaths.filter(p => getByPathLocal(translations.en, p) === undefined);
  assert.deepEqual(missing, [], `faltan en EN: ${missing.join(', ')}`);
});

test('todas las claves hoja de EN existen en ES (sin claves huerfanas)', () => {
  const enPaths = collectLeafPaths(translations.en);
  const missing = enPaths.filter(p => getByPathLocal(translations.es, p) === undefined);
  assert.deepEqual(missing, [], `faltan en ES: ${missing.join(', ')}`);
});

test('ninguna clave hoja de tipo string esta vacia en ES ni en EN', () => {
  const esPaths = collectLeafPaths(translations.es);
  const empty = [];
  for(const p of esPaths){
    const esVal = getByPathLocal(translations.es, p);
    const enVal = getByPathLocal(translations.en, p);
    if(typeof esVal === 'string' && esVal.trim() === '') empty.push(`es.${p}`);
    if(typeof enVal === 'string' && enVal.trim() === '') empty.push(`en.${p}`);
  }
  assert.deepEqual(empty, []);
});

test('los grupos de claves agregados esta ronda existen completos en ES y EN', () => {
  const groups = ['apu', 'library', 'academy', 'visualAi', 'takeoff', 'takeoffManual', 'gdrive', 'onedrive', 'clients'];
  for(const g of groups){
    assert.ok(translations.es[g] && typeof translations.es[g] === 'object', `falta grupo es.${g}`);
    assert.ok(translations.en[g] && typeof translations.en[g] === 'object', `falta grupo en.${g}`);
    const esKeys = Object.keys(translations.es[g]).sort();
    const enKeys = Object.keys(translations.en[g]).sort();
    assert.deepEqual(esKeys, enKeys, `las claves de "${g}" no coinciden entre ES y EN`);
  }
});

test('ZOEMEC/ZOE se conservan sin traducir en las claves nuevas de esta ronda', () => {
  const pairs = [
    ['apu.fallbackBannerText', 'ZOEMEC', 'ZOEMEC'],
    ['library.lockedText', 'IA', 'AI'],
    ['takeoff.readyForApuMsg', 'APU', 'APU'],
  ];
  for(const [key, esBrand, enBrand] of pairs){
    const es = getByPathLocal(translations.es, key);
    const en = getByPathLocal(translations.en, key);
    assert.ok(es.includes(esBrand), `ES ${key} deberia incluir ${esBrand}`);
    assert.ok(en.includes(enBrand), `EN ${key} deberia incluir ${enBrand}`);
  }
});

test('las claves con parametros {placeholder} conservan los mismos placeholders en ES y EN', () => {
  const esPaths = collectLeafPaths(translations.es);
  const mismatches = [];
  for(const p of esPaths){
    const esVal = getByPathLocal(translations.es, p);
    const enVal = getByPathLocal(translations.en, p);
    if(typeof esVal !== 'string' || typeof enVal !== 'string') continue;
    const esParams = [...esVal.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
    const enParams = [...enVal.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
    if(esParams.length || enParams.length){
      if(JSON.stringify(esParams) !== JSON.stringify(enParams)){
        mismatches.push(`${p}: es=[${esParams}] en=[${enParams}]`);
      }
    }
  }
  assert.deepEqual(mismatches, []);
});
