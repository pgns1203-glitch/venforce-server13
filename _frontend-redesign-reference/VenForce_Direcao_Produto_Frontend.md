# VenForce — Direção de Produto & Frontend

> Documento estratégico. Não é código, patch nem comando — é direção.
> Toda ideia vem classificada por esforço:
> **(1)** frontend + endpoints atuais · **(2)** pequeno ajuste backend · **(3)** endpoint novo · **(4)** tabela/mudança no banco · **(5)** roadmap futuro · **(6)** arriscado, validar antes.

---

## 1. Diagnóstico sincero

**O que o VenForce já tem de poderoso (e é raro):**
O backend é nível de produto sério, não de ferramenta interna. Você tem cálculo de LC/MC real, OAuth do Mercado Livre com refresh worker, fechamento financeiro validado contra planilha real (<1% de variância), Otimizador V2 rodando 4 chamadas paralelas de IA por anúncio, orquestração multi-agente, scans, entregas públicas e logs. **A maioria dos SaaS de marketplace no Brasil não tem metade disso.**

**Onde o frontend não acompanha:**
O backend *pensa* (calcula margem, gera diagnóstico, mede cobertura), mas o frontend só *lista*. Dado rico vira tabela plana. O usuário vê números, mas não vê **"o que isso significa"** nem **"o que fazer agora"**. A inteligência morre na borda da API.

**Onde existe desperdício de dados:**
- Logs, scans e diagnósticos históricos existem mas não viram nenhuma visão agregada (atividade, timeline, tendência).
- Status de token ML existe no banco mas não vira alerta visível e acionável.
- Cobertura de custo é calculável por cliente, mas não é exposta como score.
- Fechamentos financeiros são gerados mas não viram série histórica.

**Onde a equipe se perde:**
Navegação por arquivo, não por trabalho. São ~15 áreas planas na lateral. Um auxiliar abre o portal e não sabe o que fazer primeiro. Não existe hierarquia "operação → dados → inteligência → entrega".

**Onde ainda parece interna demais:**
- Falta padronização de estados (loading / erro / vazio / sucesso).
- Falta narrativa: nenhuma tela diz "isto está em risco, faça X".
- Visual de "tool", não de produto que dá orgulho de mostrar pro cliente.

**Onde está o potencial premium real:**
O backend já é premium. O que falta é a **camada de operação inteligente**: score de saúde por loja, trilha de ação, cockpit por cliente, entregas compartilháveis. Isso é 100% construível em cima do que você já tem — não precisa reinventar nada do core.

---

## 2. Visão de produto

**Como o VenForce deveria ser percebido:**
Não como "ferramenta de cálculo de margem", mas como **o sistema operacional da assessoria de marketplace** — onde a equipe opera a carteira inteira de clientes com confiança, e o gestor enxerga risco e resultado de um lugar só.

**Promessa de cada área:**

| Área | Promessa em uma frase |
|---|---|
| **Central de Operação** | "O que precisa da minha atenção hoje — e por quê." |
| **Relatórios** | "Vira entregável de cliente em 1 clique." |
| **Automações** | "Diagnóstico e ação assistidos por IA, sempre sob controle humano." |
| **Métricas / Ads / Conversão** | "Venda, investimento, margem e conversão no mesmo lugar." |
| **Bases de Custo** | "A fonte de verdade confiável — sei o que está coberto e o que não está." |

**Como fazer a equipe querer abrir o portal todo dia:**
A Central tem que dizer o que fazer. Cada cliente precisa ter um cockpit próprio. O gestor cobra resultado por **score**. Quando a tela vira "lista de tarefas com contexto", o portal deixa de ser obrigação e vira hábito.

---

## 3. Nova arquitetura de navegação

Hoje: 15 itens planos, agrupados por arquivo. Proposta: **6 grupos por operação real**, com seções colapsáveis.

