// Shared helpers for the custom customer-account portal.
//
// Auth model: Shopify Customer Account API, OAuth 2.0 confidential client with
// PKCE. Tokens never reach the browser — they live in an AES-256-GCM encrypted,
// httpOnly cookie, and every GraphQL call is proxied server-side.
//
// Required environment variables:
//   SHOPIFY_CUSTOMER_CLIENT_ID      - from Headless channel > Customer Account API
//   SHOPIFY_CUSTOMER_CLIENT_SECRET  - same screen (Confidential client)
//   COOKIE_SECRET                   - any long random string (32+ chars)
// Optional:
//   SHOPIFY_STORE_DOMAIN            - default pxv2u2-kc.myshopify.com
//   SHOPIFY_SHOP_ID                 - default 61033185344
//   SHOPIFY_CUSTOMER_REDIRECT_URI   - default https://happy-beanie.vercel.app/api/auth/callback

const crypto = require('crypto');

const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || 'pxv2u2-kc.myshopify.com';
const SHOP_ID = process.env.SHOPIFY_SHOP_ID || '61033185344';
const REDIRECT_URI = process.env.SHOPIFY_CUSTOMER_REDIRECT_URI || 'https://happy-beanie.vercel.app/api/auth/callback';
const SESSION_COOKIE = 'hb_session';
const OAUTH_COOKIE = 'hb_oauth';

function config() {
  return {
    clientId: process.env.SHOPIFY_CUSTOMER_CLIENT_ID || '',
    clientSecret: process.env.SHOPIFY_CUSTOMER_CLIENT_SECRET || '',
    cookieSecret: process.env.COOKIE_SECRET || '',
    redirectUri: REDIRECT_URI
  };
}

function isConfigured() {
  const c = config();
  return Boolean(c.clientId && c.clientSecret && c.cookieSecret);
}

// ---- endpoint discovery (cached per lambda instance) ----

let discoveryCache = null;

async function discover() {
  if (discoveryCache) return discoveryCache;
  const fallback = {
    authorization_endpoint: 'https://shopify.com/authentication/' + SHOP_ID + '/oauth/authorize',
    token_endpoint: 'https://shopify.com/authentication/' + SHOP_ID + '/oauth/token',
    end_session_endpoint: 'https://shopify.com/authentication/' + SHOP_ID + '/logout',
    graphql_api: 'https://shopify.com/' + SHOP_ID + '/account/customer/api/2025-07/graphql'
  };
  try {
    const [oidcRes, capiRes] = await Promise.all([
      fetch('https://' + STORE_DOMAIN + '/.well-known/openid-configuration'),
      fetch('https://' + STORE_DOMAIN + '/.well-known/customer-account-api')
    ]);
    const oidc = oidcRes.ok ? await oidcRes.json() : {};
    const capi = capiRes.ok ? await capiRes.json() : {};
    discoveryCache = {
      authorization_endpoint: oidc.authorization_endpoint || fallback.authorization_endpoint,
      token_endpoint: oidc.token_endpoint || fallback.token_endpoint,
      end_session_endpoint: oidc.end_session_endpoint || fallback.end_session_endpoint,
      graphql_api: (capi.graphql_api || (capi.api && capi.api.graphql_api)) || fallback.graphql_api
    };
  } catch (e) {
    discoveryCache = fallback;
  }
  return discoveryCache;
}

// ---- crypto for cookie payloads ----

function key() {
  return crypto.createHash('sha256').update(config().cookieSecret).digest();
}

function encrypt(obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, data]).toString('base64url');
}

function decrypt(str) {
  try {
    const buf = Buffer.from(String(str), 'base64url');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    return JSON.parse(out);
  } catch (e) {
    return null;
  }
}

// ---- cookie plumbing ----

function parseCookies(req) {
  const header = (req.headers && req.headers.cookie) || '';
  const out = {};
  header.split(';').forEach(function (part) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  });
  return out;
}

function cookieString(name, value, maxAgeSeconds) {
  const bits = [
    name + '=' + value,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax'
  ];
  if (maxAgeSeconds === 0) bits.push('Max-Age=0');
  else if (maxAgeSeconds) bits.push('Max-Age=' + maxAgeSeconds);
  return bits.join('; ');
}

function readSession(req) {
  const cookies = parseCookies(req);
  if (!cookies[SESSION_COOKIE]) return null;
  return decrypt(cookies[SESSION_COOKIE]);
}

