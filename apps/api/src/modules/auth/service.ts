import { eq } from 'drizzle-orm';
import type { LoginInput, RegisterInput, UpdateProfileInput, User } from '@effinance/shared';
import type { Database } from '../../db/client';
import { accounts, users, type UserRow } from '../../db/schema';
import { ConflictError, NotFoundError, UnauthorizedError } from '../../lib/errors';
import { hashPassword, verifyPassword } from '../../lib/password';
import { seedDefaultCategories } from '../categories/service';

export function toUser(row: UserRow): User {
  return { id: row.id, name: row.name, email: row.email, createdAt: row.createdAt.toISOString() };
}

// Used to keep login timing similar whether or not the e-mail exists.
const DUMMY_HASH = hashPassword('effinance-timing-guard');

export async function register(db: Database, input: RegisterInput): Promise<User> {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email));
  if (existing) throw new ConflictError('Já existe uma conta com este e-mail');

  const passwordHash = await hashPassword(input.password);
  const user = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(users)
      .values({ name: input.name, email: input.email, passwordHash })
      .returning();
    await seedDefaultCategories(tx, row!.id);
    await tx.insert(accounts).values({
      userId: row!.id,
      name: 'Carteira',
      type: 'wallet',
      color: '#12A150',
      icon: 'wallet',
      initialBalance: 0,
    });
    return row!;
  });
  return toUser(user);
}

export async function login(db: Database, input: LoginInput): Promise<User> {
  const [row] = await db.select().from(users).where(eq(users.email, input.email));
  const ok = await verifyPassword(input.password, row?.passwordHash ?? (await DUMMY_HASH));
  if (!row || !ok) throw new UnauthorizedError('E-mail ou senha incorretos');
  return toUser(row);
}

export async function getUser(db: Database, userId: string): Promise<User> {
  const [row] = await db.select().from(users).where(eq(users.id, userId));
  if (!row) throw new NotFoundError('Usuário não encontrado');
  return toUser(row);
}

export async function updateProfile(db: Database, userId: string, input: UpdateProfileInput): Promise<User> {
  const [row] = await db.update(users).set({ name: input.name }).where(eq(users.id, userId)).returning();
  if (!row) throw new NotFoundError('Usuário não encontrado');
  return toUser(row);
}
