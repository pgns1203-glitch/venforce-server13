# Cliente 360 DevUI Pico.css - Plano Read-Only

Data: 2026-06-11  
Projeto: Venforce Portal  
Escopo: proposta futura para uma DevUI isolada do Cliente 360 usando Pico.css.

## 1. Objetivo

Este documento descreve como criar futuramente uma DevUI isolada para o Cliente 360, sem interferir na tela oficial, nos services, nas rotas, no Seller, no layout global ou em qualquer fluxo em execucao.

A DevUI deve servir como ferramenta de inspecao tecnica do payload real do Cliente 360. Ela deve ser simples, read-only e orientada a diagnostico.

## 2. Principios obrigatorios

- Nao reutilizar `Portal/cliente-360.js`.
- Nao reutilizar `Portal/cliente-360.css`.
- Nao carregar `Portal/layout.js`.
- Nao chamar endpoints `POST`, `PUT`, `PATCH` ou `DELETE`.
- Nao chamar sync no MVP.
- Nao chamar metricas live no MVP.
- Nao chamar Ads live no MVP.
- Nao alterar endpoints existentes.
- Nao alterar controller, service, repository, middleware ou schema.
- Nao misturar a DevUI com a tela oficial.
- Exibir dados `null` como ausencia real de dado, nunca como zero inventado.

## 3. Arquivos futuros propostos

```txt
Portal/dev-ui/cliente360.html
Portal/dev-ui/cliente360.js
Portal/dev-ui/cliente360.css
Portal/dev-ui/README.md
```

## 4. Estado atual relevante

### 4.1 Frontend oficial

Arquivos:

```txt
Portal/cliente-360.html
Portal/cliente-360.js
Portal/cliente-360.css
Portal/layout.js
Portal/login.js
```

O frontend oficial:

- usa `API_BASE = "https://venforce-server.onrender.com"`;
- le `vf-token` do `localStorage`;
- le `vf-user` do `localStorage`;
- envia `Authorization: Bearer <token>`;
- chama `GET /operacao/cliente-360/clientes`;
- chama `GET /operacao/cliente-360/:slug`;
- em caso de falha, cai para endpoints legados;
- usa `normalizeCliente360Response(data)` para adaptar o payload novo a estruturas antigas dos renderizadores.

Ponto importante: a DevUI futura nao deve depender de `normalizeCliente360Response`. Ela deve renderizar o payload real retornado pelo backend.

### 4.2 Backend Cliente 360

Arquivos:

```txt
server/routes/cliente360Routes.js
server/controllers/cliente360Controller.js
server/services/cliente360/cliente360Service.js
server/services/cliente360/cliente360Repository.js
server/services/cliente360/cliente360SyncService.js
server/services/cliente360/cliente360CoberturaService.js
server/services/cliente360/cliente360DataQualityService.js
server/services/cliente360/cliente360DiagnosticoEngine.js
server/services/cliente360/cliente360FreteHistoricoService.js
server/utils/periodoUtils.js
server/sql/cliente360_schema.sql
```

O backend esta organizado em:

- rota HTTP;
- controller fino;
- service principal de leitura;
- repository SQL;
- sync service para fluxo pesado;
- services auxiliares puros para diagnostico, cobertura, qualidade e frete.

## 5. Endpoints reais para a DevUI

### 5.1 Endpoints permitidos no MVP

| Metodo | Endpoint | Uso na DevUI | Observacao |
|---|---|---|---|
| GET | `/operacao/cliente-360/clientes` | Popular seletor de cliente | Leitura operacional |
| GET | `/operacao/cliente-360/:slug` | Carregar payload padrao | Usa mes anterior fechado por padrao |
| GET | `/operacao/cliente-360/:slug?competencia=YYYY-MM` | Carregar competencia especifica | Util para comparar snapshots |

### 5.2 Endpoints opcionais, somente leitura

| Metodo | Endpoint | Uso possivel | Observacao |
|---|---|---|---|
| GET | `/operacao/cliente-360/:slug/diagnosticos` | Drilldown de diagnosticos salvos | Nao necessario no MVP |
| GET | `/operacao/cliente-360/:slug/frete-historico` | Ver frete isoladamente | Ja vem no payload principal |
| GET | `/operacao/cliente-360/:slug/oportunidades` | Ver oportunidades isoladamente | Ja vem no payload principal |
| GET | `/automacoes/relatorios/:id` | Detalhe de relatorio | Opcional |
| GET | `/public/entregas/:token` | Ver fechamento publicado | Opcional |

### 5.3 Endpoints proibidos no MVP

