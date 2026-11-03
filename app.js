/* 入金準備帳 — 画面・保存・バックアップ（データはこの端末の中だけに保存し、外部へは送信しません） */
(function () {
  'use strict';
  const C = window.KCalc;
  const KEY = 'kakeibo.data.v1';
  const META = 'kakeibo.meta.v1';
  const BACKUP_WARN_DAYS = 14;

  let state = null;
  let meta = {};
  let lastSavedAt = null;
  let todayKey = '';

  const $ = (s, r = document) => r.querySelector(s);
  const main = $('#main');
  const nf = new Intl.NumberFormat('ja-JP');

  /* ---------- 共通 ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function yen(n) { return n == null ? '未入力' : nf.format(n) + '<span class="yen">円</span>'; }
  function yenTxt(n) { return n == null ? '' : nf.format(n); }
  function md(dt) { return dt.m + '/' + dt.d; }
  function mdw(dt) { const w = C.weekday(dt); return md(dt) + '(' + C.WD[w] + ')'; }
  function isWeekend(dt) { const w = C.weekday(dt); return w === 0 || w === 6; }
  function today() { return C.fromDate(new Date()); }
  function keyOf(dt) { return dt.y + '-' + dt.m + '-' + dt.d; }
  function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function dayLabel(d) { return d === 'end' ? '月末' : d + '日'; }

  /** 金額入力の読み取り（全角数字・カンマ・円を許容。空欄は「未入力」= null） */
  function parseAmount(s) {
    const t = String(s).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/[,，円¥￥\s]/g, '');
    if (t === '') return null;
    if (!/^\d+$/.test(t)) return NaN;
    return Number(t);
  }

  /** 更新日時の表示（日付だけの値はExcelから引き継いだ日付） */
  function stampText(v) {
    if (!v) return '更新：—';
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { const [y, m, d] = v.split('-').map(Number); return '更新：' + m + '/' + d + '（Excel）'; }
    const t = new Date(v); if (isNaN(t)) return '更新：—';
    const y = t.getFullYear() !== new Date().getFullYear() ? t.getFullYear() + '/' : '';
    return '更新：' + y + (t.getMonth() + 1) + '/' + t.getDate() + ' ' + String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
  }
  function timeText(t) { return String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0'); }

  function toast(msg) {
    const el = $('#toast'); el.textContent = msg; el.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { el.hidden = true; }, 2600);
  }

  /* ---------- 保存 ---------- */
  function load() {
    try { const s = localStorage.getItem(KEY); state = s ? normalize(JSON.parse(s)) : null; } catch (e) { state = null; }
    try { meta = JSON.parse(localStorage.getItem(META) || '{}') || {}; } catch (e) { meta = {}; }
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      lastSavedAt = new Date();
      $('#saved').textContent = '自動保存 ' + timeText(lastSavedAt);
    } catch (e) {
      $('#saved').textContent = '保存できませんでした';
      toast('保存できませんでした。バックアップを保存してください');
    }
  }
  function saveMeta() { try { localStorage.setItem(META, JSON.stringify(meta)); } catch (e) { /* 表示だけの情報 */ } }

  function validDay(d) { return d === 'end' || (Number.isInteger(d) && d >= 1 && d <= 31); }
  function validAmt(a) { return a === null || (typeof a === 'number' && isFinite(a) && a >= 0); }

  /** 読み込んだデータの形をそろえる。おかしな値があれば例外 */
  function normalize(d) {
    if (!d || d.app !== 'kakeibo' || !Array.isArray(d.accounts) || !Array.isArray(d.variable) || !Array.isArray(d.fixed)) throw new Error('入金準備帳のデータではありません');
    const item = (x, fixed) => {
      const o = { id: x.id || uid(fixed ? 'f' : 'v'), name: String(x.name || '').trim() || '（名称なし）', day: x.day, account: x.account || '', amount: x.amount == null ? null : Number(x.amount), memo: x.memo || '', updatedAt: x.updatedAt || null, hidden: !!x.hidden };
      if (fixed) o.end = x.end || null;
      if (!validDay(o.day)) throw new Error('引落日が読み取れない項目があります：' + o.name);
      if (!validAmt(o.amount)) throw new Error('金額が読み取れない項目があります：' + o.name);
      return o;
    };
    const out = {
      app: 'kakeibo', version: 1, source: d.source || '',
      accounts: d.accounts.map(String),
      variable: d.variable.map(x => item(x, false)),
      fixed: d.fixed.map(x => item(x, true)),
      balances: {},
      hiddenAccounts: Array.isArray(d.hiddenAccounts) ? d.hiddenAccounts.map(String).filter(a => d.accounts.map(String).includes(a)) : [],
      income: Array.isArray(d.income) && d.income.length ? d.income.map(i => ({ id: i.id || uid('i'), name: String(i.name), day: i.day, amount: i.amount == null ? null : Number(i.amount), hidden: !!i.hidden }))
        : [{ id: 'i1', name: '直樹', day: 25, amount: null }, { id: 'i2', name: '寿美', day: 15, amount: null }]
    };
    for (const a of out.accounts) {
      const b = (d.balances || {})[a] || {};
      out.balances[a] = { amount: b.amount == null ? null : Number(b.amount), updatedAt: b.updatedAt || null };
    }
    return out;
  }

  /* ---------- 画面 ---------- */
  function renderAll() {
    const T = today(); todayKey = keyOf(T);
    $('#nav').hidden = !state;
    $('#today').textContent = T.y + '年' + T.m + '月' + T.d + '日(' + C.WD[C.weekday(T)] + ')';
    if (!state) { main.innerHTML = welcomeHTML(); bindWelcome(); return; }
    const r = C.compute(state, T);
    const page = PAGES.includes(meta.page) ? meta.page : 'prep';
    main.innerHTML = page === 'variable' ? listHTML('variable', '変動費', '毎月の金額をここで入力します。')
      : page === 'fixed' ? listHTML('fixed', '固定費', '金額・引落日・口座が変わった時だけ変更します。')
      : page === 'settings' ? settingsHTML() + backupHTML()
      : backupNoticeHTML() + summaryHTML(r) + banksHTML(r);
    $('#nav').querySelectorAll('[data-page]').forEach(b => { const on = b.dataset.page === page; b.classList.toggle('on', on); b.setAttribute('aria-current', on ? 'page' : 'false'); });
    bindAll();
    if (typeof syncTyping === 'function') syncTyping();
  }

  /** 入力中は入力欄を作り直さず、数字だけ書き換える */
  function refreshNumbers() {
    const r = C.compute(state, today());
    main.querySelectorAll('[data-sum]').forEach(el => { el.innerHTML = yen(r.totals[el.dataset.sum]); });
    const sb = $('#shortbox'); if (sb) sb.outerHTML = shortboxHTML(r);
    if (!$('#banksSec')) return;
    const shown = [...main.querySelectorAll('.bank')].map(c => c.dataset.bank).join('|');
    if (shown !== r.banks.filter(b => b.active).map(b => b.name).join('|')) {
      const sec = $('#banksSec'); sec.outerHTML = banksHTML(r); bindBalances(); return;
    }
    for (const b of r.banks) {
      const card = main.querySelector('.bank[data-bank="' + CSS.escape(b.name) + '"]');
      if (!card) continue;
      card.querySelectorAll('[data-bsum]').forEach(el => { el.innerHTML = yen(b.sums[el.dataset.bsum]); });
      const st = card.querySelector('[data-status]'); if (st) st.outerHTML = statusHTML(b);
      card.classList.toggle('is-short', b.shortfall > 0);
      const ln = card.querySelector('.line-list'); if (ln) ln.innerHTML = linesInner(b, r.windows);
      const nx = card.querySelector('.next'); if (nx) nx.innerHTML = nextHTML(b);
    }
  }

  function welcomeHTML() {
    return '<section class="welcome">' +
      '<h2>はじめに</h2>' +
      '<p>家計データはこの端末の中だけに保存します。最初に、Excelから作った初期データ（<b>家計データ_初期.json</b>）を読み込んでください。</p>' +
      '<ol><li>初期データのファイルを「ファイル」アプリに保存</li><li>下のボタンからそのファイルを選ぶ</li><li>内容を確認して「読み込む」</li></ol>' +
      '<label class="fileBtn primary">初期データ・バックアップを読み込む<input type="file" id="restoreFile" accept=".json,application/json"></label>' +
      '<p class="note">バックアップから戻すときも同じボタンを使います。</p></section>';
  }

  function backupNoticeHTML() {
    const last = meta.lastBackupAt ? new Date(meta.lastBackupAt) : null;
    const days = last ? Math.floor((Date.now() - last) / 86400000) : null;
    if (last && days < BACKUP_WARN_DAYS) return '';
    const msg = last ? '最後のバックアップから' + days + '日たちました。' : 'まだバックアップがありません。';
    return '<div class="notice"><div><b>' + msg + '</b><br>ブラウザ内の保存データは、iPhoneの設定変更や容量不足で消えることがあります。「ファイル」アプリにバックアップを保存しておいてください。</div>' +
      '<div class="btnrow"><button class="primary" data-act="backup">今すぐバックアップ</button></div></div>';
  }

  function shortboxHTML(r) {
    let cls = '', main1, sub;
    if (r.balanceMissing === r.dueCount && r.dueCount > 0) {
      cls = 'none'; main1 = '<span>残高を入力すると不足額が出ます</span>'; sub = '';
    } else if (r.shortfallTotal > 0) {
      main1 = '<span>不足の合計<small>' + md(r.closing) + '締めまでに入金が必要</small></span><span class="big num">' + yen(r.shortfallTotal) + '</span>';
    } else {
      cls = 'ok'; main1 = '<span>不足はありません<small>' + md(r.closing) + '締め・残高を入力した口座</small></span><span class="big num">0<span class="yen">円</span></span>';
    }
    const miss = r.balanceMissing > 0 && r.balanceMissing < r.dueCount ? '<div class="flag">残高未入力：' + r.balanceMissing + '口座（不足の合計に含みません）</div>' : '';
    return '<div id="shortbox"><div class="shortbox ' + cls + '">' + main1 + '</div>' + miss + '</div>';
  }

  function summaryHTML(r) {
    const per = r.windows.map(w => '<div class="period' + (w.inClose ? '' : ' after') + '"><span class="lab">' + w.label + 'に必要' + (w.inClose ? '' : '<span class="tag">締め後</span>') + '</span><span class="rng">' + md(w.from) + '〜' + md(w.to) + '</span><span class="val num" data-sum="' + w.key + '">' + yen(r.totals[w.key]) + '</span></div>').join('');
    const inc = r.income.map(i => '<div class="income-row"><span class="who">' + esc(i.name) + '</span><span class="when">' + (i.next ? mdw(i.next) + ' 予定' : '') + '</span>' +
      '<input class="amount' + (i.amount == null ? ' empty' : '') + '" inputmode="numeric" enterkeyhint="done" autocomplete="off" id="inc-' + esc(i.id) + '" data-inc="' + esc(i.id) + '" value="' + yenTxt(i.amount) + '" placeholder="金額（任意）" aria-label="' + esc(i.name) + 'の収入予定額"></div>').join('');
    return '<section class="summary" id="sec-top" aria-label="要約">' +
      '<div class="periods">' + per + '</div>' + shortboxHTML(r) +
      '<div class="income"><div class="sub">収入予定（未入金の収入は残高に足しません）</div>' + inc + '</div></section>';
  }

  function nextHTML(b) { return b.next ? '次の引落 <span class="' + (isWeekend(b.next) ? 'wkend' : '') + '">' + mdw(b.next) + '</span>' : '予定なし'; }

  function statusHTML(b) {
    if (!b.dueActive) return '<span class="pill ok" data-status>締めまで引落なし</span>';
    if (b.balance == null) return '<span class="pill none" data-status>残高未入力</span>';
    if (b.shortfall > 0) return '<span class="pill short num" data-status>不足 ' + nf.format(b.shortfall) + '円</span>';
    return '<span class="pill ok num" data-status>足りています（余り ' + nf.format(b.surplus) + '円）</span>';
  }

  function linesInner(b, W) {
    return W.map(w => {
      const ls = b.lines[w.key];
      if (!ls.length) return '<div class="wh">' + w.label + '：なし</div>';
      return '<div class="wh">' + w.label + '（' + md(w.from) + '〜' + md(w.to) + '）</div>' + ls.map(l =>
        '<div class="li"><span class="' + (isWeekend(l.date) ? 'wkend' : '') + '">' + mdw(l.date) + '</span><span>' + esc(l.name) + ' <span class="sub">' + l.kind + '</span></span><span class="num">' + (l.amount == null ? '<span class="flag">未入力</span>' : nf.format(l.amount) + '円') + '</span></div>').join('');
    }).join('');
  }

  function banksHTML(r) {
    const active = r.banks.filter(b => b.active), idle = r.banks.filter(b => !b.active);
    const cards = active.map(b => '<article class="bank' + (b.shortfall > 0 ? ' is-short' : '') + '" data-bank="' + esc(b.name) + '">' +
      '<div class="bank-head"><span class="bank-name">' + esc(b.name) + '</span><span class="next">' + nextHTML(b) + '</span></div>' +
      '<div class="bank-amts">' + r.windows.map(w => '<div class="' + (w.inClose ? '' : 'after') + '"><span class="k">' + w.label + (w.inClose ? '' : '（締め後）') + '</span><span class="v num" data-bsum="' + w.key + '">' + yen(b.sums[w.key]) + '</span></div>').join('') + '</div>' +
      (b.unentered ? '<div class="flag">金額未入力の引落が' + b.unentered + '件あります（0円として数えていません）</div>' : '') +
      '<div class="bank-foot"><label for="bal-' + esc(b.name) + '">現在残高</label><input class="amount' + (b.balance == null ? ' empty' : '') + '" inputmode="numeric" enterkeyhint="done" autocomplete="off" id="bal-' + esc(b.name) + '" data-bal="' + esc(b.name) + '" value="' + yenTxt(b.balance) + '" placeholder="未入力">' + statusHTML(b) + '</div>' +
      '<details class="lines"><summary>引落の内訳</summary><div class="line-list">' + linesInner(b, r.windows) + '</div></details>' +
      '</article>').join('');
    const idleTxt = idle.length ? '<div class="idle">この期間に引落のない口座：<b>' + idle.map(b => esc(b.name)).join('、') + '</b></div>' : '';
    return '<section id="banksSec" aria-label="銀行別の入金準備表"><div class="section-head"><h2>銀行別の入金準備</h2><span class="sub">' + r.activeCount + '口座</span></div>' +
      '<div class="banks">' + (cards || '<div class="idle">この期間の引落はありません</div>') + idleTxt + '</div>' +
      '<p class="note">集計は確認日以降の引落だけです。引落日が土日祝の場合の扱いは元のExcelに決まりがないため、日付どおりに数えています（土日は赤字）。</p></section>';
  }

  function daySelect(id, d) {
    let h = '<select id="' + id + '" aria-label="引落日">';
    for (let i = 1; i <= 31; i++) h += '<option value="' + i + '"' + (d === i ? ' selected' : '') + '>' + i + '日</option>';
    return h + '<option value="end"' + (d === 'end' ? ' selected' : '') + '>月末</option></select>';
  }
  function acctSelect(id, a) {
    const opts = state.accounts.slice(); if (a && !opts.includes(a)) opts.push(a);
    return '<select id="' + id + '" aria-label="引落口座">' + (a ? '' : '<option value="" selected>口座を選ぶ</option>') + opts.map(o => '<option' + (o === a ? ' selected' : '') + '>' + esc(o) + '</option>').join('') + '</select>';
  }

  function listHTML(kind, title, lead) {
    const T = today();
    const visible = state[kind].filter(x => !x.hidden), hiddenItems = state[kind].filter(x => x.hidden);
    if (meta.reorder === kind) {
      return '<section id="sec-' + kind + '" aria-label="' + title + '">' + headHTML(title, '表示 ' + visible.length + '件', kind) +
        '<p class="sub" style="margin:-4px 0 10px">↑↓で順番を変えます。終わったら「完了」を押してください。</p>' +
        '<div class="list">' + orderRows(kind, visible.map(it => ({ key: it.id, label: it.name, sub: dayLabel(it.day) + '・' + (it.account || '口座なし') + '・' + (it.amount == null ? '未入力' : nf.format(it.amount) + '円') }))) + '</div></section>';
    }
    const rows = visible.map(it => {
      const ended = kind === 'fixed' && it.end && !C.activeIn(it, T.y, T.m);
      return '<div class="row' + (ended ? ' ended' : '') + '" data-kind="' + kind + '" data-id="' + esc(it.id) + '">' +
        '<div class="row-main"><span class="row-name">' + esc(it.name) + '</span>' +
        '<input class="amount' + (it.amount == null ? ' empty' : '') + '" inputmode="numeric" enterkeyhint="done" autocomplete="off" id="amt-' + esc(it.id) + '" data-f="amount" value="' + yenTxt(it.amount) + '" placeholder="未入力" aria-label="' + esc(it.name) + 'の金額"></div>' +
        '<div class="row-sub">' + daySelect('day-' + esc(it.id), it.day) + acctSelect('acc-' + esc(it.id), it.account) +
        '<span class="stamp" data-stamp>' + stampText(it.updatedAt) + '</span></div>' +
        ((it.memo || it.end) ? '<div class="memo">' + (it.end ? (ended ? '終了しました（' : '終了予定 ') + it.end.replace('-', '/') + (ended ? '）' : '') + (it.memo ? '　' : '') : '') + esc(it.memo) + '</div>' : '') +
        '<div class="row-acts"><button class="ghost small" data-act="edit">名前・メモ・削除</button><button class="ghost small" data-act="hide">非表示にする</button></div>' +
        '<div class="edit" hidden data-editor>' +
        '<label>項目名<input class="text" id="nm-' + esc(it.id) + '" data-f="name" value="' + esc(it.name) + '"></label>' +
        (kind === 'fixed' ? '<label>終了月（空欄なら毎月）<input class="text" type="month" id="end-' + esc(it.id) + '" data-f="end" value="' + esc(it.end || '') + '"></label>' : '') +
        '<label>メモ<input class="text" id="memo-' + esc(it.id) + '" data-f="memo" value="' + esc(it.memo) + '"></label>' +
        '<div class="btns"><button class="danger small" data-act="del">この項目を削除</button><button class="small" data-act="close">閉じる</button></div></div>' +
        '</div>';
    }).join('');
    const hid = hiddenItems.length ? '<details class="hiddenbox"' + (meta['open-' + kind] ? ' open' : '') + ' data-kind="' + kind + '"><summary>非表示の項目 ' + hiddenItems.length + '件（計算に含みません）</summary>' +
      hiddenItems.map(it => '<div class="hrow" data-kind="' + kind + '" data-id="' + esc(it.id) + '"><span class="row-name">' + esc(it.name) + '<span class="sub">' + dayLabel(it.day) + '・' + esc(it.account || '口座なし') + '・' + (it.amount == null ? '未入力' : nf.format(it.amount) + '円') + '</span></span><button class="small" data-act="unhide">表示する</button></div>').join('') +
      '</details>' : '';
    return '<section id="sec-' + kind + '" aria-label="' + title + '">' + headHTML(title, '表示 ' + visible.length + '件', kind) +
      '<p class="sub" style="margin:-4px 0 10px">' + lead + '</p>' +
      '<div class="list">' + rows + '<div class="add"><button class="ghost" data-act="add" data-kind="' + kind + '">＋ ' + title + 'を追加</button></div></div>' + hid + '</section>';
  }

  function hiddenAcc() { return state.hiddenAccounts || (state.hiddenAccounts = []); }
  function hideBtn(isHidden, act) { return '<button class="small' + (isHidden ? ' primary' : '') + '" data-act="' + act + '">' + (isHidden ? '表示する' : '非表示') + '</button>'; }

  /* 見出し＋並び替えボタン */
  function headHTML(title, note, group) {
    const on = meta.reorder === group;
    return '<div class="section-head"><h2>' + title + '</h2><span class="head-right"><span class="sub">' + note + '</span>' +
      (group ? '<button class="small' + (on ? ' primary' : '') + '" data-reorder="' + group + '">' + (on ? '完了' : '並び替え') + '</button>' : '') + '</span></div>';
  }
  function orderRows(group, list) {
    return list.map((x, i) => '<div class="orow" data-group="' + group + '" data-key="' + esc(x.key) + '">' +
      '<span class="oname">' + esc(x.label) + (x.sub ? '<small>' + esc(x.sub) + '</small>' : '') + '</span>' +
      '<button class="small mv" data-mv="-1" aria-label="' + esc(x.label) + 'を上へ"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
      '<button class="small mv" data-mv="1" aria-label="' + esc(x.label) + 'を下へ"' + (i === list.length - 1 ? ' disabled' : '') + '>↓</button></div>').join('');
  }
  /** 隣の（表示されている）項目と入れ替える */
  function moveItem(group, key, dir) {
    let arr, keyOf, vis;
    if (group === 'accounts') { arr = state.accounts; keyOf = x => x; vis = arr.slice(); }
    else if (group === 'income') { arr = state.income; keyOf = x => x.id; vis = arr.slice(); }
    else { arr = state[group]; keyOf = x => x.id; vis = arr.filter(x => !x.hidden); }
    const i = vis.findIndex(x => keyOf(x) === key), j = i + dir;
    if (i < 0 || j < 0 || j >= vis.length) return;
    const ai = arr.indexOf(vis[i]), bi = arr.indexOf(vis[j]);
    [arr[ai], arr[bi]] = [arr[bi], arr[ai]];
    save();
    renderKeep();
    const row = main.querySelector('.orow[data-group="' + group + '"][data-key="' + CSS.escape(key) + '"]');
    if (row) { row.scrollIntoView({ block: 'nearest' }); const btn = row.querySelector('[data-mv="' + dir + '"]'); if (btn && !btn.disabled) btn.focus({ preventScroll: true }); }
  }

  const STABS = [['out', '支出'], ['in', '収入'], ['acc', '口座'], ['backup', '保存']];
  function settingsHTML() {
    const st = STABS.some(t => t[0] === meta.stab) ? meta.stab : 'out';
    const seg = '<div class="seg" role="tablist">' + STABS.map(t => '<button role="tab" aria-selected="' + (t[0] === st) + '" class="' + (t[0] === st ? 'on' : '') + '" data-stab="' + t[0] + '">' + t[1] + '</button>').join('') + '</div>';
    let body = '';
    if (st === 'out') body = outHTML();
    else if (st === 'in') body = inHTML();
    else if (st === 'acc') body = accHTML();
    else body = backupHTML();
    return '<section id="sec-settings" aria-label="設定"><div class="section-head"><h2>設定</h2></div>' + seg + '<div class="stab-body">' + body + '</div></section>';
  }

  function visibleAccounts() { return state.accounts.filter(a => !hiddenAcc().includes(a)); }

  function outHTML() {
    const kind = meta.qkind === 'fixed' ? 'fixed' : 'variable';
    const accs = visibleAccounts();
    const acc = accs.includes(meta.qacc) ? meta.qacc : '';
    const day = meta.qday === 'end' || (Number(meta.qday) >= 1 && Number(meta.qday) <= 31) ? (meta.qday === 'end' ? 'end' : Number(meta.qday)) : 27;
    return '<div class="card form">' +
      '<div class="shead">支出を追加<span class="sub">追加した項目は「' + (kind === 'fixed' ? '固定費' : '変動費') + '」ページに表示され、すぐ計算に入ります</span></div>' +
      '<div class="seg small-seg">' + [['variable', '変動費'], ['fixed', '固定費']].map(k => '<button class="' + (k[0] === kind ? 'on' : '') + '" data-qkind="' + k[0] + '">' + k[1] + '</button>').join('') + '</div>' +
      '<label>項目名<input class="text" id="qa-name" autocomplete="off" placeholder="例：楽天card寿美"></label>' +
      '<label>金額（わからなければ空欄）<input class="amount wide" id="qa-amt" inputmode="numeric" enterkeyhint="done" autocomplete="off" placeholder="未入力"></label>' +
      '<div class="two"><label>引落日' + daySelect('qa-day', day) + '</label>' +
      '<label>引落口座<select id="qa-acc" aria-label="引落口座">' + (acc ? '' : '<option value="" selected>選ぶ</option>') + accs.map(a => '<option' + (a === acc ? ' selected' : '') + '>' + esc(a) + '</option>').join('') + '</select></label></div>' +
      (kind === 'fixed' ? '<label>終了月（ローンなど。なければ空欄）<input class="text" type="month" id="qa-end"></label>' : '') +
      '<button class="primary" data-act="qadd">' + (kind === 'fixed' ? '固定費' : '変動費') + 'に追加</button>' +
      (meta.qlast ? '<p class="note" id="qa-last">追加しました：' + esc(meta.qlast) + '</p>' : '') +
      '</div>';
  }

  function inHTML() {
    const on = meta.reorder === 'income';
    const list = on ? orderRows('income', state.income.map(i => ({ key: i.id, label: i.name, sub: dayLabel(i.day) + (i.hidden ? '・非表示' : '') }))) :
      state.income.map(i => '<div class="irow' + (i.hidden ? ' is-hidden' : '') + '" data-inc-id="' + esc(i.id) + '">' +
        '<div class="irow-top"><input class="text" id="incname-' + esc(i.id) + '" value="' + esc(i.name) + '" aria-label="収入の名前">' +
        '<input class="amount" inputmode="numeric" enterkeyhint="done" autocomplete="off" id="incamt-' + esc(i.id) + '" data-inc="' + esc(i.id) + '" value="' + yenTxt(i.amount) + '" placeholder="金額" aria-label="' + esc(i.name) + 'の金額"></div>' +
        '<div class="irow-bot">' + daySelect('incday-' + esc(i.id), i.day) + '<span class="sub">に入金</span><span class="grow"></span>' + hideBtn(!!i.hidden, 'inchide') + '<button class="danger small" data-act="incdel">削除</button></div></div>').join('');
    return '<div class="card">' + '<div class="pad">' + headHTML('収入', state.income.length + '件', 'income') + '<p class="sub" style="margin:0">未入金の収入は口座残高に足しません。非表示にすると準備ページに出ません。</p></div>' +
      list + (on ? '' :
      '<div class="form addform"><div class="shead">収入を追加</div>' +
      '<label>名前<input class="text" id="inc-new-name" autocomplete="off" placeholder="例：児童手当"></label>' +
      '<div class="two"><label>入金日' + daySelect('inc-new-day', 25) + '</label><label>金額（任意）<input class="amount wide" id="inc-new-amt" inputmode="numeric" enterkeyhint="done" autocomplete="off" placeholder="未入力"></label></div>' +
      '<button class="primary" data-act="incadd">収入に追加</button></div>') + '</div>';
  }

  function accHTML() {
    const on = meta.reorder === 'accounts';
    const used = name => state.variable.concat(state.fixed).filter(x => x.account === name).length;
    const list = on ? orderRows('accounts', state.accounts.map(a => ({ key: a, label: a, sub: used(a) + '件' + (hiddenAcc().includes(a) ? '・非表示' : '') }))) :
      state.accounts.map((a, i) => '<div class="srow' + (hiddenAcc().includes(a) ? ' is-hidden' : '') + '" data-acc-i="' + i + '">' +
        '<input class="text" id="accname-' + i + '" value="' + esc(a) + '" aria-label="口座名">' +
        '<span class="sub nowrap">' + used(a) + '件</span>' +
        hideBtn(hiddenAcc().includes(a), 'acchide') +
        '<button class="danger small" data-act="accdel">削除</button></div>').join('');
    return '<div class="card">' + '<div class="pad">' + headHTML('口座', state.accounts.length + '口座', 'accounts') +
      '<p class="sub" style="margin:0">並び順は準備ページの銀行の順番になります。名前を変えると、その口座の引落もまとめて変わります。</p></div>' +
      list + (on ? '' : '<div class="srow add-row"><input class="text" id="accnew" placeholder="新しい口座名" aria-label="新しい口座名"><button class="small" data-act="accadd">追加</button></div>') + '</div>';
  }

  function bindSettings() {
    main.querySelectorAll('[data-stab]').forEach(b => b.addEventListener('click', () => { meta.stab = b.dataset.stab; meta.reorder = null; saveMeta(); renderAll(); window.scrollTo(0, 0); }));
    // 支出の追加
    main.querySelectorAll('[data-qkind]').forEach(b => b.addEventListener('click', () => { meta.qkind = b.dataset.qkind; saveMeta(); keepForm(() => renderKeep()); }));
    const qadd = main.querySelector('[data-act="qadd"]');
    if (qadd) {
      const amt = $('#qa-amt');
      amt.addEventListener('blur', () => { const v = parseAmount(amt.value); if (!Number.isNaN(v)) amt.value = yenTxt(v); });
      $('#qa-day').addEventListener('change', e => { meta.qday = e.target.value === 'end' ? 'end' : Number(e.target.value); saveMeta(); });
      $('#qa-acc').addEventListener('change', e => { meta.qacc = e.target.value; saveMeta(); });
      qadd.addEventListener('click', () => {
        const kind = meta.qkind === 'fixed' ? 'fixed' : 'variable';
        const name = $('#qa-name').value.trim();
        const v = parseAmount(amt.value);
        const acc = $('#qa-acc').value;
        const dv = $('#qa-day').value; const day = dv === 'end' ? 'end' : Number(dv);
        if (!name) { toast('項目名を入力してください'); $('#qa-name').focus(); return; }
        if (Number.isNaN(v)) { toast('金額は数字で入力してください'); amt.focus(); return; }
        if (!acc) { toast('引落口座を選んでください'); return; }
        const it = { id: uid(kind === 'fixed' ? 'f' : 'v'), name, day, account: acc, amount: v, memo: '', updatedAt: new Date().toISOString(), hidden: false };
        if (kind === 'fixed') { const e = $('#qa-end'); it.end = e && e.value ? e.value : null; }
        state[kind].push(it); save();
        meta.qacc = acc; meta.qday = day;
        meta.qlast = name + '（' + (kind === 'fixed' ? '固定費' : '変動費') + '・' + dayLabel(day) + '・' + acc + '・' + (v == null ? '金額未入力' : nf.format(v) + '円') + '）';
        saveMeta(); renderKeep(); toast('「' + name + '」を追加しました');
      });
    }
    // 収入
    main.querySelectorAll('[data-inc-id]').forEach(row => {
      const inc = state.income.find(x => x.id === row.dataset.incId);
      row.querySelector('input.text').addEventListener('change', e => { const n = e.target.value.trim(); if (!n) { e.target.value = inc.name; return; } inc.name = n; save(); renderKeep(); });
      row.querySelector('select').addEventListener('change', e => { inc.day = e.target.value === 'end' ? 'end' : Number(e.target.value); save(); renderKeep(); });
      row.querySelector('[data-act="inchide"]').addEventListener('click', () => { inc.hidden = !inc.hidden; save(); renderKeep(); toast(inc.hidden ? '「' + inc.name + '」を非表示にしました' : '「' + inc.name + '」を表示しました'); });
      row.querySelector('[data-act="incdel"]').addEventListener('click', () => confirmSheet('収入「' + inc.name + '」を削除しますか？', '', '削除する', () => {
        state.income = state.income.filter(x => x.id !== inc.id); save(); renderKeep(); toast('削除しました');
      }, true));
    });
    const incadd = main.querySelector('[data-act="incadd"]');
    if (incadd) {
      const amt = $('#inc-new-amt');
      amt.addEventListener('blur', () => { const v = parseAmount(amt.value); if (!Number.isNaN(v)) amt.value = yenTxt(v); });
      incadd.addEventListener('click', () => {
        const n = $('#inc-new-name').value.trim(); const v = parseAmount(amt.value);
        const dv = $('#inc-new-day').value;
        if (!n) { toast('収入の名前を入力してください'); return; }
        if (Number.isNaN(v)) { toast('金額は数字で入力してください'); return; }
        state.income.push({ id: uid('i'), name: n, day: dv === 'end' ? 'end' : Number(dv), amount: v, hidden: false });
        save(); renderKeep(); toast('「' + n + '」を追加しました');
      });
    }
    // 口座
    main.querySelectorAll('[data-acc-i]').forEach(row => {
      const i = Number(row.dataset.accI); const old = state.accounts[i];
      row.querySelector('input').addEventListener('change', e => {
        const n = e.target.value.trim();
        if (n === old) return;
        if (!n) { e.target.value = old; toast('口座名を入力してください'); return; }
        if (state.accounts.includes(n)) { e.target.value = old; toast('同じ名前の口座があります'); return; }
        state.accounts[i] = n;
        let cnt = 0;
        for (const it of state.variable.concat(state.fixed)) if (it.account === old) { it.account = n; cnt++; }
        state.balances[n] = state.balances[old] || { amount: null, updatedAt: null }; delete state.balances[old];
        state.hiddenAccounts = hiddenAcc().map(a => a === old ? n : a);
        if (meta.qacc === old) { meta.qacc = n; saveMeta(); }
        save(); renderKeep(); toast('「' + n + '」に変更しました（引落' + cnt + '件）');
      });
      row.querySelector('[data-act="acchide"]').addEventListener('click', () => {
        const h = hiddenAcc(); const on = h.includes(old);
        state.hiddenAccounts = on ? h.filter(a => a !== old) : h.concat(old);
        save(); renderKeep(); toast(on ? '「' + old + '」を表示しました' : '「' + old + '」を非表示にしました（計算に含みません）');
      });
      row.querySelector('[data-act="accdel"]').addEventListener('click', () => {
        const uses = state.variable.concat(state.fixed).filter(x => x.account === old);
        if (uses.length) {
          confirmSheet('「' + old + '」は削除できません', '<p class="sub" style="margin:0">この口座を使っている引落が' + uses.length + '件あります（' + uses.slice(0, 5).map(x => esc(x.name)).join('、') + (uses.length > 5 ? ' ほか' : '') + '）。先に変動費・固定費で別の口座に変えてください。</p>', null, null);
          return;
        }
        confirmSheet('「' + old + '」を削除しますか？', '<p class="sub" style="margin:0">入力した残高も消えます。</p>', '削除する', () => {
          state.accounts = state.accounts.filter(a => a !== old); delete state.balances[old]; state.hiddenAccounts = hiddenAcc().filter(a => a !== old); save(); renderKeep(); toast('削除しました');
        }, true);
      });
    });
    const accadd = main.querySelector('[data-act="accadd"]');
    if (accadd) accadd.addEventListener('click', () => {
      const n = $('#accnew').value.trim();
      if (!n) { toast('口座名を入力してください'); return; }
      if (state.accounts.includes(n)) { toast('同じ名前の口座があります'); return; }
      state.accounts.push(n); state.balances[n] = { amount: null, updatedAt: null }; save(); renderKeep(); toast('「' + n + '」を追加しました');
    });
  }

  /** 追加フォームの入力途中の内容を残したまま描き直す */
  function keepForm(fn) {
    const keep = {}; ['qa-name', 'qa-amt'].forEach(id => { const el = $('#' + id); if (el) keep[id] = el.value; });
    fn();
    Object.keys(keep).forEach(id => { const el = $('#' + id); if (el) el.value = keep[id]; });
  }

  function backupHTML() {
    const last = meta.lastBackupAt ? stampText(meta.lastBackupAt).replace('更新：', '') : 'まだありません';
    return '<section class="backup" id="sec-backup" aria-label="バックアップ"><h2>バックアップ</h2>' +
      '<p class="sub" style="margin:0">入力内容は自動でこの端末に保存されます。ただしブラウザ内の保存データは消える可能性があるため、月に1回は「ファイル」アプリに保存してください。</p>' +
      '<div class="sub">最後のバックアップ：' + last + '</div>' +
      '<div class="btnrow"><button class="primary" data-act="backup">バックアップを保存</button>' +
      '<label class="fileBtn">バックアップから復元<input type="file" id="restoreFile" accept=".json,application/json"></label></div>' +
      '<p class="note">保存先で「“ファイル”に保存」を選んでください。復元すると、今の内容は確認のあと上書きされます。</p></section>';
  }

  /* ---------- 操作 ---------- */
  function findItem(row) { return state[row.dataset.kind].find(x => x.id === row.dataset.id); }
  function touch(it, row) { it.updatedAt = new Date().toISOString(); const s = row.querySelector('[data-stamp]'); if (s) { s.textContent = stampText(it.updatedAt); s.classList.add('fresh'); } }

  function onAmountInput(el, get, set, after) {
    const v = parseAmount(el.value);
    if (Number.isNaN(v)) { el.setCustomValidity('数字で入力してください'); return; }
    el.setCustomValidity('');
    if (v === get()) return;
    set(v); el.classList.toggle('empty', v == null);
    if (after) after();
    save(); refreshNumbers();
  }

  function bindAll() {
    main.querySelectorAll('.row').forEach(row => {
      const it = findItem(row);
      const amt = row.querySelector('[data-f="amount"]');
      amt.addEventListener('input', () => onAmountInput(amt, () => it.amount, v => { it.amount = v; }, () => touch(it, row)));
      amt.addEventListener('blur', () => { const v = parseAmount(amt.value); if (!Number.isNaN(v)) amt.value = yenTxt(v); });
      row.querySelector('select[id^="day-"]').addEventListener('change', e => { it.day = e.target.value === 'end' ? 'end' : Number(e.target.value); touch(it, row); save(); renderKeep(); });
      row.querySelector('select[id^="acc-"]').addEventListener('change', e => { it.account = e.target.value; touch(it, row); save(); renderKeep(); });
      const ed = row.querySelector('[data-editor]');
      row.querySelector('[data-act="edit"]').addEventListener('click', () => { ed.hidden = !ed.hidden; });
      row.querySelector('[data-act="close"]').addEventListener('click', () => { ed.hidden = true; });
      row.querySelector('[data-f="name"]').addEventListener('change', e => { const n = e.target.value.trim(); if (!n || n === it.name) return; it.name = n; touch(it, row); save(); renderKeep(); });
      row.querySelector('[data-f="memo"]').addEventListener('change', e => { it.memo = e.target.value; save(); renderKeep(); });
      const end = row.querySelector('[data-f="end"]');
      if (end) end.addEventListener('change', e => { it.end = e.target.value || null; touch(it, row); save(); renderKeep(); });
      row.querySelector('[data-act="del"]').addEventListener('click', () => confirmSheet('「' + it.name + '」を削除しますか？', '<p class="sub" style="margin:0">' + dayLabel(it.day) + '・' + esc(it.account) + '・' + (it.amount == null ? '未入力' : nf.format(it.amount) + '円') + '</p>', '削除する', () => {
        state[row.dataset.kind] = state[row.dataset.kind].filter(x => x.id !== it.id); save(); renderKeep(); toast('削除しました');
      }, true));
    });
    main.querySelectorAll('.row [data-act="hide"]').forEach(btn => btn.addEventListener('click', () => {
      const row = btn.closest('.row'); const it = findItem(row);
      it.hidden = true; save(); renderKeep(); toast('「' + it.name + '」を非表示にしました（計算に含みません）');
    }));
    main.querySelectorAll('.hrow [data-act="unhide"]').forEach(btn => btn.addEventListener('click', () => {
      const row = btn.closest('.hrow'); const it = findItem(row);
      it.hidden = false; save(); renderKeep(); toast('「' + it.name + '」を表示しました');
    }));
    main.querySelectorAll('details.hiddenbox').forEach(d => d.addEventListener('toggle', () => { meta['open-' + d.dataset.kind] = d.open; saveMeta(); }));
    bindBalances();
    main.querySelectorAll('[data-inc]').forEach(el => {
      const inc = state.income.find(i => i.id === el.dataset.inc);
      el.addEventListener('input', () => onAmountInput(el, () => inc.amount, v => { inc.amount = v; }));
      el.addEventListener('blur', () => { const v = parseAmount(el.value); if (!Number.isNaN(v)) el.value = yenTxt(v); });
    });
    main.querySelectorAll('[data-act="add"]').forEach(btn => btn.addEventListener('click', () => {
      meta.page = 'settings'; meta.stab = 'out'; meta.qkind = btn.dataset.kind; meta.reorder = null; saveMeta(); renderAll(); window.scrollTo(0, 0);
      const nm = $('#qa-name'); if (nm) nm.focus();
    }));
    main.querySelectorAll('[data-act="backup"]').forEach(b => b.addEventListener('click', doBackup));
    main.querySelectorAll('[data-reorder]').forEach(b => b.addEventListener('click', () => {
      meta.reorder = meta.reorder === b.dataset.reorder ? null : b.dataset.reorder; saveMeta(); renderKeep();
    }));
    main.querySelectorAll('.orow [data-mv]').forEach(b => b.addEventListener('click', () => {
      const row = b.closest('.orow'); moveItem(row.dataset.group, row.dataset.key, Number(b.dataset.mv));
    }));
    bindSettings();
    bindRestore();
  }
  function bindBalances() {
    main.querySelectorAll('[data-bal]').forEach(el => {
      const name = el.dataset.bal; const b = state.balances[name] || (state.balances[name] = { amount: null, updatedAt: null });
      el.addEventListener('input', () => onAmountInput(el, () => b.amount, v => { b.amount = v; b.updatedAt = new Date().toISOString(); }));
      el.addEventListener('blur', () => { const v = parseAmount(el.value); if (!Number.isNaN(v)) el.value = yenTxt(v); });
    });
  }
  function bindWelcome() { bindRestore(); }
  function bindRestore() { const f = $('#restoreFile'); if (f) f.addEventListener('change', onRestoreFile); }

  /** 開いている編集欄とスクロール位置を保ったまま描き直す */
  function renderKeep() {
    const y = window.scrollY;
    const open = [...main.querySelectorAll('[data-editor]:not([hidden])')].map(e => e.closest('.row').dataset.id);
    renderAll();
    open.forEach(id => { const r = main.querySelector('.row[data-id="' + id + '"] [data-editor]'); if (r) r.hidden = false; });
    window.scrollTo(0, y);
  }

  /* ---------- 確認シート（ブラウザ標準の確認ダイアログは使わない） ---------- */
  function confirmSheet(title, bodyHTML, okLabel, onOk, danger) {
    const m = $('#modal');
    m.innerHTML = '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="mt"><h2 id="mt">' + esc(title) + '</h2>' + bodyHTML +
      '<div class="btnrow"><button id="mCancel">' + (okLabel ? 'やめる' : '閉じる') + '</button>' + (okLabel ? '<button id="mOk" class="' + (danger ? 'danger' : 'primary') + '">' + esc(okLabel) + '</button>' : '') + '</div></div>';
    m.hidden = false;
    const close = () => { m.hidden = true; m.innerHTML = ''; };
    $('#mCancel').onclick = close;
    m.onclick = e => { if (e.target === m) close(); };
    if (okLabel) $('#mOk').onclick = () => { close(); onOk(); };
    $('#mCancel').focus();
  }

  /* ---------- バックアップ ---------- */
  function stampFile(t) { const p = n => String(n).padStart(2, '0'); return t.getFullYear() + p(t.getMonth() + 1) + p(t.getDate()) + '-' + p(t.getHours()) + p(t.getMinutes()); }
  async function doBackup() {
    const now = new Date();
    const data = Object.assign({}, state, { exportedAt: now.toISOString() });
    const name = '家計バックアップ_' + stampFile(now) + '.json';
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const done = () => { meta.lastBackupAt = now.toISOString(); saveMeta(); renderKeep(); toast('バックアップを作りました'); };
    try {
      const file = new File([blob], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        done(); return;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') { toast('バックアップをやめました'); return; }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    done();
  }

  function onRestoreFile(e) {
    const f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      let d;
      try { d = normalize(JSON.parse(String(rd.result))); } catch (err) { toast('読み込めませんでした：' + (err.message || 'ファイルの形式が違います')); return; }
      const sum = a => a.reduce((s, x) => s + (x.amount || 0), 0);
      const raw = JSON.parse(String(rd.result));
      const when = raw.exportedAt ? stampText(raw.exportedAt).replace('更新：', '') : (raw.source ? raw.source + ' から作成' : '不明');
      const body = '<dl><dt>ファイル</dt><dd>' + esc(f.name) + '</dd><dt>作成</dt><dd>' + esc(when) + '</dd>' +
        '<dt>変動費</dt><dd>' + d.variable.length + '件・' + nf.format(sum(d.variable)) + '円</dd>' +
        '<dt>固定費</dt><dd>' + d.fixed.length + '件・' + nf.format(sum(d.fixed)) + '円</dd>' +
        '<dt>口座</dt><dd>' + d.accounts.length + '口座</dd></dl>' +
        (state ? '<p class="flag" style="margin:0">今アプリに入っている内容（変動費' + state.variable.length + '件・固定費' + state.fixed.length + '件、口座残高を含む）は上書きされ、元に戻せません。</p>' : '');
      confirmSheet(state ? 'このバックアップで上書きしますか？' : 'このデータを読み込みますか？', body, state ? '上書きして復元' : '読み込む', () => {
        state = d; save(); renderAll(); window.scrollTo(0, 0); toast('読み込みました');
      }, !!state);
    };
    rd.onerror = () => toast('ファイルを読めませんでした');
    rd.readAsText(f);
  }

  /* ---------- 移動ボタン ---------- */
  const PAGES = ['prep', 'variable', 'fixed', 'settings'];
  const TYPING = 'input:not([type="file"]):not([type="button"]), select, textarea';
  // 指が触れている間は下のタブを出し入れしない（ボタンを押した瞬間にタブが重なるのを防ぐ）
  let pointerDown = false;
  document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
  const pointerEnd = () => { pointerDown = false; setTimeout(syncTyping, 120); };
  document.addEventListener('pointerup', pointerEnd, true);
  document.addEventListener('pointercancel', pointerEnd, true);
  function syncTyping() {
    if (pointerDown) return;
    const a = document.activeElement;
    document.body.classList.toggle('typing', !!(a && a.isConnected && a !== document.body && a.matches(TYPING)));
  }
  const nav = $('#nav');
  nav.addEventListener('click', e => {
    const b = e.target.closest('[data-page]'); if (!b) return;
    if (meta.page === b.dataset.page) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    meta.page = b.dataset.page; meta.reorder = null; saveMeta(); renderAll(); window.scrollTo(0, 0);
  });
  // 入力中はキーボードと重ならないよう隠す（ファイル選択は除く。描き直しで入力欄が消えた時も戻す）
  document.addEventListener('focusin', () => syncTyping());
  document.addEventListener('focusout', () => setTimeout(syncTyping, 120));
  window.addEventListener('focus', () => syncTyping());
  window.addEventListener('pageshow', () => syncTyping());

  /* ---------- 起動 ---------- */
  load();
  renderAll();
  if (state) $('#saved').textContent = '保存済み';
  // 日付が変わったら確認日と集計を更新（入力中は邪魔しない）
  const tick = () => { if (keyOf(today()) !== todayKey && !(document.activeElement && document.activeElement.matches('input,select'))) renderKeep(); };
  setInterval(tick, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { tick(); syncTyping(); } });
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
