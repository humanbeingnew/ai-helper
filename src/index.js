const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

const RSS_HEADERS = {
  "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
  "User-Agent": "STUDY-HUB-PRO/4.0 (+https://study-hub-pro.pages.dev)"
};

const API_HEADERS = {
  "Accept": "application/json",
  "User-Agent": "STUDY-HUB-PRO/4.0"
};

const json = (data, status = 200, extraHeaders = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { ...JSON_HEADERS, ...extraHeaders }
});

function clean(value = "") {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value = "") {
  return clean(value).toLowerCase()
    .replace(/[“”‘’'"`]/g, "")
    .replace(/[^0-9a-z가-힣\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function queryTokens(query = "") {
  const raw = normalizeText(query).split(/\s+/).filter(Boolean);
  const particles = /(으로부터|에게서|에서는|으로는|이라도|까지는|부터는|에게|에서|으로|이라|이랑|하고|보다|처럼|까지|부터|의|은|는|이|가|을|를|에|와|과|로)$/;
  const out = [];
  for (const token of raw) {
    if (token.length >= 2) out.push(token);
    const stem = token.replace(particles, "");
    if (stem.length >= 2) out.push(stem);
  }
  return [...new Set(out)];
}

function dateMs(value) {
  const t = Date.parse(value || "");
  return Number.isFinite(t) ? t : 0;
}

function ageDays(value) {
  const t = dateMs(value);
  if (!t) return Infinity;
  return Math.max(0, (Date.now() - t) / 86400000);
}

function freshness(value) {
  const d = ageDays(value);
  if (!Number.isFinite(d)) return -6;
  if (d <= 1) return 40;
  if (d <= 3) return 35;
  if (d <= 7) return 30;
  if (d <= 14) return 25;
  if (d <= 30) return 18;
  if (d <= 90) return 9;
  if (d <= 180) return 2;
  if (d <= 365) return -8;
  return -25;
}

function relevance(query, title = "", description = "") {
  const q = normalizeText(query);
  const t = normalizeText(title);
  const d = normalizeText(description);
  if (!q || !t) return 0;
  const tokens = queryTokens(query);
  let score = 0;
  if (t === q) score += 120;
  if (t.includes(q)) score += 80;
  if (d.includes(q)) score += 20;

  let titleHits = 0;
  let bodyHits = 0;
  for (const token of tokens) {
    if (t.includes(token)) { score += 32; titleHits++; }
    else if (d.includes(token)) { score += 9; bodyHits++; }
  }
  if (tokens.length > 1) {
    const coverage = (titleHits + bodyHits) / tokens.length;
    score += Math.round(coverage * 35);
    if (titleHits === tokens.length) score += 35;
  }
  return score;
}

function isRecentEnough(item, maxDays) {
  const d = ageDays(item.publishedAt);
  return !Number.isFinite(d) ? false : d <= maxDays;
}

function sourceWeight(type) {
  return {
    "naver-news": 12,
    "news": 9,
    "column": 7,
    "academic": 5,
    "reference": -20
  }[type] ?? 0;
}

function scoreItem(query, item) {
  const rel = relevance(query, item.title, item.description);
  const fresh = freshness(item.publishedAt);
  const score = rel * 2 + fresh + sourceWeight(item.type);
  return { ...item, relevance: rel, rank: score };
}

function parseDate(value = "") {
  const v = clean(value);
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

async function fetchWithTimeout(url, timeoutMs, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: "GET", headers, redirect: "follow", signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`timeout(${timeoutMs}ms)`);
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, timeoutMs = 4500) {
  const response = await fetchWithTimeout(url, timeoutMs, API_HEADERS);
  const text = await response.text();
  try { return JSON.parse(text); }
  catch { throw new Error("invalid-json"); }
}

async function fetchXml(url, timeoutMs = 4500) {
  const response = await fetchWithTimeout(url, timeoutMs, RSS_HEADERS);
  return response.text();
}

function xmlTag(block, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(re);
  return m ? clean(m[1]) : "";
}

function xmlAttr(block, tag, attr) {
  const re = new RegExp(`<${tag}\\b[^>]*\\b${attr}=["']([^"']+)["'][^>]*>`, "i");
  const m = block.match(re);
  return m ? clean(m[1]) : "";
}

function parseFeed(xml = "") {
  const items = [];
  const rssItems = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map(m => m[0]);
  const atomItems = [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map(m => m[0]);

  for (const block of [...rssItems, ...atomItems]) {
    const linkTag = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i);
    const rawLink = xmlTag(block, "link") || (linkTag ? clean(linkTag[1]) : "");
    const enclosure = xmlAttr(block, "enclosure", "url") || xmlAttr(block, "media:content", "url") || xmlAttr(block, "media:thumbnail", "url");
    const source = xmlTag(block, "source") || xmlTag(block, "News:Source") || xmlTag(block, "dc:creator");
    const title = xmlTag(block, "title");
    const description = xmlTag(block, "description") || xmlTag(block, "summary") || xmlTag(block, "content");
    const publishedAt = parseDate(xmlTag(block, "pubDate") || xmlTag(block, "published") || xmlTag(block, "updated") || xmlTag(block, "dc:date"));
    if (title && rawLink) items.push({ title, description, url: rawLink, publishedAt, source, image: enclosure });
  }
  return items;
}

function unwrapBingUrl(url = "") {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith("bing.com") && u.pathname === "/news/apiclick.aspx") {
      return u.searchParams.get("url") || url;
    }
  } catch {}
  return url;
}

async function googleNews(query, extra = "") {
  const q = extra ? `${query} ${extra}` : query;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ko&gl=KR&ceid=KR:ko`;
  return parseFeed(await fetchXml(url, 4200));
}

async function bingNews(query, extra = "") {
  const q = extra ? `${query} ${extra}` : query;
  const url = `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&setmkt=ko-KR&format=rss`;
  return parseFeed(await fetchXml(url, 4200)).map(x => ({ ...x, url: unwrapBingUrl(x.url) }));
}

async function bingWeb(query, extra = "") {
  const q = extra ? `${query} ${extra}` : query;
  const url = `https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=ko-KR&format=rss`;
  return parseFeed(await fetchXml(url, 4200)).map(x => ({ ...x, url: unwrapBingUrl(x.url) }));
}

async function openAlex(query) {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 5);
  const date = cutoff.toISOString().slice(0, 10);
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&filter=from_publication_date:${date}&per-page=30&sort=relevance_score:desc`;
  const data = await fetchJson(url, 4800);
  return (data.results || []).map(work => ({
    source: "OPENALEX · 학술 자료",
    type: "academic",
    title: clean(work.display_name),
    description: clean(work.abstract_inverted_index ? Object.keys(work.abstract_inverted_index).slice(0, 40).join(" ") : ((work.authorships || []).slice(0, 3).map(a => a.author?.display_name).filter(Boolean).join(", ") || "공개 학술 메타데이터")),
    publishedAt: parseDate(work.publication_date),
    url: work.primary_location?.landing_page_url || work.doi || work.id,
    image: "",
    openAlexScore: Number(work.relevance_score || 0)
  })).filter(x => x.title && x.url);
}

async function wikipedia(query) {
  const url = `https://ko.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=5&srnamespace=0&srprop=snippet&format=json`;
  const data = await fetchJson(url, 3500);
  return (data.query?.search || []).map(page => ({
    source: "WIKIPEDIA · 배경 자료",
    type: "reference",
    title: clean(page.title),
    description: clean(page.snippet),
    publishedAt: "",
    url: `https://ko.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`,
    image: ""
  }));
}

function toNewsItems(items, type = "news", label = "NEWS") {
  return items.map(item => ({
    source: item.source ? `${label} · ${item.source}` : label,
    type,
    title: item.title,
    description: item.description || "",
    publishedAt: item.publishedAt || "",
    url: item.url,
    image: item.image || ""
  }));
}

function domainOf(url = "") {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
}

function isNaverNews(url) {
  const h = domainOf(url);
  return h === "news.naver.com" || h.endsWith(".news.naver.com") || h === "n.news.naver.com";
}

function isNaverBlog(url) {
  const h = domainOf(url);
  return h === "blog.naver.com" || h.endsWith(".blog.naver.com") || h === "m.blog.naver.com";
}

function normalizeUrl(url = "") {
  try {
    const u = new URL(url);
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid", "ocid"].forEach(k => u.searchParams.delete(k));
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch { return url; }
}

function mergeDeduped(items) {
  const map = new Map();
  for (const item of items) {
    const key = normalizeUrl(item.url) || normalizeText(item.title);
    if (!key) continue;
    const old = map.get(key);
    if (!old || item.rank > old.rank) map.set(key, item);
  }
  return [...map.values()];
}

function selectBalanced(items, max = 15) {
  const buckets = new Map();
  for (const item of items) {
    const key = item.type;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(item);
  }
  for (const arr of buckets.values()) arr.sort((a, b) => b.rank - a.rank);

  const priority = ["naver-news", "news", "column", "academic", "reference"];
  const output = [];
  // 먼저 각 유형에서 최소 1개씩 가져와 한 제공처가 화면을 독점하지 못하게 합니다.
  for (const type of priority) {
    const item = buckets.get(type)?.shift();
    if (item) output.push(item);
    if (output.length >= max) return output;
  }
  const rest = [...buckets.values()].flat().sort((a, b) => b.rank - a.rank);
  output.push(...rest.slice(0, max - output.length));
  return output.sort((a, b) => b.rank - a.rank).slice(0, max);
}

function buildSourceResult(query, raw, type, label, maxAge, allowUndated = false) {
  return raw
    .filter(x => x.title && x.url)
    .map(x => ({ ...x, type, source: x.source || label }))
    .filter(x => {
      const rel = relevance(query, x.title, x.description);
      const age = ageDays(x.publishedAt);
      const fresh = Number.isFinite(age) ? age <= maxAge : (allowUndated && rel >= 105);
      return rel >= 55 && fresh;
    })
    .map(x => scoreItem(query, x));
}

async function searchMaterials(query) {
  const q = clean(query).slice(0, 160);
  if (q.length < 2) return json({ error: "검색어를 2자 이상 입력해 주세요." }, 400);

  // 검색어 하나에 모든 결과를 억지로 섞지 않습니다.
  // ① 최신 뉴스 ② 네이버 뉴스 ③ 네이버 블로그/칼럼 ④ 학술자료를 독립적으로 수집합니다.
  const jobs = {
    googleNews: googleNews(q, "when:30d"),
    googleNaverNews: googleNews(q, "site:news.naver.com when:90d"),
    googleNaverBlog: googleNews(q, "site:blog.naver.com when:180d"),
    bingNews: bingNews(q, "freshness:Month"),
    bingNaverNews: bingNews(q, "site:news.naver.com"),
    bingNaverBlog: bingWeb(q, "site:blog.naver.com"),
    openAlex: openAlex(q)
  };
  const entries = Object.entries(jobs);
  const settled = await Promise.allSettled(entries.map(([, p]) => p));
  const raw = Object.fromEntries(settled.map((result, i) => [entries[i][0], result]));

  const providers = [];
  const warnings = {};
  const take = (name, label) => {
    const r = raw[name];
    if (r?.status === "fulfilled") { providers.push(label); return r.value; }
    warnings[label] = r?.reason?.message || "연결 실패";
    return [];
  };

  const googleItems = take("googleNews", "Google News RSS");
  const googleNaverNewsItems = take("googleNaverNews", "Naver News via Google RSS");
  const googleNaverBlogItems = take("googleNaverBlog", "Naver Blog via Google RSS");
  const bingItems = take("bingNews", "Bing News RSS");
  const bingNaverNewsItems = take("bingNaverNews", "Naver News via Bing RSS");
  const bingNaverBlogItems = take("bingNaverBlog", "Naver Blog via Bing RSS");
  const academicItems = take("openAlex", "OpenAlex");

  let results = [];
  results.push(...buildSourceResult(q, toNewsItems(googleItems, "news", "NEWS"), "news", "NEWS", 30));
  results.push(...buildSourceResult(q, toNewsItems(bingItems, "news", "NEWS"), "news", "NEWS", 30));
  results.push(...buildSourceResult(q, toNewsItems(googleNaverNewsItems, "naver-news", "NAVER NEWS"), "naver-news", "NAVER NEWS", 90));
  results.push(...buildSourceResult(q, toNewsItems(bingNaverNewsItems, "naver-news", "NAVER NEWS"), "naver-news", "NAVER NEWS", 90));
  results.push(...buildSourceResult(q, toNewsItems(googleNaverBlogItems, "column", "NAVER BLOG · RSS"), "column", "NAVER BLOG · RSS", 180, true));
  results.push(...buildSourceResult(q, toNewsItems(bingNaverBlogItems, "column", "NAVER BLOG · RSS"), "column", "NAVER BLOG · RSS", 180, true));
  results.push(...buildSourceResult(q, academicItems, "academic", "OPENALEX", 365 * 5));

  // 네이버 도메인 판별을 RSS 결과의 실제 링크 기준으로 다시 수행합니다.
  results = results.map(item => {
    if (isNaverNews(item.url)) return { ...item, type: "naver-news", source: "NAVER NEWS · RSS" };
    if (isNaverBlog(item.url)) return { ...item, type: "column", source: "NAVER BLOG · RSS" };
    return item;
  }).map(item => scoreItem(q, item));

  // 같은 URL뿐 아니라 같은 제목도 중복 제거합니다.
  const urlMap = new Map();
  const titleMap = new Map();
  for (const item of results) {
    const u = normalizeUrl(item.url);
    const t = normalizeText(item.title);
    if (!u || !t) continue;
    if (urlMap.has(u)) continue;
    if (titleMap.has(t) && titleMap.get(t).rank >= item.rank) continue;
    urlMap.set(u, item);
    titleMap.set(t, item);
  }
  results = [...urlMap.values()];

  // 검색어와 관계없는 결과가 화면을 채우는 것을 최우선으로 막습니다.
  results = results.filter(x => x.relevance >= 55);
  results.sort((a, b) => b.rank - a.rank);

  let selected = selectBalanced(results, 15);

  // 정말로 뉴스/학술자료가 하나도 없을 때만 Wikipedia를 보조자료로 사용합니다.
  // 정상적인 검색에서는 Wikipedia가 다른 자료를 밀어내지 못합니다.
  if (!selected.length) {
    try {
      const refs = await wikipedia(q);
      const refItems = refs.map(x => scoreItem(q, x)).filter(x => x.relevance >= 55).slice(0, 3);
      selected = refItems;
      if (refItems.length) providers.push("Wikipedia fallback");
    } catch (error) {
      warnings.Wikipedia = error.message || "연결 실패";
    }
  }

  // 이미지를 보조적으로 채웁니다. 이미지 실패는 검색 실패로 취급하지 않습니다.
  try {
    const titles = [...new Set(selected.filter(x => !x.image).map(x => x.title))].slice(0, 10);
    if (titles.length) {
      const imageUrl = `https://ko.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=pageimages&piprop=thumbnail&pithumbsize=520&pilicense=free&titles=${encodeURIComponent(titles.join("|"))}`;
      const imageData = await fetchJson(imageUrl, 1800);
      const imageMap = new Map(Object.values(imageData.query?.pages || {})
        .filter(page => page.title && page.thumbnail?.source)
        .map(page => [normalizeText(page.title), page.thumbnail.source]));
      selected = selected.map(item => ({ ...item, image: item.image || imageMap.get(normalizeText(item.title)) || "" }));
    }
  } catch (error) {
    warnings.Images = error.message || "이미지 조회 실패";
  }

  // 최신성 검증이 가능한 결과만 '최신 자료'로 표시합니다.
  const recentCount = selected.filter(x => Number.isFinite(ageDays(x.publishedAt)) && ageDays(x.publishedAt) <= 90).length;
  const counts = selected.reduce((acc, x) => { acc[x.type] = (acc[x.type] || 0) + 1; return acc; }, {});

  const finalResults = selected.slice(0, 15).map(({ rank, relevance: rel, openAlexScore, ...item }) => item);
  const hasPrimary = finalResults.some(x => ["news", "naver-news", "column", "academic"].includes(x.type));

  return json({
    query: q,
    results: finalResults,
    providers: [...new Set(providers)],
    counts,
    recentCount,
    notice: hasPrimary
      ? "관련도 높은 최신 자료를 우선 표시했습니다. 네이버 뉴스·블로그는 공개 RSS로 확인되는 자료만 포함됩니다."
      : "관련도 높은 배경 자료를 찾았습니다. 최신 뉴스/학술자료가 확인되면 해당 자료를 우선 표시합니다.",
    searchPolicy: {
      newsDays: 30,
      naverNewsDays: 90,
      naverBlogDays: 180,
      academicYears: 5,
      wikipediaFallbackOnly: true
    },
    ...(Object.keys(warnings).length ? { providerWarnings: warnings } : {})
  }, 200, { "Cache-Control": "public, max-age=60, stale-while-revalidate=120" });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "study-hub-pro",
        version: "4.0.0",
        worker: "online",
        time: new Date().toISOString(),
        naverApiKeyRequired: false,
        searchSources: ["Google News RSS", "Bing News RSS", "Naver News via RSS index", "Naver Blog via RSS index", "OpenAlex"],
        wikipediaMode: "fallback-only"
      });
    }

    if (url.pathname === "/api/search") {
      if (request.method !== "GET") return json({ error: "GET 요청만 지원합니다." }, 405, { Allow: "GET" });
      try {
        return await searchMaterials(url.searchParams.get("q") || "");
      } catch (error) {
        return json({ error: "검색 처리 중 서버 오류가 발생했어요.", detail: error instanceof Error ? error.message : "unknown" }, 500);
      }
    }

    return env.ASSETS.fetch(request);
  }
};
