import { expect } from 'vitest';
import type { ResidenceStorageAdapter } from '@arcp/residence-storage';

export async function runResidenceStorageConformance(
  makeAdapter: () => Promise<ResidenceStorageAdapter>,
): Promise<void> {
  const adapter = await makeAdapter();
  const bytes = new TextEncoder().encode('hello');
  const first = await adapter.write({ path: 'notes/a.txt' }, bytes, { ifAbsent: true });
  expect(first.status).toBe('written');
  expect(first.contentHash.startsWith('sha256:')).toBe(true);

  const blob = await adapter.read(first.ref);
  expect(blob?.bytes).toEqual(bytes);

  await expect(
    adapter.write(
      { path: 'notes/a.txt' },
      new TextEncoder().encode('other'),
      { ifAbsent: true },
    ),
  ).rejects.toMatchObject({ code: 'conflict' });

  const baseline = await adapter.snapshot();
  await adapter.write({ path: 'notes/b.txt' }, new TextEncoder().encode('second'));
  const reconciliation = await adapter.diff(baseline);
  expect(reconciliation.diff.added.map((entry) => entry.path)).toContain('notes/b.txt');

  const removed = await adapter.remove({ path: 'notes/b.txt' });
  expect(removed.status).toBe('removed');
  const removedAgain = await adapter.remove({ path: 'notes/b.txt' });
  expect(removedAgain.status).toBe('already_absent');
}
