import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { ethers } from "ethers";
import { usePrivy, useWallets, useCreateWallet } from "@privy-io/react-auth";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { ARC } from "./chain.js";
import {
  armarMemo,
  estimateNativeUsdcTransfer,
  findIncomingTransfer,
  getBrowserSigner,
  getUsdcBalance,
  nuevaFactura,
  sendNativeUsdc,
} from "./arc.js";
import { FALLBACK_FX_ARS_USD, getArsPerUsdc, quoteArsToUsdc, quoteUsdcToArs, usdcToArs } from "./fx.js";
import {
  estimateConvertUsdcToArs,
  runConvertArsToUsdc,
  runConvertUsdcToArs,
  refreshPairBalances,
} from "./flows.js";
import { getTreasuryAddress, getTreasuryBalance, isTreasuryConfigured, sendTreasuryPayout } from "./treasury.js";
import { LanguageProvider, useLanguage, STACK_EN, STACK_ES } from "./i18n.jsx";
import {
  loadContacts,
  addContact,
  updateContact,
  removeContact,
  findByAlias,
  searchContacts,
  validateContact,
} from "./contacts.js";
import { loadTransactions, addTransaction, mergeByHash } from "./transactions.js";
import { buildPayUrl, parsePayUrl, slugifyAlias } from "./payQr.js";

// ————————————————————————————————————————————————
// MidatoPay × Arc — Pagos por voz
// Login con email o teléfono (Privy) → wallet embebida.
// Transferencias reales de USDC en Arc Testnet (chain 5042002).
// ————————————————————————————————————————————————

const API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY || "";

const arsStorageKey = (address) => `mp_ars_balance_${(address || "").toLowerCase()}`;

function loadArsBalance(address) {
  if (!address) return 0;
  try {
    const raw = localStorage.getItem(arsStorageKey(address));
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function persistArsBalance(address, amount) {
  if (!address) return;
  try {
    localStorage.setItem(arsStorageKey(address), String(Math.max(0, Number(amount) || 0)));
  } catch {
    /* ignore */
  }
}

// ————— design tokens (MidatoPay) —————
const C = {
  bg: "#F7F7F9",
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

/** Paleta del cliente externo (otra “app”, sin naranja MidatoPay). */
const G = {
  accent: "#5B4DB7",
  soft: "#EEEBF8",
  mid: "#7A6EC9",
  deep: "#4338A0",
};

// ————— util —————
const fmt = (n, d = 2, locale = "en-US") => Number(n).toLocaleString(locale, { minimumFractionDigits: d, maximumFractionDigits: d });
const fmt0 = (n, locale = "en-US") => Number(n).toLocaleString(locale, { maximumFractionDigits: 0 });
/** Montos ARS siempre en formato argentino: 32.940,00 */
const fmtArs = (n) =>
  Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const short = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "—");

/** USDC → ARS con cotización Chainlink (ARS por 1 USDC). Tolera saldo 0. */
function usdcBalanceToArs(usdcAmount, arsPerUsdc) {
  const usdc = Number(usdcAmount);
  const rate = Number(arsPerUsdc);
  if (!Number.isFinite(usdc) || usdc < 0) return null;
  if (!Number.isFinite(rate) || rate <= 0) return null;
  if (usdc === 0) return 0;
  try {
    return usdcToArs(usdc, rate);
  } catch {
    return null;
  }
}

function localParse(text, lang) {
  const t = text.toLowerCase();
  const intentRe = lang === "en" ? /(send|transfer|pay)/ : /(envi|mand|transfer|pag)/;
  if (!intentRe.test(t)) return { intent: "unknown" };
  const numMatch = t.replace(/\./g, "").match(/(\d+(?:[.,]\d+)?)/);
  const amount = numMatch ? parseFloat(numMatch[1].replace(",", ".")) : null;
  const currency = /peso|ars/.test(t) ? "ARS" : "USDC";
  let recipient = null;
  const recRe = lang === "en" ? /\bto\s+([a-záéíóúñ]+)/ : /\ba\s+([a-záéíóúñ]+)/;
  const m = t.match(recRe);
  if (m) recipient = m[1];
  return { intent: "send", amount, currency, recipient };
}

async function claudeParse(text, lang, aliases) {
  if (!API_KEY) throw new Error("no-key");
  const prompt =
    lang === "en"
      ? `You are MidatoPay's voice payment agent. Extract the intent from this English command and respond ONLY with valid JSON, no markdown or extra text.

Command: "${text}"

Valid contact aliases: ${aliases.join(", ")}

Exact format:
{"intent":"send"|"unknown","amount":<number or null>,"currency":"USDC"|"ARS","recipient":"<closest matching contact alias or null>","confidence":<0 to 1>}

Rules: "dollars", "usd" or "usdc" → USDC. "pesos" or "ars" → ARS. If the currency isn't stated or is unclear, default to USDC — never guess ARS. Match the alias even if misheard (e.g. "caty" → "katy").`
      : `Sos el agente de pagos por voz de MidatoPay. Extraé la intención de este comando en español rioplatense y respondé SOLO con JSON válido, sin markdown ni texto extra.

Comando: "${text}"

Contactos válidos (alias): ${aliases.join(", ")}

Formato exacto:
{"intent":"send"|"unknown","amount":<número o null>,"currency":"USDC"|"ARS","recipient":"<alias del contacto más parecido o null>","confidence":<0 a 1>}

Reglas: "dólares", "usd" o "usdc" → USDC. "pesos" o "ars" → ARS. Si la moneda no está clara o no se menciona, default a USDC — nunca asumas ARS. Matcheá el alias aunque esté mal transcripto (ej: "caty" → "katy").`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  const raw = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  return JSON.parse(raw.replace(/```json|```/g, "").trim());
}

// ————— primitivos de UI —————
function Card({ children, style, onClick, className }) {
  return (
    <div
      onClick={onClick}
      className={className}
      style={{
        background: C.bg,
        borderRadius: 22,
        padding: 20,
        boxShadow: "none",
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

function CircleAction({ icon, label, onClick, background }) {
  return (
    <button
      onClick={onClick}
      style={{ background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, flex: 1, fontFamily: "inherit", padding: 0 }}
    >
      <div
        style={{
          width: 58,
          height: 58,
          borderRadius: "50%",
          background: background || C.orange,
          display: "grid",
          placeItems: "center",
          color: "#fff",
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <span style={{ fontSize: 13.5, fontWeight: 600, color: C.mut }}>{label}</span>
    </button>
  );
}

const IconArrowDown = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M12 5v14M5 12l7 7 7-7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconArrowUp = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconSwap = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M7 8h14M17 4l4 4-4 4M17 16H3M7 20l-4-4 4-4" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconEye = ({ size = 22, crossed = false }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <path
      d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
    {crossed && <path d="M4 4l16 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
  </svg>
);

const IconMenuList = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M8 6h12M8 12h12M8 18h12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    <circle cx="4" cy="6" r="1.4" fill="currentColor" />
    <circle cx="4" cy="12" r="1.4" fill="currentColor" />
    <circle cx="4" cy="18" r="1.4" fill="currentColor" />
  </svg>
);

const IconArFlag = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    <circle cx="12" cy="12" r="12" fill="#74ACDF" />
    <rect x="0" y="8" width="24" height="8" fill="#fff" />
    <circle cx="12" cy="12" r="2.6" fill="#F6B40E" />
  </svg>
);

const IconHome = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5.2v-6.2H10.2V21H5a1 1 0 0 1-1-1v-9.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
  </svg>
);

const IconActivity = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M5 7h14M5 12h14M5 17h14" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
  </svg>
);

const IconStack = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <rect x="4" y="5" width="7" height="14" rx="1.6" stroke="currentColor" strokeWidth="1.8" />
    <rect x="13" y="5" width="7" height="14" rx="1.6" stroke="currentColor" strokeWidth="1.8" />
  </svg>
);

const IconContacts = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M7 4.5h11.5A1.5 1.5 0 0 1 20 6v12a1.5 1.5 0 0 1-1.5 1.5H7" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    <path d="M7 4.5A2.5 2.5 0 0 0 4.5 7v10A2.5 2.5 0 0 0 7 19.5" stroke="currentColor" strokeWidth="1.8" />
    <rect x="9.5" y="8" width="7" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.5" />
    <path d="M10.5 16.5h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const IconMic = ({ size = 26 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <rect x="9" y="3.5" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.9" />
    <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v3.5M9 20.5h6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
  </svg>
);

const IconFaucet = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M8 4h8M12 4v3M7 10h10a2 2 0 0 1 2 2v2H5v-2a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    <path d="M12 14v3.5a2.5 2.5 0 0 0 5 0V16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const IconSearch = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
    <path d="M16.5 16.5 21 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const IconGlobe = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
    <path d="M3 12h18M12 3c2.8 2.6 4.2 5.7 4.2 9s-1.4 6.4-4.2 9c-2.8-2.6-4.2-5.7-4.2-9S9.2 5.6 12 3Z" stroke="currentColor" strokeWidth="1.8" />
  </svg>
);

const IconLogout = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M14 8l4 4-4 4M18 12H9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconChevron = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconQrCode = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <rect x="3" y="3" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="2" />
    <rect x="14" y="3" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="2" />
    <rect x="3" y="14" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="2" />
    <path d="M14 14h3v3h-3zM19 14v3M14 19h3M17 19h3v3M19 21v-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconFlash = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M9 3.5h6l1.8 4.2H7.2L9 3.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    <rect x="8" y="7.5" width="8" height="11" rx="2" stroke="currentColor" strokeWidth="1.7" />
    <path d="M12 11.5v3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);

const IconCopy = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <rect x="8" y="8" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="2" />
    <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" stroke="currentColor" strokeWidth="2" />
  </svg>
);

const GRAD_COBRAR = "linear-gradient(180deg, #fe6c1c, #fe6c1c, #fe6c1c, #ffb58d, #ffb58d)";
const GRAD_CONVERTIR = "radial-gradient(circle at 0% 0%, #ffb58d, #fe6c1c, #fe6c1c, #ffb58d, #fe6c1c)";
const GRAD_PAGAR = "linear-gradient(180deg, #ffb58d, #ffb58d, #fe6c1c, #fe6c1c, #fe6c1c)";

function NavButton({ active, icon, label, onClick, accent = "#fe6c1c" }) {
  const glow = accent === "#fe6c1c" ? "rgba(254,108,28,.35)" : "rgba(91,77,183,.35)";
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        background: "none",
        border: "none",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        fontFamily: "inherit",
        padding: "4px 0 0",
        color: active ? accent : "#8A8A96",
        transition: "color .2s ease, transform .15s ease",
        transform: active ? "translateY(-1px)" : "none",
      }}
    >
      <span
        style={{
          display: "grid",
          placeItems: "center",
          width: 36,
          height: 28,
          filter: active ? `drop-shadow(0 4px 10px ${glow})` : "none",
        }}
      >
        {icon}
      </span>
      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.1 }}>{label}</span>
    </button>
  );
}

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

// ————— Selector de idioma —————
function LangToggle({ style }) {
  const { lang, setLang } = useLanguage();
  const pill = (id, label) => ({
    background: lang === id ? C.ink : "transparent",
    color: lang === id ? "#fff" : C.mut,
    border: "none",
    borderRadius: 20,
    padding: "6px 13px",
    fontSize: 12.5,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
  });
  return (
    <div style={{ display: "flex", gap: 4, background: C.bg, borderRadius: 22, padding: 3, ...style }}>
      <button onClick={() => setLang("en")} style={pill("en")} aria-pressed={lang === "en"}>
        EN
      </button>
      <button onClick={() => setLang("es")} style={pill("es")} aria-pressed={lang === "es"}>
        ES
      </button>
    </div>
  );
}

