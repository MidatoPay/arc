import { useEffect, useState } from 'react';
import { useLanguage } from './i18n.jsx';

export default function BusinessProfile({profile,error,onSave,onRetry}) {
  const {t} = useLanguage();
  const [name,setName] = useState(''),[saving,setSaving] = useState(false),[message,setMessage] = useState('');
  useEffect(() => {setName(profile?.businessName || '');setMessage('');},[profile?.businessName]);
  const submit = async event => {
    event.preventDefault();setSaving(true);setMessage('');
    try {await onSave(name);setMessage('businessSaved');}
    catch {setMessage('businessSaveError');}
    finally {setSaving(false);}
  };
  return <form onSubmit={submit} style={{display:'flex',flexDirection:'column',gap:12}}>
    <label htmlFor="business-name" style={{fontWeight:600}}>{t('mas.businessName')}</label>
    <input id="business-name" value={name} maxLength={100} disabled={!profile || saving}
      placeholder={profile?.userName || ''} autoComplete="organization"
      onChange={event => {setName(event.target.value);setMessage('');}}
      style={{font:'inherit',padding:14,border:'1px solid #ECECF0',borderRadius:12,width:'100%',boxSizing:'border-box'}} />
    <small style={{color:'#7A7A85'}}>{t('mas.businessHint')}</small>
    {error ? <><div role="alert">{t('mas.businessLoadError')}</div>
      <button type="button" onClick={onRetry}>{t('mas.businessRetry')}</button></> :
      <button type="submit" disabled={!profile || saving || name.trim()===(profile.businessName || '')}
        style={{font:'inherit',padding:12,border:0,borderRadius:12,background:'#FF5A00',color:'white',cursor:'pointer'}}>
        {t(saving?'mas.businessSaving':'mas.businessSave')}
      </button>}
    {message && <div role={message==='businessSaveError'?'alert':'status'}>{t(`mas.${message}`)}</div>}
  </form>;
}
