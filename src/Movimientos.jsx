import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLanguage } from "./i18n.jsx";
import { SOLANA, explorerAddressUrl, explorerTxUrl } from "./chain.js";
import { paymentReceived, deliveryNoticeKey } from "./chargeStatus.js";
import { activityStatusKey } from "./transactions.js";

// Movimientos: lista agrupada por día, carga incremental de a 10, filtros y comprobante.
// Solo presentación: no cambia estados, importes ni llamadas al backend.
const C = {
  bg: "#F7F7F9", card: "#FFFFFF", ink: "#16161A", mut: "#7A7A85", line: "#ECECF0",
  orange: "#FF5A00", accent: "#fe6c1c", orangeSoft: "#FFEADF", orangeTint: "#FFF4ED",
  violet: "#5C4CC7", violetSoft: "#ECEAFA", green: "#21B95B", red: "#E4483D",
};
export const MOVS_PAGE_SIZE = 10;
export const EMPTY_MOVS_FILTERS = Object.freeze({ date: "all", from: "", to: "", types: [] });
const DATE_PRESETS = ["all", "today", "7d", "30d", "custom"];
const DATE_LABELS = { all: "movs.dateAll", today: "movs.dateToday", "7d": "movs.date7", "30d": "movs.date30", custom: "movs.dateCustom" };
const TYPE_LABELS = { charge: "movs.typeCharge", qr: "movs.typeQr", send: "movs.typeSend", received: "movs.typeReceived", convert: "movs.typeConvert" };
const MOVS_TYPES = ["charge", "qr", "send", "received", "convert"].filter((id) => id !== "convert" || SOLANA.cluster === "devnet");

