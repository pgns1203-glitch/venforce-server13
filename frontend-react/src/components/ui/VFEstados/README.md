# VFEmpty · VFError · VFLoading · VFSkeleton

Estados de tela da **Fundação Global V2** — wrappers finos sobre `.vf-empty`,
`.vf-loading-state`, `.vf-spinner` e `.vf-skeleton`. Substituem as cópias que o
Cliente 360 e a Central Full tinham.

```jsx
<VFLoading label="Carregando fechamento…" />
<VFEmpty compact title="Nenhum produto no vermelho">Todos os itens cobrem os custos.</VFEmpty>
<VFError title="Sem resposta do servidor" detail={erro.mensagem} onRetry={recarregar}>
  Verifique a conexão e tente de novo.
</VFError>
<VFSkeleton variant="row" count={4} />
```

| | Props |
|---|---|
| `VFEmpty` | `title`, `children` (descrição), `icon`, `iconTone` (`danger`·`primary`), `actions`, `compact`, `titleAs` (`h3` padrão) |
| `VFError` | idem + `detail` (mensagem técnica em mono), `onRetry`, `retryLabel`; sempre `role="alert"` |
| `VFLoading` | `label`, `size` (`sm`·`md`·`lg`), `children` (detalhe); `role="status"` |
| `VFSkeleton` | `variant` (`row`·`title`·`circle`), `count`; decorativo (`aria-hidden`) |

**O texto é do domínio, a forma é daqui.** O que um 424 do Mercado Livre significa fica
em quem chama (ex.: `cliente360/ErrorState.jsx`, `full/FullErrorState.jsx`, que só
traduzem código → texto e renderizam `VFError`).

**Movimento:** vazio e erro entram com `.vf-motion-enter`, então a troca
carregando → resultado não é um corte seco.

Modificadores novos na V2 (sem token novo): `.vf-empty--compact`, `.vf-empty__detail`.
