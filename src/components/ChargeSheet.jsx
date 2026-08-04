import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { createPaymentRequest, formatAmount, watchIncomingPayment } from '../lib/paymentRequest.js';

/**
 * Pantalla de cobro. Muestra el QR y se queda escuchando la cadena
 * hasta que entra la plata; ahí cambia sola a "Cobrado".
 *
 * @param {string}  myAddress     Wallet del que cobra (Privy embedded wallet)
 * @param {number}  amount
 * @param {string}  token         'USDC' | 'ARST'
 * @param {string}  [memo]
 * @param {object}  [counterparty] Contacto al que se le cobra, si hay
 * @param {object}  publicClient  Cliente viem apuntando a Arc testnet
 * @param {func}    onClose
 */
export default function ChargeSheet({
  myAddress, amount, token = 'USDC', memo = '', counterparty,
  publicClient, onClose,
}) {
  const [qr, setQr] = useState(null);
  const [status, setStatus] = useState('waiting'); // waiting | paid | error
  const [paidTx, setPaidTx] = useState(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);
  const stopRef = useRef(null);

  const request = useMemo(() => {
    try {
      return createPaymentRequest({
        to: myAddress, amount, token, memo,
        from: counterparty?.address || '',
      });
    } catch (e) {
      setError(e.message);
      return null;
    }
  }, [myAddress, amount, token, memo, counterparty]);

  // Generamos el QR sobre el link de la app (funciona con Midato y, si la
  // wallet no lo entiende, abajo queda el EIP-681 para wallets externas).
  useEffect(() => {
    if (!request) return;
    let alive = true;
    QRCode.toDataURL(request.url, { margin: 1, width: 512, errorCorrectionLevel: 'M' })
      .then((url) => alive && setQr(url))
      .catch(() => alive && setError('No se pudo generar el QR.'));
    return () => { alive = false; };
  }, [request]);

  // Escuchamos la liquidación on-chain
  useEffect(() => {
    if (!request || !publicClient) return;
    stopRef.current = watchIncomingPayment(publicClient, {
      to: myAddress,
      amount: request.amount,
      token: request.token,
      onPaid: (tx) => { setPaidTx(tx); setStatus('paid'); },
      onError: (e) => { setError(e.message); setStatus('error'); },
    });
    return () => stopRef.current?.();
  }, [request, publicClient, myAddress]);

  const copy = async () => {
    if (!request) return;
    await navigator.clipboard.writeText(request.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const share = async () => {
    if (!request) return;
    const text = `Te cobro ${formatAmount(request.amount, request.token)}${memo ? ` por ${memo}` : ''}`;
    if (navigator.share) {
      try { await navigator.share({ title: 'Cobro Midato', text, url: request.url }); return; } catch { /* cancelado */ }
    }
    copy();
  };

  if (error && !request) {
    return (
      <div className="mp-sheet mp-sheet--charge">
        <p className="mp-error">{error}</p>
        <button className="mp-btn mp-btn--ghost" onClick={onClose}>Volver</button>
      </div>
    );
  }

  if (status === 'paid') {
    return (
      <div className="mp-sheet mp-sheet--charge mp-sheet--paid">
        <div className="mp-check" aria-hidden="true">✓</div>
        <h3>Cobrado</h3>
        <p className="mp-amount">{formatAmount(request.amount, request.token)}</p>
        {paidTx && (
          <a
            className="mp-link mp-mono"
            href={`https://testnet.arcscan.app/tx/${paidTx.txHash}`}
            target="_blank"
            rel="noreferrer"
          >
            Ver en el explorador
          </a>
        )}
        <button className="mp-btn mp-btn--primary" onClick={onClose}>Listo</button>
      </div>
    );
  }

  return (
    <div className="mp-sheet mp-sheet--charge">
      <header>
        <span className="mp-eyebrow">Cobrando</span>
        <p className="mp-amount">{formatAmount(request.amount, request.token)}</p>
        {memo && <p className="mp-muted">{memo}</p>}
        {counterparty && <p className="mp-muted">a {counterparty.name}</p>}
      </header>

      <div className="mp-qr">
        {qr ? <img src={qr} alt="Código QR para pagar este cobro" /> : <div className="mp-qr__skeleton" />}
      </div>

      <p className="mp-waiting">
        <span className="mp-pulse" aria-hidden="true" />
        Esperando el pago
      </p>

      <div className="mp-sheet__actions">
        <button className="mp-btn mp-btn--ghost" onClick={copy}>
          {copied ? 'Link copiado' : 'Copiar link'}
        </button>
        <button className="mp-btn mp-btn--primary" onClick={share}>Compartir</button>
      </div>

      {request.eip681 && (
        <details className="mp-details">
          <summary>Pagar desde otra wallet</summary>
          <p className="mp-hint">
            Si tu cliente usa MetaMask o Rainbow en vez de Midato, este es el link que
            entiende esa wallet.
          </p>
          <code className="mp-mono mp-code">{request.eip681}</code>
        </details>
      )}

      {error && <p className="mp-error">{error}</p>}

      <button className="mp-btn mp-btn--ghost mp-btn--wide" onClick={onClose}>Cancelar cobro</button>
    </div>
  );
}
