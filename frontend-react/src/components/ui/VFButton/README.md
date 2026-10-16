# VFButton

Botão da **Fundação Global V2**. Wrapper fino sobre `.vf-btn`
(`Portal/css/vf-components-v2.css`): **nenhum CSS próprio**, nenhum token novo.

```jsx
import { VFButton, useFeedbackOk } from "../ui/VFButton/index.js";

<VFButton variant="primary" onClick={salvar}>Salvar</VFButton>
<VFButton variant="ghost" size="sm" href="/bases.html">Bases</VFButton>
<VFButton icon aria-label="Remover" variant="ghost">×</VFButton>
```

| Prop | Valores | Classe |
|---|---|---|
| `variant` | `primary` · `secondary` (padrão) · `ghost` · `danger` | `.vf-btn--{variant}` |
| `size` | `sm` · `md` (padrão) · `lg` | `.vf-btn--sm` / `--lg` |
| `icon` | bool — só ícone, exige `aria-label` | `.vf-btn--icon` |
| `full` | bool — largura total | `.vf-btn--full` |
| `loading` | bool — spinner, mesma largura, `aria-busy` | `.is-loading` |
| `active` | bool — selecionado em grupo | `.is-active` |
| `feedback` | `"ok"` · `null` — ✓ no lugar do rótulo | `.is-done` |
| `feedbackLabel` | texto anunciado a leitor de tela (padrão "Concluído") | — |
| `href` | vira `<a>`; com `disabled` perde o href e sai do tab | `.is-disabled` |

Todo o resto (`onClick`, `title`, `aria-*`, `data-*`, `ref`) vai direto para o elemento.

## Movimento

- Pressionar encolhe 2% — vale para **todo** `.vf-btn` do Portal, React e vanilla.
- `feedback="ok"` mostra um ✓ por cima do rótulo (a largura não muda) e bloqueia clique
  enquanto aparece. Use para ações cujo resultado não é visível de outro jeito
  (copiar link, salvar sem fechar). `useFeedbackOk(duracao)` volta ao normal sozinho:

```jsx
const [feedback, confirmar] = useFeedbackOk();
<VFButton feedback={feedback} onClick={async () => { await salvar(); confirmar(); }}>
  Salvar
</VFButton>
```

- `prefers-reduced-motion` desliga as animações; o estado final aparece direto.

Regras de movimento: `docs/specs/2026-10-16-ui-etapa1-componentes-plano.md` §1.
