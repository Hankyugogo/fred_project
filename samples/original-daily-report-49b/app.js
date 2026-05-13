async function loadBriefings() {
  const res = await fetch(`./data/briefings.json?v=${Date.now()}`, { cache: 'no-store' });
  return res.json();
}

const I18N = {
  ko: {
    heroTitle: 'Global Macro & US Market Briefing',
    heroSubtitle: '매일 08:00 KST 업데이트 · 핵심 이슈, 시장 반응, 투자 체크포인트를 한눈에',
    coverage: 'Coverage: US Equities · Rates · FX · Commodities',
    format: 'Format: Morning Brief + Actionable Checkpoints',
    insightsTitle: '핵심 인사이트 대시보드',
    navTopStory: '오늘의 핵심 사건',
    navReaction: '시장이 반응한 자산',
    navWatch: '확인할 변수',
    navPositioning: '투자 포지션 참고',
    viewerTitle: '오늘 브리핑 본문',
    archiveTitle: '지난 브리핑',
    archiveDesc: '날짜를 선택하면 본문이 위 영역에서 바로 바뀝니다.',
    latestTitle: '오늘 브리핑',
    loadingInsight: '분석을 불러오는 중...',
    loadingPost: '브리핑을 불러오는 중...',
    more: '더보기',
    topStoryHead: '오늘의 핵심 사건',
    reactionHead: '시장이 반응한 자산',
    watchHead: '지금 확인할 변수',
    positioningHead: '투자 포지션 참고',
    engFallback: ''
  },
  en: {
    heroTitle: 'Global Macro & US Market Briefing',
    heroSubtitle: 'Updated daily at 08:00 KST · Key events, market reaction, and actionable checkpoints',
    coverage: 'Coverage: US Equities · Rates · FX · Commodities',
    format: 'Format: Morning Brief + Actionable Checkpoints',
    insightsTitle: 'Key Insights Dashboard',
    navTopStory: 'Top Story',
    navReaction: 'Market Reaction',
    navWatch: 'Watch Now',
    navPositioning: 'Positioning',
    viewerTitle: 'Today\'s Briefing',
    archiveTitle: 'Past Briefings',
    archiveDesc: 'Select a date to load that briefing above.',
    latestTitle: 'Today\'s Briefing',
    loadingInsight: 'Loading insights...',
    loadingPost: 'Loading briefing...',
    more: 'Load more',
    topStoryHead: 'Top Story',
    reactionHead: 'Market Reaction',
    watchHead: 'Watch Now',
    positioningHead: 'Positioning',
    engFallback: 'English post is not yet available for this date. Showing Korean original.'
  }
};

let currentLang = new URLSearchParams(window.location.search).get('lang') || localStorage.getItem('site_lang') || 'ko';
if (!I18N[currentLang]) currentLang = 'ko';
let currentItem = null;

function t(key) {
  return (I18N[currentLang] && I18N[currentLang][key]) || key;
}

function localized(item, key) {
  if (currentLang === 'en' && item?.[`${key}_en`]) return item[`${key}_en`];
  return item?.[key];
}

function applyStaticI18n() {
  const ids = {
    'hero-title': 'heroTitle',
    'hero-subtitle': 'heroSubtitle',
    'hero-coverage': 'coverage',
    'hero-format': 'format',
    'insights-title': 'insightsTitle',
    'nav-topstory': 'navTopStory',
    'nav-reaction': 'navReaction',
    'nav-watch': 'navWatch',
    'nav-positioning': 'navPositioning',
    'viewer-title': 'viewerTitle',
    'archive-title': 'archiveTitle',
    'archive-desc': 'archiveDesc'
  };
  for (const [id, key] of Object.entries(ids)) {
    const el = document.getElementById(id);
    if (el) el.textContent = t(key);
  }
  const sel = document.getElementById('lang-select');
  if (sel) sel.value = currentLang;
}

