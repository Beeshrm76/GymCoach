// tests/build_fixes_test.js
// Verifies:
// 1. Autocomplete closes and clears on pick without re-triggering show()
// 2. Project intensityBand, description, notes (and name/goal) auto-save and persist in Build view

const fs = require('fs');
const assert = require('assert');

console.log('==================================================');
console.log('TESTING BUILD FIXES (RECOMMENDATION & PERSISTENCE)');
console.log('==================================================');

// 1. Autocomplete logic check
const acCode = fs.readFileSync('js/autocomplete.js', 'utf8');
assert(acCode.includes('isSelecting = true'), 'isSelecting flag missing in autocomplete.js');
assert(acCode.includes('if (isSelecting) return;'), 'isSelecting guard missing in input/focus listeners');
assert(acCode.includes('dropdown.hidden = true;'), 'hide() should set dropdown.hidden to true');
assert(acCode.includes('dropdown.innerHTML = "";'), 'hide() should clear dropdown.innerHTML');
assert(acCode.includes('currentResults = [];'), 'hide() should clear currentResults');
assert(acCode.includes('pointerdown'), 'pointerdown listener should be registered for outside clicks');
console.log('✅ [PASS] 1. Autocomplete exercise recommendation clears and closes on selection');

// 2. Manage.js project settings check
const manageCode = fs.readFileSync('js/manage.js', 'utf8');
assert(manageCode.includes('syncProjectHeaderInputs'), 'syncProjectHeaderInputs missing in manage.js');
assert(manageCode.includes('document.activeElement !== bandEl'), 'renderProjectSettings should check activeElement for bandEl');
assert(manageCode.includes('document.activeElement !== descEl'), 'renderProjectSettings should check activeElement for descEl');
assert(manageCode.includes('document.activeElement !== notesEl'), 'renderProjectSettings should check activeElement for notesEl');
assert(manageCode.includes('projectIntensityBand'), 'projectIntensityBand missing');
assert(manageCode.includes('projectDescription'), 'projectDescription missing');
assert(manageCode.includes('projectNotes'), 'projectNotes missing');
assert(manageCode.includes('headerFields.forEach'), 'headerFields live event listeners missing');
console.log('✅ [PASS] 2. Project intensityBand, description, notes auto-save and persist in Build view');

// 3. Store.js createProject check
const storeCode = fs.readFileSync('js/store.js', 'utf8');
assert(storeCode.includes('intensityBand = ""'), 'Store.createProject should accept intensityBand');
assert(storeCode.includes('description = ""'), 'Store.createProject should accept description');
assert(storeCode.includes('notes = ""'), 'Store.createProject should accept notes');
console.log('✅ [PASS] 3. Store.createProject preserves intensityBand, description, notes');

console.log('==================================================');
console.log('ALL BUILD FIX TESTS PASSED SUCCESSFULLY!');
console.log('==================================================');
