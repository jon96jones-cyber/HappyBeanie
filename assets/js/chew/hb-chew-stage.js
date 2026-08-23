// <hb-chew-stage> — reusable 3D chew viewer (wraps <three-d-stage>).
// API: el.setCut(bool), el.setSel(index|-1). Dispatches 'hb-togglecut' on tap.
(function () {
  const COLS = ['#d9a441', '#d97e2f', '#b09877', '#e5d9c0', '#7a3b2e', '#6b4d8f', '#e3c34e', '#c96a2d', '#d8a29a', '#efe6d4'];
  class HBChewStage extends HTMLElement {
    connectedCallback() {
      if (this._init) return;
      this._init = true;
      this._dead = false;
      this._cutTarget = 0;
      this._selIdx = -1;
      this.setCut = v => { this._cutTarget = v ? 1 : 0; };
      this.setSel = i => { this._selIdx = (typeof i === 'number' ? i : -1); };
      this.resetView = () => {
        this._cutTarget = 0;
        this._selIdx = -1;
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
      stage._renderer.localClippingEnabled = true;
      hideChrome();

      const { buildBean } = await import('/assets/js/chew/hb-box-model.js');
      if (this._dead) return;
      const { shape, geo } = buildBean(THREE);

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
      for (let i = 0; i < 1700; i++) oSpecks.push({ x: rndo(), y: rndo(), r: 0.5 + rndo() * 1.0, o: 0.6 + rndo() * 0.38, warm: rndo() < 0.12 });
      for (let i = 0; i < 64; i++) oPores.push({ x: rndo(), y: rndo(), r: 1.2 + rndo() * 1.8, o: 0.5 + rndo() * 0.3 });
      const speckle = canvasTex(1024, 1024, (x, w, h) => {
        x.fillStyle = '#94714e'; x.fillRect(0, 0, w, h);
        for (let i = 0; i < 24; i++) {
          const bx = rndo() * w, by = rndo() * h, br = 90 + rndo() * 220;
          const g2 = x.createRadialGradient(bx, by, 0, bx, by, br);
          const warm2 = rndo() < 0.5;
          g2.addColorStop(0, warm2 ? 'rgba(150,113,79,0.18)' : 'rgba(96,68,45,0.16)');
          g2.addColorStop(1, 'rgba(0,0,0,0)');
          x.fillStyle = g2; x.fillRect(bx - br, by - br, br * 2, br * 2);
        }
        for (let i = 0; i < 8000; i++) {
          x.fillStyle = rndo() < 0.5 ? 'rgba(52,35,20,0.04)' : 'rgba(220,198,168,0.035)';
          x.fillRect(rndo() * w, rndo() * h, 1.4, 1.4);
        }
        oSpecks.forEach(s2 => {
          x.fillStyle = s2.warm ? 'rgba(226,190,132,' + s2.o.toFixed(2) + ')' : 'rgba(246,240,228,' + s2.o.toFixed(2) + ')';
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

      const cols = COLS;
      let sd9 = 99;
      const rnd9 = () => (sd9 = (sd9 * 1103515245 + 12345) % 2147483648) / 2147483648;
      const blotches = [], streaks = [], pores = [], sprinkles = [];
      for (let i = 0; i < 26; i++) blotches.push({ x: rnd9(), y: rnd9(), r: 60 + rnd9() * 180, d: rnd9() });
      for (let i = 0; i < 260; i++) streaks.push({ x: rnd9(), y: rnd9(), a: rnd9() * 6.3, l: 8 + rnd9() * 26, o: 0.04 + rnd9() * 0.06, d: rnd9() < 0.5 });
      for (let i = 0; i < 3400; i++) pores.push({ x: rnd9(), y: rnd9(), r: 0.5 + rnd9() * 2.2, o: 0.08 + rnd9() * 0.2 });
      for (let i = 0; i < 640; i++) sprinkles.push({ x: rnd9(), y: rnd9(), a: rnd9() * 6.3, rw: 2.2 + rnd9() * 5.5, rh: 1.4 + rnd9() * 2.8, c: i % 10, v: rnd9() });
      const shade = (hex, f) => {
        const n = parseInt(hex.slice(1), 16);
        const ch = s2 => Math.max(0, Math.min(255, Math.round(((n >> s2) & 255) * f)));
        return 'rgb(' + ch(16) + ',' + ch(8) + ',' + ch(0) + ')';
      };
      const cutTex = canvasTex(1024, 1024, (x, w, h) => {
        x.fillStyle = '#78573d'; x.fillRect(0, 0, w, h);
        blotches.forEach(b => {
          const g2 = x.createRadialGradient(b.x * w, b.y * h, 0, b.x * w, b.y * h, b.r);
          const c2 = b.d < 0.5 ? '100,74,50' : '134,102,72';
          g2.addColorStop(0, 'rgba(' + c2 + ',0.32)');
          g2.addColorStop(1, 'rgba(' + c2 + ',0)');
          x.fillStyle = g2;
          x.fillRect(b.x * w - b.r, b.y * h - b.r, b.r * 2, b.r * 2);
        });
        x.lineWidth = 1.2;
        streaks.forEach(s2 => {
          x.strokeStyle = s2.d ? 'rgba(58,40,24,' + s2.o.toFixed(2) + ')' : 'rgba(196,168,132,' + s2.o.toFixed(2) + ')';
          x.beginPath();
          x.moveTo(s2.x * w, s2.y * h);
          x.lineTo(s2.x * w + Math.cos(s2.a) * s2.l, s2.y * h + Math.sin(s2.a) * s2.l);
          x.stroke();
        });
        pores.forEach(p => {
          x.fillStyle = 'rgba(52,36,20,' + p.o.toFixed(2) + ')';
          x.beginPath(); x.arc(p.x * w, p.y * h, p.r, 0, 6.3); x.fill();
        });
        sprinkles.forEach(s2 => {
          x.save();
          x.translate(s2.x * w, s2.y * h);
          x.rotate(s2.a);
          x.fillStyle = 'rgba(45,30,16,0.28)';
          x.beginPath(); x.ellipse(0.6, 0.7, s2.rw + 0.9, s2.rh + 0.8, 0, 0, 6.3); x.fill();
          x.globalAlpha = 0.66 + s2.v * 0.28;
          x.fillStyle = shade(cols[s2.c], 0.72 + s2.v * 0.3);
          x.beginPath(); x.ellipse(0, 0, s2.rw, s2.rh, 0, 0, 6.3); x.fill();
          x.globalAlpha = 1;
          x.restore();
        });
        for (let i = 0; i < 9000; i++) {
          const gx = rnd9() * w, gy = rnd9() * h;
          x.fillStyle = rnd9() < 0.55 ? 'rgba(38,25,13,0.07)' : 'rgba(214,192,160,0.055)';
          x.fillRect(gx, gy, 1.2, 1.2);
        }
      });
      cutTex.repeat.set(1 / 2.6, 1 / 1.8);
      cutTex.offset.set(0.5, 0.52);
      const cutBump = canvasTex(1024, 1024, (x, w, h) => {
        x.fillStyle = '#808080'; x.fillRect(0, 0, w, h);
        pores.forEach(p => {
          x.fillStyle = 'rgba(30,30,30,' + (p.o * 2).toFixed(2) + ')';
          x.beginPath(); x.arc(p.x * w, p.y * h, p.r, 0, 6.3); x.fill();
        });
        sprinkles.forEach(s2 => {
          x.save();
          x.translate(s2.x * w, s2.y * h);
          x.rotate(s2.a);
          x.fillStyle = 'rgba(50,50,50,0.7)';
          x.beginPath(); x.ellipse(0.9, 1.1, s2.rw + 1.4, s2.rh + 1.2, 0, 0, 6.3); x.fill();
          x.fillStyle = 'rgba(215,215,215,0.9)';
          x.beginPath(); x.ellipse(0, 0, s2.rw, s2.rh, 0, 0, 6.3); x.fill();
          x.restore();
        });
      });
      cutBump.repeat.copy(cutTex.repeat);
      cutBump.offset.copy(cutTex.offset);

      const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0.02);
      const mExt = new THREE.MeshStandardMaterial({ name: 'ChewOuter', map: speckle, bumpMap: outerBump, bumpScale: 0.0011, roughness: 0.5, metalness: 0, clippingPlanes: [plane], clipShadows: true, side: THREE.DoubleSide });
      mExt.envMapIntensity = 1.35;
      const mCut = new THREE.MeshStandardMaterial({ name: 'ChewCut', map: cutTex, bumpMap: cutBump, bumpScale: 0.0012, roughness: 0.92, metalness: 0 });

      const model = new THREE.Group();
      model.name = 'HappyBeanieChew';
      const bean = new THREE.Mesh(geo, mExt);
      bean.name = 'Chew';
      bean.scale.set(0.0128, 0.0232, 0.0128);
      model.add(bean);

      const capGeo = new THREE.ShapeGeometry(shape, 48);
      capGeo.rotateX(-Math.PI / 2);
      capGeo.rotateY(Math.PI);
      capGeo.center();
      const cap = new THREE.Mesh(capGeo, mCut);
      cap.name = 'ChewCrossSection';
      cap.scale.set(0.0128 * 1.09, 1, 0.0128 * 1.09);
      cap.position.y = 0.00005;
      cap.visible = false;
      model.add(cap);

      const poly = shape.getPoints(48);
      const inside = (px2, py2) => {
        let ok = false;
        for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
          if ((poly[a].y > py2) !== (poly[b].y > py2) &&
              px2 < (poly[b].x - poly[a].x) * (py2 - poly[a].y) / (poly[b].y - poly[a].y) + poly[a].x) ok = !ok;
        }
        return ok;
      };
      let sd2 = 4242;
      const rnd2 = () => (sd2 = (sd2 * 1103515245 + 12345) % 2147483648) / 2147483648;
      const fleckGeo = new THREE.SphereGeometry(1, 10, 8);
      const fleckGroups = cols.map((col, i) => {
        const g = new THREE.Group();
        g.name = 'Flecks_' + (i + 1);
        const mFleck = new THREE.MeshStandardMaterial({ name: 'Fleck_' + (i + 1), color: col, roughness: 0.5, metalness: 0 });
        let placed = 0, guard = 0;
        while (placed < 7 && guard++ < 400) {
          const sx = -1.3 + rnd2() * 2.6, sy = -0.95 + rnd2() * 1.75;
          const mx = sx * 1.22, my = -0.05 + (sy + 0.05) * 1.22;
          if (!inside(sx, sy) || !inside(mx, my)) continue;
          const f = new THREE.Mesh(fleckGeo, mFleck);
          const r = 0.00025 + rnd2() * 0.0002;
          f.scale.set(r, r * 0.35, r * 0.6);
          f.rotation.y = rnd2() * 6.3;
          f.position.set(-sx * 0.0128, 0, sy * 0.0128);
          g.add(f);
          placed++;
        }
        g.userData.cur = 0;
        g.visible = false;
        model.add(g);
        return g;
      });
      model.rotation.y = Math.PI * 1.38;
      stage.setObject(model);
      if (this._readyRes) this._readyRes();

      const self = this;
      let cutCur = 0;
      const TOP = 0.0085, MID = 0.00008;
      plane.constant = TOP;
      const tick = () => {
        if (self._dead) return;
        const t0 = self._cutTarget || 0;
        if (Math.abs(t0 - cutCur) > 0.002) {
          cutCur += (t0 - cutCur) * 0.1;
          plane.constant = TOP + (MID - TOP) * cutCur;
          cap.visible = cutCur > 0.55;
        } else if (t0 === 1 && !cap.visible) {
          cap.visible = true;
        }
        const sel = self._selIdx;
        fleckGroups.forEach((g, i) => {
          const tg = (cutCur > 0.8 && sel === i) ? 1 : 0;
          g.userData.cur += (tg - g.userData.cur) * 0.09;
          const cur2 = g.userData.cur;
          g.visible = cur2 > 0.05;
          g.position.y = -0.0006 + cur2 * 0.0012;
        });
      };
      bean.onBeforeRender = tick;

      const canvas = stage._renderer.domElement;
      let px = 0, py = 0;
      canvas.addEventListener('pointerdown', e => { px = e.clientX; py = e.clientY; });
      canvas.addEventListener('pointerup', e => {
        if (Math.hypot(e.clientX - px, e.clientY - py) < 5) self.dispatchEvent(new CustomEvent('hb-togglecut', { bubbles: true }));
      });
    }
  }
  if (!customElements.get('hb-chew-stage')) customElements.define('hb-chew-stage', HBChewStage);
})();
