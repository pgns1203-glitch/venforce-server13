# AI Provider (texto) — V1

Camada entre os engines e a IA de texto. Introduzida na F6 do SEO de anúncios ML.

```
tituloEngine / descricaoEngine / otimizador legado
        │  aiProvider.gerarJSON({ task, system, prompt, maxTokens, temperature })
        ▼
server/services/ai/aiProvider.js   ← resolve modelo pela task, mede, loga
        │  gerarTexto({ system, prompt, maxTokens, temperature, model })
        ▼
server/services/ai/claudeClient.js ← URL, headers, chave, Messages API, retry, timeout
```

Os engines não conhecem URL, headers, chave, formato da Messages API, retry
nem timeout. Só informam a **task**.

## Provedor atual

**Anthropic**, modelo baseline **Haiku** (`claude-haiku-4-5-20251001`,
`DEFAULT_MODEL` em `claudeClient.js`). É o mesmo padrão de antes da F6.

## Tasks (`server/services/ai/aiTasks.js`)

| Constante | Valor | Quem usa | Usa IA? |
|---|---|---|---|
| `AI_TASKS.SEO_TITLE` | `seo_title` | Title Engine (`POST /seo/titulos`) | sim |
| `AI_TASKS.SEO_DESCRIPTION` | `seo_description` | Description Engine (`POST /seo/descricao`) | sim |
| `AI_TASKS.LEGACY_OPTIMIZER` | `legacy_optimizer` | otimizador legado (`POST /:itemId/otimizar`) | sim |
| — | — | Termos Complementares | **não** (determinístico) |

## Configuração

| Env | Obrigatória | Papel |
|---|---|---|
| `ANTHROPIC_API_KEY` | sim (sem ela: `NO_API_KEY`, nenhuma chamada) | chave da Anthropic |
| `ANTHROPIC_MODEL` | não | modelo padrão de todas as tasks |
| `AI_SEO_TITLE_MODEL` | não (nova, F6) | modelo só de `seo_title` |
| `AI_SEO_DESCRIPTION_MODEL` | não (nova, F6) | modelo só de `seo_description` |
| `AI_PROVIDER` | não (já existia) | provedor ativo; ausente, vazio ou `anthropic` = Anthropic. Qualquer outro valor = erro `AI_PROVIDER_INVALID` |

Precedência do modelo:

```
env da task (AI_SEO_TITLE_MODEL / AI_SEO_DESCRIPTION_MODEL)
  → ANTHROPIC_MODEL
  → DEFAULT_MODEL (Haiku)
```

- Env vazia ou só com espaços é ignorada.
- `legacy_optimizer` não tem env própria: segue `ANTHROPIC_MODEL` → Haiku.
- Task ausente ou desconhecida nunca lê env: usa o padrão do provedor.
- Não existe `AI_DEFAULT_MODEL`: com um provedor só, ele duplicaria
  `ANTHROPIC_MODEL`.

`AI_PROVIDER` inválido (typo, `openai`, `gemini`…) **não** cai em silêncio no
Anthropic: toda geração devolve `{ ok:false, codigo:"AI_PROVIDER_INVALID" }` sem
chamar a API, e a mensagem não ecoa o valor configurado.

**Backward compatibility:** sem nenhuma env nova o comportamento é idêntico
ao anterior. Produção não precisa mudar nada.

`temperature` continua obedecendo `aceitaTemperature(model)` com o modelo
**efetivo** da task: se uma task apontar para um modelo que não aceita o
parâmetro (Sonnet 5+, Opus 4.7+…), ele é omitido.

## Retry e timeout (inalterados desde a F1)

- Timeout: **45 s por tentativa**.
- Máximo de **2 tentativas**: só 429, 5xx e falha de rede ganham 1 retry,
  com espera `Retry-After` limitada a 5 s (sem header: 1 s).
- Sem retry: timeout, 4xx funcional, `JSON_INVALIDO`, `AI_RESPONSE_TRUNCATED`,
  `NO_API_KEY`, `EMPTY_RESPONSE`.
- Pior caso por clique: ≈ 95 s (1ª tentativa devolve 5xx perto dos 45 s,
  5 s de espera, 2ª tentativa esgota os 45 s). Timeout logo na 1ª: 45 s.

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

OpenAI, Gemini ou outro entram como um client novo com a mesma interface do
`claudeClient` (`gerarTexto`, `getModel`, `resolverModeloPadrao`, `PROVIDER`),
registrado no mapa `PROVIDERS` do `aiProvider`. Os engines não mudam. Não
existem hoje: provider alternativo, fallback entre provedores, benchmark,
escolha no frontend, nem persistência de métricas.
