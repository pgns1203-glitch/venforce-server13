# AI Provider (texto) — V1

Camada entre os engines e a IA de texto. Introduzida na F6 do SEO de anúncios
ML; a F6.1 adicionou o segundo provedor (Xiaomi MiMo) e o provedor por task.

```
tituloEngine / descricaoEngine / otimizador legado
        │  aiProvider.gerarJSON({ task, system, prompt, maxTokens, temperature })
        ▼
server/services/ai/aiProvider.js   ← resolve provedor e modelo pela task, mede, loga
        │  gerarTexto({ system, prompt, maxTokens, temperature, model })
        ▼
claudeClient.js (anthropic)  |  mimoClient.js (mimo)
        ← URL, headers, chave, formato da API, retry, timeout, temperature/thinking
```

Os engines não conhecem provedor, URL, headers, chave, formato da API, retry
nem timeout. Só informam a **task**.

## Provedores

| Provedor | Client | Modelo padrão | Endpoint |
|---|---|---|---|
| `anthropic` | `claudeClient.js` | `claude-haiku-4-5-20251001` (Haiku) | `https://api.anthropic.com/v1/messages` |
| `mimo` | `mimoClient.js` | `mimo-v2.6-pro` | `https://api.xiaomimimo.com/anthropic/v1/messages` (pay-as-you-go) |