function sessionCookie(session) {
  // ~30 days: refresh tokens keep the session alive between visits.
  return cookieString(SESSION_COOKIE, encrypt(session), 60 * 60 * 24 * 30);
}

function clearSessionCookies() {
  return [cookieString(SESSION_COOKIE, '', 0), cookieString(OAUTH_COOKIE, '', 0)];
}

// ---- oauth steps ----

function b64url(buf) {
  return buf.toString('base64url');
}

function buildAuthRequest() {
  const state = b64url(crypto.randomBytes(16));
  const nonce = b64url(crypto.randomBytes(16));
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { state: state, nonce: nonce, verifier: verifier, challenge: challenge };
}

function oauthCookie(payload) {
  return cookieString(OAUTH_COOKIE, encrypt(payload), 600);
}

function readOauthCookie(req) {
  const cookies = parseCookies(req);
  if (!cookies[OAUTH_COOKIE]) return null;
  return decrypt(cookies[OAUTH_COOKIE]);
}

// The redirect URI must match the one used in the authorize request exactly, so
// callers derive it per-request (custom domain vs vercel.app) and pass it through.
function redirectUriFor(req) {
  if (process.env.SHOPIFY_CUSTOMER_REDIRECT_URI) return process.env.SHOPIFY_CUSTOMER_REDIRECT_URI;
  const host = (req.headers && req.headers.host) || 'www.happybeanie.com';
  return 'https://' + host + '/api/auth/callback';
}

async function exchangeCode(code, verifier, redirectUri) {
  const c = config();
  const d = await discover();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: c.clientId,
    client_secret: c.clientSecret,
    redirect_uri: redirectUri || c.redirectUri,
    code: code,
    code_verifier: verifier
  });
  const res = await fetch(d.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  const json = await res.json().catch(function () { return {}; });
  if (!res.ok || !json.access_token) {
    throw new Error('token_exchange_failed: ' + (json.error_description || json.error || res.status));
  }
  return json;
}

async function refreshTokens(refreshToken) {
  const c = config();
  const d = await discover();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: c.clientId,
    client_secret: c.clientSecret,
    refresh_token: refreshToken
  });
  const res = await fetch(d.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  const json = await res.json().catch(function () { return {}; });
  if (!res.ok || !json.access_token) return null;
  return json;
}

function sessionFromTokens(tokens, previous) {
  return {
    at: tokens.access_token,
    rt: tokens.refresh_token || (previous && previous.rt) || null,
    idt: tokens.id_token || (previous && previous.idt) || null,
    exp: Date.now() + Math.max(60, (tokens.expires_in || 3600) - 60) * 1000
  };
}

// Returns { session, setCookie } with a fresh access token, or null if signed out.
async function ensureFreshSession(req) {
  let session = readSession(req);
  if (!session || !session.at) return null;
  if (Date.now() < (session.exp || 0)) return { session: session, setCookie: null };
  if (!session.rt) return null;
  const refreshed = await refreshTokens(session.rt);
  if (!refreshed) return null;
  const next = sessionFromTokens(refreshed, session);
  return { session: next, setCookie: sessionCookie(next) };
}

async function customerGraphql(accessToken, query, variables) {
  const d = await discover();
  async function call(authValue) {
    const res = await fetch(d.graphql_api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': authValue },
      body: JSON.stringify({ query: query, variables: variables || {} })
    });
    const json = await res.json().catch(function () { return {}; });
    return { status: res.status, json: json };
  }
  // Header format has varied across API versions; try raw token, then Bearer.
  let out = await call(accessToken);
  if (out.status === 401 || out.status === 403) {
    out = await call('Bearer ' + accessToken);
  }
  return out;
}

module.exports = {
  SESSION_COOKIE: SESSION_COOKIE,
  config: config,
  isConfigured: isConfigured,
  discover: discover,
  buildAuthRequest: buildAuthRequest,
  redirectUriFor: redirectUriFor,
  oauthCookie: oauthCookie,
  readOauthCookie: readOauthCookie,
  exchangeCode: exchangeCode,
  sessionFromTokens: sessionFromTokens,
  sessionCookie: sessionCookie,
  clearSessionCookies: clearSessionCookies,
  readSession: readSession,
  ensureFreshSession: ensureFreshSession,
  customerGraphql: customerGraphql,
  cookieString: cookieString
};
