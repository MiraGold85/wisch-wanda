import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '../js/planner.js';
import { freshState, toggleTask, syncStreakBonus, toggleClaim, claimOf, cleanupClaims, memberPoints, setPusher } from '../js/store.js';
import { personalStreak, badgesFor, isBonus } from '../js/rewards.js';

const TODAY = '2026-10-19';
const OVEN = 'kueche-backofen-reinigen';

function setup() {
  setPusher(() => {});
  const state = freshState(TODAY);
  state.members = [{ id: 'mama', name: 'Mama', emoji: '👩' }, { id: 'lena', name: 'Lena', emoji: '👧' }];
  return state;
}
// an n Tagen bis einschließlich heute je eine Aufgabe erledigen
function activeDays(state, member, n) {
  for (let i = n - 1; i >= 0; i--) state.history.push({ id: `h${member}${i}`, taskId: 'x', date: addDays(TODAY, -i), member, points: 5 });
}

test('Serie ist persönlich: Lenas Tage zählen nicht für Mama', () => {
  const state = setup();
  activeDays(state, 'lena', 5);
  assert.equal(personalStreak(state.history, 'lena', TODAY).streak, 5);
  assert.equal(personalStreak(state.history, 'mama', TODAY).streak, 0);
});

test('Bonus bei 7 Tagen: genau einmal, und rückgängig, wenn der Tag zurückgenommen wird', () => {
  const state = setup();
  activeDays(state, 'mama', 7); // bis gestern 6 Tage (heute wird gleich entfernt)
  state.history = state.history.filter((h) => h.date !== TODAY);
  toggleTask(state, OVEN, TODAY, 'mama', 50); // heute Tag 7
  const bonus = syncStreakBonus(state, 'mama', TODAY);
  // 3er- und 7er-Bonus fehlen beide → der zuletzt vergebene ist der 7er
  assert.equal(bonus.title, '🔥 7 Tage am Stück');
  assert.equal(state.history.filter(isBonus).length, 2);
  assert.equal(syncStreakBonus(state, 'mama', TODAY), null, 'kein zweites Mal');
  toggleTask(state, OVEN, TODAY, 'mama', 50); // rückgängig
  syncStreakBonus(state, 'mama', TODAY);
  assert.equal(state.history.filter((h) => isBonus(h) && h.date === TODAY).length, 0);
  assert.equal(memberPoints(state, 'mama'), 6 * 5);
});

test('Neue Serie nach einer Pause bekommt die Boni neu', () => {
  const state = setup();
  // alte Serie mit Bonus vor einem Monat
  for (let i = 40; i >= 34; i--) state.history.push({ id: `o${i}`, taskId: 'x', date: addDays(TODAY, -i), member: 'mama', points: 5 });
  state.history.push({ id: 'ob', taskId: null, title: '🔥 3 Tage am Stück', date: addDays(TODAY, -38), member: 'mama', points: 10 });
  activeDays(state, 'mama', 3);
  const bonus = syncStreakBonus(state, 'mama', TODAY);
  assert.equal(bonus?.title, '🔥 3 Tage am Stück');
});

test('Übernehmen: eine Person pro Aufgabe, wieder abgeben, Erledigen schließt ab', () => {
  const state = setup();
  assert.equal(toggleClaim(state, { taskId: OVEN }, TODAY, 'lena', 50), 'claimed');
  assert.equal(toggleClaim(state, { taskId: OVEN }, TODAY, 'mama', 50), 'taken');
  assert.equal(claimOf(state, { taskId: OVEN }, TODAY).to, 'lena');
  assert.equal(toggleClaim(state, { taskId: OVEN }, TODAY, 'lena', 50), 'released');
  assert.equal(claimOf(state, { taskId: OVEN }, TODAY), undefined);
  toggleClaim(state, { taskId: OVEN }, TODAY, 'lena', 50);
  toggleTask(state, OVEN, TODAY, 'lena', 50);
  assert.equal(claimOf(state, { taskId: OVEN }, TODAY).doneAt, TODAY);
});

test('Liegen gebliebene Übernahmen von gestern verfallen', () => {
  const state = setup();
  toggleClaim(state, { taskId: OVEN }, addDays(TODAY, -1), 'lena', 50);
  toggleClaim(state, { title: 'Biotonne rausstellen' }, TODAY, 'lena', 10);
  assert.equal(cleanupClaims(state, TODAY), 1);
  assert.equal(state.assignments.length, 1);
});

test('Abzeichen: Endgegner, Hunde-Held mit Fortschritt', () => {
  const state = setup();
  toggleTask(state, OVEN, TODAY, 'mama', 50);
  const b = Object.fromEntries(badgesFor(state, 'mama', TODAY).map((x) => [x.id, x]));
  assert.equal(b.first.earned, true);
  assert.equal(b.boss.earned, true);
  assert.equal(b.dogs.earned, false);
  assert.equal(b.dogs.value, 0);
  assert.equal(badgesFor(state, 'lena', TODAY).filter((x) => x.earned).length, 0);
});
