# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primário — equipe interna VenForce.** Gestores, analistas e auxiliares que operam, no Portal, as contas de clientes vendedores em múltiplos marketplaces (Mercado Livre, Shopee, TikTok Shop). É o público que passa o dia no sistema executando tarefas operacionais.

**Secundário — cliente vendedor.** Acesso restrito a funcionalidades e visualizações específicas (ex.: relatório de fechamento financeiro via link público com token, sem exigir login). Não opera o sistema como a equipe interna opera.

**Modelo operacional em transição — Squads.** A empresa está migrando para organizar a equipe em Squads (gestores, auxiliares, designers, cada um com uma carteira de clientes/marketplaces). Isso é um alvo arquitetural em introdução, não o estado atual completo do portal — não tratar todas as telas como já organizadas por Squad.

## Product Purpose

Transformar dados fragmentados da operação de marketplace (bases de custo próprias, pedidos, pagamentos, Ads e outras fontes dos marketplaces) em uma fonte operacional confiável e acionável para quem opera contas de clientes vendedores. Sucesso é a equipe conseguir, a partir de um único sistema, confiar no resultado (margem/LC-MC), identificar divergências e agir — sem depender de planilhas dispersas por cliente ou por marketplace.

## Positioning

O diferencial não é só "consolidar telas no lugar de planilhas": é cruzar dados próprios da operação (bases de custo, imposto, vínculos) com dados reais dos marketplaces (pedidos, pagamentos, Ads) para calcular margem/resultado, detectar divergências e manter rastreabilidade do que aconteceu.

O sistema mantém um contexto central que conhece cada cliente, produto, anúncio e marketplace, e os módulos (precificação, margem, fechamento financeiro/conciliação, Ads, Cliente 360, automações) operam sobre esse mesmo contexto compartilhado — não são telas isoladas.

O que é difícil de replicar é o conjunto: modelo de dados + vínculos entre fontes + regras operacionais acumuladas ao longo do tempo + conciliação/confiabilidade + histórico + automações construídas sobre esse contexto. Squads e a organização da equipe fazem parte da evolução operacional do produto, mas não são o mecanismo central de diferenciação.

## Operating Context

- Gestão de clientes e suas contas/lojas em cada marketplace (grants Mercado Livre, lojas Shopee, contas TikTok Shop).
- Importação e manutenção de bases de custo (upload de planilhas).
- Precificação e cálculo de margem de contribuição (MC) e lucro de contribuição (LC).
- Fechamento financeiro / conciliação de pedidos por marketplace (Central de Vendas / Fechamentos API), incluindo conciliação de pagamentos (Mercado Pago).
- Ads, diagnósticos, métricas, relatórios.
- Entrega de resultado ao cliente vendedor via relatório público com token (sem login).
- Extensão Chrome (VenForce Go) que sobrepõe custos no fluxo do Mercado Livre.
- Integração com ClickUp para rotinas/tarefas da equipe.
- Regras de produção documentadas em `GUIA_PARA_IA.md`: não quebrar contratos de API existentes, não alterar payloads/rotas sem autorização, não mexer em schema de banco sem autorização, extrema cautela com OAuth do Mercado Livre, bases de custo hoje são globais para a equipe (sem segregação por usuário), Portal é de uso interno.

## Capabilities and Constraints

- Backend: Node.js/Express + PostgreSQL (sem ORM), autenticação JWT.
- Frontend principal (Portal): predominantemente HTML/CSS/JS vanilla, múltiplas gerações visuais coexistindo historicamente (ver Evidence on Hand); adoção incremental e seletiva de React + Vite (`frontend-react/`) em superfícies específicas, não uma migração total do Portal — React já está em uso real em mais de uma tela (Cliente 360 e Central de Gestão Full), cada uma como build isolado publicado em `Portal/`.
- Extensão Chrome MV3 (VenForce Go) consumindo a mesma API.
- Mudanças estruturais grandes, migração total de stack, ou normalização de banco não são decisão unilateral de uma sessão de IA — exigem autorização explícita (regra do time, não só cautela genérica).
- Dados financeiros e de clientes (PII) são sensíveis — telas e fluxos que exibem valores, pedidos, dados de cliente ou tokens de acesso devem tratar essa informação com cuidado (não expor além do necessário, não vazar em logs/URLs desnecessariamente).
- Squads como camada organizacional é constraint em construção: não presumir que toda tela já reflete carteira/permissão por Squad.

## Evidence on Hand

- Documentação interna extensa em `docs/` (arquitetura, auditorias, migrações por tela) e nos `.md` na raiz do repo (ex.: `GUIA_PARA_IA.md`, `TELA_CENTRAL_VENDAS_V2.md`, auditorias de fechamento).
- Dados reais de produção via integrações com marketplaces (Mercado Livre, Shopee, TikTok Shop) e Mercado Pago.
- Ausência confirmada: nenhuma exigência formal de acessibilidade ou compliance foi indicada nesta rodada — não inventar certificações, benchmarks ou métricas que não estejam documentadas.

## Product Principles

1. Confiabilidade do dado vem antes de qualquer polish visual — o sistema existe para que a equipe confie no número antes de agir.
2. Contexto compartilhado entre módulos: uma tela não deve tratar cliente/produto/marketplace como se fosse uma ilha de dados própria.
3. Estabilidade de produção acima de conveniência — mudanças mínimas, reversíveis e auditáveis (herdado de `GUIA_PARA_IA.md`).
4. O cliente vendedor vê o resultado, não a operação — a experiência dele é deliberadamente mais restrita que a da equipe interna.
5. Squads é destino, não estado atual — tratar como evolução em andamento, não como arquitetura já implementada em todo o portal.
