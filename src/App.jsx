import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { usePrivy, useWallets, useCreateWallet } from "@privy-io/react-auth";
import { ARC } from "./chain.js";
import {
  armarMemo,
  estimateNativeUsdcTransfer,
  getBrowserSigner,
  nuevaFactura,
  sendNativeUsdc,
} from "./arc.js";
import { FALLBACK_FX_ARS_USD, getArsPerUsdc, quoteArsToUsdc, quoteUsdcToArs } from "./fx.js";
import {
  estimateConvertUsdcToArs,
  runChargeFlow,
  runConvertArsToUsdc,
  runConvertUsdcToArs,
  refreshPairBalances,
} from "./flows.js";
import { getTreasuryAddress, isTreasuryConfigured } from "./treasury.js";
import { LanguageProvider, useLanguage, STACK_EN, STACK_ES } from "./i18n.jsx";
import {
  loadContacts,
  saveContacts,
  addContact,
  updateContact,
  removeContact,
  searchContacts,
  validateContact,
} from "./contacts.js";

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

const CONTACTS = [
  { alias: "katy", name: "Katy R.", addr: "0x1111111111111111111111111111111111111111", ini: "KR" },
  { alias: "alan", name: "Alan T. — Deenex", addr: "0x2222222222222222222222222222222222222222", ini: "AT" },
  { alias: "juanp", name: "Juan Pablo Z.", addr: "0x3333333333333333333333333333333333333333", ini: "JP" },
  { alias: "martin", name: "Martín — COO", addr: "0x4444444444444444444444444444444444444444", ini: "MC" },
];

// ————— util —————
const fmt = (n, d = 2, locale = "en-US") => Number(n).toLocaleString(locale, { minimumFractionDigits: d, maximumFractionDigits: d });
const fmt0 = (n, locale = "en-US") => Number(n).toLocaleString(locale, { maximumFractionDigits: 0 });
const short = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "—");

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

