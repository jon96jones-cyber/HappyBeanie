// Entrance on page load.
//
// Every address is its own document now, so a page used to land all at
// once. This lifts it in instead: the blocks in view rise with a short
// stagger, and blocks below the fold rise when they scroll into view.
//
// Web Animations rather than a class or an inline style, because the
// storefront runtime rewrites an element's attributes on re-render, which
// would drop either mid-animation. An animation is attached to the node
// and survives that. It fills backwards only, so an element ends in its
// own natural state with no transform left behind to catch a fixed
// descendant. Fixed and sticky elements fade without moving.
//
// Static pages paint progressively while they parse, so they hide their
// body in <head> (html.hb-pre) until this runs; the storefront renders
// from script, so there is nothing to hide there. Reduced motion, or a
// browser without the APIs: nothing moves and the page shows at once.
(function () {
  var html = document.documentElement;
  function release() { html.classList.remove('hb-pre'); }

  var reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  if (reduced || !('animate' in Element.prototype) || !('IntersectionObserver' in window)) { release(); return; }

  var EASE = 'cubic-bezier(0.2, 0.7, 0.2, 1)';
  var DURATION = 650, STEP = 80, MAX_DELAY = 480, LIFT = 18;
  var SKIP_TAG = { SCRIPT: 1, STYLE: 1, LINK: 1, TEMPLATE: 1, NOSCRIPT: 1 };
  var SKIP_ID = { hbLoad: 1, hbScrim: 1, hbPopup: 1 };
  var LOOK_THROUGH = /(^|\s)(wrap|shell)(\s|$)/;

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      io.unobserve(en.target);
      var a = en.target.__hbEnter;
      if (a) { en.target.__hbEnter = null; a.play(); }
    });
  }, { rootMargin: '0px 0px -6% 0px' });

  // A bare wrapper is looked through so its children animate as the
  // sections they are: <main>, the .wrap and .shell containers, and a div
  // with no styling hooks of its own.
  function bare(el) {
    if (el.tagName === 'MAIN') return true;
    if (el.tagName !== 'DIV') return false;
    var cls = typeof el.className === 'string' ? el.className : '';
    if (LOOK_THROUGH.test(cls)) return true;
    return !el.id && !cls && !el.getAttribute('style') && !el.getAttribute('data-m');
  }

  function collect(root, depth, out) {
    for (var i = 0; i < root.children.length; i++) {
      var c = root.children[i];
      if (SKIP_TAG[c.tagName] || SKIP_ID[c.id]) continue;
      if (depth < 3 && c.children.length && bare(c)) collect(c, depth + 1, out);
      else out.push(c);
    }
    return out;
  }

  function run(root) {
    var els = collect(root, 0, []);
    var vh = window.innerHeight, delay = 0;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var r = el.getBoundingClientRect();
      if (r.height < 1 && r.width < 1) continue;
      var pos = window.getComputedStyle(el).position;
      var pinned = pos === 'fixed' || pos === 'sticky';
      var inView = pinned || (r.top < vh && r.bottom > 0);
      var frames = pinned
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [{ opacity: 0, transform: 'translateY(' + LIFT + 'px)' }, { opacity: 1, transform: 'translateY(0)' }];
      var a = el.animate(frames, { duration: DURATION, delay: inView ? delay : 0, easing: EASE, fill: 'backwards' });
      if (inView) {
        delay = Math.min(delay + STEP, MAX_DELAY);
      } else {
        a.pause();
        el.__hbEnter = a;
        io.observe(el);
      }
    }
    release();
  }

  // The storefront renders into #dc-root after DOMContentLoaded. Its page is
  // the deepest element with more than one child under that root.
  function storefrontPage() {
    var r = document.getElementById('dc-root');
    if (!r) return null;
    while (r.children.length === 1) r = r.children[0];
    return r.children.length > 1 ? r : null;
  }

  var isStorefront = !!(document.getElementById('dc-root') || document.querySelector('x-dc'));
  if (!isStorefront) { run(document.body); return; }

  var page = storefrontPage();
  if (page) { run(page); return; }
  var done = false;
  var mo = new MutationObserver(function () {
    var p = storefrontPage();
    if (!p || done) return;
    done = true; mo.disconnect(); run(p);
  });
  mo.observe(document.body, { childList: true, subtree: true });
  setTimeout(function () { if (!done) { done = true; mo.disconnect(); release(); } }, 4000);
})();
