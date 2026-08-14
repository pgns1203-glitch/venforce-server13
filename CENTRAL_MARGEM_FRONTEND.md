# Central de Margem — Frontend

## Entrega

- Branch de trabalho: `feat/central-margem-ui-v9` (a partir de `feat/central-margem-ui`).
- Página: `Portal/central-margem.html` · rota do Portal: `central-margem.html`.
- Entrada na seção **Análises** da navegação compartilhada (`Portal/layout.js`, não alterado nesta rodada).
- Stack preservada: HTML, CSS e JavaScript vanilla. Nenhum framework.
- Fundação usada: `vf-tokens-v2.css` + `vf-components-v2.css` + layout global do Portal.
- A Central é **somente leitura**. Não existe escrita de preço, promoção ou Base.

A referência de UX desta rodada é o preview aprovado `central_margem_preview_v9_fundacao_atual.html`
(pasta local `X0078/preview_centralmargem`, fora do repositório). O preview é
**especificação visual e comportamental**, não código: nenhum token embutido, nenhuma
fórmula e nenhum timestamp fictício dele foi copiado para o Portal.

## Arquivos

| Arquivo | Papel |
|---|---|
| `Portal/central-margem.html` | Estrutura acessível: contexto, modo da planilha, saúde das fontes, resumo duplo, planilha, fila de divergências e drawer com abas |
| `Portal/css/pages/central-margem-v2.css` | Composição específica da Central sobre a Fundação V2 (sem criar design system) |
| `Portal/central-margem-api.js` | Contrato único: autenticação, normalização do Motor, adapter legado, núcleo de cálculo, cenário e derivações puras |
| `Portal/central-margem.js` | Estado da tela, presets, filtros, planilha, fila e drawer |
| `Portal/central-margem-api.test.js` | 24 testes puros de contrato, composição, cenário e derivações |
| `Portal/central-margem-ui.test.js` | 17 smoke tests de DOM real em Chrome headless |

Nenhum arquivo de `/importar-base`, schema, `custos`, índices, `base_cliente_vinculos`,
normalizadores ou identidade de marketplace foi tocado.

## Arquitetura visual

1. **Cabeçalho** — título, objetivo, total monitorado, fonte da leitura e *Atualizar leitura*.
2. **Contexto** — cliente, marketplace, busca e última atualização.
3. **Modo da planilha + saúde das fontes** — um card em duas colunas.
4. **Resumo em dois blocos** — Resultado financeiro × Integridade do dado.
5. **Planilha principal** — uma linha por produto, uma coluna por variável, com o seletor de fonte no cabeçalho.
6. **Fila de divergências** — fila de investigação, não uma segunda calculadora.
7. **Drawer** — Resumo · Cenário · Evidências · Auditoria.

## Modo da planilha (presets)

| Modo | Preço | Custo | Imposto | Comissão | Frete | Taxa fixa |
|---|---|---|---|---|---|---|
| **Projetado** | ML API | Base | Base | ML API | Previsto ML | Base |
| **Realizado** | Pedido ML | Base | Base | Pedido ML | Pedido ML | Base |
| **Personalizado** | — ativado automaticamente ao alterar qualquer seletor — |

*Personalizado* é um **estado**, não um preset: só é atingido mexendo em um seletor.
*Restaurar Projetado* devolve a composição inicial.

**Custo, imposto e taxa fixa não têm versão realizada.** São variáveis DECLARADAS na Base
(`marginItem.DECLARED_FIELDS`); o próprio backend devolve a evidência projetada quando o
realizado é pedido (`valueForKind`). O preset Realizado mantém as três na Base — isso é o
contrato, não uma simplificação da UI. Uma fonte "custo realizado", como aparecia no
preview, **não existe** e não foi inventada.

Fonte sem evidência aparece no seletor e resolve para **Indisponível** com valor `null`.
Nunca vira zero.

## Saúde das fontes

Cinco leituras derivadas **apenas da resposta carregada**, com estado `OK` / `Parcial` /
`Pendente` / `Indisponível` e a cobertura em texto (a cor nunca é o único sinal):

