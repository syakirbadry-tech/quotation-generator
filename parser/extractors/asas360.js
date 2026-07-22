/**
 * extractors/asas360.js
 *
 * Product extractor for PruBSN Asas360 + Health360 - Phase 2 of the
 * Medical Card Engine's Version 1 architecture (see
 * /Users/syakir/.claude/plans/snappy-strolling-cat.md). Understands ONLY
 * this product's own PDF structure, anchored against the real "Yusuf &
 * Ayah" Product Illustration (page numbers below refer to that
 * document's own printed page numbers, cited in the plan file).
 *
 * Asas360 is fundamentally an investment-linked plan (its own cover page
 * says so) with Health360 as its attached medical rider - Version 1's
 * scope is the MEDICAL rider only (per the plan's explicit scoping
 * decision), so this extractor does not attempt to model the
 * investment-linked machinery (chosen funds, PUA/IUA cash-value
 * projections, Kasih Bonus, fund switching) - that is out of scope until
 * a future Investment Engine.
 *
 * Structural difference from AnugerahMax, handled here (not assumed
 * away): the sample is a juvenile (child) certificate - the "Details"
 * table has two columns, "Person to be Covered" and "Parent". The
 * `Parent` column is treated as optional throughout - an adult-only
 * Asas360 quotation (a single column) has not been verified against a
 * real sample; see the plan file's "Known limitation" section.
 *
 * Expected output (pre-normalization, i.e. before normalize/toMedicalJson.js):
 *   { metadata, client: { ...primary fields, parent: {...} | null },
 *     agent, medicalRider: { riderName, planTier, coverageToAge,
 *     roomAndBoard item, smartValuePoint, coPaymentOption, benefitItems,
 *     medicalExclusions, fullExclusionsList, waitingPeriods, contribution },
 *     monthlyTotalAmountPayable, totalAnnualContribution, _warnings }
 */

'use strict';

const {
  findAnchorIndexInDoc,
  getSectionLines,
  getValueAfterColon,
  parseCurrency,
  parseIntSafe,
  splitLetteredList,
  splitTwoColumnByHeader,
  splitIntoClauses,
} = require('../lineUtils');
const { extractMetadata } = require('../extractMetadata');
const { extractAgent } = require('../extractAgent');

/** Splits a "Label : leftValue : rightValue" line into its two column values - see file header re: the optional Parent column. */
function twoColumnValue(line, label) {
  if (!line) return { left: null, right: null };
  const idx = line.indexOf(label);
  if (idx === -1) return { left: null, right: null };
  const afterLabel = line.slice(idx + label.length);
  const firstColon = afterLabel.indexOf(':');
  if (firstColon === -1) return { left: null, right: null };
  const rest = afterLabel.slice(firstColon + 1);
  const secondColon = rest.indexOf(':');
  if (secondColon === -1) return { left: rest.trim() || null, right: null };
  return { left: rest.slice(0, secondColon).trim() || null, right: rest.slice(secondColon + 1).trim() || null };
}

function extractClientSection(doc, warnings) {
  const section = getSectionLines(doc, /Person to be Covered/i, /Plan Type\s*:/i);
  if (section.startIndex === -1) {
    warnings.push({ field: 'client', message: 'Could not locate the "Person to be Covered" details table.' });
    return { primary: {}, parent: null };
  }

  const fieldFrom = (label) => {
    const line = section.lines.find((l) => l.includes(label));
    return twoColumnValue(line, label);
  };

  const name = fieldFrom('Name');
  const sex = fieldFrom('Sex');
  const smoker = fieldFrom('Smoker');
  const occupation = fieldFrom('Occupation');
  const age = fieldFrom('Age');
  const dob = fieldFrom('Date of birth');

  const businessProposalLine = section.lines.find((l) => l.includes('Business Proposal'));
  const takafulPurposeLine = section.lines.find((l) => l.includes('Takaful Plan Purpose'));

  const primary = {
    fullName: name.left,
    gender: sex.left,
    smokerStatus: smoker.left ? (/^no$/i.test(smoker.left) ? 'Non-Smoker' : /^yes$/i.test(smoker.left) ? 'Smoker' : smoker.left) : null,
    occupationClass: occupation.left,
    ageNextBirthday: parseIntSafe(age.left),
    dateOfBirth: dob.left || null,
    businessProposal: businessProposalLine ? /^yes$/i.test(getValueAfterColon(businessProposalLine, 'Business Proposal') || '') : null,
    takafulPlanPurpose: takafulPurposeLine ? getValueAfterColon(takafulPurposeLine, 'Takaful Plan Purpose') : null,
  };

  [['fullName', name.left], ['gender', sex.left], ['ageNextBirthday', age.left]].forEach(([key, value]) => {
    if (!value) warnings.push({ field: `client.${key}`, message: `Could not locate a value for client.${key} in the Person to be Covered column.` });
  });

  const hasParentColumn = Boolean(name.right);
  const parent = hasParentColumn
    ? {
        fullName: name.right,
        gender: sex.right,
        smokerStatus: smoker.right ? (/^no$/i.test(smoker.right) ? 'Non-Smoker' : /^yes$/i.test(smoker.right) ? 'Smoker' : smoker.right) : null,
        occupationClass: occupation.right,
        ageNextBirthday: parseIntSafe(age.right),
      }
    : null;

  return { primary, parent };
}

