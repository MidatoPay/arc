import { useEffect, useState } from 'react';
import { parseVoiceCommand } from '../lib/voiceParser.js';
import { formatAmount, getToken } from '../lib/paymentRequest.js';
import { shortAddress } from '../lib/contacts.js';

/**
 * Toma la transcripción cruda y arma la confirmación.
 *
 * Regla de diseño: nunca ejecutar directo desde la voz. La voz llena el
 * formulario; la persona confirma. Un error de transcripción no puede
 * costarle plata a nadie.
 *
 * @param {string} transcript
 * @param {Array}  contacts
 * @param {func}   onPay    ({ to, amount, token, memo, contact })
 * @param {func}   onCharge ({ amount, token, memo, contact })
 * @param {func}   onCancel
 */
export default function VoiceCommandSheet({ transcript, contacts, onPay, onCharge, onCancel }) {
  const [parsed, setParsed] = useState(null);
  const [override, setOverride] = useState({}); // correcciones manuales

  useEffect(() => {
    setParsed(parseVoiceCommand(transcript, contacts));
    setOverride({});
  }, [transcript, contacts]);

  if (!parsed) return null;

  const intent = override.intent ?? parsed.intent;
  const amount = override.amount ?? parsed.amount;
  const token = override.token ?? parsed.token;
  const contact = override.contact ?? parsed.counterparty;

  const isCharge = intent === 'charge';
  const needsContact = intent === 'pay' && !contact;
  const canRun = intent && amount > 0 && (isCharge || contact);

  const run = () => {
    const payload = { amount, token, memo: '', contact };
    if (isCharge) onCharge({ ...payload });
    else onPay({ ...payload, to: contact.address });
  };

  /* --- No se entendió la intención --- */
  if (!intent) {
    return (
      <div className="mp-sheet mp-sheet--voice">
        <span className="mp-eyebrow">Escuché</span>
        <p className="mp-transcript">“{parsed.transcript}”</p>
        <p>No pillé si querías pagar o cobrar.</p>
        <div className="mp-sheet__actions">
          <button className="mp-btn mp-btn--ghost" onClick={() => setOverride({ intent: 'charge' })}>
            Cobrar
          </button>
          <button className="mp-btn mp-btn--primary" onClick={() => setOverride({ intent: 'pay' })}>
            Pagar
          </button>
        </div>
        <button className="mp-btn mp-btn--ghost mp-btn--wide" onClick={onCancel}>Probar de nuevo</button>
      </div>
    );
  }

  return (
    <div className="mp-sheet mp-sheet--voice">
      <span className="mp-eyebrow">{isCharge ? 'Cobrar' : 'Pagar'}</span>
      <p className="mp-transcript">“{parsed.transcript}”</p>

      {/* Monto */}
      {amount > 0 ? (
        <p className="mp-amount">{formatAmount(amount, token)}</p>
      ) : (
        <div className="mp-field">
          <span>¿De cuánto?</span>
          <input
            className="mp-input mp-input--amount"
            type="number"
            inputMode="decimal"
            step="0.01"
            autoFocus
            onChange={(e) => setOverride({ ...override, amount: Number(e.target.value) })}
          />
        </div>
      )}

      {/* Moneda asumida: lo decimos, no lo escondemos */}
      {parsed.tokenAssumed && amount > 0 && (
        <p className="mp-hint">
          Asumí {getToken(token).label}.{' '}
          <button
            className="mp-linkbtn"
            onClick={() => setOverride({ ...override, token: token === 'USDC' ? 'ARST' : 'USDC' })}
          >
            Cambiar a {token === 'USDC' ? 'pesos' : 'USDC'}
          </button>
        </p>
      )}

      {/* Contraparte */}
      {contact && (
        <p className="mp-counterparty">
          {isCharge ? 'a ' : 'a '}
          <strong>{contact.name}</strong>{' '}
          <span className="mp-mono mp-muted">{shortAddress(contact.address)}</span>
        </p>
      )}

      {/* Varios contactos parecidos: preguntamos en vez de adivinar */}
      {!contact && parsed.candidates.length > 0 && (
        <div className="mp-disambig">
          <p>Escuché “{parsed.counterpartyQuery}”. ¿Cuál de estos?</p>
          <ul className="mp-list mp-list--tight">
            {parsed.candidates.map((c) => (
              <li key={c.id}>
                <button className="mp-btn mp-btn--pick" onClick={() => setOverride({ ...override, contact: c })}>
                  <strong>{c.name}</strong>
                  <span className="mp-mono mp-muted">{shortAddress(c.address)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Pago sin destinatario */}
      {needsContact && parsed.candidates.length === 0 && (
        <p className="mp-error">
          {parsed.counterpartyQuery
            ? `No tenés a “${parsed.counterpartyQuery}” en la agenda. Agregalo y repetí el comando.`
            : 'Decime a quién le pagás, o elegilo de la agenda.'}
        </p>
      )}

      {/* Cobro sin destinatario: es válido, el QR queda abierto */}
      {isCharge && !contact && (
        <p className="mp-hint">Cobro abierto: cualquiera que escanee el QR lo puede pagar.</p>
      )}

      <div className="mp-sheet__actions">
        <button className="mp-btn mp-btn--ghost" onClick={onCancel}>Cancelar</button>
        <button className="mp-btn mp-btn--primary" onClick={run} disabled={!canRun}>
          {isCharge ? 'Generar cobro' : 'Confirmar pago'}
        </button>
      </div>
    </div>
  );
}