// ————— Login —————
function Login({ onLogin, ready }) {
  const { t } = useLanguage();
  return (
    <div className="mp-stage">
      <div className="mp-device" style={{ background: C.card }}>
        <div
          className="mp-scroll"
          style={{
            display: "flex",
            flexDirection: "column",
            height: "100%",
            padding: "22px 28px 28px",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              flexShrink: 0,
              marginBottom: 28,
            }}
          >
            <LangToggle />
          </div>

          <div style={{ textAlign: "center", flexShrink: 0 }}>
            <h1
              style={{
                fontSize: 28,
                fontWeight: 700,
                letterSpacing: -0.5,
                margin: 0,
                color: C.ink,
                lineHeight: 1.25,
              }}
            >
              {t("login.welcome")}{" "}
              <span style={{ color: "#6A6A72" }}>Midato</span>
              <span style={{ color: C.orange }}>Pay</span>
            </h1>
            <p
              style={{
                fontSize: 16,
                fontWeight: 400,
                color: C.mut,
                marginTop: 8,
                lineHeight: 1.4,
              }}
            >
              {t("login.subtitle")}
            </p>
          </div>

          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 0,
              marginTop: 8,
              marginBottom: 8,
            }}
          >
            <img
              src="/inicio-app/gato-inicio.png"
              alt="MidatoPay"
              style={{
                width: "100%",
                maxWidth: 280,
                height: "auto",
                maxHeight: "100%",
                objectFit: "contain",
                display: "block",
              }}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12, flexShrink: 0 }}>
            <button onClick={onLogin} disabled={!ready} style={{ ...btnOrange, opacity: ready ? 1 : 0.5 }}>
              {ready ? t("login.loginBtn") : t("login.loadingBtn")}
            </button>
            <button onClick={onLogin} disabled={!ready} style={{ ...btnOutline, opacity: ready ? 1 : 0.5 }}>
              {t("login.createAccountBtn")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Nombre del comercio embebido en el QR (vacío si era el label genérico). */
function guestMerchantName(who) {
  const w = String(who || "").trim();
  if (!w || /^your commerce$/i.test(w) || /^tu comercio$/i.test(w)) return "";
  return w;
}

// ————— Cliente demo (sin Privy): saldo ARS vía recaudadora + FAB QR —————
function GuestApp({ onExit, initialScan = null }) {
  const { t, locale } = useLanguage();
  // home | scan | link | confirm
  const [tab, setTab] = useState(initialScan ? "confirm" : "home");
  const [fxRate, setFxRate] = useState(FALLBACK_FX_ARS_USD);
  const [treasuryUsdc, setTreasuryUsdc] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [qr, setQr] = useState(initialScan);
  const [scanErr, setScanErr] = useState(""); // "" | invalid | CAMERA:...
  const [manualLink, setManualLink] = useState("");
  const [phase, setPhase] = useState("form");
  const [errMsg, setErrMsg] = useState("");
  const [torchOn, setTorchOn] = useState(false);

  const refreshTreasury = useCallback(async () => {
    try {
      const [bal, rate] = await Promise.all([getTreasuryBalance(), getArsPerUsdc()]);
      setTreasuryUsdc(bal);
      setFxRate(rate);
    } catch {
      /* RPC puede fallar */
    }
  }, []);

  useEffect(() => {
    refreshTreasury();
    const id = setInterval(refreshTreasury, 45_000);
    return () => clearInterval(id);
  }, [refreshTreasury]);

  const availableArs = treasuryUsdc == null ? null : usdcBalanceToArs(treasuryUsdc, fxRate);
  const quote = qr ? quoteArsToUsdc(qr.ars, fxRate) : null;

  const openScan = () => {
    setTab("scan");
    setQr(null);
    setScanErr("");
    setErrMsg("");
    setPhase("form");
    setManualLink("");
    setTorchOn(false);
  };

  const openLink = () => {
    setTab("link");
    setManualLink("");
    setScanErr("");
    setErrMsg("");
  };

  const goHome = () => {
    setTab("home");
    setQr(null);
    setScanErr("");
    setErrMsg("");
    setPhase("form");
    setManualLink("");
  };

  const applyDecoded = (raw) => {
    const parsed = parsePayUrl(raw);
    if (!parsed) {
      setScanErr("invalid");
      setTab("scan");
      setQr(null);
      return;
    }
    setScanErr("");
    setQr(parsed);
    setPhase("form");
    setErrMsg("");
    setTab("confirm");
  };

  const submit = async () => {
    setErrMsg("");
    setPhase("working");
    try {
      if (!isTreasuryConfigured()) throw new Error(t("guest.treasuryMissing"));
      if (!qr || !quote) throw new Error(t("pay.invalidQr"));
      if (availableArs != null && qr.ars > availableArs) throw new Error(t("guest.insufficient"));
      if (treasuryUsdc != null && quote.usdc > treasuryUsdc) throw new Error(t("guest.insufficient"));

      const result = await sendTreasuryPayout({
        to: qr.addr,
        usdc: quote.usdc,
        kind: "guest_qr",
        ars: qr.ars,
        fxRate,
        factura: qr.factura,
      });
      await refreshTreasury();
      setReceipt({
        ...result,
        kind: "charge_p2p",
        ars: qr.ars,
        direction: "out",
        parsed: {
          amount: qr.ars,
          currency: "ARS",
          usdc: result.usdc,
          fxRate,
          contact: { name: guestMerchantName(qr.who) || t("guest.merchant"), alias: "qr", addr: qr.addr },
        },
        ts: new Date().toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
      });
      setQr(null);
      setPhase("form");
      setTab("home");
    } catch (e) {
      setErrMsg(String(e?.message || e));
      setPhase("error");
    }
  };

  const shell = (children, { pad = true, nav = true } = {}) => (
    <div className="mp-stage">
      <div className="mp-device mp-guest">
        <div className="mp-scroll" style={{ padding: pad ? "22px 18px 120px" : 0 }}>{children}</div>
        {nav && (
          <nav className="mp-nav">
            <NavButton active={tab === "home"} icon={<IconHome />} label={t("nav.home")} onClick={goHome} accent={G.accent} />
            <div style={{ flex: 1 }} aria-hidden="true" />
            <div style={{ width: 64, flexShrink: 0 }} aria-hidden="true" />
            <div style={{ flex: 1 }} aria-hidden="true" />
            <NavButton active={false} icon={<IconLogout />} label={t("guest.exit")} onClick={onExit} accent={G.accent} />
            <button
              type="button"
              onClick={openScan}
              className="mp-fab"
              aria-label={t("guest.scanCta")}
            >
              <span className="mp-fab-shine" aria-hidden />
              <IconQrCode size={26} />
            </button>
          </nav>
        )}
      </div>
    </div>
  );

  if (receipt) {
    return shell(
      <Success
        receipt={receipt}
        hideFx
        onClose={(next) => {
          setReceipt(null);
          if (next === "pay" || next === "scan") openScan();
          else setTab("home");
        }}
      />
    );
  }

  if (tab === "scan" && scanErr === "invalid" && !qr) {
    return shell(
      <div style={{ display: "flex", flexDirection: "column", minHeight: "100%", padding: "28px 22px 28px", boxSizing: "border-box", background: C.card }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 12 }}>
          <div style={{ width: 88, height: 88, borderRadius: 22, background: "#FDECEA", display: "grid", placeItems: "center", color: C.red }}>
            <IconQrCode size={44} />
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.ink, marginTop: 8 }}>{t("guest.invalidTitle")}</div>
          <div style={{ fontSize: 15, color: C.mut, lineHeight: 1.45, maxWidth: 280 }}>{t("guest.invalidBody")}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button type="button" onClick={() => { setScanErr(""); setTab("scan"); }} style={{ ...btnOrange, background: C.ink, boxShadow: "none" }}>
            {t("guest.scanAgain")}
          </button>
          <button type="button" onClick={goHome} style={{ ...btnOutline, borderColor: C.line, color: C.ink, background: C.bg }}>
            {t("guest.goHome")}
          </button>
        </div>
      </div>,
      { pad: false, nav: false }
    );
  }

  if (tab === "link") {
    return shell(
      <div style={{ display: "flex", flexDirection: "column", minHeight: "100%", padding: "22px 22px 28px", boxSizing: "border-box", background: C.card }}>
        <button type="button" onClick={openScan} aria-label={t("guest.backHome")} style={{ alignSelf: "flex-start", width: 40, height: 40, borderRadius: "50%", border: "none", background: C.bg, color: C.ink, fontSize: 26, lineHeight: 1, cursor: "pointer", fontFamily: "inherit", marginBottom: 18 }}>
          ‹
        </button>
        <h2 style={{ fontSize: 26, fontWeight: 700, color: C.ink, margin: "0 0 8px", letterSpacing: -0.4 }}>{t("guest.useLinkTitle")}</h2>
        <p style={{ fontSize: 15, color: C.mut, lineHeight: 1.45, margin: "0 0 20px" }}>{t("guest.useLinkBody")}</p>
        <textarea
          value={manualLink}
          onChange={(e) => setManualLink(e.target.value)}
          placeholder={t("pay.scanLinkPlaceholder")}
          rows={4}
          style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${C.line}`, borderRadius: 16, padding: "14px 16px", fontSize: 15, fontFamily: "inherit", outline: "none", resize: "vertical", color: C.ink, background: C.bg }}
        />
        <div style={{ marginTop: "auto", paddingTop: 24, display: "flex", flexDirection: "column", gap: 10 }}>
          <button
            type="button"
            onClick={() => applyDecoded(manualLink)}
            disabled={!manualLink.trim()}
            style={{ ...btnOrange, background: G.accent, boxShadow: "none", opacity: manualLink.trim() ? 1 : 0.5 }}
          >
            {t("guest.useLinkCta")}
          </button>
          <button type="button" onClick={openScan} style={{ ...btnOutline, border: "none", color: C.mut }}>
            {t("guest.scanAgain")}
          </button>
        </div>
      </div>,
      { pad: false, nav: false }
    );
  }

  if (tab === "scan" && !qr) {
    return shell(
      <div className="mp-guest-scan">
        <div className="mp-guest-scan-top">
          <button type="button" onClick={goHome} className="mp-guest-scan-iconbtn" aria-label={t("guest.backHome")}>‹</button>
        </div>
        {!scanErr.startsWith("CAMERA:") ? (
          <div className="mp-guest-scan-stage">
            <QrScanner
              fill
              torchOn={torchOn}
              onDecode={applyDecoded}
              onCameraError={() => setScanErr("CAMERA:" + t("pay.scanCameraError"))}
            />
            <div className="mp-guest-scan-frame" aria-hidden />
            <div className="mp-guest-scan-laser" aria-hidden />
          </div>
        ) : (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 24, color: "#fff", textAlign: "center", background: "#0b0b0d" }}>
            {scanErr.replace(/^CAMERA:/, "")}
          </div>
        )}
        <div className="mp-guest-scan-bottom">
          <button
            type="button"
            onClick={() => setTorchOn((v) => !v)}
            className={`mp-guest-scan-flash${torchOn ? " is-on" : ""}`}
            aria-label={t("guest.flash")}
            aria-pressed={torchOn}
          >
            <IconFlash size={24} />
          </button>
          <button type="button" onClick={openLink} style={{ ...btnOrange, background: "#fff", color: C.ink, boxShadow: "none" }}>
            {t("guest.useLink")}
          </button>
        </div>
      </div>,
      { pad: false, nav: false }
    );
  }

  if (tab === "confirm" && qr) {
    const merchantName = guestMerchantName(qr.who);
    return shell(
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <h2 style={{ fontSize: 26, fontWeight: 700, color: C.ink, margin: 0, letterSpacing: -0.4 }}>{t("guest.scanTitle")}</h2>
        <Card style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 13, color: C.mut }}>{t("guest.payToLabel")}</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: C.ink }}>{t("guest.merchant")}</div>
            {merchantName ? (
              <div style={{ fontSize: 20, fontWeight: 700, color: G.accent, marginTop: 2, letterSpacing: -0.3 }}>
                {merchantName}
              </div>
            ) : null}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14.5, marginTop: 6 }}>
            <span style={{ color: C.mut }}>{t("guest.youPay")}</span>
            <span style={{ fontWeight: 700, color: C.ink }}>$ {fmtArs(qr.ars)}</span>
          </div>
          {(phase === "error" || errMsg) && phase !== "working" && (
            <div style={{ background: "#FDECEA", color: C.red, fontSize: 14, lineHeight: 1.5, borderRadius: 12, padding: "12px 14px" }}>{errMsg}</div>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={phase === "working" || !quote}
            style={{ ...btnOrange, background: G.accent, boxShadow: "none", opacity: phase === "working" || !quote ? 0.5 : 1 }}
          >
            {phase === "working" ? t("guest.paying") : t("guest.confirmCta")}
          </button>
          <button type="button" onClick={openScan} style={{ ...btnOutline, border: "none", color: C.mut }}>
            {t("guest.scanAgain")}
          </button>
        </Card>
      </div>
    );
  }

  return shell(
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          aria-hidden
          style={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            background: G.soft,
            color: G.accent,
            display: "grid",
            placeItems: "center",
            fontWeight: 700,
            fontSize: 18,
          }}
        >
          C
        </div>
        <div>
          <div style={{ fontSize: 15, color: C.mut }}>{t("home.greetingHi")}</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: G.accent, letterSpacing: -0.3 }}>{t("guest.name")}</div>
        </div>
      </div>

      <Card>
        <div style={{ fontSize: 14, color: C.mut, fontWeight: 600 }}>{t("home.available")}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
          <img
            src="/monedas/ars.png"
            alt="ARS"
            width={34}
            height={34}
            style={{ width: 34, height: 34, borderRadius: "50%", objectFit: "cover", display: "block", flexShrink: 0 }}
          />
          <div style={{ fontSize: 34, fontWeight: 700, color: C.ink, letterSpacing: -0.8, lineHeight: 1.1 }}>
            {availableArs == null ? "—" : `$ ${fmtArs(availableArs)}`}
          </div>
        </div>
      </Card>
    </div>
  );
}

// ————— Inicio —————
function Home({
  nombre, address, balance, arsBalance,
  txs, goCharge, goConvert, goPay, goMore, fxRate,
}) {
  const { t, locale } = useLanguage();
  const [oculto, setOculto] = useState(false);
  // Available y Funds (USDC) en ARS: siempre USDC × cotización Chainlink (ARS por 1 USDC).
  const usdcInArs = balance === null ? null : usdcBalanceToArs(balance, fxRate);
  const availableArs = (arsBalance || 0) + (usdcInArs || 0);
  const initial = (nombre || "?").trim().charAt(0).toUpperCase() || "?";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          aria-hidden
          style={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            background: C.orangeSoft,
            color: "#fe6c1c",
            display: "grid",
            placeItems: "center",
            fontSize: 18,
            fontWeight: 700,
            flexShrink: 0,
            letterSpacing: 0,
          }}
        >
          {initial}
        </div>
        <div style={{ fontSize: 21, flex: 1, minWidth: 0, lineHeight: 1.2 }}>
          <span style={{ fontWeight: 500, color: C.mut }}>{t("home.greetingHi")} </span>
          <span style={{ fontWeight: 700, color: "#fe6c1c" }}>{nombre}</span>
        </div>
        <button
          onClick={goMore}
          aria-label={t("nav.more")}
          style={{
            width: 42,
            height: 42,
            borderRadius: 12,
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "#fe6c1c",
            display: "grid",
            placeItems: "center",
            padding: 0,
          }}
        >
          <IconMenuList />
        </button>
      </div>

      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: C.mut }}>{t("home.available")}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <IconArFlag size={18} />
            <span style={{ fontSize: 15, fontWeight: 700, color: C.mut }}>ARS</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 6 }}>
          <div style={{ fontSize: 38, fontWeight: 700, letterSpacing: -1, color: C.ink }}>
            {oculto ? "$ ••••••" : `$ ${fmtArs(availableArs)}`}
          </div>
          <button
            onClick={() => setOculto(!oculto)}
            aria-label={oculto ? "Show" : "Hide"}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: C.mut,
              display: "grid",
              placeItems: "center",
              padding: 4,
            }}
          >
            <IconEye crossed={oculto} />
          </button>
        </div>

        <div style={{ display: "flex", gap: 6, marginTop: 20 }}>
          <CircleAction icon={<IconArrowDown />} label={t("home.actionReceive")} onClick={goCharge} background={GRAD_COBRAR} />
          <CircleAction icon={<IconSwap />} label={t("home.actionConvert")} onClick={goConvert} background={GRAD_CONVERTIR} />
          <CircleAction icon={<IconArrowUp />} label={t("home.actionPay")} onClick={goPay} background={GRAD_PAGAR} />
        </div>
      </Card>

      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: C.ink }}>{t("home.fundsTitle")}</span>
          <a href={`${ARC.explorer}/address/${address}`} target="_blank" rel="noreferrer" style={{ fontSize: 12, fontWeight: 700, color: C.orange, background: C.orangeSoft, padding: "5px 12px", borderRadius: 20, textDecoration: "none" }}>
            {t("home.viewAll")}
          </a>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src="/monedas/usdc.png" alt="USDC" width={38} height={38} style={{ width: 38, height: 38, borderRadius: "50%", objectFit: "cover", display: "block", flexShrink: 0 }} />
          <div style={{ flex: 1, fontSize: 17, fontWeight: 700, color: C.ink }}>USDC</div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: C.ink }}>{usdcInArs === null ? "—" : `$${fmtArs(usdcInArs)}`}</div>
            <div style={{ fontSize: 14, color: C.mut }}>{balance === null ? "" : `${fmt(balance, 2, locale)} USDC`}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.line}` }}>
          <img src="/monedas/ars.png" alt="ARS" width={38} height={38} style={{ width: 38, height: 38, borderRadius: "50%", objectFit: "cover", display: "block", flexShrink: 0 }} />
          <div style={{ flex: 1, fontSize: 17, fontWeight: 700, color: C.ink }}>ARS</div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: C.ink }}>{oculto ? "$ ••••••" : `$ ${fmtArs(arsBalance || 0)}`}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.line}` }}>
          <span style={{ color: C.violet, fontSize: 14 }}>ⓘ</span>
          <span style={{ fontSize: 13.5, color: C.violet, flex: 1 }}>{t("home.infoDigitalAssets")}</span>
        </div>
      </Card>

      {balance !== null && balance < 0.5 && (
        <Card style={{ background: "#16161A", color: "#fff" }}>
          <div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.35 }}>{t("home.faucetCardTitle")}</div>
          <div style={{ fontSize: 13.5, opacity: 0.75, marginTop: 8, lineHeight: 1.5 }}>{t("home.faucetCardBody")}</div>
          <a href={ARC.faucet} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 16, background: C.orange, color: "#fff", padding: "11px 22px", borderRadius: 12, fontSize: 14.5, fontWeight: 700, textDecoration: "none" }}>
            {t("home.faucetCardBtn")}
          </a>
        </Card>
      )}

      <div style={{ fontSize: 17, fontWeight: 700, color: C.ink, marginTop: 4 }}>{t("home.activityTitle")}</div>
      {txs.length === 0 ? (
        <Card style={{ fontSize: 14, color: C.mut, lineHeight: 1.55 }}>{t("home.activityEmpty")}</Card>
      ) : (
        txs.slice(0, 5).map((tx) => <TxCard key={tx.hash} tx={tx} compact />)
      )}
    </div>
  );
}

function AmountField({ label, value, onChange, placeholder, suffix, logo }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: C.mut, marginBottom: 8 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, background: C.card, borderRadius: 14, padding: "4px 14px", border: `1px solid ${C.line}` }}>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
          inputMode="decimal"
          placeholder={placeholder}
          style={{ flex: 1, border: "none", background: "transparent", fontSize: 22, fontWeight: 700, color: C.ink, padding: "14px 0", fontFamily: "inherit", outline: "none", minWidth: 0 }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {logo && (
            <img src={logo} alt="" width={22} height={22} style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover", display: "block" }} />
          )}
          <span style={{ fontSize: 14, fontWeight: 700, color: C.mut }}>{suffix}</span>
        </div>
      </div>
    </label>
  );
}

/** Panel de estimación de gas (previo a firmar con la wallet del usuario). */
function GasEstimatePanel({ estimate, loading, error, onRetry, fxRate, locale, t }) {
  const rows = [];
  if (estimate) {
    rows.push([t("gas.gasLimit"), estimate.gasLimit.toString()]);
    if (estimate.eip1559) {
      rows.push([t("gas.maxFee"), `${fmt(estimate.maxFeePerGasGwei, 4, locale)} gwei`]);
      if (estimate.maxPriorityFeePerGasGwei != null) {
        rows.push([t("gas.maxPriority"), `${fmt(estimate.maxPriorityFeePerGasGwei, 4, locale)} gwei`]);
      }
    } else if (estimate.gasPriceGwei != null) {
      rows.push([t("gas.gasPrice"), `${fmt(estimate.gasPriceGwei, 4, locale)} gwei`]);
    }
    rows.push([t("gas.totalNative"), `${fmt(estimate.feeNative, 6, locale)} ${estimate.nativeSymbol}`]);
    rows.push([t("gas.totalUsd"), `$${fmt(estimate.feeUsd, 6, locale)} USD`]);
    if (fxRate) {
      rows.push([t("gas.totalArs"), `$ ${fmtArs(estimate.feeNative * fxRate)} ARS`]);
    }
  }

  return (
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.line}` }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.mut, marginBottom: 10 }}>{t("gas.title")}</div>
      {loading && <div style={{ fontSize: 13.5, color: C.mut }}>{t("gas.estimating")}</div>}
      {!loading && error && (
        <div style={{ fontSize: 13.5, color: C.red, lineHeight: 1.45 }}>
          {error === "WALLET_DISCONNECTED" ? t("gas.walletMissing") : error}
          {onRetry && error !== "WALLET_DISCONNECTED" && (
            <button
              onClick={onRetry}
              style={{ display: "block", marginTop: 8, background: "none", border: "none", color: C.violet, fontWeight: 700, cursor: "pointer", padding: 0, fontFamily: "inherit", fontSize: 13 }}
            >
              {t("gas.retry")}
            </button>
          )}
        </div>
      )}
      {!loading && !error && estimate && (
        <div style={{ display: "grid", gap: 8, fontSize: 13.5 }}>
          {rows.map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span style={{ color: C.mut }}>{k}</span>
              <span style={{ color: C.ink, fontWeight: 600, textAlign: "right", wordBreak: "break-all" }}>{v}</span>
            </div>
          ))}
          <div style={{ fontSize: 11.5, color: C.mut, marginTop: 2 }}>{t("gas.disclaimer")}</div>
        </div>
      )}
    </div>
  );
}