/**
 * Room & Board / SVP / Co-payment are printed across 3 consecutive lines
 * in the page-2 quotation table, one line above the "Health360" row
 * itself (R&B), starting on that row (SVP), and one line below
 * (Co-payment) - "Health360" shares its line with the rider's term-years
 * column, so it is NOT anchored on directly; "R&B: RM" is a more precise,
 * unambiguous anchor and appears earliest in the document at this table
 * (it recurs later in "Table 2: Rider(s)", which is why the FIRST match
 * - this function's default - matters).
 */
function extractHealth360RowFacts(doc, warnings) {
  const rowIdx = findAnchorIndexInDoc(doc, /R&B:\s*RM/i);
  if (rowIdx === -1) {
    warnings.push({ field: 'medicalRider', message: 'Could not locate the "R&B: RM..." row in the quotation benefits table.' });
    return { roomAndBoardValue: null, smartValuePoint: null, coPaymentOption: null };
  }
  const windowLines = doc.allLines.slice(rowIdx, rowIdx + 3).map((l) => l.text);
  const windowText = windowLines.join(' ');

  const rbMatch = windowText.match(/R&B:\s*RM\s*([\d,]+)/i);
  const svpMatch = windowText.match(/Smart Value Point:\s*RM\s*([\d,]+)/i);
  const coPayMatch = windowText.match(/Co-payment:\s*([A-Za-z]+\s*RM?[\d,]*)/i);

  if (!rbMatch) warnings.push({ field: 'medicalRider.roomAndBoard', message: 'Could not locate the "R&B: RM..." figure near the Health360 row.' });
  if (!svpMatch) warnings.push({ field: 'medicalRider.smartValuePoint', message: 'Could not locate the "Smart Value Point: RM..." figure near the Health360 row.' });
  if (!coPayMatch) warnings.push({ field: 'medicalRider.coPaymentOption', message: 'Could not locate the "Co-payment: ..." option near the Health360 row.' });

  return {
    roomAndBoardValue: rbMatch ? `RM${rbMatch[1]} per day` : null,
    smartValuePoint: svpMatch ? parseCurrency(svpMatch[1]) : null,
    coPaymentOption: coPayMatch ? coPayMatch[1].trim() : null,
  };
}

/** Plan tier ("Health360 Plan 200") only appears in the Product Options Table, not the main quotation table - see the plan file's note on this. */
function extractPlanTier(doc, warnings) {
  const idx = findAnchorIndexInDoc(doc, /Health360\s+Plan\s+(\d+)/i);
  if (idx === -1) {
    warnings.push({ field: 'medicalRider.planTier', message: 'Could not locate "Health360 Plan N" in the Product Options Table.' });
    return null;
  }
  const m = doc.allLines[idx].text.match(/Health360\s+Plan\s+(\d+)/i);
  return m ? m[1] : null;
}

/** Coverage term: "Certificate Term : 59 years (i.e. until the Certificate Anniversary date of Covered Person's age 60 next birthday)". */
function extractCoverageToAge(doc, warnings) {
  const idx = findAnchorIndexInDoc(doc, /^Certificate Term\s*:/i);
  if (idx === -1) {
    warnings.push({ field: 'medicalRider.coverageToAge', message: 'Could not locate "Certificate Term".' });
    return null;
  }
  const m = doc.allLines[idx].text.match(/age\s+(\d+)\s+next birthday/i);
  if (!m) {
    warnings.push({ field: 'medicalRider.coverageToAge', message: 'Could not parse an age out of the "Certificate Term" line.' });
    return null;
  }
  return parseInt(m[1], 10);
}

