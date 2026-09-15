#!/usr/bin/env node
// The product page carries its formula twice: once as insideList, the array the
// ingredient grid is built from, and once as the plain-text block in #inside
// that readers without JavaScript actually see. Two copies of the same facts
// drift, and this one drifts silently — the visible grid would keep showing the
// right thing while every crawler, screen reader and AI assistant read a stale
// list. So: parse both out of the source and require them to agree exactly.
//
// Checks the JSON-LD ingredient entries against the same array while it is
// here, since they are a third copy with the same problem.
//
// Exits non-zero and prints the mismatch. No dependencies, reads the source
// rather than a rendered page, so it runs anywhere.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(SRC, 'utf8');

const fail = [];

// ---- insideList: the array the grid renders from ------------------------
// Both species live in one ternary, cat first. Slice from the property to the
// closing bracket of the second literal rather than trying to match the whole
// thing with one expression.
function insideList() {
  const at = html.indexOf('insideList: (this.state.sp === \'cat\' ?');
  if (at === -1) return null;
  const end = html.indexOf(']).map(', at);
  if (end === -1) return null;
  const body = html.slice(at, end);
  const split = body.indexOf('] : [');
  if (split === -1) return null;
  const read = (chunk) => {
    const out = [];
    const re = /\{\s*name:\s*'((?:[^'\\]|\\.)*)',\s*sub:\s*'((?:[^'\\]|\\.)*)',\s*benefit:\s*'((?:[^'\\]|\\.)*)'\s*\}/g;
    let m;
    while ((m = re.exec(chunk))) out.push({ name: m[1], sub: m[2], benefit: m[3] });
    return out;
  };
  return { cat: read(body.slice(0, split)), dog: read(body.slice(split)) };
}

// ---- the plain-text block -----------------------------------------------
function plainText() {
  const at = html.indexOf('data-hb-formula');
  if (at === -1) return null;
  const end = html.indexOf('</div>', at);
  const body = html.slice(at, end);
  const out = {};
  // One <h3> then one <ul> per species, in document order.
  const secRe = /<h3>[^<]*?\b(dog|cat)\b[^<]*<\/h3>\s*<ul>([\s\S]*?)<\/ul>/gi;
  let m;
  while ((m = secRe.exec(body))) {
    const items = [];
    const liRe = /<li>([\s\S]*?)<\/li>/g;
    let li;
    while ((li = liRe.exec(m[2]))) items.push(li[1].trim().replace(/&amp;/g, '&'));
    out[m[1].toLowerCase()] = items;
  }
  return out;
}

// ---- JSON-LD ------------------------------------------------------------
function jsonLd() {
  const out = [];
  const re = /"propertyID":\s*"activeIngredient",\s*"position":\s*\d+,\s*"name":\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

// The one place the two shapes are reconciled: an array row renders as
// "Name (sub) — benefit", and the sub is dropped when it is empty.
function render(row) {
  return row.name + (row.sub ? ' (' + row.sub + ')' : '') + ' — ' + row.benefit;
}
function ldName(row) {
  return row.name + (row.sub ? ' (' + row.sub + ')' : '');
}

const arr = insideList();
const txt = plainText();
const ld = jsonLd();

if (!arr) fail.push('could not find insideList in index.html');
if (!txt) fail.push('could not find the [data-hb-formula] plain-text block in index.html');

if (arr && txt) {
  for (const sp of ['dog', 'cat']) {
    const want = (arr[sp] || []).map(render);
    const got = txt[sp] || [];
    if (!want.length) { fail.push(`${sp}: insideList is empty`); continue; }
    if (want.length !== got.length) {
      fail.push(`${sp}: insideList has ${want.length} ingredients, the plain-text block has ${got.length}`);
    }
    const n = Math.max(want.length, got.length);
    for (let i = 0; i < n; i++) {
      if (want[i] !== got[i]) {
        fail.push(`${sp} #${i + 1}:\n    insideList: ${want[i] || '(missing)'}\n    plain text: ${got[i] || '(missing)'}`);
      }
    }
  }

  // JSON-LD lists dog then cat, names only.
  const wantLd = [...arr.dog.map(ldName), ...arr.cat.map(ldName)];
  if (ld.length !== wantLd.length) {
    fail.push(`JSON-LD has ${ld.length} activeIngredient entries, insideList has ${wantLd.length}`);
  }
  for (let i = 0; i < Math.max(ld.length, wantLd.length); i++) {
    if (ld[i] !== wantLd[i]) {
      fail.push(`JSON-LD #${i + 1}:\n    insideList: ${wantLd[i] || '(missing)'}\n    JSON-LD:    ${ld[i] || '(missing)'}`);
    }
  }
}

if (fail.length) {
  console.error('check-formula: the product page states its formula in more than one place and they disagree.\n');
  fail.forEach(f => console.error('  - ' + f));
  console.error('\nFix the copy that is wrong; do not just silence this.');
  process.exit(1);
}
console.log(`check-formula: dog ${arr.dog.length}, cat ${arr.cat.length} — grid, plain text and JSON-LD all agree.`);
