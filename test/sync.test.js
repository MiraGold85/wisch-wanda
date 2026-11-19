import { test } from 'node:test';
import assert from 'node:assert/strict';

// sync.js lädt den Supabase-Client erst bei Bedarf – die Hilfsfunktionen lassen sich direkt prüfen.
const { packRooms, unpackRooms } = await import('../js/sync.js');

test('Raumauswahl reist mit den Raumnamen zum Server und zurück', () => {
  const raw = packRooms({ roomNames: { kind1: 'Toms Zimmer' }, roomOwners: { kind1: ['m2'] }, pausedRooms: {}, roomsOff: ['treppenhaus', 'garten'] });
  assert.deepEqual(raw.__off, ['treppenhaus', 'garten']);
  const s = {};
  unpackRooms(s, raw);
  assert.deepEqual(s.roomsOff, ['treppenhaus', 'garten']);
  assert.deepEqual(s.roomNames, { kind1: 'Toms Zimmer' });
  // Familien ohne eigene Auswahl: nichts mitschicken, nichts überschreiben
  const old = packRooms({ roomNames: {}, roomOwners: {}, pausedRooms: {} });
  assert.ok(!('__off' in old));
  const s2 = { roomsOff: undefined };
  unpackRooms(s2, old);
  assert.equal(s2.roomsOff, undefined);
});
