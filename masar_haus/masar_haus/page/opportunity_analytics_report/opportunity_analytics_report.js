(function () {
	"use strict";

	// ── Formatters ─────────────────────────────────────────────────────────────
	function fmtNum(n) {
		return Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
	}
	function fmtCompact(n) {
		n = Number(n) || 0;
		if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
		if (n >= 1_000) return (n / 1_000).toFixed(0) + "K";
		return n.toFixed(0);
	}
	function fmtMonth(ym) {
		var p = ym.split("-");
		return new Date(+p[0], +p[1] - 1, 1).toLocaleString("en-US", {
			month: "short",
			year: "numeric",
		});
	}

	// ── Export ──────────────────────────────────────────────────────────────────
	function downloadFile(filename, content, mime) {
		var blob = new Blob([content], { type: mime });
		var url = URL.createObjectURL(blob);
		var a = document.createElement("a");
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}

	// Exports already run against whatever the filter bar currently has
	// selected (lastData is refreshed on every applyFilters() -> loadData()
	// call), but the exported file itself never said which filters produced
	// it -- opened later, out of context, there was no way to tell. This
	// renders the active ones (or a clear "no filters" note) for both
	// exports to stamp onto the file.
	var FILTER_LABELS = {
		department: "Department",
		territory: "Territory",
		sales_stage: "Main Stage",
		sales_stage_1: "Sales Stage",
		industry: "Main Industry",
		sub_industry: "Industry",
	};
	function describeFilters(filters) {
		var parts = [];
		Object.keys(FILTER_LABELS).forEach(function (key) {
			var val = filters && filters[key];
			if (val && val !== "all") parts.push(FILTER_LABELS[key] + ": " + val);
		});
		return parts.length ? parts.join(" | ") : "None (showing all data)";
	}

	function loadExcelLib(cb) {
		if (window.ExcelJS) return cb();
		var s = document.createElement("script");
		s.src = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";
		s.onload = cb;
		document.head.appendChild(s);
	}

	var SEGMENT_COLORS = { total: "FF4F46E5", CF: "FF3B82F6", GRC: "FF7C3AED" };

	// Writes one "card": a colored segment-name header row, then a Number-of-
	// Opportunities row and a Value(QAR) row underneath -- mirrors the
	// on-screen summary cards. Returns the next free row (with a blank
	// spacer row already included).
	function addCardBlock(sheet, row, label, key, s) {
		sheet.mergeCells(row, 1, row, 6);
		var head = sheet.getCell(row, 1);
		head.value = label;
		head.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 12 };
		head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SEGMENT_COLORS[key] || "FF334155" } };
		head.alignment = { vertical: "middle" };
		sheet.getRow(row).height = 20;
		row++;

		["", "Total", "Won", "Live", "Lost", "Win Rate"].forEach(function (h, i) {
			var c = sheet.getCell(row, i + 1);
			c.value = h;
			c.font = { bold: true, color: { argb: "FF6B7280" } };
			c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9FAFB" } };
		});
		row++;

		[s.numbers.total, s.numbers.won, s.numbers.live, s.numbers.lost].forEach(function (v, i) {
			sheet.getCell(row, i + 2).value = v;
		});
		sheet.getCell(row, 1).value = "Number of Opportunities";
		sheet.getCell(row, 6).value = s.numbers.win_pct / 100;
		sheet.getCell(row, 6).numFmt = "0.0%";
		row++;

		[s.values.total, s.values.won, s.values.live, s.values.lost].forEach(function (v, i) {
			var c = sheet.getCell(row, i + 2);
			c.value = v;
			c.numFmt = "#,##0";
		});
		sheet.getCell(row, 1).value = "Value (QAR)";
		sheet.getCell(row, 6).value = s.values.win_pct / 100;
		sheet.getCell(row, 6).numFmt = "0.0%";
		row++;

		return row + 1;
	}

	function addTable(sheet, row, headers, rows, colFormats) {
		headers.forEach(function (h, i) {
			var c = sheet.getCell(row, i + 1);
			c.value = h;
			c.font = { bold: true, color: { argb: "FF374151" } };
			c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
		});
		row++;
		(rows || []).forEach(function (r) {
			r.forEach(function (v, i) {
				var c = sheet.getCell(row, i + 1);
				c.value = v;
				if (colFormats && colFormats[i]) c.numFmt = colFormats[i];
			});
			row++;
		});
		return row + 1;
	}

	// Embeds the chart's canvas as a picture (ExcelJS has no live-chart API,
	// so this is a pixel-perfect grab of the already-drawn Chart.js canvas,
	// same technique as the PDF export) and returns the row below it, sized
	// off the image's own aspect ratio so a following table doesn't overlap.
	function addChartImage(workbook, sheet, canvasId, row, widthPx) {
		var canvas = document.getElementById(canvasId);
		if (!canvas || !canvas.width || !canvas.height) return row;
		var imageId = workbook.addImage({ base64: canvas.toDataURL("image/png", 1.0), extension: "png" });
		var w = widthPx || 480;
		var h = (canvas.height / canvas.width) * w;
		sheet.addImage(imageId, { tl: { col: 0, row: row - 1 }, ext: { width: w, height: h } });
		return row + Math.ceil(h / 18) + 2; // ~18px/row at default row height, plus a spacer
	}

	function buildXLSX(data, filters) {
		var workbook = new ExcelJS.Workbook();
		workbook.creator = "Masar Haus";
		workbook.created = new Date();

		// ── Summary: title + one card per segment ──
		var summary = workbook.addWorksheet("Summary");
		summary.columns = [{ width: 26 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 12 }];
		summary.getCell(1, 1).value = "Opportunity Analytics Report";
		summary.getCell(1, 1).font = { bold: true, size: 16 };
		summary.getCell(2, 1).value = "Exported: " + frappe.datetime.now_datetime();
		summary.getCell(2, 1).font = { color: { argb: "FF9CA3AF" } };
		summary.getCell(3, 1).value = "Filters: " + describeFilters(filters);
		summary.getCell(3, 1).font = { color: { argb: "FF9CA3AF" } };

		var row = 5;
		row = addCardBlock(summary, row, "Total — CF + GRC", "total", data.summary.total);
		row = addCardBlock(summary, row, "Corporate Finance (CF)", "CF", data.summary.CF);
		row = addCardBlock(summary, row, "Corporate Governance (GRC)", "GRC", data.summary.GRC);

		// ── Top 5 sheets ──
		function top5Sheet(name, rows) {
			var sheet = workbook.addWorksheet(name);
			sheet.columns = [{ width: 5 }, { width: 26 }, { width: 20 }, { width: 20 }, { width: 14 }, { width: 16 }];
			addTable(
				sheet, 1,
				["#", "Client", "Opportunity", "Sales Stage", "Status", "Value (QAR)"],
				(rows || []).map(function (r, i) {
					return [i + 1, r.customer_name || r.title, r.name, r.sales_stage || "", r.status, r.opportunity_amount];
				}),
				{ 5: "#,##0" }
			);
		}
		top5Sheet("Top 5 - CF", data.top5_cf);
		top5Sheet("Top 5 - GRC", data.top5_grc);

		// ── Pipeline: chart image + full breakdown table ──
		var pipeline = workbook.addWorksheet("Pipeline");
		pipeline.columns = [{ width: 22 }, { width: 16 }, { width: 10 }, { width: 16 }, { width: 10 }, { width: 16 }, { width: 10 }];
		var pRow = addChartImage(workbook, pipeline, "opp-pipeline-chart", 1, 620);
		addTable(
			pipeline, pRow,
			["Sales Stage", "CF (QAR)", "CF #", "GRC (QAR)", "GRC #", "Total (QAR)", "Total #"],
			(data.pipeline || []).map(function (p) {
				return [p.stage, p.cf_val, p.cf_cnt, p.grc_val, p.grc_cnt, p.total_val, p.total_cnt];
			}),
			{ 1: "#,##0", 3: "#,##0", 5: "#,##0" }
		);

		// ── Monthly: chart image + table ──
		var monthly = workbook.addWorksheet("Monthly");
		monthly.columns = [{ width: 14 }, { width: 18 }, { width: 20 }, { width: 22 }];
		var bar = data.bar || {};
		var mRow = addChartImage(workbook, monthly, "opp-bar-chart", 1, 620);
		addTable(
			monthly, mRow,
			["Month", "Total (QAR)", "Corporate Finance (QAR)", "Corporate Governance (QAR)"],
			(bar.months || []).map(function (m, i) { return [m, bar.total[i], bar.cf[i], bar.grc[i]]; }),
			{ 1: "#,##0", 2: "#,##0", 3: "#,##0" }
		);

		// ── Charts: the 3 status doughnuts, stacked ──
		var charts = workbook.addWorksheet("Charts");
		charts.columns = [{ width: 70 }];
		var cRow = 1;
		[
			["Total — CF + GRC", "doughnut-total"],
			["Corporate Finance (CF)", "doughnut-CF"],
			["Corporate Governance (GRC)", "doughnut-GRC"],
		].forEach(function (spec) {
			charts.getCell(cRow, 1).value = spec[0];
			charts.getCell(cRow, 1).font = { bold: true };
			cRow += 1;
			cRow = addChartImage(workbook, charts, spec[1], cRow, 380);
		});

		workbook.xlsx.writeBuffer().then(function (buf) {
			downloadFile(
				"opportunity-analytics-report.xlsx",
				buf,
				"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
			);
		});
	}

	function exportToExcel(data, filters) {
		if (!data) {
			frappe.msgprint(__("Nothing to export yet -- wait for the report to finish loading."));
			return;
		}
		loadExcelLib(function () { buildXLSX(data, filters); });
	}

	// window.print() (the previous approach) hands off to the browser's own
	// print engine, which turned out unreliable here: charts silently failed
	// to print, a card was cut off mid-way at a page break, and the desk
	// sidebar leaked into the output. Building the PDF directly instead gives
	// full control over layout and page breaks, and charts are captured via
	// canvas.toDataURL() -- a pixel-perfect grab of the actual already-drawn
	// Chart.js canvas, not a re-render or a screenshot approximation.
	function loadPdfLibs(cb) {
		if (window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.API.autoTable) return cb();
		var s1 = document.createElement("script");
		s1.src = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
		s1.onload = function () {
			var s2 = document.createElement("script");
			s2.src = "https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js";
			s2.onload = cb;
			document.head.appendChild(s2);
		};
		document.head.appendChild(s1);
	}

	function chartImage(canvasId) {
		var canvas = document.getElementById(canvasId);
		if (!canvas || !canvas.width || !canvas.height) return null;
		return { dataUrl: canvas.toDataURL("image/png", 1.0), width: canvas.width, height: canvas.height };
	}

	function buildPDF(data, filters) {
		var doc = new window.jspdf.jsPDF({ unit: "pt", format: "a4" });
		var PAGE_W = doc.internal.pageSize.getWidth();
		var PAGE_H = doc.internal.pageSize.getHeight();
		var MARGIN = 36;
		var CONTENT_W = PAGE_W - MARGIN * 2;
		var y = MARGIN;

		function ensureRoom(height) {
			if (y + height > PAGE_H - MARGIN) {
				doc.addPage();
				y = MARGIN;
			}
		}

		function heading(text) {
			ensureRoom(28);
			doc.setFont(undefined, "bold");
			doc.setFontSize(13);
			doc.setTextColor(30, 41, 59);
			doc.text(text, MARGIN, y);
			doc.setDrawColor(226, 232, 240);
			doc.line(MARGIN, y + 5, PAGE_W - MARGIN, y + 5);
			y += 22;
		}

		function subheading(text) {
			ensureRoom(18);
			doc.setFont(undefined, "bold");
			doc.setFontSize(10.5);
			doc.setTextColor(55, 65, 81);
			doc.text(text, MARGIN, y);
			y += 14;
		}

		// Fit an image into the given width (or CONTENT_W), preserving aspect
		// ratio, and place it at (x, y) -- adding a page first if it wouldn't
		// fit on what's left of the current one, since a chart can't usefully
		// split across pages. Does NOT advance y itself (a row of side-by-side
		// images needs to advance once for the whole row, by the tallest of
		// them, not per image) -- callers must advance y by the returned
		// height themselves.
		function addImage(img, opts) {
			if (!img) return 0;
			opts = opts || {};
			var x = opts.x !== undefined ? opts.x : MARGIN;
			var maxWidth = Math.min(opts.width || CONTENT_W, CONTENT_W);
			var w = maxWidth;
			var h = (img.height / img.width) * w;
			var maxH = PAGE_H - MARGIN * 2;
			if (h > maxH) { h = maxH; w = (img.width / img.height) * h; }
			if (!opts.noPageBreak && y + h > PAGE_H - MARGIN && y > MARGIN) { doc.addPage(); y = MARGIN; }
			doc.addImage(img.dataUrl, "PNG", x, y, w, h);
			return h;
		}

		function table(head, body, opts) {
			doc.autoTable(Object.assign({
				startY: y,
				margin: { left: MARGIN, right: MARGIN },
				head: [head],
				body: body,
				styles: { fontSize: 8.5, cellPadding: 4 },
				headStyles: { fillColor: [243, 244, 246], textColor: [55, 65, 81] },
			}, opts || {}));
			y = doc.lastAutoTable.finalY + 18;
		}

		// ── Title ──
		doc.setFont(undefined, "bold");
		doc.setFontSize(18);
		doc.setTextColor(17, 24, 39);
		doc.text("Opportunity Analytics Report", MARGIN, y);
		y += 18;
		doc.setFont(undefined, "normal");
		doc.setFontSize(9);
		doc.setTextColor(156, 163, 175);
		doc.text("Generated " + new Date().toString().replace(/ \(.*\)/, ""), MARGIN, y);
		y += 12;
		doc.text("Filters: " + describeFilters(filters), MARGIN, y);
		y += 24;

		// ── Summary ──
		heading("Summary");
		[["Total — CF + GRC", "total"], ["Corporate Finance (CF)", "CF"], ["Corporate Governance (GRC)", "GRC"]].forEach(function (row) {
			var s = data.summary[row[1]];
			subheading(row[0]);
			table(
				["", "Total", "Won", "Live", "Lost", "Win Rate"],
				[
					["Number of Opportunities", s.numbers.total, s.numbers.won, s.numbers.live, s.numbers.lost, s.numbers.win_pct + "%"],
					["Value (QAR)", fmtCompact(s.values.total), fmtCompact(s.values.won), fmtCompact(s.values.live), fmtCompact(s.values.lost), s.values.win_pct + "%"],
				]
			);
		});

		// ── Top 5 ──
		heading("Top 5 Live Opportunities by Value");
		function top5Table(label, rows) {
			subheading(label);
			table(
				["#", "Client", "Opportunity", "Stage", "Status", "Value (QAR)"],
				(rows || []).map(function (r, i) {
					return [i + 1, r.customer_name || r.title, r.name, r.sales_stage || "", r.status, fmtNum(r.opportunity_amount)];
				})
			);
		}
		top5Table("Corporate Finance (CF)", data.top5_cf);
		top5Table("Corporate Governance (GRC)", data.top5_grc);

		// ── Pipeline ──
		heading("Sales Stage Pipeline");
		y += addImage(chartImage("opp-pipeline-chart")) + 10;
		table(
			["Sales Stage", "CF (QAR)", "CF #", "GRC (QAR)", "GRC #", "Total (QAR)", "Total #"],
			(data.pipeline || []).map(function (p) {
				return [p.stage, fmtNum(p.cf_val), p.cf_cnt, fmtNum(p.grc_val), p.grc_cnt, fmtNum(p.total_val), p.total_cnt];
			})
		);

		// ── Doughnuts ── all 3 side by side in one row, matching the on-screen
		// layout: labels drawn at each column's x, then images below them --
		// widths are computed first so the row's height (tallest of the 3) is
		// known before drawing, letting ensureRoom() break to a new page for
		// the whole row instead of possibly splitting it mid-row.
		heading("Opportunity Value by Status");
		var donutGap = 16;
		var donutColW = (CONTENT_W - donutGap * 2) / 3;
		var donutSpecs = [
			["Total — CF + GRC", "doughnut-total"],
			["Corporate Finance (CF)", "doughnut-CF"],
			["Corporate Governance (GRC)", "doughnut-GRC"],
		];
		var donutImages = donutSpecs.map(function (row) { return chartImage(row[1]); });
		var donutRowH = donutImages.reduce(function (max, img) {
			return img ? Math.max(max, (img.height / img.width) * donutColW) : max;
		}, 0);
		ensureRoom(14 + donutRowH);
		donutSpecs.forEach(function (row, i) {
			doc.setFont(undefined, "bold");
			doc.setFontSize(10);
			doc.setTextColor(55, 65, 81);
			doc.text(row[0], MARGIN + i * (donutColW + donutGap), y);
		});
		y += 14;
		donutSpecs.forEach(function (row, i) {
			addImage(donutImages[i], { x: MARGIN + i * (donutColW + donutGap), width: donutColW, noPageBreak: true });
		});
		y += donutRowH + 10;

		// ── Monthly bar ──
		heading("Monthly Live Opportunity Value");
		y += addImage(chartImage("opp-bar-chart")) + 10;
		var bar = data.bar || {};
		table(
			["Month", "Total (QAR)", "Corporate Finance (QAR)", "Corporate Governance (QAR)"],
			(bar.months || []).map(function (m, i) {
				return [m, fmtNum(bar.total[i]), fmtNum(bar.cf[i]), fmtNum(bar.grc[i])];
			})
		);

		doc.save("opportunity-analytics-report.pdf");
	}

	function exportToPDF(data, filters) {
		if (!data) {
			frappe.msgprint(__("Nothing to export yet -- wait for the report to finish loading."));
			return;
		}
		loadPdfLibs(function () { buildPDF(data, filters); });
	}

	// ── Chart.js dynamic loader ─────────────────────────────────────────────────
	function loadChartJs(cb) {
		if (window.Chart) return cb();
		var s = document.createElement("script");
		s.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js";
		s.onload = cb;
		document.head.appendChild(s);
	}

	// ── CSS ─────────────────────────────────────────────────────────────────────
	var CSS_ID = "opp-db-styles-v8";
	function injectStyles() {
		if (document.getElementById(CSS_ID)) return;
		var el = document.createElement("style");
		el.id = CSS_ID;
		el.textContent = `
.opp-db { padding: 4px 20px 32px; }
@media (max-width: 560px) { .opp-db { padding-left: 12px; padding-right: 12px; } }
/* Filter bar */
.opp-filter-bar {
  display: flex; flex-wrap: wrap; align-items: flex-end; gap: 14px;
  background: #fff; border: 1px solid #e5e7eb; border-radius: 10px;
  padding: 14px 18px; margin-bottom: 20px;
  box-shadow: 0 1px 4px rgba(0,0,0,.05);
}
.opp-filter-item { display: flex; flex-direction: column; gap: 4px; }
.opp-filter-item label {
  font-size: 10px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .5px; color: #9ca3af;
}
.opp-select {
  padding: 6px 12px; border: 1px solid #d1d5db; border-radius: 6px;
  font-size: 12px; color: #1f2937; background: #f9fafb; min-width: 150px;
  cursor: pointer;
}
.opp-select:focus { outline: none; border-color: #6366f1; background: #fff; }
.opp-select.active { border-color: #6366f1; background: #eef2ff; color: #4338ca; font-weight: 600; }
.opp-filter-clear {
  padding: 6px 14px; border: 1px solid #e5e7eb; border-radius: 6px;
  font-size: 11px; font-weight: 600; color: #6b7280; background: #fff;
  cursor: pointer; align-self: flex-end;
}
.opp-filter-clear:hover { border-color: #6366f1; color: #4338ca; }
.opp-filter-chips { display: flex; gap: 6px; flex-wrap: wrap; align-self: flex-end; }
.opp-chip {
  background: #eef2ff; color: #4338ca; border: 1px solid #c7d2fe;
  padding: 3px 10px; border-radius: 12px; font-size: 11px; font-weight: 600;
}
/* Section titles */
.opp-db h3.sec-title {
  font-size: 15px; font-weight: 700; color: #374151;
  margin: 28px 0 14px; padding-bottom: 6px;
  border-bottom: 2px solid #e5e7eb;
}
.sec-count {
  display: inline-block; background: #eef2ff; color: #4338ca;
  border: 1px solid #c7d2fe; border-radius: 10px;
  font-size: 11px; font-weight: 600; padding: 1px 9px; margin-left: 8px;
  vertical-align: middle; position: relative; top: -1px;
}
/* Grid layouts */
.opp-grid-3 { display: grid; grid-template-columns: repeat(3,1fr); gap: 16px; }
.opp-grid-2 { display: grid; grid-template-columns: repeat(2,1fr); gap: 16px; }
/* Panel */
.opp-panel {
  background: #fff; border: 1px solid #e5e7eb; border-radius: 10px;
  padding: 18px 16px; box-shadow: 0 1px 4px rgba(0,0,0,.05);
}
.opp-panel-title {
  font-size: 13px; font-weight: 700; color: #1f2937; text-align: center;
  padding-bottom: 12px; border-bottom: 1px solid #f3f4f6; margin-bottom: 14px;
}
/* Metric cards */
.opp-metric-group-title {
  font-size: 10px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .6px; color: #9ca3af; margin: 12px 0 8px;
}
.opp-metric-row { display: flex; gap: 8px; }
.opp-metric { flex: 1; text-align: center; padding: 10px 6px; border-radius: 8px; }
.opp-metric.total { background: #eef2ff; }
.opp-metric.won  { background: #f0fdf4; }
.opp-metric.live { background: #eff6ff; }
.opp-metric.lost { background: #fef2f2; }
.opp-metric.pct  { background: #fefce8; }
.opp-metric .mv  { font-size: 20px; font-weight: 800; line-height: 1.2; }
.opp-metric.total .mv { color: #4338ca; }
.opp-metric.won  .mv { color: #15803d; }
.opp-metric.live .mv { color: #1d4ed8; }
.opp-metric.lost .mv { color: #b91c1c; }
.opp-metric.pct  .mv { color: #b45309; }
.opp-metric .ml  {
  font-size: 9px; font-weight: 600; text-transform: uppercase;
  letter-spacing: .4px; color: #9ca3af; margin-top: 3px;
}
/* Tables */
.opp-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.opp-table th {
  background: #f9fafb; padding: 8px 10px; text-align: left;
  color: #6b7280; font-weight: 700; font-size: 10px;
  text-transform: uppercase; letter-spacing: .4px;
  border-bottom: 2px solid #e5e7eb;
}
.opp-table th.r, .opp-table td.r { text-align: right; }
.opp-table td { padding: 9px 10px; border-bottom: 1px solid #f3f4f6; color: #1f2937; }
.opp-table tr:last-child td { border-bottom: none; }
.opp-table tr:hover td { background: #f8faff; }
.opp-table .sub { font-size: 10px; color: #9ca3af; margin-top: 1px; }
/* Badges */
.badge {
  display: inline-block; padding: 2px 7px; border-radius: 10px;
  font-size: 10px; font-weight: 600; white-space: nowrap;
}
.badge-quotation   { background: #dbeafe; color: #1e40af; }
.badge-open        { background: #dcfce7; color: #166534; }
.badge-stage       { background: #f3f4f6; color: #374151; }
/* Bar chart controls */
.bar-controls { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.bar-controls label { font-size: 12px; font-weight: 600; color: #374151; }
/* Empty state */
.opp-empty {
  text-align: center; padding: 32px; color: #9ca3af; font-size: 13px;
}
@media (max-width: 900px) {
  /* Summary panels, Top-5 tables, and the status doughnuts are wide,
     content-heavy cards -- stacking them into one narrow column makes for
     a very long scroll. Turn each row into a horizontally-swipeable
     carousel instead: cards keep a comfortable width and you swipe between
     them, with scroll-snap so a swipe settles on a card instead of leaving
     it half-visible. */
  .opp-grid-3, .opp-grid-2 {
    display: flex;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
    padding-bottom: 4px; /* room for the scrollbar so it doesn't crowd the cards */
  }
  .opp-grid-3 > *, .opp-grid-2 > * {
    flex: 0 0 88%;
    scroll-snap-align: start;
  }
  /* Sales Stage Pipeline chart: its measured width comes from a min-width
     set inline in renderDashboard() (see pipelineWidthStyle) so Chart.js
     draws one legible bar per stage instead of squeezing all of them into
     the viewport -- this scrolls that overflow instead of clipping it. */
  .opp-chart-scroll {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
}
/* Mobile only -- desktop's 5-across metric row and table columns have room
   to breathe already; on a ~360-390px phone width they don't. */
@media (max-width: 560px) {
  /* 5 metrics in one un-wrapped flex row (Total/Won/Live/Lost/Win Rate) ran
     out of room and got clipped off the right edge of the screen. Wrap to
     ~3-per-row instead of shrinking them past legibility. */
  .opp-metric-row { flex-wrap: wrap; }
  .opp-metric { flex: 1 1 30%; min-width: 0; }
  /* Top-5 tables (Client/Stage/Status/Value) don't have room for all 4
     columns at readable width -- scroll the panel horizontally instead of
     letting cell text wrap into an unreadable stack. */
  .opp-panel { overflow-x: auto; }
  .opp-table { white-space: nowrap; }
}
/* Fallback for manually printing this page (Ctrl+P) -- Actions -> Export to
   PDF no longer goes through window.print() (see exportToPDF/buildPDF: it
   turned out unreliable -- charts didn't print, a card was cut mid-way at a
   page break, and the desk sidebar leaked into the output -- so that action
   now builds the PDF directly instead). Kept for whoever prints by hand
   anyway: print page width often lands inside the max-width:900/560px
   ranges above (they're not print-qualified, so they'd otherwise apply
   here too), which would print the summary/table/doughnut carousels as a
   single 88%-wide card each with the rest clipped off, since print has no
   way to "swipe" the hidden ones into view. Force the normal grid back for
   print, and drop controls that aren't meaningful on a static page. */
@media print {
  .opp-filter-bar, .bar-controls { display: none !important; }
  .opp-grid-3, .opp-grid-2 {
    display: grid !important;
    overflow: visible !important;
  }
  .opp-grid-3 { grid-template-columns: repeat(3, 1fr) !important; }
  .opp-grid-2 { grid-template-columns: repeat(2, 1fr) !important; }
  .opp-grid-3 > *, .opp-grid-2 > * { flex: unset !important; }
  .opp-chart-scroll, .opp-panel { overflow: visible !important; }
  .opp-panel { box-shadow: none !important; break-inside: avoid; }
  .opp-db h3.sec-title { break-after: avoid; }
}
`;
		document.head.appendChild(el);
	}

	// ── Filter bar ──────────────────────────────────────────────────────────────
	function buildFilterBarHTML(opts) {
		var deptOpts = '<option value="all">All Departments</option>' +
			(opts.departments || []).map(function (s) {
				return '<option value="' + s.replace(/"/g, "&quot;") + '">' + s + '</option>';
			}).join("");

		var territoryOpts = '<option value="all">All Territories</option>' +
			opts.territories.map(function (t) {
				return '<option value="' + t + '">' + t + '</option>';
			}).join("");

		var industryOpts = '<option value="all">All Main Industries</option>' +
			(opts.industries || []).map(function (s) {
				return '<option value="' + s.replace(/"/g, "&quot;") + '">' + s + '</option>';
			}).join("");

		var stageOpts = '<option value="all">All Main Stages</option>' +
			opts.sales_stages.map(function (s) {
				return '<option value="' + s.replace(/"/g, "&quot;") + '">' + s + '</option>';
			}).join("");

		var stage1Opts = '<option value="all">All Sales Stages</option>' +
			(opts.sales_stages_1 || []).map(function (s) {
				return '<option value="' + s.replace(/"/g, "&quot;") + '">' + s + '</option>';
			}).join("");

		return (
			'<div class="opp-filter-bar">' +
			'<div class="opp-filter-item"><label>Department</label>' +
			'<select id="opp-f-department" class="opp-select">' + deptOpts + '</select></div>' +
			'<div class="opp-filter-item"><label>Territory</label>' +
			'<select id="opp-f-territory" class="opp-select">' + territoryOpts + '</select></div>' +
			'<div class="opp-filter-item"><label>Main Industry</label>' +
			'<select id="opp-f-industry" class="opp-select">' + industryOpts + '</select></div>' +
			'<div class="opp-filter-item"><label>Main Stage</label>' +
			'<select id="opp-f-stage" class="opp-select">' + stageOpts + '</select></div>' +
			'<div class="opp-filter-item"><label>Sales Stage</label>' +
			'<select id="opp-f-stage1" class="opp-select">' + stage1Opts + '</select></div>' +
			'<button class="opp-filter-clear" id="opp-f-clear">Clear Filters</button>' +
			'<div class="opp-filter-chips" id="opp-filter-chips"></div>' +
			'</div>'
		);
	}

	function updateFilterChips(filters) {
		var chips = document.getElementById("opp-filter-chips");
		if (!chips) return;
		var parts = [];
		if (filters.department !== "all") parts.push(filters.department);
		if (filters.territory !== "all") parts.push(filters.territory);
		if (filters.sales_stage !== "all") parts.push(filters.sales_stage);
		if (filters.sales_stage_1 !== "all") parts.push(filters.sales_stage_1);
		if (filters.industry !== "all") parts.push(filters.industry);
		if (filters.sub_industry !== "all") parts.push(filters.sub_industry);
		chips.innerHTML = parts.map(function (p) {
			return '<span class="opp-chip">' + p + '</span>';
		}).join("");
	}

	function markActiveSelects(filters) {
		["opp-f-department", "opp-f-territory", "opp-f-stage", "opp-f-stage1", "opp-f-industry", "opp-f-subindustry"].forEach(function (id) {
			var el = document.getElementById(id);
			if (!el) return;
			el.classList.toggle("active", el.value !== "all");
		});
	}

	// ── Summary cards ───────────────────────────────────────────────────────────
	function buildSummaryHTML(summary) {
		var panels = [
			{ key: "total", label: "Total — CF + GRC" },
			{ key: "CF",    label: "Corporate Finance (CF)" },
			{ key: "GRC",   label: "Corporate Governance (GRC)" },
		];
		return (
			'<div class="opp-grid-3">' +
			panels.map(function (p) {
				var s = summary[p.key];
				return (
					'<div class="opp-panel">' +
					'<div class="opp-panel-title">' + p.label + "</div>" +
					'<div class="opp-metric-group-title">Number of Opportunities</div>' +
					'<div class="opp-metric-row">' +
					_metric("total", s.numbers.total,       "Total") +
					_metric("won",  s.numbers.won,         "Won") +
					_metric("live", s.numbers.live,        "Live") +
					_metric("lost", s.numbers.lost,        "Lost") +
					_metric("pct",  s.numbers.win_pct + "%","Win Rate") +
					"</div>" +
					'<div class="opp-metric-group-title" style="margin-top:16px">Value of Opportunities (QAR)</div>' +
					'<div class="opp-metric-row">' +
					_metric("total", fmtCompact(s.values.total),      "Total") +
					_metric("won",  fmtCompact(s.values.won),         "Won") +
					_metric("live", fmtCompact(s.values.live),        "Live") +
					_metric("lost", fmtCompact(s.values.lost),        "Lost") +
					_metric("pct",  s.values.win_pct + "%",           "Win Rate") +
					"</div>" +
					"</div>"
				);
			}).join("") +
			"</div>"
		);
	}

	function _metric(cls, val, lbl) {
		return (
			'<div class="opp-metric ' + cls + '">' +
			'<div class="mv">' + val + "</div>" +
			'<div class="ml">' + lbl + "</div>" +
			"</div>"
		);
	}

	// ── Top-5 table ─────────────────────────────────────────────────────────────
	function buildTop5HTML(rows, label) {
		var body;
		if (!rows || rows.length === 0) {
			body = '<tr><td colspan="5" class="opp-empty">No live opportunities for this filter</td></tr>';
		} else {
			body = rows.map(function (r, i) {
				var statusBadge = r.status === "Quotation"
					? '<span class="badge badge-quotation">Quotation</span>'
					: '<span class="badge badge-open">Open</span>';
				var stageBadge = r.sales_stage
					? '<span class="badge badge-stage">' + r.sales_stage + '</span>'
					: "—";
				return (
					"<tr>" +
					"<td>" + (i + 1) + "</td>" +
					"<td><div style='font-weight:600'>" + (r.title || r.customer_name) + "</div>" +
					'<div class="sub">' + r.name + "</div></td>" +
					"<td>" + stageBadge + "</td>" +
					"<td>" + statusBadge + "</td>" +
					'<td class="r" style="font-weight:700">' + fmtNum(r.opportunity_amount) + "</td>" +
					"</tr>"
				);
			}).join("");
		}
		return (
			'<div class="opp-panel">' +
			'<div class="opp-panel-title">' + label + "</div>" +
			'<table class="opp-table"><thead><tr>' +
			"<th>#</th><th>Client</th><th>Stage</th><th>Status</th>" +
			'<th class="r">Value (QAR)</th>' +
			"</tr></thead><tbody>" + body + "</tbody></table>" +
			"</div>"
		);
	}

	// ── Doughnut chart ──────────────────────────────────────────────────────────
	// Every filter change / refresh calls renderDashboard() -> $body.html(html),
	// which replaces the DOM, then re-runs renderDoughnut()/renderPipelineChart()
	// against the fresh canvases. Chart.js keeps its own internal registry of
	// live chart instances that isn't cleared just because the old canvas was
	// removed from the DOM -- without an explicit .destroy() first, those stale
	// instances' ResizeObservers keep firing against now-detached nodes (the
	// "Failed to execute 'removeChild'" console errors), and a new chart can
	// silently fail to render, leaving the canvas blank. renderBarChart()
	// already destroys its previous instance before creating a new one --
	// applying that same pattern here for the doughnuts/pipeline chart.
	var _doughnutCharts = {};

	function renderDoughnut(canvasId, d) {
		var canvas = document.getElementById(canvasId);
		if (!canvas) return;
		if (_doughnutCharts[canvasId]) {
			_doughnutCharts[canvasId].destroy();
			_doughnutCharts[canvasId] = null;
		}
		var total = d.won + d.live + d.lost;

		var centerPlugin = {
			id: "center-" + canvasId,
			afterDraw: function (chart) {
				var ctx = chart.ctx;
				var cx = (chart.chartArea.left + chart.chartArea.right) / 2;
				var cy = (chart.chartArea.top + chart.chartArea.bottom) / 2;
				ctx.save();
				ctx.textAlign = "center";
				ctx.textBaseline = "middle";
				ctx.font = "bold 16px 'Inter', Arial, sans-serif";
				ctx.fillStyle = "#111827";
				ctx.fillText(fmtCompact(total), cx, cy - 9);
				ctx.font = "11px 'Inter', Arial, sans-serif";
				ctx.fillStyle = "#9ca3af";
				ctx.fillText("Total QAR", cx, cy + 10);
				ctx.restore();
			},
		};

		_doughnutCharts[canvasId] = new Chart(canvas, {
			type: "doughnut",
			plugins: [centerPlugin],
			data: {
				labels: ["Won", "Live / Ongoing", "Lost / Dead"],
				datasets: [{
					data: [d.won, d.live, d.lost],
					backgroundColor: ["#16a34a", "#3b82f6", "#ef4444"],
					hoverBackgroundColor: ["#15803d", "#2563eb", "#dc2626"],
					borderWidth: 3,
					borderColor: "#fff",
				}],
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				cutout: "62%",
				plugins: {
					legend: {
						position: "bottom",
						labels: { font: { size: 11 }, padding: 18, usePointStyle: true },
					},
					tooltip: {
						callbacks: {
							label: function (ctx) {
								var pct = total > 0 ? ((ctx.raw / total) * 100).toFixed(1) : 0;
								return "  " + ctx.label + ":  QAR " + fmtNum(ctx.raw) + "  (" + pct + "%)";
							},
						},
					},
				},
			},
		});
	}

	// ── Pipeline chart (stacked horizontal bar) ─────────────────────────────────
	var pipelineValueLabelsPlugin = {
		id: "pipelineValueLabels",
		afterDatasetsDraw: function (chart) {
			var ctx = chart.ctx;
			var datasets = chart.data.datasets;
			var topY = {}; // index -> smallest (topmost) y seen across datasets
			var totals = {}; // index -> sum of all dataset values

			datasets.forEach(function (dataset, dsIndex) {
				var meta = chart.getDatasetMeta(dsIndex);
				if (meta.hidden) return;
				meta.data.forEach(function (bar, index) {
					var value = dataset.data[index] || 0;
					var props = bar.getProps(["x", "y", "base"], true);

					totals[index] = (totals[index] || 0) + value;
					if (topY[index] === undefined || props.y < topY[index]) {
						topY[index] = props.y;
					}

					var segHeight = Math.abs(props.base - props.y);
					if (!value || segHeight < 14) return; // skip labels on segments too small to hold text
					ctx.save();
					ctx.fillStyle = "#fff";
					ctx.font = "bold 10px 'Inter', Arial, sans-serif";
					ctx.textAlign = "center";
					ctx.textBaseline = "middle";
					ctx.fillText(fmtCompact(value), props.x, (props.y + props.base) / 2);
					ctx.restore();
				});
			});

			// Total, bold, above each full stacked bar
			var firstMeta = chart.getDatasetMeta(0);
			firstMeta.data.forEach(function (bar, index) {
				var total = totals[index];
				if (!total) return;
				var props = bar.getProps(["x"], true);
				ctx.save();
				ctx.fillStyle = "#1f2937";
				ctx.font = "bold 12px 'Inter', Arial, sans-serif";
				ctx.textAlign = "center";
				ctx.textBaseline = "bottom";
				ctx.fillText(fmtCompact(total), props.x, topY[index] - 6);
				ctx.restore();
			});
		},
	};

	var _pipelineChart = null;

	function renderPipelineChart(pipeline) {
		var canvas = document.getElementById("opp-pipeline-chart");
		if (_pipelineChart) {
			_pipelineChart.destroy();
			_pipelineChart = null;
		}
		if (!canvas || !pipeline || pipeline.length === 0) return;

		var sorted = pipeline; // already sorted largest-first by the backend
		var labels = sorted.map(function (p) {
			return p.stage.length > 20 ? p.stage.substring(0, 18) + "…" : p.stage;
		});
		var cfVals   = sorted.map(function (p) { return p.cf_val; });
		var grcVals  = sorted.map(function (p) { return p.grc_val; });
		var fullData = sorted; // keep for tooltip

		_pipelineChart = new Chart(canvas, {
			type: "bar",
			plugins: [pipelineValueLabelsPlugin],
			data: {
				labels: labels,
				datasets: [
					{
						label: "Corporate Finance",
						data: cfVals,
						stack: "pipeline",
						backgroundColor: "rgba(59,130,246,.75)",
						borderColor: "#3b82f6",
						borderWidth: 1,
						borderRadius: 3,
					},
					{
						label: "Corporate Governance",
						data: grcVals,
						stack: "pipeline",
						backgroundColor: "rgba(124,58,237,.75)",
						borderColor: "#7c3aed",
						borderWidth: 1,
						borderRadius: 3,
					},
				],
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				layout: { padding: { top: 24 } },
				plugins: {
					legend: {
						position: "bottom",
						labels: { font: { size: 11 }, padding: 16, usePointStyle: true },
					},
					tooltip: {
						callbacks: {
							label: function (ctx) {
								var row = fullData[ctx.dataIndex];
								if (ctx.dataset.label.includes("Finance")) {
									return "  CF: QAR " + fmtNum(ctx.raw) + " (" + row.cf_cnt + " opps)";
								}
								return "  GRC: QAR " + fmtNum(ctx.raw) + " (" + row.grc_cnt + " opps)";
							},
							footer: function (items) {
								var row = fullData[items[0].dataIndex];
								return "  Total: QAR " + fmtNum(row.total_val) + " (" + row.total_cnt + " opps)";
							},
						},
					},
				},
				scales: {
					x: {
						stacked: true,
						ticks: { font: { size: 11 } },
						grid: { display: false },
					},
					y: {
						stacked: true,
						beginAtZero: true,
						ticks: {
							callback: function (v) { return "QAR " + fmtCompact(v); },
							font: { size: 11 },
						},
						grid: { color: "#f3f4f6" },
					},
				},
			},
		});
	}

	// ── Monthly bar chart ────────────────────────────────────────────────────────
	var _barChart = null;
	var BAR_COLORS = {
		total: { bg: "rgba(99,102,241,.7)",  border: "#6366f1" },
		CF:    { bg: "rgba(37,99,235,.7)",   border: "#2563eb" },
		GRC:   { bg: "rgba(124,58,237,.7)",  border: "#7c3aed" },
	};
	var BAR_LABELS = {
		total: "Total Live Value",
		CF:    "Corporate Finance — Live",
		GRC:   "Corporate Governance — Live",
	};

	var barValueLabelsPlugin = {
		id: "barValueLabels",
		afterDatasetsDraw: function (chart) {
			var ctx = chart.ctx;
			var meta = chart.getDatasetMeta(0);
			var dataset = chart.data.datasets[0];
			meta.data.forEach(function (bar, index) {
				var value = dataset.data[index];
				if (!value) return;
				var props = bar.getProps(["x", "y", "base"], true);
				var barHeight = Math.abs(props.base - props.y);
				var formatted = fmtCompact(value);
				ctx.save();
				ctx.font = "bold 12px 'Inter', Arial, sans-serif";
				ctx.textAlign = "center";
				if (barHeight > 24) {
					ctx.fillStyle = "#fff";
					ctx.textBaseline = "top";
					ctx.fillText(formatted, props.x, props.y + 8);
				} else {
					ctx.fillStyle = "#1f2937";
					ctx.textBaseline = "bottom";
					ctx.fillText(formatted, props.x, props.y - 4);
				}
				ctx.restore();
			});
		},
	};

	function renderBarChart(barData, filter) {
		if (_barChart) { _barChart.destroy(); _barChart = null; }
		var canvas = document.getElementById("opp-bar-chart");
		if (!canvas) return;

		var vals   = barData[filter === "CF" ? "cf" : filter === "GRC" ? "grc" : "total"];
		var months = barData.months.map(fmtMonth);
		var col    = BAR_COLORS[filter] || BAR_COLORS.total;

		_barChart = new Chart(canvas, {
			type: "bar",
			plugins: [barValueLabelsPlugin],
			data: {
				labels: months,
				datasets: [{
					label: BAR_LABELS[filter] || BAR_LABELS.total,
					data: vals,
					backgroundColor: col.bg,
					borderColor: col.border,
					borderWidth: 1,
					borderRadius: 5,
					borderSkipped: false,
				}],
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				layout: { padding: { top: 20 } },
				plugins: {
					legend: { display: false },
					tooltip: {
						callbacks: {
							label: function (ctx) { return "  QAR " + fmtNum(ctx.raw); },
						},
					},
				},
				scales: {
					y: {
						beginAtZero: true,
						ticks: {
							callback: function (v) { return "QAR " + fmtCompact(v); },
							font: { size: 11 },
						},
						grid: { color: "#f3f4f6" },
					},
					x: { ticks: { font: { size: 11 } }, grid: { display: false } },
				},
			},
		});
	}

	// ── Main render ──────────────────────────────────────────────────────────────
	function renderDashboard($body, data, filterBarHTML) {
		injectStyles();

		// Height must be in the HTML at DOM-insertion time; setting it via JS after the fact
		// does not trigger a layout reflow before Chart.js reads the canvas dimensions.
		var pipelineItems = data.pipeline || [];
		var pipelineH     = "380px";
		var pipelineTotal = pipelineItems.reduce(function (s, p) { return s + p.total_cnt; }, 0);

		// On mobile this chart has no room for one bar per sales stage, so
		// Chart.js squeezes/rotates everything to fit. Give the canvas's
		// measured parent real per-category width instead (same reasoning as
		// the height comment above -- must be inline at insertion time, JS
		// after the fact won't reflow before Chart.js reads it), wrapped in a
		// horizontally-scrollable box. Desktop already has enough width, so
		// this only kicks in under the same 900px breakpoint used elsewhere
		// on this page.
		var pipelineWidthStyle = "";
		var barWidthStyle = "";
		if (window.innerWidth <= 900) {
			var pipelineMinWidth = Math.max(pipelineItems.length * 100, 500);
			pipelineWidthStyle = "min-width:" + pipelineMinWidth + "px;";

			var barMonthCount = (data.bar && data.bar.months || []).length;
			var barMinWidth   = Math.max(barMonthCount * 100, 500);
			barWidthStyle = "min-width:" + barMinWidth + "px;";
		}

		var html =
			'<div class="opp-db">' +

			// Filter bar (pre-built HTML from bootstrap phase)
			filterBarHTML +

			// Summary
			'<h3 class="sec-title">Summary</h3>' +
			buildSummaryHTML(data.summary) +

			// Top 5
			'<h3 class="sec-title">Top 5 Live Opportunities by Value</h3>' +
			'<div class="opp-grid-2">' +
			buildTop5HTML(data.top5_cf,  "Corporate Finance (CF)") +
			buildTop5HTML(data.top5_grc, "Corporate Governance (GRC)") +
			"</div>" +

			// Pipeline — height embedded in HTML so Chart.js sees it on first layout pass
			'<h3 class="sec-title">Sales Stage Pipeline' +
			(pipelineTotal > 0
				? ' <span class="sec-count">' + pipelineTotal + ' ' + (pipelineTotal === 1 ? 'opp' : 'opps') + '</span>'
				: '') +
			'</h3>' +
			'<div class="opp-panel">' +
			'<div class="opp-chart-scroll">' +
			'<div style="position:relative;height:' + pipelineH + ';' + pipelineWidthStyle + '"><canvas id="opp-pipeline-chart"></canvas></div>' +
			"</div>" +
			"</div>" +

			// Doughnuts
			'<h3 class="sec-title">Opportunity Value by Status</h3>' +
			'<div class="opp-grid-3">' +
			'<div class="opp-panel"><div class="opp-panel-title">Total — CF + GRC</div>' +
			'<div style="position:relative;height:290px"><canvas id="doughnut-total"></canvas></div></div>' +
			'<div class="opp-panel"><div class="opp-panel-title">Corporate Finance (CF)</div>' +
			'<div style="position:relative;height:290px"><canvas id="doughnut-CF"></canvas></div></div>' +
			'<div class="opp-panel"><div class="opp-panel-title">Corporate Governance (GRC)</div>' +
			'<div style="position:relative;height:290px"><canvas id="doughnut-GRC"></canvas></div></div>' +
			"</div>" +

			// Monthly bar
			'<h3 class="sec-title">Monthly Live Opportunity Value</h3>' +
			'<div class="opp-panel">' +
			'<div class="bar-controls"><label>View:</label>' +
			'<select id="opp-bar-filter" class="opp-select" style="min-width:200px">' +
			'<option value="total">Total (CF + GRC)</option>' +
			'<option value="CF">Corporate Finance (CF)</option>' +
			'<option value="GRC">Corporate Governance (GRC)</option>' +
			"</select></div>" +
			'<div class="opp-chart-scroll">' +
			'<div style="position:relative;height:320px;' + barWidthStyle + '"><canvas id="opp-bar-chart"></canvas></div>' +
			"</div>" +
			"</div>" +

			"</div>"; // .opp-db

		$body.html(html);

		loadChartJs(function () {
			renderDoughnut("doughnut-total", data.doughnut.total);
			renderDoughnut("doughnut-CF",  data.doughnut.CF);
			renderDoughnut("doughnut-GRC", data.doughnut.GRC);
			renderPipelineChart(data.pipeline);
			renderBarChart(data.bar, "total");

			var barSel = document.getElementById("opp-bar-filter");
			if (barSel) {
				barSel.addEventListener("change", function () {
					renderBarChart(data.bar, this.value);
				});
			}
		});
	}

	// ── Page entry point ─────────────────────────────────────────────────────────
	frappe.pages["opportunity-analytics-report"].on_page_load = function (wrapper) {
		var page = frappe.ui.make_app_page({
			parent: wrapper,
			title: __("Opportunity Analytics Report"),
			single_column: true,
		});

		page.add_action_item(__("Refresh"), function () { loadData(); });
		page.add_action_item(__("Export to Excel"), function () { exportToExcel(lastData, filters); });
		page.add_action_item(__("Export to PDF"), function () { exportToPDF(lastData, filters); });

		var $body    = $(wrapper).find(".layout-main-section");
		var filters  = { department: "all", territory: "all", sales_stage: "all", sales_stage_1: "all", industry: "all", sub_industry: "all" };
		var filterBarHTML = ""; // built after get_filter_options
		var lastData = null; // most recently rendered data, kept for Export to Excel

		function applyFilters() {
			updateFilterChips(filters);
			markActiveSelects(filters);
			loadData();
		}

		function bindFilterListeners() {
			var deptSel     = document.getElementById("opp-f-department");
			var terSel      = document.getElementById("opp-f-territory");
			var stageSel    = document.getElementById("opp-f-stage");
			var stage1Sel   = document.getElementById("opp-f-stage1");
			var industrySel = document.getElementById("opp-f-industry");
			var subIndSel   = document.getElementById("opp-f-subindustry");
			var clearBtn    = document.getElementById("opp-f-clear");

			if (deptSel) {
				deptSel.value = filters.department;
				deptSel.addEventListener("change", function () {
					filters.department = this.value;
					applyFilters();
				});
			}
			if (terSel) {
				terSel.value = filters.territory;
				terSel.addEventListener("change", function () {
					filters.territory = this.value;
					applyFilters();
				});
			}
			if (stageSel) {
				stageSel.value = filters.sales_stage;
				stageSel.addEventListener("change", function () {
					filters.sales_stage = this.value;
					applyFilters();
				});
			}
			if (stage1Sel) {
				stage1Sel.value = filters.sales_stage_1;
				stage1Sel.addEventListener("change", function () {
					filters.sales_stage_1 = this.value;
					applyFilters();
				});
			}
			if (industrySel) {
				industrySel.value = filters.industry;
				industrySel.addEventListener("change", function () {
					filters.industry = this.value;
					applyFilters();
				});
			}
			if (subIndSel) {
				subIndSel.value = filters.sub_industry;
				subIndSel.addEventListener("change", function () {
					filters.sub_industry = this.value;
					applyFilters();
				});
			}
			if (clearBtn) {
				clearBtn.addEventListener("click", function () {
					filters.department    = "all";
					filters.territory     = "all";
					filters.sales_stage   = "all";
					filters.sales_stage_1 = "all";
					filters.industry      = "all";
					filters.sub_industry  = "all";
					if (deptSel)     { deptSel.value     = "all"; deptSel.classList.remove("active"); }
					if (terSel)      { terSel.value      = "all"; terSel.classList.remove("active"); }
					if (stageSel)    { stageSel.value    = "all"; stageSel.classList.remove("active"); }
					if (stage1Sel)   { stage1Sel.value   = "all"; stage1Sel.classList.remove("active"); }
					if (industrySel) { industrySel.value = "all"; industrySel.classList.remove("active"); }
					if (subIndSel)   { subIndSel.value   = "all"; subIndSel.classList.remove("active"); }
					applyFilters();
				});
			}
		}

		function loadData() {
			// Keep filter bar visible during reload, only swap inner sections
			var existingBar = $body.find(".opp-filter-bar");
			if (existingBar.length && filterBarHTML) {
				// Only show spinner below the filter bar
				existingBar.nextAll().remove();
				existingBar.after(
					'<div style="padding:60px;text-align:center;color:#9ca3af;font-size:14px">' +
					__("Loading…") + "</div>"
				);
			} else {
				$body.html(
					'<div style="padding:80px;text-align:center;color:#9ca3af;font-size:14px">' +
					__("Loading…") + "</div>"
				);
			}

			frappe.call({
				method: "masar_haus.masar_haus.page.opportunity_analytics_report.opportunity_analytics_report.get_dashboard_data",
				args: {
					department: filters.department,
					territory: filters.territory,
					sales_stage: filters.sales_stage,
					sales_stage_1: filters.sales_stage_1,
					industry: filters.industry,
					sub_industry: filters.sub_industry,
				},
				callback: function (r) {
					if (!r.message) return;
					lastData = r.message;
					renderDashboard($body, r.message, filterBarHTML);
					bindFilterListeners();
					updateFilterChips(filters);
					markActiveSelects(filters);
				},
			});
		}

		// Bootstrap: load filter options first, then data
		frappe.call({
			method: "masar_haus.masar_haus.page.opportunity_analytics_report.opportunity_analytics_report.get_filter_options",
			callback: function (r) {
				if (r.message) {
					filterBarHTML = buildFilterBarHTML(r.message);
				}
				loadData();
			},
		});
	};
})();
