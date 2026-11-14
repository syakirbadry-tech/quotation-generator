/**
 * schemaColumns.js
 *
 * D1/SQLite has no "ADD COLUMN IF NOT EXISTS", so tables created by an
 * earlier version of the Worker get their new columns here: read the
 * table's columns once, then add whichever are missing.
 */

/** @param {Array<[string, string]>} columns [name, SQL type] pairs to make sure exist */
export async function addMissingColumns(db, table, columns) {
  const { results } = await db.prepare(`PRAGMA table_info(${table})`).all();
  const have = new Set(results.map((r) => r.name));
  const missing = columns.filter(([name]) => !have.has(name));
  if (missing.length) {
    await db.batch(missing.map(([name, type]) => db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`)));
  }
}
