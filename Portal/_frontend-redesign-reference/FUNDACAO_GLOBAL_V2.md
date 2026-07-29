# Fundação Global V2 — VenForce

Design system operacional do Portal VenForce. Esta é a fonte única de verdade
para aplicar a fundação em qualquer tela.

**Arquivos:**

| Arquivo | Papel |
|---|---|
| `Portal/css/vf-tokens-v2.css` | Tokens (cores, tipo, spacing, forma, sombra, camadas, foco, densidade) + reset mínimo |
| `Portal/css/vf-components-v2.css` | Todos os componentes globais |
| `Portal/_frontend-redesign-reference/fundacao-global-v2.html` | Laboratório visual (estático, sem API) |
| `Portal/_frontend-redesign-reference/FUNDACAO_GLOBAL_V2.md` | Este documento |

Os arquivos V1 (`vf-tokens.css`, `vf-components.css`, `fundacao-global-v1.html`)
**não foram alterados** e continuam funcionando de forma independente.

---

## 1. Visão geral e princípios

O VenForce é uma ferramenta de trabalho usada horas por dia sobre tabelas,
valores monetários, margens e estados operacionais. A fundação segue seis
princípios, nesta ordem de prioridade:

1. **Clareza antes de estética.** Hierarquia tipográfica e contraste resolvem
   antes de qualquer decoração.
2. **Densidade sem aperto.** Espaçamento em múltiplos de 4px, com uma densidade
   compacta opcional para telas de operação pesada.
3. **Previsibilidade.** O mesmo padrão (`bloco__elemento--modificador` +
   `.is-estado`) em todos os componentes. Quem aprendeu um, aprendeu todos.
4. **Roxo com parcimônia.** `#5a2a8f` marca ação primária, seleção e foco.
   Nunca é fundo de área grande.
5. **Sombra é informação.** Só elementos flutuantes (menu, popover, modal,
   toast) têm sombra permanente. Cards ganham sombra apenas no hover quando
   são clicáveis.
6. **Estado nunca depende só de cor.** Todo estado tem texto, forma ou ícone
   além da cor.

### O que não fazer

- Não usar gradientes, glassmorphism, glow ou sombras pesadas.
- Não criar pill decorativa para eyebrow/kicker — é texto uppercase pequeno.
- Não usar fonte mono em todo número — mono é só para IDs/códigos (`.vf-mono`).
- Não criar classes específicas de página dentro dos arquivos `vf-*`.
- Não usar `!important` (única exceção já existe: `prefers-reduced-motion`).
- Não estilizar por ID.
- Não inventar cores fora dos tokens — se falta um valor, o token nasce em
  `vf-tokens-v2.css` primeiro.

---

## 2. Fontes

Carregar via Google Fonts (mesmo link do laboratório):

```html
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=Manrope:wght@500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```

| Fonte | Papel | Onde |
|---|---|---|
| **Hanken Grotesk** | corpo | textos, labels, botões, campos, células de tabela, navegação, avisos |
| **Manrope** | display | títulos (h1–h4), KPIs, números de destaque, moeda, percentuais em evidência |
| **IBM Plex Mono** | técnico | MLB, SKU, IDs, códigos, logs — via `.vf-mono` |

Helpers globais (definidos em tokens):

- `.vf-mono` — família mono, 0.92em, para códigos.
- `.num` — Manrope + `tabular-nums` + alinhado à direita, para colunas
  numéricas e KPIs. **Todo `td`/`th` numérico deve ter `.num`.**

Valores monetários em KPI ficam em uma linha (`.vf-kpi__value--currency` usa
`white-space: nowrap`) e o corpo escala com `clamp()` para não estourar em
colunas estreitas.

---

## 3. Tokens

Sempre consumir tokens, nunca hexadecimais soltos. Resumo dos grupos
(lista completa comentada em `vf-tokens-v2.css`):

### Marca
`--vf-primary` `#5a2a8f` · `--vf-primary-hover` · `--vf-primary-active` ·
`--vf-primary-strong` (texto roxo sobre claro) · `--vf-primary-soft` ·
`--vf-primary-soft-hover` · `--vf-primary-border` · `--vf-primary-rgb`

### Neutros
`--vf-bg` · `--vf-bg-2` · `--vf-surface` · `--vf-surface-2` ·
`--vf-surface-hover` · `--vf-text` · `--vf-text-secondary` ·
`--vf-text-muted` · `--vf-text-placeholder` · `--vf-text-disabled` ·
`--vf-border` · `--vf-border-strong` · `--vf-border-hover` · `--vf-disabled-bg`

