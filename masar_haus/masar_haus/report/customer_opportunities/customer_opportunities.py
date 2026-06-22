# Copyright (c) 2026, KCSC and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import flt


def execute(filters=None):
    filters = frappe._dict(filters or {})

    columns = get_columns()
    data = get_data(filters)
    chart = get_chart(data)
    report_summary = get_report_summary(data)

    return columns, data, None, chart, report_summary


def get_columns():
    return [
        {"label": _("Customer"), "fieldname": "customer", "fieldtype": "Link",
         "options": "Customer", "width": 130},
        {"label": _("Customer Name"), "fieldname": "customer_name", "fieldtype": "Data", "width": 210},
        {"label": _("Customer Group"), "fieldname": "customer_group", "fieldtype": "Link",
         "options": "Customer Group", "width": 120},
        {"label": _("Territory"), "fieldname": "territory", "fieldtype": "Link",
         "options": "Territory", "width": 110},
        {"label": _("Opportunity"), "fieldname": "opportunity", "fieldtype": "Link",
         "options": "Opportunity", "width": 160},
        {"label": _("From"), "fieldname": "opportunity_from", "fieldtype": "Data", "width": 90},
        {"label": _("Status"), "fieldname": "status", "fieldtype": "Data", "width": 100},
        {"label": _("Sales Stage"), "fieldname": "sales_stage", "fieldtype": "Data", "width": 110},
        {"label": _("Project Description"), "fieldname": "project_description",
         "fieldtype": "Data", "width": 230},
        {"label": _("Item Group"), "fieldname": "item_group", "fieldtype": "Data", "width": 150},
        {"label": _("Pursuit Team"), "fieldname": "pursuit_team", "fieldtype": "Data", "width": 110},
        {"label": _("Expected Closing"), "fieldname": "expected_closing", "fieldtype": "Date", "width": 120},
        {"label": _("Prob (%)"), "fieldname": "probability", "fieldtype": "Percent", "width": 80},
        {"label": _("Amount"), "fieldname": "opportunity_amount", "fieldtype": "Currency",
         "options": "currency", "width": 120},
        {"label": _("Currency"), "fieldname": "currency", "fieldtype": "Link",
         "options": "Currency", "width": 80},
    ]


def get_data(filters):
    conditions = ["o.docstatus < 2"]
    values = {}

    if filters.get("company"):
        conditions.append("o.company = %(company)s")
        values["company"] = filters.company
    if filters.get("status"):
        conditions.append("o.status = %(status)s")
        values["status"] = filters.status
    if filters.get("opportunity_from"):
        conditions.append("o.opportunity_from = %(opportunity_from)s")
        values["opportunity_from"] = filters.opportunity_from
    if filters.get("customer"):
        conditions.append("COALESCE(cust.name, pcust.name, pcust_fb.name) = %(customer)s")
        values["customer"] = filters.customer
    if filters.get("customer_group"):
        conditions.append(
            "COALESCE(cust.customer_group, pcust.customer_group, pcust_fb.customer_group) = %(customer_group)s"
        )
        values["customer_group"] = filters.customer_group
    if filters.get("territory"):
        conditions.append(
            "COALESCE(cust.territory, pcust.territory, pcust_fb.territory) = %(territory)s"
        )
        values["territory"] = filters.territory
    if filters.get("from_date"):
        conditions.append("o.transaction_date >= %(from_date)s")
        values["from_date"] = filters.from_date
    if filters.get("to_date"):
        conditions.append("o.transaction_date <= %(to_date)s")
        values["to_date"] = filters.to_date

    where_clause = " AND ".join(conditions)

    query = f"""
        SELECT
            COALESCE(cust.name, pcust.name, pcust_fb.name)                              AS customer,
            COALESCE(cust.customer_name, pcust.customer_name, pcust_fb.customer_name)     AS customer_name,
            COALESCE(cust.customer_group, pcust.customer_group, pcust_fb.customer_group)  AS customer_group,
            COALESCE(cust.territory, pcust.territory, pcust_fb.territory)                AS territory,
            o.name                          AS opportunity,
            o.opportunity_from,
            o.status,
            o.sales_stage,
            o.custom_project_description     AS project_description,
            o.custom_item_group              AS item_group,
            o.custom_pursuit_team            AS pursuit_team,
            o.expected_closing,
            o.probability,
            o.opportunity_amount,
            o.currency
        FROM `tabOpportunity` o
        LEFT JOIN `tabCustomer` cust
            ON o.opportunity_from = 'Customer' AND cust.name = o.party_name
        LEFT JOIN `tabProspect` prosp
            ON o.opportunity_from = 'Prospect' AND prosp.name = o.party_name
        LEFT JOIN `tabCustomer` pcust
            ON pcust.name = prosp.custom_customer
        LEFT JOIN `tabCustomer` pcust_fb
            ON o.opportunity_from = 'Prospect'
           AND (prosp.custom_customer IS NULL OR prosp.custom_customer = '')
           AND pcust_fb.customer_name = o.party_name
        WHERE {where_clause}
          AND COALESCE(cust.name, pcust.name, pcust_fb.name) IS NOT NULL
        ORDER BY customer_name ASC, o.expected_closing ASC, o.name ASC
    """

    return frappe.db.sql(query, values, as_dict=True)


def get_report_summary(data):
    customers = set()
    total_amount = won_amount = 0.0
    from_prospect = from_customer = 0

    for row in data:
        customers.add(row.get("customer"))
        amt = flt(row.get("opportunity_amount"))
        total_amount += amt
        if row.get("sales_stage") == "Won" or row.get("status") == "Converted":
            won_amount += amt
        if row.get("opportunity_from") == "Prospect":
            from_prospect += 1
        else:
            from_customer += 1

    currency = frappe.defaults.get_global_default("currency")

    return [
        {"value": len(customers), "label": _("Customers"), "datatype": "Int", "indicator": "Blue"},
        {"value": len(data), "label": _("Opportunities"), "datatype": "Int", "indicator": "Blue"},
        {"value": from_customer, "label": _("From Customer"), "datatype": "Int", "indicator": "Green"},
        {"value": from_prospect, "label": _("From Prospect"), "datatype": "Int", "indicator": "Orange"},
        {"value": total_amount, "label": _("Total Opp. Amount"), "datatype": "Currency", "currency": currency},
        {"value": won_amount, "label": _("Won Amount"), "datatype": "Currency",
         "currency": currency, "indicator": "Green"},
    ]


def get_chart(data):
    by_status = {}
    for row in data:
        status = row.get("status") or _("Unknown")
        by_status[status] = by_status.get(status, 0) + flt(row.get("opportunity_amount"))

    labels = list(by_status.keys())
    values = [by_status[label] for label in labels]

    return {
        "data": {
            "labels": labels,
            "datasets": [{"name": _("Opportunity Amount"), "values": values}],
        },
        "type": "bar",
        "fieldtype": "Currency",
        "colors": ["#7cd6fd"],
    }