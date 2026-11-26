import { PaymentError } from './paymentCore.js';
import { chainArgs } from './factoringHashes.js';
// Invoice state machine (plan section 5) as pure data. `aceptada` is transient:
// acceptance and publication happen in the same transaction, with one audit row each.
export const INVOICE_STATUSES = Object.freeze(['cargada', 'enviada', 'aceptada', 'rechazada', 'publicada', 'oferta_vencida', 'tomada',
  'pagos_en_curso', 'revision_manual', 'cedida', 'cobrada', 'en_mora']);
export const FINAL_STATUSES = Object.freeze(['rechazada', 'oferta_vencida', 'cobrada']);

const t = (actor, chain = []) => Object.freeze({ actor: Object.freeze(actor), chain: Object.freeze(chain) });
// Key: 'from->to' ('none' is the empty origin). Numbers refer to the rows of plan table 5.2.
export const TRANSITIONS = Object.freeze({
  'none->cargada': t(['issuer']), // 1
  'cargada->enviada': t(['issuer'], ['register']), // 2
  'enviada->aceptada': t(['debtor', 'worker'], ['accepted']), // 3 express (or tacit if late), 4 tacit
  'aceptada->publicada': t(['debtor', 'worker'], ['published']), // 3, 4
  'enviada->rechazada': t(['debtor'], ['rejected']), // 5
  'publicada->oferta_vencida': t(['worker'], ['offer_expired']), // 6
  'publicada->tomada': t(['investor'], ['taken']), // 7
  'tomada->pagos_en_curso': t(['worker']), // 8
  'pagos_en_curso->cedida': t(['worker'], ['cede']), // 9
  'pagos_en_curso->publicada': t(['worker'], ['published']), // 10 net failed
  'pagos_en_curso->revision_manual': t(['worker']), // 11
  'revision_manual->cedida': t(['admin', 'worker'], ['cede']), // 12 (worker: an admin retry completed)
  'revision_manual->publicada': t(['admin'], ['published']), // 13
  'cedida->cobrada': t(['worker'], ['collected']), // 14
  'cedida->en_mora': t(['worker'], ['defaulted']), // 15
  'en_mora->cobrada': t(['worker'], ['collected']), // 16 late payment (D-05)
});

// On-chain `detail` codes (plan 8.1).
export const CHAIN_DETAIL = Object.freeze({ express: 1, tacit: 2, netFailed: 1, adminResolved: 2, none: 0 });

export function assertTransition(from, to, actor) {
  const transition = TRANSITIONS[`${from ?? 'none'}->${to}`];
  if (!transition || !transition.actor.includes(actor)) throw new PaymentError('invalid_transition', 409);
  return transition;
}

/**
 * Chain events of a transition, in order. `context` maps each kind to its
 * arguments; any key outside CHAIN_ARG_KEYS (e.g. a CUIT or a name) is rejected.
 */
export function chainEventsFor(from, to, context = {}) {
  const transition = TRANSITIONS[`${from ?? 'none'}->${to}`];
  if (!transition) throw new PaymentError('invalid_transition', 409);
  return transition.chain.map(kind => ({ kind, args: chainArgs(kind, context[kind]) }));
}
