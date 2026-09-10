/* Cooldown puro para el boton "Reenviar correo de verificacion" (item 6 del
   incidente de produccion: flujo de recuperacion para el "usuario
   atrapado"). Antes, un intento de login con una cuenta sin verificar
   disparaba sendEmailVerification() automaticamente en CADA intento -- si el
   usuario reintentaba varias veces seguidas (ej. por error de contrasena),
   podia acercarse al limite de Firebase (auth/too-many-requests) sin
   haberlo pedido. Ahora el reenvio es una accion explicita del usuario, y
   este cooldown evita clics repetidos accidentales -- es una ayuda de UX,
   NO el limite de seguridad real (ese lo sigue imponiendo Firebase). */

export const RESEND_COOLDOWN_MS = 60_000;

export function canResendVerification(lastSentAt, now = Date.now()){
  if(!lastSentAt) return true;
  return now - lastSentAt >= RESEND_COOLDOWN_MS;
}

export function remainingCooldownSeconds(lastSentAt, now = Date.now()){
  if(!lastSentAt) return 0;
  const remain = RESEND_COOLDOWN_MS - (now - lastSentAt);
  return remain > 0 ? Math.ceil(remain / 1000) : 0;
}
