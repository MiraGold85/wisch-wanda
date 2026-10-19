// Speichert alles lokal auf dem Gerät (Stufe 1, noch ohne Familien-Sync).
import { ROOMS, defaultTasks, buildPlan, dateKey, addDays, dayNum } from './planner.js';

const KEY = 'wisch-wanda-v1';
const PLAN_KEEP_DAYS = 14;

export function freshState(today = dateKey()) {
  return {
    version: 1,
    onboarded: false,
    createdAt: today,
    tasks: defaultTasks(today),
    roomNames: {},
    members: [{ id: 'm1', name: 'Mama', emoji: '👩' }],
    currentMember: 'm1',
    history: [],
    plans: {},
    quickDays: {},
    goal: { title: 'Pizza-Abend für alle', points: 1000, since: today },
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // Kein Speicher verfügbar (z. B. privater Modus) – dann frisch starten.
  }
  return freshState();
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Ignorieren: Die App funktioniert weiter, merkt sich nur nichts.
  }
}

export function roomName(state, id) {
  return state.roomNames[id] || ROOMS.find((r) => r.id === id)?.name || id;
}

export function roomEmoji(id) {
  return ROOMS.find((r) => r.id === id)?.emoji || '🧽';
}

// Plan des Tages holen oder einmalig erzeugen.
export function planFor(state, key) {
  if (!state.plans[key]) {
    state.plans[key] = buildPlan(state.tasks, key);
    const cutoff = dayNum(addDays(key, -PLAN_KEEP_DAYS));
    for (const k of Object.keys(state.plans)) if (dayNum(k) < cutoff) delete state.plans[k];
    save(state);
  }
  return state.plans[key];
}

export function doneEntry(state, taskId, key) {
  return state.history.find((h) => h.taskId === taskId && h.date === key);
}

// Abhaken bzw. rückgängig machen. Gibt den neuen Eintrag zurück (oder null beim Rückgängigmachen).
export function toggleTask(state, taskId, key, memberId, points) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return null;
  const existing = doneEntry(state, taskId, key);
  if (existing) {
    state.history = state.history.filter((h) => h !== existing);
    task.lastDone = existing.prevLastDone;
    save(state);
    return null;
  }
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    taskId,
    date: key,
    member: memberId,
    points,
    prevLastDone: task.lastDone,
  };
  state.history.push(entry);
  task.lastDone = key;
  save(state);
  return entry;
}

export function memberPoints(state, memberId, sinceKey) {
  return state.history
    .filter((h) => h.member === memberId && (!sinceKey || h.date >= sinceKey))
    .reduce((sum, h) => sum + h.points, 0);
}

export function familyPoints(state, sinceKey) {
  return state.history.filter((h) => !sinceKey || h.date >= sinceKey).reduce((sum, h) => sum + h.points, 0);
}
