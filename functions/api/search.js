function clean(s=''){return String(s).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim()}
export async function onRequestGet({request}){
  const url=new URL(request.url);const q=(url.searchParams.get('q')||'').trim().slice(0,160);
  if(q.length<2)return Response.json({error:'검색어를 2자 이상 입력해 주세요.'},{status:400});
  const results=[];
  const tasks=await Promise.allSettled([
    fetch(`https://api.openalex.org/works?search=${encodeURIComponent(q)}&per-page=8&select=id,display_name,publication_year,doi,primary_location,authorships,biblio`).then(r=>{if(!r.ok)throw new Error('OpenAlex');return r.json()}),
    fetch(`https://ko.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=5&format=json&origin=*`).then(r=>{if(!r.ok)throw new Error('Wikipedia');return r.json()})
  ]);
  if(tasks[0].status==='fulfilled')for(const w of tasks[0].value.results||[]){const title=clean(w.display_name);if(!title)continue;const authors=(w.authorships||[]).slice(0,3).map(a=>a.author?.display_name).filter(Boolean).join(', ');const landing=w.primary_location?.landing_page_url||w.doi||w.id;results.push({source:'OPENALEX · 학술 자료',title,year:w.publication_year||'',description:authors?`저자: ${authors}${w.doi?' · DOI 자료':''}`:'공개 학술 메타데이터',url:landing})}
  if(tasks[1].status==='fulfilled')for(const p of tasks[1].value.query?.search||[]){results.push({source:'WIKIPEDIA · 개요',title:clean(p.title),year:'',description:clean(p.snippet.replace(/<[^>]+>/g,' ')),url:`https://ko.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g,'_'))}`})}
  if(!results.length)return Response.json({error:'자료 제공처에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'},{status:502});
  return Response.json({query:q,results:results.slice(0,12)},{headers:{'Cache-Control':'public, max-age=120'}});
}
