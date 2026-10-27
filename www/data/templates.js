// Project templates. These only seed a *shape* - day names, workout/rest split and
// empty exercise slots. Nothing here is enforced at runtime: the app treats a project
// as an arbitrary ordered list of days, so you can start blank and build any split.
//
// Add your own by pushing another entry onto window.PROJECT_TEMPLATES.

window.PROJECT_TEMPLATES = [
  {
    id: "blank",
    name: "Blank project",
    summary: "One empty workout day. Build everything yourself.",
    goal: "",
    days: [
      { name: "Day 1", type: "workout", title: "Workout", exercises: 0 }
    ]
  },
  {
    id: "ppl6",
    name: "6x PPL (Push / Pull / Legs x2)",
    summary: "Mon rest, then Push A, Pull A, Legs A, Push B, Pull B, Legs B.",
    goal: "Build muscle, strength and proportions",
    days: [
      { name: "Monday",    type: "rest",    title: "Rest & Weekly Check", restNotes: "Full rest. Log body measurements." },
      { name: "Tuesday",   type: "workout", title: "Push A", focus: "Chest and pressing", muscles: "Chest - Shoulders - Triceps", exercises: 5 },
      { name: "Wednesday", type: "workout", title: "Pull A", focus: "Back width", muscles: "Lats - Upper back - Biceps", exercises: 5 },
      { name: "Thursday",  type: "workout", title: "Legs A", focus: "Quad emphasis", muscles: "Quads - Glutes - Core", exercises: 5 },
      { name: "Friday",    type: "workout", title: "Push B", focus: "Shoulder emphasis", muscles: "Shoulders - Chest - Triceps", exercises: 5 },
      { name: "Saturday",  type: "workout", title: "Pull B", focus: "Back thickness", muscles: "Mid back - Rear delts - Biceps", exercises: 5 },
      { name: "Sunday",    type: "workout", title: "Legs B", focus: "Hamstring emphasis", muscles: "Hamstrings - Glutes - Calves", exercises: 5 }
    ]
  },
  {
    id: "ppl5",
    name: "5x PPL (rolling)",
    summary: "Five training days, two rest days. Push, Pull, Legs, Upper, Lower.",
    goal: "Muscle gain on a 5-day week",
    days: [
      { name: "Day 1", type: "workout", title: "Push",  focus: "Chest, shoulders, triceps", muscles: "Chest - Shoulders - Triceps", exercises: 5 },
      { name: "Day 2", type: "workout", title: "Pull",  focus: "Back and biceps", muscles: "Lats - Upper back - Biceps", exercises: 5 },
      { name: "Day 3", type: "workout", title: "Legs",  focus: "Full lower body", muscles: "Quads - Hamstrings - Glutes", exercises: 5 },
      { name: "Day 4", type: "rest",    title: "Rest",  restNotes: "Recovery day." },
      { name: "Day 5", type: "workout", title: "Upper", focus: "Upper body volume", muscles: "Chest - Back - Shoulders - Arms", exercises: 5 },
      { name: "Day 6", type: "workout", title: "Lower", focus: "Lower body volume", muscles: "Legs - Glutes - Calves", exercises: 5 },
      { name: "Day 7", type: "rest",    title: "Rest",  restNotes: "Recovery day + weekly check." }
    ]
  },
  {
    id: "ul4",
    name: "4x Upper / Lower",
    summary: "Two upper and two lower days with three rest days.",
    goal: "Strength on a 4-day week",
    days: [
      { name: "Day 1", type: "workout", title: "Upper A", focus: "Horizontal press and row", muscles: "Chest - Back - Arms", exercises: 6 },
      { name: "Day 2", type: "workout", title: "Lower A", focus: "Squat pattern", muscles: "Quads - Glutes", exercises: 5 },
      { name: "Day 3", type: "rest",    title: "Rest", restNotes: "Recovery day." },
      { name: "Day 4", type: "workout", title: "Upper B", focus: "Vertical press and pull", muscles: "Shoulders - Lats - Arms", exercises: 6 },
      { name: "Day 5", type: "workout", title: "Lower B", focus: "Hinge pattern", muscles: "Hamstrings - Glutes - Calves", exercises: 5 },
      { name: "Day 6", type: "rest",    title: "Rest", restNotes: "Recovery day." },
      { name: "Day 7", type: "rest",    title: "Rest", restNotes: "Recovery day + weekly check." }
    ]
  },
  {
    id: "fb3",
    name: "3x Full Body",
    summary: "Three full-body sessions on alternating days.",
    goal: "Efficient full-body training",
    days: [
      { name: "Day 1", type: "workout", title: "Full Body A", focus: "Squat, press, row", muscles: "Full body", exercises: 6 },
      { name: "Day 2", type: "rest",    title: "Rest", restNotes: "Recovery day." },
      { name: "Day 3", type: "workout", title: "Full Body B", focus: "Hinge, vertical press, pull", muscles: "Full body", exercises: 6 },
      { name: "Day 4", type: "rest",    title: "Rest", restNotes: "Recovery day." },
      { name: "Day 5", type: "workout", title: "Full Body C", focus: "Lunge, incline press, carry", muscles: "Full body", exercises: 6 },
      { name: "Day 6", type: "rest",    title: "Rest", restNotes: "Recovery day." },
      { name: "Day 7", type: "rest",    title: "Rest", restNotes: "Recovery day + weekly check." }
    ]
  },
  {
    id: "copy-starter",
    name: "Copy of the 6-Day PPL starter",
    summary: "Full duplicate of the shipped starter plan, exercises and all.",
    goal: "Build muscle, strength and proportions",
    cloneSeed: true,
    days: []
  }
];

// Column presets offered when adding a set column. Free text is always allowed too.
window.COLUMN_PRESETS = [
  { key: "weight",   label: "Weight" },
  { key: "reps",     label: "Reps" },
  { key: "rpe",      label: "RPE" },
  { key: "tempo",    label: "Tempo" },
  { key: "rest",     label: "Rest" },
  { key: "time",     label: "Time" },
  { key: "distance", label: "Distance" },
  { key: "effort",   label: "Effort" },
  { key: "band",     label: "Band" },
  { key: "incline",  label: "Incline" },
  { key: "note",     label: "Note" }
];