Papéis: `surface-2` é fundo de thead/footers; `surface-hover` é hover de
linhas e itens de menu — na V1 os dois papéis dividiam um token.

### Semânticas
Cada cor (`success`, `warning`, `danger`, `info`, `neutral`) tem 4 papéis:
`--vf-{cor}` (texto/ícone) · `--vf-{cor}-bg` (fundo) · `--vf-{cor}-border` ·
`--vf-{cor}-strong` (texto sobre o próprio bg). Há ainda `--vf-{cor}-bg-hover`
para linhas de tabela coloridas.

### Tipografia
Escala: `--vf-fs-2xs` 11 · `xs` 12 · `sm` 14 · `md` 15 · `lg` 18 · `xl` 22 ·
`2xl` 26 · `3xl` 32. Pesos `--vf-fw-regular..extrabold`. Line-heights
`--vf-lh-tight/snug/normal/relaxed`. Letter-spacing `--vf-ls-caps/tight/tighter`.

### Espaçamento
`--vf-sp-1..16` (4, 8, 12, 16, 20, 24, 32, 40, 48, 64px).

### Forma
`--vf-radius-sm` 6 (controles) · `--vf-radius` 10 (cards) ·
`--vf-radius-lg` 12 (overlays) · `--vf-radius-pill`.

### Sombras
`--vf-shadow-xs` · `--vf-shadow-hover` · `--vf-shadow-popover` ·
`--vf-shadow-modal`. Nenhuma é permanente em superfícies estáticas.

### Controles e layout
`--vf-control-h-sm/h/h-lg` (30/38/44) · `--vf-content-standard/wide` ·
`--vf-sidebar-w(-collapsed)` · `--vf-topbar-h` · `--vf-drawer-sm/md/lg` ·
`--vf-modal-sm/md/lg`. Larguras de sidebar/topbar são só tokens — nenhum
layout é imposto.

### Movimento, camadas e foco
`--vf-duration-fast/duration/duration-slow` + `--vf-ease` ·
`--vf-z-dropdown/sticky/drawer/modal/toast/tooltip` ·
`--vf-focus-color/focus-ring/focus-ring-danger/focus-offset`.

---

## 4. Densidades

Duas densidades, trocadas por atributo — nenhum componente é duplicado:

```html
<body data-vf-density="compact">        <!-- app inteiro -->
<div data-vf-density="compact">…</div>  <!-- ou só um bloco -->
```

A densidade compacta reduz: alturas de controles (38→32, 30→26, 44→38),
paddings de card e KPI, altura de linha de tabela, padding de toolbar e o gap
entre seções. A tipografia de leitura nunca cai abaixo de 12px.

Tabelas ainda têm densidade local independente: `.vf-table--compact` e
`.vf-table--comfortable` (sobrepõem a densidade global só na tabela).

---

## 5. Componentes

Cada componente abaixo lista: quando usar, markup mínimo e
modificadores/estados. Todos estão demonstrados no laboratório.

### 5.1 Estrutura de página

```html
<main class="vf-page-shell">
  <div class="vf-page-container"><!-- ou vf-page-container--wide -->
    <header class="vf-page-header">
      <div class="vf-page-header__main">
        <p class="vf-page-header__eyebrow">Clientes · Loja Aurora</p>
        <h1 class="vf-page-header__title">Fechamento financeiro</h1>
        <p class="vf-page-header__description">Texto de apoio opcional.</p>
      </div>
      <div class="vf-page-header__actions">…botões…</div>
    </header>

    <section class="vf-section">
      <div class="vf-section__header">
        <div>
          <h2 class="vf-section__title">Custos adicionais</h2>
          <p class="vf-section__description">Opcional.</p>
        </div>
        <div class="vf-section__actions">…</div>
      </div>
      …conteúdo…
    </section>
  </div>
</main>
```

O eyebrow é texto uppercase 11px — não é pill e não recebe fundo.

### 5.2 Botões — `.vf-btn`

Modificadores: `--primary` `--secondary` `--ghost` `--danger` ·
`--sm` `--lg` `--icon` `--full`. Estados: `:hover` `:active`
`:focus-visible` `:disabled`/`.is-disabled` `.is-loading`.

