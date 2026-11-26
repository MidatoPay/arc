import { authenticatePayment, getPaymentDb, getPaymentPrivy, json, errorResponse, kickWorker } from './lib/paymentRuntime.js';
import { factoringSettings } from './lib/factoringConfig.js';
import { assertFactoringEnabled } from './lib/factoringAccess.js';
import { listOffers, quoteOffer, createTake, getTake, TermsChangedError } from './lib/factoringTakes.js';
import { idempotencyHeader, parseBody } from './lib/factoringHttp.js';
// Investor API of the invoice cession pilot (plan 7.3).
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ROUTE = new RegExp(`^/invoice-offers(?:/takes/(${UUID})|/(${UUID})(?:/(take))?)?/?$`, 'i');

export function createInvoiceOffersHandler(adapters = {}) {
  return async event => {
    try {
      const userId = await (adapters.authenticate || authenticatePayment)(event);
      const path = (event.path || '').replace(/^\/\.netlify\/functions\/invoice-offers/, '/invoice-offers');
      const match = path.match(ROUTE);
      if (!match) return json(404, { error: 'not_found' });
      const [, takeId, offerId, action] = match;
      const method = event.httpMethod;
      if (method !== (action ? 'POST' : 'GET')) return json(405, { error: 'method_not_allowed' });
      const env = adapters.env || process.env;
      assertFactoringEnabled(userId, env);
      const settings = adapters.settings || factoringSettings(env);
      const db = adapters.db || getPaymentDb();
      const now = adapters.now || Date.now;
      if (takeId) return json(200, { take: await getTake(db, userId, takeId.toLowerCase()) });
      if (!offerId) return json(200, await listOffers(db, userId, { now, settings, holidays: adapters.holidays }));
      if (!action) return json(200, await quoteOffer(db, userId, offerId.toLowerCase(), { now, settings, holidays: adapters.holidays }));
      const body = parseBody(event);
      try {
        const { take, existing } = await createTake(db, userId, offerId.toLowerCase(), body, idempotencyHeader(event), {
          now, settings, env, client: adapters.client, holidays: adapters.holidays,
          getUser: adapters.getUser || (uid => getPaymentPrivy().getUser(uid)),
          kick: adapters.kick || (() => kickWorker({ functionName: 'factoring-worker-background' })) });
        return json(existing ? 200 : 202, { take });
      } catch (error) {
        // The investor accepts an exact amount: on a change, return the fresh quote to confirm again.
        if (error instanceof TermsChangedError) return json(409, { error: 'terms_changed', quote: error.quote });
        throw error;
      }
    } catch (error) { return errorResponse(error); }
  };
}
export const handler = createInvoiceOffersHandler();
