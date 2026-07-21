/**
 * fakeD1.js
 *
 * A minimal in-memory stand-in for a Cloudflare D1 binding, implementing
 * just the `prepare(sql).bind(...args).run()/.first()` surface
 * publish.js actually uses - real D1 needs the Workers runtime (or
 * Miniflare via `wrangler dev`), neither of which plain `node
 * test/*.test.js` runs under. Recognises queries by a simple pattern
 * match against the two statements publish.js issues, same testing
 * philosophy as this project's existing tests mocking `global.fetch`
 * for Airtable (see worker.test.js) - fake the boundary, not the logic
 * under test.
 *
 * Not a general SQL engine: if publish.js's queries change shape, this
 * file's patterns need updating alongside it.
 */

export function createFakeD1() {
  const rows = new Map();

  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              if (/INSERT INTO quotations/i.test(sql)) {
                const [
                  id, slug, uniqueId, clientName, plan,
                  monthlyTotalPayable, annualContribution, applicationStatus,
                  rendererVersion, quotationJson, generatedHtml, generatedDate,
                ] = args;
                if (rows.has(id)) {
                  throw new Error('UNIQUE constraint failed: quotations.id');
                }
                rows.set(id, {
                  id, slug, unique_id: uniqueId, client_name: clientName, plan,
                  monthly_total_payable: monthlyTotalPayable, annual_contribution: annualContribution,
                  application_status: applicationStatus, renderer_version: rendererVersion,
                  quotation_json: quotationJson, generated_html: generatedHtml, generated_date: generatedDate,
                });
                return { success: true };
              }
              throw new Error(`fakeD1: unrecognised statement for run(): ${sql}`);
            },
            async first() {
              if (/SELECT \* FROM quotations WHERE id = \?/i.test(sql)) {
                return rows.get(args[0]) || null;
              }
              throw new Error(`fakeD1: unrecognised statement for first(): ${sql}`);
            },
          };
        },
      };
    },
    // Test-only escape hatches - not part of the real D1 API.
    _rows: rows,
    _forceCollisionOnce() {
      // Lets a test simulate a genuine unique_id collision without
      // needing 2^32 attempts to hit one for real.
      const originalRun = this.prepare;
      let armed = true;
      this.prepare = (sql) => {
        const prepared = originalRun.call(this, sql);
        if (!/INSERT INTO quotations/i.test(sql) || !armed) return prepared;
        return {
          bind: (...args) => ({
            async run() {
              armed = false;
              throw new Error('UNIQUE constraint failed: quotations.id');
            },
          }),
        };
      };
    },
  };
}
