# PROMPT MASTER — CLAUDE CODE
# IMPLEMENTAÇÃO CLIENTE 360 V3 / CARRO-CHEFE VENFORCE

Você está atuando como **engenheiro principal de implementação** do VenForce.

Sua missão é transformar a arquitetura de produto da nova Cliente 360 em implementação real, usando a auditoria técnica já realizada como mapa-mestre.

Este NÃO é um exercício de ideação.

A arquitetura de produto já foi discutida.
A auditoria técnica já foi feita.
Agora é hora de implementar com segurança, fase por fase, preservando o sistema atual até a nova 360 atingir paridade.

---

# 0. LEITURA OBRIGATÓRIA ANTES DE ALTERAR QUALQUER CÓDIGO

Leia integralmente, nesta ordem:

1. `Projeto_cliente360/VENFORCE_CLIENTE_360_CARRO_CHEFE_ARQUITETURA*.md`
2. `Projeto_cliente360/AUDITORIA_PLANO_IMPLEMENTACAO_CLIENTE360_CARRO_CHEFE.md`
3. `Projeto_cliente360/PROMPT_CODEX_AUDITORIA_IMPLEMENTACAO_CLIENTE360.md`, se existir, apenas como contexto da auditoria
4. `Squads_migration/VENFORCE_V3_P2_9_DECISOES_FINAIS_APROVADAS.md`, se existir
5. documentação relevante em `venforce_md_v2/` somente quando necessária para confirmar contratos/domínios

Depois confronte tudo com o código atual.

A auditoria técnica é o principal mapa de implementação desta missão.

NÃO simplifique a arquitetura para um SaaS genérico.

A meta continua sendo:

> Cliente 360 = central de inteligência da operação do Cliente, alimentada por Central de Vendas, V2, Ads, Full, Margem, Diagnóstico, Financeiro e contexto ClienteConta.

---

# 1. PRINCÍPIO CENTRAL

A unidade principal de análise da nova Cliente 360 é:

```text
CLIENTE
+
CLIENTE_CONTA
+
COMPETÊNCIA
```

Exemplo:

```text
N97 Comercial
+
Mercado Livre Principal
+
Agosto/2026
```

Todo bloco account-scoped deve falar da MESMA ClienteConta.

Não selecionar conta silenciosamente.

Não usar:

```text
contas[0]
bases[0]
grants[0]
```

como regra de produto.

Marketplace deve ser derivado da ClienteConta sempre que o contrato permitir.

---

# 2. NÃO CONFUNDIR CURRENT STATE COM TARGET

O código atual ainda não implementa integralmente o modelo alvo de Squads.

O target aprovado permanece conceitualmente:

```text
ROLE
↓
SQUAD MEMBERSHIP
↓
SQUAD ATIVO DA SESSÃO
↓
CARTEIRA DO SQUAD
↓
CLIENTE
↓
CLIENTE_CONTA
↓
MÓDULOS
```

Se encontrar dívida técnica ou ausência de `Squad ativo`, NÃO remova o conceito do target.

Implemente a Cliente 360 de forma compatível com o Shell atual e sem bloquear a evolução posterior do Squad ativo.

A Cliente 360 deve HERDAR contexto do Shell.

Ela não deve se tornar autoridade de autorização.

---

# 3. ESTADO SUJO / CONCORRÊNCIA — REGRA CRÍTICA

Antes de alterar qualquer arquivo:

```bash
git status --short
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
```

Registre mentalmente o estado.

O repositório estava DIRTY durante a auditoria.

Há trabalho paralelo principalmente em:

- Financeiro;
- incidentes de fechamento;
- `server/index.js`;
- arquivos não rastreados;
- documentação.

NÃO:

- restaurar arquivos;
- limpar working tree;
- resetar;
- stash;
- checkout de arquivo;
- apagar trabalho de outro agente;
- sobrescrever mudanças alheias.

Se precisar tocar em um arquivo já alterado por outro trabalho, primeiro:

1. leia o diff existente;
2. preserve integralmente alterações não relacionadas;
3. faça somente alteração mínima necessária;
4. registre isso no relatório final.

Se houver conflito real com trabalho paralelo:

marque como BLOQUEIO e pare essa subparte.

---

# 4. SEGURANÇA DE BANCO / PRODUÇÃO

NÃO:

- abrir `.env` de produção sem necessidade;
- executar migration em banco real;
- rodar SQL mutável;
- fazer backfill;
- iniciar servidor apontando para produção;
- executar job de sincronização real;
- chamar OAuth real;
- chamar API externa destrutiva;
- publicar entrega;
- alterar dados de cliente real.

Pode:

- criar código;
- criar testes;
- criar migrations aditivas SOMENTE se uma fase explicitamente exigir e a decisão humana estiver resolvida;
- executar testes locais seguros;
- executar build local;
- usar mocks/fakes/fixtures.

Não execute migration criada.

---

# 5. REGRAS TEMPORÁRIAS PARA DECISÕES HUMANAS AINDA NÃO FECHADAS

Para permitir avanço técnico sem inventar produto, use estas regras conservadoras e REVERSÍVEIS:

## 5.1 Dados `cliente_conta_id IS NULL`

Tratar como:

```text
client_legacy
```

Nunca atribuir automaticamente a uma ClienteConta.

Não fazer backfill inferido.

## 5.2 Ads mensal legado sem ClienteConta

NÃO usar como verdade account-scoped da nova 360.

Pode aparecer somente se explicitamente marcado como:

```text
client_legacy
```

Para account-scoped, preferir fonte Ads realmente identificada por conta.

Não migrar tabela de Ads nesta missão sem necessidade comprovada.

## 5.3 Margem alvo

Preservar comportamento/configuração já existente.

Não trocar 10% por 15% ou vice-versa globalmente.

Expor origem/configuração quando necessário.

## 5.4 Intervenções

Preservar gates atuais.

Não ampliar autorização.

## 5.5 Entregas

Nova leitura deve preferir entrega account-scoped quando existir.

Entrega com conta NULL continua `client_legacy`.

Não atribuir retroativamente.

## 5.6 Não-MELI

Não fingir account-awareness.

Se o backend não consegue provar escopo da conta:

```text
disponivel: false
motivo: "account_scope_unverified"
```

ou equivalente compatível.

Não somar dados client-level para preencher uma UI vazia.

Estas regras são guardrails de implementação, não decisão definitiva de produto.

---

# 6. ARQUITETURA DE PRODUTO A PRESERVAR

A nova Cliente 360 deve evoluir para algo conceitualmente assim:

```text
CLIENTE 360
│
├── Resultado
├── Por que mudou
├── Produtos
├── Oportunidades
├── Simulador
├── Ads
├── Full
├── Margem
├── Confiança
├── Saúde
├── Histórico
└── Cliente / operações
```

Princípio:

```text
ENTENDER / ANALISAR
→ permanece na Cliente 360

EDITAR / EXECUTAR
→ vai para o módulo dono
```

Não copiar Central de Vendas inteira.

Não copiar Full inteiro.

Não copiar Margem inteira.

Não copiar Financeiro inteiro.

A 360:

```text
CONSUME
RESUME
CRUZA
PRIORIZA
EXPLICA
```

e aprofunda por drawer/deep-link.

---

# 7. ESTRATÉGIA DE IMPLEMENTAÇÃO

Implemente em FASES SEQUENCIAIS.

NÃO pule uma fase porque a próxima é visualmente mais interessante.

Após cada fase:

1. execute os testes relevantes;
2. execute lint/build apenas quando seguro e necessário;
3. revise `git diff`;
4. corrija regressões;
5. registre progresso no relatório de implementação;
6. só avance se os critérios de aceite da fase estiverem satisfeitos.

Se uma fase depender de uma decisão humana não coberta pelos guardrails da seção 5:

PARE apenas essa subparte,
registre `DECISÃO HUMANA NECESSÁRIA`,
e continue somente onde for independente.

---

# FASE 0 — ACCOUNT-AWARENESS E PARIDADE FINANCEIRA

## Objetivo

Corrigir o bloqueador principal:

A Cliente 360 V2 atual NÃO é ClienteConta-aware ponta a ponta.

Antes de criar a nova tela, fazer Resultado/Ponte/Produtos/Confiança/Recuperação/Simulador/Série operarem sobre um universo de conta explícito.

## Auditar novamente antes de editar

Releia:

- `server/controllers/cliente360ResultadoController.js`
- `server/services/cliente360/cliente360ResultadoService.js`
- `server/services/cliente360/cliente360FechamentoAdapter.js`
- `server/services/cliente360/cliente360PonteEngine.js`
- `server/services/cliente360/cliente360ProdutosEngine.js`
- `server/services/cliente360/cliente360ConfiancaEngine.js`
- `server/services/cliente360/cliente360RecuperacaoEngine.js`
- `server/services/cliente360/cliente360SimulacaoService.js`
- `server/services/cliente360/cliente360SerieService.js`
- Central de Vendas Repository/Service/ReadService
- testes V2 e CV existentes

## Implementar

Transportar explicitamente `clienteContaId`:

```text
controller
→ ResultadoService
→ FechamentoAdapter
→ Central de Vendas repository/service
→ motores derivados
```

Marketplace deve ser resolvido/validado a partir da ClienteConta quando aplicável.

O contrato deve rejeitar:

- conta de outro Cliente;
- conta inativa;
- conta sem autorização;
- marketplace incompatível.

NÃO escolher primeira conta.

## Política legacy

Conta explícita:

```text
cliente_conta_id = conta
```

Não transformar conta explícita em:

```text
conta OR NULL
```

sem justificativa de compatibilidade formal.

Dados NULL ficam legacy e não podem contaminar leitura account-scoped.

## Paridade matemática

Não basta transportar a conta.

A auditoria identificou risco de divergência entre:

- resultado da Central de Vendas;
- Ponte V2;
- regras de computabilidade;
- rateio de frete/comissão;
- custos ausentes.

Crie testes/fixtures cobrindo:

- 2 contas MELI no mesmo Cliente;
- mesmo MLB/SKU nas duas contas;
- imports diferentes;
- dados NULL legacy;
- pedido multi-item;
- custo ausente;
- frete parcial;
- comissão;
- imposto;
- cancelado/pós-venda;
- ajustes;
- mês parcial.

Critério:

> o número apresentado como Resultado e o universo usado para explicar esse Resultado precisam ser reconciliáveis.

Não altere fórmula silenciosamente apenas para "fechar".

Se existir divergência estrutural entre CV e Ponte:

documente;
crie adapter/normalização explícita;
preserve semântica.

## Simulador

Cenário neutro deve reconciliar com sua base.

Registrar claramente premissas.

Não transformar estimativa em causalidade comprovada.

## Aceite Fase 0

- conta A não lê B;
- B não lê A;
- NULL legacy não entra silenciosamente;
- marketplace não é livre quando conta já define marketplace;
- Resultado/Ponte usam universo compatível;
- testes multiconta existem;
- V2 antiga continua funcionando ou possui compatibilidade aditiva;
- nenhuma tela antiga removida.

---

# FASE 1 — FUNDAÇÃO DA NOVA CLIENTE 360 V3

## Objetivo

Criar nova ilha React isolada e coexistente.

NÃO substituir Visão, V1 ou V2 ainda.

## Estratégia

A auditoria recomendou:

> nova ilha React, reaproveitando integração de contexto da Visão e apresentação/motores da V2.

Siga isso salvo evidência técnica nova muito forte em contrário.

## Criar

Uma nova entrada/host, com nome consistente com os padrões do projeto.

