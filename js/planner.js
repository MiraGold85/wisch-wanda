// Reine Planungslogik ohne DOM – läuft im Browser und in Node (Tests).

export const ROOMS = [
  { id: 'alltag', name: 'Alltag', emoji: '🏠' },
  { id: 'treppenhaus', name: 'Treppenhaus', emoji: '🪜' },
  { id: 'flur', name: 'Flur', emoji: '🚪' },
  { id: 'bad', name: 'Badezimmer', emoji: '🛁' },
  { id: 'wc', name: 'WC', emoji: '🚽' },
  { id: 'kind1', name: 'Kinderzimmer 1', emoji: '🎧' },
  { id: 'kind2', name: 'Kinderzimmer 2', emoji: '🎮' },
  { id: 'wohnzimmer', name: 'Wohnzimmer', emoji: '🛋️' },
  { id: 'kueche', name: 'Küche', emoji: '🍳' },
  { id: 'schlafzimmer', name: 'Elternschlafzimmer', emoji: '🛏️' },
  { id: 'terrasse', name: 'Terrasse', emoji: '🌿' },
];

// Räume für die tägliche Raum-Runde (Terrasse hat den eigenen Hunde-Check).
export const ROUND_ROOMS = ['treppenhaus', 'flur', 'bad', 'wc', 'kind1', 'kind2', 'wohnzimmer', 'kueche', 'schlafzimmer'];
// Fokus-Raum-Rotation: jede Woche ein anderer Raum gründlich.
export const FOCUS_ROOMS = [...ROUND_ROOMS, 'terrasse'];

// Unbeliebtheit 1–5 → Punkte. Die fiesen Aufgaben lohnen sich richtig.
export const POINTS = { 1: 5, 2: 10, 3: 20, 4: 35, 5: 50 };
export const EFFORT_LABELS = { 1: 'Kleinigkeit', 2: 'Geht so', 3: 'Lästig', 4: 'Unbeliebt', 5: 'Endgegner' };

export const HUNDE_CHECK = 'terrasse-hunde-check-hinterlassenschaften-wegmachen';