```
OPERAÇÃO
  ├─ Central de Operação        (cockpit diário)
  ├─ Clientes                   (cockpit por cliente)  ← novo
  └─ Ações / Prioridades        (fila acionável)       ← novo

DADOS & CUSTO
  ├─ Bases de Custo
  ├─ Cobertura                  (visão de gaps)        ← derivado
  └─ Scans

INTELIGÊNCIA
  ├─ Automações / Diagnósticos
  ├─ Otimizador (Meli V2)
  └─ Métricas / Ads / Conversão

ENTREGAS
  ├─ Relatórios
  ├─ Central de Entregas        (públicas + histórico) ← consolida
  └─ Financeiro / Fechamento

FERRAMENTAS
  ├─ Extensão · Ferramenta OR · Baixador de Mídias · Design

ADMIN  (só admin)
  └─ Clientes/Admin · Logs · Conexões ML
```

**Topbar:** seletor de cliente **global** (muda o contexto de toda a operação), busca, status ML resumido, avatar/role.
Classificação: reorganização visual = **(1)**; "Cobertura", "Ações" e "Clientes cockpit" dependem de agregadores = **(3)**.

---

## 4. Central de Operação — cockpit diário

**Princípio único:** *nada aparece na tela sem um próximo passo.* Se um dado não vira ação, ele vai pra tela de detalhe, não pro cockpit.

**Manter:** saudação personalizada, alerta de bases desatualizadas, prioridades de hoje, diagnósticos recentes, cobertura de custo.

**Remover / condensar:** KPIs de bases redundantes (detalhe vai pra tela Bases), "status da operação" genérico que não vira ação, contadores soltos sem CTA.

**Reorganizar em 3 faixas:**
1. **"Precisa de você hoje"** (topo) — ações priorizadas com CTA direto.
2. **"Saúde da operação"** (meio) — score da carteira, ML pendentes, clientes sem base, entregas pendentes.
3. **"Atividade recente"** (base) — timeline de diagnósticos, fechamentos, conexões.

**Novos cards que deveriam existir:**
- **Score operacional da carteira** — uma nota só, 0–100. **(3)**
- **Clientes em risco** — sem token ML / sem base / base vencida, com CTA "resolver". **(3)**
- **Fila de aprovação IA** — o que a IA sugeriu e aguarda aprovação humana (admin-gated). **(1/3)**
- **Entregas pendentes** — relatórios prontos mas não enviados ao cliente. **(3)**

**Alertas que realmente importam:** token ML expirado/expirando, base vencida, cliente sem base, diagnóstico crítico não entregue. Cada um com botão de resolução, não só aviso.

---

## 5. Sidebar e topbar — plano seguro (atenção ao `layout.js` global)

**Causa raiz da quebra anterior:** `layout.js` é **global e protegido**, e `style.css` (Portal) também é protegido. Redesenhar a shell de uma vez mexe em todas as telas ao mesmo tempo → quebra tudo.

**Regra de ouro:** *não tocar em `layout.js` nem em `style.css`.* A nova shell é **aditiva e opt-in**, página por página.

**Plano de microetapas (à prova de quebra):**
1. Criar uma **shell v2 isolada** — novo CSS escopado (ex.: `nav-v2.css`) + uma classe raiz opt-in (ex.: wrapper `.vf-shell-v2`). Nada herda do global. **(1)**
2. Aplicar **só numa página de teste** descartável. Validar visual e comportamento. **(1)**
3. Migrar **1 página real** (a Central, que é a vitrine) para a shell v2. **(1)**
4. Repetir página a página, sempre uma de cada vez. **(1)**
5. Só no **final**, quando todas migraram, virar a shell v2 como default. **(6 — validar antes)**

**Admin vs usuário comum:** itens de Admin atrás de flag de role; usuário comum vê o subconjunto operacional.

**Sempre visível:** seletor de cliente, Central, busca, status ML.
**Fica pra depois:** grupos colapsáveis com memória de estado, temas, atalhos de teclado.

**Primeira etapa a fazer:** shell v2 isolada + Central como página piloto. Zero risco para o resto.

---

## 6. Relatórios

Estrutura ideal da tela, em blocos:
- **Resumo executivo** — 3–5 números que contam a história.
- **Saúde da operação** — score + cobertura + bases.
- **Itens críticos** — o que está sangrando margem.
- **Itens sem base** — onde não dá pra confiar no cálculo.
- **Ações recomendadas** — lista priorizada.
- **Impacto financeiro estimado** — "resolver isso = +R$ X de margem". **(3 — agregador)**

