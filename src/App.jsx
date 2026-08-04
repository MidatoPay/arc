import { useState, useEffect, useCallback, useMemo } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { ethers } from "ethers";
import { createPublicClient, http } from "viem";
import { ARC, RPC_PROXY, arcTestnet } from "./chain.js";
import { useContacts } from "./hooks/useContacts.js";
import BalanceCard from "./components/BalanceCard.jsx";
import VoiceFab from "./components/VoiceFab.jsx";
import BottomNav from "./components/BottomNav.jsx";
import ContactsScreen from "./components/ContactsScreen.jsx";
import ChargeSheet from "./components/ChargeSheet.jsx";

// ————————————————————————————————————————————————
// MidatoPay × Arc — Pagos por voz
// Login con email o teléfono (Privy) → wallet embebida.
// Transferencias reales de USDC en Arc Testnet (chain 5042002).
// ————————————————————————————————————————————————

const readProvider = new ethers.JsonRpcProvider(RPC_PROXY, ARC.chainId, {
  staticNetwork: true,
  batchMaxCount: 1,
});
readProvider.pollingInterval = 8000;

async function withRetry(fn, tries = 4) {
  let wait = 1200;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      const m = String(e?.message || e);
      const limited = m.includes("limit reached") || m.includes("-32011") || m.includes("429");
      if (!limited || i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, wait));
      wait *= 2;
    }
  }
}

// ————— design tokens (MidatoPay) —————
const C = {
  bg: "#F4F4F6",
  card: "#FFFFFF",
  ink: "#16161A",
  mut: "#7A7A85",
  line: "#ECECF0",
  orange: "#FF5A00",
  orangeSoft: "#FFEADF",
  violet: "#5C4CC7",
  violetSoft: "#ECEAFA",
  green: "#21B95B",
  red: "#E4483D",
};

const FX_ARS_USD = 1448; // tipo de cambio de referencia (off-chain)

const STACK = [
  { on: true, name: "Arc L1 (testnet)", role: "Cadena de liquidación de esta demo. Chain ID 5042002, finalidad sub-segundo.", by: "Circle" },
  { on: true, name: "USDC nativo", role: "Gas y activo de pago en uno: cada envío de esta app es USDC nativo on-chain.", by: "Circle" },
  { on: true, name: "Referencia on-chain", role: "Cada cobro lleva su número de factura adjunto. Conciliación sin base de datos externa.", by: "Arc" },
  { on: true, name: "Privy", role: "El login de esta app: email o teléfono → wallet embebida. Sin frases de recuperación.", by: "Ecosistema Arc" },
  { on: true, name: "ArcScan", role: "Cada pago es verificable en testnet.arcscan.app, con su referencia incluida.", by: "Ecosistema Arc" },
  { on: true, name: "Faucet Circle", role: "Fondeo de USDC testnet desde faucet.circle.com.", by: "Circle" },
  { on: false, name: "Memo contract", role: "Migrar la referencia a eventos Memo indexados para analítica y conciliación masiva.", by: "Arc" },
  { on: false, name: "Gateway / CCTP v2", role: "USDC crosschain: entrada desde Solana o Base, liquidación en Arc.", by: "Circle" },
  { on: false, name: "Oráculo FX", role: "Hoy el tipo de cambio ARS/USD es de referencia off-chain. Evaluando Stork y RedStone.", by: "Ecosistema Arc" },
  { on: false, name: "StableFX / EURC", role: "Corredor multi-moneda con el motor FX de Arc para cobros en euros.", by: "Circle" },
  { on: false, name: "Aave", role: "Rendimiento sobre el float de tesorería en USDC.", by: "Ecosistema Arc" },
  { on: false, name: "Avenia", role: "Rampas LATAM (PIX y rieles locales) para expansión a Brasil.", by: "Ecosistema Arc" },
];

// ————— util —————
const fmt = (n, d = 2) => Number(n).toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmt0 = (n) => Number(n).toLocaleString("es-AR", { maximumFractionDigits: 0 });
const short = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "—");

function nuevaFactura() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `${ymd}-${Math.floor(Math.random() * 9000 + 1000)}`;
}

