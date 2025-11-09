(function () {
  const ok = [];
  ok.push('Tesseract:' + (!!window.Tesseract));
  ok.push('Vibrant:' + (!!window.Vibrant));
  ok.push('ColorThief:' + (!!window.ColorThief));
  console.log('[Analyzer] libs', ok.join(' | '));
  window.AnalyzerReady = true;
})();

function log(...args){ try { console.log('[Analyzer]', ...args); } catch(_) {} }

function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = dataUrl;
  });
}

// Quick file download for Flutter
window.downloadFile = function (filename, content, mime = "application/octet-stream") {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
};

// Bust stale SW/caches
window.clearFlutterWebCache = async function () {
  try {
    const regs = await (navigator.serviceWorker?.getRegistrations?.() || []);
    for (const r of regs) try { await r.unregister(); } catch (_) {}
    if (window.caches?.keys) {
      const keys = await caches.keys();
      for (const k of keys) try { await caches.delete(k); } catch (_) {}
    }
  } catch (e) { log('clearFlutterWebCache error:', e); }
  location.reload();
};

// ---------- OCR ----------
window.ocrFromImage = async function (dataUrl, lang = "eng") {
  const { data } = await Tesseract.recognize(dataUrl, lang, { logger: () => {} });
  return data?.text || "";
};

// ---------- Color helpers ----------
function hexFromRgb(rgb) {
  return '#' + rgb.map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2,'0')).join('').toUpperCase();
}
function isNearBlackOrWhite([r,g,b]) { const avg=(r+g+b)/3; return avg < 14 || avg > 241; }
function isNearGray([r,g,b]) { const max=Math.max(r,g,b), min=Math.min(r,g,b); return (max-min) < 12; }

function rgbToHsv([r,g,b]) {
  r/=255; g/=255; b/=255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b);
  const d=max-min;
  let h=0;
  if (d) {
    switch (max) {
      case r: h=((g-b)/d + (g<b?6:0)); break;
      case g: h=((b-r)/d + 2); break;
      default: h=((r-g)/d + 4);
    }
    h*=60;
  }
  const s=max===0?0:d/max;
  return {h,s,v:max};
}
function luminance([r,g,b]){
  const ch = v => { v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4); };
  const R=ch(r), G=ch(g), B=ch(b);
  return 0.2126*R + 0.7152*G + 0.0722*B;
}
function bestOn(rgb){
  const Lbg=luminance(rgb);
  const contrast = (fg) => {
    const Lfg = (fg === '#000000') ? 0 : 1;
    const hi=Math.max(Lbg, Lfg), lo=Math.min(Lbg, Lfg);
    return (hi+0.05)/(lo+0.05);
  };
  return contrast('#000000') >= contrast('#FFFFFF') ? '#000000' : '#FFFFFF';
}
function hueDistance(a,b){ const d=Math.abs(a-b); return d>180? 360-d : d; }

// ---------- Palette (robust) ----------
window.extractPalette = async function (dataUrl) {
  const img = await loadImageFromDataUrl(dataUrl);
  try { await (img.decode?.() || Promise.resolve()); } catch(_) {}

  let out = [];

  // 1) Vibrant
  if (window.Vibrant?.from) {
    try {
      const vib = window.Vibrant.from(img).maxColorCount(8).quality(5);
      const palette = await vib.getPalette();
      for (const key of Object.keys(palette || {})) {
        const sw = palette[key];
        if (!sw) continue;
        const rgb = sw.getRgb().map(n => Math.round(n));
        if (!isNearBlackOrWhite(rgb) && !isNearGray(rgb)) {
          out.push({ title: key, hex: hexFromRgb(rgb), rgb, population: sw.getPopulation() });
        }
      }
    } catch (e) { log('Vibrant failed:', e); }
  }

  // 2) ColorThief fallback
  if ((!out || !out.length) && window.ColorThief) {
    try {
      const ct = new window.ColorThief();
      const pal = ct.getPalette(img, 8) || [];
      out = pal
        .map((rgb, i) => ({ title: 'ColorThief'+i, hex: hexFromRgb(rgb), rgb, population: 0 }))
        .filter(c => !isNearBlackOrWhite(c.rgb) && !isNearGray(c.rgb));
      if (!out.length) {
        const dom = ct.getColor(img);
        out = [{ title: 'Dominant', hex: hexFromRgb(dom), rgb: dom, population: 0 }];
      }
    } catch (e) { log('ColorThief failed:', e); }
  }

  // 3) Average pixels
  if (!out || !out.length) {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const w=canvas.width, h=canvas.height, data=ctx.getImageData(0,0,w,h).data;
    let r=0,g=0,b=0,count=0, step=Math.max(4, Math.floor((w*h)/5000)*4);
    for (let i=0;i<data.length;i+=step){ r+=data[i]; g+=data[i+1]; b+=data[i+2]; count++; }
    const avg=[r/count,g/count,b/count].map(Math.round);
    out=[{ title:'Average', hex:hexFromRgb(avg), rgb:avg, population:0 }];
  }

  out.sort((a,b)=> (b.population||0)-(a.population||0));
  return JSON.parse(JSON.stringify(out));
};

