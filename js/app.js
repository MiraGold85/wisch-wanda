import {
  ROOMS, EFFORT_LABELS, HUNDE_CHECK, dateKey, addDays, dueRatio, daysUntilDue, pointsFor,
  roomStatus, quickPlan, planTaskIds, computeStreak, levelFor, slug, MAX_JOKERS,
} from './planner.js';
import {
  load, save, freshState, roomName, roomEmoji, planFor, doneEntry, toggleTask, memberPoints, familyPoints,
} from './store.js';

let state = load();
let tab = 'heute';
let openRoom = null;
let timer = null; // { index, endAt, remaining, paused, finished }

const $app = document.getElementById('app');
const $overlay = document.getElementById('overlay');
const $toast = document.getElementById('toast');

const MEMBER_EMOJIS = ['👩', '👨', '👧', '👦', '🧑', '👵', '👴', '🐶', '🦄', '🐱', '🌻', '⚡'];
const ROUND_MINUTES = { normal: 7, quick: 5 };

// ---------- Hilfen ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const today = () => dateKey();
const me = () => state.members.find((m) => m.id === state.currentMember) || state.members[0];
const member = (id) => state.members.find((m) => m.id === id);
const task = (id) => state.tasks.find((t) => t.id === id);
const isQuick = () => !!state.quickDays[today()];
const pick = (list) => list[Math.floor(Math.random() * list.length)];

