// No image on this site is draggable.
//
// The browser's native image drag lifts a translucent ghost copy out of the
// page and walks it around under the cursor. Inside the capture popup that
// looked like a rendering fault — a second Summer floating over the site — and
// nowhere else does it do anything a visitor wants. A product shot being
// draggable off the page is not a feature.
//
// Delegated from the document in the capture phase, so it covers images that
// do not exist yet: this is a single-page app that rebuilds its DOM constantly
// and mounts the popup long after this file runs.
//
// dragstart ONLY. dragover and drop are deliberately untouched, so dropping a
// file into the page still works — those come from outside the document and
// never involve a dragstart, so the two do not overlap.
(function () {
  var SEL = 'img, picture, svg, image-slot, video';

  document.addEventListener('dragstart', function (e) {
    var t = e.target;
    if (t && t.nodeType === 1 && t.closest && t.closest(SEL)) e.preventDefault();
  }, true);

  // The listener cancels the drag, but only after the browser has already shown
  // the grab cursor and begun the gesture. This stops it looking draggable in
  // the first place. WebKit and Blink honour it; Firefox does not, which is why
  // the listener above is the actual guarantee rather than a fallback.
  try {
    var s = document.createElement('style');
    s.textContent = SEL.split(', ').map(function (x) {
      return x + '{-webkit-user-drag:none;-khtml-user-drag:none;user-drag:none;}';
    }).join('');
    (document.head || document.documentElement).appendChild(s);
  } catch (e) {}
})();
