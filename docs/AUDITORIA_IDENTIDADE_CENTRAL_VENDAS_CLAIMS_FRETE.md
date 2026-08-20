# Auditoria de identidade da Central de Vendas — Claims, Shipments/Frete e `CLAIMS_HTTP_400`

Data da auditoria: 20/08/2026  
Escopo: investigação somente leitura do fluxo Mercado Livre da Central de Vendas.  
Repositório: `pgns1203-glitch/venforce-server13`

## 1. Cadeia real de identidade atual

1. `clienteContaId=Conta B` entra em `resolveMarketplaceAccountContext()`.
2. O resolver valida que a conta pertence ao Cliente X e ao marketplace `meli`.
3. Da Conta B obtém `external_account_id="222"`.
4. Resolve explicitamente `resolveMlGrant({ clienteId: X, mlUserId: "222" })`, encontrando o grant B. Não há fallback para A nesse passo.
5. O Sync Run persiste `cliente_conta_id=B`, `external_account_id=222` e `grant_id=B`, congelando esse contexto.
6. O worker repassa esse contexto ao sincronizador.
7. O sincronizador define `sellerId=context.mlUserId`, portanto `sellerId=222`.

A partir daí a cadeia diverge:

- Orders chama `mlFetch(X, path, { mlUserId: 222 })`. O resolvedor busca exatamente grant B; se B estiver revogado ou indisponível, falha em vez de usar A.
- Shipments recebe `sellerId=222`, mas chama `mlFetch(X, path)` sem opções. O `sellerId` só é usado depois, para localizar `senders[].user_id=222`.
- Claims monta `players.user_id=222`, porém também chama `mlFetch(X, path)` sem `mlUserId`.
- Returns chama o detalhe pelo `claimId`, novamente com `mlFetch(X, path)` sem `mlUserId`.

Quando `mlUserId` está ausente, `mlClient` chama o resolvedor somente com `clienteId`. O resolvedor escolhe o grant principal utilizável; se ele não estiver utilizável, cai para o primeiro grant utilizável na ordenação.

No cenário de duas contas, assumindo ambos os grants utilizáveis:

- Orders: grant B.
- Shipments: grant A, porque A é principal.
- Claims: grant A, embora a query diga `players.user_id=222`.
- Returns: se a busca de Claims falhar, nenhuma chamada de detalhe ocorre e a fonte fica `RETURNS_BLOCKED_BY_CLAIMS`; se houver detalhe a consultar, ele usa grant A.

Isso também cria divergência de auditoria: o run e o snapshot registram `grant_id=B`, mas Shipments, Claims e Returns podem ter sido consultados com A.

## 2. Tabela de isolamento

| Fonte | `clienteId` usado | Conta explícita no collector/auth? | `mlUserId` explícito em `mlFetch`? | Grant no cenário A principal/B selecionada | Risco cross-account |
|---|---:|---|---|---|---|
| Orders | X | Sim, Conta B | Sim, `222` | B, sem fallback para A | Não, no fluxo atual |
| Shipments/Frete | X | B só no orquestrador; auth implícita | Não | A se utilizável; senão primeiro utilizável | **Alto** |
| Claims | X | Query aponta B; auth implícita | Não | A se utilizável; senão primeiro utilizável | **Alto** |
| Returns | X | Nenhuma conta no detalhe; auth implícita | Não | A se chamado; ou bloqueado se Claims falhar | **Alto** |

Existe ainda o fallback legado do contexto:

- Com zero `cliente_contas`, a Central resolve um grant por `clienteId`.
- Com uma conta ativa, resolve essa conta.
- Com duas ou mais contas ativas sem `clienteContaId`, responde 409.

Esse fallback legado não justifica reabrir a resolução implícita dentro de collectors que já receberam uma conta explícita.

## 3. Conclusão sobre Claims/Frete pós-`cliente_contas`

Claims e Frete não foram completamente migrados para account-scoping.

Frete pode estar funcionando em produção, mas isso não prova correção arquitetural. Ele funciona corretamente apenas quando o grant implicitamente escolhido coincide com a conta sincronizada — por exemplo, conta única, conta selecionada também principal ou grant das demais contas indisponível.

Claims sofre a mesma falha, agravada pela combinação possível:

```text
players.user_id = 222
Authorization = token do grant A/111
```

Returns repete o problema nas chamadas de detalhe.

O consumidor moderno Full evita isso: exige `clienteId` e `mlUserId` e sempre chama `requestFn(clienteId, path, { mlUserId })`.

Classificação: **falha real de isolamento account-aware**, independente de a API aceitar ou rejeitar a chamada.

## 4. Conclusão separada sobre `CLAIMS_HTTP_400`

A request atual de `buscarClaimsPorPeriodo()` é:

```text
GET /post-purchase/v1/claims/search
  ?players.user_id=<sellerId>
  &players.role=respondent
  &range=date_created:after:<início>,before:<fim>
  &limit=<1..100>
  &offset=<offset>
```

