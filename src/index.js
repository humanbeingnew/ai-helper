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

  // OpenAlex의 select 파라미터에 의존하지 않고 기본 응답을 받아
  // API 스키마가 조금 바뀌어도 검색이 깨지지 않도록 합니다.
  const openAlexUrl =
    `https://api.openalex.org/works?search=${encodeURIComponent(q)}` +
    `&per-page=8`;
  const wikiUrl =
    `https://ko.wikipedia.org/w/api.php?action=query&list=search` +
    `&srsearch=${encodeURIComponent(q)}&srlimit=5&format=json`;

  const [openAlex, wikipedia] = await Promise.allSettled([
    fetchJson(openAlexUrl),
    fetchJson(wikiUrl)
  ]);

  const results = [];
  const providers = [];
  const errors = {};

  if (openAlex.status === "fulfilled") {
    providers.push("OpenAlex");
    for (const work of openAlex.value.results || []) {
      const title = clean(work.display_name);
      if (!title) continue;

      const authors = (work.authorships || [])
        .slice(0, 3)
        .map(item => item.author?.display_name)
        .filter(Boolean)
        .join(", ");

      results.push({
        source: "OPENALEX · 학술 자료",
        title,
        year: work.publication_year || "",
        description: authors
          ? `저자: ${authors}${work.doi ? " · DOI 자료" : ""}`
          : "공개 학술 메타데이터",
        url:
          work.primary_location?.landing_page_url ||
          (work.doi ? work.doi : "") ||
          work.id
      });
    }
  } else {
    errors.OpenAlex = openAlex.reason?.message || "연결 실패";
  }

  if (wikipedia.status === "fulfilled") {
    providers.push("Wikipedia");
    for (const page of wikipedia.value.query?.search || []) {
      results.push({
        source: "WIKIPEDIA · 개요",
        title: clean(page.title),
        year: "",
        description: clean(page.snippet || ""),
        url: `https://ko.wikipedia.org/wiki/${encodeURIComponent(
          page.title.replace(/ /g, "_")
        )}`
      });
    }
  } else {
    errors.Wikipedia = wikipedia.reason?.message || "연결 실패";
  }

  // 두 제공처 중 하나만 살아 있어도 검색은 정상 응답합니다.
  // 기존 코드는 둘 다 실패했을 때만 502를 반환했지만,
  // 외부 API 하나의 일시 장애 때문에 전체 기능이 죽는 문제가 있었습니다.
  if (!providers.length) {
    return json({
      error: "외부 자료 제공처에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
      providers,
      details: errors
    }, 502);
  }

  return json({
    query: q,
    providers,
    results: results.slice(0, 12),
    notice: results.length
      ? ""
      : "연결은 성공했지만 검색 결과가 없어요. 다른 검색어를 입력해 보세요.",
    ...(Object.keys(errors).length
      ? { providerWarnings: errors }
      : {})
  }, 200, { "Cache-Control": "public, max-age=120" });
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
