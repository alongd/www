(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PubView = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function escAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function tocFigure(entry) {
    entry = entry || {};
    if (entry.toc) {
      return '<span class="toc"><img class="tocimg" loading="lazy" decoding="async" src="' +
        escAttr(entry.toc) + '" alt="Graphical abstract: ' + escAttr(entry.title) +
        '" onerror="this.style.display=\'none\'"></span>';
    }
    return '<span class="toc"></span>';
  }

  function doiUrl(entry) {
    entry = entry || {};
    if (!entry.doi) return null;
    var d = String(entry.doi).trim();
    if (!d) return null;
    return /^https?:\/\//i.test(d) ? d : 'https://doi.org/' + d;
  }

  function selectedBand(entries, targetMin) {
    entries = entries || [];
    targetMin = targetMin || 3;
    var withToc = entries.filter(function (p) { return !!p.toc; });
    var band = withToc.filter(function (p) { return p.highlight === true; });
    for (var i = 0; i < withToc.length && band.length < targetMin; i++) {
      if (band.indexOf(withToc[i]) === -1) band.push(withToc[i]);
    }
    return band;
  }

  if (typeof document !== 'undefined' && !document.getElementById('pubview-css')) {
    var GLYPH = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48' viewBox='0 0 48 48'%3E%3Cg fill='none' stroke='%232D6BB5' stroke-width='2' opacity='0.3'%3E%3Cline x1='14' y1='30' x2='24' y2='18'/%3E%3Cline x1='24' y1='18' x2='34' y2='30'/%3E%3Ccircle cx='14' cy='30' r='4' fill='%232D6BB5'/%3E%3Ccircle cx='24' cy='18' r='4' fill='%232D6BB5'/%3E%3Ccircle cx='34' cy='30' r='4' fill='%232D6BB5'/%3E%3C/g%3E%3C/svg%3E";
    var st = document.createElement('style');
    st.id = 'pubview-css';
    st.textContent =
      '.toc{display:block;position:relative;aspect-ratio:16/9;overflow:hidden;flex:none;' +
      'border:1px solid var(--line);border-radius:6px;' +
      'background:var(--bg-soft) url("' + GLYPH + '") center/38px no-repeat}' +
      '.tocimg{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#fff}';
    document.head.appendChild(st);
  }

  return { tocFigure: tocFigure, selectedBand: selectedBand, doiUrl: doiUrl };
}));
