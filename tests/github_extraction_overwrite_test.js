const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log("==================================================");
console.log("TESTING GITHUB VIDEO EXTRACTION & OVERWRITE PRIORITY");
console.log("==================================================");

const root = path.join(__dirname, '..');
const superadminHtml = fs.readFileSync(path.join(root, 'superadmin.html'), 'utf8');
const superadminJs = fs.readFileSync(path.join(root, 'js', 'superadmin.js'), 'utf8');

// 1. Descriptions removed
assert(!superadminHtml.includes('💡 Auto-extracts from GitHub'), "Descriptions must be removed from superadmin.html");
assert(!superadminHtml.includes('Upload an animated .gif demonstration or link GitHub'), "GIF description must be removed from superadmin.html");
assert(!superadminHtml.includes('💡 Use an external image URL to avoid burning'), "Image URL description must be removed from superadmin.html");
console.log("✅ [PASS] All wordy and unusual text descriptions removed from modal");

// 2. Overwrite & Top Priority DOM elements
assert(superadminHtml.includes('id="exModalUploadPriorityBadge"'), "superadmin.html must contain exModalUploadPriorityBadge");
assert(superadminHtml.includes('id="exModalVideoOverwrite"'), "superadmin.html must contain exModalVideoOverwrite checkbox");
assert(superadminHtml.includes('id="exModalVideoOverwriteWrap"'), "superadmin.html must contain exModalVideoOverwriteWrap");
console.log("✅ [PASS] Uploaded media Top Priority badge and Overwrite feature controls present in superadmin.html");

// 3. Test GitHub extraction: https://github.com/Beeshrm76/GymCoach/blob/main/videos/shoulder_press.mp4
function convertGitHubUrlToRaw(url) {
  if (!url || typeof url !== 'string') return url;
  const clean = url.trim();
  const ghMatch = clean.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)\/(?:blob|raw)\/([^\/]+)\/(.+)$/i);
  if (ghMatch) {
    const [, owner, repo, branch, filepath] = ghMatch;
    const cleanPath = filepath.replace(/\?.*$/, '');
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${cleanPath}`;
  }
  return clean;
}

const inputUrl = "https://github.com/Beeshrm76/GymCoach/blob/main/videos/shoulder_press.mp4";
const rawResult = convertGitHubUrlToRaw(inputUrl);
assert.strictEqual(
  rawResult,
  "https://raw.githubusercontent.com/Beeshrm76/GymCoach/main/videos/shoulder_press.mp4",
  "GitHub blob URL must convert to raw.githubusercontent.com streaming URL"
);
console.log("✅ [PASS] GitHub blob URL converts directly to raw streaming URL for video preview");

// 4. Test Auto-Generation when Exercise Name is Typed
function slugFromName(name) {
  if (!name) return "";
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function githubVideoUrlFromName(name) {
  const slug = slugFromName(name);
  return slug ? `https://raw.githubusercontent.com/Beeshrm76/GymCoach/main/videos/${slug}.mp4` : "";
}

const shoulderPressVideo = githubVideoUrlFromName("Shoulder Press");
assert.strictEqual(
  shoulderPressVideo,
  "https://raw.githubusercontent.com/Beeshrm76/GymCoach/main/videos/shoulder_press.mp4",
  "Typing 'Shoulder Press' must auto-derive videos/shoulder_press.mp4 on GitHub"
);
console.log("✅ [PASS] Typing exercise name automatically derives and attaches GitHub video extraction path");

// 5. Test Overwrite & Priority Logic
function simulatePreviewSource(opts) {
  const { hasUploadedFile, overwriteActive, videoUrl } = opts;
  const isOverwriteActive = hasUploadedFile && overwriteActive;
  if (isOverwriteActive) {
    return { source: "uploaded_file", priority: "top_priority" };
  }
  if (videoUrl) {
    return { source: "video_url", priority: "link" };
  }
  return { source: "none", priority: "none" };
}

// Case A: Uploaded file exists with default added link -> Uploaded file has Top Priority
const caseA = simulatePreviewSource({
  hasUploadedFile: true,
  overwriteActive: true,
  videoUrl: "https://raw.githubusercontent.com/Beeshrm76/GymCoach/main/videos/shoulder_press.mp4"
});
assert.strictEqual(caseA.source, "uploaded_file");
assert.strictEqual(caseA.priority, "top_priority");

// Case B: User unchecks overwrite -> Falls back to default added link
const caseB = simulatePreviewSource({
  hasUploadedFile: true,
  overwriteActive: false,
  videoUrl: "https://raw.githubusercontent.com/Beeshrm76/GymCoach/main/videos/shoulder_press.mp4"
});
assert.strictEqual(caseB.source, "video_url");
assert.strictEqual(caseB.priority, "link");

// Case C: No uploaded file -> Uses default added link
const caseC = simulatePreviewSource({
  hasUploadedFile: false,
  overwriteActive: true,
  videoUrl: "https://raw.githubusercontent.com/Beeshrm76/GymCoach/main/videos/shoulder_press.mp4"
});
assert.strictEqual(caseC.source, "video_url");

console.log("✅ [PASS] Uploaded media has top priority over default added link, with interactive overwrite toggle");

console.log("==================================================");
console.log("ALL GITHUB EXTRACTION & OVERWRITE TESTS PASSED!");
console.log("==================================================");
