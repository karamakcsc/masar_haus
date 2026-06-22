// Copyright (c) 2026, KCSC and contributors
// For license information, please see license.txt

frappe.query_reports["Customer Opportunities"] = {
	filters: [
        {
            fieldname: "company",
            label: __("Company"),
            fieldtype: "Link",
            options: "Company",
            default: frappe.defaults.get_user_default("Company"),
        },
        {
            fieldname: "customer",
            label: __("Customer"),
            fieldtype: "Link",
            options: "Customer",
        },
        {
            fieldname: "customer_group",
            label: __("Customer Group"),
            fieldtype: "Link",
            options: "Customer Group",
        },
        {
            fieldname: "territory",
            label: __("Territory"),
            fieldtype: "Link",
            options: "Territory",
        },
        {
            fieldname: "opportunity_from",
            label: __("Opportunity From"),
            fieldtype: "Select",
            options: ["", "Customer", "Prospect"],
        },
        {
            fieldname: "status",
            label: __("Status"),
            fieldtype: "Select",
            options: ["", "Open", "Replied", "Quotation", "Converted", "Lost", "Closed"],
        },
        {
            fieldname: "from_date",
            label: __("From Date"),
            fieldtype: "Date",
        },
        {
            fieldname: "to_date",
            label: __("To Date"),
            fieldtype: "Date",
        },
    ],
};