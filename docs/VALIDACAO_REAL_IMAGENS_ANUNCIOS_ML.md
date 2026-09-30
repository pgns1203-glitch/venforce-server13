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
- [ ] **Variações** — o fluxo de anúncio com variações tem roteiro próprio:
      ver seção 7A.

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

## 7A. Anúncio COM VARIAÇÕES (modelo legado)

Fluxo diferente do anúncio simples: `GET /items/{id}` + `GET
/categories/{cat}/attributes` (atributo com tag `defines_picture`) → upload →
`GET /items/{id}` → **`PUT /items/{id}` com `pictures` e `variations`
inteiros** → `GET /items/{id}` de conferência. A imagem entra em TODAS as
variações que têm o mesmo valor do atributo que define a foto (ex.: todas as
"Azul"). Testes simulados: `server/tests/meliAnunciosImagensVariacoes.test.js`
e check 7j do modal.

**Este é o passo de maior risco do roteiro**: o PUT reenvia a lista inteira, e
o ML documenta que variação ou foto omitida é APAGADA. Fazer primeiro numa
conta/anúncio de teste.

Escolher o anúncio:

- [ ] `variations` com **2+ valores diferentes** do atributo de foto e **2+
      variações no mesmo valor** (ex.: Azul P, Azul M, Preto P);
- [ ] sem `catalog_listing`, sem `user_product_id`;
- [ ] **antes de tudo**, salvar o JSON de `GET /items/{id}` (pictures +
      variations com `picture_ids`) — é o que permite restaurar se algo sair
      errado.

Na tela:

- [ ] Ao abrir o modal, "+ Adicionar imagem" mostra "Carregando as variações…"
      e depois libera; aparece "Fotos por cor" (ou o atributo real) com cada
      grupo, suas combinações e miniaturas. **Conferir** que os grupos batem
      com o que o ML mostra na página do anúncio.
- [ ] Escolher o arquivo: aparece o seletor "Adicionar às variações de …" sem
      opção pré-selecionada; "Enviar" fica desabilitado até escolher.
- [ ] Escolher um grupo (ex.: Azul) e enviar. Estados até "Concluído", com a
      mensagem "(variações Cor: Azul)".

No Mercado Livre:

- [ ] A foto nova aparece ao selecionar **cada** variação do grupo escolhido
      (Azul P **e** Azul M).
- [ ] A foto **não** aparece nas variações de outros valores (Preto P).
- [ ] Nenhuma variação sumiu; estoque e preço de cada variação iguais aos do
      JSON salvo.
- [ ] Nenhuma foto antiga sumiu (comparar `pictures` com o JSON salvo); a capa
      de cada grupo continua a mesma.
- [ ] `GET /items/{id}`: o `pictureId` devolvido está em `pictures` e no
      `picture_ids` de cada variação do grupo, no fim da lista.
- [ ] No log, nenhum `meli_imagem_variacao_perda_critica`.

Sync:

- [ ] Rodar o sync do cliente: `pictures_json` e `variations_count` iguais aos
      de depois do envio; o modal reaberto mostra os mesmos grupos e fotos.

Erros reais a registrar:

- [ ] Grupo já no limite de fotos por variação (`max_pictures_per_item_var`
      da categoria): anotar código/mensagem do ML (etapa `vinculo`) e conferir
      que **nada mudou** no anúncio.
- [ ] Categoria sem `defines_picture` entre os atributos das variações (se
      achar uma): a tela bloqueia com o motivo, nenhum upload.
- [ ] Anúncio com `user_product_id`: bloqueado com o motivo.

### Resultado 7A — 2026-09-30 (commit 6e81855)

Evidência gerada com `server/scripts/validacaoImagemVariacao.js` (somente
leitura: `antes` / `comparar` / `snapshot`).