function mondayOf(key) {
  // Montag der aktuellen Woche.
  const d = new Date(`${key}T12:00:00`);
  const offset = (d.getDay() + 6) % 7;
  return addDays(key, -offset);
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

function toast(text) {
  $toast.textContent = text;
  $toast.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => $toast.classList.remove('show'), 2200);
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

// ---------- Aufgaben abhaken ----------

function complete(taskId, ev) {
  const t = task(taskId);
  if (!t) return;
  const entry = toggleTask(state, taskId, today(), me().id, pointsFor(t));
  if (entry) {
    const big = t.effort >= 4;
    const rect = ev?.target?.closest('[data-task]')?.getBoundingClientRect();
    if (rect) burst(rect.left + 28, rect.top + rect.height / 2, big);
    toast(`+${entry.points} Punkte · ${big ? pick(BIG_CHEERS) : pick(CHEERS)}`);
    navigator.vibrate?.(30);
    checkGoal();
  }
  render();
  if (timer) renderTimer();
}

function checkGoal() {
  const g = state.goal;
  if (!g || g.reachedAt) return;
  if (familyPoints(state, g.since) >= g.points) {
    g.reachedAt = today();
    save(state);
    setTimeout(() => {
      burst(window.innerWidth / 2, window.innerHeight / 2, true);
      toast(`🎉 Familienziel erreicht: ${g.title}!`);
    }, 500);
  }
}

// ---------- Bausteine ----------

function taskRow(id, opts = {}) {
  const t = task(id);
  if (!t) return '';
  const done = doneEntry(state, id, today());
  const who = done && member(done.member);
  const sub = [];
  if (opts.showRoom) sub.push(`${roomEmoji(t.room)} ${esc(roomName(state, t.room))}`);
  if (done && who) sub.push(`erledigt von ${who.emoji} ${esc(who.name)}`);
  else if (opts.showDue) sub.push(dueText(t));
  return `
    <button class="task ${done ? 'done' : ''} effort-${t.effort}" data-task="${esc(id)}">
      <span class="check" aria-hidden="true">${done ? '✓' : ''}</span>
      <span class="task-body">
        <span class="task-name">${esc(t.name)}</span>
        ${sub.length ? `<span class="task-sub">${sub.join(' · ')}</span>` : ''}
      </span>
      <span class="pts" title="${EFFORT_LABELS[t.effort]}">+${pointsFor(t)}</span>
    </button>`;
}

function dueText(t) {
  const d = daysUntilDue(t, today());
  if (d < 0) return `<span class="late">${-d} ${-d === 1 ? 'Tag' : 'Tage'} überfällig</span>`;
  if (d === 0) return '<span class="late">heute fällig</span>';
  if (d === 1) return 'morgen fällig';
  return `fällig in ${d} Tagen`;
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

function viewToday() {
  const key = today();
  const full = planFor(state, key);
  const plan = isQuick() ? quickPlan(full) : full;
  const ids = planTaskIds(plan);
  const doneCount = ids.filter((id) => doneEntry(state, id, key)).length;
  const pct = ids.length ? doneCount / ids.length : 0;
  const { streak, jokers, doneToday } = computeStreak(state.history, key);
  const todayPts = memberPoints(state, me().id, key);
  const allDone = ids.length && doneCount === ids.length;
  const mins = isQuick() ? ROUND_MINUTES.quick : ROUND_MINUTES.normal;

  const line = allDone
    ? 'Alles geschafft! Feierabend – du hast es dir verdient. 🛋️'
    : doneCount
      ? `${doneCount} von ${ids.length} erledigt. Weiter so!`
      : MORNING_LINES[new Date().getDate() % MORNING_LINES.length];

  const hero = `
    <section class="hero">
      <div class="hero-text">
        <p class="hello">${greeting()}, ${esc(me().name)}!</p>
        <p class="wanda-says"><img src="icons/wanda.svg" alt="" class="wanda-mini">${line}</p>
        <div class="stats">
          <span class="chip" title="Tage am Stück">🔥 ${streak} ${streak === 1 ? 'Tag' : 'Tage'}${doneToday || !streak ? '' : ' – heute noch offen'}</span>
          <span class="chip" title="Joker retten einen verpassten Tag. Alle 7 aktiven Tage gibt es einen neuen.">🃏 ${jokers}/${MAX_JOKERS}</span>
          <span class="chip">⭐ ${todayPts} heute</span>
        </div>
      </div>
      <div class="hero-ring">${progressRing(pct)}<span>${Math.round(pct * 100)}%</span></div>
    </section>
    <label class="quick">
      <input type="checkbox" data-action="quick" ${isQuick() ? 'checked' : ''}>
      <span class="switch"></span>
      <span><b>Nur 15 Minuten heute</b><br><small>Für Tage mit wenig Energie – zählt trotzdem für die Serie.</small></span>
    </label>`;

  const cards = [];
  if (plan.alltag.length) {
    cards.push(section({
      icon: '☀️', title: 'Grundroutine', meta: 'ca. 10 Minuten · das tägliche Fundament',
      body: plan.alltag.map((id) => taskRow(id)).join(''),
    }));
  }
  if (plan.hunde.length) {
    cards.push(section({
      icon: '🐾', title: 'Terrasse & Hunde', meta: 'kurz nachsehen, bevor jemand reintritt',
      body: plan.hunde.map((id) => taskRow(id)).join(''),
    }));
  }
  if (plan.rounds.length) {
    cards.push(section({
      icon: '⏱️', title: 'Raum-Runde', meta: `${plan.rounds.length} Räume × ${mins} Minuten · nicht perfekt, nur sichtbar besser`,
      extra: '<button class="btn small" data-action="start-round">▶ Start</button>',
      body: plan.rounds.map((r) => `
        <div class="round-room">
          <h3>${roomEmoji(r.room)} ${esc(roomName(state, r.room))}</h3>
          ${r.tasks.length ? r.tasks.map((id) => taskRow(id)).join('') : '<p class="hint">Kurz durchgehen: Oberflächen frei, Dinge wegräumen, lüften.</p>'}
        </div>`).join(''),
    }));
  }
  if (plan.focus.length) {
    cards.push(section({
      icon: '🔍', title: `Fokus der Woche: ${esc(roomName(state, plan.focusRoom))}`,
      meta: 'ca. 15–20 Minuten · diese Woche wird hier gründlich geputzt',
      body: plan.focus.map((id) => taskRow(id)).join(''),
    }));
  }
  if (plan.mission) {
    cards.push(section({
      icon: '🎯', title: 'Mission des Tages', meta: 'die Ecke, die sonst immer vergessen wird', cls: 'mission',
      body: taskRow(plan.mission, { showRoom: true }),
    }));
  }
  return hero + cards.join('');
}

// ---------- Ansicht: Räume ----------

function viewRooms() {
  const key = today();
  const focus = planFor(state, key).focusRoom;
  const roomCards = ROOMS.map((r) => {
    const st = roomStatus(state.tasks, r.id, key);
    const open = openRoom === r.id;
    const tasks = state.tasks.filter((t) => t.room === r.id).sort((a, b) => dueRatio(b, key) - dueRatio(a, key));
    return `
      <section class="card room ${open ? 'open' : ''}">
        <button class="room-head" data-room="${r.id}">
          <span class="dot ${st.level}"></span>
          <span class="room-name">${r.emoji} ${esc(roomName(state, r.id))}${r.id === focus ? ' <span class="badge">Fokus</span>' : ''}</span>
          <span class="room-meta">${st.overdue ? `${st.overdue} fällig` : 'alles gut'}</span>
          <span class="chev">${open ? '▴' : '▾'}</span>
        </button>
        ${open ? `<div class="room-tasks">${tasks.map((t) => taskRow(t.id, { showDue: true })).join('')}</div>` : ''}
      </section>`;
  });
  const counts = ROOMS.map((r) => roomStatus(state.tasks, r.id, key).level);
  const green = counts.filter((c) => c === 'green').length;
  return `
    <section class="hero slim">
      <div class="hero-text">
        <p class="hello">Wie steht's ums Haus?</p>
        <p class="wanda-says"><img src="icons/wanda.svg" alt="" class="wanda-mini">${green} von ${ROOMS.length} Bereichen sind grün. Tipp auf einen Raum, um auch außer der Reihe etwas abzuhaken.</p>
      </div>
    </section>
    ${roomCards.join('')}`;
}

// ---------- Ansicht: Familie ----------

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
    return `
      <div class="member ${m.id === state.currentMember ? 'me' : ''}">
        <span class="avatar">${m.emoji}</span>
        <div class="member-body">
          <b>${esc(m.name)}</b>
          <small>${lvl.emoji} ${lvl.title}${lvl.next ? ` · noch ${lvl.toNext} bis ${lvl.next.emoji}` : ''}</small>
        </div>
        <div class="member-pts"><b>${week}</b><small>diese Woche</small></div>
      </div>`;
  });

  const recent = [...state.history].reverse().slice(0, 12).map((h) => {
    const t = task(h.taskId);
    const m = member(h.member);
    const when = h.date === key ? 'heute' : h.date === addDays(key, -1) ? 'gestern' : h.date.split('-').reverse().slice(0, 2).join('.') + '.';
    return `<li><span>${m?.emoji ?? '❔'}</span><span>${esc(t?.name ?? 'Aufgabe')} <small>${t ? esc(roomName(state, t.room)) : ''} · ${when}</small></span><b>+${h.points}</b></li>`;
  });

  return `
    ${section({
      icon: '🎁', title: 'Familienziel', meta: esc(g.title),
      body: `
        <div class="goal-bar"><span style="width:${goalPct * 100}%"></span></div>
        <p class="goal-text">${goalPts} von ${g.points} Punkten${g.reachedAt ? ' – 🎉 geschafft! Neues Ziel in den Einstellungen setzen.' : ''}</p>`,
    })}
    ${section({
      icon: '👨‍👩‍👧', title: 'Wer bist du gerade?', meta: 'Punkte werden der ausgewählten Person gutgeschrieben',
      body: `<div class="who">${state.members.map((m) => `
        <button class="who-btn ${m.id === state.currentMember ? 'active' : ''}" data-member="${m.id}">${m.emoji}<span>${esc(m.name)}</span></button>`).join('')}</div>`,
    })}
    ${section({ icon: '🏅', title: 'Punkte diese Woche', body: `<div class="members">${members.join('')}</div>` })}
    ${section({
      icon: '📜', title: 'Zuletzt erledigt',
      body: recent.length ? `<ul class="recent">${recent.join('')}</ul>` : '<p class="hint">Noch nichts erledigt – die erste Aufgabe wartet auf der Heute-Seite.</p>',
    })}
    <p class="hint center">Aufgaben zuweisen und auf allen Handys sehen kommt mit Stufe 2 (Familien-Sync).</p>`;
}

