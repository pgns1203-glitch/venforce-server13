# Diagnostico e Plano V1 — Tela Bases de Custo

> Escopo: somente a tela Bases de Custo do Portal VenForce.
> Nao executar o plano global da auditoria de frontend neste trabalho.

## Regras De Escopo

- Nao alterar `layout.js`, sidebar, topbar ou layout global.
- Nao alterar outras telas.
- Nao alterar `server/`, banco, endpoints, routes, controllers ou services.
- Nao alterar extensao ou `excelUtils`.
- Nao alterar slug de base.
- Nao alterar formato da API publica `/api/bases/:baseSlug`.
- Nao chamar Assistente IA automaticamente.
- Nao alterar calculos.
- Nao remover nem renomear IDs usados por `Portal/bases.js`.

## Visao De Produto

Bases nao deve ser tratada como uma tela de upload. A tela deve funcionar como a central operacional de custos por cliente e marketplace.

A tela precisa resolver:

- Visualizar bases existentes por marketplace.
- Consultar e conferir custos dentro de uma base.
- Atualizar base existente por planilha.
- Atualizar item manualmente.
- Importar nova base.
- Usar Assistente IA apenas quando a planilha estiver fora do padrao.
- Alertar bases desatualizadas ha mais de 30 dias.

Regras de negocio relevantes:

- Mercado Livre: ao importar/criar base, deve obrigatoriamente ter vinculo com cliente.
- Shopee: deve ter area propria, mas vinculo pode ficar preparado para futuro.
- Assistente IA nao e fluxo principal; e uma opcao dentro da importacao/atualizacao para planilha fora do padrao.
- Atualizar por planilha deve atualizar itens existentes e adicionar novos, sem apagar os que nao vieram.
- Atualizar manualmente e ajuste rapido de MLB/SKU, custo, imposto e taxa fixa.
- Deve existir uma forma clara de conferir/consultar uma base existente com filtros.

## 1. Mapa Da Tela Atual

### Blocos Atuais Do `bases.html`

- Header da pagina: titulo "Bases de Custo" e descricao.
- Card "Importar / Atualizar Base": marketplace, nome da base, arquivo e botao "Pre-visualizar".
- Card "Assistente de Base": upload separado, analise de planilha, preview normalizado e importacao da base limpa.
- Card "Bases cadastradas": feedback, busca, resumo, estados de loading/empty/error e duas secoes de tabela:
  - Bases Mercado Livre.
  - Bases Shopee.
- Modal de preview da importacao normal.
- Modal de excluir base.
- Modal de vinculo cliente-base.

### Blocos Renderizados Pelo `bases.js`

- Cards de resumo em `renderBasesSummary()`.
- Linhas das tabelas Meli/Shopee em `buildBaseRow()`.
- Celula de cliente/vinculo em `renderClienteCell()`.
- Celula de marketplace em `renderMarketplaceCell()`.
- Acoes por base em `renderAcoesBase()`: vincular/alterar vinculo, remover vinculo, baixar, excluir.
- Preview da importacao normal em `openPreview()`.
- Resultado do Assistente em `asstRenderPreview()`: resumo, colunas detectadas, selecao manual de colunas, alertas e previa.
- CSV de base existente em `asstBaixarBase()`.

### IDs Criticos Usados Pelo JS

Importacao normal:

- `import-marketplace`
- `import-nome`
- `file-label`
- `file-label-text`
- `import-arquivo`
- `btn-importar`
- `btn-importar-text`
- `btn-importar-spinner`
- `import-status`

Preview normal:

- `preview-overlay`
- `preview-meta`
- `preview-close`
- `preview-th-idmodel`
- `preview-tbody`
- `preview-cancel`
- `preview-confirm`
- `preview-confirm-text`
- `preview-confirm-spinner`

Lista e estados:

- `bases-count`
- `bases-feedback`
- `bases-busca`
- `bases-summary`
- `bases-content`
- `state-loading`
- `state-sections`
- `state-empty`
- `state-error`
- `error-message`
- `btn-retry`

