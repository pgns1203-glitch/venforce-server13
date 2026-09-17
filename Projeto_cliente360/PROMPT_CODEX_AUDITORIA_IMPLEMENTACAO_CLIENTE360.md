# PROMPT PARA CODEX — AUDITORIA TÉCNICA + PLANO DE IMPLEMENTAÇÃO
# CLIENTE 360 CARRO-CHEFE DO VENFORCE

Quero uma auditoria profunda do código REAL do VenForce para transformar a proposta de arquitetura da nova Cliente 360 em um plano de implementação seguro e executável posteriormente pelo Claude Code.

NÃO implemente nada.

Sua função nesta missão é:

AUDITOR TÉCNICO  
+  
ARQUITETO DE IMPLEMENTAÇÃO  
+  
REVISOR DE CONTRATOS  
+  
PLANEJADOR DE MIGRAÇÃO

---

## 0. ARQUIVO DE PRODUTO — LEIA PRIMEIRO

Na pasta atual existe um arquivo com nome semelhante a:

`VENFORCE_CLIENTE_360_CARRO_CHEFE_ARQUITETURA*.md`

Localize e leia ele INTEGRALMENTE antes de investigar o código.

Esse arquivo contém a proposta de produto/UX que quero perseguir.

IMPORTANTE:

Ele é uma PROPOSTA, não source of truth técnico.

Você deve:

- validar cada afirmação contra o código real;
- confirmar o que já existe;
- refutar o que estiver errado;
- identificar o que precisa adaptação;
- identificar o que exige contrato novo;
- identificar riscos não percebidos no documento.

NÃO redesenhe o produto do zero nesta auditoria.

O foco agora é:

> "Como transformar essa arquitetura numa implementação real e segura dentro do VenForce atual?"

---

## 1. REGRA CRÍTICA — CURRENT STATE ≠ TARGET PRODUCT

Não confunda:

ESTADO ATUAL DO CÓDIGO

com

ARQUITETURA DE PRODUTO ALVO.

Exemplo importante:

A migração de Squads está definindo conceitos como:

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

Se o código atual ainda não implementa algum conceito já aprovado pela decisão P2.9:

NÃO conclua que a decisão deve ser removida para combinar com o legado.

Classifique assim:

```text
ATUAL:
...

ALVO APROVADO:
...

GAP:
...

IMPLEMENTAÇÃO NECESSÁRIA:
...
```

As decisões finais recentes de Squads/P2.9 têm precedência sobre estruturas legacy encontradas no código.

---

## 2. MODO DE TRABALHO — READ ONLY

Esta auditoria deve ser READ-ONLY.

Você pode:

- ler arquivos;
- buscar referências;
- usar `rg` / `grep` / `find`;
- usar `git grep`;
- usar `git status`;
- usar `git diff`;
- usar `git log`;
- usar `git show`;
- usar `git rev-parse`;
- rastrear imports;
- rastrear rotas;
- rastrear controllers;
- rastrear services;
- rastrear repositories/SQL;
- rastrear testes;
- comparar frontend/backend.

NÃO pode:

- alterar código existente;
- corrigir código;
- formatar arquivos;
- refatorar;
- criar implementação;
- executar migrations;
- executar SQL;
- alterar banco;
- subir servidor;
- instalar dependências;
- rodar scripts destrutivos;
- commit;
- push;
- pull;
- merge;
- rebase;
- checkout;
- reset;
- restore;
- stash;
- clean.

ATENÇÃO:

O projeto possui histórico de `.env` apontando para produção.

NÃO inicialize backend apenas para "testar".

---

## 3. ÚNICA ESCRITA PERMITIDA

Você pode criar APENAS:

`Projeto_cliente360/AUDITORIA_PLANO_IMPLEMENTACAO_CLIENTE360_CARRO_CHEFE.md`

Se já estiver dentro da pasta `Projeto_cliente360/`, crie:

`AUDITORIA_PLANO_IMPLEMENTACAO_CLIENTE360_CARRO_CHEFE.md`

NÃO crie nenhum outro arquivo.

NÃO altere o arquivo de arquitetura original.

---

## 4. REGISTRE O ESTADO DO REPOSITÓRIO

No começo da auditoria registre no MD:

- caminho do repo;
- branch;
- HEAD;
- `git status --short`;
- data/hora;
- se working tree estava dirty.

No final:

