# Cliente 360 — primeira migração para React + Vite

> Criado em 28/07/2026. Escopo: **somente a Cliente 360**. O restante do Portal continua HTML/JS vanilla e intacto.

Ver também: [[FUNDACAO_GLOBAL_V2_APLICACAO]] · [[GUIA_CRIAR_NOVA_TELA_V2]] · [[TELA_CLIENTE_360]] · [[TELA_CENTRAL_VENDAS]]

---

## 1. Arquitetura encontrada

Auditoria feita antes de qualquer edição:

| Item | Realidade |
|---|---|
| Backend | Node/Express em `server/` (CommonJS), `PORT = process.env.PORT \|\| 3333`, iniciado por `npm start` → `server.js` |
| Portal | Pasta **estática**, **não** servida pelo Express (só `/downloads` é `express.static`). Todas as páginas são arquivos planos em `Portal/` |
| API base | Constante `API_BASE = "https://venforce-server.onrender.com"` repetida em cada `.js` de tela |
| Autenticação | `localStorage["vf-token"]` + `localStorage["vf-user"]`; middlewares `authMiddleware`, `requireAdmin`, `requireAutomacoesAccess` |
| Navegação | `Portal/layout.js` injeta sidebar/topbar; link ativo resolvido por `location.pathname.split("/").pop()`; mapa `PAGE_TO_GROUP` |
| Fundação Global V2 | `Portal/css/vf-tokens-v2.css` + `vf-components-v2.css` (convenção de modificador `is-*`) |
| **Fechamento API** | É a **Central de Vendas**: `GET /operacao/central-vendas/:slug`, com `pedidos → itens → componentes` individualizados (`receita_produto`, `tarifa_venda`, `frete_seller`, `custo_produto`, `imposto_interno`) |
| **Mercado Ads** | `server/services/adsService.js` (tabela `ads_resumos_mensais`) + `server/services/ads/mlAdsService.js` (`buscarPerformanceML`, via `mlFetch`/token do cliente) |
| Cliente 360 atual | `cliente360Routes/Controller/Service` — preservados intactos |
| React / Redux / Router | **Não existiam no projeto** |

Também existia, do turno anterior desta sessão, um app **Vue + Vite** para esta mesma tela. Como o pedido agora é React, ele foi **superseded** — ver §11.

---

## 2. Arquitetura escolhida

**Strangler migration.** A Cliente 360 vira a primeira página React do Portal; todas as outras continuam como estão, no mesmo domínio, com a mesma sidebar, o mesmo token e as mesmas permissões.

```
Portal legado  →  link "Cliente 360 V2"  →  app React + Vite  →  mesmo backend, mesma auth
```

```
frontend-react/
  package.json  vite.config.js  cliente-360-react.html  .env.example
  scripts/clean-assets.mjs
  src/
    main.jsx  App.jsx
    pages/Cliente360Page.jsx
    components/cliente360/   (13 componentes)
    hooks/                   useCliente360.js · useCliente360Simulation.js
    services/                apiClient.js · cliente360Api.js
    utils/                   currency · percentage · dates · numbers · cenario
    styles/cliente360.css
    test/                    setup.js · payload.js
        ↓  npm run build
Portal/cliente-360-react.html                  ← página publicada
Portal/assets/cliente-360-react/*.js|*.css     ← bundle isolado da tela
```

### Por que React + Vite

Foi o pedido. Do ponto de vista técnico o encaixe é bom: a Cliente 360 é a tela com mais estado derivado do projeto (filtros → payload → 11 seções → simulador interativo), exatamente onde o vanilla dói mais. Vite entrega dev server rápido e build estático sem runtime próprio — nada de Next.js (precisaria de servidor Node para o front) e nada de CRA (descontinuado).

### Por que a migração parou na Cliente 360