- A base sem modificador tem o visual do secondary — um `<a class="vf-btn">`
  nunca fica invisível ou sublinhado.
- `.is-loading` deixa o texto transparente e centraliza um spinner absoluto:
  a largura do botão não muda.
- `--icon` exige `aria-label`.
- Grupo: `.vf-btn-group` com botões colados; item ativo recebe `.is-active`.
- Máximo de **um** `--primary` por região de tela.

### 5.3 Formulários

```html
<div class="vf-field">
  <label class="vf-field__label" for="x">CNPJ
    <span class="vf-field__required" aria-hidden="true">*</span></label>
  <input class="vf-input" id="x" aria-invalid="true" aria-describedby="x-err">
  <span class="vf-field__hint">Texto de ajuda.</span>
  <span class="vf-field__error" id="x-err" role="alert">Mensagem de erro.</span>
</div>
```

- Controles: `.vf-input` `.vf-select` `.vf-textarea` (+ `--sm`/`--lg`).
  O select tem chevron próprio (SVG embutido) — visual igual em todo navegador.
- Estados: hover, focus (borda roxa + halo), `.is-error`, `.is-success`,
  `:disabled`, `readonly` (fundo `surface-2`). O estado pode ir no `.vf-field`
  (propaga) ou direto no controle.
- Prefixo/sufixo: `.vf-input-group` + `.vf-input-prefix`/`.vf-input-suffix`
  (ex.: `R$` e `%`).
- Busca: adicionar `.vf-search` a um `.vf-input` (lupa embutida).
- Grade: `.vf-form-grid` (auto-fill 240px) e `.vf-field--full` para campo de
  linha inteira. Ações: `.vf-form-actions`.
- Seleção: `.vf-check`, `.vf-radio`, `.vf-switch` — sempre como `<label>`
  envolvendo o input:

```html
<label class="vf-check"><input type="checkbox"><span>Alertas de margem</span></label>
<label class="vf-radio"><input type="radio" name="g"><span>Opção</span></label>
<label class="vf-switch"><input type="checkbox" role="switch"><span>Sincronizar</span></label>
```

### 5.4 Cards — `.vf-card`

Elementos: `__header` (`__title`, `__description`), `__body`, `__footer`.
Modificadores: `--compact`, `--interactive` (clicável: hover com borda +
sombra leve), `--selected` (borda primária + fundo soft).
Cards **nunca** têm sombra permanente. Não aninhar card dentro de card.

### 5.5 KPIs — `.vf-kpi`

```html
<div class="vf-kpi-grid">
  <div class="vf-kpi">
    <span class="vf-kpi__label">Faturamento (30d)</span>
    <span class="vf-kpi__value vf-kpi__value--currency">
      <span class="vf-kpi__currency">R$</span><span>184.320,55</span>
    </span>
    <span class="vf-kpi__trend is-success">+12,4% vs mês anterior</span>
  </div>
  <button type="button" class="vf-kpi vf-kpi--interactive is-active">…</button>
</div>
```

- O valor usa `clamp()` — monetário e numérico têm o mesmo corpo (na V1 o
  monetário ficava menor).
- `__foot` (nota) e `__trend` (chip de variação) aceitam `is-success/warning/danger`.
- Modificadores: `--interactive` (é um `<button>`; ativo = `.is-active`),
  `--featured` (fundo soft), `--warning`/`--danger` (filete lateral 3px).
- O sinal `+/-` no texto do trend garante leitura sem cor.

### 5.6 Tags, badges e status

Três componentes com papéis distintos — não intercambiáveis:

| Componente | Papel | Forma |
|---|---|---|
| `.vf-tag` | categoria, plano, atributo | retangular (radius 6), fundo suave, **sem dot** |
| `.vf-badge` | contagem | pill mínima, número tabular |
| `.vf-status` | estado operacional | dot + texto, sem fundo |

Todos aceitam `is-primary/success/warning/danger/info/neutral`.
Estado de anúncio/pedido/integração → `.vf-status`. "342 anúncios" numa tab →
`.vf-badge`. "VenForce Full" → `.vf-tag`.

### 5.7 Toolbar e filtros

`.vf-toolbar` (filtros à esquerda, ações à direita, quebra em coluna ≤900px) ·
`.vf-toolbar__filters` · `.vf-toolbar__actions` · `.vf-filter-group` (+
`__label`) · `.vf-filter-chip` (+ `.is-active`) · `.vf-active-filters` ·
`.vf-active-filter` (+ `__remove`) · `.vf-clear-filters`.

