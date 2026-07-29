# Auditoria UX/UI — Portal VenForce (Seções 1–3)

> Sem implementação. Sem React. Sem tocar backend ou lógica de negócio.

---

## 1. Mapa das telas existentes

### Gerações visuais em uso

| Geração | CSS | Telas |
|---|---|---|
| **v1 claro** | `style.css` apenas | maioria (~19 telas) |
| **v2 claro** | `style.css` + `venforce-ui-v2.css` | dashboard, cliente-360, cliente-operacao, fechamentos-api, clickup-executivo |
| **Escuro `.fc-`** | CSS embutido no HTML | fechamento, financeiro |
| **Ilhas** | CSS próprio isolado | anuncios-meli, control-center, seller, relatorio-publico, guia-vendedor |

### Telas de operação (dia a dia)

| Tela | HTML | JS | CSS | Função no negócio |
|---|---|---|---|---|
| Dashboard | `dashboard.html` | `dashboard.js` (725 l) | style.css + ui-v2 + `<style>` inline | Cockpit de entrada: score de saúde, prioridades do dia, atividade recente |
| Clientes | `clientes.html` | `clientes.js` (494 l) | style.css + inline styles | CRUD de clientes, API keys, conexão OAuth ML (admin) |
| Cliente 360 | `cliente-360.html` | `cliente-360.js` (2.472 l) | `cliente-360.css` (1.352 l, prefixo `c360-`) + ui-v2 | Análise financeira mensal por cliente (LC/MC), 7 abas |
| Cliente Operação | `cliente-operacao.html` | `cliente-operacao.js` (1.697 l) | `cliente-operacao.css` (1.790 l, prefixo `vfop-`) + ui-v2 | Setup e prontidão operacional do cliente (o que falta, não o que resultou) |
| Bases | `bases.html` | `bases.js` (1.453 l) | style.css + classes `asst-` | Bases de custo por marketplace, importação, assistente IA, vínculos |
| Mercado Ads | `ads.html` | `ads.js` | style.css + classes `ads-` + inline | ROAS/ACOS/TACOS, performance mensal, checklist semanal, feedback ao cliente |
| Anúncios ML | `anuncios-meli.html` | `anuncios-meli.js` | `anuncios-meli.css` (804 l, prefixo `am-`, autossuficiente) | Sincronizar/otimizar anúncios ML com IA (admin) |
| Métricas | `metricas.html` | `metricas.js` (657 l) | style.css + classes `metricas-` + inline | Faturamento/pedidos ML por período com comparação (sem persistência) |
| Diagnósticos (Scans) | `scans.html` | `scans.js` (308 l) | style.css puro | MC médio por conta escaneada — tela mais simples e mais "padrão" |
| Relatórios | `relatorios.html` | `relatorios.js` (1.530 l) | style.css + muitos inline styles | Hub de relatórios de diagnóstico com pastas (CRUD) e 5 modais |
| Automações | `automacoes.html` | `automacoes.js` (1.715 l) | style.css + classes `vf-auto-`/`vf-ml-` | Diagnóstico, precificação e relatórios assíncronos |
| Promoções ML | `promocoes-retorno.html` | `promocoes-retorno.js` | style.css + `<style>` pequeno | Análise de promoções com retorno |

### Telas financeiras (⚠️ três conceitos de "fechamento")

| Tela              | HTML                     | JS                             | CSS                                                                           | Função                                                                   |
| ----------------- | ------------------------ | ------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Central de Vendas | `fechamentos-api.html`   | `fechamentos-api.js` (1.674 l) | `fechamentos-api.css` (296 l, prefixo `fapi-`) + ui-v2 + cliente-operacao.css | Conciliação por pedido com banco. Pedido = fonte da verdade. LC/MC/TACoS |
| Financeiro        | `financeiro.html`        | `financeiro.js` (1.769 l)      | **~1.370 linhas de CSS dentro do HTML** (`.fc-`, tema escuro)                 | Pipeline completo LC/MC + entrega de link público ao cliente             |
| Conversão         | `fechamento.html`        | `fechamento.js` (808 l)        | **~770 linhas de CSS dentro do HTML** (`.fc-`, tema escuro)                   | Planilha → curva ABC + ADS. Sem banco, sem LC                            |
| Relatório Público | `relatorio-publico.html` | `relatorio-publico.js`         | `relatorio-publico.css` (`rp-`)                                               | Entregável público ao cliente (sem sidebar — ilha justificada)           |

