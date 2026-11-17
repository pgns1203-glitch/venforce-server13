# Sentinel — handoff de integração e entrega (17/11/2026)

Três worktrees, todos a partir de `origin/main` **b0ada21d**, **sem commit**:

| worktree | branch | o que é | flag / efeito padrão |
|---|---|---|---|
| `wt-sentinel-fable` | `docs/sentinel-fable-strategy-20261116` | interface nova (`Portal/sentinel.{html,js,css}`, `sentinel-mock.js`, teste) + `docs/sentinel/discovery/` | substitui a tela atual; fala com as rotas `/sentinel/*` **existentes** (sem mudança de backend) |
| `wt-sentinel-promo-audit` | `audit/sentinel-promo-rebate-20261116` | evidência financeira (contrato v1, modo sombra) + relatório de cobertura | `SENTINEL_EVIDENCIA_PROMO_ENABLED` **desligada**; precisa da migration `20261117` só se ligar |
| `wt-sentinel-recalc` | `fix/sentinel-recalculo-base-custos-20261117` | recálculo por mudança da base de custos | `SENTINEL_RECALC_BASE_ENABLED` **desligada**; mesmo ligada exige `SENTINEL_RECALC_DESDE`; migration `20261118` |

## Como integrar (um comando por etapa; nada disso foi executado)
```bash
cd /home/user/Documentos/venforce_scanner_x1 && git fetch origin main
git worktree add --no-track -b feat/sentinel-entrega-20261117 /home/user/Documentos/wt-sentinel-entrega origin/main
/home/user/Documentos/wt-sentinel-recalc/docs/sentinel/handoff/montar-entrega.sh /home/user/Documentos/wt-sentinel-entrega --dry-run   # valida
/home/user/Documentos/wt-sentinel-recalc/docs/sentinel/handoff/montar-entrega.sh /home/user/Documentos/wt-sentinel-entrega             # copia
```
O script **aborta sem copiar nada** se o destino não estiver limpo, se um arquivo já existir (novo) ou se a `main` mudou um arquivo modificado desde b0ada21d
(nesse caso: merge de 3 vias manual daquele arquivo). Não cria commit nem push. Ordem de cópia: Fable → P0 → hotfix.

**Único conflito real entre worktrees** (os conjuntos de arquivos são disjuntos em todo o resto): `Portal/sentinel.js` e `Portal/sentinel-ui.test.js` foram
alterados pelo Fable **e** pelo hotfix. **Vale a versão do Fable**; o ajuste do hotfix na tela antiga (`condicaoEncerrada`) é descartado porque a interface
nova já trata `condicaoAtiva === false` e o evento `condicao_encerrada`. O script já faz isso.

## Commits sugeridos na branch de entrega (3, nesta ordem)
1. `Portal/sentinel.*`, `Portal/sentinel-mock.js`, `Portal/sentinel-ui.test.js`, `docs/sentinel/discovery/` — interface nova.
2. `server/services/sentinel/sentinelPedidoService.js`, `sentinelSchema.js`, `sentinelEvidencia*.js`, migration `20261117`, testes `sentinelEvidencia*`, docs de evidência.
3. `sentinelPollingWorker.js`, `sentinelIncidentes.js`, `sentinelRecalculoBase.js`, migration `20261118`, testes `sentinelRecalculoBase*`, `RECALCULO_BASE_CUSTOS.md`, este handoff.

