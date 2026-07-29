# Design System — Fundação Proposta (Seções 4–5)

> Princípio: **consolidar, não inventar.** O `venforce-ui-v2.css` já define 40+ componentes na direção certa (claro, limpo, Stripe/Linear). O que falta: virar fonte única, ajustar tokens ao tom desejado (minimalista, **menos arredondado**, roxo discreto, bordas leves) e cobrir todas as telas internas.
> Nenhuma classe existente é renomeada — a camada nova é aditiva e a migração é por tela.

---

## 4. Design system necessário

### 4.1 Cores

Um roxo só, usado com parcimônia (identidade + ação primária + estado ativo). Eliminar `#7c3aed`, `#9a6ddb` e a dualidade v1/v2.

```css
/* Marca */
--vf-primary:        #5a2a8f;   /* único roxo de ação */
--vf-primary-hover:  #4a2178;   /* hover escurece (discreto), nunca clareia */
--vf-primary-soft:   #f4eef9;   /* fundo de seleção/estado ativo */
--vf-primary-border: #e2d5f2;   /* borda de item ativo */

/* Neutros (adotar escala v2, mais sólida) */
--vf-bg:        #f7f8fb;   --vf-bg-2:      #eef0f6;
--vf-surface:   #ffffff;   --vf-surface-2: #fbfbfe;
--vf-text:      #1b1d28;   --vf-text-m:    #5a6072;   --vf-text-l: #969cad;
--vf-border:    #e7e9f0;   --vf-border-strong: #d6d9e4;

/* Semânticas (sempre par cor + fundo; nunca cor "solta") */
--vf-success: #0f7a52;  --vf-success-bg: #e7f6ef;
--vf-warning: #b25e00;  --vf-warning-bg: #fdf1e3;
--vf-danger:  #c62828;  --vf-danger-bg:  #fdecec;
--vf-info:    #1d5fb8;  --vf-info-bg:    #e8f1fc;
```

Regra: fundo de página `--vf-bg`, superfície branca, separação por **borda 1px** (`--vf-border`) e não por sombra. Sombra só em hover de card clicável e em modal/popover.

### 4.2 Tipografia

Inter (texto) + IBM Plex Mono (números, IDs, valores monetários em tabela). Criar tokens — hoje há 40+ font-sizes hardcoded:

```css
--vf-fs-2xs: 0.6875rem;  /* 11px — th de tabela, kicker (uppercase, ls .06em) */
--vf-fs-xs:  0.78rem;    /* 12.5px — badges, metas, hints */
--vf-fs-sm:  0.875rem;   /* 14px — corpo de tabela, texto secundário */
--vf-fs-md:  0.9375rem;  /* 15px — corpo padrão, botões */
--vf-fs-lg:  1.125rem;   /* 18px — título de card/seção */
--vf-fs-xl:  1.375rem;   /* 22px — título de página (h1) */
--vf-fs-kpi: 1.65rem;    /* ~26px — valor de KPI, mono ou tabular-nums */
```

Hierarquia por página: 1 h1 (22px/700), títulos de seção 18px/650, títulos de card 15px/600, kicker 11px uppercase. Números sempre `font-variant-numeric: tabular-nums`.

### 4.3 Espaçamento

Escala de 4px, tokenizada (hoje não existe nenhuma):

```css
--vf-sp-1: 4px;  --vf-sp-2: 8px;  --vf-sp-3: 12px;  --vf-sp-4: 16px;
--vf-sp-5: 20px; --vf-sp-6: 24px; --vf-sp-8: 32px;  --vf-sp-10: 40px;
```

Padrões fixos: padding de card `--vf-sp-5`; gap entre cards `--vf-sp-4`; gap entre seções `--vf-sp-8`; padding de célula de tabela `10px 14px`. Larguras de conteúdo padronizadas em **2 opções apenas**: `1200px` (telas de formulário/gestão) e `1560px` (telas densas de dados: Central de Vendas, Cliente 360).

### 4.4 Radius (menos arredondado — ajuste sobre o v2)

```css
--vf-radius-sm: 6px;    /* botões, inputs, selects, badges retangulares, chips */
--vf-radius:    10px;   /* cards, tabelas, painéis (v2 usa 14 — reduzir) */
--vf-radius-lg: 12px;   /* modais, popovers */
--vf-radius-pill: 999px;/* SOMENTE pills de status e dots */
```

