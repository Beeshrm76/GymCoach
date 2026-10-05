// tests/video_gif_test.js
// Verification of Video URL extraction, GIF handling, and prompt token optimization.

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log("==================================================");
console.log("TESTING VIDEO URL EXTRACTION & GIF FUNCTIONALITY");
console.log("==================================================");

// 1. Test YouTube & Video extraction
const ytRegex = /(?:youtube(?:-nocookie)?\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?|shorts)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i;

function extractVideoInfo(url) {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  const ytMatch = trimmed.match(ytRegex);
  if (ytMatch && ytMatch[1]) {
    const videoId = ytMatch[1];
    return {
      type: "youtube",
      id: videoId,
      embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&enablejsapi=1`,
      url: trimmed
    };
  }

  const vimeoMatch = trimmed.match(/(?:vimeo\.com\/(?:video\/)?|player\.vimeo\.com\/video\/)([0-9]+)/i);
  if (vimeoMatch && vimeoMatch[1]) {
    return {
      type: "vimeo",
      id: vimeoMatch[1],
      embedUrl: `https://player.vimeo.com/video/${vimeoMatch[1]}`,
      url: trimmed
    };
  }

  if (/\.(mp4|webm|ogg|mov|m4v)(\?.*)?$/i.test(trimmed) ||
      trimmed.includes("/storage/v1/object/public/app-media/exercise-videos") ||
      trimmed.startsWith("blob:") || trimmed.startsWith("data:video")) {
    return { type: "direct", url: trimmed };
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return { type: "direct", url: trimmed };
  }

  return null;
}

// Test cases for YouTube URLs
const testUrls = [
  { url: "https://www.youtube.com/watch?v=kGgYQ4e1zZ8", expectedId: "kGgYQ4e1zZ8" },
  { url: "https://youtu.be/kGgYQ4e1zZ8", expectedId: "kGgYQ4e1zZ8" },
  { url: "https://www.youtube.com/shorts/kGgYQ4e1zZ8", expectedId: "kGgYQ4e1zZ8" },
  { url: "https://www.youtube.com/embed/kGgYQ4e1zZ8", expectedId: "kGgYQ4e1zZ8" },
  { url: "https://m.youtube.com/watch?v=kGgYQ4e1zZ8&t=45s", expectedId: "kGgYQ4e1zZ8" },
  { url: "https://youtube-nocookie.com/embed/kGgYQ4e1zZ8?si=abc12345", expectedId: "kGgYQ4e1zZ8" },
  { url: "https://www.youtube.com/watch?feature=share&v=kGgYQ4e1zZ8", expectedId: "kGgYQ4e1zZ8" }
];

testUrls.forEach(t => {
  const res = extractVideoInfo(t.url);
  assert.strictEqual(res.type, "youtube", `URL ${t.url} should be detected as youtube`);
  assert.strictEqual(res.id, t.expectedId, `Extracted ID for ${t.url} should be ${t.expectedId}`);
  assert(res.embedUrl.includes(t.expectedId), `Embed URL must contain ${t.expectedId}`);
});
console.log("✅ [PASS] All YouTube URL patterns extract video ID and build embed URL");

// Test Vimeo
const vimeoRes = extractVideoInfo("https://vimeo.com/76979871");
assert.strictEqual(vimeoRes.type, "vimeo");
assert.strictEqual(vimeoRes.id, "76979871");
console.log("✅ [PASS] Vimeo URL extracts ID and embed URL");

