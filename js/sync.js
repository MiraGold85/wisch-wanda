// Familien-Sync über Supabase. Lokale Änderungen landen als Ops in einer
// Warteschlange (state.outbox) und werden der Reihe nach hochgeladen –
// so geht offline nichts verloren. Änderungen der anderen kommen live
// über Realtime herein; beim Zurückkehren in die App wird alles neu geladen.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { save, migrate } from './store.js';
import { addDays, dateKey } from './planner.js';

export const syncConfigured = () => Boolean(SUPABASE_URL && SUPABASE_KEY);

// Lokale Felder ↔ Tabellenspalten
const SPECS = {
  member: {
    table: 'members', list: 'members',
    toRow: (m) => ({ id: m.id, name: m.name, emoji: m.emoji }),
    fromRow: (r) => ({ id: r.id, name: r.name, emoji: r.emoji }),
  },
  task: {
    table: 'tasks', list: 'tasks',
    toRow: (t) => ({ id: t.id, room: t.room, name: t.name, interval: t.interval, effort: t.effort, last_done: t.lastDone }),
    fromRow: (r) => ({ id: r.id, room: r.room, name: r.name, interval: r.interval, effort: r.effort, lastDone: r.last_done }),
  },
  completion: {
    table: 'completions', list: 'history',
    toRow: (h) => ({
      id: h.id, task_id: h.taskId ?? null, title: h.title ?? null, date: h.date,
      member_id: h.member ?? null, points: h.points, assignment_id: h.assignmentId ?? null,
    }),
    fromRow: (r) => {
      const h = { id: r.id, taskId: r.task_id, date: r.date, member: r.member_id, points: r.points };
      if (r.title) h.title = r.title;
      if (r.assignment_id) h.assignmentId = r.assignment_id;
      return h;
    },
  },
  assignment: {
    table: 'assignments', list: 'assignments',
    toRow: (a) => ({
      id: a.id, task_id: a.taskId ?? null, title: a.title ?? null, points: a.points ?? 10,
      to_member: a.to, from_member: a.from ?? null, due_date: a.due || null, note: a.note || null,
      created_at: a.createdAt, done_at: a.doneAt || null, done_by: a.doneBy || null, completion_id: a.completionId || null,
    }),
    fromRow: (r) => ({
      id: r.id, taskId: r.task_id, title: r.title, points: r.points, to: r.to_member, from: r.from_member,
      due: r.due_date, note: r.note || '', createdAt: r.created_at, doneAt: r.done_at, doneBy: r.done_by,
      completionId: r.completion_id,
    }),
  },
  plan: {
    table: 'plans', key: 'date',
    toRow: (p) => ({ date: p.date, plan: p }),
    fromRow: (r) => r.plan,
  },
};

let ctx = null; // { getState, onChange(event), onStatus(status) }
let client = null;
let channel = null;
let flushing = false;
let live = false;
let status = 'local';
let reloadTimer = null;

const st = () => ctx.getState();
const hid = () => st().sync?.householdId;

function setStatus(s) {
  if (s === 'ok' && st().outbox.length) s = 'pending';
  if (s !== status) {
    status = s;
    ctx?.onStatus?.(s);
  }
}
export const getStatus = () => status;

async function getClient() {
  if (!client) {
    const { createClient } = await import('./vendor/supabase.js');
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'wisch-wanda-auth' },
    });
  }
  return client;
}

async function ensureSession() {
  const c = await getClient();
  const { data } = await c.auth.getSession();
  if (data.session) return data.session;
  const res = await c.auth.signInAnonymously();
  if (res.error) throw res.error;
  return res.data.session;
}

// Netzwerkfehler haben keinen Datenbank-Fehlercode.
const isNetwork = (error) => !error.code || error.status === 0;

function fail(error) {
  const e = new Error(error.message || 'Fehler');
  e.code = error.code;
  e.network = isNetwork(error);
  return e;
}

// ---------- Hochladen ----------

function rows(op) {
  const spec = SPECS[op.kind];
  const list = Array.isArray(op.value) ? op.value : [op.value];
  return list.map((v) => ({ household_id: hid(), ...spec.toRow(v) }));
}

async function run(op) {
  const c = await getClient();
  if (op.kind === 'household') {
    return c.from('households').update({ room_names: op.value.roomNames, goal: op.value.goal }).eq('id', hid());
  }
  const spec = SPECS[op.kind];
  const key = spec.key || 'id';
  if (op.op === 'delete') return c.from(spec.table).delete().eq('household_id', hid()).eq(key, op.value);
  return c.from(spec.table).upsert(rows(op), {
    onConflict: `household_id,${key}`,
    ignoreDuplicates: op.op === 'insertIgnore',
  });
}

export function enqueue(ops) {
  const s = st();
  if (!s.sync) return;
  s.outbox.push(...ops);
  save(s);
  setStatus('pending');
  flush();
}

