# Template: agent-service

Working reference for a new independent agent service. The `.tmpl` files use
placeholders (`__SERVICE_ID__`, `__SERVICE_NAME__`, `__PORT__`, `__SUBDOMAIN__`,
`__PURPOSE__`) substituted when scaffolding. The generated service boots via
`@factory/service-kit`, records `agent_runs`, and emits run lifecycle events.
See any `services/*-agent` for an instantiated example.
