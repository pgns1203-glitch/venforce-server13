# Fotos por variação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the modal's photo section with a per-variation-group editor (add, delete, drag to reorder) whose changes stay in memory until one "Salvar no Mercado Livre" rebuilds and sends a complete `PUT /items/{id}`.

**Architecture:** A new `meliFotosService.js` holds pure functions (groups, plan validation, payload rebuild, confirmation) plus two orchestrators (`lerFotos`, `salvarFotos`), reusing the ML helpers already in `meliImagensService.js`. Two routes, `GET/PUT /anuncios-meli/:itemId/fotos`. The Portal rewrites the photo block of `anuncios-meli.js` around a single `DET.fotos` state object.

**Tech Stack:** Node/Express, multer (memory), Sharp, native `fetch`/`FormData`; vanilla JS Portal with native HTML5 drag and drop; plain-Node test files (`assert`) and the CDP headless suite.

**Spec:** `docs/superpowers/specs/2026-09-30-fotos-por-variacao-design.md` (amended in Task 1: the new logic lives in `meliFotosService.js`, not inside `meliImagensService.js`).

## Global Constraints

- Nothing reaches the Mercado Livre before "Salvar no Mercado Livre".
- The PUT is always: current ML state (read now, after uploads) + requested change = complete final payload. Never from the state the screen saw or the snapshot.
- Group identity is `grupoVariacao = { attribute_id, value_id, value_name }`; match `value_id` when not null, else `value_name` trimmed and lower-cased. Never assume COLOR.
- Limits come from `GET /categories/{id}` → `settings.max_pictures_per_item_var` (with variations) or `settings.max_pictures_per_item` (without). Fallback "limite operacional VenForce": 10 per variation group, 12 without variation. The response states `origem: "categoria" | "operacional"`. `max_pictures_per_item` is never applied to the total of a listing with variations.
- Exact UI strings: "Imagem principal da variação", "Capa do anúncio", "Fotos da variação: <valor>", "Fotos do anúncio", "Salvar no Mercado Livre", "Descartar", "Será removida", "Desfazer", "Não é possível salvar. A variação <valor> precisa ter pelo menos uma imagem.", "Não é possível salvar. A variação <valor> pode ter no máximo N imagens.", "O anúncio mudou no Mercado Livre desde que você abriu. Recarregue as fotos."
- ML errors keep original message/code/cause (`detalhesMl`); local refusals never carry `detalhesMl`. Uncertain states (`VINCULO_INCERTO`, `CONFIRMACAO_DIVERGENTE`, `critico`) never offer retry.
- Catalog blocked. Variations + `user_product_id` blocked. Simple listing with `family_name`/`user_product_id` shows the replication warning, not blocked.
- Line endings: `server/controllers/meliAnunciosController.js`, `server/routes/meliAnunciosRoutes.js`, `Portal/anuncios-meli.js`, `Portal/css/pages/anuncios-meli-v2.css`, `Portal/anuncios-meli-detalhe-modal-ui.test.js` are CRLF in the working copy. Use the Edit tool or binary read/write; never Python text mode or `sed -i` (they turn CRLF into LF and break `meliAnunciosOrdenacaoGlobal.test.js`).
- CSS only with existing tokens (`--vf-surface`, `--vf-text`, `--vf-text-muted`, `--vf-border`, `--vf-primary`, `--vf-primary-soft`, `--vf-warning-strong`, `--vf-danger-strong`, `--vf-danger-border`, `--vf-success-*`, `--vf-radius-sm`, `--vf-fs-xs`, `--vf-fw-semibold`, `--vf-bg-2`); no `!important`.
- No push, no deploy. Commit per task, message ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Test commands (from repo root):
  - one backend file: `node server/tests/<file>.test.js`
  - backend suite: `cd server && TEST_SKIP="basesTiktok.test.js,designStudioWorkspace.test.js,designTemplateEngine.test.js,mlTokenService.test.js" node tests/run-all.js`
  - modal headless: `export PATH="$HOME/bin:$PATH" && node Portal/anuncios-meli-detalhe-modal-ui.test.js`

---

## File map

| File | Responsibility |
|---|---|
| `server/services/meliAnuncios/meliFotosService.js` (new) | Pure: groups, plan validation, payload rebuild, confirmation. Orchestration: `lerFotos`, `salvarFotos`. |
| `server/services/meliAnuncios/meliImagensService.js` | Keeps normalization, upload, ML read helpers; exports the helpers the new service needs; loses the PR #205 add-to-variation flow. |
| `server/controllers/meliAnunciosController.js` | `lerFotosAnuncio`, `salvarFotosAnuncio`; drops `gruposImagemVariacoes` and the `grupoVariacao` branch of `adicionarImagem`. |
| `server/routes/meliAnunciosRoutes.js` | `GET/PUT /:itemId/fotos`; drops `GET /:itemId/imagens/variacoes`. |
| `server/tests/meliAnunciosFotos.test.js` (new) | Pure + orchestration tests with a stateful ML simulator. |
| `server/tests/meliAnunciosImagensVariacoes.test.js` | Deleted (flow removed; cases re-covered in the new file). |
| `Portal/anuncios-meli.js` | Photo block rewritten around `DET.fotos`. |
| `Portal/css/pages/anuncios-meli-v2.css` | `.am-det-fotos*` rules; old `.am-det-img-var*` / `.am-det-img-envio*` / `.am-det-img-bloqueio` rules removed. |
| `Portal/anuncios-meli-detalhe-modal-ui.test.js` | Mocks for `/fotos`; checks 7e–7j replaced by 7e–7m. |
| `server/scripts/validacaoImagemVariacao.js`, `docs/VALIDACAO_REAL_IMAGENS_ANUNCIOS_ML.md` | `--ordem` comparison; §7B real-validation checklist. |

---

### Task 1: Pure core of `meliFotosService`

**Files:**
- Modify: `server/services/meliAnuncios/meliImagensService.js` (exports only)
- Create: `server/services/meliAnuncios/meliFotosService.js`
- Create: `server/tests/meliAnunciosFotos.test.js`
- Modify: `docs/superpowers/specs/2026-09-30-fotos-por-variacao-design.md` §5 (new file name)

**Interfaces:**
- Consumes (from `meliImagensService`, to be exported in this task): `falha(codigo, motivo, etapa, extra)`, `falhaMl(resp, etapa)`, `falhaConexao(err, etapa)`, `registrarRecusa(itemId, r, pictureId)`, `lerItemComVariacoes(clienteId, itemId, mlUserId, etapa)`, `atributosQueDefinemFoto(clienteId, categoryId, mlUserId)`, `elegibilidadeVariacoes(item)`, `rotuloDaVariacao(v, atributoFotoId)`, `normalizarParaJpg(file)`, `uploadImagemAnuncio(clienteId, itemId, mlUserId, jpg)`, `urlsDasFotos(item)`, `MOTIVO_CATALOGO`, `MOTIVO_VINCULO_INCERTO`.
- Produces (exported by `meliFotosService`):
  - `LIMITE_OPERACIONAL = { porVariacao: 10, porItem: 12 }`
  - `mesmoValor(ac, grupoVariacao) -> boolean`
  - `montarGrupos(item, atributo) -> { ok:true, grupos:Grupo[] } | Falha` where `Grupo = { grupoVariacao:{attribute_id,value_id,value_name}|null, rotulo:string, variacoes:[{id:string,rotulo:string}], fotos:[{id:string,url:string|null}] }`
  - `grupoSimples(item) -> Grupo`
  - `localizarGrupo(grupos, grupoVariacao) -> Grupo|null`
  - `validarForma(plano, qtdNovas) -> { ok:true, plano } | Falha`
  - `conferirBase(grupo, plano) -> { ok:true } | Falha`
  - `resolverOrdem(ordem, idsNovos) -> string[]`
  - `reconstruirPayload(item, grupo, ordemIds) -> { payload:{pictures, variations?}, removidas:string[] }`
  - `conferirFotos(itemBase, itemDepois, grupo, ordemIds, removidas) -> { ok:true } | Falha`

- [ ] **Step 1: Export the helpers from `meliImagensService.js`**

