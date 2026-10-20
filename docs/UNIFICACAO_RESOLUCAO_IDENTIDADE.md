# Resolver identidade na Unificação de Clientes

## Escopo e operação

O manifesto v2 acrescenta decisões explícitas de identidade ao preview e ao
executor existente. Não altera as flags de EXECUTE/ROLLBACK. Não executa OAuth,
sync, refresh, migration ou unificação automaticamente. Clientes, Contas e
Grants são preservados; nenhuma etapa do executor usa DELETE.

O modelo continua Cliente = empresa e ClienteConta = operação marketplace.
A escolha de Conta/Grant nunca usa principal, menor ID, data ou status como
critério de desempate. Um vínculo existente e coerente é preservado; um Grant
sem Conta exige decisão, mesmo se houver uma única candidata. Dois Grants
operacionais para o seller exigem escolha do Grant canônico.

## Manifesto e preview

Ver `server/scripts/unificacaoClientes/manifest-v2.example.json` (fixture).
O backend valida e normaliza:

* `sellerAccounts`: seller → Conta MELI ativa do conjunto, sem seller divergente;
* `canonicalGrantsBySeller`: seller → um dos Grants operacionais desse seller;
* `deactivateEmptyAccountIds`: Contas sem seller, sem Grant operacional, sem
  Base ativa, sem referências críticas e com catálogo completo.

O preview retorna `decisionsRequired` e `plan.identityResolution`, incluindo
opções permitidas, referências impeditivas, operação resultante e Grants a
preservar como superseded. O frontend apresenta essas opções sem preenchê-las
por inferência. Cada alteração invalida hash, revisão e confirmação anteriores.
O manifesto normalizado e todas as decisões participam do `planHash`.

Contas com seller incompatível, seller em terceiro Cliente, jobs ativos,
histórico com seller divergente e cobertura incompleta continuam bloqueando.
Referências críticas desconhecidas e histórico da Central mantêm os blockers
do executor anterior. Esta mudança não certifica a migração desses módulos.

## Grants superseded e migration

`20261020_ml_grants_superseded.sql` é manual, transacional e idempotente. Requer
a infraestrutura de `20261014_clientes_unificacao_executor.sql`. Adiciona FK
`superseded_by_grant_id` (integer, igual ao PK real), data e motivo da
substituição; impede autorreferência e metadata parcial. O Grant substituído
fica com `is_primary=false`. O vínculo de supersession e o snapshot do ledger
preservam sua procedência; seu `cliente_id` histórico não é reescrito.

Os índices únicos de seller/Cliente e de principal passam a considerar apenas
Grants não substituídos. Isso permite escolher inclusive o Grant do legado
como canônico, mantendo seu predecessor no Cliente de origem. O upsert OAuth
usa o mesmo predicado parcial após a migration. Antes dela, leituras usam
`to_jsonb` para compatibilidade e o upsert conserva a forma antiga. Preview
com supersession exige evidência da migration no catálogo.

A regra operacional está centralizada em `mlGrantIdentity`: somente Grants
com `superseded_by_grant_id IS NULL`. O guard de titularidade continua
rejeitando ownership cruzado, múltiplas Contas ou múltiplos Grants atuais,
inclusive Grants revogados/expirados. Somente uma substituição explícita retira
um Grant da resolução. Listagem administrativa e snapshots mantêm o histórico,
sem selecionar credenciais nas projeções de identidade.

OAuth, refresh, seleção por ID/Cliente/seller, carteira, readiness, Anúncios,
Bases, snapshots e consumidores indiretos da Central usam a regra central.
Grants superseded não podem ser promovidos nem receber refresh ou novo vínculo.

## Execução e rollback

Continua uma transação SERIALIZABLE, com revalidação sob locks, prazo,
snapshots antes/depois, ledger e chave de idempotência. A ordem de locks segue
OAuth: seller → Clientes → Grants → linhas. O plano contém um marcador estável
para a data de supersession, materializado com o timestamp da transação antes
dos UPDATEs e salvo no plano reverso do ledger.

O executor neutraliza preferências, marca os predecessores como superseded e
só então move o canônico, evitando colisão transitória do índice parcial. Na
reversão, move o canônico antes de reativar o predecessor. Restaura ownership,
vínculos, seller atribuído, flags, metadata de supersession e estado do Cliente
legado. PKs comerciais que mudam no movimento usam sua chave resultante no
plano reverso. Qualquer divergência posterior continua impedindo rollback.

Contas reais do legado são movidas com o mesmo ID, seller, Grant e vínculos de
Base. Valores e IDs de histórico são preservados pelas políticas já auditadas;
dependências não suportadas bloqueiam, em vez de serem ignoradas.

## Auditoria do incidente (SELECTs, 20/10/2026)

Executada somente pela sessão psql já aberta em “Banco de dados”, via Maestri.
Nenhuma conexão adicional com produção, escrita, flag ou migration aplicada.
Os nomes efetivos no banco são “Mercadao enxovais” (#36) e
“Mercadao enxovais 2” (#65).

| Identidade | Evidência |
| --- | --- |
| Seller 8682183 | Grants 51 e 52, status valid, ambos sem Conta; Clientes 36 e 65 |
| Conta 65 / Cliente 36 | MELI ativa/principal, sem seller/nickname/Base; 1 entrega publicada e 9 incidentes abertos |
| Conta 72 / Cliente 36 | MELI ativa, sem seller/nickname/Base; 1 entrega publicada e 8 incidentes abertos |
| Conta 71 / Cliente 65 | Seller 159560107, Grant 103, nickname ESPACOCASAENXOVAIS |
| Histórico da Conta 71 | 22 imports e 18 sync runs da Central, 6.396 pagamentos, 650 anúncios, 296 user products e 12 margin runs com falha |
| Outras operações | Contas Shopee 138 e 139 preservadas |

Não há vínculos de Base desses dois Clientes. As Contas sem seller **não são
shells comprovadamente vazios**: possuem referências críticas. O novo gate
deve impedir sua desativação. A fixture sanitizada sem referências demonstra
o caminho permitido, e testes separados demonstram os blockers reais. O caso
real ainda exige revisão das pendências e da cobertura da Central; este PR
não autoriza nem executa sua unificação.

O arquivo temporário da auditoria contém somente IDs, estados, nickname e
contagens. Não contém access_token, refresh_token ou api_key.

## Validação

* Fixture sanitizada: decisões ausentes, escolha de ambas as Contas/Grants,
  terceiro proprietário, referência incompatível/ativa, shell com referências,
  catálogo ausente, hash determinístico e guard direto para os dois sellers.
* PostgreSQL descartável local: migration duas vezes; canônico 51 ou 52;
  rollback integral; falha após UPDATE; retry; flags OFF; upsert parcial;
  refresh/seleção excluindo histórico; conclusão OAuth account-scoped sintética.
* Regressão existente PostgreSQL: executor, rollback, concorrência, ledger,
  perda de resposta após COMMIT, PK comercial e API HTTP.
* Chrome com backend de fixture: decisões sem seleção automática, hash novo,
  superseded, desativação bloqueada, responsividade e EXECUTE OFF.

Os testes locais usam dados sintéticos; não fazem OAuth nem acessam produção.
O runner completo percorreu 356 arquivos: 352 passaram e quatro falhas
preexistentes foram reproduzidas no commit base `8404b7a0`:
`basesTiktok`, `designStudioWorkspace`, `meliAnunciosOrdenacaoGlobal` e
`mlTokenService` (assert legado de exposição de credenciais na listagem admin).
Essas falhas não foram contornadas nem alteradas neste PR.