- Anúncio: cliente Red Fish, MLB5929315274 (ativo, categoria MLB123891),
  35 variações = 7 cores × 5 tamanhos, 7 fotos por cor, 49 fotos no total.
  Sem catálogo, sem `user_product_id`. Cores são valores personalizados (sem
  `value_id`): o agrupamento por nome funcionou.
- Execução: pelo mesmo controller do endpoint (`adicionarImagem` com
  `grupoVariacao=nome:robalo`), sem HTTP/multer/login do Portal. Imagem: cópia
  da última foto do próprio grupo Robalo (500×500). Uma única execução,
  HTTP 200 em ~6,7 s, `confirmacaoPendente=false`, picture_id
  `997902-MLB118515217453_092026`.
- Teste 1: as 5 variações Robalo passaram de 7 para 8 `picture_ids` (antigos na
  mesma ordem + nova no fim). **OK**
- Teste 2: as 30 variações das outras 6 cores com `picture_ids` idênticos;
  preço, estoque e `attribute_combinations` de todas as 35 idênticos. **OK**
- Teste 3: galeria 49 → 50, as 49 antigas na mesma ordem, nova na posição 50,
  capa e `thumbnail` iguais, status `active`, tags iguais. Fora de fotos, só
  `last_updated` e `expiration_time` mudaram. **OK**
- Teste 4: snapshot pós-envio igual à galeria do ML (50 fotos, 35 variações);
  sync completo do cliente (175 anúncios) deixou a linha idêntica. **OK**
- Achado: a categoria informa `max_pictures_per_item = 12` e
  `max_pictures_per_item_var = 10`; o anúncio já tinha 49 fotos e o ML aceitou
  a 50ª. Na prática o limite que vale é o por variação.
- Não coberto nesta rodada: clique pelo Portal (HTTP, multer, auth),
  recusa real por limite por variação, caminhos de falha
  (`VINCULO_INCERTO`, `CONFIRMACAO_DIVERGENTE`, perda crítica).

## 7B. Editor de fotos por variação (GET/PUT /fotos)

Pré-requisito: seção 7A aprovada. Anúncio de teste: Red Fish MLB5929315274
(autorizado). Toda escrita precisa de autorização explícita antes de rodar.

1. [ ] `antes`: `node server/scripts/validacaoImagemVariacao.js antes --clienteSlug=red_fish --itemId=MLB5929315274 --arquivo=<novo>.json`.
2. [ ] Grupo Robalo: adicionar uma foto e mudar a ordem (outra foto vira a
       imagem principal da variação). Salvar.
3. [ ] `comparar ... --atributo=COLOR --valor=Robalo --ordem=<ids na ordem final, NOVA para a foto nova>`:
       RESULTADO OK; outras cores intactas; capa do anúncio igual.
4. [ ] Segurança: ler o estado (rascunho), mudar a ordem do Robalo por fora
       do editor, salvar o rascunho antigo → 409 `FOTOS_DESATUALIZADAS`, sem
       upload e sem PUT; o ML fica como a mudança externa deixou.
5. [ ] Limite: com o grupo no limite por variação, adicionar mais uma →
       400 `LIMITE_IMAGENS`, sem upload e sem PUT.
6. [ ] Limpeza pelo editor: excluir as fotos de teste e voltar a ordem
       original; `comparar --ordem=<ordem original>`; galeria igual à do
       `antes`.
7. [ ] Sync completo do cliente; `pictures_json` igual à galeria do ML.

Anúncio sem variação: repetir 2, 3, 6 e 7 num anúncio simples autorizado (a
capa do anúncio passa a ser a primeira foto).

### Resultado 7B — 2026-09-30 (commit 21f2053)

Execução pelo mesmo controller dos endpoints (`lerFotosAnuncio` e
`salvarFotosAnuncio`), sem HTTP/multer/login do Portal; toda chamada ao ML
registrada (método, caminho, status). Foto nova: cópia 500×500 da 2ª foto do
Robalo. Evidência: JSON de cada passo (item completo, `defines_picture`,
limites da categoria, resposta da tela, snapshot do VenForce, chamadas ML).

