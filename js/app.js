import {
  ROOMS, EFFORT_LABELS, POINTS, HUNDE_CHECK, dateKey, addDays, dueRatio, daysUntilDue, pointsFor,
  roomStatus, quickPlan, planTaskIds, computeStreak, levelFor, slug, MAX_JOKERS, privateTasks, TASK_HINTS, RETIRED_TASKS,
} from './planner.js';
import {
  load, save, freshState, migrate, roomName, roomEmoji, planFor, doneEntry, toggleTask, memberPoints, familyPoints,
  effectiveTasks, setPusher, newId, addAssignment, deleteAssignment, toggleAssignment, assignmentTitle, assignmentPoints,
  saveMember, removeMember, saveTask, removeTask, saveSettings, setWaste, toggleWaste,
  syncStreakBonus, toggleClaim, claimOf, cleanupClaims, setAssignmentPhoto,
  isPrivateRoom, roomOwners, privateRooms, ownedRooms, unassignedPrivateRooms, toggleRoomOwner,
  isPaused, excludedRooms, setRoomPaused, upgradeAlltag,
} from './store.js';
import { personalStreak, nextMilestone, badgesFor, isClaim } from './rewards.js';
import { importWaste, importFromSchichtplaner, wasteDue, wasteDone, nextPickups, wasteIcon, WASTE_POINTS } from './waste.js';
import * as sync from './sync.js';
import { pushSupport, enablePush, updatePush, disablePush, testPush } from './push.js';

// Bei jeder Veröffentlichung zusammen mit CACHE in sw.js erhöhen.
const APP_VERSION = 22;

let state = load();
let tab = 'heute';
let openRoom = null;
let timer = null; // { index, endAt, remaining, paused, finished }
let sheet = null; // { type: 'send' | 'join' | 'create' | 'picker' | 'invite', ... }
let busy = false;

const $app = document.getElementById('app');
const $overlay = document.getElementById('overlay');
const $toast = document.getElementById('toast');

const MEMBER_EMOJIS = ['👩', '👨', '👧', '👦', '🧑', '👵', '👴', '🐶', '🦄', '🐱', '🌻', '⚡'];
const ROUND_MINUTES = { normal: 7, quick: 5 };
const WEEKDAYS = ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.'];

// ---------- Hilfen ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const today = () => dateKey();
const member = (id) => state.members.find((m) => m.id === id);
const me = () => member(state.currentMember) || state.members[0] || { id: null, name: 'du', emoji: '🙂' };
const task = (id) => state.tasks.find((t) => t.id === id);
const isQuick = () => !!state.quickDays[today()];
// Eltern-Rechte: ohne Familie oder ohne festgelegte Eltern dürfen alle alles (wie bisher).
const rightsOn = () => !!(state.sync && state.rightsEnabled);
const hasParents = () => state.members.some((m) => m.role === 'parent');
const isParent = () => member(state.currentMember)?.role === 'parent';
const canManage = () => !rightsOn() || !hasParents() || isParent();
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const formatCode = (c) => (c ? `${c.slice(0, 4)}-${c.slice(4)}` : '');
const who = (id) => {
  const m = member(id);
  return m ? `${m.emoji} ${esc(m.name)}` : 'jemand';
};

function mondayOf(key) {
  const d = new Date(`${key}T12:00:00`);
  return addDays(key, -((d.getDay() + 6) % 7));
}

function shortDate(key) {
  const d = new Date(`${key}T12:00:00`);
  return `${WEEKDAYS[d.getDay()]} ${key.slice(8)}.${key.slice(5, 7)}.`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 11) return 'Guten Morgen';
  if (h < 17) return 'Hallo';
  return 'Guten Abend';
}

const CHEERS = [
  'Wanda ist stolz auf dich!', 'Zack, erledigt! 💪', 'Sauber! Im wahrsten Sinne.', 'Das Haus sagt danke!',
  'Weiter so, Putzrakete!', 'Ein Staubkorn weniger auf der Welt.', 'Läuft bei dir! ✨', 'Glänzend gemacht!',
];
const BIG_CHEERS = [
  'Den Endgegner besiegt! 🏆', 'Respekt – das macht sonst keiner gern!', 'Heldentat des Tages! 🦸',
];
const MORNING_LINES = [
  'Eine Stunde, kleine Häppchen. Du schaffst das!', 'Nicht perfekt, nur sichtbar besser. Los geht\'s!',
  'Heute nehmen wir uns die Ecken vor, die sonst keiner sieht.', 'Musik an, Timer an, Wanda ist dabei.',
  'Jede Kleinigkeit zählt – auch fünf Minuten.',
];

function toast(text, ms = 2200) {
  $toast.textContent = text;
  $toast.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => $toast.classList.remove('show'), ms);
}

function burst(x, y, big) {
  const symbols = big ? ['✨', '🎉', '⭐', '🧽', '💫'] : ['✨', '⭐', '💧'];
  const n = big ? 14 : 7;
  for (let i = 0; i < n; i++) {
    const el = document.createElement('span');
    el.className = 'burst';
    el.textContent = pick(symbols);
    const angle = (Math.PI * 2 * i) / n;
    const dist = (big ? 90 : 55) + Math.random() * 30;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    el.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 900);
  }
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.25, 0.5].forEach((t, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = [660, 880, 1046][i];
      g.gain.setValueAtTime(0.25, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.22);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.25);
    });
  } catch {
    // Kein Ton möglich – macht nichts.
  }
  navigator.vibrate?.([200, 100, 200]);
}

// ---------- Abhaken ----------

const earnedIds = () => new Set(badgesFor(state, me().id, today()).filter((b) => b.earned).map((b) => b.id));

// Nach jedem Abhaken (und Rückgängigmachen): Serien-Bonus und neue Abzeichen prüfen.
function rewardCheck(before) {
  const bonus = syncStreakBonus(state, me().id, today());
  const fresh = badgesFor(state, me().id, today()).filter((b) => b.earned && !before.has(b.id));
  let delay = 2300;
  if (bonus) {
    setTimeout(() => {
      burst(window.innerWidth / 2, window.innerHeight / 3, true);
      toast(`${bonus.title}! +${bonus.points} Bonuspunkte 🎉`, 3500);
    }, delay);
    delay += 3600;
  }
  for (const b of fresh) {
    setTimeout(() => {
      burst(window.innerWidth / 2, window.innerHeight / 3, true);
      toast(`🏅 Neues Abzeichen: ${b.icon} ${b.title}!`, 3500);
    }, delay);
    delay += 3600;
  }
}

function celebrate(entry, big, ev) {
  const rect = ev?.target?.closest('[data-task],[data-assign]')?.getBoundingClientRect();
  if (rect) burst(rect.left + 28, rect.top + rect.height / 2, big);
  toast(`+${entry.points} Punkte · ${big ? pick(BIG_CHEERS) : pick(CHEERS)}`);
  navigator.vibrate?.(30);
  checkGoal();
}

// Fremde Erledigung zurücknehmen: nur Eltern (mit Rückfrage) – sonst niemand.
function mayUndo(done, label) {
  if (!done || done.member === me().id) return true;
  const name = member(done.member)?.name ?? 'Jemand';
  if (rightsOn() && isParent()) return confirm(`${name} hat „${label}“ erledigt. Als Eltern zurücknehmen?`);
  toast(`✋ Das hat ${name} erledigt – zurücknehmen kann das nur ${name} selbst${rightsOn() ? ' oder die Eltern' : ''}.`, 4000);
  return false;
}

// Von jemand anderem übernommen? Dann darf nur diese Person abhaken.
function claimedByOther(item) {
  const c = claimOf(state, item, today());
  if (!c || c.to === me().id) return false;
  toast(`🙋 Das hat ${member(c.to)?.name ?? 'jemand anderes'} übernommen.`, 3500);
  return true;
}

function complete(taskId, ev) {
  const t = task(taskId);
  if (!t) return;
  const done = doneEntry(state, taskId, today());
  if (!mayUndo(done, t.name)) return;
  if (!done && claimedByOther({ taskId })) return;
  const before = earnedIds();
  const entry = toggleTask(state, taskId, today(), me().id, pointsFor(t));
  if (entry) celebrate(entry, t.effort >= 4, ev);
  rewardCheck(before);
  render();
  if (timer) renderTimer();
}

function completeWaste(key, ev) {
  const e = state.waste?.events.find((x) => `${x.d}|${x.t}` === key);
  if (!e) return;
  const done = wasteDone(state.history, e);
  if (!mayUndo(done, `${e.t} rausstellen`)) return;
  if (!done && claimedByOther({ title: `${e.t} rausstellen` })) return;
  const before = earnedIds();
  const entry = toggleWaste(state, e, today(), me().id);
  if (entry) celebrate(entry, false, ev);
  rewardCheck(before);
  render();
}

function completeAssignment(id, ev) {
  const a = state.assignments.find((x) => x.id === id);
  if (!a) return;
  if (a.doneAt && !mayUndo({ member: a.doneBy }, assignmentTitle(state, a))) return;
  if (a.photo && !a.doneAt && !a.photoPath && state.photosEnabled) {
    toast('📷 Hier ist ein Foto als Beweis gewünscht – mach eins!');
    return takePhoto(id);
  }
  const before = earnedIds();
  const entry = toggleAssignment(state, id, today(), me().id);
  if (entry) celebrate(entry, (task(a.taskId)?.effort ?? 0) >= 4 || entry.points >= 35, ev);
  rewardCheck(before);
  render();
}

// ---------- Beweisfotos ----------

let photoFor = null; // Zuschickung, zu der gerade ein Foto aufgenommen wird

function takePhoto(id) {
  photoFor = id;
  document.getElementById('photo-input').click();
}

// Auf höchstens 1280 Pixel verkleinern – spart Speicher und Datenvolumen.
async function shrinkPhoto(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.75));
}

async function handlePhoto(file) {
  const id = photoFor;
  photoFor = null;
  const a = state.assignments.find((x) => x.id === id);
  if (!file || !a) return;
  toast('📷 Foto wird hochgeladen …', 8000);
  try {
    const path = await sync.uploadPhoto(await shrinkPhoto(file), id);
    setAssignmentPhoto(state, id, path);
    if (!a.doneAt) completeAssignment(id);
    else toast('📷 Foto nachgereicht ✓');
  } catch (e) {
    toast(e.network || !navigator.onLine
      ? 'Ohne Internet kann kein Foto hochgeladen werden – bitte später noch mal.'
      : `Das Foto konnte nicht hochgeladen werden: ${e.message}`, 5000);
  }
  render();
}

function renderPhotoSheet() {
  const a = state.assignments.find((x) => x.id === sheet.id);
  $overlay.innerHTML = `
    <div class="sheet center">
      <button type="button" class="icon-btn close" data-action="close-sheet" aria-label="Schließen">✕</button>
      <h2>📷 ${esc(a ? assignmentTitle(state, a) : 'Foto')}</h2>
      <p class="hint">${a?.doneBy ? `erledigt von ${who(a.doneBy)}` : ''}${a?.doneAt ? ` · ${shortDate(a.doneAt)}` : ''}</p>
      ${sheet.url ? `<img class="proof" src="${esc(sheet.url)}" alt="Beweisfoto">` : `<p>${sheet.error ? esc(sheet.error) : 'Foto wird geladen …'}</p>`}
      <button class="btn big" data-action="close-sheet">Schließen</button>
    </div>`;
}

const goalReached = (g) => !!g.reachedAt || familyPoints(state, g.since) >= g.points;

function checkGoal() {
  const g = state.goal;
  if (!g || state.goalCelebrated === g.since || familyPoints(state, g.since) < g.points) return;
  state.goalCelebrated = g.since; // Feier nur einmal pro Handy
  save(state);
  if (canManage() && !g.reachedAt) {
    g.reachedAt = today();
    saveSettings(state);
  }
  {
    setTimeout(() => {
      burst(window.innerWidth / 2, window.innerHeight / 2, true);
      toast(`🎉 Familienziel erreicht: ${g.title}!`, 4000);
    }, 500);
  }
}

