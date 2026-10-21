import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import redirects from 'follow-redirects';

// Both hosts are resolved to loopback. These requests never leave the machine.
function loopbackLookup(_hostname, options, callback) {
  if (options.all) callback(null, [{ address: '127.0.0.1', family: 4 }]);
  else callback(null, '127.0.0.1', 4);
}

async function listen(t, handler) {
  const server = createServer(handler);
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

async function followCrossHostRedirect(t, options) {
  let sourceHeaders, destinationHeaders;
  const destinationPort = await listen(t, (request, response) => {
    destinationHeaders = request.headers;
    response.end('ok');
  });
  const sourcePort = await listen(t, (request, response) => {
    sourceHeaders = request.headers;
    response.writeHead(302, { Location: `http://destination.test:${destinationPort}/` });
    response.end();
  });
  await new Promise((resolve, reject) => {
    const request = redirects.http.get(`http://source.test:${sourcePort}/`, {
      ...options, lookup: loopbackLookup, agent: false, maxRedirects: 2,
    }, response => {
      assert.equal(response.statusCode, 200);
      response.on('error', reject);
      response.on('end', resolve);
      response.resume();
    });
    request.on('error', reject);
    request.setTimeout(5000, () => request.destroy(new Error('Local redirect timed out')));
  });
  return { sourceHeaders, destinationHeaders };
}

test('cross-host redirects strip credentials supplied as an array of header names and values', { timeout: 10000 }, async t => {
  const { sourceHeaders, destinationHeaders } = await followCrossHostRedirect(t, {
    headers: ['Authorization', 'Bearer fixture-token', 'Cookie', 'fixture=session',
      'Proxy-Authorization', 'Basic fixture-proxy', 'X-Public', 'safe'],
  });
  for (const name of ['authorization', 'cookie', 'proxy-authorization']) {
    assert.ok(sourceHeaders[name], `${name} must reach the intended host`);
    assert.equal(destinationHeaders[name], undefined, `${name} must not reach another host`);
  }
  assert.equal(destinationHeaders['x-public'], 'safe');
});

test('custom sensitive headers with regex metacharacters are stripped on cross-host redirects', { timeout: 10000 }, async t => {
  const { sourceHeaders, destinationHeaders } = await followCrossHostRedirect(t, {
    headers: { 'X^Session-Key': 'fixture-private-key', Authorization: 'Bearer fixture-token', 'X-Public': 'safe' },
    sensitiveHeaders: ['X^Session-Key'],
  });
  assert.equal(sourceHeaders['x^session-key'], 'fixture-private-key');
  assert.equal(destinationHeaders['x^session-key'], undefined);
  assert.equal(destinationHeaders.authorization, undefined);
  assert.equal(destinationHeaders['x-public'], 'safe');
});
