import { kickWorker } from './lib/paymentRuntime.js';
import { factoringActive } from './lib/factoringWorker.js';
// Scheduled every minute (netlify.toml). Wakes the background worker only while the pilot is active.
export function createFactoringDispatch({ env = process.env, kick = kickWorker } = {}) {
  return async () => {
    if (!factoringActive(env)) return { statusCode: 200, body: JSON.stringify({ skipped: true }) };
    const result = await kick({ functionName: 'factoring-worker-background' });
    return { statusCode: result.accepted ? 200 : 503, body: JSON.stringify(result) };
  };
}
export const handler = createFactoringDispatch();
