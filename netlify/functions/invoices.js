import { authenticatePayment, getPaymentDb, getPaymentPrivy, json, errorResponse } from './lib/paymentRuntime.js';
import { PaymentError } from './lib/paymentCore.js';
import { primaryArcWallet } from '../../src/primaryWallet.js';
import { factoringSettings } from './lib/factoringConfig.js';
import { assertFactoringEnabled, factoringEnabledFor, factoringRoles, isFactoringAdmin, requireRole } from './lib/factoringAccess.js';
import { createInvoice, sendInvoice, acceptInvoice, rejectInvoice, listInvoices, getInvoice, listDebtors, hydrateInvoices } from './lib/factoringService.js';
// Issuer and debtor API of the invoice cession pilot (plan 7.2).
const ROUTE = /^\/invoices(?:\/(access|debtors)|\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/(send|accept|reject|pay))?)?\/?$/i;

export function parseBody(event, { empty = false } = {}) {
  let body;
  try { body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString() : event.body || '{}'); }
  catch { throw new PaymentError('invalid_json', 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new PaymentError('invalid_body', 400);
  if (empty && Object.keys(body).length) throw new PaymentError('invalid_body', 400);
  return body;
}

export const idempotencyHeader = event => event.headers?.['idempotency-key'] || event.headers?.['Idempotency-Key'] || '';

export function createInvoicesHandler(adapters = {}) {
  return async event => {
    try {
      const userId = await (adapters.authenticate || authenticatePayment)(event);
      const path = (event.path || '').replace(/^\/\.netlify\/functions\/invoices/, '/invoices');
      const match = path.match(ROUTE);
      if (!match) return json(404, { error: 'not_found' });
      const [, named, id, action] = match;
      const method = event.httpMethod;
      const env = adapters.env || process.env;
      if (named === 'access') {
        if (method !== 'GET') return json(405, { error: 'method_not_allowed' });
        const admin = isFactoringAdmin(userId, env);
        // Never touch the database (or require the migration) for users outside the pilot.
        if (!factoringEnabledFor(userId, env))
          return json(200, { enabled: false, roles: { issuer: false, debtor: false, investor: false, admin }, paymentsMode: null, nftEnabled: false });
        const settings = adapters.settings || factoringSettings(env);
        const roles = await factoringRoles(adapters.db || getPaymentDb(), userId);
        return json(200, { enabled: true, roles: { issuer: Boolean(roles.issuer), debtor: Boolean(roles.debtor), investor: Boolean(roles.investor), admin },
          paymentsMode: settings.paymentsMode, nftEnabled: settings.nftEnabled });
      }
      const allowed = named === 'debtors' ? ['GET'] : id ? (action ? ['POST'] : ['GET']) : ['GET', 'POST'];
      if (!allowed.includes(method)) return json(405, { error: 'method_not_allowed' });
      assertFactoringEnabled(userId, env);
      const settings = adapters.settings || factoringSettings(env);
      const db = adapters.db || getPaymentDb();
      const now = adapters.now || Date.now;
      if (named === 'debtors') {
        await requireRole(db, userId, 'issuer');
        return json(200, { debtors: await listDebtors(db, userId) });
      }
      if (!id && method === 'GET') {
        const view = event.queryStringParameters?.view || 'issued';
        if (!['issued', 'owed'].includes(view)) throw new PaymentError('invalid_view', 400);
        await requireRole(db, userId, view === 'issued' ? 'issuer' : 'debtor');
        return json(200, { invoices: await listInvoices(db, userId, view, { settings }) });
      }
      if (!id) {
        const body = parseBody(event);
        const { invoice, existing } = await createInvoice(db, userId, body, idempotencyHeader(event), { now, settings });
        const [shown] = await hydrateInvoices(db, [invoice], 'issuer', settings);
        return json(existing ? 200 : 201, { invoice: shown });
      }
      if (!action) {
        const { invoice, timeline } = await getInvoice(db, userId, id, { settings });
        return json(200, { invoice, timeline });
      }
      if (action === 'pay') {
        if (!adapters.pay) return json(404, { error: 'not_found' });
        return await adapters.pay({ event, db, userId, invoiceId: id.toLowerCase(), settings, now, env });
      }
      parseBody(event, { empty: true });
      let invoice, view;
      if (action === 'send') {
        await requireRole(db, userId, 'issuer');
        const user = await (adapters.getUser || (uid => getPaymentPrivy().getUser(uid)))(userId);
        const issuerWallet = primaryArcWallet(user)?.address || null;
        invoice = await sendInvoice(db, userId, id.toLowerCase(), { now, settings, issuerWallet });
        view = 'issuer';
      } else {
        await requireRole(db, userId, 'debtor');
        invoice = await (action === 'accept' ? acceptInvoice : rejectInvoice)(db, userId, id.toLowerCase(), { now, settings });
        view = 'debtor';
      }
      const [shown] = await hydrateInvoices(db, [invoice], view, settings);
      return json(200, { invoice: shown });
    } catch (error) { return errorResponse(error); }
  };
}
export const handler = createInvoicesHandler();
