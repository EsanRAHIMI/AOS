# Event Contracts

Events are the system's real-time nervous system. Defined in
`shared/src/constants` (`EVENT_TYPES`) and `shared/src/schemas/event.ts`.

## Naming
`<domain>.<thing>.<pastTenseVerb>` — e.g. `task.created`, `agent.run.finished`.

## Envelope (`SystemEvent`)
```json
{ "eventId": "evt_…", "type": "task.created", "source": "gateway-api",
  "taskId": "task_…" | null, "payload": { }, "createdAt": "ISO" }
```

## Catalog
- task.created / task.updated / task.completed / task.failed
- agent.run.started / agent.run.step / agent.run.finished / agent.log
- approval.requested / approval.decided
- infra.request.created / infra.request.fulfilled
- service.registered / service.health.changed
- memory.written / doc.updated / research.completed / evolution.proposed

## Transport
Publishers `POST /events` on the event-bus (internal token). The bus persists to
`events` and fans out via SSE on `GET /events/stream`. The dashboard subscribes
through its server-side `/api/stream` proxy so the internal token never reaches
the browser. A Redis/NATS backplane can replace in-process fan-out later without
changing this contract.
