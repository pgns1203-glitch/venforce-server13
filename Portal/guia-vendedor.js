(function () {
  // Inicializa topbar/sidebar do portal
  if (typeof window.initLayout === "function") {
    window.initLayout();
  }

  // Scroll reveal
  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("gv-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1, rootMargin: "0px 0px -50px 0px" }
  );

  document.querySelectorAll(".gv-reveal").forEach(function (el) {
    observer.observe(el);
  });
})();