| Fonte | Como é derivada |
|---|---|
| Mercado Livre API | itens com alguma evidência `MELI_API` |
| Bases VenForce | itens com alguma evidência `VENFORCE_BASE` |
| Pedidos ML | itens com alguma evidência `MELI_ORDER` |
| Mercado Pago | `settlement.available` — hoje sempre falso, exibido como **integração pendente** |
| Extensão | evidência `EXTENSION_DOM` — hoje ausente, exibido como **ingestão pendente** |

Disponibilidade não é presumida: sem itens carregados o estado é `Indisponível`.

## Resultado financeiro × Integridade do dado

O backend classifica cada item em **um** status, com precedência
`UNVALIDATED > SUSPECT_DATA > LOSS > LOW_MARGIN > RECONCILING > HEALTHY`
(`marginStatus.STATUS_PRECEDENCE`). A precedência é correta para decidir a **ação**, mas
esconde o resultado financeiro sempre que a qualidade do dado tem prioridade: um item em
prejuízo com custo ausente aparece só como "Não validado".

A Central separa as duas leituras com dois helpers puros e determinísticos em
`central-margem-api.js`. **O status canônico não é reescrito** — continua em `item.status`.

### `financialResult(item)`

1. Se `item.status` já é financeiro (`HEALTHY`/`LOW_MARGIN`/`LOSS`), usa como está (`origin: "backend"`).
2. Caso contrário deriva (`origin: "derived"`) da margem que o próprio Motor calculou
   (`realized.margin` quando existe, senão `projected.margin` — a mesma regra de `displayed`
   em `marginItem`): `null` → **Indeterminado**; `< 0` → **Prejuízo**;
   `< targetMargin` → **Margem baixa**; senão **Saudável**.
   Sem `targetMargin`, margem positiva é Saudável e o motivo diz que não há meta.

### `dataIntegrity(item)`

1. `UNVALIDATED` → **Não validado**; `SUSPECT_DATA` → **Suspeito**; `RECONCILING` → **Em conciliação** (`origin: "backend"`).
2. Com status financeiro, deriva: preço ou custo ausente → **Não validado**;
   divergência `CONFLICT` → **Suspeito**; confiança geral `LOW` → **Suspeito**;
   `item.reconciling` (estado de processamento da Central de Vendas) → **Em conciliação**;
   senão **Confiável**.

Mercado Pago indisponível **não** conta como "em conciliação": a integração nunca existiu,
e tratar ausência permanente como processamento marcaria o catálogo inteiro.

Os dois placares contam os itens **da página carregada**; *Monitorados* continua sendo o
total do catálogo informado pelo backend, e a tela diz isso em texto.

## Planilha principal

Colunas: Produto (sticky horizontal) · Preço · Custo · Imposto · Comissão · Frete ·
Taxa fixa · LC · MC · Resultado · Integridade · Problema · Próxima ação.

Cada célula de variável mostra valor, fonte usada e o marcador **"outra fonte difere"**
quando outra fonte disponível da mesma variável passa da tolerância do núcleo
(`0,05` absoluto / `2%` relativo para dinheiro; `0,001` / `2%` para percentuais — as mesmas
constantes de `marginEvidence`).

LC/MC saem de `computeMargin`, o **espelho fiel** de
`server/services/motorMargem/core/marginEngine.js#computeMargin`:

```text
lucro  = preço − (preço × imposto) − comissão − frete − taxaFixa − custo
margem = lucro / preço
```

- **preço e custo são obrigatórios**: sem eles LC/MC ficam Indisponíveis;
- imposto, comissão, frete e taxa fixa ausentes entram como **zero declarado**, com o nome
  listado em `assumed` e exibido na célula ("assumido 0: frete"). Ausente vira zero
  *declarado*, nunca zero silencioso;
- preço `<= 0` não é margem zero: é dado impossível e bloqueia o cálculo.

Filtros: **Resultado** e **Integridade**, cliques nos KPIs e chips removíveis. O antigo
filtro isolado de *Confiança* foi absorvido pelo de Integridade (que já considera confiança
`LOW`); a confiança por variável continua visível nas abas Cenário e Evidências.

### O que aconteceu com as sete visões antigas

