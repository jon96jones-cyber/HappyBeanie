/* Journal behaviour: reading progress, a contents rail that follows the
   reader, and reveal-on-scroll. All of it is enhancement — the page is
   complete and readable if this file never loads, and every effect is
   switched off for anyone who asked their system for reduced motion. */
(function () {
  var root = document.documentElement;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Arms the CSS that starts elements hidden. Set before paint, below.
  root.classList.add('js');
  if (reduced) return;

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    // ── Reading progress ──────────────────────────────────────
    var bar = document.querySelector('.progress i');
    var article = document.querySelector('article');
    if (bar && article) {
      var tick = function () {
        // Absolute document coordinates — offsetTop is relative to whichever
        // ancestor happens to be positioned, which the grid layout changes.
        var top = article.getBoundingClientRect().top + window.pageYOffset;
        // Full when the end of the article reaches the bottom of the viewport.
        var span = article.offsetHeight - window.innerHeight;
        var p = span > 40 ? (window.pageYOffset - top) / span : 1;
        bar.style.width = Math.max(0, Math.min(1, p)) * 100 + '%';
      };
      addEventListener('scroll', tick, { passive: true });
      addEventListener('resize', tick);
      tick();
    }

    // ── Reveal on scroll ──────────────────────────────────────
    var rises = document.querySelectorAll('.rise');
    if (rises.length && 'IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          e.target.classList.add('in');
          io.unobserve(e.target);
        });
      }, { rootMargin: '0px 0px -12% 0px', threshold: 0.05 });
      Array.prototype.forEach.call(rises, function (el, i) {
        // A short stagger so a row of cards arrives in sequence, not as a slab.
        el.style.transitionDelay = Math.min(i % 4, 3) * 70 + 'ms';
        io.observe(el);
      });
    } else {
      Array.prototype.forEach.call(rises, function (el) { el.classList.add('in'); });
    }

    // ── Contents rail follows the section you are reading ─────
    var links = document.querySelectorAll('.rail a');
    if (links.length && 'IntersectionObserver' in window) {
      var byId = {};
      Array.prototype.forEach.call(links, function (a) {
        byId[a.getAttribute('href').slice(1)] = a;
      });
      var heads = document.querySelectorAll('article h2[id]');
      var visible = [];
      var spy = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          var id = e.target.id;
          var at = visible.indexOf(id);
          if (e.isIntersecting && at === -1) visible.push(id);
          if (!e.isIntersecting && at !== -1) visible.splice(at, 1);
        });
        // Highlight the highest heading currently on screen; if none is, keep
        // the last one we passed rather than clearing the rail entirely.
        var pick = null;
        Array.prototype.forEach.call(heads, function (h) {
          if (!pick && visible.indexOf(h.id) !== -1) pick = h.id;
        });
        if (!pick) {
          var y = window.pageYOffset + 90;
          Array.prototype.forEach.call(heads, function (h) {
            if (h.offsetTop <= y) pick = h.id;
          });
        }
        Array.prototype.forEach.call(links, function (a) { a.classList.remove('on'); });
        if (pick && byId[pick]) byId[pick].classList.add('on');
      }, { rootMargin: '-80px 0px -55% 0px', threshold: 0 });
      Array.prototype.forEach.call(heads, function (h) { spy.observe(h); });
    }

    // ── Hero card tilts toward the cursor ─────────────────────
    var art = document.querySelector('.hero-art');
    if (art && matchMedia('(hover:hover) and (min-width:861px)').matches) {
      var card = art.querySelector('figure');
      var raf = null, tx = -7, ty = 2.5;
      art.addEventListener('mousemove', function (e) {
        var r = art.getBoundingClientRect();
        tx = -7 + ((e.clientX - r.left) / r.width - 0.5) * 9;
        ty = 2.5 - ((e.clientY - r.top) / r.height - 0.5) * 7;
        if (raf) return;
        raf = requestAnimationFrame(function () {
          raf = null;
          card.style.transition = 'transform .25s cubic-bezier(.2,.7,.2,1)';
          card.style.transform = 'rotateY(' + tx + 'deg) rotateX(' + ty + 'deg) rotateZ(-0.6deg) translateY(-4px)';
        });
      });
      art.addEventListener('mouseleave', function () {
        card.style.transition = 'transform .9s cubic-bezier(.2,.7,.2,1)';
        card.style.transform = '';
      });
    }
  });
})();
