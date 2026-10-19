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
  const { isPrivateRoom, roomOwner, roomName, setRoomOwner, privateRooms, unassignedPrivateRooms } = await import('../js/store.js');
  const { state } = setup();
  assert.deepEqual(unassignedPrivateRooms(state), ['kind1', 'kind2', 'schlafzimmer']);
  assert.equal(isPrivateRoom(state, 'kueche'), false);
  setRoomOwner(state, 'kind1', 'lena');
  state.members.push({ id: 'jonas', name: 'Jonas', emoji: '👦' });
  setRoomOwner(state, 'kind2', 'jonas');
  assert.equal(roomOwner(state, 'kind1'), 'lena');
  assert.equal(roomName(state, 'kind1'), 'Lenas Zimmer');
  assert.equal(roomName(state, 'kind2'), 'Jonas’ Zimmer');
  setRoomOwner(state, 'schlafzimmer', 'shared');
  assert.deepEqual(privateRooms(state), ['kind1', 'kind2']);
  // der heutige Plan wurde ohne private Räume neu erstellt
  const plan = Object.values(state.plans)[0];
  assert.ok(plan.rounds.every((r) => !['kind1', 'kind2'].includes(r.room)));
});
