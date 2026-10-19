// Wisch-Wanda Push-Dienst (Supabase Edge Function „wanda-push“)
//
// GET  ?vapid=1                → öffentlicher Schlüssel für die App (wird beim ersten Mal erzeugt)
// POST {type:'test', endpoint} → Test-Benachrichtigung an ein bereits angemeldetes Handy
// POST mit x-wanda-secret      → von der Datenbank: neue/erledigte Aufgabe, stündliche Erinnerungen
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const TZ = 'Europe/Berlin';
const WASTE_HOUR = 18;
const APP_URL = 'https://miragold85.github.io/wisch-wanda/';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

type Sub = { endpoint: string; household_id: string; member_id: string | null; p256dh: string; auth: string; remind_hour: number | null; waste: boolean };
type Payload = { title: string; body: string; tag?: string; url?: string };

// ---------- Einstellungen & Schlüssel ----------

let config: { secret: string; vapid_public: string | null; vapid_private: string | null } | null = null;

async function loadConfig() {
  if (config?.vapid_public) return config;
  const { data, error } = await db.rpc('wanda_push_config');
  if (error || !data) throw new Error(`Einstellungen fehlen – wurde 003_push.sql ausgeführt? ${error?.message ?? ''}`);
  config = data;
  if (!config!.vapid_public) {
    const keys = webpush.generateVAPIDKeys();
    await db.rpc('wanda_push_set_vapid', { p_public: keys.publicKey, p_private: keys.privateKey });
    const again = await db.rpc('wanda_push_config'); // falls zwei Aufrufe gleichzeitig Schlüssel erzeugt haben
    config = again.data;
  }
  webpush.setVapidDetails(APP_URL, config!.vapid_public!, config!.vapid_private!);
  return config!;
}

// ---------- Hilfen ----------

function berlinNow(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(now).map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

function addDays(key: string, days: number) {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const WEEKDAYS = ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.'];
function dueText(due: string | null, today: string) {
  if (!due) return '';
  if (due === today) return 'bis heute';
  if (due === addDays(today, 1)) return 'bis morgen';
  const d = new Date(`${due}T12:00:00Z`);
  return `bis ${WEEKDAYS[d.getUTCDay()]} ${due.slice(8)}.${due.slice(5, 7)}.`;
}

function wasteIcon(title: string) {
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

async function send(subs: Sub[], payload: Payload) {
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ url: APP_URL, ...payload }),
        { TTL: 12 * 3600 },
      );
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      // Handy hat sich abgemeldet oder die App wurde gelöscht
      if (code === 404 || code === 410) await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
      else console.error('Push fehlgeschlagen', code, (e as Error).message);
    }
  }));
  return sent;
}

async function subsFor(householdId: string, memberIds?: (string | null)[]) {
  let q = db.from('push_subscriptions').select('*').eq('household_id', householdId);
  if (memberIds) q = q.in('member_id', memberIds.filter(Boolean) as string[]);
  const { data } = await q;
  return (data ?? []) as Sub[];
}

async function memberNames(householdId: string) {
  const { data } = await db.from('members').select('id, name').eq('household_id', householdId);
  return Object.fromEntries((data ?? []).map((m) => [m.id, m.name])) as Record<string, string>;
}

async function taskName(householdId: string, taskId: string | null) {
  if (!taskId) return null;
  const { data } = await db.from('tasks').select('name').eq('household_id', householdId).eq('id', taskId).maybeSingle();
  return data?.name ?? null;
}

// ---------- Zugeschickte Aufgaben ----------

async function onAssignment(type: string, householdId: string, id: string) {
  // Immer frisch aus der Datenbank lesen – der Aufruf selbst enthält keine Texte.
  const { data: a } = await db.from('assignments').select('*').eq('household_id', householdId).eq('id', id).maybeSingle();
  if (!a) return 0;
  const names = await memberNames(householdId);
  const title = a.title || (await taskName(householdId, a.task_id)) || 'Aufgabe';
  const today = berlinNow().date;
  if (type === 'insert') {
    if (!a.to_member || a.to_member === a.from_member) return 0;
    const subs = await subsFor(householdId, [a.to_member]);
    const details = [dueText(a.due_date, today), a.note ? `„${a.note}“` : ''].filter(Boolean).join(' · ');
    return send(subs, {
      title: `📨 ${names[a.from_member] ?? 'Jemand'} hat dir eine Aufgabe geschickt`,
      body: `${title}${details ? ` · ${details}` : ''}`,
      tag: `assignment-${a.id}`,
    });
  }
  if (type === 'update' && a.done_at && a.from_member && a.done_by !== a.from_member) {
    const subs = await subsFor(householdId, [a.from_member]);
    return send(subs, {
      title: `✅ ${names[a.done_by] ?? 'Jemand'} hat es erledigt`,
      body: `„${title}“ (+${a.points})`,
      tag: `assignment-${a.id}`,
    });
  }
  return 0;
}

// ---------- Stündlich: Müll & tägliche Erinnerung ----------