Chips de filtro são `<button>` com `aria-pressed`. A trilha de filtros
aplicados (`.vf-active-filters`) fica fora da toolbar, logo abaixo.

### 5.8 Tabelas — `.vf-table`

```html
<div class="vf-table-wrap"><!-- opcional: max-height via CSS da página -->
  <table class="vf-table">
    <thead><tr>
      <th class="vf-table__sticky-cell">ID</th>
      <th>Anúncio</th>
      <th class="num"><button class="vf-table__sort is-desc">Preço</button></th>
      <th><span class="vf-visually-hidden">Ações</span></th>
    </tr></thead>
    <tbody>
      <tr>
        <td class="vf-mono vf-table__sticky-cell">MLB3481920456</td>
        <td class="vf-truncate" title="Título completo…">Título…</td>
        <td class="num">R$ 249,90</td>
        <td class="vf-table__actions">…botões ghost sm…</td>
      </tr>
    </tbody>
  </table>
</div>
<nav class="vf-pagination">
  <span class="vf-pagination__info">1–25 de 342</span>
  <label class="vf-page-size">Por página <select class="vf-select">…</select></label>
  <div class="vf-pagination__actions">…anterior/próxima…</div>
</nav>
```

- Scroll sempre dentro do `.vf-table-wrap` — nunca na página.
- Header sticky embutido; primeira coluna fixa com `.vf-table__sticky-cell`
  no `th` **e** nos `td` da coluna.
- Ordenação: `.vf-table__sort` (button dentro do th) + `.is-asc`/`.is-desc`.
- Linhas: `.row--selected` `.row--warning` `.row--danger` `.row--disabled`
  — todas com hover explícito por token.
- Truncamento: `.vf-truncate` no `td` (max-width 240px por padrão) **sempre
  com `title="…"`** para o conteúdo completo.
- Corpo inteiro: `.vf-table__empty` (linha única com colspan) e
  `.vf-table__loading` (linhas de skeleton, wrapper com `aria-busy="true"`).
- Densidade local: `.vf-table--compact` / `.vf-table--comfortable`.

### 5.9 Tabs e segmented

- `.vf-tabs` + `.vf-tab` (+ `.is-active`, `:disabled`): navegação entre
  contextos. Aceita `.vf-badge` dentro. Overflow rola horizontal em mobile.
- `.vf-segmented` + `.vf-segmented__item` (+ `.is-active`): alternância de
  visualização (tabela/cards, R$/%). Usar `aria-pressed`.

Regra: tabs mudam *o que* você vê; segmented muda *como* você vê.

### 5.10 Feedback

- `.vf-banner` — aviso de página. Estrutura: `__icon` `__content` `__title`
  `__description` `__actions` `__close`. Variantes `is-*` + `--compact`.
  Erro usa `role="alert"`, sucesso `role="status"`.
- `.vf-alert` — feedback inline curto (célula, footer, form). Variantes `is-*`.
- `.vf-toast` — notificação temporária dentro de `.vf-toast-stack` (fixa,
  canto inferior direito). Estrutura igual ao banner (`__content` `__title`
  `__description` `__action` `__close`). Stack com `aria-live="polite"`.

Banner = persistente e contextual. Toast = efêmero e global. Não usar toast
para erro que exige ação — use banner.

### 5.11 Empty, loading e progresso

Quatro situações, um layout (`.vf-empty` com `__icon` `__title`
`__description` `__actions`) — muda mensagem, ícone e ação:

| Situação | Título típico | Ação |
|---|---|---|
| loading | — usar `.vf-loading-state` ou skeletons | — |
| empty (primeiro uso) | "Nenhum anúncio ainda" | ação de criação/sincronização |
| no results | "Nenhum resultado" | "Limpar filtros" |
| error | "Não foi possível carregar" (ícone `is-danger`) | "Tentar novamente" |

Também: `.vf-skeleton` (+ `--title` `--row` `--circle`, pulso de opacidade sem
gradiente) · `.vf-spinner` (+ `--sm` `--lg`) · `.vf-progress` (+ `--sm`) com
`.vf-progress__bar` (+ `is-success/warning/danger`) — sempre com
`role="progressbar"` e `aria-valuenow`.

### 5.12 Modal e drawer

