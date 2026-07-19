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
      function formatDateLong(iso) {
        if (!iso) return null;
        const d = /* @__PURE__ */ new Date(iso + "T00:00:00Z");
        if (Number.isNaN(d.getTime())) return null;
        return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
      }
      function shortValue(value) {
        if (!value) return null;
        return value.split("(")[0].trim();
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
        formatDateLong,
        shortValue,
        coPaymentAmount,
        compactRate,
        bareTierNumber,
        primaryValue: primaryValue2
      };
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
        formatDateLong,
        coPaymentAmount,
        compactRate,
        bareTierNumber,
        primaryValue: primaryValue2
      } = require_formatters();
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
          return `<span class="na">${escapeHtml2(clientText || "Refer to certificate")}</span>`;
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
`;
      function renderQuotationCard(data, mode, agentReview = {}) {
        const { metadata = {}, client = {}, agent = {}, plan = {}, contributions = {}, benefits = {}, options = {}, projection = {} } = data || {};
        const helpers = buildHelpers(mode);
        const { missing, money, textOr } = helpers;
        const agentConfig = getAgentConfig(agent.agentCode) || {};
        const agencyName = agentConfig.agency || textOr(null, "agency not configured for this agent code", "our agency");
        const branchName = agentConfig.branch || "";
        const preparedByName = agentConfig.name || agent.agentNameOnDocument || missing("agent name not found", "your servicing agent");
        const agentLine = [preparedByName, agent.agentCode ? `Agent ${agent.agentCode}` : null].filter(Boolean).join(" \xB7 ");
        const dealershipLine = [agentConfig.branch, agentConfig.agency, agentConfig.location].filter(Boolean).join(" \xB7 ");
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
        const planLabel = [plan.medicalRiderName, plan.medicalPlanTier].filter(Boolean).join(" ") || missing("plan not found");
        const planSubtitle = [metadata.productName, [plan.medicalRiderName, plan.medicalPlanTier ? `(${plan.medicalPlanTier})` : null].filter(Boolean).join(" ")].filter(Boolean).join(" \xB7 ");
        const sourceNote = mode === "client" && quotationDateFormatted ? `<div class="src-note">Interactive quotation prepared from the PruBSN Product Illustration dated ${escapeHtml2(quotationDateFormatted)}.</div>` : "";
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
    <svg class="mark" viewBox="0 0 100 100" aria-label="${escapeHtml2(agencyName)}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#FDB913"/><stop offset="1" stop-color="#D4AF37"/></linearGradient></defs>
      <rect width="100" height="100" rx="14" fill="#000"/>
      <path d="M50 20 L70 66 L58 66 L50 44 L42 66 L30 66 Z" fill="url(#g)"/>
      <path d="M62 40 L80 80 L68 80 L58 56 Z" fill="url(#g)" opacity=".55"/>
    </svg>
    <div class="co">${escapeHtml2(agencyName)}<small>${escapeHtml2(branchName)}</small></div>
    <div class="rt">${headerLines.join("<br>")}</div>
  </div>

  <div class="hero">
    <div class="medcard">
      <div class="brandrow"><span class="g">${escapeHtml2(agencyName)}</span><span class="type">Medical Card</span></div>
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
      <div class="fig"><div class="lab">Monthly Contribution</div><div class="amt">${money(contributions.totalMonthlyContribution)}<small>/mo</small></div><div class="sub">${contributions.totalAnnualContribution != null ? `${money(contributions.totalAnnualContribution)} / year` : ""}</div></div>
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
      <div class="row total"><span class="l">Total monthly amount payable</span><span class="r">${money(contributions.totalMonthlyContribution)} ${contributions.totalAnnualContribution != null ? `<small>\xB7 ${money(contributions.totalAnnualContribution)}/yr</small>` : ""}</span></div>
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
        const clientName = data && data.client && data.client.fullName;
        const card = renderQuotationCard(data, "client", agentReview);
        return documentShell(`Medical Card Quotation \u2014 ${clientName || "Client"}`, card);
      }
      module.exports = { renderAgentReviewHtml: renderAgentReviewHtml2, renderClientQuotationHtml: renderClientQuotationHtml2 };
    }
  });

  // browser-tool/app.js
  var { extractPagesFromPdf } = require_pdfTextSource_browser();
  var { parseQuotation } = require_parser();
  var { validateQuotation } = require_validate();
  var { renderAgentReviewHtml, renderClientQuotationHtml } = require_renderQuotation();
  var { primaryValue } = require_formatters();
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
    return warnings.filter((w) => w.field === path || w.field.startsWith(path + "."));
  }
  function errorsForPath(errors, path) {
    return errors.filter((e) => e.field === path || e.field.startsWith(path + "."));
  }
  var state = {
    stage: "upload",
    // upload | parsing | review | error
    fileName: null,
    data: null,
    warnings: [],
    errors: [],
    reviewAcknowledged: false,
    quotationNumber: "",
    validUntilIso: ""
  };
  var el = {
    uploadStage: document.getElementById("stage-upload"),
    reviewStage: document.getElementById("stage-review"),
    fileInput: document.getElementById("file-input"),
    dropZone: document.getElementById("drop-zone"),
    uploadStatus: document.getElementById("upload-status"),
    reviewSummary: document.getElementById("review-summary"),
    reviewForm: document.getElementById("review-form"),
    benefitItemsTable: document.getElementById("benefit-items-table"),
    optionsTable: document.getElementById("options-table"),
    revalidateBtn: document.getElementById("revalidate-btn"),
    ackCheckbox: document.getElementById("ack-checkbox"),
    quotationNumberInput: document.getElementById("quotation-number-input"),
    validUntilInput: document.getElementById("valid-until-input"),
    generateBtn: document.getElementById("generate-btn"),
    startOverBtn: document.getElementById("start-over-btn"),
    downloadSection: document.getElementById("download-section"),
    downloadBtn: document.getElementById("download-btn"),
    previewFrame: document.getElementById("preview-frame")
  };
  function showStage(stage) {
    state.stage = stage;
    el.uploadStage.hidden = stage !== "upload";
    el.reviewStage.hidden = stage !== "review";
  }
  async function handleFile(file) {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      el.uploadStatus.textContent = "Please choose a PDF file.";
      return;
    }
    state.fileName = file.name;
    el.uploadStatus.textContent = `Reading ${file.name}...`;
    try {
      const buffer = await file.arrayBuffer();
      el.uploadStatus.textContent = "Extracting text from PDF (this never leaves your browser)...";
      const pages = await extractPagesFromPdf(new Uint8Array(buffer));
      el.uploadStatus.textContent = "Parsing quotation data...";
      const result = parseQuotation(pages, { sourceFileName: file.name, validityDays: 14 });
      applyKnownMergedBenefitValues(result.data);
      state.data = result.data;
      state.warnings = result.warnings;
      state.errors = result.errors;
      state.reviewAcknowledged = false;
      renderReview();
      showStage("review");
    } catch (err) {
      el.uploadStatus.textContent = `Could not read this PDF: ${err.message}. Try the agent review screen won't be shown - please check the file and try again.`;
      console.error(err);
    }
  }
  el.fileInput.addEventListener("change", (e) => handleFile(e.target.files[0]));
  el.dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    el.dropZone.classList.add("drag-over");
  });
  el.dropZone.addEventListener("dragleave", () => el.dropZone.classList.remove("drag-over"));
  el.dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    el.dropZone.classList.remove("drag-over");
    handleFile(e.dataTransfer.files[0]);
  });
  function renderReview() {
    renderSummary();
    renderForm();
    renderBenefitItemsTable();
    renderOptionsTable();
    updateGateState();
  }
  function renderSummary() {
    const { errors, warnings } = state;
    const parts = [];
    if (errors.length) {
      parts.push(`<div class="banner banner-error"><b>${errors.length} required field(s) still need attention.</b> The client quotation cannot be generated until these are fixed below.</div>`);
    } else {
      parts.push(`<div class="banner banner-ok">All required fields are present.</div>`);
    }
    if (warnings.length) {
      parts.push(`<div class="banner banner-warn"><b>${warnings.length} warning(s).</b> Review the flagged fields below - none of this is shown to the client, but you should verify it against the source PDF.</div>`);
    }
    el.reviewSummary.innerHTML = parts.join("");
  }
  function fieldRowHtml(field) {
    const value = getPath(state.data, field.path);
    const fieldWarnings = warningsForPath(state.warnings, field.path);
    const fieldErrors = errorsForPath(state.errors, field.path);
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
      <input type="${inputType}" data-path="${field.path}" value="${escapeHtml(String(displayValue))}" class="field-input">
      ${notesHtml}
    </label>`;
  }
  function renderForm() {
    const sections = [...new Set(EDITABLE_FIELDS.map((f) => f.section))];
    const html = sections.map((section) => {
      const fields = EDITABLE_FIELDS.filter((f) => f.section === section);
      return `<fieldset><legend>${escapeHtml(section)}</legend>${fields.map(fieldRowHtml).join("")}</fieldset>`;
    }).join("");
    el.reviewForm.innerHTML = html;
    el.reviewForm.querySelectorAll(".field-input").forEach((input) => {
      input.addEventListener("input", (e) => {
        const path = e.target.dataset.path;
        const field = EDITABLE_FIELDS.find((f) => f.path === path);
        const raw = e.target.value;
        const value = field.type === "number" ? raw === "" ? null : Number(raw) : raw === "" ? null : raw;
        setPath(state.data, path, value);
        state.reviewAcknowledged = false;
        updateGateState();
      });
    });
  }
  function renderBenefitItemsTable() {
    const items = state.data.benefits && state.data.benefits.benefitItems || [];
    const rows = items.map((item, i) => {
      const warn = state.warnings.find((w) => w.field === `benefits.benefitItems.${item.label}`);
      const note = item.prefilledFromKnownMergedCell ? "Pre-filled: this row shares a merged cell with an adjacent benefit in the source PDF. Value verified against the source document - please confirm before sending." : warn && warn.message;
      return `
      <tr class="${item.value == null ? "row-flagged" : ""}">
        <td>${escapeHtml(item.label)}</td>
        <td><input type="text" data-benefit-index="${i}" value="${escapeHtml(item.value || "")}" class="field-input"></td>
      </tr>
      ${note ? `<tr class="note-row"><td colspan="2" class="field-note field-note-warn">${escapeHtml(note)}</td></tr>` : ""}`;
    }).join("");
    el.benefitItemsTable.innerHTML = `<table><thead><tr><th>Benefit</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table>`;
    el.benefitItemsTable.querySelectorAll("[data-benefit-index]").forEach((input) => {
      input.addEventListener("input", (e) => {
        const idx = Number(e.target.dataset.benefitIndex);
        state.data.benefits.benefitItems[idx].value = e.target.value || null;
        state.data.benefits.benefitItems[idx].prefilledFromKnownMergedCell = false;
        state.reviewAcknowledged = false;
        updateGateState();
      });
    });
  }
  var OPTION_COLUMN_FIELDS = [
    ["productName", "Product name"],
    ["annualContribution", "Annual contribution (RM)"],
    ["coPaymentOption", "Co-payment option"],
    ["roomAndBoard", "Room & board"],
    ["annualLimitOption", "Annual limit"],
    ["lifetimeLimitOption", "Lifetime limit"],
    ["facilityType", "Facility type"]
  ];
  function renderOptionsTable() {
    const columns = state.data.options && state.data.options.columns || [];
    const head = `<tr><th></th>${columns.map((c) => `<th>${escapeHtml(c.optionLabel || "")}</th>`).join("")}</tr>`;
    const rows = OPTION_COLUMN_FIELDS.map(
      ([key, label]) => `
    <tr>
      <th>${escapeHtml(label)}</th>
      ${columns.map(
        (c, i) => `<td><input type="text" data-option-index="${i}" data-option-key="${key}" value="${escapeHtml(c[key] == null ? "" : String(c[key]))}" class="field-input"></td>`
      ).join("")}
    </tr>`
    ).join("");
    el.optionsTable.innerHTML = `<table><thead>${head}</thead><tbody>${rows}</tbody></table>`;
    el.optionsTable.querySelectorAll("[data-option-index]").forEach((input) => {
      input.addEventListener("input", (e) => {
        const idx = Number(e.target.dataset.optionIndex);
        const key = e.target.dataset.optionKey;
        const raw = e.target.value;
        state.data.options.columns[idx][key] = key === "annualContribution" ? raw === "" ? null : Number(raw) : raw || null;
        state.reviewAcknowledged = false;
        updateGateState();
      });
    });
  }
  function revalidate() {
    const { warnings, errors } = validateQuotation(state.data);
    state.warnings = warnings;
    state.errors = errors;
    state.reviewAcknowledged = false;
    renderReview();
  }
  el.revalidateBtn.addEventListener("click", revalidate);
  function updateGateState() {
    const canAcknowledge = state.errors.length === 0;
    el.ackCheckbox.disabled = !canAcknowledge;
    if (!canAcknowledge) {
      el.ackCheckbox.checked = false;
      state.reviewAcknowledged = false;
    }
    el.generateBtn.disabled = !(canAcknowledge && el.ackCheckbox.checked);
  }
  el.ackCheckbox.addEventListener("change", (e) => {
    state.reviewAcknowledged = e.target.checked;
    updateGateState();
  });
  el.generateBtn.addEventListener("click", () => {
    const parseResult = { data: state.data, warnings: state.warnings, errors: state.errors };
    const agentReview = {
      acknowledged: state.reviewAcknowledged,
      quotationNumber: el.quotationNumberInput.value.trim() || null,
      validUntilIso: el.validUntilInput.value || null
    };
    const html = renderClientQuotationHtml(parseResult, agentReview);
    el.previewFrame.srcdoc = html;
    el.downloadSection.hidden = false;
    el.downloadBtn.onclick = () => downloadHtml(html);
  });
  function downloadHtml(html) {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeName = (state.data.client.fullName || "quotation").replace(/[^a-z0-9]+/gi, "_");
    a.href = url;
    a.download = `${safeName}_quotation.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  el.startOverBtn.addEventListener("click", () => {
    state.stage = "upload";
    state.data = null;
    state.warnings = [];
    state.errors = [];
    state.reviewAcknowledged = false;
    el.fileInput.value = "";
    el.downloadSection.hidden = true;
    el.uploadStatus.textContent = "";
    showStage("upload");
  });
  function escapeHtml(value) {
    if (value == null) return "";
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
})();
