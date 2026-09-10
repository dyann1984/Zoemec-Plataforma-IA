/* Resuelve el texto visible de un finding de auditoria (apuAuditor.js) en el
   idioma activo, a partir de SU CODIGO + params -- nunca del campo
   `message` (que sigue existiendo por compatibilidad con codigo/pruebas que
   ya lo leian antes de esta ronda, pero es texto fijo en espanol: la UI/PDF/
   Excel ya NO deben mostrarlo directo si `t` esta disponible).

   `t`: la funcion useI18n().t (o cualquier (key,params)=>string con el
   mismo contrato de src/i18n/i18nStorage.js). Sin `t` (o si la clave no
   existe en ningun idioma), cae al `message` original en espanol -- nunca
   deja el texto vacio ni expone la clave cruda ("findings.xyz") al
   usuario. */
export function resolveFindingMessage(t, finding){
  if(!finding?.code) return finding?.message || '';
  if(typeof t !== 'function') return finding.message || '';
  const params = finding.params || {};
  // Algunos codigos (ver non_finite_value en src/lib/apuCalc.js: se dispara
  // tanto a nivel de renglon completo -- sin `field` -- como a nivel de un
  // campo especifico del renglon -- con `field`) tienen una variante de
  // plantilla mas especifica cuando el finding trae `field`. El CODIGO en si
  // nunca cambia (src/domain/apuConfidence.js filtra findings por code
  // exacto para el calculo de Confidence -- renombrarlo romperia eso), solo
  // la CLAVE de traduccion que se resuelve.
  const baseKey = `findings.${finding.code}`;
  const fieldKey = `${baseKey}_field`;
  let translated = null;
  if(params.field != null){
    const attempt = t(fieldKey, params);
    if(attempt && attempt !== fieldKey) translated = attempt;
  }
  if(translated == null){
    const attempt = t(baseKey, params);
    if(attempt && attempt !== baseKey) translated = attempt;
  }
  return translated ?? (finding.message || '');
}

/* Mismo criterio para un texto de severidad (CRITICAL/HIGH/MEDIUM/LOW/INFO
   -- ver AUDIT_SEVERITY en apuAuditor.js): la UI nunca debe mostrar el
   enum crudo en ingles cuando el idioma activo es espanol y viceversa. */
export function resolveSeverityLabel(t, severity){
  if(!severity) return '';
  if(typeof t !== 'function') return severity;
  const key = `findings.severity.${severity}`;
  const translated = t(key);
  return translated && translated !== key ? translated : severity;
}
