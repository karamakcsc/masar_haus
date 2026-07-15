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

	// ── Chart.js dynamic loader ─────────────────────────────────────────────────
	function loadChartJs(cb) {
		if (window.Chart) return cb();
		var s = document.createElement("script");
		s.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js";
		s.onload = cb;
		document.head.appendChild(s);
	}

	// ── CSS ─────────────────────────────────────────────────────────────────────
	var CSS_ID = "opp-db-styles-v5";
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
  .opp-grid-3 { grid-template-columns: 1fr; }
  .opp-grid-2 { grid-template-columns: 1fr; }
}
`;
		document.head.appendChild(el);
	}

	// ── Filter bar ──────────────────────────────────────────────────────────────
	function buildFilterBarHTML(opts) {
		var territoryOpts = '<option value="all">All Territories</option>' +
			opts.territories.map(function (t) {
				return '<option value="' + t + '">' + t + '</option>';
			}).join("");

		var stageOpts = '<option value="all">All Stages</option>' +
			opts.sales_stages.map(function (s) {
				return '<option value="' + s.replace(/"/g, "&quot;") + '">' + s + '</option>';
			}).join("");

		var stage1Opts = '<option value="all">All Sales Stage 1</option>' +
			(opts.sales_stages_1 || []).map(function (s) {
				return '<option value="' + s.replace(/"/g, "&quot;") + '">' + s + '</option>';
			}).join("");

		return (
			'<div class="opp-filter-bar">' +
			'<div class="opp-filter-item"><label>Territory</label>' +
			'<select id="opp-f-territory" class="opp-select">' + territoryOpts + '</select></div>' +
			'<div class="opp-filter-item"><label>Sales Stage</label>' +
			'<select id="opp-f-stage" class="opp-select">' + stageOpts + '</select></div>' +
			'<div class="opp-filter-item"><label>Sales Stage 1</label>' +
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
		if (filters.territory !== "all") parts.push(filters.territory);
		if (filters.sales_stage !== "all") parts.push(filters.sales_stage);
		if (filters.sales_stage_1 !== "all") parts.push(filters.sales_stage_1);
		chips.innerHTML = parts.map(function (p) {
			return '<span class="opp-chip">' + p + '</span>';
		}).join("");
	}

	function markActiveSelects(filters) {
		["opp-f-territory", "opp-f-stage", "opp-f-stage1"].forEach(function (id) {
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
	function renderDoughnut(canvasId, d) {
		var canvas = document.getElementById(canvasId);
		if (!canvas) return;
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

		new Chart(canvas, {
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

	function renderPipelineChart(pipeline) {
		var canvas = document.getElementById("opp-pipeline-chart");
		if (!canvas || !pipeline || pipeline.length === 0) return;

		var sorted = pipeline; // already sorted largest-first by the backend
		var labels = sorted.map(function (p) {
			return p.stage.length > 20 ? p.stage.substring(0, 18) + "…" : p.stage;
		});
		var cfVals   = sorted.map(function (p) { return p.cf_val; });
		var grcVals  = sorted.map(function (p) { return p.grc_val; });
		var fullData = sorted; // keep for tooltip

		new Chart(canvas, {
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
				var formatted = fmtNum(value);
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
			'<div style="position:relative;height:' + pipelineH + '"><canvas id="opp-pipeline-chart"></canvas></div>' +
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
			'<div style="position:relative;height:320px"><canvas id="opp-bar-chart"></canvas></div>' +
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

		var $body    = $(wrapper).find(".layout-main-section");
		var filters  = { territory: "all", sales_stage: "all", sales_stage_1: "all" };
		var filterBarHTML = ""; // built after get_filter_options

		function applyFilters() {
			updateFilterChips(filters);
			markActiveSelects(filters);
			loadData();
		}

		function bindFilterListeners() {
			var terSel    = document.getElementById("opp-f-territory");
			var stageSel  = document.getElementById("opp-f-stage");
			var stage1Sel = document.getElementById("opp-f-stage1");
			var clearBtn  = document.getElementById("opp-f-clear");

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
			if (clearBtn) {
				clearBtn.addEventListener("click", function () {
					filters.territory     = "all";
					filters.sales_stage   = "all";
					filters.sales_stage_1 = "all";
					if (terSel)    { terSel.value    = "all"; terSel.classList.remove("active"); }
					if (stageSel)  { stageSel.value  = "all"; stageSel.classList.remove("active"); }
					if (stage1Sel) { stage1Sel.value = "all"; stage1Sel.classList.remove("active"); }
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
					territory: filters.territory,
					sales_stage: filters.sales_stage,
					sales_stage_1: filters.sales_stage_1,
				},
				callback: function (r) {
					if (!r.message) return;
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