Replace the `module.exports` block at the end of `server/services/meliAnuncios/meliImagensService.js` with (the four PR #205 entries stay until Task 3):

```js
module.exports = {
  adicionarImagem,
  adicionarImagemVariacao,
  listarGruposDeFotoVariacoes,
  gruposDeFotoDasVariacoes,
  montarPayloadVariacao,
  uploadImagemAnuncio,
  vincularImagemVariacao,
  bloqueioDoAnuncio,
  bloqueioDoItemMl,
  normalizarParaJpg,
  urlsDasFotos,
  // Usados por meliFotosService (editor de fotos por grupo):
  falha,
  falhaMl,
  falhaConexao,
  registrarRecusa,
  lerItemComVariacoes,
  atributosQueDefinemFoto,
  elegibilidadeVariacoes,
  rotuloDaVariacao,
  MAX_DIMENSAO_ML,
  MIN_DIMENSAO_ML,
  MOTIVO_CATALOGO,
  MOTIVO_VARIACOES,
  MOTIVO_VINCULO_INCERTO,
};
```

- [ ] **Step 2: Write the failing pure tests**

Create `server/tests/meliAnunciosFotos.test.js`:

```js
// server/tests/meliAnunciosFotos.test.js
//
// Editor de fotos por grupo de variação (GET/PUT /anuncios-meli/:itemId/fotos).
// Parte 1: funções puras de meliFotosService. Parte 2 (Task 2): orquestração
// contra um ML simulado com estado.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const fotos = require("../services/meliAnuncios/meliFotosService");

const url = (id) => `https://http2.mlstatic.com/D_NQ_NP_${id}-F.jpg`;

// Robalo (P, M) e Preto (P). Robalo é valor personalizado: value_id null.
function variacao(id, attrId, valueId, valor, tam, pictureIds) {
  return {
    id,
    attribute_combinations: [
      { id: attrId, name: "Estampa", value_id: valueId, value_name: valor },
      { id: "SIZE", name: "Tamanho", value_id: null, value_name: tam },
    ],
    price: 50, available_quantity: 3, sold_quantity: 0,
    picture_ids: pictureIds,
  };
}

function itemVar(attrId = "COLOR") {
  return {
    id: "MLB9", catalog_listing: false, category_id: "MLB1", user_product_id: null,
    pictures: ["R1", "R2", "R3", "P1"].map((id) => ({ id, secure_url: url(id) })),
    variations: [
      variacao(1, attrId, null, "Robalo", "P", ["R1", "R2", "R3"]),
      variacao(2, attrId, null, "Robalo", "M", ["R1", "R2", "R3"]),
      variacao(3, attrId, "52028", "Preto", "P", ["P1"]),
    ],
    secure_thumbnail: url("R1"),
  };
}

function itemSimples() {
  return {
    id: "MLB8", catalog_listing: false, category_id: "MLB1", user_product_id: null, variations: [],
    pictures: ["A", "B", "C"].map((id) => ({ id, secure_url: url(id) })),
    secure_thumbnail: url("A"),
  };
}

const ROBALO = { attribute_id: "COLOR", value_id: null, value_name: "Robalo" };
const ATRIBUTO = { id: "COLOR", nome: "Cor" };

let checks = 0;
function ok(msg) { checks += 1; console.log(`  ✓ ${msg}`); }

async function puras() {
  // Grupos: um por valor do atributo, fotos da primeira variação, rótulo = value_name.
  {
    const g = fotos.montarGrupos(itemVar(), ATRIBUTO);
    assert.strictEqual(g.ok, true, JSON.stringify(g));
    assert.deepStrictEqual(g.grupos.map((x) => x.rotulo), ["Robalo", "Preto"]);
    assert.deepStrictEqual(g.grupos[0].grupoVariacao, ROBALO);
    assert.deepStrictEqual(g.grupos[1].grupoVariacao, { attribute_id: "COLOR", value_id: "52028", value_name: "Preto" });
    assert.deepStrictEqual(g.grupos[0].variacoes, [{ id: "1", rotulo: "P" }, { id: "2", rotulo: "M" }]);
    assert.deepStrictEqual(g.grupos[0].fotos, [{ id: "R1", url: url("R1") }, { id: "R2", url: url("R2") }, { id: "R3", url: url("R3") }]);
    ok("montarGrupos agrupa pelo valor do atributo com as fotos de cada grupo");
  }
  // Atributo que não é COLOR funciona igual.
  {
    const g = fotos.montarGrupos(itemVar("PATTERN_NAME"), { id: "PATTERN_NAME", nome: "Estampa" });
    assert.strictEqual(g.ok, true);
    assert.strictEqual(g.grupos[0].grupoVariacao.attribute_id, "PATTERN_NAME");
    ok("montarGrupos não assume COLOR");
  }
  // mesmoValor: value_id quando existe; senão value_name normalizado.
  {
    assert.strictEqual(fotos.mesmoValor({ id: "COLOR", value_id: null, value_name: " robalo " }, ROBALO), true);
    assert.strictEqual(fotos.mesmoValor({ id: "COLOR", value_id: "52028", value_name: "Preto" },
      { attribute_id: "COLOR", value_id: "52028", value_name: "outro nome" }), true);
    assert.strictEqual(fotos.mesmoValor({ id: "SIZE", value_id: null, value_name: "Robalo" }, ROBALO), false);
    ok("mesmoValor casa por value_id ou, sem ele, pelo nome normalizado");
  }
  // Anúncio simples: um grupo com a galeria inteira.
  {
    const g = fotos.grupoSimples(itemSimples());
    assert.strictEqual(g.grupoVariacao, null);
    assert.deepStrictEqual(g.fotos.map((f) => f.id), ["A", "B", "C"]);
    assert.strictEqual(fotos.localizarGrupo([g], null), g);
    ok("anúncio sem variação vira um grupo só com a galeria");
  }
  // validarForma: grupo vazio com a mensagem exata; duplicata; nova fora do alcance; nova não usada.
  {
    const vazio = fotos.validarForma({ grupoVariacao: ROBALO, base: ["R1"], ordem: [] }, 0);
    assert.strictEqual(vazio.codigo, "VARIACAO_SEM_IMAGEM");
    assert.strictEqual(vazio.motivo, "Não é possível salvar. A variação Robalo precisa ter pelo menos uma imagem.");
    assert.strictEqual(vazio.etapa, "validacao");
    const vazioSimples = fotos.validarForma({ grupoVariacao: null, base: ["A"], ordem: [] }, 0);
    assert.strictEqual(vazioSimples.motivo, "Não é possível salvar. O anúncio precisa ter pelo menos uma imagem.");
    assert.strictEqual(fotos.validarForma({ grupoVariacao: ROBALO, base: ["R1"], ordem: [{ existente: "R1" }, { existente: "R1" }] }, 0).codigo, "PLANO_INVALIDO");
    assert.strictEqual(fotos.validarForma({ grupoVariacao: ROBALO, base: ["R1"], ordem: [{ nova: 1 }] }, 1).codigo, "PLANO_INVALIDO");
    assert.strictEqual(fotos.validarForma({ grupoVariacao: ROBALO, base: ["R1"], ordem: [{ existente: "R1" }] }, 1).codigo, "PLANO_INVALIDO");
    assert.strictEqual(fotos.validarForma(null, 0).codigo, "PLANO_INVALIDO");
    const bom = fotos.validarForma({ grupoVariacao: ROBALO, base: ["R1"], ordem: [{ nova: 0 }, { existente: "R1" }] }, 1);
    assert.strictEqual(bom.ok, true);
    ok("validarForma recusa grupo vazio (mensagem exata), duplicata e arquivo órfão");
  }
  // conferirBase: base diferente da atual = FOTOS_DESATUALIZADAS.
  {
    const g = fotos.montarGrupos(itemVar(), ATRIBUTO).grupos[0];
    assert.strictEqual(fotos.conferirBase(g, { base: ["R1", "R2", "R3"], ordem: [{ existente: "R2" }] }).ok, true);
    const velha = fotos.conferirBase(g, { base: ["R1", "R2"], ordem: [{ existente: "R2" }] });
    assert.strictEqual(velha.codigo, "FOTOS_DESATUALIZADAS");
    assert.strictEqual(velha.motivo, "O anúncio mudou no Mercado Livre desde que você abriu. Recarregue as fotos.");
    assert.strictEqual(velha.etapa, "bloqueio");
    assert.strictEqual(fotos.conferirBase(g, { base: ["R1", "R2", "R3"], ordem: [{ existente: "P1" }] }).codigo, "PLANO_INVALIDO");
    ok("conferirBase detecta base desatualizada e foto de outro grupo");
  }
  // reconstruirPayload (variações): grupo recebe a ordem; outros intactos; galeria sem excluídas, novas no fim.
  {
    const item = itemVar();
    const g = fotos.montarGrupos(item, ATRIBUTO).grupos[0];
    const ordemIds = fotos.resolverOrdem([{ existente: "R3" }, { nova: 0 }, { existente: "R1" }], ["N0"]);
    assert.deepStrictEqual(ordemIds, ["R3", "N0", "R1"]);
    const { payload, removidas } = fotos.reconstruirPayload(item, g, ordemIds);
    assert.deepStrictEqual(removidas, ["R2"]);
    assert.deepStrictEqual(payload.pictures, [{ id: "R1" }, { id: "R3" }, { id: "P1" }, { id: "N0" }]);
    assert.deepStrictEqual(payload.variations, [
      { id: 1, picture_ids: ["R3", "N0", "R1"] },
      { id: 2, picture_ids: ["R3", "N0", "R1"] },
      { id: 3, picture_ids: ["P1"] },
    ]);
    ok("reconstruirPayload: estado atual + ordem pedida = payload completo");
  }
  // Foto excluída de um grupo mas usada por outro fica na galeria.
  {
    const item = itemVar();
    item.variations[2].picture_ids = ["P1", "R2"];
    const g = fotos.montarGrupos(item, ATRIBUTO).grupos[0];
    const { payload, removidas } = fotos.reconstruirPayload(item, g, ["R1", "R3"]);
    assert.deepStrictEqual(removidas, []);
    assert.ok(payload.pictures.some((p) => p.id === "R2"));
    ok("foto compartilhada com outro grupo não sai da galeria");
  }
  // reconstruirPayload (simples): galeria = ordem.
  {
    const item = itemSimples();
    const g = fotos.grupoSimples(item);
    const { payload, removidas } = fotos.reconstruirPayload(item, g, ["C", "A", "N0"]);
    assert.deepStrictEqual(payload, { pictures: [{ id: "C" }, { id: "A" }, { id: "N0" }] });
    assert.deepStrictEqual(removidas, ["B"]);
    ok("anúncio simples: galeria vira a ordem (a primeira é a capa)");
  }
  // conferirFotos: ok; ordem divergente; variação sumida (crítico); foto não excluída sumida (crítico).
  {
    const base = itemVar();
    const g = fotos.montarGrupos(base, ATRIBUTO).grupos[0];
    const ordemIds = ["R3", "R1"];
    const { payload, removidas } = fotos.reconstruirPayload(base, g, ordemIds);
    const aplicado = JSON.parse(JSON.stringify(base));
    aplicado.pictures = payload.pictures.map((p) => ({ id: p.id, secure_url: url(p.id) }));
    aplicado.variations.forEach((v, i) => { v.picture_ids = payload.variations[i].picture_ids; });
    assert.strictEqual(fotos.conferirFotos(base, aplicado, g, ordemIds, removidas).ok, true);

    const divergente = JSON.parse(JSON.stringify(aplicado));
    divergente.variations[1].picture_ids = ["R1", "R3"];
    assert.strictEqual(fotos.conferirFotos(base, divergente, g, ordemIds, removidas).codigo, "CONFIRMACAO_DIVERGENTE");

    const perdeuVar = JSON.parse(JSON.stringify(aplicado));
    perdeuVar.variations.pop();
    const r1 = fotos.conferirFotos(base, perdeuVar, g, ordemIds, removidas);
    assert.strictEqual(r1.codigo, "PERDA_DE_VARIACAO");
    assert.strictEqual(r1.critico, true);

    const perdeuFoto = JSON.parse(JSON.stringify(aplicado));
    perdeuFoto.pictures = perdeuFoto.pictures.filter((p) => p.id !== "P1");
    const r2 = fotos.conferirFotos(base, perdeuFoto, g, ordemIds, removidas);
    assert.strictEqual(r2.codigo, "PERDA_DE_FOTO");
    assert.strictEqual(r2.critico, true);
    ok("conferirFotos: sucesso exato, divergência e perdas críticas");
  }
}

async function run() {
  await puras();
  console.log(`\n✓ ${checks} verificações do editor de fotos`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `node server/tests/meliAnunciosFotos.test.js`
Expected: FAIL with `Cannot find module '../services/meliAnuncios/meliFotosService'`.

- [ ] **Step 4: Implement the pure core**

Create `server/services/meliAnuncios/meliFotosService.js`:

```js
// server/services/meliAnuncios/meliFotosService.js
// -----------------------------------------------------------------------------
// Módulo: Anúncios Meli — EDITOR DE FOTOS por grupo de variação (adicionar,
// excluir, reordenar), com um único salvar.
//
// Grupo = valor do atributo com a tag defines_picture (ex.: Cor "Robalo").
// Variações com o mesmo valor têm as mesmas fotos (regra do ML); a PRIMEIRA
// foto de picture_ids é a imagem principal da variação. Anúncio sem variação
// é um grupo só (a galeria geral); a primeira foto é a capa do anúncio.
//
// Escrita: PUT /items/{id} com pictures e variations INTEIROS — o que for
// omitido o ML apaga. Por isso o payload é sempre reconstruído assim:
//
//     estado atual do ML (lido agora) + alteração pedida (ordem) = payload final
//
// nunca a partir do que a tela viu. Fontes: documentacao_api_meli/
// variacoes.md, trabalhar-com-imagens.md, atributos.md. Contrato:
// docs/superpowers/specs/2026-09-30-fotos-por-variacao-design.md.
// -----------------------------------------------------------------------------

const img = require("./meliImagensService");
const { falha } = img;

// Proteção do VenForce quando a categoria não informa limite — não é regra
// do ML (spec §4.3).
const LIMITE_OPERACIONAL = { porVariacao: 10, porItem: 12 };

function norm(s) {
  return s === null || s === undefined ? "" : String(s).trim().toLowerCase();
}

function temValueId(v) {
  return v !== null && v !== undefined && v !== "" && String(v) !== "-1";
}

function grupoVariacaoDe(ac) {
  return {
    attribute_id: String(ac.id),
    value_id: temValueId(ac.value_id) ? String(ac.value_id) : null,
    value_name: ac.value_name === null || ac.value_name === undefined ? null : String(ac.value_name),
  };
}

function mesmoValor(ac, gv) {
  if (!ac || !gv || String(ac.id) !== String(gv.attribute_id)) return false;
  if (temValueId(gv.value_id)) return String(ac.value_id) === String(gv.value_id);
  return norm(ac.value_name) !== "" && norm(ac.value_name) === norm(gv.value_name);
}

function urlPorId(item) {
  const m = {};
  for (const p of Array.isArray(item.pictures) ? item.pictures : []) {
    if (p && p.id) m[String(p.id)] = p.secure_url || p.url || null;
  }
  return m;
}

// Grupos de um item COM variações. Pressupõe elegibilidadeVariacoes(item) ok.
function montarGrupos(item, atributo) {
  const urls = urlPorId(item);
  const grupos = [];
  for (const v of item.variations) {
    const ac = (v.attribute_combinations || []).find((x) => x && String(x.id) === atributo.id);
    if (!ac || (!temValueId(ac.value_id) && norm(ac.value_name) === "")) {
      return falha(
        "VARIACAO_SEM_VALOR_FOTO",
        `Uma variação não tem valor para "${atributo.nome}", o atributo que define a foto. Ajuste no Mercado Livre.`,
        "bloqueio"
      );
    }
    let g = grupos.find((x) => mesmoValor(ac, x.grupoVariacao));
    if (!g) {
      const ids = (Array.isArray(v.picture_ids) ? v.picture_ids : []).map(String);
      g = {
        grupoVariacao: grupoVariacaoDe(ac),
        rotulo: String(ac.value_name != null ? ac.value_name : ac.value_id),
        variacoes: [],
        fotos: ids.map((id) => ({ id, url: urls[id] || null })),
      };
      grupos.push(g);
    }
    g.variacoes.push({ id: String(v.id), rotulo: img.rotuloDaVariacao(v, atributo.id) });
  }
  return { ok: true, grupos };
}

function grupoSimples(item) {
  const urls = urlPorId(item);
  return {
    grupoVariacao: null,
    rotulo: "",
    variacoes: [],
    fotos: (Array.isArray(item.pictures) ? item.pictures : [])
      .filter((p) => p && p.id)
      .map((p) => ({ id: String(p.id), url: urls[String(p.id)] || null })),
  };
}

function localizarGrupo(grupos, gv) {
  if (!gv) return grupos.length === 1 && grupos[0].grupoVariacao === null ? grupos[0] : null;
  return grupos.find((g) => g.grupoVariacao && mesmoValor(
    { id: g.grupoVariacao.attribute_id, value_id: g.grupoVariacao.value_id, value_name: g.grupoVariacao.value_name },
    gv
  )) || null;
}

function nomeDoGrupo(plano) {
  return plano && plano.grupoVariacao && plano.grupoVariacao.value_name
    ? `A variação ${plano.grupoVariacao.value_name}`
    : "O anúncio";
}

function planoInvalido(motivo) {
  return falha("PLANO_INVALIDO", motivo, "validacao", { statusHttp: 400 });
}

// Forma do plano, sem ML. Grupo vazio sai aqui, com a mensagem da spec.
function validarForma(plano, qtdNovas) {
  if (!plano || typeof plano !== "object") return planoInvalido("Plano de fotos ausente ou inválido.");
  const gv = plano.grupoVariacao;
  if (gv !== null && (typeof gv !== "object" || !gv.attribute_id || (!temValueId(gv.value_id) && !gv.value_name))) {
    return planoInvalido("Grupo de variação inválido.");
  }
  if (!Array.isArray(plano.base) || plano.base.some((x) => typeof x !== "string")) {
    return planoInvalido("Base de fotos inválida.");
  }
  if (!Array.isArray(plano.ordem)) return planoInvalido("Ordem de fotos inválida.");
  if (plano.ordem.length === 0) {
    return falha(
      "VARIACAO_SEM_IMAGEM",
      `Não é possível salvar. ${nomeDoGrupo(plano)} precisa ter pelo menos uma imagem.`,
      "validacao",
      { statusHttp: 400 }
    );
  }
  const vistos = new Set();
  const novasUsadas = new Set();
  for (const e of plano.ordem) {
    const existente = e && typeof e.existente === "string";
    const nova = e && Number.isInteger(e.nova);
    if (existente === nova) return planoInvalido("Cada foto da ordem é existente ou nova.");
    if (existente) {
      if (vistos.has(e.existente)) return planoInvalido("Foto repetida na ordem.");
      vistos.add(e.existente);
    } else {
      if (e.nova < 0 || e.nova >= qtdNovas || novasUsadas.has(e.nova)) return planoInvalido("Foto nova sem arquivo correspondente.");
      novasUsadas.add(e.nova);
    }
  }
  if (novasUsadas.size !== qtdNovas) return planoInvalido("Arquivo enviado sem lugar na ordem.");
  return { ok: true, plano };
}

function validarLimite(plano, limite) {
  if (plano.ordem.length > limite) {
    return falha(
      "LIMITE_IMAGENS",
      `Não é possível salvar. ${nomeDoGrupo(plano)} pode ter no máximo ${limite} imagens.`,
      "validacao",
      { statusHttp: 400 }
    );
  }
  return { ok: true };
}

function conferirBase(grupo, plano) {
  const atuais = grupo.fotos.map((f) => f.id);
  if (JSON.stringify(atuais) !== JSON.stringify(plano.base)) {
    return falha(
      "FOTOS_DESATUALIZADAS",
      "O anúncio mudou no Mercado Livre desde que você abriu. Recarregue as fotos.",
      "bloqueio"
    );
  }
  const noGrupo = new Set(atuais);
  if (plano.ordem.some((e) => typeof e.existente === "string" && !noGrupo.has(e.existente))) {
    return planoInvalido("A ordem tem uma foto que não é deste grupo.");
  }
  return { ok: true };
}

function resolverOrdem(ordem, idsNovos) {
  return ordem.map((e) => (typeof e.existente === "string" ? e.existente : String(idsNovos[e.nova])));
}

// estado atual (item) + ordem pedida = payload completo.
function reconstruirPayload(item, grupo, ordemIds) {
  const galeria = item.pictures.map((p) => String(p.id));
  const grupoIds = grupo.fotos.map((f) => f.id);
  const excluidas = grupoIds.filter((id) => !ordemIds.includes(id));

  if (!grupo.grupoVariacao) {
    return { payload: { pictures: ordemIds.map((id) => ({ id })) }, removidas: excluidas };
  }

  const noGrupo = new Set(grupo.variacoes.map((v) => v.id));
  const usadasFora = new Set();
  for (const v of item.variations) {
    if (!noGrupo.has(String(v.id))) (v.picture_ids || []).forEach((id) => usadasFora.add(String(id)));
  }
  const removidas = excluidas.filter((id) => !usadasFora.has(id));
  const novas = ordemIds.filter((id) => !galeria.includes(id));
  return {
    payload: {
      pictures: galeria.filter((id) => !removidas.includes(id)).concat(novas).map((id) => ({ id })),
      variations: item.variations.map((v) => ({
        id: v.id,
        picture_ids: noGrupo.has(String(v.id)) ? ordemIds.slice() : (v.picture_ids || []).map(String),
      })),
    },
    removidas,
  };
}

function falhaCritica(codigo, motivo, contexto) {
  console.error(JSON.stringify({ event: "meli_fotos_perda_critica", codigo, ...contexto }));
  return falha(codigo, motivo, "confirmacao", { critico: true });
}

const DIVERGENTE =
  "O Mercado Livre aceitou a alteração, mas as fotos não ficaram como enviado. Confira no Mercado Livre antes de tentar de novo.";

function conferirFotos(itemBase, itemDepois, grupo, ordemIds, removidas) {
  const ctx = { itemId: itemBase.id };
  const galeriaDepois = (itemDepois.pictures || []).map((p) => p && String(p.id));
  // Toda foto que não foi excluída precisa continuar na galeria.
  const perdidas = itemBase.pictures
    .map((p) => String(p.id))
    .filter((id) => !removidas.includes(id) && !galeriaDepois.includes(id));
  if (perdidas.length) {
    return falhaCritica(
      "PERDA_DE_FOTO",
      "ATENÇÃO: fotos que deviam continuar no anúncio não aparecem mais no Mercado Livre. Confira no Mercado Livre antes de repetir qualquer edição.",
      { ...ctx, perdidas }
    );
  }

  if (grupo.grupoVariacao) {
    const depoisPorId = {};
    for (const v of itemDepois.variations || []) if (v && v.id != null) depoisPorId[String(v.id)] = v;
    const sumiuVar = itemBase.variations.some((v) => !depoisPorId[String(v.id)]);
    if (sumiuVar || (itemDepois.variations || []).length < itemBase.variations.length) {
      return falhaCritica(
        "PERDA_DE_VARIACAO",
        "ATENÇÃO: uma ou mais variações deste anúncio podem ter sido removidas pelo Mercado Livre. Confira no Mercado Livre antes de repetir qualquer edição.",
        { ...ctx, nAntes: itemBase.variations.length, nDepois: (itemDepois.variations || []).length }
      );
    }
    const noGrupo = new Set(grupo.variacoes.map((v) => v.id));
    for (const v of itemBase.variations) {
      const esperado = noGrupo.has(String(v.id)) ? ordemIds : (v.picture_ids || []).map(String);
      const veio = (depoisPorId[String(v.id)].picture_ids || []).map(String);
      if (JSON.stringify(veio) !== JSON.stringify(esperado)) {
        return falha("CONFIRMACAO_DIVERGENTE", DIVERGENTE, "confirmacao");
      }
    }
  } else if (JSON.stringify(galeriaDepois) !== JSON.stringify(ordemIds)) {
    return falha("CONFIRMACAO_DIVERGENTE", DIVERGENTE, "confirmacao");
  }

  if (removidas.some((id) => galeriaDepois.includes(id)) || ordemIds.some((id) => !galeriaDepois.includes(id))) {
    return falha("CONFIRMACAO_DIVERGENTE", DIVERGENTE, "confirmacao");
  }
  return { ok: true };
}

module.exports = {
  LIMITE_OPERACIONAL,
  mesmoValor,
  montarGrupos,
  grupoSimples,
  localizarGrupo,
  validarForma,
  validarLimite,
  conferirBase,
  resolverOrdem,
  reconstruirPayload,
  conferirFotos,
};
```

- [ ] **Step 5: Run the tests**

Run: `node server/tests/meliAnunciosFotos.test.js`
Expected: `✓ 10 verificações do editor de fotos`.

- [ ] **Step 6: Amend spec §5 and commit**

In the spec, §5 first bullet, replace "ganha `lerFotos()`, …, `salvarFotos()` (orquestração)" with "exporta os helpers usados pelo novo `meliFotosService.js`, que concentra `lerFotos()`, `validarForma()`, `reconstruirPayload()`, `conferirFotos()` e `salvarFotos()`".

```bash
git add server/services/meliAnuncios/meliFotosService.js server/services/meliAnuncios/meliImagensService.js server/tests/meliAnunciosFotos.test.js docs/superpowers/specs/2026-09-30-fotos-por-variacao-design.md
git commit -m "feat(anuncios-ml): pure core of the per-group photo editor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `lerFotos` and `salvarFotos` orchestration

**Files:**
- Modify: `server/services/meliAnuncios/meliFotosService.js`
- Modify: `server/tests/meliAnunciosFotos.test.js`

**Interfaces:**
- Consumes: Task 1 exports; `img.*` helpers listed in Task 1.
- Produces:
  - `limitesDaCategoria(clienteId, categoryId, mlUserId) -> { porVariacao, porItem, origemVariacao, origemItem }` (never fails; falls back to `LIMITE_OPERACIONAL`)
  - `lerFotos({ clienteId, itemId, mlUserId }) -> Leitura | Falha` where `Leitura = { ok:true, modo:"variacoes"|"simples", atributo:{id,nome}|null, limite:{porGrupo:number, origem:"categoria"|"operacional"}, grupos:Grupo[] }`
  - `salvarFotos({ clienteId, itemId, mlUserId, anuncio, plano, arquivos }) -> { ok:true, fotos:{pictures_json, pictures_count, thumbnail}|null, leitura:Leitura|null, confirmacaoPendente:boolean, novas:string[] } | Falha` (Falha may carry `detalhesMl`, `pictureIds`, `critico`, `statusHttp`)

- [ ] **Step 1: Write the failing orchestration tests**

In `server/tests/meliAnunciosFotos.test.js`, add after the requires (before `const url = ...` stays as is):

```js
const Module = require("module");
const sharp = require("sharp");
```

Move the `require("../services/meliAnuncios/meliFotosService")` line so it runs **after** the mlClient stub below, i.e. replace `const fotos = require("../services/meliAnuncios/meliFotosService");` with the stub block followed by the require:

```js
let mlChamadas = [];
let mlHandler = null;
const originalLoad = Module._load;
Module._load = function loadWithMlFetchStub(request, parent, isMain) {
  if (request === "../../utils/mlClient" || request === "../utils/mlClient") {
    return {
      async mlFetch(clienteId, path, options = {}) {
        const multipart = options.body instanceof FormData;
        const chamada = {
          clienteId, path, metodo: options.method || "GET", mlUserId: options.mlUserId,
          form: multipart ? options.body : null,
          body: options.body && !multipart ? JSON.parse(options.body) : null,
        };
        mlChamadas.push(chamada);
        return mlHandler ? mlHandler(chamada) : { ok: true, status: 200, data: {} };
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const fotos = require("../services/meliAnuncios/meliFotosService");
const { mapearItem } = require("../services/meliAnuncios/meliSyncService");
Module._load = originalLoad;
```

Add the simulator and the orchestration block before `async function run()`:

```js
const ATRIBUTOS_CATEGORIA = [
  { id: "COLOR", name: "Cor", tags: { allow_variations: true, defines_picture: true } },
  { id: "SIZE", name: "Tamanho", tags: { allow_variations: true } },
];

// ML com estado: PUT aplica pictures/variations; variação omitida some.
function mlSimulado({ item, settings = { max_pictures_per_item: 12, max_pictures_per_item_var: 10 }, categoriaFalha = false } = {}) {
  const estado = { item: item || itemVar(), puts: 0, uploads: 0, proximo: 0 };
  const handler = (c) => {
    const id = estado.item.id;
    if (c.metodo === "GET" && c.path.startsWith(`/items/${id}`)) {
      return { ok: true, status: 200, data: JSON.parse(JSON.stringify(estado.item)) };
    }
    if (c.metodo === "GET" && c.path === `/categories/${estado.item.category_id}/attributes`) {
      return { ok: true, status: 200, data: ATRIBUTOS_CATEGORIA };
    }
    if (c.metodo === "GET" && c.path === `/categories/${estado.item.category_id}`) {
      return categoriaFalha ? { ok: false, status: 500, data: { message: "x" } } : { ok: true, status: 200, data: { settings } };
    }
    if (c.path === "/pictures/items/upload") {
      estado.uploads += 1;
      return { ok: true, status: 201, data: { id: `N${estado.proximo++}` } };
    }
    if (c.metodo === "PUT" && c.path === `/items/${id}`) {
      estado.puts += 1;
      const porId = Object.fromEntries(estado.item.pictures.map((p) => [p.id, p]));
      estado.item.pictures = c.body.pictures.map((p) => porId[p.id] || { id: p.id, secure_url: url(p.id) });
      if (c.body.variations) {
        const vPorId = Object.fromEntries(estado.item.variations.map((v) => [String(v.id), v]));
        estado.item.variations = c.body.variations.map((v) => ({ ...vPorId[String(v.id)], picture_ids: v.picture_ids }));
      }
      return { ok: true, status: 200, data: estado.item };
    }
    return { ok: false, status: 404, data: { message: `rota inesperada: ${c.metodo} ${c.path}` } };
  };
  return { estado, handler };
}

let PNG;
const arquivo = () => ({ buffer: PNG, mimetype: "image/png", originalname: "n.png", size: PNG.length });
const seq = () => mlChamadas.map((c) => `${c.metodo} ${c.path.split("?")[0]}`);
const idsVar = (item, vid) => item.variations.find((v) => String(v.id) === String(vid)).picture_ids;

async function salvar(ml, plano, n = 0, anuncio = { catalog_listing: false }) {
  mlChamadas = [];
  mlHandler = ml.handler;
  const arquivos = Array.from({ length: n }, arquivo);
  return fotos.salvarFotos({ clienteId: 1, itemId: ml.estado.item.id, mlUserId: "111", anuncio, plano, arquivos });
}

async function orquestracao() {
  PNG = await sharp({ create: { width: 800, height: 800, channels: 3, background: { r: 20, g: 40, b: 200 } } }).png().toBuffer();

  // Leitura com variações: grupos + limite da categoria.
  {
    const ml = mlSimulado();
    mlHandler = ml.handler;
    const r = await fotos.lerFotos({ clienteId: 1, itemId: "MLB9", mlUserId: "111" });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(r.modo, "variacoes");
    assert.deepStrictEqual(r.atributo, { id: "COLOR", nome: "Cor" });
    assert.deepStrictEqual(r.limite, { porGrupo: 10, origem: "categoria" });
    assert.strictEqual(r.grupos.length, 2);
    ok("lerFotos: grupos por atributo e limite por variação da categoria");
  }
  // Leitura simples com categoria sem limite: operacional 12.
  {
    const ml = mlSimulado({ item: itemSimples(), settings: {} });
    mlHandler = ml.handler;
    const r = await fotos.lerFotos({ clienteId: 1, itemId: "MLB8", mlUserId: "111" });
    assert.strictEqual(r.modo, "simples");
    assert.strictEqual(r.atributo, null);
    assert.deepStrictEqual(r.limite, { porGrupo: 12, origem: "operacional" });
    assert.deepStrictEqual(r.grupos[0].fotos.map((f) => f.id), ["A", "B", "C"]);
    ok("lerFotos simples: um grupo e limite operacional quando a categoria não informa");
  }
  // Reordenar + excluir + adicionar no mesmo salvar.
  {
    const ml = mlSimulado();
    const r = await salvar(ml, { grupoVariacao: ROBALO, base: ["R1", "R2", "R3"], ordem: [{ existente: "R3" }, { nova: 0 }, { existente: "R1" }] }, 1);
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.deepStrictEqual(seq(), [
      "GET /items/MLB9", "GET /categories/MLB1/attributes", "GET /categories/MLB1",
      "POST /pictures/items/upload",
      "GET /items/MLB9",
      "PUT /items/MLB9",
      "GET /items/MLB9",
    ]);
    assert.deepStrictEqual(idsVar(ml.estado.item, 1), ["R3", "N0", "R1"]);
    assert.deepStrictEqual(idsVar(ml.estado.item, 2), ["R3", "N0", "R1"]);
    assert.deepStrictEqual(idsVar(ml.estado.item, 3), ["P1"]);
    assert.deepStrictEqual(ml.estado.item.pictures.map((p) => p.id), ["R1", "R3", "P1", "N0"]);
    assert.deepStrictEqual(r.novas, ["N0"]);
    assert.strictEqual(r.fotos.pictures_count, 4);
    assert.deepStrictEqual(r.leitura.grupos[0].fotos.map((f) => f.id), ["R3", "N0", "R1"]);
    ok("reordenar + excluir + adicionar: um PUT, grupo exato, outro grupo intacto");
  }
  // Só reordenar: nenhum upload.
  {
    const ml = mlSimulado();
    const r = await salvar(ml, { grupoVariacao: ROBALO, base: ["R1", "R2", "R3"], ordem: [{ existente: "R2" }, { existente: "R1" }, { existente: "R3" }] });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(ml.estado.uploads, 0);
    assert.deepStrictEqual(idsVar(ml.estado.item, 2), ["R2", "R1", "R3"]);
    ok("só reordenar: sem upload, imagem principal da variação troca");
  }
  // Anúncio simples: galeria vira a ordem (capa muda).
  {
    const ml = mlSimulado({ item: itemSimples() });
    const r = await salvar(ml, { grupoVariacao: null, base: ["A", "B", "C"], ordem: [{ existente: "C" }, { existente: "A" }] });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.deepStrictEqual(ml.estado.item.pictures.map((p) => p.id), ["C", "A"]);
    assert.ok(!mlChamadas.some((c) => c.path.endsWith("/attributes")), "sem variação não lê atributos");
    ok("anúncio simples: galeria na ordem pedida, excluída sai");
  }
  // Grupo vazio: recusado sem chamar o ML.
  {
    const ml = mlSimulado();
    const r = await salvar(ml, { grupoVariacao: ROBALO, base: ["R1", "R2", "R3"], ordem: [] });
    assert.strictEqual(r.codigo, "VARIACAO_SEM_IMAGEM");
    assert.strictEqual(mlChamadas.length, 0);
    ok("grupo vazio: recusado antes de qualquer chamada ao ML");
  }
  // Limite da categoria e limite operacional.
  {
    let ml = mlSimulado({ settings: { max_pictures_per_item_var: 3 } });
    let r = await salvar(ml, { grupoVariacao: ROBALO, base: ["R1", "R2", "R3"], ordem: [{ existente: "R1" }, { existente: "R2" }, { existente: "R3" }, { nova: 0 }] }, 1);
    assert.strictEqual(r.codigo, "LIMITE_IMAGENS");
    assert.strictEqual(r.motivo, "Não é possível salvar. A variação Robalo pode ter no máximo 3 imagens.");
    assert.strictEqual(ml.estado.uploads, 0);
    ml = mlSimulado({ categoriaFalha: true });
    const onze = [{ existente: "R1" }, { existente: "R2" }, { existente: "R3" }].concat(Array.from({ length: 8 }, (_, i) => ({ nova: i })));
    r = await salvar(ml, { grupoVariacao: ROBALO, base: ["R1", "R2", "R3"], ordem: onze }, 8);
    assert.strictEqual(r.codigo, "LIMITE_IMAGENS");
    assert.ok(/no máximo 10 imagens/.test(r.motivo));
    ok("limite: da categoria quando existe, operacional (10) quando não; sem upload");
  }
  // Base desatualizada: nenhum upload, nenhum PUT.
  {
    const ml = mlSimulado();
    const r = await salvar(ml, { grupoVariacao: ROBALO, base: ["R1", "R2"], ordem: [{ existente: "R1" }] });
    assert.strictEqual(r.codigo, "FOTOS_DESATUALIZADAS");
    assert.strictEqual(ml.estado.puts, 0);
    ok("base desatualizada: FOTOS_DESATUALIZADAS sem escrever");
  }
  // Falha no 2º upload: para sem PUT, ids já enviados voltam.
  {
    const ml = mlSimulado();
    let n = 0;
    const h = (c) => {
      if (c.path === "/pictures/items/upload" && ++n === 2) return { ok: false, status: 400, data: { message: "bad", error: "bad_request", cause: [] } };
      return ml.handler(c);
    };
    mlChamadas = []; mlHandler = h;
    const r = await fotos.salvarFotos({ clienteId: 1, itemId: "MLB9", mlUserId: "111", anuncio: {},
      plano: { grupoVariacao: ROBALO, base: ["R1", "R2", "R3"], ordem: [{ existente: "R1" }, { nova: 0 }, { nova: 1 }] },
      arquivos: [arquivo(), arquivo()] });
    assert.strictEqual(r.etapa, "upload");
    assert.deepStrictEqual(r.pictureIds, ["N0"]);
    assert.strictEqual(r.detalhesMl.status, 400);
    assert.strictEqual(ml.estado.puts, 0);
    ok("falha de upload: nenhum PUT, anúncio intacto, ids já enviados informados");
  }
  // Mudança entre upload e PUT: o PUT é refeito sobre o estado novo (foto de outro grupo preservada).
  {
    const ml = mlSimulado();
    const h = (c) => {
      const r = ml.handler(c);
      if (c.path === "/pictures/items/upload") {
        ml.estado.item.pictures.push({ id: "P2", secure_url: url("P2") });
        ml.estado.item.variations[2].picture_ids = ["P1", "P2"];
      }
      return r;
    };
    mlChamadas = []; mlHandler = h;
    const r = await fotos.salvarFotos({ clienteId: 1, itemId: "MLB9", mlUserId: "111", anuncio: {},
      plano: { grupoVariacao: ROBALO, base: ["R1", "R2", "R3"], ordem: [{ existente: "R1" }, { nova: 0 }] },
      arquivos: [arquivo()] });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.deepStrictEqual(idsVar(ml.estado.item, 3), ["P1", "P2"]);
    assert.ok(ml.estado.item.pictures.some((p) => p.id === "P2"));
    ok("PUT reconstruído do estado lido depois do upload: nada de fora é apagado");
  }
  // Grupo alvo mudou entre upload e PUT: FOTOS_DESATUALIZADAS, sem PUT, ids informados.
  {
    const ml = mlSimulado();
    const h = (c) => {
      const r = ml.handler(c);
      if (c.path === "/pictures/items/upload") { ml.estado.item.variations[0].picture_ids = ["R1"]; ml.estado.item.variations[1].picture_ids = ["R1"]; }
      return r;
    };
    mlChamadas = []; mlHandler = h;
    const r = await fotos.salvarFotos({ clienteId: 1, itemId: "MLB9", mlUserId: "111", anuncio: {},
      plano: { grupoVariacao: ROBALO, base: ["R1", "R2", "R3"], ordem: [{ existente: "R1" }, { nova: 0 }] },
      arquivos: [arquivo()] });
    assert.strictEqual(r.codigo, "FOTOS_DESATUALIZADAS");
    assert.deepStrictEqual(r.pictureIds, ["N0"]);
    assert.strictEqual(ml.estado.puts, 0);
    ok("grupo alterado durante o upload: sem PUT");
  }
  // PUT: erro do ML preservado.
  {
    const ml = mlSimulado();
    const corpoMl = { message: "Validation error", error: "validation_error", status: 400,
      cause: [{ code: "item.pictures.max", message: "Too many pictures", type: "error", references: [] }] };
    mlChamadas = []; mlHandler = (c) => (c.metodo === "PUT" ? { ok: false, status: 400, data: corpoMl } : ml.handler(c));
    const r = await fotos.salvarFotos({ clienteId: 1, itemId: "MLB9", mlUserId: "111", anuncio: {},
      plano: { grupoVariacao: ROBALO, base: ["R1", "R2", "R3"], ordem: [{ existente: "R2" }] }, arquivos: [] });
    assert.strictEqual(r.etapa, "vinculo");
    assert.strictEqual(r.codigo, "item.pictures.max");
    assert.strictEqual(r.motivo, "Too many pictures");
    assert.deepStrictEqual(r.detalhesMl.causas, corpoMl.cause);
    ok("recusa do ML no PUT: mensagem, código e causa originais");
  }
  // PUT com conexão caída: aplicado = sucesso; sem releitura = VINCULO_INCERTO; 5xx não aplicado = erro original.
  {
    let ml = mlSimulado();
    const plano = { grupoVariacao: ROBALO, base: ["R1", "R2", "R3"], ordem: [{ existente: "R3" }, { existente: "R1" }] };
    mlChamadas = []; mlHandler = (c) => { if (c.metodo === "PUT") { ml.handler(c); throw new Error("socket hang up"); } return ml.handler(c); };
    let r = await fotos.salvarFotos({ clienteId: 1, itemId: "MLB9", mlUserId: "111", anuncio: {}, plano, arquivos: [] });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(ml.estado.puts, 1);

    ml = mlSimulado();
    let depois = false;
    mlChamadas = []; mlHandler = (c) => { if (c.metodo === "PUT") { depois = true; throw new Error("socket hang up"); } if (depois) throw new Error("ECONNRESET"); return ml.handler(c); };
    r = await fotos.salvarFotos({ clienteId: 1, itemId: "MLB9", mlUserId: "111", anuncio: {}, plano, arquivos: [] });
    assert.strictEqual(r.codigo, "VINCULO_INCERTO");

    ml = mlSimulado();
    mlChamadas = []; mlHandler = (c) => (c.metodo === "PUT" ? { ok: false, status: 504, data: { message: "Gateway Timeout", error: "gateway_timeout", status: 504, cause: [] } } : ml.handler(c));
    r = await fotos.salvarFotos({ clienteId: 1, itemId: "MLB9", mlUserId: "111", anuncio: {}, plano, arquivos: [] });
    assert.strictEqual(r.codigo, "gateway_timeout");
    assert.strictEqual(mlChamadas.filter((c) => c.metodo === "PUT").length, 1);
    ok("PUT incerto: aplicado vira sucesso, sem releitura vira VINCULO_INCERTO, 5xx não aplicado é erro real; nunca repete");
  }
  // Confirmação com variação perdida: crítico.
  {
    const ml = mlSimulado();
    mlChamadas = []; mlHandler = (c) => { const r = ml.handler(c); if (c.metodo === "PUT") ml.estado.item.variations.pop(); return r; };
    const r = await fotos.salvarFotos({ clienteId: 1, itemId: "MLB9", mlUserId: "111", anuncio: {},
      plano: { grupoVariacao: ROBALO, base: ["R1", "R2", "R3"], ordem: [{ existente: "R1" }] }, arquivos: [] });
    assert.strictEqual(r.codigo, "PERDA_DE_VARIACAO");
    assert.strictEqual(r.critico, true);
    ok("variação perdida na confirmação: falha crítica");
  }
  // Catálogo e User Product com variações: bloqueados antes de qualquer escrita.
  {
    let ml = mlSimulado();
    let r = await salvar(ml, { grupoVariacao: ROBALO, base: ["R1", "R2", "R3"], ordem: [{ existente: "R1" }] }, 0, { catalog_listing: true });
    assert.strictEqual(r.codigo, "IMAGENS_BLOQUEADAS_CATALOGO");
    assert.strictEqual(mlChamadas.length, 0);
    const up = itemVar(); up.user_product_id = "MLBU1";
    ml = mlSimulado({ item: up });
    r = await salvar(ml, { grupoVariacao: ROBALO, base: ["R1", "R2", "R3"], ordem: [{ existente: "R1" }] });
    assert.strictEqual(r.codigo, "IMAGENS_VARIACOES_USER_PRODUCT");
    assert.strictEqual(ml.estado.puts, 0);
    ok("catálogo e User Product com variações: bloqueados");
  }
  // Snapshot: a galeria devolvida é a mesma que o sync gravaria.
  {
    const ml = mlSimulado();
    const r = await salvar(ml, { grupoVariacao: ROBALO, base: ["R1", "R2", "R3"], ordem: [{ existente: "R2" }, { existente: "R1" }] });
    const sync = mapearItem(ml.estado.item, 1, "c", 10, "111");
    assert.deepStrictEqual(r.fotos.pictures_json, sync.pictures_json);
    assert.strictEqual(r.fotos.pictures_count, sync.pictures_count);
    ok("galeria confirmada = o que o sync grava");
  }
}
```

Change `run()` to:

```js
async function run() {
  await puras();
  await orquestracao();
  console.log(`\n✓ ${checks} verificações do editor de fotos`);
}
```

- [ ] **Step 2: Run to confirm failure**

Run: `node server/tests/meliAnunciosFotos.test.js`
Expected: the 10 pure checks pass, then FAIL with `fotos.lerFotos is not a function`.

- [ ] **Step 3: Implement the orchestration**

Append to `server/services/meliAnuncios/meliFotosService.js` (before `module.exports`), and add the new names to `module.exports`:

```js
const { mlFetch } = require("../../utils/mlClient");

async function limitesDaCategoria(clienteId, categoryId, mlUserId) {
  const r = {
    porVariacao: LIMITE_OPERACIONAL.porVariacao, origemVariacao: "operacional",
    porItem: LIMITE_OPERACIONAL.porItem, origemItem: "operacional",
  };
  if (!categoryId) return r;
  try {
    const resp = await mlFetch(clienteId, `/categories/${encodeURIComponent(categoryId)}`, { method: "GET", mlUserId });
    const s = resp && resp.ok && resp.data && resp.data.settings;
    if (s && Number.isInteger(s.max_pictures_per_item_var) && s.max_pictures_per_item_var > 0) {
      r.porVariacao = s.max_pictures_per_item_var; r.origemVariacao = "categoria";
    }
    if (s && Number.isInteger(s.max_pictures_per_item) && s.max_pictures_per_item > 0) {
      r.porItem = s.max_pictures_per_item; r.origemItem = "categoria";
    }
  } catch (_) { /* fica o operacional */ }
  return r;
}

function temVariacoes(item) {
  return Array.isArray(item && item.variations) && item.variations.length > 0;
}

// Grupos de um item JÁ lido. `atributo` é passado quando já se sabe (evita
// reler os atributos da categoria na confirmação).
async function gruposDoItem(clienteId, item, mlUserId, atributo) {
  if (item.catalog_listing === true) return falha("IMAGENS_BLOQUEADAS_CATALOGO", img.MOTIVO_CATALOGO, "bloqueio");
  if (!temVariacoes(item)) return { ok: true, modo: "simples", atributo: null, grupos: [grupoSimples(item)] };
  const eleg = img.elegibilidadeVariacoes(item);
  if (!eleg.ok) return eleg;
  let attr = atributo;
  if (!attr) {
    const attrs = await img.atributosQueDefinemFoto(clienteId, item.category_id, mlUserId);
    if (!attrs.ok) return attrs;
    const idsNasCombinacoes = new Set();
    item.variations.forEach((v) => (v.attribute_combinations || []).forEach((ac) => ac && ac.id && idsNasCombinacoes.add(String(ac.id))));
    const candidatos = attrs.atributos.filter((a) => idsNasCombinacoes.has(a.id));
    if (candidatos.length !== 1) {
      return falha(
        "ATRIBUTO_FOTO_INDEFINIDO",
        "O Mercado Livre não indica, para a categoria deste anúncio, qual atributo das variações define a foto (defines_picture). Sem isso não dá para saber quais variações dividem as fotos — use o Mercado Livre.",
        "bloqueio"
      );
    }
    attr = candidatos[0];
  }
  const g = montarGrupos(item, attr);
  if (!g.ok) return g;
  return { ok: true, modo: "variacoes", atributo: attr, grupos: g.grupos };
}

function leituraDe(agrupado, limites) {
  const variacoes = agrupado.modo === "variacoes";
  return {
    ok: true,
    modo: agrupado.modo,
    atributo: agrupado.atributo,
    limite: variacoes
      ? { porGrupo: limites.porVariacao, origem: limites.origemVariacao }
      : { porGrupo: limites.porItem, origem: limites.origemItem },
    grupos: agrupado.grupos,
  };
}

async function lerFotos({ clienteId, itemId, mlUserId }) {
  const lido = await img.lerItemComVariacoes(clienteId, itemId, mlUserId, "leitura");
  if (!lido.ok) return lido;
  const agrupado = await gruposDoItem(clienteId, lido.item, mlUserId, null);
  if (!agrupado.ok) return agrupado;
  const limites = await limitesDaCategoria(clienteId, lido.item.category_id, mlUserId);
  return leituraDe(agrupado, limites);
}

function fotosConfirmadas(item) {
  const urls = img.urlsDasFotos(item);
  return { pictures_json: urls, pictures_count: urls.length, thumbnail: item.secure_thumbnail || item.thumbnail || null };
}

function comIds(r, ids) {
  if (ids.length) r.pictureIds = ids.slice();
  return r;
}

async function enviarPut(clienteId, itemId, mlUserId, payload) {
  try {
    const resp = await mlFetch(clienteId, `/items/${encodeURIComponent(itemId)}`, {
      method: "PUT", body: JSON.stringify(payload), mlUserId,
    });
    if (resp && resp.ok) return { ok: true };
    return img.falhaMl(resp, "vinculo");
  } catch (err) {
    return img.falhaConexao(err, "vinculo");
  }
}

async function salvarFotos({ clienteId, itemId, mlUserId, anuncio, plano, arquivos }) {
  if (anuncio && anuncio.catalog_listing === true) {
    return falha("IMAGENS_BLOQUEADAS_CATALOGO", img.MOTIVO_CATALOGO, "bloqueio");
  }
  const lista = Array.isArray(arquivos) ? arquivos : [];
  const forma = validarForma(plano, lista.length);
  if (!forma.ok) return forma;

  // 1) Arquivos: validar e normalizar tudo antes de falar com o ML.
  const jpgs = [];
  for (const a of lista) {
    try {
      jpgs.push(await img.normalizarParaJpg(a));
    } catch (err) {
      if (err && err.codigo) return falha(err.codigo, err.message, "validacao", { statusHttp: err.statusCode || 400 });
      throw err;
    }
  }

  // 2) Estado atual no ML: elegibilidade, grupo, base e limite.
  const lido = await img.lerItemComVariacoes(clienteId, itemId, mlUserId, "leitura");
  if (!lido.ok) { img.registrarRecusa(itemId, lido); return lido; }
  const agrupado = await gruposDoItem(clienteId, lido.item, mlUserId, null);
  if (!agrupado.ok) return agrupado;
  if ((agrupado.modo === "variacoes") !== (plano.grupoVariacao !== null)) {
    return falha("FOTOS_DESATUALIZADAS", "O anúncio mudou no Mercado Livre desde que você abriu. Recarregue as fotos.", "bloqueio");
  }
  const grupo0 = localizarGrupo(agrupado.grupos, plano.grupoVariacao);
  if (!grupo0) {
    return falha("VARIACAO_GRUPO_INEXISTENTE", "Esta variação não existe mais no Mercado Livre. Recarregue as fotos.", "bloqueio");
  }
  const base0 = conferirBase(grupo0, plano);
  if (!base0.ok) return base0;
  const limites = await limitesDaCategoria(clienteId, lido.item.category_id, mlUserId);
  const limite = agrupado.modo === "variacoes" ? limites.porVariacao : limites.porItem;
  const lim = validarLimite(plano, limite);
  if (!lim.ok) return lim;

  // 3) Upload das novas, uma por vez. Falha: para sem PUT.
  const novas = [];
  for (const jpg of jpgs) {
    const up = await img.uploadImagemAnuncio(clienteId, itemId, mlUserId, jpg);
    if (!up.ok) { img.registrarRecusa(itemId, up, novas.join(",") || null); return comIds(up, novas); }
    novas.push(up.pictureId);
  }

  // 4) Estado atual DE NOVO (o upload leva tempo) → payload completo.
  const agora = await img.lerItemComVariacoes(clienteId, itemId, mlUserId, "leitura");
  if (!agora.ok) { img.registrarRecusa(itemId, agora, novas.join(",") || null); return comIds(agora, novas); }
  const agrupadoAgora = await gruposDoItem(clienteId, agora.item, mlUserId, agrupado.atributo);
  if (!agrupadoAgora.ok) return comIds(agrupadoAgora, novas);
  const grupo = localizarGrupo(agrupadoAgora.grupos, plano.grupoVariacao);
  if (!grupo) {
    return comIds(falha("VARIACAO_GRUPO_INEXISTENTE", "Esta variação não existe mais no Mercado Livre. Recarregue as fotos.", "bloqueio"), novas);
  }
  const base = conferirBase(grupo, plano);
  if (!base.ok) { img.registrarRecusa(itemId, base, novas.join(",") || null); return comIds(base, novas); }
  const ordemIds = resolverOrdem(plano.ordem, novas);
  const { payload, removidas } = reconstruirPayload(agora.item, grupo, ordemIds);

  // 5) PUT e conferência.
  const sucesso = (item) => ({
    ok: true,
    fotos: fotosConfirmadas(item),
    leitura: (() => {
      const g = agrupadoAgora.modo === "variacoes" ? montarGrupos(item, agrupadoAgora.atributo) : { ok: true, grupos: [grupoSimples(item)] };
      return g.ok ? leituraDe({ modo: agrupadoAgora.modo, atributo: agrupadoAgora.atributo, grupos: g.grupos }, limites) : null;
    })(),
    confirmacaoPendente: false,
    novas,
  });

  const put = await enviarPut(clienteId, itemId, mlUserId, payload);
  if (!put.ok) {
    img.registrarRecusa(itemId, put, novas.join(",") || null);
    const incerto = put.codigo === "ML_INDISPONIVEL" || (put.detalhesMl && Number(put.detalhesMl.status) >= 500);
    if (incerto) {
      const conferido = await img.lerItemComVariacoes(clienteId, itemId, mlUserId, "confirmacao");
      if (!conferido.ok) return comIds(falha("VINCULO_INCERTO", img.MOTIVO_VINCULO_INCERTO, "vinculo"), novas);
      const conf = conferirFotos(agora.item, conferido.item, grupo, ordemIds, removidas);
      if (conf.ok) return sucesso(conferido.item);
    }
    return comIds(put, novas);
  }

  const confirmado = await img.lerItemComVariacoes(clienteId, itemId, mlUserId, "confirmacao");
  if (!confirmado.ok) {
    img.registrarRecusa(itemId, confirmado, novas.join(",") || null);
    return { ok: true, fotos: null, leitura: null, confirmacaoPendente: true, novas };
  }
  const conf = conferirFotos(agora.item, confirmado.item, grupo, ordemIds, removidas);
  if (!conf.ok) return comIds(conf, novas);
  return sucesso(confirmado.item);
}
```

Add to `module.exports`: `limitesDaCategoria, lerFotos, salvarFotos`.

Note: the `mlFetch` require must stay below the other requires at the top of the file; move `const { mlFetch } = require("../../utils/mlClient");` up next to `const img = require(...)`.

Note on `MOTIVO_VINCULO_INCERTO`: its text says "se a imagem entrou no anúncio"; acceptable for the editor too (it tells the user to check the listing before retrying).

- [ ] **Step 4: Run the tests**

Run: `node server/tests/meliAnunciosFotos.test.js`
Expected: `✓ 26 verificações do editor de fotos` (10 pure + 16 orchestration). Warning/error log lines from `registrarRecusa` and the critical event are expected.

- [ ] **Step 5: Commit**

```bash
git add server/services/meliAnuncios/meliFotosService.js server/tests/meliAnunciosFotos.test.js
git commit -m "feat(anuncios-ml): read and save photos per variation group

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Routes and controller; retire the PR #205 add-to-variation flow

**Files:**
- Modify: `server/controllers/meliAnunciosController.js` (function `adicionarImagem` ~line 2060, `gruposImagemVariacoes`, exports)
- Modify: `server/routes/meliAnunciosRoutes.js` (~lines 170–190)
- Modify: `server/services/meliAnuncios/meliImagensService.js` (remove PR #205 flow)
- Delete: `server/tests/meliAnunciosImagensVariacoes.test.js`
- Modify: `server/tests/meliAnunciosFotos.test.js` (controller checks)

**Interfaces:**
- Consumes: `fotosService.lerFotos`, `fotosService.salvarFotos` (Task 2); `anunciosService.resolverCliente`, `obterAnuncio`, `resolverContextoConta`, `atualizarFotosConfirmadas`.
- Produces (HTTP):
  - `GET /anuncios-meli/:itemId/fotos?clienteSlug&clienteContaId` → `200 Leitura` | `409 {ok:false,codigo,motivo,etapa}` (bloqueio) | `422` (+`detalhesMl`)
  - `PUT /anuncios-meli/:itemId/fotos?clienteSlug&clienteContaId`, multipart: field `plano` (JSON string), files `novas` (≤10, ≤ `MAX_UPLOAD_BYTES` each) → `200 {ok:true, anuncio, leitura, confirmacaoPendente, novas}` | `400` (validacao) | `409` (bloqueio) | `422` (ML / incerto / crítico: `critico:true`, `pictureIds`)

- [ ] **Step 1: Write the failing controller tests**

In `server/tests/meliAnunciosFotos.test.js`, add below the `fotos` require (still inside the stubbed-load window, i.e. before `Module._load = originalLoad;`):

```js
const pool = require("../config/database");
const ctrl = require("../controllers/meliAnunciosController");
```

Add before `async function run()`:

```js
const cliente = { id: 1, nome: "Cliente A", slug: "cliente-a", ativo: true };

async function comDb(linha, fn) {
  const q0 = pool.query, c0 = pool.connect;
  const db = { linha, updates: 0 };
  const query = async (sql, params = []) => {
    const q = String(sql).replace(/\s+/g, " ").trim();
    if (q.includes("FROM clientes WHERE LOWER(slug) = $1")) return { rows: params[0] === cliente.slug ? [cliente] : [] };
    if (q.includes("FROM clientes WHERE id = $1")) return { rows: [cliente] };
    if (q.startsWith("SELECT * FROM meli_anuncios WHERE cliente_id = $1 AND item_id = $2")) return { rows: linha ? [linha] : [] };
    if (q.startsWith("UPDATE meli_anuncios SET pictures_json")) {
      db.updates += 1;
      linha.pictures_json = JSON.parse(params[2]); linha.pictures_count = params[3];
      return { rows: [linha] };
    }
    return { rows: [] };
  };
  pool.query = query;
  pool.connect = async () => ({ query, release() {} });
  try { return await fn(db); } finally { pool.query = q0; pool.connect = c0; }
}

function fakeRes() {
  return { statusCode: 200, corpo: null, status(c) { this.statusCode = c; return this; }, json(o) { this.corpo = o; return this; } };
}

async function controller() {
  const linha = () => ({ id: 9, cliente_id: 1, item_id: "MLB9", catalog_listing: false, variations_count: 3,
    pictures_json: [url("R1"), url("R2"), url("R3"), url("P1")], pictures_count: 4, ml_user_id: "111" });

  // GET /fotos
  {
    const ml = mlSimulado(); mlHandler = ml.handler; mlChamadas = [];
    const res = fakeRes();
    await comDb(linha(), () => ctrl.lerFotosAnuncio({ params: { itemId: "MLB9" }, query: { clienteSlug: "cliente-a" } }, res));
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.corpo));
    assert.strictEqual(res.corpo.modo, "variacoes");
    assert.ok(mlChamadas.every((c) => c.mlUserId === "111"));
    ok("GET /fotos devolve a leitura com a conta do anúncio");
  }
  // PUT /fotos: sucesso grava snapshot; plano JSON inválido = 400 sem ML.
  {
    const ml = mlSimulado(); mlHandler = ml.handler; mlChamadas = [];
    const plano = { grupoVariacao: ROBALO, base: ["R1", "R2", "R3"], ordem: [{ existente: "R2" }, { nova: 0 }] };
    const res = fakeRes();
    const db = await comDb(linha(), async (d) => {
      await ctrl.salvarFotosAnuncio({ params: { itemId: "MLB9" }, query: { clienteSlug: "cliente-a" },
        body: { plano: JSON.stringify(plano) }, files: [arquivo()] }, res);
      return d;
    });
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.corpo));
    assert.strictEqual(db.updates, 1);
    assert.strictEqual(res.corpo.anuncio.pictures_count, 3);
    assert.deepStrictEqual(res.corpo.leitura.grupos[0].fotos.map((f) => f.id), ["R2", "N0"]);

    const res2 = fakeRes(); mlChamadas = [];
    await comDb(linha(), () => ctrl.salvarFotosAnuncio({ params: { itemId: "MLB9" }, query: { clienteSlug: "cliente-a" },
      body: { plano: "{isto não é json" }, files: [] }, res2));
    assert.strictEqual(res2.statusCode, 400);
    assert.strictEqual(res2.corpo.codigo, "PLANO_INVALIDO");
    assert.strictEqual(mlChamadas.length, 0);
    ok("PUT /fotos grava o snapshot confirmado; plano ilegível é 400 sem ML");
  }
  // Status HTTP por etapa + critico + pictureIds.
  {
    const ml = mlSimulado(); mlHandler = (c) => { const r = ml.handler(c); if (c.metodo === "PUT") ml.estado.item.variations.pop(); return r; };
    const res = fakeRes();
    const db = await comDb(linha(), async (d) => {
      await ctrl.salvarFotosAnuncio({ params: { itemId: "MLB9" }, query: { clienteSlug: "cliente-a" },
        body: { plano: JSON.stringify({ grupoVariacao: ROBALO, base: ["R1", "R2", "R3"], ordem: [{ existente: "R1" }] }) }, files: [] }, res);
      return d;
    });
    assert.strictEqual(res.statusCode, 422);
    assert.strictEqual(res.corpo.critico, true);
    assert.strictEqual(db.updates, 0);

    const res2 = fakeRes(); mlHandler = mlSimulado().handler;
    await comDb(linha(), () => ctrl.salvarFotosAnuncio({ params: { itemId: "MLB9" }, query: { clienteSlug: "cliente-a" },
      body: { plano: JSON.stringify({ grupoVariacao: ROBALO, base: ["R1"], ordem: [{ existente: "R1" }] }) }, files: [] }, res2));
    assert.strictEqual(res2.statusCode, 409);
    assert.strictEqual(res2.corpo.codigo, "FOTOS_DESATUALIZADAS");
    ok("PUT /fotos: crítico = 422 sem snapshot; desatualizado = 409");
  }
}
```

Change `run()` to call `await controller();` after `await orquestracao();`.

- [ ] **Step 2: Run to confirm failure**

Run: `node server/tests/meliAnunciosFotos.test.js`
Expected: FAIL with `ctrl.lerFotosAnuncio is not a function`.

- [ ] **Step 3: Controller**

In `server/controllers/meliAnunciosController.js`:

1. Next to the existing `imagensService` require, add:

```js
const fotosService = require("../services/meliAnuncios/meliFotosService");
```

2. In `adicionarImagem`, remove the `grupoVariacao` branch so it reads again:

```js
    const r = await imagensService.adicionarImagem({
      clienteId: cliente.id,
      itemId,
      mlUserId,
      anuncio,
      arquivo: req.file,
    });
```

and remove `grupo: r.grupo || null,` from its success JSON (keep `if (r.critico) corpo.critico = true;`).

3. Replace the whole `gruposImagemVariacoes` function (and its comment header) with:

```js
// ----------------------------------------------------------------------------
// Editor de fotos por grupo de variação — ver meliFotosService e
// docs/superpowers/specs/2026-09-30-fotos-por-variacao-design.md.
//
//   GET /anuncios-meli/:itemId/fotos   leitura AO VIVO (grupos, fotos, limite)
//   PUT /anuncios-meli/:itemId/fotos   multipart: plano (JSON) + novas[]
//
// clienteSlug só pela QUERY (o guard de carteira roda antes do multer).
// ----------------------------------------------------------------------------
async function contextoFotos(req, res) {
  const { itemId } = req.params;
  const query = req.query || {};
  if (!query.clienteSlug) {
    res.status(400).json({ ok: false, motivo: "Informe o clienteSlug." });
    return null;
  }
  const cliente = await anunciosService.resolverCliente(query.clienteSlug);
  if (!cliente) {
    res.status(404).json({ ok: false, motivo: "Cliente não encontrado." });
    return null;
  }
  const anuncio = await anunciosService.obterAnuncio(cliente.id, itemId);
  if (!anuncio) {
    res.status(404).json({ ok: false, motivo: "Anúncio não encontrado no banco. Sincronize os anúncios deste cliente." });
    return null;
  }
  let mlUserId = anuncio.ml_user_id || null;
  if (!mlUserId) {
    const contexto = await anunciosService.resolverContextoConta({
      clienteId: cliente.id,
      clienteContaId: extrairClienteContaId(query.clienteContaId),
      requireUsableGrant: true,
    });
    mlUserId = contexto.mlUserId;
  }
  return { itemId, cliente, anuncio, mlUserId };
}

function responderFalhaFotos(res, r) {
  const status = r.etapa === "validacao" ? r.statusHttp || 400 : r.etapa === "bloqueio" ? 409 : 422;
  const corpo = { ok: false, codigo: r.codigo, motivo: r.motivo, etapa: r.etapa };
  if (r.detalhesMl) corpo.detalhesMl = r.detalhesMl;
  if (r.pictureIds) corpo.pictureIds = r.pictureIds;
  if (r.critico) corpo.critico = true;
  return res.status(status).json(corpo);
}

async function lerFotosAnuncio(req, res) {
  try {
    const ctx = await contextoFotos(req, res);
    if (!ctx) return undefined;
    const r = await fotosService.lerFotos({ clienteId: ctx.cliente.id, itemId: ctx.itemId, mlUserId: ctx.mlUserId });
    if (!r.ok) return responderFalhaFotos(res, r);
    return res.json(r);
  } catch (err) {
    if (err.code === "MULTIPLE_MARKETPLACE_ACCOUNTS") return responderAmbiguidade(res, err);
    console.error("[anuncios-meli] lerFotosAnuncio:", err.message);
    return res.status(500).json({ ok: false, motivo: "Erro ao carregar as fotos do anúncio." });
  }
}

async function salvarFotosAnuncio(req, res) {
  try {
    let plano;
    try {
      plano = JSON.parse((req.body && req.body.plano) || "");
    } catch (_) {
      return res.status(400).json({ ok: false, codigo: "PLANO_INVALIDO", etapa: "validacao", motivo: "Plano de fotos ausente ou inválido." });
    }
    const ctx = await contextoFotos(req, res);
    if (!ctx) return undefined;
    const r = await fotosService.salvarFotos({
      clienteId: ctx.cliente.id, itemId: ctx.itemId, mlUserId: ctx.mlUserId,
      anuncio: ctx.anuncio, plano, arquivos: req.files || [],
    });
    if (!r.ok) return responderFalhaFotos(res, r);

    // Daqui para baixo o ML já confirmou: falha do banco vira
    // confirmacaoPendente, nunca "erro ao salvar" (induziria reenvio).
    let atualizado = ctx.anuncio;
    let confirmacaoPendente = r.confirmacaoPendente;
    if (r.fotos) {
      try {
        atualizado = (await anunciosService.atualizarFotosConfirmadas(ctx.cliente.id, ctx.itemId, r.fotos)) || ctx.anuncio;
      } catch (errSnapshot) {
        console.error(`[anuncios-meli] salvarFotosAnuncio: fotos de ${ctx.itemId} confirmadas no ML, mas o snapshot local falhou:`, errSnapshot.message);
        confirmacaoPendente = true;
      }
    }
    return res.json({ ok: true, anuncio: atualizado, leitura: r.leitura, confirmacaoPendente, novas: r.novas });
  } catch (err) {
    if (err.code === "MULTIPLE_MARKETPLACE_ACCOUNTS") return responderAmbiguidade(res, err);
    console.error("[anuncios-meli] salvarFotosAnuncio:", err.message);
    return res.status(500).json({ ok: false, motivo: "Erro interno ao salvar as fotos do anúncio." });
  }
}
```

4. In `module.exports`, replace `gruposImagemVariacoes,` with `lerFotosAnuncio,` and `salvarFotosAnuncio,`.

- [ ] **Step 4: Routes**

In `server/routes/meliAnunciosRoutes.js`, replace the two lines

```js
// Anúncio com variações: grupos de foto (atributo defines_picture) lidos ao
// vivo do ML. O envio usa a MESMA rota acima com ?grupoVariacao=<chave>.
router.get("/:itemId/imagens/variacoes", ctrl.gruposImagemVariacoes);
```

with

```js
// Editor de fotos por grupo de variação (adicionar / excluir / ordenar num
// único salvar). PUT = um PUT /items completo no ML — ver meliFotosService.
// clienteSlug na QUERY, pelo mesmo motivo do POST /imagens.
const uploadFotos = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 10 },
});
router.get("/:itemId/fotos", ctrl.lerFotosAnuncio);
router.put("/:itemId/fotos", uploadFotos.array("novas", 10), tratarErroUploadImagem, ctrl.salvarFotosAnuncio);
```

`multer`, `MAX_UPLOAD_BYTES` and `tratarErroUploadImagem` already exist in this file (added for `POST /imagens`). Check that `tratarErroUploadImagem` maps `LIMIT_FILE_COUNT` and `LIMIT_UNEXPECTED_FILE` to 400 `CAMPO_INVALIDO`; if its motivo mentions "uma imagem", generalize it to "Envie as imagens no campo esperado (até 10 por vez)." Also add both routes to the header comment list:

```js
//   GET    /anuncios-meli/:itemId/fotos         (editor de fotos: leitura ao vivo)
//   PUT    /anuncios-meli/:itemId/fotos         (editor de fotos: escrita real no ML)
```

- [ ] **Step 5: Remove the PR #205 add-to-variation flow**

In `server/services/meliAnuncios/meliImagensService.js` delete `gruposDeFotoDasVariacoes`, `listarGruposDeFotoVariacoes`, `montarPayloadVariacao`, `vincularImagemVariacao`, `falhaCriticaVariacao`, `conferirVinculoVariacao`, `grupoNoItem`, `adicionarImagemVariacao`, and their entries in `module.exports`. Keep `ATRIBUTOS_ITEM_VARIACAO`, the `MOTIVO_*` constants, `lerItemComVariacoes`, `atributosQueDefinemFoto`, `chaveDoValor` (delete it too if nothing references it: `grep -n chaveDoValor server -r`), `rotuloDaVariacao`, `elegibilidadeVariacoes`. Rewrite the big "VARIAÇÕES" comment block to say the ML model is documented there and the editor lives in `meliFotosService.js`.

Delete the file: `git rm server/tests/meliAnunciosImagensVariacoes.test.js`.

- [ ] **Step 6: Run the tests**

Run: `node server/tests/meliAnunciosFotos.test.js` → `✓ 29 verificações do editor de fotos`
Run: `node server/tests/meliAnunciosImagens.test.js` → `✓ 16 verificações de imagem de anúncio ML`
Run the backend suite (Global Constraints) → last line `✓ 280 arquivos de teste concluídos` (280 before Task 1, +1 new file in Task 1, −1 deleted here) with exit 0. If `jwtSecretBoot.test.js` times out, rerun it alone (known flake).
Check line endings: `python -c "b=open('server/controllers/meliAnunciosController.js','rb').read();print(b.count(b'\r\n')==b.count(b'\n'))"` → `True` (same for the routes file).

- [ ] **Step 7: Commit**

```bash
git add -A server/controllers/meliAnunciosController.js server/routes/meliAnunciosRoutes.js server/services/meliAnuncios/meliImagensService.js server/tests/meliAnunciosFotos.test.js server/tests/meliAnunciosImagensVariacoes.test.js
git commit -m "feat(anuncios-ml): GET/PUT photos endpoints replace add-to-variation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Portal — read-only photo editor (state, chips, grid)

**Files:**
- Modify: `Portal/anuncios-meli.js` (photo block ~lines 3734–4100, `abrirDetalhe` DET init ~3375, `renderDetalhe` ~3506–3530, `fecharDetalhe` ~3462, click delegation ~5936)
- Modify: `Portal/css/pages/anuncios-meli-v2.css`
- Test: `Portal/anuncios-meli-detalhe-modal-ui.test.js`

**Interfaces:**
- Consumes: `GET /anuncios-meli/:itemId/fotos` (Task 3). Existing helpers: `api(path)`, `el(id)`, `escapeHtml`, `escapeAttr`, `icAlerta`, `icCheck`, `icImagem`, `toast`, `renderDetalhe`, `carregarAnuncios`, `AM.clienteAtual.slug`, `AM.contaMlId`, `AM.token`, `API_BASE`, `DET.token`.
- Produces (used by Tasks 5–6): `DET.fotos` with shape
  `{ estado:null|"carregando"|"ok"|"erro", motivo, leitura, sel:number, itens:Item[], salvando:null|"enviando"|"processando", erro:{titulo,linhas,semRetry}|null, erroLocal:string|null, sucesso:string|null, pendente:null|{tipo:"grupo",destino:number}|{tipo:"fechar"}, arrastando:number|null }`,
  `Item = {tipo:"existente", id, url, removida:boolean} | {tipo:"nova", arquivo, previewUrl, nome, bytes, mime, width, height, removida:false}`;
  functions `fotosEstadoVazio()`, `carregarFotos()`, `iniciarRascunho(i)`, `fotosAtivas()`, `fotosSujas()`, `renderFotos()`, `fotosCorpoHtml()`, `liberarPreviewsFotos()`.

- [ ] **Step 1: Replace the headless mocks and write failing checks**

In `Portal/anuncios-meli-detalhe-modal-ui.test.js`:

1. Replace the block starting `// GET /anuncios-meli/:itemId/imagens/variacoes — null = dois grupos de Cor` through the end of `const GRUPOS_IMAGEM = {…};` with:

```js
// GET /anuncios-meli/:itemId/fotos — leitura do editor. variationsCountAtivo > 0
// devolve dois grupos (Robalo P/M, Preto P); senão a galeria simples.
// fotosLeituraResultado = { status, corpo } força a resposta.
let fotosLeituraResultado = null;
let fotosLeituraChamadas = 0;
const FOTO = (id) => ({ id, url: `https://img.example/${id}.jpg` });
function leituraFotos() {
  if (variationsCountAtivo > 0) {
    return { ok: true, modo: "variacoes", atributo: { id: "COLOR", nome: "Cor" }, limite: { porGrupo: 10, origem: "categoria" },
      grupos: [
        { grupoVariacao: { attribute_id: "COLOR", value_id: null, value_name: "Robalo" }, rotulo: "Robalo",
          variacoes: [{ id: "101", rotulo: "P" }, { id: "102", rotulo: "M" }], fotos: [FOTO("R1"), FOTO("R2"), FOTO("R3")] },
        { grupoVariacao: { attribute_id: "COLOR", value_id: "52028", value_name: "Preto" }, rotulo: "Preto",
          variacoes: [{ id: "103", rotulo: "P" }], fotos: [FOTO("P1")] },
      ] };
  }
  return { ok: true, modo: "simples", atributo: null, limite: { porGrupo: 12, origem: "categoria" },
    grupos: [{ grupoVariacao: null, rotulo: "", variacoes: [], fotos: [FOTO("A"), FOTO("B")] }] };
}
// PUT /anuncios-meli/:itemId/fotos — SEMPRE desviado para o servidor local
// (rede real: sob o Fetch do CDP o corpo multipart não é transmitido e
// xhr.upload não dispara load). fotosResultado = { status, corpo } força a
// resposta; senão o servidor aplica o plano sobre leituraFotos().
let fotosResultado = null;
let fotosAtrasoMs = 0;
const fotosChamadas = [];            // { url, metodo, plano, arquivos }
```

2. Replace the `// GET /anuncios-meli/:itemId/imagens/variacoes …` mock handler block with:

```js
    // GET/PUT /anuncios-meli/:itemId/fotos — editor de fotos.
    if (/^\/anuncios-meli\/[^/?]+\/fotos(\?|$)/.test(caminho)) {
      if (params.request.method === "PUT" || params.request.method === "OPTIONS") {
        const qs = caminho.slice(caminho.indexOf("/fotos") + "/fotos".length);
        await respond("Fetch.continueRequest", { requestId: params.requestId, url: `http://127.0.0.1:${portaLocal}/__fotos${qs}` });
        return;
      }
      fotosLeituraChamadas += 1;
      if (fotosLeituraResultado) { await corpo(fotosLeituraResultado.corpo, fotosLeituraResultado.status); return; }
      await corpo(leituraFotos());
      return;
    }
```

3. In the local static server (`http.createServer`), add next to the `/__imagens` line:

```js
    if (u.pathname === "/__fotos") { servirFotosLocal(req, res, u); return; }
```

and add after `servirImagemLocal`:

```js
// Destino do PUT /fotos. Lê o multipart, extrai `plano` e conta os arquivos,
// e responde aplicando o plano sobre leituraFotos() (ou fotosResultado).
function servirFotosLocal(req, res, u) {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization,content-type",
    "access-control-allow-methods": "PUT,OPTIONS",
  };
  if (req.method === "OPTIONS") { res.writeHead(204, cors).end(); return; }
  const partes = [];
  req.on("data", (c) => partes.push(c));
  req.on("end", async () => {
    const texto = Buffer.concat(partes).toString("latin1");
    const m = texto.match(/name="plano"\r\n\r\n([\s\S]*?)\r\n--/);
    const plano = m ? JSON.parse(Buffer.from(m[1], "latin1").toString("utf8")) : null;
    const arquivos = (texto.match(/name="novas"; filename=/g) || []).length;
    fotosChamadas.push({ url: u.pathname + u.search, metodo: req.method, plano, arquivos });
    if (fotosAtrasoMs) await sleep(fotosAtrasoMs);
    res.writeHead(fotosResultado ? fotosResultado.status : 200, Object.assign({ "content-type": "application/json" }, cors));
    if (fotosResultado) { res.end(JSON.stringify(fotosResultado.corpo)); return; }
    const leitura = leituraFotos();
    const idx = plano && plano.grupoVariacao
      ? leitura.grupos.findIndex((g) => g.rotulo === plano.grupoVariacao.value_name) : 0;
    leitura.grupos[idx].fotos = plano.ordem.map((e) => (e.existente ? FOTO(e.existente) : FOTO(`NOVA${e.nova}`)));
    const base = anuncio(u.searchParams.get("clienteContaId") || "42");
    base.variations_count = variationsCountAtivo;
    base.pictures_json = leitura.grupos.flatMap((g) => g.fotos.map((f) => f.url));
    base.pictures_count = base.pictures_json.length;
    res.end(JSON.stringify({ ok: true, anuncio: base, leitura, confirmacaoPendente: false, novas: [] }));
  });
}
```

4. Delete the old image checks 7e, 7f, 7g, 7h, 7i, 7j (from `/* ── 7e a 7h: adicionar imagem` up to, not including, `await check("8 — …`) but keep the helpers `escolherArquivo` and `textoEnvio` (rename `textoEnvio` to read `am-det-fotos-corpo`). Replace `infoFotos` with:

```js
    function infoFotos() {
      return cdp.evaluate(`(function(){
        var corpo = document.getElementById('am-det-fotos-corpo');
        var chips = Array.from(document.querySelectorAll('.am-det-fotos__chip'));
        var tiles = Array.from(document.querySelectorAll('.am-det-fotos__item'));
        return {
          texto: corpo ? corpo.innerText : '',
          chips: chips.map(function(c){ return c.innerText.replace(/\\s+/g,' ').trim(); }),
          chipAtivo: (chips.find(function(c){ return c.getAttribute('aria-pressed') === 'true'; }) || {}).innerText || '',
          titulo: ((document.querySelector('.am-det-fotos__titulo') || {}).innerText || '').trim(),
          ids: tiles.map(function(t){ return t.getAttribute('data-foto'); }),
          removidas: tiles.filter(function(t){ return t.classList.contains('is-removida'); }).map(function(t){ return t.getAttribute('data-foto'); }),
          selo: ((document.querySelector('.am-det-fotos__selo') || {}).innerText || '').trim(),
          add: !!document.querySelector('[data-acao="foto-escolher"]'),
          addDisabled: (document.querySelector('[data-acao="foto-escolher"]') || {}).disabled,
          barra: ((document.querySelector('.am-det-fotos__barra') || {}).innerText || ''),
          bloqueio: ((document.querySelector('.am-det-fotos__bloqueio') || {}).innerText || ''),
        }; })()`);
    }
    const textoFotos = "((document.getElementById('am-det-fotos-corpo') || {}).innerText || '')";
```

5. Add the first new checks (where 7e was):

```js
    await check("7e — anúncio sem variação: 'Fotos do anúncio', 'Capa do anúncio' na primeira, sem chips; catálogo bloqueado com o motivo", async () => {
      await abrirComModo("nenhum");
      await abrirPrimeiroAnuncio(cdp);
      await waitFor(cdp, `/Fotos do anúncio/.test(${textoFotos})`, "o editor de fotos não carregou");
      const f = await infoFotos();
      assert.deepStrictEqual(f.chips, []);
      assert.deepStrictEqual(f.ids, ["A", "B"]);
      assert.strictEqual(f.selo, "Capa do anúncio");
      assert.ok(f.add && !f.addDisabled);

      await abrirComModo("catalog_listing");
      await abrirPrimeiroAnuncio(cdp);
      const cat = await infoFotos();
      assert.ok(/catálogo/i.test(cat.bloqueio), `catálogo precisa dizer o motivo: ${cat.bloqueio}`);
      assert.strictEqual(cat.add, false, "catálogo não oferece adicionar");
      await abrirComModo("nenhum");
      await abrirPrimeiroAnuncio(cdp);
    });

    await check("7f — com variações: chips por grupo com quantidade, grupo selecionado visível e 'Imagem principal da variação' na primeira", async () => {
      variationsCountAtivo = 3;
      try {
        await abrirComModo("nenhum");
        await abrirPrimeiroAnuncio(cdp);
        await waitFor(cdp, `/Fotos da variação: Robalo/.test(${textoFotos})`, "o grupo selecionado não apareceu");
        const f = await infoFotos();
        assert.deepStrictEqual(f.chips, ["Robalo · 3", "Preto · 1"]);
        assert.strictEqual(f.chipAtivo.replace(/\s+/g, " ").trim(), "Robalo · 3");
        assert.strictEqual(f.titulo, "Fotos da variação: Robalo");
        assert.deepStrictEqual(f.ids, ["R1", "R2", "R3"]);
        assert.strictEqual(f.selo, "Imagem principal da variação");
        await clicar(cdp, '.am-det-fotos__chip[data-idx="1"]');
        await waitFor(cdp, `/Fotos da variação: Preto/.test(${textoFotos})`, "trocar de grupo (sem rascunho) não trocou");
        assert.deepStrictEqual((await infoFotos()).ids, ["P1"]);

        fotosLeituraResultado = { status: 409, corpo: { ok: false, codigo: "ATRIBUTO_FOTO_INDEFINIDO", etapa: "bloqueio",
          motivo: "O Mercado Livre não indica, para a categoria deste anúncio, qual atributo das variações define a foto (defines_picture)." } };
        await abrirComModo("nenhum");
        await abrirPrimeiroAnuncio(cdp);
        await waitFor(cdp, `/defines_picture/.test(${textoFotos})`, "a recusa do backend precisa aparecer");
        assert.strictEqual((await infoFotos()).add, false);
      } finally {
        variationsCountAtivo = 0;
        fotosLeituraResultado = null;
      }
      await abrirComModo("nenhum");
      await abrirPrimeiroAnuncio(cdp);
    });
```

- [ ] **Step 2: Run to confirm failure**

Run the modal headless suite. Expected: checks 1–4x pass, then `not ok`/Error at 7e: "o editor de fotos não carregou".

- [ ] **Step 3: Implement the read-only editor**

In `Portal/anuncios-meli.js`:

1. In `abrirDetalhe` DET init, replace

```js
      imagem: imagemEstadoVazio(),
      // Anúncio com variações: grupos de foto lidos do ML sob demanda
      // (GET .../imagens/variacoes). null = ainda não pedido.
      imagemVar: null,
```

(and its two comment lines above `imagem:`) with:

```js
      // Editor de fotos por grupo de variação — ver bloco "Fotos: editor".
      fotos: fotosEstadoVazio(),
```

2. `renderDetalhe` keeps calling `fotosHtml(pics, a)` and `bindFotos()`; no change there (the new functions below keep those two names).

3. In `fecharDetalhe`, replace `liberarPreviewImagem();` with `liberarPreviewsFotos();`.

4. Delete, from `// ----- Fotos ----` through the end of `function enviarImagem() {…}`: old `fotosHtml`, `imagemBloqueio`, `imagemTemVariacoes`, `carregarGruposImagem`, `grupoImagemRotulo`, `imagemVariacoesHtml`, `renderFotosVariacoes`, `imagemEstadoVazio`, `liberarPreviewImagem`, `imagemEnvioHtml`, `renderImagemEnvio`, `bindFotos`, `selecionarImagem`, `cancelarImagem`, `enviarImagem`. **Keep** `IMAGEM_ACCEPT`, `IMAGEM_TIPOS`, `IMAGEM_MAX_BYTES`, `IMAGEM_MIN_LADO_ML`, `imagemReplicaEmProduto`, `fmtTamanhoArquivo`, `erroImagemDe`.

5. Insert in their place:

```js
  // ----- Fotos: editor por grupo de variação ---------------------------------
  // GET/PUT /anuncios-meli/:itemId/fotos (meliFotosService). Grupo = valor do
  // atributo que define a foto no ML (ex.: Cor Robalo); anúncio sem variação é
  // um grupo só. TUDO fica em memória (DET.fotos.itens) até "Salvar no Mercado
  // Livre", que manda o plano inteiro num único PUT. A primeira foto ativa do
  // grupo é a imagem principal da variação (ou a capa do anúncio).
  var IMAGEM_ACCEPT = "image/jpeg,image/png,image/webp";
  var IMAGEM_TIPOS = { "image/jpeg": "JPG", "image/jpg": "JPG", "image/png": "PNG", "image/webp": "WebP" };
  var IMAGEM_MAX_BYTES = 10 * 1024 * 1024;   // mesmo limite do multer no backend
  var IMAGEM_MIN_LADO_ML = 500;              // mínimo documentado pelo ML (só aviso)
  var FOTOS_MAX_NOVAS = 10;                  // mesmo limite do multer (files: 10)

  function fotosEstadoVazio() {
    return { estado: null, motivo: null, leitura: null, sel: 0, itens: [], salvando: null,
             erro: null, erroLocal: null, sucesso: null, pendente: null, arrastando: null };
  }

  function fotosVariacoes() {
    var F = DET && DET.fotos;
    return !!(F && F.leitura && F.leitura.modo === "variacoes");
  }

  function grupoSelecionado() {
    var F = DET.fotos;
    return F.leitura ? F.leitura.grupos[F.sel] : null;
  }

  function liberarPreviewsFotos() {
    if (!DET || !DET.fotos) return;
    DET.fotos.itens.forEach(function (it) {
      if (it.tipo === "nova" && it.previewUrl) {
        try { URL.revokeObjectURL(it.previewUrl); } catch (_) { /* nada a liberar */ }
        it.previewUrl = null;
      }
    });
  }

  function iniciarRascunho(i) {
    var F = DET.fotos;
    liberarPreviewsFotos();
    F.sel = i;
    F.itens = F.leitura.grupos[i].fotos.map(function (f) {
      return { tipo: "existente", id: f.id, url: f.url, removida: false };
    });
    F.erro = null;
    F.erroLocal = null;
  }

  function fotosAtivas() {
    return DET.fotos.itens.filter(function (it) { return !it.removida; });
  }

  function fotosSujas() {
    var F = DET && DET.fotos;
    if (!F || F.estado !== "ok" || !F.leitura) return false;
    var base = grupoSelecionado().fotos.map(function (f) { return f.id; });
    var ativos = fotosAtivas();
    if (ativos.length !== base.length) return true;
    return ativos.some(function (it, i) { return it.tipo === "nova" || it.id !== base[i]; });
  }

  function carregarFotos() {
    if (!DET || !DET.anuncio || DET.fotos.estado) return;
    if (DET.anuncio.catalog_listing === true) {
      DET.fotos.estado = "erro";
      DET.fotos.motivo = "Este anúncio é de catálogo: as fotos exibidas são do produto de catálogo do Mercado Livre e não podem ser alteradas por aqui.";
      return;
    }
    var meuToken = DET.token;
    DET.fotos.estado = "carregando";
    var qs = "clienteSlug=" + encodeURIComponent(AM.clienteAtual.slug) +
      (AM.contaMlId ? "&clienteContaId=" + encodeURIComponent(AM.contaMlId) : "");
    api("/anuncios-meli/" + encodeURIComponent(DET.anuncio.item_id) + "/fotos?" + qs).then(function (r) {
      if (!DET || DET.token !== meuToken) return;
      var d = r.data || {};
      if (d.ok && Array.isArray(d.grupos) && d.grupos.length) {
        DET.fotos.estado = "ok";
        DET.fotos.leitura = d;
        iniciarRascunho(0);
      } else {
        DET.fotos.estado = "erro";
        DET.fotos.motivo = d.motivo || (r.status === 0 ? "Falha de conexão ao carregar as fotos." : "Não foi possível carregar as fotos do anúncio.");
      }
      renderFotos();
    });
  }

  function fotosHtml(pics, a) {
    var alerta = pics.length < 3
      ? '<span class="am-det-alert">' + icAlerta(12) + "Recomendado ter pelo menos 3 fotos</span>"
      : "";
    return '<div class="am-det-section">' +
      '<div class="am-det-section__head">' +
        '<h3 class="am-det-section__title">Fotos <span class="am-det-section__meta">(' + pics.length + ")</span></h3>" +
        alerta +
      "</div>" +
      '<input type="file" id="am-det-img-input" class="am-hidden" accept="' + IMAGEM_ACCEPT + '" multiple />' +
      '<div id="am-det-fotos-corpo" class="am-det-fotos">' + fotosCorpoHtml() + "</div>" +
    "</div>";
  }

  function fotoItemHtml(it, i, principal, podeRemover, ocupado) {
    var src = it.tipo === "nova" ? it.previewUrl : it.url;
    var chave = it.tipo === "nova" ? "nova-" + i : it.id;
    var rotulo = it.tipo === "nova" ? (it.nome || "Nova imagem") : "Foto";
    var acoes = ocupado ? "" : it.removida
      ? '<button type="button" class="vf-btn vf-btn--ghost vf-btn--sm" data-acao="foto-desfazer" data-idx="' + i + '">Desfazer</button>'
      : '<span class="am-det-fotos__acoes">' +
          '<button type="button" class="am-det-fotos__btn" data-acao="foto-mover" data-dir="-1" data-idx="' + i + '" aria-label="Mover para a esquerda">←</button>' +
          '<button type="button" class="am-det-fotos__btn" data-acao="foto-mover" data-dir="1" data-idx="' + i + '" aria-label="Mover para a direita">→</button>' +
          (podeRemover ? '<button type="button" class="am-det-fotos__btn am-det-fotos__btn--remover" data-acao="foto-remover" data-idx="' + i + '" aria-label="Excluir foto">×</button>' : "") +
        "</span>";
    var aviso = it.tipo === "nova" && it.width && it.height && Math.min(it.width, it.height) < IMAGEM_MIN_LADO_ML
      ? '<span class="am-det-fotos__aviso">' + icAlerta(10) + " abaixo de " + IMAGEM_MIN_LADO_ML + " px</span>" : "";
    return '<div class="am-det-fotos__item' + (it.removida ? " is-removida" : "") + (it.tipo === "nova" ? " is-nova" : "") + '"' +
        ' data-foto="' + escapeAttr(chave) + '" data-idx="' + i + '"' + (ocupado || it.removida ? "" : ' draggable="true"') + ">" +
      (src ? '<img src="' + escapeAttr(src) + '" alt="' + escapeAttr(rotulo) + '" loading="lazy" />' : icImagem(20)) +
      (principal ? '<span class="am-det-fotos__selo">' + (fotosVariacoes() ? "Imagem principal da variação" : "Capa do anúncio") + "</span>" : "") +
      (it.removida ? '<span class="am-det-fotos__removida">Será removida</span>' : "") +
      (it.tipo === "nova" && !it.removida ? '<span class="am-det-fotos__nova">Nova</span>' : "") +
      aviso + acoes +
    "</div>";
  }

  function fotosCorpoHtml() {
    var F = DET && DET.fotos;
    if (!F || !F.estado || F.estado === "carregando") {
      return '<p class="am-det-fotos__info">Carregando as fotos do anúncio no Mercado Livre…</p>';
    }
    if (F.estado === "erro") {
      return '<p class="am-det-fotos__bloqueio" role="status">' + escapeHtml(F.motivo || "") + "</p>";
    }
    var ocupado = !!F.salvando;
    var g = grupoSelecionado();
    var chips = "";
    if (fotosVariacoes()) {
      chips = '<div class="am-det-fotos__chips" role="group" aria-label="Grupos de variação">' +
        F.leitura.grupos.map(function (gr, i) {
          var n = i === F.sel ? fotosAtivas().length : gr.fotos.length;
          return '<button type="button" class="am-det-fotos__chip" data-acao="foto-grupo" data-idx="' + i + '" aria-pressed="' + (i === F.sel) + '"' +
            (ocupado ? " disabled" : "") + ">" + escapeHtml(gr.rotulo) + " · " + n + "</button>";
        }).join("") + "</div>";
    }
    var titulo = fotosVariacoes() ? "Fotos da variação: " + g.rotulo : "Fotos do anúncio";
    var combos = fotosVariacoes() && g.variacoes.length
      ? ' <span class="am-det-section__meta">(' + escapeHtml(g.variacoes.map(function (v) { return v.rotulo; }).filter(Boolean).join(", ")) + ")</span>"
      : "";
    var ativos = fotosAtivas().length;
    var primeiroAtivo = F.itens.findIndex(function (it) { return !it.removida; });
    var grade = '<div class="am-det-fotos__grade" id="am-det-fotos-grade">' +
      F.itens.map(function (it, i) {
        return fotoItemHtml(it, i, i === primeiroAtivo, ativos > 1, ocupado);
      }).join("") +
      '<button type="button" class="am-det-photo am-det-photo--add" data-acao="foto-escolher"' + (ocupado ? " disabled" : "") + ">" +
        '<span class="am-det-photo__add-plus" aria-hidden="true">+</span>' +
        '<span class="am-det-photo__add-label">Adicionar imagem</span>' +
      "</button>" +
    "</div>";
    return chips +
      '<p class="am-det-fotos__titulo">' + escapeHtml(titulo) + combos + "</p>" +
      grade +
      fotosRodapeHtml();
  }

  // Barra de rascunho, validação, diálogo pendente e estados do salvar —
  // preenchida nas Tasks 5 e 6.
  function fotosRodapeHtml() {
    return "";
  }

  function renderFotos() {
    if (!DET) return;
    var slot = el("am-det-fotos-corpo");
    if (slot) slot.innerHTML = fotosCorpoHtml();
  }

  function bindFotos() {
    carregarFotos();
  }
