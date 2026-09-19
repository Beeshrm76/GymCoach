// tests/dts_test.js — Automated test suite for DTS and Exercise Metadata
// Tests all 14 mandatory scenarios from user specifications + calibration reference progression.

const assert = require("assert");
const DTS = require("../js/dts.js");
const Metadata = require("../js/exerciseMetadata.js");

console.log("==================================================");
console.log("RUNNING WORKOUT TRAINING SCORE (DTS) TEST SUITE");
console.log("==================================================\n");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`❌ [FAIL] ${name}`);
    console.error(err);
    failed++;
  }
}

// ---------------------------------------------------------------------
// TEST 1: Heavy resistance workout, no cardio -> High DTS
// ---------------------------------------------------------------------
test("TEST 1: Heavy resistance workout, no cardio produces High DTS", () => {
  // Heavy workout: Bench Press, Squats, Deadlifts with high volume (18,000 kg weighted volume)
  const exercises = [
    {
      name: "Flat Barbell Bench Press",
      logs: [
        { completed: true, values: { weight: 100, reps: 10 } },
        { completed: true, values: { weight: 100, reps: 10 } },
        { completed: true, values: { weight: 100, reps: 10 } },
        { completed: true, values: { weight: 100, reps: 10 } }
      ]
    },
    {
      name: "Barbell Squat",
      logs: [
        { completed: true, values: { weight: 140, reps: 10 } },
        { completed: true, values: { weight: 140, reps: 10 } },
        { completed: true, values: { weight: 140, reps: 10 } },
        { completed: true, values: { weight: 140, reps: 10 } }
      ]
    },
    {
      name: "Barbell Deadlift",
      logs: [
        { completed: true, values: { weight: 160, reps: 10 } },
        { completed: true, values: { weight: 160, reps: 10 } },
        { completed: true, values: { weight: 160, reps: 10 } },
        { completed: true, values: { weight: 160, reps: 10 } }
      ]
    }
  ];

  const res = DTS.calculateDailyScore({
    exercises,
    cardio: [],
    userBodyWeightKg: 80,
    getExerciseMetaFn: Metadata.getMetadata
  });

  assert(res.dts >= 60, `DTS should be High (>=60), got ${res.dts}`);
  assert.strictEqual(res.cardioWorkload, 0);
  assert.strictEqual(res.cardioContribution, 0);
  console.log(`       Result: DTS = ${res.dts}, Band = ${res.band}, StrengthVolume = ${res.strengthWorkload} kg`);
});

// ---------------------------------------------------------------------
// TEST 2: Moderate resistance workout + moderate cardio -> Higher DTS than moderate resistance alone
// ---------------------------------------------------------------------
test("TEST 2: Moderate resistance + moderate cardio produces higher DTS than resistance alone", () => {
  const moderateExercises = [
    {
      name: "Flat Barbell Bench Press",
      logs: [
        { completed: true, values: { weight: 70, reps: 10 } },
        { completed: true, values: { weight: 70, reps: 10 } },
        { completed: true, values: { weight: 70, reps: 10 } }
      ]
    },
    {
      name: "Lat Pulldown",
      logs: [
        { completed: true, values: { weight: 60, reps: 10 } },
        { completed: true, values: { weight: 60, reps: 10 } },
        { completed: true, values: { weight: 60, reps: 10 } }
      ]
    }
  ];

  const cardio = [
    { type: "Treadmill", duration: 25, speed: 6.0, incline: 2 }
  ];

  const resAlone = DTS.calculateDailyScore({
    exercises: moderateExercises,
    cardio: [],
    userBodyWeightKg: 75,
    getExerciseMetaFn: Metadata.getMetadata
  });

  const resWithCardio = DTS.calculateDailyScore({
    exercises: moderateExercises,
    cardio,
    userBodyWeightKg: 75,
    getExerciseMetaFn: Metadata.getMetadata
  });

  assert(resWithCardio.dts > resAlone.dts, `DTS with cardio (${resWithCardio.dts}) must exceed without cardio (${resAlone.dts})`);
  assert(resWithCardio.cardioContribution > 0, "Cardio contribution must be > 0");
  console.log(`       Result: Moderate alone = ${resAlone.dts}, Moderate + Cardio = ${resWithCardio.dts} (+${resWithCardio.cardioContribution})`);
});

