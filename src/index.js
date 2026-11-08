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
  "User-Agent": "STUDY-HUB-PRO/2.1"
};

async function fetchJson(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: REQUEST_HEADERS,
      signal: controller.signal,
      redirect: "follow"
    });

    const body = await response.text();

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}${body ? `: ${body.slice(0, 180)}` : ""}`);
    }

    try {
      return JSON.parse(body);
    } catch {
      throw new Error("JSON이 아닌 응답을 받았습니다.");
    }
  } catch (error) {
    if (error?.name === "AbortError" || String(error?.message).includes("timeout")) {
      throw new Error("응답 시간 초과");
    }
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    clearTimeout(timer);
  }
}

async function searchMaterials(query) {
  const q = query.trim().slice(0, 160);
  if (q.length < 2) {
    return json({ error: "검색어를 2자 이상 입력해 주세요." }, 400);
  }

  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setFullYear(cutoff.getFullYear() - 3);
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  // OpenAlex는 최신 3년 자료와 관련도 높은 자료를 각각 가져와 합칩니다.
  // 최신순만 강제하면 검색어와 무관한 오래된 주제가 섞이기 쉬워서, "최신 + 관련도"를 함께 사용합니다.
  const openAlexRecentUrl =
    `https://api.openalex.org/works?search=${encodeURIComponent(q)}` +
    `&filter=from_publication_date:${cutoffDate}&per-page=10&sort=publication_date:desc`;
  const openAlexRelevantUrl =
    `https://api.openalex.org/works?search=${encodeURIComponent(q)}` +
    `&per-page=10`;

  const wikiUrl =
    `https://ko.wikipedia.org/w/api.php?action=query&list=search` +
    `&srsearch=${encodeURIComponent(q)}&srlimit=6&srnamespace=0` +
    `&srsort=create_timestamp_desc&srprop=timestamp|snippet&format=json`;

  const newsUrl =
    `https://news.google.com/rss/search?q=${encodeURIComponent(q)}` +
    `&hl=ko&gl=KR&ceid=KR:ko`;

  const [openAlexRecent, openAlexRelevant, wikipedia, news] = await Promise.allSettled([
    fetchJson(openAlexRecentUrl),
    fetchJson(openAlexRelevantUrl),
    fetchJson(wikiUrl),
    fetchText(newsUrl)
  ]);

  const results = [];
  const providers = [];
  const errors = {};

  let openAlexWorks = [];
  const seenWorks = new Set();
  const addWork = work => {
    const id = work.id || work.doi || work.display_name;
    if (!id || seenWorks.has(id)) return;
    seenWorks.add(id);
    openAlexWorks.push(work);
  };

  if (openAlexRecent.status === "fulfilled" || openAlexRelevant.status === "fulfilled") {
    providers.push("OpenAlex");
    if (openAlexRecent.status === "fulfilled") {
      for (const work of (openAlexRecent.value.results || [])) addWork(work);
    }
    if (openAlexRelevant.status === "fulfilled") {
      for (const work of (openAlexRelevant.value.results || [])) addWork(work);
    }

    // 최신 자료를 우선하되, 검색어와 관련도 높은 결과가 너무 뒤로 밀리지 않도록
    // 최근 3년 → 최신 날짜 순으로 정렬합니다. 오래된 자료는 후순위 참고자료로 둡니다.
    openAlexWorks.sort((a, b) => {
      const ad = Date.parse(a.publication_date || "") || 0;
      const bd = Date.parse(b.publication_date || "") || 0;
      const aRecent = ad >= cutoff.getTime() ? 0 : 1;
      const bRecent = bd >= cutoff.getTime() ? 0 : 1;
      if (aRecent !== bRecent) return aRecent - bRecent;
      return bd - ad;
    });

    for (const work of openAlexWorks.slice(0, 10)) {
      const title = clean(work.display_name);
      if (!title) continue;
      const authors = (work.authorships || [])
        .slice(0, 3)
        .map(item => item.author?.display_name)
        .filter(Boolean)
        .join(", ");
      results.push({
        source: "OPENALEX · 최신 학술 자료",
        type: "academic",
        title,
        year: work.publication_year || "",
        publishedAt: work.publication_date || "",
        description: authors
          ? `저자: ${authors}${work.doi ? " · DOI 자료" : ""}`
          : "공개 학술 메타데이터",
        url: work.primary_location?.landing_page_url || work.doi || work.id,
        image: ""
      });
    }
  } else {
    errors.OpenAlex = openAlexRecent.reason?.message || openAlexRelevant.reason?.message || "연결 실패";
  }

  let wikiPages = [];
  if (wikipedia.status === "fulfilled") {
    providers.push("Wikipedia");
    wikiPages = wikipedia.value.query?.search || [];
    for (const page of wikiPages) {
      results.push({
        source: "WIKIPEDIA · 배경 자료",
        type: "reference",
        title: clean(page.title),
        year: "",
        publishedAt: page.timestamp || "",
        description: clean(page.snippet || ""),
        url: `https://ko.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`,
        image: ""
      });
    }
  } else {
    errors.Wikipedia = wikipedia.reason?.message || "연결 실패";
  }

  let newsItems = [];
  if (news.status === "fulfilled") {
    providers.push("Google News");
    newsItems = parseRssItems(news.value).slice(0, 8);
    for (const item of newsItems) {
      results.push({
        source: "NEWS · 최신 웹 자료",
        type: "news",
        title: item.title,
        year: item.publishedAt ? new Date(item.publishedAt).getFullYear() : "",
        publishedAt: item.publishedAt || "",
        description: item.description || item.source || "최신 뉴스 검색 결과",
        url: item.url,
        image: item.image || ""
      });
    }
  } else {
    errors.News = news.reason?.message || "연결 실패";
  }

  // 이미지 조회는 서로 독립적이므로 병렬 처리합니다.
  const openAlexImageTask = openAlexWorks.length
    ? (async () => {
        const titles = openAlexWorks.map(work => clean(work.display_name)).filter(Boolean).slice(0, 10);
        const imageUrl =
          `https://ko.wikipedia.org/w/api.php?action=query&format=json&redirects=1` +
          `&prop=pageimages&piprop=thumbnail&pithumbsize=520&pilicense=free` +
          `&titles=${encodeURIComponent(titles.join("|"))}`;
        const imageData = await fetchJson(imageUrl, 7000);
        const pages = Object.values(imageData.query?.pages || {});
        return new Map(pages.filter(page => page.title && page.thumbnail?.source)
          .map(page => [normalizeTitle(page.title), page.thumbnail.source]));
      })()
    : Promise.resolve(new Map());

  const wikiImageTask = wikiPages.length
    ? (async () => {
        const titles = wikiPages.map(page => page.title).filter(Boolean).slice(0, 6);
        const imageUrl =
          `https://ko.wikipedia.org/w/api.php?action=query&format=json&redirects=1` +
          `&prop=pageimages&piprop=thumbnail&pithumbsize=520&pilicense=free` +
          `&titles=${encodeURIComponent(titles.join("|"))}`;
        const imageData = await fetchJson(imageUrl, 7000);
        const pages = Object.values(imageData.query?.pages || {});
        return new Map(pages.filter(page => page.title && page.thumbnail?.source)
          .map(page => [normalizeTitle(page.title), page.thumbnail.source]));
      })()
    : Promise.resolve(new Map());

  const [openAlexImages, wikiImages] = await Promise.allSettled([openAlexImageTask, wikiImageTask]);
  if (openAlexImages.status === "fulfilled") {
    for (const result of results) {
      if (result.type === "academic") result.image = openAlexImages.value.get(normalizeTitle(result.title)) || "";
    }
  }
  if (wikiImages.status === "fulfilled") {
    for (const result of results) {
      if (result.type === "reference") result.image = wikiImages.value.get(normalizeTitle(result.title)) || "";
    }
  }

  if (!providers.length) {
    return json({
      error: "외부 자료 제공처에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
      providers,
      details: errors
    }, 502);
  }

  // 최신성 우선: 뉴스/학술은 최근 날짜가 위로, Wikipedia는 최신성의 의미가 달라 후순위 배경자료로 둡니다.
  const typeRank = { news: 0, academic: 1, reference: 2 };
  results.sort((a, b) => {
    const ta = typeRank[a.type] ?? 9;
    const tb = typeRank[b.type] ?? 9;
    if (ta !== tb) return ta - tb;
    const ad = Date.parse(a.publishedAt || "") || 0;
    const bd = Date.parse(b.publishedAt || "") || 0;
    return bd - ad;
  });

  const freshCutoff = new Date(now);
  freshCutoff.setFullYear(freshCutoff.getFullYear() - 3);
  const freshCount = results.filter(r => Date.parse(r.publishedAt || "") >= freshCutoff.getTime()).length;

  return json({
    query: q,
    providers,
    results: results.slice(0, 15),
    notice: freshCount
      ? `최근 3년 자료 ${freshCount}개를 우선하고, 최신 뉴스·학술자료를 앞쪽에 배치했습니다.`
      : "최근 자료가 부족해 관련 배경 자료를 함께 표시했습니다.",
    ...(Object.keys(errors).length ? { providerWarnings: errors } : {})
  }, 200, { "Cache-Control": "public, max-age=60" });
}