- **Antes:** 50 fotos, 35 variações (7 cores × 5 tamanhos); `defines_picture`
  = COLOR; categoria `max_pictures_per_item=12`, `max_pictures_per_item_var=10`;
  Robalo com 8 fotos (7 originais + a de teste da 7A). O GET da tela devolveu
  os 7 grupos iguais ao ML.
- **Com variação (Robalo, adicionar + reordenar):** HTTP 200 em 7,1 s;
  chamadas: 3 GET, 1 upload, 1 GET, **1 PUT**, 1 GET de conferência;
  `confirmacaoPendente=false`. `comparar --ordem`: as 5 variações Robalo
  exatamente na ordem pedida (906510 como imagem principal, nova no fim), as
  30 das outras cores idênticas, preço/estoque iguais, galeria 50 → 51 com as
  50 antigas na mesma ordem, capa/thumbnail/status do anúncio iguais. Fora de
  fotos, só `last_updated`/`expiration_time` mudaram. Snapshot do VenForce já
  atualizado (51) sem sync. **OK**
- **Escrita não planejada:** por erro no roteiro de teste (a mudança externa
  falhou por bug do script e o passo seguinte rodou mesmo assim), um segundo
  salvar válido foi aplicado: 906510 para o fim e mais uma foto de teste.
  Base atual → aceito, 200, `comparar` OK (51 → 52, só Robalo). Removido na
  limpeza.
- **Segurança:** estado lido (Robalo com 10), mudança externa (PUT direto
  trocando as duas primeiras do Robalo, 200), salvar do rascunho antigo
  (excluía uma foto e adicionava outra) → **409 `FOTOS_DESATUALIZADAS`**
  "O anúncio mudou no Mercado Livre desde que você abriu. Recarregue as
  fotos.", `incerto=false`; chamadas: só 2 GET (sem upload, sem PUT). O ML
  ficou exatamente como a mudança externa deixou. **OK**
- **Limite (VenForce):** Robalo com 10, adicionar uma → **400
  `LIMITE_IMAGENS`** "Não é possível salvar. A variação Robalo pode ter no
  máximo 10 imagens.", etapa `validacao`; chamadas: só 3 GET. **OK**
- **Limpeza (pelo editor):** excluídas as 3 fotos de teste (997902 da 7A,
  995104 e 889824 desta rodada) e ordem original do Robalo restaurada. HTTP
  200, sem upload, 1 PUT. Galeria 52 → 49, as 3 removidas saíram. Comparado
  com o JSON de ANTES da 7A: galeria idêntica e na mesma ordem, as 35
  variações com `picture_ids` idênticos, preço/estoque/capa/status iguais.
  **OK**
- **Sync:** snapshot do VenForce já igual ao ML antes do sync (gravado pelo
  editor após a confirmação). Sync completo do cliente (175 anúncios, 76 s):
  `pictures_json` continua igual à galeria do ML (49). **OK**
- **Erros reais do ML:** nenhum nesta rodada (sem moderação, sem recusa de
  categoria, de vínculo ou de variação). A recusa por limite foi a do
  VenForce, antes de qualquer escrita.
- **Sem variação: NÃO executado.** Os 151 anúncios sem variação da Red Fish
  são todos User Product (nenhum tradicional), e escrever fotos num User
  Product pode replicar para os outros anúncios da família (item em aberto
  na tabela abaixo). Precisa de um anúncio simples autorizado.
- Não coberto: clique pelo Portal (HTTP, multer, auth), `VINCULO_INCERTO`,
  `CONFIRMACAO_DIVERGENTE` e perda crítica (só simulados).

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
| Variações: foto só no grupo escolhido, todas as variações do grupo | |
| Variações: nenhuma variação/foto antiga perdida no PUT | |
| Variações: erro real de limite por variação | |
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
