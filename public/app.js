'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const VIEWS = ['home', 'search', 'feedback', 'history'];
const VIEW_LABELS = { home: '대시보드', search: '자료 탐색', feedback: '과제 점검', history: '학습 기록' };
const SEARCH_LABELS = { news: '뉴스', photos: '사진', academic: '학술자료' };
const SEARCH_HINTS = {
  news: '예: 인공지능과 교육, 청소년 정책',
  photos: '예: 제주 바다, 로봇, 우주',
  academic: '예: 인공지능, 머신러닝, 로봇'
};
const HISTORY_KEY = 'studyhub-history-v3';
const MAX_HISTORY = 50;
let searchType = 'news';
let searchController = null;
let searchRequestId = 0;
let lastSearch = null;
let toastTimer = null;

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function safeWebUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}

function safeImageUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 2800);
}

function navigate(view) {
  if (!VIEWS.includes(view)) return;
  $$('.view').forEach(section => {
    const active = section.id === `view-${view}`;
    section.classList.toggle('active', active);
    section.setAttribute('aria-hidden', String(!active));
  });
  $$('.nav-item').forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  $('#crumb-current').textContent = VIEW_LABELS[view];
  if (view === 'history') renderHistory();
  if (location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$$('[data-view]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.view)));
$$('[data-go]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.go)));
window.addEventListener('hashchange', () => {
  const view = location.hash.slice(1);
  if (VIEWS.includes(view)) navigate(view);
});

$('#today-date').textContent = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric', month: 'long', day: 'numeric', weekday: 'short'
}).format(new Date());

function showHelp() {
  $('#help-modal').classList.remove('hidden');
  $('#modal-close').focus();
}
function hideHelp() {
  $('#help-modal').classList.add('hidden');
  $('#help-btn').focus();
}
$('#help-btn').addEventListener('click', showHelp);
$('#modal-close').addEventListener('click', hideHelp);
$('#help-modal').addEventListener('click', event => {
  if (event.target.id === 'help-modal') hideHelp();
});
window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('#help-modal').classList.contains('hidden')) hideHelp();
});

function getHistory() {
  try {
    let raw = localStorage.getItem(HISTORY_KEY);
    // Preserve V10's local-only history when the user first opens V11.
    if (raw === null) {
      const previous = JSON.parse(localStorage.getItem('studyhub-history-v2') || '[]');
      if (Array.isArray(previous)) {
        const migrated = previous
          .filter(item => item && typeof item.title === 'string' && typeof item.date === 'string')
          .map(item => ({ type: item.type === 'search' ? 'search' : 'feedback', title: item.title.slice(0, 160), date: item.date }))
          .slice(0, MAX_HISTORY);
        if (migrated.length) {
          localStorage.setItem(HISTORY_KEY, JSON.stringify(migrated));
          localStorage.removeItem('studyhub-history-v2');
          raw = JSON.stringify(migrated);
        }
      }
    }
    const value = JSON.parse(raw || '[]');
    return Array.isArray(value) ? value.filter(item => item && typeof item.title === 'string' && typeof item.date === 'string') : [];
  } catch {
    return [];
  }
}

function saveHistory(entry) {
  try {
    const current = getHistory();
    current.unshift({ type: entry.type, title: String(entry.title || '').slice(0, 160), date: new Date().toISOString() });
    localStorage.setItem(HISTORY_KEY, JSON.stringify(current.slice(0, MAX_HISTORY)));
    return true;
  } catch {
    return false;
  }
}

