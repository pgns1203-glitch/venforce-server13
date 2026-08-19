# Auditoria `/bases` Pós-Fundação Cliente/Contas

> Auditoria técnica, sem implementação funcional.
>
> Snapshot principal auditado: `origin/main` em `6b60ee3` (`Merge pull request #77 ... feat/full-fase-1-dominio-puro`), referência principal mais recente disponível localmente em 2026-08-19. O `main` local está em `e385aad` (`feat: finaliza contas e vinculos de base`) e é ancestral direto de `origin/main`. O worktree estava em `feat/full-gestao-navegacao` (`c44ddcb`), três commits à frente de `origin/main`; todos os arquivos-alvo de Bases/Cliente Contas/migration são idênticos a `origin/main`. As adições posteriores da branch ativa foram usadas apenas para identificar risco de consumidor e são sinalizadas quando aplicável.
>
> Limites: não houve checkout, merge, alteração de banco, execução de migration, commit ou mudança de código funcional. A migration de Cliente/Contas declara que ainda não foi validada contra o schema real de produção (`server/sql/migrations/20260817_cliente_contas_foundation.sql:6-14`); portanto, as conclusões de banco abaixo descrevem o contrato versionado no repositório, não uma inspeção do banco de produção.

## 1. Resumo executivo

A tela deixou de ser o upload simples descrito nas auditorias antigas. Ela já usa a Fundação Global V2, lista Mercado Livre, Shopee e TikTok Shop, oferece KPIs, busca, ordenação e chips, possui drawer de custos, edição/adição por upsert e atualização incremental por planilha sem apagar ausentes. Essas partes são reais e várias estão sólidas; não há justificativa para reescrever o drawer.

O bloqueio atual é de integridade e identidade operacional, não de aparência. A Fundação Cliente/Contas formalizou `cliente_conta_id`, mas `/bases` ainda seleciona apenas cliente e marketplace, serializa o vínculo sem identidade de conta e tenta vincular depois da importação por uma operação `best effort`. No cenário `Cliente X → ML 1 + ML 2`, o backend recusa a escolha implícita com `MULTIPLE_MARKETPLACE_ACCOUNTS`, porém o frontend engole o erro e mantém a mensagem de sucesso da importação. A base fica criada e sem vínculo.

Há cinco achados P0:

1. `POST /importar-base` trata colisão de slug como atualização, apaga todos os custos e reinsere o arquivo. “Importar nova base” pode substituir silenciosamente uma base existente e apagar itens ausentes.
2. Base, custos e vínculo não são atômicos. A UI confirma sucesso antes do vínculo; a falha é silenciosa.
3. O Assistente possui um segundo caminho de importação e pode importar ML sem exigir nem executar vínculo.
4. O legado `POST /base-vinculos` aceita marketplace manual e não compara `bases.marketplace` com a conta/vínculo, ao contrário de `PUT /cliente-contas/:id/base`.
5. `DELETE /bases/:...` é hard delete, não faz preflight e pode ser usado por usuário não admin que tenha `user_bases`; a importação atual concede a base a todos os usuários. Custos e vínculos sofrem cascade.

Recomendação executiva: não continuar refinamento de UX/UI antes do hardening. Recomenda-se iniciar imediatamente a preparação da correção P0 (contratos e testes), mas não liberar implementação de comportamento até aprovar a política de autorização, a cardinalidade Conta↔Base, a política TikTok e o tratamento de dados legados. A primeira entrega funcional deve proteger slug/importação, vínculo e delete; migração visual vem depois.

### Resultado das hipóteses

| Hipótese | Veredito | Síntese |
|---|---|---|
| H1 — `/bases` ainda usa `cliente_id + marketplace` | **CONFIRMADA** | O modal e o autovínculo enviam exatamente `{base_id, cliente_id, marketplace}`. O backend aceita `cliente_conta_id`, mas a tela não o usa. |
| H2 — a Fundação Cliente/Contas oferece API melhor | **PARCIALMENTE CONFIRMADA** | As cinco rotas existem e são account-aware para ML/Shopee, com bloqueio de mismatch; ainda há lacunas de cardinalidade/ativos, TikTok não pertence ao modelo e `/bases` não as usa. |
| H3 — marketplace não deveria ser escolhido manualmente | **CONFIRMADA** | `bases.marketplace` existe e é usado como fonte de compatibilidade na API nova. O legado permite mismatch. |
| H4 — ML pode importar com sucesso e falhar no vínculo | **CONFIRMADA** | Vínculo posterior, `best effort`, `catch` silencioso; 2+ contas causam 409 e a base permanece sem vínculo. |
| H5 — “Importar nova base” pode substituir uma existente | **CONFIRMADA** | `ON CONFLICT (slug) DO UPDATE` seguido por `DELETE FROM custos`. |
| H6 — `/base-vinculos` perde `cliente_conta_id` na leitura | **CONFIRMADA** | A escrita aceita/devolve o campo, mas `GET` não o seleciona nem serializa, e não traz conta/grant/external ID. |
| H7 — autorização diverge entre novo e legado | **CONFIRMADA** | `PUT /cliente-contas/:id/base` exige admin; POST/DELETE de `/base-vinculos` exigem apenas autenticação. |

## 2. Estado atual da tela

### Header

- Título e descrição: “Bases de Custo” / “Gerencie custos por cliente, marketplace e produto” (`Portal/bases.html:27-33`).
- Ação funcional: `Importar nova base` (`Portal/bases.html:39`).
- `Ajuste manual` existe no DOM, mas está `disabled` e `display:none`; o ajuste é acessível apenas depois de abrir uma base no drawer (`Portal/bases.html:35-38`).
- Não existe ação de header para escolher e atualizar uma base existente. A atualização incremental existe dentro do drawer.
- Assistente não compete mais como card principal; fica colapsado dentro do modal de importação (`Portal/bases.html:250-325`). Isso atende a intenção histórica.

### KPIs

Existem seis: Total, Mercado Livre, Shopee, TikTok Shop, Atualizadas e Desatualizadas +30d (`Portal/bases.js:252-270`).

Todos são calculados sobre `TODAS_BASES`, não sobre `getBasesFiltradas()` (`Portal/bases.js:255-261`). Logo, com 40 bases totais e busca mostrando 2, os KPIs continuam mostrando 40. O rótulo `Totais gerais` existe no HTML (`Portal/bases.html:48`) e nunca é alterado pelo JS. O comportamento é internamente honesto, mas não implementa a intenção antiga de alternar “Totais gerais” e “Refletindo filtros”.

Os KPIs de marketplace e atualização são botões e funcionam também como filtros (`Portal/bases.js:263-290`, `342-345`).

### Filtros e ordenação

| Recurso | Estado atual | Evidência |
|---|---|---|
| Busca | Implementada; base, slug e nomes/slugs de cliente/sugestão | `Portal/bases.js:238-249` |
| Marketplace | Implementado somente ao clicar KPI; não há select visível | JS procura `bases-filtro-marketplace`, mas o ID não existe no HTML (`Portal/bases.js:318-322`, `2150`) |
| Vínculo | Não existe | Não há estado, controle nem predicado de filtro |
| Atualização | Implementado somente ao clicar KPI; não há select visível | Mesmo padrão do marketplace |
| Ordenação | Implementada: atenção, antigas, recentes, A-Z | `Portal/bases.html:65-72`; `Portal/bases.js:208-231` |
| Chips | Implementados para busca, marketplace e atualização | `Portal/bases.js:294-315` |
| Status ativa/inativa | Não existe | `GET /bases` devolve `ativo`, mas a tabela não o usa |

### Tabelas por marketplace

#### Mercado Livre

- Colunas: “Cliente / Grant ML”, “Base oficial”, status de atualização e ações (`Portal/bases.html:100-107`).
- A identidade exibida é apenas `vinculo.cliente_nome`/`cliente_slug`; não há nome da conta, `cliente_conta_id`, `external_account_id` nem ML User ID (`Portal/bases.js:585-604`).
- O texto “Grant ML” é mais forte que o dado real apresentado.
- Não mostra cobertura apesar de `GET /bases` fornecer `total_skus` e `skus_com_custo`.

#### Shopee

- Colunas: Base, “Loja / apelido”, status de atualização e ações (`Portal/bases.html:123-131`).
- “Loja/apelido” é preenchido com nome/slug do cliente, não com `cliente_conta.nome` (`Portal/bases.js:638-658`).
- A hierarquia é insuficiente quando um cliente possui duas lojas Shopee.

#### TikTok Shop

- Colunas: Cliente, Base oficial, status e ações (`Portal/bases.html:147-155`).
- Mostra cobertura de SKUs sob a base (`Portal/bases.js:607-635`).
- A Fundação `cliente_contas` aceita somente `meli` e `shopee` (`clienteContaService.js:18`, migration:41-43); TikTok segue no vínculo legado e sua política de conta ainda não está definida.

