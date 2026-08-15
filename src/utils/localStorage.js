import { uid } from './id.js';

export function getDeviceId(){
  let id = localStorage.getItem('zoemec-device-id');
  if(!id){
    id = 'DEV-' + uid() + '-' + Date.now().toString(36).toUpperCase();
    localStorage.setItem('zoemec-device-id', id);
  }
  return id;
}

export function readLocal(key, fallback){
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

export function writeLocal(key, value){
  localStorage.setItem(key, JSON.stringify(value));
}