// ---------- Bausteine ----------

function taskRow(id, opts = {}) {
  const t = task(id);
  if (!t) return '';
  const done = doneEntry(state, id, today());
  const claim = opts.claim && !done && state.members.length > 1 ? claimOf(state, { taskId: id }, today()) : null;
  const sub = [];
  if (opts.showRoom) sub.push(`${roomEmoji(t.room)} ${esc(roomName(state, t.room))}`);
  if (done) sub.push(`erledigt von ${who(done.member)}`);
  else if (opts.due) sub.push(dueText(opts.due));
  else if (TASK_HINTS[id]) sub.push(esc(TASK_HINTS[id]));
  if (claim) sub.push(claimText(claim));
  const row = `
    <button class="task ${done ? 'done' : ''} ${claim && claim.to !== me().id ? 'locked' : ''} effort-${t.effort}" data-task="${esc(id)}">
      <span class="check" aria-hidden="true">${done ? '✓' : ''}</span>
      <span class="task-body">
        <span class="task-name">${esc(t.name)}</span>
        ${sub.length ? `<span class="task-sub">${sub.join(' · ')}</span>` : ''}
      </span>
      <span class="pts" title="${EFFORT_LABELS[t.effort]}">+${pointsFor(t)}</span>
    </button>`;
  if (opts.claim && !done && state.members.length > 1 && (!claim || claim.to === me().id)) {
    return `<div class="task-wrap">${row}${claimButton('data-claim', id, claim)}</div>`;
  }
  if (!opts.send) return row;
  return `<div class="task-wrap">${row}<button class="send-btn" data-send="${esc(id)}" aria-label="Aufgabe zuschicken" title="Jemandem zuschicken">📨</button></div>`;
}

function claimText(claim) {
  return claim.to === me().id ? '<span class="claimed">🙋 du machst das</span>' : `<span class="claimed">🙋 ${who(claim.to)} macht das</span>`;
}

function claimButton(attr, value, claim) {
  const mine = claim && claim.to === me().id;
  return `<button class="send-btn claim-btn ${mine ? 'active' : ''}" ${attr}="${esc(value)}" aria-label="${mine ? 'Doch nicht übernehmen' : 'Übernehme ich'}" title="${mine ? 'Doch nicht' : 'Übernehme ich'}">🙋</button>`;
}

function dueText(t) {
  const d = daysUntilDue(t, today());
  if (d < 0) return `<span class="late">${-d} ${-d === 1 ? 'Tag' : 'Tage'} überfällig</span>`;
  if (d === 0) return '<span class="late">heute fällig</span>';
  if (d === 1) return 'morgen fällig';
  return `fällig in ${d} Tagen`;
}

function deadline(due) {
  if (!due) return '';
  const k = today();
  if (due < k) return `<span class="late">war bis ${shortDate(due)}</span>`;
  if (due === k) return '<span class="late">bis heute</span>';
  if (due === addDays(k, 1)) return 'bis morgen';
  return `bis ${shortDate(due)}`;
}

function assignRow(a, opts = {}) {
  const sub = [];
  if (opts.showTo) sub.push(`an ${who(a.to)}`);
  else if (a.from && a.from !== a.to) sub.push(`von ${who(a.from)}`);
  if (a.doneAt) sub.push(`✓ erledigt${a.doneBy && a.doneBy !== a.to ? ` von ${who(a.doneBy)}` : ''}`);
  else if (a.due) sub.push(deadline(a.due));
  if (a.note) sub.push(`„${esc(a.note)}“`);
  if (a.photoPath) sub.push('📷 mit Foto');
  else if (a.photo && !a.doneAt) sub.push('<span class="late">📷 Foto als Beweis</span>');
  const t = task(a.taskId);
  // In der Übersicht nur anzeigen – abhaken kann die Person selbst unter „Für dich“.
  const tag = opts.showTo ? 'div' : 'button';
  const check = `
    <${tag} class="task assigned ${a.doneAt ? 'done' : ''} ${opts.showTo ? 'static' : ''} effort-${t?.effort ?? 2}" ${opts.showTo ? '' : `data-assign="${esc(a.id)}"`}>
      <span class="check" aria-hidden="true">${a.doneAt ? '✓' : ''}</span>
      <span class="task-body">
        <span class="task-name">${esc(assignmentTitle(state, a))}${t ? ` <small>${roomEmoji(t.room)}</small>` : ''}</span>
        <span class="task-sub">${sub.join(' · ')}</span>
      </span>
      <span class="pts">+${assignmentPoints(state, a)}</span>
    </${tag}>`;
  const buttons = [];
  if (a.photoPath) {
    buttons.push(`<button class="send-btn" data-view-photo="${esc(a.id)}" aria-label="Foto ansehen" title="Foto ansehen">🖼️</button>`);
  } else if (!opts.showTo && state.photosEnabled && state.sync && a.to === me().id) {
    buttons.push(`<button class="send-btn" data-photo="${esc(a.id)}" aria-label="Foto" title="${a.doneAt ? 'Foto nachreichen' : 'Mit Foto erledigen'}">📷</button>`);
  }
  if (opts.removable && (a.from === me().id || canManage())) {
    buttons.push(`<button class="send-btn" data-unassign="${esc(a.id)}" aria-label="Zurückziehen" title="Zurückziehen">✕</button>`);
  }
  return buttons.length ? `<div class="task-wrap">${check}${buttons.join('')}</div>` : check;
}

// Tonnen von heute nur bis mittags zeigen – danach ist die Abfuhr meist durch.
function wasteNow() {
  const k = today();
  const morning = new Date().getHours() < 12;
  return wasteDue(state.waste, k).filter((e) => !e.today || morning || wasteDone(state.history, e)?.date === k);
}

function wasteRow(e) {
  const done = wasteDone(state.history, e);
  const sent = !done && state.assignments.find((a) => !a.taskId && !a.doneAt && a.title === e.title && !isClaim(a));
  const claim = !done && !sent ? claimOf(state, { title: e.title }, today()) : null;
  const sub = done
    ? `erledigt von ${who(done.member)}`
    : [e.today ? '<span class="late">heute ist Abholung – schnell noch raus!</span>' : 'morgen ist Abholung · heute Abend rausstellen',
      sent ? `📨 an ${who(sent.to)}` : '', claim ? claimText(claim) : ''].filter(Boolean).join(' · ');
  const row = `
    <button class="task ${done ? 'done' : ''}" data-waste="${esc(`${e.d}|${e.t}`)}">
      <span class="check" aria-hidden="true">${done ? '✓' : ''}</span>
      <span class="task-body">
        <span class="task-name">${e.icon} ${esc(e.title)}</span>
        <span class="task-sub">${sub}</span>
      </span>
      <span class="pts">+${WASTE_POINTS}</span>
    </button>`;
  if (done || sent || state.members.length < 2) return row;
  const key = `${e.d}|${e.t}`;
  const claimBtn = !claim || claim.to === me().id ? claimButton('data-claim-waste', key, claim) : '';
  const sendBtn = claim ? '' : `<button class="send-btn" data-send-waste="${esc(key)}" aria-label="Jemandem zuschicken" title="Jemandem zuschicken">📨</button>`;
  return claimBtn || sendBtn ? `<div class="task-wrap">${row}${claimBtn}${sendBtn}</div>` : row;
}

function section({ icon, title, meta, body, extra = '', cls = '' }) {
  return `
    <section class="card ${cls}">
      <header class="card-head">
        <span class="card-icon">${icon}</span>
        <div><h2>${title}</h2>${meta ? `<p class="meta">${meta}</p>` : ''}</div>
        ${extra}
      </header>
      ${body}
    </section>`;
}

function progressRing(pct) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return `
    <svg class="ring" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="${r}" class="ring-bg"/>
      <circle cx="32" cy="32" r="${r}" class="ring-fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}"/>
    </svg>`;
}

// ---------- Ansicht: Heute ----------

function myAssignments() {
  const k = today();
  return state.assignments
    .filter((a) => a.to === me().id && !isClaim(a) && (!a.doneAt || a.doneAt === k))
    .sort((a, b) => !!a.doneAt - !!b.doneAt || (a.due || '9999').localeCompare(b.due || '9999'));
}

function nextBinChip() {
  const k = today();
  const next = nextPickups(state.waste, addDays(k, 1), 12);
  if (!next.length) return '';
  const day = next[0].d;
  const icons = [...new Set(next.filter((e) => e.d === day).map((e) => wasteIcon(e.t)))].join('');
  const when = day === addDays(k, 1) ? 'morgen' : shortDate(day);
  return `<span class="chip" title="Nächste Abholung">${icons} ${when}</span>`;
}

// Gespeicherte Pläne können noch private Räume enthalten (z. B. vor der Zuordnung erstellt).
function withoutPrivate(plan) {
  const priv = excludedRooms(state);
  const roomOf = (id) => task(id)?.room;
  return {
    ...plan,
    rounds: plan.rounds.filter((r) => !priv.includes(r.room)),
    focus: priv.includes(plan.focusRoom) ? [] : plan.focus,
    mission: plan.mission && priv.includes(roomOf(plan.mission)) ? null : plan.mission,
  };
}

// Aufgaben in meinen eigenen Zimmern: was fällig ist, plus was ich heute dort schon erledigt habe.
function ownTasks(key) {
  const rooms = ownedRooms(state, me().id);
  if (!rooms.length) return [];
  const doneHere = state.history
    .filter((h) => h.date === key && rooms.includes(task(h.taskId)?.room))
    .map((h) => h.taskId);
  const due = privateTasks(effectiveTasks(state), rooms, key, isQuick() ? 1 : 4).map((t) => t.id);
  return [...new Set([...doneHere, ...due])];
}

// Besitz eines Raums: antippbare Knöpfe – mehrere Personen möglich (z. B. Elternschlafzimmer)
// Alles, was heute fällig oder schon überfällig ist und nicht im Tagesplan steht.
// Maßgeblich ist der Stand von heute früh – so bleibt Erledigtes heute sichtbar (abgehakt).
let showAllDue = false;
function dueOutsidePlan(key, exclude) {
  const morning = effectiveTasks({ ...state, history: state.history.filter((h) => h.date < key) });
  const priv = excludedRooms(state);
  return morning
    .filter((t) => !exclude.has(t.id) && !priv.includes(t.room) && daysUntilDue(t, key) <= 0)
    .sort((a, b) => daysUntilDue(a, key) - daysUntilDue(b, key) || b.effort - a.effort);
}

function ownerChips(id) {
  const owners = roomOwners(state, id);
  const shared = !isPrivateRoom(state, id);
  return `<div class="owner-chips">
    <button class="owner-chip ${shared ? 'active' : ''}" data-owner-room="${id}" data-owner="shared">👨‍👩‍👧 gemeinsam</button>
    ${state.members.map((m) => `<button class="owner-chip ${owners.includes(m.id) ? 'active' : ''}" data-owner-room="${id}" data-owner="${esc(m.id)}">${m.emoji} ${esc(m.name)}</button>`).join('')}
  </div>`;
}

const namesOf = (ids) => {
  const list = ids.map((mid) => member(mid)).filter(Boolean).map((m) => `${m.emoji} ${esc(m.name)}`);
  return list.length > 1 ? `${list.slice(0, -1).join(', ')} & ${list[list.length - 1]}` : list[0] || '';
};

