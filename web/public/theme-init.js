// Runs synchronously in <head>, before the app bundle and before first paint,
// so the page never flashes the wrong theme. A saved choice wins; otherwise
// follow the OS. Kept as an external file because the CSP allows only
// script-src 'self' — an inline snippet would be blocked.
(function () {
  var theme;
  try {
    theme = (JSON.parse(localStorage.getItem("mychat.prefs")) || {}).theme;
  } catch (e) {
    /* first visit or unreadable storage */
  }
  if (theme !== "light" && theme !== "dark") {
    theme =
      window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark";
  }
  document.documentElement.dataset.theme = theme;
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === "light" ? "#f5f6fa" : "#0f1117";
})();
