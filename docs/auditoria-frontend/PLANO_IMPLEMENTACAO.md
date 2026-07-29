# Prioridades e Plano de Implementação (Seções 6–7)

> Regras respeitadas: sem React, sem tocar backend, sem alterar lógica de negócio, sem renomear classes existentes de uma vez. Tudo aditivo e por tela — se algo quebrar, remove-se um `<link>` e volta ao estado anterior.

---

## 6. Prioridade de correção

### 🔴 Urgente (é o que faz o portal parecer "quebrado")

1. **Resolver a dualidade v1/v2 de tokens.** Hoje 5 telas têm cores/radius/texto diferentes das outras 19 porque `venforce-ui-v2.css` redefine `--vf-bg`, `--vf-text`, `--vf-radius`. Decisão: os tokens do v2 (ajustados — radius menor) viram os oficiais e passam a carregar em **todas** as telas internas.
2. **Um roxo só.** Eliminar `#7c3aed` (gradiente do logo, style.css:2226), `#9a6ddb` e `#6d35ab` → `#5a2a8f` + hover `#4a2178`.
3. **Radius e bordas.** Reduzir para a escala 6/10/12 + pill; borda 1px `--vf-border` como separador padrão no lugar de sombras.
4. **Estados vazios/carregamento/erro unificados** com os componentes que já existem no v2 (`.vf-empty`, `.vf-skel--*`) — maior ganho de "solidez percebida" por esforço.
5. **Central de Vendas (fechamentos-api): separar filtro de sincronização.** Adicionar barra de estado dos dados (fonte + idade + botão explícito de sincronizar/atualizar) e chips visíveis de filtros ativos. É a tela mais trabalhada recentemente e a mais confusa nesse aspecto.
6. **Botões unificados nas 6 telas mais usadas** (dashboard, clientes, cliente-360, bases, fechamentos-api, financeiro) — 1 primary por bloco, resto secondary/ghost.

### 🟡 Importante (consistência e manutenção)

7. **Migrar `fechamento.html` e `financeiro.html` do tema escuro para o claro** e extrair as ~2.100 linhas de CSS embutido no HTML para arquivos próprios. São telas core com visual oposto ao resto do portal.
8. **Padronizar modais**: uma classe overlay/shell, matar os `style="position:fixed;inset:0"` inline repetidos (relatorios.html tem 5).
9. **Tabelas padrão**: sticky header, números à direita com tabular-nums, severidade por fundo de linha, paginação única.
10. **Page header padrão** (kicker + h1 + descrição + ações) em todas as telas.
11. **Alinhamento de formulários**: anatomia `.vf-field` e fim dos `align-items:flex-end` inline (clientes, bases, ads, metricas).
12. **Remover Bootstrap 5.3.3** dos HTMLs (carregado e não usado — só peso e risco de conflito).
13. **Barra de estado dos dados** em cliente-360 (staleness já calculado no JS, só exibir) e cliente-operacao (fontes real/preview/todo já registradas, só exibir).
14. **Bases**: fundir/explicar os dois fluxos de importação (Importar vs. Assistente) e corrigir os cards de resumo que ignoram o filtro de busca.

### 🟢 Depois (refinamento)

15. Reorganizar navegação por fluxo de trabalho (5 grupos contextuais em vez de 19 itens planos em "Operação") — proposta já existe em `_frontend-redesign-reference/`.
16. Acessibilidade: `role="dialog"`, `aria-live` em loading, status com texto além de cor.
17. Transições de estado (fade) e microinterações.
18. Tooltips de definição em todos os KPIs (Margem, Score, TACoS...).
19. Correções técnicas de JS: event delegation em `clientes.js` (listeners duplicados a cada render), templates HTML para empty states hoje gerados por string.
20. Ilhas externas (`seller`, `guia-vendedor`, `relatorio-publico`) — podem permanecer diferentes (públicos distintos), apenas alinhando cores da marca.
21. Control Center — dark/mono é aceitável para ferramenta de debug admin; baixa prioridade.

---

## 7. Plano de implementação em fases

### Fase 1 — Fundação visual (sem tocar nenhuma tela)

**Objetivo:** uma única fonte de verdade de tokens, carregada em todo o portal, sem quebrar nada.

1. Criar `Portal/css/vf-tokens.css`: tokens finais (cores, tipografia, spacing, radius 6/10/12, sombras, larguras 1200/1560) — base = tokens do v2 com radius reduzido e roxo único.
2. Criar `Portal/css/vf-components.css`: consolidação dos componentes do v2 (`.vf-btn--*`, `.vf-card`, `.vf-kpi`, `.vf-tag`, `.vf-table`, `.vf-toolbar`, `.vf-field`, `.vf-empty`, `.vf-skel`, `.vf-banner`, `.vf-modal`, `.vf-pager`) + aliases de compatibilidade (ex.: `.vf-btn-primary` herda de `.vf-btn--primary`) para as classes antigas continuarem funcionando.
3. Trocar, em **todas** as telas internas, o `<link>` de `venforce-ui-v2.css` (onde existe) e adicionar os dois novos arquivos **depois** do `style.css`. Nenhum HTML/JS de tela muda além do `<head>`.
4. Ajuste pontual no `style.css`: gradiente do logo (`#7c3aed` → tokens) e `--vf-primary-hover`.
5. Critério de aceite: as 24 telas internas com o mesmo fundo, mesmo texto, mesmo roxo, mesmos cantos — sem nenhuma regressão funcional.

**Risco:** baixo (camada aditiva; rollback = remover `<link>`).

### Fase 2 — Padronizar componentes (varredura mecânica)