- rode novamente `git status --short`;
- confirme que você não alterou nenhum arquivo existente.

Se durante a auditoria perceber arquivos mudando por outro agente/processo:

marque:

`CONCORRÊNCIA DETECTADA`

e diga quais arquivos mudaram.

Não tente corrigir nem reverter.

---

## 5. HIERARQUIA DE EVIDÊNCIA

Use esta prioridade:

1. código conectado ao runtime atual;
2. rotas/controllers/services realmente montados;
3. testes atuais;
4. schema/SQL/config;
5. `venforce_md_v2`;
6. decisões recentes P2.9;
7. documento de arquitetura da Cliente 360;
8. documentação antiga;
9. inferência.

Mas lembre:

decisões humanas de PRODUTO podem representar o TARGET mesmo quando o código atual ainda não chegou lá.

Sempre diferencie:

- FATO ATUAL
- DECISÃO DE PRODUTO
- GAP
- RECOMENDAÇÃO

---

## 6. OBJETIVO DA NOVA CLIENTE 360

A arquitetura proposta é, conceitualmente:

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

Com:

- contexto Cliente + ClienteConta + competência;
- trilho de navegação;
- página densa;
- blocos condicionais;
- drawers para drill-down;
- deep-link para módulos que executam alterações.

Princípio de UX:

```text
ENTENDER
→ permanece na Cliente 360

EDITAR / EXECUTAR
→ vai para o módulo dono
```

A Cliente 360 deve:

```text
CONSUMIR
RESUMIR
CRUZAR
PRIORIZAR
EXPLICAR
```

Não deve replicar todos os módulos profundos.

---

## 7. REGRA MAIS IMPORTANTE DE DADOS

A principal unidade de análise proposta é:

```text
CLIENTE_CONTA
+
COMPETÊNCIA
```

Exemplo:

```text
N97
+
Mercado Livre Principal
+
Agosto/2026
```

Audite se isso é tecnicamente possível HOJE em cada fonte.

Para cada domínio, diga:

- CLIENT-SCOPED
- ACCOUNT-SCOPED
- MISTO
- AMBÍGUO
- PRECISA MIGRAÇÃO

Especialmente:

- Central de Vendas;
- Cliente 360 V2;
- Cliente 360 V1;
- Visão;
- Ads;
- Full;
- Margem;
- Fechamento;
- Diagnóstico;
- Bases;
- Entregas;
- ações/intervenções.

---

## 8. AUDITORIA DA VISÃO

Mapeie integralmente:

`frontend-react/src/pages/VisaoPage.jsx`

e:

- hook;
- API/service frontend;
- componentes;
- entry Vite;
- HTML host;
- rota;
- controller;
- `visaoService`;
- dependências reais.

Descubra:

- como Cliente chega;
- como ClienteConta chega;
- como período chega;
- como marketplace é resolvido;
- quais blocos são account-scoped;
- quais NÃO são;
- quais fontes alimentam cada bloco;
- contrato `disponivel`;
- contrato `escopoConta`;
- tratamento de ausência;
- tratamento de erro;
- como os deep-links são construídos.

Responder:

> A Visão pode realmente ser usada como container/base técnica da nova Cliente 360?

VEREDITO:

- CONFIRMADO
- PARCIAL
- REFUTADO

com evidências.

---

## 9. AUDITORIA DA CLIENTE 360 V2

Mapeie:

- `Cliente360Page`;
- `useCliente360`;
- `cliente360Api`;
- componentes;
- utils;
- testes;
- CSS;
- entry/build;
- routes;
- controllers;
- services;
- engines;
- adapters.

Especialmente:

- Resultado;
- `FechamentoResumo`;
- `ComparacaoMensal`;
- `PonteResultado`;
- `ProdutosImpacto`;
- produtos no vermelho;
- produtos abaixo da margem;
- `OportunidadesRecuperacao`;
- Simulador;
- `ConfiancaDados`;
- `AdsFechamento`;
- Placar;
- Narrativa;
- Elasticidade.

Para CADA engine/service, diga:

```text
ENTRADAS
ESCOPO
FILTROS
FONTE
SAÍDA
DEPENDÊNCIA DE CLIENTECONTA
MATURIDADE
TESTES
```

Questão central:

> A V2 é realmente account-aware?

Audite de verdade.

Não confie no nome de testes ou comentários.

Rastreie até SQL/queries/repositories/service calls.