function renderHistory() {
  const entries = getHistory();
  const container = $('#history-list');
  if (!entries.length) {
    container.innerHTML = '<div class="history-empty"><span aria-hidden="true">◷</span><b>아직 기록이 없어요.</b><p>자료를 검색하거나 과제를 점검하면 이곳에 기록됩니다.</p></div>';
    return;
  }
  container.innerHTML = entries.map(entry => {
    const isSearch = entry.type === 'search';
    const date = new Date(entry.date);
    const dateText = Number.isNaN(date.getTime()) ? '' : date.toLocaleString('ko-KR');
    return `<article class="history-item"><div class="history-icon" aria-hidden="true">${isSearch ? '⌕' : '✳'}</div><div class="history-copy"><b>${escapeHtml(entry.title)}</b><small>${isSearch ? '자료 탐색' : '과제 점검'} · ${escapeHtml(dateText)}</small></div></article>`;
  }).join('');
}

$('#clear-history').addEventListener('click', () => {
  if (!getHistory().length) return toast('지울 기록이 없습니다.');
  if (!confirm('이 브라우저에 저장된 학습 기록을 모두 지울까요?')) return;
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
  toast('학습 기록을 지웠습니다.');
});

$('#export-history').addEventListener('click', () => {
  const entries = getHistory();
  if (!entries.length) return toast('내보낼 기록이 없습니다.');
  const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `study-hub-history-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('학습 기록 파일을 만들었습니다.');
});

async function checkServiceStatus() {
  const status = $('#service-status');
  const dot = $('.status-dot', status);
  const label = $('span:last-child', status);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch('/api/health', { headers: { Accept: 'application/json' }, signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const health = await response.json();
    if (!health.ok || health.searchMode !== 'rss-only') throw new Error('Unexpected service response');
    dot.className = 'status-dot online';
    label.textContent = `검색 서버 연결 · ${String(health.version || '버전 확인').split('-')[0]}`;
  } catch {
    dot.className = 'status-dot offline';
    label.textContent = '검색 서버 확인 필요';
  } finally {
    clearTimeout(timeout);
  }
}
checkServiceStatus();

function setSearchType(type) {
  if (!Object.hasOwn(SEARCH_LABELS, type)) return;
  searchType = type;
  $$('[data-search-type]').forEach(button => {
    const active = button.dataset.searchType === type;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  });
  $('#search-input').placeholder = SEARCH_HINTS[type];
  const descriptions = {
    news: ['Google News RSS 우선 · 연결 실패 또는 빈 결과일 때 국내 언론사 RSS 보완', 'Google News 검색 결과는 뉴스 전체 색인, 보완 피드는 언론사별 최근 RSS 항목에 한정됩니다.'],
    photos: ['Flickr 공개 사진 RSS', '사진 원본 페이지에서 작성자 표시와 이용 조건을 확인하세요.'],
    academic: ['arXiv 주제별 RSS', '학술자료 검색은 arXiv 주제 피드 기반이며 모든 학술 데이터베이스를 검색하지 않습니다.']
  };
  $('#search-status').textContent = descriptions[type][0];
  $('#search-disclaimer').textContent = descriptions[type][1];
}
const searchTabs = $$('[data-search-type]');
searchTabs.forEach(button => {
  button.addEventListener('click', () => setSearchType(button.dataset.searchType));
  button.addEventListener('keydown', event => {
    const currentIndex = searchTabs.indexOf(button);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % searchTabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + searchTabs.length) % searchTabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = searchTabs.length - 1;
    else return;
    event.preventDefault();
    setSearchType(searchTabs[nextIndex].dataset.searchType);
    searchTabs[nextIndex].focus();
  });
});
setSearchType('news');

function formatResultDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}

function describeRssFailure(data, status) {
  const provider = data?.provider || 'RSS 제공처';
  const upstream = Number(data?.upstreamStatus || 0);
  if (data?.failureKind === 'rate_limited') {
    const seconds = Math.max(1, Number(data.retryAfterSeconds || 60));
    return `짧은 시간에 검색 요청이 많아 잠시 제한됐습니다. 약 ${seconds}초 뒤 다시 시도해 주세요.`;
  }
  if (data?.failureKind === 'news_all_feeds_failed') {
    const failures = (Array.isArray(data.backupFailures) ? data.backupFailures : [])
      .map(item => `${item.provider}: ${item.upstreamStatus ? `HTTP ${item.upstreamStatus}` : item.failureKind}`).join(' · ');
    const primary = data.primaryMessage ? `Google News: ${data.primaryMessage}` : 'Google News RSS 연결 실패';
    return `${primary}. 국내 언론사 RSS 보완 경로도 연결되지 않았습니다.${failures ? ` 보완 경로: ${failures}` : ''}`;
  }
  if (data?.failureKind === 'upstream_access_restricted' || data?.accessRestrictionSuspected) {
    return `${provider}가 자동 요청 또는 접근 제한 안내를 포함한 응답을 반환했습니다. Worker 실행 환경에 대한 제공처 측 제한일 수 있어요. 검색 방식을 몰래 바꾸지 않고 여기서 멈췄습니다.`;
  }
  if (upstream === 503) return `${provider}가 HTTP 503을 반환했습니다. 제공처의 일시 장애 또는 실행 서버에 대한 접근 제한인지 추가 확인이 필요합니다.`;
  if (upstream === 429) return `${provider}가 요청 횟수 제한(HTTP 429)을 반환했습니다. 잠시 기다린 뒤 다시 시도해 주세요.`;
  if (upstream) return `${provider}가 HTTP ${upstream}을 반환했습니다. 제공처의 RSS 응답을 확인해야 합니다.`;
  const messages = {
    upstream_timeout: 'RSS 제공처의 응답 시간이 초과됐습니다.',
    upstream_network_error: 'RSS 제공처에 연결하지 못했습니다. Worker의 외부 통신 또는 제공처 상태를 확인해야 합니다.',
    invalid_rss: '제공처 응답이 정상적인 RSS 형식이 아닙니다.',
    unexpected_content_type: 'RSS/XML이 아닌 콘텐츠 형식이 반환됐습니다.',
    unexpected_redirect: '허용되지 않은 주소로 이동하려 해 보안상 요청을 중단했습니다.',
    feed_too_large: 'RSS 피드가 허용 크기(5MB)를 초과했습니다.'
  };
  return messages[data?.failureKind] || data?.error || `RSS 검색에 실패했습니다. (HTTP ${status})`;
}

function renderSearchResults(items, requestedType, provider) {
  return items.map(item => {
    const link = safeWebUrl(item.url);
    if (!link) return '';
    const imageUrl = safeImageUrl(item.image);
    const date = formatResultDate(item.publishedAt);
    const category = item.category || SEARCH_LABELS[requestedType];
    const image = requestedType === 'photos' && imageUrl
      ? `<div class="result-image-wrap"><img class="result-image" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.title)}" loading="lazy" referrerpolicy="no-referrer"></div>`
      : '';
    const credit = item.author
      ? `<small class="result-credit">사진 제공: ${escapeHtml(item.author)}${item.license ? ` · ${escapeHtml(item.license)}` : ' · 이용 조건은 원문에서 확인'}</small>`
      : '';
    const description = String(item.description || '').slice(0, requestedType === 'photos' ? 200 : 420);
    const source = item.source || item.provider || provider || 'RSS';
    return `<article class="result-card${image ? ' has-image' : ''}">${image}<div class="result-content"><div class="result-top"><span class="type-badge type-${escapeHtml(item.type || 'other')}">${escapeHtml(category)}</span><span class="source-tag">${escapeHtml(source)}</span>${date ? `<time class="muted-label">${escapeHtml(date)}</time>` : ''}</div><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(description || '제공처에서 공개한 요약이 없습니다. 원문에서 내용을 확인하세요.')}</p>${credit}<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${requestedType === 'photos' ? '사진 원본과 이용 조건 확인 ↗' : '원문과 출처 확인 ↗'}</a></div></article>`;
  }).join('');
}

