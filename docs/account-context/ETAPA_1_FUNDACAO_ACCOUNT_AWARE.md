# Etapa 1 — fundação do contexto operacional

Branch `fix/account-context-foundation`, criada limpa de `origin/main` em
`ab17097583dfebf0f77dbc061b5f19576d7595fd`. O prompt da Etapa 1 e a auditoria
`docs/AUDITORIA_UNIFICACAO_CLIENTES_CONTAS.md` do workspace original foram lidos
integralmente antes das alterações. A auditoria é referência de riscos; sua
fotografia de produção não foi reaplicada nem atualizada nesta etapa.

## Comportamento

Antes, Base explícita validava Cliente/MELI/atividade, sem validar sua Conta.
Base NULL podia também servir qualquer operação em Cliente multi-conta.
Agora o contexto de precificação valida Cliente → Conta ativa → seller exato
→ Grant exato → Base e vínculo ativos do mesmo marketplace/operação.

`accountContextInvariant` foi ampliado com modo estrito opt-in. Continua puro,
sem consultas ou efeitos. O único consumidor em runtime é o contexto de
precificação; a Central de Vendas não importa esse invariante. Seu modo padrão
e os contratos dos resolvers compartilhados permanecem preservados.

O serviço reutiliza `obterConta`, `resolverContaParaVinculoLegado` e
`resolveMarketplaceAccountContext`. O contexto seleciona Conta antes de
resolver Grant; zero Contas recusa, duas ou mais sem seleção explícita recusam
com o código existente `MULTIPLE_MARKETPLACE_ACCOUNTS`/409. Uma única Conta
ativa permanece automática. A Base retornada pelo resolver compartilhado é
descartada: somente a Base validada pelo contexto de precificação é usada.

Bases explícitas consultam todos os vínculos ativos, sem LIMIT/ordenação para
esconder conflitos. Exigem pai, Conta, marketplace da Base e do vínculo,
atividade da Base e atividade do vínculo. Base NULL só pode ser aceita quando
há exatamente uma Conta ativa MELI no Cliente. Em multi-conta, Base direta
válida continua utilizável; Base NULL explicitada é recusada. Se a única
possibilidade for Base NULL ambígua, o contexto retorna 409.

Projeções sem credenciais verificam a titularidade do seller em Contas e
Grants antes de usar a integração. Seller em mais de um Cliente ou mais de
uma Conta é recusado, inclusive referências históricas/inativas; Grants
revogados também não comprovam titularidade exclusiva. Mais de um Grant
exato é ambíguo. Grant NULL mantém compatibilidade somente pela identidade
Cliente/seller inequívoca; Grant com Conta preenchida incompatível é recusado.
Nenhum vínculo é associado automaticamente. O Grant retornado pelo resolver
é novamente validado; indisponibilidade conhecida vira prontidão negativa,
enquanto erro de banco/invariante propaga sem fallback.

Preview propaga `mlUserId` também ao multiget de itens e às tarifas. Diagnóstico
transporta a Conta resolvida ao worker em memória; o worker revalida o contexto
e os IDs de Cliente/Base e seller antes de consultar ML. Job sem seleção em
multi-conta recusa; não busca Grant principal. Não mudou persistência,
deduplicação de jobs, cálculo ou fórmula financeira.

## Erros e limites

| Condição | Código | HTTP |
|---|---|---:|
| Zero Conta ativa | `ACCOUNT_CONTEXT_NOT_FOUND` | 404 |
| Várias Contas sem seleção | `MULTIPLE_MARKETPLACE_ACCOUNTS` | 409 |
| Conta de outro Cliente | `CONTA_NAO_PERTENCE_AO_CLIENTE` | 403 |
| Marketplace errado | `MARKETPLACE_INCOMPATIVEL` | 422 |
| Conta inativa | `CONTA_INATIVA` | 409 |
| Conta divergente após resolver | `ACCOUNT_CONTEXT_MISMATCH` | 409 |
| Base inexistente | `BASE_NOT_FOUND` | 404 |
| Base/vínculo inativos | `BASE_INATIVA` | 409 |
| Base de outra Conta/Cliente | `BASE_ACCOUNT_MISMATCH` | 409 |
| Base NULL sem prova única ou vínculos conflitantes | `ACCOUNT_CONTEXT_AMBIGUOUS` | 409 |
| Grant vinculado a Conta/seller/Cliente errado | `GRANT_ACCOUNT_MISMATCH` | 409 |
| Mais de um Grant exato | `GRANT_CONTEXT_AMBIGUOUS` | 409 |
| Seller em outro Cliente | `SELLER_OWNERSHIP_AMBIGUOUS` | 409 |