Migrar o Portal inteiro de uma vez significaria reescrever login, sidebar, 30+ telas e todo o CSS legado num único movimento, com risco alto e zero valor entregue até o fim. Uma página só, isolada e com rollback trivial (basta trocar o link em `layout.js`), prova a stack com risco mínimo.

### O que **não** foi usado, e por quê

| Descartado | Motivo |
|---|---|
| Next.js / CRA | O Portal é estático; Next exigiria servidor de front. CRA está descontinuado. |
| React por CDN / iframe | Bundle próprio mantém a página na mesma origem, com o mesmo `localStorage` e sem sandbox. |
| **React Router** | Uma página só, publicada como arquivo estático. A navegação continua sendo a do `layout.js` — um router seria uma segunda camada competindo com a existente. |
| **Redux** | Estado local de uma página. Dois hooks resolvem. |
| **React Query / TanStack** | Não estava no projeto. Uma requisição principal + `AbortController` não justificam a dependência. |
| Autenticação nova | Reaproveita `vf-token`/`vf-user` e o redirect para `index.html`. |

### Decisões de integração do Vite

| Decisão | Motivo |
|---|---|
| `build.outDir = ../Portal`, arquivo **plano** `cliente-360-react.html` | O Portal é plano. `layout.js` resolve o link ativo por `pathname.split("/").pop()` e as telas se linkam por caminho relativo (`bases.html`). Publicar em `Portal/react/cliente-360/` quebraria o estado ativo do menu **e** todos os links de volta às telas legadas. Por isso o build é plano, com os assets isolados em `Portal/assets/cliente-360-react/`. |
| `emptyOutDir = false` | Nunca limpar o Portal. Só os assets da própria tela são removidos antes do build (`scripts/clean-assets.mjs`), para não acumular arquivos com hash antigo. |
| Entrada `cliente-360-react.html`, **não** `index.html` | O Vite nomeia o HTML de saída pelo nome do arquivo de entrada. Um `index.html` aqui **sobrescreveria `Portal/index.html`, que é a tela de LOGIN**. |
| `publicDir = ../Portal` + `copyPublicDir = false` | `/style.css`, `/css/vf-tokens-v2.css`, `/css/vf-components-v2.css` e `/layout.js` resolvem em dev e em build **sem serem copiados nem empacotados**. Nenhuma linha de CSS global foi duplicada ou alterada. |
| `base = './'` | URLs relativas: funciona em qualquer host estático. Nenhuma URL local hardcoded no bundle. |
| `server.proxy` para `http://localhost:3333` | Em dev o cliente usa caminhos relativos e o Vite encaminha `/operacao`, `/auth`, `/ads`, `/fechamentos`, `/clientes`, `/health`. Sem CORS e com o mesmo comportamento de mesma origem da produção. |

---

## 3. Como executar

### Backend

```bash
cd server
npm install          # primeira vez
npm start            # http://localhost:3333
```

### Frontend React (desenvolvimento, com HMR)

```bash
cd frontend-react
npm install          # primeira vez
npm run dev
```

**URL local exata:**

```
http://localhost:5181/cliente-360-react.html?slug=<slug>&competencia=2026-06&compararCom=2026-05&marketplace=meli&margemAlvo=0.15
```

Em dev, as chamadas de API são relativas e o proxy do Vite as encaminha para o Express local. O token é lido de `localStorage["vf-token"]` — faça login uma vez no Portal na mesma origem do navegador, ou grave a chave pelo DevTools.

Para apontar a um backend diferente, copie `.env.example` para `.env.local`:

```
VITE_API_BASE_URL=https://venforce-server.onrender.com   # sobrescreve a base da API
VITE_BACKEND_ORIGIN=http://localhost:3333                # sobrescreve só o proxy de dev
```

### Build de produção

```bash
cd frontend-react
npm run build
```

Publica em:

- `Portal/cliente-360-react.html`
- `Portal/assets/cliente-360-react/cliente-360-react-<hash>.js`
- `Portal/assets/cliente-360-react/cliente-360-react-<hash>.css`

