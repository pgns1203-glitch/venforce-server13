# Cliente 360 — primeira migração para Vue 3 + Vite

> Criado em 27/07/2026. Escopo: **somente a Cliente 360**. O restante do Portal continua vanilla e intacto.

Ver também: [[FUNDACAO_GLOBAL_V2_APLICACAO]] · [[GUIA_CRIAR_NOVA_TELA_V2]] · [[TELA_CLIENTE_360]] · [[TELA_CENTRAL_VENDAS]]

---

## 1. Arquitetura escolhida

**Strangler migration.** A Cliente 360 vira a primeira página Vue do Portal; todas as outras continuam como estão, no mesmo domínio, com a mesma sidebar, o mesmo token e as mesmas permissões. Nada foi reescrito "ao lado".

```
frontend-vue/                     ← código-fonte Vue (novo)
  cliente-360-v2.html             ← entrada Vite
  vite.config.js
  src/
    main.js  App.vue
    pages/Cliente360Page.vue
    components/cliente360/*.vue   ← 12 componentes
    composables/                  ← useCliente360, useCliente360Simulacao
    services/cliente360Api.js     ← HTTP + token do Portal
    utils/                        ← currency, percentage, dates, cenario
    styles/cliente360.css
        ↓  npm run build
Portal/cliente-360-v2.html                  ← página publicada
Portal/assets/cliente-360-v2/*.js|*.css     ← bundle da tela
```

Decisões de integração e o porquê de cada uma:

| Decisão | Motivo |
|---|---|
| `build.outDir = ../Portal` | A tela publicada vira mais um arquivo ao lado de `bases.html`, `financeiro.html`. Mesma origem, mesmo deploy estático, **sem iframe** e sem subdomínio. |
| `build.emptyOutDir = false` | Nunca limpar o Portal. Só os assets da própria Cliente 360 são apagados antes de cada build (`scripts/clean-assets.mjs`), para não acumular arquivos com hash antigo. |
| Entrada `cliente-360-v2.html`, **não** `index.html` | O Vite nomeia o HTML de saída pelo nome do arquivo de entrada. Um `index.html` aqui **sobrescreveria `Portal/index.html`, que é a tela de login**. |
| `publicDir = ../Portal` + `copyPublicDir = false` | Faz `/style.css`, `/css/vf-tokens-v2.css`, `/css/vf-components-v2.css` e `/layout.js` resolverem tanto no `vite dev` quanto no build, **sem copiar nem duplicar** a Fundação Global V2. |
| `base = './'` | URLs relativas: funciona em qualquer host estático, independente do caminho de publicação. Nenhuma URL local hardcoded. |
| Vue do bundle (npm) | Sem CDN, sem `window.Vue`, sem dependência global. |
| **Sem Vue Router** | É uma página só, publicada estaticamente dentro do Portal. A navegação continua sendo a do `layout.js`. Um router criaria uma segunda camada competindo com a existente. |
| **Sem Pinia** | Uma página não justifica store global. O estado vive em dois composables. |

### Por que a migração parou na Cliente 360

Migrar o Portal inteiro de uma vez significaria reescrever login, sidebar, 30+ telas e todo o CSS legado num único movimento — com risco alto e nenhum valor entregue até o fim. A Cliente 360 é o caso ideal para começar: é a tela com mais estado derivado (filtros, simulação interativa, muitos blocos que dependem do mesmo payload), justamente onde o vanilla dói mais e onde Vue paga por si. As outras telas continuam funcionando sem saber que o Vue existe.

---

## 2. Como rodar

### Backend

```bash
cd server
npm install          # primeira vez
npm start            # http://localhost:3333
```

### Frontend Vue (desenvolvimento, com hot reload)

```bash
cd frontend-vue
npm install          # primeira vez
npm run dev
```

Abrir: **`http://localhost:5180/cliente-360-v2.html?slug=<slug-do-cliente>&competencia=2026-06&compararCom=2026-05`**

Por padrão o dev aponta para a mesma API base das telas vanilla (`https://venforce-server.onrender.com`). Para apontar ao backend local, copie `.env.example` para `.env.local`:

```
VITE_API_BASE=http://localhost:3333
```

> O token é lido de `localStorage["vf-token"]`. Em desenvolvimento, faça login uma vez no Portal (mesma origem do navegador) ou grave a chave manualmente no DevTools.

### Build de produção

```bash
cd frontend-vue
npm run build
```

Publica em:

- `Portal/cliente-360-v2.html`
- `Portal/assets/cliente-360-v2/cliente-360-v2-<hash>.js`
- `Portal/assets/cliente-360-v2/cliente-360-v2-<hash>.css`

Esses três artefatos **são versionados** junto com o Portal, porque o Portal é publicado como pasta estática. Rode o build antes de commitar mudanças no `frontend-vue/`.

### Acessar em produção

Pelo menu: **Operação → Cliente 360 V2**, ou direto em `cliente-360-v2.html` no mesmo host do Portal.

---

## 3. Endpoints

### Novos (`server/routes/cliente360ResultadoRoutes.js`, montado em `/operacao/cliente-360`)

| Método | Caminho | Permissão | Uso |
|---|---|---|---|
| `GET` | `/:slug/resultado?competencia&compararCom&marketplace&margemAlvo` | `requireAutomacoesAccess` | payload completo da tela |
| `POST` | `/:slug/resultado/simular` | `requireAutomacoesAccess` | simulação server-side |
| `GET` | `/:slug/elasticidades?meses&ate` | `requireAutomacoesAccess` | elasticidade-preço por produto |
| `GET` | `/:slug/placar?desde` | `requireAutomacoesAccess` | placar operacional do consultor |
| `GET` | `/:slug/acoes` | `requireAutomacoesAccess` | ações registradas |
| `POST` | `/:slug/acoes` | `requireAdmin` | registrar ação operacional |
| `DELETE` | `/:slug/acoes/:id` | `requireAdmin` | remover ação |

### Reutilizados sem alteração

- `GET /operacao/cliente-360/clientes` — lista do seletor de cliente.
- `centralVendasRepository.getCentralVendasByRange` + `centralVendasService.buildPayloadFromRange` — leitura do fechamento.
- `adsService` / `cliente360Repository.findAdsResumoByCliente` — resumo mensal de Ads persistido.
- `services/ads/mlAdsService.buscarPerformanceML` — integração Mercado Ads.
- `authMiddleware`, `requireAdmin`, `requireAutomacoesAccess` — nenhum modelo de acesso novo.

---

## 4. Fonte dos dados

### Fechamento API (Central de Vendas)

É a **fonte de verdade** do fechamento mensal. Ela entrega dados individualizados por pedido/item, então os motores por produto usam exatamente o mesmo detalhe que alimenta o fechamento — **não existe segundo fluxo de fechamento**.

`cliente360FechamentoAdapter.js`:

1. lê o intervalo com `getCentralVendasByRange` + `buildPayloadFromRange`;
2. apura os totais oficiais (pedidos, unidades, cancelamentos, ticket médio);
3. **reconcilia** o detalhe por item contra o total oficial:
   - `faturamentoFechamento` = Σ `pedido.valor` (não cancelados);
   - `faturamentoDetalhe` = Σ `item.receitaProduto`;
   - diferença com **origem conhecida** (linha financeira do fechamento sem item de produto, cujo resultado o próprio fechamento apurou) vira `ajusteIdentificado` → linha **“Ajustes de fechamento”** na ponte;
   - diferença **sem origem conhecida** vira `diferenca`, é exposta na tela e rebaixa a confiança para `parcial`.

Nenhum número é forçado a fechar. Se diverge, a tela mostra que diverge.

### Mercado Ads

`cliente360AdsService.js` busca **apenas o investimento total** da competência. Ordem:

1. **mês fechado** → resumo mensal persistido (`ads_resumos_mensais`, loja `todas`) → integração Mercado Ads → estado;
2. **mês parcial** → integração Mercado Ads **com o mesmo intervalo parcial** do fechamento (a API aceita `from`/`to`) → se falhar, o resumo do mês inteiro é devolvido com status `parcial` e explicação → estado.

