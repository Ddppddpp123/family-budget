const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const LEDGER_EMAIL = (process.env.LEDGER_EMAIL || '').toLowerCase();
const LEDGER_PASSWORD = process.env.LEDGER_PASSWORD || '';

function json(status, body) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) };
}
function assertConfig() {
  if (!SUPABASE_URL) throw new Error('Missing Netlify env SUPABASE_URL');
  if (!SERVICE_ROLE_KEY) throw new Error('Missing Netlify env SUPABASE_SERVICE_ROLE_KEY');
  if (!LEDGER_EMAIL) throw new Error('Missing Netlify env LEDGER_EMAIL');
  if (!LEDGER_PASSWORD) throw new Error('Missing Netlify env LEDGER_PASSWORD');
}
function assertAuth(body) {
  const email = String(body.email || '').toLowerCase().trim();
  const password = String(body.password || '');
  if (email !== LEDGER_EMAIL || password !== LEDGER_PASSWORD) throw new Error('Invalid Ledger email or password');
  return email;
}
async function supa(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(`Supabase HTTP ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  return data;
}
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only' });
  try {
    assertConfig();
    const body = JSON.parse(event.body || '{}');
    const email = assertAuth(body);
    const action = body.action;
    if (action === 'test') return json(200, { ok: true, message: 'Netlify function and Supabase env are configured' });
    if (action === 'load') {
      const rows = await supa(`/rest/v1/ledger_app_state?email=eq.${encodeURIComponent(email)}&select=data,updated_at&limit=1`, { method: 'GET' });
      return json(200, { ok: true, data: rows && rows[0] ? rows[0].data : {}, updated_at: rows && rows[0] ? rows[0].updated_at : null });
    }
    if (action === 'save') {
      const payload = [{ email, data: body.data || {}, updated_at: new Date().toISOString() }];
      const rows = await supa('/rest/v1/ledger_app_state?on_conflict=email', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(payload) });
      return json(200, { ok: true, updated_at: rows && rows[0] ? rows[0].updated_at : null });
    }
    if (action === 'snapshot') {
      await supa('/rest/v1/ledger_app_backups', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify([{ email, reason: body.reason || 'manual', data: body.data || {} }]) });
      return json(200, { ok: true });
    }
    return json(400, { ok: false, error: 'Unknown action' });
  } catch (e) {
    return json(500, { ok: false, error: e.message || String(e) });
  }
};