#### Comum às três

- Marketplace é inferido da seção usando `bases.marketplace`, o que é correto.
- Status significa idade de atualização, não ativo/inativo (`Portal/bases.js:543-563`).
- As ações são abrir drawer, definir/alterar/remover vínculo, baixar CSV e excluir (`Portal/bases.js:566-582`, `675-705`).
- Bases inativas continuam vindo em `GET /bases` e não recebem distinção visual.

### Drawer de custos

**Boas/solidas:**

- Consulta autenticada `GET /bases/:slug`, com retry e retorno de foco ao botão de origem (`Portal/bases.js:1291-1301`, `1356-1390`).
- Contratos distintos de identidade: ML/Shopee por `produto_id`, TikTok por `sku_id`; Shopee exibe `id_model`; TikTok preserva IDs longos como texto (`Portal/bases.js:1366-1382`, `1455-1507`).
- Busca inclui produto, SKU, `sku_id`, `id_model` e nomes quando presentes (`Portal/bases.js:1405-1416`).
- Filtros custo/imposto/taxa zerado ou preenchido e destaque de zero (`Portal/bases.html:365-403`; `Portal/bases.js:1393-1403`, `1476-1497`).
- Limite de renderização de 500 itens com aviso; não tenta colocar milhares de linhas no DOM (`Portal/bases.js:1288`, `1455-1459`, `1539-1546`).
- Edição e adição usam upsert, preservando ausentes; backend valida marketplace e chaves (`Portal/bases.js:1713-1815`; `basesController.js:50-150`; `baseCustosService.js:234-340`).
- Atualização incremental não usa `/importar-base`, classifica adicionar/atualizar, informa preservados e nunca apaga itens ausentes (`Portal/bases.js:1819-2133`).
- TikTok tem cobertura de testes ampla; 213 verificações do teste relacionado passaram nesta auditoria.

**Aceitáveis:**

- A API devolve toda a base e só o DOM é limitado a 500. Para o volume atual isso pode ser aceitável, mas não é paginação de servidor.
- O preview incremental reutiliza o Assistente somente para parse/normalização, sem persistência, o que evita duplicar parser.

**Frágeis:**

- Atualização incremental dispara um `POST .../custos/upsert` sequencial por linha. Não há batch/transação, cancelamento nem idempotency key; uma queda gera atualização parcial. A UI contabiliza as falhas, portanto não é sucesso silencioso, mas não oferece rollback (`Portal/bases.js:2063-2133`).
- O drawer recebe só cliente, sem conta/grant; seu cabeçalho “Cliente / Grant ML” também perde a identidade operacional (`Portal/bases.js:1323-1335`).
- A busca e os filtros são client-side após baixar todos os custos.

**Perigosas:**

- Nenhuma operação do drawer é destrutiva por ausência: a atualização por planilha é segura nesse aspecto.
- O risco perigoso está na autorização ampla: as rotas de upsert exigem somente autenticação (`server/routes/basesRoutes.js:14-15`). A política deve ser alinhada com a futura política única de Bases, sem reescrever o drawer.

## 3. O que das auditorias antigas já foi resolvido

| Item histórico | Estado atual |
|---|---|
| Fundação visual global | Resolvida: tokens V2, componentes V2 e CSS escopado da página (`Portal/bases.html:9-16`; `bases-v2.css:1-21`). |
| Importação em modal | Resolvida. |
| Assistente secundário/colapsado | Resolvida. |
| Separação ML/Shopee | Resolvida e ampliada com TikTok. |
| KPIs Total/marketplaces/atualização | Resolvida parcialmente; seis KPIs existem. |
| Busca e chips | Resolvida. |
| Ordenação | Adicionada. |
| Drawer para conferir custos | Resolvida. |
| Limite visual de 500 | Resolvida. |
| Shopee `id_model` | Resolvida no drawer, preview e upsert. |
| Ajuste manual por upsert | Resolvido dentro do drawer. |
| Atualização incremental sem apagar ausentes | Resolvida funcionalmente no frontend por upserts individuais. |
| Contagem de itens em `GET /bases` | Resolvida com `total_skus`/`skus_com_custo` (`server/index.js:923-936`). |
| TikTok | Implementado com `sku_id` como identidade e testes extensos. |
| Estados loading/empty/error/retry | Implementados. |

## 4. O que ficou obsoleto

- A premissa “Bases V1 sem Fundação Global” não vale mais; a página já é piloto oficial V2.
- A premissa de apenas ML e Shopee não vale mais; TikTok é um contrato real de custo por `sku_id`.
- “Vínculo Shopee preparado para futuro” ficou obsoleto: `cliente_contas` já suporta Shopee e a tela `/clientes` já vincula base à conta Shopee.
- “Cliente + marketplace identifica a operação” ficou obsoleto. O código novo rejeita 2+ contas com `MULTIPLE_MARKETPLACE_ACCOUNTS`.
- “Atualização incremental depende de backend futuro” ficou parcialmente obsoleto: existe atualização segura por upserts, embora não atômica.
- “GET /bases não traz contagem” ficou obsoleto.
- “ML nasce vinculada se o frontend exigir cliente” é uma garantia inválida: a criação e o vínculo são requisições separadas.
- O plano antigo recomendava manter o modal legado de vínculo sem backend. Isso agora é incompatível com a identidade de conta.

## 5. Arquitetura atual de Cliente/Conta/Base

### Modelo versionado

```text
clientes
  id
   │
   ├── cliente_contas
   │     id
   │     marketplace ('meli' | 'shopee')
   │     nome / slug
   │     external_account_id
   │     is_primary / ativo
   │       │
   │       ├── ml_tokens.cliente_conta_id (nullable, ON DELETE SET NULL)
   │       └── base_cliente_vinculos.cliente_conta_id (nullable, ON DELETE SET NULL)
   │
   └── base_cliente_vinculos.cliente_id (legado/compatibilidade)
             │
             ├── marketplace (denormalizado/legado)
             └── base_id ── bases ── custos
```

- `bases.slug` é único; `bases.marketplace` é `NOT NULL DEFAULT 'meli'` no setup (`server/index.js:505-508`, `656-663`).
- `custos.base_id` referencia base com `ON DELETE CASCADE` (`server/index.js:514-519`).
- Existe no máximo um vínculo ativo por **base**, por índice parcial `uq_base_cliente_vinculos_base_ativo` (`server/index.js:539-541`).
- Não existe constraint equivalente de um vínculo ativo por `cliente_conta_id`.
- A migration tornou `cliente_conta_id` aditivo e nullable, preservando `cliente_id + marketplace` durante transição (`20260817_cliente_contas_foundation.sql:74-90`).
- O backfill só define conta quando existe exatamente uma conta ativa do marketplace; ambiguidades ficam registradas em `cliente_contas_pendencias` (`migration:191-237`).
- `cliente_contas` não armazena tokens; `ml_tokens` continua sendo a fonte de credenciais/grant.

### Rotas account-aware existentes (H2)

| Rota | Comportamento confirmado | Limites |
|---|---|---|
| `GET /clientes/:cliente/contas` | Lista conta + grant mascarado + base direta ou fallback legado único | Pode duplicar conta se houver múltiplos joins; TikTok fora do modelo |
| `GET /cliente-contas/:id` | Metadados sanitizados da conta | Não inclui grant/base |
| `GET /cliente-contas/:id/base` | Base direta; fallback legado só se conta única | `LIMIT 1` diante de múltiplos vínculos diretos |
| `GET /cliente-contas/:id/bases-elegiveis` | Filtra por `bases.marketplace` da conta | Inclui bases já ocupadas; UI informa ocupação |
| `PUT /cliente-contas/:id/base` | Deriva cliente/marketplace da conta e bloqueia mismatch | Não checa conta/base ativa; não desativa base anterior da conta |

Evidência principal: `server/routes/clienteContasRoutes.js:25-34`, `clienteContaService.js:91-203`, `445-517`; `clienteContasController.js:84-119`.

## 6. Achados P0

## [P0] “Importar nova base” substitui base por colisão de slug e apaga custos ausentes

### Evidência
- arquivo: `server/index.js:988-1107`.
- função/rota: `POST /importar-base`.
- comportamento encontrado: slug deriva exclusivamente de `nomeBase`; `INSERT INTO bases ... ON CONFLICT (slug) DO UPDATE` reutiliza a base, altera nome/marketplace/ativo e, em seguida, executa `DELETE FROM custos WHERE base_id = $1` antes de reinserir as linhas (`1038-1053`). O fluxo padrão do frontend se chama “Importar nova base” e não alerta colisão (`Portal/bases.html:39`, `199-204`; `Portal/bases.js:1165-1221`). O Assistente alerta que substituirá, mas usa a mesma rota destrutiva (`Portal/bases.js:2792-2818`).

