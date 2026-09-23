# Guia do VF DevTools — da percepção à missão

O VF DevTools serve para **transformar o que você vê na tela em uma especificação que o agente (Claude/Codex) consegue executar**, sem você precisar saber CSS, React ou onde fica cada arquivo. Ele **não** decide design por você e **não** é um page builder: você aponta e fala, e a ferramenta anota o contexto técnico.

## 1. Subir

```bash
cd tools/vfdev
npm install
npm start
```

Abra `http://127.0.0.1:5190/index.html`, faça login uma vez e vá para a tela que quer revisar (ex.: `http://127.0.0.1:5190/cliente-360-v3.html`). O painel abre com `Alt+Shift+V`.

## 2. Comece (ou continue) uma sessão

A aba **Sessão** é a primeira do painel.

- Primeira vez na tela: clique em **Nova sessão**. Se você mexer em algo sem sessão, a ferramenta cria uma sozinha e avisa.
- Já existe uma sessão em andamento para esta tela: aparece **Continuar sessão "…"**. Ao continuar, os ajustes CSS que você tinha feito voltam para a tela.
- F5 na mesma aba retoma a sessão sozinho.
- **Renomear**: clique no título e escreva. **Duplicar** cria uma cópia para testar outro caminho. **Descartar** tira a sessão da lista (o arquivo continua em `tools/vfdev/sessoes/`).
- **Comparar com o início** mostra, para cada item, o que mudou nos valores medidos desde que você apontou pela primeira vez.

## 3. Aponte e fale

1. Clique no elemento (modo **Selecionar**, tecla `1`).
2. Aperte `C` (ou **Falar sobre isso** no Painel).
3. Escreva o que te incomoda, do seu jeito. Os atalhos ("grande demais", "parece vazio", "desconectado"…) só preenchem o texto.
4. `Ctrl+Enter` salva.

Para falar de uma **área** e não de um elemento: segure `Shift` e arraste um retângulo.

Cada comentário vira um **pin numerado** que acompanha o elemento quando você rola ou muda a largura, inclusive em **Larguras**. Clique no pin para editar, resolver ou apagar.

## 4. Ajuste o CSS e diga por quê

Mexa nos valores no Painel, com `[` `]` ou com `Ctrl K` ("menos espaço", "3 colunas"). Logo depois de mexer aparece o campo **Por quê?**. Ele é opcional e some sozinho em 6 s se ficar vazio. A mesma nota aparece na aba **Alterações**. O porquê é o que o agente mais precisa para não "consertar" do jeito errado.

## 5. Mudanças de estrutura (remover, mover, agrupar…)

No Painel, abra **Estrutura** e escolha a ação. As que envolvem outro elemento (mover antes/depois de, agrupar com, aproximar de, separar de, alinhar com, igual a) pedem **um segundo clique** na página, no elemento relacionado. `Esc` cancela.

- Estrutura **nunca** vira CSS: vai para a missão, com critérios padrão que você pode editar na aba Sessão (um por linha).
- **Ver prévia** (remover e mover): mostra o efeito só na tela, com o selo "prévia — não será gravada". Desligue para voltar ao normal. Nenhum arquivo é tocado.

## 6. O que nunca acontece

- Nada é gravado sem você clicar em **Gravar**, e **Gravar** só escreve CSS com patch mínimo (sem `!important`, sem subir especificidade).
- `style.css`, `layout.js`, o backend, os `.html`/`.js`/`.jsx` e os assets compilados nunca são alterados.
- Quando a ferramenta não consegue achar algo (regra, arquivo, elemento), ela escreve **"não resolvido"** com o motivo. Ela não chuta.

## Onde ficam as coisas

| O quê | Onde |
|---|---|
| Sessões | `tools/vfdev/sessoes/<id>.json` (fora do git) |
| Missões | `tools/vfdev/missoes/` (fora do git) |