```

6. In the click delegation, replace the three `img-escolher` / `img-enviar` / `img-cancelar` lines with:

```js
    if (acao === "foto-grupo") { selecionarGrupoFotos(Number(alvo.getAttribute("data-idx"))); return; }
```

and add (Task 5 extends this):

```js
  function selecionarGrupoFotos(i) {
    var F = DET && DET.fotos;
    if (!F || F.estado !== "ok" || F.salvando || i === F.sel) return;
    iniciarRascunho(i);
    renderFotos();
  }
```

7. CSS: in `Portal/css/pages/anuncios-meli-v2.css`, delete the rules for `.am-det-img-bloqueio`, `.am-det-img-envio*` and `.am-det-img-var*`, and add:

```css
/* ----- Editor de fotos por grupo de variação ----- */

.vf-page-anuncios-meli .am-det-fotos {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.vf-page-anuncios-meli .am-det-fotos__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.vf-page-anuncios-meli .am-det-fotos__chip {
  padding: 4px 10px;
  border: 1px solid var(--vf-border);
  border-radius: 999px;
  background: var(--vf-surface);
  color: var(--vf-text);
  font-size: var(--vf-fs-xs);
  cursor: pointer;
}

.vf-page-anuncios-meli .am-det-fotos__chip[aria-pressed="true"] {
  border-color: var(--vf-primary);
  background: var(--vf-primary-soft);
  font-weight: var(--vf-fw-semibold);
}

.vf-page-anuncios-meli .am-det-fotos__titulo {
  margin: 0;
  font-size: var(--vf-fs-xs);
  font-weight: var(--vf-fw-semibold);
  color: var(--vf-text);
}

.vf-page-anuncios-meli .am-det-fotos__info,
.vf-page-anuncios-meli .am-det-fotos__bloqueio {
  margin: 0;
  font-size: var(--vf-fs-xs);
  color: var(--vf-text-muted);
}

.vf-page-anuncios-meli .am-det-fotos__bloqueio {
  color: var(--vf-warning-strong);
}

.vf-page-anuncios-meli .am-det-fotos__grade {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
  gap: 8px;
}

.vf-page-anuncios-meli .am-det-fotos__item {
  position: relative;
  aspect-ratio: 1;
  overflow: hidden;
  border: 1px solid var(--vf-border);
  border-radius: var(--vf-radius-sm);
  background: var(--vf-surface);
}

.vf-page-anuncios-meli .am-det-fotos__item[draggable="true"] {
  cursor: grab;
}

.vf-page-anuncios-meli .am-det-fotos__item.is-arrastando {
  opacity: 0.4;
}

.vf-page-anuncios-meli .am-det-fotos__item.is-alvo {
  border-color: var(--vf-primary);
}

.vf-page-anuncios-meli .am-det-fotos__item img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.vf-page-anuncios-meli .am-det-fotos__item.is-removida img {
  opacity: 0.3;
}

.vf-page-anuncios-meli .am-det-fotos__selo,
.vf-page-anuncios-meli .am-det-fotos__nova,
.vf-page-anuncios-meli .am-det-fotos__removida {
  position: absolute;
  top: 4px;
  left: 4px;
  right: 4px;
  padding: 2px 6px;
  border-radius: var(--vf-radius-sm);
  background: var(--vf-surface);
  color: var(--vf-text);
  font-size: 10px;
  font-weight: var(--vf-fw-semibold);
  line-height: 1.3;
}

.vf-page-anuncios-meli .am-det-fotos__nova {
  top: auto;
  bottom: 30px;
  right: auto;
  color: var(--vf-primary);
}

.vf-page-anuncios-meli .am-det-fotos__removida {
  top: 40%;
  text-align: center;
  color: var(--vf-danger-strong);
}

.vf-page-anuncios-meli .am-det-fotos__aviso {
  position: absolute;
  left: 4px;
  bottom: 30px;
  font-size: 10px;
  color: var(--vf-warning-strong);
}

.vf-page-anuncios-meli .am-det-fotos__acoes {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  justify-content: space-between;
  padding: 4px;
}

.vf-page-anuncios-meli .am-det-fotos__item > .vf-btn {
  position: absolute;
  left: 50%;
  bottom: 6px;
  transform: translateX(-50%);
}

.vf-page-anuncios-meli .am-det-fotos__btn {
  min-width: 24px;
  height: 24px;
  border: 1px solid var(--vf-border);
  border-radius: var(--vf-radius-sm);
  background: var(--vf-surface);
  color: var(--vf-text);
  cursor: pointer;
}

.vf-page-anuncios-meli .am-det-fotos__btn--remover {
  margin-left: auto;
  color: var(--vf-danger-strong);
}

.vf-page-anuncios-meli .am-det-fotos__barra,
.vf-page-anuncios-meli .am-det-fotos__pendente,
.vf-page-anuncios-meli .am-det-fotos__estado {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid var(--vf-border);
  border-radius: var(--vf-radius-sm);
  background: var(--vf-bg-2);
  font-size: var(--vf-fs-xs);
}

.vf-page-anuncios-meli .am-det-fotos__barra-texto {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--vf-text);
}