Uma linha de resumo inteiramente zerada é tratada como "sem dados" (é o que o módulo Ads grava quando nada foi apurado), não como um zero real.

Não busca ROAS, ACoS nem atribuição por produto. Não monta análise de campanha. Não gera recomendação de corte.

#### Contrato de Ads

```js
ads: { valor: 4100, status: "carregado", fonte: "mercado_ads", competencia: "2026-06", atualizadoEm: "..." }
```

`status`: `carregado` · `sem_dados` · `sem_grant` · `erro` · `parcial`.

#### Quando Ads não existe

| Campo | Valor |
|---|---|
| `ads.valor` | `null` (**nunca** `0`) |
| `tacos` | `null` |
| `resultadoAposAds` | `null` |
| `margemAposAds` | `null` |
| Interface | “Sem dados de Ads” + motivo |

E o resto **continua funcionando por inteiro**: resultado operacional, ponte, produtos, oportunidades e simulador. Falha na integração de Ads é capturada e vira `status: "erro"` — nunca derruba a requisição.

---

## 5. Fórmulas

```
resultadoOperacional = faturamento − comissão − frete − custo dos produtos − imposto
margemOperacional    = resultadoOperacional / faturamento
tacos                = adsTotal / faturamento
resultadoAposAds     = resultadoOperacional − adsTotal
margemAposAds        = resultadoAposAds / faturamento
```

> **`resultadoAposAds` não é lucro líquido.** Salários, ferramentas, despesas fixas e outras despesas podem não estar incluídos. A tela diz isso explicitamente.

O nome `resultadoFinal` **não existe** neste contrato: era ambíguo (ora antes, ora depois de Ads). Como o endpoint é novo, não há consumidor legado — nenhum alias foi criado. O contrato usa apenas `resultadoOperacional`, `resultadoAposAds`, `margemOperacional` e `margemAposAds`.

### Ponte do resultado

Começa no `resultadoOperacional` da competência comparada e termina no `resultadoOperacional` da atual. Linhas permitidas: volume, mix, preço médio, comissão, frete, custo do produto, imposto, produtos novos, produtos que pararam, ajustes de fechamento identificados, e "Outros" (com composição explícita das linhas imateriais). Resíduo ≤ **R$ 0,01** por construção algébrica.

### Por que Ads não participa da ponte

O investimento em Ads é uma **despesa mensal da conta inteira**, sem atribuição confiável por pedido, produto ou campanha nos dados disponíveis. Colocá-lo como linha da ponte misturaria uma decisão de mídia com a explicação operacional e contaminaria as leituras de preço, volume, mix e custo — um produto pareceria "ter piorado" por causa de verba que nunca foi atribuída a ele.

Consequências, aplicadas em todo o sistema:

- ponte, produtos, contribuição individual, classificação de produto e margem unitária: **sem Ads**;
- oportunidades de recuperação: sem `Ads sem retorno`, sem `TACoS recuperável`, sem `cortar Ads`; nenhuma oportunidade tem `fator: "ads"`; o **total recuperável nunca inclui verba de mídia**;
- simulador: sem `adsNovo`, sem input de Ads, sem cenário “Cortar Ads ao TACoS-alvo”. O investimento entra só como **constante de exibição**, fixa no antes e no depois. Campos de Ads enviados no cenário são ignorados e reportados em `avisos`;
- narrativa: fala só de operação;
- placar do consultor: Ads não é creditado.

Ads aparece em **dois lugares**, ambos descritivos: os KPIs do fechamento (investimento, TACoS, resultado após Ads, margem após Ads) e o bloco **“Ads no fechamento”**, com a comparação mensal. Leitura permitida: *“o investimento passou de R$ 3.200 para R$ 4.100 e o TACoS passou de 3,8% para 4,2%”*. Proibido: “ajudou”, “prejudicou”, “sem retorno”, “corte recuperaria X”, “o ideal seria reduzir”.

### Competência parcial

- mês fechado → compara o mês inteiro contra o mês inteiro anterior;
- mês corrente → do dia 1 até hoje, contra o **mesmo número de dias** do mês anterior;
- a tela marca “Período parcial — N de M dias”;
- Ads do mês parcial usa o mesmo intervalo parcial.