function renderSearchError(data, status) {
  const detail = describeRssFailure(data, status);
  const upstreamText = data?.upstreamMessage
    ? `<p class="diagnostic">제공처 응답 요약: ${escapeHtml(data.upstreamMessage)}</p>` : '';
  const contentType = data?.contentType ? `<p class="diagnostic">응답 형식: ${escapeHtml(data.contentType)}</p>` : '';
  let feedLink = '';
  const allowedHosts = new Set(['news.google.com', 'www.flickr.com', 'flickr.com', 'rss.arxiv.org']);
  const original = safeWebUrl(data?.feedUrl);
  if (original) {
    const url = new URL(original);
    if (url.protocol === 'https:' && allowedHosts.has(url.hostname)) {
      feedLink = `<p><a href="${escapeHtml(original)}" target="_blank" rel="noopener noreferrer">RSS 원본 주소를 직접 확인 ↗</a></p>`;
    }
  }
  return `<div class="empty-state error-state"><div aria-hidden="true">!</div><h2>자료를 불러오지 못했어요</h2><p>${escapeHtml(detail)}</p>${upstreamText}${contentType}${feedLink}<button class="secondary-btn" type="button" data-retry-search>다시 검색하기</button></div>`;
}

$('#search-results').addEventListener('click', event => {
  if (event.target.closest('[data-retry-search]') && lastSearch) runSearch(lastSearch.query, lastSearch.type);
});

