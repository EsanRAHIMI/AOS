# Model provider switching and usage records

Jarvis accepts a provider policy on every turn: `auto`, `local`, `openai`, or
`anthropic`. The dashboard selector persists only the policy name in the
browser. API keys remain server-side.

`auto` resolves from `LLM_DEFAULT_PROVIDER` (product default: `openai`), then
the other cloud key, then the local OpenAI-compatible endpoint, then honest
degraded mode. An explicit selection is fail-closed: an unconfigured OpenAI
selection will not silently spend on or switch to another provider. Local
Ollama remains available by choosing `local` in the Jarvis selector.

For service-wide jobs that do not originate in Jarvis, set
`LLM_PROVIDER_MODE`. Provider-specific model variables prevent a local model
ID from leaking into an OpenAI request (and the inverse). See `.env.example`.

Every native agent-loop model call writes one `LLM_COST_RECORDS` document with
provider, model, run/task/agent IDs, input/output/cached/reasoning/total tokens,
estimated USD cost, and timestamps. `usageSource=provider` means the token
counts came from the provider response. Cost is calculated from configured or
built-in per-million-token rates; configure `LLM_PRICE_OVERRIDES_JSON` when a
model has no built-in rate or the commercial rate changes. A missing rate is
recorded as `pricingSource=none`, rather than pretending that the call was
free.

The `/llm/costs` screen exposes recent per-call records and aggregates the
latest 1,000 records. It labels this bounded view as tracked cost, not an
all-time billing statement. The provider's own billing console remains the
financial source of truth because discounts, batches, cache writes, and taxes
can differ from token-list-price estimates.
