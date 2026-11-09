const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

const FEED_HEADERS = {
  "Accept": "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
  "User-Agent": "STUDY-HUB-PRO/7.0 (RSS-only learning search)"
};

const json = (data, status = 200, extraHeaders = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { ...JSON_HEADERS, ...extraHeaders }
});

function decodeXml(value = "") {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'");
}

function textOnly(value = "") {
  return decodeXml(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getTag(block = "", tagName = "") {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}\\s*>`, "i"));
  return match ? match[1] : "";
}

function getAttribute(tag = "", name = "") {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(new RegExp(`\\b${escaped}\\s*=\\s*([\"'])([\\s\\S]*?)\\1`, "i"));
  return match ? decodeXml(match[2]) : "";
}

function safeHttpUrl(value = "") {
  try {
    const url = new URL(textOnly(value));
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function getFirstTag(block, names) {
  for (const name of names) {
    const value = getTag(block, name);
    if (value) return value;
  }
  return "";
}

function parseRss(xml, kind) {
  if (typeof xml !== "string" || !/<rss\b|<rdf:RDF\b/i.test(xml)) {
    throw new Error("RSS 2.0 형식이 아닌 응답을 받았습니다.");
  }

  const blocks = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi)].map(match => match[1]);
  return blocks.map(block => {
    const title = textOnly(getTag(block, "title"));
    const descriptionRaw = getFirstTag(block, ["description", "content:encoded"]);
    const description = textOnly(descriptionRaw);
    const link = safeHttpUrl(textOnly(getTag(block, "link")) || textOnly(getTag(block, "guid")));
    const sourceBlock = block.match(/<source\b([^>]*)>([\s\S]*?)<\/source\s*>/i);
    const source = sourceBlock ? textOnly(sourceBlock[2]) : "";
    const sourceUrl = sourceBlock ? safeHttpUrl(getAttribute(`<source ${sourceBlock[1]}>`, "url")) : "";
    const pubDate = textOnly(getTag(block, "pubDate"));
    const imageTag = block.match(/<(?:media:content|media:thumbnail|enclosure)\b[^>]*>/i);
    const imageFromHtml = descriptionRaw.match(/<img\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/i);
    const image = safeHttpUrl(imageTag
      ? getAttribute(imageTag[0], "url")
      : imageFromHtml ? decodeXml(imageFromHtml[2]) : "");
    const author = textOnly(getFirstTag(block, ["dc:creator", "author", "media:credit"])) || "";
    const license = textOnly(getTag(block, "media:license")) || "";

    return {
      title,
      description,
      url: link,
      source: source || (kind === "photos" ? "Flickr" : ""),
      sourceUrl,
      publishedAt: parseDate(pubDate),
      image,
      author,
      license
    };
  }).filter(item => item.title && item.url);
}

function parseDate(value = "") {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function normalizeText(value = "") {
  return textOnly(value).toLowerCase()
    .replace(/[“”‘’'"`]/g, "")
    .replace(/[^0-9a-z가-힣\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function queryTerms(query = "") {
  return [...new Set(normalizeText(query).split(/\s+/).filter(token => token.length >= 2))];
}

function scoreResult(query, item) {
  const terms = queryTerms(query);
  const title = normalizeText(item.title);
  const description = normalizeText(item.description);
  const titleHits = terms.filter(term => title.includes(term)).length;
  const bodyHits = terms.filter(term => description.includes(term)).length;
  const coverage = terms.length ? (titleHits + bodyHits) / terms.length : 0;
  return { ...item, relevance: titleHits * 5 + bodyHits * 2 + coverage * 4 };
}

function dedupe(items) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = normalizeText(item.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

async function fetchRss(url, kind, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: FEED_HEADERS,
      signal: controller.signal,
      redirect: "follow"
    });
    if (!response.ok) throw new Error(`RSS 제공처 응답 오류 (HTTP ${response.status})`);
    const xml = await response.text();
    if (xml.length > 8_000_000) throw new Error("RSS 피드가 너무 큽니다.");
    return parseRss(xml, kind);
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("RSS 응답 시간이 초과됐습니다.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function makeGoogleNewsFeed(query) {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", query);
  url.searchParams.set("hl", "ko");
  url.searchParams.set("gl", "KR");
  url.searchParams.set("ceid", "KR:ko");
  return url.toString();
}

function makeFlickrFeed(query) {
  const url = new URL("https://www.flickr.com/services/feeds/photos_public.gne");
  url.searchParams.set("tags", query.replace(/\s+/g, ","));
  url.searchParams.set("tagmode", "any");
  url.searchParams.set("format", "rss_200");
  url.searchParams.set("lang", "ko-kr");
  return url.toString();
}

const ACADEMIC_RULES = [
  { test: /인공지능|artificial intelligence|\bai\b/i, categories: ["cs.AI", "cs.LG", "stat.ML"], terms: ["artificial intelligence", "machine learning"] },
  { test: /머신러닝|기계학습|machine learning|딥러닝|deep learning/i, categories: ["cs.LG", "stat.ML", "cs.AI"], terms: ["machine learning", "deep learning"] },
  { test: /자연어|언어모델|번역|챗봇|자연어처리|natural language|language model/i, categories: ["cs.CL", "cs.AI"], terms: ["natural language", "language model"] },
  { test: /컴퓨터.?비전|이미지.?인식|영상.?인식|computer vision|image recognition/i, categories: ["cs.CV", "cs.AI"], terms: ["computer vision", "image recognition"] },
  { test: /로봇|robot/i, categories: ["cs.RO", "cs.AI"], terms: ["robotics", "robot"] },
  { test: /보안|암호|해킹|security|cryptography/i, categories: ["cs.CR", "cs.CY"], terms: ["security", "cryptography"] },
  { test: /경제|금융|주식|econom|finance/i, categories: ["econ", "q-fin"], terms: ["economics", "finance"] },
  { test: /생물|생명|의학|바이오|biology|medical/i, categories: ["q-bio"], terms: ["biology", "medical"] },
  { test: /물리|양자|physics|quantum/i, categories: ["physics", "quant-ph"], terms: ["physics", "quantum"] },
  { test: /수학|통계|math|statistics/i, categories: ["math", "stat"], terms: ["mathematics", "statistics"] },
  { test: /기후|환경|에너지|climate|environment|energy/i, categories: ["physics.ao-ph", "econ.GN"], terms: ["climate", "environment", "energy"] },
  { test: /교육|학습|학교|education|learning/i, categories: ["cs.HC", "cs.CY"], terms: ["education", "learning", "educational technology"] },
  { test: /소프트웨어|프로그래밍|코딩|software|programming/i, categories: ["cs.SE", "cs.PL"], terms: ["software", "programming"] }
];

function academicFeedPlan(query) {
  const matched = ACADEMIC_RULES.filter(rule => rule.test.test(query));
  const categories = matched.length
    ? [...new Set(matched.flatMap(rule => rule.categories))]
    : ["cs", "stat.ML"];
  const expandedTerms = matched.flatMap(rule => rule.terms);
  return {
    url: `https://rss.arxiv.org/rss/${categories.join("+")}`,
    categories,
    terms: [...new Set([...queryTerms(query), ...queryTerms(expandedTerms.join(" "))])]
  };
}

function academicMatches(query, item, terms) {
  const haystack = normalizeText(`${item.title} ${item.description}`);
  const originalTerms = queryTerms(query);
  const allTerms = [...new Set([...terms, ...originalTerms])];
  if (!allTerms.length) return true;
  return allTerms.some(term => haystack.includes(term));
}

function decorateItems(items, type, provider) {
  return items.map(item => ({
    ...item,
    type,
    category: type === "news" ? "뉴스" : type === "photos" ? "사진" : "학술자료",
    source: item.source || provider,
    provider
  }));
}

async function searchMaterials(query, type) {
  const q = String(query || "").trim().slice(0, 200);
  if (q.length < 2) return json({ error: "검색어를 2자 이상 입력해 주세요." }, 400);

  if (!["news", "photos", "academic"].includes(type)) {
    return json({ error: "검색 유형은 news, photos, academic 중 하나여야 합니다." }, 400);
  }

  let feedUrl = "";
  let provider = "";
  let raw = [];
  let results = [];

  try {
    if (type === "news") {
      provider = "Google News RSS";
      feedUrl = makeGoogleNewsFeed(q);
      raw = await fetchRss(feedUrl, "news");
      results = decorateItems(raw, "news", provider);
    } else if (type === "photos") {
      provider = "Flickr Public Photos RSS";
      feedUrl = makeFlickrFeed(q);
      raw = await fetchRss(feedUrl, "photos");
      const terms = queryTerms(q);
      results = decorateItems(raw.filter(item => {
        if (!item.image) return false;
        const haystack = normalizeText(`${item.title} ${item.description}`);
        return !terms.length || terms.some(term => haystack.includes(term));
      }), "photos", provider);
    } else {
      const plan = academicFeedPlan(q);
      provider = `arXiv RSS (${plan.categories.join(", ")})`;
      feedUrl = plan.url;
      raw = await fetchRss(feedUrl, "academic", 12000);
      results = decorateItems(raw.filter(item => academicMatches(q, item, plan.terms)), "academic", provider);
    }
  } catch (error) {
    return json({
      query: q,
      type,
      results: [],
      total: 0,
      provider,
      feedUrl,
      error: error instanceof Error ? error.message : "RSS 피드를 불러오지 못했습니다.",
      notice: "RSS 피드 연결에 실패했습니다. 다른 검색 방식으로 자동 전환하지 않았습니다."
    }, 502);
  }

  results = dedupe(results.map(item => scoreResult(q, item)))
    .sort((a, b) => b.relevance - a.relevance)
    .map(({ relevance, ...item }) => item);

  return json({
    query: q,
    type,
    results,
    total: results.length,
    provider,
    notice: results.length
      ? `${provider}에서 RSS 피드만 수집했습니다. 다른 API나 웹페이지 검색으로 대체하지 않았습니다.`
      : "해당 RSS 피드에서 검색어와 맞는 자료를 찾지 못했습니다. 다른 검색 방식으로 자동 전환하지 않았습니다.",
    searchMode: "rss-only",
    feedUrl
  }, 200, { "Cache-Control": "public, max-age=90, stale-while-revalidate=180" });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "study-hub-pro",
        version: "7.0.0-rss-only",
        searchMode: "rss-only",
        searchTypes: ["news", "photos", "academic"],
        rssOnly: true,
        feeds: {
          news: "Google News RSS",
          photos: "Flickr Public Photos RSS",
          academic: "arXiv RSS category feeds"
        }
      });
    }

    if (url.pathname === "/api/search") {
      if (request.method !== "GET") return json({ error: "GET 요청만 지원합니다." }, 405, { Allow: "GET" });
      try {
        return await searchMaterials(url.searchParams.get("q") || "", url.searchParams.get("type") || "news");
      } catch (error) {
        return json({ error: "RSS 검색 처리 중 서버 오류가 발생했습니다.", detail: error instanceof Error ? error.message : "unknown" }, 500);
      }
    }

    return env.ASSETS.fetch(request);
  }
};
