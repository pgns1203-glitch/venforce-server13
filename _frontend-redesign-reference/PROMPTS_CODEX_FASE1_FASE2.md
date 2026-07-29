# Prompts de Implementação — Central Cockpit (Fase 1) + Agregadores (Fase 2)

> Derivado de `VenForce_Direcao_Produto_Frontend.md` (seções 4, 10, 12) e validado contra o backend real
> (`server/index.js`, `server/routes/`, `server/services/`).
> Cada prompt é autossuficiente, cole **um por vez**, na ordem A → B → C → D.
>
> Este arquivo tem **DOIS conjuntos do mesmo plano**:
> - **CONJUNTO 1 — Agente forte (Opus 4.8 / 4.7 caro):** descreve o *quê*; confia no agente para o *como*.
> - **CONJUNTO 2 — Agente econômico (Sonnet / Opus 4.7):** mesmo resultado, mas com passos numerados,
>   IDs/nomes exatos e checklist — para gastar menos tokens e não se perder.
>
> Use **um conjunto ou o outro**, não os dois. O resultado final é idêntico.

---

## Verdades do backend (não negociáveis em qualquer prompt)

Endpoints reais e quem acessa (confirmado no código):

| Endpoint | Auth | Retorno (campos úteis) |
|---|---|---|
| `GET /bases` | qualquer login | `bases:[{id, slug, nome, ativo, created_at, updated_at}]` — **sem campo de cobertura** |
| `GET /automacoes/relatorios` | admin/user/membro | `{total, relatorios:[{id, cliente_slug, base_slug, status, total_itens, itens_com_base, itens_sem_base, itens_criticos, itens_atencao, itens_saudaveis, mc_media, margem_alvo, created_at}]}` |
| `GET /clientes` | **admin** | `clientes:[{id, nome, slug, api_key, ativo, created_at}]` |
| `GET /admin/ml-tokens` | **admin** | `tokens:[{cliente_id, cliente_nome, cliente_slug, ml_user_id, access_token, refresh_token, expires_at, updated_at}]` |
| `GET /admin/logs` | **admin** | `{logs:[{acao, detalhes, status, user_nome, created_at}], total, page, totalPages}` |
| `GET /scans` | qualquer login | `scans:[{user_id, base_slug, conta_ml, total_anuncios, mc_medio, saudaveis, atencao, criticos, created_at}]` |

Roles do sistema: **`admin`, `user`, `membro`**. Não-admin recebe **403** em `/clientes`, `/admin/ml-tokens`, `/admin/logs`.

Regra de ouro: **não tocar** em `layout.js`, `style.css`, OAuth, fórmula LC/MC, nem criar tabela nova. CSS sempre escopado/`venforce-ui-v2.css`.

---
---

# CONJUNTO 1 — AGENTE FORTE (Opus 4.8 / 4.7)

> Cole o **Bloco de Contexto Fixo** abaixo UMA vez, depois os prompts A1→D1.

## Bloco de Contexto Fixo (cole uma vez)

```
Você vai me ajudar a evoluir a Central de Operação (dashboard) do portal Venforce — SaaS de assessoria de marketplace. Stack: HTML + CSS + JS vanilla, sem framework.

OBJETIVO DA ENTREGA: transformar a Central em cockpit diário de 3 faixas — "Precisa de você hoje" (fila acionável), "Saúde da operação" (score + termômetros), "Atividade recente" (timeline) — e, depois, ligá-la a 3 agregadores novos read-only.

PRINCÍPIO ÚNICO: nada aparece na tela sem um próximo passo. Se um dado não vira ação, vai para a tela de detalhe, não para o cockpit.

CAMADA VISUAL: reaproveitar style.css (tokens --vf-*, classes .vf-*) e venforce-ui-v2.css. Nunca criar paleta nova. Direção: claro/profissional estilo Stripe/Linear, roxo #5a2a8f com parcimônia, verde=saudável/amarelo=atenção/vermelho=crítico.

REGRAS INEGOCIÁVEIS:
- NUNCA tocar em layout.js, style.css, OAuth do Mercado Livre, fórmula LC/MC.
- Não criar tabela nova no banco. Agregadores novos só LEEM tabelas existentes.
- Ler JWT de localStorage('vf-token') no header Authorization Bearer.
- Sempre tratar os 4 estados: loading, erro, vazio, sucesso. Tratar 403 sem quebrar a tela.
- Nunca `git add .`: listar arquivos explicitamente.
- Ao final de cada tarefa: listar arquivos alterados e sugerir testes manuais.

ROLES: admin, user, membro. /clientes, /admin/ml-tokens, /admin/logs são admin-only (403 para os demais) — a Central deve degradar graciosamente, nunca mostrar erro cru.

Responda "ok, contexto carregado" e aguarde o primeiro prompt.
```