Esses artefatos **são versionados** junto com o Portal, porque o Portal é publicado como pasta estática. Rode o build antes de commitar mudanças em `frontend-react/`.

### URL de produção esperada

Mesmo host do Portal, arquivo plano:

```
https://<host-do-portal>/cliente-360-react.html?slug=<slug>&competencia=2026-06
```

Acesso pelo menu: **Operação → Cliente 360 V2**.

---

## 4. Integração com autenticação

Nenhum login novo. `src/services/apiClient.js` reaproveita exatamente o mecanismo do Portal:

- token em `localStorage["vf-token"]`, enviado como `Authorization: Bearer …`;
- usuário em `localStorage["vf-user"]` (o papel `admin` libera o placar);
- `401` → `window.location.replace("index.html")`, igual às telas vanilla;
- `403` → mensagem de permissão, sem redirecionar;
- **token nunca vai para a URL** — só slug, competência, comparação, marketplace e margem-alvo.

`layout.js` roda antes do bundle (script clássico × módulo com defer), desenha a sidebar e já valida a sessão.

---

## 5. Endpoints

### Novos (`server/routes/cliente360ResultadoRoutes.js`, montado em `/operacao/cliente-360`)

| Método | Caminho | Permissão | Uso |
|---|---|---|---|
| `GET` | `/:slug/resultado?competencia&compararCom&marketplace&margemAlvo` | `requireAutomacoesAccess` | payload completo da tela |
| `POST` | `/:slug/resultado/simular` | `requireAutomacoesAccess` | simulação server-side |
| `GET` | `/:slug/elasticidades?meses&ate` | `requireAutomacoesAccess` | elasticidade-preço por produto |
| `GET` | `/:slug/placar?desde` | `requireAutomacoesAccess` | placar operacional |
| `GET` / `POST` / `DELETE` | `/:slug/acoes[/:id]` | leitura / `requireAdmin` | ações do consultor |

### Reutilizados sem alteração

`GET /operacao/cliente-360/clientes` · `centralVendasRepository.getCentralVendasByRange` · `centralVendasService.buildPayloadFromRange` · `cliente360Repository.findAdsResumoByCliente` · `services/ads/mlAdsService.buscarPerformanceML` · `authMiddleware` / `requireAdmin` / `requireAutomacoesAccess`.

Nenhuma rota foi duplicada: o router novo usa só subcaminhos `/:slug/<sub>`, que não colidem com o `/:slug` puro do router legado.

---

## 6. Origem dos dados

### Fechamento (Fechamento API = Central de Vendas)

Fonte de verdade do fechamento mensal. Ela entrega pedidos e itens individualizados, então os motores por produto usam **exatamente o mesmo detalhe** que alimenta o fechamento — não existe segunda lógica de fechamento.

`cliente360FechamentoAdapter.js`:

1. lê o intervalo com `getCentralVendasByRange` + `buildPayloadFromRange`;
2. apura os totais oficiais (pedidos, unidades, cancelamentos, valor cancelado, ticket médio);
3. **reconcilia** detalhe × oficial:
   - `faturamentoFechamento` = Σ `pedido.valor` (não cancelados);
   - `faturamentoDetalhe` = Σ `item.receitaProduto`;
   - diferença com **origem conhecida** (linha financeira do fechamento sem item de produto, cujo resultado o próprio fechamento apurou) vira `ajusteIdentificado` → linha **“Ajustes de fechamento”** na ponte;
   - diferença **sem origem conhecida** vira `diferenca`, exposta na tela, e rebaixa a confiança para `parcial`.

Nada é forçado a fechar. Se diverge, a tela mostra o valor e nomeia a fonte.

### Ads (Mercado Ads)

`cliente360AdsService.js` busca **apenas o investimento total** da competência, sempre pelo backend. Ordem:

1. **mês fechado** → resumo mensal persistido (`ads_resumos_mensais`, loja `todas`) → integração Mercado Ads → estado controlado;
2. **mês parcial** → integração Mercado Ads **com o mesmo intervalo parcial** do fechamento (a API aceita `from`/`to`) → se falhar, o resumo do mês inteiro é devolvido com status `parcial` e explicação → estado controlado.

Uma linha de resumo inteiramente zerada é tratada como "sem dados" (é o que o módulo Ads grava quando nada foi apurado), não como zero real.

Não busca campanhas, anúncios, ROAS, ACoS, vendas atribuídas, orçamento diário nem performance por produto.

#### Contrato

```js
ads: { valor: 4100, status: "carregado", fonte: "mercado_ads", competencia: "2026-06", atualizadoEm: "…" }
```

`status`: `carregado` · `sem_dados` · `sem_grant` · `parcial` · `erro`.

#### Comportamento sem Ads

| Campo | Valor |
|---|---|
| `ads.valor` | `null` (**nunca** `0`) |
| `tacos` | `null` |
| `resultadoAposAds` | `null` |
| `margemAposAds` | `null` |
| Interface | “Sem dados de Ads” + motivo; KPIs mostram `—`, nunca `R$ 0,00` nem `0%` |

E o resto continua inteiro: resultado operacional, ponte, produtos, oportunidades e simulador operacional. Falha na integração vira `status: "erro"` — nunca derruba a requisição.

---

## 7. Fórmulas

```
resultadoOperacional = faturamento − comissão − frete − custo dos produtos − imposto
margemOperacional    = resultadoOperacional / faturamento
tacos                = adsTotal / faturamento
resultadoAposAds     = resultadoOperacional − adsTotal
margemAposAds        = resultadoAposAds / faturamento
```

> **`resultadoAposAds` não é lucro líquido, lucro final nem lucro real da empresa.** Despesas fixas e outras despesas podem não estar incluídas. A tela diz isso em texto.

Rótulos usados: *Resultado operacional*, *Margem operacional*, *Resultado após Ads*, *Margem após Ads*.

`resultadoFinal` **não existe** no contrato: era ambíguo (ora antes, ora depois de Ads). Como o endpoint é novo, não há consumidor legado — nenhum alias foi criado.

---

## 8. Ponte operacional

Começa no `resultadoOperacional` da competência comparada e termina no da atual.

Linhas permitidas: volume · mix · preço médio · comissão · frete · custo do produto · imposto · produtos novos · produtos que pararam · ajustes de fechamento identificados · “Outros”.

**“Outros” nunca é caixa-preta**: a linha carrega `composicao: [{ chave, label, impacto }]` com exatamente o que foi agrupado, e a interface mostra essa tabela ao expandir.

Cada linha traz `descricao` (frase em português), `formula` e `produtos` — com unidades antes/depois e o unitário antes/depois daquele fator. Exemplo, ao expandir *Custo do produto*: “O custo unitário dos produtos comparáveis mudou”, a fórmula, e a lista com `R$ 150,00 → R$ 180,00` em 88 unidades.

Fechamento: `resultadoOperacionalAnterior + Σ efeitos = resultadoOperacionalAtual`, resíduo ≤ **R$ 0,01** por construção algébrica. Se o resíduo passar disso:

- não é escondido e **nenhum ajuste artificial é inserido**;
- `ponte.divergencia` declara o valor e a fonte (`decomposicao_pvm`);
- a confiança cai para `parcial` e um alerta crítico é adicionado;
- a interface mostra a faixa “A soma dos fatores não fecha”.

### Por que Ads não participa da ponte

O investimento em Ads é uma **despesa mensal da conta inteira**, sem atribuição confiável por pedido, produto ou campanha nos dados disponíveis. Como linha da ponte, misturaria uma decisão de mídia com a explicação operacional e contaminaria as leituras de preço, volume, mix e custo — um produto pareceria “ter piorado” por causa de verba que nunca foi atribuída a ele.

Consequências aplicadas em todo o sistema:

- ponte, produtos, contribuição individual, classificação e margem unitária: **sem Ads**;
- oportunidades: sem `Ads sem retorno`, sem `TACoS recuperável`, sem `cortar Ads`; nenhuma tem `fator: "ads"`; **o total recuperável nunca inclui verba de mídia**;
- simulador: sem `adsNovo`, sem input de Ads, sem cenário “Cortar Ads ao TACoS-alvo”;
- narrativa: só operação;
- placar: Ads não é creditado.

Ads aparece em **dois lugares**, ambos descritivos: os KPIs do fechamento e o bloco **“Ads no fechamento”** (investimento, TACoS e resultado após Ads dos dois meses, com variação, fonte e última atualização). Texto permitido: *“o investimento passou de R$ 3.200 para R$ 4.100 e o TACoS passou de 3,8% para 4,2%”*. Proibido afirmar causalidade ou prever vendas perdidas após um corte — o sistema não tem dado que sustente isso.

---

## 9. Simulador

Por produto: Δ% preço, Δ% custo, Δ% frete, pausar/despausar.
Cenários rápidos: **Parar produtos no vermelho · Subir preços 5% · Reduzir custos 5% · Limpar**.

Toda a matemática roda **no servidor** (`POST …/resultado/simular`), com o mesmo motor puro que monta a ponte, chamada com debounce de 350 ms. Não há cópia de fórmula no React — só a conversão de p.p. → fração (`utils/cenario.js`).

Topo: resultado operacional atual · simulado · variação operacional.
Bloco secundário e informativo: **Ads mantido** (constante, igual no antes e no depois) · resultado atual após Ads · resultado simulado após Ads.

Sem dados de Ads, o bloco secundário exibe “Resultado após Ads indisponível” e **não assume Ads = 0**. Campos de Ads enviados no cenário são ignorados pelo motor e reportados em `avisos`.

Sem elasticidade estimável no histórico, o volume fica fixo e a tela avisa que o número é aproximado — o simulador não inventa a reação do mercado.

---

## 10. Competência parcial

- mês fechado → mês inteiro contra mês inteiro anterior;
- mês corrente → do dia 1 até hoje, contra o **mesmo número de dias** do mês anterior (nunca 15 dias contra 30);
- a tela marca “Período parcial — N de M dias”;
- Ads do mês parcial usa o mesmo intervalo parcial.

Timezone `America/Sao_Paulo` (`cliente360Periodo.hojeIso`), para o “hoje” não virar o dia por causa do UTC do servidor.

---

## 11. Arquivos criados

### Backend (`server/`) — reaproveitado e adaptado

```
services/cliente360/cliente360Periodo.js              competência/período + mês parcial
services/cliente360/cliente360PonteEngine.js          motor PVM (puro, sem Ads) + detalhe das linhas
services/cliente360/cliente360ProdutosEngine.js       ajudaram/prejudicaram/vermelho/abaixo do alvo
services/cliente360/cliente360ConfiancaEngine.js      cobertura + reconciliação + resíduo da ponte
services/cliente360/cliente360RecuperacaoEngine.js    oportunidades operacionais
services/cliente360/cliente360NarrativaEngine.js      narrativa + leitura descritiva de Ads
services/cliente360/cliente360SimuladorEngine.js      what-if (puro, Ads constante)
services/cliente360/cliente360ElasticidadeEngine.js   elasticidade-preço log-log
services/cliente360/cliente360FechamentoAdapter.js    adapter da Fechamento API + reconciliação
services/cliente360/cliente360AdsService.js           adapter de Mercado Ads + status
services/cliente360/cliente360ResultadoService.js     orquestrador + sanitização JSON
services/cliente360/cliente360SimulacaoService.js     simulação server-side
services/cliente360/cliente360SerieService.js         série histórica p/ elasticidade
services/cliente360/cliente360PlacarService.js        placar operacional
services/cliente360/cliente360AcoesRepository.js      CRUD de ações
controllers/cliente360ResultadoController.js
routes/cliente360ResultadoRoutes.js
sql/cliente_360_acoes.sql
tests/cliente360Ponte.test.js · cliente360Ads.test.js
tests/cliente360Capacidades.test.js · cliente360Resultado.test.js
```

