// ml.js - a small, dependency-free machine-learning toolkit and the trained models
// that drive the Home performance chart.
//
// WHY IT IS WRITTEN BY HAND
// -------------------------------------------------------------------------------
// GymCoach is a static PWA with no build step and it must keep working with no
// network at all (see sw.js). Pulling in TensorFlow.js or ml.js from a CDN would
// break offline use the moment the cache misses, and would dwarf the rest of the
// app. Everything here is therefore plain arithmetic: no dependencies, no CDN, no
// WebAssembly, ~10 KB, runs in a couple of milliseconds on a phone.
//
// WHAT IS ACTUALLY FITTED
// -------------------------------------------------------------------------------
//  1. Ridge regression (L2-regularised least squares, solved in closed form via the
//     normal equations with Gaussian elimination) over engineered features:
//     session index, its square, and autoregressive lags. Regularisation matters
//     here because a training log is short and wide-ish: with 8 sessions and 4
//     features, ordinary least squares overfits and the forecast explodes.
//  2. Holt's linear trend (double exponential smoothing) as a second, very
//     different estimator - robust on tiny samples where regression has nothing
//     to learn from.
//  3. A 50/50 ensemble of the two, which is what the chart shows. Ensembling two
//     estimators with uncorrelated failure modes is the cheapest accuracy win
//     available at this sample size.
//  4. Logistic regression (batch gradient descent, L2 penalty) for the probability
//     that a set gets completed, from load / reps / position / RIR / elapsed time.
//  5. Per-exercise trend slopes (ridge on a single feature) turned into
//     increase / hold / decrease calls.
//
// Every model reports its own goodness of fit. Nothing here pretends to be
// certain: sample sizes are small by nature and the UI says so.