// ---------------------------------------------------------------------
// TEST 3: Cardio-only workout -> Meaningful non-zero score, does not overpower resistance
// ---------------------------------------------------------------------
test("TEST 3: Cardio-only workout produces non-zero DTS, bounded under resistance-heavy score", () => {
  const cardio = [
    { type: "Running", duration: 40, speed: 8.0, incline: 1 }
  ];

  const resCardioOnly = DTS.calculateDailyScore({
    exercises: [],
    cardio,
    userBodyWeightKg: 75,
    getExerciseMetaFn: Metadata.getMetadata
  });

  // Reference strength workout alone
  const refStrength = [
    {
      name: "Flat Barbell Bench Press",
      logs: [
        { completed: true, values: { weight: 80, reps: 10 } },
        { completed: true, values: { weight: 80, reps: 10 } },
        { completed: true, values: { weight: 80, reps: 10 } }
      ]
    },
    {
      name: "Barbell Squat",
      logs: [
        { completed: true, values: { weight: 100, reps: 10 } },
        { completed: true, values: { weight: 100, reps: 10 } },
        { completed: true, values: { weight: 100, reps: 10 } }
      ]
    }
  ];
  const resStrength = DTS.calculateDailyScore({
    exercises: refStrength,
    cardio: [],
    userBodyWeightKg: 75,
    getExerciseMetaFn: Metadata.getMetadata
  });

  assert(resCardioOnly.dts > 0, "Cardio only must have DTS > 0");
  assert(resCardioOnly.dts <= 25, `Cardio only max contribution is bounded (got ${resCardioOnly.dts})`);
  assert(resCardioOnly.dts < resStrength.dts, `Cardio only (${resCardioOnly.dts}) must not overpower strength (${resStrength.dts})`);
  console.log(`       Result: Cardio-only = ${resCardioOnly.dts}, Moderate Strength = ${resStrength.dts}`);
});

// ---------------------------------------------------------------------
// TEST 4: No workout -> DTS = 0
// ---------------------------------------------------------------------
test("TEST 4: No workout produces DTS = 0", () => {
  const res = DTS.calculateDailyScore({
    exercises: [],
    cardio: [],
    userBodyWeightKg: 75,
    getExerciseMetaFn: Metadata.getMetadata
  });

  assert.strictEqual(res.dts, 0, "Rest day DTS must be exactly 0");
  assert.strictEqual(res.band, "No Training");
  assert.strictEqual(res.strengthWorkload, 0);
  assert.strictEqual(res.cardioWorkload, 0);
});

// ---------------------------------------------------------------------
// TEST 5: Bodyweight pull-ups -> User body weight contributes
// ---------------------------------------------------------------------
test("TEST 5: Bodyweight pull-ups includes user body weight in effective load", () => {
  const meta = Metadata.getMetadata("Pull-Ups");
  assert.strictEqual(meta.load_type, "bodyweight");
  assert.strictEqual(meta.bodyweight_factor, 1.0);

  const load70 = DTS.calculateEffectiveLoad(0, meta, 70);
  const load90 = DTS.calculateEffectiveLoad(0, meta, 90);

  assert.strictEqual(load70, 70, "70kg user effective load should be 70kg");
  assert.strictEqual(load90, 90, "90kg user effective load should be 90kg");
});

// ---------------------------------------------------------------------
// TEST 6: Push-ups -> Bodyweight factor applied
// ---------------------------------------------------------------------
test("TEST 6: Push-ups applies 0.65 bodyweight factor", () => {
  const meta = Metadata.getMetadata("Push-Ups");
  assert.strictEqual(meta.bodyweight_factor, 0.65);

  const effectiveLoad = DTS.calculateEffectiveLoad(0, meta, 100);
  assert.strictEqual(effectiveLoad, 65, "100kg user doing push-up should have 65kg effective load");
});

// ---------------------------------------------------------------------
// TEST 7: Weighted pull-ups -> Bodyweight + external weight combined
// ---------------------------------------------------------------------
test("TEST 7: Weighted pull-ups combines bodyweight + external load correctly", () => {
  const meta = Metadata.getMetadata("Pull-Ups");
  const effectiveLoad = DTS.calculateEffectiveLoad(20, meta, 80); // 80kg body + 20kg belt
  assert.strictEqual(effectiveLoad, 100, "80kg BW + 20kg external should equal 100kg effective load");
});

