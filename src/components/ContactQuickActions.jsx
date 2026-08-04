import { useState } from 'react';
import { shortAddress } from '../lib/contacts.js';
import { formatAmount, getToken } from '../lib/paymentRequest.js';

export default function ContactQuickActions({ contact, onPay, onCharge, onEdit, onClose }) {
  const [action, setAction] = useState(null);
  const [amount, setAmount] = useState('');
  const [token, setToken] = useState('USDC');
  const [memo, setMemo] = useState('');

  const value = Number(amount);
  const valid = value > 0;

  const confirm = () => {
    if (!valid) return;
    const payload = { amount: value, token, memo: memo.trim(), contact };
    if (action === 'charge') onCharge(payload);
    else onPay({ ...payload, to: contact.address });
    onClose();
  };

  return (
    <div className="mp-sheet mp-sheet--contact" role="dialog">
      <header className="mp-contact__head">
        <span className="mp-avatar" aria-hidden="true">{contact.name.slice(0, 1).toUpperCase()}</span>
        <div>
          <p className="mp-contact__name">{contact.name}</p>
          <p className="mp-mono mp-muted">{shortAddress(contact.address)}</p>
        </div>
      </header>

      {contact.aliases?.length > 0 && (
        <p className="mp-hint">Por voz: "pagale 500 pesos a {contact.aliases[0]}"</p>
      )}

      {!action && (
        <>
          <div className="mp-sheet__actions">
            <button className="mp-btn mp-btn--ghost mp-btn--tall" onClick={() => setAction('charge')}>
              Cobrarle
            </button>
            <button className="mp-btn mp-btn--primary mp-btn--tall" onClick={() => setAction('pay')}>
              Pagarle
            </button>
          </div>
          <button className="mp-btn mp-btn--ghost mp-btn--wide" onClick={onEdit}>
            Editar contacto
          </button>
          <button className="mp-btn mp-btn--ghost mp-btn--wide" onClick={onClose}>Cerrar</button>
        </>
      )}

      {action && (
        <>
          <p className="mp-eyebrow">
            {action === 'pay' ? 'Pagarle a' : 'Cobrarle a'} {contact.name}
          </p>

          <label className="mp-field">
            <span>Monto</span>
            <input
              className="mp-input mp-input--amount"
              type="number" inputMode="decimal" step="0.01" min="0"
              value={amount} autoFocus
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && confirm()}
              placeholder="0"
            />
          </label>

          <div className="mp-segment" role="group">
            {['USDC', 'ARST'].map((t) => (
              <button
                key={t}
                className={`mp-segment__opt ${token === t ? 'is-on' : ''}`}
                onClick={() => setToken(t)}
                aria-pressed={token === t}
              >
                {getToken(t).label}
              </button>
            ))}
          </div>

          <label className="mp-field">
            <span>Concepto</span>
            <input
              className="mp-input" value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="2 cafes"
            />
          </label>

          <div className="mp-sheet__actions">
            <button className="mp-btn mp-btn--ghost" onClick={() => setAction(null)}>Volver</button>
            <button className="mp-btn mp-btn--primary" onClick={confirm} disabled={!valid}>
              {action === 'pay'
                ? `Pagar ${valid ? formatAmount(value, token) : ''}`
                : `Cobrar ${valid ? formatAmount(value, token) : ''}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