async function hourly(now: Date) {
  const { date: today, hour } = berlinNow(now);
  const tomorrow = addDays(today, 1);
  let sent = 0;

  const { data: allSubs } = await db.from('push_subscriptions').select('*');
  const byHousehold = new Map<string, Sub[]>();
  for (const s of (allSubs ?? []) as Sub[]) {
    if (!byHousehold.has(s.household_id)) byHousehold.set(s.household_id, []);
    byHousehold.get(s.household_id)!.push(s);
  }

  for (const [hid, subs] of byHousehold) {
    // Müll am Vorabend
    if (hour === WASTE_HOUR && subs.some((s) => s.waste)) {
      const { data: hh } = await db.from('households').select('waste').eq('id', hid).maybeSingle();
      const pickups = ((hh?.waste?.events ?? []) as { d: string; t: string }[]).filter((e) => e.d === tomorrow);
      if (pickups.length) {
        const titles = pickups.map((e) => `${e.t} rausstellen`);
        const { data: done } = await db.from('completions').select('title')
          .eq('household_id', hid).is('task_id', null).in('title', titles).in('date', [today, tomorrow]);
        const doneTitles = new Set((done ?? []).map((d) => d.title));
        const open = pickups.filter((e) => !doneTitles.has(`${e.t} rausstellen`));
        const { data: assigned } = await db.from('assignments').select('title, to_member')
          .eq('household_id', hid).is('task_id', null).is('done_at', null).in('title', titles);
        const owner = new Map((assigned ?? []).map((a) => [a.title, a.to_member]));
        const forAll = open.filter((e) => !owner.has(`${e.t} rausstellen`));
        const wasteSubs = subs.filter((s) => s.waste);
        if (forAll.length) {
          sent += await send(wasteSubs, {
            title: '🗑️ Morgen wird abgeholt',
            body: `${forAll.map((e) => `${wasteIcon(e.t)} ${e.t}`).join(', ')} – bitte heute Abend rausstellen`,
            tag: `waste-${tomorrow}`,
          });
        }
        for (const e of open.filter((x) => owner.has(`${x.t} rausstellen`))) {
          sent += await send(wasteSubs.filter((s) => s.member_id === owner.get(`${e.t} rausstellen`)), {
            title: '🗑️ Du bist heute Abend dran',
            body: `${wasteIcon(e.t)} ${e.t} rausstellen – morgen ist Abholung`,
            tag: `waste-${tomorrow}-${e.t}`,
          });
        }
      }
    }

    // Tägliche Erinnerung an die Wanda-Stunde – nur wer heute noch nichts gemacht hat
    const due = subs.filter((s) => s.remind_hour === hour && s.member_id);
    if (due.length) {
      const { data: doneToday } = await db.from('completions').select('member_id').eq('household_id', hid).eq('date', today);
      const active = new Set((doneToday ?? []).map((c) => c.member_id));
      const { data: plan } = await db.from('plans').select('plan').eq('household_id', hid).eq('date', today).maybeSingle();
      const mission = await taskName(hid, plan?.plan?.mission ?? null);
      const { data: openAssignments } = await db.from('assignments').select('to_member').eq('household_id', hid).is('done_at', null);
      for (const s of due) {
        if (active.has(s.member_id)) continue;
        const mine = (openAssignments ?? []).filter((a) => a.to_member === s.member_id).length;
        const parts = [mission ? `🎯 Mission: ${mission}` : 'Eine Stunde, kleine Häppchen – du schaffst das!'];
        if (mine) parts.push(`📨 ${mine} ${mine === 1 ? 'Aufgabe' : 'Aufgaben'} für dich`);
        sent += await send([s], { title: '☀️ Zeit für deine Wanda-Stunde!', body: parts.join(' · '), tag: `daily-${today}` });
      }
    }
  }
  return sent;
}

// ---------- Eingang ----------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  try {
    const cfg = await loadConfig();
    const url = new URL(req.url);
    if (req.method === 'GET' && url.searchParams.has('vapid')) return json({ publicKey: cfg.vapid_public });
    if (req.method !== 'POST') return json({ error: 'Nicht unterstützt' }, 405);

    const body = await req.json().catch(() => ({}));

    // Test vom Handy: nur an ein bereits gespeichertes Handy, mit festem Text
    if (body.type === 'test') {
      const { data } = await db.from('push_subscriptions').select('*').eq('endpoint', String(body.endpoint ?? '')).maybeSingle();
      if (!data) return json({ error: 'Dieses Handy ist nicht angemeldet' }, 404);
      const sent = await send([data as Sub], { title: '🧽 Wanda sagt Hallo!', body: 'Benachrichtigungen funktionieren. 🎉', tag: 'test' });
      return json({ sent });
    }

    if (req.headers.get('x-wanda-secret') !== cfg.secret) return json({ error: 'Nicht erlaubt' }, 401);
    if (body.table === 'assignments') return json({ sent: await onAssignment(body.type, body.household_id, body.id) });
    if (body.type === 'hourly') return json({ sent: await hourly(body.now ? new Date(body.now) : new Date()) });
    return json({ error: 'Unbekannter Auftrag' }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});
