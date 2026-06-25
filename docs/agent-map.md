# Agent Map

Each agent is an independent service. Capabilities are declared in its
`src/factory/manifest.ts` and stored by the service-registry.

## orchestrator-agent — central brain
receive_goal, decompose_goal, assign_work, track_progress, coordinate_services,
request_approval, generate_reports, propose_evolution.

## architect-agent
design_service_architecture, define_service_boundaries, generate_api_contracts,
define_database_schema, define_event_flows, define_env_vars,
create_deployment_requirements.

## builder-agent
generate_code, modify_code, create_service_scaffold, create_api_endpoints,
create_frontend_components, create_workers, create_tests.

## devops-agent
generate_dokploy_instructions, generate_container_spec, generate_env_list,
generate_domain_requirements, validate_deployment_readiness.

## memory-agent
store_task_history, store_decisions, store_patterns, extract_skills,
generate_compact_summaries, reduce_token_usage.

## Planned agents (Phase 2)
reviewer-agent, qa-agent, monitor-agent, report-agent — same service shape,
generated from `templates/agent-service`.
