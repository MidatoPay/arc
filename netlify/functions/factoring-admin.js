import { authenticatePayment, getPaymentDb, json, errorResponse } from './lib/paymentRuntime.js';
import { PaymentError } from './lib/paymentCore.js';
import { factoringSettings } from './lib/factoringConfig.js';
import { isFactoringAdmin } from './lib/factoringAccess.js';
import { listReviews, listInvoicesForReconciliation, resolveReview } from './lib/factoringAdmin.js';
import { parseBody } from './lib/factoringHttp.js';
// Manual review API (plan 7.4), API only (D-19). Only FACTORING_ADMIN_USER_IDS.
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ROUTE = new RegExp(`^/factoring-admin/(?:(reviews)(?:/(${UUID})/(resolve))?|(invoices))/?$`, 'i');

export function createFactoringAdminHandler(adapters = {}) {
  return async event => {
    try {
      const userId = await (adapters.authenticate || authenticatePayment)(event);
      const env = adapters.env || process.env;
      if (!isFactoringAdmin(userId, env)) throw new PaymentError('factoring_admin_required', 403);
      const path = (event.path || '').replace(/^\/\.netlify\/functions\/factoring-admin/, '/factoring-admin');
      const match = path.match(ROUTE);
      if (!match) return json(404, { error: 'not_found' });
      const [, reviews, reviewId, resolve, invoices] = match;
      const method = event.httpMethod;
      if (method !== (resolve ? 'POST' : 'GET')) return json(405, { error: 'method_not_allowed' });
      const db = adapters.db || getPaymentDb();
      if (invoices) return json(200, { invoices: await listInvoicesForReconciliation(db, event.queryStringParameters?.status || null) });
      if (reviews && !reviewId) return json(200, { reviews: await listReviews(db) });
      const settings = adapters.settings || factoringSettings(env);
      return json(200, await resolveReview(db, userId, reviewId.toLowerCase(), parseBody(event), { now: adapters.now || Date.now, settings }));
    } catch (error) { return errorResponse(error); }
  };
}
export const handler = createFactoringAdminHandler();
