# VFTooltip

Dica da **Fundação Global V2** sobre **Radix Tooltip**, no lugar do `title=` nativo **onde a
dica é a única explicação de um indicador** (⚠, ◐, ícones). Aparece em 300 ms (o nativo leva
~1 s), abre pelo foco do teclado, fica dentro da tela e entra com fade curto.

```jsx
<VFTooltip content={avisos.join("\n")}>
  <span className="vf-ph-aviso" tabIndex={0} aria-label={avisos.join(". ")}>⚠</span>
</VFTooltip>
```

- `children`: **um** elemento que aceite ref. Se não for focável, dê `tabIndex={0}`.
- `content` vazio → devolve só o filho.
- `side` (`top` padrão), `delay` (300 ms). Quebras de linha do texto são mantidas.

**Quando não usar:** valor exato de célula em tabela grande (centenas de `title=`) — cada
VFTooltip monta um Radix Tooltip; ali o nativo continua melhor. Dica complementa; o gatilho
mantém seu `aria-label`.