function extractIndexStats(text, item) {
  // Prefer explicit structured fields when present
  if (item?.indices?.sp || item?.indices?.nasdaq || item?.indices?.dow) {
    return {
      sp: item.indices?.sp || { level: '—', chg: 'N/A' },
      nasdaq: item.indices?.nasdaq || { level: '—', chg: 'N/A' },
      dow: item.indices?.dow || { level: '—', chg: 'N/A' }
    };
  }

  const clean = text.replace(/\*\*/g, '').replace(/`/g, '');

  const getLevel = (label) => {
    const re = new RegExp(`\\b${label}\\b\\s*:\\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\\.[0-9]+)?)`, 'i');
    const m = clean.match(re);
    return m ? m[1] : '—';
  };

  const getChange = (label) => {
    const re = new RegExp(`\\b${label}\\b[^\\n%]{0,40}?([+\\-]\\d+(?:\\.\\d+)?)%`, 'i');
    const m = clean.match(re);
    return m ? `${m[1]}%` : 'N/A';
  };

  return {
    sp: { level: getLevel('S&P\\s?500|S\\&P\\s?500'), chg: getChange('S&P\\s?500|S\\&P\\s?500') },
    nasdaq: { level: getLevel('Nasdaq|NASDAQ|나스닥'), chg: getChange('Nasdaq|NASDAQ|나스닥') },
    dow: { level: getLevel('Dow|DOW|다우'), chg: getChange('Dow|DOW|다우') }
  };
}

function extractCoreThree(text) {
  const lines = text.split('\n');
  const start = lines.findIndex(l => l.trim() === '## 오늘의 핵심 3줄');
  if (start < 0) return [];
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    if (t.startsWith('## ')) break;
    out.push(t.replace(/^\d+\.\s*/, ''));
  }
  return out.slice(0, 3);
}

function removeCoreThreeSection(text) {
  const re = /\n## 오늘의 핵심 3줄[\s\S]*?(?=\n##\s|$)/;
  return text.replace(re, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function getSection(text, title) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`## ${escaped}([\\s\\S]*?)(?=\\n## |$)`);
  const m = text.match(re);
  return m ? m[1].trim() : '';
}

function firstUsefulLine(block) {
  if (!block) return '데이터 확인 중';
  const lines = block.split('\n').map(x => x.trim()).filter(Boolean);
  const clean = lines.find(l => !l.startsWith('-') && !l.startsWith('1)') && !l.startsWith('1.') ) || lines[0];
  return (clean || '').replace(/^[-\d\.)\s]+/, '').slice(0, 130);
}

function renderSectionItems(items) {
  return items.map(it => `
    <article class="insight-item">
      <h5>${safeText(it.title, currentLang === 'en' ? 'Key takeaway' : '핵심 요약')}</h5>
      <p>${safeText(it.desc, currentLang === 'en' ? 'Checking details' : '상세 데이터 확인 중')}</p>
    </article>
  `).join('');
}

function updateSeoMeta(item) {
  const base = 'https://agenthongbot.github.io/DAILY_REPORT';
  const itemTitle = safeText(localized(item, 'title'), currentLang === 'en' ? 'US Market Briefing' : '미국 증시 브리핑');
  const hls = localized(item, 'highlights') || item.highlights || [];
  const title = currentLang === 'en'
    ? `${item.date} US Market Summary | ${itemTitle}`
    : `${item.date} 오늘 미국증시 요약 | ${itemTitle}`;
  const desc = currentLang === 'en'
    ? `${hls.slice(0,2).join(' / ')} | US market summary`
    : `${hls.slice(0,2).join(' / ')} | 오늘 미국증시 요약`;
  document.title = title;

  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.setAttribute('content', desc.slice(0, 180));

  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) canonical.setAttribute('href', `${base}/posts/${item.date}/`);

  const u = new URL(window.location.href);
  u.searchParams.set('date', item.date);
  u.searchParams.set('lang', currentLang);
  history.replaceState({}, '', u.toString());
}

function renderInsights(item, text) {
  const grid = document.getElementById('insight-grid');

  const safeLead = safeText(localized(item, 'overnightLead') || item.overnightLead, '');
  const fallback = {
    topStory: [{ title: currentLang === 'en' ? 'Key event' : '핵심 사건 요약', desc: safeLead.slice(0, 180) || firstUsefulLine(getSection(text, '짧은 해설')) }],
    marketReaction: [{ title: currentLang === 'en' ? 'Asset reaction' : '자산 반응', desc: firstUsefulLine(getSection(text, '미국 증시 요약(지수/금리/VIX/섹터)')) }],
    watchNow: [{ title: currentLang === 'en' ? 'What to watch' : '체크 변수', desc: firstUsefulLine(getSection(text, '오늘 한국 투자자 체크포인트 3개')) }],
    positioning: [{ title: currentLang === 'en' ? 'Positioning note' : '포지션 메모', desc: firstUsefulLine(getSection(text, '간밤 주요 이슈 5개(시장 영향 포함)')) }]
  };

  const sec = (currentLang === 'en' && item?.insightSections_en) ? item.insightSections_en : (item?.insightSections || fallback);

  grid.innerHTML = `
    <section class="insight-section">
      <div class="sec-head"><span>TOP STORY</span><strong>${t('topStoryHead')}</strong></div>
      ${renderSectionItems(sec.topStory || fallback.topStory)}
    </section>

    <section class="insight-section">
      <div class="sec-head"><span>MARKET REACTION</span><strong>${t('reactionHead')}</strong></div>
      ${renderSectionItems(sec.marketReaction || fallback.marketReaction)}
    </section>

    <section class="insight-section">
      <div class="sec-head"><span>WATCH NOW</span><strong>${t('watchHead')}</strong></div>
      ${renderSectionItems(sec.watchNow || fallback.watchNow)}
    </section>

    <section class="insight-section">
      <div class="sec-head"><span>POSITIONING</span><strong>${t('positioningHead')}</strong></div>
      ${renderSectionItems(sec.positioning || fallback.positioning)}
    </section>
  `;
}

