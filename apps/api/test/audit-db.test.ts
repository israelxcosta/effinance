// Regression tests of the database security audit (migration 0004): catalog invariants (RLS,
// privileges, indexes), tenant integrity of foreign keys, domain checks, transaction-local tenant
// context, LGPD clean-up, encryption backfill bookkeeping and retention.

import { randomUUID } from 'node:crypto';
import { eq, ilike, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ACCOUNT_TYPES,
  CARD_BRANDS,
  CATEGORY_TYPES,
  FREQUENCIES,
  MEMBER_ROLES,
  PAYMENT_METHODS,
  PLAN_CODES,
  RECURRENCE_KINDS,
  SUBSCRIPTION_STATUSES,
  TRANSACTION_TYPES,
  TRANSFER_KINDS,
  WORKSPACE_KINDS,
} from '@effinance/shared';
import type { App } from '../src/app';
import { backfillEncryption, needsBackfill } from '../src/db/backfill';
import type { DbExecutor } from '../src/db/client';
import { purgeExpiredSecurityRows } from '../src/db/retention';
import {
  accounts,
  categories,
  contacts,
  creditCards,
  goalContributions,
  goals,
  passwordResets,
  recurrences,
  sessions,
  transactions,
  users,
  workspaceInvites,
  workspaces,
  type RecurrenceTemplate,
} from '../src/db/schema';
import { executeRows, likePattern } from '../src/lib/sql';
import { TENANT_STATEMENT_TIMEOUT, withTenant } from '../src/lib/tenant';
import { API_ROLE, IDENTITY_GRANTS, IDENTITY_TABLES, TENANT_TABLES } from './db-roles';
import { admin, createTestApp, registerUser, resetDb } from './helpers';

let app: App;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDb(app);
});

interface PgFailure {
  code: string | undefined;
  message: string;
  detail: string | undefined;
}

/** Drizzle wraps the driver error; the Postgres error (code, detail) is in `cause`. */
async function pgFailure(promise: Promise<unknown>): Promise<PgFailure | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    const e = ((error as { cause?: unknown }).cause ?? error) as { code?: string; message: string; detail?: string };
    return { code: e.code, message: e.message, detail: e.detail };
  }
}

const rows = <T>(query: ReturnType<typeof sql>) => executeRows<T>(admin(), query);

const TEMPLATE: RecurrenceTemplate = {
  type: 'expense',
  description: 'Aluguel',
  amount: 1000,
  accountId: null,
  creditCardId: null,
  categoryId: null,
  subcategoryId: null,
  contactId: null,
  paymentMethod: null,
  notes: null,
};

/** A workspace with one row of every referenced table, written with the owner connection. */
async function seedTenant(label: string) {
  const db = admin();
  const ws = randomUUID();
  await db.insert(workspaces).values({ id: ws, name: label, kind: 'personal' });
  const [account] = await db
    .insert(accounts)
    .values({ workspaceId: ws, name: `Conta ${label}`, type: 'checking', color: '#000000', icon: 'wallet' })
    .returning();
  const [category] = await db
    .insert(categories)
    .values({ workspaceId: ws, name: 'Casa', type: 'expense', icon: 'wallet', color: '#000000' })
    .returning();
  const [subcategory] = await db
    .insert(categories)
    .values({ workspaceId: ws, parentId: category!.id, name: 'Luz', type: 'expense', icon: 'wallet', color: '#000000' })
    .returning();
  const [card] = await db
    .insert(creditCards)
    .values({
      workspaceId: ws,
      name: 'Cartão',
      bank: 'nubank',
      brand: 'visa',
      limit: 100000,
      closingDay: 1,
      dueDay: 10,
      color: '#000000',
      defaultAccountId: account!.id,
    })
    .returning();
  const [contact] = await db.insert(contacts).values({ workspaceId: ws, name: `Contato ${label}` }).returning();
  const [goal] = await db
    .insert(goals)
    .values({ workspaceId: ws, name: 'Meta', targetAmount: 1000, icon: 'wallet', color: '#000000', accountId: account!.id })
    .returning();
  const [contribution] = await db
    .insert(goalContributions)
    .values({ workspaceId: ws, goalId: goal!.id, amount: 100, date: '2026-10-01' })
    .returning();
  const [series] = await db
    .insert(recurrences)
    .values({ workspaceId: ws, kind: 'fixed', frequency: 'monthly', startDate: '2026-10-01', template: TEMPLATE })
    .returning();
  const [tx] = await db
    .insert(transactions)
    .values({
      workspaceId: ws,
      type: 'expense',
      description: 'Conta de luz',
      amount: 100,
      date: '2026-10-01',
      accountId: account!.id,
      categoryId: category!.id,
      subcategoryId: subcategory!.id,
      contactId: contact!.id,
      recurrenceId: series!.id,
      recurrenceKind: 'fixed',
      frequency: 'monthly',
      occurrenceIndex: 0,
    })
    .returning();
  return {
    ws,
    account: account!.id,
    category: category!.id,
    subcategory: subcategory!.id,
    card: card!.id,
    contact: contact!.id,
    goal: goal!.id,
    contribution: contribution!.id,
    series: series!.id,
    tx: tx!.id,
  };
}

