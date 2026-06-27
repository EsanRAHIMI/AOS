'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { gateway } from '@/lib/gateway';
import { getSession } from '@/lib/auth';
import { canRolePerformAction, SAFE_MODE_BLOCKED, type Role } from '@/lib/rbac';

/**
 * RBAC + safe-mode gate for every sensitive action. Denials are reported as a
 * security event (which the gateway also mirrors into the audit trail) and the
 * user is redirected to an explanatory page. The gateway enforces the same rules
 * server-side, so this is defense in depth, not the only line of protection.
 */
async function requirePermission(action: string): Promise<void> {
  const session = await getSession();
  const role = (session?.role ?? 'agent') as Role;
  const actorId = session?.email ?? 'unknown';

  if (SAFE_MODE_BLOCKED.has(action)) {
    const sm = await gateway.safeMode();
    if (sm?.enabled) {
      await gateway.reportSecurityEvent({ eventType: 'safe_mode.blocked', actorId, role, result: 'denied', target: action, riskLevel: 'high', detail: 'mutation blocked: safe mode active' });
      redirect(`/denied?reason=safe_mode&action=${encodeURIComponent(action)}`);
    }
  }
  if (!canRolePerformAction(role, action)) {
    await gateway.reportSecurityEvent({ eventType: 'rbac.denied', actorId, role, result: 'denied', target: action, riskLevel: 'medium', detail: `role ${role} lacks permission for ${action}` });
    redirect(`/denied?reason=rbac&action=${encodeURIComponent(action)}`);
  }
}

export async function triggerLearningAction(): Promise<void> {
  await requirePermission('triggerLearning');
  const res = await gateway.triggerLearning('manual', 'Triggered from dashboard');
  revalidatePath('/learning');
  revalidatePath('/learning/triggers');
  if (res?.taskId) redirect(`/tasks/${res.taskId}`);
}

export async function decideRecommendationAction(formData: FormData): Promise<void> {
  await requirePermission('decideRecommendation');
  const res = await gateway.decideRecommendation(String(formData.get('id')), String(formData.get('action')));
  revalidatePath('/system-recommendations');
  revalidatePath('/audit-logs');
  revalidatePath('/tasks');
  if (res?.taskId) redirect(`/tasks/${res.taskId}`);
}

export async function decideScoringProposalAction(formData: FormData): Promise<void> {
  await requirePermission('decideScoringProposal');
  await gateway.decideScoringProposal(String(formData.get('id')), String(formData.get('action')));
  revalidatePath('/scoring-change-proposals');
  revalidatePath('/scoring-profiles');
  revalidatePath('/audit-logs');
  revalidatePath('/governance');
}

export async function decidePolicyProposalAction(formData: FormData): Promise<void> {
  await requirePermission('decidePolicyProposal');
  await gateway.decidePolicyProposal(String(formData.get('id')), String(formData.get('action')));
  revalidatePath('/policy-change-proposals');
  revalidatePath('/policy-rules');
  revalidatePath('/audit-logs');
}

export async function createTaskAction(formData: FormData): Promise<void> {
  await requirePermission('createTask');
  const goal = String(formData.get('goal') ?? '').trim();
  if (!goal) return;
  const created = await gateway.createTask(goal);
  const taskId = created?.taskId;
  revalidatePath('/tasks');
  if (taskId) redirect(`/tasks/${taskId}`);
  redirect('/tasks');
}

export async function approveAction(formData: FormData): Promise<void> {
  await requirePermission('decideApproval');
  const id = String(formData.get('id'));
  await gateway.decideApproval(id, 'approve');
  revalidatePath('/approvals');
  revalidatePath('/tasks');
}

export async function rejectAction(formData: FormData): Promise<void> {
  await requirePermission('decideApproval');
  const id = String(formData.get('id'));
  await gateway.decideApproval(id, 'reject', 'Rejected from dashboard');
  revalidatePath('/approvals');
  revalidatePath('/tasks');
}