---

### A1 — Central vira cockpit (frontend puro, endpoints atuais)

```
Tarefa: reorganizar a Central de Operação (Portal/dashboard.html + Portal/dashboard.js) em 3 faixas verticais, usando SOMENTE os endpoints que ela já consome hoje (/bases, /automacoes/relatorios, /clientes, /admin/ml-tokens). Não criar endpoint. Não tocar backend.

Estruture a página nesta ordem:

FAIXA 1 — "Precisa de você hoje" (topo, prioridade visual máxima): uma fila de itens acionáveis, cada um com título, meta curta e um CTA que navega. Itens, em ordem de severidade:
  1. Tokens ML expirados/expirando → CTA "Reconectar" → ml-tokens.html (de /admin/ml-tokens; só admin — se 403, ocultar item).
  2. Relatórios com itens_criticos > 0 → "Ver relatório" → relatorios.html (de /automacoes/relatorios).
  3. Clientes ativos sem base → "Vincular base" → bases.html (cruzar /clientes com /bases; se 403 em /clientes, degradar para "Bases ativas: N").
  4. Bases vencidas (>30 dias por updated_at) → "Atualizar" → bases.html.
  5. Bases sem marketplace identificado → "Ver bases" → bases.html (reaproveitar detectarMarketplace já existente).
  Estado vazio: card "Tudo em ordem" (reaproveitar o que já existe).

FAIXA 2 — "Saúde da operação" (meio): 4 cards.
  2.1 Score operacional 0–100 (card destaque) — implementar a fórmula descrita no anexo SCORE abaixo. Mostrar badge: ≥80 Saudável / 60–79 Atenção / <60 Risco.
  2.2 ML conectados / pendentes → "Gerenciar" → ml-tokens.html.
  2.3 Cobertura de clientes (com base / total) → "Ver clientes" → clientes.html.
  2.4 "Frescor das bases" — RENOMEAR o atual card "Cobertura de custo" (que hoje mede só idade do updated_at, não cobertura real). Nova copy honesta: "Bases atualizadas recentemente geram diagnósticos confiáveis." Mostrar N atualizadas / M vencidas + mini-barras top 5 piores. → "Ver bases" → bases.html.

FAIXA 3 — "Atividade recente" (base):
  3.1 Diagnósticos recentes (tabela 5 linhas) — ADICIONAR coluna "Críticos" (itens_criticos, já vem no payload). → "Ver todos" → relatorios.html.
  3.2 Timeline de ações (de /admin/logs?limit=6; só admin — se 403, ocultar o bloco inteiro). → "Ver tudo" → atividade.html.

Remover do topo: KPIs de "Bases cadastradas", "Mercado Livre" (contagem de bases) e "Shopee" — viram detalhe em bases.html. Condensar "Diagnósticos gerados" como rodapé do score. Manter saudação, banner de bases desatualizadas e atalhos rápidos (no rodapé).

ANEXO SCORE (fórmula v1, transparente, sem IA — pesos como constantes no topo do JS):
  SCORE = soma de 5 fatores (cada um razão 0–1 × peso), total 100:
    1. ML conectado = clientes_ativos_com_token_válido / clientes_ativos            × 25 (admin)
    2. Bases frescas = bases_ativas_não_vencidas / bases_ativas                      × 20
    3. Cobertura clientes = clientes_com_base / clientes_ativos                      × 20 (admin)
    4. Diagnósticos = min(1, diagnósticos_últimos_30d / clientes_ativos)             × 15
    5. Sem críticos = 1 − (relatórios_críticos_recentes / relatórios_recentes)       × 20
  Se fatores admin-only (1 e 3) não puderem ser calculados (não-admin), renormalizar os pesos restantes (2+4+5=55) para 100 e marcar como "score parcial".
  Denominador zero → fator = 1 (neutro). Resultado = round.

Restrições: só dashboard.html/dashboard.js + ajustes escopados em venforce-ui-v2.css se necessário. Reaproveitar a lógica já existente (detectarMarketplace, isMlTokenActive, renderHealth). Tratar 403 sem erro visível. Não tocar layout.js/style.css/backend.
Ao final: liste arquivos alterados e 4 testes manuais (admin com dados; membro com 403 nos blocos admin; carteira vazia; cada card com CTA navegando).
```

