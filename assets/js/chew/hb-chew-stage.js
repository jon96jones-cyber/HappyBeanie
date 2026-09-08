// <hb-chew-stage> — reusable 3D chew viewer (wraps <three-d-stage>).
// The chew turns on its stage and that is the whole show: the cut-open
// cross-section was retired by design. setCut/setSel stay as no-ops because
// the host page still calls them from the ingredient list; resetView()
// restarts the idle spin after a drag.
(function () {
  class HBChewStage extends HTMLElement {
    connectedCallback() {
      if (this._init) return;
      this._init = true;
      this._dead = false;
      this.setCut = () => {};
      this.setSel = () => {};
      this.resetView = () => {
        if (this._stage && this._stage._controls) this._stage._controls.autoRotate = true;
      };
      // Resolves once the chew model is actually in the scene — the host page
      // holds its photo view until then, so the shopper never stares at an
      // empty stage while three.js downloads.
      this.ready = new Promise((res, rej) => { this._readyRes = res; this._readyRej = rej; });
      // A failed boot (module blocked, WebGL unavailable) must reject ready —
      // the host page falls back to the photo view on rejection, so a hung
      // "Preparing 3D view" can never be the end state.
      this._setup().catch(err => {
        console.error('[hb-chew-stage] 3D view failed to start:', err);
        if (this._readyRej) this._readyRej(err);
      });
    }
    disconnectedCallback() { this._dead = true; }
    async _setup() {
      this.style.display = 'block';
      if (getComputedStyle(this).position === 'static') this.style.position = 'relative';
      const stage = document.createElement('three-d-stage');
      stage.setAttribute('name', 'happy-beanie-chew');
      stage.setAttribute('background', this.getAttribute('background') || '#EDE6D5');
      stage.setAttribute('autorotate', 'autorotate');
      stage.style.cssText = 'position:absolute;inset:0;display:block;width:100%;height:100%;';
      // The stage builds its viewer chrome (orbit-help note, OBJ/GLB download
      // toolbar) in its constructor, so it must be stripped before the element
      // is ever attached — waiting for stage.ready leaves it on screen for the
      // whole module download on a slow connection.
      const hideChrome = () => {
        if (!stage.shadowRoot) return;
        const note = stage.shadowRoot.querySelector('.note');
        if (note) note.style.display = 'none';
        if (stage._toolbar) stage._toolbar.style.display = 'none';
      };
      hideChrome();
      this.appendChild(stage);
      this._stage = stage;
      const { THREE } = await stage.ready;
      if (this._dead) return;
      stage._controls.enableZoom = false;
      stage._controls.enablePan = false;
      stage._controls.autoRotateSpeed = 1.1;
      hideChrome();

      const { buildBean } = await import('/assets/js/chew/hb-box-model.js?v=5');
      if (this._dead) return;
      const { geo } = buildBean(THREE);

      const canvasTex = (w, h, draw) => {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const x = c.getContext('2d');
        draw(x, w, h);
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        return t;
      };
      let sdo = 7;
      const rndo = () => (sdo = (sdo * 1103515245 + 12345) % 2147483648) / 2147483648;
      const oSpecks = [], oPores = [];
      for (let i = 0; i < 760; i++) oSpecks.push({ x: rndo(), y: rndo(), r: 0.7 + rndo() * 1.2, o: 0.62 + rndo() * 0.32, warm: rndo() < 0.1 });
      for (let i = 0; i < 88; i++) oPores.push({ x: rndo(), y: rndo(), r: 1.1 + rndo() * 1.9, o: 0.5 + rndo() * 0.3 });
      const speckle = canvasTex(1024, 1024, (x, w, h) => {
        x.fillStyle = '#7a5334'; x.fillRect(0, 0, w, h);
        for (let i = 0; i < 24; i++) {
          const bx = rndo() * w, by = rndo() * h, br = 90 + rndo() * 220;
          const g2 = x.createRadialGradient(bx, by, 0, bx, by, br);
          const warm2 = rndo() < 0.5;
          g2.addColorStop(0, warm2 ? 'rgba(158,113,72,0.22)' : 'rgba(74,46,26,0.20)');
          g2.addColorStop(1, 'rgba(0,0,0,0)');
          x.fillStyle = g2; x.fillRect(bx - br, by - br, br * 2, br * 2);
        }
        for (let i = 0; i < 8000; i++) {
          x.fillStyle = rndo() < 0.5 ? 'rgba(40,24,12,0.05)' : 'rgba(214,186,150,0.03)';
          x.fillRect(rndo() * w, rndo() * h, 1.4, 1.4);
        }
        oSpecks.forEach(s2 => {
          x.fillStyle = s2.warm ? 'rgba(230,196,138,' + s2.o.toFixed(2) + ')' : 'rgba(248,242,230,' + s2.o.toFixed(2) + ')';
          x.beginPath(); x.arc(s2.x * w, s2.y * h, s2.r * 2.1, 0, 6.3); x.fill();
        });
        oPores.forEach(p => {
          x.fillStyle = 'rgba(40,26,14,' + p.o.toFixed(2) + ')';
          x.beginPath(); x.ellipse(p.x * w, p.y * h, p.r * 1.6, p.r * 1.25, 0.6, 0, 6.3); x.fill();
          x.fillStyle = 'rgba(178,143,105,' + (p.o * 0.55).toFixed(2) + ')';
          x.beginPath(); x.ellipse(p.x * w, p.y * h + p.r * 1.5, p.r * 1.3, p.r * 0.4, 0, 0, 6.3); x.fill();
        });
      });
      speckle.wrapS = speckle.wrapT = THREE.RepeatWrapping;
      speckle.repeat.set(1.2, 1.2);
      const outerBump = canvasTex(1024, 1024, (x, w, h) => {
        x.fillStyle = '#808080'; x.fillRect(0, 0, w, h);
        for (let i = 0; i < 6000; i++) {
          x.fillStyle = rndo() < 0.5 ? 'rgba(70,70,70,0.1)' : 'rgba(150,150,150,0.09)';
          x.fillRect(rndo() * w, rndo() * h, 1.8, 1.8);
        }
        oSpecks.forEach(s2 => {
          x.fillStyle = 'rgba(175,175,175,0.6)';
          x.beginPath(); x.arc(s2.x * w, s2.y * h, s2.r * 2.1, 0, 6.3); x.fill();
        });
        oPores.forEach(p => {
          x.fillStyle = 'rgba(22,22,22,0.9)';
          x.beginPath(); x.ellipse(p.x * w, p.y * h, p.r * 1.6, p.r * 1.25, 0.6, 0, 6.3); x.fill();
        });
      });
      outerBump.wrapS = outerBump.wrapT = THREE.RepeatWrapping;
      outerBump.repeat.set(1.2, 1.2);

      const mExt = new THREE.MeshStandardMaterial({ name: 'ChewOuter', map: speckle, bumpMap: outerBump, bumpScale: 0.0013, roughness: 0.4, metalness: 0 });
      mExt.envMapIntensity = 1.55;

      const model = new THREE.Group();
      model.name = 'HappyBeanieChew';
      const bean = new THREE.Mesh(geo, mExt);
      bean.name = 'Chew';
      bean.scale.set(0.0128, 0.0198, 0.0128);
      model.add(bean);
      model.rotation.y = -0.55;
      stage.setObject(model);
      if (this._readyRes) this._readyRes();
    }
  }
  if (!customElements.get('hb-chew-stage')) customElements.define('hb-chew-stage', HBChewStage);
})();