Tabelas:

- `count-meli`
- `wrap-meli`
- `bases-tbody-meli`
- `empty-meli`
- `count-shopee`
- `wrap-shopee`
- `bases-tbody-shopee`
- `empty-shopee`

Excluir:

- `vf-excluir-base-modal`
- `vf-excluir-base-title`
- `vf-excluir-base-subtitle`
- `vf-excluir-base-close`
- `vf-excluir-base-danger`
- `vf-excluir-base-cancel`
- `vf-excluir-base-confirm`

Vinculo:

- `vf-vinculo-base-modal`
- `vf-vinculo-base-title`
- `vf-vinculo-base-subtitle`
- `vf-vinculo-base-close`
- `vf-vinculo-base-sugestao`
- `vf-vinculo-base-permissao`
- `vf-vinculo-cliente`
- `vf-vinculo-marketplace`
- `vf-vinculo-base-danger`
- `vf-vinculo-base-cancel`
- `vf-vinculo-base-save`

Assistente:

- `asst-arquivo`
- `asst-dropzone`
- `asst-dz-idle`
- `asst-dz-file`
- `asst-dz-filename`
- `asst-dz-clear`
- `asst-btn-preview`
- `asst-btn-text`
- `asst-btn-spinner`
- `asst-status`
- `asst-preview`
- `asst-import-section`
- `asst-nome-base`
- `asst-btn-importar-limpa`
- `asst-btn-importar-text`
- `asst-btn-importar-spinner`
- `asst-import-status`

IDs gerados dinamicamente pelo Assistente:

- `asst-sel-id`
- `asst-sel-custo`
- `asst-sel-imposto`
- `asst-btn-reanalisar`

### Funcoes Principais Do `bases.js`

Sessao e helpers:

- `getToken`
- `clearSession`
- `escapeHTML`
- `formatDateTime`

Importacao normal:

- `getImportMarketplace`
- `atualizarBotaoImportarDisabled`
- `setImportLoading`
- `validarArquivoImportacao`
- `setArquivoSelecionado`
- `openPreview`
- `closePreview`

Bases e listagem:

- `carregarBasesPrincipais`
- `carregarVinculosComplementares`
- `loadBases`
- `getBasesFiltradas`
- `renderBasesTela`
- `renderBasesSummary`
- `renderBases`

Marketplace e vinculo:

- `normalizarMarketplaceKey`
- `marketplaceLabel`
- `getMarketplaceDisplay`
- `getBaseMarketplaceKey`
- `carregarClientesParaVinculos`
- `abrirModalVinculo`
- `salvarVinculoBase`
- `removerVinculoBase`

Acoes:

- `deleteBase`
- `asstBaixarBase`

Assistente:

- `asstEnviarPreview`
- `asstReanalisar`
- `asstRenderPreview`
- `asstGerarCsv`
- `asstImportarBaseLimpa`

### Endpoints Chamados Pela Tela

- `GET /bases`
- `GET /base-vinculos`
- `GET /base-vinculos/clientes`
- `POST /base-vinculos`
- `DELETE /base-vinculos/:baseId`
- `GET /bases/:slug`
- `DELETE /bases/:slug`
- `POST /importar-base` sem `confirmar`, para preview.
- `POST /importar-base` com `confirmar=true`, para importar.
- `POST /bases/assistente/preview`

Endpoints existentes e relevantes, mas ainda nao usados por `bases.js`:

- `GET /bases/:baseSlug/custos/padrao`
- `POST /bases/:baseSlug/custos/upsert`

## 2. Diagnostico Da UX Atual

### Importacao Normal E Assistente Competem

A importacao normal e o Assistente aparecem como dois cards equivalentes no topo, ambos com upload, preview e importacao. A diferenca real deveria ser:

- Fluxo normal para planilha padrao.
- Assistente apenas como opcao quando a planilha esta fora do padrao.

