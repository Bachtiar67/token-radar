// Token Radar v2 — Dashboard application
// Runs entirely client-side, reads window.RADAR (injected by data.js), no network.

(() => {
  'use strict';

  // ============================================================
  // Types & Constants
  // ============================================================

  /** @typedef {import('./model.ts').RadarRow} RadarRow */
  /** @typedef {import('./model.ts').LiveRow} LiveRow */
  /** @typedef {import('./model.ts').RadarData} RadarData */
  /** @typedef {import('./model.ts').ModelConstants} ModelConstants */
  /** @typedef {import('./model.ts').StatusLabel} StatusLabel */

  const STATUS_LABELS = ['SURGING', 'STEADY', 'HIGH RISK', 'NEUTRAL'] as const;

  const CATEGORY_BADGES: Record<string, string> = {
    lending: 'badge-lending',
    dex: 'badge-dex',
    bridge: 'badge-bridge',
    staking: 'badge-staking',
    derivatives: 'badge-derivatives',
    rwa: 'badge-rwa',
    stablecoin: 'badge-stablecoin',
    insurance: 'badge-insurance',
    yield: 'badge-yield',
    cdp: 'badge-cdp',
  };

  // ============================================================
  // State
  // ============================================================

  /** @type {RadarData | null} */
  let radar = null;
  /** @type {RadarRow[]} */
  let rows = [];
  /** @type {LiveRow[]} */
  let liveRows = [];

  /** @type {'board' | 'live'} */
  let view = 'board';
  /** @type {string} */
  let search = '';
  /** @type {string[]} */
  let selectedCategories = [];
  /** @type {StatusLabel[]} */
  let selectedStatuses = [];
  /** @type {{key: keyof RadarRow, dir: 1 | -1} | null} */
  let sortState = { key: 'rank', dir: 1 };

  /** @type {RadarRow | null} */
  let detailRow = null;

  // DOM refs
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ============================================================
  // Init
  // ============================================================

  function init() {
    if (!window.RADAR) {
      console.error('RADAR data not found');
      return;
    }
    radar = window.RADAR;
    rows = radar.rows;
    liveRows = radar.live;

    renderHero();
    renderControls();
    renderTable();
    renderModelPanel();
    bindEvents();
    document.getElementById('board')?.removeAttribute('aria-busy');
  }

  // ============================================================
  // Render: Hero / Facts
  // ============================================================

  function renderHero() {
    const facts = $('#facts');
    if (!facts || !radar) return;
    facts.innerHTML = `
      <div class="fact"><span class="fact-label">Snapshot</span><span class="fact-value">${radar.as_of}</span></div>
      <div class="fact"><span class="fact-label">Source</span><span class="fact-value">${radar.source}</span></div>
      <div class="fact"><span class="fact-label">Watchlist</span><span class="fact-value">${radar.watchlist_size} protocols</span></div>
      <div class="fact"><span class="fact-label">Floor TVL</span><span class="fact-value">$${fmt(radar.floor_usd)}</span></div>
      <div class="fact"><span class="fact-label">Board</span><span class="fact-value">${radar.board_size} rows (${radar.early_size} early)</span></div>
      <div class="fact"><span class="fact-label">Live tokens</span><span class="fact-value">${radar.live_size} protocols</span></div>
      <div class="fact"><span class="fact-label">Model</span><span class="fact-value">${radar.model_version}</span></div>
    `;
  }

  // ============================================================
  // Render: Controls
  // ============================================================

  function renderControls() {
    const cats = [...new Set(rows.map(r => r.category).filter(Boolean))].sort();
    const statuses = STATUS_LABELS;

    const catsHtml = cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    const statusHtml = statuses.map(s => `<option value="${s}">${s}</option>`).join('');

    const controls = $('#controls');
    if (!controls) return;
    controls.innerHTML = `
      <div class="field">
        <label for="search">Search</label>
        <input type="search" id="search" placeholder="Name, slug, chain…" aria-label="Search protocols">
      </div>
      <div class="field">
        <label for="cat-filter">Category</label>
        <select id="cat-filter" multiple aria-label="Filter by category">
          ${catsHtml}
        </select>
      </div>
      <div class="field">
        <label for="status-filter">Status</label>
        <select id="status-filter" multiple aria-label="Filter by status">
          ${statusHtml}
        </select>
      </div>
      <div class="tabs" role="tablist" aria-label="View mode">
        <button role="tab" id="tab-board" aria-selected="true" aria-controls="panel-board">Pre-token Board</button>
        <button role="tab" id="tab-live" aria-selected="false" aria-controls="panel-live">Live Tokens</button>
      </div>
      <span class="count" id="row-count"></span>
    `;
  }

  // ============================================================
  // Render: Table
  // ============================================================

  function renderTable() {
    const data = view === 'board' ? getFilteredRows() : liveRows;
    const cols = view === 'board' ? BOARD_COLS : LIVE_COLS;
    const tbody = $('#tbody');
    const countEl = $('#row-count');

    if (!tbody) return;
    if (countEl) countEl.textContent = `${data.length} row${data.length !== 1 ? 's' : ''}`;

    if (data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${cols.length}" class="empty"><h2>No rows match</h2><p>Adjust filters or search to see results.</p></td></tr>`;
      return;
    }

    tbody.innerHTML = data.map(row => {
      if (view === 'board') return renderBoardRow(row);
      return renderLiveRow(row);
    }).join('');

    // Re-bind row clicks
    $$('tbody tr[data-slug]').forEach(tr => {
      tr.addEventListener('click', () => openDetail(tr.dataset.slug));
    });
  }

  const BOARD_COLS = [
    { key: 'rank', label: '#', width: '50px' },
    { key: 'name', label: 'Protocol', width: '280px' },
    { key: 'category', label: 'Category', width: '140px' },
    { key: 'chains', label: 'Chains', width: '160px' },
    { key: 'tvl_usd', label: 'TVL', width: '110px', align: 'right' },
    { key: 'change_7d', label: '7d %', width: '100px', align: 'right' },
    { key: 'change_24h', label: '24h %', width: '100px', align: 'right' },
    { key: 'status_label', label: 'Signal', width: '120px' },
    { key: 'implied_value_usd', label: 'Implied', width: '110px', align: 'right' },
  ];

  const LIVE_COLS = [
    { key: 'rank', label: '#', width: '50px' },
    { key: 'name', label: 'Protocol', width: '280px' },
    { key: 'category', label: 'Category', width: '140px' },
    { key: 'chains', label: 'Chains', width: '160px' },
    { key: 'tvl_usd', label: 'TVL', width: '110px', align: 'right' },
    { key: 'mcap_usd', label: 'MCap', width: '110px', align: 'right' },
    { key: 'change_7d', label: '7d %', width: '100px', align: 'right' },
    { key: 'change_24h', label: '24h %', width: '100px', align: 'right' },
  ];

  function renderBoardRow(row) {
    const cat = row.category ?? '—';
    const catClass = categoryBadgeClass(cat);
    const statusClass = `status-${row.status_label.toLowerCase().replace(' ', '-')}`;
    const growth = row.change_7d ?? 0;
    const momentum = row.change_24h ?? 0;
    const growthBar = barPct(growth, -60, 120);
    const momentumBar = barPct(momentum, -40, 80);

    return `
      <tr data-slug="${esc(row.slug)}" data-rank="${row.rank}" tabindex="0" role="button" aria-label="Open ${esc(row.name)} detail">
        <td class="num">${row.rank}</td>
        <td class="name">
          <b>${esc(row.name)}</b>
          <span class="sub">${esc(row.slug)}</span>
        </td>
        <td><span class="badge ${catClass}">${esc(cat)}</span></td>
        <td><span class="sub">${esc(row.chains.join(', ') || '—')}</span></td>
        <td class="num">$${fmtCompact(row.tvl_usd)}</td>
        <td class="num"><span class="${growth >= 0 ? 'pos' : 'neg'}">${growth >= 0 ? '+' : ''}${growth.toFixed(2)}%</span><div class="bar-cell"><div class="bar"><i style="width:${growthBar}%;background:${growth >= 0 ? 'var(--accent-emerald)' : 'var(--accent-crimson)'}"></i></div></div></td>
        <td class="num"><span class="${momentum >= 0 ? 'pos' : 'neg'}">${momentum >= 0 ? '+' : ''}${momentum.toFixed(2)}%</span><div class="bar-cell"><div class="bar"><i style="width:${momentumBar}%;background:${momentum >= 0 ? 'var(--accent-emerald)' : 'var(--accent-crimson)'}"></i></div></div></td>
        <td><span class="status ${statusClass}">${esc(row.status_label)}</span></td>
        <td class="num implied">$${fmtCompact(row.implied_value_usd)}</td>
      </tr>
    `;
  }

  function renderLiveRow(row) {
    const cat = row.category ?? '—';
    const catClass = categoryBadgeClass(cat);
    const mcap = row.mcap_usd ?? 0;
    const growth = row.change_7d ?? 0;
    const momentum = row.change_24h ?? 0;

    return `
      <tr data-slug="${esc(row.slug)}" data-rank="${row.rank}" tabindex="0" role="button" aria-label="Open ${esc(row.name)} detail">
        <td class="num">${row.rank}</td>
        <td class="name">
          <b>${esc(row.name)}</b>
          <span class="sub">${esc(row.slug)}</span>
        </td>
        <td><span class="badge ${catClass}">${esc(cat)}</span></td>
        <td><span class="sub">${esc(row.chains.join(', ') || '—')}</span></td>
        <td class="num">$${fmtCompact(row.tvl_usd)}</td>
        <td class="num">$${fmtCompact(mcap)}</td>
        <td class="num"><span class="${growth >= 0 ? 'pos' : 'neg'}">${growth >= 0 ? '+' : ''}${growth.toFixed(2)}%</span></td>
        <td class="num"><span class="${momentum >= 0 ? 'pos' : 'neg'}">${momentum >= 0 ? '+' : ''}${momentum.toFixed(2)}%</span></td>
      </tr>
    `;
  }

  // ============================================================
  // Render: Model Panel
  // ============================================================

  function renderModelPanel() {
    const panel = $('#model-panel');
    if (!panel || !radar) return;
    const m = radar.model;
    panel.innerHTML = `
      <h2>Model: ${radar.model_version}</h2>
      <pre class="formula">
Implied = TVL × ${m.base_multiple}
        × (1 + clamp(7d%, ${m.growth_floor}, ${m.growth_cap}) / 100 × ${m.growth_weight})
        × (1 + clamp(24h%, ${m.momentum_floor}, ${m.momentum_cap}) / 100 × ${m.momentum_weight})
        × (${m.maturity_floor} + min(age, ${m.maturity_days}) / ${m.maturity_days} × ${m.maturity_range})
      </pre>
      <p class="sub">Growth & momentum clamped; age in days (${m.unknown_age_days} when unknown). Status labels: <b>SURGING</b> (7d > 30 & 24h > 15), <b>STEADY</b> (7d > -10 & 24h > -10), <b>HIGH RISK</b> (7d < -30 or 24h < -25), else <b>NEUTRAL</b>.</p>
    `;
  }

  // ============================================================
  // Detail Drawer
  // ============================================================

  function openDetail(slug) {
    const row = view === 'board'
      ? rows.find(r => r.slug === slug)
      : liveRows.find(r => r.slug === slug);
    if (!row) return;

    detailRow = row;
    const drawer = $('#detail');
    if (!drawer) return;

    if (view === 'board') {
      renderBoardDetail(row);
    } else {
      renderLiveDetail(row);
    }

    drawer.hidden = false;
    document.body.style.overflow = 'hidden';
    $('#detail-close')?.focus();
  }

  function closeDetail() {
    const drawer = $('#detail');
    if (!drawer) return;
    drawer.hidden = true;
    document.body.style.overflow = '';
    detailRow = null;
  }

  function renderBoardDetail(row) {
    const drawer = $('#detail');
    if (!drawer || !radar) return;

    const { implied, growthPct, growthMult, momentumPct, momentumMult, maturityMult, age, statusLabel } = computeImplied(row, radar.model, radar.as_of);
    const cat = row.category ?? '—';
    const catClass = categoryBadgeClass(cat);

    drawer.innerHTML = `
      <div class="detail-head">
        <div>
          <span class="brand-name">${esc(radar.model_version)}</span>
          <h2>${esc(row.name)}</h2>
          <p class="sub">Rank #${row.rank} · ${esc(row.slug)} · ${esc(cat)} <span class="badge ${catClass}">${esc(cat)}</span></p>
        </div>
        <button class="close" id="detail-close" aria-label="Close detail">Close</button>
      </div>

      <div class="detail-section">
        <h3>Snapshot Metrics</h3>
        <div class="equation">
          <div><span>TVL</span><b>$${fmt(row.tvl_usd)}</b></div>
          <div><span>7d Change</span><b class="${growthPct >= 0 ? 'pos' : 'neg'}">${growthPct >= 0 ? '+' : ''}${growthPct.toFixed(2)}%</b></div>
          <div><span>24h Change</span><b class="${momentumPct >= 0 ? 'pos' : 'neg'}">${momentumPct >= 0 ? '+' : ''}${momentumPct.toFixed(2)}%</b></div>
          <div><span>Chains</span><b>${esc(row.chains.join(', ') || '—')}</b></div>
          <div><span>Listed</span><b>${esc(row.listed_at ?? 'unknown')}</b></div>
          <div><span>Age</span><b>${age ?? 'unknown'} days</b></div>
          <div><span>Status</span><b><span class="status status-${statusLabel.toLowerCase().replace(' ', '-')}">${esc(statusLabel)}</span></b></div>
        </div>
      </div>

      <div class="detail-section">
        <h3>Implied Value Breakdown</h3>
        <div class="equation">
          <div><span>Base (TVL × ${radar.model.base_multiple})</span><b>$${fmt(row.tvl_usd * radar.model.base_multiple)}</b></div>
          <div><span>Growth multiplier (1 + ${growthPct.toFixed(2)}% × ${radar.model.growth_weight})</span><b>× ${growthMult.toFixed(4)}</b></div>
          <div><span>Momentum multiplier (1 + ${momentumPct.toFixed(2)}% × ${radar.model.momentum_weight})</span><b>× ${momentumMult.toFixed(4)}</b></div>
          <div><span>Maturity multiplier</span><b>× ${maturityMult.toFixed(4)}</b></div>
          <div class="highlight"><span>Implied Value</span><b class="highlight">$${fmt(implied)}</b></div>
        </div>
      </div>

      <div class="detail-section">
        <h3>Farm Plan</h3>
        <ol class="steps">
          ${row.farm_steps.map(s => `<li>${esc(s)}</li>`).join('')}
        </ol>
      </div>

      <div class="detail-section">
        <h3>Sparkline (7d proxy)</h3>
        <div class="sparkline" id="sparkline-${esc(row.slug)}"></div>
        <p class="sub">Simulated 7-day TVL trajectory based on snapshot change.</p>
      </div>
    `;

    // Render sparkline after DOM insertion
    requestAnimationFrame(() => renderSparkline(`#sparkline-${esc(row.slug)}`, row.tvl_usd, growthPct));
  }

  function renderLiveDetail(row) {
    const drawer = $('#detail');
    if (!drawer) return;

    const cat = row.category ?? '—';
    const catClass = categoryBadgeClass(cat);
    const growth = row.change_7d ?? 0;
    const momentum = row.change_24h ?? 0;

    drawer.innerHTML = `
      <div class="detail-head">
        <div>
          <span class="brand-name">${radar?.model_version ?? 'radar'}</span>
          <h2>${esc(row.name)}</h2>
          <p class="sub">Rank #${row.rank} · ${esc(row.slug)} · ${esc(cat)} <span class="badge ${catClass}">${esc(cat)}</span></p>
        </div>
        <button class="close" id="detail-close" aria-label="Close detail">Close</button>
      </div>

      <div class="detail-section">
        <h3>Market Metrics</h3>
        <div class="equation">
          <div><span>TVL</span><b>$${fmt(row.tvl_usd)}</b></div>
          <div><span>Market Cap</span><b>$${fmt(row.mcap_usd ?? 0)}</b></div>
          <div><span>7d Change</span><b class="${growth >= 0 ? 'pos' : 'neg'}">${growth >= 0 ? '+' : ''}${growth.toFixed(2)}%</b></div>
          <div><span>24h Change</span><b class="${momentum >= 0 ? 'pos' : 'neg'}">${momentum >= 0 ? '+' : ''}${momentum.toFixed(2)}%</b></div>
          <div><span>Chains</span><b>${esc(row.chains.join(', ') || '—')}</b></div>
        </div>
      </div>

      <div class="detail-section">
        <h3>Sparkline (7d proxy)</h3>
        <div class="sparkline" id="sparkline-${esc(row.slug)}"></div>
        <p class="sub">Simulated 7-day TVL trajectory based on snapshot change.</p>
      </div>
    `;

    requestAnimationFrame(() => renderSparkline(`#sparkline-${esc(row.slug)}`, row.tvl_usd, growth));
  }

  // ============================================================
  // Sparkline (SVG)
  // ============================================================

  function renderSparkline(selector, baseTvl, changePct) {
    const container = document.querySelector(selector);
    if (!container) return;

    const w = 100, h = 32;
    const points = 30;
    // Generate a plausible trajectory: start at base, end at base * (1 + changePct/100)
    const start = baseTvl;
    const end = baseTvl * (1 + changePct / 100);
    const data = [];
    for (let i = 0; i < points; i++) {
      const t = i / (points - 1);
      // Add some noise for realism
      const noise = (Math.sin(i * 0.8) * 0.02 + Math.cos(i * 1.3) * 0.015) * baseTvl;
      const val = start + (end - start) * t + noise;
      data.push(Math.max(0, val));
    }

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;

    const xScale = (i) => (i / (points - 1)) * w;
    const yScale = (val) => h - ((val - min) / range) * (h - 4) - 2;

    const path = data.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i).toFixed(1)} ${yScale(v).toFixed(1)}`).join(' ');
    const areaPath = `${path} L ${w} ${h} L 0 ${h} Z`;

    const positive = changePct >= 0;
    const lineColor = positive ? 'var(--accent-emerald)' : 'var(--accent-crimson)';
    const areaColor = positive ? 'var(--glow-emerald)' : 'var(--glow-crimson)';

    container.innerHTML = `
      <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="grad-${Math.random().toString(36).slice(2)}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${areaColor}" stop-opacity="0.4"/>
            <stop offset="100%" stop-color="${areaColor}" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <path class="area" d="${areaPath}" fill="url(#grad-${Math.random().toString(36).slice(2)})"/>
        <path class="line${positive ? '' : ' line-negative'}" d="${path}" stroke="${lineColor}"/>
      </svg>
    `;
  }

  // ============================================================
  // Helpers: Compute implied (mirror model.ts logic)
  // ============================================================

  function computeImplied(row, model, asOf) {
    const age = row.age_days ?? model.unknown_age_days;
    const rawGrowth = row.change_7d ?? 0;
    const rawMomentum = row.change_24h ?? 0;
    const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
    const momentumPct = Math.min(model.momentum_cap, Math.max(model.momentum_floor, rawMomentum));
    const growthMult = 1 + (growthPct / 100) * model.growth_weight;
    const momentumMult = 1 + (momentumPct / 100) * model.momentum_weight;
    const maturityMult = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    const base = row.tvl_usd * model.base_multiple;
    const implied = Math.max(1, Math.round(base * growthMult * momentumMult * maturityMult));

    let statusLabel = 'NEUTRAL';
    if (growthPct > 30 && momentumPct > 15) statusLabel = 'SURGING';
    else if (growthPct > -10 && momentumPct > -10) statusLabel = 'STEADY';
    else if (growthPct < -30 || momentumPct < -25) statusLabel = 'HIGH RISK';

    return { implied, growthPct, growthMult, momentumPct, momentumMult, maturityMult, age, statusLabel };
  }

  // ============================================================
  // Filtering & Sorting
  // ============================================================

  function getFilteredRows() {
    let out = rows;

    if (search) {
      const q = search.toLowerCase();
      out = out.filter(r =>
        r.name.toLowerCase().includes(q) ||
        r.slug.toLowerCase().includes(q) ||
        r.chains.some(c => c.toLowerCase().includes(q))
      );
    }

    if (selectedCategories.length) {
      out = out.filter(r => r.category && selectedCategories.includes(r.category));
    }

    if (selectedStatuses.length) {
      out = out.filter(r => selectedStatuses.includes(r.status_label));
    }

    // Sort
    if (sortState) {
      const { key, dir } = sortState;
      out = [...out].sort((a, b) => {
        let av = a[key];
        let bv = b[key];
        if (typeof av === 'string') av = av.toLowerCase();
        if (typeof bv === 'string') bv = bv.toLowerCase();
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
      });
    }

    // Re-rank after filtering
    return out.map((r, i) => ({ ...r, rank: i + 1 }));
  }

  function applyFilters() {
    renderTable();
  }

  function handleSort(key) {
    if (sortState && sortState.key === key) {
      sortState.dir *= -1;
    } else {
      sortState = { key, dir: 1 };
    }
    // Update header indicators
    $$('th button[data-sort]').forEach(btn => {
      const k = btn.dataset.sort;
      btn.classList.toggle('sorted', k === key);
      btn.classList.toggle('asc', k === key && sortState.dir === 1);
      btn.classList.toggle('desc', k === key && sortState.dir === -1);
    });
    renderTable();
  }

  // ============================================================
  // Formatters
  // ============================================================

  function fmt(n) {
    if (!Number.isFinite(n)) return '—';
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  }

  function fmtCompact(n) {
    if (!Number.isFinite(n)) return '—';
    if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toLocaleString();
  }

  function barPct(val, floor, cap) {
    const clamped = Math.min(cap, Math.max(floor, val));
    return ((clamped - floor) / (cap - floor)) * 100;
  }

  function categoryBadgeClass(cat) {
    const key = cat.toLowerCase().replace(/[^a-z]+/g, '');
    return CATEGORY_BADGES[key] || 'badge-other';
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&', '<': '<', '>': '>', '"': '"', "'": ''' }[c]));
  }

  // ============================================================
  // Event Binding
  // ============================================================

  function bindEvents() {
    // Search
    $('#search')?.addEventListener('input', e => {
      search = e.target.value;
      applyFilters();
    });

    // Category filter
    $('#cat-filter')?.addEventListener('change', e => {
      selectedCategories = Array.from(e.target.selectedOptions).map(o => o.value);
      applyFilters();
    });

    // Status filter
    $('#status-filter')?.addEventListener('change', e => {
      selectedStatuses = Array.from(e.target.selectedOptions).map(o => o.value);
      applyFilters();
    });

    // View tabs
    $('#tab-board')?.addEventListener('click', () => switchView('board'));
    $('#tab-live')?.addEventListener('click', () => switchView('live'));

    // Sort headers
    $$('th button[data-sort]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        handleSort(btn.dataset.sort!);
      });
    });

    // Detail close
    $('#detail-close')?.addEventListener('click', closeDetail);
    $('#detail')?.addEventListener('click', e => {
      if (e.target === e.currentTarget) closeDetail();
    });

    // Keyboard: ESC closes detail
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !$('#detail')?.hidden) closeDetail();
    });
  }

  function switchView(v) {
    view = v;
    $('#tab-board')?.setAttribute('aria-selected', v === 'board');
    $('#tab-live')?.setAttribute('aria-selected', v === 'live');
    $('#tab-board')?.setAttribute('aria-controls', v === 'board' ? 'panel-board' : 'panel-live');
    $('#tab-live')?.setAttribute('aria-controls', v === 'live' ? 'panel-live' : 'panel-board');
    closeDetail();
    applyFilters();
  }

  // ============================================================
  // Boot
  // ============================================================

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();