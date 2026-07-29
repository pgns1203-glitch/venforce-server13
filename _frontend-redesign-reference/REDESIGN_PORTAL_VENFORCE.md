# Redesign do Portal Venforce — Guia + Prompts para IA

> **Para que serve este arquivo:** você vai colar os prompts daqui (um de cada vez) numa IA de código para redesenhar o portal **gastando o mínimo de limite de uso**. Cada prompt é autossuficiente: já carrega as regras, a direção visual e os dados reais do backend que aquela tela deve usar. Você não precisa reexplicar o projeto a cada vez.
>
> **Stack:** HTML + CSS + JS vanilla (sem framework). Camada visual nova já entregue: `venforce-ui-v2.css` e `layout-v2.js`.

---

## 0. Como usar (economizando uso)

1. Abra um chat novo com a IA e cole **uma vez** o **Bloco de Contexto Fixo** (seção 7).
2. Depois cole **um único prompt** da seção 5 por vez (P1, P2, P3...). Não cole vários juntos — uma tela por resposta mantém a mudança cirúrgica e barata.
3. Peça sempre ao final: *"liste os arquivos alterados e sugira 3 testes manuais"*.
4. Aplique, teste, e só então vá para o próximo prompt.
5. Ordem recomendada na seção 6 (começa pelo que dá mais resultado visual com menos risco).

---

## 1. Minha opinião: o backend é um monstro e o front não mostra nem metade

Você sentiu certo. Olhando o que o backend realmente expõe, o desequilíbrio é claro — **mas a boa notícia é que isso é oportunidade, não dívida.** Quase tudo que falta no front pode ser construído com dados que **já existem**, sem tocar no backend.

**O que o backend já calcula e guarda (e o front quase não usa):**

- A tabela `relatorio_itens` guarda, **por anúncio**: `lc` (lucro de contribuição em R$), `mc` (margem %), `preco_alvo`, `preco_sugerido`, `diferenca_preco`, `acao_recomendada` ("Aumentar preço", "Manter", "Revisar custo"), `diagnostico`, e `tem_base` (se tinha custo cadastrado). Ou seja: o sistema **já sabe o que fazer com cada item** — e o front mostra isso como tabela crua, sem priorizar.
- A tabela `relatorios` já traz os **agregados prontos**: `itens_criticos`, `itens_atencao`, `itens_saudaveis`, `mc_media`, `itens_sem_base`, `total_itens`, `margem_alvo`. Dá pra montar KPIs e gráficos de saúde **sem calcular nada no front**.
- A tabela `scans` (varreduras da extensão) já tem `total_anuncios`, `mc_medio`, `saudaveis`, `atencao`, `criticos`, `created_at` por conta — ou seja, dá pra montar uma **linha do tempo de saúde da loja** que hoje ninguém vê.
- `GET /anuncios-meli/resumo` já devolve contagem por status, e existe **histórico de otimizações com IA** (`/anuncios-meli/:itemId/otimizacoes`) que pode virar um feed de "o que melhorou".
- `/ads/performance`, `/ads/resumo-mensal` e `/ads/acompanhamento` têm dados de campanha que hoje viram tabela, mas pediam cartões de tendência.
- `entregas_cliente` permite publicar um pacote com link público — um diferencial comercial forte que o front trata como item secundário.
- `activity_logs` registra toda ação importante (`acao`, `status`, `created_at`) — matéria-prima pronta para um **sino de notificações** real.

**O diagnóstico honesto:** o backend computa **sinais prontos para decisão** (o que está crítico, qual ação tomar, a margem média, a evolução no tempo). O front, hoje, abre no "Importar base" (uma tarefa técnica) e exibe **tabelas planas**. Falta a camada que responde *"o que precisa da minha atenção hoje?"*.

**Minha recomendação de estratégia (importante para gastar pouco):**

1. **Não mexa no backend.** 80% do redesign é reorganizar e dar hierarquia visual a dados que já chegam nas respostas. Isso é barato e reversível.
2. **Priorize as 3 telas que mais expõem o "monstro escondido":** Central de Operação (dashboard), Relatórios e Métricas/Conversão. São as que transformam dados em decisão.
3. **Trate sino/config/avatar com honestidade:** avatar e config podem ser reais já (usam `vf-user` do localStorage e telas admin existentes); o sino começa como casca visual e depois liga em `activity_logs` ou `scans` — sem inventar endpoint.
4. **Só considere mexer no backend** se quiser endpoints de *agregação* novos (ex.: um `/dashboard/resumo` que junte tudo numa chamada). Isso é otimização, não pré-requisito — fica para depois.

