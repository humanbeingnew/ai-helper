const json = (data, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders
    }
  });

function clean(value = "") {
  return String(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

const REQUEST_HEADERS = {
  "Accept": "application/json",
  "User-Agent": "STUDY-HUB-PRO/3.0"
};

async function fetchJson(url, timeoutMs = 10000, headers = REQUEST_HEADERS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    const response = await fetch(url, { method: "GET", headers, signal: controller.signal, redirect: "follow" });
    const body = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}${body ? `: ${body.slice(0, 180)}` : ""}`);
    try { return JSON.parse(body); } catch { throw new Error("JSON이 아닌 응답을 받았습니다."); }
  } catch (error) {
    if (error?.name === "AbortError" || String(error?.message).includes("timeout")) throw new Error("응답 시간 초과");
    throw error instanceof Error ? error : new Error(String(error));
  } finally { clearTimeout(timer); }
}

async function fetchText(url, timeoutMs = 10000, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    const response = await fetch(url, { headers: { "User-Agent": REQUEST_HEADERS["User-Agent"], ...headers }, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } catch (error) {
    if (error?.name === "AbortError" || String(error?.message).includes("timeout")) throw new Error("응답 시간 초과");
    throw error instanceof Error ? error : new Error(String(error));
  } finally { clearTimeout(timer); }
}

function normalizeTitle(value = "") {
  return clean(value).toLowerCase().replace(/[“”‘’'"`]/g, "").replace(/\s+/g, " ").trim();
}

function queryTokens(query = "") {
  const raw = normalizeTitle(query).split(/[^0-9a-z가-힣]+/i).filter(t => t.length >= 2);
  // 한국어 조사·어미 때문에 "인공지능이"와 "인공지능"이 불일치하는 문제를 줄입니다.
  const particles = /(으로부터|에게서|에서는|으로는|이라도|까지는|부터는|에게|에서|으로|이라|이랑|하고|보다|처럼|까지|부터|의|은|는|이|가|을|를|에|와|과|로)$/;
  const normalized = raw.map(t => t.replace(particles, "")).filter(t => t.length >= 2);
  return [...new Set([...raw, ...normalized])];
}

function relevanceScore(query, title = "", description = "") {
  const q = normalizeTitle(query);
  const t = normalizeTitle(title);
  const d = normalizeTitle(description);
  const tokens = queryTokens(query);
  if (!q || !t) return 0;
  let score = 0;
  if (t === q) score += 100;
  if (t.includes(q)) score += 55;
  if (d.includes(q)) score += 18;
  for (const token of tokens) {
    if (t.includes(token)) score += 24;
    else if (d.includes(token)) score += 7;
  }
  return score;
}

function daysAgo(dateValue) {
  const time = Date.parse(dateValue || "");
  if (!time) return Infinity;
  return Math.max(0, (Date.now() - time) / 86400000);
}

function freshnessScore(dateValue) {
  const days = daysAgo(dateValue);
  if (!Number.isFinite(days)) return 0;
  if (days <= 7) return 30;
  if (days <= 30) return 24;
  if (days <= 90) return 17;
  if (days <= 180) return 9;
  if (days <= 365) return 3;
  return -15;
}

function rankResult(query, item) {
  const relevance = relevanceScore(query, item.title, item.description);
  const freshness = freshnessScore(item.publishedAt);
  const typeBoost = item.type === "news" ? 7 : item.type === "naver" ? 6 : item.type === "academic" ? 3 : 0;
  return relevance * 2 + freshness + typeBoost;
}

function decodeXml(value = "") {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function rssTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? decodeXml(m[1]).trim() : "";
}

function parseRssItems(xml = "") {
  return [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map(m => {
    const block = m[0];
    const enclosure = block.match(/<enclosure[^>]+url=["']([^"']+)["']/i);
    const media = block.match(/<media:content[^>]+url=["']([^"']+)["']/i);
    const thumbnail = block.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i);
    return {
      title: clean(rssTag(block, "title")),
      description: clean(rssTag(block, "description")),
      url: rssTag(block, "link"),
      publishedAt: rssTag(block, "pubDate"),
      source: clean(rssTag(block, "source")),
      image: enclosure?.[1] || media?.[1] || thumbnail?.[1] || ""
    };
  }).filter(x => x.title && x.url);
}