Hoje o Assistente parece outro caminho principal.

### Falta Consulta E Conferencia Da Base

A tabela mostra so metadados da base. O endpoint `GET /bases/:slug` ja traz os custos, mas a tela so usa isso para baixar CSV.

Nao existe drawer/modal para filtrar:

- MLB/SKU.
- Custo.
- Imposto.
- Taxa fixa.
- `id_model`.

### Falta Atualizacao Rapida

O backend ja tem `POST /bases/:baseSlug/custos/upsert`, mas a tela Bases nao oferece acao manual.

Esse endpoint permite atualizar item existente ou criar novo item sem apagar os demais.

### Onde O Vinculo Cliente-Base Entra

O vinculo cliente-base ja existe no modal de vinculo e nas sugestoes automaticas, mas entra tarde no fluxo.

Para Mercado Livre, a regra de produto exige vinculo ao importar/criar. Hoje a importacao cria a base sem cliente e o vinculo e uma acao posterior, nao obrigatoria.

### Como Separar Meli E Shopee Sem Backend Novo

Meli e Shopee podem ser separados usando o campo `marketplace` que ja vem de `/bases` e o filtro `getBaseMarketplaceKey()`.

A tela ja tem duas tabelas, mas precisa transformar isso em areas operacionais mais claras, com filtros e acoes especificas.

### Ponto Critico De Negocio

O `POST /importar-base` atual, ao confirmar, executa `DELETE FROM custos WHERE base_id = $1` antes de inserir os novos custos.

Portanto, ele substitui a base. Isso conflita com a regra: atualizar por planilha deve atualizar itens existentes e adicionar novos, sem apagar os que nao vieram.

## 3. Proposta Bases V1

### Estrutura Visual Da Pagina

- Header: "Bases de Custo" com descricao operacional, nao de upload.
- Acoes no header:
  - Importar nova base.
  - Atualizar base existente.
  - Ajuste manual.
- Banners contextuais:
  - Bases desatualizadas ha mais de 30 dias.
  - Bases Mercado Livre sem vinculo.
- Resumo/KPIs:
  - Total de bases.
  - Mercado Livre.
  - Shopee.
  - Sem vinculo.
  - Desatualizadas +30 dias.
  - Sugestoes pendentes.
- Toolbar:
  - Busca por nome, slug, cliente e produto quando dentro do drawer.
  - Marketplace: Todos, Mercado Livre, Shopee.
  - Vinculo: todos, com vinculo, sem vinculo, sugestao pendente.
  - Status: ativa/inativa.
  - Atualizacao: desatualizadas +30 dias.
- Conteudo:
  - Area Mercado Livre.
  - Area Shopee.
  - Cada base com acoes claras.

### Area Mercado Livre

- Colunas:
  - Base.
  - Cliente vinculado.
  - Ultima atualizacao.
  - Status.
  - Alertas.
  - Acoes.
- Base Meli sem vinculo deve aparecer com badge de alerta.
- Importar nova base Meli deve exigir cliente no modal.
- Acoes:
  - Conferir custos.
  - Atualizar por planilha.
  - Ajuste manual.
  - Alterar vinculo.
  - Baixar CSV.
  - Excluir.

### Area Shopee

- Area propria, com texto e colunas preparadas para SKU/ID Model.
- Vinculo pode existir no modal atual, mas visualmente marcado como preparado/futuro.
- Acoes:
  - Conferir custos.
  - Atualizar por planilha.
  - Ajuste manual.
  - Baixar CSV.
  - Excluir.
- Em conferencia, mostrar `produto_id` e `id_model` quando existir.

### Resumo Util

O resumo deve ajudar a operar a base, nao apenas contar registros.

Indicadores sugeridos:

- Total de bases.
- Bases Meli.
- Bases Shopee.
- Bases sem vinculo.
- Bases desatualizadas ha mais de 30 dias.
- Sugestoes de vinculo pendentes.

