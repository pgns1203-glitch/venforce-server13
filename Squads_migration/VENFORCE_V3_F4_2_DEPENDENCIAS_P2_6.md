# VENFORCE V3 — F4.2 · DEPENDÊNCIAS DE BACKEND (P2.6)

> O que a Pessoa 1 **não** migrou para o Financeiro V3, por quê, e qual
> contrato destravaria cada item. Nenhum destes bloqueios parou a maratona:
> cada um virou “capacidade não migrada”, e o resto de F4.2 foi entregue.
>
> Regra que gerou esta lista: **o frontend não fabrica verdade.** Uma tela
> que exibe *cliente + operação + competência* no topo não pode disparar uma
> ação cujo contrato ignora dois desses três. Preferimos deixar o botão no
> Financeiro legado — onde o usuário já sabe que o recorte vem da planilha —
> a movê-lo para o V3 e criar a impressão de uma garantia que não existe.

Todos os caminhos e linhas abaixo foram lidos no código, não inferidos.

---

## Sumário

| # | Operação | Situação no V3 | Bloqueio |
|---|---|---|---|
| D1 | Salvar fechamento | **não migrada** | `entregas_cliente` não guarda a operação |
| D2 | Processar fechamento (upload) | **não migrada** | `POST /fechamentos/financeiro` não recebe período |
| D3 | Ordenar a Carteira por última sync | **degradada (opção some)** | `/me/portfolio` não devolve `ultimaSincronizacao` |
| D4 | Reprocessar / substituir | **não migrada** | entregas não têm chave de unicidade |
| D5 | Excluir entrega | **deliberadamente não exposta** | contrato existe; falta decisão de produto |

E o que **foi** migrado, para contraste: listar entregas, publicar,
despublicar, abrir e copiar o link público — tudo em
`frontend-react/src/services/entregasApi.js` +
`hooks/useEntregasFechamento.js`.

---

## D1 — Salvar fechamento não registra de qual OPERAÇÃO ele veio

**OPERAÇÃO**
Salvar o resultado calculado como uma entrega do cliente (botão “Salvar
fechamento” do Financeiro legado).

**ENDPOINT ATUAL**
`POST /entregas-cliente` · `PATCH /entregas-cliente/:id`
(`server/routes/entregasClienteRoutes.js:19,22`)

**PAYLOAD ATUAL**
```json
{ "tipo": "fechamento_mensal", "titulo": "...", "periodo": "<texto livre>",
  "cliente_slug": "n97", "status": "rascunho", "payload_json": { … },
  "origem_tipo": "fechamento_financeiro", "origem_id": null }
```
(`Portal/financeiro.js:2422-2436`)

**COMPORTAMENTO**
O `INSERT` grava `tipo, cliente_id, cliente_slug, cliente_nome, titulo,
periodo, status, publicado, payload_json, origem_tipo, origem_id,
created_by, expires_at` — e nada mais
(`server/services/entregasClienteService.js:180-187`). Não existe coluna
nem campo de conta.

**PROBLEMA**
`clienteContaId` **chega ao cálculo** (`Portal/financeiro.js:2271`,
`formData.append("clienteContaId", …)`) e **não chega à entrega salva**
(`:2422-2436`). O número publicado perde a operação que o gerou no exato
passo em que vira registro.

**RISCO**
Alto, e ele é de auditoria, não de UI. Um cliente com duas contas do mesmo
marketplace tem dois fechamentos possíveis para a mesma competência, e
depois de salvos são indistinguíveis. É a ambiguidade que todo o modelo
Cliente → ClienteConta existe para evitar (D17: `is_primary` nunca
desambigua). O próprio backend admite o buraco: `financeiroVisaoService.js:124`
marca o bloco com `escopoConta: false` e o comentário diz o motivo —
“entregas_cliente não tem cliente_conta_id”.

**CONTRATO NECESSÁRIO**
1. Coluna `cliente_conta_id INTEGER NULL REFERENCES cliente_contas(id)` em
   `entregas_cliente` (aditiva; entregas antigas ficam `NULL`, que é a
   verdade sobre elas — não escolher uma conta a posteriori).
2. `POST/PATCH /entregas-cliente` aceitando `cliente_conta_id`, validando
   que a conta pertence ao `cliente_id` resolvido (409
   `CONTA_NAO_PERTENCE_AO_CLIENTE`, vocabulário canônico já existente em
   `server/utils/erroContextoCanonico.js`).
3. `GET /entregas-cliente?cliente_conta_id=` como filtro.
4. `listarEntregas` devolvendo o campo, para o V3 poder marcar
   honestamente “desta operação” × “de outra operação” × “sem operação
   registrada (entrega antiga)”.

