// Desktop backup core in Node: snapshot of the seeded demo database, restore, local license.
import { beforeAll, describe, expect, it } from 'vitest';
import { demoFetch } from '@/demo/fetch';
import { DEMO_EMAIL, DEMO_PASSWORD, getDemoServer } from '@/demo/server';
import { installLocalLicense, LOCAL_PLAN } from './license';
import { exportSnapshot, importSnapshot, parseSnapshot, SnapshotError } from './snapshot';

async function call(method: string, path: string, body?: unknown) {
  const res = await demoFetch(`/api${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

async function count(table: string) {
  const { client } = await getDemoServer();
  const { rows } = await client.query<{ n: number }>(`select count(*)::int as n from ${table}`);
  return rows[0]!.n;
}

describe('desktop snapshot', () => {
  beforeAll(async () => {
    await getDemoServer();
    expect((await call('POST', '/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD })).status).toBe(200);
  }, 120_000);

  it('restores every row, encrypted fields included', async () => {
    const { client } = await getDemoServer();
    const contactsBefore = (await call('GET', '/contacts')).body;
    const transactions = await count('transactions');
    expect(transactions).toBeGreaterThan(0);

    const text = await exportSnapshot(client);
    const snapshot = parseSnapshot(text);
    expect(snapshot.migrations.length).toBeGreaterThan(0);
    expect(snapshot.tables.transactions).toHaveLength(transactions);
    // The backup is light: a few hundred KB of text for the full demo data set.
    expect(text.length).toBeLessThan(5_000_000);

    await client.exec('delete from transactions; delete from contacts;');
    expect(await count('transactions')).toBe(0);

    await importSnapshot(client, snapshot);
    expect(await count('transactions')).toBe(transactions);
    // Same session works and decrypts CPF/e-mail/phone exactly as before.
    expect((await call('GET', '/contacts')).body).toEqual(contactsBefore);
    // And the restored account signs in again.
    expect((await call('POST', '/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD })).status).toBe(200);
  });

  it('refuses a backup from a newer app version, keeping the data', async () => {
    const { client } = await getDemoServer();
    const snapshot = parseSnapshot(await exportSnapshot(client));
    const transactions = await count('transactions');
    snapshot.migrations.push('9999_future.sql');
    snapshot.tables.transactions = [];
    await expect(importSnapshot(client, snapshot)).rejects.toBeInstanceOf(SnapshotError);
    expect(await count('transactions')).toBe(transactions);
  });

  it('rejects files that are not a snapshot', () => {
    expect(() => parseSnapshot('não é json')).toThrow(SnapshotError);
    expect(() => parseSnapshot('{"format":"outro"}')).toThrow('não é um backup');
  });

  it('local license keeps every workspace writable', async () => {
    const { client } = await getDemoServer();
    await installLocalLicense(client);
    // Whatever billing writes (an expired trial here) is turned into the local plan.
    await client.exec(`update subscriptions set status = 'expired', trial_ends_at = now() - interval '1 day'`);
    const { rows } = await client.query<{ status: string; plan_code: string }>('select distinct status, plan_code from subscriptions');
    expect(rows).toEqual([{ status: 'active', plan_code: LOCAL_PLAN }]);
    expect((await call('GET', '/auth/me')).body.workspace.subscription).toMatchObject({ status: 'active', canWrite: true });
  });
});