.vf-page-anuncios-meli .am-det-fotos__estado.is-danger {
  border-color: var(--vf-danger-border);
  color: var(--vf-danger-strong);
  flex-direction: column;
  align-items: flex-start;
}

.vf-page-anuncios-meli .am-det-fotos__estado.is-success {
  border-color: var(--vf-success-border);
  background: var(--vf-success-bg);
  color: var(--vf-success-strong);
}

.vf-page-anuncios-meli .am-det-fotos__estado :where(p) {
  margin: 0;
}
```

- [ ] **Step 4: Run the headless suite**

Run the modal headless suite. Expected: 7e and 7f `ok`; everything after them `ok`; last line "nenhuma exceção de JS não tratada".
Check CRLF for `Portal/anuncios-meli.js`, the CSS and the test file (same Python one-liner as Task 3) → `True`.

- [ ] **Step 5: Commit**

```bash
git add Portal/anuncios-meli.js Portal/css/pages/anuncios-meli-v2.css Portal/anuncios-meli-detalhe-modal-ui.test.js
git commit -m "feat(anuncios-ml): photo editor reads groups live and shows chips

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Portal — in-memory editing (drag, arrows, delete, add, draft bar, validation)

**Files:**
- Modify: `Portal/anuncios-meli.js` (photo editor block, click delegation)
- Test: `Portal/anuncios-meli-detalhe-modal-ui.test.js`