export async function flush() {
  if (flushing || !hid()) return;
  flushing = true;
  let needReload = false;
  try {
    await ensureSession();
    while (st().outbox.length && hid()) {
      const op = st().outbox[0];
      const { error } = await run(op);
      if (error && isNetwork(error)) {
        setStatus('offline');
        return;
      }
      if (error) {
        // z. B. dieselbe Aufgabe hat am selben Tag schon jemand anderes erledigt
        console.warn('Wisch-Wanda: Änderung verworfen', op, error);
        needReload = true;
      } else if (op.kind === 'plan' && op.op === 'insertIgnore') {
        await adoptServerPlan(op.value.date);
      }
      st().outbox.shift();
      save(st());
    }
    setStatus(live ? 'ok' : 'pending');
    if (needReload) await reload();
  } catch (e) {
    console.warn('Wisch-Wanda: Sync unterbrochen', e);
    setStatus('offline');
  } finally {
    flushing = false;
    if (st().outbox.length && status !== 'offline') setTimeout(flush, 500);
  }
}

// Haben zwei Handys gleichzeitig den Tagesplan erstellt, gilt der erste.
async function adoptServerPlan(date) {
  const c = await getClient();
  const { data } = await c.from('plans').select('plan').eq('household_id', hid()).eq('date', date).maybeSingle();
  if (data && JSON.stringify(data.plan) !== JSON.stringify(st().plans[date])) {
    st().plans[date] = data.plan;
    save(st());
    ctx.onChange({ type: 'reload' });
  }
}

// ---------- Laden ----------

async function fetchAll(table, build) {
  const c = await getClient();
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(c.from(table).select('*').eq('household_id', hid())).range(from, from + 999);
    if (error) throw fail(error);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

export async function reload() {
  if (!hid()) return;
  const c = await getClient();
  const since = addDays(dateKey(), -14);
  const [hh, members, tasks, completions, assignments, plans] = await Promise.all([
    c.from('households').select('*').eq('id', hid()).maybeSingle(),
    fetchAll('members', (q) => q.order('created_at').order('id')),
    fetchAll('tasks', (q) => q.order('id')),
    fetchAll('completions', (q) => q.order('date').order('created_at')),
    fetchAll('assignments', (q) => q.order('created_at')),
    fetchAll('plans', (q) => q.gte('date', since)),
  ]);
  if (hh.error) throw fail(hh.error);
  if (!hh.data) throw Object.assign(new Error('Familie nicht gefunden'), { code: 'gone' });
  const s = st();
  // Was noch in der Warteschlange liegt, bleibt lokal sichtbar.
  const pending = s.outbox;
  s.sync.name = hh.data.name;
  if (Object.keys(hh.data.room_names || {}).length || hh.data.goal?.title) {
    s.roomNames = hh.data.room_names || {};
    if (hh.data.goal?.title) s.goal = hh.data.goal;
  }
  s.members = members.map(SPECS.member.fromRow);
  s.tasks = tasks.map(SPECS.task.fromRow);
  s.history = completions.map(SPECS.completion.fromRow);
  s.assignments = assignments.map(SPECS.assignment.fromRow);
  s.plans = Object.fromEntries(plans.map((r) => [r.date, r.plan]));
  for (const op of pending) applyLocal(op);
  save(s);
  ctx.onChange({ type: 'reload' });
}

// Noch nicht hochgeladene eigene Änderungen nach dem Neuladen wieder anwenden.
function applyLocal(op) {
  const s = st();
  if (op.kind === 'household') return;
  if (op.kind === 'plan') {
    if (!s.plans[op.value.date]) s.plans[op.value.date] = op.value;
    return;
  }
  const list = s[SPECS[op.kind].list];
  if (op.op === 'delete') {
    s[SPECS[op.kind].list] = list.filter((x) => x.id !== op.value);
    return;
  }
  for (const v of Array.isArray(op.value) ? op.value : [op.value]) {
    const i = list.findIndex((x) => x.id === v.id);
    if (i >= 0) list[i] = v;
    else list.push(v);
  }
}

// ---------- Live-Änderungen ----------

function onRemote(kind, payload) {
  const s = st();
  if (kind === 'household') {
    const r = payload.new;
    s.roomNames = r.room_names || {};
    if (r.goal?.title) s.goal = r.goal;
    s.sync.name = r.name;
    save(s);
    return ctx.onChange({ type: 'remote', kind });
  }
  const spec = SPECS[kind];
  if (payload.eventType === 'DELETE') {
    const old = payload.old || {};
    if (old.household_id && old.household_id !== hid()) return;
    if (kind === 'plan') delete s.plans[old.date];
    else s[spec.list] = s[spec.list].filter((x) => x.id !== old.id);
    save(s);
    return ctx.onChange({ type: 'remote', kind, eventType: 'DELETE' });
  }
  const row = payload.new;
  if (!row || row.household_id !== hid()) return;
  const value = spec.fromRow(row);
  let previous = null;
  if (kind === 'plan') {
    s.plans[value.date] = value;
  } else {
    const list = s[spec.list];
    const i = list.findIndex((x) => x.id === value.id);
    if (i >= 0) {
      previous = { ...list[i] };
      list[i] = value;
    } else list.push(value);
  }
  save(s);
  ctx.onChange({ type: 'remote', kind, eventType: payload.eventType, value, previous });
}

async function subscribe() {
  const c = await getClient();
  if (channel) await c.removeChannel(channel);
  const id = hid();
  channel = c.channel(`familie-${id}`);
  for (const kind of Object.keys(SPECS)) {
    const table = SPECS[kind].table;
    channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table, filter: `household_id=eq.${id}` }, (p) => onRemote(kind, p));
    channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table, filter: `household_id=eq.${id}` }, (p) => onRemote(kind, p));
    // Löschungen lassen sich nicht filtern; fremde werden in onRemote verworfen.
    channel.on('postgres_changes', { event: 'DELETE', schema: 'public', table }, (p) => onRemote(kind, p));
  }
  channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'households', filter: `id=eq.${id}` }, (p) => onRemote('household', p));
  let wasConnected = false;
  channel.subscribe((s) => {
    live = s === 'SUBSCRIBED';
    // Nach einem Verbindungsabbruch könnte etwas verpasst worden sein.
    if (live && wasConnected) scheduleReload();
    if (live) wasConnected = true;
    setStatus(live ? 'ok' : st().outbox.length ? 'pending' : 'offline');
  });
}

