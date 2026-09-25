// /api/account/pets — the signed-in customer's registered pets.
//
// GET                      → { ok, pets: [...] }
// PUT  { pets: [...] }     → replaces the list, returns what was saved
//
// Pets used to live only in the browser (localStorage), which meant they
// stayed on one device and vanished with the site data. This is the durable
// home (Jon, Sep 2026): the pets table in the site's Postgres, keyed to the
// Shopify customer id, so the record follows the person and the desk can
// read it. Identity always comes from the session cookie, never the body.
//
// Replace-the-list is the whole write API on purpose: the account page holds
// the list, edits it, and sends it back — same shape it kept locally — and
// the server diffs it against what it has. Rows not in the list are deleted.
//
// Everything is whitelisted. Breed and weight band are keys from the fixed
// lists below (the same lists the page renders), so nothing free-form ever
// lands in a column that gets counted later.
//
// Env: DATABASE_URL. The customer session comes from customer-auth.

const auth = require('../_lib/customer-auth.js');
const db = require('../_lib/analytics-db.js');

const ME = 'query Me { customer { id emailAddress { emailAddress } } }';

const MAX_PETS = 8;
const SPECIES = ['dog', 'cat'];
const BREEDS = {
  dog: ['Labrador Retriever', 'Golden Retriever', 'German Shepherd', 'French Bulldog', 'Poodle', 'Beagle', 'Dachshund', 'Border Collie', 'Boxer', 'Australian Shepherd', 'Chihuahua', 'Shih Tzu', 'Great Dane', 'Corgi', 'Mixed breed'],
  cat: ['Domestic Shorthair', 'Domestic Longhair', 'Maine Coon', 'Siamese', 'Ragdoll', 'British Shorthair', 'Bengal', 'Persian', 'Sphynx', 'Russian Blue', 'Abyssinian', 'Scottish Fold', 'Norwegian Forest', 'Mixed breed']
};
// Current bands only. A pet arriving on a retired band (the page migrates
// those before it saves) is stored with no band, which the page shows as
// "Not sure yet" rather than inventing a dose.
const BANDS = { dog: ['u30', '30-75', '75-120', 'o120'], cat: ['u5', '5-12', 'o12'] };

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (e) { return {}; }
}

function text(v, max) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
}

function clean(raw) {
  const p = (raw && typeof raw === 'object') ? raw : {};
  const species = SPECIES.indexOf(String(p.species)) !== -1 ? String(p.species) : null;
  const name = text(p.name, 32);
  if (!species || !name) return null;
  const breed = text(p.breed, 40);
  const band = text(p.weight, 12);
  return {
    id: text(p.id, 40).replace(/[^A-Za-z0-9_-]/g, '') || ('p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
    name: name,
    species: species,
    breed: BREEDS[species].indexOf(breed) !== -1 ? breed : '',
    weight: BANDS[species].indexOf(band) !== -1 ? band : ''
  };
}

function rowToPet(r) {
  return { id: r.pet_id, name: r.name, species: r.species, breed: r.breed || '', weight: r.weight_band || '' };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!auth.isConfigured()) {
    return res.status(503).json({ ok: false, error: 'not_configured' });
  }
  if (!db.isConfigured()) {
    return res.status(503).json({ ok: false, error: 'no_database' });
  }

  const fresh = await auth.ensureFreshSession(req);
  if (!fresh) {
    res.setHeader('Set-Cookie', auth.clearSessionCookies());
    return res.status(401).json({ ok: false, error: 'signed_out' });
  }
  if (fresh.setCookie) res.setHeader('Set-Cookie', fresh.setCookie);

  let customerId = null, email = null;
  try {
    const me = await auth.customerGraphql(fresh.session.at, ME);
    if (me.status === 401 || me.status === 403) {
      return res.status(401).json({ ok: false, error: 'signed_out' });
    }
    const c = me.json && me.json.data && me.json.data.customer;
    customerId = c && c.id;
    email = (c && c.emailAddress && c.emailAddress.emailAddress) ? String(c.emailAddress.emailAddress).toLowerCase() : null;
  } catch (err) {
    console.error('[account/pets] session lookup:', err && err.message);
  }
  if (!customerId) return res.status(401).json({ ok: false, error: 'signed_out' });

  const sql = db.sql();
  try {
    if (req.method === 'GET') {
      const rows = await db.withSchema(() => sql`
        select pet_id, name, species, breed, weight_band from pets
         where customer_id = ${customerId} order by created_at asc`);
      return res.status(200).json({ ok: true, pets: rows.map(rowToPet) });
    }

    if (req.method === 'PUT') {
      const raw = readBody(req).pets;
      if (!Array.isArray(raw)) return res.status(400).json({ ok: false, error: 'bad_request' });
      const seen = {};
      const pets = raw.slice(0, MAX_PETS).map(clean).filter(function (p) {
        if (!p || seen[p.id]) return false;
        seen[p.id] = true;
        return true;
      });
      const keep = pets.map(function (p) { return p.id; });
      await db.withSchema(async () => {
        // Rows the page no longer lists are gone: Remove on the page is the
        // only way a pet leaves the list, and it asks twice before it does.
        if (keep.length) await sql`delete from pets where customer_id = ${customerId} and not (pet_id = any(${keep}))`;
        else await sql`delete from pets where customer_id = ${customerId}`;
        for (const p of pets) {
          await sql`insert into pets (customer_id, pet_id, email, name, species, breed, weight_band)
                    values (${customerId}, ${p.id}, ${email}, ${p.name}, ${p.species}, ${p.breed}, ${p.weight})
                    on conflict (customer_id, pet_id) do update set
                      email = excluded.email, name = excluded.name, species = excluded.species,
                      breed = excluded.breed, weight_band = excluded.weight_band, updated_at = now()`;
        }
      });
      return res.status(200).json({ ok: true, pets: pets });
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  } catch (err) {
    console.error('[account/pets]', err && err.message);
    return res.status(502).json({ ok: false, error: 'database' });
  }
};
