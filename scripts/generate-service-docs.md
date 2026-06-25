# Runbook: generate-service-docs

Keep docs current after meaningful changes.

1. Update the service README (`services/<id>/README.md`).
2. Update `docs/service-map.md` / `docs/agent-map.md` if capabilities changed.
3. POST the doc to the documentation-service (`POST docs.simorx.com/docs`).
4. Append a `docs/decision-log.md` entry if an architectural choice changed.
5. Append a `docs/phase-log.md` entry when a phase completes.

The documentation-service versions each doc by slug; future agents read the
latest version cheaply.
