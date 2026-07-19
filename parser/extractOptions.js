/**
 * extractOptions.js
 *
 * Source section: "Product Options Table" (Step 5 of the Medic TotalCare
 * Product Disclosure Sheet) - a 3-column comparison (Recommended Product /
 * Option 1 / Option 2), bounded until the page footer.
 *
 * Extraction method: anchor-label. Most rows of this table print cleanly
 * on one physical line with the three column values separated by wide
 * gaps (e.g. the "RM 2,112.00   RM 1,860.00   RM 2,952.00" contribution
 * row), so they're read with lineUtils.splitColumns. A few rows wrap
 * their label across two lines with the value line sandwiched between
 * them (the same PDF-generator quirk seen elsewhere), so the value row is
 * located by searching outward from the label anchor rather than assumed
 * to be on the same line.
 *
 * The "Name" row is the one genuinely fragile field: each column's
 * product name itself wraps across two lines, and two of the three
 * columns' text shares single physical lines. It's reconstructed using
 * the same header-offset calibration technique as the medical-exclusions
 * two-column split (see lineUtils.splitTwoColumnByHeader), generalised to
 * three columns using the "Option 1 / Option 2" sub-header row to find
 * where columns 2 and 3 begin. This is lower-confidence than every other
 * field in this file and is always flagged for manual verification.
 *
 * coverageTerm is extracted once for the whole table (not per column):
 * in the sample document all three options share the same "Until age 70"
 * wording, and validate.js checks that assumption by comparing every
 * occurrence within the block rather than trusting it silently.
 *
 * Expected output:
 *   { columns: [{ optionLabel, productName, annualContribution,
 *       contributionDeltaNote, facilityType, coPaymentOption,
 *       roomAndBoard, hospitalTreatment, annualLimitOption,
 *       lifetimeLimitOption }] (length 3, in table order),
 *     coverageTerm, coverageTermAgesFound, _warnings }
 */

'use strict';

const { getSectionLines, splitColumns, parseCurrency, PAGE_FOOTER_ANCHOR } = require('./lineUtils');

const OPTION_LABELS = ['Recommended Product', 'Option 1', 'Option 2'];

/**
 * Like lineUtils.splitColumns, but also returns each chunk's character
 * offset on the original line - needed to classify a chunk by which
 * calibrated reference column it's nearest to (see extractProductNames).
 */
function splitColumnsWithOffsets(line, minGap = 2) {
  const re = new RegExp(`\\s{${minGap},}`, 'g');
  const result = [];
  let lastEnd = 0;
  let m;
  while ((m = re.exec(line))) {
    const chunk = line.slice(lastEnd, m.index);
    const text = chunk.trim();
    if (text) result.push({ text, offset: lastEnd + chunk.search(/\S/) });
    lastEnd = re.lastIndex;
  }
  const tailChunk = line.slice(lastEnd);
  const tailText = tailChunk.trim();
  if (tailText) result.push({ text: tailText, offset: lastEnd + tailChunk.search(/\S/) });
  return result;
}

function findAnchorLineIndex(lines, substrings) {
  for (let i = 0; i < lines.length; i++) {
    if (substrings.some((s) => lines[i].includes(s))) return i;
  }
  return -1;
}

/** Search outward from an anchor line for the nearest row that splits into >= minColumns parts. */
function findColumnRow(lines, anchorIdx, { window = 3, minColumns = 3 } = {}) {
  if (anchorIdx === -1) return null;
  const order = [anchorIdx];
  for (let d = 1; d <= window; d++) order.push(anchorIdx + d, anchorIdx - d);
  for (const idx of order) {
    if (idx < 0 || idx >= lines.length) continue;
    const cols = splitColumns(lines[idx]);
    if (cols.length >= minColumns) return cols;
  }
  return null;
}

function extractRow(lines, warnings, fieldName, labelSubstrings, options) {
  const anchorIdx = findAnchorLineIndex(lines, labelSubstrings);
  const cols = findColumnRow(lines, anchorIdx, options);
  if (!cols) {
    warnings.push({
      field: `options.${fieldName}`,
      message: `Could not locate a 3-column row near "${labelSubstrings[0]}".`,
    });
    return [null, null, null];
  }
  // Some rows print "Label   Value1   Value2   Value3" on one physical
  // line (4+ columns); others have the label on a separate wrapped line
  // so the matched row is just "Value1   Value2   Value3" (3 columns).
  // The three option VALUES are always the trailing columns either way.
  const values = cols.length > 3 ? cols.slice(-3) : cols;
  return [values[0] || null, values[1] || null, values[2] || null];
}

/**
 * Reconstructs each column's product name from the "Name" row, whose
 * cells each wrap across two lines and, for columns 2/3, share single
 * physical lines - a per-line "split at N spaces" alone can't tell which
 * fragment belongs to which column. Instead this calibrates FOUR
 * reference x-offsets from lines that are known to belong to exactly one
 * column each: the row-label itself ("Name", to be discarded), column 1
 * (the "PruBSN AnugerahMax:" line directly under the row label, which
 * has no other column's text sharing its line), and columns 2/3 (from
 * the "Option 1   Option 2" sub-header). Every text chunk in the Name
 * row is then assigned to whichever reference offset it starts closest
 * to - robust to the few characters of column-position drift that
 * proportional-width PDF text produces in "layout" text extraction.
 */