Resumo: o front não precisa de mais backend. Precisa de **hierarquia, priorização e visualização** dos dados que já existem.

---

## 2. Regras inegociáveis (já embutidas nos prompts — não remova)

- **Só camada visual:** HTML, CSS e JS de tela. **Nunca** alterar `server/`, `extension/`, endpoints, métodos HTTP, payloads ou as fórmulas de **LC/MC**.
- **Não renomear nem remover campos** que o backend já devolve. Pode-se ler campos novos, nunca exigir que o backend mude.
- **Mudanças cirúrgicas:** só o que o prompt pede. Sem refatorar "de passagem".
- **Nunca `git add .`** — listar arquivos explicitamente.
- **Reaproveitar** os tokens `--vf-*` e classes `.vf-*` do `style.css` + `venforce-ui-v2.css`. Não criar paleta nova.
- **Reversível:** preferir adicionar CSS/JS sobre o existente a reescrever.

---

## 3. Direção visual (resumo de 1 parágrafo para colar)

Claro, limpo, profissional — referência **Stripe / Linear / Vercel**. Roxo de marca `#5a2a8f` como cor de identidade (não usar em excesso). Fonte **Inter** (texto) + **IBM Plex Mono** (números/código). Cantos arredondados (`--vf-radius`), sombras suaves de 2 camadas, muito espaço em branco, estados semânticos (verde = saudável, amarelo = atenção, vermelho = crítico). **Proibido:** neon, gradiente "template", cara de tema genérico de IA, excesso de bordas. Hierarquia primeiro: o olho deve achar "o que é urgente" em 2 segundos.

---

## 4. Mapa: cada dado do backend → onde ele aparece no front

Use isto para garantir que o front "reflita o backend". Nenhuma linha aqui exige mudança no backend.

| Dado / endpoint que já existe | Onde mostrar no front | Como (componente) |
|---|---|---|
| `relatorios` (agregados: críticos/atenção/saudáveis, mc_media, itens_sem_base) | Central de Operação | KPIs + gráfico de saúde |
| `relatorio_itens.acao_recomendada` + `diferenca_preco` | Central de Operação + Relatórios | Lista "Prioridades de hoje" ordenada por impacto |
| `relatorio_itens.tem_base = false` | Central de Operação + Bases | KPI "itens sem base" + atalho para corrigir |
| `scans` (histórico mc_medio/criticos por data) | Central de Operação / Métricas | Linha do tempo de saúde da loja |
| `GET /anuncios-meli/resumo` | Otimizador / Anúncios | Cartões por status (saudável/atenção/crítico) |
| `/anuncios-meli/:itemId/otimizacoes` (histórico IA) | Otimizador | Feed "o que a IA sugeriu / foi aprovado" |
| `/ads/performance` + `/ads/resumo-mensal` | Métricas / Conversão | Cartões de tendência (is-up/down) |
| `entregas_cliente` (publicado, token_publico) | Relatórios / Entregas | Botão de destaque "Publicar para o cliente" + status |
| `activity_logs` (acao, status, created_at) | Topbar (sino) | Lista de notificações recentes |
| `vf-user` (nome, email, role) no localStorage | Topbar (avatar) | Menu do usuário + logout |

---

## 5. Prompts prontos (cole um por vez)

> Antes do primeiro, cole o **Bloco de Contexto Fixo** (seção 7).

---

### P1 — Sidebar v3 (mais visual + scroll discreto)

```
Tarefa: refinar a sidebar do portal (arquivo layout-v2.js + venforce-ui-v2.css). NÃO mudar destinos de links nem a estrutura de grupos de navegação.

Objetivos:
1. Mais visual: ícone com leve "chip" de fundo no item ativo; espaçamento vertical mais respirado entre grupos; rótulos de grupo (OPERAÇÃO, MARKETPLACE, ANÁLISES, FERRAMENTAS) menores, com mais tracking e cor mais suave.
2. Item ativo: manter a barra roxa à esquerda, mas adicionar fundo roxo bem claro (use a cor de --vf-primary com baixa opacidade, ex. rgba do roxo a ~8%) e texto roxo. Só UM item ativo por vez.
3. Scroll discreto: a lista de navegação deve rolar internamente quando houver muitos itens, mantendo o cabeçalho (logo) e o rodapé (usuário + logout) sempre visíveis. Use uma barra de rolagem fina e discreta (scrollbar custom: largura ~6px, thumb cinza translúcido, track transparente; incluir variante webkit e scrollbar-width:thin para Firefox). A barra só deve aparecer quando necessário.
4. Hover suave em todos os itens (fundo cinza muito leve).

Restrições: só CSS e a estrutura de marcação que o layout-v2.js já gera. Reaproveitar tokens --vf-*. Não criar cores novas fora da paleta. Não tocar em server/ nem extension/.
Ao final: liste arquivos alterados e 3 testes manuais (incluindo "com a sidebar colapsada" e "com muitos itens forçando scroll").
```