const fmt = (n, d, locale) => Number(n).toLocaleString(locale, { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtArs = (n) => Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtUsdcFull = (n, locale) => Number(n).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
const shortId = (a) => (a && a.length > 16 ? `${a.slice(0, 6)}…${a.slice(-6)}` : a || "—");
/** Dirección Solana completa (base58), p. ej. un envío a una wallet que no está en la agenda. */
export const isSolanaAddress = (s) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(s || "").trim());
/** Nombre visible de la contraparte: una dirección completa se acorta a 4…4, como los recibidos de wallets externas. */
export const displayWho = (who) => (isSolanaAddress(who) ? `${who.trim().slice(0, 4)}…${who.trim().slice(-4)}` : who);
const finite = (n) => n !== null && n !== undefined && n !== "" && Number.isFinite(Number(n));

// ————— íconos —————
const line = { stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" };
const Svg = ({ size, children }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">{children}</svg>
);
const IconArrowDown = ({ size = 17 }) => <Svg size={size}><path d="M12 5v14M5 12l7 7 7-7" {...line} strokeWidth="2.4" /></Svg>;
const IconArrowUp = ({ size = 17 }) => <Svg size={size}><path d="M12 19V5M5 12l7-7 7 7" {...line} strokeWidth="2.4" /></Svg>;
const IconDiagUp = ({ size = 18 }) => <Svg size={size}><path d="M7 17 17 7M9 7h8v8" {...line} strokeWidth="2.2" /></Svg>;
const IconDiagDown = ({ size = 18 }) => <Svg size={size}><path d="M17 7 7 17M15 17H7V9" {...line} strokeWidth="2.2" /></Svg>;
const IconSwap = ({ size = 17 }) => <Svg size={size}><path d="M7 8h14M17 4l4 4-4 4M17 16H3M7 20l-4-4 4-4" {...line} strokeWidth="2.4" /></Svg>;
const IconBan = ({ size = 17 }) => <Svg size={size}><circle cx="12" cy="12" r="9" {...line} strokeWidth="2" /><path d="M7.8 7.8l8.4 8.4" {...line} strokeWidth="2" /></Svg>;
const IconCheck = ({ size = 16 }) => <Svg size={size}><path d="M5 12.5l5 5L19 7" {...line} strokeWidth="2.6" /></Svg>;
const IconClock = ({ size = 16 }) => <Svg size={size}><circle cx="12" cy="12" r="8.5" {...line} strokeWidth="2.2" /><path d="M12 7.5V12l3 2" {...line} strokeWidth="2.2" /></Svg>;
const IconClose = ({ size = 16 }) => <Svg size={size}><path d="M6 6l12 12M18 6L6 18" {...line} strokeWidth="2.4" /></Svg>;
const IconCopy = ({ size = 18 }) => <Svg size={size}><rect x="8" y="8" width="12" height="12" rx="2" {...line} strokeWidth="1.9" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" {...line} strokeWidth="1.9" /></Svg>;
const IconBack = ({ size = 24 }) => <Svg size={size}><path d="M15 5l-7 7 7 7" {...line} strokeWidth="2" /></Svg>;
const IconShare = ({ size = 24 }) => <Svg size={size}><circle cx="18" cy="5.5" r="2.5" {...line} strokeWidth="1.8" /><circle cx="6" cy="12" r="2.5" {...line} strokeWidth="1.8" /><circle cx="18" cy="18.5" r="2.5" {...line} strokeWidth="1.8" /><path d="M8.2 10.8l7.6-4.1M8.2 13.2l7.6 4.1" {...line} strokeWidth="1.8" /></Svg>;
const IconExternal = ({ size = 15 }) => <Svg size={size}><path d="M14 5h5v5M10 14L19 5" {...line} strokeWidth="2" /><path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" {...line} strokeWidth="2" /></Svg>;
const IconSliders = ({ size = 22 }) => <Svg size={size}><path d="M6 4v16M12 4v16M18 4v16" {...line} strokeWidth="1.8" /><circle cx="6" cy="15" r="2.2" fill="#fff" {...line} strokeWidth="1.8" /><circle cx="12" cy="8" r="2.2" fill="#fff" {...line} strokeWidth="1.8" /><circle cx="18" cy="14" r="2.2" fill="#fff" {...line} strokeWidth="1.8" /></Svg>;
const IconQr = ({ size = 18 }) => <Svg size={size}><rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.2" {...line} strokeWidth="1.9" /><rect x="14" y="3.5" width="6.5" height="6.5" rx="1.2" {...line} strokeWidth="1.9" /><rect x="3.5" y="14" width="6.5" height="6.5" rx="1.2" {...line} strokeWidth="1.9" /><path d="M14 14h2.5v2.5M20.5 14v.01M14 20.5h.01M17.5 17.5v3h3" {...line} strokeWidth="1.9" /></Svg>;
const ROW_ICONS = { ban: IconBan, swap: IconSwap, in: IconArrowDown, out: IconArrowUp };
const TYPE_ICONS = { charge: IconArrowDown, qr: IconQr, send: IconDiagUp, received: IconDiagDown, convert: IconSwap };

// ————— helpers puros (agrupado, filtros) —————
/** Clave estable: un cobro conserva su clave aunque el hash cambie de "charge:<id>" a la firma. */
export function txKey(tx) {
  if (tx.chargeId) return `c:${tx.chargeId}`;
  if (tx.transferId) return `t:${tx.transferId}`;
  return `h:${tx.hash}`;
}

/** Categoría visible en el filtro "Por tipo de movimiento". */
export function txCategory(tx) {
  if (tx.kind === "convert_ars_usdc" || tx.kind === "convert_usdc_ars") return "convert";
  if (tx.source === "mercadopago" || tx.kind === "charge" || tx.kind === "charge_mercadopago" ||
    (tx.kind === "charge_p2p" && tx.direction === "in")) return "charge";
  if (tx.kind === "charge_p2p") return "qr";
  return tx.direction === "in" ? "received" : "send";
}

const localDayKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Día local (YYYY-MM-DD) desplazado `days` días desde `now`. */
export function dayKeyOffset(days, now = new Date()) {
  return localDayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
}

export function txDayKey(tx) {
  const d = new Date(tx.createdAt || "");
  return Number.isFinite(d.getTime()) ? localDayKey(d) : "";
}

/** Rango inclusivo de días locales para el filtro de fecha ("" = sin límite). */
export function movsDateRange(filters, now = new Date()) {
  if (filters.date === "today") return { from: dayKeyOffset(0, now), to: dayKeyOffset(0, now) };
  if (filters.date === "7d") return { from: dayKeyOffset(-6, now), to: dayKeyOffset(0, now) };
  if (filters.date === "30d") return { from: dayKeyOffset(-29, now), to: dayKeyOffset(0, now) };
  if (filters.date !== "custom") return { from: "", to: "" };
  const [from, to] = filters.from && filters.to && filters.from > filters.to
    ? [filters.to, filters.from] : [filters.from || "", filters.to || ""];
  return { from, to };
}

export function filterMovs(list, filters, now = new Date()) {
  const { from, to } = movsDateRange(filters, now);
  const types = new Set(filters.types);
  return list.filter((tx) => {
    if (types.size && !types.has(txCategory(tx))) return false;
    if (!from && !to) return true;
    const key = txDayKey(tx);
    return Boolean(key) && (!from || key >= from) && (!to || key <= to);
  });
}

export function sortNewest(list) {
  const time = (tx) => Date.parse(tx.createdAt || "") || 0;
  return [...list].sort((a, b) => time(b) - time(a));
}

export function groupByDay(list) {
  const groups = [];
  for (const tx of list) {
    const key = txDayKey(tx), last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(tx);
    else groups.push({ key, items: [tx] });
  }
  return groups;
}

const isDateActive = (f) => (f.date === "custom" ? Boolean(f.from || f.to) : f.date !== "all");
export const activeFilterCount = (f) => f.types.length + (isDateActive(f) ? 1 : 0);

const dateFromKey = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};

function dayLabel(key, t, locale, now = new Date()) {
  if (!key) return "—";
  if (key === dayKeyOffset(0, now)) return t("movs.today");
  if (key === dayKeyOffset(-1, now)) return t("movs.yesterday");
  const date = dateFromKey(key);
  const withYear = date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {};
  return date.toLocaleDateString(locale, { day: "numeric", month: "long", ...withYear });
}

function dateFilterLabel(filters, t, locale) {
  if (filters.date !== "custom") return t(DATE_LABELS[filters.date]);
  const day = (key) => dateFromKey(key).toLocaleDateString(locale, { day: "numeric", month: "short" });
  const { from, to } = movsDateRange(filters);
  if (from && to) return from === to ? day(from) : `${day(from)} – ${day(to)}`;
  if (from) return t("movs.dateSince", day(from));
  if (to) return t("movs.dateUntil", day(to));
  return t("movs.dateAll");
}

/** Resumen de una fila (mismo contenido que la card de Inicio). */
export function txSummary(tx, t, locale) {
  const inbound = tx.direction === "in";
  const isConvert = tx.kind === "convert_ars_usdc" || tx.kind === "convert_usdc_ars";
  const mp = tx.source === "mercadopago";
  const pendingCharge = mp && tx.settled === false;
  const receivedCharge = mp && paymentReceived(tx);
  const blockedCharge = mp && ["canceled", "expired", "refunded", "cancel_pending"].includes(tx.status);
  const statusKey = activityStatusKey(tx);
  const usdc = fmt(tx.amt, 2, locale), ars = fmtArs(tx.ars);
  const title = mp ? tx.who
    : isConvert ? (tx.kind === "convert_ars_usdc" ? "ARS → USDC" : "USDC → ARS")
      : tx.kind === "charge" || tx.kind === "charge_mercadopago" || (tx.kind === "charge_p2p" && inbound) ? t("movs.charge") : displayWho(tx.who);
  const primary = blockedCharge ? `${ars} ARS`
    : receivedCharge ? `+${usdc} USDC`
      : pendingCharge ? `${ars} ARS`
        : tx.kind === "convert_ars_usdc" ? `+${usdc} USDC`
          : tx.kind === "convert_usdc_ars" ? `−${usdc} USDC`
            : `${inbound ? "+" : "−"}${usdc} USDC`;
  const secondary = blockedCharge ? `${ars} ARS`
    : receivedCharge ? `${t(pendingCharge ? "movs.pendingUsdc" : "movs.creditedUsdc")}: ${usdc} USDC`
      : pendingCharge ? `${ars} ARS`
        : tx.kind === "convert_ars_usdc" ? `−${ars} ARS`
          : tx.kind === "convert_usdc_ars" ? `+${ars} ARS`
            : `${inbound ? "+" : "−"}${ars} ARS`;
  const created = new Date(tx.createdAt || "");
  const timeShort = Number.isFinite(created.getTime())
    // "hs" es la convención argentina; en inglés y chino la hora local ya es clara sola.
    ? `${created.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}${locale === "es-AR" ? " hs" : ""}` : "";
  const subtitle = statusKey ? t(`movs.${statusKey}`) : isConvert ? t("movs.convert") : inbound ? t("movs.charge") : t("movs.transfer");
  return {
    title, subtitle, primary, secondary, timeShort,
    icon: blockedCharge ? "ban" : isConvert ? "swap" : inbound ? "in" : "out",
    iconBg: blockedCharge ? "#F0F0F3" : isConvert || inbound ? C.orangeSoft : C.violetSoft,
    iconColor: blockedCharge ? C.mut : isConvert ? C.accent : inbound ? C.orange : C.violet,
  };
}

function TxSummaryRow({ s }) {
  const Icon = ROW_ICONS[s.icon];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ width: 40, height: 40, borderRadius: "50%", background: s.iconBg, color: s.iconColor, display: "grid", placeItems: "center", flexShrink: 0 }}>
        <Icon />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 500, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.title}</div>
        <div style={{ fontSize: 12.5, fontWeight: 400, color: C.mut, marginTop: 3 }}>{s.subtitle}</div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 500, color: C.ink, fontVariantNumeric: "tabular-nums" }}>{s.primary}</div>
        <div style={{ fontSize: 12.5, fontWeight: 400, color: C.mut, marginTop: 3 }}>{s.timeShort || s.secondary}</div>
      </div>
    </div>
  );
}