Exemplo conceitual:

```text
cliente-360-v3
```

Mas primeiro confira convenções reais do Vite/Portal.

## Integrar com Shell

Reutilizar:

- `vf-shell`;
- `vf-context`;
- `useVfContext`;
- evento/contexto já existente.

A nova página NÃO deve ter seletor independente de Cliente.

Ela deve receber:

```text
cliente
clienteConta
marketplace derivado
periodo
compararCom
```

Período deve ser canônico e validado.

## ContextKey

Crie um conceito explícito de contexto da resposta:

```text
clienteId/slug
+
clienteContaId
+
periodo
+
compararCom
```

Ao trocar qualquer um:

- cancelar requests;
- limpar drawers;
- invalidar payload incompatível;
- não exibir dado da conta anterior enquanto a nova carrega.

## Bootstrap V3

Criar contrato aditivo.

Não quebrar `/operacao/cliente-360` atual.

O bootstrap deve ser pequeno.

Preferência:

```text
contexto
capabilities
resultado
comparacao
ponte/resumo
confianca/resumo
saude leve
```

Não carregar Ads externo, Full, Margem profunda e histórico completo no boot.

## Envelope padrão por bloco

Adotar contrato equivalente a:

```json
{
  "disponivel": true,
  "motivo": null,
  "codigo": null,
  "escopo": "account",
  "fonte": {
    "nome": "central_vendas",
    "versao": null,
    "geradoEm": null
  },
  "confianca": null,
  "dados": {}
}
```

Não precisa copiar literalmente se houver padrão melhor existente.

Mas preserve a semântica:

- disponibilidade;
- motivo;
- escopo;
- fonte;
- confiança;
- dados.

Nunca substituir indisponibilidade por zero.

## Aceite Fase 1

- nova ilha abre;
- herda ClienteConta do Shell;
- sem seletor duplicado;
- troca de conta limpa payload anterior;
- bootstrap funciona com falha parcial;
- host antigo continua intacto;
- feature flag/menu/coexistência possível;
- build da nova ilha é isolado.

---

# FASE 2 — RESULTADO + COMPARAÇÃO + PONTE + CONFIANÇA

## Objetivo

Entregar o primeiro núcleo realmente útil da nova 360.

## Reaproveitar

- `ResultadoPeriodo`
- `FechamentoResumo`
- `ComparacaoMensal`
- `PonteResultado`
- `ConfiancaDados`
- primitivas de loading/error/empty
- utils de formatação

Adaptar por props/contratos novos.

Não copiar seletores próprios da V2.

## UI

A página deve começar a refletir a arquitetura do Dossiê:

```text
HEADER
Cliente
Operação
Período
Comparação
Confiança

TRILHO

RESULTADO
POR QUE MUDOU
CONFIANÇA
```

Resultado acima da dobra.

Ponte logo abaixo.

Confiança deve preservar dimensões distintas.

## Confiança

NÃO fundir em um score único:

- confiança da V2;
- completude CV;
- margin confidence;
- reconciliação Mercado Pago.

Mostrar separadamente quando disponíveis.

## Drawer de pedido

Quando houver rowId canônico, permitir abrir detalhe de pedido sem sair da 360.

Carregar on-demand.

## Aceite Fase 2

- mesma conta e competência em todos os blocos;
- falha de confiança não derruba resultado;
- ausência explica motivo;
- ponte reconcilia com base;
- drawer não perde contexto;
- troca de conta/competência cancela drawer/request anterior.

---

# FASE 3 — PRODUTOS COMPOSTOS + MARGEM

## Objetivo

Construir uma das áreas mais valiosas da nova 360:

```text
PRODUTO
+
CURVA ABC
+
FATURAMENTO
+
IMPACTO
+
MARGEM
+
STATUS
+
PROBLEMAS
```

## Regra de identidade

Nunca JOIN por título.

Criar adapter/compositor server-side.

Para MELI, usar MLB normalizado quando seguro.

