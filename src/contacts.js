import { ethers } from "ethers";

const storageKey = (address) => `mp_contacts_${(address || "").toLowerCase()}`;

export function loadContacts(address) {
  if (!address) return [];
  try {
    const raw = localStorage.getItem(storageKey(address));
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveContacts(address, list) {
  if (!address) return;
  try {
    localStorage.setItem(storageKey(address), JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalize({ name, alias, addr, note }) {
  return {
    name: name.trim(),
    alias: alias.trim().toLowerCase(),
    addr: addr.trim(),
    note: (note || "").trim(),
  };
}

export function addContact(list, data) {
  return [{ id: makeId(), ...normalize(data) }, ...list];
}

export function updateContact(list, id, data) {
  return list.map((c) => (c.id === id ? { ...c, ...normalize(data) } : c));
}

export function removeContact(list, id) {
  return list.filter((c) => c.id !== id);
}

/** Resuelve un alias hablado a un contacto: match exacto primero, luego "contiene". */
export function findByAlias(list, alias) {
  const a = (alias || "").toLowerCase();
  if (!a) return null;
  return list.find((c) => c.alias === a) || list.find((c) => a.includes(c.alias)) || null;
}

export function searchContacts(list, query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return list;
  return list.filter((c) => c.name.toLowerCase().includes(q) || c.alias.toLowerCase().includes(q));
}

export function validateContact({ name, alias, addr }, list, editingId) {
  const errors = {};
  if (!name || !name.trim()) errors.name = "required";

  const aliasNorm = (alias || "").trim().toLowerCase();
  if (!aliasNorm) {
    errors.alias = "required";
  } else if (list.some((c) => c.alias === aliasNorm && c.id !== editingId)) {
    errors.alias = "duplicate";
  }

  if (!addr || !ethers.isAddress(addr.trim())) errors.addr = "invalid";

  return { valid: Object.keys(errors).length === 0, errors };
}
