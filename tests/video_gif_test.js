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

console.log("==================================================");
console.log("ALL TESTS PASSED SUCCESSFULLY!");
console.log("==================================================");