function extractProductNames(lines, warnings) {
  const headerIdx = lines.findIndex((l) => l.includes('Option 1') && l.includes('Option 2'));
  const nameIdx = findAnchorLineIndex(lines, ['Name']);
  if (headerIdx === -1 || nameIdx === -1 || nameIdx + 1 >= lines.length) {
    warnings.push({
      field: 'options.productName',
      message: 'Could not locate the "Name" row or "Option 1 / Option 2" sub-header; product names unavailable.',
    });
    return [null, null, null];
  }

  const labelOffset = lines[nameIdx].search(/\S/);
  const col1Offset = lines[nameIdx - 1].search(/\S/); // the line right above "Name" is column 1's own line
  const col2Offset = lines[headerIdx].indexOf('Option 1');
  const col3Offset = lines[headerIdx].indexOf('Option 2');
  if ([labelOffset, col1Offset, col2Offset, col3Offset].some((o) => o < 0)) {
    warnings.push({
      field: 'options.productName',
      message: 'Could not calibrate column positions for the "Name" row.',
    });
    return [null, null, null];
  }
  const refs = { label: labelOffset, col1: col1Offset, col2: col2Offset, col3: col3Offset };
  const nearestRef = (offset) =>
    Object.entries(refs).reduce((best, [key, val]) =>
      Math.abs(offset - val) < Math.abs(offset - refs[best]) ? key : best
    , 'label');

  // The Name row's cells span from just above "Name" down to (not
  // including) the first line that carries the Annual Takaful
  // Contribution currency amounts - that value row prints on its own
  // unlabeled line before the "Annual Takaful" text label does.
  const start = Math.min(headerIdx, nameIdx - 1) + 1;
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (/RM\s*[\d,]+\.\d{2}/.test(lines[i])) {
      end = i;
      break;
    }
  }

  const buckets = { col1: [], col2: [], col3: [] };
  for (let i = start; i < end; i++) {
    for (const chunk of splitColumnsWithOffsets(lines[i])) {
      const bucket = nearestRef(chunk.offset);
      if (buckets[bucket]) buckets[bucket].push(chunk.text);
    }
  }

  const names = [buckets.col1, buckets.col2, buckets.col3].map(
    (p) => p.join(' ').replace(/\s+/g, ' ').trim() || null
  );
  warnings.push({
    field: 'options.productName',
    message: `Product names reconstructed from wrapped/shared table cells (lower confidence): ${JSON.stringify(names)}. Verify against the source PDF.`,
  });
  return names;
}

function extractCoverageTerm(lines, warnings) {
  const matches = Array.from(new Set((lines.join('\n').match(/Until age \d+/gi) || [])));
  if (!matches.length) {
    warnings.push({ field: 'options.coverageTerm', message: 'Could not locate "Until age N" wording in the Options table.' });
    return { coverageTerm: null, coverageTermAgesFound: [] };
  }
  if (matches.length > 1) {
    warnings.push({
      field: 'options.coverageTerm',
      message: `Options table shows more than one distinct coverage-term value: ${matches.join(', ')}. Using the first.`,
    });
  }
  return { coverageTerm: matches[0], coverageTermAgesFound: matches };
}

function extractOptions(doc) {
  const warnings = [];
  const section = getSectionLines(doc, /Product Options Table/i, PAGE_FOOTER_ANCHOR);

  if (section.startIndex === -1) {
    warnings.push({ field: 'options', message: 'Could not locate the "Product Options Table" section.' });
    return { columns: [], coverageTerm: null, coverageTermAgesFound: [], _warnings: warnings };
  }

  const lines = section.lines;

  const productNames = extractProductNames(lines, warnings);
  const [c1Contribution, c2Contribution, c3Contribution] = extractRow(
    lines,
    warnings,
    'annualContribution',
    ['Annual Takaful'],
    { window: 2 }
  );
  const [c1Type, c2Type, c3Type] = extractRow(lines, warnings, 'facilityType', ['Cashless facility'], { window: 0 });
  const [c1CoPay, c2CoPay, c3CoPay] = extractRow(lines, warnings, 'coPaymentOption', ['Co-payment Option'], { window: 0 });
  const [c1Room, c2Room, c3Room] = extractRow(lines, warnings, 'roomAndBoard', ['Hospital Daily Room'], { window: 2 });
  const [c1Hosp, c2Hosp, c3Hosp] = extractRow(
    lines,
    warnings,
    'hospitalTreatment',
    ['Hospitalisation Treatment'],
    { window: 2 }
  );
  const [c1AnnualLimit, c2AnnualLimit, c3AnnualLimit] = extractRow(lines, warnings, 'annualLimitOption', ['Annual Limit'], {
    window: 0,
  });
  const [c1LifetimeLimit, c2LifetimeLimit, c3LifetimeLimit] = extractRow(
    lines,
    warnings,
    'lifetimeLimitOption',
    ['Lifetime Limit'],
    { window: 0 }
  );
  const { coverageTerm, coverageTermAgesFound } = extractCoverageTerm(lines, warnings);

  const columns = [0, 1, 2].map((i) => ({
    optionLabel: OPTION_LABELS[i],
    productName: productNames[i],
    annualContribution: parseCurrency([c1Contribution, c2Contribution, c3Contribution][i]),
    facilityType: [c1Type, c2Type, c3Type][i],
    coPaymentOption: [c1CoPay, c2CoPay, c3CoPay][i],
    roomAndBoard: [c1Room, c2Room, c3Room][i],
    hospitalTreatment: [c1Hosp, c2Hosp, c3Hosp][i],
    annualLimitOption: [c1AnnualLimit, c2AnnualLimit, c3AnnualLimit][i],
    lifetimeLimitOption: [c1LifetimeLimit, c2LifetimeLimit, c3LifetimeLimit][i],
  }));

  return { columns, coverageTerm, coverageTermAgesFound, _warnings: warnings };
}

module.exports = { extractOptions };
