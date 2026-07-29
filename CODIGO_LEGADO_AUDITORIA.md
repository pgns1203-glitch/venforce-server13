# CODIGO_LEGADO_AUDITORIA — Venforce

Auditoria **conservadora** (somente leitura) para identificar código potencialmente **legado, duplicado ou sem uso claro**.

Foco solicitado:
- `server/auth/*`
- `extension/options.js`
- arquivos vazios/quase vazios
- fluxos duplicados de autenticação
- páginas/JS do Portal possivelmente “sobrando”

---

## Itens encontrados

### 1) `server/auth/authController.js` (e `server/auth/authRoutes.js`, `server/auth/authMiddleware.js`)

- **arquivo**: `server/auth/authController.js` (relacionados: `server/auth/authRoutes.js`, `server/auth/authMiddleware.js`)
- **para que parece servir**: um **fluxo alternativo de autenticação** baseado em arquivo local `server/data/clients.json` (com suporte a senha em texto ou bcrypt) + emissão de JWT.
- **ativo ou legado**: **legado / sem uso claro no runtime atual**
- **evidência**:
  - `server/auth/authController.js` referencia `../data/clients.json` e implementa `login`/`me` fora do Postgres.
  - `server/index.js` define diretamente `POST /auth/login`, `POST /auth/register` e `GET /auth/me` usando Postgres (`users`) e **não há indício de `app.use("/auth", authRoutes)`** nem `require("./auth/authRoutes")` no `server/index.js`.
  - `server/index.js` também tem seu próprio `authMiddleware` (busca usuário no banco), diferente do `server/auth/authMiddleware.js` (apenas decodifica JWT).
- **risco de remover**: **médio** (se algum deploy antigo/ramo paralelo ainda usa `server/auth/*`, ou se alguém passou a depender disso sem estar neste `index.js`).
- **recomendação**: **candidato a legado** (manter por enquanto; revisar depois e confirmar se há algum ambiente/branch que ainda usa essas rotas).

---

### 2) Fluxo de autenticação duplicado no backend (duas implementações de middleware)

- **arquivo**: `server/index.js` (auth middleware interno) **vs** `server/auth/authMiddleware.js`
- **para que parece servir**:
  - `server/index.js`: valida JWT e **confere usuário no banco** (`users`) + checa `ativo`.
  - `server/auth/authMiddleware.js`: valida JWT e coloca `decoded` em `req.user` sem consultar banco.
- **ativo ou legado**: **duplicado** (um parece ativo, o outro parece legado)
- **evidência**:
  - As rotas reais estão em `server/index.js` e referenciam o `authMiddleware` definido nele.
  - A pasta `server/auth/` não aparece “plugada” no `index.js`.
- **risco de remover**: **médio** (mesmo motivo do item anterior: risco de existir consumo externo/ambiente alternativo).
- **recomendação**: **revisar depois** (não mexer agora; apenas documentar e confirmar origem/uso).

---

### 3) `extension/options.js` (tela antiga / desalinhada com backend atual)

- **arquivo**: `extension/options.js`
- **para que parece servir**: uma tela simples de “selecionar base” que chama `GET /bases` e salva `baseSelecionada` no storage.
- **ativo ou legado**: **legado / potencialmente quebrado**
- **evidência**:
  - Faz `fetch(".../bases")` **sem** header `Authorization`, mas o backend atual exige JWT em `GET /bases`.
  - Assume que `GET /bases` retorna um array direto (`bases.forEach(...)`) e que cada item tem `base.id`/`base.nome`, mas o backend atual responde `{ ok: true, bases: [...] }` com `slug/nome/...`.
  - A UI atual da extensão está centralizada em `popup.js` + `content.js` (com login e Bearer token).
- **risco de remover**: **médio/alto** (porque `extension/background.js` abre `options.html` ao clicar no ícone; se `options.html` depender desse arquivo em algum momento, remover pode quebrar a extensão).
- **recomendação**: **revisar depois** (primeiro confirmar exatamente qual UI a extensão usa em produção; depois decidir consolidar/remover).

---

### 4) `extension/custos.json` vazio (fallback local sem efeito)

- **arquivo**: `extension/custos.json`
- **para que parece servir**: fallback local de custos se a API falhar (carregado por `extension/content.js`).
- **ativo ou legado**: **ativo como fallback**, mas **no estado atual é inócuo** (arquivo vazio).
- **evidência**:
  - Conteúdo atual: `{}`.
  - `content.js` tenta carregar esse arquivo apenas como fallback.
- **risco de remover**: **baixo a médio** (se a API ficar indisponível, o fallback poderia ser usado; hoje não ajuda porque está vazio).
- **recomendação**: **manter** (baixo custo; pode ser útil futuramente).

---

### 5) `Portal/extensao.js` quase vazio (script “placeholder”)

- **arquivo**: `Portal/extensao.js`
- **para que parece servir**: inicializar o layout/side bar na página de download da extensão.
- **ativo ou legado**: **ativo**, porém **quase vazio**
- **evidência**:
  - Conteúdo é basicamente `initLayout()` apenas.
  - `Portal/extensao.html` inclui `layout.js` e `extensao.js`.
- **risco de remover**: **baixo** (página continuaria funcionando se `layout.js` fosse carregado e chamado por outro meio; mas hoje o “gatilho” está nesse arquivo).
- **recomendação**: **manter** (não vale mexer; é um placeholder aceitável).

---

### 6) `extension/U01.code-workspace` (arquivo de workspace do editor)

- **arquivo**: `extension/U01.code-workspace`
- **para que parece servir**: configuração do VS Code/Cursor para abrir múltiplas pastas (inclui referência externa `../../venforce-margin-scannerx1/Server`).
- **ativo ou legado**: **não faz parte do runtime** (apenas dev tooling)
- **evidência**:
  - Conteúdo é um JSON de workspace com `folders`.
- **risco de remover**: **baixo** para produção; **médio** para a rotina de desenvolvimento de alguém que dependa dele.
- **recomendação**: **revisar depois** (decidir se o repositório deve versionar esse tipo de arquivo).

---

### 7) Páginas do Portal possivelmente “sobrando” (não é legado por si só, mas sinal de “superfície” maior)

- **arquivo**: `Portal/scans.html` + `Portal/scans.js`
- **para que parece servir**: painel de scans (listagem para usuário autenticado; exclusão exige admin no backend).
- **ativo ou legado**: **ativo**, mas **não aparece no menu** (acessível por URL direta).
- **evidência**:
  - Existe HTML+JS e chama a API.
  - Menu do Portal não lista `scans.html` (segundo `Portal/layout.js`).
- **risco de remover**: **médio** (pode existir uso “por link direto”).
- **recomendação**: **revisar depois** (decidir se deve entrar no menu, ficar oculto de propósito, ou receber guarda/UX consistente).

---

## Resumo executivo (curto)

- **Mais claramente legado/duplicado**: `server/auth/*` (auth por `clients.json`) e `extension/options.js` (fluxo antigo sem Bearer token, desalinhado com a API).
- **Quase vazios/placeholder**: `Portal/extensao.js` (ok manter), `extension/custos.json` (fallback vazio), `extension/U01.code-workspace` (tooling).
- **Superfície potencialmente “sobrando”**: `Portal/scans.*` existe e funciona, mas está fora do menu.

