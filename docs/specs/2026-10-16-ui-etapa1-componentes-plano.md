# Etapa 1 — Componentes React base + movimento

> Plano técnico. Data: 16/10/2026. Decisões A, B e C (§7) aceitas como recomendado.
> Origem: levantamento de componentes repetidos no Portal (mesma data).

## 0. Ponto de partida (achados que mudam o plano)

- `frontend-react/src/components/ui/index.js` exporta `VFButton` de `./VFButton/index.js`, **mas a pasta não existe em nenhuma branch**. As duas versões do VFButton citadas em sessões anteriores nunca foram commitadas e se perderam. Ninguém importa o barrel hoje, então nada quebra, mas o primeiro import vai falhar no build. **Corrigir no PR 1.**
- `utils/cx.js` existe e está na main — usar.
- Formatadores já existem e são a fonte única: `formatarMoeda`, `formatarMoedaCompacta`, `formatarNumero`, `formatarPercentual`, `direcao(valor, { inverso })`, `ehAusente`/`AUSENTE` (`utils/currency.js`, `numbers.js`, `percentage.js`). Nenhum componente novo formata número por conta própria.
- Tokens de movimento já existem em `vf-tokens-v2.css`: `--vf-duration-fast` (0.12s), `--vf-duration` (0.18s), `--vf-duration-slow` (0.28s), `--vf-ease`, sombras de estado (`--vf-shadow-hover`, `-popover`, `-modal`) e um `prefers-reduced-motion` global. **Nenhum token novo é necessário.**
- Cada ilha React é um build isolado (`vite.entries.js`): o que entrar em `components/ui/` é copiado para cada bundle. Por isso **nenhuma dependência nova** nesta etapa (sem Framer Motion, sem clsx) — movimento é CSS + 2 hooks pequenos.

## 1. Princípio de movimento: "o movimento explica o dado"

O `DESIGN.md` proíbe enfeite que compita com o dado, e o `PRODUCT.md` põe confiabilidade antes de polish. A imersão vem de **continuidade**, não de espetáculo: o usuário sempre vê *de onde* algo veio e *o que* mudou.

**Regras (valem para todo componente desta etapa):**

1. **Animar só mudança de estado** — entrada, saída, troca de valor, carregamento → conteúdo. Nada se mexe em repouso (exceção: skeleton enquanto carrega).
2. **Só `transform` e `opacity`** (e `grid-template-rows` no colapso de altura). Nunca `width`/`height`/`top` em lista ou tabela.
3. **Durações só dos tokens.** Teto de 400 ms para qualquer coisa que envolva número.
4. **O valor final está no DOM desde o primeiro frame** (em `aria-label`/`title` e para teste). A animação é camada visual por cima; quem lê a tela, tira print ou roda teste nunca vê um valor intermediário como se fosse real.
5. **Subir não é bom por padrão.** Destaque de mudança é neutro (`--vf-primary-soft`); verde/vermelho só quando o chamador informa o sentido bom (`direcao(..., { inverso })` — custo subir é ruim, margem subir é bom).
6. **`prefers-reduced-motion: reduce` desliga tudo** e mostra o estado final direto — via o media query global que já existe + o hook `usePrefersReducedMotion` para o que é animado em JS.
7. **Valor ausente (`—`) nunca anima.**

**Não fazer:** contagem a partir do zero a cada render, parallax, 3D, confete, scroll-jacking, animação em linha de tabela durante filtro/paginação, sombra permanente.

## 2. Primitivos de movimento (PR 1)

| Peça | Onde | O que faz |
|---|---|---|
| `usePrefersReducedMotion()` | `hooks/` | `matchMedia` com assinatura de mudança; `true` em ambiente sem `matchMedia` (jsdom) para os testes verem o estado final. |
| `useAnimatedNumber(valor, { duracao })` | `hooks/` | Interpola com `requestAnimationFrame` do valor **anterior** para o novo (ease-out). No primeiro render devolve o valor final (sem contar do zero). Cancela o rAF ao desmontar. |
| Classes `.vf-motion-*` | `vf-components-v2.css` | `.vf-motion-enter` (fade + 4px para cima), `.vf-motion-collapse` (`grid-template-rows: 0fr → 1fr`), `.vf-motion-flash` (fundo neutro que apaga em 0,9 s — com `--vf-duration-slow` some antes de ser notado), `.vf-motion-bump` (escala 1 → 1.12 → 1). Ficam no CSS compartilhado, então as telas vanilla podem usar as mesmas classes (Shared-Contract Rule). |

