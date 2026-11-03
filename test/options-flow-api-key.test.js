import test from 'node:test';
import assert from 'node:assert/strict';
import { getOptionsFlowSessions } from '../src/services/optionWhales.js';

test('OPTIONWHALES_API_KEY toimii API-avaimen vaihtoehtoisena nimenä', async () => {
  const oldFlow = process.env.OPTIONFLOW_API_KEY;
  const oldWhales = process.env.OPTIONWHALES_API_KEY;
  const oldFetch = globalThis.fetch;

  try {
    delete process.env.OPTIONFLOW_API_KEY;
    process.env.OPTIONWHALES_API_KEY = 'test-key-not-a-real-secret';

    let requestHeaders;
    globalThis.fetch = async (_url, options) => {
      requestHeaders = options.headers;
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify({ latest: 'test-session' }),
      };
    };

    const result = await getOptionsFlowSessions();
    assert.equal(result.latest, 'test-session');
    assert.equal(requestHeaders['X-API-Key'], 'test-key-not-a-real-secret');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldFlow === undefined) delete process.env.OPTIONFLOW_API_KEY;
    else process.env.OPTIONFLOW_API_KEY = oldFlow;

    if (oldWhales === undefined) delete process.env.OPTIONWHALES_API_KEY;
    else process.env.OPTIONWHALES_API_KEY = oldWhales;
  }
});
