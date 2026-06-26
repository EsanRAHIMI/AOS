/**
 * GitHub Delivery Engine. Turns generated/modified files into a branch + commit
 * (+ PR). Mirrors the LLM-router pattern: real GitHub REST when GITHUB_TOKEN +
 * owner + repo are configured, otherwise a deterministic "prepared" operation
 * that computes the branch, lists changed files, and emits ready-to-run git
 * instructions. Either way a GitHubOperation record is produced.
 *
 * Sensitive actions (push to main, production deploy, overwriting core services)
 * must be gated on approval by the caller — this module only ever creates a
 * feature branch + PR, never pushes to the base branch directly.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { genId, nowIso } from '../utils/index.js';
import type { GitHubOperation } from '../schemas/reality.js';

export interface GitHubConfig {
  token?: string;
  owner?: string;
  repo?: string;
  defaultBranch?: string;
}

export interface DeliverOptions {
  serviceName: string;
  servicePath: string;
  files: string[]; // relative to servicePath
  /** Path prefix inside the repo, e.g. "services". */
  repoPathPrefix?: string;
  commitMessage: string;
  branchName?: string;
  taskId?: string | null;
  proposalId?: string | null;
  capabilityId?: string | null;
}

const slugId = (): string => genId('br').split('_')[1]!.slice(0, 7);

export class GitHubDelivery {
  private readonly base: string;
  constructor(private readonly cfg: GitHubConfig) {
    this.base = cfg.defaultBranch ?? 'main';
  }

  get configured(): boolean {
    return Boolean(this.cfg.token && this.cfg.owner && this.cfg.repo);
  }

  async deliver(opts: DeliverOptions): Promise<GitHubOperation> {
    const branchName = opts.branchName ?? `feat/${opts.serviceName}-${slugId()}`;
    const prefix = opts.repoPathPrefix ?? 'services';
    const repoFiles = opts.files.map((f) => `${prefix}/${opts.serviceName}/${f}`);
    const now = nowIso();

    const op: GitHubOperation = {
      operationId: genId('gh'),
      taskId: opts.taskId ?? null,
      proposalId: opts.proposalId ?? null,
      capabilityId: opts.capabilityId ?? null,
      serviceName: opts.serviceName,
      branchName,
      baseBranch: this.base,
      commitSha: null,
      pullRequestUrl: null,
      mode: this.configured ? 'github_api' : 'prepared',
      status: 'prepared',
      filesChanged: repoFiles,
      summary: opts.commitMessage,
      instructions: '',
      createdAt: now,
      updatedAt: now,
    };

    if (!this.configured) {
      op.instructions = [
        `git checkout -b ${branchName}`,
        `# add generated files under ${prefix}/${opts.serviceName}/`,
        `git add ${prefix}/${opts.serviceName}`,
        `git commit -m "${opts.commitMessage}"`,
        `git push -u origin ${branchName}`,
        `# then open a PR into ${this.base}`,
      ].join('\n');
      return op;
    }

    // Real delivery via the GitHub REST API (best-effort; failures are recorded).
    try {
      const sha = await this.createBranch(branchName);
      let lastSha = sha;
      for (const rel of opts.files) {
        const content = await readFile(join(opts.servicePath, rel), 'utf8');
        lastSha = await this.putFile(`${prefix}/${opts.serviceName}/${rel}`, content, branchName, opts.commitMessage);
      }
      op.commitSha = lastSha;
      op.status = 'pushed';
      const pr = await this.openPr(branchName, opts.commitMessage);
      if (pr) {
        op.pullRequestUrl = pr;
        op.status = 'pr_open';
      }
    } catch (e) {
      op.status = 'failed';
      op.summary = `${opts.commitMessage} — delivery failed: ${String(e)}`;
    }
    op.updatedAt = nowIso();
    return op;
  }

  private api(path: string): string {
    return `https://api.github.com/repos/${this.cfg.owner}/${this.cfg.repo}${path}`;
  }
  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.cfg.token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' };
  }

  private async createBranch(branch: string): Promise<string> {
    const refRes = await fetch(this.api(`/git/ref/heads/${this.base}`), { headers: this.headers() });
    const ref = (await refRes.json()) as { object?: { sha?: string } };
    const sha = ref.object?.sha;
    if (!sha) throw new Error('base ref not found');
    await fetch(this.api('/git/refs'), { method: 'POST', headers: this.headers(), body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }) });
    return sha;
  }

  private async putFile(path: string, content: string, branch: string, message: string): Promise<string> {
    // Look up existing sha (so updates work), then create/update on the branch.
    let existingSha: string | undefined;
    const getRes = await fetch(this.api(`/contents/${encodeURIComponent(path)}?ref=${branch}`), { headers: this.headers() });
    if (getRes.ok) existingSha = ((await getRes.json()) as { sha?: string }).sha;
    const res = await fetch(this.api(`/contents/${encodeURIComponent(path)}`), {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify({ message, content: Buffer.from(content).toString('base64'), branch, ...(existingSha ? { sha: existingSha } : {}) }),
    });
    const body = (await res.json()) as { commit?: { sha?: string } };
    return body.commit?.sha ?? '';
  }

  private async openPr(branch: string, title: string): Promise<string | null> {
    const res = await fetch(this.api('/pulls'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ title, head: branch, base: this.base, body: 'Generated by the Autonomous OS Kernel reality-execution layer.' }),
    });
    if (!res.ok) return null;
    return ((await res.json()) as { html_url?: string }).html_url ?? null;
  }
}

export function gitHubDeliveryFromEnv(env: NodeJS.ProcessEnv = process.env): GitHubDelivery {
  return new GitHubDelivery({
    token: env.GITHUB_TOKEN || undefined,
    owner: env.GITHUB_OWNER || undefined,
    repo: env.GITHUB_REPO || undefined,
    defaultBranch: env.GITHUB_DEFAULT_BRANCH || 'main',
  });
}
