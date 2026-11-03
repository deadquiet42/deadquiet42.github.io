// Plays each looping video only while it is on screen.
// Anyone who has asked for reduced motion keeps the still poster.
(function () {
  var videos = document.querySelectorAll('video.loop');
  var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (calm || !('IntersectionObserver' in window)) return;
  var seen = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      var v = e.target;
      if (e.isIntersecting) {
        if (!v.src) v.src = v.dataset.src;
        var p = v.play();
        if (p && p.catch) p.catch(function () {});
      } else if (v.src) {
        v.pause();
      }
    });
  }, { rootMargin: '120px 0px' });
  videos.forEach(function (v) { seen.observe(v); });
})();