### Telas admin / auxiliares

| Tela | Arquivos | Função | Consistência |
|---|---|---|---|
| Usuários | `usuarios.html/.js` | Gestão de usuários e roles | ok (padrão vf-) |
| Tokens ML | `ml-tokens.html/.js` | Monitor de tokens OAuth | ok (padrão vf-) |
| Callbacks | `callbacks.html/.js` | Histórico OAuth | ok (padrão vf-) |
| Atividade | `atividade.html/.js` | Log de auditoria | ok (padrão vf-) |
| Control Center | `control-center.html/.js` + `control-center.css` | Debug de requests (admin, mock) | **ilha dark/mono (`vfc-`)** |
| ClickUp Executivo | `clickup-executivo.html/.js/.css` | Painel executivo ClickUp | ok (usa ui-v2) |
| Design | `design.html/.js` | Baixar imagens de anúncios | ok, simples |
| Seller | `seller.html/.js` + `seller.css` | Área externa do vendedor (`sl-`) | ilha justificada (público externo) |
| Guia Vendedor | `guia-vendedor.html` | Material editorial | ilha justificada (marketing) |
| Extensão / Ferramenta OR / Baixador | HTMLs estáticos | Downloads e tutoriais | ok, com inline styles |
| Login | `index.html` + `login.js` | Entrada | ok |

### Navegação (`layout.js`, 416 linhas)

Sidebar injetada via `window.initLayout()`: 5 grupos (Operação, Guia, Clientes, Admin, ClickUp), sendo que **o grupo "Operação" tem 19 itens planos** — lista por arquivo, não por fluxo de trabalho. Tokens ML e Callbacks aparecem em **dois grupos** (Clientes e Admin). Colapso desktop + hambúrguer mobile funcionam bem; o problema é de arquitetura de informação, não de mecânica.

---

## 2. Problemas visuais gerais

### 2.1 Dois conjuntos de tokens conflitantes (raiz de tudo)

`venforce-ui-v2.css` redefine as mesmas variáveis de `style.css` com valores diferentes:

| Token | style.css (v1) | venforce-ui-v2.css (v2) |
|---|---|---|
| `--vf-bg` | `#f8f9fc` | `#f7f8fb` |
| `--vf-text` | `#2d2d2d` | `#1b1d28` |
| `--vf-text-m` | `#6b7280` | `#5a6072` |
| `--vf-primary-hover` | `#9a6ddb` (mais claro) | `#6d35ab` (mais escuro) |
| `--vf-radius` | `16px` | `14px` |

Resultado: as 5 telas que carregam o v2 têm texto mais escuro, fundo diferente e cantos diferentes das outras ~19. É a inconsistência que o olho percebe sem saber nomear.

### 2.2 Cinco tons de roxo primário

`#5a2a8f` (primary), `#9a6ddb` (hover v1), `#7c3aed` (gradiente do logo na sidebar, hardcoded em style.css:2226), `#4a2178` (strong v2), `#6d35ab` (hover v2).

### 2.3 Border-radius: 10 valores em uso

999px (35×), 6px (18×), 10px (15×), 8px (11×), 12px (11×), 14px (7×), 16px (4×), 20px (4×), 9px, 18px. Exemplos do mesmo conceito com valores diferentes: `.vf-relatorio-pasta-item` 10px, `.vf-relatorio-card` 16px, `.vf-detail-item-card` 14px, `.vf-summary-card` 12px.

### 2.4 Botões: ~15 variantes

