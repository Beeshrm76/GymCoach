// js/native-bridge.js — Capacitor native integration layer
// This file bridges the web app with native platform APIs when running
// inside the Capacitor shell. It gracefully no-ops when running in a browser.
//
// Capacitor exposes plugins on window.Capacitor.Plugins when loaded via
// <script> tags (no ESM import needed).

(() => {
  'use strict';

  // ── Detect Capacitor environment ──────────────────────────────
  const isNative = () =>
    typeof window !== 'undefined' &&
    window.Capacitor &&
    typeof window.Capacitor.isNativePlatform === 'function' &&
    window.Capacitor.isNativePlatform();

  const getPlatform = () =>
    (window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform()) || 'web';

  // Get plugin safely — Capacitor exposes them on Capacitor.Plugins
  function getPlugin(name) {
    try {
      return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins[name]) || null;
    } catch (_) { return null; }
  }

  // ── Wait for DOM ready ────────────────────────────────────────
  function whenReady(fn) {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      setTimeout(fn, 0);
    } else {
      document.addEventListener('DOMContentLoaded', fn);
    }
  }

  // ── Status Bar ────────────────────────────────────────────────
  function setupStatusBar() {
    if (!isNative()) return;
    const StatusBar = getPlugin('StatusBar');
    if (!StatusBar) return;

    try {
      StatusBar.setStyle({ style: 'DARK' });
      if (getPlatform() === 'android') {
        StatusBar.setBackgroundColor({ color: '#0d1117' });
        StatusBar.setOverlaysWebView({ overlay: false });
      }
    } catch (e) {
      console.warn('[native-bridge] StatusBar error:', e.message);
    }
  }

  // ── Splash Screen ────────────────────────────────────────────
  function hideSplash() {
    if (!isNative()) return;
    const SplashScreen = getPlugin('SplashScreen');
    if (!SplashScreen) return;

    try {
      SplashScreen.hide();
    } catch (e) {
      console.warn('[native-bridge] SplashScreen error:', e.message);
    }
  }

  // ── Hardware Back Button (Android) ───────────────────────────
  function setupBackButton() {
    if (!isNative()) return;
    const CapApp = getPlugin('App');
    if (!CapApp || !CapApp.addListener) return;

    try {
      CapApp.addListener('backButton', ({ canGoBack }) => {
        // If a modal/dialog/settings panel is open, close it
        const activeModal = document.querySelector(
          '.modal-overlay.active, .dialog-overlay.active, .settings-modal.open, .panel-overlay.active'
        );
        if (activeModal) {
          const closeBtn = activeModal.querySelector(
            '[data-action="close"], .modal-close, .dialog-close, [data-action="close-settings"]'
          );
          if (closeBtn) { closeBtn.click(); return; }
          activeModal.classList.remove('active', 'open');
          return;
        }

        // If the drawer is open on mobile, close it
        const body = document.body;
        if (body.classList.contains('drawer-open')) {
          const scrim = document.querySelector('.drawer-scrim');
          if (scrim) { scrim.click(); return; }
        }

        // If we're on a sub-view, go to Home
        const currentView = document.querySelector('.view:not([hidden])');
        if (currentView && currentView.id !== 'homeView') {
          const homeBtn = document.querySelector('[data-action="show-home"]');
          if (homeBtn) { homeBtn.click(); return; }
        }

        // Otherwise, minimise the app (don't exit abruptly)
        if (canGoBack) {
          window.history.back();
        } else if (CapApp.minimizeApp) {
          CapApp.minimizeApp();
        }
      });
    } catch (e) {
      console.warn('[native-bridge] BackButton error:', e.message);
    }
  }

  // ── Keyboard ─────────────────────────────────────────────────
  function setupKeyboard() {
    if (!isNative()) return;
    const Keyboard = getPlugin('Keyboard');
    if (!Keyboard || !Keyboard.addListener) return;

    try {
      Keyboard.addListener('keyboardWillShow', info => {
        document.body.style.setProperty('--keyboard-height', `${info.keyboardHeight}px`);
        document.body.classList.add('keyboard-open');
      });
      Keyboard.addListener('keyboardWillHide', () => {
        document.body.style.setProperty('--keyboard-height', '0px');
        document.body.classList.remove('keyboard-open');
      });
    } catch (e) {
      console.warn('[native-bridge] Keyboard error:', e.message);
    }
  }

  // ── Haptics — tactile feedback on interactive elements ───────
  function setupHaptics() {
    if (!isNative()) return;
    const Haptics = getPlugin('Haptics');
    if (!Haptics) return;

    try {
      // Light haptic on buttons and navigational taps
      document.addEventListener('click', (e) => {
        const el = e.target.closest('.btn, .tab, .nav-btn, .icon-btn, [data-action]');
        if (el) {
          Haptics.impact({ style: 'Light' }).catch(() => {});
        }
      }, { passive: true });

      // Medium haptic on completing a set (more satisfying feedback)
      document.addEventListener('click', (e) => {
        if (e.target.closest('.set-done-btn, .tick-btn, [data-action="tick-set"]')) {
          Haptics.impact({ style: 'Medium' }).catch(() => {});
        }
      }, { passive: true });

      // Expose globally so other modules can use it
      window.NativeHaptics = Haptics;
    } catch (e) {
      console.warn('[native-bridge] Haptics error:', e.message);
    }
  }

  // ── Safe Area CSS classes ────────────────────────────────────
  function setupSafeAreas() {
    if (!isNative()) return;
    const platform = getPlatform();
    document.documentElement.classList.add('capacitor-native');
    document.documentElement.classList.add(`capacitor-${platform}`);
  }

  // ── App Lifecycle (resume/pause) ─────────────────────────────
  function setupLifecycle() {
    if (!isNative()) return;
    const CapApp = getPlugin('App');
    if (!CapApp || !CapApp.addListener) return;

    try {
      CapApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) {
          // App resumed from background — trigger refresh
          document.dispatchEvent(new Event('visibilitychange'));
        }
      });

      // Handle deep links / URL opens
      CapApp.addListener('appUrlOpen', (event) => {
        try {
          const url = new URL(event.url);
          const hash = url.hash || '#home';
          window.location.hash = hash;
        } catch (_) {}
      });
    } catch (e) {
      // Lifecycle is optional
    }
  }

  // ── Init ─────────────────────────────────────────────────────
  whenReady(() => {
    if (!isNative()) {
      console.log('[native-bridge] Running in browser — native features disabled');
      return;
    }

    console.log(`[native-bridge] Running on ${getPlatform()} — initializing native features`);
    setupSafeAreas();
    setupStatusBar();
    setupKeyboard();
    setupBackButton();
    setupHaptics();
    setupLifecycle();

    // Hide splash screen after the UI has had time to paint
    setTimeout(() => hideSplash(), 400);
  });

  // ── Public API ───────────────────────────────────────────────
  window.NativeBridge = {
    isNative,
    getPlatform,
  };

})();