function armarMemo({ factura, alias, currency, amount }) {
  return `MIDATO|v1|inv:${factura}|to:${alias}|cur:${currency}|amt:${amount}`;
}

// ————— primitivos de UI —————
function Card({ children, style, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: C.card,
        borderRadius: 22,
        padding: 20,
        boxShadow: "0 1px 3px rgba(20,20,30,.05), 0 8px 24px rgba(20,20,30,.04)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

const btnOrange = {
  background: C.orange,
  color: "#fff",
  border: "none",
  borderRadius: 14,
  padding: "16px 20px",
  fontSize: 16,
  fontWeight: 700,
  cursor: "pointer",
  width: "100%",
  fontFamily: "inherit",
};
const btnOutline = {
  background: "transparent",
  color: C.orange,
  border: `1.5px solid ${C.orange}`,
  borderRadius: 14,
  padding: "16px 20px",
  fontSize: 16,
  fontWeight: 700,
  cursor: "pointer",
  width: "100%",
  fontFamily: "inherit",
};

// ————— Marca —————
function Mark({ size = 44, style }) {
  return (
    <img
      src="/logo.png"
      alt="MidatoPay"
      width={size}
      height={size}
      style={{ display: "block", width: size, height: size, ...style }}
    />
  );
}

function Wordmark({ size = 30 }) {
  return (
    <div style={{ fontSize: size, fontWeight: 700, letterSpacing: -0.6, color: "#6A6A72", lineHeight: 1 }}>
      Midato<span style={{ color: C.orange }}>Pay</span>
    </div>
  );
}

function Logo({ size = 44 }) {
  return <Mark size={size} />;
}

// ————— Login —————
function Login({ onLogin, ready }) {
  return (
    <div className="mp-stage">
      <div className="mp-device" style={{ background: C.card }}>
        <div className="mp-scroll" style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: "32px 26px", gap: 30 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
            <Mark size={104} />
            <Wordmark size={30} />
          </div>

          <div style={{ textAlign: "center" }}>
            <h1 style={{ fontSize: 23, fontWeight: 700, letterSpacing: -0.4, margin: 0, color: C.ink, lineHeight: 1.3 }}>
              Cobrá en dólares<br />sin saber de cripto
            </h1>
            <p style={{ fontSize: 14.5, color: C.mut, marginTop: 10, lineHeight: 1.55 }}>
              Entrá con tu email o tu teléfono. Tu cuenta se crea sola.
            </p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button onClick={onLogin} disabled={!ready} style={{ ...btnOrange, opacity: ready ? 1 : 0.5 }}>
              {ready ? "Iniciar sesión" : "Cargando…"}
            </button>
            <button onClick={onLogin} disabled={!ready} style={{ ...btnOutline, opacity: ready ? 1 : 0.5 }}>
              Crear cuenta
            </button>
            <p style={{ fontSize: 11, color: C.mut, textAlign: "center", marginTop: 4 }}>
              Arc Testnet · fondos de prueba sin valor
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ————— Inicio —————
function Home({ nombre, address, balance, refreshing, onRefresh, txs }) {
  const [copied, setCopied] = useState(false);
  const ars = balance === null ? null : balance * FX_ARS_USD;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Logo />
        <div style={{ fontSize: 21, fontWeight: 700, color: C.ink, flex: 1 }}>Hola, {nombre}</div>
        <button onClick={onRefresh} style={{ width: 42, height: 42, borderRadius: "50%", background: C.orangeSoft, border: "none", cursor: "pointer", color: C.orange, fontSize: 17 }}>
          {refreshing ? "·" : "↻"}
        </button>
      </div>

      <BalanceCard balanceArs={ars} currency="ARS" />

      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: C.ink }}>Fondos</span>
          <a href={`${ARC.explorer}/address/${address}`} target="_blank" rel="noreferrer" style={{ fontSize: 12, fontWeight: 700, color: C.orange, background: C.orangeSoft, padding: "5px 12px", borderRadius: 20, textDecoration: "none" }}>
            Ver todo
          </a>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 38, height: 38, borderRadius: "50%", background: "#2775CA", display: "grid", placeItems: "center", color: "#fff", fontWeight: 700, fontSize: 15 }}>$</div>
          <div style={{ flex: 1, fontSize: 17, fontWeight: 700, color: C.ink }}>USDC</div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: C.ink }}>{ars === null ? "—" : `$${fmt0(ars)}`}</div>
            <div style={{ fontSize: 14, color: C.mut }}>{balance === null ? "" : `${fmt(balance)} USDC`}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.line}` }}>
          <span style={{ color: C.violet, fontSize: 14 }}>ⓘ</span>
          <span style={{ fontSize: 13.5, color: C.violet, flex: 1 }}>Tu dinero se encuentra en activos digitales.</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 12.5, color: C.mut }}>
          <span style={{ fontFamily: "ui-monospace, monospace" }}>{short(address)}</span>
          <button onClick={copy} style={{ background: C.bg, border: "none", borderRadius: 20, padding: "4px 12px", fontSize: 12, fontWeight: 600, color: C.ink, cursor: "pointer", fontFamily: "inherit" }}>
            {copied ? "copiada ✓" : "copiar"}
          </button>
        </div>
      </Card>

      {balance !== null && balance < 0.5 && (
        <Card style={{ background: "#16161A", color: "#fff" }}>
          <div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.35 }}>Cargá saldo de prueba para empezar</div>
          <div style={{ fontSize: 13.5, opacity: 0.75, marginTop: 8, lineHeight: 1.5 }}>
            Copiá tu dirección y pedí USDC en el faucet de Circle eligiendo Arc Testnet.
          </div>
          <a href={ARC.faucet} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 16, background: C.orange, color: "#fff", padding: "11px 22px", borderRadius: 12, fontSize: 14.5, fontWeight: 700, textDecoration: "none" }}>
            Ir al faucet
          </a>
        </Card>
      )}

      <div style={{ fontSize: 17, fontWeight: 700, color: C.ink, marginTop: 4 }}>Actividad</div>
      {txs.length === 0 ? (
        <Card style={{ fontSize: 14, color: C.mut, lineHeight: 1.55 }}>
          Todavía no hay movimientos. Probá un pago por voz — cada envío queda registrado en Arc Testnet con su factura.
        </Card>
      ) : (
        txs.map((tx) => (
          <Card key={tx.hash} style={{ padding: 16, display: "flex", alignItems: "center", gap: 13 }}>
            <div style={{ width: 42, height: 42, borderRadius: "50%", background: C.violetSoft, display: "grid", placeItems: "center", color: C.violet, fontSize: 17 }}>↑</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15.5, fontWeight: 600, color: C.ink }}>{tx.who}</div>
              <a href={`${ARC.explorer}/tx/${tx.hash}`} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: C.mut, textDecoration: "none" }}>
                Factura {tx.factura} · ver ↗
              </a>
            </div>
            <div style={{ fontSize: 15.5, fontWeight: 700, color: C.ink }}>−{fmt(tx.amt)}</div>
          </Card>
        ))
      )}
    </div>
  );
}

// ————— Éxito a pantalla completa —————
function Success({ receipt, onClose }) {
  const [detalle, setDetalle] = useState(false);
  const [splash, setSplash] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setSplash(false), 1800);
    return () => clearTimeout(t);
  }, []);

  if (splash) {
    return (
      <div className="mp-overlay" style={{ background: C.green, flexDirection: "column", gap: 24 }}>
        <div style={{ fontSize: 30, fontWeight: 700, color: "#fff", textAlign: "center", padding: "0 24px" }}>¡Pago enviado!</div>
        <div style={{ width: 74, height: 74, borderRadius: "50%", background: "#fff", display: "grid", placeItems: "center", color: C.green, fontSize: 38 }}>✓</div>
      </div>
    );
  }

  const p = receipt.parsed;
  const ini = (p.contact.ini || p.contact.name || "?").slice(0, 1).toUpperCase();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
        <div style={{ width: 44, height: 44, borderRadius: "50%", background: C.green, display: "grid", placeItems: "center", color: "#fff", fontSize: 22 }}>✓</div>
        <div style={{ fontSize: 26, fontWeight: 700, color: C.ink }}>¡Hecho!</div>
      </div>

      <Card>
        <div style={{ fontSize: 18, fontWeight: 700, color: C.ink, lineHeight: 1.35 }}>
          Enviaste {fmt(p.usdc)} USDC a {p.contact.name}
        </div>
        <button
          onClick={() => setDetalle(!detalle)}
          style={{ background: C.violetSoft, color: C.violet, border: "none", borderRadius: 20, padding: "6px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", marginTop: 12, fontFamily: "inherit" }}
        >
          Ver detalle {detalle ? "⌃" : "⌄"}
        </button>

        {detalle && (
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: C.ink, marginBottom: 14 }}>Operación:</div>
            <div style={{ display: "grid", gap: 10, fontSize: 14.5 }}>
              {[
                ["Monto enviado", `${fmt(p.usdc)} USDC`],
                ["Equivale a", `$${fmt0(p.usdc * FX_ARS_USD)} ARS`],
                ["Tipo de cambio", `1 USDC = $${fmt0(FX_ARS_USD)}`],
                ["Fee de red", receipt.fee ? `${Number(receipt.fee).toFixed(6)} USDC` : "—"],
                receipt.block ? ["Bloque", String(receipt.block)] : null,
                ["Hora", receipt.ts],
              ].filter(Boolean).map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: C.mut }}>{k}:</span>
                  <span style={{ color: C.ink, fontWeight: 600 }}>{v}</span>
                </div>
              ))}
            </div>
            <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 16, paddingTop: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14.5 }}>
                <span style={{ color: C.mut }}>Factura:</span>
                <span style={{ color: C.green, fontWeight: 700 }}>{receipt.factura} · on-chain ✓</span>
              </div>
              <a href={`${ARC.explorer}/tx/${receipt.hash}`} target="_blank" rel="noreferrer" style={{ display: "block", marginTop: 12, fontSize: 13.5, color: C.violet, fontWeight: 600, textDecoration: "none", wordBreak: "break-all" }}>
                {short(receipt.hash)} — ver en ArcScan ↗
              </a>
              <div style={{ fontSize: 12, color: C.mut, marginTop: 8, lineHeight: 1.5 }}>
                En ArcScan abrí <b>Input Data</b> y pasalo a UTF-8: ahí está la referencia completa del cobro.
              </div>
            </div>
          </div>
        )}
      </Card>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <button onClick={onClose} style={btnOrange}>Listo</button>
      </div>
    </div>
  );
}

// ————— Movimientos —————
function Movimientos({ txs, address }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <h2 style={{ fontSize: 26, fontWeight: 700, color: C.ink, margin: 0, letterSpacing: -0.4 }}>Movimientos</h2>
        <p style={{ fontSize: 14.5, color: C.mut, marginTop: 6 }}>
          {txs.length === 0 ? "Todavía no hay pagos en esta sesión." : `${txs.length} ${txs.length === 1 ? "pago" : "pagos"} en esta sesión`}
        </p>
      </div>

      {txs.length === 0 ? (
        <Card style={{ fontSize: 14, color: C.mut, lineHeight: 1.55 }}>
          Cada pago por voz queda registrado en Arc Testnet con su número de factura. Vas a verlos acá con el link al explorador.
        </Card>
      ) : (
        txs.map((tx) => (
          <Card key={tx.hash} style={{ padding: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
              <div style={{ width: 42, height: 42, borderRadius: "50%", background: C.violetSoft, display: "grid", placeItems: "center", color: C.violet, fontSize: 17 }}>↑</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15.5, fontWeight: 700, color: C.ink }}>{tx.who}</div>
                <div style={{ fontSize: 13, color: C.mut }}>Pago por voz</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 15.5, fontWeight: 700, color: C.ink }}>−{fmt(tx.amt)}</div>
                <div style={{ fontSize: 12.5, color: C.mut }}>USDC</div>
              </div>
            </div>
            <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 14, paddingTop: 12, display: "grid", gap: 7, fontSize: 13.5 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: C.mut }}>Factura:</span>
                <span style={{ color: C.green, fontWeight: 700 }}>{tx.factura} · on-chain ✓</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: C.mut }}>Equivale a:</span>
                <span style={{ color: C.ink, fontWeight: 600 }}>${fmt0(tx.amt * FX_ARS_USD)} ARS</span>
              </div>
            </div>
            <a href={`${ARC.explorer}/tx/${tx.hash}`} target="_blank" rel="noreferrer" style={{ display: "block", marginTop: 12, fontSize: 13.5, color: C.violet, fontWeight: 600, textDecoration: "none" }}>
              {short(tx.hash)} — ver en ArcScan ↗
            </a>
          </Card>
        ))
      )}

      <a href={`${ARC.explorer}/address/${address}`} target="_blank" rel="noreferrer" style={{ ...btnOutline, textDecoration: "none", textAlign: "center", display: "block", border: `1.5px solid ${C.line}`, color: C.ink }}>
        Ver historial completo en ArcScan
      </a>
    </div>
  );
}

// ————— Más (menú) —————
function Mas({ email, address, nombre, onLogout, goStack }) {
  const [confirmar, setConfirmar] = useState(false);

  const Fila = ({ icon, titulo, sub, onClick, href, danger }) => {
    const inner = (
      <>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: danger ? "#FDECEA" : C.bg, display: "grid", placeItems: "center", fontSize: 17, color: danger ? C.red : C.ink }}>
          {icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15.5, fontWeight: 600, color: danger ? C.red : C.ink }}>{titulo}</div>
          {sub && <div style={{ fontSize: 12.5, color: C.mut, marginTop: 1 }}>{sub}</div>}
        </div>
        <span style={{ color: C.mut, fontSize: 17 }}>›</span>
      </>
    );
    const style = { display: "flex", alignItems: "center", gap: 13, padding: "14px 0", background: "none", border: "none", width: "100%", cursor: "pointer", textAlign: "left", fontFamily: "inherit", textDecoration: "none" };
    return href ? (
      <a href={href} target="_blank" rel="noreferrer" style={style}>{inner}</a>
    ) : (
      <button onClick={onClick} style={style}>{inner}</button>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 style={{ fontSize: 26, fontWeight: 700, color: C.ink, margin: 0, letterSpacing: -0.4 }}>Más</h2>

      <Card style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ width: 52, height: 52, borderRadius: "50%", background: C.orangeSoft, display: "grid", placeItems: "center", color: C.orange, fontSize: 20, fontWeight: 700 }}>
          {(nombre || "?").slice(0, 1).toUpperCase()}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: C.ink }}>{nombre}</div>
          <div style={{ fontSize: 13, color: C.mut, overflow: "hidden", textOverflow: "ellipsis" }}>{email || "Cuenta sin email"}</div>
          <div style={{ fontSize: 12, color: C.mut, fontFamily: "ui-monospace, monospace", marginTop: 2 }}>{short(address)}</div>
        </div>
      </Card>

      <Card style={{ padding: "4px 20px" }}>
        <Fila icon="◫" titulo="Stack Arc" sub="Qué está implementado y qué falta" onClick={goStack} />
        <div style={{ height: 1, background: C.line }} />
        <Fila icon="⛽" titulo="Fondear con el faucet" sub="USDC de prueba en Arc Testnet" href={ARC.faucet} />
        <div style={{ height: 1, background: C.line }} />
        <Fila icon="🔎" titulo="Ver mi cuenta en ArcScan" sub="Explorador público de Arc" href={`${ARC.explorer}/address/${address}`} />
      </Card>

      <Card style={{ padding: "4px 20px" }}>
        <Fila icon="⏻" titulo="Cerrar sesión" danger onClick={() => setConfirmar(true)} />
      </Card>

      <p style={{ fontSize: 11.5, color: C.mut, textAlign: "center", lineHeight: 1.6 }}>
        MidatoPay × Arc · demo sobre Arc Testnet<br />Fondos de prueba sin valor real
      </p>

      {confirmar && (
        <div className="mp-overlay" style={{ background: "rgba(16,16,22,.45)", alignItems: "flex-end" }} onClick={() => setConfirmar(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: C.card, borderRadius: "24px 24px 0 0", padding: "26px 22px 30px", width: "100%" }}
          >
            <div style={{ width: 42, height: 4, borderRadius: 4, background: C.line, margin: "0 auto 20px" }} />
            <div style={{ fontSize: 19, fontWeight: 700, color: C.ink }}>¿Cerrar sesión?</div>
            <div style={{ fontSize: 14.5, color: C.mut, marginTop: 8, lineHeight: 1.5 }}>
              Vas a volver a la pantalla de inicio. Podés entrar de nuevo con el mismo email o teléfono y tu cuenta sigue igual.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 22 }}>
              <button onClick={onLogout} style={{ ...btnOrange, background: C.red }}>Cerrar sesión</button>
              <button onClick={() => setConfirmar(false)} style={{ ...btnOutline, border: `1.5px solid ${C.line}`, color: C.ink }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ————— Stack —————
function Stack() {
  const activos = STACK.filter((s) => s.on);
  const road = STACK.filter((s) => !s.on);

  const Item = ({ s }) => (
    <Card style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.on ? C.green : C.line, flexShrink: 0 }} />
        <span style={{ fontSize: 15.5, fontWeight: 700, color: C.ink }}>{s.name}</span>
        <span style={{ marginLeft: "auto", fontSize: 11.5, color: C.mut }}>{s.by}</span>
      </div>
      <div style={{ fontSize: 13.5, color: C.mut, lineHeight: 1.5 }}>{s.role}</div>
    </Card>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <h2 style={{ fontSize: 26, fontWeight: 700, color: C.ink, margin: 0, letterSpacing: -0.4 }}>Stack Arc</h2>
        <p style={{ fontSize: 14.5, color: C.mut, marginTop: 6, lineHeight: 1.5 }}>
          Lo verde está implementado y funcionando en esta demo. Lo gris todavía no: lo listamos para ser explícitos sobre qué falta.
        </p>
      </div>

      <div style={{ fontSize: 13, fontWeight: 700, color: C.green, marginTop: 4 }}>IMPLEMENTADO</div>
      {activos.map((s) => <Item key={s.name} s={s} />)}

      <div style={{ fontSize: 13, fontWeight: 700, color: C.mut, marginTop: 10 }}>ROADMAP</div>
      {road.map((s) => <Item key={s.name} s={s} />)}
    </div>
  );
}

// ————— App —————
export default function App() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const contactsApi = useContacts();
  const { contacts } = contactsApi;
  const [view, setView] = useState("inicio");
  const [balance, setBalance] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [txs, setTxs] = useState([]);
  const [receipt, setReceipt] = useState(null);
  const [charge, setCharge] = useState(null);

  const wallet = useMemo(() => wallets.find((w) => w.walletClientType === "privy") || wallets[0], [wallets]);
  const address = wallet?.address || "";
  const email = user?.email?.address || user?.phone?.number || "";
  const nombre = email ? email.split("@")[0].split(/[.\-_]/)[0].replace(/^./, (c) => c.toUpperCase()) : "👋";

  const publicClient = useMemo(
    () => createPublicClient({ chain: arcTestnet, transport: http() }),
    []
  );

  const refreshBalance = useCallback(async () => {
    if (!address) return;
    setRefreshing(true);
    try {
      const b = await withRetry(() => readProvider.getBalance(address));
      setBalance(Number(ethers.formatEther(b)));
    } catch {
      /* el RPC puede limitar consultas */
    } finally {
      setRefreshing(false);
    }
  }, [address]);

  useEffect(() => {
    if (!address) return;
    refreshBalance();
    const id = setInterval(refreshBalance, 45000);
    return () => clearInterval(id);
  }, [address, refreshBalance]);

  const sendPayment = useCallback(
    async (parsed) => {
      if (!wallet) throw new Error("No hay wallet disponible.");
      await wallet.switchChain(ARC.chainId);
      const eip1193 = await wallet.getEthereumProvider();
      const browserProvider = new ethers.BrowserProvider(eip1193, ARC.chainId);
      const signer = await browserProvider.getSigner();
      const memo = armarMemo({ factura: parsed.factura, alias: parsed.contact.alias, currency: parsed.currency, amount: parsed.amount });
      const tx = await withRetry(() =>
        signer.sendTransaction({
          to: parsed.contact.addr,
          value: ethers.parseEther(parsed.usdc.toFixed(6)),
          data: ethers.hexlify(ethers.toUtf8Bytes(memo)),
        })
      );
      let block = null;
      let fee = null;
      try {
        const rec = await withRetry(() => readProvider.waitForTransaction(tx.hash, 1, 30000));
        if (rec) {
          block = rec.blockNumber;
          if (rec.gasUsed && rec.gasPrice) fee = ethers.formatEther(rec.gasUsed * rec.gasPrice);
        }
      } catch {
        /* la tx ya se envió */
      }
      setTxs((t) => [{ hash: tx.hash, who: parsed.contact.name, amt: parsed.usdc, factura: parsed.factura }, ...t]);
      refreshBalance();
      return {
        hash: tx.hash, block, fee, memo, factura: parsed.factura,
        ts: new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }),
      };
    },
    [wallet, refreshBalance]
  );

  const handlePay = useCallback(
    async ({ to, amount, token, contact }) => {
      const usdc = token === "ARST" ? amount / FX_ARS_USD : amount;
      const parsed = {
        amount,
        currency: token === "ARST" ? "ARS" : "USDC",
        usdc,
        factura: nuevaFactura(),
        contact: {
          name: contact?.name || "Destinatario",
          addr: to,
          alias: contact?.aliases?.[0] || contact?.name || "",
        },
      };
      try {
        const r = await sendPayment(parsed);
        setReceipt({ ...r, parsed });
      } catch (err) {
        alert("El pago falló: " + String(err?.message || err).slice(0, 140));
      }
    },
    [sendPayment]
  );

  const handleCharge = useCallback((payload) => setCharge(payload), []);

  const shell = (children) => (
    <div className="mp-stage">
      <div className="mp-device">
        <div className="mp-scroll" style={{ padding: "22px 18px 136px" }}>{children}</div>

        <BottomNav active={view} onChange={(v) => { setReceipt(null); setView(v); }} />
        <VoiceFab contacts={contacts} onPay={handlePay} onCharge={handleCharge} />

        {charge && (
          <ChargeSheet
            myAddress={address}
            publicClient={publicClient}
            amount={charge.amount}
            token={charge.token}
            memo={charge.memo}
            counterparty={charge.contact}
            onClose={() => setCharge(null)}
          />
        )}
      </div>
    </div>
  );

  if (!ready || !authenticated) return <Login onLogin={login} ready={ready} />;

  if (!address) {
    return shell(
      <Card style={{ textAlign: "center", padding: 40, marginTop: 40 }}>
        <div style={{ fontSize: 17, fontWeight: 700 }}>Creando tu cuenta…</div>
        <div style={{ fontSize: 14, color: C.mut, marginTop: 8 }}>Esto tarda unos segundos la primera vez.</div>
      </Card>
    );
  }

  if (receipt) {
    return shell(<Success receipt={receipt} onClose={() => { setReceipt(null); setView("inicio"); }} />);
  }

  return shell(
    <>
      {view === "inicio" && (
        <Home nombre={nombre} address={address} balance={balance} refreshing={refreshing} onRefresh={refreshBalance} txs={txs} />
      )}
      {view === "movimientos" && <Movimientos txs={txs} address={address} />}
      {view === "agenda" && <ContactsScreen {...contactsApi} onPay={handlePay} onCharge={handleCharge} />}
      {view === "stack" && <Stack />}
      {view === "mas" && (
        <Mas
          email={email}
          address={address}
          nombre={nombre}
          onLogout={async () => { await logout(); setView("inicio"); setTxs([]); setBalance(null); }}
          goStack={() => setView("stack")}
        />
      )}
    </>
  );
}
