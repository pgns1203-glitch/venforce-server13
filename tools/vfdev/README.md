# VF Visual DevTools (`tools/vfdev`)

Editor visual e **camada de intenção** para o Portal. Você aponta, fala do seu jeito e experimenta; a ferramenta captura o contexto técnico (seletor, caminho DOM, `arquivo:linha`, largura) e junta tudo numa **sessão**, que vira a missão para o agente (Claude/Codex). Roda **só na sua máquina** e **nunca entra no deploy**: o editor é injetado na resposta HTML em tempo de execução, e nenhum arquivo do Portal recebe `<script>`.

Guia de uso passo a passo: [`docs/GUIA.md`](docs/GUIA.md).

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
| `C` | falar sobre o elemento selecionado (ou a região marcada) |
| `Shift` + arrastar | marcar uma região retangular e falar sobre ela |
| `Esc` | cancela a ação estrutural à espera do 2º clique · fecha o comentário |

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

## Sessão (camada de intenção)

A aba **Sessão** é a primeira do painel. Cada sessão fica em `tools/vfdev/sessoes/<id>.json` (fora do git) e sobrevive a F5, a fechar a aba e a reiniciar o servidor.

| Item | Como nasce | Vai para |
|---|---|---|
| `css` | qualquer ajuste no Painel, `Ctrl K`, Problemas… (espelho da aba Alterações) | patch (se gravável) ou missão |
| `comentario` | `C` / **Falar sobre isso** / `Shift`+arrastar — vira um pin numerado na página | missão |
| `estrutural` | menu **Estrutura** do Painel (remover, mover, agrupar, aproximar, igual a…) | **só** missão — nunca CSS |
| `referencia`, `estranho` | fases seguintes | missão |

- **Na mesma aba**, F5 retoma a sessão sozinho. Numa aba nova, o painel **oferece** "Continuar sessão …" ou "Nova".
- Ao continuar, as alterações CSS pendentes são **reaplicadas**. Se a regra mudou no disco (saiu da linha:coluna ou o valor de origem mudou), o item vira `descartada: regra mudou em arquivo:linha` — nunca é aplicado "perto".
- **Comparar com o início** mostra, por item, os valores computados da primeira captura → agora.
- Todo ajuste CSS tem o campo **Por quê?** (na linha, logo após editar — some em 6 s se ficar vazio — e na aba Alterações).
- Ações estruturais têm **prévia** só em runtime (remover esconde com hachura, mover reordena) com o selo "prévia — não será gravada". Prévia nunca entra no patch.
- O alvo é capturado sem pergunta técnica: seletor estável (classe principal > id > caminho) + índice, caminho DOM, texto, retângulo, largura, regra CSS com `arquivo:linha` e evidência (ou "não resolvido" com o motivo), pai/irmãos e valores computados iniciais.

API local (token + origem em todas):

| Rota | O que faz |
|---|---|
| `GET /__vfdev/sessoes?pagina=` | lista as sessões (resumo) |
| `GET · PUT · DELETE /__vfdev/sessoes/:id` | lê, grava (validação por schema, mensagem clara) e apaga |
| `POST /__vfdev/sessoes/:id/duplicar` | cria `<id>-copia` em andamento |

## Segurança do patch

- O servidor escuta só em `127.0.0.1`, e o `POST /__vfdev/patch` exige o token gerado no boot, além de conferir a origem.
- O patch só grava em `.css` dentro de `Portal/`. Recusa `style.css`, `assets/**` e qualquer caminho fora do Portal.
- Tudo é validado antes de gravar. Se uma regra saiu da linha:coluna esperada (por exemplo, porque o arquivo foi editado por fora), responde 409 e não grava nada.
- O postcss preserva o arquivo byte a byte fora da declaração alterada, inclusive em regras de uma linha.
- Revise sempre com `git diff` antes de commitar.

## Testes

```bash
npm test   # parser, patch, classificação, token, origem, 409, path traversal, schema/API de sessão e e2e no navegador
```

Os testes `test/e2e-*.test.js` sobem o servidor como processo filho sobre uma cópia descartável de `test/fixture/` e dirigem a página num Chromium via `playwright-core` (**dependência opcional**, versão exata). Sem ela ou sem navegador, esses testes são pulados com o motivo — nada falha em silêncio.

## Próximos passos (backlog — ainda não feito)

- Alças de arrastar no overlay.
- Cores e sombras com tokens.
- Estados `:hover` forçados.
- Seleção múltipla + Igualar.
- Painel arrastável/redimensionável.
- IA opcional (com `ANTHROPIC_API_KEY`), saída restrita a JSON validado e nunca aplicada sem clique.
