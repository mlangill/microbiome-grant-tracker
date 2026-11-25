(() => {
  "use strict";

  const STORE_KEY = "mgt-filters-v1";
  const $ = (id) => document.getElementById(id);
  const DAY = 86400000;
  const today = new Date(); today.setHours(0, 0, 0, 0);

  let DATA = { grants: [], closing_soon_days: 30 };
  const openRows = new Set();

  // ---------- helpers ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const parseDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
  const fmtDate = (iso, approx) => {
    const d = parseDate(iso);
    const s = approx
      ? d.toLocaleDateString("en-CA", { month: "short", year: "numeric" })
      : d.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
    return (approx ? "~" : "") + s;
  };
  const daysUntil = (iso) => Math.round((parseDate(iso) - today) / DAY);
  const money = (n) => {
    if (n == null) return null;
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1) + "M";
    if (n >= 1e3) return "$" + Math.round(n / 1e3) + "K";
    return "$" + n;
  };
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // ---------- status ----------
  function status(g) {
    const future = g.deadlines.filter((d) => daysUntil(d.date) >= 0);
    const next = future[0] || null;
    if (g.rolling) return { key: "rolling", label: "Rolling intake", next };
    if (!g.deadlines.length) return { key: "tba", label: "Dates TBA", next };
    if (!next) return { key: "closed", label: "Closed", next };
    const days = daysUntil(next.date);
    if (/invited/i.test(next.type)) return { key: "invited", label: "Invited stage", next, days };
    if (g.anticipated || next.approx) return { key: "expected", label: "Expected", next, days };
    if (days <= DATA.closing_soon_days) return { key: "soon", label: days === 0 ? "Due today" : `Closes in ${days}d`, next, days };
    return { key: "open", label: "Upcoming", next, days };
  }

  // ---------- filters ----------
  const controls = ["f-search", "f-region", "f-window", "f-sort", "f-cat-microbiome", "f-cat-adjacent", "f-cat-open", "f-human", "f-min", "f-unknown", "f-archive"];

  function readFilters() {
    return {
      search: $("f-search").value.trim().toLowerCase(),
      region: $("f-region").value,
      window: $("f-window").value,
      sort: $("f-sort").value,
      cats: { microbiome: $("f-cat-microbiome").checked, adjacent: $("f-cat-adjacent").checked, "open-program": $("f-cat-open").checked },
      human: $("f-human").checked,
      min: Number($("f-min").value),
      basis: document.querySelector("input[name=f-basis]:checked").value,
      unknown: $("f-unknown").checked,
      archive: $("f-archive").checked,
      view: document.querySelector("input[name=f-view]:checked").value,
    };
  }

  function saveFilters(f) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(f)); } catch (e) { /* storage unavailable */ }
  }

  function loadFilters() {
    let f = null;
    try { f = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (e) { f = null; }
    if (!f) return;
    $("f-search").value = f.search || "";
    for (const [id, key] of [["f-region", "region"], ["f-window", "window"], ["f-sort", "sort"], ["f-min", "min"]]) {
      if (f[key] != null) $(id).value = String(f[key]);
    }
    if (f.cats) {
      $("f-cat-microbiome").checked = !!f.cats.microbiome;
      $("f-cat-adjacent").checked = !!f.cats.adjacent;
      $("f-cat-open").checked = !!f.cats["open-program"];
    }
    $("f-human").checked = !!f.human;
    $("f-unknown").checked = f.unknown !== false;
    $("f-archive").checked = !!f.archive;
    for (const [name, val] of [["f-basis", f.basis], ["f-view", f.view]]) {
      const el = val && document.querySelector(`input[name=${name}][value=${val}]`);
      if (el) el.checked = true;
    }
  }

  function passes(g, st, f) {
    if (st.key === "closed" && !f.archive) return false;
    if (!f.cats[g.category]) return false;
    if (f.human && g.microbiome_focus !== "human") return false;
    if (f.region === "ca" && g.funder_country !== "CA") return false;
    if (f.region === "eligible" && !["lead", "partner"].includes(g.canadian_eligibility)) return false;
    if (f.window !== "any") {
      if (st.key === "rolling") { /* always available */ }
      else if (!st.next || st.days > Number(f.window)) return false;
    }
    if (f.min > 0) {
      const v = f.basis === "year" ? g.normalised.cad_per_year : g.normalised.cad_total;
      if (v == null) { if (!f.unknown) return false; }
      else if (v < f.min) return false;
    }
    if (f.search) {
      const hay = [g.title, g.funder, g.summary, g.eligibility, (g.tags || []).join(" "), g.amount?.note].join(" ").toLowerCase();
      if (!f.search.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  }

  function sortRows(rows, how) {
    const nextKey = (r) => (r.st.next ? r.st.next.date : r.st.key === "rolling" ? "0000" : "9999");
    const cmp = {
      relevance: (a, b) => b.g.score - a.g.score || nextKey(a).localeCompare(nextKey(b)),
      deadline: (a, b) => nextKey(a).localeCompare(nextKey(b)) || b.g.score - a.g.score,
      amount: (a, b) => (b.g.normalised.cad_total ?? -1) - (a.g.normalised.cad_total ?? -1),
      funder: (a, b) => a.g.funder.localeCompare(b.g.funder) || nextKey(a).localeCompare(nextKey(b)),
    }[how];
    // closed items always sink to the bottom
    return rows.sort((a, b) => (a.st.key === "closed") - (b.st.key === "closed") || cmp(a, b));
  }

  // ---------- render pieces ----------
  function relevanceDots(score) {
    const n = score >= 80 ? 3 : score >= 55 ? 2 : 1;
    return `<span class="rel" title="Relevance score ${score}">${"●".repeat(n)}<span class="off">${"●".repeat(3 - n)}</span></span>`;
  }

  function badges(g) {
    const b = [];
    if (g.funder_country === "CA") b.push('<span class="badge ca">Canadian</span>');
    else if (g.canadian_eligibility === "lead") b.push('<span class="badge">Canada can lead</span>');
    else if (g.canadian_eligibility === "partner") b.push('<span class="badge">Canada as partner</span>');
    if (g.category === "microbiome") b.push('<span class="badge">Microbiome call</span>');
    if (g.category === "open-program") b.push('<span class="badge">Open program</span>');
    if (g.microbiome_focus === "human") b.push('<span class="badge human">Human</span>');
    if (g.needs_verification.length) b.push(`<span class="flag" title="Not yet confirmed on funder page: ${esc(g.needs_verification.join(", "))}">verify</span>`);
    return `<div class="badges">${b.join("")}</div>`;
  }

  function deadlineCell(st) {
    if (st.key === "rolling") return `<span class="status rolling">Rolling intake</span>`;
    if (!st.next) {
      return st.key === "tba" ? `<span class="status tba">Dates TBA</span>` : `<span class="status closed">Closed</span>`;
    }
    const d = st.next;
    const rel = st.days === 0 ? "today" : st.days === 1 ? "tomorrow" : `in ${st.days} days`;
    return `<div class="when">${esc(fmtDate(d.date, d.approx))}<small>${esc(cap(d.type))} · ${rel}</small></div>
            <span class="status ${st.key}">${esc(st.label)}</span>`;
  }

  function amountCell(g) {
    const n = g.normalised;
    const a = g.amount || {};
    if (n.cad_per_year == null && n.cad_total == null) return `<span class="amt">—<small>${esc(shortNote(a.note))}</small></span>`;
    const pre = n.is_typical ? "avg. " : "up to ";
    const parts = [];
    if (n.cad_per_year != null) parts.push(`${money(n.cad_per_year)}/yr`);
    if (n.cad_total != null) parts.push(`${money(n.cad_total)} total`);
    const cur = a.currency && a.currency !== "CAD" ? ` <small>converted from ${a.currency}</small>` : "";
    return `<span class="amt">${pre}${parts.join(" · ")}${cur}</span>`;
  }
  const shortNote = (s) => (s ? (s.length > 60 ? s.slice(0, 57) + "…" : s) : "");

  function durationText(g) {
    const d = g.duration_years || {};
    if (d.min && d.max && d.min !== d.max) return `${d.min}–${d.max} yrs`;
    if (d.max) return `up to ${d.max} yr${d.max === 1 ? "" : "s"}`;
    return "—";
  }

  function detailHtml(g) {
    const dl = g.deadlines.map((d) => {
      const past = daysUntil(d.date) < 0;
      return `<li class="${past ? "past" : ""}"><span>${esc(cap(d.type))}</span><span>${esc(fmtDate(d.date, d.approx))}</span></li>`;
    }).join("") || `<li><span>${g.rolling ? "Continuous intake" : "Dates not yet announced"}</span></li>`;
    const verify = g.needs_verification.length
      ? `<p><span class="flag">verify</span> Not yet confirmed on the funder's page: ${esc(g.needs_verification.join(", "))}.</p>` : "";
    return `<div class="detail-grid">
      <div>
        <h4>About</h4><p>${esc(g.summary)}</p>
        ${g.eligibility ? `<h4>Eligibility</h4><p>${esc(g.eligibility)}</p>` : ""}
        ${g.amount?.note ? `<h4>Funding</h4><p>${esc(g.amount.note)}</p>` : ""}
        ${verify}
        <a class="go" href="${esc(g.url)}" target="_blank" rel="noopener">Official call page ↗</a>
      </div>
      <div>
        <h4>Deadlines</h4><ul class="dl">${dl}</ul>
        <h4>Duration</h4><p>${esc(durationText(g))}</p>
        <h4>Last checked</h4><p>${esc(g.last_verified)}</p>
      </div>
    </div>`;
  }

  // ---------- render ----------
  function render() {
    const f = readFilters();
    saveFilters(f);
    const all = DATA.grants.map((g) => ({ g, st: status(g) }));
    const rows = sortRows(all.filter((r) => passes(r.g, r.st, f)), f.sort);
    const closedHidden = all.filter((r) => r.st.key === "closed").length;
    $("count").textContent = `${rows.length} of ${all.length} calls shown` +
      (!f.archive && closedHidden ? ` · ${closedHidden} closed call${closedHidden > 1 ? "s" : ""} hidden` : "");

    const out = $("results");
    if (!rows.length) {
      out.innerHTML = `<div class="empty">No calls match these filters.</div>`;
      return;
    }
    out.innerHTML = f.view === "cards" ? renderCards(rows) : renderTable(rows);
    if (f.view !== "cards") {
      out.querySelectorAll("tr.main").forEach((tr) => {
        const toggle = () => {
          const id = tr.dataset.id;
          const det = out.querySelector(`tr.detail[data-id="${id}"]`);
          det.hidden = !det.hidden;
          tr.setAttribute("aria-expanded", String(!det.hidden));
          det.hidden ? openRows.delete(id) : openRows.add(id);
        };
        tr.addEventListener("click", (e) => { if (!e.target.closest("a")) toggle(); });
        tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
      });
    }
  }

  function renderTable(rows) {
    const body = rows.map(({ g, st }) => {
      const open = openRows.has(g.id);
      return `<tr class="main ${st.key === "closed" ? "closed" : ""}" data-id="${esc(g.id)}" tabindex="0" aria-expanded="${open}">
          <td class="c-rel">${relevanceDots(g.score)}</td>
          <td><div class="title">${esc(g.title)}</div><div class="funder">${esc(g.funder)}</div>${badges(g)}</td>
          <td>${deadlineCell(st)}</td>
          <td class="num">${amountCell(g)}</td>
          <td class="c-dur num">${esc(durationText(g))}</td>
          <td class="c-link"><a href="${esc(g.url)}" target="_blank" rel="noopener" aria-label="Official page for ${esc(g.title)}">Link ↗</a></td>
        </tr>
        <tr class="detail" data-id="${esc(g.id)}" ${open ? "" : "hidden"}><td colspan="6">${detailHtml(g)}</td></tr>`;
    }).join("");
    return `<table>
      <thead><tr><th class="c-rel">Fit</th><th>Call</th><th>Next deadline</th><th>Amount (CAD)</th><th class="c-dur">Duration</th><th></th></tr></thead>
      <tbody>${body}</tbody></table>`;
  }

  function renderCards(rows) {
    return `<div class="cards">${rows.map(({ g, st }) => `
      <article class="card ${st.key === "closed" ? "closed" : ""}">
        <div class="top"><div><div class="title">${esc(g.title)}</div><div class="funder">${esc(g.funder)}</div></div>${relevanceDots(g.score)}</div>
        ${badges(g)}
        <div class="facts">
          <div><b>Next deadline</b>${deadlineCell(st)}</div>
          <div><b>Amount (CAD)</b>${amountCell(g)}</div>
          <div><b>Duration</b>${esc(durationText(g))}</div>
          <div><b>Last checked</b>${esc(g.last_verified)}</div>
        </div>
        <p>${esc(g.summary)}</p>
        <a class="go" href="${esc(g.url)}" target="_blank" rel="noopener">Official call page ↗</a>
      </article>`).join("")}</div>`;
  }

  // ---------- boot ----------
  loadFilters();
  for (const id of controls) {
    $(id).addEventListener(id === "f-search" ? "input" : "change", render);
  }
  document.querySelectorAll("input[name=f-basis], input[name=f-view]").forEach((el) => el.addEventListener("change", render));

  fetch("grants.json", { cache: "no-cache" })
    .then((r) => r.json())
    .then((data) => {
      DATA = data;
      const when = new Date(data.generated);
      $("updated").textContent = `Updated ${when.toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" })}`;
      render();
    })
    .catch(() => {
      $("results").innerHTML = `<div class="empty">Could not load grant data.</div>`;
      $("updated").textContent = "";
    });
})();