### Cenário real
Base `extra_ml` tem 1.000 custos. O usuário escolhe “Importar nova base”, digita um nome que normaliza para `extra_ml` e envia 700 custos. O `ON CONFLICT` mantém o mesmo `base_id`, apaga os 1.000 custos e grava 700. Os 300 ausentes desaparecem. Se o marketplace informado mudou, `bases.marketplace` também muda, enquanto o vínculo anterior permanece.

### Impacto
Perda imediata de custos; alteração histórica in-place; consumidores por slug passam a ler o novo conjunto sem versão; relatórios/fechamentos futuros podem mudar. Uma base de outro cliente pode ser sobrescrita se o slug colidir.

### Causa raiz
O endpoint mistura três comandos de negócio: criar, substituir e reativar/renomear. Não existe modo explícito nem conflito 409 para a operação “criar”.

### Correção recomendada
Separar contratos. “Criar nova” deve fazer `INSERT` estrito e retornar `409 BASE_SLUG_ALREADY_EXISTS`. Substituição total deve ter endpoint/ação explícita, confirmação forte e autorização própria. Atualização incremental deve continuar sem `DELETE`. Nunca inferir a operação a partir de `ON CONFLICT`.

### Arquivos provavelmente envolvidos
- `server/index.js` (idealmente extrair para route/controller/service transacional).
- `Portal/bases.js`, `Portal/bases.html`.
- testes novos de importação.

### Risco de regressão
Alto: extensão, API pública, relatórios, Central de Vendas e automações dependem da estabilidade do slug. Não mudar o formato de `GET /api/bases/:baseSlug`.

### Testes necessários
- slug inexistente cria.
- slug existente em modo criar retorna 409 e preserva 1.000 custos.
- substituição explícita, se aprovada, apaga somente após confirmação e transação.
- atualização incremental 700/1.000 preserva os 300 ausentes.
- colisão de slug com marketplace diferente é bloqueada.

## [P0] Importação ML confirma sucesso antes de vínculo, falha silenciosamente e não seleciona conta

### Evidência
- arquivo: `Portal/bases.js:981-1048`, `1165-1221`; `server/index.js:988-1107`; `baseVinculosService.js:200-287`.
- função/rota: `tentarAutovinculoImport`, confirmação de preview, `POST /importar-base`, `POST /base-vinculos`.
- comportamento encontrado: o frontend exige apenas cliente para ML, não conta. A importação cria base+custos e mostra sucesso (`1195-1197`), recarrega bases e só depois chama autovínculo (`1210-1211`). `tentarAutovinculoImport` é explicitamente `best-effort`, só tenta base ainda sem vínculo e engole qualquer erro (`1029-1047`). Com 2+ contas, o backend lança 409 `MULTIPLE_MARKETPLACE_ACCOUNTS` (`clienteContaService.js:187-203`). O usuário não recebe o erro.

### Cenário real
Cliente X possui ML 1 e ML 2. A UI só mostra “Cliente X”. O usuário importa uma base ML. O backend não recebe `cliente_conta_id`; cria a base. O autovínculo chama o legado com cliente+ML, recebe 409 e o `catch` ignora. A tela já informou sucesso; a base fica sem vínculo. Se o slug já existia e tinha vínculo, `!b.vinculo` impede a troca e a base substituída continua na conta antiga.

### Impacto
Sucesso falso, base órfã ou custos novos presos à conta antiga, impossibilidade de saber qual operação ML recebeu a base. É problema de integridade operacional.

### Causa raiz
Criação e vínculo são duas transações independentes; o contrato de importação não conhece `cliente_conta_id`; a UI confunde cliente/grant com conta.

### Correção recomendada
Para ML (e Shopee quando account-aware for obrigatório), exigir conta explícita antes do preview e enviar `cliente_conta_id` ao backend. Confirmar base+custos+vínculo em uma única transação. Enquanto isso não existir, não declarar “base ML nasce associada”; se o vínculo falhar, a operação inteira deve falhar/rollback ou retornar estado parcial explícito que bloqueie sucesso.

### Arquivos provavelmente envolvidos
- `Portal/bases.html`, `Portal/bases.js`.
- novo service/controller de importação; `server/index.js` durante migração.
- `clienteContaService.js`/`baseVinculosService.js` apenas por composição, não duplicação.

### Risco de regressão
Alto: mudança no fluxo principal e em compatibilidade de importadores antigos. Preservar preview e parser por marketplace.

### Testes necessários
- ML com uma conta, conta explícita.
- ML com duas contas, escolha de ML 2 grava ML 2.
- vínculo falha: base e custos não permanecem.
- retry idempotente não cria duplicata.
- slug existente não reaproveita vínculo antigo.

## [P0] Assistente permite importação ML sem conta e sem autovínculo

### Evidência
- arquivo: `Portal/bases.js:2741-2845`.
- função/rota: `asstAtualizarBotaoImportar`, `asstImportarBaseLimpa`.
- comportamento encontrado: o botão do Assistente depende somente de dados normalizados e nome (`2741-2748`). A função usa o marketplace selecionado e chama `/importar-base` com `confirmar=true`, mas não valida `import-cliente`, não envia conta/cliente e não chama `tentarAutovinculoImport` (`2776-2830`).

### Cenário real
O operador escolhe ML, abre “Normalizar com assistente”, informa o nome e importa. Mesmo que nenhuma conta seja escolhida, a base ML é criada/substituída e fica sem vínculo. A validação do botão de preview padrão não protege o botão independente do Assistente.

### Impacto
Bypass direto da regra exibida pela própria tela (“ML nasce associada”), com base órfã e possível substituição destrutiva.

### Causa raiz
O Assistente normaliza e persiste por um segundo caminho de confirmação que não compartilha a validação/contrato do fluxo padrão.

### Correção recomendada
Assistente deve terminar no mesmo comando atômico de criação, com a mesma seleção de conta e mesmas proteções de slug; ele deve trocar apenas a etapa de parsing.

### Arquivos provavelmente envolvidos
- `Portal/bases.js`.
- endpoint transacional de importação.

### Risco de regressão
Médio: preservar normalização, CSV canônico e suporte TikTok.

### Testes necessários
- Assistente ML sem conta é bloqueado.
- Assistente ML com ML 2 vincula ML 2.
- Assistente Shopee/TikTok respeita política aprovada.
- colisão de slug não substitui em modo criar.

## [P0] Legado permite vínculo entre base e marketplace/conta incompatíveis

### Evidência
- arquivo: `Portal/bases.html:492-503`; `Portal/bases.js:837-916`; `server/services/baseVinculosService.js:208-287`; `clienteContaService.js:479-517`.
- função/rota: modal de vínculo, `criarVinculoManual`, `vincularBaseNaConta`.
- comportamento encontrado: o modal permite escolher marketplace manualmente e envia `{base_id, cliente_id, marketplace}`. `criarVinculoManual` resolve a conta, mas busca a base sem `marketplace` (`244-247`) e não compara `bases.marketplace` com `marketplaceFinal`. Mesmo com `cliente_conta_id` explícito, o legado não compara. A API nova faz a comparação e lança `BASE_MARKETPLACE_MISMATCH` (`clienteContaService.js:487-495`). Sugestão automática também detecta marketplace por nome/slug, não pela coluna da base (`baseVinculosService.js:53-67`, `103-109`).

### Cenário real
Uma base `bases.marketplace='meli'` pode ser ligada a uma conta Shopee pelo legado. Ou uma sugestão baseada no nome “Extra Shopee” preenche Shopee para uma base cuja coluna é ML; o backend legado aceita. Consumidores podem escolher normalizador e motor incorretos.

### Impacto
Vínculo com conta errada, custo aplicado em canal incorreto, estados diferentes conforme a tela usada.

### Causa raiz
Dois services de escrita com invariantes diferentes; marketplace ainda é tratado como entrada editável no legado.

### Correção recomendada
Centralizar a escrita em uma única função account-aware. `bases.marketplace` e `cliente_conta.marketplace` devem coincidir; o marketplace do vínculo deve ser derivado. O legado pode continuar aceitando cliente+marketplace temporariamente, mas precisa resolver conta sem ambiguidade e aplicar exatamente a mesma validação de base.

### Arquivos provavelmente envolvidos
- `server/services/baseVinculosService.js`.
- `server/services/clienteContas/clienteContaService.js`.
- `Portal/bases.html`, `Portal/bases.js`.

