# Validação real — adicionar imagem em anúncio ML

Checklist manual para validar `POST /anuncios-meli/:itemId/imagens` contra o
Mercado Livre de verdade, antes de liberar a funcionalidade para a operação.
Os testes automatizados (`server/tests/meliAnunciosImagens.test.js` e os
checks 7e–7i de `Portal/anuncios-meli-detalhe-modal-ui.test.js`) usam o ML
simulado: **nenhum deles prova que o ML aceita o fluxo**. É isso que este
roteiro prova.

Fluxo validado: arquivo → validação → JPG (Sharp) → `GET /items/{id}` →
`POST /pictures/items/upload` → `POST /items/{id}/pictures` → `GET /items/{id}`
→ snapshot local. Referência: `documentacao_api_meli/trabalhar-com-imagens.md`.

---

## 0. Pré-requisitos

- [ ] Backend com o commit publicado em ambiente acessível (staging ou produção
      com a tela liberada só para quem vai validar).
- [ ] Acesso aos logs do backend (Render) durante o teste. Filtro útil:
      `[anuncios-meli]`.
- [ ] Uma conta ML de cliente **com autorização para testar** (de preferência
      conta interna/teste). Toda imagem adicionada aqui aparece no anúncio real.
- [ ] Acesso à mesma conta no painel do Mercado Livre, para remover a foto de
      teste no final (o VenForce ainda não remove imagens).
- [ ] Arquivos de teste preparados:
  - `ok.jpg` — JPG, ≥ 1200×1200 px, fundo branco, < 10 MB;
  - `ok.png` — PNG com transparência, ≥ 800×800 px;
  - `ok.webp` — WebP, ≥ 800×800 px;
  - `pequena.jpg` — JPG 300×300 px (abaixo do mínimo de 500 px do ML);
  - `grande.jpg` — JPG 3000×2000 px;
  - `nao-imagem.png` — arquivo de texto renomeado para `.png`.

Para cada passo, anotar: MLB usado, horário, `pictureId` devolvido (aparece no
DevTools → Network → resposta do POST `/imagens`) e print da tela.

---

## 1. Escolher um anúncio MLB tradicional

Critérios (conferir no modal de detalhe e, se preciso, em `GET /items/{id}`):

- [ ] `catalog_listing` diferente de `true` (sem tag "Catálogo");
- [ ] **sem variações** (`variations` vazio no ML);
- [ ] **sem** `family_name` e **sem** `user_product_id`, para o primeiro teste —
      isola o caso simples de qualquer replicação;
- [ ] status `active`;
- [ ] menos fotos que o limite da categoria (ver `max_pictures_per_item` em
      `GET /categories/{category_id}`), para caber a foto nova.

Esperado na tela: a grade de fotos mostra as fotos atuais + o quadro
"+ Adicionar imagem" **habilitado**, sem aviso de bloqueio.

## 2. Adicionar uma imagem real

1. [ ] Clicar em "+ Adicionar imagem" e escolher `ok.jpg`.
2. [ ] Conferir o preview: nome, `JPG · N KB · L×A px`; nenhum aviso de mínimo.
3. [ ] Clicar em "Enviar ao Mercado Livre".
4. [ ] Conferir os estados: "Enviando… N%" → "Processando no Mercado Livre…" →
       "Concluído — Imagem adicionada ao anúncio no Mercado Livre."
5. [ ] A grade passa a mostrar a foto nova no FIM da lista, e o contador
       "Fotos (N)" sobe 1.
6. [ ] Nenhum `[anuncios-meli] ML recusou imagem` no log.

Se aparecer "A lista de fotos daqui atualiza na próxima sincronização"
(`confirmacaoPendente`), a imagem entrou no ML mas a releitura/snapshot falhou:
anotar e checar o log (`snapshot local falhou` ou etapa `confirmacao`).

## 3. Confirmar no Mercado Livre

- [ ] Abrir o anúncio (botão "Abrir no Mercado Livre"): a foto nova aparece na
      galeria, na última posição.
- [ ] A capa **não mudou** (o vínculo acrescenta no fim; não deve virar capa).
- [ ] `GET /items/{id}?attributes=pictures` lista um item com `id` igual ao
      `pictureId` devolvido pelo VenForce.
- [ ] A foto não está borrada nem esticada (a normalização não amplia) e, no
      caso do PNG, o fundo transparente virou **branco**.
- [ ] Após alguns minutos, o anúncio não ficou `paused` nem ganhou a tag
      `poor_quality_thumbnail` / moderação (a moderação do ML é assíncrona).

## 4. Confirmar o sync do VenForce

- [ ] Fechar e reabrir o modal: a foto nova continua lá (vem do snapshot).
- [ ] Rodar a sincronização do cliente: depois dela a lista de fotos continua
      idêntica (o snapshot gravado pelo upload bate com o que o sync lê).
