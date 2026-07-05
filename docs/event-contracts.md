# Event Contracts

Events are AOS's realtime nervous system. Event type constants are in
`shared/src/constants/index.ts`; the event schema is in `shared/src/schemas/event.ts`.

## Envelope

```json
{
  "eventId": "evt_...",
  "type": "task.created",
  "source": "gateway-api",
  "taskId": "task_...",
  "payload": {},
  "createdAt": "ISO-8601"
}
```

## Naming

Use `<domain>.<thing>.<pastTenseVerb>` for durable events:

- `task.created`, `task.completed`, `task.failed`
- `agent.run.started`, `agent.run.step`, `agent.run.finished`
- `approval.requested`, `approval.decided`
- `service.registered`, `service.health.changed`
- `research.completed`, `review.completed`, `qa.completed`, `report.generated`
- `operator.session.started`, `operator.step.finished`
- `workspace.run.created`, `workspace.verification.completed`
- `security.event.recorded`, `audit.log.created`

## Transport

Services publish to `event-bus-service` with the internal token. The bus persists
events in MongoDB and fans them out through SSE. The dashboard subscribes through
its own server-side `/api/stream` proxy so internal secrets never reach browsers.

## Event Quality Rules

- Events must be factual and short.
- Payloads must not include secrets or large blobs.
- Store large artifacts in S3 and link them through evidence records.
- Every approval, denial, mutation, deployment, workspace promotion, and external
  action should produce an event and an audit/evidence record.
- User/tenant/case events must include scope metadata but not private payloads.
- Cross-tenant event streams must filter by authorization before delivery.

## Scale Direction

The current SSE bus is intentionally simple. For multi-instance production,
introduce Redis Streams or NATS behind the same event contract, then keep SSE as
the dashboard delivery layer.