### Risco de regressão
Alto para vínculos antigos com marketplace incorreto. Antes de endurecer, gerar relatório de inconsistências e decidir correção de dados.

### Testes necessários
- base ML → conta Shopee bloqueada nos dois endpoints.
- base Shopee → conta ML bloqueada nos dois endpoints.
- payload legado com uma conta compatível funciona.
- sugestão não sobrepõe `bases.marketplace`.

## [P0] Hard delete compartilhado não possui guard rail de dependências

### Evidência
- arquivo: `server/index.js:1038-1052`, `1133-1180`; `Portal/bases.js:752-770`; `server/index.js:505-541`, `575-581`; `server/services/sellerService.js:65-82`.
- função/rota: `DELETE /bases/:baseId`.
- comportamento encontrado: delete físico direto `DELETE FROM bases`. Admin pode apagar qualquer base; não admin pode apagar se houver `user_bases`. Toda importação vincula a base a **todos** os usuários (`1042-1052`), ampliando o poder de delete. Não há checagem de vínculo com conta, custos, relatórios, Seller ou consumidores. FKs versionadas: `custos`, `user_bases` e `base_cliente_vinculos` fazem CASCADE; `relatorios.base_id` faz SET NULL; `seller_custos_submissoes.base_id` não declara ação e pode bloquear com erro 500.

### Cenário real
Um usuário autenticado importa ou recebe uma base compartilhada e pode excluí-la. Custos e vínculo da conta somem por cascade. Extensão armazenando o slug passa a receber 404. Relatórios mantêm `base_slug` textual e perdem `base_id`; Seller pode impedir o delete de forma não tratada.

### Impacto
Perda irreversível de custos/vínculos, indisponibilidade operacional e comportamento inconsistente conforme dependências existentes.

### Causa raiz
Modelo antigo de posse `user_bases` aplicado a um cadastro agora global/account-aware; ausência de service de dependências e política única de exclusão.

### Correção recomendada
Antes de qualquer delete, resolver dependências e autorização. No mínimo, bloquear com 409 e lista de dependências quando há vínculo ativo/conta/uso operacional. Preferir desativação lógica até decisão aprovada sobre hard delete. Não alterar a política silenciosamente: ver seção de decisões.

### Arquivos provavelmente envolvidos
- `server/index.js` ou novo service/controller de bases.
- tabelas/consumidores de dependência apenas para leitura/preflight.
- `Portal/bases.js` para mensagem de bloqueio.
- `extension/popup.js`, apenas se a política aprovada exigir ocultar a ação; não mudar extensão nesta rodada futura sem escopo.

### Risco de regressão
Alto: há uma ação equivalente na extensão (`extension/popup.js:735-762`). Hard delete pode estar sendo usado operacionalmente.

### Testes necessários
- usuário comum sem permissão não exclui.
- base com vínculo ativo retorna 409 sem apagar.
- base com custos/relatório/Seller retorna dependências coerentes.
- desativação não apaga custos/vínculo.
- hard delete administrativo, se mantido, exige política explícita e audita resultado.

## 7. Achados P1

## [P1] `GET /base-vinculos` apaga a identidade da conta e do grant na serialização

### Evidência
- arquivo: `server/services/baseVinculosService.js:116-188`, `308-323`.
- função/rota: `listarBasesComVinculos`, `mapearBaseComVinculo`, `desativarVinculoBase`.
- comportamento encontrado: a query não seleciona `v.cliente_conta_id`, não faz join em `cliente_contas`/`ml_tokens`, e `vinculo` devolve apenas cliente, marketplace, origem e data. A escrita de `criarVinculoManual` aceita e retorna `cliente_conta_id` (`263-279`), mas a leitura seguinte perde o campo. O DELETE também omite o campo no `RETURNING` (`315`).

### Cenário real
O estado real é Cliente Extra → Mercado Livre 2 → seller 123456789 → base `extra_ml_2`. `/bases` recebe apenas Cliente Extra + Mercado Livre e não consegue distinguir ML 1 de ML 2.

### Impacto
UI não consegue exibir, filtrar, auditar ou editar a identidade operacional; dois fluxos podem gravar corretamente e depois parecer iguais.

### Causa raiz
Contrato de leitura permaneceu no modelo pré-Cliente/Contas.

### Correção recomendada
Enriquecer de forma aditiva `vinculo` com `cliente_conta_id`, `conta_nome`, `conta_slug`, `external_account_id`, `grant.id`, `grant.ml_user_id`/status quando ML, sem tokens. Preservar campos legados para consumidores atuais.

### Arquivos provavelmente envolvidos
- `server/services/baseVinculosService.js`.
- `server/controllers/baseVinculosController.js`.
- testes de contrato.

### Risco de regressão
Baixo se apenas aditivo; médio se nomes atuais forem alterados. Não remover `cliente_id`/`marketplace`.

### Testes necessários
- serialização de ML 1 e ML 2 distintas.
- Shopee com nome/external ID.
- vínculo legado sem conta devolve `cliente_conta_id:null` e `conta:null`.
- nenhum token/segredo na resposta.

## [P1] Autorização diverge: escrita account-aware é admin-only, legado aceita qualquer autenticado

### Evidência
- arquivo: `server/routes/clienteContasRoutes.js:23-34`; `server/routes/baseVinculosRoutes.js:7-12`.
- função/rota: `PUT /cliente-contas/:id/base` versus `POST /base-vinculos` e `DELETE /base-vinculos/:baseId`.
- comportamento encontrado: a nova mutação usa `requireAdmin`; o router legado usa apenas `authMiddleware`. A tela `/bases` sempre oferece edição porque `VINCULOS_EDITAVEIS` inicia `true` e não é derivado da role (`Portal/bases.js:83-87`). Os testes confirmam a política admin-only nova, mas não comparam/bloqueiam o legado (`clienteContasGuards.test.js:70-79`).

### Cenário real
Um membro proibido de vincular pela tela `/clientes` consegue executar a operação equivalente por `/bases`.

### Impacto
Bypass de autorização e auditoria inconsistente.

### Causa raiz
Migração aditiva criou uma rota segura sem endurecer o caminho legado.

### Correção recomendada
Definir uma regra única aprovada e aplicá-la a ambos os endpoints e à UI. Recomendação técnica: mutação de vínculo/base e delete devem compartilhar middleware/policy; leitura operacional pode continuar para roles internas.

### Arquivos provavelmente envolvidos
- `server/routes/baseVinculosRoutes.js`.
- `server/routes/clienteContasRoutes.js`.
- `Portal/bases.js`.

### Risco de regressão
Médio/alto: usuários não admin podem depender do fluxo atual. Exige decisão de produto/segurança.

### Testes necessários
- matriz admin/user/membro nos dois endpoints.
- UI oculta/desabilita de acordo com o backend.
- tentativa direta por API retorna o mesmo 403.

## [P1] A API account-aware ainda não garante “uma base oficial por conta” nem ativo

### Evidência
- arquivo: `clienteContaService.js:445-517`; migration `20260817...sql:84-90`; setup `server/index.js:539-541`.
- função/rota: `vincularBaseNaConta`, `obterBaseDaConta`.
- comportamento encontrado: ao vincular, o service desativa vínculos anteriores da **base** (`497-500`), mas não o vínculo anterior da **conta**. O schema limita uma conta por base, não uma base por conta. `obterBaseDaConta` usa `LIMIT 1` sem ordenação no direto (`447-455`). `vincularBaseNaConta` lê `ativo` da base e toda a conta, porém não rejeita conta inativa nem base inativa.

### Cenário real
A conta ML 1 está na Base A. O usuário usa “Trocar base” e escolhe Base B. Base A continua ativa e vinculada à mesma conta; a conta passa a ter dois vínculos. Leitores com `LIMIT 1` podem escolher arbitrariamente e joins podem duplicar a conta.

### Impacto
Estados não determinísticos e divergência entre `/clientes`, `/bases`, Full e consumidores legados.

### Causa raiz
Cardinalidade não foi formalizada no schema/service; a UI assumiu “definir/trocar” singular.

### Correção recomendada
Primeiro aprovar cardinalidade. Se for 1:1 ativo, a transação deve desativar vínculo anterior da conta e impedir conta/base inativa; adicionar constraint compatível após saneamento. Se múltiplas bases por conta forem válidas, remover linguagem singular e fazer APIs devolverem coleção/determinismo.

### Arquivos provavelmente envolvidos
- `clienteContaService.js`.
- migration futura somente após auditoria de dados.
- `Portal/clientes.js` e consumidores.

### Risco de regressão
Alto: podem existir dados com múltiplos vínculos por conta; medir antes de impor constraint.

