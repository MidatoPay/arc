import { useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useExportWallet, useWallets } from "@privy-io/react-auth/solana";
import { useLanguage } from "./i18n.jsx";
import { openTreasuryWalletExport, treasuryExportWallets } from "./treasuryWalletExport.js";
import {transferApi} from './transfers.js';

const copy = {
  es: {
    title: "Exportar billetera de tesorería",
    wallet: "Billetera Solana", active: "Tesorería configurada",
    notice: "La clave permite controlar todos los fondos de esta billetera. Privy la mostrará en su ventana segura. No la compartas.",
    button: "Abrir exportación en Privy", opening: "Exportación abierta…",
    error: "No se pudo abrir la exportación. Verificá tu sesión y volvé a intentarlo.",
  },
  en: {
    title: "Export treasury wallet",
    wallet: "Solana wallet", active: "Configured treasury",
    notice: "The key controls all funds in this wallet. Privy will display it in its secure window. Do not share it.",
    button: "Open export in Privy", opening: "Export open…",
    error: "Could not open the export. Check your session and try again.",
  },
};

export default function TreasuryWalletExport({ treasuryAddress, authorized=false }) {
  const { ready, authenticated, user, getAccessToken } = usePrivy();
  const { ready: walletsReady } = useWallets();
  const { exportWallet } = useExportWallet();
  const { lang } = useLanguage();
  const text = copy[lang] || copy.es;
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const exporting = useRef(false);
  const addresses = treasuryExportWallets(user).filter(address=>address===treasuryAddress);
  const selected = treasuryAddress;

  if (!authorized || !ready || !authenticated || !walletsReady || !user?.id || !addresses.length) return null;

  const open = async () => {
    if (exporting.current) return;
    exporting.current = true; setBusy(true); setError(false);
    try {
      await openTreasuryWalletExport({ ready, authenticated, user, address: selected, exportWallet,
        authorize:()=>transferApi('/treasury/export-access',getAccessToken) });
    } catch {
      // Do not expose SDK errors that could contain sensitive export information.
      setError(true);
    } finally {
      exporting.current = false; setBusy(false);
    }
  };

  return <details style={{ background: "#FFFFFF", borderRadius: 20, padding: 20 }}>
    <summary style={{ cursor: "pointer", fontWeight: 600 }}>{text.title}</summary>
    <p>{text.active}</p>
    <div>{text.wallet}</div>
    <p style={{ overflowWrap: "anywhere", fontFamily: "monospace" }}>{selected}</p>
    <p style={{ fontSize: 13, color: "#7A7A85", lineHeight: 1.5 }}>{text.notice}</p>
    <button type="button" onClick={open} disabled={busy} aria-busy={busy}
      style={{ padding: "12px 16px", borderRadius: 12, border: 0, background: "#FF5A00", color: "white", font: "inherit", cursor: busy ? "wait" : "pointer" }}>
      {busy ? text.opening : text.button}
    </button>
    {error && <p role="alert" style={{ color: "#E4483D" }}>{text.error}</p>}
  </details>;
}