function toneClass(chg) {
  const s = String(chg || '').trim();
  if (s.startsWith('+')) return 'up';
  if (s.startsWith('-')) return 'down';
  return 'flat';
}

function looksCorrupted(text) {
  const s = String(text || '');
  return /\?{2,}/.test(s);
}

function safeText(text, fallback = '데이터 확인 중') {
  return looksCorrupted(text) ? fallback : text;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderPostReadable(text) {
  const lines = text.split('\n').map(l => l.trimEnd());
  const sectionTitles = new Set([
    '간밤 주요 이슈 5개(시장 영향 포함)',
    '미국 증시 요약(지수/금리/VIX/섹터)',
    '오늘 한국 투자자 체크포인트 3개',
    '짧은 해설',
    'Overnight Lead',
    '최종 점검 체크리스트',
    'Top 5 Overnight Issues (with market impact)',
    'US Market Summary (indices/rates/VIX/sectors)',
    '3 Checkpoints for Korean Investors Today',
    'Brief Commentary',
    'Final Checklist'
  ]);

  let html = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      html += '<div class="post-gap"></div>';
      continue;
    }

    if (sectionTitles.has(line)) {
      html += `<h3 class="post-sec-title">${escapeHtml(line)}</h3>`;
      continue;
    }

    if (/^\d+\)\s+/.test(line)) {
      html += `<p class="post-item-title">${escapeHtml(line)}</p>`;
      continue;
    }

    if (/^-\s+/.test(line)) {
      html += `<p class="post-bullet">${escapeHtml(line.replace(/^-\s+/, ''))}</p>`;
      continue;
    }

    html += `<p class="post-line">${escapeHtml(line)}</p>`;
  }

  return html;
}

async function renderLatest(item) {
  const latest = document.getElementById('latest');
  let stats = {
    sp: { level: '—', chg: 'N/A' },
    nasdaq: { level: '—', chg: 'N/A' },
    dow: { level: '—', chg: 'N/A' }
  };
  let core = [];

  try {
    const res = await fetch(`${item.file}?v=${item.date}`, { cache: 'no-store' });
    const txt = await res.text();
    stats = extractIndexStats(txt, item);
    core = extractCoreThree(txt);
  } catch {
    // keep defaults
  }

  const safeTitle = safeText(localized(item, 'title') || item.title, `${item.date} ${currentLang === 'en' ? 'US/Global Market Briefing' : '미국/글로벌 마켓 브리핑'}`);
  const safeLead = safeText(localized(item, 'overnightLead') || item.overnightLead, '');

  latest.innerHTML = `
    <h2>${t('latestTitle')} (${item.date})</h2>
    <p class="meta">${safeTitle}</p>

    <div class="index-strip">
      <div class="idx-card">
        <span>S&P500</span>
        <strong>${stats.sp.level}</strong>
        <em class="${toneClass(stats.sp.chg)}">${stats.sp.chg}</em>
      </div>
      <div class="idx-card">
        <span>Nasdaq</span>
        <strong>${stats.nasdaq.level}</strong>
        <em class="${toneClass(stats.nasdaq.chg)}">${stats.nasdaq.chg}</em>
      </div>
      <div class="idx-card">
        <span>Dow</span>
        <strong>${stats.dow.level}</strong>
        <em class="${toneClass(stats.dow.chg)}">${stats.dow.chg}</em>
      </div>
    </div>

    ${safeLead ? `<div class="lead-box"><h3>Overnight Lead</h3><p>${safeLead}</p></div>` : ''}
  `;
}