---

### P2 — Logo VenforceGo

```
Tarefa: redesenhar a logo "VenforceGo" no cabeçalho da sidebar (gerada pelo layout-v2.js) e na topbar. Apenas marcação + CSS, sem dependência externa.

Direção:
- "Venforce" em peso forte na cor de texto principal (--vf-text); "Go" em roxo de marca (--vf-primary). Mantém a identidade atual mas mais polida.
- Adicionar um símbolo/monograma simples à esquerda do texto: um quadrado/losango arredondado com a inicial "V" ou uma seta para cima (sugere crescimento/marketplace), em roxo. Fazer em SVG inline ou CSS puro — nada de imagem externa.
- Versão reduzida para quando a sidebar estiver colapsada: mostrar só o símbolo (sem o texto), centralizado.
- Garantir alinhamento vertical perfeito entre símbolo e texto, e bom contraste.

Restrições: SVG inline ou CSS; sem libs; reaproveitar --vf-primary e --vf-text. Não alterar a lógica de colapso já existente, só o conteúdo visual do bloco da logo.
Ao final: liste arquivos alterados e mostre como fica nos 2 estados (expandida e colapsada).
```

---

### P3 — Topbar com sino, configurações e avatar (à direita)

```
Tarefa: redesenhar a barra do topo (topbar gerada pelo layout-v2.js). Hoje ela está vazia à direita das abas "Operação / Guia - Vendedor". Preencher o lado direito com 3 ações, no padrão de SaaS.

Adicionar, alinhados à DIREITA, nesta ordem:
1. Sino de notificações: ícone de sino que, ao clicar, abre um dropdown com uma lista de notificações recentes. Incluir um "badge" (bolinha/contador) quando houver não lidas.
   - Por enquanto, popular a lista de forma honesta: tentar buscar de GET /admin/logs (campos: acao, status, created_at) SE o usuário for admin (role no vf-user). Se não houver dados ou não for admin, mostrar estado vazio "Sem novidades por agora". NÃO inventar endpoint novo.
2. Ícone de engrenagem (Configurações): abre um menu com links para telas que já existem conforme o role (ex.: para admin → usuarios.html, clientes.html, ml-tokens.html; para todos → um item "Perfil" que por ora só mostra os dados do vf-user). Não criar página nova agora; se um destino não existir, omitir o item.
3. Avatar do usuário: bolinha com a inicial do nome (lida de vf-user.nome no localStorage), e ao clicar abre menu com: nome + email + role, e botão "Sair" (reutilizar a lógica de logout que o layout já tem — limpar vf-token/vf-user e ir para index.html).

Comportamento dos 3 dropdowns: abrir/fechar ao clicar, fechar ao clicar fora, fechar ao apertar Esc, e fechar um quando outro abre. Acessível (aria-haspopup/aria-expanded, navegável por teclado).
Visual: ícones em SVG inline, mesma cor/tamanho, com hover de chip cinza claro; dropdowns com sombra suave e cantos --vf-radius. Em mobile, manter usável (os 3 podem virar ícones compactos).

Restrições: só HTML/CSS/JS de tela; reaproveitar --vf-* e classes .vf-*; nada de libs; não alterar server/ nem extension/; não mudar as abas existentes, só preencher o espaço à direita.
Ao final: liste arquivos alterados e 4 testes manuais (admin com logs, usuário comum sem logs, clicar fora fecha, mobile).
```

---

### P4 — Central de Operação (dashboard que reflete o backend)