// ---------- Ansicht: Einstellungen ----------

function viewSettings() {
  const membersEdit = state.members.map((m) => `
    <div class="row">
      <select data-member-emoji="${m.id}" aria-label="Symbol">${MEMBER_EMOJIS.map((e) => `<option ${e === m.emoji ? 'selected' : ''}>${e}</option>`).join('')}</select>
      <input type="text" value="${esc(m.name)}" data-member-name="${m.id}" aria-label="Name">
      ${state.members.length > 1 ? `<button class="icon-btn" data-remove-member="${m.id}" aria-label="Entfernen">✕</button>` : ''}
    </div>`).join('');

  const roomsEdit = ROOMS.filter((r) => r.id !== 'alltag').map((r) => `
    <div class="row"><span class="row-emoji">${r.emoji}</span>
      <input type="text" value="${esc(roomName(state, r.id))}" data-room-name="${r.id}" aria-label="Raumname"></div>`).join('');

  const effortOpts = (sel) => Object.entries(EFFORT_LABELS).map(([v, l]) => `<option value="${v}" ${+v === sel ? 'selected' : ''}>${l}</option>`).join('');
  const roomOpts = (sel) => ROOMS.map((r) => `<option value="${r.id}" ${r.id === sel ? 'selected' : ''}>${r.emoji} ${esc(roomName(state, r.id))}</option>`).join('');

  const tasksEdit = ROOMS.map((r) => {
    const list = state.tasks.filter((t) => t.room === r.id);
    return `
      <details class="task-group">
        <summary>${r.emoji} ${esc(roomName(state, r.id))} <small>(${list.length})</small></summary>
        ${list.map((t) => `
          <div class="task-edit">
            <input type="text" value="${esc(t.name)}" data-task-name="${t.id}" aria-label="Aufgabe">
            <div class="row">
              <label>alle <input type="number" min="1" max="365" value="${t.interval}" data-task-interval="${t.id}"> Tage</label>
              <select data-task-effort="${t.id}" aria-label="Unbeliebtheit">${effortOpts(t.effort)}</select>
              ${t.id === HUNDE_CHECK ? '' : `<button class="icon-btn" data-remove-task="${t.id}" aria-label="Löschen">🗑</button>`}
            </div>
          </div>`).join('')}
      </details>`;
  }).join('');

  return `
    ${section({ icon: '👨‍👩‍👧‍👦', title: 'Familie', body: `${membersEdit}<button class="btn ghost" data-action="add-member">+ Person hinzufügen</button>` })}
    ${section({
      icon: '🎁', title: 'Familienziel',
      body: `
        <div class="row"><input type="text" value="${esc(state.goal.title)}" data-goal="title" aria-label="Belohnung"></div>
        <div class="row"><label>bei <input type="number" min="50" step="50" value="${state.goal.points}" data-goal="points"> Punkten</label></div>
        <button class="btn ghost" data-action="new-goal">Ziel neu starten (Punkte ab heute zählen)</button>`,
    })}
    ${section({ icon: '🏠', title: 'Räume benennen', meta: 'z. B. „Lenas Zimmer“ statt „Kinderzimmer 1“', body: roomsEdit })}
    ${section({
      icon: '📋', title: 'Aufgaben & Intervalle', meta: 'Unbeliebtheit bestimmt die Punkte: Kleinigkeit 5 … Endgegner 50',
      body: `${tasksEdit}
        <div class="task-new">
          <h3>Neue Aufgabe</h3>
          <input type="text" placeholder="z. B. Heizkörper abwischen" id="new-task-name">
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
    ${section({
      icon: '💾', title: 'Sicherung',
      meta: 'Die Daten liegen bisher nur auf diesem Gerät.',
      body: `
        <div class="row wrap">
          <button class="btn ghost" data-action="export">Sicherung herunterladen</button>
          <label class="btn ghost">Sicherung laden<input type="file" accept="application/json" id="import" hidden></label>
        </div>
        <button class="btn danger" data-action="reset">Alles zurücksetzen</button>`,
    })}
    <p class="hint center">Wisch-Wanda · Stufe 1 (Prototyp)</p>`;
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
  renderTimer();
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
  $overlay.hidden = true;
  $overlay.innerHTML = '';
  render();
}

function timeLeft() {
  if (!timer) return 0;
  return timer.paused ? timer.remaining : Math.max(0, timer.endAt - Date.now());
}

function renderTimer() {
  if (!timer) return;
  const rounds = roundPlan();
  const r = rounds[timer.index];
  if (!r) return stopTimer();
  const left = timeLeft();
  const mm = String(Math.floor(left / 60000)).padStart(1, '0');
  const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, '0');
  const last = timer.index === rounds.length - 1;
  $overlay.hidden = false;
  $overlay.innerHTML = `
    <div class="timer ${timer.finished ? 'finished' : ''}">
      <button class="icon-btn close" data-action="stop-round" aria-label="Runde beenden">✕</button>
      <p class="timer-step">Raum ${timer.index + 1} von ${rounds.length}</p>
      <h2>${roomEmoji(r.room)} ${esc(roomName(state, r.room))}</h2>
      <p class="clock" id="clock">${mm}:${ss}</p>
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
    renderTimer();
    return;
  }
  const clock = document.getElementById('clock');
  if (clock) clock.textContent = `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`;
}, 250);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (timer && !wakeLock) requestWakeLock();
    render();
  }
});

