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

  // 최신 학술자료를 우선: publication_date 내림차순으로 정렬합니다.
  const openAlexUrl =
    `https://api.openalex.org/works?search=${encodeURIComponent(q)}` +
    `&per-page=10&sort=publication_date:desc`;

  // Wikipedia는 최신 생성 문서를 우선하고, 검색 결과 자체의 썸네일을 함께 요청합니다.
  const wikiUrl =
    `https://ko.wikipedia.org/w/api.php?action=query&list=search` +
    `&srsearch=${encodeURIComponent(q)}&srlimit=6&srnamespace=0` +
    `&srsort=create_timestamp_desc&srprop=timestamp|snippet&format=json`;

  const [openAlex, wikipedia] = await Promise.allSettled([
    fetchJson(openAlexUrl),
    fetchJson(wikiUrl)
  ]);

  const results = [];
  const providers = [];
  const errors = {};

  let openAlexWorks = [];
  if (openAlex.status === "fulfilled") {
    providers.push("OpenAlex");
    openAlexWorks = openAlex.value.results || [];
    for (const work of openAlexWorks) {
      const title = clean(work.display_name);
      if (!title) continue;

      const authors = (work.authorships || [])
        .slice(0, 3)
        .map(item => item.author?.display_name)
        .filter(Boolean)
        .join(", ");

      results.push({
        source: "OPENALEX · 최신 학술 자료",
        title,
        year: work.publication_year || "",
        publishedAt: work.publication_date || "",
        description: authors
          ? `저자: ${authors}${work.doi ? " · DOI 자료" : ""}`
          : "공개 학술 메타데이터",
        url:
          work.primary_location?.landing_page_url ||
          (work.doi ? work.doi : "") ||
          work.id,
        image: ""
      });
    }
  } else {
    errors.OpenAlex = openAlex.reason?.message || "연결 실패";
  }

  let wikiPages = [];
  if (wikipedia.status === "fulfilled") {
    providers.push("Wikipedia");
    wikiPages = wikipedia.value.query?.search || [];
    for (const page of wikiPages) {
      results.push({
        source: "WIKIPEDIA · 최근 문서",
        title: clean(page.title),
        year: page.timestamp ? new Date(page.timestamp).getFullYear() : "",
        publishedAt: page.timestamp || "",
        description: clean(page.snippet || ""),
        url: `https://ko.wikipedia.org/wiki/${encodeURIComponent(
          page.title.replace(/ /g, "_")
        )}`,
        image: ""
      });
    }
  } else {
    errors.Wikipedia = wikipedia.reason?.message || "연결 실패";
  }

  // 이미지 조회는 서로 독립적이므로 병렬 처리해 검색 지연을 줄입니다.
  const openAlexImageTask = openAlexWorks.length
    ? (async () => {
        const titles = openAlexWorks
          .map(work => clean(work.display_name))
          .filter(Boolean)
          .slice(0, 10);
        const imageUrl =
          `https://ko.wikipedia.org/w/api.php?action=query&format=json&redirects=1` +
          `&prop=pageimages&piprop=thumbnail&pithumbsize=520&pilicense=free` +
          `&titles=${encodeURIComponent(titles.join("|"))}`;
        const imageData = await fetchJson(imageUrl, 7000);
        const pages = Object.values(imageData.query?.pages || {});
        return new Map(
          pages
            .filter(page => page.title && page.thumbnail?.source)
            .map(page => [normalizeTitle(page.title), page.thumbnail.source])
        );
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
        return new Map(
          pages
            .filter(page => page.title && page.thumbnail?.source)
            .map(page => [normalizeTitle(page.title), page.thumbnail.source])
        );
      })()
    : Promise.resolve(new Map());

  const [openAlexImages, wikiImages] = await Promise.allSettled([
    openAlexImageTask,
    wikiImageTask
  ]);

  if (openAlexImages.status === "fulfilled") {
    for (const result of results) {
      if (result.source.startsWith("OPENALEX")) {
        result.image = openAlexImages.value.get(normalizeTitle(result.title)) || "";
      }
    }
  }

  if (wikiImages.status === "fulfilled") {
    for (const result of results) {
      if (result.source.startsWith("WIKIPEDIA")) {
        result.image = wikiImages.value.get(normalizeTitle(result.title)) || "";
      }
    }
  }

  if (!providers.length) {
    return json({
      error: "외부 자료 제공처에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
      providers,
      details: errors
    }, 502);
  }

  // 최신 학술자료를 먼저 보여주고, 그 다음 최근 Wikipedia 문서를 보여줍니다.
  results.sort((a, b) => {
    const academicA = a.source.startsWith("OPENALEX") ? 0 : 1;
    const academicB = b.source.startsWith("OPENALEX") ? 0 : 1;
    if (academicA !== academicB) return academicA - academicB;
    const ad = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const bd = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return bd - ad;
  });

  return json({
    query: q,
    providers,
    results: results.slice(0, 12),
    notice: results.length
      ? "최신 공개 자료를 우선으로 정렬했습니다."
      : "연결은 성공했지만 검색 결과가 없어요. 다른 검색어를 입력해 보세요.",
    ...(Object.keys(errors).length ? { providerWarnings: errors } : {})
  }, 200, { "Cache-Control": "public, max-age=120" });
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
