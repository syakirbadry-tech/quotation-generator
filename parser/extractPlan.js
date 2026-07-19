/**
 * extractPlan.js
 *
 * Source sections:
 *   - The "Details / Person to be Covered" block: "Type of Product",
 *     "Payment Mode" (clean "Label : Value" lines).
 *   - The page-2 "Benefits:" breakdown table (see lineUtils.getBenefitsTableBlock):
 *     the "PruBSN AnugerahMax (Basic)" row (Term / Sum Covered columns) and
 *     the "Medic TotalCare" row (plan tier / co-payment option / term).
 *   - "Until age <N>" wording in the "Product Options Table" section, used
 *     for coverageToAge.
 *
 * Extraction method: anchor-label for the single-line fields. For the
 * Medic TotalCare row specifically, the label and its numbers land on one
 * physical line but interleaved with an unrelated wrapped sub-label
 * ("Plan 200" / "SmartSaver300" print on adjacent lines, not this one) -
 * so each detail is found by its OWN literal anchor within the bounded
 * table block rather than by column position, which is more robust to
 * PDF layout quirks than assuming a fixed row/column grid.
 *
 * Expected output:
 *   { typeOfProduct, paymentMode, basicPlanName, basicPlanTerm,
 *     basicSumCovered, medicalRiderName, medicalPlanTier, coPaymentOption,
 *     medicalRiderTerm, coverageToAge, _warnings }
 *
 * coverageToAge is Required per the approved model but may not always be
 * findable via the "Until age N" wording (that phrasing lives in the
 * Product Options Table, an appendix that could vary in future PDF
 * versions). If it's missing here, parseQuotation.js fills it in via a
 * documented DERIVED fallback (ageNextBirthday + basicPlanTerm) - that
 * derivation intentionally does NOT happen inside this extractor, to keep
 * "what was read from the PDF" and "what was computed" clearly separate.
 */

'use strict';

const {
  findAnchorIndexInDoc,
  getSectionLines,
  getValueAfterColon,
  getBenefitsTableBlock,
  parseIntSafe,
  parseCurrency,
} = require('./lineUtils');

function extractPlan(doc) {
  const warnings = [];

  // --- "Details / Person to be Covered" block ---
  const detailsSection = getSectionLines(doc, /Person to be Covered/i, /Product Description:/i);
  let typeOfProduct = null;
  let paymentMode = null;
  if (detailsSection.startIndex === -1) {
    warnings.push({
      field: 'plan',
      message: 'Could not locate the "Person to be Covered" section.',
    });
  } else {
    const typeLine = detailsSection.lines.find((l) => l.includes('Type of Product'));
    typeOfProduct = typeLine ? getValueAfterColon(typeLine, 'Type of Product') : null;
    const paymentLine = detailsSection.lines.find((l) => l.includes('Payment Mode'));
    paymentMode = paymentLine ? getValueAfterColon(paymentLine, 'Payment Mode') : null;
    if (!typeOfProduct) {
      warnings.push({ field: 'plan.typeOfProduct', message: 'Could not locate "Type of Product".' });
    }
  }

  // --- "Benefits:" breakdown table block ---
  const benefitsBlock = getBenefitsTableBlock(doc);
  let basicPlanName = null;
  let basicPlanTerm = null;
  let basicSumCovered = null;
  let medicalRiderName = null;
  let medicalRiderTerm = null;
  let medicalPlanTier = null;
  let coPaymentOption = null;

  if (benefitsBlock.startIndex === -1) {
    warnings.push({ field: 'plan', message: 'Could not locate the "Benefits:" breakdown table.' });
  } else {
    const lines = benefitsBlock.lines;

    // "PruBSN AnugerahMax (Basic)          44        10,000        5.00"
    const basicLine = lines.find((l) => l.includes('PruBSN AnugerahMax (Basic)'));
    if (basicLine) {
      basicPlanName = 'PruBSN AnugerahMax (Basic)';
      const numbers = basicLine
        .slice(basicLine.indexOf('PruBSN AnugerahMax (Basic)') + 'PruBSN AnugerahMax (Basic)'.length)
        .match(/[\d,]+(\.\d+)?/g) || [];
      // Table header order is Term (Years) | Sum Covered (RM) | Contribution (RM).
      basicPlanTerm = numbers[0] != null ? parseIntSafe(numbers[0]) : null;
      basicSumCovered = numbers[1] != null ? parseCurrency(numbers[1]) : null;
    } else {
      warnings.push({ field: 'plan.basicPlanName', message: 'Could not locate the "PruBSN AnugerahMax (Basic)" row.' });
    }

    // "Medic TotalCare                     44         Contribution option: Level       164.00"
    const mtcLine = lines.find((l) => l.trim().startsWith('Medic TotalCare'));
    if (mtcLine) {
      medicalRiderName = 'Medic TotalCare';
      const afterLabel = mtcLine.slice(mtcLine.indexOf('Medic TotalCare') + 'Medic TotalCare'.length);
      const numbers = afterLabel.match(/[\d,]+(\.\d+)?/g) || [];
      medicalRiderTerm = numbers[0] != null ? parseIntSafe(numbers[0]) : null;
    } else {
      warnings.push({ field: 'plan.medicalRiderName', message: 'Could not locate the "Medic TotalCare" row.' });
    }

    // "Plan 200" prints on its own line elsewhere in this block.
    const planTierLine = lines.find((l) => /\bPlan\s+\d+\b/.test(l));
    const planTierMatch = planTierLine ? planTierLine.match(/\bPlan\s+\d+\b/) : null;
    medicalPlanTier = planTierMatch ? planTierMatch[0] : null;
    if (!medicalPlanTier) {
      warnings.push({ field: 'plan.medicalPlanTier', message: 'Could not locate a "Plan <N>" tier label.' });
    }

    // "SmartSaver300" / "SmartSaver1,000" / "Deductible RM500" / "High Deductible ..." / "Full Coverage"
    const coPayLine = lines.find((l) =>
      /(SmartSaver[\d,]+|Deductible\s*RM?\s*[\d,]+|High Deductible\s*[\d,]+|Full Coverage)/i.test(l)
    );
    const coPayMatch = coPayLine
      ? coPayLine.match(/(SmartSaver[\d,]+|Deductible\s*RM?\s*[\d,]+|High Deductible\s*[\d,]+|Full Coverage)/i)
      : null;
    coPaymentOption = coPayMatch ? coPayMatch[0] : null;
    if (!coPaymentOption) {
      warnings.push({ field: 'plan.coPaymentOption', message: 'Could not locate a co-payment option value.' });
    }
  }

  // --- coverageToAge: "Until age <N>" wording, e.g. in the Product Options Table ---
  const untilAgeIdx = findAnchorIndexInDoc(doc, /Until age \d+/i);
  let coverageToAge = null;
  if (untilAgeIdx !== -1) {
    const m = doc.allLines[untilAgeIdx].text.match(/Until age (\d+)/i);
    coverageToAge = m ? parseInt(m[1], 10) : null;
  } else {
    warnings.push({
      field: 'plan.coverageToAge',
      message: 'Could not locate "Until age N" wording; will be derived from age + term by parseQuotation.',
    });
  }

  return {
    typeOfProduct,
    paymentMode,
    basicPlanName,
    basicPlanTerm,
    basicSumCovered,
    medicalRiderName,
    medicalPlanTier,
    coPaymentOption,
    medicalRiderTerm,
    coverageToAge,
    _warnings: warnings,
  };
}

module.exports = { extractPlan };