| Metodo | Endpoint | Motivo |
|---|---|---|
| POST | `/operacao/cliente-360/:slug/sincronizar` | Fluxo pesado, escreve snapshot |
| POST | `/operacao/cliente-360/:slug/diagnostico-automatico` | Persiste diagnostico |
| DELETE | `/entregas-cliente/:id` | Destrutivo |
| GET | `/metricas/resumo` | Chamada live/pesada ao Mercado Livre |
| GET | `/ads/performance` | Chamada live/pesada ao Mercado Ads |

## 6. Payload principal esperado

O endpoint principal retorna:

```js
{
  ok,
  fonte,
  cliente,
  periodo,
  sync,
  resumoMes,
  grafico,
  snapshotsDisponiveis,
  setup,
  saude,
  grant,
  bases,
  diagnostico,
  freteHistorico,
  coberturaBaseFaturamento,
  ads,
  fechamentos,
  relatorios,
  historico,
  proximoPasso,
  dataQuality,
  debug
}
```

### 6.1 Periodo

```js
periodo = {
  competencia,
  label,
  dateFrom,
  dateTo,
  tipo,   // mes_anterior | mes_atual | selecionado
  padrao  // true quando veio do default do backend
}
```

### 6.2 Resumo mensal

```js
resumoMes = {
  faturamento,
  mcMedia,
  pedidos,
  cancelados,
  problemas,
  adsInvestido,
  adsRef,
  tacos,
  fechamentosCount,
  diagnosticosCount,
  itensSemCusto,
  itensCriticos,
  mcDiagnostico,
  mcDiagnosticoFonte,
  mcDiagnosticoRelatorioId,
  mcDiagnosticoEm,
  mcPeriodo,
  mcPeriodoFonte
}
```

### 6.3 Grafico

```js
grafico = {
  competencia,
  label,
  fonte,
  serieDiaria,
  motivoIndisponivel
}
```

Regra de exibicao:

- se `serieDiaria` existir, renderizar a serie;
- se `motivoIndisponivel` existir, exibir o motivo;
- nao inventar serie vazia;
- nao usar dados de outro mes.

### 6.4 Snapshots disponiveis

```js
snapshotsDisponiveis = [
  {
    competencia,
    label,
    tipo,
    sincronizadoEm,
    temSerieDiaria
  }
]
```

Uso recomendado:

- montar seletor de competencia;
- mostrar se o snapshot tem serie diaria;
- permitir recarregar com `?competencia=YYYY-MM`;
- nao disparar sync automatico.

### 6.5 Cobertura base/faturamento

```js
coberturaBaseFaturamento = {
  disponivel,
  motivo,
  mensagem,
  periodo,
  fonte,
  resumo,
  concentracaoSemBase,
  produtosSemBaseMaisRelevantes,
  matrizPreparacao,
  observacoes
}
```

O service `cliente360CoberturaService.js` existe e e usado pelo `cliente360Service.js`.

Ele cruza:

- `cliente_360_resumos_mensais.payload_json.topProdutos`;
- `relatorio_itens.tem_base`;
- ultimo relatorio do cliente.

Estados esperados:

- `disponivel: true`, quando ha snapshot com detalhe por produto e relatorio com itens;
- `disponivel: false` com `motivo: "sem_relatorio"`;
- `disponivel: false` com `motivo: "sem_snapshot"`;
- `disponivel: false` com `motivo: "sem_faturamento_por_produto"`.

## 7. Risco de competencia GET vs POST

Risco principal identificado:

- `GET /operacao/cliente-360/:slug` usa mes anterior fechado por padrao.
- `POST /operacao/cliente-360/:slug/sincronizar`, quando chamado sem competencia explicita, usa competencia atual.
- O frontend oficial chama sync com body vazio `{}`.

Consequencia possivel:

- a tela pode estar exibindo maio/2026, por exemplo;
- o usuario clica em sincronizar;
- o backend sincroniza junho/2026;
- a tela recarrega maio/2026 e continua sem snapshot.

Regra para a DevUI:

- nao chamar sync no MVP;
- caso sync exista em uma fase futura, exigir competencia explicita;
- antes de qualquer POST, mostrar a competencia que sera enviada;
- nunca reaproveitar o comportamento atual de enviar `{}`.

## 8. Como a DevUI deve funcionar

Fluxo recomendado:

```txt
Portal/dev-ui/cliente360.html
  -> carrega Pico.css
  -> carrega cliente360.css
  -> carrega cliente360.js
  -> le localStorage.vf-token
  -> GET /operacao/cliente-360/clientes
  -> usuario seleciona cliente
  -> GET /operacao/cliente-360/:slug
  -> renderiza cards tecnicos
  -> renderiza JSON cru
  -> opcional: usuario escolhe competencia
  -> GET /operacao/cliente-360/:slug?competencia=YYYY-MM
```

## 9. Estrutura sugerida da tela

### 9.1 Header

Conteudos:

- titulo `Cliente 360 DevUI`;
- aviso `Read-only`;
- status do token;
- role do usuario;
- API base em uso.