## 3. Componentes

Convenções (as da pasta): `.jsx` + JSDoc, sem TypeScript, wrapper fino sobre a classe V2 existente, `cx()` para classes, `...rest` repassado ao elemento nativo, `ref` encaminhado nos de formulário, README curto por pasta, teste sem asserção de estilo.

### 3.1 `VFButton` — recriar (PR 1)
- **Props:** `variant` (`primary` | `secondary` | `ghost` | `danger`, padrão `secondary`), `size` (`sm` | `md` | `lg`), `icon` (só ícone → `--icon` + `aria-label` obrigatório), `full`, `loading`, `active`, `href` (vira `<a>`), `type` padrão `"button"`.
- **Classes:** `.vf-btn--{variant}`, `--sm`/`--lg`, `--full`, `--icon`, `.is-loading`, `.is-active`.
- **Movimento:** pressionar = `scale(0.98)` em `:active`. **`feedback="ok"`**: depois de uma ação, o rótulo troca por um check por ~1,2 s e volta — confirmação sem toast. `loading` mantém a largura (regra do DESIGN.md) e põe `aria-busy`.

### 3.2 Formulário: `VFField` + `VFInput`, `VFSelect`, `VFTextarea` (PR 2)
- **`VFField`:** `label`, `hint`, `error`, `success`, `required`, `full`, `children`. Gera o id com `useId` e liga `htmlFor`, `aria-describedby` (hint + erro) e `aria-invalid` no controle filho por contexto — o filho não precisa receber id na mão.
- **Controles:** `size` (`sm` | `lg`), `invalid`/`valid` (ou herdam do `VFField`), `ref` encaminhado. `VFSelect` aceita `options=[{ value, label, disabled }]` ou `children`.
- **Movimento:** a mensagem de erro entra com `.vf-motion-enter` e o espaço abre com `.vf-motion-collapse` (o formulário não "pula"). Nada de tremer o campo.

### 3.3 Feedback: `VFBanner`, `VFStatus`, `VFTag`, `VFBadge` (PR 3)
- **`VFBanner`:** `tone` (`info` | `success` | `warning` | `danger`), `title`, `children` (descrição), `actions`, `onClose`, `compact`. Ícone padrão por tom. `role="alert"` só em `danger`; o resto `role="status"`.
  - **Movimento:** entra e sai com colapso de altura — o conteúdo abaixo desliza em vez de saltar.
- **`VFStatus` / `VFTag` / `VFBadge`:** `tone` (+ `neutral`, `primary`, `empty` onde a classe existe).
  - **Movimento:** troca de tom faz transição de cor (já suportado pela classe). **`VFBadge` com número dá `bump` quando o valor muda** — ex.: contador "sem custo" diminuindo enquanto o usuário preenche custos.

### 3.4 Estados: `VFEmpty`, `VFLoading`, `VFError`, `VFSkeleton` + `VFAsync` (PR 4)
- Substituem `cliente360/{Empty,Loading,Error}State.jsx` e `full/Full{Empty,Loading,Error}State.jsx` (6 → 3).
- **`VFEmpty`:** `icon`, `title`, `children`, `actions`. **`VFError`:** idem + `onRetry` (vira botão "Tentar de novo"). **`VFLoading`:** `label` (texto acessível), `size`. **`VFSkeleton`:** `variant` (`row` | `title` | `circle`), `count`.
- **`VFAsync`** (o que dá a sensação de fluidez): `state` (`loading` | `empty` | `error` | `ready`), `skeleton`, `empty`, `error`, `children`. Troca skeleton → conteúdo com fade cruzado **sem salto de layout** (o skeleton reserva a altura). Hoje cada tela faz o seu `if (loading) return …`.