/** Hook: estima gas cuando cambian from/to/usdc/memo (debounce corto). */
function useGasEstimate({ enabled, from, to, usdc, memo, estimateFn }) {
  const [estimate, setEstimate] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const retry = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) {
      setEstimate(null);
      setError("");
      setLoading(false);
      return undefined;
    }
    if (!from) {
      setEstimate(null);
      setError("WALLET_DISCONNECTED");
      setLoading(false);
      return undefined;
    }
    if (!to || !Number.isFinite(Number(usdc)) || Number(usdc) <= 0) {
      setEstimate(null);
      setError("");
      setLoading(false);
      return undefined;
    }

    let alive = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const est = estimateFn
          ? await estimateFn()
          : await estimateNativeUsdcTransfer({ from, to, usdc: Number(usdc), memo });
        if (alive) setEstimate(est);
      } catch (e) {
        if (alive) {
          setEstimate(null);
          setError(String(e?.message || e));
        }
      } finally {
        if (alive) setLoading(false);
      }
    }, 280);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [enabled, from, to, usdc, memo, estimateFn, tick]);

  return { estimate, loading, error, retry };
}

// ————— Cobrar (QR P2P: espera y detecta el pago on-chain) —————
function Charge({ address, fxRate, onDetected, merchantName }) {
  const { t, locale } = useLanguage();
  const [arsInput, setArsInput] = useState("");
  const [phase, setPhase] = useState("form"); // form | waiting | error
  const [errMsg, setErrMsg] = useState("");
  const [request, setRequest] = useState(null); // { ars, factura, url }
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const baselineRef = useRef(null);

  const ars = Number(arsInput);
  const quote = Number.isFinite(ars) && ars > 0 ? quoteArsToUsdc(ars, fxRate) : null;
  const whoForQr = (merchantName || "").trim() || t("charge.merchantSelf");

  const startWaiting = async () => {
    const factura = nuevaFactura();
    const url = buildPayUrl({ addr: address, who: whoForQr, ars, factura });
    setRequest({ ars, factura, url });
    setPhase("waiting");
    try {
      setQrDataUrl(await QRCode.toDataURL(url, { margin: 1, width: 260 }));
    } catch {
      setQrDataUrl("");
    }
    baselineRef.current = await getUsdcBalance(address).catch(() => null);
  };

  useEffect(() => {
    if (phase !== "waiting" || !request) return undefined;
    let cancelled = false;

    const poll = async () => {
      const current = await getUsdcBalance(address).catch(() => null);
      if (cancelled || current == null || baselineRef.current == null) return;
      if (current <= baselineRef.current) return;

      const found = await findIncomingTransfer({ address, factura: request.factura }).catch(() => null);
      if (cancelled) return;
      if (!found) {
        setErrMsg(t("charge.detectError"));
        setPhase("error");
        return;
      }
      const rate = await getArsPerUsdc().catch(() => fxRate);
      const usdc = current - baselineRef.current;
      onDetected({
        hash: found.hash,
        who: whoForQr,
        amt: usdc,
        fxRate: rate,
        ars: request.ars,
        factura: request.factura,
        block: found.block,
        fee: found.fee,
        memo: null,
        kind: "charge_p2p",
        direction: "in",
        usdc,
      });
    };

    const id = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [phase, request, address, fxRate, onDetected, t]);

  const copyLink = async () => {
    if (!request) return;
    try {
      await navigator.clipboard.writeText(request.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard puede no estar disponible (http no seguro, permisos) */
    }
  };

  const cancel = () => {
    setPhase("form");
    setRequest(null);
    setQrDataUrl("");
    baselineRef.current = null;
  };

  if (phase === "waiting" || phase === "error") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <h2 style={{ fontSize: 26, fontWeight: 700, color: C.ink, margin: 0, letterSpacing: -0.4 }}>{t("charge.title")}</h2>

        <Card style={{ textAlign: "center", padding: 24 }}>
          <div style={{ fontSize: 32, fontWeight: 700, color: C.ink }}>${fmtArs(request.ars)}</div>
          {qrDataUrl ? (
            <img src={qrDataUrl} alt="QR" width={220} height={220} style={{ marginTop: 16, borderRadius: 12 }} />
          ) : (
            <div style={{ marginTop: 16, height: 220, display: "grid", placeItems: "center", color: C.mut }}>
              <IconQrCode size={64} />
            </div>
          )}

          <div style={{ marginTop: 18, fontSize: 15, fontWeight: 700, color: C.ink }}>{t("charge.waitingTitle")}</div>
          <div style={{ fontSize: 13, color: C.mut, marginTop: 6, lineHeight: 1.45 }}>{t("charge.waitingHint")}</div>

          <div style={{ marginTop: 18, textAlign: "left" }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: C.mut, marginBottom: 6 }}>{t("charge.linkLabel")}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: "10px 12px" }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: C.ink, fontFamily: "ui-monospace, monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {request.url}
              </span>
              <button
                onClick={copyLink}
                aria-label={t("charge.copyLink")}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#fe6c1c", display: "grid", placeItems: "center", padding: 4, flexShrink: 0 }}
              >
                <IconCopy />
              </button>
            </div>
            {copied && <div style={{ fontSize: 12, color: C.green, marginTop: 6 }}>{t("charge.linkCopied")}</div>}
          </div>

          {phase === "error" && (
            <div style={{ marginTop: 16, padding: "12px 14px", background: "#FDECEA", color: C.red, borderRadius: 12, fontSize: 13.5, lineHeight: 1.5 }}>
              {errMsg}
            </div>
          )}
        </Card>

        <button onClick={cancel} style={btnOutline}>{t("charge.cancel")}</button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 style={{ fontSize: 26, fontWeight: 700, color: C.ink, margin: 0, letterSpacing: -0.4 }}>{t("charge.title")}</h2>
      <div style={{ fontSize: 14, color: C.mut, lineHeight: 1.5 }}>{t("charge.subtitle")}</div>

      <Card style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <AmountField
          label={t("charge.arsLabel")}
          value={arsInput}
          onChange={setArsInput}
          placeholder="5000"
          suffix="ARS"
          logo="/monedas/ars.png"
        />

        <div style={{ display: "grid", gap: 12, fontSize: 14.5 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: C.mut }}>{t("voice.exchangeRate")}</span>
            <span style={{ fontWeight: 600, color: C.ink }}>1 USDC = ${fmtArs(fxRate)}</span>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              background: C.card,
              borderRadius: 14,
              padding: "14px 16px",
              border: `1px solid ${C.line}`,
            }}
          >
            <span style={{ color: C.mut }}>{t("charge.youReceive")}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <img src="/monedas/usdc.png" alt="" width={22} height={22} style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover" }} />
              <span style={{ fontWeight: 700, color: C.ink, fontSize: 16 }}>
                {quote ? `${fmt(quote.usdc, 2, locale)} USDC` : "—"}
              </span>
            </div>
          </div>
        </div>
      </Card>

      <button
        onClick={startWaiting}
        disabled={!quote}
        style={{
          ...btnOrange,
          opacity: !quote ? 0.5 : 1,
          background: "linear-gradient(180deg, #ffb58d, #fe6c1c)",
          boxShadow: "0 10px 22px rgba(254,108,28,.28)",
        }}
      >
        {t("charge.cta")}
      </button>
    </div>
  );
}

/** Escaneo de QR por cámara (getUserMedia + jsQR sobre frames de <video>). */
function QrScanner({ onDecode, onCameraError, fill = false, torchOn = false }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const streamRef = useRef(null);
  const [streamReady, setStreamReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStreamReady(false);

    const tick = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(frame.data, frame.width, frame.height);
      if (code?.data) {
        onDecode(code.data);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: { ideal: "environment" } } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        streamRef.current = stream;
        setStreamReady(true);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
        rafRef.current = requestAnimationFrame(tick);
      })
      .catch((e) => onCameraError(String(e?.message || e)));

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
      setStreamReady(false);
    };
  }, [onDecode, onCameraError]);

  useEffect(() => {
    if (!streamReady) return;
    const track = streamRef.current?.getVideoTracks?.()[0];
    if (!track) return;
    track.applyConstraints({ advanced: [{ torch: torchOn }] }).catch(() => {});
  }, [torchOn, streamReady]);

  return (
    <div
      style={
        fill
          ? { position: "absolute", inset: 0, background: "#000", overflow: "hidden" }
          : { position: "relative", borderRadius: 16, overflow: "hidden", background: "#000" }
      }
    >
      <video
        ref={videoRef}
        muted
        playsInline
        style={
          fill
            ? { width: "100%", height: "100%", objectFit: "cover", display: "block" }
            : { width: "100%", display: "block" }
        }
      />
      <canvas ref={canvasRef} style={{ display: "none" }} />
    </div>
  );
}