// [Raum, Aufgabe, Intervall in Tagen, Unbeliebtheit 1–5]
const CATALOG = [
  ['alltag', 'Spülmaschine ein-/ausräumen', 1, 1],
  ['alltag', 'Arbeitsflächen abwischen', 1, 1],
  ['alltag', 'Wäsche anstellen oder aufhängen', 2, 2],
  ['alltag', '5-Minuten-Aufräumen im Wohnbereich', 1, 1],
  ['alltag', 'Müll rausbringen', 3, 1],

  ['terrasse', 'Hunde-Check: Hinterlassenschaften wegmachen', 1, 2],
  ['terrasse', 'Terrasse fegen', 7, 2],
  ['terrasse', 'Pflanzen gießen', 3, 1],
  ['terrasse', 'Hunde-Ecke abspritzen', 14, 3],
  ['terrasse', 'Gartenmöbel abwischen', 30, 2],
  ['terrasse', 'Terrasse schrubben', 90, 5],

  ['treppenhaus', 'Treppe saugen', 7, 2],
  ['treppenhaus', 'Treppe wischen', 14, 3],
  ['treppenhaus', 'Geländer abwischen', 30, 2],
  ['treppenhaus', 'Spinnweben entfernen', 60, 2],
  ['treppenhaus', 'Lichtschalter abwischen', 30, 1],
  ['treppenhaus', 'Fußleisten abwischen', 60, 3],

  ['flur', 'Boden saugen', 7, 2],
  ['flur', 'Boden wischen', 14, 3],
  ['flur', 'Fußmatte ausschütteln', 14, 1],
  ['flur', 'Schuhe sortieren', 14, 2],
  ['flur', 'Spiegel putzen', 14, 1],
  ['flur', 'Türklinken abwischen', 30, 1],
  ['flur', 'Lichtschalter abwischen', 30, 1],
  ['flur', 'Haustür abwischen', 60, 2],
  ['flur', 'Fußleisten abwischen', 60, 3],
  ['flur', 'Garderobe ausmisten', 90, 3],

  ['bad', 'Waschbecken & Armaturen', 7, 2],
  ['bad', 'Toilette putzen', 7, 3],
  ['bad', 'Dusche/Wanne putzen', 7, 3],
  ['bad', 'Spiegel putzen', 7, 1],
  ['bad', 'Handtücher wechseln', 7, 1],
  ['bad', 'Boden wischen', 7, 2],
  ['bad', 'Fliesen abwischen', 30, 3],
  ['bad', 'Abfluss reinigen', 30, 4],
  ['bad', 'Lichtschalter abwischen', 30, 1],
  ['bad', 'Duschkopf entkalken', 60, 3],
  ['bad', 'Fugen schrubben', 60, 4],
  ['bad', 'Lüftungsgitter reinigen', 90, 3],
  ['bad', 'Badschränke ausmisten', 180, 3],

  ['wc', 'Toilette putzen', 7, 3],
  ['wc', 'Waschbecken putzen', 7, 2],
  ['wc', 'Handtuch wechseln', 7, 1],
  ['wc', 'Boden wischen', 7, 2],
  ['wc', 'Toilette entkalken', 30, 4],
  ['wc', 'Lichtschalter abwischen', 30, 1],
  ['wc', 'Fußleisten abwischen', 60, 3],

  ['wohnzimmer', 'Staubsaugen', 7, 2],
  ['wohnzimmer', 'Staub wischen', 7, 2],
  ['wohnzimmer', 'Pflanzen gießen', 7, 1],
  ['wohnzimmer', 'Hundedecken waschen', 14, 2],
  ['wohnzimmer', 'Sofa absaugen (Hundehaare!)', 30, 3],
  ['wohnzimmer', 'Fernbedienungen abwischen', 30, 1],
  ['wohnzimmer', 'Lichtschalter abwischen', 30, 1],
  ['wohnzimmer', 'Fenster putzen', 42, 4],
  ['wohnzimmer', 'Kissenbezüge waschen', 60, 2],
  ['wohnzimmer', 'Fußleisten abwischen', 60, 3],
  ['wohnzimmer', 'Gardinen waschen', 180, 4],

  ['kueche', 'Hundenäpfe auswaschen', 3, 1],
  ['kueche', 'Herd reinigen', 7, 2],
  ['kueche', 'Boden wischen', 7, 2],
  ['kueche', 'Kühlschrank ausmisten', 7, 2],
  ['kueche', 'Mikrowelle reinigen', 14, 2],
  ['kueche', 'Backofen reinigen', 30, 5],
  ['kueche', 'Kühlschrank auswischen', 30, 3],
  ['kueche', 'Spülmaschinenfilter reinigen', 30, 4],
  ['kueche', 'Mülleimer auswaschen', 30, 4],
  ['kueche', 'Wasserkocher entkalken', 30, 1],
  ['kueche', 'Kaffeemaschine entkalken', 30, 2],
  ['kueche', 'Schrankfronten abwischen', 30, 2],
  ['kueche', 'Lichtschalter abwischen', 30, 1],
  ['kueche', 'Fenster putzen', 42, 4],
  ['kueche', 'Dunstabzugsfilter reinigen', 60, 4],
  ['kueche', 'Fußleisten abwischen', 60, 3],

  ['schlafzimmer', 'Staubsaugen', 7, 2],
  ['schlafzimmer', 'Bettwäsche wechseln', 14, 2],
  ['schlafzimmer', 'Staub wischen', 14, 2],
  ['schlafzimmer', 'Unter dem Bett saugen', 30, 3],
  ['schlafzimmer', 'Lichtschalter abwischen', 30, 1],
  ['schlafzimmer', 'Fenster putzen', 42, 4],
  ['schlafzimmer', 'Fußleisten abwischen', 60, 3],
  ['schlafzimmer', 'Matratze drehen', 90, 3],
  ['schlafzimmer', 'Kleiderschrank ausmisten', 180, 3],

  ...['kind1', 'kind2'].flatMap((room) => [
    [room, 'Aufräumen', 3, 2],
    [room, 'Staubsaugen', 7, 2],
    [room, 'Bettwäsche wechseln', 14, 2],
    [room, 'Staub wischen', 14, 2],
    [room, 'Lichtschalter abwischen', 30, 1],
    [room, 'Fenster putzen', 42, 4],
    [room, 'Fußleisten abwischen', 60, 3],
    [room, 'Ausmisten', 180, 3],
  ]),
];

