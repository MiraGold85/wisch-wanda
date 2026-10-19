// Datenhaltung: alles liegt lokal auf dem Gerät. Ist die Familie verbunden,
// wird jede Änderung zusätzlich als „Op“ an den Sync weitergereicht.
import { ROOMS, POINTS, defaultTasks, buildPlan, dateKey, addDays, dayNum } from './planner.js';
import { WASTE_POINTS, wasteDone } from './waste.js';

const KEY = 'wisch-wanda-v1';
const PLAN_KEEP_DAYS = 14;

let pusher = null;
export function setPusher(fn) {
  pusher = fn;
}
function push(state, ops) {
  save(state);
  if (state.sync && pusher) pusher(ops);
}

export const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

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
    assignments: [],
    plans: {},
    quickDays: {},
    goal: { title: 'Pizza-Abend für alle', points: 1000, since: today },
    waste: null, // Abfallkalender { name, events: [{ d, t }] }
    sync: null, // { householdId, inviteCode, name }
    outbox: [],
  };
}

export function migrate(state) {
  state.assignments ??= [];
  state.outbox ??= [];
  state.sync ??= null;
  state.history ??= [];
  state.waste ??= null;
  // Vor Einführung der Markierung geladene Kalender sicherheitshalber als „noch hochzuladen“ behandeln.
  if (state.waste && state.sync && state.wasteUnsynced === undefined) state.wasteUnsynced = true;
  return state;
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return migrate(JSON.parse(raw));
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

// Zuletzt erledigt = späteres von Startwert und letzter Erledigung.
export function effectiveTasks(state) {
  const latest = {};
  for (const h of state.history) {
    if (h.taskId && (!latest[h.taskId] || h.date > latest[h.taskId])) latest[h.taskId] = h.date;
  }
  return state.tasks.map((t) => {
    const l = latest[t.id];
    return l && (!t.lastDone || l > t.lastDone) ? { ...t, lastDone: l } : t;
  });
}

// Plan des Tages holen oder einmalig erzeugen.
export function planFor(state, key) {
  if (!state.plans[key]) {
    state.plans[key] = buildPlan(effectiveTasks(state), key);
    const cutoff = dayNum(addDays(key, -PLAN_KEEP_DAYS));
    for (const k of Object.keys(state.plans)) if (dayNum(k) < cutoff) delete state.plans[k];
    push(state, [{ kind: 'plan', op: 'insertIgnore', value: state.plans[key] }]);
  }
  return state.plans[key];
}

export function doneEntry(state, taskId, key) {
  return state.history.find((h) => h.taskId === taskId && h.date === key);
}

// Katalog-Aufgabe abhaken bzw. rückgängig machen. Gibt den neuen Eintrag zurück (oder null).
export function toggleTask(state, taskId, key, memberId, points) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return null;
  const existing = doneEntry(state, taskId, key);
  if (existing) {
    removeCompletion(state, existing);
    return null;
  }
  const entry = { id: newId(), taskId, date: key, member: memberId, points };
  state.history.push(entry);
  const ops = [{ kind: 'completion', op: 'upsert', value: entry }];
  // Offene Zuweisungen für diese Aufgabe gelten damit als erledigt.
  for (const a of state.assignments) {
    if (a.taskId === taskId && !a.doneAt) {
      Object.assign(a, { doneAt: key, doneBy: memberId, completionId: entry.id });
      ops.push({ kind: 'assignment', op: 'upsert', value: a });
    }
  }
  push(state, ops);
  return entry;
}

function removeCompletion(state, entry) {
  state.history = state.history.filter((h) => h !== entry);
  const ops = [{ kind: 'completion', op: 'delete', value: entry.id }];
  // Ältere lokale Daten haben den Startwert direkt verändert – zurücksetzen.
  const task = state.tasks.find((t) => t.id === entry.taskId);
  if (task && 'prevLastDone' in entry && task.lastDone === entry.date) {
    task.lastDone = entry.prevLastDone;
    ops.push({ kind: 'task', op: 'upsert', value: task });
  }
  for (const a of state.assignments) {
    if (a.completionId === entry.id) {
      Object.assign(a, { doneAt: null, doneBy: null, completionId: null });
      ops.push({ kind: 'assignment', op: 'upsert', value: a });
    }
  }
  push(state, ops);
}

// ---------- Zugeschickte Aufgaben ----------

export function assignmentPoints(state, a) {
  if (a.taskId) {
    const t = state.tasks.find((x) => x.id === a.taskId);
    if (t) return POINTS[t.effort] ?? 10;
  }
  return a.points ?? 10;
}

export function assignmentTitle(state, a) {
  return a.title || state.tasks.find((t) => t.id === a.taskId)?.name || 'Aufgabe';
}