**ARQUIVOS BACKEND ENVOLVIDOS**
`server/services/entregasClienteService.js` (117-205 criar, 206-274 listar,
`atualizarEntrega`) · `server/controllers/entregasClienteController.js`
(48-58, 88-101) · migration nova em `server/sql/migrations/` ·
`server/services/financeiroVisaoService.js:118,124` (aí `escopoConta` pode
passar a `true`).

**TESTE NECESSÁRIO**
- entrega criada com `cliente_conta_id` de OUTRO cliente → 409, não grava;
- filtro por conta não vaza entrega de conta irmã do mesmo cliente;
- entrega antiga (`NULL`) continua sendo lida e listada, sem virar “conta 0”;
- `GET /financeiro/:cliente?conta=` só considera a entrega daquela conta.

---

## D2 — Processar fechamento ignora o período; o V3 não pode prometê-lo

**OPERAÇÃO**
Enviar planilhas e calcular o fechamento (“Processar fechamento”).

**ENDPOINT ATUAL**
`POST /fechamentos/financeiro` (multipart)
(`server/routes/fechamentosFinanceiroRoutes.js:26-45`)

**PAYLOAD ATUAL**
`sales`, `marketplace`, `cliente_slug`, `costs` **ou** `costsBaseId`,
`clienteContaId` (condicional), `ordersAll` (Shopee), `onhold` (TikTok),
`ads`, `venforce`, `affiliates`, `fullCost`/`additionalCosts` (MELI).
(`Portal/financeiro.js:2260-2294`)

**COMPORTAMENTO**
Não existe campo `periodo` no envio nem leitura dele no controller. O
backend **não infere** competência — nem mês atual, nem `new Date()`, nem
data do arquivo: o recorte é 100% o conteúdo da planilha enviada. O campo
`#fin-periodo` da tela é texto livre que só é usado depois, como
`entregas_cliente.periodo`.

**PROBLEMA**
Não é um bug do backend — é um contrato honesto para uma tela em que o
usuário escolhe o arquivo. Vira problema **ao migrar**: o Financeiro V3
tem um seletor de competência no cabeçalho e `?periodo=YYYY-MM` na URL. Um
botão “Processar” ali dentro pareceria operar sobre a competência exibida,
e não operaria: operaria sobre o que estiver na planilha.

**RISCO**
Alto. Processar Julho achando que processou Agosto e publicar o resultado
para o cliente é exatamente a classe de erro que a maratona não pode
introduzir. **É dinheiro.**

**CONTRATO NECESSÁRIO**
Uma das duas, não as duas:
- **(a) validação** — `POST /fechamentos/financeiro` passa a aceitar
  `periodo=YYYY-MM` e a **rejeitar** (409 `PERIODO_DIVERGENTE`) quando as
  linhas da planilha caem fora da competência declarada; ou
- **(b) declaração** — o endpoint devolve, no `summary`, a competência que
  ele efetivamente encontrou nos dados (`periodoDetectado`, `dataMin`,
  `dataMax`), e o V3 confronta com o período em tela e avisa antes de
  salvar.

(b) é menos invasiva e já resolve o risco; (a) é a garantia forte.

**ARQUIVOS BACKEND ENVOLVIDOS**
`server/controllers/fechamentosFinanceiroController.js` ·
`server/services/fechamentoFinanceiro/*` ·
`server/routes/fechamentosFinanceiroRoutes.js:26-45`.

**TESTE NECESSÁRIO**
- planilha de Julho + `periodo=2026-08` → 409 (a) ou `periodoDetectado`
  divergente no summary (b);
- planilha que atravessa dois meses → o comportamento é declarado, não
  silencioso;
- ausência de `periodo` no envio continua funcionando (o legado não quebra).

---

## D3 — `/me/portfolio` não devolve `ultimaSincronizacao` por cliente

**OPERAÇÃO**
Ordenar a Carteira por “Última sync”.

**ENDPOINT ATUAL**
`GET /me/portfolio` (`server/services/meService.js:108-172`)

**PAYLOAD ATUAL**
`clientes[]` traz `statusOperacional` e `pendencias`, mas **não**
`ultimaSincronizacao`. Por conta, `contas[].ultimaSync` existe e é
**literalmente `null`** (`meService.js:150`).

**COMPORTAMENTO**
O endpoint anterior (`/operacao/cliente-360/clientes`) devolvia
`ultimaSincronizacao` por cliente
(`cliente360Service.js:607`, de `findSincronizacoesPorCompetencia`).

**PROBLEMA**
Com a Carteira migrada para `/me/portfolio` (Bloco C), a ordenação por
última sync perdeu o dado que ordenava.

**RISCO**
Baixo, e já contido: a opção “Última sync” **some** do seletor quando
nenhum cliente tem o dado, e um `?ordem=sync` colado numa URL cai para
“Atenção primeiro”. O chip de conta diz “sem dado de sync” — nunca “nunca
sincronizou”, que seria uma afirmação que nenhum dos dois payloads sustenta.
Nada é fabricado; a funcionalidade é que está indisponível.

