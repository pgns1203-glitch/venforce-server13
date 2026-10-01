# Painel de Contas V3 — auditoria de LC/MC e das semanas por conta

**Data:** 01/10/2026 · Nada aqui altera fórmula. Contagens de produção lidas
em sessão `default_transaction_read_only=on` (só `SELECT`).

> **Atualização (01/10/2026, ajuste de apresentação):** a gestão escolheu
> preservar LC/MC e **sinalizar** a cobertura parcial (opção 1 do §2). Ver §2.1.

---

## 1. LC e MC nas contas automáticas — a regra encontrada

Origem: `central_vendas_imports.resumo_json` do import escolhido por conta
(`buildResumoCentralVendas` + resumo do motor em
`centralVendasSyncService.buildMotorFromOrders`).

| Campo | Como é calculado | Quando é `null` |
|---|---|---|
| **FAT** | Σ faturamento de **todos** os pedidos no resultado (com e sem custo) = `faturamentoComCusto + receitaBloqueada` | nunca (0 é resultado verificado) |
| **LC** | Σ LC só dos pedidos **com resultado** (não `bloqueado`). Pedido sem custo de produto ou imposto vira `bloqueado` e fica de fora | nenhum pedido com custo |
| **MC** | `LC ÷ faturamentoComCusto` (a receita **coberta** por custo, não o FAT) | `faturamentoComCusto = 0` |

No Painel: a conta mostra `resumo.lc` e `margem_contribuicao_percentual/100`
como vêm; o consolidado soma LC e calcula `ΣLC ÷ ΣfaturamentoComCusto`
(`painelContasOperacional.consolidarCliente`). Fórmulas preservadas.

### O que isso significa quando a base de custos está incompleta

- **Base ausente** (nenhum pedido com custo): LC e MC já aparecem como "—".
  Nada é preenchido artificialmente. Caso da AMR em set/2026: 6.688 pedidos,
  todos `bloqueado` (`custo_produto_ausente` + `imposto_interno_ausente`), sem
  `base_cliente_vinculos` para o cliente.
- **Base parcial**: o Painel mostra FAT **total** ao lado de LC **só da parte
  coberta**. LC fica subestimado em relação ao FAT, e quem fizer LC ÷ FAT de
  cabeça não chega na MC exibida (que é a margem da amostra coberta). Antes
  deste ajuste **nenhum aviso** sinalizava isso — o único aviso da conta era
  sobre `completeness_status` do sync, que é outra coisa. Agora sinaliza (§2.1).

### Tamanho do problema (set/2026, último import publicado por conta)

| Cobertura de custo | Contas | % médio do FAT coberto | Mínimo |
|---|---:|---:|---:|
| Completa (receitaBloqueada = 0) | 10 | 100% | 100% |
| **Parcial** | **22** | 85,2% | **39,5%** |
| Sem custo algum (LC/MC já `null`) | 20 | 0% | 0% |
| Sem faturamento | 4 | — | — |

## 2. Opções avaliadas (a 1 foi a escolhida)

O dado necessário **já chega ao service**: `listarImportsDaCompetencia` lê
`faturamento` e `faturamento_com_custo` de cada import. A cobertura é
`faturamentoComCusto ÷ faturamento` — sem query nova, sem mexer em fórmula.

Opções, da menos para a mais invasiva:

1. **Sinalizar sem ocultar** — expor `coberturaCusto` por conta e no
   consolidado; mostrar "custo cobre 62% do FAT" ao lado de LC/MC.
2. **Ocultar abaixo de um limite** — se `coberturaCusto < X` (ex.: 90%), LC e
   MC viram "—" com o motivo "base de custos incompleta (62%)". O valor
   continua na API para auditoria. Precisa da decisão de **X**.
3. **Ocultar só o LC** — a MC é a margem da amostra coberta e pode ser
   representativa; o LC em reais é o número enganoso. Mantém MC com o rótulo
   "sobre 62% do FAT".
4. **Ocultar sempre que houver qualquer pedido bloqueado** — mais rígida; pelos
   números acima apagaria LC/MC de 22 contas além das 20 que já não têm.

Em todas: o consolidado precisa da MESMA regra (a soma de LC de contas
"ocultas" não pode reaparecer no total do cliente) e a fórmula oficial não muda.

### 2.1 Implementado: sinalização discreta (opção 1)

- `coberturaCustos({fat, lc, baseLc})` (`painelContasComposicao.js`) devolve
  `{estado: "completa"|"parcial", cobertura, faturamentoComCusto,
  faturamentoSemCusto}` ou `null` quando não há o que sinalizar (LC ausente —
  continua "—" — ou FAT ≤ 0). A cobertura é arredondada **para baixo** (nunca
  mostra 100% faltando custo).
- **Conta automática:** base = `faturamentoComCusto` do import. **Conta
  manual:** o LC informado vale para o FAT inteiro (completa). **Consolidado:**
  base = Σ `faturamentoComCusto` das contas com LC ÷ FAT consolidado — o mesmo
  denominador da MC consolidada. Snapshot com MC do fechamento oficial: o aviso
  vale só para o LC (`indicadores: ["lc"]`). Snapshot do cliente sem
  detalhamento por conta: nada é afirmado (`null`).
- Tela: abaixo do LC/MC parciais, `◐ 62,8%` em tom secundário; o `title`/
  `aria-label` explica: "Cálculo parcial: os custos cobrem 62,8% do FAT (R$ X
  de R$ Y). O LC soma só os pedidos com custo cadastrado e a MC é LC ÷
  faturamento com custo — valem para a parte coberta." Nenhum número muda,
  nenhuma métrica é removida.
- As definições de FAT/LC/MC no cabeçalho foram corrigidas para descrever a
  regra real (a MC dizia "LC ÷ venda total", o que não é o cálculo).

## 3. Semanas por conta (seção 7) — validado e preservado

- **Já está na `origin/main`**: PR #204 (`feat/painel-contas-semanas-por-conta`,
  commits `7f3053f` + `06d3d83` + bundle `2e28057`, merge `1592b13`). A branch
  não tem nada além do que foi incorporado (0 commits à frente da main).
- Estrutura: **Cliente → Conta → Semanas da conta**
  (`GET /painel-contas/:clienteId/contas/semanas`, um lote por cliente, mesmo
  import do FAT mensal) e o **consolidado semanal do cliente** continua na linha
  "consolidado semanal do cliente" (`/meses/:competencia/semanas`).
- Testes que cobrem e continuam verdes nesta branch:
  `painelContasSemanasContas.test.js`, `painelContasSemanasContasService.test.js`,
  `painelContasSemanas.test.js` e `TabelaHierarquica.test.jsx`.
- Nesta V3: o consolidado semanal do cliente fica disponível no Consolidado e
  na seção Mercado Livre; nas seções Shopee/TikTok ele é ocultado porque é o
  snapshot da Central (Mercado Livre) — mostraria número de outro marketplace.
  As semanas **por conta** continuam onde há import.
- Nenhum cherry-pick e nenhuma reimplementação.
