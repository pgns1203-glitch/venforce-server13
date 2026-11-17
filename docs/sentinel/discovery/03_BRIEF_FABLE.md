# Sentinel — Briefing para análise de produto (Fable)

Base: `origin/main` em `b0ada21d`, 16/11/2026. Documento autossuficiente. Detalhes e linhas em `01_MAPA_ATUAL.md`; backlog em `02_OPORTUNIDADES.md`. Rótulos: **IMPL** (código existe), **TESTE** (há teste no repo; não executei), **HIST** (relato de produção sem prova atual), **N/V** (não verificado), **PROP** (proposta).

## 1. Visão e objetivo de negócio
A Venforce gere contas de Mercado Livre de clientes, organizadas em Squads. A direção pediu um motor 24h que confira a margem dos **pedidos concretizados** (não só o preço projetado do anúncio), avise o responsável quando algo exigir ação e permita mostrar à liderança "o motor funcionando". O objetivo estratégico é escala: um Squad cuidar de mais clientes sem conferir venda a venda, concentrando as pessoas nas exceções.

Dois estágios. **Monitor** (prioridade): observa, calcula, detecta, avisa e registra o tratamento, sem escrever no ML. Reduz o tempo entre o início do problema e a ação humana; **não impede a venda com prejuízo**. **Guard** (evolução): risco antes da venda e ações assistidas. Escopo inicial: só Mercado Livre, sem Mercado Pago (MP1 desligado em 16/11).

A tese do produto é que o Sentinel só vale se a pessoa certa recebe o aviso e consegue agir. Uma fila que ninguém abre não cumpre isso.

## 2. Contexto real da operação
- Portal Venforce (Express + PostgreSQL no Render + front HTML/JS). Identidade: cliente (empresa) → várias `cliente_contas` (conta ML). **Conta 41 = Red Fish** (não confundir com id de cliente). Contas 86 (Alianza Jeans 1) e 3 (Influencia Jeans) foram cogitadas; não há autorização para elas.
- Carteira: Squad ativo do cliente (`cliente_squad_history`); interno vê só clientes dos seus Squads; seller não usa o Sentinel. Responsáveis por cliente (gestor/auxiliar/designer) existem em `cliente_responsaveis`, mas **não** concedem acesso e o Sentinel não os usa.
- Quem cobra: a direção. O usuário que opera o Sentinel prefere tarefas pequenas, branch isolada, diff claro e gates de aprovação.
- Piloto (HIST): conta 41 ligada em 28/10 com worker e allowlist; erro de frete em packs achado e corrigido pelo PR #362 (104 pedidos em 47 envios compartilhados; 7 incidentes espúrios ficaram inativos). **Estado de produção hoje: N/V** (flags, allowlist, checkpoint, vigia, logs).

## 3. Fluxo técnico existente
1. **Coleta:** worker separado (`sentinelWorker.js`, OFF sem `SENTINEL_WORKER_ENABLED`, allowlist de contas, pool próprio de 2 conexões). Poll a cada 180 s via `/orders/search` por `date_last_updated`, overlap de 2 h, 500 chamadas/conta e 300 s por ciclo, checkpoint por conta. Token sempre `noRefresh`; token ruim ⇒ erro explícito, nunca renovação.
2. **Cálculo:** reusa `buildMotorFromOrders` da Central de Vendas. Custo da base da conta (MLB/SKU/variação), frete via `/shipments/:id/costs`, pack rateado pela receita em centavos (peso só para `paid`/`partially_refunded`), pack incompleto ⇒ frete NULL. Resultado em `sentinel_pedidos` (upsert por conta+pedido), estado `confirmada|provisoria|sem_custo|custo_ambiguo|erro`.
3. **Classificação:** elegibilidade (venda/ressalva/excluído) e confiabilidade (inconclusivo/pendente/calculado/confirmado).
4. **Incidentes:** ao fim de cada ciclo, 3 detectores gravam em `sentinel_incidentes` (única por conta+tipo+chave) e `sentinel_incidente_eventos`.
5. **API/UI:** `/sentinel/*` (resumo, incidentes, detalhe, contas, saúde, reconhecer, resolver) com carteira resolvida no servidor; `Portal/sentinel.html` com KPIs, fila, detalhe, saúde e demo fictícia.
6. **Vigia:** tick de 15 min no Express (flag `SENTINEL_VIGIA_LEITURA_ENABLED=1`) para detectar worker parado.

## 4. Dados disponíveis e limitações
Disponível e confiável (IMPL/TESTE; paridade E0 com a Central HIST): faturamento, comissão, frete, custo, imposto e margem por pedido, estado e pendências, itens, datas, checkpoint por conta, exceções por pedido.

Limitações que condicionam o produto:
- **Sem claims/devoluções:** `claims_verificado=false` fixo ⇒ nada é "confirmado"; o máximo é `calculado`. Texto de UI e aviso devem dizer "contribuição calculada", nunca "lucro".
- **Sem promoção/rebate/subsídio por pedido** como campo próprio; vêm embutidos no motor da Central. Causa de prejuízo por promoção não é separável hoje.
- **Sem validadores independentes** (V1–V9 só em plano); a única contraprova é teste de paridade contra a Central.
- **Sem reconciliação por ID** (D-1): não se prova que nenhum pedido ficou de fora.
- **Só polling**; webhooks não existem.
- **Amostra real pequena:** massa histórica de uma conta; limiares não calibrados.
- Ausência é sempre `null` + motivo, nunca zero presumido (princípio respeitado no código).

