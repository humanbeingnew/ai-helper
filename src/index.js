const VERSION = "11.0.0-rss-quality-overhaul";
const MAX_QUERY_LENGTH = 200;
const MAX_FEED_BYTES = 5 * 1024 * 1024;
const RSS_CACHE_TTL_MS = 90 * 1000;
const RSS_CACHE_MAX_ITEMS = 60;

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff"
};

// Use a descriptive reader identity and request RSS/XML representations only.
// Do not impersonate Googlebot or another crawler.
const FEED_HEADERS = {
  "Accept": "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.7",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  "User-Agent": "STUDY-HUB-PRO-RSS/11.0"
};

const ALLOWED_FEED_HOSTS = {
  // Google News remains the primary news source. These publisher hosts are
  // consulted only when Google's RSS is unavailable or returns no matches.
  news: new Set([
    "news.google.com",
    "www.yna.co.kr", "yna.co.kr",
    "www.newsis.com", "nwww.newsis.com",
    "news.sbs.co.kr",
    "www.mbn.co.kr", "mbn.co.kr"
  ]),
  photos: new Set(["www.flickr.com", "flickr.com"]),
  academic: new Set(["rss.arxiv.org"])
};

const NEWS_BACKUP_FEEDS = [
  { name: "연합뉴스", url: "https://www.yna.co.kr/rss/news.xml" },
  { name: "뉴시스", url: "https://www.newsis.com/RSS/sokbo.xml" },
  { name: "SBS 뉴스", url: "https://news.sbs.co.kr/news/newsflashRssFeed.do?plink=RSSREADER" },
  { name: "MBN", url: "https://www.mbn.co.kr/rss/" }
];

const rssMemoryCache = new Map();
const rssInFlight = new Map();

// Best-effort per-isolate guard. This is not a replacement for a Cloudflare
// dashboard/WAF rate-limiting rule because Worker isolates are distributed.
const SEARCH_RATE_WINDOW_MS = 60_000;
const SEARCH_RATE_LIMIT = 30;
const SEARCH_RATE_MAX_KEYS = 3000;
const searchRateBuckets = new Map();

function consumeSearchRateLimit(request) {
  const clientIp = request.headers.get("CF-Connecting-IP") || "";
  // Local development may not have a Cloudflare client IP. Do not combine all
  // local users into one shared bucket in that case.
  if (!clientIp) return { allowed: true, limited: false };

  const now = Date.now();
  let bucket = searchRateBuckets.get(clientIp);
  if (!bucket || now - bucket.startedAt >= SEARCH_RATE_WINDOW_MS) {
    bucket = { startedAt: now, count: 0 };
    searchRateBuckets.set(clientIp, bucket);
  }
  bucket.count += 1;

  if (searchRateBuckets.size > SEARCH_RATE_MAX_KEYS) {
    for (const [key, value] of searchRateBuckets) {
      if (key !== clientIp && now - value.startedAt >= SEARCH_RATE_WINDOW_MS) searchRateBuckets.delete(key);
      if (searchRateBuckets.size <= SEARCH_RATE_MAX_KEYS) break;
    }
    if (searchRateBuckets.size > SEARCH_RATE_MAX_KEYS) {
      const oldestKey = [...searchRateBuckets.keys()].find(key => key !== clientIp);
      if (oldestKey) searchRateBuckets.delete(oldestKey);
    }
  }

  const remaining = Math.max(0, SEARCH_RATE_LIMIT - bucket.count);
  const resetSeconds = Math.max(1, Math.ceil((bucket.startedAt + SEARCH_RATE_WINDOW_MS - now) / 1000));
  return {
    allowed: bucket.count <= SEARCH_RATE_LIMIT,
    limited: true,
    remaining,
    resetSeconds,
    headers: {
      "X-RateLimit-Limit": String(SEARCH_RATE_LIMIT),
      "X-RateLimit-Remaining": String(remaining),
      "X-RateLimit-Reset": String(Math.ceil((bucket.startedAt + SEARCH_RATE_WINDOW_MS) / 1000))
    }
  };
}

function withStaticSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  const securityHeaders = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' https: data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
  };
  for (const [name, value] of Object.entries(securityHeaders)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

class RssFetchError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "RssFetchError";
    this.details = details;
  }
}

const json = (data, status = 200, extraHeaders = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { ...JSON_HEADERS, ...extraHeaders }
});

function safeDecodeCodePoint(value, radix = 10) {
  const number = parseInt(value, radix);
  if (!Number.isFinite(number) || number < 0 || number > 0x10ffff || (number >= 0xd800 && number <= 0xdfff)) return "�";
  try { return String.fromCodePoint(number); } catch { return "�"; }
}

function decodeXml(value = "") {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeDecodeCodePoint(hex, 16))
    .replace(/&#(\d+);/g, (_, num) => safeDecodeCodePoint(num, 10))
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
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ")
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
    if (!(["https:", "http:"].includes(url.protocol)) || url.username || url.password) return "";
    return url.toString();
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
    throw new RssFetchError("RSS 2.0 또는 RSS 1.0 응답이 아닙니다.", { failureKind: "invalid_rss" });
  }

  const blocks = [...xml.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi)]
    .map(match => match[1]);

  return blocks.map(block => {
    const title = textOnly(getTag(block, "title"));
    const descriptionRaw = getFirstTag(block, ["description", "content:encoded"]);
    const description = textOnly(descriptionRaw);
    const link = safeHttpUrl(textOnly(getTag(block, "link")) || textOnly(getTag(block, "guid")));
    const sourceBlock = block.match(/<source\b([^>]*)>([\s\S]*?)<\/source\s*>/i);
    const source = sourceBlock ? textOnly(sourceBlock[2]) : "";
    const sourceUrl = sourceBlock ? safeHttpUrl(getAttribute(`<source ${sourceBlock[1]}>`, "url")) : "";
    const pubDate = textOnly(getFirstTag(block, ["pubDate", "dc:date"]));
    const imageTag = block.match(/<(?:media:content|media:thumbnail|enclosure)\b[^>]*>/i);
    const imageFromHtml = descriptionRaw.match(/<img\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/i);
    const image = safeHttpUrl(imageTag
      ? getAttribute(imageTag[0], "url")
      : imageFromHtml ? decodeXml(imageFromHtml[2]) : "");
    const author = textOnly(getFirstTag(block, ["dc:creator", "author", "media:credit"]));
    const license = textOnly(getFirstTag(block, ["media:license", "dc:rights"]));

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

const SEARCH_STOP_WORDS = new Set([
  "그리고", "그러나", "하지만", "또한", "대한", "대해", "관련", "통해", "위해",
  "있는", "있다", "없는", "없다", "하는", "한다", "된다", "되는", "미치는",
  "어떤", "무엇", "어떻게", "에서", "으로", "이다", "라고", "라는", "것은"
]);

function stripKoreanParticles(token) {
  const particles = ["으로부터", "에게서", "한테서", "에서", "으로", "에게", "한테", "까지", "부터", "처럼", "보다", "은", "는", "이", "가", "을", "를", "의", "에", "로", "와", "과", "도", "만"];
  for (const particle of particles) {
    if (token.endsWith(particle) && token.length - particle.length >= 2) {
      return token.slice(0, -particle.length);
    }
  }
  return token;
}

function queryTerms(query = "") {
  return [...new Set(normalizeText(query)
    .split(/\s+/)
    .map(stripKoreanParticles)
    .filter(token => token.length >= 2 && !SEARCH_STOP_WORDS.has(token)))];
}

function queryMatch(query, item) {
  const terms = queryTerms(query);
  const title = normalizeText(item.title);
  const description = normalizeText(item.description);
  const combined = `${title} ${description}`;
  const titleHits = terms.filter(term => title.includes(term)).length;
  const bodyHits = terms.filter(term => description.includes(term)).length;
  const totalHits = terms.filter(term => combined.includes(term)).length;
  const requiredHits = terms.length <= 1 ? 1 : terms.length === 2 ? 2 : Math.max(2, Math.ceil(terms.length / 2));
  const phrase = normalizeText(query);
  const exactPhrase = phrase.length >= 3 && combined.includes(phrase);
  return {
    matches: !terms.length || exactPhrase || totalHits >= requiredHits,
    titleHits,
    bodyHits,
    totalHits,
    coverage: terms.length ? totalHits / terms.length : 1,
    exactPhrase
  };
}

function scoreResult(query, item) {
  const match = queryMatch(query, item);
  return {
    ...item,
    relevance: match.titleHits * 8 + match.bodyHits * 3 + match.coverage * 5 + (match.exactPhrase ? 10 : 0)
  };
}

function dedupe(items) {
  const seenUrls = new Set();
  const seenTitles = new Set();
  const output = [];
  for (const item of items) {
    const normalizedUrl = normalizeUrl(item.url);
    const normalizedTitle = normalizeText(item.title);
    if (!normalizedUrl || !normalizedTitle || seenUrls.has(normalizedUrl) || seenTitles.has(normalizedTitle)) continue;
    seenUrls.add(normalizedUrl);
    seenTitles.add(normalizedTitle);
    output.push(item);
  }
  return output;
}

function normalizeUrl(value = "") {
  try {
    const url = new URL(value);
    url.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach(key => url.searchParams.delete(key));
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function trimErrorBody(value = "") {
  return textOnly(value).slice(0, 240);
}

function parseRetryAfter(value = "") {
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    return Math.min(Math.max(Math.ceil(Number(raw)), 0), 3600);
  }
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) return null;
  return Math.min(Math.max(Math.ceil((timestamp - Date.now()) / 1000), 0), 3600);
}

function looksLikeGoogleAccessRestriction(status, contentType, body, kind) {
  if (kind !== "news" || status !== 503) return false;
  const normalized = String(body || "").toLowerCase();
  const isHtml = /text\/html|application\/xhtml/i.test(contentType) || /<html\b|<!doctype html/i.test(normalized);
  const restrictionText = /automated quer(?:y|ies)|unusual traffic|computer or network may be sending|can't process your request right now|cannot process your request right now|traffic from your computer network|not a robot|automated requests/i.test(normalized);
  return isHtml && restrictionText;
}

async function readLimitedText(response, maxBytes = MAX_FEED_BYTES) {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > maxBytes) {
    try { await response.body?.cancel(); } catch { /* best-effort cancellation */ }
    throw new RssFetchError("RSS 피드가 허용 크기(5MB)를 초과했습니다.", { failureKind: "feed_too_large" });
  }

  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let totalBytes = 0;
  let output = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new RssFetchError("RSS 피드가 허용 크기(5MB)를 초과했습니다.", { failureKind: "feed_too_large" });
      }
      output += decoder.decode(value, { stream: true });
    }
    output += decoder.decode();
    return output;
  } catch (error) {
    try { await reader.cancel(); } catch { /* best-effort cancellation */ }
    throw error;
  }
}