---

## 10. QUESTÃO CRÍTICA — CLIENTECONTA NA V2

Responder com precisão:

1. `cliente360ResultadoService` recebe `clienteContaId`?
2. `cliente360FechamentoAdapter` recebe?
3. `ProdutosEngine` trabalha por qual universo?
4. Ponte trabalha por qual universo?
5. `ConfiancaEngine` trabalha por qual universo?
6. `RecuperacaoEngine` trabalha por qual universo?
7. Simulador reconstrói pedidos de qual conta?
8. `AdsFechamento` sabe qual ClienteConta está ativa?
9. marketplace é recebido livremente ou derivado da conta?
10. onde existe risco de misturar duas contas do mesmo Cliente?

Para cada resposta:

- CONFIRMADO
- REFUTADO
- NÃO DETERMINÁVEL

+
evidência.

---

## 11. AUDITORIA CLIENTE 360 V1

Mapeie:

- `Portal/cliente-360.html`;
- `Portal/cliente-360.js`;
- CSS;
- endpoints consumidos;
- services utilizados;
- ações de escrita.

Identifique:

- informações exclusivas;
- informações duplicadas;
- ações exclusivas;
- ações que ainda não têm casa futura;
- dependências legacy;
- seletor próprio;
- client-scoped;
- account-scoped;
- first-item assumptions;
- contratos perigosos;
- código que NÃO deve ser reutilizado.

Crie uma tabela:

| Capacidade V1 | Sobrevive? | Destino futuro | Backend reutilizável? | Front reutilizável? |
|---|---|---|---|---|

Especial atenção para:

- sync;
- entregas;
- custo Seller;
- diagnóstico;
- históricos;
- Bases;
- Ads;
- métricas.

---

## 12. AUDITORIA CLIENTE OPERAÇÃO

Mapeie profundamente:

- `Portal/cliente-operacao.html`;
- `Portal/cliente-operacao.js`;
- CSS;
- endpoints;
- backend relacionado.

Procure explicitamente:

- `FALLBACK_CLIENTE`;
- mock;
- fallback sintético;
- `[0]`;
- primeiro Cliente;
- primeira Base;
- primeiro Grant;
- primeiro relatório;
- listas globais;
- seleção silenciosa.

Mapeie tudo que é:

- CONFIGURAÇÃO
- ANÁLISE
- LEGADO
- AÇÃO ADMINISTRATIVA

Responder:

> O que deve existir futuramente em "Configurar operação"?

Não redesenhe a Cliente 360 com Cliente Operação dentro dela.

Quero separar:

```text
CLIENTE 360
=
entender/analisar

CONFIGURAR OPERAÇÃO
=
alterar infraestrutura/configuração
```

---

## 13. CENTRAL DE VENDAS

Audite:

- routes;
- controllers;
- `centralVendasReadService`;
- bootstrap;
- daily;
- products;
- orders;
- ABC;
- completude;
- sync;
- Mercado Pago;
- tests.

Mapeie o contrato REAL.

Descubra:

- como a conta é resolvida;
- onde entra `clienteContaId`;
- filtros de período;
- resultados;
- pedidos;
- série diária;
- produtos;
- Curva ABC;
- detalhes O(1);
- confiança/completude;
- reconciliation Mercado Pago.

Responder:

> Quais partes podem alimentar diretamente a nova Cliente 360?

E:

> Quais NÃO devem ser copiadas porque pertencem à Central de Vendas profunda?

---

## 14. ADS

Audite:

- routes;
- controllers;
- services;
- tables/contracts;
- tests.

Separar:

```text
ADS AO VIVO
```

de

```text
ADS REGISTRO MENSAL / ACOMPANHAMENTO
```

Descubra:

- account-awareness real;
- relação com `clienteContaId`;
- `cliente_slug`;
- `loja_campanha`;
- seller;
- marketplace;
- possibilidade de duas contas MELI do mesmo Cliente.

Mapeie:

- investimento;
- GMV Ads;
- ROAS;
- ACOS;
- TACoS;
- comparação temporal;
- Ads no fechamento.

Identifique qualquer risco multiconta.

---

## 15. FULL

Audite:

- `server/services/full/*`;
- routes;
- controller;
- frontend;
- feature flag;
- tests.

Confirmar:

- `clienteContaId`;
- inventários;
- estoque;
- vendas 7d;
- tendência;
- ritmo 30d;
- giro diário;
- cobertura;
- status operacional;
- reposição;
- movimentos.

Verifique:

`FULL_CENTRAL_ENABLED`

e como a nova 360 deve se comportar se estiver desligado.

---

## 16. MARGEM

Audite:

- `motorMargem`;
- Central de Margem;
- `contextoPrecificacaoService`;
- bases/custos;
- tests.

Responder:

- é client-scoped ou account-scoped?
- seller/account entra onde?
- marketplace entra onde?
- duas contas MELI do mesmo Cliente podem misturar dados?
- quais statuses existem?
- quais confianças existem?
- quais evidências por item existem?

Mapeie o trabalho necessário para a nova 360 conseguir cruzar:

```text
IMPACTO V2
+
ABC CENTRAL VENDAS
+
MARGEM
+
PROBLEMAS
```

por produto/item.

---

## 17. FECHAMENTO / FINANCEIRO

Mapeie:

- fechamento por API;
- Financeiro V3;
- `FechamentoAdapter` da V2;
- `entregas_cliente`;
- competência;
- publicação;
- reconciliação;
- ClienteConta.

Diferencie explicitamente:

```text
FECHAMENTO CALCULADO
```

de

```text
ENTREGA PUBLICADA
```

de

```text
UPLOAD/FECHAMENTO POR PLANILHA
```

Não use "fechamento" como se fosse uma coisa só.

---

## 18. CONFIANÇA

Audite separadamente:

1. confiança da Cliente 360;
2. confiança / margin confidence;
3. completude da Central de Vendas;
4. reconciliação Mercado Pago.

Descubra:

- fórmula;
- fonte;
- escopo;
- granularidade;
- disponibilidade.

Responder:

> Elas realmente devem continuar separadas?

Se sim, proponha COMO compor visualmente sem fundir semanticamente.

---

## 19. PRODUTOS — COMPOSIÇÃO MAIS IMPORTANTE

A arquitetura quer algo como:

```text
PRODUTO
+
CURVA ABC
+
FATURAMENTO
+
IMPACTO NO RESULTADO
+
MARGEM
+
STATUS
+
PROBLEMAS
```

Audite se existe uma chave segura para cruzar essas fontes:

- MLB?
- item_id?
- SKU?
- inventory_id?
- outro?

Mapeie:

```text
fonte A → identificador
fonte B → identificador
fonte C → identificador
```

Descubra:

- onde o cruzamento é seguro;
- onde é ambíguo;
- onde precisa adapter;
- onde precisa composição server-side.

Não proponha JOIN pelo título.

---

## 20. HISTÓRICO / ENTREGAS / INTERVENÇÕES

Audite:

- `cliente_360_resumos_mensais`;
- `cliente_360_acoes`;
- `entregas_cliente`;
- `central_vendas_sync_runs`;
- `activity_logs`.

Responder:

- quais tabelas realmente existem;
- colunas;
- ClienteConta;
- competência;
- autor;
- timestamps;
- estados;
- gaps.

Especialmente:

`cliente_360_acoes`

tem:

- `cliente_conta_id`?
- competência?
- `item_id`?
- autor?
- resultado esperado?
- resultado verificado depois?

Se não tiver, diga.

---

## 21. AUTORIZAÇÃO

Mapeie todas as ações que a 360 proposta gostaria de iniciar:

- sincronizar;
- executar diagnóstico;
- reconectar Grant;
- vincular Base;
- revisar custo Seller;
- registrar intervenção;
- gerar entrega;
- publicar entrega;
- editar configuração;
- criar ClienteConta.

Para cada:

| Ação | Endpoint | Gate atual | Quem pode hoje | Mudança necessária? |
|---|---|---|---|---|

Não proponha alteração de permissão silenciosamente.

---

## 22. SQUADS + SHELL

Audite o código atual de:

- `vf-shell`;
- `vf-context`;
- `/me/context`;
- `/me/portfolio`;
- Carteira;
- seleção de Cliente;
- seleção de ClienteConta;
- filtros de Squad;
- migração de Squads.

Mas faça duas colunas:

```text
ESTADO ATUAL
```

e

```text
TARGET P2.9
```

Não use ausência de Squad ativo hoje como argumento para remover o conceito do target.

Descubra:

- onde o Squad ativo deveria viver;
- quem deve resolvê-lo;
- se a Cliente 360 precisa saber dele;
- se basta herdar do Shell;
- o que acontece em troca de Squad;
- o que acontece com Cliente/Conta atual.

---

## 23. BUILD / FRONTEND

Audite:

- Vite config;
- entries;
- React islands;
- bundles;
- HTML hosts;
- CSS foundation;
- Visão;
- Cliente360 V2.

Responder:

> Qual é o caminho de menor risco para a nova Cliente 360?

Possibilidades a avaliar:

A. evoluir a ilha Visão;  
B. evoluir a ilha Cliente360;  
C. criar nova ilha;  
D. outra.

Considere:

- isolamento atual;
- chunks;
- CSS;
- testes;
- rollback;
- coexistência durante migração.

Não implementar.

---

## 24. PROPOSTA DE CONTRATO DA NOVA 360

Depois da auditoria, proponha um contrato técnico ALVO.

Algo conceitualmente parecido com:

`GET /operacao/cliente-360-v3/...`

ou outra solução.

MAS:

não crie rota agora.

Mostre:

### INPUT

- clienteId / slug?
- clienteContaId?
- periodo?
- compararCom?

### OUTPUT

- contexto;
- resultado;
- ponte;
- produtos;
- oportunidades;
- Ads;
- Full;
- margem;
- confiança;
- saúde;
- histórico.

Para cada bloco:

```json
{
  "disponivel": true,
  "motivo": null,
  "escopo": "account",
  "fonte": "central_vendas",
  "confianca": {},
  "dados": {}
}
```

Avalie se composição deve ser:

- 1 endpoint grande;
- bootstrap + lazy blocks;
- outra arquitetura.

Considere:

- latência;
- falha parcial;
- cache;
- APIs externas;
- Full;
- Ads;
- Central de Vendas.

---

## 25. PERFORMANCE

Não ignore performance.

A página proposta pode consultar muitas fontes.

Mapeie:

- chamadas atuais;
- APIs externas;
- DB;
- cache;
- módulos pesados;
- Full;
- Ads;
- Central de Vendas;
- V2.

Classifique:

- CARREGAR NO BOOT
- LAZY
- CACHE
- DRAWER ON-DEMAND
- NÃO CARREGAR NA 360

Explique por quê.

---

## 26. PLANO DE MIGRAÇÃO

Depois da auditoria, crie um plano em FASES executáveis.

Quero algo apropriado para entregar posteriormente ao Claude Code.

Exemplo de granularidade:

```text
FASE 0
Resolver account-awareness da V2

FASE 1
Fundação da nova 360

FASE 2
Resultado + Ponte

FASE 3
Produtos compostos
```

Mas NÃO use esse exemplo cegamente.

Derive a sequência das dependências reais.

Para CADA fase:

### Objetivo

### Por que vem agora

### Arquivos envolvidos

### Backend

### Frontend

### Testes

### Dependências

### Riscos

### Critério de aceite

### Rollback

### NÃO FAZER NESTA FASE

As fases devem ser pequenas o suficiente para o Claude Code implementar uma por vez.

---

## 27. MAPA DE ARQUIVOS PARA O CLAUDE CODE

No final, crie uma seção:

# MAPA DE EXECUÇÃO PARA CLAUDE CODE

Estrutura:

```text
FASE 0

LER:
- arquivo
- arquivo

ALTERAR PROVAVELMENTE:
- arquivo
- arquivo

CRIAR PROVAVELMENTE:
- arquivo

TESTAR:
- teste
- teste

NÃO TOCAR:
- arquivo
- módulo
```

Faça isso para todas as fases.

IMPORTANTE:

"provavelmente" porque esta auditoria NÃO implementa.

---

## 28. MATRIZ DE REAPROVEITAMENTO

Crie:

| Componente atual | Reutilizar | Adaptar | Aposentar | Motivo |
|---|---:|---:|---:|---|

Inclua:

- `VisaoPage`;
- `ResultadoPeriodo`;
- `SaudeOperacional`;
- `MargemBloco`;
- `AdsBloco`;
- `FechamentoBloco`;
- `Cliente360Page`;
- `FechamentoResumo`;
- `ComparacaoMensal`;
- `PonteResultado`;
- `ProdutosImpacto`;
- `OportunidadesRecuperacao`;
- `ConfiancaDados`;
- Simulador;
- Cliente 360 V1;
- Cliente Operação.

