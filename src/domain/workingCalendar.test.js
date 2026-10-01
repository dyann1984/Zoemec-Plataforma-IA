import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCalendar, isWorkingDay, addWorkingDays, workingDaysBetween, nextWorkingDay, DEFAULT_WORKDAYS } from './workingCalendar.js';

/* Caso obligatorio §23: inicio 2026-10-01 (jueves) L-S, duracion 8 dias =
   fecha fin 2026-10-09 (viernes de la semana siguiente).

   2026-10-01 Jue
   2026-10-02 Vie
   2026-10-03 Sab
   2026-10-04 Dom  (no laborable)
   2026-10-05 Lun
   2026-10-06 Mar
   2026-10-07 Mie
   2026-10-08 Jue
   2026-10-09 Vie  <- dia 8

   Convencion: duracion 1 dia = inicio y fin en el mismo dia laboral, por
   eso 8 dias son inicio + 7 laborables siguientes. */
test('calendario L-S: 2026-10-01 + 8 dias = 2026-10-09', () => {
  const cal = makeCalendar({ workdays: DEFAULT_WORKDAYS });
  const end = addWorkingDays(cal, '2026-10-01', 8);
  assert.equal(end, '2026-10-09');
});

test('calendario L-V (sabado tambien apagado): 2026-10-01 + 8 dias = 2026-10-12', () => {
  const cal = makeCalendar({ workdays: [1,2,3,4,5] });
  const end = addWorkingDays(cal, '2026-10-01', 8);
  // Jue 1 + 7 dias hab = Vie 2, Lun 5, Mar 6, Mie 7, Jue 8, Vie 9, Lun 12
  assert.equal(end, '2026-10-12');
});

test('isWorkingDay: L-S por default -> domingo es false, sabado true', () => {
  const cal = makeCalendar();
  assert.equal(isWorkingDay(cal, '2026-10-03'), true, 'sabado');
  assert.equal(isWorkingDay(cal, '2026-10-04'), false, 'domingo');
});

test('feriado: 2026-10-05 declarado -> ese dia no cuenta', () => {
  const cal = makeCalendar({ holidays: ['2026-10-05'] });
  assert.equal(isWorkingDay(cal, '2026-10-05'), false);
  // 2026-10-01 (Jue) + 3 dias laborales, con lunes 5 feriado:
  //   dia 1: Jue 01
  //   dia 2: Vie 02
  //   dia 3: Sab 03 (dom 04 no, lun 05 feriado, mar 06)
  const end = addWorkingDays(cal, '2026-10-01', 3);
  assert.equal(end, '2026-10-03');
});

test('addWorkingDays: si el inicio cae en domingo (no laborable), se empuja al lunes', () => {
  const cal = makeCalendar();
  // 2026-10-04 = Domingo -> se empuja al Lun 05, duracion 1 dia
  const end = addWorkingDays(cal, '2026-10-04', 1);
  assert.equal(end, '2026-10-05');
});

test('workingDaysBetween: 2026-10-01 -> 2026-10-09 con L-S = 8', () => {
  const cal = makeCalendar();
  assert.equal(workingDaysBetween(cal, '2026-10-01', '2026-10-09'), 8);
});

test('workingDaysBetween: L-V mismo rango 2026-10-01 -> 2026-10-09 = 7', () => {
  const cal = makeCalendar({ workdays: [1,2,3,4,5] });
  // Sabados excluidos: 03. Domingo: 04. 01,02,05,06,07,08,09 = 7
  assert.equal(workingDaysBetween(cal, '2026-10-01', '2026-10-09'), 7);
});

test('workingDaysBetween: to < from -> 0 (nunca negativo)', () => {
  const cal = makeCalendar();
  assert.equal(workingDaysBetween(cal, '2026-10-09', '2026-10-01'), 0);
});

test('nextWorkingDay: 2026-10-03 (sabado, L-V) -> lunes 2026-10-05', () => {
  const cal = makeCalendar({ workdays: [1,2,3,4,5] });
  assert.equal(nextWorkingDay(cal, '2026-10-03'), '2026-10-05');
});

test('addWorkingDays: duracion decimal 8.67 redondea a 9 dias laborables (upward)', () => {
  const cal = makeCalendar();
  // 2026-10-01 Jue + 9 dias hab con L-S = Sab 10
  const end = addWorkingDays(cal, '2026-10-01', 8.67);
  assert.equal(end, '2026-10-10');
});

test('addWorkingDays: duracion 0 -> misma fecha (o proxima laborable)', () => {
  const cal = makeCalendar();
  assert.equal(addWorkingDays(cal, '2026-10-01', 0), '2026-10-01');
  assert.equal(addWorkingDays(cal, '2026-10-04', 0), '2026-10-05'); // domingo -> lunes
});

test('addWorkingDays: fecha invalida -> null (no rompe)', () => {
  const cal = makeCalendar();
  assert.equal(addWorkingDays(cal, 'garbage', 5), null);
  assert.equal(addWorkingDays(cal, null, 5), null);
});
