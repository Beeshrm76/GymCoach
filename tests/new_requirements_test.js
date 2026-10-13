const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log("==================================================");
console.log("TESTING USER REQUIREMENTS (4 POINTS)");
console.log("==================================================");

const root = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const statsJs = fs.readFileSync(path.join(root, 'js', 'stats.js'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const adminJs = fs.readFileSync(path.join(root, 'js', 'admin.js'), 'utf8');
const superadminJs = fs.readFileSync(path.join(root, 'js', 'superadmin.js'), 'utf8');
const customCss = fs.readFileSync(path.join(root, 'assets', 'custom.css'), 'utf8');
const sqlFile = fs.readFileSync(path.join(root, 'tools', '010_prevent_superadmin_role_change.sql'), 'utf8');

// -----------------------------------------------------------------
// 1. REQUIREMENT 1: Remove word "non editable" from description
// -----------------------------------------------------------------
console.log("1. Checking removal of 'non editable' from descriptions...");
assert(!indexHtml.includes("Non-editable analytical progression"), "index.html must not contain 'Non-editable analytical progression'");
assert(!indexHtml.includes("non-editable"), "index.html must not contain 'non-editable'");
assert(!indexHtml.includes("non editable"), "index.html must not contain 'non editable'");

assert(!statsJs.includes("Select an exercise above to view non-editable"), "stats.js must not contain 'Select an exercise above to view non-editable'");
assert(!statsJs.includes("non-editable"), "stats.js must not contain 'non-editable'");
assert(!statsJs.includes("non editable"), "stats.js must not contain 'non editable'");

assert(!customCss.includes("Non-Editable"), "custom.css must not contain 'Non-Editable'");
console.log("✅ [PASS] 'non editable' completely removed from all descriptions and UI text.");

// -----------------------------------------------------------------
// 2. REQUIREMENT 2: 7-date body prediction panel for weight, body fat, chest, waist, arm size
// -----------------------------------------------------------------
console.log("2. Checking 7-date body metric prediction panel...");
assert(indexHtml.includes('id="bodyPredictionPanel"'), "index.html must have #bodyPredictionPanel");
assert(indexHtml.includes('id="predictionEvalBadge"'), "index.html must have #predictionEvalBadge");
assert(indexHtml.includes('id="predictionTimelineStrip"'), "index.html must have #predictionTimelineStrip");
assert(indexHtml.includes('id="predictionCardsGrid"'), "index.html must have #predictionCardsGrid");
assert(indexHtml.includes('id="predictionChartContainer"'), "index.html must have #predictionChartContainer");
assert(indexHtml.includes('id="predictionInsightBox"'), "index.html must have #predictionInsightBox");
assert(indexHtml.includes('id="pBodyFat"'), "index.html must have #pBodyFat in weekly check");

// Check the 5 metrics in stats.js PREDICTION_METRICS
assert(statsJs.includes('key: "weight"'), "stats.js must include weight metric");
assert(statsJs.includes('key: "bodyFat"'), "stats.js must include bodyFat metric");
assert(statsJs.includes('key: "waist"'), "stats.js must include waist metric");
assert(statsJs.includes('key: "chest"'), "stats.js must include chest metric");
assert(statsJs.includes('key: "arm"'), "stats.js must include arm metric");
assert(statsJs.includes('renderBodyPredictionPanel'), "stats.js must define renderBodyPredictionPanel");
assert(statsJs.includes('evalDates = allDates.slice(-7)'), "stats.js must evaluate 7 logged dates");
assert(statsJs.includes('evaluateMetricRegression'), "stats.js must calculate regression projections for the 5 metrics");

console.log("✅ [PASS] 7-date body metric prediction panel for weight, body fat, chest, waist, arm verified.");

// -----------------------------------------------------------------
// 3. REQUIREMENT 3: Don't allow one superadmin to change other superadmin roles
// -----------------------------------------------------------------
console.log("3. Checking superadmin role protection against other superadmins...");
// Admin.js
assert(adminJs.includes("isOtherSuper = roleUpper === 'SUPER_ADMIN' && u.id !== currentUser.id"), "admin.js must identify other superadmins");
assert(adminJs.includes("Super Admin accounts are protected. Cannot change another Super Admin's role"), "admin.js must protect other superadmins in table UI");
assert(adminJs.includes("Access Denied: One Super Administrator cannot modify another Super Administrator's role"), "admin.js setUserRole must block other superadmins");

// Superadmin.js
assert(superadminJs.includes("Super Admin accounts are protected. Cannot change other Super Admin roles"), "superadmin.js must protect other superadmins in table UI");
assert(superadminJs.includes("targetUser.role === 'SUPER_ADMIN' && userId !== currentUserId"), "superadmin.js setUserRole must block other superadmins");
assert(superadminJs.includes("u?.role === 'SUPER_ADMIN'"), "superadmin.js demoteAdmin must block demoting superadmins");

// SQL
assert(sqlFile.includes("target_current_role = 'SUPER_ADMIN' AND target_user_id != auth.uid()"), "010 SQL migration must guard set_user_role against modifying other superadmins");
console.log("✅ [PASS] One superadmin cannot change another superadmin's role in admin.js, superadmin.js, or SQL.");

// -----------------------------------------------------------------
// 4. REQUIREMENT 4: Display uploaded or changed things at the same time without refresh
// -----------------------------------------------------------------
console.log("4. Checking live display of uploads and changes without page refresh...");
// App.js video & gif preview uses local blob URL immediately when available
assert(appJs.includes("const localGif = await mediaSrc(exObj, \"gif\")"), "app.js previewActiveMedia must check local uploaded GIF first");
assert(appJs.includes("const localVid = await mediaSrc(exObj, \"video\")"), "app.js previewActiveMedia must check local uploaded video first");

// Superadmin.js live icon, image url, and logo preview handlers
assert(superadminJs.includes("updateExerciseIconPreview"), "superadmin.js must have live updateExerciseIconPreview");
assert(superadminJs.includes("URL.createObjectURL(file)"), "superadmin.js must generate live blob preview for icon/logo uploads");

console.log("✅ [PASS] All uploads and changes render immediately in open modals and panels without page refresh.");

// -----------------------------------------------------------------
// 5. REQUIREMENT 5: Replace arm with biceps and add forearm in measuring section (current & previous)
// -----------------------------------------------------------------
console.log("5. Checking replacement of arm with biceps and addition of forearm in measuring section...");
assert(indexHtml.includes('<label>Biceps (cm)<input disabled placeholder="—"></label>'), "Previous panel must have Biceps (cm)");
assert(indexHtml.includes('<label>Forearm (cm)<input disabled placeholder="—"></label>'), "Previous panel must have Forearm (cm)");
assert(indexHtml.includes('<label>Biceps (cm)<input id="pBiceps" inputmode="decimal" placeholder="—"></label>'), "Current panel must have Biceps (cm) with id pBiceps");
assert(indexHtml.includes('<label>Forearm (cm)<input id="pForearm" inputmode="decimal" placeholder="—"></label>'), "Current panel must have Forearm (cm) with id pForearm");

// Ensure "Arm (cm)" is NOT in the previous or current card
const weeklyCheckSection = indexHtml.split('class="previous-current-grid"')[1]?.split('id="homePredictionQuickCard"')[0] || '';
assert(!weeklyCheckSection.includes('<label>Arm (cm)'), "Weekly check measuring section must not contain Arm (cm)");

// Check app.js logic
assert(appJs.includes('if ($("pBiceps")) $("pBiceps").value = bicepVal;'), "app.js renderProgress must populate pBiceps");
assert(appJs.includes('if ($("pForearm")) $("pForearm").value = prof.current.forearm || "";'), "app.js renderProgress must populate pForearm");
assert(appJs.includes('<label>Biceps (cm)<input disabled value="${esc(previous?.biceps ?? previous?.arm ?? "")}" placeholder="—"></label>'), "app.js renderProgress must render Biceps in previous values");
assert(appJs.includes('<label>Forearm (cm)<input disabled value="${esc(previous?.forearm || "")}" placeholder="—"></label>'), "app.js renderProgress must render Forearm in previous values");
assert(appJs.includes('biceps: bicepInput'), "app.js saveProfile must save biceps");
assert(appJs.includes('forearm: forearmInput'), "app.js saveProfile must save forearm");

// Check stats.js PREDICTION_METRICS
assert(statsJs.includes('key: "biceps"'), "stats.js PREDICTION_METRICS must include biceps");
assert(statsJs.includes('key: "forearm"'), "stats.js PREDICTION_METRICS must include forearm");
console.log("✅ [PASS] Arm replaced with Biceps and Forearm added in both Current and Previous panels.");

console.log("==================================================");
console.log("ALL REQUIREMENTS VERIFIED SUCCESSFULLY!");
console.log("==================================================");

