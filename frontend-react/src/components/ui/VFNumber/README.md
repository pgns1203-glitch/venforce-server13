# VFNumber

Número que **mostra a própria mudança**. Quando `value` muda com a tela aberta
(recarga, reprocessamento, edição), desliza do valor antigo para o novo (≤ 400 ms) e o
fundo acende e apaga. Parado, é texto comum — nenhum efeito em repouso.

```jsx
<VFNumber value={faturamento} format="brl" goodDirection="up" />
<VFNumber value={custo} format="brl" goodDirection="down" />  {/* custo subindo = vermelho */}
<VFNumber value={k.valor} format={(v) => formatarValor(v, k.tipo)} />
```

| Prop | |
|---|---|
| `value` | número (ou string numérica). `null`/`NaN`/lixo → `—`, sem animação |
| `format` | `brl` · `brl-compacta` · `pct` (fração) · `int` · `num` (padrão) · ou função |
| `casas` | casas decimais |
| `goodDirection` | `up` · `down` — sem ela o destaque é **neutro** (subir nem sempre é bom) |
| `animate`, `highlight` | desligam a interpolação / o destaque |
| `currencyClassName` | põe o `R$` num `<span>` com esta classe (ex.: `vf-kpi__currency`) |

**Acessibilidade e testes:** durante a animação o texto visível é `aria-hidden` e o valor
final fica num irmão `.vf-visually-hidden`. Parado, é um nó de texto só. Com
`prefers-reduced-motion` (e no jsdom) vai direto ao final.

Formata sempre com `utils/currency.js`, `numbers.js`, `percentage.js`.