O resumo deve deixar claro quando esta mostrando total global e quando esta refletindo filtros ativos.

### Aviso De Bases Desatualizadas +30 Dias

Usar `updated_at` como criterio principal, com fallback para `created_at`.

O aviso deve:

- Aparecer apenas quando existir base desatualizada.
- Mostrar quantidade.
- Permitir filtrar a lista para essas bases.
- Priorizar bases Mercado Livre vinculadas a clientes ativos.

### Filtros

Filtros de lista:

- Busca textual por nome, slug e cliente.
- Marketplace.
- Vinculo.
- Status.
- Desatualizacao +30 dias.

Filtros do drawer de conferencia:

- Produto/MLB/SKU.
- Custo preenchido/zerado.
- Imposto preenchido/zerado.
- Taxa fixa preenchida/zerada.
- `id_model`, quando Shopee.

### Acoes Por Base

Acoes primarias:

- Conferir custos.
- Atualizar por planilha.
- Ajuste manual.

Acoes secundarias:

- Alterar vinculo.
- Baixar CSV.
- Excluir.

Para Mercado Livre sem vinculo, a acao de vincular deve ser destacada.

### Modal De Importar Nova Base

- Usar os IDs atuais de importacao normal.
- Marketplace obrigatorio.
- Cliente obrigatorio se marketplace for Meli.
- Nome da base.
- Arquivo.
- Link/opcao secundaria: "Planilha fora do padrao? Usar Assistente".
- Preview antes de confirmar.
- Nao chamar Assistente automaticamente.

### Modal De Atualizar Base

- Seleciona uma base existente.
- Mostra marketplace, cliente vinculado e ultima atualizacao.
- Upload de planilha.
- Deve deixar claro se a atualizacao e incremental.
- Pela regra de negocio, nao pode usar o fluxo atual de `/importar-base` como atualizacao incremental, porque ele apaga custos ausentes.

### Drawer/Modal Grande Para Conferir Custos

- Abre a partir de uma base.
- Busca `GET /bases/:slug`.
- Converte `dados` em tabela.
- Filtros por produto, custo, imposto, taxa fixa e `id_model`.
- Acao por item: editar rapido.
- Botao "Adicionar item manualmente".
- Apos salvar, usar `POST /bases/:baseSlug/custos/upsert`.

## 4. Separacao Por Viabilidade

### Pode Fazer Agora So Com Frontend Atual

- Reorganizar visualmente a pagina mantendo IDs.
- Transformar importacao e Assistente em acoes/modal, sem deixar os dois competindo no topo.
- Melhorar resumo com dados ja carregados:
  - Total.
  - Meli.
  - Shopee.
  - Sem vinculo.
  - Sugestoes.
  - Desatualizadas +30 dias.
- Criar filtros client-side sobre `TODAS_BASES`.
- Melhorar separacao Meli/Shopee usando `base.marketplace`.
- Mostrar alertas de +30 dias usando `updated_at`.
- Renomear/redistribuir acoes visualmente sem alterar endpoints.

### Pode Fazer Agora Usando Endpoints Existentes

- Conferir custos de uma base com `GET /bases/:slug`.
- Baixar CSV, que ja existe.
- Ajuste manual com:
  - `GET /bases/:baseSlug/custos/padrao`
  - `POST /bases/:baseSlug/custos/upsert`
- Vinculo cliente-base com `/base-vinculos`.
- Exigir cliente no frontend antes de importar Meli e, depois da importacao, criar vinculo via `/base-vinculos` apos recarregar a base. Isso melhora o fluxo, mas nao garante atomicidade.
- Assistente explicito para planilha fora do padrao via `POST /bases/assistente/preview`.

### Precisa De Backend E Fica Para V2