**Interfaces:**
- Consumes: Task 4 state and functions.
- Produces: `moverFoto(de, para)`, `removerFoto(i)`, `desfazerFoto(i)`, `adicionarArquivosFotos(files)`, `descartarFotos()`, `validarRascunhoFotos() -> string|null`, `contarAlteracoesFotos() -> number`; `fotosRodapeHtml()` now renders the draft bar and local messages (Task 6 appends pending dialog + save states).

- [ ] **Step 1: Write the failing checks** (after 7f)

```js
    // Arrastar nativo via eventos sintéticos (o CDP não arrasta de verdade).
    async function arrastar(de, para) {
      await cdp.evaluate(`(function(){
        var itens = document.querySelectorAll('.am-det-fotos__item');
        var a = itens[${de}], b = itens[${para}], dt = new DataTransfer();
        a.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
        b.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
        b.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
        a.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
        return true; })()`);
    }

    await check("7g — reordenar (arrastar e setas), excluir pendente com desfazer e adicionar em memória; nada é enviado", async () => {
      variationsCountAtivo = 3;
      const antes = fotosChamadas.length;
      try {
        await abrirComModo("nenhum");
        await abrirPrimeiroAnuncio(cdp);
        await waitFor(cdp, `/Fotos da variação: Robalo/.test(${textoFotos})`, "o editor não carregou");

        await arrastar(2, 0);
        let f = await infoFotos();
        assert.deepStrictEqual(f.ids, ["R3", "R1", "R2"], "arrastar R3 para o início");
        assert.strictEqual(await cdp.evaluate(`document.querySelector('.am-det-fotos__item').querySelector('.am-det-fotos__selo') !== null`), true,
          "a primeira foto leva o selo de imagem principal");

        await clicar(cdp, '.am-det-fotos__item[data-foto="R1"] [data-acao="foto-mover"][data-dir="1"]');
        f = await infoFotos();
        assert.deepStrictEqual(f.ids, ["R3", "R2", "R1"], "seta → move uma posição");

        await clicar(cdp, '.am-det-fotos__item[data-foto="R2"] [data-acao="foto-remover"]');
        f = await infoFotos();
        assert.deepStrictEqual(f.removidas, ["R2"]);
        assert.ok(/Será removida/.test(f.texto));
        await clicar(cdp, '.am-det-fotos__item[data-foto="R2"] [data-acao="foto-desfazer"]');
        assert.deepStrictEqual((await infoFotos()).removidas, []);
        await clicar(cdp, '.am-det-fotos__item[data-foto="R2"] [data-acao="foto-remover"]');

        await escolherArquivo({ png: true, largura: 800, altura: 800, nome: "nova.png" });
        await waitFor(cdp, "document.querySelector('.am-det-fotos__item.is-nova img')", "a foto nova não entrou no rascunho");
        f = await infoFotos();
        assert.deepStrictEqual(f.ids, ["R3", "R2", "R1", "nova-3"]);
        assert.deepStrictEqual(f.chips, ["Robalo · 3", "Preto · 1"], "a contagem do chip segue o rascunho (3 − 1 + 1)");
        assert.ok(/3 alterações nas fotos de Robalo/.test(f.barra), `barra de rascunho: ${f.barra}`);
        assert.ok(/Salvar no Mercado Livre/.test(f.barra) && /Descartar/.test(f.barra));
        assert.strictEqual(fotosChamadas.length, antes, "nada pode ir ao ML antes do Salvar");

        await clicar(cdp, '[data-acao="foto-descartar"]');
        f = await infoFotos();
        assert.deepStrictEqual(f.ids, ["R1", "R2", "R3"], "descartar volta ao estado lido");
        assert.strictEqual(f.barra, "");
      } finally {
        variationsCountAtivo = 0;
      }
    });

    await check("7h — a última foto ativa do grupo não tem lixeira; o limite bloqueia o salvar com a mensagem exata e sem chamar o backend", async () => {
      variationsCountAtivo = 3;
      try {
        await abrirComModo("nenhum");
        await abrirPrimeiroAnuncio(cdp);
        await waitFor(cdp, `/Fotos da variação: Robalo/.test(${textoFotos})`, "o editor não carregou");
        await clicar(cdp, '.am-det-fotos__chip[data-idx="1"]');
        await waitFor(cdp, `/Fotos da variação: Preto/.test(${textoFotos})`, "não trocou de grupo");
        assert.strictEqual(await cdp.evaluate(`document.querySelectorAll('[data-acao="foto-remover"]').length`), 0,
          "a única foto do grupo não pode ser excluída");

        // Com uma nova + P1, remover P1 deixa só a nova ativa — que perde a lixeira.
        await escolherArquivo({ png: true, largura: 800, altura: 800, nome: "a.png" });
        await waitFor(cdp, "document.querySelector('.am-det-fotos__item.is-nova')", "nova não entrou");
        await clicar(cdp, '.am-det-fotos__item[data-foto="P1"] [data-acao="foto-remover"]');
        const semLixeira = await cdp.evaluate(`document.querySelectorAll('.am-det-fotos__item:not(.is-removida) [data-acao="foto-remover"]').length`);
        assert.strictEqual(semLixeira, 0, "com uma ativa só, ela perde a lixeira");

        // Limite: 10 no grupo (leitura diz porGrupo 10) — Preto tem 1 ativa; adiciona 10.
        await clicar(cdp, '[data-acao="foto-descartar"]');
        for (let i = 0; i < 10; i++) {
          await escolherArquivo({ png: true, largura: 600, altura: 600, nome: `x${i}.png` });
        }
        await waitFor(cdp, "document.querySelectorAll('.am-det-fotos__item.is-nova').length === 10", "as 10 novas não entraram");
        await clicar(cdp, '[data-acao="foto-salvar"]');
        await waitFor(cdp, `/Não é possível salvar\\. A variação Preto pode ter no máximo 10 imagens\\./.test(${textoFotos})`,
          "o limite não bloqueou com a mensagem exata");
        assert.strictEqual(fotosChamadas.filter((c) => c.metodo === "PUT").length, 0, "bloqueio local não chama o backend");
        await clicar(cdp, '[data-acao="foto-descartar"]');
      } finally {
        variationsCountAtivo = 0;
      }
    });
```