Modelar explicitamente:

```text
matched
missing
ambiguous
not_applicable
```

SKU só pode ser fallback com unicidade comprovada no mesmo contexto.

`inventoryId`/variation são subidentidades específicas, principalmente Full.

## Fontes

- ABC/faturamento → Central de Vendas
- impacto → Ponte/V2 adaptada
- margem/status/confiança → Motor de Margem
- problemas → fontes tipadas

## Margem

Propagar ClienteConta ponta a ponta onde necessário.

Não fazer uma chamada HTTP por produto no frontend.

Compor no servidor.

Distinguir:

- margem realizada;
- margem projetada;
- dado não computável;
- evidência insuficiente.

Preservar statuses existentes:

```text
UNVALIDATED
SUSPECT_DATA
LOSS
LOW_MARGIN
RECONCILING
HEALTHY
```

quando forem de fato aplicáveis.

## UI

Área Produtos com filtros internos:

```text
Impacto
ABC
Margem
Problemas
```

Sem criar nova página.

Drawer de produto pode mostrar:

- faturamento;
- ABC;
- impacto;
- margem;
- evidências;
- problemas;
- links contextuais.

## Aceite Fase 3

- nenhum JOIN por título;
- conta A/B isoladas;
- produto ambíguo não é forçado;
- margem indisponível não vira zero;
- Curva A + margem ruim pode ser identificada;
- composição testada.

---

# FASE 4 — OPORTUNIDADES + SIMULADOR

## Objetivo

Migrar/adaptar a inteligência de recuperação e simulador.

## Oportunidades

Não somar cenários sobrepostos como promessa.

Separar:

```text
potencial estimado
```

de

```text
alerta sem valor estimável
```

Conservar fatores suportados pelos motores atuais.

Não inventar economia de Ads se o modelo não sustenta.

## Simulador

Lazy/on-demand.

Deve usar ClienteConta + competência.

Mostrar premissas e avisos.

Elasticidade é estimativa, não causalidade.

Se não houver evidência suficiente:

`indisponivel`.

## Aceite Fase 4

- cenário neutro reconcilia;
- oportunidades não duplicam ganhos evidentes;
- valores estimados têm origem/premissa;
- conta ativa é garantida;
- não executar alteração real de preço/custo/anúncio.

---

# FASE 5 — ADS + FULL + SAÚDE CONDICIONAL

## 5A ADS

Separar:

```text
Ads account-scoped comprovado
```

de

```text
Ads mensal client_legacy
```

Não usar `loja_campanha` textual como FK de conta.

Preferir fonte account-aware.

Expor:

- investimento;
- GMV Ads;
- ROAS;
- ACOS;
- TACoS quando computável;
- comparação;
- fonte;
- período;
- status.

Se não houver fonte segura para a conta:

bloco indisponível ou legacy explicitamente rotulado.

## 5B FULL

Lazy e condicional.

Só aparece quando:

- marketplace/conta compatível;
- capability habilitada;
- feature flag ativa.

Expor resumo:

- estoque;
- giro;
- cobertura;
- tendência;
- críticos;
- reposição sugerida.

Movimentos/inventário detalhado:

drawer on-demand.

Não transformar Full atual em histórico mensal da competência.

Deixar claro que é snapshot/janela atual.

## 5C SAÚDE

Resumo leve de:

- Grant;
- Base;
- sync;
- diagnóstico;
- fechamento/configuração.

Não reutilizar score sintético do Cliente Operação como verdade.

Cada dimensão deve declarar escopo/fonte.

## Aceite Fase 5

- falha Ads não derruba a 360;
- Full desligado não quebra;
- blocos não aplicáveis somem/explicam;
- nenhuma conta é inferida;
- client_legacy é rotulado.

---

# FASE 6 — HISTÓRICO + ENTREGAS + AÇÕES + CONFIGURAÇÃO

## Histórico

Compor eventos tipados.

