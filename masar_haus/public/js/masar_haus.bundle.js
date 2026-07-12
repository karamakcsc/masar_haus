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
		"CF Opportunity Value by Status",
		"GRC Opportunity Value by Status",
	]);

	function get_widget_title(wrapper) {
		const $widget = $(wrapper).closest(".widget");
		const $title = $widget.find(".widget-title").first();
		return ($title.find(".ellipsis").attr("title") || $title.text() || "").trim();
	}

	function patch_make_chart() {
		if (!frappe.utils || !frappe.utils.make_chart) return false;
		if (frappe.utils.make_chart.__masar_haus_patched) return true;

		const original_make_chart = frappe.utils.make_chart;
		const patched = function (wrapper, custom_options = {}) {
			const widget_title = get_widget_title(wrapper);
			if (TARGET_CHARTS.has(widget_title)) {
				custom_options = Object.assign({}, custom_options, {
					tooltipOptions: {
						formatTooltipY: (value) => format_number(value, null, 0),
					},
				});
			}
			return original_make_chart.call(this, wrapper, custom_options);
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
