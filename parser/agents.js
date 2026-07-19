/**
 * agents.js
 *
 * Configuration, NOT extraction. The parser (extractAgent.js) only ever
 * reads the agent code printed on the PDF footer (e.g. "8LT00006"). Every
 * other agent-facing detail - agency, branch, phone, WhatsApp, email,
 * logo, photo - is looked up here, by that code, at RENDER time.
 *
 * This keeps the parser honest: it never invents or hardcodes a
 * dealership name, phone number, etc. that isn't actually printed in the
 * source PDF. It also means onboarding a second agent is a config change,
 * not a code change.
 *
 * Fields left as '' are genuinely unknown - they weren't present in any
 * source file reviewed for this build. Fill them in; never fabricate a
 * placeholder value here and pass it off as real.
 */

'use strict';

const AGENTS = {
  '8LT00006': {
    name: 'Muhammad Syakir Badri Bin Md Nizam',
    agency: 'ASG Ansar Group',
    branch: 'Asbenz Motors',
    location: 'Alor Setar, Kedah',
    phone: '',
    whatsapp: '',
    email: '',
    logo: '',
    photo: '',
  },
};

/** Returns the config for a given agent code, or null if unconfigured. */
function getAgentConfig(agentCode) {
  if (!agentCode) return null;
  return AGENTS[agentCode] || null;
}

module.exports = { AGENTS, getAgentConfig };