/** Card de movimiento para Inicio (sin interacción). */
export function TxCard({ tx }) {
  const { t, locale } = useLanguage();
  return (
    <div style={{ background: C.bg, borderRadius: 22, padding: "14px 14px" }}>
      <TxSummaryRow s={txSummary(tx, t, locale)} />
    </div>
  );
}

/** Estado corto del comprobante. Solo presentación: no altera el estado real. */
export function txPill(tx) {
  if (tx.source === "mercadopago") {
    if (tx.status === "delivered" || (tx.settled === true && paymentReceived(tx))) return "credited";
    if (tx.status === "manual_review") return "review";
    if (paymentReceived(tx)) return "paid";
    if (["canceled", "cancel_pending"].includes(tx.status)) return "canceled";
    if (tx.status === "expired") return "expired";
    if (tx.status === "refunded") return "refunded";
    return "awaiting";
  }
  if (tx.source === "transfer") return ({ completed: "confirmed", failed: "failed", manual_review: "review" })[tx.status] || "pending";
  return "confirmed";
}

const PILL_TONE = {
  confirmed: "green", credited: "green", paid: "amber", pending: "amber", awaiting: "amber", review: "amber",
  failed: "red", canceled: "red", expired: "red", refunded: "red",
};
const TONES = {
  green: { bg: "#E7F7EE", fg: "#15803D", Icon: IconCheck },
  amber: { bg: "#FFF3E6", fg: "#B45309", Icon: IconClock },
  red: { bg: "#FDECEA", fg: "#C0392B", Icon: IconClose },
};
const RECEIPT_ACTIONS = {
  charge: { label: "movs.actionCharge", Icon: IconArrowDown, prop: "onNewCharge" },
  send: { label: "movs.actionSend", Icon: IconDiagUp, prop: "onNewSend" },
  qr: { label: "movs.actionPay", Icon: IconQr, prop: "onNewPay" },
  convert: { label: "movs.actionConvert", Icon: IconSwap, prop: "onNewConvert" },
};

