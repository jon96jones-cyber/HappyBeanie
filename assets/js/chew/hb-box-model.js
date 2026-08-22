// Happy Beanie rigid box — shared three.js builder (adapted from the packaging design).
// Usage: const { buildBox } = await import('./hb-box-model.js');
export async function buildBox(THREE, { logo, paw, species = 'dog', actives = [] }) {
  const IN = 0.0254, L = 9.5 * IN, W = 6 * IN, H = 1.5 * IN, T = 0.003;
  const BLACK = '#18150f', CREAM = '#efece3', GOLD = '#b68235';
  const HEAD = '"Cormorant Garamond", Georgia, serif';
  const BODY = 'Lora, Georgia, serif';
  const IW = logo ? (logo.naturalWidth || logo.width) : 0;
  const IH = logo ? (logo.naturalHeight || logo.height) : 0;

  const mask = (() => {
    if (!logo) return null;
    const c = document.createElement('canvas'); c.width = IW; c.height = IH;
    const g = c.getContext('2d'); g.drawImage(logo, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height), p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      const lum = p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114;
      p[i] = 255; p[i + 1] = 255; p[i + 2] = 255;
      p[i + 3] = Math.max(0, Math.min(255, (lum - 40) * 1.7));
    }
    g.putImageData(d, 0, 0); return c;
  })();
  const logoColor = (() => {
    if (!logo || !mask) return logo;
    const c = document.createElement('canvas'); c.width = mask.width; c.height = mask.height;
    const g = c.getContext('2d'); g.drawImage(logo, 0, 0);
    g.globalCompositeOperation = 'destination-in'; g.drawImage(mask, 0, 0);
    return c;
  })();
  const tint = (color) => {
    if (!mask) return null;
    const c = document.createElement('canvas'); c.width = mask.width; c.height = mask.height;
    const g = c.getContext('2d'); g.drawImage(mask, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color; g.fillRect(0, 0, c.width, c.height);
    return c;
  };
  const logoInk = tint('#2b2721');
  const pawInk = (() => {
    if (!paw) return null;
    const c = document.createElement('canvas');
    c.width = paw.naturalWidth || paw.width; c.height = paw.naturalHeight || paw.height;
    const g = c.getContext('2d'); g.drawImage(paw, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height), p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      const lum = p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114;
      p[i] = 0xef; p[i + 1] = 0xec; p[i + 2] = 0xe3;
      p[i + 3] = Math.max(0, Math.min(255, (200 - lum) * 1.6));
    }
    g.putImageData(d, 0, 0); return c;
  })();

  const canvasTex = (w, h, draw) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); x.textBaseline = 'middle';
    draw(x, w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return t;
  };
  const drawLogo = (x, cx, cy, w) => {
    if (!logo) {
      x.fillStyle = CREAM; x.font = '500 ' + (w * 0.17) + 'px ' + HEAD;
      x.textAlign = 'center'; x.fillText('Happy Beanie', cx, cy);
      return w * 0.34;
    }
    const h = w * (IH / IW);
    x.drawImage(logoColor, cx - w / 2, cy - h / 2, w, h);
    return h;
  };
  const qrCells = (() => {
    const N = 25, cells = [], finder = (ox, oy) => {
      for (let y = 0; y < 7; y++) for (let x2 = 0; x2 < 7; x2++) {
        const edge = x2 === 0 || y === 0 || x2 === 6 || y === 6;
        const core = x2 > 1 && x2 < 5 && y > 1 && y < 5;
        if (edge || core) cells.push([ox + x2, oy + y]);
      }
    };
    finder(0, 0); finder(N - 7, 0); finder(0, N - 7);
    let sd = 20260808;
    const rnd = () => (sd = (sd * 1103515245 + 12345) % 2147483648) / 2147483648;
    const inFinder = (x2, y) => (x2 < 8 && y < 8) || (x2 > N - 9 && y < 8) || (x2 < 8 && y > N - 9);
    for (let y = 0; y < N; y++) for (let x2 = 0; x2 < N; x2++) {
      if (inFinder(x2, y)) continue;
      if (rnd() > 0.52) cells.push([x2, y]);
    }
    return { N, cells };
  })();
  const drawQR = (x, px, py, size) => {
    const { N, cells } = qrCells, u = size / N;
    x.fillStyle = '#f4f3f2'; x.fillRect(px - u, py - u, size + u * 2, size + u * 2);
    x.fillStyle = '#201f1d';
    for (const [cx, cy] of cells) x.fillRect(px + cx * u, py + cy * u, u * 1.02, u * 1.02);
  };

  const lidTopTex = (sp) => canvasTex(2048, 1293, (x, w, h) => {
    x.fillStyle = BLACK; x.fillRect(0, 0, w, h);
    const lh = drawLogo(x, w / 2, h * 0.255, w * 0.56);
    const ruleY = h * 0.255 + lh / 2 + h * 0.045;
    const g = x.createLinearGradient(w * 0.22, 0, w * 0.78, 0);
    g.addColorStop(0, 'rgba(182,130,53,0)'); g.addColorStop(0.5, GOLD); g.addColorStop(1, 'rgba(182,130,53,0)');
    x.fillStyle = g; x.fillRect(w * 0.22, ruleY, w * 0.56, 2.5);
    x.beginPath(); x.arc(w / 2, ruleY + 1, 8, 0, 6.3); x.fillStyle = GOLD; x.fill();
    x.textAlign = 'center'; x.fillStyle = CREAM;
    x.font = '400 ' + (h * 0.078) + 'px ' + BODY;
    x.fillText('Hormone Health', w / 2, ruleY + h * 0.105);
    x.font = '400 ' + (h * 0.050) + 'px ' + BODY; x.letterSpacing = '3px';
    x.fillText(sp === 'cat' ? 'FOR CATS' : 'FOR DOGS', w / 2, ruleY + h * 0.185);
    x.letterSpacing = '0px';
    const chipY = ruleY + h * 0.275, chipFs = h * 0.030, hgFs = h * 0.048;
    x.textAlign = 'left';
    x.font = '400 ' + chipFs + 'px ' + BODY; x.letterSpacing = '2px';
    const chipTw = x.measureText('DAILY SUPPLEMENT').width;
    x.letterSpacing = '0px';
    x.font = '400 ' + hgFs + 'px ' + BODY;
    const hgTw = x.measureText('Human-Grade').width;
    const padX = h * 0.016, gap = h * 0.020;
    const chipW = chipTw + padX * 2, chipH = chipFs * 1.85;
    const cx0 = (w - (chipW + gap + hgTw)) / 2;
    x.fillStyle = CREAM; x.fillRect(cx0, chipY - chipH / 2, chipW, chipH);
    x.fillStyle = '#18150f'; x.font = '400 ' + chipFs + 'px ' + BODY; x.letterSpacing = '2px';
    x.fillText('DAILY SUPPLEMENT', cx0 + padX, chipY + 1);
    x.letterSpacing = '0px';
    x.fillStyle = CREAM; x.font = '400 ' + hgFs + 'px ' + BODY;
    x.fillText('Human-Grade', cx0 + chipW + gap, chipY);
    const by = h * 0.905;
    x.textAlign = 'left'; x.fillStyle = CREAM; x.letterSpacing = '4px';
    x.font = '400 ' + (h * 0.034) + 'px ' + BODY;
    x.fillText('VETERINARIAN FORMULATED • GRAIN FREE', w * 0.055, by);
    x.letterSpacing = '0px';
    x.textAlign = 'right'; x.font = '400 ' + (h * 0.032) + 'px ' + BODY;
    const scW = x.measureText('SOFT CHEWS').width;
    x.fillText('SOFT CHEWS', w * 0.945, by - h * 0.012);
    x.fillStyle = '#cfc9bb'; x.font = '400 ' + (h * 0.026) + 'px ' + BODY;
    x.fillText('Net wt. 2.8oz', w * 0.945, by + h * 0.035);
    x.fillStyle = CREAM; x.textAlign = 'right';
    x.font = '400 ' + (h * 0.115) + 'px ' + BODY;
    x.fillText('30', w * 0.945 - scW - h * 0.030, by + h * 0.004);
  });

  const lidInTex = (sp, list) => canvasTex(2048, 1293, (x, w, h) => {
    x.fillStyle = '#f4f3f2'; x.fillRect(0, 0, w, h);
    const m = w * 0.055;
    if (logoInk) {
      const lw = w * 0.30, lh2 = lw * (mask.height / mask.width);
      x.drawImage(logoInk, w / 2 - lw / 2, h * 0.20 - lh2 / 2, lw, lh2);
    }
    let y = h * 0.50;
    x.textAlign = 'left'; x.fillStyle = '#201f1d';
    x.font = '600 ' + (h * 0.052) + 'px ' + HEAD;
    x.fillText('Supplement Facts', m, y);
    x.textAlign = 'right'; x.fillStyle = '#5c584f'; x.font = '400 ' + (h * 0.024) + 'px ' + BODY;
    x.fillText('Serving size 1 chew · 30 per container · ' + (sp === 'cat' ? 'cats' : 'dogs'), w - m, y);
    y += h * 0.030;
    x.strokeStyle = '#201f1d'; x.lineWidth = 3;
    x.beginPath(); x.moveTo(m, y); x.lineTo(w - m, y); x.stroke();
    y += h * 0.032;
    const colW = (w - 2 * m) / 3;
    x.font = '400 ' + (h * 0.022) + 'px ' + BODY;
    list.forEach((n, i) => {
      const col = i % 3, row = Math.floor(i / 3);
      const cx = m + col * colW, cy = y + row * h * 0.038;
      x.textAlign = 'left'; x.fillStyle = '#201f1d'; x.fillText(n, cx, cy);
      x.textAlign = 'right'; x.fillStyle = '#8d8778'; x.fillText('†', cx + colW - w * 0.02, cy);
      x.strokeStyle = '#d8d5cf'; x.lineWidth = 1;
      x.beginPath(); x.moveTo(cx, cy + h * 0.016); x.lineTo(cx + colW - w * 0.014, cy + h * 0.016); x.stroke();
    });
    let fy = y + 4 * h * 0.038 + h * 0.02;
    x.textAlign = 'left'; x.fillStyle = '#8d8778'; x.font = '400 ' + (h * 0.017) + 'px ' + BODY;
    x.fillText('† Daily Value not established. Inactive ingredients: glycerin, pea protein, natural pumpkin flavor.', m, fy);
    fy += h * 0.035;
    x.strokeStyle = '#c9c5bd'; x.beginPath(); x.moveTo(m, fy); x.lineTo(w - m, fy); x.stroke();
    fy += h * 0.030;
    const blocks = [
      ['CAUTION', 'For animal use only. Keep out of reach of\nchildren. Not for human consumption. Consult\nyour veterinarian before use.'],
      ['STORAGE', 'Store sealed in a cool, dry place below 77\u00B0F\n(25\u00B0C). Keep lid closed and away from\ndirect sunlight.'],
      ['DISTRIBUTED BY', 'Happy Beanie Pet Co.\n33777 N Scottsdale Rd\nhappybeanie.com \u00B7 Made in the USA']
    ];
    const qs = h * 0.115, bColW = (w - 2 * m - qs - h * 0.05) / 3;
    blocks.forEach((bl, i) => {
      const cx = m + i * bColW;
      x.fillStyle = '#9a6f2c'; x.letterSpacing = '3px'; x.font = '400 ' + (h * 0.016) + 'px ' + BODY;
      x.fillText(bl[0], cx, fy);
      x.letterSpacing = '0px'; x.fillStyle = '#3d3a34'; x.font = '400 ' + (h * 0.017) + 'px ' + BODY;
      bl[1].split('\n').forEach((ln, j) => x.fillText(ln, cx, fy + h * 0.030 + j * h * 0.024));
    });
    drawQR(x, w - m - qs, fy - h * 0.010, qs);
  });

  const flat = (hex) => canvasTex(8, 8, (x, w, h) => { x.fillStyle = hex; x.fillRect(0, 0, w, h); });
  const drawEnd = (x, w, h) => {
    x.fillStyle = BLACK; x.fillRect(0, 0, w, h);
    const ar = logo ? IW / IH : 3.4;
    const lw = h * 0.62 * ar;
    const lx = w * 0.89 - lw / 2;
    drawLogo(x, lx, h * 0.5, lw);
    x.save();
    x.translate(lx - lw / 2 - h * 0.62, h * 0.5);
    x.rotate(Math.PI / 2);
    x.textAlign = 'center'; x.fillStyle = '#e6e2d8';
    x.font = '400 ' + (h * 0.30) + 'px ' + BODY;
    x.fillText(species === 'cat' ? 'cats' : 'dogs', 0, 0);
    x.restore();
  };
  const texUnder = canvasTex(2048, 1293, (x, w, h) => {
    x.fillStyle = BLACK; x.fillRect(0, 0, w, h);
    if (pawInk) {
      const pw = w * 0.20, ph = pw * (pawInk.height / pawInk.width);
      x.save(); x.translate(w / 2, h / 2); x.rotate(Math.PI);
      x.drawImage(pawInk, -pw / 2, -ph / 2, pw, ph);
      x.restore();
    }
  });
  const speckleTex = (() => {
    const t = canvasTex(256, 256, (x, w, h) => {
      x.fillStyle = '#6f513a'; x.fillRect(0, 0, w, h);
      let sd = 7;
      const rnd = () => (sd = (sd * 1103515245 + 12345) % 2147483648) / 2147483648;
      for (let i = 0; i < 260; i++) {
        const r = rnd();
        x.fillStyle = r < 0.5 ? 'rgba(32,22,13,0.7)' : (r < 0.82 ? 'rgba(182,130,53,0.5)' : 'rgba(239,236,227,0.35)');
        x.beginPath(); x.arc(rnd() * w, rnd() * h, 0.8 + rnd() * 2.1, 0, 6.3); x.fill();
      }
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(2.4, 2.4);
    return t;
  })();

  const mat = (name, tex, rough) => new THREE.MeshStandardMaterial({
    name, map: tex, roughness: rough === undefined ? 0.92 : rough, metalness: 0.05
  });
  const mBlack = mat('WrapBlack', flat(BLACK));
  const mBlackEdge = mat('WrapBlackEdge', flat('#211d14'));
  const mCream = mat('LinerCream', flat('#f4f3f2'), 0.95);
  const mLidTop = mat('LidTopArt', lidTopTex(species));
  const mLidIn = mat('LidInterior', lidInTex(species, actives), 0.96);
  const mSkirtLong = mat('SkirtLong', flat(BLACK));
  const mSkirtEnd = mat('SkirtEnd', canvasTex(1280, 293, drawEnd));
  const mSkirtEndL = mat('SkirtEndLeft', canvasTex(1280, 293, drawEnd));
  const mUnder = mat('BaseUnderside', texUnder);
  const mTray = new THREE.MeshStandardMaterial({ name: 'FlockedTray', color: 0x17150f, roughness: 1 });
  const mBean = new THREE.MeshStandardMaterial({ name: 'Chew', map: speckleTex, roughness: 0.62, metalness: 0 });

  const box = (name, w, h, d, mats) => {
    const mm = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats);
    mm.name = name; return mm;
  };
  const model = new THREE.Group(); model.name = 'HappyBeanieBox';
  const base = new THREE.Group(); base.name = 'Base';
  const bottom = box('BaseBottom', L, T, W, [mBlack, mBlack, mCream, mUnder, mBlack, mBlack]);
  bottom.position.y = T / 2;
  const wallFB = (z, n) => {
    const mm = box(n, L, H - T, T, [mBlackEdge, mBlackEdge, mBlackEdge, mBlackEdge, mBlack, mCream]);
    mm.position.set(0, T + (H - T) / 2, z); return mm;
  };
  const wallLR = (xx, n) => {
    const mm = box(n, T, H - T, W - 2 * T, [mBlack, mCream, mBlackEdge, mBlackEdge, mBlackEdge, mBlackEdge]);
    mm.position.set(xx, T + (H - T) / 2, 0); return mm;
  };
  const mPlate = new THREE.MeshStandardMaterial({ name: 'SteelPlate', color: 0x9c9891, roughness: 0.5, metalness: 0.35 });
  const plateGeo = new THREE.CylinderGeometry(0.0095, 0.0095, 0.0012, 28);
  [-1, 1].forEach((sgn, i) => {
    const mm = new THREE.Mesh(plateGeo, mPlate);
    mm.name = 'BaseCounterplate_' + (i + 1);
    mm.rotation.x = Math.PI / 2;
    mm.position.set(sgn * L * 0.26, H * 0.52, W / 2 - T - 0.0007);
    base.add(mm);
  });
  base.add(bottom,
    wallFB(W / 2 - T / 2, 'BaseWallFront'), wallFB(-(W / 2 - T / 2), 'BaseWallBack'),
    wallLR(L / 2 - T / 2, 'BaseWallRight'), wallLR(-(L / 2 - T / 2), 'BaseWallLeft'));

  const trayH = 0.016;
  const tray = box('InsertTray', L - 2.4 * T, trayH, W - 2.4 * T, mTray);
  tray.position.y = T + trayH / 2;
  base.add(tray);

  const beanShape = new THREE.Shape();
  beanShape.moveTo(-1.00, -0.30);
  beanShape.bezierCurveTo(-1.18, 0.42, -0.52, 0.72, -0.16, 0.34);
  beanShape.bezierCurveTo(-0.05, 0.22, 0.05, 0.22, 0.16, 0.34);
  beanShape.bezierCurveTo(0.52, 0.72, 1.18, 0.42, 1.00, -0.30);
  beanShape.bezierCurveTo(0.86, -0.86, -0.86, -0.86, -1.00, -0.30);
  const beanGeo = new THREE.ExtrudeGeometry(beanShape, {
    depth: 0.30, bevelEnabled: true, bevelSegments: 6,
    bevelSize: 0.09, bevelThickness: 0.13, curveSegments: 28
  });
  beanGeo.rotateX(-Math.PI / 2);
  beanGeo.rotateY(Math.PI);
  beanGeo.center();
  const beans = [];
  for (let r = 0; r < 5; r++) for (let c = 0; c < 6; c++) {
    const bm = new THREE.Mesh(beanGeo, mBean);
    bm.name = 'Chew_' + (r * 6 + c + 1);
    bm.scale.set(0.0128, 0.0060, 0.0128);
    bm.position.set((c - 2.5) * (L - 5 * T) / 6, T + trayH + 0.0022, (r - 2) * (W - 5 * T) / 5.4);
    base.add(bm);
    beans.push(bm);
  }

  const CL = 0.0012, L2 = L + 2 * (T + CL), W2 = W + 2 * (T + CL), SK = 1.375 * IN;
  const lid = new THREE.Group(); lid.name = 'Lid';
  const top = box('LidPanel', L2, T, W2, [mBlackEdge, mBlackEdge, mLidTop, mLidIn, mBlackEdge, mBlackEdge]);
  top.position.y = -T / 2;
  const skirtFB = (z, n) => {
    const mm = box(n, L2, SK, T, [mBlackEdge, mBlackEdge, mBlackEdge, mBlackEdge,
      z > 0 ? mSkirtLong : mCream, z > 0 ? mCream : mSkirtLong]);
    mm.position.set(0, -T - SK / 2, z); return mm;
  };
  const skirtLR = (xx, n) => {
    const mm = box(n, T, SK, W2 - 2 * T, [xx > 0 ? mSkirtEnd : mCream, xx > 0 ? mCream : mSkirtEndL,
      mBlackEdge, mBlackEdge, mBlackEdge, mBlackEdge]);
    mm.position.set(xx, -T - SK / 2, 0); return mm;
  };
  const mMagnet = new THREE.MeshStandardMaterial({ name: 'MagnetDisc', color: 0xb8b4ad, roughness: 0.42, metalness: 0.35 });
  const discGeo = new THREE.CylinderGeometry(0.0095, 0.0095, 0.0016, 28);
  const magnets = new THREE.Group(); magnets.name = 'Magnets';
  let magnetMesh = null;
  [-1, 1].forEach((sgn, i) => {
    const mm = new THREE.Mesh(discGeo, mMagnet);
    mm.name = 'LidMagnet_' + (i + 1);
    mm.rotation.x = Math.PI / 2;
    mm.position.set(sgn * L2 * 0.26, -T - SK * 0.62, W2 / 2 - T - 0.0009);
    magnets.add(mm);
    if (sgn === 1) magnetMesh = mm;
  });
  lid.add(magnets);
  lid.add(top,
    skirtFB(W2 / 2 - T / 2, 'LidSkirtFront'), skirtFB(-(W2 / 2 - T / 2), 'LidSkirtBack'),
    skirtLR(L2 / 2 - T / 2, 'LidSkirtRight'), skirtLR(-(L2 / 2 - T / 2), 'LidSkirtLeft'));

  const hinge = new THREE.Group(); hinge.name = 'Hinge';
  hinge.position.set(0, H + T, -(W2 / 2 - T));
  lid.position.set(0, 0, W2 / 2 - T);
  hinge.add(lid);
  model.add(base, hinge);

  // invisible anchors for hotspot annotations
  const mark = (parent, x, y, z, name) => {
    const o = new THREE.Object3D(); o.name = name; o.position.set(x, y, z);
    parent.add(o); return o;
  };
  const marks = {
    lid: mark(lid, 0, 0, -W2 * 0.1, 'MarkLid'),
    magnet: magnetMesh ? mark(magnetMesh, 0, 0, 0, 'MarkMagnet') : mark(lid, L2 * 0.26, -T - SK * 0.62, W2 / 2, 'MarkMagnet'),
    tray: mark(base, L * 0.12, T + trayH + 0.004, W * 0.22, 'MarkTray'),
    brand: mark(base, L / 2, H * 0.5, 0, 'MarkBrand')
  };
  return { model, base, hinge, lid, beans, marks, dims: { L, W, H, T } };
}

// Kidney-bean chew geometry + speckle material, standalone (for the inspector).
export function buildBean(THREE) {
  const beanShape = new THREE.Shape();
  beanShape.moveTo(-1.00, -0.30);
  beanShape.bezierCurveTo(-1.18, 0.42, -0.52, 0.72, -0.16, 0.34);
  beanShape.bezierCurveTo(-0.05, 0.22, 0.05, 0.22, 0.16, 0.34);
  beanShape.bezierCurveTo(0.52, 0.72, 1.18, 0.42, 1.00, -0.30);
  beanShape.bezierCurveTo(0.86, -0.86, -0.86, -0.86, -1.00, -0.30);
  const geo = new THREE.ExtrudeGeometry(beanShape, {
    depth: 0.30, bevelEnabled: true, bevelSegments: 10,
    bevelSize: 0.09, bevelThickness: 0.13, curveSegments: 48
  });
  geo.rotateX(-Math.PI / 2);
  geo.rotateY(Math.PI);
  geo.center();
  return { shape: beanShape, geo };
}
