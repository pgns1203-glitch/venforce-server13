# API da matriz — integração (preparação)

Fluxo: `Venforce → matrizApiClient → API da matriz`. Toda chamada externa passa por
`server/services/matrizApi/` (`matrizApiClient.js` faz só HTTP; `shopeeMatrizService.js`
é o ponto onde os endpoints serão plugados). A base URL vem **apenas** de ENV server-side
(`MATRIZ_API_BASE_URL`, `MATRIZ_API_TOKEN`, opcional `MATRIZ_API_TIMEOUT_MS`); sem elas o
servidor sobe normalmente e o status mostra `configured: false`.
Em `NODE_ENV=production` só `https` é aceito; redirect nunca é seguido.

Enquanto o contrato não existir, as operações do service falham com `MATRIZ_ENDPOINT_NAO_CONFIGURADO`.

- Status (admin): `GET /integracoes/matriz/status`
- Bancada técnica: `/integracoes-externas.html` (standalone, fora do Shell)
- O callback `GET /shopee/callback` continua sendo apenas uma casca.

| Informação | Estado |
|---|---|
| Base URL homologação | PENDENTE |
| Base URL produção | PENDENTE |
| Autenticação | PENDENTE |
| Credencial de teste | PENDENTE |
| Iniciar grant Shopee | PENDENTE |
| Consultar status grant | PENDENTE |
| Identificação da loja | PENDENTE |
| Listar lojas | PENDENTE |
| Pedidos | PENDENTE |
| Produtos | PENDENTE |
| Estoque | PENDENTE |
| Financeiro | PENDENTE |
| Promoções | PENDENTE |
| Callback | PENDENTE |
| Webhooks | PENDENTE |
| Paginação | PENDENTE |
| Rate limit | PENDENTE |
| Formato de erros | PENDENTE |

## Fluxo de cliente novo — confirmar

1. Criamos o Cliente normalmente?
2. Criamos/temos a ClienteConta Shopee?
3. Como iniciar o grant?
4. Quem gera a authorization URL?
5. Para onde volta o callback?
6. Quem guarda/renova o token?
7. Qual identificador recebemos?
8. Como consultar os dados da loja depois?

Nota: vínculo futuro ClienteConta Shopee ↔ id externo da matriz ↔ `shop_id`; sem tabela nova agora.