---

### B1 — Agregadores read-only (3 endpoints novos)

```
Tarefa: criar 3 endpoints agregadores read-only para alimentar a Central, SEM alterar nenhum endpoint, controller ou service existente, e SEM criar tabela. Apenas LER tabelas que já existem (bases, clientes, ml_tokens, relatorios, activity_logs).

Crie arquivos novos: server/routes/operacaoRoutes.js, server/controllers/operacaoController.js, server/services/operacaoService.js. Monte com uma linha em server/index.js: app.use("/operacao", operacaoRoutes). Use authMiddleware; aplique a lógica de role internamente.

1) GET /operacao/resumo — uma chamada devolve o cockpit (faixas 1 e 2).
   Lê: bases, clientes, ml_tokens, relatorios (reuse as MESMAS queries já existentes nesses módulos; não duplique conexões).
   Retorna: score (fórmula do anexo, igual à do frontend), score_breakdown, score_parcial (bool),
   bases{total,ativas,vencidas,sem_marketplace}, clientes{total,ativos,com_base,sem_base} (null p/ não-admin),
   ml{conectados,pendentes,expirando_7d} (null p/ não-admin), diagnosticos{total,criticos_recentes,ultimo_em},
   prioridades[] (tipo, severidade, qtd, label, cta).
   NUNCA retornar access_token, refresh_token nem api_key. Para não-admin, blocos sensíveis vêm null e score_parcial=true.
   Se uma sub-query falhar, retornar aquele bloco como null e score_parcial=true — nunca derrubar a resposta.

2) GET /operacao/saude-bases — qualquer login.
   Lê bases. Retorna total, resumo{frescas,atencao,vencidas}, bases[]{slug, marketplace(heurística), dias_desde_update, status(fresca≤7/atencao8-30/vencida>30), frescor_pct, ativo}.
   Base sem updated_at → status "desconhecido", frescor_pct null.

3) GET /operacao/atividade-recente?limit=6 — qualquer login.
   Lê activity_logs (reuse a query de logsController). Admin vê todas as ações; user/membro vê só WHERE user_id = req.user.id.
   Retorna eventos[]{acao, label(amigável derivado de acao+detalhes via mapa fixo), user_nome, status, created_at}.

Anexo SCORE: idêntico ao do prompt da Central (5 fatores ponderados 25/20/20/15/20, renormalização para não-admin, denominador zero → 1).
Performance: em relatorios, usar LIMIT e janela WHERE created_at > now() - interval '90 days'. Sem índice novo nesta versão.
Restrições: não editar nenhum arquivo existente além de adicionar a linha de mount em index.js. Não tocar OAuth/LC-MC. Não criar tabela.
Ao final: liste arquivos alterados e a matriz de testes Postman (admin vs membro × 3 endpoints; confirmar que nenhum segredo aparece; 401 sem token).
```

---

### C1 — Central consome o agregador (com fallback)

