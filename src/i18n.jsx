import { createContext, useContext, useMemo, useState } from "react";

const STORAGE_KEY = "mp_lang";

export function localeFor(lang) {
  return lang === "en" ? "en-US" : "es-AR";
}

export const STACK_EN = [
  { on: true, name: "Arc L1 (testnet)", role: "This demo's settlement chain. Chain ID 5042002, sub-second finality.", by: "Circle" },
  { on: true, name: "Native USDC", role: "Gas and payment asset in one: every transfer in this app is native USDC on-chain.", by: "Circle" },
  { on: true, name: "On-chain reference", role: "Every charge carries its invoice number attached. Reconciliation without an external database.", by: "Arc" },
  { on: true, name: "Privy", role: "This app's login: email or phone → embedded wallet. No recovery phrases.", by: "Arc ecosystem" },
  { on: true, name: "ArcScan", role: "Every payment is verifiable at testnet.arcscan.app, with its reference included.", by: "Arc ecosystem" },
  { on: true, name: "Circle faucet", role: "Test USDC funding from faucet.circle.com.", by: "Circle" },
  { on: false, name: "Memo contract", role: "Migrate the reference to indexed Memo events for analytics and bulk reconciliation.", by: "Arc" },
  { on: false, name: "Gateway / CCTP v2", role: "Cross-chain USDC: on-ramp from Solana or Base, settlement on Arc.", by: "Circle" },
  { on: false, name: "FX oracle", role: "Today the ARS/USD exchange rate is an off-chain reference. Evaluating Stork and RedStone.", by: "Arc ecosystem" },
  { on: false, name: "StableFX / EURC", role: "Multi-currency corridor with Arc's FX engine for euro-denominated charges.", by: "Circle" },
  { on: false, name: "Aave", role: "Yield on the USDC treasury float.", by: "Arc ecosystem" },
  { on: false, name: "Avenia", role: "LATAM ramps (PIX and local rails) for expansion into Brazil.", by: "Arc ecosystem" },
];

export const STACK_ES = [
  { on: true, name: "Arc L1 (testnet)", role: "Cadena de liquidación de esta demo. Chain ID 5042002, finalidad sub-segundo.", by: "Circle" },
  { on: true, name: "USDC nativo", role: "Gas y activo de pago en uno: cada envío de esta app es USDC nativo on-chain.", by: "Circle" },
  { on: true, name: "Referencia on-chain", role: "Cada cobro lleva su número de factura adjunto. Conciliación sin base de datos externa.", by: "Arc" },
  { on: true, name: "Privy", role: "El login de esta app: email o teléfono → wallet embebida. Sin frases de recuperación.", by: "Ecosistema Arc" },
  { on: true, name: "ArcScan", role: "Cada pago es verificable en testnet.arcscan.app, con su referencia incluida.", by: "Ecosistema Arc" },
  { on: true, name: "Faucet Circle", role: "Fondeo de USDC testnet desde faucet.circle.com.", by: "Circle" },
  { on: false, name: "Memo contract", role: "Migrar la referencia a eventos Memo indexados para analítica y conciliación masiva.", by: "Arc" },
  { on: false, name: "Gateway / CCTP v2", role: "USDC crosschain: entrada desde Solana o Base, liquidación en Arc.", by: "Circle" },
  { on: false, name: "Oráculo FX", role: "Hoy el tipo de cambio ARS/USD es de referencia off-chain. Evaluando Stork y RedStone.", by: "Ecosistema Arc" },
  { on: false, name: "StableFX / EURC", role: "Corredor multi-moneda con el motor FX de Arc para cobros en euros.", by: "Ecosistema Arc" },
  { on: false, name: "Aave", role: "Rendimiento sobre el float de tesorería en USDC.", by: "Ecosistema Arc" },
  { on: false, name: "Avenia", role: "Rampas LATAM (PIX y rieles locales) para expansión a Brasil.", by: "Ecosistema Arc" },
];

