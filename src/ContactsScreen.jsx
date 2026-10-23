import { Fragment, useEffect, useMemo, useState } from "react";
import { isAddress } from "./arc.js";
import { useLanguage } from "./i18n.jsx";
import { searchContacts, validateContact } from "./contacts.js";

// Agenda: lista agrupada (como Movimientos/Enviar), búsqueda, alta/edición en página y borrado con confirmación.
// Solo presentación: la validación y la API de contactos no cambian.
const C = { bg: "#F7F7F9", card: "#FFFFFF", ink: "#16161A", mut: "#7A7A85", line: "#ECECF0", orange: "#FF5A00", accent: "#fe6c1c", orangeSoft: "#FFEADF", green: "#21B95B", red: "#E4483D", redSoft: "#FDECEA", amber: "#B45309" };
const shortAddr = (a) => (a && a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a || "—");
const cta = { border: 0, borderRadius: 18, padding: "16px 18px", font: "inherit", fontSize: 16, fontWeight: 600, cursor: "pointer", width: "100%" };

const Svg = ({ size, children }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">{children}</svg>;
const stroke = { stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" };
const IconSearch = () => <Svg size={19}><circle cx="11" cy="11" r="6.5" {...stroke} strokeWidth="1.9" /><path d="M16 16l4 4" {...stroke} strokeWidth="1.9" /></Svg>;
const IconClear = () => <Svg size={16}><path d="M6 6l12 12M18 6L6 18" {...stroke} strokeWidth="2.2" /></Svg>;
const IconPlus = () => <Svg size={20}><path d="M12 5v14M5 12h14" {...stroke} strokeWidth="2.4" /></Svg>;
const IconCopy = () => <Svg size={18}><rect x="8" y="8" width="12" height="12" rx="2" {...stroke} strokeWidth="1.9" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" {...stroke} strokeWidth="1.9" /></Svg>;
const IconCheck = () => <Svg size={18}><path d="M5 12.5l5 5L19 7" {...stroke} strokeWidth="2.6" /></Svg>;
const IconBack = () => <Svg size={22}><path d="M15 6l-6 6 6 6" {...stroke} strokeWidth="2.4" /></Svg>;

function errorMessage(t, key, reason) {
  if (key === "alias" && reason === "duplicate") return t("agenda.errors.aliasDuplicate");
  return t(`agenda.errors.${key}`);
}

function Field({ id, label, hint, value, onChange, placeholder, error, mono, action }) {
  return (
    <div>
      <label htmlFor={id} style={{ display: "block", fontSize: 13, fontWeight: 500, color: C.mut, marginBottom: 8 }}>{label}</label>
      <div style={{ display: "flex", alignItems: "center", gap: 8, background: C.bg, borderRadius: 14, padding: "0 8px 0 16px", border: `1px solid ${error ? C.red : "transparent"}` }}>
        <input id={id} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder}
          autoComplete="off" autoCapitalize="off" spellCheck={false}
          aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          style={{ flex: 1, minWidth: 0, border: 0, background: "transparent", padding: "14px 0", font: "inherit", fontSize: mono ? 14 : 15, fontFamily: mono ? "ui-monospace, monospace" : "inherit", color: C.ink, outline: "none" }} />
        {action}
      </div>
      {error ? (
        <div id={`${id}-error`} role="alert" style={{ fontSize: 12.5, color: C.red, marginTop: 6 }}>{error}</div>
      ) : hint ? (
        <div id={`${id}-hint`} style={{ fontSize: 12.5, color: C.mut, marginTop: 6, lineHeight: 1.4 }}>{hint}</div>
      ) : null}
    </div>
  );
}

function ContactForm({ initial, contacts, onAdd, onUpdate, onRemove, onClose }) {
  const { t } = useLanguage();
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const editingId = initial.id || null;
  const set = (key) => (value) => { setForm((f) => ({ ...f, [key]: value })); setErrors((e) => ({ ...e, [key]: undefined, server: undefined })); };
  const canPaste = typeof navigator !== "undefined" && Boolean(navigator.clipboard?.readText);

  const save = async () => {
    const check = validateContact(form, contacts, editingId);
    if (!check.valid) { setErrors(check.errors); return; }
    setSaving(true);
    try {
      if (editingId) await onUpdate(editingId, form);
      else await onAdd(form);
      onClose();
    } catch (err) {
      setErrors(err?.code === "alias_duplicate" ? { alias: "duplicate" } : { server: true });
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    setSaving(true);
    try { await onRemove(editingId); onClose(); }
    catch { setErrors({ server: true }); setConfirmDelete(false); }
    finally { setSaving(false); }
  };
  const paste = async () => {
    try { const text = await navigator.clipboard.readText(); if (text) set("addr")(text.trim()); } catch { /* sin permiso de portapapeles */ }
  };
  const err = (key) => (errors[key] ? errorMessage(t, key, errors[key]) : "");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 40 }}>
        <button type="button" onClick={onClose} disabled={saving} aria-label={t("agenda.back")}
          style={{ position: "absolute", left: -6, top: "50%", transform: "translateY(-50%)", width: 40, height: 40, border: 0, borderRadius: 12, background: "transparent", color: C.ink, display: "grid", placeItems: "center", cursor: "pointer", padding: 0 }}>
          <IconBack />
        </button>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 500, color: C.ink }}>{editingId ? t("agenda.editTitle") : t("agenda.newTitle")}</h2>
      </div>

      {errors.server && (
        <div role="alert" style={{ background: C.redSoft, borderRadius: 14, padding: "12px 14px", fontSize: 13.5, color: C.red }}>{t("agenda.errors.server")}</div>
      )}
      <Field id="mp-contact-name" label={t("agenda.form.nameLabel")} value={form.name} onChange={set("name")} placeholder={t("agenda.form.namePlaceholder")} error={err("name")} />
      <Field id="mp-contact-alias" label={t("agenda.form.aliasLabel")} hint={t("agenda.form.aliasHint")} value={form.alias} onChange={set("alias")}
        placeholder={t("agenda.form.aliasPlaceholder")} error={err("alias")} />
      <Field id="mp-contact-addr" label={t("agenda.form.addressLabel")} value={form.addr} onChange={set("addr")} placeholder={t("agenda.form.addressPlaceholder")}
        error={err("addr")} mono
        action={canPaste && !form.addr ? (
          <button type="button" onClick={paste} style={{ border: 0, borderRadius: 999, background: C.orangeSoft, color: C.accent, font: "inherit", fontSize: 13, fontWeight: 600, padding: "6px 12px", cursor: "pointer", flexShrink: 0 }}>
            {t("agenda.paste")}
          </button>
        ) : null} />
      <Field id="mp-contact-note" label={t("agenda.form.noteLabel")} value={form.note || ""} onChange={set("note")} placeholder={t("agenda.form.notePlaceholder")} error={err("note")} />

      {confirmDelete ? (
        <div role="alertdialog" aria-labelledby="mp-contact-delete-title" style={{ background: C.redSoft, borderRadius: 18, padding: "16px 16px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div id="mp-contact-delete-title" style={{ fontSize: 15, fontWeight: 600, color: C.ink }}>{t("agenda.deleteConfirmTitle", initial.name)}</div>
            <div style={{ fontSize: 13, color: C.mut, marginTop: 4, lineHeight: 1.45 }}>{t("agenda.deleteConfirmBody")}</div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" onClick={() => setConfirmDelete(false)} disabled={saving} style={{ ...cta, padding: "13px 14px", fontSize: 15, background: C.card, color: C.ink }}>
              {t("agenda.form.cancel")}
            </button>
            <button type="button" onClick={remove} disabled={saving} style={{ ...cta, padding: "13px 14px", fontSize: 15, background: C.red, color: "#fff", opacity: saving ? 0.6 : 1 }}>
              {t("agenda.deleteConfirmBtn")}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
          <button type="button" onClick={save} disabled={saving} aria-busy={saving || undefined}
            style={{ ...cta, background: C.orange, color: "#fff", opacity: saving ? 0.6 : 1, boxShadow: saving ? "none" : "0 8px 20px rgba(255,90,0,0.28)" }}>
            {editingId ? t("agenda.form.save") : t("agenda.form.saveNew")}
          </button>
          <button type="button" onClick={onClose} disabled={saving} style={{ ...cta, background: C.bg, color: C.ink }}>
            {t("agenda.form.cancel")}
          </button>
          {editingId && (
            <button type="button" onClick={() => setConfirmDelete(true)} disabled={saving}
              style={{ border: 0, background: "transparent", color: C.red, font: "inherit", fontSize: 14.5, fontWeight: 600, padding: "10px 0", cursor: "pointer" }}>
              {t("agenda.form.delete")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function ContactsScreen({ contacts, onAdd, onUpdate, onRemove, loadError, onRetry }) {
  const { t, locale } = useLanguage();
  const [query, setQuery] = useState("");
  const [form, setForm] = useState(null); // null = lista; objeto = alta o edición
  const [copiedId, setCopiedId] = useState(null);
  const [topEl, setTopEl] = useState(null);

  useEffect(() => {
    if (!copiedId) return undefined;
    const timer = setTimeout(() => setCopiedId(null), 1500);
    return () => clearTimeout(timer);
  }, [copiedId]);

  const sorted = useMemo(() => [...contacts].sort((a, b) => a.name.localeCompare(b.name, locale, { sensitivity: "base" })), [contacts, locale]);
  const visible = searchContacts(sorted, query.trim().replace(/^@/, ""));
  const open = (value) => {
    setForm(value);
    topEl?.closest(".mp-scroll")?.scrollTo?.({ top: 0 });
  };
  const copy = async (c) => {
    try { await navigator.clipboard.writeText(c.addr); setCopiedId(c.id); } catch { /* sin permiso de portapapeles */ }
  };

  if (form) {
    return (
      <div ref={setTopEl}>
        <ContactForm key={form.id || "new"} initial={form} contacts={contacts} onAdd={onAdd} onUpdate={onUpdate} onRemove={onRemove} onClose={() => setForm(null)} />
      </div>
    );
  }

  return (
    <div ref={setTopEl} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <h2 style={{ fontSize: 24, fontWeight: 500, color: C.ink, margin: 0, letterSpacing: -0.3 }}>{t("agenda.title")}</h2>
        <button type="button" onClick={() => open({ name: "", alias: "", addr: "", note: "" })} aria-label={t("agenda.addButton")}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, border: 0, borderRadius: 999, background: C.orangeSoft, color: C.accent, font: "inherit", fontSize: 14, fontWeight: 600, padding: "8px 14px 8px 10px", cursor: "pointer" }}>
          <IconPlus />{t("agenda.addShort")}
        </button>
      </div>

      {loadError && (
        <div role="alert" style={{ display: "flex", alignItems: "center", gap: 12, background: C.redSoft, borderRadius: 18, padding: "12px 14px" }}>
          <div style={{ flex: 1, fontSize: 13, color: C.red, lineHeight: 1.45 }}>{loadError}</div>
          <button type="button" onClick={onRetry} style={{ border: 0, borderRadius: 999, background: C.card, color: C.red, font: "inherit", fontSize: 13, fontWeight: 600, padding: "8px 12px", cursor: "pointer", flexShrink: 0 }}>
            {t("agenda.retry")}
          </button>
        </div>
      )}

      {contacts.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, background: C.bg, borderRadius: 16, padding: "0 8px 0 14px" }}>
          <span style={{ color: C.mut, display: "grid", placeItems: "center" }}><IconSearch /></span>
          <label htmlFor="mp-agenda-search" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{t("agenda.searchPlaceholder")}</label>
          <input id="mp-agenda-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("agenda.searchPlaceholder")}
            autoComplete="off" autoCapitalize="off" spellCheck={false}
            style={{ flex: 1, minWidth: 0, border: 0, background: "transparent", padding: "14px 0", font: "inherit", fontSize: 15, color: C.ink, outline: "none" }} />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label={t("sendFlow.clear")}
              style={{ width: 32, height: 32, border: 0, borderRadius: 10, background: "transparent", color: C.mut, display: "grid", placeItems: "center", cursor: "pointer", padding: 0 }}>
              <IconClear />
            </button>
          )}
        </div>
      )}

      {contacts.length === 0 ? (
        <div style={{ background: C.bg, borderRadius: 22, padding: "26px 20px", textAlign: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 500, color: C.ink }}>{t("agenda.emptyTitle")}</div>
          <div style={{ fontSize: 14, color: C.mut, lineHeight: 1.55, marginTop: 6 }}>{t("agenda.emptyBody")}</div>
          <button type="button" onClick={() => open({ name: "", alias: "", addr: "", note: "" })}
            style={{ ...cta, marginTop: 18, background: C.orange, color: "#fff", boxShadow: "0 8px 20px rgba(255,90,0,0.28)" }}>
            {t("agenda.addButton")}
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div style={{ background: C.bg, borderRadius: 22, padding: 20, fontSize: 14, color: C.mut, lineHeight: 1.55, textAlign: "center" }}>
          {t("agenda.noMatch", query.trim())}
        </div>
      ) : (
        <div style={{ background: C.bg, borderRadius: 22, padding: "2px 14px" }}>
          {visible.map((c, index) => {
            const compatible = isAddress(c.addr || "");
            const copied = copiedId === c.id;
            return (
              <Fragment key={c.id || c.alias}>
                {index > 0 && <div aria-hidden="true" style={{ height: 1, background: C.line }} />}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button type="button" onClick={() => open({ ...c })} aria-label={t("agenda.editAria", c.name)}
                    style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 12, border: 0, background: "transparent", padding: "12px 0", font: "inherit", color: "inherit", textAlign: "left", cursor: "pointer" }}>
                    <span style={{ width: 40, height: 40, borderRadius: "50%", background: C.orangeSoft, color: C.accent, display: "grid", placeItems: "center", flexShrink: 0, fontWeight: 600, fontSize: 15 }}>
                      {(c.name || "?").slice(0, 1).toUpperCase()}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 15, fontWeight: 500, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
                      <span style={{ display: "block", fontSize: 12.5, color: compatible ? C.mut : C.amber, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        @{c.alias} · {compatible ? shortAddr(c.addr) : t("agenda.incompatible")}
                      </span>
                    </span>
                  </button>
                  <button type="button" onClick={() => copy(c)} aria-label={copied ? t("agenda.copied") : t("agenda.copyAria", c.name)}
                    style={{ width: 38, height: 38, border: 0, borderRadius: 12, background: "transparent", color: copied ? C.green : C.accent, display: "grid", placeItems: "center", cursor: "pointer", padding: 0, flexShrink: 0 }}>
                    {copied ? <IconCheck /> : <IconCopy />}
                  </button>
                </div>
              </Fragment>
            );
          })}
        </div>
      )}
      <div role="status" aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
        {copiedId ? t("agenda.copied") : ""}
      </div>
    </div>
  );
}
