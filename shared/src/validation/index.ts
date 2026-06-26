/**
 * Runtime Validation Engine. Proves a generated service is real and follows the
 * factory standard before a capability is promoted. Static checks run in-process
 * (files, package.json, manifest contract, standard factory surface, env docs,
 * capability linkage). Build/typecheck are optional and only run when explicitly
 * allowed (so production containers never shell out by default).
 *
 * Returns a RuntimeValidation plus evidence drafts the caller persists.
 */
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { genId, nowIso } from '../utils/index.js';
import type { RuntimeValidation, ValidationCheck } from '../schemas/reality.js';

const pexec = promisify(exec);

const exists = async (p: string): Promise<boolean> => {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
};
const read = async (p: string): Promise<string> => {
  try {
    return await readFile(p, 'utf8');
  } catch {
    return '';
  }
};

export interface ValidateServiceOptions {
  servicePath: string;
  serviceName: string;
  capabilityId: string;
  taskId?: string | null;
  /** When true, also run `tsc --noEmit` (and report build). Default false. */
  allowBuild?: boolean;
  /** Workspace root, required if allowBuild runs a filtered build. */
  workspaceRoot?: string;
}

export interface EvidenceDraft {
  type: import('../schemas/reality.js').EvidenceType;
  summary: string;
  data?: Record<string, unknown>;
}

export interface ValidateServiceResult {
  validation: RuntimeValidation;
  evidence: EvidenceDraft[];
}

/** Validate a generated service. Pure-ish: reads files, optionally runs tsc. */
export async function validateService(opts: ValidateServiceOptions): Promise<ValidateServiceResult> {
  const base = opts.servicePath;
  const checks: ValidationCheck[] = [];
  const logs: string[] = [];
  const recommendations: string[] = [];
  const add = (name: string, passed: boolean, detail = ''): void => {
    checks.push({ name, passed, detail });
  };

  // --- file presence ---
  const pkgRaw = await read(join(base, 'package.json'));
  add('package_json_exists', pkgRaw.length > 0);
  let pkgValid = false;
  let pkgName = '';
  try {
    const pkg = JSON.parse(pkgRaw) as { name?: string; scripts?: Record<string, string> };
    pkgName = pkg.name ?? '';
    pkgValid = Boolean(pkg.name && pkg.scripts?.build && pkg.scripts?.start);
  } catch {
    pkgValid = false;
  }
  add('package_json_valid', pkgValid, pkgName);
  add('package_name_matches', pkgName === `@factory/${opts.serviceName}`, pkgName);

  add('tsconfig_exists', await exists(join(base, 'tsconfig.json')));
  add('readme_exists', await exists(join(base, 'README.md')));
  add('env_example_exists', await exists(join(base, '.env.example')));

  const manifestRaw = await read(join(base, 'src', 'factory', 'manifest.ts'));
  add('manifest_exists', manifestRaw.length > 0);
  add(
    'manifest_contract_valid',
    ['serviceId', 'serviceName', 'capabilities', 'requiredEnv', 'healthEndpoint'].every((f) => manifestRaw.includes(f)),
  );

  const indexRaw = await read(join(base, 'src', 'index.ts'));
  add('index_exists', indexRaw.length > 0);
  // Generated services get the full standard surface from @factory/service-kit.
  const usesKit = indexRaw.includes('createFactoryService');
  add('uses_service_kit', usesKit);
  add('health_endpoint_defined', usesKit, 'provided by service-kit');
  add('factory_manifest_endpoint_defined', usesKit, 'provided by service-kit');
  add('factory_task_endpoint_defined', usesKit && indexRaw.includes('taskHandler'));

  const envRaw = await read(join(base, '.env.example'));
  add('env_documented', ['SERVICE_ID', 'FACTORY_INTERNAL_TOKEN', 'SERVICE_PORT'].every((k) => envRaw.includes(k)));
  add('registerable', usesKit && indexRaw.includes('registryUrl'), 'self-registers via service-kit');
  add('capability_linked', manifestRaw.includes(opts.capabilityId) || indexRaw.includes(opts.capabilityId));

  // --- optional build/typecheck ---
  let validationType: RuntimeValidation['validationType'] = 'static';
  if (opts.allowBuild && opts.workspaceRoot) {
    validationType = 'build';
    try {
      const { stdout, stderr } = await pexec(`pnpm --filter ${pkgName} run typecheck`, {
        cwd: opts.workspaceRoot,
        timeout: 120000,
      });
      add('typescript_typecheck', true);
      logs.push((stdout + stderr).split('\n').slice(-20).join('\n'));
    } catch (e) {
      add('typescript_typecheck', false, 'tsc reported errors');
      logs.push(String((e as { stdout?: string }).stdout ?? e).slice(-2000));
      recommendations.push('Fix TypeScript errors before activation.');
    }
  } else {
    recommendations.push('Run build/typecheck validation in a CI/devops context (allowBuild).');
  }

  const passedCount = checks.filter((c) => c.passed).length;
  const score = Number((passedCount / checks.length).toFixed(3));
  // Critical checks must all pass for an overall pass.
  const critical = ['package_json_valid', 'manifest_exists', 'uses_service_kit', 'factory_task_endpoint_defined', 'capability_linked'];
  const passed = critical.every((n) => checks.find((c) => c.name === n)?.passed) && score >= 0.8;
  if (!passed) recommendations.push('Address failing critical checks before promoting the capability.');

  const validation: RuntimeValidation = {
    validationId: genId('val'),
    taskId: opts.taskId ?? null,
    serviceName: opts.serviceName,
    capabilityId: opts.capabilityId,
    validationType,
    checks,
    passed,
    score,
    logs,
    recommendations,
    createdAt: nowIso(),
  };

  const evidence: EvidenceDraft[] = [
    {
      type: 'validation_report',
      summary: `Validation ${passed ? 'passed' : 'failed'} (${passedCount}/${checks.length}, score ${score}) for ${opts.serviceName}`,
      data: { checks, score, passed },
    },
    {
      type: 'manifest_check_result',
      summary: `Manifest contract ${checks.find((c) => c.name === 'manifest_contract_valid')?.passed ? 'valid' : 'invalid'}`,
      data: { manifestPresent: manifestRaw.length > 0 },
    },
  ];
  if (logs.length) evidence.push({ type: 'typecheck_log', summary: 'TypeScript typecheck log', data: { log: logs.join('\n') } });

  return { validation, evidence };
}