```
Tarefa: fazer Portal/dashboard.js consumir os 3 agregadores (/operacao/resumo, /operacao/saude-bases, /operacao/atividade-recente) em vez das múltiplas chamadas atuais, MANTENDO fallback para os endpoints antigos.

- Substituir as chamadas de loadDashboard por uma a GET /operacao/resumo: Faixa 1 lê prioridades[], Faixa 2 lê score + bases/clientes/ml.
- Faixa 3 / card de timeline: GET /operacao/atividade-recente. Card "Frescor das bases": GET /operacao/saude-bases.
- FALLBACK obrigatório: se /operacao/* responder 404 (deploy gradual), cair na lógica antiga (chamadas a /bases, /automacoes/relatorios, etc.) sem erro visível. A Central nunca pode ficar em branco.
- Não mudar o visual: a tela deve ficar idêntica à da entrega A, só com menos requests.

Restrições: só dashboard.js (e dashboard.html se precisar de ajuste mínimo). Não tocar backend/layout.js/style.css.
Ao final: liste arquivos alterados e 3 testes manuais (1 request no Network no caminho feliz; /operacao desligado → fallback sem erro; membro vê score parcial).
```

---

### D1 — Refino visual e CTAs

```
Tarefa: polir a Central cockpit (Portal/dashboard.html, dashboard.js, ajustes escopados em venforce-ui-v2.css). Só visual e copy — nenhuma mudança de dado ou endpoint.

- Severidade/cores da fila da Faixa 1 (vermelho/amarelo/azul por tipo).
- Badge do score (Saudável/Atenção/Risco) com cor semântica.
- "Tempo atrás" legível na timeline (ex.: "há 2h", "ontem").
- Microcopy dos CTAs revisada para verbo + objeto ("Reconectar token", "Vincular base").
- Responsividade: as 3 faixas empilham bem em mobile; mini-barras e tabela não estouram.
- Revisar os 4 estados (loading/erro/vazio/sucesso) em cada faixa.

Restrições: CSS escopado, nunca global. Não tocar layout.js/style.css/backend.
Ao final: liste arquivos alterados e os 4 estados verificados por faixa + 1 checagem mobile.
```

---
---

# CONJUNTO 2 — AGENTE ECONÔMICO (Sonnet / Opus 4.7)

> Mesmo resultado do Conjunto 1, porém com passos numerados, IDs/nomes exatos e checklist final,
> para o agente não gastar tokens redescobrindo o óbvio nem refazer trabalho.
> Cole o Bloco de Contexto Fixo (idêntico ao do Conjunto 1) UMA vez, depois A2→D2.

> Diferenças de estilo deste conjunto:
> - Diga sempre QUAIS arquivos abrir primeiro e em que ordem.
> - Dê os IDs de elementos e nomes de função existentes a reaproveitar.
> - Trabalhe incrementalmente: uma faixa por vez, testando antes de seguir.
> - Não refatore nada fora do pedido. Não “melhore” código adjacente.

---

### A2 — Central vira cockpit (passo a passo)