let ownerPromptRooms = null; // Räume, die die Abfrage „Wem gehört …“ gerade zeigt
function viewToday() {
  const key = today();
  const full = planFor(state, key);
  const plan = withoutPrivate(isQuick() ? quickPlan(full) : full);
  const own = ownTasks(key);
  const ids = [...planTaskIds(plan), ...own];
  const mine = myAssignments();
  const bins = wasteNow();
  const total = ids.length + mine.length + bins.length;
  const doneCount = ids.filter((id) => doneEntry(state, id, key)).length + mine.filter((a) => a.doneAt).length
    + bins.filter((e) => wasteDone(state.history, e)).length;
  const pct = total ? doneCount / total : 0;
  const { streak, jokers, doneToday } = personalStreak(state.history, me().id, key);
  const next = nextMilestone(streak);
  const todayPts = memberPoints(state, me().id, key);
  const claims = state.assignments.filter((a) => isClaim(a) && a.to === me().id && a.due === key);
  const claimsOpen = claims.filter((a) => !a.doneAt).length;
  const family = state.members.length > 1;
  const allDone = total && doneCount === total;
  const mins = isQuick() ? ROUND_MINUTES.quick : ROUND_MINUTES.normal;

  const line = allDone
    ? 'Alles geschafft! Feierabend – du hast es dir verdient. 🛋️'
    : mine.some((a) => !a.doneAt)
      ? `Du hast ${mine.filter((a) => !a.doneAt).length} zugeschickte ${mine.filter((a) => !a.doneAt).length === 1 ? 'Aufgabe' : 'Aufgaben'}. 📨`
      : claimsOpen
        ? `Du hast noch ${claimsOpen} von ${claims.length} übernommenen ${claims.length === 1 ? 'Aufgabe' : 'Aufgaben'} offen. 🙋`
        : doneCount
          ? `${doneCount} von ${total} erledigt. Weiter so!`
          : family && !state.assignments.some((a) => isClaim(a) && a.due === key)
            ? 'Der Plan gilt für die ganze Familie. Mit 🙋 sagst du, welche Aufgaben du übernimmst!'
            : MORNING_LINES[new Date().getDate() % MORNING_LINES.length];

  const hero = `
    <section class="hero">
      <div class="hero-text">
        <p class="hello">${greeting()}, ${esc(me().name)}!</p>
        <p class="wanda-says"><img src="icons/wanda.svg" alt="" class="wanda-mini">${line}</p>
        <div class="stats">
          <span class="chip" title="${next ? `Deine Serie – bei ${next.days} Tagen gibt es +${next.points} Bonuspunkte` : 'Deine Serie'}">🔥 ${streak} ${streak === 1 ? 'Tag' : 'Tage'}${doneToday || !streak ? '' : ' – heute noch offen'}</span>
          <span class="chip" title="Joker retten einen verpassten Tag. Alle 7 aktiven Tage gibt es einen neuen.">🃏 ${jokers}/${MAX_JOKERS}</span>
          <span class="chip">⭐ ${todayPts} heute</span>
          ${claims.length ? `<span class="chip" title="Von dir übernommen">🙋 ${claims.length - claimsOpen}/${claims.length}</span>` : ''}
          ${nextBinChip()}
        </div>
      </div>
      <div class="hero-ring">${progressRing(pct)}<span>${Math.round(pct * 100)}%</span></div>
    </section>
    ${next && streak > 0 ? `<p class="streak-next">🔥 Noch ${next.days - streak} ${next.days - streak === 1 ? 'Tag' : 'Tage'} bis zu <b>+${next.points} Bonuspunkten</b>${doneToday ? '' : ' – heute schon was erledigt?'}</p>` : ''}`;

  const cards = [];
  const row = (id) => taskRow(id, { claim: true });
  const due = dueOutsidePlan(key, new Set(ids));
  const dueOpen = due.filter((t) => !doneEntry(state, t.id, key));
  let dueCard = '';
  if (due.length) {
    const shown = showAllDue ? due : due.slice(0, 6);
    dueCard = section({
      icon: '🔴', title: 'Fällig & überfällig', cls: 'overdue',
      meta: dueOpen.length
        ? `${dueOpen.length} ${dueOpen.length === 1 ? 'Aufgabe wartet' : 'Aufgaben warten'} außerhalb des Tagesplans – wer schafft eine?`
        : 'Alles abgearbeitet – stark! 💪',
      body: `${shown.map((t) => taskRow(t.id, { claim: true, showRoom: true, due: t })).join('')}
        ${due.length > shown.length ? `<button class="btn ghost" data-action="show-all-due">Alle ${due.length} anzeigen</button>` : ''}`,
    });
  }
  if (mine.length) {
    cards.push(section({
      icon: '📨', title: 'Für dich', meta: 'Aufgaben, die dir jemand zugeschickt hat', cls: 'for-you',
      body: mine.map((a) => assignRow(a)).join(''),
    }));
  }
  const unassigned = unassignedPrivateRooms(state);
  if (!ownerPromptRooms && unassigned.length && canManage()) ownerPromptRooms = unassigned;
  if (ownerPromptRooms) {
    cards.push(section({
      icon: '🔒', title: 'Wem gehört welches Zimmer?',
      meta: 'Private Zimmer sind nicht in der gemeinsamen Runde. Wer ein Zimmer besitzt, bekommt es auf der eigenen Heute-Seite. Ein Zimmer kann auch mehreren gehören.',
      body: `${ownerPromptRooms.map((id) => `
        <div class="owner-block"><span class="owner-room">${roomEmoji(id)} ${esc(roomName(state, id))}</span>${ownerChips(id)}</div>`).join('')}
        ${state.members.length < 2 ? '<p class="hint">Fehlt jemand? Personen kannst du unter Einstellungen → Familie hinzufügen.</p>' : ''}
        <button class="btn" data-action="owners-done">Fertig ✓</button>`,
    }));
  }
  if (own.length || ownedRooms(state, me().id).length) {
    const rooms = ownedRooms(state, me().id);
    const nextUp = !own.length && effectiveTasks(state).filter((t) => rooms.includes(t.room))
      .sort((a, b) => daysUntilDue(a, key) - daysUntilDue(b, key))[0];
    cards.push(section({
      icon: '🔒', title: rooms.map((id) => esc(roomName(state, id))).join(' & '),
      meta: 'nur für dich · die anderen sehen das nicht', cls: 'own-room',
      body: own.length ? own.map((id) => taskRow(id)).join('')
        : `<p class="hint">Alles im grünen Bereich ✨${nextUp ? ` Als Nächstes: ${esc(nextUp.name)} in ${daysUntilDue(nextUp, key)} Tagen.` : ''}</p>`,
    }));
  }
  if (bins.length) {
    cards.push(section({
      icon: '🗑️', title: 'Müll', meta: bins.some((e) => !e.today) ? 'morgen wird abgeholt' : 'heute wird abgeholt',
      body: bins.map(wasteRow).join(''),
    }));
  }
  if (dueCard) cards.push(dueCard);
  cards.push(`
    <label class="quick">
      <input type="checkbox" data-action="quick" ${isQuick() ? 'checked' : ''}>
      <span class="switch"></span>
      <span><b>Nur 15 Minuten heute</b><br><small>Für Tage mit wenig Energie – zählt trotzdem für die Serie.</small></span>
    </label>`);
  if (plan.alltag.length) {
    cards.push(section({
      icon: '☀️', title: 'Grundroutine', meta: 'ca. 10 Minuten · das tägliche Fundament',
      body: plan.alltag.map(row).join(''),
    }));
  }
  if (plan.hunde.length) {
    cards.push(section({
      icon: '🐾', title: 'Terrasse & Hunde', meta: 'kurz nachsehen, bevor jemand reintritt',
      body: plan.hunde.map(row).join(''),
    }));
  }
  if (plan.rounds.length) {
    cards.push(section({
      icon: '⏱️', title: 'Raum-Runde', meta: `${plan.rounds.length} Räume × ${mins} Minuten · nicht perfekt, nur sichtbar besser`,
      extra: '<button class="btn small" data-action="start-round">▶ Start</button>',
      body: plan.rounds.map((r) => `
        <div class="round-room">
          <h3>${roomEmoji(r.room)} ${esc(roomName(state, r.room))}</h3>
          ${r.tasks.length ? r.tasks.map(row).join('') : '<p class="hint">Kurz durchgehen: Oberflächen frei, Dinge wegräumen, lüften.</p>'}
        </div>`).join(''),
    }));
  }
  if (plan.focus.length) {
    cards.push(section({
      icon: '🔍', title: `Fokus der Woche: ${esc(roomName(state, plan.focusRoom))}`,
      meta: 'ca. 15–20 Minuten · diese Woche wird hier gründlich geputzt',
      body: plan.focus.map(row).join(''),
    }));
  }
  if (plan.mission) {
    cards.push(section({
      icon: '🎯', title: 'Mission des Tages', meta: 'die Ecke, die sonst immer vergessen wird', cls: 'mission',
      body: taskRow(plan.mission, { showRoom: true, claim: true }),
    }));
  }
  return hero + cards.join('');
}

// ---------- Ansicht: Räume ----------

function viewRooms() {
  const key = today();
  const focus = planFor(state, key).focusRoom;
  const tasks = effectiveTasks(state);
  const visible = (id) => !isPrivateRoom(state, id) || roomOwners(state, id).includes(me().id);
  const roomCards = ROOMS.map((r) => {
    if (isPaused(state, r.id)) {
      return `
      <section class="card room private paused">
        <div class="room-head">
          <span class="dot private"></span>
          <span class="room-name">${r.emoji} ${esc(roomName(state, r.id))}</span>
          <span class="room-meta">⏸️ pausiert</span>
        </div>
      </section>`;
    }
    if (!visible(r.id)) {
      const owners = roomOwners(state, r.id);
      return `
      <section class="card room private">
        <div class="room-head">
          <span class="dot private"></span>
          <span class="room-name">${r.emoji} ${esc(roomName(state, r.id))}</span>
          <span class="room-meta">🔒 ${owners.length ? `gehört ${namesOf(owners)}` : 'privat'}</span>
        </div>
      </section>`;
    }
    const st = roomStatus(tasks, r.id, key);
    const open = openRoom === r.id;
    const mine = isPrivateRoom(state, r.id);
    const list = tasks.filter((t) => t.room === r.id).sort((a, b) => dueRatio(b, key) - dueRatio(a, key));
    return `
      <section class="card room ${open ? 'open' : ''}">
        <button class="room-head" data-room="${r.id}">
          <span class="dot ${st.level}"></span>
          <span class="room-name">${r.emoji} ${esc(roomName(state, r.id))}${r.id === focus && !mine ? ' <span class="badge">Fokus</span>' : ''}${mine ? ' <span class="badge mine">🔒 deins</span>' : ''}</span>
          <span class="room-meta">${st.overdue ? `${st.overdue} fällig` : 'alles gut'}</span>
          <span class="chev">${open ? '▴' : '▾'}</span>
        </button>
        ${open ? `<div class="room-tasks">${list.map((t) => taskRow(t.id, { due: t, send: state.members.length > 1 && !mine })).join('')}</div>` : ''}
      </section>`;
  });
  const shown = ROOMS.filter((r) => visible(r.id) && !isPaused(state, r.id));
  const green = shown.filter((r) => roomStatus(tasks, r.id, key).level === 'green').length;
  return `
    <section class="hero slim">
      <div class="hero-text">
        <p class="hello">Wie steht's ums Haus?</p>
        <p class="wanda-says"><img src="icons/wanda.svg" alt="" class="wanda-mini">${green} von ${shown.length} Bereichen sind grün. Tipp auf einen Raum, um auch außer der Reihe etwas abzuhaken${state.members.length > 1 ? ' oder mit 📨 jemandem zuzuschicken' : ''}.</p>
      </div>
    </section>
    ${roomCards.join('')}`;
}

// ---------- Ansicht: Familie ----------

const STATUS_TEXT = {
  ok: 'verbunden · alles aktuell',
  pending: 'verbunden · Änderungen werden gesendet …',
  offline: 'gerade offline · Änderungen werden später gesendet',
  local: '',
};

