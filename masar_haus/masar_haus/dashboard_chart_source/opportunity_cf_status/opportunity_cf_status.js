frappe.provide("frappe.dashboards.chart_sources");

frappe.dashboards.chart_sources["Opportunity CF Status"] = {
	method: "masar_haus.masar_haus.page.opportunity_analytics_report.opportunity_analytics_report.get_chart_cf_status",
	filters: [
		{
			fieldname: "territory",
			label: __("Territory"),
			fieldtype: "Link",
			options: "Territory",
			default: "",
		},
		{
			fieldname: "sales_stage",
			label: __("Sales Stage"),
			fieldtype: "Select",
			options: [
				"",
				"Completed",
				"Dead",
				"First Level Discussions are in Progress",
				"Lost",
				"On Hold",
				"Proposal Being Finalized",
				"Proposal Submitted",
				"Prospecting",
				"Won",
			].join("\n"),
			default: "",
		},
	],
};
