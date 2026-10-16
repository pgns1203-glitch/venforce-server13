# VFKpi

Cartão de indicador da **Fundação Global V2** — wrapper fino sobre `.vf-kpi`. O valor é
um [`VFNumber`](../VFNumber/README.md): o cartão mostra a própria mudança.

```jsx
<div className="vf-kpi-grid">
  {itens.map((k, i) => (
    <VFKpi key={k.id} label={k.rotulo} value={k.valor} format="brl" goodDirection="up" enterIndex={i} />
  ))}
</div>
```

| Prop | |
|---|---|
| `label`, `value`, `format`, `casas`, `goodDirection` | ver VFNumber |
| `trend` + `trendTone`, `foot` + `footTone` | `success` · `warning` · `danger` |
| `tone` | filete lateral: `warning` · `danger` |
| `featured`, `active` | |
| `onClick` | vira `<button>` interativo (`aria-pressed`), elevação no hover |
| `enterIndex` | posição na grade: entra em sequência, 30 ms por posição |

**Não é a figura da Visão.** A Visão V3 decidiu não usar cards KPI (`.vf-visao-figure`,
com teste de guarda); lá o dinamismo entra com `VFNumber` direto.
