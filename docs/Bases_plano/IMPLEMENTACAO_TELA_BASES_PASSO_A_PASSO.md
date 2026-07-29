# Tela Bases de Custo — Passo a Passo de Implementação (V1)

> Execução detalhada da Fase 0 (piloto) definida em `INSTRUCOES_E_PLANO_IMPLEMENTACAO.md`.
> Baseado em `DIAGNOSTICO_BASES_V1.md` (IDs, endpoints, funções) e `DESIGN_SYSTEM_FUNDACAO.md` (valores visuais).
> Preview aprovável: `bases-central-preview-v2.html`.

---

## 0. Contrato da tarefa

**Escopo:** somente `Portal/bases.html`, novo `Portal/bases.css` e ajustes em `Portal/bases.js`.

**Proibido nesta V1:**

```txt
layout.js / sidebar / topbar / style.css global / outras telas
server/ (rotas, controllers, services, banco)
extensão e excelUtils
slug de base e API pública /api/bases/:baseSlug
chamar Assistente automaticamente
remover/renomear qualquer ID da lista da seção 2
```

**Endpoints usados (todos já existem — zero backend novo):**

| Uso | Endpoint |
|---|---|
| Listar bases | `GET /bases` |
| Vínculos | `GET /base-vinculos`, `GET /base-vinculos/clientes`, `POST /base-vinculos`, `DELETE /base-vinculos/:baseId` |
| Consultar custos (drawer) | `GET /bases/:slug` — já retorna custo, imposto, taxa fixa e `id_model` |
| Ajuste manual | `GET /bases/:baseSlug/custos/padrao` + `POST /bases/:baseSlug/custos/upsert` |
| Importar (preview/confirmar) | `POST /importar-base` (sem/com `confirmar`) |
| Assistente | `POST /bases/assistente/preview` |
| Excluir / baixar | `DELETE /bases/:slug` / fluxo CSV atual |

**Fora da V1 (exige backend, vira V2):** atualização incremental por planilha (`/importar-base` hoje faz `DELETE FROM custos` antes de inserir — substitui a base), vínculo obrigatório garantido no servidor, consulta paginada de custos, contagem de itens em `GET /bases`, histórico de importações.

⚠️ Consequência prática: o botão "Atualizar por planilha" **não entra** na V1 (ou entra desabilitado com hint "disponível na V2"). Não usar o fluxo atual de importação como se fosse incremental — ele apaga itens ausentes.

---

## 1. Anatomia final da tela

```txt
PAGE HEADER
  kicker: OPERAÇÃO
  h1: Bases de Custo
  desc: Controle custos por cliente, marketplace e produto.
  ações: [Ajuste manual] [Importar nova base]•primary
         (Assistente NÃO aparece aqui — vive dentro do modal de importação)

BANNERS (só quando existirem)
  ⚠ N bases sem atualização há +30 dias        [Filtrar]
  ⛔ N bases Mercado Livre sem cliente vinculado [Ver bases]

KPIs (6)
  Total · Mercado Livre · Shopee · Sem vínculo · Desatualizadas +30d · Sugestões pendentes
  → rótulo "Totais gerais" ou "Refletindo filtros" sempre visível

TOOLBAR
  esquerda: busca (nome/slug/cliente) · Marketplace · Vínculo · Atualização
            + chips removíveis dos filtros ativos
  direita:  [Atualizar lista]

SEÇÃO MERCADO LIVRE
  tabela: Base · Cliente vinculado · Última atualização · Status · Ações
  sem vínculo → linha com fundo danger suave + ação primária "Vincular cliente"

SEÇÃO SHOPEE
  mesma anatomia; célula de cliente marca "vínculo em preparação"

DRAWER "Conferir custos"  (painel lateral, não modal)
  header: nome + marketplace + cliente + itens + última atualização
  toolbar: busca produto/MLB/SKU/id_model + chips (Custo zerado · Imposto zerado · Taxa zerada)
  tabela: Produto · id_model (Shopee) · Custo · Imposto % · Taxa fixa · [Editar]
  edição inline por linha → POST upsert
  footer: X de Y itens · [Adicionar item manualmente]

MODAIS preservados: preview de importação, exclusão, vínculo
MODAL importação (novo shell, mesmos IDs): marketplace → se Meli, cliente obrigatório
  → nome → arquivo → [Pré-visualizar]
  → link secundário: "Planilha fora do padrão? Usar Assistente"
```

---

## 2. IDs que NÃO podem sumir (checklist de preservação)

Copiar esta lista para o PR e marcar um a um após a Etapa A:

```txt
Importação: import-marketplace, import-nome, file-label, file-label-text,
  import-arquivo, btn-importar, btn-importar-text, btn-importar-spinner, import-status
Preview: preview-overlay, preview-meta, preview-close, preview-th-idmodel,
  preview-tbody, preview-cancel, preview-confirm, preview-confirm-text, preview-confirm-spinner
Lista/estados: bases-count, bases-feedback, bases-busca, bases-summary, bases-content,
  state-loading, state-sections, state-empty, state-error, error-message, btn-retry
Tabelas: count-meli, wrap-meli, bases-tbody-meli, empty-meli,
  count-shopee, wrap-shopee, bases-tbody-shopee, empty-shopee
Excluir: vf-excluir-base-modal, -title, -subtitle, -close, -danger, -cancel, -confirm
Vínculo: vf-vinculo-base-modal, -title, -subtitle, -close, -sugestao, -permissao,
  vf-vinculo-cliente, vf-vinculo-marketplace, vf-vinculo-base-danger, -cancel, -save
Assistente: asst-arquivo, asst-dropzone, asst-dz-idle, asst-dz-file, asst-dz-filename,
  asst-dz-clear, asst-btn-preview, asst-btn-text, asst-btn-spinner, asst-status,
  asst-preview, asst-import-section, asst-nome-base, asst-btn-importar-limpa,
  asst-btn-importar-text, asst-btn-importar-spinner, asst-import-status
Dinâmicos do Assistente: asst-sel-id, asst-sel-custo, asst-sel-imposto, asst-btn-reanalisar
```

Regra: os elementos podem **mudar de lugar** (ex.: formulário de importação vai para dentro de um modal), mas o ID continua existindo no DOM quando o bloco estiver montado.

---

## 3. Etapas de implementação

Cada etapa = 1 branch de trabalho contínua (`feat/bases-central-v1`), 1 commit por etapa, testável isoladamente.

### Etapa A — Reorganização estrutural do HTML (sem lógica nova)

1. `bases.html`: trocar `class="vf-page vf-page-dashboard"` por `class="vf-page vf-page-dashboard vf-page-bases"` (adiciona escopo **sem remover** a classe antiga — estilos herdados continuam até a Etapa B substituí-los).
2. Construir o page header novo (kicker + h1 + descrição + ações).
3. Mover o card "Importar / Atualizar Base" inteiro para dentro de um novo shell de modal (`bases-modal-importar`), preservando todos os IDs internos. Botão "Importar nova base" do header abre o modal.
4. Mover o card "Assistente de Base" para dentro do mesmo modal, como seção colapsada acionada pelo link "Planilha fora do padrão? Usar Assistente". IDs `asst-*` intactos.
5. Criar os contêineres vazios de banners (`bases-banners`) e manter `bases-summary` (o JS já renderiza nele).
6. Criar toolbar com `bases-busca` reposicionado + selects novos (`bases-filtro-marketplace`, `bases-filtro-vinculo`, `bases-filtro-atualizacao`) — ainda sem comportamento.
7. Manter as duas seções de tabela e todos os modais existentes onde estão.
8. **Teste:** tela abre, lista carrega, importação via modal funciona ponta a ponta (preview + confirmar), Assistente funciona quando aberto explicitamente, vínculo/exclusão/download intactos. Rodar o checklist da seção 2.

### Etapa B — CSS escopado (`Portal/bases.css`)

1. Criar `Portal/bases.css` com variáveis locais espelhando a fonte única:
   ```css
   .vf-page-bases {
     --b-primary: #5a2a8f; --b-primary-hover: #4a2178;
     --b-primary-soft: #f4eef9; --b-primary-border: #e2d5f2;
     --b-bg: #f7f8fb; --b-surface: #ffffff; --b-surface-2: #fbfbfe;
     --b-text: #1b1d28; --b-text-m: #5a6072; --b-text-l: #969cad;
     --b-border: #e7e9f0; --b-border-strong: #d6d9e4;
     --b-success: #0f7a52; --b-success-bg: #e7f6ef;
     --b-warning: #b25e00; --b-warning-bg: #fdf1e3;
     --b-danger: #c62828;  --b-danger-bg: #fdecec;
     --b-radius-sm: 6px; --b-radius: 10px; --b-radius-lg: 12px;
   }
   ```
   (Na Fase 1 global: find/replace `--b-` → `--vf-` e apagar o bloco.)
2. Estilizar: header, banners, KPIs, toolbar, tabelas (thead sticky, `.num` tabular-nums à direita, severidade por fundo de linha), tags de status com dot, botões nas 3 variantes, shell de modal, drawer.
3. Todo seletor começa com `.vf-page-bases` — zero vazamento para outras telas.
4. Fontes: adicionar Inter + IBM Plex Mono (link no `<head>` de bases.html apenas; na Fase 1 vai para o global).
5. **Teste:** comparar com o preview aprovado lado a lado; abrir dashboard/cliente-360 e confirmar que nada mudou nelas.

### Etapa C — Filtros e resumo honesto (bases.js)

