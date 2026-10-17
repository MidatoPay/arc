import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Netlify bundles all Functions on startup. Limit esbuild's Go runtime on
// machines where concurrent compilation otherwise exhausts memory.
const child = spawn(process.execPath, [
  fileURLToPath(new URL('../node_modules/netlify-cli/bin/run.js', import.meta.url)),
  'dev', '--offline', ...process.argv.slice(2),
], {
  stdio: 'inherit',
  env: {
    ...process.env,
    GOMAXPROCS: process.env.GOMAXPROCS || '2',
    GOMEMLIMIT: process.env.GOMEMLIMIT || '768MiB',
    // Local background workers must return to this dev server, not a stale
    // .env URL (or a production URL). Netlify preserves process env values.
    PAYMENTS_BASE_URL: 'http://localhost:8888',
  },
});

child.on('error', (error) => {
  console.error('No se pudo iniciar Netlify Dev:', error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
