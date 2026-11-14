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
          const lines = (pageText || "").replace(/\f/g, "\n").split("\n");
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

  // parser/classifyDocument.js
  var require_classifyDocument = __commonJS({
    "parser/classifyDocument.js"(exports, module) {
      "use strict";
      var SCAN_PAGE_COUNT = 3;
      var PRODUCT_SIGNATURES = [
        {
          product: "anugerahmax",
          productPattern: /PruBSN\s+AnugerahMax/i,
          riderPattern: /Medic\s+TotalCare/i
        },
        {
          product: "asas360",
          productPattern: /PruBSN\s+Asas360/i,
          riderPattern: /Health360/i
        }
      ];
      function classifyDocument(doc) {
        const scanText = (doc.pages || []).slice(0, SCAN_PAGE_COUNT).join("\n");
        for (const sig of PRODUCT_SIGNATURES) {
          const hasProduct = sig.productPattern.test(scanText);
          const hasRider = sig.riderPattern.test(scanText);
          if (hasProduct && hasRider) {
            return { product: sig.product, confidence: "high" };
          }
        }
        for (const sig of PRODUCT_SIGNATURES) {
          if (sig.productPattern.test(scanText) || sig.riderPattern.test(scanText)) {
            return { product: null, confidence: "low" };
          }
        }
        return { product: null, confidence: "none" };
      }
      module.exports = { classifyDocument };
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

  // parser/extractors/anugerahmax.js
  var require_anugerahmax = __commonJS({
    "parser/extractors/anugerahmax.js"(exports, module) {
      "use strict";
      var { extractMetadata } = require_extractMetadata();
      var { extractClient } = require_extractClient();
      var { extractAgent } = require_extractAgent();
      var { extractPlan } = require_extractPlan();
      var { extractContributions } = require_extractContributions();
      var { extractBenefits } = require_extractBenefits();
      var { extractOptions } = require_extractOptions();
      var { extractProjection } = require_extractProjection();
      function safeExtract(sectionName, fn, errors) {
        try {
          return fn();
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
      function extractAnugerahMax(doc, options) {
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
        return { data, warnings, errors };
      }
      module.exports = { extractAnugerahMax };
    }
  });

  // parser/extractors/asas360.js
  var require_asas360 = __commonJS({
    "parser/extractors/asas360.js"(exports, module) {
      "use strict";
      var {
        findAnchorIndexInDoc,
        getSectionLines,
        getValueAfterColon,
        parseCurrency,
        parseIntSafe,
        splitLetteredList,
        splitTwoColumnByHeader,
        splitIntoClauses
      } = require_lineUtils();
      var { extractMetadata } = require_extractMetadata();
      var { extractAgent } = require_extractAgent();
      function twoColumnValue(line, label) {
        if (!line) return { left: null, right: null };
        const idx = line.indexOf(label);
        if (idx === -1) return { left: null, right: null };
        const afterLabel = line.slice(idx + label.length);
        const firstColon = afterLabel.indexOf(":");
        if (firstColon === -1) return { left: null, right: null };
        const rest = afterLabel.slice(firstColon + 1);
        const secondColon = rest.indexOf(":");
        if (secondColon === -1) return { left: rest.trim() || null, right: null };
        return { left: rest.slice(0, secondColon).trim() || null, right: rest.slice(secondColon + 1).trim() || null };
      }
      function extractClientSection(doc, warnings) {
        const section = getSectionLines(doc, /Person to be Covered/i, /Plan Type\s*:/i);
        if (section.startIndex === -1) {
          warnings.push({ field: "client", message: 'Could not locate the "Person to be Covered" details table.' });
          return { primary: {}, parent: null };
        }
        const fieldFrom = (label) => {
          const line = section.lines.find((l) => l.includes(label));
          return twoColumnValue(line, label);
        };
        const name = fieldFrom("Name");
        const sex = fieldFrom("Sex");
        const smoker = fieldFrom("Smoker");
        const occupation = fieldFrom("Occupation");
        const age = fieldFrom("Age");
        const dob = fieldFrom("Date of birth");
        const businessProposalLine = section.lines.find((l) => l.includes("Business Proposal"));
        const takafulPurposeLine = section.lines.find((l) => l.includes("Takaful Plan Purpose"));
        const primary = {
          fullName: name.left,
          gender: sex.left,
          smokerStatus: smoker.left ? /^no$/i.test(smoker.left) ? "Non-Smoker" : /^yes$/i.test(smoker.left) ? "Smoker" : smoker.left : null,
          occupationClass: occupation.left,
          ageNextBirthday: parseIntSafe(age.left),
          dateOfBirth: dob.left || null,
          businessProposal: businessProposalLine ? /^yes$/i.test(getValueAfterColon(businessProposalLine, "Business Proposal") || "") : null,
          takafulPlanPurpose: takafulPurposeLine ? getValueAfterColon(takafulPurposeLine, "Takaful Plan Purpose") : null
        };
        [["fullName", name.left], ["gender", sex.left], ["ageNextBirthday", age.left]].forEach(([key, value]) => {
          if (!value) warnings.push({ field: `client.${key}`, message: `Could not locate a value for client.${key} in the Person to be Covered column.` });
        });
        const hasParentColumn = Boolean(name.right);
        const parent = hasParentColumn ? {
          fullName: name.right,
          gender: sex.right,
          smokerStatus: smoker.right ? /^no$/i.test(smoker.right) ? "Non-Smoker" : /^yes$/i.test(smoker.right) ? "Smoker" : smoker.right : null,
          occupationClass: occupation.right,
          ageNextBirthday: parseIntSafe(age.right)
        } : null;
        return { primary, parent };
      }
      function extractHealth360RowFacts(doc, warnings) {
        const rowIdx = findAnchorIndexInDoc(doc, /R&B:\s*RM/i);
        if (rowIdx === -1) {
          warnings.push({ field: "medicalRider", message: 'Could not locate the "R&B: RM..." row in the quotation benefits table.' });
          return { roomAndBoardValue: null, smartValuePoint: null, coPaymentOption: null };
        }
        const windowLines = doc.allLines.slice(rowIdx, rowIdx + 3).map((l) => l.text);
        const windowText = windowLines.join(" ");
        const rbMatch = windowText.match(/R&B:\s*RM\s*([\d,]+)/i);
        const svpMatch = windowText.match(/Smart Value Point:\s*RM\s*([\d,]+)/i);
        const coPayMatch = windowText.match(/Co-payment:\s*([A-Za-z]+\s*RM?[\d,]*)/i);
        if (!rbMatch) warnings.push({ field: "medicalRider.roomAndBoard", message: 'Could not locate the "R&B: RM..." figure near the Health360 row.' });
        if (!svpMatch) warnings.push({ field: "medicalRider.smartValuePoint", message: 'Could not locate the "Smart Value Point: RM..." figure near the Health360 row.' });
        if (!coPayMatch) warnings.push({ field: "medicalRider.coPaymentOption", message: 'Could not locate the "Co-payment: ..." option near the Health360 row.' });
        return {
          roomAndBoardValue: rbMatch ? `RM${rbMatch[1]} per day` : null,
          smartValuePoint: svpMatch ? parseCurrency(svpMatch[1]) : null,
          coPaymentOption: coPayMatch ? coPayMatch[1].trim() : null
        };
      }
      function extractPlanTier(doc, warnings) {
        const idx = findAnchorIndexInDoc(doc, /Health360\s+Plan\s+(\d+)/i);
        if (idx === -1) {
          warnings.push({ field: "medicalRider.planTier", message: 'Could not locate "Health360 Plan N" in the Product Options Table.' });
          return null;
        }
        const m = doc.allLines[idx].text.match(/Health360\s+Plan\s+(\d+)/i);
        return m ? m[1] : null;
      }
      function extractCoverageToAge(doc, warnings) {
        const idx = findAnchorIndexInDoc(doc, /^Certificate Term\s*:/i);
        if (idx === -1) {
          warnings.push({ field: "medicalRider.coverageToAge", message: 'Could not locate "Certificate Term".' });
          return null;
        }
        const m = doc.allLines[idx].text.match(/age\s+(\d+)\s+next birthday/i);
        if (!m) {
          warnings.push({ field: "medicalRider.coverageToAge", message: 'Could not parse an age out of the "Certificate Term" line.' });
          return null;
        }
        return parseInt(m[1], 10);
      }
      function extractMonthlyAndAnnual(doc, warnings) {
        const monthlyIdx = findAnchorIndexInDoc(doc, /^Monthly Total Amount Payable\s*:/i);
        const annualIdx = findAnchorIndexInDoc(doc, /^Total Annual Contribution\s*:/i);
        const monthly = monthlyIdx !== -1 ? parseCurrency((doc.allLines[monthlyIdx].text.match(/RM\s*([\d,]+(?:\.\d+)?)/) || [])[1]) : null;
        const annual = annualIdx !== -1 ? parseCurrency((doc.allLines[annualIdx].text.match(/RM\s*([\d,]+(?:\.\d+)?)/) || [])[1]) : null;
        if (monthly == null) warnings.push({ field: "monthlyTotalAmountPayable", message: 'Could not locate "Monthly Total Amount Payable".' });
        if (annual == null) warnings.push({ field: "totalAnnualContribution", message: 'Could not locate "Total Annual Contribution".' });
        return { monthly, annual };
      }
      var BENEFIT_LABEL_DICTIONARY = [
        { section: "Room & Board Benefits", label: "Hospital Daily Room & Board" },
        { section: "Hospital & Surgical Benefits", label: "Intensive Care Unit (ICU) / Cardiac Care Unit (CCU)" },
        { section: "Hospital & Surgical Benefits", label: "In-hospital & Related Services" },
        { section: "Hospital & Surgical Benefits", label: "Pre-hospitalisation Treatment" },
        { section: "Hospital & Surgical Benefits", label: "Post-hospitalisation Treatment" },
        { section: "Hospital & Surgical Benefits", label: "Major Organ Transplant" },
        { section: "Outpatient Treatment Benefits", label: "Outpatient Cancer Treatment" },
        { section: "Outpatient Treatment Benefits", label: "Outpatient Kidney Dialysis Treatment" },
        { section: "Outpatient Treatment Benefits", label: "Second Medical Opinion" },
        { section: "Outpatient Treatment Benefits", label: "Mental Care Treatment" },
        { section: "Outpatient Treatment Benefits", label: "Home Nursing Care" },
        { section: "Outpatient Treatment Benefits", label: "Intraocular Lens" },
        { section: "Outpatient Treatment Benefits", label: "Day Surgery / Day Care Procedure" },
        { section: "Outpatient Treatment Benefits", label: "Outpatient Dengue and Infectious Disease Treatment" },
        { section: "Outpatient Treatment Benefits", label: "Outpatient Top Child Illnesses Treatment" },
        { section: "Outpatient Treatment Benefits", label: "Outpatient Parents Allowance" },
        { section: "Other Benefits", label: "Daily Cash Allowance for Malaysian Government Hospital" },
        { section: "Other Benefits", label: "Emergency Outpatient Treatment for Accidental Injury" },
        { section: "Other Benefits", label: "Worldwide Emergency Medical Assistance" },
        { section: "Other Benefits", label: "Health Retirement" }
      ];
      var SECTION_HEADER_LINES = new Set(BENEFIT_LABEL_DICTIONARY.map((e) => e.section));
      var HEALTH360_NOISE_LINE_PATTERNS = [
        /^Presented by\s*:/i,
        /^Date\s*:/i,
        /^Version\s*:/i,
        /^Page\s+\d+\s+of\s+\d+/i,
        /^Quotation for\s+/i,
        /^PruBSN\s+Asas360\s*$/i
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
      function valueForBenefitRow(blockLines, label) {
        const valueParts = [];
        const noteParts = [];
        blockLines.forEach((raw) => {
          let line = raw.trim();
          if (!line || SECTION_HEADER_LINES.has(line)) return;
          const idx = line.indexOf(label);
          if (idx !== -1) {
            line = line.slice(idx + label.length).replace(/^,?\s*including:?\s*/i, "").replace(/^[,:]\s*/, "").trim();
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
          if (text == null) return;
          if (/^\(/.test(text)) {
            noteParts.push(text);
          } else {
            valueParts.push(text);
          }
        });
        return {
          value: valueParts.length ? valueParts.join(" ").replace(/\s+/g, " ").replace(/,\s*$/, "").trim() : null,
          note: noteParts.length ? noteParts.join(" ").replace(/\s+/g, " ").trim() : null
        };
      }
      function extractBenefitItems(doc, warnings) {
        const section = getSectionLines(doc, /^Table of Benefits\s*$/i, /^i\s+Second Medical Opinion/i);
        if (section.startIndex === -1) {
          warnings.push({ field: "medicalRider.benefitItems", message: `Could not locate Health360's "Table of Benefits".` });
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
        const sectionsSeen = new Set(items.map((it) => it.section));
        sectionsSeen.forEach((sectionName) => {
          const rowsInSection = items.filter((it) => it.section === sectionName);
          const bareAsCharged = rowsInSection.filter((it) => it.value === "As Charged");
          if (bareAsCharged.length !== 1) return;
          rowsInSection.forEach((it) => {
            if (it.value == null) {
              it.value = "As Charged";
              it.inheritedValue = true;
            }
          });
        });
        const cancerItem = items.find((it) => it.label === "Outpatient Cancer Treatment");
        const dialysisItem = items.find((it) => it.label === "Outpatient Kidney Dialysis Treatment");
        if (cancerItem && dialysisItem && cancerItem.value && dialysisItem.value && cancerItem.value !== dialysisItem.value) {
          const combined = `${cancerItem.value}, ${dialysisItem.value}`;
          cancerItem.value = combined;
          dialysisItem.value = combined;
        }
        items.forEach((it) => {
          const finalValue = [it.value, it.note].filter(Boolean).join(" ") || null;
          if (finalValue == null) {
            warnings.push({
              field: `medicalRider.benefitItems.${it.label}`,
              message: `No explicit value found for "${it.label}" - this may be a merged table cell shared with an adjacent row; verify against the source PDF.`
            });
          } else if (it.inheritedValue) {
            warnings.push({
              field: `medicalRider.benefitItems.${it.label}`,
              message: `"${it.label}" has no value printed on its own row - inherited "As Charged" from the single matching value shared across its "${it.section}" section (a merged table cell); verify against the source PDF.`
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
          warnings.push({ field: "medicalRider.waitingPeriods", message: 'Could not locate the "Waiting Period:" section.' });
          return [];
        }
        const periods = [];
        section.lines.forEach((raw) => {
          const line = raw.trim();
          const m = line.match(/(\d+)\s+days?\s+after\s+(?:the\s+)?(?:effective date of the rider|effective date of the certificate)?\s*(?:or\s+(?:the\s+)?date it is revived)?\s*(?:for|,?\s*for)?\s*(.+)/i);
          if (m) {
            const description = m[2].replace(/,?\s*and\s*$/i, "").replace(/[,.]$/, "").trim();
            periods.push({ days: parseInt(m[1], 10), description });
          }
        });
        if (!periods.length) {
          warnings.push({ field: "medicalRider.waitingPeriods", message: "Waiting Period section found but no {days, description} rows could be parsed." });
        }
        return periods;
      }
      function extractMedicalExclusionsDigest(doc, warnings) {
        const { fragments } = splitTwoColumnByHeader(
          doc,
          /What is covered\?.*What is not covered\?/i,
          "What is not covered?",
          /This is not a complete list/i
        );
        if (!fragments.length) {
          warnings.push({ field: "medicalRider.medicalExclusions", message: 'Could not reconstruct the "What is not covered?" column.' });
          return [];
        }
        const clauses = splitIntoClauses(fragments.join(" "));
        if (!clauses.length) {
          warnings.push({ field: "medicalRider.medicalExclusions", message: "Reconstructed text but could not split it into distinct items; returning as one block." });
          return [fragments.join(" ")];
        }
        return clauses;
      }
      function extractExclusions(doc, warnings) {
        const section = getSectionLines(doc, /^Exclusions:\s*$/i, /^Other Certificate Conditions/i);
        if (section.startIndex === -1) {
          warnings.push({ field: "medicalRider.fullExclusionsList", message: 'Could not locate the medical "Exclusions:" list.' });
          return [];
        }
        const lines = section.lines.filter((raw) => !isNoiseLine(raw.trim()));
        const items = splitLetteredList(lines);
        const last = items[items.length - 1];
        if (last) {
          last.text = last.text.replace(/\s*This list is non-exhaustive\..*$/i, "").trim();
        }
        return items;
      }
      function deriveLifetimeLimitDisplay(smartValuePoint) {
        return smartValuePoint != null ? "No Limit, subject to SVP" : null;
      }
      function extractBasicPlanFacts(doc, warnings) {
        const idx = findAnchorIndexInDoc(doc, /PruBSN\s+Asas360\s*\(Basic\)/i);
        if (idx === -1) {
          warnings.push({ field: "protection.basicPlan", message: 'Could not locate the "PruBSN Asas360 (Basic)" row in the quotation table.' });
          return { basicPlanName: null, basicPlanTerm: null, basicSumCovered: null };
        }
        const line = doc.allLines[idx].text;
        const m = line.match(/\(Basic\)\s*(\d+)\s+([\d,]+)/i);
        if (!m) {
          warnings.push({ field: "protection.basicPlan", message: 'Located the "PruBSN Asas360 (Basic)" row but could not parse its term/sum covered figures.' });
          return { basicPlanName: "PruBSN Asas360 (Basic)", basicPlanTerm: null, basicSumCovered: null };
        }
        return {
          basicPlanName: "PruBSN Asas360 (Basic)",
          basicPlanTerm: parseInt(m[1], 10),
          basicSumCovered: parseCurrency(m[2])
        };
      }
      function extractCashValueSchedule(doc, warnings) {
        const section = getSectionLines(doc, /^Table 1:\s*PruBSN Asas360/i, /^Table 2:\s*Rider/i);
        if (section.startIndex === -1) {
          warnings.push({ field: "protection.cashValue.schedule", message: 'Could not locate "Table 1: PruBSN Asas360".' });
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
            deathBenefitScenarioY: parseCurrency(m[14])
          });
        });
        if (!rows.length) {
          warnings.push({ field: "protection.cashValue.schedule", message: '"Table 1" was located but no year rows could be parsed - verify against the source PDF.' });
        }
        return rows;
      }
      function extractTabarruDeductionSchedule(doc, warnings) {
        const section = getSectionLines(doc, /^Table 3:\s*Breakdown of Tabarru/i, /^Appendix:\s*Projection by Accounts/i);
        if (section.startIndex === -1) {
          warnings.push({ field: "medical.tabarruDeductionSchedule", message: 'Could not locate "Table 3: Breakdown of Tabarru` Deductions".' });
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
            crisisProtectorTabarru: parseCurrency(m[5])
          });
        });
        if (!rows.length) {
          warnings.push({ field: "medical.tabarruDeductionSchedule", message: '"Table 3" was located but no year rows could be parsed - verify against the source PDF.' });
        }
        return rows;
      }
      function extractAsas360(doc, options) {
        const warnings = [];
        const errors = [];
        const metadata = extractMetadata(doc, options);
        const { _warnings: metaWarnings, ...metadataRest } = metadata;
        warnings.push(...metaWarnings || []);
        const agent = extractAgent(doc);
        const { _warnings: agentWarnings, ...agentRest } = agent;
        warnings.push(...agentWarnings || []);
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
            riderName: "Health360",
            planTier,
            coverageToAge,
            contribution: null,
            // see toMedicalJson.fromAsas360()'s own warning - not printed as a standalone figure for this product
            benefitItems: medicalBenefitItems,
            medicalExclusions,
            fullExclusionsList,
            waitingPeriods,
            smartValuePoint,
            lifetimeLimit: deriveLifetimeLimitDisplay(smartValuePoint),
            coPaymentOption,
            tabarruDeductionSchedule
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
            deathBenefit: basicSumCovered != null ? { amount: basicSumCovered, description: "Basic Sum Covered plus the cash value of the certificate" } : null,
            tpdBenefit: basicSumCovered != null ? { amount: basicSumCovered, description: "Basic Sum Covered, payable before the certificate anniversary of the Covered Person's age 70 next birthday" } : null,
            cashValueSchedule
          },
          monthlyTotalAmountPayable: monthly,
          totalAnnualContribution: annual
        };
        return { data, warnings, errors };
      }
      module.exports = { extractAsas360 };
    }
  });

  // parser/normalize/toMedicalJson.js
  var require_toMedicalJson = __commonJS({
    "parser/normalize/toMedicalJson.js"(exports, module) {
      "use strict";
      function bareTierNumber(planTier) {
        if (!planTier) return null;
        return String(planTier).replace(/^Plan\s+/i, "");
      }
      function extractRmAmount(value) {
        if (!value) return null;
        const m = String(value).match(/RM\s*([\d,]+(?:\.\d+)?)/);
        return m ? Number(m[1].replace(/,/g, "")) : null;
      }
      function extractMaxDays(value) {
        if (!value) return null;
        const m = String(value).match(/maximum\s+(\d+)\s+days/i);
        return m ? Number(m[1]) : null;
      }
      function findBenefit(benefitItems, label) {
        return (benefitItems || []).find((b) => b.label === label) || null;
      }
      function fromAnugerahMax(rawData, warnings = []) {
        const { metadata = {}, plan = {}, contributions = {}, benefits = {} } = rawData || {};
        const benefitItems = benefits.benefitItems || [];
        const roomBoardItem = findBenefit(benefitItems, "Hospital Daily Room and Board");
        return {
          productName: metadata.productName || null,
          riderName: plan.medicalRiderName || null,
          planName: [plan.medicalRiderName, plan.medicalPlanTier].filter(Boolean).join(" ") || null,
          planTier: bareTierNumber(plan.medicalPlanTier),
          coverageModel: "ANNUAL_LIMIT",
          annualLimit: benefits.annualLimit || null,
          lifetimeFundAmount: null,
          costSharingAfterExhaustion: null,
          lifetimeLimit: benefits.lifetimeLimit || null,
          roomAndBoard: roomBoardItem ? { amount: extractRmAmount(roomBoardItem.value), maxDaysPerYear: extractMaxDays(roomBoardItem.value) } : null,
          coPayment: plan.coPaymentOption || null,
          coverageToAge: plan.coverageToAge != null ? plan.coverageToAge : null,
          contribution: contributions.medicTotalCareContribution != null ? contributions.medicTotalCareContribution : null,
          benefitItems,
          medicalExclusions: benefits.medicalExclusions || [],
          fullExclusionsList: benefits.fullExclusionsList || [],
          waitingPeriods: benefits.waitingPeriods || []
        };
      }
      function fromAsas360(rawData, warnings = []) {
        const { metadata = {}, medicalRider = {} } = rawData || {};
        const benefitItems = medicalRider.benefitItems || [];
        const roomBoardItem = findBenefit(benefitItems, "Hospital Daily Room & Board");
        if (medicalRider.contribution == null) {
          warnings.push({
            field: "medical.contribution",
            message: `PruBSN Asas360 quotations do not print a standalone monthly contribution figure for the Health360 rider - it is bundled into the combined "Protection Contribution + Allocator Contribution" line. Not derived/estimated - see Table 3's Tabarru' deduction schedule (medical.tabarruDeductionSchedule) for the real, printed per-year Health360-specific cost instead.`
          });
        }
        return {
          productName: metadata.productName || null,
          riderName: medicalRider.riderName || null,
          planName: [medicalRider.riderName, medicalRider.planTier ? `Plan ${medicalRider.planTier}` : null].filter(Boolean).join(" ") || null,
          planTier: medicalRider.planTier || null,
          coverageModel: "LIFETIME_MEDICAL_FUND",
          annualLimit: null,
          lifetimeFundAmount: medicalRider.smartValuePoint != null ? medicalRider.smartValuePoint : null,
          costSharingAfterExhaustion: medicalRider.smartValuePoint != null ? { insurerPct: 80, clientPct: 20 } : null,
          lifetimeLimit: medicalRider.lifetimeLimit || null,
          roomAndBoard: roomBoardItem ? { amount: extractRmAmount(roomBoardItem.value), maxDaysPerYear: extractMaxDays(roomBoardItem.value) } : null,
          coPayment: medicalRider.coPaymentOption || null,
          coverageToAge: medicalRider.coverageToAge != null ? medicalRider.coverageToAge : null,
          contribution: medicalRider.contribution != null ? medicalRider.contribution : null,
          tabarruDeductionSchedule: medicalRider.tabarruDeductionSchedule || null,
          benefitItems,
          medicalExclusions: medicalRider.medicalExclusions || [],
          fullExclusionsList: medicalRider.fullExclusionsList || [],
          waitingPeriods: medicalRider.waitingPeriods || []
        };
      }
      module.exports = { fromAnugerahMax, fromAsas360 };
    }
  });

  // parser/normalize/toProtectionJson.js
  var require_toProtectionJson = __commonJS({
    "parser/normalize/toProtectionJson.js"(exports, module) {
      "use strict";
      function fromAnugerahMax(rawData) {
        const { plan = {}, contributions = {} } = rawData || {};
        const hasDeathTPD = contributions.guaranteedDeathTPDBenefit != null;
        const deathTpd = hasDeathTPD ? { amount: contributions.guaranteedDeathTPDBenefit, description: "Guaranteed Death / Total Permanent Disability Benefit" } : null;
        const hasCashValue = contributions.nonGuaranteedCashValueScenarioX != null || contributions.nonGuaranteedCashValueScenarioY != null;
        return {
          basicPlanName: plan.basicPlanName || null,
          basicPlanTerm: plan.basicPlanTerm != null ? plan.basicPlanTerm : null,
          basicSumCovered: plan.basicSumCovered != null ? plan.basicSumCovered : null,
          deathBenefit: deathTpd,
          tpdBenefit: deathTpd,
          cashValue: hasCashValue ? {
            scenarioX: contributions.nonGuaranteedCashValueScenarioX != null ? contributions.nonGuaranteedCashValueScenarioX : null,
            scenarioY: contributions.nonGuaranteedCashValueScenarioY != null ? contributions.nonGuaranteedCashValueScenarioY : null,
            // AnugerahMax's PDF states a single non-guaranteed cash value
            // figure per scenario, not a year-by-year schedule - never
            // fabricated here.
            schedule: null
          } : null
        };
      }
      function fromAsas360(rawData) {
        const { basicPlan = {} } = rawData || {};
        const hasSchedule = Array.isArray(basicPlan.cashValueSchedule) && basicPlan.cashValueSchedule.length > 0;
        return {
          basicPlanName: basicPlan.basicPlanName || null,
          basicPlanTerm: basicPlan.basicPlanTerm != null ? basicPlan.basicPlanTerm : null,
          basicSumCovered: basicPlan.basicSumCovered != null ? basicPlan.basicSumCovered : null,
          deathBenefit: basicPlan.deathBenefit || null,
          tpdBenefit: basicPlan.tpdBenefit || null,
          cashValue: hasSchedule ? {
            // Asas360's investment-linked structure never prints a single
            // "the" cash value - only a year-by-year schedule (Table 1) -
            // so scenarioX/Y stay null here rather than picking one
            // arbitrary year's figure and presenting it as definitive.
            scenarioX: null,
            scenarioY: null,
            schedule: basicPlan.cashValueSchedule
          } : null
        };
      }
      module.exports = { fromAnugerahMax, fromAsas360 };
    }
  });

  // parser/coverageStrategy.js
  var require_coverageStrategy = __commonJS({
    "parser/coverageStrategy.js"(exports, module) {
      "use strict";
      var STRATEGIES = {
        ANNUAL_LIMIT: {
          coverageModel: "ANNUAL_LIMIT",
          explanation: "This medical card provides an annual medical limit that refreshes every policy year.",
          showsCriticalIllnessDoubling: true,
          showsLifetimeFundChart: false
        },
        LIFETIME_MEDICAL_FUND: {
          coverageModel: "LIFETIME_MEDICAL_FUND",
          explanation: "This medical card provides a lifetime medical fund. After the allocated medical fund has been exhausted, eligible claims continue under an 80% (PruBSN) / 20% (client) cost-sharing arrangement, subject to the policy terms.",
          showsCriticalIllnessDoubling: false,
          showsLifetimeFundChart: true
        }
      };
      function getCoverageStrategy(coverageModel) {
        return STRATEGIES[coverageModel] || null;
      }
      module.exports = { getCoverageStrategy, STRATEGIES };
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
          const empty = isEmpty(getPath2(data, path));
          console.log("[DIAGNOSTIC 5] Rule (AnugerahMax validateQuotation): %s -> %s", path, empty ? "FAIL" : "PASS");
          if (empty) {
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
      function validateQuotation(data) {
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
      module.exports = { validateQuotation, KNOWN_PLAN_TIER_ANNUAL_LIMITS, REQUIRED_FIELDS };
    }
  });

  // parser/validateMedical.js
  var require_validateMedical = __commonJS({
    "parser/validateMedical.js"(exports, module) {
      "use strict";
      var COMMON_REQUIRED_FIELDS = ["productName", "riderName", "planName", "coverageModel", "roomAndBoard", "coPayment", "coverageToAge"];
      var MODEL_REQUIRED_FIELDS = {
        ANNUAL_LIMIT: ["annualLimit"],
        LIFETIME_MEDICAL_FUND: ["lifetimeFundAmount", "costSharingAfterExhaustion"]
      };
      function getPath2(obj, path) {
        return path.split(".").reduce((acc, key) => acc == null ? void 0 : acc[key], obj);
      }
      function validateMedical(medical) {
        const warnings = [];
        const errors = [];
        if (!medical) {
          errors.push({ field: "medical", message: "No normalized medical data was produced for this quotation." });
          return { warnings, errors };
        }
        const requiredFields = [...COMMON_REQUIRED_FIELDS, ...MODEL_REQUIRED_FIELDS[medical.coverageModel] || []];
        for (const field of requiredFields) {
          const value = getPath2(medical, field);
          const fail = value == null;
          console.log("[DIAGNOSTIC 5] Rule (validateMedical): medical.%s -> %s", field, fail ? "FAIL" : "PASS");
          if (fail) {
            errors.push({ field: `medical.${field}`, message: `Required field "medical.${field}" is missing for coverage model "${medical.coverageModel}".` });
          }
        }
        if (!medical.coverageModel) {
          errors.push({ field: "medical.coverageModel", message: "Coverage model could not be determined - this quotation cannot be rendered." });
        } else if (!MODEL_REQUIRED_FIELDS[medical.coverageModel]) {
          errors.push({ field: "medical.coverageModel", message: `Unrecognised coverage model "${medical.coverageModel}".` });
        }
        if (!medical.benefitItems || !medical.benefitItems.length) {
          warnings.push({ field: "medical.benefitItems", message: "No benefit items were extracted for this medical rider." });
        }
        if (!medical.medicalExclusions || !medical.medicalExclusions.length) {
          warnings.push({ field: "medical.medicalExclusions", message: "No medical exclusions were extracted for this medical rider." });
        }
        return { warnings, errors };
      }
      module.exports = { validateMedical };
    }
  });

  // parser/validateProtection.js
  var require_validateProtection = __commonJS({
    "parser/validateProtection.js"(exports, module) {
      "use strict";
      function validateProtection(protection) {
        const warnings = [];
        const errors = [];
        if (!protection) {
          warnings.push({ field: "protection", message: "No normalized protection data was produced for this quotation." });
          return { warnings, errors };
        }
        const checks = [
          ["basicPlanName", protection.basicPlanName],
          ["basicSumCovered", protection.basicSumCovered],
          ["deathBenefit", protection.deathBenefit],
          ["tpdBenefit", protection.tpdBenefit]
        ];
        for (const [field, value] of checks) {
          const fail = value == null;
          console.log("[DIAGNOSTIC 5] Rule (validateProtection): protection.%s -> %s", field, fail ? "FAIL (warning)" : "PASS");
        }
        if (protection.basicPlanName == null) {
          warnings.push({ field: "protection.basicPlanName", message: "Could not determine the basic plan name." });
        }
        if (protection.basicSumCovered == null) {
          warnings.push({ field: "protection.basicSumCovered", message: "Could not determine the basic sum covered." });
        }
        if (protection.deathBenefit == null) {
          warnings.push({ field: "protection.deathBenefit", message: "Could not determine the Death Benefit." });
        }
        if (protection.tpdBenefit == null) {
          warnings.push({ field: "protection.tpdBenefit", message: "Could not determine the TPD Benefit." });
        }
        return { warnings, errors };
      }
      module.exports = { validateProtection };
    }
  });

  // parser/parseQuotation.js
  var require_parseQuotation = __commonJS({
    "parser/parseQuotation.js"(exports, module) {
      "use strict";
      var { buildDocument } = require_lineUtils();
      var { classifyDocument } = require_classifyDocument();
      var { extractAnugerahMax } = require_anugerahmax();
      var { extractAsas360 } = require_asas360();
      var { fromAnugerahMax, fromAsas360 } = require_toMedicalJson();
      var { fromAnugerahMax: protectionFromAnugerahMax, fromAsas360: protectionFromAsas360 } = require_toProtectionJson();
      var { getCoverageStrategy } = require_coverageStrategy();
      var { validateQuotation } = require_validate();
      var { validateMedical } = require_validateMedical();
      var { validateProtection } = require_validateProtection();
      var UNSUPPORTED_PRODUCT_MESSAGE = "Could not identify this Product Illustration as a supported product (PruBSN AnugerahMax or PruBSN Asas360).";
      function normalizeAndValidate2(data) {
        const isAsas360 = Boolean(data && data.medicalRider);
        const warnings = [];
        const errors = [];
        console.log("[DIAGNOSTIC 3] Validation profile: isAsas360=" + isAsas360 + " -> validateQuotation() " + (isAsas360 ? "SKIPPED" : "RAN") + ", validateMedical() runs always, validateProtection() runs always");
        if (!isAsas360) {
          const validation = validateQuotation(data);
          warnings.push(...validation.warnings);
          errors.push(...validation.errors);
        }
        const medicalWarnings = [];
        data.medical = isAsas360 ? fromAsas360(data, medicalWarnings) : fromAnugerahMax(data, medicalWarnings);
        warnings.push(...medicalWarnings);
        const medicalValidation = validateMedical(data.medical);
        warnings.push(...medicalValidation.warnings);
        errors.push(...medicalValidation.errors);
        const strategy = getCoverageStrategy(data.medical.coverageModel);
        if (strategy) data.medical.coverageExplanation = strategy.explanation;
        data.protection = isAsas360 ? protectionFromAsas360(data) : protectionFromAnugerahMax(data);
        const protectionValidation = validateProtection(data.protection);
        warnings.push(...protectionValidation.warnings);
        errors.push(...protectionValidation.errors);
        return { warnings, errors };
      }
      function parseQuotation2(pages, options = {}) {
        const doc = buildDocument(pages);
        const classification = classifyDocument(doc);
        console.log("[DIAGNOSTIC 1] classifyDocument() result:", JSON.stringify(classification), "| sourceFileName:", options.sourceFileName);
        if (!classification.product) {
          return {
            data: null,
            warnings: [],
            errors: [{ field: "metadata.product", message: UNSUPPORTED_PRODUCT_MESSAGE }]
          };
        }
        const isAsas360 = classification.product === "asas360";
        console.log("[DIAGNOSTIC] Extractor dispatch: %s", isAsas360 ? "extractAsas360() (parser/extractors/asas360.js)" : "extractAnugerahMax() (parser/extractors/anugerahmax.js)");
        const { data, warnings, errors } = isAsas360 ? extractAsas360(doc, options) : extractAnugerahMax(doc, options);
        const postExtraction = normalizeAndValidate2(data);
        warnings.push(...postExtraction.warnings);
        errors.push(...postExtraction.errors);
        console.log("[DIAGNOSTIC 2] Complete normalized data object:", JSON.stringify(data, null, 2));
        console.log("[DIAGNOSTIC 2] Complete normalized data.medical:", JSON.stringify(data.medical, null, 2));
        console.log("[DIAGNOSTIC 2] Complete normalized data.protection:", JSON.stringify(data.protection, null, 2));
        console.log("[DIAGNOSTIC 2] Full data keys present:", Object.keys(data));
        console.log("[DIAGNOSTIC 2] warnings:", JSON.stringify(warnings));
        console.log("[DIAGNOSTIC 2] errors:", JSON.stringify(errors));
        return { data, warnings, errors };
      }
      module.exports = { parseQuotation: parseQuotation2, normalizeAndValidate: normalizeAndValidate2 };
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
      var { parseQuotation: parseQuotation2, normalizeAndValidate: normalizeAndValidate2 } = require_parseQuotation();
      var { AGENTS, getAgentConfig } = require_agents();
      module.exports = { parseQuotation: parseQuotation2, normalizeAndValidate: normalizeAndValidate2, AGENTS, getAgentConfig };
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
        roomBoard: { default: "room-board/ward.jpg" },
        hospital: { default: "hospital/lobby.jpg" },
        accident: {},
        surgery: { default: "surgery/theatre.jpg" },
        recovery: { default: "recovery/ward.jpg" },
        financial: { default: "financial/cancer.jpg" },
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
      var BASE_PATH = "https://syakirbadry-tech.github.io/quotation-generator/browser-tool/";
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
      function moneyRMNoSpace(n) {
        const formatted = formatMoney(n);
        return formatted == null ? null : `RM${formatted}`;
      }
      function maxDaysNote(days) {
        return days != null ? `(maximum ${days} days per year)` : null;
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
        },
        // Verified directly from the real Asas360 sample: p.1's cover page
        // carries the same PIDM/TIPS protection notice AnugerahMax's does, and
        // p.30's "Appendix: Other Certificate Benefits and Options" describes
        // the same Extension of Certificate Term feature (coverage continues to
        // age 100 next birthday, cash value permitting) - not assumed from
        // AnugerahMax, independently confirmed in Asas360's own document.
        "PruBSN Asas360": {
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
        var _a;
        const { metadata = {}, client = {}, agent = {}, plan = {}, contributions = {}, medical = {}, protection = {}, projection = {} } = data || {};
        const agentConfig = getAgentConfig(agent.agentCode) || {};
        const benefitItems = medical.benefitItems || [];
        const monthlyValue = (_a = resolveMonthlyTotalPayable(contributions)) != null ? _a : data && data.monthlyTotalAmountPayable != null ? data.monthlyTotalAmountPayable : data && data.totalAnnualContribution != null ? Math.round(data.totalAnnualContribution / 12 * 100) / 100 : null;
        const monthlyFormatted = monthlyValue != null ? `RM ${formatMoneyFixed2(monthlyValue)}` : null;
        const monthlyCompact = monthlyValue != null ? moneyRM(monthlyValue) : null;
        const roomAndBoard = medical.roomAndBoard || {};
        const roomBoardAmount = moneyRMNoSpace(roomAndBoard.amount);
        const roomBoardDayNote = maxDaysNote(roomAndBoard.maxDaysPerYear);
        const boost = criticalIllnessBoost(benefitItems);
        const purposeRaw = client.takafulPlanPurpose;
        const purpose = purposeRaw ? /non-business/i.test(purposeRaw) ? "Personal" : /business/i.test(purposeRaw) ? "Business" : purposeRaw : null;
        const productFacts = PRODUCT_FACTS[metadata.productName] || {};
        const currentRow = (projection.projectionRows || []).find((r) => r.age === client.ageNextBirthday) || null;
        const coverageTermYears = protection.basicPlanTerm != null ? protection.basicPlanTerm : medical.coverageToAge != null && client.ageNextBirthday != null ? medical.coverageToAge - client.ageNextBirthday : null;
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
          medicalRiderName: medical.riderName,
          medicalPlanTier: medical.planTier,
          planName: medical.planName,
          coPaymentOption: medical.coPayment,
          basicPlanTerm: coverageTermYears,
          coverageToAge: medical.coverageToAge,
          coverageStartAge: client.ageNextBirthday != null ? client.ageNextBirthday + 1 : null,
          agentName: agentConfig.name || agent.agentNameOnDocument || null,
          agentCode: agent.agentCode || null,
          agencyName: agentConfig.agency || null,
          agencyLogo: agentConfig.logo || null,
          monthlyFormatted,
          monthlyCompact,
          totalAnnualContribution: contributions.totalAnnualContribution != null ? contributions.totalAnnualContribution : data && data.totalAnnualContribution,
          totalContributionOverTerm: contributions.totalContributionOverTerm,
          // Sourced from data.protection (see normalize/toProtectionJson.js),
          // populated for both products - Asas360's is formula-based (Basic Sum
          // Covered plus/before the cash value of the certificate), never a
          // fabricated single combined number, so the description is carried
          // alongside the guaranteed floor amount rather than replacing it.
          guaranteedDeathTPDBenefit: protection.deathBenefit ? protection.deathBenefit.amount : null,
          deathBenefitDescription: protection.deathBenefit ? protection.deathBenefit.description : null,
          isaContribution: contributions.isaContribution,
          protectionContribution: contributions.protectionContribution,
          wakalahCertificateCharge: contributions.wakalahCertificateCharge,
          // Only ever populated when the product prints a single flat cash
          // value figure (AnugerahMax) - Asas360's investment-linked structure
          // only ever prints a year-by-year schedule (protection.cashValue.schedule),
          // never a single "the" cash value, so these stay null for that product
          // rather than picking one arbitrary year and presenting it as definitive.
          cashValueX: protection.cashValue ? protection.cashValue.scenarioX : null,
          cashValueY: protection.cashValue ? protection.cashValue.scenarioY : null,
          coverageModel: medical.coverageModel,
          coverageExplanation: medical.coverageExplanation,
          annualLimit: medical.annualLimit,
          lifetimeLimit: medical.lifetimeLimit,
          lifetimeFundAmount: medical.lifetimeFundAmount,
          costSharingAfterExhaustion: medical.costSharingAfterExhaustion,
          // A single, coverage-model-agnostic headline figure for sections that
          // just need "the number that describes how much cover you have" -
          // never both at once, since exactly one is non-null per coverage model.
          coverageHeadline: medical.annualLimit || medical.lifetimeLimit || null,
          benefitItems,
          waitingPeriods: (medical.waitingPeriods || []).slice().sort((a, b) => a.days - b.days),
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
        let headline;
        let body;
        if (vm.coverageModel === "LIFETIME_MEDICAL_FUND") {
          const fundAmount = vm.lifetimeFundAmount != null ? moneyRM(vm.lifetimeFundAmount) : null;
          const sharing = vm.costSharingAfterExhaustion;
          headline = `${textOr(vm.planName, "Your plan")} gives you ${textOr(fundAmount, "a lifetime medical fund")} to draw on, for as long as you need it.`;
          body = `For ${vm.monthlyFormatted ? escapeHtml2(vm.monthlyFormatted) : "your monthly contribution"}, your medical card covers eligible hospitalisation and treatment against your ${textOr(fundAmount, "lifetime medical fund")}${sharing ? ` \u2014 and even after it's fully used, PruBSN continues paying ${escapeHtml2(String(sharing.insurerPct))}% of every further eligible claim, so you're never left facing the full bill alone.` : "."}`;
        } else {
          headline = `${textOr(vm.planName, "Your plan")} gives you ${textOr(vm.annualLimit, "protection")} a year to lean on.`;
          body = `For ${vm.monthlyFormatted ? escapeHtml2(vm.monthlyFormatted) : "your monthly contribution"}, your medical card covers eligible hospitalisation and treatment up to your ${textOr(vm.annualLimit, "annual limit")}.`;
          if (vm.boost) {
            const conditionText = vm.boost.conditions.length ? vm.boost.conditions.join(", ") : "a covered critical illness";
            headline = `${textOr(vm.planName, "Your plan")} gives you ${textOr(vm.annualLimit, "your annual limit")} a year, with a permanent boost of ${escapeHtml2(vm.boost.amount)} if it turns serious.`;
            body = `For ${vm.monthlyFormatted ? escapeHtml2(vm.monthlyFormatted) : "your monthly contribution"}, your ${textOr(vm.annualLimit, "annual limit")} automatically increases by ${escapeHtml2(vm.boost.amount)} the moment you're diagnosed with ${escapeHtml2(conditionText)} \u2014 permanently, every year after.`;
          }
        }
        return `
  <section style="padding-bottom:44px">
    <div class="pq-eyebrow pq-reveal">Your Plan \u2014 ${textOr(vm.planName)}</div>
    <div class="pq-headline pq-reveal d1" style="font-size:28px">${headline}</div>
    ${vm.coverageExplanation ? `<div class="pq-lede pq-reveal d2" style="font-style:italic">${escapeHtml2(vm.coverageExplanation)}</div>` : ""}
    <div class="pq-lede pq-reveal d2">${body}</div>
    <div class="pq-inline-photo-wrap pq-reveal d3">${imageWithFallback(AssetManager.getPlanImage(vm.medicalPlanTier), vm.planName || "Plan", "pq-inline-photo")}</div>
  </section>`;
      }
      function donutSegStyle(fraction, offsetSoFar, circ) {
        return `stroke-dashoffset:${(circ * (1 - fraction)).toFixed(1)};transform:rotate(${(offsetSoFar * 360).toFixed(1)}deg);transform-origin:100px 100px;`;
      }
      function renderContributionBreakdown(vm) {
        if (vm.protectionContribution == null && vm.wakalahCertificateCharge == null && vm.isaContribution == null) return "";
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
  <section class="pq-kb-section" data-narrate="${escapeHtml2(`The moment you're admitted, your ${vm.coverageHeadline || "annual limit"} starts working for you.`)}">
    <div class="pq-kb-media">${imageWithFallback(AssetManager.getHospitalImage(), "Hospital entrance")}</div>
    <div class="pq-kb-overlay"></div>
    <div class="pq-kb-content">
      <div class="pq-eyebrow pq-zoom">Step 1 \u2014 You're admitted</div>
      <div class="pq-headline pq-zoom">The moment you're admitted, your <span style="color:#4FD1D9">${textOr(vm.coverageHeadline, "annual limit")}</span> starts working for you.</div>
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
      function renderLifetimeFundSection(vm) {
        if (vm.coverageModel !== "LIFETIME_MEDICAL_FUND") return "";
        const fundAmount = vm.lifetimeFundAmount != null ? moneyRM(vm.lifetimeFundAmount) : null;
        const sharing = vm.costSharingAfterExhaustion;
        return `
  <section class="pq-kb-section" data-narrate="${escapeHtml2(`Your ${fundAmount || "lifetime medical fund"} isn't a yearly limit - it's yours for as long as your certificate is in force.`)}">
    <div class="pq-kb-media">${imageWithFallback(AssetManager.getFinancialImage(), "Lifetime medical fund")}</div>
    <div class="pq-kb-overlay"></div>
    <div class="pq-kb-content">
      <div class="pq-eyebrow pq-zoom">Step 4 \u2014 No yearly reset, no annual limit</div>
      <div class="pq-headline pq-zoom">Your fund carries over, year after year.</div>
      <div class="pq-kb-figure">${textOr(fundAmount, "Lifetime fund")}</div>
      <div class="pq-kb-note">
        ${sharing ? `Unlike a plan that resets every policy year, this fund only runs down as you claim. If your eligible claims ever exceed it, PruBSN continues paying ${escapeHtml2(String(sharing.insurerPct))}% of every further eligible cost \u2014 you're responsible for the remaining ${escapeHtml2(String(sharing.clientPct))}%, subject to your certificate's terms.` : `Unlike a plan that resets every policy year, this fund only runs down as you actually claim against it.`}
      </div>
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
      ${vm.deathBenefitDescription ? `<div class="pq-note" style="margin-top:6px">${escapeHtml2(vm.deathBenefitDescription)}</div>` : ""}
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
          { k: "Medical Coverage", v: vm.coverageHeadline, s: vm.coverageModel === "LIFETIME_MEDICAL_FUND" ? "Lifetime medical fund" : "Annual limit" }
        ];
        if (cards.every((c) => c.v == null)) return "";
        return `
  <section style="border-top:1px solid var(--line)">
    <div class="pq-eyebrow pq-reveal">E. The Full Picture</div>
    <div class="pq-headline pq-reveal d1">${vm.basicPlanTerm != null ? `${vm.basicPlanTerm} years, at a glance` : "At a glance"}</div>
    <div class="pq-inline-photo-wrap pq-reveal d1">${imageWithFallback(AssetManager.getCoverageImage(vm.coverageHeadline), "Medical coverage", "pq-inline-photo")}</div>
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
          renderLifetimeFundSection(vm),
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
        primaryValue: primaryValue2
      } = require_formatters();
      var { renderNarrativeQuotationHtml } = require_renderNarrativeQuotation();
      function extractDayTag(value) {
        if (!value) return null;
        const m = value.match(/\(([^)]*\bdays?\b[^)]*)\)/i);
        return m ? m[1] : null;
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
      function renderNote(projection, client, riderName) {
        const rows = projection && projection.projectionRows || [];
        const currentRow = rows.find((r) => client && r.age === client.ageNextBirthday) || rows[0] || null;
        const age = client ? client.ageNextBirthday : null;
        const amount = currentRow ? formatMoney(currentRow.currentContribution) : null;
        const rider = riderName || "contribution";
        if (age == null || amount == null) {
          return `This is an illustration, not a contract of takaful, and is subject to underwriting approval by Prudential BSN Takaful Berhad. ${escapeHtml2(rider)} contribution is not guaranteed and may rise over time with medical inflation.`;
        }
        return `This is an illustration, not a contract of takaful, and is subject to underwriting approval by Prudential BSN Takaful Berhad. ${escapeHtml2(rider)} contribution is not guaranteed and may rise over time with medical inflation \u2014 for example, the annual contribution at age ${age} is around RM ${amount} and is projected to increase as the covered person ages.`;
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
    .contrib .row.total, table.ben td.v, .tag{
      -webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact}
    .medcard{break-inside:avoid;page-break-inside:avoid}
    .fig, .contrib{break-inside:avoid;page-break-inside:avoid}
    h2.sec{break-after:avoid;page-break-after:avoid}
    .foot2{break-before:avoid;page-break-before:avoid}
  }
`;
      function findBenefitFuzzy(benefitItems, ...requiredWords) {
        return (benefitItems || []).find((item) => {
          const label = (item.label || "").toLowerCase();
          return requiredWords.every((w) => label.includes(w));
        }) || null;
      }
      function renderQuotationCard(data, mode, agentReview = {}) {
        var _a;
        const { metadata = {}, client = {}, agent = {}, plan = {}, contributions = {}, medical = {}, protection = {}, projection = {} } = data || {};
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
        const planSubtitle = [metadata.productName, [medical.riderName, medical.planTier ? `(Plan ${medical.planTier})` : null].filter(Boolean).join(" ")].filter(Boolean).join(" \xB7 ");
        const sourceNote = mode === "client" && quotationDateFormatted ? `<div class="src-note">Interactive quotation prepared from the PruBSN Product Illustration dated ${escapeHtml2(quotationDateFormatted)}.</div>` : "";
        const monthlyTotalPayableValue = (_a = resolveMonthlyTotalPayable(contributions)) != null ? _a : data && data.monthlyTotalAmountPayable != null ? data.monthlyTotalAmountPayable : null;
        const monthlyTotalPayable = monthlyTotalPayableValue != null ? `RM ${formatMoneyFixed2(monthlyTotalPayableValue)}` : null;
        const roomAndBoard = medical.roomAndBoard || {};
        const roomBoardCompact = roomAndBoard.amount != null ? compactRate(`RM${roomAndBoard.amount} per day`) : null;
        const roomBoardTag = roomAndBoard.maxDaysPerYear != null ? `maximum ${roomAndBoard.maxDaysPerYear} days` : null;
        const cardPlanLabel = medical.riderName ? [medical.riderName, medical.planTier].filter(Boolean).join(" ") : null;
        const hospitalSurgicalItem = findBenefitFuzzy(medical.benefitItems, "hospital", "related services");
        const hospitalSurgicalCompact = hospitalSurgicalItem ? primaryValue2(hospitalSurgicalItem.value) : null;
        const annualContribution = contributions.totalAnnualContribution != null ? contributions.totalAnnualContribution : data && data.totalAnnualContribution;
        const coverageTermYears = plan.basicPlanTerm != null ? plan.basicPlanTerm : medical.coverageToAge != null && client.ageNextBirthday != null ? medical.coverageToAge - client.ageNextBirthday : null;
        const hasContributionBreakdown = plan.basicPlanName != null || contributions.isaContribution != null || contributions.medicTotalCareContribution != null || contributions.wakalahCertificateCharge != null;
        const contributionBreakdownHtml = hasContributionBreakdown ? `
    <h2 class="sec">Your monthly contribution</h2>
    <div class="contrib">
      <div class="row"><span class="l">${textOr(plan.basicPlanName)} \u2014 Sum Covered ${plan.basicSumCovered != null ? money(plan.basicSumCovered) : missing()}</span><span class="r">${money(contributions.isaContribution)}</span></div>
      <div class="row"><span class="l">${textOr(medical.riderName)} \u2014 ${medical.planTier ? textOr(`Plan ${medical.planTier}`) : missing()}, ${textOr(medical.coPayment)}</span><span class="r">${money(contributions.medicTotalCareContribution)}</span></div>
      <div class="row"><span class="l">Wakalah Certificate Charge</span><span class="r">${money(contributions.wakalahCertificateCharge)}</span></div>
      <div class="row total"><span class="l">Monthly Total Amount Payable</span><span class="r">${monthlyTotalPayable ? escapeHtml2(monthlyTotalPayable) : missing()} ${annualContribution != null ? `<small>\xB7 ${money(annualContribution)}/yr</small>` : ""}</span></div>
    </div>` : `
    <h2 class="sec">Your monthly contribution</h2>
    <div class="contrib">
      <div class="row total"><span class="l">Monthly Total Amount Payable</span><span class="r">${monthlyTotalPayable ? escapeHtml2(monthlyTotalPayable) : missing()} ${annualContribution != null ? `<small>\xB7 ${money(annualContribution)}/yr</small>` : ""}</span></div>
    </div>`;
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
        <div><span class="lab">Cover to</span><br><b>${medical.coverageToAge != null ? `Age ${medical.coverageToAge}` : missing()}</b></div>
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
      <div class="fig"><div class="lab">Monthly Total Amount Payable</div><div class="amt">${monthlyTotalPayable ? escapeHtml2(monthlyTotalPayable) : missing()}</div><div class="sub">${annualContribution != null ? `${money(annualContribution)} / year` : ""}</div></div>
      <div class="fig"><div class="lab">${medical.coverageModel === "LIFETIME_MEDICAL_FUND" ? "Lifetime Medical Fund" : "Annual Limit"}</div><div class="amt">${textOr(medical.annualLimit || medical.lifetimeLimit)}</div><div class="sub">${textOr(medical.lifetimeLimit)}</div></div>
      <div class="fig"><div class="lab">Room &amp; Board</div><div class="amt">${roomBoardCompact ? escapeHtml2(roomBoardCompact) : missing()}</div><div class="sub">${roomBoardTag ? escapeHtml2(roomBoardTag) : ""}</div></div>
      <div class="fig"><div class="lab">Co-payment</div><div class="amt">${textOr(medical.coPayment)}</div><div class="sub">${coPaymentAmount(medical.coPayment) ? `RM ${coPaymentAmount(medical.coPayment)} per disability` : ""}</div></div>
      <div class="fig"><div class="lab">Hospital &amp; Surgical</div><div class="amt">${hospitalSurgicalCompact ? escapeHtml2(hospitalSurgicalCompact) : missing()}</div><div class="sub">cashless at panel</div></div>
      <div class="fig"><div class="lab">Coverage Term</div><div class="amt">${medical.coverageToAge != null ? `to Age ${medical.coverageToAge}` : missing()}</div><div class="sub">${coverageTermYears != null ? `${coverageTermYears} years` : ""}</div></div>
    </div>

    <h2 class="sec">Protection Summary</h2>
    <div class="prep">
      <div class="item name"><div class="k">Basic Plan</div><div class="v">${textOr(protection.basicPlanName)}</div></div>
      <div class="item"><div class="k">Basic Sum Covered</div><div class="v">${protection.basicSumCovered != null ? money(protection.basicSumCovered) : missing()}</div></div>
      <div class="item"><div class="k">Death Benefit</div><div class="v">${protection.deathBenefit ? money(protection.deathBenefit.amount) : missing()}</div></div>
      <div class="item"><div class="k">TPD Benefit</div><div class="v">${protection.tpdBenefit ? money(protection.tpdBenefit.amount) : missing()}</div></div>
      ${protection.deathBenefit && protection.deathBenefit.description ? `<div class="item name"><div class="k">Death / TPD basis</div><div class="v" style="font-size:12px;font-weight:400">${escapeHtml2(protection.deathBenefit.description)}</div></div>` : ""}
    </div>

    <h2 class="sec">What your medical card covers</h2>
    <table class="ben">
${renderBenefitsTable(medical.benefitItems, helpers)}
    </table>

    ${contributionBreakdownHtml}

    <h2 class="sec">What is not covered</h2>
    <ul class="excl">
${renderExclusions(medical.medicalExclusions, helpers)}
    </ul>

    <div class="note">
      <b>Please note.</b> ${renderNote(projection, client, medical.riderName)}
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
      var { getCoverageStrategy } = require_coverageStrategy();
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

  .cmp-toggle-wrap{margin-bottom:22px;padding:14px 16px;background:#f7fbfb;border:1px solid var(--line);border-radius:10px}
  .cmp-toggle-label{font-family:var(--serif);font-size:13px;font-weight:600;color:var(--teal-dk)}
  .cmp-toggle-options{display:flex;flex-wrap:wrap;gap:14px;margin-top:10px}
  .cmp-toggle-option{display:flex;align-items:center;gap:6px;font-size:12px;color:#444;cursor:pointer}
  .cmp-toggle-option input{cursor:pointer}
  td.cmp-col-recommended{background:rgba(23,141,147,.1)!important;box-shadow:inset 0 0 0 1px rgba(23,141,147,.35)}

  .cmp-education{margin-top:8px}
  .cmp-education-intro{font-size:12px;color:var(--meta);margin:4px 0 14px;line-height:1.6}
  .cmp-education-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}
  .cmp-education-card{background:#fafafa;border:1px solid #f0eaec;border-radius:10px;padding:16px}
  .cmp-education-title{font-family:var(--serif);color:var(--ink);font-size:14px;font-weight:600;margin-bottom:10px}
  .cmp-education-row{margin-top:10px}
  .cmp-education-row b{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--teal-dk)}
  .cmp-education-row p{font-size:12px;color:#444;line-height:1.55;margin:3px 0 0}
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
        const medical = data && data.medical || {};
        return medical.planName || null;
      }
      function planSubtitle(data) {
        const metadata = data && data.metadata || {};
        const medical = data && data.medical || {};
        return [metadata.productName, medical.coPayment].filter(Boolean).join(" \xB7 ") || null;
      }
      function roomBoardValue(data) {
        const roomAndBoard = data && data.medical && data.medical.roomAndBoard || {};
        if (roomAndBoard.amount == null) return null;
        return compactRate(`RM${roomAndBoard.amount} per day`);
      }
      function unionBenefitLabels(allData) {
        const seen = /* @__PURE__ */ new Set();
        const labels = [];
        for (const data of allData) {
          const items = data && data.medical && data.medical.benefitItems || [];
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
        const items = data && data.medical && data.medical.benefitItems || [];
        const item = items.find((i) => i.label === label);
        return item ? primaryValue2(item.value) : null;
      }
      function allEqual(values) {
        return values.every((v) => v === values[0]);
      }
      function monthlyFor(d) {
        const fromContributions = resolveMonthlyTotalPayable(d && d.contributions || {});
        if (fromContributions != null) return fromContributions;
        return d && d.monthlyTotalAmountPayable != null ? d.monthlyTotalAmountPayable : null;
      }
      function annualFor(d) {
        const fromContributions = d && d.contributions && d.contributions.totalAnnualContribution || null;
        if (fromContributions != null) return fromContributions;
        return d && d.totalAnnualContribution != null ? d.totalAnnualContribution : null;
      }
      function renderKeyFiguresTable(allData, headerCells) {
        const monthly = allData.map(monthlyFor);
        const annual = allData.map(annualFor);
        const bestMonthly = indexOfLowest(monthly);
        const bestAnnual = indexOfLowest(annual);
        const col = (i) => ` data-col="${i}"`;
        const planRow = `<tr><th>Plan</th>${allData.map((d, i) => `<td${col(i)}><div class="cmp-plan-name">${textOr(planLabel(d))}</div><div class="cmp-plan-sub">${escapeHtml2(planSubtitle(d) || "")}</div></td>`).join("")}</tr>`;
        const monthlyRow = `<tr><th>Monthly Total Amount Payable</th>${allData.map((d, i) => `<td${col(i)}${i === bestMonthly ? ' class="cmp-best"' : ""}>${moneyFixed2(monthly[i])}</td>`).join("")}</tr>`;
        const annualRow = `<tr><th>Annual Contribution</th>${allData.map((d, i) => `<td${col(i)}${i === bestAnnual ? ' class="cmp-best"' : ""}>${money(annual[i])}</td>`).join("")}</tr>`;
        const roomBoardRow = `<tr><th>Room &amp; Board</th>${allData.map((d, i) => `<td${col(i)}>${textOr(roomBoardValue(d))}</td>`).join("")}</tr>`;
        const coverageModelRow = `<tr><th>Coverage Model</th>${allData.map((d, i) => {
          const model = (d.medical || {}).coverageModel;
          return `<td${col(i)}>${textOr(model === "LIFETIME_MEDICAL_FUND" ? "Lifetime Medical Fund" : model === "ANNUAL_LIMIT" ? "Annual Limit" : null)}</td>`;
        }).join("")}</tr>`;
        const annualLimitRow = `<tr><th>Annual Limit</th>${allData.map((d, i) => `<td${col(i)}>${textOr((d.medical || {}).annualLimit)}</td>`).join("")}</tr>`;
        const lifetimeLimitRow = `<tr><th>Lifetime Medical Fund</th>${allData.map((d, i) => {
          const medical = d.medical || {};
          const amount = medical.lifetimeFundAmount != null ? money(medical.lifetimeFundAmount) : null;
          return `<td${col(i)}>${textOr(medical.lifetimeLimit)}${amount ? `<div class="cmp-plan-sub">${amount}</div>` : ""}</td>`;
        }).join("")}</tr>`;
        const coPayRow = `<tr><th>Co-payment</th>${allData.map((d, i) => {
          const opt = (d.medical || {}).coPayment;
          const amt = coPaymentAmount(opt);
          return `<td${col(i)}>${textOr(opt)}${amt ? `<div class="cmp-plan-sub">RM ${escapeHtml2(amt)} per disability</div>` : ""}</td>`;
        }).join("")}</tr>`;
        const coverageRow = `<tr><th>Coverage Term</th>${allData.map((d, i) => `<td${col(i)}>${(d.medical || {}).coverageToAge != null ? `to Age ${(d.medical || {}).coverageToAge}` : `<span class="na">Refer to certificate</span>`}</td>`).join("")}</tr>`;
        return `
    <table class="cmp">
      <thead><tr><th></th>${headerCells}</tr></thead>
      <tbody>${planRow}${monthlyRow}${annualRow}${roomBoardRow}${coverageModelRow}${annualLimitRow}${lifetimeLimitRow}${coPayRow}${coverageRow}</tbody>
    </table>`;
      }
      function renderBenefitsTable(allData, headerCells) {
        const labels = unionBenefitLabels(allData);
        if (!labels.length) return "";
        const rows = labels.map((label) => {
          const values = allData.map((d) => benefitValueFor(d, label));
          const differs = !allEqual(values);
          return `<tr><th>${escapeHtml2(label)}</th>${values.map((v, i) => `<td data-col="${i}"${differs && v ? ' class="cmp-best"' : ""}>${textOr(v)}</td>`).join("")}</tr>`;
        }).join("");
        return `
    <h3 class="cmp-sec">Benefit-by-benefit comparison</h3>
    <table class="cmp"><thead><tr><th></th>${headerCells}</tr></thead><tbody>${rows}</tbody></table>`;
      }
      function renderPlanToggle(allData) {
        const options = allData.map(
          (d, i) => `
      <label class="cmp-toggle-option">
        <input type="radio" name="cmp-recommend" value="${i}"${i === 0 ? " checked" : ""}>
        <span>${textOr(planLabel(d), `Option ${i + 1}`)}</span>
      </label>`
        ).join("");
        return `
  <div class="cmp-toggle-wrap">
    <div class="cmp-toggle-label">Choose Your Recommended Plan</div>
    <div class="cmp-toggle-options">${options}</div>
  </div>`;
      }
      var COMPARISON_RUNTIME = `
(function () {
  var radios = document.querySelectorAll('input[name="cmp-recommend"]');
  if (!radios.length) return;
  function apply(selected) {
    document.querySelectorAll('td[data-col]').forEach(function (td) {
      td.classList.toggle('cmp-col-recommended', td.getAttribute('data-col') === selected);
    });
  }
  radios.forEach(function (r) {
    r.addEventListener('change', function () { if (r.checked) apply(r.value); });
  });
  var checked = document.querySelector('input[name="cmp-recommend"]:checked');
  if (checked) apply(checked.value);
})();
`;
      function renderCrossProductEducation(allData) {
        const models = allData.map((d) => (d.medical || {}).coverageModel).filter(Boolean);
        const distinctModels = [...new Set(models)];
        if (distinctModels.length < 2) return "";
        const cards = allData.map((d, i) => {
          const medical = d.medical || {};
          const strategy = getCoverageStrategy(medical.coverageModel);
          const isLifetime = medical.coverageModel === "LIFETIME_MEDICAL_FUND";
          const sharing = medical.costSharingAfterExhaustion;
          const label = planLabel(d) || `Option ${i + 1}`;
          const howClaimsArePaid = isLifetime ? `Claims are paid from your ${medical.lifetimeLimit || "lifetime medical fund"} until it's used up${sharing ? `, then an ${sharing.insurerPct}% (PruBSN) / ${sharing.clientPct}% (you) cost-sharing arrangement applies` : ""}.` : `Claims are paid up to your ${medical.annualLimit || "annual limit"}, which refreshes in full every policy year.`;
          const advantages = isLifetime ? "Unused cover carries forward - nothing resets or is lost at the end of a policy year." : "A completely fresh limit every year, with no risk of a lifetime pool running out.";
          const disadvantages = isLifetime ? "The fund is finite - very large or repeated claims over time draw it down, after which you share part of the cost." : "The limit doesn't carry forward - it simply resets each year, so unused cover isn't banked for later.";
          const suitableFor = isLifetime ? "Clients who want one lasting pool of cover and are comfortable with shared costs once it is used up." : "Clients who want a predictable, fully-refreshed limit every single year.";
          return `
      <div class="cmp-education-card">
        <div class="cmp-education-title">${escapeHtml2(label)}</div>
        <div class="cmp-education-row"><b>Coverage structure</b><p>${textOr(strategy && strategy.explanation)}</p></div>
        <div class="cmp-education-row"><b>How claims are paid</b><p>${escapeHtml2(howClaimsArePaid)}</p></div>
        <div class="cmp-education-row"><b>Advantages</b><p>${escapeHtml2(advantages)}</p></div>
        <div class="cmp-education-row"><b>Disadvantages</b><p>${escapeHtml2(disadvantages)}</p></div>
        <div class="cmp-education-row"><b>Suitable client profile</b><p>${escapeHtml2(suitableFor)}</p></div>
      </div>`;
        });
        return `
  <div class="cmp-education">
    <h3 class="cmp-sec">Understanding the difference</h3>
    <p class="cmp-education-intro">These options use two different ways of paying claims, not just different numbers. Here's what that means for you:</p>
    <div class="cmp-education-grid">${cards.join("")}</div>
    <div class="cmp-note"><b>Important considerations.</b> Neither coverage structure is universally better - the right choice depends on your own risk tolerance, budget, and how you weigh predictability against a lasting pool of cover. Please discuss with your agent before deciding.</div>
  </div>`;
      }
      function comparisonCard(allData) {
        const clientName = allData[0] && allData[0].client && allData[0].client.fullName || null;
        const agentConfig = getAgentConfig(allData[0] && allData[0].agent && allData[0].agent.agentCode) || {};
        const headerCells = allData.map((d, i) => `<th>${escapeHtml2(`Option ${i + 1}`)}</th>`).join("");
        return `
<div class="cmp-wrap">
  <div class="cmp-head">
    <h2>Comparing ${allData.length} Options</h2>
    <p>${clientName ? `Prepared for ${escapeHtml2(clientName)}` : "Prepared for you"}${agentConfig.name ? ` by ${escapeHtml2(agentConfig.name)}` : ""}</p>
  </div>
  <div class="cmp-body">
    ${renderPlanToggle(allData)}
    ${renderKeyFiguresTable(allData, headerCells)}
    ${renderBenefitsTable(allData, headerCells)}
    ${renderCrossProductEducation(allData)}
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
<script>${COMPARISON_RUNTIME}<\/script>
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
      function buildRidersList(medical) {
        if (!medical || !medical.riderName) return [];
        const tierPart = medical.planTier ? ` - Plan ${medical.planTier}` : "";
        const coPayPart = medical.coPayment ? ` (${medical.coPayment})` : "";
        return [`${medical.riderName}${tierPart}${coPayPart}`];
      }
      function formatMonthlyTotalPayable(contributions, fallbackMonthly) {
        var _a;
        const value = (_a = resolveMonthlyTotalPayable(contributions)) != null ? _a : fallbackMonthly != null ? fallbackMonthly : null;
        const formatted = formatMoneyFixed2(value);
        return formatted != null ? `RM ${formatted}` : null;
      }
      function planSummaryFor(d) {
        const contributions = d && d.contributions || {};
        const medical = d && d.medical || {};
        return {
          planName: medical.planName || null,
          monthlyContribution: formatMonthlyTotalPayable(contributions, d && d.monthlyTotalAmountPayable),
          roomAndBoard: medical.roomAndBoard && medical.roomAndBoard.amount != null ? `RM${medical.roomAndBoard.amount} per day` : null,
          // Exactly one of these is non-null per coverage model - never both, never neither invented.
          annualLimit: medical.annualLimit || medical.lifetimeLimit || null,
          // Phase 5: additive fields for Airtable's "Coverage Model" (single
          // select: "Annual Limit" / "Lifetime Medical Fund") and "Lifetime Fund
          // Amount" (currency) columns - see backend/src/airtable.js.
          // coverageModelLabel intentionally spells out the select option text
          // rather than the internal ANNUAL_LIMIT/LIFETIME_MEDICAL_FUND enum
          // value, since this flows straight into that Airtable field.
          coverageModelLabel: medical.coverageModel === "LIFETIME_MEDICAL_FUND" ? "Lifetime Medical Fund" : medical.coverageModel === "ANNUAL_LIMIT" ? "Annual Limit" : null,
          lifetimeFundAmount: medical.lifetimeFundAmount != null ? medical.lifetimeFundAmount : null
        };
      }
      function buildPrefillData2(dataOrArray, agentReview) {
        const allData = Array.isArray(dataOrArray) ? dataOrArray : [dataOrArray];
        const d = allData[0] || {};
        const review = agentReview || {};
        const plan = d.plan || {};
        const contributions = d.contributions || {};
        const medical = d.medical || {};
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
            // "Base Plan" - AnugerahMax's own basic-plan component name when
            // present (unchanged from before); Asas360 has no equivalent
            // basic-plan concept in Version 1's medical-only scope (see
            // extractors/asas360.js), so the overall product name is shown
            // instead - still accurate, never invented.
            planName: plan.basicPlanName || metadata.productName || null,
            monthlyContribution: formatMonthlyTotalPayable(contributions, d.monthlyTotalAmountPayable),
            riders: buildRidersList(medical)
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

  // renderer/story/storyStyles.js
  var require_storyStyles = __commonJS({
    "renderer/story/storyStyles.js"(exports, module) {
      "use strict";
      var STORY_CSS = `
/* Layout: one full-screen scene at a time, tap or swipe to advance, illustrated SVG motion in each scene. Same committed look as the AnugerahMax story deck (single light "dawn" world with night scenes). */
:root {
  --ink: #0B2545;
  --ink-soft: #5A6B85;
  --teal: #178D93;
  --teal-bright: #4FD1D9;
  --gold: #D4A23A;
  --coral: #C2553F;
  --paper: #FFFFFF;
  --night: #0B2545;
  --night-2: #16345E;
  --mist: #C9D6E8;
  --mist-2: #8FA3BF;
  --dawn: linear-gradient(165deg, #F6C9D6 0%, #F2D3E2 18%, #E7D7EC 38%, #D6E1F0 60%, #C3E7F3 82%, #BEEAF4 100%);
  --serif: "Newsreader", Georgia, "Times New Roman", serif;
  --sans: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --ease: cubic-bezier(.22, 1, .36, 1);
  color-scheme: light;
}
* { box-sizing: border-box; }
html, body { height: 100%; }
body { margin: 0; background: #E7D7EC; color: var(--ink); font-family: var(--sans); overflow: hidden; -webkit-tap-highlight-color: transparent; }

.deck { position: relative; height: 100%; background: var(--dawn); overflow: hidden; }
.slide {
  position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center;
  padding-block: 64px 96px;
  padding-left: max(24px, env(safe-area-inset-left, 0px)); padding-right: max(24px, env(safe-area-inset-right, 0px));
  opacity: 0; visibility: hidden; transform: translateX(40px);
  transition: opacity .6s var(--ease), transform .6s var(--ease), visibility 0s .6s;
  overflow-y: auto;
}
.slide.is-active { opacity: 1; visibility: visible; transform: none; transition: opacity .6s var(--ease), transform .6s var(--ease), visibility 0s; }
.slide.is-past { transform: translateX(-40px); }
.slide.night { background: radial-gradient(120% 90% at 50% 0%, var(--night-2) 0%, var(--night) 70%); color: #fff; }
.inner { width: min(760px, 100%); margin-inline: auto; display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.center { text-align: center; align-items: center; }

.eyebrow { font-size: 12px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--teal); }
.night .eyebrow { color: var(--teal-bright); }
h1, h2 { font-family: var(--serif); font-weight: 600; margin: 0; text-wrap: balance; line-height: 1.12; }
h1 { font-size: clamp(32px, 6vw, 56px); }
h2 { font-size: clamp(26px, 4.6vw, 42px); }
.hl { color: var(--teal); }
.night .hl { color: var(--teal-bright); }
p { margin: 0; font-size: clamp(16px, 2vw, 19px); line-height: 1.55; color: var(--ink-soft); max-width: 60ch; }
.night p { color: var(--mist); }
.fine { font-size: 12.5px; line-height: 1.5; color: var(--ink-soft); }
.night .fine { color: var(--mist-2); }
.num { font-variant-numeric: tabular-nums; }

.rv { opacity: 1; transform: none; }
@media (prefers-reduced-motion: no-preference) {
  .slide .rv { opacity: 0; transform: translateY(22px); }
  .slide.is-active .rv { opacity: 1; transform: none; transition: opacity .8s var(--ease), transform .8s var(--ease); }
  .slide.is-active .d1 { transition-delay: .15s; } .slide.is-active .d2 { transition-delay: .3s; }
  .slide.is-active .d3 { transition-delay: .45s; } .slide.is-active .d4 { transition-delay: .6s; }
  .slide.is-active .d5 { transition-delay: .75s; } .slide.is-active .d6 { transition-delay: .9s; }
  .slide.is-active .d7 { transition-delay: 1.05s; } .slide.is-active .d8 { transition-delay: 1.2s; }
}

/* Intro */
.brand { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.brand-mark { width: 84px; height: 84px; }
.brand-mark .ring { fill: none; stroke: var(--teal); stroke-width: 3; }
.brand-mark .leaf { fill: var(--gold); transform-origin: 50% 60%; }
@media (prefers-reduced-motion: no-preference) {
  .is-active .brand-mark .ring { animation: draw 1.6s var(--ease) both; }
  .is-active .brand-mark .leaf { animation: pop 1s var(--ease) .9s both; }
}
.tagline { font-family: var(--serif); font-style: italic; font-size: clamp(24px, 4vw, 32px); color: var(--teal); }
.tap-hint { font-size: 12px; letter-spacing: .12em; text-transform: uppercase; color: #7C88A0; }
@media (prefers-reduced-motion: no-preference) { .is-active .tap-hint { animation: nudge 1.8s ease-in-out 2s infinite; } }

/* Cover */
.badge { display: inline-flex; align-items: center; gap: 8px; padding: 8px 16px; border-radius: 999px; background: rgba(255,255,255,.7); font-size: 13px; font-weight: 600; color: #7A5F0E; }
.agent-line { font-size: 14px; color: var(--ink-soft); }
.bump { width: 150px; height: auto; }
.bump .ln { fill: none; stroke: var(--teal); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.bump .heart { fill: var(--coral); transform-box: fill-box; transform-origin: center; }
@media (prefers-reduced-motion: no-preference) {
  .is-active .bump .ln { animation: draw 2s var(--ease) both; }
  .is-active .bump .heart { animation: pop .8s var(--ease) 1.2s both, beat 1.4s ease-in-out 2s infinite; }
}

/* Agenda */
.agenda { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.ag { background: var(--paper); border-radius: 14px; padding: 16px; display: flex; gap: 12px; align-items: flex-start; box-shadow: 0 6px 18px rgba(11,37,69,.06); min-width: 0; }
.ag .n { flex: none; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; font-size: 14px; background: #E3F4F5; color: var(--teal); }
.ag b { display: block; font-size: 15.5px; }
.ag span { font-size: 13.5px; color: var(--ink-soft); }
.promise { background: var(--night); color: #fff; border-radius: 16px; padding: 16px 18px; font-size: 15.5px; line-height: 1.5; }
.promise b { color: var(--teal-bright); }

/* People grid */
.people { width: min(520px, 100%); height: auto; }
.people .p { fill: rgba(255,255,255,.18); transform-box: fill-box; transform-origin: center bottom; }
.people .p.on { fill: var(--teal-bright); }
@media (prefers-reduced-motion: no-preference) { .is-active .people .p { animation: pop .6s var(--ease) both; } }
.kb-fig { font-family: var(--serif); font-size: clamp(48px, 10vw, 88px); font-weight: 700; color: var(--teal-bright); line-height: 1; }
.kb-fig small { font-size: .35em; color: #CFE0EE; font-weight: 600; }

/* Tiles */
.glance { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.glance.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.tile { background: var(--paper); border-radius: 14px; padding: 16px; min-width: 0; color: var(--ink); text-align: left; }
.tile.dark { background: var(--teal); color: #fff; }
.tile.navy { background: var(--night); color: #fff; }
.tile .k { font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-soft); }
.tile.dark .k, .tile.navy .k { color: #CFF1F2; }
.tile .v { font-family: var(--serif); font-size: clamp(24px, 3.6vw, 34px); font-weight: 700; margin-top: 4px; line-height: 1.1; }
.tile .s { font-size: 13px; line-height: 1.45; color: var(--ink-soft); margin-top: 4px; }
.tile.dark .s, .tile.navy .s { color: #CFF1F2; }
.tile .src { font-size: 11.5px; color: var(--mist-2); margin-top: 8px; }
.tile.dark .src { color: #BFE7E9; }

/* Underinsured bar */
.under { display: flex; flex-direction: column; gap: 8px; }
.under-track { height: 22px; border-radius: 999px; background: rgba(11,37,69,.1); overflow: hidden; display: flex; }
.under-fill { width: 96%; background: var(--coral); transform-origin: left; border-radius: 999px; }
.under-labels { display: flex; justify-content: space-between; font-size: 13px; color: var(--ink-soft); gap: 12px; }
@media (prefers-reduced-motion: no-preference) {
  .slide .under-fill { transform: scaleX(0); }
  .is-active .under-fill { transform: scaleX(1); transition: transform 1.6s var(--ease) .6s; }
}

/* Horizontal bars */
.hbars { display: flex; flex-direction: column; gap: 14px; }
.hrow { display: grid; grid-template-columns: 120px minmax(0, 1fr) 64px; gap: 12px; align-items: center; }
.hrow .lbl { font-size: 14.5px; font-weight: 600; }
.hrow .val { font-family: var(--serif); font-size: 24px; font-weight: 700; text-align: right; }
.htrack { height: 34px; }
.hbar { height: 100%; border-radius: 4px 10px 10px 4px; background: var(--teal); transform-origin: left; }
.hbar.hi { background: var(--coral); }
.hbar.lo { background: #9ED3D6; }
@media (prefers-reduced-motion: no-preference) {
  .slide .hbar { transform: scaleX(0); }
  .is-active .hbar { transform: scaleX(1); transition: transform 1.3s var(--ease); }
  .is-active .hrow:nth-child(2) .hbar { transition-delay: .25s; }
  .is-active .hrow:nth-child(3) .hbar { transition-delay: .5s; }
}

/* Vertical bars */
.bars { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; align-items: end; height: 240px; margin-top: 8px; }
.bar-col { display: flex; flex-direction: column; align-items: center; gap: 6px; height: 100%; justify-content: flex-end; min-width: 0; }
.bar-pair { display: flex; align-items: flex-end; height: 100%; width: 100%; justify-content: center; }
.bar { width: 58%; border-radius: 8px 8px 3px 3px; background: var(--teal); transform-origin: bottom; }
.bar.hi { background: var(--coral); }
.bar-val { font-size: 12px; font-weight: 700; }
.bar-age { font-size: 12px; color: var(--ink-soft); }
@media (prefers-reduced-motion: no-preference) {
  .slide .bar { transform: scaleY(0); }
  .is-active .bar { transform: scaleY(1); transition: transform 1.2s var(--ease); }
}

/* Cover list */
.cover-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.cv { background: var(--paper); border-radius: 12px; padding: 14px; min-width: 0; }
.cv b { display: block; font-size: 14.5px; }
.cv span { font-size: 13px; color: var(--ink-soft); }
.cv em { font-style: normal; display: block; font-weight: 700; color: var(--teal); margin-top: 4px; font-size: 14px; }
.cv.alert { background: var(--night); color: #fff; }
.cv.alert span { color: var(--mist); }
.cv.alert em { color: var(--teal-bright); }
.cv .vs { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
.cv .vs i { font-style: normal; font-size: 12.5px; font-weight: 700; padding: 3px 8px; border-radius: 999px; }
.cv .vs .sup { background: #E3F4F5; color: #0F6F74; }
.cv .vs .ess { background: #FBEDE9; color: #9A3F2D; }

/* Two paths */
.paths { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.path { border-radius: 16px; padding: 18px 16px 16px; display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; min-width: 0; }
.path.bank { background: var(--paper); box-shadow: 0 8px 24px rgba(11,37,69,.08); }
.path.fund { background: var(--night); color: #fff; }
.path-k { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink-soft); }
.fund .path-k { color: var(--mist-2); }
.path-t { font-weight: 700; font-size: 15px; }
.path svg { width: 100%; max-width: 220px; height: auto; }
.path .cap { font-size: 13px; line-height: 1.45; color: var(--ink-soft); }
.fund .cap { color: var(--mist); }
.coin { fill: var(--gold); }
@media (prefers-reduced-motion: no-preference) {
  .is-active .coin { animation: coinFall 2.4s var(--ease) infinite; }
  .is-active .coin.c2 { animation-delay: .8s; } .is-active .coin.c3 { animation-delay: 1.6s; }
  .is-active .breathe { animation: breathe 3s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
}

/* The moment */
.ecg { width: 100%; max-width: 520px; height: auto; }
.ecg path { fill: none; stroke: var(--teal-bright); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.alarm-fig { width: 120px; height: auto; }
.alarm-fig .body { fill: none; stroke: #F2A65A; stroke-width: 4; stroke-linecap: round; }
@media (prefers-reduced-motion: no-preference) {
  .is-active .ecg path { animation: draw 2.4s linear both; }
  .is-active .alarm-fig { animation: startle .5s ease-in-out 1s 3; }
}
.big-red { font-family: var(--serif); font-size: clamp(44px, 9vw, 84px); font-weight: 700; color: #F2A65A; line-height: 1; }

/* Steps */
.steps { display: flex; flex-direction: column; gap: 10px; }
.step { display: flex; gap: 14px; align-items: flex-start; background: var(--paper); border-radius: 14px; padding: 14px 16px; box-shadow: 0 6px 18px rgba(11,37,69,.06); }
.step.worst { background: var(--coral); color: #fff; }
.step .n { flex: none; width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; font-size: 14px; background: #FBEDE9; color: var(--coral); }
.step.worst .n { background: rgba(255,255,255,.2); color: #fff; }
.step b { display: block; font-size: 15.5px; }
.step span { font-size: 14px; color: var(--ink-soft); }
.step.worst span { color: #FBE3DD; }
.settled { background: var(--teal); color: #fff; border-radius: 18px; padding: 24px; display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; }
.settled .check { width: 72px; height: 72px; }
.settled .check circle { fill: rgba(255,255,255,.18); }
.settled .check path { fill: none; stroke: #fff; stroke-width: 5; stroke-linecap: round; stroke-linejoin: round; }
@media (prefers-reduced-motion: no-preference) { .is-active .settled .check path { animation: draw 1s var(--ease) .6s both; } }
.settled .fig { font-family: var(--serif); font-size: clamp(24px, 4vw, 32px); font-weight: 600; }

/* Donut */
.donut-wrap { display: grid; grid-template-columns: minmax(0, 220px) minmax(0, 1fr); gap: 24px; align-items: center; }
.donut { position: relative; width: 100%; max-width: 220px; aspect-ratio: 1; }
.donut svg { width: 100%; height: 100%; transform: rotate(-90deg); }
.donut circle { fill: none; stroke-width: 22; }
.donut .track { stroke: rgba(11,37,69,.08); }
.donut-total { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.donut-total .k { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-soft); }
.donut-total .v { font-family: var(--serif); font-size: 38px; font-weight: 700; }
.split { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.split-row { background: var(--paper); border-radius: 12px; padding: 12px 14px; display: flex; gap: 12px; align-items: flex-start; }
.split-row i { flex: none; width: 12px; height: 12px; border-radius: 3px; margin-top: 4px; }
.split-row b { display: block; }
.split-row span { font-size: 13.5px; color: var(--ink-soft); }

/* Pyramid */
.pyr-wrap { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 20px; align-items: center; }
.pyramid { width: 100%; height: auto; }
.pyramid .tier { transform-box: fill-box; transform-origin: center bottom; }
.pyramid .t0 { fill: var(--night); }
.pyramid .t1 { fill: var(--teal); }
.pyramid .t2 { fill: #5FB7BB; }
.pyramid .t3 { fill: #A7D9DB; }
.pyramid .t4 { fill: var(--gold); }
.pyramid text { font-family: var(--sans); font-weight: 700; text-anchor: middle; }
.pyramid .lt { fill: #FFFFFF; }
.pyramid .dk { fill: var(--ink); }
@media (prefers-reduced-motion: no-preference) {
  .is-active .pyramid .tier { animation: rise .8s var(--ease) both; }
  .is-active .pyramid .g1 { animation-delay: .35s; } .is-active .pyramid .g2 { animation-delay: .7s; }
  .is-active .pyramid .g3 { animation-delay: 1.05s; } .is-active .pyramid .g4 { animation-delay: 1.4s; }
}
.rule { background: var(--night); color: #fff; border-radius: 12px; padding: 12px 14px; font-size: 14px; line-height: 1.5; }
.rule b { color: var(--teal-bright); }

/* Questions and chips */
.qs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.q { background: var(--paper); border-radius: 14px; padding: 14px 16px; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.q .qk { font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--teal); font-weight: 700; }
.q b { font-size: 15px; line-height: 1.4; }
.q span { font-size: 13px; color: var(--ink-soft); line-height: 1.45; }
.chip-group { display: flex; flex-direction: column; gap: 8px; }
.chip-label { font-size: 12px; letter-spacing: .1em; text-transform: uppercase; font-weight: 700; color: var(--ink-soft); }
.chips { display: flex; gap: 8px; flex-wrap: wrap; }
.chip { font: 600 14px var(--sans); color: var(--ink); background: var(--paper); border: 2px solid transparent; border-radius: 999px; padding: 10px 16px; cursor: pointer; }
.chip[aria-pressed="true"] { background: var(--night); color: #fff; border-color: var(--teal-bright); }
.chip:focus-visible { outline: 3px solid var(--teal); outline-offset: 2px; }
.said { background: rgba(255,255,255,.75); border-radius: 12px; padding: 12px 14px; font-size: 14px; color: var(--ink); line-height: 1.5; }
.said b { color: var(--teal); }

/* Options */
.options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.opt { background: var(--paper); border-radius: 14px; padding: 16px 14px; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.opt.rec { background: var(--night); color: #fff; box-shadow: 0 0 0 3px var(--teal); }
.opt .k { font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-soft); }
.opt.rec .k { color: var(--teal-bright); }
.opt .nm { font-weight: 700; font-size: 14px; }
.opt .v { font-family: var(--serif); font-size: 26px; font-weight: 700; }
.opt .v small { font-size: 13px; font-family: var(--sans); font-weight: 500; }
.opt .meta { font-size: 12.5px; color: var(--ink-soft); line-height: 1.5; }
.opt.rec .meta { color: var(--mist); }

/* Timeline */
.timeline { position: relative; margin-top: 20px; padding-top: 36px; }
.tl-line { position: absolute; top: 46px; left: 6px; right: 6px; height: 4px; border-radius: 4px; background: rgba(11,37,69,.12); }
.tl-fill { position: absolute; top: 46px; left: 6px; height: 4px; border-radius: 4px; background: var(--teal); width: calc(100% - 12px); transform-origin: left; }
@media (prefers-reduced-motion: no-preference) {
  .slide .tl-fill { transform: scaleX(0); }
  .is-active .tl-fill { transform: scaleX(1); transition: transform 2.4s var(--ease) .3s; }
}
.tl-points { position: relative; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.tl-pt { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.tl-pt .dot { width: 24px; height: 24px; border-radius: 50%; background: var(--teal); border: 5px solid #fff; box-shadow: 0 0 0 2px var(--teal); }
.tl-pt .dot.warn { background: var(--coral); box-shadow: 0 0 0 2px var(--coral); }
.tl-pt .day { font-family: var(--serif); font-size: 24px; font-weight: 700; }
.tl-pt b { font-size: 14.5px; }
.tl-pt span { font-size: 13px; color: var(--ink-soft); }

/* Close */
.done { width: 96px; height: 96px; border-radius: 50%; background: var(--teal); display: grid; place-items: center; }
.done svg { width: 44px; height: 44px; }
.done path { fill: none; stroke: #fff; stroke-width: 5; stroke-linecap: round; stroke-linejoin: round; }
@media (prefers-reduced-motion: no-preference) {
  .is-active .done { animation: ring 2.4s ease-in-out 1.2s infinite; }
  .is-active .done path { animation: draw .9s var(--ease) .3s both; }
}
.agent { display: flex; gap: 12px; align-items: center; background: rgba(255,255,255,.75); border-radius: 14px; padding: 12px 16px; text-align: left; }
.agent .av { width: 44px; height: 44px; border-radius: 12px; background: var(--night); color: var(--gold); display: grid; place-items: center; font-family: var(--serif); font-weight: 700; font-size: 18px; flex: none; }
.agent b { display: block; font-size: 14.5px; }
.agent span { font-size: 12.5px; color: var(--ink-soft); }
.next-list { display: flex; flex-direction: column; gap: 8px; text-align: left; width: 100%; }
.next-list div { background: rgba(255,255,255,.75); border-radius: 12px; padding: 10px 14px; font-size: 14px; color: var(--ink); }

/* Sources */
.src-list { display: flex; flex-direction: column; gap: 8px; }
.src-list a { display: block; background: var(--paper); border-radius: 10px; padding: 10px 14px; font-size: 13.5px; color: var(--ink); text-decoration: none; line-height: 1.45; }
.src-list a span { display: block; color: var(--ink-soft); font-size: 12px; }
.src-list a:focus-visible { outline: 3px solid var(--teal); outline-offset: 2px; }


/* Congenital conditions */
.cond-head { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 18px; align-items: center; }
.cond-art { width: 120px; height: auto; }
.cond-art .ln { fill: none; stroke: var(--teal); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.cond-art .soft { fill: rgba(23,141,147,.10); }
.cond-art .gold { fill: var(--gold); transform-box: fill-box; transform-origin: center; }
.cond-title { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.cond-big { display: flex; align-items: center; gap: 14px; font-family: var(--serif); font-size: clamp(22px, 3.6vw, 32px); font-weight: 600; line-height: 1.15; text-wrap: balance; }
.cond-big b { color: var(--teal); font-weight: 600; }
.kb27 { font-size: clamp(64px, 11vw, 96px); font-weight: 700; color: var(--coral); line-height: 1; flex: none; }
.cond { display: flex; flex-direction: column; gap: 10px; background: rgba(255,255,255,.6); border-radius: 14px; padding: 14px; }
.cond-g { display: grid; grid-template-columns: 170px minmax(0, 1fr); gap: 10px; align-items: start; }
.cond-k { display: flex; align-items: center; gap: 8px; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; font-weight: 700; color: var(--ink-soft); padding-top: 3px; }
.ic { width: 22px; height: 22px; flex: none; }
.ic path { fill: none; stroke: var(--teal); stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.cond-chips { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
.cond-chips i { font-style: normal; font-size: 13px; font-weight: 600; color: var(--ink); background: var(--paper); border-radius: 999px; padding: 5px 11px; line-height: 1.35; }
.cond-chips i.key { background: var(--gold); color: var(--ink); box-shadow: 0 0 0 2px #FFFFFF, 0 0 0 4px var(--gold); }
.cond-chips i.sup { background: #E3F4F5; color: #0F6F74; }
@media (prefers-reduced-motion: no-preference) {
  .is-active .cond-art .ln { animation: draw 2.2s var(--ease) both; }
  .is-active .cond-art .soft { animation: fadeIn 1.2s ease .8s both; }
  .is-active .cond-art .pulse { animation: pop .8s var(--ease) 1.4s both, beat 1.4s ease-in-out 2.2s infinite; }
  .is-active .ic path { animation: draw 1.4s var(--ease) both; }
  .is-active .cond-chips i { animation: pop .5s var(--ease) both; }
  .is-active .cond-g:nth-child(1) .ic path, .is-active .cond-g:nth-child(1) i { animation-delay: .5s; }
  .is-active .cond-g:nth-child(2) .ic path, .is-active .cond-g:nth-child(2) i { animation-delay: .7s; }
  .is-active .cond-g:nth-child(3) .ic path, .is-active .cond-g:nth-child(3) i { animation-delay: .9s; }
  .is-active .cond-g:nth-child(4) .ic path, .is-active .cond-g:nth-child(4) i { animation-delay: 1.1s; }
  .is-active .cond-g:nth-child(5) .ic path, .is-active .cond-g:nth-child(5) i { animation-delay: 1.3s; }
  .is-active .cond-g:nth-child(6) .ic path, .is-active .cond-g:nth-child(6) i { animation-delay: 1.5s; }
  .is-active .cond-g:nth-child(7) .ic path, .is-active .cond-g:nth-child(7) i { animation-delay: 1.7s; }
  .is-active .cond-chips i.key { animation: pop .5s var(--ease) .7s both, glow 2s ease-in-out 1.8s infinite; }
}
@keyframes glow { 0%, 100% { box-shadow: 0 0 0 2px #FFFFFF, 0 0 0 4px var(--gold); } 50% { box-shadow: 0 0 0 2px #FFFFFF, 0 0 0 9px rgba(212,162,58,.35); } }
@media (max-width: 600px) {
  .cond-head { grid-template-columns: 84px minmax(0, 1fr); gap: 12px; }
  .cond-art { width: 84px; }
  .cond-big { flex-direction: column; align-items: flex-start; gap: 4px; }
  .cond-g { grid-template-columns: 1fr; gap: 6px; }
}

/* Scene art (line drawings) */
.scene-art { width: min(260px, 70%); height: auto; align-self: center; }
.scene-art .ln { fill: none; stroke: var(--teal-bright); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.scene-art .soft { fill: rgba(79,209,217,.12); }
.scene-art .gold { fill: var(--gold); transform-box: fill-box; transform-origin: center; }
@media (prefers-reduced-motion: no-preference) {
  .is-active .scene-art .ln { animation: draw 2.2s var(--ease) both; }
  .is-active .scene-art .soft { animation: fadeIn 1.2s ease .8s both; }
  .is-active .scene-art .pulse { animation: pop .8s var(--ease) 1.4s both, beat 1.6s ease-in-out 2.2s infinite; }
}
.bed-art { width: min(200px, 55%); }

/* Answer form */
.form-card { background: rgba(255,255,255,.7); border-radius: 14px; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
.field { display: flex; flex-direction: column; gap: 6px; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; font-weight: 700; color: var(--ink-soft); }
.field input { font: 500 16px var(--sans); color: var(--ink); background: var(--paper); border: 2px solid #D6E1F0; border-radius: 10px; padding: 10px 12px; width: 100%; max-width: 420px; letter-spacing: 0; text-transform: none; }
.field input:focus-visible { outline: none; border-color: var(--teal); }
.limit-box { display: flex; flex-direction: column; gap: 10px; border-top: 1px dashed #C9D6E8; padding-top: 12px; }
@media (prefers-reduced-motion: no-preference) { .limit-box:not([hidden]) { animation: rise .5s var(--ease) both; } }

/* Tappable benefit cards */
.cv-btn { font: inherit; color: inherit; text-align: left; border: 2px solid transparent; cursor: pointer; display: flex; flex-direction: column; gap: 2px; position: relative; }
.cv-btn b { display: block; padding-right: 64px; }
.cv-btn .vs { display: flex; }
.cv-btn .more { position: absolute; top: 12px; right: 12px; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--teal); background: #E3F4F5; border-radius: 999px; padding: 3px 9px; }
.cv-btn:hover { border-color: #9ED3D6; }
.cv-btn:focus-visible { outline: 3px solid var(--teal); outline-offset: 2px; }
.ci { font: 600 13px var(--sans); color: var(--ink); background: var(--paper); border: 0; border-radius: 999px; padding: 5px 11px 5px 22px; line-height: 1.35; cursor: pointer; position: relative; box-shadow: 0 0 0 2px #9ED3D6 inset; }
.ci::before { content: ""; position: absolute; left: 9px; top: 50%; width: 7px; height: 7px; margin-top: -3.5px; border-radius: 50%; background: var(--teal); }
.ci.key { background: var(--gold); box-shadow: 0 0 0 2px #FFFFFF, 0 0 0 4px var(--gold); }
.ci.key::before { background: var(--ink); }
.ci:focus-visible { outline: 3px solid var(--teal); outline-offset: 2px; }
@media (prefers-reduced-motion: no-preference) {
  .is-active .cond-chips .ci { animation: pop .5s var(--ease) both; }
  .is-active .cond-g:nth-child(1) .ci { animation-delay: .5s; } .is-active .cond-g:nth-child(2) .ci { animation-delay: .7s; }
  .is-active .cond-g:nth-child(3) .ci { animation-delay: .9s; } .is-active .cond-g:nth-child(5) .ci { animation-delay: 1.3s; }
  .is-active .cond-g:nth-child(6) .ci { animation-delay: 1.5s; }
  .is-active .cond-chips .ci.key { animation: pop .5s var(--ease) .7s both, glow 2s ease-in-out 1.8s infinite; }
}

/* Detail sheet */
.sheet-bg { position: absolute; inset: 0; z-index: 7; background: rgba(11,37,69,.45); }
.sheet { position: absolute; z-index: 8; left: max(16px, env(safe-area-inset-left, 0px)); right: max(16px, env(safe-area-inset-right, 0px)); bottom: calc(16px + env(safe-area-inset-bottom, 0px)); margin-inline: auto; max-width: 620px; max-height: calc(100% - 48px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)); overflow-y: auto; background: var(--paper); color: var(--ink); border-radius: 20px; padding: 22px 20px 20px; box-shadow: 0 24px 60px rgba(11,37,69,.35); }
@media (prefers-reduced-motion: no-preference) { .sheet:not([hidden]) { animation: rise .45s var(--ease) both; } .sheet-bg:not([hidden]) { animation: fadeIn .3s ease both; } }
.sheet-x { position: absolute; top: 10px; right: 10px; width: 40px; height: 40px; border-radius: 50%; border: 0; background: #EEF3F8; color: var(--ink); font-size: 22px; cursor: pointer; }
.sheet-x:focus-visible, .sheet-go:focus-visible { outline: 3px solid var(--teal); outline-offset: 2px; }
.sheet .sk { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; font-weight: 700; color: var(--teal); }
.sheet h3 { font-family: var(--serif); font-size: clamp(22px, 4vw, 30px); font-weight: 600; margin: 4px 48px 8px 0; line-height: 1.15; text-wrap: balance; }
.sheet p { font-size: 15px; }
.sheet .pw { font-size: 17px; color: var(--ink); line-height: 1.5; }
.sl { list-style: none; margin: 12px 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.sl li { background: #F3F7FB; border-radius: 10px; padding: 9px 12px; font-size: 14.5px; }
.sl li b { display: block; }
.sl li span { font-size: 13px; color: var(--ink-soft); }
@media (prefers-reduced-motion: no-preference) {
  .sl li { animation: rise .5s var(--ease) both; }
  .sl li:nth-child(2) { animation-delay: .06s; } .sl li:nth-child(3) { animation-delay: .12s; } .sl li:nth-child(4) { animation-delay: .18s; }
  .sl li:nth-child(5) { animation-delay: .24s; } .sl li:nth-child(6) { animation-delay: .3s; } .sl li:nth-child(7) { animation-delay: .36s; } .sl li:nth-child(8) { animation-delay: .42s; }
}
.sv { display: flex; flex-direction: column; gap: 6px; background: var(--night); color: #fff; border-radius: 12px; padding: 12px 14px; margin: 12px 0 8px; font-size: 14px; line-height: 1.45; }
.sv b { color: var(--teal-bright); }
.sheet-go { font: 700 14px var(--sans); color: #fff; background: var(--teal); border: 0; border-radius: 999px; padding: 12px 18px; cursor: pointer; margin-top: 8px; }

/* Pictures */
.pic { display: block; width: min(280px, 100%); height: auto; margin: 8px auto 4px; }
.pic .ln { fill: none; stroke: var(--teal); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.pic .soft { fill: rgba(23,141,147,.10); }
.pic .ghost { fill: none; stroke: #A9B6C8; stroke-width: 3; stroke-dasharray: 6 6; stroke-linecap: round; }
.pic .hot { fill: rgba(194,85,63,.22); stroke: var(--coral); stroke-width: 3; transform-box: fill-box; transform-origin: center; }
.pic .hot-ln { fill: none; stroke: var(--coral); stroke-width: 4; stroke-linecap: round; stroke-linejoin: round; }
.pic .ray { fill: none; stroke: var(--teal-bright); stroke-width: 3; stroke-linecap: round; stroke-dasharray: 6 8; }
.pic .yel { fill: #F4D35E; stroke: #C99A1E; stroke-width: 2; }
.pic .drop { fill: rgba(79,209,217,.5); stroke: var(--teal); stroke-width: 2; }
.pic .cloud { fill: #E6ECF2; stroke: #B9C6D4; stroke-width: 2; transform-box: fill-box; transform-origin: center; }
.pic .cloud2 { fill: #FFFFFF; opacity: .85; }
@media (prefers-reduced-motion: no-preference) {
  .pic .ln, .pic .hot-ln { animation: draw 1.8s var(--ease) both; }
  .pic .hot-ln { animation-delay: .9s; }
  .pic .soft, .pic .yel, .pic .drop, .pic .cloud2 { animation: fadeIn 1s ease .6s both; }
  .pic .ray { animation: flow 1.2s linear infinite; }
  .pic .hot { animation: pop .7s var(--ease) 1s both; }
  .pic .pulse { animation: pop .7s var(--ease) 1s both, beat 1.6s ease-in-out 1.8s infinite; }
}
@keyframes flow { to { stroke-dashoffset: -28; } }

/* Smart Value Point bar */
.svp { display: flex; flex-direction: column; gap: 8px; }
.svp-track { display: flex; height: 44px; border-radius: 12px; overflow: hidden; background: rgba(11,37,69,.08); }
.svp-full { flex: 0 0 72%; background: var(--teal); color: #fff; display: flex; align-items: center; padding-left: 14px; font-size: 13px; font-weight: 700; transform-origin: left; }
.svp-over { flex: 1; background: repeating-linear-gradient(45deg, #178D93 0 10px, #C2553F 10px 13px); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; transform-origin: left; }
.svp-over span, .svp-full span { text-shadow: 0 1px 2px rgba(11,37,69,.5); white-space: nowrap; }
.svp-labels { display: grid; grid-template-columns: 1fr auto 1fr; font-size: 12.5px; color: var(--ink-soft); }
.svp-labels span:nth-child(2) { text-align: center; color: var(--ink); }
.svp-labels span:last-child { text-align: right; }
@media (prefers-reduced-motion: no-preference) {
  .slide .svp-full, .slide .svp-over { transform: scaleX(0); }
  .is-active .svp-full { transform: scaleX(1); transition: transform 1.4s var(--ease) .4s; }
  .is-active .svp-over { transform: scaleX(1); transition: transform 1s var(--ease) 1.8s; }
}

/* Medical card benefit columns */
.mc-cols { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.mc-col { background: rgba(255,255,255,.06); border-radius: 14px; padding: 12px; display: flex; flex-direction: column; gap: 8px; min-width: 0; text-align: left; }
.mc-k { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; font-weight: 700; color: var(--teal-bright); }
.mc-row { background: var(--paper); color: var(--ink); border-radius: 10px; padding: 9px 12px; }
.mc-row b { display: block; font-size: 14px; }
.mc-row em { font-style: normal; display: block; font-weight: 700; color: var(--teal); font-size: 13.5px; margin-top: 2px; }
.mc-row span { display: block; font-size: 12.5px; color: var(--ink-soft); }
@media (prefers-reduced-motion: no-preference) {
  .is-active .mc-row { animation: rise .55s var(--ease) both; }
  .is-active .mc-col .mc-row:nth-child(2) { animation-delay: .4s; } .is-active .mc-col .mc-row:nth-child(3) { animation-delay: .5s; }
  .is-active .mc-col .mc-row:nth-child(4) { animation-delay: .6s; } .is-active .mc-col .mc-row:nth-child(5) { animation-delay: .7s; }
  .is-active .mc-col .mc-row:nth-child(6) { animation-delay: .8s; } .is-active .mc-col .mc-row:nth-child(7) { animation-delay: .9s; }
  .is-active .mc-col .mc-row:nth-child(8) { animation-delay: 1s; }
}

/* Send answers */
.send-box { width: 100%; background: rgba(255,255,255,.8); border-radius: 14px; padding: 14px; display: flex; flex-direction: column; gap: 10px; text-align: left; }
.send-summary { font-size: 13.5px; line-height: 1.55; color: var(--ink); white-space: pre-line; }
.send-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.send-btn { font: 700 15px var(--sans); color: #fff; background: var(--teal); border: 0; border-radius: 999px; padding: 12px 20px; cursor: pointer; }
.send-btn:disabled { opacity: .55; cursor: default; }
.copy-btn { font: 600 14px var(--sans); color: var(--ink); background: var(--paper); border: 2px solid #C9D6E8; border-radius: 999px; padding: 10px 16px; cursor: pointer; }
.send-btn:focus-visible, .copy-btn:focus-visible { outline: 3px solid var(--ink); outline-offset: 2px; }
.send-status { font-size: 13.5px; line-height: 1.45; min-height: 1em; }
.send-status.ok { color: #0F6F74; font-weight: 700; }
.send-status.warn { color: #9A3F2D; font-weight: 600; }
.cover-for { font-family: var(--serif); font-style: italic; font-size: clamp(20px, 3.4vw, 26px); color: var(--ink); }
.cover-for b { font-style: normal; color: var(--teal); font-weight: 700; }

@media (max-width: 600px) {
  .mc-cols { grid-template-columns: 1fr; }
  .svp-full span { font-size: 11px; }
}


.photo { display: block; width: 100%; max-width: 520px; max-height: 46vh; object-fit: contain; margin: 8px auto 0; border-radius: 12px; background: #F3F7FB; }
@media (prefers-reduced-motion: no-preference) { .photo { animation: rise .6s var(--ease) both; } }
.credit { font-size: 11.5px !important; color: var(--ink-soft); text-align: center; margin-top: 4px !important; }


.step-k { font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: var(--mist-2); font-weight: 600; }
.limit-track { width: min(420px, 100%); height: 18px; border-radius: 999px; background: rgba(255,255,255,.1); overflow: hidden; display: flex; }
.limit-base { width: 55%; background: var(--teal-bright); }
.limit-boost { width: 45%; background: var(--gold); transform-origin: left; }
@media (prefers-reduced-motion: no-preference) {
  .slide .limit-boost { transform: scaleX(0); }
  .is-active .limit-boost { transform: scaleX(1); transition: transform 1.4s var(--ease) 1s; }
}
.limit-labels { width: min(420px, 100%); display: flex; justify-content: space-between; font-size: 13px; color: var(--mist); }


/* Fix: tall scenes start at the top instead of clipping above the screen */
.slide { justify-content: flex-start; }
.slide > .inner { margin-block: auto; }

/* Savings jar */
.jar-glass { fill: rgba(238,243,248,.12); stroke: #0B2545; stroke-width: 3; }
.jar-lid { fill: #C9D6E8; stroke: #0B2545; stroke-width: 3; }
.jar-shine { stroke: #FFFFFF; stroke-width: 4; stroke-linecap: round; opacity: .8; }
.jar-fill { fill: rgba(212,162,58,.28); }
.jar-stack ellipse { fill: #D4A23A; stroke: #A87D22; stroke-width: 1.5; }
.jar-cap { stroke: var(--coral); stroke-width: 2; stroke-dasharray: 4 4; opacity: 0; }
@media (prefers-reduced-motion: no-preference) {
  .is-active .jar-fill { animation: jarRise 3.2s var(--ease) .6s both; }
  .is-active .jar-stack ellipse { animation: pop .5s var(--ease) both; transform-box: fill-box; transform-origin: center; }
  .is-active .jar-stack ellipse:nth-child(1) { animation-delay: .9s; } .is-active .jar-stack ellipse:nth-child(4) { animation-delay: 1.2s; }
  .is-active .jar-stack ellipse:nth-child(2) { animation-delay: 1.6s; } .is-active .jar-stack ellipse:nth-child(5) { animation-delay: 2s; }
  .is-active .jar-stack ellipse:nth-child(3) { animation-delay: 2.4s; }
  .is-active .jar-cap { animation: fadeIn .6s ease 3.4s both; }
}
@keyframes jarRise { from { transform: translateY(44px); } to { transform: none; } }

/* Tabarru' fund network */
.net-line { stroke: rgba(79,209,217,.6); stroke-width: 2; stroke-dasharray: 4 5; fill: none; }
.net-out { stroke: var(--gold); stroke-width: 3; stroke-dasharray: 5 5; fill: none; opacity: 0; }
.node circle, .node path { fill: none; stroke: var(--teal-bright); stroke-width: 2.5; stroke-linecap: round; }
.node.help circle, .node.help path { stroke: var(--gold); stroke-width: 3; }
.node { transform-box: fill-box; transform-origin: center; }
.fund-coin { fill: var(--gold); stroke: #F2D08A; stroke-width: 2; transform-box: fill-box; transform-origin: center; }
.fund-ring { fill: none; stroke: var(--gold); stroke-width: 2; transform-box: fill-box; transform-origin: center; opacity: 0; }
.fund-mark { fill: none; stroke: #0B2545; stroke-width: 2.4; stroke-linecap: round; }
@media (prefers-reduced-motion: no-preference) {
  .is-active .node { animation: pop .6s var(--ease) both; }
  .is-active .net-line { animation: fadeIn .6s ease 1s both, flowIn 1.2s linear 1s infinite; }
  .is-active .fund-coin { animation: pop .7s var(--ease) .9s both, beat 1.8s ease-in-out 2s infinite; }
  .is-active .fund-ring { animation: ripple 2.2s ease-out 1.6s infinite; }
  .is-active .net-out { animation: fadeIn .5s ease 2.4s both, flowIn 1s linear 2.4s infinite; }
  .is-active .node.help { animation: pop .6s var(--ease) .6s both, helpGlow 1.8s ease-in-out 2.8s infinite; }
}
@keyframes flowIn { to { stroke-dashoffset: -18; } }
@keyframes ripple { 0% { transform: scale(1); opacity: .8; } 100% { transform: scale(2.6); opacity: 0; } }
@keyframes helpGlow { 0%, 100% { filter: none; } 50% { filter: drop-shadow(0 0 6px rgba(212,162,58,.9)); } }

/* Photo backgrounds on journey scenes */
.slide.photo-bg { background: var(--night); }
.slide.photo-bg::before { content: ""; position: absolute; inset: 0; background-image: var(--bg); background-size: cover; background-position: center; transform: scale(1.06); }
.slide.photo-bg::after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(11,37,69,.72) 0%, rgba(11,37,69,.82) 45%, rgba(11,37,69,.94) 100%); }
.slide.photo-bg > .inner { position: relative; z-index: 1; }
@media (prefers-reduced-motion: no-preference) {
  .slide.photo-bg.is-active::before { animation: kenburns 14s ease-out both; }
}
@keyframes kenburns { from { transform: scale(1.18) translateY(-1.5%); } to { transform: scale(1.04); } }


/* AnugerahMax additions */
.bars5 { grid-template-columns: repeat(5, minmax(0, 1fr)); }
.bars6 { grid-template-columns: repeat(6, minmax(0, 1fr)); }
.bar-pair { gap: 4px; }
.bar.thin { width: 40%; }
.bar.gold { background: var(--gold); }
.legend { display: flex; gap: 16px; flex-wrap: wrap; font-size: 13px; color: var(--ink-soft); }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; vertical-align: -1px; }
.limit-base.half, .limit-boost.half { width: 50%; }
.tl4 .tl-points { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.mc-btn { font: inherit; text-align: left; border: 2px solid transparent; cursor: pointer; position: relative; width: 100%; }
.mc-btn b { padding-right: 64px; }
.mc-btn .more { position: absolute; top: 9px; right: 10px; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--teal); background: #E3F4F5; border-radius: 999px; padding: 3px 9px; }
.mc-btn:hover { border-color: #9ED3D6; }
.mc-btn:focus-visible { outline: 3px solid var(--teal-bright); outline-offset: 2px; }
.cover-art { width: 110px; }

/* Growth chart */
.chart { width: 100%; height: auto; overflow: visible; }
.chart .grid { stroke: rgba(11,37,69,.08); stroke-width: 1; }
.chart .axis { fill: var(--ink-soft); font-size: 15px; font-family: var(--sans); }
.chart .lineY { fill: none; stroke: var(--ink); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.chart .lineX { fill: none; stroke: var(--teal); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.chart .areaY { fill: rgba(11,37,69,.06); }
.chart .peak { fill: var(--gold); stroke: #fff; stroke-width: 2; }
.chart .peak-t { font-size: 16px; font-weight: 700; fill: var(--ink); font-family: var(--sans); }
@media (prefers-reduced-motion: no-preference) {
  .is-active .chart .lineY, .is-active .chart .lineX { animation: draw 2.6s var(--ease) both; }
  .is-active .chart .lineX { animation-delay: .4s; }
  .is-active .chart .areaY { animation: fadeIn 1.5s ease 1.4s both; }
  .is-active .chart .peak, .is-active .chart .peak-t { animation: fadeIn .6s ease 2.6s both; }
}
.scen { display: flex; gap: 10px; flex-wrap: wrap; }
.scen div { background: var(--paper); border-radius: 10px; padding: 10px 14px; font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
.scen i { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
@media (max-width: 600px) {
  .tl4 .tl-points { grid-template-columns: repeat(2, minmax(0, 1fr)); row-gap: 18px; }
  .tl4 .tl-line, .tl4 .tl-fill { display: none; }
}


/* Option comparison table */
.cmp-wrap { overflow-x: auto; border-radius: 14px; background: var(--paper); box-shadow: 0 8px 24px rgba(11,37,69,.08); }
.cmp { width: 100%; min-width: 560px; border-collapse: collapse; font-size: 13.5px; line-height: 1.4; color: var(--ink); }
.cmp th, .cmp td { text-align: left; padding: 8px 12px; vertical-align: top; border-bottom: 1px solid #E6EDF5; }
.cmp thead th { font-family: var(--serif); font-size: 18px; font-weight: 700; background: #F3F7FB; position: sticky; top: 0; }
.cmp thead th span { display: block; font-family: var(--sans); font-size: 12px; font-weight: 600; color: var(--ink-soft); }
.cmp thead th.o2 { background: var(--night); color: #fff; }
.cmp thead th.o2 span { color: var(--teal-bright); }
.cmp td:first-child { width: 34%; font-weight: 600; }
.cmp td:nth-child(2) { width: 30%; color: var(--ink-soft); }
.cmp td:nth-child(3) { background: rgba(23,141,147,.05); }
.cmp td.none { color: #A3AEBF; font-style: italic; }
.cmp tr.grp td { background: #EEF3F8; font-size: 11px; letter-spacing: .12em; text-transform: uppercase; font-weight: 700; color: var(--teal); padding: 6px 12px; }
.tag { font-style: normal; display: inline-block; font-size: 10.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; border-radius: 999px; padding: 2px 7px; margin-left: 4px; vertical-align: 1px; white-space: nowrap; }
.tag.up { background: #E3F4F5; color: #0F6F74; }
.tag.new { background: #FBF1DC; color: #8A6412; }
.tag.down { background: #FBEDE9; color: #9A3F2D; }
.tag.same { background: #EEF1F5; color: #5A6B85; }
@media (prefers-reduced-motion: no-preference) {
  .is-active .cmp tbody tr { animation: rise .5s var(--ease) both; }
  .is-active .cmp tbody tr:nth-child(n+2) { animation-delay: .35s; }
  .is-active .cmp tbody tr:nth-child(n+6) { animation-delay: .5s; }
  .is-active .cmp tbody tr:nth-child(n+10) { animation-delay: .65s; }
  .is-active .cmp tbody tr:nth-child(n+14) { animation-delay: .8s; }
  .is-active .cmp tbody tr:nth-child(n+18) { animation-delay: .95s; }
  .is-active .cmp tbody tr:nth-child(n+22) { animation-delay: 1.1s; }
  .is-active .tag.new, .is-active .tag.up { animation: pop .5s var(--ease) 1.3s both; }
}
.why { background: var(--night); color: #fff; border-radius: 16px; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
.why-k { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; font-weight: 700; color: var(--teal-bright); }
.why-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.why-c { background: rgba(255,255,255,.07); border-radius: 12px; padding: 12px; min-width: 0; }
.why-c b { display: block; font-family: var(--serif); font-size: 19px; color: #fff; margin-bottom: 4px; }
.why-c span { font-size: 13px; line-height: 1.45; color: var(--mist); }
.why-t { font-size: 13.5px; color: var(--mist); max-width: none; }
.why-t b { color: #F2A65A; }
@media (max-width: 600px) { .why-grid { grid-template-columns: 1fr; } .cmp { min-width: 0; font-size: 12px; } .cmp th, .cmp td { padding: 7px 7px; } .cmp thead th { font-size: 14px; } .cmp td:first-child { width: 30%; } .cmp td:nth-child(2) { width: 32%; } .tag { font-size: 9.5px; padding: 1px 5px; margin-left: 0; margin-top: 3px; } }


.form-link { display: inline-flex; align-items: center; gap: 10px; background: var(--gold); color: var(--ink); font: 700 16px var(--sans); text-decoration: none; border-radius: 999px; padding: 14px 24px; box-shadow: 0 10px 24px rgba(212,162,58,.35); }
.form-link:hover { filter: brightness(1.05); }
.form-link:focus-visible { outline: 3px solid var(--ink); outline-offset: 3px; }
@media (prefers-reduced-motion: no-preference) { .is-active .form-link { animation: pop .6s var(--ease) 1.2s both, ringGold 2.4s ease-in-out 2s infinite; } }
@keyframes ringGold { 0%, 100% { box-shadow: 0 10px 24px rgba(212,162,58,.35), 0 0 0 0 rgba(212,162,58,.45); } 50% { box-shadow: 0 10px 24px rgba(212,162,58,.35), 0 0 0 14px rgba(212,162,58,0); } }

/* Controls */
.chrome { position: absolute; left: 0; right: 0; bottom: 0; z-index: 5; display: flex; align-items: center; gap: 10px;
  padding-block: 12px calc(12px + env(safe-area-inset-bottom, 0px));
  padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); pointer-events: none; }
.chrome > * { pointer-events: auto; }
.nav { width: 44px; height: 44px; border-radius: 50%; border: 0; background: rgba(11,37,69,.85); color: #fff; font-size: 20px; cursor: pointer; display: grid; place-items: center; flex: none; }
.nav:disabled { opacity: .3; cursor: default; }
.nav:focus-visible, .notes-btn:focus-visible { outline: 3px solid var(--teal-bright); outline-offset: 2px; }
.notes-btn { height: 44px; border-radius: 999px; border: 0; padding: 0 14px; background: rgba(11,37,69,.85); color: #fff; font: 600 12px var(--sans); letter-spacing: .06em; text-transform: uppercase; cursor: pointer; flex: none; }
.progress { flex: 1; display: flex; gap: 4px; min-width: 0; }
.progress span { flex: 1; height: 4px; border-radius: 4px; background: rgba(11,37,69,.15); overflow: hidden; }
.progress span.on::after { content: ""; display: block; height: 100%; background: var(--teal); }
.night-chrome .progress span { background: rgba(255,255,255,.2); }
.night-chrome .nav, .night-chrome .notes-btn { background: rgba(255,255,255,.16); box-shadow: inset 0 0 0 1px rgba(255,255,255,.35); }
.night-chrome .progress span.on::after { background: var(--teal-bright); }
.counter { font-size: 12px; font-weight: 600; color: var(--ink-soft); font-variant-numeric: tabular-nums; min-width: 44px; text-align: right; }
.night-chrome .counter { color: var(--mist); }
.ribbon { position: absolute; top: calc(12px + env(safe-area-inset-top, 0px)); left: 50%; transform: translateX(-50%); z-index: 5; font-size: 11.5px; font-weight: 600; letter-spacing: .04em; background: rgba(255,255,255,.85); color: var(--ink); padding: 6px 12px; border-radius: 999px; white-space: nowrap; max-width: calc(100% - 32px); overflow: hidden; text-overflow: ellipsis; }

/* Presenter notes */
.notes { display: none; }
.notes-panel { position: absolute; z-index: 6; left: max(16px, env(safe-area-inset-left, 0px)); right: max(16px, env(safe-area-inset-right, 0px)); bottom: calc(76px + env(safe-area-inset-bottom, 0px)); margin-inline: auto; max-width: 760px; max-height: 45%; overflow-y: auto; background: #FFFDF6; color: var(--ink); border-radius: 14px; padding: 14px 16px; box-shadow: 0 16px 40px rgba(11,37,69,.28); font-size: 14px; line-height: 1.55; }
.notes-panel .nk { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; font-weight: 700; color: var(--coral); margin-bottom: 6px; }
.notes-panel p { color: var(--ink); font-size: 14px; margin-top: 6px; max-width: none; }

@keyframes draw { from { stroke-dashoffset: 1200; } to { stroke-dashoffset: 0; } }
@keyframes pop { from { transform: scale(0); opacity: 0; } to { transform: scale(1); opacity: 1; } }
@keyframes rise { from { transform: translateY(30px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes nudge { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(6px); } }
@keyframes beat { 0%, 100% { transform: scale(1); } 15% { transform: scale(1.25); } 30% { transform: scale(1); } 45% { transform: scale(1.18); } }
@keyframes coinFall { 0% { opacity: 0; transform: translateY(-26px); } 20% { opacity: 1; } 75% { opacity: 1; transform: translateY(34px); } 100% { opacity: 0; transform: translateY(40px); } }
@keyframes breathe { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
@keyframes startle { 0%, 100% { transform: rotate(0) scale(1); } 25% { transform: rotate(-6deg) scale(1.06); } 75% { transform: rotate(6deg) scale(1.06); } }
@keyframes ring { 0%, 100% { box-shadow: 0 0 0 0 rgba(23,141,147,.4); } 50% { box-shadow: 0 0 0 22px rgba(23,141,147,0); } }

@media (max-width: 600px) {
  .slide { padding-block: 56px 92px; }
  .donut-wrap, .pyr-wrap { grid-template-columns: 1fr; justify-items: center; }
  .split { width: 100%; }
  .options, .agenda, .qs { grid-template-columns: 1fr; }
  .glance { grid-template-columns: 1fr; }
  .glance.two { grid-template-columns: 1fr; }
  .bars { height: 190px; gap: 4px; }
  .bar-val { font-size: 10px; }
  .tl-pt .day { font-size: 18px; }
  .paths { gap: 10px; }
  .path { padding: 14px 10px; }
  .hrow { grid-template-columns: 92px minmax(0, 1fr) 52px; }
  .hrow .val { font-size: 19px; }
}
`;
      module.exports = { STORY_CSS };
    }
  });

  // renderer/story/storyRuntime.js
  var require_storyRuntime = __commonJS({
    "renderer/story/storyRuntime.js"(exports, module) {
      "use strict";
      function storyRuntime() {
        var cfg = JSON.parse(document.getElementById("story-data").textContent);
        var slides = [].slice.call(document.querySelectorAll(".slide"));
        var deck = document.getElementById("deck");
        var progress = document.getElementById("progress");
        var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        var index = 0;
        slides.forEach(function() {
          progress.appendChild(document.createElement("span"));
        });
        function prepLines(root) {
          root.querySelectorAll(".brand-mark .ring, .ecg path, .settled .check path, .done path, .cond-art .ln, .scene-art .ln").forEach(function(p) {
            p.setAttribute("pathLength", "1200");
            p.style.strokeDasharray = "1200";
          });
        }
        prepLines(document);
        (function people() {
          var g = document.getElementById("peopleGrid");
          if (!g) return;
          var lit = [0, 2, 4, 6, 8, 11, 13, 15, 17, 19, 1, 3, 5, 7, 9, 10, 12, 14, 16, 18].slice(0, cfg.peopleOn || 9);
          var out = "";
          for (var i = 0; i < 20; i++) {
            var x = 26 + i % 10 * 52, y = Math.floor(i / 10) * 60;
            out += '<g class="p' + (lit.indexOf(i) >= 0 ? " on" : "") + '" style="animation-delay:' + (0.2 + i * 0.05).toFixed(2) + 's"><circle cx="' + x + '" cy="' + (y + 14) + '" r="9"/><path d="M' + (x - 15) + " " + (y + 52) + ' q15 -36 30 0z"/></g>';
          }
          g.innerHTML = out;
        })();
        var C = 2 * Math.PI * 88;
        [].forEach.call(document.querySelectorAll(".donut .seg"), function(s) {
          s.style.strokeDasharray = Number(s.dataset.frac) * C + " " + C;
          s.style.strokeDashoffset = String(-Number(s.dataset.start) * C);
        });
        function sweepDonut(slide) {
          if (reduce || !slide.animate) return;
          [].forEach.call(slide.querySelectorAll(".donut .seg"), function(s, i) {
            if (!s.animate) return;
            s.animate(
              [{ strokeDasharray: "0 " + C }, { strokeDasharray: Number(s.dataset.frac) * C + " " + C }],
              { duration: 1300, delay: 300 + i * 250, easing: "cubic-bezier(.22,1,.36,1)", fill: "backwards" }
            );
          });
        }
        function countUp(slide) {
          if (reduce) return;
          [].forEach.call(slide.querySelectorAll("[data-count]"), function(el2) {
            var end = Number(el2.dataset.count);
            var prefix = el2.dataset.prefix || "";
            var suffix = el2.dataset.suffix || "";
            var small = el2.querySelector("small");
            var tail = small ? small.outerHTML : "";
            var finalVal = prefix + end.toLocaleString("en-MY") + suffix + tail;
            var start = performance.now();
            var dur = 1400;
            function tick(now) {
              var p = Math.min(1, (now - start) / dur);
              el2.innerHTML = prefix + Math.round(end * (1 - Math.pow(1 - p, 3))).toLocaleString("en-MY") + suffix + tail;
              if (p < 1) requestAnimationFrame(tick);
            }
            requestAnimationFrame(tick);
            setTimeout(function() {
              el2.innerHTML = finalVal;
            }, dur + 250);
          });
        }
        (function drawChart() {
          var svg = document.getElementById("growth");
          var sv = cfg.cashValue;
          if (!svg || !sv || !sv.points || sv.points.length < 2) return;
          var W = 640, H = 300, L = 74, R = 16, T = 28, B = 34;
          var pts = sv.points;
          var a0 = pts[0][0], a1 = pts[pts.length - 1][0];
          var peak = 0;
          pts.forEach(function(r) {
            peak = Math.max(peak, r[1], r[2]);
          });
          var step = Math.pow(10, Math.floor(Math.log10(Math.max(peak, 1))));
          var max = Math.ceil(peak / step) * step;
          if (max / step < 3) {
            step = step / 2;
            max = Math.ceil(peak / step) * step;
          }
          var x = function(age2) {
            return L + (age2 - a0) / Math.max(1, a1 - a0) * (W - L - R);
          };
          var y = function(v2) {
            return T + (1 - v2 / max) * (H - T - B);
          };
          var label = function(v2) {
            return v2 >= 1e6 ? "RM" + (v2 / 1e6).toLocaleString("en-MY") + "m" : v2 >= 1e3 ? "RM" + (v2 / 1e3).toLocaleString("en-MY") + "k" : v2 ? "RM" + v2 : "0";
          };
          var out = "";
          for (var v = 0; v <= max + 1; v += step) {
            out += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text class="axis" x="' + (L - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + label(v) + "</text>";
          }
          var ticks = 6;
          for (var t = 0; t <= ticks; t++) {
            var age = Math.round(a0 + (a1 - a0) * t / ticks);
            out += '<text class="axis" x="' + x(age) + '" y="' + (H - 10) + '" text-anchor="middle">' + sv.axisLabel + " " + age + "</text>";
          }
          var path = function(i) {
            return pts.map(function(r, k) {
              return (k ? "L" : "M") + x(r[0]).toFixed(1) + " " + y(r[i]).toFixed(1);
            }).join(" ");
          };
          out += '<path class="areaY" d="' + path(2) + " L" + x(a1) + " " + y(0) + " L" + x(a0) + " " + y(0) + 'Z"/>';
          out += '<path class="lineY" pathLength="1200" stroke-dasharray="1200" d="' + path(2) + '"/>';
          out += '<path class="lineX" pathLength="1200" stroke-dasharray="1200" d="' + path(1) + '"/>';
          (sv.peaks || []).forEach(function(pk) {
            out += '<circle class="peak" cx="' + x(pk[0]) + '" cy="' + y(pk[1]) + '" r="6"/><text class="peak-t" x="' + x(pk[0]) + '" y="' + (y(pk[1]) - 12) + '" text-anchor="middle">RM' + Number(pk[1]).toLocaleString("en-MY") + "</text>";
          });
          svg.innerHTML = out;
        })();
        var chosen = {};
        var order = [];
        var labels = {};
        var sayText = {};
        [].forEach.call(document.querySelectorAll(".chips[data-group]"), function(grp) {
          var key = grp.dataset.group;
          chosen[key] = grp.dataset.multi === "true" ? [] : "";
          order.push(key);
          labels[key] = grp.dataset.label || key;
          [].forEach.call(grp.querySelectorAll(".chip[data-text]"), function(c) {
            sayText[c.dataset.val] = c.dataset.text;
          });
        });
        var limitInput = document.getElementById("mcLimit");
        var limitBox = document.getElementById("limitBox");
        if (limitInput) {
          chosen.mcLimit = "";
          labels.mcLimit = "Medical card limit";
        }
        function list(v) {
          return Array.isArray(v) ? v : v ? [v] : [];
        }
        function hasCard() {
          var ex = document.querySelector('.chips[data-group="ex"]');
          return !!ex && !!ex.querySelector('.chip[data-card][aria-pressed="true"]');
        }
        function summaryLines() {
          var out = [];
          order.forEach(function(key) {
            var vals = list(chosen[key]);
            if (vals.length) out.push(labels[key] + ": " + vals.join(", "));
            if (key === "ex" && limitInput && hasCard() && chosen.mcLimit) out.push("Medical card limit: RM" + Number(chosen.mcLimit).toLocaleString("en-MY"));
          });
          return out;
        }
        function renderSaid() {
          var txt = "";
          var pri = list(chosen.pri);
          if (pri.length) txt += "You said what matters most: <b>" + pri.map(function(v) {
            return sayText[v] || v;
          }).join(", ") + "</b>.";
          if (chosen.bud) txt += (txt ? " " : "") + "Comfortable monthly amount: <b>" + chosen.bud + "</b>.";
          [].forEach.call(document.querySelectorAll("[data-said]"), function(el2) {
            el2.innerHTML = txt || el2.dataset.said;
          });
          var lines = summaryLines();
          var box = document.getElementById("sendSummary");
          if (box) box.textContent = lines.length ? "For " + cfg.client + "\n" + lines.join("\n") : "No answers yet. Tap your answers on the earlier screens.";
          if (limitBox) limitBox.hidden = !hasCard();
        }
        [].forEach.call(document.querySelectorAll(".chips[data-group]"), function(grp) {
          var multi = grp.dataset.multi === "true";
          var key = grp.dataset.group;
          grp.addEventListener("click", function(e) {
            var chip = e.target.closest(".chip");
            if (!chip) return;
            e.stopPropagation();
            var on = chip.getAttribute("aria-pressed") !== "true";
            [].forEach.call(grp.querySelectorAll(".chip"), function(c) {
              if (!multi || on && c.hasAttribute("data-alone") !== chip.hasAttribute("data-alone")) c.setAttribute("aria-pressed", "false");
            });
            chip.setAttribute("aria-pressed", String(on));
            var sel = [].map.call(grp.querySelectorAll('.chip[aria-pressed="true"]'), function(c) {
              return c.dataset.val;
            });
            chosen[key] = multi ? sel : sel[0] || "";
            renderSaid();
            queueSave();
          });
        });
        if (limitInput) limitInput.addEventListener("input", function() {
          chosen.mcLimit = limitInput.value.replace(/[^\d]/g, "").slice(0, 9);
          renderSaid();
          queueSave();
        });
        var sendStatus = document.getElementById("sendStatus");
        var copyBtn = document.getElementById("copyBtn");
        function setStatus(msg, kind) {
          if (sendStatus) {
            sendStatus.textContent = msg;
            sendStatus.className = "send-status" + (kind ? " " + kind : "");
          }
        }
        function newId() {
          if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
          return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0;
            return (c === "x" ? r : r & 3 | 8).toString(16);
          });
        }
        var sendId = newId();
        var saveTimer = null;
        var lastSaved = "";
        function payload() {
          var answers = {};
          Object.keys(chosen).forEach(function(k) {
            if (k === "mcLimit" && !hasCard()) return;
            var v = chosen[k];
            if (Array.isArray(v) ? v.length : v) answers[k] = v;
          });
          return { client: cfg.client, source: cfg.source, agentCode: cfg.agentFormCode || void 0, vbId: cfg.vbId || void 0, sendId, answers, summary: summaryLines() };
        }
        function saveNow(keepalive) {
          clearTimeout(saveTimer);
          var body = payload();
          if (!body.summary.length) return;
          var text = JSON.stringify(body);
          if (text === lastSaved) return;
          setStatus("Saving\u2026");
          fetch(cfg.portal, { method: "POST", headers: { "Content-Type": "text/plain" }, credentials: "omit", keepalive: !!keepalive, body: text }).then(function(res) {
            return res.json().catch(function() {
              return {};
            }).then(function(data) {
              return { ok: res.ok, status: res.status, data };
            });
          }).then(function(r) {
            if (r.ok && r.data.success) {
              lastSaved = text;
              setStatus("\u2713 Saved for " + cfg.agentShort, "ok");
              if (copyBtn) copyBtn.hidden = true;
            } else if (r.status === 409) {
              sendId = newId();
              lastSaved = "";
              saveNow();
            } else {
              setStatus(r.status === 400 && r.data.error ? r.data.error : "Could not save right now. Tap Copy answers, then paste them to " + cfg.agentShort + " on WhatsApp.", "warn");
              if (copyBtn) copyBtn.hidden = false;
            }
          }).catch(function() {
            setStatus("Could not save right now. Tap Copy answers, then paste them to " + cfg.agentShort + " on WhatsApp.", "warn");
            if (copyBtn) copyBtn.hidden = false;
          });
        }
        function queueSave() {
          clearTimeout(saveTimer);
          saveTimer = setTimeout(saveNow, 2e3);
        }
        document.addEventListener("visibilitychange", function() {
          if (document.visibilityState === "hidden" && saveTimer) saveNow(true);
        });
        if (copyBtn) copyBtn.addEventListener("click", function(e) {
          e.stopPropagation();
          var lines = summaryLines();
          var text = "For " + cfg.client + "\n" + (lines.length ? lines.join("\n") : "No answers yet");
          var fallback = function() {
            var r = document.createRange();
            r.selectNodeContents(document.getElementById("sendSummary"));
            var s = window.getSelection();
            s.removeAllRanges();
            s.addRange(r);
            setStatus("Answers selected. Copy them with your keyboard or the share menu.", "");
          };
          try {
            navigator.clipboard.writeText(text).then(function() {
              setStatus("Answers copied.", "ok");
            }, fallback);
          } catch (err) {
            fallback();
          }
        });
        var sheet = document.getElementById("sheet");
        var sheetBg = document.getElementById("sheetBg");
        var sheetBody = document.getElementById("sheetBody");
        var lastFocus = null;
        function openSheet(id, from) {
          var tpl = document.getElementById(id);
          if (!tpl) return;
          sheetBody.innerHTML = "";
          sheetBody.appendChild(tpl.content.cloneNode(true));
          lastFocus = from || null;
          sheet.hidden = false;
          sheetBg.hidden = false;
          sheet.scrollTop = 0;
          document.getElementById("sheetX").focus();
        }
        function closeSheet() {
          if (sheet.hidden) return;
          sheet.hidden = true;
          sheetBg.hidden = true;
          sheetBody.innerHTML = "";
          if (lastFocus) lastFocus.focus();
        }
        [].forEach.call(document.querySelectorAll("[data-sheet]"), function(b) {
          b.addEventListener("click", function(e) {
            e.stopPropagation();
            openSheet("sheet-" + b.dataset.sheet, b);
          });
        });
        document.getElementById("sheetX").addEventListener("click", function(e) {
          e.stopPropagation();
          closeSheet();
        });
        sheetBg.addEventListener("click", function(e) {
          e.stopPropagation();
          closeSheet();
        });
        sheet.addEventListener("click", function(e) {
          e.stopPropagation();
        });
        var panel = document.getElementById("notesPanel");
        var notesBody = document.getElementById("notesBody");
        var notesBtn = document.getElementById("notesBtn");
        function renderNotes() {
          var n = slides[index].querySelector(".notes");
          notesBody.innerHTML = n ? n.innerHTML : "<p>No notes for this screen.</p>";
        }
        function toggleNotes() {
          if (!panel || !notesBtn) return;
          panel.hidden = !panel.hidden;
          notesBtn.setAttribute("aria-pressed", String(!panel.hidden));
          renderNotes();
        }
        if (notesBtn) notesBtn.addEventListener("click", function(e) {
          e.stopPropagation();
          toggleNotes();
        });
        if (panel) panel.addEventListener("click", function(e) {
          e.stopPropagation();
        });
        function show(i) {
          index = Math.max(0, Math.min(slides.length - 1, i));
          slides.forEach(function(s, k) {
            s.classList.toggle("is-active", k === index);
            s.classList.toggle("is-past", k < index);
          });
          var cur = slides[index];
          countUp(cur);
          if (cur.querySelector(".donut")) sweepDonut(cur);
          [].forEach.call(progress.children, function(p, k) {
            p.classList.toggle("on", k <= index);
          });
          document.getElementById("counter").textContent = index + 1 + " / " + slides.length;
          document.getElementById("prev").disabled = index === 0;
          document.getElementById("next").disabled = index === slides.length - 1;
          document.getElementById("chrome").classList.toggle("night-chrome", cur.classList.contains("night"));
          document.getElementById("ribbon").hidden = index > 0;
          if (panel && !panel.hidden) renderNotes();
        }
        var INTERACTIVE = "button, a, input, label, .chips, .form-card, .send-box, .sheet, .sheet-bg, .cmp-wrap";
        document.getElementById("prev").addEventListener("click", function(e) {
          e.stopPropagation();
          show(index - 1);
        });
        document.getElementById("next").addEventListener("click", function(e) {
          e.stopPropagation();
          show(index + 1);
        });
        deck.addEventListener("click", function(e) {
          if (e.target.closest(INTERACTIVE) || !sheet.hidden) return;
          show(e.clientX < window.innerWidth * 0.3 ? index - 1 : index + 1);
        });
        document.addEventListener("keydown", function(e) {
          if (e.target.closest && e.target.closest("input, textarea")) return;
          if (e.key === "Escape") {
            closeSheet();
            return;
          }
          if (!sheet.hidden) return;
          if (["ArrowRight", "PageDown", " "].indexOf(e.key) >= 0) {
            e.preventDefault();
            show(index + 1);
          }
          if (["ArrowLeft", "PageUp"].indexOf(e.key) >= 0) {
            e.preventDefault();
            show(index - 1);
          }
          if (e.key === "n" || e.key === "N") toggleNotes();
        });
        var sx = null;
        deck.addEventListener("touchstart", function(e) {
          sx = e.target.closest(INTERACTIVE) || !sheet.hidden ? null : e.touches[0].clientX;
        }, { passive: true });
        deck.addEventListener("touchend", function(e) {
          if (sx == null) return;
          var dx = e.changedTouches[0].clientX - sx;
          sx = null;
          if (Math.abs(dx) > 50) {
            e.preventDefault();
            show(index + (dx < 0 ? 1 : -1));
          }
        });
        renderSaid();
        show(0);
      }
      var STORY_RUNTIME_JS = `(${storyRuntime.toString()})();`;
      module.exports = { STORY_RUNTIME_JS };
    }
  });

  // renderer/story/storyModel.js
  var require_storyModel = __commonJS({
    "renderer/story/storyModel.js"(exports, module) {
      "use strict";
      var { formatDateLong } = require_formatters();
      var MALAY_PREFIXES = /* @__PURE__ */ new Set(["muhammad", "muhamad", "mohammad", "mohamad", "mohamed", "mohd", "mohd.", "md", "md.", "ahmad", "abdul", "abd", "nur", "nurul", "siti", "wan", "nik", "tengku", "syed", "sharifah", "che", "puteri", "raja", "megat", "noor", "nor"]);
      function titleCase(s) {
        return String(s || "").toLowerCase().replace(/(^|[\s'-])([a-z])/g, (m, p, c) => p + c.toUpperCase()).replace(/\bBin\b/g, "Bin").replace(/\bBinti\b/g, "Binti");
      }
      function callName(fullName) {
        const words = titleCase(fullName).split(/\s+/).filter(Boolean);
        const cut = words.findIndex((w) => /^(bin|binti|bt|b\.|a\/l|a\/p)$/i.test(w));
        const given = cut > 0 ? words.slice(0, cut) : words;
        let i = 0;
        while (i < given.length - 1 && MALAY_PREFIXES.has(given[i].toLowerCase())) i++;
        return given[i] || words[0] || "";
      }
      function firstAmount(value) {
        if (!value) return null;
        const m = String(value).match(/RM\s*([\d,]+(?:\.\d+)?)/);
        return m ? Number(m[1].replace(/,/g, "")) : null;
      }
      function money(v) {
        if (typeof v === "number") return Number.isFinite(v) ? v : null;
        return firstAmount(v);
      }
      function findItem(items, re) {
        return (items || []).find((it) => re.test(it.label || "")) || null;
      }
      function coPayInfo(raw) {
        const s = String(raw || "").trim();
        if (!s || /^none$/i.test(s)) return { label: null, amount: null, kind: "none" };
        const amount = money(s.replace(/^[^\d]*/, "RM"));
        if (/smart\s*saver/i.test(s)) return { label: s.replace(/\s+/g, ""), amount, kind: "smartsaver" };
        if (/deductible/i.test(s)) return { label: s, amount, kind: "deductible" };
        return { label: s, amount, kind: "other" };
      }
      function sortedWaiting(list) {
        const seen = /* @__PURE__ */ new Set();
        return (list || []).filter((w) => w && Number.isFinite(w.days) && w.days > 0).sort((a, b) => a.days - b.days).filter((w) => {
          const key = `${w.days}|${w.description}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }
      function buildStoryModel(data, product) {
        const d = data || {};
        const meta = d.metadata || {};
        const client = d.client || {};
        const contributions = d.contributions || {};
        const medical = d.medical || {};
        const protection = d.protection || {};
        const plan = d.plan || d.basicPlan || {};
        const parent = client.parent && client.parent.fullName ? client.parent : null;
        const isChild = !!parent || Number.isFinite(client.ageNextBirthday) && client.ageNextBirthday <= 17;
        const unborn = isChild && (!client.fullName || /^child$/i.test(String(client.fullName).trim()));
        const fullName = unborn ? "" : titleCase(client.fullName || "");
        const parentName = parent ? titleCase(parent.fullName) : "";
        const monthly = Number.isFinite(contributions.totalMonthlyContribution) ? contributions.totalMonthlyContribution : Number.isFinite(d.monthlyTotalAmountPayable) ? d.monthlyTotalAmountPayable : null;
        const annual = Number.isFinite(contributions.totalAnnualContribution) ? contributions.totalAnnualContribution : Number.isFinite(d.totalAnnualContribution) ? d.totalAnnualContribution : monthly != null ? monthly * 12 : null;
        const term = plan.basicPlanTerm || protection.basicPlanTerm || null;
        const coverageToAge = medical.coverageToAge || plan.coverageToAge || null;
        const totalOverTerm = Number.isFinite(contributions.totalContributionOverTerm) ? contributions.totalContributionOverTerm : null;
        const items = medical.benefitItems || [];
        const value = (re) => {
          const it = findItem(items, re);
          return it ? it.value : null;
        };
        const amount = (re) => firstAmount(value(re));
        const annualLimit = money(medical.annualLimit);
        const lifetimeFund = Number.isFinite(medical.lifetimeFundAmount) ? medical.lifetimeFundAmount : null;
        const room = medical.roomAndBoard || {};
        const tierMatch = String(medical.planName || "").match(/(\d{2,4})\s*$/);
        const cv = protection.cashValue || {};
        let cashPoints = null;
        if (Array.isArray(cv.schedule) && cv.schedule.length >= 3) {
          cashPoints = cv.schedule.filter((r) => Number.isFinite(r.year) && Number.isFinite(r.cashValueScenarioX) && Number.isFinite(r.cashValueScenarioY)).map((r) => [r.year, r.cashValueScenarioX, r.cashValueScenarioY]);
        }
        const lastRow = cashPoints && cashPoints.length ? cashPoints[cashPoints.length - 1] : null;
        const cashAtEnd = {
          x: Number.isFinite(cv.scenarioX) ? cv.scenarioX : lastRow ? lastRow[1] : null,
          y: Number.isFinite(cv.scenarioY) ? cv.scenarioY : lastRow ? lastRow[2] : null
        };
        const projection = d.projection && Array.isArray(d.projection.projectionRows) ? d.projection.projectionRows.filter((r) => Number.isFinite(r.age) && Number.isFinite(r.currentContribution)) : [];
        const breakdown = [];
        if (monthly != null && Number.isFinite(contributions.medicTotalCareContribution)) {
          breakdown.push({ key: "medical", amount: contributions.medicTotalCareContribution });
          if (Number.isFinite(contributions.isaContribution)) breakdown.push({ key: "basic", amount: contributions.isaContribution });
          if (Number.isFinite(contributions.wakalahCertificateCharge)) breakdown.push({ key: "wakalah", amount: contributions.wakalahCertificateCharge });
          const rest = Math.round((monthly - breakdown.reduce((s, b) => s + b.amount, 0)) * 100) / 100;
          if (rest > 0.5) breakdown.push({ key: "riders", amount: rest });
          if (rest < -0.5) breakdown.length = 0;
        }
        return {
          product,
          productName: meta.productName || product.name,
          quoteDateIso: meta.quotationDate && meta.quotationDate.iso,
          quoteDate: meta.quotationDate && meta.quotationDate.iso ? formatDateLong(meta.quotationDate.iso) : null,
          version: meta.quotationVersion || null,
          agentCode: d.agent && d.agent.agentCode,
          agentNameOnDocument: d.agent && d.agent.agentNameOnDocument,
          isChild,
          unborn,
          fullName,
          callName: unborn ? "" : callName(fullName),
          parentName,
          parentCallName: parentName ? callName(parentName) : "",
          gender: client.gender || null,
          age: Number.isFinite(client.ageNextBirthday) ? client.ageNextBirthday : null,
          smoker: client.smokerStatus || null,
          occupationClass: client.occupationClass || null,
          monthly,
          annual,
          term,
          coverageToAge,
          totalOverTerm,
          breakdown,
          medical: {
            riderName: medical.riderName || null,
            planName: medical.planName || null,
            tier: tierMatch ? tierMatch[1] : medical.planTier || null,
            model: medical.coverageModel || (lifetimeFund ? "LIFETIME_MEDICAL_FUND" : annualLimit ? "ANNUAL_LIMIT" : null),
            annualLimit,
            lifetimeFund,
            lifetimeLimitText: medical.lifetimeLimit || null,
            coShare: medical.costSharingAfterExhaustion || null,
            roomRate: Number.isFinite(room.amount) ? room.amount : amount(/room\s*(&|and)\s*board/i),
            roomDays: Number.isFinite(room.maxDaysPerYear) ? room.maxDaysPerYear : null,
            roomUnlimited: /unlimited/i.test(value(/room\s*(&|and)\s*board/i) || ""),
            coPay: coPayInfo(medical.coPayment),
            contribution: Number.isFinite(medical.contribution) ? medical.contribution : null,
            outpatientCancer: amount(/outpatient cancer/i),
            extraLimit: amount(/additional annual limit/i),
            advancedTreatment: /advanced medical treatment/i.test(value(/outpatient cancer/i) || "") ? firstAmount((value(/outpatient cancer/i) || "").split(/advanced medical treatment/i)[1]) : null,
            dengue: amount(/dengue/i),
            childIllness: amount(/top child illness/i),
            parentAllowance: amount(/parents? allowance/i),
            govHospital: amount(/government hospital/i),
            accidentEmergency: value(/emergency outpatient.*accident/i),
            homeNursing: value(/home nursing/i),
            lens: amount(/intraocular lens/i),
            vaccination: amount(/vaccination/i),
            secondOpinion: amount(/second medical opinion/i) || firstAmount((value(/dengue/i) || "").split(/second medical opinion/i)[1] || ""),
            worldwide: /yes/i.test(value(/worldwide/i) || ""),
            postHospDays: (String(value(/post-?hospitali[sz]ation/i) || "").match(/within (\d+) days/i) || [])[1] || null,
            preHospDays: (String(value(/pre-?hospitali[sz]ation/i) || "").match(/within (\d+) days/i) || [])[1] || null,
            waiting: sortedWaiting(medical.waitingPeriods)
          },
          protection: {
            sumCovered: protection.basicSumCovered || plan.basicSumCovered || null,
            death: protection.deathBenefit && Number.isFinite(protection.deathBenefit.amount) ? protection.deathBenefit.amount : null
          },
          cash: { points: cashPoints, atEnd: cashAtEnd },
          projection,
          inflationLow: d.projection ? d.projection.medicalInflationAssumptionLow : null,
          inflationHigh: d.projection ? d.projection.medicalInflationAssumptionHigh : null
        };
      }
      module.exports = { buildStoryModel, callName, titleCase, firstAmount };
    }
  });

  // renderer/story/products/anugerahmax.js
  var require_anugerahmax2 = __commonJS({
    "renderer/story/products/anugerahmax.js"(exports, module) {
      "use strict";
      module.exports = {
        id: "anugerahmax",
        name: "PruBSN AnugerahMax",
        match: (data) => /anugerahmax/i.test(data.metadata && data.metadata.productName || ""),
        productPage: "https://www.prubsn.com.my/en/protection/prubsn-anugerahmax/",
        breakdownLabels: {
          medical: { title: "Medic TotalCare", text: "Your medical card" },
          basic: { title: "AnugerahMax basic plan", text: "Death and total permanent disability cover" },
          wakalah: { title: "Wakalah certificate charge", text: "Certificate administration and service" },
          riders: { title: "Riders and add-ons", text: "Such as accident cover, as chosen in your quotation" }
        }
      };
    }
  });

  // renderer/story/products/asas360.js
  var require_asas3602 = __commonJS({
    "renderer/story/products/asas360.js"(exports, module) {
      "use strict";
      module.exports = {
        id: "asas360",
        name: "PruBSN Asas360",
        match: (data) => /asas\s*360/i.test(data.metadata && data.metadata.productName || ""),
        productPage: "https://www.prubsn.com.my/en/protection/prubsn-asas-360"
      };
    }
  });

  // renderer/story/products/generic.js
  var require_generic = __commonJS({
    "renderer/story/products/generic.js"(exports, module) {
      "use strict";
      module.exports = {
        id: "generic",
        name: "PruBSN takaful plan",
        match: () => false,
        productPage: "https://www.prubsn.com.my/en/",
        // Labels for the monthly breakdown donut (storyModel.js `breakdown` keys).
        breakdownLabels: {
          medical: { title: "Medical card", text: "Hospital and treatment bills" },
          basic: { title: "Basic plan", text: "Death and total permanent disability cover" },
          wakalah: { title: "Wakalah certificate charge", text: "Certificate administration and service" },
          riders: { title: "Riders and add-ons", text: "Extra protection chosen in your quotation" }
        }
      };
    }
  });

  // renderer/story/products/index.js
  var require_products = __commonJS({
    "renderer/story/products/index.js"(exports, module) {
      "use strict";
      var anugerahmax = require_anugerahmax2();
      var asas360 = require_asas3602();
      var generic = require_generic();
      var PRODUCTS = [anugerahmax, asas360];
      function productFor(data) {
        const found = PRODUCTS.find((p) => p.match(data || {}));
        return found ? { ...generic, ...found } : { ...generic, name: data && data.metadata && data.metadata.productName || generic.name };
      }
      module.exports = { PRODUCTS, productFor };
    }
  });

  // renderer/story/scenes.js
  var require_scenes = __commonJS({
    "renderer/story/scenes.js"(exports, module) {
      "use strict";
      var esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
      var fmt = (n) => Number(n).toLocaleString("en-MY", { maximumFractionDigits: 2 });
      var rm = (n) => n == null ? "" : `RM${fmt(n)}`;
      var rmShort = (n) => n >= 1e6 ? `RM${fmt(n / 1e6)}m` : n >= 1e3 ? `RM${fmt(n / 1e3)}k` : rm(n);
      var notes = (...ps) => `<div class="notes">${ps.filter(Boolean).map((p) => `<p>${p}</p>`).join("")}</div>`;
      var count = (n, prefix = "RM", suffix = "") => `data-count="${Math.round(n)}" data-prefix="${prefix}" data-suffix="${suffix}"`;
      function section(label, inner, { night = false, photo = null, center = false } = {}, notesHtml = "") {
        const cls = ["slide", night || photo ? "night" : "", photo ? "photo-bg" : ""].filter(Boolean).join(" ");
        const style = photo ? ` style="--bg:url(${esc(photo)})"` : "";
        return `<section class="${cls}" data-label="${esc(label)}"${style}><div class="inner${center ? " center" : ""}">${inner}</div>${notesHtml}</section>`;
      }
      function chips(group, label, options2, { multi = false, summary = label, extra = "" } = {}) {
        const id = `lbl-${group}`;
        return `<span class="chip-label" id="${id}">${esc(label)}</span>
<div class="chips" role="group" aria-labelledby="${id}" data-group="${group}" data-label="${esc(summary)}"${multi ? ' data-multi="true"' : ""}>${options2.map((o) => {
          const opt = typeof o === "string" ? { val: o } : o;
          return `<button class="chip" type="button" aria-pressed="false" data-val="${esc(opt.val)}"${opt.text ? ` data-text="${esc(opt.text)}"` : ""}${opt.alone ? " data-alone" : ""}${opt.card ? " data-card" : ""}>${esc(opt.label || opt.val)}</button>`;
        }).join("")}</div>${extra}`;
      }
      function limitOf(m) {
        if (m.medical.model === "LIFETIME_MEDICAL_FUND" && m.medical.lifetimeFund) {
          return { amount: m.medical.lifetimeFund, short: `${rm(m.medical.lifetimeFund)} medical fund`, long: `a ${rm(m.medical.lifetimeFund)} lifetime medical fund` };
        }
        if (m.medical.annualLimit) {
          return { amount: m.medical.annualLimit, short: `${rm(m.medical.annualLimit)} a year`, long: `up to ${rm(m.medical.annualLimit)} a year` };
        }
        return null;
      }
      function coPayLine(m) {
        const c = m.medical.coPay;
        if (c.kind === "smartsaver" && c.amount) return { you: `the first <span class="hl">${rm(c.amount)}</span>`, fine: `after the ${esc(c.label)} co-payment of ${rm(c.amount)} per disability` };
        if (c.kind === "deductible" && c.amount) return { you: `the <span class="hl">${rm(c.amount)}</span> deductible`, fine: `after the ${rm(c.amount)} deductible` };
        if (c.label) return { you: "the co-payment", fine: `after the ${esc(c.label)} co-payment` };
        return null;
      }
      function intro(m, ctx) {
        return section("Intro", `
<div class="brand">
  <svg class="brand-mark" viewBox="0 0 100 100" aria-hidden="true"><circle class="ring" cx="50" cy="50" r="40"/><path class="leaf" d="M50 26c12 10 14 26 0 40-14-14-12-30 0-40z"/></svg>
  <div class="eyebrow">${esc(ctx.agent.agency)}</div>
</div>
<div class="tagline rv d1">${esc(ctx.agent.tagline)}</div>
<div class="tap-hint rv d3">Tap to begin \u2192</div>`, { center: true }, notes("Keep this screen up while you say hello. Move on when they\u2019re relaxed.", "Press N or tap Notes any time to show or hide these notes."));
      }
      function cover(m, ctx) {
        const hon = m.gender === "Female" ? "Puan" : m.gender === "Male" ? "Encik" : "";
        let h1;
        let forLine;
        if (m.unborn) {
          h1 = `Protection ready <span class="hl">before day one</span>`;
          forLine = m.parentName ? `Tailor-made for <b>${esc(m.parentName)}</b> and her little one` : "Tailor-made for your little one";
        } else if (m.isChild) {
          h1 = `A takaful plan built around <span class="hl">${esc(m.callName)}</span>`;
          forLine = m.parentName ? `Tailor-made for <b>${esc(m.fullName)}</b>, prepared for ${esc(m.parentName)}` : `Tailor-made for <b>${esc(m.fullName)}</b>`;
        } else {
          h1 = `A takaful plan built around <span class="hl">${esc(m.callName)}</span>`;
          forLine = `Tailor-made for <b>${esc([hon, m.fullName].filter(Boolean).join(" "))}</b>`;
        }
        const facts = [
          m.age != null && !m.unborn ? `${m.age} next birthday` : null,
          m.occupationClass && !m.isChild ? `Occupation ${m.occupationClass.toLowerCase()}` : null,
          m.quoteDate ? `Quotation dated ${m.quoteDate}` : null
        ].filter(Boolean).join(" \xB7 ");
        return section("Cover", `
<svg class="cond-art" viewBox="0 0 160 170" aria-hidden="true">
  <path class="soft" d="M80 10 l62 24 v44 c0 42 -28 68 -62 82 c-34 -14 -62 -40 -62 -82 v-44z"/>
  <path class="ln" d="M80 10 l62 24 v44 c0 42 -28 68 -62 82 c-34 -14 -62 -40 -62 -82 v-44z"/>
  <circle class="ln" cx="80" cy="62" r="15"/>
  <path class="ln" d="M52 128 c0 -26 12 -42 28 -42 c16 0 28 16 28 42"/>
  <path class="gold pulse" d="M80 150 c-7 -5 -11 -9 -11 -13 c0 -3 2 -5 5 -5 c2 0 4 1 6 3 c2 -2 4 -3 6 -3 c3 0 5 2 5 5 c0 4 -4 8 -11 13z"/>
</svg>
<span class="badge rv">\u2605 ${esc(m.productName)}${m.medical.planName ? ` \xB7 ${esc(m.medical.planName)}` : ""}</span>
<h1 class="rv d1">${h1}</h1>
<div class="cover-for rv d2">${forLine}</div>
${facts ? `<p class="rv d2">${esc(facts)}</p>` : ""}
<div class="agent-line rv d3">Prepared by ${esc(ctx.agent.name)} \xB7 ${esc(ctx.agent.agency)}</div>`, { center: true }, notes("Set expectations: \u201CI\u2019ll share some real numbers and a short story, then I want to hear from you. After that we go through your plan step by step, and the decision is yours.\u201D"));
      }
      function agenda(m) {
        return section("Today", `
<div class="eyebrow rv">How we\u2019ll spend our time</div>
<h2 class="rv d1">Four parts, about 45 minutes</h2>
<div class="agenda">
  <div class="ag rv d2"><div class="n">1</div><div><b>What the numbers say</b><span>Protection in Malaysia and how fast medical costs are rising</span></div></div>
  <div class="ag rv d3"><div class="n">2</div><div><b>A tale of two paths</b><span>Same ${rm(m.monthly)} a month, two very different outcomes</span></div></div>
  <div class="ag rv d4"><div class="n">3</div><div><b>Your turn to talk</b><span>Your situation, your worries, your budget. I listen first.</span></div></div>
  <div class="ag rv d5"><div class="n">4</div><div><b>Your plan, step by step</b><span>Hospital, limits, costs and options</span></div></div>
</div>
<div class="promise rv d6"><b>My promise:</b> you decide. My job is to make the choice clear, including the limits.</div>`, {}, notes("Say: \u201CIf anything doesn\u2019t fit your situation, stop me. This is a conversation, not a lecture.\u201D"));
      }
      function protectedStat() {
        return section("Who is protected", `
<div class="eyebrow rv">How many Malaysians are protected?</div>
<svg class="people rv d1" viewBox="0 0 520 120" role="img" aria-label="20 figures, 9 highlighted: about 45 percent insured"><g id="peopleGrid"></g></svg>
<div class="kb-fig num rv d2" ${count(45, "~", "%")}>~45%</div>
<h2 class="rv d3">of Malaysians are insured, counting takaful. <span class="hl">More than half are not.</span></h2>
<div class="glance two" style="width:100%">
  <div class="tile rv d4"><div class="k">No protection at all</div><div class="v num" ${count(30, "", "%")}>30%</div><div class="s">of working Malaysians aged 25 to 40</div><div class="src">Zurich Malaysia survey, 1,201 people, late 2021</div></div>
  <div class="tile rv d5"><div class="k">Takaful penetration</div><div class="v num">19.6%</div><div class="s">of Malaysians, takaful only, 2025</div><div class="src">Malaysian Takaful Association, June 2026</div></div>
</div>
<p class="fine rv d6">~45%: LIAM CEO Mark O\u2019Dell, April 2024. Less than half of workers have a company group plan (LIAM, Budget 2026 proposals), and group cover usually ends when the job ends.</p>`, { night: true, center: true }, notes("Ask before revealing: \u201COut of every 10 Malaysians, how many do you think have life insurance or family takaful?\u201D", "Accuracy: 45% is a spoken estimate from LIAM\u2019s CEO, not an official BNM statistic."));
      }
      function underinsured() {
        return section("Underinsured", `
<div class="eyebrow rv">Covered is not the same as enough</div>
<h2 class="rv d1">Most insured families are <span class="hl">underinsured</span></h2>
<div class="under rv d2">
  <div class="under-track" aria-hidden="true"><div class="under-fill"></div></div>
  <div class="under-labels"><span>Out of 100 insured families\u2026</span><span class="num"><b>94 to 98</b> don\u2019t have enough cover</span></div>
</div>
<div class="glance two">
  <div class="tile navy rv d3"><div class="k">Chance of being underinsured</div><div class="v num">94\u201398%</div><div class="s">for an insured Malaysian family</div></div>
  <div class="tile rv d4"><div class="k">Average shortfall</div><div class="v num">RM100k\u2013150k</div><div class="s">per family member</div></div>
</div>
<p class="fine rv d5">Source: Underinsurance Study by Universiti Kebangsaan Malaysia and the Life Insurance Association of Malaysia (2012/13), cited by Bank Negara Malaysia. It is still the main national study on underinsurance; medical costs have risen sharply since.</p>`, {}, notes("Key message: having a policy doesn\u2019t mean enough protection.", "Be upfront about the date: it\u2019s the latest big national study, and costs have risen since."));
      }
      function inflation() {
        return section("Medical inflation", `
<div class="eyebrow rv">Medical inflation, projected for 2026</div>
<h2 class="rv d1">Malaysia\u2019s medical costs are rising <span class="hl">faster than the world\u2019s</span></h2>
<div class="hbars rv d2" aria-label="Medical trend rate 2026: Malaysia 16 percent, Asia Pacific 11.3 percent, global 10.3 percent">
  <div class="hrow"><span class="lbl">Malaysia</span><div class="htrack"><div class="hbar hi" style="width:100%"></div></div><span class="val num">16%</span></div>
  <div class="hrow"><span class="lbl">Asia Pacific</span><div class="htrack"><div class="hbar" style="width:70.6%"></div></div><span class="val num">11.3%</span></div>
  <div class="hrow"><span class="lbl">Global</span><div class="htrack"><div class="hbar lo" style="width:64.4%"></div></div><span class="val num">10.3%</span></div>
</div>
<p class="rv d3">Malaysia held at 15% for three years. 2026 is projected to be the highest since 2021.</p>
<p class="fine rv d4">Medical trend rate = yearly rise in medical cost per insured person. Malaysia and Asia Pacific: Aon Global Medical Trend Rates Report 2026. Global: WTW Global Medical Trends Survey 2026.</p>`, {}, notes("If they mention the government\u2019s much lower figure (DOSM health inflation about 3% in 2025): that measures prices of a basket of health items; the medical trend rate measures total cost per insured patient. Both are true."));
      }
      function yourMedicalCost(m) {
        const rows = m.projection;
        if (rows.length < 3) return "";
        const high = (r) => r.projected10pct || r.projected7pct || r.currentContribution;
        const max = Math.max(...rows.map(high));
        const pct = (v) => `${Math.max(4, v / max * 100).toFixed(1)}%`;
        const who = m.unborn ? "your child" : m.callName;
        return section("Your medical cost", `
<div class="eyebrow rv">From your own quotation</div>
<h2 class="rv d1">Medical cost keeps rising. Will savings keep up${who ? `, <span class="hl">${esc(who)}</span>` : ""}?</h2>
<p class="rv d2">Your quotation projects the yearly cost of the medical plan if medical inflation continues.</p>
<div class="bars bars5 rv d3" aria-label="Projected yearly medical plan contribution by age">
${rows.slice(0, 6).map((r) => `<div class="bar-col"><div class="bar-val num">${rm(high(r))}</div><div class="bar-pair">${r.projected7pct ? `<div class="bar thin" style="height:${pct(r.projected7pct)}"></div><div class="bar thin hi" style="height:${pct(high(r))}"></div>` : `<div class="bar thin" style="height:${pct(r.currentContribution)}"></div>`}</div><div class="bar-age">Age ${r.age}</div></div>`).join("")}
</div>
<div class="legend rv d4"><span><i style="background:var(--teal)"></i>${esc(m.inflationLow || 7)}% medical inflation</span><span><i style="background:var(--coral)"></i>${esc(m.inflationHigh || 10)}% medical inflation</span></div>
<p class="fine rv d5">Source: Takaful Contribution Projection Table for Medical Plan, PruBSN quotation${m.quoteDate ? ` dated ${esc(m.quoteDate)}` : ""}. Current cost ${rm(rows[0].currentContribution)} a year at age ${rows[0].age}. Values above the bars are the higher-inflation case. Illustration only.</p>`, {}, notes("This is their own quotation, not a generic number. Medical cost goes up whether or not they have a plan; the question is who pays it.", "Be honest that the plan\u2019s own medical charge rises too."));
      }
      function claims() {
        return section("Claims", `
<div class="eyebrow rv">Medical claims in Malaysia</div>
<h2 class="rv d1">Families are using their cover <span class="hl">more than ever</span></h2>
<div class="glance">
  <div class="tile rv d2"><div class="k">Medical claims, 2025</div><div class="v num">RM9.4 bil</div><div class="s">paid by life insurers, more than half of all their payouts</div><div class="src">LIAM Annual Report 2025</div></div>
  <div class="tile dark rv d3"><div class="k">In two years</div><div class="v num" ${count(56, "+", "%")}>+56%</div><div class="s">rise in medical claims, 2021 to 2023</div><div class="src">LIAM, PIAM and MTA, Nov 2024</div></div>
  <div class="tile rv d4"><div class="k">Takaful benefits, 2025</div><div class="v num">RM10.6 bil</div><div class="s">paid by the takaful industry</div><div class="src">Malaysian Takaful Association, June 2026</div></div>
</div>
<p class="rv d5">Behind each ringgit is a family that didn\u2019t have to pay that bill alone.</p>`, { night: true }, notes("Share a real claim story of your own here. Short and real.", "Accuracy: RM10.6 bil is all takaful benefits, not just medical."));
      }
      function twoPaths(m) {
        const lim = limitOf(m);
        if (m.monthly == null || !lim) return "";
        return section("Two paths", `
<div class="eyebrow rv">Two paths, ${rm(m.monthly)} a month</div>
<h2 class="rv d1">Same money, two choices. What happens when life doesn\u2019t wait?</h2>
<div class="paths">
  <div class="path bank rv d2">
    <div class="path-k">Path A</div>
    <div class="path-t">${rm(m.monthly)}/month \u2192 Savings jar</div>
    <svg viewBox="0 0 200 160" aria-hidden="true">
      <defs><clipPath id="jarClip"><path d="M70 52 h60 q8 0 8 10 v68 q0 14 -14 14 h-48 q-14 0 -14 -14 v-68 q0 -10 8 -10z"/></clipPath></defs>
      <circle class="coin" cx="100" cy="10" r="6"/><circle class="coin c2" cx="92" cy="10" r="6"/><circle class="coin c3" cx="108" cy="10" r="6"/>
      <g clip-path="url(#jarClip)"><rect class="jar-fill" x="56" y="104" width="90" height="44"/><g class="jar-stack"><ellipse cx="86" cy="136" rx="12" ry="4"/><ellipse cx="86" cy="130" rx="12" ry="4"/><ellipse cx="86" cy="124" rx="12" ry="4"/><ellipse cx="112" cy="136" rx="12" ry="4"/><ellipse cx="112" cy="130" rx="12" ry="4"/></g></g>
      <path class="jar-glass" d="M70 52 h60 q8 0 8 10 v68 q0 14 -14 14 h-48 q-14 0 -14 -14 v-68 q0 -10 8 -10z"/><rect class="jar-lid" x="74" y="40" width="52" height="12" rx="4"/><path class="jar-shine" d="M76 64 v54"/><path class="jar-cap" d="M52 104 h96"/>
    </svg>
    <div class="cap">After one year: <b>${rm(m.annual)}</b> in the jar. Your protection is capped at what you saved.</div>
  </div>
  <div class="path fund rv d3">
    <div class="path-k">Path B</div>
    <div class="path-t">${rm(m.monthly)}/month \u2192 Tabarru\u2019 fund</div>
    <svg viewBox="0 0 200 160" aria-hidden="true">
      <g class="net"><path class="net-line" d="M100 22 L100 80"/><path class="net-line" d="M141 39 L100 80"/><path class="net-line" d="M158 80 L100 80"/><path class="net-line" d="M141 121 L100 80"/><path class="net-line" d="M59 121 L100 80"/><path class="net-line" d="M42 80 L100 80"/><path class="net-line" d="M59 39 L100 80"/><path class="net-out" d="M100 80 L100 136"/></g>
      <g class="nodes">${[[100, 16, 0.2], [141, 33, 0.3], [158, 74, 0.4], [141, 115, 0.5], [100, 134, 0.6, 1], [59, 115, 0.7], [42, 74, 0.8], [59, 33, 0.9]].map(([x, y, dl, help]) => `<g class="node${help ? " help" : ""}" style="animation-delay:${dl}s"><circle cx="${x}" cy="${y}" r="${help ? 5.5 : 4.5}"/><path d="M${x - 7} ${y + 14} q7 -12 14 0"/></g>`).join("")}</g>
      <circle class="fund-ring" cx="100" cy="80" r="17"/><circle class="fund-coin" cx="100" cy="80" r="17"/><path class="fund-mark" d="M104 72 q-4 -3 -8 0 q-4 4 4 7 q8 3 4 7 q-4 3 -8 0 M100 68 v24"/>
    </svg>
    <div class="cap">Your contribution joins a <b>Tabarru\u2019 fund</b> shared by many families. When one family needs help, the fund pays, here with a medical card of <b>${esc(lim.long)}</b>.</div>
  </div>
</div>
<p class="fine rv d4">Illustration only. ${rm(m.monthly)} is your quoted monthly contribution. The medical card figure is from your quotation, subject to certificate terms.</p>`, {}, notes(`Ask: \u201CAfter one year, Path A has about ${rm(m.annual)} saved. Feels good, right? Now let\u2019s see what happens.\u201D`));
      }
      function moment(m, ctx) {
        const bill = m.isChild ? 3e4 : 6e4;
        return section("The moment", `
<svg class="alarm-fig" viewBox="0 0 120 120" aria-hidden="true"><circle class="body" cx="60" cy="34" r="14"/><path class="body" d="M30 104 q30 -60 60 0"/><path class="body" d="M22 40 l-12 -8 M98 40 l12 -8 M60 6 v-6"/></svg>
<div class="eyebrow rv d1">${m.isChild ? "One year later, a fever that won\u2019t come down" : "One year later, an accident on the way to work"}</div>
<svg class="ecg rv d1" viewBox="0 0 520 80" aria-hidden="true"><path d="M0 40 h150 l14 -26 l16 54 l16 -64 l14 36 h40 l12 -16 l12 16 h242"/></svg>
<h2 class="rv d2">The hospital needs</h2>
<div class="big-red num rv d3" ${count(bill)}>${rm(bill)}</div>
<p class="rv d4">Illustrative bill for a private hospital stay${m.isChild ? " with tests and treatment" : " with surgery"}.</p>`, { photo: ctx.photo(m.isChild ? "child-ward1" : "adult-ward1"), center: true }, notes("Pause after the number. Don\u2019t add drama; let it land."));
      }
      function pathA(m) {
        if (m.annual == null) return "";
        const bill = m.isChild ? 3e4 : 6e4;
        return section("Path A", `
<div class="eyebrow rv" style="color:var(--coral)">Path A: saved in the jar</div>
<h2 class="rv d1">${rm(m.annual)} saved. ${rm(bill)} needed. The gap has to come from somewhere.</h2>
<div class="steps">
  <div class="step rv d2"><div class="n">1</div><div><b>Use all the savings</b><span>${rm(m.annual)} gone in one admission. Still ${rm(bill - m.annual)} short.</span></div></div>
  <div class="step rv d3"><div class="n">2</div><div><b>Sell what you can</b><span>The car, the motorcycle, gold, often below their worth.</span></div></div>
  <div class="step rv d4"><div class="n">3</div><div><b>Ask family and friends</b><span>During the hardest week of your life.</span></div></div>
  <div class="step worst rv d5"><div class="n">4</div><div><b>Still short? Borrow</b><span>A personal loan or credit card, repaid with interest for years.</span></div></div>
</div>`, {}, notes("Ask: \u201CWhich of these steps would be hardest for you?\u201D Listen. Don\u2019t answer for them."));
      }
      function pathB(m) {
        const lim = limitOf(m);
        if (!lim) return "";
        const cp = coPayLine(m);
        const who = m.isChild ? "You" : esc(m.callName || "You");
        return section("Path B", `
<div class="eyebrow rv">Path B: protected by takaful</div>
<h2 class="rv d1">${cp ? `${who} pay${m.isChild || !m.callName ? "" : "s"} ${cp.you}.` : "The medical card steps in."}</h2>
<div class="settled rv d2">
  <svg class="check" viewBox="0 0 72 72" aria-hidden="true"><circle cx="36" cy="36" r="36"/><path d="M22 37 l10 10 l19 -21"/></svg>
  <div class="fig">The medical card pays the rest of the eligible bill.</div>
  <div>Cashless at PruBSN panel hospitals. No selling, no borrowing, no asking.</div>
</div>
<p class="fine rv d3">Illustration only. ${esc(m.medical.planName || "The medical card")} pays eligible charges ${esc(lim.long)}${cp ? ` ${cp.fine}` : ""}, subject to exclusions, waiting periods and certificate terms.</p>`, {}, notes("Be exact: \u201Celigible charges\u201D, and mention the co-payment or deductible in the same breath. That honesty is what makes you different."));
      }
      function doBoth(m) {
        if (m.monthly == null) return "";
        const total = Math.max(500, Math.ceil(m.monthly * 2.2 / 100) * 100);
        const save = total - m.monthly;
        const f = (m.monthly / total).toFixed(4);
        return section("Do both", `
<div class="eyebrow rv">The smart move</div>
<h2 class="rv d1">The best plan isn\u2019t A or B. <span class="hl">It\u2019s both.</span></h2>
<div class="donut-wrap">
  <div class="donut rv d2">
    <svg viewBox="0 0 220 220" aria-hidden="true"><circle class="track" cx="110" cy="110" r="88"/><circle class="seg" cx="110" cy="110" r="88" stroke="#0B2545" data-frac="${f}" data-start="0"/><circle class="seg" cx="110" cy="110" r="88" stroke="#D4A23A" data-frac="${(1 - f).toFixed(4)}" data-start="${f}"/></svg>
    <div class="donut-total"><span class="k">Per month</span><span class="v num" ${count(total)}>${rm(total)}</span></div>
  </div>
  <div class="split">
    <div class="split-row rv d3"><i style="background:#0B2545"></i><div><b class="num">${rm(m.monthly)} \xB7 Protection first</b><span>Example: this plan</span></div></div>
    <div class="split-row rv d4"><i style="background:#D4A23A"></i><div><b class="num">${rm(save)} \xB7 Emergency savings</b><span>About ${rm(Math.round(save * 12 / 100) * 100)} after a year, for co-payments and daily costs</span></div></div>
    <div class="split-row rv d5"><i style="background:#178D93"></i><div><b>Protect the big risks, save for the small ones</b><span>Takaful handles what savings can\u2019t. Savings handle what takaful doesn\u2019t.</span></div></div>
  </div>
</div>`, {}, notes(`You\u2019re not against saving; you\u2019re showing the order. ${rm(total)} is an example; adjust live to what they set aside.`));
      }
      function pyramid() {
        const tiers = [["g0", "t0", "20,410 580,410 528,336 72,336", "lt", 381, 24, "Protection"], ["g1", "t1", "76,330 524,330 472,256 128,256", "lt", 301, 22, "Emergency fund"], ["g2", "t2", "132,250 468,250 416,176 184,176", "dk", 221, 20, "Savings &amp; goals"], ["g3", "t3", "188,170 412,170 360,96 240,96", "dk", 141, 19, "Investment"], ["g4", "t4", "244,90 356,90 300,16", "dk", 76, 15, "Legacy"]];
        return section("Financial pyramid", `
<div class="eyebrow rv">How to build family wealth</div>
<h2 class="rv d1">Every strong pyramid starts with <span class="hl">protection</span></h2>
<div class="pyr-wrap">
  <svg class="pyramid rv d2" viewBox="0 0 600 420" role="img" aria-label="Financial pyramid, from the base up: protection, emergency fund, savings and goals, investment, legacy">${tiers.map(([g, t, pts, c, y, fs, txt]) => `<g class="tier ${g}"><polygon class="${t}" points="${pts}"/><text class="${c}" x="300" y="${y}" font-size="${fs}">${txt}</text></g>`).join("")}</svg>
  <div class="split">
    <div class="split-row rv d3"><i style="background:#D4A23A"></i><div><b>Legacy</b><span>Hibah and wasiat, so wealth passes on smoothly</span></div></div>
    <div class="split-row rv d3"><i style="background:#A7D9DB"></i><div><b>Investment</b><span>Grow wealth once the base is safe</span></div></div>
    <div class="split-row rv d4"><i style="background:#5FB7BB"></i><div><b>Savings &amp; goals</b><span>A home, education, Hajj</span></div></div>
    <div class="split-row rv d4"><i style="background:#178D93"></i><div><b>Emergency fund</b><span>3 to 6 months of expenses</span></div></div>
    <div class="split-row rv d5"><i style="background:#0B2545"></i><div><b>Protection</b><span>Medical, life and critical illness cover</span></div></div>
  </div>
</div>
<div class="rule rv d6"><b>A simple guide:</b> keep protection to about 10% of monthly income, so it protects your lifestyle without taking it over.</div>`, {}, notes("If the base breaks (a big hospital bill), every layer above it falls with it, exactly like Path A.", "The 10% line is a guiding principle, not a regulation. Say it as your advice.", "Then: \u201CNow I\u2019d like to hear from you.\u201D"));
      }
      function aboutYou(m) {
        const ex = chips("ex", m.isChild ? "What protection does the family have today? Choose any." : "What protection do you have today? Choose any.", [
          { val: "Medical card", card: true },
          { val: "Company group medical", card: true },
          "Life cover",
          "Critical illness",
          { val: "None yet", alone: true }
        ], { multi: true, summary: "Protection today" });
        const limitBox = `<div class="limit-box" id="limitBox" hidden>
  <label class="field" for="mcLimit"><span>Medical card limit (RM)</span><input id="mcLimit" type="text" inputmode="numeric" maxlength="9" placeholder="e.g. 100000"></label>
  ${chips("lt", "Is that limit\u2026", [{ val: "Annual limit", label: "Per year" }, { val: "Lifetime limit", label: "For life" }, "Not sure"], { summary: "Limit type" })}
</div>`;
        const second = m.isChild ? chips("hosp", "If your child is admitted, which hospital would you choose?", ["Private hospital", "Government hospital", "Not sure yet"], { summary: "Preferred hospital" }) + chips("dep", "Who else depends on the family income? Choose any.", ["Parents", "Other children", { val: "No one else", alone: true }], { multi: true, summary: "Also depends on the income" }) : chips("commute", "How do you usually travel to work?", ["Car", "Motorcycle", "Public transport", { val: "Mostly work from home", label: "Mostly from home" }], { summary: "Travels to work by" }) + chips("dep", "Who depends on your income? Choose any.", ["Parents", "Spouse", "Children", { val: "No one yet", alone: true }], { multi: true, summary: "Depends on the income" });
        return section("About you", `
<div class="eyebrow rv">Your turn \xB7 about you</div>
<h2 class="rv d1">Tell me a little about your situation</h2>
<div class="form-card rv d2">${ex}${limitBox}</div>
<div class="form-card rv d3">${second}</div>`, {}, notes("Let them tap the answers themselves. If they have a medical card, ask for its limit and whether it resets every year or is for life.", "Health questions on the proposal must be answered accurately; PruBSN decides the underwriting."));
      }
      function budgetBands(monthly) {
        const base = Math.max(100, Math.floor((monthly || 200) / 100) * 100);
        const lo = Math.max(100, base - 100);
        return [`RM${lo}\u2013${lo + 100}`, `RM${lo + 100}\u2013${lo + 200}`, `RM${lo + 200}\u2013${lo + 300}`, `RM${lo + 300}+`];
      }
      function whatMatters(m, ctx) {
        const pri = m.isChild ? [["A big hospital bill", "a big hospital bill"], ["Serious illness like cancer", "serious illness like cancer"], ["Common childhood illness (fever, dengue, HFMD)", "common childhood illness"], ["Medical costs rising every year", "medical costs rising every year"], ["Savings for their future", "savings for their future"]] : [["A big hospital bill", "a big hospital bill"], ["Cancer, heart attack or kidney failure", "cancer, heart attack or kidney failure"], ["Accidents on the road", "accidents on the road"], ["Medical costs rising every year", "medical costs rising every year"], ["Leaving debt for my family", "leaving debt for my family"]];
        return section("What matters", `
<div class="eyebrow rv">Your turn \xB7 what matters most</div>
<h2 class="rv d1">Tap what matters to you</h2>
<div class="chip-group rv d2">${chips("pri", "Biggest worries (choose any)", pri.map(([val, text]) => ({ val, text })), { multi: true, summary: "Biggest worries" })}</div>
<div class="chip-group rv d3">${chips("bud", "Monthly amount you can keep up long term", budgetBands(m.monthly), { summary: "Monthly budget" })}</div>
<div class="said rv d4" data-said="Your choices show here and on the options screen.">Your choices show here and on the options screen.</div>
<p class="fine rv d5">Your answers are saved for ${esc(ctx.agent.short)} as you tap, so the plan can be prepared around them.</p>`, {}, notes("Hand them the phone or tablet and let them tap. Then ask: \u201CIf you were admitted tomorrow, where would the money come from?\u201D"));
      }
      function contributionDonut(m) {
        if (!m.breakdown.length || m.monthly == null) return "";
        const colours = { medical: "#0B2545", basic: "#178D93", riders: "#C2553F", wakalah: "#D4A23A" };
        const labels = m.product.breakdownLabels || {};
        let start = 0;
        const segs = m.breakdown.map((b) => {
          const frac = b.amount / m.monthly;
          const s = `<circle class="seg" cx="110" cy="110" r="88" stroke="${colours[b.key]}" data-frac="${frac.toFixed(4)}" data-start="${start.toFixed(4)}"/>`;
          start += frac;
          return s;
        }).join("");
        const lim = limitOf(m);
        const rows = m.breakdown.map((b, i) => {
          const l = labels[b.key] || { title: b.key, text: "" };
          let text = l.text;
          if (b.key === "medical" && lim) text = `${l.text}: ${lim.short}`;
          if (b.key === "basic" && m.protection.death) text = `${rm(m.protection.death)} on death or total permanent disability`;
          return `<div class="split-row rv d${3 + Math.floor(i / 2)}"><i style="background:${colours[b.key]}"></i><div><b class="num">${rm(b.amount)} \xB7 ${esc(l.title)}</b><span>${esc(text)}</span></div></div>`;
        }).join("");
        return section(`Your ${rm(m.monthly)}`, `
<div class="eyebrow rv">How your contribution works</div>
<h2 class="rv d1">${rm(m.monthly)} a month, <span class="hl">${m.breakdown.length} jobs</span></h2>
<div class="donut-wrap">
  <div class="donut rv d2"><svg viewBox="0 0 220 220" aria-hidden="true"><circle class="track" cx="110" cy="110" r="88"/>${segs}</svg><div class="donut-total"><span class="k">Total / month</span><span class="v num" ${count(m.monthly)}>${rm(m.monthly)}</span></div></div>
  <div class="split">${rows}</div>
</div>
<p class="fine rv d6">From your PruBSN quotation${m.quoteDate ? ` dated ${esc(m.quoteDate)}` : ""}: ${rm(m.annual)} a year${m.term ? ` for ${m.term} years` : ""}${m.coverageToAge ? `, until age ${m.coverageToAge}` : ""}. Contributions go into your Individual Special Account (ISA), which pays the monthly Tabarru\u2019 and charges.</p>`, {}, notes("Most of the contribution is usually the medical card. Point out what each part does."));
      }
      function admitted(m, ctx) {
        const lim = limitOf(m);
        if (!lim) return "";
        const tail = m.medical.model === "LIFETIME_MEDICAL_FUND" ? `Once the fund is used, eligible claims continue${m.medical.coShare ? ` with PruBSN paying ${m.medical.coShare.insurerPct}% and you ${m.medical.coShare.clientPct}%` : ""}.` : /no lifetime limit/i.test(m.medical.lifetimeLimitText || "") ? "No lifetime limit." : "";
        return section("Admitted", `
<svg class="scene-art" viewBox="0 0 280 200" aria-hidden="true"><rect class="soft" x="60" y="70" width="160" height="110" rx="6"/><path class="ln" d="M40 180 h200 M60 180 v-110 l80 -44 l80 44 v110 M120 180 v-40 h40 v40"/><path class="ln" d="M140 74 v32 M124 90 h32"/><circle class="gold pulse" cx="140" cy="90" r="5"/></svg>
<div class="step-k rv d1">${esc(m.medical.riderName || "Medical card")} \xB7 Step 1 \xB7 ${m.isChild ? "Your child is admitted" : "You\u2019re admitted"}</div>
<h2 class="rv d2">The moment ${m.isChild ? "your child is" : "you\u2019re"} admitted, your <span class="hl">${esc(lim.short)}</span> starts working.</h2>
<p class="rv d3">${esc(tail)} Cashless at PruBSN panel hospitals.</p>`, { photo: ctx.photo("lobby"), center: true }, notes("Walk through this like a story: \u201CImagine you\u2019re admitted next year.\u201D Then go step by step."));
      }
      function room(m, ctx) {
        if (!m.medical.roomRate) return "";
        const days = m.medical.roomDays ? `up to <span class="hl">${m.medical.roomDays} days</span> a year` : m.medical.roomUnlimited ? 'with <span class="hl">no limit on days</span>' : "";
        return section("The room", `
<svg class="scene-art" viewBox="0 0 280 200" aria-hidden="true"><rect class="soft" x="50" y="110" width="180" height="40" rx="8"/><path class="ln" d="M40 170 v-80 M40 130 h200 v40 M50 110 h180 a10 10 0 0 1 10 10 M60 110 a14 14 0 0 1 28 0"/><path class="ln" d="M220 40 v50 M206 54 h28"/><circle class="gold" cx="220" cy="40" r="6"/></svg>
<div class="kb-fig num rv d1" ${count(m.medical.roomRate)}>${rm(m.medical.roomRate)}<small>/day</small></div>
<div class="step-k rv d2">Step 2 \xB7 ${m.isChild ? "The room" : "Your room"}</div>
<h2 class="rv d3">Hospital room and board${days ? `, ${days}` : ""}.</h2>
<p class="rv d4">ICU and CCU are covered as charged. A more expensive room means paying the difference.</p>`, { photo: ctx.photo(m.isChild ? "child-ward2" : "adult-ward2"), center: true }, notes(`${rm(m.medical.roomRate)} a day is the room the plan pays for.`));
      }
      function treatment(m, ctx) {
        const pre = m.medical.preHospDays;
        const post = m.medical.postHospDays;
        const around = pre || post ? ` Tests and treatment${pre ? ` ${pre} days before` : ""}${pre && post ? " and" : ""}${post ? ` ${post} days after` : ""} the stay, and day surgery.` : " Day surgery too.";
        return section("Treatment", `
<svg class="scene-art" viewBox="0 0 280 200" aria-hidden="true"><ellipse class="soft" cx="140" cy="60" rx="70" ry="22"/><path class="ln" d="M140 10 v28 M70 60 a70 22 0 0 0 140 0 a70 22 0 0 0 -140 0"/><path class="ln" d="M20 150 h70 l12 -30 l16 56 l16 -70 l14 44 h112"/><circle class="gold pulse" cx="140" cy="60" r="7"/></svg>
<div class="step-k rv d1">Step 3 \xB7 Tests, treatment and surgery</div>
<h2 class="rv d2">Surgery and in-hospital treatment are covered <span class="hl">as charged</span>.</h2>
<p class="rv d3">Specialist visits and related hospital services too.${esc(around)}</p>`, { photo: ctx.photo("theatre"), center: true }, notes("\u201CAs charged\u201D means the actual reasonable bill for eligible treatment, within the plan\u2019s limit."));
      }
      function clinic(m, ctx) {
        const amt = m.medical.childIllness || m.medical.dengue;
        if (!amt) return "";
        const what = m.medical.childIllness ? "Dengue, HFMD and common childhood illnesses" : "Dengue, influenza, measles, chikungunya or HFMD";
        return section("At the clinic", `
<svg class="scene-art" viewBox="0 0 280 200" aria-hidden="true"><circle class="soft" cx="140" cy="158" r="20"/><path class="ln" d="M130 146 V40 a10 10 0 0 1 20 0 V146 a20 20 0 1 1 -20 0z"/><path class="ln" d="M150 60 h12 M150 80 h12 M150 100 h12 M150 120 h12"/><path class="ln" d="M140 150 V92"/><circle class="gold pulse" cx="140" cy="158" r="10"/><path class="ln" d="M60 70 q-14 20 0 40 M78 78 q-8 12 0 24 M220 70 q14 20 0 40 M202 78 q8 12 0 24"/></svg>
<div class="kb-fig num rv d1" ${count(amt)}>${rm(amt)}<small>/illness</small></div>
<div class="step-k rv d2">Step 4 \xB7 Treated at the clinic</div>
<h2 class="rv d3">${what}, treated <span class="hl">without admission</span>.</h2>
<p class="rv d4">Outpatient treatment up to ${rm(amt)} per illness${m.medical.parentAllowance ? `, plus ${rm(m.medical.parentAllowance)} a day parent allowance` : ""}.</p>`, { night: true, photo: m.isChild ? ctx.photo("clinic") : null, center: true }, notes("Most people don\u2019t know a medical card can pay for outpatient treatment of these illnesses.", "Check the certificate for the per-year limit on how many illnesses this covers."));
      }
      function serious(m, ctx) {
        const med = m.medical;
        if (!med.outpatientCancer && !med.extraLimit) return "";
        const h2 = med.extraLimit && med.annualLimit ? `Cancer, heart attack or kidney failure? Your yearly limit grows by <span class="hl">${rm(med.extraLimit)}</span>.` : `Cancer or kidney failure? Outpatient treatment up to <span class="hl">${rm(med.outpatientCancer)}</span>.`;
        const bar = med.extraLimit && med.annualLimit ? `<div class="limit-track rv d3" aria-hidden="true"><div class="limit-base" style="width:${(med.annualLimit / (med.annualLimit + med.extraLimit) * 100).toFixed(1)}%"></div><div class="limit-boost" style="width:${(med.extraLimit / (med.annualLimit + med.extraLimit) * 100).toFixed(1)}%"></div></div><div class="limit-labels rv d3"><span>${rm(med.annualLimit)} base</span><span>${rm(med.annualLimit + med.extraLimit)} a year</span></div>` : "";
        const extra = [
          med.extraLimit && med.outpatientCancer ? `Outpatient cancer treatment and kidney dialysis up to <b style="color:#FFFFFF">${rm(med.outpatientCancer)}</b> per lifetime.` : "",
          med.advancedTreatment ? `Advanced medical treatment up to ${rm(med.advancedTreatment)} per lifetime.` : "",
          med.secondOpinion ? `Second medical opinion up to ${rm(med.secondOpinion)} a year.` : ""
        ].filter(Boolean).join(" ");
        return section("If it\u2019s serious", `
<svg class="scene-art" viewBox="0 0 280 200" aria-hidden="true"><path class="soft" d="M140 20 l70 26 v50 c0 46 -32 74 -70 88 c-38 -14 -70 -42 -70 -88 v-50z"/><path class="ln" d="M140 20 l70 26 v50 c0 46 -32 74 -70 88 c-38 -14 -70 -42 -70 -88 v-50z"/><path class="ln" d="M140 72 v56 M112 100 h56"/><circle class="gold pulse" cx="140" cy="100" r="6"/></svg>
<div class="step-k rv d1">Step 5 \xB7 If it\u2019s serious</div>
<h2 class="rv d2">${h2}</h2>
${bar}
${extra ? `<p class="rv d4">${extra}</p>` : ""}`, { photo: ctx.photo("cancer"), center: true }, notes("Keep the tone calm and factual.", med.extraLimit ? "The extra limit applies after a first diagnosis and has a waiting period; check the certificate wording." : ""));
      }
      function alsoCovered(m) {
        const med = m.medical;
        const cells = [
          med.govHospital ? ["Government hospital", "Daily cash allowance", `${rm(med.govHospital)} a day`] : null,
          med.accidentEmergency ? ["Accident emergency", "Outpatient treatment after an accident", /as charged/i.test(med.accidentEmergency) ? "As charged" : (med.accidentEmergency.match(/RM[\d,]+[^()]*/) || [""])[0].trim()] : null,
          med.homeNursing ? ["Home nursing care", "After a hospital stay", /180 days/.test(med.homeNursing) ? "Up to 180 days per lifetime" : "Included"] : null,
          med.vaccination ? ["Vaccinations", "Such as Hajj/Umrah and flu", `${rm(med.vaccination)} a year`] : null,
          med.lens ? ["Intraocular lens", "For cataract surgery", `Up to ${rm(med.lens)} per lifetime`] : null,
          med.secondOpinion && !(med.outpatientCancer || med.extraLimit) ? ["Second opinion", "From another specialist", `${rm(med.secondOpinion)} a year`] : null,
          med.worldwide ? ["Worldwide emergency", "Medical assistance abroad", "Included"] : null
        ].filter((c) => c && c[2]).slice(0, 6);
        if (cells.length < 3) return "";
        return section("Also covered", `
<div class="eyebrow rv">Everything else it covers</div>
<h2 class="rv d1">Your medical card, in plain terms</h2>
<div class="cover-grid">${cells.map((c, i) => `<div class="cv rv d${2 + Math.floor(i / 2)}"><b>${esc(c[0])}</b><span>${esc(c[1])}</span><em>${esc(c[2])}</em></div>`).join("")}</div>
<p class="fine rv d5">${esc(med.planName || "Medical card")}${med.coPay.label ? `, ${esc(med.coPay.label)}` : ""}, from your PruBSN quotation${m.quoteDate ? ` dated ${esc(m.quoteDate)}` : ""}. Subject to waiting periods, exclusions and certificate terms.</p>`, {}, notes("Quick scene. Point to one or two items that fit them."));
      }
      function howLimitWorks(m) {
        const med = m.medical;
        const cp = coPayLine(m);
        if (med.model === "LIFETIME_MEDICAL_FUND" && med.lifetimeFund) {
          const share = med.coShare;
          return section("How the fund works", `
<div class="eyebrow rv">${esc(med.riderName || "Medical card")} \xB7 how the fund works</div>
<h2 class="rv d1">A <span class="hl">${rm(med.lifetimeFund)}</span> medical fund, and no hard stop</h2>
<div class="limit-track rv d2" aria-hidden="true"><div class="limit-base" style="width:70%"></div><div class="limit-boost" style="width:30%"></div></div>
<div class="limit-labels rv d2"><span>${rm(med.lifetimeFund)} fund pays first</span><span>${share ? `then ${share.insurerPct}% / ${share.clientPct}%` : "then shared"}</span></div>
<div class="split">
  <div class="split-row rv d3"><i style="background:#178D93"></i><div><b>The fund pays eligible bills first</b><span>Hospital stays, surgery and outpatient treatment covered by the plan draw from the ${rm(med.lifetimeFund)} fund.</span></div></div>
  ${share ? `<div class="split-row rv d4"><i style="background:#D4A23A"></i><div><b>After the fund is used, cover continues</b><span>PruBSN pays ${share.insurerPct}% and you pay ${share.clientPct}% of eligible claims, so a big illness doesn\u2019t end the cover.</span></div></div>` : ""}
  ${cp ? `<div class="split-row rv d5"><i style="background:#C2553F"></i><div><b>${esc(med.coPay.label)}</b><span>You pay ${cp.you.replace(/<[^>]+>/g, "")} before the plan pays, as set out in the certificate.</span></div></div>` : ""}
</div>
<p class="fine rv d6">${esc(med.lifetimeLimitText || "")}. From your PruBSN quotation${m.quoteDate ? ` dated ${esc(m.quoteDate)}` : ""}. Charges are not guaranteed and may change with notice.</p>`, {}, notes("Compare with what they told you about their current card."));
        }
        if (!med.annualLimit) return "";
        const boosted = med.extraLimit ? med.annualLimit + med.extraLimit : null;
        const max = boosted || med.annualLimit;
        const bar = (v, lbl, gold) => `<div class="bar-col"><div class="bar-val num">${rmShort(v)}</div><div class="bar-pair"><div class="bar${gold ? " gold" : ""}" style="height:${(v / max * 100).toFixed(1)}%"></div></div><div class="bar-age">${lbl}</div></div>`;
        const bars = boosted ? [bar(med.annualLimit, "Year 1"), bar(med.annualLimit, "Year 2"), bar(med.annualLimit, "Year 3"), bar(med.annualLimit, "Year 4"), bar(boosted, "After diagnosis*", true), bar(boosted, "Every year after", true)] : [1, 2, 3, 4, 5, 6].map((y) => bar(med.annualLimit, `Year ${y}`));
        return section("How the limit works", `
<div class="eyebrow rv">${esc(med.riderName || "Medical card")} \xB7 how the limit works</div>
<h2 class="rv d1">${rm(med.annualLimit)} every year${/no lifetime limit/i.test(med.lifetimeLimitText || "") ? ', and <span class="hl">no lifetime limit</span>' : ""}</h2>
<div class="bars bars6 rv d2" aria-label="Annual limit renewing every year">${bars.join("")}</div>
<div class="split">
  <div class="split-row rv d3"><i style="background:#178D93"></i><div><b>Renews every certificate year</b><span>Use it this year and it\u2019s back to ${rm(med.annualLimit)} next year.</span></div></div>
  ${cp ? `<div class="split-row rv d4"><i style="background:#D4A23A"></i><div><b>${esc(med.coPay.label)}</b><span>You pay ${cp.you.replace(/<[^>]+>/g, "")} per disability; some benefits are exempt, as listed in the certificate.</span></div></div>` : ""}
  <div class="split-row rv d5"><i style="background:#C2553F"></i><div><b>The plan\u2019s medical charge is not guaranteed</b><span>It can rise with age and medical inflation, with written notice.</span></div></div>
</div>
${boosted ? `<p class="fine rv d6">*An extra ${rm(med.extraLimit)} a year applies after a first diagnosis of cancer, heart attack or kidney failure, after its waiting period. From your PruBSN quotation.</p>` : ""}`, {}, notes("A lifetime limit gets used up; an annual limit comes back every year."));
      }
      function waiting(m) {
        const w = m.medical.waiting;
        if (!w.length) return "";
        const tidy = (s) => String(s || "").replace(/^after the effective date of the rider( or the date it is revived)?( for)?\s*/i, "").replace(/\s*\(if applicable\)\.?/gi, "").replace(/\.$/, "");
        const pts = [{ day: "Day 1", b: "Accidents", s: "Covered from the start." }];
        w.forEach((p) => {
          const text = tidy(p.description);
          if (pts.length < 4 && !pts.some((x) => x.day === `Day ${p.days}`)) pts.push({ day: `Day ${p.days}`, b: text.charAt(0).toUpperCase() + text.slice(1), s: "" });
        });
        return section("Waiting periods", `
<div class="eyebrow rv">Before your card kicks in</div>
<h2 class="rv d1">Waiting periods you should know about</h2>
<div class="timeline${pts.length === 4 ? " tl4" : ""} rv d2"><div class="tl-line"></div><div class="tl-fill"></div><div class="tl-points">${pts.map((p) => `<div class="tl-pt"><div class="dot"></div><div class="day">${esc(p.day)}</div><b>${esc(p.b)}</b>${p.s ? `<span>${esc(p.s)}</span>` : ""}</div>`).join("")}</div></div>
<p class="fine rv d3">Counted from the certificate\u2019s effective date. ${w.length > pts.length - 1 ? `Other waiting periods: ${w.slice(pts.length - 1).map((p) => `${p.days} days for ${tidy(p.description)}`).map(esc).join("; ")}. ` : ""}Pre-existing conditions are not covered. Full terms are in the certificate document.</p>`, {}, notes("The sooner the certificate starts, the sooner these clocks start. Say it as a fact, not pressure."));
      }
      function account(m) {
        const pts = m.cash.points;
        if (pts && pts.length >= 3) {
          let px = pts[0], py = pts[0];
          pts.forEach((r) => {
            if (r[1] > px[1]) px = r;
            if (r[2] > py[2]) py = r;
          });
          return section("Your account", `
<div class="eyebrow rv">Non-guaranteed cash value</div>
<h2 class="rv d1">How the account could grow</h2>
<svg class="chart rv d2" id="growth" viewBox="0 0 640 300" role="img" aria-label="Cash value by certificate year, Scenario Y peaks about ${rm(py[2])}"></svg>
<div class="scen rv d3"><div><i style="background:var(--ink)"></i><span class="num">Scenario Y \xB7 up to about ${rm(py[2])}</span></div><div><i style="background:var(--teal)"></i><span class="num">Scenario X \xB7 up to about ${rm(px[1])}</span></div></div>
<p class="fine rv d4">Cash value from the quotation\u2019s illustration table, by certificate year. Not guaranteed. ${m.protection.death ? `Death / TPD benefit from ${rm(m.protection.death)}.` : ""}</p>`, {}, notes("Be clear this is a protection plan first. The account keeps the cover running."));
        }
        const { x, y } = m.cash.atEnd;
        if (x == null && y == null) return "";
        return section("Your account", `
<div class="eyebrow rv">Non-guaranteed cash value</div>
<h2 class="rv d1">What could be left in the account${m.coverageToAge ? ` at age ${m.coverageToAge}` : ""}</h2>
<div class="glance two">
  ${y != null ? `<div class="tile dark rv d2"><div class="k">Scenario Y</div><div class="v num" ${count(y)}>${rm(y)}</div><div class="s">Higher investment return, not guaranteed</div></div>` : ""}
  ${x != null ? `<div class="tile rv d3"><div class="k">Scenario X</div><div class="v num" ${count(x)}>${rm(x)}</div><div class="s">Lower investment return, not guaranteed</div></div>` : ""}
</div>
<p class="fine rv d4">From the quotation\u2019s illustration. The account pays the monthly Tabarru\u2019 and charges, which rise with age and medical inflation, so extra contributions may be needed later.${m.protection.death ? ` Death / TPD benefit: ${rm(m.protection.death)}.` : ""}</p>`, {}, notes("Be clear this is a protection plan first. The account is what keeps the cover running."));
      }
      function options(models) {
        if (models.length < 2) return "";
        const first = models[0];
        const rowsDef = [
          ["Medical card", [
            ["Medical plan", (m) => m.medical.planName, "text"],
            ["Medical limit", (m) => m.medical.model === "LIFETIME_MEDICAL_FUND" ? m.medical.lifetimeFund : m.medical.annualLimit, "more", (m, v) => m.medical.model === "LIFETIME_MEDICAL_FUND" ? `${rm(v)} lifetime fund` : `${rm(v)} a year`],
            ["Room & board", (m) => m.medical.roomRate, "more", (m, v) => `${rm(v)}/day${m.medical.roomDays ? `, ${m.medical.roomDays} days a year` : m.medical.roomUnlimited ? ", unlimited days" : ""}`],
            ["Co-payment", (m) => m.medical.coPay.label || "None", "text"],
            ["Outpatient dengue & infectious disease", (m) => m.medical.dengue, "more", (m, v) => `${rm(v)} per illness`],
            ["Government hospital cash", (m) => m.medical.govHospital, "more", (m, v) => `${rm(v)}/day`]
          ]],
          ["Serious illness", [
            ["Extra yearly limit for cancer, heart attack or kidney failure", (m) => m.medical.extraLimit, "more", (m, v) => `+${rm(v)}`],
            ["Outpatient cancer & dialysis", (m) => m.medical.outpatientCancer, "more", (m, v) => `${rm(v)} per lifetime`],
            ["Advanced medical treatment", (m) => m.medical.advancedTreatment, "more", (m, v) => `${rm(v)} per lifetime`],
            ["Second medical opinion", (m) => m.medical.secondOpinion, "more", (m, v) => `${rm(v)} a year`]
          ]],
          ["Cost & long term", [
            ["Monthly contribution", (m) => m.monthly, "cost", (m, v) => rm(v)],
            ["Death / TPD (basic plan)", (m) => m.protection.death, "more", (m, v) => rm(v)],
            ["Covered until", (m) => m.coverageToAge, "text", (m, v) => `Age ${v}`],
            ["Total contribution over the term", (m) => m.totalOverTerm, "cost", (m, v) => rm(v)],
            ["Cash value at the end (Scenario Y, not guaranteed)", (m) => m.cash.atEnd.y, "more", (m, v) => rm(v)]
          ]]
        ];
        const tag = (kind, base, v) => {
          if (v == null) return "";
          if (base == null) return "";
          if (kind === "text") return String(v) === String(base) ? "" : ' <i class="tag up">Different</i>';
          if (v === base) return ' <i class="tag same">Same</i>';
          if (kind === "cost") return v > base ? ' <i class="tag down">Costs more</i>' : ' <i class="tag up">Costs less</i>';
          return v > base ? ' <i class="tag up">Higher</i>' : ' <i class="tag down">Lower</i>';
        };
        const body = rowsDef.map(([grp, rows]) => {
          const kept = rows.filter(([, get]) => models.some((m) => get(m) != null));
          if (!kept.length) return "";
          return `<tr class="grp"><td colspan="${models.length + 1}">${esc(grp)}</td></tr>${kept.map(([label, get, kind, show]) => {
            const base = get(first);
            return `<tr><td>${esc(label)}</td>${models.map((m, i) => {
              const v = get(m);
              if (v == null) return '<td class="none">Not listed</td>';
              const shown = show ? show(m, v) : v;
              return `<td>${esc(shown)}${i ? tag(kind, base, v) : ""}</td>`;
            }).join("")}</tr>`;
          }).join("")}`;
        }).join("");
        const diffs = models.slice(1).map((m, i) => {
          const more = m.monthly != null && first.monthly != null ? m.monthly - first.monthly : null;
          return more == null ? "" : `Option ${i + 2} is ${rm(Math.abs(more))} ${more >= 0 ? "more" : "less"} a month than Option 1${m.totalOverTerm && first.totalOverTerm ? ` (${rm(Math.abs(m.totalOverTerm - first.totalOverTerm))} ${m.totalOverTerm >= first.totalOverTerm ? "more" : "less"} over the term)` : ""}.`;
        }).filter(Boolean).join(" ");
        return section("Your options", `
<div class="eyebrow rv">Your options</div>
<h2 class="rv d1">${models.length} options, <span class="hl">side by side</span></h2>
<div class="said rv d1" data-said="Tell me what matters most and I\u2019ll show which option fits.">Tell me what matters most and I\u2019ll show which option fits.</div>
<div class="cmp-wrap rv d2"><table class="cmp">
  <thead><tr><th scope="col">Benefit</th>${models.map((m, i) => `<th scope="col" class="${i ? "o2" : "o1"}">Option ${i + 1}<span>${rm(m.monthly)} / month</span></th>`).join("")}</tr></thead>
  <tbody>${body}</tbody>
</table></div>
${diffs ? `<p class="rv d3"><b>The trade-off:</b> ${esc(diffs)} A plan you can keep paying beats a bigger plan that lapses.</p>` : ""}
<div class="chip-group rv d4">${chips("opt", "Which option feels right for you?", [...models.map((m, i) => ({ val: `Option ${i + 1} \xB7 ${m.medical.planName || m.productName} \xB7 ${rm(m.monthly)}`, label: `Option ${i + 1} \xB7 ${rm(m.monthly)}` })), "Still deciding"], { summary: "Preferred option" })}</div>
<p class="fine rv d5">From your PruBSN quotations. Contributions, Tabarru\u2019 and medical charges are not guaranteed. Tags compare each option with Option 1. \u201CNot listed\u201D means the figure isn\u2019t in that quotation\u2019s summary; check the full quotation.</p>`, {}, notes("Don\u2019t read every row. Point to the coloured tags: green is more, red is less or costs more.", "Link back to their worries and budget. Be honest about the trade-off."));
      }
      function glance(m) {
        const lim = limitOf(m);
        const tiles = [
          m.monthly != null ? `<div class="k">Monthly</div><div class="v num" ${count(m.monthly)}>${rm(m.monthly)}</div><div class="s">Contribution today</div>` : null,
          m.coverageToAge ? `<div class="k">Covered until</div><div class="v num">Age ${m.coverageToAge}</div><div class="s">${m.term ? `${m.term}-year term` : ""}</div>` : null,
          lim ? `<div class="k">Medical ${m.medical.model === "LIFETIME_MEDICAL_FUND" ? "fund" : "limit"}</div><div class="v num" ${count(lim.amount)}>${rm(lim.amount)}</div><div class="s">${m.medical.model === "LIFETIME_MEDICAL_FUND" ? "Lifetime, then cost-sharing" : "A year"}</div>` : null,
          m.medical.roomRate ? `<div class="k">Room & board</div><div class="v num" ${count(m.medical.roomRate)}>${rm(m.medical.roomRate)}</div><div class="s">A day</div>` : null,
          m.protection.death ? `<div class="k">Death / TPD</div><div class="v num" ${count(m.protection.death)}>${rm(m.protection.death)}</div><div class="s">Basic plan</div>` : null,
          m.cash.atEnd.y != null ? `<div class="k">Cash value at the end</div><div class="v num">${rm(m.cash.atEnd.y)}</div><div class="s">Scenario Y, not guaranteed</div>` : null
        ].filter(Boolean);
        if (tiles.length < 3) return "";
        return section("At a glance", `
<div class="eyebrow rv">The full picture</div>
<h2 class="rv d1">${m.term ? `${m.term} years, at a glance` : "Your plan, at a glance"}</h2>
<div class="glance">${tiles.map((t, i) => `<div class="tile${i === 2 ? " dark" : ""} rv d${2 + i}">${t}</div>`).join("")}</div>
${m.totalOverTerm ? `<p class="fine rv d8">Total contribution${m.term ? ` over ${m.term} years` : ""}: ${rm(m.totalOverTerm)} at today\u2019s rate. The medical charge is not guaranteed and may rise. From your PruBSN quotation${m.quoteDate ? ` dated ${esc(m.quoteDate)}` : ""}.</p>` : ""}`, {});
      }
      function nextSteps(m, ctx) {
        const a = ctx.agent;
        return section("Next steps", `
<div class="done rv"><svg viewBox="0 0 44 44" aria-hidden="true"><path d="M10 23 l8 8 l16 -18"/></svg></div>
<h2 class="rv d1">Let\u2019s protect what you\u2019ve worked for, before life asks you to.</h2>
<div class="next-list">
  <div class="rv d2">Choose the option that fits your answers and budget</div>
  <div class="rv d3">Fill in the proposal with complete, accurate health answers</div>
  <div class="rv d4">PruBSN reviews it, then the certificate is issued</div>
  <div class="rv d5">First contribution, and your waiting periods start</div>
</div>
<div class="send-box rv d5">
  <div class="send-summary" id="sendSummary">No answers yet. Tap your answers on the earlier screens.</div>
  <div class="send-actions">
    <button class="copy-btn" type="button" id="copyBtn" hidden>Copy answers</button>
  </div>
  <div class="send-status" id="sendStatus" role="status" aria-live="polite"></div>
</div>
${a.formUrl ? `<a class="form-link rv d6" href="${esc(a.formUrl)}" target="_blank" rel="noopener">Ready? Fill in your application form <span aria-hidden="true">\u2192</span></a>` : ""}
<div class="agent rv d6"><div class="av">${esc((a.short || a.name || "?").charAt(0))}</div><div><b>${esc(a.name)}</b><span>${a.code ? `Takaful Agent ${esc(a.code)} \xB7 ` : ""}${esc(a.agency)}</span></div></div>
<div class="tagline rv d7">${esc(a.tagline)}</div>`, { center: true }, notes("Read the summary back to them. Their answers save by themselves as they tap, to Presentation answers in your portal (and their VB name).", "Close without pressure: \u201CIf you want to think it over, I understand. Shall I follow up on Monday?\u201D"));
      }
      function sources(models) {
        const pages = [...new Map(models.map((m) => [m.product.productPage, m])).values()];
        return section("Sources", `
<div class="eyebrow rv">Sources</div>
<h2 class="rv d1">Where the numbers come from</h2>
<div class="src-list rv d2">
  <a href="https://www.thestar.com.my/news/nation/2024/04/22/less-than-half-of-malaysians-are-insured-as-we-become-an-ageing-society" target="_blank" rel="noopener">~45% insured, LIAM CEO<span>The Star, 22 Apr 2024</span></a>
  <a href="https://www.theborneopost.com/2022/10/24/one-in-three-working-malaysians-still-not-personally-protected/" target="_blank" rel="noopener">30% of working 25\u201340s unprotected, Zurich survey<span>Borneo Post, 24 Oct 2022</span></a>
  <a href="https://www.thestar.com.my/business/business-news/2026/06/10/takaful-industry-grows-473-in-2025-gross-contributions-reach-rm1638bil-in-2025" target="_blank" rel="noopener">Takaful penetration 19.6%, RM10.6 bil benefits, MTA<span>The Star, 10 Jun 2026</span></a>
  <a href="https://theedgemalaysia.com/article/cover-story-closing-insurance-family-takaful-protection-gap" target="_blank" rel="noopener">UKM\u2013LIAM underinsurance study (94\u201398%, RM100k\u2013150k)<span>The Edge Malaysia</span></a>
  <a href="https://www.thestar.com.my/news/nation/2025/10/30/interactive-malaysia039s-medical-inflation-to-rise-to-16-in-2026-says-aon" target="_blank" rel="noopener">Malaysia 16%, Asia Pacific 11.3%, Aon 2026<span>The Star, 30 Oct 2025</span></a>
  <a href="https://www.wtwco.com/en-gb/news/2025/11/double-digit-healthcare-cost-increases-projected-to-persist-into-2026-and-beyond" target="_blank" rel="noopener">Global 10.3%, WTW Global Medical Trends 2026<span>WTW, Nov 2025</span></a>
  <a href="https://www.freemalaysiatoday.com/category/nation/2026/04/14/medical-claims-hit-rm9-4bil-up-5-3-in-2025" target="_blank" rel="noopener">RM9.4 bil medical claims 2025; +56% 2021\u20132023<span>FMT, 14 Apr 2026</span></a>
  ${pages.map((m) => `<a href="${esc(m.product.productPage)}" target="_blank" rel="noopener">${esc(m.product.name)} product page<span>Plan figures: your PruBSN quotation${m.quoteDate ? ` dated ${esc(m.quoteDate)}` : ""}${m.version ? `, version ${esc(m.version)}` : ""}</span></a>`).join("")}
</div>`, {}, notes("Keep this for questions. Always check the issued certificate for final terms."));
      }
      var SCENES = [
        intro,
        cover,
        agenda,
        protectedStat,
        underinsured,
        inflation,
        yourMedicalCost,
        claims,
        twoPaths,
        moment,
        pathA,
        pathB,
        doBoth,
        pyramid,
        aboutYou,
        whatMatters,
        contributionDonut,
        admitted,
        room,
        treatment,
        clinic,
        serious,
        alsoCovered,
        howLimitWorks,
        waiting,
        account,
        (m, ctx) => options(ctx.models),
        glance,
        nextSteps,
        (m, ctx) => sources(ctx.models)
      ];
      module.exports = { SCENES, esc, rm, limitOf, budgetBands };
    }
  });

  // renderer/renderStory.js
  var require_renderStory = __commonJS({
    "renderer/renderStory.js"(exports, module) {
      "use strict";
      var { STORY_CSS } = require_storyStyles();
      var { STORY_RUNTIME_JS } = require_storyRuntime();
      var { buildStoryModel } = require_storyModel();
      var { productFor } = require_products();
      var { SCENES, esc } = require_scenes();
      var { getAgentConfig } = require_agents();
      var STORY_RENDERER_VERSION2 = "story-v1";
      var DEFAULT_ASSET_BASE = "https://syakirbadry-tech.github.io/quotation-generator/browser-tool/assets/story/";
      var DEFAULT_PORTAL = "https://prubsn-submission-service.syakirbadry.workers.dev/presentation-answers";
      var STORY_AGENTS = {
        "8LT00006": {
          short: "Syakir",
          formUrl: "https://syakirbadry-tech.github.io/Client-Form/client-detail-form.html"
        }
      };
      function agentProfile(model, overrides = {}) {
        const code = model.agentCode || null;
        const formal = getAgentConfig(code) || {};
        const extra = STORY_AGENTS[code] || {};
        const name = formal.name || (model.agentNameOnDocument ? model.agentNameOnDocument.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : "Your takaful agent");
        return {
          code,
          name,
          short: extra.short || name.split(/\s+/)[0],
          agency: formal.agency || "PruBSN",
          tagline: "Anda Inspirasi Kami",
          formUrl: extra.formUrl || "",
          formCode: "",
          ...overrides
        };
      }
      function renderStoryHtml2(quotations, options = {}) {
        const list = (Array.isArray(quotations) ? quotations : [quotations]).filter((q) => q && q.data).slice(0, 3);
        if (!list.length) throw new Error("renderStoryHtml needs at least one parsed quotation.");
        const models = list.map((q) => buildStoryModel(q.data, productFor(q.data)));
        const m = models[0];
        const agent = agentProfile(m, options.agent);
        const assetBase = options.assetBase || DEFAULT_ASSET_BASE;
        const ctx = { models, agent, photo: (name) => `${assetBase}${name}.jpg` };
        let scenes = SCENES.map((scene) => scene(m, ctx)).filter(Boolean).join("\n");
        scenes = scenes.replace('class="slide', 'class="slide is-active');
        if (!options.presenterNotes) scenes = scenes.replace(/<div class="notes">[\s\S]*?<\/div>/g, "");
        const who = m.unborn ? m.parentName ? `${m.parentCallName}\u2019s baby` : "Your baby" : m.callName;
        const title = `${who ? `${who}\u2019s ` : ""}${m.product.name} plan`;
        const clientLabel = m.unborn ? m.parentName ? `${m.parentName} (for her baby)` : "Unborn child" : m.fullName || "Client";
        const ribbon = `Prepared for ${clientLabel}${m.quoteDate ? ` \xB7 PruBSN quotation dated ${m.quoteDate}` : ""}`;
        const cfg = {
          client: clientLabel,
          source: `${m.product.name} story presentation`,
          agentShort: agent.short,
          agentFormCode: agent.formCode || "",
          vbId: /^[0-9a-f-]{36}$/.test(options.vbId || "") ? options.vbId : "",
          portal: options.portalUrl || DEFAULT_PORTAL,
          peopleOn: 9,
          cashValue: m.cash.points && m.cash.points.length >= 3 ? {
            axisLabel: "Year",
            points: m.cash.points,
            peaks: [m.cash.points.reduce((a, r) => r[2] > a[2] ? r : a), m.cash.points.reduce((a, r) => r[1] > a[1] ? r : a)].map((r, i) => [r[0], r[i === 0 ? 2 : 1]])
          } : null
        };
        const json = JSON.stringify(cfg).replace(/</g, "\\u003c");
        return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="generator" content="${STORY_RENDERER_VERSION2}">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Newsreader:ital,opsz,wght@0,6..72,500;0,6..72,600;0,6..72,700;1,6..72,500&display=swap">
<style>${STORY_CSS}
[hidden]{display:none!important}
.slide:not(.night) .limit-labels{color:var(--ink-soft)}</style>
</head>
<body id="pq-story">
<div class="deck" id="deck">
  <div class="ribbon" id="ribbon">${esc(ribbon)}</div>
${scenes}
  <div class="sheet-bg" id="sheetBg" hidden></div>
  <div class="sheet" id="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle" hidden>
    <button class="sheet-x" id="sheetX" type="button" aria-label="Close">\xD7</button>
    <div id="sheetBody"></div>
  </div>
  ${options.presenterNotes ? '<div class="notes-panel" id="notesPanel" hidden><div class="nk">Presenter notes \xB7 press N to hide</div><div id="notesBody"></div></div>' : ""}
  <div class="chrome" id="chrome">
    <button class="nav" id="prev" type="button" aria-label="Previous">\u2039</button>
    <div class="progress" id="progress" aria-hidden="true"></div>
    <span class="counter" id="counter"></span>
    ${options.presenterNotes ? '<button class="notes-btn" id="notesBtn" type="button" aria-pressed="false">Notes</button>' : ""}
    <button class="nav" id="next" type="button" aria-label="Next">\u203A</button>
  </div>
</div>
<script type="application/json" id="story-data">${json}<\/script>
<script>${STORY_RUNTIME_JS}<\/script>
</body>
</html>`;
      }
      module.exports = { renderStoryHtml: renderStoryHtml2, STORY_RENDERER_VERSION: STORY_RENDERER_VERSION2, buildStoryModel };
    }
  });

  // browser-tool/portalLink.js
  var require_portalLink = __commonJS({
    "browser-tool/portalLink.js"(exports, module) {
      "use strict";
      var API_BASE = "https://prubsn-submission-service.syakirbadry.workers.dev";
      var PORTAL_URL = "https://syakirbadry-tech.github.io/Client-Form/admin/";
      var SESSION_KEY = "prubsn-admin-session";
      var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
      function readSession() {
        try {
          const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
          if (!s || !s.token || !s.expiresAt || s.expiresAt * 1e3 <= Date.now()) return null;
          return s;
        } catch (e) {
          return null;
        }
      }
      function vbIdFromUrl(href) {
        try {
          const id = new URL(href).searchParams.get("vb") || "";
          return UUID_RE.test(id) ? id : null;
        } catch (e) {
          return null;
        }
      }
      async function call(session, path, method = "GET", body) {
        const headers = { Authorization: `Bearer ${session.token}` };
        if (body !== void 0) headers["Content-Type"] = "application/json";
        let res;
        try {
          res = await fetch(API_BASE + path, { method, headers, body: body === void 0 ? void 0 : JSON.stringify(body), cache: "no-store", credentials: "omit" });
        } catch (e) {
          throw new Error("Could not reach the portal. Check your connection.");
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          const err = new Error(data.error || `Portal request failed (HTTP ${res.status}).`);
          err.status = res.status;
          throw err;
        }
        return data;
      }
      async function fetchProspect(session, vbId) {
        const { prospects } = await call(session, "/admin/vb");
        return prospects.find((p) => p.id === vbId) || null;
      }
      async function saveQuoteLinks(session, vbId, { quoteUrl, storyUrl, product, monthly } = {}) {
        const body = { action: "quote" };
        if (quoteUrl) body.quoteUrl = quoteUrl;
        if (storyUrl) body.storyUrl = storyUrl;
        if (product) body.product = product;
        if (Number.isFinite(monthly) && monthly > 0) body.monthly = monthly;
        const { prospect } = await call(session, `/admin/vb/${vbId}`, "PATCH", body);
        return prospect;
      }
      function clientFormUrl(session) {
        const base = "https://syakirbadry-tech.github.io/Client-Form/client-detail-form.html";
        const code = session && session.user && session.user.formCode;
        return code ? `${base}?agent=${encodeURIComponent(code)}` : base;
      }
      module.exports = { readSession, vbIdFromUrl, fetchProspect, saveQuoteLinks, clientFormUrl, PORTAL_URL };
    }
  });

  // browser-tool/app.js
  var { extractPagesFromPdf } = require_pdfTextSource_browser();
  var { parseQuotation, normalizeAndValidate } = require_parser();
  var { renderAgentReviewHtml, renderClientQuotationHtml } = require_renderQuotation();
  var { renderComparisonHtml } = require_renderComparison();
  var { primaryValue } = require_formatters();
  var { RENDERER_VERSION } = require_renderNarrativeQuotation();
  var { buildPrefillData } = require_buildPrefillData();
  var { composeClientDocument } = require_composeClientDocument();
  var { publishQuotation } = require_publishQuotation();
  var { renderStoryHtml, STORY_RENDERER_VERSION } = require_renderStory();
  var portal = require_portalLink();
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
  var COMMON_EDITABLE_FIELDS = [
    { section: "Metadata", path: "metadata.productName", label: "Product name" },
    { section: "Metadata", path: "metadata.quotationDate.raw", label: "Quotation date (as printed, DD/MM/YYYY)" },
    { section: "Client", path: "client.fullName", label: "Full name" },
    { section: "Client", path: "client.gender", label: "Gender" },
    { section: "Client", path: "client.smokerStatus", label: "Smoker status" },
    { section: "Client", path: "client.occupationClass", label: "Occupation class" },
    { section: "Client", path: "client.ageNextBirthday", label: "Age next birthday", type: "number" },
    { section: "Client", path: "client.dateOfBirth.raw", label: "Date of birth (DD/MM/YYYY)" },
    { section: "Agent", path: "agent.agentCode", label: "Agent code (drives agency/branch/contact lookup)" },
    { section: "Agent", path: "agent.agentNameOnDocument", label: "Agent name (as printed on PDF)" }
  ];
  var ANUGERAHMAX_EDITABLE_FIELDS = [
    ...COMMON_EDITABLE_FIELDS,
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
    { section: "Benefits", path: "benefits.lifetimeLimit", label: "Lifetime limit" }
  ];
  var ASAS360_EDITABLE_FIELDS = [
    ...COMMON_EDITABLE_FIELDS,
    { section: "Plan", path: "basicPlan.basicPlanName", label: "Basic plan name" },
    { section: "Plan", path: "basicPlan.basicPlanTerm", label: "Basic plan term (years)", type: "number" },
    { section: "Plan", path: "basicPlan.basicSumCovered", label: "Basic sum covered (RM)", type: "number" },
    { section: "Plan", path: "medicalRider.riderName", label: "Medical rider name" },
    { section: "Plan", path: "medicalRider.planTier", label: "Medical plan tier" },
    { section: "Plan", path: "medicalRider.coPaymentOption", label: "Co-payment option" },
    { section: "Plan", path: "medicalRider.coverageToAge", label: "Coverage to age", type: "number" },
    { section: "Contributions", path: "monthlyTotalAmountPayable", label: "Monthly Total Amount Payable (RM)", type: "number" },
    { section: "Contributions", path: "totalAnnualContribution", label: "Total Annual Contribution (RM)", type: "number" },
    { section: "Benefits", path: "medicalRider.smartValuePoint", label: "Smart Value Point (RM)", type: "number" },
    { section: "Benefits", path: "medicalRider.lifetimeLimit", label: "Lifetime limit" },
    { section: "Benefits", path: "basicPlan.deathBenefit.amount", label: "Death Benefit (RM)", type: "number" },
    { section: "Benefits", path: "basicPlan.tpdBenefit.amount", label: "TPD Benefit (RM)", type: "number" }
  ];
  function editableFieldsFor(q) {
    const isAsas360 = Boolean(q && q.data && q.data.medicalRider);
    console.log("[DIAGNOSTIC 4] Review schema selected for %s: %s", q && q.fileName || "(unknown)", isAsas360 ? "ASAS360_EDITABLE_FIELDS" : "ANUGERAHMAX_EDITABLE_FIELDS");
    return isAsas360 ? ASAS360_EDITABLE_FIELDS : ANUGERAHMAX_EDITABLE_FIELDS;
  }
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
    comparisonHtml: null,
    story: { status: "idle", url: null, error: null }
    // the story presentation's client link
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
    portalBar: document.getElementById("portal-bar"),
    portalFor: document.getElementById("portal-for"),
    portalSave: document.getElementById("portal-save"),
    storyHelp: document.getElementById("story-help"),
    storyPresentBtn: document.getElementById("story-present-btn"),
    storyLinkBtn: document.getElementById("story-link-btn"),
    storyDownloadBtn: document.getElementById("story-download-btn"),
    storyStatus: document.getElementById("story-status"),
    storyLinkRow: document.getElementById("story-link-row"),
    storyLinkInput: document.getElementById("story-link-input"),
    storyCopyBtn: document.getElementById("story-copy-btn"),
    storyOpenBtn: document.getElementById("story-open-btn"),
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
      console.log("[DIAGNOSTIC app.js] parseOneFile(%s): metadata.productName=%s, has data.medical=%s, has data.protection=%s", file.name, result.data && result.data.metadata && result.data.metadata.productName, Boolean(result.data && result.data.medical), Boolean(result.data && result.data.protection));
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
    console.log("[DIAGNOSTIC 6a] Field resolve: label=%s path=%s resolvedValue=%s", field.label, field.path, JSON.stringify(value));
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
    const items = q.data.medical && q.data.medical.benefitItems || [];
    const rows = items.map((item, i) => {
      const warn = (q.warnings || []).find((w) => w.field === `benefits.benefitItems.${item.label}` || w.field === `medicalRider.benefitItems.${item.label}`);
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
    const editableFields = editableFieldsFor(q);
    const sections = [...new Set(editableFields.map((f) => f.section))];
    const formHtml = sections.map((section) => {
      const fields = editableFields.filter((f) => f.section === section);
      return `<fieldset><legend>${escapeHtml(section)}</legend><div class="fields-grid">${fields.map((f) => fieldRowHtml(q, qIndex, f)).join("")}</div></fieldset>`;
    }).join("");
    return `
    <div class="tab-panel ${qIndex === state.activeReviewIndex ? "active" : ""}" data-panel-index="${qIndex}">
      ${banners.join("")}
      <h2 class="section-title">Extracted fields</h2>
      ${formHtml}
      <h2 class="section-title">Benefits table</h2>
      ${benefitItemsTableHtml(q, qIndex)}
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
    console.log("[DIAGNOSTIC 5] Review stage renderer: reviewPanelHtml() in browser-tool/app.js (renderAgentReviewHtml from renderer/renderQuotation.js is imported but never called)");
    renderReviewTabs();
    el.reviewPanels.innerHTML = state.quotations.map((q, i) => reviewPanelHtml(q, i)).join("");
    updateGateState();
    state.quotations.forEach((q, qIndex) => {
      editableFieldsFor(q).forEach((field) => {
        const expected = getPath(q.data, field.path);
        const expectedStr = expected == null ? "" : String(expected);
        const input = el.reviewPanels.querySelector(`[data-panel-index="${qIndex}"] input[data-path="${field.path}"]`);
        const domValue = input ? input.value : "(input not found in DOM)";
        const match = input && domValue === expectedStr;
        console.log("[DIAGNOSTIC 6b] DOM readback: path=%s expected=%s domValue=%s match=%s", field.path, JSON.stringify(expectedStr), JSON.stringify(domValue), match);
      });
    });
  }
  el.reviewPanels.addEventListener("input", (e) => {
    const target = e.target;
    const qIndex = Number(target.dataset.qIndex);
    if (Number.isNaN(qIndex) || !state.quotations[qIndex]) return;
    const q = state.quotations[qIndex];
    if (target.dataset.path) {
      const path = target.dataset.path;
      const field = editableFieldsFor(q).find((f) => f.path === path);
      const raw = target.value;
      const value = field && field.type === "number" ? raw === "" ? null : Number(raw) : raw === "" ? null : raw;
      setPath(q.data, path, value);
    } else if (target.dataset.benefitIndex != null && target.dataset.benefitIndex !== "") {
      const idx = Number(target.dataset.benefitIndex);
      q.data.medical.benefitItems[idx].value = target.value || null;
      q.data.medical.benefitItems[idx].prefilledFromKnownMergedCell = false;
    }
    normalizeAndValidate(q.data);
    updateGateState();
  });
  function revalidateAll() {
    for (const q of state.quotations) {
      const { warnings, errors } = normalizeAndValidate(q.data);
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
        if (result.status === "success" && doc === state.generatedDocs[0]) {
          const c = doc.data.contributions || {};
          const monthly = Number.isFinite(c.totalMonthlyContribution) ? c.totalMonthlyContribution : doc.data.monthlyTotalAmountPayable;
          saveToVb({ quoteUrl: result.url, product: doc.data.metadata && doc.data.metadata.productName, monthly });
        }
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
    resetStory();
    renderOutputStage();
    showStage("output");
    publishAllGeneratedDocs();
  });
  function storyInputs() {
    return state.quotations.map((q) => ({ data: q.data }));
  }
  function storyOptions(extra = {}) {
    const opts = { ...extra };
    if (portalState.session) {
      const code = portalState.session.user && portalState.session.user.formCode;
      opts.agent = { formUrl: portal.clientFormUrl(portalState.session), ...code ? { formCode: code } : {} };
    }
    if (portalState.prospect) opts.vbId = portalState.prospect.id;
    return opts;
  }
  function storyPlanLabel(q) {
    const d = q.data || {};
    const plan = d.medical && d.medical.planName || d.metadata && d.metadata.productName || q.fileName;
    const c = d.contributions || {};
    const monthly = Number.isFinite(c.totalMonthlyContribution) ? c.totalMonthlyContribution : d.monthlyTotalAmountPayable;
    return Number.isFinite(monthly) ? `${plan}, RM${monthly}/month` : plan;
  }
  function resetStory() {
    state.story = { status: "idle", url: null, error: null };
    const n = state.quotations.length;
    el.storyHelp.textContent = n > 1 ? `Uses all ${n} quotations in upload order: the first (${storyPlanLabel(state.quotations[0])}) tells the story, and all ${n} appear side by side as Option 1 to ${n}. Upload the plan you recommend first.` : "Built from this quotation. Upload 2 or 3 quotations together to add an options comparison scene.";
    renderStoryStatus();
  }
  function renderStoryStatus() {
    const st = state.story || { status: "idle" };
    el.storyLinkBtn.disabled = st.status === "pending";
    if (st.status === "pending") {
      el.storyStatus.innerHTML = '<div class="banner banner-info"><span class="spinner" aria-hidden="true"></span> Making the story link\u2026</div>';
    } else if (st.status === "failed") {
      el.storyStatus.innerHTML = `<div class="banner banner-error">Could not make the story link: ${escapeHtml(String(st.error || "unknown error").replace(/\.+$/, ""))}.</div>`;
    } else if (st.status === "success") {
      el.storyStatus.innerHTML = '<div class="banner banner-ok">Story link ready. The client sees the deck without your notes.</div>';
    } else {
      el.storyStatus.innerHTML = "";
    }
    el.storyLinkRow.hidden = st.status !== "success";
    if (st.status === "success") el.storyLinkInput.value = st.url;
  }
  function openHtmlInNewTab(html) {
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const win = window.open(url, "_blank");
    if (!win) alert("Please allow pop-ups for this site to open the presentation.");
    setTimeout(() => URL.revokeObjectURL(url), 6e4);
  }
  el.storyPresentBtn.addEventListener("click", () => {
    openHtmlInNewTab(renderStoryHtml(storyInputs(), storyOptions({ presenterNotes: true })));
  });
  el.storyDownloadBtn.addEventListener("click", () => {
    const name = (state.quotations[0].data.client.fullName || "client").replace(/[^a-z0-9]+/gi, "_");
    downloadHtml(renderStoryHtml(storyInputs(), storyOptions()), `${name}_story.html`);
  });
  el.storyLinkBtn.addEventListener("click", async () => {
    state.story = { status: "pending" };
    renderStoryStatus();
    const result = await publishQuotation(state.quotations[0].data, renderStoryHtml(storyInputs(), storyOptions()), STORY_RENDERER_VERSION);
    state.story = result.status === "success" ? { status: "success", url: result.url } : { status: "failed", error: result.error };
    renderStoryStatus();
    if (result.status === "success") saveToVb({ storyUrl: result.url });
  });
  el.storyCopyBtn.addEventListener("click", async () => {
    if (!state.story || state.story.status !== "success") return;
    try {
      if (!navigator.clipboard) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(state.story.url);
      el.storyCopyBtn.textContent = "\u2713 Story link copied";
    } catch (e) {
      el.storyCopyBtn.textContent = "Could not copy - select the link above manually";
      el.storyLinkInput.select();
    }
    setTimeout(() => {
      el.storyCopyBtn.textContent = "Copy Story Link";
    }, 2500);
  });
  el.storyOpenBtn.addEventListener("click", () => {
    if (state.story && state.story.status === "success") window.open(state.story.url, "_blank");
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
    state.story = { status: "idle", url: null, error: null };
    el.quotationNumberInput.value = "";
    el.validUntilInput.value = "";
    el.ackCheckbox.checked = false;
    clearUploadNotice();
    renderFileList();
    updateContinueButton();
    showStage("upload");
  }
  showStage("upload");
  var portalState = { session: portal.readSession(), vbId: portal.vbIdFromUrl(location.href), prospect: null };
  function setPortalSave(text, warn) {
    el.portalSave.textContent = text;
    el.portalSave.className = `portal-save${warn ? " warn" : ""}`;
  }
  async function saveToVb(links) {
    if (!portalState.session || !portalState.prospect) return;
    setPortalSave("Saving to VB\u2026");
    try {
      await portal.saveQuoteLinks(portalState.session, portalState.prospect.id, links);
      setPortalSave(`\u2713 Saved to ${portalState.prospect.name}\u2019s VB`);
    } catch (err) {
      setPortalSave(`Not saved to VB: ${err.message}`, true);
    }
  }
  (async function initPortal() {
    if (!portalState.session && !portalState.vbId) return;
    el.portalBar.hidden = false;
    if (!portalState.session) {
      el.portalFor.textContent = "Sign in to the ASG Portal first, then open this from VB to link the quotation to your client.";
      return;
    }
    const who = portalState.session.user && portalState.session.user.name;
    if (!portalState.vbId) {
      el.portalFor.textContent = who ? `Signed in as ${who}` : "Signed in";
      return;
    }
    el.portalFor.textContent = "Loading your VB client\u2026";
    try {
      portalState.prospect = await portal.fetchProspect(portalState.session, portalState.vbId);
      if (!portalState.prospect) {
        el.portalFor.textContent = "That VB name was not found in your list. Quotations will not be saved to VB.";
        return;
      }
      el.portalFor.replaceChildren(document.createTextNode("Quotation for "), Object.assign(document.createElement("b"), { textContent: portalState.prospect.name }), document.createTextNode(" \xB7 links save to VB automatically"));
    } catch (err) {
      el.portalFor.textContent = `Could not load VB: ${err.message}`;
    }
  })();
})();