async function fetchText(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    const response = await fetch(url, { headers: { "Accept": "application/rss+xml, application/xml, text/xml, */*", "User-Agent": REQUEST_HEADERS["User-Agent"] }, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } catch (error) {
    if (error?.name === "AbortError" || String(error?.message).includes("timeout")) throw new Error("응답 시간 초과");
    throw error instanceof Error ? error : new Error(String(error));
  } finally { clearTimeout(timer); }
}

function decodeXml(value = "") {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
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
    const source = rssTag(block, "source");
    return {
      title: clean(rssTag(block, "title")),
      description: clean(rssTag(block, "description")),
      url: rssTag(block, "link"),
      publishedAt: rssTag(block, "pubDate"),
      source,
      image: enclosure?.[1] || media?.[1] || thumbnail?.[1] || ""
    };
  }).filter(x => x.title && x.url);
}

function normalizeTitle(value = "") {
  return clean(value)
    .toLowerCase()
    .replace(/[“”‘’'"`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "study-hub-pro",
        worker: "online",
        time: new Date().toISOString()
      });
    }

    if (url.pathname === "/api/search") {
      if (request.method !== "GET") {
        return json(
          { error: "GET 요청만 지원합니다." },
          405,
          { "Allow": "GET" }
        );
      }

      try {
        return await searchMaterials(url.searchParams.get("q") || "");
      } catch (error) {
        return json({
          error: "검색 처리 중 서버 오류가 발생했어요.",
          detail: error instanceof Error ? error.message : "알 수 없는 오류"
        }, 500);
      }
    }

    // /api 외의 경로는 Worker에 연결된 정적 파일(public/)에서 제공
    return env.ASSETS.fetch(request);
  }
};