export async function confirmInfraAction(formData: FormData): Promise<void> {
  await requirePermission('confirmInfra');
  const id = String(formData.get('id'));
  await gateway.confirmInfra(id);
  revalidatePath('/infrastructure');
}

export async function approveExpansionAction(formData: FormData): Promise<void> {
  await requirePermission('decideExpansion');
  const id = String(formData.get('id'));
  const res = await gateway.decideExpansion(id, 'approve');
  revalidatePath('/expansion-proposals');
  revalidatePath('/tasks');
  revalidatePath('/capabilities');
  if (res?.buildTaskId) redirect(`/tasks/${res.buildTaskId}`);
}

export async function rejectExpansionAction(formData: FormData): Promise<void> {
  await requirePermission('decideExpansion');
  const id = String(formData.get('id'));
  await gateway.decideExpansion(id, 'reject', 'Rejected from dashboard');
  revalidatePath('/expansion-proposals');
}

export async function requestChangesExpansionAction(formData: FormData): Promise<void> {
  await requirePermission('decideExpansion');
  const id = String(formData.get('id'));
  await gateway.decideExpansion(id, 'request_changes', 'Changes requested from dashboard');
  revalidatePath('/expansion-proposals');
}

export async function confirmChecklistAction(formData: FormData): Promise<void> {
  await requirePermission('confirmChecklist');
  const id = String(formData.get('id'));
  await gateway.confirmChecklist(id);
  revalidatePath('/deployment/checklists');
}

export async function runActivationAction(formData: FormData): Promise<void> {
  await requirePermission('runActivation');
  const id = String(formData.get('id'));
  const baseUrl = String(formData.get('baseUrl') ?? '').trim() || undefined;
  await gateway.runActivation(id, baseUrl);
  revalidatePath('/deployment/checklists');
  revalidatePath('/activations');
  revalidatePath('/capabilities');
  revalidatePath('/incidents');
}

export async function approveRepairPlanAction(formData: FormData): Promise<void> {
  await requirePermission('decideRepairPlan');
  const id = String(formData.get('id'));
  const baseUrl = String(formData.get('baseUrl') ?? '').trim() || undefined;
  await gateway.decideRepairPlan(id, 'approve', baseUrl);
  revalidatePath(`/incidents/${String(formData.get('incidentId') ?? '')}`);
  revalidatePath('/incidents');
  revalidatePath('/repair-plans');
  revalidatePath('/capabilities');
}

export async function rejectRepairPlanAction(formData: FormData): Promise<void> {
  await requirePermission('decideRepairPlan');
  await gateway.decideRepairPlan(String(formData.get('id')), 'reject');
  revalidatePath('/repair-plans');
  revalidatePath('/incidents');
}

export async function requestChangesRepairPlanAction(formData: FormData): Promise<void> {
  await requirePermission('decideRepairPlan');
  await gateway.decideRepairPlan(String(formData.get('id')), 'request_changes');
  revalidatePath('/repair-plans');
  revalidatePath('/incidents');
}

export async function revalidateIncidentAction(formData: FormData): Promise<void> {
  await requirePermission('revalidateIncident');
  const id = String(formData.get('id'));
  const baseUrl = String(formData.get('baseUrl') ?? '').trim() || undefined;
  await gateway.revalidateIncident(id, baseUrl);
  revalidatePath(`/incidents/${id}`);
  revalidatePath('/incidents');
  revalidatePath('/capabilities');
}

/* -------------------- Phase 12: security actions -------------------- */

export async function runSecurityCheckAction(): Promise<void> {
  await requirePermission('runSecurityCheck');
  await gateway.runSecurityCheck();
  revalidatePath('/security');
  revalidatePath('/security/events');
}

export async function setSafeModeAction(formData: FormData): Promise<void> {
  await requirePermission('setSafeMode');
  const enabled = String(formData.get('enabled')) === 'true';
  await gateway.setSafeMode(enabled);
  revalidatePath('/security');
  revalidatePath('/security/safe-mode');
  revalidatePath('/');
}
