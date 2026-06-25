'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { gateway } from '@/lib/gateway';

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