**CONTRATO NECESSÁRIO**
`GET /me/portfolio` devolvendo `clientes[].ultimaSincronizacao` (mesma
fonte que `cliente360Service` já consulta) e, quando existir fonte real,
`contas[].ultimaSync` de verdade em vez de `null` fixo.

**ARQUIVOS BACKEND ENVOLVIDOS**
`server/services/meService.js:108-172` ·
`server/services/cliente360/cliente360Repository.js`
(`findSincronizacoesPorCompetencia`).

**TESTE NECESSÁRIO**
- cliente sem sincronização devolve `null`, não `0` nem uma data inventada;
- a Carteira volta a oferecer a ordenação assim que **algum** cliente tem o
  campo (o comportamento condicional já está implementado e testado em
  `Portal/carteira-ui.test.js`).

---

## D4 — Entregas não têm chave de unicidade: reprocessar duplica

**OPERAÇÃO**
Reprocessar / substituir o fechamento de uma competência.

**ENDPOINT ATUAL**
`POST /entregas-cliente` (sempre cria).

**COMPORTAMENTO**
`_entregaIdSalvo` é uma variável de módulo do Financeiro legado
(`Portal/financeiro.js:24`) que zera ao reprocessar (`:2322`), ao trocar
cliente/marketplace (`:2725`), ao limpar (`:2590`) e a cada `F5`. Sem ele,
o próximo “Salvar” faz `POST` — nova linha. E
`criarOuAtualizarEntregaFechamento` (`:1030-1033`) faz fallback
`PATCH → POST` em **qualquer** erro, enquanto o botão “Salvar” não faz:
dois caminhos gravam a mesma entidade com tratamento de falha diferente.

**PROBLEMA**
Nada no banco impede duas entregas `fechamento_mensal` do mesmo cliente
para a mesma competência.

**RISCO**
Médio-alto: duas entregas publicadas do mesmo mês significam **dois links
públicos com números diferentes** circulando para o mesmo cliente.

**CONTRATO NECESSÁRIO**
1. Índice único parcial:
   `UNIQUE (cliente_id, tipo, periodo) WHERE tipo = 'fechamento_mensal'`
   — depois de D1, incluindo `cliente_conta_id`.
2. `POST /entregas-cliente` com semântica de *upsert* explícita
   (`?substituir=true`) ou 409 `ENTREGA_JA_EXISTE` devolvendo o `id`
   existente, para o frontend oferecer “substituir” em vez de duplicar.
3. Saneamento das duplicatas já existentes antes do índice.

**ARQUIVOS BACKEND ENVOLVIDOS**
`server/services/entregasClienteService.js:117-205` · migration nova.

**TESTE NECESSÁRIO**
- dois `POST` iguais → um registro + 409 com o `id` do primeiro;
- `?substituir=true` atualiza e mantém `token_publico` (o link já divulgado
  não pode morrer numa substituição);
- entrega de tipo diferente na mesma competência continua permitida.

---

## D5 — Excluir entrega: contrato existe, exposição é decisão de produto

**OPERAÇÃO** Apagar uma entrega.

**ENDPOINT ATUAL** `DELETE /entregas-cliente/:id`
(`entregasClienteRoutes.js:25`), autorizado por carteira como os demais.

**SITUAÇÃO** Funciona, e **nenhuma tela chama** — nem o legado, nem o V3.

**POR QUE NÃO FOI EXPOSTO AGORA**
Não é uma capacidade que o Financeiro legado tenha e o V3 esteja deixando
para trás: é capacidade **nova**. Apagar um fechamento publicado é
irreversível e não estava no escopo de “migrar o que o legado faz”.
Despublicar — que **foi** exposto — resolve o risco real (link público sem
validade que não podia ser revogado) sem destruir registro.

**DECISÃO NECESSÁRIA** Produto: existe caso de uso para apagar, ou
despublicar basta? Se existir, definir quem pode (só admin?) e se é
exclusão lógica.

---

## O que NÃO é bloqueio (e por que está aqui)

Para a Pessoa 2 não gastar tempo com falso positivo:

- **`GET /entregas-cliente` já existe e já é autorizado por carteira**
  (`entregasClienteController.js:62-78`). Era o que faltava ao V3, e o V3
  passou a chamá-lo direto — o bloco `relatorios` de
  `GET /financeiro/:cliente` derruba `id`, `token_publico` e `published_at`
  pelo caminho (`financeiroVisaoService.js:126-131`), e sem `id` não existe
  ação. **Nenhuma mudança de backend foi necessária.**
- **`despublicar` já existia** e nunca tinha sido chamado por nenhuma tela.
- **A “Reconciliação Shopee” do legado não tem endpoint**: é render do
  `summary` devolvido pelo próprio cálculo. Não há o que migrar.
