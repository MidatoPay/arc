# Voice "cobrar" intent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recognize the voice command "cobrar 500 pesos" / "charge 500 pesos" as a new `"charge"` intent that jumps straight to the Cobrar screen with the ARS amount prefilled and the QR generated automatically — no confirmation screen, since generating a QR moves no funds.

**Architecture:** Extend the existing voice pipeline (`localParse` → `claudeParse` → `Voice.analyze`) with a second intent alongside `"send"`. On a `"charge"` result, `Voice` calls a new `onCharge(arsAmount)` prop instead of going through `confirm`/`sendPayment`. `AppInner` stores the amount in a new `pendingCharge` state and routes to the `charge` tab — the same `pendingScan`/`scanRequest` "request object consumed by an effect" pattern `Pay` already uses for `?pay=` links. `Charge` gains a `chargeRequest` prop it consumes in a `useEffect` to prefill the form and immediately trigger QR generation.

**Tech Stack:** React (hooks only, no router), no test runner.

**Source spec:** `docs/superpowers/specs/2026-08-08-voice-charge-intent-design.md`

## Global Constraints

- This repo has **no lint script, no test runner, and no test files** (see `CLAUDE.md`). Every task below is verified manually by running `npm run dev` and exercising the feature in the browser — there is no `npm test` to fall back on. Do not add a test framework as part of this plan.
- New state (`pendingCharge`) and its consuming `useEffect` in `Charge` must mirror the existing `pendingScan`/`scanRequest` pattern used by `AppInner`/`Pay` (`src/App.jsx:3019`, `:3437-3438`, `:1087-1092`) — same shape (`onXConsumed` callback clears the state in the parent), not a new pattern.
- `fxRate` is ARS per 1 USDC. Existing convention (from the `send` flow): ARS→USDC is `amount / fxRate`; USDC→ARS is `amount * fxRate`. Reuse it as-is, don't introduce a different conversion helper.
- No new strings in the `charge.*` i18n namespace — the Cobrar screen is visually unchanged, it just arrives prefilled. Only `voice.noPaymentUnderstood` changes.
- Keep using `t("voice.<key>")` for all user-facing text in `Voice`/`Charge` — no hardcoded strings.
- `recipient` must always be `null` for `"charge"` results — never attempt to extract one.
- Don't touch the `"send"` flow's existing behavior (confirm screen, gas estimate, `sendPayment`) — `"charge"` bypasses all of that by design.

---

### Task 1: Voice recognizes "charge" and routes to the Cobrar screen

**Files:**
- Modify: `src/App.jsx:104-116` (`localParse`)
- Modify: `src/App.jsx:118-160` (`claudeParse`)
- Modify: `src/App.jsx:1838-1901` (`Voice` — props + `analyze`)
- Modify: `src/App.jsx:3019` (`AppInner` — new `pendingCharge` state)
- Modify: `src/App.jsx:3317-3360` (`AppInner` — `handleVoiceCharge` + wire `onCharge` into `<Voice>`)

**Interfaces:**
- Produces: `localParse(text, lang)` / `claudeParse(text, lang, aliases)` can now return `{ intent: "charge", amount, currency, recipient: null }`.
- Produces: `Voice` accepts a new prop `onCharge(arsAmount: number)`, called instead of `setPhase("confirm")` when the parsed intent is `"charge"`.
- Produces: `AppInner` has `handleVoiceCharge(ars: number)` and state `pendingCharge` (`{ ars: number } | null`), consumed by Task 2.
- Consumes: nothing new — reuses `fxRate`, `closeVoice`, `setTab` already in scope.

- [ ] **Step 1: Update `localParse` to recognize `"charge"` before `"send"`**

Replace `src/App.jsx:104-116`:

```js
function localParse(text, lang) {
  const t = text.toLowerCase();
  const chargeRe = lang === "en" ? /(charge|collect)/ : /(cobr)/;
  const sendRe = lang === "en" ? /(send|transfer|pay)/ : /(envi|mand|transfer|pag)/;
  const intent = chargeRe.test(t) ? "charge" : sendRe.test(t) ? "send" : "unknown";
  if (intent === "unknown") return { intent };

  const numMatch = t.replace(/\./g, "").match(/(\d+(?:[.,]\d+)?)/);
  const amount = numMatch ? parseFloat(numMatch[1].replace(",", ".")) : null;
  const defaultCurrency = intent === "charge" ? "ARS" : "USDC";
  const currency = /peso|ars/.test(t) ? "ARS" : defaultCurrency;

  if (intent === "charge") return { intent, amount, currency, recipient: null };

  let recipient = null;
  const recRe = lang === "en" ? /\bto\s+([a-záéíóúñ]+)/ : /\ba\s+([a-záéíóúñ]+)/;
  const m = t.match(recRe);
  if (m) recipient = m[1];
  return { intent, amount, currency, recipient };
}
```

