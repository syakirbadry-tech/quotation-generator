/**
 * extractProjection.js
 *
 * Source section: "Takaful Contribution Projection Table for Medical
 * Plan(s)" (Step 3 of the Medic TotalCare Product Disclosure Sheet),
 * bounded until "The projection above is solely for illustration...".
 *
 * Extraction method: anchor-label for the section boundary and the two
 * inflation-assumption percentages in the column headers; each data row
 * is located by a structural rule rather than a text label (there isn't
 * one per row - only "Age" as a column header) - a row is any line whose
 * first whitespace-separated column is a bare integer, per
 * lineUtils.splitColumns. The client's own current-age row omits the
 * projected columns and has decorative sidebar text ("(b) A lower
 * Hospital Daily Room & Board...") bleeding onto the same line from an
 * adjacent callout box; only numeric-looking trailing columns are kept.
 *
 * Expected output:
 *   { projectionRows: [{ age, currentContribution, projected7pct,
 *       projected10pct }], medicalInflationAssumptionLow,
 *     medicalInflationAssumptionHigh, _warnings }
 */

'use strict';

const { getSectionLines, splitColumns, parseCurrency } = require('./lineUtils');

function looksNumeric(str) {
  return /^[\d,]+(\.\d+)?$/.test(str.trim());
}

function extractProjection(doc) {
  const warnings = [];
  const section = getSectionLines(
    doc,
    /Takaful Contribution Projection Table/i,
    /The projection above is solely for illustration/i
  );

  if (section.startIndex === -1) {
    warnings.push({
      field: 'projection',
      message: 'Could not locate the "Takaful Contribution Projection Table" section.',
    });
    return {
      projectionRows: [],
      medicalInflationAssumptionLow: null,
      medicalInflationAssumptionHigh: null,
      _warnings: warnings,
    };
  }

  const lines = section.lines;

  const headerLine = lines.find((l) => /per annum/i.test(l));
  let medicalInflationAssumptionLow = null;
  let medicalInflationAssumptionHigh = null;
  if (headerLine) {
    const pcts = headerLine.match(/(\d+(\.\d+)?)\s*%/g) || [];
    if (pcts[0] != null) medicalInflationAssumptionLow = parseFloat(pcts[0]);
    if (pcts[1] != null) medicalInflationAssumptionHigh = parseFloat(pcts[1]);
  }
  if (medicalInflationAssumptionLow == null || medicalInflationAssumptionHigh == null) {
    warnings.push({
      field: 'projection.medicalInflationAssumption',
      message: 'Could not locate both medical inflation assumption percentages.',
    });
  }

  const projectionRows = [];
  for (const line of lines) {
    const cols = splitColumns(line);
    if (!cols.length || !/^\d{1,3}$/.test(cols[0])) continue; // not a data row
    const age = parseInt(cols[0], 10);
    const currentContribution = cols[1] && looksNumeric(cols[1]) ? parseCurrency(cols[1]) : null;
    const projected7pct = cols[2] && looksNumeric(cols[2]) ? parseCurrency(cols[2]) : null;
    const projected10pct = cols[3] && looksNumeric(cols[3]) ? parseCurrency(cols[3]) : null;
    projectionRows.push({ age, currentContribution, projected7pct, projected10pct });
  }

  if (!projectionRows.length) {
    warnings.push({ field: 'projection.projectionRows', message: 'Found the section but no data rows parsed from it.' });
  }

  return {
    projectionRows,
    medicalInflationAssumptionLow,
    medicalInflationAssumptionHigh,
    _warnings: warnings,
  };
}

module.exports = { extractProjection };
