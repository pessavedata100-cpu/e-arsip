// /api/proxy.js — Yor.iAPP Vercel → Google Apps Script proxy
//
// STRATEGI: Kirim payload sebagai query-param ?data=<JSON> via GET.
// Ini menghindari masalah POST-redirect yang ada di GAS /exec (302 → fetch ubah POST→GET).
// doGet di Code.gs membaca e.parameter.data dan merutekan sama persis seperti doPost.

const GAS_URL = 'https://script.google.com/macros/s/AKfycbxLtmNQ_VajLZmkCaA9mDVHUtIdq1wk5fNfLk1U9j7dCizSf8J4IwdrBMmJmy6AS-gFFA/exec';
const TIMEOUT_MS = 55000;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  try {
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});

    // Kirim sebagai GET + ?data=... supaya redirect diikuti otomatis tanpa mengubah metode
    const url = GAS_URL + '?data=' + encodeURIComponent(rawBody);
    const text = await fetchWithTimeout(url, { method: 'GET', redirect: 'follow' }, TIMEOUT_MS);

    return parseAndRespond(res, text);
  } catch (err) {
    const msg = err.message || String(err);
    if (msg === 'TIMEOUT') return res.status(504).json({ ok: false, error: 'GAS timeout. Coba lagi.' });
    return res.status(502).json({ ok: false, error: 'PROXY_ERROR: ' + msg });
  }
}

async function fetchWithTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    return r.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseAndRespond(res, text) {
  const t = (text || '').trim();
  if (!t) return res.status(502).json({ ok: false, error: 'GAS mengembalikan respons kosong. Pastikan deployment GAS sudah di-update ke versi terbaru (New version).' });
  if (t.startsWith('<')) {
    const isAuth = t.includes('accounts.google.com') || t.includes('signin') || t.includes('ServiceLogin');
    return res.status(502).json({
      ok: false,
      error: isAuth
        ? 'GAS butuh otorisasi ulang. Buka URL /exec di browser lalu izinkan akses.'
        : 'GAS mengembalikan HTML. Pastikan deployment di-update ke New Version dan Who has access = Anyone.'
    });
  }
  try {
    return res.status(200).json(JSON.parse(t));
  } catch {
    return res.status(502).json({ ok: false, error: 'Respons GAS bukan JSON valid.', debug: t.slice(0, 300) });
  }
}
