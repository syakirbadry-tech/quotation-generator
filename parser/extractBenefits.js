/**
 * extractBenefits.js
 *
 * Source sections:
 *   - "Table of Benefits" (Appendix: Medical Benefit), bounded until the
 *     page footer: ANNUAL LIMIT / LIFETIME LIMIT, and a fixed, known
 *     vocabulary of 18 benefit-item labels grouped under 5 section
 *     headers (IN-PATIENT / OUT-PATIENT / MAJOR ILLNESS / EMERGENCY /
 *     EXTENDED CARE BENEFITS).
 *   - "What is covered? / What is not covered?" two-column block (Medic
 *     TotalCare Product Disclosure Sheet), for the short client-facing
 *     exclusions list.
 *   - "Exclusions:" lettered list (a)-(ab) (Waiting Period and Exclusions
 *     appendix), for the full exclusions list.
 *   - "Waiting Period:" bulleted list on the same appendix page.
 *
 * Extraction method: anchor-label for every row. The benefit-item rows
 * use a documented technique (see lineUtils.boundedValueForLabel) because
 * PruBSN's PDF generator frequently prints a 2-line label with its value
 * squeezed in between the two label lines, or shares one value cell
 * across two adjacent labels (a merged table cell) - in the latter case
 * this extractor does NOT guess/merge values across rows; it reports an
 * empty value with a warning instead, per the "never invent data" rule.
 *
 * The two-column "what is/isn't covered" block cannot be read top-to-
 * bottom (see lineUtils.splitTwoColumnByHeader for why) so it's
 * reconstructed via the header-offset technique before being split into
 * bullet-like clauses with a generic sentence-boundary heuristic.
 *
 * Expected output:
 *   { annualLimit, lifetimeLimit, benefitItems: [{section, label, value}],
 *     medicalExclusions: string[], fullExclusionsList: [{marker, text}],
 *     waitingPeriods: [{days, description}], _warnings }
 */

'use strict';

const {
  findAnchorIndexInDoc,
  getSectionLines,
  boundedValueForLabel,
  splitTwoColumnByHeader,
  splitIntoClauses,
  splitLetteredList,
  PAGE_FOOTER_ANCHOR,
} = require('./lineUtils');

// Fixed, known vocabulary for the Medic TotalCare "Table of Benefits".
// Order matters: it defines the boundary between one item's value block
// and the next. Extend this list (and only this list) to support a
// different rider/plan tier's benefit table in a future PDF version.
const BENEFIT_LABEL_DICTIONARY = [
  { section: 'IN-PATIENT CARE BENEFITS', label: 'Hospital Daily Room and Board' },
  { section: 'IN-PATIENT CARE BENEFITS', label: 'Intensive Care Unit (ICU) / Cardiac Care Unit (CCU)' },
  { section: 'IN-PATIENT CARE BENEFITS', label: 'Surgical Procedure and Treatment' },
  { section: 'IN-PATIENT CARE BENEFITS', label: 'In Hospital and Related Services' },
  { section: 'OUT-PATIENT CARE BENEFITS', label: 'Day Surgery' },
  { section: 'OUT-PATIENT CARE BENEFITS', label: 'Home Nursing Care' },
  { section: 'OUT-PATIENT CARE BENEFITS', label: 'Pre-Hospitalisation Treatment' },
  { section: 'OUT-PATIENT CARE BENEFITS', label: 'Post-Hospitalisation Treatment' },
  { section: 'OUT-PATIENT CARE BENEFITS', label: 'Outpatient Dengue and Infectious Disease Treatment' },
  { section: 'MAJOR ILLNESS CARE BENEFITS', label: 'Outpatient Kidney Dialysis Treatment' },
  { section: 'MAJOR ILLNESS CARE BENEFITS', label: 'Outpatient Cancer Treatment' },
  { section: 'MAJOR ILLNESS CARE BENEFITS', label: 'Additional Annual Limit for' },
  { section: 'MAJOR ILLNESS CARE BENEFITS', label: 'Treatment Allowance for' },
  { section: 'EMERGENCY CARE BENEFITS', label: 'Emergency Outpatient Treatment for Accidental Injury' },
  { section: 'EMERGENCY CARE BENEFITS', label: 'Worldwide Emergency Medical Assistance' },
  { section: 'EXTENDED CARE BENEFITS', label: 'Reimbursement for Vaccination' },
  { section: 'EXTENDED CARE BENEFITS', label: 'Intraocular Lens' },
  { section: 'EXTENDED CARE BENEFITS', label: 'Government Hospital Allowance' },
];

// These print as their own standalone lines within the bounded "Table of
// Benefits" block and must never be absorbed into a benefit item's value
// just because they happened to fall inside that item's line range.
const SECTION_HEADER_LINES = BENEFIT_LABEL_DICTIONARY.reduce((set, entry) => {
  set.add(entry.section);
  return set;
}, new Set());

// Used only to decide whether a row's extracted value looks substantive
// enough to warn about (never to invent or reassign a value).
function looksLikeValue(str) {
  if (!str) return false;
  return /RM\s*[\d,]|As charged|^Yes$|^No$|No Limit|No Lifetime Limit|per (day|year|disability|lifetime|rider year)/i.test(
    str
  );
}

function findLineIndexFrom(lines, label, fromIndex) {
  for (let i = fromIndex; i < lines.length; i++) {
    if (lines[i].includes(label)) return i;
  }
  return -1;
}

