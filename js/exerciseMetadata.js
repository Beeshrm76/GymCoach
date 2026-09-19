// js/exerciseMetadata.js — Exercise scoring metadata and rule-based auto-classification.
// Provides metadata, classification rules, and manual overrides for all ~227 exercises.

(function () {
  const STORAGE_KEY = "gymcoach_exercise_scoring_overrides_v1";

  // Movement patterns
  const PATTERNS = {
    SQUAT: "squat",
    HINGE: "hinge",
    HORIZONTAL_PUSH: "horizontal_push",
    HORIZONTAL_PULL: "horizontal_pull",
    VERTICAL_PUSH: "vertical_push",
    VERTICAL_PULL: "vertical_pull",
    LUNGE: "lunge",
    CARRY: "carry",
    ROTATION: "rotation",
    FLEXION: "flexion",
    EXTENSION: "extension",
    ISOLATION: "isolation",
    LOCOMOTION: "locomotion",
    STATIC: "static",
    OTHER: "other"
  };

  // Exercise types
  const TYPES = {
    COMPOUND: "compound",
    ISOLATION: "isolation",
    BODYWEIGHT: "bodyweight",
    CARDIO: "cardio",
    MOBILITY: "mobility",
    STRETCHING: "stretching",
    PLYOMETRIC: "plyometric",
    CORE: "core",
    OTHER: "other"
  };

  // Load types
  const LOAD_TYPES = {
    EXTERNAL: "external",
    BODYWEIGHT: "bodyweight",
    BODYWEIGHT_PLUS_EXTERNAL: "bodyweight_plus_external",
    NONE: "none"
  };

  // Intensity methods
  const INTENSITY_METHODS = {
    ESTIMATED_1RM: "estimated_1rm",
    RELATIVE_LOAD: "relative_load",
    BODYWEIGHT_VOLUME: "bodyweight_volume",
    VOLUME_ONLY: "volume_only",
    DURATION_BASED: "duration_based",
    NONE: "none"
  };

  // Default multipliers by exercise type
  const TYPE_MULTIPLIERS = {
    compound: 1.0,
    isolation: 0.7,
    bodyweight: 0.85,
    core: 0.6,
    plyometric: 0.8,
    cardio: 1.0,
    mobility: 0.2,
    stretching: 0.2,
    other: 0.5
  };

  // Default bodyweight factors for known bodyweight movement classes
  const KNOWN_BW_FACTORS = {
    pullup: 1.00,
    chinup: 1.00,
    dip: 0.90,
    pushup: 0.65,
    bodyweightsquat: 0.70,
    invertedrow: 0.60,
    hanginglegraise: 0.50,
    kneeraise: 0.50,
    crunch: 0.35,
    plank: 0.00
  };

  // In-memory overrides cache
  let overridesCache = null;

  function loadOverrides() {
    if (overridesCache !== null) return overridesCache;
    try {
      if (typeof localStorage !== "undefined") {
        overridesCache = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {};
      } else {
        overridesCache = {};
      }
    } catch {
      overridesCache = {};
    }
    return overridesCache;
  }

  function saveOverrides(overrides) {
    overridesCache = overrides || {};
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(overridesCache));
      }
    } catch (e) {
      console.warn("Could not save scoring overrides to localStorage:", e);
    }
  }

  // Generate canonical slug ID from exercise name
  function slugify(name) {
    return String(name || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  // Deterministic rule-based classifier
  function classifyExercise(name, aliases = []) {
    const text = [name, ...(aliases || [])].join(" ").toLowerCase();

    let exercise_type = TYPES.OTHER;
    let movement_pattern = PATTERNS.OTHER;
    let load_type = LOAD_TYPES.EXTERNAL;
    let bodyweight_factor = 0.0;
    let scoring_multiplier = 1.0;
    let intensity_method = INTENSITY_METHODS.ESTIMATED_1RM;
    let muscle_group = "general";
    let equipment_type = "free_weight";
    let manual_review_required = false;

    // 1. Cardio check
    if (/(treadmill|running|cycling|bike|elliptical|rower|rowing machine|stairmaster|jump rope|cardio|walk)/i.test(text)) {
      exercise_type = TYPES.CARDIO;
      movement_pattern = PATTERNS.LOCOMOTION;
      load_type = LOAD_TYPES.NONE;
      bodyweight_factor = 0.0;
      scoring_multiplier = 1.0;
      intensity_method = INTENSITY_METHODS.DURATION_BASED;
      equipment_type = "cardio_machine";
      muscle_group = "cardio";
      return {
        exercise_type, movement_pattern, load_type, bodyweight_factor,
        scoring_multiplier, intensity_method, muscle_group, equipment_type,
        manual_review_required: false
      };
    }

    // 2. Mobility & Stretching
    if (/(stretch|mobility|foam roll|massage|band dislocate|yoga)/i.test(text)) {
      exercise_type = TYPES.STRETCHING;
      movement_pattern = PATTERNS.STATIC;
      load_type = LOAD_TYPES.NONE;
      bodyweight_factor = 0.0;
      scoring_multiplier = TYPE_MULTIPLIERS.stretching;
      intensity_method = INTENSITY_METHODS.NONE;
      equipment_type = "bodyweight";
      muscle_group = "full_body";
      return {
        exercise_type, movement_pattern, load_type, bodyweight_factor,
        scoring_multiplier, intensity_method, muscle_group, equipment_type,
        manual_review_required: false
      };
    }

    // 3. Bodyweight vs External movements
    const isWeightedPrefix = /weighted/i.test(text);

    if (/\bpull[- ]?ups?\b|\bchin[- ]?ups?\b/i.test(text)) {
      exercise_type = TYPES.BODYWEIGHT;
      movement_pattern = PATTERNS.VERTICAL_PULL;
      load_type = isWeightedPrefix ? LOAD_TYPES.BODYWEIGHT_PLUS_EXTERNAL : LOAD_TYPES.BODYWEIGHT;
      bodyweight_factor = KNOWN_BW_FACTORS.pullup;
      muscle_group = "back";
      equipment_type = "bodyweight_bar";
      intensity_method = INTENSITY_METHODS.ESTIMATED_1RM;
    } else if (/\bdips?\b/i.test(text) && !/machine dip/i.test(text)) {
      exercise_type = TYPES.BODYWEIGHT;
      movement_pattern = PATTERNS.VERTICAL_PUSH;
      load_type = isWeightedPrefix ? LOAD_TYPES.BODYWEIGHT_PLUS_EXTERNAL : LOAD_TYPES.BODYWEIGHT;
      bodyweight_factor = KNOWN_BW_FACTORS.dip;
      muscle_group = "chest";
      equipment_type = "parallel_bars";
      intensity_method = INTENSITY_METHODS.ESTIMATED_1RM;
    } else if (/\bpush[- ]?ups?\b/i.test(text)) {
      exercise_type = TYPES.BODYWEIGHT;
      movement_pattern = PATTERNS.HORIZONTAL_PUSH;
      load_type = isWeightedPrefix ? LOAD_TYPES.BODYWEIGHT_PLUS_EXTERNAL : LOAD_TYPES.BODYWEIGHT;
      bodyweight_factor = KNOWN_BW_FACTORS.pushup;
      muscle_group = "chest";
      equipment_type = "bodyweight";
      intensity_method = INTENSITY_METHODS.BODYWEIGHT_VOLUME;
    } else if (/inverted row|bodyweight row|australian pull up/i.test(text)) {
      exercise_type = TYPES.BODYWEIGHT;
      movement_pattern = PATTERNS.HORIZONTAL_PULL;
      load_type = LOAD_TYPES.BODYWEIGHT;
      bodyweight_factor = KNOWN_BW_FACTORS.invertedrow;
      muscle_group = "back";
      equipment_type = "bar";
      intensity_method = INTENSITY_METHODS.BODYWEIGHT_VOLUME;
    } else if (/hanging (knee|leg) raise|captain'?s chair/i.test(text)) {
      exercise_type = TYPES.CORE;
      movement_pattern = PATTERNS.FLEXION;
      load_type = LOAD_TYPES.BODYWEIGHT;
      bodyweight_factor = KNOWN_BW_FACTORS.hanginglegraise;
      muscle_group = "core";
      equipment_type = "bodyweight";
      intensity_method = INTENSITY_METHODS.BODYWEIGHT_VOLUME;
    } else if (/\bplank\b|ab wheel|dead bug|hollow body/i.test(text)) {
      exercise_type = TYPES.CORE;
      movement_pattern = PATTERNS.STATIC;
      load_type = LOAD_TYPES.NONE;
      bodyweight_factor = 0.0;
      muscle_group = "core";
      equipment_type = "bodyweight";
      intensity_method = INTENSITY_METHODS.DURATION_BASED;
    } else if (/crunch|sit[- ]?up|russian twist/i.test(text)) {
      exercise_type = TYPES.CORE;
      movement_pattern = PATTERNS.FLEXION;
      load_type = isWeightedPrefix ? LOAD_TYPES.BODYWEIGHT_PLUS_EXTERNAL : LOAD_TYPES.BODYWEIGHT;
      bodyweight_factor = KNOWN_BW_FACTORS.crunch;
      muscle_group = "core";
      equipment_type = "bodyweight";
      intensity_method = INTENSITY_METHODS.BODYWEIGHT_VOLUME;
    } else if (/lunge|split squat|step[- ]?up/i.test(text)) {
      exercise_type = TYPES.COMPOUND;
      movement_pattern = PATTERNS.LUNGE;
      load_type = /bodyweight/i.test(text) ? LOAD_TYPES.BODYWEIGHT : LOAD_TYPES.EXTERNAL;
      bodyweight_factor = /bodyweight/i.test(text) ? 0.50 : 0.0;
      muscle_group = "quads";
      intensity_method = INTENSITY_METHODS.ESTIMATED_1RM;
    } else if (/\bsquat\b/i.test(text)) {
      movement_pattern = PATTERNS.SQUAT;
      muscle_group = "quads";
      if (/bodyweight squat|air squat/i.test(text)) {
        exercise_type = TYPES.BODYWEIGHT;
        load_type = LOAD_TYPES.BODYWEIGHT;
        bodyweight_factor = KNOWN_BW_FACTORS.bodyweightsquat;
        intensity_method = INTENSITY_METHODS.BODYWEIGHT_VOLUME;
      } else {
        exercise_type = TYPES.COMPOUND;
        load_type = LOAD_TYPES.EXTERNAL;
        intensity_method = INTENSITY_METHODS.ESTIMATED_1RM;
        equipment_type = /barbell/i.test(text) ? "barbell" : /dumbbell/i.test(text) ? "dumbbell" : "machine";
      }
    } else if (/deadlift|rdl|romanian deadlift|good morning/i.test(text)) {
      exercise_type = TYPES.COMPOUND;
      movement_pattern = PATTERNS.HINGE;
      load_type = LOAD_TYPES.EXTERNAL;
      muscle_group = "hamstrings";
      equipment_type = /dumbbell/i.test(text) ? "dumbbell" : "barbell";
      intensity_method = INTENSITY_METHODS.ESTIMATED_1RM;
    } else if (/bench press|chest press|floor press/i.test(text)) {
      exercise_type = TYPES.COMPOUND;
      movement_pattern = PATTERNS.HORIZONTAL_PUSH;
      load_type = LOAD_TYPES.EXTERNAL;
      muscle_group = "chest";
      equipment_type = /dumbbell/i.test(text) ? "dumbbell" : /machine/i.test(text) ? "machine" : "barbell";
      intensity_method = INTENSITY_METHODS.ESTIMATED_1RM;
    } else if (/overhead press|shoulder press|military press|arnold press|push press/i.test(text)) {
      exercise_type = TYPES.COMPOUND;
      movement_pattern = PATTERNS.VERTICAL_PUSH;
      load_type = LOAD_TYPES.EXTERNAL;
      muscle_group = "shoulders";
      equipment_type = /dumbbell/i.test(text) ? "dumbbell" : "barbell";
      intensity_method = INTENSITY_METHODS.ESTIMATED_1RM;
    } else if (/lat pulldown|cable pulldown/i.test(text)) {
      exercise_type = TYPES.COMPOUND;
      movement_pattern = PATTERNS.VERTICAL_PULL;
      load_type = LOAD_TYPES.EXTERNAL;
      muscle_group = "back";
      equipment_type = "cable";
      intensity_method = INTENSITY_METHODS.ESTIMATED_1RM;
    } else if (/\brow\b/i.test(text)) {
      exercise_type = TYPES.COMPOUND;
      movement_pattern = PATTERNS.HORIZONTAL_PULL;
      load_type = LOAD_TYPES.EXTERNAL;
      muscle_group = "back";
      equipment_type = /cable/i.test(text) ? "cable" : /dumbbell/i.test(text) ? "dumbbell" : "barbell";
      intensity_method = INTENSITY_METHODS.ESTIMATED_1RM;
    } else if (/pec fly|chest fly|cable crossover|butterfly/i.test(text)) {
      exercise_type = TYPES.ISOLATION;
      movement_pattern = PATTERNS.ISOLATION;
      load_type = LOAD_TYPES.EXTERNAL;
      muscle_group = "chest";
      equipment_type = /cable/i.test(text) ? "cable" : "dumbbell";
      intensity_method = INTENSITY_METHODS.ESTIMATED_1RM;
    } else if (/lateral raise|front raise|rear delt fly|face pull/i.test(text)) {
      exercise_type = TYPES.ISOLATION;
      movement_pattern = PATTERNS.ISOLATION;
      load_type = LOAD_TYPES.EXTERNAL;
      muscle_group = "shoulders";
      equipment_type = /cable/i.test(text) ? "cable" : "dumbbell";
      intensity_method = INTENSITY_METHODS.ESTIMATED_1RM;
    } else if (/bicep curl|hammer curl|preacher curl|spider curl/i.test(text)) {
      exercise_type = TYPES.ISOLATION;
      movement_pattern = PATTERNS.ISOLATION;
      load_type = LOAD_TYPES.EXTERNAL;
      muscle_group = "biceps";
      equipment_type = /cable/i.test(text) ? "cable" : /barbell/i.test(text) ? "barbell" : "dumbbell";
      intensity_method = INTENSITY_METHODS.ESTIMATED_1RM;
    } else if (/tricep extension|skull crusher|pushdown|kickback/i.test(text)) {
      exercise_type = TYPES.ISOLATION;
      movement_pattern = PATTERNS.ISOLATION;
      load_type = LOAD_TYPES.EXTERNAL;
      muscle_group = "triceps";
      equipment_type = /cable/i.test(text) ? "cable" : "dumbbell";
      intensity_method = INTENSITY_METHODS.ESTIMATED_1RM;
    } else if (/leg extension/i.test(text)) {
      exercise_type = TYPES.ISOLATION;
      movement_pattern = PATTERNS.EXTENSION;
      load_type = LOAD_TYPES.EXTERNAL;
      muscle_group = "quads";
      equipment_type = "machine";
      intensity_method = INTENSITY_METHODS.ESTIMATED_1RM;
    } else if (/leg curl|hamstring curl/i.test(text)) {
      exercise_type = TYPES.ISOLATION;
      movement_pattern = PATTERNS.FLEXION;
      load_type = LOAD_TYPES.EXTERNAL;
      muscle_group = "hamstrings";
      equipment_type = "machine";
      intensity_method = INTENSITY_METHODS.ESTIMATED_1RM;
    } else if (/calf raise/i.test(text)) {
      exercise_type = TYPES.ISOLATION;
      movement_pattern = PATTERNS.EXTENSION;
      load_type = /bodyweight/i.test(text) ? LOAD_TYPES.BODYWEIGHT : LOAD_TYPES.EXTERNAL;
      bodyweight_factor = /bodyweight/i.test(text) ? 1.0 : 0.0;
      muscle_group = "calves";
      equipment_type = "machine";
      intensity_method = INTENSITY_METHODS.ESTIMATED_1RM;
    } else if (/hip thrust|glute bridge/i.test(text)) {
      exercise_type = TYPES.COMPOUND;
      movement_pattern = PATTERNS.HINGE;
      load_type = /bodyweight/i.test(text) ? LOAD_TYPES.BODYWEIGHT : LOAD_TYPES.EXTERNAL;
      bodyweight_factor = /bodyweight/i.test(text) ? 0.60 : 0.0;
      muscle_group = "glutes";
      equipment_type = "barbell";
      intensity_method = INTENSITY_METHODS.ESTIMATED_1RM;
    } else if (/shrug/i.test(text)) {
      exercise_type = TYPES.ISOLATION;
      movement_pattern = PATTERNS.ISOLATION;
      load_type = LOAD_TYPES.EXTERNAL;
      muscle_group = "traps";
      equipment_type = "dumbbell";
      intensity_method = INTENSITY_METHODS.ESTIMATED_1RM;
    } else {
      // Fallback: If not confidently classified, mark other and flag review
      exercise_type = TYPES.OTHER;
      movement_pattern = PATTERNS.OTHER;
      load_type = LOAD_TYPES.EXTERNAL;
      bodyweight_factor = 0.0;
      scoring_multiplier = TYPE_MULTIPLIERS.other;
      intensity_method = INTENSITY_METHODS.VOLUME_ONLY;
      manual_review_required = true;
    }

    // Multiplier lookup based on assigned type
    scoring_multiplier = TYPE_MULTIPLIERS[exercise_type] || 1.0;

    return {
      exercise_type,
      movement_pattern,
      muscle_group,
      equipment_type,
      load_type,
      bodyweight_factor,
      scoring_multiplier,
      intensity_method,
      manual_review_required
    };
  }

  // Get effective metadata for an exercise (auto-classified with manual overrides applied)
  function getMetadata(exerciseOrName) {
    const name = typeof exerciseOrName === "string" ? exerciseOrName : exerciseOrName?.name || "";
    const aliases = typeof exerciseOrName === "object" ? exerciseOrName.aliases : [];
    const exercise_id = slugify(name);

    // Check manual override
    const overrides = loadOverrides();
    const manual = overrides[exercise_id] || null;

    // Automatic classification
    const auto = classifyExercise(name, aliases);

    if (manual && manual.manually_overridden) {
      return {
        exercise_id,
        exercise_name: name,
        exercise_type: manual.exercise_type || auto.exercise_type,
        movement_pattern: manual.movement_pattern || auto.movement_pattern,
        muscle_group: manual.muscle_group || auto.muscle_group,
        equipment_type: manual.equipment_type || auto.equipment_type,
        load_type: manual.load_type || auto.load_type,
        bodyweight_factor: manual.bodyweight_factor !== undefined ? Number(manual.bodyweight_factor) : auto.bodyweight_factor,
        scoring_multiplier: manual.scoring_multiplier !== undefined ? Number(manual.scoring_multiplier) : auto.scoring_multiplier,
        intensity_method: manual.intensity_method || auto.intensity_method,
        enabled_for_scoring: manual.enabled_for_scoring !== false,
        manually_overridden: true,
        source: "MANUAL"
      };
    }

    return {
      exercise_id,
      exercise_name: name,
      ...auto,
      enabled_for_scoring: true,
      manually_overridden: false,
      source: "AUTO"
    };
  }

  // Set manual override for an exercise
  function setOverride(exercise_id, params) {
    const overrides = loadOverrides();
    overrides[exercise_id] = {
      ...(overrides[exercise_id] || {}),
      ...params,
      manually_overridden: true,
      updated_at: new Date().toISOString()
    };
    saveOverrides(overrides);
    return overrides[exercise_id];
  }

  // Remove manual override (revert to AUTO)
  function removeOverride(exercise_id) {
    const overrides = loadOverrides();
    if (overrides[exercise_id]) {
      delete overrides[exercise_id];
      saveOverrides(overrides);
    }
  }

  // Get all exercises from EXERCISE_DB decorated with metadata and status
  function getAllWithMetadata(exerciseDb = window.EXERCISE_DB || []) {
    return (exerciseDb || []).map(ex => {
      const meta = getMetadata(ex);
      return {
        name: ex.name,
        aliases: ex.aliases || [],
        ...meta
      };
    });
  }

  // Cloud sync helper (Supabase system_settings)
  async function syncFromCloud(supabase) {
    const sb = supabase || window.supabaseClient;
    if (!sb) return;
    try {
      const { data, error } = await sb.from("system_settings").select("*").eq("key", "exercise_scoring_overrides").single();
      if (!error && data && data.value && typeof data.value === "object") {
        const local = loadOverrides();
        const merged = { ...local, ...data.value };
        saveOverrides(merged);
      }
    } catch {
      // Offline fallback
    }
  }

  async function syncToCloud(supabase) {
    const sb = supabase || window.supabaseClient;
    if (!sb) return;
    try {
      const overrides = loadOverrides();
      await sb.from("system_settings").upsert({
        key: "exercise_scoring_overrides",
        value: overrides,
        updated_at: new Date().toISOString()
      }, { onConflict: "key" });
    } catch (err) {
      console.warn("Could not sync overrides to cloud:", err);
    }
  }

  // Expose global API in browser
  if (typeof window !== "undefined") {
    window.ExerciseMetadata = {
    TYPES,
    PATTERNS,
    LOAD_TYPES,
    INTENSITY_METHODS,
    TYPE_MULTIPLIERS,
    KNOWN_BW_FACTORS,
    slugify,
    classify: classifyExercise,
    get: getMetadata,
    setOverride,
    removeOverride,
    getAll: getAllWithMetadata,
    loadOverrides,
    syncFromCloud,
    syncToCloud
  };
  }

  // Node.js module export for testing
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      TYPES,
      PATTERNS,
      LOAD_TYPES,
      INTENSITY_METHODS,
      TYPE_MULTIPLIERS,
      KNOWN_BW_FACTORS,
      slugify,
      classifyExercise,
      getMetadata,
      setOverride,
      removeOverride,
      getAllWithMetadata
    };
  }
})();