function syncCard() {
  if (!sync.syncConfigured()) return '';
  if (!state.sync) {
    return section({
      icon: '☁️', title: 'Familie verbinden',
      meta: 'Damit alle auf ihren Handys dieselben Aufgaben und Punkte sehen und ihr euch Aufgaben zuschicken könnt.',
      body: `
        <div class="row wrap">
          <button class="btn" data-action="open-create">Familie gründen</button>
          <button class="btn ghost" data-action="open-join">Mit Code beitreten</button>
        </div>
        <p class="hint">Gründen macht nur eine Person – alle anderen treten mit dem Einladungscode bei.</p>`,
    });
  }
  return section({
    icon: '☁️', title: esc(state.sync.name || 'Familie'),
    meta: `<span class="sync-dot ${sync.getStatus()}"></span> ${STATUS_TEXT[sync.getStatus()] || ''}`,
    body: `
      <p class="owner-line-me">📱 Dieses Handy gehört: <b>${me().emoji} ${esc(me().name)}</b></p>
      <div class="invite">
        <span>Einladungscode</span>
        <b>${formatCode(state.sync.inviteCode)}</b>
      </div>
      <div class="row wrap">
        <button class="btn" data-action="share-invite">📤 Einladung teilen</button>
        <button class="btn ghost small" data-action="leave">Dieses Handy abmelden</button>
      </div>
      <p class="hint">Falsche Person gewählt? „Dieses Handy abmelden“ und mit dem Code neu beitreten.</p>`,
  });
}

function viewFamily() {
  const key = today();
  const monday = mondayOf(key);
  const g = state.goal;
  const goalPts = familyPoints(state, g.since);
  const goalPct = Math.min(1, goalPts / g.points);

  const ranking = state.members
    .map((m) => ({ m, week: memberPoints(state, m.id, monday), total: memberPoints(state, m.id) }))
    .sort((a, b) => b.week - a.week);

  const members = ranking.map(({ m, week, total }) => {
    const lvl = levelFor(total);
    const { streak } = personalStreak(state.history, m.id, key);
    const badges = badgesFor(state, m.id, key).filter((b) => b.earned);
    return `
      <div class="member ${m.id === state.currentMember ? 'me' : ''}">
        <span class="avatar">${m.emoji}</span>
        <div class="member-body">
          <b>${esc(m.name)}</b>
          <small>${lvl.emoji} ${lvl.title}${lvl.next ? ` · noch ${lvl.toNext} bis ${lvl.next.emoji}` : ''}</small>
          <small>🔥 ${streak} ${streak === 1 ? 'Tag' : 'Tage'}${badges.length ? ` · ${badges.map((b) => b.icon).join('')}` : ''}</small>
        </div>
        <div class="member-pts"><b>${week}</b><small>diese Woche</small></div>
      </div>`;
  });

  const recent = [...state.history].reverse().slice(0, 12).map((h) => {
    const t = task(h.taskId);
    const m = member(h.member);
    const when = h.date === key ? 'heute' : h.date === addDays(key, -1) ? 'gestern' : shortDate(h.date);
    return `<li><span>${m?.emoji ?? '❔'}</span><span>${esc(t?.name ?? h.title ?? RETIRED_TASKS[h.taskId] ?? 'Aufgabe')} <small>${t ? esc(roomName(state, t.room)) + ' · ' : ''}${when}</small></span><b>+${h.points}</b></li>`;
  });

  // Offene Zuschickungen plus die der letzten drei Tage
  const recentCut = addDays(key, -3);
  const sent = state.assignments
    .filter((a) => !isClaim(a) && (!a.doneAt || a.doneAt >= recentCut))
    .sort((a, b) => !!a.doneAt - !!b.doneAt || (a.due || '9999').localeCompare(b.due || '9999'));

  return `
    ${syncCard()}
    ${section({
      icon: '📨', title: 'Zugeschickte Aufgaben', meta: 'wer gerade was übernimmt',
      extra: state.members.length > 1 ? '<button class="btn small" data-action="open-send">+ Neu</button>' : '',
      body: state.members.length < 2
        ? '<p class="hint">Füge in den Einstellungen weitere Personen hinzu, um Aufgaben zuzuschicken.</p>'
        : sent.length ? sent.map((a) => assignRow(a, { showTo: true, removable: true })).join('') : '<p class="hint">Gerade ist nichts zugeschickt. Tipp auf „+ Neu“ oder im Räume-Tab auf 📨.</p>',
    })}
    ${section({
      icon: '🎁', title: 'Familienziel', meta: esc(g.title),
      body: `
        <div class="goal-bar"><span style="width:${goalPct * 100}%"></span></div>
        <p class="goal-text">${goalPts} von ${g.points} Punkten${goalReached(g) ? ` – 🎉 geschafft!${canManage() ? ' Neues Ziel in den Einstellungen setzen.' : ''}` : ''}</p>
        ${goalRanking(g, goalPts)}`,
    })}
    ${rightsCard()}
    ${badgeCard(key)}
    ${state.sync ? '' : section({
      // Nur wenn sich mehrere ein Handy teilen – mit Familien-Verbindung hat jede Person ihr eigenes Handy.
      icon: '👨‍👩‍👧', title: 'Wer bist du gerade?', meta: 'Punkte werden der ausgewählten Person gutgeschrieben',
      body: `<div class="who">${state.members.map((m) => `
        <button class="who-btn ${m.id === state.currentMember ? 'active' : ''}" data-member="${esc(m.id)}">${m.emoji}<span>${esc(m.name)}</span></button>`).join('')}</div>`,
    })}
    ${section({ icon: '🏅', title: 'Punkte diese Woche', body: `<div class="members">${members.join('')}</div>` })}
    ${section({
      icon: '📜', title: 'Zuletzt erledigt',
      body: recent.length ? `<ul class="recent">${recent.join('')}</ul>` : '<p class="hint">Noch nichts erledigt – die erste Aufgabe wartet auf der Heute-Seite.</p>',
    })}`;
}

// Wer hat wie viel zum Familienziel beigetragen – und wer spendiert?
function goalRanking(g, total) {
  if (state.members.length < 2) return '';
  const rows = state.members
    .map((m) => ({ m, pts: memberPoints(state, m.id, g.since) }))
    .sort((a, b) => b.pts - a.pts);
  const max = Math.max(1, rows[0].pts);
  const medals = ['🥇', '🥈', '🥉'];
  const list = rows.map(({ m, pts }, i) => `
    <li class="${m.id === state.currentMember ? 'me' : ''}">
      <span class="rank">${pts > 0 && i < 3 ? medals[i] : `${i + 1}.`}</span>
      <span class="avatar small">${m.emoji}</span>
      <span class="rank-body">
        <span class="rank-name">${esc(m.name)}<b>${pts}</b></span>
        <span class="rank-bar"><span style="width:${(pts / max) * 100}%"></span></span>
      </span>
      <small>${total ? Math.round((pts / total) * 100) : 0} %</small>
    </li>`).join('');
  let pays = '';
  if (g.loserPays !== false && total > 0) {
    const low = rows[rows.length - 1].pts;
    const losers = rows.filter((r) => r.pts === low).map((r) => `${r.m.emoji} ${esc(r.m.name)}`);
    const names = losers.length > 1 ? `${losers.slice(0, -1).join(', ')} & ${losers[losers.length - 1]}` : losers[0];
    pays = goalReached(g)
      ? `<p class="loser done">🎉 Ziel erreicht! ${names} ${losers.length > 1 ? 'spendieren' : 'spendiert'}: <b>${esc(g.title)}</b></p>`
      : `<p class="loser">🍕 Stand jetzt ${losers.length > 1 ? 'spendieren' : 'spendiert'} ${names} – noch ist Zeit, aufzuholen!</p>`;
  }
  return `<ol class="ranking">${list}</ol>${pays}`;
}

let devices = null; // Person → Anzahl Handys (wird beim Öffnen des Familie-Tabs geladen)
let parentPick = null; // Auswahl beim Festlegen der Eltern

function rightsCard() {
  if (!rightsOn()) return '';
  if (!hasParents()) {
    if (!state.isFounder) {
      return section({ icon: '👑', title: 'Eltern-Rechte', body: '<p class="hint">Wer die Familie gegründet hat, legt gerade fest, wer die Eltern sind.</p>' });
    }
    parentPick ??= [state.currentMember];
    return section({
      icon: '👑', title: 'Wer sind die Eltern?',
      meta: 'Nur Eltern dürfen dann Personen, Aufgaben, Räume, das Familienziel und den Abfallkalender ändern. Abhaken und Zuschicken können weiterhin alle.',
      body: `
        <div class="owner-chips">${state.members.map((m) => `
          <button class="owner-chip ${parentPick.includes(m.id) ? 'active' : ''}" data-parent-pick="${esc(m.id)}">${m.emoji} ${esc(m.name)}</button>`).join('')}
        </div>
        <button class="btn" data-action="save-parents">👑 Als Eltern festlegen</button>`,
    });
  }
  const list = state.members.map((m) => {
    const n = devices?.[m.id] || 0;
    return `
      <li>
        <span class="avatar small">${m.emoji}</span>
        <span class="rank-body"><b>${esc(m.name)}</b><small>${m.role === 'parent' ? '👑 Eltern' : '🧒 Kind'} · ${devices ? (n ? `📱 ${n === 1 ? 'auf einem Handy' : `auf ${n} Handys`}` : 'noch kein Handy') : '…'}</small></span>
        ${isParent() ? `<button class="btn ghost small" data-member-code="${esc(m.id)}">🔑 Code</button>` : ''}
      </li>`;
  }).join('');
  return section({
    icon: '👑', title: 'Eltern & Handys',
    meta: isParent()
      ? 'Neues Handy oder Handy gewechselt? Mit 🔑 Code bekommt es die richtige Person (gilt 24 Stunden).'
      : 'Neues Handy? Frag deine Eltern nach einem Einrichtungs-Code.',
    body: `<ul class="devices">${list}</ul>`,
  });
}

function badgeCard(key) {
  const badges = badgesFor(state, me().id, key);
  const earned = badges.filter((b) => b.earned).length;
  return section({
    icon: '🏅', title: 'Deine Abzeichen', meta: `${earned} von ${badges.length} gesammelt`,
    body: `<div class="badges">${badges.map((b) => `
      <div class="badge-item ${b.earned ? 'earned' : ''}" title="${esc(b.text)}">
        <span class="badge-icon">${b.icon}</span>
        <b>${esc(b.title)}</b>
        <small>${b.earned ? esc(b.text) : `${b.value}/${b.goal} · ${esc(b.text)}`}</small>
      </div>`).join('')}</div>`,
  });
}

// ---------- Ansicht: Einstellungen ----------

let pushBusy = false;

function pushSettings() {
  if (!state.sync) return '';
  const support = pushSupport();
  const p = state.push;
  let body;
  if (support === 'ios-install') {
    body = '<p class="hint">Auf dem iPhone gehen Benachrichtigungen nur, wenn Wanda auf dem Home-Bildschirm liegt: in Safari auf <b>Teilen → „Zum Home-Bildschirm“</b>, dann Wanda von dort öffnen und hier einschalten.</p>';
  } else if (support === 'unsupported') {
    body = '<p class="hint">Dieser Browser kann leider keine Benachrichtigungen. Auf Android am besten Chrome verwenden.</p>';
  } else if (support === 'denied') {
    body = '<p class="hint">Benachrichtigungen sind für Wanda blockiert. Erlauben kannst du sie in den Handy-Einstellungen (bei Android: lange auf das Wanda-Symbol drücken → App-Info → Benachrichtigungen).</p>';
  } else if (!p) {
    body = `
      <p class="hint">Wanda meldet sich, wenn dir jemand eine Aufgabe schickt, wenn deine zugeschickte Aufgabe erledigt ist und am Vorabend der Müllabfuhr – auch wenn die App zu ist.</p>
      <button class="btn" data-action="enable-push" ${pushBusy ? 'disabled' : ''}>${pushBusy ? 'Einen Moment …' : '🔔 Benachrichtigungen einschalten'}</button>`;
  } else {
    const hours = Array.from({ length: 15 }, (_, i) => i + 7);
    body = `
      <p class="push-on">✅ Eingeschaltet für ${who(state.currentMember)}</p>
      <ul class="push-list">
        <li>📨 Neue und erledigte zugeschickte Aufgaben</li>
        <li><label><input type="checkbox" id="push-waste" ${p.waste ? 'checked' : ''}> 🗑️ Müll-Erinnerung um 18 Uhr am Vorabend</label></li>
        <li><label>☀️ Tägliche Erinnerung an die Wanda-Stunde
          <select id="push-hour">
            <option value="" ${p.remindHour == null ? 'selected' : ''}>aus</option>
            ${hours.map((h) => `<option value="${h}" ${p.remindHour === h ? 'selected' : ''}>um ${h} Uhr</option>`).join('')}
          </select></label>
          <small>kommt nur, wenn du an dem Tag noch nichts erledigt hast</small></li>
      </ul>
      <div class="row wrap">
        <button class="btn ghost" data-action="test-push">Test senden</button>
        <button class="btn danger" data-action="disable-push">Ausschalten</button>
      </div>`;
  }
  return section({ icon: '🔔', title: 'Benachrichtigungen', meta: 'gilt für dieses Handy', body });
}