**Objetivo:** todo botão, campo, card, tabela, badge, modal e estado usa a família única.

1. Botões: mapear variantes antigas → novas por busca/substituição de classe, tela a tela (sem tocar lógica).
2. Formulários: envolver campos em `.vf-field`, remover `style="display:flex;align-items:flex-end"` e `margin:0` inline.
3. Modais: classe única de overlay/shell; remover posicionamento inline.
4. Tabelas: aplicar `.vf-table` + sticky + `.num`; paginação única.
5. Estados: substituir os 6 padrões de empty/loading pelos componentes únicos; adicionar skeletons onde não há loading nenhum.
6. Remover Bootstrap dos `<head>`.
7. Ordem sugerida da varredura (menor risco → maior): scans → callbacks → atividade → ml-tokens → usuarios → clientes → ads → metricas → relatorios → bases → automacoes → promocoes-retorno.

**Risco:** baixo/médio (mudanças de classe e markup, nunca de lógica; testar cada tela após a varredura).

### Fase 3 — Corrigir as telas mais usadas (estrutura de página)

**Objetivo:** aplicar o "padrão ideal de página" (doc DESIGN_SYSTEM_FUNDACAO.md §5) nas telas de maior uso.

Ordem por impacto:

1. **fechamentos-api (Central de Vendas)** — page header padrão; toolbar com filtros à esquerda / sincronizar+exportar à direita; barra de estado dos dados (fonte, idade, confiança agregada); chips de filtro ativo; régua diária legível (mínimo 12px); severidade por fundo de linha.
2. **dashboard** — reordenar faixas (saúde → emergência quando houver → atividade); cards clicáveis todos com affordance; eliminar duplicação de atalhos; skeletons reais.
3. **cliente-360** — exibir sync bar com staleness + botão atualizar; alinhar alturas do cockpit (`grid-auto-rows`); tooltips nos KPIs; indicação clara da competência ativa.
4. **bases** — um fluxo de importação com escolha explícita ("planilha pronta" vs. "planilha para normalizar com assistente"); resumo respeitando filtro; fix do estado limpo pós-preview.
5. **financeiro** — migrar para tema claro com CSS externo; formulário em ordem obrigatório→opcional; resultado como `.vf-kpi--featured`; fluxo de entrega com confirmação visível do link gerado.
6. **fechamento (Conversão)** — mesma migração de tema; clarificar marketplace × arquivo(s); severidade nas tabelas.

**Risco:** médio (mexe em estrutura de HTML e strings de render no JS, sem tocar chamadas de API nem cálculos).

### Fase 4 — Refinar UX operacional

1. Barra de estado dos dados em todas as telas com dado de API (padrão único: origem + idade + atualizar).
2. Microcopy: hints nos campos ("Cliente — usado apenas para a entrega"), tooltips de KPI, explicação do score parcial.
3. Guard rails: confirmação ao trocar cliente com estado pendente; botões de export habilitados com explicação de quando ativam.
4. Navegação por grupos de trabalho (proposta da referência) — mudança apenas no array `NAV_GROUPS` do `layout.js`.
5. Acessibilidade e transições.
6. Correções técnicas de render (event delegation, templates).

---

## Arquivos a criar ou reorganizar

### Criar

| Arquivo                                      | Conteúdo                                                              | Fase    |
| -------------------------------------------- | --------------------------------------------------------------------- | ------- |
| `Portal/css/vf-tokens.css`                   | Fonte única de tokens (cores, tipografia, spacing, radius, sombras)   | 1       |
| `Portal/css/vf-components.css`               | Componentes unificados + aliases de compatibilidade                   | 1       |
| `Portal/css/pages/financeiro.css`            | CSS extraído do `<style>` de financeiro.html, migrado para tema claro | 3       |
| `Portal/css/pages/fechamento.css`            | CSS extraído do `<style>` de fechamento.html, migrado para tema claro | 3       |
| `docs/auditoria-frontend/*` (estes arquivos) | Auditoria e plano                                                     | ✅ feito |

### Reorganizar (opcional, junto da Fase 2)

Mover CSS por página para `Portal/css/pages/` mantendo os nomes: `cliente-360.css`, `cliente-operacao.css`, `fechamentos-api.css`, `anuncios-meli.css`, `control-center.css`, `clickup-executivo.css`, `seller.css`, `relatorio-publico.css` (exige só atualizar os `<link>`).

### Aposentar (após migração completa — não deletar antes)

| Arquivo                                                                                    | Motivo                                                       | Quando        |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------ | ------------- |
| `Portal/venforce-ui-v2.css`                                                                | Conteúdo absorvido por `vf-tokens.css` + `vf-components.css` | fim da Fase 2 |
| Bootstrap 5.3.3 (CDN nos `<head>`)                                                         | Carregado e não usado                                        | Fase 2        |
| `<style>` embutidos (fechamento, financeiro, dashboard, promocoes-retorno, guia-vendedor*) | Extraídos para arquivos                                      | Fase 3        |
| Aliases de compatibilidade (`.vf-btn-primary` → `.vf-btn--primary` etc.)                   | Quando nenhuma tela usar as classes antigas                  | fim da Fase 3 |

\* guia-vendedor pode manter o próprio estilo (material editorial), apenas movendo o CSS para arquivo.

### Não mexer

- `style.css` permanece carregado durante toda a migração (os novos arquivos sobrescrevem por ordem de cascata). Só emagrece no final, quando cada bloco morto for comprovadamente órfão.
- `layout.js` — estrutura atual funciona; só o array `NAV_GROUPS` muda na Fase 4.
- Qualquer `.js` de chamada de API, cálculo ou fluxo de dados.