### Frontend React

```
frontend-react/package.json · vite.config.js · cliente-360-react.html · .env.example
frontend-react/scripts/clean-assets.mjs
frontend-react/src/main.jsx · App.jsx · styles/cliente360.css
frontend-react/src/pages/Cliente360Page.jsx · Cliente360Page.test.jsx
frontend-react/src/components/cliente360/  (13 componentes .jsx)
frontend-react/src/hooks/useCliente360.js · useCliente360Simulation.js
frontend-react/src/services/apiClient.js · cliente360Api.js
frontend-react/src/utils/currency · percentage · dates · numbers · cenario (+ formato.test.js)
frontend-react/src/test/setup.js · payload.js
Portal/cliente-360-react.html               (gerado pelo build)
Portal/assets/cliente-360-react/*           (gerado pelo build)
```

**Componentes:** `Cliente360Header` · `Cliente360Filters` · `FechamentoResumo` · `ComparacaoMensal` · `AdsFechamento` · `PonteResultado` · `ProdutosImpacto` · `ProdutosNegativos` · `ProdutosAbaixoMeta` · `OportunidadesRecuperacao` · `SimuladorResultado` · `ConfiancaDados` · `PlacarConsultor` · `LoadingState` · `ErrorState` · `EmptyState`.

**Hooks:** `useCliente360` (filtros na URL, payload, `AbortController`) e `useCliente360Simulation` (cenário, debounce, elasticidades).

## 12. Arquivos alterados

| Arquivo | Alteração | Por quê |
|---|---|---|
| `server/index.js` | +3 linhas: `require` do router novo e `app.use("/operacao/cliente-360", …)` antes do legado | Montar as rotas. Só subcaminhos `/:slug/<sub>`, sem colisão. |
| `server/services/ads/mlAdsService.js` | 3º parâmetro opcional `janela` em `buscarPerformanceML`; `from`/`to` derivados dele | Ads do mês parcial no mesmo intervalo do fechamento. **Retrocompatível.** Arquivo sensível (usa token ML) — alteração mínima, nada mudou em token/grant/refresh. |
| `server/package.json` | +script `test:cliente360` | Rodar a suíte da tela. |
| `Portal/layout.js` | +1 link “Cliente 360 V2” → `cliente-360-react.html`; +1 entrada em `PAGE_TO_GROUP` | Acesso pelo menu. Nada mudou em logout, token, colapso da sidebar ou demais links. |
| `.gitignore` | +6 linhas (artefatos locais de `frontend-react` e `frontend-vue`) | Não versionar `node_modules`/`dist`/`.env.local`. |

Nenhum arquivo de autenticação, refresh de token, provider de IA, CSS global legado ou integração estável foi tocado.

### Sobre o `frontend-vue/`

O turno anterior desta sessão criou um app **Vue + Vite** para esta mesma tela. Ele continua no disco, junto com `Portal/cliente-360-v2.html` e `Portal/assets/cliente-360-v2/`, mas:

- **não está mais linkado** no menu (o item “Cliente 360 V2” agora aponta para a versão React);
- **está desatualizado**: o contrato do endpoint mudou nesta rodada (`comparacao`, `fechamento.{atual,anterior,variacoes}`, `ads.variacoes`, `oportunidades`), e o app Vue ainda lê os nomes antigos.

Nada foi apagado — a remoção é decisão do dono do repositório. Para remover: `rm -rf frontend-vue Portal/cliente-360-v2.html Portal/assets/cliente-360-v2`.

---

## 13. Testes

```bash
cd server        && npm run test:cliente360     # 210 verificações
cd frontend-react && npm test                   # 49 testes (Vitest + RTL)
cd frontend-react && npm run build              # build Vite
```

