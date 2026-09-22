// Per-route <head> for the single-page storefront.
//
// Every storefront address — /, /product, /quiz, /certs … — is served from
// the one index.html (the rewrite in vercel.json), so without this Google
// saw one page with one title, however many routes the sitemap listed. This
// runs at the edge on exactly those routes, fetches the static page, and
// swaps in the title, description, canonical and social tags that belong to
// the route before the HTML reaches the browser or the crawler.
//
// ROUTES is mirrored by HB_ROUTE_META in index.html, which keeps the tab
// title in step as the app navigates without a page load. tools/check-claims
// fails when the two drift.
//
// Any failure — fetch, parse, anything — falls through to the untouched
// page. A missing title is a worse day for search than an outage is for the
// customer, but not by enough to risk the outage.

export const config = {
  matcher: ['/', '/product', '/shop', '/quiz', '/dosing', '/certs', '/about', '/contact', '/cart', '/checkout', '/google497e0b14e9539348.html']
};

// Google Search Console's ownership file. It must answer at exactly this
// address with a 200, and cleanUrls would otherwise 308 it to the
// extensionless path, which the verifier treats as a miss. Answered here,
// ahead of routing, so the redirect never happens. The same file is also
// committed at the repo root.
const GOOGLE_VERIFY = { path: '/google497e0b14e9539348.html', body: 'google-site-verification: google497e0b14e9539348.html' };

const SITE = 'https://www.happybeanie.com';

// What a shared link shows in Messages, iMessage and social apps. This is
// the og:title / og:description pair, kept apart from the search title so
// the two can each say what suits their reader: Google gets the query, a
// friend gets the line Jon wrote. Every route shares this one preview.
const SHARE = {
  title: 'The Anti-Aging Chew for Dogs & Cats · Free Shipping',
  description: 'Peptide-infused daily care for dogs and cats. The next chapter of pet longevity starts here.'
};

const ROUTES = {
  home: {
    title: 'Happy Beanie — Anti-Aging Pet Supplement for Dogs & Cats',
    description: 'Peptide-infused daily chews for dogs and cats. Anti-aging pet supplement formulated in Scottsdale, AZ, third-party tested lot by lot, 30-day refund window.'
  },
  product: {
    title: 'Anti-Aging Supplement for Dogs and Cats | Happy Beanie',
    description: 'A once-a-day anti-aging chew for dogs and cats: bioactive peptides, functional mushrooms, omega-3s and whole foods, dosed by weight. Every lot third-party tested.'
  },
  shop: {
    title: 'Shop Happy Beanie — Dog and Cat Anti-Aging Chews',
    description: 'Two formulations, one for dogs and one for cats. Pick your bean and see the formula, the dose and the studies behind each ingredient.'
  },
  quiz: {
    title: 'Is Happy Beanie Right for Your Pet? Eligibility Screener',
    description: 'Eight questions checked against every ingredient in the formula. Two minutes, and it tells you plainly whether Happy Beanie is a fit for your dog or cat.'
  },
  dosing: {
    title: 'Dosing Calculator — The Right Dose for Your Pet | Happy Beanie',
    description: 'How many chews a day for your dog or cat, by weight, and how long a box lasts.'
  },
  certs: {
    title: 'Certificates of Analysis — Every Lot Tested | Happy Beanie',
    description: 'Third-party lab results for every Happy Beanie lot: identity, potency, heavy metals and microbes, published as they come in.'
  },
  about: {
    title: 'About Happy Beanie — Peptide Care from Scottsdale, AZ',
    description: 'Who makes Happy Beanie, why it exists, and the people behind the pet supplement formulated and tested in Scottsdale, Arizona.'
  },
  contact: {
    title: 'Contact Happy Beanie',
    description: 'Talk to the people who make Happy Beanie. Questions about the formula, an order, or whether it is right for your pet.'
  },
  cart: { title: 'Your cart | Happy Beanie', description: '', noindex: true },
  checkout: { title: 'Checkout | Happy Beanie', description: '', noindex: true }
};

// Each storefront page lives in its own top-level <sc-if> wrapper in the
// file. A route serves only its own wrapper: a tool fetching /product then
// reads the product page and nothing else, which is also what a visitor
// sees. The app, told which page it was served (the hb-page meta), makes a
// full navigation to any other page instead of switching in place.
const PAGE_WRAPPERS = {
  home: 'isHome', shop: 'isShop', product: 'isProduct', about: 'isAbout', contact: 'isContact',
  dosing: 'isDosing', certs: 'isCerts', quiz: 'onQuizPage', cart: 'isCart', checkout: 'isCheckout'
};