let wasteMessage = '';

function wasteSettings() {
  const w = state.waste;
  const msg = wasteMessage ? `<p class="import-msg">${esc(wasteMessage)}</p>` : '';
  const upload = (label, cls) => `<label class="btn ${cls}" for="waste-import">${label}</label>`;
  if (!w) {
    return section({
      icon: '🗑️', title: 'Abfallkalender',
      meta: 'Wanda erinnert am Vorabend ans Rausstellen – mit Punkten und zum Zuschicken.',
      body: `
        ${msg}
        ${upload('📅 Datei laden', '')}
        <p class="hint"><b>Aus dem Schichtplaner:</b> dort unter Einstellungen → „Sicherung“ eine Sicherungsdatei erstellen und hier laden. Wanda übernimmt daraus nur die Abfalltermine.</p>
        <p class="hint"><b>Oder</b> die Kalenderdatei (.ics) von der Webseite eurer Stadt bzw. eures Entsorgers.${state.sync ? ' Einmal laden reicht – die ganze Familie sieht den Kalender.' : ''}</p>`,
    });
  }
  const next = nextPickups(w, today(), 8);
  return section({
    icon: '🗑️', title: 'Abfallkalender', meta: `${esc(w.name)} · ${w.events.length} Termine`,
    body: `
      ${msg}
      <ul class="pickups">${next.map((e) => `<li><span>${wasteIcon(e.t)}</span><span>${esc(e.t)}</span><small>${e.d === today() ? 'heute' : e.d === addDays(today(), 1) ? 'morgen' : shortDate(e.d)}</small></li>`).join('') || '<li><span>ℹ️</span><span>Keine kommenden Termine – bitte neue Datei laden.</span></li>'}</ul>
      <div class="row wrap">
        ${upload('Neue Datei laden', 'ghost')}
        <button class="btn danger" data-action="remove-waste">Entfernen</button>
      </div>`,
  });
}

function viewSettings() {
  const membersEdit = state.members.map((m) => `
    <div class="row">
      <select data-member-emoji="${esc(m.id)}" aria-label="Symbol">${MEMBER_EMOJIS.map((e) => `<option ${e === m.emoji ? 'selected' : ''}>${e}</option>`).join('')}</select>
      <input type="text" maxlength="40" value="${esc(m.name)}" data-member-name="${esc(m.id)}" aria-label="Name">
      ${state.members.length > 1 ? `<button class="icon-btn" data-remove-member="${esc(m.id)}" aria-label="Entfernen">✕</button>` : ''}
    </div>`).join('');

  const roomsEdit = ROOMS.filter((r) => r.id !== 'alltag').map((r) => `
    <div class="room-edit">
      <div class="row"><span class="row-emoji">${r.emoji}</span>
        <input type="text" maxlength="40" value="${esc(roomName(state, r.id))}" data-room-name="${r.id}" aria-label="Raumname"></div>
      <div class="owner-line">${ownerChips(r.id)}</div>
      <div class="owner-line">${isPaused(state, r.id)
        ? `<button class="btn ghost small" data-pause-room="${r.id}" data-pause="off">▶️ Wieder aktivieren</button> <small class="paused-note">⏸️ pausiert seit ${shortDate(state.pausedRooms[r.id])}</small>`
        : `<button class="btn ghost small" data-pause-room="${r.id}" data-pause="on">⏸️ Pausieren</button>`}</div>
    </div>`).join('');

  const effortOpts = (sel) => Object.entries(EFFORT_LABELS).map(([v, l]) => `<option value="${v}" ${+v === sel ? 'selected' : ''}>${l}</option>`).join('');
  const roomOpts = (sel) => ROOMS.map((r) => `<option value="${r.id}" ${r.id === sel ? 'selected' : ''}>${r.emoji} ${esc(roomName(state, r.id))}</option>`).join('');

  const tasksEdit = ROOMS.map((r) => {
    const list = state.tasks.filter((t) => t.room === r.id);
    return `
      <details class="task-group">
        <summary>${r.emoji} ${esc(roomName(state, r.id))} <small>(${list.length})</small></summary>
        ${list.map((t) => `
          <div class="task-edit">
            <input type="text" maxlength="120" value="${esc(t.name)}" data-task-name="${esc(t.id)}" aria-label="Aufgabe">
            <div class="row">
              <label>alle <input type="number" min="1" max="365" value="${t.interval}" data-task-interval="${esc(t.id)}"> Tage</label>
              <select data-task-effort="${esc(t.id)}" aria-label="Unbeliebtheit">${effortOpts(t.effort)}</select>
              ${t.id === HUNDE_CHECK ? '' : `<button class="icon-btn" data-remove-task="${esc(t.id)}" aria-label="Löschen">🗑</button>`}
            </div>
          </div>`).join('')}
      </details>`;
  }).join('');

  if (!canManage()) {
    return `
    ${section({
      icon: '🔒', title: 'Familien-Einstellungen',
      meta: 'Personen, Aufgaben, Räume, Familienziel und Abfallkalender können nur Eltern ändern.',
      body: `<p class="hint">Wenn du etwas ändern möchtest, sag ${namesOf(state.members.filter((m) => m.role === 'parent').map((m) => m.id)) || 'deinen Eltern'} Bescheid. 😉</p>`,
    })}
    ${pushSettings()}
    ${section({
      icon: '💾', title: 'Sicherung', meta: 'Eine Kopie der Familiendaten herunterladen.',
      body: '<button class="btn ghost" data-action="export">Sicherung herunterladen</button>',
    })}
    <p class="hint center">Wisch-Wanda · ${esc(me().emoji)} ${esc(me().name)}</p>`;
  }

  return `
    ${section({ icon: '👨‍👩‍👧‍👦', title: 'Familie', body: `${membersEdit}<button class="btn ghost" data-action="add-member">+ Person hinzufügen</button>` })}
    ${section({
      icon: '🎁', title: 'Familienziel',
      body: `
        <div class="row"><input type="text" maxlength="80" value="${esc(state.goal.title)}" data-goal="title" aria-label="Belohnung"></div>
        <div class="row"><label>bei <input type="number" min="50" step="50" value="${state.goal.points}" data-goal="points"> Punkten</label></div>
        <label class="check-line"><input type="checkbox" data-goal="loserPays" ${state.goal.loserPays !== false ? 'checked' : ''}> 🍕 Wer am wenigsten beiträgt, spendiert die Belohnung</label>
        <button class="btn ghost" data-action="new-goal">Ziel neu starten (Punkte ab heute zählen)</button>`,
    })}
    ${section({ icon: '🏠', title: 'Räume', meta: 'Name und wem der Raum gehört. 🔒 Private Räume sind nicht in der gemeinsamen Runde – nur die Besitzerin bekommt sie angezeigt. ⏸️ Pausierte Räume (z. B. bei Renovierung) tauchen nirgends auf.', body: roomsEdit })}
    ${section({
      icon: '📋', title: 'Aufgaben & Intervalle', meta: 'Unbeliebtheit bestimmt die Punkte: Kleinigkeit 5 … Endgegner 50',
      body: `${tasksEdit}
        <div class="task-new">
          <h3>Neue Aufgabe</h3>
          <input type="text" maxlength="120" placeholder="z. B. Heizkörper abwischen" id="new-task-name">
          <div class="row">
            <select id="new-task-room">${roomOpts('flur')}</select>
          </div>
          <div class="row">
            <label>alle <input type="number" min="1" max="365" value="30" id="new-task-interval"> Tage</label>
            <select id="new-task-effort">${effortOpts(2)}</select>
          </div>
          <button class="btn" data-action="add-task">Hinzufügen</button>
        </div>`,
    })}
    ${pushSettings()}
    ${wasteSettings()}
    ${section({
      icon: '💾', title: 'Sicherung',
      meta: state.sync ? 'Eure Daten liegen sicher in der Familien-Cloud. Zusätzlich kannst du eine Kopie herunterladen.' : 'Die Daten liegen bisher nur auf diesem Gerät.',
      body: `
        <div class="row wrap">
          <button class="btn ghost" data-action="export">Sicherung herunterladen</button>
          ${state.sync ? '' : '<label class="btn ghost" for="import">Sicherung laden</label>'}
        </div>
        ${state.sync ? '' : '<button class="btn danger" data-action="reset">Alles zurücksetzen</button>'}`,
    })}
    <p class="hint center">Wisch-Wanda · Version ${APP_VERSION}</p>`;
}

// ---------- Timer für die Raum-Runde ----------

function roundPlan() {
  const plan = planFor(state, today());
  return (isQuick() ? quickPlan(plan) : plan).rounds;
}

function startTimer(index = 0) {
  const minutes = isQuick() ? ROUND_MINUTES.quick : ROUND_MINUTES.normal;
  timer = { index, endAt: Date.now() + minutes * 60000, remaining: minutes * 60000, paused: false, finished: false };
  requestWakeLock();
  renderOverlay();
}

let wakeLock = null;
async function requestWakeLock() {
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
  } catch {
    wakeLock = null;
  }
}

function stopTimer() {
  timer = null;
  wakeLock?.release?.();
  wakeLock = null;
  renderOverlay();
  render();
}

function timeLeft() {
  if (!timer) return 0;
  return timer.paused ? timer.remaining : Math.max(0, timer.endAt - Date.now());
}

const clockText = (left) => `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`;

function renderTimer() {
  const rounds = roundPlan();
  const r = rounds[timer.index];
  if (!r) {
    timer = null;
    return renderOverlay();
  }
  const last = timer.index === rounds.length - 1;
  $overlay.innerHTML = `
    <div class="timer ${timer.finished ? 'finished' : ''}">
      <button class="icon-btn close" data-action="stop-round" aria-label="Runde beenden">✕</button>
      <p class="timer-step">Raum ${timer.index + 1} von ${rounds.length}</p>
      <h2>${roomEmoji(r.room)} ${esc(roomName(state, r.room))}</h2>
      <p class="clock" id="clock">${clockText(timeLeft())}</p>
      <p class="timer-hint">${timer.finished ? (last ? 'Geschafft! Letzter Raum erledigt. 🎉' : 'Zeit um – ab in den nächsten Raum!') : 'Nicht perfekt, nur sichtbar besser.'}</p>
      <div class="timer-tasks">${r.tasks.length ? r.tasks.map((id) => taskRow(id)).join('') : '<p class="hint">Oberflächen frei, Dinge wegräumen, lüften.</p>'}</div>
      <div class="timer-actions">
        ${timer.finished ? '' : `<button class="btn ghost" data-action="pause">${timer.paused ? '▶ Weiter' : '⏸ Pause'}</button>
        <button class="btn ghost" data-action="plus">+1 Min</button>`}
        <button class="btn" data-action="${last ? 'stop-round' : 'next-room'}">${last ? 'Runde beenden' : 'Nächster Raum ›'}</button>
      </div>
    </div>`;
}

setInterval(() => {
  if (!timer || timer.paused || timer.finished) return;
  const left = timeLeft();
  if (left <= 0) {
    timer.finished = true;
    beep();
    renderOverlay();
    return;
  }
  const clock = document.getElementById('clock');
  if (clock) clock.textContent = clockText(left);
}, 250);