Note: `escolherArquivo` sets `inp.files` to one file and dispatches `change`; the new input is `multiple`, so one file per call is fine.

- [ ] **Step 2: Run to confirm failure**

Run the modal headless suite → FAIL at 7g ("arrastar R3 para o início").

- [ ] **Step 3: Implement editing**

Add to the photo editor block in `Portal/anuncios-meli.js`:

```js
  function editavel() {
    var F = DET && DET.fotos;
    return !!(F && F.estado === "ok" && !F.salvando);
  }

  function moverFoto(de, para) {
    var F = DET.fotos;
    if (!editavel() || de === para || de < 0 || para < 0 || de >= F.itens.length || para >= F.itens.length) return;
    var it = F.itens.splice(de, 1)[0];
    F.itens.splice(para, 0, it);
    F.erroLocal = null;
    F.sucesso = null;
    renderFotos();
  }

  // Seta: pula para a próxima foto ATIVA na direção (removidas não contam).
  function moverFotoSeta(i, dir) {
    var F = DET.fotos;
    var j = i + dir;
    while (j >= 0 && j < F.itens.length && F.itens[j].removida) j += dir;
    if (j < 0 || j >= F.itens.length) return;
    moverFoto(i, j);
  }

  function removerFoto(i) {
    var F = DET.fotos;
    if (!editavel() || !F.itens[i] || fotosAtivas().length <= 1) return;
    F.itens[i].removida = true;
    F.sucesso = null;
    renderFotos();
  }

  function desfazerFoto(i) {
    if (!editavel() || !DET.fotos.itens[i]) return;
    DET.fotos.itens[i].removida = false;
    renderFotos();
  }

  function adicionarArquivosFotos(files) {
    var F = DET && DET.fotos;
    if (!editavel()) return;
    F.erroLocal = null;
    F.sucesso = null;
    Array.prototype.forEach.call(files || [], function (f) {
      var mime = String(f.type || "").toLowerCase();
      var novas = F.itens.filter(function (it) { return it.tipo === "nova" && !it.removida; }).length;
      if (!IMAGEM_TIPOS[mime]) { F.erroLocal = "Formato não aceito. Envie uma imagem JPG, PNG ou WebP."; return; }
      if ((f.size || 0) > IMAGEM_MAX_BYTES) { F.erroLocal = "Arquivo com " + fmtTamanhoArquivo(f.size) + " — o limite é 10 MB."; return; }
      if (novas >= FOTOS_MAX_NOVAS) { F.erroLocal = "Adicione até " + FOTOS_MAX_NOVAS + " imagens por vez. Salve antes de adicionar mais."; return; }
      var it = { tipo: "nova", arquivo: f, previewUrl: null, nome: f.name || "imagem", bytes: f.size || 0, mime: mime,
                 width: null, height: null, removida: false };
      try { it.previewUrl = URL.createObjectURL(f); } catch (_) { it.previewUrl = null; }
      F.itens.push(it);
      if (it.previewUrl) {
        var meuToken = DET.token;
        var probe = new Image();
        probe.onload = function () {
          if (!DET || DET.token !== meuToken) return;
          it.width = probe.naturalWidth;
          it.height = probe.naturalHeight;
          renderFotos();
        };
        probe.onerror = function () {
          if (!DET || DET.token !== meuToken) return;
          var idx = DET.fotos.itens.indexOf(it);
          if (idx >= 0) DET.fotos.itens.splice(idx, 1);
          try { URL.revokeObjectURL(it.previewUrl); } catch (_) { /* nada */ }
          DET.fotos.erroLocal = "Não foi possível ler este arquivo como imagem.";
          renderFotos();
        };
        probe.src = it.previewUrl;
      }
    });
    renderFotos();
  }

  function descartarFotos() {
    var F = DET && DET.fotos;
    if (!F || F.salvando || F.estado !== "ok") return;
    iniciarRascunho(F.sel);
    F.sucesso = null;
    renderFotos();
  }

  function contarAlteracoesFotos() {
    var F = DET.fotos;
    var base = grupoSelecionado().fotos.map(function (f) { return f.id; });
    var removidas = F.itens.filter(function (it) { return it.removida && it.tipo === "existente"; }).length;
    var novas = F.itens.filter(function (it) { return it.tipo === "nova" && !it.removida; }).length;
    var ficam = F.itens.filter(function (it) { return !it.removida && it.tipo === "existente"; }).map(function (it) { return it.id; });
    var baseFicam = base.filter(function (id) { return ficam.indexOf(id) >= 0; });
    var reordenou = JSON.stringify(ficam) !== JSON.stringify(baseFicam) ? 1 : 0;
    return removidas + novas + reordenou;
  }

  function nomeGrupoFotos() {
    return fotosVariacoes() ? "A variação " + grupoSelecionado().rotulo : "O anúncio";
  }

  function validarRascunhoFotos() {
    var F = DET.fotos;
    var n = fotosAtivas().length;
    if (n === 0) return "Não é possível salvar. " + nomeGrupoFotos() + " precisa ter pelo menos uma imagem.";
    var lim = F.leitura.limite && F.leitura.limite.porGrupo;
    if (lim && n > lim) return "Não é possível salvar. " + nomeGrupoFotos() + " pode ter no máximo " + lim + " imagens.";
    return null;
  }
```