Geral, Preço, Custo, Imposto, Comissão, Frete e Recebimento eram sete tabelas para a mesma
pergunta. O valor funcional de cada uma foi migrado antes da remoção:

| Visão antiga | Onde vive agora |
|---|---|
| Geral | A própria planilha (Resultado, Integridade, Problema, Próxima ação) |
| Preço / Custo / Imposto / Comissão / Frete | Colunas da planilha + aba **Evidências** (fonte, valor, momento, confiança) |
| Recebimento | Painel **Recebimento e conciliação** na aba Resumo (valor vendido, margem realizada, recebimento líquido, Mercado Pago, conciliação) |

Nenhum campo do contrato foi removido por causa disso: `variables.soldValue`,
`netReceipt`, `mercadoPago` e `reconciliation` continuam normalizados e exibidos.

## Fila de divergências

Uma linha por divergência **real** relatada pelo Motor: produto, variável,
`selecionada → alternativa`, impacto aproximado na MC (em pp), severidade e *Evidências*.

- o impacto é recalculado com o mesmo núcleo, trocando só aquela variável na composição atual;
- `CONFLICT` (duas fontes do mesmo momento discordam) é sempre **Crítica** — é defeito de dado;
- `DRIFT` (previsto × realizado) é **Revisar**, e só sobe para Crítica com impacto `>= 2 pp`;
- *Evidências* abre o drawer do produto na aba Evidências **já com a variável selecionada**;
- o Motor publica a mesma divergência em `fields[x].divergences` e em `quality.divergences`;
  a normalização deduplica para a fila não mostrar cada conflito duas vezes.

Divergência não é inventada: sem divergência relatada, a fila fica vazia.

## Drawer

Abas internas: **Resumo · Cenário · Evidências · Auditoria**. Preservados o backdrop, o
fechamento por botão e por `Escape`, a navegação anterior/próximo, o `X de Y produtos`,
`role="dialog"` + `aria-modal`, o foco ao abrir, a restauração do foco ao fechar e o
*focus trap* no `Tab` (novo).

### Resumo

Começa pela **Leitura do Motor** — a decisão em uma frase, derivada do estado real na mesma
ordem de prioridade do backend (dado antes de dinheiro): completar dado → investigar
divergência → não tratar realizado como fechado → completar composição → revisar preço →
testar cenário → monitorar.

Depois: LC atual, MC atual, Meta, Resultado, Integridade · **Variáveis que merecem atenção**
(ausentes, assumidas, divergentes, baixa confiança) · **Gates de segurança** (visuais,
derivados do estado; nenhuma regra de backend foi criada para preenchê-los) ·
**Recebimento e conciliação** · atalhos (*Ver na Base*, *Ver pedido*, *Simular cenário*,
*Investigar evidências*, *Mercado Pago* — este permanentemente desabilitado).

### Cenário

Tabela das variáveis (valor, fonte, confiança, restaurar) à esquerda; resultado, deltas e a
composição linha a linha à direita.

Overrides são **locais**: não viram evidência, não são gravados em Bases, não alteram o
produto nem o marketplace. A tela diz isso literalmente
("Override manual — apenas cenário"), e `simulateScenario` devolve `persisted: false`.
Cenário sem variável obrigatória **não calcula** e informa o que falta.

### Evidências

Seletor de variável no topo (com `!` na que tem fonte divergente). Para a variável
escolhida, um card por fonte com **Fonte · Valor · observedAt · effectiveAt · momento ·
qualidade · detalhe** e o papel: **Selecionada / Confirma / Conflito / Ausente**.

Ao lado, o valor da composição atual, o *porquê*, fonte, confiança, existência de conflito,
uso (projeção/realizado/personalizado) e a **Escolha do Motor** — que é diferente da
escolha da planilha: `resolveField` dá precedência ao realizado, o preset Projetado usa o
previsto, e as duas aparecem lado a lado.

**`effectiveAt` não existe no contrato do Motor** (as evidências têm apenas `observedAt`).
Ele é exibido sempre como *Não informado*. Nenhum horário do preview foi copiado; evidência
sem `observedAt` mostra "sem horário".

