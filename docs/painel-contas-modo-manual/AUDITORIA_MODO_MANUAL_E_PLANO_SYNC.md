# Painel de Contas: modo manual, auditoria e plano do sync automático

Branch `fix/painel-contas-modo-manual`, a partir de `origin/main` ca7660a.
Nenhuma migration, nenhuma env alterada, nenhum arquivo da Central de
Vendas, da Central de Margem, do scheduler ou do pool tocado.

## 1. Fluxo do lançamento manual (UI até o banco)

| Camada | Onde |
|---|---|
| UI | `LancamentoManualDrawer.jsx` → `usePainelContas.salvarManual` → `painelContasApi.salvarLancamentoManual` |
| Rota | `PUT /painel-contas/:clienteId/contas/:contaId/manual/:competencia` (`painelContasRoutes.js`). O gate é `authMiddleware + requireAutomacoesAccess + requireClienteNaCarteira` |
| Controller | `painelContasController.salvarLancamentoManual` |
| Service | `painelContasService.salvarLancamentoManual`. Ele valida o papel, a competência, a carteira, que a conta é do cliente e os valores (`painelContasManual.validarLancamento`) |
| Repository | `painelContasRepository.salvarLancamentoManual`. Faz UPSERT e grava o histórico na mesma transação |
| Banco | `painel_contas_lancamentos_manuais`, com UNIQUE `(cliente_conta_id, competencia)`, e `painel_contas_lancamentos_manuais_historico`. As tabelas já existem: o ensure lazy é `server/sql/painel_contas_schema.sql` |

A leitura passa por `GET /painel-contas`. Ela chama
`repo.listarManuaisDaCompetencia` e resolve a precedência em
`painelContasOperacional.resolverContas`.

## 2. Causa do "não salva" ou "volta"

O dado era gravado. Quem o escondia era a regra de precedência
**automático > manual**, aplicada em dois pontos:

1. **No salvar:** se a conta tinha import publicado da Central na competência,
   o PUT respondia `409 AUTOMATICO_DISPONIVEL` e nada era gravado. Isso vale
   para quase toda conta Mercado Livre conectada. A tela nem oferecia o botão,
   porque `podeLancarManual` era false para contas com import, e o drawer dizia
   "Todas as contas deste cliente já têm dado automático".
2. **Na leitura:** um manual gravado ANTES do import (por exemplo, numa conta
   sem dado ainda) era exibido até a próxima sincronização publicar um import.
   A partir daí a tela passava a mostrar a API, e o manual virava
   "substituído pelo automático". Para quem lançou, o valor "voltou".
3. Somado a isso, o drawer abria vazio quando o manual estava sob um
   automático (só preenchia quando a fonte exibida era manual). Isso reforçava
   a impressão de "não salvou".

Não existe escrita automática na tabela manual. O "sobrescrever" é de
**exibição**: a precedência faz a API vencer.

## 3. Automações que alimentam o Painel

O código não tem nenhum job horário.

| Automação | Disparo | Escreve | Exclusivo do Painel? |
|---|---|---|---|
| Scheduler interno noturno | `centralVendasNoturnoScheduler`, 03:00 SP, só com `CENTRAL_VENDAS_NOTURNO_ENABLED=true` | `central_vendas_sync_runs/imports/pedidos`, `ads_resumos_mensais`, `cliente_360_resumos_mensais` | Não. É da Central de Vendas e também alimenta o Cliente 360 |
| Render Cron Job | `server/jobs/syncCentralVendasNoturno.js`. O horário fica no painel do Render, fora do repo. Ligado, a menos que `CENTRAL_VENDAS_NOTURNO_ENABLED` seja `false`, `0` ou `off` | igual ao acima | Não |
| "Atualizar dados" do Painel | `POST /painel-contas/:id/atualizar/:competencia` (admin) | igual ao acima, com origem `painel-sob-demanda` | **Sim**. É a única escrita disparada PELO Painel |
| Sync manual da Central | `POST /operacao/central-vendas/:slug/sync-runs` | imports | Não |
| Sync do Cliente 360 | `POST /operacao/cliente-360/:slug/sincronizar` | `cliente_360_resumos_mensais` | Não |
| Polling da tela | `usePainelContas`, a cada 2,5 s, só enquanto houver "Atualizar dados" em execução | nada (só leitura) | Sim |

Se a operação percebe uma atualização "horária", a origem só pode ser o
agendamento do Render Cron Job, que fica fora do repositório. Vale conferir no
painel do Render. Com o modo manual, isso deixa de afetar o Painel: o manual
prevalece sobre qualquer import.