Replace `fotosRodapeHtml` with:

```js
  function fotosRodapeHtml() {
    var F = DET.fotos;
    var partes = [];
    if (F.erroLocal) partes.push('<p class="am-det-fotos__bloqueio" role="alert">' + escapeHtml(F.erroLocal) + "</p>");
    if (fotosSujas() && !F.salvando) {
      var n = contarAlteracoesFotos();
      var onde = fotosVariacoes() ? grupoSelecionado().rotulo : "anúncio";
      var aviso = !fotosVariacoes() && imagemReplicaEmProduto(DET.anuncio)
        ? '<p class="am-det-fotos__bloqueio">' + icAlerta(12) +
          " Este anúncio pertence a um produto do Mercado Livre. A alteração de imagem pode ser replicada para outros anúncios relacionados.</p>"
        : "";
      partes.push(aviso +
        '<div class="am-det-fotos__barra" role="status">' +
          '<span class="am-det-fotos__barra-texto">' + n + (n === 1 ? " alteração" : " alterações") +
            " nas fotos de " + escapeHtml(onde) + "</span>" +
          '<button type="button" class="vf-btn vf-btn--ghost vf-btn--sm" data-acao="foto-descartar">Descartar</button>' +
          '<button type="button" class="vf-btn vf-btn--primary vf-btn--sm" data-acao="foto-salvar">Salvar no Mercado Livre</button>' +
        "</div>");
    }
    return partes.join("");
  }
```

Replace `bindFotos` with:

```js
  function bindFotos() {
    carregarFotos();
    var input = el("am-det-img-input");
    if (input) {
      input.addEventListener("change", function () {
        var files = Array.prototype.slice.call(input.files || []);
        input.value = ""; // escolher o MESMO arquivo de novo precisa disparar change
        if (files.length) adicionarArquivosFotos(files);
      });
    }
    var corpo = el("am-det-fotos-corpo");
    if (!corpo) return;
    // Arrastar nativo (desktop). Delegado no contêiner: sobrevive ao innerHTML.
    function itemDe(e) { return e.target && e.target.closest ? e.target.closest(".am-det-fotos__item[draggable='true']") : null; }
    corpo.addEventListener("dragstart", function (e) {
      var it = itemDe(e);
      if (!it || !editavel()) return;
      DET.fotos.arrastando = Number(it.getAttribute("data-idx"));
      it.classList.add("is-arrastando");
      if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", String(DET.fotos.arrastando)); } catch (_) { /* Firefox exige; ok */ } }
    });
    corpo.addEventListener("dragover", function (e) {
      var it = itemDe(e);
      if (!it || DET.fotos.arrastando === null) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    });
    corpo.addEventListener("drop", function (e) {
      var it = itemDe(e);
      if (!it || DET.fotos.arrastando === null) return;
      e.preventDefault();
      var de = DET.fotos.arrastando;
      DET.fotos.arrastando = null;
      moverFoto(de, Number(it.getAttribute("data-idx")));
    });
    corpo.addEventListener("dragend", function () {
      if (DET && DET.fotos) DET.fotos.arrastando = null;
      var a = corpo.querySelector(".is-arrastando");
      if (a) a.classList.remove("is-arrastando");
    });
  }
```

In the click delegation, next to `foto-grupo`, add:

```js
    if (acao === "foto-escolher") { var inp = el("am-det-img-input"); if (inp && !alvo.disabled) inp.click(); return; }
    if (acao === "foto-mover") { moverFotoSeta(Number(alvo.getAttribute("data-idx")), Number(alvo.getAttribute("data-dir"))); return; }
    if (acao === "foto-remover") { removerFoto(Number(alvo.getAttribute("data-idx"))); return; }
    if (acao === "foto-desfazer") { desfazerFoto(Number(alvo.getAttribute("data-idx"))); return; }
    if (acao === "foto-descartar") { descartarFotos(); return; }
    if (acao === "foto-salvar") { salvarFotosNoMl(); return; }
```

Add a temporary `salvarFotosNoMl` that only validates (Task 6 completes it):

```js
  function salvarFotosNoMl() {
    var F = DET && DET.fotos;
    if (!editavel() || !fotosSujas()) return;
    var msg = validarRascunhoFotos();
    if (msg) { F.erroLocal = msg; renderFotos(); return; }
  }
```

- [ ] **Step 4: Run the headless suite**

Expected: 7e–7h `ok`, rest `ok`, no unhandled JS exception.

- [ ] **Step 5: Commit**

```bash
git add Portal/anuncios-meli.js Portal/anuncios-meli-detalhe-modal-ui.test.js
git commit -m "feat(anuncios-ml): edit photos in memory (drag, arrows, delete, add)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Portal — save, group switch and close guard

**Files:**
- Modify: `Portal/anuncios-meli.js`
- Test: `Portal/anuncios-meli-detalhe-modal-ui.test.js`

**Interfaces:**
- Consumes: Tasks 4–5; `PUT /anuncios-meli/:itemId/fotos` (Task 3); `erroImagemDe(status, d)` (existing, returns `{titulo, linhas, semRetry}`).
- Produces: `salvarFotosNoMl(depois)` where `depois` is `null | {tipo:"grupo",destino} | {tipo:"fechar"}`; `planoFotos() -> {plano, arquivos:File[]}`.

- [ ] **Step 1: Write the failing checks** (after 7h)

```js
    await check("7i — salvar: um PUT multipart com plano (grupoVariacao do ML, base, ordem) e só as novas ativas; estados até 'Concluído'", async () => {
      variationsCountAtivo = 3;
      const antes = fotosChamadas.length;
      try {
        await abrirComModo("nenhum");
        await abrirPrimeiroAnuncio(cdp);
        await waitFor(cdp, `/Fotos da variação: Robalo/.test(${textoFotos})`, "o editor não carregou");
        await arrastar(2, 0);                                        // R3 R1 R2
        await clicar(cdp, '.am-det-fotos__item[data-foto="R2"] [data-acao="foto-remover"]');
        await escolherArquivo({ png: true, largura: 800, altura: 800, nome: "fica.png" });
        await escolherArquivo({ png: true, largura: 800, altura: 800, nome: "sai.png" });
        await waitFor(cdp, "document.querySelectorAll('.am-det-fotos__item.is-nova').length === 2", "as novas não entraram");
        await clicar(cdp, '.am-det-fotos__item[data-foto="nova-4"] [data-acao="foto-remover"]');
        fotosAtrasoMs = 1200;
        await clicar(cdp, '[data-acao="foto-salvar"]');
        await waitFor(cdp, `/Salvando no Mercado Livre/.test(${textoFotos})`, "o estado 'Salvando' não apareceu");
        assert.strictEqual((await infoFotos()).barra, "", "durante o salvar não há barra de ação");
        await waitFor(cdp, `/Concluído/.test(${textoFotos})`, "não chegou a 'Concluído'");
      } finally {
        fotosAtrasoMs = 0;
        variationsCountAtivo = 0;
      }
      const c = fotosChamadas[antes];
      assert.ok(c, "nenhum PUT /fotos saiu");
      assert.strictEqual(c.metodo, "PUT");
      assert.ok(/clienteSlug=n97/.test(c.url) && /clienteContaId=42/.test(c.url), c.url);
      assert.deepStrictEqual(c.plano, {
        grupoVariacao: { attribute_id: "COLOR", value_id: null, value_name: "Robalo" },
        base: ["R1", "R2", "R3"],
        ordem: [{ existente: "R3" }, { existente: "R1" }, { nova: 0 }],
      });
      assert.strictEqual(c.arquivos, 1, "a nova removida no rascunho não é enviada");
      assert.strictEqual(fotosChamadas.length, antes + 1, "um único PUT");
      const f = await infoFotos();
      assert.deepStrictEqual(f.ids, ["R3", "R1", "NOVA0"], "a grade passa a mostrar a leitura devolvida");
      assert.strictEqual(f.barra, "");
    });

    await check("7j — erro do ML no salvar mostra mensagem/código/causa; estado incerto não oferece salvar de novo", async () => {
      variationsCountAtivo = 3;
      try {
        await abrirComModo("nenhum");
        await abrirPrimeiroAnuncio(cdp);
        await waitFor(cdp, `/Fotos da variação: Robalo/.test(${textoFotos})`, "o editor não carregou");
        await arrastar(1, 0);
        fotosResultado = { status: 422, corpo: { ok: false, codigo: "item.pictures.max", etapa: "vinculo", motivo: "Too many pictures",
          detalhesMl: { status: 400, message: "Validation error", error: "validation_error", causa: null,
            causas: [{ code: "item.pictures.max", message: "Too many pictures", type: "error", references: [] }] } } };
        await clicar(cdp, '[data-acao="foto-salvar"]');
        await waitFor(cdp, `/Erro do Mercado Livre/.test(${textoFotos})`, "o erro do ML não apareceu");
        const t = await cdp.evaluate(textoFotos);
        assert.ok(/Mensagem: “Validation error”/.test(t) && /Código: item\.pictures\.max \(HTTP 400\)/.test(t) && /Causa: item\.pictures\.max — Too many pictures/.test(t), t);
        assert.ok(/Salvar no Mercado Livre/.test((await infoFotos()).barra), "erro do ML mantém o rascunho e permite salvar de novo");

        fotosResultado = { status: 422, corpo: { ok: false, codigo: "VINCULO_INCERTO", etapa: "vinculo",
          motivo: "Não foi possível confirmar se a imagem entrou no anúncio (falha de conexão com o Mercado Livre). Confira o anúncio no Mercado Livre antes de tentar de novo, para não duplicar a foto." } };
        await clicar(cdp, '[data-acao="foto-salvar"]');
        await waitFor(cdp, `/VINCULO_INCERTO/.test(${textoFotos})`, "o estado incerto não apareceu");
        assert.ok(!/Salvar no Mercado Livre/.test((await infoFotos()).barra), "estado incerto não oferece salvar de novo");
      } finally {
        fotosResultado = null;
        variationsCountAtivo = 0;
      }
      await abrirComModo("nenhum");
      await abrirPrimeiroAnuncio(cdp);
    });

    await check("7k — trocar de grupo com rascunho pede Salvar / Descartar / Cancelar", async () => {
      variationsCountAtivo = 3;
      try {
        await abrirComModo("nenhum");
        await abrirPrimeiroAnuncio(cdp);
        await waitFor(cdp, `/Fotos da variação: Robalo/.test(${textoFotos})`, "o editor não carregou");
        await arrastar(1, 0);
        await clicar(cdp, '.am-det-fotos__chip[data-idx="1"]');
        await waitFor(cdp, "document.querySelector('.am-det-fotos__pendente')", "o aviso de rascunho não apareceu");
        const p = await cdp.evaluate("document.querySelector('.am-det-fotos__pendente').innerText");
        assert.ok(/alterações não salvas nas fotos de Robalo/.test(p) && /Salvar/.test(p) && /Descartar/.test(p) && /Cancelar/.test(p), p);

        await clicar(cdp, '[data-acao="foto-pendente-cancelar"]');
        let f = await infoFotos();
        assert.strictEqual(f.titulo, "Fotos da variação: Robalo");
        assert.deepStrictEqual(f.ids, ["R2", "R1", "R3"], "cancelar mantém o rascunho");

        await clicar(cdp, '.am-det-fotos__chip[data-idx="1"]');
        await waitFor(cdp, "document.querySelector('.am-det-fotos__pendente')", "o aviso não voltou");
        await clicar(cdp, '[data-acao="foto-pendente-descartar"]');
        await waitFor(cdp, `/Fotos da variação: Preto/.test(${textoFotos})`, "descartar não trocou de grupo");

        await clicar(cdp, '.am-det-fotos__chip[data-idx="0"]');
        await waitFor(cdp, `/Fotos da variação: Robalo/.test(${textoFotos})`, "não voltou ao Robalo");
        assert.deepStrictEqual((await infoFotos()).ids, ["R1", "R2", "R3"], "o rascunho descartado não volta");

        const antes = fotosChamadas.length;
        await arrastar(1, 0);
        await clicar(cdp, '.am-det-fotos__chip[data-idx="1"]');
        await waitFor(cdp, "document.querySelector('.am-det-fotos__pendente')", "o aviso não apareceu");
        await clicar(cdp, '[data-acao="foto-pendente-salvar"]');
        await waitFor(cdp, `/Fotos da variação: Preto/.test(${textoFotos})`, "salvar não seguiu para o grupo escolhido");
        assert.strictEqual(fotosChamadas.length, antes + 1);
      } finally {
        variationsCountAtivo = 0;
      }
    });

    await check("7l — fechar o modal com rascunho de fotos pede a mesma decisão", async () => {
      variationsCountAtivo = 3;
      try {
        await abrirComModo("nenhum");
        await abrirPrimeiroAnuncio(cdp);
        await waitFor(cdp, `/Fotos da variação: Robalo/.test(${textoFotos})`, "o editor não carregou");
        await arrastar(1, 0);
        await clicar(cdp, '.am-det-modal [data-acao="fechar"]');
        await waitFor(cdp, "document.querySelector('.am-det-fotos__pendente')", "fechar com rascunho não pediu decisão");
        assert.ok(await cdp.evaluate("!!document.querySelector('.am-det-modal')"), "o modal continua aberto");
        await clicar(cdp, '[data-acao="foto-pendente-descartar"]');
        await waitFor(cdp, "!document.querySelector('.am-det-modal')", "descartar não fechou o modal");
      } finally {
        variationsCountAtivo = 0;
      }
      await abrirComModo("nenhum");
      await abrirPrimeiroAnuncio(cdp);
    });

    await check("7m — anúncio de produto sem variação: aviso de replicação aparece com o rascunho e não bloqueia", async () => {
      const AVISO = "Este anúncio pertence a um produto do Mercado Livre. A alteração de imagem pode ser replicada para outros anúncios relacionados.";
      await abrirComModo("family_name");
      await abrirPrimeiroAnuncio(cdp);
      await waitFor(cdp, `/Fotos do anúncio/.test(${textoFotos})`, "o editor não carregou");
      assert.ok(!(await cdp.evaluate(textoFotos)).includes(AVISO), "sem rascunho não avisa");
      await arrastar(1, 0);
      const t = await cdp.evaluate(textoFotos);
      assert.ok(t.includes(AVISO), t);
      assert.ok(/Salvar no Mercado Livre/.test((await infoFotos()).barra));
      await clicar(cdp, '[data-acao="foto-descartar"]');
      await abrirComModo("nenhum");
      await abrirPrimeiroAnuncio(cdp);
    });