async function claudeParse(text, lang) {
  if (!API_KEY) throw new Error("no-key");
  const prompt =
    lang === "en"
      ? `You are MidatoPay's voice payment agent. Extract the intent from this English command and respond ONLY with valid JSON, no markdown or extra text.

Command: "${text}"

Valid contact aliases: ${CONTACTS.map((c) => c.alias).join(", ")}

Exact format:
{"intent":"send"|"unknown","amount":<number or null>,"currency":"USDC"|"ARS","recipient":"<closest matching contact alias or null>","confidence":<0 to 1>}

Rules: "dollars", "usd" or "usdc" → USDC. "pesos" or "ars" → ARS. If the currency isn't stated or is unclear, default to USDC — never guess ARS. Match the alias even if misheard (e.g. "caty" → "katy").`
      : `Sos el agente de pagos por voz de MidatoPay. Extraé la intención de este comando en español rioplatense y respondé SOLO con JSON válido, sin markdown ni texto extra.

Comando: "${text}"

Contactos válidos (alias): ${CONTACTS.map((c) => c.alias).join(", ")}

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

function CircleAction({ icon, label, onClick, tone = C.violet }) {
  return (
    <button
      onClick={onClick}
      style={{ background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, flex: 1, fontFamily: "inherit", padding: 0 }}
    >
      <div style={{ width: 58, height: 58, borderRadius: "50%", background: tone, display: "grid", placeItems: "center", color: "#fff", fontSize: 22 }}>
        {icon}
      </div>
      <span style={{ fontSize: 13.5, fontWeight: 600, color: C.ink }}>{label}</span>
    </button>
  );
}

function NavButton({ active, icon, label, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column",
        alignItems: "center", gap: 3, fontFamily: "inherit", padding: 0,
        color: active ? C.violet : C.mut,
      }}
    >
      <span style={{ fontSize: 18 }}>{icon}</span>
      <span style={{ fontSize: 10, fontWeight: 600 }}>{label}</span>
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
        <div style={{ position: "absolute", top: 18, right: 18, zIndex: 5 }}>
          <LangToggle />
        </div>
        <div className="mp-scroll" style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: "32px 26px", gap: 30 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
            <Mark size={104} />
            <Wordmark size={30} />
          </div>

          <div style={{ textAlign: "center" }}>
            <h1 style={{ fontSize: 23, fontWeight: 700, letterSpacing: -0.4, margin: 0, color: C.ink, lineHeight: 1.3 }}>
              {t("login.title1")}
              <br />
              {t("login.title2")}
            </h1>
            <p style={{ fontSize: 14.5, color: C.mut, marginTop: 10, lineHeight: 1.55 }}>{t("login.subtitle")}</p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button onClick={onLogin} disabled={!ready} style={{ ...btnOrange, opacity: ready ? 1 : 0.5 }}>
              {ready ? t("login.loginBtn") : t("login.loadingBtn")}
            </button>
            <button onClick={onLogin} disabled={!ready} style={{ ...btnOutline, opacity: ready ? 1 : 0.5 }}>
              {t("login.createAccountBtn")}
            </button>
            <p style={{ fontSize: 11, color: C.mut, textAlign: "center", marginTop: 4 }}>{t("login.footer")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ————— Inicio —————
function Home({
  nombre, address, balance, arsBalance, treasuryBalance, treasuryAddress,
  refreshing, onRefresh, txs, goCharge, goConvert, goVoice, fxRate,
}) {
  const { t, locale } = useLanguage();
  const [oculto, setOculto] = useState(false);
  const [copied, setCopied] = useState(false);
  const usdcInArs = balance === null ? null : balance * fxRate;
  const availableArs = (arsBalance || 0) + (usdcInArs || 0);

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
        <div style={{ fontSize: 21, fontWeight: 700, color: C.ink, flex: 1 }}>{t("home.greeting", nombre)}</div>
        <button onClick={onRefresh} style={{ width: 42, height: 42, borderRadius: "50%", background: C.orangeSoft, border: "none", cursor: "pointer", color: C.orange, fontSize: 17 }}>
          {refreshing ? "·" : "↻"}
        </button>
      </div>

      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: C.mut }}>{t("home.available")}</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: C.mut }}>ARS</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 6 }}>
          <div style={{ fontSize: 38, fontWeight: 700, letterSpacing: -1, color: C.ink }}>
            {oculto ? "$ ••••••" : `$ ${fmt0(availableArs, locale)}`}
          </div>
          <button onClick={() => setOculto(!oculto)} style={{ background: "none", border: "none", cursor: "pointer", color: C.mut, fontSize: 17 }}>
            {oculto ? "🙈" : "👁"}
          </button>
        </div>
        <div style={{ fontSize: 12.5, color: C.mut, marginTop: 6 }}>
          {t("home.availableBreakdown", fmt0(arsBalance || 0, locale), balance === null ? "—" : fmt(balance, 2, locale))}
        </div>
        <div style={{ fontSize: 12, color: C.mut, marginTop: 4 }}>
          {t("home.fxLine", fmt0(fxRate, locale))}
        </div>

        <div style={{ display: "flex", gap: 6, marginTop: 20 }}>
          <CircleAction icon="↓" label={t("home.actionReceive")} onClick={goCharge} />
          <CircleAction icon="⇄" label={t("home.actionConvert")} onClick={goConvert} />
          <CircleAction icon="🎙" label={t("home.actionPay")} onClick={goVoice} tone={C.orange} />
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
          <div style={{ width: 38, height: 38, borderRadius: "50%", background: "#2775CA", display: "grid", placeItems: "center", color: "#fff", fontWeight: 700, fontSize: 15 }}>$</div>
          <div style={{ flex: 1, fontSize: 17, fontWeight: 700, color: C.ink }}>USDC</div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: C.ink }}>{usdcInArs === null ? "—" : `$${fmt0(usdcInArs, locale)}`}</div>
            <div style={{ fontSize: 14, color: C.mut }}>{balance === null ? "" : `${fmt(balance, 2, locale)} USDC`}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.line}` }}>
          <div style={{ width: 38, height: 38, borderRadius: "50%", background: C.violetSoft, display: "grid", placeItems: "center", color: C.violet, fontWeight: 700, fontSize: 13 }}>ARS</div>
          <div style={{ flex: 1, fontSize: 17, fontWeight: 700, color: C.ink }}>ARS</div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: C.ink }}>{oculto ? "$ ••••••" : `$ ${fmt0(arsBalance || 0, locale)}`}</div>
            <div style={{ fontSize: 12.5, color: C.mut }}>{t("home.arsSimulated")}</div>
          </div>
        </div>
        {treasuryAddress && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.line}` }}>
            <div style={{ width: 38, height: 38, borderRadius: "50%", background: C.orangeSoft, display: "grid", placeItems: "center", color: C.orange, fontWeight: 700, fontSize: 14 }}>T</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>{t("home.treasuryTitle")}</div>
              <div style={{ fontSize: 11.5, color: C.mut, fontFamily: "ui-monospace, monospace" }}>{short(treasuryAddress)}</div>
            </div>
            <div style={{ textAlign: "right", fontSize: 14, fontWeight: 700, color: C.ink }}>
              {treasuryBalance === null ? "—" : `${fmt(treasuryBalance, 2, locale)} USDC`}
            </div>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.line}` }}>
          <span style={{ color: C.violet, fontSize: 14 }}>ⓘ</span>
          <span style={{ fontSize: 13.5, color: C.violet, flex: 1 }}>{t("home.infoDigitalAssets")}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 12.5, color: C.mut }}>
          <span style={{ fontFamily: "ui-monospace, monospace" }}>{short(address)}</span>
          <button onClick={copy} style={{ background: C.bg, border: "none", borderRadius: 20, padding: "4px 12px", fontSize: 12, fontWeight: 600, color: C.ink, cursor: "pointer", fontFamily: "inherit" }}>
            {copied ? t("home.copied") : t("home.copy")}
          </button>
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
        txs.map((tx) => (
          <Card key={tx.hash} style={{ padding: 16, display: "flex", alignItems: "center", gap: 13 }}>
            <div style={{ width: 42, height: 42, borderRadius: "50%", background: C.violetSoft, display: "grid", placeItems: "center", color: C.violet, fontSize: 17 }}>↑</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15.5, fontWeight: 600, color: C.ink }}>{tx.who}</div>
              <a href={`${ARC.explorer}/tx/${tx.hash}`} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: C.mut, textDecoration: "none" }}>
                {t("home.invoiceLink", tx.factura)}
              </a>
            </div>
            <div style={{ fontSize: 15.5, fontWeight: 700, color: C.ink }}>−{fmt(tx.amt, 2, locale)}</div>
          </Card>
        ))
      )}
    </div>
  );
}

function AmountField({ label, value, onChange, placeholder, suffix }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: C.mut, marginBottom: 8 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, background: C.bg, borderRadius: 14, padding: "4px 14px" }}>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
          inputMode="decimal"
          placeholder={placeholder}
          style={{ flex: 1, border: "none", background: "transparent", fontSize: 22, fontWeight: 700, color: C.ink, padding: "14px 0", fontFamily: "inherit", outline: "none", minWidth: 0 }}
        />
        <span style={{ fontSize: 14, fontWeight: 700, color: C.mut }}>{suffix}</span>
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
      rows.push([t("gas.totalArs"), `$ ${fmt0(estimate.feeNative * fxRate, locale)} ARS`]);
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