## 4. Precedência

**Antes**, por conta:

1. import publicado da Central (`published` com cobertura, ou `legacy`);
2. manual;
3. nada.

No consolidado:

- o snapshot `cliente_360_resumos_mensais` entra só se foi gerado com exatamente
  os mesmos imports e sem manual;
- sem nenhuma conta com dado, entra o snapshot do cliente;
- o Ads automático do cliente vence o manual.

O legado (planilha) entra como import `legacy`, na mesma regra M4 da Central.

**Agora (modo manual, o padrão):**

- **Por conta:**
  1. manual;
  2. import publicado, que aparece como referência (`referenciaApi`) quando há manual;
  3. nada.
- **Consolidado:** é a soma das contas. O snapshot nunca substitui um
  consolidado que tem manual, regra que já existia. O Ads lançado à mão vence
  o Ads automático do cliente.
- **Sem manual:** a conta continua mostrando o último dado conhecido da API.
  Isso não gera nenhuma escrita.

## 5. O que mudou

- **Flag nova `PAINEL_CONTAS_AUTO_UPDATE_ENABLED`** (`painelContasModo.js`):
  - ausente ou diferente de `"true"` liga o **modo manual**;
  - o padrão vale sem mexer em env no Render;
  - a flag é lida a cada requisição.
- **Salvar:** no modo manual, o 409 `AUTOMATICO_DISPONIVEL` deixa de existir.
  Qualquer conta ativa aceita lançamento, inclusive ML com import.
- **Leitura:** o manual prevalece. A API fica visível como referência, com um
  aviso.
- **"Atualizar dados":**
  - `POST` responde `409 PAINEL_MODO_MANUAL` antes de qualquer query, lock ou sync;
  - `permissoes.atualizarDados` vem false, então o botão some;
  - a lógica de lock/pool dos hotfixes não foi alterada, só ganhou esse gate
    na entrada.
- **Tela:**
  - faixa "Painel em modo manual";
  - regra "Modo manual: atualização automática desligada";
  - confirmação "Lançamento salvo · conta · competência · FAT · Origem: Manual";
  - o drawer abre preenchido com o valor gravado e mostra a referência da API.
- **Não mudou:**
  - Central de Vendas;
  - noturno, scheduler e Render Cron;
  - pool;
  - Central de Margem;
  - Fechamento;
  - Cliente 360;
  - autorização do Painel;
  - schema.

## 6. Reativar a automação

1. Corrigir o sync (seção 8) e validar.
2. No Render, definir `PAINEL_CONTAS_AUTO_UPDATE_ENABLED=true` no serviço web e
   reiniciar. Não precisa de deploy.

Efeito da reativação:
- o import volta a prevalecer;
- os manuais gravados continuam no banco, marcados "substituído pelo automático";
- "Atualizar dados" volta para admin;
- o PUT manual volta a recusar conta com import.

Para voltar ao modo manual, basta remover a env ou colocar qualquer valor
diferente de `true`.

## 7. Diagnóstico do sync automático (somente leitura)

- **Onde começa:**
  - o scheduler interno (`index.js`, que chama `centralVendasNoturnoScheduler.iniciar`);
  - o Render Cron (`jobs/syncCentralVendasNoturno.js`);
  - os botões manuais.

  Os três chamam o mesmo orquestrador, `centralVendasNoturnoService.executarRodada`:
  `criarSyncRun` → `executarSyncRun` (orders, shipments, claims, returns,
  base de custos e payments MP) → `sincronizarAdsCliente` →
  `reconstruirSnapshotMensal` (`centralVendasCliente360Adapter`).
- **O que alimenta:**
  - `central_vendas_imports` e `_pedidos`, que viram o número por conta no Painel;
  - `cliente_360_resumos_mensais`, o snapshot do cliente;
  - `ads_resumos_mensais`;
  - `central_vendas_sync_runs`, que viram o status no Painel.
- **Por que contas ficam parciais:**
  - a completude do run é a pior fonte obrigatória (orders, shipments, claims,
    base, mais returns quando existe);
  - **`RETURNS_UNRESOLVED`**: o coletor de devoluções busca claims de 01 do mês
    até hoje para pedidos de qualquer mês e conta os não resolvidos ANTES de
    filtrar pelos pedidos do período. Uma devolução de outro mês vira pendência
    do mês sincronizado. É um bug de escopo, conhecido desde 08/2026;
  - **base de custos incompleta:** um SKU sem custo deixa o LC e a MC
    "parciais" (sinal `custos` no Painel);
  - claims e permissões do ML (Post Purchase) também entram.
