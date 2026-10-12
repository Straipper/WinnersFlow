import { getOptionsFlow, getDarkPoolPrints, getOptionsFlowSessions } from './optionWhales.js';

function describe(value, depth = 0) {
  if (value === null) return { type: 'null' };
  if (Array.isArray(value)) {
    return {
      type: 'array',
      length: value.length,
      sample: value.length && depth < 3
        ? describe(value[0], depth + 1)
        : undefined,
    };
  }
  if (typeof value !== 'object') {
    return { type: typeof value };
  }

  const fields = {};
  for (const [key, item] of Object.entries(value)) {
    fields[key] = describe(item, depth + 1);
  }
  return { type: 'object', fields };
}

export async function diagnoseOptionWhales() {
  const results = {};

  try {
    const raw = await getOptionsFlowSessions();
    results.sessions = { ok: true, structure: describe(raw) };
  } catch (error) {
    results.sessions = { ok: false, error: String(error?.message || 'Request failed').slice(0, 200) };
  }

  for (const [name, request] of [
    ['options', () => getOptionsFlow('NVDA', { limit: 3 })],
    ['darkPool', () => getDarkPoolPrints('NVDA', { limit: 3 })],
  ]) {
    try {
      const raw = await request();
      results[name] = {
        ok: true,
        structure: describe(raw),
      };
    } catch (error) {
      results[name] = {
        ok: false,
        error: String(error?.message || 'Request failed')
          .replace(/((?:key|token|authorization)\s*[:=]\s*)\S+/gi, '$1[REDACTED]')
          .slice(0, 200),
      };
    }
  }

  return results;
}