// ————— Pagar (alias o address, sin mic; + escaneo QR) —————
function Pay({ address, balance, fxRate, contacts, onPay, onDone, onSaveContact, scanRequest, onScanRequestConsumed }) {
  const { t, locale } = useLanguage();
  const [mode, setMode] = useState("manual"); // manual | scan
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [phase, setPhase] = useState("form");
  const [errMsg, setErrMsg] = useState("");
  const [scanErr, setScanErr] = useState("");
  const [manualLink, setManualLink] = useState("");
  const [qr, setQr] = useState(null); // { addr, who, ars, factura }
  const [savePrompt, setSavePrompt] = useState(false);

  useEffect(() => {
    if (!scanRequest) return;
    setMode("scan");
    setQr(scanRequest);
    onScanRequestConsumed();
  }, [scanRequest, onScanRequestConsumed]);

  const applyDecoded = (raw) => {
    const parsed = parsePayUrl(raw);
    if (!parsed) {
      setScanErr(t("pay.invalidQr"));
      return;
    }
    if (parsed.addr.toLowerCase() === (address || "").toLowerCase()) {
      setScanErr(t("pay.selfPay"));
      return;
    }
    setScanErr("");
    setQr(parsed);
  };

  const qrUsdc = qr ? qr.ars / fxRate : null;
  const qrContact = qr ? { name: qr.who || short(qr.addr), alias: "qr", addr: qr.addr } : null;
  const knownContact = qr ? contacts.find((c) => c.addr.toLowerCase() === qr.addr.toLowerCase()) : null;

  const submitQr = async () => {
    setErrMsg("");
    setPhase("working");
    try {
      if (qrUsdc == null || qrUsdc < 0.01) throw new Error(t("pay.amountTooLow"));
      if (balance !== null && qrUsdc > balance) {
        throw new Error(t("voice.insufficientBalance", fmt(qrUsdc, 2, locale), fmt(balance, 2, locale)));
      }
      const parsed = {
        amount: qr.ars,
        currency: "ARS",
        usdc: qrUsdc,
        fxRate,
        contact: qrContact,
        factura: qr.factura || nuevaFactura(),
        kind: "charge_p2p",
      };
      const result = await onPay(parsed);
      onDone({
        ...result,
        direction: "out",
        parsed,
        ts: new Date().toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
      });
      if (!knownContact) setSavePrompt(true);
    } catch (e) {
      setErrMsg(String(e?.message || e));
      setPhase("error");
    }
  };

  const saveContact = async () => {
    setSavePrompt(false);
    try {
      await onSaveContact({ name: qr.who || short(qr.addr), alias: slugifyAlias(qr.who) || qr.addr.slice(2, 8).toLowerCase(), addr: qr.addr, note: "" });
    } catch {
      /* alias duplicado u otro error — no bloquea el flujo de pago, ya se hizo */
    }
  };

  const n = Number(amount);
  const contact = useMemo(() => {
    const q = recipient.trim();
    if (!q) return null;
    const byAlias = findByAlias(contacts, q);
    if (byAlias) return byAlias;
    const lower = q.toLowerCase();
    const byName = contacts.find((c) => c.name.toLowerCase() === lower || c.alias === lower);
    if (byName) return byName;
    if (ethers.isAddress(q)) {
      const addr = ethers.getAddress(q);
      return { name: short(addr), alias: "addr", addr };
    }
    return null;
  }, [recipient, contacts]);

  const suggestions = useMemo(() => {
    const q = recipient.trim();
    if (!q || contact) return [];
    return searchContacts(contacts, q).slice(0, 5);
  }, [recipient, contacts, contact]);

  const usdc = Number.isFinite(n) && n > 0 ? n : null;
  const canSubmit = Boolean(contact && usdc != null && usdc >= 0.01 && address);

  const estimatePayFn = useCallback(() => {
    if (!contact || !usdc) return Promise.reject(new Error("Sin monto"));
    return estimateNativeUsdcTransfer({
      from: address,
      to: contact.addr,
      usdc,
      memo: `pay:${contact.alias}:${usdc}`,
    });
  }, [contact, usdc, address]);

  const gas = useGasEstimate({
    enabled: canSubmit && phase === "form",
    from: address,
    to: contact?.addr,
    usdc,
    memo: `pay:${contact?.alias}:${usdc}`,
    estimateFn: estimatePayFn,
  });

  const submit = async () => {
    setErrMsg("");
    setPhase("working");
    try {
      if (!contact) throw new Error(t("pay.recipientInvalid"));
      if (usdc == null || usdc < 0.01) throw new Error(t("pay.amountTooLow"));
      if (balance !== null && usdc > balance) {
        throw new Error(t("voice.insufficientBalance", fmt(usdc, 2, locale), fmt(balance, 2, locale)));
      }
      const parsed = {
        amount: n,
        currency: "USDC",
        usdc,
        fxRate,
        contact,
        factura: nuevaFactura(),
        kind: "pay",
      };
      const result = await onPay(parsed);
      onDone({
        ...result,
        parsed,
        ts: new Date().toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
      });
    } catch (e) {
      setErrMsg(String(e?.message || e));
      setPhase("error");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 style={{ fontSize: 26, fontWeight: 700, color: C.ink, margin: 0, letterSpacing: -0.4 }}>{t("pay.title")}</h2>

      {phase === "form" && !qr && (
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setMode("manual")}
            style={{ flex: 1, padding: "10px 0", borderRadius: 12, border: `1.5px solid ${C.line}`, background: mode === "manual" ? C.orangeSoft : "transparent", color: mode === "manual" ? "#fe6c1c" : C.mut, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}
          >
            {t("pay.modeManual")}
          </button>
          <button
            onClick={() => setMode("scan")}
            style={{ flex: 1, padding: "10px 0", borderRadius: 12, border: `1.5px solid ${C.line}`, background: mode === "scan" ? C.orangeSoft : "transparent", color: mode === "scan" ? "#fe6c1c" : C.mut, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}
          >
            {t("pay.modeScan")}
          </button>
        </div>
      )}

      {mode === "scan" && !qr && (
        <Card style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {!scanErr.startsWith("CAMERA:") && (
            <>
              <div style={{ fontSize: 13.5, color: C.mut }}>{t("pay.scanHint")}</div>
              <QrScanner onDecode={applyDecoded} onCameraError={() => setScanErr("CAMERA:" + t("pay.scanCameraError"))} />
            </>
          )}
          {scanErr && (
            <div style={{ fontSize: 13.5, color: C.red }}>{scanErr.replace(/^CAMERA:/, "")}</div>
          )}
          <label style={{ display: "block" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.mut, marginBottom: 8 }}>{t("pay.scanLinkPlaceholder")}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={manualLink}
                onChange={(e) => setManualLink(e.target.value)}
                placeholder="https://…"
                style={{ flex: 1, boxSizing: "border-box", background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: "12px 14px", fontSize: 14, color: C.ink, outline: "none", fontFamily: "inherit" }}
              />
              <button onClick={() => applyDecoded(manualLink)} style={{ ...btnOutline, width: "auto", padding: "0 18px" }}>
                {t("pay.scanLinkCta")}
              </button>
            </div>
          </label>
        </Card>
      )}

      {qr && (
        <Card style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: "50%", background: C.orangeSoft, display: "grid", placeItems: "center", color: "#fe6c1c", fontWeight: 700, flexShrink: 0 }}>
              {(qr.who || "?").slice(0, 1).toUpperCase()}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>{t("pay.payTo", qr.who || short(qr.addr))}</div>
              <div style={{ fontSize: 12.5, color: C.mut, fontFamily: "ui-monospace, monospace" }}>{short(qr.addr)}</div>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 20, fontWeight: 700, color: C.ink }}>
            <span>${fmtArs(qr.ars)} ARS</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: C.mut }}>
            <span>{t("pay.youSend")}</span>
            <span>{qrUsdc != null ? `≈ ${fmt(qrUsdc, 2, locale)} USDC` : "—"}</span>
          </div>

          {(phase === "error" || errMsg) && phase !== "working" && (
            <div style={{ padding: "12px 14px", background: "#FDECEA", color: C.red, borderRadius: 12, fontSize: 13.5, lineHeight: 1.5 }}>{errMsg}</div>
          )}

          <button
            onClick={submitQr}
            disabled={phase === "working"}
            style={{ ...btnOrange, background: C.orange, boxShadow: "none", opacity: phase === "working" ? 0.5 : 1 }}
          >
            {phase === "working" ? t("pay.working") : t("pay.confirmPayCta")}
          </button>
          <button onClick={() => { setQr(null); setScanErr(""); }} style={btnOutline}>{t("charge.cancel")}</button>
        </Card>
      )}

      {savePrompt && qr && (
        <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>{t("qr.saveContactTitle")}</div>
          <div style={{ fontSize: 13.5, color: C.mut }}>{t("qr.saveContactBody", qr.who || short(qr.addr))}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={saveContact} style={{ ...btnOrange, background: C.orange, boxShadow: "none" }}>{t("qr.saveContactYes")}</button>
            <button onClick={() => setSavePrompt(false)} style={btnOutline}>{t("qr.saveContactNo")}</button>
          </div>
        </Card>
      )}

      {mode === "manual" && !qr && (
      <>
      <Card style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <label style={{ display: "block" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.mut, marginBottom: 8 }}>{t("pay.recipientLabel")}</div>
          <input
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder={t("pay.recipientPlaceholder")}
            autoComplete="off"
            style={{
              width: "100%",
              boxSizing: "border-box",
              background: C.card,
              border: `1px solid ${C.line}`,
              borderRadius: 14,
              padding: "14px 16px",
              fontSize: 16,
              fontWeight: 600,
              color: C.ink,
              outline: "none",
              fontFamily: "inherit",
            }}
          />
        </label>

        {contact && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              background: C.card,
              border: `1px solid ${C.line}`,
              borderRadius: 14,
              padding: "12px 14px",
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: "50%",
                background: C.orangeSoft,
                display: "grid",
                placeItems: "center",
                color: "#fe6c1c",
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {(contact.name || "?").slice(0, 1).toUpperCase()}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>{contact.name}</div>
              <div style={{ fontSize: 12.5, color: C.mut, fontFamily: "ui-monospace, monospace" }}>{short(contact.addr)}</div>
            </div>
            {contact.alias && contact.alias !== "addr" && (
              <span style={{ fontSize: 12, fontWeight: 700, color: "#fe6c1c" }}>@{contact.alias}</span>
            )}
          </div>
        )}

        {!contact && suggestions.length > 0 && (
          <div style={{ display: "grid", gap: 6 }}>
            {suggestions.map((c) => (
              <button
                key={c.id || c.alias}
                type="button"
                onClick={() => setRecipient(c.alias)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  textAlign: "left",
                  background: C.card,
                  border: `1px solid ${C.line}`,
                  borderRadius: 12,
                  padding: "10px 12px",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>{c.name}</div>
                  <div style={{ fontSize: 12, color: C.mut }}>@{c.alias}</div>
                </div>
              </button>
            ))}
          </div>
        )}

        <AmountField
          label={t("pay.amountUsdc")}
          value={amount}
          onChange={setAmount}
          placeholder="1"
          suffix="USDC"
          logo="/monedas/usdc.png"
        />

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14.5 }}>
          <span style={{ color: C.mut }}>{t("pay.youSend")}</span>
          <span style={{ fontWeight: 700, color: C.ink }}>
            {usdc != null ? `${fmt(usdc, 2, locale)} USDC` : "—"}
          </span>
        </div>

        {canSubmit && (
          <GasEstimatePanel
            estimate={gas.estimate}
            loading={gas.loading}
            error={gas.error}
            onRetry={gas.retry}
            fxRate={fxRate}
            locale={locale}
            t={t}
          />
        )}
      </Card>

      {(phase === "error" || errMsg) && phase !== "working" && (
        <Card style={{ background: "#FDECEA", color: C.red, fontSize: 14, lineHeight: 1.5 }}>{errMsg}</Card>
      )}

      <button
        onClick={submit}
        disabled={phase === "working" || !canSubmit}
        style={{
          ...btnOrange,
          background: C.orange,
          boxShadow: "none",
          opacity: phase === "working" || !canSubmit ? 0.5 : 1,
        }}
      >
        {phase === "working" ? t("pay.working") : t("pay.cta")}
      </button>
      </>
      )}
    </div>
  );
}