// ————— Cobrar (ARS → USDC vía recaudadora) —————
function Charge({ address, fxRate, treasuryBalance, onCharge, onDone }) {
  const { t, locale } = useLanguage();
  const [arsInput, setArsInput] = useState("");
  const [phase, setPhase] = useState("form"); // form | working | error
  const [errMsg, setErrMsg] = useState("");
  const ars = Number(arsInput);
  const quote = Number.isFinite(ars) && ars > 0 ? quoteArsToUsdc(ars, fxRate) : null;

  const submit = async () => {
    setErrMsg("");
    setPhase("working");
    try {
      if (!isTreasuryConfigured()) throw new Error(t("charge.treasuryMissing"));
      const result = await onCharge(ars);
      onDone({
        kind: "charge",
        ...result,
        parsed: { usdc: result.usdc, amount: result.ars, currency: "ARS", fxRate: result.fxRate, contact: { name: t("charge.merchantSelf"), alias: "self" } },
        ts: new Date().toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
      });
    } catch (e) {
      setErrMsg(String(e?.message || e));
      setPhase("error");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2 style={{ fontSize: 26, fontWeight: 700, color: C.ink, margin: 0, letterSpacing: -0.4 }}>{t("charge.title")}</h2>
        <p style={{ fontSize: 14.5, color: C.mut, marginTop: 6, lineHeight: 1.5 }}>{t("charge.subtitle")}</p>
      </div>

      <Card style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <AmountField label={t("charge.arsLabel")} value={arsInput} onChange={setArsInput} placeholder="15000" suffix="ARS" />
        <div style={{ display: "grid", gap: 8, fontSize: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: C.mut }}>{t("voice.exchangeRate")}</span>
            <span style={{ fontWeight: 600, color: C.ink }}>1 USDC = ${fmt0(fxRate, locale)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: C.mut }}>{t("charge.youReceive")}</span>
            <span style={{ fontWeight: 700, color: C.ink }}>{quote ? `${fmt(quote.usdc, 2, locale)} USDC` : "—"}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: C.mut }}>{t("home.treasuryTitle")}</span>
            <span style={{ fontWeight: 600, color: C.ink }}>{treasuryBalance === null ? "—" : `${fmt(treasuryBalance, 2, locale)} USDC`}</span>
          </div>
        </div>
        <div style={{ fontSize: 12.5, color: C.violet, lineHeight: 1.5 }}>{t("charge.fiatHint")}</div>
      </Card>

      {phase === "working" && (
        <Card style={{ textAlign: "center", padding: 28 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: C.ink }}>{t("charge.working")}</div>
          <div style={{ fontSize: 13.5, color: C.mut, marginTop: 8 }}>{t("charge.workingHint")}</div>
        </Card>
      )}

      {(phase === "error" || errMsg) && phase !== "working" && (
        <Card style={{ background: "#FDECEA", color: C.red, fontSize: 14, lineHeight: 1.5 }}>{errMsg}</Card>
      )}

      <button
        onClick={submit}
        disabled={phase === "working" || !quote}
        style={{ ...btnOrange, opacity: phase === "working" || !quote ? 0.5 : 1 }}
      >
        {phase === "working" ? t("charge.working") : t("charge.cta")}
      </button>
      <div style={{ fontSize: 11.5, color: C.mut, textAlign: "center" }}>{short(address)}</div>
    </div>
  );
}

