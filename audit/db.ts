// The Audit Office's own connection (K6, MED-306): Postgres as the role mirror_vale, which reads
// the columns the checker needs and writes only findings, holds and its own audit events. Never
// the service role. Live, AUDIT_DB_URL points at the pooler; locally the tests and simulator
// build it with localAuditUrl().

import postgres from "npm:postgres@3.4.5";

export type Sql = ReturnType<typeof postgres>;

/** prepare: false and one connection, since the live pooler runs in transaction mode; callers
 * await one query at a time. connect_timeout so a bad URL fails instead of hanging. */
export const connect = (url: string): Sql =>
  postgres(url, {
    prepare: false,
    max: 1,
    idle_timeout: 10,
    connect_timeout: 10,
    onnotice: () => {},
  });

const LOCAL_DB = /^postgres(ql)?:\/\/postgres:[^@]+@(127\.0\.0\.1|localhost):\d+\/postgres$/;
const LOCAL_PASSWORD = "mirror-vale-local";

/** Local stack only: gives mirror_vale a login with a local-only password, as the local
 * superuser, and returns its connection string on the given host. Refuses any other database. */
export async function localAuditUrl(superuserUrl: string, host?: string): Promise<string> {
  if (!LOCAL_DB.test(superuserUrl)) throw new Error("localAuditUrl: local stack only");
  const su = postgres(superuserUrl, { max: 1, onnotice: () => {} });
  try {
    await su.unsafe(`alter role mirror_vale with login password '${LOCAL_PASSWORD}'`);
  } finally {
    await su.end();
  }
  const u = new URL(superuserUrl);
  u.username = "mirror_vale";
  u.password = LOCAL_PASSWORD;
  if (host) u.host = host;
  return u.toString();
}
