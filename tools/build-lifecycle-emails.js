// Turns email-templates/lifecycle/*.html into api/_lib/lifecycle-email.js.
//
//   node tools/build-lifecycle-emails.js
//
// Three redesigned emails, each belonging to a different campaign — the
// handoff's campaigns.json is explicit that they are not a sequence. The HTML
// is the design source and is never edited by hand here. Embedding it in a
// module guarantees it ships inside the serverless bundle; reading the files
// from disk at runtime does not.
//
// What this fixes on the way through:
//
//   img/X                → an absolute https URL under /assets/email/lifecycle.
//                          A recipient cannot read a relative path. The
//                          handoff's README asks for exactly this.
//   happybeanie.com      → www.happybeanie.com, so no link spends a redirect.
//   {{ x | date: "…" }}  → {{ x }}. The Liquid filter is an ESP's job; here the
//                          sender formats the date and passes a finished
//                          string, so the filter would only be a second place
//                          for the format to disagree with itself.
//   the REPEAT row       → lifted out as its own template, so the cart email
//                          can render one row per line item.
//
// Everything else — colour, type, spacing, the mso conditionals, the responsive
// <style> block — is passed through untouched. Re-run after any template edit.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'email-templates/lifecycle');
const OUT = path.join(ROOT, 'api/_lib/lifecycle-email.js');
const SITE = 'https://www.happybeanie.com';
const ASSETS = SITE + '/assets/email/lifecycle/';

// subject/preheader come from campaigns.json so the manifest stays the single
// statement of what each email is, rather than being restated here.
const MANIFEST = JSON.parse(fs.readFileSync(path.join(SRC, 'campaigns.json'), 'utf8'));

const REPEAT_MARK = '<!-- REPEAT this row per line item -->';

// Plain-text alternates. A multipart send without one is a spam signal, and a
// tag-stripped HTML email reads like a broken web page, so these are written
// rather than derived.
const TEXT = {
  'screener-recheck': [
    'Your bean is old enough now.',
    '',
    'You screened a puppy and we said not yet — the formula is dosed for a',
    'developed pet. You asked us to check back, so here we are.',
    '',
    'Run the screener again: {{ screener_url }}',
    '',
    'New medication or diagnosis since we spoke? Take the ingredient list to',
    'your vet first.'
  ],
  'cart-recovery': [
    'Your box is still packed.',
    '',
    'Your cart is saved and checkout picks up exactly where you stopped.',
    '',
    '{{ items_text }}',
    'Subtotal: {{ cart_subtotal }}',
    '',
    'Finish checking out: {{ checkout_url }}'
  ],
  'welcome-code': [
    'Here is your 10% off.',
    '',
    'Your code: {{ discount_code }}',
    'It works on any box — either formula, subscription or one-time order.',
    'Yours alone, good for a single order, and it expires {{ discount_expires_at }}.',
    '',
    'Pick your box: {{ shop_url }}',
    '',
    'Not sure it suits your pet? The two-minute screener checks eight',
    'questions against every ingredient: {{ screener_url }}'
  ]
};

function transform(html) {
  let out = html;

  // Local paths a recipient cannot resolve become absolute.
  out = out.replace(/src="img\/([^"]+)"/g, 'src="' + ASSETS + '$1"');

  // Apex to www.
  out = out.replace(/https:\/\/happybeanie\.com/g, SITE);

  // Liquid date filters: the sender formats the value, so the placeholder is
  // just the name. Kept as a rewrite rather than an edit to the template so the
  // design file stays exactly as it was handed over.
  out = out.replace(/\{\{\s*([a-z_.]+)\s*\|[^}]*\}\}/g, '{{ $1 }}');

  // Normalise the remaining spacing so one regex can find them at send time.
  out = out.replace(/\{\{\s*([a-z_.]+)\s*\}\}/g, '{{$1}}');

  return out;
}

// Pulls the line-item <tr> out of the cart email and leaves a marker in its
// place. Rendering then joins one copy per item back in.
function splitRepeat(html) {
  const at = html.indexOf(REPEAT_MARK);
  if (at === -1) return { html: html, row: null };
  const start = html.indexOf('<tr', at);
  const end = html.indexOf('</tr>', start);
  if (start === -1 || end === -1) throw new Error('REPEAT marker is not followed by a row');
  const row = html.slice(start, end + 5);
  return { html: html.slice(0, at) + '__HB_ITEMS__' + html.slice(end + 5), row: row };
}