// ————— Convertir (ARS ↔ USDC) —————
function Convert({ address, balance, arsBalance, fxRate, treasuryBalance, onConvertArsUsdc, onConvertUsdcArs, onDone }) {
  const { t, locale } = useLanguage();
  const [direction, setDirection] = useState("ars_usdc"); // ars_usdc | usdc_ars
  const [amount, setAmount] = useState("");
  const [phase, setPhase] = useState("form");
  const [errMsg, setErrMsg] = useState("");
  const n = Number(amount);
  const quote =
    Number.isFinite(n) && n > 0
      ? direction === "ars_usdc"
        ? quoteArsToUsdc(n, fxRate)
        : quoteUsdcToArs(n, fxRate)
      : null;

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

  const submit = async () => {
    setErrMsg("");
    setPhase("working");
    try {
      if (!isTreasuryConfigured()) throw new Error(t("charge.treasuryMissing"));
      const result =
        direction === "ars_usdc" ? await onConvertArsUsdc(n) : await onConvertUsdcArs(n);
      onDone({
        kind: result.kind,
        ...result,
        parsed: {
          usdc: result.usdc,
          amount: direction === "ars_usdc" ? result.ars : result.usdc,
          currency: direction === "ars_usdc" ? "ARS" : "USDC",
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

  const dirBtn = (id, label) => (
    <button
      key={id}
      onClick={() => { setDirection(id); setAmount(""); setErrMsg(""); setPhase("form"); }}
      style={{
        flex: 1, border: "none", cursor: "pointer", fontFamily: "inherit",
        background: direction === id ? C.ink : "transparent",
        color: direction === id ? "#fff" : C.mut,
        borderRadius: 12, padding: "12px 10px", fontSize: 13.5, fontWeight: 700,
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2 style={{ fontSize: 26, fontWeight: 700, color: C.ink, margin: 0, letterSpacing: -0.4 }}>{t("convert.title")}</h2>
        <p style={{ fontSize: 14.5, color: C.mut, marginTop: 6, lineHeight: 1.5 }}>{t("convert.subtitle")}</p>
      </div>

      <div style={{ display: "flex", gap: 4, background: C.bg, borderRadius: 14, padding: 4 }}>
        {dirBtn("ars_usdc", t("convert.arsToUsdc"))}
        {dirBtn("usdc_ars", t("convert.usdcToArs"))}
      </div>

      <Card style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <AmountField
          label={direction === "ars_usdc" ? t("convert.amountArs") : t("convert.amountUsdc")}
          value={amount}
          onChange={setAmount}
          placeholder={direction === "ars_usdc" ? "10000" : "5"}
          suffix={direction === "ars_usdc" ? "ARS" : "USDC"}
        />
        <div style={{ display: "grid", gap: 8, fontSize: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: C.mut }}>{t("voice.exchangeRate")}</span>
            <span style={{ fontWeight: 600, color: C.ink }}>1 USDC = ${fmt0(fxRate, locale)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: C.mut }}>{t("convert.youGet")}</span>
            <span style={{ fontWeight: 700, color: C.ink }}>
              {quote
                ? direction === "ars_usdc"
                  ? `${fmt(quote.usdc, 2, locale)} USDC`
                  : `$ ${fmt0(quote.ars, locale)} ARS`
                : "—"}
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: C.mut }}>{t("convert.yourArs")}</span>
            <span style={{ fontWeight: 600 }}>$ {fmt0(arsBalance || 0, locale)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: C.mut }}>{t("convert.yourUsdc")}</span>
            <span style={{ fontWeight: 600 }}>{balance === null ? "—" : `${fmt(balance, 2, locale)} USDC`}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: C.mut }}>{t("home.treasuryTitle")}</span>
            <span style={{ fontWeight: 600 }}>{treasuryBalance === null ? "—" : `${fmt(treasuryBalance, 2, locale)} USDC`}</span>
          </div>
        </div>
        <div style={{ fontSize: 12.5, color: C.violet, lineHeight: 1.5 }}>
          {direction === "ars_usdc" ? t("convert.hintArsUsdc") : t("convert.hintUsdcArs")}
        </div>
        {needsUserSignature && (
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

      {phase === "working" && (
        <Card style={{ textAlign: "center", padding: 28 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{t("convert.working")}</div>
          <div style={{ fontSize: 13.5, color: C.mut, marginTop: 8 }}>{t("convert.workingHint")}</div>
        </Card>
      )}

      {(phase === "error" || errMsg) && phase !== "working" && (
        <Card style={{ background: "#FDECEA", color: C.red, fontSize: 14, lineHeight: 1.5 }}>{errMsg}</Card>
      )}

      <button
        onClick={submit}
        disabled={phase === "working" || !quote || (needsUserSignature && !address)}
        style={{ ...btnOrange, opacity: phase === "working" || !quote || (needsUserSignature && !address) ? 0.5 : 1 }}
      >
        {phase === "working" ? t("convert.working") : needsUserSignature ? t("convert.ctaSign") : t("convert.cta")}
      </button>
    </div>
  );
}

// ————— Voz —————
function Voice({ sendPayment, balance, onDone, fxRate, address }) {
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
      let result;
      try {
        result = await claudeParse(text, lang);
      } catch {
        result = localParse(text, lang);
      }
      if (!result || result.intent !== "send" || !result.amount || !result.recipient) {
        setErrMsg(t("voice.noPaymentUnderstood"));
        setPhase("error");
        return;
      }
      const contact =
        CONTACTS.find((c) => c.alias === (result.recipient || "").toLowerCase()) ||
        CONTACTS.find((c) => (result.recipient || "").toLowerCase().includes(c.alias));
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
    [balance, fxRate, lang, locale, t]
  );

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

  const listen = () => {
    setErrMsg("");
    setTranscript("");
    if (!supported) {
      setErrMsg(t("voice.micUnsupported"));
      setPhase("error");
      return;
    }
    try {
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
  };

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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <style>{`
        @keyframes mp-ring { 0% { transform: scale(1); opacity:.5 } 100% { transform: scale(1.75); opacity: 0 } }
        @keyframes mp-pulse { 0%,100% { transform: scale(1) } 50% { transform: scale(1.05) } }
        @media (prefers-reduced-motion: reduce) { .mp-ring,.mp-orb { animation: none !important } }
      `}</style>

      <div>
        <h2 style={{ fontSize: 26, fontWeight: 700, color: C.ink, margin: 0, letterSpacing: -0.4 }}>{t("voice.title")}</h2>
        <p style={{ fontSize: 15, color: C.mut, marginTop: 6 }}>{t("voice.subtitle")}</p>
      </div>

      {(phase === "idle" || phase === "listening" || phase === "parsing") && (
        <>
          <Card style={{ display: "grid", placeItems: "center", padding: "36px 20px" }}>
            <div style={{ position: "relative", width: 168, height: 168, display: "grid", placeItems: "center" }}>
              {active && [0, 1, 2].map((i) => (
                <div key={i} className="mp-ring" style={{ position: "absolute", inset: 22, borderRadius: "50%", border: `2px solid ${C.orange}`, animation: `mp-ring 1.9s ${i * 0.55}s ease-out infinite` }} />
              ))}
              <button
                onClick={active ? () => recRef.current?.stop() : listen}
                className={active ? "mp-orb" : ""}
                disabled={phase === "parsing"}
                style={{
                  width: 124, height: 124, borderRadius: "50%", cursor: "pointer", border: "none",
                  background: active ? C.orange : C.violet,
                  color: "#fff", fontSize: 40, display: "grid", placeItems: "center",
                  boxShadow: active ? `0 12px 32px ${C.orange}55` : `0 12px 32px ${C.violet}33`,
                  animation: active ? "mp-pulse 1.2s ease-in-out infinite" : "none",
                  transition: "background .25s",
                }}
                aria-label={active ? t("voice.listening") : t("nav.voiceAria")}
              >
                {phase === "parsing" ? "···" : "🎙"}
              </button>
            </div>
            <div style={{ marginTop: 18, textAlign: "center", minHeight: 42 }}>
              {phase === "idle" && <span style={{ fontSize: 14.5, color: C.mut }}>{t("voice.idleHint")}</span>}
              {active && (
                <>
                  <div style={{ fontSize: 15.5, color: C.ink, fontWeight: 600 }}>{transcript || t("voice.listening")}</div>
                  <div style={{ fontSize: 12.5, color: C.mut, marginTop: 4 }}>{t("voice.listeningHint")}</div>
                </>
              )}
              {phase === "parsing" && <span style={{ fontSize: 14.5, color: C.violet, fontWeight: 600 }}>{t("voice.parsing", transcript)}</span>}
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
                style={{ flex: 1, background: C.bg, border: `1px solid ${C.line}`, borderRadius: 12, padding: "13px 14px", fontSize: 15, color: C.ink, outline: "none", fontFamily: "inherit" }}
              />
              <button onClick={() => manual.trim() && analyze(manual.trim())} style={{ ...btnOrange, width: 52, padding: 0, fontSize: 19 }}>→</button>
            </div>
            <button onClick={() => analyze(t("voice.exampleCommand"))} style={{ background: "none", border: "none", color: C.violet, fontSize: 14, fontWeight: 600, cursor: "pointer", marginTop: 12, padding: 0, fontFamily: "inherit" }}>
              {t("voice.tryExample")}
            </button>
            {!API_KEY && <div style={{ fontSize: 12, color: C.mut, marginTop: 10 }}>{t("voice.noApiKeyHint")}</div>}
          </Card>
        </>
      )}

      {phase === "confirm" && parsed && (
        <>
          <Card>
            <div style={{ fontSize: 13.5, color: C.mut }}>«{transcript}»</div>
            <div style={{ display: "flex", alignItems: "center", gap: 13, margin: "18px 0" }}>
              <div style={{ width: 46, height: 46, borderRadius: "50%", background: C.violetSoft, display: "grid", placeItems: "center", color: C.violet, fontWeight: 700, fontSize: 15 }}>
                {parsed.contact.ini}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16.5, fontWeight: 700, color: C.ink }}>{parsed.contact.name}</div>
                <div style={{ fontSize: 13, color: C.mut, fontFamily: "ui-monospace, monospace" }}>{short(parsed.contact.addr)}</div>
              </div>
            </div>
            <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 16, display: "grid", gap: 10 }}>
              {[
                [t("voice.amount"), `${fmt(parsed.usdc, 2, locale)} USDC`],
                parsed.currency === "ARS" ? [t("voice.equals"), `$${fmt0(parsed.amount, locale)} ARS`] : [t("voice.equals"), `$${fmt0(parsed.usdc * parsed.fxRate, locale)} ARS`],
                [t("voice.exchangeRate"), `1 USDC = $${fmt0(parsed.fxRate, locale)}`],
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
            <div style={{ background: C.bg, borderRadius: 12, padding: "12px 14px", marginTop: 16, fontSize: 12.5, color: C.mut, lineHeight: 1.5 }}>
              {t("voice.memoNote")}
            </div>
          </Card>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button
              onClick={execute}
              disabled={!address || gas.loading}
              style={{ ...btnOrange, opacity: !address || gas.loading ? 0.5 : 1 }}
            >
              {t("voice.confirmSend")}
            </button>
            <button onClick={reset} style={{ ...btnOutline, border: "none", color: C.mut }}>{t("voice.cancel")}</button>
          </div>
        </>
      )}

      {phase === "sending" && (
        <Card style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.ink }}>{t("voice.sending")}</div>
          <div style={{ fontSize: 14, color: C.mut, marginTop: 8 }}>{t("voice.sendingHint")}</div>
        </Card>
      )}

      {phase === "error" && (
        <>
          <Card style={{ borderLeft: `4px solid ${C.red}` }}>
            <div style={{ fontSize: 15, color: C.ink, lineHeight: 1.5 }}>{errMsg}</div>
          </Card>
          <button onClick={reset} style={btnOrange}>{t("voice.retry")}</button>
        </>
      )}
    </div>
  );
}