export function slug(text) {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function hash(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

// ---------- Datum ----------

export function dateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function dayNum(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

export function keyFromDayNum(n) {
  return new Date(n * 86400000).toISOString().slice(0, 10);
}

export function addDays(key, days) {
  return keyFromDayNum(dayNum(key) + days);
}

// Wochen beginnen montags (1.1.1970 war ein Donnerstag).
export function weekIndex(key) {
  return Math.floor((dayNum(key) + 3) / 7);
}

// ---------- Aufgaben ----------

export function defaultTasks(todayKey) {
  return CATALOG.map(([room, name, interval, effort]) => {
    const id = `${room}-${slug(name)}`;
    // Startwerte schätzen: über das Intervall verteilt, damit nicht alles auf einmal fällig ist.
    const ago = interval <= 1 ? 1 : hash(id) % interval;
    return { id, room, name, interval, effort, lastDone: addDays(todayKey, -ago) };
  });
}

// 0 = gerade erledigt, 1 = heute fällig, >1 = überfällig.
export function dueRatio(task, todayKey) {
  if (!task.lastDone) return 2;
  return (dayNum(todayKey) - dayNum(task.lastDone)) / task.interval;
}

export function daysUntilDue(task, todayKey) {
  if (!task.lastDone) return 0;
  return dayNum(task.lastDone) + task.interval - dayNum(todayKey);
}

export function pointsFor(task) {
  return POINTS[task.effort] ?? 10;
}

function byUrgency(todayKey) {
  return (a, b) => dueRatio(b, todayKey) - dueRatio(a, todayKey) || b.interval - a.interval;
}

// Raum-Zustand für die Ampel: grün / gelb / rot.
export function roomStatus(tasks, roomId, todayKey) {
  const roomTasks = tasks.filter((t) => t.room === roomId);
  if (!roomTasks.length) return { level: 'green', overdue: 0 };
  const overdue = roomTasks.filter((t) => dueRatio(t, todayKey) > 1).length;
  const worst = Math.max(...roomTasks.map((t) => dueRatio(t, todayKey)));
  const level = worst > 1.5 || overdue >= 3 ? 'red' : overdue > 0 ? 'yellow' : 'green';
  return { level, overdue };
}

// ---------- Tagesplan ----------

export function focusRoomFor(key) {
  return FOCUS_ROOMS[weekIndex(key) % FOCUS_ROOMS.length];
}

export function roundRoomsFor(key, count = 4) {
  const focus = focusRoomFor(key);
  const rooms = ROUND_ROOMS.filter((r) => r !== focus);
  const start = (dayNum(key) * count) % rooms.length;
  return Array.from({ length: Math.min(count, rooms.length) }, (_, i) => rooms[(start + i) % rooms.length]);
}

// Erstellt den Plan für einen Tag. Wird einmal pro Tag gespeichert, damit er sich
// beim Abhaken nicht verschiebt.
export function buildPlan(tasks, key) {
  const urgent = byUrgency(key);
  const used = new Set();
  const take = (list) => {
    list.forEach((t) => used.add(t.id));
    return list.map((t) => t.id);
  };

  const alltag = take(
    tasks.filter((t) => t.room === 'alltag' && dueRatio(t, key) >= 1).sort(urgent),
  );

  // Hunde-Check immer, dazu kurze Terrassenaufgaben, die fällig sind.
  const hunde = take(
    tasks
      .filter((t) => t.id === HUNDE_CHECK || (t.room === 'terrasse' && t.interval <= 7 && dueRatio(t, key) >= 1))
      .sort((a, b) => (b.id === HUNDE_CHECK) - (a.id === HUNDE_CHECK) || urgent(a, b)),
  );

  const rounds = roundRoomsFor(key).map((room) => ({
    room,
    tasks: take(
      tasks
        .filter((t) => t.room === room && t.interval <= 14 && !used.has(t.id) && dueRatio(t, key) >= 0.7)
        .sort(urgent)
        .slice(0, 2),
    ),
  }));

  const focusRoom = focusRoomFor(key);
  const deep = tasks
    .filter((t) => t.room === focusRoom && !used.has(t.id) && t.interval >= 14)
    .sort(urgent);
  const deepDue = deep.filter((t) => dueRatio(t, key) >= 0.6);
  const focus = take((deepDue.length ? deepDue : deep).slice(0, 3));

  const missionTask = tasks
    .filter((t) => t.interval >= 30 && t.room !== focusRoom && !used.has(t.id))
    .sort(urgent)[0];
  const mission = missionTask ? take([missionTask])[0] : null;

  return { date: key, alltag, hunde, rounds, focusRoom, focus, mission };
}

// Bei „Nur 15 Minuten“ bleibt nur das Wichtigste übrig.
export function quickPlan(plan) {
  return {
    ...plan,
    alltag: plan.alltag.slice(0, 2),
    rounds: plan.rounds.slice(0, 2).map((r) => ({ ...r, tasks: r.tasks.slice(0, 1) })),
    focus: [],
  };
}

export function planTaskIds(plan) {
  return [
    ...plan.alltag,
    ...plan.hunde,
    ...plan.rounds.flatMap((r) => r.tasks),
    ...plan.focus,
    ...(plan.mission ? [plan.mission] : []),
  ];
}

// ---------- Motivation ----------

export const MAX_JOKERS = 3;

// Serie: Tage am Stück mit mindestens einer erledigten Aufgabe.
// Alle 7 aktiven Tage gibt es einen Joker, der einen verpassten Tag rettet.
export function computeStreak(history, todayKey) {
  const active = new Set(history.map((h) => h.date));
  if (!active.size) return { streak: 0, jokers: 0, doneToday: false };
  const first = Math.min(...[...active].map(dayNum));
  const today = dayNum(todayKey);
  let streak = 0;
  let jokers = 0;
  let activeRun = 0;
  for (let d = first; d <= today; d++) {
    if (active.has(keyFromDayNum(d))) {
      streak++;
      activeRun++;
      if (activeRun % 7 === 0) jokers = Math.min(MAX_JOKERS, jokers + 1);
    } else if (d === today) {
      // Der heutige Tag ist noch nicht vorbei.
    } else if (jokers > 0) {
      jokers--;
    } else {
      streak = 0;
      activeRun = 0;
    }
  }
  return { streak, jokers, doneToday: active.has(todayKey) };
}

export const LEVELS = [
  { min: 0, title: 'Staubkörnchen', emoji: '🌱' },
  { min: 200, title: 'Wischmop', emoji: '🧹' },
  { min: 600, title: 'Glanzstück', emoji: '✨' },
  { min: 1500, title: 'Putzrakete', emoji: '🚀' },
  { min: 3000, title: 'Wanda-Legende', emoji: '👑' },
];

export function levelFor(points) {
  let index = 0;
  LEVELS.forEach((l, i) => {
    if (points >= l.min) index = i;
  });
  const next = LEVELS[index + 1];
  return { ...LEVELS[index], index, next, toNext: next ? next.min - points : 0 };
}
