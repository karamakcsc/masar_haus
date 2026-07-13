// Opportunity Dashboard: show chart legend/tooltip values with a thousands
// separator (e.g. 5,300,661) instead of the raw unformatted number.
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

	// Bar charts where we want each bar labelled with its full (comma-separated)
	// value. frappe-charts' own "Show Values Over Chart" option exists, but it
	// always abbreviates (5.3M) via an internal, unpatchable shortenLargeNumber
	// -- so instead we let it create the label elements (for correct
	// positioning/animation) and then rewrite their text via a MutationObserver,
	// using the real values we already have from the chart's own data.
	const BAR_LABEL_CHARTS = new Set([
		"Monthly Live Opportunity Value",
		"Opportunity Pipeline by Sales Stage",
	]);

	function get_widget_title(wrapper) {
		const $widget = $(wrapper).closest(".widget");
		const $title = $widget.find(".widget-title").first();
		return ($title.find(".ellipsis").attr("title") || $title.text() || "").trim();
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
					var formatted = format_number(val, null, 0);
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

			if (TARGET_CHARTS.has(widget_title)) {
				custom_options = Object.assign({}, custom_options, {
					tooltipOptions: {
						formatTooltipY: (value) => format_number(value, null, 0),
					},
				});
			}

			if (BAR_LABEL_CHARTS.has(widget_title)) {
				custom_options = Object.assign({}, custom_options, { valuesOverPoints: true });
			}

			const chart = original_make_chart.call(this, wrapper, custom_options);

			if (BAR_LABEL_CHARTS.has(widget_title) && custom_options.data && custom_options.data.datasets) {
				attach_bar_value_labels(wrapper, custom_options.data.datasets);
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
})();
