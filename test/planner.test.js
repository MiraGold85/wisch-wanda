import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultTasks, buildPlan, quickPlan, planTaskIds, computeStreak, focusRoomFor, roundRoomsFor,
  addDays, dueRatio, levelFor, privateTasks, HUNDE_CHECK, FOCUS_ROOMS, ROUND_ROOMS,
} from '../js/planner.js';

const TODAY = '2026-10-19'; // ein Montag

test('Fokus-Raum wechselt wöchentlich und bleibt innerhalb der Woche gleich', () => {
  const week = Array.from({ length: 7 }, (_, i) => focusRoomFor(addDays(TODAY, i)));
  assert.equal(new Set(week).size, 1);
  assert.notEqual(focusRoomFor(addDays(TODAY, 7)), week[0]);
  const all = new Set(Array.from({ length: FOCUS_ROOMS.length }, (_, w) => focusRoomFor(addDays(TODAY, w * 7))));
  assert.equal(all.size, FOCUS_ROOMS.length);
});

test('Raum-Runde: 4 Räume, nie der Fokus-Raum, alle Räume kommen regelmäßig dran', () => {
  const seen = new Set();
  for (let i = 0; i < 7; i++) {
    const key = addDays(TODAY, i);
    const rooms = roundRoomsFor(key);
    assert.equal(rooms.length, 4);
    assert.ok(!rooms.includes(focusRoomFor(key)));
    rooms.forEach((r) => seen.add(r));
  }
  assert.equal(seen.size, ROUND_ROOMS.length - 1);
});

test('Plan enthält Hunde-Check, Mission und keine Aufgabe doppelt', () => {
  const tasks = defaultTasks(TODAY);
  const plan = buildPlan(tasks, TODAY);
  const ids = planTaskIds(plan);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(plan.hunde[0], HUNDE_CHECK);
  assert.ok(plan.mission);
  const mission = tasks.find((t) => t.id === plan.mission);
  assert.ok(mission.interval >= 30);
  assert.notEqual(mission.room, plan.focusRoom);
  assert.ok(plan.focus.length > 0 && plan.focus.length <= 3);
});

test('Überfällige seltene Aufgaben werden zur Mission', () => {
  const tasks = defaultTasks(TODAY);
  const oven = tasks.find((t) => t.id === 'kueche-backofen-reinigen');
  oven.lastDone = addDays(TODAY, -120);
  const key = focusRoomFor(TODAY) === 'kueche' ? addDays(TODAY, 7) : TODAY;
  assert.equal(buildPlan(tasks, key).mission, oven.id);
});

test('Nur-15-Minuten-Modus kürzt den Plan', () => {
  const plan = buildPlan(defaultTasks(TODAY), TODAY);
  const quick = quickPlan(plan);
  assert.ok(planTaskIds(quick).length < planTaskIds(plan).length);
  assert.equal(quick.focus.length, 0);
  assert.ok(quick.rounds.length <= 2);
});

test('Startwerte: nicht alles ist auf einmal überfällig', () => {
  const tasks = defaultTasks(TODAY).filter((t) => t.interval > 1);
  const overdue = tasks.filter((t) => dueRatio(t, TODAY) > 1).length;
  assert.equal(overdue, 0);
});

test('Serie zählt Tage am Stück, Joker rettet einen verpassten Tag', () => {
  const day = (n) => ({ date: addDays(TODAY, n) });
  const sevenDays = Array.from({ length: 7 }, (_, i) => day(i - 9)); // -9 … -3
  // -2 verpasst, -1 aktiv, heute noch offen
  let s = computeStreak([...sevenDays, day(-1)], TODAY);
  assert.equal(s.streak, 8);
  assert.equal(s.jokers, 0); // Joker wurde für Tag -2 verbraucht
  assert.equal(s.doneToday, false);

  // Ohne Joker reißt die Serie
  s = computeStreak([day(-5), day(-4), day(-2), day(-1), day(0)], TODAY);
  assert.equal(s.streak, 3);
  assert.equal(s.doneToday, true);
});

test('Level steigen mit Punkten', () => {
  assert.equal(levelFor(0).title, 'Staubkörnchen');
  assert.equal(levelFor(250).title, 'Wischmop');
  assert.equal(levelFor(250).toNext, 350);
  assert.equal(levelFor(5000).next, undefined);
});

test('Private Räume: nicht in Runde, Fokus oder Mission', () => {
  const priv = ['kind1', 'kind2', 'schlafzimmer'];
  const tasks = defaultTasks(TODAY);
  for (let i = 0; i < 70; i++) {
    const key = addDays(TODAY, i);
    const plan = buildPlan(tasks, key, priv);
    assert.ok(!priv.includes(plan.focusRoom), `Fokus ${plan.focusRoom}`);
    assert.ok(plan.rounds.every((r) => !priv.includes(r.room)));
    const mission = tasks.find((t) => t.id === plan.mission);
    assert.ok(!mission || !priv.includes(mission.room));
  }
});

test('Private Aufgaben: nur fällige aus den eigenen Räumen, dringendste zuerst', () => {
  const tasks = defaultTasks(TODAY);
  const bed = tasks.find((t) => t.id === 'kind1-bettwaesche-wechseln');
  bed.lastDone = addDays(TODAY, -30);
  const list = privateTasks(tasks, ['kind1'], TODAY);
  assert.equal(list[0].id, bed.id);
  assert.ok(list.every((t) => t.room === 'kind1'));
  assert.ok(list.length <= 4);
});
