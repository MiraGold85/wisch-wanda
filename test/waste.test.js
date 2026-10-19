import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importWaste, wasteDue, wasteDone, wasteIcon, nextPickups } from '../js/waste.js';
import { freshState, toggleWaste, addAssignment, toggleAssignment, setPusher } from '../js/store.js';

const TODAY = '2026-10-19'; // Montag

const ICS = [
  'BEGIN:VCALENDAR', 'X-WR-CALNAME:Abfuhr Musterstraße',
  // Gelbe Tonne alle 2 Wochen dienstags, ab morgen
  'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261020', 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU', 'SUMMARY:Gelbe Tonne', 'END:VEVENT',
  // Restmüll jeden Donnerstag, einmal ausgesetzt (Feiertag verschoben)
  'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261022', 'RRULE:FREQ=WEEKLY;BYDAY=TH', 'EXDATE;VALUE=DATE:20261029', 'SUMMARY:Restmüll', 'END:VEVENT',
  // Einzeltermin mit Zeilenumbruch im Titel (ICS-Faltung)
  'BEGIN:VEVENT', 'DTSTART:20261030T060000Z', 'SUMMARY:Sperrmüll\\, angem', ' eldet', 'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('ICS: Wiederholungen, Ausnahmen, Einzeltermine', () => {
  const w = importWaste(ICS, 'abfall.ics', TODAY);
  assert.equal(w.name, 'Abfuhr Musterstraße');
  const days = (t) => w.events.filter((e) => e.t === t).map((e) => e.d);
  assert.deepEqual(days('Gelbe Tonne').slice(0, 3), ['2026-10-20', '2026-11-03', '2026-11-17']);
  assert.deepEqual(days('Restmüll').slice(0, 3), ['2026-10-22', '2026-11-05', '2026-11-12']);
  assert.deepEqual(days('Sperrmüll, angemeldet'), ['2026-10-30']);
  assert.equal(wasteIcon('Gelbe Tonne'), '🟡');
  assert.equal(wasteIcon('Restmüll'), '⚫');
  assert.equal(nextPickups(w, TODAY, 1)[0].t, 'Gelbe Tonne');
});

test('Am Vorabend und am Abholtag fällig, danach nicht mehr', () => {
  const w = importWaste(ICS, 'abfall.ics', TODAY);
  assert.deepEqual(wasteDue(w, TODAY).map((e) => [e.title, e.today]), [['Gelbe Tonne rausstellen', false]]);
  assert.deepEqual(wasteDue(w, '2026-10-20').map((e) => e.title), ['Gelbe Tonne rausstellen']);
  assert.equal(wasteDue(w, '2026-10-23').length, 0);
});

test('Rausstellen am Vorabend zählt auch am Abholtag als erledigt', () => {
  setPusher(() => {});
  const state = freshState(TODAY);
  state.waste = importWaste(ICS, 'abfall.ics', TODAY);
  const [gelb] = wasteDue(state.waste, TODAY);
  const entry = toggleWaste(state, gelb, TODAY, 'm1');
  assert.equal(entry.points, 10);
  assert.ok(wasteDone(state.history, wasteDue(state.waste, '2026-10-20')[0]));
  toggleWaste(state, gelb, '2026-10-20', 'm1');
  assert.equal(state.history.length, 0);
});

test('Zugeschickte Tonne: Erledigen über die Müll-Karte schließt die Zuweisung', () => {
  setPusher(() => {});
  const state = freshState(TODAY);
  state.waste = importWaste(ICS, 'abfall.ics', TODAY);
  const a = addAssignment(state, { to: 'jonas', from: 'm1', title: 'Gelbe Tonne rausstellen', points: 10 });
  toggleWaste(state, wasteDue(state.waste, TODAY)[0], TODAY, 'jonas');
  assert.equal(a.doneAt, TODAY);
  // umgekehrt: Zuweisung abhaken zählt als rausgestellt
  const s2 = freshState(TODAY);
  s2.waste = state.waste;
  const b = addAssignment(s2, { to: 'jonas', from: 'm1', title: 'Gelbe Tonne rausstellen', points: 10 });
  toggleAssignment(s2, b.id, TODAY, 'jonas');
  assert.ok(wasteDone(s2.history, wasteDue(s2.waste, TODAY)[0]));
});