### Auditoria

O backend **não persiste audit trail** da Central. A aba abre dizendo isso e chama o que
mostra de **"Rastro da leitura disponível nesta resposta"**:

- **Observações desta leitura**: uma entrada por evidência com valor, ordenada por
  `observedAt` real (fonte, variável, momento, valor e nota do adapter);
- **Decisão e classificação do Motor**: `statusReasons`, motivos de qualidade, status
  canônico e o que faltou/foi assumido no cálculo projetado;
- **Metadados da leitura**: itemId, SKU, marketplace, cliente, `sourceMode`, última
  atualização, última venda, pedido mais recente e `snapshot persistido` — este último
  sempre *Não informado*, porque não existe.

A distinção entre **evento persistido** e **metadado da leitura atual** é explícita na tela.

## Contrato consumido

### Prioridade 1 — Motor de Margem

```http
GET /operacao/central-margem/:clienteSlug?marketplace=meli&q=&page=&limit=&dateFrom=&dateTo=
Authorization: Bearer <vf-token>
```

Normaliza `identity`, `fields` (camada de evidências), `margin.projected/realized/target`,
`quality` (status, confiança por campo, divergências), `sales`, `settlement` e paginação,
além dos aliases planos de compatibilidade.

Da camada `fields` o frontend passou a montar também:

- `item.sources[variável][fonte]` — valor, momento, qualidade, `observedAt`, nota e disponibilidade;
- `item.motorChoice[variável]` — o que o próprio Motor selecionou;
- `item.confidenceByVariable` — confiança indexada pelas variáveis da planilha;
- `item.audit` — metadados da leitura;
- `item.hasOrders` / `item.settlementAvailable`.

### Prioridade 2 — adapter de compatibilidade

Ativado **somente** em `404`/`501`, com duas leituras agregadas em paralelo
(`GET /anuncios-meli` + `GET /operacao/central-vendas/:slug`). O que ele consegue ler vira
evidência real por fonte; o que não consegue fica ausente e explícito:

| Variável | ML API | Extensão | Pedido ML | Base |
|---|---|---|---|---|
| Preço | preço sincronizado | — | último unitário vendido | — |
| Custo | — | — | — | custo da Base |
| Imposto | — | — | — | imposto da Base |
| Comissão | **indisponível** | — | tarifa realizada/unidade | — |
| Frete | **indisponível** | — | média realizada/unidade | — |
| Taxa fixa | — | — | — | **indisponível** |

O adapter não tem camada de evidências, então o Motor não relata divergência por ele.
As observações que ele já leu (previsto × realizado da mesma variável) são comparadas com a
**mesma regra de tolerância do núcleo** e entram na fila marcadas com
`origin: "adapter"` e o rótulo *derivada na leitura* — nunca confundidas com um `CONFLICT`
do Motor. `DRIFT` não altera o status: desvio não é defeito de dado.

### Regras preservadas

1. rota canônica primeiro; 2. fallback só em `404`/`501`; 3. **nenhuma chamada HTTP por
linha** (nem ao abrir o drawer, trocar de aba ou navegar entre produtos); 4. `null`
continua `null`; 5. ausente nunca vira zero; 6. parcial continua parcial; 7. Mercado Pago
não é inventado; 8. Extensão não é inventada; 9. margem alvo não é inventada; 10. estimativa
do adapter não é apresentada como Motor canônico.

## Uma fórmula, uma regra

`computeMargin` é a **única** fórmula financeira do frontend. Consomem dela:

- a planilha (`resolveComposition`);
- o cenário (`simulateScenario`);
- `simulatePrice(item, newPrice)`, mantido com o **mesmo contrato e o mesmo resultado** de
  antes por compatibilidade — a comissão em reais acompanha o preço simulado e o resto da
  aritmética é idêntico.

Há um teste de equivalência que compara `simulatePrice` com uma cópia literal da
implementação anterior em 100+ combinações de preço, coeficientes e meta.

## Segurança e limites desta fase

- **Bases é somente leitura.** Nenhuma escrita de custo, imposto ou taxa fixa pela Central.
  *Ver na Base* apenas navega.