function extractMonthlyAndAnnual(doc, warnings) {
  const monthlyIdx = findAnchorIndexInDoc(doc, /^Monthly Total Amount Payable\s*:/i);
  const annualIdx = findAnchorIndexInDoc(doc, /^Total Annual Contribution\s*:/i);
  const monthly = monthlyIdx !== -1 ? parseCurrency((doc.allLines[monthlyIdx].text.match(/RM\s*([\d,]+(?:\.\d+)?)/) || [])[1]) : null;
  const annual = annualIdx !== -1 ? parseCurrency((doc.allLines[annualIdx].text.match(/RM\s*([\d,]+(?:\.\d+)?)/) || [])[1]) : null;
  if (monthly == null) warnings.push({ field: 'monthlyTotalAmountPayable', message: 'Could not locate "Monthly Total Amount Payable".' });
  if (annual == null) warnings.push({ field: 'totalAnnualContribution', message: 'Could not locate "Total Annual Contribution".' });
  return { monthly, annual };
}

// Fixed, known vocabulary for Health360's "Table of Benefits" - same
// technique as the existing (frozen) extractBenefits.js's
// BENEFIT_LABEL_DICTIONARY for Medic TotalCare: order matters, it defines
// the boundary between one item's value block and the next. Extend this
// list (and only this list) to support a different Health360 plan tier's
// table in a future PDF version. Labels are transcribed verbatim
// (case-sensitive) from the real "Yusuf & Ayah" sample, letters a)-s) plus
// one unlettered trailing row ("Health Retirement").
const BENEFIT_LABEL_DICTIONARY = [
  { section: 'Room & Board Benefits', label: 'Hospital Daily Room & Board' },
  { section: 'Hospital & Surgical Benefits', label: 'Intensive Care Unit (ICU) / Cardiac Care Unit (CCU)' },
  { section: 'Hospital & Surgical Benefits', label: 'In-hospital & Related Services' },
  { section: 'Hospital & Surgical Benefits', label: 'Pre-hospitalisation Treatment' },
  { section: 'Hospital & Surgical Benefits', label: 'Post-hospitalisation Treatment' },
  { section: 'Hospital & Surgical Benefits', label: 'Major Organ Transplant' },
  { section: 'Outpatient Treatment Benefits', label: 'Outpatient Cancer Treatment' },
  { section: 'Outpatient Treatment Benefits', label: 'Outpatient Kidney Dialysis Treatment' },
  { section: 'Outpatient Treatment Benefits', label: 'Second Medical Opinion' },
  { section: 'Outpatient Treatment Benefits', label: 'Mental Care Treatment' },
  { section: 'Outpatient Treatment Benefits', label: 'Home Nursing Care' },
  { section: 'Outpatient Treatment Benefits', label: 'Intraocular Lens' },
  { section: 'Outpatient Treatment Benefits', label: 'Day Surgery / Day Care Procedure' },
  { section: 'Outpatient Treatment Benefits', label: 'Outpatient Dengue and Infectious Disease Treatment' },
  { section: 'Outpatient Treatment Benefits', label: 'Outpatient Top Child Illnesses Treatment' },
  { section: 'Outpatient Treatment Benefits', label: 'Outpatient Parents Allowance' },
  { section: 'Other Benefits', label: 'Daily Cash Allowance for Malaysian Government Hospital' },
  { section: 'Other Benefits', label: 'Emergency Outpatient Treatment for Accidental Injury' },
  { section: 'Other Benefits', label: 'Worldwide Emergency Medical Assistance' },
  { section: 'Other Benefits', label: 'Health Retirement' },
];

const SECTION_HEADER_LINES = new Set(BENEFIT_LABEL_DICTIONARY.map((e) => e.section));

// The "Table of Benefits" spans a page break (p.24 -> p.25) in the real
// sample, and pdftotext's repeating page footer/header land mid-table
// (mid-item, in fact - inside item (n)'s own value block). Unlike
// PAGE_FOOTER_ANCHOR in lineUtils.js (which only strips up to the FIRST
// footer, fine for AnugerahMax's single-page table), Health360's table
// needs every recurring footer/header line stripped throughout the whole
// bounded block, not just the first. Kept local to this extractor rather
// than generalized into lineUtils.js, since it's Asas360-specific.
const HEALTH360_NOISE_LINE_PATTERNS = [
  /^Presented by\s*:/i,
  /^Date\s*:/i,
  /^Version\s*:/i,
  /^Page\s+\d+\s+of\s+\d+/i,
  /^Quotation for\s+/i,
  /^PruBSN\s+Asas360\s*$/i,
];