### Testes necessários
- “trocar” desativa A e ativa B atomicamente, se 1:1.
- conta/base inativa bloqueada.
- concorrência em duas trocas.
- listagem nunca duplica conta.

## [P1] Atualização incremental é segura contra delete, mas não é atômica

### Evidência
- arquivo: `Portal/bases.js:2061-2133`.
- função/rota: `confirmarPlanilhaDrawer`.
- comportamento encontrado: cada linha é persistida em uma requisição independente. Erros são contados e até dez detalhes são exibidos. Não há rollback do que já foi gravado.

### Cenário real
Uma planilha com 700 linhas atualiza 350 e a rede cai. A base fica parcialmente atualizada; o operador recebe contagem de falhas, mas repetir a planilha é a única recuperação.

### Impacto
Estado híbrido durante operações grandes, carga N+1 e recuperação manual.

### Causa raiz
Não existe endpoint batch transacional de upsert incremental.

### Correção recomendada
Preservar UI/preview e adicionar endpoint batch que valide todo o lote e execute uma transação, retornando adicionados/atualizados/ignorados/erros. Se o produto aceitar parcial, declarar modo e idempotência explicitamente.

### Arquivos provavelmente envolvidos
- novo route/controller/service de custos batch.
- `Portal/bases.js` apenas para trocar a confirmação por uma chamada.

### Risco de regressão
Médio: parsers e chaves ML/Shopee/TikTok devem permanecer idênticos ao upsert atual.

### Testes necessários
- 1.000 linhas em uma transação.
- erro na linha N não deixa N-1 gravadas no modo atômico.
- ausentes preservados.
- duplicatas TikTok/ML/Shopee seguem regras atuais.

## [P1] Consumidores legados ainda resolvem base por cliente+marketplace ou slug

### Evidência
- arquivo/função:
  - `automacoes/contextoPrecificacaoService.js:55-68`: ML por `v.cliente_id + v.marketplace`.
  - `centralVendasSyncService.js:113-143` e `centralVendasImportService.js:82-123`: base ML mais recente do cliente, `LIMIT 1`.
  - `cliente360Repository.js:44-71`: bases e grant por cliente; grant usa principal/recente.
  - `sellerService.js:182-193`: base mais recente do cliente, sem marketplace.
  - `baseCustosService.js:389-419`: fallback financeiro por cliente+marketplace; base explícita ML/Shopee confere apenas se ativa.
  - `operacaoService.js:10-67` e `dashboardService.js:288-304`: agregam por cliente.
  - `fullController.js` em `origin/main`: Central Full exige `clienteContaId` e resolve contexto account-aware.
- comportamento encontrado: coexistem consumidores account-aware e account-unaware. O próprio `fullCommercialAdapter.js:10-23` documenta que Central de Vendas/Cliente 360 não provam linhagem de conta.

### Cenário real
Cliente X tem ML 1/Base A e ML 2/Base B. Central Full consegue receber uma conta explícita; Central de Vendas pode escolher a base vinculada mais recentemente ao cliente e o grant principal/recente, cruzando operações distintas.

### Impacto
A correção visual de `/bases` não resolve sozinha o contexto dos consumidores. Remover campos legados quebraria vários serviços; manter ambiguidade perpetua risco de conta errada.

### Causa raiz
Fundação aditiva, sem migração coordenada de todos os resolvedores.

### Correção recomendada
Preservar `cliente_id`, `marketplace`, slug e APIs atuais. Adicionar `cliente_conta_id` de forma incremental aos consumidores account-sensitive, começando pelos que cruzam grant/base. Não incluir essa migração inteira no PR de `/bases`.

### Arquivos provavelmente envolvidos
- services listados acima, em PRs próprios.
- contratos de fechamento/central/full.

### Risco de regressão
Muito alto: fórmulas financeiras não devem ser alteradas; só a resolução de contexto pode mudar, com fixtures por conta.

### Testes necessários
- duas contas ML com bases distintas em cada consumidor.
- grant e base devem pertencer ao mesmo `cliente_conta_id`.
- fallback legado apenas com zero/uma conta, nunca com duas.

## [P1] API pública por slug não valida que a base pertence ao cliente da API key

### Evidência
- arquivo: `server/index.js:878-921`.
- função/rota: `GET /api/bases/:baseSlug`.
- comportamento encontrado: `apiKeyMiddleware` resolve `req.cliente`, mas a busca da base filtra somente `slug` e `ativo`; `base_cliente_vinculos` não participa. O cliente aparece apenas no log de callback.

### Cenário real
Uma API key de Cliente A que conheça o slug ativo de Cliente B consegue solicitar seus custos.

### Impacto
Risco de isolamento de dados. Ao mesmo tempo, a rota é contrato público/legado e foi explicitamente colocada fora do escopo de mudança.

### Causa raiz
Contrato histórico por slug global anterior ao vínculo account-aware.

### Correção recomendada
Não alterar no PR de Bases. Abrir revisão de segurança/compatibilidade própria, inventariar clientes da API e criar versão ou opt-in com escopo de vínculo/conta. Preservar formato do payload.

### Arquivos provavelmente envolvidos
- `server/index.js`, middleware de API key e consumidores externos, em iniciativa separada.

### Risco de regressão
Crítico: clientes externos podem depender de slug não vinculado. Exige decisão e rollout versionado.

### Testes necessários
- key A/base A permitido; key A/base B negado na versão nova.
- contrato antigo preservado até migração.
- nenhum dado de conta/token exposto.

## 8. Achados P2

## [P2] Filtros visíveis estão incompletos e não conhecem conta

### Evidência
- arquivo: `Portal/bases.html:52-79`; `Portal/bases.js:76-81`, `234-250`, `318-345`, `2140-2152`.
- função/rota: estado de filtros e toolbar.
- comportamento encontrado: HTML mostra busca, refresh, ordenação e limpar. Marketplace/atualização só são acionáveis por KPI; IDs de selects referenciados no JS não existem. Não há filtro de vínculo, conta, ativo ou pendência.

### Cenário real
Operador quer “bases ML sem conta definida” ou “ML 2”; não consegue filtrar. Busca por `external_account_id`/ML User ID também é impossível porque a API não os fornece.

### Impacto
Operação lenta e baixa auditabilidade depois de múltiplas contas.

### Causa raiz
Implementação parcial do plano histórico e contrato de vínculo empobrecido.

### Correção recomendada
Depois do contrato account-aware, adicionar filtros reais por marketplace, vínculo/conta, atualização e estado; manter chips. Não criar filtro visual antes de a API fornecer identidade confiável.

### Arquivos provavelmente envolvidos
- `Portal/bases.html`, `Portal/bases.js`, `bases-v2.css` apenas se necessário.

### Risco de regressão
Baixo, se client-side e aditivo.

### Testes necessários
- filtros isolados/combinados e chips.
- conta ML 1 versus ML 2.
- sem conta definida.

## [P2] KPIs permanecem globais e o escopo nunca muda

### Evidência
- arquivo: `Portal/bases.js:252-292`; `Portal/bases.html:48`.
- função/rota: `renderBasesSummary`.
- comportamento encontrado: KPIs usam `TODAS_BASES`; `bases-kpi-scope` fica sempre “Totais gerais”.

### Cenário real
40 bases, busca exibe 2: KPI mostra 40. Não é mentira porque o rótulo é global, mas não há visão dos 2 resultados.

### Impacto
Desalinhamento com a intenção antiga “Refletindo filtros”; menor utilidade operacional.

### Causa raiz
Decisão implícita por KPIs globais durante implementação.

### Correção recomendada
Aprovar uma das duas opções: manter KPIs globais e adicionar contagem filtrada clara, ou recalcular sobre `getBasesFiltradas()` e alternar o rótulo. Evitar comportamento híbrido.

### Arquivos provavelmente envolvidos
- `Portal/bases.js`, possivelmente `Portal/bases.html`.

### Risco de regressão
Baixo.

### Testes necessários
- 40→busca 2 com expectativa aprovada.
- clique de KPI + busca combinados.

## [P2] Tabelas e drawer usam rótulos de conta/grant, mas exibem somente cliente

### Evidência
- arquivo: `Portal/bases.html:103`, `127-128`; `Portal/bases.js:585-658`, `1328-1335`.
- função/rota: builders de linha e metadados do drawer.
- comportamento encontrado: “Cliente / Grant ML” e “Loja / apelido” vêm de `cliente_nome/slug`.

### Cenário real
Cliente Extra com ML 1 e ML 2 gera duas linhas visualmente indistinguíveis; nenhuma mostra seller 123456789.

### Impacto
Operador pode editar/excluir/vincular a base errada por falta de contexto.

### Causa raiz
Frontend refletiu semântica futura sem receber os campos necessários.

