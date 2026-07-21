/**
 * extractContributions.js
 *
 * Source sections:
 *   - The page-2 "Benefits:" breakdown table (see lineUtils.getBenefitsTableBlock):
 *     ISA contribution, Medic TotalCare contribution, Protection
 *     Contribution, Wakalah Certificate Charge, Total Monthly Amount Payable.
 *   - The "Details / Person to be Covered" block: "Total Annual Contribution".
 *   - The "A. SUMMARY" section (bounded until "B. MARKETING ILLUSTRATION
 *     TABLE"): the "RM x X n Years = RM y" contribution-over-term formula,
 *     "Total direct commission", the guaranteed death/TPD amount next
 *     to "If you die or suffer TPD", and the "Non-Guaranteed Benefits ...
 *     At maturity" cash value under the PDF's own two hypothetical
 *     investment scenarios ("Scenario X : RM x.xx" / "Scenario Y : RM
 *     y.yy" - X is 2% p.a., Y is 5% p.a., per that section's own footnote
 *     elsewhere on the page; this extractor only reads the printed cash
 *     figures, not the percentage assumption behind them).
 *
 * Extraction method: anchor-label for every field. Numbers that print on
 * the same line as their label are pulled directly; numbers that PruBSN's
 * generator prints on an adjacent line (a recurring quirk - see
 * lineUtils.findNearestValue) are located by searching a small window
 * around the label anchor, never by scanning the page blindly.
 *
 * Deliberate design choice: totalMonthlyContribution is read from the
 * "Total Monthly Amount Payable" row at the bottom of the breakdown table
 * rather than the "Monthly Total Amount Payable" field higher up the same
 * page - the latter's label wraps across two lines with the value
 * centered between them, which does actually parse correctly, but the
 * breakdown-table total is architecturally the sum of the other four
 * numbers on this page, so preferring it lets validate.js do a genuine
 * arithmetic cross-check ("do isa+mtc+protection+wakalah add up") instead
 * of comparing a number against a copy of itself.
 *
 * Expected output:
 *   { isaContribution, medicTotalCareContribution, protectionContribution,
 *     wakalahCertificateCharge, totalMonthlyContribution,
 *     totalAnnualContribution, totalContributionOverTerm,
 *     totalDirectCommission, guaranteedDeathTPDBenefit,
 *     nonGuaranteedCashValueScenarioX, nonGuaranteedCashValueScenarioY,
 *     _warnings }
 */

'use strict';

const {
  findAnchorIndexInDoc,
  getSectionLines,
  getValueAfterColon,
  getBenefitsTableBlock,
  findNearestValue,
  parseCurrency,
} = require('./lineUtils');

function trailingNumber(line) {
  if (!line) return null;
  const matches = line.match(/[\d,]+(\.\d+)?/g);
  return matches && matches.length ? parseCurrency(matches[matches.length - 1]) : null;
}

