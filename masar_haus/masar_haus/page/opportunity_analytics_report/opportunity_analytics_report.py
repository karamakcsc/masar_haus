import frappe

WON = ("Converted", "Closed")
LIVE = ("Open", "Quotation")
LOST = ("Lost",)


def _build_where(territory=None, sales_stage=None):
	"""Return (where_clause, params_tuple) for dynamic filtering."""
	conditions = ["custom_item_group IN ('Corporate Finance', 'Corporate Governance')"]
	params = []

	if territory and territory != "all":
		conditions.append("territory = %s")
		params.append(territory)

	if sales_stage and sales_stage != "all":
		conditions.append("sales_stage = %s")
		params.append(sales_stage)

	return " AND ".join(conditions), tuple(params)


@frappe.whitelist()
def get_filter_options():
	territories = frappe.db.sql(
		"""
		SELECT DISTINCT territory
		FROM tabOpportunity
		WHERE custom_item_group IN ('Corporate Finance', 'Corporate Governance')
		  AND territory IS NOT NULL AND territory != ''
		ORDER BY territory
		""",
	)
	stages = frappe.db.sql(
		"""
		SELECT DISTINCT sales_stage
		FROM tabOpportunity
		WHERE custom_item_group IN ('Corporate Finance', 'Corporate Governance')
		  AND sales_stage IS NOT NULL AND sales_stage != ''
		ORDER BY sales_stage
		""",
	)
	return {
		"territories": [r[0] for r in territories],
		"sales_stages": [r[0] for r in stages],
	}


@frappe.whitelist()
def get_dashboard_data(territory="all", sales_stage="all"):
	where, params = _build_where(territory, sales_stage)

	# Main aggregation — avoids DATE_FORMAT to sidestep % escaping with params
	rows = frappe.db.sql(
		"""
		SELECT
			custom_item_group,
			status,
			CONCAT(YEAR(creation), '-', LPAD(MONTH(creation), 2, '0')) AS month,
			COUNT(*) AS cnt,
			COALESCE(SUM(opportunity_amount), 0) AS val
		FROM tabOpportunity
		WHERE {where}
		GROUP BY custom_item_group, status, month
		ORDER BY month, custom_item_group, status
		""".format(where=where),
		params,
		as_dict=True,
	)

	pipeline_rows = frappe.db.sql(
		"""
		SELECT
			COALESCE(sales_stage, 'Unknown') AS sales_stage,
			custom_item_group,
			COUNT(*) AS cnt,
			COALESCE(SUM(opportunity_amount), 0) AS val
		FROM tabOpportunity
		WHERE {where}
		GROUP BY sales_stage, custom_item_group
		ORDER BY SUM(opportunity_amount) DESC
		""".format(where=where),
		params,
		as_dict=True,
	)

	top5_cf = frappe.db.sql(
		"""
		SELECT name, customer_name, title, opportunity_type, status, sales_stage, opportunity_amount
		FROM tabOpportunity
		WHERE {where}
		  AND custom_item_group = 'Corporate Finance'
		  AND status IN ('Open', 'Quotation')
		ORDER BY opportunity_amount DESC
		LIMIT 5
		""".format(where=where),
		params,
		as_dict=True,
	)

	top5_grc = frappe.db.sql(
		"""
		SELECT name, customer_name, title, opportunity_type, status, sales_stage, opportunity_amount
		FROM tabOpportunity
		WHERE {where}
		  AND custom_item_group = 'Corporate Governance'
		  AND status IN ('Open', 'Quotation')
		ORDER BY opportunity_amount DESC
		LIMIT 5
		""".format(where=where),
		params,
		as_dict=True,
	)

	return {
		"summary": _build_summary(rows),
		"top5_cf": top5_cf,
		"top5_grc": top5_grc,
		"doughnut": _build_doughnut(rows),
		"bar": _build_bar(rows),
		"pipeline": _build_pipeline(pipeline_rows),
	}


# ── Aggregation helpers ────────────────────────────────────────────────────────

def _agg(rows, groups, statuses):
	cnt = sum(r.cnt for r in rows if r.custom_item_group in groups and r.status in statuses)
	val = float(sum(r.val for r in rows if r.custom_item_group in groups and r.status in statuses))
	return cnt, val


def _win_pct(won, lost):
	total = won + lost
	return round(won / total * 100, 1) if total > 0 else 0.0


def _build_summary(rows):
	specs = [
		("CF", ["Corporate Finance"]),
		("GRC", ["Corporate Governance"]),
		("total", ["Corporate Finance", "Corporate Governance"]),
	]
	result = {}
	for key, groups in specs:
		won_n, won_v = _agg(rows, groups, WON)
		live_n, live_v = _agg(rows, groups, LIVE)
		lost_n, lost_v = _agg(rows, groups, LOST)
		result[key] = {
			"numbers": {"won": won_n, "live": live_n, "win_pct": _win_pct(won_n, lost_n)},
			"values": {"won": won_v, "live": live_v, "win_pct": _win_pct(won_v, lost_v)},
		}
	return result