**Duas visões:**
- **Interna (gestor):** completa, com tudo cru.
- **Pública (cliente):** curada, branded, no tema claro Venforce — **liga ao sistema de entregas públicas que você já tem.** **(1/2)**

**Exportação / compartilhável:** relatório → entrega pública com link. A ponte entre os dois já está meio construída; falta o botão "publicar este relatório". **(2)**

---

## 7. Automações

Transformar em **wizard linear** (claro até pro auxiliar):

```
1. Selecionar cliente/base  →  2. Diagnóstico completo  →
3. Preview ML  →  4. Preview Shopee  →  5. Salvar relatório  →
6. Polling (status)  →  7. Histórico  →  8. Ações recomendadas
```

**Estados obrigatórios em cada passo:** loading (com o que está rodando), erro (com retry), vazio (com orientação), sucesso (com próximo passo).

**Constraints que a UI tem que respeitar (não negociável):**
- Nunca rodar IA em lote automaticamente.
- Nunca enviar dado ao ML a partir de endpoint de aprovação.
- Todo gatilho de IA é admin-gated.

Classificação: o fluxo é **(1)** sobre endpoints existentes; histórico persistente pode exigir **(3/4)**.

---

## 8. Métricas / Ads / Conversão

**KPIs que importam (e como se conectam):**

```
Receita → Investimento (ACOS/TACOS) → Margem (LC/MC) → Conversão → Cobertura
```

A história é: *vendi X, gastei Y em ads, sobrou Z de margem, converti W%.* Hoje cada peça vive numa tela separada.

- **Já basta:** LC/MC e dados de ads existem. Dá pra montar uma visão de snapshot **agora**. **(1)**
- **Falta:** série temporal agregada (tendência mês a mês) → **endpoint agregador (3)**.
- **Roadmap:** tabela de snapshots diários por cliente para gráficos históricos → **(4/5)**.

---

## 9. Bases de custo

Tela mais confiável, cada base com:
- **Status** (válida / vencida / incompleta). **(1/2)**
- **Cobertura** (% de SKUs com custo). **(2/3)**
- **Última atualização** + aviso de risco quando velha. **(1)**
- **Marketplace identificado** + **cliente vinculado**. **(1)**
- **Assistente de base** — guia de importação. **(3)**
- **Preview antes de importar** — ver o que vai entrar. **(3)**
- **Histórico de importações** + **qualidade da base**. **(3/4)**

---

## 10. Ideias de backend (classificadas)

| Ideia | Tipo |
|---|---|
| Resumo operacional geral (1 chamada → cockpit) | **(3)** endpoint agregador |
| Saúde das bases (status + cobertura por base) | **(2/3)** |
| Clientes com/sem token ML | **(2/3)** simples |
| Cobertura por cliente | **(3)** agregador |
| Relatórios críticos recentes | **(3)** |
| Diagnóstico por período | **(3)** (+ índice se ficar lento) |
| Atividade recente (em cima de logs) | **(3)** |
| Ações pendentes | **(3)** agregador |
| Timeline do cliente | **(3)** agregador / **(4)** tabela de eventos |
| Score operacional / saúde da loja | **(3)** agregador → **(4)** snapshot p/ histórico |
| **Multi-tenant: client id no `state` do OAuth** | **(4) + (6)** — gap já identificado, **validar bem antes** |

> O agregador de **resumo operacional** é o de maior alavancagem: alimenta a Central, o card de score e o cockpit por cliente de uma vez.

---

## 11. Ideias grandiosas (roadmap)

- **Cockpit por cliente** — abre um cliente e vê tudo: saúde, bases, ML, ads, entregas, timeline. **(5)**
- **Score de saúde da loja** — nota 0–100 que vira KPI de cobrança da equipe. **(5)**
- **Trilha de ações recomendadas** — "faça isto, depois isto" por cliente. **(5)**
- **Alertas inteligentes** — antecipar token vencendo, margem caindo, base velha. **(5)**
- **Calendário operacional** — fechamentos, vencimentos, entregas. **(5)**
- **Central de entregas** — tudo que foi/será enviado ao cliente. **(5)**
- **Ranking de riscos** — clientes ordenados por urgência. **(5)**
- **Camada de insights** — narrativa automática sobre os números. **(5)**
- **IA como copiloto opcional** — explica e sugere, nunca age sozinha. **(5/6)**
- **Visões por papel** — gestor (executiva), auxiliar (simplificada), cliente (pública). **(5)**