// ————— Convertir (ARS ↔ USDC) —————
function Convert({ address, balance, arsBalance, fxRate, onConvertArsUsdc, onConvertUsdcArs, onDone }) {
  const { t, locale } = useLanguage();
  const [direction, setDirection] = useState("ars_usdc"); // ars_usdc | usdc_ars
  const [amount, setAmount] = useState("");
  const [phase, setPhase] = useState("form");
  const [errMsg, setErrMsg] = useState("");
  const n = Number(amount);
  const sellIsArs = direction === "ars_usdc";
  const needsUserSignature = direction === "usdc_ars";

  const estimateConvertFn = useCallback(() => {
    if (!needsUserSignature || !Number.isFinite(n) || n <= 0) {
      return Promise.reject(new Error("Sin monto"));
    }
    return estimateConvertUsdcToArs({ from: address, usdcAmount: n, fxRate });
  }, [needsUserSignature, n, address, fxRate]);

  const gas = useGasEstimate({
    enabled: needsUserSignature && Number.isFinite(n) && n > 0 && phase === "form",
    from: address,
    to: "treasury",
    usdc: n,
    memo: `convert_usdc_ars:${n}:${fxRate}`,
    estimateFn: estimateConvertFn,
  });

  const feeUsdc =
    needsUserSignature && Number.isFinite(gas.estimate?.feeNative)
      ? Number(gas.estimate.feeNative)
      : 0;
  const feeReady = !needsUserSignature || (!gas.loading && !!gas.estimate && !gas.error);
  // USDC→ARS: el monto ingresado es el total que sale de la wallet; el fee se reserva y el resto se convierte.
  const transferUsdc = needsUserSignature
    ? feeReady
      ? Math.max(0, n - feeUsdc)
      : null
    : Number.isFinite(n) && n > 0
      ? n
      : null;

  const quote =
    sellIsArs
      ? Number.isFinite(n) && n > 0
        ? quoteArsToUsdc(n, fxRate)
        : null
      : transferUsdc != null && transferUsdc > 0
        ? quoteUsdcToArs(transferUsdc, fxRate)
        : null;

  const sellLogo = sellIsArs ? "/monedas/ars.png" : "/monedas/usdc.png";
  const buyLogo = sellIsArs ? "/monedas/usdc.png" : "/monedas/ars.png";
  const sellToken = sellIsArs ? "ARS" : "USDC";
  const buyToken = sellIsArs ? "USDC" : "ARS";
  const sellBalLabel = sellIsArs
    ? `$ ${fmtArs(arsBalance || 0)}`
    : balance === null
      ? "—"
      : `${fmt(balance, 2, locale)}`;

  const buyPrimary = quote
    ? sellIsArs
      ? fmt(quote.usdc, 2, locale)
      : fmtArs(quote.ars)
    : needsUserSignature && gas.loading
      ? "…"
      : "0";

  const sellSecondary =
    Number.isFinite(n) && n > 0
      ? sellIsArs
        ? quote
          ? `≈ ${fmt(quote.usdc, 2, locale)} USDC`
          : "—"
        : `$ ${fmtArs(n * fxRate)}`
      : "$ 0";

  const buySecondary = quote
    ? sellIsArs
      ? `$ ${fmtArs(n)}`
      : `≈ ${fmt(transferUsdc, 4, locale)} USDC`
    : "$ 0";

  const canSubmit =
    !!quote &&
    phase !== "working" &&
    !(needsUserSignature && !address) &&
    !(needsUserSignature && !feeReady) &&
    !(needsUserSignature && transferUsdc != null && transferUsdc <= 0);

  const flip = () => {
    const next = direction === "ars_usdc" ? "usdc_ars" : "ars_usdc";
    if (quote) {
      setAmount(direction === "ars_usdc" ? String(quote.usdc) : String(Number(quote.ars.toFixed(2))));
    } else {
      setAmount("");
    }
    setDirection(next);
    setErrMsg("");
    setPhase("form");
  };

  const setMax = () => {
    if (sellIsArs) {
      setAmount(String(Number((arsBalance || 0).toFixed(2))));
    } else if (balance != null) {
      // Monto bruto = saldo completo (incluye reserva para fee de red).
      setAmount(String(Number(Number(balance).toFixed(6))));
    }
  };

  const onAmountChange = (raw) => {
    setAmount(raw.replace(/[^\d.,]/g, "").replace(",", "."));
  };

  const submit = async () => {
    setErrMsg("");
    setPhase("working");
    try {
      if (!isTreasuryConfigured()) throw new Error(t("convert.treasuryMissing"));
      if (direction === "ars_usdc") {
        const result = await onConvertArsUsdc(n);
        onDone({
          kind: result.kind,
          ...result,
          parsed: {
            usdc: result.usdc,
            amount: result.ars,
            currency: "ARS",
            fxRate: result.fxRate,
            contact: { name: t("convert.treasuryLabel"), alias: "treasury" },
          },
          ts: new Date().toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
        });
        return;
      }

      if (!feeReady || transferUsdc == null || transferUsdc <= 0) {
        throw new Error(t("convert.feePending"));
      }
      if (balance !== null && n > balance) {
        throw new Error(t("voice.insufficientBalance", fmt(n, 2, locale), fmt(balance, 2, locale)));
      }

      const result = await onConvertUsdcArs(transferUsdc);
      onDone({
        kind: result.kind,
        ...result,
        fee: feeUsdc,
        parsed: {
          usdc: result.usdc,
          amount: result.usdc,
          currency: "USDC",
          fxRate: result.fxRate,
          contact: { name: t("convert.treasuryLabel"), alias: "treasury" },
        },
        ts: new Date().toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
      });
    } catch (e) {
      setErrMsg(String(e?.message || e));
      setPhase("error");
    }
  };

  const tokenPill = (logo, symbol) => (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        background: C.card,
        border: `1px solid ${C.line}`,
        borderRadius: 999,
        padding: "8px 12px 8px 8px",
      }}
    >
      <img src={logo} alt="" width={24} height={24} style={{ width: 24, height: 24, borderRadius: "50%", objectFit: "cover" }} />
      <span style={{ fontSize: 16, fontWeight: 700, color: C.ink }}>{symbol}</span>
    </div>
  );

  const panel = (side) => {
    const isSell = side === "sell";
    return (
      <div
        style={{
          background: C.bg,
          borderRadius: isSell ? "22px 22px 18px 18px" : "18px 18px 22px 22px",
          padding: "16px 18px 18px",
        }}
      >
        <div style={{ fontSize: 13.5, fontWeight: 600, color: C.mut, marginBottom: 10 }}>
          {isSell ? t("convert.sell") : t("convert.buy")}
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {isSell ? (
              <input
                value={amount}
                onChange={(e) => onAmountChange(e.target.value)}
                inputMode="decimal"
                placeholder="0"
                style={{
                  width: "100%",
                  border: "none",
                  background: "transparent",
                  fontSize: 36,
                  fontWeight: 600,
                  color: C.ink,
                  padding: 0,
                  fontFamily: "inherit",
                  outline: "none",
                  letterSpacing: -0.8,
                  lineHeight: 1.1,
                }}
              />
            ) : (
              <div
                style={{
                  fontSize: 36,
                  fontWeight: 600,
                  color: quote ? C.ink : C.mut,
                  letterSpacing: -0.8,
                  lineHeight: 1.1,
                  wordBreak: "break-all",
                }}
              >
                {buyPrimary}
              </div>
            )}
            <div style={{ fontSize: 14, color: C.mut, marginTop: 6 }}>
              {isSell ? sellSecondary : buySecondary}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10, flexShrink: 0 }}>
            {tokenPill(isSell ? sellLogo : buyLogo, isSell ? sellToken : buyToken)}
            {isSell && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.mut }}>
                <span>{sellBalLabel}</span>
                <button
                  type="button"
                  onClick={setMax}
                  disabled={sellIsArs ? !(arsBalance > 0) : !(balance > 0)}
                  style={{
                    border: "none",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    background: C.orangeSoft,
                    color: "#fe6c1c",
                    fontWeight: 700,
                    fontSize: 12,
                    borderRadius: 8,
                    padding: "4px 8px",
                    opacity: (sellIsArs ? arsBalance > 0 : balance > 0) ? 1 : 0.45,
                  }}
                >
                  {t("convert.max")}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 style={{ fontSize: 26, fontWeight: 700, color: C.ink, margin: 0, letterSpacing: -0.4 }}>{t("convert.title")}</h2>

      <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 6 }}>
        {panel("sell")}

        <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", zIndex: 2 }}>
          <button
            type="button"
            aria-label={t("convert.flip")}
            onClick={flip}
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              border: `4px solid #fff`,
              background: C.bg,
              color: C.ink,
              cursor: "pointer",
              display: "grid",
              placeItems: "center",
              padding: 0,
            }}
          >
            <IconArrowDown size={18} />
          </button>
        </div>

        {panel("buy")}
      </div>

      {phase === "working" && (
        <Card style={{ textAlign: "center", padding: 28 }}>
          <div style={{ display: "flex", justifyContent: "center", gap: 10, marginBottom: 14 }}>
            <img src={sellLogo} alt="" width={36} height={36} style={{ width: 36, height: 36, borderRadius: "50%" }} />
            <span style={{ color: C.mut, fontSize: 22, lineHeight: "36px" }}>→</span>
            <img src={buyLogo} alt="" width={36} height={36} style={{ width: 36, height: 36, borderRadius: "50%" }} />
          </div>
          <div style={{ fontSize: 17, fontWeight: 700, color: C.ink }}>{t("convert.working")}</div>
          <div style={{ fontSize: 13.5, color: C.mut, marginTop: 8 }}>{t("convert.workingHint")}</div>
        </Card>
      )}

      {(phase === "error" || errMsg) && phase !== "working" && (
        <Card style={{ background: "#FDECEA", color: C.red, fontSize: 14, lineHeight: 1.5 }}>{errMsg}</Card>
      )}

      <button
        onClick={submit}
        disabled={!canSubmit}
        style={{
          ...btnOrange,
          borderRadius: 18,
          background: C.orange,
          boxShadow: "none",
          opacity: canSubmit ? 1 : 0.5,
        }}
      >
        {phase === "working" ? t("convert.working") : needsUserSignature ? t("convert.ctaSign") : t("convert.cta")}
      </button>

      <div style={{ textAlign: "center", fontSize: 13, color: C.mut, fontWeight: 500 }}>
        1 USDC = ${fmtArs(fxRate)} ARS
      </div>

      {needsUserSignature && Number.isFinite(n) && n > 0 && phase === "form" && (
        <div
          style={{
            background: C.bg,
            borderRadius: 16,
            padding: "14px 16px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{t("convert.feeTitle")}</div>
            <div style={{ fontSize: 12.5, color: C.mut, marginTop: 2 }}>{t("convert.feeDeducted")}</div>
          </div>
          <div style={{ textAlign: "right", fontSize: 13.5, fontWeight: 700, color: C.ink }}>
            {gas.loading && <span style={{ color: C.mut, fontWeight: 600 }}>{t("convert.feePending")}</span>}
            {!gas.loading && gas.error && (
              <button
                type="button"
                onClick={gas.retry}
                style={{ background: "none", border: "none", color: C.orange, fontWeight: 700, cursor: "pointer", padding: 0, fontFamily: "inherit", fontSize: 13 }}
              >
                {t("gas.retry")}
              </button>
            )}
            {!gas.loading && !gas.error && feeReady && (
              <>
                <div>− {fmt(feeUsdc, 4, locale)} USDC</div>
                <div style={{ fontSize: 12.5, color: C.mut, fontWeight: 600, marginTop: 2 }}>
                  − $ {fmtArs(feeUsdc * fxRate)} ARS
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ————— Voz —————
function Voice({
  sendPayment,
  balance,
  onDone,
  fxRate,
  address,
  contacts,
  voiceKick = 0,
  onListeningChange,
  voiceApiRef,
  overlay = false,
  onClose,
}) {
  const { t, lang, locale } = useLanguage();
  const [phase, setPhase] = useState("idle");
  const [transcript, setTranscript] = useState("");
  const [parsed, setParsed] = useState(null);
  const [errMsg, setErrMsg] = useState("");
  const [manual, setManual] = useState("");
  const recRef = useRef(null);
  const supported = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);

  const analyze = useCallback(
    async (text) => {
      setTranscript(text);
      setPhase("parsing");
      if (contacts.length === 0) {
        setErrMsg(t("voice.noContactsYet"));
        setPhase("error");
        return;
      }
      let result;
      try {
        result = await claudeParse(text, lang, contacts.map((c) => c.alias));
      } catch {
        result = localParse(text, lang);
      }
      if (!result || result.intent !== "send" || !result.amount || !result.recipient) {
        setErrMsg(t("voice.noPaymentUnderstood"));
        setPhase("error");
        return;
      }
      const contact = findByAlias(contacts, result.recipient);
      if (!contact) {
        setErrMsg(t("voice.aliasNotFound", result.recipient));
        setPhase("error");
        return;
      }
      const usdc = result.currency === "ARS" ? result.amount / fxRate : result.amount;
      if (usdc < 0.01) {
        setErrMsg(t("voice.amountTooLow", result.amount, result.currency));
        setPhase("error");
        return;
      }
      if (balance !== null && usdc > balance) {
        setErrMsg(t("voice.insufficientBalance", fmt(usdc, 2, locale), fmt(balance, 2, locale)));
        setPhase("error");
        return;
      }
      setParsed({ ...result, contact, usdc, fxRate, factura: nuevaFactura() });
      setPhase("confirm");
    },
    [balance, fxRate, lang, locale, t, contacts]
  );

  const stopListen = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {}
    setPhase((p) => (p === "listening" ? "idle" : p));
  }, []);

  const listen = useCallback(() => {
    setErrMsg("");
    setTranscript("");
    if (!supported) {
      setErrMsg(t("voice.micUnsupported"));
      setPhase("error");
      return;
    }
    try {
      try {
        recRef.current?.stop();
      } catch {}
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      const rec = new SR();
      recRef.current = rec;
      const isSafari = /^((?!chrome|android|crios|edg).)*safari/i.test(navigator.userAgent);
      rec.lang = lang === "en" ? "en-US" : "es-AR";
      rec.interimResults = !isSafari;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      rec.onresult = (e) => {
        const txt = Array.from(e.results).map((r) => r[0].transcript).join(" ");
        setTranscript(txt);
        if (e.results[e.results.length - 1].isFinal) {
          rec.stop();
          analyze(txt);
        }
      };
      rec.onnomatch = () => {
        setErrMsg(t("voice.noSpeechMatch"));
        setPhase("error");
      };
      rec.onerror = (e) => {
        const msgs = t("voice.micErrors");
        setErrMsg(msgs[e.error] || t("voice.micErrGeneric", e.error));
        setPhase("error");
      };
      rec.onend = () => setPhase((p) => (p === "listening" ? "idle" : p));
      rec.start();
      setPhase("listening");
    } catch {
      setErrMsg(t("voice.micUnavailable"));
      setPhase("error");
    }
  }, [analyze, lang, supported, t]);

  useEffect(() => {
    onListeningChange?.(phase === "listening");
    return () => onListeningChange?.(false);
  }, [phase, onListeningChange]);

  useEffect(() => {
    if (!voiceApiRef) return undefined;
    voiceApiRef.current = {
      listen,
      stop: stopListen,
      toggle: () => {
        if (phase === "listening") stopListen();
        else listen();
      },
    };
    return () => {
      voiceApiRef.current = null;
    };
  }, [voiceApiRef, listen, stopListen, phase]);

  useEffect(() => {
    if (!voiceKick) return undefined;
    // Arrancar ya: no usar autoListen boolean (al limpiarlo cancelaba el timer).
    const timer = setTimeout(() => listen(), 50);
    return () => clearTimeout(timer);
  }, [voiceKick]); // eslint-disable-line react-hooks/exhaustive-deps

  const voiceMemo = useMemo(() => {
    if (!parsed) return "";
    return armarMemo({
      inv: parsed.factura,
      to: parsed.contact.alias,
      cur: parsed.currency,
      amt: parsed.amount,
      kind: "voice",
    });
  }, [parsed]);

  const gas = useGasEstimate({
    enabled: phase === "confirm" && Boolean(parsed),
    from: address,
    to: parsed?.contact?.addr,
    usdc: parsed?.usdc,
    memo: voiceMemo,
  });

  const execute = async () => {
    setPhase("sending");
    try {
      const r = await sendPayment(parsed);
      onDone({ ...r, parsed });
    } catch (err) {
      const m = String(err?.message || err);
      if (m.includes("limit reached") || m.includes("-32011") || m.includes("429")) {
        setErrMsg(t("voice.rpcLimited"));
      } else if (m.includes("insufficient funds")) {
        setErrMsg(t("voice.insufficientFundsOnchain"));
      } else if (m.includes("rejected") || m.includes("denied")) {
        setErrMsg(t("voice.signatureCancelled"));
      } else {
        setErrMsg(t("voice.txFailed", m.slice(0, 130)));
      }
      setPhase("error");
    }
  };

  const reset = () => {
    setPhase("idle");
    setParsed(null);
    setTranscript("");
    setErrMsg("");
  };

  const active = phase === "listening";

  // Overlay FAB: solo estado de escucha + transcript (sin segunda pantalla / segundo mic).
  if (overlay && (phase === "idle" || phase === "listening" || phase === "parsing")) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: 1, justifyContent: "flex-end" }}>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          {onClose && (
            <button
              type="button"
              onClick={() => {
                stopListen();
                onClose();
              }}
              aria-label={t("voice.cancel")}
              style={{
                width: 36,
                height: 36,
                borderRadius: 12,
                border: `1px solid ${C.line}`,
                background: C.bg,
                color: C.ink,
                cursor: "pointer",
                fontSize: 20,
                lineHeight: 1,
                fontFamily: "inherit",
              }}
            >
              ×
            </button>
          )}
        </div>
        <Card style={{ padding: "28px 22px 32px", textAlign: "center" }}>
          <div style={{ position: "relative", height: 28, marginBottom: 8 }}>
            {active && [0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  width: 18,
                  height: 18,
                  marginLeft: -9,
                  marginTop: -9,
                  borderRadius: "50%",
                  border: "1.5px solid rgba(254, 108, 28, 0.45)",
                  animation: `mp-voice-ring 2.2s ${i * 0.65}s ease-out infinite`,
                }}
              />
            ))}
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: phase === "parsing" ? "#fe6c1c" : C.ink }}>
            {phase === "parsing" ? t("voice.parsing", transcript) : t("voice.listening")}
          </div>
          <div
            style={{
              marginTop: 16,
              minHeight: 72,
              fontSize: 20,
              fontWeight: 600,
              color: transcript ? C.ink : C.mut,
              lineHeight: 1.4,
              wordBreak: "break-word",
            }}
          >
            {phase === "parsing" ? null : (transcript || t("voice.listeningPlaceholder"))}
          </div>
          <div style={{ fontSize: 13, color: C.mut, marginTop: 12 }}>
            {active ? t("voice.fabListeningHint") : t("voice.listeningHint")}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, flex: 1 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: 26, fontWeight: 700, color: C.ink, margin: 0, letterSpacing: -0.4 }}>{t("voice.title")}</h2>
          <p style={{ fontSize: 15, color: C.mut, marginTop: 6 }}>{t("voice.subtitle")}</p>
        </div>
        {overlay && onClose && (
          <button
            type="button"
            onClick={() => {
              stopListen();
              onClose();
            }}
            aria-label={t("voice.cancel")}
            style={{
              width: 36,
              height: 36,
              borderRadius: 12,
              border: `1px solid ${C.line}`,
              background: C.bg,
              color: C.ink,
              cursor: "pointer",
              fontSize: 20,
              lineHeight: 1,
              fontFamily: "inherit",
              flexShrink: 0,
            }}
          >
            ×
          </button>
        )}
      </div>

      {(phase === "idle" || phase === "listening" || phase === "parsing") && (
        <>
          <Card style={{ display: "grid", placeItems: "center", padding: "36px 20px 28px" }}>
            <div style={{ position: "relative", width: 176, height: 176, display: "grid", placeItems: "center" }}>
              {active && [0, 1, 2].map((i) => (
                <div
                  key={i}
                  style={{
                    position: "absolute",
                    inset: 18,
                    borderRadius: "50%",
                    border: "1.5px solid rgba(254, 108, 28, 0.45)",
                    animation: `mp-voice-ring 2.2s ${i * 0.65}s ease-out infinite`,
                  }}
                />
              ))}
              <button
                onClick={active ? stopListen : listen}
                className={`mp-chrome-orb${active ? " is-listening" : ""}`}
                disabled={phase === "parsing"}
                aria-label={active ? t("voice.listening") : t("nav.voiceAria")}
              >
                {phase === "parsing" ? (
                  <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: 2 }}>···</span>
                ) : (
                  <IconMic size={42} />
                )}
              </button>
            </div>
            <div style={{ marginTop: 18, textAlign: "center", width: "100%", maxWidth: 320 }}>
              {phase === "idle" && <span style={{ fontSize: 14.5, color: C.mut }}>{t("voice.idleHint")}</span>}
              {active && (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#fe6c1c", letterSpacing: 0.2 }}>{t("voice.listening")}</div>
                  <div
                    style={{
                      marginTop: 10,
                      minHeight: 52,
                      fontSize: 18,
                      fontWeight: 600,
                      color: C.ink,
                      lineHeight: 1.35,
                      wordBreak: "break-word",
                    }}
                  >
                    {transcript || t("voice.listeningPlaceholder")}
                  </div>
                  <div style={{ fontSize: 12.5, color: C.mut, marginTop: 8 }}>{t("voice.listeningHint")}</div>
                </>
              )}
              {phase === "parsing" && (
                <span style={{ fontSize: 14.5, color: "#fe6c1c", fontWeight: 600 }}>{t("voice.parsing", transcript)}</span>
              )}
            </div>
          </Card>

          <Card>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.mut, marginBottom: 10 }}>{t("voice.orType")}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && manual.trim() && analyze(manual.trim())}
                placeholder={t("voice.inputPlaceholder")}
                style={{
                  flex: 1,
                  background: C.card,
                  border: `1px solid ${C.line}`,
                  borderRadius: 12,
                  padding: "13px 14px",
                  fontSize: 15,
                  color: C.ink,
                  outline: "none",
                  fontFamily: "inherit",
                }}
              />
              <button
                onClick={() => manual.trim() && analyze(manual.trim())}
                style={{
                  ...btnOrange,
                  width: 52,
                  padding: 0,
                  background: C.orange,
                  boxShadow: "none",
                }}
              >
                →
              </button>
            </div>
            <button
              onClick={() => analyze(t("voice.exampleCommand"))}
              style={{ background: "none", border: "none", color: "#fe6c1c", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0, marginTop: 12, fontFamily: "inherit" }}
            >
              {t("voice.tryExample")}
            </button>
            {!import.meta.env.VITE_ANTHROPIC_API_KEY && (
              <div style={{ fontSize: 12, color: C.mut, marginTop: 10 }}>{t("voice.noApiKeyHint")}</div>
            )}
          </Card>
        </>
      )}

      {phase === "confirm" && parsed && (
        <>
          <Card>
            <div style={{ fontSize: 13.5, color: C.mut }}>«{transcript}»</div>
            <div style={{ display: "flex", alignItems: "center", gap: 13, margin: "18px 0" }}>
              <div
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: "50%",
                  background: C.orangeSoft,
                  display: "grid",
                  placeItems: "center",
                  color: "#fe6c1c",
                  fontWeight: 700,
                  fontSize: 15,
                }}
              >
                {parsed.contact.name.slice(0, 1).toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16.5, fontWeight: 700, color: C.ink }}>{parsed.contact.name}</div>
                <div style={{ fontSize: 13, color: C.mut, fontFamily: "ui-monospace, monospace" }}>{short(parsed.contact.addr)}</div>
              </div>
            </div>
            <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 16, display: "grid", gap: 10 }}>
              {[
                [t("voice.amount"), `${fmt(parsed.usdc, 2, locale)} USDC`],
                parsed.currency === "ARS" ? [t("voice.equals"), `$${fmtArs(parsed.amount)} ARS`] : [t("voice.equals"), `$${fmtArs(parsed.usdc * parsed.fxRate)} ARS`],
                [t("voice.exchangeRate"), `1 USDC = $${fmtArs(parsed.fxRate)} ARS`],
                [t("voice.invoice"), parsed.factura],
                [t("voice.network"), "Arc Testnet"],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 14.5 }}>
                  <span style={{ color: C.mut }}>{k}:</span>
                  <span style={{ color: C.ink, fontWeight: 600 }}>{v}</span>
                </div>
              ))}
            </div>
            <GasEstimatePanel
              estimate={gas.estimate}
              loading={gas.loading}
              error={gas.error}
              onRetry={gas.retry}
              fxRate={parsed.fxRate || fxRate}
              locale={locale}
              t={t}
            />
            <div
              style={{
                background: C.card,
                borderRadius: 12,
                padding: "12px 14px",
                marginTop: 16,
                fontSize: 12.5,
                color: C.mut,
                lineHeight: 1.5,
                border: `1px solid ${C.line}`,
              }}
            >
              {t("voice.memoNote")}
            </div>
          </Card>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button
              onClick={execute}
              disabled={!address || gas.loading}
              style={{
                ...btnOrange,
                opacity: !address || gas.loading ? 0.5 : 1,
                background: "linear-gradient(180deg, #ffb58d, #fe6c1c)",
                boxShadow: "0 10px 22px rgba(254,108,28,.28)",
              }}
            >
              {t("voice.confirmSend")}
            </button>
            <button onClick={reset} style={{ ...btnOutline, border: "none", color: C.mut }}>{t("voice.cancel")}</button>
          </div>
        </>
      )}

      {phase === "sending" && (
        <Card style={{ textAlign: "center", padding: 40 }}>
          <div className="mp-chrome-orb" style={{ width: 72, height: 72, margin: "0 auto 18px", pointerEvents: "none" }}>
            <IconMic size={28} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.ink }}>{t("voice.sending")}</div>
          <div style={{ fontSize: 14, color: C.mut, marginTop: 8 }}>{t("voice.sendingHint")}</div>
        </Card>
      )}

      {phase === "error" && (
        <>
          <Card style={{ borderLeft: `4px solid ${C.red}`, background: "#FFF6F4" }}>
            <div style={{ fontSize: 15, color: C.ink, lineHeight: 1.5 }}>{errMsg}</div>
          </Card>
          <button
            onClick={reset}
            style={{
              ...btnOrange,
              background: "linear-gradient(180deg, #ffb58d, #fe6c1c)",
              boxShadow: "0 10px 22px rgba(254,108,28,.28)",
            }}
          >
            {t("voice.retry")}
          </button>
        </>
      )}
    </div>
  );
}

