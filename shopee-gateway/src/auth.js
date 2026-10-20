"use strict";
// Autenticação Render → Gateway por HMAC-SHA256.
//
// Headers:
//   X-VF-Timestamp  segundos Unix (inteiro)
//   X-VF-Nonce      16–128 chars [A-Za-z0-9_-], único por requisição
//   X-VF-Signature  hex minúsculo de HMAC-SHA256(secret, canonical)
//
// canonical = METHOD \n PATH \n TIMESTAMP \n NONCE \n hex(SHA256(body cru))
// METHOD/PATH são os da requisição AO GATEWAY (ex.: POST /forward), não os da
// Shopee — esses ficam dentro do corpo e já estão cobertos pelo hash.
//
// Ordem da verificação: formato → janela do timestamp → assinatura → nonce.
// O nonce só é gravado depois da assinatura válida, para que requisições não
// autenticadas não consigam encher a cache.

const crypto = require("crypto");
const { gatewayError } = require("./errors");

const NONCE_RE = /^[A-Za-z0-9_-]{16,128}$/;
const TS_RE = /^\d{1,12}$/;
const SIG_RE = /^[0-9a-f]{64}$/;

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf || Buffer.alloc(0)).digest("hex");
}

function canonicalString({ method, path, timestamp, nonce, body }) {
  return [String(method).toUpperCase(), path, String(timestamp), nonce, sha256Hex(body)].join("\n");
}

function sign(secret, parts) {
  return crypto.createHmac("sha256", secret).update(canonicalString(parts)).digest("hex");
}

// Cache de nonce em memória com TTL. Válida para UMA instância; com várias
// instâncias o replay entre elas exige armazenamento compartilhado.
// Cheia → falha fechada (NONCE_CACHE_FULL): despejar nonces vivos reabriria replay.
function createNonceCache({ ttlMs, maxEntries, now = Date.now }) {
  const seen = new Map(); // nonce → expiraEm (ms)

  function purge() {
    const t = now();
    for (const [n, exp] of seen) if (exp <= t) seen.delete(n);
  }

  return {
    has(nonce) {
      const exp = seen.get(nonce);
      return exp !== undefined && exp > now();
    },
    add(nonce) {
      if (seen.size >= maxEntries) purge();
      if (seen.size >= maxEntries) throw gatewayError("NONCE_CACHE_FULL");
      seen.set(nonce, now() + ttlMs);
    },
    get size() {
      return seen.size;
    },
  };
}

function createVerifier({ secret, windowSeconds, maxNonces, now = Date.now }) {
  // TTL cobre o pior caso: timestamp no limite do passado até o limite do futuro.
  const nonces = createNonceCache({ ttlMs: windowSeconds * 2 * 1000, maxEntries: maxNonces, now });

  return function verify({ method, path, headers, body }) {
    const timestamp = headers["x-vf-timestamp"];
    const nonce = headers["x-vf-nonce"];
    const signature = headers["x-vf-signature"];
    if (!timestamp || !nonce || !signature) throw gatewayError("AUTH_MISSING");
    if (typeof timestamp !== "string" || typeof nonce !== "string" || typeof signature !== "string") {
      throw gatewayError("AUTH_INVALID");
    }
    if (!TS_RE.test(timestamp) || !NONCE_RE.test(nonce) || !SIG_RE.test(signature)) throw gatewayError("AUTH_INVALID");

    const skew = Math.abs(Math.floor(now() / 1000) - Number(timestamp));
    if (skew > windowSeconds) throw gatewayError("TIMESTAMP_EXPIRED");

    const expected = Buffer.from(sign(secret, { method, path, timestamp, nonce, body }), "hex");
    const given = Buffer.from(signature, "hex");
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
      throw gatewayError("AUTH_INVALID");
    }

    if (nonces.has(nonce)) throw gatewayError("NONCE_REPLAY");
    nonces.add(nonce);
  };
}

module.exports = { canonicalString, sign, sha256Hex, createNonceCache, createVerifier };