def _build_doughnut(rows):
	result = {}
	for key, grp in (("CF", "Corporate Finance"), ("GRC", "Corporate Governance")):
		_, won = _agg(rows, [grp], WON)
		_, live = _agg(rows, [grp], LIVE)
		_, lost = _agg(rows, [grp], LOST)
		result[key] = {"won": won, "live": live, "lost": lost}
	return result


def _build_bar(rows):
	months = sorted({r.month for r in rows if r.status in LIVE})
	cf, grc = {}, {}
	for r in rows:
		if r.status not in LIVE:
			continue
		bucket = cf if r.custom_item_group == "Corporate Finance" else grc
		bucket[r.month] = bucket.get(r.month, 0.0) + float(r.val)
	cf_vals = [cf.get(m, 0.0) for m in months]
	grc_vals = [grc.get(m, 0.0) for m in months]
	return {
		"months": months,
		"cf": cf_vals,
		"grc": grc_vals,
		"total": [cf_vals[i] + grc_vals[i] for i in range(len(months))],
	}


# ── Frappe Dashboard: Number Card methods ────────────────────────────────────

@frappe.whitelist()
def get_nc_cf_live(filters=None, **kwargs):
	count = frappe.db.count("Opportunity", {
		"custom_item_group": "Corporate Finance",
		"status": ["in", ["Open", "Quotation"]],
	})
	return {
		"value": count,
		"route": ["List", "Opportunity", "List"],
		"route_options": {
			"custom_item_group": "Corporate Finance",
			"status": ["in", "Open,Quotation"],
		},
	}

@frappe.whitelist()
def get_nc_grc_live(filters=None, **kwargs):
	count = frappe.db.count("Opportunity", {
		"custom_item_group": "Corporate Governance",
		"status": ["in", ["Open", "Quotation"]],
	})
	return {
		"value": count,
		"route": ["List", "Opportunity", "List"],
		"route_options": {
			"custom_item_group": "Corporate Governance",
			"status": ["in", "Open,Quotation"],
		},
	}

@frappe.whitelist()
def get_nc_cf_won(filters=None, **kwargs):
	count = frappe.db.count("Opportunity", {
		"custom_item_group": "Corporate Finance",
		"status": ["in", ["Converted", "Closed"]],
	})
	return {
		"value": count,
		"route": ["List", "Opportunity", "List"],
		"route_options": {
			"custom_item_group": "Corporate Finance",
			"status": ["in", "Converted,Closed"],
		},
	}

@frappe.whitelist()
def get_nc_grc_won(filters=None, **kwargs):
	count = frappe.db.count("Opportunity", {
		"custom_item_group": "Corporate Governance",
		"status": ["in", ["Converted", "Closed"]],
	})
	return {
		"value": count,
		"route": ["List", "Opportunity", "List"],
		"route_options": {
			"custom_item_group": "Corporate Governance",
			"status": ["in", "Converted,Closed"],
		},
	}

@frappe.whitelist()
def get_nc_total_live(filters=None, **kwargs):
	count = frappe.db.count("Opportunity", {
		"custom_item_group": ["in", ["Corporate Finance", "Corporate Governance"]],
		"status": ["in", ["Open", "Quotation"]],
	})
	return {
		"value": count,
		"route": ["List", "Opportunity", "List"],
		"route_options": {
			"custom_item_group": ["in", "Corporate Finance,Corporate Governance"],
			"status": ["in", "Open,Quotation"],
		},
	}

@frappe.whitelist()
def get_nc_total_won(filters=None, **kwargs):
	count = frappe.db.count("Opportunity", {
		"custom_item_group": ["in", ["Corporate Finance", "Corporate Governance"]],
		"status": ["in", ["Converted", "Closed"]],
	})
	return {
		"value": count,
		"route": ["List", "Opportunity", "List"],
		"route_options": {
			"custom_item_group": ["in", "Corporate Finance,Corporate Governance"],
			"status": ["in", "Converted,Closed"],
		},
	}


# ── Frappe Dashboard: Chart Source methods ────────────────────────────────────

def _parse_chart_filters(filters):
	"""Return (territory, sales_stage) strings from the chart source filters dict."""
	if isinstance(filters, str):
		filters = frappe.parse_json(filters) or {}
	f = filters or {}
	return f.get("territory") or "", f.get("sales_stage") or ""

def _build_chart_where(territory="", sales_stage=""):
	"""Return (extra_where_sql, params_tuple) for optional territory/stage filters."""
	conds, params = [], []
	if territory:
		conds.append("territory = %s"); params.append(territory)
	if sales_stage:
		conds.append("sales_stage = %s"); params.append(sales_stage)
	extra = (" AND " + " AND ".join(conds)) if conds else ""
	return extra, tuple(params)

@frappe.whitelist()
def get_chart_cf_status(chart_name=None, filters=None, **kwargs):
	ter, stage = _parse_chart_filters(filters)
	extra, params = _build_chart_where(ter, stage)
	rows = frappe.db.sql(
		"SELECT status, COALESCE(SUM(opportunity_amount),0) AS val "
		"FROM tabOpportunity WHERE custom_item_group='Corporate Finance'" + extra + " GROUP BY status",
		params, as_dict=True,
	)
	won  = float(sum(r.val for r in rows if r.status in WON))
	live = float(sum(r.val for r in rows if r.status in LIVE))
	lost = float(sum(r.val for r in rows if r.status in LOST))
	return {"labels": ["Won", "Live / Ongoing", "Lost"], "datasets": [{"values": [won, live, lost]}]}

