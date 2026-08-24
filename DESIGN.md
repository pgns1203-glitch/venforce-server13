---
name: VenForce Portal
description: Sistema operacional para times internos conciliarem dados de marketplace, custo e pagamento em um único painel confiável.
colors:
  primary: "#5a2a8f"
  primary-hover: "#4c2379"
  primary-active: "#3f1d64"
  primary-strong: "#452073"
  primary-soft: "#f4eef9"
  primary-soft-hover: "#ece2f6"
  primary-border: "#e2d5f2"
  bg: "#f7f8fb"
  bg-deep: "#eef0f6"
  surface: "#ffffff"
  surface-alt: "#fafbfd"
  surface-hover: "#f3f5f9"
  text: "#1b1d28"
  text-secondary: "#545b6e"
  text-muted: "#6b7285"
  text-placeholder: "#9aa0b3"
  text-on-primary: "#ffffff"
  border: "#e7e9f0"
  border-strong: "#d6d9e4"
  border-hover: "#c2c7d6"
  success: "#0f7a52"
  success-bg: "#e7f6ef"
  success-border: "#bfe6d3"
  warning: "#b25e00"
  warning-bg: "#fdf1e3"
  warning-border: "#f2dab5"
  danger: "#c62828"
  danger-bg: "#fdecec"
  danger-border: "#f4c7c7"
  danger-strong: "#a81f1f"
  info: "#1d5fb8"
  info-bg: "#e8f1fc"
  info-border: "#c3daf4"
  neutral: "#5a6072"
  neutral-bg: "#f1f2f6"
typography:
  display:
    fontFamily: "Manrope, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "1.375rem"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.015em"
  headline:
    fontFamily: "Manrope, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.15
  title:
    fontFamily: "Manrope, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.35
  body:
    fontFamily: "Hanken Grotesk, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Hanken Grotesk, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    letterSpacing: "0.05em"
  mono:
    fontFamily: "IBM Plex Mono, 'SF Mono', Consolas, monospace"
    fontSize: "0.86em"
    letterSpacing: "-0.01em"
rounded:
  sm: "6px"
  md: "10px"
  lg: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  2xl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.text-on-primary}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "38px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "38px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.sm}"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "20px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    height: "38px"
    padding: "0 12px"
---

# Design System: VenForce Portal

## Overview

**Creative North Star: "A Mesa de Conciliação"**

O VenForce Portal é a mesa de trabalho onde números de origens diferentes — pedido do marketplace, base de custo interna, pagamento liquidado, imposto — são postos lado a lado até baterem. Não é um site que vende, é uma bancada operacional: densa, legível, sem enfeite que compita com o dado. Uma paleta neutra cinza-azulada carrega quase toda a interface; o roxo institucional aparece só onde há decisão ou identidade (ação primária, estado selecionado, marca), nunca como decoração.

O sistema rejeita duas tentações do software B2B denso: (1) virar cinza demais e perder hierarquia — por isso títulos usam uma família de display distinta (Manrope) e números críticos (KPIs, moeda) recebem peso e tamanho próprios; (2) empilhar sombra e profundidade decorativa — por isso não há sombra permanente em nenhuma superfície de repouso; sombra só aparece como resposta a um estado (hover, modal, popover), nunca como estilo base de um card ou botão.

**Key Characteristics:**
- Neutro cinza-azulado dominante; roxo (`--vf-primary`) reservado para ação primária, seleção e marca.
- Sem sombra permanente em repouso — a elevação é sempre uma resposta a estado.
- Três famílias tipográficas com papéis fixos e não-intercambiáveis: Manrope para display/números, Hanken Grotesk para corpo/controles, IBM Plex Mono só para identificadores técnicos.
- Raios pequenos e consistentes (6–12px); nada de cantos muito arredondados nem cantos retos — o sistema não é nem "software institucional dos anos 2000" nem "app consumer arredondado".
- Densidade é uma variável de primeira classe: um atributo (`data-vf-density="compact"`) redefine alturas e paddings de controle sem duplicar componente.

### Named Rules
**The Shared-Contract Rule.** A Fundação Global V2 é o contrato visual compartilhado entre Vanilla e React — não duas fundações paralelas. Tokens, tipografia, cores, spacing, status, densidade e princípios deste documento podem e devem ser compartilhados entre stacks. Implementações específicas de DOM/JS vanilla (manipulação direta de classe/atributo, scripts de `Portal/*.js`, comportamento herdado de outra tela) não devem ser transplantadas para React; cada superfície React implementa o mesmo contrato visual de forma idiomática em componentes React (estado, efeitos, props) — nunca importando ou replicando o script vanilla que rege aquele componente em outra tela.

## Colors

Paleta neutra cinza-azulada como base; um único acento roxo fixo; quatro semânticas completas (sucesso, alerta, perigo, informação), cada uma com quatro papéis (texto, fundo, borda, versão forte para texto sobre fundo claro).

