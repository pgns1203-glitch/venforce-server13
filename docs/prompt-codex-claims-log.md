# Tarefa: expor o motivo da falha na consulta de claims (pós-venda)

Repo: `venforce-server` (branch `main`) — servidor real.
Commit atual: `4d87f0b`

## Situação

A implementação de pós-venda (`centralVendasClaimsService.js`) está correta e o
guard-rail funciona: a tela mostra "PÓS-VENDA: Não verificado", o banner explica
que a consulta de claims não foi concluída e a confiança fica `parcial`. Ótimo —
o sistema se recusa a assumir "sem devolução = venda boa".

**O problema: a consulta falha e não há como saber por quê.** O motivo é
capturado em `response.motivo` (`http_400`, `http_403`, `erro_fetch`…) e
propagado até `claimsMotivo`, mas **nunca é logado nem exibido**. Sem isso não dá
para agir.

## PASSO 1 (prioritário) — logar o motivo

Em `server/services/centralVendas/centralVendasClaimsService.js`, na função
`buscarClaimsPorPeriodo`, antes do `return` que devolve `indisponivel: true`,
registre no log o motivo, o path e o status HTTP:

```js
console.log(
  `[centralVendas] claims indisponivel: motivo=${response.motivo}` +
  ` pagina=${page} path=${path}`
);
```

Siga o mesmo padrão de log já usado em `centralVendasFreteService.js`
(`[centralVendas] frete lote ...`). Logue também, no caminho de SUCESSO, quantos
claims vieram e quantos pedidos casaram — hoje não há como saber se o cruzamento
por `resource_id` funcionou:

```js
console.log(`[centralVendas] claims: total=${claims.length} paginas=${pages}`);
```

E no `centralVendasSyncService.js`, após o cruzamento, quantos pedidos foram
classificados como devolução/mediação.

Exponha `claimsMotivo` também no banner da tela (hoje o texto é genérico) para o
operador ver o código do erro sem abrir o log do Render.

## PASSO 2 — corrigir as duas causas prováveis

Enquanto o log não roda, há duas suspeitas concretas. Corrija a (a), que é barata
e não tem contraindicação; a (b) depende do que o log mostrar.

### (a) Formato do offset de fuso no `range`

`centralVendasClaimsService.js` linha ~53:

```js
return `date_created:after:${dateFrom}T00:00:00.000-0300,before:${nextIsoDate(dateTo)}T00:00:00.000-0300`;
```

A documentação do ML usa o offset **com dois pontos** (`-04:00`), não `-0300`:

```
range=date_created:after:2020-09-26T14:52:14.000-04:00,before:2020-09-27T14:52:14.000-04:00
```

Ajuste para `-03:00`. Se a API for estrita quanto ao formato, isso sozinho causa
`http_400`.

Confira também o `sort`: o código envia `sort=date_created:asc`, mas o exemplo da
doc é `sort=last_updated:asc`. Se `date_created` não for um campo ordenável
aceito, também gera 400. Na dúvida, **remova o `sort`** (é opcional) e mantenha
apenas a paginação por `offset` — menos superfície de erro.

### (b) Permissão da aplicação (se o log mostrar 401/403)

A doc de claims diz que é necessário ativar o tópico **marketplace claims** no
feed da aplicação, em "Minhas aplicações" no painel de desenvolvedor do ML.
Isso é **configuração de painel, não código** — nenhum ajuste no repositório
resolve.

Se o log mostrar `http_401` ou `http_403`, não tente contornar no código: relate
claramente que a aplicação precisa dessa permissão e pare por aí. Não invente
fallback.

## Restrições

- **Não** altere `meliFinanceiroService.js` nem `financeiroShared.js`.
- **Não** altere: `mlClient.js`, `claudeClient.js`, `aiProvider.js`,
  `tokenRefreshWorker.js`, `layout.js`, `style.css`.
- **NUNCA** faça a ausência de claims virar "sem devolução". O comportamento
  atual (marcar indisponível + rebaixar confiança) está correto e deve ser
  preservado em qualquer cenário de falha.
- Mudanças cirúrgicas. `git add` por arquivo específico, nunca `git add .`.

## Testes

Rodar toda a suíte (`server/tests/*.test.js`). O único que pode falhar é
`designStudioWorkspace`, que já falhava antes e não tem relação com este
trabalho.

Garanta que `centralVendasClaimsPosVenda.test.js` continua passando, e adicione
cobertura para: falha na consulta → motivo propagado até o resumo (não `null`,
não vazio).

## Critério de aceite

Após re-sincronizar `comprou_enviou_chegou` / `2026-07`, o log do Render deve
mostrar **uma linha explícita** com o motivo (`http_400`, `http_403`, etc.) ou,
se a correção (a) resolver, a contagem de claims encontrados.

Se resolver de fato, na tela: faturamento cai de R$ 143.125,92 para
~R$ 137.275,91, resultado vai de R$ 26.018,76 para ~R$ 24.670,51, e os cards de
Devoluções (~179) e Mediações (~10) deixam de ser 0.
