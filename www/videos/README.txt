Drop .mp4 / .webm files in this folder if you'd rather keep them as files than
upload them into the app.

Two ways to attach a video to an exercise:

1. Upload it in the app — open an exercise, "Upload Video". The file is stored in
   this browser's IndexedDB under the exercise's own ID, so it stays attached even
   after you reorder or rename things. Nothing is sent anywhere.

2. Keep it here as a file and reference it by path, e.g.
       videos/bench-press.mp4
   Paste that into the exercise's Video path field. Useful when you want the
   videos committed alongside the code, or shared between devices via the repo.

There are deliberately no per-day subfolders. Days are whatever you create in a
project — a 6-day PPL, a 5-day PPL, a 3-day full body — so a fixed folder layout
would only go stale. Organise this folder however you like; the app doesn't care.