Três valores + pill. Aposentar 8, 9, 14, 16, 18, 20px.

### 4.5 Botões

Uma família, naming BEM do v2 (`.vf-btn` + modificador), 4 variantes + 2 tamanhos:

| Variante | Uso | Visual |
|---|---|---|
| `.vf-btn--primary` | 1 por bloco, ação principal | fundo roxo sólido (sem gradiente), texto branco |
| `.vf-btn--secondary` | ações normais | fundo branco, borda `--vf-border-strong`, texto `--vf-text` |
| `.vf-btn--ghost` | ações terciárias, ações em tabela | sem borda, texto `--vf-text-m`, hover `--vf-bg-2` |
| `.vf-btn--danger` | destrutivas | texto/borda danger; fundo sólido só em confirmação de modal |
| `--sm` | toolbars e células de tabela | padding 4px 10px, fs-xs |
| (padrão) | forms e headers | padding 8px 14px, fs-md, radius-sm |

Estado de loading embutido (spinner + disabled). Aposentar gradualmente: `.vf-action-btn*`, `.vf-rc-btn-*`, `.vf-btn-xs`, `.fc-btn-*`, `.am-btn` → viram aliases das 4 variantes.

### 4.6 Inputs e selects

Anatomia única para todo campo:

```
.vf-field
 ├─ .vf-field__label   (fs-xs, peso 600, cor text-m, margin-bottom 6px)
 ├─ .vf-input | .vf-select | .vf-textarea  (altura 38px, radius-sm, borda 1px,
 │            focus: borda primary + ring 3px primary-soft)
 └─ .vf-field__hint    (fs-xs, text-l)  — hint/erro no mesmo slot, cor muda
```

Regra de alinhamento: botão que acompanha campos em linha entra num `.vf-field` com label invisível (`&nbsp;`) ou o form usa `align-items:end` **na classe**, nunca inline. Campo obrigatório marcado no label (`*`), validação inline no hint — nunca só no alert do topo.

### 4.7 Cards

Uma anatomia (`.vf-card` do v2, com radius reduzido para 10px):

```
.vf-card
 ├─ .vf-card-header  (título fs-md/600 + ações à direita; borda inferior 1px)
 ├─ .vf-card-body    (padding sp-5)
 └─ .vf-card-foot    (opcional: meta, links, paginação)
```

Card clicável = `.vf-card--link` (cursor, hover com borda primary-border + sombra leve). Sem gradientes de fundo no header. `.vf-summary-card`, `.vf-conta-card`, `.ads-summary-card`, `.fapi-card`, `.fc-stat-card` migram para `.vf-kpi` (ver 4.11) ou `.vf-card`.

### 4.8 Badges

Adotar `.vf-tag` do v2 (dot colorido + texto, fundo semântico suave, radius-sm — **não** pill, para reduzir arredondamento) com `.is-success/.is-warning/.is-danger/.is-info/.is-primary/.is-neutral`. Pill (999px) fica reservado a status binário pequeno (Ativo/Inativo). Todo status tem **texto + cor**, nunca só cor.

### 4.9 Tabelas

`.vf-table` única:
- thead: fs-2xs uppercase, cor text-l, fundo surface-2, **sticky** (`position:sticky; top:0`);
- células numéricas: `.num` → alinhadas à direita, tabular-nums, mono opcional;
- linha hover `--vf-bg`; linha selecionada `--vf-primary-soft`;
- severidade por linha: `.row--danger/--warning` = fundo semântico suave (não só borda esquerda de 3px);
- wrapper `.vf-table-scroll` com radius e borda; min-width documentada;
- paginação padrão `.vf-pager` (mesma em todas as telas);
- ordenação: th clicável com seta, mesmo que a ordenação seja client-side.

### 4.10 Toolbars

Componente novo `.vf-toolbar` — resolve o problema nº 1 de UX (filtro misturado com ação):

```
.vf-toolbar
 ├─ .vf-toolbar__filters  (esquerda: busca, selects, chips de filtro ativo)
 └─ .vf-toolbar__actions  (direita: exportar, sincronizar, criar)
```

Filtros aplicam à esquerda; ações que chamam API ficam à direita, com verbo claro ("Sincronizar", "Exportar XLSX"). Filtros ativos aparecem como chips removíveis (`.vf-chip .is-active ×`).

### 4.11 KPIs

Adotar `.vf-kpi` do v2 como único componente de indicador:

