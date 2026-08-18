(function () {
	"use strict";

	// ── TEMP DIAGNOSTIC (remove once the cold-load freeze is root-caused) ───────
	// A phone in its own normal browser has no attached devtools, so console.log
	// alone is useless for reproducing this -- this appends timestamped lines to
	// a small always-visible on-page overlay instead, in addition to still
	// console.log-ing everything for whenever a desktop repro DOES have
	// devtools open. pointer-events:none so it never blocks the very touch-
	// scroll gesture we're trying to test. Registered/created lazily on first
	// use (not tied to on_page_load's own timing) so it can catch errors that
	// happen before on_page_load even runs.
	var __opp_debug_t0 = null;
	function logStep(msg) {
		var now = (window.performance && performance.now) ? performance.now() : Date.now();
		if (__opp_debug_t0 === null) __opp_debug_t0 = now;
		var line = "[+" + (now - __opp_debug_t0).toFixed(0) + "ms] " + msg;
		console.log("[opp-debug]", line);

		var el = document.getElementById("opp-debug-overlay");
		if (!el && document.body) {
			el = document.createElement("div");
			el.id = "opp-debug-overlay";
			// Kept intentionally small (not full-width/half-screen) -- this is a
			// diagnostic aid for testing real page content, not the thing under
			// test; anything larger risks visually/functionally getting in the
			// way of the very scroll gesture being reproduced.
			el.style.cssText =
				"position:fixed;left:8px;bottom:8px;max-width:70vw;max-height:42vh;" +
				"overflow-y:auto;background:rgba(0,0,0,.82);color:#7CFC00;" +
				"font-family:monospace;font-size:10px;line-height:1.4;padding:6px 8px;" +
				"border-radius:6px;z-index:999999;pointer-events:none;" +
				"white-space:pre-wrap;word-break:break-word;";
			document.body.appendChild(el);

			// Appended as a SIBLING of the overlay (not a child) -- a child would
			// inherit the overlay's pointer-events:none and need an explicit
			// override; living outside that subtree entirely means it's
			// trivially tappable with no override needed, and it isn't a
			// descendant of `wrapper` either, so attach_axis_lock_scroll()'s own
			// pointerdown/pointermove listeners (bound to `wrapper`) never see
			// taps on it. Bottom-right so it doesn't overlap the bottom-left log.
			var btn = document.createElement("button");
			btn.id = "opp-debug-probe-btn";
			btn.textContent = "Probe now";
			btn.style.cssText =
				"position:fixed;right:8px;bottom:8px;z-index:1000000;" +
				"pointer-events:auto;background:#4338ca;color:#fff;border:none;" +
				"border-radius:6px;padding:8px 12px;font-size:12px;font-family:sans-serif;" +
				"box-shadow:0 2px 6px rgba(0,0,0,.4);";
			btn.addEventListener("click", probeNow);
			document.body.appendChild(btn);
		}
		if (el) {
			var row = document.createElement("div");
			row.textContent = line;
			el.appendChild(row);
			el.scrollTop = el.scrollHeight;
		}
	}

	// CONFIRMED root causes (via live "Probe now" evidence + reading frappe
	// core, not guessed) -- TWO independent, unrelated mechanisms in Frappe
	// core, both of which leave document.body.style.overflow stuck at
	// "hidden" with nothing left to undo it:
	//
	// 1. frappe.ui.Dialog's hide_scrollbar() (frappe/public/js/frappe/ui/
	//    dialog.js) does `$("body").css("overflow", bool ? "hidden" :
	//    "auto")`, wired to Bootstrap's own "shown.bs.modal"/"hide.bs.modal"
	//    events on EVERY Dialog instance (msgprint, confirm, prompt, error
	//    dialogs -- all of it). If a "hide.bs.modal" event doesn't fire (a
	//    known Bootstrap CSS-transition-completion edge case), "hidden"
	//    sticks. One-shot only, tied to whatever dialog happened to be open.
	//
	// 2. frappe.ui.Page's mobile sidebar-toggle button (.sidebar-toggle-btn,
	//    CSS-hidden at >=992px -- frappe/public/scss/desk/page.scss -- i.e.
	//    ONLY exists/tappable on mobile, matching "mobile only" exactly)
	//    calls sidebar.set_height() on EVERY click, unconditionally
	//    (frappe/public/js/frappe/ui/sidebar/sidebar.js), which does
	//    `document.body.style.overflow = "hidden"` with NO corresponding
	//    restore anywhere in that file's open()/close()/toggle_width() --
	//    prevent_scroll() only ever touches .main-section's overflow, never
	//    body's. This explains "recurs during normal use, not just on load":
	//    every single tap of that always-on-mobile header button does this,
	//    with no dialog and no filter change required at all.
	//
	// Neither is fixable at its real source from this app -- both are core
	// frappe files shared by every dialog and every desk page in the whole
	// framework; overriding them here wouldn't survive a framework update
	// and is out of scope for an app-level fix. This is a scoped, CONTINUOUS
	// defensive backstop instead: a MutationObserver watching body's
	// style/class attributes for the rest of this page's life (not a
	// one-shot check), clearing the stuck style whenever it happens, but
	// ONLY when no dialog is actually tracked as open (so a legitimately
	// open dialog's intentional scroll-lock is never touched).
	function clearStuckBodyOverflowLock() {
		function checkAndClear() {
			var noDialogOpen =
				!window.cur_dialog &&
				!(frappe.ui.open_dialogs && frappe.ui.open_dialogs.length) &&
				!document.querySelector(".modal-backdrop, .modal.show, .modal.in");
			if (noDialogOpen && document.body.style.overflow === "hidden") {
				logStep("DEFENSIVE: body.style.overflow stuck at 'hidden' with no dialog open -- clearing it");
				document.body.style.overflow = "";
			}
		}
		checkAndClear(); // in case it's already stuck by the time this runs
		new MutationObserver(checkAndClear).observe(document.body, {
			attributes: true,
			attributeFilter: ["style", "class"],
		});
		// Belt-and-suspenders: a live session showed the stuck state recurring
		// with NO corresponding "clearing it" log line from the observer above
		// -- meaning it isn't firing reliably every time this happens on every
		// device/browser (still unconfirmed why; possibly a MutationObserver
		// timing quirk, possibly this simply hadn't redeployed yet for that
		// specific test). A redundant poll for the rest of the page's life
		// costs nothing and doesn't depend on the observer to have caught the
		// mutation in the first place.
		setInterval(checkAndClear, 1000);
	}

	// On-demand snapshot of exactly the dimensions/computed-style values that
	// matter for "is something clipping/trapping this page's scroll," captured
	// at the moment of a tap rather than only at on_page_load's startup --
	// the freeze only shows up several seconds in, after the client has
	// already tried to scroll, so the startup-only checkpoints above can't
	// see it. Call twice per repro (right after load, and again once frozen)
	// so the two snapshots can be diffed.
	function describeStyle(el, props) {
		if (!el) return "(not found)";
		var cs = getComputedStyle(el);
		return props.map(function (p) { return p + "=" + cs[p]; }).join(" ");
	}

	function probeNow() {
		logStep("════ PROBE @ " + new Date().toLocaleTimeString() + " ════");
		logStep(
			"viewport: innerWidth=" + window.innerWidth +
			" innerHeight=" + window.innerHeight +
			" devicePixelRatio=" + window.devicePixelRatio
		);

		var mainSection = document.querySelector(".main-section");
		logStep(
			mainSection
				? ".main-section: scrollHeight=" + mainSection.scrollHeight +
				  " clientHeight=" + mainSection.clientHeight +
				  " scrollTop=" + mainSection.scrollTop +
				  " | " + describeStyle(mainSection, ["overflow", "overflowY", "height", "position"])
				: ".main-section: NOT FOUND"
		);

		var oppDb = document.querySelector(".opp-db");
		logStep(
			oppDb
				? ".opp-db: scrollHeight=" + oppDb.scrollHeight +
				  " offsetHeight=" + oppDb.offsetHeight +
				  " | " + describeStyle(oppDb, ["overflow", "height", "position", "maxHeight"])
				: ".opp-db: NOT FOUND"
		);

		logStep("html: " + describeStyle(document.documentElement, ["overflow", "height"]));
		logStep(
			"body: " + describeStyle(document.body, ["overflow", "height"]) +
			' | inline style.overflow="' + document.body.style.overflow + '"' +
			' | className="' + document.body.className + '"'
		);
		logStep(
			"dialog state: cur_dialog=" + !!window.cur_dialog +
			" open_dialogs.length=" + ((frappe.ui && frappe.ui.open_dialogs && frappe.ui.open_dialogs.length) || 0) +
			" .modal-backdrop count=" + document.querySelectorAll(".modal-backdrop").length +
			" .modal.show/.in count=" + document.querySelectorAll(".modal.show, .modal.in").length
		);

		["opp-pipeline-chart", "opp-bar-chart"].forEach(function (canvasId) {
			var canvas = document.getElementById(canvasId);
			var wrapperEl = canvas && canvas.parentElement;
			logStep(
				wrapperEl
					? "#" + canvasId + " wrapper: offsetWidth=" + wrapperEl.offsetWidth +
					  " offsetHeight=" + wrapperEl.offsetHeight +
					  ' inlineStyle="' + wrapperEl.getAttribute("style") + '"'
					: "#" + canvasId + " wrapper: NOT FOUND"
			);
		});

		if (oppDb) {
			var zeroSized = [];
			oppDb.querySelectorAll("*").forEach(function (el) {
				if (el.children.length > 0 && (el.offsetWidth === 0 || el.offsetHeight === 0)) {
					zeroSized.push(
						el.tagName + (el.className ? "." + String(el.className).replace(/\s+/g, ".") : "") +
						" (w=" + el.offsetWidth + " h=" + el.offsetHeight + ")"
					);
				}
			});
			logStep(
				zeroSized.length
					? "ZERO-SIZED elements with children (" + zeroSized.length + "): " + zeroSized.slice(0, 10).join(" | ")
					: "no zero-sized elements with children found inside .opp-db"
			);
		}

		logStep("════ PROBE END ════");
	}

	// Safety net: many freezes/silent-death bugs turn out to be an uncaught
	// error or unhandled promise rejection partway through a chain that
	// otherwise looks fine step-by-step -- catch those globally too, not just
	// the explicit checkpoints below. Registered here, at the very top of the
	// IIFE, so they're active even before on_page_load itself runs.
	window.addEventListener("error", function (e) {
		logStep("UNCAUGHT ERROR: " + e.message + " @ " + e.filename + ":" + e.lineno);
	});
	window.addEventListener("unhandledrejection", function (e) {
		logStep("UNHANDLED REJECTION: " + (e.reason && e.reason.message || e.reason));
	});

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
		s.onload = function () {
			// Mobile perf: this page can have 5 live canvases at once (3 doughnuts +
			// pipeline + monthly bar), each rendered at full devicePixelRatio (2-3x on
			// most phones) -- capping that materially cuts GPU/paint cost on a
			// canvas-heavy page without a visible quality loss, which matters once the
			// page is long enough (single-column mobile layout) that scrolling has to
			// composite past all of them.
			window.Chart.defaults.devicePixelRatio = Math.min(window.devicePixelRatio || 1, 2);
			cb();
		};
		document.head.appendChild(s);
	}

	// ── CSS ─────────────────────────────────────────────────────────────────────
	var CSS_ID = "opp-db-styles-v14";
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
  /* The single-column mobile layout stacks ~10 of these cards (summary,
     top-5, doughnuts, charts) into one long scrollable page -- containment
     tells the browser each card's own layout/style changes can't affect
     anything outside it, so scrolling doesn't have to re-check the whole
     page's layout on every frame. contain:paint is deliberately left out --
     it would clip this card's own box-shadow and the Top-5 tables'
     horizontal overflow-x at 560px (see below). */
  contain: layout style;
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
/* Loading indicator for a data reload -- deliberately just an in-place swap
   of $body's own innerHTML (position:static, no fixed positioning, nothing
   touching document.body itself), NOT frappe.dom.freeze() or any Dialog.
   Keeping it this way is the point: it can't be the thing that gets body's
   scroll stuck, since it never reaches outside its own container. */
.opp-loading {
  display: flex; flex-direction: column; align-items: center; gap: 12px;
  padding: 60px 20px; color: #9ca3af; font-size: 14px;
}
.opp-spinner {
  width: 28px; height: 28px; border-radius: 50%;
  border: 3px solid #e5e7eb; border-top-color: #6366f1;
  animation: opp-spin 0.8s linear infinite;
}
@keyframes opp-spin { to { transform: rotate(360deg); } }
/* Scroll-progress indicator: hidden by default, shown only at <=560px (see
   that media query below) and explicitly re-hidden for print further down. */
.opp-scroll-track, .opp-scroll-thumb { display: none; }
@media (max-width: 900px) {
  /* Summary panels, Top-5 tables, and the status doughnuts are wide,
     content-heavy cards. These used to become a horizontally-swipeable
     carousel here (flex row + overflow-x: auto + scroll-snap), on the
     theory that cards keep a comfortable width and you swipe between them.
     In practice, a single card is tall enough to fill the whole viewport
     below the filter bar on a phone, so a vertical swipe has nowhere to
     land except on top of the carousel -- and confirmed on a real Android
     device, that carousel can capture the vertical gesture instead of
     letting it bubble up to scroll the page, even with touch-action set,
     making the page unscrollable past the first card. Collapsing to a
     single grid column instead removes the horizontal-scroll surface
     entirely -- cards stack full-width, vertically, in normal block flow,
     so there's no competing scroll axis for the browser to get wrong. */
  .opp-grid-3, .opp-grid-2 {
    grid-template-columns: 1fr;
  }
  /* Sales Stage Pipeline chart: its measured width comes from a min-width
     set inline in renderDashboard() (see pipelineWidthStyle) so Chart.js
     draws one legible bar per stage instead of squeezing all of them into
     the viewport -- this scrolls that overflow instead of clipping it.
     Genuinely needs horizontal scroll (many categories, unlike the cards
     above), so touch-action stays here as defense-in-depth -- this region
     is a single ~380px/~220px-tall panel, not most of the viewport, so it
     wasn't implicated in the reported stuck-page screenshots. */
  .opp-chart-scroll {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    touch-action: pan-x;
    overscroll-behavior-x: contain;
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
     letting cell text wrap into an unreadable stack. Same nested-scroll
     vertical-gesture-capture risk as the carousels above, so same fix.
     Scoped to :has(.opp-table) specifically -- .opp-panel is also the class
     on the Summary/Doughnut/chart cards, none of which have any horizontal
     content to scroll; applying touch-action:pan-x to those too would give
     attach_axis_lock_scroll() below no way to tell "genuinely needs
     horizontal scroll" from "never did," so every vertical drag on most of
     the page would go through its manual (momentum-free) scroll instead of
     the browser's normal smooth one.
     KEEP THIS SELECTOR IDENTICAL to the regionSelector passed to
     attach_axis_lock_scroll(wrapper, ...) at the on_page_load call site
     near the bottom of this file -- any element this rule restricts with
     touch-action:pan-x needs attach_axis_lock_scroll() to also recognize it
     via regionSelector, or a vertical drag starting on it silently does
     nothing (no error, just an inert page) instead of scrolling. */
  .opp-panel:has(.opp-table) { overflow-x: auto; touch-action: pan-x; overscroll-behavior-x: contain; }
  .opp-table { white-space: nowrap; }

  /* Custom scroll-progress indicator (approved design) -- mobile scrollbars
     are thin/auto-hiding and easy to miss on a page this long, so this gives
     a persistent visual cue of how far down the page you are. pointer-events:
     none on both -- this sits on top of real content and must never
     intercept a tap. Position/height are set by JS on scroll (see
     setup_scroll_indicator() below); the CSS here only handles static
     appearance and visibility. */
  .opp-scroll-track {
    display: block;
    position: fixed;
    top: 0; right: 0; bottom: 0;
    width: 5px;
    background: rgba(99,102,241,.08);
    border-radius: 3px;
    pointer-events: none;
    z-index: 10000;
  }
  .opp-scroll-thumb {
    position: absolute;
    top: 0; right: 0;
    width: 5px;
    background: linear-gradient(180deg,#818cf8,#4338ca);
    border-radius: 3px;
    pointer-events: none;
  }
}
/* Fallback for manually printing this page (Ctrl+P) -- Actions -> Export to
   PDF no longer goes through window.print() (see exportToPDF/buildPDF: it
   turned out unreliable -- charts didn't print, a card was cut mid-way at a
   page break, and the desk sidebar leaked into the output -- so that action
   now builds the PDF directly instead). Kept for whoever prints by hand
   anyway: print page width often lands inside the max-width:900/560px
   ranges above (they're not print-qualified, so they'd otherwise apply
   here too), which would print the summary/top-5/doughnut grids
   single-column (see the mobile collapse above) instead of the multi-column
   layout a printed report should use. Force the desktop grid back for
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
  .opp-scroll-track, .opp-scroll-thumb { display: none !important; }
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
				resizeDelay: 200,
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
				resizeDelay: 200,
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
				resizeDelay: 200,
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

	// ── Mobile scroll-progress indicator (approved design) ──────────────────────
	// requestAnimationFrame-throttled rather than debounced (see debounce() in
	// masar_haus.bundle.js for the equivalent pattern used elsewhere in this
	// app) -- debounce would only move the thumb once scrolling stops, but the
	// spec calls for it to visibly track the scroll position live, so this
	// coalesces updates to at most once per frame instead of delaying them.
	function raf_throttle(fn) {
		var scheduled = false;
		return function () {
			var args = arguments, ctx = this;
			if (scheduled) return;
			scheduled = true;
			requestAnimationFrame(function () {
				scheduled = false;
				fn.apply(ctx, args);
			});
		};
	}

	// On a cold/direct load of this route (URL typed/pasted/bookmarked as the
	// tab's first page, not navigated to from inside the desk app), the
	// surrounding desk shell -- including .main-section -- can still be mid-
	// assembly at the exact moment on_page_load fires, since that's async
	// framework startup, not something this page's own script controls. A
	// one-shot document.querySelector(".main-section") at setup time can
	// therefore silently find nothing on that specific load path (reproduced
	// only via a cold load, never via SPA-internal navigation, which is
	// exactly the signature of a startup race rather than a real absence) --
	// and both setup_scroll_indicator() and attach_axis_lock_scroll() below
	// used to just bail out when that happened, with no console error,
	// silently reintroducing the original scroll-lock bug on that one load
	// path. Polling via rAF (not a fixed setTimeout, which would be a guess
	// at "long enough" that's fragile across devices/network speeds) instead
	// keeps trying until the element genuinely exists, with a 5s cap so a
	// truly broken page fails loudly (console.warn) instead of retrying
	// forever unnoticed.
	// retryCount/startedAt params are TEMP DIAGNOSTIC only (see logStep above) --
	// remove along with the logStep calls below once this is root-caused.
	function whenScrollElReady(cb, deadline, retryCount, startedAt) {
		startedAt = startedAt || Date.now();
		deadline = deadline || (startedAt + 5000);
		retryCount = retryCount || 0;
		var el = document.querySelector(".main-section");
		if (el) {
			logStep(".main-section found after " + retryCount + " retries / " + (Date.now() - startedAt) + "ms");
			return cb(el);
		}
		if (Date.now() > deadline) {
			logStep(".main-section NEVER FOUND after " + retryCount + " retries / " + (Date.now() - startedAt) + "ms -- giving up");
			console.warn("opportunity_analytics_report: .main-section never appeared; scroll indicator/axis-lock fix not attached.");
			return;
		}
		logStep(".main-section not found, retry " + retryCount);
		requestAnimationFrame(function () { whenScrollElReady(cb, deadline, retryCount + 1, startedAt); });
	}

	// Frappe desk pages don't unmount on navigation -- frappe.container.
	// change_to() (frappe/public/js/frappe/views/container.js) just hides the
	// previous page's wrapper and shows this one, triggering jQuery "hide"/
	// "show" events on it either way, for the rest of the session. .main-
	// section (frappe/www/desk.html) is the one scroll container shared by
	// every desk route -- confirmed directly against a live diagnostic on the
	// actual device during the mobile-scroll-lock investigation on this page,
	// not assumed. The listener has to be added/removed on those same show/
	// hide events: added too early it does nothing (nothing to attach to
	// yet), and left attached after navigating away it would keep
	// recalculating on every OTHER page's scrolling for no reason.
	function setup_scroll_indicator(wrapper) {
		whenScrollElReady(function (scrollEl) {
			var $track = $('<div class="opp-scroll-track"></div>').appendTo(wrapper);
			var $thumb = $('<div class="opp-scroll-thumb"></div>').appendTo($track);

			function update() {
				var trackH = $track[0].clientHeight;
				if (!trackH) return;
				var scrollableH = scrollEl.scrollHeight - scrollEl.clientHeight;
				var pct = scrollableH > 0 ? scrollEl.scrollTop / scrollableH : 0;
				// Measuring the track's OWN clientHeight here (rather than
				// scrollEl's) keeps the thumb pixel-accurate even when the two
				// briefly disagree -- e.g. .main-section's 100vh can measure
				// taller than the real visible viewport while a mobile browser's
				// address bar is mid-collapse.
				var thumbH = Math.min(Math.max(trackH * 0.18, 40), trackH);
				$thumb.css({ height: thumbH + "px", top: (pct * (trackH - thumbH)) + "px" });
			}

			var throttled_update = raf_throttle(update);

			function attach() {
				scrollEl.addEventListener("scroll", throttled_update, { passive: true });
				update();
			}
			function detach() {
				scrollEl.removeEventListener("scroll", throttled_update);
			}

			$(wrapper).on("show", attach);
			$(wrapper).on("hide", detach);
		});
	}

	// ── Vertical-swipe-blocked-on-horizontal-scroll fix (approved design) ───────
	// .opp-chart-scroll (Pipeline chart) and .opp-panel (Top-5 tables, at
	// <=560px -- see the injected CSS above) are touch-action: pan-x so they
	// can be swiped sideways without hijacking the page scroll. touch-action
	// alone can't tell "this drag turned out vertical" from "horizontal" until
	// it's already committed to the pan-x axis, so the browser reserves BOTH
	// directions for itself on those elements, silently swallowing vertical
	// drags that start there. Pointer Events (not touchstart/touchmove) cover
	// touch and pen/mouse with one code path; gated to pointerType === "touch"
	// below so it doesn't also hijack mouse-drag text selection on desktop,
	// where touch-action:pan-x isn't even in effect.
	//
	// Delegated on `wrapper` (the page's own root, passed into on_page_load --
	// the SAME stable node setup_scroll_indicator() above attaches to), not on
	// .opp-db itself: .opp-db is rebuilt from scratch as a raw HTML string on
	// every filter change (see renderDashboard()'s $body.html(html)), so it
	// would already be a *different* DOM node than whatever a real "attach
	// once" would have bound to. `wrapper` never gets replaced, only its
	// contents do -- e.target.closest(regionSelector) re-resolves the actual
	// scrollable ancestor fresh on every gesture, so this keeps working after
	// any re-render without re-attaching anything.
	function attach_axis_lock_scroll(wrapper, regionSelector) {
		whenScrollElReady(function (scrollEl) {
			var DEAD_ZONE = 6;
			var state = null;

			// passive: false is required for preventDefault() below to actually
			// suppress the browser's own touch-action-driven handling once the
			// axis locks to "y" -- but a non-passive listener registered
			// unconditionally on `wrapper` (the whole page) would force the
			// browser to run this handler synchronously, and wait to see if
			// preventDefault() gets called, for EVERY touch move anywhere on the
			// page, even over cards that never match regionSelector -- that's
			// what caused scrolling from a card to feel janky. Only attaching it
			// for the duration of a gesture that actually started in a matching
			// region (added in pointerdown below, removed in reset()) keeps every
			// other touch move on the page fully native/passive.
			// TEMP DIAGNOSTIC: logStep calls in this function/handler are for the
			// cold-load-freeze investigation -- remove along with the rest of the
			// overlay once that's root-caused.
			function onPointerMove(e) {
				if (!state || e.pointerId !== state.pointerId) return;

				if (!state.axis) {
					var dx = e.clientX - state.startX;
					var dy = e.clientY - state.startY;
					if (Math.abs(dx) < DEAD_ZONE && Math.abs(dy) < DEAD_ZONE) return;
					state.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
					logStep("onPointerMove: axis resolved to '" + state.axis + "' (pointerId=" + e.pointerId + ")");
				}

				if (state.axis === "y") {
					var before = scrollEl.scrollTop;
					e.preventDefault();
					scrollEl.scrollTop -= e.clientY - state.lastY;
					state.lastY = e.clientY;
					logStep(
						"onPointerMove y-axis: scrollTop " + before + " -> " + scrollEl.scrollTop +
						(before === scrollEl.scrollTop ? " (UNCHANGED -- scroll did not actually move)" : "")
					);
				}
				// axis === "x": do nothing -- native overflow-x + touch-action:pan-x
				// already handles it exactly as today.
			}

			wrapper.addEventListener("pointerdown", function (e) {
				if (e.pointerType !== "touch") return;
				var region = e.target.closest(regionSelector);
				var targetDesc = e.target.tagName + (e.target.className ? "." + String(e.target.className).replace(/\s+/g, ".") : "");
				logStep(
					"pointerdown: pointerId=" + e.pointerId + " target=" + targetDesc +
					" regionMatch=" + !!region
				);
				if (!region) return;
				state = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, lastY: e.clientY, axis: null };
				wrapper.addEventListener("pointermove", onPointerMove, { passive: false });
			});

			function reset(e) {
				if (!state || e.pointerId !== state.pointerId) return;
				state = null;
				wrapper.removeEventListener("pointermove", onPointerMove);
			}
			wrapper.addEventListener("pointerup", reset);
			wrapper.addEventListener("pointercancel", reset);
			wrapper.addEventListener("pointerleave", reset);
		});
	}

	// ── Page entry point ─────────────────────────────────────────────────────────
	frappe.pages["opportunity-analytics-report"].on_page_load = function (wrapper) {
		logStep("on_page_load start");
		logStep(
			"env: UA=" + navigator.userAgent +
			" | readyState=" + document.readyState +
			" | .main-section present at start=" + !!document.querySelector(".main-section") +
			" | performance.now=" + performance.now().toFixed(0)
		);
		logStep("wrapper received: truthy=" + !!wrapper + " isConnected=" + !!(wrapper && wrapper.isConnected));

		clearStuckBodyOverflowLock();

		var page = frappe.ui.make_app_page({
			parent: wrapper,
			title: __("Opportunity Analytics Report"),
			single_column: true,
		});

		logStep("before setup_scroll_indicator");
		setup_scroll_indicator(wrapper);
		logStep("after setup_scroll_indicator returned");

		logStep("before attach_axis_lock_scroll");
		// KEEP THIS SELECTOR IDENTICAL to the touch-action:pan-x scope in
		// injectStyles() above (.opp-chart-scroll, .opp-panel:has(.opp-table))
		// -- if that CSS selector ever changes without this one following, any
		// newly-restricted element goes right back to silently swallowing
		// vertical drags with no error, just an inert page.
		attach_axis_lock_scroll(wrapper, ".opp-chart-scroll, .opp-panel:has(.opp-table)");
		logStep("after attach_axis_lock_scroll returned");

		page.add_action_item(__("Refresh"), function () { loadData(); });
		page.add_action_item(__("Export to Excel"), function () { exportToExcel(lastData, filters); });
		page.add_action_item(__("Export to PDF"), function () { exportToPDF(lastData, filters); });

		var $body    = $(wrapper).find(".layout-main-section");
		var filters  = { department: "all", territory: "all", sales_stage: "all", sales_stage_1: "all", industry: "all", sub_industry: "all" };
		var filterBarHTML = ""; // built after get_filter_options
		var lastData = null; // most recently rendered data, kept for Export to Excel
		// Bumped on every loadData() call, captured in each request's closure --
		// if a user changes filters again before the previous get_dashboard_data
		// call has returned, that older call's response is a stale answer to a
		// question nobody's asking anymore by the time it arrives, and rendering
		// it would overwrite whatever the newer (still in-flight or already-
		// rendered) request produced. Not confirmed to be related to the body-
		// overflow freeze investigated separately (see clearStuckBodyOverflowLock
		// above) -- this is a general data-consistency hygiene fix, kept
		// independent of that.
		var loadDataRequestToken = 0;
		var applyFiltersDebounceTimer = null;

		function applyFilters() {
			// Chip/active-select UI feedback stays instant; only the actual data
			// reload is debounced, so picking Department then Territory then
			// Sales Stage within a couple hundred ms fires ONE get_dashboard_data
			// call instead of three overlapping ones.
			updateFilterChips(filters);
			markActiveSelects(filters);
			clearTimeout(applyFiltersDebounceTimer);
			applyFiltersDebounceTimer = setTimeout(loadData, 250);
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
			logStep("loadData() started");
			var requestToken = ++loadDataRequestToken;
			// Keep filter bar visible during reload, only swap inner sections
			var loadingHTML = '<div class="opp-loading"><div class="opp-spinner"></div>' + __("Loading…") + "</div>";
			var existingBar = $body.find(".opp-filter-bar");
			if (existingBar.length && filterBarHTML) {
				// Only show spinner below the filter bar
				existingBar.nextAll().remove();
				existingBar.after(loadingHTML);
			} else {
				$body.html(loadingHTML);
			}

			logStep("get_dashboard_data AJAX call starting (token=" + requestToken + ")");
			frappe.call({
				method: "masar_haus.masar_haus.page.opportunity_analytics_report.opportunity_analytics_report.get_dashboard_data",
				// Explicit, not relying on the default (which is already falsy here
				// -- verified against frappe/public/js/frappe/request.js: opts.freeze
				// only ever becomes true if this option or args.freeze says so, and
				// neither did). frappe.dom.freeze() itself doesn't even touch body's
				// scroll (see clearStuckBodyOverflowLock() above for what actually
				// does) -- this is about never giving it a reason to be involved at
				// all, not about a behavior change from what was already happening.
				freeze: false,
				args: {
					department: filters.department,
					territory: filters.territory,
					sales_stage: filters.sales_stage,
					sales_stage_1: filters.sales_stage_1,
					industry: filters.industry,
					sub_industry: filters.sub_industry,
				},
				callback: function (r) {
					logStep("get_dashboard_data AJAX success callback fired (token=" + requestToken + ")");
					// The debounce above already coalesces same-tick filter changes
					// into one call, but this still covers a slower case it can't:
					// two calls both in flight (e.g. one already past the debounce
					// window when a further filter change starts a second), where
					// only the SECOND (latest) response should ever get rendered.
					if (requestToken !== loadDataRequestToken) {
						logStep("get_dashboard_data: stale response (token=" + requestToken + ", current=" + loadDataRequestToken + ") -- discarding");
						return;
					}
					if (!r.message) {
						logStep("get_dashboard_data: r.message is falsy -- aborting render");
						return;
					}
					lastData = r.message;
					logStep("renderDashboard() called");
					renderDashboard($body, r.message, filterBarHTML);
					logStep("renderDashboard() finished");
					bindFilterListeners();
					logStep("filters bound");
					updateFilterChips(filters);
					markActiveSelects(filters);
				},
				error: function (err) {
					logStep("get_dashboard_data AJAX ERROR (token=" + requestToken + "): " + JSON.stringify(err));
				},
			});
		}

		// Bootstrap: load filter options first, then data
		logStep("get_filter_options AJAX call starting");
		frappe.call({
			method: "masar_haus.masar_haus.page.opportunity_analytics_report.opportunity_analytics_report.get_filter_options",
			freeze: false, // explicit, see the note on the get_dashboard_data call above
			callback: function (r) {
				logStep("get_filter_options AJAX success callback fired");
				if (r.message) {
					filterBarHTML = buildFilterBarHTML(r.message);
				}
				logStep("loadData() called");
				loadData();
			},
			error: function (err) {
				logStep("get_filter_options AJAX ERROR: " + JSON.stringify(err));
			},
		});
	};
})();