Timezone `America/Sao_Paulo` (`cliente360Periodo.hojeIso`), para o "hoje" não virar o dia por causa do UTC do servidor.

### Placar do consultor

Crédito só quando a ação registrada na competência M aparece como melhora **do mesmo fator** na ponte de M+1. Fatores aceitos: `custo`, `frete`, `preco`, `comissao`, `imposto`, `mix`, `produto`, `base`. O que não tem ação por trás fica em "mercado/outros" e nunca é creditado.

Registros históricos com fator `ads`/`tacos` **não foram apagados**: continuam no banco e aparecem numa seção “Legado”, com crédito R$ 0,00 e fora do total. Novos registros com fator `ads` são recusados com HTTP 400.

---

## 6. Arquivos criados

### Backend (`server/`)

```
services/cliente360/cliente360Periodo.js              competência/período + regra de mês parcial
services/cliente360/cliente360PonteEngine.js          motor PVM (puro, sem Ads)
services/cliente360/cliente360ProdutosEngine.js       ajudaram/prejudicaram/vermelho/abaixo do alvo
services/cliente360/cliente360ConfiancaEngine.js      cobertura + reconciliação
services/cliente360/cliente360RecuperacaoEngine.js    oportunidades operacionais
services/cliente360/cliente360NarrativaEngine.js      narrativa + leitura descritiva de Ads
services/cliente360/cliente360SimuladorEngine.js      what-if (puro, Ads constante)
services/cliente360/cliente360ElasticidadeEngine.js   elasticidade-preço log-log
services/cliente360/cliente360FechamentoAdapter.js    adapter da Fechamento API + reconciliação
services/cliente360/cliente360AdsService.js           adapter de Mercado Ads + status
services/cliente360/cliente360ResultadoService.js     orquestrador
services/cliente360/cliente360SimulacaoService.js     simulação server-side
services/cliente360/cliente360SerieService.js         série histórica p/ elasticidade
services/cliente360/cliente360PlacarService.js        placar operacional
services/cliente360/cliente360AcoesRepository.js      CRUD de ações
controllers/cliente360ResultadoController.js
routes/cliente360ResultadoRoutes.js
sql/cliente_360_acoes.sql
tests/cliente360Ponte.test.js
tests/cliente360Ads.test.js
tests/cliente360Capacidades.test.js
tests/cliente360Resultado.test.js
```

### Frontend

```
frontend-vue/package.json  vite.config.js  cliente-360-v2.html  .env.example
frontend-vue/scripts/clean-assets.mjs
frontend-vue/src/main.js  App.vue  styles/cliente360.css
frontend-vue/src/pages/Cliente360Page.vue  Cliente360Page.test.js
frontend-vue/src/components/cliente360/  (12 componentes .vue)
frontend-vue/src/composables/useCliente360.js  useCliente360Simulacao.js
frontend-vue/src/services/cliente360Api.js
frontend-vue/src/utils/currency.js  percentage.js  dates.js  cenario.js  (+ 2 testes)
Portal/cliente-360-v2.html                    (gerado pelo build)
Portal/assets/cliente-360-v2/*                (gerado pelo build)
```

## 7. Arquivos alterados

| Arquivo | Alteração | Por quê |
|---|---|---|
| `server/index.js` | +3 linhas: `require` do novo router e `app.use("/operacao/cliente-360", cliente360ResultadoRoutes)` antes do router legado | Montar as rotas novas. Só subcaminhos `/:slug/<sub>`, não colidem com o `/:slug` puro existente. |
| `server/services/ads/mlAdsService.js` | 3ª parâmetro opcional `janela = null` em `buscarPerformanceML`; `from`/`to` derivados dele | Permitir Ads do mês parcial no mesmo intervalo do fechamento. **Retrocompatível**: sem `janela`, o comportamento é idêntico ao anterior. Arquivo sensível (usa token ML) — alteração mínima, nenhuma mudança no fluxo de token/grant/renovação. |
| `server/package.json` | +script `test:cliente360` | Rodar a suíte da tela. |
| `Portal/layout.js` | +1 link "Cliente 360 V2" no grupo Operação; +1 entrada em `PAGE_TO_GROUP` | Acesso pelo menu. Nenhuma alteração no logout, no token, no colapso da sidebar nem nos demais links. |
| `.gitignore` | +3 linhas (`frontend-vue/node_modules`, `dist`, `.env.local`) | Não versionar artefatos locais. |

