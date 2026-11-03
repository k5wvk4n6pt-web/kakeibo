/* 家計の入金準備 — 計算ロジック（画面から独立。node でもテストできる） */
(function (root) {
  'use strict';

  const WD = ['日', '月', '火', '水', '木', '金', '土'];

  function lastDay(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); } // m: 1-12
  function serial(dt) { return Date.UTC(dt.y, dt.m - 1, dt.d); }
  function addMonth(y, m, n) { const t = (y * 12 + (m - 1)) + n; return { y: Math.floor(t / 12), m: (t % 12) + 1 }; }
  function weekday(dt) { return new Date(Date.UTC(dt.y, dt.m - 1, dt.d)).getUTCDay(); }
  function fromDate(d) { return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() }; }

  /** その月の引落日（月末・31日などは月の最終日に合わせる） */
  function occurrence(item, y, m) {
    const ld = lastDay(y, m);
    const d = item.day === 'end' ? ld : Math.min(Number(item.day), ld);
    return { y, m, d };
  }

  /** 終了月（"2026-12" など）を過ぎた月の引落は数えない */
  function activeIn(item, y, m) {
    if (!item.end) return true;
    const [ey, em] = String(item.end).split('-').map(Number);
    if (!ey || !em) return true;
    return y * 12 + m <= ey * 12 + em;
  }

  /**
   * 集計期間（重複なし・確認日から連続）
   *  確認日が1〜10日 : ①確認日〜当月10日  ②当月11日〜月末
   *  確認日が11日以降: ①確認日〜当月末    ②翌月1日〜翌月10日
   * 過不足は10日締め：確認日から次の10日（締め日）までの引落で判定する（inClose）
   */
  function windows(T) {
    const ld = lastDay(T.y, T.m);
    if (T.d <= 10) {
      return [
        { key: 'w10', label: '10日まで', from: T, to: { y: T.y, m: T.m, d: 10 }, inClose: true },
        { key: 'wEnd', label: '月末まで', from: { y: T.y, m: T.m, d: 11 }, to: { y: T.y, m: T.m, d: ld }, inClose: false }
      ];
    }
    const n = addMonth(T.y, T.m, 1);
    return [
      { key: 'wEnd', label: '月末まで', from: T, to: { y: T.y, m: T.m, d: ld }, inClose: true },
      { key: 'w10', label: '翌10日まで', from: { y: n.y, m: n.m, d: 1 }, to: { y: n.y, m: n.m, d: 10 }, inClose: true }
    ];
  }

  /** 期間内の引落（1項目につき月1回。期間は最大2か月にまたがる） */
  function occurrencesIn(item, from, to) {
    const out = [];
    const months = [{ y: from.y, m: from.m }];
    if (from.y !== to.y || from.m !== to.m) months.push({ y: to.y, m: to.m });
    for (const ym of months) {
      if (!activeIn(item, ym.y, ym.m)) continue;
      const o = occurrence(item, ym.y, ym.m);
      const s = serial(o);
      if (s >= serial(from) && s <= serial(to)) out.push(o);
    }
    return out;
  }

  /** 確認日以降で最初の引落日（金額0の項目は除く。未入力は含める） */
  function nextDate(item, T) {
    for (let i = 0; i < 3; i++) {
      const ym = addMonth(T.y, T.m, i);
      if (!activeIn(item, ym.y, ym.m)) continue;
      const o = occurrence(item, ym.y, ym.m);
      if (serial(o) >= serial(T)) return o;
    }
    return null;
  }

  function compute(data, T) {
    const W = windows(T);
    // 非表示の項目・口座・収入は計算に含めない
    const hiddenAcc = new Set(data.hiddenAccounts || []);
    const items = []
      .concat((data.variable || []).filter(x => !x.hidden).map(x => Object.assign({ kind: '変動費' }, x)))
      .concat((data.fixed || []).filter(x => !x.hidden).map(x => Object.assign({ kind: '固定費' }, x)));
    const banks = (data.accounts || []).filter(a => !hiddenAcc.has(a)).map(name => {
      const bal = (data.balances || {})[name] || {};
      const b = { name, sums: {}, lines: {}, unentered: 0, unenteredDue: 0, next: null, balance: bal.amount == null ? null : Number(bal.amount), balanceUpdatedAt: bal.updatedAt || null };
      for (const w of W) { b.sums[w.key] = 0; b.lines[w.key] = []; }
      for (const it of items) {
        if (it.account !== name) continue;
        for (const w of W) {
          for (const o of occurrencesIn(it, w.from, w.to)) {
            if (it.amount == null) { b.unentered++; if (w.inClose) b.unenteredDue++; }
            else b.sums[w.key] += Number(it.amount);
            b.lines[w.key].push({ date: o, name: it.name, amount: it.amount, kind: it.kind });
          }
        }
        if (it.amount !== 0) {
          const nd = nextDate(it, T);
          if (nd && (!b.next || serial(nd) < serial(b.next))) b.next = nd;
        }
      }
      for (const w of W) b.lines[w.key].sort((a, c) => serial(a.date) - serial(c.date));
      b.total = W.reduce((s, w) => s + b.sums[w.key], 0);
      b.due = W.filter(w => w.inClose).reduce((s, w) => s + b.sums[w.key], 0);
      b.shortfall = b.balance == null ? null : Math.max(0, b.due - b.balance);
      b.surplus = b.balance == null ? null : Math.max(0, b.balance - b.due);
      b.active = b.total > 0 || b.unentered > 0;
      b.dueActive = b.due > 0 || b.unenteredDue > 0;
      return b;
    });
    const totals = {};
    for (const w of W) totals[w.key] = banks.reduce((s, b) => s + b.sums[w.key], 0);
    const entered = banks.filter(b => b.dueActive && b.balance != null);
    const closeWin = W.find(w => w.key === 'w10');
    return {
      T, windows: W, banks, totals, closing: closeWin.to,
      dueTotal: banks.reduce((s, b) => s + b.due, 0),
      dueCount: banks.filter(b => b.dueActive).length,
      grandTotal: banks.reduce((s, b) => s + b.total, 0),
      shortfallTotal: entered.reduce((s, b) => s + b.shortfall, 0),
      activeCount: banks.filter(b => b.active).length,
      balanceMissing: banks.filter(b => b.dueActive && b.balance == null).length,
      income: (data.income || []).filter(i => !i.hidden).map(i => Object.assign({}, i, { next: nextDate(i, T) }))
        .sort((a, c) => serial(a.next) - serial(c.next))
    };
  }

  const api = { WD, lastDay, serial, addMonth, weekday, fromDate, occurrence, activeIn, windows, occurrencesIn, nextDate, compute };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.KCalc = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
