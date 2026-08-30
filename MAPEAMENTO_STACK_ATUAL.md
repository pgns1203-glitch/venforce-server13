# Mapeamento do Stack Atual — VenForce

> Visão geral rápida da arquitetura para dar contexto a quem for mexer no código. Não é um guia exaustivo — para detalhes de features específicas, ver os `.md` na raiz e em `docs/`.

## 1. Visão geral

O VenForce é um SaaS de gestão para sellers de marketplace (Mercado Livre, Shopee, TikTok Shop), com:

- **Backend**: Node.js + Express, monolito em `server/`, conectado a PostgreSQL.
- **Frontend novo**: React + Vite, em migração incremental (`frontend-react/`), organizado em "ilhas" (múltiplos SPAs pequenos, não um único app).
- **Frontend legado**: HTML/JS vanilla servido estaticamente, em `Portal/` (ainda em uso — a migração para React é parcial, por tela).

Não há build unificado nem monorepo com workspaces: `server/` e `frontend-react/` têm `package.json` próprios e independentes.

## 2. Backend — `server/`

### Stack
- **Runtime**: Node.js, CommonJS (`require`/`module.exports`).
- **Framework**: Express 4.
- **Banco**: PostgreSQL via `pg` (pool único em `server/config/database.js`, usando `DATABASE_URL`).
- **Auth**: JWT (`jsonwebtoken`) + `bcrypt` para senha.
- **Outras libs**: `multer` (upload em memória), `xlsx`/`csv-parser` (planilhas), `sharp` (imagem), `googleapis` (Drive), `archiver` (zip).
- **Entrypoint**: `server/index.js` — arquivo grande (~75k linhas de código acumulado) que ainda concentra bastante lógica de negócio inline (parsers de planilha, normalizações), além de montar middlewares e rotas.

### Camadas (padrão predominante, nem sempre 100% seguido)

```
routes/        → define os endpoints e middlewares aplicados, chama controllers
controllers/    → recebe req/res, valida entrada, chama services, formata resposta
services/       → regra de negócio, pode ter subpastas por domínio
repositories/   → acesso a dados mais estruturado (uso ainda pontual, ex: observability)
middlewares/    → auth, autorização, observabilidade
```

Exemplo de fluxo típico (`squads`):
```
server/routes/squadsRoutes.js  → authMiddleware, requireAdmin
  → server/controllers/squadsController.js
    → server/services/squads/{squadService,authorizationService,squadsRepository}.js
```

- `services/` tem ~19 subpastas por domínio (ex.: `centralVendas/`, `fechamentoFinanceiro/`, `motorMargem/`, `cliente360/`, `squads/`, `bases/`), cada uma com vários arquivos de service especializados (parser, repository, read-service, sync-service, etc.).
- `repositories/` como pasta isolada é usado só em `observabilityRepository.js`; a maioria dos acessos a banco fica dentro dos próprios `*Repository.js` dentro das pastas de `services/<domínio>/`.
- Não há ORM — queries SQL diretas via `pg`.

### Rotas principais (montadas em `server/index.js`)
Todas prefixadas e mapeadas para um arquivo em `routes/` + `controllers/`, cobrindo: auth, dashboard, fechamentos financeiros (Meli/Shopee/TikTok), squads, bases de dados de clientes, cliente 360, central de vendas, motor de margem, ads, design studio, ClickUp, observabilidade (Control Center), etc. — um endpoint por domínio de negócio.

### Middlewares
- `authMiddleware.js` — valida JWT, carrega `req.user` do banco (`users`), bloqueia inativos.
- `accessMiddleware.js` — API key e flags de acesso a features (design, automações).
- `carteiraMiddleware.js` — restringe acesso por carteira de clientes do usuário.
- `observabilityMiddleware.js` — captura métricas/erros de requisições para o Control Center.

### Autenticação/Autorização
- Login gera JWT (`JWT_SECRET`), guardado no `localStorage` do front (`vf-token`/`vf-user`).
- Autorização por `role` (`admin` vs demais) e por "squads" (times/carteiras de clientes) — ver `services/squads/authorizationService.js`.

## 3. Frontend novo — `frontend-react/`

- **Stack**: React 18 + Vite 6, sem TypeScript, sem router/state lib externa (SPA simples por tela).
- **Estratégia**: migração "por ilhas" — cada tela grande do Portal legado vira um mini-app React independente, com seu próprio HTML de entrada e build:
  - `cliente-360-react.html` → Cliente 360
  - `full-gestao.html` → Central de Gestão Full
  - `visao.html` → Visão (F3)
  - `financeiro-v3.html` → Financeiro (F4)
- `vite.config.js` decide tudo (proxy dev, `assetsDir`, `outDir`) a partir do `--mode <ilha>` passado no script.
- Em dev, proxy do Vite aponta para o Express local (`http://localhost:3333`); em produção, chama a API via `VITE_API_BASE_URL` ou uma URL fixa de produção (Render).
- **Estrutura em `src/`**: `components/<ilha>/`, `pages/`, `services/` (um `*Api.js` por ilha + `apiClient.js` genérico), `hooks/`, `utils/`, `styles/`.
- **Auth no front**: reaproveita exatamente o mecanismo do Portal legado — token em `localStorage["vf-token"]`, sem sessão paralela; 401 redireciona pro login.
- **Testes**: Vitest + Testing Library (`npm test`).

## 4. Frontend legado — `Portal/`

- HTML + JS vanilla "puro" (sem framework/bundler), um par `tela.html` + `tela.js` por página (~39 HTMLs, ~85 JS).
- Auth manual: lê token/usuário do `localStorage`, redireciona se não autenticado ou sem permissão (`role`).
- Chama a API do Express diretamente por `fetch`, com `API_BASE` fixo apontando para o backend em produção (Render).
- Ainda é a maior parte da superfície do produto; React (`frontend-react/`) vai substituindo tela a tela.

## 5. Integrações externas

- **Mercado Livre**: OAuth + API própria, com refresh de token via worker (`utils/tokenRefreshWorker.js`).
- **Shopee** e **TikTok Shop**: parsers de planilhas de fechamento/custos (upload manual, sem API direta na maior parte dos fluxos).
- **ClickUp**: API para o módulo "ClickUp Executivo".
- **Google Drive**: via `googleapis`, para armazenamento de arquivos/backups.
- **IA de imagem** (opcional): provider plugável (Photoroom/Cloudinary/remove.bg) no editor do Design Studio.

## 6. Observações gerais

- Não há testes automatizados de frontend legado (`Portal/`); o backend tem testes em `server/tests/` (scripts Node, não framework de teste formal) e o React novo usa Vitest.
- Não há CI/CD configurado no repo (sem pasta `.github/workflows`).
- Deploy aparente: backend no Render (`venforce-server.onrender.com`), frontend buildado como estático (Vite) e/ou servido pelo próprio Portal.
- Há bastante documentação de auditoria/planejamento na raiz e em `docs/` — útil para entender decisões e features específicas, mas desatualizada em partes (não é fonte única de verdade de código).
