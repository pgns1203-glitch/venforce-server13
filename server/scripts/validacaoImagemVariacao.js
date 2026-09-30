// server/scripts/validacaoImagemVariacao.js
// -----------------------------------------------------------------------------
// Validação real — imagem em anúncio COM VARIAÇÕES (docs/VALIDACAO_REAL_
// IMAGENS_ANUNCIOS_ML.md, seção 7A). SOMENTE LEITURA: faz GET /items/{id} no
// Mercado Livre e lê meli_anuncios. Nunca escreve no ML nem no banco.
//
//   antes     → salva o GET /items/{id} completo (pictures, variations,
//               attribute_combinations, picture_ids) num arquivo JSON.
//   comparar  → faz o GET de novo e compara com o arquivo salvo: grupo alvo
//               ganhou só a foto nova, outros grupos intactos, nenhuma foto
//               antiga sumiu, capa igual, variações/estoque/preço iguais.
//   snapshot  → mostra pictures_json/pictures_count/variations_count da linha
//               local (para o passo do sync).
//
// Uso:
//   node server/scripts/validacaoImagemVariacao.js antes    --clienteSlug=<s> --itemId=<MLB> --arquivo=<f.json>
//   node server/scripts/validacaoImagemVariacao.js comparar --clienteSlug=<s> --itemId=<MLB> --arquivo=<f.json> --atributo=COLOR --valor=<value_name>
//   node server/scripts/validacaoImagemVariacao.js snapshot --clienteSlug=<s> --itemId=<MLB>
// -----------------------------------------------------------------------------

const fs = require("fs");

function args() {
  const out = { _: [] };
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2]; else out._.push(a);
  }
  return out;
}

const idsDe = (v) => (Array.isArray(v && v.picture_ids) ? v.picture_ids : []).map(String);
const valorDe = (v, atributo) => {
  const ac = (v.attribute_combinations || []).find((x) => String(x.id) === atributo);
  return ac ? String(ac.value_name) : null;
};

// Pura: recebe os dois GETs e devolve os achados. Exportada para teste.
function compararItens(antes, depois, atributo, valor) {
  const achados = [];
  const falhas = [];
  const fotosAntes = (antes.pictures || []).map((p) => String(p.id));
  const fotosDepois = (depois.pictures || []).map((p) => String(p.id));
  const novas = fotosDepois.filter((id) => !fotosAntes.includes(id));
  const sumiram = fotosAntes.filter((id) => !fotosDepois.includes(id));

  achados.push(`pictures: ${fotosAntes.length} → ${fotosDepois.length}; novas: ${novas.join(", ") || "-"}`);
  if (novas.length !== 1) falhas.push(`esperada exatamente 1 foto nova na galeria, vieram ${novas.length}`);
  if (sumiram.length) falhas.push(`fotos antigas sumiram da galeria: ${sumiram.join(", ")}`);
  if (fotosAntes[0] !== fotosDepois[0]) falhas.push(`capa mudou: ${fotosAntes[0]} → ${fotosDepois[0]}`);
  const nova = novas[0];

  const vDepois = Object.fromEntries((depois.variations || []).map((v) => [String(v.id), v]));
  for (const v of antes.variations || []) {
    const id = String(v.id);
    const d = vDepois[id];
    const val = valorDe(v, atributo);
    if (!d) { falhas.push(`variação ${id} (${val}) SUMIU`); continue; }
    const a = idsDe(v);
    const b = idsDe(d);
    const noGrupo = val === valor;
    const esperado = noGrupo && nova ? a.concat([nova]) : a;
    const igual = JSON.stringify(b) === JSON.stringify(esperado);
    achados.push(`variação ${id} [${val}${noGrupo ? " · ALVO" : ""}]: ${a.join(",")} → ${b.join(",")} ${igual ? "OK" : "DIVERGENTE"}`);
    if (!igual) falhas.push(`variação ${id} (${val}): esperado ${esperado.join(",")}, veio ${b.join(",")}`);
    for (const campo of ["price", "available_quantity"]) {
      if (v[campo] !== d[campo]) falhas.push(`variação ${id}: ${campo} mudou ${v[campo]} → ${d[campo]}`);
    }
    if (JSON.stringify(v.attribute_combinations) !== JSON.stringify(d.attribute_combinations)) {
      falhas.push(`variação ${id}: attribute_combinations mudou`);
    }
  }
  if ((depois.variations || []).length !== (antes.variations || []).length) {
    falhas.push(`quantidade de variações: ${(antes.variations || []).length} → ${(depois.variations || []).length}`);
  }
  return { ok: falhas.length === 0, novaFoto: nova || null, achados, falhas };
}