1. Expandir o estado de filtro: de `BASES_BUSCA` para `BASES_FILTROS = { busca, marketplace, vinculo, atualizacao }`.
2. `getBasesFiltradas()` passa a aplicar os quatro critérios sobre `TODAS_BASES` (client-side).
3. Desatualização: `COALESCE(updated_at, created_at) < hoje − 30d` calculado no front.
4. `renderBasesSummary()`: adiciona os cards "Sem vínculo", "Desatualizadas +30d" e "Sugestões pendentes"; exibe o rótulo "Totais gerais" quando não há filtro ativo e "Refletindo filtros" quando há (corrige o bug atual de resumo que ignora busca).
5. Renderizar chips de filtros ativos na toolbar (removíveis).
6. Banners: renderizar só quando contagem > 0; ação do banner seta o filtro correspondente.
7. **Teste:** cada filtro isolado e combinado; chips removem; banners filtram; resumo muda de rótulo; busca antiga continua funcionando.

### Etapa D — Drawer "Conferir custos"

1. Nova ação por linha: "Conferir custos" (primária, exceto Meli sem vínculo, onde a primária é "Vincular cliente").
2. Ao abrir: `GET /bases/:slug`, converter `dados` em linhas; loading com skeleton; erro com retry.
3. Toolbar do drawer: busca textual (produto_id/id_model) + chips "Custo zerado", "Imposto zerado", "Taxa zerada" — filtros client-side.
4. Coluna `id_model` visível quando a base for Shopee (o endpoint já retorna).
5. Valores zerados em destaque danger na célula.
6. Fechamento por ✕, Esc e clique no backdrop; foco volta ao botão de origem.
7. ⚠️ Bases grandes: sem paginação de servidor na V1, renderizar no máximo ~500 linhas e exibir "Mostrando 500 de N — refine a busca". Consulta paginada é item de V2.
8. **Teste:** base pequena, base de 1.000+ itens, base Shopee com id_model, base com zerados.

### Etapa E — Ajuste manual (upsert)

1. Botão "Editar" por linha do drawer → linha entra em modo edição (custo, imposto %, taxa fixa; `produto_id` somente leitura).
2. Salvar → `POST /bases/:baseSlug/custos/upsert`; sucesso atualiza a linha local sem refetch; erro mantém edição aberta com mensagem inline.
3. "Adicionar item manualmente" (footer do drawer) → mesma linha de edição com `produto_id` editável; pré-carregar padrão via `GET /bases/:baseSlug/custos/padrao`.
4. Header da tela ganha a ação "Ajuste manual": abre um mini-modal que pede base + produto e reaproveita o mesmo formulário (mesmo código do drawer).
5. **Teste:** editar existente, criar novo, produto_id duplicado (deve atualizar, não duplicar), valores inválidos, sessão expirada.

### Etapa F — Estados, microcopy e fechamento

1. Estados: vazio primeiro uso ("Nenhuma base ainda — importe a primeira"), vazio de filtro ("Nada encontrado para estes filtros" + limpar), loading com skeleton, erro com retry — nos 3 níveis (página, seção, drawer).
2. Microcopy operacional: descrições dizem o que a tela **resolve**, não o que ela faz tecnicamente.
3. Acessibilidade mínima: `role="dialog"` + `aria-modal` no drawer e modais, `aria-live="polite"` em `import-status`/`bases-feedback`, foco preso no drawer aberto.
4. Validar as regras: Assistente nunca dispara sozinho; slug intocado; Meli exige cliente selecionado antes de habilitar "Pré-visualizar" (validação front; garantia de servidor fica para V2).
5. Rodar o checklist completo da seção 4.

---

## 4. Checklist final de aceite

Fluxos existentes (regressão zero):
- [ ] Importar base padrão: selecionar → preview → confirmar → aparece na lista
- [ ] Assistente: abrir explicitamente → analisar → importar base limpa
- [ ] Vincular, alterar vínculo e remover vínculo
- [ ] Excluir base (modal de confirmação)
- [ ] Baixar CSV
- [ ] Busca textual antiga

Fluxos novos:
- [ ] Filtros marketplace/vínculo/atualização + chips
- [ ] Banners aparecem/somem conforme dados e filtram ao clicar
- [ ] Resumo com 6 KPIs e rótulo global × filtrado
- [ ] Drawer: consulta, filtros de zerados, id_model em Shopee, limite de 500
- [ ] Editar item e adicionar item via upsert
- [ ] Meli sem vínculo: linha destacada + "Vincular cliente" como primária

Não-funcionais:
- [ ] Todos os IDs da seção 2 presentes
- [ ] Nenhuma outra tela visualmente alterada
- [ ] Nenhum arquivo de `server/` tocado
- [ ] `git diff --stat` mostra apenas bases.html, bases.css, bases.js
- [ ] Esc/backdrop/✕ fecham drawer e modais; foco retorna

---

## 5. O que pedir para a V2 (backend)

Registrar como issues ao fim da V1:

1. `POST /bases/:baseSlug/importar-incremental` — UPSERT sem apagar ausentes, retornando `{ total_linhas, adicionados, atualizados, ignorados, erros, amostra_erros }`.
2. Vínculo obrigatório Meli garantido no servidor (transação importação+vínculo).
3. `GET /bases/:slug` com paginação/filtro server-side para bases grandes.
4. Contagem de itens por base em `GET /bases` (hoje o front não tem esse dado na lista).
5. Histórico de importações por base.