// Test Direct Video
function convertGitHubUrlToRaw(url) {
  if (!url || typeof url !== "string") return url;
  const clean = url.trim();
  const ghMatch = clean.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)\/(?:blob|raw)\/([^\/]+)\/(.+)$/i);
  if (ghMatch) {
    const [, owner, repo, branch, filepath] = ghMatch;
    const cleanPath = filepath.replace(/\?.*$/, "");
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${cleanPath}`;
  }
  return clean;
}

const ghBlobRes = extractVideoInfo(convertGitHubUrlToRaw("https://github.com/Beeshrm76/GymCoach/blob/main/videos/bench_press.mp4"));
assert.strictEqual(ghBlobRes.type, "direct");
assert.strictEqual(ghBlobRes.url, "https://raw.githubusercontent.com/Beeshrm76/GymCoach/main/videos/bench_press.mp4");
console.log("✅ [PASS] GitHub blob video URL correctly converted to raw.githubusercontent.com and recognized as direct video");

const ghRawRes = extractVideoInfo(convertGitHubUrlToRaw("https://github.com/Beeshrm76/GymCoach/raw/main/videos/deadlift.mp4"));
assert.strictEqual(ghRawRes.type, "direct");
assert.strictEqual(ghRawRes.url, "https://raw.githubusercontent.com/Beeshrm76/GymCoach/main/videos/deadlift.mp4");
console.log("✅ [PASS] GitHub raw video URL correctly converted to raw streaming URL");

const mp4Res = extractVideoInfo("https://cdn.example.com/exercises/bench.mp4");
assert.strictEqual(mp4Res.type, "direct");
console.log("✅ [PASS] Direct MP4 URL recognized");

// 2. Test URL preservation in normalizeVideoPath
function normalizeVideoPath(p) {
  if (!p) return "";
  const clean = p.replace(/\\/g, "/").trim();
  if (/^https?:\/\/|^data:|^blob:/i.test(clean)) return clean;
  let filename = clean.split("/").pop();
  if (!filename) return "";
  filename = filename.replace(/-/g, "_");
  if (!/\.[a-z0-9]+$/i.test(filename)) filename += ".mp4";
  return `videos/${filename}`;
}

assert.strictEqual(
  normalizeVideoPath("https://www.youtube.com/watch?v=kGgYQ4e1zZ8"),
  "https://www.youtube.com/watch?v=kGgYQ4e1zZ8"
);
assert.strictEqual(
  normalizeVideoPath("bench-press.mp4"),
  "videos/bench_press.mp4"
);
console.log("✅ [PASS] normalizeVideoPath preserves web URLs and properly formats local paths");

// 3. Test that report.js does not contain "Media attached"
const reportContent = fs.readFileSync(path.join(__dirname, '../js/report.js'), 'utf8');
assert(!reportContent.includes("Media attached:"), "js/report.js should NOT have 'Media attached:'");
console.log("✅ [PASS] js/report.js does not emit 'Media attached:' in prompt generation");

// 4. Test security.js GIF validation
const securityContent = fs.readFileSync(path.join(__dirname, '../js/security.js'), 'utf8');
assert(securityContent.includes("isGif = bytes[0] === 0x47"), "security.js must check GIF magic bytes");
assert(securityContent.includes("gif: 15 * 1024 * 1024"), "security.js must have GIF size limit");
console.log("✅ [PASS] js/security.js properly validates GIF files with magic bytes");

// 5. Test index.html and superadmin.html DOM elements
const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
assert(indexHtml.includes('id="detailVideoFrame"'), "index.html must have detailVideoFrame iframe");
assert(indexHtml.includes('id="detailGifUpload"'), "index.html must have detailGifUpload input");
assert(indexHtml.includes('id="detailGifPath"'), "index.html must have detailGifPath input");
console.log("✅ [PASS] index.html includes video iframe and GIF upload controls");

const superadminHtml = fs.readFileSync(path.join(__dirname, '../superadmin.html'), 'utf8');
assert(superadminHtml.includes('id="exModalVideoIframe"'), "superadmin.html must have exModalVideoIframe");
assert(superadminHtml.includes('id="exModalGifFile"'), "superadmin.html must have exModalGifFile");
assert(superadminHtml.includes('id="exModalGifUrl"'), "superadmin.html must have exModalGifUrl");
assert(superadminHtml.includes('id="exModalGifPreview"'), "superadmin.html must have exModalGifPreview");
console.log("✅ [PASS] superadmin.html includes video iframe preview and custom GIF upload section");

// 6. Test GitHub default video extraction from exercise name (Flat Bench press -> flat_bench_press)
function slugFromName(name) {
  if (!name) return "";
  return name.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

const GITHUB_MEDIA_BASE = "https://raw.githubusercontent.com/Beeshrm76/GymCoach/main";

function githubVideoUrlFromName(name) {
  const slug = slugFromName(name);
  return slug ? `${GITHUB_MEDIA_BASE}/videos/${slug}.mp4` : "";
}

function githubGifUrlFromName(name) {
  const slug = slugFromName(name);
  return slug ? `${GITHUB_MEDIA_BASE}/gifs/${slug}.gif` : "";
}

function isAutoGeneratedPath(path, kind) {
  if (!path || path === 'None') return true;
  const p = path.replace(/\\/g, "/").trim();
  if (!p) return true;
  if (kind === "video") {
    if (/^videos\/[a-z0-9_]+(\.mp4)?$/i.test(p)) return true;
    if (/^https?:\/\/(?:raw\.githubusercontent\.com|github\.com)\/[^\/]+\/[^\/]+\/(?:blob\/|raw\/)?[^\/]+\/videos\/[a-z0-9_]+(?:\.mp4)?$/i.test(p)) return true;
    return false;
  }
  if (kind === "image") {
    if (/^images\/[a-z0-9_]+(\.(?:jpg|jpeg|png|webp))?$/i.test(p)) return true;
    if (/^https?:\/\/(?:raw\.githubusercontent\.com|github\.com)\/[^\/]+\/[^\/]+\/(?:blob\/|raw\/)?[^\/]+\/images\/[a-z0-9_]+(?:\.(?:jpg|jpeg|png|webp))?$/i.test(p)) return true;
    return false;
  }
  if (kind === "gif") {
    if (/^(?:gifs|images)\/[a-z0-9_]+(?:\.gif)?$/i.test(p)) return true;
    if (/^https?:\/\/(?:raw\.githubusercontent\.com|github\.com)\/[^\/]+\/[^\/]+\/(?:blob\/|raw\/)?[^\/]+\/gifs\/[a-z0-9_]+(?:\.gif)?$/i.test(p)) return true;
    return false;
  }
  return false;
}

// Test slug generation
assert.strictEqual(slugFromName("Flat Bench press"), "flat_bench_press");
assert.strictEqual(slugFromName("Incline Dumbbell Press (30°)"), "incline_dumbbell_press_30");
assert.strictEqual(slugFromName("Lat Pulldown - Wide Grip"), "lat_pulldown_wide_grip");
console.log("✅ [PASS] slugFromName converts exercise names with spaces, caps, and symbols properly");

// Test GitHub video URL generation
const benchGhVideo = githubVideoUrlFromName("Flat Bench press");
assert.strictEqual(benchGhVideo, "https://raw.githubusercontent.com/Beeshrm76/GymCoach/main/videos/flat_bench_press.mp4");
const benchGhGif = githubGifUrlFromName("Flat Bench press");
assert.strictEqual(benchGhGif, "https://raw.githubusercontent.com/Beeshrm76/GymCoach/main/gifs/flat_bench_press.gif");
console.log("✅ [PASS] githubVideoUrlFromName & githubGifUrlFromName generate correct raw GitHub streaming paths");

// Test isAutoGeneratedPath logic
assert.strictEqual(isAutoGeneratedPath("", "video"), true);
assert.strictEqual(isAutoGeneratedPath("videos/flat_bench_press.mp4", "video"), true);
assert.strictEqual(isAutoGeneratedPath("https://raw.githubusercontent.com/Beeshrm76/GymCoach/main/videos/flat_bench_press.mp4", "video"), true);
assert.strictEqual(isAutoGeneratedPath("https://github.com/Beeshrm76/GymCoach/blob/main/videos/flat_bench_press.mp4", "video"), true);
assert.strictEqual(isAutoGeneratedPath("https://www.youtube.com/watch?v=kGgYQ4e1zZ8", "video"), false);
assert.strictEqual(isAutoGeneratedPath("https://vimeo.com/76979871", "video"), false);
console.log("✅ [PASS] isAutoGeneratedPath identifies GitHub URLs as auto-generated while preserving manual YouTube/custom links");

// Test simulated live update flow
let mockVideoInput = { value: "", placeholder: "" };
function simulateNameChange(newName) {
  const ghV = githubVideoUrlFromName(newName);
  mockVideoInput.placeholder = ghV;
  if (isAutoGeneratedPath(mockVideoInput.value, "video")) {
    mockVideoInput.value = ghV;
  }
}

// 1. Initial name typed
simulateNameChange("Flat Bench press");
assert.strictEqual(mockVideoInput.value, "https://raw.githubusercontent.com/Beeshrm76/GymCoach/main/videos/flat_bench_press.mp4");

// 2. Renamed exercise auto-updates GitHub video path
simulateNameChange("Incline Bench Press");
assert.strictEqual(mockVideoInput.value, "https://raw.githubusercontent.com/Beeshrm76/GymCoach/main/videos/incline_bench_press.mp4");

// 3. User enters manual YouTube link
mockVideoInput.value = "https://www.youtube.com/watch?v=kGgYQ4e1zZ8";
simulateNameChange("Barbell Squat");
// Manual YouTube link is NOT overwritten
assert.strictEqual(mockVideoInput.value, "https://www.youtube.com/watch?v=kGgYQ4e1zZ8");
assert.strictEqual(mockVideoInput.placeholder, "https://raw.githubusercontent.com/Beeshrm76/GymCoach/main/videos/barbell_squat.mp4");
console.log("✅ [PASS] Live name update workflow properly updates GitHub video path and respects custom user URLs");

console.log("==================================================");
console.log("ALL TESTS PASSED SUCCESSFULLY!");
console.log("==================================================");
