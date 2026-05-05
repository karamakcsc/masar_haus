frappe.ui.form.on('Opportunity', {
    onload(frm) {
        apply_item_query(frm);
    },

    custom_item_group(frm) {
        apply_item_query(frm);
    }
});

function apply_item_query(frm) {
    frm.set_query('item_code', 'items', function() {
        let filters = {
            is_sales_item: 1
        };

        if (frm.doc.custom_item_group) {
            filters.item_group = frm.doc.custom_item_group;
        }

        return { filters: filters };
    });
}