# Anúncios ML — listagem unificada com agrupador

Auditoria de conformidade entre a implementação atual da página
`Portal/anuncios-meli.html` e o modelo oficial de hierarquia de produtos do
Mercado Livre, seguida da especificação da mudança.

Fonte exclusiva das afirmações sobre o modelo do ML: os `.md` de documentação
oficial deste repositório, em `documentacao_api_meli/` — snapshot datado da
documentação pública do Mercado Livre, versionado junto para que as citações
abaixo sejam verificáveis (ver `documentacao_api_meli/README.md`). Nenhuma
inferência — cada regra abaixo cita o arquivo e o trecho.

---

## 1. Hierarquia real, validada na documentação

### 1.1 Os três níveis

`documentacao_api_meli/user-products.md`, seção "Conceitos importantes":

| Nível | Identificador | O que é, segundo a doc |
| --- | --- | --- |
| **Item** | `item_id` (MLB…) | "a representação da publicação de um produto que um comprador visualiza na plataforma. Contém informações relativas às condições de venda (preço, parcelas, etc.)" |
| **User Product (UP)** | `user_product_id` (MLBU…) | "representa um produto físico que um vendedor possui… descreve o produto da forma mais específica possível (nível de variação)". **"Pode estar associado a um ou mais ítens"** |
| **Família** | `family_id` | "É autogerada com base nas informações dos produtos. Cada UP está relacionado a uma família (`family_id`), e cada família agrupa vários UPs" |