async function countRows(table: string, workspaceId: string): Promise<number> {
  const [r] = await rows<{ n: number }>(sql`select count(*)::int as n from ${sql.identifier(table)} where workspace_id = ${workspaceId}`);
  return r!.n;
}

// ---------------------------------------------------------------------------
// Catalog invariants
// ---------------------------------------------------------------------------

describe('catalog: row level security and privileges', () => {
  it('every table is classified; every tenant table has ENABLE + FORCE RLS with USING and WITH CHECK', async () => {
    const tables = await rows<{ name: string; rls: boolean; force: boolean; has_ws: boolean }>(sql`
      select c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as force,
             exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'workspace_id' and not a.attisdropped) as has_ws
        from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')`);
    // A new table must be added to one of the lists (and, if it holds tenant data, get a policy).
    const known = new Set<string>([...TENANT_TABLES, ...IDENTITY_TABLES]);
    expect(tables.map((t) => t.name).filter((n) => !known.has(n))).toEqual([]);

    for (const name of TENANT_TABLES) {
      const t = tables.find((x) => x.name === name);
      expect(t, name).toMatchObject({ rls: true, force: true, has_ws: true });
      const policies = await rows<{ cmd: string; permissive: boolean; qual: string; check: string }>(sql`
        select polcmd as cmd, polpermissive as permissive,
               pg_get_expr(polqual, polrelid) as qual, pg_get_expr(polwithcheck, polrelid) as check
          from pg_policy where polrelid = ${`public.${name}`}::regclass`);
      expect(policies, name).toHaveLength(1);
      const [p] = policies;
      expect(p!.cmd).toBe('*');
      expect(p!.permissive).toBe(true);
      for (const expr of [p!.qual, p!.check]) {
        // Missing/empty setting → NULL → no row (fail closed); never a coalesce to "any".
        expect(expr).toContain("workspace_id = (NULLIF(current_setting('app.workspace_id'::text, true), ''::text))::uuid");
      }
    }
  });

  it('effinance_app: RLS-bound, owns nothing, plain DML on financial tables only', async () => {
    const [role] = await rows<Record<string, boolean>>(sql`
      select rolsuper, rolbypassrls, rolcanlogin, rolcreaterole, rolcreatedb, rolreplication,
             exists (select 1 from pg_auth_members m where m.member = r.oid) as member_of_other,
             exists (select 1 from pg_class c where c.relowner = r.oid) as owns_relations
        from pg_roles r where rolname = 'effinance_app'`);
    expect(role).toEqual({
      rolsuper: false,
      rolbypassrls: false,
      rolcanlogin: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolreplication: false,
      member_of_other: false,
      owns_relations: false,
    });

    const privileges = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
    const grants = await rows<{ table_name: string; privilege_type: string }>(sql`
      select table_name, privilege_type from information_schema.role_table_grants
       where grantee = 'effinance_app' and table_schema = 'public'`);
    for (const table of [...TENANT_TABLES, ...IDENTITY_TABLES]) {
      const got = grants.filter((g) => g.table_name === table).map((g) => g.privilege_type).sort();
      const want = (TENANT_TABLES as readonly string[]).includes(table) ? ['DELETE', 'INSERT', 'SELECT', 'UPDATE'] : [];
      expect(got, table).toEqual(want);
    }
    expect(grants.every((g) => privileges.includes(g.privilege_type))).toBe(true);
  });

  it('API login: no superuser/bypass/inherit, nothing on financial tables, least privilege elsewhere', async () => {
    const [role] = await rows<Record<string, boolean>>(sql`
      select rolsuper, rolbypassrls, rolinherit, rolcreaterole, rolcreatedb from pg_roles where rolname = ${API_ROLE}`);
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false, rolinherit: false, rolcreaterole: false, rolcreatedb: false });

    const all = ['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] as const;
    for (const table of [...TENANT_TABLES, ...IDENTITY_TABLES]) {
      const allowed: readonly string[] = (IDENTITY_GRANTS as Record<string, readonly string[]>)[table] ?? [];
      for (const privilege of all) {
        const [r] = await rows<{ ok: boolean }>(sql`select has_table_privilege(${API_ROLE}, ${`public.${table}`}, ${privilege}) as ok`);
        expect(r!.ok, `${privilege} on ${table}`).toBe(allowed.includes(privilege));
      }
    }
    // Append-only audit trail, enforced by the database.
    const failure = await pgFailure(app.db.execute(sql`delete from audit_logs`));
    expect(failure?.message).toMatch(/permission denied for table audit_logs/);

    const [db] = await rows<{ temp: boolean; create: boolean; migrations: boolean }>(sql`
      select has_database_privilege(${API_ROLE}, current_database(), 'TEMP') as temp,
             has_schema_privilege(${API_ROLE}, 'public', 'CREATE') as create,
             has_schema_privilege(${API_ROLE}, 'drizzle', 'USAGE') as migrations`);
    expect(db).toEqual({ temp: false, create: false, migrations: false });
  });

  it('no SECURITY DEFINER function; every function in public pins search_path and is not executable by PUBLIC', async () => {
    const fns = await rows<{ name: string; definer: boolean; config: string[] | null; public_exec: boolean }>(sql`
      select p.proname as name, p.prosecdef as definer, p.proconfig as config,
             has_function_privilege('public', p.oid, 'EXECUTE') as public_exec
        from pg_proc p where p.pronamespace = 'public'::regnamespace`);
    expect(fns.length).toBeGreaterThan(0);
    for (const f of fns) {
      expect(f.definer, f.name).toBe(false);
      expect(f.config?.some((c) => c.startsWith('search_path=')), f.name).toBe(true);
      expect(f.public_exec, f.name).toBe(false);
    }
  });

  it('every foreign key is backed by an index (deletes never scan tables shared by every tenant)', async () => {
    const missing = await rows<{ name: string }>(sql`
      select c.conname as name from pg_constraint c
       where c.contype = 'f' and c.connamespace = 'public'::regnamespace
         and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = any (c.conkey))`);
    expect(missing).toEqual([]);
    const [sub] = await rows<{ ok: boolean }>(sql`select to_regclass('public.transactions_subcategory_idx') is not null as ok`);
    expect(sub!.ok).toBe(true);
  });

  it('CHECK lists match the shared contract (a new enum value needs a migration)', async () => {
    const defs = await rows<{ name: string; def: string }>(sql`
      select conname as name, pg_get_constraintdef(oid) as def from pg_constraint
       where contype = 'c' and connamespace = 'public'::regnamespace`);
    const values = (name: string) => {
      const def = defs.find((d) => d.name === name)?.def;
      expect(def, name).toBeDefined();
      return [...def!.matchAll(/'([^']*)'::text/g)].map((m) => m[1]).sort();
    };
    const sorted = (list: readonly string[]) => [...list].sort();
    expect(values('accounts_type_chk')).toEqual(sorted(ACCOUNT_TYPES));
    expect(values('credit_cards_brand_chk')).toEqual(sorted(CARD_BRANDS));
    expect(values('categories_type_chk')).toEqual(sorted(CATEGORY_TYPES));
    expect(values('transactions_type_chk')).toEqual(sorted(TRANSACTION_TYPES));
    expect(values('transactions_recurrence_kind_chk')).toEqual(sorted(RECURRENCE_KINDS));
    expect(values('recurrences_kind_chk')).toEqual(sorted(RECURRENCE_KINDS.filter((k) => k !== 'single')));
    expect(values('transactions_frequency_chk')).toEqual(sorted(FREQUENCIES));
    expect(values('recurrences_frequency_chk')).toEqual(sorted(FREQUENCIES));
    expect(values('transactions_payment_method_chk')).toEqual(sorted(PAYMENT_METHODS));
    expect(values('transactions_transfer_kind_chk')).toEqual(sorted(TRANSFER_KINDS));
    expect(values('subscriptions_status_chk')).toEqual(sorted(SUBSCRIPTION_STATUSES));
    expect(values('subscriptions_plan_code_chk')).toEqual(sorted(PLAN_CODES));
    expect(values('workspaces_kind_chk')).toEqual(sorted(WORKSPACE_KINDS));
    expect(values('workspace_members_role_chk')).toEqual(sorted(MEMBER_ROLES));
    expect(values('workspace_invites_role_chk')).toEqual(sorted(MEMBER_ROLES.filter((r) => r !== 'owner')));
  });
});