// ————— Éxito a pantalla completa —————
function Success({ receipt, onClose }) {
  const { t, locale } = useLanguage();
  const [detalle, setDetalle] = useState(false);
  const [splash, setSplash] = useState(true);
  const kind = receipt.kind || "voice";

  useEffect(() => {
    const timer = setTimeout(() => setSplash(false), 1800);
    return () => clearTimeout(timer);
  }, []);

  const splashTitle =
    kind === "charge" ? t("success.splashCharge")
      : kind === "convert_ars_usdc" || kind === "convert_usdc_ars" ? t("success.splashConvert")
        : t("success.splashTitle");

  const summary = () => {
    if (kind === "charge") return t("success.chargeSummary", fmt0(receipt.ars, locale), fmt(receipt.usdc, 2, locale));
    if (kind === "convert_ars_usdc") return t("success.convertArsUsdcSummary", fmt0(receipt.ars, locale), fmt(receipt.usdc, 2, locale));
    if (kind === "convert_usdc_ars") return t("success.convertUsdcArsSummary", fmt(receipt.usdc, 2, locale), fmt0(receipt.ars, locale));
    const p = receipt.parsed;
    return t("success.sentSummary", fmt(p.usdc, 2, locale), p.contact.name);
  };

  const nextTab = kind === "charge" ? "charge" : kind?.startsWith("convert") ? "convert" : "voice";
  const nextLabel = kind === "charge" ? t("success.anotherCharge") : kind?.startsWith("convert") ? t("success.anotherConvert") : t("success.anotherPayment");

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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
        <div style={{ width: 44, height: 44, borderRadius: "50%", background: C.green, display: "grid", placeItems: "center", color: "#fff", fontSize: 22 }}>✓</div>
        <div style={{ fontSize: 26, fontWeight: 700, color: C.ink }}>{t("success.doneTitle")}</div>
      </div>

      <Card>
        <div style={{ fontSize: 18, fontWeight: 700, color: C.ink, lineHeight: 1.35 }}>{summary()}</div>
        {kind === "convert_usdc_ars" && (
          <div style={{ marginTop: 12, padding: "12px 14px", background: C.violetSoft, borderRadius: 12, fontSize: 14, color: C.violet, lineHeight: 1.45 }}>
            {t("success.arsCredited", fmt0(ars, locale))}
          </div>
        )}
        <button
          onClick={() => setDetalle(!detalle)}
          style={{ background: C.violetSoft, color: C.violet, border: "none", borderRadius: 20, padding: "6px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", marginTop: 12, fontFamily: "inherit" }}
        >
          {t("success.viewDetail")} {detalle ? "⌃" : "⌄"}
        </button>

        {detalle && (
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: C.ink, marginBottom: 14 }}>{t("success.operation")}</div>
            <div style={{ display: "grid", gap: 10, fontSize: 14.5 }}>
              {[
                [t("success.amountSent"), `${fmt(usdc, 2, locale)} USDC`],
                [t("success.equals"), `$${fmt0(ars, locale)} ARS`],
                [t("success.exchangeRate"), `1 USDC = $${fmt0(fx, locale)}`],
                [t("success.networkFee"), receipt.fee ? `${Number(receipt.fee).toFixed(6)} USDC` : "—"],
                receipt.block ? [t("success.block"), String(receipt.block)] : null,
                [t("success.time"), receipt.ts],
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
                <span style={{ color: C.green, fontWeight: 700 }}>{receipt.factura} · {t("success.onchainCheck")}</span>
              </div>
              <a href={`${ARC.explorer}/tx/${receipt.hash}`} target="_blank" rel="noreferrer" style={{ display: "block", marginTop: 12, fontSize: 13.5, color: C.violet, fontWeight: 600, textDecoration: "none", wordBreak: "break-all" }}>
                {t("success.viewOnArcScan", short(receipt.hash))}
              </a>
              <div style={{ fontSize: 12, color: C.mut, marginTop: 8, lineHeight: 1.5 }}>{t("success.utf8Hint")}</div>
            </div>
          </div>
        )}
      </Card>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <button onClick={() => onClose(nextTab)} style={btnOrange}>{nextLabel}</button>
        <button onClick={() => onClose("home")} style={btnOutline}>{t("success.backHome")}</button>
      </div>
    </div>
  );
}

