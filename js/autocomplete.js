// autocomplete.js — fuzzy exercise-name autocomplete.
//
// Attaches to any input element and shows a styled dropdown of matching
// exercise names from EXERCISE_DB.  Matching is word-level: every word the
// user types must appear *somewhere* in the exercise name or its aliases,
// regardless of order.  This way both "shoulder press" and "press shoulder"
// find "Shoulder Press Machine", and "cable lat" finds both
// "Cable Lateral Raise" and "Straight Arm Cable Lat Pulldown."
//
// Usage:
//   ExerciseAutocomplete.attach(inputElement, { onSelect(name) { ... } });
//
// The dropdown is positioned absolutely relative to the input's offset
// parent.  On selection, the input's value is set and the callback fires.

window.ExerciseAutocomplete = (() => {
  const MAX_RESULTS = 8;
  const MIN_CHARS = 2;      // only search after 2 characters typed

  // Pre-build a searchable index: for each exercise, one concatenated string
  // of name + all aliases, lowercased and normalized.
  let _index = null;
  function buildIndex() {
    if (_index) return _index;
    const db = window.EXERCISE_DB || [];
    _index = db.map(entry => {
      const rawText = [entry.name, ...(entry.aliases || [])].join(" ").toLowerCase();
      const normalized = rawText.replace(/[-_/]/g, " ");
      const combined = (rawText + " " + normalized).toLowerCase();
      return { name: entry.name, text: combined };
    });
    return _index;
  }

  // Matches a query word against text with stem & variation tolerance
  // (handles plurals like "squats" -> "squat", "pushups" -> "push up", "crunches" -> "crunch", etc.)
  function matchWord(text, word) {
    if (text.includes(word)) return true;
    if (word.length > 3) {
      if (word.endsWith("ies") && text.includes(word.slice(0, -3) + "y")) return true;
      if (word.endsWith("es") && text.includes(word.slice(0, -2))) return true;
      if (word.endsWith("s") && text.includes(word.slice(0, -1))) return true;
      if (word.endsWith("ing") && text.includes(word.slice(0, -3))) return true;
      if (text.includes(word + "s") || text.includes(word + "es")) return true;
    }
    return false;
  }

  // Score an exercise against the user's query words.
  // Returns 0 (no match) or a positive score (higher = better match).
  function score(entry, queryWords) {
    const text = entry.text;
    const name = entry.name.toLowerCase();

    // Every query word must appear somewhere in the combined text
    for (const w of queryWords) {
      if (!matchWord(text, w)) return 0;
    }

    let s = 1; // base match

    // Bonus: name (not just alias) contains each word
    let allInName = true;
    for (const w of queryWords) {
      if (matchWord(name, w)) s += 3;
      else allInName = false;
    }
    if (allInName) s += 10;

    // Bonus: name starts with the first query word
    if (name.startsWith(queryWords[0])) s += 8;

    // Bonus: exact name match
    const queryJoined = queryWords.join(" ");
    if (name === queryJoined) s += 50;

    // Bonus: shorter names rank higher (more specific)
    s += Math.max(0, 10 - name.split(" ").length);

    return s;
  }

  function search(query) {
    const trimmed = (query || "").trim().toLowerCase();
    if (trimmed.length < MIN_CHARS) return [];

    const words = trimmed.split(/\s+/).filter(Boolean);
    if (!words.length) return [];

    const index = buildIndex();
    const scored = [];
    for (const entry of index) {
      const s = score(entry, words);
      if (s > 0) scored.push({ name: entry.name, score: s });
    }

    // Also add exercises already used in the current project (user-defined)
    // so custom names the user has typed before also appear.
    try {
      const project = window.GymCoach?.project?.() || window.Store?.active?.();
      if (project?.days) {
        const seen = new Set(scored.map(x => x.name.toLowerCase()));
        for (const day of project.days) {
          for (const ex of (day.exercises || [])) {
            const exName = ex.name || "";
            if (!exName || seen.has(exName.toLowerCase())) continue;
            // Check if query words match
            const exLower = exName.toLowerCase();
            if (words.every(w => exLower.includes(w))) {
              scored.push({ name: exName, score: 2 }); // lower priority than DB
              seen.add(exLower);
            }
          }
        }
      }
    } catch { /* ignore if Store unavailable */ }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, MAX_RESULTS).map(x => x.name);
  }

  // ---------------------------------------------------------------- dropdown UI

  function createDropdown() {
    const dd = document.createElement("div");
    dd.className = "exercise-autocomplete-dropdown";
    dd.setAttribute("role", "listbox");
    dd.hidden = true;
    return dd;
  }

  function renderDropdown(dropdown, results, onPick) {
    if (!results.length) {
      dropdown.hidden = true;
      dropdown.innerHTML = "";
      return;
    }
    dropdown.innerHTML = results.map((name, i) => {
      const escaped = (name || "").replace(/[&<>"']/g, m =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
      return `<div class="ac-option" role="option" data-index="${i}">${escaped}</div>`;
    }).join("");
    dropdown.hidden = false;

    // Click handler on each option
    dropdown.querySelectorAll(".ac-option").forEach(opt => {
      opt.onmousedown = e => {
        e.preventDefault(); // keep focus on input
        const idx = +opt.dataset.index;
        onPick(results[idx]);
      };
    });
  }

  // ---------------------------------------------------------------- attach

  function attach(input, { onSelect } = {}) {
    if (!input) return;

    const dropdown = createDropdown();
    let activeIndex = -1;
    let currentResults = [];

    // Position the dropdown relative to the input's parent
    const wrap = input.closest("label") || input.parentElement;
    if (wrap) {
      // Make parent position:relative if it isn't already
      const style = getComputedStyle(wrap);
      if (style.position === "static") wrap.style.position = "relative";
      wrap.appendChild(dropdown);
    } else {
      input.parentElement?.appendChild(dropdown);
    }

    function updatePosition() {
      if (input.closest("label")) {
        dropdown.style.left = "0";
        dropdown.style.right = "0";
        dropdown.style.width = "auto";
        dropdown.style.top = "100%";
      } else {
        dropdown.style.left = input.offsetLeft + "px";
        dropdown.style.width = Math.max(input.offsetWidth, 260) + "px";
        dropdown.style.top = (input.offsetTop + input.offsetHeight + 4) + "px";
      }
    }

    function show(query) {
      currentResults = search(query);
      activeIndex = -1;
      updatePosition();
      renderDropdown(dropdown, currentResults, pick);
    }

    function hide() {
      dropdown.hidden = true;
      activeIndex = -1;
    }

    function pick(name) {
      input.value = name;
      hide();
      // Trigger input event so path auto-fill etc. reacts
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      if (onSelect) onSelect(name);
    }

    function highlightOption(index) {
      dropdown.querySelectorAll(".ac-option").forEach((opt, i) => {
        opt.classList.toggle("ac-active", i === index);
      });
      // Scroll active into view
      const active = dropdown.querySelector(".ac-active");
      if (active) active.scrollIntoView({ block: "nearest" });
    }

    input.addEventListener("input", () => {
      show(input.value);
    });

    input.addEventListener("focus", () => {
      if (input.value.trim().length >= MIN_CHARS) show(input.value);
    });

    input.addEventListener("blur", () => {
      // Slight delay so click on option registers before hiding
      setTimeout(hide, 150);
    });

    input.addEventListener("keydown", e => {
      if (dropdown.hidden || !currentResults.length) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        activeIndex = Math.min(activeIndex + 1, currentResults.length - 1);
        highlightOption(activeIndex);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        activeIndex = Math.max(activeIndex - 1, 0);
        highlightOption(activeIndex);
      } else if (e.key === "Enter" && activeIndex >= 0) {
        e.preventDefault();
        pick(currentResults[activeIndex]);
      } else if (e.key === "Escape") {
        hide();
      }
    });

    // Return a controller so we can clean up if needed
    return {
      destroy() {
        dropdown.remove();
      },
      hide
    };
  }

  return { attach, search };
})();
