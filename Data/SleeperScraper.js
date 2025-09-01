(async () => {
  // ---------- Config ----------
  const ITEM_SEL = '.draft_auction_results_item';
  const WAIT_MS = 200;          // pause between scroll steps
  const STABLE_PASSES = 6;      // stop after this many passes with no new rows
  const MAX_STEPS = 2000;       // hard safety cap

  // ---------- Helpers ----------
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const txt = (root, sel) => (root.querySelector(sel)?.textContent || '').trim();
  const digits = s => (s || '').replace(/[^\d.-]/g, '');
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;

  // Try to locate a sensible scroll container near the first item
  const firstItem = document.querySelector(ITEM_SEL);
  if (!firstItem) {
    console.warn(`No ${ITEM_SEL} found on the page.`);
    return;
  }

  const getScrollContainer = (el) => {
    let n = el.parentElement;
    while (n) {
      const st = getComputedStyle(n);
      const isScrollable = /(auto|scroll)/.test(st.overflowY);
      if (isScrollable && n.scrollHeight > n.clientHeight + 5) return n;
      n = n.parentElement;
    }
    return document.scrollingElement || document.documentElement; // fallback: window
  };
  const sc = getScrollContainer(firstItem);
  const isWindow = (sc === document.scrollingElement || sc === document.documentElement);

  // Field extraction (tuned to Sleeper’s markup)
  function extractRow(el) {
    const amountRaw = txt(el, '.offerNumberText');
    const avatar = el.querySelector('.avatar-player[class*="avatar-nfl-"]');
    const teamCode = avatar
      ? ([...avatar.classList].find(c => c.startsWith('avatar-nfl-')) || '')
          .replace('avatar-nfl-','').toUpperCase()
      : '';

    const row = {
      pick: Number(txt(el, '.pickNumberText')) || '',
      player: txt(el, '.playerNameText'),
      position: txt(el, '.playerInfoText'),
      team: teamCode,
      bidder: txt(el, '.userNameText'),
      amount: digits(amountRaw),
    };

    // Stable-ish key for dedup across virtualization
    const key = [row.pick, row.player, row.amount, row.bidder].join('|');
    return { key, row };
  }

  // Collector (Map ensures uniqueness)
  const seen = new Map();
  const harvest = () => {
    document.querySelectorAll(ITEM_SEL).forEach(el => {
      const { key, row } = extractRow(el);
      if (!seen.has(key)) seen.set(key, row);
    });
  };

  // Initial harvest
  harvest();

  // ---------- Scroll traversal ----------
  let stable = 0;
  let steps = 0;

  // helper getters/setters for scrollTop/Max
  const getTop = () => isWindow ? window.scrollY : sc.scrollTop;
  const setTop = (v) => isWindow ? window.scrollTo(0, v) : (sc.scrollTop = v);
  const getMax = () => isWindow
    ? (document.scrollingElement || document.documentElement).scrollHeight - window.innerHeight
    : sc.scrollHeight - sc.clientHeight;

  // To also catch items replaced above, do a quick sweep: top -> bottom -> top
  async function sweep(direction = 'down') {
    stable = 0;
    let lastCount = seen.size;
    let lastTop = -1;

    for (steps = 0; steps < MAX_STEPS; steps++) {
      // Move
      const max = getMax();
      const top = getTop();
      const delta = Math.max(64, (isWindow ? window.innerHeight : sc.clientHeight) - 40);
      const next = direction === 'down'
        ? Math.min(top + delta, max)
        : Math.max(top - delta, 0);

      setTop(next);
      await sleep(WAIT_MS);

      // Collect
      harvest();

      // Progress checks
      const nowTop = getTop();
      const nowCount = seen.size;

      const progressed = (nowTop !== lastTop) || (nowCount > lastCount);
      lastTop = nowTop;
      lastCount = nowCount;

      if (!progressed) {
        stable++;
        if (stable >= STABLE_PASSES) break;
      } else {
        stable = 0;
      }

      // Stop at edges
      if ((direction === 'down' && nowTop >= max) ||
          (direction === 'up' && nowTop <= 0)) {
        // Give a couple extra passes for late mounts
        let pad = 3;
        while (pad--) { await sleep(WAIT_MS); harvest(); }
        break;
      }
    }
  }

  // Full traversal: down then up then down (covers recycled windows)
  await sweep('down');
  await sweep('up');
  await sweep('down');

  // ---------- Emit CSV ----------
  const rows = [...seen.values()]
    .map((r, i) => ({ index: i + 1, ...r }))
    .sort((a, b) => (a.pick || 1e9) - (b.pick || 1e9) || a.index - b.index);

  const headers = ['index','pick','player','position','team','bidder','amount'];
  const csv = [
    headers.join(','),
    ...rows.map(r => headers.map(h => esc(r[h])).join(','))
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: 'auction_results.csv' });
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);

  console.log(`Exported ${rows.length} unique rows to auction_results.csv`);
})();



