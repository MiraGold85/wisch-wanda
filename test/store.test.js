import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  freshState, toggleTask, toggleAssignment, addAssignment, effectiveTasks, setPusher, memberPoints,
} from '../js/store.js';

const TODAY = '2026-10-19';
const OVEN = 'kueche-backofen-reinigen';

function setup({ synced = false } = {}) {
  const state = freshState(TODAY);
  state.members = [{ id: 'mama', name: 'Mama', emoji: '👩' }, { id: 'lena', name: 'Lena', emoji: '👧' }];
  if (synced) state.sync = { householdId: 'h1', inviteCode: 'ABCDEFGH' };
  const ops = [];
  setPusher((o) => ops.push(...o));
  return { state, ops };
}

test('Abhaken setzt „zuletzt erledigt“ und lässt sich rückgängig machen', () => {
  const { state } = setup();
  const before = state.tasks.find((t) => t.id === OVEN).lastDone;
  toggleTask(state, OVEN, TODAY, 'mama', 50);
  assert.equal(effectiveTasks(state).find((t) => t.id === OVEN).lastDone, TODAY);
  toggleTask(state, OVEN, TODAY, 'mama', 50);
  assert.equal(effectiveTasks(state).find((t) => t.id === OVEN).lastDone, before);
  assert.equal(state.history.length, 0);
});

test('Zugeschickte Katalog-Aufgabe: Punkte für die Empfängerin, Zuweisung erledigt', () => {
  const { state } = setup();
  const a = addAssignment(state, { to: 'lena', from: 'mama', taskId: OVEN });
  toggleAssignment(state, a.id, TODAY, 'lena');
  assert.equal(a.doneAt, TODAY);
  assert.equal(a.doneBy, 'lena');
  assert.equal(memberPoints(state, 'lena'), 50);
  // rückgängig
  toggleAssignment(state, a.id, TODAY, 'lena');
  assert.equal(a.doneAt, null);
  assert.equal(memberPoints(state, 'lena'), 0);
});

test('Erledigt jemand die Aufgabe über den Tagesplan, gilt die Zuweisung auch als erledigt', () => {
  const { state } = setup();
  const a = addAssignment(state, { to: 'lena', from: 'mama', taskId: OVEN });
  toggleTask(state, OVEN, TODAY, 'mama', 50);
  assert.equal(a.doneAt, TODAY);
  assert.equal(a.doneBy, 'mama');
  toggleTask(state, OVEN, TODAY, 'mama', 50);
  assert.equal(a.doneAt, null);
});

test('Eigene Aufgabe ohne Katalog bekommt die gewählten Punkte', () => {
  const { state } = setup();
  const a = addAssignment(state, { to: 'lena', from: 'mama', title: 'Einkaufen gehen', points: 20 });
  const entry = toggleAssignment(state, a.id, TODAY, 'lena');
  assert.equal(entry.title, 'Einkaufen gehen');
  assert.equal(memberPoints(state, 'lena'), 20);
});

test('Nur verbundene Familien schicken Änderungen an den Sync', () => {
  const local = setup();
  toggleTask(local.state, OVEN, TODAY, 'mama', 50);
  assert.equal(local.ops.length, 0);
  const synced = setup({ synced: true });
  const a = addAssignment(synced.state, { to: 'lena', from: 'mama', taskId: OVEN });
  toggleAssignment(synced.state, a.id, TODAY, 'lena');
  assert.deepEqual(synced.ops.map((o) => `${o.kind}:${o.op}`), ['assignment:upsert', 'completion:upsert', 'assignment:upsert']);
});

test('Raum-Besitz: Standard privat, „Lenas Zimmer“, gemeinsam machen', async () => {
  const { isPrivateRoom, roomOwners, roomName, setRoomOwner, privateRooms, unassignedPrivateRooms } = await import('../js/store.js');
  const { state } = setup();
  assert.deepEqual(unassignedPrivateRooms(state), ['kind1', 'kind2', 'schlafzimmer']);
  assert.equal(isPrivateRoom(state, 'kueche'), false);
  setRoomOwner(state, 'kind1', 'lena');
  state.members.push({ id: 'jonas', name: 'Jonas', emoji: '👦' });
  setRoomOwner(state, 'kind2', 'jonas');
  assert.deepEqual(roomOwners(state, 'kind1'), ['lena'], 'alte Einzel-Einträge werden verstanden');
  assert.equal(roomName(state, 'kind1'), 'Lenas Zimmer');
  assert.equal(roomName(state, 'kind2'), 'Jonas’ Zimmer');
  setRoomOwner(state, 'schlafzimmer', 'shared');
  assert.deepEqual(privateRooms(state), ['kind1', 'kind2']);
  // der heutige Plan wurde ohne private Räume neu erstellt
  const plan = Object.values(state.plans)[0];
  assert.ok(plan.rounds.every((r) => !['kind1', 'kind2'].includes(r.room)));
});

test('Elternschlafzimmer gehört zwei Personen', async () => {
  const { toggleRoomOwner, roomOwners, ownedRooms, isPrivateRoom, unassignedPrivateRooms } = await import('../js/store.js');
  const { state } = setup();
  state.members.push({ id: 'papa', name: 'Papa', emoji: '👨' });
  toggleRoomOwner(state, 'schlafzimmer', 'mama');
  toggleRoomOwner(state, 'schlafzimmer', 'papa');
  assert.deepEqual(roomOwners(state, 'schlafzimmer'), ['mama', 'papa']);
  assert.deepEqual(ownedRooms(state, 'papa'), ['schlafzimmer']);
  assert.deepEqual(ownedRooms(state, 'lena'), []);
  toggleRoomOwner(state, 'schlafzimmer', 'papa');
  assert.deepEqual(roomOwners(state, 'schlafzimmer'), ['mama']);
  toggleRoomOwner(state, 'schlafzimmer', 'mama');
  assert.ok(unassignedPrivateRooms(state).includes('schlafzimmer'), 'niemand mehr → wieder offen');
  toggleRoomOwner(state, 'schlafzimmer', 'shared');
  assert.equal(isPrivateRoom(state, 'schlafzimmer'), false);
  toggleRoomOwner(state, 'schlafzimmer', 'papa');
  assert.deepEqual(roomOwners(state, 'schlafzimmer'), ['papa'], 'aus „gemeinsam“ wird privat');
});

test('Raum pausieren: raus aus der Planung, beim Aktivieren frischer Start', async () => {
  const { setRoomPaused, isPaused, excludedRooms, toggleRoomOwner, effectiveTasks } = await import('../js/store.js');
  const { dueRatio, dateKey } = await import('../js/planner.js');
  const { state } = setup();
  toggleRoomOwner(state, 'kind2', 'shared'); // wie bei Kayne: Zimmer gemeinsam, aber leer
  for (const t of state.tasks.filter((x) => x.room === 'kind2')) t.lastDone = '2026-01-01';
  setRoomPaused(state, 'kind2', true);
  assert.ok(isPaused(state, 'kind2'));
  assert.ok(excludedRooms(state).includes('kind2'));
  const plan = state.plans[dateKey()];
  assert.ok(plan.rounds.every((r) => r.room !== 'kind2') && plan.focusRoom !== 'kind2');
  setRoomPaused(state, 'kind2', false);
  assert.ok(!isPaused(state, 'kind2'));
  const overdue = effectiveTasks(state).filter((t) => t.room === 'kind2' && dueRatio(t, dateKey()) > 1);
  assert.equal(overdue.length, 0, 'nach dem Aktivieren ist nichts überfällig');
});