### Primary
- **Roxo VenForce** (`#5a2a8f`): ação primária (botão primário, links de destaque, foco), marca (logo, wordmark), estado selecionado (linha/card selecionado usa `primary-soft` como fundo). É a única cor não-neutra que aparece fora de contexto semântico — por isso seu uso é deliberadamente raro.
  - Hover: `#4c2379` · Active/pressed: `#3f1d64` · Texto roxo sobre fundo claro: `#452073` (`primary-strong`, AA-safe)
  - Fundo suave (selected, hover ghost): `#f4eef9` (`primary-soft`) / hover: `#ece2f6`
  - Borda de superfícies soft: `#e2d5f2`

### Neutral
- **Fundo da aplicação** (`#f7f8fb`, `bg`): fundo geral atrás de cards e tabelas.
- **Fundo rebaixado** (`#eef0f6`, `bg-2`): wells, skeleton, track de progresso.
- **Superfície** (`#ffffff`, `surface`): cards, inputs, tabela — a superfície "elevada" padrão mesmo sem sombra.
- **Superfície alternativa** (`#fafbfd`, `surface-2`): thead, footers de card/modal.
- **Texto principal** (`#1b1d28`): corpo de texto e valores.
- **Texto secundário** (`#545b6e`): labels, descrições — AA garantido a partir de 12px.
- **Texto discreto** (`#6b7285`): meta-informação ainda legível (~4.8:1); nunca usar abaixo desse contraste.
- **Bordas** (`#e7e9f0` padrão / `#d6d9e4` em controles interativos / `#c2c7d6` no hover de controle).

### Named Rules
**The One Accent Rule.** O roxo VenForce aparece só em ação primária, seleção e marca — nunca como cor de fundo decorativa ou ilustrativa. Se uma tela parece "roxa demais", é sinal de uso incorreto do token.

**The Semantic-Only Color Rule.** Verde, laranja, vermelho e azul (sucesso/alerta/perigo/informação) só codificam estado real do dado (aprovado, pendente, divergente, informativo). Nunca usar como paleta decorativa alternativa.

## Typography

**Display Font:** Manrope (com fallback `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`)
**Body Font:** Hanken Grotesk (mesmo fallback)
**Label/Mono Font:** IBM Plex Mono (com fallback `"SF Mono", Consolas, monospace`)

**Character:** Manrope carrega hierarquia e números (títulos, KPIs, moeda) com um traço geométrico levemente mais firme; Hanken Grotesk é o piso neutro de leitura para tudo que é controle, tabela e corpo — a dupla existe para que "o que é destaque" seja instantaneamente distinguível de "o que é dado corrido", sem depender só de peso ou tamanho.

### Hierarchy
- **Display** (700, 22px / `1.375rem`, line-height 1.15): título de página (`.vf-page-header__title`).
- **Headline** (600, 18px, line-height 1.15): título de seção (`.vf-section__title`).
- **Title** (600, 15px, line-height 1.35): título de card/modal.
- **Body** (400, 15px, line-height 1.5): corpo padrão, campos, tabelas.
- **Label** (600, 11px, letter-spacing 0.05em, uppercase): eyebrow, hints, chips — nunca usado para conteúdo primário.

Números em KPI e tabela usam `font-variant-numeric: tabular-nums` com a família display (classe `.num`); identificadores técnicos (SKU, MLB, ID, código de log) usam a família mono via `.vf-mono` — **nunca** aplicada a "todo número", só a identificadores.

### Named Rules
**The Numeric-vs-Identifier Rule.** Um valor que representa quantidade ou dinheiro é `.num` (Manrope, tabular). Um valor que representa um identificador (SKU, pedido, MLB) é `.vf-mono` (IBM Plex Mono). Nunca trocar os dois — a diferença visual é o que permite escanear uma tabela densa sem ler cada célula.

## Layout

Container padrão de 1200px centralizado (`--vf-content-standard`), com variante wide de 1560px para telas de dado denso (tabelas largas, comparativos). Página estrutura-se em `page-shell → page-container → page-header + seções`, com gap de seção de 32px (24px em densidade compacta). Espaçamento em múltiplos de 4px, do `4px` ao `64px`.

**Densidade é tratada como atributo, não como componente paralelo**: `data-vf-density="compact"` no `<html>`/`<body>`/container redefine alturas de controle (38px → 32px), padding de card e altura de linha de tabela, sem baixar a tipografia de leitura abaixo de 12px.

**Gap conhecido:** a casca global (sidebar, topbar) ainda está em `style.css` (geração anterior), fora do catálogo `vf-components-v2.css`; ela já consome os tokens de cor/borda da Fundação V2, mas não está documentada como componente de sistema. Ao tocar sidebar/topbar, tratar como território de migração pendente, não como padrão estabelecido a replicar em telas novas.

## Elevation & Depth

Sistema flat em repouso, com sombra só como resposta a estado — nunca decorativa nem permanente. Cards, botões e inputs em repouso não têm `box-shadow`; a profundidade aparece apenas em: hover de card interativo, popover, modal e drawer.

### Shadow Vocabulary
- **xs** (`0 1px 2px rgba(18, 22, 45, 0.05)`): uso mínimo, quase imperceptível — reservado a casos pontuais.
- **hover** (`0 4px 14px rgba(27, 29, 40, 0.08)`): hover de card interativo/clicável.
- **popover** (`0 6px 20px rgba(27, 29, 40, 0.12)`): menus, popovers, tooltips.
- **modal** (`0 12px 32px rgba(27, 29, 40, 0.18)`): modal e drawer.