Exemplo produzido para seller 222, período julho/2026 e data atual 20/08/2026:

```text
/post-purchase/v1/claims/search?players.user_id=222&players.role=respondent&range=date_created%3Aafter%3A2026-07-01T00%3A00%3A00.000-03%3A00%2Cbefore%3A2026-08-21T00%3A00%3A00.000-03%3A00&limit=100&offset=0
```

Detalhes:

- Endpoint: `/post-purchase/v1/claims/search`.
- `players.user_id`: `sellerId` da conta selecionada.
- `players.role`: literal `respondent`.
- `range`: `date_created:after:...T00:00:00.000<tz>,before:<dia seguinte>...`.
- `URLSearchParams` codifica `:` como `%3A` e `,` como `%2C`; pontos e hífens permanecem.
- Janela inicial: `dateFrom`.
- Janela final: no máximo `dateTo + 90 dias`, limitada pela data UTC atual, mas nunca anterior ao próprio `dateTo`.
- O `before` usa o dia seguinte à janela final, cobrindo a data final inteira.
- `limit`: normalizado entre 1 e 100.
- `offset`: começa em zero e avança por `data.length`.
- Máximo: 100 páginas e nunca consulta `offset > 9999`.
- HTTP 400 não recebe retry normal; apenas uma segunda tentativa com a variante alternativa de timezone.
- 429/5xx recebem até três tentativas.

### Histórico anterior à Fundação

- `4d87f0b`, 03/08: implementação inicial, timezone `-0300` e `sort=date_created:asc`.
- `d8d83c3`, 03/08: mudou para `-03:00`, removeu `sort` e passou a registrar status/path.
- `ae8e061`, 04/08: adicionou fallback `-03:00 → -0300`, preservação/log do body, janela de 90 dias, filtro por pedidos e detalhes de Returns.
- `9ca5c52`/`9b8ebf3`, 19/08: classificaram `CLAIMS_HTTP_400` e endureceram completude, sem resolver a causa do 400.
- A documentação interna de 19/08 registra que ambas as variantes já haviam falhado em produção.

