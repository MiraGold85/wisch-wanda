import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importWaste, importFromSchichtplaner, wasteDue, wasteDone, wasteIcon, nextPickups } from '../js/waste.js';
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

test('Abfalltermine aus der Schichtplaner-Sicherung – ohne Schichten oder andere Kalender', () => {
  const backup = {
    employers: [{ id: 'e1', name: 'Firma', wage: 14 }],
    shifts: [{ id: 's1', date: '2026-10-20' }],
    imports: [
      { id: 'i1', name: 'Abfuhrkalender 2026', events: [
        { d: '2026-10-01', t: 'Restmüll' }, { d: '2026-10-20', t: 'Gelbe Tonne' }, { d: '2026-10-22', t: 'Restmüll' },
      ] },
      { id: 'i2', name: 'Schulferien', events: [{ d: '2026-10-26', t: 'Herbstferien' }] },
    ],
  };
  const w = importFromSchichtplaner(backup, TODAY);
  assert.equal(w.name, 'Abfuhrkalender 2026');
  assert.deepEqual(w.events, [{ d: '2026-10-20', t: 'Gelbe Tonne' }, { d: '2026-10-22', t: 'Restmüll' }]);
  assert.deepEqual(Object.keys(w), ['name', 'events']);
  assert.equal(importFromSchichtplaner({ imports: [backup.imports[1]] }, TODAY), null);
  assert.equal(importFromSchichtplaner({}, TODAY), null);
});

test('ICS-Varianten verschiedener Städte werden gelesen', () => {
  const variants = {
    'Leerzeichen und Kleinbuchstaben': 'begin:vcalendar\nbegin:vevent \ndtstart;value=date:20261020 \nsummary:Gelbe Tonne\nend:vevent \nend:vcalendar',
    'Uhrzeit mit Zeitzone': 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;TZID=Europe/Berlin:20261020T060000\r\nSUMMARY:Gelbe Tonne\r\nEND:VEVENT\r\nEND:VCALENDAR',
    'Nur CR als Zeilenende': 'BEGIN:VCALENDAR\rBEGIN:VEVENT\rDTSTART:20261020\rSUMMARY:Gelbe Tonne\rEND:VEVENT\rEND:VCALENDAR',
    'BOM am Anfang': '﻿BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART;VALUE=DATE:20261020\nSUMMARY:Gelbe Tonne\nEND:VEVENT\nEND:VCALENDAR',
  };
  for (const [label, ics] of Object.entries(variants)) {
    const w = importWaste(ics, 'stadt.ics', TODAY);
    assert.deepEqual(w.events, [{ d: '2026-10-20', t: 'Gelbe Tonne' }], label);
  }
});

test('RDATE: Liste zusätzlicher Abholtage', () => {
  const ics = 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART;VALUE=DATE:20261020\nRDATE;VALUE=DATE:20261103,20261117\nSUMMARY:Bioabfall\nEND:VEVENT\nEND:VCALENDAR';
  assert.deepEqual(importWaste(ics, 'x.ics', TODAY).events.map((e) => e.d), ['2026-10-20', '2026-11-03', '2026-11-17']);
});

test('Vergangene Kalender: Info für eine verständliche Meldung', () => {
  const ics = 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART;VALUE=DATE:20250310\nSUMMARY:Restmüll\nEND:VEVENT\nEND:VCALENDAR';
  const w = importWaste(ics, 'alt.ics', TODAY);
  assert.equal(w.events.length, 0);
  assert.deepEqual(w.events.info, { found: 1, last: '2025-03-10' });
});
