import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startLab } from './launch.mjs';

test('launcher serves the updated queries with the original configuration and data directory', async () => {
  const directory = await mkdtemp(join(tmpdir(), '21m-launch-'));
  let child;
  try {
    await writeFile(join(directory, '.env'), 'TWENTYONE_API_KEY=nx_test_fixture\n');
    const started = await startLab({ configDirectory: directory, port: 0, openBrowser: false });
    child = started.child;
    const response = await fetch(started.url);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Consultar APIs de este cliente/);
    assert.match(html, /id="query-name"/);
    assert.match(await fetch(started.url+'/queries.js').then(r=>r.text()), /function openClientQueries/);
    assert.equal((await fetch(started.url+'/config').then(r=>r.json())).ready, true);
    assert.ok(JSON.parse(await readFile(join(directory, '.data/vapid.json'), 'utf8')).publicKey);
  } finally {
    if (child && child.exitCode === null) { const exited=once(child,'exit');child.kill();await exited; }
    await rm(directory,{recursive:true,force:true});
  }
});

test('launcher initializes a missing configuration without starting or overwriting credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), '21m-launch-config-'));
  try {
    await assert.rejects(startLab({ configDirectory: directory, openBrowser: false }), /Completá TWENTYONE_API_KEY/);
    assert.equal(await readFile(join(directory, '.env'), 'utf8'), await readFile(new URL('.env.example', import.meta.url), 'utf8'));
  } finally { await rm(directory,{recursive:true,force:true}); }
});
