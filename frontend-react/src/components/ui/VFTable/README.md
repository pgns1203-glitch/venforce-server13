# VFTable

Tabela da **Fundação Global V2** dirigida por colunas. Junta o que a `DataTable` (Cliente 360)
e a `TabelaDensa` (Dossiê) faziam cada uma do seu jeito: HTML semântico, larguras travadas
por `<colgroup>`, coluna numérica, cabeçalho que ordena (`aria-sort` + botão), linha
clicável, linha marcada e vazio dentro da tabela.

```jsx
<VFTable
  caption="Inventários Full"
  rows={inventarios}
  getRowKey={(inv) => inv.inventoryId}
  onRowClick={(inv) => abrir(inv.inventoryId)}
  sort={ordem} onSort={alternarOrdem}
  columns={[
    { key: "produto", header: "Produto", rowHeader: true, width: "40%" },
    { key: "estoque", header: "Estoque", align: "right", sortKey: "estoque", render: (l) => formatarNumero(l.estoque) },
  ]}
/>
```

| Coluna | |
|---|---|
| `key`, `header` | |
| `width` | largura do `<col>` |
| `align: "right"` | numérica (`.num`) |
| `render(row, i)` | padrão: `row[key]` |
| `cellClassName(row)`, `headerClassName`, `headerTitle` | |
| `rowHeader` | vira `<th scope="row">` |
| `sortKey` | ordenável (precisa de `onSort`) |

Tabela: `rows`, `getRowKey`, `caption` (nome acessível), `rowClassName`, `onRowClick`,
`selectedKey`, `sort {key, dir}`, `onSort`, `emptyLabel`, `compact` (padrão), `scroll`.

**`classNames`** troca as classes sem mudar o comportamento — o Dossiê usa assim para o
visual denso (ver `TabelaDensa`). Na V2 a seta da ordenação é o `::after` do botão (gira ao
inverter); `sortArrow` só para quem quer seta em texto.

**Linha clicável** é atalho de mouse: o caminho de teclado/leitor é um botão ou link real
numa célula. **Fora daqui:** a `TabelaHierarquica` do Painel (cliente → contas, 1.100+
linhas, sticky, linhas de estado) continua própria.