function isNoiseLine(line) {
  return HEALTH360_NOISE_LINE_PATTERNS.some((re) => re.test(line));
}

function findLineIndexFrom(lines, label, fromIndex) {
  for (let i = fromIndex; i < lines.length; i++) {
    if (lines[i].includes(label)) return i;
  }
  return -1;
}

/**
 * Reconstructs one benefit row's displayed value out of its bounded block
 * of lines. The label's own line rarely carries the value directly next to
 * it (Health360's table right-aligns the value in its own column, often on
 * a separate physical line, sometimes wrapped across several) - so this
 * walks every line in the block, in reading order, and keeps whatever
 * looks like value- or note-bearing text: a plain right-aligned line, or
 * the trailing text after a large column gap on a sub-bullet/continuation
 * line. Bare sub-bullets with no trailing value (e.g. "- Haemodialysis")
 * are dropped - they're descriptive, not the benefit amount.
 *
 * Returns `{ value, note }` separately (not pre-joined) so
 * extractBenefitItems() can tell a genuine printed value ("As Charged",
 * "RM200 per day", "Yes") apart from a bare parenthetical annotation
 * ("(maximum 150 days per year)") - the distinction matters for the
 * merged-cell inheritance below, which must only ever carry forward a
 * real value, never fabricate one from a day-limit note alone.
 */