(async () => {
    // ---------- Config ----------
    const ITEM_SEL = '.player-list-item';
    const WAIT_MS = 200;           // pause between scroll steps
    const STABLE_PASSES = 6;       // stop after N passes with no new rows
    const MAX_STEPS = 4000;        // hard cap
    const MIN_STEP = 64;           // px per step (min)
  
    // ---------- Helpers ----------
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const t = el => (el?.textContent || '').trim();
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const pickNum = s => {
      const m = /top:\s*([\d.]+)px/.exec(s || '');
      return m ? Math.round(+m[1] / 52) + 1 : '';
    };
  
    const firstItem = document.querySelector(ITEM_SEL);
    if (!firstItem) { console.warn(`No ${ITEM_SEL} found.`); return; }
  
    // nearest scrollable ancestor; fallback to window
    const getScrollContainer = (el) => {
      let n = el.parentElement;
      while (n) {
        const st = getComputedStyle(n);
        if (/(auto|scroll)/.test(st.overflowY) && n.scrollHeight > n.clientHeight + 5) return n;
        n = n.parentElement;
      }
      return document.scrollingElement || document.documentElement;
    };
    const grid = firstItem.closest('[aria-label="grid"], .ReactVirtualized__Grid') || firstItem;
    const sc = getScrollContainer(grid);
    const isWindow = (sc === document.scrollingElement || sc === document.documentElement);
  
    const getTop = () => isWindow ? window.scrollY : sc.scrollTop;
    const setTop = v => isWindow ? window.scrollTo(0, v) : (sc.scrollTop = v);
    const getMax = () => isWindow
      ? (document.scrollingElement || document.documentElement).scrollHeight - window.innerHeight
      : sc.scrollHeight - sc.clientHeight;
  
    // Read stat headers once (labels above the grid)
    const STAT_HEADERS = (() => {
      const labs = [...document.querySelectorAll('.player-list-container .label.all span, .player-list-container .label.all')]
        .map(el => t(el instanceof HTMLSpanElement ? el : el.querySelector('span') || el))
        .map(s => s.replace(/,/g, '').trim())
        .filter(Boolean);
      // Dedup consecutive repeats just in case
      return labs;
    })();
  
    // Field extraction for one row
    function extractRow(el) {
      // row index from the absolute-positioned wrapper (ReactVirtualized)
      const wrapper = el.parentElement; // has style="top: Npx"
      const index = pickNum(wrapper?.getAttribute('style') || '');
  
      const shortName = t(el.querySelector('.scrolled-name'));
      const name = t(el.querySelector('.name'));
      const posRaw = t(el.querySelector('.position'));      // e.g., "QB - BUF(7)"
      let position = '', team = '', bye_week = '';
      const m = posRaw.match(/^([A-Z]+)\s*-\s*([A-Z]+)\((\d+)\)$/);
      if (m) { position = m[1]; team = m[2]; bye_week = m[3]; } else { position = posRaw; }
  
      const injury_text = t(el.querySelector('.injury-status'));
      const injury_class = (el.querySelector('.injury-status')?.className || '').replace(/\s+/g, ' ').trim();
      const game_status = t(el.querySelector('.game-schedule-live-description'));
  
      const statCells = [...el.querySelectorAll('.cell.all')].map(c => t(c));
      const stats = {};
      if (STAT_HEADERS.length === statCells.length) {
        STAT_HEADERS.forEach((h, i) => { stats[h] = statCells[i]; });
      } else {
        statCells.forEach((v, i) => { stats[`stat_${i+1}`] = v; });
      }
  
      const key = `${index}|${name}|${position}|${team}`;
      return { key, row: { index, short_name: shortName, name, position, team, bye_week, injury_text, injury_class, game_status, ...stats } };
    }
  
    // Collector
    const seen = new Map();
    const harvest = () => {
      document.querySelectorAll(ITEM_SEL).forEach(el => {
        const { key, row } = extractRow(el);
        if (!seen.has(key)) seen.set(key, row);
      });
    };
  
    // ---------- Traverse ----------
    harvest();
  
    let stable = 0, steps = 0;
    async function sweep(direction = 'down') {
      stable = 0;
      let lastCount = seen.size, lastTop = -1;
      for (steps = 0; steps < MAX_STEPS; steps++) {
        const max = getMax();
        const top = getTop();
        const delta = Math.max(MIN_STEP, (isWindow ? window.innerHeight : sc.clientHeight) - 40);
        const next = direction === 'down' ? Math.min(top + delta, max) : Math.max(top - delta, 0);
        setTop(next);
        await sleep(WAIT_MS);
        harvest();
  
        const nowTop = getTop(), nowCount = seen.size;
        const progressed = (nowTop !== lastTop) || (nowCount > lastCount);
        lastTop = nowTop; lastCount = nowCount;
        stable = progressed ? 0 : (stable + 1);
  
        const atEdge = (direction === 'down' ? nowTop >= max : nowTop <= 0);
        if (atEdge && stable >= 2) break;
        if (!atEdge && stable >= STABLE_PASSES) break;
      }
    }
  
    await sweep('down');       // down -> up -> down (covers recycled windows)
    await sweep('up');
    await sweep('down');
  
    // ---------- CSV ----------
    const rows = [...seen.values()]
      .sort((a, b) => (a.index || 1e9) - (b.index || 1e9))
      .map((r, i) => ({ index: r.index || (i + 1), ...r }));
  
    const baseHeaders = ['index','short_name','name','position','team','bye_week','injury_text','injury_class','game_status'];
    const statHeaders = (rows.length ? Object.keys(rows[0]).filter(k => !baseHeaders.includes(k)) : STAT_HEADERS);
    const headers = [...baseHeaders, ...statHeaders];
  
    const csv = [
      headers.map(esc).join(','),
      ...rows.map(r => headers.map(h => esc(r[h])).join(','))
    ].join('\n');
  
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: 'players.csv' });
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  
    console.log(`Exported ${rows.length} unique players to players.csv`);
  })();