### Correção recomendada
Após enriquecer API, exibir hierarquia Cliente → Conta → external ID/grant → Base. Até lá, usar rótulo honesto “Cliente”, não “Grant”.

### Arquivos provavelmente envolvidos
- `Portal/bases.js`, `Portal/bases.html`.

### Risco de regressão
Baixo visual; dependente do P1 de serialização.

### Testes necessários
- snapshots/DOM para duas contas do mesmo marketplace.
- fallback legado “Conta não definida”.

## [P2] Header não expõe ajuste manual nem atualização existente

### Evidência
- arquivo: `Portal/bases.html:34-40`; drawer `349-353`.
- função/rota: ações da página.
- comportamento encontrado: ajuste manual de header está oculto; atualização incremental só aparece dentro da base.

### Cenário real
Usuário precisa descobrir o ícone de lápis para então acessar as operações maduras do drawer.

### Impacto
Descoberta e eficiência, sem risco de dados.

### Causa raiz
Entrega do drawer não atualizou a hierarquia de ações do header.

### Correção recomendada
Depois dos P0/P1, decidir se o header abre seletor de base ou se o drawer continua sendo o único contexto. Não duplicar formulários.

### Arquivos provavelmente envolvidos
- `Portal/bases.html`, `Portal/bases.js`.

### Risco de regressão
Baixo.

### Testes necessários
- ação reutiliza o mesmo drawer/formulário.
- nenhuma segunda implementação de upsert.

## 9. Achados P3

Nenhum refinamento visual isolado justifica prioridade antes dos P0/P1/P2. A página já usa a Fundação Global V2 e CSS escopado. Melhorias de foco preso em modal/drawer, microcopy e redução de estilos inline podem ser tratadas depois, sem misturá-las ao hardening.

## 10. Fluxo atual de importação

### Padrão

```text
Marketplace
  → Cliente (obrigatório somente no frontend para ML)
  → Nome
  → Arquivo
  → POST /importar-base sem confirmar (preview, 10 linhas)
  → usuário confirma
  → POST /importar-base confirmar=true
       BEGIN
       UPSERT bases por slug
       associa base a todos user_bases
       DELETE todos os custos
       INSERT/UPSERT custos
       COMMIT
  → frontend mostra sucesso
  → GET /bases + GET /base-vinculos
  → POST /base-vinculos (best effort, fora da transação)
```

O backend de importação não recebe cliente nem conta. Base+custos estão na mesma transação, mas vínculo não. O preview não reserva slug nem carrega um token de importação; a confirmação reenvia e reparsa o arquivo.

### Assistente

```text
Arquivo fora do padrão
  → POST /bases/assistente/preview
  → gera CSV normalizado no browser
  → confirmação explícita de que substituirá nome existente
  → POST /importar-base confirmar=true
  → sem validação/seleção/vínculo de conta
```

### Semânticas hoje

| Operação desejada | Implementação atual | Avaliação |
|---|---|---|
| Criar nova base | `/importar-base` com upsert por slug | Perigosa: pode substituir |
| Atualizar base existente (substituição total) | Mesmo endpoint, sem modo explícito no fluxo padrão | Perigosa |
| Atualização incremental | Drawer → N upserts | Não apaga ausentes; frágil por não atomicidade |
| Ajuste manual | Drawer → 1 upsert | Sólido |

## 11. Fluxo atual de vínculo

### `/bases`

```text
Base
  → select Cliente
  → select Marketplace manual
  → POST /base-vinculos
       se cliente_conta_id ausente:
         0 contas: vínculo legado sem conta
         1 conta ativa: resolve/grava conta automaticamente
         2+ contas: 409 MULTIPLE_MARKETPLACE_ACCOUNTS
```

Payload confirmado:

```json
{
  "base_id": 123,
  "cliente_id": 45,
  "marketplace": "meli"
}
```

O controller aceita `cliente_conta_id`, mas a tela nunca o envia (`baseVinculosController.js:34-42`; `Portal/bases.js:895-905`).

### `/clientes`

```text
Cliente
  → Conta explícita
  → GET bases-elegiveis do marketplace da conta
  → PUT /cliente-contas/:id/base { base_id }
  → backend deriva cliente + marketplace
  → bloqueia mismatch
```

Esse é o fluxo conceitualmente correto, com as lacunas de ativo/cardinalidade descritas no P1.

## 12. Riscos de delete

### Natureza

- `DELETE /bases/:...` é físico.
- Existe alternativa lógica `POST /bases/:baseId/desabilitar`, mas a tela `/bases` oferece hard delete; a extensão oferece ambos.

### Dependências do schema versionado

| Dependência | Efeito observado/esperado pelo DDL |
|---|---|
| `custos.base_id` | CASCADE: custos apagados |
| `user_bases.base_id` | CASCADE |
| `base_cliente_vinculos.base_id` | CASCADE: conta perde a base |
| `relatorios.base_id` | SET NULL; `base_slug` textual permanece |
| `seller_custos_submissoes.base_id` | Sem `ON DELETE`; PostgreSQL tende a RESTRICT/NO ACTION, resultando 500 atual |
| callbacks/scans/promocoes e snapshots por `base_slug` | Sem FK; referências históricas permanecem órfãs |
| extensão | slug armazenado passa a 404 |
| API pública/interna | slug passa a 404 |
| Central/Motor/Cliente 360 | próxima resolução perde base; snapshots textuais podem continuar |

Não existe preflight. Uma base vinculada a `cliente_conta` pode ser excluída diretamente; o cascade remove `base_cliente_vinculos`, e `GET /cliente-contas/:id/base` passa a retornar vazio.

### Guard rail mínimo recomendado

Sem decidir hard versus soft delete nesta auditoria: implementar leitura de dependências, 409 estruturado e regra única de autorização antes de permitir hard delete. A desativação deve ser avaliada como padrão porque preserva custos e histórico, mas a decisão final precisa de aprovação.

## 13. Consumidores e contratos que não podem quebrar

### Contratos a preservar

1. **Slug e `GET /api/bases/:baseSlug`:** formato `{ok, baseId, nome, marketplace, total, dados}` e mapa de custos por produto. Não mudar nesta correção.
2. **`GET /bases/:slug`:** extensão, drawer e download consomem `dados`; TikTok usa chave `sku_id`, ML/Shopee usam produto.
3. **Custos:** `custo_produto`, `imposto_percentual`, `taxa_fixa`, `id_model`, `sku_id` e distinção null/zero.
4. **Campos legados do vínculo:** `cliente_id` e `marketplace` ainda alimentam muitos consumidores. Podem virar derivados, não ser removidos.
5. **`base_id` + `base_slug` históricos:** relatórios e diagnósticos persistem ambos ou slug textual.

### Consumidores relevantes

- **Extensão:** `extension/content.js:242-276` carrega `GET /bases/:slug`; popup lista/desabilita/exclui bases (`extension/popup.js:689-772`).
- **Motor/Central de Margem:** `contextoPrecificacaoService.js` resolve ML por cliente+marketplace; Motor recebe o contexto e não deve ter fórmulas alteradas.
- **Fechamentos ML/Shopee/TikTok:** `fechamentosFinanceiroController.js:263-279` usa `buildCostRowsFromBase`; chaves de custo por marketplace são críticas.
- **Central de Vendas:** seleciona a base ML mais recente do cliente (`centralVendasSyncService.js:113-143`; `centralVendasImportService.js:82-123`).
- **Cliente 360:** bases e grant ainda são cliente-scoped (`cliente360Repository.js:44-97`).
- **Central Full em `origin/main`:** API recebe `clienteContaId` e chama `resolveMarketplaceAccountContext`; não aceita fallback silencioso entre contas (`fullController.js:91-194`; `fullMlGateway.js:3-6`).
- **Seller:** resolve base mais recente por cliente sem marketplace e `seller_custos_submissoes` referencia base (`sellerService.js:65-82`, `182-193`).
- **Dashboard/operação:** cobertura e readiness agregam por `cliente_id`/marketplace.
- **APIs públicas/internas:** `/api/bases/:slug` e `/bases/:slug`.
- **Relatórios/financeiro:** snapshots guardam slug/base id; hard delete não pode pressupor ausência de histórico.

### Estratégia de compatibilidade

Adicionar identidade de conta de forma aditiva; nunca renomear/remover campos legados no mesmo PR. O vínculo deve continuar gravando `cliente_id` e `marketplace` derivados para que consumidores atuais funcionem enquanto migram. Não alterar fórmulas nem normalizadores.

## 14. Testes existentes e testes faltantes

### Testes executados nesta auditoria

Passaram:

- `baseVinculosClienteConta.test.js`: 9 verificações.
- `clienteContaService.test.js`: 20 verificações.
- `clienteContasBasePicker.test.js`: 15 verificações, incluindo rota HTTP local.
- `clienteContasGuards.test.js`: 25 verificações.
- `clienteContasPermissoes.test.js`: 19 verificações incluindo ausência de tokens.
- `basesTiktok.test.js`: 213 verificações.
- `modeloBaseCustos.test.js`: passou.

O teste HTTP precisou de execução fora do sandbox apenas para abrir porta efêmera local; não acessou serviço externo nem banco real.

### Cobertura existente

- uma conta ML/Shopee resolve vínculo legado e grava `cliente_conta_id`.
- duas contas do mesmo marketplace geram `MULTIPLE_MARKETPLACE_ACCOUNTS` sem escrita.
- `clienteContaId` explícito deriva cliente/marketplace.
- mismatch ML↔Shopee é bloqueado na API nova.
- bases elegíveis filtram `bases.marketplace`.
- permissões da API nova e mascaramento de tokens.
- migration aditiva e backfill ambíguo.
- parsing/upsert/schema/frontend TikTok e não regressão ML/Shopee.

### Lacunas importantes

- nenhum teste executa o fluxo completo de `POST /importar-base` com banco/transação.
- nenhum teste protege contra colisão de slug e `DELETE FROM custos` no modo “criar”.
- nenhum teste cobre importação ML + conta explícita + vínculo atômico.
- nenhum teste cobre erro de vínculo depois da importação ou sucesso falso no frontend.
- mismatch não é testado no endpoint legado `/base-vinculos`.
- autorização divergente legado versus novo não é testada.
- serialização de `/base-vinculos` não é testada para conta/grant.
- atualização incremental é principalmente verificada por estrutura/código; não há integração de lote parcial/rollback.
- delete de base, cascades, dependências e roles não têm cobertura dedicada.
- não há teste de uma base oficial por conta/troca de base.

### Matriz mínima obrigatória

| # | Cenário | Situação atual |
|---|---|---|
| 1 | cliente com 1 conta ML | Coberto no service legado |
| 2 | cliente com 2 contas ML | Coberto para rejeição legado; falta UI/importação/seleção explícita |
| 3 | cliente com 1 conta Shopee | Coberto no service |
| 4 | base ML → conta Shopee | Coberto só na API nova; falta legado |
| 5 | base Shopee → conta ML | Coberto só na API nova; falta legado |
| 6 | importação ML com conta explícita | Ausente |
| 7 | importação com erro de vínculo | Ausente |
| 8 | slug já existente | Ausente |
| 9 | incremental sem apagar ausentes | Falta integração/batch; lógica client-side existe |
| 10 | vínculo em `/bases` aparece em `/clientes` | Coberto para conta única; falta conta explícita/múltipla |
| 11 | vínculo em `/clientes` aparece em `/bases` | Parcial; falta afirmar serialização da conta |

Testes adicionais obrigatórios: delete com vínculo/dependências; autorização uniforme; conta/base inativa; duas bases na mesma conta; Assistente ML; zero vazamento de token no endpoint enriquecido.

## 15. Arquitetura alvo recomendada

### Identidade oficial do vínculo

Para marketplaces cobertos por `cliente_contas`, a identidade oficial deve ser:

```text
base_cliente_vinculos.id             — identidade técnica da linha/histórico
base_cliente_vinculos.base_id        — base vinculada
base_cliente_vinculos.cliente_conta_id — fonte de verdade operacional
```

Campos derivados/compatibilidade:

```text
cliente_id  = cliente_contas.cliente_id
marketplace = cliente_contas.marketplace
```

`bases.marketplace` é a fonte de verdade do canal da base e deve ser igual a `cliente_contas.marketplace`. `base_cliente_vinculos.marketplace` pode continuar persistido para compatibilidade/auditoria, mas deve ser derivado e validado; nunca escolhido manualmente quando há conta.

Grant/identidade externa não deve ser copiado para o vínculo:

```text
base vínculo → cliente_conta
cliente_conta.external_account_id
cliente_conta → ml_tokens (grant atual)
```

Custos continuam pertencendo somente à base. Não duplicar custos por cliente/conta.

Para legado sem conta:

- permitir `cliente_conta_id = null` apenas em modo compatível e explicitamente marcado;
- resolver automaticamente somente quando há exatamente uma conta ativa compatível;
- nunca escolher entre 2+;
- expor “Conta não definida” na API/UI.

TikTok precisa de decisão: hoje não é aceito em `cliente_contas`; não inventar `cliente_conta_id` TikTok neste PR.

### O que `/bases` deve vincular

Escolha recomendada: **B — Base → Cliente → Conta**, com marketplace derivado e validado.

Justificativa no código:

- `resolveMarketplaceAccountContext` e `resolverContaParaVinculoLegado` já recusam ambiguidade.
- `vincularBaseNaConta` já deriva cliente/marketplace e bloqueia mismatch.
- Central Full já exige conta explícita.
- `/clientes` já implementa o picker por conta.
- O fluxo A não distingue ML 1/ML 2 e já produz 409 no backend.

### Contrato de leitura recomendado (aditivo)

Exemplo mínimo:

```json
{
  "id": 10,
  "slug": "extra_ml_2",
  "nome": "Extra ML 2",
  "marketplace": "meli",
  "vinculo": {
    "id": 99,
    "base_id": 10,
    "cliente_id": 7,
    "cliente_nome": "Extra",
    "cliente_slug": "extra",
    "cliente_conta_id": 42,
    "conta_nome": "Mercado Livre 2",
    "conta_slug": "extra-meli-2",
    "marketplace": "meli",
    "external_account_id": "123456789",
    "grant": {
      "id": 123,
      "ml_user_id": "123456789",
      "token_status": "valid"
    },
    "origem": "conta"
  }
}
```

Nunca incluir `access_token` ou `refresh_token`.

### Fluxo alvo de importação

```text
CRIAR NOVA BASE
  → Marketplace
  → Cliente
  → Conta ativa daquele marketplace
  → Nome/slug (checagem de disponibilidade)
  → Planilha
  → Preview ligado ao marketplace + hash/token do arquivo
  → confirmação
  → BEGIN
       validar conta ativa e pertencente ao cliente
       INSERT estrito da base (colisão = 409)
       INSERT custos
       INSERT vínculo com cliente_conta_id
       user_bases/auditoria, conforme política aprovada
     COMMIT
  → resposta única com base + vínculo + contagens
```

Base+custos+vínculo precisam estar na mesma transação para ML e para qualquer marketplace cuja operação exija conta. Sem mudança de backend isso não é possível; o frontend não consegue oferecer atomicidade entre duas requisições.

```text
ATUALIZAR BASE — SUBSTITUIÇÃO TOTAL
  → ação separada, base explícita
  → preview de removidos/adicionados/alterados
  → confirmação destrutiva forte
  → transação
```

```text
UPSERT INCREMENTAL
  → base explícita no drawer
  → preview adicionar/atualizar/preservar
  → batch transacional ou modo parcial explicitamente aprovado
  → nunca apagar ausentes
```

O Assistente deve trocar somente o parser; todos os três fluxos devem terminar nos mesmos comandos de domínio.

## 16. Plano incremental de correção

### PR 0 — Testes de caracterização e inventário de dados

- objetivo: congelar contratos e provar inconsistências antes de mudar comportamento.
- arquivos: novos testes em `server/tests`; scripts/read-only de diagnóstico se aprovados.
- alterações: testes para import slug, legado mismatch, vínculo serializado, delete/dependências, cardinalidade da conta.
- dependências: nenhuma mudança de produto.
- risco: baixo.
- rollback: remover apenas testes/diagnóstico.

### PR 1 — Guard rails P0 sem redesenho

- objetivo: impedir perda imediata e mismatch.
- arquivos: `server/index.js`/novo service de importação, `baseVinculosService.js`, rota/delete service, testes.
- alterações: criar estrito retorna 409 em slug existente; legado aplica validação de marketplace; falha de vínculo deixa de ser silenciosa; delete faz preflight/autoriza conforme decisão.
- testes: slug 1.000→700 preservado; mismatch nos dois endpoints; import sem vínculo não retorna sucesso; delete com dependência bloqueia.
- dependências: aprovação temporária de autorização/delete.
- risco: médio/alto por bloquear comportamentos antes permitidos.
- rollback: feature flag/modo de compatibilidade explícito, nunca reativar delete silencioso.

### PR 2 — Contrato account-aware aditivo para Bases