```

Before writing 7l, confirm the close button's selector: `grep -n 'data-acao="fechar"' Portal/anuncios-meli.js`. If it differs, use the real one.

- [ ] **Step 2: Run to confirm failure**

Run the modal headless suite → FAIL at 7i ("o estado 'Salvando' não apareceu").

- [ ] **Step 3: Implement save, pending dialog and close guard**

Replace the temporary `salvarFotosNoMl` with:

```js
  function planoFotos() {
    var F = DET.fotos;
    var arquivos = [];
    var ordem = [];
    F.itens.forEach(function (it) {
      if (it.removida) return;
      if (it.tipo === "nova") { ordem.push({ nova: arquivos.length }); arquivos.push(it); }
      else ordem.push({ existente: it.id });
    });
    return {
      plano: {
        grupoVariacao: grupoSelecionado().grupoVariacao,
        base: grupoSelecionado().fotos.map(function (f) { return f.id; }),
        ordem: ordem,
      },
      arquivos: arquivos,
    };
  }

  function seguirDepoisDeSalvar(depois) {
    if (!depois || !DET) return;
    if (depois.tipo === "grupo") { iniciarRascunho(depois.destino); renderFotos(); }
    if (depois.tipo === "fechar") fecharDetalhe(true);
  }

  function salvarFotosNoMl(depois) {
    var F = DET && DET.fotos;
    if (!editavel() || !fotosSujas()) { seguirDepoisDeSalvar(depois); return; }
    var msg = validarRascunhoFotos();
    F.pendente = null;
    if (msg) { F.erroLocal = msg; renderFotos(); return; }

    var meuToken = DET.token;
    var montado = planoFotos();
    var url = API_BASE + "/anuncios-meli/" + encodeURIComponent(DET.anuncio.item_id) + "/fotos" +
      "?clienteSlug=" + encodeURIComponent(AM.clienteAtual.slug) +
      (AM.contaMlId ? "&clienteContaId=" + encodeURIComponent(AM.contaMlId) : "");
    var form = new FormData();
    form.append("plano", JSON.stringify(montado.plano));
    montado.arquivos.forEach(function (it) { form.append("novas", it.arquivo, it.nome || "imagem"); });

    F.salvando = montado.arquivos.length ? "enviando" : "processando";
    F.erro = null;
    F.erroLocal = null;
    F.sucesso = null;
    renderFotos();

    // XHR (não fetch) para distinguir "Enviando imagens" (bytes subindo) de
    // "Salvando no Mercado Livre" (backend falando com o ML).
    var xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Authorization", "Bearer " + (AM.token || ""));
    function vivo() { return DET && DET.token === meuToken && DET.fotos === F; }
    xhr.upload.onload = function () {
      if (!vivo() || F.salvando !== "enviando") return;
      F.salvando = "processando";
      renderFotos();
    };
    xhr.onload = function () {
      if (!vivo()) return;
      var d = {};
      try { d = JSON.parse(xhr.responseText || "{}"); } catch (_) { d = {}; }
      F.salvando = null;
      if (xhr.status >= 200 && xhr.status < 300 && d.ok) {
        if (d.anuncio) {
          DET.anuncio = d.anuncio;
          AM.detalheAtual = { anuncio: d.anuncio, descricao: DET.descricao };
        }
        var sel = F.sel;
        if (d.leitura && d.leitura.ok) F.leitura = d.leitura;
        else { F.estado = null; } // confirmação pendente: relê do ML
        F.sucesso = d.confirmacaoPendente
          ? "Fotos salvas no Mercado Livre. A lista daqui atualiza na próxima sincronização."
          : "Fotos salvas no Mercado Livre.";
        var sucesso = F.sucesso;
        renderDetalhe(); // contagem "Fotos (N)" do cabeçalho da seção
        if (F.estado === "ok") { iniciarRascunho(sel); F.sucesso = sucesso; renderFotos(); }
        toast("Fotos salvas no Mercado Livre.", "is-success");
        carregarAnuncios();
        seguirDepoisDeSalvar(depois);
        return;
      }
      F.erro = erroImagemDe(xhr.status, d);
      renderFotos();
    };
    xhr.onerror = function () {
      if (!vivo()) return;
      F.salvando = null;
      F.erro = erroImagemDe(0, {});
      renderFotos();
    };
    xhr.send(form);
  }
```

`renderDetalhe()` re-runs `fotosHtml` + `bindFotos()`; `carregarFotos()` returns early because `F.estado` is still `"ok"`, and when it was reset to `null` it re-reads from the ML.

In `erroImagemDe`, the `etapas` map texts talk about "a imagem"; add a generic entry used by the editor and keep the rest:

```js
      confirmacao: "Ao conferir o anúncio no Mercado Livre depois de salvar.",
```

Extend `fotosRodapeHtml` — insert before `return partes.join("");`:

```js
    if (F.pendente) {
      var destino = F.pendente.tipo === "grupo" ? "trocar de variação" : "fechar";
      partes.push('<div class="am-det-fotos__pendente" role="alertdialog" aria-label="Alterações não salvas nas fotos">' +
        '<span class="am-det-fotos__barra-texto">Há alterações não salvas nas fotos de ' +
          escapeHtml(fotosVariacoes() ? grupoSelecionado().rotulo : "anúncio") + ". O que fazer antes de " + destino + "?</span>" +
        '<button type="button" class="vf-btn vf-btn--primary vf-btn--sm" data-acao="foto-pendente-salvar">Salvar</button>' +
        '<button type="button" class="vf-btn vf-btn--ghost vf-btn--sm" data-acao="foto-pendente-descartar">Descartar</button>' +
        '<button type="button" class="vf-btn vf-btn--ghost vf-btn--sm" data-acao="foto-pendente-cancelar">Cancelar</button>' +
      "</div>");
    }
    if (F.salvando) {
      partes.push('<div class="am-det-fotos__estado" role="status">' +
        (F.salvando === "enviando" ? "Enviando imagens…" : "Salvando no Mercado Livre…") + "</div>");
    } else if (F.erro) {
      partes.push('<div class="am-det-fotos__estado is-danger" role="alert">' +
        "<p><strong>" + escapeHtml(F.erro.titulo) + "</strong></p>" +
        F.erro.linhas.map(function (l) { return "<p>" + escapeHtml(l) + "</p>"; }).join("") +
      "</div>");
    } else if (F.sucesso) {
      partes.push('<div class="am-det-fotos__estado is-success" role="status">' + icCheck(13) + " Concluído — " + escapeHtml(F.sucesso) + "</div>");
    }
```

and in the draft-bar condition change `if (fotosSujas() && !F.salvando) {` to

```js
    if (fotosSujas() && !F.salvando && !F.pendente && !(F.erro && F.erro.semRetry)) {
```

Pending actions in the click delegation:

```js
    if (acao === "foto-pendente-salvar") { var pend = DET.fotos.pendente; salvarFotosNoMl(pend); return; }
    if (acao === "foto-pendente-descartar") {
      var pd = DET.fotos.pendente;
      DET.fotos.pendente = null;
      if (pd && pd.tipo === "fechar") { fecharDetalhe(true); return; }
      iniciarRascunho(pd ? pd.destino : DET.fotos.sel);
      renderFotos();
      return;
    }
    if (acao === "foto-pendente-cancelar") { DET.fotos.pendente = null; renderFotos(); return; }
```

`selecionarGrupoFotos` becomes:

```js
  function selecionarGrupoFotos(i) {
    var F = DET && DET.fotos;
    if (!F || F.estado !== "ok" || F.salvando || i === F.sel) return;
    if (fotosSujas()) { F.pendente = { tipo: "grupo", destino: i }; renderFotos(); return; }
    iniciarRascunho(i);
    F.sucesso = null;
    renderFotos();
  }
```

In `fecharDetalhe`, after the `camposSujos()` line, add:

```js
    if (!forcar && fotosSujas() && !DET.fotos.salvando) {
      DET.fotos.pendente = { tipo: "fechar" };
      renderFotos();
      var pend = document.querySelector(".am-det-fotos__pendente");
      if (pend && pend.scrollIntoView) pend.scrollIntoView({ block: "center" });
      return;
    }
```

- [ ] **Step 4: Run the headless suite**

Expected: 7e–7m `ok`, every other check `ok`, no unhandled JS exception. Then run the listing headless suite (`Portal/anuncios-meli-listagem-unificada-ui.test.js`) through a temporary continue-on-failure copy (see `check()` at line ~513; do not commit the copy) and confirm no new failure besides the known 7h/7i.

- [ ] **Step 5: Commit**

```bash
git add Portal/anuncios-meli.js Portal/anuncios-meli-detalhe-modal-ui.test.js
git commit -m "feat(anuncios-ml): save photo drafts in one PUT with switch/close guard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Real-validation tooling and checklist

**Files:**
- Modify: `server/scripts/validacaoImagemVariacao.js`
- Modify: `docs/VALIDACAO_REAL_IMAGENS_ANUNCIOS_ML.md`

**Interfaces:**
- Consumes: saved "antes" JSON from the script's `antes` mode.
- Produces: `compararOrdem(antes, depois, atributo, valor, ordemEsperada) -> { ok, achados:string[], falhas:string[] }` and CLI flag `--ordem=<id,id,…>` on `comparar`.

- [ ] **Step 1: Add `compararOrdem` and a self-check**

In `server/scripts/validacaoImagemVariacao.js`, add after `compararItens`:

```js
// Editor de fotos: o grupo alvo precisa ficar EXATAMENTE em `ordemEsperada`
// (ids; "NOVA" casa com qualquer id que não existia antes). Fotos do grupo
// fora da ordem precisam sumir da galeria se nenhum outro grupo as usa.
function compararOrdem(antes, depois, atributo, valor, ordemEsperada) {
  const achados = [];
  const falhas = [];
  const fotosAntes = (antes.pictures || []).map((p) => String(p.id));
  const fotosDepois = (depois.pictures || []).map((p) => String(p.id));
  const vDepois = Object.fromEntries((depois.variations || []).map((v) => [String(v.id), v]));
  const alvoAntes = (antes.variations || []).filter((v) => valorDe(v, atributo) === valor);
  const idsGrupoAntes = alvoAntes.length ? idsDe(alvoAntes[0]) : fotosAntes;
  const usadasFora = new Set();
  (antes.variations || []).filter((v) => valorDe(v, atributo) !== valor).forEach((v) => idsDe(v).forEach((id) => usadasFora.add(id)));
  const removidas = idsGrupoAntes.filter((id) => !ordemEsperada.includes(id) && !usadasFora.has(id));

  const casa = (veio) => veio.length === ordemEsperada.length &&
    veio.every((id, i) => (ordemEsperada[i] === "NOVA" ? !fotosAntes.includes(id) : id === ordemEsperada[i]));

  for (const v of antes.variations || []) {
    const id = String(v.id);
    const d = vDepois[id];
    if (!d) { falhas.push(`variação ${id} SUMIU`); continue; }
    const alvo = valorDe(v, atributo) === valor;
    const veio = idsDe(d);
    const certo = alvo ? casa(veio) : JSON.stringify(veio) === JSON.stringify(idsDe(v));
    achados.push(`variação ${id} [${valorDe(v, atributo)}${alvo ? " · ALVO" : ""}]: ${idsDe(v).join(",")} → ${veio.join(",")} ${certo ? "OK" : "DIVERGENTE"}`);
    if (!certo) falhas.push(`variação ${id}: veio ${veio.join(",")}`);
    for (const campo of ["price", "available_quantity"]) if (v[campo] !== d[campo]) falhas.push(`variação ${id}: ${campo} mudou`);
  }
  if (!(antes.variations || []).length && !casa(fotosDepois)) falhas.push(`galeria: veio ${fotosDepois.join(",")}`);
  for (const id of removidas) if (fotosDepois.includes(id)) falhas.push(`foto ${id} devia ter saído da galeria`);
  for (const id of fotosAntes) if (!removidas.includes(id) && !fotosDepois.includes(id)) falhas.push(`foto ${id} sumiu sem ter sido excluída`);
  if ((antes.variations || []).length && fotosAntes[0] !== fotosDepois[0] && !removidas.includes(fotosAntes[0])) {
    falhas.push(`capa do anúncio mudou: ${fotosAntes[0]} → ${fotosDepois[0]}`);
  }
  achados.push(`galeria: ${fotosAntes.length} → ${fotosDepois.length}; removidas esperadas: ${removidas.join(",") || "-"}`);
  return { ok: falhas.length === 0, achados, falhas };
}
```

In `main()`, in the `comparar` branch, replace `const r = compararItens(antes, item, a.atributo, a.valor);` with:

```js
  const r = a.ordem
    ? compararOrdem(antes, item, a.atributo, a.valor, a.ordem.split(",").map((s) => s.trim()).filter(Boolean))
    : compararItens(antes, item, a.atributo, a.valor);
```

Update the header "Uso" with the new flag, and export `compararOrdem`.

Self-check (no ML):

```bash
node -e '
const { compararOrdem } = require("./server/scripts/validacaoImagemVariacao");
const v=(id,c,p)=>({id,price:1,available_quantity:1,attribute_combinations:[{id:"COLOR",value_name:c}],picture_ids:p});
const a={pictures:[{id:"R1"},{id:"R2"},{id:"P1"}],variations:[v(1,"Robalo",["R1","R2"]),v(2,"Preto",["P1"])]};
const ok={pictures:[{id:"R1"},{id:"P1"},{id:"N"}],variations:[v(1,"Robalo",["N","R1"]),v(2,"Preto",["P1"])]};
const ruim={pictures:[{id:"R1"},{id:"R2"},{id:"N"}],variations:[v(1,"Robalo",["N","R1"]),v(2,"Preto",["P1"])]};
console.log(compararOrdem(a,ok,"COLOR","Robalo",["NOVA","R1"]).ok, compararOrdem(a,ruim,"COLOR","Robalo",["NOVA","R1"]).falhas);'
```

Expected: `true [ 'foto R2 devia ter saído da galeria', 'foto P1 sumiu sem ter sido excluída' ]`.

- [ ] **Step 2: Checklist §7B**

In `docs/VALIDACAO_REAL_IMAGENS_ANUNCIOS_ML.md`, add a section `## 7B. Editor de fotos por variação` before `## 8. Limpeza` with:

```markdown
## 7B. Editor de fotos por variação (GET/PUT /fotos)

Pré-requisito: seção 7A aprovada. Anúncio de teste: Red Fish MLB5929315274
(autorizado em 2026-09-30). Toda escrita precisa de autorização explícita
antes de rodar.

1. [ ] `antes`: `node server/scripts/validacaoImagemVariacao.js antes --clienteSlug=red_fish --itemId=MLB5929315274 --arquivo=<novo>.json`.
2. [ ] Grupo Robalo: excluir a foto de teste `997902-MLB118515217453_092026`
       e mover a última foto antiga para a primeira posição. Salvar.
3. [ ] `comparar ... --atributo=COLOR --valor=Robalo --ordem=<ids na ordem final>`:
       RESULTADO OK; a 997902 saiu da galeria; outras cores intactas; capa do
       anúncio igual.
4. [ ] Conferir no ML: ao escolher Robalo, a primeira foto é a nova imagem
       principal da variação; nas outras cores nada mudou.
5. [ ] Adicionar uma foto nova e salvar; `comparar --ordem=...,NOVA` OK.
       Excluir essa foto no editor e salvar de novo (volta ao estado do passo 1
       menos a 997902 e com a nova ordem).
6. [ ] Voltar a ordem original do Robalo pelo editor e salvar; `comparar`
       contra o JSON do passo 1 com `--ordem=<ordem original sem a 997902>`.
7. [ ] Sync completo do cliente; `snapshot` igual à galeria do ML.
8. [ ] Registrar na tabela: tempos, códigos e qualquer recusa real do ML.

Anúncio sem variação: repetir 2–7 num anúncio simples autorizado (capa do
anúncio passa a ser a primeira foto).
```

- [ ] **Step 3: Commit**

```bash
git add server/scripts/validacaoImagemVariacao.js docs/VALIDACAO_REAL_IMAGENS_ANUNCIOS_ML.md
git commit -m "docs(anuncios-ml): real-validation checklist for the photo editor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Full verification (no real writes)

**Files:** none changed unless a regression is found.

- [ ] **Step 1:** Backend suite (Global Constraints) → exit 0.
- [ ] **Step 2:** Modal headless → every check `ok`, including 7e–7m.
- [ ] **Step 3:** Listing headless via temporary continue-on-failure copy → no new failures.
- [ ] **Step 4:** `git status` clean except the pre-existing untracked files; `git log --oneline origin/main..HEAD` lists the PR #205 commits plus this plan's commits.
- [ ] **Step 5:** Report to the user: files, tests, SHAs, what §7B needs. Real ML writes (Task 7 checklist) only after the user authorizes them; no push, no deploy.

---

## Self-review notes

- Spec coverage: §3.1 chips/título → Task 4; §3.2 drag/setas/add/excluir/barra/troca → Tasks 5–6; §3.3 validação → Task 5 (`validarRascunhoFotos`) + Task 1/2 (backend); §3.4 estados → Task 6; §3.5 avisos → Tasks 4 (catálogo), 6 (7m), 2 (User Product); §4.1–4.2 → Task 3; §4.3 limites → Task 2 (`limitesDaCategoria`); §4.4 sequência → Task 2; §4.5 status → Task 3; §6 testes → Tasks 1–6; validação real → Task 7.
- Group identity uses `grupoVariacao {attribute_id, value_id, value_name}` end to end (service, controller, Portal plan, tests).
- Names used across tasks: `lerFotos`, `salvarFotos`, `lerFotosAnuncio`, `salvarFotosAnuncio`, `DET.fotos`, `iniciarRascunho`, `fotosAtivas`, `fotosSujas`, `renderFotos`, `salvarFotosNoMl`, `planoFotos` — defined once and reused with the same signatures.