// ---------- Pick brand colors ----------
window.pickBrandColors = function (palette) {
  const sw = (palette || []).map(p => {
    const rgb = (p?.rgb && p.rgb.length>=3) ? p.rgb.map(n=>+n) : [0,0,0];
    const hsv = rgbToHsv(rgb);
    return { rgb, hsv, pop: +(p?.population || 0) };
  }).filter(s => !isNearBlackOrWhite(s.rgb) && !isNearGray(s.rgb));

  if (!sw.length) {
    const primary=[103,80,164], secondary=[98,91,113];
    return JSON.parse(JSON.stringify({
      primary: hexFromRgb(primary), onPrimary: bestOn(primary),
      secondary: hexFromRgb(secondary), onSecondary: bestOn(secondary)
    }));
  }

  const score = s => Math.log(1+s.pop) * (0.6*s.hsv.s + 0.4) * (1 - Math.abs(s.hsv.v - 0.62));
  sw.sort((a,b)=> score(b) - score(a));
  const primary = sw[0];

  const second = (sw.find(s => hueDistance(s.hsv.h, primary.hsv.h) >= 25 && s.hsv.s >= 0.18) || sw[1] || primary);

  let tertiary = null;
  for (const s of sw) {
    if (hueDistance(s.hsv.h, primary.hsv.h) >= 25 && hueDistance(s.hsv.h, second.hsv.h) >= 25 && s.hsv.s >= 0.18) {
      tertiary = s; break;
    }
  }

  const res = {
    primary:   hexFromRgb(primary.rgb),
    onPrimary: bestOn(primary.rgb),
    secondary: hexFromRgb(second.rgb),
    onSecondary: bestOn(second.rgb),
  };
  if (tertiary) {
    res.tertiary   = hexFromRgb(tertiary.rgb);
    res.onTertiary = bestOn(tertiary.rgb);
  }
  return JSON.parse(JSON.stringify(res));
};

// ---------- Layout ----------
window.analyzeLayout = async function (dataUrl, lang = "eng") {
  const { data } = await Tesseract.recognize(dataUrl, lang, { logger: () => {} });
  const out = { width: data?.image?.width ?? null, height: data?.image?.height ?? null, blocks: [], lines: [], words: [] };

  const blocks = Array.isArray(data?.blocks) ? data.blocks : [];
  const lines  = Array.isArray(data?.lines)  ? data.lines  : [];
  const words  = Array.isArray(data?.words)  ? data.words  : [];

  for (const b of blocks) out.blocks.push({ x0:b?.bbox?.x0??0, y0:b?.bbox?.y0??0, x1:b?.bbox?.x1??0, y1:b?.bbox?.y1??0, text:(b?.text||'').trim(), conf:b?.confidence ?? null });
  for (const l of lines)  out.lines.push( { x0:l?.bbox?.x0??0, y0:l?.bbox?.y0??0, x1:l?.bbox?.x1??0, y1:l?.bbox?.y1??0, text:(l?.text||'').trim(), conf:l?.confidence ?? null });
  for (const w of words)  out.words.push( { x0:w?.bbox?.x0??0, y0:w?.bbox?.y0??0, x1:w?.bbox?.x1??0, y1:w?.bbox?.y1??0, text:(w?.text||'').trim(), conf:w?.confidence ?? null });

  if (!out.width || !out.height) {
    let maxX=0, maxY=0;
    for (const it of [...out.words, ...out.lines, ...out.blocks]) { if (it.x1>maxX) maxX=it.x1; if (it.y1>maxY) maxY=it.y1; }
    out.width = out.width || maxX || 1;
    out.height = out.height || maxY || 1;
  }
  if (!out.words.length && !out.lines.length && !out.blocks.length) {
    throw new Error('No boxes returned. Try a clearer image or another language (e.g. "eng+tam").');
  }
  return JSON.parse(JSON.stringify(out));
};
