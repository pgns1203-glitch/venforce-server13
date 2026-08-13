# Central de Margem — Frontend

## Entrega

- Branch de trabalho: `feat/central-margem-ui`.
- Página: `Portal/central-margem.html`.
- Rota do Portal: `central-margem.html`.
- Entrada adicionada à seção **Análises** da navegação compartilhada em `Portal/layout.js`.
- Stack preservada: HTML, CSS e JavaScript vanilla.
- Fundação usada: `vf-tokens-v2.css` + `vf-components-v2.css` + layout global do Portal.
- A Central é somente leitura. Não existe chamada de escrita de preço, promoção ou Base.

Os wireframes `central_margem_v3.html` e `central_margem_venforce_v2.html` citados no briefing não estavam presentes no workspace, inclusive entre arquivos ignorados. A implementação foi guiada pelos dois documentos de contexto, pelos requisitos da rodada e pelos padrões reais da Fundação Global V2.

## Arquivos criados

| Arquivo | Papel |
|---|---|
| `Portal/central-margem.html` | Estrutura acessível da página, contexto, resumo, visões, tabela e drawer |
| `Portal/css/pages/central-margem-v2.css` | Composição específica da Central, sem criar outro design system |
| `Portal/central-margem-api.js` | Contrato único, autenticação, normalização do Motor e adapter legado somente leitura |
| `Portal/central-margem.js` | Estado da tela, filtros, paginação, renderização, drawer e simulação |
| `Portal/central-margem-api.test.js` | Testes puros do contrato, adapter, estados e simulação |
| `Portal/central-margem-ui.test.js` | Smoke tests reais de DOM em Chrome headless |
| `CENTRAL_MARGEM_FRONTEND.md` | Este documento |

## Arquivo alterado

- `Portal/layout.js`: adiciona **Central de Margem** em Análises e registra a página no grupo Operação.

Nenhum arquivo de `/importar-base`, schema, custos, índices, vínculos, normalizadores ou identidade de marketplace foi alterado pelo frontend.

## Estrutura da tela

1. Cabeçalho VenForce com título e objetivo operacional.
2. Contexto com cliente, marketplace, busca, atualização de leitura, fonte e timestamp.
3. Resumo clicável com Monitorados, Saudáveis, Margem baixa, Prejuízo, Não validados, Dados suspeitos e Em conciliação.
4. Visões Geral, Preço, Custo, Imposto, Comissão, Frete e Recebimento.
5. Lista paginada com busca no servidor, filtro de status, filtro de confiança e estados explícitos.
6. Drawer lateral com identificação, resumo, variáveis/fontes, divergências, simulação e ações seguras.

Quando o resumo recebido cobre apenas a página atual, a UI informa isso. O total “Monitorados” continua mostrando o total do catálogo exposto pelo backend; os estados são apresentados como contagem do recorte/página, sem fingir cobertura global.

## Contrato consumido

### Prioridade 1 — Motor de Margem

```http
GET /operacao/central-margem/:clienteSlug
Authorization: Bearer <vf-token>
```

Query usada:

- `marketplace=meli`
- `q`
- `status`
- `view`
- `page`
- `limit` (20, respeitando o teto do multiget do Motor)
- `dateFrom`
- `dateTo`

A camada normaliza o contrato canônico do Motor:

- `identity` e aliases `itemId`, `sku`, `title`;
- `fields` com evidências projetadas e realizadas;
- `margin.projected`, `margin.realized` e aliases;
- `quality.status`, `quality.confidence`, confiança por variável e motivos;
- `quality.divergences`;
- `sales`, `settlement`, `targetMargin` e paginação.

A confiança continua categórica (`HIGH`, `MEDIUM`, `LOW`, `UNKNOWN`). Um percentual só aparece se vier explicitamente como score numérico no payload; a UI não fabrica score.

### Prioridade 2 — adapter de compatibilidade

O adapter só é ativado se a rota canônica responder `404` ou `501`. Ele executa duas leituras agregadas em paralelo, nunca requests por linha:

```http
GET /anuncios-meli?clienteSlug=...&q=...&page=...&limit=...
GET /operacao/central-vendas/:clienteSlug?marketplace=meli&dateFrom=...&dateTo=...
```

O adapter conecta dados reais já existentes:

- catálogo, preço atual, item, SKU, título, imagem e última sincronização: Anúncios ML;
- custo e imposto expostos pela Base vinculada: Central de Vendas;
- preço vendido, tarifa/comissão realizada, frete realizado, resultado e margem realizada: pedidos da Central de Vendas.

No fallback, uma projeção só é calculada quando existem preço atual, custo, imposto, taxa efetiva histórica e frete médio realizado. Ela aparece marcada como **estimada** e explica a fórmula/origem. Frete previsto/API continua indisponível; o valor realizado não é renomeado como previsto.

Falha da leitura financeira não apaga o catálogo: a resposta vira parcial, margem realizada/custo/frete ficam pendentes e a tela explica o motivo. Falha do catálogo continua sendo erro de página.

## Visões

