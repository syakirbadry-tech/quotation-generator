/**
 * coverageStrategy.js
 *
 * Phase 1 of the Medical Card Engine's Version 1 architecture (see
 * /Users/syakir/.claude/plans/snappy-strolling-cat.md). The renderer
 * should not need to know which product generated a quotation - instead
 * it asks this module, keyed only by `medical.coverageModel`, what to
 * say and which coverage-model-specific sections apply. Wording here is
 * the exact client-facing copy specified for this phase - verbatim, not
 * paraphrased, since this is regulated financial-product language.
 */

'use strict';

const STRATEGIES = {
  ANNUAL_LIMIT: {
    coverageModel: 'ANNUAL_LIMIT',
    explanation: 'This medical card provides an annual medical limit that refreshes every policy year.',
    showsCriticalIllnessDoubling: true,
    showsLifetimeFundChart: false,
  },
  LIFETIME_MEDICAL_FUND: {
    coverageModel: 'LIFETIME_MEDICAL_FUND',
    explanation:
      "This medical card provides a lifetime medical fund. After the allocated medical fund has been exhausted, eligible claims continue under an 80% (PruBSN) / 20% (client) cost-sharing arrangement, subject to the policy terms.",
    showsCriticalIllnessDoubling: false,
    showsLifetimeFundChart: true,
  },
};

/**
 * @param {'ANNUAL_LIMIT'|'LIFETIME_MEDICAL_FUND'|null|undefined} coverageModel
 * @returns {object|null} the strategy object, or null if the model is unrecognised (never a guessed default)
 */
function getCoverageStrategy(coverageModel) {
  return STRATEGIES[coverageModel] || null;
}

module.exports = { getCoverageStrategy, STRATEGIES };
