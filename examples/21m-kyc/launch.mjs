import { spawn } from 'node:child_process';
import { access, copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const directory = fileURLToPath(new URL('./', import.meta.url));
export async function startLab({ configDirectory = directory, port = 3210, openBrowser = true } = {}) {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Este laboratorio requiere Node 24 o posterior.');
  try { createRequire(import.meta.url).resolve('web-push'); }
  catch { throw new Error(`Faltan dependencias. Ejecutá npm ci desde ${directory}`); }
  const settings = resolve(configDirectory);
  const envFile = join(settings, '.env');
  try { await access(envFile); }
  catch {
    await copyFile(join(directory, '.env.example'), envFile, constants.COPYFILE_EXCL);
    throw new Error(`Se creó ${envFile}. Completá TWENTYONE_API_KEY con tu clave nx_test_ y volvé a abrir abrir-web.cmd.`);
  }
  console.log(`Código del laboratorio: ${directory}`);
  console.log(`Configuración y datos locales: ${settings}`);
  const child = spawn(process.execPath, [`--env-file=${envFile}`, join(directory, 'web/server.mjs')], {
    cwd: directory,
    env: { ...process.env, KYC_LAB_DATA_DIR: join(settings, '.data'), KYC_LAB_PORT: String(port) },
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'], windowsHide: true,
  });
  const url = await new Promise((accept, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('El servidor tardó demasiado en iniciar. Revisá los mensajes de esta ventana.')); }, 20000);
    const finish = callback => value => { clearTimeout(timer); callback(value); };
    child.once('error', finish(reject));
    child.once('message', finish(message => {
      if (message?.type === 'ready') accept(message.url);
      else { child.kill(); reject(new Error('Respuesta de inicio inválida.')); }
    }));
    child.once('exit', finish(code => reject(new Error(`El servidor no pudo iniciar (código ${code}). Si el puerto ${port} está ocupado, cerrá la ventana anterior del laboratorio y volvé a abrir este CMD.`))));
  });
  if (openBrowser) {
    const opener = process.platform === 'win32'
      ? spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true, stdio: 'ignore' })
      : null;
    opener?.on('error', () => console.log(`Abrí ${url} en tu navegador.`));
  }
  return { child, url };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { child } = await startLab({ configDirectory: process.argv[2] || directory });
    child.once('exit', code => { process.exitCode = code ?? 1; });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
