# GymCoach V6 UI update

- Set Log moved directly below the exercise name in the exercise-details view.
- Set Log is split into Previous and Current sections.
- The Current section remains editable; the Previous section is read-only.
- The Set Log "Done" heading is now blank while the checkbox remains.
- Workout intensity is shown in the top bar and in exercise details.
- Intensity is calculated across the full day's planned sets and rep performance.
- Front exercise media thumbnails are larger.
- Weekly Check is split into Previous and Current sections.
- Sidebar collapse now leaves only the logo and expand control visible.
- Removed the browser-local storage disclaimer from exercise details.
- Removed model recommendation lists/descriptions from Settings; model ID is a clean input.
- Today resolves the workout/rest day from the actual calendar weekday.
- AI export includes project/day/exercise intensity and detailed set timestamps.


## V8 UI/history update

- Hidden media elements can no longer render as a blank white rectangle.
- Exercise details now show uploaded images correctly.
- Previous Set Log cells show `-` when there is no stored value.
- The live app retains only the rolling Monday–Sunday week of workout set history.
- Older set history is archived as separate day-level CSV records.
- AI Coach exposes the saved CSV archive by day.
- Weekly Check Previous values use `-` for missing fields.


## V9
- Numeric weight entry with kg/lb selector and automatic conversion.
- Single, Double and Four pulley options with automatic resistance-preserving conversion.
- Standard effective resistance stored in kilograms for future analysis/ML.
- Exercise rest totals track planned + extra + 5-second default delay.
- Extra rest counter appears beside the rest countdown.
- GymCoach logo reloads into a blank Home page.


## V9.1
- Intensity now uses a white position marker over the gradient scale.
- The marker begins at the far left at 0.0/5 and moves right with intensity.
- Rest intervals are counted only after the programmed countdown completes.
- The 5-second default delay is added once per completed rest interval.


## V10
- Exercise detail timer moved out of the main page rail and into the exercise details section.
- Set Log defaults to Weight, Reps and Time; RIR is no longer used for new set logs.
- The Set timer records elapsed time directly into the selected set's Time cell, which remains manually editable.
- Added recorded-total time across all set rows.
- Added the compact overall workout intensity scale to the top navigation area.

## V11 - Timer and intensity UI correction
- Intensity is now visual-only in the UI: the gradient scale and Red/Orange/Yellow/Light green/Green labels are shown without numeric intensity scores.
- Added the same intensity scale to the top navigation area.
- Set timer now uses a configurable countdown followed by an extra-time count-up.
- Default delay-balance correction is 5 seconds and is applied when Stop & record calculates the saved Time value.
- Timer recording is locked to a set ID, so completing Set 1 cannot cause the timer to write into Set 2.
- Saved time values remain manually editable and receive a `timeRecordedAt` timestamp when recorded.