```
Tarefa: reorganizar a Central (Portal/dashboard.html + Portal/dashboard.js) em 3 faixas, usando SÓ os endpoints já consumidos hoje. Não criar endpoint, não tocar backend, não tocar layout.js/style.css.

ANTES DE EDITAR — leia estes arquivos e NÃO os altere sem necessidade:
- Portal/dashboard.html (estrutura atual: page-head, banner #dash-banner, KPIs #dash-kpis, seção "Status da operação", grid com #dash-prioridades / #dash-relatorios-tbody / #dash-health, atalhos).
- Portal/dashboard.js. Funções que VOCÊ VAI REAPROVEITAR (não reescrever do zero):
  detectarMarketplace, isMlTokenActive, getClienteKey, getBaseClienteKey, renderBanner,
  renderPrioridades, renderHealth, loadOperationMlStatus, loadRelatorios, setOperationCard, setEmptyState.

Faça nesta ordem, testando a cada passo:

PASSO 1 — Reordenar o HTML em 3 seções com títulos:
  <section> "Precisa de você hoje"  (mover/usar o bloco #dash-prioridades)
  <section> "Saúde da operação"     (usar os 4 cards de "Status da operação" + o card de saúde)
  <section> "Atividade recente"     (usar a tabela #dash-relatorios + um novo bloco de timeline #dash-timeline)
  Mantenha saudação (#dash-greeting), banner (#dash-banner) e atalhos. NÃO apague IDs existentes que o JS usa.

PASSO 2 — FAIXA 1 (expandir renderPrioridades): além das 2 prioridades atuais (bases vencidas, bases sem marketplace), adicionar:
  (a) Tokens ML: dentro de loadOperationMlStatus, quando houver tokens com expires_at no passado ou em < 7 dias, empurrar um item para a fila com CTA href="ml-tokens.html". Se /admin/ml-tokens der 403, NÃO adicionar item (sem erro).
  (b) Relatórios críticos: em loadRelatorios, contar relatórios com itens_criticos > 0; se > 0, adicionar item com CTA href="relatorios.html".
  (c) Clientes sem base: em loadOperationMlStatus (já tem /clientes), calcular clientes ativos sem base (cruzar com bases por getBaseClienteKey); se > 0, item com CTA href="bases.html". Se 403, pular.
  Ordem na fila: token > crítico > sem base > base vencida > sem marketplace.

PASSO 3 — FAIXA 2:
  (a) Card 2.1 SCORE: criar função renderScore(dados) que calcula a fórmula do ANEXO SCORE e escreve em um novo card #op-score (valor 0–100 + badge: ≥80 "Saudável" verde, 60–79 "Atenção" amarelo, <60 "Risco" vermelho).
  (b) Cards 2.2/2.3: manter os de ML conectados/pendentes e clientes com base (já existem via setOperationCard).
  (c) Card 2.4: no HTML, RENOMEAR o título "Cobertura de custo" para "Frescor das bases" e o texto para "Bases atualizadas recentemente geram diagnósticos confiáveis." (renderHealth continua igual — só o rótulo muda).

PASSO 4 — FAIXA 3:
  (a) Na tabela de loadRelatorios, adicionar a coluna "Críticos" (itens_criticos) no <thead> e no <tbody> (entre Itens e Atualizado).
  (b) Criar loadTimeline(): fetch GET /admin/logs?limit=6; se 200, renderizar lista em #dash-timeline (acao + user_nome + "tempo atrás"); se 403, esconder o bloco #dash-timeline-section inteiro. CTA "Ver tudo" → atividade.html.

PASSO 5 — Remover do topo os KPIs "Bases cadastradas", "Mercado Livre", "Shopee" (apagar do HTML e parar de chamar renderKpis para eles). Manter o cálculo de "Bases ativas" só dentro do card 2.4. "Diagnósticos gerados" vira o rodapé (foot) do card de score.

ANEXO SCORE (copie a fórmula exatamente; pesos como constantes no topo do arquivo):
  const PESOS = { ml:25, basesFrescas:20, coberturaClientes:20, diagnosticos:15, semCriticos:20 };
  fator1 ml = clientesAtivosComTokenValido / clientesAtivos            (admin)
  fator2 basesFrescas = basesAtivasNaoVencidas / basesAtivas
  fator3 coberturaClientes = clientesComBase / clientesAtivos          (admin)
  fator4 diagnosticos = min(1, diagnosticosUltimos30d / clientesAtivos)
  fator5 semCriticos = 1 − (relatoriosCriticosRecentes / relatoriosRecentes)
  SCORE = round(Σ fator_i × peso_i). Denominador 0 → fator = 1.
  Se não-admin (sem fatores 1 e 3): some só os pesos disponíveis (20+15+20=55), reescale para 100, e exiba "parcial".

Restrições: só dashboard.html/dashboard.js (+ CSS escopado se preciso). NÃO renomear IDs que o JS lê. NÃO mexer em layout.js/style.css/backend. NÃO refatorar funções que já funcionam.
Ao final: liste arquivos alterados e rode esta CHECKLIST de 5 testes: (1) admin: 3 faixas com dados; (2) membro: itens/timeline admin-only somem sem erro; (3) zero bases: empty states; (4) cada CTA navega para a tela certa; (5) score muda quando há token vencido.
```