- v1: `.vf-btn-primary`, `.vf-btn-secondary`, `.vf-btn-danger`, `.vf-btn-xs`, `.vf-action-btn`, `.vf-action-btn-secondary`, `.vf-action-btn-danger`, `.vf-btn-retry` + família `.vf-rc-btn-*` (4 variantes só para cards de relatório).
- v2: `.vf-btn--primary`, `.vf-btn--ghost`, `.vf-btn--subtle`, `.vf-btn--danger`, `--sm`, `--lg` (naming BEM diferente do v1).
- Ilhas: `.fc-btn-primary/-secondary`, `.am-btn`, `.sl-*`.
- Paddings e font-sizes divergem entre todas.

### 2.5 Cards: 10+ anatomias

`.vf-card` (16px), `.vf-summary-card` (12px, sem sombra), `.vf-conta-card` (12px), `.ads-summary-card` (16px), `.vf-kpi-card` (16px), `.vf-mlt-stat` (16px), `.fapi-card`, `.fc-exec-card`, `.fc-stat-card`, `.c360-*`... Cada tela reinventou o card de KPI.

### 2.6 Inputs/selects desalinhados

- `clientes.html:35-50` — grid de 3 colunas onde inputs têm label e o botão não → botão fica desalinhado verticalmente.
- `bases.html:42-71` — três paradigmas de campo na mesma linha (select com label, input com label, file-label custom) + botão "Pré-visualizar" flutuando com `align-items:flex-end` inline.
- `metricas.html:97-99` e `ads.html:42-54` — mesmo padrão de `style="display:flex;align-items:flex-end"` inline para "colar" o botão nos campos.
- Sem tokens de font-size: 40+ font-sizes hardcoded no style.css.

### 2.7 Excesso de containers e inline styles

- `relatorios.html` — 5 modais, cada um com `style="display:none;position:fixed;inset:0;..."` repetido inline (linhas 94, 127, 174, 197, 224).
- `cliente-operacao.html:53-72` — flexbox definido no inline **e** no CSS (`.vfop-phead`), redundante.
- `financeiro.html` — dashboard com 12 stat cards em grid de 4 sem hierarquia (resultado "featured" perdido no meio).
- Bootstrap 5.3.3 carregado via CDN em várias telas e praticamente não usado (só reset).

### 2.8 Tabelas ruins

- Sem sticky header em nenhuma tabela (`.fc-table` tem `min-width:1080px` e vaza em telas menores).
- Números sem `font-variant-numeric: tabular-nums` nem alinhamento à direita consistente.
- `clientes.js` monta células com 7 estilos inline diferentes por linha.
- Status por cor de borda esquerda apenas (`.fapi-prow--cancel` etc.) — ilegível sem clicar.
- Nenhuma tabela tem ordenação visual padrão; paginação existe em umas (ads, callbacks) e não em outras.

### 2.9 Espaçamentos ad-hoc

`clamp()` de padding diferente por página (`.vf-content` padrão vs `.vf-page-automacoes` vs `.vf-page-financeiro`), `margin-top:24px` inline (`bases.html:213`), `margin:0` inline matando o `margin-bottom` global de `.vf-form-group` (`ads.html:42-54`). **Não existe escala de spacing tokenizada.**

### 2.10 Hierarquia fraca

- Títulos de página variam: hero com badge (`fechamento`), eyebrow+título (`fapi`), h1 simples (`clientes`), kicker v2 (`dashboard`).
- KPIs sem destaque do número principal (financeiro: resultado no meio de 12 cards iguais).
- Largura máxima de conteúdo varia por página (1080/1320/1440/1560/1680px) sem critério documentado.

### 2.11 Informações duplicadas

- Dashboard: "Clientes com base" aparece no card operacional **e** no atalho rápido; três caminhos diferentes levam a `bases.html`.
- Bases: card "Importar/Atualizar Base" e card "Assistente de Base" pedem os mesmos dados (arquivo + nome) sem explicar a diferença.
- Navegação: Tokens ML e Callbacks em dois grupos do menu.

### 2.12 Estados vazios/carregamento/erro

