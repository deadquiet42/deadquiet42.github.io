(() => {
  const btn = document.getElementById('invertToggle');
  if (!btn) return;

  function sync() {
    const on = document.body.classList.contains('gg-invert');
    btn.checked = on;
  }

  btn.addEventListener('change', () => {
    document.body.classList.toggle('gg-invert', btn.checked);
    if (typeof window.invertGeogrowth === "function") {
      window.invertGeogrowth();
    }
  });

  sync();
})();
