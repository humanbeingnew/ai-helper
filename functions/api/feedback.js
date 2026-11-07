export async function onRequestPost({request,env}){
  if(!env.GEMINI_API_KEY)return Response.json({error:'GEMINI_API_KEY가 설정되지 않았습니다.'},{status:503});
  let body;try{body=await request.json()}catch{return Response.json({error:'요청 형식이 올바르지 않습니다.'},{status:400})}
  const content=String(body.content||'').trim().slice(0,12000),topic=String(body.topic||'').slice(0,300),type=String(body.type||'일반 글쓰기').slice(0,80);
  if(content.length<30)return Response.json({error:'내용을 30자 이상 입력해 주세요.'},{status:400});
  const prompt=`너는 학생의 학습을 돕는 친절하고 엄격한 글쓰기 코치다. 학생의 글을 대신 작성하지 말고 학습을 돕는 피드백을 제공한다. 과장하거나 글에 없는 사실을 추측하지 않는다. 점수는 절대적인 성적이 아니라 개선을 위한 참고 지표다. 한국어로 답한다. 반드시 JSON 객체만 출력한다. 형식: {"score":0부터100사이정수,"summary":"전체 평가 2~4문장","strengths":["구체적 강점 2~4개"],"improvements":["우선순위가 높은 개선점 2~5개"],"revised_example":"원문 중 짧은 한 문장을 골라 개선 예시를 보여주거나, 없으면 빈 문자열"}. 사실 확인이 불가능한 주장은 사실이라고 단정하지 말고 출처 확인을 권한다.\n과제 유형: ${type}\n과제 주제: ${topic||'미지정'}\n학생 작성 내용:\n${content}`;
  const endpoint='https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
  const response=await fetch(`${endpoint}?key=${encodeURIComponent(env.GEMINI_API_KEY)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.35,maxOutputTokens:1200,responseMimeType:'application/json'}})});
  if(!response.ok){const detail=await response.text();return Response.json({error:response.status===429?'무료 사용 한도에 도달했을 수 있습니다. 잠시 후 다시 시도해 주세요.':`Gemini API 오류 (${response.status})`},{status:502})}
  const data=await response.json();const raw=data.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||'';
  try{const result=JSON.parse(raw.replace(/^```json\s*/i,'').replace(/```$/,'').trim());result.score=Math.max(0,Math.min(100,Number(result.score)||0));result.method='Gemini 2.5 Flash · AI 분석';return Response.json(result,{headers:{'Cache-Control':'no-store'}})}catch{return Response.json({error:'AI 응답을 해석하지 못했습니다. 다시 시도해 주세요.'},{status:502})}
}
