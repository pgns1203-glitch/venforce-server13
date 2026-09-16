// server/routes/meliAnunciosRoutes.js
// -----------------------------------------------------------------------------
// Módulo: Anúncios Meli — rotas.
//
// Montagem esperada em server/index.js:
//   const meliAnunciosRoutes = require("./routes/meliAnunciosRoutes");
//   app.use("/anuncios-meli", meliAnunciosRoutes);
//
// Proteção base do módulo: authMiddleware + requireAutomacoesAccess
//   (admin | user | membro). As rotas do Otimizador IA têm trava extra
//   requireAdmin (admin-only) — temporária, ver mais abaixo.
//
// Endpoints finais:
//   GET    /anuncios-meli/clientes
//   POST   /anuncios-meli/sync
//   GET    /anuncios-meli/resumo
//   GET    /anuncios-meli/familias            (listagem unificada da tela)
//   GET    /anuncios-meli/familias/:familyId  (expansão de um agrupador)
//   GET    /anuncios-meli
//   GET    /anuncios-meli/criacao/status
//   GET    /anuncios-meli/criacao/categorias
//   GET    /anuncios-meli/criacao/categorias/:categoryId/atributos
//   GET    /anuncios-meli/criacao/categorias/:categoryId/sale-terms
//   GET    /anuncios-meli/criacao/listing-types
//   POST   /anuncios-meli/criacao/publicar
//   POST   /anuncios-meli/:itemId/otimizar        (Otimizador IA — admin-only)
//   GET    /anuncios-meli/:itemId/otimizacoes     (histórico — admin-only)
//   PATCH  /anuncios-meli/otimizacoes/:id/aprovar (aprovação — admin-only)
//   GET    /anuncios-meli/:itemId
//   PATCH  /anuncios-meli/:itemId/revisao
//   PATCH  /anuncios-meli/:itemId/conteudo      (edição real no Mercado Livre)
// -----------------------------------------------------------------------------

const express = require("express");
const router = express.Router();

const { authMiddleware, requireAdmin } = require("../middlewares/authMiddleware");
const { requireAutomacoesAccess } = require("../middlewares/accessMiddleware");
const { requireClienteNaCarteira } = require("../middlewares/carteiraMiddleware");
const ctrl = require("../controllers/meliAnunciosController");

// Todas as rotas exigem usuário autenticado com acesso a automações.
router.use(authMiddleware, requireAutomacoesAccess);

// P2.1 — seam de carteira no router. Todo endpoint client-scoped recebe
// `clienteSlug` (query nas leituras, body nas escritas/sync/criação) e o usa
// para resolver o cliente e o grant ML. `/clientes` (lista) e
// `/otimizacoes/:id/aprovar` (admin-only, sem clienteSlug) passam direto —
// o guard é pass-through quando não há referência de cliente.
router.use(requireClienteNaCarteira({ query: "clienteSlug", body: "clienteSlug" }));

// Rotas estáticas declaradas ANTES de "/:itemId" para evitar conflito.
router.get("/clientes", ctrl.listarClientes);
router.post("/sync", ctrl.sincronizar);
router.get("/resumo", ctrl.resumo);
router.get("/", ctrl.listar);

// DÍVIDA DE NOMENCLATURA — o caminho "/familias" está vencido.
//
// Histórico: a rota nasceu listando FAMÍLIAS. A tela tinha duas abas
// ("Anúncios em Família" e "Anúncios sem agrupamento") e esta rota servia a
// primeira, devolvendo `{ familias: [], sem_user_product: {} }`.
//
// Hoje: depois da unificação da listagem, ela devolve GRUPOS DE ANÚNCIOS —
// uma lista só, em `{ anuncios: [], paginacao }`. Cada grupo é uma de duas
// formas, e `tipo` é o único campo que as distingue:
//
//   tipo: "familia"  -> família com user_products/items abaixo (expansível
//                       por GET /familias/:familyId);
//   tipo: "item"     -> anúncio individual, sem agrupamento (o registro
//                       inteiro de meli_anuncios; nada para expandir, porque
//                       no modelo do ML a relação ali é 1:1).
//
// Renomear exige MIGRAÇÃO DOS CONSUMIDORES, não um alias: criar o caminho
// novo, migrar Portal/anuncios-meli.js (hoje o único consumidor da listagem
// e da expansão) e só então remover o antigo — ou seja, criar um endpoint e
// remover outro. Fora do escopo desta entrega, que se limitou a tratamento
// de dados e renderização. Não confundir com GET /anuncios-meli (raiz), que
// é a listagem PLANA e segue sendo contrato do Motor de Margem
// (Portal/central-margem-api.js) — aquela não mudou.
//
// Ver docs/AUDITORIA_ANUNCIOS_ML_LISTAGEM_UNIFICADA.md (§4.5, contrato).
//
// Ambas precisam vir ANTES de "/:itemId" (linha mais abaixo) — senão a rota
// dinâmica captura "/familias" como se fosse um itemId.
router.get("/familias", ctrl.listarAgrupado);
router.get("/familias/:familyId", ctrl.detalheFamilia);

// Criação de anúncios (escrita no Mercado Livre via POST /items).
router.get("/criacao/status", ctrl.criacaoStatus);
router.get("/criacao/categorias", ctrl.criacaoCategorias);
router.get(
  "/criacao/categorias/:categoryId/atributos",
  ctrl.criacaoAtributos
);
router.get(
  "/criacao/categorias/:categoryId/sale-terms",
  ctrl.criacaoSaleTerms
);
router.get("/criacao/listing-types", ctrl.criacaoListingTypes);
router.post("/criacao/publicar", ctrl.publicarAnuncio);
router.post(
  "/criacao/:itemId/precos-atacado",
  ctrl.retryPrecosAtacado
);

// Rota de aprovação — precisa vir antes de "/:itemId" pra não bater.
// Admin-only enquanto o otimizador está em validação.
router.patch("/otimizacoes/:id/aprovar", requireAdmin, ctrl.aprovarOtimizacao);

// Rotas com sub-caminho declaradas ANTES da rota genérica "/:itemId".
//
// ETAPA 1 do Otimizador: as rotas que chamam IA ficam ADMIN-ONLY
// (authMiddleware do router + requireAdmin por rota). É uma trava
// temporária — quando o otimizador sair da fase de testes, basta
// remover o requireAdmin destas linhas para voltar ao acesso
// padrão do módulo (automações: admin | user | membro).
router.post("/:itemId/otimizar", requireAdmin, ctrl.otimizar);
router.get("/:itemId/otimizacoes", requireAdmin, ctrl.listarOtimizacoes);

router.patch("/:itemId/revisao", ctrl.marcarRevisado);

// Edição de conteúdo do anúncio (título / modelo / descrição) NO MERCADO LIVRE.
// Fica no acesso padrão do módulo (automações + carteira), o mesmo de
// /criacao/publicar — que também escreve no ML. Não é admin-only: o
// requireAdmin do otimizador existe porque a IA está em validação, não porque
// escrever no anúncio seja privilégio de admin.
router.patch("/:itemId/conteudo", ctrl.atualizarConteudo);

router.get("/:itemId", ctrl.detalhe);

module.exports = router;
