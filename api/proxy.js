// /api/proxy.js
// Proxy serverless Vercel ke Google Apps Script Web App.
// Dipakai agar frontend tidak terkena CORS dan URL GAS tidak ter-expose ke client.

const GAS_URL = 'https://script.google.com/macros/s/AKfycbxLtmNQ_VajLZmkCaA9mDVHUtIdq1wk5fNfLk1U9j7dCizSf8J4IwdrBMmJmy6AS-gFFA/exec';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (!GAS_URL) {
    res.status(500).json({ ok: false, error: 'GAS_URL belum diisi di api/proxy.js' });
    return;
  }

  try {
    if (req.method === 'GET') {
      const r = await fetch(GAS_URL, { method: 'GET' });
      const text = await r.text();
      return respondJsonOrHtml(res, text);
    }

    // POST -> forward body apa adanya ke GAS
    const r = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
    });
    const text = await r.text();
    return respondJsonOrHtml(res, text);
  } catch (err) {
    res.status(502).json({ ok: false, error: 'PROXY_FETCH_FAILED: ' + err.message });
  }
}

function respondJsonOrHtml(res, text) {
  // GAS kadang mengembalikan HTML saat timeout/auth gagal -> deteksi & beri error jelas
  const trimmed = (text || '').trim();
  if (trimmed.startsWith('<')) {
    res.status(502).json({ ok: false, error: '[gas-proxy] Non-JSON response from GAS', raw: trimmed.slice(0, 300) });
    return;
  }
  try {
    const json = JSON.parse(trimmed);
    res.status(200).json(json);
  } catch (e) {
    res.status(502).json({ ok: false, error: '[gas-proxy] Failed to parse GAS response', raw: trimmed.slice(0, 300) });
  }
}
