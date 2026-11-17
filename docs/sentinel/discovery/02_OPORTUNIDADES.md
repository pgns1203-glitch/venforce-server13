# Sentinel — Backlog de oportunidades

Base: `01_MAPA_ATUAL.md` (SHA `b0ada21d`). Esforço: P/M/G. "Novo" = não estava nos planos V1–V3 nem no handoff. Nada aqui é recomendação definitiva: é matéria para a análise do Fable. Prioridade considera valor × evidência de dados × risco.

## MVP (fecha o produto como "Monitor")

### O1. Entrega do aviso ao responsável (inbox individual) — plano existente, lacuna P0
- **Problema:** incidente existe, mas ninguém é avisado; o produto só "apita" se a pessoa certa receber.
- **Usuário:** gestor do cliente, coordenador do Squad, admin como fallback.
- **Evidência:** inexistência de qualquer canal de notificação (mapa §7); eventos `aberto/atualizado/reaberto` já gravados com severidade antes/depois (`sentinelIncidentes.js:443`).
- **Dados:** evento do incidente + destinatário derivado de `cliente_responsaveis` (gestor) → Squad (coordenador) → admin. Todos já existem; falta a tabela de notificação e a regra.
- **Funcionamento:** uma notificação por `(incidente, versão de severidade)`; gerada **na mesma transação** do evento; estados gerada→vista→reconhecida; sem aviso por pedido.
- **Falso positivo:** só notificar `critica`/`alta` e condições com confiabilidade ≥ calculado; `baixa/média` ficam em resumo diário.
- **Benefício:** transforma o motor em produto. **Complexidade:** M. **Risco:** ruído se limiares não calibrados (ver O4). **Prioridade: 1.**

### O2. Responsável congelado e auditável no incidente — novo
- **Problema:** hoje ator e Squad são texto/derivação; se o gestor muda, o histórico perde "quem deveria agir".
- **Evidência:** `sentinel_incidentes` sem colunas de dono (mapa §5).
- **Dados:** snapshot do destinatário no momento do evento; motivo do fallback.
- **Funcionamento:** gravar `responsavel_user_id`, `origem_roteamento` (gestor/coordenador/admin_fallback) no evento; reatribuição vira evento.
- **Benefício:** prova de que "alguém foi responsável"; habilita SLA. **Complexidade:** P–M. **Risco:** baixo (aditivo). **Prioridade: 2** (par do O1).

### O3. Heartbeat do monitor independente do Portal — novo
- **Problema:** a vigilância do worker morto depende de flag no Express e de alguém abrir a Saúde (mapa §8).
- **Evidência:** `server/index.js:883`; `SENTINEL_SEM_PROGRESSO` e `incidentesErro` só em log.
- **Dados:** `ultima_execucao_em` (já existe) + resultado de cada ciclo.
- **Funcionamento:** o incidente `leitura_atrasada` e falhas de avaliação viram notificação **ao admin/coordenador**, avaliada por um tick que não dependa do worker; promover "sem progresso por orçamento" e "avaliação falhou" a tipos de incidente de sistema.
- **Falso positivo:** limite configurável + carência no boot do Render.
- **Benefício:** acaba com a falha silenciosa total. **Complexidade:** P–M. **Risco:** baixo. **Prioridade: 3.**

### O4. Calibração por conta antes de ampliar alertas — novo
- **Problema:** R$100/R$500/3/10 são globais; conta pequena nunca chega a "crítica", conta grande vira ruído.
- **Evidência:** `configIncidentes` (l.36-47); o handoff §7 diz "não afirmar como limites aprovados".
- **Dados:** distribuição histórica de `sentinel_pedidos` (margem, faturamento) por conta; hoje só a conta 41 tem massa (HIST).
- **Funcionamento:** limiares relativos (% do faturamento 30d, ou vezes o ticket médio) como proposta a validar com dados da conta 41 antes de impor.
- **Benefício:** menos alerta, mais ação. **Complexidade:** M. **Risco:** calibrar com amostra de uma conta. **Prioridade: 4.** Depende de dados reais.

