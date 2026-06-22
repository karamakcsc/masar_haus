import frappe
from frappe import _
from erpnext.crm.doctype.opportunity.opportunity import make_customer


def on_update(self, method):
    create_customer_on_converted(self)


def create_customer_on_converted(doc):
    if doc.status != "Converted":
        return

    doc_before = doc.get_doc_before_save()
    if not doc_before or doc_before.status == "Converted":
        return

    if doc.opportunity_from == "Customer":
        frappe.msgprint(
            _("Opportunity is already linked to Customer {0}.").format(
                frappe.bold(doc.party_name)
            ),
            alert=True,
            indicator="blue",
        )
        return

    create_customer(doc)

def create_customer(doc):
    try:
        existing_customer = frappe.db.get_value(
            "Customer",
            {"opportunity_name": doc.name},
            "name",
        )
        if existing_customer:
            frappe.msgprint(
                _("Customer {0} already exists for this Opportunity. Re-linking.").format(
                    frappe.bold(existing_customer)
                ),
                alert=True,
                indicator="blue",
            )
            frappe.db.set_value(
                "Opportunity",
                doc.name,
                {
                    "opportunity_from": "Customer",
                    "party_name": existing_customer,
                },
                update_modified=False,
            )
            
            return

        customer_doc = make_customer(doc.name)

        if not customer_doc.customer_type:
            customer_doc.customer_type = "Company"

        if not customer_doc.customer_group:
            customer_doc.customer_group = (
                frappe.db.get_single_value("Selling Settings", "customer_group")
                or "All Customer Groups"
            )

        if not customer_doc.territory:
            customer_doc.territory = (
                frappe.db.get_single_value("Selling Settings", "territory")
                or "All Territories"
            )

        customer_doc.flags.ignore_permissions = True
        customer_doc.insert()
        
        if doc.opportunity_from == "Prospect" and frappe.db.exists("Prospect", doc.party_name):
            frappe.db.set_value("Prospect", doc.party_name, "custom_customer", customer_doc.name, update_modified=False)

        frappe.msgprint(
            _("Customer {0} created successfully.").format(
                frappe.bold(customer_doc.customer_name)
            ),
            alert=True,
            indicator="green",
        )

    except Exception:
        frappe.log_error(frappe.get_traceback(), "Auto Create Customer on Opportunity Converted")
        frappe.msgprint(
            _("Customer could not be created automatically. Check Error Log for details."),
            alert=True,
            indicator="red",
        )