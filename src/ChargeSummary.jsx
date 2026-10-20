import { useState, useEffect } from "react";
import { paymentReceived, canStartNewCharge } from "./chargeStatus.js";
import { explorerTxUrl } from "./chain.js";

const INK = "#16161A";
const MUT = "#7A7A85";
const LINE = "#ECECF0";
const ORANGE = "#FF5A00";
const GREEN = "#21B95B";
const SPLASH_MS = 3000;
const button = { border: 0, borderRadius: 18, padding: "16px 18px", font: "inherit", fontWeight: 600, cursor: "pointer", width: "100%" };

function fmtArs(n) {
  return Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtUsdc(n) {
  return Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function IconChevron({ open }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s ease" }}>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconCheck({ size = 40, strokeWidth = 2.8 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 12.5l5 5L19 7" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconExternal({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M14 5h5v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 14L19 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconSpinner({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.6" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.75s" repeatCount="indefinite" />
      </path>
    </svg>
  );
}

function isDelivered(charge) {
  return charge?.status === "delivered" || charge?.settled === true;
}

export default function ChargeSummary({ charge, qr, busy, onCancel, onReset, errorMessage, now, onSplashChange }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [splash, setSplash] = useState(true);
  const received = paymentReceived(charge);
  const delivered = isDelivered(charge);
  const processing = received && !delivered;
  const creating = charge.status === "creating";
  const awaitingLive =
    charge.status === "awaiting_payment" &&
    new Date(charge.expiresAt).getTime() > (now ?? Date.now());
  const showQr = Boolean(qr) && !delivered && (awaitingLive || processing);
  const expired =
    !received &&
    charge.expiresAt &&
    new Date(charge.expiresAt).getTime() <= (now ?? Date.now()) &&
    ["awaiting_payment", "expired"].includes(charge.status);

  const showCancel = !received && ["creating", "awaiting_payment"].includes(charge.status);
  const showNew = canStartNewCharge(charge) && !processing;
  const explorerUrl = charge.signature ? explorerTxUrl(charge.signature) : null;

  useEffect(() => {
    if (!delivered) {
      setSplash(true);
      setDetailsOpen(false);
      return undefined;
    }
    setSplash(true);
    const timer = setTimeout(() => setSplash(false), SPLASH_MS);
    return () => clearTimeout(timer);
  }, [delivered, charge?.id]);

  useEffect(() => {
    onSplashChange?.(delivered && splash);
  }, [delivered, splash, onSplashChange]);

  if (delivered && splash) {
    return (
      <div
        className="mp-overlay"
        style={{ background: GREEN, flexDirection: "column" }}
        role="status"
        aria-label="Cobro exitoso"
      >
        <div
          style={{
            width: 88,
            height: 88,
            borderRadius: "50%",
            background: "#fff",
            color: GREEN,
            display: "grid",
            placeItems: "center",
          }}
        >
          <IconCheck size={44} />
        </div>
      </div>
    );
  }

  if (delivered) {
    const amountRow = (logo, label, value) => (
      <div style={{ display: "flex", alignItems: "center", gap: 14, textAlign: "left" }}>
        <img
          src={logo}
          alt=""
          width={34}
          height={34}
          style={{ width: 34, height: 34, borderRadius: "50%", objectFit: "cover", display: "block", flexShrink: 0 }}
        />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: MUT, marginBottom: 3 }}>{label}</div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: INK,
              letterSpacing: -0.3,
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1.2,
            }}
          >
            {value}
          </div>
        </div>
      </div>
    );

    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          minHeight: 0,
          gap: 0,
        }}
      >
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            gap: 16,
            padding: "4px 2px 12px",
          }}
        >
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: "50%",
              background: GREEN,
              color: "#fff",
              display: "grid",
              placeItems: "center",
              boxShadow: "0 10px 28px rgba(33,185,91,0.35)",
            }}
          >
            <IconCheck size={34} strokeWidth={2.6} />
          </div>

          <div>
            <div style={{ fontSize: 26, fontWeight: 700, color: INK, letterSpacing: -0.45 }}>
              Cobro exitoso
            </div>
            <div style={{ marginTop: 8, fontSize: 14, fontWeight: 500, color: MUT, lineHeight: 1.35 }}>
              El dinero ya está en tu cuenta.
            </div>
          </div>

          <div
            style={{
              width: "100%",
              maxWidth: 340,
              marginTop: 4,
              padding: "16px 16px",
              borderRadius: 18,
              border: `1px solid ${LINE}`,
              background: "#fff",
              boxShadow: "0 8px 24px rgba(22,22,26,0.04)",
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            {amountRow("/monedas/ars.png", "Cobraste", `$ ${fmtArs(charge.ars)} ARS`)}
            <div style={{ height: 1, background: LINE }} />
            {amountRow("/monedas/usdc.png", "Recibiste", `${fmtUsdc(charge.usdc)} USDC`)}
          </div>

          <button
            type="button"
            onClick={() => setDetailsOpen((v) => !v)}
            aria-expanded={detailsOpen}
            style={{
              border: 0,
              background: "transparent",
              color: MUT,
              font: "inherit",
              fontSize: 13,
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              cursor: "pointer",
              padding: "6px 8px",
              marginTop: 2,
            }}
          >
            {detailsOpen ? "Ocultar detalles" : "Ver detalles"}
            <IconChevron open={detailsOpen} />
          </button>

          {detailsOpen && (
            <div
              style={{
                width: "100%",
                maxWidth: 340,
                display: "flex",
                flexDirection: "column",
                gap: 10,
                padding: "12px 14px",
                borderRadius: 14,
                background: "#FAFAFB",
                border: `1px solid ${LINE}`,
                textAlign: "left",
                fontSize: 12.5,
                color: MUT,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span>Comisión</span>
                <span style={{ color: INK, fontWeight: 600 }}>$ {fmtArs(charge.feeArs)} ARS</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span>Tipo de cambio</span>
                <span style={{ color: INK, fontWeight: 600 }}>$ {fmtArs(charge.fxRate)} / USDC</span>
              </div>
              {explorerUrl ? (
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    textDecoration: "none",
                    color: INK,
                    fontSize: 13,
                    fontWeight: 600,
                    paddingTop: 4,
                    borderTop: `1px solid ${LINE}`,
                  }}
                >
                  <span>Ver onchain</span>
                  <span style={{ color: ORANGE, display: "grid", placeItems: "center" }}>
                    <IconExternal />
                  </span>
                </a>
              ) : (
                <div style={{ fontSize: 13, color: MUT, paddingTop: 4, borderTop: `1px solid ${LINE}` }}>
                  La firma onchain todavía no está disponible.
                </div>
              )}
            </div>
          )}
        </div>

        {showNew && (
          <button
            type="button"
            disabled={busy}
            onClick={onReset}
            style={{
              ...button,
              background: ORANGE,
              color: "#fff",
              opacity: busy ? 0.6 : 1,
              flexShrink: 0,
              boxShadow: busy ? "none" : "0 8px 20px rgba(255,90,0,0.28)",
            }}
          >
            Cobrar de nuevo
          </button>
        )}
      </div>
    );
  }

  const title = showQr || creating || processing
    ? "Escanear y pagar"
    : expired
      ? "QR vencido"
      : charge.status === "refunded"
        ? "Reembolsado"
        : charge.status === "manual_review" && !received
          ? "En revisión"
          : "Actualizando…";

  const qrSize = detailsOpen ? 148 : 236;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        gap: 0,
      }}
    >
      <div style={{ flexShrink: 0, textAlign: "center", paddingTop: 2 }}>
        <div aria-live="polite" style={{ fontSize: 18, fontWeight: 700, color: INK, letterSpacing: -0.3 }}>
          {title}
        </div>
        <div
          style={{
            marginTop: 10,
            fontSize: detailsOpen ? 32 : 36,
            fontWeight: 700,
            letterSpacing: -1.1,
            color: INK,
            lineHeight: 1.05,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <span style={{ fontSize: "0.55em", fontWeight: 600, marginRight: 4, verticalAlign: "super" }}>$</span>
          {fmtArs(charge.ars)}
        </div>
        <div style={{ marginTop: 4, fontSize: 12, fontWeight: 600, color: MUT }}>ARS</div>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "10px 0 6px",
          gap: 10,
        }}
      >
        {showQr && (
          <img
            src={qr}
            width={qrSize}
            height={qrSize}
            alt="QR de pago"
            style={{
              display: "block",
              width: qrSize,
              height: qrSize,
              maxWidth: "100%",
              objectFit: "contain",
              transition: "width .18s ease, height .18s ease",
            }}
          />
        )}

        {creating && !showQr && (
          <div
            className="mp-qr-skeleton"
            role="status"
            aria-label="Cargando QR"
            style={{
              width: qrSize,
              height: qrSize,
              borderRadius: 16,
              maxWidth: "100%",
            }}
          />
        )}

        {!showQr && !creating && expired && (
          <div style={{ fontSize: 14, color: "#E4483D", fontWeight: 600 }}>Este QR ya no está vigente</div>
        )}

        {(showQr || creating) && (
          <>
            <button
              type="button"
              onClick={() => setDetailsOpen((v) => !v)}
              aria-expanded={detailsOpen}
              style={{
                border: 0,
                background: "transparent",
                color: MUT,
                font: "inherit",
                fontSize: 13,
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                cursor: "pointer",
                padding: "4px 8px",
              }}
            >
              {detailsOpen ? "Ocultar detalles" : "Ver detalles"}
              <IconChevron open={detailsOpen} />
            </button>

            {detailsOpen && (
              <div
                style={{
                  width: "100%",
                  display: "flex",
                  flexDirection: "column",
                  gap: 7,
                  padding: "10px 12px",
                  borderRadius: 14,
                  background: "#FAFAFB",
                  border: `1px solid ${LINE}`,
                  fontSize: 12.5,
                  color: MUT,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <span>Comisión</span>
                  <span style={{ color: INK, fontWeight: 600 }}>$ {fmtArs(charge.feeArs)} ARS</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <span>Tipo de cambio</span>
                  <span style={{ color: INK, fontWeight: 600 }}>$ {fmtArs(charge.fxRate)} / USDC</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <span>Vas a recibir</span>
                  <span style={{ color: INK, fontWeight: 700 }}>{fmtUsdc(charge.usdc)} USDC</span>
                </div>
                {charge.expiresAt && (
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, paddingTop: 4, borderTop: `1px solid ${LINE}` }}>
                    <span>Vence</span>
                    <span style={{ color: expired ? "#E4483D" : INK, fontWeight: 600 }}>
                      {new Date(charge.expiresAt).toLocaleString("es-AR", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {charge.lastError && !received && (
          <div role="status" style={{ fontSize: 13, color: "#E4483D", textAlign: "center" }}>
            {errorMessage}
          </div>
        )}
      </div>

      <div style={{ flexShrink: 0, paddingTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
        {processing && (
          <button
            type="button"
            disabled
            aria-busy="true"
            style={{
              ...button,
              background: "#F4F4F6",
              color: INK,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              cursor: "default",
              opacity: 1,
            }}
          >
            <IconSpinner />
            Procesando pago
          </button>
        )}
        {showCancel && (
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            aria-busy={busy || undefined}
            style={{
              ...button,
              background: "#F4F4F6",
              color: INK,
              opacity: busy ? 0.85 : 1,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              cursor: busy ? "default" : "pointer",
            }}
          >
            {busy ? (
              <>
                <IconSpinner />
                Cancelando…
              </>
            ) : (
              "Cancelar cobro"
            )}
          </button>
        )}
        {showNew && (
          <button
            type="button"
            disabled={busy}
            onClick={onReset}
            style={{ ...button, background: ORANGE, color: "white", opacity: busy ? 0.6 : 1 }}
          >
            Cobrar de nuevo
          </button>
        )}
      </div>
    </div>
  );
}
