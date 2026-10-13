// scripts/build-apk.js — Builds Android debug APK and copies to downloads/GymCoach.apk
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ANDROID_DIR = path.join(ROOT, 'android');
const APK_SRC = path.join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const DOWNLOADS_DIR = path.join(ROOT, 'downloads');
const APK_DEST = path.join(DOWNLOADS_DIR, 'GymCoach.apk');

// Prefer Android Studio JBR (Java 21+)
const jbrPath = 'C:\\Program Files\\Android\\Android Studio\\jbr';
if (fs.existsSync(jbrPath)) {
  process.env.JAVA_HOME = jbrPath;
  console.log(`[build-apk] Using Android Studio JBR at: ${jbrPath}`);
}

console.log('[build-apk] 1/4 Syncing web bundle to Android...');
execSync('npm run build:web', { cwd: ROOT, stdio: 'inherit' });
execSync('npx cap sync android', { cwd: ROOT, stdio: 'inherit' });

console.log('[build-apk] 2/4 Compiling Android APK with Gradle...');
const gradlewCmd = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
execSync(`${gradlewCmd} assembleDebug`, { cwd: ANDROID_DIR, stdio: 'inherit' });

console.log('[build-apk] 3/4 Copying generated APK to downloads/GymCoach.apk...');
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
fs.copyFileSync(APK_SRC, APK_DEST);

const stats = fs.statSync(APK_DEST);
console.log(`[build-apk] ✅ Successfully built: downloads/GymCoach.apk (${(stats.size / (1024 * 1024)).toFixed(1)} MB)`);