`chargeRe` is checked first so "cobrar" can never fall through to the send branch. Currency detection is unchanged (`/peso|ars/`), only the fallback default now depends on intent: `"USDC"` for `send` (unchanged), `"ARS"` for `charge`.

- [ ] **Step 2: Trace three sample inputs by hand to sanity-check the regex/logic before running the app**

No test runner exists, so do this as a read-through instead of an automated test:
- `localParse("cobrar 500 pesos", "es")` → `chargeRe` matches "cobr" → `{ intent: "charge", amount: 500, currency: "ARS", recipient: null }`
- `localParse("charge 500 pesos", "en")` → `chargeRe` matches "charge" → same shape
- `localParse("cobrar 20", "es")` → no "peso"/"ars" in text → `currency` falls back to `defaultCurrency` = `"ARS"` (charge's default) → `{ intent: "charge", amount: 20, currency: "ARS", recipient: null }`
- `localParse("enviar 1 dolar a katy", "es")` → `chargeRe` doesn't match, `sendRe` matches → unchanged behavior: `{ intent: "send", amount: 1, currency: "USDC", recipient: "katy" }`

If any of these don't match, fix the regex before continuing.

- [ ] **Step 3: Update `claudeParse` prompts (both languages) to accept `"charge"`**

In `src/App.jsx:118-160`, replace the EN prompt's format/rules block (inside the `lang === "en"` branch):

```js
Exact format:
{"intent":"send"|"charge"|"unknown","amount":<number or null>,"currency":"USDC"|"ARS","recipient":"<closest matching contact alias or null>","confidence":<0 to 1>}

Rules: "charge"/"collect" means the user wants to request/collect a payment, not send one — recipient is always null for "charge". "dollars", "usd" or "usdc" → USDC. "pesos" or "ars" → ARS. If the currency isn't stated or is unclear, default to USDC for "send" — never guess ARS — and to ARS for "charge". Match the alias even if misheard (e.g. "caty" → "katy").
```

Replace the ES prompt's format/rules block:

```js
Formato exacto:
{"intent":"send"|"charge"|"unknown","amount":<número o null>,"currency":"USDC"|"ARS","recipient":"<alias del contacto más parecido o null>","confidence":<0 a 1>}

Reglas: "cobrar"/"charge"/"collect" significa que el usuario quiere solicitar un pago, no enviarlo — recipient siempre es null para "charge". "dólares", "usd" o "usdc" → USDC. "pesos" o "ars" → ARS. Si la moneda no está clara o no se menciona, default a USDC para "send" — nunca asumas ARS — y a ARS para "charge". Matcheá el alias aunque esté mal transcripto (ej: "caty" → "katy").
```

No other code in `claudeParse` changes — it just forwards whatever JSON Claude returns.

- [ ] **Step 4: Add the `onCharge` prop and the charge branch in `Voice.analyze`**

In `src/App.jsx:1838-1850`, add `onCharge` to the destructured props:

```js
function Voice({
  sendPayment,
  balance,
  onDone,
  onCharge,
  fxRate,
  address,
  contacts,
  voiceKick = 0,
  onListeningChange,
  voiceApiRef,
  overlay = false,
  onClose,
}) {
```

Replace the `analyze` callback at `src/App.jsx:1860-1901`:

```js
  const analyze = useCallback(
    async (text) => {
      setTranscript(text);
      setPhase("parsing");
      let result;
      try {
        result = await claudeParse(text, lang, contacts.map((c) => c.alias));
      } catch {
        result = localParse(text, lang);
      }

      if (result?.intent === "charge") {
        if (!result.amount) {
          setErrMsg(t("voice.noPaymentUnderstood"));
          setPhase("error");
          return;
        }
        const ars = result.currency === "USDC" ? result.amount * fxRate : result.amount;
        onCharge(ars);
        return;
      }

      if (contacts.length === 0) {
        setErrMsg(t("voice.noContactsYet"));
        setPhase("error");
        return;
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
    [balance, fxRate, lang, locale, t, contacts, onCharge]
  );
```

The `contacts.length === 0` guard moves from the top of the function to after the charge branch, so "cobrar" works even with zero saved contacts (`charge` never needs a contact).

- [ ] **Step 5: Add `pendingCharge` state to `AppInner`**

In `src/App.jsx:3019`, right after `const [pendingScan, setPendingScan] = useState(null);`, add:

```js
  const [pendingCharge, setPendingCharge] = useState(null);
```

- [ ] **Step 6: Add `handleVoiceCharge` and wire `onCharge` into `<Voice>`**

In `src/App.jsx`, right after `closeVoice` (around line 3321, before `openVoiceListen`), add:

```js
  const handleVoiceCharge = (ars) => {
    closeVoice();
    setPendingCharge({ ars });
    setTab("charge");
  };
```

In the `<Voice>` render block (`src/App.jsx:3343-3358`), add the `onCharge` prop:

```jsx
            <Voice
              sendPayment={sendPayment}
              balance={balance}
              onDone={(r) => {
                closeVoice();
                setReceipt(r);
              }}
              onCharge={handleVoiceCharge}
              fxRate={fxRate}
              address={address}
              contacts={contacts}
              voiceKick={voiceKick}
              onListeningChange={setVoiceListening}
              voiceApiRef={voiceApiRef}
              overlay
              onClose={closeVoice}
            />
```

- [ ] **Step 7: Manually verify in the browser**

Run `npm run dev` (contacts/history persistence isn't touched by this task, so `netlify functions:serve` isn't required for this check). Log in, then:
- Tap the mic FAB, say or type (via "O escribilo"/"Or type it") **"cobrar 500 pesos"** → the voice overlay should close and the app should land on the **Cobrar** tab (form still empty at this point — that's expected, Task 2 makes it prefill).
- Try **"charge 500 pesos"** with the language toggled to English → same result.
- Regression check: **"enviar 1 dolar a katy"** (needs an existing contact aliased `katy`, or substitute a real contact alias) still reaches the confirm screen as before.
- If `VITE_ANTHROPIC_API_KEY` is set, open DevTools → Network → the POST to `api.anthropic.com/v1/messages` → confirm the response body's `intent` is `"charge"` for the charge commands above.

- [ ] **Step 8: Commit**

```bash
git add src/App.jsx
git commit -m "Recognize voice charge intent and route to the Cobrar screen"
```

---

### Task 2: Cobrar screen consumes the voice-originated amount and auto-generates the QR

**Files:**
- Modify: `src/App.jsx:823` (`Charge` — props)
- Modify: `src/App.jsx:836-847` (`Charge` — `startWaiting` → `startWaitingFor`)
- Modify: `src/App.jsx:997-1008` (`Charge` — submit button)
- Modify: `src/App.jsx:3441-3447` (`AppInner` — wire `chargeRequest`/`onChargeRequestConsumed` into `<Charge>`)

**Interfaces:**
- Consumes: `pendingCharge` / `handleVoiceCharge` from Task 1 (`AppInner`).
- Produces: `Charge` accepts `chargeRequest: { ars: number } | null` and `onChargeRequestConsumed: () => void` — same contract as `Pay`'s `scanRequest`/`onScanRequestConsumed` (`src/App.jsx:1075`, `:1087-1092`).
- Produces: `startWaitingFor(arsValue: number)` replaces the old closure-only `startWaiting()`.

- [ ] **Step 1: Accept the new props and add the consuming effect in `Charge`**

In `src/App.jsx:823`, change the signature:

```js
function Charge({ address, fxRate, onDetected, chargeRequest, onChargeRequestConsumed }) {
```

Replace `startWaiting` at `src/App.jsx:836-847` with `startWaitingFor` plus the new effect:

```js
  const startWaitingFor = async (arsValue) => {
    const factura = nuevaFactura();
    const url = buildPayUrl({ addr: address, who: t("charge.merchantSelf"), ars: arsValue, factura });
    setRequest({ ars: arsValue, factura, url });
    setPhase("waiting");
    try {
      setQrDataUrl(await QRCode.toDataURL(url, { margin: 1, width: 260 }));
    } catch {
      setQrDataUrl("");
    }
    baselineRef.current = await getUsdcBalance(address).catch(() => null);
  };

  useEffect(() => {
    if (!chargeRequest) return;
    setArsInput(String(chargeRequest.ars));
    startWaitingFor(chargeRequest.ars);
    onChargeRequestConsumed();
  }, [chargeRequest, onChargeRequestConsumed]); // eslint-disable-line react-hooks/exhaustive-deps
```

This mirrors `Pay`'s `scanRequest` effect (`src/App.jsx:1087-1092`) exactly: consume the request object, act on it, then immediately tell the parent to clear it.

- [ ] **Step 2: Update the manual submit button to call `startWaitingFor`**

In `src/App.jsx:997-1008`, change the button's `onClick`:

```jsx
      <button
        onClick={() => startWaitingFor(ars)}
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
```

(`ars` here is still the existing `Number(arsInput)` derived value already in scope — unchanged.)

- [ ] **Step 3: Wire `pendingCharge` into `<Charge>` in `AppInner`**

In `src/App.jsx:3441-3447`:

```jsx
      {tab === "charge" && (
        <Charge
          address={address}
          fxRate={fxRate}
          onDetected={handleChargeDetected}
          chargeRequest={pendingCharge}
          onChargeRequestConsumed={() => setPendingCharge(null)}
        />
      )}
```

- [ ] **Step 4: Manually verify in the browser**

Run `npm run dev` (and `npx netlify functions:serve` in a second terminal if you want the resulting transaction to persist once collected — not required just to see the QR appear). Log in, then:
- Say/type **"cobrar 500 pesos"** → should land directly on the Cobrar screen already showing **$500,00** and a generated QR (the "waiting for payment" state), with no button press needed.
- Say/type **"charge 300 pesos"** (English) a second time from Home → confirms it works repeatedly, not just once.
- Regression check: go to Cobrar manually (Home → Cobrar), type an amount, press the submit button → still reaches the same waiting/QR state as before.
- Cancel from the waiting screen, then trigger a voice charge again → confirms the flow isn't left in a stuck state from the prior QR session.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx
git commit -m "Prefill Cobrar and auto-generate the QR when charge comes from voice"
```

---

### Task 3: Update the voice error hint to mention "cobrar"

**Files:**
- Modify: `src/i18n.jsx:175` (EN `voice.noPaymentUnderstood`)
- Modify: `src/i18n.jsx:443` (ES `voice.noPaymentUnderstood`)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed elsewhere — pure copy change, both intents (`send`/`charge`) already surface this same key from Task 1's `analyze`.

- [ ] **Step 1: Update the EN string**

In `src/i18n.jsx:175`:

```js
      noPaymentUnderstood: "I didn't understand a payment in that command. Try: “send 1 dollar to katy” or “charge 500 pesos”.",
```

- [ ] **Step 2: Update the ES string**

In `src/i18n.jsx:443`:

```js
      noPaymentUnderstood: "No entendí un pago en ese comando. Probá: «enviar 1 dólar a katy» o «cobrar 500 pesos».",
```

- [ ] **Step 3: Manually verify in the browser**

Run `npm run dev`. Trigger an unparseable voice command (e.g. type "asdf" into the manual text field and submit) in both languages, and confirm the error card shows both examples ("send… or charge…" / "enviar… o cobrar…").

- [ ] **Step 4: Commit**

```bash
git add src/i18n.jsx
git commit -m "Mention the charge voice command in the no-payment-understood hint"
```

---

## Self-Review

**Spec coverage:**
- §1 Parsing (`localParse`/`claudeParse`, intent order, currency defaults, `recipient: null`) → Task 1, Steps 1-3.
- §2 `Voice.analyze` (contacts check reordered, amount>0 validation, USDC→ARS conversion, `onCharge`, no confirm/gas/send) → Task 1, Step 4.
- §3 `App.jsx` ↔ `Charge` (`handleVoiceCharge`, `pendingCharge`, `onCharge` prop, `chargeRequest`/`onChargeRequestConsumed`, `startWaitingFor`) → Task 1 Steps 5-6, Task 2 Steps 1-3.
- §4 i18n (`voice.noPaymentUnderstood` only, no new `charge.*` strings) → Task 3.
- "Resumen de cambios por archivo" list → every file/symbol listed there is covered above.

**Placeholder scan:** No TBD/TODO, every step has real code, every test/verification step is concrete (manual browser steps, since no test runner exists per `CLAUDE.md`).

**Type consistency:** `onCharge(arsAmount)` (Task 1) matches `handleVoiceCharge(ars)` (Task 1) matches `pendingCharge: { ars }` (Task 1) matches `chargeRequest.ars` (Task 2) matches `startWaitingFor(arsValue)`'s single numeric argument (Task 2) — one consistent shape end to end.
