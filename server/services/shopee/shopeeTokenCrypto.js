// Cifra dos tokens Shopee em repouso (shopee_grants). AES-256-GCM.
//
// - Chave SÓ em SHOPEE_TOKEN_ENCRYPTION_KEY (32 bytes, base64 ou hex). Nunca
//   no banco nem no Git. Sem chave válida, o LIVE fica "não configurado".
// - AAD amarra o texto cifrado ao contexto (ambiente/app/loja/tipo): um
//   access_token cifrado não decifra como refresh_token nem como de outra loja.
// - Formato: "v1.<iv>.<tag>.<ciphertext>" (base64url). IV de 12 bytes aleatório.
// Nunca loga texto claro, chave nem texto cifrado.
const crypto = require("crypto");

const VERSAO = "v1";

function lerChave(env = process.env) {
  const raw = String(env.SHOPEE_TOKEN_ENCRYPTION_KEY || "").trim();
  if (!raw) return null;
  let buf = null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) buf = Buffer.from(raw, "hex");
  else if (/^[A-Za-z0-9+/_-]{43}=?$/.test(raw)) buf = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  return buf && buf.length === 32 ? buf : null;
}

function aadDe({ ambiente, app, shopId, tipo }) {
  return Buffer.from(`shopee:${ambiente}:${app}:${shopId}:${tipo}`, "utf8");
}

function cifrar(textoClaro, contexto, chave) {
  if (!chave || chave.length !== 32) throw new Error("Chave de cifra Shopee ausente/inválida.");
  if (typeof textoClaro !== "string" || !textoClaro) throw new Error("Nada para cifrar.");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", chave, iv);
  cipher.setAAD(aadDe(contexto));
  const ct = Buffer.concat([cipher.update(textoClaro, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSAO, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

// Para os consumidores futuros (chamadas à API da loja). Lança em qualquer
// adulteração, chave errada ou contexto diferente do usado na cifra.
function decifrar(cifrado, contexto, chave) {
  if (!chave || chave.length !== 32) throw new Error("Chave de cifra Shopee ausente/inválida.");
  const partes = String(cifrado || "").split(".");
  if (partes.length !== 4 || partes[0] !== VERSAO) throw new Error("Token cifrado em formato desconhecido.");
  const [, iv, tag, ct] = partes.map((p, i) => (i === 0 ? p : Buffer.from(p, "base64url")));
  const decipher = crypto.createDecipheriv("aes-256-gcm", chave, iv);
  decipher.setAAD(aadDe(contexto));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

module.exports = { lerChave, cifrar, decifrar };
