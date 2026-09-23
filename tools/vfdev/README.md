# VF Visual DevTools (`tools/vfdev`)

Editor visual para o Portal. Roda **só na sua máquina** e **nunca entra no deploy**: o editor é injetado na resposta HTML em tempo de execução, e nenhum arquivo do Portal recebe `<script>`.

## Rodar

```bash
cd tools/vfdev
npm install
npm start
```

Abra `http://127.0.0.1:5190/index.html`, faça login uma vez e depois vá para qualquer página, por exemplo `http://127.0.0.1:5190/fechamentos-api.html`.

- A API continua sendo chamada pela URL que o Portal já usa. Se alguma página chamar caminho relativo (`/operacao/...`), suba com `VFDEV_BACKEND=http://localhost:3333 npm start`.
- Porta diferente: `VFDEV_PORT=5200 npm start`.

## Atalhos

| Tecla | O que faz |
|---|---|
| `Alt+Shift+V` | abre/fecha o editor |
| `1` `2` `3` `0` | Selecionar · Por que tem espaço? · Medir · Usar a página |
| `Ctrl K` ou `/` | comandos em português ("menos espaço", "3 colunas", `gap 8`) |
| `↑ ↓ ← →` | pai · filho · irmãos |
| `[` `]` | menos/mais respiro interno |
| `Alt` (segurado) | medir distância até o elemento sob o mouse |
| `B` | ver antes/depois |
| `G` | grade de 8px |
| `Ctrl Z` / `Ctrl Shift Z` | desfazer / refazer (antes de gravar) |

## Onde cada mudança vai parar

| A regra que manda hoje está em | O que "Gravar" faz |
|---|---|
| CSS da página (`css/pages/*.css`, `fechamentos-api.css`…) | troca **só o valor** naquela declaração |
| CSS global (`vf-tokens-v2`, `vf-components-v2`, `vf-shell`, `venforce-ui-v2`) | padrão: cria override no fim do CSS da página, prefixado com `.vf-page-<tela>`. Com "Todas as telas", edita a regra global |
| `style.css` (protegido) | override no CSS da página. **Nunca grava no `style.css`** |
| `assets/**` (gerado pelo Vite) | **não grava**. Vai para o prompt, apontando a fonte em `frontend-react/src/styles/…` |
| `<style>` ou `style=""` no HTML | não grava. Vai para o prompt |
| Tela sem CSS próprio ou sem classe `vf-page-*` no `<body>` | não grava. Vai para o prompt |

Se o override não vencer a cascata (especificidade), o editor desfaz a mudança e a manda para o prompt, sem subir especificidade e sem usar `!important`.

## Segurança do patch

- O servidor escuta só em `127.0.0.1`, e o `POST /__vfdev/patch` exige o token gerado no boot, além de conferir a origem.
- O patch só grava em `.css` dentro de `Portal/`. Recusa `style.css`, `assets/**` e qualquer caminho fora do Portal.
- Tudo é validado antes de gravar. Se uma regra saiu da linha:coluna esperada (por exemplo, porque o arquivo foi editado por fora), responde 409 e não grava nada.
- O postcss preserva o arquivo byte a byte fora da declaração alterada, inclusive em regras de uma linha.
- Revise sempre com `git diff` antes de commitar.

## Testes

```bash
npm test   # 20 testes: parser, patch, classificação, token, origem, 409, path traversal
```