function valueForBenefitRow(blockLines, label) {
  const valueParts = [];
  const noteParts = [];
  blockLines.forEach((raw) => {
    let line = raw.trim();
    if (!line || SECTION_HEADER_LINES.has(line)) return;

    const idx = line.indexOf(label);
    if (idx !== -1) {
      line = line
        .slice(idx + label.length)
        .replace(/^,?\s*including:?\s*/i, '')
        .replace(/^[,:]\s*/, '')
        .trim();
      if (!line) return;
    }

    const isBullet = /^-\s*/.test(line);
    const gapMatch = line.match(/^(.*?)\S\s{2,}(\S.*)$/);
    let text = null;
    if (gapMatch) {
      text = gapMatch[2].trim();
    } else if (!isBullet) {
      text = line;
    }
    if (text == null) return; // a bare sub-bullet with no trailing column gap carries no value - skip it
    if (/^\(/.test(text)) {
      noteParts.push(text);
    } else {
      valueParts.push(text);
    }
  });
  return {
    value: valueParts.length ? valueParts.join(' ').replace(/\s+/g, ' ').replace(/,\s*$/, '').trim() : null,
    note: noteParts.length ? noteParts.join(' ').replace(/\s+/g, ' ').trim() : null,
  };
}

/**
 * Health360's "Table of Benefits" (Appendix: Medical Benefit). Bounded to
 * end at the table's own footnotes (the "i Second Medical Opinion
 * (Consultation with World Leading Expert)..." line) - NOT at "Waiting
 * Period:", which comes much later, after a second, unrelated
 * prose-description pass that reuses the same a)-s) letter markers as
 * section headers for explanatory paragraphs (would otherwise double-count
 * every item under whatever section was last seen).
 *
 * Merged-cell inheritance: a handful of rows (e.g. Intensive Care Unit,
 * Pre-/Post-hospitalisation Treatment, Major Organ Transplant) print no
 * value of their own anywhere in the source text - only a day/lifetime-
 * count parenthetical. Cross-checked against the Appendix's own prose
 * description of each of these benefits (same PDF, further down): none of
 * them state a distinct monetary cap of their own, every one just
 * references "the maximum ... stated in the Table of Benefits above" -
 * consistent with a single vertically-merged "As Charged" cell spanning
 * the whole "Hospital & Surgical Benefits" section, visually centered on
 * "In-hospital & Related Services" in the flattened text (hence it only
 * appears once). To stay on the safe side of "never invent data", this is
 * applied ONLY when a section has EXACTLY ONE row with the bare value "As
 * Charged" (no trailing qualifier) and the rest have none at all - a
 * section with an ambiguous or compound value (e.g. "combined up to
 * RM1,500,000") never triggers this, and a value is never inherited
 * across a section boundary.
 */
function extractBenefitItems(doc, warnings) {
  const section = getSectionLines(doc, /^Table of Benefits\s*$/i, /^i\s+Second Medical Opinion/i);
  if (section.startIndex === -1) {
    warnings.push({ field: 'medicalRider.benefitItems', message: 'Could not locate Health360\'s "Table of Benefits".' });
    return [];
  }
  const lines = section.lines.filter((raw) => !isNoiseLine(raw.trim()));

  const items = [];
  let cursor = 0;
  for (let i = 0; i < BENEFIT_LABEL_DICTIONARY.length; i++) {
    const { section: sectionName, label } = BENEFIT_LABEL_DICTIONARY[i];
    const idx = findLineIndexFrom(lines, label, cursor);
    if (idx === -1) {
      warnings.push({ field: `medicalRider.benefitItems.${label}`, message: `Could not locate the "${label}" row.` });
      items.push({ section: sectionName, label, value: null, note: null });
      continue;
    }
    const nextLabel = BENEFIT_LABEL_DICTIONARY[i + 1];
    const nextIdx = nextLabel ? findLineIndexFrom(lines, nextLabel.label, idx + 1) : lines.length;
    const boundEnd = nextIdx === -1 ? lines.length : nextIdx;
    const blockLines = lines.slice(idx, boundEnd);
    const { value, note } = valueForBenefitRow(blockLines, label);

    items.push({ section: sectionName, label, value, note });
    cursor = idx + 1;
  }

  // --- Merged-cell inheritance pass (see file comment above) ---
  // Must run BEFORE the g)/h) combine below: g)'s own bare "As Charged"
  // has to still be bare "As Charged" (not yet folded into the combined
  // sentence) when this pass counts how many bare "As Charged" values
  // exist in "Outpatient Treatment Benefits" - otherwise it would
  // miscount (only m) Day Surgery left) and wrongly inherit "As Charged"
  // into genuinely-blank rows like k) Home Nursing Care.
  const sectionsSeen = new Set(items.map((it) => it.section));
  sectionsSeen.forEach((sectionName) => {
    const rowsInSection = items.filter((it) => it.section === sectionName);
    const bareAsCharged = rowsInSection.filter((it) => it.value === 'As Charged');
    if (bareAsCharged.length !== 1) return; // ambiguous (0 or >1 candidates) - never guess
    rowsInSection.forEach((it) => {
      if (it.value == null) {
        it.value = 'As Charged';
        it.inheritedValue = true;
      }
    });
  });

  // Outpatient Cancer Treatment (g) and Outpatient Kidney Dialysis
  // Treatment (h) share ONE merged value cell in the source table -
  // confirmed from the raw text: "As Charged, combined up to
  // RM1,500,000 per lifetime" trails BOTH items' bullet lists as a single
  // block, not split between them (h's own row only carries the
  // "combined up to..." half because that's where the block happens to
  // end in the flattened text). Give both rows the full combined
  // sentence rather than half each.
  const cancerItem = items.find((it) => it.label === 'Outpatient Cancer Treatment');
  const dialysisItem = items.find((it) => it.label === 'Outpatient Kidney Dialysis Treatment');
  if (cancerItem && dialysisItem && cancerItem.value && dialysisItem.value && cancerItem.value !== dialysisItem.value) {
    const combined = `${cancerItem.value}, ${dialysisItem.value}`;
    cancerItem.value = combined;
    dialysisItem.value = combined;
  }

  items.forEach((it) => {
    const finalValue = [it.value, it.note].filter(Boolean).join(' ') || null;
    if (finalValue == null) {
      warnings.push({
        field: `medicalRider.benefitItems.${it.label}`,
        message: `No explicit value found for "${it.label}" - this may be a merged table cell shared with an adjacent row; verify against the source PDF.`,
      });
    } else if (it.inheritedValue) {
      warnings.push({
        field: `medicalRider.benefitItems.${it.label}`,
        message: `"${it.label}" has no value printed on its own row - inherited "As Charged" from the single matching value shared across its "${it.section}" section (a merged table cell); verify against the source PDF.`,
      });
    }
    it.value = finalValue;
    delete it.note;
    delete it.inheritedValue;
  });

  return items;
}

function extractWaitingPeriods(doc, warnings) {
  const section = getSectionLines(doc, /^Waiting Period:\s*$/i, /^Exclusions:\s*$/i);
  if (section.startIndex === -1) {
    warnings.push({ field: 'medicalRider.waitingPeriods', message: 'Could not locate the "Waiting Period:" section.' });
    return [];
  }
  const periods = [];
  section.lines.forEach((raw) => {
    const line = raw.trim();
    const m = line.match(/(\d+)\s+days?\s+after\s+(?:the\s+)?(?:effective date of the rider|effective date of the certificate)?\s*(?:or\s+(?:the\s+)?date it is revived)?\s*(?:for|,?\s*for)?\s*(.+)/i);
    if (m) {
      // Strips the list's own trailing conjunction ("... any other causes,
      // and") alongside the usual trailing punctuation - a bulleted list of
      // 3 items reads naturally with "and" before the last one in the
      // source PDF, but that's list grammar, not part of the description.
      const description = m[2].replace(/,?\s*and\s*$/i, '').replace(/[,.]$/, '').trim();
      periods.push({ days: parseInt(m[1], 10), description });
    }
  });
  if (!periods.length) {
    warnings.push({ field: 'medicalRider.waitingPeriods', message: 'Waiting Period section found but no {days, description} rows could be parsed.' });
  }
  return periods;
}

/**
 * Health360's Product Disclosure Sheet DOES print a short client-facing
 * "What is covered? / What is not covered?" two-column digest ("Step 2 -
 * Does it meet your needs?"), in the exact same layout AnugerahMax's Medic
 * TotalCare PDS uses - reuses the same generic lineUtils.js helper
 * (splitTwoColumnByHeader) extractBenefits.js already relies on for that
 * product, rather than the earlier, incorrect assumption that this
 * product simply doesn't have one.
 */
function extractMedicalExclusionsDigest(doc, warnings) {
  const { fragments } = splitTwoColumnByHeader(
    doc,
    /What is covered\?.*What is not covered\?/i,
    'What is not covered?',
    /This is not a complete list/i
  );
  if (!fragments.length) {
    warnings.push({ field: 'medicalRider.medicalExclusions', message: 'Could not reconstruct the "What is not covered?" column.' });
    return [];
  }
  const clauses = splitIntoClauses(fragments.join(' '));
  if (!clauses.length) {
    warnings.push({ field: 'medicalRider.medicalExclusions', message: 'Reconstructed text but could not split it into distinct items; returning as one block.' });
    return [fragments.join(' ')];
  }
  return clauses;
}

function extractExclusions(doc, warnings) {
  const section = getSectionLines(doc, /^Exclusions:\s*$/i, /^Other Certificate Conditions/i);
  if (section.startIndex === -1) {
    warnings.push({ field: 'medicalRider.fullExclusionsList', message: 'Could not locate the medical "Exclusions:" list.' });
    return [];
  }
  // This lettered list spans a page break (p.28 -> p.29) in the real
  // sample, and pdftotext's repeating page footer/header land mid-item
  // (confirmed: inside item (ff)'s own text, between "...not been proved
  // to be effective," and its continuation "based on established medical
  // practice..."). splitLetteredList() has no noise-filtering of its own
  // (it's a generic, shared helper), so the filtering has to happen here,
  // the same way extractBenefitItems() already does for the benefit table.
  const lines = section.lines.filter((raw) => !isNoiseLine(raw.trim()));
  const items = splitLetteredList(lines);
  // The trailing "This list is non-exhaustive..." disclaimer sentence
  // that follows the last lettered item ((gg)) in the source text is not
  // part of that item - strip it back off rather than let it get absorbed
  // into (gg)'s own text by splitLetteredList()'s continuation-line logic.
  const last = items[items.length - 1];
  if (last) {
    last.text = last.text.replace(/\s*This list is non-exhaustive\..*$/i, '').trim();
  }
  return items;
}

/** "Lifetime Limit :No Limit, subject to SVP" - printed verbatim on Health360's own PDS (p.14, "Step 2 - Does it meet your needs?"). Quoted exactly, not paraphrased, since this is regulated financial-product copy. */
function deriveLifetimeLimitDisplay(smartValuePoint) {
  return smartValuePoint != null ? 'No Limit, subject to SVP' : null;
}

/**
 * Basic plan facts ("PruBSN Asas360 (Basic)" row in the main quotation
 * table, p.2): term (years) and sum covered (RM) - protection-domain
 * facts (see normalize/toProtectionJson.js), not medical ones. Anchored
 * on the literal "(Basic)" parenthetical, which appears exactly once in
 * the document.
 */
function extractBasicPlanFacts(doc, warnings) {
  const idx = findAnchorIndexInDoc(doc, /PruBSN\s+Asas360\s*\(Basic\)/i);
  if (idx === -1) {
    warnings.push({ field: 'protection.basicPlan', message: 'Could not locate the "PruBSN Asas360 (Basic)" row in the quotation table.' });
    return { basicPlanName: null, basicPlanTerm: null, basicSumCovered: null };
  }
  const line = doc.allLines[idx].text;
  const m = line.match(/\(Basic\)\s*(\d+)\s+([\d,]+)/i);
  if (!m) {
    warnings.push({ field: 'protection.basicPlan', message: 'Located the "PruBSN Asas360 (Basic)" row but could not parse its term/sum covered figures.' });
    return { basicPlanName: 'PruBSN Asas360 (Basic)', basicPlanTerm: null, basicSumCovered: null };
  }
  return {
    basicPlanName: 'PruBSN Asas360 (Basic)',
    basicPlanTerm: parseInt(m[1], 10),
    basicSumCovered: parseCurrency(m[2]),
  };
}

/**
 * Table 1: PruBSN Asas360 (p.5) - year-by-year Non-Guaranteed Cash Value
 * under Scenario X (2% p.a.) and Scenario Y (5% p.a.), alongside Sum
 * Covered and Non-Guaranteed Death Benefits. A genuine, real, printed
 * schedule - unlike AnugerahMax's flat single-figure cash value, Asas360's
 * investment-linked structure only ever prints cash value as a
 * year-by-year table, so this is extracted as a schedule rather than
 * forcing a single "the" cash value figure the source doesn't state.
 *
 * Row format (space-separated, verified against the real sample): Year,
 * Contribution Paid, Allocated Contribution (RM), Allocated Contribution
 * (%), Tabarru' Basic, Tabarru' Rider(s), Other Charges, Fund Mgmt Charge
 * (X), Fund Mgmt Charge (Y), Sum Covered, Cash Value (X), Cash Value (Y),
 * Death Benefit (X), Death Benefit (Y), Commission (RM), Commission (%) -
 * 16 whitespace-separated tokens per row, anchored on a bare leading
 * integer (the certificate year) so the table's own "Total" row (no
 * leading year) is never misread as data.
 */
function extractCashValueSchedule(doc, warnings) {
  const section = getSectionLines(doc, /^Table 1:\s*PruBSN Asas360/i, /^Table 2:\s*Rider/i);
  if (section.startIndex === -1) {
    warnings.push({ field: 'protection.cashValue.schedule', message: 'Could not locate "Table 1: PruBSN Asas360".' });
    return [];
  }
  const rows = [];
  section.lines.forEach((raw) => {
    const line = raw.trim();
    const m = line.match(
      /^(\d+)\s+([\d,]+)\s+([\d,]+)\s+([\d.]+)\s+(\d+)\s+([\d,]+)\s+(\d+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d.]+)$/
    );
    if (!m) return;
    rows.push({
      year: parseInt(m[1], 10),
      contributionPaid: parseCurrency(m[2]),
      sumCovered: parseCurrency(m[10]),
      cashValueScenarioX: parseCurrency(m[11]),
      cashValueScenarioY: parseCurrency(m[12]),
      deathBenefitScenarioX: parseCurrency(m[13]),
      deathBenefitScenarioY: parseCurrency(m[14]),
    });
  });
  if (!rows.length) {
    warnings.push({ field: 'protection.cashValue.schedule', message: '"Table 1" was located but no year rows could be parsed - verify against the source PDF.' });
  }
  return rows;
}

