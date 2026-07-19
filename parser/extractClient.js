/**
 * extractClient.js
 *
 * Source section: the cover page's "Specially prepared for: <Name>" line
 * (cross-checked against the repeating page header "Quotation for <Name>"),
 * plus the "Details / Person to be Covered" table, bounded until the
 * "Product Description:" heading.
 *
 * Note: the "PRUDENTIAL BSN TAKAFUL BERHAD / Quotation Details for ..."
 * heading above that table is baked into a letterhead image in the PDF,
 * not real text, so it cannot be used as an anchor - "Person to be
 * Covered" (the table's own column header) is used instead.
 *
 * Extraction method: anchor-label. Every field in the bounded block is a
 * clean single-line "Label : Value" pair (confirmed against the sample
 * PDF), located by literal label text; regex is used only to clean the
 * trailing value (e.g. pull the leading integer out of "26 next birthday").
 *
 * Expected output:
 *   { fullName, gender, smokerStatus, occupationClass, ageNextBirthday,
 *     dateOfBirth, businessProposal, takafulPlanPurpose, _warnings }
 */

'use strict';

const {
  findAnchorIndexInDoc,
  getSectionLines,
  getValueAfterColon,
  findRepeatingHeader,
  parseIntSafe,
  parseDateDMY,
} = require('./lineUtils');

function extractClient(doc) {
  const warnings = [];

  // --- fullName: cover page is primary, repeating header is cross-check ---
  let fullName = null;
  const preparedForIdx = findAnchorIndexInDoc(doc, /^Specially prepared for:?/i);
  if (preparedForIdx !== -1) {
    const next = doc.allLines[preparedForIdx + 1];
    fullName = next && next.text.trim() ? next.text.trim() : null;
  }

  const header = findRepeatingHeader(doc);
  if (!fullName && header) {
    fullName = header.clientName;
  } else if (fullName && header && header.clientName && header.clientName !== fullName) {
    warnings.push({
      field: 'client.fullName',
      message: `Cover page name "${fullName}" differs from running page header name "${header.clientName}".`,
    });
  }
  if (!fullName) {
    warnings.push({
      field: 'client.fullName',
      message: 'Could not locate client name on the cover page or the repeating page header.',
    });
  }

  // --- bounded "Details / Person to be Covered" block ---
  const section = getSectionLines(doc, /Person to be Covered/i, /Product Description:/i);
  if (section.startIndex === -1) {
    warnings.push({
      field: 'client',
      message: 'Could not locate the "Person to be Covered" section; demographic fields unavailable.',
    });
    return {
      fullName,
      gender: null,
      smokerStatus: null,
      occupationClass: null,
      ageNextBirthday: null,
      dateOfBirth: null,
      businessProposal: null,
      takafulPlanPurpose: null,
      _warnings: warnings,
    };
  }

  const fieldFromLabel = (label) => {
    const line = section.lines.find((l) => l.includes(label));
    return line ? getValueAfterColon(line, label) : null;
  };

  const gender = fieldFromLabel('Gender');
  const smokerStatus = fieldFromLabel('Smoker');
  const occupationClass = fieldFromLabel('Occupation');
  const ageRaw = fieldFromLabel('Age');
  const dobRaw = fieldFromLabel('Date of birth');
  const businessProposalRaw = fieldFromLabel('Business Proposal');
  const takafulPlanPurpose = fieldFromLabel('Takaful Plan Purpose');

  [
    ['gender', 'Gender', gender],
    ['smokerStatus', 'Smoker', smokerStatus],
    ['occupationClass', 'Occupation', occupationClass],
    ['ageNextBirthday', 'Age', ageRaw],
    ['dateOfBirth', 'Date of birth', dobRaw],
  ].forEach(([key, label, value]) => {
    if (!value) {
      warnings.push({
        field: `client.${key}`,
        message: `Could not locate "${label}" in the Quotation Details block.`,
      });
    }
  });

  return {
    fullName,
    gender,
    smokerStatus,
    occupationClass,
    ageNextBirthday: parseIntSafe(ageRaw),
    dateOfBirth: dobRaw ? parseDateDMY(dobRaw) : null,
    businessProposal: businessProposalRaw ? /^yes$/i.test(businessProposalRaw) : null,
    takafulPlanPurpose,
    _warnings: warnings,
  };
}

module.exports = { extractClient };