window.MLModels = (() => {

  // =====================================================================
  // numeric helpers
  // =====================================================================

  const isNum = v => typeof v === "number" && Number.isFinite(v);
  const mean = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

  function std(a, m = mean(a)) {
    if (a.length < 2) return 0;
    return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
  }

  const round = (v, dp = 2) => {
    const f = 10 ** dp;
    return Math.round((Number(v) || 0) * f) / f;
  };

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // =====================================================================
  // linear algebra - just enough to solve the normal equations
  // =====================================================================

  // Gaussian elimination with partial pivoting. Returns null on a singular
  // system rather than NaNs, so callers can fall back to a simpler model.
  function solve(A, b) {
    const n = A.length;
    if (!n || A.some(r => r.length !== n) || b.length !== n) return null;
    const M = A.map((row, i) => [...row, b[i]]);

    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) {
        if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      }
      if (Math.abs(M[piv][c]) < 1e-10) return null;
      if (piv !== c) { const t = M[c]; M[c] = M[piv]; M[piv] = t; }

      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        if (!f) continue;
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }

    const x = M.map((row, i) => row[n] / row[i]);
    return x.every(isNum) ? x : null;
  }

  // Column-wise z-scoring. A zero-variance column gets std 1 so it collapses to a
  // constant contribution instead of producing Infinity.
  function standardiser(X) {
    const p = X[0]?.length || 0;
    const mu = [], sd = [];
    for (let j = 0; j < p; j++) {
      const col = X.map(r => r[j]);
      const m = mean(col);
      const s = std(col, m);
      mu.push(m);
      sd.push(s > 1e-9 ? s : 1);
    }
    return {
      mu, sd,
      apply: x => x.map((v, j) => (v - mu[j]) / sd[j])
    };
  }

  // =====================================================================
  // model 1 - ridge regression
  // =====================================================================

  // Minimises ||y - Xw - b||^2 + lambda * ||w||^2 on standardised features.
  // Features are standardised and y centred, so the intercept is simply mean(y)
  // and the penalty treats every feature on the same scale.
  function ridgeFit(X, y, lambda = 1) {
    if (!Array.isArray(X) || X.length < 2 || !X[0]?.length) return null;
    const n = X.length, p = X[0].length;
    if (y.length !== n) return null;

    const sc = standardiser(X);
    const Z = X.map(sc.apply);
    const yBar = mean(y);
    const yc = y.map(v => v - yBar);

    // A = Z'Z + lambda*I ,  b = Z'yc
    const A = Array.from({ length: p }, (_, i) =>
      Array.from({ length: p }, (_, j) => {
        let s = 0;
        for (let r = 0; r < n; r++) s += Z[r][i] * Z[r][j];
        return s + (i === j ? lambda : 0);
      }));
    const bv = Array.from({ length: p }, (_, i) => {
      let s = 0;
      for (let r = 0; r < n; r++) s += Z[r][i] * yc[r];
      return s;
    });

    const w = solve(A, bv);
    if (!w) return null;

    const model = {
      kind: "ridge",
      lambda,
      n, p,
      weights: w,
      intercept: yBar,
      scaler: sc,
      predict: x => yBar + sc.apply(x).reduce((s, v, j) => s + v * w[j], 0)
    };
    const fitted = X.map(model.predict);
    model.fitted = fitted;
    model.r2 = r2(y, fitted);
    model.rmse = rmse(y, fitted);
    model.residualStd = std(y.map((v, i) => v - fitted[i]));
    return model;
  }

  // =====================================================================
  // model 2 - Holt's linear trend (double exponential smoothing)
  // =====================================================================

  function holtFit(series, alpha = 0.5, beta = 0.3) {
    const y = series.filter(isNum);
    if (y.length < 2) {
      const only = y[0] ?? 0;
      return {
        kind: "holt", alpha, beta, n: y.length,
        level: only, trend: 0, fitted: y.slice(),
        r2: 0, rmse: 0, residualStd: 0,
        forecast: () => only
      };
    }

    let level = y[0];
    let trend = y[1] - y[0];
    const fitted = [y[0]];

    for (let t = 1; t < y.length; t++) {
      const predicted = level + trend;
      fitted.push(predicted);
      const prevLevel = level;
      level = alpha * y[t] + (1 - alpha) * predicted;
      trend = beta * (level - prevLevel) + (1 - beta) * trend;
    }

    return {
      kind: "holt", alpha, beta, n: y.length,
      level, trend, fitted,
      r2: r2(y, fitted),
      rmse: rmse(y, fitted),
      residualStd: std(y.map((v, i) => v - fitted[i])),
      forecast: (h = 1) => level + h * trend
    };
  }

  // Grid-searches alpha/beta instead of trusting one arbitrary pair. Cheap at
  // these sample sizes and noticeably steadier on noisy logs.
  function holtAuto(series) {
    let best = null;
    for (let a = 0.2; a <= 0.9; a += 0.1) {
      for (let b = 0.1; b <= 0.7; b += 0.1) {
        const m = holtFit(series, round(a, 2), round(b, 2));
        if (!best || m.rmse < best.rmse) best = m;
      }
    }
    return best || holtFit(series);
  }

  // =====================================================================
  // model 3 - logistic regression (batch gradient descent + L2)
  // =====================================================================

  const sigmoid = z => 1 / (1 + Math.exp(-clamp(z, -30, 30)));

  function logisticFit(X, y, { epochs = 600, lr = 0.25, l2 = 0.02 } = {}) {
    if (!Array.isArray(X) || X.length < 8 || !X[0]?.length) return null;
    const n = X.length, p = X[0].length;
    const sc = standardiser(X);
    const Z = X.map(sc.apply);

    let w = new Array(p).fill(0);
    let b = 0;

    for (let e = 0; e < epochs; e++) {
      const gw = new Array(p).fill(0);
      let gb = 0;
      for (let i = 0; i < n; i++) {
        const err = sigmoid(Z[i].reduce((s, v, j) => s + v * w[j], 0) + b) - y[i];
        for (let j = 0; j < p; j++) gw[j] += err * Z[i][j];
        gb += err;
      }
      for (let j = 0; j < p; j++) w[j] -= lr * (gw[j] / n + l2 * w[j]);
      b -= lr * (gb / n);
    }

    const predict = x => sigmoid(sc.apply(x).reduce((s, v, j) => s + v * w[j], 0) + b);
    const probs = X.map(predict);
    const hits = probs.filter((pr, i) => (pr >= 0.5 ? 1 : 0) === y[i]).length;
    const base = mean(y);

    return {
      kind: "logistic",
      n, p, weights: w, intercept: b, scaler: sc, predict,
      accuracy: hits / n,
      baseRate: base,
      // Log loss, so a model that is confidently wrong scores worse than a hedge.
      logLoss: -mean(y.map((t, i) => {
        const q = clamp(probs[i], 1e-6, 1 - 1e-6);
        return t * Math.log(q) + (1 - t) * Math.log(1 - q);
      }))
    };
  }

  // =====================================================================
  // scoring
  // =====================================================================

  function r2(yTrue, yPred) {
    if (!yTrue.length) return 0;
    const m = mean(yTrue);
    const ssTot = yTrue.reduce((s, v) => s + (v - m) ** 2, 0);
    const ssRes = yTrue.reduce((s, v, i) => s + (v - (yPred[i] ?? m)) ** 2, 0);
    if (ssTot < 1e-12) return 0;
    return clamp(1 - ssRes / ssTot, -1, 1);
  }

  function rmse(yTrue, yPred) {
    if (!yTrue.length) return 0;
    return Math.sqrt(mean(yTrue.map((v, i) => (v - (yPred[i] ?? 0)) ** 2)));
  }

  // =====================================================================
  // feature extraction from the training log
  // =====================================================================

  const effKg = (value, unit, pulley) => {
    const kg = Store.weightToKg(value, unit);
    if (kg === null) return null;
    return kg / Store.pulleyRatio(pulley);
  };

  function repsOf(ex, log) {
    const col = (ex.setColumns || []).find(c => c.key === "reps" || /rep/i.test(c.label || ""));
    if (!col) return null;
    const m = String(log.values?.[col.key] ?? "").match(/\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : null;
  }

  function loadOf(ex, log) {
    const col = (ex.setColumns || []).find(c => c.key === "weight" || /weight/i.test(c.label || ""));
    const raw = col ? log.values?.[col.key] : "";
    const fromSet = effKg(raw, ex.weightUnit, ex.pulleySystem);
    return fromSet !== null ? fromSet : effKg(ex.weight, ex.weightUnit, ex.pulleySystem);
  }

  function secondsOf(ex, log) {
    const col = (ex.setColumns || []).find(c => c.key === "time" || /time/i.test(c.label || ""));
    const text = String(col ? log.values?.[col.key] ?? "" : "").trim();
    if (!text) return null;
    if (/^\d+(?::\d{1,2}){1,2}$/.test(text)) {
      const parts = text.split(":").map(Number);
      return parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  }

  // One row per logged set, flattened - the raw table every model reads from.
  function setRows(project = Store.active()) {
    const out = [];
    (project?.days || []).forEach((d, di) => {
      if (d.type !== "workout") return;
      (d.exercises || []).forEach((ex, ei) => {
        (ex.logs || []).forEach((log, li) => {
          const date = Store.dateKey(log.date);
          const rir = Store.parseWeightNumber(log.rir);
          out.push({
            date,
            dayIndex: di, dayId: d.id, dayName: d.name,
            exIndex: ei, exId: ex.id, exName: ex.name,
            setIndex: li + 1,
            loadKg: loadOf(ex, log),
            reps: repsOf(ex, log),
            rir: rir === null ? null : rir,
            seconds: secondsOf(ex, log),
            completed: !!log.completed
          });
        });
      });
    });
    return out;
  }

  // Collapse set rows into one record per training date - the model's time axis.
  function sessionSeries(project = Store.active()) {
    const byDate = new Map();
    setRows(project).forEach(r => {
      if (!r.date) return;
      if (!byDate.has(r.date)) {
        byDate.set(r.date, {
          date: r.date, sets: 0, completedSets: 0, reps: 0,
          volumeKg: 0, topLoadKg: 0, seconds: 0,
          rirValues: [], dayNames: new Set()
        });
      }
      const s = byDate.get(r.date);
      s.sets++;
      if (r.completed) s.completedSets++;
      if (isNum(r.reps)) s.reps += r.reps;
      if (isNum(r.loadKg)) s.topLoadKg = Math.max(s.topLoadKg, r.loadKg);
      if (isNum(r.loadKg) && isNum(r.reps)) s.volumeKg += r.loadKg * r.reps;
      if (isNum(r.seconds)) s.seconds += r.seconds;
      if (isNum(r.rir)) s.rirValues.push(r.rir);
      s.dayNames.add(r.dayName);
    });

    return [...byDate.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(s => ({
        date: s.date,
        label: [...s.dayNames].join(" / "),
        sets: s.sets,
        completedSets: s.completedSets,
        completion: s.sets ? s.completedSets / s.sets : 0,
        reps: s.reps,
        volumeKg: round(s.volumeKg, 1),
        topLoadKg: round(s.topLoadKg, 2),
        seconds: s.seconds,
        minutes: round(s.seconds / 60, 1),
        meanRir: s.rirValues.length ? round(mean(s.rirValues), 2) : null
      }));
  }

  // =====================================================================
  // the Home chart model - ridge + Holt ensemble with a forecast
  // =====================================================================

  const METRICS = [
    { key: "volumeKg", label: "Training volume", unit: "kg", hint: "effective load x reps, summed over the session" },
    { key: "topLoadKg", label: "Top effective load", unit: "kg", hint: "heaviest standardised set of the session" },
    { key: "reps", label: "Total reps", unit: "reps", hint: "every rep you logged that session" },
    { key: "sets", label: "Sets logged", unit: "sets", hint: "how much work you got through" },
    { key: "minutes", label: "Recorded set time", unit: "min", hint: "timer total after delay balancing" }
  ];

  // Autoregressive design matrix. Rows start at index `lags` because earlier rows
  // have no history to look back on.
  function designMatrix(y, lags = 2) {
    const X = [], target = [], index = [];
    for (let i = lags; i < y.length; i++) {
      const window = y.slice(Math.max(0, i - 3), i);
      X.push([i, i * i, y[i - 1], y[i - 2], mean(window)]);
      target.push(y[i]);
      index.push(i);
    }
    return { X, target, index };
  }

  function performance(project = Store.active(), metricKey = "volumeKg", horizon = 3) {
    const metric = METRICS.find(m => m.key === metricKey) || METRICS[0];
    const series = sessionSeries(project);
    const y = series.map(s => Number(s[metric.key]) || 0);

    const result = {
      metric,
      metrics: METRICS,
      series,
      y,
      fitted: [],
      forecast: [],
      band: 0,
      model: "none",
      modelDetail: "",
      r2: null,
      rmse: null,
      trendPerSession: 0,
      ready: false,
      note: ""
    };

    if (series.length === 0) {
      result.note = "No dated sets yet. Log a session and the model trains itself.";
      return result;
    }
    if (series.length < 3) {
      result.model = "mean";
      result.modelDetail = `Baseline mean of ${series.length} session${series.length === 1 ? "" : "s"}`;
      const m = mean(y);
      result.fitted = y.map(() => round(m, 1));
      result.forecast = Array.from({ length: horizon }, () => round(m, 1));
      result.band = std(y);
      result.note = "Three sessions unlock trend fitting; five unlock the regression.";
      return result;
    }

    // --- estimator B: Holt linear trend (always available from 3 points)
    const holt = holtAuto(y);
    const holtForecast = Array.from({ length: horizon }, (_, h) => holt.forecast(h + 1));

    // --- estimator A: ridge on autoregressive + polynomial-time features
    let ridge = null;
    const { X, target } = designMatrix(y, 2);
    if (X.length >= 3) ridge = ridgeFit(X, target, 1.0);

    let fitted, forecast, label, detail, score, err;

    if (ridge && ridge.r2 > 0) {
      // In-sample curve: the first two points have no lags, so they are carried
      // from Holt rather than left as holes in the line.
      fitted = y.map((v, i) => (i < 2 ? holt.fitted[i] : ridge.predict(X[i - 2])));

      // Recursive multi-step forecast: each step feeds its own prediction back in.
      const rolling = y.slice();
      const ridgeForecast = [];
      for (let h = 0; h < horizon; h++) {
        const i = rolling.length;
        const window = rolling.slice(Math.max(0, i - 3), i);
        ridgeForecast.push(ridge.predict([i, i * i, rolling[i - 1], rolling[i - 2], mean(window)]));
        rolling.push(ridgeForecast[h]);
      }

      forecast = ridgeForecast.map((v, h) => (v + holtForecast[h]) / 2);
      label = "ensemble";
      detail = `Ridge regression (lambda ${ridge.lambda}, ${ridge.p} features, n=${ridge.n}) blended 50/50 with Holt linear trend (alpha ${holt.alpha}, beta ${holt.beta})`;
      score = (ridge.r2 + holt.r2) / 2;
      err = (ridge.rmse + holt.rmse) / 2;
    } else {
      fitted = holt.fitted.slice();
      forecast = holtForecast;
      label = "holt";
      detail = `Holt linear trend, double exponential smoothing (alpha ${holt.alpha}, beta ${holt.beta}, n=${holt.n})`;
      score = holt.r2;
      err = holt.rmse;
      if (ridge) result.note = "Regression found no signal beyond the trend, so the smoother is driving the forecast.";
    }

    const floor = metric.key === "meanRir" ? -5 : 0;
    result.fitted = fitted.map(v => round(Math.max(floor, v), 1));
    result.forecast = forecast.map(v => round(Math.max(floor, v), 1));
    result.band = round(Math.max(err, std(y.map((v, i) => v - fitted[i]))), 1);
    result.model = label;
    result.modelDetail = detail;
    result.r2 = round(score, 3);
    result.rmse = round(err, 2);
    result.ridge = ridge;
    result.holt = holt;
    result.trendPerSession = round(holt.trend, 2);
    result.ready = true;
    if (!result.note) {
      result.note = series.length < 6
        ? "Trained on a short log - treat the forecast as a direction, not a target."
        : "";
    }
    return result;
  }

  // =====================================================================
  // completion classifier - what predicts a set actually getting finished
  // =====================================================================

  const COMPLETION_FEATURES = ["Effective load", "Reps", "Set position", "RIR", "Set duration"];

  function completionModel(project = Store.active()) {
    const rows = setRows(project).filter(r =>
      isNum(r.loadKg) || isNum(r.reps) || isNum(r.rir) || isNum(r.seconds));
    if (rows.length < 8) {
      return { ready: false, n: rows.length, note: "Needs about 8 logged sets before this trains." };
    }

    const X = rows.map(r => [
      isNum(r.loadKg) ? r.loadKg : 0,
      isNum(r.reps) ? r.reps : 0,
      r.setIndex,
      isNum(r.rir) ? r.rir : 0,
      isNum(r.seconds) ? r.seconds : 0
    ]);
    const y = rows.map(r => (r.completed ? 1 : 0));

    // A log where everything (or nothing) is ticked carries no signal to learn.
    const positives = y.reduce((s, v) => s + v, 0);
    if (positives === 0 || positives === y.length) {
      return {
        ready: false, n: rows.length,
        note: positives ? "Every logged set is ticked - nothing to separate yet." : "No completed sets yet."
      };
    }

    const model = logisticFit(X, y);
    if (!model) return { ready: false, n: rows.length, note: "Not enough variation to fit." };

    const drivers = model.weights
      .map((w, i) => ({ feature: COMPLETION_FEATURES[i], weight: round(w, 3) }))
      .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));

    return {
      ready: true,
      n: rows.length,
      accuracy: round(model.accuracy, 3),
      baseRate: round(model.baseRate, 3),
      logLoss: round(model.logLoss, 3),
      drivers,
      lift: round(model.accuracy - Math.max(model.baseRate, 1 - model.baseRate), 3),
      note: ""
    };
  }

  // =====================================================================
  // per-exercise progression calls
  // =====================================================================

  function exerciseTrends(project = Store.active(), limit = 6) {
    const byEx = new Map();
    setRows(project).forEach(r => {
      if (!r.date || !isNum(r.loadKg)) return;
      const k = `${r.exId}`;
      if (!byEx.has(k)) byEx.set(k, { name: r.exName, day: r.dayName, points: new Map() });
      const rec = byEx.get(k);
      const prev = rec.points.get(r.date) || 0;
      // Top set of the day is the cleanest progression signal available.
      rec.points.set(r.date, Math.max(prev, r.loadKg));
    });

    const out = [];
    byEx.forEach(rec => {
      const dates = [...rec.points.keys()].sort();
      if (dates.length < 2) return;
      const y = dates.map(d => rec.points.get(d));
      const X = y.map((_, i) => [i]);
      const model = ridgeFit(X, y, 0.35);
      const slope = model
        ? (model.predict([y.length - 1]) - model.predict([0])) / Math.max(1, y.length - 1)
        : (y[y.length - 1] - y[0]) / Math.max(1, y.length - 1);
      const rel = y[0] > 0 ? slope / y[0] : 0;

      out.push({
        name: rec.name,
        day: rec.day,
        sessions: dates.length,
        latestKg: round(y[y.length - 1], 2),
        slopeKgPerSession: round(slope, 2),
        r2: model ? round(model.r2, 3) : null,
        call: rel > 0.015 ? "increase" : rel < -0.015 ? "decrease" : "hold"
      });
    });

    return out
      .sort((a, b) => Math.abs(b.slopeKgPerSession) - Math.abs(a.slopeKgPerSession))
      .slice(0, limit);
  }

  // =====================================================================
  // body-measurement forecast
  // =====================================================================

  function bodyForecast(field = "weight", horizon = 4) {
    const prof = Store.profile();
    const history = (prof.history || [])
      .map(h => ({ date: h.date, value: Store.parseWeightNumber(h[field]) }))
      .filter(h => h.date && isNum(h.value))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

    if (history.length < 2) {
      return { ready: false, field, history, note: "Two weekly checks and this starts forecasting." };
    }

    const y = history.map(h => h.value);
    const model = holtAuto(y);
    return {
      ready: true,
      field,
      history,
      fitted: model.fitted.map(v => round(v, 2)),
      forecast: Array.from({ length: horizon }, (_, h) => round(model.forecast(h + 1), 2)),
      perCheck: round(model.trend, 2),
      r2: round(model.r2, 3),
      model: `Holt linear trend (alpha ${model.alpha}, beta ${model.beta})`,
      note: history.length < 4 ? "Short history - the slope will move a lot with the next check." : ""
    };
  }

  // =====================================================================
  // consistency / streaks - simple statistics, no model needed
  // =====================================================================

  function consistency(project = Store.active()) {
    const dates = [...new Set(setRows(project).map(r => r.date).filter(Boolean))].sort();
    if (!dates.length) return { sessions: 0, streak: 0, longestStreak: 0, perWeek: 0, lastDate: "", gapDays: null };

    const dayMs = 86400000;
    const asDate = k => new Date(`${k}T00:00:00`);

    let longest = 1, run = 1;
    for (let i = 1; i < dates.length; i++) {
      const gap = Math.round((asDate(dates[i]) - asDate(dates[i - 1])) / dayMs);
      run = gap <= 2 ? run + 1 : 1;         // a rest day between sessions keeps a streak alive
      longest = Math.max(longest, run);
    }

    const last = dates[dates.length - 1];
    const gapDays = Math.round((asDate(Store.todayKey()) - asDate(last)) / dayMs);
    const spanWeeks = Math.max(1, (asDate(last) - asDate(dates[0])) / dayMs / 7);

    return {
      sessions: dates.length,
      streak: gapDays <= 2 ? run : 0,
      longestStreak: longest,
      perWeek: round(dates.length / spanWeeks, 1),
      lastDate: last,
      gapDays
    };
  }

  // =====================================================================
  // human-readable read-out, built from the fitted models
  // =====================================================================

  function insights(project = Store.active()) {
    const perf = performance(project, "volumeKg");
    const comp = completionModel(project);
    const trends = exerciseTrends(project);
    const body = bodyForecast("weight");
    const cons = consistency(project);
    const out = [];

    if (perf.ready) {
      const dir = perf.trendPerSession > 0 ? "rising" : perf.trendPerSession < 0 ? "falling" : "flat";
      const next = perf.forecast[0];
      out.push({
        tone: perf.trendPerSession >= 0 ? "ok" : "warn",
        title: `Volume trend is ${dir}`,
        body: `${dir === "flat" ? "No net change" : `${Math.abs(perf.trendPerSession)} kg per session`} across ${perf.series.length} sessions. `
          + `Next session projects to about ${next} kg of effective volume (±${perf.band}).`
      });
    } else if (perf.series.length) {
      out.push({ tone: "info", title: "Model is still warming up", body: perf.note });
    }

    if (comp.ready) {
      const top = comp.drivers[0];
      out.push({
        tone: comp.lift > 0 ? "ok" : "info",
        title: `Completion classifier: ${Math.round(comp.accuracy * 100)}% accurate`,
        body: `Trained on ${comp.n} sets. Strongest signal: ${top.feature.toLowerCase()} `
          + `(${top.weight > 0 ? "raises" : "lowers"} the odds a set gets finished).`
      });
    }

    const up = trends.filter(t => t.call === "increase");
    const down = trends.filter(t => t.call === "decrease");
    if (up.length) {
      out.push({
        tone: "ok",
        title: `${up.length} lift${up.length === 1 ? "" : "s"} trending up`,
        body: up.slice(0, 3).map(t => `${t.name} +${t.slopeKgPerSession} kg/session`).join(" · ")
      });
    }
    if (down.length) {
      out.push({
        tone: "warn",
        title: `${down.length} lift${down.length === 1 ? "" : "s"} sliding`,
        body: down.slice(0, 3).map(t => `${t.name} ${t.slopeKgPerSession} kg/session`).join(" · ")
          + " — check recovery, or drop the target and rebuild."
      });
    }

    if (body.ready) {
      out.push({
        tone: "info",
        title: "Body-weight trend",
        body: `${body.perCheck >= 0 ? "+" : ""}${body.perCheck} kg per weekly check; `
          + `next check projects ${body.forecast[0]} kg.`
      });
    }

    if (cons.sessions) {
      out.push({
        tone: cons.gapDays > 3 ? "warn" : "ok",
        title: `${cons.perWeek} sessions per week`,
        body: cons.gapDays > 3
          ? `${cons.gapDays} days since the last logged session. Longest streak so far: ${cons.longestStreak}.`
          : `Current streak ${cons.streak}, best ${cons.longestStreak}, ${cons.sessions} sessions logged.`
      });
    }

    if (!out.length) {
      out.push({
        tone: "info",
        title: "Nothing to model yet",
        body: "Log a few sets with weight and reps, then this panel fills in on its own."
      });
    }
    return out;
  }

  return {
    // toolkit
    solve, standardiser, ridgeFit, holtFit, holtAuto, logisticFit, r2, rmse, mean, std,
    // features
    setRows, sessionSeries, METRICS,
    // fitted models
    performance, completionModel, exerciseTrends, bodyForecast, consistency, insights
  };
})();