/** Contenido del comprobante: título, importe, estado y filas de detalle. */
export function receiptView(tx, t, locale) {
  const category = txCategory(tx);
  const mp = tx.source === "mercadopago";
  const pill = txPill(tx), tone = PILL_TONE[pill];
  const signature = tx.signature || (tx.hash && !/^(charge|transfer):/.test(tx.hash) ? tx.hash : null);
  const usdc = finite(tx.amt) ? `${fmtUsdcFull(tx.amt, locale)} USDC` : null;
  const ars = finite(tx.ars) ? `$ ${fmtArs(tx.ars)} ARS` : null;
  const rate = finite(tx.fxRate) && Number(tx.fxRate) > 0 ? `$ ${fmtArs(tx.fxRate)} / USDC` : null;
  // Cobro con USDC acreditados: el comprobante destaca lo que recibió el comercio, no el ARS cobrado.
  const creditedCharge = category === "charge" && pill === "credited" && Boolean(usdc);
  const title = creditedCharge ? t("movs.receiptChargeCredited")
    : category === "convert"
      ? t(tx.kind === "convert_ars_usdc" ? "movs.convertArsUsdc" : "movs.convertUsdcArs")
      : t({ charge: "movs.receiptCharge", qr: "movs.receiptQr", received: "movs.receiptReceived", send: "movs.receiptSend" }[category]);
  // Titular con 2 decimales (como la lista); montos menores a 0,01 muestran su precisión completa. El detalle siempre es exacto.
  const headlineUsdc = creditedCharge
    ? `${Number(tx.amt) >= 0.01 ? fmt(tx.amt, 2, locale) : fmtUsdcFull(tx.amt, locale)} USDC` : null;
  const rows = [], refs = [];
  const add = (label, value, copy) => { if (value) rows.push({ label, value, copy }); };
  if (category === "charge") {
    add(t("movs.rowMerchant"), tx.who);
    add(t("movs.rowAmountCharged"), ars);
    if (mp && finite(tx.feeArs)) add(t("movs.rowFee"), `$ ${fmtArs(tx.feeArs)} ARS`);
    add(t("movs.rowExchangeRate"), rate);
    if (tone !== "red") add(t(pill === "credited" || !mp ? "movs.rowReceived" : "movs.rowToReceive"), usdc);
  } else {
    // Wallet sin agendar: se ve 4…4 y la dirección completa queda para copiar (y en el comprobante compartido).
    add(t(category === "received" ? "movs.rowOrigin" : category === "convert" ? "movs.rowCounterpart" : "movs.rowRecipient"),
      displayWho(tx.who), isSolanaAddress(tx.who) ? tx.who.trim() : undefined);
    add(t("movs.rowAmount"), usdc);
    // Envíos y recibidos son USDC directo: el equivalente en ARS solo aplica a operaciones con precio en pesos
    // (pago de un cobro MidatoPay por QR) o a conversiones.
    if (category === "qr" || category === "convert") {
      add(t("movs.rowEquals"), ars);
      add(t("movs.rowExchangeRate"), rate);
    }
    if (tx.source === "transfer") add(t("movs.rowNetworkCost"), t("movs.networkCostSponsored"));
  }
  add(t("movs.rowNetwork"), `Solana ${SOLANA.cluster === "devnet" ? "Devnet" : "Mainnet"}`);
  if (mp && tx.orderId) refs.push({ label: t("movs.rowOrder"), value: tx.orderId, copy: tx.orderId });
  if (tx.factura && !String(tx.factura).startsWith("transfer_")) refs.push({ label: t("movs.rowOperation"), value: tx.factura, copy: tx.factura });
  if (signature) refs.push({ label: t("movs.rowTxId"), value: shortId(signature), copy: signature, accent: true });
  const created = new Date(tx.createdAt || "");
  const dateText = Number.isFinite(created.getTime())
    ? t("movs.receiptDate", created.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" }),
      created.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }))
    : "";
  const statusKey = tone === "amber" ? activityStatusKey(tx) : null;
  const noticeKey = mp && tone === "amber" ? deliveryNoticeKey(tx) : null;
  return {
    category, title, pill, tone, rows, refs, signature, dateText,
    amount: headlineUsdc || (category === "charge" ? ars : usdc) || "—",
    status: statusKey ? t(`movs.${statusKey}`) : "",
    notice: noticeKey ? t(`movs.${noticeKey}`) : "",
  };
}

function shareText(view, t) {
  return [
    `MidatoPay · ${view.title}`, view.amount, view.dateText, `${t(`movs.pill.${view.pill}`)}`,
    ...view.rows.map((r) => `${r.label}: ${r.copy || r.value}`),
    ...view.refs.map((r) => `${r.label}: ${r.copy}`),
    view.signature ? explorerTxUrl(view.signature) : "",
  ].filter(Boolean).join("\n");
}

