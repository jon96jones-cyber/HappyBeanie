// /api/batch — live small-batch availability for the product page.
//
// The batch counter is REAL: remaining = BATCH_TOTAL minus every box sold in
// actual Shopify orders since BATCH_START. One-time and subscription orders
// count 1 box per unit; the 4-pack counts 4 (it ships four boxes from the same
// run). Renewals count too — every box that ships comes out of the batch.
// Cancelled orders are excluded, so a voided order returns its boxes.
//
// Starting the next run: bump BATCH_TOTAL / BATCH_START in Vercel env and
// redeploy. Public endpoint (exposes only a count); CDN-cached for 60s.

const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'pxv2u2-kc.myshopify.com';
const API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || '2025-07';

const BATCH_START = process.env.BATCH_START || '2026-08-13T00:00:00-07:00';
// Each species runs its own batch. OFFSET is boxes already gone when tracking
// began (pre-orders, samples, holdbacks) — a tracker opens at TOTAL − OFFSET
// and drains from that species' real orders after that.
const RUNS = {
  dog: {
    total: parseInt(process.env.BATCH_TOTAL_DOG || '500', 10),
    offset: parseInt(process.env.BATCH_OFFSET_DOG || '48', 10)
  },
  cat: {
    total: parseInt(process.env.BATCH_TOTAL_CAT || '500', 10),
    offset: parseInt(process.env.BATCH_OFFSET_CAT || '67', 10)
  }
};

const QUERY = `query Batch($q: String!, $after: String) {
  orders(first: 100, after: $after, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes { lineItems(first: 20) { nodes { sku quantity } } }
  }
}`;

// Which run a SKU draws from, and how many boxes per unit: the 4-pack ships
// four boxes; everything else is one. Non-HB SKUs don't touch either batch.
function speciesFor(sku) {
  const s = String(sku || '');
  if (/^HB-CAT/i.test(s)) return 'cat';
  if (/^HB-DOG/i.test(s)) return 'dog';
  return null;
}
function boxesFor(sku, qty) {
  return (/4PK/i.test(String(sku || '')) ? 4 : 1) * (qty || 0);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false });
  }
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!token) return res.status(503).json({ ok: false, error: 'not_configured' });

  try {
    const q = "created_at:>='" + BATCH_START + "' AND -status:cancelled";
    const sold = { dog: 0, cat: 0 };
    let after = null;
    for (let page = 0; page < 10; page++) { // 1,000 orders ≫ any single batch
      const r = await fetch('https://' + STORE_DOMAIN + '/admin/api/' + API_VERSION + '/graphql.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
        body: JSON.stringify({ query: QUERY, variables: { q: q, after: after } })
      });
      const json = await r.json().catch(function () { return {}; });
      const conn = json && json.data && json.data.orders;
      if (!conn) {
        console.error('[batch]', JSON.stringify((json && json.errors) || r.status));
        return res.status(502).json({ ok: false, error: 'upstream' });
      }
      conn.nodes.forEach(function (o) {
        ((o.lineItems && o.lineItems.nodes) || []).forEach(function (li) {
          const sp = speciesFor(li.sku);
          if (sp) sold[sp] += boxesFor(li.sku, li.quantity);
        });
      });
      if (!conn.pageInfo.hasNextPage) break;
      after = conn.pageInfo.endCursor;
    }

    function runOut(sp) {
      const r = RUNS[sp];
      return { total: r.total, remaining: Math.max(0, r.total - r.offset - sold[sp]), sold: sold[sp] };
    }
    // Edge cache: fresh for 60s, serve stale while revalidating. The counter
    // never needs to be second-perfect — it needs to be true.
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ ok: true, dog: runOut('dog'), cat: runOut('cat') });
  } catch (err) {
    console.error('[batch]', err && err.message);
    return res.status(502).json({ ok: false, error: 'upstream' });
  }
};
