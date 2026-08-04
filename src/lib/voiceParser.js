/**
 * voiceParser.js — Interpreta comandos de voz en español rioplatense.
 *
 * Entrada:  "cobrale mil quinientos pesos a la panadería"
 * Salida:   { intent: 'charge', amount: 1500, token: 'ARST', counterparty: {...} }
 *
 * Sin dependencias. Testeado contra transcripciones reales de Web Speech API.
 */

/* ------------------------------------------------------------------ *
 * Normalización
 * ------------------------------------------------------------------ */

export function normalize(str = '') {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // saca acentos
    .toLowerCase()
    // Protegemos los separadores que están DENTRO de un número ("1.500,75")
    .replace(/(\d)\.(\d)/g, '$1\u0001$2')
    .replace(/(\d),(\d)/g, '$1\u0002$2')
    .replace(/[¿?¡!.,;:]/g, ' ')
    .replace(/\u0001/g, '.')
    .replace(/\u0002/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ------------------------------------------------------------------ *
 * Números en palabras
 * ------------------------------------------------------------------ */

const UNITS = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
  trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17,
  dieciocho: 18, diecinueve: 19, veinte: 20, veintiuno: 21, veintiun: 21,
  veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24,
  veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28,
  veintinueve: 29, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60,
  setenta: 70, ochenta: 80, noventa: 90, cien: 100, ciento: 100,
  doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300,
  cuatrocientos: 400, cuatrocientas: 400, quinientos: 500, quinientas: 500,
  seiscientos: 600, seiscientas: 600, setecientos: 700, setecientas: 700,
  ochocientos: 800, ochocientas: 800, novecientos: 900, novecientas: 900,
};

const SCALES = { mil: 1000, millon: 1e6, millones: 1e6, palo: 1e6, palos: 1e6 };

/** Convierte una secuencia de palabras-número a valor. null si no hay ninguna. */
function wordsToNumber(words) {
  let total = 0;
  let current = 0;
  let found = false;

  for (const w of words) {
    if (w === 'y') continue;
    if (UNITS[w] !== undefined) {
      current += UNITS[w];
      found = true;
    } else if (SCALES[w] !== undefined) {
      current = (current || 1) * SCALES[w];
      total += current;
      current = 0;
      found = true;
    } else {
      return null; // palabra que no es número → cortamos
    }
  }
  return found ? total + current : null;
}

/** "1.500,50" (AR) o "1,500.50" (US) o "1500.5" → 1500.5 */
function parseNumericToken(raw) {
  let s = raw.replace(/\s/g, '');
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');

  if (hasDot && hasComma) {
    // el separador decimal es el último que aparece
    const dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    const thou = dec === '.' ? ',' : '.';
    s = s.split(thou).join('').replace(dec, '.');
  } else if (hasComma) {
    // coma sola: decimal si deja 1-2 dígitos, si no es separador de miles
    const [, tail = ''] = s.split(',');
    s = tail.length <= 2 && !/,\d{3}$/.test(s) ? s.replace(',', '.') : s.split(',').join('');
  } else if (hasDot) {
    const [, tail = ''] = s.split('.');
    s = tail.length === 3 ? s.split('.').join('') : s;
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Extrae el monto del texto normalizado.
 * Devuelve { amount, consumed: [índices de palabras usadas] }
 */
function extractAmount(words) {
  // 1) dígitos explícitos
  for (let i = 0; i < words.length; i++) {
    if (/^\d[\d.,]*$/.test(words[i])) {
      let amount = parseNumericToken(words[i]);
      const consumed = [i];
      // "50 con 30" → 50.30
      if (words[i + 1] === 'con' && /^\d{1,2}$/.test(words[i + 2] || '')) {
        amount += parseInt(words[i + 2], 10) / 100;
        consumed.push(i + 1, i + 2);
      }
      // "2 lucas" / "3 palos"
      const mult = readMultiplier(words[i + 1]);
      if (mult) {
        amount *= mult.factor;
        consumed.push(i + 1);
        return { amount, consumed, impliedToken: mult.token };
      }
      return { amount, consumed, impliedToken: null };
    }
  }

  // 2) números en palabras — buscamos la corrida más larga que parsee
  for (let start = 0; start < words.length; start++) {
    if (UNITS[words[start]] === undefined && SCALES[words[start]] === undefined) continue;
    let end = start;
    while (
      end + 1 < words.length &&
      (UNITS[words[end + 1]] !== undefined ||
        SCALES[words[end + 1]] !== undefined ||
        words[end + 1] === 'y')
    ) {
      end++;
    }
    while (words[end] === 'y') end--; // no terminar en "y"
    const slice = words.slice(start, end + 1);
    const amount = wordsToNumber(slice);
    if (amount === null) continue;

    const consumed = [];
    for (let k = start; k <= end; k++) consumed.push(k);

    let value = amount;
    let impliedToken = null;
    const mult = readMultiplier(words[end + 1]);
    if (mult) {
      value *= mult.factor;
      consumed.push(end + 1);
      impliedToken = mult.token;
    } else if (words[end + 1] === 'con') {
      const centsWords = [];
      let j = end + 2;
      while (j < words.length && UNITS[words[j]] !== undefined) centsWords.push(words[j++]);
      const cents = wordsToNumber(centsWords);
      if (cents !== null && cents < 100) {
        value += cents / 100;
        for (let k = end + 1; k < j; k++) consumed.push(k);
      }
    }
    return { amount: value, consumed, impliedToken };
  }

  return { amount: null, consumed: [], impliedToken: null };
}

/** "luca" = mil pesos, "palo" = millón. Modismos porteños. */
function readMultiplier(word) {
  if (!word) return null;
  if (word === 'luca' || word === 'lucas') return { factor: 1000, token: 'ARST' };
  if (word === 'palo' || word === 'palos') return { factor: 1e6, token: 'ARST' };
  if (word === 'mil') return { factor: 1000, token: null };
  return null;
}

/* ------------------------------------------------------------------ *
 * Intención
 * ------------------------------------------------------------------ */

const PAY_VERBS = [
  'pagar', 'pagarle', 'pagarles', 'pagale', 'pagales', 'paga', 'pague',
  'enviar', 'enviarle', 'envia', 'enviale', 'mandar', 'mandarle', 'manda',
  'mandale', 'transferir', 'transferirle', 'transferi', 'transferile',
  'girar', 'girale', 'abonar', 'abonale', 'send', 'pay',
];

const CHARGE_VERBS = [
  'cobrar', 'cobrarle', 'cobrarles', 'cobrale', 'cobrales', 'cobra', 'cobro',
  'solicitar', 'solicitarle', 'solicita', 'solicitale', 'pedir', 'pedirle',
  'pedile', 'pedi', 'facturar', 'facturarle', 'facturale', 'factura',
  'requerir', 'charge', 'request',
];

const FILLER = new Set([
  'che', 'dale', 'por', 'favor', 'porfa', 'quiero', 'queria', 'necesito',
  'me', 'gustaria', 'hay', 'que', 'un', 'una', 'el', 'la', 'los', 'las',
  'de', 'del', 'ok', 'okay', 'bueno', 'a', 'ver', 'anda',
]);

function detectIntent(words) {
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (CHARGE_VERBS.includes(w)) return { intent: 'charge', verbIndex: i, verb: w };
    if (PAY_VERBS.includes(w)) return { intent: 'pay', verbIndex: i, verb: w };
  }
  // "generar cobro" / "generar un cobro"
  const joined = words.join(' ');
  if (/\b(generar|arma|armar|crea|crear)\b.*\bcobro\b/.test(joined)) {
    return { intent: 'charge', verbIndex: words.indexOf('cobro'), verb: 'cobro' };
  }
  if (/\bcobro\b/.test(joined)) {
    return { intent: 'charge', verbIndex: words.indexOf('cobro'), verb: 'cobro' };
  }
  return { intent: null, verbIndex: -1, verb: null };
}

/* ------------------------------------------------------------------ *
 * Token / moneda
 * ------------------------------------------------------------------ */

const TOKEN_WORDS = {
  USDC: ['usdc', 'usd', 'dolar', 'dolares', 'dolarcitos', 'verdes', 'stablecoin', 'stable'],
  ARST: ['peso', 'pesos', 'ars', 'arst', 'mango', 'mangos', 'lucas', 'luca', 'gamba', 'gambas'],
};

function detectToken(words) {
  for (const [token, list] of Object.entries(TOKEN_WORDS)) {
    for (let i = 0; i < words.length; i++) {
      if (list.includes(words[i])) return { token, index: i };
    }
  }
  // "u s d c" deletreado
  const joined = words.join('');
  if (joined.includes('usdc')) return { token: 'USDC', index: -1 };
  return { token: null, index: -1 };
}

/* ------------------------------------------------------------------ *
 * Contraparte
 * ------------------------------------------------------------------ */

const ADDRESS_RE = /0x[a-f0-9]{40}/i;

function extractCounterpartyQuery(words, usedIndexes) {
  const used = new Set(usedIndexes);
  // Buscamos la última preposición que introduce a la persona
  const markers = ['a', 'al', 'para', 'hacia'];
  let start = -1;
  for (let i = 0; i < words.length; i++) {
    if (used.has(i)) continue;
    if (markers.includes(words[i])) start = i + 1;
  }
  let tail;
  if (start > 0 && start < words.length) {
    tail = words.slice(start);
  } else {
    // sin preposición: lo que sobra después de sacar verbo, monto y moneda
    tail = words.filter((_, i) => !used.has(i));
  }
  const cleaned = tail.filter((w) => !used.has(words.indexOf(w)) && !FILLER.has(w));
  const query = cleaned.join(' ').trim();
  return query.length ? query : null;
}

/* ------------------------------------------------------------------ *
 * Matching contra la agenda
 * ------------------------------------------------------------------ */

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[n];
}

function similarity(a, b) {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max;
}

/**
 * Puntúa un contacto contra una consulta hablada.
 * Compara contra nombre y alias.
 */
export function scoreContact(contact, query) {
  const q = normalize(query);
  const targets = [contact.name, ...(contact.aliases || [])].map(normalize).filter(Boolean);
  let best = 0;

  for (const t of targets) {
    if (t === q) return 1;
    if (t.startsWith(q) || q.startsWith(t)) best = Math.max(best, 0.88);
    if (t.includes(q) || q.includes(t)) best = Math.max(best, 0.76);

    // solapamiento de palabras: "la panaderia" vs "panaderia del barrio"
    const tw = new Set(t.split(' '));
    const qw = q.split(' ').filter((w) => !FILLER.has(w));
    if (qw.length) {
      const hits = qw.filter((w) => tw.has(w)).length;
      if (hits) best = Math.max(best, 0.6 + 0.25 * (hits / qw.length));
    }

    // typos de transcripción: "juampi" vs "juanpi"
    const sim = similarity(t, q);
    if (sim > 0.72) best = Math.max(best, sim * 0.9);
  }
  return best;
}

export function matchContacts(query, contacts = [], { threshold = 0.55 } = {}) {
  if (!query) return { match: null, candidates: [] };

  const addr = query.match(ADDRESS_RE);
  if (addr) {
    return { match: { name: 'Dirección pegada', address: addr[0], adhoc: true }, candidates: [] };
  }

  const scored = contacts
    .map((c) => ({ contact: c, score: scoreContact(c, query) }))
    .filter((r) => r.score >= threshold)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return { match: null, candidates: [] };

  const top = scored[0];
  const contested = scored.filter((r) => top.score - r.score < 0.08);

  // Si hay empate o el mejor no es convincente, devolvemos candidatos para que elija
  if (contested.length > 1 || top.score < 0.75) {
    return { match: null, candidates: contested.slice(0, 4).map((r) => r.contact) };
  }
  return { match: top.contact, candidates: [] };
}

/* ------------------------------------------------------------------ *
 * API principal
 * ------------------------------------------------------------------ */

/**
 * @param {string} transcript  Texto crudo del reconocimiento de voz
 * @param {Array}  contacts    Agenda: [{ id, name, aliases: [], address }]
 * @param {object} opts        { defaultToken: 'USDC' }
 */
export function parseVoiceCommand(transcript, contacts = [], opts = {}) {
  const { defaultToken = 'USDC' } = opts;
  const raw = transcript || '';
  const text = normalize(raw);
  const words = text.split(' ').filter(Boolean);

  const { intent, verbIndex, verb } = detectIntent(words);
  const { amount, consumed, impliedToken } = extractAmount(words);
  const { token: spokenToken, index: tokenIndex } = detectToken(words);

  const used = [...consumed];
  if (verbIndex >= 0) used.push(verbIndex);
  if (tokenIndex >= 0) used.push(tokenIndex);

  const query = extractCounterpartyQuery(words, used);
  const { match, candidates } = matchContacts(query, contacts);

  const token = spokenToken || impliedToken || defaultToken;

  // El sufijo -le/-les implica que hay una contraparte aunque no la hayamos oído
  const expectsCounterparty = /le$|les$/.test(verb || '') || Boolean(query);

  const missing = [];
  if (!intent) missing.push('intent');
  if (amount === null || amount <= 0) missing.push('amount');
  if (intent === 'pay' && !match) missing.push('counterparty');

  return {
    intent,                                    // 'pay' | 'charge' | null
    amount,                                    // número o null
    token,                                     // 'USDC' | 'ARST'
    tokenAssumed: !spokenToken && !impliedToken,
    counterparty: match,                       // contacto o null
    counterpartyQuery: query,                  // lo que se escuchó
    candidates,                                // desambiguación
    expectsCounterparty,
    missing,                                   // qué falta para ejecutar
    complete: missing.length === 0,
    transcript: raw,
  };
}

export default parseVoiceCommand;
