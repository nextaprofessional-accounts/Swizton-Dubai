import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { demo, pool, mutate } from './store.ts';
type Account = {
  id: string;
  email: string;
  role: 'Admin' | 'Finance' | 'Management';
  active: boolean;
  password_hash: string;
  token_version: number;
};
const users: Account[] = (['Admin', 'Finance', 'Management'] as const).map((role, i) => ({
  id: `00000000-0000-4000-8000-00000000000${i + 1}`,
  email: `${role.toLowerCase()}@demo.local`,
  role,
  active: true,
  token_version: 0,
  password_hash: bcrypt.hashSync('demo-only', 8),
}));
export async function authAccount(email: string) {
  return demo
    ? users.find((u) => u.email === email && u.active)
    : ((
        await pool!.query(
          'SELECT id,email,role,active,password_hash,token_version FROM app_user WHERE lower(email)=$1 AND active=true',
          [email],
        )
      ).rows[0] as Account | undefined);
}
export async function accountById(id: string) {
  return demo
    ? users.find((u) => u.id === id && u.active)
    : ((
        await pool!.query(
          'SELECT id,email,role,active,token_version FROM app_user WHERE id=$1 AND active=true',
          [id],
        )
      ).rows[0] as Account | undefined);
}
const safe = (a: Account) => ({ id: a.id, email: a.email, role: a.role, active: a.active });
export async function listAccounts() {
  return demo
    ? users.map(safe)
    : (await pool!.query('SELECT id,email,role,active,created_at FROM app_user ORDER BY email'))
        .rows;
}
export async function saveAccount(
  actor: string,
  expected: number,
  reason: string,
  input: { id?: string; email: string; role: Account['role']; active: boolean; password?: string },
) {
  if (input.id === actor) throw Error('Use another Admin to change your own access');
  const id = input.id ?? randomUUID();
  const hash = input.password ? await bcrypt.hash(input.password, 12) : undefined;
  if (!input.id && !hash) throw Error('A password is required for a new account');
  if (demo) {
    const before = users.find((u) => u.id === id);
    await mutate(
      actor,
      'account.save',
      id,
      reason,
      expected,
      () => {
        const old = users.find((u) => u.id === id);
        if (input.id && !old) throw Error('Account not found');
        if (users.some((u) => u.email === input.email && u.id !== id))
          throw Error('Email already exists');
        const account = {
          id,
          email: input.email,
          role: input.role,
          active: input.active,
          password_hash: hash ?? old!.password_hash,
          token_version: old ? old.token_version + 1 : 0,
        };
        if (old) Object.assign(old, account);
        else users.push(account);
      },
      {
        before: before ? safe(before) : null,
        after: {
          id,
          email: input.email,
          role: input.role,
          active: input.active,
          passwordReset: !!hash,
        },
      },
    );
    return id;
  }
  const c = await pool!.connect();
  try {
    await c.query('BEGIN');
    const rev = await c.query('SELECT revision FROM organisation WHERE id=1 FOR UPDATE');
    if (Number(rev.rows[0].revision) !== expected)
      throw Error('Conflict: reload data before saving');
    const old = input.id
      ? (await c.query('SELECT id,email,role,active FROM app_user WHERE id=$1', [id])).rows[0]
      : null;
    if (input.id && !old) throw Error('Account not found');
    if (old)
      await c.query(
        'UPDATE app_user SET email=$2,role=$3,active=$4,password_hash=COALESCE($5,password_hash),token_version=token_version+1 WHERE id=$1',
        [id, input.email, input.role, input.active, hash ?? null],
      );
    else
      await c.query(
        'INSERT INTO app_user(id,email,role,active,password_hash) VALUES($1,$2,$3,$4,$5)',
        [id, input.email, input.role, input.active, hash],
      );
    await c.query(
      'INSERT INTO audit_event(actor,action,entity_id,reason,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6)',
      [
        actor,
        'account.save',
        id,
        reason,
        JSON.stringify(old),
        JSON.stringify({
          id,
          email: input.email,
          role: input.role,
          active: input.active,
          passwordReset: !!hash,
        }),
      ],
    );
    await c.query('UPDATE organisation SET revision=revision+1 WHERE id=1');
    await c.query('COMMIT');
    return id;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