// ————— comprobante (estilo ticket) —————
function TicketDivider() {
  const notch = { position: "absolute", top: 0, width: 22, height: 22, borderRadius: "50%", background: C.bg };
  return (
    <div aria-hidden="true" style={{ position: "relative", height: 22 }}>
      <span style={{ ...notch, left: -11 }} />
      <span style={{ ...notch, right: -11 }} />
      <div style={{ position: "absolute", left: 20, right: 20, top: 10, borderTop: "1.5px dashed #DCDCE2" }} />
    </div>
  );
}

function CopyButton({ value, label, onCopied }) {
  const { t } = useLanguage();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return undefined;
    const timer = setTimeout(() => setDone(false), 1600);
    return () => clearTimeout(timer);
  }, [done]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      onCopied?.(t("movs.copied"));
    } catch { /* El navegador no dio permiso de portapapeles. */ }
  };
  return (
    <button type="button" onClick={copy} aria-label={`${t("movs.copy")}: ${label}`}
      style={{ border: 0, background: "transparent", color: done ? C.green : C.accent, cursor: "pointer", padding: 8, margin: -4, display: "grid", placeItems: "center", flexShrink: 0 }}>
      {done ? <IconCheck size={18} /> : <IconCopy />}
    </button>
  );
}

function ReceiptAction({ icon, label, onClick, buttonRef }) {
  return (
    <button ref={buttonRef} type="button" onClick={onClick}
      style={{ flex: 1, minWidth: 0, border: 0, background: "transparent", font: "inherit", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "6px 4px", color: C.accent }}>
      {icon}
      <span style={{ fontSize: 12.5, fontWeight: 500, color: C.ink, lineHeight: 1.25, textAlign: "center", whiteSpace: "pre-line" }}>{label}</span>
    </button>
  );
}

export function TxReceipt({ tx, onClose, actions, onOpenTransfer }) {
  const { t, locale } = useLanguage();
  const [note, setNote] = useState("");
  const backRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const view = receiptView(tx, t, locale);
  const tone = TONES[view.tone];
  const action = RECEIPT_ACTIONS[view.category];
  const onAction = action ? actions[action.prop] : null;

  useEffect(() => {
    backRef.current?.focus();
    const onKey = (event) => { if (event.key === "Escape") closeRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!note) return undefined;
    const timer = setTimeout(() => setNote(""), 2400);
    return () => clearTimeout(timer);
  }, [note]);

  const share = async () => {
    const text = shareText(view, t);
    try {
      if (navigator.share) { await navigator.share({ title: `MidatoPay · ${view.title}`, text }); return; }
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setNote(t("movs.receiptCopied"));
    } catch {
      setNote(t("movs.shareUnavailable"));
    }
  };

  const label = { fontSize: 14, color: C.mut, fontWeight: 400 };
  const value = { fontSize: 14, color: C.ink, fontWeight: 600, textAlign: "right", fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" };
  return (
    <div className="mp-overlay" role="dialog" aria-modal="true" aria-labelledby="mp-receipt-title"
      style={{ background: C.bg, flexDirection: "column", alignItems: "stretch", justifyContent: "flex-start" }}>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "22px 18px 20px" }}>
        <div style={{ background: C.card, borderRadius: 22, boxShadow: "0 8px 24px rgba(22,22,26,0.05)" }}>
          <div style={{ padding: "24px 20px 18px", textAlign: "center" }}>
            <div id="mp-receipt-title" style={{ fontSize: 17, fontWeight: 400, color: C.mut }}>{view.title}</div>
            <div style={{ marginTop: 8, fontSize: 32, fontWeight: 500, color: C.ink, letterSpacing: -0.6, fontVariantNumeric: "tabular-nums", lineHeight: 1.1, overflowWrap: "anywhere" }}>
              {view.amount}
            </div>
            {view.dateText && <div style={{ marginTop: 8, fontSize: 13.5, color: C.mut }}>{view.dateText}</div>}
            <div style={{ marginTop: 14, display: "inline-flex", alignItems: "center", gap: 8, background: tone.bg, color: tone.fg, borderRadius: 999, padding: "7px 14px 7px 8px", fontSize: 14, fontWeight: 600 }}>
              <span style={{ width: 20, height: 20, borderRadius: "50%", background: tone.fg, color: "#fff", display: "grid", placeItems: "center" }}>
                <tone.Icon size={12} />
              </span>
              {t(`movs.pill.${view.pill}`)}
            </div>
            {view.status && <div style={{ marginTop: 10, fontSize: 13, color: C.mut, lineHeight: 1.45 }}>{view.status}</div>}
            {view.notice && <div style={{ marginTop: 6, fontSize: 12.5, color: C.mut, lineHeight: 1.45 }}>{view.notice}</div>}
          </div>
          <TicketDivider />
          <div style={{ padding: "14px 20px 22px" }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: C.ink, marginBottom: 12 }}>{t("movs.receiptDetail")}</div>
            <div style={{ display: "grid", gap: 14 }}>
              {view.rows.map((row) => (
                <div key={row.label} style={{ display: "flex", justifyContent: "space-between", alignItems: row.copy ? "center" : "baseline", gap: 16 }}>
                  <span style={label}>{row.label}</span>
                  {row.copy ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span style={value} title={row.copy}>{row.value}</span>
                      <CopyButton value={row.copy} label={row.label} onCopied={setNote} />
                    </span>
                  ) : (
                    <span style={value}>{row.value}</span>
                  )}
                </div>
              ))}
            </div>
            {view.refs.length > 0 && <div style={{ borderTop: "1.5px dashed #DCDCE2", margin: "18px 0 14px" }} aria-hidden="true" />}
            <div style={{ display: "grid", gap: 14 }}>
              {view.refs.map((ref) => (
                <div key={ref.label} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={label}>{ref.label}</div>
                    <div style={{ marginTop: 3, fontSize: 14, fontWeight: 600, color: ref.accent ? C.accent : C.ink, overflowWrap: "anywhere", fontFamily: ref.accent ? "ui-monospace, monospace" : "inherit" }}>{ref.value}</div>
                  </div>
                  <CopyButton value={ref.copy} label={ref.label} onCopied={setNote} />
                </div>
              ))}
            </div>
            {view.signature && (
              <a href={explorerTxUrl(view.signature)} target="_blank" rel="noreferrer"
                style={{ marginTop: 18, display: "inline-flex", alignItems: "center", gap: 6, color: C.accent, textDecoration: "none", fontSize: 14, fontWeight: 600 }}>
                {t("movs.viewOnchain")}<IconExternal />
              </a>
            )}
            {tx.transferId && onOpenTransfer && (
              <button type="button" onClick={() => onOpenTransfer(tx.transferId)}
                style={{ display: "block", marginTop: 14, border: 0, background: "transparent", padding: 0, font: "inherit", fontSize: 14, fontWeight: 600, color: C.accent, cursor: "pointer" }}>
                {t("movs.viewTransferStatus")}
              </button>
            )}
          </div>
        </div>
      </div>
      <div role="status" aria-live="polite" style={{ minHeight: 0, flexShrink: 0, textAlign: "center" }}>
        {note && (
          <span style={{ display: "inline-block", margin: "0 auto 10px", background: C.ink, color: "#fff", borderRadius: 999, padding: "8px 14px", fontSize: 13, fontWeight: 500 }}>
            {note}
          </span>
        )}
      </div>
      <div style={{ flexShrink: 0, display: "flex", background: C.card, borderRadius: "22px 22px 0 0", boxShadow: "0 -6px 24px rgba(22,22,26,0.06)", padding: "12px 8px calc(14px + env(safe-area-inset-bottom))" }}>
        <ReceiptAction buttonRef={backRef} icon={<IconBack />} label={t("movs.back")} onClick={onClose} />
        <ReceiptAction icon={<IconShare />} label={t("movs.share")} onClick={share} />
        {onAction && <ReceiptAction icon={<action.Icon size={24} />} label={t(action.label)} onClick={onAction} />}
      </div>
    </div>
  );
}

