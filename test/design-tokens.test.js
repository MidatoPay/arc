import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { C, RADIUS, TONES, cta } from '../src/designTokens.js';

// The values each screen declared in its own `const C` before the tokens existed.
const BEFORE = { bg: '#F7F7F9', card: '#FFFFFF', ink: '#16161A', mut: '#7A7A85', line: '#ECECF0', orange: '#FF5A00', accent: '#fe6c1c',
  orangeSoft: '#FFEADF', orangeTint: '#FFF4ED', violet: '#5C4CC7', violetSoft: '#ECEAFA', green: '#21B95B', red: '#E4483D',
  redSoft: '#FDECEA', amber: '#B45309' };

test('provisional tokens keep the exact previous colors and are frozen', () => {
  assert.deepEqual({ ...C }, BEFORE);
  for (const value of [C, RADIUS, TONES, cta, ...Object.values(TONES)]) assert.ok(Object.isFrozen(value));
  for (const tone of Object.values(TONES)) for (const color of Object.values(tone)) assert.ok(Object.values(C).includes(color), color);
  assert.equal(cta.borderRadius, 18);
});

test('screens import the shared tokens instead of redeclaring color objects', () => {
  for (const file of readdirSync('src').filter(name => name.endsWith('.jsx'))) {
    const text = readFileSync(`src/${file}`, 'utf8');
    const local = /^const C = \{([^\n]*)\}/m.exec(text);
    if (!local) continue;
    // The only allowed local object spreads the tokens and overrides documented values.
    assert.match(local[1], /^\s*\.\.\.TOKENS,/, file);
    assert.match(text, /from ['"]\.\/designTokens\.js['"]/, file);
  }
  const business = readFileSync('src/BusinessProfile.jsx', 'utf8');
  assert.match(business, /green: '#15803D'/);
  for (const file of ['App.jsx', 'ContactsScreen.jsx', 'Movimientos.jsx', 'PayScan.jsx', 'ProfileScreen.jsx', 'SendScreen.jsx', 'TransferApproval.jsx', 'TransferReceipt.jsx'])
    assert.match(readFileSync(`src/${file}`, 'utf8'), /import \{ C \} from "\.\/designTokens\.js";/, file);
});
