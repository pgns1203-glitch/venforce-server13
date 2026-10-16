# VFTabs

Lista de abas da **Fundação Global V2** sobre **Radix Tabs**. Visual `.vf-tabs` / `.vf-tab`;
o Radix entrega setas/Home/End (o foco anda e já seleciona), foco itinerante (só a aba ativa
entra no Tab) e `role`/`aria-selected`.

```jsx
<VFTabs
  ariaLabel="Seções do Financeiro"
  tabs={[{ value: "fechamento", label: "Fechamento" }, { value: "relatorios", label: "Relatórios" }]}
  value={aba}
  onValueChange={setAba}
/>
```

| Prop | |
|---|---|
| `tabs` | `[{ value, label, disabled?, panelId? }]` — `value` pode ser qualquer coisa (inclusive `null`); volta igual no `onValueChange` |
| `value`, `onValueChange` | controlado |
| `ariaLabel` | nome da lista (obrigatório) |

**Só a lista.** Os painéis continuam com quem chama (o Financeiro mantém o Fechamento
montado de propósito). `panelId` liga a aba ao painel por `aria-controls`.

**Movimento:** um traço (`.vf-tabs__indicator`) desliza até a aba escolhida. Na primeira
pintura já nasce no lugar.
