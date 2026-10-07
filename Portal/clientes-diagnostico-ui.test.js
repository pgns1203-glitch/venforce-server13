// Portal/clientes-diagnostico-ui.test.js
//
// Tela Clientes e Contas, layout lista + painel (out/2026).
//   1. diagnosticarConta / diagnosticarCliente (lógica pura em
//      clientes-contas-resumo.js): estado técnico → linguagem de operação.
//   2. A tela passou a ser de TODOS os usuários internos SEM mudar backend:
//      leitura de fonte garante que não-admin lê a própria carteira e que
//      nenhuma mutação (todas requireAdmin no servidor) é oferecida a ele.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { diagnosticarConta, diagnosticarCliente } = require("./clientes-contas-resumo.js");

let checks = 0;
function ok(label, cond) {
  assert.ok(cond, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

const BASE = { base_id: 9, nome: "Custo 2026" };
const grant = (token_status) => ({ id: 1, ml_user_id: "3154660681", token_status });

// ── diagnosticarConta ────────────────────────────────────────────────────
{
  const d = diagnosticarConta({ marketplace: "meli", ativo: true, grant: grant("valid"), base: BASE });
  ok("ML conectada + base → pronta (success)", d.code === "pronta" && d.tom === "success" && d.prioridade === 0);
  ok("ML pronta → os 3 checks ok", d.checks.map((c) => c.tom).join() === "ok,ok,ok");
}
{
  const d = diagnosticarConta({ marketplace: "meli", ativo: true, grant: grant("valid"), base: null });
  ok("ML conectada SEM base → pendência 'sem_base' (era 'Base não definida' no card antigo)", d.code === "sem_base" && d.tom === "warning" && d.prioridade === 1);
  ok("ML sem base → check Base pendente", d.checks.find((c) => c.chave === "base").tom === "warn");
}
{
  const d = diagnosticarConta({ marketplace: "meli", ativo: true, grant: null, base: null });
  ok("ML sem grant e nunca conectada → aguardando conexão", d.code === "sem_grant" && d.tom === "warning");
}
{
  const d = diagnosticarConta({ marketplace: "meli", ativo: true, grant: null, external_account_id: "999" });
  ok("ML sem grant mas com seller conhecido → desconectada", d.code === "desconectada" && d.prioridade === 1);
}
{
  const d = diagnosticarConta({ marketplace: "meli", ativo: true, grant: grant("invalid_grant"), base: BASE });
  ok("ML com token_status inválido → problema (danger, prioridade 2)", d.code === "grant_problema" && d.tom === "danger" && d.prioridade === 2);
  ok("ML com problema → check Conexão 'bad'", d.checks.find((c) => c.chave === "conexao").tom === "bad");
}
{
  const d = diagnosticarConta({ marketplace: "shopee", ativo: true, base: null });
  ok("Shopee sem base → sem_base", d.code === "sem_base");
  ok("Shopee → Conexão 'não se aplica' (sem grant próprio)", d.checks.find((c) => c.chave === "conexao").tom === "na");
  ok("Shopee com base → pronta", diagnosticarConta({ marketplace: "shopee", ativo: true, base: BASE }).code === "pronta");
}
{
  const d = diagnosticarConta({ marketplace: "tiktok", ativo: true });
  ok("TikTok ativa → lançamento manual (neutral, não é pendência)", d.code === "manual" && d.tom === "neutral" && d.prioridade === 0);
}
{
  const d = diagnosticarConta({ marketplace: "meli", ativo: false, grant: grant("invalid_grant") });
  ok("conta desativada nunca vira problema, mesmo com grant ruim", d.code === "desativada" && d.prioridade === -1);
}

// ── diagnosticarCliente ──────────────────────────────────────────────────
ok("cliente sem contas → sem_contas", diagnosticarCliente([]).code === "sem_contas");
ok("cliente só com conta desativada → sem_contas", diagnosticarCliente([{ marketplace: "meli", ativo: false }]).code === "sem_contas");
{
  const d = diagnosticarCliente([
    { marketplace: "meli", ativo: true, grant: grant("valid"), base: BASE },
    { marketplace: "meli", ativo: true, grant: grant("expired"), base: BASE },
    { marketplace: "shopee", ativo: true, base: null },
  ]);
  ok("problema vence pendência no resumo do cliente", d.code === "problema" && d.tom === "danger");
  ok("contagens do cliente (1 pronta, 1 pendência, 1 problema)", d.prontas === 1 && d.pendencias === 1 && d.problemas === 1 && d.total === 3);
}
{
  const d = diagnosticarCliente([{ marketplace: "shopee", ativo: true, base: null }, { marketplace: "shopee", ativo: true, base: null }]);
  ok("2 pendências → rótulo '2 pendências'", d.code === "pendencia" && d.label === "2 pendências");
}
ok(
  "tudo pronto (TikTok manual conta como ok)",
  diagnosticarCliente([{ marketplace: "tiktok", ativo: true }, { marketplace: "shopee", ativo: true, base: BASE }]).code === "pronto"
);

// ── Tela para todos os usuários, sem mudar backend ───────────────────────
const js = fs.readFileSync(path.join(__dirname, "clientes.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "clientes.html"), "utf8");

ok("não redireciona mais não-admin para a Carteira", !/role\s*!==\s*"admin"\)\s*window\.location\.replace/.test(js));
ok("admin continua lendo GET /clientes", /if \(IS_ADMIN\) \{\s*const data = await apiFetch\("\/clientes"\)/.test(js));
ok("não-admin lê a própria carteira (GET /me/portfolio)", /apiFetch\("\/me\/portfolio"\)/.test(js));
ok("queda para /operacao/cliente-360/clientes só em 404 (mesma regra do Shell)", /err\.status !== 404\) throw err;\s*data = await apiFetch\("\/operacao\/cliente-360\/clientes"\)/.test(js));
ok("botão Novo cliente nasce escondido no HTML", /id="clientes-header-acoes"[^>]*hidden/.test(html));
ok("Novo cliente só aparece para admin", /if \(IS_ADMIN\) \{\s*document\.getElementById\("clientes-header-acoes"\)\.hidden = false;/.test(js));
ok("admin recebe todas as ações; os demais só as de leitura/conexão", /const acoes = IS_ADMIN \? montarAcoesConta\(slug, conta, diag\) : montarAcoesContaLeitura\(slug, conta, diag\)/.test(js));
{
  const inicio = js.indexOf("function montarAcoesContaLeitura");
  const fim = js.indexOf("\nfunction montarAcoesConta(", inicio);
  const trecho = js.slice(inicio, fim);
  ok("não-admin: Conectar/Copiar link aparecem (via acoesConexaoMl)", /acoesConexaoMl\(slug, conta\)/.test(trecho));
  ok("não-admin: só Mercado Livre ativo tem ações", /conta\.marketplace !== "meli" \|\| conta\.ativo === false\) return vazio/.test(trecho));
  ok(
    "não-admin: nenhuma ação requireAdmin (base, principal, ativar, testar, desconectar)",
    !/abrirBasePicker|\/principal|alternarAtivoConta|confirmarDesativarConta|testarGrantConta|ml-grant/.test(trecho)
  );
}
ok("admin e não-admin usam o mesmo link de conexão (uma fonte só)", /const \{ conectar, copiar \} = acoesConexaoMl\(slug, conta\);/.test(js));
ok("Remover cliente só para admin", /const acoesCliente = IS_ADMIN/.test(js));
ok("+ Adicionar conta só para admin", /const botaoAdd = IS_ADMIN/.test(js));
ok("não-admin vê aviso de modo leitura", /const avisoLeitura = IS_ADMIN \? ""/.test(js));
ok("link de conexão continua account-scoped (/ml/conectar-conta/:id)", /\/ml\/conectar-conta\/\$\{contaId\}/.test(js));
ok("Desconectar continua pedindo confirmação", /Desconectar conta Mercado Livre[\s\S]*?danger: true/.test(js));

// ── Deploy: cache misturado não pode travar a tela ───────────────────────
// Incidente pós-merge do #228: HTML/JS novos com CSS e resumo.js antigos do
// cache → lista sem estilo e "carregando…" eterno.
ok("CSS da página com versão (?v=) no link", /href="css\/pages\/clientes-v2\.css\?v=[^"]+"/.test(html));
ok("clientes-contas-resumo.js com versão (?v=)", /src="clientes-contas-resumo\.js\?v=[^"]+"/.test(html));
ok("clientes.js com versão (?v=)", /src="clientes\.js\?v=[^"]+"/.test(html));
{
  const v = [...html.matchAll(/(?:clientes-v2\.css|clientes-contas-resumo\.js|clientes\.js)\?v=([^"]+)"/g)].map((m) => m[1]);
  ok("os 3 arquivos usam a MESMA versão (trocar junto)", v.length === 3 && new Set(v).size === 1);
}
ok("resumo.js antigo em cache → pede recarregar em vez de travar", /if \(!RESUMO_COMPLETO\) \{\s*showError\(/.test(js));
ok("falha num cliente não para a fila dos outros", /try \{\s*if \(!CONTAS_POR_CLIENTE\.has\(slug\)\) await carregarContas\(slug\);\s*\} catch/.test(js));

console.log(`\nclientes-diagnostico-ui.test.js: ${checks} verificações passaram.`);
