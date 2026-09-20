#!/usr/bin/env node
// tools/check-claims.js — fails when the site says something untrue.
//
//   node tools/check-claims.js
//
// This exists because of a specific failure. The prelaunch copy — "ships in
// ~4 weeks", "Batch 0072 in production" — sat in index.html for months after
// it stopped being true. It was invisible in a browser, because the blocks
// were display:none, so nobody caught it. It was NOT invisible to anything
// reading the raw HTML: an AI asked about the page would tell a customer
// shipping took four weeks while the store was shipping in 24 hours.
//
// So the rule this file enforces is: hidden is not the same as absent. Every
// check below reads the SOURCE, not the rendered page, because the source is
// what crawlers, scrapers and assistants actually consume.
//
// Checks are grouped by what they can prove:
//
//   STALE      strings that were true once and are not now
//   CONFLICT   two places in the repo that cannot both be right
//   UNSOURCED  a named ingredient that is not in that species' own list
//
// Exit code 1 on any failure. Add a check whenever you fix a claim by hand —
// the point is that the next person does not have to remember.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const problems = [];
const fail = (kind, where, msg) => problems.push({ kind, where, msg });

const html = read('index.html');

// Strip HTML comments and JS line comments before scanning for copy. An
// engineering note explaining why a claim was removed must not itself trip
// the check that removed it.
const prose = html
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\/\*[\s\S]*?\*\//g, '');

// ---------------------------------------------------------------- STALE ----
// Prelaunch. Removed Sep 2026; the store ships to order.
[
  [/~?\s?4\s*weeks/i, 'four-week shipping promise'],
  [/\bfour weeks\b/i, 'four-week shipping promise'],
  [/Batch\s*0072/i, 'the prelaunch batch number'],
  [/\bin production\b/i, '"in production" — the store ships to order'],
  [/reserving now|reserve your box|box is reserved/i, 'prelaunch reservation copy'],
  [/HB_PRELAUNCH|data-pre-show|data-pre-hide|hb-prelaunch/, 'prelaunch machinery'],
  [/\bpre-?orders?\b/i, 'pre-order copy — the store sells from stock']
].forEach(([rx, what]) => {
  const m = prose.match(rx);
  if (m) fail('STALE', 'index.html', `${what} — found ${JSON.stringify(m[0])}`);
});

// Pre-ordering was removed in Sep 2026 and is not coming back while the store
// ships to order. These two make its return loud rather than quiet: a feed row
// that says preorder, or an availability_date column, which only ever has a
// meaning alongside preorder or backorder.
if (/\bpreorder\b|\bbackorder\b/i.test(read('google-product-feed.tsv'))) {
  fail('STALE', 'google-product-feed.tsv', 'a row is on pre-order or back-order');
}
if (/\bavailability_date\b/.test(read('google-product-feed.tsv'))) {
  fail('STALE', 'google-product-feed.tsv', 'availability_date is back — it only means something for pre-order or back-order');
}

// -------------------------------------------------------------- CONFLICT ----
// The Google feed and the site describe the same two products to the same
// shoppers. Merchant Center compares them, and a mismatch suppresses the
// listing, so they have to agree on availability and price.
const feed = read('google-product-feed.tsv').trim().split('\n');
const head = feed[0].split('\t');
const rows = feed.slice(1).map((l) => Object.fromEntries(l.split('\t').map((v, i) => [head[i], v])));

const ld = (html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) || [])[1];
if (!ld) {
  fail('CONFLICT', 'index.html', 'no static JSON-LD in the head — crawlers that do not run JS see no product data');
} else {
  let graph = [];
  try {
    graph = JSON.parse(ld)['@graph'] || [];
  } catch (e) {
    fail('CONFLICT', 'index.html', 'the JSON-LD block does not parse: ' + e.message);
  }
  const products = graph.filter((n) => n['@type'] === 'Product');
  if (products.length !== rows.length) {
    fail('CONFLICT', 'feed vs JSON-LD', `${products.length} products in the markup, ${rows.length} in the feed`);
  }
  products.forEach((p) => {
    const row = rows.find((r) => r.id === p.sku);
    if (!row) return fail('CONFLICT', 'feed', `${p.sku} is in the markup but not the feed`);

    const ldPrice = String(p.offers.price);
    const feedPrice = (row.price || '').replace(/[^\d.]/g, '');
    if (ldPrice !== feedPrice) {
      fail('CONFLICT', p.sku, `price is ${ldPrice} in the markup, ${feedPrice} in the feed`);
    }

    const ldStock = /InStock/i.test(p.offers.availability) ? 'in_stock'
      : /PreOrder/i.test(p.offers.availability) ? 'preorder' : 'other';
    const feedStock = (row.availability || '').trim();
    if (ldStock !== feedStock) {
      fail('CONFLICT', p.sku, `availability is "${ldStock}" in the markup, "${feedStock}" in the feed`);
    }
    if (row.title && p.name && row.title !== p.name) {
      fail('CONFLICT', p.sku, 'title differs between the feed and the markup');
    }
  });
}

function listFor(species) {
  // insideList is `sp === 'cat' ? [ ...cat... ] : [ ...dog... ]`.
  const block = html.match(/insideList:\s*\(this\.state\.sp === 'cat' \?([\s\S]*?)\)\.map\(/);
  if (!block) return null;
  const [cat, dog] = block[1].split(/\]\s*:\s*\[/);
  const names = (chunk) => [...chunk.matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1]);
  return species === 'cat' ? names(cat) : names(dog);
}

