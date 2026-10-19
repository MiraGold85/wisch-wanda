// Push-Benachrichtigungen für dieses Handy ein- und ausschalten.
// Verschickt werden sie vom Push-Dienst auf Supabase (supabase/functions/wanda-push).
import * as sync from './sync.js';

export function pushSupport() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return ios && !standalone ? 'ios-install' : 'unsupported';
  }
  if (Notification.permission === 'denied') return 'denied';
  return 'ok';
}

function keyBytes(base64url) {
  const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
}

const err = (code, message) => Object.assign(new Error(message), { code });

async function currentSubscription(publicKey) {
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub && publicKey) {
    // Hat der Push-Dienst neue Schlüssel, muss sich das Handy neu anmelden.
    const old = sub.options?.applicationServerKey;
    const same = old && btoa(String.fromCharCode(...new Uint8Array(old))) === btoa(String.fromCharCode(...keyBytes(publicKey)));
    if (!same) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  if (!sub && publicKey) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  }
  return sub;
}

async function store(sub, memberId, settings) {
  const j = sub.toJSON();
  await sync.savePushSubscription({
    endpoint: j.endpoint, member_id: memberId, p256dh: j.keys.p256dh, auth: j.keys.auth,
    remind_hour: settings.remindHour ?? null, waste: settings.waste !== false,
  });
  return { endpoint: j.endpoint, remindHour: settings.remindHour ?? null, waste: settings.waste !== false };
}

export async function enablePush(memberId, settings) {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw err('denied', 'Benachrichtigungen wurden nicht erlaubt.');
  let publicKey;
  try {
    const res = await fetch(`${sync.pushFunctionUrl()}?vapid=1`, { headers: sync.pushHeaders() });
    publicKey = (await res.json()).publicKey;
  } catch {
    // unten behandelt
  }
  if (!publicKey) throw err('service', 'Der Push-Dienst ist noch nicht eingerichtet.');
  return store(await currentSubscription(publicKey), memberId, settings);
}

export async function updatePush(memberId, settings) {
  const sub = await currentSubscription(null);
  if (!sub) throw err('gone', 'Dieses Handy ist nicht mehr angemeldet.');
  return store(sub, memberId, settings);
}

export async function disablePush(endpoint) {
  try {
    const sub = await currentSubscription(null);
    await sub?.unsubscribe();
  } finally {
    if (endpoint) await sync.deletePushSubscription(endpoint).catch(() => {});
  }
}

export async function testPush(endpoint) {
  const res = await fetch(sync.pushFunctionUrl(), {
    method: 'POST', headers: sync.pushHeaders(), body: JSON.stringify({ type: 'test', endpoint }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.sent) throw err('test', data.error || 'Test hat nicht geklappt.');
}