```html
<div class="vf-overlay" id="m">
  <div class="vf-modal vf-modal--sm" role="dialog" aria-modal="true" aria-labelledby="m-t">
    <div class="vf-modal__header">
      <h3 class="vf-modal__title" id="m-t">Título</h3>
      <button class="vf-btn vf-btn--ghost vf-btn--icon vf-btn--sm" aria-label="Fechar">✕</button>
    </div>
    <div class="vf-modal__body">…scroll interno…</div>
    <div class="vf-modal__footer">…ações…</div>
  </div>
</div>
```

- Abrir = `.is-open` no overlay (fade + leve translateY no modal).
- Tamanhos: `--sm` 400 · padrão 560 · `--lg` 760 (drawer: 360/480/640).
- Header/footer fixos, corpo com `overflow-y: auto`.
- Drawer tem classes próprias (`.vf-drawer__header/__body/__footer`) e
  backdrop opcional `.vf-drawer-backdrop`.
- Em ≤600px, modal e drawer ocupam a largura toda.
- Ao abrir, aplicar `.vf-no-scroll` no `<body>`; fechar por Esc e clique no
  backdrop (ver JS do laboratório).
- Confirmação destrutiva: modal `--sm` com botão `--danger` no footer.

### 5.13 Menu, popover e tooltip (apenas visuais)

- `.vf-menu`: `__label` `__item` (+ `.is-active` `.is-danger` `:disabled`)
  `__shortcut` `__separator`. Posicionamento é responsabilidade da tela.
- `.vf-popover`: superfície explicativa com `__title`.
- `.vf-tooltip`: bloco escuro pequeno — só informação complementar, nunca
  conteúdo essencial (não aparece por teclado sem JS adicional).

### 5.14 Upload — `.vf-dropzone` e `.vf-file-item`

- Dropzone: `__icon` `__title` `__hint` `__browse`; estados `.is-dragging`
  (roxo) e `.has-file` (verde). Tornar focável (`tabindex="0"` +
  `role="button"` + `aria-label`) quando for clicável.
- Arquivo: `.vf-file-item` com `__icon` (extensão), `__meta` (`__name`,
  `__info`), `__actions`; variante `.is-error`. Aceita `.vf-progress` no meta
  durante envio.

### 5.15 Utilitários

`.vf-visually-hidden` · `.vf-truncate` · `.vf-stack` (+ `--sm` `--lg`) ·
`.vf-cluster` (+ `--between`) · `.vf-divider` · `.vf-no-scroll` ·
`.vf-mono` · `.num`. Nada além disso — não é um framework utilitário.

---

## 6. Acessibilidade

- **Foco**: regra global única em `:where(:focus-visible)` (outline roxo 2px,
  especificidade zero). Inputs têm indicador próprio (borda + halo) e desligam
  o outline. Nunca remover foco sem substituto visível.
- **Contraste**: `--vf-text-muted` foi recalibrado para ~4.8:1 (o `--vf-text-l`
  da V1 tinha ~2.9:1). `--vf-text-placeholder` é o único cinza decorativo.
- **Cor nunca sozinha**: status tem texto, trend tem sinal `+/-`, erro tem
  mensagem, linhas coloridas têm status na célula.
- **Padrões de ARIA usados no laboratório**: `role="dialog"` + `aria-modal` +
  `aria-labelledby` em modais; `role="alert"`/`role="status"` em feedback;
  `aria-pressed` em chips/segmented; `aria-invalid` + `aria-describedby` em
  campos com erro; `aria-busy` em loading; `aria-label` em todo botão de ícone.
- **Touch targets**: controles padrão têm 38px; na densidade compacta 32px
  (limite aceitável para ferramenta desktop-first).
- **`prefers-reduced-motion`** desliga todas as animações e transições.

---

## 7. Responsividade

Breakpoints usados pelos componentes: **1024, 900, 768, 600, 420**.
Validar visualmente em 1440/1280/1024/768/480/390.

Comportamentos garantidos: tabela rola no wrapper (nunca scroll global);
toolbar empilha ≤900; page-header e section-header empilham ≤768; KPIs caem
para 2 colunas ≤600 e 1 coluna ≤420; modal/drawer ocupam tudo ≤600; botões de
`.vf-form-actions` esticam ≤600; tabs rolam horizontalmente sempre que faltar
espaço; monetários usam `clamp()` + `nowrap`.

O simulador de largura do laboratório estreita o container (grids e flex
respondem); media queries respondem à janela real — redimensione o navegador
para validá-las.

