/* SMILE V 転記（会議録音ツール） ブックマークから読み込まれます */
(function () {
/* =========================================================
 * SMILE V 打合議事録 画面への自動転記エンジン
 *   この関数は単体で動くように書いてある（コンソール貼付版でも toString() して使う）
 *   画面の構造は「ラベル文字」「行番号」「アイコン」から推定するため、
 *   SMILE V 側の内部IDが分からなくても動く設計。
 * ========================================================= */
var SMILE_FILLER = function (cfg) {
  cfg = cfg || {};
  const W = cfg.win || window;   // 別ウィンドウ（ポップアップ）を対象にする場合
  'use strict';
  const norm = s => (s || '').replace(/[\s　 ]/g, '').replace(/\(/g, '（').replace(/\)/g, '）')
    .replace(/[１1]/g, '1').replace(/[２2]/g, '2').replace(/№|No\.?|NO\.?|ｎｏ/gi, 'No');
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ---- 対象ドキュメント（iframe内も探索） ----
  function docsOf(win) {
    const out = [];
    try { out.push(win.document); } catch (e) { return out; }
    try { for (let i = 0; i < win.frames.length; i++) out.push(...docsOf(win.frames[i])); } catch (e) { }
    return out;
  }
  function findGridHeader(doc) {
    const els = doc.querySelectorAll('th,td,div,span,label');
    for (const el of els) {
      if (norm(el.textContent) === '打合事項' && el.children.length <= 3) return el;
    }
    return null;
  }
  function findDoc() {
    for (const d of (cfg.selfOnly ? [W.document] : docsOf(W))) { try { if (findGridHeader(d)) return d; } catch (e) { } }
    return null;
  }

  const isText = el => el && ((el.tagName === 'INPUT' && /^(text|search|)$/i.test(el.type || 'text')) || el.tagName === 'TEXTAREA');
  const visible = el => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  const editable = el => isText(el) && !el.disabled && !el.readOnly && visible(el);

  // ---- 打合事項グリッドの行 ----
  function getRows(doc) {
    const head = findGridHeader(doc);
    if (!head) return [];
    // ヘッダから親をたどり、番号付きの行を含むコンテナを探す
    let box = head;
    let trs = [];
    for (let i = 0; i < 12 && box; i++) {
      box = box.parentElement;
      if (!box) break;
      trs = Array.from(box.querySelectorAll('tr')).filter(tr => {
        const c = tr.cells && tr.cells[0];
        return c && /^\d+$/.test(norm(c.textContent)) && tr.querySelector('input,textarea');
      });
      if (trs.length >= 2) break;
    }
    const headX = head.getBoundingClientRect();
    return trs.map(tr => {
      const ins = Array.from(tr.querySelectorAll('input,textarea')).filter(isText).filter(visible);
      if (!ins.length) return null;
      // 打合事項欄：ヘッダと横位置が一番重なる、幅が最大の入力欄
      let main = ins.reduce((a, b) => overlap(b, headX) > overlap(a, headX) ? b : a, ins[0]);
      if (overlap(main, headX) <= 0) main = ins.reduce((a, b) => b.offsetWidth > a.offsetWidth ? b : a, ins[0]);
      const mx = main.getBoundingClientRect().left;
      const left = ins.filter(x => x !== main && x.getBoundingClientRect().left < mx);
      const right = ins.filter(x => x !== main && x.getBoundingClientRect().left > mx);
      return {
        tr, index: parseInt(norm(tr.cells[0].textContent), 10),
        no: left[left.length - 1] || null, main, verify: right[0] || null,
        active: editable(main),
      };
    }).filter(Boolean).sort((a, b) => a.index - b.index);
  }
  function overlap(el, r) {
    const b = el.getBoundingClientRect();
    return Math.min(b.right, r.right) - Math.max(b.left, r.left);
  }

  // ---- 行追加アイコン ----
  function addIcon(row) {
    const cand = Array.from(row.tr.querySelectorAll('img,a,button,span,i,input[type=image],input[type=button],svg'));
    const byLabel = cand.find(e => /行追加|行挿入|追加/.test((e.title || '') + (e.alt || '') + (e.getAttribute('aria-label') || '') + (e.tagName === 'BUTTON' ? e.textContent : '')));
    if (byLabel) return byLabel;
    // 見つからなければ「コピー・貼付け・消去・行追加」の4番目
    const cell = Array.from(row.tr.cells).find(c => c.querySelectorAll('img,a,button,i,svg,input[type=image]').length >= 3 && !c.querySelector('input[type=text],textarea'));
    if (!cell) return null;
    let icons = Array.from(cell.querySelectorAll('img,input[type=image],svg'));
    if (icons.length < 4) icons = Array.from(cell.querySelectorAll('a,button,i'));
    return icons[3] || icons[icons.length - 1] || null;
  }
  function clickEl(el) {
    const w = el.ownerDocument.defaultView;
    const target = el.closest('a,button') || el;
    ['mouseover', 'mousedown', 'mouseup'].forEach(t => target.dispatchEvent(new w.MouseEvent(t, { bubbles: true, cancelable: true, view: w })));
    if (typeof target.click === 'function') target.click();
    else target.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, view: w }));
  }

  // ---- 値の設定（SMILE V 側のイベントも発火させる） ----
  function setVal(el, v) {
    if (!el || el.disabled || el.readOnly) return false;
    const w = el.ownerDocument.defaultView;
    const proto = el.tagName === 'TEXTAREA' ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype;
    v = v == null ? '' : String(v);
    if (el.maxLength > 0 && v.length > el.maxLength) v = v.slice(0, el.maxLength);
    try { el.focus({ preventScroll: true }); } catch (e) { }
    el.dispatchEvent(new w.Event('focus'));
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    ['input', 'keyup', 'change'].forEach(t => el.dispatchEvent(new w.Event(t, { bubbles: true })));
    el.dispatchEvent(new w.Event('blur'));
    try { el.blur(); } catch (e) { }
    return true;
  }

  // ---- 見出し部（ラベル → 入力欄） ----
  function textNodes(doc, test) {
    const out = [];
    const tw = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = tw.nextNode())) if (test(norm(n.nodeValue))) out.push(n);
    return out;
  }
  function allInputs(doc) { return Array.from(doc.querySelectorAll('input,textarea')).filter(isText).filter(visible); }
  const after = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING); // b は a の後

  function fieldByLabel(doc, label) {
    const L = norm(label);
    const nodes = textNodes(doc, t => t === L);
    if (!nodes.length) return null;
    const node = nodes[0];
    const cell = node.parentElement.closest('td,th') || node.parentElement;
    // 同じセル内 → 右隣のセル → 文書順で次の入力欄
    let el = Array.from(cell.querySelectorAll('input,textarea')).filter(isText).filter(visible)[0];
    if (!el) {
      let c = cell.nextElementSibling;
      for (let i = 0; i < 2 && c && !el; i++, c = c.nextElementSibling) el = Array.from(c.querySelectorAll('input,textarea')).filter(isText).filter(visible)[0];
    }
    if (!el) el = allInputs(doc).find(i => after(node, i));
    return el || null;
  }
  function titleInputs(doc) {
    // 「第 [回数] 回 [件名] 打合書」
    const dai = textNodes(doc, t => t === '第' || t.startsWith('第'))[0];
    const end = textNodes(doc, t => t === '打合書' || t.endsWith('打合書'))[0];
    if (!dai || !end) return {};
    const ins = allInputs(doc).filter(i => after(dai, i) && after(i, end));
    const kaiN = textNodes(doc, t => t === '回' || t.startsWith('回'))[0];
    let kai = null, ken = null;
    if (kaiN) {
      kai = ins.filter(i => after(i, kaiN)).pop() || null;
      ken = ins.filter(i => after(kaiN, i)).pop() || null;
    } else if (ins.length >= 2) { kai = ins[0]; ken = ins[ins.length - 1]; }
    else ken = ins[0] || null;
    return { kai, ken };
  }

  const HEADER_FIELDS = [
    ['date', '打合日時'], ['place', '打合場所'], ['juchu', '受注No'],
    ['kyaku1', '打合者（客先1）'], ['kyaku2', '打合者（客先2）'], ['shanai', '打合者（社内）'],
  ];

  // ---- 検出 ----
  function detect() {
    const doc = findDoc();
    if (!doc) return { ok: false, msg: '打合議事録の入力画面（打合事項の表）が見つかりません。' };
    const rows = getRows(doc);
    const act = rows.filter(r => r.active);
    const limit = act[0] && act[0].main.maxLength > 0 ? act[0].main.maxLength : 0;
    return { ok: rows.length > 0, doc, rows, activeCount: act.length, totalRows: rows.length, limit,
      msg: rows.length ? '' : '打合事項の行が検出できませんでした。' };
  }

  // ---- 転記 ----
  async function fill(payload, opt) {
    opt = Object.assign({ overwrite: true, header: true, delay: 25, log: () => { } }, opt || {});
    const log = opt.log;
    const det = detect();
    if (!det.ok) throw new Error(det.msg);
    const doc = det.doc;
    const res = { header: {}, rows: 0, skipped: [], limit: det.limit };
    let rowsData = payload.rows || [];

    if (det.limit && payload.limit && det.limit < payload.limit && opt.rewrap) {
      rowsData = opt.rewrap(det.limit);
      log(`SMILE V の文字数上限 ${det.limit} 字に合わせて折返し直しました。`);
    }

    // 見出し
    if (opt.header && payload.header) {
      const h = payload.header;
      const t = titleInputs(doc);
      if (h.kai) res.header.kai = setVal(t.kai, h.kai);
      if (h.kenmei) res.header.kenmei = setVal(t.ken, h.kenmei);
      for (const [k, label] of HEADER_FIELDS) {
        if (!h[k]) continue;
        const el = fieldByLabel(doc, label);
        res.header[k] = setVal(el, h[k]);
        if (!res.header[k]) res.skipped.push(label);
        await sleep(opt.delay);
      }
    }

    // 打合事項
    let rows = getRows(doc);
    let start = 0;
    if (!opt.overwrite) {
      const lastUsed = rows.filter(r => r.active && r.main.value.trim()).pop();
      start = lastUsed ? rows.indexOf(lastUsed) + 1 : 0;
    }
    for (let i = 0; i < rowsData.length; i++) {
      const pos = start + i;
      rows = getRows(doc);
      let tries = 0;
      while ((!rows[pos] || !rows[pos].active) && tries < 3) {
        const lastActive = rows.filter(r => r.active).pop();
        if (!lastActive) throw new Error('入力可能な行がありません。');
        const icon = addIcon(lastActive);
        if (!icon) throw new Error('「行追加」アイコンが見つかりません。構造診断を実行してください。');
        const before = rows.filter(r => r.active).length;
        clickEl(icon);
        for (let w = 0; w < 40; w++) {
          await sleep(75);
          rows = getRows(doc);
          if (rows.filter(r => r.active).length > before) break;
        }
        tries++;
      }
      if (!rows[pos] || !rows[pos].active) throw new Error(`${pos + 1}行目を追加できませんでした（行数の上限の可能性）。${i}行まで転記済み。`);
      const r = rows[pos], d = rowsData[i];
      if (r.no) setVal(r.no, d.no || '');
      setVal(r.main, d.text || '');
      if (r.verify && (d.verify || opt.overwrite)) setVal(r.verify, d.verify || '');
      res.rows++;
      log(`${pos + 1}行目 ${d.text.slice(0, 20)}`);
      await sleep(opt.delay);
    }
    // 上書き時は残りの行を空にする
    if (opt.overwrite) {
      rows = getRows(doc);
      rows.slice(start + rowsData.length).filter(r => r.active).forEach(r => {
        if (r.main.value) setVal(r.main, '');
        if (r.no && r.no.value) setVal(r.no, '');
        if (r.verify && r.verify.value) setVal(r.verify, '');
      });
    }
    try { getRows(doc)[start] && getRows(doc)[start].main.scrollIntoView({ block: 'center' }); } catch (e) { }
    return res;
  }

  // ---- 画面 → データ読取（既存の申請を下書きへ取り込む） ----
  function read() {
    const det = detect();
    if (!det.ok) throw new Error(det.msg);
    const doc = det.doc;
    const t = titleInputs(doc);
    const header = { kai: t.kai ? t.kai.value : '', kenmei: t.ken ? t.ken.value : '' };
    HEADER_FIELDS.forEach(([k, label]) => { const el = fieldByLabel(doc, label); header[k] = el ? el.value : ''; });
    const rows = det.rows.filter(r => r.active).map(r => ({ no: r.no ? r.no.value : '', text: r.main.value, verify: r.verify ? r.verify.value : '' }));
    while (rows.length && !rows[rows.length - 1].text && !rows[rows.length - 1].no) rows.pop();
    return { header, rows };
  }

  // ---- 構造診断（うまく動かない時に情報を集める） ----
  function diagnose() {
    const doc = findDoc();
    const rep = { url: W.location.href, frames: docsOf(W).length, found: !!doc };
    if (!doc) {
      rep.labels = docsOf(W).map(d => { try { return d.location.href + ' : ' + (d.body ? norm(d.body.textContent).slice(0, 200) : ''); } catch (e) { return 'cross-origin'; } });
      return rep;
    }
    const rows = getRows(doc);
    rep.rows = rows.length; rep.active = rows.filter(r => r.active).length;
    rep.rowSamples = rows.slice(0, 3).map(r => ({
      index: r.index, active: r.active, mainTag: r.main.outerHTML.slice(0, 300), maxLength: r.main.maxLength,
      no: r.no && r.no.outerHTML.slice(0, 200), verify: r.verify && r.verify.outerHTML.slice(0, 200),
      icons: Array.from(r.tr.querySelectorAll('img,a,button,i,svg,input[type=image]')).map(e => e.outerHTML.slice(0, 160)),
      addIcon: (addIcon(r) || {}).outerHTML ? addIcon(r).outerHTML.slice(0, 200) : null,
    }));
    if (rows[2]) rep.row3 = rows[2].tr.outerHTML.slice(0, 1200);
    rep.header = {};
    HEADER_FIELDS.forEach(([k, label]) => { const el = fieldByLabel(doc, label); rep.header[label] = el ? el.outerHTML.slice(0, 200) : null; });
    const t = titleInputs(doc);
    rep.header['第回'] = t.kai ? t.kai.outerHTML.slice(0, 200) : null;
    rep.header['件名'] = t.ken ? t.ken.outerHTML.slice(0, 200) : null;
    return rep;
  }

  return { detect, fill, read, diagnose, version: '1.0.0' };
};

  function BM_RUN(C, SF) {
    var TOP = window;
    if (TOP.__smvWait) { TOP.__smvWait.again(); return; }
    var F = SF();
    var det = F.detect();
    load(function (j) {
      if (det.ok) show(j, F, det, TOP);
      else wait(j);
    });

    // ---- 送信データの取得（JSONP） ----
    function load(done) {
      var cb = '__smv' + Date.now();
      var s = TOP.document.createElement('script');
      TOP[cb] = function (j) {
        try { delete TOP[cb]; } catch (e) { TOP[cb] = undefined; }
        s.parentNode && s.parentNode.removeChild(s);
        if (!j || !j.ok) { alert('SMILE V 転記：' + ((j && j.error) || 'データを取得できませんでした')); return; }
        done(j);
      };
      s.onerror = function () { alert('SMILE V 転記：会議録音ツールのスプシに接続できません。ネットワークを確認してください。'); };
      s.src = C.u + '?a=smv&k=' + encodeURIComponent(C.k) + '&n=' + encodeURIComponent(C.n) + '&cb=' + cb + '&t=' + Date.now();
      (TOP.document.head || TOP.document.documentElement).appendChild(s);
    }

    // ---- 打合議事録が別ウィンドウで開く場合：開くのを待ち受ける ----
    function wait(j) {
      var wins = [], t0 = Date.now(), timer = null, bar = null;
      function add(w) { if (w && wins.indexOf(w) < 0) wins.push(w); }
      function hook(w) {
        try {
          var d = w.document;
          if (!w.__smvHooked) {
            w.__smvHooked = true;
            var org = w.open;
            w.open = function () { var r = org.apply(this, arguments); add(r); return r; };
            w.__smvOrgOpen = org;
            d.addEventListener('click', function (e) {
              var a = e.target && e.target.closest && e.target.closest('a[target]');
              if (!a) return;
              var tg = a.getAttribute('target') || '';
              if (/^_(self|parent|top)$/i.test(tg)) return;
              if (/^_blank$/i.test(tg)) {
                if (!a.href || /^javascript:/i.test(a.href)) return;
                e.preventDefault(); add(org.call(w, a.href, '_blank')); return;
              }
              setTimeout(function () { try { add(org.call(w, '', tg)); } catch (x) { } }, 600);
            }, true);
            d.addEventListener('submit', function (e) {
              var tg = (e.target && e.target.getAttribute && e.target.getAttribute('target')) || '';
              if (!tg || /^_(self|parent|top|blank)$/i.test(tg)) return;
              setTimeout(function () { try { add(org.call(w, '', tg)); } catch (x) { } }, 800);
            }, true);
          }
          for (var i = 0; i < w.frames.length; i++) hook(w.frames[i]);
        } catch (e) { }
      }
      function barDoc() {
        var ds = [TOP];
        for (var k = 0; k < ds.length; k++) {
          try {
            var d = ds[k].document;
            if (d.body && d.body.tagName !== 'FRAMESET') return d;
            for (var i = 0; i < ds[k].frames.length; i++) ds.push(ds[k].frames[i]);
          } catch (e) { }
        }
        return null;
      }
      function showBar(msg) {
        var d = barDoc();
        if (!d) return;
        if (!bar || bar.ownerDocument !== d || !bar.parentNode) {
          bar = d.createElement('div');
          bar.style.cssText = 'position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:2147483000;background:#1f5fa8;color:#fff;padding:10px 14px;border-radius:8px;font:13px "Meiryo UI",sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3);max-width:90vw;line-height:1.6';
          d.documentElement.appendChild(bar);
        }
        bar.innerHTML = '';
        var t = d.createElement('span'); t.textContent = msg; bar.appendChild(t);
        var b = d.createElement('button'); b.textContent = '中止';
        b.style.cssText = 'margin-left:10px;padding:2px 10px;border:1px solid #fff;background:transparent;color:#fff;border-radius:4px;cursor:pointer';
        b.onclick = stop; bar.appendChild(b);
      }
      function stop() {
        clearInterval(timer);
        try { delete TOP.__smvWait; } catch (e) { TOP.__smvWait = undefined; }
        if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
      }
      function tick() {
        hook(TOP);
        for (var i = 0; i < wins.length; i++) {
          var w = wins[i];
          try {
            if (!w || w.closed) continue;
            hook(w);
            var F2 = SF({ win: w });
            var d2 = F2.detect();
            if (d2.ok) { stop(); try { w.focus(); } catch (e) { } show(j, F2, d2, w); return; }
          } catch (e) { }
        }
        if (Date.now() - t0 > 20 * 60 * 1000) stop();
      }
      TOP.__smvWait = { again: function () { showBar('SMILE V 転記：待ち受け中です。新規申請 → 打合議事録 を開いてください。'); } };
      showBar('SMILE V 転記：待ち受け中です。このまま 打合議事録 を開くと自動で転記します。');
      timer = setInterval(tick, 700);
      tick();
    }

    // ---- 転記（打合事項が空なら確認なしで実行） ----
    function show(j, F, det, win) {
      var d = j.data, doc = det.doc;
      var old = doc.getElementById('__smv_panel'); if (old) old.parentNode.removeChild(old);
      var host = doc.createElement('div'); host.id = '__smv_panel';
      host.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483000;';
      var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
      root.innerHTML = '<style>.b{width:340px;background:#fff;border:1px solid #c9d3df;border-left:5px solid #1f5fa8;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.2);padding:10px 12px;font:13px/1.6 "Meiryo UI","Yu Gothic UI",sans-serif;color:#222}' +
        '.b.ok{border-left-color:#2e7d32}.b.err{border-left-color:#c62828}.h{font-weight:bold;color:#1f5fa8;display:flex;justify-content:space-between}' +
        '.x{cursor:pointer;color:#888;border:0;background:none;font-size:15px}.m{white-space:pre-wrap;margin-top:4px}.r{display:flex;gap:6px;margin-top:8px}' +
        '.r button{flex:1;padding:6px;border:1px solid #1f5fa8;background:#1f5fa8;color:#fff;border-radius:4px;cursor:pointer;font:inherit}</style>' +
        '<div class="b"><div class="h">SMILE V 転記<button class="x" title="閉じる">✕</button></div><div class="m"></div><div class="r"></div></div>';
      doc.documentElement.appendChild(host);
      var B = root.querySelector('.b'), M = root.querySelector('.m'), R = root.querySelector('.r');
      root.querySelector('.x').onclick = function () { host.parentNode.removeChild(host); };
      function msg(t, k) { M.textContent = t; B.className = 'b ' + (k || ''); R.innerHTML = ''; }
      function btn(label, fn) { var x = doc.createElement('button'); x.textContent = label; x.onclick = fn; R.appendChild(x); }
      function run() {
        msg('転記中…');
        F.fill(d, { overwrite: true, header: true }).then(function (r) {
          msg('転記しました（' + r.rows + ' 行）。' + (r.skipped.length ? '\n入力できなかった項目：' + r.skipped.join('、') : '') +
            '\n受注No（参照）・添付を設定し、内容を確認してから「下書き保存」／「申請」してください。', 'ok');
        }).catch(function (e) {
          msg('転記できませんでした：' + e.message, 'err');
          btn('構造診断をコピー', function () {
            var ta = doc.createElement('textarea'); ta.value = JSON.stringify(F.diagnose(), null, 1); doc.body.appendChild(ta); ta.select(); doc.execCommand('copy'); ta.parentNode.removeChild(ta);
            msg('診断結果をコピーしました。Claude に貼り付けて相談してください。');
          });
        });
      }
      if (det.limit && d.limit && det.limit < d.limit) {
        return msg('SMILE V の1行の上限は ' + det.limit + ' 字です。ツールの［その他 ▾］→［設定］で文字数上限を ' + det.limit + ' にして、もう一度［SMILE V へ転記］を押してください。', 'err');
      }
      if (F.detect().rows.some(function (r) { return r.active && r.main.value.trim(); })) {
        msg('「' + j.title + '」\n打合事項に既に入力があります。上書きして転記しますか？');
        return btn('上書きして転記', run);
      }
      run();
    }
    function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  }

  BM_RUN(window.__SMV || {}, SMILE_FILLER);
})();
