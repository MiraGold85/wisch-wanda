// Abfallkalender: .ics-Datei einlesen (wie im Schichtplaner) und daraus
// die Tonnen ableiten, die heute Abend bzw. heute früh raus müssen.
import { addDays, dayNum, keyFromDayNum } from './planner.js';

const ICS_DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
export const WASTE_POINTS = 10;

export function wasteIcon(title) {
  const t = title.toLowerCase();
  if (/rest/.test(t)) return '⚫';
  if (/bio/.test(t)) return '🟤';
  if (/gelb|wertstoff|verpack/.test(t)) return '🟡';
  if (/papier|pappe|blau/.test(t)) return '🔵';
  if (/glas/.test(t)) return '🟢';
  if (/sperr/.test(t)) return '🛋️';
  if (/schadstoff|problem/.test(t)) return '☣️';
  if (/grün|baum|strauch|weihnacht/.test(t)) return '🌲';
  return '🗑️';
}

const icsUnescape = (v) => v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();

function parseICSDate(v) {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})\d{2}(Z)?)?/);
  if (!m) return null;
  if (m[4] && m[6]) {
    // UTC → lokales Datum
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export function parseICS(text) {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const events = [];
  let cur = null;
  let calName = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = { ex: [] }; continue; }
    if (line === 'END:VEVENT') { if (cur?.start) events.push(cur); cur = null; continue; }
    const i = line.indexOf(':');
    if (i < 0) continue;
    const name = line.slice(0, i).split(';')[0];
    const value = line.slice(i + 1);
    if (!cur) { if (name === 'X-WR-CALNAME') calName = icsUnescape(value); continue; }
    if (name === 'SUMMARY') cur.title = icsUnescape(value);
    else if (name === 'DTSTART') cur.start = parseICSDate(value);
    else if (name === 'RRULE') cur.rrule = Object.fromEntries(value.split(';').map((x) => x.split('=')));
    else if (name === 'EXDATE') value.split(',').forEach((v) => cur.ex.push(parseICSDate(v)));
  }
  return { calName, events };
}

const isoWeekday = (key) => ((dayNum(key) + 3) % 7) + 1; // 1 = Montag

// Einzeltermine und einfache Wiederholungen (täglich/wöchentlich/monatlich/jährlich)
export function expandEvent(ev, from, to) {
  const start = ev.start;
  const r = ev.rrule;
  if (!r) return start >= from && start <= to ? [start] : [];
  const interval = Number(r.INTERVAL || 1);
  const until = r.UNTIL ? parseICSDate(r.UNTIL) : to;
  const max = r.COUNT ? Number(r.COUNT) : 2000;
  const end = until < to ? until : to;
  const out = [];
  let n = 0;
  const push = (d) => {
    n++;
    if (d >= from && d <= end && !ev.ex.includes(d)) out.push(d);
  };
  if (r.FREQ === 'WEEKLY' && r.BYDAY) {
    const days = r.BYDAY.split(',').map((x) => ICS_DAYS.indexOf(x.slice(-2)) + 1).filter((x) => x > 0).sort();
    let weekStart = addDays(start, 1 - isoWeekday(start));
    while (weekStart <= end && n < max) {
      for (const wd of days) {
        const d = addDays(weekStart, wd - 1);
        if (d < start || d > end || n >= max) continue;
        push(d);
      }
      weekStart = addDays(weekStart, 7 * interval);
    }
    return out;
  }
  const [sy, sm, sd] = start.split('-').map(Number);
  for (let k = 0; n < max; k++) {
    let d;
    if (r.FREQ === 'DAILY') d = addDays(start, k * interval);
    else if (r.FREQ === 'WEEKLY') d = addDays(start, 7 * k * interval);
    else if (r.FREQ === 'MONTHLY' || r.FREQ === 'YEARLY') {
      const months = (r.FREQ === 'MONTHLY' ? 1 : 12) * k * interval;
      const x = new Date(Date.UTC(sy, sm - 1 + months, sd));
      if (x.getUTCDate() !== sd) continue; // z. B. 31. im kurzen Monat
      d = keyFromDayNum(Math.round(x.getTime() / 86400000));
    } else break;
    if (d > end) break;
    push(d);
  }
  return out;
}

// Liest die Datei und behält die Abholtermine der nächsten zwei Jahre.
export function importWaste(text, fileName, todayKey) {
  const { calName, events } = parseICS(text);
  const from = addDays(todayKey, -7);
  const to = addDays(todayKey, 730);
  const out = [];
  const seen = new Set();
  for (const ev of events) {
    const t = (ev.title || 'Abfuhr').slice(0, 60);
    for (const d of expandEvent(ev, from, to)) {
      if (seen.has(`${d}|${t}`)) continue;
      seen.add(`${d}|${t}`);
      out.push({ d, t });
    }
  }
  out.sort((a, b) => a.d.localeCompare(b.d) || a.t.localeCompare(b.t));
  const name = (calName || fileName.replace(/\.ics$/i, '') || 'Abfallkalender').slice(0, 60);
  return { name, events: out };
}

// Liest die Datensicherung des Schichtplaners und übernimmt nur die
// importierten Abfallkalender – Schichten usw. bleiben außen vor.
export function importFromSchichtplaner(data, todayKey) {
  const from = addDays(todayKey, -7);
  const imports = (Array.isArray(data?.imports) ? data.imports : []).filter((imp) => Array.isArray(imp.events));
  const isWaste = (imp) => imp.events.filter((e) => wasteIcon(String(e.t || '')) !== '🗑️').length >= imp.events.length / 2;
  const chosen = imports.filter(isWaste);
  if (!chosen.length) return null;
  const seen = new Set();
  const events = [];
  for (const imp of chosen) {
    for (const e of imp.events) {
      const t = String(e.t || 'Abfuhr').slice(0, 60);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(e.d) || e.d < from || seen.has(`${e.d}|${t}`)) continue;
      seen.add(`${e.d}|${t}`);
      events.push({ d: e.d, t });
    }
  }
  events.sort((a, b) => a.d.localeCompare(b.d) || a.t.localeCompare(b.t));
  return { name: chosen.map((imp) => imp.name).join(' + ').slice(0, 60) || 'Abfallkalender', events };
}

export const pickupsOn = (waste, key) => (waste?.events || []).filter((e) => e.d === key);

export function nextPickups(waste, todayKey, count = 6) {
  return (waste?.events || []).filter((e) => e.d >= todayKey).slice(0, count);
}

export const wasteTaskTitle = (e) => `${e.t} rausstellen`;

// Tonnen, die jetzt dran sind: am Vortag (abends rausstellen) und am Abholtag selbst.
export function wasteDue(waste, todayKey) {
  const tomorrow = addDays(todayKey, 1);
  return (waste?.events || [])
    .filter((e) => e.d === todayKey || e.d === tomorrow)
    .map((e) => ({ ...e, icon: wasteIcon(e.t), title: wasteTaskTitle(e), today: e.d === todayKey }));
}

// Erledigt, wenn am Vortag oder Abholtag jemand die Tonne rausgestellt hat.
export function wasteDone(history, e) {
  const prev = addDays(e.d, -1);
  return history.find((h) => !h.taskId && h.title === wasteTaskTitle(e) && (h.date === e.d || h.date === prev));
}