---

### B2 — Agregadores read-only (passo a passo)

```
Tarefa: criar 3 endpoints agregadores read-only, sem alterar nada existente e sem criar tabela. Só LER tabelas que já existem.

ANTES DE CRIAR — abra para copiar as queries (NÃO edite estes arquivos):
- server/index.js → handlers de /bases (linha ~541), /clientes (~751), /admin/ml-tokens (~729) para ver os SELECTs.
- server/services/automacoes/relatoriosService.js → função de listar (SELECT com itens_criticos, mc_media, created_at...).
- server/controllers/logsController.js → SELECT em activity_logs.
- server/middlewares/authMiddleware.js (authMiddleware, requireAdmin) e accessMiddleware.js (roles admin/user/membro).

CRIE 3 arquivos novos e monte 1 rota:
  server/routes/operacaoRoutes.js
  server/controllers/operacaoController.js
  server/services/operacaoService.js
  em server/index.js adicionar SÓ: app.use("/operacao", operacaoRoutes);  (perto dos outros app.use)

ENDPOINT 1 — GET /operacao/resumo  (authMiddleware; role tratada dentro)
  Passos no service:
  1. SELECT de bases (copie do /bases). Calcule total, ativas (ativo!=false), vencidas (updated_at < now-30d), sem_marketplace (heurística).
  2. SE req.user.role==='admin': SELECT de clientes e de ml_tokens (copie dos handlers admin). Calcule clientes{total,ativos,com_base,sem_base} e ml{conectados,pendentes,expirando_7d}. SENÃO: esses blocos = null.
  3. SELECT de relatorios dos últimos 90 dias (WHERE created_at > now() - interval '90 days', com LIMIT). Calcule diagnosticos{total, criticos_recentes (itens_criticos>0), ultimo_em}.
  4. score = fórmula do ANEXO (igual à do frontend). score_parcial = true se faltou bloco admin.
  5. prioridades[] = lista derivada (tipo, severidade, qtd, label, cta) p/ token, crítico, sem_base, base_vencida.
  RETORNO: { ok:true, score, score_breakdown, score_parcial, bases{}, clientes{}|null, ml{}|null, diagnosticos{}, prioridades[] }.
  PROIBIDO no retorno: access_token, refresh_token, api_key. Se uma sub-query falhar: aquele bloco = null, score_parcial=true, status 200.

ENDPOINT 2 — GET /operacao/saude-bases  (authMiddleware, qualquer role)
  SELECT de bases. Para cada base: dias_desde_update, status (fresca ≤7 / atencao 8–30 / vencida >30 / desconhecido se sem updated_at), frescor_pct (mesma curva do renderHealth do front; null se desconhecido), marketplace (heurística).
  RETORNO: { ok:true, total, resumo{frescas,atencao,vencidas}, bases[] }.

ENDPOINT 3 — GET /operacao/atividade-recente?limit=6  (authMiddleware, qualquer role)
  SELECT em activity_logs (copie logsController). SE admin: todas; SENÃO: WHERE user_id = req.user.id. Mapa fixo acao→label amigável.
  RETORNO: { ok:true, eventos[]{acao,label,user_nome,status,created_at} }.

ANEXO SCORE: PESOS {ml:25,basesFrescas:20,coberturaClientes:20,diagnosticos:15,semCriticos:20}; 5 fatores razão 0–1; denominador 0 → fator 1; não-admin renormaliza 55→100 e score_parcial=true. (Idêntico ao prompt da Central.)

Restrições: NÃO editar nenhum arquivo existente exceto a linha de mount em index.js. NÃO duplicar pool de conexão (use o require de config/database). NÃO criar tabela. NÃO tocar OAuth/LC-MC.
Ao final: liste os 4 arquivos alterados e rode esta CHECKLIST Postman:
  (1) GET /operacao/resumo com token admin → todos os blocos preenchidos;
  (2) mesmo com token membro → clientes/ml = null, score_parcial=true;
  (3) grep no JSON: access_token/refresh_token/api_key NÃO aparecem;
  (4) GET /operacao/saude-bases → resumo bate com contagem manual de /bases;
  (5) GET /operacao/atividade-recente como membro → só eventos do próprio user;
  (6) sem Authorization → 401 nos três.
```

