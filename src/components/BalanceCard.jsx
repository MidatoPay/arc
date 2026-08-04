import { useState } from 'react';

/**
 * Tarjeta de saldo. Solo el saldo.
 *
 * Los botones Cobrar / Convertir / Pagar se fueron: ahora todo entra por el
 * micrófono de la barra de abajo. Con la fila de acciones afuera la tarjeta
 * queda con demasiado aire, así que bajé el padding vertical y subí el número
 * — es lo único que queda, que ocupe el lugar.
 */
export default function BalanceCard({ balanceArs, currency = 'ARS' }) {
  const [hidden, setHidden] = useState(false);

  const formatted = new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(balanceArs ?? 0);

  return (
    <section className="mp-balance">
      <header className="mp-balance__head">
        <span className="mp-balance__label">Disponible</span>
        <span className="mp-balance__currency">{currency}</span>
      </header>

      <div className="mp-balance__row">
        <p className="mp-balance__value" aria-live="polite">
          {hidden ? '$ ••••••' : `$ ${formatted}`}
        </p>
        <button
          className="mp-balance__eye"
          onClick={() => setHidden((h) => !h)}
          aria-label={hidden ? 'Mostrar saldo' : 'Ocultar saldo'}
          aria-pressed={hidden}
        >
          {hidden ? '🙈' : '👁'}
        </button>
      </div>
    </section>
  );
}