async function fetchGoogleNewsRss(query, site, days = 90) {
  // 순차 재시도 대신 피드별 1회 요청으로 검색 지연을 줄입니다.
  const q = `${query} site:${site} when:${days}d`;
  const headers = { Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8" };
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ko&gl=KR&ceid=KR:ko`;
  const xml = await fetchText(url, 4500, headers);
  return parseRssItems(xml);
}

async function searchMaterials(query, env) {
  const q = query.trim().slice(0, 160);
  if (q.length < 2) return json({ error: "검색어를 2자 이상 입력해 주세요." }, 400);

  const now = new Date();
  const recentCutoff = new Date(now);
  recentCutoff.setDate(recentCutoff.getDate() - 180);
  const recentDate = recentCutoff.toISOString().slice(0, 10);
  const academicCutoff = new Date(now);
  academicCutoff.setFullYear(academicCutoff.getFullYear() - 3);
  const academicDate = academicCutoff.toISOString().slice(0, 10);

  const openAlexRecentUrl = `https://api.openalex.org/works?search=${encodeURIComponent(q)}&filter=from_publication_date:${academicDate}&per-page=20&sort=publication_date:desc`;
  const openAlexRelevantUrl = `https://api.openalex.org/works?search=${encodeURIComponent(q)}&per-page=20&sort=relevance_score:desc`;
  const wikiUrl = `https://ko.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=5&srnamespace=0&srprop=snippet|timestamp&format=json`;
  const googleNewsUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:90d`)}&hl=ko&gl=KR&ceid=KR:ko`;

  // 네이버 검색 API 키 없이 Google News RSS에서 네이버 도메인 결과를 별도 수집합니다.
  const tasks = [
    fetchJson(openAlexRecentUrl, 5000),
    fetchJson(openAlexRelevantUrl, 5000),
    fetchJson(wikiUrl, 4000),
    fetchText(googleNewsUrl, 4500, { Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8" }),
    fetchGoogleNewsRss(q, "news.naver.com", 90),
    fetchGoogleNewsRss(q, "blog.naver.com", 180)
  ];
  const [openAlexRecent, openAlexRelevant, wikipedia, googleNews, naverNewsRss, naverBlogRss] = await Promise.allSettled(tasks);

  const results = [];
  const providers = [];
  const errors = {};
  const openAlexWorks = [];
  const seenWorks = new Set();
  const addWork = work => {
    const id = work.id || work.doi || work.display_name;
    if (!id || seenWorks.has(id)) return;
    seenWorks.add(id);
    openAlexWorks.push(work);
  };

  if (openAlexRecent.status === "fulfilled" || openAlexRelevant.status === "fulfilled") {
    providers.push("OpenAlex");
    if (openAlexRecent.status === "fulfilled") (openAlexRecent.value.results || []).forEach(addWork);
    if (openAlexRelevant.status === "fulfilled") (openAlexRelevant.value.results || []).forEach(addWork);
    const academic = openAlexWorks.map(work => ({
      source: "OPENALEX · 학술 자료",
      type: "academic",
      title: clean(work.display_name),
      year: work.publication_year || "",
      publishedAt: work.publication_date || "",
      description: clean((work.authorships || []).slice(0, 3).map(a => a.author?.display_name).filter(Boolean).join(", ")) || "공개 학술 메타데이터",
      url: work.primary_location?.landing_page_url || work.doi || work.id,
      image: "",
      relevance: work.relevance_score || 0
    })).filter(x => x.title);
    academic.forEach(x => x.rank = rankResult(q, x) + Math.min(15, (x.relevance || 0) * 2));
    results.push(...academic);
  } else {
    errors.OpenAlex = openAlexRecent.reason?.message || openAlexRelevant.reason?.message || "연결 실패";
  }

  if (wikipedia.status === "fulfilled") {
    providers.push("Wikipedia");
    for (const page of wikipedia.value.query?.search || []) {
      const item = {
        source: "WIKIPEDIA · 배경 자료",
        type: "reference",
        title: clean(page.title),
        year: "",
        publishedAt: "", // timestamp는 마지막 편집일이므로 발행일처럼 표시하지 않습니다.
        description: clean(page.snippet || ""),
        url: `https://ko.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`,
        image: ""
      };
      item.rank = rankResult(q, item) - 20;
      results.push(item);
    }
  } else errors.Wikipedia = wikipedia.reason?.message || "연결 실패";

  if (googleNews.status === "fulfilled") {
    providers.push("Google News");
    parseRssItems(googleNews.value).forEach(item => {
      const result = {
        source: item.source ? `NEWS · ${item.source}` : "NEWS · 최신 뉴스",
        type: "news",
        title: item.title,
        year: item.publishedAt ? new Date(item.publishedAt).getFullYear() : "",
        publishedAt: item.publishedAt || "",
        description: item.description || "최신 뉴스 검색 결과",
        url: item.url,
        image: item.image || ""
      };
      result.rank = rankResult(q, result);
      if (relevanceScore(q, result.title, result.description) >= 8 && (!result.publishedAt || daysAgo(result.publishedAt) <= 90)) results.push(result);
    });
  } else errors.GoogleNews = googleNews.reason?.message || "연결 실패";

  const addRssResults = (settled, label, type, maxAgeDays, rankPenalty = 0) => {
    if (settled.status !== "fulfilled") {
      errors[label] = settled.reason?.message || "RSS 피드 연결 실패";
      return;
    }
    providers.push(label);
    for (const item of settled.value) {
      const result = {
        source: label === "Naver News RSS" ? "NAVER NEWS · RSS" : "NAVER BLOG · RSS",
        type,
        title: item.title,
        year: item.publishedAt ? new Date(item.publishedAt).getFullYear() : "",
        publishedAt: item.publishedAt || "",
        description: item.description || "RSS 검색 결과",
        url: item.url,
        image: item.image || ""
      };
      result.rank = rankResult(q, result) + rankPenalty;
      if (relevanceScore(q, result.title, result.description) >= 8 && (!result.publishedAt || daysAgo(result.publishedAt) <= maxAgeDays)) results.push(result);
    }
  };
  addRssResults(naverNewsRss, "Naver News RSS", "news", 30, 5);
  addRssResults(naverBlogRss, "Naver Blog RSS", "column", 90, -2);

  // 검색어와 거의 관계없는 자료를 제거하고, 같은 제목은 하나만 남깁니다.
  const deduped = new Map();
  for (const item of results) {
    if (!item.title || !item.url) continue;
    const key = normalizeTitle(item.title);
    const score = item.rank ?? rankResult(q, item);
    item.rank = score;
    if (!deduped.has(key) || score > deduped.get(key).rank) deduped.set(key, item);
  }

  let ranked = [...deduped.values()]
    .filter(item => relevanceScore(q, item.title, item.description) >= 8)
    .sort((a, b) => b.rank - a.rank);

  // 최근성은 강하게 반영하되, 관련성이 높은 오래된 학술자료가 전부 사라지지 않도록 상한을 둡니다.
  const recent = ranked.filter(item => Number.isFinite(daysAgo(item.publishedAt)) && daysAgo(item.publishedAt) <= 180);
  const olderRelevant = ranked.filter(item => Number.isFinite(daysAgo(item.publishedAt)) && daysAgo(item.publishedAt) <= 730 && !recent.includes(item));
  const background = ranked.filter(item => item.type === "reference" && !recent.includes(item) && !olderRelevant.includes(item));
  ranked = [...recent.slice(0, 12), ...olderRelevant.slice(0, 4), ...background.slice(0, 2)];

  // 대표 이미지는 Wikipedia에서 학술자료와 Wikipedia 문서를 보완합니다.
  const imageTitles = [...new Set([
    ...openAlexWorks.map(work => clean(work.display_name)).filter(Boolean).slice(0, 10),
    ...ranked.filter(r => r.type === "reference").map(r => r.title).slice(0, 5)
  ])].slice(0, 15);
  if (imageTitles.length) {
    try {
      const imageUrl = `https://ko.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=pageimages&piprop=thumbnail&pithumbsize=520&pilicense=free&titles=${encodeURIComponent(imageTitles.join("|"))}`;
      const imageData = await fetchJson(imageUrl, 2500);
      const imageMap = new Map(Object.values(imageData.query?.pages || {})
        .filter(page => page.title && page.thumbnail?.source)
        .map(page => [normalizeTitle(page.title), page.thumbnail.source]));
      for (const item of ranked) if (!item.image) item.image = imageMap.get(normalizeTitle(item.title)) || "";
    } catch (error) { errors.Images = error.message || "이미지 조회 실패"; }
  }

  if (!providers.length) {
    return json({ error: "외부 자료 제공처에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.", providers, details: errors }, 502);
  }

  const finalResults = ranked.slice(0, 15).map(({ rank, relevance, ...item }) => item);
  const recentCount = finalResults.filter(r => Number.isFinite(daysAgo(r.publishedAt)) && daysAgo(r.publishedAt) <= 180).length;
  const hasNaver = providers.includes("Naver News RSS") || providers.includes("Naver Blog RSS");

  return json({
    query: q,
    providers,
    results: finalResults,
    notice: hasNaver
      ? `검색어 관련도 필터 · 최근 90일 뉴스 / 180일 블로그 RSS 우선 · 네이버 검색 API 키 불필요`
      : `검색어 관련도 필터 · 최신 RSS 우선 · 네이버 도메인 RSS는 색인된 공개 결과만 표시됩니다.`,
    recentCount,
    naverRssEnabled: true,
    ...(Object.keys(errors).length ? { providerWarnings: errors } : {})
  }, 200, { "Cache-Control": "public, max-age=60, stale-while-revalidate=120" });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "study-hub-pro", worker: "online", time: new Date().toISOString(), naverRssEnabled: true, naverApiKeyRequired: false });
    }
    if (url.pathname === "/api/search") {
      if (request.method !== "GET") return json({ error: "GET 요청만 지원합니다." }, 405, { Allow: "GET" });
      try { return await searchMaterials(url.searchParams.get("q") || "", env); }
      catch (error) { return json({ error: "검색 처리 중 서버 오류가 발생했어요.", detail: error instanceof Error ? error.message : "알 수 없는 오류" }, 500); }
    }
    return env.ASSETS.fetch(request);
  }
};