- [ ] Na listagem, a contagem de fotos / badge "N/3 fotos" do anúncio acompanha.
- [ ] Score VenForce: só muda depois do sync (o upload não recalcula o score —
      comportamento esperado).

## 5. Formatos e tamanhos

Repetir o passo 2 com:

- [ ] `ok.png` → aceito; no ML a foto tem fundo branco.
- [ ] `ok.webp` → aceito (o backend converte para JPG; a doc do ML não cita
      WebP, por isso o arquivo nunca vai como WebP). **Confirmar que funciona.**
- [ ] `grande.jpg` → aceito; no ML a foto tem no máximo 1920 px no maior lado.
- [ ] `nao-imagem.png` → recusado **sem chamar o ML**: "Não foi possível enviar
      a imagem", código `CONTEUDO_INVALIDO` (ou "Formato não aceito" na tela, se
      o navegador reportar outro tipo). Nada no log de recusa do ML.

## 6. Testar erros reais

- [ ] **Imagem abaixo do mínimo** — enviar `pequena.jpg`. A tela avisa antes
      ("Abaixo de 500×500 px…"). Enviar mesmo assim e anotar o que o ML faz:
  - se recusar: a tela deve mostrar **"Erro do Mercado Livre"** com etapa,
    mensagem original, código (ex.: `509`) e causa. Copiar o corpo exato do
    log `[anuncios-meli] ML recusou imagem de MLB… (etapa …)`;
  - se aceitar: anotar (a doc diz que imagem menor que o mínimo fica do
    tamanho enviado).
- [ ] **Limite de fotos** — num anúncio já no máximo da categoria, adicionar
      mais uma. Esperado: recusa do ML na etapa `vinculo`, com o `picture_id`
      no log (a imagem sobe ao CDN e fica sem vínculo — ver "Falhas" abaixo).
      Anotar código e mensagem reais.
- [ ] **Catálogo** — abrir um anúncio com `catalog_listing = true`: o
      "+ Adicionar imagem" fica **desabilitado** com o motivo. Nada é enviado.
- [ ] **Variações** — abrir um anúncio com variações: botão desabilitado com o
      motivo. Nada é enviado.

## 7. Anúncio de produto (User Product / family_name)

Só depois dos passos 1–6 passarem.

- [ ] Escolher um anúncio com `family_name` ou `user_product_id`, **de um
      produto que tenha mais de um anúncio** (ex.: Clássico + Premium).
- [ ] Ao escolher o arquivo, a tela mostra: "Este anúncio pertence a um produto
      do Mercado Livre. A alteração de imagem pode ser replicada para outros
      anúncios relacionados." O envio **não** é bloqueado.
- [ ] Enviar e, após alguns minutos, conferir no ML **os outros anúncios do
      mesmo produto**: a foto foi replicada? **Anotar o resultado** — a doc do
      ML garante replicação para `PUT /items`; para `POST /items/{id}/pictures`
      isso não está documentado.
- [ ] Anotar se o snapshot dos outros anúncios só se corrige no próximo sync
      (esperado: sim — o upload só grava o anúncio editado).

## 8. Limpeza

- [ ] Remover, pelo painel do Mercado Livre, todas as fotos de teste
      adicionadas (inclusive as replicadas no passo 7).
- [ ] Rodar o sync do cliente para o snapshot voltar ao estado real.

---

## O que registrar ao final

| Item | Resultado |
|---|---|
| Upload + vínculo funcionam em MLB tradicional | |
| Foto nova entra no fim (capa preservada) | |
| PNG transparente → fundo branco | |
| WebP aceito via conversão | |
| > 1920 px reduzido | |
| Erro real de tamanho mínimo (código/mensagem exatos) | |
| Erro real de limite de fotos (código/mensagem, etapa) | |
| Catálogo e variações bloqueados na tela | |
| Replicação em User Product ocorre? | |
| Snapshot e sync concordam | |
| Moderação posterior (pausa/tag) | |

## Falhas conhecidas e como diagnosticar

- **Upload ok, vínculo recusado** — a imagem fica no CDN do ML sem estar no
  anúncio. O `picture_id` sai na resposta (`pictureId`) e no log (`etapa
  vinculo, picture_id …`). A doc do ML não descreve como apagar uma imagem
  enviada; ela não aparece para o comprador. Reenviar faz um upload novo.
- **Vínculo incerto** (`VINCULO_INCERTO`) — a conexão caiu no vínculo e a
  releitura também falhou. A tela pede para conferir o anúncio no ML antes de
  tentar de novo (evita foto duplicada).
- **`confirmacaoPendente`** — a imagem está no anúncio, mas a releitura ou a
  gravação local falhou. O próximo sync alinha o snapshot.
