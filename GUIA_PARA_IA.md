# GUIA_PARA_IA — Venforce (oficial)

Este guia define **como qualquer IA deve operar neste repositório**.  
O princípio é simples: **estabilidade primeiro**, **compatibilidade primeiro**, **mudanças pequenas**, **produção em primeiro lugar**.

> Base oficial deste guia: `MAPA_DO_SISTEMA.md`, `REGRAS_DE_NEGOCIO.md`, `AUDITORIA_PERMISSOES_PORTAL.md`, `CODIGO_LEGADO_AUDITORIA.md`.

---

## 1) Visão geral do projeto

Este repositório é um **monorepo** com três partes:

- **`server/`**: backend (API HTTP) que concentra regras de autenticação, administração, bases/custos, fechamentos e integração Mercado Livre.
- **`Portal/`**: frontend estático (HTML/CSS/JS) de **uso interno da equipe**, consumindo a API via `fetch`.
- **`extension/`**: extensão Chrome (MV3) que injeta overlay no Mercado Livre e consome custos via API.

---

## 2) Regras inegociáveis

- **Não quebrar a API já em produção**.
- **Não mudar rotas existentes** sem autorização explícita.
- **Não mudar payloads existentes (request/response)** sem autorização explícita.
- **Não mexer em banco** (tabelas/colunas/constraints/índices/semântica) sem autorização explícita.
- **Não fazer refatoração estrutural grande** por conta própria.
- **Não apagar arquivos suspeitos de legado** sem confirmar uso real (produção / extensão / Portal / automações).
- **Não mexer em integração Mercado Livre** (OAuth/tokens/fluxos) sem extrema cautela.
- **Considerar bases como globais** para a equipe (sem segregação por usuário “neste momento”).
- **Considerar o Portal como uso interno** da equipe.

---

## 3) Arquitetura oficial

- **`server/`** é a fonte da verdade das rotas e integrações. Mudanças aqui têm maior risco.
- **`Portal/`** consome a API com contratos existentes; o Portal é interno.
- **`extension/`** consome a API e também depende de comportamento estável para operar no Mercado Livre.

Regras operacionais:
- **Produção depende do branch `main`** (o código em `main` é o que deve ser considerado “candidato ao deploy”).
- **Mudanças devem ser feitas em branch** antes de merge.

---

## 4) Como uma IA deve trabalhar neste projeto

Ordem obrigatória de trabalho:

1. **Ler a documentação `.md`** relevante (principalmente as quatro “oficiais”).
2. **Ler os arquivos diretamente relacionados** à tarefa (mínimo necessário).
3. Propor e executar **mudanças mínimas, cirúrgicas e reversíveis**.
4. Sempre apresentar:
   - **diff pequeno** (ou diff resumido + trechos-chave),
   - **impacto** (o que muda e o que não muda),
   - **riscos** (se existirem).
5. Se houver risco real de quebra de produção, **parar e avisar**, propondo uma alternativa conservadora.
6. **Nunca** fazer “limpeza geral”, “padronização ampla” ou “modernização total” sem autorização explícita.

---

## 5) Fluxo seguro de mudança

Fluxo recomendado (para qualquer alteração com chance de ir à produção):

- **Backup**: garantir que o estado atual está salvo (commit/branch) antes de mexer.
- **Branch**: criar branch para a mudança.
- **Análise**: confirmar uso real (Portal, extensão, integrações).
- **Alteração mínima**: mudar só o necessário.
- **Diff**: revisar diff (pequeno e óbvio).
- **Testes**: executar o checklist de testes (abaixo) proporcional ao risco.
- **Commit**: commit claro, descrevendo o “porquê”.
- **Push**: subir a branch.
- **PR**: abrir PR com resumo e plano de teste.
- **Merge**: somente após revisão/validação.
- **Deploy**: quando necessário, **deploy manual / latest commit no Render** (conforme processo do time).

---

## 6) Checklist antes de alterar código

Perguntas obrigatórias:

- O arquivo/rota **é realmente usado**?
- A rota já está **em produção**?
- Existe **Portal** consumindo esse payload?
- Existe **extensão** consumindo isso?
- Existe risco para **clientes já conectados** (Mercado Livre / tokens / bases)?
- Existe risco para **auth/JWT**?
- Existe risco para **OAuth Mercado Livre**?
- Existe risco para **banco** (migrations implícitas, DDL, constraints)?

Se qualquer resposta for “não sei”, a IA deve **investigar antes** e/ou **evitar a mudança**.

---

## 7) Checklist de testes depois de qualquer mudança

Checklist funcional (executar o que for relevante ao escopo da mudança):

- **Login no Portal**
- **Dashboard** (listar/importar bases)
- **Bases** (`GET /bases`, `GET /bases/:id`, importação)
- **Clientes (admin)** (somente se mexeu em permissões/rotas admin)
- **Callbacks (admin)**
- **Tokens ML (admin)**
- **Healthcheck** (`GET /health`)
- **Extensão** (abrir UI, autenticar, carregar base, overlay no ML)
- **Endpoint crítico relacionado à mudança** (o alvo exato alterado)

---

## 8) Áreas sensíveis

Qualquer mudança nessas áreas exige cautela extra, revisão e testes:

- **`/setup`** (DDL/migração de tabelas)
- **auth/JWT** (`/auth/*`, middlewares)
- **usuários/admin** (rotas de administração)
- **tokens Mercado Livre** (access/refresh token, expiração, refresh)
- **callbacks** (auditoria/logs e retenção)
- **importação de bases** (upload, parse, upsert/delete em custos)
- **integração Mercado Livre** (`/ml/*`, `/callback`, `ml_tokens`)
- **qualquer rota destrutiva** (`DELETE ...`)

---

## 9) Código legado ou suspeito

Itens já identificados como suspeitos (não remover sem confirmação real de uso):

- **`server/auth/*`**: parece **legado/duplicado** (auth por `clients.json`), não plugado no runtime principal do `server/index.js`.
- **`extension/options.js`**: parece **legado/desalinhado** com a API atual (sem Bearer token; espera payload diferente).
- **`Portal/scans.*`**: existe e chama API, mas fica **fora do menu** (pode ter uso por URL direta).

Regra: **não remover nada disso** sem evidência forte de não-uso (produção + usuários + extensão).

---

## 10) O que uma IA não deve fazer

- Não migrar a arquitetura inteira.
- Não converter tudo para TypeScript.
- Não modularizar tudo de uma vez.
- Não renomear rotas por conta própria.
- Não “normalizar” banco (DDL/migrações/constraints) sem pedido explícito.
- Não alterar várias camadas ao mesmo tempo (backend + Portal + extensão) sem necessidade clara.

---

## 11) Modelos de resposta esperados de uma IA

### Modelo — resposta de análise

- **Objetivo**: \<o que foi pedido\>
- **O que foi lido**: \<lista curta\>
- **Achados**:
  - \<ponto 1\>
  - \<ponto 2\>
- **Riscos**: \<se houver\>
- **Recomendação conservadora**: \<ação mínima\>

### Modelo — resposta de alteração segura

- **Mudança proposta**: \<1–2 linhas\>
- **Escopo**: \<arquivos/rotas afetadas\>
- **Por que é seguro**: \<compatibilidade, sem mudança de contratos\>
- **Diff resumido**: \<stat + trechos-chave\>
- **Plano de teste**: \<checklist mínimo\>

### Modelo — resposta quando houver risco

- **Risco identificado**: \<o que pode quebrar e por quê\>
- **Evidência**: \<onde isso aparece\>
- **Opção conservadora**: \<alternativa menor / mitigação\>
- **Próximo passo recomendado**: \<como validar antes de mudar\>

### Modelo — resposta quando a melhor ação for não mexer

- **Motivo para não alterar agora**: \<instabilidade/contrato desconhecido/risco alto\>
- **O que precisa ser confirmado**: \<lista\>
- **Ação segura imediata**: \<documentar, adicionar guarda, observabilidade, etc.\>

---

## 12) Resumo final

Este projeto existe para **operar em produção com segurança**.  
A regra é: **compatibilidade acima de conveniência**. Mudanças devem ser **mínimas, reversíveis e bem auditadas**, protegendo **API, banco e integração Mercado Livre**.

