import { useState, useEffect, useCallback } from 'react';

/* Encapsula el flujo de instalacion PWA. Chrome/Edge/Android disparan
   'beforeinstallprompt' cuando el navegador considera la app instalable
   (manifest valido + service worker registrado + criterios de engagement
   del navegador) -- lo capturamos y evitamos el mini-infobar nativo
   (preventDefault) para poder mostrar nuestro propio boton discreto.
   Safari/iOS nunca dispara este evento (no soporta beforeinstallprompt),
   por eso isIOSSafari existe aparte para mostrar la ayuda manual
   "Compartir -> Anadir a pantalla de inicio" solo ahi. */
// Exportadas para probarlas aisladas bajo node --test (mockeando
// navigator/window) sin necesitar un navegador real -- ver
// src/hooks/useInstallPrompt.test.js.
export function detectIOSSafari(){
  if(typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  return isIOS && isSafari;
}

export function detectStandalone(){
  if(typeof window === 'undefined') return false;
  const mql = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
  // iOS expone esta bandera propia en vez de display-mode.
  return Boolean(mql || window.navigator.standalone);
}

export function useInstallPrompt(){
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(detectStandalone);
  const [isIOSSafari] = useState(detectIOSSafari);

  useEffect(() => {
    const onBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    const onInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if(!deferredPrompt) return null;
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    return choice;
  }, [deferredPrompt]);

  const canInstall = Boolean(deferredPrompt) && !isInstalled;
  const showIOSHint = isIOSSafari && !isInstalled;

  return { canInstall, promptInstall, showIOSHint, isInstalled };
}