### Backend (18 pontos obrigatórios)

1. ponte começa no resultado operacional anterior · 2. termina no atual · 3. sem linha Ads (mesmo se `ads0/ads1` forem passados) · 4. resíduo ≤ R$ 0,01 em 13 cenários · 5. `tacos = ads / faturamento` · 6. `resultadoAposAds = resultadoOperacional − ads` · 7. Ads ausente → `null` · 8. falha de Ads não quebra o resultado operacional · 9. nenhuma oportunidade com fator Ads · 10. total recuperável sem Ads · 11. simulação ignora `adsNovo` · 12. Ads fixo só para exibição · 13. placar não credita Ads (e preserva o legado) · 14. mês parcial com os mesmos dias · 15. divergência fechamento × detalhe exposta · 16. produtos negativos identificados · 17. “Outros” com composição explícita (soma da composição = valor da linha) · 18. ajuste de fechamento não é criado artificialmente.

### Frontend React (13 pontos obrigatórios)

1. renderiza loading · 2. renderiza erro com retry · 3. renderiza o fechamento completo, na ordem da página · 4. ausência de Ads sem usar zero (4 travessões, nenhum `R$ 0,00` ou `0,0%`) · 5. ponte não mostra Ads · 6. simulador sem nenhum input de Ads · 7. sem botão “Cortar Ads ao TACoS-alvo” (os 4 cenários são exatamente os operacionais) · 8. resultado operacional visível sem Ads · 9. moeda pt-BR · 10. percentual pt-BR · 11. alterar filtro recarrega os dados · 12. requisição anterior cancelada em troca rápida de filtros · 13. build Vite funciona.

Extras: expansão da linha da ponte com fórmula e unitários; “Outros” com composição; resíduo declarado; bloco de Ads sem juízo de valor; placar sob demanda com histórico legado.

---

## 14. Limitações

- **Validação fim-a-fim com dados reais pendente.** Os testes usam repositórios fake e mocks de API; Postgres e a API do Mercado Livre não foram exercitados aqui — exigem `.env` com credenciais e um cliente com token ML + grant `advertising`.
- **`cliente_360_acoes` precisa ser criada** para o placar apurar: `psql … -f server/sql/cliente_360_acoes.sql`. Sem a tabela, o repositório falha graciosamente (lista vazia) e o placar aparece zerado.
- **A ponte fecha sobre a base reconciliada.** Se a Fechamento API divergir do detalhe sem origem identificável, a diferença aparece como divergência e a confiança cai — a ponte não a absorve.
- **Elasticidade precisa de histórico.** Menos de 3 competências com preços distintos → volume fixo no simulador, com aviso.
- **O build é artefato versionado.** Alterou `frontend-react/`? Rode `npm run build` antes do commit.
- **Este documento não é versionado**: o `.gitignore` do projeto ignora `*.md` (convenção existente — toda a pasta `docs/` está fora do git).
- **`frontend-vue/` ficou órfão** — ver §12.

---

## 15. Próximos passos para migrar outra tela

1. Criar `frontend-react/<nome>.html` (entrada) e `src/pages/<Nome>Page.jsx`.
2. Adicionar a entrada em `build.rollupOptions.input` (vira um objeto com várias chaves).
3. Ajustar `scripts/clean-assets.mjs` para limpar também a pasta de assets da nova tela.
4. Reaproveitar `services/apiClient.js` e `utils/` — já servem qualquer tela.
5. Adicionar o link em `Portal/layout.js` **só depois** de confirmar o build.
6. Manter a página antiga no ar até a nova ser validada em produção; só então remover o arquivo legado e o link.

Quando **três ou quatro** páginas estiverem em React e começarem a compartilhar estado entre si (cliente selecionado, competência), aí sim vale reavaliar React Router e um cache de dados (React Query). Antes disso, cada página independente é mais simples e mais segura.
