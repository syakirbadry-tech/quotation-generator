/**
 * extractAgent.js
 *
 * Source section: the repeating page footer "Presented by : <NAME> <CODE>"
 * (fallback: cover page "Prepared by: <NAME>", which has no code).
 *
 * Extraction method: anchor-label, then regex used only to clean/split the
 * trailing alphanumeric agent code off the name on the same line.
 *
 * Expected output: { agentNameOnDocument, agentCode, _warnings }
 *
 * IMPORTANT: this extractor deliberately stops at agentCode. Dealership /
 * agency / branch / phone / WhatsApp / email / logo / photo are NOT
 * extracted here - the renderer resolves those from the AGENTS config
 * (agents.js) using agentCode as the key. This keeps the parser honest:
 * it never fabricates or hardcodes business details that aren't actually
 * printed in the source PDF, and adding a new agent is a config change,
 * not a parser change.
 */

'use strict';

const { findAnchorIndexInDoc, getValueAfterColon } = require('./lineUtils');

function extractAgent(doc) {
  const warnings = [];

  let raw = null;
  const presentedIdx = findAnchorIndexInDoc(doc, /^Presented by\s*:/i);
  if (presentedIdx !== -1) {
    raw = getValueAfterColon(doc.allLines[presentedIdx].text, 'Presented by');
  } else {
    const coverIdx = findAnchorIndexInDoc(doc, /^Prepared by:/i);
    if (coverIdx !== -1) {
      raw = getValueAfterColon(doc.allLines[coverIdx].text, 'Prepared by');
      warnings.push({
        field: 'agent',
        message: 'Used cover page "Prepared by:" as fallback; this line has no agent code.',
      });
    }
  }

  if (!raw) {
    warnings.push({
      field: 'agent',
      message: 'Could not locate "Presented by" or "Prepared by" anywhere in the document.',
    });
    return { agentNameOnDocument: null, agentCode: null, _warnings: warnings };
  }

  // Trailing agent code looks like "8LT00006": letters+digits, 6-10 chars.
  const m = raw.match(/^(.*\S)\s+([A-Z0-9]{6,10})$/);
  let agentNameOnDocument;
  let agentCode;
  if (m) {
    agentNameOnDocument = m[1].trim();
    agentCode = m[2].trim();
  } else {
    agentNameOnDocument = raw.trim();
    agentCode = null;
    warnings.push({
      field: 'agent.agentCode',
      message: `Could not separate a trailing agent code from "${raw}".`,
    });
  }

  return { agentNameOnDocument, agentCode, _warnings: warnings };
}

module.exports = { extractAgent };
