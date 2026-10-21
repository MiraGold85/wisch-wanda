// Belohnungen: persönliche Serie mit Bonuspunkten und Abzeichen.
import { ROOMS, HUNDE_CHECK, DEFAULT_PRIVATE, computeStreak } from './planner.js';

// Bonuspunkte sind Einträge ohne Aufgabe, deren Titel mit 🔥 beginnt.
export const isBonus = (h) => !h.taskId && typeof h.title === 'string' && h.title.startsWith('🔥 ');
export const isClaim = (a) => a.to === a.from;

export const MILESTONES = [
  { days: 3, points: 10 },
  { days: 7, points: 25 },
  { days: 14, points: 50 },
  { days: 30, points: 100 },
  { days: 60, points: 150 },
  { days: 100, points: 250 },
  { days: 200, points: 400 },
  { days: 365, points: 750 },
];
export const milestoneTitle = (days) => `🔥 ${days} Tage am Stück`;

export function personalStreak(history, memberId, todayKey) {
  return computeStreak(history.filter((h) => h.member === memberId && !isBonus(h)), todayKey);
}

export function nextMilestone(streak) {
  return MILESTONES.find((m) => m.days > streak) || null;
}

// Räume, die für „Rundum sauber“ zählen: gemeinsame plus die eigenen privaten
function roomsFor(state, memberId) {
  return ROOMS.map((r) => r.id).filter((id) => {
    if (id === 'alltag' || state.pausedRooms?.[id]) return false;
    const o = state.roomOwners?.[id];
    const isPrivate = o === undefined ? DEFAULT_PRIVATE.includes(id) : o !== 'shared';
    return !isPrivate || [].concat(o ?? []).includes(memberId);
  });
}

export const BADGES = [
  { id: 'first', icon: '🧽', title: 'Erster Wisch', text: 'die erste Aufgabe erledigt', goal: 1, stat: 'tasks' },
  { id: 'week', icon: '🔥', title: 'Eine Woche dran', text: '7 Tage am Stück', goal: 7, stat: 'best' },
  { id: 'boss', icon: '🦸', title: 'Endgegner besiegt', text: 'eine „Endgegner“-Aufgabe, z. B. den Backofen', goal: 1, stat: 'boss' },
  { id: 'dogs', icon: '🐾', title: 'Hunde-Held', text: '20 Hunde-Checks auf der Terrasse', goal: 20, stat: 'dogs' },
  { id: 'bins', icon: '🗑️', title: 'Tonnen-Profi', text: '10 Mal Tonnen rausgestellt', goal: 10, stat: 'bins' },
  { id: 'corners', icon: '🔍', title: 'Ecken-Jäger', text: '10 seltene Aufgaben (Fußleisten, Lichtschalter & Co.)', goal: 10, stat: 'rare' },
  { id: 'helper', icon: '📨', title: 'Zuverlässig', text: '10 zugeschickte Aufgaben erledigt', goal: 10, stat: 'assigned' },
  { id: 'rooms', icon: '🏠', title: 'Rundum sauber', text: 'in jedem Bereich etwas erledigt', goal: 0, stat: 'rooms' }, // Ziel je Person
  { id: 'month', icon: '🏆', title: 'Monats-Held', text: '30 Tage am Stück', goal: 30, stat: 'best' },
  { id: 'hundred', icon: '💯', title: 'Hundert', text: '100 Aufgaben erledigt', goal: 100, stat: 'tasks' },
];

export function badgeStats(state, memberId, todayKey) {
  const mine = state.history.filter((h) => h.member === memberId && !isBonus(h));
  const tasks = new Map(state.tasks.map((t) => [t.id, t]));
  const of = (h) => tasks.get(h.taskId);
  const rooms = roomsFor(state, memberId);
  return {
    tasks: mine.length,
    best: personalStreak(state.history, memberId, todayKey).best,
    boss: mine.filter((h) => of(h)?.effort === 5).length,
    dogs: mine.filter((h) => h.taskId === HUNDE_CHECK).length,
    bins: mine.filter((h) => !h.taskId && / rausstellen$/.test(h.title || '')).length,
    rare: mine.filter((h) => (of(h)?.interval ?? 0) >= 30).length,
    assigned: state.assignments.filter((a) => a.doneAt && a.doneBy === memberId && a.to === memberId && !isClaim(a)).length,
    rooms: new Set(mine.map((h) => of(h)?.room).filter((r) => rooms.includes(r))).size,
    roomsGoal: rooms.length,
  };
}

export function badgesFor(state, memberId, todayKey) {
  const stats = badgeStats(state, memberId, todayKey);
  return BADGES.map((b) => {
    const goal = b.id === 'rooms' ? stats.roomsGoal : b.goal;
    return { ...b, goal, value: Math.min(goal, stats[b.stat]), earned: goal > 0 && stats[b.stat] >= goal };
  });
}
