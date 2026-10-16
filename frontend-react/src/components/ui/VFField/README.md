# VFField · VFInput · VFSelect · VFTextarea

Formulário da **Fundação Global V2**. Wrappers finos sobre `.vf-field`, `.vf-input`,
`.vf-select` e `.vf-textarea` — **nenhum CSS próprio**, nenhum token novo.

```jsx
import { VFField, VFInput, VFSelect, VFTextarea } from "../ui/VFField/index.js";

<VFField label="Faturamento" hint="Valor bruto do mês" error={erro} required>
  <VFInput size="sm" inputMode="decimal" value={v} onChange={…} />
</VFField>

<VFField label="Conta">
  <VFSelect placeholder="Escolha" options={[{ value: 1, label: "Loja A" }]} />
</VFField>
```

**O que o VFField faz por você:** gera o id e liga o `<label>`, monta o `aria-describedby`
(dica + erro), marca `aria-invalid`/`aria-required` no controle e põe `.is-error`/`.is-success`.
Nada de `${id}-campo-dica` na mão.

| VFField | |
|---|---|
| `label`, `hint` | texto |
| `error` | texto (vira `role="alert"`) ou `true` (só marca inválido) |
| `success`, `required`, `full` | bool |
| `id` | id do controle, se precisar fixar |

Controles: `size` (`sm` · `lg`; não no textarea), `invalid`, `valid`, `ref` e todas as props
nativas. Prop explícita vence o contexto. Funcionam também fora de um VFField.

Um VFField = **um** controle (o id é um só).

**Movimento:** o erro entra abrindo espaço (`.vf-motion-reveal`), sem empurrar o formulário
de repente; sai sem animação.
