/* Generador de identificadores cortos legibles (APU-XXXXXX, PRE-XXXXXX,
   DEV-XXXXXX-...). No es criptografico: solo necesita ser corto y unico lo
   suficiente para claves de UI y dispositivos locales. */
export const uid = () => Math.random().toString(36).slice(2, 8).toUpperCase();
