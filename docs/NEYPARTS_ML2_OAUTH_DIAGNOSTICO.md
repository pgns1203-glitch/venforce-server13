# NeyParts — diagnóstico cirúrgico OAuth ML2

Branch: `fix/neyparts-ml2-ownership-diagnostic-server13`, base `gpt/main` em
`48996e8fe67a82ccb20a2c9f968a7343ac5d392b` (venforce-server13).

## Evidência e limite

Dados do incidente fornecidos pelo operador: cliente 148; ML1 conta 206,
seller 345926596, Grant 132 funcionando; conta 250 inativa; ML2 conta 252
ativa, sem seller/Grant. Não houve consulta nem mutação ao banco de produção
nesta investigação. O seller das duas tentativas e o registro bloqueador
continuam desconhecidos. Não há fonte de logs Render conectada nesta sessão;
a busca local em log.txt e documentos consultados não identificou a tentativa.

No código confirmado em main do repositório alvo, SELLER_OWNERSHIP_AMBIGUOUS
exige conta meli ou Grant operacional do seller recebido com cliente_id diferente
do cliente pretendido. Contas inativas participam. Grants revogados/expirados
participam; somente superseded_by_grant_id não nulo os exclui. NULL em
cliente_conta_id não basta para causar esse erro. Buscar duplicados já
persistidos ou apenas os Grants do cliente 148 não identifica esse bloqueador.
O preflight ocorre antes de salvar token ou atribuir seller e o catch faz rollback.
Isso comprova o mecanismo, não a titularidade comercial ou o registro concreto.

## Fluxo da conta 252

Portal/clientes.js usa conta.id em /ml/conectar-conta/:id. O controller valida
conta ativa/meli e cliente ativo; gerarMlState inclui clienteId e clienteContaId,
nonce e validade de 10 minutos em JWT assinado. O callback verifica assinatura,
cliente e conta antes de trocar code. O user_id da resposta de token determina
o seller; o state não escolhe o usuário logado no Mercado Livre.
concluirOAuthContaMl valida a resposta, abre transação, trava seller/cliente,
carrega a conta FOR UPDATE e valida contexto, executa preflight de titularidade,
depois salva Grant e vincula conta na mesma transação.

Para /ml/conectar-conta/252 e os dados informados, o caminho preserva 252
explicitamente: não usa conta principal nem reativa 250. A execução real do
Portal/state das tentativas não está disponível para comprovar esses valores.
O API_BASE local é https://venforce-server.onrender.com, que pode ser o serviço
do repositório venforce-server13; confirmar essa associação no Render antes de
publicar. ML_REDIRECT_URI é configurável e deve apontar ao mesmo backend.

## Diff e validação

Única alteração operacional: console.warn com JSON no ramo exato do erro,
usando allowlist de seller, IDs e origem cliente_contas/ml_tokens. Não muda
SELECT, validação, resposta HTTP, transação ou persistência. Diagnóstico fica
apenas no log do servidor e sobrevive ao rollback. Não serializa objetos de
token, requisição, code, JWT state, senhas ou credenciais. O evento também
pode aparecer em outros consumidores do validador; filtrar destino 148/252.

Testes focados (mocks, sem PostgreSQL/ML real):

- node server/tests/oauthAccountBindingAtomic.test.js — 16 cenários.
- node server/tests/mlConectarConta.test.js — 23 verificações.
- node server/tests/accountContextStrict.test.js — 17 cenários.

Incluem Grant legado estrangeiro NULL/revogado, conta estrangeira inativa,
ambas as fontes, dois sellers distintos no mesmo cliente, rollback sem
vínculo parcial, preservação integral dos objetos ML1 e log exato sem segredos.

## Deploy diagnóstico e conclusão (dependem de autorização)

1. Revisar somente os arquivos deste patch e publicar a branch no repositório
   alvo apenas após autorização. Confirmar commit atualmente servido pelo Render,
   banco e serviço corretos e aplicar o diff sobre a base efetivamente implantada.
   Não publicar main local de outro remoto. Não há migration.
