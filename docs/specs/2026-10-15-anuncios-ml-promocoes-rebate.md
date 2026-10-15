# Anúncios ML — "Promoções com rebate" (v1)

Data: 15/10/2026 · Branch: `feat/anuncios-ml-promocoes-rebate-otimizar`

## Objetivo

Na tela Anúncios ML, um botão **"Promoções com rebate"** que, para os anúncios
que **já estão numa promoção de referência** (em geral a "Vendex" do mês —
"Outubro - Vendex", "Vendex Outubro", "Vendex - Outubro"…), procura
promoções **com subsídio do Mercado Livre** que deixem o anúncio com margem
e/ou lucro **maior** do que tem hoje na referência — e, com a confirmação do
usuário, faz o anúncio participar delas.

Disparado **só por interação do usuário**. Nada de cron, worker agendado ou
piloto automático.

## Regras de negócio (decididas com o usuário)

1. **Referência**: o usuário escolhe a promoção de referência num seletor com
   as promoções da conta. Vem pré-selecionada a que tem "vendex" no nome **e**
   o nome do mês atual (America/Sao_Paulo, sem acento/caixa). Sem ela, a Vendex
   ativa mais recente; sem nenhuma Vendex, nada pré-selecionado.
2. **Universo**: só anúncios **ativos na referência** (status started/active
   na referência, com preço). Anúncio fora dela = descartado `FORA_DA_REFERENCIA`.
3. **Candidatas** (por anúncio), todas as condições:
   - preço definido pelo ML → tipo em `TIPOS_ESCRITA_ACEITE`
     (MARKETPLACE_CAMPAIGN, SMART, PRICE_MATCHING, PRICE_MATCHING_MELI_ALL,
     PRE_NEGOTIATED, UNHEALTHY_STOCK);
   - com subsídio do ML: `meliPercentage > 0` (subsidioMl > 0);
   - disponível para entrar: status `candidate`;
   - preço conhecido (`precoFinal` não nulo);
   - **preço estritamente menor que o preço de HOJE** (centavos). No ML
     vale o **menor preço para o comprador**: com preço igual ou maior a
     candidata nunca forma o preço e o rebate nunca entra → `PRECO_NAO_MENOR`.
     "Preço de hoje" = a promoção que forma o preço agora
     (`sale_price.metadata.promotion_id` → `statusExibicao: "ATIVA"`): a
     referência, ou uma promoção com rebate em que o anúncio já entrou. Sem
     ATIVA identificável, vale a referência.
4. **A referência nunca é tocada** (nem PUT, nem DELETE). Ela fica como rede
   de segurança: quando a promoção com rebate acaba, o anúncio volta ao preço
   da referência.
5. **Comparação**: margem % **e** lucro R$/un, os dois.
   - Base = preço de hoje + subsídio da promoção que o forma (campo `atual`
     do item; é a referência quando é ela que forma o preço).
   - Candidata = preço da candidata + subsídio dela.
   - Mesma fórmula: `marginEngine.computeMargin` com custo/alíquota/taxa fixa
     da Base de Custos e **comissão e frete cotados ao vivo em cada preço**
     (`margemCotacaoEmP`), igual ao `margemSimularService`. Cotação falhou →
     não estima: `COTACAO_INDISPONIVEL`.
   - Candidata só entra na lista se melhora **pelo menos uma** das duas
     medidas em relação à base.