async function runSearch(query, type) {
  if (searchController) searchController.abort();
  const controller = new AbortController();
  searchController = controller;
  const requestId = ++searchRequestId;
  const timeout = setTimeout(() => controller.abort(), 65000);
  const formButton = $('#search-form button[type="submit"]');
  const results = $('#search-results');
  const tabs = $$('[data-search-type]');
  lastSearch = { query, type };
  formButton.disabled = true;
  tabs.forEach(button => { button.disabled = true; });
  results.setAttribute('aria-busy', 'true');
  $('#search-status').textContent = `${SEARCH_LABELS[type]} RSS 피드를 읽고 있어요…`;
  results.innerHTML = '<div class="loading-state"><span class="spinner" aria-hidden="true"></span><b>공개 RSS 피드를 확인하고 있습니다</b><p>제공처 응답에 따라 시간이 조금 걸릴 수 있어요.</p></div>';
  try {
    const response = await fetch(`/api/search?type=${encodeURIComponent(type)}&q=${encodeURIComponent(query)}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    });
    let data;
    try { data = await response.json(); }
    catch { throw new Error(`서버가 JSON이 아닌 응답을 보냈습니다. HTTP ${response.status}. Worker 배포 설정을 확인해 주세요.`); }
    if (requestId !== searchRequestId) return;
    if (!response.ok) {
      $('#search-status').textContent = 'RSS 제공처 연결에 실패했습니다.';
      results.innerHTML = renderSearchError(data, response.status);
      return;
    }
    const items = Array.isArray(data.results) ? data.results : [];
    $('#search-status').textContent = data.notice || `“${query}” 관련 자료 ${items.length}개 · ${data.provider || 'RSS'}`;
    results.innerHTML = items.length
      ? renderSearchResults(items, type, data.provider)
      : `<div class="empty-state"><div aria-hidden="true">⌕</div><h2>일치하는 자료가 없어요</h2><p>${escapeHtml(data.notice || '검색어를 더 짧게 바꾸거나 다른 표현으로 다시 검색해 보세요.')}</p></div>`;
    if (!saveHistory({ type: 'search', title: `${SEARCH_LABELS[type]} · ${query}` })) {
      toast('검색은 완료됐지만 브라우저 기록 저장은 건너뛰었습니다.');
    }
  } catch (error) {
    if (requestId !== searchRequestId) return;
    const message = error?.name === 'AbortError'
      ? 'RSS 제공처 응답이 늦어지고 있습니다. 잠시 후 다시 시도해 주세요.'
      : error?.message || '알 수 없는 오류가 발생했습니다.';
    $('#search-status').textContent = '검색 중 문제가 발생했습니다.';
    results.innerHTML = `<div class="empty-state error-state"><div aria-hidden="true">!</div><h2>검색을 완료하지 못했어요</h2><p>${escapeHtml(message)}</p><button class="secondary-btn" type="button" data-retry-search>다시 검색하기</button></div>`;
  } finally {
    clearTimeout(timeout);
    if (searchController === controller) searchController = null;
    if (requestId === searchRequestId) {
      formButton.disabled = false;
      tabs.forEach(button => { button.disabled = false; });
      results.setAttribute('aria-busy', 'false');
    }
  }
}

$('#search-form').addEventListener('submit', event => {
  event.preventDefault();
  const query = $('#search-input').value.trim();
  if (query.length < 2) {
    toast('검색어를 두 글자 이상 입력해 주세요.');
    $('#search-input').focus();
    return;
  }
  runSearch(query, searchType);
});

const textArea = $('#task-content');
textArea.addEventListener('input', () => {
  $('#char-count').textContent = `${textArea.value.length.toLocaleString('ko-KR')} / 30,000자`;
});

function collectReview(content, topic, taskType) {
  const text = content.replace(/\r/g, '').trim();
  const sentences = text.split(/(?<=[.!?。！？])\s+|\n+/).map(value => value.trim()).filter(Boolean);
  const paragraphs = text.split(/\n\s*\n/).map(value => value.trim()).filter(Boolean);
  const evidence = /(예를 들어|예를 들면|자료에 따르면|통계|연구 결과|조사 결과|출처|논문|보고서|설문|실험|관찰 결과|사례|데이터)/.test(text);
  const citation = /(https?:\/\/|doi\.org|참고문헌|출처\s*[:：]|저자\s*[:：]|\[\d+\])/.test(text);
  const reasoning = /(때문에|이유는|원인은|따라서|그러므로|결과적으로|이로 인해|왜냐하면|그 결과)/.test(text);
  const structure = /(첫째|둘째|셋째|서론|본론|결론|요약하면|마지막으로|정리하면)/.test(text);
  const counterpoint = /(반면|그러나|하지만|한편|반론|반대 의견|다른 관점|우려)/.test(text);
  const absoluteWords = [...new Set(text.match(/항상|절대|모두|전부|완전히|무조건|100%|틀림없이|반드시/g) || [])];
  const longSentences = sentences.filter(sentence => sentence.length > 100).length;
  const vagueWords = (text.match(/좋다|나쁘다|많다|적다|중요하다|심각하다/g) || []).length;
  const finalPart = text.slice(Math.floor(text.length * 0.7));
  const hasConclusion = /(결론적으로|정리하면|요약하면|따라서|이상으로|결론은|마지막으로|이 글에서는)/.test(finalPart);
  const topicTokens = (topic.toLowerCase().match(/[0-9a-z가-힣]{2,}/g) || []).filter(token => !['그리고', '대한', '관련', '영향'].includes(token));
  const topicHits = topicTokens.filter(token => text.toLowerCase().includes(token)).length;
  const topicConnected = !topicTokens.length || topicHits > 0;

  const strengths = [];
  if (evidence) strengths.push('사례·통계·연구 등 근거를 활용하려는 흔적이 있습니다.');
  if (reasoning) strengths.push('이유와 결과를 연결하는 표현이 있습니다.');
  if (structure) strengths.push('글의 순서를 안내하는 구조 표현이 있습니다.');
  if (paragraphs.length >= 2) strengths.push('내용을 두 개 이상의 문단으로 나누었습니다.');
  if (counterpoint && taskType === '주장하는 글') strengths.push('반대 관점이나 다른 의견을 언급했습니다.');
  if (!strengths.length) strengths.push('초안을 작성했습니다. 이제 주장과 근거를 구체화하면 됩니다.');

  const checks = [
    { name: '주제 연결', status: topicConnected ? '흔적 있음' : '다시 확인', detail: topicConnected ? '주제 핵심어가 글에 포함되어 있습니다. 주제에 직접 답하는 문장인지 확인하세요.' : '입력한 주제의 핵심어와 직접 연결되는 문장을 찾기 어렵습니다.' },
    { name: '근거와 출처', status: evidence ? (citation ? '표시 있음' : '출처 확인') : '보완 필요', detail: evidence ? (citation ? '근거 표현과 출처 표식이 함께 보입니다. 원자료의 신뢰성과 발행 시점을 확인하세요.' : '근거를 언급하지만 자료명·기관·작성자·링크 같은 출처 표식은 뚜렷하지 않습니다.') : '구체적인 사례·통계·조사·연구 등 근거를 찾기 어렵습니다.' },
    { name: '논리 흐름', status: reasoning ? '연결 표현 있음' : '보완 필요', detail: reasoning ? '이유나 결과를 연결하는 표현이 있습니다. 각 문장이 실제로 앞의 주장에 근거를 제공하는지 읽어보세요.' : '주장과 이유를 이어주는 설명이 적습니다. “왜 그런가?”에 답하는 문장을 추가해 보세요.' },
    { name: '구조와 마무리', status: structure && hasConclusion ? '구조 표현 있음' : '다시 확인', detail: `${paragraphs.length}개 문단, ${sentences.length}개 문장으로 감지했습니다. ${hasConclusion ? '마무리 표현이 보입니다.' : '마지막에 핵심을 정리하고 주제에 답하는 결론이 있는지 확인하세요.'}` },
    { name: '표현의 정확도', status: absoluteWords.length || vagueWords >= 2 ? '표현 점검' : '특이 표현 적음', detail: absoluteWords.length ? `“${absoluteWords.join('”, “')}” 같은 단정어는 예외와 근거를 확인하세요.` : vagueWords >= 2 ? '“좋다”, “많다”, “중요하다” 같은 넓은 표현을 수치·기준·사례로 바꿔 보세요.' : '단정적 표현이나 넓은 표현이 많이 감지되지는 않았습니다. 이것이 사실의 정확성을 보증하지는 않습니다.' }
  ];

  const improvements = [];
  if (!topicConnected) improvements.push('첫 문단에 과제 주제에 직접 답하는 핵심 문장을 추가하세요.');
  if (!evidence) improvements.push('주장을 뒷받침할 통계·실험·사례·신뢰할 수 있는 자료를 한 가지 이상 추가하세요.');
  if (evidence && !citation) improvements.push('자료의 제목, 작성 기관, 작성자, 발행일 또는 원문 링크를 출처로 남기세요.');
  if (!reasoning) improvements.push('근거 뒤에 “이 자료가 주장을 어떻게 뒷받침하는가?”를 설명하세요.');
  if (taskType === '주장하는 글' && !counterpoint) improvements.push('예상되는 반대 의견이나 다른 관점을 하나 제시하고 답변을 덧붙이세요.');
  if (!hasConclusion) improvements.push('마지막 문단에서 핵심 내용을 정리하고 처음의 질문에 답하세요.');
  if (longSentences) improvements.push(`${longSentences}개의 긴 문장을 둘로 나누어 핵심과 설명을 분리해 보세요.`);
  if (vagueWords >= 2) improvements.push('모호한 형용사 대신 구체적인 기준이나 사례를 사용하세요.');
  if (text.length < 250) improvements.push('과제 분량이 정해져 있다면 요구 조건과 필수 항목을 빠짐없이 다뤘는지 확인하세요.');
  if (!improvements.length) improvements.push('현재 구조를 유지하면서 인용한 원자료의 정확성, 최신성, 작성 기관을 마지막으로 확인하세요.');

  return { sentenceCount: sentences.length, paragraphCount: paragraphs.length, strengths, checks, improvements: [...new Set(improvements)].slice(0, 7) };
}

function renderReview(result) {
  const checks = result.checks.map(check => {
    const statusClass = check.status === '보완 필요' || check.status === '다시 확인' || check.status === '표현 점검' || check.status === '출처 확인' ? 'needs-check' : 'has-signal';
    return `<article class="check-card"><div class="check-head"><h3>${escapeHtml(check.name)}</h3><span class="check-status ${statusClass}">${escapeHtml(check.status)}</span></div><p>${escapeHtml(check.detail)}</p></article>`;
  }).join('');
  const strengths = result.strengths.map(value => `<li>${escapeHtml(value)}</li>`).join('');
  const improvements = result.improvements.map(value => `<li>${escapeHtml(value)}</li>`).join('');
  return `<div class="result-heading"><div><div class="eyebrow">REVIEW NOTES</div><h2>과제 점검 결과</h2><p class="result-summary">${result.sentenceCount}개 문장 · ${result.paragraphCount}개 문단 감지 · 점수 대신 확인할 항목을 정리했습니다.</p></div><button class="secondary-btn" id="copy-review" type="button">결과 복사</button></div><div class="check-grid">${checks}</div><div class="result-columns"><section><h3>잘 활용한 점</h3><ul>${strengths}</ul></section><section><h3>다음 수정 제안</h3><ol>${improvements}</ol></section></div><p class="feedback-disclaimer"><b>분석 한계:</b> 이 도구는 문장 속 신호를 찾는 규칙 기반 자동 점검입니다. 자료의 진위, 인용의 정확성, 논리의 타당성, 과제 점수를 판정하지 않습니다. 표시된 결과를 출발점으로 삼아 원문과 교사의 과제 조건을 직접 확인하세요.</p>`;
}

$('#feedback-form').addEventListener('submit', event => {
  event.preventDefault();
  const content = textArea.value.trim();
  const topic = $('#task-topic').value.trim();
  const taskType = $('#task-type').value;
  if (content.length < 30) {
    toast('30자 이상 입력해 주세요.');
    textArea.focus();
    return;
  }
  const button = event.submitter || $('#feedback-form button[type="submit"]');
  button.disabled = true;
  button.textContent = '점검 중…';
  const output = $('#feedback-result');
  output.classList.remove('hidden');
  output.innerHTML = '<div class="loading-state"><span class="spinner" aria-hidden="true"></span><b>세 가지 관점으로 글의 신호를 살펴보고 있습니다</b></div>';
  try {
    const report = collectReview(content, topic, taskType);
    output.innerHTML = renderReview(report);
    const historySaved = saveHistory({ type: 'feedback', title: topic || taskType });
    if (!historySaved) toast('점검은 완료됐지만 브라우저 기록 저장은 건너뛰었습니다.');
    $('#copy-review').addEventListener('click', async () => {
      const text = [
        'STUDY HUB PRO · 과제 점검 결과',
        `${report.sentenceCount}개 문장 · ${report.paragraphCount}개 문단`,
        '', '검토 항목',
        ...report.checks.map(item => `- ${item.name} (${item.status}): ${item.detail}`),
        '', '잘 활용한 점', ...report.strengths.map(item => `- ${item}`),
        '', '다음 수정 제안', ...report.improvements.map(item => `- ${item}`),
        '', '규칙 기반 자동 점검이며 사실 여부나 과제 점수를 판정하지 않습니다.'
      ].join('\n');
      try {
        await navigator.clipboard.writeText(text);
        toast('점검 결과를 복사했습니다.');
      } catch {
        toast('브라우저에서 클립보드 접근을 허용하지 않았습니다.');
      }
    });
    output.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    output.innerHTML = `<p class="error-text">점검 중 문제가 발생했습니다: ${escapeHtml(error.message)}</p>`;
  } finally {
    button.disabled = false;
    button.innerHTML = '과제 점검하기 <span aria-hidden="true">✳</span>';
  }
});

// Honor a valid deep link on first load after all event handlers are ready.
const initialView = location.hash.slice(1);
if (VIEWS.includes(initialView)) navigate(initialView);
else navigate('home');