Nenhum arquivo de autenticação, refresh de token, provider de IA, CSS global legado ou integração estável foi tocado.

---

## 8. Testes

```bash
cd server        && npm run test:cliente360     # 194 verificações
cd frontend-vue  && npm test                    # 42 testes (Vitest)
cd frontend-vue  && npm run build               # build Vite
```

Cobertura do que não pode regredir:

1. ponte começa e termina no resultado operacional;
2. ponte não contém linha de Ads (nem quando se passa `ads0`/`ads1` ao motor);
3. ponte fecha com resíduo ≤ R$ 0,01 em 10 cenários;
4. Ads aparece somente no fechamento;
5. `tacos = ads / faturamento`;
6. `resultadoAposAds = resultadoOperacional − ads`;
7. Ads ausente/sem grant/com erro → `null`, nunca `0`;
8. falha em Ads não quebra a análise operacional;
9. nenhuma oportunidade com fator `ads`;
10. total recuperável = soma das oportunidades operacionais;
11. simulador ignora `adsNovo` e reporta o campo;
12. simulador mantém Ads fixo só para exibição;
13. placar não credita Ads e preserva o legado;
14. mês parcial compara o mesmo nº de dias (e Ads usa o intervalo parcial);
15. reconciliação detalhe × fechamento é exposta, sem forçar números;
16. produtos negativos continuam identificados;
17. build Vue funciona;
18. página funciona sem dados de Ads (render test: mostra “—”, não “R$ 0,00”);
19. página funciona sem placar (não-admin não vê a seção);
20. rotas legadas seguem passando (`centralVendas*`, `meli*`).

---

## 9. Limitações

- **Depende de dados reais para validação fim-a-fim.** Os testes usam repositórios fake; a integração com Postgres e com a API do Mercado Livre não foi exercitada aqui (exige `.env` com credenciais e um cliente com token ML/grant de `advertising`).
- **A tabela `cliente_360_acoes` precisa ser criada** antes de usar o placar: `psql ... -f server/sql/cliente_360_acoes.sql`. O repositório falha graciosamente (lista vazia) enquanto ela não existir — o placar aparece zerado, não quebra.
- **A ponte é do detalhe.** Se a Fechamento API divergir do detalhe por item sem origem identificável, a diferença aparece como divergência e a confiança cai para parcial; a ponte continua fechando sobre a base reconciliada.
- **Elasticidade precisa de histórico.** Menos de 3 competências com preços distintos → volume fixo no simulador, com aviso na tela.
- **O build precisa ser commitado.** `Portal/cliente-360-v2.html` e `Portal/assets/cliente-360-v2/` são artefatos versionados, porque o Portal é servido como pasta estática. Alterou `frontend-vue/`? Rode `npm run build` antes do commit.
- **Este documento não é versionado**: o `.gitignore` do projeto ignora `*.md` (convenção existente — toda a pasta `docs/` está fora do git).

---

## 10. Próximos passos para migrar outra página

1. Criar `frontend-vue/<nome-da-tela>.html` (entrada) e `src/pages/<Nome>Page.vue`.
2. Adicionar a entrada em `build.rollupOptions.input` do `vite.config.js` (vira um objeto com várias chaves).
3. Ajustar `scripts/clean-assets.mjs` para limpar também a pasta de assets da nova tela.
4. Reaproveitar `services/` e `utils/` — o cliente HTTP e os formatadores já servem qualquer tela.
5. Adicionar o link em `Portal/layout.js` **só depois** de confirmar o build.
6. Manter a página antiga no ar até a nova ser validada em produção; só então remover o arquivo legado e o link.

Quando **três ou quatro** páginas estiverem em Vue e começarem a compartilhar estado entre si (cliente selecionado, competência), aí sim vale reavaliar Vue Router e um store. Antes disso, cada página independente é mais simples e mais segura.