// ---------- Overlays ----------

function renderOnboarding() {
  $overlay.innerHTML = `
    <form class="onboarding" id="onboarding">
      <img src="icons/wanda.svg" alt="" class="wanda-big">
      <h1>Hallo, ich bin Wanda!</h1>
      <p>Ich helfe euch, den Haushalt in kleinen Häppchen zu schaffen: eine Stunde am Tag, ein paar Minuten pro Raum, und jede Woche ein Raum gründlich.</p>
      ${sync.syncConfigured() ? '<button type="button" class="btn ghost" data-action="open-join">📨 Ich wurde eingeladen – mit Code beitreten</button>' : ''}
      <h3>Wer wohnt bei euch?</h3>
      <p class="hint">Die erste Person bist du. Leere Felder werden ignoriert.</p>
      ${[0, 1, 2, 3, 4].map((i) => `
        <div class="row">
          <select name="emoji${i}">${MEMBER_EMOJIS.map((e, j) => `<option ${j === i ? 'selected' : ''}>${e}</option>`).join('')}</select>
          <input type="text" maxlength="40" name="name${i}" placeholder="${i === 0 ? 'Dein Name' : 'Name'}" value="${i === 0 ? 'Mama' : ''}">
        </div>`).join('')}
      <button class="btn big" type="submit">Los geht's! 🧽</button>
    </form>`;
}