A [documentação oficial atual do Mercado Livre](https://developers.mercadolivre.com.br/pt_br/gerenciar-reclamacoes) confirma o par `players.user_id`/`players.role`, `limit ≤ 100`, `offset ≤ 9999` e o mesmo formato geral de `range`; o exemplo atual usa `-0300`, já coberto pelo fallback.

Conclusão: **a causa do HTTP 400 não está demonstrada**. O account-scoping defeituoso pode causar ou agravar falhas após a Fundação, mas não explica sozinho o 400 histórico. Não há evidência para trocar endpoint, range ou paginação por tentativa.

## 5. Ponto exato onde o body do erro é preservado ou perdido

Fluxo exato:

```text
ML responde 400 + JSON
↓
mlClient.mlFetch()
↓ res.json()
↓ retorna { ok:false, status:400, data:<body> }
Claims.fetchPage()
↓ preserva status e data
buscarClaimsPorPeriodo()
↓ logClaimsIndisponivel registra error/message/cause
↓ falha(...) descarta data
centralVendasSyncService
↓ recebe somente motivo="http_400" e status=400
central_vendas_sync_sources
↓ CLAIMS_HTTP_400 + errorMessage="http_400"
```

Pontos:

- O body é parseado e preservado por `mlFetch`.
- `fetchPage()` preserva `response.data`.
- `logClaimsIndisponivel()` registra `error`, `message` e `cause`.
- A perda persistente ocorre em `return falha(response.motivo, { status })`: `falha()` não contém `data` nem diagnóstico.
- O sincronizador grava somente `CLAIMS_HTTP_400`, status, `http_400`, tentativas e páginas.

Portanto, `error/message/cause` **não são totalmente descartados**, pois aparecem no log operacional. Porém são descartados do resultado do collector, do Sync Source, da API e do histórico persistido. Se o log de produção não estiver disponível, a informação se perde.

O teste atual intitula o caso como “propaga corpo”, mas só comprova o corpo no `console.log`; não comprova propagação no resultado ou banco.

## 6. Arquivos para um futuro hardening

Mudança necessária:

- `server/services/centralVendas/centralVendasSyncService.js`: passar `mlUserId` explicitamente para Frete e Claims.
- `server/services/centralVendas/centralVendasFreteService.js`: propagar `mlUserId` por lote/retry e chamar `mlFetchFn(..., { mlUserId })`.
- `server/services/centralVendas/centralVendasClaimsService.js`: propagar `mlUserId` na busca, fallback de timezone, paginação e detalhes de Returns.
- Testes de Account Context, Claims, Returns e Frete.

Para persistir diagnóstico do 400:

- `centralVendasClaimsService.js`: retornar diagnóstico seguro e limitado.
- `centralVendasSyncService.js`: encaminhá-lo como `errorMessage`/metadata.
- Possivelmente testes de `centralVendasSyncSourceService.js`; o serviço já suporta mensagem e metadata, então provavelmente não exige mudança de produção.

Não deveria ser necessário alterar `mlClient.js`, `mlTokenService.js`, `clienteContaService.js` ou `centralVendasSyncRunService.js`: eles já suportam resolução exata. Nenhum arquivo M9/Portal ou regra financeira precisa participar.

## 7. Testes que deveriam existir

- Duas contas, A principal e B explicitamente selecionada, ambas utilizáveis, com pedido contendo shipment e claim:
  - todas as chamadas Orders/Shipments/Claims/Returns devem receber `mlUserId=222`;
  - nenhuma deve usar o token A.
- Grant B revogado:
  - todas as fontes devem falhar para B;
  - nenhuma pode cair silenciosamente para A.
- Frete:
  - verificar o terceiro argumento de `mlFetchFn` em sucesso, retry e lotes.
- Claims:
  - verificar `mlUserId` em todas as páginas e nas duas variantes de timezone.
- Returns:
  - verificar o mesmo `mlUserId` na busca de detalhes.
- Diagnóstico 400:
  - `error/message/cause` seguros devem sobreviver até o Sync Source;
  - segredos e bodies arbitrariamente grandes não podem ser persistidos.
- Regressão do modo legado, caso ele seja deliberadamente mantido.
- Teste comparativo com o padrão Full: chamadas account-sensitive não aceitam `mlUserId` ausente.

A lacuna atual está em `centralVendasAccountContext.test.js`: ele só afirma `mlUserId` nas chamadas de Orders. Os pedidos usados não possuem shipment, e os stubs de Claims/Frete ignoram o terceiro argumento.

## 8. Proposta de correção mínima — não aplicada

1. Tratar `mlUserId` como parâmetro separado e obrigatório nos collectors.
2. No sincronizador:

   ```js
   buscarFretesEmLote({ clienteId, sellerId, mlUserId: sellerId, shipmentIds })
   buscarClaimsPorPeriodo({ clienteId, sellerId, mlUserId: sellerId, ... })
   ```

3. Em todas as chamadas de Frete, Claims e Returns:

   ```js
   mlFetchFn(clienteId, path, { mlUserId })
   ```

4. Não permitir fallback para outro grant quando a execução possui conta explícita.
5. Preservar no resultado de falha somente um diagnóstico sanitizado, por exemplo `error`, `message` e `cause` limitados, e persistir isso no Sync Source.
6. Reproduzir novamente o HTTP 400 com grant e seller coerentes. Só então decidir eventual correção de query ou configuração, com base no body real.

Nenhuma mudança de endpoint/query deve ser feita sem essa evidência.

## 9. Riscos de regressão

- Tornar `mlUserId` obrigatório pode quebrar chamadas diretas legadas e testes que hoje passam apenas `clienteId`.
- Manter fallback silencioso por compatibilidade preservaria justamente o bug; qualquer fallback precisa ficar restrito ao modo explicitamente legado.
- Com o grant correto, Claims/Frete podem passar a retornar dados antes ausentes, alterando completude, devoluções, frete e totais. Isso é correção da fonte, não mudança da regra financeira.
- Persistir body sem whitelist pode expor dados indevidos ou gerar metadata excessiva; limitar, sanitizar e redigir é obrigatório.
- Runs históricos continuarão registrando grant B mesmo que collectors antigos tenham usado A; não devem ser “corrigidos” por inferência.
- Retry, concorrência, paginação, janela de 90 dias e guard-rails de `claimsIndisponivel` devem permanecer intactos.
- Ambientes onde a conta selecionada já é a principal podem não mostrar diferença; o teste decisivo precisa ter A principal e B selecionada.

## Referências de código

- `server/services/centralVendas/centralVendasSyncService.js`
- `server/services/centralVendas/centralVendasClaimsService.js`
- `server/services/centralVendas/centralVendasFreteService.js`
- `server/services/centralVendas/centralVendasSyncRunService.js`
- `server/services/clienteContas/clienteContaService.js`
- `server/services/mlTokenService.js`
- `server/utils/mlClient.js`
- `server/services/full/fullMlGateway.js`
- `server/services/centralVendas/centralVendasSyncSourceService.js`
- `server/tests/centralVendasAccountContext.test.js`
- `server/tests/centralVendasClaimsPosVenda.test.js`
- `server/tests/centralVendasClaimsCompleteness.test.js`
- `server/tests/centralVendasFreteLotes.test.js`
- `server/tests/centralVendasFreteMediacao.test.js`
- `server/tests/centralVendasShipmentsCompleteness.test.js`

---

Esta auditoria não implementa correções, não altera regra financeira e não faz parte do M9 ou do M10.