async function main() {
  const a = args();
  const modo = a._[0];
  if (!["antes", "comparar", "snapshot"].includes(modo) || !a.clienteSlug || !a.itemId) {
    console.error("Uso: ver cabeçalho do arquivo.");
    process.exit(2);
  }
  // eslint-disable-next-line global-require
  const anunciosService = require("../services/meliAnuncios/meliAnunciosService");
  // eslint-disable-next-line global-require
  const { mlFetch } = require("../utils/mlClient");

  const cliente = await anunciosService.resolverCliente(a.clienteSlug);
  if (!cliente) throw new Error("cliente não encontrado");
  const linha = await anunciosService.obterAnuncio(cliente.id, a.itemId);
  if (!linha) throw new Error("anúncio não está no snapshot local");

  if (modo === "snapshot") {
    console.log(JSON.stringify({
      item_id: linha.item_id, pictures_count: linha.pictures_count,
      variations_count: linha.variations_count, pictures_json: linha.pictures_json,
    }, null, 2));
    return;
  }

  const resp = await mlFetch(cliente.id, `/items/${encodeURIComponent(a.itemId)}`, { mlUserId: linha.ml_user_id || null });
  if (!resp || !resp.ok) throw new Error(`GET /items falhou: HTTP ${resp && resp.status} ${JSON.stringify(resp && resp.data).slice(0, 500)}`);
  const item = resp.data;

  if (modo === "antes") {
    if (!a.arquivo) throw new Error("informe --arquivo");
    if (fs.existsSync(a.arquivo)) throw new Error("arquivo já existe — não sobrescrevo o 'antes'");
    fs.writeFileSync(a.arquivo, JSON.stringify(item, null, 2));
    console.log(`salvo: ${a.arquivo} — ${(item.pictures || []).length} fotos, ${(item.variations || []).length} variações`);
    for (const v of item.variations || []) {
      const combo = (v.attribute_combinations || []).map((x) => `${x.id}=${x.value_name}`).join(" ");
      console.log(`  ${v.id}  ${combo}  picture_ids=${idsDe(v).join(",")}`);
    }
    return;
  }

  if (!a.arquivo || !a.atributo || !a.valor) throw new Error("informe --arquivo, --atributo e --valor");
  const antes = JSON.parse(fs.readFileSync(a.arquivo, "utf8"));
  const r = compararItens(antes, item, a.atributo, a.valor);
  const saida = a.arquivo.replace(/\.json$/, "") + ".depois.json";
  if (!fs.existsSync(saida)) fs.writeFileSync(saida, JSON.stringify(item, null, 2));
  r.achados.forEach((l) => console.log("  " + l));
  if (r.ok) console.log("\nRESULTADO: OK — só o grupo alvo mudou, nada foi perdido.");
  else { console.log("\nRESULTADO: FALHA"); r.falhas.forEach((l) => console.log("  ✗ " + l)); process.exitCode = 1; }
}

if (require.main === module) {
  main().catch((err) => { console.error(err.message); process.exit(1); }).finally(() => {
    try { require("../config/database").end(); } catch (_) { /* sem pool */ }
  });
}

module.exports = { compararItens };