Existe padrão global (`.vf-empty-state`, `.vf-loading` com dots, `.vf-error-state`) **e** skeletons prontos no v2 (`.vf-skel--*`), mas cada tela reimplementou o seu: `.vf-mlt-empty`, `.vf-act-empty`, `.am-state`, `.fc-empty`, `.c360-empty--rich`, `.metricas-*`. Várias telas não têm loading nenhum (fechamentos-api renderiza sem skeleton; metricas monta "Carregando..." por string no JS). Transições entre estados são `display:none` abruptos. Empty states não distinguem "nunca teve dados" de "filtro sem resultado".

---

## 3. Problemas de UX

### 3.1 Ações principais mal posicionadas

- **Dashboard**: "Rodar diagnóstico" está no header, mas o resultado aparece dentro do card de Score — sem conexão visual. Dois dos quatro cards operacionais são clicáveis e dois não, sem indicação.
- **Clientes**: "Conectar ML" (ação 

xo) escondida como célula de tabela no meio de ações secundárias (copiar/desvincular/excluir).
- **Financeiro**: "Gerar link" (a entrega ao cliente, objetivo final) é um bloco separado no fim do form, sem confirmação clara de sucesso.

### 3.2 Filtros misturados com ações de API

- **fechamentos-api**: o HTML estático só tem cliente+período; todos os filtros (chips de curva, logística, mídia, status) nascem no JS misturados ao conteúdo. Não existe botão "Sincronizar" visível — a carga é implícita ao trocar cliente/período. Usuário não distingue "filtrar o que já veio" de "buscar de novo na API".
- **ads**: botão "Atualizar visão" dentro do card de filtros — ambíguo se filtros aplicam sozinhos ou só ao clicar.
- **relatorios**: "Atualizar" nos filtros compete com ações dos cards.

### 3.3 Falta de clareza entre dado salvo e dado sincronizado

- **cliente-360**: calcula staleness da sincronização (localStorage, `fmtSync()`) mas **não exibe** o indicador na sync bar; usuário não sabe se olha dados de agora ou de ontem.
- **cliente-operacao**: fontes marcadas internamente como `real`/`preview`/`todo` (`recordSource`) mas não exibidas na UI.
- **fechamentos-api**: badge "● Mock/motor" existe mas não muda durante carga; confiança por pedido (`bloqueado/parcial/confiavel`) não se reflete nos KPIs do topo.
- **clientes**: célula ML pode ficar stale após retorno do OAuth, sem botão de refresh.

### 3.4 Telas com blocos fora de ordem

- **Dashboard**: emergência → saúde → contexto; o natural para leitura diária é saúde no topo (ou emergência só quando existir).
- **Financeiro**: upload opcional (Order.all) no meio dos obrigatórios; campo Cliente parece obrigatório mas só serve para a entrega.
- **Bases**: dois fluxos de importação concorrentes um em cima do outro, e o resumo em cards reflete o total mesmo com busca ativa (cards não acompanham o filtro — `bases.js:860`).

### 3.5 Falta de contexto operacional

- KPIs sem tooltip/definição (Margem de quê? Score calculado como?). Score "parcial" para não-admin sem explicação.
- Fluxos multi-passo sem guard rails: trocar de cliente em anuncios-meli descarta estado sem confirmar; confirmar importação em bases falha silenciosamente porque o JS limpou os inputs (`bases.js:797-802`).
- "Próximas ações" em cliente-operacao é informacional — sem link para executar.

### 3.6 Falta de leitura rápida

- Tabelas de pedidos/produtos sem cor semântica de severidade (fechamento.html não marca produto sem custo; fechamentos-api marca só com borda de 3px).
- Filtros ativos invisíveis (nenhuma tela mostra chips do que está filtrado).
- Régua diária da Central de Vendas com texto de 10px e marcadores de 6px — ilegível.
- Reconciliação Shopee (financeiro) despeja 7 cards + comparação + narrativa sem hierarquia crítico/esperado.

### 3.7 Padrões técnicos que limitam a UX

- Renderização por `innerHTML` com template strings em todas as telas (ok manter, mas exige componentes CSS estáveis).
- `clientes.js` re-adiciona event listeners a cada render (vazamento e cliques duplicados potenciais).
- Acessibilidade: modais sem `role="dialog"`/`aria-modal` (exceto usuarios.html), spinners sem `aria-live`, status só por cor.
