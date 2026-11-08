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

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { "Accept": "application/json" }
  });
  if (!response.ok) throw new Error(`자료 제공처 응답 오류 (${response.status})`);
  return await response.json();
}

async function searchMaterials(query) {
  const q = query.trim().slice(0, 160);
  if (q.length < 2) {
    return json({ error: "검색어를 2자 이상 입력해 주세요." }, 400);
  }

  const openAlexUrl =
    `https://api.openalex.org/works?search=${encodeURIComponent(q)}` +
    `&per-page=8&select=id,display_name,publication_year,doi,primary_location,authorships`;
  const wikiUrl =
    `https://ko.wikipedia.org/w/api.php?action=query&list=search` +
    `&srsearch=${encodeURIComponent(q)}&srlimit=5&format=json`;

  const [openAlex, wikipedia] = await Promise.allSettled([
    fetchJson(openAlexUrl),
    fetchJson(wikiUrl)
  ]);

  const results = [];
  const providers = [];

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
        url: work.primary_location?.landing_page_url || work.doi || work.id
      });
    }
  }

  if (wikipedia.status === "fulfilled") {
    providers.push("Wikipedia");
    for (const page of wikipedia.value.query?.search || []) {
      results.push({
        source: "WIKIPEDIA · 개요",
        title: clean(page.title),
        year: "",
        description: clean(page.snippet || ""),
        url: `https://ko.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`
      });
    }
  }

  if (!providers.length) {
    return json({
      error: "자료 제공처에 연결하지 못했어요. 잠시 후 다시 시도해 주세요."
    }, 502);
  }

  return json({
    query: q,
    providers,
    results: results.slice(0, 12),
    notice: results.length
      ? ""
      : "연결은 성공했지만 검색 결과가 없어요. 다른 검색어를 입력해 보세요."
  }, 200, { "Cache-Control": "public, max-age=120" });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/search") {
      if (request.method !== "GET") {
        return json({ error: "GET 요청만 지원합니다." }, 405, { "Allow": "GET" });
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