---

## 29. TABELA SOURCE OF TRUTH

Crie uma tabela crucial:

| Informação | Fonte canônica futura | Escopo | Motivo |
|---|---|---|---|

Para:

- faturamento;
- pedidos;
- cancelamentos;
- ticket;
- resultado operacional;
- resultado após Ads;
- margem;
- ABC;
- impacto produto;
- Ads;
- Full;
- Base;
- Grant;
- diagnóstico;
- fechamento;
- entrega;
- confiança;
- histórico.

Quero evitar duas telas futuras calculando a mesma coisa de forma diferente.

---

## 30. DECISÕES HUMANAS

Separe no final:

# BLOQUEADORES TÉCNICOS

coisas que o código responde.

# DECISÕES HUMANAS

coisas que eu preciso decidir.

Não misture os dois.

Para cada decisão humana:

- pergunta;
- opções;
- impacto;
- recomendação;
- por que precisa de decisão humana.

---

## 31. ORDEM DO DOCUMENTO FINAL

O MD final deve conter:

# 0. Metadata da auditoria

# 1. Resumo executivo

# 2. Veredito sobre a arquitetura proposta

# 3. Estado atual vs target

# 4. Mapa das fontes e escopos

# 5. Visão

# 6. Cliente 360 V2

# 7. Cliente 360 V1

# 8. Cliente Operação

# 9. Central de Vendas

# 10. Ads

# 11. Full

# 12. Margem

# 13. Financeiro / Fechamento

# 14. Confiança

# 15. Produtos / cruzamento de fontes

# 16. Histórico / entregas / ações

# 17. Squads + contexto

# 18. Autorização

# 19. Frontend / build

# 20. Performance / estratégia de carregamento

# 21. Contrato técnico alvo

# 22. Matriz de reaproveitamento

# 23. Source of truth de cada métrica

# 24. Gaps técnicos

# 25. Decisões humanas

# 26. Plano de implementação por fases

# 27. Mapa de execução para Claude Code

# 28. Testes e critérios de aceite

# 29. Estratégia de coexistência / rollback

# 30. Ordem recomendada de implementação

---

## 32. REGRA DE EVIDÊNCIA

Toda afirmação técnica importante deve citar:

```text
arquivo
+
função/classe/símbolo
```

Exemplo:

`server/services/visaoService.js :: buildVisao()`

Evite linha exata porque ela muda durante implementação.

Quando não houver evidência suficiente:

`EVIDÊNCIA INSUFICIENTE`

Quando for inferência:

`INFERÊNCIA`

Quando for sugestão:

`RECOMENDAÇÃO`

---

## 33. NÃO INVENTE UMA IMPLEMENTAÇÃO "BONITA"

Não faça plano baseado em:

> "seria elegante criar..."

Primeiro descubra o que já existe.

Prefira:

```text
REUTILIZAR
>
ADAPTAR
>
CRIAR
```

A nova 360 deve aproveitar o investimento que já existe no Portal.

---

## 34. OBJETIVO FINAL DO ARQUIVO

Esse arquivo será entregue para:

1. humano revisar;
2. ChatGPT revisar;
3. Claude Code implementar fase por fase.

Portanto ele precisa ser suficientemente técnico para que outro agente consiga executar sem refazer toda a auditoria.

Mas NÃO deve conter implementação completa.

Quero:

```text
MAPA
+
DEPENDÊNCIAS
+
CONTRATOS
+
RISCOS
+
FASES
+
CRITÉRIOS DE ACEITE
```

---

## 35. ENTREGA

Crie somente:

`Projeto_cliente360/AUDITORIA_PLANO_IMPLEMENTACAO_CLIENTE360_CARRO_CHEFE.md`

ou, se já estiver dentro da pasta:

`AUDITORIA_PLANO_IMPLEMENTACAO_CLIENTE360_CARRO_CHEFE.md`

Antes de terminar:

- confirme que o arquivo existe;
- confirme que está completo;
- rode `git status --short`;
- confirme que nenhum arquivo existente foi modificado por você.

Na resposta final do Codex escreva somente:

```text
AUDITORIA CONCLUÍDA

Arquivo:
<caminho>

Branch:
<branch>

HEAD:
<hash>

Arquivos existentes modificados por esta auditoria:
NENHUM

Bloqueadores críticos encontrados:
<N>
```