// ————— Detalle de transacción (compartido: Success + TxCard) —————
function TxDetail({ usdc, ars, fx, fee, block, factura, hash, time, hideFx = false }) {
  const { t, locale } = useLanguage();
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontSize: 17, fontWeight: 700, color: C.ink, marginBottom: 14 }}>{t("success.operation")}</div>
      <div style={{ display: "grid", gap: 10, fontSize: 14.5 }}>
        {[
          hideFx ? null : [t("success.amountSent"), `${fmt(usdc, 2, locale)} USDC`],
          [hideFx ? t("guest.youPay") : t("success.equals"), `$${fmtArs(ars)} ARS`],
          hideFx ? null : [t("success.exchangeRate"), `1 USDC = $${fmtArs(fx)} ARS`],
          hideFx ? null : [t("success.networkFee"), fee ? `${Number(fee).toFixed(6)} USDC` : "—"],
          block ? [t("success.block"), String(block)] : null,
          [t("success.time"), time],
        ].filter(Boolean).map(([k, v]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: C.mut }}>{k}:</span>
            <span style={{ color: C.ink, fontWeight: 600 }}>{v}</span>
          </div>
        ))}
      </div>
      <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 16, paddingTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14.5 }}>
          <span style={{ color: C.mut }}>{t("success.invoiceLabel")}</span>
          <span style={{ color: C.green, fontWeight: 700 }}>{factura} · {t("success.onchainCheck")}</span>
        </div>
        <a href={`${ARC.explorer}/tx/${hash}`} target="_blank" rel="noreferrer" style={{ display: "block", marginTop: 12, fontSize: 13.5, color: "#fe6c1c", fontWeight: 600, textDecoration: "none", wordBreak: "break-all" }}>
          {t("success.viewOnArcScan", short(hash))}
        </a>
      </div>
    </div>
  );
}

// ————— Éxito a pantalla completa —————
function Success({ receipt, onClose, hideFx = false }) {
  const { t, locale } = useLanguage();
  const [detalle, setDetalle] = useState(false);
  const [splash, setSplash] = useState(true);
  const kind = receipt.kind || "voice";

  useEffect(() => {
    const timer = setTimeout(() => setSplash(false), 1800);
    return () => clearTimeout(timer);
  }, []);

  const isChargeIn = kind === "charge" || (kind === "charge_p2p" && receipt.direction === "in");

  const splashTitle =
    hideFx ? t("guest.successSplash")
      : isChargeIn ? t("success.splashCharge")
        : kind === "convert_ars_usdc" || kind === "convert_usdc_ars" ? t("success.splashConvert")
          : t("success.splashTitle");

  const summary = () => {
    if (hideFx) {
      const p = receipt.parsed || {};
      const who = p.contact?.name || t("guest.merchant");
      return t("guest.paidSummary", who, fmtArs(p.amount ?? receipt.ars));
    }
    if (isChargeIn) return t("success.chargeSummary", fmtArs(receipt.ars), fmt(receipt.usdc, 2, locale));
    if (kind === "convert_ars_usdc") return t("success.convertArsUsdcSummary", fmtArs(receipt.ars), fmt(receipt.usdc, 2, locale));
    if (kind === "convert_usdc_ars") return t("success.convertUsdcArsSummary", fmt(receipt.usdc, 2, locale), fmtArs(receipt.ars));
    const p = receipt.parsed;
    return t("success.sentSummary", fmt(p.usdc, 2, locale), p.contact.name);
  };

  const nextTab = isChargeIn ? "charge" : kind?.startsWith("convert") ? "convert" : kind === "pay" || kind === "charge_p2p" ? "pay" : "voice";
  const nextLabel = isChargeIn ? t("success.anotherCharge") : kind?.startsWith("convert") ? t("success.anotherConvert") : t("success.anotherPayment");

  if (splash) {
    return (
      <div className="mp-overlay" style={{ background: C.green, flexDirection: "column", gap: 24 }}>
        <div style={{ fontSize: 30, fontWeight: 700, color: "#fff", textAlign: "center", padding: "0 24px" }}>{splashTitle}</div>
        <div style={{ width: 74, height: 74, borderRadius: "50%", background: "#fff", display: "grid", placeItems: "center", color: C.green, fontSize: 38 }}>✓</div>
      </div>
    );
  }

  const p = receipt.parsed || {};
  const fx = receipt.fxRate || p.fxRate || FALLBACK_FX_ARS_USD;
  const usdc = receipt.usdc ?? p.usdc;
  const ars = receipt.ars ?? (usdc * fx);

  if (hideFx) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          minHeight: "70%",
          padding: "32px 18px 24px",
          boxSizing: "border-box",
          gap: 16,
        }}
      >
        <div style={{ width: 72, height: 72, borderRadius: "50%", background: C.green, display: "grid", placeItems: "center", color: "#fff", fontSize: 34 }}>✓</div>
        <div style={{ fontSize: 26, fontWeight: 700, color: C.ink, letterSpacing: -0.3 }}>{t("guest.successTitle")}</div>
        <div style={{ fontSize: 17, fontWeight: 600, color: C.ink, lineHeight: 1.45, maxWidth: 280 }}>{summary()}</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
        <div style={{ width: 44, height: 44, borderRadius: "50%", background: C.green, display: "grid", placeItems: "center", color: "#fff", fontSize: 22 }}>✓</div>
        <div style={{ fontSize: 26, fontWeight: 700, color: C.ink }}>{t("success.doneTitle")}</div>
      </div>

      <Card>
        <div style={{ fontSize: 18, fontWeight: 700, color: C.ink, lineHeight: 1.35 }}>{summary()}</div>
        {kind === "convert_usdc_ars" && (
          <div style={{ marginTop: 12, padding: "12px 14px", background: C.orangeSoft, borderRadius: 12, fontSize: 14, color: "#fe6c1c", lineHeight: 1.45, display: "flex", alignItems: "center", gap: 8 }}>
            <img src="/monedas/ars.png" alt="" width={20} height={20} style={{ width: 20, height: 20, borderRadius: "50%" }} />
            {t("success.arsCredited", fmtArs(ars))}
          </div>
        )}
        <button
          onClick={() => setDetalle(!detalle)}
          style={{ background: C.orangeSoft, color: "#fe6c1c", border: "none", borderRadius: 20, padding: "6px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", marginTop: 12, fontFamily: "inherit" }}
        >
          {t("success.viewDetail")} {detalle ? "⌃" : "⌄"}
        </button>

        {detalle && (
          <TxDetail
            usdc={usdc}
            ars={ars}
            fx={fx}
            fee={receipt.fee}
            block={receipt.block}
            factura={receipt.factura}
            hash={receipt.hash}
            time={receipt.ts}
          />
        )}
      </Card>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <button
          onClick={() => onClose(nextTab)}
          style={{
            ...btnOrange,
            background: C.orange,
            boxShadow: "none",
          }}
        >
          {nextLabel}
        </button>
        <button onClick={() => onClose("home")} style={btnOutline}>{t("success.backHome")}</button>
      </div>
    </div>
  );
}

