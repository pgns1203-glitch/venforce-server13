# Fotos por variação — adicionar, excluir e ordenar (Anúncios ML)

Data: 2026-09-30 · Branch: `feat/anuncios-ml-imagens-variacoes` (PR #205, ainda não mergeado)

## 1. Objetivo

Trocar a seção Fotos do modal de detalhe por um editor **por grupo de
variação**: o usuário escolhe o grupo (ex.: a cor Robalo), vê só as fotos
dele e pode adicionar, excluir e reordenar. A primeira foto do grupo é a
imagem principal da variação no Mercado Livre. Anúncio sem variação usa o
mesmo editor, com um grupo só (a galeria geral).

Nada vai ao Mercado Livre antes do "Salvar no Mercado Livre".

## 2. Como o Mercado Livre funciona (base do desenho)

Fonte: `documentacao_api_meli/variacoes.md` ("Trabalhar com imagens em
variações", "Modificar imagens"), `trabalhar-com-imagens.md`,
`atributos.md` ("Comportamentos especiais"). Confirmado em anúncio real
(Red Fish MLB5929315274, `docs/VALIDACAO_REAL_IMAGENS_ANUNCIOS_ML.md` §7A).

- As imagens ficam em `item.pictures`; cada variação aponta para um
  subconjunto por `variations[].picture_ids`.
- O atributo da categoria com a tag `defines_picture` define os grupos:
  variações com o mesmo valor desse atributo têm as mesmas fotos.
- A primeira foto de `picture_ids` é a imagem principal da variação. A
  primeira de `item.pictures` é a capa do anúncio.
- Editar exige `PUT /items/{id}` com **todas** as fotos e **todas** as
  variações; foto ou variação omitida é apagada.
- Toda variação precisa de pelo menos uma imagem.

## 3. Tela

### 3.1 Seleção de grupo

```
Fotos
[Robalo · 7] [Brasil Preta · 7] [Agro bruto · 7] …

Fotos da variação: Robalo
[img ★ Imagem principal da variação] [img] [img] … [+ Adicionar imagem]
```

- Um chip por grupo, com o valor e a quantidade de fotos (contando o
  rascunho). O chip selecionado fica marcado e o título "Fotos da variação:
  <valor>" diz qual está aberto.
- O rótulo do grupo vem do `value_name` do ML; o nome do atributo vem da
  categoria. Nada assume "cor".
- Anúncio sem variação: sem chips; título "Fotos do anúncio"; o selo da
  primeira foto é "Capa do anúncio".

### 3.2 Edição (sempre em memória)

- **Reordenar**: arrastar nativo (HTML5 drag and drop) no desktop e setas
  ← → em cada foto (teclado, toque, acessibilidade). A primeira posição
  recebe o selo "Imagem principal da variação".
- **Adicionar**: escolher o arquivo → validação local e preview → entra no
  fim do grupo como foto nova do rascunho. Nenhum envio.
- **Excluir**: a foto fica esmaecida com "Será removida" e "Desfazer"; só sai
  no salvar. A lixeira some quando a foto é a última não removida do grupo.
- **Barra de rascunho**: "N alterações nas fotos de <valor> · Descartar ·
  Salvar no Mercado Livre".
- **Trocar de grupo com rascunho**: diálogo "Salvar / Descartar /
  Cancelar". Fechar o modal com rascunho segue a proteção de alterações
  pendentes que o modal já tem.

### 3.3 Validação antes do salvar (na tela e de novo no backend)

- Grupo sem nenhuma foto: "Não é possível salvar. A variação <valor>
  precisa ter pelo menos uma imagem."
- Acima do limite (§4.3): "Não é possível salvar. A variação <valor> pode
  ter no máximo N imagens."
- Arquivo inválido é recusado ao escolher, como hoje.

### 3.4 Estados do salvar

"Enviando imagens…" → "Salvando no Mercado Livre…" → "Concluído". Erros
seguem a regra atual: erro do ML mostra etapa, mensagem, código e causa
originais; recusa local não se passa por ML. Estados incertos (conexão
caída no PUT sem releitura, confirmação divergente, perda crítica) não
oferecem "Tentar novamente".

### 3.5 Avisos mantidos

- Catálogo: editor bloqueado com o motivo.
- Anúncio sem variação com `family_name`/`user_product_id`: aviso de que a
  alteração pode ser replicada aos anúncios do mesmo produto (a doc do ML
  confirma replicação para `PUT /items`). Não bloqueia.
- Anúncio com variações e `user_product_id`: bloqueado (modelo novo não usa
  `variations[]`).

## 4. Contrato do backend

### 4.1 Leitura

`GET /anuncios-meli/:itemId/fotos?clienteSlug=…` — ao vivo no ML.

```json
{
  "ok": true,
  "modo": "variacoes",            // ou "simples"
  "atributo": { "id": "COLOR", "nome": "Cor" },   // null em "simples"
  "limite": { "porGrupo": 10, "origem": "categoria" },  // ou "operacional"
  "grupos": [
    {
      "grupoVariacao": { "attribute_id": "COLOR", "value_id": null, "value_name": "Robalo" },
      "variacoes": [{ "id": "206028890295", "rotulo": "P" }],
      "fotos": [{ "id": "779119-MLB…", "url": "https://…" }]
    }
  ]
}
```

Em `modo: "simples"` há um grupo só, com `grupoVariacao: null` e as fotos
da galeria geral. Substitui o `GET /imagens/variacoes` do PR #205.

### 4.2 Escrita

`PUT /anuncios-meli/:itemId/fotos?clienteSlug=…` (multipart)

- `plano` (campo JSON):

```json
{
  "grupoVariacao": { "attribute_id": "COLOR", "value_id": null, "value_name": "Robalo" },
  "base": ["779119-MLB…", "713112-MLB…"],
  "ordem": [{ "existente": "713112-MLB…" }, { "nova": 0 }, { "existente": "779119-MLB…" }]
}
```

  - `grupoVariacao`: `null` no anúncio sem variação.
  - `base`: ids das fotos do grupo como a tela os recebeu (§4.1).
  - `ordem`: lista final do grupo; `nova: n` aponta para o n-ésimo arquivo.
  - Exclusão = id presente em `base` e ausente em `ordem`.
- `novas`: até 10 arquivos (JPG/PNG/WebP, 10 MB cada), na ordem de `n`.

Identificação do grupo: casa `attribute_id` e, no valor, `value_id` quando
não é nulo; senão `value_name` normalizado (trim + minúsculas). Valores
personalizados vêm sem `value_id` (caso real da Red Fish).

### 4.3 Limites

- Lidos de `GET /categories/{category_id}` → `settings`:
  - com variações: `max_pictures_per_item_var` por grupo;
  - sem variações: `max_pictures_per_item`.
- Se a categoria não informar (ou a leitura falhar), vale o **limite
  operacional VenForce**: 10 por grupo de variação, 12 no anúncio sem
  variação. Esses números são proteção do VenForce, não regra do ML, e a
  resposta diz a origem (`categoria` / `operacional`).
- `max_pictures_per_item` **não** é aplicado ao total de anúncio com
  variações: no teste real o ML aceitou 50 fotos numa categoria que informa
  12.

### 4.4 Sequência do salvar

1. Validar o plano (forma, `ordem` não vazia, sem duplicata, `nova` dentro
   do número de arquivos, limite) e normalizar cada arquivo novo para JPG
   (Sharp, como hoje). Falha aqui: nenhuma chamada ao ML.
2. **Ler o estado atual no ML** (`GET /items/{id}` + atributos da
   categoria). Elegibilidade (catálogo, User Product, variação sem id, foto
   de variação fora da galeria) e grupo recalculados desse estado.
3. **Conflito**: se as fotos atuais do grupo ≠ `base`, recusa com
   `FOTOS_DESATUALIZADAS` ("O anúncio mudou no Mercado Livre desde que você
   abriu. Recarregue as fotos."). Todo `existente` precisa estar no grupo
   atual.
4. Upload das fotos novas ao CDN (`POST /pictures/items/upload`), uma por
   vez. Falha em qualquer uma: para sem PUT; ids já enviados vão para o log.
5. **Reconstrução do PUT** — sempre:

   > estado atual do ML (lido agora, depois dos uploads)
   > \+ alteração solicitada (`ordem`)
   > \= payload completo final

   Nunca a partir do estado que a tela viu nem do snapshot. Antes do PUT,
   um novo `GET /items/{id}` é feito e o passo 3 é repetido sobre ele.
   - `variations`: todas as variações do estado atual; as do grupo recebem
     exatamente a `ordem` resolvida (ids existentes + ids novos); as demais
     vão com os `picture_ids` atuais.
   - `pictures`, com variações: galeria atual na mesma ordem, sem as fotos
     excluídas que nenhuma outra variação usa, com as novas no fim.
   - `pictures`, sem variação: a própria `ordem` resolvida (a primeira vira
     a capa).
6. `PUT /items/{id}`.
7. **Conferência** com outro `GET /items/{id}`:
   - variações: nenhuma sumiu; grupo alvo exatamente na ordem enviada;
     demais inalteradas;
   - galeria: fotos excluídas ausentes; demais fotos antigas presentes;
     novas presentes.
   - Perda de variação ou de foto não excluída: falha **crítica** (log
     estruturado), nunca sucesso, nunca retry.
   - Ordem diferente da enviada: `CONFIRMACAO_DIVERGENTE`.
8. Conexão caída ou 5xx no PUT: nova leitura. Se o estado bate com o
   esperado, sucesso; se a leitura falha, `VINCULO_INCERTO`; senão, o erro
   original do ML.
9. Snapshot local (`atualizarFotosConfirmadas`) só com a galeria confirmada.
   Falha do banco depois da confirmação vira `confirmacaoPendente`.

### 4.5 Erros

| Código | Etapa | HTTP |
|---|---|---|
| `VARIACAO_SEM_IMAGEM`, `LIMITE_IMAGENS`, `PLANO_INVALIDO`, validação de arquivo | validacao | 400 |
| `FOTOS_DESATUALIZADAS` | bloqueio | 409 |
| catálogo, User Product, `ATRIBUTO_FOTO_INDEFINIDO`, `VARIACAO_GRUPO_INEXISTENTE` | bloqueio | 409 |
| erro do ML (leitura, upload, PUT) com `detalhesMl` | leitura/upload/vinculo | 422 |
| `VINCULO_INCERTO`, `CONFIRMACAO_DIVERGENTE`, `PERDA_DE_*` (`critico`) | vinculo/confirmacao | 422 |

## 5. Código

- `server/services/meliAnuncios/meliImagensService.js`: mantém normalização,
  upload e leitura com variações, e exporta os helpers usados pelo editor.
  As funções do PR #205 que ficam sem uso (`adicionarImagemVariacao`,
  `listarGruposDeFotoVariacoes`, `montarPayloadVariacao` e afins) saem.
- `server/services/meliAnuncios/meliFotosService.js` (novo): funções puras
  `montarGrupos()`, `validarPlano()`, `reconstruirPayload()`,
  `conferirFotos()` e a orquestração `lerFotos()` / `salvarFotos()`.
- Controller: `lerFotosAnuncio`, `salvarFotosAnuncio`. Rotas
  `GET/PUT /:itemId/fotos` (multer `array("novas", 10)`).
- `POST /:itemId/imagens` fica no backend, sem uso pela tela, até a
  validação real do novo fluxo; depois sai.
- `Portal/anuncios-meli.js`: bloco de fotos reescrito (estado
  `DET.fotos = { leitura, grupoSelecionado, rascunho }`); CSS em
  `anuncios-meli-v2.css` só com tokens existentes.

## 6. Testes

- Backend (`server/tests/meliAnunciosFotos.test.js`, ML simulado com
  estado): reordenar; excluir; adicionar; os três juntos; sem variação
  (capa muda); grupo vazio recusado sem ML; limite da categoria e limite
  operacional; base desatualizada; falha de upload sem PUT; mudança entre
  upload e PUT refeita sobre o estado novo; PUT incerto (aplicado / não
  aplicado / sem releitura); perda crítica; valor personalizado sem
  `value_id`; atributo diferente de COLOR; snapshot igual ao do sync.
- Modal headless: chips com quantidade e seleção; título do grupo;
  arrastar e setas; selo "Imagem principal da variação"; excluir pendente
  com desfazer; adicionar em memória com preview; zero chamadas de escrita
  antes do Salvar; troca de grupo com Salvar/Descartar/Cancelar; bloqueio
  de grupo vazio; erro do ML com detalhes; sem variação com "Capa do
  anúncio".
- Validação real: mesmo script `validacaoImagemVariacao.js` (estendido para
  comparar ordem e exclusão) na Red Fish MLB5929315274; inclui remover a foto
  de teste `997902-MLB118515217453_092026` do grupo Robalo pelo próprio
  editor.

## 7. Fora de escopo

- Trocar a capa do anúncio com variações (primeira foto da galeria geral).
- Catálogo e anúncios de User Product com variações.
- Editar mais de um grupo no mesmo salvar.
- Apagar imagens do CDN do ML (não há endpoint documentado).