function extractContributions(doc) {
  const warnings = [];

  // --- "Benefits:" breakdown table ---
  const benefitsBlock = getBenefitsTableBlock(doc);
  let isaContribution = null;
  let medicTotalCareContribution = null;
  let protectionContribution = null;
  let wakalahCertificateCharge = null;
  let totalMonthlyContribution = null;

  if (benefitsBlock.startIndex === -1) {
    warnings.push({ field: 'contributions', message: 'Could not locate the "Benefits:" breakdown table.' });
  } else {
    const lines = benefitsBlock.lines;

    const basicLine = lines.find((l) => l.includes('PruBSN AnugerahMax (Basic)'));
    if (basicLine) isaContribution = trailingNumber(basicLine);
    else warnings.push({ field: 'contributions.isaContribution', message: 'Could not locate the ISA/basic plan row.' });

    const mtcLine = lines.find((l) => l.trim().startsWith('Medic TotalCare'));
    if (mtcLine) medicTotalCareContribution = trailingNumber(mtcLine);
    else warnings.push({ field: 'contributions.medicTotalCareContribution', message: 'Could not locate the Medic TotalCare row.' });

    const protectionLine = lines.find((l) => l.includes('Protection Contribution'));
    protectionContribution = protectionLine ? trailingNumber(protectionLine) : null;
    if (protectionContribution == null) {
      warnings.push({ field: 'contributions.protectionContribution', message: 'Could not locate "Protection Contribution".' });
    }

    const wakalahLine = lines.find((l) => l.includes('Wakalah Certificate Charge'));
    wakalahCertificateCharge = wakalahLine ? trailingNumber(wakalahLine) : null;
    if (wakalahCertificateCharge == null) {
      warnings.push({ field: 'contributions.wakalahCertificateCharge', message: 'Could not locate "Wakalah Certificate Charge".' });
    }

    const totalLine = lines.find((l) => l.includes('Total Monthly Amount Payable'));
    totalMonthlyContribution = totalLine ? trailingNumber(totalLine) : null;
    if (totalMonthlyContribution == null) {
      warnings.push({ field: 'contributions.totalMonthlyContribution', message: 'Could not locate "Total Monthly Amount Payable".' });
    }
  }

  // --- "Details / Person to be Covered" block ---
  const detailsSection = getSectionLines(doc, /Person to be Covered/i, /Product Description:/i);
  let totalAnnualContribution = null;
  if (detailsSection.startIndex !== -1) {
    const line = detailsSection.lines.find((l) => l.includes('Total Annual Contribution'));
    const raw = line ? getValueAfterColon(line, 'Total Annual Contribution') : null;
    totalAnnualContribution = raw ? parseCurrency(raw) : null;
  }
  if (totalAnnualContribution == null) {
    warnings.push({ field: 'contributions.totalAnnualContribution', message: 'Could not locate "Total Annual Contribution".' });
  }

  // --- "A. SUMMARY" section ---
  const summarySection = getSectionLines(doc, /^A\. SUMMARY/i, /^B\. MARKETING ILLUSTRATION TABLE/i);
  let totalContributionOverTerm = null;
  let totalDirectCommission = null;
  let guaranteedDeathTPDBenefit = null;
  let nonGuaranteedCashValueScenarioX = null;
  let nonGuaranteedCashValueScenarioY = null;

  if (summarySection.startIndex === -1) {
    warnings.push({ field: 'contributions', message: 'Could not locate the "A. SUMMARY" section.' });
  } else {
    const lines = summarySection.lines;

    const formulaLine = lines.find((l) => /RM\s*[\d,.]+\s*X\s*\d+\s*Years?\s*=\s*RM\s*[\d,.]+/i.test(l));
    if (formulaLine) {
      const m = formulaLine.match(/=\s*RM\s*([\d,]+(\.\d+)?)/i);
      totalContributionOverTerm = m ? parseCurrency(m[1]) : null;
    } else {
      warnings.push({ field: 'contributions.totalContributionOverTerm', message: 'Could not locate the "RM x X n Years = RM y" contribution formula.' });
    }

    const commissionIdx = lines.findIndex((l) => l.includes('Total direct commission'));
    if (commissionIdx !== -1) {
      const value = findNearestValue(lines, commissionIdx, { pattern: /RM\s*[\d,]+(\.\d+)?/i, maxDistance: 2, direction: 'after' });
      totalDirectCommission = value ? parseCurrency(value) : null;
    } else {
      warnings.push({ field: 'contributions.totalDirectCommission', message: 'Could not locate "Total direct commission".' });
    }

    const tpdIdx = lines.findIndex((l) => l.includes('If you die or suffer TPD'));
    if (tpdIdx !== -1) {
      const m = lines[tpdIdx].match(/RM\s*[\d,]+(\.\d+)?/i);
      guaranteedDeathTPDBenefit = m ? parseCurrency(m[0]) : null;
    } else {
      warnings.push({ field: 'contributions.guaranteedDeathTPDBenefit', message: 'Could not locate "If you die or suffer TPD".' });
    }

    // "Non-Guaranteed Benefits ... At maturity" - the ISA/IUA cash value
    // under PruBSN's two hypothetical investment scenarios (2% p.a. /
    // 5% p.a. - defined elsewhere in the PDF, not on this line), printed
    // here as "Scenario X : RM x.xx" / "Scenario Y : RM y.yy". Requiring
    // "RM" right after the colon is what keeps this from matching a later,
    // unrelated "Scenario X : -49.06% p.a." (Annualised Return) line
    // elsewhere in this same section - a percentage, not a cash amount.
    const scenarioXLine = lines.find((l) => /Scenario X\s*:\s*RM\s*[\d,]+(\.\d+)?/i.test(l));
    if (scenarioXLine) {
      const m = scenarioXLine.match(/RM\s*([\d,]+(\.\d+)?)/i);
      nonGuaranteedCashValueScenarioX = m ? parseCurrency(m[1]) : null;
    } else {
      warnings.push({ field: 'contributions.nonGuaranteedCashValueScenarioX', message: 'Could not locate the "Scenario X : RM ..." non-guaranteed cash value figure.' });
    }

    const scenarioYLine = lines.find((l) => /Scenario Y\s*:\s*RM\s*[\d,]+(\.\d+)?/i.test(l));
    if (scenarioYLine) {
      const m = scenarioYLine.match(/RM\s*([\d,]+(\.\d+)?)/i);
      nonGuaranteedCashValueScenarioY = m ? parseCurrency(m[1]) : null;
    } else {
      warnings.push({ field: 'contributions.nonGuaranteedCashValueScenarioY', message: 'Could not locate the "Scenario Y : RM ..." non-guaranteed cash value figure.' });
    }
  }

  return {
    isaContribution,
    medicTotalCareContribution,
    protectionContribution,
    wakalahCertificateCharge,
    totalMonthlyContribution,
    totalAnnualContribution,
    totalContributionOverTerm,
    totalDirectCommission,
    guaranteedDeathTPDBenefit,
    nonGuaranteedCashValueScenarioX,
    nonGuaranteedCashValueScenarioY,
    _warnings: warnings,
  };
}

module.exports = { extractContributions };
