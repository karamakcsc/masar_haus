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
	function is_mobile_donut_height() {
		return window.innerWidth <= 560;
	}

	// The chart grid around the two bar charts collapses to a narrower layout
	// at 900px (masar_haus.bundle.scss @media max-width: 900px), not 560px --
	// this threshold has to match that breakpoint (not the donut one above),
	// otherwise phones/tablets in the 561-900px range (landscape phones,
	// phablets, larger accessibility text) get the narrower grid without the
	// compensating per-category-width fix below, and frappe-charts truncates
	// labels again.
	function is_mobile_bar_width() {
		return window.innerWidth <= 900;
	}

	// Lets a vertical drag scroll the page even when it starts on a
	// horizontally-scrollable region (.masar-chart-scroll, touch-action:
	// pan-x -- see masar_haus.bundle.scss). touch-action alone can't tell "this
	// drag turned out vertical" from "horizontal" until it's already
	// committed to the pan-x axis, so the browser reserves BOTH directions
	// for itself on that element, silently swallowing vertical drags that
	// start there. Pointer Events (not touchstart/touchmove) so this covers
	// touch and pen/mouse drags with one code path; gated to pointerType ===
	// "touch" below so it doesn't also hijack mouse-drag text selection on
	// desktop, where touch-action:pan-x isn't even in effect (that rule only
	// applies under the ≤900px media query). Shared by every
	// .masar-chart-scroll instance (Pipeline and Monthly can each get their
	// own) via the one call site in ensure_scrollable_bar_chart() below,
	// rather than duplicating this per chart.
	function attach_axis_lock_scroll(el) {
		const scrollEl = document.querySelector(".main-section");
		if (!scrollEl) return;

		const DEAD_ZONE = 6;
		let state = null;

		// passive: false is required for preventDefault() below to actually
		// suppress the browser's own touch-action-driven handling once the
		// axis locks to "y" -- but a non-passive listener left registered the
		// whole time would force the browser to run this handler
		// synchronously, and wait to see if preventDefault() gets called, for
		// every touch move over this element, even ones that never end up
		// needing axis-locking. Only attaching it for the duration of an
		// actual gesture (added in pointerdown below, removed in reset())
		// keeps everything else fully native/passive.
		function onPointerMove(e) {
			if (!state || e.pointerId !== state.pointerId) return;

			if (!state.axis) {
				const dx = e.clientX - state.startX;
				const dy = e.clientY - state.startY;
				if (Math.abs(dx) < DEAD_ZONE && Math.abs(dy) < DEAD_ZONE) return;
				state.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
			}

			if (state.axis === "y") {
				e.preventDefault();
				scrollEl.scrollTop -= e.clientY - state.lastY;
				state.lastY = e.clientY;
			}
			// axis === "x": do nothing -- native overflow-x + touch-action:pan-x
			// already handles it exactly as today.
		}

		el.addEventListener("pointerdown", function (e) {
			if (e.pointerType !== "touch") return;
			state = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, lastY: e.clientY, axis: null };
			el.addEventListener("pointermove", onPointerMove, { passive: false });
		});

		function reset(e) {
			if (!state || e.pointerId !== state.pointerId) return;
			state = null;
			el.removeEventListener("pointermove", onPointerMove);
		}
		el.addEventListener("pointerup", reset);
		el.addEventListener("pointercancel", reset);
		el.addEventListener("pointerleave", reset);
	}

	// frappe-charts truncates x-axis labels based on a max-chars budget of
	// (this.width / category_count) * 0.6 / 7 -- verified directly against
	// frappe-charts' own source (node_modules/frappe-charts/dist/frappe-
	// charts.esm.js), not assumed. Give the measured wrapper real
	// per-category width so frappe-charts computes a much larger budget and
	// mostly stops truncating, then let the excess scroll horizontally
	// instead of being squeezed back down to fit the screen.
	function ensure_scrollable_bar_chart(wrapper, category_count, min_width_per_category) {
		const $wrapper = $(wrapper);
		const min_width = Math.max((category_count || 0) * (min_width_per_category || 130), 300);
		$wrapper.css("min-width", min_width + "px");
		if (!$wrapper.parent().hasClass("masar-chart-scroll")) {
			// Only reached when a NEW .masar-chart-scroll is about to be created
			// (wrap() below) -- attaching here, once per fresh node, is what
			// keeps this from double-attaching if ensure_scrollable_bar_chart()
			// runs again while the existing wrapper is still in place (the
			// hasClass check above already skips re-wrapping in that case).
			$wrapper.wrap('<div class="masar-chart-scroll"></div>');
			attach_axis_lock_scroll($wrapper.parent()[0]);
		}
	}

	// Inverse of the above, applied when a resize/orientationchange takes the
	// viewport back above the bar-width breakpoint -- without this, rotating
	// a phone from portrait to landscape (crossing back over 900px) would
	// leave a stale forced min-width/scroll wrapper from the narrower layout.
	function reset_scrollable_bar_chart(wrapper) {
		const $wrapper = $(wrapper);
		$wrapper.css("min-width", "");
		if ($wrapper.parent().hasClass("masar-chart-scroll")) {
			$wrapper.unwrap();
		}
	}

	// is_mobile_bar_width() is only ever read once, at chart-creation time
	// inside patch_make_chart -- so without this registry + listener,
	// rotating the device (or resizing a desktop browser) after the
	// dashboard has already loaded wouldn't re-apply/undo the scroll fix
	// until a full page reload recreated the charts. Entries for wrappers no
	// longer in the document are just skipped (harmless no-op), rather than
	// pruned -- the array only grows across chart re-renders within a single
	// page load, which resets on navigation anyway.
	const bar_chart_registry = [];

	function refresh_bar_chart_scroll_state() {
		const mobile = is_mobile_bar_width();
		bar_chart_registry.forEach(function (entry) {
			if (!document.body.contains(entry.wrapper)) return;
			if (mobile || entry.always_scroll) {
				ensure_scrollable_bar_chart(entry.wrapper, entry.category_count, entry.per_category_width);
			} else {
				reset_scrollable_bar_chart(entry.wrapper);
			}
		});
	}

	function debounce(fn, wait) {
		let timer;
		return function () {
			const args = arguments;
			const ctx = this;
			clearTimeout(timer);
			timer = setTimeout(function () {
				fn.apply(ctx, args);
			}, wait);
		};
	}

	const debounced_refresh_bar_charts = debounce(refresh_bar_chart_scroll_state, 150);
	window.addEventListener("resize", debounced_refresh_bar_charts);
	window.addEventListener("orientationchange", debounced_refresh_bar_charts);

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
				if (is_mobile_donut_height()) {
					custom_options.height = 160;
				}
				if (custom_options.data) {
					chart_parent = setup_donut_layout(wrapper, custom_options.data);
				}
			}

			if (BAR_LABEL_CHARTS.has(widget_title)) {
				custom_options = Object.assign({}, custom_options, { valuesOverPoints: true });
				if (custom_options.data && custom_options.data.labels) {
					const category_count = custom_options.data.labels.length;
					// Sales stage names are free text set per-business and can run
					// much longer than the Monthly chart's uniform "Mon YYYY"
					// labels, so unlike that chart this one needs its
					// per-category-width fix on every viewport width, not just
					// mobile -- frappe-charts truncates purely by pixel width
					// divided by category count, and a handful of long stage
					// names don't fit even in this widget's normal desktop card
					// width.
					const always_scroll = widget_title === "Opportunity Pipeline by Sales Stage";
					// 130px/category (frappe-charts' ~11-char budget at that width)
					// was sized for Monthly's short "Mon YYYY" labels -- this
					// business's actual Sales Stage values run up to 24 characters
					// ("Proposal to be submitted", verified against live data, not
					// guessed), which even a *comfortably*-fitting label like
					// "Prospecting" (11 chars) was only just barely clearing before
					// getting cut anyway. 300px/category budgets ~26 characters,
					// comfortably covering the longest real value with margin.
					const per_category_width = always_scroll ? 300 : 130;
					bar_chart_registry.push({
						wrapper: wrapper,
						category_count: category_count,
						always_scroll: always_scroll,
						per_category_width: per_category_width,
					});
					if (always_scroll || is_mobile_bar_width()) {
						ensure_scrollable_bar_chart(wrapper, category_count, per_category_width);
					}
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

	// ── Mobile scroll-progress indicator (approved design), Opportunity
	// Dashboard only ──────────────────────────────────────────────────────────
	// This bundle loads on every desk page (app_include_js), so unlike a
	// single custom Page there's no one navigation event to hook for "we just
	// arrived here" -- instead this reuses the same content-based check the
	// rest of the file already relies on to scope itself to this dashboard:
	// data-chart-title (tag_widget_from_title_el, driven by the
	// MutationObserver in start_early_widget_tagging()) is only ever set on
	// THIS dashboard's own widgets, so its presence in the DOM *is* "are we on
	// the Opportunity Dashboard right now."
	function is_on_opportunity_dashboard() {
		return !!document.querySelector("[data-chart-title]");
	}

	let $scroll_track = null;
	let $scroll_thumb = null;

	function ensure_scroll_indicator_elements() {
		if ($scroll_track) return;
		$scroll_track = $('<div class="masar-scroll-track"></div>').appendTo(document.body);
		$scroll_thumb = $('<div class="masar-scroll-thumb"></div>').appendTo($scroll_track);
	}

	function update_scroll_indicator() {
		if (!is_on_opportunity_dashboard()) {
			// Elements are appended to document.body (not scoped inside this
			// dashboard's own container the way Surface 1's are), so navigating
			// away needs an explicit hide -- otherwise the CSS's ≤560px
			// display:block would keep it visible over every other desk page too.
			if ($scroll_track) $scroll_track.css("display", "none");
			return;
		}
		ensure_scroll_indicator_elements();
		$scroll_track.css("display", ""); // hand visibility back to the CSS media query

		// .main-section (frappe/www/desk.html) is the one scroll container
		// shared by every desk route -- confirmed directly against a live
		// on-device diagnostic during the Analytics Report mobile-scroll
		// investigation, so the same container applies here unchanged.
		const scrollEl = document.querySelector(".main-section");
		if (!scrollEl) return;
		const trackH = $scroll_track[0].clientHeight;
		if (!trackH) return;
		const scrollableH = scrollEl.scrollHeight - scrollEl.clientHeight;
		const pct = scrollableH > 0 ? scrollEl.scrollTop / scrollableH : 0;
		const thumbH = Math.min(Math.max(trackH * 0.18, 40), trackH);
		$scroll_thumb.css({ height: thumbH + "px", top: (pct * (trackH - thumbH)) + "px" });
	}

	// requestAnimationFrame-throttled rather than debounce() above -- debounce
	// would only move the thumb once scrolling stops, but the spec calls for
	// it to visibly track the scroll position live, so this coalesces updates
	// to at most once per frame instead of delaying them.
	function raf_throttle(fn) {
		let scheduled = false;
		return function () {
			const args = arguments, ctx = this;
			if (scheduled) return;
			scheduled = true;
			requestAnimationFrame(function () {
				scheduled = false;
				fn.apply(ctx, args);
			});
		};
	}

	const throttled_update_scroll_indicator = raf_throttle(update_scroll_indicator);

	function attach_scroll_indicator() {
		const scrollEl = document.querySelector(".main-section");
		if (scrollEl) {
			scrollEl.addEventListener("scroll", throttled_update_scroll_indicator, { passive: true });
		}

		// Widgets (and therefore data-chart-title) render asynchronously, and
		// the page may already be scrolled from a previous visit, so a scroll
		// event alone can't be relied on to ever fire -- this separate observer
		// catches both "arrived at the dashboard" and "left it" without
		// touching the existing widget-tagging observer above. Watching the
		// attribute directly (not just childList) matters: data-chart-title is
		// set via .attr() on an already-existing element (tag_widget_from_title_el),
		// not by inserting a new node, so a childList-only observer would only
		// catch that change incidentally, whenever some OTHER node happens to
		// get added afterwards -- not reliably or immediately.
		new MutationObserver(throttled_update_scroll_indicator).observe(document.body, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ["data-chart-title"],
		});
	}

	if (document.body) {
		attach_scroll_indicator();
	} else {
		document.addEventListener("DOMContentLoaded", attach_scroll_indicator);
	}
})();