---

### C2 — Central consome o agregador (passo a passo)

```
Tarefa: ligar Portal/dashboard.js aos 3 agregadores, com fallback para os endpoints antigos. Sem mudar o visual.

Faça nesta ordem:
PASSO 1 — Criar fetchOperacao(): tenta GET /operacao/resumo. Se status 404 → retornar null (sinaliza "use fallback").
PASSO 2 — Em loadDashboard(): chamar fetchOperacao() primeiro.
  - Se veio resposta: alimentar Faixa 1 com resposta.prioridades, Faixa 2 com resposta.score + resposta.bases/clientes/ml. NÃO chamar as funções antigas de fetch.
  - Se veio null (404) OU erro: cair no CAMINHO ANTIGO atual (chamadas a /bases, /automacoes/relatorios, /clientes, /admin/ml-tokens) — exatamente como funciona hoje. A tela não pode ficar em branco.
PASSO 3 — Card "Frescor das bases": tentar GET /operacao/saude-bases; se 404, usar renderHealth(bases) antigo.
PASSO 4 — Timeline: tentar GET /operacao/atividade-recente; se 404, usar loadTimeline()/admin/logs antigo.

NÃO altere o HTML nem o visual. A Central deve ficar pixel-equivalente à entrega A, só com menos requests no caminho feliz.

Restrições: só dashboard.js (dashboard.html só se inevitável). Não tocar backend/layout.js/style.css.
Ao final: liste arquivos alterados e rode: (1) caminho feliz = 1 request principal no Network; (2) com /operacao retornando 404 (simule) → tela idêntica via fallback, sem erro no console; (3) membro → score parcial aparece.
```

---

### D2 — Refino visual e CTAs (passo a passo)

```
Tarefa: polir a Central. Só CSS escopado e copy. Nenhuma mudança de dado/endpoint/lógica.

Faça e confira um a um:
1. Cores da fila (Faixa 1): vermelho p/ token/crítico, amarelo p/ base vencida, azul p/ sem marketplace (use classes .vf-* existentes is-danger/is-warning/is-info).
2. Badge do score: ≥80 verde "Saudável", 60–79 amarelo "Atenção", <60 vermelho "Risco".
3. Timeline: formatar created_at como "há Xh"/"ontem"/data.
4. CTAs com verbo+objeto: "Reconectar token", "Vincular base", "Atualizar base", "Ver relatório".
5. Mobile: as 3 faixas empilham; tabela e mini-barras não estouram (use os utilitários responsivos já no CSS).

Restrições: CSS escopado em venforce-ui-v2.css, nunca global. Não tocar layout.js/style.css/backend/lógica JS de dados.
Ao final: liste arquivos alterados e confirme os 4 estados (loading/erro/vazio/sucesso) por faixa + 1 print mental de mobile.
```

---

## Tabela de decisão — qual conjunto usar

| Situação | Use |
|---|---|
| Agente caro mas esperto (Opus 4.8/4.7), quero economizar nº de turnos | **Conjunto 1** (menos texto, ele preenche as lacunas) |
| Sonnet ou Opus 4.7 econômico, quero evitar idas e voltas e refação | **Conjunto 2** (passos numerados travam o caminho) |
| Etapa B (backend mecânico) com qualquer agente | Tanto faz — B é mecânico; o Conjunto 2 só dá mais segurança |
| Etapa A/D (decisão de layout/copy) | Conjunto 1 se o agente for forte; Conjunto 2 se for econômico |

> Em ambos os conjuntos: o **resultado é o mesmo**. O Conjunto 2 não entrega menos — entrega o mesmo com mais trilhos.
