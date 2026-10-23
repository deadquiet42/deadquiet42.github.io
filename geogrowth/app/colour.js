(() => {
  const btn = document.getElementById("toggleColour");
  if (!btn) return;

  function sync() {
    const on = document.body.classList.contains("colour-mode");
    btn.checked = on;
  }

  btn.addEventListener("change", () => {
    document.body.classList.toggle("colour-mode", btn.checked);
    if (typeof window.restyleGeogrowth === "function") window.restyleGeogrowth();
  });

  sync();
})();