// ---------------------------------------------------------------------
// TEST 8: Multiple workouts in one day -> Aggregated correctly
// ---------------------------------------------------------------------
test("TEST 8: Multiple workouts in one day are aggregated into single score", () => {
  // Morning workout: Bench Press + Cardio
  // Evening workout: Pull-Ups + Incline Walk
  const allExercises = [
    {
      name: "Flat Barbell Bench Press",
      logs: [{ completed: true, values: { weight: 80, reps: 10 } }]
    },
    {
      name: "Pull-Ups",
      logs: [{ completed: true, values: { weight: 0, reps: 10 } }]
    }
  ];
  const allCardio = [
    { type: "Treadmill Run", duration: 15, speed: 8.0, incline: 0 },
    { type: "Incline Walk", duration: 15, speed: 5.0, incline: 4 }
  ];

  const res = DTS.calculateDailyScore({
    exercises: allExercises,
    cardio: allCardio,
    userBodyWeightKg: 80,
    getExerciseMetaFn: Metadata.getMetadata
  });

  assert.strictEqual(res.strengthDetails.totalSets, 2);
  assert.strictEqual(res.cardioDetails.sessions.length, 2);
  assert.strictEqual(res.cardioDetails.totalDuration, 30);
  assert(res.dts > 0, "Aggregated score must be > 0");
});

// ---------------------------------------------------------------------
// TEST 9: New exercise added to database -> Automatic metadata assignment
// ---------------------------------------------------------------------
test("TEST 9: New exercise added receives automatic rule-based classification", () => {
  const newEx = Metadata.getMetadata("Kettlebell Bulgarian Split Squat");
  assert.strictEqual(newEx.movement_pattern, "lunge");
  assert.strictEqual(newEx.exercise_type, "compound");
  assert.strictEqual(newEx.scoring_multiplier, 1.0);
  assert.strictEqual(newEx.source, "AUTO");

  const unknownEx = Metadata.getMetadata("Mysterious Futuristic Movement 3000");
  assert.strictEqual(unknownEx.exercise_type, "other");
  assert.strictEqual(unknownEx.manual_review_required, true);
});

// ---------------------------------------------------------------------
// TEST 10: Manual override takes precedence
// ---------------------------------------------------------------------
test("TEST 10: Manual override takes precedence over auto-assigned values", () => {
  const slug = Metadata.slugify("Custom Overridden Exercise");
  Metadata.setOverride(slug, {
    exercise_type: "isolation",
    scoring_multiplier: 0.45,
    bodyweight_factor: 0.15
  });

  const resolved = Metadata.getMetadata("Custom Overridden Exercise");
  assert.strictEqual(resolved.manually_overridden, true);
  assert.strictEqual(resolved.source, "MANUAL");
  assert.strictEqual(resolved.scoring_multiplier, 0.45);
  assert.strictEqual(resolved.bodyweight_factor, 0.15);

  // Clean up
  Metadata.removeOverride(slug);
});

// ---------------------------------------------------------------------
// TEST 11: Two users with different body weights
// ---------------------------------------------------------------------
test("TEST 11: Different user body weights produce different effective workloads for bodyweight movements", () => {
  const bwExercises = [
    {
      name: "Pull-Ups",
      logs: [
        { completed: true, values: { weight: 0, reps: 10 } },
        { completed: true, values: { weight: 0, reps: 10 } }
      ]
    }
  ];

  const res60kg = DTS.calculateDailyScore({
    exercises: bwExercises,
    cardio: [],
    userBodyWeightKg: 60,
    getExerciseMetaFn: Metadata.getMetadata
  });

  const res100kg = DTS.calculateDailyScore({
    exercises: bwExercises,
    cardio: [],
    userBodyWeightKg: 100,
    getExerciseMetaFn: Metadata.getMetadata
  });

  assert(res100kg.strengthWorkload > res60kg.strengthWorkload, "100kg user must have higher strength volume for pull-ups");
  console.log(`       Result: 60kg user volume = ${res60kg.strengthWorkload} kg, 100kg user volume = ${res100kg.strengthWorkload} kg`);
});

// ---------------------------------------------------------------------
// TEST 12: Extremely large cardio session cannot overwhelm strength
// ---------------------------------------------------------------------
test("TEST 12: Extremely large cardio session is bounded and cannot overwhelm resistance component", () => {
  const massiveCardio = [
    { type: "Ultra Marathon", duration: 300, speed: 12.0, incline: 10 } // 300 min @ 12km/h @ 10% incline = 7200 workload!
  ];

  const res = DTS.calculateDailyScore({
    exercises: [],
    cardio: massiveCardio,
    userBodyWeightKg: 75,
    getExerciseMetaFn: Metadata.getMetadata
  });

  assert(res.dts <= 25, `Cardio-only score cannot exceed ~25 even with massive cardio (got ${res.dts})`);
  assert(res.cardioNormalized <= 5.0, "Cardio normalized must be clamped to upper bound");
});