### O5. Painel "o que fazer agora" + prova de ponta a ponta para a direção — plano existente
- **Problema:** direção quer ver o motor trabalhando; hoje a UI é fila + saúde.
- **Evidência:** `sentinel.js` (KPIs de saúde, fila); handoff §8 e §13.
- **Funcionamento:** fila ordenada por severidade × impacto; "meus alertas"; cobertura e última coleta por conta no topo; tempo detecção→aviso→reconhecimento medido (depende de O1/O2).
- **Benefício:** apresentável. **Complexidade:** M. **Risco:** UI sem notificação real vira vitrine. **Prioridade: 5.**

## Próximas fases

### O6. Incidente de recorrência por produto (SKU/MLB) — plano parcial (R4)
- **Problema:** o mesmo anúncio perde dinheiro toda semana, é resolvido e volta.
- **Evidência:** `vezes_reaberto`, `pedidos_ids`, evolução semanal já em `detalhes`.
- **Funcionamento:** contador de reincidências por MLB em 30/60/90 dias; elevar severidade e exigir causa-raiz no "resolver".
- **Falso positivo:** não contar reabertura por pedidos antigos relidos; só ID novo (já é a regra).
- **Complexidade:** M. **Risco:** baixo. **Prioridade: 6.**

### O7. Classificador de causa provável — novo
- **Problema:** gestor recebe "margem negativa" mas precisa saber se é custo, frete, comissão ou promoção.
- **Evidência:** `sentinel_pedidos` guarda faturamento, comissão, frete, custo, imposto por pedido.
- **Cálculo:** para cada pedido negativo, componente dominante = o de maior desvio vs mediana do mesmo MLB nos últimos N pedidos **positivos**; reportar "frete 3× a mediana". Só com ≥N amostras; senão "indeterminado".
- **Ação:** link direto para o ajuste correspondente (custo na base, Bancada).
- **Dependência:** promoção/rebate não está em `sentinel_pedidos` (lacuna de dado).
- **Complexidade:** M. **Risco:** explicação errada se amostra pequena. **Prioridade: 7.**

### O8. Agrupamento de incidentes por causa comum — novo
- **Problema:** 15 MLBs com o mesmo frete anômalo viram 15 incidentes.
- **Evidência:** chave atual é só MLB; frete de pack já mostrou causa sistêmica (7 incidentes espúrios HIST).
- **Funcionamento:** incidente "pai" por (conta, causa) agrupando filhos; um aviso.
- **Complexidade:** M–G. **Risco:** modelagem de pai/filho; depende do O7. **Prioridade: 8.**

### O9. Reconciliação D-1 e cobertura por ID — plano existente
- **Problema:** não se prova que todos os pedidos do dia foram processados.
- **Evidência:** nenhum mecanismo; polling por `date_last_updated` com overlap de 2 h.
- **Dados:** `/orders/search` por `date_created` do dia anterior × `sentinel_pedidos`.
- **Funcionamento:** faltantes viram incidente de sistema; métrica "cobertura D-1 = 100%".
- **Complexidade:** M. **Risco:** custo de chamadas ML. **Prioridade: 9.**

### O10. Claims e devoluções para chegar a "confirmado" — plano existente
- **Problema:** `confirmado` inalcançável; prejuízo "calculado" pode ser revertido ou ampliado por devolução.
- **Evidência:** `claims_verificado=false` fixo; confiabilidade máxima `calculado`.
- **Dependência externa:** endpoints de claims/returns do ML e política de leitura; o MP1 está desligado e fora do escopo (handoff §1).
- **Complexidade:** G. **Risco:** alto (semântica de estados). **Prioridade: 10.**

## Visão futura

### O11. Risco antes da venda (Guard G1) — plano existente
Varrer anúncios com margem projetada < meta e fazer "preview de prejuízo". Reusa Central de Margem; só leitura nesta fase. Depende de snapshot confiável e de calibração (O4). **Complexidade:** G.

### O12. Detecção de anomalia estatística e previsão de exposição — novo
Pontuar pedidos fora do padrão histórico do MLB (comissão/frete/preço) e estimar exposição "se continuar vendendo no ritmo atual" com premissas explícitas. Requer meses de histórico por conta; não recomendado antes de O4/O7. **Complexidade:** G. **Risco:** confiança baixa sem dados.

## Resumo de sequência sugerida (para discussão)
O1+O2 → O3 → O4 → O5 → O6/O7 → O9 → O8 → O10 → Guard. **O1 depende de decisão de superfície** (card em Carteira, sininho em `vf-shell.js`, ou página dedicada), ainda aberta.