// ---------------------------------------------------------------------------
// Tenant context
// ---------------------------------------------------------------------------

describe('tenant context', () => {
  it('fails closed with an empty setting and errors on a malformed one', async () => {
    const a = await seedTenant('A');
    const run = (value: string) =>
      app.db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('role', 'effinance_app', true), set_config('app.workspace_id', ${value}, true)`);
        return executeRows<{ n: number }>(tx, sql`select count(*)::int as n from accounts`);
      });
    expect((await run(''))[0]!.n).toBe(0);
    expect((await run(a.ws))[0]!.n).toBe(1);
    expect((await pgFailure(run(`${a.ws}' or 'x' = 'x`)))?.code).toBe('22P02');
    // withTenant refuses anything that is not a uuid before touching the database.
    for (const bad of ['', 'not-a-uuid', `${a.ws}' or 1=1 --`, undefined as unknown as string]) {
      await expect(withTenant(app.db, bad, async () => 1)).rejects.toThrow(/invalid workspace id/);
    }
  });

  it('role and workspace are transaction-local: nothing leaks to the next user of the connection', async () => {
    const a = await seedTenant('A');
    // One connection only, so the checks below run on the very connection the tenant used.
    const client = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
    const db = drizzle(client) as unknown as DbExecutor;
    const context = () =>
      executeRows<{ who: string; ws: string | null; timeout: string }>(
        db,
        sql`select current_user as who, nullif(current_setting('app.workspace_id', true), '') as ws,
                   current_setting('statement_timeout') as timeout`,
      );
    try {
      const [outside] = await context();
      const inside = await withTenant(db, a.ws, (tx) => executeRows<{ who: string; ws: string; timeout: string }>(tx, sql`
        select current_user as who, current_setting('app.workspace_id', true) as ws, current_setting('statement_timeout') as timeout`));
      expect(inside[0]).toEqual({ who: 'effinance_app', ws: a.ws, timeout: TENANT_STATEMENT_TIMEOUT });
      expect((await context())[0]).toEqual({ who: API_ROLE, ws: null, timeout: outside!.timeout });
      expect(outside!.timeout).not.toBe(TENANT_STATEMENT_TIMEOUT);

      await expect(
        withTenant(db, a.ws, async (tx) => {
          await tx.execute(sql`select 1`);
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect((await context())[0]).toEqual({ who: API_ROLE, ws: null, timeout: outside!.timeout });
      // Outside a tenant transaction the login role sees no financial table at all.
      expect((await pgFailure(db.execute(sql`select 1 from transactions limit 1`)))?.message).toMatch(/permission denied/);
    } finally {
      await client.end({ timeout: 5 });
    }
  });

  it('LIKE wildcards typed by the user are matched literally', async () => {
    const a = await seedTenant('A');
    await admin().insert(transactions).values([
      { workspaceId: a.ws, type: 'expense', description: '100% garantido', amount: 1, date: '2026-10-02' },
      { workspaceId: a.ws, type: 'expense', description: 'conta_luz', amount: 1, date: '2026-10-02' },
    ]);
    const search = (term: string) =>
      withTenant(app.db, a.ws, (tx) =>
        tx.select({ d: transactions.description }).from(transactions).where(ilike(transactions.description, likePattern(term))),
      );
    expect((await search('%')).map((r) => r.d)).toEqual(['100% garantido']);
    expect((await search('_')).map((r) => r.d)).toEqual(['conta_luz']);
  });
});

// ---------------------------------------------------------------------------
// Tenant integrity of references
// ---------------------------------------------------------------------------

describe('foreign keys never cross workspaces', () => {
  it('a tenant cannot reference rows of another workspace, and cannot tell whether an id exists', async () => {
    const a = await seedTenant('A');
    const b = await seedTenant('B');
    const base = { workspaceId: b.ws, type: 'expense' as const, description: 'x', amount: 100, date: '2026-10-01' };

    const attempts: [string, (tx: DbExecutor, id: string) => Promise<unknown>, string][] = [
      ['transactions.account_id', (tx, id) => tx.insert(transactions).values({ ...base, accountId: id }), a.account],
      ['transactions.to_account_id', (tx, id) => tx.insert(transactions).values({ ...base, type: 'transfer', toAccountId: id }), a.account],
      ['transactions.credit_card_id', (tx, id) => tx.insert(transactions).values({ ...base, creditCardId: id }), a.card],
      ['transactions.category_id', (tx, id) => tx.insert(transactions).values({ ...base, categoryId: id }), a.category],
      ['transactions.subcategory_id', (tx, id) => tx.insert(transactions).values({ ...base, subcategoryId: id }), a.subcategory],
      ['transactions.contact_id', (tx, id) => tx.insert(transactions).values({ ...base, contactId: id }), a.contact],
      ['transactions.recurrence_id', (tx, id) => tx.insert(transactions).values({ ...base, recurrenceId: id, occurrenceIndex: 9 }), a.series],
      [
        'goal_contributions.goal_id',
        (tx, id) => tx.insert(goalContributions).values({ workspaceId: b.ws, goalId: id, amount: 5, date: '2026-10-01' }),
        a.goal,
      ],
      [
        'categories.parent_id',
        (tx, id) =>
          tx.insert(categories).values({ workspaceId: b.ws, parentId: id, name: 'Intrusa', type: 'expense', icon: 'wallet', color: '#000000' }),
        a.category,
      ],
      [
        'credit_cards.default_account_id',
        (tx, id) =>
          tx.update(creditCards).set({ defaultAccountId: id }).where(eq(creditCards.id, b.card)),
        a.account,
      ],
      ['goals.account_id', (tx, id) => tx.update(goals).set({ accountId: id }).where(eq(goals.id, b.goal)), a.account],
      // Re-pointing an existing row is blocked as well.
      ['transactions.account_id (update)', (tx, id) => tx.update(transactions).set({ accountId: id }).where(eq(transactions.id, b.tx)), a.account],
    ];

    for (const [label, attempt, foreignId] of attempts) {
      const crossTenant = await pgFailure(withTenant(app.db, b.ws, (tx) => attempt(tx, foreignId)));
      expect(crossTenant?.code, label).toBe('23503');
      // Same answer as for an id that exists nowhere: no existence oracle.
      const unknown = await pgFailure(withTenant(app.db, b.ws, (tx) => attempt(tx, randomUUID())));
      expect(unknown, label).toEqual(crossTenant);
      expect(crossTenant?.detail ?? '', label).not.toContain(foreignId);
    }
    // The other tenant's rows are untouched.
    for (const table of ['transactions', 'goal_contributions', 'categories']) {
      expect(await countRows(table, a.ws)).toBe(table === 'categories' ? 2 : 1);
    }
  });

  it('ON DELETE stays inside the tenant: SET NULL clears only the reference, CASCADE never reaches others', async () => {
    const a = await seedTenant('A');
    const b = await seedTenant('B');
    const before = await Promise.all(TENANT_TABLES.map((t) => countRows(t, b.ws)));

    await withTenant(app.db, a.ws, async (tx) => {
      await tx.delete(contacts).where(eq(contacts.id, a.contact));
      await tx.delete(recurrences).where(eq(recurrences.id, a.series));
      await tx.delete(goals).where(eq(goals.id, a.goal));
    });
    const [txRow] = await admin().select().from(transactions).where(eq(transactions.id, a.tx));
    expect(txRow).toMatchObject({ workspaceId: a.ws, contactId: null, recurrenceId: null, accountId: a.account });
    expect(await countRows('goal_contributions', a.ws)).toBe(0);

    // The account is still used by a transaction: deleting it is refused (inside the tenant only).
    expect((await pgFailure(withTenant(app.db, a.ws, (tx) => tx.delete(accounts).where(eq(accounts.id, a.account)))))?.code).toBe('23503');
    await withTenant(app.db, a.ws, async (tx) => {
      await tx.delete(transactions).where(eq(transactions.id, a.tx));
      await tx.delete(accounts).where(eq(accounts.id, a.account));
      await tx.delete(categories).where(eq(categories.id, a.category));
    });
    const [card] = await admin().select().from(creditCards).where(eq(creditCards.id, a.card));
    expect(card).toMatchObject({ workspaceId: a.ws, defaultAccountId: null });
    expect(await countRows('categories', a.ws)).toBe(0); // subcategory cascaded

    expect(await Promise.all(TENANT_TABLES.map((t) => countRows(t, b.ws)))).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Domain checks and uniqueness
// ---------------------------------------------------------------------------

describe('domain checks', () => {
  it('rejects values outside the contract, negative/zero money and ownership through invites', async () => {
    const a = await seedTenant('A');
    const exec = (q: ReturnType<typeof sql>) => pgFailure(admin().execute(q));
    const checks: [string, ReturnType<typeof sql>][] = [
      ['account type', sql`update accounts set type = 'crypto' where id = ${a.account}`],
      ['card limit', sql`update credit_cards set "limit" = -1 where id = ${a.card}`],
      ['card brand', sql`update credit_cards set brand = 'bogus' where id = ${a.card}`],
      ['goal target', sql`update goals set target_amount = 0 where id = ${a.goal}`],
      ['contribution', sql`update goal_contributions set amount = 0 where id = ${a.contribution}`],
      ['payment method', sql`update transactions set payment_method = 'barter' where id = ${a.tx}`],
      ['transfer kind', sql`update transactions set transfer_kind = 'bogus' where id = ${a.tx}`],
      ['invoice month', sql`update transactions set invoice_month = '2026-13' where id = ${a.tx}`],
      ['frequency', sql`update transactions set frequency = 'daily' where id = ${a.tx}`],
      ['installments', sql`update transactions set installment_number = 0 where id = ${a.tx}`],
      ['series kind', sql`update recurrences set kind = 'single' where id = ${a.series}`],
      ['series counters', sql`update recurrences set next_index = -1 where id = ${a.series}`],
      ['subscription status', sql`insert into subscriptions (workspace_id, status) values (${a.ws}, 'free_forever')`],
      [
        'subscription plan',
        sql`insert into subscriptions (workspace_id, status, plan_code) values (${a.ws}, 'active', 'enterprise_unlimited')`,
      ],
      [
        'invite as owner',
        sql`insert into workspace_invites (workspace_id, email, role, token_hash, expires_at)
            values (${a.ws}, 'x@teste.com', 'owner', 'h-owner', now() + interval '1 day')`,
      ],
    ];
    for (const [label, q] of checks) expect((await exec(q))?.code, label).toBe('23514');
  });

  it('one owner per workspace and one pending invite per e-mail', async () => {
    const a = await seedTenant('A');
    const [u1, u2] = await admin()
      .insert(users)
      .values([
        { name: 'U1', email: 'u1@teste.com', passwordHash: 'x' },
        { name: 'U2', email: 'u2@teste.com', passwordHash: 'x' },
      ])
      .returning();
    await admin().execute(sql`insert into workspace_members (workspace_id, user_id, role) values (${a.ws}, ${u1!.id}, 'owner')`);
    const second = await pgFailure(
      admin().execute(sql`insert into workspace_members (workspace_id, user_id, role) values (${a.ws}, ${u2!.id}, 'owner')`),
    );
    expect(second?.code).toBe('23505');

    const invite = (email: string, hash: string) =>
      admin().execute(sql`insert into workspace_invites (workspace_id, email, role, token_hash, expires_at)
                          values (${a.ws}, ${email}, 'viewer', ${hash}, now() + interval '7 days')`);
    await invite('fulano@teste.com', 'h1');
    expect((await pgFailure(invite('Fulano@Teste.com', 'h2')))?.code).toBe('23505');
    await admin().execute(sql`update workspace_invites set accepted_at = now() where token_hash = 'h1'`);
    await invite('fulano@teste.com', 'h3'); // accepted invites do not block a new one
  });
});

// ---------------------------------------------------------------------------
// LGPD, encryption backfill and retention
// ---------------------------------------------------------------------------

describe('data protection', () => {
  it('deleting an account removes the invites addressed to its e-mail (with the API privileges)', async () => {
    const a = await seedTenant('A');
    const [user] = await admin().insert(users).values({ name: 'Convidada', email: 'convidada@teste.com', passwordHash: 'x' }).returning();
    await admin().execute(sql`insert into workspace_invites (workspace_id, email, role, token_hash, expires_at) values
      (${a.ws}, 'CONVIDADA@teste.com', 'viewer', 'h-a', now() + interval '7 days'),
      (${a.ws}, 'outra@teste.com', 'viewer', 'h-b', now() + interval '7 days')`);

    await app.db.delete(users).where(eq(users.id, user!.id));
    const left = await rows<{ email: string }>(sql`select email from workspace_invites order by email`);
    expect(left).toEqual([{ email: 'outra@teste.com' }]);
  });

  it('the backfill re-checks workspaces that already have a key but were never verified', async () => {
    const alice = await registerUser(app, 'Alice');
    const ws = (await alice.get('/auth/me')).body.workspace.id as string;
    // Workspaces created by the API are born encrypted.
    expect(await needsBackfill(app.db)).toBe(false);

    // A legacy row (written before field encryption) in a workspace whose key exists already.
    const [legacy] = await admin()
      .insert(transactions)
      .values({ workspaceId: ws, type: 'expense', description: 'Legado', amount: 100, date: '2026-10-01', notes: 'segredo antigo' })
      .returning();
    await admin().update(workspaces).set({ encryptionBackfilledAt: null }).where(eq(workspaces.id, ws));
    expect(await needsBackfill(app.db)).toBe(true);

    const result = await backfillEncryption(app.db);
    expect(result).toEqual({ workspaces: 1, rows: 1 });
    const [stored] = await rows<{ notes: string }>(sql`select notes from transactions where id = ${legacy!.id}`);
    expect(stored!.notes).toMatch(/^v1\./);
    expect(await needsBackfill(app.db)).toBe(false);
    expect((await alice.get(`/transactions/${legacy!.id}`)).body.notes).toBe('segredo antigo');
  });

  it('the retention purge removes expired sessions, used/expired reset links and stale invites only', async () => {
    const a = await seedTenant('A');
    const [user] = await admin().insert(users).values({ name: 'U', email: 'u@teste.com', passwordHash: 'x' }).returning();
    const now = new Date('2026-10-20T12:00:00Z');
    const day = 86_400_000;
    const at = (days: number) => new Date(now.getTime() + days * day);
    const session = (hash: string, expiresAt: Date) => ({
      familyId: randomUUID(),
      userId: user!.id,
      tokenHash: hash,
      sessionStartedAt: at(-40),
      expiresAt,
    });
    await admin().insert(sessions).values([session('s-expired', at(-1)), session('s-live', at(10))]);
    await admin().insert(passwordResets).values([
      { userId: user!.id, tokenHash: 'r-used', expiresAt: at(1), usedAt: at(-1) },
      { userId: user!.id, tokenHash: 'r-expired', expiresAt: at(-1) },
      { userId: user!.id, tokenHash: 'r-live', expiresAt: at(1) },
    ]);
    await admin().insert(workspaceInvites).values([
      { workspaceId: a.ws, email: 'velho@teste.com', role: 'viewer', tokenHash: 'i-expired', expiresAt: at(-31) },
      { workspaceId: a.ws, email: 'aceito@teste.com', role: 'viewer', tokenHash: 'i-accepted', expiresAt: at(-20), acceptedAt: at(-31) },
      { workspaceId: a.ws, email: 'recente@teste.com', role: 'viewer', tokenHash: 'i-recent', expiresAt: at(-2) },
      { workspaceId: a.ws, email: 'pendente@teste.com', role: 'viewer', tokenHash: 'i-live', expiresAt: at(5) },
    ]);

    expect(await purgeExpiredSecurityRows(admin(), now)).toEqual({ sessions: 1, passwordResets: 2, invites: 2 });
    expect((await admin().select({ h: sessions.tokenHash }).from(sessions)).map((r) => r.h)).toEqual(['s-live']);
    expect((await admin().select({ h: passwordResets.tokenHash }).from(passwordResets)).map((r) => r.h)).toEqual(['r-live']);
    expect((await admin().select({ h: workspaceInvites.tokenHash }).from(workspaceInvites)).map((r) => r.h).sort()).toEqual([
      'i-live',
      'i-recent',
    ]);
  });
});