// ————— Movimientos —————
function Movimientos({ txs, address, fxRate }) {
  const { t, locale } = useLanguage();
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
        txs.map((tx) => {
          const inbound = tx.direction === "in";
          const label =
            tx.kind === "charge" ? t("movs.charge")
              : tx.kind === "convert_ars_usdc" ? t("movs.convertArsUsdc")
                : tx.kind === "convert_usdc_ars" ? t("movs.convertUsdcArs")
                  : t("movs.voicePayment");
          return (
          <Card key={tx.hash} style={{ padding: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
              <div style={{ width: 42, height: 42, borderRadius: "50%", background: inbound ? C.orangeSoft : C.violetSoft, display: "grid", placeItems: "center", color: inbound ? C.orange : C.violet, fontSize: 17 }}>{inbound ? "↓" : "↑"}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15.5, fontWeight: 700, color: C.ink }}>{tx.who}</div>
                <div style={{ fontSize: 13, color: C.mut }}>{label}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 15.5, fontWeight: 700, color: C.ink }}>{inbound ? "+" : "−"}{fmt(tx.amt, 2, locale)}</div>
                <div style={{ fontSize: 12.5, color: C.mut }}>USDC</div>
              </div>
            </div>
            <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 14, paddingTop: 12, display: "grid", gap: 7, fontSize: 13.5 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: C.mut }}>{t("movs.invoiceLabel")}</span>
                <span style={{ color: C.green, fontWeight: 700 }}>{tx.factura} · {t("success.onchainCheck")}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: C.mut }}>{t("movs.equals")}</span>
                <span style={{ color: C.ink, fontWeight: 600 }}>${fmt0(tx.amt * (tx.fxRate || fxRate), locale)} ARS</span>
              </div>
            </div>
            <a href={`${ARC.explorer}/tx/${tx.hash}`} target="_blank" rel="noreferrer" style={{ display: "block", marginTop: 12, fontSize: 13.5, color: C.violet, fontWeight: 600, textDecoration: "none" }}>
              {t("movs.viewOnArcScan", short(tx.hash))}
            </a>
          </Card>
          );
        })
      )}

      <a href={`${ARC.explorer}/address/${address}`} target="_blank" rel="noreferrer" style={{ ...btnOutline, textDecoration: "none", textAlign: "center", display: "block", border: `1.5px solid ${C.line}`, color: C.ink }}>
        {t("movs.viewFullHistory")}
      </a>
    </div>
  );
}

