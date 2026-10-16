# VFBanner

Aviso em faixa da **Fundação Global V2** — wrapper fino sobre `.vf-banner`, sem CSS próprio.

```jsx
<VFBanner tone="warning" title="Base ausente" actions={<VFButton size="sm">Vincular</VFButton>}>
  Sem base de custo, a margem deste mês não fecha.
</VFBanner>
```

| Prop | |
|---|---|
| `tone` | `info` · `success` · `warning` · `danger` · (nada = neutro) |
| `title`, `children` (descrição), `actions`, `icon` (opcional, sem ícone padrão) | |
| `onClose` | mostra o ×; chamado **depois** de recolher |
| `compact`, `role` | `role` padrão: `alert` em danger, `status` no resto |

**Movimento:** entra abrindo espaço; ao fechar pelo ×, recolhe e só então chama `onClose`
(o conteúdo de baixo sobe deslizando). Movimento reduzido → `onClose` na hora.
Se o pai tirar o banner sem passar pelo ×, ele some na hora.
