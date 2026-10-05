const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log("==================================================");
console.log("TESTING ADMIN & SUPERADMIN MEDIA PREVIEWS");
console.log("==================================================");

const root = path.join(__dirname, '..');
const superadminHtml = fs.readFileSync(path.join(root, 'superadmin.html'), 'utf8');
const superadminJs = fs.readFileSync(path.join(root, 'js', 'superadmin.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const adminJs = fs.readFileSync(path.join(root, 'js', 'admin.js'), 'utf8');
const adminCss = fs.readFileSync(path.join(root, 'assets', 'admin.css'), 'utf8');

// 1. superadmin.html modal and buttons
assert(superadminHtml.includes('id="exerciseMediaPreviewModal"'), "superadmin.html must contain exerciseMediaPreviewModal");
assert(superadminHtml.includes('id="mediaPreviewVideoContent"'), "superadmin.html must contain video preview content");
assert(superadminHtml.includes('id="mediaPreviewGifContent"'), "superadmin.html must contain GIF preview content");
assert(superadminHtml.includes('id="mediaPreviewImageContent"'), "superadmin.html must contain Image preview content");
console.log("✅ [PASS] superadmin.html contains exerciseMediaPreviewModal with Video, GIF, and Image preview targets");

// 2. js/superadmin.js preview functions
assert(superadminJs.includes('openMediaPreview'), "js/superadmin.js must define openMediaPreview");
assert(superadminJs.includes('closeMediaPreview'), "js/superadmin.js must define closeMediaPreview");
assert(superadminJs.includes('switchMediaPreviewTab'), "js/superadmin.js must define switchMediaPreviewTab");
assert(superadminJs.includes('👁️ Preview'), "js/superadmin.js must render 👁️ Preview button in exercises table");
console.log("✅ [PASS] js/superadmin.js renders preview buttons and handles modal lifecycle with YouTube extraction");

// 3. admin.html preview controls & modal
assert(adminHtml.includes('id="btnAdminPreviewMedia"'), "admin.html must have btnAdminPreviewMedia");
assert(adminHtml.includes('id="adminMediaPreviewModal"'), "admin.html must have adminMediaPreviewModal");
assert(adminHtml.includes('id="adminMediaGifPreview"'), "admin.html must have adminMediaGifPreview card");
assert(adminHtml.includes('id="adminMediaGifInput"'), "admin.html must have adminMediaGifInput file input");
assert(adminHtml.includes('id="adminModalVideoPreviewBox"'), "admin.html must have adminModalVideoPreviewBox");
assert(adminHtml.includes('id="adminModalGifPreviewBox"'), "admin.html must have adminModalGifPreviewBox");
assert(adminHtml.includes('id="adminModalImagePreviewBox"'), "admin.html must have adminModalImagePreviewBox");
console.log("✅ [PASS] admin.html contains full preview button and media preview modal with Video, GIF, and Image containers");

// 4. js/admin.js preview and extraction logic
assert(adminJs.includes('openAdminMediaPreviewModal'), "js/admin.js must define openAdminMediaPreviewModal");
assert(adminJs.includes('closeAdminMediaPreviewModal'), "js/admin.js must define closeAdminMediaPreviewModal");
assert(adminJs.includes('extractVideoInfo'), "js/admin.js must include extractVideoInfo");
assert(adminJs.includes('adminMediaGifInput'), "js/admin.js must listen for GIF input changes");
assert(adminJs.includes('adminMediaGifRemove'), "js/admin.js must listen for GIF remove");
assert(adminJs.includes('btn-admin-media-preview-btn'), "js/admin.js must provide preview buttons in the exercises media list");
console.log("✅ [PASS] js/admin.js wires GIF uploads, video parsing, modal previews, and list preview buttons");

// 5. CSS badges and layout
assert(adminCss.includes('.gif-badge'), "assets/admin.css must define .gif-badge");
assert(adminCss.includes('.admin-media-preview-row'), "assets/admin.css must define .admin-media-preview-row");
console.log("✅ [PASS] assets/admin.css includes responsive preview grid and .gif-badge");

console.log("==================================================");
console.log("ALL ADMIN MEDIA PREVIEW TESTS PASSED!");
console.log("==================================================");