// ————— Más (menú) —————
function Mas({ email, address, nombre, onLogout, goStack }) {
  const { t, lang, setLang } = useLanguage();
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
      <h2 style={{ fontSize: 26, fontWeight: 700, color: C.ink, margin: 0, letterSpacing: -0.4 }}>{t("mas.title")}</h2>

      <Card style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ width: 52, height: 52, borderRadius: "50%", background: C.orangeSoft, display: "grid", placeItems: "center", color: C.orange, fontSize: 20, fontWeight: 700 }}>
          {(nombre || "?").slice(0, 1).toUpperCase()}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: C.ink }}>{nombre}</div>
          <div style={{ fontSize: 13, color: C.mut, overflow: "hidden", textOverflow: "ellipsis" }}>{email || t("mas.noEmailAccount")}</div>
          <div style={{ fontSize: 12, color: C.mut, fontFamily: "ui-monospace, monospace", marginTop: 2 }}>{short(address)}</div>
        </div>
      </Card>

      <Card style={{ padding: "4px 20px" }}>
        <Fila icon="◫" titulo={t("mas.stackTitle")} sub={t("mas.stackSub")} onClick={goStack} />
        <div style={{ height: 1, background: C.line }} />
        <Fila icon="⛽" titulo={t("mas.faucetTitle")} sub={t("mas.faucetSub")} href={ARC.faucet} />
        <div style={{ height: 1, background: C.line }} />
        <Fila icon="🔎" titulo={t("mas.arcscanTitle")} sub={t("mas.arcscanSub")} href={`${ARC.explorer}/address/${address}`} />
      </Card>

      <Card style={{ padding: "4px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 13, padding: "14px 0" }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: C.bg, display: "grid", placeItems: "center", fontSize: 17 }}>🌐</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15.5, fontWeight: 600, color: C.ink }}>{t("mas.languageTitle")}</div>
            <div style={{ fontSize: 12.5, color: C.mut, marginTop: 1 }}>{lang === "en" ? "English" : "Español"}</div>
          </div>
          <LangToggle />
        </div>
      </Card>

      <Card style={{ padding: "4px 20px" }}>
        <Fila icon="⏻" titulo={t("mas.logoutTitle")} danger onClick={() => setConfirmar(true)} />
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

  const visible = searchContacts(contacts, query);
  const editingId = form?.id || null;

  const openNew = () => { setForm({ name: "", alias: "", addr: "", note: "" }); setErrors({}); };
  const openEdit = (c) => { setForm({ ...c }); setErrors({}); };
  const close = () => { setForm(null); setErrors({}); };

  const save = () => {
    const check = validateContact(form, contacts, editingId);
    if (!check.valid) {
      setErrors(check.errors);
      return;
    }
    if (editingId) onUpdate(editingId, form);
    else onAdd(form);
    close();
  };

  const del = () => {
    if (!editingId) return;
    onRemove(editingId);
    close();
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
        style={{ width: "100%", background: C.bg, border: `1px solid ${C.line}`, borderRadius: 12, padding: "13px 14px", fontSize: 15, color: C.ink, outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
      />
      {errors[key] && <div style={{ fontSize: 12.5, color: C.red, marginTop: 6 }}>{errorMessage(t, key, errors[key])}</div>}
    </label>
  );

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
            style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: "13px 16px", fontSize: 15, color: C.ink, outline: "none", fontFamily: "inherit" }}
          />

          <button onClick={openNew} style={btnOutline}>{t("agenda.addButton")}</button>

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
                  <span style={{ width: 42, height: 42, borderRadius: "50%", background: C.violetSoft, display: "grid", placeItems: "center", color: C.violet, fontWeight: 700, fontSize: 15, flexShrink: 0 }}>
                    {c.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15.5, fontWeight: 600, color: C.ink }}>{c.name}</div>
                    <div style={{ fontSize: 13, color: C.mut }}>@{c.alias} · {short(c.addr)}</div>
                  </span>
                </button>
                <button
                  onClick={() => copy(c)}
                  style={{ background: C.bg, border: "none", borderRadius: 20, padding: "6px 12px", fontSize: 12, fontWeight: 600, color: C.ink, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}
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
          {field("name", t("agenda.form.nameLabel"), t("agenda.form.namePlaceholder"))}
          {field("alias", t("agenda.form.aliasLabel"), t("agenda.form.aliasPlaceholder"))}
          {field("addr", t("agenda.form.addressLabel"), t("agenda.form.addressPlaceholder"))}
          {field("note", t("agenda.form.noteLabel"), t("agenda.form.notePlaceholder"))}

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button onClick={save} style={btnOrange}>{editingId ? t("agenda.form.save") : t("agenda.form.saveNew")}</button>
            <button onClick={close} style={{ ...btnOutline, border: "none", color: C.mut }}>{t("agenda.form.cancel")}</button>
            {editingId && (
              <button onClick={del} style={{ ...btnOutline, border: `1.5px solid ${C.red}`, color: C.red }}>{t("agenda.form.delete")}</button>
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
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const [tab, setTab] = useState("home");
  const [balance, setBalance] = useState(null);
  const [arsBalance, setArsBalance] = useState(0);
  const [treasuryBalance, setTreasuryBalance] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [txs, setTxs] = useState([]);
  const [receipt, setReceipt] = useState(null);
  const [walletError, setWalletError] = useState("");
  const [fxRate, setFxRate] = useState(FALLBACK_FX_ARS_USD);

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

  useEffect(() => {
    setContacts(loadContacts(address));
  }, [address]);

  const handleAddContact = useCallback(
    (data) => {
      setContacts((prev) => {
        const next = addContact(prev, data);
        saveContacts(address, next);
        return next;
      });
    },
    [address]
  );

  const handleUpdateContact = useCallback(
    (id, data) => {
      setContacts((prev) => {
        const next = updateContact(prev, id, data);
        saveContacts(address, next);
        return next;
      });
    },
    [address]
  );

  const handleRemoveContact = useCallback(
    (id) => {
      setContacts((prev) => {
        const next = removeContact(prev, id);
        saveContacts(address, next);
        return next;
      });
    },
    [address]
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
    setRefreshing(true);
    try {
      const { userUsdc, treasuryUsdc } = await refreshPairBalances(address);
      setBalance(userUsdc);
      setTreasuryBalance(treasuryUsdc);
    } catch {
      /* el RPC puede limitar consultas */
    } finally {
      setRefreshing(false);
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

  const pushTx = useCallback((entry) => {
    setTxs((t) => [entry, ...t]);
  }, []);

  const sendPayment = useCallback(
    async (parsed) => {
      const signer = await getBrowserSigner(wallet);
      const memo = armarMemo({
        inv: parsed.factura,
        to: parsed.contact.alias,
        cur: parsed.currency,
        amt: parsed.amount,
        kind: "voice",
      });
      const tx = await sendNativeUsdc(signer, {
        to: parsed.contact.addr,
        usdc: parsed.usdc,
        memo,
      });
      pushTx({
        hash: tx.hash,
        who: parsed.contact.name,
        amt: parsed.usdc,
        factura: parsed.factura,
        fxRate: parsed.fxRate,
        kind: "voice",
        direction: "out",
      });
      await refreshBalances();
      return {
        kind: "voice",
        hash: tx.hash,
        block: tx.block,
        fee: tx.fee,
        memo: tx.memo,
        factura: parsed.factura,
        usdc: parsed.usdc,
        ars: parsed.usdc * (parsed.fxRate || fxRate),
        fxRate: parsed.fxRate || fxRate,
        ts: new Date().toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
      };
    },
    [wallet, refreshBalances, pushTx, locale, fxRate]
  );

  const handleCharge = useCallback(
    async (arsAmount) => {
      const result = await runChargeFlow({ userAddress: address, arsAmount });
      pushTx({
        hash: result.hash,
        who: t("charge.merchantSelf"),
        amt: result.usdc,
        factura: result.factura,
        fxRate: result.fxRate,
        kind: "charge",
        direction: "in",
      });
      await refreshBalances();
      return result;
    },
    [address, pushTx, refreshBalances, t]
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
        factura: result.factura,
        fxRate: result.fxRate,
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
        factura: result.factura,
        fxRate: result.fxRate,
        kind: "convert_usdc_ars",
        direction: "out",
      });
      await refreshBalances();
      return result;
    },
    [wallet, balance, applyArsDelta, pushTx, refreshBalances, t]
  );

  const navTabs = [
    { id: "home", label: t("nav.home"), icon: "⌂" },
    { id: "movs", label: t("nav.movements"), icon: "☰" },
    { id: "stack", label: t("nav.stack"), icon: "◫" },
    { id: "agenda", label: t("nav.agenda"), icon: "📇" },
    { id: "mas", label: t("nav.more"), icon: "⋯" },
  ];
  const navMid = Math.ceil(navTabs.length / 2);
  const goTab = (id) => { setReceipt(null); setTab(id); };

  const shell = (children) => (
    <div className="mp-stage">
      <div className="mp-device">
        <div className="mp-scroll" style={{ padding: "22px 18px 112px" }}>{children}</div>

        <nav className="mp-nav">
          {navTabs.slice(0, navMid).map((tItem) => (
            <NavButton key={tItem.id} active={tab === tItem.id} icon={tItem.icon} label={tItem.label} onClick={() => goTab(tItem.id)} />
          ))}
          <div style={{ width: 56, flexShrink: 0 }} aria-hidden="true" />
          {navTabs.slice(navMid).map((tItem) => (
            <NavButton key={tItem.id} active={tab === tItem.id} icon={tItem.icon} label={tItem.label} onClick={() => goTab(tItem.id)} />
          ))}
          <button onClick={() => goTab("voice")} className="mp-fab" aria-label={t("nav.voiceAria")}>
            🎙
          </button>
        </nav>
      </div>
    </div>
  );

  if (!ready || !authenticated) return <Login onLogin={login} ready={ready} />;

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
    return shell(<Success receipt={receipt} onClose={(dest) => { setReceipt(null); setTab(dest); }} />);
  }

  return shell(
    <>
      {tab === "home" && (
        <Home
          nombre={nombre}
          address={address}
          balance={balance}
          arsBalance={arsBalance}
          treasuryBalance={treasuryBalance}
          treasuryAddress={treasuryAddress}
          refreshing={refreshing}
          onRefresh={refreshBalances}
          txs={txs}
          goCharge={() => setTab("charge")}
          goConvert={() => setTab("convert")}
          goVoice={() => setTab("voice")}
          fxRate={fxRate}
        />
      )}
      {tab === "charge" && (
        <Charge
          address={address}
          fxRate={fxRate}
          treasuryBalance={treasuryBalance}
          onCharge={handleCharge}
          onDone={setReceipt}
        />
      )}
      {tab === "convert" && (
        <Convert
          address={address}
          balance={balance}
          arsBalance={arsBalance}
          fxRate={fxRate}
          treasuryBalance={treasuryBalance}
          onConvertArsUsdc={handleConvertArsUsdc}
          onConvertUsdcArs={handleConvertUsdcArs}
          onDone={setReceipt}
        />
      )}
      {tab === "voice" && <Voice sendPayment={sendPayment} balance={balance} onDone={setReceipt} fxRate={fxRate} address={address} />}
      {tab === "movs" && <Movimientos txs={txs} address={address} fxRate={fxRate} />}
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
