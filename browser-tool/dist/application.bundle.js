"use strict";
(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };

  // browser-tool/application/validation.js
  var require_validation = __commonJS({
    "browser-tool/application/validation.js"(exports, module) {
      "use strict";
      function required(value) {
        return value != null && String(value).trim().length > 0;
      }
      function isValidEmail(value) {
        if (!value) return false;
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());
      }
      function isValidMalaysianPhone(value) {
        if (!value) return false;
        const digits = String(value).replace(/[\s-]/g, "").replace(/^\+?60/, "0");
        return /^01\d{8,9}$/.test(digits);
      }
      function isValidNRIC(value) {
        if (!value) return false;
        const digits = String(value).replace(/[\s-]/g, "");
        return /^\d{12}$/.test(digits);
      }
      function formatNRIC(value) {
        const digits = String(value || "").replace(/[\s-]/g, "");
        if (digits.length !== 12) return value || "";
        return `${digits.slice(0, 6)}-${digits.slice(6, 8)}-${digits.slice(8, 12)}`;
      }
      function isValidPercentage(value) {
        if (value === "" || value == null) return false;
        const n = Number(value);
        return Number.isFinite(n) && n > 0 && n <= 100;
      }
      function isValidPostcode(value) {
        if (!value) return false;
        return /^\d{5}$/.test(String(value).trim());
      }
      var FIELD_RULES = {
        fullName: { required: true, message: "Full name is required." },
        nric: { required: true, validate: isValidNRIC, message: "Enter a valid NRIC (e.g. 900101-01-1234)." },
        dateOfBirth: { required: true, message: "Date of birth is required." },
        gender: { required: true, message: "Please select a gender." },
        mobileNumber: { required: true, validate: isValidMalaysianPhone, message: "Enter a valid Malaysian mobile number (e.g. 012-3456789)." },
        email: { required: true, validate: isValidEmail, message: "Enter a valid email address." },
        address: { required: true, message: "Address is required." },
        postcode: { required: true, validate: isValidPostcode, message: "Enter a valid 5-digit postcode." },
        city: { required: true, message: "City is required." },
        state: { required: true, message: "Please select a state." },
        occupation: { required: true, message: "Occupation is required." },
        employer: { required: false, message: "" },
        annualIncome: { required: true, validate: (v) => Number.isFinite(Number(v)) && Number(v) > 0, message: "Enter a valid annual income." },
        beneficiaryName: { required: true, message: "Beneficiary name is required." },
        beneficiaryRelationship: { required: true, message: "Beneficiary relationship is required." },
        beneficiaryPercentage: { required: true, validate: isValidPercentage, message: "Enter a percentage between 1 and 100." }
      };
      function validateField(name, value) {
        const rule = FIELD_RULES[name];
        if (!rule) return null;
        if (rule.required && !required(value)) return rule.message;
        if (required(value) && rule.validate && !rule.validate(value)) return rule.message;
        return null;
      }
      function validateFields(names, values) {
        const errors = {};
        for (const name of names) {
          const msg = validateField(name, values[name]);
          if (msg) errors[name] = msg;
        }
        return errors;
      }
      var PruBSNValidation = {
        required,
        isValidEmail,
        isValidMalaysianPhone,
        isValidNRIC,
        formatNRIC,
        isValidPercentage,
        isValidPostcode,
        validateField,
        validateFields,
        FIELD_RULES
      };
      if (typeof module !== "undefined" && module.exports) {
        module.exports = PruBSNValidation;
      }
    }
  });

  // browser-tool/application/ApplicationForm.js
  var require_ApplicationForm = __commonJS({
    "browser-tool/application/ApplicationForm.js"(exports, module) {
      "use strict";
      var { validateFields } = require_validation();
      function escapeHtml(value) {
        return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
      }
      var MALAYSIAN_STATES = [
        "Johor",
        "Kedah",
        "Kelantan",
        "Melaka",
        "Negeri Sembilan",
        "Pahang",
        "Perak",
        "Perlis",
        "Pulau Pinang",
        "Sabah",
        "Sarawak",
        "Selangor",
        "Terengganu",
        "Wilayah Persekutuan Kuala Lumpur",
        "Wilayah Persekutuan Labuan",
        "Wilayah Persekutuan Putrajaya"
      ];
      var STEP_DEFS = [
        {
          id: "personal",
          title: "Personal Information",
          subtitle: "Tell us a little about yourself.",
          fields: [
            { name: "fullName", label: "Full Name", type: "text", autocomplete: "name" },
            { name: "nric", label: "NRIC", type: "text", placeholder: "900101-01-1234" },
            { name: "dateOfBirth", label: "Date of Birth", type: "date" },
            { name: "gender", label: "Gender", type: "select", options: ["Male", "Female"] },
            { name: "mobileNumber", label: "Mobile Number", type: "tel", placeholder: "012-3456789" },
            { name: "email", label: "Email", type: "email", placeholder: "name@example.com" }
          ]
        },
        {
          id: "address",
          title: "Address",
          subtitle: "Where can we reach you by post?",
          fields: [
            { name: "address", label: "Address", type: "textarea" },
            { name: "postcode", label: "Postcode", type: "text", placeholder: "05100" },
            { name: "city", label: "City", type: "text" },
            { name: "state", label: "State", type: "select", options: MALAYSIAN_STATES }
          ]
        },
        {
          id: "employment",
          title: "Employment",
          subtitle: "A few details about your work.",
          fields: [
            { name: "occupation", label: "Occupation", type: "text" },
            { name: "employer", label: "Employer", type: "text", optional: true },
            { name: "annualIncome", label: "Annual Income (RM)", type: "number", placeholder: "60000" }
          ]
        },
        {
          id: "beneficiary",
          title: "Beneficiary",
          subtitle: "Who should receive the benefit payout?",
          fields: [
            { name: "beneficiaryName", label: "Beneficiary Name", type: "text" },
            { name: "beneficiaryRelationship", label: "Relationship", type: "text", placeholder: "e.g. Spouse, Child, Parent" },
            { name: "beneficiaryPercentage", label: "Percentage (%)", type: "number", placeholder: "100" }
          ]
        }
      ];
      var TOTAL_STEPS = STEP_DEFS.length;
      function stepFieldNames(stepIndex) {
        const step = STEP_DEFS[stepIndex];
        return step ? step.fields.map((f) => f.name) : [];
      }
      function fieldHtml(field, value, error) {
        const id = `paf-field-${field.name}`;
        const errorId = `${id}-error`;
        const commonAttrs = `id="${id}" name="${field.name}" class="paf-input${error ? " paf-input-error" : ""}"` + (field.autocomplete ? ` autocomplete="${field.autocomplete}"` : "") + (error ? ` aria-invalid="true" aria-describedby="${errorId}"` : "");
        let control;
        if (field.type === "select") {
          const options = field.options.map((opt) => `<option value="${escapeHtml(opt)}"${value === opt ? " selected" : ""}>${escapeHtml(opt)}</option>`).join("");
          control = `<select ${commonAttrs}><option value="">Select...</option>${options}</select>`;
        } else if (field.type === "textarea") {
          control = `<textarea ${commonAttrs} rows="3" placeholder="${escapeHtml(field.placeholder || "")}">${escapeHtml(value)}</textarea>`;
        } else {
          control = `<input type="${field.type}" ${commonAttrs} value="${escapeHtml(value)}" placeholder="${escapeHtml(field.placeholder || "")}">`;
        }
        return `
    <div class="paf-field">
      <label class="paf-label" for="${id}">${escapeHtml(field.label)}${field.optional ? ' <span class="paf-optional">(optional)</span>' : ""}</label>
      ${control}
      ${error ? `<div class="paf-error" id="${errorId}">${escapeHtml(error)}</div>` : ""}
    </div>`;
      }
      function renderStepHtml(stepIndex, values, errors) {
        const step = STEP_DEFS[stepIndex];
        if (!step) return "";
        const fieldsHtml = step.fields.map((f) => fieldHtml(f, values[f.name] || "", (errors || {})[f.name])).join("");
        return `
    <div class="paf-step" data-step-id="${step.id}">
      <h3 class="paf-step-title">${escapeHtml(step.title)}</h3>
      <p class="paf-step-subtitle">${escapeHtml(step.subtitle)}</p>
      <div class="paf-fields">${fieldsHtml}</div>
    </div>`;
      }
      function collectStepValues(stepIndex, containerEl) {
        const names = stepFieldNames(stepIndex);
        const values = {};
        for (const name of names) {
          const el = containerEl.querySelector(`[name="${name}"]`);
          values[name] = el ? el.value : "";
        }
        return values;
      }
      function validateStep(stepIndex, values) {
        return validateFields(stepFieldNames(stepIndex), values);
      }
      var PruBSNApplicationForm = {
        STEP_DEFS,
        TOTAL_STEPS,
        MALAYSIAN_STATES,
        stepFieldNames,
        renderStepHtml,
        collectStepValues,
        validateStep
      };
      if (typeof module !== "undefined" && module.exports) {
        module.exports = PruBSNApplicationForm;
      }
    }
  });

  // browser-tool/application/ReviewPage.js
  var require_ReviewPage = __commonJS({
    "browser-tool/application/ReviewPage.js"(exports, module) {
      "use strict";
      var { STEP_DEFS } = require_ApplicationForm();
      function escapeHtml(value) {
        return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
      }
      function na(value) {
        return value == null || String(value).trim() === "" ? '<span class="paf-na">Not provided</span>' : escapeHtml(value);
      }
      function summaryRow(label, value) {
        return `<div class="paf-summary-row"><span class="paf-summary-label">${escapeHtml(label)}</span><span class="paf-summary-value">${value}</span></div>`;
      }
      function renderQuotationSummary(quotation) {
        const q = quotation || {};
        const riders = Array.isArray(q.riders) && q.riders.length ? `<ul class="paf-rider-list">${q.riders.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>` : '<span class="paf-na">None selected</span>';
        return `
    <section class="paf-review-section">
      <h4 class="paf-review-heading">Quotation Summary</h4>
      ${summaryRow("Quotation Number", na(q.quotationNumber))}
      ${summaryRow("Valid Until", na(q.validUntil))}
      ${summaryRow("Selected Plan", na(q.planName))}
      ${summaryRow("Monthly Contribution", na(q.monthlyContribution))}
      <div class="paf-summary-row paf-summary-row-block">
        <span class="paf-summary-label">Optional Riders</span>
        <div class="paf-summary-value">${riders}</div>
      </div>
    </section>`;
      }
      function renderAgentInfo(agent) {
        const a = agent || {};
        return `
    <section class="paf-review-section">
      <h4 class="paf-review-heading">Agent Information <span class="paf-readonly-tag">Read-only</span></h4>
      ${summaryRow("Agent Name", na(a.name))}
      ${summaryRow("Agency", na(a.agency))}
      ${summaryRow("Branch", na(a.branch))}
      ${summaryRow("Contact", na(a.phone || a.email))}
    </section>`;
      }
      function renderReviewHtml(prefillData, formValues) {
        const data = prefillData || {};
        const values = formValues || {};
        const clientSections = STEP_DEFS.map((step, stepIndex) => {
          const rows = step.fields.map((f) => summaryRow(f.label, na(values[f.name]))).join("");
          return `
      <section class="paf-review-section">
        <h4 class="paf-review-heading">
          ${escapeHtml(step.title)}
          <button type="button" class="paf-edit-link" data-goto-step="${stepIndex}">Edit</button>
        </h4>
        ${rows}
      </section>`;
        }).join("");
        return `
    <div class="paf-step paf-review" data-step-id="review">
      <h3 class="paf-step-title">Review Your Application</h3>
      <p class="paf-step-subtitle">Please check everything below before submitting. You can edit any section.</p>
      ${renderQuotationSummary(data.quotation)}
      ${renderAgentInfo(data.agent)}
      ${clientSections}
    </div>`;
      }
      var PruBSNReviewPage = { renderReviewHtml };
      if (typeof module !== "undefined" && module.exports) {
        module.exports = PruBSNReviewPage;
      }
    }
  });

  // browser-tool/application/ConfirmationPage.js
  var require_ConfirmationPage = __commonJS({
    "browser-tool/application/ConfirmationPage.js"(exports, module) {
      "use strict";
      function escapeHtml(value) {
        return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
      }
      function na(value) {
        return value == null || String(value).trim() === "" ? '<span class="paf-na">Not available</span>' : escapeHtml(value);
      }
      function summaryRow(label, value) {
        return `<div class="paf-summary-row"><span class="paf-summary-label">${escapeHtml(label)}</span><span class="paf-summary-value">${value}</span></div>`;
      }
      var ERROR_MESSAGES = {
        validation: "There was a problem with your application details.",
        timeout: "The connection timed out before a response was received.",
        network: "We couldn't reach the server. Please check your internet connection.",
        not_configured: "Submission is not available right now. Please contact your agent.",
        http_error: "The server rejected the submission.",
        server: "The submission service was unavailable.",
        unknown: "Something went wrong while submitting your application."
      };
      function friendlyErrorMessage(error) {
        const type = error && error.type;
        return type && ERROR_MESSAGES[type] || ERROR_MESSAGES.unknown;
      }
      function renderPending() {
        return `
    <div class="paf-step paf-confirmation" data-step-id="confirmation">
      <div class="paf-confirm-icon" aria-hidden="true">&#8943;</div>
      <h3 class="paf-step-title">Submitting Your Application&hellip;</h3>
      <p class="paf-step-subtitle">Please wait a moment. Do not close this window.</p>
    </div>`;
      }
      function renderSuccess(view) {
        const submittedAt = view.submittedAt ? new Date(view.submittedAt).toLocaleString() : null;
        return `
    <div class="paf-step paf-confirmation" data-step-id="confirmation">
      <div class="paf-confirm-icon" aria-hidden="true">&#10003;</div>
      <h3 class="paf-step-title">Application Submitted</h3>
      <p class="paf-step-subtitle">Thank you. Your application has been received.</p>
      <div class="paf-review-section">
        ${summaryRow("Reference Number", na(view.reference))}
        ${summaryRow("Submission Time", submittedAt ? escapeHtml(submittedAt) : na(null))}
        ${summaryRow("Submission Status", "Confirmed")}
        ${summaryRow("Agent Name", na(view.agentName))}
      </div>
      <p class="paf-confirm-note">Your agent will follow up to complete processing of this application.</p>
    </div>`;
      }
      function renderFailed(view) {
        return `
    <div class="paf-step paf-confirmation" data-step-id="confirmation">
      <div class="paf-confirm-icon" aria-hidden="true">&#10007;</div>
      <h3 class="paf-step-title">Submission Failed</h3>
      <p class="paf-step-subtitle">${escapeHtml(friendlyErrorMessage(view.error))}</p>
      <p class="paf-confirm-note">Your details have been saved on this device. Retrying will not ask you to fill in the form again.</p>
      <div class="paf-nav">
        <span></span>
        <button type="button" class="paf-btn paf-btn-primary" data-action="retry">Retry Submission</button>
      </div>
    </div>`;
      }
      function renderConfirmationHtml(view) {
        const v = view || {};
        if (v.status === "success") return renderSuccess(v);
        if (v.status === "failed") return renderFailed(v);
        return renderPending();
      }
      var PruBSNConfirmationPage = { renderConfirmationHtml };
      if (typeof module !== "undefined" && module.exports) {
        module.exports = PruBSNConfirmationPage;
      }
    }
  });

  // browser-tool/application/submission.js
  var require_submission = __commonJS({
    "browser-tool/application/submission.js"(exports, module) {
      "use strict";
      function buildSubmission(prefillData, formState) {
        const quotation = prefillData && prefillData.quotation || {};
        const client = {
          fullName: formState.fullName || "",
          nric: formState.nric || "",
          dateOfBirth: formState.dateOfBirth || "",
          gender: formState.gender || "",
          mobileNumber: formState.mobileNumber || "",
          email: formState.email || ""
        };
        const application = {
          address: formState.address || "",
          postcode: formState.postcode || "",
          city: formState.city || "",
          state: formState.state || "",
          occupation: formState.occupation || "",
          employer: formState.employer || "",
          annualIncome: formState.annualIncome || "",
          beneficiary: {
            name: formState.beneficiaryName || "",
            relationship: formState.beneficiaryRelationship || "",
            percentage: formState.beneficiaryPercentage || ""
          }
        };
        return {
          quotation,
          client,
          application,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        };
      }
      var PruBSNSubmission = { buildSubmission };
      if (typeof module !== "undefined" && module.exports) {
        module.exports = PruBSNSubmission;
      }
    }
  });

  // browser-tool/models/SubmissionPayload.js
  var require_SubmissionPayload = __commonJS({
    "browser-tool/models/SubmissionPayload.js"(exports, module) {
      "use strict";
      var { buildSubmission } = require_submission();
      var PARSER_VERSION = "v1.0-phase1-parser";
      var RENDERER_VERSION = "v1.1-phase2-renderer";
      var PAYLOAD_VERSION = "1.0";
      var SUBMISSION_SOURCE = "quotation-generator-client-application";
      function buildAgentInfo(prefillData) {
        const source = prefillData && prefillData.agent || {};
        const agent = {};
        if (source.name) agent.name = source.name;
        if (source.agency) agent.agency = source.agency;
        if (source.branch) agent.branch = source.branch;
        return agent;
      }
      function buildSubmissionPayload(prefillData, formState, options) {
        const { submissionId } = options || {};
        const legacy = buildSubmission(prefillData, formState);
        const { beneficiary, ...applicationRest } = legacy.application;
        const applicant = {
          ...legacy.client,
          ...applicationRest
        };
        const beneficiaries = beneficiary && beneficiary.name ? [beneficiary] : [];
        const generatedMeta = prefillData && prefillData.metadata || {};
        return {
          version: PAYLOAD_VERSION,
          quotation: legacy.quotation,
          agent: buildAgentInfo(prefillData),
          applicant,
          beneficiaries,
          metadata: {
            submissionId: submissionId || null,
            quotationId: legacy.quotation && legacy.quotation.quotationNumber || null,
            parserVersion: PARSER_VERSION,
            rendererVersion: RENDERER_VERSION,
            generatedAt: generatedMeta.generatedAt || null,
            submittedAt: (/* @__PURE__ */ new Date()).toISOString(),
            product: legacy.quotation && legacy.quotation.planName || null,
            source: SUBMISSION_SOURCE
          }
        };
      }
      var PruBSNSubmissionPayload = { buildSubmissionPayload, PARSER_VERSION, RENDERER_VERSION, PAYLOAD_VERSION };
      if (typeof module !== "undefined" && module.exports) {
        module.exports = PruBSNSubmissionPayload;
      }
    }
  });

  // browser-tool/queue/SubmissionQueue.js
  var require_SubmissionQueue = __commonJS({
    "browser-tool/queue/SubmissionQueue.js"(exports, module) {
      "use strict";
      var STORAGE_KEY = "prubsn_submission_queue_v1";
      function hasWorkingLocalStorage() {
        try {
          if (typeof localStorage === "undefined") return false;
          const probeKey = `${STORAGE_KEY}_probe`;
          localStorage.setItem(probeKey, "1");
          localStorage.removeItem(probeKey);
          return true;
        } catch (e) {
          return false;
        }
      }
      function createQueue() {
        const persistent = hasWorkingLocalStorage();
        let memoryEntries = [];
        if (!persistent && typeof console !== "undefined") {
          console.warn("SubmissionQueue: localStorage is unavailable in this context; falling back to in-memory-only queue (entries will not survive a page reload).");
        }
        function readAll() {
          if (!persistent) return memoryEntries;
          try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
          } catch (e) {
            return [];
          }
        }
        function writeAll(entries) {
          if (!persistent) {
            memoryEntries = entries;
            return;
          }
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
          } catch (e) {
          }
        }
        function enqueue(submissionId, payload, error) {
          const entries = readAll();
          const existing = entries.find((e) => e.submissionId === submissionId);
          const now = (/* @__PURE__ */ new Date()).toISOString();
          if (existing) {
            existing.payload = payload;
            existing.lastError = error || null;
            existing.attempts += 1;
            existing.updatedAt = now;
          } else {
            entries.push({
              submissionId,
              payload,
              resolved: false,
              attempts: 1,
              lastError: error || null,
              createdAt: now,
              updatedAt: now
            });
          }
          writeAll(entries);
        }
        function markResolved(submissionId, reference) {
          const entries = readAll();
          const existing = entries.find((e) => e.submissionId === submissionId);
          const now = (/* @__PURE__ */ new Date()).toISOString();
          if (existing) {
            existing.resolved = true;
            existing.reference = reference || null;
            existing.updatedAt = now;
          } else {
            entries.push({
              submissionId,
              payload: null,
              resolved: true,
              reference: reference || null,
              attempts: 1,
              lastError: null,
              createdAt: now,
              updatedAt: now
            });
          }
          writeAll(entries);
        }
        function hasResolved(submissionId) {
          const existing = readAll().find((e) => e.submissionId === submissionId);
          return Boolean(existing && existing.resolved);
        }
        function getReference(submissionId) {
          const existing = readAll().find((e) => e.submissionId === submissionId);
          return existing && existing.resolved ? existing.reference : null;
        }
        function listPending() {
          return readAll().filter((e) => !e.resolved);
        }
        function isPersistent() {
          return persistent;
        }
        return { enqueue, markResolved, hasResolved, getReference, listPending, isPersistent };
      }
      var PruBSNSubmissionQueue = { createQueue };
      if (typeof module !== "undefined" && module.exports) {
        module.exports = PruBSNSubmissionQueue;
      }
    }
  });

  // browser-tool/services/SubmissionService.js
  var require_SubmissionService = __commonJS({
    "browser-tool/services/SubmissionService.js"(exports, module) {
      "use strict";
      var { createQueue } = require_SubmissionQueue();
      var defaultQueue = createQueue();
      function classifyError(err) {
        const type = err && err.type || "unknown";
        const message = err && err.message || "Submission failed for an unknown reason.";
        return { type, message };
      }
      function validatePayload(payload) {
        if (!payload || typeof payload !== "object") return "Payload is missing.";
        if (!payload.metadata || !payload.metadata.submissionId) return "Payload is missing metadata.submissionId.";
        if (!payload.applicant || typeof payload.applicant !== "object") return "Payload is missing applicant details.";
        if (!Array.isArray(payload.beneficiaries)) return "Payload is missing a beneficiaries array.";
        return null;
      }
      async function submit(payload, options) {
        const { destination, queue = defaultQueue } = options || {};
        if (!destination || typeof destination.send !== "function") {
          throw new Error("SubmissionService.submit: a destination with a send() function is required.");
        }
        const submissionId = payload && payload.metadata && payload.metadata.submissionId;
        const validationMessage = validatePayload(payload);
        if (validationMessage) {
          const error = { type: "validation", message: validationMessage };
          if (submissionId) queue.enqueue(submissionId, payload, error);
          return { status: "failed", submissionId: submissionId || null, error, queued: Boolean(submissionId) };
        }
        if (queue.hasResolved(submissionId)) {
          return { status: "success", submissionId, reference: queue.getReference(submissionId), deduped: true };
        }
        queue.enqueue(submissionId, payload, null);
        try {
          const result = await destination.send(payload);
          queue.markResolved(submissionId, result && result.reference);
          return { status: "success", submissionId, reference: result && result.reference };
        } catch (err) {
          const error = classifyError(err);
          queue.enqueue(submissionId, payload, error);
          return { status: "failed", submissionId, error, queued: true };
        }
      }
      function listPending(queue = defaultQueue) {
        return queue.listPending();
      }
      var SubmissionService = { submit, listPending, defaultQueue };
      if (typeof module !== "undefined" && module.exports) {
        module.exports = SubmissionService;
      }
    }
  });

  // browser-tool/destinations/AirtableDestination.js
  var require_AirtableDestination = __commonJS({
    "browser-tool/destinations/AirtableDestination.js"(exports, module) {
      "use strict";
      var webhookUrl = null;
      var DEFAULT_TIMEOUT_MS = 15e3;
      function configure(options) {
        webhookUrl = options && options.webhookUrl || null;
      }
      function createTypedError(type, message) {
        const err = new Error(message);
        err.type = type;
        return err;
      }
      function fallbackReference(payload) {
        const submissionId = payload && payload.metadata && payload.metadata.submissionId;
        return submissionId ? `AT-${String(submissionId).slice(0, 8).toUpperCase()}` : `AT-${Date.now().toString(36).toUpperCase()}`;
      }
      async function send(payload) {
        if (!webhookUrl) {
          throw createTypedError("not_configured", "AirtableDestination: webhookUrl is not set. See this file's header for setup steps.");
        }
        const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS) : null;
        let response;
        try {
          response = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: controller ? controller.signal : void 0
          });
        } catch (err) {
          if (err && err.name === "AbortError") {
            throw createTypedError("timeout", "AirtableDestination: request timed out.");
          }
          throw createTypedError("network", `AirtableDestination: network error - ${err && err.message ? err.message : err}`);
        } finally {
          if (timer) clearTimeout(timer);
        }
        if (!response.ok) {
          throw createTypedError("http_error", `AirtableDestination: webhook responded with HTTP ${response.status}`);
        }
        let body = null;
        try {
          body = await response.json();
        } catch (e) {
        }
        return { reference: body && body.reference || fallbackReference(payload) };
      }
      var AirtableDestination = { name: "airtable", send, configure };
      if (typeof module !== "undefined" && module.exports) {
        module.exports = AirtableDestination;
      }
    }
  });

  // browser-tool/application/clientRuntime.js
  var require_clientRuntime = __commonJS({
    "browser-tool/application/clientRuntime.js"(exports, module) {
      var ApplicationForm = require_ApplicationForm();
      var ReviewPage = require_ReviewPage();
      var ConfirmationPage = require_ConfirmationPage();
      var { buildSubmissionPayload } = require_SubmissionPayload();
      var SubmissionService = require_SubmissionService();
      var AirtableDestination = require_AirtableDestination();
      var REVIEW_STEP = ApplicationForm.TOTAL_STEPS;
      var CONFIRMATION_STEP = ApplicationForm.TOTAL_STEPS + 1;
      var STEP_LABELS = ApplicationForm.STEP_DEFS.map((s) => s.title).concat(["Review"]);
      var ACTIVE_DESTINATION = AirtableDestination.configure({
        webhookUrl: "https://hooks.airtable.com/workflows/v1/genericWebhook/appcA4lwc8KrLNxwM/wflQdJbGW3L2C8hoC/wtr78zDfdM03qbWWI"
      });
      function generateSubmissionId() {
        if (typeof crypto !== "undefined" && crypto.getRandomValues) {
          const bytes = crypto.getRandomValues(new Uint8Array(16));
          bytes[6] = bytes[6] & 15 | 64;
          bytes[8] = bytes[8] & 63 | 128;
          const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
          return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
        }
        return `sub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      }
      function buildInitialValues(prefillData) {
        const client = prefillData && prefillData.client || {};
        return {
          fullName: client.fullName || "",
          dateOfBirth: client.dateOfBirthIso || "",
          gender: client.gender || ""
        };
      }
      function renderProgressHtml(currentStep) {
        const items = STEP_LABELS.map((label, i) => {
          const status = i < currentStep ? "done" : i === currentStep ? "current" : "upcoming";
          return `<li class="paf-progress-item paf-progress-${status}"><span class="paf-progress-dot">${i + 1}</span><span class="paf-progress-label">${label}</span></li>`;
        }).join("");
        return `<ol class="paf-progress">${items}</ol>`;
      }
      function renderNavHtml(currentStep) {
        if (currentStep === CONFIRMATION_STEP) return "";
        const backBtn = currentStep > 0 ? '<button type="button" class="paf-btn paf-btn-secondary" data-action="back">Back</button>' : "<span></span>";
        const forwardBtn = currentStep === REVIEW_STEP ? '<button type="button" class="paf-btn paf-btn-primary" data-action="submit">Submit Application</button>' : '<button type="button" class="paf-btn paf-btn-primary" data-action="next">Next</button>';
        return `<div class="paf-nav">${backBtn}${forwardBtn}</div>`;
      }
      function initApplicationFlow(rootEl, prefillData) {
        if (!rootEl) return;
        const state = {
          currentStep: 0,
          values: buildInitialValues(prefillData),
          errors: {},
          submissionId: null,
          submissionPayload: null,
          submissionStatus: "idle",
          // 'idle' | 'pending' | 'success' | 'failed'
          submissionResult: null
          // last SubmissionService.submit() result
        };
        const continueBtn = document.getElementById("paf-continue-btn");
        const quotationCard = document.querySelector(".sheet");
        function buildConfirmationView() {
          const result = state.submissionResult;
          return {
            status: state.submissionStatus,
            reference: result && result.reference,
            submittedAt: state.submissionPayload && state.submissionPayload.metadata.submittedAt,
            agentName: prefillData && prefillData.agent && prefillData.agent.name,
            error: result && result.error
          };
        }
        function render() {
          const bodyHtml = state.currentStep < REVIEW_STEP ? ApplicationForm.renderStepHtml(state.currentStep, state.values, state.errors) : state.currentStep === REVIEW_STEP ? ReviewPage.renderReviewHtml(prefillData, state.values) : ConfirmationPage.renderConfirmationHtml(buildConfirmationView());
          rootEl.innerHTML = `
      <div class="paf-shell">
        ${state.currentStep <= REVIEW_STEP ? '<button type="button" class="paf-back-link" data-action="close">&larr; Back to quotation</button>' : ""}
        ${state.currentStep <= REVIEW_STEP ? renderProgressHtml(state.currentStep) : ""}
        <div class="paf-step-body">${bodyHtml}</div>
        ${renderNavHtml(state.currentStep)}
      </div>`;
          attachHandlers();
        }
        function goToStep(index) {
          const alreadyThere = state.currentStep === index;
          state.currentStep = index;
          render();
          if (!alreadyThere) rootEl.scrollIntoView({ block: "start", behavior: "smooth" });
        }
        function persistCurrentStepValues() {
          if (state.currentStep >= REVIEW_STEP) return;
          const container = rootEl.querySelector(".paf-step");
          if (!container) return;
          Object.assign(state.values, ApplicationForm.collectStepValues(state.currentStep, container));
        }
        function handleNext() {
          persistCurrentStepValues();
          const errors = ApplicationForm.validateStep(state.currentStep, state.values);
          if (Object.keys(errors).length > 0) {
            state.errors = errors;
            render();
            return;
          }
          state.errors = {};
          goToStep(state.currentStep + 1);
        }
        function handleBack() {
          persistCurrentStepValues();
          goToStep(Math.max(0, state.currentStep - 1));
        }
        async function handleSubmit() {
          if (state.submissionStatus === "pending") return;
          if (!state.submissionId) state.submissionId = generateSubmissionId();
          if (!state.submissionPayload) {
            state.submissionPayload = buildSubmissionPayload(prefillData, state.values, { submissionId: state.submissionId });
          }
          state.submissionStatus = "pending";
          goToStep(CONFIRMATION_STEP);
          const result = await SubmissionService.submit(state.submissionPayload, { destination: ACTIVE_DESTINATION });
          state.submissionResult = result;
          state.submissionStatus = result.status;
          render();
        }
        function handleClose() {
          persistCurrentStepValues();
          rootEl.hidden = true;
          if (quotationCard) quotationCard.hidden = false;
          if (continueBtn) continueBtn.hidden = false;
        }
        function attachHandlers() {
          rootEl.querySelectorAll("[data-action]").forEach((btn) => {
            btn.addEventListener("click", (evt) => {
              const action = evt.currentTarget.getAttribute("data-action");
              if (action === "next") handleNext();
              else if (action === "back") handleBack();
              else if (action === "submit") handleSubmit();
              else if (action === "retry") handleSubmit();
              else if (action === "close") handleClose();
            });
          });
          rootEl.querySelectorAll("[data-goto-step]").forEach((btn) => {
            btn.addEventListener("click", (evt) => {
              persistCurrentStepValues();
              goToStep(Number(evt.currentTarget.getAttribute("data-goto-step")));
            });
          });
        }
        function openFlow() {
          if (quotationCard) quotationCard.hidden = true;
          if (continueBtn) continueBtn.hidden = true;
          rootEl.hidden = false;
          render();
          rootEl.scrollIntoView({ block: "start", behavior: "smooth" });
        }
        if (continueBtn) {
          continueBtn.addEventListener("click", openFlow);
        }
      }
      if (typeof window !== "undefined") {
        window.__prubsnInitApplicationFlow = initApplicationFlow;
      }
      if (typeof module !== "undefined" && module.exports) {
        module.exports = { initApplicationFlow };
      }
    }
  });
  require_clientRuntime();
})();
