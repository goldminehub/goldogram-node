'use strict';

/**
 * Loads before the main inline renderer script so a SyntaxError there still
 * surfaces a visible error (same-script handlers never run on parse failure).
 */
(function () {
  function paint(source, message, stack) {
    try {
      var overlay = document.getElementById('fatal-error-overlay');
      var textEl = document.getElementById('fatal-error-text');
      var full =
        (source ? '[' + source + '] ' : '') +
        String(message || 'Unknown error') +
        (stack ? '\n\n' + stack : '');
      if (textEl) textEl.textContent = full;
      if (overlay) overlay.style.display = 'flex';
      if (window.node && window.node.reportError) {
        window.node.reportError({
          source: source || 'boot_guard',
          message: String(message || ''),
          stack: stack || '',
        });
      }
    } catch (_) {
      /* ignore */
    }
  }

  window.showFatalError = paint;

  window.addEventListener('error', function (ev) {
    var msg = (ev && ev.message) || 'Script error';
    // Ignore non-script / empty noise (GPU, missing sourcemaps).
    if (!msg || msg === 'Script error.' || /ResizeObserver|GpuControl|ozone/i.test(msg)) return;
    if (ev && ev.filename === '' && !ev.error) return;
    var stack = ev && ev.error && ev.error.stack ? ev.error.stack : '';
    var where =
      (ev && ev.filename ? ev.filename : '') +
      (ev && ev.lineno ? ':' + ev.lineno : '');
    paint('script-error', msg + (where ? ' @ ' + where : ''), stack);
  });

  window.addEventListener('unhandledrejection', function (ev) {
    var reason = ev && ev.reason;
    var msg = reason && reason.message ? reason.message : String(reason);
    var stack = reason && reason.stack ? reason.stack : '';
    paint('unhandledrejection', msg, stack);
  });

  window.addEventListener('DOMContentLoaded', function () {
    var missing = [];
    if (!window.node) missing.push('node');
    if (!window.miner) missing.push('miner');
    if (!window.updater) missing.push('updater');
    if (!window.gogAddress) missing.push('gogAddress');
    if (!missing.length) return;
    paint(
      'preload',
      'Desktop bridge missing: window.' + missing.join(', window.')
        + '. Preload did not load. Reinstall Goldogram Node.',
      ''
    );
  });
})();