/**
 * Table 3: Breakdown of Tabarru` Deductions (p.8) - the real, printed
 * per-year Health360-specific Tabarru' deduction. This is the field
 * fromAsas360()'s own contribution warning already promises exists
 * ("see Table 3's Tabarru' deduction schedule") - previously that promise
 * was never fulfilled; this extractor fulfils it. Row format: Year,
 * Basic Tabarru', Vital Care Plus Tabarru', Health360 Tabarru', Crisis
 * Protector Tabarru' - 5 whitespace-separated numeric tokens per row.
 */
function extractTabarruDeductionSchedule(doc, warnings) {
  const section = getSectionLines(doc, /^Table 3:\s*Breakdown of Tabarru/i, /^Appendix:\s*Projection by Accounts/i);
  if (section.startIndex === -1) {
    warnings.push({ field: 'medical.tabarruDeductionSchedule', message: "Could not locate \"Table 3: Breakdown of Tabarru\` Deductions\"." });
    return [];
  }
  const rows = [];
  section.lines.forEach((raw) => {
    const line = raw.trim();
    const m = line.match(/^(\d+)\s+(\d+)\s+(\d+)\s+([\d,]+)\s+(\d+)$/);
    if (!m) return;
    rows.push({
      year: parseInt(m[1], 10),
      basicTabarru: parseCurrency(m[2]),
      vitalCarePlusTabarru: parseCurrency(m[3]),
      health360Tabarru: parseCurrency(m[4]),
      crisisProtectorTabarru: parseCurrency(m[5]),
    });
  });
  if (!rows.length) {
    warnings.push({ field: 'medical.tabarruDeductionSchedule', message: '"Table 3" was located but no year rows could be parsed - verify against the source PDF.' });
  }
  return rows;
}

