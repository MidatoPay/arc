import { useEffect, useRef, useState } from 'react';
import { useLanguage } from './i18n.jsx';

// Nombre del negocio: fila compacta en Perfil que se expande para editar. Misma API (GET/PATCH /merchant-profile).
const C = { ink: '#16161A', mut: '#7A7A85', line: '#ECECF0', card: '#FFFFFF', orange: '#FF5A00', accent: '#fe6c1c', orangeSoft: '#FFEADF', green: '#15803D', red: '#E4483D' };
const IconStore = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 9.5 5.5 4h13L20 9.5M4 9.5h16M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0M5.5 12v8h13v-8M10 20v-4.5h4V20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const button = { border: 0, borderRadius: 14, padding: '12px 14px', font: 'inherit', fontSize: 15, fontWeight: 600, cursor: 'pointer', flex: 1 };

export default function BusinessProfile({ profile, error, onSave, onRetry }) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState(false), [name, setName] = useState(''), [saving, setSaving] = useState(false), [message, setMessage] = useState('');
  const inputRef = useRef(null);
  useEffect(() => { setName(profile?.businessName || ''); }, [profile?.businessName]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);
  useEffect(() => {
    if (message !== 'businessSaved') return undefined;
    const timer = setTimeout(() => setMessage(''), 2500);
    return () => clearTimeout(timer);
  }, [message]);

  const submit = async (event) => {
    event.preventDefault(); setSaving(true); setMessage('');
    try { await onSave(name); setMessage('businessSaved'); setEditing(false); }
    catch { setMessage('businessSaveError'); }
    finally { setSaving(false); }
  };
  const cancel = () => { setName(profile?.businessName || ''); setMessage(''); setEditing(false); };
  const unchanged = name.trim() === (profile?.businessName || '');

  const icon = <span style={{ width: 36, height: 36, borderRadius: 12, background: C.orangeSoft, color: C.accent, display: 'grid', placeItems: 'center', flexShrink: 0 }}><IconStore /></span>;
  const titleStyle = { display: 'block', fontSize: 15, fontWeight: 500, color: C.ink };

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0' }}>
        {icon}
        <div role="alert" style={{ flex: 1, minWidth: 0, fontSize: 13, color: C.red }}>{t('mas.businessLoadError')}</div>
        <button type="button" onClick={onRetry} style={{ border: 0, borderRadius: 999, background: C.card, color: C.accent, font: 'inherit', fontSize: 13, fontWeight: 600, padding: '7px 12px', cursor: 'pointer' }}>
          {t('mas.businessRetry')}
        </button>
      </div>
    );
  }

  if (!editing) {
    const current = profile?.businessName;
    return (
      <div>
        <button type="button" onClick={() => { setEditing(true); setMessage(''); }} disabled={!profile} aria-label={`${t('mas.businessName')}: ${current || t('mas.businessUnset')}. ${t('mas.businessEdit')}`}
          style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', border: 0, background: 'transparent', padding: '12px 0', font: 'inherit', color: 'inherit', textAlign: 'left', cursor: profile ? 'pointer' : 'default' }}>
          {icon}
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={titleStyle}>{t('mas.businessName')}</span>
            <span style={{ display: 'block', fontSize: 12.5, color: C.mut, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {profile ? (current || t('mas.businessUnsetHint', profile.userName || '')) : '…'}
            </span>
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.accent, flexShrink: 0 }}>{t('mas.businessEdit')}</span>
        </button>
        {message && (
          <div role={message === 'businessSaveError' ? 'alert' : 'status'} style={{ fontSize: 12.5, color: message === 'businessSaveError' ? C.red : C.green, padding: '0 0 10px 48px' }}>
            {t(`mas.${message}`)}
          </div>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 0' }}>
      <label htmlFor="business-name" style={{ ...titleStyle, fontSize: 14 }}>{t('mas.businessName')}</label>
      <input id="business-name" ref={inputRef} value={name} maxLength={100} disabled={saving}
        placeholder={profile?.userName || ''} autoComplete="organization"
        onChange={(event) => { setName(event.target.value); setMessage(''); }}
        style={{ font: 'inherit', fontSize: 15, padding: '13px 14px', border: `1px solid ${C.line}`, borderRadius: 14, width: '100%', boxSizing: 'border-box', background: C.card, color: C.ink, outline: 'none' }} />
      <div style={{ fontSize: 12.5, color: C.mut, lineHeight: 1.45 }}>{t('mas.businessHint')}</div>
      {message === 'businessSaveError' && <div role="alert" style={{ fontSize: 12.5, color: C.red }}>{t('mas.businessSaveError')}</div>}
      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <button type="button" onClick={cancel} disabled={saving} style={{ ...button, background: C.card, color: C.ink }}>{t('mas.cancel')}</button>
        <button type="submit" disabled={saving || unchanged}
          style={{ ...button, background: C.orange, color: '#fff', opacity: saving || unchanged ? 0.45 : 1, cursor: saving || unchanged ? 'default' : 'pointer' }}>
          {t(saving ? 'mas.businessSaving' : 'mas.businessSave')}
        </button>
      </div>
    </form>
  );
}
