/**
 * Dokploy activation checklist builder. Infrastructure is still created manually
 * in Dokploy, so the kernel produces a precise, copyable checklist for a
 * validated service: app settings, env (secrets flagged), and post-deploy
 * verification steps. The user creates the app, then the kernel runs the live
 * activation check.
 */
import { ROOT_DOMAIN, SERVICE_PORTS, SERVICE_SUBDOMAINS } from '../constants/index.js';
import { genId, nowIso } from '../utils/index.js';
import type { DeploymentChecklist } from '../schemas/operations.js';

export interface ChecklistOptions {
  serviceName: string;
  capabilityId?: string | null;
  repository?: string;
  taskId?: string | null;
  /** Extra env keys beyond the standard set (e.g. AWS_*, OPENAI_API_KEY). */
  extraSecrets?: string[];
  notes?: string[];
}

export function buildDeploymentChecklist(opts: ChecklistOptions): DeploymentChecklist {
  const name = opts.serviceName;
  const port = (SERVICE_PORTS as Record<string, number>)[name] ?? 4200;
  const subdomain = (SERVICE_SUBDOMAINS as Record<string, string>)[name] ?? `${name.replace(/-(agent|service)$/, '')}.${ROOT_DOMAIN}`;
  const now = nowIso();

  const env: DeploymentChecklist['env'] = [
    { key: 'NODE_ENV', value: 'production', secret: false },
    { key: 'FACTORY_ENV', value: 'production', secret: false },
    { key: 'SERVICE_ID', value: name, secret: false },
    { key: 'SERVICE_NAME', value: name, secret: false },
    { key: 'SERVICE_DOMAIN', value: `https://${subdomain}`, secret: false },
    { key: 'SERVICE_PORT', value: String(port), secret: false },
    { key: 'MONGODB_DB_NAME', value: 'autonomous_os_kernel', secret: false },
    { key: 'SERVICE_REGISTRY_URL', value: `https://${SERVICE_SUBDOMAINS['service-registry']}`, secret: false },
    { key: 'EVENT_BUS_URL', value: `https://${SERVICE_SUBDOMAINS['event-bus-service']}`, secret: false },
    { key: 'MONGODB_URI', value: '', secret: true },
    { key: 'FACTORY_INTERNAL_TOKEN', value: '', secret: true },
    ...(opts.extraSecrets ?? []).map((k) => ({ key: k, value: '', secret: true })),
  ];

  const notes = [...(opts.notes ?? [])];
  if (name === 'browser-testing-agent') {
    notes.push('For real browsers add playwright-core and run `npx playwright install chromium` in the build (else HTTP fallback).');
    notes.push('Set AWS_* to enable screenshot capture (optional).');
  }

  return {
    checklistId: genId('chk'),
    taskId: opts.taskId ?? null,
    serviceName: name,
    capabilityId: opts.capabilityId ?? null,
    appName: name,
    repository: opts.repository ?? 'github.com/<owner>/autonomous-os-kernel',
    rootDirectory: `services/${name}`,
    buildCommand: `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @factory/${name}... run build`,
    startCommand: `pnpm --filter @factory/${name} run start`,
    port,
    subdomain,
    healthCheckPath: '/health',
    env,
    notes,
    verificationSteps: [
      `Create the Dokploy app "${name}" with the settings above.`,
      `Set the domain to ${subdomain} and the port to ${port}.`,
      'Add all env variables (fill the secret values).',
      'Deploy, then confirm here with "I created this in Dokploy".',
      'Run the activation check — the kernel will verify /health, manifest, capabilities, and a safe task.',
    ],
    status: 'awaiting_deployment',
    createdAt: now,
    updatedAt: now,
  };
}