function renderSendSheet() {
  const others = state.members.filter((m) => m.id !== me().id);
  const to = sheet.to || others[0]?.id;
  const groups = ROOMS.map((r) => `
    <optgroup label="${r.emoji} ${esc(roomName(state, r.id))}">
      ${state.tasks.filter((t) => t.room === r.id).map((t) => `<option value="${esc(t.id)}" ${t.id === sheet.taskId ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
    </optgroup>`).join('');
  $overlay.innerHTML = `
    <form class="sheet" id="send-form">
      <button type="button" class="icon-btn close" data-action="close-sheet" aria-label="Schließen">✕</button>
      <h2>📨 Aufgabe zuschicken</h2>
      <h3>An wen?</h3>
      <div class="who">${others.map((m) => `
        <label class="who-btn"><input type="radio" name="to" value="${esc(m.id)}" ${m.id === to ? 'checked' : ''}>${m.emoji}<span>${esc(m.name)}</span></label>`).join('')}
      </div>
      <h3>Was?</h3>
      <select name="task">
        <option value="" ${sheet.taskId ? '' : 'selected'}>✏️ Eigene Aufgabe …</option>
        ${groups}
      </select>
      <div class="custom">
        <input type="text" name="title" maxlength="120" value="${esc(sheet.title || '')}" placeholder="z. B. Einkaufen gehen, Zimmer aufräumen">
        <label class="row">Wie unbeliebt? <select name="effort">${Object.entries(EFFORT_LABELS).map(([v, l]) => `<option value="${v}" ${v === String(sheet.effort || 2) ? 'selected' : ''}>${l} (+${POINTS[v]})</option>`).join('')}</select></label>
      </div>
      <h3>Bis wann? <small>(optional)</small></h3>
      <div class="row wrap due-chips">
        ${[['', 'Ohne'], [today(), 'Heute'], [addDays(today(), 1), 'Morgen'], [addDays(mondayOf(today()), 6), 'Sonntag']]
          .map(([v, l]) => `<label><input type="radio" name="due" value="${v}" ${v === (sheet.due || '') ? 'checked' : ''}><span>${l}</span></label>`).join('')}
      </div>
      <h3>Nachricht <small>(optional)</small></h3>
      <input type="text" name="note" maxlength="300" placeholder="z. B. Oma kommt am Samstag 😉">
      ${state.photosEnabled && state.sync ? '<label class="check-line"><input type="checkbox" name="photo"> 📷 Foto als Beweis verlangen</label>' : ''}
      <button class="btn big" type="submit">Zuschicken</button>
    </form>`;
}

function renderJoinSheet() {
  const hasData = state.onboarded && (state.history.length > 0 || state.assignments.length > 0);
  $overlay.innerHTML = `
    <form class="sheet" id="join-form">
      <button type="button" class="icon-btn close" data-action="close-sheet" aria-label="Schließen">✕</button>
      <img src="icons/wanda.svg" alt="" class="wanda-big">
      <h2>${sheet.code ? 'Du wurdest eingeladen! 🎉' : 'Familie beitreten'}</h2>
      <p>Gib den Einladungscode ein, den du bekommen hast.</p>
      <input type="text" name="code" value="${esc(formatCode(sheet.code || ''))}" placeholder="ABCD-EFGH" autocomplete="off" autocapitalize="characters" maxlength="12" class="code-input" required>
      ${hasData ? '<p class="hint warn">⚠️ Die bisherigen Daten auf diesem Handy werden durch die Familiendaten ersetzt.</p>' : ''}
      <button class="btn big" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Einen Moment …' : 'Beitreten'}</button>
    </form>`;
}

function renderCreateSheet() {
  $overlay.innerHTML = `
    <form class="sheet" id="create-form">
      <button type="button" class="icon-btn close" data-action="close-sheet" aria-label="Schließen">✕</button>
      <h2>☁️ Familie gründen</h2>
      <p>Deine bisherigen Aufgaben, Personen und Punkte werden in die Familien-Cloud übertragen. Danach bekommst du einen Einladungscode für die anderen.</p>
      <h3>Wie heißt eure Familie?</h3>
      <input type="text" name="name" maxlength="80" value="${esc(sheet.name || 'Unsere Familie')}" required>
      <button class="btn big" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Wird eingerichtet …' : 'Familie gründen'}</button>
    </form>`;
}

function renderInviteSheet() {
  $overlay.innerHTML = `
    <div class="sheet center">
      <img src="icons/wanda.svg" alt="" class="wanda-big">
      <h2>Eure Familie ist startklar! 🎉</h2>
      <p>Schick den anderen diesen Code oder teile direkt den Link:</p>
      <div class="invite big"><b>${formatCode(state.sync.inviteCode)}</b></div>
      <button class="btn big" data-action="share-invite">📤 Einladung teilen</button>
      <button class="btn ghost" data-action="close-sheet">Fertig</button>
    </div>`;
}

let pickCode = null; // Person, für die ein Code eingegeben werden muss

async function pickMember(id, code = null) {
  busy = true;
  renderOverlay();
  try {
    await sync.claimMember(id, code);
    state.currentMember = id;
    pickCode = null;
    save(state);
    pushFollowMember();
    toast(`Hallo ${member(id).name}! ${member(id).emoji}`);
  } catch (e) {
    if (e.code === 'WW002') pickCode = id;
    else if (e.code === 'WW001') toast('Der Code stimmt nicht oder ist abgelaufen.', 4000);
    else toast(e.network ? 'Keine Verbindung – bitte noch mal versuchen.' : `Das hat nicht geklappt: ${e.message}`, 4000);
  }
  busy = false;
  renderOverlay();
  render();
}

function renderCodeSheet() {
  const m = member(sheet.member);
  $overlay.innerHTML = `
    <div class="sheet center">
      <span class="big-emoji">${m?.emoji ?? '📱'}</span>
      <h2>Einrichtungs-Code für ${esc(m?.name ?? '')}</h2>
      <p>Auf dem neuen Handy mit dem Familien-Code beitreten, bei „Wer bist du?“ <b>${esc(m?.name ?? '')}</b> antippen und diesen Code eingeben:</p>
      <div class="invite big"><b>${esc(sheet.code)}</b></div>
      <p class="hint">Gilt 24 Stunden und nur ein Mal.</p>
      <button class="btn big" data-action="close-sheet">Fertig</button>
    </div>`;
}

function renderPicker() {
  $overlay.innerHTML = `
    <form class="sheet" id="picker-form">
      <img src="icons/wanda.svg" alt="" class="wanda-big">
      <h2>Willkommen bei ${esc(state.sync?.name || 'der Familie')}!</h2>
      <h3>Wer bist du?</h3>
      <p class="hint">Wähle dich selbst – das gilt dann fest für dieses Handy.</p>
      ${pickCode ? `
        <div class="code-box">
          <p><b>${esc(member(pickCode)?.name ?? '')}</b> ist schon auf einem anderen Handy angemeldet${member(pickCode)?.role === 'parent' ? ' oder ist Eltern' : ''}. Gib den Einrichtungs-Code ein, den Mama oder Papa unter Familie → 🔑 Code bekommen:</p>
          <input type="text" name="member-code" maxlength="8" autocomplete="off" autocapitalize="characters" class="code-input" placeholder="ABC123">
          <button class="btn" type="button" data-action="claim-with-code" ${busy ? 'disabled' : ''}>${busy ? 'Einen Moment …' : 'Weiter'}</button>
        </div>` : ''}
      <div class="who">${state.members.map((m) => `
        <button type="button" class="who-btn" data-pick="${esc(m.id)}">${m.emoji}<span>${esc(m.name)}</span></button>`).join('')}
      </div>
      <h3>Nicht dabei?</h3>
      <div class="row">
        <select name="emoji">${MEMBER_EMOJIS.map((e, i) => `<option ${i === 2 ? 'selected' : ''}>${e}</option>`).join('')}</select>
        <input type="text" name="name" maxlength="40" placeholder="Dein Name">
      </div>
      <button class="btn" type="submit">Mich hinzufügen</button>
    </form>`;
}

function needsPicker() {
  return state.onboarded && state.sync && !member(state.currentMember) && state.members.length > 0;
}

function renderOverlay() {
  let fn = null;
  if (sheet?.type === 'join') fn = renderJoinSheet;
  else if (!state.onboarded) fn = renderOnboarding;
  else if (needsPicker()) fn = renderPicker;
  else if (timer) fn = renderTimer;
  else if (sheet) fn = { send: renderSendSheet, create: renderCreateSheet, invite: renderInviteSheet, code: renderCodeSheet, photo: renderPhotoSheet }[sheet.type];
  $overlay.hidden = !fn;
  if (fn) fn();
  else $overlay.innerHTML = '';
}

function openSheet(s) {
  sheet = s;
  renderOverlay();
  $overlay.scrollTop = 0;
}

function closeSheet() {
  sheet = null;
  busy = false;
  renderOverlay();
}

// ---------- Rendern ----------

function render() {
  if (state.onboarded) {
    const views = { heute: viewToday, raeume: viewRooms, familie: viewFamily, einstellungen: viewSettings };
    $app.innerHTML = views[tab]();
  }
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.getElementById('me-btn').textContent = me().emoji;
  updateSyncDot();
}

function updateSyncDot() {
  const dot = document.getElementById('sync-dot');
  const s = state.sync ? sync.getStatus() : 'local';
  dot.className = `sync-dot ${s}`;
  dot.hidden = s === 'local';
  dot.title = STATUS_TEXT[s] || '';
}

// Während jemand tippt, nicht neu zeichnen (sonst springt der Cursor weg).
let renderPending = false;
function isEditing() {
  const el = document.activeElement;
  return el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && el.type !== 'checkbox' && el.type !== 'radio';
}
function softRender() {
  if (isEditing()) {
    renderPending = true;
    return;
  }
  render();
  if (timer) renderTimer();
}
document.addEventListener('focusout', () => setTimeout(() => {
  if (renderPending && !isEditing()) {
    renderPending = false;
    softRender();
  }
}, 50));

// ---------- Sync anbinden ----------

let remoteTimer = null;
function onSyncChange(ev) {
  if (ev.type === 'remote') notifyRemote(ev);
  if (ev.type === 'reload') {
    cleanupClaims(state, today());
    if (canManage()) upgradeAlltag(state, today());
  }
  if (ev.type === 'need-pick') renderOverlay();
  if (ev.type === 'rejected' && ev.kind === 'completion') {
    toast('✋ Das ging nicht – die Aufgabe hat jemand anderes übernommen oder erledigt.', 4000);
  }
  if (ev.type === 'rejected' && ev.kind === 'waste') {
    toast('🗑️ Der Abfallkalender ist erst auf diesem Handy. Für die ganze Familie bitte den Datenbank-Nachtrag aus SUPABASE.md ausführen.', 7000);
  }
  if (ev.type === 'disconnected') toast('Die Familie gibt es nicht mehr – Wanda läuft wieder nur auf diesem Handy.', 4000);
  clearTimeout(remoteTimer);
  remoteTimer = setTimeout(() => {
    if (needsPicker() && !sheet) renderOverlay();
    softRender();
  }, 120);
}

function notifyRemote({ kind, eventType, value, previous }) {
  const myId = me().id;
  if (kind === 'assignment' && value) {
    const title = assignmentTitle(state, value);
    if (eventType === 'INSERT' && value.to === myId && value.from !== myId) {
      toast(`📨 ${member(value.from)?.name ?? 'Jemand'} hat dir „${title}“ geschickt`, 4000);
      navigator.vibrate?.([80, 60, 80]);
    } else if (value.doneAt && !previous?.doneAt && value.from === myId && value.doneBy !== myId) {
      toast(`✅ ${member(value.doneBy)?.name ?? 'Jemand'} hat „${title}“ erledigt!`, 4000);
    }
  } else if (kind === 'completion' && eventType === 'INSERT' && value && value.member !== myId && !previous && value.date === today()) {
    const name = task(value.taskId)?.name ?? value.title ?? 'eine Aufgabe';
    toast(`⭐ ${member(value.member)?.name ?? 'Jemand'}: „${name}“ erledigt (+${value.points})`);
  }
}

setPusher((ops) => sync.enqueue(ops));

async function share() {
  const code = state.sync.inviteCode;
  const url = `${location.origin}${location.pathname}#join=${code}`;
  const text = `Komm in unsere Wisch-Wanda-Familie! 🧽 Öffne den Link und tippe auf „Beitreten“. Code: ${formatCode(code)}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Wisch-Wanda', text, url });
      return;
    }
  } catch (e) {
    if (e?.name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast('Einladung kopiert – jetzt z. B. in WhatsApp einfügen.');
  } catch {
    prompt('Diesen Link verschicken:', url);
  }
}

// Wer gerade „ich“ ist, bekommt die Benachrichtigungen auf diesem Handy.
function pushFollowMember() {
  if (!state.push || !state.sync) return;
  updatePush(me().id, state.push).catch((e) => console.warn('Wisch-Wanda: Push-Person nicht aktualisiert', e));
}

function joinCodeFromUrl() {
  const m = location.hash.match(/join=([A-Za-z0-9-]+)/);
  return m ? m[1].replace(/-/g, '').toUpperCase() : null;
}

function clearJoinHash() {
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
}

// ---------- Zurück-Knopf (Android) ----------
// Für jede offene Ebene (Fenster/Timer, aufgeklappter Raum, anderer Reiter) plus einmal für die
// Startseite liegt ein Verlaufs-Eintrag bereit. „Zurück“ schließt eine Ebene; auf der Startseite
// kommt der Hinweis, und das nächste „Zurück“ beendet die App.
// Einträge entstehen nur direkt nach einem Antippen – sonst überspringt Chrome sie beim Zurückgehen.

let skipPop = false;
const backDepth = () => history.state?.wanda ?? 0;

function backLayers() {
  if (!$overlay.hidden && !timer && !(sheet && sheet.type !== 'join')) return 0; // Einrichtung/„Wer bist du?“
  return (timer || (sheet && sheet.type !== 'join') ? 1 : 0) + (openRoom && tab === 'raeume' ? 1 : 0) + (tab !== 'heute' ? 1 : 0);
}

function syncBack() {
  const want = backLayers() + 1;
  let d = backDepth();
  if (d > want) {
    skipPop = true;
    history.go(want - d);
    return;
  }
  while (d < want) history.pushState({ wanda: ++d }, '');
}

function goBack() {
  if (timer) {
    if (confirm('Runde beenden?')) stopTimer();
    return true;
  }
  if (sheet && sheet.type !== 'join') {
    closeSheet();
    return true;
  }
  if (!$overlay.hidden) return false;
  if (openRoom && tab === 'raeume') {
    openRoom = null;
    render();
    return true;
  }
  if (tab !== 'heute') {
    tab = 'heute';
    render();
    window.scrollTo(0, 0);
    return true;
  }
  return false;
}

window.addEventListener('popstate', () => {
  if (skipPop) {
    skipPop = false;
    return;
  }
  if (!goBack()) toast('Nochmal „Zurück“ zum Beenden', 2500);
});
// Nach jedem Antippen (die App hat dann schon reagiert) die Einträge passend machen.
document.addEventListener('click', () => setTimeout(syncBack, 0));

// ---------- Ereignisse ----------

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-task],[data-assign],[data-waste],[data-pause-room],[data-owner-room],[data-parent-pick],[data-photo],[data-view-photo],[data-member-code],[data-claim],[data-claim-waste],[data-send-waste],[data-send],[data-unassign],[data-pick],[data-action],[data-tab],[data-room],[data-member],[data-remove-member],[data-remove-task]');
  if (!el || el.matches('input')) return;
  const d = el.dataset;
  if (d.task) return complete(d.task, ev);
  if (d.assign) return completeAssignment(d.assign, ev);
  if (d.waste) return completeWaste(d.waste, ev);
  if (d.pauseRoom) {
    const on = d.pause === 'on';
    const name = roomName(state, d.pauseRoom);
    if (on && !confirm(`${name} pausieren? Der Raum taucht dann nirgends mehr auf, bis du ihn wieder aktivierst.`)) return;
    setRoomPaused(state, d.pauseRoom, on);
    toast(on ? `⏸️ ${name} ist pausiert.` : `▶️ ${name} ist wieder dabei – die Aufgaben starten frisch.`, 3500);
    return render();
  }
  if (d.ownerRoom) {
    toggleRoomOwner(state, d.ownerRoom, d.owner);
    return render();
  }
  if (d.claim || d.claimWaste) {
    let item;
    let points;
    if (d.claim) {
      item = { taskId: d.claim };
      points = pointsFor(task(d.claim));
    } else {
      const e = state.waste?.events.find((x) => `${x.d}|${x.t}` === d.claimWaste);
      if (!e) return;
      item = { title: `${e.t} rausstellen` };
      points = WASTE_POINTS;
    }
    const result = toggleClaim(state, item, today(), me().id, points);
    if (result === 'claimed') toast('🙋 Übernommen – die anderen sehen, dass du das machst.');
    else if (result === 'taken') toast('Das hat schon jemand anderes übernommen.');
    navigator.vibrate?.(20);
    return render();
  }
  if (d.sendWaste) {
    const e = state.waste?.events.find((x) => `${x.d}|${x.t}` === d.sendWaste);
    if (e) return openSheet({ type: 'send', title: `${e.t} rausstellen`, due: today(), effort: 2 });
    return;
  }
  if (d.send) return openSheet({ type: 'send', taskId: d.send });
  if (d.unassign) {
    const a = state.assignments.find((x) => x.id === d.unassign);
    if (!a || !confirm(`„${assignmentTitle(state, a)}“ für ${member(a.to)?.name ?? 'diese Person'} zurückziehen?`)) return;
    deleteAssignment(state, a.id);
    return render();
  }
  if (d.pick) {
    if (busy) return;
    if (!state.sync) {
      state.currentMember = d.pick;
      save(state);
      renderOverlay();
      return render();
    }
    return pickMember(d.pick);
  }
  if (d.photo) return takePhoto(d.photo);
  if (d.viewPhoto) {
    const a = state.assignments.find((x) => x.id === d.viewPhoto);
    if (!a?.photoPath) return;
    openSheet({ type: 'photo', id: a.id });
    sync.photoUrl(a.photoPath)
      .then((url) => { if (sheet?.id === a.id) { sheet.url = url; renderOverlay(); } })
      .catch((e) => { if (sheet?.id === a.id) { sheet.error = `Foto konnte nicht geladen werden: ${e.message}`; renderOverlay(); } });
    return;
  }
  if (d.parentPick) {
    parentPick = parentPick.includes(d.parentPick) ? parentPick.filter((x) => x !== d.parentPick) : [...parentPick, d.parentPick];
    return render();
  }
  if (d.memberCode) {
    return sync.createMemberCode(d.memberCode)
      .then((code) => openSheet({ type: 'code', member: d.memberCode, code }))
      .catch((e) => toast(`Code konnte nicht erstellt werden: ${e.message}`, 4000));
  }
  if (d.tab) {
    tab = d.tab;
    if (tab === 'familie' && rightsOn()) {
      sync.loadDevices().then((dv) => {
        devices = dv;
        if (tab === 'familie' && !isEditing()) render();
      }).catch(() => {});
    }
    render();
    window.scrollTo(0, 0);
    return;
  }
  if (d.room) {
    openRoom = openRoom === d.room ? null : d.room;
    return render();
  }
  if (d.member) {
    if (state.sync) return; // mit Familien-Verbindung steht fest, wem das Handy gehört
    state.currentMember = d.member;
    save(state);
    pushFollowMember();
    toast(`Hallo ${member(d.member).name}! ${member(d.member).emoji}`);
    return render();
  }
  if (d.removeMember) {
    const m = member(d.removeMember);
    if (!confirm(`${m.name} entfernen? Bisherige Punkte bleiben in der Liste, aber ohne Namen.`)) return;
    removeMember(state, d.removeMember);
    if (state.currentMember === d.removeMember) state.currentMember = state.members[0].id;
    save(state);
    return render();
  }
  if (d.removeTask) {
    const t = task(d.removeTask);
    if (!confirm(`„${t.name}“ löschen?`)) return;
    removeTask(state, d.removeTask);
    return render();
  }
  switch (d.action) {
    case 'me':
      tab = 'familie';
      return render();
    case 'start-round':
      return startTimer(0);
    case 'next-room':
      return startTimer(timer.index + 1);
    case 'stop-round':
      return stopTimer();
    case 'pause':
      if (timer.paused) {
        timer.endAt = Date.now() + timer.remaining;
        timer.paused = false;
      } else {
        timer.remaining = timeLeft();
        timer.paused = true;
      }
      return renderTimer();
    case 'plus':
      if (timer.paused) timer.remaining += 60000;
      else timer.endAt += 60000;
      return renderTimer();
    case 'open-send':
      return openSheet({ type: 'send' });
    case 'open-join':
      return openSheet({ type: 'join' });
    case 'open-create':
      return openSheet({ type: 'create' });
    case 'close-sheet':
      clearJoinHash();
      return closeSheet();
    case 'share-invite':
      return share();
    case 'leave':
      if (!confirm('Dieses Handy von der Familie abmelden? Die Familie und ihre Daten bleiben erhalten – du kannst jederzeit mit dem Code wieder beitreten.')) return;
      return (state.push ? disablePush(state.push.endpoint).catch(() => {}) : Promise.resolve()).then(() => {
        state.push = null;
        return sync.leaveFamily();
      }).then(() => {
        toast('Abgemeldet. Wanda läuft jetzt nur auf diesem Handy.');
        render();
      });
    case 'add-member': {
      const n = state.members.length + 1;
      saveMember(state, { id: newId(), name: `Person ${n}`, emoji: MEMBER_EMOJIS[n % MEMBER_EMOJIS.length] });
      return render();
    }
    case 'new-goal':
      state.goal = { ...state.goal, since: today(), reachedAt: null };
      saveSettings(state);
      toast('Neues Ziel gestartet – auf geht\'s!');
      return render();
    case 'add-task': {
      const name = document.getElementById('new-task-name').value.trim();
      if (!name) return toast('Bitte einen Namen eingeben.');
      const room = document.getElementById('new-task-room').value;
      let id = `${room}-${slug(name)}`;
      while (task(id)) id += '-x';
      saveTask(state, {
        id, room, name,
        interval: Math.max(1, Math.min(365, +document.getElementById('new-task-interval').value || 30)),
        effort: +document.getElementById('new-task-effort').value || 2,
        lastDone: null,
      });
      toast('Aufgabe hinzugefügt – Wanda plant sie ab morgen ein.');
      return render();
    }
    case 'export': {
      const blob = new Blob([JSON.stringify({ ...state, outbox: [] }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `wisch-wanda-sicherung-${today()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      return;
    }
    case 'enable-push':
      if (pushBusy) return;
      pushBusy = true;
      render();
      return enablePush(me().id, { waste: true, remindHour: null })
        .then((p) => {
          state.push = p;
          save(state);
          toast('🔔 Benachrichtigungen sind an!');
        })
        .catch((e) => toast(e.code === 'service'
          ? 'Der Push-Dienst ist noch nicht eingerichtet – siehe SUPABASE.md, Abschnitt „Push-Benachrichtigungen“.'
          : e.code === 'denied' ? 'Ohne Erlaubnis kann Wanda keine Benachrichtigungen schicken.' : `Das hat nicht geklappt: ${e.message}`, 6000))
        .finally(() => {
          pushBusy = false;
          render();
        });
    case 'disable-push':
      return disablePush(state.push?.endpoint).finally(() => {
        state.push = null;
        save(state);
        toast('Benachrichtigungen sind aus.');
        render();
      });
    case 'test-push':
      return testPush(state.push.endpoint)
        .then(() => toast('Test unterwegs – gleich sollte eine Benachrichtigung kommen. 📬', 4000))
        .catch((e) => toast(`Test hat nicht geklappt: ${e.message}`, 5000));
    case 'owners-done': {
      const open = (ownerPromptRooms || []).filter((id) => isPrivateRoom(state, id) && !roomOwners(state, id).length);
      if (open.length) return toast(`Bitte noch ${open.map((id) => roomName(state, id)).join(', ')} zuordnen – oder „gemeinsam“ antippen.`, 4000);
      ownerPromptRooms = null;
      toast('🔒 Gespeichert – die Raum-Runde enthält jetzt nur gemeinsame Räume.');
      return render();
    }
    case 'claim-with-code': {
      const code = String(document.querySelector('[name="member-code"]')?.value || '').trim();
      if (!code) return toast('Bitte den Code eingeben.');
      return pickMember(pickCode, code);
    }
    case 'save-parents':
      if (!parentPick?.length) return toast('Bitte mindestens eine Person als Eltern wählen.');
      return sync.setParents(parentPick)
        .then(() => {
          parentPick = null;
          toast('👑 Eltern festgelegt – Familien-Einstellungen können jetzt nur noch Eltern ändern.', 4000);
          render();
        })
        .catch((e) => toast(`Das hat nicht geklappt: ${e.message}`, 4000));
    case 'show-all-due':
      showAllDue = true;
      return render();
    case 'remove-waste':
      if (!confirm(`Abfallkalender „${state.waste.name}“ entfernen?`)) return;
      setWaste(state, null);
      return render();
    case 'reset':
      if (!confirm('Wirklich alles zurücksetzen? Punkte, Verlauf und eigene Aufgaben gehen verloren.')) return;
      state = freshState();
      save(state);
      tab = 'heute';
      renderOverlay();
      return render();
  }
});