```
Tarefa: implementar/ligar a tela Central de Operação (dashboard.html / dashboard.js) usando o protótipo dashboard-central-operacao.html como referência visual. A tela deve responder "o que precisa da minha atenção hoje?" e consumir SOMENTE endpoints que já existem.

Conteúdo e ligação de dados (sem mudar backend):
- 4 KPIs no topo: clientes ativos, anúncios críticos, itens sem base, MC média. Buscar do relatório mais recente via GET /automacoes/relatorios (campos já existentes: itens_criticos, itens_sem_base, mc_media, total_itens). Para "clientes ativos", usar GET /automacoes/clientes (contagem).
- Bloco "Prioridades de hoje": carregar o relatório mais recente (GET /automacoes/relatorios/:id) e listar os itens com maior diferenca_preco e acao_recomendada != "Manter", ordenados por impacto. Mostrar título do item, ação recomendada e a diferença de preço. Usar o componente .vf-priority.
- Bloco "Confiabilidade das bases": GET /bases — mostrar quantas bases ativas e, se possível, % de itens com base (tem_base) do último relatório, em barras.
- Bloco "Diagnósticos recentes": últimos relatórios de GET /automacoes/relatorios com status e mc_media.
- Atalhos rápidos: links para importar base, rodar diagnóstico, ver relatórios.
- Estados de loading (.vf-skel/.vf-spinner) e vazio (.vf-empty) para cada bloco.

Restrições: usar venforce-ui-v2.css; ler o token JWT de localStorage('vf-token') no header Authorization Bearer, como as outras telas; tratar erro de fetch sem quebrar a tela; não alterar nenhum endpoint/payload; não tocar em server/ nem extension/.
Ao final: liste arquivos alterados e 3 testes manuais (com relatório, sem nenhum relatório, e erro de rede).
```

---

### P5 — Otimizador / Anúncios (anuncios-meli)

```
Tarefa: redesenhar a tela de Otimizador/Anúncios (anuncios-meli.html / .js) com os componentes do venforce-ui-v2.css. Só visual + reorganização; endpoints inalterados.

- Topo: cartões de resumo por status usando GET /anuncios-meli/resumo (saudáveis / atenção / críticos) como KPIs com cor semântica.
- Filtro segmentado (.vf-segment) por status, ligado aos filtros de query que GET /anuncios-meli já aceita.
- Tabela v2 (.vf-table) dos anúncios; status como .vf-tag colorida. Manter as colunas/campos que o backend já devolve.
- Painel/linha de detalhe por item (GET /anuncios-meli/:itemId) e, para admin, ações de otimizar com IA (POST .../otimizar) e histórico (GET .../otimizacoes) num feed lateral. Botão "marcar revisado" (PATCH .../revisao).
- Loading e estado vazio.

Restrições: só tela; reaproveitar .vf-*; respeitar role admin para ações admin-only; não mudar payloads; não tocar backend/extension.
Ao final: arquivos alterados + 3 testes manuais.
```

---

### P6 — Métricas + Conversão + Ads

```
Tarefa: redesenhar Métricas (metricas.html), Conversão (fechamento/conversão) e Ads (ads.html) com cartões de tendência e gráficos leves, usando dados já existentes.

- Ads: GET /ads/performance, /ads/resumo-mensal, /ads/acompanhamento → cartões KPI com .vf-trend (is-up/down/flat) e uma tabela v2 de acompanhamento.
- Métricas/Conversão: montar uma linha do tempo de saúde da loja a partir de GET /scans (mc_medio, saudaveis/atencao/criticos por created_at) — gráfico simples (pode ser SVG/canvas leve, sem lib pesada; se usar lib, só algo já disponível no projeto).
- Tudo com loading e vazio.

Restrições: visual apenas; sem novos endpoints; reaproveitar tokens e componentes; não tocar backend/extension.
Ao final: arquivos alterados + 3 testes manuais.
```

---

### P7 — Relatórios + Entregas ao cliente

```
Tarefa: redesenhar Relatórios (relatorios.html/.js) destacando o valor de "entregar ao cliente".

- Cabeçalho do relatório com agregados (de relatorios: críticos/atenção/saudáveis, mc_media) como KPIs.
- Tabela v2 dos relatorio_itens com .vf-tag por status e a coluna acao_recomendada em destaque.
- Botões de export já existentes (CSV/XLSX) estilizados como .vf-btn.
- Destaque para "Publicar para o cliente": usar POST /entregas-cliente e .../publicar (que geram token_publico). Mostrar status publicado/não publicado e o link público quando houver. Estado honesto se o relatório ainda não virou entrega.

Restrições: visual + ligação aos endpoints existentes; nada de mudar payloads; não tocar backend/extension.
Ao final: arquivos alterados + 3 testes manuais.
```

---

### P8 — Bases de Custo + Scans + Financeiro