---

## 8. Como migrar uma tela

1. **Ordem de carga** (antes do CSS da página):

```html
<link rel="stylesheet" href="css/vf-tokens-v2.css">
<link rel="stylesheet" href="css/vf-components-v2.css">
<link rel="stylesheet" href="css/pagina-especifica.css">
```

2. Envolver o conteúdo em `.vf-page-shell > .vf-page-container`.
3. Substituir header improvisado por `.vf-page-header`.
4. Trocar componentes locais pelos globais (tabela, toolbar, KPIs, forms).
5. Mover para o CSS da página **apenas** o que for específico dela (ex.:
   `max-height` do `.vf-table-wrap`, larguras de coluna).
6. Rodar o checklist da seção 11.

### Sobrescrever só uma página

Nunca editar os arquivos `vf-*` para um caso local. No CSS da página, usar um
escopo próprio e redefinir **tokens**, não regras:

```css
/* fechamento.css */
.fechamento-page {
  --vf-table-cell-py: 6px;      /* tabela mais densa só aqui */
}
.fechamento-page .vf-table-wrap {
  max-height: 60vh;             /* scroll interno específico */
}
```

### Criar um novo modificador

Modificadores novos seguem o padrão e consomem tokens:

```css
/* ainda na página; promover para vf-components-v2.css se 2+ telas usarem */
.vf-kpi--meta-atingida {
  border-left: 3px solid var(--vf-success);
}
```

Se dois ou mais lugares precisarem, o modificador sobe para o arquivo global —
com nome genérico, nunca nome de tela.

### DevTools

- Inspecionar um elemento → aba *Computed* → filtrar `--vf-` para ver quais
  tokens ele resolve.
- Testar densidade: no console,
  `document.body.setAttribute('data-vf-density','compact')`.
- Testar foco: navegar por `Tab` — todo interativo deve mostrar anel roxo.
- Emular `prefers-reduced-motion` em *Rendering* para validar animações.

---

## 9. Compatibilidade com a V1

As classes V1 continuam funcionando em `vf-components-v2.css` (agrupadas nos
mesmos seletores — sem duplicação de regra). **Não usar em código novo.**

| V1 | V2 | Nota |
|---|---|---|
| `.vf-btn-primary/-secondary/-danger` | `.vf-btn.vf-btn--primary/…` | alias mantido |
| `.vf-chip` | `.vf-filter-chip` | alias mantido |
| `.vf-table-scroll` | `.vf-table-wrap` | alias mantido |
| `.vf-pager` `__info` `__nav` | `.vf-pagination` `__info` `__actions` | alias mantido |
| `.vf-card--link` | `.vf-card--interactive` | alias mantido |
| `.vf-kpi--action` (+ `.is-active`) | `.vf-kpi--interactive` (+ `.is-active` ou `--active`) | alias mantido |
| `.vf-tag.is-*` com dot | `.vf-status.is-*` | **mudança visual**: tag perdeu o dot; o papel “estado” migrou para `.vf-status` |
| `.vf-field__hint` colorido no erro | `.vf-field__error` | compat mantida; usar o elemento novo |
| `--vf-text-m` / `--vf-text-l` | `--vf-text-secondary` / `--vf-text-muted` | alias em tokens |
| `--vf-font` / `--vf-mono` | `--vf-font-body` / `--vf-font-mono` | alias em tokens |
| `--vf-fs-kpi` | `--vf-fs-2xl` | alias em tokens |
| `--vf-shadow-pop` | `--vf-shadow-modal` | alias em tokens |

---

## 10. Decisões tomadas na V2

### Preservado da V1
- Paleta base: roxo `#5a2a8f`, neutros cinza-azulados, semânticas.
- Radius contido (6/10/12), sombra apenas em flutuantes, skeleton por pulso
  de opacidade (sem gradiente), header sticky de tabela.
- Distribuição tipográfica Hanken/Manrope/Plex Mono.
- Convenção BEM + `.is-*` e o reset mínimo.

### Alterado (e por quê)
- **Foco global**: a V1 aplicava `border-radius` a qualquer elemento focado e
  criava halo duplo em inputs (outline global + box-shadow do componente).
  A V2 tem uma regra única com `:where()` (especificidade zero) e inputs com
  indicador próprio. → foco consistente e fácil de sobrescrever.
