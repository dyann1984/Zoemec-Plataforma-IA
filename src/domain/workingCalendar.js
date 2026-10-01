/* Calendario laboral simple (Fase 3, regla 10 del encargo). Puro.
   - Semana configurable (default L-S; domingo opcional)
   - Feriados como conjunto de fechas ISO YYYY-MM-DD
   - Sin zonas horarias -- todas las fechas se tratan como locales al
     proyecto (mismo criterio que el resto del dominio ZOEMEC, ver
     estimateSchema.js que usa ISO strings sin zona).

   NO es un motor de Primavera: solo soporta lo minimo necesario para el
   caso de prueba del brief §23 (Excavacion 480 m³ / 60 m³/dia / L-S =
   8 dias laborales). */

export const DAY_OF_WEEK = Object.freeze({
  SUNDAY: 0, MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6
});

export const DEFAULT_WORKDAYS = Object.freeze([1, 2, 3, 4, 5, 6]); // L a S

export function makeCalendar({ workdays = DEFAULT_WORKDAYS, holidays = [] } = {}){
  const validSet = new Set((workdays || []).map(Number).filter(n => n >= 0 && n <= 6));
  return {
    workdays: [...validSet].sort(),
    holidays: new Set((holidays || []).map(h => String(h).slice(0, 10))) // normaliza a YYYY-MM-DD
  };
}

function parseIsoDate(iso){
  if(!iso) return null;
  // YYYY-MM-DD o ISO -- se corta a YYYY-MM-DD y se instancia como fecha
  // local (00:00). Nunca UTC, para evitar corrimiento de un dia.
  const key = String(iso).slice(0, 10);
  const parts = key.split('-').map(Number);
  if(parts.length !== 3 || parts.some(p => !Number.isFinite(p))) return null;
  const [y, m, d] = parts;
  const dt = new Date(y, m - 1, d);
  if(Number.isNaN(dt.getTime())) return null;
  return dt;
}

function toIsoKey(date){
  if(!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isWorkingDay(calendar, iso){
  const dt = parseIsoDate(iso);
  if(!dt) return false;
  const key = toIsoKey(dt);
  const dow = dt.getDay();
  return calendar.workdays.includes(dow) && !calendar.holidays.has(key);
}

/* Avanza N dias laborables desde la fecha dada. N puede ser 0 (regresa la
   misma fecha si es laborable, sino la SIGUIENTE laborable).

   Devuelve string YYYY-MM-DD. Redondea `n` al entero mas cercano (una
   duracion de 8.67 dias se programa como 9 dias laborables -- se
   redondea hacia arriba para no comprometer terminacion sub-jornada). */
export function addWorkingDays(calendar, iso, n){
  const start = parseIsoDate(iso);
  if(!start) return null;
  const daysNeeded = Math.max(0, Math.ceil(Number(n) || 0));
  // Si daysNeeded es 0 y la fecha inicio ya es laborable, devuelve tal cual
  // (utilidad: normalizar una fecha de inicio a la primera laborable disp).
  let cursor = new Date(start.getTime());
  // Empuja el inicio a la primera laborable si no lo es (regla implicita:
  // el programa no arranca sabado si el calendario dice sabado no
  // laborable, ni empieza en domingo si esta apagado).
  while(!isWorkingDay(calendar, toIsoKey(cursor))){
    cursor.setDate(cursor.getDate() + 1);
  }
  if(daysNeeded === 0) return toIsoKey(cursor);
  // Convencion: si duracion = 1 dia, inicio y fin caen en el MISMO dia
  // laboral (el trabajo comienza y termina el mismo dia). Un dia laboral
  // adicional avanza uno mas. Es el convenio estandar de Gantt: fecha fin
  // inclusive.
  let workDaysCounted = 1;
  while(workDaysCounted < daysNeeded){
    cursor.setDate(cursor.getDate() + 1);
    if(isWorkingDay(calendar, toIsoKey(cursor))) workDaysCounted++;
  }
  return toIsoKey(cursor);
}

/* Cuenta dias laborables entre dos fechas (inclusivas). Devuelve 0 si el
   rango es invalido o si to < from. */
export function workingDaysBetween(calendar, fromIso, toIso){
  const from = parseIsoDate(fromIso);
  const to = parseIsoDate(toIso);
  if(!from || !to || to < from) return 0;
  let count = 0;
  const cursor = new Date(from.getTime());
  while(cursor <= to){
    if(isWorkingDay(calendar, toIsoKey(cursor))) count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

export function nextWorkingDay(calendar, iso){
  const dt = parseIsoDate(iso);
  if(!dt) return null;
  const cursor = new Date(dt.getTime());
  cursor.setDate(cursor.getDate() + 1);
  while(!isWorkingDay(calendar, toIsoKey(cursor))){
    cursor.setDate(cursor.getDate() + 1);
  }
  return toIsoKey(cursor);
}