function allowedFinalUrl(urlString, kind) {
  try {
    const url = new URL(urlString);
    return url.protocol === "https:" && !url.username && !url.password &&
      (!url.port || url.port === "443") && ALLOWED_FEED_HOSTS[kind]?.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

async function fetchApprovedFeedUrl(url, kind, signal) {
  let currentUrl = url;
  const maxRedirects = 2;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const response = await fetch(currentUrl, {
      method: "GET",
      headers: FEED_HEADERS,
      signal,
      redirect: "manual"
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location") || "";
      let nextUrl = "";
      try { nextUrl = new URL(location, currentUrl).toString(); } catch { /* invalid redirect target */ }
      if (!location || !allowedFinalUrl(nextUrl, kind) || hop >= maxRedirects) {
        try { await response.body?.cancel(); } catch { /* best effort */ }
        throw new RssFetchError("RSS 제공처가 허용되지 않은 주소로 리디렉션했습니다.", { failureKind: "unexpected_redirect" });
      }
      try { await response.body?.cancel(); } catch { /* best effort */ }
      currentUrl = nextUrl;
      continue;
    }

    if (!allowedFinalUrl(response.url || currentUrl, kind)) {
      try { await response.body?.cancel(); } catch { /* best effort */ }
      throw new RssFetchError("RSS 제공처가 허용되지 않은 주소로 이동했습니다.", { failureKind: "unexpected_redirect" });
    }
    return response;
  }

  throw new RssFetchError("RSS 리디렉션 횟수가 허용 범위를 초과했습니다.", { failureKind: "unexpected_redirect" });
}

async function fetchRssUncached(url, kind, timeoutMs) {
  const maxAttempts = 2;
  let lastFailure = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchApprovedFeedUrl(url, kind, controller.signal);

      if (!response.ok) {
        const status = response.status;
        const upstreamContentType = (response.headers.get("content-type") || "").toLowerCase();
        const declaredBytes = Number(response.headers.get("content-length") || 0) || null;
        const body = await readLimitedText(response, 64 * 1024).catch(() => "");
        const upstreamMessage = trimErrorBody(body);
        const accessRestrictionSuspected = looksLikeGoogleAccessRestriction(status, upstreamContentType, body, kind);
        const statusCanRetry = [408, 425, 429, 500, 502, 503, 504].includes(status);
        const retryAfterSeconds = parseRetryAfter(response.headers.get("retry-after") || "");
        const retryable = statusCanRetry && !accessRestrictionSuspected;
        const canRetryNow = retryable && attempt < maxAttempts && (retryAfterSeconds === null || retryAfterSeconds <= 2);

        lastFailure = new RssFetchError(
          accessRestrictionSuspected
            ? "Google News RSS가 자동 요청 또는 접근 제한 안내를 반환했습니다."
            : `RSS 제공처 응답 오류 (HTTP ${status})`,
          {
            failureKind: accessRestrictionSuspected ? "upstream_access_restricted" : "upstream_http_error",
            upstreamStatus: status,
            retryable,
            retryAfterSeconds,
            upstreamContentType,
            upstreamDeclaredBytes: declaredBytes,
            upstreamMessage,
            accessRestrictionSuspected
          }
        );

        if (canRetryNow) {
          const waitMs = retryAfterSeconds === null ? 800 : Math.max(250, retryAfterSeconds * 1000);
          await sleep(Math.min(waitMs, 2000));
          continue;
        }
        throw lastFailure;
      }

      const contentType = (response.headers.get("content-type") || "").toLowerCase();
      if (contentType && !/(rss|xml|text\/xml|application\/octet-stream)/i.test(contentType)) {
        const body = await readLimitedText(response, 64 * 1024).catch(() => "");
        throw new RssFetchError("RSS가 아닌 응답 형식이 도착했습니다.", {
          failureKind: "unexpected_content_type",
          contentType,
          upstreamMessage: trimErrorBody(body)
        });
      }

      const xml = await readLimitedText(response);
      return parseRss(xml, kind);
    } catch (error) {
      if (error instanceof RssFetchError) {
        if (error.details?.retryable && attempt < maxAttempts && error !== lastFailure) {
          await sleep(800);
          lastFailure = error;
          continue;
        }
        throw error;
      }
      if (error?.name === "AbortError") {
        lastFailure = new RssFetchError("RSS 제공처 응답 시간이 초과됐습니다.", {
          failureKind: "upstream_timeout",
          retryable: attempt < maxAttempts
        });
        if (attempt < maxAttempts) {
          await sleep(400);
          continue;
        }
        throw lastFailure;
      }
      lastFailure = new RssFetchError("RSS 제공처에 연결하지 못했습니다.", {
        failureKind: "upstream_network_error",
        upstreamMessage: String(error?.message || error).slice(0, 240),
        retryable: attempt < maxAttempts
      });
      if (attempt < maxAttempts) {
        await sleep(400);
        continue;
      }
      throw lastFailure;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastFailure || new RssFetchError("RSS 피드를 불러오지 못했습니다.", { failureKind: "unknown" });
}

async function fetchRss(url, kind, timeoutMs = 11000) {
  const now = Date.now();
  const cached = rssMemoryCache.get(url);
  if (cached && cached.expiresAt > now) return cached.items.map(item => ({ ...item }));
  if (cached) rssMemoryCache.delete(url);

  if (rssInFlight.has(url)) {
    const shared = await rssInFlight.get(url);
    return shared.map(item => ({ ...item }));
  }

  const task = fetchRssUncached(url, kind, timeoutMs);
  rssInFlight.set(url, task);
  try {
    const items = await task;
    rssMemoryCache.set(url, { items: items.map(item => ({ ...item })), expiresAt: Date.now() + RSS_CACHE_TTL_MS });
    if (rssMemoryCache.size > RSS_CACHE_MAX_ITEMS) {
      const oldestKey = rssMemoryCache.keys().next().value;
      if (oldestKey) rssMemoryCache.delete(oldestKey);
    }
    return items;
  } finally {
    rssInFlight.delete(url);
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

async function fetchBackupNewsRss(query) {
  const settled = await Promise.allSettled(NEWS_BACKUP_FEEDS.map(async feed => {
    const items = await fetchRss(feed.url, "news", 11000);
    return items.map(item => ({
      ...item,
      source: item.source || feed.name,
      provider: feed.name,
      backupSource: true
    }));
  }));

  const collected = [];
  const failures = [];
  let successfulFeeds = 0;
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      successfulFeeds += 1;
      collected.push(...result.value);
    } else {
      const error = result.reason;
      failures.push({
        provider: NEWS_BACKUP_FEEDS[index].name,
        failureKind: error?.details?.failureKind || "unknown",
        upstreamStatus: error?.details?.upstreamStatus || null,
        message: String(error?.message || error).slice(0, 160)
      });
    }
  });

  const matches = collected
    .map(item => ({ item, match: queryMatch(query, item) }))
    .filter(entry => entry.match.matches)
    .sort((a, b) => {
      const score = value => value.match.titleHits * 8 + value.match.bodyHits * 3 + value.match.coverage * 5 + (value.match.exactPhrase ? 10 : 0);
      return score(b) - score(a);
    })
    .map(entry => entry.item);

  return {
    items: matches,
    totalCollected: collected.length,
    successfulFeeds,
    failedFeeds: failures,
    feedsUsed: settled.flatMap((result, index) => result.status === "fulfilled" ? [NEWS_BACKUP_FEEDS[index].name] : [])
  };
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
  { test: /경제|금융|주식|econom|finance/i, categories: ["econ.GN", "q-fin.EC", "q-fin.ST"], terms: ["economics", "finance"] },
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
  const q = String(query || "").trim();
  if (q.length < 2) return json({ error: "검색어를 2자 이상 입력해 주세요." }, 400);
  if (q.length > MAX_QUERY_LENGTH) return json({ error: `검색어는 ${MAX_QUERY_LENGTH}자 이내로 입력해 주세요.` }, 400);
  if (!["news", "photos", "academic"].includes(type)) {
    return json({ error: "검색 유형은 news, photos, academic 중 하나여야 합니다." }, 400);
  }

  let feedUrl = "";
  let provider = "";
  let results = [];
  let newsFallbackUsed = false;
  let newsFallbackReason = "";
  let newsFallbackFeedsUsed = [];
  let newsPrimaryError = null;

  try {
    if (type === "news") {
      provider = "Google News RSS";
      feedUrl = makeGoogleNewsFeed(q);
      try {
        const primaryItems = await fetchRss(feedUrl, "news");
        // Google News already applies the user's search query upstream.
        // Do not re-filter its own results using the short RSS summary.
        if (primaryItems.length) {
          results = decorateItems(primaryItems, "news", "Google News RSS");
        } else {
          newsFallbackReason = "Google News RSS 피드가 비어 있어 보완 RSS를 조회했습니다.";
        }
      } catch (error) {
        newsPrimaryError = error;
        newsFallbackReason = error instanceof Error ? error.message : "Google News RSS 연결 실패";
      }

      if (!results.length) {
        const backup = await fetchBackupNewsRss(q);
        newsFallbackUsed = true;
        newsFallbackFeedsUsed = backup.feedsUsed;

        if (backup.items.length) {
          provider = "Google News 우선 · 국내 언론사 RSS 보완";
          results = decorateItems(backup.items, "news", "국내 언론사 RSS");
        } else if (backup.successfulFeeds > 0) {
          provider = "국내 언론사 RSS 보완";
          results = [];
        } else {
          const primaryDetails = newsPrimaryError instanceof RssFetchError ? newsPrimaryError.details : {};
          throw new RssFetchError(
            "Google News RSS와 국내 언론사 보완 RSS에 모두 연결하지 못했습니다.",
            {
              failureKind: "news_all_feeds_failed",
              upstreamStatus: primaryDetails.upstreamStatus || null,
              primaryFailureKind: primaryDetails.failureKind || "no_matching_items",
              primaryMessage: String(newsPrimaryError?.message || newsFallbackReason).slice(0, 200),
              backupFailures: backup.failedFeeds,
              retryable: Boolean(primaryDetails.retryable)
            }
          );
        }
      }
    } else if (type === "photos") {
      provider = "Flickr Public Photos RSS";
      feedUrl = makeFlickrFeed(q);
      const terms = queryTerms(q);
      const raw = await fetchRss(feedUrl, "photos");
      results = decorateItems(raw.filter(item => {
        if (!item.image) return false;
        const haystack = normalizeText(`${item.title} ${item.description}`);
        return !terms.length || terms.some(term => haystack.includes(term));
      }), "photos", provider);
    } else {
      const plan = academicFeedPlan(q);
      provider = `arXiv RSS (${plan.categories.join(", ")})`;
      feedUrl = plan.url;
      const raw = await fetchRss(feedUrl, "academic", 15000);
      results = decorateItems(raw.filter(item => academicMatches(q, item, plan.terms)), "academic", provider);
    }
  } catch (error) {
    const details = error instanceof RssFetchError ? error.details : {};
    const upstreamStatus = Number(details.upstreamStatus || 0) || null;
    const errorMessage = error instanceof Error ? error.message : "RSS 피드를 불러오지 못했습니다.";
    return json({
      query: q,
      type,
      results: [],
      total: 0,
      provider,
      feedUrl,
      error: errorMessage,
      failureKind: details.failureKind || "unknown",
      upstreamStatus,
      retryable: Boolean(details.retryable),
      retryAfterSeconds: details.retryAfterSeconds ?? null,
      upstreamMessage: details.upstreamMessage || "",
      contentType: details.upstreamContentType || details.contentType || "",
      upstreamDeclaredBytes: details.upstreamDeclaredBytes || null,
      accessRestrictionSuspected: Boolean(details.accessRestrictionSuspected),
      primaryFailureKind: details.primaryFailureKind || "",
      primaryMessage: details.primaryMessage || "",
      backupFailures: details.backupFailures || [],
      notice: "RSS 연결에 실패했습니다. JSON API나 웹페이지 검색으로 전환하지 않았습니다."
    }, 502);
  }

  results = dedupe(results.map(item => scoreResult(q, item)))
    .sort((a, b) => b.relevance - a.relevance)
    .map(({ relevance, ...item }) => item);

  const notice = type === "news" && newsFallbackUsed
    ? results.length
      ? `Google News RSS를 우선 요청했으나 ${newsFallbackReason} 국내 언론사 공개 RSS에서 검색어 일치 기사 ${results.length}개를 찾았습니다. 모든 자료는 RSS에서만 수집했습니다.`
      : `Google News RSS를 우선 요청했으나 ${newsFallbackReason} 보완 RSS ${newsFallbackFeedsUsed.length}개는 연결됐지만 최근 피드에서 일치하는 기사를 찾지 못했습니다.`
    : results.length
      ? `${provider}에서 RSS 피드만 수집했습니다. 다른 API나 웹페이지 검색으로 대체하지 않았습니다.`
      : "해당 RSS 피드에서 검색어와 맞는 자료를 찾지 못했습니다. 다른 검색 방식으로 자동 전환하지 않았습니다.";

  return json({
    query: q,
    type,
    results,
    total: results.length,
    provider,
    notice,
    searchMode: "rss-only",
    feedUrl,
    newsFallbackUsed,
    newsFallbackReason,
    newsFallbackFeedsUsed
  }, 200, { "Cache-Control": "private, max-age=30, stale-while-revalidate=60" });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      if (request.method !== "GET") return json({ error: "GET 요청만 지원합니다." }, 405, { Allow: "GET" });
      return json({
        ok: true,
        service: "study-hub-pro",
        version: VERSION,
        searchMode: "rss-only",
        searchTypes: ["news", "photos", "academic"],
        searchRateLimit: { requests: SEARCH_RATE_LIMIT, windowSeconds: 60, scope: "best-effort per Worker isolate" },
        rssOnly: true,
        feeds: {
          news: {
            primary: "Google News RSS",
            backup: NEWS_BACKUP_FEEDS.map(feed => ({ name: feed.name, url: feed.url })),
            policy: "Google first; publisher RSS only when Google fails or has no matching items"
          },
          photos: "Flickr Public Photos RSS",
          academic: "arXiv RSS category feeds"
        },
        notes: [
          "RSS 2.0/RSS 1.0 feeds only",
          "No JSON search APIs or HTML scraping",
          "Google News is the primary news RSS source; official publisher RSS feeds are a transparent fallback",
          "Successful feed responses are cached briefly per Worker isolate",
          "Search requests have a best-effort per-isolate limit; configure a Cloudflare dashboard rate-limit rule for stronger edge-wide protection"
        ]
      });
    }

    if (url.pathname === "/api/search") {
      if (request.method !== "GET") return json({ error: "GET 요청만 지원합니다." }, 405, { Allow: "GET" });
      const query = url.searchParams.get("q") || "";
      const type = url.searchParams.get("type") || "news";
      // Reject malformed requests before they consume the search allowance.
      if (query.trim().length < 2 || query.length > MAX_QUERY_LENGTH || !["news", "photos", "academic"].includes(type)) {
        return searchMaterials(query, type);
      }
      const limit = consumeSearchRateLimit(request);
      if (!limit.allowed) {
        return json({
          error: "검색 요청이 잠시 많습니다. 1분 뒤 다시 시도해 주세요.",
          failureKind: "rate_limited",
          retryAfterSeconds: limit.resetSeconds
        }, 429, {
          ...limit.headers,
          "Retry-After": String(limit.resetSeconds)
        });
      }
      const response = await searchMaterials(query, type);
      if (!limit.limited) return response;
      const headers = new Headers(response.headers);
      for (const [name, value] of Object.entries(limit.headers)) headers.set(name, value);
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }

    if (url.pathname.startsWith("/api/")) return json({ error: "API 경로를 찾을 수 없습니다." }, 404);
    if (!env?.ASSETS || typeof env.ASSETS.fetch !== "function") {
      return json({ error: "정적 파일 바인딩(ASSETS)이 설정되지 않았습니다." }, 503);
    }
    const assetResponse = await env.ASSETS.fetch(request);
    return withStaticSecurityHeaders(assetResponse);
  }
};