@frappe.whitelist()
def get_chart_grc_status(chart_name=None, filters=None, **kwargs):
	ter, stage = _parse_chart_filters(filters)
	extra, params = _build_chart_where(ter, stage)
	rows = frappe.db.sql(
		"SELECT status, COALESCE(SUM(opportunity_amount),0) AS val "
		"FROM tabOpportunity WHERE custom_item_group='Corporate Governance'" + extra + " GROUP BY status",
		params, as_dict=True,
	)
	won  = float(sum(r.val for r in rows if r.status in WON))
	live = float(sum(r.val for r in rows if r.status in LIVE))
	lost = float(sum(r.val for r in rows if r.status in LOST))
	return {"labels": ["Won", "Live / Ongoing", "Lost"], "datasets": [{"values": [won, live, lost]}]}

@frappe.whitelist()
def get_chart_monthly(chart_name=None, filters=None, **kwargs):
	ter, stage = _parse_chart_filters(filters)
	extra, params = _build_chart_where(ter, stage)
	rows = frappe.db.sql("""
		SELECT CONCAT(YEAR(creation),'-',LPAD(MONTH(creation),2,'0')) AS month,
		       custom_item_group,
		       COALESCE(SUM(opportunity_amount),0) AS val
		FROM tabOpportunity
		WHERE custom_item_group IN ('Corporate Finance','Corporate Governance')
		  AND status IN ('Open','Quotation')""" + extra + """
		GROUP BY month, custom_item_group ORDER BY month
	""", params, as_dict=True)
	months = sorted({r.month for r in rows})
	cf_d  = {r.month: float(r.val) for r in rows if r.custom_item_group == "Corporate Finance"}
	grc_d = {r.month: float(r.val) for r in rows if r.custom_item_group == "Corporate Governance"}

	cf_vals, grc_vals = [], []
	cf_running = grc_running = 0.0
	for m in months:
		cf_running += cf_d.get(m, 0.0)
		grc_running += grc_d.get(m, 0.0)
		cf_vals.append(cf_running)
		grc_vals.append(grc_running)

	return {
		"labels": months,
		"datasets": [
			{"name": "Corporate Finance",    "values": cf_vals},
			{"name": "Corporate Governance", "values": grc_vals},
		],
	}

@frappe.whitelist()
def get_chart_pipeline(chart_name=None, filters=None, **kwargs):
	ter, stage = _parse_chart_filters(filters)
	extra, params = _build_chart_where(ter, stage)
	rows = frappe.db.sql("""
		SELECT COALESCE(sales_stage,'Unknown') AS sales_stage,
		       custom_item_group,
		       COALESCE(SUM(opportunity_amount),0) AS val
		FROM tabOpportunity
		WHERE custom_item_group IN ('Corporate Finance','Corporate Governance')""" + extra + """
		GROUP BY sales_stage, custom_item_group
		ORDER BY SUM(opportunity_amount) DESC
	""", params, as_dict=True)
	stages, cf_d, grc_d = [], {}, {}
	for r in rows:
		s = r.sales_stage or "Unknown"
		if s not in cf_d:
			stages.append(s); cf_d[s] = 0.0; grc_d[s] = 0.0
		if r.custom_item_group == "Corporate Finance":
			cf_d[s] += float(r.val)
		else:
			grc_d[s] += float(r.val)
	return {
		"labels": stages,
		"datasets": [
			{"name": "Corporate Finance",    "values": [cf_d[s]  for s in stages]},
			{"name": "Corporate Governance", "values": [grc_d[s] for s in stages]},
		],
	}


# ── Internal aggregation helpers ──────────────────────────────────────────────

def _build_pipeline(pipeline_rows):
	stages = {}
	for r in pipeline_rows:
		stage = r.sales_stage or "Unknown"
		if stage not in stages:
			stages[stage] = {"cf_val": 0.0, "grc_val": 0.0, "cf_cnt": 0, "grc_cnt": 0}
		if r.custom_item_group == "Corporate Finance":
			stages[stage]["cf_val"] += float(r.val)
			stages[stage]["cf_cnt"] += r.cnt
		else:
			stages[stage]["grc_val"] += float(r.val)
			stages[stage]["grc_cnt"] += r.cnt

	return sorted(
		[
			{
				"stage": stage,
				"cf_val": d["cf_val"],
				"grc_val": d["grc_val"],
				"cf_cnt": d["cf_cnt"],
				"grc_cnt": d["grc_cnt"],
				"total_val": d["cf_val"] + d["grc_val"],
				"total_cnt": d["cf_cnt"] + d["grc_cnt"],
			}
			for stage, d in stages.items()
		],
		key=lambda x: x["total_val"],
		reverse=True,
	)