### Named Rules
**The No-Shadow-At-Rest Rule.** Nenhuma superfície tem sombra no estado de repouso. Se uma sombra aparece sem uma interação (hover/foco) ou sem ser um elemento sobreposto (modal/drawer/popover), está fora do sistema.

## Shapes

Raios pequenos e consistentes, nunca extremos: 6px em controles (botão, input, tag), 10px em superfícies de conteúdo (card, tabela, toolbar), 12px em overlays (modal, drawer, popover), pill (999px) só em badges e spinners. Bordas de 1px em quase toda superfície — o sistema usa borda + fundo neutro para separar áreas, não sombra.

## Components

Botões, cards e inputs compartilham a mesma lógica: **precisos e discretos** — borda fina, cor reservada para estado ou ação, cantos pequenos. O componente organiza o dado; ele não compete visualmente com o dado.

### Buttons
- **Shape:** raio pequeno (6px), altura fixa por tamanho (30 / 38 / 44px).
- **Base:** nunca "invisível" — mesmo sem modificador, um botão tem borda e fundo de superfície visíveis.
- **Primary:** fundo Roxo VenForce, texto branco; hover escurece para `#4c2379`, active para `#3f1d64`.
- **Secondary:** fundo de superfície, borda `border-strong`; hover escurece borda e ganha `surface-hover`.
- **Ghost:** transparente em repouso; hover usa `primary-soft` de fundo e `primary-strong` de texto — é o único botão onde o roxo aparece só no hover.
- **Danger:** fundo `#c62828`, hover `#a81f1f`.
- **Loading:** texto fica transparente, spinner absoluto centralizado — a largura do botão nunca muda durante loading.
- **Disabled:** opacidade 0.55, cursor not-allowed; nunca remover borda/fundo do estado base.

### Cards / Containers
- **Corner Style:** 10px (`--vf-radius`).
- **Background:** superfície branca sobre fundo `bg` geral; sem sombra em repouso.
- **Shadow Strategy:** só em `--interactive`/`--link` no hover (ver Elevation & Depth).
- **Border:** 1px `border` padrão.
- **Selected:** borda roxa + fundo `primary-soft`, footer perde o fundo alternativo.
- **Internal Padding:** 20px padrão (`--vf-card-pad-x/y`), reduz para 12–16px em `--compact` e em densidade compacta global.

### Inputs / Fields
- **Style:** borda 1px `border-strong`, fundo superfície, raio 6px, altura 38px.
- **Focus:** borda muda para Roxo VenForce + halo (`box-shadow` com alpha do roxo, 3px) — outline nativo é desligado a favor desse indicador próprio.
- **Error:** borda `danger` + halo vermelho no foco.
- **Disabled:** fundo `bg-2`, texto `text-disabled`, borda neutra.
- **Read-only:** fundo `surface-2`, texto secundário — visualmente distinto de disabled (ainda é dado válido, só não editável agora).

### Modal / Drawer
- **Style:** raio 12px, sombra `modal`, borda 1px, overlay com fundo `rgba(27,29,40,0.45)`.
- **Header/Footer:** compartilhados entre modal e drawer; footer usa fundo `surface-2` e borda superior.
- **Entrada:** modal sobe 8px + fade; sem bounce nem overshoot.

### Tags, Badges e Status
Três papéis distintos, não intercambiáveis: **Tag** = categoria/filtro (retangular, sem dot); **Badge** = contagem (pill mínima); **Status** = estado operacional (dot + texto, sem fundo). Todas as variantes semânticas (`is-success`, `is-warning`, `is-danger`, `is-info`, `is-primary`, `is-neutral`) usam o par fundo-suave + texto-forte da cor correspondente — nunca a cor sólida sobre texto branco, exceto no Badge (pill de contagem, onde o fundo sólido é o próprio ponto).

## Do's and Don'ts

### Do:
- **Do** reservar o Roxo VenForce (`#5a2a8f`) para ação primária, seleção e marca — em qualquer outro lugar, usar neutro ou a cor semântica correta.
- **Do** manter sombra fora do estado de repouso; toda sombra é resposta a hover, foco ou sobreposição (modal/drawer/popover).
- **Do** usar `.num` (Manrope, tabular) para quantidade/dinheiro e `.vf-mono` (IBM Plex Mono) para identificadores — nunca o contrário.
- **Do** tratar densidade (`data-vf-density="compact"`) como uma redefinição de tokens, nunca duplicar um componente "versão compacta".

### Don't:
- **Don't** introduzir uma nova cor de acento fora do roxo fixo e das quatro semânticas já definidas.
- **Don't** adicionar sombra permanente a card, botão ou input em repouso.
- **Don't** aplicar `.vf-mono` a números de quantidade/moeda, nem a família display a identificadores técnicos.
- **Don't** tratar a sidebar/topbar atual (`style.css`) como referência de componente V2 — ela é território de migração pendente, não padrão a replicar.