---

## 12. Plano de execução por fases

**Fase 0 — Estabilizar (não quebrar)**
Objetivo: padronizar estados (loading/erro/vazio) sem mexer no global. · Impacto: médio, percebido como "mais sólido". · Arquivos: componentes de estado novos, escopados. · Risco: baixo. · Backend: não. · Ferramenta: **manual/Codex**. · Teste: cada tela mostra os 4 estados. · Pronto: nenhuma tela trava em branco.

**Fase 1 — Central vira cockpit (frontend puro)**
Objetivo: 3 faixas + cards acionáveis com dados atuais. · Impacto: **alto** (é a vitrine). · Arquivos: a página da Central. · Risco: baixo. · Backend: usa endpoints atuais. · Ferramenta: **Claude/Opus** (decisão de layout e hierarquia). · Teste: cada card tem CTA. · Pronto: nada na tela sem próximo passo.

**Fase 2 — Agregadores backend simples**
Objetivo: resumo operacional, saúde das bases, status ML. · Impacto: alto (destrava score e alertas). · Arquivos: novos controllers/services (sem tocar nos protegidos). · Risco: baixo/médio. · Backend: **(3)**. · Ferramenta: **Codex** (endpoint CRUD/agregador é mecânico), **Opus** só pra desenhar o contrato. · Teste: 1 chamada devolve o cockpit. · Pronto: Central carrega de um endpoint só.

**Fase 3 — Shell v2 isolada + migração página a página**
Objetivo: nova sidebar/topbar sem quebrar `layout.js`. · Impacto: alto (vira "premium"). · Arquivos: `nav-v2.css` novo + wrapper opt-in. · Risco: **médio (por isso é faseado)**. · Backend: não. · Ferramenta: **Opus** (arquitetura segura). · Teste: página piloto isolada. · Pronto: Central na shell v2, resto intacto.

**Fase 4 — Relatórios interno/público + Central de entregas**
Ferramenta: **Opus** (produto) + **Codex** (glue). · Backend: **(2/3)**. · Pronto: relatório vira entrega pública em 1 clique.

**Fase 5 — Cockpit por cliente + score**
Ferramenta: **Opus**. · Backend: **(3)** → **(4)** p/ histórico. · Pronto: abrir cliente mostra saúde + ações.

**Fase 6 — Métricas temporais**
Backend: **(4)** snapshots. · Ferramenta: **Codex** (coleta) + **Opus** (visualização). · Roadmap.

---

## 13. Priorização final

**Fazer primeiro:** Fase 1 (Central cockpit, frontend) + Fase 2 (2–3 agregadores simples). Maior valor percebido, menor risco. A operação inteira ganha um cérebro sem você tocar em nada protegido.

**Evitar agora:**
- Redesenhar `layout.js` / sidebar de uma vez. (Foi o que quebrou — só faça faseado na Fase 3.)
- Mexer no multi-tenant do OAuth (`client id` no `state`) sem validação dedicada — é **(4)+(6)**.

**Onde ganha mais valor com menos risco:** Central acionável + alertas de ML/base. É 80% do "parecer premium" com 20% do esforço.

**Onde vale Opus/Max:** arquitetura da shell segura, desenho dos agregadores e do score, decisões de produto, cockpit por cliente.
**Onde vale Codex:** endpoints CRUD/agregadores mecânicos, refactors repetitivos, glue de frontend.
**Onde NÃO vale gastar IA poderosa:** CSS escopado trivial, ajustes de copy, estados de loading — manual ou Codex barato.

**Próximo prompt ideal (depois deste):**
> "Detalhe a Fase 1 (Central cockpit): os cards exatos, o dado de cada um, quais endpoints atuais alimentam cada card, e a especificação dos 2 agregadores novos da Fase 2 (campos de entrada e saída). Sem código ainda — só especificação de tela e contrato de API."

Isso te dá o blueprint executável da próxima entrega, ainda sem risco de quebrar nada.