// ---------- Onboarding ----------

function renderOnboarding() {
  $overlay.hidden = false;
  $overlay.innerHTML = `
    <form class="onboarding" id="onboarding">
      <img src="icons/wanda.svg" alt="" class="wanda-big">
      <h1>Hallo, ich bin Wanda!</h1>
      <p>Ich helfe euch, den Haushalt in kleinen Häppchen zu schaffen: eine Stunde am Tag, ein paar Minuten pro Raum, und jede Woche ein Raum gründlich.</p>
      <h3>Wer wohnt bei euch?</h3>
      <p class="hint">Die erste Person bist du. Leere Felder werden ignoriert.</p>
      ${[0, 1, 2, 3, 4].map((i) => `
        <div class="row">
          <select name="emoji${i}">${MEMBER_EMOJIS.map((e, j) => `<option ${j === i ? 'selected' : ''}>${e}</option>`).join('')}</select>
          <input type="text" name="name${i}" placeholder="${i === 0 ? 'Dein Name' : 'Name'}" value="${i === 0 ? 'Mama' : ''}">
        </div>`).join('')}
      <button class="btn big" type="submit">Los geht's! 🧽</button>
    </form>`;
}

// ---------- Rendern ----------

function render() {
  if (!state.onboarded) return renderOnboarding();
  const views = { heute: viewToday, raeume: viewRooms, familie: viewFamily, einstellungen: viewSettings };
  $app.innerHTML = views[tab]();
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.getElementById('me-btn').textContent = me().emoji;
}

