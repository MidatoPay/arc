import { useEffect, useRef, useState } from 'react';
import VoiceCommandSheet from './VoiceCommandSheet.jsx';

const SpeechRecognition =
  globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;

/**
 * El micrófono de la barra de abajo. Ahora es la única puerta de entrada a
 * pagar y cobrar, así que este componente se hace cargo del flujo completo:
 * escuchar → interpretar → confirmar.
 *
 * Importante: como es la única puerta, tiene salida de emergencia. Si el
 * navegador no soporta voz, si el usuario niega el permiso o si está en un
 * local con ruido, se puede escribir el comando. Un comercio no puede quedar
 * sin poder cobrar porque hay ruido.
 */
export default function VoiceFab({ contacts, onPay, onCharge }) {
  const [state, setState] = useState('idle'); // idle | listening | typing
  const [transcript, setTranscript] = useState(null);
  const [error, setError] = useState(null);
  const [typed, setTyped] = useState('');
  const recRef = useRef(null);

  useEffect(() => () => recRef.current?.abort?.(), []);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(t);
  }, [error]);

  const listen = () => {
    setError(null);

    if (!SpeechRecognition) {
      setState('typing');
      return;
    }

    const rec = new SpeechRecognition();
    rec.lang = 'es-AR';
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    rec.onstart = () => setState('listening');

    rec.onresult = (e) => {
      const text = e.results[0][0].transcript;
      setState('idle');
      setTranscript(text);
    };

    rec.onerror = (e) => {
      setState('idle');
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setError('Safari no tiene permiso para el micrófono. Habilitalo o escribí el comando.');
      } else if (e.error === 'no-speech') {
        setError('No te escuché. Probá de nuevo.');
      } else if (e.error === 'network') {
        setError('El reconocimiento de voz necesita conexión.');
      } else {
        setError('Falló el micrófono. Podés escribir el comando.');
      }
    };

    rec.onend = () => setState((s) => (s === 'listening' ? 'idle' : s));

    recRef.current = rec;
    try {
      rec.start();
    } catch {
      setState('typing');
    }
  };

  const stop = () => {
    recRef.current?.stop?.();
    setState('idle');
  };

  const submitTyped = () => {
    if (!typed.trim()) return;
    setTranscript(typed.trim());
    setTyped('');
    setState('idle');
  };

  return (
    <>
      <button
        className={`mp-fab ${state === 'listening' ? 'mp-fab--live' : ''}`}
        onClick={state === 'listening' ? stop : listen}
        onContextMenu={(e) => { e.preventDefault(); setState('typing'); }}
        aria-label={state === 'listening' ? 'Dejar de escuchar' : 'Pagar o cobrar por voz'}
      >
        <span aria-hidden="true">🎙</span>
        {state === 'listening' && <span className="mp-fab__ring" aria-hidden="true" />}
      </button>

      {state === 'listening' && (
        <div className="mp-listening" role="status">
          <p>Escuchando…</p>
          <p className="mp-hint">“cobrar 20 USDC” o “pagale mil pesos a Juampi”</p>
        </div>
      )}

      {error && (
        <div className="mp-toast" role="alert">
          <span>{error}</span>
          <button className="mp-linkbtn" onClick={() => { setError(null); setState('typing'); }}>
            Escribir
          </button>
        </div>
      )}

      {state === 'typing' && (
        <div className="mp-sheet" role="dialog" aria-label="Escribir comando">
          <h3>Escribí el comando</h3>
          <input
            className="mp-input"
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitTyped()}
            placeholder="cobrar 20 USDC"
          />
          <p className="mp-hint">Entiende lo mismo que la voz: pagar, cobrar, montos y alias.</p>
          <div className="mp-sheet__actions">
            <button className="mp-btn mp-btn--ghost" onClick={() => { setState('idle'); setTyped(''); }}>
              Cancelar
            </button>
            <button className="mp-btn mp-btn--primary" onClick={submitTyped} disabled={!typed.trim()}>
              Continuar
            </button>
          </div>
        </div>
      )}

      {transcript && (
        <VoiceCommandSheet
          transcript={transcript}
          contacts={contacts}
          onPay={(p) => { setTranscript(null); onPay(p); }}
          onCharge={(c) => { setTranscript(null); onCharge(c); }}
          onCancel={() => setTranscript(null)}
        />
      )}
    </>
  );
}