- **Por que algumas contas não atualizam sozinhas:**
  - o scheduler interno está desligado desde o incidente P0 de 02/10
    (religamento pendente);
  - o noturno cobre só o mês corrente até ontem. O mês anterior só é
    reprocessado nos dias 1 a 5; um mês fechado com dado ruim depois do dia 5
    não se corrige sozinho;
  - só o Mercado Livre tem sync. Shopee e TikTok são sempre manuais;
  - conta sem `external_account_id` ou com token inválido fica fora
    (`sem_conexao`);
  - o "Atualizar dados" guarda o job em memória, então um restart perde o
    acompanhamento. O dado publicado fica; um run preso só é reconciliado no
    próximo clique.
- **Erros atuais que impedem a atualização correta:**
  - o P0 de pool e deadlock está mitigado pelos hotfixes #218/#222/#223, mas o
    fechamento técnico ainda depende das ondas e da 1ª noite religada;
  - `RETURNS_UNRESOLVED` deixa o status "Pendências" e o botão "concluir"
    desabilitado na Central;
  - o Painel abre na competência corrente, então um clique sem trocar o
    seletor sincroniza o mês errado.
- **Relação com outras telas:** Painel, Central de Vendas e Cliente 360 leem o
  mesmo import e o mesmo snapshot. A Central de Margem é outra fonte
  (`margin_snapshot` / motor de margem) e não depende do Painel.

## 8. PLANO PARA CORRIGIR O SYNC AUTOMÁTICO

Fica numa branch e num PR separados, por exemplo
`fix/central-vendas-sync-confiavel`. Nada disso entra neste PR.

1. **Escopo das devoluções:**
   - contar `RETURNS_UNRESOLVED` só depois de filtrar pelos pedidos do período
     (`centralVendasClaimsService.resolverReturnsSemVinculo`);
   - classificar o não resolvido de outro mês como "fora do período", não como
     pendência;
   - teste com claim `resource=shipment` sem `order_id`.
2. **Reprocessamento de mês fechado:**
   - opção explícita (CLI ou admin) para re-sincronizar uma competência fechada
     depois do dia 5;
   - não muda o noturno padrão.
3. **Religar o scheduler com observabilidade:**
   - depois das ondas de validação do P0, critérios C1..C8;
   - expor no Painel a última rodada (início, fim, contas ok, parciais e falhas)
     em vez de inferir pelo run de cada conta.
4. **Render Cron × scheduler interno:**
   - deixar UM só mecanismo ativo;
   - documentar no repo o agendamento do Render;
   - o cron hoje fica ligado por padrão, ao contrário do scheduler, que é opt-in.
5. **Job do "Atualizar dados" persistente:**
   - ler o estado de `central_vendas_sync_runs` (`requested_by`, origem) em vez
     do registro em memória, para sobreviver a restart.
6. **Seletor de competência no clique:**
   - confirmar a competência no botão ("Atualizar setembro/2026") para evitar o
     run do mês errado.
7. **Contas sem conexão ou token:**
   - status acionável por conta (reconectar), alimentado pelo `mlTokenService`.
8. **Critério para reativar `PAINEL_CONTAS_AUTO_UPDATE_ENABLED=true`:**
   - 7 noites seguidas sem falha estrutural;
   - menos de X% de contas parciais por motivo diferente de custo;
   - diferença entre manual e API medida conta a conta, com o
     `referenciaApi` que este PR já expõe.

## 9. Riscos restantes

- **Divergência manual × API:**
  - enquanto o modo manual vale, o número exibido é o da equipe, mesmo quando
    a API tem dado melhor;
  - a referência da API aparece no aviso e no drawer;
  - erro de digitação também prevalece: existe auditoria e histórico, mas não
    há conferência automática.
- **Acesso ao Painel:**
  - a leitura exige coordenador do Squad ou gestor em `cliente_responsaveis`;
  - gestor sem esse vínculo recebe 403 e não chega a lançar;
  - é regra de autorização existente, não alterada aqui.
- **Central de Vendas e Cliente 360:** continuam mostrando a API. Não leem o
  manual, por desenho.
- **Render Cron Job:** se estiver agendado, continua sincronizando a Central.
  Isso não afeta o que o Painel exibe.