- objetivo: uma leitura/escrita canônica sem quebrar consumidores.
- arquivos: `baseVinculosService.js`, controllers/routes, `clienteContaService.js`, testes.
- alterações: enriquecer serialização; unificar função de vínculo; validar ativo; resolver cardinalidade aprovada; preservar campos legados derivados.
- testes: ML 1/ML 2, Shopee, fallback legado, sem tokens, cruzamento `/bases`↔`/clientes`.
- dependências: decisão 1:1 versus 1:N; saneamento de dados.
- risco: alto se houver inconsistência legada.
- rollback: retorno aditivo pode ser revertido; não aplicar constraint antes de relatório/backfill.

### PR 3 — Migração do frontend `/bases` para conta explícita

- objetivo: Base → Cliente → Conta, sem marketplace manual.
- arquivos: `Portal/bases.html`, `Portal/bases.js`, CSS apenas se necessário.
- alterações: carregar contas após cliente/marketplace, exibir conta/external ID/grant, enviar `cliente_conta_id`, mostrar “Conta não definida” legado.
- testes: DOM/fluxo para duas contas do mesmo marketplace; erros 409/422; permissões.
- dependências: PR 2.
- risco: médio.
- rollback: manter endpoint legado no backend; frontend anterior pode ser restaurado sem perder dados novos.

### PR 4 — Importação atômica

- objetivo: comando único base+custos+vínculo.
- arquivos: novo route/controller/service; `Portal/bases.js`; testes de transação.
- alterações: endpoint de criação estrita com `cliente_conta_id`; preview/token/hash; Assistente reutiliza o mesmo comando; rollback completo em erro.
- testes: cenários 1-8 da matriz, concorrência e retry.
- dependências: PR 2/3 e política de conta por marketplace.
- risco: alto; fluxo crítico.
- rollback: manter endpoint antigo somente para compatibilidade interna, sem expô-lo como “criar nova”; feature flag da UI.

### PR 5 — Upsert incremental batch

- objetivo: manter a UX atual e remover parcialidade/N+1.
- arquivos: novo endpoint batch, `baseCustosService.js`, `Portal/bases.js`, testes ML/Shopee/TikTok.
- alterações: validação total e transação; resposta com contagens/amostra de erros.
- dependências: nenhuma visual; reutilizar normalizadores existentes.
- risco: médio.
- rollback: voltar aos upserts individuais, que não apagam ausentes, deixando aviso de parcialidade.

### PR 6 — UX operacional e KPIs

- objetivo: filtros completos, escopo KPI aprovado, identidade nas tabelas e header coerente.
- arquivos: somente frontend/CSS da tela.
- alterações: filtros de conta/vínculo/estado, ações reutilizando drawer, microcopy honesta.
- dependências: PR 2/3.
- risco: baixo.
- rollback: frontend somente.

### PRs posteriores — consumidores

Migrar Central de Vendas, Cliente 360, Seller, Motor/fechamentos e APIs internas para `cliente_conta_id` em entregas separadas, sem alterar fórmulas. Não remover compatibilidade legado até todos os consumidores e dados estarem migrados.

## 17. Decisões que precisam de aprovação

1. **Cardinalidade Conta↔Base:** uma conta tem uma única base oficial ativa ou múltiplas bases? A UI e `obterBaseDaConta` assumem singular; schema não garante.
2. **Autorização única:** apenas admin pode importar, vincular, editar custos e excluir/desativar, ou haverá permissão operacional específica para user/membro?
3. **Delete:** hard delete será removido da operação comum, mantido só para admin com preflight, ou substituído por soft delete?
4. **TikTok e `cliente_contas`:** continuará base independente/legada ou ganhará conta TikTok em fase própria? A migration atual proíbe TikTok.
5. **Shopee:** vínculo account-aware será obrigatório na criação ou continuará opcional durante transição?
6. **Dados legados ambíguos:** política de saneamento para vínculos `cliente_conta_id IS NULL`, mismatches e possíveis múltiplas bases por conta.
7. **Substituição total:** o produto realmente precisa de uma ação destrutiva separada? Se sim, qual autorização, preview e retenção/histórico?
8. **KPIs:** globais com contagem filtrada separada ou refletindo filtros?
9. **API pública `/api/bases/:slug`:** manter escopo global por compatibilidade ou criar versão client/account-scoped? Não mudar sem inventário externo.
10. **`user_bases`:** ainda representa posse/autorização ou é legado incompatível com bases globais por conta?
11. **Migration/produção:** confirmar schema real, pendências do backfill e constraints antes de qualquer migration adicional.

## 18. Checklist de aceite futuro

- [ ] “Criar nova base” nunca altera slug existente.
- [ ] Substituição total, se existir, é ação separada e explícita.
- [ ] Atualização incremental nunca apaga ausentes.
- [ ] ML com 2 contas exige seleção explícita e grava a conta escolhida.
- [ ] Base+custos+vínculo são atômicos nos marketplaces que exigem conta.
- [ ] Assistente usa o mesmo comando/validações da importação padrão.
- [ ] Marketplace não é escolhido manualmente no vínculo account-aware.
- [ ] Mismatch base/conta é bloqueado em todos os caminhos.
- [ ] `/base-vinculos` devolve identidade de conta e grant sem segredos.
- [ ] `/bases` e `/clientes` mostram o mesmo vínculo nos dois sentidos.
- [ ] Regra de autorização é idêntica nos endpoints equivalentes.
- [ ] Delete executa preflight e não apaga base vinculada silenciosamente.
- [ ] Extensão e `GET /api/bases/:slug` mantêm o contrato atual.
- [ ] ML usa `produto_id`; Shopee preserva `id_model`; TikTok usa `sku_id` texto.
- [ ] Custos zero continuam distintos de custo ausente.
- [ ] Drawer mantém busca, filtros, limite, retry, edição e foco.
- [ ] Conta/base inativa não pode receber novo vínculo.
- [ ] Não há mais de uma base oficial por conta se a cardinalidade aprovada for 1:1.
- [ ] Testes dos 11 cenários mínimos e delete/autorização passam.
- [ ] Relatório de dados legados foi revisado antes de constraints/migration.

## 19. Arquivos impactados

### Núcleo imediato provável

- `Portal/bases.html`
- `Portal/bases.js`
- `Portal/css/pages/bases-v2.css` — apenas para novos campos/filtros, sem redesign
- `server/index.js` — rotas monolíticas atuais de lista/import/delete
- `server/services/baseVinculosService.js`
- `server/controllers/baseVinculosController.js`
- `server/routes/baseVinculosRoutes.js`
- `server/services/clienteContas/clienteContaService.js`
- `server/controllers/clienteContasController.js`
- `server/routes/clienteContasRoutes.js`
- `server/controllers/basesController.js`
- `server/routes/basesRoutes.js`
- novo service/controller de importação e batch, preferível a expandir `index.js`
- testes em `server/tests`

### Schema/migration, somente após aprovação e saneamento

- `server/sql/migrations/20260817_cliente_contas_foundation.sql` como baseline, não para editar retroativamente.
- nova migration para constraint/cardinalidade, se aprovada.
- tabelas: `bases`, `custos`, `clientes`, `cliente_contas`, `base_cliente_vinculos`, `ml_tokens`, `user_bases` e dependências de delete.

### Consumidores a proteger, não modificar junto sem escopo

- `extension/content.js`, `extension/popup.js`
- `server/services/automacoes/contextoPrecificacaoService.js`
- `server/services/bases/baseCustosService.js`
- `server/controllers/fechamentosFinanceiroController.js`
- `server/services/centralVendas/*`
- `server/services/cliente360/*`
- `server/services/motorMargem/*`
- `server/services/sellerService.js`
- `server/services/operacaoService.js`
- `server/services/dashboardService.js`
- `server/services/full/*`, `server/controllers/fullController.js`
- relatórios/diagnósticos/APIs públicas e internas que persistem `base_id`/`base_slug`.

## 20. Conclusão

A tela Bases está visual e operacionalmente muito mais madura do que as auditorias antigas. Fundação V2, TikTok, drawer, upsert manual e incremental seguro contra exclusão são ativos a preservar. O próximo trabalho não deve recomeçar a UI nem remover legado.

O contrato correto pós-Cliente/Contas é Base → Cliente → Conta, com `cliente_conta_id` como fonte de verdade operacional para marketplaces cobertos, `cliente_id` e marketplace derivados para compatibilidade, `bases.marketplace` validado contra a conta e grant resolvido pela conta. O estado atual ainda apresenta Cliente → Marketplace como se fosse identidade suficiente, perde conta/grant na leitura e permite que caminhos equivalentes apliquem validações e autorizações diferentes.

Não se recomenda iniciar refinamento de UX/UI agora. Recomenda-se iniciar imediatamente PR 0/PR 1 de testes e proteção de integridade após aprovar as decisões mínimas de autorização/delete/cardinalidade. A importação atômica e a migração account-aware do frontend devem preceder qualquer polimento adicional.
