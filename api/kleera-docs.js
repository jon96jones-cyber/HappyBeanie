// GET /api/kleera-docs?key=… — renders the kleera application-documents desk.
// The Supabase edge function builds the page but its gateway can deliver it
// with a plain-text content type, so browsers show raw markup; this relay
// fetches it server-side and re-serves the same body as real HTML. The key is
// passed through, never stored, and a bad key comes back 403 upstream.

const UPSTREAM = 'https://wacctepcvejvdinxcvdv.supabase.co/functions/v1/smart-action';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).send('method not allowed');
  }
  const key = String((req.query && req.query.key) || '');
  if (!key) return res.status(403).send('forbidden');

  try {
    const up = await fetch(UPSTREAM + '?key=' + encodeURIComponent(key), {
      headers: { Accept: 'text/html' }
    });
    const body = await up.text();
    if (up.status !== 200) {
      return res.status(up.status).setHeader('Content-Type', 'text/plain; charset=utf-8').send(body.slice(0, 500));
    }
    // The function builds links from its proxied origin, which reports http.
    const html = body.replace(/http:\/\/wacctepcvejvdinxcvdv\.supabase\.co/g, 'https://wacctepcvejvdinxcvdv.supabase.co');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    return res.status(200).send(html);
  } catch (err) {
    console.error('[kleera-docs]', err && err.message);
    return res.status(502).send('upstream unreachable');
  }
};