```
Tarefa: refinar 3 telas operacionais com os componentes novos, mantendo toda a lógica atual.

- Bases (dashboard de bases): manter import (POST /importar-base) mas tirar do "centro do palco"; mostrar lista de bases (GET /bases) como cartões com confiabilidade, e destacar itens sem base.
- Scans (scans.html): GET /scans em tabela v2 com cor semântica por mc_medio/criticos; permitir deletar (admin) com confirmação.
- Financeiro/Fechamento (fechamento.html): os 3 uploads (/fechamentos/upload, /compilar, /financeiro) em passos claros (.vf-segment ou stepper visual), com feedback de processamento (.vf-skel) e resultado.

Restrições: só visual; multipart/form-data e endpoints inalterados; não tocar backend/extension.
Ao final: arquivos alterados + 3 testes manuais por tela.
```

---

## 6. Ordem de execução sugerida (do mais barato/impactante ao mais pesado)

1. **P1 Sidebar** e **P2 Logo** — baratos, mudam a percepção do produto inteiro de imediato.
2. **P3 Topbar** (sino/config/avatar) — preenche o vazio do topo, sensação de SaaS completo.
3. **P4 Central de Operação** — é onde o "monstro" do backend finalmente aparece. Maior retorno.
4. **P7 Relatórios + Entregas** — valor comercial (link público para o cliente).
5. **P5 Otimizador** e **P6 Métricas/Ads** — profundidade analítica.
6. **P8 Bases/Scans/Financeiro** — fecha a consistência.

Fazer nessa ordem evita retrabalho (sidebar/topbar/CSS base primeiro, telas depois) e gasta menos uso.

---

## 7. Bloco de Contexto Fixo (cole UMA vez no início do chat com a IA)

```
Você vai me ajudar a redesenhar o frontend do portal Venforce (SaaS de consultoria de marketplace). Stack: HTML + CSS + JS vanilla, sem framework.

DIREÇÃO VISUAL: claro e profissional, estilo Stripe/Linear/Vercel. Roxo de marca #5a2a8f (cor de identidade, usar com parcimônia). Fonte Inter (texto) + IBM Plex Mono (números). Cantos arredondados, sombras suaves, muito branco, estados semânticos (verde=saudável, amarelo=atenção, vermelho=crítico). Proibido: neon, gradiente template, cara de IA genérica.

CAMADA VISUAL EXISTENTE: já existe style.css (tokens --vf-* e classes .vf-*) e duas adições: venforce-ui-v2.css (componentes KPI, tags, banners, tabela v2, segmented, loading, etc) e layout-v2.js (sidebar + topbar). Sempre reaproveitar esses tokens e classes; nunca criar paleta nova.

REGRAS INEGOCIÁVEIS:
- Só camada visual: HTML/CSS/JS de tela. NUNCA alterar server/, extension/, endpoints, métodos HTTP, payloads ou fórmulas de LC/MC.
- Não renomear/remover campos que o backend devolve; pode ler campos, nunca exigir mudança no backend.
- Mudanças cirúrgicas: só o que o prompt pede.
- Nunca `git add .`: listar arquivos explicitamente.
- Sempre tratar loading e estado vazio; ler JWT de localStorage('vf-token') no header Authorization Bearer.
- Ao final de cada tarefa: listar arquivos alterados e sugerir 3 testes manuais.

Endpoints reais que você pode consumir (NÃO alterar): /auth/login, /auth/me, /bases, /bases/:id, /importar-base, /automacoes/clientes, /automacoes/relatorios, /automacoes/relatorios/:id, /automacoes/diagnostico-completo/:id, /anuncios-meli, /anuncios-meli/resumo, /anuncios-meli/:itemId, /ads/performance, /ads/resumo-mensal, /ads/acompanhamento, /scans, /entregas-cliente, /admin/logs (admin), /admin/users (admin), /clientes (admin).

Responda "ok, contexto carregado" e aguarde o primeiro prompt.
```

---

## 8. Arquivos de apoio que já existem (use como referência ao colar os prompts)

- `venforce-ui-v2.css` — design system com os componentes citados (KPI, tag, banner, tabela v2, segmented, skel/spinner, priority, trend).
- `layout-v2.js` — sidebar + topbar (alvo de P1, P2, P3).
- `dashboard-central-operacao.html` — protótipo visual de referência para P4.
- `venforce-design-system.html` — guia vivo dos componentes.
- `MELHORIAS_FRONTEND_VENFORCE.md` — o que já foi entregue na etapa anterior.

---

*Tudo aqui usa apenas dados e endpoints que o backend já expõe. Se em algum momento quiser uma única chamada de agregação para o dashboard (ex.: `GET /dashboard/resumo`), isso é uma otimização opcional de backend — não é pré-requisito para nenhum prompt acima.*
