# VFDrawer

Painel lateral da **Fundação Global V2** sobre **Radix Dialog**. O visual é `.vf-drawer`
/ `.vf-drawer-backdrop`; o Radix entrega o comportamento que os drawers artesanais faziam
pela metade: foco preso no painel, ESC, clique fora, rolagem da página travada, foco
devolvido a quem abriu, aria de diálogo. Renderiza em `<body>` (portal).

```jsx
{aberto && (
  <VFDrawer title="Inventário" subtitle="MLB123" size="lg" onClose={() => setAberto(false)}
    footer={<VFDrawerClose><VFButton>Cancelar</VFButton></VFDrawerClose>}>
    …
  </VFDrawer>
)}
```

**Montar = abrir.** Fechar (×, ESC, clique fora, `VFDrawerClose`) desliza o painel para fora
e só então chama `onClose` — o pai desmonta depois. Movimento reduzido: `onClose` na hora.

| Prop | |
|---|---|
| `title`, `subtitle` | nome e descrição acessíveis do diálogo |
| `size` | `sm` · `md` · `lg` |
| `footer` | conteúdo do rodapé |
| `initialFocusRef` | onde o foco começa (padrão: o ×) |
| `className`, `headerClassName`, `titleClassName`, `subtitleClassName`, `bodyClassName`, `footerClassName` | classes da ilha |

Formulário com o botão de salvar no rodapé: o `<form id>` fica no corpo e o botão usa
`form={id}` (HTML padrão) — ver `LancamentoManualDrawer`.

Como é modal, a página atrás não recebe clique enquanto o drawer está aberto.