A MiMo é chamada pela API **compatível com o protocolo Anthropic Messages**
(doc oficial: <https://mimo.mi.com/docs/en-US/api/chat/anthropic-api>), mas o
provedor registrado em metadata e log é sempre `mimo`. A chave é própria
(`MIMO_API_KEY`, header `api-key`). O host do Token Plan
(`token-plan-cn.xiaomimimo.com`) usa outra chave e não é suportado.

## Tasks (`server/services/ai/aiTasks.js`)

| Constante | Valor | Quem usa | Provedor configurável? |
|---|---|---|---|
| `AI_TASKS.SEO_TITLE` | `seo_title` | Title Engine (`POST /seo/titulos`) | sim |
| `AI_TASKS.SEO_DESCRIPTION` | `seo_description` | Description Engine (`POST /seo/descricao`) | sim |
| `AI_TASKS.LEGACY_OPTIMIZER` | `legacy_optimizer` | otimizador legado (`POST /:itemId/otimizar`) | **não**: fixo em `anthropic` |
| — | — | Termos Complementares | não usa IA |

## Configuração

| Env | Obrigatória | Papel |
|---|---|---|
| `ANTHROPIC_API_KEY` | quando alguma task usa `anthropic` | chave da Anthropic |
| `ANTHROPIC_MODEL` | não | modelo padrão do Anthropic |
| `MIMO_API_KEY` | quando alguma task usa `mimo` | chave da MiMo |
| `MIMO_MODEL` | não | modelo padrão da MiMo (vazio = `mimo-v2.6-pro`) |
| `AI_PROVIDER` | não | provedor padrão das tasks configuráveis: `anthropic` ou `mimo` |
| `AI_SEO_TITLE_PROVIDER` | não | provedor só de `seo_title` |
| `AI_SEO_DESCRIPTION_PROVIDER` | não | provedor só de `seo_description` |
| `AI_SEO_TITLE_MODEL` | não | modelo só de `seo_title` (ID do provedor resolvido) |
| `AI_SEO_DESCRIPTION_MODEL` | não | modelo só de `seo_description` (ID do provedor resolvido) |

Precedência do **provedor**:

```
legacy_optimizer → anthropic (fixo)
outras tasks:  AI_SEO_*_PROVIDER → AI_PROVIDER → anthropic
```

Precedência do **modelo** (depois de resolvido o provedor):

```
AI_SEO_*_MODEL
  → anthropic: ANTHROPIC_MODEL → claude-haiku-4-5-20251001
  → mimo:      MIMO_MODEL      → mimo-v2.6-pro
```

- Env vazia ou só com espaços = não configurada. Provedor ignora maiúsculas.
- `AI_SEO_*_MODEL` vale para o provedor que a task resolveu: com
  `AI_SEO_TITLE_PROVIDER=mimo`, ele precisa ser um ID da MiMo.
- Task ausente ou desconhecida não lê env de task: usa `AI_PROVIDER` e o
  padrão do provedor.
- Não existe `AI_DEFAULT_MODEL`: cada provedor já tem o seu modelo padrão.
- Valor fora de `anthropic`/`mimo` em `AI_PROVIDER` ou `AI_SEO_*_PROVIDER`
  (typo, `openai`, `gemini`…) **não** cai em silêncio em outro provedor: a
  geração devolve `{ ok:false, codigo:"AI_PROVIDER_INVALID" }` sem chamar API.
  A mensagem nomeia a env, mas não ecoa o valor. `AI_PROVIDER` inválido falha
  todas as tasks, mesmo as com override.

**Backward compatibility:** sem nenhuma env nova o comportamento é idêntico ao
da F6: Anthropic + Haiku em todas as tasks. Produção não precisa mudar nada.

Exemplo — títulos e descrição na MiMo, legado no Haiku:

```
AI_SEO_TITLE_PROVIDER=mimo
AI_SEO_DESCRIPTION_PROVIDER=mimo
MIMO_MODEL=mimo-v2.6-pro
MIMO_API_KEY=<secret>
ANTHROPIC_API_KEY=<secret>   # continua necessária para o otimizador legado
```

## temperature e thinking

- **Anthropic:** `temperature` segue `aceitaTemperature(model)` com o modelo
  efetivo da task; modelos que não aceitam (Sonnet 5+, Opus 4.7+…) ficam sem.
- **MiMo:** o request leva sempre `thinking: { type: "disabled" }` — nos
  modelos V2.6/V2.5 o thinking vem **ligado por padrão** e, ligado, ignora
  `temperature`/`top_p` (força 1.0/0.95). Com ele desligado, `temperature` é
  enviada e limitada à faixa oficial [0, 1.5]; sem número, vale o default da
  MiMo (1.0). `top_p` não é enviado.

## JSON

Os dois provedores devolvem texto; o `aiProvider` extrai e valida o JSON. O
modo JSON nativo da MiMo (`response_format`) só existe na API compatível com
OpenAI, então não é usado. A validação final continua nos engines.

## Retry e timeout (mesma política nos dois provedores)

- Timeout: **45 s por tentativa**.
- Máximo de **2 tentativas**: só 429, 5xx e falha de rede ganham 1 retry,
  com espera `Retry-After` limitada a 5 s (sem header: 1 s). A doc da MiMo
  marca 429/500/503 como retryable e não promete `Retry-After`.
- Sem retry: timeout, 4xx funcional (inclui 402 saldo e 421 filtro de conteúdo
  da MiMo), `JSON_INVALIDO`, `AI_RESPONSE_TRUNCATED`, `NO_API_KEY`,
  `EMPTY_RESPONSE`, `CONTENT_FILTER`.
- Pior caso por clique: ≈ 95 s (1ª tentativa devolve 5xx perto dos 45 s,
  5 s de espera, 2ª tentativa esgota os 45 s). Timeout logo na 1ª: 45 s.

Códigos específicos da MiMo, normalizados para o contrato comum:

| stop_reason / status | Código |
|---|---|
| `max_tokens`, `repetition_truncation` | `AI_RESPONSE_TRUNCATED` |
| `content_filter` | `CONTENT_FILTER` |
| HTTP 4xx/5xx | `HTTP_<status>` |

## Metadata interna

`gerarJSON`/`gerarTexto` devolvem, além dos campos de sempre, `meta`:

```js
{ task, provider, model, latencyMs,
  usage: { inputTokens, outputTokens },
  finishReason, tentativas, status: "ok" | "erro", codigo }
```

Só dados que a API devolveu de fato; ausente = `null` (nunca `0`).
`latencyMs` é `null` quando nenhuma chamada saiu (ex.: `NO_API_KEY`).
`meta` **não** é exposto nas respostas HTTP públicas.

Cada geração escreve uma linha `[ai] task=… provider=… model=… status=…
codigo=… latencyMs=… inputTokens=… outputTokens=… finishReason=…
tentativas=…` via `console.info`. Nunca registra prompt, texto gerado,
título, descrição, dados do anúncio nem chave.

## Futuro (não implementado)

OpenAI, Gemini ou outro entram como um client novo com a mesma interface
(`gerarTexto`, `getModel`, `resolverModeloPadrao`, `PROVIDER`), registrado no
mapa `PROVIDERS` do `aiProvider`. Os engines não mudam. Não existem hoje:
fallback entre provedores, benchmark, escolha no frontend, nem persistência
de métricas.