A cardinalidade é, portanto, `family_id 1—N user_product_id 1—N item_id`.
O sentido da seta importa: **um UP pode ter vários MLBs** (o mesmo produto
físico ofertado em condições de venda diferentes — "um iPhone vermelho (o UP)
pode estar no item1 em 3 parcelas e no item2 com outro preço diferente").

### 1.2 O que forma uma família

Ainda em `user-products.md`: a família é calculada a partir de `family_name`
(ou `name`), `domain_id`, `user_id` e dos atributos **PARENT_PK** (que devem
ser iguais em todos os produtos da família), **CHILD_PK** e customizados (que
podem variar), mais `item_condition`. Atributos `read_only` não entram.

Consequência para a tela: **a família não é uma escolha do vendedor nem uma
categoria de interface** — é uma chave derivada. Ela não tem status, não tem
preço e não é uma entidade operável.

### 1.3 Quando `family_id` existe

`user-products.md`, FAQ "Todos os ítens contarão con user_product_id,
family_id e family_name?":

- **Antes** da tag `user_product_seller`: os itens têm `user_product_id` e
  **não** têm `family_name`; "a relação de `user_product_id` e `item_id` será
  **1:1**".
- **Depois** da tag: unificação de itens mono-variantes e sem variantes sob o
  mesmo `user_product_id`, e só então os itens passam a ter `family_name`.
- Item multivariante migrado manualmente (UPtin): os novos itens gerados
  ficam sob o mesmo `user_product_id` e ganham `family_name`.

E a FAQ "Como posso identificar os itens que já estão no modelo de Preço por
Variação?" responde: "Validando se o item possui **family_name diferente de
null**".

> **Leitura direta:** anúncio sem agrupador não é uma anomalia nem um resto a
> ser isolado — é o estado normal de quem ainda não foi migrado, e o próprio
> ML diz que ali a relação é 1:1. Um anúncio sem `family_id` é simplesmente um
> anúncio individual.

### 1.4 Variações (`variations[]`) — o modelo ANTIGO

`user-products.md` e `preco-variacao.md` são explícitos: no modelo de User
Products **não se envia mais o array `variations`** ("Não será possível enviar
o array, pois cada uma das variações será uma condição de venda (itens
diferentes)"), e a resposta de criação de item em `preco-variacao.md` traz
`"variations": []`.

> **Leitura direta:** "variação" no vocabulário novo é o **User Product**, não
> um objeto dentro do item. A tela não deve procurar `variations[]`.

### 1.5 Estoque — o ponto que decide a soma

Duas afirmações independentes da doc:

1. `user-products.md`: `available_quantity` está na lista dos campos do item
   que o Mercado Livre **sincroniza de forma assíncrona em todos os itens
   associados ao mesmo `user_product_id`**.
2. `estoque-distribuido.md`: o estoque é consultado por UP
   (`GET /user-products/$USER_PRODUCT_ID/stock`) e, sem multiorigem, "deve-se
   utilizar o método PUT no endpoint `/items` para atualizar o estoque em
   `available_quantity`. Nesse caso, o Mercado Livre sincronizará
   automaticamente o estoque de todos os itens associados ao mesmo
   `user_product_id`".

> **Leitura direta:** **o estoque pertence ao User Product, não ao item.**
> Itens do mesmo UP repetem o mesmo número. Logo:
>
> - `estoque_total = Σ (estoque de cada user_product_id DISTINTO do grupo)`
> - somar `estoque` item a item **duplica** o estoque de todo UP com mais de
>   um MLB — e UP com 2 MLBs é exatamente o caso já observado em produção
>   (clientes 32 e 35, ver `AUDITORIA_MELI_USER_PRODUCTS_POS_IMPLEMENTACAO.md`).
>
> Isso confirma o exemplo do pedido: 3 MLBUs × 100 = **300 un.** — a soma é
> por MLBU, nunca por MLB.

### 1.6 `vendidos` NÃO segue a mesma regra

`sold_quantity` **não** está na lista de campos sincronizados por UP
(`user-products.md`, item 17), e a FAQ do UPtin diz que "o campo
`sold_quantity` refletirá as mesmas vendas que o `sold_quantity` da variante,
entretanto, as ordens antigas permanecerão associadas ao `item_id` anterior".

> **Leitura direta:** vendas são por **item**. `vendidos_total` soma item a
> item; `estoque_total` soma por UP. As duas colunas agregam de formas
> diferentes de propósito, porque a doc as define em níveis diferentes.

### 1.7 Preço — por definição divergente dentro da família

O nome da iniciativa é "Preço por variação": o objetivo declarado é
"estabelecer diferentes preços por variação". Um agrupador, portanto, **não
tem um preço** — tem uma faixa. A linha do agrupador mostra `min–max` quando
os extremos diferem.

### 1.8 Como o ML alcança uma família (e o que não existe)

`user-products.md`, FAQ:

- "Existe algum endpoint para listar todas as familias de um vendedor?" →
  **"Não, atualmente não existe."**
- O caminho é `GET /items` → `user_product_id` → `GET /user-products/{UP}` →
  `family_id` → `GET /sites/{site}/user-products-families/{family_id}`.

> **Leitura direta:** a família só é alcançável **partindo dos itens**. A
> listagem canônica é a de anúncios; o agrupamento é derivado dela. Uma tela
> que parte de "lista de famílias" inverte a direção do modelo — e é
> exatamente o que a implementação atual faz.

### 1.9 O que a doc pede explicitamente do front

`user-products.md`, FAQ "Que impacto terei em caso de não implementar a
iniciativa?", último parágrafo:

> "para os integradores que listam publicações, devem considerar atualizar seu
> front para adaptar a proposta de valor que tem o Mercado Livre com esta
> iniciativa. Ou seja, **agrupar os ítens por família, por user product**…"

Agrupar os itens. Não segregar os itens agrupáveis.

---

## 2. Onde a implementação atual divide família e "sem agrupamento"

| # | Lugar | Evidência |
| --- | --- | --- |
| D-1 | `Portal/anuncios-meli.html` | `<div class="vf-segmented am-modo" id="am-modo">` com dois botões, `data-modo="familias"` e `data-modo="sem_agrupamento"`, e **dois containers irmãos** alternados por `[hidden]`: `#am-familias-container` e `#am-catalogo-container`. |
| D-2 | `Portal/anuncios-meli.js` | `AM.modo` (`"familias"` \| `"sem_agrupamento"`), `renderModo()`, `alternarModo()`, `carregarModoAtual()`, `carregarBadgeSemAgrupamento()` — duas listas, duas paginações (`AM.paginacao` e `AM.paginacaoFamilias`), dois estados de carregamento. |
| D-3 | `Portal/anuncios-meli.js` | `motivoKpiIndisponivel()` **desabilita os cards de KPI** na aba Famílias ("Filtro disponível na aba Sem agrupamento") e desabilita os de tipo `filtro` na outra aba, porque `?filtro=` já está ocupado pela identidade da aba. |
| D-4 | `server/services/meliAnuncios/meliAnunciosService.js` | `case "sem_agrupamento"` na `listarAnuncios` — o recorte que alimenta a segunda aba. |
| D-5 | `server/services/meliAnuncios/meliFamiliaService.js` | `listarFamilias()` pagina por `family_id` e **exclui** todo anúncio sem UP (`WHERE a.user_product_id IS NOT NULL`); `contarSemUserProduct()` existe só para rotular a aba. |
| D-6 | `server/controllers/meliAnunciosController.js` | `GET /anuncios-meli/familias` devolve `{ familias: [...], sem_user_product: { total } }` — dois blocos separados na mesma resposta. |

---

## 3. Divergências entre a implementação atual e o modelo oficial

| # | Divergência | Modelo oficial | Impacto |
| --- | --- | --- | --- |
| **X-1** | A tela tem duas listagens, e "família" virou categoria de navegação. | A família é chave derivada (§1.2) e só é alcançável partindo dos itens (§1.8). A doc pede agrupar itens (§1.9). | O operador não vê o catálogo; vê dois recortes que nunca somam. Um anúncio muda de aba quando o ML o migra, sem nada ter mudado no anúncio. |
| **X-2** | `GET /anuncios-meli/familias` **não devolve estoque nenhum** — nem por item, nem agregado. | Estoque é do UP (§1.5) e a doc trata inventário como dado de primeira classe do UP. | A soma de estoque pedida era impossível de calcular na tela: o número não existia no payload. Na árvore antiga o estoque só aparecia por MLB, depois de expandir. |
| **X-3** | `GET /anuncios-meli` (listagem plana) **não devolve `user_product_id` nem `family_id`** — o `SELECT` de `listarAnuncios` para em `family_name`. | Item → UP → família é a cadeia de agrupamento (§1.1). | Agrupar no cliente era impossível: as chaves de agrupamento não saíam do backend. Foi isso que forçou a existência de um segundo endpoint e, por consequência, de uma segunda aba. |
| **X-4** | Duas paginações independentes (por família de um lado, por item do outro). | A listagem é uma só (§1.8/§1.9). | Não existe ordenação única, e não há como intercalar as duas listas no cliente sem quebrar página e total. |
| **X-5** | `family_name` era usado como sinal de "anúncio de catálogo" em um lugar e de trava de título em outro. | `family_name` é o rótulo da família (§1.2); catálogo é `catalog_listing` — conceitos distintos. | **Já estava correto no código** (`ehCatalogoOficial` usa só `catalog_listing`; `tituloTravadoPorCatalogo` é mais amplo de propósito, por causa do `BODY_INVALID_FIELDS` observado). Registrado aqui só para constar que foi reauditado e **não** foi alterado. |
| **X-6** | `contarSemUserProduct()` conta apenas `user_product_id IS NULL`, enquanto a lista da aba usava um predicado mais largo (sem UP **ou** UP sem família **ou** UP órfão). | — | Duas definições de "sem agrupamento" no mesmo recurso; o badge divergia da própria lista que rotulava. O front já contornava isso lendo o total da lista. Com a aba removida, a divergência deixa de existir. |

### 3.1 O que estava correto e foi mantido

- `meli_user_products` guarda `family_id` como **TEXT** — o valor do ML passa
  de `Number.MAX_SAFE_INTEGER`. Confirmado em `preco-variacao.md`
  (`"family_id": 1034108706118545`). Não mexer.
- `meli_anuncios` é a autoridade de account-scope e `meli_user_products` a
  autoridade da hierarquia; toda leitura parte de `meli_anuncios` já filtrado
  pela conta. Mantido integralmente na consulta nova.
- Anúncio sem `user_product_id` não tem UP nem família inferida — nada é
  deduzido (`extrairUserProducts` descarta). Mantido.

---

## 4. Especificação da mudança

### 4.1 Regra de produto

Uma lista só. Cada **linha** da lista é um dos dois tipos, sem distinção
visual entre eles:

- `tipo: "familia"` — existe `family_id`. Uma linha por família, com os
  agregados do grupo, expansível para os MLBUs → MLBs que a compõem.
- `tipo: "item"` — não existe `family_id` (anúncio sem UP, ou UP sem família).
  Uma linha por MLB, com o próprio estoque. **Não expande** — não há nada
  abaixo dela (§1.3: a relação ali é 1:1).

A chave de grupo é `COALESCE('fam:'||family_id, 'item:'||item_id)`: todo
anúncio pertence a exatamente um grupo, e os dois tipos concorrem na mesma
ordenação e na mesma paginação.

### 4.2 Agregados da linha de agrupador, e de onde cada um vem

| Coluna | Cálculo | Por quê |
| --- | --- | --- |
| Estoque | `SUM(estoque_do_UP)` sobre UPs **distintos** | §1.5 — estoque é do UP e é replicado nos itens dele |
| Vendidos | `SUM(vendidos)` sobre **itens** | §1.6 — `sold_quantity` não é sincronizado por UP |
| Preço | `MIN`–`MAX`, faixa quando diferem | §1.7 — "preço por variação" |
| Status | derivado: todos ativos → Ativo; todos pausados → Pausado; todos encerrados → Encerrado; misto → "Misto" com a contagem | a família não tem status próprio (§1.2) |
| Score VenForce | `MIN` (o pior do grupo) | métrica interna, não do ML; o pior é o que pede ação, e é o mesmo critério que ordena |
| Contagens | nº de MLBUs e nº de MLBs | os dois níveis do §1.1 |

`estoque_do_UP` = `MAX(estoque)` entre os itens daquele UP. Os itens do mesmo
UP deveriam ter o mesmo valor (§1.5); `MAX` é determinístico se uma
sincronização assíncrona os pegar momentaneamente divergentes.

### 4.2.1 Uma tabela, um cabeçalho, os três níveis do ML

A linha do agrupador, a linha do anúncio individual e a linha de MLB dentro do
agrupador expandido usam a **mesma grade de 8 colunas** (`--am-cols`, declarada
uma vez em `.am-listagem`) e o **mesmo padding horizontal**. O recuo do nível
filho sai da miniatura — 32px encostada à direita de uma coluna de 52px —, e
nunca do padding da linha, que deslocaria a grade inteira e faria o preço do
MLB cair embaixo do rótulo de outra coluna.

Isto era um defeito real do desenho anterior e não um detalhe estético: a
expansão vinha de `.am-arvore`, uma segunda tabela com grade própria
(`26px 40px … 68px 32px`) e cabeçalho próprio. Ao trazê-la para dentro da
lista, ela herdaria o cabeçalho da lista e contradiria as colunas dele.

Uma diferença deliberada permanece: o Score do filho é número, não o medidor
semicircular da linha-mãe — o medidor tem altura própria e igualaria a altura
das duas linhas, apagando a hierarquia que o recuo estabelece.

**A tela mostra os três níveis do §1.1, mas o que importa é o PESO de cada
um.** Este ponto teve três desenhos, e os dois primeiros erraram em direções
opostas:

1. o User Product como faixa **"PRODUTO MLBU-… · 2 anúncios"** — o MLBU de
   manchete, um identificador que o operador não reconhece;
2. **nenhum cabeçalho** — o bloco de variação existia só para agrupar, amarrando
   as linhas irmãs com um trilho no vão da miniatura. Sumiu o MLBU, mas sumiu
   também o nome do que estava ali;
3. o desenho atual, que é o da listagem oficial do ML: a variação se chama pelo
   **nome amigável** e o MLBU fica em legenda do tamanho de um SKU.

```
AGRUPADOR / FAMÍLIA      (título consolidado + family_id + agregados)
  └── VARIAÇÃO           ("Azul P" em destaque + MLBU discreto)
       ├── MLB Clássico  (item_id + condição comercial + preço + métricas)
       └── MLB Premium
```

O trilho saiu junto com a volta do cabeçalho: ele dizia "estas linhas são do
mesmo produto", que é exatamente o que o cabeçalho diz — e com nome. Dois sinais
para a mesma coisa é ruído.

A variação é **subtítulo, não entidade**: o bloco não tem `role`, não tem
`tabindex`, não expande e não abre nada. O que se opera continua sendo o
agrupador (expandir) e o anúncio (modal + estoque). As agregações do §4.2 não
mudaram — o estoque continua somando por MLBU distinto, que é a razão de o nível
existir nos dados.

#### De onde sai o nome da variação

Do **título do anúncio**. No modelo de User Products o ML compõe o título do
item como `family_name` + os valores dos atributos que variam:

| campo         | valor                        |
| ------------- | ---------------------------- |
| `family_name` | `Apple iPhone 256GB`         |
| `title`       | `Apple iPhone 256GB Rojo`    |
| → variação    | `Rojo`                       |

(`documentacao_api_meli/preco-variacao.md`, resposta de criação de item; e
"se o `family_name` for modificado, o título do item será recalculado".) E
`title` está na lista de campos **sincronizados por User Product**
(`user-products.md`): o título pertence à variação, não à condição de venda — é
isso que autoriza o título a nomeá-la, e é por isso que os dois MLBs de uma
variação têm o mesmo título por definição do ML.

Quando o título **não** começa pelo `family_name` (título legado, `family_name`
trocado depois, item que nunca passou por UPtin), não existe sufixo para
extrair: o nome passa a ser o título **inteiro**. Um recorte parcial aí seria
adivinhação. Sem título, cai no SKU. A origem escolhida fica em
`data-nome-origem` (`sufixo` | `titulo` | `sku` | `vazio`), que é como o teste
distingue os caminhos.

**O que ainda NÃO é possível:** nomear a variação pelos atributos (`Cor: Azul`,
`Tamanho: P`) em vez do título. O ML marca os atributos que definem a variação
com `hierarchy: "CHILD_PK"` e a tag `variation_attribute`
(`documentacao_api_meli/atributos.md`), mas `meli_anuncios.attributes_json`
guarda apenas `{id, name, value}` — a sincronização descarta `tags` e
`hierarchy`. Sem esses campos não há como saber QUAL atributo define a variação,
e adivinhar por lista fixa de IDs (`COLOR`, `SIZE`, …) seria inventar regra: o
conjunto é dependente de categoria. O caminho documentado para resolver isso de
verdade é `GET /user-products-families/{family_id}`, que devolve
`child_attributes_ids: ["COLOR", "SIZE"]` (`preco-variacao.md`) — mas é chamada e
persistência novas, ou seja, reabrir a sincronização. Registrado, não feito.

#### Condição comercial

Dois anúncios da MESMA variação (o padrão Clássico + Premium) precisam se
distinguir na linha: por isso a **condição comercial** entra na célula de
identificação do filho, ao lado do MLB, derivada de `listing_type_id` pelo mapa
`TIPO_ANUNCIO` que o modal de detalhe já usava. Dentro da variação a ordem
preferida é Clássico → Premium, com desempate por `item_id` — preferência de
exibição, não regra: variação com 1, 3 ou 5 MLBs, ou com tipo fora do mapa, cai
no desempate e continua funcionando.

O título do filho, por sua vez, **desaparece** quando é o mesmo que nomeou a
variação: seria a terceira repetição da mesma frase na tela. Volta a aparecer
quando difere de verdade — comparação de dado, não suposição.

Uma consequência no payload: `GET /anuncios-meli/familias/:familyId` passou a
projetar `a.listing_type_id`, coluna que já existia em `meli_anuncios` e que a
listagem plana sempre leu. É acréscimo de projeção — filtro, join, ordem e
agregação da consulta estão intactos.

### 4.2.2 Estoque editável na linha do MLB

A única escrita que a listagem faz. Endpoint próprio, e o service que fala com o
ML é `meliEstoqueService`:

```
PATCH /anuncios-meli/:itemId/estoque  { clienteSlug, clienteContaId?, estoque }
   -> PUT https://api.mercadolibre.com/items/{itemId}  { available_quantity }
```

**Por que `PUT /items` e não `/user-products/.../stock`.** A doc tem três
caminhos de estoque (`estoque-distribuido.md`, "Gerir estoque"):

| cenário do vendedor                            | endpoint                                            |
| ---------------------------------------------- | --------------------------------------------------- |
| sem multi origem                               | `PUT /items` `{ available_quantity }`               |
| Full/Flex com estoque distribuído (MLA, MLC)   | `PUT /user-products/stock/type/selling_address`     |
| multi origem (`warehouse_management`)          | `PUT /user-products/{up}/stock/type/seller_warehouse` |

Os dois últimos exigem o header `x-version` (400 sem ele, 409 se vier velho) e
pressupõem depósitos/localizações que esta tela não conhece — ela não lê
`/user-products/{up}/stock` nem guarda `network_node_id`. O implementado é o
primeiro, que é o documentado para vendedor sem multi origem.

**A regra que não pode ser inventada: o estoque é do User Product.** "A
modificação dos itens através do PUT ao recurso /items será replicada pelo
Mercado Livre de forma assíncrona em todos os itens associados ao mesmo User
Product. Os campos […] sincronizados são: […] `available_quantity`"
(`user-products.md`). Daí:

- a edição **pode** partir de qualquer MLB da variação — o ML não tem "estoque do
  anúncio", tem estoque do produto físico;
- confirmado o valor, ele vale para **todos os irmãos do mesmo
  `user_product_id`**. O snapshot local propaga isso, e a resposta devolve
  `itens_sincronizados` para a tela mover as linhas irmãs sem deduzir nada;
- outra variação da mesma família **não** se move: a replicação é por UP, não
  por família;
- `status` **não** está na lista de campos replicados por UP. `available_quantity`
  = 0 pausa o anúncio editado (`out_of_stock`) e um valor acima de 0 reativa o
  que estava pausado assim (`produto-sincronizacao-de-publicacoes.md`), mas isso
  é lido da resposta do ML — o irmão recebe só o número.

Consequências na UI, todas herdadas do desenho de `/conteudo`: o snapshot local
só muda depois do ML confirmar; uma recusa devolve a célula ao valor anterior e
mostra o motivo que o ML deu; enquanto a chamada está em voo a célula não mostra
número nenhum (nem o antigo, que já não vale, nem o novo, que ainda não valeu).
**Sair do campo cancela — só Enter salva**: é escrita em anúncio real numa tela
que lista centenas deles, e salvar por distração seria efeito colateral
inaceitável.

O agregado do agrupador é recalculado no cliente pela mesma régua do banco
(soma do estoque por UP distinto, `MAX(estoque)` dentro do UP), a partir do
cache do detalhe da família. Isso é legítimo porque os agregados da listagem são
do grupo **inteiro** e não sofrem filtro nem busca (CTE `grupos` vs
`selecionados`, §4.4) — ou seja, o detalhe cobre exatamente o mesmo conjunto que
a linha agrega. Recalcular no lugar, em vez de recarregar a lista, é o que
mantém as expansões abertas e o operador onde ele estava.

### 4.3 Ordenação única

A ordem operacional que a listagem plana já usava
(`revisado ASC, score_venforce ASC NULLS FIRST, updated_at DESC`) é elevada a
nível de grupo, mantendo o significado: **um grupo sobe tanto quanto o seu
pior item**.

```
MIN(revisado) ASC, MIN(score_venforce) ASC (NULL = pior), MAX(updated_at) DESC, chave ASC
```

Para uma linha de tipo `item` (grupo de um), isso é idêntico ao
comportamento anterior — nenhuma regressão de ordem para quem não tem família.

### 4.4 Filtros e busca

`q`, `status` e `filtro` (os cards de KPI) passam a valer para a lista
inteira. Semântica: **o predicado casa por item, e o grupo entra na lista se
qualquer item dele casar** — é assim que o ML se comporta ao filtrar uma
listagem agrupada, e é a única leitura em que "Pausados" não esconde metade de
um produto.

Os **agregados de um grupo que entrou continuam sendo do grupo inteiro**, não
do subconjunto que casou. Estoque de um produto é estoque do produto: filtrar
por "Ativos" não pode fazer o estoque total mudar de valor. Decisão explícita,
não efeito colateral.

Com isso, D-3 desaparece: nenhum card de KPI fica desabilitado, porque não há
mais uma aba que monopolize o parâmetro `filtro`.

### 4.5 Contrato dos endpoints

A unificação da listagem (§4.1 a §4.4) não criou endpoint nenhum. O **único**
endpoint novo desta tela é o de escrita de estoque (§4.2.2): ele existe porque
não havia caminho para escrever `available_quantity` — `/conteudo` cobre
título/modelo/descrição e mais nada.

| Endpoint | O que muda |
| --- | --- |
| `GET /anuncios-meli/familias` | Mesma rota, mesma autorização. Passa a devolver a **lista unificada**: `{ ok, cliente, anuncios: [linha…], paginacao }`, onde cada linha tem `tipo`. Sai `sem_user_product` (existia só para o badge da aba). |
| `GET /anuncios-meli/familias/:familyId` | Mesma rota, mesmo formato, mesma autorização. Só o `SELECT` ganhou `moeda`, `vendidos`, `score_venforce` e `listing_type_id`: a expansão deixou de ser uma tabela separada e virou a continuação da lista, então precisa preencher as MESMAS colunas do cabeçalho — sem esses campos, colunas do filho ficariam vazias embaixo de rótulos preenchidos. Acréscimos de **projeção**: filtro, join, ordem e agregação intactos. |
| `PATCH /anuncios-meli/:itemId/estoque` | **NOVO.** Corpo `{ clienteSlug, clienteContaId?, estoque }`; responde `{ ok, estoque, anuncio, itens_sincronizados, user_product_id }`. Mesma proteção do módulo (automações + carteira), a mesma de `/conteudo` e `/criacao/publicar` — que também escrevem no ML. Não é admin-only: o `requireAdmin` do otimizador existe porque a IA está em validação, não porque escrever no anúncio seja privilégio de admin. Precisa ser declarada **antes** de `GET /:itemId`, como as outras sub-rotas. |
| `GET /anuncios-meli` | **Inalterado** — é o contrato plano por item que `Portal/central-margem-api.js` consome como fallback do Motor de Margem. Mexer nele quebraria a Central de Margem. O filtro `sem_agrupamento` continua existindo ali como recorte de diagnóstico; deixa de ser identidade de aba. |

### 4.5.1 Dívida de nomenclatura de `GET /anuncios-meli/familias`

Registrada, **não** paga. Também documentada no próprio call site
(`server/routes/meliAnunciosRoutes.js`) e no controller.

**O que a rota era.** Nasceu listando **famílias**, para servir a aba
"Anúncios em Família". Devolvia `{ familias: [], sem_user_product: {} }` — o
segundo bloco existia só para o badge da outra aba.

**O que a rota é.** Depois da unificação devolve **grupos de anúncios**, em
`{ ok, cliente, anuncios: [], paginacao }`. Cada grupo é uma de duas formas, e
`tipo` é o único campo que as distingue:

| `tipo` | O que o grupo representa | Expansível |
| --- | --- | --- |
| `"familia"` | Família com `user_products` → `items` abaixo. Agregados do grupo inteiro (§4.2). | Sim, por `GET /familias/:familyId` |
| `"item"` | Anúncio individual, sem agrupamento. Traz o registro inteiro de `meli_anuncios`. | Não — no modelo do ML a relação ali é 1:1 (§1.3) |

**Por que não foi renomeada.** Não é um alias: renomear exige **migração dos
consumidores** — criar o caminho novo, migrar `Portal/anuncios-meli.js` (hoje o
único consumidor da listagem e da expansão) e só então remover o antigo. Isso
é criar um endpoint e remover outro, o que a missão proibiu explicitamente; e a
alteração ficou limitada a tratamento de dados e renderização.

**Não confundir com `GET /anuncios-meli`** (a raiz): aquela é a listagem
**plana** por item, segue sendo contrato do Motor de Margem
(`Portal/central-margem-api.js`) e **não** mudou. A dívida é só do caminho
`/familias`.

O comportamento da rota não foi alterado por este registro.

### 4.6 Fora de escopo, por restrição explícita da missão

Não foram tocados: autorização (`authMiddleware`, `requireAutomacoesAccess`,
`requireClienteNaCarteira`), sincronização (`meliSyncService`,
`registrarUserProducts`), estrutura de banco (nenhum `CREATE`/`ALTER` novo), e
nenhum relacionamento entre anúncios foi inventado — só `user_product_id` e
`family_id`, que vêm do próprio multiget `/items`.