// ————— Movimientos —————
/** Card de movimiento — home (compact) y pantalla Movimientos. */
function TxCard({ tx, compact = false }) {
  const { t, locale } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const inbound = tx.direction === "in";
  const isConvert = tx.kind === "convert_ars_usdc" || tx.kind === "convert_usdc_ars";
  const arsEq = tx.ars;

  const title = isConvert
    ? tx.kind === "convert_ars_usdc"
      ? "ARS → USDC"
      : "USDC → ARS"
    : tx.kind === "charge" || (tx.kind === "charge_p2p" && inbound)
      ? t("movs.charge")
      : tx.who;

  const primary =
    isConvert && tx.kind === "convert_ars_usdc"
      ? `+${fmt(tx.amt, 2, locale)} USDC`
      : isConvert && tx.kind === "convert_usdc_ars"
        ? `−${fmt(tx.amt, 2, locale)} USDC`
        : `${inbound ? "+" : "−"}${fmt(tx.amt, 2, locale)} USDC`;

  const secondary =
    isConvert && tx.kind === "convert_ars_usdc"
      ? `−${fmtArs(arsEq)} ARS`
      : isConvert && tx.kind === "convert_usdc_ars"
        ? `+${fmtArs(arsEq)} ARS`
        : `${inbound ? "+" : "−"}${fmtArs(arsEq)} ARS`;

  const iconBg = isConvert ? C.orangeSoft : inbound ? C.orangeSoft : C.violetSoft;
  const iconColor = isConvert ? "#fe6c1c" : inbound ? C.orange : C.violet;

  const time = tx.createdAt
    ? new Date(tx.createdAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })
    : "—";

  return (
    <Card style={{ padding: compact ? 16 : 18 }}>
      <div
        onClick={compact ? undefined : () => setExpanded((v) => !v)}
        style={{ display: "flex", alignItems: "center", gap: 13, cursor: compact ? "default" : "pointer" }}
      >
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: "50%",
            background: iconBg,
            display: "grid",
            placeItems: "center",
            color: iconColor,
            flexShrink: 0,
          }}
        >
          {isConvert ? <IconSwap size={18} /> : inbound ? <IconArrowDown size={18} /> : <IconArrowUp size={18} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15.5, fontWeight: 700, color: C.ink, whiteSpace: "nowrap" }}>{title}</div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 15.5, fontWeight: 700, color: C.ink }}>{primary}</div>
          <div style={{ fontSize: 13, color: C.mut, marginTop: 2 }}>{secondary}</div>
          {!compact && (
            <a
              href={`${ARC.explorer}/tx/${tx.hash}`}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{
                display: "inline-block",
                marginTop: 8,
                textDecoration: "none",
                fontFamily: "inherit",
                fontSize: 12,
                fontWeight: 700,
                color: C.ink,
                background: C.card,
                border: `1.5px solid ${C.line}`,
                borderRadius: 8,
                padding: "5px 10px",
              }}
            >
              ArcScan ↗
            </a>
          )}
        </div>
      </div>

      {!compact && expanded && (
        <TxDetail
          usdc={tx.amt}
          ars={tx.ars}
          fx={tx.fxRate}
          fee={tx.fee}
          block={tx.block}
          factura={tx.factura}
          hash={tx.hash}
          time={time}
        />
      )}
    </Card>
  );
}

function Movimientos({ txs, address }) {
  const { t } = useLanguage();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <h2 style={{ fontSize: 26, fontWeight: 700, color: C.ink, margin: 0, letterSpacing: -0.4 }}>{t("movs.title")}</h2>
        <p style={{ fontSize: 14.5, color: C.mut, marginTop: 6 }}>
          {txs.length === 0 ? t("movs.countEmpty") : t("movs.countN", txs.length)}
        </p>
      </div>

      {txs.length === 0 ? (
        <Card style={{ fontSize: 14, color: C.mut, lineHeight: 1.55 }}>{t("movs.emptyBody")}</Card>
      ) : (
        txs.map((tx) => <TxCard key={tx.hash} tx={tx} />)
      )}

      <a
        href={`${ARC.explorer}/address/${address}`}
        target="_blank"
        rel="noreferrer"
        style={{
          ...btnOutline,
          textDecoration: "none",
          textAlign: "center",
          display: "block",
          border: `1.5px solid ${C.line}`,
          color: C.ink,
          background: C.card,
        }}
      >
        {t("movs.viewFullHistory")}
      </a>
    </div>
  );
}

// ————— Más (menú) —————
function Mas({ email, address, nombre, onLogout, goStack }) {
  const { t, lang, setLang } = useLanguage();
  const [confirmar, setConfirmar] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const Fila = ({ icon, titulo, sub, onClick, href, danger }) => {
    const inner = (
      <>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            background: danger ? "#FDECEA" : C.orangeSoft,
            display: "grid",
            placeItems: "center",
            color: danger ? C.red : "#fe6c1c",
            flexShrink: 0,
          }}
        >
          {icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15.5, fontWeight: 600, color: danger ? C.red : C.ink }}>{titulo}</div>
          {sub && <div style={{ fontSize: 12.5, color: C.mut, marginTop: 1 }}>{sub}</div>}
        </div>
        <span style={{ color: C.mut, display: "grid", placeItems: "center" }}><IconChevron /></span>
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
      <h2 style={{ fontSize: 26, fontWeight: 700, color: C.ink, margin: 0, letterSpacing: -0.4 }}>{t("mas.title")}</h2>

      <Card style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ width: 52, height: 52, borderRadius: "50%", background: C.orangeSoft, display: "grid", placeItems: "center", color: "#fe6c1c", fontSize: 20, fontWeight: 700 }}>
          {(nombre || "?").slice(0, 1).toUpperCase()}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: C.ink }}>{nombre}</div>
          <div style={{ fontSize: 13, color: C.mut, overflow: "hidden", textOverflow: "ellipsis" }}>{email || t("mas.noEmailAccount")}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
            <span style={{ fontSize: 12, color: C.mut, fontFamily: "ui-monospace, monospace" }}>{short(address)}</span>
            <button
              onClick={copyAddress}
              style={{
                background: C.card,
                border: "none",
                borderRadius: 20,
                padding: "4px 12px",
                fontSize: 12,
                fontWeight: 600,
                color: "#fe6c1c",
                cursor: "pointer",
                fontFamily: "inherit",
                flexShrink: 0,
              }}
            >
              {copied ? t("home.copied") : t("home.copy")}
            </button>
          </div>
        </div>
      </Card>

      <Card style={{ padding: "4px 20px" }}>
        <Fila icon={<IconStack size={20} />} titulo={t("mas.stackTitle")} sub={t("mas.stackSub")} onClick={goStack} />
        <div style={{ height: 1, background: C.line }} />
        <Fila icon={<IconFaucet />} titulo={t("mas.faucetTitle")} sub={t("mas.faucetSub")} href={ARC.faucet} />
        <div style={{ height: 1, background: C.line }} />
        <Fila icon={<IconSearch />} titulo={t("mas.arcscanTitle")} sub={t("mas.arcscanSub")} href={`${ARC.explorer}/address/${address}`} />
      </Card>

      <Card style={{ padding: "4px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 13, padding: "14px 0" }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: C.orangeSoft, display: "grid", placeItems: "center", color: "#fe6c1c" }}>
            <IconGlobe />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15.5, fontWeight: 600, color: C.ink }}>{t("mas.languageTitle")}</div>
            <div style={{ fontSize: 12.5, color: C.mut, marginTop: 1 }}>{lang === "en" ? "English" : "Español"}</div>
          </div>
          <LangToggle />
        </div>
      </Card>

      <Card style={{ padding: "4px 20px" }}>
        <Fila icon={<IconLogout />} titulo={t("mas.logoutTitle")} danger onClick={() => setConfirmar(true)} />
      </Card>

      <p style={{ fontSize: 11.5, color: C.mut, textAlign: "center", lineHeight: 1.6 }}>
        {t("mas.footerLine1")}
        <br />
        {t("mas.footerLine2")}
      </p>

      {confirmar && (
        <div className="mp-overlay" style={{ background: "rgba(16,16,22,.45)", alignItems: "flex-end" }} onClick={() => setConfirmar(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: C.card, borderRadius: "24px 24px 0 0", padding: "26px 22px 30px", width: "100%" }}
          >
            <div style={{ width: 42, height: 4, borderRadius: 4, background: C.line, margin: "0 auto 20px" }} />
            <div style={{ fontSize: 19, fontWeight: 700, color: C.ink }}>{t("mas.logoutConfirmTitle")}</div>
            <div style={{ fontSize: 14.5, color: C.mut, marginTop: 8, lineHeight: 1.5 }}>{t("mas.logoutConfirmBody")}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 22 }}>
              <button onClick={onLogout} style={{ ...btnOrange, background: C.red }}>{t("mas.logoutConfirmBtn")}</button>
              <button onClick={() => setConfirmar(false)} style={{ ...btnOutline, border: `1.5px solid ${C.line}`, color: C.ink }}>{t("mas.cancel")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ————— Stack —————
function Stack() {
  const { t, lang } = useLanguage();
  const STACK = lang === "en" ? STACK_EN : STACK_ES;
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
        <h2 style={{ fontSize: 26, fontWeight: 700, color: C.ink, margin: 0, letterSpacing: -0.4 }}>{t("stackScreen.title")}</h2>
        <p style={{ fontSize: 14.5, color: C.mut, marginTop: 6, lineHeight: 1.5 }}>{t("stackScreen.subtitle")}</p>
      </div>

      <div style={{ fontSize: 13, fontWeight: 700, color: C.green, marginTop: 4 }}>{t("stackScreen.implemented")}</div>
      {activos.map((s) => <Item key={s.name} s={s} />)}

      <div style={{ fontSize: 13, fontWeight: 700, color: C.mut, marginTop: 10 }}>{t("stackScreen.roadmap")}</div>
      {road.map((s) => <Item key={s.name} s={s} />)}
    </div>
  );
}

function errorMessage(t, field, reason) {
  if (field === "alias" && reason === "duplicate") return t("agenda.errors.aliasDuplicate");
  return t(`agenda.errors.${field}`);
}

