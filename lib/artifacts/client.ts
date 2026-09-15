import type { Command } from './contracts';

export async function callCommand<T>(command: Command): Promise<T> {
  const response = await fetch('/api/commands', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = (await response.json()) as { error?: string };
  if (!response.ok)
    throw new Error(data.error ?? 'The request failed. Please retry.');
  return data as T;
}