function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => reload().catch(handleStartError), 300);
}

async function unsubscribe() {
  if (channel && client) await client.removeChannel(channel);
  channel = null;
  live = false;
}

// ---------- Verbinden ----------

function handleStartError(e) {
  console.warn('Wisch-Wanda: Sync-Start fehlgeschlagen', e);
  setStatus('offline');
}

// Beim App-Start: Mitgliedschaft sicherstellen (auch wenn das Handy die
// Anmeldung verloren hat), alles laden, live schalten, Warteschlange leeren.
export async function start(context) {
  ctx = context;
  if (!syncConfigured() || !hid()) return setStatus('local');
  try {
    await ensureSession();
    const c = await getClient();
    const { error } = await c.rpc('join_household', { p_code: st().sync.inviteCode });
    if (error?.code === 'P0002') {
      // Familie wurde gelöscht – lokal weitermachen.
      st().sync = null;
      st().outbox = [];
      save(st());
      ctx.onChange({ type: 'disconnected' });
      return setStatus('local');
    }
    if (error) throw fail(error);
    await flush();
    await reload();
    await subscribe();
  } catch (e) {
    handleStartError(e);
  }
}

export function resume() {
  if (!hid()) return;
  flush().then(() => reload()).catch(handleStartError);
  if (!live) subscribe().catch(handleStartError);
}

export async function createFamily(name) {
  await ensureSession();
  const c = await getClient();
  const { data, error } = await c.rpc('create_household', { p_name: name });
  if (error) throw fail(error);
  const s = st();
  s.sync = { householdId: data.id, inviteCode: data.invite_code, name: data.name };
  // Alles Bisherige hochladen.
  const today = dateKey();
  s.outbox = [
    { kind: 'household', op: 'update', value: { roomNames: s.roomNames, goal: s.goal } },
    { kind: 'member', op: 'upsert', value: s.members },
    { kind: 'task', op: 'upsert', value: s.tasks },
    ...(s.history.length ? [{ kind: 'completion', op: 'upsert', value: dedupeCompletions(s.history) }] : []),
    ...(s.assignments.length ? [{ kind: 'assignment', op: 'upsert', value: s.assignments }] : []),
    ...(s.plans[today] ? [{ kind: 'plan', op: 'insertIgnore', value: s.plans[today] }] : []),
  ];
  save(s);
  await flush();
  if (st().outbox.length) throw new Error('Hochladen unvollständig – bitte Internetverbindung prüfen.');
  await subscribe();
  return s.sync;
}

// Doppelte Erledigungen am selben Tag würden die Datenbankregel verletzen.
function dedupeCompletions(history) {
  const seen = new Set();
  return history.filter((h) => {
    if (!h.taskId) return true;
    const k = `${h.taskId}|${h.date}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function joinFamily(code) {
  await ensureSession();
  const c = await getClient();
  const { data, error } = await c.rpc('join_household', { p_code: code });
  if (error) throw fail(error);
  const s = st();
  s.sync = { householdId: data.id, inviteCode: data.invite_code, name: data.name };
  s.outbox = [];
  save(s);
  await reload();
  await subscribe();
  return s.sync;
}

export async function leaveFamily() {
  const s = st();
  try {
    const session = await ensureSession();
    const c = await getClient();
    await unsubscribe();
    await c.from('household_users').delete().eq('household_id', hid()).eq('user_id', session.user.id);
  } catch (e) {
    console.warn('Wisch-Wanda: Abmelden vom Server fehlgeschlagen', e);
  }
  s.sync = null;
  s.outbox = [];
  migrate(s);
  save(s);
  setStatus('local');
}

// Für Tests: Realtime-Ereignis simulieren.
export const _onRemote = onRemote;
