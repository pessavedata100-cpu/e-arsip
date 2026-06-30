// /api/proxy.js — Yor.iAPP Vercel → Google Apps Script proxy
// Fix utama: GAS /exec melakukan 302 redirect saat POST.
// fetch() Node.js secara default mengikuti redirect tapi mengubah POST→GET (standar HTTP).
// Solusi: nonaktifkan auto-redirect, deteksi 302/301, lalu POST ulang ke Location URL.

const GAS_URL = 'https://script.google.com/macros/s/AKfycbxLtmNQ_VajLZmkCaA9mDVHUtIdq1wk5fNfLk1U9j7dCizSf8J4IwdrBMmJmy6AS-gFFA/exec';
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 55000; // 55 detik (batas Vercel serverless 60 detik)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});

  try {
    const text = req.method === 'GET'
      ? await gasGet(GAS_URL)
      : await gasPost(GAS_URL, rawBody);
    return parseAndRespond(res, text);
  } catch (err) {
    const msg = err.message || String(err);
    if (msg === 'TIMEOUT') {
      return res.status(504).json({ ok: false, error: 'GAS timeout (>55 detik). Coba lagi atau periksa GAS execution log.' });
    }
    return res.status(502).json({ ok: false, error: 'PROXY_ERROR: ' + msg });
  }
}

async function gasGet(url) {
  const r = await fetchWithTimeout(url, { method: 'GET', redirect: 'follow' }, TIMEOUT_MS);
  return r.text();
}

async function gasPost(url, body, redirectCount = 0) {
  if (redirectCount > MAX_REDIRECTS) throw new Error('TOO_MANY_REDIRECTS');

  const r = await fetchWithTimeout(url, {
    method: 'POST',
    redirect: 'manual',                        // ← kunci: jangan ikuti redirect otomatis
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body
  }, TIMEOUT_MS);

  // GAS mengembalikan 302 → ikuti redirect dengan POST (bukan GET)
  if ((r.status === 301 || r.status === 302 || r.status === 303 || r.status === 307 || r.status === 308)) {
    const location = r.headers.get('location');
    if (!location) throw new Error('REDIRECT_WITHOUT_LOCATION');
    // 303 See Other → semantiknya memang GET, tapi GAS butuh POST; coba GET dulu, jika HTML ulangi POST
    const nextMethod = r.status === 303 ? 'GET' : 'POST';
    if (nextMethod === 'GET') {
      // Beberapa deployment GAS 303 ke URL yang langsung mengembalikan JSON via GET
      const gr = await fetchWithTimeout(location, { method: 'GET', redirect: 'follow' }, TIMEOUT_MS);
      const text = await gr.text();
      if (text.trim().startsWith('{')) return text; // berhasil
      // Jika masih HTML, coba POST ke location
    }
    return gasPost(location, body, redirectCount + 1);
  }

  return r.text();
}

function fetchWithTimeout(url, opts, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('TIMEOUT')), ms);
    fetch(url, opts).then(r => { clearTimeout(timer); resolve(r); }).catch(e => { clearTimeout(timer); reject(e); });
  });
}

function parseAndRespond(res, text) {
  const trimmed = (text || '').trim();
  if (!trimmed) {
    return res.status(502).json({ ok: false, error: 'GAS mengembalikan respons kosong. Pastikan deployment sudah di-update ke versi terbaru.' });
  }
  if (trimmed.startsWith('<')) {
    // Cek apakah halaman login/otorisasi Google
    const isAuthPage = trimmed.includes('accounts.google.com') || trimmed.includes('signin') || trimmed.includes('Authorization');
    const hint = isAuthPage
      ? 'Halaman otorisasi Google terdeteksi. Buka URL GAS /exec di browser, izinkan akses, lalu coba lagi.'
      : 'GAS mengembalikan HTML (bukan JSON). Kemungkinan deployment GAS belum di-update atau ada error di GAS.';
    return res.status(502).json({ ok: false, error: hint, debug: trimmed.slice(0, 400) });
  }
  try {
    const json = JSON.parse(trimmed);
    return res.status(200).json(json);
  } catch {
    return res.status(502).json({ ok: false, error: 'Respons GAS bukan JSON valid.', debug: trimmed.slice(0, 400) });
  }
}
