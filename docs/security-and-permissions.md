# Security & Permissions

Powerful but permission-governed. Make autonomy observable, auditable, controllable.

## Hard rules
- No blind destructive actions. No hidden production changes.
- No uncontrolled secret exposure. No irreversible external action without approval.
- No direct real-world action without approval. No uncontrolled host access.
- All important actions logged. All sensitive actions require approval.
- All service-to-service calls use internal tokens.
- Every agent declares a capability list (manifest).

## Tokens
- `FACTORY_INTERNAL_TOKEN` — service-to-service (constant-time compared).
- `FACTORY_ADMIN_TOKEN` — human/dashboard privileged access.
- Tokens are validated with `timingSafeEqual` (see `shared/src/auth`).
- The dashboard keeps tokens **server-side only** (Next.js server components +
  `/api/stream` proxy); secrets never reach the browser.

## Actions requiring approval
Creating production services; changing prod env; accessing secrets; modifying
deployment; destructive/irreversible commands; deleting data; migrations;
external API actions with real-world impact; sending external messages; changing
domains; connecting physical devices. The `approvals` collection + gateway
decision endpoint enforce this; every decision is logged.