function extractAsas360(doc, options) {
  const warnings = [];
  const errors = [];

  const metadata = extractMetadata(doc, options);
  const { _warnings: metaWarnings, ...metadataRest } = metadata;
  warnings.push(...(metaWarnings || []));

  const agent = extractAgent(doc);
  const { _warnings: agentWarnings, ...agentRest } = agent;
  warnings.push(...(agentWarnings || []));

  const { primary: clientPrimary, parent } = extractClientSection(doc, warnings);
  const { smartValuePoint, coPaymentOption } = extractHealth360RowFacts(doc, warnings);
  const planTier = extractPlanTier(doc, warnings);
  const coverageToAge = extractCoverageToAge(doc, warnings);
  const { monthly, annual } = extractMonthlyAndAnnual(doc, warnings);
  const medicalBenefitItems = extractBenefitItems(doc, warnings);
  const waitingPeriods = extractWaitingPeriods(doc, warnings);
  const fullExclusionsList = extractExclusions(doc, warnings);
  const medicalExclusions = extractMedicalExclusionsDigest(doc, warnings);
  const tabarruDeductionSchedule = extractTabarruDeductionSchedule(doc, warnings);

  const { basicPlanName, basicPlanTerm, basicSumCovered } = extractBasicPlanFacts(doc, warnings);
  const cashValueSchedule = extractCashValueSchedule(doc, warnings);

  const data = {
    metadata: metadataRest,
    client: { ...clientPrimary, parent },
    agent: agentRest,
    medicalRider: {
      riderName: 'Health360',
      planTier,
      coverageToAge,
      contribution: null, // see toMedicalJson.fromAsas360()'s own warning - not printed as a standalone figure for this product
      benefitItems: medicalBenefitItems,
      medicalExclusions,
      fullExclusionsList,
      waitingPeriods,
      smartValuePoint,
      lifetimeLimit: deriveLifetimeLimitDisplay(smartValuePoint),
      coPaymentOption,
      tabarruDeductionSchedule,
    },
    // Protection domain (see normalize/toProtectionJson.js) - the basic
    // plan's own facts, kept separate from the Health360 medical rider
    // above. Death/TPD benefit for Asas360 is genuinely formula-based
    // (Basic Sum Covered plus/before the cash value of the certificate,
    // per the Appendix: Death & TPD Benefit, p.19) rather than a single
    // fixed figure the way AnugerahMax's is - represented honestly as
    // {amount, description} rather than a fabricated combined number.
    basicPlan: {
      basicPlanName,
      basicPlanTerm,
      basicSumCovered,
      deathBenefit: basicSumCovered != null
        ? { amount: basicSumCovered, description: 'Basic Sum Covered plus the cash value of the certificate' }
        : null,
      tpdBenefit: basicSumCovered != null
        ? { amount: basicSumCovered, description: "Basic Sum Covered, payable before the certificate anniversary of the Covered Person's age 70 next birthday" }
        : null,
      cashValueSchedule,
    },
    monthlyTotalAmountPayable: monthly,
    totalAnnualContribution: annual,
  };

  return { data, warnings, errors };
}

module.exports = { extractAsas360 };