const translations = {
  en: {
    login: {
      title1: "Get paid in dollars",
      title2: "without knowing crypto",
      subtitle: "Sign in with your email or phone. Your account creates itself.",
      loginBtn: "Sign in",
      loadingBtn: "Loading…",
      createAccountBtn: "Create account",
      footer: "Arc Testnet · test funds with no value",
    },
    home: {
      greeting: (nombre) => `Hi, ${nombre}`,
      available: "Available",
      actionReceive: "Receive",
      actionConvert: "Convert",
      actionPay: "Pay",
      fundsTitle: "Funds",
      viewAll: "View all",
      infoDigitalAssets: "Your money is held in digital assets.",
      copy: "copy",
      copied: "copied ✓",
      faucetCardTitle: "Load test funds to get started",
      faucetCardBody: "Copy your address and request USDC from the Circle faucet, selecting Arc Testnet.",
      faucetCardBtn: "Go to faucet",
      activityTitle: "Activity",
      activityEmpty: "No activity yet. Try a voice payment — every transfer gets recorded on Arc Testnet with its invoice.",
      invoiceLink: (factura) => `Invoice ${factura} · view ↗`,
      creatingTitle: "Creating your account…",
      creatingBody: "This takes a few seconds the first time.",
    },
    voice: {
      title: "Pay by voice",
      subtitle: "Say it and the agent builds the transaction.",
      idleHint: "Tap the mic and say the payment",
      listening: "Listening…",
      listeningHint: "When you're done, wait a second",
      parsing: (transcript) => `Interpreting "${transcript}"…`,
      orType: "Or type it",
      inputPlaceholder: "send 1 dollar to katy",
      exampleCommand: "send 1 dollar to katy",
      tryExample: "▶ Try “send 1 dollar to katy”",
      noApiKeyHint: "No API key: using local parser.",
      micUnsupported: "Your browser doesn't support voice recognition. Use Chrome or text mode.",
      noSpeechMatch: "Couldn't understand the audio. Speak closer to the microphone.",
      micErrors: {
        "not-allowed": "Microphone permission denied. In Safari: Settings → Websites → Microphone → localhost: Allow. And enable Dictation in System Settings → Keyboard.",
        "service-not-allowed": "Safari needs Dictation enabled: System Settings → Keyboard → Dictation.",
        "audio-capture": "No microphone detected.",
        "no-speech": "I didn't hear anything. Tap the button and speak right away.",
        network: "Check your internet connection.",
      },
      micErrGeneric: (e) => `Microphone error: ${e}`,
      micUnavailable: "Voice recognition isn't available. Use text mode.",
      noPaymentUnderstood: "I didn't understand a payment in that command. Try: “send 1 dollar to katy”.",
      aliasNotFound: (alias) => `I couldn't find the alias “${alias}” in your contacts.`,
      insufficientBalance: (usdc, balance) => `Insufficient balance: you're trying to send ${usdc} USDC and you have ${balance}.`,
      amount: "Amount",
      equals: "Equals",
      exchangeRate: "Exchange rate",
      invoice: "Invoice",
      network: "Network",
      memoNote: "The invoice travels attached to the payment and is visible on ArcScan. The merchant reconciles without an external database.",
      confirmSend: "Confirm and send",
      cancel: "Cancel",
      sending: "Sending…",
      sendingHint: "Signing and waiting for finality on Arc",
      retry: "Retry",
      rpcLimited: "Arc's RPC is rate-limiting requests. Wait a few seconds and try again.",
      insufficientFundsOnchain: "Insufficient funds on-chain. Fund your wallet at faucet.circle.com → Arc Testnet.",
      signatureCancelled: "You canceled the signature.",
      txFailed: (m) => `The transaction failed: ${m}`,
    },
    success: {
      splashTitle: "Payment sent!",
      doneTitle: "Done!",
      sentSummary: (usdc, name) => `You sent ${usdc} USDC to ${name}`,
      viewDetail: "View detail",
      operation: "Transaction:",
      amountSent: "Amount sent",
      equals: "Equals",
      exchangeRate: "Exchange rate",
      networkFee: "Network fee",
      block: "Block",
      time: "Time",
      invoiceLabel: "Invoice:",
      onchainCheck: "on-chain ✓",
      viewOnArcScan: (short) => `${short} — view on ArcScan ↗`,
      utf8Hint: "On ArcScan, open Input Data and switch it to UTF-8: that's where the full payment reference is.",
      anotherPayment: "Make another payment",
      backHome: "Back to home",
    },
    movs: {
      title: "Activity",
      countEmpty: "No payments yet in this session.",
      countN: (n) => `${n} payment${n === 1 ? "" : "s"} this session`,
      emptyBody: "Every voice payment gets recorded on Arc Testnet with its invoice number. You'll see them here with a link to the explorer.",
      voicePayment: "Voice payment",
      invoiceLabel: "Invoice:",
      equals: "Equals:",
      viewOnArcScan: (short) => `${short} — view on ArcScan ↗`,
      viewFullHistory: "View full history on ArcScan",
    },
    mas: {
      title: "More",
      noEmailAccount: "Account with no email",
      stackTitle: "Arc Stack",
      stackSub: "What's built and what's missing",
      faucetTitle: "Top up with the faucet",
      faucetSub: "Test USDC on Arc Testnet",
      arcscanTitle: "View my account on ArcScan",
      arcscanSub: "Arc's public explorer",
      languageTitle: "Language",
      logoutTitle: "Log out",
      footerLine1: "MidatoPay × Arc · demo on Arc Testnet",
      footerLine2: "Test funds with no real value",
      logoutConfirmTitle: "Log out?",
      logoutConfirmBody: "You'll go back to the home screen. You can sign in again with the same email or phone and your account stays the same.",
      logoutConfirmBtn: "Log out",
      cancel: "Cancel",
    },
    stackScreen: {
      title: "Arc Stack",
      subtitle: "Green is implemented and working in this demo. Gray isn't yet — we list it to be explicit about what's missing.",
      implemented: "IMPLEMENTED",
      roadmap: "ROADMAP",
    },
    nav: {
      home: "Home",
      movements: "Activity",
      stack: "Stack",
      more: "More",
      voiceAria: "Pay by voice",
    },
  },
  es: {
    login: {
      title1: "Cobrá en dólares",
      title2: "sin saber de cripto",
      subtitle: "Entrá con tu email o tu teléfono. Tu cuenta se crea sola.",
      loginBtn: "Iniciar sesión",
      loadingBtn: "Cargando…",
      createAccountBtn: "Crear cuenta",
      footer: "Arc Testnet · fondos de prueba sin valor",
    },
    home: {
      greeting: (nombre) => `Hola, ${nombre}`,
      available: "Disponible",
      actionReceive: "Cobrar",
      actionConvert: "Convertir",
      actionPay: "Pagar",
      fundsTitle: "Fondos",
      viewAll: "Ver todo",
      infoDigitalAssets: "Tu dinero se encuentra en activos digitales.",
      copy: "copiar",
      copied: "copiada ✓",
      faucetCardTitle: "Cargá saldo de prueba para empezar",
      faucetCardBody: "Copiá tu dirección y pedí USDC en el faucet de Circle eligiendo Arc Testnet.",
      faucetCardBtn: "Ir al faucet",
      activityTitle: "Actividad",
      activityEmpty: "Todavía no hay movimientos. Probá un pago por voz — cada envío queda registrado en Arc Testnet con su factura.",
      invoiceLink: (factura) => `Factura ${factura} · ver ↗`,
      creatingTitle: "Creando tu cuenta…",
      creatingBody: "Esto tarda unos segundos la primera vez.",
    },
    voice: {
      title: "Pagar por voz",
      subtitle: "Decilo y el agente arma la transacción.",
      idleHint: "Tocá el micrófono y decí el pago",
      listening: "Escuchando…",
      listeningHint: "Al terminar, esperá un segundo",
      parsing: (transcript) => `Interpretando «${transcript}»…`,
      orType: "O escribilo",
      inputPlaceholder: "enviar 1 dólar a katy",
      exampleCommand: "enviar 1 dólar a katy",
      tryExample: "▶ Probar «enviar 1 dólar a katy»",
      noApiKeyHint: "Sin API key: usando intérprete local.",
      micUnsupported: "Tu navegador no soporta reconocimiento de voz. Usá Chrome o el modo texto.",
      noSpeechMatch: "No se entendió el audio. Hablá más cerca del micrófono.",
      micErrors: {
        "not-allowed": "Permiso de micrófono denegado. En Safari: Configuración → Sitios web → Micrófono → localhost: Permitir. Y activá Dictado en Configuración del Sistema → Teclado.",
        "service-not-allowed": "Safari necesita el Dictado activado: Configuración del Sistema → Teclado → Dictado.",
        "audio-capture": "No se detectó micrófono.",
        "no-speech": "No escuché nada. Tocá el botón y hablá enseguida.",
        network: "Verificá tu conexión a internet.",
      },
      micErrGeneric: (e) => `Error de micrófono: ${e}`,
      micUnavailable: "El reconocimiento de voz no está disponible. Usá el modo texto.",
      noPaymentUnderstood: "No entendí un pago en ese comando. Probá: «enviar 1 dólar a katy».",
      aliasNotFound: (alias) => `No encontré el alias «${alias}» en tus contactos.`,
      insufficientBalance: (usdc, balance) => `Saldo insuficiente: querés enviar ${usdc} USDC y tenés ${balance}.`,
      amount: "Monto",
      equals: "Equivale a",
      exchangeRate: "Tipo de cambio",
      invoice: "Factura",
      network: "Red",
      memoNote: "La factura viaja adjunta al pago y queda visible en ArcScan. El comercio concilia sin base de datos externa.",
      confirmSend: "Confirmar y enviar",
      cancel: "Cancelar",
      sending: "Enviando…",
      sendingHint: "Firmando y esperando finalidad en Arc",
      retry: "Reintentar",
      rpcLimited: "El RPC de Arc está limitando las consultas. Esperá unos segundos y reintentá.",
      insufficientFundsOnchain: "Fondos insuficientes on-chain. Fondeá en faucet.circle.com → Arc Testnet.",
      signatureCancelled: "Cancelaste la firma.",
      txFailed: (m) => `La transacción falló: ${m}`,
    },
    success: {
      splashTitle: "¡Pago enviado!",
      doneTitle: "¡Hecho!",
      sentSummary: (usdc, name) => `Enviaste ${usdc} USDC a ${name}`,
      viewDetail: "Ver detalle",
      operation: "Operación:",
      amountSent: "Monto enviado",
      equals: "Equivale a",
      exchangeRate: "Tipo de cambio",
      networkFee: "Fee de red",
      block: "Bloque",
      time: "Hora",
      invoiceLabel: "Factura:",
      onchainCheck: "on-chain ✓",
      viewOnArcScan: (short) => `${short} — ver en ArcScan ↗`,
      utf8Hint: "En ArcScan abrí Input Data y pasalo a UTF-8: ahí está la referencia completa del cobro.",
      anotherPayment: "Realizar otro pago",
      backHome: "Volver al inicio",
    },
    movs: {
      title: "Movimientos",
      countEmpty: "Todavía no hay pagos en esta sesión.",
      countN: (n) => `${n} ${n === 1 ? "pago" : "pagos"} en esta sesión`,
      emptyBody: "Cada pago por voz queda registrado en Arc Testnet con su número de factura. Vas a verlos acá con el link al explorador.",
      voicePayment: "Pago por voz",
      invoiceLabel: "Factura:",
      equals: "Equivale a:",
      viewOnArcScan: (short) => `${short} — ver en ArcScan ↗`,
      viewFullHistory: "Ver historial completo en ArcScan",
    },
    mas: {
      title: "Más",
      noEmailAccount: "Cuenta sin email",
      stackTitle: "Stack Arc",
      stackSub: "Qué está implementado y qué falta",
      faucetTitle: "Fondear con el faucet",
      faucetSub: "USDC de prueba en Arc Testnet",
      arcscanTitle: "Ver mi cuenta en ArcScan",
      arcscanSub: "Explorador público de Arc",
      languageTitle: "Idioma",
      logoutTitle: "Cerrar sesión",
      footerLine1: "MidatoPay × Arc · demo sobre Arc Testnet",
      footerLine2: "Fondos de prueba sin valor real",
      logoutConfirmTitle: "¿Cerrar sesión?",
      logoutConfirmBody: "Vas a volver a la pantalla de inicio. Podés entrar de nuevo con el mismo email o teléfono y tu cuenta sigue igual.",
      logoutConfirmBtn: "Cerrar sesión",
      cancel: "Cancelar",
    },
    stackScreen: {
      title: "Stack Arc",
      subtitle: "Lo verde está implementado y funcionando en esta demo. Lo gris todavía no: lo listamos para ser explícitos sobre qué falta.",
      implemented: "IMPLEMENTADO",
      roadmap: "ROADMAP",
    },
    nav: {
      home: "Inicio",
      movements: "Movimientos",
      stack: "Stack",
      more: "Más",
      voiceAria: "Pagar por voz",
    },
  },
};

function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o ? o[k] : undefined), obj);
}

function makeT(lang) {
  return (path, ...args) => {
    const val = getPath(translations[lang], path);
    if (typeof val === "function") return val(...args);
    if (val === undefined) return path;
    return val;
  };
}

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved === "en" || saved === "es" ? saved : "en";
    } catch {
      return "en";
    }
  });

  const setLang = (l) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {}
  };

  const value = useMemo(
    () => ({ lang, setLang, t: makeT(lang), locale: localeFor(lang) }),
    [lang]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within a LanguageProvider");
  return ctx;
}
