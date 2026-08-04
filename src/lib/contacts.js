/**
 * contacts.js — Agenda de contactos con alias de wallet.
 *
 * Guarda en localStorage, namespaceado por usuario de Privy, así dos cuentas
 * en el mismo navegador no se pisan la agenda.
 *
 * Cuando tengas backend, reemplazá load/save por llamadas a la API.
 * El resto del archivo no cambia.
 */

import { normalize } from './voiceParser.js';

const PREFIX = 'midato.contacts';

const key = (userId) => `${PREFIX}.${userId || 'anon'}`;

/** @typedef {{id:string,name:string,aliases:string[],address:string,note?:string,createdAt:number}} Contact */

export function loadContacts(userId) {
  try {
    const raw = localStorage.getItem(key(userId));
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveContacts(userId, contacts) {
  try {
    localStorage.setItem(key(userId), JSON.stringify(contacts));
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Validación
 * ------------------------------------------------------------------ */

export const isValidAddress = (a) => /^0x[a-fA-F0-9]{40}$/.test((a || '').trim());

/**
 * Valida un contacto antes de guardarlo.
 * Devuelve { ok, errors: { campo: mensaje } }
 */
export function validateContact(draft, existing = [], editingId = null) {
  const errors = {};
  const name = (draft.name || '').trim();
  const address = (draft.address || '').trim();

  if (!name) errors.name = 'Poné un nombre para reconocerlo.';
  if (!address) errors.address = 'Falta la dirección de wallet.';
  else if (!isValidAddress(address)) errors.address = 'No parece una dirección: son 42 caracteres y arranca con 0x.';

  const others = existing.filter((c) => c.id !== editingId);

  if (address && others.some((c) => c.address.toLowerCase() === address.toLowerCase())) {
    errors.address = 'Ya tenés un contacto con esta dirección.';
  }

  // Los alias son la clave de la voz: si se repiten, el parser no puede decidir
  const taken = new Set();
  for (const c of others) {
    taken.add(normalize(c.name));
    (c.aliases || []).forEach((a) => taken.add(normalize(a)));
  }
  const mine = [name, ...(draft.aliases || [])].map(normalize).filter(Boolean);
  const dup = mine.find((a) => taken.has(a));
  if (dup) errors.aliases = `"${dup}" ya lo usa otro contacto. Los alias tienen que ser únicos para que la voz funcione.`;

  return { ok: Object.keys(errors).length === 0, errors };
}

/* ------------------------------------------------------------------ *
 * CRUD
 * ------------------------------------------------------------------ */

const newId = () =>
  (globalThis.crypto?.randomUUID?.() ?? `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

export function addContact(contacts, draft) {
  const contact = {
    id: newId(),
    name: draft.name.trim(),
    aliases: cleanAliases(draft.aliases),
    address: draft.address.trim(),
    note: (draft.note || '').trim(),
    createdAt: Date.now(),
  };
  return [...contacts, contact];
}

export function updateContact(contacts, id, patch) {
  return contacts.map((c) =>
    c.id === id
      ? {
          ...c,
          ...patch,
          name: (patch.name ?? c.name).trim(),
          address: (patch.address ?? c.address).trim(),
          aliases: patch.aliases ? cleanAliases(patch.aliases) : c.aliases,
        }
      : c
  );
}

export function removeContact(contacts, id) {
  return contacts.filter((c) => c.id !== id);
}

/** Acepta array o string separado por comas. Saca vacíos y duplicados. */
export function cleanAliases(input) {
  const arr = Array.isArray(input) ? input : String(input || '').split(',');
  const seen = new Set();
  const out = [];
  for (const a of arr) {
    const t = a.trim();
    if (!t) continue;
    const n = normalize(t);
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(t);
  }
  return out;
}

/** Búsqueda de texto para la barra de la agenda (no es la de voz). */
export function searchContacts(contacts, query) {
  const q = normalize(query);
  if (!q) return contacts;
  return contacts.filter((c) => {
    const hay = [c.name, c.address, c.note, ...(c.aliases || [])].map(normalize).join(' ');
    return hay.includes(q);
  });
}

export function findByAddress(contacts, address) {
  const a = (address || '').toLowerCase();
  return contacts.find((c) => c.address.toLowerCase() === a) || null;
}

/** "0x1234…abcd" para mostrar en pantalla. */
export function shortAddress(address, lead = 6, tail = 4) {
  if (!address || address.length < lead + tail) return address || '';
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}
