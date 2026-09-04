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
const WORDMARK = SITE + '/assets/email/lifecycle/hb-wordmark.png';

const INK = '#17140F', PAPER = '#FAF8F1', PAGE = '#DED5C4', GOLD = '#F0C64B',
      BODY = '#4A4237', MUTED = '#8A7F6E', HAIR = '#E0D6C3', FOOT_BG = '#F2EEE3',
      GREEN = '#43684E';
const SANS = "'DM Sans', Arial, 'Helvetica Neue', Helvetica, sans-serif";
const MONO = "'DM Mono', 'Courier New', Courier, monospace";

const SUBJECT = 'The research, in plain English';

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
  const cta = SITE + '/product?utm_source=email&utm_medium=lifecycle&utm_campaign=research_pack';

  const rows = STUDIES.map(function (s) {
    return '<tr><td style="padding:0 40px 22px;">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ' + HAIR + '; border-radius:4px; background-color:#FFFDF7;">' +
      '<tr><td style="padding:16px 18px 17px;">' +
      '<p style="margin:0 0 7px; font-family:' + MONO + '; font-size:9.5px; letter-spacing:0.16em; text-transform:uppercase; color:' + GREEN + ';">' + esc(s.sp) + ' &middot; ' + esc(s.active) + '</p>' +
      '<p style="margin:0 0 10px; font-family:' + SANS + '; font-size:14.5px; line-height:23px; color:' + BODY + ';">' + esc(s.result) + '</p>' +
      '<a href="' + esc(s.url) + '" style="font-family:' + MONO + '; font-size:10px; letter-spacing:0.12em; text-transform:uppercase; color:' + INK + ';">' + esc(s.cite) + ' &rarr;</a>' +
      '</td></tr></table></td></tr>';
  }).join('');

  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="color-scheme" content="light"><title>' + SUBJECT + '</title></head>' +
    '<body style="margin:0; padding:0; width:100%; background-color:' + PAGE + ';">' +
    '<div style="display:none; font-size:1px; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden; color:' + PAGE + ';">Six published studies, none funded by us, decoded into two minutes of reading.</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:' + PAGE + ';"><tr><td align="center" style="padding:28px 12px;">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px; max-width:600px; background-color:' + PAPER + '; border-radius:4px; overflow:hidden;">' +

    '<tr><td style="background-color:' + INK + '; padding:22px 40px 19px; border-bottom:3px solid ' + GOLD + ';">' +
    '<img src="' + WORDMARK + '" width="159" height="26" alt="happy beanie" style="display:block; border:0;"></td></tr>' +

    '<tr><td style="padding:36px 40px 6px; font-family:' + MONO + '; font-size:10.5px; letter-spacing:0.2em; text-transform:uppercase; color:' + GREEN + ';">As requested</td></tr>' +
    '<tr><td style="padding:0 40px 14px; font-family:' + SANS + '; font-weight:bold; font-size:31px; line-height:36px; letter-spacing:-1px; color:' + INK + ';">The research, in plain English.</td></tr>' +
    '<tr><td style="padding:0 40px 22px; font-family:' + SANS + '; font-size:16px; line-height:26px; letter-spacing:-0.2px; color:' + BODY + ';">' +
    'Six published studies &mdash; three on dogs, three on cats &mdash; behind what goes into Happy Beanie. We funded none of them, and none of them tested our chew. That is exactly why they are worth your two minutes: the evidence stands on its own.</td></tr>' +

    rows +

    '<tr><td style="padding:6px 40px 30px;">' +
    '<a href="' + cta + '" style="display:inline-block; background-color:' + GOLD + '; color:' + INK + '; font-family:' + MONO + '; font-size:12.5px; letter-spacing:0.2em; text-transform:uppercase; text-decoration:none; padding:17px 30px; border-radius:999px;">See the full evidence pile &rarr;</a>' +
    '</td></tr>' +

    '<tr><td style="background-color:' + FOOT_BG + '; border-top:1px solid ' + HAIR + '; padding:22px 40px 26px;">' +
    '<p style="margin:0 0 8px; font-family:' + MONO + '; font-size:9.5px; letter-spacing:0.16em; text-transform:uppercase; color:' + MUTED + ';">Formulated fresh &middot; Scottsdale, AZ</p>' +
    '<p style="margin:0; font-family:' + SANS + '; font-size:12px; line-height:19px; color:' + MUTED + ';">You&rsquo;re getting this because you asked for the research at happybeanie.com.<br>' +
    '<a href="' + unsub + '" style="color:' + MUTED + ';">Unsubscribe</a> &middot; hello@happybeanie.com &middot; &copy; 2026 Happy Beanie &middot; 7180 E Main St, Scottsdale, AZ 85251</p>' +
    '</td></tr>' +

    '</table></td></tr></table></body></html>';
}

build.text = function (t) {
  const lines = [
    'The research, in plain English.',
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