Não fingir que `activity_logs.details` textual é timeline account-scoped.

Fontes possíveis:

- entregas;
- sync runs;
- ações;
- fechamentos;
- eventos estruturados.

Cada evento deve indicar:

- fonte;
- escopo;
- timestamp;
- ator quando conhecido;
- competência quando conhecida;
- ClienteConta quando conhecida.

## Entregas

Corrigir a projection necessária se confirmado o gap de `payload_json`.

Preferir entrega account-scoped.

Legacy NULL permanece legacy.

Não backfill.

## Ações/intervenções

Preservar autorização atual.

Não criar novo ledger/schema sem necessidade e decisão humana.

Se a 360 apenas precisa ler ações atuais, rotular escopo.

Se um ledger novo for indispensável, preparar proposta/migration aditiva, mas NÃO executar migration.

## Configurar operação

A Cliente 360 mostra estado e CTA.

Editar vai para módulo dono.

Não embutir Cliente Operação inteira.

CTAs:

- reconectar Grant;
- vincular Base;
- revisar custo;
- gerenciar ClienteConta;
- diagnóstico;
- entrega/Financeiro.

Preservar gates.

## Aceite Fase 6

- histórico não inventa lineage;
- entrega account-scoped tem preferência;
- CTAs respeitam authorization;
- 403 real continua sendo autoridade;
- legacy explicitamente rotulado.

---

# FASE 7 — SQUADS / CONTEXTO DE SESSÃO COMPATÍVEL

Esta fase só deve tocar Squad ativo se o trabalho P2.9 correspondente estiver estável e não houver outro agente alterando os mesmos arquivos.

Se houver concorrência com migração de Squads:

NÃO implemente Squad ativo nesta missão.

A nova 360 deve apenas estar pronta para herdar esse contexto depois.

Se estiver seguro:

- activeSquadId é sessão/contexto de trabalho;
- não muda Squad principal;
- validado contra memberships;
- troca de Squad remove Cliente/Conta fora do recorte;
- não escolhe substituto arbitrário;
- requests são cancelados;
- autorização continua via backend.

Cliente 360 não ganha seletor próprio de Squad.

---

# FASE 8 — COEXISTÊNCIA, FEATURE FLAG E CUTOVER

## Objetivo

Somente após paridade funcional e testes.

Manter durante migração:

- Visão;
- Cliente 360 V1;
- Cliente 360 V2;
- Cliente Operação.

A nova 360 entra de forma aditiva.

## Antes de remover qualquer destino

Criar matriz de capacidades:

```text
capacidade antiga
→ destino novo
```

Especialmente:

- revisão de custo Seller;
- entregas;
- comparação de entregas;
- sync legacy;
- bases;
- diagnóstico;
- Ads;
- histórico.

## Cutover

Primeiro:

```text
menu/feature flag
→ nova 360
```

Depois:

```text
redirects
```

Só muito depois considerar apagar código legado.

Nesta missão:

NÃO apagar tabelas.

NÃO apagar hosts antigos.

NÃO apagar código legacy apenas porque ficou sem link.

## Rollback

Deve ser possível voltar o menu/flag para rota antiga sem perder dados.

---

# 8. ARQUITETURA DE CARREGAMENTO

Não criar endpoint monolítico que espera todas as integrações.

Preferir:

```text
BOOTSTRAP
+
LAZY BLOCKS
+
DRAWER ON-DEMAND
```

## Boot

- contexto;
- capabilities;
- resultado;
- comparação;
- ponte/resumo;
- confiança/resumo;
- saúde leve.

## Lazy

- produtos compostos;
- Ads;
- Full;
- Margem profunda;
- Histórico;
- Simulador;
- Elasticidade.

## Drawer on-demand

- pedido;
- evidências de margem;
- produto;
- movimentos Full;
- detalhes de entrega;
- diagnóstico.

---

# 9. SOURCE OF TRUTH

Preservar a recomendação da auditoria.

Em princípio:

```text
Faturamento / pedidos / ticket / cancelamentos
→ Central de Vendas

Resultado operacional
→ Central de Vendas + ponte reconciliada

ABC
→ Central de Vendas

Impacto por produto
→ Ponte adaptada

Margem
→ Motor de Margem, com tipo/evidência

Ads
→ fonte identificada por conta

Full
→ Central Full

Base
→ cliente_contas / base_vinculos

Grant
→ conta/token resolver

Diagnóstico
→ fonte explicitamente declarada

Entrega
→ entregas_cliente

Confiança
→ dimensões separadas
```

Não recalcular a mesma métrica em dois lugares sem motivo.

---

# 10. FRONTEND / UX

A nova Cliente 360 deve ser densa e profissional.

Não cair em:

```text
card
card
card
card
```

como arquitetura inteira.

Preservar a ideia:

```text
HEADER STICKY
+
TRILHO STICKY
+
DOSSIÊ LONGO
+
DRAWERS
```

O header deve deixar inequívoco:

- Cliente;
- ClienteConta/operação;
- marketplace;
- competência;
- comparação;
- confiança/contexto.

O trilho navega pelas seções.

Blocos condicionais só aparecem quando aplicáveis.

Não criar nova página para cada seção.

---

# 11. TESTES OBRIGATÓRIOS

Criar/adaptar testes em cada fase.

Cobrir pelo menos:

## Multiconta

Cliente X:
- Conta A MELI
- Conta B MELI
- mesmo MLB/SKU
- dados diferentes
- legacy NULL

Provar:

```text
A nunca lê B
B nunca lê A
```

## Contexto

- conta de outro Cliente;
- conta inativa;
- usuário sem carteira;
- troca rápida de contexto;
- request antigo chegando depois do novo;
- deep-link.

## Matemática

- multi-item;
- custo ausente;
- frete parcial;
- comissão;
- imposto;
- cancelado;
- ajustes;
- mês parcial;
- cenário neutro.

## Produtos

- MLB duplicado entre contas;
- SKU ambíguo;
- sem MLB;
- margem ausente;
- produto Full com inventoryId.

## Blocos

- Ads indisponível;
- Full flag off;
- Margin error;
- history error;
- bloco lazy falha sem derrubar a página.

## UI

- loading;
- empty;
- unavailable;
- partial;
- error;
- troca de conta;
- trilho;
- drawer;
- acessibilidade básica.

---

# 12. PERFORMANCE

Não chamar APIs externas repetidamente por item.

Evitar N+1.

Usar composição server-side.

Cache deve sempre incluir o contexto adequado:

```text
clienteContaId
+
período
+
versão/fonte
```

Nunca reutilizar cache de outra conta.

Medir/registrar somente em ambiente seguro.

---

# 13. AUTORIZAÇÃO

Não alterar autorização por conveniência do frontend.

Backend continua autoridade.

Frontend usa capabilities apenas para UX.

Toda ação deve continuar passando pelo gate real.

Se um CTA não é permitido:

- ocultar/desabilitar conforme capability;
- mesmo assim backend deve negar 403 se chamado.

Não promover `interno`, `membro`, `user`, etc. para novas permissões sem decisão explícita.

---

# 14. O QUE NÃO FAZER

NÃO:

- reescrever todo o Portal;
- migrar tudo para React;
- substituir Shell;
- apagar V1/V2 antes da paridade;
- somar contas;
- fazer backfill inferido;
- JOIN por título;
- usar Ads client-level como account-scoped;
- usar Full como histórico mensal;
- transformar confiança em score único;
- considerar simulador como causal;
- mudar fórmulas para "fechar";
- mexer em Financeiro paralelo sem necessidade;
- alterar permissões silenciosamente;
- executar migration real;
- fazer commit/push sem pedido.

---

# 15. RELATÓRIO DE IMPLEMENTAÇÃO

Crie e mantenha durante o trabalho:

`Projeto_cliente360/IMPLEMENTACAO_CLIENTE360_V3_RELATORIO.md`

Esse arquivo deve ser criado por você e atualizado após cada fase.

Estrutura:

```text
# Metadata
branch
HEAD inicial
status inicial

# Fase 0
status
arquivos
mudanças
testes
resultados
gaps
decisões

# Fase 1
...

# Fase N
...

# Arquivos criados
# Arquivos alterados
# Migrations criadas mas NÃO executadas
# Testes executados
# Testes não executados
# Decisões humanas pendentes
# Riscos restantes
# Próxima fase
```

NÃO atualizar outros MDs de documentação nesta missão, exceto se estritamente necessário para build/runtime.

---

# 16. CHECKPOINT APÓS CADA FASE

Depois de cada fase, antes de avançar:

1. `git diff -- <arquivos da fase>`
2. conferir que não removeu trabalho paralelo;
3. rodar testes da fase;
4. rodar testes correlatos;
5. se frontend, build da ilha quando seguro;
6. atualizar relatório;
7. verificar critérios de aceite;
8. avançar.

Se houver falha:

corrigir antes de avançar.

Não acumular 8 fases quebradas para corrigir no final.

---

# 17. POLÍTICA DE CONTINUAÇÃO

Quero que você trabalhe de forma autônoma e profunda.

Você PODE avançar pelas fases sem pedir confirmação a cada uma, desde que:

- os testes passem;
- não exista decisão humana irreversível;
- não exista conflito com trabalho paralelo;
- não precise executar migration real;
- não precise acessar produção.

Se encontrar decisão humana irreversível:

NÃO invente.

Implemente o restante independente e registre o bloqueio.

---

# 18. PRIORIDADE SE O CONTEXTO/LIMITE FICAR BAIXO

Se perceber que a sessão está ficando sem contexto/limite:

NÃO continue abrindo novos módulos.

Priorize:

1. deixar a fase atual compilando/testada;
2. atualizar `IMPLEMENTACAO_CLIENTE360_V3_RELATORIO.md`;
3. registrar exatamente onde parou;
4. listar próximo arquivo/símbolo a alterar;
5. não deixar mudanças intermediárias sem explicação.

---

# 19. CRITÉRIO DE SUCESSO DA MISSÃO

O sucesso NÃO é "ter uma tela bonita".

É chegar progressivamente a:

```text
N97
ML Principal
Agosto/2026

Resultado confiável da conta
↓
Por que mudou
↓
Quais produtos explicam
↓
Onde existe oportunidade
↓
Ads
↓
Full
↓
Margem
↓
Confiança
↓
Histórico
```

sem misturar outra operação e sem esconder ausência de dados.

---

# 20. COMEÇAR AGORA

Faça agora:

1. leia os arquivos obrigatórios;
2. capture branch/HEAD/status;
3. confronte a auditoria com o código atual, caso tenha mudado desde o snapshot;
4. inicie a FASE 0;
5. implemente e teste;
6. avance fase por fase seguindo este documento;
7. mantenha o relatório de implementação atualizado.

Não faça uma nova rodada longa de ideação.

A implementação deve seguir a auditoria e validar no código somente o que for necessário para executar com segurança.

---

# 21. FORMATO DA RESPOSTA FINAL

Quando encerrar a sessão, responda de forma objetiva:

```text
IMPLEMENTAÇÃO CLIENTE 360 — STATUS

Fases concluídas:
- ...

Fase atual:
- ...

Principais entregas:
- ...

Testes executados:
- ...

Bloqueadores:
- ...

Decisões humanas pendentes:
- ...

Relatório:
Projeto_cliente360/IMPLEMENTACAO_CLIENTE360_V3_RELATORIO.md

Branch:
...

HEAD inicial:
...

Git status final:
...
```

Não declare conclusão total se alguma fase estiver incompleta.

Não esconda testes não executados.

Não confunda "código escrito" com "validado".
