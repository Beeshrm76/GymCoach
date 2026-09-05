// home.js - the Home view: the landing page of the app.
//
// What lives here and why:
//  * Everything the old Progress view showed now sits inside #homeView as static
//    markup (Completion, project intensity, weekly check, recent sets). Those ids
//    are still filled by renderProgress() in app.js - this module deliberately does
//    NOT re-implement them, so there is exactly one code path per number.
//  * This module renders the parts that are new to Home: the hero, the ML
//    performance chart, coach signals, per-exercise trends, personal records,
//    the CSV/ZIP pipeline card and the install card.
//  * Nothing from Today, Build or AI Coach is duplicated here. Home links to those
//    views but never re-renders their content (no exercise list, no set tables,
//    no prompt preview).
//  * The chart is hand-built SVG. No chart library, so it works offline and from
//    file:// exactly like the rest of the app.

window.Home = (() => {
  const $ = id => document.getElementById(id);
  const esc = v => UI.esc(v);

  // Chart state. Deliberately module-local: it is a view preference, not data,
  // so it does not belong in the project or in Settings.
  let metricKey = "volumeKg";
  let horizon = 3;

  const project = () => Store.active();
  const nf = n => (Number.isFinite(n) ? String(Math.round(n * 10) / 10) : "—");

  function iosLike() {
    const ua = navigator.userAgent || "";
    // iPadOS 13+ reports as Macintosh, so touch points are the only reliable tell.
    return /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  }

  function installed() {
    return window.matchMedia?.("(display-mode: standalone)")?.matches === true
      || window.navigator.standalone === true;
  }

  // ---------------------------------------------------------------- hero

  function renderHero() {
    const p = project();
    const cons = MLModels.consistency(p);
    const prog = Store.projectProgress(p);
    const rows = MLModels.setRows(p);
    const volume = rows.reduce((s, r) => s + (r.loadKg && r.reps ? r.loadKg * r.reps : 0), 0);

    const hour = new Date().getHours();
    const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    const scheduled = Store.dayForWeekday
      ? Store.dayForWeekday(p, new Date().getDay())
      : p.days.find(d => Number.isInteger(d.weekday) && d.weekday === new Date().getDay());

    if ($("homeGreeting")) $("homeGreeting").textContent = greeting;
    if ($("homeHeadline")) $("homeHeadline").textContent = p.name || "Your workout project";
    if ($("homeSub")) {
      $("homeSub").textContent = scheduled
        ? `${scheduled.name} is scheduled for today · ${p.days.length} days in this project`
        : `${p.days.length} days in this project · nothing scheduled for today`;
    }

    const stats = $("homeHeroStats");
    if (stats) {
      stats.innerHTML = [
        ["Sessions logged", cons.sessions],
        ["Day streak", cons.streak],
        ["Sets recorded", rows.length],
        ["Effective volume", `${nf(volume)} kg`],
        ["Project complete", `${prog.pct}%`]
      ].map(([label, value]) =>
        `<div class="stat"><b>${esc(String(value))}</b><small>${esc(label)}</small></div>`).join("");
    }
  }

  // --------------------------------------------------------- ML chart

  const PAD = { l: 54, r: 18, t: 18, b: 38 };
  const W = 720, H = 280;

  function niceTicks(lo, hi, count = 4) {
    if (!(hi > lo)) return [lo];
    const raw = (hi - lo) / count;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || mag * 10;
    const out = [];
    for (let v = Math.floor(lo / step) * step; v <= hi + step * 0.5; v += step) out.push(Math.round(v * 1000) / 1000);
    return out;
  }

  function chartSVG(perf) {
    const actual = perf.y;
    const fitted = perf.fitted;
    const forecast = perf.forecast;
    const band = Number(perf.band) || 0;
    const total = actual.length + forecast.length;
    if (total < 2) return "";

    const pool = [...actual, ...fitted, ...forecast, ...forecast.map(v => v + band), ...forecast.map(v => v - band)]
      .filter(v => Number.isFinite(v));
    let lo = Math.min(...pool), hi = Math.max(...pool);
    if (lo === hi) { lo -= 1; hi += 1; }
    const floor = perf.metric.key === "meanRir" ? lo - (hi - lo) * 0.1 : Math.min(0, lo);
    lo = Math.max(floor, lo - (hi - lo) * 0.08);
    hi = hi + (hi - lo) * 0.08;

    const innerW = W - PAD.l - PAD.r, innerH = H - PAD.t - PAD.b;
    const x = i => PAD.l + (total === 1 ? innerW / 2 : (i / (total - 1)) * innerW);
    const y = v => PAD.t + innerH - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * innerH;
    const pt = (i, v) => `${Math.round(x(i) * 10) / 10},${Math.round(y(v) * 10) / 10}`;

    const ticks = niceTicks(lo, hi, 4);
    const grid = ticks.map(t =>
      `<line class="hc-grid" x1="${PAD.l}" y1="${y(t)}" x2="${W - PAD.r}" y2="${y(t)}"></line>
       <text class="hc-ytick" x="${PAD.l - 8}" y="${y(t) + 4}">${esc(nf(t))}</text>`).join("");

    // Forecast uncertainty band: last actual point anchors it so the ribbon
    // grows out of the real data instead of appearing detached.
    const lastI = actual.length - 1;
    const upper = [[lastI, actual[lastI]], ...forecast.map((v, h) => [actual.length + h, v + band])];
    const lower = [[lastI, actual[lastI]], ...forecast.map((v, h) => [actual.length + h, v - band])];
    const ribbon = band > 0 && forecast.length
      ? `<polygon class="hc-band" points="${[...upper, ...lower.reverse()].map(([i, v]) => pt(i, v)).join(" ")}"></polygon>`
      : "";

    const actualLine = `<polyline class="hc-actual" points="${actual.map((v, i) => pt(i, v)).join(" ")}"></polyline>`;
    const fitLine = fitted.length === actual.length
      ? `<polyline class="hc-fit" points="${fitted.map((v, i) => pt(i, v)).join(" ")}"></polyline>` : "";
    const foreLine = forecast.length
      ? `<polyline class="hc-forecast" points="${[[lastI, actual[lastI]], ...forecast.map((v, h) => [actual.length + h, v])].map(([i, v]) => pt(i, v)).join(" ")}"></polyline>`
      : "";

    const dots = actual.map((v, i) => {
      const s = perf.series[i];
      return `<circle class="hc-dot" cx="${x(i)}" cy="${y(v)}" r="3.5"><title>${esc(s.date)} · ${esc(s.label || "session")} · ${esc(nf(v))} ${esc(perf.metric.unit)}</title></circle>`;
    }).join("");

    const foreDots = forecast.map((v, h) =>
      `<circle class="hc-dot-forecast" cx="${x(actual.length + h)}" cy="${y(v)}" r="3.5"><title>Projected +${h + 1}: ${esc(nf(v))} ± ${esc(nf(band))} ${esc(perf.metric.unit)}</title></circle>`).join("");

    // Only a handful of x labels, otherwise they collide on a phone.
    const every = Math.max(1, Math.ceil(actual.length / 5));
    const xLabels = actual.map((_, i) =>
      (i % every === 0 || i === actual.length - 1)
        ? `<text class="hc-xtick" x="${x(i)}" y="${H - PAD.b + 18}">${esc(String(perf.series[i].date).slice(5))}</text>`
        : "").join("")
      + forecast.map((_, h) =>
        `<text class="hc-xtick hc-xtick-forecast" x="${x(actual.length + h)}" y="${H - PAD.b + 18}">+${h + 1}</text>`).join("");

    const divider = forecast.length
      ? `<line class="hc-divider" x1="${x(lastI)}" y1="${PAD.t}" x2="${x(lastI)}" y2="${PAD.t + innerH}"></line>` : "";

    return `<svg class="home-chart-svg" viewBox="0 0 ${W} ${H}" role="img"
        aria-label="${esc(perf.metric.label)} per session with a ${forecast.length}-session forecast">
      ${grid}${ribbon}${divider}${fitLine}${actualLine}${foreLine}${dots}${foreDots}
      <text class="hc-axis-title" x="${PAD.l - 8}" y="${PAD.t - 6}">${esc(perf.metric.unit)}</text>
      ${xLabels}
    </svg>`;
  }

  function renderChart() {
    const p = project();
    const perf = MLModels.performance(p, metricKey, horizon);

    const select = $("homeMetric");
    if (select && !select.options.length) {
      select.innerHTML = perf.metrics
        .map(m => `<option value="${esc(m.key)}">${esc(m.label)}</option>`).join("");
    }
    if (select) select.value = perf.metric.key;
    const hSelect = $("homeHorizon");
    if (hSelect) hSelect.value = String(horizon);

    const badge = $("homeModelBadge");
    if (badge) {
      const names = { ensemble: "Ridge + Holt ensemble", holt: "Holt linear trend", mean: "Baseline mean", none: "Not trained" };
      badge.textContent = names[perf.model] || perf.model;
      badge.className = `home-model-badge model-${perf.model}`;
    }

    const box = $("homeChart");
    if (box) {
      box.innerHTML = perf.series.length >= 2
        ? chartSVG(perf)
        : `<div class="empty-state">Log sets on two different dates and the model draws this chart itself.</div>`;
    }

    const legend = $("homeChartLegend");
    if (legend) {
      legend.innerHTML = perf.series.length >= 2 ? `
        <span class="hc-key"><i class="k-actual"></i>Recorded</span>
        <span class="hc-key"><i class="k-fit"></i>Model fit</span>
        <span class="hc-key"><i class="k-forecast"></i>Forecast</span>
        <span class="hc-key"><i class="k-band"></i>±${esc(nf(perf.band))} ${esc(perf.metric.unit)}</span>` : "";
    }

    const stats = $("homeModelStats");
    if (stats) {
      const cells = [
        ["Sessions", perf.series.length],
        ["Trend / session", `${perf.trendPerSession > 0 ? "+" : ""}${nf(perf.trendPerSession)} ${perf.metric.unit}`],
        ["Next projected", perf.forecast.length ? `${nf(perf.forecast[0])} ${perf.metric.unit}` : "—"],
        ["Fit R²", perf.r2 === null ? "—" : nf(perf.r2 * 100) + "%"],
        ["RMSE", perf.rmse === null ? "—" : `${nf(perf.rmse)} ${perf.metric.unit}`]
      ];
      stats.innerHTML = cells
        .map(([k, v]) => `<div class="model-stat"><small>${esc(k)}</small><b>${esc(String(v))}</b></div>`).join("");
    }

    const note = $("homeChartNote");
    if (note) {
      note.textContent = [perf.metric.hint, perf.modelDetail, perf.note].filter(Boolean).join(" — ");
    }
  }

  // -------------------------------------------------------- coach signals

  function renderInsights() {
    const box = $("homeInsights");
    if (!box) return;
    box.innerHTML = MLModels.insights(project())
      .map(i => `<div class="signal signal-${esc(i.tone)}">
          <b>${esc(i.title)}</b>
          <span>${esc(i.body)}</span>
        </div>`).join("");
  }

  function renderTrends() {
    const box = $("homeTrends");
    if (!box) return;
    const trends = MLModels.exerciseTrends(project(), 6);
    if (!trends.length) {
      box.innerHTML = `<div class="empty-state">Two dated sessions on the same exercise and its slope appears here.</div>`;
      return;
    }
    box.innerHTML = trends.map(t => {
      const sign = t.slopeKgPerSession > 0 ? "+" : "";
      return `<div class="trend-row trend-${esc(t.call)}">
        <span class="trend-main"><b>${esc(t.name)}</b><small>${esc(t.day)} · ${t.sessions} sessions</small></span>
        <span class="trend-values">
          <b>${esc(sign + nf(t.slopeKgPerSession))} kg</b><small>per session</small>
        </span>
        <span class="trend-latest"><b>${esc(nf(t.latestKg))} kg</b><small>latest top set</small></span>
      </div>`;
    }).join("");
  }

  function renderRecords() {
    const box = $("homeRecords");
    if (!box) return;
    const best = new Map();
    MLModels.setRows(project()).forEach(r => {
      if (!Number.isFinite(r.loadKg) || r.loadKg <= 0) return;
      const cur = best.get(r.exId);
      if (!cur || r.loadKg > cur.loadKg) best.set(r.exId, r);
    });
    const list = [...best.values()].sort((a, b) => b.loadKg - a.loadKg).slice(0, 6);
    if (!list.length) {
      box.innerHTML = `<div class="empty-state">Log a weight on any set and your best standardised load shows up here.</div>`;
      return;
    }
    box.innerHTML = list.map(r => `<div class="record-row">
        <span class="record-main"><b>${esc(r.exName)}</b><small>${esc(r.dayName)}${r.date ? ` · ${esc(r.date)}` : ""}</small></span>
        <span class="record-value"><b>${esc(nf(r.loadKg))} kg</b><small>${r.reps ? `× ${esc(String(r.reps))} reps` : "effective"}</small></span>
      </div>`).join("");
  }

  function renderConsistency() {
    const box = $("homeConsistency");
    if (!box) return;
    const c = MLModels.consistency(project());
    const body = MLModels.bodyForecast("weight");
    const rows = [
      ["Sessions per week", nf(c.perWeek)],
      ["Current streak", c.streak],
      ["Longest streak", c.longestStreak],
      ["Last session", c.lastDate ? `${c.lastDate}${c.gapDays === 0 ? " (today)" : ` (${c.gapDays}d ago)`}` : "—"],
      ["Body-weight slope", body.ready ? `${body.perCheck >= 0 ? "+" : ""}${nf(body.perCheck)} kg / check` : "needs 2 checks"],
      ["Next body-weight", body.ready ? `${nf(body.forecast[0])} kg` : "—"]
    ];
    box.innerHTML = rows
      .map(([k, v]) => `<div class="kv-row"><small>${esc(k)}</small><b>${esc(String(v))}</b></div>`).join("");
  }

  // ------------------------------------------------------- pipeline card

  function renderPipeline() {
    const box = $("homePipelineStats");
    if (!box) return;
    const all = $("homeExportAll")?.checked === true;
    let s;
    try {
      s = DataPipeline.stats({ allProjects: all });
    } catch (err) {
      console.error("Home: pipeline stats failed", err);
      box.innerHTML = `<div class="empty-state">Could not read the record just now.</div>`;
      return;
    }
    box.innerHTML = [
      ["Set rows", s.sets],
      ["Columns per set", s.columns],
      ["Exercises", s.exercises],
      ["Sessions", s.sessions],
      ["Day records", s.days],
      ["Cardio entries", s.cardio],
      ["Body checks", s.body],
      ["Rest intervals", s.intervals],
      ["Saved weeks", s.archives],
      ["Tables in the zip", s.tables],
      ["Values captured", s.cells]
    ].map(([k, v]) => `<div class="kv-row"><small>${esc(k)}</small><b>${esc(String(v))}</b></div>`).join("");
  }

  // -------------------------------------------------------- install card

  function renderInstall() {
    const box = $("homeInstallState");
    if (!box) return;
    if (installed()) {
      box.innerHTML = `<span class="tag ok">Installed</span> Running as an installed app — it works with no network.`;
      return;
    }
    box.innerHTML = iosLike()
      ? `<span class="tag">iPhone / iPad</span> Share → <b>Add to Home Screen</b>. Safari does not show an install button, so use the steps below.`
      : `<span class="tag">Android / desktop</span> Use <b>Install app</b> in the side panel, or the browser menu → <b>Install app</b> / <b>Add to Home screen</b>.`;
  }

  // -------------------------------------------------------- wearable recovery

  function renderRecovery() {
    const card = $("homeRecoveryCard");
    const body = $("homeRecoveryBody");
    if (!card || !body || !window.WearableStore) { if (card) card.style.display = "none"; return; }

    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    
    // Pick today's entry if present, else yesterday's, else most recent recorded day
    let rec = WearableStore.getRecovery(today);
    let recDate = today;
    let recLabel = "Today";

    if (!rec) {
      rec = WearableStore.getRecovery(yesterday);
      recDate = yesterday;
      recLabel = "Yesterday";
    }

    if (!rec) {
      const recent = WearableStore.recentDays(1);
      if (recent.length) {
        rec = WearableStore.getRecovery(recent[0].date);
        recDate = recent[0].date;
        recLabel = recDate;
      }
    }

    if (!rec) {
      card.style.display = "none";
      return;
    }

    card.style.display = "";
    const st = WearableStore.stats(7);
    const fmtMin = min => {
      if (min == null || min <= 0) return "—";
      const h = Math.floor(min / 60), m = min % 60;
      return h > 0 ? `${h}h ${m}m` : `${m}m`;
    };

    body.innerHTML = `
      <div class="recovery-grid">
        <div class="recovery-score-ring recovery-${esc(rec.tone)}">
          <span class="recovery-score-num">${rec.score}</span>
          <span class="recovery-score-label">${esc(rec.label)}</span>
        </div>
        <div class="recovery-details">
          <div class="recovery-detail-row">
            <span>Sleep</span><b>${esc(rec.sleepStr)}</b>
          </div>
          <div class="recovery-detail-row">
            <span>Deep</span><b>${fmtMin(rec.deepMin)}</b>
          </div>
          <div class="recovery-detail-row">
            <span>REM</span><b>${fmtMin(rec.remMin)}</b>
          </div>
          <div class="recovery-detail-row">
            <span>Calories</span><b>${rec.calories != null ? rec.calories.toLocaleString() + " kcal" : "—"}</b>
          </div>
          <div class="recovery-detail-row">
            <span>Steps</span><b>${rec.steps != null ? rec.steps.toLocaleString() : "—"}</b>
          </div>
          ${rec.restingHr ? `<div class="recovery-detail-row"><span>Resting HR</span><b>${rec.restingHr} bpm</b></div>` : ""}
        </div>
      </div>
      <div class="recovery-meta muted small">
        Data from ${esc(recLabel !== recDate ? `${recLabel} (${recDate})` : recDate)}${st && st.avgSleep ? ` · 7-day avg sleep: ${fmtMin(st.avgSleep)}` : ""}
      </div>
    `;
  }

  // -------------------------------------------------------- desired body

  const DEFAULT_BODY_SLOTS = [
    { key: "whole", name: "Whole body", subtitle: "Full physique" },
    { key: "chest", name: "Chest", subtitle: "Pecs & Upper Torso" },
    { key: "arms", name: "Arms", subtitle: "Biceps & Triceps" },
    { key: "abs", name: "Abs", subtitle: "Core & Midsection" },
    { key: "back", name: "Back", subtitle: "Lats, Traps & Rhomboids" },
    { key: "legs", name: "Legs", subtitle: "Quads, Hamstrings & Calves" }
  ];

  let targetUploadSlot = null;
  let activeViewerSlot = null;

  async function renderDesiredBody() {
    const container = $("homeBodyShots");
    const dropdownMenu = $("desiredDropdownMenu");
    if (!container) return;

    const p = window.Store?.active ? window.Store.active() : null;
    if (!p) return;

    if (!p.desiredBody || typeof p.desiredBody !== "object") {
      p.desiredBody = {};
    }

    // Build unified list of slots (defaults + any custom keys in project)
    const slotMap = new Map();
    DEFAULT_BODY_SLOTS.forEach(s => slotMap.set(s.key, { ...s }));

    Object.keys(p.desiredBody).forEach(k => {
      if (!slotMap.has(k)) {
        const item = p.desiredBody[k];
        slotMap.set(k, {
          key: k,
          name: item.name || k.charAt(0).toUpperCase() + k.slice(1),
          subtitle: item.subtitle || "Custom section"
        });
      }
    });

    const slots = Array.from(slotMap.values());

    // Update Dropdown Menu Items
    if (dropdownMenu) {
      dropdownMenu.innerHTML = `
        <div class="desired-menu-header">Select section to add picture:</div>
        <div class="desired-menu-list">
          ${slots.map(s => {
            const hasImg = p.desiredBody[s.key]?.hasImage || false;
            return `
              <button class="desired-menu-item" type="button" data-slot="${esc(s.key)}">
                <span class="dmi-status ${hasImg ? "dmi-filled" : "dmi-empty"}"></span>
                <span class="dmi-text">
                  <b>${esc(s.name)}</b>
                  <small>${hasImg ? "Update photo" : "Add photo"}</small>
                </span>
              </button>
            `;
          }).join("")}
          <div class="desired-menu-divider"></div>
          <button class="desired-menu-item desired-menu-custom" type="button" data-action="add-custom-section">
            <span class="dmi-icon">+</span>
            <span class="dmi-text">
              <b>Custom section...</b>
              <small>e.g. Forearms, Glutes, Delts</small>
            </span>
          </button>
        </div>
      `;

      dropdownMenu.querySelectorAll(".desired-menu-item[data-slot]").forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const slotKey = btn.dataset.slot;
          triggerUploadForSlot(slotKey);
          closeDesiredDropdown();
        };
      });

      const customBtn = dropdownMenu.querySelector("[data-action='add-custom-section']");
      if (customBtn) {
        customBtn.onclick = (e) => {
          e.stopPropagation();
          closeDesiredDropdown();
          promptAddCustomSection();
        };
      }
    }

    // Render Body Slots Grid
    container.innerHTML = "";
    for (const slot of slots) {
      const fig = document.createElement("figure");
      fig.className = "body-slot";
      fig.dataset.bodySlot = slot.key;

      const frame = document.createElement("div");
      frame.className = "body-slot-frame";

      // Check for image in IndexedDB via MediaStore
      let imgUrl = null;
      try {
        if (window.MediaStore?.getDesiredImageURL) {
          imgUrl = await window.MediaStore.getDesiredImageURL(p.id, slot.key);
        }
      } catch (err) {
        console.warn("Error getting desired image:", err);
      }

      if (imgUrl) {
        frame.classList.add("has-photo");
        frame.innerHTML = `
          <img src="${imgUrl}" alt="${esc(slot.name)} target physique">
          <div class="body-slot-overlay">
            <button class="btn small-btn primary bso-view" type="button">View</button>
            <button class="btn small-btn bso-change" type="button">Change</button>
          </div>
        `;
        frame.querySelector(".bso-view")?.addEventListener("click", (e) => {
          e.stopPropagation();
          openViewerModal(slot.key, slot.name, imgUrl);
        });
        frame.querySelector(".bso-change")?.addEventListener("click", (e) => {
          e.stopPropagation();
          triggerUploadForSlot(slot.key);
        });
        frame.addEventListener("click", () => {
          openViewerModal(slot.key, slot.name, imgUrl);
        });
      } else {
        frame.innerHTML = `
          <div class="body-slot-empty">
            <span class="body-slot-icon">⊕</span>
            <span class="body-slot-hint">Add photo</span>
          </div>
        `;
        frame.style.cursor = "pointer";
        frame.addEventListener("click", () => {
          triggerUploadForSlot(slot.key);
        });
      }

      const figcap = document.createElement("figcaption");
      const hasPic = Boolean(imgUrl);
      figcap.innerHTML = `
        <b>${esc(slot.name)}</b>
        <small>${hasPic ? "Photo set" : esc(slot.subtitle || "Tap to add")}</small>
      `;

      fig.appendChild(frame);
      fig.appendChild(figcap);
      container.appendChild(fig);
    }
  }

  function triggerUploadForSlot(slotKey) {
    targetUploadSlot = slotKey;
    const input = $("desiredFileInput");
    if (input) {
      input.value = "";
      input.click();
    }
  }

  function toggleDesiredDropdown(e) {
    if (e) e.stopPropagation();
    const menu = $("desiredDropdownMenu");
    const btn = $("desiredAddBtn");
    if (!menu) return;
    const isHidden = menu.hidden;
    menu.hidden = !isHidden;
    if (btn) btn.setAttribute("aria-expanded", String(isHidden));
  }

  function closeDesiredDropdown() {
    const menu = $("desiredDropdownMenu");
    const btn = $("desiredAddBtn");
    if (menu) menu.hidden = true;
    if (btn) btn.setAttribute("aria-expanded", "false");
  }

  function promptAddCustomSection() {
    const p = window.Store?.active ? window.Store.active() : null;
    if (!p) return;
    const name = window.prompt("Enter new section name (e.g. Forearms, Glutes, Delts):");
    if (!name || !name.trim()) return;
    const cleanName = name.trim();
    const key = cleanName.toLowerCase().replace(/[^a-z0-9]/g, "_");
    if (!p.desiredBody) p.desiredBody = {};
    p.desiredBody[key] = {
      name: cleanName,
      subtitle: "Custom section",
      hasImage: false,
      createdAt: new Date().toISOString()
    };
    window.Store?.save?.();
    renderDesiredBody();
    triggerUploadForSlot(key);
  }

  function openViewerModal(slotKey, slotName, imgUrl) {
    activeViewerSlot = slotKey;
    const modal = $("desiredViewerModal");
    const title = $("desiredViewerTitle");
    const img = $("desiredViewerImg");
    if (!modal || !img) return;

    if (title) title.textContent = `${slotName} target`;
    img.src = imgUrl;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
  }

  function closeViewerModal() {
    const modal = $("desiredViewerModal");
    if (modal) {
      modal.classList.remove("open");
      modal.setAttribute("aria-hidden", "true");
    }
    activeViewerSlot = null;
  }

  async function deleteActiveViewerPhoto() {
    if (!activeViewerSlot) return;
    const p = window.Store?.active ? window.Store.active() : null;
    if (!p) return;

    if (confirm("Remove target physique photo for this section?")) {
      try {
        await window.MediaStore?.deleteDesiredImage?.(p.id, activeViewerSlot);
        if (p.desiredBody && p.desiredBody[activeViewerSlot]) {
          p.desiredBody[activeViewerSlot].hasImage = false;
        }
        window.Store?.save?.();
        window.UI?.toast?.("Photo removed");
      } catch (err) {
        console.warn("Failed to remove desired photo:", err);
      }
      closeViewerModal();
      renderDesiredBody();
    }
  }

  // -------------------------------------------------------------- render

  function render() {
    if (!$("homeView")) return;
    const steps = [
      ["hero", renderHero],
      ["chart", renderChart],
      ["recovery", renderRecovery],
      ["desiredBody", renderDesiredBody],
      ["insights", renderInsights],
      ["trends", renderTrends],
      ["records", renderRecords],
      ["consistency", renderConsistency],
      ["pipeline", renderPipeline],
      ["install", renderInstall]
    ];
    // One broken section must not blank the whole page - Home is the landing view.
    steps.forEach(([name, fn]) => {
      try { fn(); } catch (err) { console.error(`Home: ${name} failed`, err); }
    });
  }

  function setMetric(key) {
    metricKey = key;
    renderChart();
  }

  function init() {
    $("homeMetric")?.addEventListener("change", e => setMetric(e.target.value));
    $("homeHorizon")?.addEventListener("change", e => {
      horizon = Math.max(1, Math.min(8, Number(e.target.value) || 3));
      renderChart();
    });
    $("homeExportAll")?.addEventListener("change", renderPipeline);

    // Desired body dropdown toggle
    $("desiredAddBtn")?.addEventListener("click", toggleDesiredDropdown);

    // Close dropdown when clicking outside
    document.addEventListener("click", (e) => {
      const wrap = $("desiredDropdownWrap");
      if (wrap && !wrap.contains(e.target)) {
        closeDesiredDropdown();
      }
    });

    // Desired body file upload input handler
    $("desiredFileInput")?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file || !targetUploadSlot) return;

      const p = window.Store?.active ? window.Store.active() : null;
      if (!p) return;

      try {
        await window.MediaStore?.saveDesiredImage?.(p.id, targetUploadSlot, file);
        if (!p.desiredBody) p.desiredBody = {};
        if (!p.desiredBody[targetUploadSlot]) {
          p.desiredBody[targetUploadSlot] = {};
        }
        p.desiredBody[targetUploadSlot].hasImage = true;
        p.desiredBody[targetUploadSlot].updatedAt = new Date().toISOString();
        window.Store?.save?.();
        window.UI?.toast?.(`Target picture saved!`, "ok");
        renderDesiredBody();
      } catch (err) {
        console.error("Save desired image failed:", err);
        window.UI?.toast?.("Could not save picture", "error");
      }
      e.target.value = "";
    });

    // Desired viewer modal handlers
    $("desiredViewerDelete")?.addEventListener("click", deleteActiveViewerPhoto);
    document.querySelectorAll("[data-close-desired-viewer]").forEach(el => {
      el.addEventListener("click", closeViewerModal);
    });

    // app.js runs its DOMContentLoaded handler first and renderAll() calls
    // Home.render(), so only paint here if that did not happen (e.g. app.js
    // threw before it got that far). Rebuilding every table twice on boot is
    // pure waste otherwise.
    if (!$("homeHeroStats")?.childElementCount) render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  return { render, renderChart, renderPipeline, renderDesiredBody, setMetric, get metric() { return metricKey; } };
})();