document.addEventListener('change', (ev) => {
  const el = ev.target;
  const d = el.dataset;
  if (d.action === 'quick') {
    if (el.checked) state.quickDays[today()] = true;
    else delete state.quickDays[today()];
    save(state);
    return render();
  }
  if (d.memberName) {
    const m = member(d.memberName);
    m.name = el.value.trim() || 'Ohne Name';
    saveMember(state, m);
  } else if (d.memberEmoji) {
    const m = member(d.memberEmoji);
    m.emoji = el.value;
    saveMember(state, m);
    document.getElementById('me-btn').textContent = me().emoji;
  } else if (d.roomName) {
    const def = ROOMS.find((r) => r.id === d.roomName).name;
    const v = el.value.trim();
    if (v && v !== def) state.roomNames[d.roomName] = v;
    else delete state.roomNames[d.roomName];
    saveSettings(state);
  } else if (d.taskName || d.taskInterval || d.taskEffort) {
    const t = task(d.taskName || d.taskInterval || d.taskEffort);
    if (d.taskName) t.name = el.value.trim() || t.name;
    if (d.taskInterval) t.interval = Math.max(1, Math.min(365, +el.value || 1));
    if (d.taskEffort) t.effort = +el.value;
    saveTask(state, t);
  } else if (d.goal) {
    if (d.goal === 'title') state.goal.title = el.value.trim() || 'Familienbelohnung';
    else if (d.goal === 'loserPays') state.goal.loserPays = el.checked;
    else state.goal.points = Math.max(50, +el.value || 1000);
    saveSettings(state);
  } else if (el.id === 'push-waste' || el.id === 'push-hour') {
    const settings = { ...state.push };
    if (el.id === 'push-waste') settings.waste = el.checked;
    else settings.remindHour = el.value === '' ? null : +el.value;
    updatePush(me().id, settings)
      .then((p) => {
        state.push = p;
        save(state);
        toast('Gespeichert ✓');
      })
      .catch((e) => toast(`Konnte nicht gespeichert werden: ${e.message}`, 5000));
  } else if (el.id === 'import') {
    importBackup(el.files[0]);
    el.value = '';
  } else if (el.id === 'photo-input') {
    handlePhoto(el.files[0]);
    el.value = '';
  } else if (el.id === 'waste-import') {
    importWasteFile(el.files[0]);
    el.value = '';
  }
});

async function importWasteFile(file) {
  if (!file) return;
  const fail = (msg) => {
    wasteMessage = `⚠️ ${msg}`;
    render();
    toast(msg, 6000);
  };
  try {
    const text = await file.text();
    let w;
    if (text.trimStart().startsWith('{')) {
      w = importFromSchichtplaner(JSON.parse(text), today());
      if (!w) return fail('In dieser Sicherung ist kein Abfallkalender enthalten.');
    } else if (!/BEGIN:VCALENDAR|BEGIN:VEVENT/i.test(text)) {
      return fail(`„${file.name}“ ist keine Kalenderdatei. Gesucht ist eine Datei mit der Endung .ics (oft „iCal“ oder „Kalender exportieren“ genannt).`);
    } else {
      w = importWaste(text, file.name, today());
      const info = w.events.info;
      if (!info?.found) return fail(`In „${file.name}“ stehen keine Termine.`);
      if (!w.events.some((e) => e.d >= today())) {
        return fail(`Die Termine in der Datei liegen alle in der Vergangenheit (letzter: ${info.last ? shortDate(info.last) + info.last.slice(0, 4) : '?'}). Vielleicht gibt es schon den Kalender fürs neue Jahr?`);
      }
    }
    setWaste(state, w);
    const n = w.events.filter((e) => e.d >= today()).length;
    wasteMessage = `✅ ${n} Abholtermine geladen${state.sync ? ' – die Familie sieht sie auch' : ''}.`;
    toast(`🗑️ ${n} Abholtermine aus „${w.name}“ geladen`, 5000);
    render();
  } catch (e) {
    console.warn(e);
    fail(`„${file.name}“ konnte nicht gelesen werden.`);
  }
}

async function importBackup(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.tasks) || !Array.isArray(data.members)) throw new Error('Format');
    state = migrate({ ...freshState(), ...data, sync: null, outbox: [] });
    save(state);
    toast('Sicherung geladen ✓');
    render();
  } catch {
    toast('Diese Datei ist keine Wisch-Wanda-Sicherung.');
  }
}

document.addEventListener('submit', async (ev) => {
  const form = ev.target;
  ev.preventDefault();
  const f = new FormData(form);

  if (form.id === 'onboarding') {
    const members = [0, 1, 2, 3, 4]
      .map((i) => ({ id: `m${i + 1}`, name: String(f.get(`name${i}`) || '').trim(), emoji: f.get(`emoji${i}`) }))
      .filter((m) => m.name);
    if (!members.length) members.push({ id: 'm1', name: 'Ich', emoji: '👩' });
    state.members = members;
    state.currentMember = members[0].id;
    state.onboarded = true;
    save(state);
    renderOverlay();
    return render();
  }

  if (form.id === 'send-form') {
    const to = f.get('to');
    const taskId = f.get('task');
    const title = String(f.get('title') || '').trim();
    if (!to) return toast('Bitte auswählen, an wen.');
    if (!taskId && !title) return toast('Bitte eine Aufgabe auswählen oder eintragen.');
    const a = addAssignment(state, {
      to, from: me().id,
      taskId: taskId || null,
      title: taskId ? null : title,
      points: taskId ? pointsFor(task(taskId)) : POINTS[f.get('effort')] ?? 10,
      due: f.get('due') || null,
      note: String(f.get('note') || '').trim(),
      ...(f.get('photo') ? { photo: true } : {}),
    });
    toast(`📨 „${assignmentTitle(state, a)}“ an ${member(to).name} geschickt`);
    closeSheet();
    return render();
  }

  if (form.id === 'picker-form') {
    const name = String(f.get('name') || '').trim();
    if (!name) return toast('Bitte deinen Namen eingeben.');
    const m = { id: newId(), name, emoji: f.get('emoji') };
    saveMember(state, m);
    await sync.flush(); // erst anlegen, dann das Handy daran binden
    return pickMember(m.id);
  }

  if (form.id === 'join-form' || form.id === 'create-form') {
    if (busy) return;
    busy = true;
    const isJoin = form.id === 'join-form';
    if (isJoin) sheet.code = String(f.get('code') || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    else sheet.name = String(f.get('name') || '').trim();
    renderOverlay();
    try {
      if (isJoin) {
        if (state.push) {
          await disablePush(state.push.endpoint).catch(() => {});
          state.push = null;
        }
        await sync.joinFamily(sheet.code);
        state.onboarded = true;
        state.currentMember = null; // „Wer bist du?“ fragen
        save(state);
        clearJoinHash();
        tab = 'heute';
        busy = false;
        sheet = null;
        toast(`Willkommen bei ${state.sync.name}! 🎉`);
      } else {
        await sync.createFamily(sheet.name);
        busy = false;
        sheet = { type: 'invite' };
      }
    } catch (e) {
      busy = false;
      const msg = e?.code === 'P0002'
        ? 'Diesen Code gibt es nicht – bitte noch mal prüfen.'
        : e?.network || !navigator.onLine
          ? 'Keine Verbindung – bitte Internet prüfen und noch mal versuchen.'
          : `Das hat nicht geklappt: ${e?.message || e}`;
      toast(msg, 4000);
    }
    renderOverlay();
    return render();
  }
});

// ---------- Start ----------

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (timer && !wakeLock) requestWakeLock();
    sync.resume();
    softRender();
  }
});
window.addEventListener('online', () => sync.resume());
setInterval(() => {
  if (state.sync && state.outbox.length) sync.flush();
}, 30000);

// Mitternacht überstehen: wenn die App über Nacht offen bleibt, neu zeichnen.
let lastDay = today();
setInterval(() => {
  if (today() !== lastDay) {
    lastDay = today();
    cleanupClaims(state, today());
    if (!timer) softRender();
  }
}, 60000);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  // Neue Version veröffentlicht? Dann einmal neu laden – aber nicht beim allerersten Start
  // und nicht mitten in einer Eingabe oder Raum-Runde.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    const reload = () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    };
    if (!timer && !sheet && !isEditing()) reload();
    else document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && !timer && reload());
  });
  // Beim Zurückkehren in die App nach einer neuen Version schauen
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') navigator.serviceWorker.getRegistration().then((r) => r?.update()).catch(() => {});
  });
}

const inviteCode = joinCodeFromUrl();
if (inviteCode && sync.syncConfigured()) {
  if (state.sync?.inviteCode === inviteCode) clearJoinHash();
  else sheet = { type: 'join', code: inviteCode };
}

cleanupClaims(state, today());

sync.start({
  getState: () => state,
  onChange: onSyncChange,
  onStatus: () => {
    updateSyncDot();
    if (tab === 'familie' && !isEditing()) render();
  },
});

renderOverlay();
render();
