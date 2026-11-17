# Sentinel — recálculo por alteração da base de custos/impostos (hotfix)

Branch `fix/sentinel-recalculo-base-custos-20261117` (a partir de `origin/main` b0ada21d). **Desligado por padrão.**

## Problema e DECISÃO FINANCEIRA (17/11/2026)
O worker só recalcula uma linha de `sentinel_pedidos` quando o ML atualiza o pedido. Mudança na base de custos/impostos é um evento interno: linhas
já gravadas ficam com o custo/imposto de quando foram calculadas.

**Caso real — Alianza 1 (conta 86):** o imposto era 13% e foi reduzido para 10% (base alterada a partir de 13/11 02:05Z). **Decisão confirmada: a mudança
NÃO vale para vendas anteriores à vigência.** Conferência (somente leitura): as 120 linhas com imposto gravado ≠ base atual foram vendidas entre 14/10 e
11/11 20:39Z — **nenhuma a partir da vigência**. Os seis pedidos dos incidentes #9, #11, #12 e #13 foram vendidos de 07/11 a 11/11, 2 a 6 dias antes
da mudança, e calculados a 13% (a alíquota vigente na venda). **O 13% gravado está correto e esses incidentes são perdas reais da época, não artefato.**
Hoje o hotfix não recalcularia nenhuma linha da Alianza 1; ele existe para mudanças FUTURAS (ou correção retroativa autorizada) com data de vigência.

## Mecanismo (detecção por CONTEÚDO, não por `updated_at`)
`custos.updated_at` não serve: toda edição e todo reimport gravam `updated_at = CURRENT_TIMESTAMP` mesmo com valores iguais
(`baseCustosService.js:303,322`, `baseImportService.js:39,52`), e `DELETE` (`meliCustosLoteService.js:117`) não deixa rastro.

1. **Gate barato** — 1 consulta por conta/ciclo: contagem + md5 dos campos que afetam o cálculo (`produto_id, id_model, sku, custo_produto,
   imposto_percentual`, mesma projeção do `carregarIndiceCusto`). Assinatura igual à da última varredura e sem trabalho pendente ⇒ nada a fazer.
2. **Varredura** (só quando o gate abre): para cada linha estável (`confirmada|sem_custo|custo_ambiguo`, paga/parcialmente reembolsada, dentro da
   janela) resolve de novo o custo de cada item na base ATUAL (`resolverCustoItem`) e compara com o que a linha gravou
   (`itens[].custo_unitario`, `imposto_percentual`, `estado_custo`). Divergiu ⇒ defasada. Cobre mudança de custo, de imposto, produto removido
   e produto que ganhou custo; reimport idêntico não diverge.
3. **Recálculo** pelo fluxo que já existe (`reprocessarPorId`): `GET /orders/{id}` + `processarPedido`, no orçamento de chamadas, lock e protocolo de
   exceções do ciclo. `forcar:false` ⇒ o **frete gravado é reaproveitado** (sem chamada de frete). Pack: o rateio é refeito pelo caminho normal.
4. **Marcador** `recalculo_base` (JSONB, migration `20261118`): `{em, motivo, base:{n,hash}, antes:{custo,imposto,margem,estado}, natureza:"recalculado_com_base_atual"}`.
   É a margem do mesmo motor com a base atual — **não é resultado realizado nem conciliado**. Fora do `payload_hash`.

Idempotente (recalculada deixa de divergir), retomável (o estado em memória é só otimização; a divergência é o estado real), sem tocar checkpoint,
isolado por conta (base e linhas por conta).

## Vigência (OBRIGATÓRIA)
A base não tem data de vigência, então ela vem da operação. Padrão desligado e, **mesmo ligado, sem `SENTINEL_RECALC_DESDE` nada roda** (aviso no log):
nunca se reescreve o passado por omissão. Ligado: `SENTINEL_RECALC_BASE_ENABLED=true` · `SENTINEL_RECALC_DESDE=<ISO>` (primeira venda sob a nova alíquota;
pedidos com `data_pedido` anterior NÃO são reescritos) · `SENTINEL_RECALC_JANELA_DIAS` (30) · `SENTINEL_RECALC_MAX_POR_CICLO` (25) · `SENTINEL_RECALC_VARREDURA_MAX` (5000).
**A cada nova mudança de base, AVANCE `DESDE` para o início da nova vigência**; senão as vendas entre duas mudanças seriam recalculadas com a alíquota mais nova.

## Incidentes
O motor já encerra a condição (`condicao_ativa=false` + evento `condicao_encerrada`, sem resolver, sem apagar reconhecimento) e o resumo só soma perda
de condição ativa. Ajustes: o evento agora diz **"pedidos recalculados com a base de custos atual"** (`dados.recalculoBase.pedidos/em`) em vez de
"sem ocorrência nos últimos N dias"; a interface atual (`Portal/sentinel.js`), que ignorava `condicaoAtiva`, passa a mostrar "condição encerrada ·
impacto anterior" e não apresenta o valor como prejuízo atual (a interface nova do Fable já tratava).

## Custo
Estado estável: 1 consulta de assinatura por conta/ciclo; **0 chamadas ao ML**. Mudança de base: **1 `GET /orders/{id}` por pedido defasado**, no máximo
`MAX_POR_CICLO` (25) por conta por ciclo (pack: + `/packs/{id}` e irmão, uma vez por pack). Exemplo: uma mudança com 89 pedidos dentro da vigência ⇒ 4 ciclos, ~89 GETs uma única vez.

## Publicação (NÃO executada)
1. Aplicar `server/sql/migrations/20261118_sentinel_recalculo_base.sql` (aditiva; sem ela o recálculo suspende sozinho, sem erro).
2. Deploy do código com a flag desligada (comportamento idêntico ao anterior).
3. Só quando houver uma mudança de base a aplicar: definir `SENTINEL_RECALC_DESDE` (início da vigência) e ligar `SENTINEL_RECALC_BASE_ENABLED=true`; acompanhar `[sentinel] conta N: recálculo por base de custos`.
Rollback: desligar a flag; opcional `DROP COLUMN recalculo_base`.