- Garantir no backend que base Mercado Livre so nasce com vinculo de cliente.
- Endpoint de atualizacao incremental por planilha que atualize/insira sem apagar itens ausentes.
- Preview de importacao normal retornando todas as linhas parseadas ou um job/token de importacao.
- Consulta paginada/filtrada de custos para bases grandes.
- Contagem de itens por base em `GET /bases`.
- Historico de importacoes/atualizacoes por base.
- Relatorio de conflitos:
  - Itens atualizados.
  - Itens novos.
  - Itens ignorados.
  - Itens invalidos.
- Contrato definitivo de vinculo Shopee quando ele deixar de ser futuro.

## 5. Plano De Implementacao Em Etapas

### Etapa A: Reorganizacao Visual Mantendo IDs

- Adicionar escopo de tela, idealmente mantendo compatibilidade com a classe atual.
- Manter todos os IDs atuais.
- Mover o formulario de importacao normal para modal/area acionada por botao.
- Rebaixar Assistente para opcao dentro de importacao/atualizacao.
- Preservar `preview-overlay`, modal de vinculo e modal de exclusao.

### Etapa B: CSS Especifico Da Tela Bases

- Criar CSS escopado para Bases, sem mexer em layout global.
- Remover dependencia visual de `.vf-page-dashboard` aos poucos.
- Criar estilos para:
  - Header de acoes.
  - Banners.
  - Resumo.
  - Toolbar.
  - Cards/linhas de base.
  - Drawer de conferencia.
- Nao alterar tokens globais nesta rodada de Bases.

### Etapa C: Filtros E Separacao Meli/Shopee

- Expandir estado de filtros alem de `BASES_BUSCA`.
- Separar filtros por marketplace, vinculo, status e desatualizacao.
- Fazer `renderBasesSummary()` respeitar filtros ou mostrar claramente total global versus filtrado.
- Exibir banners de Meli sem vinculo e bases +30 dias.

### Etapa D: Consulta/Conferencia Da Base

- Adicionar acao "Conferir custos".
- Buscar `GET /bases/:slug`.
- Renderizar drawer/modal grande com tabela client-side.
- Filtros por produto, custo/imposto/taxa e `id_model`.
- Nao alterar `/api/bases/:baseSlug`.

### Etapa E: Atualizar Por Planilha/Manual

- Implementar ajuste manual usando `POST /bases/:baseSlug/custos/upsert`.
- Para atualizacao por planilha, nao usar confirmacao atual de `/importar-base` como incremental.
- Se ficar sem backend novo, deixar atualizacao incremental por planilha fora da V1 operacional ou limitar a fluxo explicito via Assistente + upsert, com cuidado para nao tornar Assistente fluxo principal.
- Para V2, pedir endpoint incremental dedicado.

### Etapa F: Ajustes Finais

- Revisar microcopy: Bases como central operacional, nao tela de upload.
- Validar que Assistente nunca roda automaticamente.
- Validar que slugs nao mudam.
- Validar que IDs usados pelo JS nao foram removidos/renomeados.
- Testar:
  - Importacao.
  - Vinculo.
  - Exclusao.
  - Download.
  - Consulta.
  - Upsert manual.
- Verificar estados:
  - Vazio.
  - Erro.
  - Loading.
  - Filtros sem resultado.

## Observacoes Tecnicas

- `Portal/bases.html` carrega apenas `style.css`; nao carrega `venforce-ui-v2.css`.
- Existem estilos de Bases misturados em `style.css`, inclusive alguns escopados por `.vf-page-dashboard`, porque o `body` da tela usa `vf-page vf-page-dashboard`.
- A separacao Meli/Shopee ja existe parcialmente no HTML/JS, mas ainda nao funciona como estrutura principal de operacao.
- O Assistente gera CSV normalizado e importa pela rota atual `/importar-base`, hoje fixando `marketplace` como `meli` em `asstImportarBaseLimpa()`.
- A consulta publica `/api/bases/:baseSlug` nao deve ser alterada.
- A consulta autenticada `GET /bases/:slug` ja retorna `id_model`, alem de custo, imposto e taxa fixa.