const parts = MANIFEST.emails.map(function (e) {
  const raw = fs.readFileSync(path.join(SRC, e.file), 'utf8');
  let html = transform(raw);

  if (/src="img\//.test(html)) throw new Error(e.file + ': a local image path survived the rewrite');
  if (/\|\s*date:/.test(html)) throw new Error(e.file + ': a Liquid filter survived the rewrite');

  const split = splitRepeat(html);
  if (e.id === 'cart-recovery' && !split.row) throw new Error(e.file + ': no line-item row to repeat');

  return '  ' + JSON.stringify(e.id) + ': {\n' +
    '    subject: ' + JSON.stringify(e.subject) + ',\n' +
    '    html: ' + JSON.stringify(split.html) + ',\n' +
    '    row: ' + JSON.stringify(split.row) + ',\n' +
    // The same space-stripping the HTML gets. Written by hand above with the
    // spaces in, because that is how a placeholder reads; one normaliser at the
    // end means the renderer only ever has one form to match.
    '    text: ' + JSON.stringify(TEXT[e.id].join('\n').replace(/\{\{\s*([a-z_.]+)\s*\}\}/g, '{{$1}}')) + '\n' +
    '  }';
});

const module_ = `// GENERATED by tools/build-lifecycle-emails.js — do not edit.
//
// The design source is email-templates/lifecycle/*.html. Edit those, re-run the
// generator, and commit both. Editing this file by hand means the next run
// silently throws your change away.
//
// Three emails, three different campaigns — see the campaigns.json beside the
// templates. They are not a sequence and must not be sent as one.
//
//   build(id, vars)      →  html
//   build.text(id, vars) →  the plain-text alternate
//   build.subject(id)    →  the subject line
//   build.IDS            →  the ids this module knows
//
// vars are the {{ placeholders }} the design carries, already formatted:
// a date arrives as "1 December 2026", money as "$89.00". For cart-recovery,
// vars.items is [{ title, variant, quantity, line_total }] and renders one row
// each.

const MAIL = {
${parts.join(',\n')}
};

const IDS = ${JSON.stringify(MANIFEST.emails.map(function (e) { return e.id; }))};

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function pick(id) {
  const m = MAIL[id];
  if (!m) throw new Error('unknown lifecycle email: ' + id);
  return m;
}

// Every value is escaped. These are addresses, pet names and product titles
// that came from a person, and one stray angle bracket would otherwise be
// markup in someone's inbox.
function fill(tpl, vars) {
  return tpl.replace(/\\{\\{([a-z_.]+)\\}\\}/g, function (whole, key) {
    const v = vars && Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : null;
    return v == null ? '' : esc(v);
  });
}

function build(id, vars) {
  const m = pick(id);
  let out = m.html;
  if (m.row) {
    const items = (vars && vars.items) || [];
    out = out.replace('__HB_ITEMS__', items.map(function (it) {
      return fill(m.row, {
        'item.title': it.title,
        'item.variant': it.variant,
        'item.quantity': it.quantity,
        'item.line_total': it.line_total
      });
    }).join(''));
  }
  return fill(out, vars);
}

build.text = function (id, vars) {
  const m = pick(id);
  let t = m.text;
  if (m.row) {
    const items = (vars && vars.items) || [];
    t = t.replace('{{items_text}}', items.map(function (it) {
      return '- ' + it.title + ' (' + it.variant + ') x' + it.quantity + '  ' + it.line_total;
    }).join('\\n'));
  }
  // The text alternate is not markup, so it takes the raw values.
  return t.replace(/\\{\\{([a-z_.]+)\\}\\}/g, function (whole, key) {
    const v = vars && Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : null;
    return v == null ? '' : String(v);
  });
};

build.subject = function (id) { return pick(id).subject; };
build.IDS = IDS.slice();

module.exports = build;
`;

fs.writeFileSync(OUT, module_);
console.log('wrote', path.relative(ROOT, OUT), '·', MANIFEST.emails.length, 'emails ·',
  Math.round(module_.length / 1024) + 'KB');
