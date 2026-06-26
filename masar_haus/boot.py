def remap_crm_sidebar(bootinfo):
	"""Make the CRM desktop icon open the CH CRM workspace sidebar."""
	sidebar_items = getattr(bootinfo, "workspace_sidebar_item", None)
	if not sidebar_items:
		return
	ch_crm = sidebar_items.get("ch crm")
	if ch_crm:
		sidebar_items["crm"] = ch_crm