// ---------- Ereignisse ----------

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-task],[data-action],[data-tab],[data-room],[data-member],[data-remove-member],[data-remove-task]');
  if (!el) return;
  const d = el.dataset;
  if (d.task) return complete(d.task, ev);
  if (d.tab) {
    tab = d.tab;
    render();
    window.scrollTo(0, 0);
    return;
  }
  if (d.room) {
    openRoom = openRoom === d.room ? null : d.room;
    return render();
  }
  if (d.member) {
    state.currentMember = d.member;
    save(state);
    toast(`Hallo ${member(d.member).name}! ${member(d.member).emoji}`);
    return render();
  }
  if (d.removeMember) {
    const m = member(d.removeMember);
    if (!confirm(`${m.name} entfernen? Bisherige Punkte bleiben in der Liste, aber ohne Namen.`)) return;
    state.members = state.members.filter((x) => x.id !== d.removeMember);
    if (state.currentMember === d.removeMember) state.currentMember = state.members[0].id;
    save(state);
    return render();
  }
  if (d.removeTask) {
    const t = task(d.removeTask);
    if (!confirm(`„${t.name}“ löschen?`)) return;
    state.tasks = state.tasks.filter((x) => x.id !== d.removeTask);
    save(state);
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
    case 'add-member': {
      const n = state.members.length + 1;
      state.members.push({ id: `m${Date.now()}`, name: `Person ${n}`, emoji: MEMBER_EMOJIS[n % MEMBER_EMOJIS.length] });
      save(state);
      return render();
    }
    case 'new-goal':
      state.goal = { ...state.goal, since: today(), reachedAt: undefined };
      save(state);
      toast('Neues Ziel gestartet – auf geht\'s!');
      return render();
    case 'add-task': {
      const name = document.getElementById('new-task-name').value.trim();
      if (!name) return toast('Bitte einen Namen eingeben.');
      const room = document.getElementById('new-task-room').value;
      let id = `${room}-${slug(name)}`;
      while (task(id)) id += '-x';
      state.tasks.push({
        id, room, name,
        interval: Math.max(1, +document.getElementById('new-task-interval').value || 30),
        effort: +document.getElementById('new-task-effort').value || 2,
        lastDone: null,
      });
      save(state);
      toast('Aufgabe hinzugefügt – Wanda plant sie ab morgen ein.');
      return render();
    }
    case 'export': {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `wisch-wanda-sicherung-${today()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      return;
    }
    case 'reset':
      if (!confirm('Wirklich alles zurücksetzen? Punkte, Verlauf und eigene Aufgaben gehen verloren.')) return;
      state = freshState();
      save(state);
      tab = 'heute';
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
  if (d.memberName) member(d.memberName).name = el.value.trim() || 'Ohne Name';
  else if (d.memberEmoji) member(d.memberEmoji).emoji = el.value;
  else if (d.roomName) {
    const def = ROOMS.find((r) => r.id === d.roomName).name;
    const v = el.value.trim();
    if (v && v !== def) state.roomNames[d.roomName] = v;
    else delete state.roomNames[d.roomName];
  } else if (d.taskName) task(d.taskName).name = el.value.trim() || task(d.taskName).name;
  else if (d.taskInterval) task(d.taskInterval).interval = Math.max(1, Math.min(365, +el.value || 1));
  else if (d.taskEffort) task(d.taskEffort).effort = +el.value;
  else if (d.goal === 'title') state.goal.title = el.value.trim() || 'Familienbelohnung';
  else if (d.goal === 'points') state.goal.points = Math.max(50, +el.value || 1000);
  else if (el.id === 'import') return importBackup(el.files[0]);
  else return;
  save(state);
});

async function importBackup(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.tasks) || !Array.isArray(data.members)) throw new Error('Format');
    state = { ...freshState(), ...data };
    save(state);
    toast('Sicherung geladen ✓');
    render();
  } catch {
    toast('Diese Datei ist keine Wisch-Wanda-Sicherung.');
  }
}

document.addEventListener('submit', (ev) => {
  if (ev.target.id !== 'onboarding') return;
  ev.preventDefault();
  const f = new FormData(ev.target);
  const members = [0, 1, 2, 3, 4]
    .map((i) => ({ id: `m${i + 1}`, name: String(f.get(`name${i}`) || '').trim(), emoji: f.get(`emoji${i}`) }))
    .filter((m) => m.name);
  if (!members.length) members.push({ id: 'm1', name: 'Ich', emoji: '👩' });
  state.members = members;
  state.currentMember = members[0].id;
  state.onboarded = true;
  save(state);
  $overlay.hidden = true;
  $overlay.innerHTML = '';
  render();
});

// Mitternacht überstehen: wenn die App über Nacht offen bleibt, neu zeichnen.
let lastDay = today();
setInterval(() => {
  if (today() !== lastDay) {
    lastDay = today();
    if (!timer) render();
  }
}, 60000);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

render();
