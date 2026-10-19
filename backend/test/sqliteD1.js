/**
 * sqliteD1.js
 *
 * A D1-shaped wrapper over Node's built-in SQLite, so vb.js's real SQL
 * runs in tests (unlike fakeD1.js, which pattern-matches publish.js's
 * two statements). Covers prepare().bind().run/first/all and batch().
 */

import { DatabaseSync } from 'node:sqlite';

export function createSqliteD1() {
  const db = new DatabaseSync(':memory:');
  const statement = (sql, args = []) => ({
    sql,
    bind: (...next) => statement(sql, next),
    async run() { db.prepare(sql).run(...args); return { success: true }; },
    async first() { return db.prepare(sql).get(...args) ?? null; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
  });
  return {
    prepare: (sql) => statement(sql),
    async batch(statements) { return Promise.all(statements.map((s) => s.run())); },
    _db: db,
  };
}
