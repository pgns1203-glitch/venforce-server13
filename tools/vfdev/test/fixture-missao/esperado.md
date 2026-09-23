# Missão — Cliente 360 — revisão visual 23/09

> Página: `Portal/cliente-360-v3.html` · URL: `/cliente-360-v3.html?periodo=2026-08` · Sessão: `2026-09-23-cliente-360-v3-revisao`

## Resumo

- 2 ajustes CSS (1 já gravado, 1 a fazer)
- 1 mudança estrutural
- 2 comentários (0 resolvidos)
- 0 referências visuais · 0 análises "está estranho"
- 0 estados registrados · larguras: 1440, 768, 390
- 8 verificações executáveis

## Objetivo

Compactar a primeira dobra sem perder a leitura dos indicadores

## Intenções

_O porquê de cada mudança, nas palavras de quem revisou. Use para decidir o "como" sem contrariar a intenção._

- 💬 "desconectado, parece vazio" — em **Indicadores** `.c360d-inds` · texto "Faturamento R$ 20.136"
- 📝 "os indicadores parecem soltos" — `gap` de **Indicadores**
- 📝 "ninguém usa essa navegação" — remover **Navegação**

## Mudanças CSS confirmadas

### 1. `.c360d-inds` — `frontend-react/src/styles/cliente360V3.css`

- `gap`: `var(--vf-sp-6)` → `var(--vf-sp-4)` (computado esperado: `16px`)
- Por quê: "os indicadores parecem soltos"
- Destino: **a fazer na fonte** — gerado pelo Vite — fonte: frontend-react/src/styles/cliente360V3.css. Garantir em `.c360d-inds` sem `!important` e sem seletor novo se já existir um equivalente.
- Elemento: **Indicadores** `.c360d-inds` · texto "Faturamento R$ 20.136"

### 2. `.vf-page-cliente-360-v3 .c360d-head` — `Portal/css/pages/cliente-360-v3.css:12` — ✅ feito, não refazer

- `padding`: `var(--vf-sp-8)` → `var(--vf-sp-5)` (computado esperado: `20px`)
- Destino: **já gravado** pelo VF DevTools em 2026-09-23 12:10 — confira no diff, não refaça.
- Elemento: **Cabeçalho** `.vf-page-cliente-360-v3 .c360d-head` · texto "Cliente 360"

## Mudanças estruturais

_Nunca resolver com CSS de esconder/reordenar (`display:none`, `order`, `position`). A mudança é no componente/markup._

### 1. Remover — Navegação

- Alvo: `.c360d-nav` · texto "Resumo Vendas Ads Produtos"
- Caminho DOM: `#root > main > nav.c360d-nav:nth-child(3)`
- Componente provável: não pesquisado (busca de componente ainda não disponível)
- Por quê: "ninguém usa essa navegação"
- Critérios:
  - [ ] não usar display:none
  - [ ] remover a renderização do componente
  - [ ] remover container vazio e estilos exclusivos (altura, sticky, borda)
  - [ ] preservar as demais seções

## Comentários sem implementação direta

_Não há mudança registrada para estes pontos. Proponha a menor mudança que atende o comentário, dentro das restrições, e descreva o que fez. Se não houver solução segura, deixe como está e explique._

1. "quero mais destaque" — **Valor** `.c360d-ind__valor` (nº 3) · texto "R$ 1.240"

## Fontes prováveis

| Elemento | CSS (regra que casa) | Componente provável |
|---|---|---|
| **Indicadores** `.c360d-inds` · texto "Faturamento R$ 20.136" | `Portal/assets/cliente-360-v3/cliente-360-v3-DQuuTabR.css:1` — regra `.c360d-inds` casa com o elemento e contém a classe principal .c360d-inds — CSS gerado pelo Vite | não pesquisado (busca de componente ainda não disponível) |
| **Cabeçalho** `.vf-page-cliente-360-v3 .c360d-head` · texto "Cliente 360" | não resolvido: nenhuma regra de arquivo CSS casa com o elemento (estilo do navegador, herdado ou inline) | não pesquisado (busca de componente ainda não disponível) |
| **Navegação** `.c360d-nav` · texto "Resumo Vendas Ads Produtos" | `Portal/assets/cliente-360-v3/cliente-360-v3-DQuuTabR.css:1` — regra `.c360d-nav` casa com o elemento e contém a classe principal .c360d-nav — CSS gerado pelo Vite | não pesquisado (busca de componente ainda não disponível) |
| **Valor** `.c360d-ind__valor` (nº 3) · texto "R$ 1.240" | não resolvido: nenhuma regra de arquivo CSS casa com o elemento (estilo do navegador, herdado ou inline) | não pesquisado (busca de componente ainda não disponível) |

## Restrições

- Não tocar no backend (`server/**`) nem em contratos de API (rotas, payloads, nomes de campos).
- Não tocar no shell/moldura do Portal (sidebar, `vf-shell`, navegação global).
- Não tocar em arquivos protegidos: `Portal/style.css`, `Portal/layout.js`.
- Não editar assets compilados (`Portal/assets/**`): a mudança vai na fonte (`frontend-react/src/**`) e depois no build da ilha.
- Sem `!important` e sem subir especificidade de seletor.
- Sem classe nova se já existir uma equivalente; sem arquivo novo sem necessidade.
- Mudanças estruturais nunca com CSS de esconder/reordenar (`display:none`, `visibility`, `order`).
- Não mexer em textos, IDs, `data-*` e comportamento que não estejam listados.

## Critérios de aceite

- [ ] `.c360d-inds` em 1440px: `getComputedStyle(el).getPropertyValue('gap')` = `16px`
- [ ] `.vf-page-cliente-360-v3 .c360d-head` em 1440px: `getComputedStyle(el).getPropertyValue('padding')` = `20px`
- [ ] nenhum `.c360d-nav` na página
- [ ] `.c360d-head` continua na página
- [ ] `.c360d-inds` continua na página
- [ ] sem rolagem horizontal da página em 1440px
- [ ] sem rolagem horizontal da página em 768px
- [ ] sem rolagem horizontal da página em 390px
- [ ] Todos os critérios das mudanças estruturais acima.
- [ ] Nenhuma linha alterada no diff além das necessárias para esta missão.

## Estados a validar

- [ ] Estado padrão da URL `/cliente-360-v3.html?periodo=2026-08` (nenhum outro estado registrado).

## Larguras a validar

- [ ] 1440px
- [ ] 768px
- [ ] 390px

## Como verificar

Abra a página com o VF DevTools (`cd tools/vfdev && npm start` → `http://127.0.0.1:5190/cliente-360-v3.html`) e clique em **Verificar missão** na aba Sessão.
As verificações executáveis estão em `tools/vfdev/missoes/2026-09-23-cliente-360-v3-revisao.json`.
