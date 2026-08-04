import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import {
  loadContacts, saveContacts, addContact, updateContact,
  removeContact, searchContacts, validateContact, findByAddress,
} from '../lib/contacts.js';

/**
 * Agenda del usuario logueado. Persiste sola en cada cambio.
 */
export function useContacts() {
  const { user } = usePrivy();
  const userId = user?.id;

  const [contacts, setContacts] = useState([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setContacts(loadContacts(userId));
    setReady(true);
  }, [userId]);

  const commit = useCallback(
    (next) => {
      setContacts(next);
      saveContacts(userId, next);
      return next;
    },
    [userId]
  );

  const api = useMemo(
    () => ({
      contacts,
      ready,
      add: (draft) => {
        const { ok, errors } = validateContact(draft, contacts);
        if (!ok) return { ok: false, errors };
        commit(addContact(contacts, draft));
        return { ok: true, errors: {} };
      },
      update: (id, patch) => {
        const current = contacts.find((c) => c.id === id);
        const { ok, errors } = validateContact({ ...current, ...patch }, contacts, id);
        if (!ok) return { ok: false, errors };
        commit(updateContact(contacts, id, patch));
        return { ok: true, errors: {} };
      },
      remove: (id) => commit(removeContact(contacts, id)),
      search: (q) => searchContacts(contacts, q),
      byAddress: (a) => findByAddress(contacts, a),
      /** Guarda una dirección con la que ya operaste, para no perderla. */
      quickSave: (address, name) => {
        if (findByAddress(contacts, address)) return { ok: true, errors: {} };
        return api.add({ name: name || 'Sin nombre', address, aliases: [] });
      },
    }),
    [contacts, ready, commit]
  );

  return api;
}

export default useContacts;
