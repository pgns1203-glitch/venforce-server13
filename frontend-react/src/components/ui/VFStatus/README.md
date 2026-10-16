# VFStatus · VFTag · VFBadge

Marcadores da **Fundação Global V2** — wrappers finos sobre `.vf-status`, `.vf-tag`, `.vf-badge`.

| | Para quê | Tons |
|---|---|---|
| `VFStatus` | estado operacional (forma + texto) | `primary` `success` `warning` `danger` `info` `empty` |
| `VFTag` | categoria / filtro | `primary` `success` `warning` `danger` `info` `neutral` |
| `VFBadge` | contagem | `primary` `success` `warning` `danger` `info` |

```jsx
<VFStatus tone="warning">Base desatualizada</VFStatus>
<VFBadge tone="danger">{semCusto}</VFBadge>
```

**Movimento:** o `VFBadge` dá um pulo curto quando o número muda (não ao montar).
