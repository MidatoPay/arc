import { useLanguage, LANGUAGES } from "./i18n.jsx";

// Selector de idioma desplegable (select nativo: en el celular abre el selector del sistema).
// variant "subtle": sobre fondos oscuros (onboarding).
export default function LanguageSelect({ variant = "default", id = "mp-language" }) {
  const { lang, setLang, t } = useLanguage();
  const subtle = variant === "subtle";
  const color = subtle ? "#FFFFFF" : "#16161A";
  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center", flexShrink: 0 }}>
      <label htmlFor={id} style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}>
        {t("app.language")}
      </label>
      <select id={id} value={lang} onChange={(event) => setLang(event.target.value)}
        style={{
          appearance: "none", WebkitAppearance: "none", MozAppearance: "none",
          font: "inherit", fontSize: 13.5, fontWeight: 600, color, cursor: "pointer", outline: "none",
          background: subtle ? "rgba(0,0,0,0.28)" : "#FFFFFF",
          border: subtle ? "1px solid rgba(255,255,255,0.28)" : "1px solid #ECECF0",
          borderRadius: 999, padding: "8px 34px 8px 14px", lineHeight: 1.2,
        }}>
        {LANGUAGES.map((language) => (
          <option key={language.id} value={language.id} style={{ color: "#16161A", background: "#FFFFFF" }}>{language.label}</option>
        ))}
      </select>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"
        style={{ position: "absolute", right: 13, pointerEvents: "none", color: subtle ? "rgba(255,255,255,0.8)" : "#7A7A85" }}>
        <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