// ————— Agenda —————
function ContactsScreen({ contacts, onAdd, onUpdate, onRemove }) {
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const [form, setForm] = useState(null); // null = cerrado; { } = nuevo o edición
  const [errors, setErrors] = useState({});
  const [copiedId, setCopiedId] = useState(null);
  const [saving, setSaving] = useState(false);

  const visible = searchContacts(contacts, query);
  const editingId = form?.id || null;

  const openNew = () => { setForm({ name: "", alias: "", addr: "", note: "" }); setErrors({}); };
  const openEdit = (c) => { setForm({ ...c }); setErrors({}); };
  const close = () => { setForm(null); setErrors({}); };

  const save = async () => {
    const check = validateContact(form, contacts, editingId);
    if (!check.valid) {
      setErrors(check.errors);
      return;
    }
    setSaving(true);
    try {
      if (editingId) await onUpdate(editingId, form);
      else await onAdd(form);
      close();
    } catch (err) {
      setErrors(err?.code === "alias_duplicate" ? { alias: "duplicate" } : { server: true });
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      await onRemove(editingId);
      close();
    } catch {
      setErrors({ server: true });
    } finally {
      setSaving(false);
    }
  };

  const copy = async (c) => {
    try {
      await navigator.clipboard.writeText(c.addr);
      setCopiedId(c.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {}
  };

  const field = (key, label, placeholder) => (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: C.mut, marginBottom: 8 }}>{label}</div>
      <input
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        placeholder={placeholder}
        style={{
          width: "100%",
          background: errors[key] ? "#FDECEA" : C.card,
          border: errors[key] ? `1.5px solid ${C.red}` : `1px solid ${C.line}`,
          borderRadius: 14,
          padding: "14px 16px",
          fontSize: 15,
          color: C.ink,
          outline: "none",
          fontFamily: "inherit",
          boxSizing: "border-box",
        }}
      />
      {errors[key] && <div style={{ fontSize: 12.5, color: C.red, marginTop: 6 }}>{errorMessage(t, key, errors[key])}</div>}
    </label>
  );

  const primaryBtn = {
    ...btnOrange,
    background: "linear-gradient(180deg, #ffb58d, #fe6c1c)",
    boxShadow: "0 10px 22px rgba(254,108,28,.28)",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2 style={{ fontSize: 26, fontWeight: 700, color: C.ink, margin: 0, letterSpacing: -0.4 }}>{t("agenda.title")}</h2>
        <p style={{ fontSize: 14.5, color: C.mut, marginTop: 6, lineHeight: 1.5 }}>{t("agenda.subtitle")}</p>
      </div>

      {!form && (
        <>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("agenda.searchPlaceholder")}
            style={{
              background: C.bg,
              border: `1px solid ${C.line}`,
              borderRadius: 14,
              padding: "13px 16px",
              fontSize: 15,
              color: C.ink,
              outline: "none",
              fontFamily: "inherit",
            }}
          />

          <button onClick={openNew} style={primaryBtn}>{t("agenda.addButton")}</button>

          {visible.length === 0 ? (
            <Card style={{ fontSize: 14, color: C.mut, lineHeight: 1.55 }}>
              <div style={{ fontWeight: 700, color: C.ink, marginBottom: 6 }}>{t("agenda.emptyTitle")}</div>
              {t("agenda.emptyBody")}
            </Card>
          ) : (
            visible.map((c) => (
              <Card key={c.id} style={{ padding: 16, display: "flex", alignItems: "center", gap: 13 }}>
                <button
                  onClick={() => openEdit(c)}
                  style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 13, flex: 1, minWidth: 0, textAlign: "left", fontFamily: "inherit", padding: 0 }}
                >
                  <span
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: "50%",
                      background: C.orangeSoft,
                      display: "grid",
                      placeItems: "center",
                      color: "#fe6c1c",
                      fontWeight: 700,
                      fontSize: 15,
                      flexShrink: 0,
                    }}
                  >
                    {c.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15.5, fontWeight: 600, color: C.ink }}>{c.name}</div>
                    <div style={{ fontSize: 13, color: C.mut }}>@{c.alias} · {short(c.addr)}</div>
                  </span>
                </button>
                <button
                  onClick={() => copy(c)}
                  style={{
                    background: C.card,
                    border: "none",
                    borderRadius: 20,
                    padding: "6px 12px",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#fe6c1c",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    flexShrink: 0,
                  }}
                >
                  {copiedId === c.id ? t("agenda.copied") : t("agenda.copy")}
                </button>
              </Card>
            ))
          )}
        </>
      )}

      {form && (
        <Card style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {errors.server && (
            <div style={{ background: "#FDECEA", borderRadius: 12, padding: "12px 14px", fontSize: 13.5, color: C.red }}>
              {t("agenda.errors.server")}
            </div>
          )}
          {field("name", t("agenda.form.nameLabel"), t("agenda.form.namePlaceholder"))}
          {field("alias", t("agenda.form.aliasLabel"), t("agenda.form.aliasPlaceholder"))}
          {field("addr", t("agenda.form.addressLabel"), t("agenda.form.addressPlaceholder"))}
          {field("note", t("agenda.form.noteLabel"), t("agenda.form.notePlaceholder"))}

          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
            <button onClick={save} disabled={saving} style={{ ...primaryBtn, opacity: saving ? 0.6 : 1 }}>
              {editingId ? t("agenda.form.save") : t("agenda.form.saveNew")}
            </button>
            <button onClick={close} disabled={saving} style={{ ...btnOutline, border: "none", color: C.mut }}>
              {t("agenda.form.cancel")}
            </button>
            {editingId && (
              <button
                onClick={del}
                disabled={saving}
                style={{ ...btnOutline, border: `1.5px solid ${C.red}`, color: C.red }}
              >
                {t("agenda.form.delete")}
              </button>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

// ————— App —————
function AppInner() {
  const { t, locale } = useLanguage();
  const { ready, authenticated, user, login, logout, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const [tab, setTab] = useState("home");
  const [balance, setBalance] = useState(null);
  const [arsBalance, setArsBalance] = useState(0);
  const [treasuryBalance, setTreasuryBalance] = useState(null);
  const [txs, setTxs] = useState([]);
  const txsRef = useRef(txs);
  txsRef.current = txs;
  const [receipt, setReceipt] = useState(null);
  const [walletError, setWalletError] = useState("");
  const [fxRate, setFxRate] = useState(FALLBACK_FX_ARS_USD);
  const [voiceKick, setVoiceKick] = useState(0);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const voiceApiRef = useRef(null);
  const [pendingScan, setPendingScan] = useState(null);
  const [guestMode, setGuestMode] = useState(false);
  const [guestInitialScan, setGuestInitialScan] = useState(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const wantsGuest = url.searchParams.get("guest") === "1" || url.searchParams.get("cliente") === "1";
    if (wantsGuest) {
      setGuestMode(true);
      url.searchParams.delete("guest");
      url.searchParams.delete("cliente");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  useEffect(() => {
    const parsed = parsePayUrl(window.location.href);
    if (!parsed) return;
    setPendingScan(parsed);
    setGuestInitialScan(parsed);
    if (ready && authenticated) {
      setTab("pay");
      const url = new URL(window.location.href);
      url.searchParams.delete("pay");
      window.history.replaceState({}, "", url.toString());
    }
  }, [ready, authenticated]);

  useEffect(() => {
    if (!guestMode || !guestInitialScan) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("pay")) return;
    url.searchParams.delete("pay");
    window.history.replaceState({}, "", url.toString());
  }, [guestMode, guestInitialScan]);

  const wallet = useMemo(() => wallets.find((w) => w.walletClientType === "privy") || wallets[0], [wallets]);
  const address = wallet?.address || "";
  const treasuryAddress = useMemo(() => getTreasuryAddress(), []);
  const email = user?.email?.address || user?.phone?.number || "";
  const nombre = email ? email.split("@")[0].split(/[.\-_]/)[0].replace(/^./, (c) => c.toUpperCase()) : "👋";

  const { createWallet } = useCreateWallet({
    onError: (err) => setWalletError(String(err?.message || err)),
  });
  const walletCreateAttempted = useRef(false);

  useEffect(() => {
    if (!ready || !authenticated || wallets.length > 0 || walletCreateAttempted.current) return;
    walletCreateAttempted.current = true;
    createWallet().catch((err) => setWalletError(String(err?.message || err)));
  }, [ready, authenticated, wallets.length, createWallet]);

  useEffect(() => {
    setArsBalance(loadArsBalance(address));
  }, [address]);

  const [contacts, setContacts] = useState([]);
  const contactsRef = useRef(contacts);
  contactsRef.current = contacts;

  useEffect(() => {
    if (!user?.id) {
      setContacts([]);
      return;
    }
    let cancelled = false;
    getAccessToken()
      .then((token) =>
        loadContacts(user.id, token, (cached) => {
          if (!cancelled) setContacts(cached);
        })
      )
      .then((fresh) => {
        if (!cancelled) setContacts(fresh);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user?.id, getAccessToken]);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    getAccessToken()
      .then((token) =>
        loadTransactions(user.id, token, address, (cached) => {
          if (!cancelled) setTxs((prev) => mergeByHash(cached, prev));
        })
      )
      .then((fresh) => {
        if (!cancelled) setTxs((prev) => mergeByHash(fresh, prev));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user?.id, address, getAccessToken]);

  const handleAddContact = useCallback(
    async (data) => {
      const token = await getAccessToken();
      const next = await addContact(user.id, token, contactsRef.current, data);
      setContacts(next);
    },
    [user?.id, getAccessToken]
  );

  const handleUpdateContact = useCallback(
    async (id, data) => {
      const token = await getAccessToken();
      const next = await updateContact(user.id, token, contactsRef.current, id, data);
      setContacts(next);
    },
    [user?.id, getAccessToken]
  );

  const handleRemoveContact = useCallback(
    async (id) => {
      const token = await getAccessToken();
      const next = await removeContact(user.id, token, contactsRef.current, id);
      setContacts(next);
    },
    [user?.id, getAccessToken]
  );

  // Tipo de cambio ARS/USD desde Chainlink (Ethereum Mainnet) vía latestAnswer().
  useEffect(() => {
    let alive = true;
    const loadFx = async () => {
      const rate = await getArsPerUsdc();
      if (alive) setFxRate(rate);
    };
    loadFx();
    const id = setInterval(loadFx, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const refreshBalances = useCallback(async () => {
    if (!address) return;
    try {
      const [{ userUsdc, treasuryUsdc }, rate] = await Promise.all([
        refreshPairBalances(address),
        getArsPerUsdc(),
      ]);
      setBalance(userUsdc);
      setTreasuryBalance(treasuryUsdc);
      setFxRate(rate);
    } catch {
      /* el RPC puede limitar consultas */
    }
  }, [address]);

  useEffect(() => {
    if (!address) return;
    refreshBalances();
    const id = setInterval(refreshBalances, 45000);
    return () => clearInterval(id);
  }, [address, refreshBalances]);

  const applyArsDelta = useCallback(
    (delta) => {
      setArsBalance((prev) => {
        const next = Math.max(0, (prev || 0) + delta);
        persistArsBalance(address, next);
        return next;
      });
    },
    [address]
  );

  const pushTx = useCallback(
    (entry) => {
      const withTimestamp = { ...entry, createdAt: new Date().toISOString() };
      setTxs((t) => [withTimestamp, ...t]);
      if (!user?.id) return;
      getAccessToken()
        .then((token) => addTransaction(user.id, token, txsRef.current, withTimestamp))
        .catch(() => {});
    },
    [user?.id, getAccessToken]
  );

  const sendPayment = useCallback(
    async (parsed) => {
      const kind = parsed.kind || "voice";
      const signer = await getBrowserSigner(wallet);
      const memo = armarMemo({
        inv: parsed.factura,
        to: parsed.contact.alias,
        cur: parsed.currency,
        amt: parsed.amount,
        kind,
      });
      const tx = await sendNativeUsdc(signer, {
        to: parsed.contact.addr,
        usdc: parsed.usdc,
        memo,
      });
      const effectiveFxRate = parsed.fxRate || fxRate;
      const ars = parsed.usdc * effectiveFxRate;
      pushTx({
        hash: tx.hash,
        who: parsed.contact.name,
        amt: parsed.usdc,
        fxRate: effectiveFxRate,
        ars,
        factura: parsed.factura,
        block: tx.block,
        fee: tx.fee,
        memo: tx.memo,
        kind,
        direction: "out",
      });
      await refreshBalances();
      return {
        kind,
        hash: tx.hash,
        block: tx.block,
        fee: tx.fee,
        memo: tx.memo,
        factura: parsed.factura,
        usdc: parsed.usdc,
        ars,
        fxRate: effectiveFxRate,
        ts: new Date().toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
      };
    },
    [wallet, refreshBalances, pushTx, locale, fxRate]
  );

  const handleChargeDetected = useCallback(
    (entry) => {
      pushTx(entry);
      refreshBalances();
      setReceipt({
        kind: "charge_p2p",
        direction: "in",
        hash: entry.hash,
        block: entry.block,
        fee: entry.fee,
        memo: entry.memo,
        factura: entry.factura,
        usdc: entry.usdc,
        ars: entry.ars,
        fxRate: entry.fxRate,
        ts: new Date().toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
      });
    },
    [pushTx, refreshBalances, locale]
  );

  const handleConvertArsUsdc = useCallback(
    async (arsAmount) => {
      const result = await runConvertArsToUsdc({
        userAddress: address,
        arsAmount,
        arsBalance,
      });
      applyArsDelta(result.arsDelta);
      pushTx({
        hash: result.hash,
        who: t("convert.treasuryLabel"),
        amt: result.usdc,
        fxRate: result.fxRate,
        ars: result.ars,
        factura: result.factura,
        block: result.block,
        fee: result.fee,
        memo: result.memo,
        kind: "convert_ars_usdc",
        direction: "in",
      });
      await refreshBalances();
      return result;
    },
    [address, arsBalance, applyArsDelta, pushTx, refreshBalances, t]
  );

  const handleConvertUsdcArs = useCallback(
    async (usdcAmount) => {
      const result = await runConvertUsdcToArs({
        wallet,
        usdcAmount,
        userUsdcBalance: balance,
      });
      applyArsDelta(result.arsDelta);
      pushTx({
        hash: result.hash,
        who: t("convert.treasuryLabel"),
        amt: result.usdc,
        fxRate: result.fxRate,
        ars: result.ars,
        factura: result.factura,
        block: result.block,
        fee: result.fee,
        memo: result.memo,
        kind: "convert_usdc_ars",
        direction: "out",
      });
      await refreshBalances();
      return result;
    },
    [wallet, balance, applyArsDelta, pushTx, refreshBalances, t]
  );

  const navTabs = [
    { id: "home", label: t("nav.home"), icon: <IconHome /> },
    { id: "movs", label: t("nav.movements"), icon: <IconActivity /> },
    { id: "stack", label: t("nav.stack"), icon: <IconStack /> },
    { id: "agenda", label: t("nav.agenda"), icon: <IconContacts /> },
  ];
  const navMid = Math.ceil(navTabs.length / 2);
  const goTab = (id) => {
    setReceipt(null);
    setTab(id);
  };
  const closeVoice = () => {
    voiceApiRef.current?.stop?.();
    setVoiceOpen(false);
    setVoiceListening(false);
  };
  const openVoiceListen = () => {
    setReceipt(null);
    if (voiceOpen && voiceListening) {
      closeVoice();
      return;
    }
    if (voiceOpen && voiceApiRef.current) {
      voiceApiRef.current.listen();
      return;
    }
    setVoiceOpen(true);
    setVoiceKick((n) => n + 1);
  };

  const shell = (children) => (
    <div className="mp-stage">
      <div className="mp-device">
        <div className="mp-scroll" style={{ padding: "22px 18px 120px" }}>{children}</div>

        {voiceOpen && (
          <div className="mp-voice-sheet">
            <Voice
              sendPayment={sendPayment}
              balance={balance}
              onDone={(r) => {
                closeVoice();
                setReceipt(r);
              }}
              fxRate={fxRate}
              address={address}
              contacts={contacts}
              voiceKick={voiceKick}
              onListeningChange={setVoiceListening}
              voiceApiRef={voiceApiRef}
              overlay
              onClose={closeVoice}
            />
          </div>
        )}

        <nav className="mp-nav">
          {navTabs.slice(0, navMid).map((tItem) => (
            <NavButton key={tItem.id} active={tab === tItem.id && !voiceOpen} icon={tItem.icon} label={tItem.label} onClick={() => { closeVoice(); goTab(tItem.id); }} />
          ))}
          <div style={{ width: 64, flexShrink: 0 }} aria-hidden="true" />
          {navTabs.slice(navMid).map((tItem) => (
            <NavButton key={tItem.id} active={tab === tItem.id && !voiceOpen} icon={tItem.icon} label={tItem.label} onClick={() => { closeVoice(); goTab(tItem.id); }} />
          ))}
          <button
            onClick={openVoiceListen}
            className={`mp-fab${voiceListening ? " is-listening" : ""}`}
            aria-label={voiceListening ? t("voice.listening") : t("nav.voiceAria")}
          >
            <span className="mp-fab-shine" aria-hidden />
            <IconMic />
          </button>
        </nav>
      </div>
    </div>
  );

  if (guestMode && !authenticated) {
    return (
      <GuestApp
        onExit={() => {
          setGuestMode(false);
          setGuestInitialScan(null);
        }}
        initialScan={guestInitialScan}
      />
    );
  }

  if (!ready || !authenticated) {
    return <Login onLogin={login} ready={ready} />;
  }

  if (!address) {
    return shell(
      <Card style={{ textAlign: "center", padding: 40, marginTop: 40 }}>
        <div style={{ fontSize: 17, fontWeight: 700 }}>{t("home.creatingTitle")}</div>
        <div style={{ fontSize: 14, color: C.mut, marginTop: 8 }}>{t("home.creatingBody")}</div>
        {walletError && (
          <div style={{ fontSize: 13, color: C.red, marginTop: 16, lineHeight: 1.5, wordBreak: "break-word" }}>
            {walletError}
          </div>
        )}
      </Card>
    );
  }

  if (receipt) {
    return shell(
      <Success
        receipt={receipt}
        onClose={(dest) => {
          setReceipt(null);
          if (dest === "voice") openVoiceListen();
          else setTab(dest);
        }}
      />
    );
  }

  return shell(
    <>
      {tab === "home" && (
        <Home
          nombre={nombre}
          address={address}
          balance={balance}
          arsBalance={arsBalance}
          txs={txs}
          goCharge={() => setTab("charge")}
          goConvert={() => setTab("convert")}
          goPay={() => setTab("pay")}
          goMore={() => setTab("mas")}
          fxRate={fxRate}
        />
      )}
      {tab === "pay" && (
        <Pay
          address={address}
          balance={balance}
          fxRate={fxRate}
          contacts={contacts}
          onPay={sendPayment}
          onDone={setReceipt}
          onSaveContact={handleAddContact}
          scanRequest={pendingScan}
          onScanRequestConsumed={() => setPendingScan(null)}
        />
      )}
      {tab === "charge" && (
        <Charge
          address={address}
          fxRate={fxRate}
          onDetected={handleChargeDetected}
          merchantName={nombre}
        />
      )}
      {tab === "convert" && (
        <Convert
          address={address}
          balance={balance}
          arsBalance={arsBalance}
          fxRate={fxRate}
          onConvertArsUsdc={handleConvertArsUsdc}
          onConvertUsdcArs={handleConvertUsdcArs}
          onDone={setReceipt}
        />
      )}
      {tab === "movs" && <Movimientos txs={txs} address={address} />}
      {tab === "stack" && <Stack />}
      {tab === "agenda" && (
        <ContactsScreen
          contacts={contacts}
          onAdd={handleAddContact}
          onUpdate={handleUpdateContact}
          onRemove={handleRemoveContact}
        />
      )}
      {tab === "mas" && (
        <Mas
          email={email}
          address={address}
          nombre={nombre}
          onLogout={async () => { await logout(); setTab("home"); setTxs([]); setBalance(null); setTreasuryBalance(null); }}
          goStack={() => setTab("stack")}
        />
      )}
    </>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <AppInner />
    </LanguageProvider>
  );
}
