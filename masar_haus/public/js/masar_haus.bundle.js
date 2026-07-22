// Opportunity Dashboard: show chart legend/tooltip values abbreviated to
// millions (e.g. 5,300,661 -> "5.3M") instead of the raw unformatted number.
// frappe.widget.ChartWidget is a private ES-module import (never exposed
// globally), so we patch frappe.utils.make_chart instead, which is a real
// global. Chart widgets' data-widget-name attribute is set to the "Dashboard
// Chart Link" child-row id, not the chart's own name (unlike Number Cards,
// which explicitly remap it) -- so we identify the chart via its visible
// widget-title text instead, which is always set to the chart's real name.
(function () {
	const TARGET_CHARTS = new Set([
		"Total Opportunity Value by Status",
		"CF Opportunity Value by Status",
		"GRC Opportunity Value by Status",
	]);

	// Bar charts where we want each bar labelled with its value abbreviated to
	// millions. frappe-charts' own "Show Values Over Chart" option exists, but
	// its abbreviation logic (shortenLargeNumber) is an internal, unpatchable
	// function we don't control -- so instead we let it create the label
	// elements (for correct positioning/animation) and then rewrite their
	// text ourselves via a MutationObserver, using the real values we already
	// have from the chart's own data.
	const BAR_LABEL_CHARTS = new Set([
		"Monthly Live Opportunity Value",
		"Opportunity Pipeline by Sales Stage",
	]);

	function get_widget_title(wrapper) {
		const $widget = $(wrapper).closest(".widget");
		const $title = $widget.find(".widget-title").first();
		return ($title.find(".ellipsis").attr("title") || $title.text() || "").trim();
	}

	// The desktop 3-across grid for the donuts (masar_haus.bundle.scss) is
	// driven by :has(.widget[data-chart-title="Total Opportunity Value by
	// Status"]) -- but that attribute used to only get set from inside
	// make_chart, which only runs once a chart's own AJAX call resolves. Each
	// donut/bar chart loads independently, so whichever one's request landed
	// first got measured while the grid was still its default (wider) shape;
	// once "Total" arrived and the grid snapped to 3 columns, that chart's
	// already-drawn, fixed-pixel-width SVG no longer fit its (now narrower)
	// column and overflowed past the card edge.
	//
	// A widget's title renders into .widget-title synchronously when the
	// widget itself is constructed (frappe/public/js/frappe/widgets/
	// base_widget.js make_widget() -> set_title()), well before its chart
	// data fetch even starts. Tagging from that instead removes the race:
	// the grid is already 3 columns before any of these charts get measured.
	const ALL_TAGGED_TITLES = new Set([...TARGET_CHARTS, ...BAR_LABEL_CHARTS]);

	function tag_widget_from_title_el(title_el) {
		const $title = $(title_el);
		const text = ($title.find(".ellipsis").attr("title") || $title.text() || "").trim();
		if (ALL_TAGGED_TITLES.has(text)) {
			$title.closest(".widget").attr("data-chart-title", text);
		}
	}

	function start_early_widget_tagging() {
		document.querySelectorAll(".widget-title").forEach(tag_widget_from_title_el);

		new MutationObserver(function (mutations) {
			mutations.forEach(function (mutation) {
				mutation.addedNodes.forEach(function (node) {
					if (node.nodeType !== 1) return;
					if (node.matches && node.matches(".widget-title")) {
						tag_widget_from_title_el(node);
					}
					node.querySelectorAll &&
						node.querySelectorAll(".widget-title").forEach(tag_widget_from_title_el);
				});
			});
		}).observe(document.body, { childList: true, subtree: true });
	}

	// Abbreviate large values to millions (e.g. 17,963,177 -> "18M", 13,735,250
	// -> "13.7M") for the donut legend/tooltip, which gets cramped on the
	// narrower 3-across card layout.
	function format_millions(value) {
		if (value === null || value === undefined || isNaN(value)) return value;
		const millions = Number(value) / 1e6;
		let formatted = millions.toFixed(1);
		if (formatted.endsWith(".0")) formatted = formatted.slice(0, -2);
		return formatted + "M";
	}

	// Build our own vertical, left-side legend for the status donuts instead of
	// frappe-charts' built-in horizontal one (which can't be relaid out via
	// CSS since each entry is a separately positioned SVG <g>). Native legend
	// rendering is disabled (showLegend: 0, set by the caller).
	//
	// frappe-charts always sizes its SVG to 100% of the element it's told is
	// its "parent" (measured via clientWidth) -- so simply appending a legend
	// beside an already-drawn full-width chart just wraps it onto its own
	// line (no room left). Instead we build a flex row (legend + an empty
	// "chart area" div) *before* the chart is created, and hand frappe-charts
	// that inner div as its parent -- it then measures and draws at the
	// correctly shrunk width from the start. Labels/values are known
	// upfront from the chart data; slice colors aren't (frappe-charts'
	// default palette isn't part of its public API) so the dots are painted
	// in afterwards, once the ring exists, with no layout impact.
	function setup_donut_layout(wrapper, data) {
		const labels = (data && data.labels) || [];
		const values = (data && data.datasets && data.datasets[0] && data.datasets[0].values) || [];

		const $row = $('<div class="masar-donut-chart-wrapper"></div>');
		const $legend = $('<div class="masar-vertical-legend"></div>');
		labels.forEach(function (label, i) {
			const $item = $('<div class="masar-legend-item"></div>');
			$('<span class="masar-legend-dot"></span>').appendTo($item);
			$('<span class="masar-legend-label"></span>').text(label).appendTo($item);
			$('<span class="masar-legend-value"></span>').text(format_millions(values[i])).appendTo($item);
			$item.appendTo($legend);
		});
		const $chartArea = $('<div class="masar-donut-chart-area"></div>');

		$(wrapper).empty();
		$legend.appendTo($row);
		$chartArea.appendTo($row);
		$row.appendTo(wrapper);

		return $chartArea[0];
	}

	function paint_donut_legend_colors(wrapper) {
		const paths = wrapper.querySelectorAll(".masar-donut-chart-area svg .donut-path, .masar-donut-chart-area svg .pie-path");
		const dots = wrapper.querySelectorAll(".masar-legend-dot");
		dots.forEach(function (dot, i) {
			const path = paths[i];
			if (path) dot.style.backgroundColor = path.style.stroke || path.style.fill || "#ccc";
		});
	}

	// On phone-width screens the donut/legend stack goes full-card-width (see
	// the ≤560px rule in masar_haus.bundle.scss), so the ring -- drawn at
	// Frappe's fixed default height of 240px regardless of container width --
	// ends up dominating the whole card with a lot of dead space beneath it.
	// Shrink it there; wider layouts have room for the default size.
	function is_mobile_width() {
		return window.innerWidth <= 560;
	}

	// frappe-charts truncates x-axis labels based on a max-chars budget of
	// (this.width / category_count) * 0.6 / 7 -- i.e. it's driven entirely by
	// the chart's actual rendered pixel width, not by font-size. Give the
	// measured wrapper real per-category width (130px, matching a
	// comfortably-legible desktop bar) so frappe-charts computes a much
	// larger budget and mostly stops truncating, then let the excess (on the
	// 8-category Pipeline chart in particular) scroll horizontally instead
	// of being squeezed back down to fit the phone screen.
	function ensure_scrollable_bar_chart(wrapper, category_count) {
		const $wrapper = $(wrapper);
		const min_width = Math.max((category_count || 0) * 130, 300);
		$wrapper.css("min-width", min_width + "px");
		if (!$wrapper.parent().hasClass("masar-chart-scroll")) {
			$wrapper.wrap('<div class="masar-chart-scroll"></div>');
		}
	}

	function attach_bar_value_labels(wrapper, datasets) {
		function fix_labels() {
			const svg = wrapper.querySelector("svg");
			if (!svg) return;
			datasets.forEach(function (ds, dsIndex) {
				var group = svg.querySelector(".dataset-bars.dataset-" + dsIndex);
				if (!group) return;
				var labelEls = group.querySelectorAll(".data-point-value");
				labelEls.forEach(function (el, j) {
					var val = ds.values[j];
					if (val === undefined || val === null) return;
					var formatted = format_millions(val);
					if (el.textContent !== formatted) el.textContent = formatted;
				});
			});
		}

		fix_labels();
		var observer = new MutationObserver(fix_labels);
		observer.observe(wrapper, { childList: true, subtree: true });
	}

	function patch_make_chart() {
		if (!frappe.utils || !frappe.utils.make_chart) return false;
		if (frappe.utils.make_chart.__masar_haus_patched) return true;

		const original_make_chart = frappe.utils.make_chart;
		const patched = function (wrapper, custom_options = {}) {
			const widget_title = get_widget_title(wrapper);

			// Tag the widget with its real title so CSS can target it by name
			// (data-widget-name is unreliable for chart widgets -- see note above).
			if (widget_title) {
				$(wrapper).closest(".widget").attr("data-chart-title", widget_title);
			}

			let chart_parent = wrapper;

			if (TARGET_CHARTS.has(widget_title)) {
				custom_options = Object.assign({}, custom_options, {
					showLegend: 0,
					tooltipOptions: {
						formatTooltipY: (value) => format_millions(value),
					},
				});
				if (is_mobile_width()) {
					custom_options.height = 160;
				}
				if (custom_options.data) {
					chart_parent = setup_donut_layout(wrapper, custom_options.data);
				}
			}

			if (BAR_LABEL_CHARTS.has(widget_title)) {
				custom_options = Object.assign({}, custom_options, { valuesOverPoints: true });
				if (is_mobile_width() && custom_options.data && custom_options.data.labels) {
					ensure_scrollable_bar_chart(wrapper, custom_options.data.labels.length);
				}
			}

			const chart = original_make_chart.call(this, chart_parent, custom_options);

			if (BAR_LABEL_CHARTS.has(widget_title) && custom_options.data && custom_options.data.datasets) {
				attach_bar_value_labels(wrapper, custom_options.data.datasets);
			}

			if (TARGET_CHARTS.has(widget_title)) {
				paint_donut_legend_colors(wrapper);
			}

			return chart;
		};
		patched.__masar_haus_patched = true;
		frappe.utils.make_chart = patched;
		return true;
	}

	if (!patch_make_chart()) {
		frappe.after_ajax && frappe.after_ajax(patch_make_chart);
		$(document).on("app_ready", patch_make_chart);
	}

	if (document.body) {
		start_early_widget_tagging();
	} else {
		document.addEventListener("DOMContentLoaded", start_early_widget_tagging);
	}
})();