function keepOnlyPage(html, key) {
  const mine = PAGE_WRAPPERS[key];
  if (!mine || html.indexOf('<sc-if value="{{ ' + mine + ' }}"') === -1) return html;
  let out = html;
  for (const k of Object.keys(PAGE_WRAPPERS)) {
    if (k === key) continue;
    const re = new RegExp('\\n  <sc-if value="\\{\\{ ' + PAGE_WRAPPERS[k] + ' \\}\\}"[^>]*>[\\s\\S]*?\\n  </sc-if>\\n');
    out = out.replace(re, '\n');
  }
  return out;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Swaps the route's tags into the page. Each replacement is anchored to the
// exact tag index.html carries today; if a tag is missing the swap for it is
// skipped rather than guessed, and the page still goes out.
export function swapHead(html, key) {
  const meta = ROUTES[key];
  if (!meta) return html;
  const url = key === 'home' ? SITE + '/' : SITE + '/' + key;
  const title = esc(meta.title);
  const desc = esc(meta.description);

  let out = html;
  out = out.replace(/<title>[^<]*<\/title>/, '<title>' + title + '</title>' +
    '\n<link rel="canonical" href="' + url + '">' +
    '\n<meta name="hb-page" content="' + key + '">' +
    (meta.noindex ? '\n<meta name="robots" content="noindex, follow">' : ''));
  if (meta.description) {
    out = out.replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="' + desc + '">');
  }
  out = out.replace(/<meta property="og:title" content="[^"]*">/, '<meta property="og:title" content="' + esc(SHARE.title) + '">');
  out = out.replace(/<meta property="og:description" content="[^"]*">/, '<meta property="og:description" content="' + esc(SHARE.description) + '">');
  out = out.replace(/<meta property="og:url" content="[^"]*">/, '<meta property="og:url" content="' + url + '">');
  if (key !== 'product') out = dropProductNodes(out);
  out = keepOnlyPage(out, key);
  return out;
}

// The static JSON-LD carries both Product entries so that anything reading
// the raw file sees the formulas. Google, though, expects product markup
// only on the page about that product, and reports it on every other route
// as a product with missing fields. Off the product page the graph keeps
// the Organization and WebSite nodes and drops the Products. Anything odd
// in the block — no block, unparseable — leaves the page untouched.
function dropProductNodes(html) {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!m) return html;
  let graph;
  try { graph = JSON.parse(m[1]); } catch (e) { return html; }
  if (!graph || !Array.isArray(graph['@graph'])) return html;
  graph['@graph'] = graph['@graph'].filter(function (n) { return n['@type'] !== 'Product'; });
  return html.replace(m[0], '<script type="application/ld+json">' + JSON.stringify(graph, null, 2) + '</script>');
}

export default async function middleware(req) {
  try {
    const url = new URL(req.url);
    if (url.pathname === GOOGLE_VERIFY.path) {
      return new Response(GOOGLE_VERIFY.body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'x-hb-verify': 'google' } });
    }
    // The page fetch below carries this flag so the middleware lets it pass
    // through to the static file instead of running again on its own fetch.
    if (url.searchParams.has('hb_raw')) return;
    const key = url.pathname.replace(/^\/+|\/+$/g, '') || 'home';
    if (!ROUTES[key]) return;

    const res = await fetch(url.origin + '/?hb_raw=1', {
      headers: { accept: 'text/html', 'user-agent': 'hb-route-head' }
    });
    if (!res.ok) return;
    const html = await res.text();
    if (html.indexOf('<title>') === -1) return;

    // A validator per route and file version, so a page a visitor already
    // has is answered with 304 rather than sent again.
    const tag = 'W/"' + key + '-' + String(res.headers.get('etag') || '').replace(/[^A-Za-z0-9]/g, '') + '"';
    const headers = {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=0, must-revalidate',
      'etag': tag,
      'vary': 'Accept-Encoding',
      'x-hb-route': key
    };
    if (req.headers.get('if-none-match') === tag) return new Response(null, { status: 304, headers: headers });

    return new Response(swapHead(html, key), { status: 200, headers: headers });
  } catch (e) {
    return;
  }
}
