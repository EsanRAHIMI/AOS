'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { gateway } from '@/lib/gateway';

export async function triggerLearningAction(): Promise<void> {
  const res = await gateway.triggerLearning('manual', 'Triggered from dashboard');
  revalidatePath('/learning');
  revalidatePath('/learning/triggers');
  if (res?.taskId) redirect(`/tasks/${res.taskId}`);
}

export async function decideRecommendationAction(formData: FormData): Promise<void> {
  const res = await gateway.decideRecommendation(String(formData.get('id')), String(formData.get('action')));
  revalidatePath('/system-recommendations');
  revalidatePath('/audit-logs');
  revalidatePath('/tasks');
  if (res?.taskId) redirect(`/tasks/${res.taskId}`);
}

export async function decideScoringProposalAction(formData: FormData): Promise<void> {
  await gateway.decideScoringProposal(String(formData.get('id')), String(formData.get('action')));
  revalidatePath('/scoring-change-proposals');
  revalidatePath('/scoring-profiles');
  revalidatePath('/audit-logs');
  revalidatePath('/governance');
}

export async function decidePolicyProposalAction(formData: FormData): Promise<void> {
  await gateway.decidePolicyProposal(String(formData.get('id')), String(formData.get('action')));
  revalidatePath('/policy-change-proposals');
  revalidatePath('/policy-rules');
  revalidatePath('/audit-logs');
}

export async function createTaskAction(formData: FormData): Promise<void> {
  const goal = String(formData.get('goal') ?? '').trim();
  if (!goal) return;
  const created = await gateway.createTask(goal);
  const taskId = created?.taskId;
  revalidatePath('/tasks');
  if (taskId) redirect(`/tasks/${taskId}`);
  redirect('/tasks');
}

export async function approveAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id'));
  await gateway.decideApproval(id, 'approve');
  revalidatePath('/approvals');
  revalidatePath('/tasks');
}

export async function rejectAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id'));
  await gateway.decideApproval(id, 'reject', 'Rejected from dashboard');
  revalidatePath('/approvals');
  revalidatePath('/tasks');
}

export async function confirmInfraAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id'));
  await gateway.confirmInfra(id);
  revalidatePath('/infrastructure');
}

export async function approveExpansionAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id'));
  const res = await gateway.decideExpansion(id, 'approve');
  revalidatePath('/expansion-proposals');
  revalidatePath('/tasks');
  revalidatePath('/capabilities');
  if (res?.buildTaskId) redirect(`/tasks/${res.buildTaskId}`);
}

export async function rejectExpansionAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id'));
  await gateway.decideExpansion(id, 'reject', 'Rejected from dashboard');
  revalidatePath('/expansion-proposals');
}

export async function requestChangesExpansionAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id'));
  await gateway.decideExpansion(id, 'request_changes', 'Changes requested from dashboard');
  revalidatePath('/expansion-proposals');
}

export async function confirmChecklistAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id'));
  await gateway.confirmChecklist(id);
  revalidatePath('/deployment/checklists');
}

export async function runActivationAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id'));
  const baseUrl = String(formData.get('baseUrl') ?? '').trim() || undefined;
  await gateway.runActivation(id, baseUrl);
  revalidatePath('/deployment/checklists');
  revalidatePath('/activations');
  revalidatePath('/capabilities');
  revalidatePath('/incidents');
}

export async function approveRepairPlanAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id'));
  const baseUrl = String(formData.get('baseUrl') ?? '').trim() || undefined;
  await gateway.decideRepairPlan(id, 'approve', baseUrl);
  revalidatePath(`/incidents/${String(formData.get('incidentId') ?? '')}`);
  revalidatePath('/incidents');
  revalidatePath('/repair-plans');
  revalidatePath('/capabilities');
}

export async function rejectRepairPlanAction(formData: FormData): Promise<void> {
  await gateway.decideRepairPlan(String(formData.get('id')), 'reject');
  revalidatePath('/repair-plans');
  revalidatePath('/incidents');
}

export async function requestChangesRepairPlanAction(formData: FormData): Promise<void> {
  await gateway.decideRepairPlan(String(formData.get('id')), 'request_changes');
  revalidatePath('/repair-plans');
  revalidatePath('/incidents');
}

export async function revalidateIncidentAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id'));
  const baseUrl = String(formData.get('baseUrl') ?? '').trim() || undefined;
  await gateway.revalidateIncident(id, baseUrl);
  revalidatePath(`/incidents/${id}`);
  revalidatePath('/incidents');
  revalidatePath('/capabilities');
}