- **`--vf-text-l` (#969cad, ~2.9:1)** → `--vf-text-muted` (#6b7285, ~4.8:1),
  com `--vf-text-placeholder` para o cinza decorativo. → hints legíveis, AA.
- **Escala tipográfica**: `0.78rem`/`1.65rem` viraram passos limpos
  (12px/26px) e ganharam `lg→2xl→3xl` contínuos. → ritmo previsível.
- **`--vf-primary-hover` = `--vf-primary-strong`** (mesmo valor na V1) →
  papéis separados + novo `--vf-primary-active`. → estados pressed reais.
- **KPI monetário menor que o numérico** → `clamp()` no `__value` inteiro.
- **Botão loading que deslocava o texto** → spinner absoluto sobre texto
  transparente; largura estável.
- **`<a class="vf-btn">` sublinhado e base invisível** → `text-decoration:
  none` na base, que agora tem o visual do secondary.
- **Aliases de botão duplicando ~60 linhas** → agrupados nos mesmos seletores.
- **Hover de linha colorida com `filter: brightness()`** → tokens
  `--vf-*-bg-hover` explícitos.
- **Drawer usando classes de modal** → `.vf-drawer__*` próprios (estilo
  compartilhado por seletor, sem acoplamento de markup).
- **Tag com dot obrigatório** → separação tag/badge/status.
- **Select nativo** → chevron SVG embutido, igual em todos os navegadores.
- **z-index hardcoded (100/110)** → escala `--vf-z-*`.
- **Cards `--link` com `translateY(-1px)`** → só borda + sombra no hover
  (menos ruído visual, sem reflow de sombra).

### Removido
- O par de regras duplicadas de foco em `vf-tokens.css`.
- O `border-radius` no foco global.
- O micro-movimento de hover em cards.
- Nada mais foi removido — o restante virou alias.

### Adicionado
- Tokens: pesos, line-heights, letter-spacings, `border-hover`,
  `surface-hover`, semânticas com border/strong/bg-hover, alturas de controle,
  larguras de layout/drawer/modal, z-index, durações múltiplas, foco,
  densidade compacta.
- Componentes: estrutura de página, `--lg`/`--full`/grupo de botões,
  `__error`/`__required`/input-group/search/form-grid/check/radio/switch,
  card `--compact`/`--selected`/`__title`, KPI `__trend`/`--warning`/
  `--danger`, badge, status, filter-group, active-filters, sort de tabela,
  coluna fixa, linhas disabled, empty/loading de tabela, page-size, tabs,
  segmented, banner estruturado, toast, progress, loading-state, modal com
  tamanhos, drawer independente com backdrop, menu, popover, tooltip,
  dropzone, file-item, stack/cluster/divider/truncate/no-scroll.

### Fora do escopo (deliberado)
- **Dark mode** — a direção aprovada é interface clara; a arquitetura de
  tokens permite adicionar depois sem tocar componentes.
- **JS de comportamento** (focus trap, posicionamento de dropdown, sortable
  real) — a fundação é CSS; o JS do laboratório é só demonstração.
- **Biblioteca de ícones** — os glifos do laboratório são placeholders.
- **Datepicker, multiselect, breadcrumbs, avatar, command palette** — não
  pedidos; nascem como componentes novos quando alguma tela precisar.
- **Aplicação nas telas de produção** — próxima etapa, tela a tela.

---

## 11. Checklist de aplicação (por tela)

- [ ] `vf-tokens-v2.css` carregado antes de `vf-components-v2.css`, e ambos antes do CSS da página.
- [ ] Nenhum hexadecimal solto no CSS da página — só tokens.
- [ ] Nenhum `!important` novo.
- [ ] Conteúdo dentro de `.vf-page-shell > .vf-page-container`.
- [ ] Um único `--primary` por região.
- [ ] Colunas numéricas com `.num`; IDs/códigos com `.vf-mono`.
- [ ] Tabelas dentro de `.vf-table-wrap`; sem scroll horizontal global em 390px.
- [ ] Estados de loading/empty/no-results/error definidos.
- [ ] Botões de ícone com `aria-label`; modais com `role="dialog"` + `aria-modal` + `aria-labelledby`.
- [ ] Campos com erro usando `.vf-field__error` + `aria-invalid` + `aria-describedby`.
- [ ] Navegação por Tab percorre tudo com foco visível.
- [ ] Testado em 1440, 1024, 768 e 390px.
- [ ] Testado com `data-vf-density="compact"`.