Os erros anteriores de indisponibilidade da integração/Base conservam o
vocabulário e HTTP 424 existentes. Erros novos possuem `code` e `codigo`.
Diagnóstico de titularidade expõe somente os IDs do contexto solicitado,
sem listar carteiras de terceiros ou exportar tokens/segredos.

O endurecimento intencionalmente bloqueia clientes sem operação ativa,
Bases NULL multi-conta e sellers com titularidade compartilhada. A decisão
empresarial e a correção dos dados ficam para outra etapa. O guardrail vale
para os consumidores deste contexto; não é uma alteração global de OAuth,
ML Grant, Ads, Central, scheduler ou autorização. São leituras próximas no
tempo, sem locks/transação nova; não substituem coordenação de writers em
uma futura reassociação de Conta. Não houve consulta ou validação online em
produção. P1-06/P1-10 e unificação continuam fora do escopo.

## Validação

[Evidência estruturada](VALIDACAO_ETAPA_1.json). Todos os testes foram executados
sem `.env` de produção, com URL local de teste e bloqueio de rede externa.

- Nova suíte `accountContextFoundation.test.js`: 29 cenários, cobrindo A–L,
  Base direta/NULL, múltiplos Grants, seller histórico compartilhado, spoof,
  falha de banco, sigilo, chamadas do preview e revalidação do worker.
- Dez arquivos direcionados alterados/criados passaram; os mocks passaram a
  representar as projeções de identidade completas. Expectativas inseguras de
  Base NULL multi-conta e zero Conta foram substituídas por recusa explícita;
  os testes de isolamento e os cálculos existentes foram mantidos.
- Todos os 322 arquivos da main foram executados: 319 passaram e 3 falharam.
- Todos os 323 arquivos da branch foram executados: 320 passaram e as mesmas
  3 falharam. Logs das falhas são idênticos após normalizar o caminho da árvore.
  Nenhum teste foi pulado. A execução de todos os arquivos inclui Contas,
  Bases, automações, precificação, diagnóstico, ML Grant/OAuth, autorização,
  pool, deadlock e recovery.
- `npm test` usa o runner oficial que para na primeira falha histórica.
  A execução complementar de todos os arquivos verifica também os posteriores.
- `git diff --check` passou; não há diferenças nos diretórios/arquivos protegidos
  listados no JSON, nem alterações nas fórmulas financeiras.

Falhas históricas preservadas:

1. `designStudioWorkspace.test.js`: expectativa estática de cópia do template.
2. `meliAnunciosOrdenacaoGlobal.test.js`: delimitador textual de função removido
   na evolução do código de margem projetada.
3. `mlTokenService.test.js`: expectativa de projeção SQL do controller de OAuth.

## Revisão de impacto requerida pelo prompt

| Pergunta | Resposta |
|---|---|
| Contexto determinístico com Conta explícita? | SIM |
| Base ML1 pode atravessar para ML2? | NÃO |
| Grant ML1 pode atravessar para ML2? | NÃO |
| Seller compartilhado é rejeitado? | SIM |
| Single-account legado continua? | SIM, com uma Conta ativa comprovada |
| Multi-account sem seleção falha fechado? | SIM |
| Central de Vendas alterada? | NÃO |
| Migration necessária? | NÃO |
| Dados de produção alterados? | NÃO |

Não houve unificação, reassociação de Conta, backfill, alteração de seller,
Grant, Base, Squad ou responsáveis, execução de sync, merge ou deploy.