// ————— hoja de filtros —————
function DateField({ label, value, min, max, onChange }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, fontWeight: 500, color: C.mut, minWidth: 0 }}>
      {label}
      <input type="date" value={value} min={min} max={max} onChange={(event) => onChange(event.target.value)}
        style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: "11px 12px", font: "inherit", fontSize: 14, color: C.ink, background: C.card, width: "100%", minWidth: 0, boxSizing: "border-box" }} />
    </label>
  );
}

export function MovsFilterSheet({ value, onApply, onClose }) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState(() => ({ ...value, types: [...value.types] }));
  const firstRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const today = dayKeyOffset(0);

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (event) => { if (event.key === "Escape") closeRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleType = (id) => setDraft((d) => ({
    ...d, types: d.types.includes(id) ? d.types.filter((x) => x !== id) : [...d.types, id],
  }));
  const section = { fontSize: 14, fontWeight: 600, color: C.ink, margin: "18px 0 10px" };

  return (
    <div className="mp-overlay" role="presentation" onClick={onClose} style={{ background: "rgba(16,16,22,.45)", alignItems: "flex-end" }}>
      <div role="dialog" aria-modal="true" aria-labelledby="mp-filter-title" onClick={(event) => event.stopPropagation()}
        style={{ background: C.card, borderRadius: "24px 24px 0 0", width: "100%", maxHeight: "88%", display: "flex", flexDirection: "column", boxSizing: "border-box" }}>
        <div style={{ padding: "14px 20px 0", flexShrink: 0 }}>
          <div style={{ width: 42, height: 4, borderRadius: 4, background: C.line, margin: "0 auto 18px" }} />
          <div id="mp-filter-title" style={{ fontSize: 18, fontWeight: 700, color: C.ink }}>{t("movs.filterTitle")}</div>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 20px 12px" }}>
          <div style={section}>{t("movs.filterByDate")}</div>
          <div role="radiogroup" aria-label={t("movs.filterByDate")} style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {DATE_PRESETS.map((id, index) => {
              const on = draft.date === id;
              return (
                <button key={id} ref={index === 0 ? firstRef : undefined} type="button" role="radio" aria-checked={on}
                  onClick={() => setDraft((d) => ({ ...d, date: id }))}
                  style={{ border: `1px solid ${on ? C.orange : C.line}`, background: on ? C.orangeTint : C.card, color: on ? C.orange : C.ink, borderRadius: 999, padding: "8px 14px", font: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                  {t(DATE_LABELS[id])}
                </button>
              );
            })}
          </div>
          {draft.date === "custom" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
              <DateField label={t("movs.dateFrom")} value={draft.from} max={draft.to || today}
                onChange={(from) => setDraft((d) => ({ ...d, from }))} />
              <DateField label={t("movs.dateTo")} value={draft.to} min={draft.from || undefined} max={today}
                onChange={(to) => setDraft((d) => ({ ...d, to }))} />
            </div>
          )}
          <div style={section}>{t("movs.filterByType")}</div>
          <div>
            {MOVS_TYPES.map((id) => {
              const checked = draft.types.includes(id), Icon = TYPE_ICONS[id];
              return (
                <button key={id} type="button" role="checkbox" aria-checked={checked} onClick={() => toggleType(id)}
                  style={{ display: "flex", alignItems: "center", gap: 14, width: "100%", border: 0, background: "transparent", padding: "9px 0", font: "inherit", cursor: "pointer", textAlign: "left" }}>
                  <span style={{ width: 40, height: 40, borderRadius: "50%", background: "#F4F4F6", color: C.accent, display: "grid", placeItems: "center", flexShrink: 0 }}>
                    <Icon size={18} />
                  </span>
                  <span style={{ flex: 1, fontSize: 15.5, fontWeight: 500, color: C.ink }}>{t(TYPE_LABELS[id])}</span>
                  <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: 6, boxSizing: "border-box", border: checked ? 0 : "1.5px solid #C5C5CC", background: checked ? C.orange : "transparent", color: "#fff", display: "grid", placeItems: "center", flexShrink: 0 }}>
                    {checked && <IconCheck size={14} />}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ flexShrink: 0, borderTop: `1px solid ${C.line}`, padding: "14px 20px calc(18px + env(safe-area-inset-bottom))", display: "flex", alignItems: "center", gap: 12 }}>
          <button type="button" onClick={() => setDraft({ ...EMPTY_MOVS_FILTERS, types: [] })}
            style={{ border: 0, background: "transparent", color: C.orange, font: "inherit", fontSize: 15, fontWeight: 600, cursor: "pointer", padding: "12px 4px" }}>
            {t("movs.clearSelection")}
          </button>
          <button type="button" onClick={() => onApply(draft)}
            style={{ flex: 1, border: 0, borderRadius: 18, background: C.orange, color: "#fff", font: "inherit", fontSize: 16, fontWeight: 600, padding: "15px 18px", cursor: "pointer", boxShadow: "0 8px 20px rgba(255,90,0,0.28)" }}>
            {t("movs.applyFilter")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ————— pantalla —————
export default function Movimientos({ txs, address, onOpenTransfer, onNewCharge, onNewSend, onNewPay, onNewConvert }) {
  const { t, locale } = useLanguage();
  const [filters, setFilters] = useState(EMPTY_MOVS_FILTERS);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [visible, setVisible] = useState(MOVS_PAGE_SIZE);
  const [selectedKey, setSelectedKey] = useState(null);
  const topRef = useRef(null), moreRef = useRef(null), filterBtnRef = useRef(null), returnFocus = useRef(null);

  const sorted = useMemo(() => sortNewest(txs), [txs]);
  const filtered = useMemo(() => filterMovs(sorted, filters), [sorted, filters]);
  const shown = filtered.slice(0, visible);
  const groups = groupByDay(shown);
  const hasMore = filtered.length > shown.length;
  const activeCount = activeFilterCount(filters);
  // El polling de Activity reemplaza objetos; el comprobante sigue la versión más reciente.
  const selected = selectedKey ? txs.find((tx) => txKey(tx) === selectedKey) || null : null;

  useEffect(() => {
    if (selectedKey && !selected) setSelectedKey(null);
  }, [selectedKey, selected]);

  // Carga incremental: al acercarse al final del scroll se muestran 10 más.
  useEffect(() => {
    const el = moreRef.current;
    if (!el || !hasMore || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisible((n) => n + MOVS_PAGE_SIZE);
    }, { root: el.closest(".mp-scroll"), rootMargin: "0px 0px 160px 0px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, visible]);

  const applyFilters = (next) => {
    setFilters(next);
    setVisible(MOVS_PAGE_SIZE);
    setSheetOpen(false);
    topRef.current?.closest(".mp-scroll")?.scrollTo?.({ top: 0 });
    filterBtnRef.current?.focus();
  };
  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    filterBtnRef.current?.focus();
  }, []);
  const openTx = (tx, event) => {
    returnFocus.current = event.currentTarget;
    setSelectedKey(txKey(tx));
  };
  const closeTx = useCallback(() => {
    setSelectedKey(null);
    requestAnimationFrame(() => returnFocus.current?.focus?.());
  }, []);
  const actions = { onNewCharge, onNewSend, onNewPay, onNewConvert };
  const chip = { display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid #FFD9C2", background: C.orangeTint, color: C.orange, borderRadius: 999, padding: "6px 10px 6px 12px", font: "inherit", fontSize: 12.5, fontWeight: 600, cursor: "pointer" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div ref={topRef} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <h2 style={{ fontSize: 24, fontWeight: 500, color: C.ink, margin: 0, letterSpacing: -0.3 }}>{t("movs.title")}</h2>
        {txs.length > 0 && (
          <button ref={filterBtnRef} type="button" onClick={() => setSheetOpen(true)} aria-haspopup="dialog" aria-expanded={sheetOpen}
            style={{ display: "inline-flex", alignItems: "center", gap: 8, border: 0, background: "transparent", font: "inherit", fontSize: 15, fontWeight: 500, color: C.ink, cursor: "pointer", padding: "6px 2px" }}>
            {t("movs.filter")}
            <span style={{ position: "relative", display: "grid", placeItems: "center" }}>
              <IconSliders />
              {activeCount > 0 && (
                <span style={{ position: "absolute", top: -6, right: -8, minWidth: 16, height: 16, borderRadius: 8, background: C.orange, color: "#fff", fontSize: 10, fontWeight: 700, display: "grid", placeItems: "center", padding: "0 4px", boxSizing: "border-box" }}>
                  {activeCount}
                </span>
              )}
            </span>
          </button>
        )}
      </div>

      {activeCount > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: -4 }}>
          {activeCount - filters.types.length > 0 && (() => {
            const text = dateFilterLabel(filters, t, locale);
            return (
              <button type="button" style={chip} aria-label={t("movs.removeFilter", text)} onClick={() => applyFilters({ ...filters, date: "all", from: "", to: "" })}>
                {text}<IconClose size={12} />
              </button>
            );
          })()}
          {filters.types.map((id) => (
            <button key={id} type="button" style={chip} aria-label={t("movs.removeFilter", t(TYPE_LABELS[id]))}
              onClick={() => applyFilters({ ...filters, types: filters.types.filter((x) => x !== id) })}>
              {t(TYPE_LABELS[id])}<IconClose size={12} />
            </button>
          ))}
          <span style={{ fontSize: 12.5, color: C.mut, marginLeft: "auto" }}>{t("movs.results", filtered.length)}</span>
        </div>
      )}

      {txs.length === 0 ? (
        <div style={{ background: C.bg, borderRadius: 22, padding: 20, fontSize: 14, color: C.mut, lineHeight: 1.55 }}>{t("movs.emptyBody")}</div>
      ) : filtered.length === 0 ? (
        <div style={{ background: C.bg, borderRadius: 22, padding: 20, textAlign: "center" }}>
          <div style={{ fontSize: 14, color: C.mut, lineHeight: 1.55 }}>{t("movs.noResults")}</div>
          <button type="button" onClick={() => applyFilters(EMPTY_MOVS_FILTERS)}
            style={{ marginTop: 12, border: 0, background: "transparent", color: C.orange, font: "inherit", fontSize: 14, fontWeight: 600, cursor: "pointer", padding: 6 }}>
            {t("movs.clearFilters")}
          </button>
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.key || "sin-fecha"} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 500, color: C.ink }}>{dayLabel(group.key, t, locale)}</h3>
            <div style={{ background: C.bg, borderRadius: 22, padding: "2px 14px" }}>
              {group.items.map((tx, index) => {
                const s = txSummary(tx, t, locale);
                return (
                  <Fragment key={txKey(tx)}>
                    {index > 0 && <div aria-hidden="true" style={{ height: 1, background: C.line }} />}
                    <button type="button" onClick={(event) => openTx(tx, event)} aria-haspopup="dialog" aria-label={t("movs.openDetail", `${s.title}, ${s.primary}`)}
                      style={{ display: "block", width: "100%", border: 0, background: "transparent", padding: "12px 0", font: "inherit", color: "inherit", textAlign: "left", cursor: "pointer" }}>
                      <TxSummaryRow s={s} />
                    </button>
                  </Fragment>
                );
              })}
            </div>
          </section>
        ))
      )}

      {hasMore && (
        <button ref={moreRef} type="button" onClick={() => setVisible((n) => n + MOVS_PAGE_SIZE)}
          style={{ border: `1.5px solid ${C.line}`, background: C.card, color: C.ink, borderRadius: 14, padding: "13px 18px", font: "inherit", fontSize: 14.5, fontWeight: 600, cursor: "pointer" }}>
          {t("movs.loadMore")}
        </button>
      )}
      {filtered.length > 0 && (
        <div style={{ textAlign: "center", fontSize: 12.5, color: C.mut }}>{t("movs.showingOf", shown.length, filtered.length)}</div>
      )}
      {!hasMore && (
        <a href={explorerAddressUrl(address)} target="_blank" rel="noreferrer"
          style={{ display: "block", textAlign: "center", textDecoration: "none", border: `1.5px solid ${C.line}`, borderRadius: 14, padding: "16px 20px", fontSize: 16, fontWeight: 700, color: C.ink, background: C.card }}>
          {t("movs.viewFullHistory")}
        </a>
      )}

      {sheetOpen && <MovsFilterSheet value={filters} onApply={applyFilters} onClose={closeSheet} />}
      {selected && <TxReceipt tx={selected} onClose={closeTx} actions={actions} onOpenTransfer={onOpenTransfer} />}
    </div>
  );
}