```
.vf-kpi
 ├─ .vf-kpi__label  (fs-2xs uppercase + ícone chip opcional)
 ├─ .vf-kpi__value  (fs-kpi, tabular-nums)
 └─ .vf-kpi__foot   (fs-xs: tendência .vf-trend .is-up/.is-down, ou contexto)
```

Grid `.vf-kpi-grid` responsivo (4 → 2 → 1). KPI principal pode usar `.vf-kpi--featured` (span 2, valor maior) — resolve o "resultado perdido entre 12 cards" do financeiro. Todo KPI ganha `title`/tooltip com a definição da métrica.

### 4.12 Alerts

`.vf-banner` do v2 (`.is-danger/.is-warning/.is-info/.is-success`) para avisos de página; `.vf-alert` para feedback de formulário. Toast único global para confirmações rápidas ("Copiado", "Salvo") — hoje cada tela improvisa.

### 4.13 Empty states

`.vf-empty` do v2 (ícone + título + descrição + ação opcional) como único padrão, com dois tons:
- **primeiro uso**: explica o que a tela faz + botão de primeira ação;
- **filtro sem resultado**: "Nada encontrado para estes filtros" + botão "Limpar filtros".

Aposentar `.vf-empty-state`, `.vf-mlt-empty`, `.vf-act-empty`, `.am-state`, `.fc-empty`, `.c360-empty--rich` (viram a mesma classe).

### 4.14 Loading states

- **Carga de bloco/tabela**: skeletons do v2 (`.vf-skel--kpi/--row/--title`) — já prontos, quase não usados;
- **Ação de botão**: spinner embutido no `.vf-btn` + disabled;
- **Sincronização de página**: barra de estado dos dados (ver seção 5) mostra "Sincronizando…";
- Transição estado→estado com fade curto (`--vf-ease`), nunca `display:none` seco.

---

## 5. Padrão ideal de página

Toda tela interna do portal segue esta estrutura, de cima para baixo:

```
┌────────────────────────────────────────────────────────────┐
│ 1. PAGE HEADER                                             │
│    kicker (área: "OPERAÇÃO")                               │
│    h1 + descrição curta (1 linha, o que a tela resolve)    │
│    [ações primárias à direita: 1 primary + até 2 secondary]│
├────────────────────────────────────────────────────────────┤
│ 2. TOOLBAR DE CONTEXTO (filtros globais)                   │
│    cliente · período · escopo   |   [chips de filtro ativo]│
├────────────────────────────────────────────────────────────┤
│ 3. BARRA DE ESTADO DOS DADOS                               │
│    ● Sincronizado há 12 min · fonte: API ML   [Atualizar]  │
│    (ou: ● Dados salvos localmente · nunca sincronizado)    │
├────────────────────────────────────────────────────────────┤
│ 4. KPIs (.vf-kpi-grid — 1 linha, 3 a 5 indicadores)        │
├────────────────────────────────────────────────────────────┤
│ 5. BLOCOS ANALÍTICOS (.vf-card com header + gráfico/lista) │
│    ordem: visão agregada → detalhe                         │
├────────────────────────────────────────────────────────────┤
│ 6. TABELAS (.vf-card contendo .vf-toolbar local +          │
│    .vf-table sticky + .vf-pager)                           │
│    toolbar local = busca da tabela + exportar (não mistura │
│    com filtros globais do item 2)                          │
├────────────────────────────────────────────────────────────┤
│ 7. RODAPÉ/STATUS (opcional): totais, última atualização,   │
│    contagem de registros exibidos vs. total                │
└────────────────────────────────────────────────────────────┘
```

Regras da estrutura:

1. **Header** sempre com h1 único e descrição de 1 linha. As ações do header são as ações da *tela*, não de um bloco específico.
2. **Filtros globais** (item 2) mudam *o que se olha*; **ações** mudam *o estado dos dados*. Nunca no mesmo container.
3. **Barra de estado dos dados** é a resposta padrão para "salvo vs. sincronizado": todo dado que vem de API mostra origem + idade + botão de atualizar. Todo dado local mostra "salvo localmente".
4. **KPIs antes de tabelas**, sempre. Emergências/banners só aparecem quando existem (não reservar espaço vazio).
5. **Empty/loading/error** nos três níveis: página (skeleton geral), bloco (skeleton do card) e ação (spinner no botão).
6. Modais só para confirmação e formulários curtos; detalhe de registro denso prefere painel lateral ou expansão de linha.