// The ingredient panel exists twice: as the tiles the page renders from
// insideList, and as activeIngredient properties in the static JSON-LD, which
// is the copy anything that does not run JavaScript actually reads. They are
// generated from the same source, and they have to stay that way — a crawler
// being told a formula the page does not show is worse than it being told
// nothing.
if (ld) {
  const graph = JSON.parse(ld)['@graph'] || [];
  [['HB-DOG-30', 'dog'], ['HB-CAT-30', 'cat']].forEach(([sku, species]) => {
    const p = graph.find((n) => n.sku === sku);
    if (!p) return;
    const panel = (listFor(species) || []).join(' | ');
    const schema = (p.additionalProperty || [])
      .filter((x) => x.propertyID === 'activeIngredient')
      .sort((a, b) => a.position - b.position)
      .map((x) => x.name.replace(/\s*\(.*\)$/, ''));
    if (!schema.length) {
      return fail('CONFLICT', sku, 'no activeIngredient properties — crawlers that do not run JS cannot see the formula');
    }
    if (schema.join(' | ') !== panel) {
      fail('CONFLICT', sku, `the structured data and the on-page panel list different formulas\n    panel:  ${panel}\n    schema: ${schema.join(' | ')}`);
    }
  });
}

// middleware.js writes each route's <title> into the HTML at the edge, and
// HB_ROUTE_META in index.html sets the tab title on in-app navigation. A
// route whose crawled title differs from its tab title is a page describing
// itself two ways.
{
  const mw = read('middleware.js');
  const mwBlock = (mw.match(/const ROUTES = \{([\s\S]*?)\n\};/) || [])[1] || '';
  const edge = Object.fromEntries([...mwBlock.matchAll(/(\w+): \{\s*title: '([^']*)'/g)].map((m) => [m[1], m[2]]));
  const appBlock = (html.match(/window\.HB_ROUTE_META = \{([\s\S]*?)\};/) || [])[1] || '';
  const app = Object.fromEntries([...appBlock.matchAll(/(\w+): '([^']*)'/g)].map((m) => [m[1], m[2]]));
  if (!Object.keys(edge).length) fail('CONFLICT', 'middleware.js', 'no ROUTES titles found');
  if (!Object.keys(app).length) fail('CONFLICT', 'index.html', 'no HB_ROUTE_META titles found');
  const keys = new Set([...Object.keys(edge), ...Object.keys(app)]);
  keys.forEach((k) => {
    if (edge[k] !== app[k]) fail('CONFLICT', 'route ' + k, `edge title ${JSON.stringify(edge[k])} vs app title ${JSON.stringify(app[k])}`);
  });
  const matcher = (mw.match(/matcher: \[([^\]]*)\]/) || [])[1] || '';
  Object.keys(edge).forEach((k) => {
    const path = k === 'home' ? "'/'" : "'/" + k + "'";
    if (matcher.indexOf(path) === -1) fail('CONFLICT', 'middleware.js', `route ${k} has a title but is not in the matcher`);
  });
}

// The shipping policy and the storefront both state a dispatch time.
const shipping = read('policies/shipping.html');
if (/24\s*h(ours)?/i.test(prose) && !/next business (morning|day)|24\s*h/i.test(shipping)) {
  fail('CONFLICT', 'shipping', 'the storefront promises 24h dispatch, the shipping policy does not');
}

// ------------------------------------------------------------- UNSOURCED ----
// Every ingredient named in marketing copy must appear in that species' own
// list. The formulas are not identical, so a line written for one page can be
// false on the other — that is exactly how green-lipped mussel ended up on
// the dog page.

// The claim copy is defined per species in the same object as the list.
const ledes = [...html.matchAll(/eyebrow: 'Happy Beans[^']*\b[Ff]or (Dogs|Cats)'[\s\S]{0,600}?body: '([^']+)'/g)]
  .map((m) => ({ species: m[1].toLowerCase().slice(0, 3), body: m[2] }));

if (!ledes.length) fail('UNSOURCED', 'index.html', 'could not find the per-species product ledes to check');

// Ingredients worth policing: ones that exist in one formula but not both, or
// that name a branded raw material. Add to this as the copy names more.
const WATCH = [
  'Green Lipped Mussel', 'Green-Lipped Mussel', 'Taurine', 'Cranberry', 'Chamomile',
  'Elk Velvet Antler', 'Turkey Tail', 'Curcumin', 'Elk Liver', 'UC-II'
];

ledes.forEach(({ species, body }) => {
  const list = listFor(species === 'dog' ? 'dog' : 'cat');
  if (!list) return fail('UNSOURCED', 'index.html', 'could not parse insideList');
  const flat = list.join(' | ').toLowerCase();
  WATCH.forEach((ing) => {
    if (!new RegExp(ing.replace(/[-\s]/g, '[-\\s]?'), 'i').test(body)) return;
    const norm = ing.replace(/[-\s]/g, '[-\\s]?');
    if (!new RegExp(norm, 'i').test(flat)) {
      fail('UNSOURCED', `${species} lede`, `names "${ing}", which is not in the ${species} formula (${list.join(', ')})`);
    }
  });
});

// ------------------------------------------------------------------ out ----
if (!problems.length) {
  console.log('check-claims: no stale, conflicting or unsourced claims found.');
  process.exit(0);
}

const byKind = problems.reduce((acc, p) => ((acc[p.kind] = acc[p.kind] || []).push(p), acc), {});
Object.keys(byKind).forEach((kind) => {
  console.error(`\n${kind}`);
  byKind[kind].forEach((p) => console.error(`  ${p.where}: ${p.msg}`));
});
console.error(`\n${problems.length} problem${problems.length === 1 ? '' : 's'}.`);
process.exit(1);
