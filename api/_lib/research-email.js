// The research pack — what "Send me the research" sends. Six published
// studies, three per species, in plain English with a link to every paper.
//
// The studies are the same six the product page's evidence pile stands on,
// restated here so the email keeps its promise even if the page copy moves.
// None of them were funded by Happy Beanie, and none of them tested our chew
// — the email says both, because that candour is the whole pitch.
//
// build(t) → html   with t = { unsubUrl }
// build.text(t)     plain-text alternate
// build.subject()   subject line
//
// Same design family as the lifecycle set: 600px table, dark header bar with
// the wordmark, 3px gold rule, one gold pill CTA.

const SITE = 'https://www.happybeanie.com';
// The html is the DESIGNED email from the Setup_30 handoff, embedded by
// tools/build-research-email.js — edit email-templates/research/ and re-run
// the generator, never the strings here. This module personalises the
// unsubscribe marker and keeps the subject and text alternate; STUDIES
// below feeds the text version and stays in step with the design's cards.
const designed = require('./research-designed.js');

const SUBJECT = "Here's the research you asked for";

// Kept in step with the evidence pile in index.html.
const STUDIES = [
  { sp: 'Dogs', active: 'Mushroom blend', cite: 'Brown & Reetz · IVC Journal',
    result: 'Dogs given the mushroom compound alone — no chemotherapy — survived longer and their cancer spread more slowly, with the highest dose performing best.',
    url: 'https://ivcjournal.com/single-agent-polysaccharopeptide-delays-metastases-and-improves-survival-in-naturally-occurring-hemangiosarcoma/' },
  { sp: 'Dogs', active: 'Elk velvet antler', cite: 'Research in Veterinary Science · 2014',
    result: 'Dogs on elk velvet antler put more weight on their affected limbs and moved better than dogs on placebo, with no adverse effects across the trial.',
    url: 'https://www.sciencedirect.com/science/article/abs/pii/S0034528814002483' },
  { sp: 'Dogs', active: 'Collagen peptides', cite: 'PubMed Central · PMC6789547',
    result: 'Collagen peptides taken by mouth survived digestion, reached connective tissue, and measurably shifted cells toward rebuilding it rather than breaking it down.',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6789547/' },
  { sp: 'Cats', active: 'Taurine', cite: 'Pion et al. · Science · 1987',
    result: 'Cats in heart failure from low taurine recovered normal heart function once taurine was restored — the damage reversed, and taurine became mandatory in cat food.',
    url: 'https://www.science.org/doi/10.1126/science.3616607' },
  { sp: 'Cats', active: 'Green-lipped mussel', cite: 'Lascelles et al. · 2010',
    result: 'Cats fed green-lipped mussel and omega-3s were measurably more active than cats on the control diet, tracked by device rather than owner opinion.',
    url: 'https://www.researchgate.net/publication/42588045_Evaluation_of_a_Therapeutic_Diet_for_Feline_Degenerative_Joint_Disease' },
  { sp: 'Cats', active: 'Type II collagen', cite: 'ResearchGate · 381552574',
    result: 'Cats with degenerative joint disease improved in mobility and daily activity on undenatured type II collagen, confirming the mechanism works in cats and not only dogs.',
    url: 'https://www.researchgate.net/publication/381552574_UNDENATURED_TYPE_II_COLLAGEN_IN_CATS_WITH_DEGENERATIVE_JOINT_DISEASE' }
];

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function build(t) {
  const unsub = esc((t && t.unsubUrl) || SITE + '/api/unsubscribe');
  return designed.html.split(designed.UNSUB_MARK).join(unsub);
}

build.text = function (t) {
  const lines = [
    'Here is the research you asked for.',
    '',
    'Six published studies - three on dogs, three on cats - behind what goes',
    'into Happy Beanie. We funded none of them, and none of them tested our',
    'chew. The evidence stands on its own.',
    ''
  ];
  STUDIES.forEach(function (s) {
    lines.push(s.sp.toUpperCase() + ' / ' + s.active);
    lines.push(s.result);
    lines.push(s.cite + ' - ' + s.url);
    lines.push('');
  });
  lines.push('See the full evidence pile: ' + SITE + '/product');
  if (t && t.unsubUrl) lines.push('', 'Unsubscribe: ' + t.unsubUrl);
  return lines.join('\n');
};

build.subject = function () { return SUBJECT; };

module.exports = build;