6. **Classificação do anúncio**:
   - `recomendado`: a mesma candidata é a melhor em margem **e** em lucro, e
     não piora nenhuma das duas → vem marcada.
   - `escolha`: a melhor em margem ≠ a melhor em lucro, ou a melhor piora uma
     das medidas → o usuário escolhe (por margem, por lucro ou manter só a
     referência). Atalhos "Preferir margem em todos" / "Preferir lucro em todos".
   - `sem_ganho`: nenhuma candidata melhora margem nem lucro. Se o anúncio já
     está numa promoção com rebate fora da referência e nada a supera, vem
     com motivo `JA_EM_REBATE_MELHOR` ("já está numa promoção com rebate
     melhor") — inclusive quando não sobra candidata mais barata.
   - `descartado`: com motivo (`SEM_CUSTO`, `COTACAO_INDISPONIVEL`,
     `FORA_DA_REFERENCIA`, `SEM_CANDIDATA`, `PRECO_NAO_MENOR`, `ERRO_ML`).
7. **Sem ganho mínimo** na v1: qualquer melhora aparece.
8. **Execução**: só os itens confirmados; `participarPromocaoAceite` item a
   item, relendo ao vivo antes de gravar e revalidando: candidata ainda
   `candidate`, preço ainda **menor** que o preço de hoje, referência ainda
   ativa. Falha de um item não para o lote. Cada participação vai para o log
   de atividade.

## API (prefixo `/anuncios-meli`, mesmas travas do módulo)

Todas recebem `clienteSlug` e `clienteContaId?` (query no GET, body no POST),
com a mesma regra de conta dos vizinhos (2+ contas sem `clienteContaId` → 409
de ambiguidade). Falha esperada = `200 { ok:false, codigo, motivo }`.

### `GET /promocoes-rebate/referencias`
```json
{ "ok": true,
  "padraoId": "C-MLB123",
  "referencias": [
    { "id": "C-MLB123", "tipo": "SELLER_CAMPAIGN", "tipoLabel": "Campanha própria",
      "nome": "Vendex - Outubro", "status": "started",
      "inicio": "2026-10-01T03:00:00Z", "fim": "2026-11-01T02:59:00Z",
      "padrao": true }
  ] }
```
Fonte: `GET /seller-promotions/users/{mlUserId}?app_version=v2` (paginado).
Só status `started`/`active`/`pending`. Ordem: padrão primeiro, depois Vendex,
depois por início desc.

### `POST /promocoes-rebate/analises`
Body `{ clienteSlug, clienteContaId?, referencia: { id, tipo }, itemIds? }` →
`{ ok:true, jobId }`. Uma análise ativa por cliente (`ANALISE_EM_ANDAMENTO`).

### `GET /promocoes-rebate/analises/:jobId`
```json
{ "ok": true,
  "job": {
    "id": 12, "fase": "analise|execucao", "status": "processando|concluido|erro",
    "erro": null,
    "referencia": { "id": "C-MLB123", "tipo": "SELLER_CAMPAIGN", "nome": "Vendex - Outubro" },
    "progresso": { "total": 180, "processados": 42 },
    "resultado": {
      "resumo": { "recomendado": 10, "escolha": 4, "sem_ganho": 120, "descartado": 46 },
      "itens": [
        { "itemId": "MLB1", "titulo": "…", "thumbnail": "…",
          "status": "recomendado|escolha|sem_ganho|descartado",
          "motivo": null, "motivoTexto": null,
          "referencia": { "preco": 99.9, "subsidioMl": 0, "margemPercent": 12.3, "lucro": 12.29 },
          "atual": { "promotionId": "C-MLB123", "tipo": "SELLER_CAMPAIGN", "nome": "Vendex - Outubro",
                     "ehReferencia": true, "preco": 99.9, "subsidioMl": 0, "meliPercentage": null,
                     "margemPercent": 12.3, "lucro": 12.29 },
          "candidatas": [
            { "promotionId": "P-MLB9", "tipo": "SMART", "tipoLabel": "…", "nome": "…",
              "preco": 94.9, "subsidioMl": 4.99, "margemPercent": 14.1, "lucro": 13.38,
              "ganhoMargemPp": 1.8, "ganhoLucro": 1.09, "fim": "…",
              "melhorMargem": true, "melhorLucro": true }
          ],
          "sugestao": { "porMargem": "P-MLB9", "porLucro": "P-MLB9" } }
      ] },
    "execucao": null
  } }
```
`resultado` só quando a análise conclui. `execucao` (quando houver):
`{ total, processados, itens: [ { itemId, promotionId, tipo, status: "pendente|ok|falha", codigo, motivo, precoConfirmado } ] }`.

### `POST /promocoes-rebate/analises/:jobId/executar`
Body `{ clienteSlug, clienteContaId?, escolhas: [ { itemId, promotionId, tipo } ] }`.
Cada escolha precisa existir entre as `candidatas` daquele item no resultado
(senão 400 `ESCOLHA_INVALIDA`). Uma por item. Job precisa estar com a análise
concluída e sem execução em andamento. Reexecutar só as falhas = novo POST com
as escolhas que falharam. Resposta `{ ok:true }`; progresso pelo GET.

## Persistência

Tabela `promocoes_rebate_jobs` (job vive só durante a tarefa; serve de
histórico). Criada pelo `schemaEnsure` no boot + arquivo em `server/sql/migrations/`.
Processamento em background no mesmo processo, disparado pela requisição.
Job `processando` sem atualização há mais de 10 min = `erro` (interrompido por
deploy/restart). Leitura do job só pelo mesmo cliente.

## Frontend (Portal/anuncios-meli.*)

Botão na barra da lista → modal em 4 passos: (1) referência + "Analisar";
(2) progresso (polling); (3) prévia com grupos Recomendados / Escolha /
Sem ganho / Descartados, atalhos margem/lucro, contador "N participações";
(4) execução com resultado por item e "Tentar de novo as falhas". Ao fechar
depois de executar, recarrega a lista.

## Fora da v1
DEAL/SELLER_CAMPAIGN com rebate (exigem escolher preço), sair de promoções,
qualquer execução sem clique, ganho mínimo.

## Validação pendente
Antes do primeiro lote real: testar com **um** anúncio que o rebate passa a
valer e a referência continua ativa.