// ---------------------------------------------------------------------
// TEST 13: Extremely large strength session bounded by sigmoid
// ---------------------------------------------------------------------
test("TEST 13: Extremely large strength session is bounded <= 100 by sigmoid", () => {
  const massiveStrength = [
    {
      name: "Barbell Squat",
      logs: Array.from({ length: 50 }, () => ({
        completed: true,
        values: { weight: 300, reps: 20 } // 50 sets of 300kg x 20 reps!
      }))
    }
  ];

  const res = DTS.calculateDailyScore({
    exercises: massiveStrength,
    cardio: [{ type: "Treadmill", duration: 60, speed: 10, incline: 5 }],
    userBodyWeightKg: 80,
    getExerciseMetaFn: Metadata.getMetadata
  });

  assert(res.dts <= 100, `DTS must not exceed 100 (got ${res.dts})`);
  assert(res.dts >= 80, `Massive session should score Very High (got ${res.dts})`);
  console.log(`       Result: Massive session DTS = ${res.dts} (clamped at <= 100)`);
});

// ---------------------------------------------------------------------
// TEST 14: Historical score reproducibility after reconfiguration
// ---------------------------------------------------------------------
test("TEST 14: Historical score preserves stored parameters and remains reproducible", () => {
  const exercises = [
    {
      name: "Flat Barbell Bench Press",
      logs: [{ completed: true, values: { weight: 80, reps: 10 } }]
    }
  ];

  const originalScore = DTS.calculateDailyScore({
    exercises,
    cardio: [],
    userBodyWeightKg: 75,
    calibrationRef: { ...DTS.REFERENCE_CONFIG, referenceVersion: 1, strengthReference: 10000 }
  });

  // Reconfigure reference in the future
  const futureConfig = { ...DTS.REFERENCE_CONFIG, referenceVersion: 2, strengthReference: 15000 };

  // Re-evaluating with stored original reference preserves original score
  const reproducedScore = DTS.calculateDailyScore({
    exercises,
    cardio: [],
    userBodyWeightKg: 75,
    calibrationRef: { ...futureConfig, strengthReference: originalScore.strengthReferenceUsed }
  });

  assert.strictEqual(reproducedScore.dts, originalScore.dts, "Historical score must be exact match when using stored reference");
});

// ---------------------------------------------------------------------
// TEST 15: Calibration reference baseline & EWMA personal baseline progression (Section 9 & 9.2)
// ---------------------------------------------------------------------
test("TEST 15: Calibration reference baseline & EWMA personal baseline progression", () => {
  // Case A: 3 workouts (< 5) -> 100% calibration reference
  const history3 = [
    { strengthWorkload: 12000, cardioWorkload: 100 },
    { strengthWorkload: 13000, cardioWorkload: 120 },
    { strengthWorkload: 11000, cardioWorkload: 110 }
  ];
  const refs3 = DTS.computeActiveReferences(history3);
  assert.strictEqual(refs3.blend, 0, "0-4 workouts must use 100% calibration reference (blend = 0)");
  assert.strictEqual(refs3.strengthRef, DTS.REFERENCE_CONFIG.strengthReference);

  // Case B: 7 workouts (5-9) -> Blended
  const history7 = Array.from({ length: 7 }, () => ({ strengthWorkload: 15000, cardioWorkload: 200 }));
  const refs7 = DTS.computeActiveReferences(history7);
  assert(refs7.blend > 0 && refs7.blend < 0.5, `5-9 workouts must have blend between 0.2 and 0.5 (got ${refs7.blend})`);

  // Case C: 35 workouts (30+) -> Primarily personal baseline (90% personal)
  const history35 = Array.from({ length: 35 }, () => ({ strengthWorkload: 20000, cardioWorkload: 250 }));
  const refs35 = DTS.computeActiveReferences(history35);
  assert.strictEqual(refs35.blend, 0.90, "30+ workouts must use 90% personal baseline");
  assert(refs35.strengthRef > 18000, `Strength reference should have adapted towards 20000 (got ${refs35.strengthRef})`);
  console.log(`       Progression: 3 workouts ref = ${refs3.strengthRef}, 7 workouts ref = ${refs7.strengthRef}, 35 workouts ref = ${refs35.strengthRef}`);
});

// ---------------------------------------------------------------------
// CARDIO TEST 1: 30-minute treadmill session
// ---------------------------------------------------------------------
test("CARDIO TEST 1: 30-minute treadmill session calculates correctly with incline", () => {
  const c = { type: "Treadmill", duration: 30, speed: 6, incline: 5 };
  const res = DTS.calculateCardioSessionWorkload(c);
  // duration * speed * (1 + incline/10) = 30 * 6 * 1.5 = 270
  assert.strictEqual(res.category, "treadmill");
  assert.strictEqual(res.workload, 270);
});