2. Registrar baseline via SELECT abaixo: 206/132 permanecem associados ao seller
   345926596; 250 continua inativa e 252 ativa sem seller/Grant. Não exportar tokens.
3. Após deploy autorizado, gerar novo link /ml/conectar-conta/252 no backend
   confirmado. Autorizar usando a sessão da segunda loja no Mercado Livre.
   Não reutilizar code/state antigos nem conectar/reconectar 206.
4. Se 409, coletar exclusivamente o JSON ml_seller_ownership_ambiguous com
   cliente_id=148 e cliente_conta_id=252, horário e commit do deploy. Executar
   SELECT abaixo com o seller real desse evento. Se destino divergir, investigar
   link/backend utilizado antes de propor qualquer alteração de dados.
5. Confirmar titularidade comercial com o responsável e histórico de associação.
   Se o seller pertence legitimamente ao outro cliente, corrigir a sessão ML e
   repetir OAuth com o seller da ML2; não mover Grant. Se associação legada errada
   for comprovada, preparar reparo separado para os IDs exatos, com evidência,
   baseline, transação, pré-condições e reversão, e solicitar autorização.
   Nenhum UPDATE/DELETE/transferência/desativação automática é proposto agora.
6. Depois de eventual reparo autorizado, repetir novo OAuth apenas de 252.
   Confirmar seller real e Grant exclusivo em 252, 206/132 íntegros, 250 inativa.
   Se o log não aparece, conferir commit/backend servido; não enfraquecer o guard.

## SELECT de auditoria (parâmetro $1 = seller real)

Executar via cliente SQL com parâmetro vinculado; não substituir por um seller
suposto. A primeira consulta inclui registros históricos para comparação e
marca precisamente os que participam do bloqueio atual.

```sql
WITH ownership AS (
  SELECT 'cliente_contas'::text AS origem, cc.id, cc.cliente_id,
         cc.id AS cliente_conta_id, cc.external_account_id::text AS seller,
         cc.ativo, NULL::text AS token_status,
         NULL::text AS superseded_by_grant_id, true AS operacional
  FROM cliente_contas cc
  WHERE cc.marketplace = 'meli' AND cc.external_account_id = $1::text
  UNION ALL
  SELECT 'ml_tokens', g.id, g.cliente_id, g.cliente_conta_id,
         g.ml_user_id::text, NULL::boolean,
         to_jsonb(g)->>'token_status',
         to_jsonb(g)->>'superseded_by_grant_id',
         (to_jsonb(g)->>'superseded_by_grant_id') IS NULL
  FROM ml_tokens g WHERE g.ml_user_id = $1::text
)
SELECT o.*, c.nome AS cliente_nome, c.slug AS cliente_slug,
       (o.operacional AND o.cliente_id <> 148) AS bloqueia_cliente_148,
       cc.cliente_id AS dono_conta_referenciada,
       cc.marketplace AS marketplace_conta_referenciada,
       cc.external_account_id AS seller_conta_referenciada
FROM ownership o
LEFT JOIN clientes c ON c.id = o.cliente_id
LEFT JOIN cliente_contas cc ON cc.id = o.cliente_conta_id
ORDER BY o.origem, o.cliente_id, o.id;

SELECT id, cliente_id, marketplace, nome, external_account_id, ativo, is_primary
FROM cliente_contas WHERE id IN (206, 250, 252) ORDER BY id;

SELECT id, cliente_id, cliente_conta_id, ml_user_id,
       to_jsonb(g)->>'token_status' AS token_status,
       to_jsonb(g)->>'superseded_by_grant_id' AS superseded_by_grant_id,
       updated_at
FROM ml_tokens g
WHERE id = 132 OR cliente_id = 148 OR cliente_conta_id IN (206, 250, 252)
ORDER BY id;
```

Não houve push, merge, deploy ou escrita em produção. O diff é diagnóstico;
a correção de dado permanece condicionada à identificação e comprovação.