- **Nenhuma migration, tabela nova ou alteração de schema.**
- **Aplicação real de preço permanece desabilitada.** *Aplicar cenário* está `disabled` com
  o motivo no `title`; não existe `POST`/`PUT`/`PATCH` na página, e nenhum endpoint antigo
  de precificação é reaproveitado para contornar isso.
- Um dos gates de segurança do drawer é justamente
  "Escrita real indisponível: não existe endpoint autorizado e auditável para aplicar preço".

## Débitos e pendências reais

- `AGUARDANDO_MOTOR` — **Mercado Pago**: não existe client, rota, token ou tabela no
  backend (`settlementEvidenceAdapter` está vazio). Recebimento líquido e conciliação
  continuam indisponíveis, e **não** são derivados do preço vendido.
- `AGUARDANDO_MOTOR` — **Extensão**: `extensionEvidenceAdapter` existe, mas não há rota que
  receba observações de DOM. Preço/frete observados seguem ausentes.
- `AGUARDANDO_MOTOR` — **auditoria persistida**: sem audit trail no backend, a aba Auditoria
  mostra o rastro da resposta atual, rotulado como tal.
- `AGUARDANDO_MOTOR` — **`effectiveAt` por evidência**: o contrato só tem `observedAt`.
- `AGUARDANDO_MOTOR` — **escrita segura de preço**: exige endpoint autorizado, validado e
  auditável no backend.
- `AGUARDANDO_MOTOR` — **score numérico de confiança**: só classes e motivos até haver
  histórico para calibrar.
- **Fonte da alternativa por variável**: comissão e frete previstos não existem no adapter
  legado; com o Motor publicado, essas colunas ficam completas sem mudança de frontend.
- **Achado da Fundação (não corrigido aqui)**: `Portal/style.css` (v1) ainda define
  `.vf-tabs` como pílula e `.vf-tab { flex: 1 }`, e a V2 não redeclara essas propriedades —
  elas vazam e esticam as abas. A Central neutraliza localmente em
  `central-margem-v2.css`; a correção definitiva é na Fundação, fora do escopo desta rodada.

## Testes

```bash
node Portal/central-margem-api.test.js   # 24 testes puros de contrato
node Portal/central-margem-ui.test.js    # 17 smoke tests em Chrome headless
```

Contrato: confiança, score fornecido, contrato canônico real, seis estados, adapter legado,
paginação, ausência de request por linha, erro do Motor, resposta parcial, custo ausente,
realizado pendente, mapa de fontes, `effectiveAt` nulo, escolha do Motor, presets, modo
Personalizado, núcleo de cálculo, fonte indisponível, **equivalência de `simulatePrice`**,
cenário local, cenário incompleto, resultado financeiro × integridade, fila de divergências,
deduplicação, saúde das fontes e divergência derivada pelo adapter.

Interface: carregamento, resposta parcial, seletores de fonte, ausência de chamada por
linha, preset Projetado, preset Realizado, seletor manual → Personalizado, *Restaurar
Projetado*, fonte indisponível, custo ausente sem zero, placares separados, filtros
financeiro e de integridade, fila de divergências abrindo a variável correta, as quatro
abas do drawer, cenário com override e cenário incompleto, escrita desabilitada, Mercado
Pago e Extensão indisponíveis, anterior/próximo, `Escape`, restauração de foco, busca,
responsividade em 1440/1024/768/390 px e erro com retry.

A fixture do smoke test é um payload canônico do Motor passado pelo **normalizador real**,
para o teste não divergir do contrato em silêncio. Não existe parâmetro de fixture nem modo
mock no código de produção.

## Próximos passos

1. Validar a Central contra um cliente real com grant ML e Base vinculada, com o Motor publicado.
2. Conectar Mercado Pago ao `settlementEvidenceAdapter` e reavaliar a saúde da fonte.
3. Abrir o canal de ingestão da extensão e ligar a coluna de preço observado.
4. Implementar auditoria persistida de divergências.
5. Resolver a duplicidade `style.css` (v1) × `vf-components-v2.css` na Fundação.
6. Em fase separada, desenhar a escrita segura de preço com autorização, validação e auditoria.