function trailingTextAfterLabel(line, label) {
  const idx = line.indexOf(label);
  if (idx === -1) return null;
  const value = line.slice(idx + label.length).trim();
  return value || null;
}

function extractTableOfBenefits(doc, warnings) {
  const block = getSectionLines(doc, /^Table of Benefits\s*$/i, PAGE_FOOTER_ANCHOR);
  if (block.startIndex === -1) {
    warnings.push({ field: 'benefits', message: 'Could not locate the "Table of Benefits" section.' });
    return { annualLimit: null, lifetimeLimit: null, benefitItems: [] };
  }

  const lines = block.lines;

  const annualLimitLine = lines.find((l) => l.trim().startsWith('ANNUAL LIMIT'));
  const annualLimit = annualLimitLine ? trailingTextAfterLabel(annualLimitLine, 'ANNUAL LIMIT') : null;
  if (!annualLimit) warnings.push({ field: 'benefits.annualLimit', message: 'Could not locate "ANNUAL LIMIT".' });

  const lifetimeLimitLine = lines.find((l) => l.trim().startsWith('LIFETIME LIMIT'));
  const lifetimeLimit = lifetimeLimitLine ? trailingTextAfterLabel(lifetimeLimitLine, 'LIFETIME LIMIT') : null;
  if (!lifetimeLimit) warnings.push({ field: 'benefits.lifetimeLimit', message: 'Could not locate "LIFETIME LIMIT".' });

  const benefitItems = [];
  let cursor = 0;
  for (let i = 0; i < BENEFIT_LABEL_DICTIONARY.length; i++) {
    const { section, label } = BENEFIT_LABEL_DICTIONARY[i];
    const idx = findLineIndexFrom(lines, label, cursor);
    if (idx === -1) {
      warnings.push({ field: `benefits.benefitItems.${label}`, message: `Could not locate the "${label}" row.` });
      benefitItems.push({ section, label, value: null });
      continue;
    }
    const nextLabel = BENEFIT_LABEL_DICTIONARY[i + 1];
    const nextIdx = nextLabel ? findLineIndexFrom(lines, nextLabel.label, idx + 1) : lines.length;
    const boundEnd = nextIdx === -1 ? lines.length : nextIdx;
    const blockLines = lines.slice(idx, boundEnd);
    const value = boundedValueForLabel(blockLines, label, Array.from(SECTION_HEADER_LINES));

    if (!looksLikeValue(value)) {
      warnings.push({
        field: `benefits.benefitItems.${label}`,
        message: `No explicit value found for "${label}" (got "${value || ''}"). This may be a merged table cell shared with an adjacent row - verify against the source PDF.`,
      });
    }

    benefitItems.push({ section, label, value: value || null });
    cursor = idx + 1;
  }

  return { annualLimit, lifetimeLimit, benefitItems };
}

function extractMedicalExclusions(doc, warnings) {
  const { fragments } = splitTwoColumnByHeader(
    doc,
    /What is covered\?.*What is not covered\?/i,
    'What is not covered?',
    /This is not a complete list/i
  );
  if (!fragments.length) {
    warnings.push({
      field: 'benefits.medicalExclusions',
      message: 'Could not reconstruct the "What is not covered?" column.',
    });
    return [];
  }
  const clauses = splitIntoClauses(fragments.join(' '));
  if (!clauses.length) {
    warnings.push({
      field: 'benefits.medicalExclusions',
      message: 'Reconstructed text but could not split it into distinct items; returning as one block.',
    });
    return [fragments.join(' ')];
  }
  return clauses;
}

function extractFullExclusionsList(doc, warnings) {
  const section = getSectionLines(doc, /^Exclusions:\s*$/i, /^Note: This is not a full list/i);
  if (section.startIndex === -1) {
    warnings.push({
      field: 'benefits.fullExclusionsList',
      message: 'Could not locate the lettered "Exclusions:" list (optional field).',
    });
    return [];
  }
  return splitLetteredList(section.lines);
}

function extractWaitingPeriods(doc, warnings) {
  const section = getSectionLines(doc, /^Waiting Period:\s*$/i, /^Exclusions:\s*$/i);
  if (section.startIndex === -1) {
    warnings.push({
      field: 'benefits.waitingPeriods',
      message: 'Could not locate the "Waiting Period:" bulleted list (optional field).',
    });
    return [];
  }

  const entries = [];
  let current = null;
  for (const raw of section.lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^-\s*(\d+)\s*days?\s*(.*)$/i);
    if (m) {
      if (current) entries.push(current);
      current = { days: parseInt(m[1], 10), description: m[2] };
    } else if (current) {
      current.description += ' ' + line;
    }
  }
  if (current) entries.push(current);

  return entries.map((e) => ({
    days: e.days,
    description: e.description.replace(/\s+/g, ' ').replace(/,\s*$/, '').trim(),
  }));
}

function extractBenefits(doc) {
  const warnings = [];
  const { annualLimit, lifetimeLimit, benefitItems } = extractTableOfBenefits(doc, warnings);
  const medicalExclusions = extractMedicalExclusions(doc, warnings);
  const fullExclusionsList = extractFullExclusionsList(doc, warnings);
  const waitingPeriods = extractWaitingPeriods(doc, warnings);

  return {
    annualLimit,
    lifetimeLimit,
    benefitItems,
    medicalExclusions,
    fullExclusionsList,
    waitingPeriods,
    _warnings: warnings,
  };
}

module.exports = { extractBenefits, BENEFIT_LABEL_DICTIONARY };