- **Geral:** status, produto, item, preço, margem projetada, margem real, confiança, problema e ação.
- **Preço:** preço API, extensão, último vendido, diferença disponível, confiança e situação.
- **Custo:** custo, Base/origem, atualização, confiança e situação. Não há edição.
- **Imposto:** percentual, fonte, confiança e situação.
- **Comissão:** valor, percentual, fonte, confiança e situação; estimativas são rotuladas.
- **Frete:** previsto/API, realizado/pedido, diferença, confiança e situação. Divergências do Motor destacam a linha.
- **Recebimento:** valor vendido, líquido, Mercado Pago, margem realizada, conciliação e situação.

## Drawer

O drawer abre sobre a lista sem recriá-la. Ao fechar, devolve foco ao botão/linha que o abriu e preserva busca, visão, filtros, página e scroll interno da tabela. Também há navegação anterior/próximo dentro do drawer.

Conteúdo:

- identificação: título, MLB/item, SKU e cliente;
- resumo: status, margem projetada, margem real, margem alvo e confiança geral;
- variáveis: valor, fonte, confiança, explicação e timestamp quando informado;
- divergências: variável, tipo, fontes, valores e explicação;
- ações: Ver na Base, Ver pedido, Abrir anúncio e Investigar fontes;
- ações sem backend seguro ficam desabilitadas com `AGUARDANDO_MOTOR`.

## Simulação de preço

A simulação é local e somente informativa. Quando todos os coeficientes necessários existem:

```text
lucro = preço − imposto − comissão − frete − taxa fixa − custo
margem = lucro / preço
```

Ela mostra margem projetada, lucro, diferença para a margem atual e diferença para a meta. Dados ausentes são listados em vez de assumidos silenciosamente.

O botão **Aplicar preço** é visível e desabilitado. Não há endpoint, método HTTP ou evento que altere preço no Mercado Livre.

## Estados de interface

- carregando: skeleton de tabela e botão de atualização em loading;
- erro de API: banner persistente + retry;
- sem cliente: orientação para selecionar contexto;
- sem Base ou vínculo ambíguo: mensagem controlada do Motor + link de leitura para Bases;
- sem itens: empty state com orientação para sincronizar o catálogo na tela própria;
- sem custo: célula “Sem custo” e estado Não validado;
- sem margem realizada: “Pendente”, nunca zero;
- dados conciliando: status Em conciliação;
- dados suspeitos: status textual e destaque de linha;
- resposta parcial: banner informa fonte, cobertura e limitações;
- sem resultado de filtros: ação para limpar os filtros.

Os estados não dependem só de cor: usam texto, ícone/sinal e status.

## Performance

- uma chamada de lista ao Motor por página;
- fallback limitado a duas leituras agregadas;
- nenhuma chamada por linha ou na abertura do drawer;
- paginação no servidor com 10/20 itens;
- busca com debounce de 350 ms;
- request anterior cancelada por `AbortController`;
- filtros locais de status/confiança sobre a página já carregada;
- renderização do drawer apenas para o item selecionado.

## AGUARDANDO_MOTOR

- `AGUARDANDO_MOTOR`: recebimento líquido e conciliação com Mercado Pago; o adapter/contrato já aceitam o campo, mas a fonte está indisponível.
- `AGUARDANDO_MOTOR`: ingestão do preço observado/evidência DOM pela extensão.
- `AGUARDANDO_MOTOR`: endpoint de auditoria para registrar/investigar divergência de forma persistente.
- `AGUARDANDO_MOTOR`: endpoint seguro, autorizado e auditável para aplicar preço. O frontend atual não escreve.
- `AGUARDANDO_MOTOR`: score numérico calibrado de confiabilidade. Até lá, somente classes e motivos.
- `AGUARDANDO_MOTOR`: links profundos oficiais para pedido e lançamento do Mercado Pago por produto.

## Testes

### Contrato e adapter

```bash
node Portal/central-margem-api.test.js
```

Cobertura: níveis de confiança, score fornecido, contrato canônico real, seis estados, dados legados reais, paginação, prevenção de request por linha, erro do Motor, resposta parcial, custo ausente, margem real pendente e simulação.

### Interface em Chrome headless

```bash
node Portal/central-margem-ui.test.js
```

Cobertura: carregamento, resposta parcial, sete visões, busca, filtro por card, drawer, restauração de foco/contexto, simulação, botão de escrita desabilitado, estados operacionais, sem custo, realizado pendente, erro/retry e responsividade em 1440, 1024, 768 e 390 px sem scroll horizontal global.

Os dados do smoke test são injetados pelo runner antes da página carregar. Não existe parâmetro de fixture nem modo mock no código de produção.

## Próximos passos

1. Publicar o backend do Motor e validar a Central contra um cliente real com grant e Base vinculados — sem deploy nesta rodada.
2. Calibrar a cobertura dos cards globais conforme custo/rate limit aceitável do endpoint de resumo.
3. Conectar Mercado Pago e extensão ao contrato de evidências.
4. Implementar auditoria persistente de divergências.
5. Somente em uma fase separada, desenhar a escrita segura de preço com autorização, validação e auditoria no backend.