## 4-A. Precisão financeira: preço, promoções, rebate e subsídio
Escopo: o que o código e o handoff sustentam. Não auditei Anúncios, Central de Margem nem Resgate; o que os envolve abaixo é hipótese ou dependência.

- **Preço comprador × preço cheio.** O Sentinel usa o que o pedido registra (preço × quantidade dos itens), isto é, o preço efetivamente praticado. Preço cheio do anúncio e desconto concedido **não são gravados** em `sentinel_pedidos`; logo ele não distingue "vendeu em promoção" de "vendeu a preço cheio". Hipótese a validar: o pedido do ML pode trazer o preço original do item; não confirmei o campo.
- **Subsídio do ML × desconto do vendedor.** Não há campo para a parte bancada pelo ML e a bancada pelo vendedor. O handoff diz que o rebate pode vir embutido no componente líquido da tarifa. Sem separar quem financiou, o Sentinel não explica se uma perda veio de promoção do vendedor ou de subsídio parcial.
- **Rebate e contagem dupla.** Regra do handoff: somar rebate/subsídio só quando **não** estiver incorporado ao componente líquido. Essa garantia vem do motor da Central, reutilizado; não há validador independente (V6 é proposta). Um erro do motor se propaga igual e a paridade não o detecta.
- **Comissão, frete, custo, imposto.** Comissão e frete vêm do motor/ML e podem mudar depois da venda; frete de pack é rateado (PR #362) e fica `null` se o pack estiver incompleto. Custo vem da base da conta, com risco de SKU/variação errados. Imposto ausente deixa o pedido `provisoria`. Toda ausência é `null` com motivo.
- **Observado, provisório, estimado.** *Observado*: valores presentes no pedido e no custo de envio, ainda sujeitos a claims não verificados (por isso `calculado`, nunca `confirmado`). *Provisório*: calculado com pendência (`provisoria`, exposto como `pendente`). *Estimado*: não existe hoje; exposição futura seria projeção com premissas, nunca somada à perda observada. `custo_pendente` mede receita exposta, não prejuízo.
- **Anúncios, Central de Margem, Resgate.** A Central projeta por anúncio; o Sentinel observa por venda. Previsto × observado (R7) só vale com mesma data, itens, status e versão de regra. Se Anúncios ou Resgate calculam promoção, participação ou subsídio por regra própria, a divergência é **hipótese a investigar**, não bug presumido. Não verifiquei contratos nem unidades de valor desses módulos.
- **Lacunas.** Sem promoção/financiador por pedido; sem claims/devoluções; sem validador independente de comissão, frete e rebate; sem prova de que o motor reflete mudanças recentes de promoção da Central.

## 5. Funcionalidades implementadas (IMPL; TESTE salvo nota)
- Polling incremental, checkpoint, exceções com retentativa/quarentena.
- Margem por pedido com reuso do core e paridade com a Central.
- Frete de pack sem cobrança duplicada.
- Detectores: `margem_negativa` (agrupa por MLB; severidade por perda ≥R$100/≥R$500 ou ≥3/≥10 pedidos), `custo_pendente` (impacto = receita exposta ≥R$500/≥R$2000, explicitamente não é prejuízo), `leitura_atrasada` (>120 min ou erro de token/API).
- Ciclo de vida: aberto → reconhecido → resolvido (humano, motivo obrigatório); reabertura só por pedido/atraso novo; condição que some vira `condicao_encerrada` sem resolver; evento `atualizado` só se a evidência mudar.
- Acesso por carteira no servidor, 404 igual para inexistente e fora de escopo.
- UI com fila, filtros, detalhe, saúde, link para a Central de Margem com `?mlb=`.

## 6. Problemas comprovados
1. **Nenhuma notificação por pessoa.** Não há tabela, serviço, canal Portal nem e-mail/WhatsApp/Discord; a UI só carrega quando aberta (sem timer, sem contador no menu).
2. **Incidente sem responsável**: não há dono gravado; o ator de reconhecer/resolver é texto livre.
3. **Vigilância do próprio monitor frágil**: depende de flag no Express; "sem progresso por orçamento" e "avaliação falhou" só vão para log; conta fora da allowlist não gera aviso.
4. **Agravamento sem consumidor:** a severidade muda (evento com antes/depois) e ninguém é alertado.
5. **Frete de pack** já produziu falsos prejuízos; foi corrigido, mas a revalidação antes de expandir contas é requisito (HIST).
6. **Limiares globais** podem gerar ruído ou silêncio conforme o porte da conta.
7. Dependência do Portal para renovar token; falha de token é crítica, mas depende de alguém agir.

## 7. Questões ainda não decididas
- **Superfície do aviso:** card em Carteira/Visão, sininho no shell (`vf-shell.js`, área restrita) ou página dedicada.
- **Destinatário primário:** gestor do cliente, coordenador do Squad ou ambos; desempate com várias contas/Squads; fallback admin.
- **Escalonamento** se não houver reconhecimento e prazo de resposta (SLA).
- **Visão da liderança** sem poluir quem gere uma conta.
- **"Condição sumiu" × "humano resolveu":** hoje o motor nunca resolve; pode ser desejável auto-encerrar com auditoria?
- **Silenciar/ignorar** incidente: permitir? com que auditoria?
- **Retenção** de `sentinel_pedidos` e incidentes.
- **Estado real de produção** e qual conta é a próxima.
- **Canais externos** (WhatsApp etc.) só após Portal confiável.

## 8. Melhores oportunidades (detalhe em `02_OPORTUNIDADES.md`)
Ordem sugerida, a validar: (1) **inbox individual com dedupe por incidente+severidade**; (2) **responsável congelado e auditável** no evento; (3) **heartbeat do monitor independente do Portal**, promovendo falhas do motor a incidente de sistema; (4) **calibração de limiares por conta**; (5) **central "o que fazer agora"** com tempo detecção→aviso→reconhecimento; depois **recorrência por MLB**, **causa provável do prejuízo** (componente dominante vs mediana do próprio MLB), **agrupamento por causa comum**, **reconciliação D-1**, **claims/devoluções**. Visão: risco pré-venda (Guard) e anomalia estatística, só após calibração.

Observação sobre integração: as oportunidades 1–3 compartilham um **log de eventos como fonte única** (`sentinel_incidente_eventos`), e as 6–8 dependem do mesmo detalhamento por componente em `sentinel_pedidos`. Isso sugere um desenho em que a notificação, o SLA e a medição de valor derivam do mesmo evento, em vez de três mecanismos.

## 9. Restrições de arquitetura (inegociáveis)
- Monitor sem escrita no ML (anúncio, preço, promoção). Guard só como evolução, com política, auditoria e rollback.
- `null` + motivo para ausência; nunca zero presumido. Contribuição calculada ≠ lucro confirmado.
- Reusar o core financeiro da Central e **acrescentar** validação independente, em vez de uma segunda fórmula.
- Idempotência de pedidos e incidentes; reprocessar não duplica.
- `noRefresh: true` no worker; renovação de token só no Portal.
- Worker separado do Express, pool próprio, orçamento de chamadas; falha do Sentinel não derruba o Portal.
- Acesso por carteira/Squad no servidor; filtros só estreitam.
- Frete de pack contado uma vez; MP1 fora; sem tocar na frente de PostgreSQL/Central/Margem além das interfaces.
- Áreas protegidas sem autorização específica: `mlClient.js`, `tokenRefreshWorker.js`, `layout.js`, `style.css`, `vf-shell.js` (nav).
- Sem migration, flag, deploy ou expansão de conta sem autorização explícita.

## 10. Perguntas estratégicas para raciocínio aprofundado
1. **Qual é o contrato mínimo de "aviso entregue"** (gerado, exibido, visto, reconhecido) e qual métrica prova ao diretor que o motor funciona sem inventar "perdas evitadas"?
2. **Como derivar o destinatário** (gestor → coordenador → admin) de modo estável, auditável e sem confundir responsabilidade com autorização?
3. **Como equilibrar sensibilidade e ruído** com uma única amostra real: limiares relativos por conta, janela de observação antes de notificar, ou notificação só de críticos no começo?
4. **Quando um incidente de condição encerrada deve fechar sozinho**, e o que impede que isso esconda risco recorrente?
5. **O que precisa existir antes de chamar qualquer prejuízo de "confirmado"** (claims, devoluções, rebate): vale entregar valor sem isso, e como comunicar a incerteza a quem decide?
6. **Qual desenho integra aviso, SLA, recorrência e causa provável** num único modelo de evento, em vez de features paralelas?
7. **Como o Monitor detecta a própria falha** sem depender de componente que também pode cair (worker, Express, flag)?
8. **Qual é o critério de expansão** da conta 41 para as próximas contas, e quais medições (429, latência venda→detecção, falso positivo, tamanho do banco) autorizam o passo?
9. **Qual o papel do Sentinel frente à Central de Margem:** só observar e linkar, ou alimentar previsto × observado (R7) quando as bases forem comparáveis?
10. **Onde termina o Monitor e começa o Guard**, e qual sinal do Monitor justificaria o primeiro experimento de prevenção?

## Limitações das evidências
Li o código da `main` em `b0ada21d` e o handoff; **não** executei testes, worker nem consultei Render/PostgreSQL. Linhas dos detectores e fluxos foram lidas, não rodadas. Valores históricos (R$ 1.713 / R$ 1.725,52, 7 incidentes, 50 mil pedidos em 70 s) vêm do handoff e de `docs/sentinel/`, de fases diferentes; não os some. Não abri todo o Portal: a ausência de notificação foi apurada por busca direcionada (tabelas, serviços de e-mail/mensageria, endpoints), não por leitura integral do `vf-shell.js`.