### 9.2 Controles

Campos:

- select de cliente;
- input de competencia `YYYY-MM`;
- botao `Carregar`;
- botao `Limpar competencia`;
- checkbox `Mostrar JSON cru`.

Todos os botoes devem executar apenas GET.

### 9.3 Cards principais

Cards:

- Cliente;
- Periodo;
- Sync;
- Grant;
- Setup;
- Saude;
- Resumo mensal;
- MC diagnostico vs MC periodo;
- Ads salvo;
- Grafico;
- Snapshots;
- Cobertura base/faturamento;
- Diagnostico;
- Fechamentos;
- Debug/fontes.

### 9.4 JSON cru

Exibir:

```txt
payload completo do GET /operacao/cliente-360/:slug
```

Motivo:

- facilitar auditoria;
- evitar normalizacao indevida;
- comparar backend real com frontend oficial;
- ajudar outro agente a entender divergencias.

## 10. Responsabilidades por arquivo futuro

### 10.1 `Portal/dev-ui/cliente360.html`

Responsabilidades:

- documento HTML isolado;
- importar Pico.css;
- importar CSS proprio;
- importar JS proprio;
- nao importar `layout.js`;
- nao importar `cliente-360.js`;
- nao importar `cliente-360.css`;
- conter containers sem dependencia do DOM oficial.

### 10.2 `Portal/dev-ui/cliente360.js`

Responsabilidades:

- ler token e usuario do localStorage;
- montar headers de autenticacao;
- chamar apenas endpoints GET permitidos;
- renderizar payload real;
- preservar `null`;
- exibir erros de API;
- exibir tempo de resposta;
- permitir copiar JSON;
- permitir alternar competencia.

Funcoes sugeridas:

```js
getToken()
getUser()
apiGet(path)
loadClientes()
loadCliente360(slug, competencia)
renderEstadoAuth()
renderClientes(clientes)
renderPayload(payload)
renderResumoMes(resumoMes)
renderGrafico(grafico)
renderSnapshots(snapshots)
renderCobertura(cobertura)
renderJson(payload)
```

### 10.3 `Portal/dev-ui/cliente360.css`

Responsabilidades:

- pequenos ajustes sobre Pico.css;
- layout de grid;
- blocos de JSON;
- badges de status;
- nenhum estilo global agressivo.

Namespace recomendado:

```css
.c360-dev {}
.c360-dev-grid {}
.c360-dev-card {}
.c360-dev-json {}
.c360-dev-badge {}
```

### 10.4 `Portal/dev-ui/README.md`

Responsabilidades:

- explicar proposito read-only;
- listar endpoints usados;
- avisar que sync e proibido no MVP;
- explicar risco de competencia;
- explicar como abrir a tela;
- explicar dependencia de `vf-token` no localStorage.

## 11. Validacoes futuras recomendadas

Quando a DevUI for implementada, validar:

1. Abrir sem token mostra aviso e nao faz chamadas.
2. Com token valido, carrega `/operacao/cliente-360/clientes`.
3. Selecionar cliente chama apenas `GET /operacao/cliente-360/:slug`.
4. Informar competencia chama apenas `GET /operacao/cliente-360/:slug?competencia=YYYY-MM`.
5. Network nao mostra POST, PUT, PATCH ou DELETE.
6. Payload cru bate com resposta do backend.
7. `periodo.padrao` e `periodo.tipo` aparecem claramente.
8. `grafico.motivoIndisponivel` aparece quando nao houver serie.
9. `coberturaBaseFaturamento.disponivel:false` aparece sem virar erro.
10. `mcDiagnostico` e `mcPeriodo` aparecem separados.

## 12. Nao fazer

- Nao criar link para a DevUI no menu oficial ainda.
- Nao mexer em `Portal/layout.js`.
- Nao mexer em `Portal/login.js`.
- Nao mexer em `server/index.js`.
- Nao criar rota nova.
- Nao criar controller novo.
- Nao alterar middleware.
- Nao alterar `cliente360Service.js`.
- Nao alterar `cliente360SyncService.js`.
- Nao alterar `cliente360Repository.js`.
- Nao alterar `cliente360CoberturaService.js`.
- Nao rodar migrations.
- Nao instalar dependencia.

## 13. Conclusao

A DevUI Pico.css deve ser uma pagina tecnica isolada, focada em leitura e auditoria do payload real do Cliente 360.

O MVP ideal e pequeno:

- listar clientes;
- carregar Cliente 360 por slug;
- permitir competencia manual;
- exibir cards tecnicos;
- exibir JSON cru;
- nao escrever nada.

Essa abordagem permite validar o backend unificado, os snapshots, o periodo padrao, o grafico e a cobertura base/faturamento sem interferir na tela oficial em desenvolvimento.