### 3.5 Número e indicador: `VFNumber`, `VFKpi` (PR 5) — o centro do "dinâmico"
- **`VFNumber`:** `value`, `format` (`brl` | `brl-compacta` | `pct` | `int` | `num`), `casas`, `animate` (padrão `true`), `highlightChange` (padrão `true`), `goodDirection` (`up` | `down` | omitido = neutro).
  - Usa só os formatadores de `utils/`. `font-variant-numeric: tabular-nums` para os dígitos não dançarem.
  - **Ao mudar de valor:** interpola do anterior para o novo com `useAnimatedNumber` (≤ 400 ms) e dá um `flash` — neutro, ou verde/vermelho conforme `goodDirection` + `direcao()`.
  - `aria-label`/`title` com o valor final formatado; ausente → `—` sem animação.
- **`VFKpi`:** `label`, `value` + `format` (via `VFNumber`), `trend`, `foot`, `tone` (`warning` | `danger`), `featured`, `onClick` (vira `--interactive`, com elevação `--vf-shadow-hover` no hover — sombra como resposta a estado, permitido pelo DESIGN.md), `active`.
  - **Entrada:** numa grade de KPIs, os cartões entram com `.vf-motion-enter` em sequência (30 ms entre eles, só no primeiro carregamento da tela).
  - Unifica `.vf-kpi` e `.vf-visao-figure` (13 arquivos) — ver decisão pendente A.

## 4. Movimento entre telas (PR 6, paralelo, só CSS)

O Portal são ~44 páginas HTML; toda navegação hoje pisca a tela inteira. **View Transitions entre documentos** resolvem isso com quase nenhum código:

```css
/* vf-shell.css */
@view-transition { navigation: auto; }
.vf-shell-rail   { view-transition-name: vf-rail; }
.vf-shell-topbar { view-transition-name: vf-topbar; }
```

A barra lateral e o topo ficam parados e só o conteúdo faz fade cruzado (`--vf-duration`). Funciona no Chrome 126+ (o time usa Chrome por causa da extensão); em outro navegador a navegação continua normal. Ilhas React também são páginas HTML, então entram de graça. Desliga com `prefers-reduced-motion`.

## 5. Sequência de PRs

Cada PR cria o componente **e migra um consumidor real** como prova; o resto migra quando a tela for mexida por outro motivo.

| PR | Conteúdo | Consumidor de prova |
|---|---|---|
| 1 | Barrel corrigido, `VFButton`, hooks de movimento, classes `.vf-motion-*` | Botões do `NovoFechamento` (Financeiro) |
| 2 | `VFField` + controles | `ProdutosFinanceiroFilters` |
| 3 | `VFBanner`, `VFStatus`, `VFTag`, `VFBadge` | `FaixaBloqueio` (Cliente 360 V3) |
| 4 | Estados + `VFAsync` | Apaga os 6 duplicados (Cliente 360 + Full) |
| 5 | `VFNumber` + `VFKpi` | `ResumoKpis` (Financeiro) e um bloco da Visão |
| 6 | View Transitions no Portal | Todas as páginas com shell |

## 6. Testes

- Rodar **sempre dentro de `frontend-react`** (`npm test`).
- Por componente: classe certa por prop, acessibilidade (`aria-*`, `role`, `label` ligado), repasse de `...rest`/`ref`, sem asserção de estilo.
- Movimento: mock de `matchMedia` nos dois sentidos; `VFNumber` expõe o valor final em `aria-label` no mesmo render (regra 4); `useAnimatedNumber` testado com timers falsos; valor ausente não agenda rAF.
- Suíte inteira verde antes de cada PR (sem regressão nos testes das ilhas que migram).

## 7. Decisões pendentes

- **A.** `VFKpi` absorve o `.vf-visao-figure` como variante (`variant="figure"`), ou a Visão mantém o seu? Recomendação: variante, para ficar um só componente.
- **B.** View Transitions em todas as páginas de uma vez, ou opt-in por página? Recomendação: todas — é reversível apagando 3 linhas.
- **C.** Destaque de mudança do `VFNumber` neutro por padrão (recomendado) ou colorido por padrão?