async function showPost(item) {
  const target = document.getElementById('post-view');
  try {
    const file = (currentLang === 'en' && item.file_en) ? item.file_en : item.file;
    const res = await fetch(`${file}?v=${item.date}`, { cache: 'no-store' });
    const txt = await res.text();
    const cleaned = removeCoreThreeSection(txt)
      .replace(/\*\*/g, '')
      .replace(/\t/g, '  ');
    const langNote = (currentLang === 'en' && !item.file_en && t('engFallback'))
      ? `<div class="lang-note">${escapeHtml(t('engFallback'))}</div>`
      : '';
    target.innerHTML = `${langNote}${renderPostReadable(cleaned)}`;
    renderInsights(item, txt);
  } catch {
    target.textContent = currentLang === 'en' ? 'Failed to load briefing body.' : '본문을 불러오지 못했습니다.';
    const grid = document.getElementById('insight-grid');
    if (grid) grid.textContent = currentLang === 'en' ? 'Failed to load insights.' : '인사이트를 불러오지 못했습니다.';
  }
}

function renderList(items) {
  const list = document.getElementById('briefing-list');
  const card = list.closest('.archive');
  let visibleCount = Math.min(7, items.length);

  const draw = () => {
    const shown = items.slice(0, visibleCount);
    list.innerHTML = shown.map((i, idx) => `
      <li class="brief-item" data-idx="${idx}">
        <div><strong>${i.date}</strong> - ${safeText(localized(i, 'title') || i.title, i.date + (currentLang === 'en' ? ' Briefing' : ' 브리핑'))}</div>
        <div class="meta">${((currentLang === 'en' && i.tags_en) ? i.tags_en : (i.tags || [])).map(t => safeText(t, '')).filter(Boolean).join(', ')}</div>
      </li>
    `).join('');

    [...list.querySelectorAll('.brief-item')].forEach((el) => {
      el.addEventListener('click', () => {
        [...list.querySelectorAll('.brief-item')].forEach(n => n.classList.remove('active'));
        el.classList.add('active');
        const item = items[Number(el.dataset.idx)];
        currentItem = item;
        showPost(item);
        renderLatest(item);
        updateSeoMeta(item);
      });
    });

    let moreBtn = document.getElementById('more-briefings');
    if (visibleCount < items.length) {
      if (!moreBtn) {
        moreBtn = document.createElement('button');
        moreBtn.id = 'more-briefings';
        moreBtn.className = 'more-btn';
        moreBtn.addEventListener('click', () => {
          visibleCount = Math.min(visibleCount + 14, items.length);
          draw();
        });
        card.appendChild(moreBtn);
      }
      moreBtn.textContent = t('more');
    } else if (moreBtn) {
      moreBtn.remove();
    }
  };

  draw();
}

(async () => {
  try {
    applyStaticI18n();
    const data = await loadBriefings();
    if (!Array.isArray(data) || data.length === 0) throw new Error('empty_data');

    const q = new URLSearchParams(window.location.search);
    const qDate = q.get('date');
    const selected = data.find(x => x.date === qDate) || data[0];

    currentItem = selected;
    await renderLatest(selected);
    renderList(data);
    showPost(selected);
    updateSeoMeta(selected);

    const idx = data.findIndex(x => x.date === selected.date);
    const active = document.querySelector(`#briefing-list .brief-item[data-idx="${idx}"]`);
    if (active) active.classList.add('active');

    const sel = document.getElementById('lang-select');
    if (sel) {
      sel.addEventListener('change', () => {
        currentLang = sel.value;
        localStorage.setItem('site_lang', currentLang);
        applyStaticI18n();
        const item = currentItem || selected;
        renderLatest(item);
        renderList(data);
        showPost(item);
        updateSeoMeta(item);
        const idx2 = data.findIndex(x => x.date === item.date);
        const active2 = document.querySelector(`#briefing-list .brief-item[data-idx="${idx2}"]`);
        if (active2) active2.classList.add('active');
      });
    }
  } catch (e) {
    const latest = document.getElementById('latest');
    const grid = document.getElementById('insight-grid');
    const post = document.getElementById('post-view');
    if (latest) latest.innerHTML = `<h2>${t('latestTitle')}</h2><p class="meta">${currentLang === 'en' ? 'Failed to load data. Please refresh.' : '데이터 로딩에 실패했습니다. 잠시 후 새로고침해 주세요.'}</p>`;
    if (grid) grid.textContent = currentLang === 'en' ? 'Failed to load insights.' : '인사이트 데이터를 불러오지 못했습니다.';
    if (post) post.textContent = currentLang === 'en' ? 'Failed to load briefing body.' : '브리핑 본문을 불러오지 못했습니다.';
  }
})();
