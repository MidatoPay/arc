import { useState } from 'react';
import { useContacts } from '../hooks/useContacts.js';
import { shortAddress, cleanAliases } from '../lib/contacts.js';

const EMPTY = { name: '', address: '', aliases: '', note: '' };

/**
 * Agenda. El alias es lo que hace que la voz funcione, así que la UI
 * lo trata como campo de primera clase, no como un extra escondido.
 */
export default function ContactsScreen({ onPick, pickMode = false }) {
  const { contacts, ready, add, update, remove, search } = useContacts();
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState(null); // null = formulario cerrado
  const [editingId, setEditingId] = useState(null);
  const [errors, setErrors] = useState({});

  const visible = search(query);

  const openNew = () => { setDraft(EMPTY); setEditingId(null); setErrors({}); };
  const openEdit = (c) => {
    setDraft({ name: c.name, address: c.address, aliases: (c.aliases || []).join(', '), note: c.note || '' });
    setEditingId(c.id);
    setErrors({});
  };
  const close = () => { setDraft(null); setEditingId(null); setErrors({}); };

  const submit = () => {
    const payload = { ...draft, aliases: cleanAliases(draft.aliases) };
    const res = editingId ? update(editingId, payload) : add(payload);
    if (res.ok) close();
    else setErrors(res.errors);
  };

  if (!ready) return <div className="mp-agenda"><p className="mp-muted">Cargando agenda…</p></div>;

  return (
    <div className="mp-agenda">
      <header className="mp-agenda__head">
        <h2>Contactos</h2>
        <button className="mp-btn mp-btn--primary" onClick={openNew}>Agregar contacto</button>
      </header>

      {contacts.length > 0 && (
        <input
          className="mp-input"
          type="search"
          placeholder="Buscar por nombre, alias o dirección"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}

      {contacts.length === 0 && !draft && (
        <div className="mp-empty">
          <p><strong>Tu agenda está vacía.</strong></p>
          <p className="mp-muted">
            Cargá un contacto con su alias y vas a poder decir
            “pagale 50 USDC a Juampi” en vez de dictar una dirección.
          </p>
          <button className="mp-btn mp-btn--primary" onClick={openNew}>Agregar el primero</button>
        </div>
      )}

      {visible.length === 0 && contacts.length > 0 && (
        <p className="mp-muted">Ningún contacto coincide con “{query}”.</p>
      )}

      <ul className="mp-list">
        {visible.map((c) => (
          <li key={c.id} className="mp-card">
            <button
              className="mp-card__main"
              onClick={() => (pickMode ? onPick?.(c) : openEdit(c))}
            >
              <span className="mp-avatar" aria-hidden="true">{c.name.slice(0, 1).toUpperCase()}</span>
              <span className="mp-card__text">
                <span className="mp-card__name">{c.name}</span>
                {c.aliases?.length > 0 && (
                  <span className="mp-chips">
                    {c.aliases.map((a) => <span key={a} className="mp-chip">{a}</span>)}
                  </span>
                )}
                <span className="mp-mono mp-muted">{shortAddress(c.address)}</span>
              </span>
            </button>
            {!pickMode && (
              <button
                className="mp-btn mp-btn--ghost"
                onClick={() => remove(c.id)}
                aria-label={`Borrar ${c.name}`}
              >
                Borrar
              </button>
            )}
          </li>
        ))}
      </ul>

      {draft && (
        <div className="mp-sheet" role="dialog" aria-label={editingId ? 'Editar contacto' : 'Nuevo contacto'}>
          <h3>{editingId ? 'Editar contacto' : 'Nuevo contacto'}</h3>

          <label className="mp-field">
            <span>Nombre</span>
            <input
              className="mp-input"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Panadería La Esquina"
              autoFocus
            />
            {errors.name && <em className="mp-error">{errors.name}</em>}
          </label>

          <label className="mp-field">
            <span>Alias para la voz</span>
            <input
              className="mp-input"
              value={draft.aliases}
              onChange={(e) => setDraft({ ...draft, aliases: e.target.value })}
              placeholder="la panadería, don julio"
            />
            <em className="mp-hint">
              Separá con comas. Poné cómo lo nombrás en voz alta, no el nombre formal.
            </em>
            {errors.aliases && <em className="mp-error">{errors.aliases}</em>}
          </label>

          <label className="mp-field">
            <span>Dirección de wallet</span>
            <input
              className="mp-input mp-mono"
              value={draft.address}
              onChange={(e) => setDraft({ ...draft, address: e.target.value })}
              placeholder="0x…"
              spellCheck={false}
            />
            {errors.address && <em className="mp-error">{errors.address}</em>}
          </label>

          <label className="mp-field">
            <span>Nota</span>
            <input
              className="mp-input"
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              placeholder="Proveedor de facturas semanales"
            />
          </label>

          <div className="mp-sheet__actions">
            <button className="mp-btn mp-btn--ghost" onClick={close}>Cancelar</button>
            <button className="mp-btn mp-btn--primary" onClick={submit}>
              {editingId ? 'Guardar cambios' : 'Agregar contacto'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