## Verificação na branch de entrega (esperado)
```bash
cd /home/user/Documentos/wt-sentinel-entrega/server && export NODE_PATH=/home/user/Documentos/venforce_scanner_x1/server/node_modules DATABASE_URL=postgres://127.0.0.1:1/x
for f in tests/sentinel*.test.js; do node $f >/dev/null 2>&1; echo "$? $f"; done; node ../Portal/sentinel-ui.test.js
# PostgreSQL LOCAL descartável (nunca produção): SENTINEL_TEST_DATABASE_URL=postgres://vf@127.0.0.1:<porta>/postgres
for f in tests/sentinel*.postgres.cjs; do node $f | tail -1; done   # sentinelUnificacao exige UNIFICACAO_TEST_DATABASE_URL=.../vf_unificacao_test_<nome> (banco que NÃO existe)
```
Validado num worktree descartável a partir de `origin/main` (script + verificação abaixo; servidor 422 arquivos só com as 5 falhas conhecidas). Esperado (tudo 0/verde): `sentinelEvidenciaFinanceira` 82 · `Integracao` 26 · `Cobertura` 7 · `RecalculoBase` 21 · `Classificacao` 5 · `Detectores` 7 · UI Fable OK; PG: `sentinelEvidencia` 59 ·
`sentinelRecalculoBase` 56 · `v0a` 113 · `FretePack` 60 · `Incidentes` 98 · `sentinel` 24 · `E0Paridade` 2 · `Purge` 4 · `Unificacao` 19.
Em composição, o teste de P0 + recálculo com a flag promocional ligada/desligada foi feito numa cópia fora do repositório (11 verificações); ele **não** está nos worktrees.

## Falhas CONHECIDAS (já falham na `main` limpa — não são desta entrega)
- Unit: `basesTiktok`, `designStudioWorkspace`, `meliAnunciosOrdenacaoGlobal`, `mlTokenService`, `raioXVisual`. (`npm test` aborta no primeiro; use o laço por arquivo.)
- Portal (8, idênticas na `main` limpa e na entrega — validado): `anuncios-meli-custos-lista-ui`, `anuncios-meli-detalhe-modal-ui`, `anuncios-meli-listagem-unificada-ui`, `anuncios-meli-promocoes-rebate-ui`, `financeiro-v3-shell-ui`, `vf-admin-nav-restore-ui`, `vf-shell-ui`, `vf-ui`. `squads-config-redesign-ui` é sensível a carga: rode isolado (passa 5/5).
- PG: `sentinelRotas.postgres.cjs` — ordem de lista `[13,10,11]` × `[10,11,13]`.
- `server/scripts/sentinel-demo-e2e.cjs` está desatualizado em relação à interface nova (não é teste do run-all).

## Publicação (ordem; exige sua autorização — nada foi feito em produção)
1. Deploy do código com **todas as flags desligadas** (comportamento idêntico ao de hoje; a UI nova passa a ser servida).
2. Migrations só quando for usar o recurso: `20261117` (evidência) e/ou `20261118` (recálculo) — aditivas, idempotentes; sem elas os recursos suspendem sozinhos.
3. Evidência (opcional): ligar `SENTINEL_EVIDENCIA_PROMO_ENABLED` numa conta e medir com `relatorioCobertura`. **O `/orders/search` não traz `discounts`**; o detalhe real está em `/orders/{id}/discounts` (adaptador pronto, **worker ainda não o consulta**).
4. Recálculo: **não ligar agora.** Decisão financeira: o imposto da Alianza 1 passou de 13% para 10% **sem retroatividade**; das 120 linhas "divergentes" nenhuma foi vendida a partir da vigência.
   Só se aplica a mudanças futuras: definir `SENTINEL_RECALC_DESDE` (início da vigência) **e avançá-la a cada nova mudança**.
5. Grants ML: o Sentinel não renova token; renovar antes de expirar (≈19h UTC em 17/11).

## Fatos que a operação precisa saber
- Incidentes #9, #11, #12 e #13 (conta 86) são perdas **reais** a 13% (vendas de 07–11/11); #15 (−9,81) idem (frete 38%). Não são falso positivo.
- A conta 87 (2ª conta ML do cliente 133) não é monitorada. Cupom do vendedor (R$ 2) não entra na margem do motor (a validar com o faturamento).
- Rollback de qualquer parte: desligar a flag; `DROP COLUMN` das colunas novas é opcional (o código detecta a ausência).
