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

  // browser-tool/pdfTextSource.browser.js
  var require_pdfTextSource_browser = __commonJS({
    "browser-tool/pdfTextSource.browser.js"(exports, module) {
      "use strict";
      var SPACE_WIDTH_RATIO = 0.35;
      var DEFAULT_FONT_SIZE = 10;
      var ROW_Y_TOLERANCE = 2;
      function estimateFontSize(transform) {
        const d = Math.abs(transform[3]);
        if (d > 0.01) return d;
        const magnitude = Math.hypot(transform[0], transform[1]);
        return magnitude > 0.01 ? magnitude : DEFAULT_FONT_SIZE;
      }
      function dedupeOverlappingFragments(fragments) {
        const sorted = [...fragments].sort((a, b) => a.x - b.x);
        const kept = [];
        for (const frag of sorted) {
          const prev = kept[kept.length - 1];
          const isOverlappingDuplicate = prev && prev.text === frag.text && Math.abs(prev.x - frag.x) < 1;
          if (!isOverlappingDuplicate) kept.push(frag);
        }
        return kept;
      }
      function reconstructPageText(items) {
        const rawFragments = items.filter((it) => typeof it.str === "string" && it.str.length > 0).map((it) => ({
          text: it.str,
          x: it.transform[4],
          y: it.transform[5],
          width: it.width || 0,
          fontSize: estimateFontSize(it.transform)
        }));
        const minX = rawFragments.length ? Math.min(...rawFragments.map((f) => f.x)) : 0;
        const fragments = rawFragments.map((f) => ({ ...f, x: f.x - minX }));
        const rows = [];
        for (const frag of fragments) {
          let row = rows.find((r) => Math.abs(r.y - frag.y) <= ROW_Y_TOLERANCE);
          if (!row) {
            row = { y: frag.y, items: [] };
            rows.push(row);
          }
          row.items.push(frag);
        }
        rows.sort((a, b) => b.y - a.y);
        const lines = rows.map((row) => {
          const realFragments = dedupeOverlappingFragments(row.items.filter((f) => !/^\s+$/.test(f.text)));
          realFragments.sort((a, b) => a.x - b.x);
          let line = "";
          let cursorX = null;
          for (const frag of realFragments) {
            const spaceWidth = Math.max(1, frag.fontSize * SPACE_WIDTH_RATIO);
            if (cursorX === null) {
              const leadingSpaces = Math.max(0, Math.round(frag.x / spaceWidth));
              line += " ".repeat(Math.min(leadingSpaces, 200));
            } else {
              const gap = frag.x - cursorX;
              const threshold = spaceWidth * 0.35;
              const spaces = gap >= threshold ? Math.max(1, Math.round(gap / spaceWidth)) : 0;
              line += " ".repeat(Math.min(spaces, 200));
            }
            line += frag.text;
            cursorX = frag.x + frag.width;
          }
          return line.replace(/\s+$/, "");
        });
        return lines.join("\n");
      }
      async function extractPagesFromPdf2(data) {
        if (typeof pdfjsLib === "undefined") {
          throw new Error("pdfjsLib is not loaded - vendor/pdf.min.js must be included before this module runs.");
        }
        const loadingTask = pdfjsLib.getDocument({ data, isEvalSupported: false });
        const pdf = await loadingTask.promise;
        const pages = [];
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          const textContent = await page.getTextContent();
          pages.push(reconstructPageText(textContent.items));
          page.cleanup();
        }
        await pdf.destroy();
        return pages;
      }
      var PDFTextSource = { extractPagesFromPdf: extractPagesFromPdf2, reconstructPageText };
      if (typeof module !== "undefined" && module.exports) {
        module.exports = PDFTextSource;
      }
      if (typeof window !== "undefined") {
        window.PDFTextSource = PDFTextSource;
      }
    }
  });

  // parser/lineUtils.js
  var require_lineUtils = __commonJS({
    "parser/lineUtils.js"(exports, module) {
      "use strict";
      var PAGE_FOOTER_ANCHOR = /^Presented by\s*:/i;
      function buildDocument(pages) {
        const allLines = [];
        pages.forEach((pageText, pageIndex) => {
          const lines = (pageText || "").split("\n");
          lines.forEach((text) => {
            allLines.push({ page: pageIndex + 1, text });
          });
        });
        return { pageCount: pages.length, pages, allLines };
      }
      function lineMatches(text, matcher) {
        if (matcher instanceof RegExp) return matcher.test(text);
        return text.toLowerCase().includes(String(matcher).toLowerCase());
      }
      function findAnchorIndexInDoc(doc, matcher, fromGlobalIndex = 0) {
        for (let i = fromGlobalIndex; i < doc.allLines.length; i++) {
          if (lineMatches(doc.allLines[i].text, matcher)) return i;
        }
        return -1;
      }
      function getSectionLines(doc, startMatcher, endMatcher, options = {}) {
        const { fromGlobalIndex = 0, includeStartLine = false } = options;
        const startIndex = findAnchorIndexInDoc(doc, startMatcher, fromGlobalIndex);
        if (startIndex === -1) {
          return { startIndex: -1, endIndex: -1, lines: [] };
        }
        const searchFrom = includeStartLine ? startIndex : startIndex + 1;
        let endIndex = endMatcher ? findAnchorIndexInDoc(doc, endMatcher, searchFrom) : doc.allLines.length;
        if (endIndex === -1) endIndex = doc.allLines.length;
        const lines = doc.allLines.slice(searchFrom, endIndex).map((l) => l.text);
        return { startIndex, endIndex, lines };
      }
      function getValueAfterColon(line, label) {
        if (!line) return null;
        const idx = line.indexOf(label);
        if (idx === -1) return null;
        const rest = line.slice(idx + label.length);
        const colonIdx = rest.indexOf(":");
        if (colonIdx === -1) return null;
        const value = rest.slice(colonIdx + 1);
        const stop = value.match(/\s{2,}/);
        const trimmed = stop ? value.slice(0, stop.index) : value;
        const cleaned = trimmed.trim();
        return cleaned.length ? cleaned : null;
      }
      function findNearestValue(lines, anchorIndex, options) {
        const { pattern, maxDistance = 3, direction = "after" } = options;
        const step = direction === "before" ? -1 : 1;
        for (let d = 0; d <= maxDistance; d++) {
          const idx = anchorIndex + d * step;
          if (idx < 0 || idx >= lines.length) continue;
          const m = lines[idx].match(pattern);
          if (m) return m[0].trim();
        }
        return null;
      }
      function boundedValueForLabel(blockLines, labelText, excludeLines = []) {
        const label = labelText.trim();
        const cleaned = blockLines.map((raw) => {
          const line = raw.trim();
          if (!line || excludeLines.includes(line)) return "";
          const idx = line.indexOf(label);
          if (idx === -1) return line;
          const before = line.slice(0, idx).trim();
          const after = line.slice(idx + label.length).replace(/^[,:]\s*/, "").trim();
          return [before, after].filter(Boolean).join(" ");
        }).filter((l) => l.length > 0);
        return cleaned.join(" ").replace(/\s+/g, " ").trim();
      }
      function parseCurrency(str) {
        if (str == null) return null;
        const m = String(str).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
        return m ? parseFloat(m[0]) : null;
      }
      function parseIntSafe(str) {
        if (str == null) return null;
        const m = String(str).replace(/,/g, "").match(/-?\d+/);
        return m ? parseInt(m[0], 10) : null;
      }
      function parseDateDMY(str) {
        if (!str) return null;
        const m = String(str).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (!m) return null;
        const [, dd, mm, yyyy] = m;
        const iso = `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
        return { raw: str.trim(), iso };
      }
      function splitColumns(line, minGap = 2) {
        const re = new RegExp(`\\s{${minGap},}`);
        return line.split(re).map((s) => s.trim()).filter((s) => s.length > 0);
      }
      function splitTwoColumnByHeader(doc, headerMatcher, rightLabel, endMatcher) {
        const headerIndex = findAnchorIndexInDoc(doc, headerMatcher);
        if (headerIndex === -1) return { rightColumnOffset: -1, fragments: [] };
        const headerLine = doc.allLines[headerIndex].text;
        const offset = headerLine.indexOf(rightLabel);
        if (offset === -1) return { rightColumnOffset: -1, fragments: [] };
        const endIndex = endMatcher ? findAnchorIndexInDoc(doc, endMatcher, headerIndex + 1) : doc.allLines.length;
        const bodyEnd = endIndex === -1 ? doc.allLines.length : endIndex;
        const fragments = [];
        for (let i = headerIndex + 1; i < bodyEnd; i++) {
          const line = doc.allLines[i].text;
          if (line.length <= offset) continue;
          const value = line.slice(offset).trim();
          if (value) fragments.push(value);
        }
        return { rightColumnOffset: offset, fragments };
      }
      function splitIntoClauses(text) {
        return text.split(/(?<=[a-z0-9)%])\s+(?=[A-Z][a-z])/).map((s) => s.trim()).filter(Boolean);
      }
      function splitLetteredList(blockLines) {
        const items = [];
        let current = null;
        const markerRe = /^\(([a-z]{1,2})\)\s*(.*)$/;
        for (const raw of blockLines) {
          const line = raw.trim();
          if (!line) continue;
          const m = line.match(markerRe);
          if (m) {
            if (current) items.push(current);
            current = { marker: m[1], text: m[2] };
          } else if (current) {
            current.text += " " + line;
          }
        }
        if (current) items.push(current);
        return items.map((it) => ({
          marker: it.marker,
          text: it.text.replace(/\s+/g, " ").trim()
        }));
      }
      function findRepeatingHeader(doc) {
        const idx = findAnchorIndexInDoc(doc, /^Quotation for\s+/i);
        if (idx === -1) return null;
        const clientName = doc.allLines[idx].text.replace(/^Quotation for\s+/i, "").trim();
        const productName = doc.allLines[idx + 1] ? doc.allLines[idx + 1].text.trim() : null;
        return { clientName, productName };
      }
      function getBenefitsTableBlock(doc) {
        return getSectionLines(
          doc,
          /^\s*Benefits:\s*$/,
          /The benefit\(s\) payable under eligible certificate/i
        );
      }
      module.exports = {
        PAGE_FOOTER_ANCHOR,
        buildDocument,
        findAnchorIndexInDoc,
        getSectionLines,
        getValueAfterColon,
        findNearestValue,
        boundedValueForLabel,
        parseCurrency,
        parseIntSafe,
        parseDateDMY,
        splitColumns,
        splitTwoColumnByHeader,
        splitIntoClauses,
        splitLetteredList,
        findRepeatingHeader,
        getBenefitsTableBlock
      };
    }
  });

  // parser/extractMetadata.js
  var require_extractMetadata = __commonJS({
    "parser/extractMetadata.js"(exports, module) {
      "use strict";
      var {
        findAnchorIndexInDoc,
        getValueAfterColon,
        findRepeatingHeader,
        parseDateDMY
      } = require_lineUtils();
      function addDaysIso(iso, days) {
        const d = /* @__PURE__ */ new Date(iso + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() + days);
        return d.toISOString().slice(0, 10);
      }
      function extractMetadata(doc, options = {}) {
        const warnings = [];
        const {
          sourceFileName = null,
          validityDays = 14,
          quotationNumber = null
        } = options;
        const header = findRepeatingHeader(doc);
        const productName = header ? header.productName : null;
        if (!productName) {
          warnings.push({
            field: "metadata.productName",
            message: 'Could not locate the repeating page header "Quotation for ...".'
          });
        }
        const dateIdx = findAnchorIndexInDoc(doc, /^Date\s*:/i);
        let quotationDate = null;
        if (dateIdx !== -1) {
          const raw = getValueAfterColon(doc.allLines[dateIdx].text, "Date");
          quotationDate = raw ? parseDateDMY(raw) : null;
        }
        if (!quotationDate) {
          warnings.push({
            field: "metadata.quotationDate",
            message: 'Could not locate "Date :" in the page footer.'
          });
        }
        const versionIdx = findAnchorIndexInDoc(doc, /^Version\s*:/i);
        const quotationVersion = versionIdx !== -1 ? getValueAfterColon(doc.allLines[versionIdx].text, "Version") : null;
        const symcodeIdx = findAnchorIndexInDoc(doc, /SYMCODE\s*:/i);
        const symcode = symcodeIdx !== -1 ? getValueAfterColon(doc.allLines[symcodeIdx].text, "SYMCODE") : null;
        const pageCountLine = doc.allLines.find((l) => /Page\s+\d+\s+of\s+\d+/i.test(l.text));
        const pageCountMatch = pageCountLine ? pageCountLine.text.match(/Page\s+\d+\s+of\s+(\d+)/i) : null;
        const pageCount = pageCountMatch ? parseInt(pageCountMatch[1], 10) : doc.pageCount;
        if (!pageCountMatch) {
          warnings.push({
            field: "metadata.pageCount",
            message: 'Could not locate a "Page X of Y" footer line; falling back to page array length.'
          });
        }
        const validUntilIso = quotationDate ? addDaysIso(quotationDate.iso, validityDays) : null;
        return {
          productName,
          quotationDate,
          quotationVersion,
          symcode,
          pageCount,
          sourceFileName,
          quotationNumber: {
            value: quotationNumber,
            generated: true,
            note: "Not present in source PDF - assign or edit before sending to client."
          },
          validUntil: validUntilIso ? {
            iso: validUntilIso,
            generated: true,
            basis: `quotationDate + ${validityDays} days`
          } : null,
          _warnings: warnings
        };
      }
      module.exports = { extractMetadata };
    }
  });

  // parser/extractClient.js
  var require_extractClient = __commonJS({
    "parser/extractClient.js"(exports, module) {
      "use strict";
      var {
        findAnchorIndexInDoc,
        getSectionLines,
        getValueAfterColon,
        findRepeatingHeader,
        parseIntSafe,
        parseDateDMY
      } = require_lineUtils();
      function extractClient(doc) {
        const warnings = [];
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
            field: "client.fullName",
            message: `Cover page name "${fullName}" differs from running page header name "${header.clientName}".`
          });
        }
        if (!fullName) {
          warnings.push({
            field: "client.fullName",
            message: "Could not locate client name on the cover page or the repeating page header."
          });
        }
        const section = getSectionLines(doc, /Person to be Covered/i, /Product Description:/i);
        if (section.startIndex === -1) {
          warnings.push({
            field: "client",
            message: 'Could not locate the "Person to be Covered" section; demographic fields unavailable.'
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
            _warnings: warnings
          };
        }
        const fieldFromLabel = (label) => {
          const line = section.lines.find((l) => l.includes(label));
          return line ? getValueAfterColon(line, label) : null;
        };
        const gender = fieldFromLabel("Gender");
        const smokerStatus = fieldFromLabel("Smoker");
        const occupationClass = fieldFromLabel("Occupation");
        const ageRaw = fieldFromLabel("Age");
        const dobRaw = fieldFromLabel("Date of birth");
        const businessProposalRaw = fieldFromLabel("Business Proposal");
        const takafulPlanPurpose = fieldFromLabel("Takaful Plan Purpose");
        [
          ["gender", "Gender", gender],
          ["smokerStatus", "Smoker", smokerStatus],
          ["occupationClass", "Occupation", occupationClass],
          ["ageNextBirthday", "Age", ageRaw],
          ["dateOfBirth", "Date of birth", dobRaw]
        ].forEach(([key, label, value]) => {
          if (!value) {
            warnings.push({
              field: `client.${key}`,
              message: `Could not locate "${label}" in the Quotation Details block.`
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
          _warnings: warnings
        };
      }
      module.exports = { extractClient };
    }
  });

  // parser/extractAgent.js
  var require_extractAgent = __commonJS({
    "parser/extractAgent.js"(exports, module) {
      "use strict";
      var { findAnchorIndexInDoc, getValueAfterColon } = require_lineUtils();
      function extractAgent(doc) {
        const warnings = [];
        let raw = null;
        const presentedIdx = findAnchorIndexInDoc(doc, /^Presented by\s*:/i);
        if (presentedIdx !== -1) {
          raw = getValueAfterColon(doc.allLines[presentedIdx].text, "Presented by");
        } else {
          const coverIdx = findAnchorIndexInDoc(doc, /^Prepared by:/i);
          if (coverIdx !== -1) {
            raw = getValueAfterColon(doc.allLines[coverIdx].text, "Prepared by");
            warnings.push({
              field: "agent",
              message: 'Used cover page "Prepared by:" as fallback; this line has no agent code.'
            });
          }
        }
        if (!raw) {
          warnings.push({
            field: "agent",
            message: 'Could not locate "Presented by" or "Prepared by" anywhere in the document.'
          });
          return { agentNameOnDocument: null, agentCode: null, _warnings: warnings };
        }
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
            field: "agent.agentCode",
            message: `Could not separate a trailing agent code from "${raw}".`
          });
        }
        return { agentNameOnDocument, agentCode, _warnings: warnings };
      }
      module.exports = { extractAgent };
    }
  });

  // parser/extractPlan.js
  var require_extractPlan = __commonJS({
    "parser/extractPlan.js"(exports, module) {
      "use strict";
      var {
        findAnchorIndexInDoc,
        getSectionLines,
        getValueAfterColon,
        getBenefitsTableBlock,
        parseIntSafe,
        parseCurrency
      } = require_lineUtils();
      function extractPlan(doc) {
        const warnings = [];
        const detailsSection = getSectionLines(doc, /Person to be Covered/i, /Product Description:/i);
        let typeOfProduct = null;
        let paymentMode = null;
        if (detailsSection.startIndex === -1) {
          warnings.push({
            field: "plan",
            message: 'Could not locate the "Person to be Covered" section.'
          });
        } else {
          const typeLine = detailsSection.lines.find((l) => l.includes("Type of Product"));
          typeOfProduct = typeLine ? getValueAfterColon(typeLine, "Type of Product") : null;
          const paymentLine = detailsSection.lines.find((l) => l.includes("Payment Mode"));
          paymentMode = paymentLine ? getValueAfterColon(paymentLine, "Payment Mode") : null;
          if (!typeOfProduct) {
            warnings.push({ field: "plan.typeOfProduct", message: 'Could not locate "Type of Product".' });
          }
        }
        const benefitsBlock = getBenefitsTableBlock(doc);
        let basicPlanName = null;
        let basicPlanTerm = null;
        let basicSumCovered = null;
        let medicalRiderName = null;
        let medicalRiderTerm = null;
        let medicalPlanTier = null;
        let coPaymentOption = null;
        if (benefitsBlock.startIndex === -1) {
          warnings.push({ field: "plan", message: 'Could not locate the "Benefits:" breakdown table.' });
        } else {
          const lines = benefitsBlock.lines;
          const basicLine = lines.find((l) => l.includes("PruBSN AnugerahMax (Basic)"));
          if (basicLine) {
            basicPlanName = "PruBSN AnugerahMax (Basic)";
            const numbers = basicLine.slice(basicLine.indexOf("PruBSN AnugerahMax (Basic)") + "PruBSN AnugerahMax (Basic)".length).match(/[\d,]+(\.\d+)?/g) || [];
            basicPlanTerm = numbers[0] != null ? parseIntSafe(numbers[0]) : null;
            basicSumCovered = numbers[1] != null ? parseCurrency(numbers[1]) : null;
          } else {
            warnings.push({ field: "plan.basicPlanName", message: 'Could not locate the "PruBSN AnugerahMax (Basic)" row.' });
          }
          const mtcLine = lines.find((l) => l.trim().startsWith("Medic TotalCare"));
          if (mtcLine) {
            medicalRiderName = "Medic TotalCare";
            const afterLabel = mtcLine.slice(mtcLine.indexOf("Medic TotalCare") + "Medic TotalCare".length);
            const numbers = afterLabel.match(/[\d,]+(\.\d+)?/g) || [];
            medicalRiderTerm = numbers[0] != null ? parseIntSafe(numbers[0]) : null;
          } else {
            warnings.push({ field: "plan.medicalRiderName", message: 'Could not locate the "Medic TotalCare" row.' });
          }
          const planTierLine = lines.find((l) => /\bPlan\s+\d+\b/.test(l));
          const planTierMatch = planTierLine ? planTierLine.match(/\bPlan\s+\d+\b/) : null;
          medicalPlanTier = planTierMatch ? planTierMatch[0] : null;
          if (!medicalPlanTier) {
            warnings.push({ field: "plan.medicalPlanTier", message: 'Could not locate a "Plan <N>" tier label.' });
          }
          const coPayLine = lines.find(
            (l) => /(SmartSaver[\d,]+|Deductible\s*RM?\s*[\d,]+|High Deductible\s*[\d,]+|Full Coverage)/i.test(l)
          );
          const coPayMatch = coPayLine ? coPayLine.match(/(SmartSaver[\d,]+|Deductible\s*RM?\s*[\d,]+|High Deductible\s*[\d,]+|Full Coverage)/i) : null;
          coPaymentOption = coPayMatch ? coPayMatch[0] : null;
          if (!coPaymentOption) {
            warnings.push({ field: "plan.coPaymentOption", message: "Could not locate a co-payment option value." });
          }
        }
        const untilAgeIdx = findAnchorIndexInDoc(doc, /Until age \d+/i);
        let coverageToAge = null;
        if (untilAgeIdx !== -1) {
          const m = doc.allLines[untilAgeIdx].text.match(/Until age (\d+)/i);
          coverageToAge = m ? parseInt(m[1], 10) : null;
        } else {
          warnings.push({
            field: "plan.coverageToAge",
            message: 'Could not locate "Until age N" wording; will be derived from age + term by parseQuotation.'
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
          _warnings: warnings
        };
      }
      module.exports = { extractPlan };
    }
  });

  // parser/extractContributions.js
  var require_extractContributions = __commonJS({
    "parser/extractContributions.js"(exports, module) {
      "use strict";
      var {
        findAnchorIndexInDoc,
        getSectionLines,
        getValueAfterColon,
        getBenefitsTableBlock,
        findNearestValue,
        parseCurrency
      } = require_lineUtils();
      function trailingNumber(line) {
        if (!line) return null;
        const matches = line.match(/[\d,]+(\.\d+)?/g);
        return matches && matches.length ? parseCurrency(matches[matches.length - 1]) : null;
      }
      function extractContributions(doc) {
        const warnings = [];
        const benefitsBlock = getBenefitsTableBlock(doc);
        let isaContribution = null;
        let medicTotalCareContribution = null;
        let protectionContribution = null;
        let wakalahCertificateCharge = null;
        let totalMonthlyContribution = null;
        if (benefitsBlock.startIndex === -1) {
          warnings.push({ field: "contributions", message: 'Could not locate the "Benefits:" breakdown table.' });
        } else {
          const lines = benefitsBlock.lines;
          const basicLine = lines.find((l) => l.includes("PruBSN AnugerahMax (Basic)"));
          if (basicLine) isaContribution = trailingNumber(basicLine);
          else warnings.push({ field: "contributions.isaContribution", message: "Could not locate the ISA/basic plan row." });
          const mtcLine = lines.find((l) => l.trim().startsWith("Medic TotalCare"));
          if (mtcLine) medicTotalCareContribution = trailingNumber(mtcLine);
          else warnings.push({ field: "contributions.medicTotalCareContribution", message: "Could not locate the Medic TotalCare row." });
          const protectionLine = lines.find((l) => l.includes("Protection Contribution"));
          protectionContribution = protectionLine ? trailingNumber(protectionLine) : null;
          if (protectionContribution == null) {
            warnings.push({ field: "contributions.protectionContribution", message: 'Could not locate "Protection Contribution".' });
          }
          const wakalahLine = lines.find((l) => l.includes("Wakalah Certificate Charge"));
          wakalahCertificateCharge = wakalahLine ? trailingNumber(wakalahLine) : null;
          if (wakalahCertificateCharge == null) {
            warnings.push({ field: "contributions.wakalahCertificateCharge", message: 'Could not locate "Wakalah Certificate Charge".' });
          }
          const totalLine = lines.find((l) => l.includes("Total Monthly Amount Payable"));
          totalMonthlyContribution = totalLine ? trailingNumber(totalLine) : null;
          if (totalMonthlyContribution == null) {
            warnings.push({ field: "contributions.totalMonthlyContribution", message: 'Could not locate "Total Monthly Amount Payable".' });
          }
        }
        const detailsSection = getSectionLines(doc, /Person to be Covered/i, /Product Description:/i);
        let totalAnnualContribution = null;
        if (detailsSection.startIndex !== -1) {
          const line = detailsSection.lines.find((l) => l.includes("Total Annual Contribution"));
          const raw = line ? getValueAfterColon(line, "Total Annual Contribution") : null;
          totalAnnualContribution = raw ? parseCurrency(raw) : null;
        }
        if (totalAnnualContribution == null) {
          warnings.push({ field: "contributions.totalAnnualContribution", message: 'Could not locate "Total Annual Contribution".' });
        }
        const summarySection = getSectionLines(doc, /^A\. SUMMARY/i, /^B\. MARKETING ILLUSTRATION TABLE/i);
        let totalContributionOverTerm = null;
        let totalDirectCommission = null;
        let guaranteedDeathTPDBenefit = null;
        let nonGuaranteedCashValueScenarioX = null;
        let nonGuaranteedCashValueScenarioY = null;
        if (summarySection.startIndex === -1) {
          warnings.push({ field: "contributions", message: 'Could not locate the "A. SUMMARY" section.' });
        } else {
          const lines = summarySection.lines;
          const formulaLine = lines.find((l) => /RM\s*[\d,.]+\s*X\s*\d+\s*Years?\s*=\s*RM\s*[\d,.]+/i.test(l));
          if (formulaLine) {
            const m = formulaLine.match(/=\s*RM\s*([\d,]+(\.\d+)?)/i);
            totalContributionOverTerm = m ? parseCurrency(m[1]) : null;
          } else {
            warnings.push({ field: "contributions.totalContributionOverTerm", message: 'Could not locate the "RM x X n Years = RM y" contribution formula.' });
          }
          const commissionIdx = lines.findIndex((l) => l.includes("Total direct commission"));
          if (commissionIdx !== -1) {
            const value = findNearestValue(lines, commissionIdx, { pattern: /RM\s*[\d,]+(\.\d+)?/i, maxDistance: 2, direction: "after" });
            totalDirectCommission = value ? parseCurrency(value) : null;
          } else {
            warnings.push({ field: "contributions.totalDirectCommission", message: 'Could not locate "Total direct commission".' });
          }
          const tpdIdx = lines.findIndex((l) => l.includes("If you die or suffer TPD"));
          if (tpdIdx !== -1) {
            const m = lines[tpdIdx].match(/RM\s*[\d,]+(\.\d+)?/i);
            guaranteedDeathTPDBenefit = m ? parseCurrency(m[0]) : null;
          } else {
            warnings.push({ field: "contributions.guaranteedDeathTPDBenefit", message: 'Could not locate "If you die or suffer TPD".' });
          }
          const scenarioXLine = lines.find((l) => /Scenario X\s*:\s*RM\s*[\d,]+(\.\d+)?/i.test(l));
          if (scenarioXLine) {
            const m = scenarioXLine.match(/RM\s*([\d,]+(\.\d+)?)/i);
            nonGuaranteedCashValueScenarioX = m ? parseCurrency(m[1]) : null;
          } else {
            warnings.push({ field: "contributions.nonGuaranteedCashValueScenarioX", message: 'Could not locate the "Scenario X : RM ..." non-guaranteed cash value figure.' });
          }
          const scenarioYLine = lines.find((l) => /Scenario Y\s*:\s*RM\s*[\d,]+(\.\d+)?/i.test(l));
          if (scenarioYLine) {
            const m = scenarioYLine.match(/RM\s*([\d,]+(\.\d+)?)/i);
            nonGuaranteedCashValueScenarioY = m ? parseCurrency(m[1]) : null;
          } else {
            warnings.push({ field: "contributions.nonGuaranteedCashValueScenarioY", message: 'Could not locate the "Scenario Y : RM ..." non-guaranteed cash value figure.' });
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
          _warnings: warnings
        };
      }
      module.exports = { extractContributions };
    }
  });

  // parser/extractBenefits.js
  var require_extractBenefits = __commonJS({
    "parser/extractBenefits.js"(exports, module) {
      "use strict";
      var {
        findAnchorIndexInDoc,
        getSectionLines,
        boundedValueForLabel,
        splitTwoColumnByHeader,
        splitIntoClauses,
        splitLetteredList,
        PAGE_FOOTER_ANCHOR
      } = require_lineUtils();
      var BENEFIT_LABEL_DICTIONARY = [
        { section: "IN-PATIENT CARE BENEFITS", label: "Hospital Daily Room and Board" },
        { section: "IN-PATIENT CARE BENEFITS", label: "Intensive Care Unit (ICU) / Cardiac Care Unit (CCU)" },
        { section: "IN-PATIENT CARE BENEFITS", label: "Surgical Procedure and Treatment" },
        { section: "IN-PATIENT CARE BENEFITS", label: "In Hospital and Related Services" },
        { section: "OUT-PATIENT CARE BENEFITS", label: "Day Surgery" },
        { section: "OUT-PATIENT CARE BENEFITS", label: "Home Nursing Care" },
        { section: "OUT-PATIENT CARE BENEFITS", label: "Pre-Hospitalisation Treatment" },
        { section: "OUT-PATIENT CARE BENEFITS", label: "Post-Hospitalisation Treatment" },
        { section: "OUT-PATIENT CARE BENEFITS", label: "Outpatient Dengue and Infectious Disease Treatment" },
        { section: "MAJOR ILLNESS CARE BENEFITS", label: "Outpatient Kidney Dialysis Treatment" },
        { section: "MAJOR ILLNESS CARE BENEFITS", label: "Outpatient Cancer Treatment" },
        { section: "MAJOR ILLNESS CARE BENEFITS", label: "Additional Annual Limit for" },
        { section: "MAJOR ILLNESS CARE BENEFITS", label: "Treatment Allowance for" },
        { section: "EMERGENCY CARE BENEFITS", label: "Emergency Outpatient Treatment for Accidental Injury" },
        { section: "EMERGENCY CARE BENEFITS", label: "Worldwide Emergency Medical Assistance" },
        { section: "EXTENDED CARE BENEFITS", label: "Reimbursement for Vaccination" },
        { section: "EXTENDED CARE BENEFITS", label: "Intraocular Lens" },
        { section: "EXTENDED CARE BENEFITS", label: "Government Hospital Allowance" }
      ];
      var SECTION_HEADER_LINES = BENEFIT_LABEL_DICTIONARY.reduce((set, entry) => {
        set.add(entry.section);
        return set;
      }, /* @__PURE__ */ new Set());
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
          warnings.push({ field: "benefits", message: 'Could not locate the "Table of Benefits" section.' });
          return { annualLimit: null, lifetimeLimit: null, benefitItems: [] };
        }
        const lines = block.lines;
        const annualLimitLine = lines.find((l) => l.trim().startsWith("ANNUAL LIMIT"));
        const annualLimit = annualLimitLine ? trailingTextAfterLabel(annualLimitLine, "ANNUAL LIMIT") : null;
        if (!annualLimit) warnings.push({ field: "benefits.annualLimit", message: 'Could not locate "ANNUAL LIMIT".' });
        const lifetimeLimitLine = lines.find((l) => l.trim().startsWith("LIFETIME LIMIT"));
        const lifetimeLimit = lifetimeLimitLine ? trailingTextAfterLabel(lifetimeLimitLine, "LIFETIME LIMIT") : null;
        if (!lifetimeLimit) warnings.push({ field: "benefits.lifetimeLimit", message: 'Could not locate "LIFETIME LIMIT".' });
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
              message: `No explicit value found for "${label}" (got "${value || ""}"). This may be a merged table cell shared with an adjacent row - verify against the source PDF.`
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
          "What is not covered?",
          /This is not a complete list/i
        );
        if (!fragments.length) {
          warnings.push({
            field: "benefits.medicalExclusions",
            message: 'Could not reconstruct the "What is not covered?" column.'
          });
          return [];
        }
        const clauses = splitIntoClauses(fragments.join(" "));
        if (!clauses.length) {
          warnings.push({
            field: "benefits.medicalExclusions",
            message: "Reconstructed text but could not split it into distinct items; returning as one block."
          });
          return [fragments.join(" ")];
        }
        return clauses;
      }
      function extractFullExclusionsList(doc, warnings) {
        const section = getSectionLines(doc, /^Exclusions:\s*$/i, /^Note: This is not a full list/i);
        if (section.startIndex === -1) {
          warnings.push({
            field: "benefits.fullExclusionsList",
            message: 'Could not locate the lettered "Exclusions:" list (optional field).'
          });
          return [];
        }
        return splitLetteredList(section.lines);
      }
      function extractWaitingPeriods(doc, warnings) {
        const section = getSectionLines(doc, /^Waiting Period:\s*$/i, /^Exclusions:\s*$/i);
        if (section.startIndex === -1) {
          warnings.push({
            field: "benefits.waitingPeriods",
            message: 'Could not locate the "Waiting Period:" bulleted list (optional field).'
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
            current.description += " " + line;
          }
        }
        if (current) entries.push(current);
        return entries.map((e) => ({
          days: e.days,
          description: e.description.replace(/\s+/g, " ").replace(/,\s*$/, "").trim()
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
          _warnings: warnings
        };
      }
      module.exports = { extractBenefits, BENEFIT_LABEL_DICTIONARY };
    }
  });

  // parser/extractOptions.js
  var require_extractOptions = __commonJS({
    "parser/extractOptions.js"(exports, module) {
      "use strict";
      var { getSectionLines, splitColumns, parseCurrency, PAGE_FOOTER_ANCHOR } = require_lineUtils();
      var OPTION_LABELS = ["Recommended Product", "Option 1", "Option 2"];
      function splitColumnsWithOffsets(line, minGap = 2) {
        const re = new RegExp(`\\s{${minGap},}`, "g");
        const result = [];
        let lastEnd = 0;
        let m;
        while (m = re.exec(line)) {
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
      function findColumnRow(lines, anchorIdx, { window: window2 = 3, minColumns = 3 } = {}) {
        if (anchorIdx === -1) return null;
        const order = [anchorIdx];
        for (let d = 1; d <= window2; d++) order.push(anchorIdx + d, anchorIdx - d);
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
            message: `Could not locate a 3-column row near "${labelSubstrings[0]}".`
          });
          return [null, null, null];
        }
        const values = cols.length > 3 ? cols.slice(-3) : cols;
        return [values[0] || null, values[1] || null, values[2] || null];
      }
      function extractProductNames(lines, warnings) {
        const headerIdx = lines.findIndex((l) => l.includes("Option 1") && l.includes("Option 2"));
        const nameIdx = findAnchorLineIndex(lines, ["Name"]);
        if (headerIdx === -1 || nameIdx === -1 || nameIdx + 1 >= lines.length) {
          warnings.push({
            field: "options.productName",
            message: 'Could not locate the "Name" row or "Option 1 / Option 2" sub-header; product names unavailable.'
          });
          return [null, null, null];
        }
        const labelOffset = lines[nameIdx].search(/\S/);
        const col1Offset = lines[nameIdx - 1].search(/\S/);
        const col2Offset = lines[headerIdx].indexOf("Option 1");
        const col3Offset = lines[headerIdx].indexOf("Option 2");
        if ([labelOffset, col1Offset, col2Offset, col3Offset].some((o) => o < 0)) {
          warnings.push({
            field: "options.productName",
            message: 'Could not calibrate column positions for the "Name" row.'
          });
          return [null, null, null];
        }
        const refs = { label: labelOffset, col1: col1Offset, col2: col2Offset, col3: col3Offset };
        const nearestRef = (offset) => Object.entries(refs).reduce(
          (best, [key, val]) => Math.abs(offset - val) < Math.abs(offset - refs[best]) ? key : best,
          "label"
        );
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
          (p) => p.join(" ").replace(/\s+/g, " ").trim() || null
        );
        warnings.push({
          field: "options.productName",
          message: `Product names reconstructed from wrapped/shared table cells (lower confidence): ${JSON.stringify(names)}. Verify against the source PDF.`
        });
        return names;
      }
      function extractCoverageTerm(lines, warnings) {
        const matches = Array.from(new Set(lines.join("\n").match(/Until age \d+/gi) || []));
        if (!matches.length) {
          warnings.push({ field: "options.coverageTerm", message: 'Could not locate "Until age N" wording in the Options table.' });
          return { coverageTerm: null, coverageTermAgesFound: [] };
        }
        if (matches.length > 1) {
          warnings.push({
            field: "options.coverageTerm",
            message: `Options table shows more than one distinct coverage-term value: ${matches.join(", ")}. Using the first.`
          });
        }
        return { coverageTerm: matches[0], coverageTermAgesFound: matches };
      }
      function extractOptions(doc) {
        const warnings = [];
        const section = getSectionLines(doc, /Product Options Table/i, PAGE_FOOTER_ANCHOR);
        if (section.startIndex === -1) {
          warnings.push({ field: "options", message: 'Could not locate the "Product Options Table" section.' });
          return { columns: [], coverageTerm: null, coverageTermAgesFound: [], _warnings: warnings };
        }
        const lines = section.lines;
        const productNames = extractProductNames(lines, warnings);
        const [c1Contribution, c2Contribution, c3Contribution] = extractRow(
          lines,
          warnings,
          "annualContribution",
          ["Annual Takaful"],
          { window: 2 }
        );
        const [c1Type, c2Type, c3Type] = extractRow(lines, warnings, "facilityType", ["Cashless facility"], { window: 0 });
        const [c1CoPay, c2CoPay, c3CoPay] = extractRow(lines, warnings, "coPaymentOption", ["Co-payment Option"], { window: 0 });
        const [c1Room, c2Room, c3Room] = extractRow(lines, warnings, "roomAndBoard", ["Hospital Daily Room"], { window: 2 });
        const [c1Hosp, c2Hosp, c3Hosp] = extractRow(
          lines,
          warnings,
          "hospitalTreatment",
          ["Hospitalisation Treatment"],
          { window: 2 }
        );
        const [c1AnnualLimit, c2AnnualLimit, c3AnnualLimit] = extractRow(lines, warnings, "annualLimitOption", ["Annual Limit"], {
          window: 0
        });
        const [c1LifetimeLimit, c2LifetimeLimit, c3LifetimeLimit] = extractRow(
          lines,
          warnings,
          "lifetimeLimitOption",
          ["Lifetime Limit"],
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
          lifetimeLimitOption: [c1LifetimeLimit, c2LifetimeLimit, c3LifetimeLimit][i]
        }));
        return { columns, coverageTerm, coverageTermAgesFound, _warnings: warnings };
      }
      module.exports = { extractOptions };
    }
  });

  // parser/extractProjection.js
  var require_extractProjection = __commonJS({
    "parser/extractProjection.js"(exports, module) {
      "use strict";
      var { getSectionLines, splitColumns, parseCurrency } = require_lineUtils();
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
            field: "projection",
            message: 'Could not locate the "Takaful Contribution Projection Table" section.'
          });
          return {
            projectionRows: [],
            medicalInflationAssumptionLow: null,
            medicalInflationAssumptionHigh: null,
            _warnings: warnings
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
            field: "projection.medicalInflationAssumption",
            message: "Could not locate both medical inflation assumption percentages."
          });
        }
        const projectionRows = [];
        for (const line of lines) {
          const cols = splitColumns(line);
          if (!cols.length || !/^\d{1,3}$/.test(cols[0])) continue;
          const age = parseInt(cols[0], 10);
          const currentContribution = cols[1] && looksNumeric(cols[1]) ? parseCurrency(cols[1]) : null;
          const projected7pct = cols[2] && looksNumeric(cols[2]) ? parseCurrency(cols[2]) : null;
          const projected10pct = cols[3] && looksNumeric(cols[3]) ? parseCurrency(cols[3]) : null;
          projectionRows.push({ age, currentContribution, projected7pct, projected10pct });
        }
        if (!projectionRows.length) {
          warnings.push({ field: "projection.projectionRows", message: "Found the section but no data rows parsed from it." });
        }
        return {
          projectionRows,
          medicalInflationAssumptionLow,
          medicalInflationAssumptionHigh,
          _warnings: warnings
        };
      }
      module.exports = { extractProjection };
    }
  });

  // parser/validate.js
  var require_validate = __commonJS({
    "parser/validate.js"(exports, module) {
      "use strict";
      var KNOWN_PLAN_TIER_ANNUAL_LIMITS = {
        "Plan 200": 2e5
      };
      var REQUIRED_FIELDS = [
        "metadata.productName",
        "metadata.quotationDate",
        "client.fullName",
        "client.gender",
        "client.smokerStatus",
        "client.occupationClass",
        "client.ageNextBirthday",
        "client.dateOfBirth",
        "agent.agentCode",
        "plan.typeOfProduct",
        "plan.basicPlanName",
        "plan.basicPlanTerm",
        "plan.basicSumCovered",
        "plan.medicalRiderName",
        "plan.medicalPlanTier",
        "plan.coPaymentOption",
        "plan.medicalRiderTerm",
        "plan.coverageToAge",
        "contributions.isaContribution",
        "contributions.medicTotalCareContribution",
        "contributions.protectionContribution",
        "contributions.wakalahCertificateCharge",
        "contributions.totalMonthlyContribution",
        "contributions.totalAnnualContribution",
        "contributions.guaranteedDeathTPDBenefit",
        "benefits.annualLimit",
        "benefits.lifetimeLimit",
        "benefits.medicalExclusions",
        "options.columns",
        "options.coverageTerm",
        "projection.projectionRows"
      ];
      function getPath2(obj, path) {
        return path.split(".").reduce((acc, key) => acc == null ? void 0 : acc[key], obj);
      }
      function isEmpty(value) {
        if (value == null) return true;
        if (typeof value === "string") return value.trim() === "";
        if (Array.isArray(value)) return value.length === 0;
        return false;
      }
      function checkRequiredFields(data, errors) {
        for (const path of REQUIRED_FIELDS) {
          if (isEmpty(getPath2(data, path))) {
            errors.push({
              field: path,
              message: `Required field "${path}" is missing or empty. Needs manual entry before this quotation can be sent.`
            });
          }
        }
      }
      function checkMonthlyTimesTwelveEqualsAnnual(data, warnings) {
        const monthly = getPath2(data, "contributions.totalMonthlyContribution");
        const annual = getPath2(data, "contributions.totalAnnualContribution");
        if (monthly == null || annual == null) return;
        const expectedAnnual = Math.round(monthly * 12 * 100) / 100;
        if (Math.abs(expectedAnnual - annual) > 1) {
          warnings.push({
            field: "contributions.totalAnnualContribution",
            message: `Monthly contribution (RM ${monthly}) x 12 = RM ${expectedAnnual}, which does not match the extracted annual contribution (RM ${annual}).`
          });
        }
      }
      function checkContributionBreakdownSumsToMonthly(data, warnings) {
        const c = data.contributions || {};
        const { isaContribution, medicTotalCareContribution, protectionContribution, wakalahCertificateCharge, totalMonthlyContribution } = c;
        if (isaContribution != null && medicTotalCareContribution != null && protectionContribution != null) {
          const subtotal = Math.round((isaContribution + medicTotalCareContribution) * 100) / 100;
          if (Math.abs(subtotal - protectionContribution) > 0.5) {
            warnings.push({
              field: "contributions.protectionContribution",
              message: `ISA (RM ${isaContribution}) + Medic TotalCare (RM ${medicTotalCareContribution}) = RM ${subtotal}, which does not match the extracted "Protection Contribution" subtotal (RM ${protectionContribution}).`
            });
          }
        }
        if (isaContribution != null && medicTotalCareContribution != null && wakalahCertificateCharge != null && totalMonthlyContribution != null) {
          const total = Math.round((isaContribution + medicTotalCareContribution + wakalahCertificateCharge) * 100) / 100;
          if (Math.abs(total - totalMonthlyContribution) > 0.5) {
            warnings.push({
              field: "contributions.totalMonthlyContribution",
              message: `ISA (RM ${isaContribution}) + Medic TotalCare (RM ${medicTotalCareContribution}) + Wakalah Certificate Charge (RM ${wakalahCertificateCharge}) = RM ${total}, which does not match the extracted total (RM ${totalMonthlyContribution}).`
            });
          }
        }
      }
      function checkPlanTierMatchesAnnualLimit(data, warnings) {
        const tier = getPath2(data, "plan.medicalPlanTier");
        const annualLimitRaw = getPath2(data, "benefits.annualLimit");
        if (!tier || !annualLimitRaw) return;
        const expected = KNOWN_PLAN_TIER_ANNUAL_LIMITS[tier];
        if (expected == null) {
          warnings.push({
            field: "plan.medicalPlanTier",
            message: `"${tier}" is not in the known plan-tier reference table; could not cross-check its annual limit. Add it to KNOWN_PLAN_TIER_ANNUAL_LIMITS in validate.js if this tier is legitimate.`
          });
          return;
        }
        const actual = parseFloat(String(annualLimitRaw).replace(/[^\d.]/g, ""));
        if (Number.isFinite(actual) && actual !== expected) {
          warnings.push({
            field: "benefits.annualLimit",
            message: `Plan tier "${tier}" is normally paired with an annual limit of RM ${expected}, but the extracted annual limit is "${annualLimitRaw}".`
          });
        }
      }
      function checkCoverageToAgeConsistency(data, warnings) {
        const age = getPath2(data, "client.ageNextBirthday");
        const term = getPath2(data, "plan.basicPlanTerm");
        const coverageToAge = getPath2(data, "plan.coverageToAge");
        if (age == null || term == null || coverageToAge == null) return;
        if (age + term !== coverageToAge) {
          warnings.push({
            field: "plan.coverageToAge",
            message: `Age (${age}) + basic plan term (${term}) = ${age + term}, which does not match the extracted/derived coverage-to-age (${coverageToAge}).`
          });
        }
      }
      function checkDateOfBirthMatchesAge(data, warnings) {
        const dob = getPath2(data, "client.dateOfBirth");
        const ageNextBirthday = getPath2(data, "client.ageNextBirthday");
        const quotationDate = getPath2(data, "metadata.quotationDate");
        if (!dob || ageNextBirthday == null || !quotationDate) return;
        const dobDate = /* @__PURE__ */ new Date(dob.iso + "T00:00:00Z");
        const qDate = /* @__PURE__ */ new Date(quotationDate.iso + "T00:00:00Z");
        let currentAge = qDate.getUTCFullYear() - dobDate.getUTCFullYear();
        const hadBirthdayThisYear = qDate.getUTCMonth() > dobDate.getUTCMonth() || qDate.getUTCMonth() === dobDate.getUTCMonth() && qDate.getUTCDate() >= dobDate.getUTCDate();
        if (!hadBirthdayThisYear) currentAge -= 1;
        const expectedAgeNextBirthday = currentAge + 1;
        if (Math.abs(expectedAgeNextBirthday - ageNextBirthday) > 1) {
          warnings.push({
            field: "client.ageNextBirthday",
            message: `Date of birth (${dob.raw}) implies an "age next birthday" of about ${expectedAgeNextBirthday} as of the quotation date, which does not match the extracted value (${ageNextBirthday}).`
          });
        }
      }
      function checkBenefitItemsCompleteness(data, warnings) {
        const items = getPath2(data, "benefits.benefitItems");
        if (!Array.isArray(items) || !items.length) return;
        const missing = items.filter((i) => !i.value).map((i) => i.label);
        if (missing.length) {
          warnings.push({
            field: "benefits.benefitItems",
            message: `${missing.length} of ${items.length} benefit items have no value (${missing.join("; ")}). See per-item warnings for detail.`
          });
        }
      }
      function checkOptionsContributionsAreNumbers(data, errors) {
        const columns = getPath2(data, "options.columns");
        if (!Array.isArray(columns)) return;
        columns.forEach((col, i) => {
          if (!Number.isFinite(col.annualContribution) || col.annualContribution <= 0) {
            errors.push({
              field: `options.columns[${i}].annualContribution`,
              message: `"${col.optionLabel}" has no valid annual contribution amount.`
            });
          }
        });
      }
      function checkAgentCodeShape(data, warnings) {
        const code = getPath2(data, "agent.agentCode");
        if (!code) return;
        if (!/^[A-Z0-9]{5,10}$/i.test(code)) {
          warnings.push({
            field: "agent.agentCode",
            message: `Agent code "${code}" doesn't look like a typical PruBSN agent code; verify it.`
          });
        }
      }
      function checkValidUntilAfterQuotationDate(data, errors) {
        const quotationDate = getPath2(data, "metadata.quotationDate");
        const validUntil = getPath2(data, "metadata.validUntil");
        if (!quotationDate || !validUntil) return;
        if (validUntil.iso <= quotationDate.iso) {
          errors.push({
            field: "metadata.validUntil",
            message: `Generated validUntil date (${validUntil.iso}) is not after the quotation date (${quotationDate.iso}).`
          });
        }
      }
      function validateQuotation2(data) {
        const warnings = [];
        const errors = [];
        checkRequiredFields(data, errors);
        checkMonthlyTimesTwelveEqualsAnnual(data, warnings);
        checkContributionBreakdownSumsToMonthly(data, warnings);
        checkPlanTierMatchesAnnualLimit(data, warnings);
        checkCoverageToAgeConsistency(data, warnings);
        checkDateOfBirthMatchesAge(data, warnings);
        checkBenefitItemsCompleteness(data, warnings);
        checkOptionsContributionsAreNumbers(data, errors);
        checkAgentCodeShape(data, warnings);
        checkValidUntilAfterQuotationDate(data, errors);
        return { warnings, errors };
      }
      module.exports = { validateQuotation: validateQuotation2, KNOWN_PLAN_TIER_ANNUAL_LIMITS, REQUIRED_FIELDS };
    }
  });

  // parser/parseQuotation.js
  var require_parseQuotation = __commonJS({
    "parser/parseQuotation.js"(exports, module) {
      "use strict";
      var { buildDocument } = require_lineUtils();
      var { extractMetadata } = require_extractMetadata();
      var { extractClient } = require_extractClient();
      var { extractAgent } = require_extractAgent();
      var { extractPlan } = require_extractPlan();
      var { extractContributions } = require_extractContributions();
      var { extractBenefits } = require_extractBenefits();
      var { extractOptions } = require_extractOptions();
      var { extractProjection } = require_extractProjection();
      var { validateQuotation: validateQuotation2 } = require_validate();
      function safeExtract(sectionName, fn, errors) {
        try {
          const result = fn();
          return result;
        } catch (err) {
          errors.push({
            field: sectionName,
            message: `Extractor for "${sectionName}" threw an error: ${err.message}`
          });
          return null;
        }
      }
      function collectSectionWarnings(sectionName, sectionData, warnings) {
        if (!sectionData || !Array.isArray(sectionData._warnings)) return sectionData;
        for (const w of sectionData._warnings) {
          warnings.push(w.field ? w : { field: sectionName, message: w.message || String(w) });
        }
        const { _warnings, ...rest } = sectionData;
        return rest;
      }
      function parseQuotation2(pages, options = {}) {
        const doc = buildDocument(pages);
        const warnings = [];
        const errors = [];
        const metadata = safeExtract("metadata", () => extractMetadata(doc, options), errors);
        const client = safeExtract("client", () => extractClient(doc), errors);
        const agent = safeExtract("agent", () => extractAgent(doc), errors);
        const plan = safeExtract("plan", () => extractPlan(doc), errors);
        const contributions = safeExtract("contributions", () => extractContributions(doc), errors);
        const benefits = safeExtract("benefits", () => extractBenefits(doc), errors);
        const optionsSection = safeExtract("options", () => extractOptions(doc), errors);
        const projection = safeExtract("projection", () => extractProjection(doc), errors);
        const data = {
          metadata: collectSectionWarnings("metadata", metadata, warnings),
          client: collectSectionWarnings("client", client, warnings),
          agent: collectSectionWarnings("agent", agent, warnings),
          plan: collectSectionWarnings("plan", plan, warnings),
          contributions: collectSectionWarnings("contributions", contributions, warnings),
          benefits: collectSectionWarnings("benefits", benefits, warnings),
          options: collectSectionWarnings("options", optionsSection, warnings),
          projection: collectSectionWarnings("projection", projection, warnings)
        };
        if (data.plan && data.plan.coverageToAge == null && data.client && data.client.ageNextBirthday != null && data.plan.basicPlanTerm != null) {
          data.plan.coverageToAge = data.client.ageNextBirthday + data.plan.basicPlanTerm;
          warnings.push({
            field: "plan.coverageToAge",
            message: `Derived as ageNextBirthday (${data.client.ageNextBirthday}) + basicPlanTerm (${data.plan.basicPlanTerm}); not found explicitly in the PDF.`
          });
        }
        const validation = validateQuotation2(data);
        warnings.push(...validation.warnings);
        errors.push(...validation.errors);
        return { data, warnings, errors };
      }
      module.exports = { parseQuotation: parseQuotation2 };
    }
  });

  // parser/agents.js
  var require_agents = __commonJS({
    "parser/agents.js"(exports, module) {
      "use strict";
      var AGENTS = {
        "8LT00006": {
          name: "Muhammad Syakir Badri Bin Md Nizam",
          agency: "ASG Ansar Group",
          branch: "Asbenz Motors",
          location: "Alor Setar, Kedah",
          phone: "",
          whatsapp: "",
          email: "",
          logo: "",
          photo: ""
        }
      };
      function getAgentConfig(agentCode) {
        if (!agentCode) return null;
        return AGENTS[agentCode] || null;
      }
      module.exports = { AGENTS, getAgentConfig };
    }
  });

  // parser/index.js
  var require_parser = __commonJS({
    "parser/index.js"(exports, module) {
      "use strict";
      var { parseQuotation: parseQuotation2 } = require_parseQuotation();
      var { AGENTS, getAgentConfig } = require_agents();
      module.exports = { parseQuotation: parseQuotation2, AGENTS, getAgentConfig };
    }
  });

  // renderer/formatters.js
  var require_formatters = __commonJS({
    "renderer/formatters.js"(exports, module) {
      "use strict";
      function escapeHtml2(value) {
        if (value == null) return "";
        return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
      }
      function formatMoney(n) {
        if (n == null || !Number.isFinite(n)) return null;
        const hasCents = Math.round(n * 100) % 100 !== 0;
        return n.toLocaleString("en-MY", {
          minimumFractionDigits: hasCents ? 2 : 0,
          maximumFractionDigits: 2
        });
      }
      function formatMoneyFixed2(n) {
        if (n == null || !Number.isFinite(n)) return null;
        return n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }
      function resolveMonthlyTotalPayable(contributions) {
        const c = contributions || {};
        if (c.totalMonthlyContribution != null && Number.isFinite(c.totalMonthlyContribution)) {
          return c.totalMonthlyContribution;
        }
        if (c.totalAnnualContribution != null && Number.isFinite(c.totalAnnualContribution)) {
          return Math.round(c.totalAnnualContribution / 12 * 100) / 100;
        }
        return null;
      }
      function formatDateLong(iso) {
        if (!iso) return null;
        const d = /* @__PURE__ */ new Date(iso + "T00:00:00Z");
        if (Number.isNaN(d.getTime())) return null;
        return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
      }
      function shortValue(value) {
        if (!value) return null;
        const stripped = value.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
        return stripped || null;
      }
      function coPaymentAmount(coPaymentOption) {
        if (!coPaymentOption) return null;
        const m = String(coPaymentOption).match(/[\d,]+/);
        return m ? m[0] : null;
      }
      function compactRate(value) {
        if (!value) return null;
        return shortValue(value).replace(/^RM\s*/i, "RM ").replace(/\s*per\s*rider\s*year\b/i, "/yr").replace(/\s*per\s*year\b/i, "/yr").replace(/\s*per\s*day\b/i, "/day");
      }
      function primaryValue2(value) {
        if (!value) return null;
        const rmMatch = value.match(/RM\s*[\d,]+(\.\d+)?(\s+per\s+[a-z]+(\s+[a-z]+)?)?/);
        if (rmMatch) return rmMatch[0].replace(/\s+/g, " ").trim();
        if (/As charged/i.test(value)) return "As charged";
        if (/^\s*Yes\s*$/i.test(value)) return "Yes";
        if (/No Lifetime Limit/i.test(value)) return "No Lifetime Limit";
        if (/No Limit/i.test(value)) return "No Limit";
        return shortValue(value) || null;
      }
      function bareTierNumber(planTier) {
        if (!planTier) return null;
        return planTier.replace(/^Plan\s+/i, "");
      }
      module.exports = {
        escapeHtml: escapeHtml2,
        formatMoney,
        formatMoneyFixed2,
        resolveMonthlyTotalPayable,
        formatDateLong,
        shortValue,
        coPaymentAmount,
        compactRate,
        bareTierNumber,
        primaryValue: primaryValue2
      };
    }
  });

  // browser-tool/assets/images/image-manifest.json
  var require_image_manifest = __commonJS({
    "browser-tool/assets/images/image-manifest.json"(exports, module) {
      module.exports = {
        hero: {},
        plans: {},
        coverage: {},
        roomBoard: {},
        hospital: {},
        accident: {},
        surgery: {},
        recovery: {},
        financial: {},
        waitingPeriod: {},
        cashValue: {},
        guarantee: {},
        misc: {}
      };
    }
  });

  // renderer/AssetManager.js
  var require_AssetManager = __commonJS({
    "renderer/AssetManager.js"(exports, module) {
      "use strict";
      var manifest = require_image_manifest();
      var BASE_PATH = "";
      var DEFAULT_IMAGE_PATH = "default.jpg";
      function resolveUrl(relativePath) {
        return `${BASE_PATH}assets/images/${relativePath}`;
      }
      function numericKey(raw) {
        if (raw == null) return null;
        const digits = String(raw).replace(/[^\d]/g, "");
        return digits || null;
      }
      function siteWideDefault(category, key) {
        console.warn(`AssetManager: no image configured for category "${category}"${key ? `, key "${key}"` : ""} - falling back to the site-wide default.`);
        const miscDefault = manifest.misc && manifest.misc.default;
        return miscDefault ? resolveUrl(miscDefault) : resolveUrl(DEFAULT_IMAGE_PATH);
      }
      function lookupSingle(category) {
        const entry = manifest[category] && manifest[category].default;
        if (entry) return resolveUrl(entry);
        return siteWideDefault(category, null);
      }
      function lookupKeyed(category, rawKey) {
        const key = numericKey(rawKey);
        const categoryMap = manifest[category] || {};
        if (key && categoryMap[key]) return resolveUrl(categoryMap[key]);
        if (categoryMap.default) {
          if (key) console.warn(`AssetManager: no image configured for category "${category}", key "${key}" - using that category's default image instead.`);
          return resolveUrl(categoryMap.default);
        }
        return siteWideDefault(category, key);
      }
      function getHeroImage() {
        return lookupSingle("hero");
      }
      function getPlanImage(planTier) {
        return lookupKeyed("plans", planTier);
      }
      function getCoverageImage(annualLimit) {
        return lookupKeyed("coverage", annualLimit);
      }
      function getRoomBoardImage(roomBoardRate) {
        return lookupKeyed("roomBoard", roomBoardRate);
      }
      function getHospitalImage() {
        return lookupSingle("hospital");
      }
      function getAccidentImage() {
        return lookupSingle("accident");
      }
      function getSurgeryImage() {
        return lookupSingle("surgery");
      }
      function getRecoveryImage() {
        return lookupSingle("recovery");
      }
      function getFinancialImage() {
        return lookupSingle("financial");
      }
      function getWaitingPeriodImage() {
        return lookupSingle("waitingPeriod");
      }
      function getCashValueImage() {
        return lookupSingle("cashValue");
      }
      function getGuaranteeImage() {
        return lookupSingle("guarantee");
      }
      function getMiscImage(key) {
        return lookupKeyed("misc", key);
      }
      module.exports = {
        getHeroImage,
        getPlanImage,
        getCoverageImage,
        getRoomBoardImage,
        getHospitalImage,
        getAccidentImage,
        getSurgeryImage,
        getRecoveryImage,
        getFinancialImage,
        getWaitingPeriodImage,
        getCashValueImage,
        getGuaranteeImage,
        getMiscImage,
        // Exposed for tests only - not part of the intended public surface.
        _numericKey: numericKey,
        _resolveUrl: resolveUrl
      };
    }
  });

  // renderer/renderNarrativeQuotation.js
  var require_renderNarrativeQuotation = __commonJS({
    "renderer/renderNarrativeQuotation.js"(exports, module) {
      "use strict";
      var RENDERER_VERSION2 = "narrative-v1";
      var { getAgentConfig } = require_agents();
      var {
        escapeHtml: escapeHtml2,
        formatMoney,
        formatMoneyFixed2,
        resolveMonthlyTotalPayable
      } = require_formatters();
      var AssetManager = require_AssetManager();
      function naSpan(text) {
        return `<span class="pq-na">${escapeHtml2(text || "Refer to certificate")}</span>`;
      }
      function textOr(value, clientText) {
        return value ? escapeHtml2(value) : naSpan(clientText);
      }
      function moneyRM(n) {
        const formatted = formatMoney(n);
        return formatted == null ? null : `RM ${formatted}`;
      }
      function firstName(fullName) {
        if (!fullName) return null;
        const parts = String(fullName).trim().split(/\s+/);
        return parts[0] || fullName;
      }
      function findBenefit(benefitItems, label) {
        return (benefitItems || []).find((b) => b.label === label) || null;
      }
      function extractRmAmount(value) {
        if (!value) return null;
        const m = String(value).match(/RM\s*([\d,]+(?:\.\d+)?)/);
        return m ? m[0].replace(/\s+/g, " ") : null;
      }
      function extractDayNote(value) {
        if (!value) return null;
        const m = String(value).match(/\(([^)]*\bdays?\b[^)]*)\)/i);
        return m ? m[1] : null;
      }
      var KNOWN_CRITICAL_ILLNESS_TERMS = ["Cancer", "Heart Attack", "Kidney Failure", "Stroke"];
      function criticalIllnessBoost(benefitItems) {
        const item = findBenefit(benefitItems, "Additional Annual Limit for");
        if (!item || !item.value) return null;
        const amount = extractRmAmount(item.value);
        if (!amount) return null;
        const conditions = KNOWN_CRITICAL_ILLNESS_TERMS.filter(
          (term) => new RegExp(term, "i").test(item.value)
        );
        return { amount, conditions };
      }
      var PRODUCT_FACTS = {
        "PruBSN AnugerahMax": {
          extensionToAge100: true,
          pidmProtected: true
        }
      };
      function imageWithFallback(url, altText, layoutClass = "pq-kenburns") {
        return `<img class="pq-reveal pq-photo ${layoutClass}" src="${escapeHtml2(url)}" alt="${escapeHtml2(altText)}">
      <div class="pq-kb-placeholder ${layoutClass === "pq-inline-photo" ? "pq-inline-photo" : ""}" style="display:none" role="img" aria-label="${escapeHtml2(altText)}">
        <svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="#9FB4D1" stroke-width="1.3"><rect x="3" y="8" width="18" height="13" rx="1.2"></rect><path d="M3 8l9-5 9 5"></path><path d="M12 11v6M9 14h6"></path></svg>
      </div>`;
      }
      function buildViewModel(data, agentReview) {
        const { metadata = {}, client = {}, agent = {}, plan = {}, contributions = {}, benefits = {}, projection = {} } = data || {};
        const agentConfig = getAgentConfig(agent.agentCode) || {};
        const benefitItems = benefits.benefitItems || [];
        const monthlyValue = resolveMonthlyTotalPayable(contributions);
        const monthlyFormatted = monthlyValue != null ? `RM ${formatMoneyFixed2(monthlyValue)}` : null;
        const monthlyCompact = monthlyValue != null ? moneyRM(monthlyValue) : null;
        const roomBoardItem = findBenefit(benefitItems, "Hospital Daily Room and Board");
        const roomBoardAmount = roomBoardItem ? extractRmAmount(roomBoardItem.value) : null;
        const roomBoardDayNote = roomBoardItem ? extractDayNote(roomBoardItem.value) : null;
        const boost = criticalIllnessBoost(benefitItems);
        const purposeRaw = client.takafulPlanPurpose;
        const purpose = purposeRaw ? /non-business/i.test(purposeRaw) ? "Personal" : /business/i.test(purposeRaw) ? "Business" : purposeRaw : null;
        const productFacts = PRODUCT_FACTS[metadata.productName] || {};
        const currentRow = (projection.projectionRows || []).find((r) => r.age === client.ageNextBirthday) || null;
        return {
          clientName: client.fullName || null,
          clientFirstName: firstName(client.fullName),
          ageNextBirthday: client.ageNextBirthday,
          gender: client.gender,
          smokerStatus: client.smokerStatus,
          occupationClass: client.occupationClass,
          purpose,
          paymentMode: plan.paymentMode,
          productName: metadata.productName,
          medicalRiderName: plan.medicalRiderName,
          medicalPlanTier: plan.medicalPlanTier,
          coPaymentOption: plan.coPaymentOption,
          basicPlanTerm: plan.basicPlanTerm,
          coverageToAge: plan.coverageToAge,
          coverageStartAge: client.ageNextBirthday != null ? client.ageNextBirthday + 1 : null,
          agentName: agentConfig.name || agent.agentNameOnDocument || null,
          agentCode: agent.agentCode || null,
          agencyName: agentConfig.agency || null,
          agencyLogo: agentConfig.logo || null,
          monthlyFormatted,
          monthlyCompact,
          totalAnnualContribution: contributions.totalAnnualContribution,
          totalContributionOverTerm: contributions.totalContributionOverTerm,
          guaranteedDeathTPDBenefit: contributions.guaranteedDeathTPDBenefit,
          isaContribution: contributions.isaContribution,
          protectionContribution: contributions.protectionContribution,
          wakalahCertificateCharge: contributions.wakalahCertificateCharge,
          cashValueX: contributions.nonGuaranteedCashValueScenarioX,
          cashValueY: contributions.nonGuaranteedCashValueScenarioY,
          annualLimit: benefits.annualLimit,
          lifetimeLimit: benefits.lifetimeLimit,
          benefitItems,
          waitingPeriods: (benefits.waitingPeriods || []).slice().sort((a, b) => a.days - b.days),
          roomBoardAmount,
          roomBoardDayNote,
          boost,
          productFacts,
          projectedAgeContribution: currentRow ? moneyRM(currentRow.currentContribution) : null,
          quotationNumber: agentReview && agentReview.quotationNumber ? agentReview.quotationNumber : null
        };
      }
      var NARRATIVE_STYLE = `
  :root{
    --teal:#178D93; --teal-dk:#0F6E73;
    --ink:#0B2545; --meta:#5A6B85; --line:rgba(11,37,69,0.12); --card:#ffffff;
    --rose-soft:#F6F1EE; --gold-a:#C9962E; --gold-b:#E0B25A;
    --serif:"Newsreader",Georgia,"Times New Roman",serif;
    --sans:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,sans-serif;
  }
  #pq-doc{font-family:var(--sans);color:var(--ink);width:100%;overflow-x:hidden}
  #pq-doc *{box-sizing:border-box}
  #pq-doc a{color:var(--teal)}
  #pq-doc a:hover{color:var(--teal-dk)}
  body:has(#pq-doc){margin:0;background:linear-gradient(165deg,#F6C9D6 0%,#F2D3E2 18%,#E7D7EC 38%,#D6E1F0 60%,#C3E7F3 82%,#BEEAF4 100%);background-attachment:fixed}

  .pq-reveal{opacity:1;transform:none}
  .pq-zoom{opacity:0.12;transform:scale(0.72)}
  @media (prefers-reduced-motion:no-preference){
    .pq-reveal{opacity:0;transform:translateY(26px);transition:opacity .8s cubic-bezier(.22,1,.36,1),transform .8s cubic-bezier(.22,1,.36,1)}
    .pq-reveal[data-visible]{opacity:1;transform:translateY(0)}
    .pq-reveal.d1[data-visible]{transition-delay:.08s}
    .pq-reveal.d2[data-visible]{transition-delay:.16s}
    .pq-reveal.d3[data-visible]{transition-delay:.24s}
    .pq-reveal.d4[data-visible]{transition-delay:.32s}
    .pq-donut-seg{transition:stroke-dashoffset 1.3s cubic-bezier(.22,1,.36,1) .25s}
    .pq-draw-path{transition:stroke-dashoffset 1.5s cubic-bezier(.22,1,.36,1) .2s}
    .pq-zoom{opacity:0;transform:scale(0.72)}
    .pq-kenburns{transform:scale(1.15);transition:transform 9s cubic-bezier(.22,1,.36,1)}
    .pq-kenburns[data-visible]{transform:scale(1)}
  }
  @keyframes pqIntro{from{opacity:0;transform:translateY(10px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}
  @keyframes pqPulse{0%,100%{transform:scale(1);box-shadow:0 0 0 0 rgba(23,141,147,.35)}50%{transform:scale(1.05);box-shadow:0 0 0 18px rgba(23,141,147,0)}}

  #pq-doc section{padding:56px 28px}
  #pq-doc .pq-eyebrow{font-size:13px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--teal)}
  #pq-doc .pq-headline{font-family:var(--serif);font-weight:600;line-height:1.28;margin-top:12px}
  #pq-doc .pq-lede{font-size:16px;color:var(--meta);margin-top:12px;line-height:1.6}
  #pq-doc .pq-na{color:var(--meta);font-style:italic}

  .pq-hero{min-height:92vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding-top:calc(env(safe-area-inset-top) + 40px)}
  .pq-brandmark{font-family:var(--serif);font-weight:700;font-size:19px;color:var(--ink)}
  .pq-award{display:inline-flex;align-items:center;gap:10px;background:rgba(255,255,255,.55);border:1px solid var(--line);border-radius:100px;padding:10px 18px;font-size:13px;font-weight:700;color:#6b5a2e;margin-top:20px}
  .pq-tagline{font-family:var(--serif);font-style:italic;font-size:44px;font-weight:600;color:var(--teal);margin-top:34px}
  .pq-tagline-en{font-size:16px;color:var(--meta);margin-top:6px}
  .pq-hero-title{font-family:var(--serif);font-size:30px;font-weight:600;margin-top:40px;max-width:480px;line-height:1.35}
  .pq-hero-sub{margin-top:28px;font-size:15px;color:var(--meta)}
  .pq-scroll-cue{margin-top:40px;font-size:13px;color:#5a6b85;letter-spacing:.1em;text-transform:uppercase;text-align:center}

  .pq-stat-pill{display:inline-flex;align-items:center;gap:14px;margin-top:36px;color:#fff;border-radius:100px;padding:14px 22px;box-shadow:0 10px 28px rgba(23,141,147,.25);background:var(--teal)}
  .pq-stat-pill b{font-size:26px;font-weight:800;font-family:var(--serif);line-height:1}
  .pq-stat-pill span{font-size:13px;font-weight:600;line-height:1.3}

  .pq-path-grid{display:flex;flex-direction:column;gap:28px;margin-top:20px}
  .pq-path-card{background:#fff;border-radius:14px;padding:28px 22px;box-shadow:0 6px 20px rgba(11,37,69,.08);text-align:center}
  .pq-path-card.pq-dark{background:var(--ink);color:#fff}
  .pq-path-card .pq-path-label{font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--meta)}
  .pq-path-card.pq-dark .pq-path-label{color:#9FB4D1}
  .pq-path-card .pq-path-title{font-size:17px;font-weight:700;margin-top:6px}
  .pq-path-card .pq-path-desc{font-size:13px;color:var(--meta);margin-top:12px}
  .pq-path-card.pq-dark .pq-path-desc{color:#C7D3E3}

  .pq-drama{position:relative;min-height:56vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;background:linear-gradient(160deg,#0B2545 0%,#16345E 100%);color:#fff;overflow:hidden}
  .pq-drama .pq-headline{position:relative;color:#fff;font-size:32px;max-width:440px}
  .pq-drama .pq-eyebrow{position:relative;color:#CFE0EE}
  .pq-drama .pq-figure{color:#F2A65A}

  .pq-consequence-steps{display:flex;flex-direction:column;gap:14px;margin-top:26px}
  .pq-consequence-step{background:#fff;border-radius:10px;padding:20px;box-shadow:0 6px 20px rgba(11,37,69,.08);border-left:4px solid var(--gold-a)}
  .pq-consequence-step .pq-step-title{font-size:16px;font-weight:700}
  .pq-consequence-step .pq-step-desc{font-size:14px;color:var(--meta);margin-top:4px;line-height:1.5}
  .pq-consequence-step.pq-warn{background:#B5493D;color:#fff;border-left-color:transparent}
  .pq-consequence-step.pq-warn .pq-step-desc{color:#FDE2DE}

  .pq-protected-card{background:var(--teal);color:#fff;border-radius:14px;padding:30px 24px;margin-top:24px;text-align:center;box-shadow:0 10px 30px rgba(23,141,147,.25)}
  .pq-protected-card .pq-protected-figure{font-size:22px;font-weight:700;font-family:var(--serif);margin-top:18px}
  .pq-protected-card .pq-protected-note{font-size:14px;color:#E3ECF5;margin-top:10px;line-height:1.5}

  .pq-summary-card{padding-top:64px;border-top:1px solid var(--line)}
  .pq-summary-name{font-family:var(--serif);font-size:40px;line-height:1.1;font-weight:600;margin-top:10px}
  .pq-summary-rows{margin-top:36px;border-top:1px solid var(--line)}
  .pq-summary-row{display:flex;justify-content:space-between;padding:18px 0;border-bottom:1px solid var(--line)}
  .pq-summary-row .l{font-size:15px;color:var(--meta)}
  .pq-summary-row .r{font-size:18px;font-weight:600}

  .pq-stat-grid{display:flex;flex-direction:column;gap:16px;margin-top:32px}
  .pq-stat-card{background:#fff;border-radius:10px;padding:22px 24px;display:flex;align-items:center;gap:18px;box-shadow:0 6px 20px rgba(11,37,69,.08)}
  .pq-stat-card .pq-stat-figure{font-size:32px;font-weight:800;font-family:var(--serif);color:var(--teal);line-height:1}
  .pq-stat-card .pq-stat-label{font-size:14px;margin-top:6px;line-height:1.4}
  .pq-source-note{font-size:12px;color:#7C88A0;margin-top:8px;line-height:1.5}

  .pq-cost-list{display:flex;flex-direction:column;gap:20px;margin-top:32px}
  .pq-cost-row .pq-cost-head{display:flex;justify-content:space-between;font-size:15px;margin-bottom:6px}
  .pq-cost-track{height:12px;background:#fff;border-radius:6px;overflow:hidden;box-shadow:0 0 0 1px rgba(11,37,69,.08) inset}
  .pq-cost-fill{height:100%;border-radius:6px;background:linear-gradient(90deg,var(--teal),#0B5B60)}
  .pq-cost-fill.pq-gold{background:var(--gold-a)}

  .pq-profile-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:28px}
  .pq-profile-item{background:#fff;border-radius:8px;padding:20px;box-shadow:0 6px 20px rgba(11,37,69,.08)}
  .pq-profile-item.pq-wide{grid-column:1/-1}
  .pq-profile-item .k{font-size:13px;color:#7C88A0;text-transform:uppercase;letter-spacing:.05em}
  .pq-profile-item .v{font-size:19px;font-weight:600;margin-top:6px}

  .pq-donut-wrap{position:relative;width:220px;height:220px;margin:36px auto 0}
  .pq-donut-total{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
  .pq-donut-total .k{font-size:13px;color:#7C88A0;text-transform:uppercase;letter-spacing:.05em}
  .pq-donut-total .v{font-size:34px;font-weight:800;font-family:var(--serif);color:var(--ink)}
  .pq-contrib-list{display:flex;flex-direction:column;gap:16px;margin-top:32px}
  .pq-contrib-item{display:flex;gap:16px;align-items:flex-start;background:#fff;border-radius:8px;padding:20px;box-shadow:0 6px 20px rgba(11,37,69,.08)}
  .pq-contrib-dot{width:14px;height:14px;border-radius:4px;margin-top:5px;flex-shrink:0}
  .pq-contrib-item .k{font-size:18px;font-weight:700}
  .pq-contrib-item .d{font-size:15px;color:var(--meta);margin-top:6px;line-height:1.5}

  .pq-kb-section{position:relative;min-height:88vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:20px 28px;overflow:hidden}
  .pq-kb-media{position:absolute;inset:0;overflow:hidden}
  .pq-kb-media img.pq-kenburns{width:100%;height:100%;object-fit:cover}
  .pq-kb-placeholder{width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,#16345E 0%,#0B2545 100%)}

  /* Compact, non-full-bleed image used inline within an otherwise
     card-based section (plan/guarantee/waiting-period/cash-value) -
     same graceful onerror-fallback mechanism as the full-bleed Ken Burns
     photos, just a smaller rounded rectangle rather than a whole section
     background. */
  .pq-inline-photo-wrap{margin-top:20px;border-radius:12px;overflow:hidden;height:160px;box-shadow:0 6px 20px rgba(11,37,69,.08)}
  img.pq-inline-photo{width:100%;height:160px;object-fit:cover;border-radius:12px;display:block}
  .pq-kb-placeholder.pq-inline-photo{height:160px;border-radius:12px}
  .pq-kb-overlay{position:absolute;inset:0;background:linear-gradient(rgba(11,37,69,.5) 0%,rgba(11,37,69,.68) 55%,rgba(11,37,69,.86) 100%)}
  .pq-kb-content{position:relative;color:#fff;max-width:460px}
  .pq-kb-content .pq-eyebrow{color:#CFE0EE}
  .pq-kb-content .pq-headline{color:#fff;font-size:30px}
  .pq-kb-figure{font-size:52px;font-weight:800;font-family:var(--serif);color:#4FD1D9;margin-top:16px}
  .pq-kb-figure small{font-size:20px;color:#CFE0EE;font-weight:600}
  .pq-kb-note{font-size:14px;color:#E3ECF5;margin-top:16px;line-height:1.5}

  .pq-benefit-list{display:flex;flex-direction:column;gap:14px;margin-top:20px}
  .pq-benefit-card{background:#fff;border-radius:8px;padding:20px;display:flex;gap:16px;align-items:flex-start;box-shadow:0 6px 20px rgba(11,37,69,.08)}
  .pq-benefit-card .k{font-size:16px;font-weight:700}
  .pq-benefit-card .d{font-size:14px;color:var(--meta);margin-top:4px;line-height:1.5}
  .pq-benefit-dot{width:22px;height:22px;flex-shrink:0;color:var(--teal)}

  .pq-guarantee-hero{background:var(--ink);color:#fff;border-radius:12px;padding:32px 26px;margin-top:32px;box-shadow:0 10px 30px rgba(11,37,69,.2)}
  .pq-guarantee-hero .pq-eyebrow{color:#9FB4D1}
  .pq-guarantee-hero .pq-figure{font-size:52px;font-weight:800;font-family:var(--serif);margin-top:8px}
  .pq-guarantee-hero .pq-note{font-size:16px;margin-top:12px;line-height:1.55;color:#C7D3E3}
  .pq-fact-list{display:flex;flex-direction:column;gap:16px;margin-top:20px}
  .pq-fact-card{background:#fff;border-radius:10px;padding:24px;box-shadow:0 6px 20px rgba(11,37,69,.08)}
  .pq-fact-card .k{font-size:17px;font-weight:600;color:var(--teal)}
  .pq-fact-card .d{font-size:15px;margin-top:8px;color:var(--meta);line-height:1.5}

  .pq-wait-list{display:flex;flex-direction:column;gap:14px;margin-top:28px}
  .pq-wait-card{background:#fff;border-radius:10px;padding:22px;box-shadow:0 6px 20px rgba(11,37,69,.08)}
  .pq-wait-card.pq-first{background:var(--teal);color:#fff}
  .pq-wait-card .k{font-size:16px;font-weight:700}
  .pq-wait-card .d{font-size:14px;color:var(--meta);margin-top:4px;line-height:1.5}
  .pq-wait-card.pq-first .d{color:#E3ECF5}

  .pq-cashvalue-legend{display:flex;flex-direction:column;gap:10px;margin-top:24px}
  .pq-cv-row{display:flex;align-items:center;gap:10px;background:#fff;padding:12px 16px;border-radius:8px;box-shadow:0 6px 20px rgba(11,37,69,.08)}
  .pq-cv-dot{width:10px;height:10px;border-radius:50%}

  .pq-summary4{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:28px}
  .pq-summary4-card{background:#fff;border-radius:10px;padding:22px 18px;box-shadow:0 6px 20px rgba(11,37,69,.08)}
  .pq-summary4-card.pq-accent{background:var(--teal);color:#fff}
  .pq-summary4-card .k{font-size:13px;color:#7C88A0;text-transform:uppercase;letter-spacing:.05em}
  .pq-summary4-card.pq-accent .k{color:#FFD0D8}
  .pq-summary4-card .v{font-size:26px;font-weight:800;font-family:var(--serif);margin-top:8px}
  .pq-summary4-card .s{font-size:12px;color:#7C88A0;margin-top:6px}
  .pq-summary4-card.pq-accent .s{color:#FFD0D8}

  .pq-steps{display:flex;flex-direction:column;gap:14px;margin-top:32px}
  .pq-step-card{background:#fff;border-radius:8px;padding:20px;box-shadow:0 6px 20px rgba(11,37,69,.08)}
  .pq-step-card .k{font-size:13px;color:#7C88A0;text-transform:uppercase;letter-spacing:.05em}
  .pq-step-card .v{font-size:17px;font-weight:600;margin-top:6px}

  .pq-agent-footer{margin-top:40px;border-top:1px solid var(--line);padding-top:26px;display:flex;gap:16px;align-items:flex-start}
  .pq-agent-footer img{width:56px;height:56px;border-radius:10px;object-fit:cover;flex-shrink:0}
  .pq-agent-footer .name{font-size:19px;font-weight:700}
  .pq-agent-footer .meta{font-size:15px;color:var(--meta);margin-top:4px}
  .pq-agent-footer .fine{font-size:13px;color:#7C88A0;margin-top:18px;line-height:1.5}

  .pq-contact-fields{display:flex;flex-direction:column;gap:14px;margin-top:32px}
  .pq-contact-field{background:#fff;border-radius:10px;padding:6px 18px;box-shadow:0 6px 20px rgba(11,37,69,.08)}
  .pq-contact-field input{width:100%;border:none;outline:none;background:transparent;font-family:var(--sans);font-size:16px;color:var(--ink);padding:14px 0}
  .pq-cta{width:100%;margin-top:20px;background:var(--teal);color:#fff;border:none;border-radius:100px;padding:18px 24px;font-family:var(--sans);font-size:16px;font-weight:700;cursor:pointer;box-shadow:0 10px 28px rgba(23,141,147,.3)}
  .pq-cta:hover{filter:brightness(1.05)}
  .pq-contact-note{margin-top:18px;font-size:13px;color:#7C88A0;line-height:1.5;text-align:center}

  .pq-outro{min-height:60vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;border-top:1px solid var(--line)}
  .pq-outro-badge{width:84px;height:84px;border-radius:50%;background:var(--teal);display:flex;align-items:center;justify-content:center;animation:pqPulse 2.4s ease-in-out infinite}
  .pq-outro-tagline{font-family:var(--serif);font-style:italic;font-size:30px;font-weight:600;color:var(--teal);margin-top:26px}
  .pq-outro-sub{font-size:15px;color:var(--meta);margin-top:8px}

  @media print{
    /* Fixed-position overlays/controls make no sense on paper - same
       lesson as the old renderer's print CSS (see renderQuotation.js's
       SHARED_STYLE comment). Found the same way: printing a fresh preview
       that had never been clicked past the "tap anywhere to continue"
       intro would otherwise bury the whole printed page under it. */
    .pq-intro-overlay, .pq-sound-btn{display:none!important}
    #pq-doc .pq-reveal, #pq-doc .pq-zoom{opacity:1!important;transform:none!important}
    #pq-doc .pq-kb-section{min-height:0!important;page-break-inside:avoid}
    #pq-doc *{animation:none!important;transition:none!important}
    #pq-doc, #pq-doc *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  }
`;
      var NARRATIVE_RUNTIME = `
(function () {
  var root = document.getElementById('pq-doc');
  if (!root) return;

  var intro = root.querySelector('.pq-intro-overlay');
  if (intro) {
    intro.addEventListener('click', function () {
      intro.style.opacity = '0';
      intro.style.visibility = 'hidden';
    });
  }

  // AssetManager (renderer/AssetManager.js) always resolves to *some*
  // URL, even if that file doesn't actually exist on disk yet (no
  // production photography supplied at render time). This is the other
  // half of that contract: never show a broken-image icon - swap to the
  // sibling placeholder panel instead, exactly once per image.
  root.querySelectorAll('img.pq-photo').forEach(function (img) {
    img.addEventListener('error', function () {
      img.style.display = 'none';
      var placeholder = img.nextElementSibling;
      if (placeholder && placeholder.classList.contains('pq-kb-placeholder')) {
        placeholder.style.display = 'flex';
      }
    }, { once: true });
  });

  var soundBtn = root.querySelector('.pq-sound-btn');
  var audioOn = false;
  function setSoundLabel() {
    if (!soundBtn) return;
    var label = soundBtn.querySelector('.pq-sound-label');
    if (label) label.textContent = audioOn ? 'Sound on' : 'Tap for sound';
  }
  if (soundBtn) {
    soundBtn.addEventListener('click', function () {
      audioOn = !audioOn;
      setSoundLabel();
      if (!audioOn && window.speechSynthesis) window.speechSynthesis.cancel();
    });
  }

  var narrateEls = Array.prototype.slice.call(root.querySelectorAll('[data-narrate]'));
  if (narrateEls.length && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      if (!audioOn) return;
      entries.forEach(function (entry) {
        if (entry.isIntersecting && entry.intersectionRatio > 0.55 && !entry.target.hasAttribute('data-narrated')) {
          entry.target.setAttribute('data-narrated', '');
          var text = entry.target.getAttribute('data-narrate');
          if (text && window.speechSynthesis) {
            window.speechSynthesis.cancel();
            var utter = new SpeechSynthesisUtterance(text);
            utter.rate = 0.98;
            window.speechSynthesis.speak(utter);
          }
        }
      });
    }, { threshold: [0, 0.55, 1] });
    narrateEls.forEach(function (el) { io.observe(el); });
  }

  var revealEls = Array.prototype.slice.call(root.querySelectorAll('.pq-reveal, [data-final-width], [data-final-offset]'));
  var zoomEls = Array.prototype.slice.call(root.querySelectorAll('.pq-zoom'));

  function applyFinal(el) {
    if (el.hasAttribute('data-final-width')) el.style.width = el.getAttribute('data-final-width');
    if (el.hasAttribute('data-final-offset')) el.style.strokeDashoffset = el.getAttribute('data-final-offset');
  }

  function step() {
    var vh = window.innerHeight || 800;
    for (var i = 0; i < revealEls.length; i++) {
      var el = revealEls[i];
      if (el.hasAttribute('data-visible')) continue;
      var r = el.getBoundingClientRect();
      if (r.top < vh * 0.92) {
        el.setAttribute('data-visible', '');
        applyFinal(el);
      }
    }
    var zStart = vh * 0.88, zEnd = vh * 0.4;
    for (var j = 0; j < zoomEls.length; j++) {
      var z = zoomEls[j];
      var rz = z.getBoundingClientRect();
      var center = rz.top + rz.height / 2;
      var progress = (zStart - center) / (zStart - zEnd);
      progress = progress < 0 ? 0 : progress > 1 ? 1 : progress;
      z.style.opacity = String(progress);
      z.style.transform = 'scale(' + (0.72 + 0.28 * progress).toFixed(3) + ')';
    }
  }

  step();
  var running = true;
  function tick() {
    if (!running) return;
    step();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  window.addEventListener('beforeunload', function () { running = false; });
})();
`;
      function renderIntroOverlay(vm) {
        return `
  <div class="pq-intro-overlay" style="position:fixed;inset:0;z-index:100;display:flex;flex-direction:column;align-items:center;justify-content:center;background:linear-gradient(165deg,#F6C9D6 0%,#F2D3E2 18%,#E7D7EC 38%,#D6E1F0 60%,#C3E7F3 82%,#BEEAF4 100%);cursor:pointer;transition:opacity .6s,visibility .6s">
    <div class="pq-brandmark">Prudential BSN Takaful</div>
    <div style="font-family:var(--serif);font-style:italic;font-size:26px;color:var(--teal);margin-top:18px">Anda Inspirasi Kami</div>
    <div style="font-size:12px;color:#7C88A0;letter-spacing:.1em;text-transform:uppercase;margin-top:28px">Tap anywhere to continue</div>
  </div>
  <button type="button" class="pq-sound-btn" style="position:fixed;top:16px;right:16px;z-index:50;background:rgba(11,37,69,.85);color:#fff;border:none;border-radius:100px;padding:10px 16px;font-family:var(--sans);font-size:13px;font-weight:600;display:flex;align-items:center;gap:8px;cursor:pointer;box-shadow:0 6px 16px rgba(11,37,69,.3)">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4z"></path><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>
    <span class="pq-sound-label">Tap for sound</span>
  </button>`;
      }
      function renderHero(vm) {
        return `
  <section class="pq-hero">
    <div class="pq-reveal"><div class="pq-brandmark">Prudential BSN Takaful</div></div>
    <div class="pq-award pq-reveal d1">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C9962E" stroke-width="1.8"><path d="M12 2l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-1.5z"></path></svg>
      Nation's Pride \u2014 Best Takaful Operator
    </div>
    <div class="pq-tagline pq-reveal d2">Anda Inspirasi Kami</div>
    <div class="pq-tagline-en pq-reveal d2">You are our inspiration</div>
    <div class="pq-hero-title pq-reveal d3">A ${textOr(vm.productName, "Family Takaful")} plan, built around ${textOr(vm.clientName, "you")}</div>
    <div class="pq-hero-sub pq-reveal d4">Prepared by ${textOr(vm.agentName, "your servicing agent")}${vm.agencyName ? ` \xB7 ${escapeHtml2(vm.agencyName)}` : ""}</div>
    <div class="pq-scroll-cue pq-reveal d4">Scroll to begin<br>\u2193</div>
  </section>`;
      }
      function renderQuestionHook(vm) {
        const name = vm.clientFirstName || "you";
        return `
  <section>
    <div class="pq-eyebrow pq-reveal">A Question Before The Numbers</div>
    <div class="pq-headline pq-reveal d1" style="font-size:38px">What happens to your family, ${escapeHtml2(name)}, if tomorrow doesn't go as planned?</div>
    <div class="pq-lede pq-reveal d2">A single hospital stay in Malaysia can cost more than 5 years of protection. This proposal makes sure you're never caught unprepared.</div>
    <div class="pq-stat-pill pq-reveal d3"><b>15%</b><span>medical inflation<br>in Malaysia, 2024</span></div>
    <div class="pq-scroll-cue pq-reveal d4" style="margin-top:56px">Scroll to continue<br>\u2193</div>
  </section>`;
      }
      function renderTwoPaths(vm) {
        const monthly = vm.monthlyCompact || "your contribution";
        return `
  <section style="border-top:1px solid var(--line)">
    <div class="pq-eyebrow pq-reveal">Two Paths, ${escapeHtml2(monthly)} a Month</div>
    <div class="pq-headline pq-reveal d1" style="font-size:26px">Where does the money go \u2014 and what happens when life doesn't wait?</div>
  </section>
  <section style="padding-top:0">
    <div class="pq-path-grid">
      <div class="pq-path-card pq-reveal d1">
        <div class="pq-path-label">Path A</div>
        <div class="pq-path-title">${escapeHtml2(monthly)}/month \u2192 Savings Account</div>
        <div class="pq-path-desc">Money sits and waits \u2014 yours to keep, capped at what you've saved.</div>
      </div>
      <div class="pq-path-card pq-dark pq-reveal d2">
        <div class="pq-path-label">Path B</div>
        <div class="pq-path-title">${escapeHtml2(monthly)}/month \u2192 Takaful Fund</div>
        <div class="pq-path-desc">Money is pooled into a shared fund \u2014 ready to pay far more than you put in.</div>
      </div>
    </div>
  </section>`;
      }
      function renderDrama(vm) {
        return `
  <section class="pq-drama">
    <div class="pq-kb-media">${imageWithFallback(AssetManager.getAccidentImage(), "Accident scenario")}</div>
    <div class="pq-kb-overlay"></div>
    <div class="pq-eyebrow pq-zoom">Then, an accident happens</div>
    <div class="pq-headline pq-zoom">The hospital needs <span class="pq-figure">RM100,000</span> \u2014 now.</div>
  </section>`;
      }
      function renderPathAConsequence(vm) {
        return `
  <section>
    <div class="pq-eyebrow pq-reveal" style="color:#B5493D">Path A \u2014 Saved At The Bank</div>
    <div class="pq-headline pq-reveal d1" style="font-size:26px">Without protection, the gap has to be found somewhere.</div>
    <div class="pq-consequence-steps">
      <div class="pq-consequence-step pq-reveal d1"><div class="pq-step-title">Step 1 \u2014 Sell what she can</div><div class="pq-step-desc">Jewellery, a vehicle, anything of value \u2014 liquidated fast, often below worth.</div></div>
      <div class="pq-consequence-step pq-reveal d2"><div class="pq-step-title">Step 2 \u2014 Still not enough</div><div class="pq-step-desc">Savings and sale proceeds combined still fall short.</div></div>
      <div class="pq-consequence-step pq-reveal d3"><div class="pq-step-title">Step 3 \u2014 Borrow from the bank</div><div class="pq-step-desc">A loan closes the gap \u2014 with interest, for years to come.</div></div>
      <div class="pq-consequence-step pq-warn pq-reveal d4"><div class="pq-step-title">Step 4 \u2014 If still not enough, ask family and friends</div><div class="pq-step-desc">Crowdfunding or borrowing from loved ones \u2014 during the hardest week of her life.</div></div>
    </div>
  </section>`;
      }
      function renderPathBOutcome(vm) {
        return `
  <section>
    <div class="pq-eyebrow pq-reveal">Path B \u2014 Protected By Takaful</div>
    <div class="pq-headline pq-reveal d1" style="font-size:26px">${escapeHtml2(vm.clientFirstName || "She")} doesn't make a single call.</div>
    <div class="pq-protected-card pq-reveal d2">
      <div class="pq-protected-figure">RM100,000 \u2014 settled cashless, at the hospital.</div>
      <div class="pq-protected-note">No selling, no borrowing, no asking. Her card carries the cost \u2014 she carries on recovering.</div>
    </div>
    <div class="pq-source-note pq-reveal d4" style="margin-top:20px">Illustrative only. Bank savings scenario assumes a typical Malaysian savings account rate; actual rates vary by bank. Medical coverage subject to waiting periods, panel hospital terms, and co-payment \u2014 see the sections below.</div>
  </section>`;
      }
      function renderQuotationSummary(vm) {
        return `
  <section class="pq-summary-card">
    <div class="pq-reveal" style="font-size:18px;color:var(--meta);font-weight:500">Prepared exclusively for</div>
    <div class="pq-summary-name pq-reveal d1">${textOr(vm.clientName, "Client")}</div>
    <div class="pq-summary-rows pq-reveal d2">
      <div class="pq-summary-row"><span class="l">Plan</span><span class="r">${textOr(vm.productName)}</span></div>
      <div class="pq-summary-row"><span class="l">Monthly Total Amount Payable</span><span class="r">${vm.monthlyFormatted ? escapeHtml2(vm.monthlyFormatted) : naSpan()}</span></div>
      <div class="pq-summary-row"><span class="l">Coverage Term</span><span class="r">${vm.basicPlanTerm != null ? `${vm.basicPlanTerm} Years` : naSpan()}</span></div>
    </div>
    <div class="pq-reveal d3" style="margin-top:44px;font-size:15px;color:var(--meta);line-height:1.5">
      Presented by <b style="color:var(--ink)">${textOr(vm.agentName, "your servicing agent")}</b><br>
      ${vm.agentCode ? `Takaful Agent ${escapeHtml2(vm.agentCode)}${vm.agencyName ? ` \xB7 ${escapeHtml2(vm.agencyName)}` : ""}<br>` : ""}
      <span style="color:#7C88A0">Illustration only.</span>
    </div>
  </section>`;
      }
      function renderWhyThisMatters(vm) {
        const stats = [
          { figure: "15%", label: "Medical inflation in Malaysia, 2024" },
          { figure: "<50%", label: "Malaysians with any medical insurance" },
          { figure: "RM553K", label: "Average protection gap per family" },
          { figure: "55%+", label: "Malaysians with no personal health insurance at all" },
          { figure: "RM80K", label: "Typical private heart-surgery bill" }
        ];
        return `
  <section style="border-top:1px solid var(--line)">
    <div class="pq-eyebrow pq-reveal">Why This Matters \u2014 Malaysia, 2026</div>
    <div class="pq-headline pq-reveal d1" style="font-size:30px">The cost of getting sick is rising faster than most families can save.</div>
    <div class="pq-stat-grid">
      ${stats.map((s, i) => `
      <div class="pq-stat-card pq-reveal d${Math.min(i + 1, 4)}">
        <div>
          <div class="pq-stat-figure">${escapeHtml2(s.figure)}</div>
          <div class="pq-stat-label">${escapeHtml2(s.label)}</div>
        </div>
      </div>`).join("")}
    </div>
    <div class="pq-source-note pq-reveal d4">Sources: Aon-Hewitt (2024), Statista (2024), LIAM Underinsurance Study, Statista/Qoala (2023), NHMS 2019/PubMed underinsured study.</div>
  </section>`;
      }
      function renderOneDiagnosisAway(vm) {
        const bars = [
          { label: "Heart Surgery", amount: 8e4, pct: 100 },
          { label: "Stroke Treatment", amount: 75e3, pct: 94 },
          { label: "Cancer Treatment", amount: 56e3, pct: 70 },
          { label: "Kidney Dialysis (per year)", amount: 36e3, pct: 45 }
        ];
        const yourAmount = vm.totalAnnualContribution;
        const yourPct = yourAmount != null ? Math.max(1, Math.min(100, yourAmount / 8e4 * 100)) : null;
        return `
  <section style="border-top:1px solid var(--line)">
    <div class="pq-eyebrow pq-reveal">One Diagnosis Away</div>
    <div class="pq-headline pq-reveal d1" style="font-size:28px">Typical private treatment costs for Malaysia's leading critical illnesses</div>
    <div class="pq-cost-list">
      ${bars.map((b, i) => `
      <div class="pq-cost-row pq-reveal d${Math.min(i + 1, 3)}">
        <div class="pq-cost-head"><span>${escapeHtml2(b.label)}</span><span style="font-weight:700">${escapeHtml2(moneyRM(b.amount))}</span></div>
        <div class="pq-cost-track"><div class="pq-cost-fill" style="width:${b.pct}%"></div></div>
      </div>`).join("")}
      ${yourAmount != null ? `
      <div class="pq-cost-row pq-reveal d4">
        <div class="pq-cost-head"><span>${textOr(vm.clientFirstName, "You")} Pays / Year</span><span style="font-weight:700">${escapeHtml2(moneyRM(yourAmount))}</span></div>
        <div class="pq-cost-track"><div class="pq-cost-fill pq-gold" style="width:${yourPct}%"></div></div>
      </div>` : ""}
    </div>
    <div class="pq-source-note pq-reveal d4">Sources: Statista/Qoala (2023), bluebricks.com.my.</div>
  </section>`;
      }
      function renderClientProfile(vm) {
        return `
  <section style="border-top:1px solid var(--line)">
    <div class="pq-eyebrow pq-reveal">A. Client Profile</div>
    <div class="pq-headline pq-reveal d1" style="font-size:30px">This quotation is built around you</div>
    <div class="pq-profile-grid">
      <div class="pq-profile-item pq-wide pq-reveal d1"><div class="k">Name</div><div class="v">${textOr(vm.clientName)}</div></div>
      <div class="pq-profile-item pq-reveal d1"><div class="k">Age</div><div class="v">${vm.ageNextBirthday != null ? `${vm.ageNextBirthday} nbd \xB7 ${textOr(vm.gender)}` : naSpan()}</div></div>
      <div class="pq-profile-item pq-reveal d2"><div class="k">Smoker</div><div class="v">${textOr(vm.smokerStatus)}</div></div>
      <div class="pq-profile-item pq-reveal d2"><div class="k">Occupation</div><div class="v">${textOr(vm.occupationClass)}</div></div>
      <div class="pq-profile-item pq-reveal d3"><div class="k">Purpose</div><div class="v">${textOr(vm.purpose)}</div></div>
      <div class="pq-profile-item pq-wide pq-reveal d3"><div class="k">Payment Mode</div><div class="v">${textOr(vm.paymentMode)}</div></div>
    </div>
    <div class="pq-reveal d4" style="margin-top:24px;font-size:15px;color:var(--meta);line-height:1.5">Product: ${textOr(vm.productName)} \u2014 Regular Contribution Family Takaful. Shariah-compliant, participates in investment profit sharing.</div>
  </section>`;
      }
      function renderMedicalCardIntro(vm) {
        return `
  <section style="border-top:1px solid var(--line);padding-bottom:20px">
    <div class="pq-eyebrow pq-reveal">${textOr(vm.medicalRiderName, "Medical Rider")}</div>
    <div class="pq-headline pq-reveal d1" style="font-size:30px">Your medical card, in plain terms</div>
  </section>`;
      }
      function renderPlanExplainer(vm) {
        const tierLabel = [vm.medicalRiderName, vm.medicalPlanTier].filter(Boolean).join(" ");
        let headline;
        let body;
        if (vm.boost) {
          const conditionText = vm.boost.conditions.length ? vm.boost.conditions.join(", ") : "a covered critical illness";
          headline = `${textOr(tierLabel, "Your plan")} gives you ${textOr(vm.annualLimit, "your annual limit")} a year, with a permanent boost of ${escapeHtml2(vm.boost.amount)} if it turns serious.`;
          body = `For ${vm.monthlyFormatted ? escapeHtml2(vm.monthlyFormatted) : "your monthly contribution"}, your ${textOr(vm.annualLimit, "annual limit")} automatically increases by ${escapeHtml2(vm.boost.amount)} the moment you're diagnosed with ${escapeHtml2(conditionText)} \u2014 permanently, every year after.`;
        } else {
          headline = `${textOr(tierLabel, "Your plan")} gives you ${textOr(vm.annualLimit, "protection")} a year to lean on.`;
          body = `For ${vm.monthlyFormatted ? escapeHtml2(vm.monthlyFormatted) : "your monthly contribution"}, your medical card covers eligible hospitalisation and treatment up to your ${textOr(vm.annualLimit, "annual limit")}.`;
        }
        return `
  <section style="padding-bottom:44px">
    <div class="pq-eyebrow pq-reveal">Your Plan \u2014 ${textOr(tierLabel)}</div>
    <div class="pq-headline pq-reveal d1" style="font-size:28px">${headline}</div>
    <div class="pq-lede pq-reveal d2">${body}</div>
    <div class="pq-inline-photo-wrap pq-reveal d3">${imageWithFallback(AssetManager.getPlanImage(vm.medicalPlanTier), tierLabel || "Plan", "pq-inline-photo")}</div>
  </section>`;
      }
      function donutSegStyle(fraction, offsetSoFar, circ) {
        return `stroke-dashoffset:${(circ * (1 - fraction)).toFixed(1)};transform:rotate(${(offsetSoFar * 360).toFixed(1)}deg);transform-origin:100px 100px;`;
      }
      function renderContributionBreakdown(vm) {
        const protection = vm.protectionContribution || 0;
        const wakalah = vm.wakalahCertificateCharge || 0;
        const isa = vm.isaContribution || 0;
        const total = protection + wakalah + isa;
        const circ = 527.8;
        let seg1Style = "";
        let seg2Style = "";
        let seg3Style = "";
        if (total > 0) {
          const f1 = protection / total;
          const f2 = wakalah / total;
          const f3 = isa / total;
          seg1Style = `stroke-dashoffset:${(circ * (1 - f1)).toFixed(1)};`;
          seg2Style = donutSegStyle(f2, f1, circ);
          seg3Style = donutSegStyle(f3, f1 + f2, circ);
        }
        return `
  <section>
    <div class="pq-eyebrow pq-reveal">B. How Your Contribution Works</div>
    <div class="pq-headline pq-reveal d1" style="font-size:30px">${vm.monthlyCompact ? escapeHtml2(vm.monthlyCompact) : "Your contribution"}, broken down</div>
    <div class="pq-donut-wrap pq-reveal d2">
      <svg viewBox="0 0 200 200" style="width:100%;height:100%;transform:rotate(-90deg)">
        <circle cx="100" cy="100" r="84" fill="none" stroke="#FFFFFF" stroke-width="26"></circle>
        <circle class="pq-donut-seg" data-final-offset="${(circ * (1 - (total ? protection / total : 0))).toFixed(1)}" cx="100" cy="100" r="84" fill="none" stroke="#0B2545" stroke-width="26" stroke-linecap="round" stroke-dasharray="${circ}" style="stroke-dashoffset:${circ};"></circle>
        <circle class="pq-donut-seg" cx="100" cy="100" r="84" fill="none" stroke="#178D93" stroke-width="26" stroke-linecap="round" stroke-dasharray="${circ}" style="${seg2Style}" data-visible></circle>
        <circle class="pq-donut-seg" cx="100" cy="100" r="84" fill="none" stroke="#C9962E" stroke-width="26" stroke-linecap="round" stroke-dasharray="${circ}" style="${seg3Style}" data-visible></circle>
      </svg>
      <div class="pq-donut-total"><div class="k">Total / month</div><div class="v">${vm.monthlyCompact ? escapeHtml2(vm.monthlyCompact) : naSpan()}</div></div>
    </div>
    <div class="pq-contrib-list">
      <div class="pq-contrib-item pq-reveal d2"><span class="pq-contrib-dot" style="background:#0B2545"></span><div><div class="k">${moneyRM(protection) ? escapeHtml2(moneyRM(protection)) : naSpan()} \xB7 Protection Contribution</div><div class="d">Funds your ${textOr(vm.medicalRiderName, "medical rider")}.</div></div></div>
      <div class="pq-contrib-item pq-reveal d3"><span class="pq-contrib-dot" style="background:#178D93"></span><div><div class="k">${moneyRM(wakalah) ? escapeHtml2(moneyRM(wakalah)) : naSpan()} \xB7 Wakalah Charge</div><div class="d">Certificate administration &amp; service fee.</div></div></div>
      <div class="pq-contrib-item pq-reveal d4"><span class="pq-contrib-dot" style="background:#C9962E"></span><div><div class="k">${moneyRM(isa) ? escapeHtml2(moneyRM(isa)) : naSpan()} \xB7 Individual Special Account</div><div class="d">Your savings account \u2014 builds cash value over time.</div></div></div>
    </div>
  </section>`;
      }
      function renderKenBurnsAdmission(vm) {
        return `
  <section class="pq-kb-section" data-narrate="${escapeHtml2(`The moment you're admitted, your ${vm.annualLimit || "annual limit"} starts working for you.`)}">
    <div class="pq-kb-media">${imageWithFallback(AssetManager.getHospitalImage(), "Hospital entrance")}</div>
    <div class="pq-kb-overlay"></div>
    <div class="pq-kb-content">
      <div class="pq-eyebrow pq-zoom">Step 1 \u2014 You're admitted</div>
      <div class="pq-headline pq-zoom">The moment you're admitted, your <span style="color:#4FD1D9">${textOr(vm.annualLimit, "annual limit")}</span> starts working for you.</div>
    </div>
  </section>`;
      }
      function renderKenBurnsWard(vm) {
        const dayNote = vm.roomBoardDayNote ? escapeHtml2(vm.roomBoardDayNote) : "each rider year";
        return `
  <section class="pq-kb-section" data-narrate="${escapeHtml2(`Your Hospital Room and Board benefit takes over from here, ${dayNote}.`)}">
    <div class="pq-kb-media">${imageWithFallback(AssetManager.getRoomBoardImage(vm.roomBoardAmount), "Private hospital ward")}</div>
    <div class="pq-kb-overlay"></div>
    <div class="pq-kb-content">
      <div class="pq-eyebrow pq-zoom">Step 2 \u2014 You're moved to a ward</div>
      <div class="pq-headline pq-zoom">Your Hospital Room &amp; Board benefit takes over from here${vm.roomBoardDayNote ? ` \u2014 ${escapeHtml2(vm.roomBoardDayNote)}` : ""}.</div>
    </div>
  </section>`;
      }
      function renderKenBurnsSurgery(vm) {
        const surgery = findBenefit(vm.benefitItems, "Day Surgery");
        const covered = surgery && /as charged/i.test(surgery.value || "") ? "as charged" : "per your certificate terms";
        return `
  <section class="pq-kb-section" data-narrate="Surgical fees and in-hospital treatment are covered, cashless at panel hospitals.">
    <div class="pq-kb-media">${imageWithFallback(AssetManager.getSurgeryImage(), "Operating theatre")}</div>
    <div class="pq-kb-overlay"></div>
    <div class="pq-kb-content">
      <div class="pq-eyebrow pq-zoom">If surgery is needed</div>
      <div class="pq-headline pq-zoom">Surgical fees and in-hospital treatment are covered <span style="color:#4FD1D9">${escapeHtml2(covered)}</span> \u2014 cashless at panel hospitals.</div>
    </div>
  </section>`;
      }
      function renderKenBurnsRoom(vm) {
        if (!vm.roomBoardAmount) return "";
        return `
  <section class="pq-kb-section" data-narrate="${escapeHtml2(`Your Hospital Room and Board benefit covers ${vm.roomBoardAmount} a day, no need to touch your own savings.`)}">
    <div class="pq-kb-media">${imageWithFallback(AssetManager.getRecoveryImage(), "Hospital room")}</div>
    <div class="pq-kb-overlay"></div>
    <div class="pq-kb-content">
      <div class="pq-kb-figure">${escapeHtml2(vm.roomBoardAmount)}<small>/day</small></div>
      <div class="pq-eyebrow pq-zoom" style="margin-top:20px">Step 3 \u2014 What that gets you</div>
      <div class="pq-headline pq-zoom" style="font-size:26px">Covered ${vm.roomBoardDayNote ? escapeHtml2(vm.roomBoardDayNote) : "per your certificate"} \u2014 no need to touch your own savings.</div>
    </div>
  </section>`;
      }
      function renderKenBurnsCriticalIllness(vm) {
        if (!vm.boost) return "";
        const conditionText = vm.boost.conditions.length ? vm.boost.conditions.join(", ") : "a covered critical illness";
        return `
  <section class="pq-kb-section" data-narrate="${escapeHtml2(`Diagnosed with ${conditionText}? Your annual limit gets a permanent boost of ${vm.boost.amount}, from the day of diagnosis onward.`)}">
    <div class="pq-kb-media">${imageWithFallback(AssetManager.getFinancialImage(), "Critical illness financial protection")}</div>
    <div class="pq-kb-overlay"></div>
    <div class="pq-kb-content">
      <div class="pq-eyebrow pq-zoom">Step 4 \u2014 If it's serious</div>
      <div class="pq-headline pq-zoom">Diagnosed with <span style="color:#4FD1D9">${escapeHtml2(conditionText)}</span>? Your limit gets a permanent boost.</div>
      <div class="pq-kb-figure">+${escapeHtml2(vm.boost.amount)}</div>
      <div class="pq-kb-note">On top of your base ${textOr(vm.annualLimit, "annual limit")} \u2014 permanently, every year, from the day of diagnosis onward.</div>
    </div>
  </section>`;
      }
      function renderEverythingElse(vm) {
        const items = vm.benefitItems || [];
        if (!items.length) return "";
        return `
  <section>
    <div class="pq-eyebrow pq-reveal">Everything else it covers</div>
    <div class="pq-benefit-list">
      ${items.map((item, i) => `
      <div class="pq-benefit-card pq-reveal d${Math.min(i % 4 + 1, 4)}">
        <svg class="pq-benefit-dot" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 12h4l2-6 4 12 2-6h4"></path></svg>
        <div>
          <div class="k">${escapeHtml2(item.label)}</div>
          <div class="d">${item.value ? escapeHtml2(item.value) : naSpan()}</div>
        </div>
      </div>`).join("")}
    </div>
    <div class="pq-source-note pq-reveal d4" style="margin-top:22px">Co-payment: ${textOr(vm.coPaymentOption, "per certificate")} applies. Cashless facility available at PruBSN panel hospitals. Full terms in the certificate document.</div>
  </section>`;
      }
      function renderGuaranteedProtection(vm) {
        const facts = [];
        if (vm.productFacts.extensionToAge100) {
          facts.push({ k: "Extension of Certificate Term", d: "Can continue to age 100, cash value permitting." });
        }
        if (vm.productFacts.pidmProtected) {
          facts.push({ k: "PIDM Protected", d: "Protected by PIDM's TIPS, up to limits." });
        }
        return `
  <section style="border-top:1px solid var(--line)">
    <div class="pq-eyebrow pq-reveal">C. Guaranteed Protection</div>
    <div class="pq-headline pq-reveal d1" style="font-size:30px">What is promised, regardless of markets</div>
    <div class="pq-inline-photo-wrap pq-reveal d1">${imageWithFallback(AssetManager.getGuaranteeImage(), "Guaranteed protection", "pq-inline-photo")}</div>
    <div class="pq-guarantee-hero pq-reveal d2">
      <div class="pq-eyebrow">Death / TPD Benefit</div>
      <div class="pq-figure">${vm.guaranteedDeathTPDBenefit != null ? escapeHtml2(moneyRM(vm.guaranteedDeathTPDBenefit)) : naSpan()}</div>
      <div class="pq-note">Paid if ${textOr(vm.clientFirstName, "the covered person")} passes away or suffers Total Permanent Disability, before age ${vm.coverageToAge != null ? escapeHtml2(String(vm.coverageToAge)) : naSpan()} next birthday.</div>
    </div>
    <div class="pq-fact-list">
      <div class="pq-fact-card pq-reveal d2"><div class="k">${vm.basicPlanTerm != null ? `${vm.basicPlanTerm}-Year Coverage Term` : "Coverage Term"}</div><div class="d">${vm.coverageStartAge != null && vm.coverageToAge != null ? `Age ${escapeHtml2(String(vm.coverageStartAge))} to age ${escapeHtml2(String(vm.coverageToAge))} next birthday.` : naSpan()}</div></div>
      ${facts.map((f, i) => `<div class="pq-fact-card pq-reveal d${Math.min(i + 3, 4)}"><div class="k">${escapeHtml2(f.k)}</div><div class="d">${escapeHtml2(f.d)}</div></div>`).join("")}
    </div>
  </section>`;
      }
      function renderWaitingPeriods(vm) {
        if (!vm.waitingPeriods.length) return "";
        return `
  <section style="border-top:1px solid var(--line)">
    <div class="pq-eyebrow pq-reveal">Before Your Card Kicks In</div>
    <div class="pq-headline pq-reveal d1" style="font-size:28px">Waiting periods you should know about</div>
    <div class="pq-inline-photo-wrap pq-reveal d1">${imageWithFallback(AssetManager.getWaitingPeriodImage(), "Waiting period", "pq-inline-photo")}</div>
    <div class="pq-wait-list">
      ${vm.waitingPeriods.map((wp, i) => `
      <div class="pq-wait-card ${i === 0 ? "pq-first" : ""} pq-reveal d${Math.min(i + 1, 4)}">
        <div class="k">${wp.days} Day${wp.days === 1 ? "" : "s"}</div>
        <div class="d">${escapeHtml2(wp.description)}</div>
      </div>`).join("")}
    </div>
    <div class="pq-source-note pq-reveal d4">Source: PruBSN Product Disclosure Sheet, as extracted from this quotation's Product Illustration.</div>
  </section>`;
      }
      function renderCashValue(vm) {
        if (vm.cashValueX == null && vm.cashValueY == null) return "";
        return `
  <section style="border-top:1px solid var(--line)">
    <div class="pq-eyebrow pq-reveal">D. Non-Guaranteed Cash Value</div>
    <div class="pq-headline pq-reveal d1" style="font-size:28px">How your Individual Special Account could grow</div>
    <div class="pq-inline-photo-wrap pq-reveal d1">${imageWithFallback(AssetManager.getCashValueImage(), "Cash value growth", "pq-inline-photo")}</div>
    <div class="pq-reveal d2" style="margin-top:32px;position:relative">
      <svg viewBox="0 0 400 260" style="width:100%;height:auto;overflow:visible">
        <line x1="0" y1="240" x2="400" y2="240" stroke="rgba(11,37,69,0.15)" stroke-width="1"></line>
        <line x1="0" y1="150" x2="400" y2="150" stroke="rgba(11,37,69,0.08)" stroke-width="1"></line>
        <line x1="0" y1="60" x2="400" y2="60" stroke="rgba(11,37,69,0.08)" stroke-width="1"></line>
        <path class="pq-draw-path" data-final-offset="0" d="M0,240 L57,236 L114,232 L171,220 L229,193 L286,145 L343,84 L400,32" fill="none" stroke="#0B2545" stroke-width="4" stroke-linecap="round" stroke-dasharray="620" style="stroke-dashoffset:620"></path>
        <path class="pq-draw-path" data-final-offset="0" d="M0,240 L57,239 L114,237 L171,233 L229,222 L286,201 L343,167 L400,102" fill="none" stroke="#178D93" stroke-width="4" stroke-linecap="round" stroke-dasharray="620" style="stroke-dashoffset:620"></path>
      </svg>
      <div style="display:flex;justify-content:space-between;font-size:12px;color:#7C88A0;margin-top:8px">
        <span>Year 1</span><span>Mid-term</span><span>${vm.basicPlanTerm != null ? `Year ${vm.basicPlanTerm} / Maturity` : "Maturity"}</span>
      </div>
    </div>
    <div class="pq-cashvalue-legend pq-reveal d3">
      ${vm.cashValueY != null ? `<div class="pq-cv-row"><span class="pq-cv-dot" style="background:#0B2545"></span><span style="font-size:15px;font-weight:600">Scenario Y (5% p.a.): ${escapeHtml2(moneyRM(vm.cashValueY))}</span></div>` : ""}
      ${vm.cashValueX != null ? `<div class="pq-cv-row"><span class="pq-cv-dot" style="background:#178D93"></span><span style="font-size:15px;font-weight:600">Scenario X (2% p.a.): ${escapeHtml2(moneyRM(vm.cashValueX))}</span></div>` : ""}
    </div>
    <div class="pq-source-note pq-reveal d4" style="margin-top:24px">Illustrative only \u2014 not guaranteed. You may only receive the guaranteed death benefit upon death.</div>
  </section>`;
      }
      function renderFullPicture(vm) {
        const cards = [
          { k: "Contribution Paid", v: vm.totalContributionOverTerm != null ? moneyRM(vm.totalContributionOverTerm) : null, s: vm.basicPlanTerm != null ? `${vm.basicPlanTerm} years total` : "" },
          { k: "Guaranteed Benefit", v: vm.guaranteedDeathTPDBenefit != null ? moneyRM(vm.guaranteedDeathTPDBenefit) : null, s: "Death / TPD" },
          { k: "Cash Value (Y)", v: vm.cashValueY != null ? moneyRM(vm.cashValueY) : null, s: "At maturity", accent: true },
          { k: "Medical Coverage", v: vm.annualLimit, s: "Annual limit" }
        ];
        if (cards.every((c) => c.v == null)) return "";
        return `
  <section style="border-top:1px solid var(--line)">
    <div class="pq-eyebrow pq-reveal">E. The Full Picture</div>
    <div class="pq-headline pq-reveal d1">${vm.basicPlanTerm != null ? `${vm.basicPlanTerm} years, at a glance` : "At a glance"}</div>
    <div class="pq-inline-photo-wrap pq-reveal d1">${imageWithFallback(AssetManager.getCoverageImage(vm.annualLimit), "Medical coverage", "pq-inline-photo")}</div>
    <div class="pq-summary4">
      ${cards.map((c, i) => `
      <div class="pq-summary4-card ${c.accent ? "pq-accent" : ""} pq-reveal d${Math.min(i + 1, 4)}">
        <div class="k">${escapeHtml2(c.k)}</div>
        <div class="v">${c.v ? escapeHtml2(c.v) : naSpan()}</div>
        <div class="s">${escapeHtml2(c.s)}</div>
      </div>`).join("")}
    </div>
    <div class="pq-source-note pq-reveal d4" style="margin-top:24px">Illustrative only \u2014 actual values depend on real fund performance.</div>
  </section>`;
      }
      function renderReadyWhenYouAre(vm) {
        return `
  <section style="border-top:1px solid var(--line)">
    <div class="pq-eyebrow pq-reveal">Ready When You Are</div>
    <div class="pq-headline pq-reveal d1" style="font-size:34px">Let's protect what you've worked for \u2014 before life asks you to.</div>
    <div class="pq-steps">
      <div class="pq-step-card pq-reveal d1"><div class="k">Step 1</div><div class="v">Confirm your details &amp; health declaration</div></div>
      <div class="pq-step-card pq-reveal d2"><div class="k">Step 2</div><div class="v">Sign the proposal form</div></div>
      <div class="pq-step-card pq-reveal d3"><div class="k">Step 3</div><div class="v">First contribution &amp; certificate issued</div></div>
    </div>
    <div class="pq-agent-footer pq-reveal d4">
      ${vm.agencyLogo ? `<img src="${escapeHtml2(vm.agencyLogo)}" alt="${escapeHtml2(vm.agencyName || "Agency")}">` : ""}
      <div>
        <div class="name">${textOr(vm.agentName, "Your servicing agent")}</div>
        <div class="meta">${vm.agentCode ? `Takaful Agent ${escapeHtml2(vm.agentCode)}` : ""}${vm.agencyName ? ` \xB7 ${escapeHtml2(vm.agencyName)}` : ""} \xB7 Prudential BSN Takaful Berhad</div>
        <div class="fine">This is a product illustration for discussion purposes only. Not a certificate document.</div>
      </div>
    </div>
  </section>`;
      }
      function renderContactSection(vm) {
        return `
  <section style="border-top:1px solid var(--line);padding-bottom:calc(env(safe-area-inset-bottom) + 80px)">
    <div class="pq-eyebrow pq-reveal">One Last Thing</div>
    <div class="pq-headline pq-reveal d1" style="font-size:34px">Thank you for taking the time${vm.clientFirstName ? `, ${escapeHtml2(vm.clientFirstName)}` : ""}.</div>
    <div class="pq-lede pq-reveal d1">This proposal reflects real numbers, real coverage, and a real conversation between us \u2014 no fine print surprises. When you're ready to move forward, continue your application below.</div>
    <div class="pq-contact-fields">
      <div class="pq-contact-field pq-reveal d2"><input id="pq-name" type="text" placeholder="Full name (as per IC)" value="${escapeHtml2(vm.clientName || "")}"></div>
      <div class="pq-contact-field pq-reveal d2"><input id="pq-ic" type="text" placeholder="IC number"></div>
      <div class="pq-contact-field pq-reveal d3"><input id="pq-phone" type="tel" placeholder="Phone number"></div>
      <div class="pq-contact-field pq-reveal d3"><input id="pq-email" type="email" placeholder="Email address"></div>
    </div>
    <button type="button" id="paf-continue-btn" class="pq-cta">Continue Application &rarr;</button>
    <div class="pq-contact-note pq-reveal d4">Your details stay with your agent \u2014 nothing is sent anywhere else until you submit the application below.</div>
  </section>`;
      }
      function renderOutro() {
        return `
  <section class="pq-outro">
    <div class="pq-outro-badge">
      <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.2"><path d="M20 6L9 17l-5-5"></path></svg>
    </div>
    <div class="pq-outro-tagline">Anda Inspirasi Kami</div>
    <div class="pq-outro-sub">Prudential BSN Takaful</div>
  </section>`;
      }
      function renderNarrativeQuotationHtml(data, agentReview = {}) {
        const vm = buildViewModel(data, agentReview);
        const clientName = vm.clientName || "Client";
        const sections = [
          renderHero(vm),
          renderQuestionHook(vm),
          renderTwoPaths(vm),
          renderDrama(vm),
          renderPathAConsequence(vm),
          renderPathBOutcome(vm),
          renderQuotationSummary(vm),
          renderWhyThisMatters(vm),
          renderOneDiagnosisAway(vm),
          renderClientProfile(vm),
          renderMedicalCardIntro(vm),
          renderPlanExplainer(vm),
          renderContributionBreakdown(vm),
          renderKenBurnsAdmission(vm),
          renderKenBurnsWard(vm),
          renderKenBurnsSurgery(vm),
          renderKenBurnsRoom(vm),
          renderKenBurnsCriticalIllness(vm),
          renderEverythingElse(vm),
          renderGuaranteedProtection(vm),
          renderWaitingPeriods(vm),
          renderCashValue(vm),
          renderFullPicture(vm),
          renderReadyWhenYouAre(vm),
          renderContactSection(vm),
          renderOutro()
        ].join("\n");
        return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quotation \u2014 ${escapeHtml2(clientName)}</title>
<style>${NARRATIVE_STYLE}</style>
<div id="pq-doc">
  ${renderIntroOverlay(vm)}
  ${sections}
</div>
<script>${NARRATIVE_RUNTIME}<\/script>
`;
      }
      module.exports = { renderNarrativeQuotationHtml, buildViewModel, RENDERER_VERSION: RENDERER_VERSION2 };
    }
  });

  // renderer/renderQuotation.js
  var require_renderQuotation = __commonJS({
    "renderer/renderQuotation.js"(exports, module) {
      "use strict";
      var { getAgentConfig } = require_agents();
      var {
        escapeHtml: escapeHtml2,
        formatMoney,
        formatMoneyFixed2,
        resolveMonthlyTotalPayable,
        formatDateLong,
        coPaymentAmount,
        compactRate,
        bareTierNumber,
        primaryValue: primaryValue2
      } = require_formatters();
      var { renderNarrativeQuotationHtml } = require_renderNarrativeQuotation();
      function extractDayTag(value) {
        if (!value) return null;
        const m = value.match(/\(([^)]*\bdays?\b[^)]*)\)/i);
        return m ? m[1] : null;
      }
      function formatLimitPhrase(limit) {
        if (!limit) return null;
        if (/no\s*(annual\s*)?limit/i.test(limit)) return "no annual limit";
        return `${limit} limit`;
      }
      function optionBadge(index, columns) {
        if (index === 0) return "Recommended";
        const recommended = columns[0] && columns[0].annualContribution;
        const current = columns[index].annualContribution;
        if (recommended != null && current != null) {
          if (current < recommended) return "Lower cost";
          if (current > recommended) return "Higher cover";
        }
        return `Option ${index}`;
      }
      function buildHelpers(mode) {
        function missing(agentMessage, clientText) {
          if (mode === "agent") {
            return `<span class="missing">\u2014 ${escapeHtml2(agentMessage || "not found in PDF - please confirm")} \u2014</span>`;
          }
          return `<span class="na">${escapeHtml2(clientText != null ? clientText : "Refer to certificate")}</span>`;
        }
        function money(n, opts = {}) {
          const formatted = formatMoney(n);
          if (formatted == null) return missing(opts.agentMessage || "amount not found", opts.clientText);
          return `RM ${formatted}`;
        }
        function textOr(value, agentMessage, clientText) {
          return value ? escapeHtml2(value) : missing(agentMessage, clientText);
        }
        return { missing, money, textOr };
      }
      function renderBenefitsTable(benefitItems, helpers) {
        const { missing } = helpers;
        if (!benefitItems || !benefitItems.length) {
          return `<tr><td class="b">${missing("benefits table not found")}</td><td class="v"></td></tr>`;
        }
        return benefitItems.map((item) => {
          const tag = extractDayTag(item.value);
          const tagHtml = tag ? ` <span class="tag">${escapeHtml2(tag)}</span>` : "";
          const compact = primaryValue2(item.value);
          const valueHtml = compact ? escapeHtml2(compact) : missing("shares a merged cell in the PDF - verify against the certificate", "Refer to certificate");
          return `<tr><td class="b">${escapeHtml2(item.label)}${tagHtml}</td><td class="v">${valueHtml}</td></tr>`;
        }).join("\n");
      }
      function renderExclusions(exclusions, helpers) {
        if (!exclusions || !exclusions.length) {
          return `<li>${helpers.missing("exclusions not found")}</li>`;
        }
        return exclusions.map((e) => `<li>${escapeHtml2(e)}.</li>`).join("\n");
      }
      function renderOptionCard(col, index, columns, helpers) {
        const { missing, money } = helpers;
        const badge = optionBadge(index, columns);
        const pickClass = index === 0 ? " pick" : "";
        const name = col.productName ? escapeHtml2(col.productName) : missing("product name unclear - reconstructed from a wrapped PDF cell", "Plan details");
        const price = col.annualContribution != null ? `${money(col.annualContribution)}<small>/yr</small>` : missing();
        const descBits = [
          col.roomAndBoard ? `${escapeHtml2(col.roomAndBoard)} room` : null,
          formatLimitPhrase(col.annualLimitOption) ? escapeHtml2(formatLimitPhrase(col.annualLimitOption)) : null
        ].filter(Boolean);
        const desc = descBits.length ? descBits.join(" \xB7 ") : missing();
        return `
      <div class="opt${pickClass}">
        <div class="badge">${escapeHtml2(badge)}</div>
        <div class="nm">${name}</div>
        <div class="pr">${price}</div>
        <div class="d">${desc}</div>
      </div>`;
      }
      function renderNote(projection, client) {
        const rows = projection && projection.projectionRows || [];
        const currentRow = rows.find((r) => client && r.age === client.ageNextBirthday) || rows[0] || null;
        const age = client ? client.ageNextBirthday : null;
        const amount = currentRow ? formatMoney(currentRow.currentContribution) : null;
        if (age == null || amount == null) {
          return `This is an illustration, not a contract of takaful, and is subject to underwriting approval by Prudential BSN Takaful Berhad. Medic TotalCare contribution is not guaranteed and may rise over time with medical inflation.`;
        }
        return `This is an illustration, not a contract of takaful, and is subject to underwriting approval by Prudential BSN Takaful Berhad. Medic TotalCare contribution is not guaranteed and may rise over time with medical inflation \u2014 for example, the annual contribution at age ${age} is around RM ${amount} and is projected to increase as the covered person ages.`;
      }
      function renderReviewBanner(warnings, errors) {
        const errorItems = (errors || []).map((e) => `<li><b>${escapeHtml2(e.field)}</b> \u2014 ${escapeHtml2(e.message)}</li>`).join("");
        const warningItems = (warnings || []).map((w) => `<li><b>${escapeHtml2(w.field)}</b> \u2014 ${escapeHtml2(w.message)}</li>`).join("");
        return `
  <div class="review-banner">
    <div class="review-banner-title">\u26A0 AGENT REVIEW \u2014 INTERNAL ONLY. Do not forward this page to a client.</div>
    ${errors && errors.length ? `<div class="review-section"><b>${errors.length} required field(s) missing \u2014 this quotation CANNOT be sent as-is:</b><ul>${errorItems}</ul></div>` : `<div class="review-section review-ok">No required fields are missing.</div>`}
    ${warnings && warnings.length ? `<div class="review-section"><b>${warnings.length} warning(s) to check before sending:</b><ul>${warningItems}</ul></div>` : `<div class="review-section review-ok">No warnings.</div>`}
  </div>`;
      }
      var SHARED_STYLE = `
  :root{
    --rose:#F2D3E2; --rose-soft:#faf2f6;
    --teal:#178D93; --teal-dk:#0f6b70;
    --gold-a:#D4AF37; --gold-b:#FDB913;
    --ink:#2b2b2b; --meta:#8a8a8a; --line:#ece2e7; --card:#ffffff;
    --serif:Georgia,"Times New Roman",serif;
    --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,sans-serif;
  }
  @media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--rose);font-family:var(--sans);color:var(--ink);
    padding:26px 14px 60px;display:flex;flex-direction:column;align-items:center;line-height:1.5}
  .sheet{width:100%;max-width:800px;background:var(--card);border-radius:16px;
    box-shadow:0 22px 60px -26px rgba(23,141,147,.4);overflow:hidden}

  .head{padding:26px 34px 18px;display:flex;align-items:center;gap:14px;
    border-bottom:3px solid transparent;border-image:linear-gradient(90deg,var(--gold-a),var(--gold-b)) 1}
  .mark{width:46px;height:46px;flex:none}
  img.mark{border-radius:14px;object-fit:cover;background:#000}
  .head .co{font-family:var(--serif);font-size:18px;font-weight:700;color:#111;line-height:1.1}
  .head .co small{display:block;font-family:var(--sans);font-size:10.5px;font-weight:400;color:var(--meta);margin-top:3px;letter-spacing:.02em}
  .head .rt{margin-left:auto;text-align:right;font-size:11px;color:var(--meta);line-height:1.7}
  .head .rt b{color:var(--teal-dk)}

  .hero{padding:26px 34px 6px}
  .medcard{position:relative;aspect-ratio:1.586;max-width:420px;margin:0 auto;border-radius:16px;
    background:radial-gradient(120% 140% at 100% 0%,#2a2a2a 0%,#000 55%);color:#fff;
    padding:20px 22px;box-shadow:0 14px 34px -14px rgba(0,0,0,.55);overflow:hidden}
  .medcard::after{content:"";position:absolute;inset:0;border-radius:16px;padding:1.4px;
    background:linear-gradient(135deg,var(--gold-a),var(--gold-b),#8a6d17);
    -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
    -webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none}
  .medcard .brandrow{display:flex;justify-content:space-between;align-items:center}
  .medcard .brandrow .g{font-family:var(--serif);font-weight:700;font-size:13px;
    background:linear-gradient(90deg,var(--gold-a),var(--gold-b));-webkit-background-clip:text;background-clip:text;color:transparent}
  .medcard .type{font-size:9px;letter-spacing:.24em;color:#cbb46a;text-transform:uppercase}
  .medcard .chip{width:34px;height:25px;margin:16px 0 12px;border-radius:5px;
    background:linear-gradient(135deg,#e9cf7a,#b8912f)}
  .medcard .name{font-size:16px;letter-spacing:.03em;font-weight:600;text-transform:uppercase}
  .medcard .foot{display:flex;justify-content:space-between;margin-top:12px;font-size:10px;color:#d9d2c0}
  .medcard .foot .lab{color:#9a8f74;text-transform:uppercase;letter-spacing:.08em;font-size:8px}
  .medcard .foot b{color:#fff;font-size:12px;font-weight:600}

  .titles{text-align:center;padding:20px 34px 4px}
  .titles h1{font-family:var(--serif);color:var(--teal);font-size:22px;margin:0;font-weight:700}
  .titles .plan{font-size:12px;color:var(--meta);letter-spacing:.05em;margin-top:5px}
  .titles .src-note{font-size:10.5px;color:#b3aca6;margin-top:6px;font-style:italic}

  .body{padding:8px 34px 30px}

  .prep{display:flex;flex-wrap:wrap;gap:6px 26px;background:var(--rose-soft);border:1px solid var(--line);
    border-radius:12px;padding:14px 18px;margin:14px 0 22px;font-size:12.5px}
  .prep .item{min-width:140px}
  .prep .k{font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:var(--meta)}
  .prep .v{font-weight:600}
  .prep .item.name .v{font-family:var(--serif);font-size:15px}

  .figs{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:26px}
  @media(max-width:600px){.figs{grid-template-columns:1fr 1fr}}
  .fig{border:1px solid var(--line);border-radius:12px;padding:14px;position:relative;overflow:hidden}
  .fig::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:linear-gradient(180deg,var(--gold-a),var(--gold-b))}
  .fig .lab{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--meta)}
  .fig .amt{font-family:var(--serif);font-size:21px;color:var(--teal);font-weight:700;margin-top:5px;line-height:1.05}
  .fig .amt small{font-family:var(--sans);font-size:11px;color:var(--meta);font-weight:400}
  .fig .sub{font-size:10.5px;color:var(--meta);margin-top:2px}

  h2.sec{font-family:var(--serif);color:var(--teal);font-size:15.5px;margin:26px 0 10px;
    padding-bottom:6px;border-bottom:1px solid var(--line)}

  table.ben{width:100%;border-collapse:collapse;font-size:12.5px}
  table.ben td{padding:9px 4px;border-bottom:1px solid #f3eef1;vertical-align:top}
  table.ben td.b{color:#444}
  table.ben td.v{text-align:right;font-weight:600;color:var(--teal-dk);white-space:nowrap;padding-left:14px}
  table.ben tr:last-child td{border-bottom:none}
  .tag{display:inline-block;font-size:9.5px;letter-spacing:.04em;background:rgba(23,141,147,.1);
    color:var(--teal-dk);border-radius:20px;padding:1px 8px;margin-left:6px;vertical-align:middle}

  .contrib{border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .contrib .row{display:flex;justify-content:space-between;padding:10px 16px;font-size:12.5px;border-bottom:1px solid #f3eef1}
  .contrib .row .l{color:#555}
  .contrib .row.total{background:linear-gradient(90deg,rgba(23,141,147,.06),rgba(212,175,55,.12));
    font-family:var(--serif);border-bottom:none}
  .contrib .row.total .l{color:#111;font-size:14px}
  .contrib .row.total .r{font-size:19px;font-weight:700;color:var(--teal)}
  .contrib .row.total .r small{font-family:var(--sans);font-size:11px;color:var(--meta);font-weight:400}

  .opts{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
  @media(max-width:600px){.opts{grid-template-columns:1fr}}
  .opt{border:1px solid var(--line);border-radius:12px;padding:14px}
  .opt.pick{border-color:var(--teal);box-shadow:0 0 0 2px rgba(23,141,147,.12)}
  .opt .badge{font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:var(--teal-dk);font-weight:700}
  .opt .nm{font-weight:600;font-size:12.5px;margin:5px 0 8px}
  .opt .pr{font-family:var(--serif);font-size:17px;color:var(--teal)}
  .opt .pr small{font-family:var(--sans);font-size:11px;color:var(--meta)}
  .opt .d{font-size:10.5px;color:var(--meta);margin-top:6px;line-height:1.5}

  .excl{font-size:12px;color:#555;line-height:1.7}
  .excl li{margin-bottom:3px}

  .note{margin-top:22px;background:#fff8ec;border:1px solid #f3d8a0;border-radius:10px;
    padding:11px 14px;font-size:11.5px;color:#7a5a12;line-height:1.6}

  .foot2{margin-top:26px;text-align:center;font-size:10.5px;color:var(--meta);line-height:1.8;
    border-top:1px solid var(--line);padding-top:16px}
  .foot2 .s{color:var(--ink)}

  /* Agent-mode only: honestly flag data the parser couldn't find, and generated (not extracted) fields. */
  .missing{color:#B3261E;font-style:italic;font-weight:500}
  .gen{border-bottom:1px dashed #C9A227;color:#8a6d1f}
  /* Client-mode only: calm, non-alarming placeholder for anything not shown outright. */
  .na{color:var(--meta);font-style:italic}

  .review-banner{width:100%;max-width:800px;margin-bottom:14px;background:#2a1215;color:#ffd8d4;
    border-radius:12px;padding:16px 20px;font-size:12.5px;line-height:1.6}
  .review-banner-title{font-weight:700;font-size:13.5px;margin-bottom:10px;color:#ff8a80}
  .review-section{margin-top:8px}
  .review-section ul{margin:6px 0 0;padding-left:20px}
  .review-ok{color:#9fd6a3}

  /* ---------- print / save-as-PDF ----------
     Found via an actual printed/PDF-exported quotation, not just on
     screen: with no rules here at all, (1) the medical card's dark
     background and white text are a CSS background, which most browsers
     omit by default when printing without "background graphics" -
     leaving the card a blank white box (the text is white-on-white, not
     just unstyled), and (2) with no page-break hints, a page break can
     land inside the footer block and strand the agent/dealership line
     alone at the top of an otherwise blank final page.

     print-color-adjust is scoped to the specific elements whose CSS
     background carries real information (the medical card, key-figure
     card accents, the contribution total row, the recommended-option
     border, table value colour, day-count tag pills) - keep this list
     explicit and add to it deliberately as the template evolves, rather
     than forcing it everywhere with a catch-all selector.

     .medcard::after is turned off in print rather than added to that
     list: it draws the card's thin gold ring border with a
     mask-composite:exclude trick (a full gradient square masked down to
     just the outer 1.4px), and that mask does not survive Chromium's
     print rendering - forced or not, it paints as a solid, opaque gold
     rectangle covering the *entire* card, hiding the card's own
     background and every line of white text on it. Losing a decorative
     1.4px ring in print is a fair trade for the card actually being
     legible. */
  @media print {
    body{background:#fff;padding:0;display:block}
    .sheet{box-shadow:none;border-radius:0;max-width:100%}
    .medcard::after{content:none}
    .medcard, .medcard .brandrow .g, .fig::before,
    .contrib .row.total, .opt.pick, table.ben td.v, .tag{
      -webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact}
    .medcard{break-inside:avoid;page-break-inside:avoid}
    .fig, .opt, .contrib{break-inside:avoid;page-break-inside:avoid}
    h2.sec{break-after:avoid;page-break-after:avoid}
    .foot2{break-before:avoid;page-break-before:avoid}
  }
`;
      function renderQuotationCard(data, mode, agentReview = {}) {
        const { metadata = {}, client = {}, agent = {}, plan = {}, contributions = {}, benefits = {}, options = {}, projection = {} } = data || {};
        const helpers = buildHelpers(mode);
        const { missing, money, textOr } = helpers;
        const agentConfig = getAgentConfig(agent.agentCode) || {};
        const agencyPlain = agentConfig.agency || null;
        const agencyName = agencyPlain ? escapeHtml2(agencyPlain) : textOr(null, "agency not configured for this agent code", "our agency");
        const branchName = agentConfig.branch ? escapeHtml2(agentConfig.branch) : "";
        const preparedByName = agentConfig.name ? escapeHtml2(agentConfig.name) : agent.agentNameOnDocument ? escapeHtml2(agent.agentNameOnDocument) : missing("agent name not found", "your servicing agent");
        const agentLine = [preparedByName, agent.agentCode ? `Agent ${escapeHtml2(agent.agentCode)}` : null].filter(Boolean).join(" \xB7 ");
        const dealershipLine = [agentConfig.branch, agentConfig.agency, agentConfig.location].filter(Boolean).join(" \xB7 ");
        const logoHtml = agentConfig.logo ? `<img class="mark" src="${escapeHtml2(agentConfig.logo)}" alt="${escapeHtml2(agencyPlain || "our agency")} logo">` : `<svg class="mark" viewBox="0 0 100 100" aria-label="${escapeHtml2(agencyPlain || "our agency")}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#FDB913"/><stop offset="1" stop-color="#D4AF37"/></linearGradient></defs>
      <rect width="100" height="100" rx="14" fill="#000"/>
      <path d="M50 20 L70 66 L58 66 L50 44 L42 66 L30 66 Z" fill="url(#g)"/>
      <path d="M62 40 L80 80 L68 80 L58 56 Z" fill="url(#g)" opacity=".55"/>
    </svg>`;
        const quotationDateFormatted = metadata.quotationDate ? formatDateLong(metadata.quotationDate.iso) : null;
        const headerLines = [];
        if (mode === "agent") {
          headerLines.push(
            `<b>Quotation No</b> ${metadata.quotationNumber && metadata.quotationNumber.value ? escapeHtml2(metadata.quotationNumber.value) : '<span class="gen">\u2014 assign quotation number \u2014</span>'}`
          );
          headerLines.push(`<b>Date</b> ${quotationDateFormatted ? escapeHtml2(quotationDateFormatted) : missing()}`);
          headerLines.push(
            `<b>Valid until</b> ${metadata.validUntil ? `<span class="gen">${escapeHtml2(formatDateLong(metadata.validUntil.iso))}</span>` : missing()}`
          );
        } else {
          if (agentReview.quotationNumber) {
            headerLines.push(`<b>Quotation No</b> ${escapeHtml2(agentReview.quotationNumber)}`);
          }
          if (quotationDateFormatted) {
            headerLines.push(`<b>Date</b> ${escapeHtml2(quotationDateFormatted)}`);
          }
          if (agentReview.validUntilIso) {
            headerLines.push(`<b>Valid until</b> ${escapeHtml2(formatDateLong(agentReview.validUntilIso))}`);
          }
        }
        const planSubtitle = [metadata.productName, [plan.medicalRiderName, plan.medicalPlanTier ? `(${plan.medicalPlanTier})` : null].filter(Boolean).join(" ")].filter(Boolean).join(" \xB7 ");
        const sourceNote = mode === "client" && quotationDateFormatted ? `<div class="src-note">Interactive quotation prepared from the PruBSN Product Illustration dated ${escapeHtml2(quotationDateFormatted)}.</div>` : "";
        const monthlyTotalPayableValue = resolveMonthlyTotalPayable(contributions);
        const monthlyTotalPayable = monthlyTotalPayableValue != null ? `RM ${formatMoneyFixed2(monthlyTotalPayableValue)}` : null;
        const roomBoardItem = (benefits.benefitItems || []).find((i) => i.label === "Hospital Daily Room and Board");
        const roomBoardCompact = roomBoardItem ? compactRate(roomBoardItem.value) : null;
        const roomBoardTag = roomBoardItem ? extractDayTag(roomBoardItem.value) : null;
        const cardPlanLabel = plan.medicalRiderName ? [plan.medicalRiderName, bareTierNumber(plan.medicalPlanTier)].filter(Boolean).join(" ") : null;
        const hospitalSurgicalItem = (benefits.benefitItems || []).find((i) => i.label === "In Hospital and Related Services");
        const hospitalSurgicalCompact = hospitalSurgicalItem ? primaryValue2(hospitalSurgicalItem.value) : null;
        const optionColumns = options.columns || [];
        return `
<div class="sheet">

  <div class="head">
    ${logoHtml}
    <div class="co">${agencyName}<small>${branchName}</small></div>
    <div class="rt">${headerLines.join("<br>")}</div>
  </div>

  <div class="hero">
    <div class="medcard">
      <div class="brandrow"><span class="g">${agencyName}</span><span class="type">Medical Card</span></div>
      <div class="chip"></div>
      <div class="name">${escapeHtml2(client.fullName || "CLIENT NAME")}</div>
      <div class="foot">
        <div><span class="lab">Plan</span><br><b>${cardPlanLabel ? escapeHtml2(cardPlanLabel) : missing()}</b></div>
        <div><span class="lab">Room &amp; Board</span><br><b>${roomBoardCompact ? escapeHtml2(roomBoardCompact) : missing()}</b></div>
        <div><span class="lab">Cover to</span><br><b>${plan.coverageToAge != null ? `Age ${plan.coverageToAge}` : missing()}</b></div>
      </div>
    </div>
  </div>

  <div class="titles">
    <h1>Medical Card Quotation</h1>
    <div class="plan">${escapeHtml2(planSubtitle)}</div>
    ${sourceNote}
  </div>

  <div class="body">

    <div class="prep">
      <div class="item name"><div class="k">Prepared for</div><div class="v">${textOr(client.fullName)}</div></div>
      <div class="item"><div class="k">Age</div><div class="v">${client.ageNextBirthday != null ? `${client.ageNextBirthday} next birthday` : missing()}</div></div>
      <div class="item"><div class="k">Gender</div><div class="v">${textOr(client.gender)}</div></div>
      <div class="item"><div class="k">Smoker</div><div class="v">${textOr(client.smokerStatus)}</div></div>
      <div class="item"><div class="k">Occupation</div><div class="v">${textOr(client.occupationClass)}</div></div>
      <div class="item"><div class="k">Prepared by</div><div class="v">${preparedByName}</div></div>
    </div>

    <div class="figs">
      <div class="fig"><div class="lab">Monthly Total Amount Payable</div><div class="amt">${monthlyTotalPayable ? escapeHtml2(monthlyTotalPayable) : missing()}</div><div class="sub">${contributions.totalAnnualContribution != null ? `${money(contributions.totalAnnualContribution)} / year` : ""}</div></div>
      <div class="fig"><div class="lab">Annual Limit</div><div class="amt">${textOr(benefits.annualLimit)}</div><div class="sub">${textOr(benefits.lifetimeLimit)}</div></div>
      <div class="fig"><div class="lab">Room &amp; Board</div><div class="amt">${roomBoardCompact ? escapeHtml2(roomBoardCompact) : missing()}</div><div class="sub">${roomBoardTag ? escapeHtml2(roomBoardTag) : ""}</div></div>
      <div class="fig"><div class="lab">Co-payment</div><div class="amt">${textOr(plan.coPaymentOption)}</div><div class="sub">${coPaymentAmount(plan.coPaymentOption) ? `RM ${coPaymentAmount(plan.coPaymentOption)} per disability` : ""}</div></div>
      <div class="fig"><div class="lab">Hospital &amp; Surgical</div><div class="amt">${hospitalSurgicalCompact ? escapeHtml2(hospitalSurgicalCompact) : missing()}</div><div class="sub">cashless at panel</div></div>
      <div class="fig"><div class="lab">Coverage Term</div><div class="amt">${plan.coverageToAge != null ? `to Age ${plan.coverageToAge}` : missing()}</div><div class="sub">${plan.basicPlanTerm != null ? `${plan.basicPlanTerm} years` : ""}</div></div>
    </div>

    <h2 class="sec">What your medical card covers</h2>
    <table class="ben">
${renderBenefitsTable(benefits.benefitItems, helpers)}
    </table>

    <h2 class="sec">Your monthly contribution</h2>
    <div class="contrib">
      <div class="row"><span class="l">${textOr(plan.basicPlanName)} \u2014 Sum Covered ${plan.basicSumCovered != null ? money(plan.basicSumCovered) : missing()}</span><span class="r">${money(contributions.isaContribution)}</span></div>
      <div class="row"><span class="l">${textOr(plan.medicalRiderName)} \u2014 ${textOr(plan.medicalPlanTier)}, ${textOr(plan.coPaymentOption)}</span><span class="r">${money(contributions.medicTotalCareContribution)}</span></div>
      <div class="row"><span class="l">Wakalah Certificate Charge</span><span class="r">${money(contributions.wakalahCertificateCharge)}</span></div>
      <div class="row total"><span class="l">Monthly Total Amount Payable</span><span class="r">${monthlyTotalPayable ? escapeHtml2(monthlyTotalPayable) : missing()} ${contributions.totalAnnualContribution != null ? `<small>\xB7 ${money(contributions.totalAnnualContribution)}/yr</small>` : ""}</span></div>
    </div>

    <h2 class="sec">Other options to consider</h2>
    <div class="opts">${optionColumns.length ? optionColumns.map((c, i) => renderOptionCard(c, i, optionColumns, helpers)).join("") : `
      <div class="opt">${missing("options table not found")}</div>`}
    </div>

    <h2 class="sec">What is not covered</h2>
    <ul class="excl">
${renderExclusions(benefits.medicalExclusions, helpers)}
    </ul>

    <div class="note">
      <b>Please note.</b> ${renderNote(projection, client)}
    </div>

    <div class="foot2">
      <div class="s">${agentLine}</div>
      ${dealershipLine ? escapeHtml2(dealershipLine) : missing("dealership details not configured for this agent", "")}<br>
      Benefit(s) payable under eligible certificate are protected by PIDM up to limits.
    </div>

  </div>
</div>`;
      }
      function documentShell(title, bodyHtml) {
        return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml2(title)}</title>
<style>${SHARED_STYLE}</style>
${bodyHtml}
`;
      }
      function renderAgentReviewHtml2(parseResult) {
        const { data, warnings, errors } = parseResult || {};
        const clientName = data && data.client && data.client.fullName;
        const card = renderQuotationCard(data, "agent");
        const banner = renderReviewBanner(warnings, errors);
        return documentShell(`[INTERNAL] Agent Review \u2014 ${clientName || "Quotation"}`, `${banner}
${card}`);
      }
      function renderBlockedHtml(reasons) {
        const list = reasons.length ? `<ul>${reasons.map((r) => `<li>${escapeHtml2(r)}</li>`).join("")}</ul>` : "<p>Awaiting agent review.</p>";
        return `<!doctype html>
<meta charset="utf-8">
<title>Quotation Not Ready</title>
<style>body{font-family:sans-serif;max-width:640px;margin:60px auto;padding:0 20px;color:#333}
h1{color:#B3261E;font-size:20px}li{margin-bottom:6px}</style>
<h1>This quotation is not ready to send</h1>
<p>It has not cleared agent review. Open the agent review version, resolve the items below, then re-generate the client copy.</p>
${list}
`;
      }
      function renderClientQuotationHtml2(parseResult, agentReview = {}) {
        const { data, errors } = parseResult || {};
        if (errors && errors.length) {
          return renderBlockedHtml(errors.map((e) => `${e.field}: ${e.message}`));
        }
        if (!agentReview.acknowledged) {
          return renderBlockedHtml([
            "Agent has not yet reviewed and acknowledged this quotation. Open the agent review version first."
          ]);
        }
        return renderNarrativeQuotationHtml(data, agentReview);
      }
      module.exports = { renderAgentReviewHtml: renderAgentReviewHtml2, renderClientQuotationHtml: renderClientQuotationHtml2, renderBlockedHtml, SHARED_STYLE };
    }
  });

  // renderer/renderComparison.js
  var require_renderComparison = __commonJS({
    "renderer/renderComparison.js"(exports, module) {
      "use strict";
      var { getAgentConfig } = require_agents();
      var {
        escapeHtml: escapeHtml2,
        formatMoney,
        formatMoneyFixed2,
        resolveMonthlyTotalPayable,
        coPaymentAmount,
        compactRate,
        primaryValue: primaryValue2
      } = require_formatters();
      var { renderBlockedHtml, SHARED_STYLE } = require_renderQuotation();
      var COMPARISON_STYLE = `
  .cmp-wrap{width:100%;max-width:${"1000px"};background:var(--card);border-radius:16px;
    box-shadow:0 22px 60px -26px rgba(23,141,147,.4);overflow:hidden;margin-top:18px}
  .cmp-head{padding:22px 30px 16px;text-align:center;border-bottom:3px solid transparent;
    border-image:linear-gradient(90deg,var(--gold-a),var(--gold-b)) 1}
  .cmp-head h2{font-family:var(--serif);color:var(--teal);font-size:19px;margin:0}
  .cmp-head p{font-size:12px;color:var(--meta);margin:5px 0 0}
  .cmp-body{padding:20px 26px 30px;overflow-x:auto}
  table.cmp{width:100%;border-collapse:collapse;font-size:12.5px;min-width:480px}
  table.cmp th, table.cmp td{padding:10px 12px;border-bottom:1px solid #f3eef1;text-align:left;vertical-align:top}
  table.cmp thead th{font-family:var(--serif);color:var(--teal-dk);font-size:13.5px;border-bottom:2px solid var(--line)}
  table.cmp tbody th{color:#555;font-weight:600;white-space:nowrap}
  table.cmp td{color:#333}
  table.cmp td.cmp-best{color:var(--teal-dk);font-weight:700;background:rgba(23,141,147,.06);border-radius:6px}
  table.cmp td.cmp-best::after{content:" \\2713";color:var(--teal)}
  .cmp-plan-name{font-family:var(--serif);font-size:13.5px;color:var(--ink)}
  .cmp-plan-sub{font-size:10.5px;color:var(--meta);margin-top:2px}
  h3.cmp-sec{font-family:var(--serif);color:var(--teal);font-size:14px;margin:26px 0 8px}
  .cmp-note{margin-top:20px;background:#fff8ec;border:1px solid #f3d8a0;border-radius:10px;
    padding:11px 14px;font-size:11px;color:#7a5a12;line-height:1.6}
`;
      function textOr(value, clientText) {
        return value ? escapeHtml2(value) : `<span class="na">${escapeHtml2(clientText || "Refer to certificate")}</span>`;
      }
      function money(n) {
        const formatted = formatMoney(n);
        return formatted == null ? `<span class="na">Refer to certificate</span>` : `RM ${formatted}`;
      }
      function moneyFixed2(n) {
        const formatted = formatMoneyFixed2(n);
        return formatted == null ? `<span class="na">Refer to certificate</span>` : `RM ${formatted}`;
      }
      function indexOfLowest(values) {
        const numeric = values.map((v, i) => ({ v, i })).filter((x) => Number.isFinite(x.v));
        if (numeric.length < 2) return null;
        const min = Math.min(...numeric.map((x) => x.v));
        const winners = numeric.filter((x) => x.v === min);
        return winners.length === 1 ? winners[0].i : null;
      }
      function planLabel(data) {
        const plan = data && data.plan || {};
        return [plan.medicalRiderName, plan.medicalPlanTier].filter(Boolean).join(" ") || null;
      }
      function planSubtitle(data) {
        const metadata = data && data.metadata || {};
        const plan = data && data.plan || {};
        return [metadata.productName, plan.coPaymentOption].filter(Boolean).join(" \xB7 ") || null;
      }
      function roomBoardValue(data) {
        const items = data && data.benefits && data.benefits.benefitItems || [];
        const item = items.find((i) => i.label === "Hospital Daily Room and Board");
        return item ? compactRate(item.value) : null;
      }
      function unionBenefitLabels(allData) {
        const seen = /* @__PURE__ */ new Set();
        const labels = [];
        for (const data of allData) {
          const items = data && data.benefits && data.benefits.benefitItems || [];
          for (const item of items) {
            if (!seen.has(item.label)) {
              seen.add(item.label);
              labels.push(item.label);
            }
          }
        }
        return labels;
      }
      function benefitValueFor(data, label) {
        const items = data && data.benefits && data.benefits.benefitItems || [];
        const item = items.find((i) => i.label === label);
        return item ? primaryValue2(item.value) : null;
      }
      function allEqual(values) {
        return values.every((v) => v === values[0]);
      }
      function renderKeyFiguresTable(allData) {
        const monthly = allData.map((d) => resolveMonthlyTotalPayable(d.contributions || {}));
        const annual = allData.map((d) => (d.contributions || {}).totalAnnualContribution);
        const bestMonthly = indexOfLowest(monthly);
        const bestAnnual = indexOfLowest(annual);
        const headerCells = allData.map((d, i) => `<th>${escapeHtml2(`Option ${i + 1}`)}</th>`).join("");
        const planRow = `<tr><th>Plan</th>${allData.map((d) => `<td><div class="cmp-plan-name">${textOr(planLabel(d))}</div><div class="cmp-plan-sub">${escapeHtml2(planSubtitle(d) || "")}</div></td>`).join("")}</tr>`;
        const monthlyRow = `<tr><th>Monthly Total Amount Payable</th>${allData.map((d, i) => `<td${i === bestMonthly ? ' class="cmp-best"' : ""}>${moneyFixed2(monthly[i])}</td>`).join("")}</tr>`;
        const annualRow = `<tr><th>Annual Contribution</th>${allData.map((d, i) => `<td${i === bestAnnual ? ' class="cmp-best"' : ""}>${money(annual[i])}</td>`).join("")}</tr>`;
        const roomBoardRow = `<tr><th>Room &amp; Board</th>${allData.map((d) => `<td>${textOr(roomBoardValue(d))}</td>`).join("")}</tr>`;
        const annualLimitRow = `<tr><th>Annual Limit</th>${allData.map((d) => `<td>${textOr((d.benefits || {}).annualLimit)}</td>`).join("")}</tr>`;
        const lifetimeLimitRow = `<tr><th>Lifetime Limit</th>${allData.map((d) => `<td>${textOr((d.benefits || {}).lifetimeLimit)}</td>`).join("")}</tr>`;
        const coPayRow = `<tr><th>Co-payment</th>${allData.map((d) => {
          const opt = (d.plan || {}).coPaymentOption;
          const amt = coPaymentAmount(opt);
          return `<td>${textOr(opt)}${amt ? `<div class="cmp-plan-sub">RM ${escapeHtml2(amt)} per disability</div>` : ""}</td>`;
        }).join("")}</tr>`;
        const coverageRow = `<tr><th>Coverage Term</th>${allData.map((d) => `<td>${(d.plan || {}).coverageToAge != null ? `to Age ${(d.plan || {}).coverageToAge}` : `<span class="na">Refer to certificate</span>`}</td>`).join("")}</tr>`;
        return `
    <table class="cmp">
      <thead><tr><th></th>${headerCells}</tr></thead>
      <tbody>${planRow}${monthlyRow}${annualRow}${roomBoardRow}${annualLimitRow}${lifetimeLimitRow}${coPayRow}${coverageRow}</tbody>
    </table>`;
      }
      function renderBenefitsTable(allData) {
        const labels = unionBenefitLabels(allData);
        if (!labels.length) return "";
        const headerCells = allData.map((d, i) => `<th>${escapeHtml2(`Option ${i + 1}`)}</th>`).join("");
        const rows = labels.map((label) => {
          const values = allData.map((d) => benefitValueFor(d, label));
          const differs = !allEqual(values);
          return `<tr><th>${escapeHtml2(label)}</th>${values.map((v) => `<td${differs && v ? ' class="cmp-best"' : ""}>${textOr(v)}</td>`).join("")}</tr>`;
        }).join("");
        return `
    <h3 class="cmp-sec">Benefit-by-benefit comparison</h3>
    <table class="cmp"><thead><tr><th></th>${headerCells}</tr></thead><tbody>${rows}</tbody></table>`;
      }
      function comparisonCard(allData) {
        const clientName = allData[0] && allData[0].client && allData[0].client.fullName || null;
        const agentConfig = getAgentConfig(allData[0] && allData[0].agent && allData[0].agent.agentCode) || {};
        return `
<div class="cmp-wrap">
  <div class="cmp-head">
    <h2>Comparing ${allData.length} Options</h2>
    <p>${clientName ? `Prepared for ${escapeHtml2(clientName)}` : "Prepared for you"}${agentConfig.name ? ` by ${escapeHtml2(agentConfig.name)}` : ""}</p>
  </div>
  <div class="cmp-body">
    ${renderKeyFiguresTable(allData)}
    ${renderBenefitsTable(allData)}
    <div class="cmp-note"><b>Please note.</b> Figures above are illustrations, not a contract of takaful, and are subject to underwriting approval by Prudential BSN Takaful Berhad. The highlighted option in each row is the lower contribution amount only - it does not account for coverage differences shown in the benefits table below it.</div>
  </div>
</div>`;
      }
      function documentShell(title, bodyHtml) {
        return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml2(title)}</title>
<style>${SHARED_STYLE}${COMPARISON_STYLE}</style>
<body style="display:flex;flex-direction:column;align-items:center">
${bodyHtml}
</body>`;
      }
      function renderComparisonHtml2(parseResults, agentReviews) {
        const results = parseResults || [];
        const reviews = agentReviews || [];
        const blockingErrors = [];
        results.forEach((r, i) => {
          if (r && r.errors && r.errors.length) {
            blockingErrors.push(...r.errors.map((e) => `Option ${i + 1} - ${e.field}: ${e.message}`));
          }
          if (!reviews[i] || !reviews[i].acknowledged) {
            blockingErrors.push(`Option ${i + 1} has not been reviewed and acknowledged by the agent yet.`);
          }
        });
        if (blockingErrors.length) {
          return renderBlockedHtml(blockingErrors);
        }
        const allData = results.map((r) => r.data);
        return documentShell(`Comparing ${allData.length} Options`, comparisonCard(allData));
      }
      module.exports = { renderComparisonHtml: renderComparisonHtml2 };
    }
  });

  // browser-tool/application/buildPrefillData.js
  var require_buildPrefillData = __commonJS({
    "browser-tool/application/buildPrefillData.js"(exports, module) {
      "use strict";
      var { getAgentConfig } = require_agents();
      var { formatMoneyFixed2, resolveMonthlyTotalPayable, formatDateLong } = require_formatters();
      function buildRidersList(plan) {
        if (!plan || !plan.medicalRiderName) return [];
        const tierPart = plan.medicalPlanTier ? ` - ${plan.medicalPlanTier}` : "";
        const coPayPart = plan.coPaymentOption ? ` (${plan.coPaymentOption})` : "";
        return [`${plan.medicalRiderName}${tierPart}${coPayPart}`];
      }
      function formatMonthlyTotalPayable(contributions) {
        const value = resolveMonthlyTotalPayable(contributions);
        const formatted = formatMoneyFixed2(value);
        return formatted != null ? `RM ${formatted}` : null;
      }
      function planSummaryFor(d) {
        const plan = d && d.plan || {};
        const contributions = d && d.contributions || {};
        const benefits = d && d.benefits || {};
        const roomBoardItem = (benefits.benefitItems || []).find((i) => i.label === "Hospital Daily Room and Board");
        return {
          planName: [plan.medicalRiderName, plan.medicalPlanTier].filter(Boolean).join(" ") || plan.basicPlanName || null,
          monthlyContribution: formatMonthlyTotalPayable(contributions),
          roomAndBoard: roomBoardItem ? roomBoardItem.value : null,
          annualLimit: benefits.annualLimit || null
        };
      }
      function buildPrefillData2(dataOrArray, agentReview) {
        const allData = Array.isArray(dataOrArray) ? dataOrArray : [dataOrArray];
        const d = allData[0] || {};
        const review = agentReview || {};
        const plan = d.plan || {};
        const contributions = d.contributions || {};
        const metadata = d.metadata || {};
        const client = d.client || {};
        const quotationNumber = review.quotationNumber || metadata.quotationNumber && metadata.quotationNumber.value || null;
        const validUntilIso = review.validUntilIso || metadata.validUntil && metadata.validUntil.iso || null;
        const agentCfg = getAgentConfig(d.agent && d.agent.agentCode) || {};
        return {
          quotation: {
            quotationNumber,
            validUntil: formatDateLong(validUntilIso),
            // Raw ISO alongside the display string above, so downstream
            // consumers (Airtable's Clients table - see
            // docs/AIRTABLE_FIELD_MAPPING.md) can store it in a real date field
            // instead of re-parsing a human-formatted date.
            validUntilIso: validUntilIso || null,
            planName: plan.basicPlanName || null,
            monthlyContribution: formatMonthlyTotalPayable(contributions),
            riders: buildRidersList(plan)
          },
          // Real generated quotation(s), in comparison order - drives the Plan
          // Selection step's card picker. Length 1 when the agent generated a
          // single quotation (no comparison), 2-3 when they compared options.
          plans: allData.map(planSummaryFor),
          agent: {
            name: agentCfg.name || d.agent && d.agent.agentNameOnDocument || null,
            agency: agentCfg.agency || null,
            branch: agentCfg.branch || null,
            phone: agentCfg.phone || "",
            email: agentCfg.email || ""
          },
          client: {
            fullName: client.fullName || null,
            dateOfBirthIso: client.dateOfBirth && client.dateOfBirth.iso || null,
            gender: client.gender || null
          },
          // Phase 5: stamped once, at the moment the agent generates the
          // client document, so models/SubmissionPayload.js can report an
          // honest "generatedAt" in submission metadata without needing the
          // client's local clock (which the document has no other reason to
          // trust) at submit time.
          metadata: {
            generatedAt: (/* @__PURE__ */ new Date()).toISOString()
          }
        };
      }
      module.exports = { buildPrefillData: buildPrefillData2 };
    }
  });

  // browser-tool/application/composeClientDocument.js
  var require_composeClientDocument = __commonJS({
    "browser-tool/application/composeClientDocument.js"(exports, module) {
      "use strict";
      var APPLICATION_STYLE = `
.paf-cta{display:block;margin:24px auto 0;padding:14px 28px;border:none;border-radius:999px;
  background:linear-gradient(135deg,var(--teal),var(--teal-dk));color:#fff;font-family:var(--sans);
  font-size:15px;font-weight:600;letter-spacing:.01em;cursor:pointer;box-shadow:0 4px 14px rgba(23,141,147,.3)}
.paf-cta:hover{filter:brightness(1.05)}
.paf-app-root{max-width:800px;margin:24px auto 0;font-family:var(--sans);color:var(--ink)}
.paf-shell{background:var(--card);border-radius:16px;border:1px solid var(--line);padding:28px 24px}
.paf-back-link{display:inline-block;background:none;border:none;color:var(--teal-dk);font-family:var(--sans);
  font-size:13px;font-weight:600;cursor:pointer;padding:0 0 16px;margin:0}
.paf-progress{list-style:none;display:flex;flex-wrap:wrap;gap:8px;padding:0;margin:0 0 24px}
.paf-progress-item{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--meta);font-family:var(--sans)}
.paf-progress-dot{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;
  border-radius:50%;background:var(--rose-soft);color:var(--ink);font-size:11px;font-weight:700}
.paf-progress-current .paf-progress-dot{background:var(--teal);color:#fff}
.paf-progress-done .paf-progress-dot{background:var(--gold-a);color:#fff}
.paf-progress-current .paf-progress-label{color:var(--ink);font-weight:600}
.paf-step-title{font-family:var(--serif);font-size:20px;margin:0 0 4px;color:var(--ink)}
.paf-step-subtitle{font-size:13px;color:var(--meta);margin:0 0 20px}
.paf-fields{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.paf-field{display:flex;flex-direction:column;gap:6px}
.paf-field:has(textarea){grid-column:1/-1}
.paf-field-wide{grid-column:1/-1}
.paf-label{font-size:12px;font-weight:600;color:var(--ink)}
.paf-optional{font-weight:400;color:var(--meta)}
.paf-input{font-family:var(--sans);font-size:14px;padding:10px 12px;border:1px solid var(--line);
  border-radius:8px;background:#fff;color:var(--ink)}
.paf-input:focus{outline:2px solid var(--teal);outline-offset:1px}
.paf-input-error{border-color:#B3261E}
.paf-error{font-size:12px;color:#B3261E}
.paf-nav{display:flex;justify-content:space-between;align-items:center;margin-top:24px}
.paf-btn{font-family:var(--sans);font-size:14px;font-weight:600;padding:10px 22px;border-radius:999px;
  cursor:pointer;border:none}
.paf-btn-primary{background:linear-gradient(135deg,var(--teal),var(--teal-dk));color:#fff;margin-left:auto}
.paf-btn-secondary{background:none;border:1px solid var(--line);color:var(--ink)}
.paf-review-section{padding:16px 0;border-bottom:1px solid var(--line)}
.paf-review-section:last-child{border-bottom:none}
.paf-review-heading{display:flex;align-items:center;gap:10px;font-family:var(--serif);font-size:15px;
  margin:0 0 10px;color:var(--ink)}
.paf-readonly-tag{font-family:var(--sans);font-size:10px;font-weight:600;color:var(--meta);
  background:var(--rose-soft);padding:2px 8px;border-radius:999px}
.paf-edit-link{margin-left:auto;background:none;border:none;color:var(--teal-dk);font-family:var(--sans);
  font-size:12px;font-weight:600;cursor:pointer;padding:0}
.paf-summary-row{display:flex;justify-content:space-between;gap:16px;font-size:13px;padding:4px 0}
.paf-summary-row-block{flex-direction:column;gap:6px}
.paf-summary-label{color:var(--meta)}
.paf-summary-value{color:var(--ink);font-weight:600;text-align:right}
.paf-summary-row-block .paf-summary-value{text-align:left;font-weight:400}
.paf-rider-list{margin:0;padding-left:18px}
.paf-na{color:var(--meta);font-weight:400;font-style:italic}
.paf-confirmation{text-align:center}
.paf-confirm-icon{width:52px;height:52px;line-height:52px;border-radius:50%;background:var(--teal);
  color:#fff;font-size:24px;margin:0 auto 16px}
.paf-confirm-note{font-size:12px;color:var(--meta);max-width:480px;margin:0 auto 20px}
.paf-confirm-details{text-align:left;margin-top:16px}
.paf-confirm-details summary{cursor:pointer;font-size:13px;font-weight:600;color:var(--teal-dk)}
.paf-confirm-json{background:#f7f7f7;border:1px solid var(--line);border-radius:8px;padding:14px;
  font-size:11px;overflow-x:auto;text-align:left}
@media (max-width:640px){
  .paf-fields{grid-template-columns:1fr}
  .paf-shell{padding:20px 16px}
}

/* File upload control (Documents step) */
.paf-file-field{grid-column:1/-1}
.paf-upload{display:flex;align-items:center;gap:12px;padding:14px 16px;border:1.5px dashed var(--line);
  border-radius:10px;cursor:pointer;background:var(--rose-soft);transition:border-color .15s ease}
.paf-upload:hover{border-color:var(--teal)}
.paf-upload-done{border-style:solid;border-color:var(--teal);background:#f2faf9}
.paf-upload-icon{width:32px;height:32px;flex:none;border-radius:50%;display:flex;align-items:center;justify-content:center;
  background:#E9F5F5;color:var(--teal);font-size:15px;font-weight:700}
.paf-upload-done .paf-upload-icon{background:var(--teal);color:#fff}
.paf-upload-text{font-size:13px;color:var(--ink);word-break:break-all}
.paf-upload-input{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0}

/* Plan Selection cards - built from the agent's real generated quotation(s) */
.paf-plan-cards{grid-column:1/-1;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
.paf-plan-card{position:relative;border:2px solid var(--line);border-radius:12px;padding:16px;cursor:pointer;
  transition:all .15s ease;background:#fff}
.paf-plan-card:hover{border-color:var(--teal)}
.paf-plan-card-picked{border-color:var(--teal);background:#f2faf9;box-shadow:0 6px 18px rgba(23,141,147,.15)}
.paf-plan-badge{position:absolute;top:-10px;left:14px;background:linear-gradient(90deg,var(--gold-a),var(--gold-b));
  color:#fff;font-size:9.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:2px 10px;border-radius:999px}
.paf-plan-name{font-weight:600;font-size:13px;margin-top:4px}
.paf-plan-price{font-family:var(--serif);font-size:19px;color:var(--teal);margin-top:8px}
.paf-plan-price small{font-family:var(--sans);font-size:11px;color:var(--meta);font-weight:400}
.paf-plan-meta{font-size:11px;color:var(--meta);margin-top:6px}
.paf-plan-empty{grid-column:1/-1;font-size:13px;color:var(--meta);font-style:italic}

/* A "Continue Application" button (or the live form itself) makes no
   sense on a printed/PDF-exported copy - nothing on paper is clickable,
   and an unstyled/greyed-out button there just looks broken. Found via
   an actual PDF export: it showed up on its own near-blank final page. */
@media print {
  .paf-cta, #paf-app-root, .pq-print-fab { display: none !important; }
}

/* Phase 9: a published quotation (served from GET /q/:id or /app/:id) is
   the ONLY thing on the page - there is no surrounding agent-tool chrome
   with its own Print/Save-as-PDF button (see browser-tool/index.html's
   #print-btn) to fall back on, so the document needs its own. Same
   window.print() mechanism the agent tool's own button already uses
   elsewhere - this project has never had a real PDF-generation library,
   "print to PDF" via the browser's own dialog is the one PDF story
   throughout. Deliberately understated (bottom-right, small) so it reads
   as a utility control, not a second competing call-to-action next to
   "Continue Application". */
.pq-print-fab{position:fixed;bottom:16px;right:16px;z-index:40;background:rgba(11,37,69,.85);color:#fff;
  border:none;border-radius:100px;padding:10px 16px;font-family:var(--sans,-apple-system,sans-serif);
  font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 6px 16px rgba(11,37,69,.3)}
.pq-print-fab:hover{filter:brightness(1.1)}
`;
      function isRealQuotation(html) {
        return typeof html === "string" && (html.includes('class="sheet"') || html.includes('id="pq-doc"'));
      }
      function hasOwnContinueButton(html) {
        return typeof html === "string" && html.includes('id="paf-continue-btn"');
      }
      function composeClientDocument2(quotationHtml, prefillData) {
        if (!isRealQuotation(quotationHtml)) return quotationHtml;
        const runtimeSource = true ? '"use strict";\n(() => {\n  var __getOwnPropNames = Object.getOwnPropertyNames;\n  var __commonJS = (cb, mod) => function __require() {\n    try {\n      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;\n    } catch (e) {\n      throw mod = 0, e;\n    }\n  };\n\n  // browser-tool/application/validation.js\n  var require_validation = __commonJS({\n    "browser-tool/application/validation.js"(exports, module) {\n      "use strict";\n      function required(value) {\n        return value != null && String(value).trim().length > 0;\n      }\n      function isValidEmail(value) {\n        if (!value) return false;\n        return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(String(value).trim());\n      }\n      function isValidMalaysianPhone(value) {\n        if (!value) return false;\n        const digits = String(value).replace(/[\\s-]/g, "").replace(/^\\+?60/, "0");\n        return /^01\\d{8,9}$/.test(digits);\n      }\n      function isValidNRIC(value) {\n        if (!value) return false;\n        const digits = String(value).replace(/[\\s-]/g, "");\n        return /^\\d{12}$/.test(digits);\n      }\n      function formatNRIC(value) {\n        const digits = String(value || "").replace(/[\\s-]/g, "");\n        if (digits.length !== 12) return value || "";\n        return `${digits.slice(0, 6)}-${digits.slice(6, 8)}-${digits.slice(8, 12)}`;\n      }\n      function isValidPercentage(value) {\n        if (value === "" || value == null) return false;\n        const n = Number(value);\n        return Number.isFinite(n) && n > 0 && n <= 100;\n      }\n      function isValidPostcode(value) {\n        if (!value) return false;\n        return /^\\d{5}$/.test(String(value).trim());\n      }\n      var FIELD_RULES = {\n        // --- Step 1: Personal Information ---\n        fullName: { required: true, message: "Full name is required." },\n        nric: { required: true, validate: isValidNRIC, message: "Enter a valid NRIC (e.g. 900101-01-1234)." },\n        dateOfBirth: { required: true, message: "Date of birth is required." },\n        gender: { required: true, message: "Please select a gender." },\n        race: { required: true, message: "Please select a race." },\n        religion: { required: true, message: "Please select a religion." },\n        mobileNumber: { required: true, validate: isValidMalaysianPhone, message: "Enter a valid Malaysian mobile number (e.g. 012-3456789)." },\n        email: { required: true, validate: isValidEmail, message: "Enter a valid email address." },\n        address: { required: true, message: "Residential address is required." },\n        // --- Step 2: Employment Details ---\n        employmentType: { required: true, message: "Please select an employment type." },\n        occupation: { required: true, message: "Occupation is required." },\n        fieldOfWork: { required: false, message: "" },\n        employerName: { required: false, message: "" },\n        workAddress: { required: false, message: "" },\n        monthlyIncome: { required: true, validate: (v) => Number.isFinite(Number(v)) && Number(v) > 0, message: "Enter a valid monthly income." },\n        // Legacy alias kept so an older prefilled/cached value doesn\'t get silently dropped.\n        annualIncome: { required: false, validate: (v) => Number.isFinite(Number(v)) && Number(v) > 0, message: "Enter a valid annual income." },\n        employer: { required: false, message: "" },\n        // --- Step 3: Family Information ---\n        maritalStatus: { required: true, message: "Please select a marital status." },\n        spouseName: { required: false, message: "" },\n        spouseNric: { required: false, validate: isValidNRIC, message: "Enter a valid NRIC (e.g. 900101-01-1234)." },\n        numChildren: { required: false, validate: (v) => Number.isFinite(Number(v)) && Number(v) >= 0, message: "Enter a valid number of children." },\n        childrenDetails: { required: false, message: "" },\n        // --- Step 4: Medical History ---\n        height: { required: true, validate: (v) => Number.isFinite(Number(v)) && Number(v) > 0, message: "Enter a valid height in cm." },\n        weight: { required: true, validate: (v) => Number.isFinite(Number(v)) && Number(v) > 0, message: "Enter a valid weight in kg." },\n        smokingStatus: { required: true, message: "Please select a smoking status." },\n        preExisting: { required: false, message: "" },\n        medications: { required: false, message: "" },\n        allergies: { required: false, message: "" },\n        surgery: { required: false, message: "" },\n        // --- Step 5: Plan Selection + Beneficiary ---\n        plan: { required: true, message: "Please select a plan." },\n        beneficiaryName: { required: true, message: "Beneficiary name is required." },\n        beneficiaryNric: { required: true, validate: isValidNRIC, message: "Enter a valid NRIC (e.g. 900101-01-1234)." },\n        beneficiaryRelationship: { required: true, message: "Beneficiary relationship is required." },\n        beneficiaryPercentage: { required: true, validate: isValidPercentage, message: "Enter a percentage between 1 and 100." },\n        // --- Step 7: Bank Details ---\n        bankName: { required: true, message: "Bank name is required." },\n        accountNumber: { required: true, message: "Account number is required." },\n        accountHolderName: { required: true, message: "Account holder name is required." },\n        // Retained for a legacy Address-step shape, unused by the current 7-step layout.\n        postcode: { required: false, validate: isValidPostcode, message: "Enter a valid 5-digit postcode." },\n        city: { required: false, message: "City is required." },\n        state: { required: false, message: "Please select a state." }\n      };\n      function validateField(name, value) {\n        const rule = FIELD_RULES[name];\n        if (!rule) return null;\n        if (rule.required && !required(value)) return rule.message;\n        if (required(value) && rule.validate && !rule.validate(value)) return rule.message;\n        return null;\n      }\n      function validateFields(names, values) {\n        const errors = {};\n        for (const name of names) {\n          const msg = validateField(name, values[name]);\n          if (msg) errors[name] = msg;\n        }\n        return errors;\n      }\n      var PruBSNValidation = {\n        required,\n        isValidEmail,\n        isValidMalaysianPhone,\n        isValidNRIC,\n        formatNRIC,\n        isValidPercentage,\n        isValidPostcode,\n        validateField,\n        validateFields,\n        FIELD_RULES\n      };\n      if (typeof module !== "undefined" && module.exports) {\n        module.exports = PruBSNValidation;\n      }\n    }\n  });\n\n  // browser-tool/application/ApplicationForm.js\n  var require_ApplicationForm = __commonJS({\n    "browser-tool/application/ApplicationForm.js"(exports, module) {\n      "use strict";\n      var { validateFields } = require_validation();\n      function escapeHtml(value) {\n        return String(value == null ? "" : value).replace(/[&<>"\']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", \'"\': "&quot;", "\'": "&#39;" })[ch]);\n      }\n      var STEP_DEFS = [\n        {\n          id: "personal",\n          title: "Personal Information",\n          subtitle: "Tell us a little about yourself.",\n          fields: [\n            { name: "fullName", label: "Full Name", type: "text", autocomplete: "name" },\n            { name: "nric", label: "NRIC", type: "text", placeholder: "900101-01-1234" },\n            { name: "dateOfBirth", label: "Date of Birth", type: "date" },\n            { name: "gender", label: "Gender", type: "select", options: ["Male", "Female"] },\n            { name: "race", label: "Race", type: "select", options: ["Malay", "Chinese", "Indian", "Others"] },\n            { name: "religion", label: "Religion", type: "select", options: ["Islam", "Christianity", "Buddhism", "Hinduism", "Others"] },\n            { name: "email", label: "Email", type: "email", placeholder: "name@example.com" },\n            { name: "mobileNumber", label: "Phone Number", type: "tel", placeholder: "012-3456789" },\n            { name: "address", label: "Residential Address", type: "textarea" }\n          ]\n        },\n        {\n          id: "employment",\n          title: "Employment Details",\n          subtitle: "A few details about your work.",\n          fields: [\n            { name: "employmentType", label: "Employment Type", type: "select", options: ["Employed", "Self-Employed", "Business Owner", "Unemployed", "Retired", "Student"] },\n            { name: "occupation", label: "Occupation", type: "text" },\n            { name: "fieldOfWork", label: "Field of Work", type: "text", optional: true },\n            { name: "employerName", label: "Employer\'s Name", type: "text", optional: true },\n            { name: "monthlyIncome", label: "Monthly Income (RM)", type: "number", placeholder: "5000" },\n            { name: "workAddress", label: "Work Place Address", type: "textarea", optional: true }\n          ]\n        },\n        {\n          id: "family",\n          title: "Family Information",\n          subtitle: "Tell us about your immediate family.",\n          fields: [\n            { name: "maritalStatus", label: "Marital Status", type: "select", options: ["Single", "Married", "Divorced", "Widowed"] },\n            { name: "spouseName", label: "Spouse Name", type: "text", optional: true },\n            { name: "spouseNric", label: "Spouse NRIC", type: "text", placeholder: "900101-01-1234", optional: true },\n            { name: "numChildren", label: "Number of Children", type: "number", optional: true },\n            { name: "childrenDetails", label: "Children Details", type: "textarea", optional: true }\n          ]\n        },\n        {\n          id: "medical",\n          title: "Medical History",\n          subtitle: "This helps underwriting assess your application accurately.",\n          fields: [\n            { name: "height", label: "Height (cm)", type: "number", placeholder: "170" },\n            { name: "weight", label: "Weight (kg)", type: "number", placeholder: "65" },\n            { name: "smokingStatus", label: "Smoking Status", type: "select", options: ["Non-Smoker", "Smoker", "Former Smoker"] },\n            { name: "preExisting", label: "Pre-existing Medical Conditions", type: "textarea", optional: true, placeholder: "None, if not applicable" },\n            { name: "medications", label: "Current Medications", type: "textarea", optional: true, placeholder: "None, if not applicable" },\n            { name: "allergies", label: "Allergies", type: "textarea", optional: true, placeholder: "None, if not applicable" },\n            { name: "surgery", label: "Previous Surgery / Hospitalisation", type: "textarea", optional: true, placeholder: "None, if not applicable" }\n          ]\n        },\n        {\n          id: "plan",\n          title: "Plan Selection",\n          subtitle: "Choose the plan you would like to proceed with, and tell us who should receive the benefit.",\n          fields: [\n            { name: "plan", label: "Plan", type: "plan-cards" },\n            { name: "beneficiaryName", label: "Beneficiary Name", type: "text" },\n            { name: "beneficiaryNric", label: "Beneficiary NRIC", type: "text", placeholder: "900101-01-1234" },\n            { name: "beneficiaryRelationship", label: "Relationship", type: "text", placeholder: "e.g. Spouse, Child, Parent" },\n            { name: "beneficiaryPercentage", label: "Benefit Weightage (%)", type: "number", placeholder: "100" }\n          ]\n        },\n        {\n          id: "documents",\n          title: "Documents Upload",\n          subtitle: "Upload clear photos so your agent can verify your identity.",\n          fields: [\n            { name: "nricFront", label: "NRIC Front Photo", type: "file" },\n            { name: "nricRear", label: "NRIC Rear Photo", type: "file" },\n            { name: "selfie", label: "Selfie with IC Photo", type: "file" }\n          ]\n        },\n        {\n          id: "bank",\n          title: "Bank Details",\n          subtitle: "Where should refunds or payouts be sent?",\n          fields: [\n            { name: "bankName", label: "Bank Name", type: "text" },\n            { name: "accountNumber", label: "Account Number", type: "text" },\n            { name: "accountHolderName", label: "Account Holder Name", type: "text" }\n          ]\n        }\n      ];\n      var TOTAL_STEPS = STEP_DEFS.length;\n      var DOCUMENTS_STEP_INDEX = STEP_DEFS.findIndex((s) => s.id === "documents");\n      var PLAN_STEP_INDEX = STEP_DEFS.findIndex((s) => s.id === "plan");\n      function stepFieldNames(stepIndex) {\n        const step = STEP_DEFS[stepIndex];\n        return step ? step.fields.filter((f) => f.type !== "file" && f.type !== "plan-cards").map((f) => f.name) : [];\n      }\n      function stepFileFieldNames(stepIndex) {\n        const step = STEP_DEFS[stepIndex];\n        return step ? step.fields.filter((f) => f.type === "file").map((f) => f.name) : [];\n      }\n      function fieldHtml(field, value, error) {\n        const id = `paf-field-${field.name}`;\n        const errorId = `${id}-error`;\n        const commonAttrs = `id="${id}" name="${field.name}" class="paf-input${error ? " paf-input-error" : ""}"` + (field.autocomplete ? ` autocomplete="${field.autocomplete}"` : "") + (field.optional ? "" : \' aria-required="true"\') + (error ? ` aria-invalid="true" aria-describedby="${errorId}"` : "");\n        let control;\n        if (field.type === "select") {\n          const options = field.options.map((opt) => `<option value="${escapeHtml(opt)}"${value === opt ? " selected" : ""}>${escapeHtml(opt)}</option>`).join("");\n          control = `<select ${commonAttrs}><option value="">Select...</option>${options}</select>`;\n        } else if (field.type === "textarea") {\n          control = `<textarea ${commonAttrs} rows="3" placeholder="${escapeHtml(field.placeholder || "")}">${escapeHtml(value)}</textarea>`;\n        } else {\n          control = `<input type="${field.type}" ${commonAttrs} value="${escapeHtml(value)}" placeholder="${escapeHtml(field.placeholder || "")}">`;\n        }\n        const wideClass = field.type === "textarea" ? " paf-field-wide" : "";\n        return `\n    <div class="paf-field${wideClass}">\n      <label class="paf-label" for="${id}">${escapeHtml(field.label)}${field.optional ? \' <span class="paf-optional">(optional)</span>\' : ""}</label>\n      ${control}\n      ${error ? `<div class="paf-error" id="${errorId}">${escapeHtml(error)}</div>` : ""}\n    </div>`;\n      }\n      function fileFieldHtml(field, file, error) {\n        const hasFile = !!file;\n        return `\n    <div class="paf-field paf-file-field">\n      <label class="paf-label" for="paf-file-${field.name}">${escapeHtml(field.label)}</label>\n      <label class="paf-upload${hasFile ? " paf-upload-done" : ""}${error ? " paf-input-error" : ""}" for="paf-file-${field.name}">\n        <span class="paf-upload-icon" aria-hidden="true">${hasFile ? "&#10003;" : "+"}</span>\n        <span class="paf-upload-text">${hasFile ? escapeHtml(file.name) : "Click to upload &mdash; JPG, PNG, or PDF (max 5MB)"}</span>\n      </label>\n      <input type="file" id="paf-file-${field.name}" name="${field.name}" class="paf-upload-input" data-file-field="${field.name}" accept="image/*,.pdf">\n      ${error ? `<div class="paf-error">${escapeHtml(error)}</div>` : ""}\n    </div>`;\n      }\n      function planCardsHtml(plans, selectedIndex, error) {\n        const list = Array.isArray(plans) && plans.length ? plans : [];\n        if (!list.length) {\n          return `<div class="paf-plan-empty">Your agent has not attached a plan to this application yet.</div>`;\n        }\n        const cards = list.map((p, i) => {\n          const picked = selectedIndex === i;\n          return `\n      <div class="paf-plan-card${picked ? " paf-plan-card-picked" : ""}" data-plan-index="${i}" role="button" tabindex="0">\n        ${list.length > 1 && i === 0 ? \'<div class="paf-plan-badge">Recommended</div>\' : ""}\n        <div class="paf-plan-name">${escapeHtml(p.planName || `Option ${i + 1}`)}</div>\n        <div class="paf-plan-price">${p.monthlyContribution ? escapeHtml(p.monthlyContribution) : "&mdash;"}<small>/mo</small></div>\n        <div class="paf-plan-meta">${[p.roomAndBoard, p.annualLimit].filter(Boolean).map(escapeHtml).join(" &middot; ")}</div>\n      </div>`;\n        }).join("");\n        return `<div class="paf-plan-cards" data-field="plan">${cards}</div>${error ? `<div class="paf-error">${escapeHtml(error)}</div>` : ""}`;\n      }\n      function renderStepHtml(stepIndex, values, errors, context) {\n        const step = STEP_DEFS[stepIndex];\n        if (!step) return "";\n        const files = context && context.files || {};\n        const plans = context && context.plans || [];\n        const errs = errors || {};\n        const fieldsHtml = step.fields.map((f) => {\n          if (f.type === "file") return fileFieldHtml(f, files[f.name], errs[f.name]);\n          if (f.type === "plan-cards") {\n            const selectedIndex = plans.findIndex((p) => p.planName === values.plan);\n            return planCardsHtml(plans, selectedIndex === -1 ? null : selectedIndex, errs.plan);\n          }\n          return fieldHtml(f, values[f.name] || "", errs[f.name]);\n        }).join("");\n        return `\n    <div class="paf-step" data-step-id="${step.id}">\n      <h3 class="paf-step-title">${escapeHtml(step.title)}</h3>\n      <p class="paf-step-subtitle">${escapeHtml(step.subtitle)}</p>\n      <div class="paf-fields">${fieldsHtml}</div>\n    </div>`;\n      }\n      function collectStepValues(stepIndex, containerEl) {\n        const names = stepFieldNames(stepIndex);\n        const values = {};\n        for (const name of names) {\n          const el = containerEl.querySelector(`[name="${name}"]`);\n          values[name] = el ? el.value : "";\n        }\n        return values;\n      }\n      function validateStep(stepIndex, values) {\n        return validateFields(stepFieldNames(stepIndex), values);\n      }\n      var PruBSNApplicationForm = {\n        STEP_DEFS,\n        TOTAL_STEPS,\n        DOCUMENTS_STEP_INDEX,\n        PLAN_STEP_INDEX,\n        stepFieldNames,\n        stepFileFieldNames,\n        renderStepHtml,\n        collectStepValues,\n        validateStep\n      };\n      if (typeof module !== "undefined" && module.exports) {\n        module.exports = PruBSNApplicationForm;\n      }\n    }\n  });\n\n  // browser-tool/application/ReviewPage.js\n  var require_ReviewPage = __commonJS({\n    "browser-tool/application/ReviewPage.js"(exports, module) {\n      "use strict";\n      var { STEP_DEFS } = require_ApplicationForm();\n      function escapeHtml(value) {\n        return String(value == null ? "" : value).replace(/[&<>"\']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", \'"\': "&quot;", "\'": "&#39;" })[ch]);\n      }\n      function na(value) {\n        return value == null || String(value).trim() === "" ? \'<span class="paf-na">Not provided</span>\' : escapeHtml(value);\n      }\n      function summaryRow(label, value) {\n        return `<div class="paf-summary-row"><span class="paf-summary-label">${escapeHtml(label)}</span><span class="paf-summary-value">${value}</span></div>`;\n      }\n      function renderQuotationSummary(quotation) {\n        const q = quotation || {};\n        const riders = Array.isArray(q.riders) && q.riders.length ? `<ul class="paf-rider-list">${q.riders.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>` : \'<span class="paf-na">None selected</span>\';\n        return `\n    <section class="paf-review-section">\n      <h4 class="paf-review-heading">Quotation Summary</h4>\n      ${summaryRow("Quotation Number", na(q.quotationNumber))}\n      ${summaryRow("Valid Until", na(q.validUntil))}\n      ${summaryRow("Base Plan", na(q.planName))}\n      ${summaryRow("Monthly Total Amount Payable", na(q.monthlyContribution))}\n      <div class="paf-summary-row paf-summary-row-block">\n        <span class="paf-summary-label">Optional Riders</span>\n        <div class="paf-summary-value">${riders}</div>\n      </div>\n    </section>`;\n      }\n      function renderAgentInfo(agent) {\n        const a = agent || {};\n        return `\n    <section class="paf-review-section">\n      <h4 class="paf-review-heading">Agent Information <span class="paf-readonly-tag">Read-only</span></h4>\n      ${summaryRow("Agent Name", na(a.name))}\n      ${summaryRow("Agency", na(a.agency))}\n      ${summaryRow("Branch", na(a.branch))}\n      ${summaryRow("Contact", na(a.phone || a.email))}\n    </section>`;\n      }\n      function fieldSummaryRow(field, values, files) {\n        if (field.type === "file") {\n          const file = files[field.name];\n          return summaryRow(field.label, file ? escapeHtml(file.name) : \'<span class="paf-na">Not uploaded</span>\');\n        }\n        if (field.type === "plan-cards") {\n          return summaryRow(field.label, na(values[field.name]));\n        }\n        return summaryRow(field.label, na(values[field.name]));\n      }\n      function renderReviewHtml(prefillData, formValues, files) {\n        const data = prefillData || {};\n        const values = formValues || {};\n        const uploadedFiles = files || {};\n        const clientSections = STEP_DEFS.map((step, stepIndex) => {\n          const rows = step.fields.map((f) => fieldSummaryRow(f, values, uploadedFiles)).join("");\n          return `\n      <section class="paf-review-section">\n        <h4 class="paf-review-heading">\n          ${escapeHtml(step.title)}\n          <button type="button" class="paf-edit-link" data-goto-step="${stepIndex}">Edit</button>\n        </h4>\n        ${rows}\n      </section>`;\n        }).join("");\n        return `\n    <div class="paf-step paf-review" data-step-id="review">\n      <h3 class="paf-step-title">Review Your Application</h3>\n      <p class="paf-step-subtitle">Please check everything below before submitting. You can edit any section.</p>\n      ${renderQuotationSummary(data.quotation)}\n      ${renderAgentInfo(data.agent)}\n      ${clientSections}\n    </div>`;\n      }\n      var PruBSNReviewPage = { renderReviewHtml };\n      if (typeof module !== "undefined" && module.exports) {\n        module.exports = PruBSNReviewPage;\n      }\n    }\n  });\n\n  // browser-tool/application/ConfirmationPage.js\n  var require_ConfirmationPage = __commonJS({\n    "browser-tool/application/ConfirmationPage.js"(exports, module) {\n      "use strict";\n      function escapeHtml(value) {\n        return String(value == null ? "" : value).replace(/[&<>"\']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", \'"\': "&quot;", "\'": "&#39;" })[ch]);\n      }\n      function na(value) {\n        return value == null || String(value).trim() === "" ? \'<span class="paf-na">Not available</span>\' : escapeHtml(value);\n      }\n      function summaryRow(label, value) {\n        return `<div class="paf-summary-row"><span class="paf-summary-label">${escapeHtml(label)}</span><span class="paf-summary-value">${value}</span></div>`;\n      }\n      var ERROR_MESSAGES = {\n        validation: "There was a problem with your application details.",\n        timeout: "The connection timed out before a response was received.",\n        network: "We couldn\'t reach the server. Please check your internet connection.",\n        not_configured: "Submission is not available right now. Please contact your agent.",\n        http_error: "The server rejected the submission.",\n        server: "The submission service was unavailable.",\n        rate_limited: "Too many submission attempts right now. Please wait a minute and try again.",\n        unknown: "Something went wrong while submitting your application."\n      };\n      function friendlyErrorMessage(error) {\n        const type = error && error.type;\n        return type && ERROR_MESSAGES[type] || ERROR_MESSAGES.unknown;\n      }\n      function renderPending() {\n        return `\n    <div class="paf-step paf-confirmation" data-step-id="confirmation">\n      <div class="paf-confirm-icon" aria-hidden="true">&#8943;</div>\n      <h3 class="paf-step-title">Submitting Your Application&hellip;</h3>\n      <p class="paf-step-subtitle">Please wait a moment. Do not close this window.</p>\n    </div>`;\n      }\n      function renderSuccess(view) {\n        const submittedAt = view.submittedAt ? new Date(view.submittedAt).toLocaleString() : null;\n        return `\n    <div class="paf-step paf-confirmation" data-step-id="confirmation">\n      <div class="paf-confirm-icon" aria-hidden="true">&#10003;</div>\n      <h3 class="paf-step-title">Application Submitted</h3>\n      <p class="paf-step-subtitle">Thank you. Your application has been received.</p>\n      <div class="paf-review-section">\n        ${summaryRow("Reference Number", na(view.reference))}\n        ${summaryRow("Submission Time", submittedAt ? escapeHtml(submittedAt) : na(null))}\n        ${summaryRow("Submission Status", "Confirmed")}\n        ${summaryRow("Agent Name", na(view.agentName))}\n      </div>\n      <p class="paf-confirm-note">Your agent will follow up to complete processing of this application.</p>\n    </div>`;\n      }\n      function renderFailed(view) {\n        return `\n    <div class="paf-step paf-confirmation" data-step-id="confirmation">\n      <div class="paf-confirm-icon" aria-hidden="true">&#10007;</div>\n      <h3 class="paf-step-title">Submission Failed</h3>\n      <p class="paf-step-subtitle">${escapeHtml(friendlyErrorMessage(view.error))}</p>\n      <p class="paf-confirm-note">Your details have been saved on this device. Retrying will not ask you to fill in the form again.</p>\n      <div class="paf-nav">\n        <span></span>\n        <button type="button" class="paf-btn paf-btn-primary" data-action="retry">Retry Submission</button>\n      </div>\n    </div>`;\n      }\n      function renderConfirmationHtml(view) {\n        const v = view || {};\n        if (v.status === "success") return renderSuccess(v);\n        if (v.status === "failed") return renderFailed(v);\n        return renderPending();\n      }\n      var PruBSNConfirmationPage = { renderConfirmationHtml };\n      if (typeof module !== "undefined" && module.exports) {\n        module.exports = PruBSNConfirmationPage;\n      }\n    }\n  });\n\n  // browser-tool/application/submission.js\n  var require_submission = __commonJS({\n    "browser-tool/application/submission.js"(exports, module) {\n      "use strict";\n      function buildSubmission(prefillData, formState) {\n        const quotation = prefillData && prefillData.quotation || {};\n        const client = {\n          fullName: formState.fullName || "",\n          nric: formState.nric || "",\n          dateOfBirth: formState.dateOfBirth || "",\n          gender: formState.gender || "",\n          mobileNumber: formState.mobileNumber || "",\n          email: formState.email || ""\n        };\n        const application = {\n          address: formState.address || "",\n          postcode: formState.postcode || "",\n          city: formState.city || "",\n          state: formState.state || "",\n          occupation: formState.occupation || "",\n          employer: formState.employer || "",\n          annualIncome: formState.annualIncome || "",\n          beneficiary: {\n            name: formState.beneficiaryName || "",\n            relationship: formState.beneficiaryRelationship || "",\n            percentage: formState.beneficiaryPercentage || ""\n          }\n        };\n        return {\n          quotation,\n          client,\n          application,\n          timestamp: (/* @__PURE__ */ new Date()).toISOString()\n        };\n      }\n      var PruBSNSubmission = { buildSubmission };\n      if (typeof module !== "undefined" && module.exports) {\n        module.exports = PruBSNSubmission;\n      }\n    }\n  });\n\n  // browser-tool/models/SubmissionPayload.js\n  var require_SubmissionPayload = __commonJS({\n    "browser-tool/models/SubmissionPayload.js"(exports, module) {\n      "use strict";\n      var { buildSubmission } = require_submission();\n      var PARSER_VERSION = "v1.0-phase1-parser";\n      var RENDERER_VERSION = "v1.1-phase2-renderer";\n      var PAYLOAD_VERSION = "1.2";\n      var SUBMISSION_SOURCE = "quotation-generator-client-application";\n      function buildAgentInfo(prefillData) {\n        const source = prefillData && prefillData.agent || {};\n        const agent = {};\n        if (source.name) agent.name = source.name;\n        if (source.agency) agent.agency = source.agency;\n        if (source.branch) agent.branch = source.branch;\n        if (source.phone) agent.phone = source.phone;\n        if (source.email) agent.email = source.email;\n        return agent;\n      }\n      function buildPlansCompared(prefillData) {\n        return prefillData && Array.isArray(prefillData.plans) ? prefillData.plans : [];\n      }\n      function buildSelectedPlanDetails(prefillData, formState) {\n        const planName = formState && formState.plan || null;\n        if (!planName) return null;\n        const plans = buildPlansCompared(prefillData);\n        const match = plans.find((p) => p.planName === planName);\n        return match ? { ...match } : { planName };\n      }\n      function buildEmployment(formState) {\n        const f = formState || {};\n        return {\n          employmentType: f.employmentType || "",\n          fieldOfWork: f.fieldOfWork || "",\n          employerName: f.employerName || "",\n          workAddress: f.workAddress || "",\n          monthlyIncome: f.monthlyIncome || ""\n        };\n      }\n      function buildFamily(formState) {\n        const f = formState || {};\n        return {\n          maritalStatus: f.maritalStatus || "",\n          spouseName: f.spouseName || "",\n          spouseNric: f.spouseNric || "",\n          numChildren: f.numChildren || "",\n          childrenDetails: f.childrenDetails || ""\n        };\n      }\n      function buildMedicalHistory(formState) {\n        const f = formState || {};\n        return {\n          height: f.height || "",\n          weight: f.weight || "",\n          smokingStatus: f.smokingStatus || "",\n          preExistingConditions: f.preExisting || "",\n          currentMedications: f.medications || "",\n          allergies: f.allergies || "",\n          previousSurgeryOrHospitalisation: f.surgery || ""\n        };\n      }\n      function buildBank(formState) {\n        const f = formState || {};\n        return {\n          bankName: f.bankName || "",\n          accountNumber: f.accountNumber || "",\n          accountHolderName: f.accountHolderName || ""\n        };\n      }\n      function buildSubmissionPayload(prefillData, formState, documents, options) {\n        const { submissionId } = options || {};\n        const legacy = buildSubmission(prefillData, formState);\n        const { beneficiary, ...applicationRest } = legacy.application;\n        const applicant = {\n          ...legacy.client,\n          ...applicationRest,\n          // Step 1 fields the frozen submission.js\'s buildSubmission() never\n          // carried into `client` - added here, not there, so that file stays\n          // wrapped rather than modified (see this file\'s header comment).\n          race: formState && formState.race || "",\n          religion: formState && formState.religion || ""\n        };\n        const beneficiaries = beneficiary && beneficiary.name ? [{ ...beneficiary, nric: formState && formState.beneficiaryNric || "" }] : [];\n        const generatedMeta = prefillData && prefillData.metadata || {};\n        return {\n          version: PAYLOAD_VERSION,\n          quotation: legacy.quotation,\n          plansCompared: buildPlansCompared(prefillData),\n          selectedPlan: formState && formState.plan || null,\n          selectedPlanDetails: buildSelectedPlanDetails(prefillData, formState),\n          agent: buildAgentInfo(prefillData),\n          applicant,\n          beneficiaries,\n          employment: buildEmployment(formState),\n          family: buildFamily(formState),\n          medicalHistory: buildMedicalHistory(formState),\n          bank: buildBank(formState),\n          documents: documents || {},\n          metadata: {\n            submissionId: submissionId || null,\n            quotationId: legacy.quotation && legacy.quotation.quotationNumber || null,\n            parserVersion: PARSER_VERSION,\n            rendererVersion: RENDERER_VERSION,\n            generatedAt: generatedMeta.generatedAt || null,\n            submittedAt: (/* @__PURE__ */ new Date()).toISOString(),\n            product: legacy.quotation && legacy.quotation.planName || null,\n            source: SUBMISSION_SOURCE\n          }\n        };\n      }\n      var PruBSNSubmissionPayload = { buildSubmissionPayload, PARSER_VERSION, RENDERER_VERSION, PAYLOAD_VERSION };\n      if (typeof module !== "undefined" && module.exports) {\n        module.exports = PruBSNSubmissionPayload;\n      }\n    }\n  });\n\n  // browser-tool/queue/SubmissionQueue.js\n  var require_SubmissionQueue = __commonJS({\n    "browser-tool/queue/SubmissionQueue.js"(exports, module) {\n      "use strict";\n      var STORAGE_KEY = "prubsn_submission_queue_v1";\n      function hasWorkingLocalStorage() {\n        try {\n          if (typeof localStorage === "undefined") return false;\n          const probeKey = `${STORAGE_KEY}_probe`;\n          localStorage.setItem(probeKey, "1");\n          localStorage.removeItem(probeKey);\n          return true;\n        } catch (e) {\n          return false;\n        }\n      }\n      function createQueue() {\n        const persistent = hasWorkingLocalStorage();\n        let memoryEntries = [];\n        if (!persistent && typeof console !== "undefined") {\n          console.warn("SubmissionQueue: localStorage is unavailable in this context; falling back to in-memory-only queue (entries will not survive a page reload).");\n        }\n        function readAll() {\n          if (!persistent) return memoryEntries;\n          try {\n            const raw = localStorage.getItem(STORAGE_KEY);\n            return raw ? JSON.parse(raw) : [];\n          } catch (e) {\n            return [];\n          }\n        }\n        function writeAll(entries) {\n          if (!persistent) {\n            memoryEntries = entries;\n            return;\n          }\n          try {\n            localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));\n          } catch (e) {\n          }\n        }\n        function enqueue(submissionId, payload, error) {\n          const entries = readAll();\n          const existing = entries.find((e) => e.submissionId === submissionId);\n          const now = (/* @__PURE__ */ new Date()).toISOString();\n          if (existing) {\n            existing.payload = payload;\n            existing.lastError = error || null;\n            existing.attempts += 1;\n            existing.updatedAt = now;\n          } else {\n            entries.push({\n              submissionId,\n              payload,\n              resolved: false,\n              attempts: 1,\n              lastError: error || null,\n              createdAt: now,\n              updatedAt: now\n            });\n          }\n          writeAll(entries);\n        }\n        function markResolved(submissionId, reference) {\n          const entries = readAll();\n          const existing = entries.find((e) => e.submissionId === submissionId);\n          const now = (/* @__PURE__ */ new Date()).toISOString();\n          if (existing) {\n            existing.resolved = true;\n            existing.reference = reference || null;\n            existing.payload = null;\n            existing.updatedAt = now;\n          } else {\n            entries.push({\n              submissionId,\n              payload: null,\n              resolved: true,\n              reference: reference || null,\n              attempts: 1,\n              lastError: null,\n              createdAt: now,\n              updatedAt: now\n            });\n          }\n          writeAll(entries);\n        }\n        function hasResolved(submissionId) {\n          const existing = readAll().find((e) => e.submissionId === submissionId);\n          return Boolean(existing && existing.resolved);\n        }\n        function getReference(submissionId) {\n          const existing = readAll().find((e) => e.submissionId === submissionId);\n          return existing && existing.resolved ? existing.reference : null;\n        }\n        function listPending() {\n          return readAll().filter((e) => !e.resolved);\n        }\n        function isPersistent() {\n          return persistent;\n        }\n        return { enqueue, markResolved, hasResolved, getReference, listPending, isPersistent };\n      }\n      var PruBSNSubmissionQueue = { createQueue };\n      if (typeof module !== "undefined" && module.exports) {\n        module.exports = PruBSNSubmissionQueue;\n      }\n    }\n  });\n\n  // browser-tool/services/SubmissionService.js\n  var require_SubmissionService = __commonJS({\n    "browser-tool/services/SubmissionService.js"(exports, module) {\n      "use strict";\n      var { createQueue } = require_SubmissionQueue();\n      var defaultQueue = createQueue();\n      function classifyError(err) {\n        const type = err && err.type || "unknown";\n        const message = err && err.message || "Submission failed for an unknown reason.";\n        return { type, message };\n      }\n      function validatePayload(payload) {\n        if (!payload || typeof payload !== "object") return "Payload is missing.";\n        if (!payload.metadata || !payload.metadata.submissionId) return "Payload is missing metadata.submissionId.";\n        if (!payload.applicant || typeof payload.applicant !== "object") return "Payload is missing applicant details.";\n        if (!Array.isArray(payload.beneficiaries)) return "Payload is missing a beneficiaries array.";\n        return null;\n      }\n      async function submit(payload, options) {\n        const { destination, queue = defaultQueue } = options || {};\n        if (!destination || typeof destination.send !== "function") {\n          throw new Error("SubmissionService.submit: a destination with a send() function is required.");\n        }\n        const submissionId = payload && payload.metadata && payload.metadata.submissionId;\n        const validationMessage = validatePayload(payload);\n        if (validationMessage) {\n          const error = { type: "validation", message: validationMessage };\n          if (submissionId) queue.enqueue(submissionId, payload, error);\n          return { status: "failed", submissionId: submissionId || null, error, queued: Boolean(submissionId) };\n        }\n        if (queue.hasResolved(submissionId)) {\n          return { status: "success", submissionId, reference: queue.getReference(submissionId), deduped: true };\n        }\n        queue.enqueue(submissionId, payload, null);\n        try {\n          const result = await destination.send(payload);\n          queue.markResolved(submissionId, result && result.reference);\n          return { status: "success", submissionId, reference: result && result.reference };\n        } catch (err) {\n          const error = classifyError(err);\n          queue.enqueue(submissionId, payload, error);\n          return { status: "failed", submissionId, error, queued: true };\n        }\n      }\n      function listPending(queue = defaultQueue) {\n        return queue.listPending();\n      }\n      var SubmissionService = { submit, listPending, defaultQueue };\n      if (typeof module !== "undefined" && module.exports) {\n        module.exports = SubmissionService;\n      }\n    }\n  });\n\n  // browser-tool/destinations/AirtableDestination.js\n  var require_AirtableDestination = __commonJS({\n    "browser-tool/destinations/AirtableDestination.js"(exports, module) {\n      "use strict";\n      var endpointUrl = null;\n      var DEFAULT_TIMEOUT_MS = 15e3;\n      function configure(options) {\n        endpointUrl = options && options.endpointUrl || null;\n      }\n      function createTypedError(type, message) {\n        const err = new Error(message);\n        err.type = type;\n        return err;\n      }\n      function fallbackReference(payload) {\n        const submissionId = payload && payload.metadata && payload.metadata.submissionId;\n        return submissionId ? `AT-${String(submissionId).slice(0, 8).toUpperCase()}` : `AT-${Date.now().toString(36).toUpperCase()}`;\n      }\n      function typeForBackendCode(code) {\n        switch (code) {\n          case "not_configured":\n            return "not_configured";\n          case "timeout":\n            return "timeout";\n          case "rate_limited":\n            return "rate_limited";\n          case "invalid_content_type":\n          case "invalid_json":\n          case "invalid_payload":\n          case "payload_too_large":\n          case "method_not_allowed":\n            return "validation";\n          default:\n            return "server";\n        }\n      }\n      async function send(payload) {\n        if (!endpointUrl) {\n          throw createTypedError("not_configured", "AirtableDestination: endpointUrl is not set. See this file\'s header for setup steps.");\n        }\n        const controller = typeof AbortController !== "undefined" ? new AbortController() : null;\n        const timer = controller ? setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS) : null;\n        let response;\n        try {\n          response = await fetch(endpointUrl, {\n            method: "POST",\n            headers: { "Content-Type": "application/json" },\n            body: JSON.stringify(payload),\n            signal: controller ? controller.signal : void 0\n          });\n        } catch (err) {\n          if (err && err.name === "AbortError") {\n            throw createTypedError("timeout", "AirtableDestination: request timed out.");\n          }\n          throw createTypedError("network", `AirtableDestination: network error - ${err && err.message ? err.message : err}`);\n        } finally {\n          if (timer) clearTimeout(timer);\n        }\n        let body = null;\n        try {\n          body = await response.json();\n        } catch (e) {\n        }\n        if (!response.ok || !body || body.success !== true) {\n          const code = body && body.code;\n          const type = code ? typeForBackendCode(code) : "http_error";\n          const message = body && body.error || `AirtableDestination: backend responded with HTTP ${response.status}`;\n          throw createTypedError(type, message);\n        }\n        return { reference: body.recordId || fallbackReference(payload) };\n      }\n      var AirtableDestination = { name: "airtable", send, configure };\n      if (typeof module !== "undefined" && module.exports) {\n        module.exports = AirtableDestination;\n      }\n    }\n  });\n\n  // browser-tool/application/clientRuntime.js\n  var require_clientRuntime = __commonJS({\n    "browser-tool/application/clientRuntime.js"(exports, module) {\n      var ApplicationForm = require_ApplicationForm();\n      var ReviewPage = require_ReviewPage();\n      var ConfirmationPage = require_ConfirmationPage();\n      var { buildSubmissionPayload } = require_SubmissionPayload();\n      var SubmissionService = require_SubmissionService();\n      var AirtableDestination = require_AirtableDestination();\n      var REVIEW_STEP = ApplicationForm.TOTAL_STEPS;\n      var CONFIRMATION_STEP = ApplicationForm.TOTAL_STEPS + 1;\n      var STEP_LABELS = ApplicationForm.STEP_DEFS.map((s) => s.title).concat(["Review"]);\n      AirtableDestination.configure({\n        endpointUrl: "https://prubsn-submission-service.syakirbadry.workers.dev/submit"\n      });\n      var ACTIVE_DESTINATION = AirtableDestination;\n      var MAX_FILE_BYTES = 5 * 1024 * 1024;\n      function fileToBase64(file) {\n        return new Promise((resolve, reject) => {\n          const reader = new FileReader();\n          reader.onload = () => resolve(String(reader.result).split(",")[1]);\n          reader.onerror = reject;\n          reader.readAsDataURL(file);\n        });\n      }\n      function deriveDobFromNric(nricValue) {\n        const digits = String(nricValue || "").replace(/\\D/g, "").slice(0, 6);\n        if (digits.length !== 6) return null;\n        const yy = parseInt(digits.slice(0, 2), 10);\n        const mm = parseInt(digits.slice(2, 4), 10);\n        const dd = parseInt(digits.slice(4, 6), 10);\n        if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;\n        const currentYY = (/* @__PURE__ */ new Date()).getFullYear() % 100;\n        const century = yy <= currentYY ? 2e3 : 1900;\n        const pad = (n) => String(n).padStart(2, "0");\n        return `${century + yy}-${pad(mm)}-${pad(dd)}`;\n      }\n      function generateSubmissionId() {\n        if (typeof crypto !== "undefined" && crypto.getRandomValues) {\n          const bytes = crypto.getRandomValues(new Uint8Array(16));\n          bytes[6] = bytes[6] & 15 | 64;\n          bytes[8] = bytes[8] & 63 | 128;\n          const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");\n          return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;\n        }\n        return `sub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;\n      }\n      function buildInitialValues(prefillData) {\n        const client = prefillData && prefillData.client || {};\n        return {\n          fullName: client.fullName || "",\n          dateOfBirth: client.dateOfBirthIso || "",\n          gender: client.gender || ""\n        };\n      }\n      function renderProgressHtml(currentStep) {\n        const items = STEP_LABELS.map((label, i) => {\n          const status = i < currentStep ? "done" : i === currentStep ? "current" : "upcoming";\n          return `<li class="paf-progress-item paf-progress-${status}"><span class="paf-progress-dot">${i + 1}</span><span class="paf-progress-label">${label}</span></li>`;\n        }).join("");\n        return `<ol class="paf-progress">${items}</ol>`;\n      }\n      function renderNavHtml(currentStep) {\n        if (currentStep === CONFIRMATION_STEP) return "";\n        const backBtn = currentStep > 0 ? \'<button type="button" class="paf-btn paf-btn-secondary" data-action="back">Back</button>\' : "<span></span>";\n        const forwardBtn = currentStep === REVIEW_STEP ? \'<button type="button" class="paf-btn paf-btn-primary" data-action="submit">Submit Application</button>\' : \'<button type="button" class="paf-btn paf-btn-primary" data-action="next">Next</button>\';\n        return `<div class="paf-nav">${backBtn}${forwardBtn}</div>`;\n      }\n      function initApplicationFlow(rootEl, prefillData) {\n        if (!rootEl) return;\n        const state = {\n          currentStep: 0,\n          values: buildInitialValues(prefillData),\n          files: {},\n          // Documents step File objects, keyed by field name - never merged into `values`\n          errors: {},\n          submissionId: null,\n          submissionPayload: null,\n          submissionStatus: "idle",\n          // \'idle\' | \'pending\' | \'success\' | \'failed\'\n          submissionResult: null\n          // last SubmissionService.submit() result\n        };\n        const continueBtn = document.getElementById("paf-continue-btn");\n        const quotationCard = document.querySelector(".sheet, #pq-doc");\n        const printBtn = document.getElementById("pq-print-btn");\n        function buildConfirmationView() {\n          const result = state.submissionResult;\n          return {\n            status: state.submissionStatus,\n            reference: result && result.reference,\n            submittedAt: state.submissionPayload && state.submissionPayload.metadata.submittedAt,\n            agentName: prefillData && prefillData.agent && prefillData.agent.name,\n            error: result && result.error\n          };\n        }\n        function render() {\n          const bodyHtml = state.currentStep < REVIEW_STEP ? ApplicationForm.renderStepHtml(state.currentStep, state.values, state.errors, { files: state.files, plans: prefillData && prefillData.plans }) : state.currentStep === REVIEW_STEP ? ReviewPage.renderReviewHtml(prefillData, state.values, state.files) : ConfirmationPage.renderConfirmationHtml(buildConfirmationView());\n          rootEl.innerHTML = `\n      <div class="paf-shell">\n        ${state.currentStep <= REVIEW_STEP ? \'<button type="button" class="paf-back-link" data-action="close">&larr; Back to quotation</button>\' : ""}\n        ${state.currentStep <= REVIEW_STEP ? renderProgressHtml(state.currentStep) : ""}\n        <div class="paf-step-body">${bodyHtml}</div>\n        ${renderNavHtml(state.currentStep)}\n      </div>`;\n          attachHandlers();\n        }\n        function goToStep(index) {\n          const alreadyThere = state.currentStep === index;\n          state.currentStep = index;\n          render();\n          if (!alreadyThere) rootEl.scrollIntoView({ block: "start", behavior: "smooth" });\n        }\n        function persistCurrentStepValues() {\n          if (state.currentStep >= REVIEW_STEP) return;\n          const container = rootEl.querySelector(".paf-step");\n          if (!container) return;\n          Object.assign(state.values, ApplicationForm.collectStepValues(state.currentStep, container));\n          if (!state.values.dateOfBirth) {\n            const derived = deriveDobFromNric(state.values.nric);\n            if (derived) state.values.dateOfBirth = derived;\n          }\n        }\n        function validateDocumentsStep() {\n          const errors = {};\n          for (const name of ApplicationForm.stepFileFieldNames(state.currentStep)) {\n            const file = state.files[name];\n            if (!file) errors[name] = "Please upload this document.";\n            else if (file.size > MAX_FILE_BYTES) errors[name] = "File is too large - please upload a file under 5MB.";\n          }\n          return errors;\n        }\n        function handleNext() {\n          persistCurrentStepValues();\n          const errors = state.currentStep === ApplicationForm.DOCUMENTS_STEP_INDEX ? validateDocumentsStep() : ApplicationForm.validateStep(state.currentStep, state.values);\n          if (state.currentStep === ApplicationForm.PLAN_STEP_INDEX && !state.values.plan) {\n            errors.plan = "Please select a plan.";\n          }\n          if (Object.keys(errors).length > 0) {\n            state.errors = errors;\n            render();\n            return;\n          }\n          state.errors = {};\n          goToStep(state.currentStep + 1);\n        }\n        function handleBack() {\n          persistCurrentStepValues();\n          goToStep(Math.max(0, state.currentStep - 1));\n        }\n        async function handleSubmit() {\n          if (state.submissionStatus === "pending") return;\n          if (!state.submissionId) state.submissionId = generateSubmissionId();\n          state.submissionStatus = "pending";\n          goToStep(CONFIRMATION_STEP);\n          if (!state.submissionPayload) {\n            const documents = {};\n            for (const [name, file] of Object.entries(state.files)) {\n              try {\n                documents[name] = { filename: file.name, mimeType: file.type || "application/octet-stream", base64: await fileToBase64(file) };\n              } catch (e) {\n              }\n            }\n            state.submissionPayload = buildSubmissionPayload(prefillData, state.values, documents, { submissionId: state.submissionId });\n          }\n          const result = await SubmissionService.submit(state.submissionPayload, { destination: ACTIVE_DESTINATION });\n          state.submissionResult = result;\n          state.submissionStatus = result.status;\n          render();\n        }\n        function handleClose() {\n          persistCurrentStepValues();\n          rootEl.hidden = true;\n          if (quotationCard) quotationCard.hidden = false;\n          if (continueBtn) continueBtn.hidden = false;\n          if (printBtn) printBtn.hidden = false;\n        }\n        function attachHandlers() {\n          rootEl.querySelectorAll("[data-action]").forEach((btn) => {\n            btn.addEventListener("click", (evt) => {\n              const action = evt.currentTarget.getAttribute("data-action");\n              if (action === "next") handleNext();\n              else if (action === "back") handleBack();\n              else if (action === "submit") handleSubmit();\n              else if (action === "retry") handleSubmit();\n              else if (action === "close") handleClose();\n            });\n          });\n          rootEl.querySelectorAll("[data-goto-step]").forEach((btn) => {\n            btn.addEventListener("click", (evt) => {\n              persistCurrentStepValues();\n              goToStep(Number(evt.currentTarget.getAttribute("data-goto-step")));\n            });\n          });\n          rootEl.querySelectorAll("[data-file-field]").forEach((input) => {\n            input.addEventListener("change", (evt) => {\n              const name = evt.currentTarget.getAttribute("data-file-field");\n              const file = evt.currentTarget.files && evt.currentTarget.files[0];\n              if (!file) return;\n              state.files[name] = file;\n              if (state.errors[name]) delete state.errors[name];\n              render();\n            });\n          });\n          rootEl.querySelectorAll("[data-plan-index]").forEach((card) => {\n            const select = () => {\n              const idx = Number(card.getAttribute("data-plan-index"));\n              const plans = prefillData && prefillData.plans || [];\n              const chosen = plans[idx];\n              if (!chosen) return;\n              state.values.plan = chosen.planName || `Option ${idx + 1}`;\n              if (state.errors.plan) delete state.errors.plan;\n              render();\n            };\n            card.addEventListener("click", select);\n            card.addEventListener("keydown", (evt) => {\n              if (evt.key === "Enter" || evt.key === " ") {\n                evt.preventDefault();\n                select();\n              }\n            });\n          });\n        }\n        function openFlow() {\n          if (quotationCard) quotationCard.hidden = true;\n          if (continueBtn) continueBtn.hidden = true;\n          if (printBtn) printBtn.hidden = true;\n          rootEl.hidden = false;\n          render();\n          rootEl.scrollIntoView({ block: "start", behavior: "smooth" });\n        }\n        if (continueBtn) {\n          continueBtn.addEventListener("click", openFlow);\n        }\n      }\n      if (typeof window !== "undefined") {\n        window.__prubsnInitApplicationFlow = initApplicationFlow;\n      }\n      if (typeof module !== "undefined" && module.exports) {\n        module.exports = { initApplicationFlow };\n      }\n    }\n  });\n  require_clientRuntime();\n})();\n' : "";
        const prefillJson = JSON.stringify(prefillData || {}).replace(/</g, "\\u003c");
        const continueButtonHtml = hasOwnContinueButton(quotationHtml) ? "" : '<button type="button" id="paf-continue-btn" class="paf-cta">Continue Application &rarr;</button>';
        return `${quotationHtml}
<style>${APPLICATION_STYLE}</style>
${continueButtonHtml}
<button type="button" id="pq-print-btn" class="pq-print-fab">Print / Save as PDF</button>
<div id="paf-app-root" class="paf-app-root" hidden></div>
<script type="application/json" id="paf-prefill-data">${prefillJson}<\/script>
<script>${runtimeSource}<\/script>
<script>
(function () {
  var root = document.getElementById('paf-app-root');
  var dataEl = document.getElementById('paf-prefill-data');
  var prefill = {};
  try { prefill = JSON.parse(dataEl.textContent); } catch (e) {}
  if (root && typeof window.__prubsnInitApplicationFlow === 'function') {
    window.__prubsnInitApplicationFlow(root, prefill);
  }
  var printBtn = document.getElementById('pq-print-btn');
  if (printBtn) printBtn.addEventListener('click', function () { window.print(); });
})();
<\/script>
`;
      }
      module.exports = { composeClientDocument: composeClientDocument2 };
    }
  });

  // browser-tool/publishQuotation.js
  var require_publishQuotation = __commonJS({
    "browser-tool/publishQuotation.js"(exports, module) {
      "use strict";
      var PUBLISH_ENDPOINT = "https://prubsn-submission-service.syakirbadry.workers.dev/publish";
      var { formatMoney, formatMoneyFixed2, resolveMonthlyTotalPayable } = require_formatters();
      function buildPublishPayload(data, generatedHtml, rendererVersion) {
        const contributions = data && data.contributions || {};
        const monthlyValue = resolveMonthlyTotalPayable(contributions);
        const annualValue = contributions.totalAnnualContribution;
        return {
          clientName: data && data.client && data.client.fullName || "Client",
          plan: data && data.metadata && data.metadata.productName || null,
          monthlyTotalPayable: monthlyValue != null ? `RM ${formatMoneyFixed2(monthlyValue)}` : null,
          annualContribution: annualValue != null ? `RM ${formatMoney(annualValue)}` : null,
          rendererVersion,
          quotationJson: data,
          generatedHtml
        };
      }
      async function publishQuotation2(data, generatedHtml, rendererVersion) {
        const payload = buildPublishPayload(data, generatedHtml, rendererVersion);
        try {
          const res = await fetch(PUBLISH_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          let body;
          try {
            body = await res.json();
          } catch (e) {
            return { status: "failed", error: "The publishing service returned an unexpected response." };
          }
          if (!res.ok || !body.success) {
            return { status: "failed", error: body && body.error || "Could not publish this quotation." };
          }
          return { status: "success", url: body.url, id: body.id };
        } catch (err) {
          return { status: "failed", error: "Could not reach the publishing service. Check your connection and try again." };
        }
      }
      module.exports = { publishQuotation: publishQuotation2, buildPublishPayload, PUBLISH_ENDPOINT };
    }
  });

  // browser-tool/app.js
  var { extractPagesFromPdf } = require_pdfTextSource_browser();
  var { parseQuotation } = require_parser();
  var { validateQuotation } = require_validate();
  var { renderAgentReviewHtml, renderClientQuotationHtml } = require_renderQuotation();
  var { renderComparisonHtml } = require_renderComparison();
  var { primaryValue } = require_formatters();
  var { RENDERER_VERSION } = require_renderNarrativeQuotation();
  var { buildPrefillData } = require_buildPrefillData();
  var { composeClientDocument } = require_composeClientDocument();
  var { publishQuotation } = require_publishQuotation();
  var MAX_QUOTATIONS = 3;
  var MAX_PDF_BYTES = 50 * 1024 * 1024;
  var KNOWN_MERGED_BENEFIT_VALUES = {
    "Surgical Procedure and Treatment": "As charged",
    "Post-Hospitalisation Treatment": "As charged",
    "Outpatient Kidney Dialysis Treatment": "RM1,000,000 per lifetime"
  };
  function applyKnownMergedBenefitValues(data) {
    const items = data && data.benefits && data.benefits.benefitItems;
    if (!Array.isArray(items)) return;
    for (const item of items) {
      const known = KNOWN_MERGED_BENEFIT_VALUES[item.label];
      if (known && !primaryValue(item.value)) {
        item.value = known;
        item.prefilledFromKnownMergedCell = true;
      }
    }
  }
  var EDITABLE_FIELDS = [
    { section: "Metadata", path: "metadata.productName", label: "Product name" },
    { section: "Metadata", path: "metadata.quotationDate.raw", label: "Quotation date (as printed, DD/MM/YYYY)" },
    { section: "Client", path: "client.fullName", label: "Full name" },
    { section: "Client", path: "client.gender", label: "Gender" },
    { section: "Client", path: "client.smokerStatus", label: "Smoker status" },
    { section: "Client", path: "client.occupationClass", label: "Occupation class" },
    { section: "Client", path: "client.ageNextBirthday", label: "Age next birthday", type: "number" },
    { section: "Client", path: "client.dateOfBirth.raw", label: "Date of birth (DD/MM/YYYY)" },
    { section: "Agent", path: "agent.agentCode", label: "Agent code (drives agency/branch/contact lookup)" },
    { section: "Agent", path: "agent.agentNameOnDocument", label: "Agent name (as printed on PDF)" },
    { section: "Plan", path: "plan.typeOfProduct", label: "Type of product" },
    { section: "Plan", path: "plan.basicPlanName", label: "Basic plan name" },
    { section: "Plan", path: "plan.basicPlanTerm", label: "Basic plan term (years)", type: "number" },
    { section: "Plan", path: "plan.basicSumCovered", label: "Basic sum covered (RM)", type: "number" },
    { section: "Plan", path: "plan.medicalRiderName", label: "Medical rider name" },
    { section: "Plan", path: "plan.medicalPlanTier", label: "Medical plan tier" },
    { section: "Plan", path: "plan.coPaymentOption", label: "Co-payment option" },
    { section: "Plan", path: "plan.medicalRiderTerm", label: "Medical rider term (years)", type: "number" },
    { section: "Plan", path: "plan.coverageToAge", label: "Coverage to age", type: "number" },
    { section: "Contributions", path: "contributions.isaContribution", label: "ISA contribution (RM)", type: "number" },
    { section: "Contributions", path: "contributions.medicTotalCareContribution", label: "Medic TotalCare contribution (RM)", type: "number" },
    { section: "Contributions", path: "contributions.protectionContribution", label: "Protection contribution (RM)", type: "number" },
    { section: "Contributions", path: "contributions.wakalahCertificateCharge", label: "Wakalah certificate charge (RM)", type: "number" },
    { section: "Contributions", path: "contributions.totalMonthlyContribution", label: "Total monthly contribution (RM)", type: "number" },
    { section: "Contributions", path: "contributions.totalAnnualContribution", label: "Total annual contribution (RM)", type: "number" },
    { section: "Contributions", path: "contributions.guaranteedDeathTPDBenefit", label: "Guaranteed death/TPD benefit (RM)", type: "number" },
    { section: "Benefits", path: "benefits.annualLimit", label: "Annual limit" },
    { section: "Benefits", path: "benefits.lifetimeLimit", label: "Lifetime limit" },
    { section: "Options", path: "options.coverageTerm", label: "Options table coverage term" }
  ];
  var OPTION_COLUMN_FIELDS = [
    ["productName", "Product name"],
    ["annualContribution", "Annual contribution (RM)"],
    ["coPaymentOption", "Co-payment option"],
    ["roomAndBoard", "Room & board"],
    ["annualLimitOption", "Annual limit"],
    ["lifetimeLimitOption", "Lifetime limit"],
    ["facilityType", "Facility type"]
  ];
  function getPath(obj, path) {
    return path.split(".").reduce((acc, key) => acc == null ? void 0 : acc[key], obj);
  }
  function setPath(obj, path, value) {
    const keys = path.split(".");
    let cursor = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      if (cursor[keys[i]] == null) cursor[keys[i]] = {};
      cursor = cursor[keys[i]];
    }
    cursor[keys[keys.length - 1]] = value;
  }
  function warningsForPath(warnings, path) {
    return (warnings || []).filter((w) => w.field === path || w.field.startsWith(path + "."));
  }
  function errorsForPath(errors, path) {
    return (errors || []).filter((e) => e.field === path || e.field.startsWith(path + "."));
  }
  function escapeHtml(value) {
    if (value == null) return "";
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  var quotationIdCounter = 0;
  var state = {
    stage: "upload",
    // upload | review | output
    quotations: [],
    // { id, fileName, status: 'parsing'|'ready'|'error', errorMessage, data, warnings, errors }
    activeReviewIndex: 0,
    activeOutputIndex: 0,
    quotationNumber: "",
    validUntilIso: "",
    generatedDocs: [],
    // [{ fileName, html }] one per quotation, filled in on Generate
    comparisonHtml: null
  };
  var el = {
    stages: {
      upload: document.getElementById("stage-upload"),
      review: document.getElementById("stage-review"),
      output: document.getElementById("stage-output")
    },
    stepChips: Array.from(document.querySelectorAll(".step-chip")),
    fileInput: document.getElementById("file-input"),
    dropZone: document.getElementById("drop-zone"),
    fileList: document.getElementById("file-list"),
    uploadNotice: document.getElementById("upload-notice"),
    continueBtn: document.getElementById("continue-to-review-btn"),
    reviewTabs: document.getElementById("review-tabs"),
    reviewPanels: document.getElementById("review-panels"),
    revalidateBtn: document.getElementById("revalidate-btn"),
    ackCheckbox: document.getElementById("ack-checkbox"),
    quotationNumberInput: document.getElementById("quotation-number-input"),
    validUntilInput: document.getElementById("valid-until-input"),
    generateBtn: document.getElementById("generate-btn"),
    backToUploadBtn: document.getElementById("back-to-upload-btn"),
    startOverBtn: document.getElementById("start-over-btn"),
    outputBanner: document.getElementById("output-banner"),
    publishStatus: document.getElementById("publish-status"),
    publishLinkRow: document.getElementById("publish-link-row"),
    publicLinkInput: document.getElementById("public-link-input"),
    copyLinkBtn: document.getElementById("copy-link-btn"),
    openClientViewBtn: document.getElementById("open-client-view-btn"),
    comparisonBlock: document.getElementById("comparison-block"),
    comparisonFrame: document.getElementById("comparison-frame"),
    printComparisonBtn: document.getElementById("print-comparison-btn"),
    outputTabs: document.getElementById("output-tabs"),
    previewFrame: document.getElementById("preview-frame"),
    previewViewQuotationBtn: document.getElementById("preview-view-quotation-btn"),
    previewViewFormBtn: document.getElementById("preview-view-form-btn"),
    downloadBtn: document.getElementById("download-btn"),
    printBtn: document.getElementById("print-btn"),
    outputBackBtn: document.getElementById("output-back-btn"),
    outputStartOverBtn: document.getElementById("output-start-over-btn")
  };
  function showStage(stage) {
    state.stage = stage;
    Object.entries(el.stages).forEach(([name, node]) => node.classList.toggle("active", name === stage));
    const order = ["upload", "review", "output"];
    const activeIdx = order.indexOf(stage);
    el.stepChips.forEach((chip) => {
      const idx = order.indexOf(chip.dataset.step);
      chip.classList.toggle("active", idx === activeIdx);
      chip.classList.toggle("done", idx < activeIdx);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function renderFileList() {
    el.fileList.innerHTML = state.quotations.map((q, i) => {
      const icon = q.status === "parsing" ? '<span class="spinner" aria-hidden="true"></span>' : q.status === "ready" ? "&#10003;" : "&#10007;";
      const statusText = q.status === "parsing" ? "Reading and parsing&hellip;" : q.status === "ready" ? q.errors && q.errors.length ? `${q.errors.length} required field(s) need attention` : "Ready for review" : q.errorMessage || "Could not read this file.";
      return `
      <div class="file-chip ${q.status}">
        <div class="fi">${icon}</div>
        <div class="meta">
          <div class="fname">${escapeHtml(q.fileName)}</div>
          <div class="fstatus">${escapeHtml(statusText)}</div>
        </div>
        <button type="button" class="remove-btn" data-remove-index="${i}" aria-label="Remove ${escapeHtml(q.fileName)}">&times;</button>
      </div>`;
    }).join("");
    el.fileList.querySelectorAll("[data-remove-index]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const idx = Number(e.currentTarget.dataset.removeIndex);
        state.quotations.splice(idx, 1);
        renderFileList();
        updateContinueButton();
      });
    });
  }
  function updateContinueButton() {
    const hasParsing = state.quotations.some((q) => q.status === "parsing");
    const hasReady = state.quotations.some((q) => q.status === "ready");
    el.continueBtn.hidden = state.quotations.length === 0;
    el.continueBtn.disabled = hasParsing || !hasReady;
    el.continueBtn.textContent = hasParsing ? "Parsing\u2026" : "Continue to Review \u2192";
  }
  function showUploadNotice(message) {
    el.uploadNotice.textContent = message;
    el.uploadNotice.hidden = false;
  }
  function clearUploadNotice() {
    el.uploadNotice.hidden = true;
    el.uploadNotice.textContent = "";
  }
  function isDuplicateOfExisting(file) {
    return state.quotations.some((q) => q.fileName === file.name && q.fileSize === file.size);
  }
  async function parseOneFile(entry, file) {
    try {
      const buffer = await file.arrayBuffer();
      const pages = await extractPagesFromPdf(new Uint8Array(buffer));
      const result = parseQuotation(pages, { sourceFileName: file.name, validityDays: 14 });
      applyKnownMergedBenefitValues(result.data);
      entry.status = "ready";
      entry.data = result.data;
      entry.warnings = result.warnings;
      entry.errors = result.errors;
    } catch (err) {
      entry.status = "error";
      const reason = (err && err.message ? err.message : "unknown error").replace(/\.+$/, "");
      entry.errorMessage = `Could not read this PDF: ${reason}.`;
      console.error(err);
    }
    renderFileList();
    updateContinueButton();
  }
  function handleFiles(fileList) {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    clearUploadNotice();
    const duplicateNames = [];
    const deduped = incoming.filter((file) => {
      if (isDuplicateOfExisting(file)) {
        duplicateNames.push(file.name);
        return false;
      }
      return true;
    });
    const remainingSlots = MAX_QUOTATIONS - state.quotations.length;
    const accepted = deduped.slice(0, Math.max(0, remainingSlots));
    const overflowCount = deduped.length - accepted.length;
    for (const file of accepted) {
      const entry = {
        id: `q${quotationIdCounter++}`,
        fileName: file.name,
        fileSize: file.size,
        status: "parsing",
        errorMessage: null,
        data: null,
        warnings: [],
        errors: []
      };
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
        entry.status = "error";
        entry.errorMessage = "Not a PDF file.";
        state.quotations.push(entry);
        continue;
      }
      if (file.size > MAX_PDF_BYTES) {
        entry.status = "error";
        entry.errorMessage = `File is too large (${Math.round(file.size / 1024 / 1024)}MB) - please check this is the right file.`;
        state.quotations.push(entry);
        continue;
      }
      state.quotations.push(entry);
      parseOneFile(entry, file);
    }
    const notices = [];
    if (duplicateNames.length) {
      notices.push(`Already added, skipped: ${duplicateNames.join(", ")}.`);
    }
    if (overflowCount > 0) {
      notices.push(`Only ${MAX_QUOTATIONS} quotations can be compared at once - ${overflowCount} file${overflowCount > 1 ? "s were" : " was"} not added. Remove one above to add another.`);
    }
    if (notices.length) showUploadNotice(notices.join(" "));
    renderFileList();
    updateContinueButton();
  }
  el.fileInput.addEventListener("change", (e) => {
    handleFiles(e.target.files);
    el.fileInput.value = "";
  });
  el.dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    el.dropZone.classList.add("drag-over");
  });
  el.dropZone.addEventListener("dragleave", () => el.dropZone.classList.remove("drag-over"));
  el.dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    el.dropZone.classList.remove("drag-over");
    handleFiles(e.dataTransfer.files);
  });
  el.continueBtn.addEventListener("click", () => {
    state.quotations = state.quotations.filter((q) => q.status === "ready");
    if (!state.quotations.length) return;
    state.activeReviewIndex = 0;
    renderReviewStage();
    showStage("review");
  });
  function quotationLabel(q, index) {
    const name = q.data && q.data.client && q.data.client.fullName;
    return name || q.fileName || `Quotation ${index + 1}`;
  }
  function fieldRowHtml(q, qIndex, field) {
    const value = getPath(q.data, field.path);
    const fieldWarnings = warningsForPath(q.warnings, field.path);
    const fieldErrors = errorsForPath(q.errors, field.path);
    const hasError = fieldErrors.length > 0;
    const displayValue = value == null ? "" : value;
    const inputType = field.type === "number" ? "number" : "text";
    const notesHtml = [
      ...fieldErrors.map((e) => `<div class="field-note field-note-error">${escapeHtml(e.message)}</div>`),
      ...fieldWarnings.map((w) => `<div class="field-note field-note-warn">${escapeHtml(w.message)}</div>`)
    ].join("");
    return `
    <label class="field-row ${hasError ? "field-row-error" : ""}">
      <span class="field-label">${escapeHtml(field.label)}</span>
      <input type="${inputType}" data-q-index="${qIndex}" data-path="${field.path}" value="${escapeHtml(String(displayValue))}" class="field-input">
      ${notesHtml}
    </label>`;
  }
  function benefitItemsTableHtml(q, qIndex) {
    const items = q.data.benefits && q.data.benefits.benefitItems || [];
    const rows = items.map((item, i) => {
      const warn = (q.warnings || []).find((w) => w.field === `benefits.benefitItems.${item.label}`);
      const note = item.prefilledFromKnownMergedCell ? "Pre-filled: this row shares a merged cell with an adjacent benefit in the source PDF. Value verified against the source document - please confirm before sending." : warn && warn.message;
      return `
      <tr class="${item.value == null ? "row-flagged" : ""}">
        <td>${escapeHtml(item.label)}</td>
        <td><input type="text" data-q-index="${qIndex}" data-benefit-index="${i}" value="${escapeHtml(item.value || "")}" class="field-input"></td>
      </tr>
      ${note ? `<tr class="note-row"><td colspan="2" class="field-note field-note-warn">${escapeHtml(note)}</td></tr>` : ""}`;
    }).join("");
    return `<div class="table-scroll"><table><thead><tr><th>Benefit</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  function optionsTableHtml(q, qIndex) {
    const columns = q.data.options && q.data.options.columns || [];
    const head = `<tr><th></th>${columns.map((c) => `<th>${escapeHtml(c.optionLabel || "")}</th>`).join("")}</tr>`;
    const rows = OPTION_COLUMN_FIELDS.map(([key, label]) => `
    <tr>
      <th>${escapeHtml(label)}</th>
      ${columns.map((c, i) => `<td><input type="text" data-q-index="${qIndex}" data-option-index="${i}" data-option-key="${key}" value="${escapeHtml(c[key] == null ? "" : String(c[key]))}" class="field-input"></td>`).join("")}
    </tr>`).join("");
    return `<div class="table-scroll"><table><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
  }
  function reviewPanelHtml(q, qIndex) {
    const { errors, warnings } = q;
    const banners = [];
    if (errors.length) {
      banners.push(`<div class="banner banner-error"><b>${errors.length} required field(s) still need attention.</b> The client quotation cannot be generated until these are fixed.</div>`);
    } else {
      banners.push(`<div class="banner banner-ok">All required fields are present.</div>`);
    }
    if (warnings.length) {
      banners.push(`<div class="banner banner-warn"><b>${warnings.length} warning(s).</b> Review the flagged fields below - none of this is shown to the client, but you should verify it against the source PDF.</div>`);
    }
    const sections = [...new Set(EDITABLE_FIELDS.map((f) => f.section))];
    const formHtml = sections.map((section) => {
      const fields = EDITABLE_FIELDS.filter((f) => f.section === section);
      return `<fieldset><legend>${escapeHtml(section)}</legend><div class="fields-grid">${fields.map((f) => fieldRowHtml(q, qIndex, f)).join("")}</div></fieldset>`;
    }).join("");
    return `
    <div class="tab-panel ${qIndex === state.activeReviewIndex ? "active" : ""}" data-panel-index="${qIndex}">
      ${banners.join("")}
      <h2 class="section-title">Extracted fields</h2>
      ${formHtml}
      <h2 class="section-title">Benefits table</h2>
      ${benefitItemsTableHtml(q, qIndex)}
      <h2 class="section-title">Product options</h2>
      ${optionsTableHtml(q, qIndex)}
    </div>`;
  }
  function renderReviewTabs() {
    el.reviewTabs.innerHTML = state.quotations.map((q, i) => {
      const cls = q.errors.length ? "tab-error" : "tab-ok";
      return `<button type="button" class="tab-btn ${cls} ${i === state.activeReviewIndex ? "active" : ""}" data-tab-index="${i}">
      <span class="tab-dot"></span>${escapeHtml(quotationLabel(q, i))}
    </button>`;
    }).join("");
    el.reviewTabs.hidden = state.quotations.length <= 1;
    el.reviewTabs.querySelectorAll("[data-tab-index]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        state.activeReviewIndex = Number(e.currentTarget.dataset.tabIndex);
        renderReviewTabs();
        el.reviewPanels.querySelectorAll(".tab-panel").forEach((panel) => {
          panel.classList.toggle("active", Number(panel.dataset.panelIndex) === state.activeReviewIndex);
        });
      });
    });
  }
  function renderReviewStage() {
    renderReviewTabs();
    el.reviewPanels.innerHTML = state.quotations.map((q, i) => reviewPanelHtml(q, i)).join("");
    updateGateState();
  }
  el.reviewPanels.addEventListener("input", (e) => {
    const target = e.target;
    const qIndex = Number(target.dataset.qIndex);
    if (Number.isNaN(qIndex) || !state.quotations[qIndex]) return;
    const q = state.quotations[qIndex];
    if (target.dataset.path) {
      const path = target.dataset.path;
      const field = EDITABLE_FIELDS.find((f) => f.path === path);
      const raw = target.value;
      const value = field && field.type === "number" ? raw === "" ? null : Number(raw) : raw === "" ? null : raw;
      setPath(q.data, path, value);
    } else if (target.dataset.benefitIndex != null && target.dataset.benefitIndex !== "") {
      const idx = Number(target.dataset.benefitIndex);
      q.data.benefits.benefitItems[idx].value = target.value || null;
      q.data.benefits.benefitItems[idx].prefilledFromKnownMergedCell = false;
    } else if (target.dataset.optionIndex != null && target.dataset.optionIndex !== "") {
      const idx = Number(target.dataset.optionIndex);
      const key = target.dataset.optionKey;
      const raw = target.value;
      q.data.options.columns[idx][key] = key === "annualContribution" ? raw === "" ? null : Number(raw) : raw || null;
    }
    updateGateState();
  });
  function revalidateAll() {
    for (const q of state.quotations) {
      const { warnings, errors } = validateQuotation(q.data);
      q.warnings = warnings;
      q.errors = errors;
    }
    renderReviewStage();
  }
  el.revalidateBtn.addEventListener("click", revalidateAll);
  function updateGateState() {
    const canAcknowledge = state.quotations.every((q) => q.errors.length === 0);
    el.ackCheckbox.disabled = !canAcknowledge;
    if (!canAcknowledge) el.ackCheckbox.checked = false;
    el.generateBtn.disabled = !(canAcknowledge && el.ackCheckbox.checked);
    el.reviewTabs.querySelectorAll("[data-tab-index]").forEach((btn) => {
      const i = Number(btn.dataset.tabIndex);
      const hasErrors = state.quotations[i] && state.quotations[i].errors.length > 0;
      btn.classList.toggle("tab-error", hasErrors);
      btn.classList.toggle("tab-ok", !hasErrors);
    });
  }
  el.ackCheckbox.addEventListener("change", updateGateState);
  el.backToUploadBtn.addEventListener("click", () => showStage("upload"));
  el.startOverBtn.addEventListener("click", resetAll);
  async function publishAllGeneratedDocs() {
    await Promise.all(
      state.generatedDocs.map(async (doc) => {
        const result = await publishQuotation(doc.data, doc.html, RENDERER_VERSION);
        doc.publish = result;
        if (state.generatedDocs.includes(doc) && state.stage === "output") {
          renderOutputStage();
        }
      })
    );
  }
  el.generateBtn.addEventListener("click", () => {
    const agentReview = {
      acknowledged: true,
      quotationNumber: el.quotationNumberInput.value.trim() || null,
      validUntilIso: el.validUntilInput.value || null
    };
    const allData = state.quotations.map((q) => q.data);
    const prefillData = buildPrefillData(allData, agentReview);
    state.generatedDocs = state.quotations.map((q) => {
      const quotationHtml = renderClientQuotationHtml({ data: q.data, warnings: q.warnings, errors: q.errors }, agentReview);
      const html = composeClientDocument(quotationHtml, prefillData);
      const safeName = (q.data.client.fullName || "quotation").replace(/[^a-z0-9]+/gi, "_");
      return { fileName: `${safeName}_quotation.html`, html, label: quotationLabel(q, 0), data: q.data, publish: { status: "pending" } };
    });
    state.comparisonHtml = state.quotations.length > 1 ? renderComparisonHtml(
      state.quotations.map((q) => ({ data: q.data, warnings: q.warnings, errors: [] })),
      state.quotations.map(() => ({ acknowledged: true }))
    ) : null;
    state.activeOutputIndex = 0;
    renderOutputStage();
    showStage("output");
    publishAllGeneratedDocs();
  });
  function renderPublishBlock(doc) {
    if (!doc) {
      el.publishStatus.innerHTML = "";
      el.publishLinkRow.hidden = true;
      return;
    }
    const publish = doc.publish || { status: "pending" };
    if (publish.status === "pending") {
      el.publishStatus.innerHTML = `<div class="banner banner-info"><span class="spinner" aria-hidden="true"></span> Publishing quotation\u2026</div>`;
      el.publishLinkRow.hidden = true;
    } else if (publish.status === "failed") {
      const errorText = String(publish.error || "unknown error").trim().replace(/\.+$/, "");
      el.publishStatus.innerHTML = `<div class="banner banner-error">Could not publish this quotation: ${escapeHtml(errorText)}. <button type="button" class="btn-outline" id="publish-retry-btn">Retry</button></div>`;
      el.publishLinkRow.hidden = true;
      const retryBtn = document.getElementById("publish-retry-btn");
      if (retryBtn) {
        retryBtn.addEventListener("click", async () => {
          doc.publish = { status: "pending" };
          renderOutputStage();
          doc.publish = await publishQuotation(doc.data, doc.html, RENDERER_VERSION);
          if (state.generatedDocs.includes(doc) && state.stage === "output") renderOutputStage();
        });
      }
    } else {
      el.publishStatus.innerHTML = `<div class="banner banner-ok">Quotation generated successfully.</div>`;
      el.publishLinkRow.hidden = false;
      el.publicLinkInput.value = publish.url;
    }
  }
  el.copyLinkBtn.addEventListener("click", async () => {
    const doc = state.generatedDocs[state.activeOutputIndex];
    if (!doc || !doc.publish || doc.publish.status !== "success") return;
    try {
      if (!navigator.clipboard) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(doc.publish.url);
      el.copyLinkBtn.textContent = "\u2713 Client link copied";
    } catch (e) {
      el.copyLinkBtn.textContent = "Could not copy - select the link above manually";
      el.publicLinkInput.select();
    }
    setTimeout(() => {
      el.copyLinkBtn.textContent = "Copy Client Link";
    }, 2500);
  });
  el.openClientViewBtn.addEventListener("click", () => {
    const doc = state.generatedDocs[state.activeOutputIndex];
    if (!doc || !doc.publish || doc.publish.status !== "success") return;
    window.open(doc.publish.url, "_blank");
  });
  function renderOutputStage() {
    const multi = state.quotations.length > 1;
    el.outputBanner.innerHTML = multi ? `<div class="banner banner-ok">${state.quotations.length} quotations generated. A comparison is shown automatically below.</div>` : "";
    el.comparisonBlock.hidden = !multi;
    if (multi) {
      el.comparisonFrame.srcdoc = state.comparisonHtml;
    }
    el.outputTabs.hidden = !multi;
    el.outputTabs.innerHTML = state.generatedDocs.map((doc, i) => `
    <button type="button" class="tab-btn ${i === state.activeOutputIndex ? "active" : ""}" data-output-tab-index="${i}">${escapeHtml(doc.label)}</button>
  `).join("");
    el.outputTabs.querySelectorAll("[data-output-tab-index]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        state.activeOutputIndex = Number(e.currentTarget.dataset.outputTabIndex);
        renderOutputStage();
      });
    });
    const activeDoc = state.generatedDocs[state.activeOutputIndex];
    renderPublishBlock(activeDoc);
    el.previewFrame.srcdoc = activeDoc ? activeDoc.html : "";
    el.previewViewQuotationBtn.classList.add("active");
    el.previewViewFormBtn.classList.remove("active");
  }
  function showClientFormInPreview() {
    const doc = el.previewFrame.contentDocument;
    if (!doc) return;
    const continueBtn = doc.getElementById("paf-continue-btn");
    const root = doc.getElementById("paf-app-root");
    if (continueBtn && root && root.hidden) continueBtn.click();
    if (root) root.scrollIntoView({ behavior: "smooth", block: "start" });
    el.previewViewFormBtn.classList.add("active");
    el.previewViewQuotationBtn.classList.remove("active");
  }
  function showQuotationInPreview() {
    const doc = el.previewFrame.contentDocument;
    if (doc && doc.documentElement) doc.documentElement.scrollIntoView({ behavior: "smooth", block: "start" });
    el.previewViewQuotationBtn.classList.add("active");
    el.previewViewFormBtn.classList.remove("active");
  }
  el.previewViewFormBtn.addEventListener("click", showClientFormInPreview);
  el.previewViewQuotationBtn.addEventListener("click", showQuotationInPreview);
  el.downloadBtn.addEventListener("click", () => {
    const doc = state.generatedDocs[state.activeOutputIndex];
    if (!doc) return;
    downloadHtml(doc.html, doc.fileName);
  });
  function downloadHtml(html, fileName) {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  function printHtml(html) {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank");
    if (!win) {
      alert("Please allow pop-ups for this site to print or save as PDF.");
      return;
    }
    win.addEventListener("load", () => {
      win.focus();
      win.print();
      setTimeout(() => URL.revokeObjectURL(url), 1e4);
    });
  }
  el.printBtn.addEventListener("click", () => {
    const doc = state.generatedDocs[state.activeOutputIndex];
    if (doc) printHtml(doc.html);
  });
  el.printComparisonBtn.addEventListener("click", () => {
    if (state.comparisonHtml) printHtml(state.comparisonHtml);
  });
  el.outputBackBtn.addEventListener("click", () => showStage("review"));
  el.outputStartOverBtn.addEventListener("click", resetAll);
  function resetAll() {
    state.quotations = [];
    state.activeReviewIndex = 0;
    state.activeOutputIndex = 0;
    state.generatedDocs = [];
    state.comparisonHtml = null;
    el.quotationNumberInput.value = "";
    el.validUntilInput.value = "";
    el.ackCheckbox.checked = false;
    clearUploadNotice();
    renderFileList();
    updateContinueButton();
    showStage("upload");
  }
  showStage("upload");
})();
