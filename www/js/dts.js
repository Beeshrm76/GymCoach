// js/dts.js — Daily Training Score (DTS 0–100) scoring engine.
// Implements calibration reference, EWMA personal baseline blending, bounded sigmoid normalization,
// and transparent explainable breakdown.

(function () {
  // Centralized Calibration Reference (Section 9)
  const REFERENCE_CONFIG = {
    // 4 exercises x 3 sets x 10 reps @ moderate load (~10,000 kg weighted volume)
    strengthReference: 10000,
    // 25 min @ 5 km/h on 2% incline (25 * 5 * 1.2 = 150 workload units)
    cardioReference: 150,
    referenceVersion: 1,
    upperBoundStrengthNormalized: 5.0,
    upperBoundCardioNormalized: 5.0,
    k_strength: 2.0,
    k_cardio: 2.0,
    scoringVersion: "1.0"
  };

  // Centralized Configuration Constants (Section 19)
  const DTS_CONFIG = {
    strengthWeight: 1.0,
    cardioWeight: 0.25,
    sigmoidStrengthK: 2.0,
    sigmoidCardioK: 2.0,
    baselineWindowDays: 30,
    cardioMaxContribution: 25,
    minQualifyingWorkoutsForBlend: 5,
    fullPersonalWorkoutsThreshold: 30,
    ewmaAlpha: 0.15,
    defaultUserWeightKg: 75.0,
    defaultUserHeightCm: 175.0,
    // Cardio Type Multipliers to balance raw numerical formulas
    treadmillMultiplier: 1.0,
    cyclingMultiplier: 0.33,
    otherCardioMultiplier: 1.0
  };

  // Centralized Cardio Metadata System (Section 11.4)
  const CARDIO_METADATA = {
    treadmill: {
      multiplierKey: 'treadmillMultiplier',
      formula: (c) => {
        const d = num(c.duration, 0);
        const s = num(c.speed, 0) || 5.0;
        const i = Math.max(0, num(c.incline, 0));
        return d * s * (1 + i / 10);
      }
    },
    cycling: {
      multiplierKey: 'cyclingMultiplier',
      formula: (c) => {
        const d = num(c.duration, 0);
        const s = num(c.speed, 0) || 15.0;
        const g = Math.max(1, num(c.gear, 1));
        return d * s * (1 + (g - 1) / 10);
      }
    },
    other: {
      multiplierKey: 'otherCardioMultiplier',
      formula: (c) => {
        const d = num(c.duration, 0);
        const s = num(c.speed, 0) || 5.0;
        return d * s;
      }
    }
  };

  // Sigmoid activation: 1 / (1 + e^(-x))
  function sigmoid(x) {
    return 1 / (1 + Math.exp(-x));
  }

  // Epley formula: Estimated 1RM = Weight * (1 + Reps / 30)
  function calculateEpley1RM(weight, reps) {
    const w = Number(weight) || 0;
    const r = Number(reps) || 0;
    if (w <= 0 || r <= 0) return 0;
    if (r === 1) return w;
    return Math.round((w * (1 + r / 30)) * 10) / 10;
  }

  // Parse numeric values safely
  function num(val, fallback = 0) {
    if (val === null || val === undefined) return fallback;
    const m = String(val).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : fallback;
  }

  // Calculate effective load for a set given exercise metadata and user bodyweight
  function calculateEffectiveLoad(setWeight, metadata, userBodyWeightKg) {
    const external = num(setWeight, 0);
    const bwFactor = metadata?.bodyweight_factor !== undefined ? Number(metadata.bodyweight_factor) : 0;
    const bw = num(userBodyWeightKg, DTS_CONFIG.defaultUserWeightKg);
    return Math.round((external + (bw * bwFactor)) * 100) / 100;
  }

  // Calculate strength workload for a set
  function calculateSetWorkload(setValues, metadata, userBodyWeightKg) {
    const weightVal = setValues?.weight ?? setValues?.Weight ?? "";
    const repsVal = setValues?.reps ?? setValues?.Reps ?? "";
    const reps = num(repsVal, 0);
    if (reps <= 0) return { effectiveLoad: 0, reps: 0, setVolume: 0, epley1RM: 0, relativeIntensity: 0 };

    const effectiveLoad = calculateEffectiveLoad(weightVal, metadata, userBodyWeightKg);
    const setVolume = effectiveLoad * reps;
    const epley1RM = calculateEpley1RM(effectiveLoad, reps);
    const relativeIntensity = epley1RM > 0 ? Math.min(1.0, effectiveLoad / epley1RM) : 0;

    return {
      effectiveLoad,
      reps,
      setVolume,
      epley1RM,
      relativeIntensity
    };
  }

  // Calculate cardio workload for a single cardio session based on its type
  function calculateCardioSessionWorkload(cardioEntry) {
    const typeStr = (cardioEntry?.type || "other").toLowerCase();
    
    let category = "other";
    if (typeStr.includes("treadmill") || typeStr.includes("run") || typeStr.includes("walk")) {
      category = "treadmill";
    } else if (typeStr.includes("cycl") || typeStr.includes("bike")) {
      category = "cycling";
    }

    const meta = CARDIO_METADATA[category] || CARDIO_METADATA.other;
    const duration = num(cardioEntry?.duration, 0);
    
    if (duration <= 0) return { workload: 0, duration: 0, speed: 0, incline: 0, category };

    const rawWorkload = meta.formula(cardioEntry);
    const multiplier = DTS_CONFIG[meta.multiplierKey] || 1.0;
    const workload = Math.round(rawWorkload * multiplier * 100) / 100;

    return {
      workload,
      duration,
      speed: num(cardioEntry?.speed, 0),
      incline: num(cardioEntry?.incline, 0),
      gear: num(cardioEntry?.gear, 0),
      category
    };
  }

  // Calculate blended reference based on user's historical qualifying workouts (Section 9.2)
  function computeActiveReferences(historyWorkloads = [], calibrationRef = REFERENCE_CONFIG) {
    const validStrength = historyWorkloads.map(h => num(h.strengthWorkload)).filter(w => w > 0);
    const validCardio = historyWorkloads.map(h => num(h.cardioWorkload)).filter(w => w > 0);

    const qualifyingCount = Math.max(validStrength.length, validCardio.length);

    // Default 100% calibration reference if < 5 qualifying workouts
    if (qualifyingCount < DTS_CONFIG.minQualifyingWorkoutsForBlend) {
      return {
        strengthRef: calibrationRef.strengthReference,
        cardioRef: calibrationRef.cardioReference,
        blend: 0,
        qualifyingCount
      };
    }

    // Compute EWMA for personal baseline
    function computeEWMA(values, initialRef) {
      if (!values.length) return initialRef;
      let ewma = values[0] || initialRef;
      for (let i = 1; i < values.length; i++) {
        ewma = (DTS_CONFIG.ewmaAlpha * values[i]) + ((1 - DTS_CONFIG.ewmaAlpha) * ewma);
      }
      return ewma;
    }

    const personalStrength = computeEWMA(validStrength, calibrationRef.strengthReference);
    const personalCardio = computeEWMA(validCardio, calibrationRef.cardioReference);

    // Blending schedule
    let blend = 0;
    if (qualifyingCount < 10) {
      // 5 to 9 workouts: 20% to 50%
      blend = 0.20 + ((qualifyingCount - 5) / 4) * 0.30;
    } else if (qualifyingCount < DTS_CONFIG.fullPersonalWorkoutsThreshold) {
      // 10 to 29 workouts: 50% to 90%
      blend = 0.50 + ((qualifyingCount - 10) / 20) * 0.40;
    } else {
      // 30+ workouts: 90% personal baseline (10% calibration anchor for stability)
      blend = 0.90;
    }

    const strengthRef = Math.round(((1 - blend) * calibrationRef.strengthReference) + (blend * personalStrength));
    const cardioRef = Math.round(((1 - blend) * calibrationRef.cardioReference) + (blend * personalCardio));

    return {
      strengthRef: Math.max(1000, strengthRef),
      cardioRef: Math.max(20, cardioRef),
      blend,
      qualifyingCount
    };
  }

  // Calculate complete daily training score for a day's exercises and cardio
  function calculateDailyScore({
    exercises = [],
    cardio = [],
    userBodyWeightKg = DTS_CONFIG.defaultUserWeightKg,
    historyWorkloads = [],
    getExerciseMetaFn = null,
    calibrationRef = REFERENCE_CONFIG
  }) {
    const metaResolver = getExerciseMetaFn || (typeof window !== "undefined" && window.ExerciseMetadata?.get) || (name => ({
      scoring_multiplier: 1.0,
      bodyweight_factor: 0,
      enabled_for_scoring: true,
      intensity_method: "estimated_1rm"
    }));

    // 1. Process Resistance Exercises
    let totalWeightedStrengthVolume = 0;
    let totalRawVolume = 0;
    let totalSets = 0;
    let totalReps = 0;
    let intensitySum = 0;
    let intensitySets = 0;
    const exerciseBreakdowns = [];

    (exercises || []).forEach(ex => {
      const meta = metaResolver(ex.name || ex);
      if (meta.enabled_for_scoring === false) return;

      const multiplier = Number(meta.scoring_multiplier) || 1.0;
      let exVolume = 0;
      let exSets = 0;
      let exReps = 0;
      let exMax1RM = 0;

      const logs = ex.logs || [];
      logs.forEach(log => {
        // Skip explicitly non-completed sets if completed is defined and false
        if (log.completed === false && !Object.values(log.values || {}).some(v => String(v).trim())) return;

        const res = calculateSetWorkload(log.values, meta, userBodyWeightKg);
        if (res.reps > 0) {
          exVolume += res.setVolume;
          exSets += 1;
          exReps += res.reps;
          if (res.epley1RM > exMax1RM) exMax1RM = res.epley1RM;
          if (res.relativeIntensity > 0) {
            intensitySum += res.relativeIntensity;
            intensitySets += 1;
          }
        }
      });

      if (exSets > 0) {
        const weightedVolume = exVolume * multiplier;
        totalRawVolume += exVolume;
        totalWeightedStrengthVolume += weightedVolume;
        totalSets += exSets;
        totalReps += exReps;

        exerciseBreakdowns.push({
          name: ex.name,
          metadata: meta,
          sets: exSets,
          reps: exReps,
          rawVolume: Math.round(exVolume),
          weightedVolume: Math.round(weightedVolume),
          max1RM: exMax1RM
        });
      }
    });

    // 2. Process Cardio Sessions
    let totalCardioWorkload = 0;
    let totalCardioDuration = 0;
    let cardioSpeedSum = 0;
    let cardioInclineSum = 0;
    const cardioBreakdowns = [];
    const cardioAggregates = { treadmill: 0, cycling: 0, other: 0 };

    (cardio || []).forEach(c => {
      const cRes = calculateCardioSessionWorkload(c);
      if (cRes.duration > 0) {
        totalCardioWorkload += cRes.workload;
        totalCardioDuration += cRes.duration;
        cardioSpeedSum += cRes.speed * cRes.duration;
        cardioInclineSum += cRes.incline * cRes.duration;
        
        cardioAggregates[cRes.category] = (cardioAggregates[cRes.category] || 0) + cRes.workload;

        cardioBreakdowns.push({
          type: c.type || "Cardio",
          ...cRes
        });
      }
    });

    const avgCardioSpeed = totalCardioDuration > 0 ? Math.round((cardioSpeedSum / totalCardioDuration) * 10) / 10 : 0;
    const avgCardioIncline = totalCardioDuration > 0 ? Math.round((cardioInclineSum / totalCardioDuration) * 10) / 10 : 0;
    const avgIntensity = intensitySets > 0 ? Math.round((intensitySum / intensitySets) * 100) / 100 : 0;

    // 3. Check for Rest Day (Section 14: if no workout, DTS = 0)
    if (totalSets === 0 && totalCardioDuration === 0) {
      return {
        dts: 0,
        band: "No Training",
        strengthComponent: 0,
        cardioComponent: 0,
        cardioContribution: 0,
        strengthWorkload: 0,
        activeStrengthReference: calibrationRef.strengthReference,
        strengthNormalized: 0,
        cardioWorkload: 0,
        activeCardioReference: calibrationRef.cardioReference,
        cardioNormalized: 0,
        strengthDetails: { totalSets: 0, totalReps: 0, effectiveVolume: 0, avgIntensity: 0, exercises: [] },
        cardioDetails: { 
          totalDuration: 0, 
          avgSpeed: 0, 
          avgIncline: 0, 
          aggregates: { treadmill: 0, cycling: 0, other: 0 },
          sessions: [] 
        },
        scoringVersion: calibrationRef.scoringVersion,
        referenceVersion: calibrationRef.referenceVersion,
        strengthReferenceUsed: calibrationRef.strengthReference,
        cardioReferenceUsed: calibrationRef.cardioReference
      };
    }

    // 4. Resolve Active Reference & Normalization
    const activeRefs = computeActiveReferences(historyWorkloads, calibrationRef);
    const activeStrengthRef = activeRefs.strengthRef;
    const activeCardioRef = activeRefs.cardioRef;

    // Normalization with upper bounds
    const strengthNormalized = totalWeightedStrengthVolume > 0
      ? Math.min(totalWeightedStrengthVolume / activeStrengthRef, calibrationRef.upperBoundStrengthNormalized)
      : 0;

    const cardioNormalized = totalCardioWorkload > 0
      ? Math.min(totalCardioWorkload / activeCardioRef, calibrationRef.upperBoundCardioNormalized)
      : 0;

    // 5. Sigmoid Normalization (Section 12)
    // If workload is 0, component is 0
    const strengthComponent = totalWeightedStrengthVolume > 0
      ? sigmoid(calibrationRef.k_strength * (strengthNormalized - 1))
      : 0;

    const cardioComponent = totalCardioWorkload > 0
      ? sigmoid(calibrationRef.k_cardio * (cardioNormalized - 1))
      : 0;

    // 6. Final DTS Calculation (Section 13)
    // FinalScore = 100 * (StrengthComponent + 0.25 * CardioComponent) / 1.25
    const finalRaw = 100 * ((strengthComponent + (DTS_CONFIG.cardioWeight * cardioComponent)) / (1 + DTS_CONFIG.cardioWeight));
    const dts = Math.max(0, Math.min(100, Math.round(finalRaw)));

    // Explainable contributions
    const strengthContributionScore = Math.round(100 * (strengthComponent / (1 + DTS_CONFIG.cardioWeight)));
    const cardioContributionScore = Math.max(0, dts - strengthContributionScore);

    // Score Semantics / Magnitude Band (Section 13.1 & 16)
    let band = "Very Low";
    if (dts === 0) band = "No Training";
    else if (dts < 20) band = "Very Low";
    else if (dts < 40) band = "Low";
    else if (dts < 60) band = "Moderate";
    else if (dts < 80) band = "High";
    else band = "Very High";

    return {
      dts,
      band,
      strengthComponent: strengthContributionScore,
      cardioComponent: Math.round(cardioComponent * 100) / 100,
      cardioContribution: cardioContributionScore,
      strengthWorkload: Math.round(totalWeightedStrengthVolume),
      activeStrengthReference: activeStrengthRef,
      strengthNormalized: Math.round(strengthNormalized * 100) / 100,
      cardioWorkload: Math.round(totalCardioWorkload),
      activeCardioReference: activeCardioRef,
      cardioNormalized: Math.round(cardioNormalized * 100) / 100,
      strengthDetails: {
        totalSets,
        totalReps,
        effectiveVolume: Math.round(totalRawVolume),
        avgIntensity,
        exercises: exerciseBreakdowns
      },
      cardioDetails: {
        totalDuration: Math.round(totalCardioDuration),
        avgSpeed: avgCardioSpeed,
        avgIncline: avgCardioIncline,
        aggregates: {
          treadmill: Math.round(cardioAggregates.treadmill * 10) / 10,
          cycling: Math.round(cardioAggregates.cycling * 10) / 10,
          other: Math.round(cardioAggregates.other * 10) / 10
        },
        sessions: cardioBreakdowns
      },
      scoringVersion: calibrationRef.scoringVersion,
      referenceVersion: calibrationRef.referenceVersion,
      strengthReferenceUsed: activeStrengthRef,
      cardioReferenceUsed: activeCardioRef
    };
  }

  // Expose global API in browser
  if (typeof window !== "undefined") {
    window.DTS = {
      REFERENCE_CONFIG,
      DTS_CONFIG,
      CARDIO_METADATA,
      sigmoid,
      calculateEpley1RM,
      calculateEffectiveLoad,
      calculateSetWorkload,
      calculateCardioSessionWorkload,
      computeActiveReferences,
      calculateDailyScore
    };
  }

  // Node.js module export for testing
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      REFERENCE_CONFIG,
      DTS_CONFIG,
      CARDIO_METADATA,
      sigmoid,
      calculateEpley1RM,
      calculateEffectiveLoad,
      calculateSetWorkload,
      calculateCardioSessionWorkload,
      computeActiveReferences,
      calculateDailyScore
    };
  }
})();
