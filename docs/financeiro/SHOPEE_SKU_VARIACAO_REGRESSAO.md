# Shopee: prioridade da variação sobre SKU Principle

Auditoria de 16/10/2026. Branch `hotfix/financeiro-shopee-sku-variacao`, criada em
worktree limpo após `git fetch origin`, a partir de
`bc4f534ba41ebb6bd1a2b6a6c508ba30f97a704e` (`origin/main`).

## Conclusão da investigação

O problema descrito não se reproduziu nessa versão do motor. A prioridade
solicitada já existe em `selectShopeeBridgeIdentity`, no serviço
`server/services/fechamentoFinanceiro/shopeeOrderAllService.js`: o índice de
SKU da variação é consultado antes do índice de SKU principal.

`selectShopeeIdentityFromRecords` retorna ambiguidade quando os candidatos
continuam múltiplos após os filtros exatos disponíveis, ou quando os campos
informados não permitem distinguir candidatos compatíveis. Em
`resolveShopeeLineCost`, essa condição só recebe custo quando a equivalência
financeira preexistente é comprovada. Um Model resolvido também passa pela
verificação do Item correspondente na Base.

A mensagem “Match ambíguo — custos diferentes para o mesmo produto” é um
rótulo genérico em `frontend-react/src/utils/financeiro/pendencias.js`, aplicado
ao status de ambiguidade. O texto sozinho não prova que a duplicidade do SKU
principal causou o bloqueio. A origem do comportamento observado no portal
permanece sem comprovação; esta auditoria não verificou a versão implantada,
dados persistidos ou o fluxo de uma sessão autenticada.

Por isso, esta entrega adiciona proteção de regressão e documentação. Não há
alteração de código de produção, fórmulas, fallbacks, banco ou interface.

## Teste de reprodução

`server/tests/fechamentoFinanceiroShopeeSkuVariacaoPrioridade.test.js` contém
267 verificações, usando fixtures sintéticas:

- `FTWILTEX-A` → `ITEM-1` + `MODEL-1`, custo 10, imposto 8%.
- `FTWILTEX-B` → `ITEM-2` + `MODEL-2`, custo 27, imposto 11%.
- Mesmo `SKU Principle = FTWILTEX`, título e nome de variação nas duas linhas.
- Inversão da ordem das linhas da Performance e da Base; três aliases do SKU
  vendido; seleção exata das duas variações.
- SKU principal igual ao SKU de outra variação, sem contaminar os índices.
- Candidatos indistinguíveis com custos ou impostos diferentes: ambiguidade
  preservada, CMV/LC/MC nulos e receita registrada como pendente.
- Equivalência financeira existente preservada; candidato ausente impede seu uso.
- Model associado a outro Item não fornece custo.
- Leitura real de XLSX pelos parsers usados no upload, incluindo a Base FIN-508.

Execução, com as dependências do servidor instaladas:

```sh
node server/tests/fechamentoFinanceiroShopeeSkuVariacaoPrioridade.test.js
```

## Validação dos arquivos reais

Somente leitura dos três arquivos fornecidos, competência setembro/2026.
Nenhuma busca de uma segunda parte. Nenhuma planilha ou linha identificável de
pedido foi adicionada ao Git.

| Arquivo | Linhas lidas | SHA-256 |
| --- | ---: | --- |
| WBS - Custos Shopee 1.xlsx | 5.892 | `8a5cb1b27a3b9c61a69584662a026569c37088d5ffef9bc1aab20914ac13df80` |
| parentskudetail.20260901_20260930 (5).xlsx | 2.021 | `5d6913c40b51301d8b666e90350eda53f6377030a89180e683f0dd23ac6b239b` |
| Order.all.order_creation_date.20260901_20260930_part_1_of_2.xlsx | 7.632 | `9091dcd203be812bcf3fe516082a9e29717d7376b7cc69cd416586c844aca612` |

FTWILTEX: **441 linhas, 441 resolvidas, zero ambíguas**, já no baseline.
Item, Model, custo e imposto de cada uma conferem com a conciliação independente
salva da execução anterior. Esse total inclui as linhas de todos os status;
o reconhecimento financeiro continua seguindo as regras existentes.

O resultado completo serializado de `processShopee` foi comparado por igualdade
profunda antes/depois. A segunda execução também usou `parseSpreadsheet` com
`detectShopeeHeaderRow` e `parseShopeeCostSpreadsheet`, seguindo a leitura do
upload. Foram usados ADS 18.598,90, Venforce zero e afiliados zero nas duas
execuções. Resumo, linhas detalhadas, auditoria e pendências ficaram idênticos.

| Medida do motor atual | Antes | Depois |
| --- | ---: | ---: |
| FTWILTEX resolvidas | 441 | 441 |
| FTWILTEX ambíguas | 0 | 0 |
| Cobertura de custo | 99,65% | 99,65% |
| Linhas reconhecidas sem custo | 38 | 38 |
| Linhas reconhecidas ambíguas | 4 | 4 |

A cobertura acima é a do motor atual, que mantém os fallbacks existentes,
incluindo equivalência financeira. Ela não substitui os 99,22% e 79 pendências
da conciliação pontual anterior, feita com critérios mais restritivos. Nenhum
fechamento foi salvo ou publicado por esta validação.

## Regressões executadas

32 arquivos de teste passaram, abrangendo todos os testes
`fechamentoFinanceiro*.test.js`, `financeiroV3ParidadeLegado.test.js`,
`baseCustos*.test.js`, `basesShopeeItemModel.test.js`, `basesTiktok.test.js`,
`modeloBaseCustos.test.js` e `pendenciasPlanilhaContrato.test.js`.

Incluem FIN-21, FIN-24, FIN-133, FIN-328, FIN-390, FIN-508, parent item fallback,
`product_unique`, equivalência financeira, Performance, MELI e TikTok.
O teste de clientes exigiu nova execução fora do sandbox porque seu servidor
HTTP local recebeu `listen EPERM`; a nova execução passou (21 verificações).

O teste de reprodução já passa sem qualquer modificação no motor. Não se
atribui a esta branch uma correção funcional nem ganho de cobertura.