// ---------------------------------------------------------------------
// CARDIO TEST 2: 30-minute cycling session
// ---------------------------------------------------------------------
test("CARDIO TEST 2: 30-minute cycling session calculates independently of treadmill incline", () => {
  const c = { type: "Cycling", duration: 30, speed: 20, incline: 5, gear: 1 };
  const res = DTS.calculateCardioSessionWorkload(c);
  // duration * speed * (1 + (gear-1)/10) * multiplier = 30 * 20 * 1 * 0.33 = 198
  assert.strictEqual(res.category, "cycling");
  assert.strictEqual(res.workload, 198);
});

// ---------------------------------------------------------------------
// CARDIO TEST 3: Treadmill + Cycling aggregation
// ---------------------------------------------------------------------
test("CARDIO TEST 3: Treadmill + Cycling both included in DailyCardioWorkload", () => {
  const cardio = [
    { type: "Treadmill", duration: 30, speed: 6, incline: 5 }, // 270
    { type: "Cycling", duration: 30, speed: 20, gear: 1 } // 198
  ];
  const res = DTS.calculateDailyScore({ exercises: [], cardio, userBodyWeightKg: 75 });
  assert.strictEqual(res.cardioDetails.aggregates.treadmill, 270);
  assert.strictEqual(res.cardioDetails.aggregates.cycling, 198);
  assert.strictEqual(res.cardioWorkload, 468);
});

// ---------------------------------------------------------------------
// CARDIO TEST 4: Cycling-only day
// ---------------------------------------------------------------------
test("CARDIO TEST 4: Cycling-only day produces non-zero DTS", () => {
  const res = DTS.calculateDailyScore({ exercises: [], cardio: [{ type: "Bike", duration: 45, speed: 18, gear: 2 }], userBodyWeightKg: 75 });
  assert(res.dts > 0, "DTS should be non-zero");
  assert(res.cardioWorkload > 0, "Cardio workload should be non-zero");
});

// ---------------------------------------------------------------------
// CARDIO TEST 5: Treadmill-only day
// ---------------------------------------------------------------------
test("CARDIO TEST 5: Treadmill-only day produces non-zero DTS", () => {
  const res = DTS.calculateDailyScore({ exercises: [], cardio: [{ type: "Run", duration: 20, speed: 10, incline: 0 }], userBodyWeightKg: 75 });
  assert(res.dts > 0, "DTS should be non-zero");
  assert(res.cardioWorkload > 0, "Cardio workload should be non-zero");
});

// ---------------------------------------------------------------------
// CARDIO TEST 6: Multiple treadmill + multiple cycling sessions
// ---------------------------------------------------------------------
test("CARDIO TEST 6: Multiple treadmill and cycling sessions are aggregated", () => {
  const cardio = [
    { type: "Treadmill Walk", duration: 10, speed: 5, incline: 0 }, // 50
    { type: "Treadmill Run", duration: 20, speed: 10, incline: 2 }, // 200 * 1.2 = 240
    { type: "Spin Bike", duration: 15, speed: 20, gear: 3 } // 15*20 * 1.2 = 360 * 0.33 = 118.8
  ];
  const res = DTS.calculateDailyScore({ exercises: [], cardio, userBodyWeightKg: 75 });
  assert.strictEqual(res.cardioDetails.sessions.length, 3);
  assert.strictEqual(res.cardioWorkload, 409); // 50 + 240 + 118.8 = 408.8, rounded to 409
});

// ---------------------------------------------------------------------
// CARDIO TEST 7: Future cardio activity added
// ---------------------------------------------------------------------
test("CARDIO TEST 7: Future cardio activity uses 'other' metadata formula", () => {
  const c = { type: "Rowing Machine", duration: 20, speed: 12 };
  const res = DTS.calculateCardioSessionWorkload(c);
  assert.strictEqual(res.category, "other");
  assert.strictEqual(res.workload, 240); // 20 * 12
});

// ---------------------------------------------------------------------
// CARDIO TEST 8: Extremely high cycling workload
// ---------------------------------------------------------------------
test("CARDIO TEST 8: Extremely high cycling workload cannot overpower resistance", () => {
  const massiveCardio = [{ type: "Cycling", duration: 300, speed: 30, gear: 5 }];
  const res = DTS.calculateDailyScore({ exercises: [], cardio: massiveCardio, userBodyWeightKg: 75 });
  assert(res.dts <= 25, `Cardio only max contribution is bounded (got ${res.dts})`);
});

console.log("\n==================================================");
console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log("==================================================");

if (failed > 0) {
  process.exit(1);
}