export function addAssignment(state, data) {
  const a = {
    id: newId(), taskId: null, title: null, points: 10, note: '', due: null,
    createdAt: new Date().toISOString(), doneAt: null, doneBy: null, completionId: null, ...data,
  };
  state.assignments.push(a);
  push(state, [{ kind: 'assignment', op: 'upsert', value: a }]);
  return a;
}

export function deleteAssignment(state, id) {
  state.assignments = state.assignments.filter((a) => a.id !== id);
  push(state, [{ kind: 'assignment', op: 'delete', value: id }]);
}

function reopen(state, a) {
  const entry = state.history.find((h) => h.id === a.completionId);
  if (entry) return removeCompletion(state, entry);
  Object.assign(a, { doneAt: null, doneBy: null, completionId: null });
  push(state, [{ kind: 'assignment', op: 'upsert', value: a }]);
}

// Zugeschickte Aufgabe abhaken/rückgängig. Gibt den neuen Eintrag zurück (oder null).
export function toggleAssignment(state, id, key, memberId) {
  const a = state.assignments.find((x) => x.id === id);
  if (!a) return null;
  if (a.doneAt) {
    reopen(state, a);
    return null;
  }
  if (a.taskId && state.tasks.some((t) => t.id === a.taskId)) {
    const already = doneEntry(state, a.taskId, key);
    if (already) {
      Object.assign(a, { doneAt: key, doneBy: already.member, completionId: already.id });
      push(state, [{ kind: 'assignment', op: 'upsert', value: a }]);
      return null;
    }
    return toggleTask(state, a.taskId, key, memberId, assignmentPoints(state, a));
  }
  // Eigene Aufgabe ohne Katalog-Eintrag
  const entry = {
    id: newId(), taskId: null, title: assignmentTitle(state, a), date: key, member: memberId,
    points: assignmentPoints(state, a), assignmentId: a.id,
  };
  state.history.push(entry);
  Object.assign(a, { doneAt: key, doneBy: memberId, completionId: entry.id });
  push(state, [
    { kind: 'completion', op: 'upsert', value: entry },
    { kind: 'assignment', op: 'upsert', value: a },
  ]);
  return entry;
}

// ---------- Abfallkalender ----------

export function setWaste(state, waste) {
  state.waste = waste;
  state.wasteUnsynced = Boolean(state.sync);
  push(state, [{ kind: 'waste', op: 'update', value: waste }]);
}

// Tonne rausstellen abhaken/rückgängig. Gibt den neuen Eintrag zurück (oder null).
export function toggleWaste(state, pickup, key, memberId) {
  const existing = wasteDone(state.history, pickup);
  if (existing) {
    removeCompletion(state, existing);
    return null;
  }
  const title = `${pickup.t} rausstellen`;
  const entry = { id: newId(), taskId: null, title, date: key, member: memberId, points: WASTE_POINTS };
  state.history.push(entry);
  const ops = [{ kind: 'completion', op: 'upsert', value: entry }];
  // Wurde die Tonne jemandem zugeschickt, ist das damit auch erledigt.
  for (const a of state.assignments) {
    if (!a.taskId && a.title === title && !a.doneAt) {
      Object.assign(a, { doneAt: key, doneBy: memberId, completionId: entry.id });
      ops.push({ kind: 'assignment', op: 'upsert', value: a });
    }
  }
  push(state, ops);
  return entry;
}

// ---------- Familie, Aufgaben, Einstellungen ----------

export function saveMember(state, m) {
  if (!state.members.includes(m)) state.members.push(m);
  push(state, [{ kind: 'member', op: 'upsert', value: m }]);
}

export function removeMember(state, id) {
  state.members = state.members.filter((m) => m.id !== id);
  push(state, [{ kind: 'member', op: 'delete', value: id }]);
}

export function saveTask(state, t) {
  if (!state.tasks.includes(t)) state.tasks.push(t);
  push(state, [{ kind: 'task', op: 'upsert', value: t }]);
}

export function removeTask(state, id) {
  state.tasks = state.tasks.filter((t) => t.id !== id);
  push(state, [{ kind: 'task', op: 'delete', value: id }]);
}

export function saveSettings(state) {
  push(state, [{ kind: 'household', op: 'update', value: { roomNames: state.roomNames, goal: state.goal } }]);
}

// ---------- Punkte ----------

export function memberPoints(state, memberId, sinceKey) {
  return state.history
    .filter((h) => h.member === memberId && (!sinceKey || h.date >= sinceKey))
    .reduce((sum, h) => sum + h.points, 0);
}

export function familyPoints(state, sinceKey) {
  return state.history.filter((h) => !sinceKey || h.date >= sinceKey).reduce((sum, h) => sum + h.points, 0);
}
