export function sameOrigin(req,env=process.env){
  const host=req.headers.host;
  if(typeof host!=='string')return false;
  const local=/^(127\.0\.0\.1|localhost):\d+$/.test(host);
  let origin;
  if(local)origin=`http://${host}`;
  else{
    const configured=[env.APP_ORIGIN,...[env.VERCEL_URL,env.VERCEL_PROJECT_PRODUCTION_URL].filter(Boolean).map(host=>`https://${host}`)].filter(Boolean);
    const allowed=new Set(configured.flatMap(value=>{try{const url=new URL(value);return url.protocol==='https:'?[url.origin]:[];}catch{return [];}}));
    origin=`https://${host}`;
    if(!allowed.has(origin))return false;
  }
  return !req.headers.origin||req.headers.origin===origin;
}

export async function readJsonBody(req,max=30000){
  // Vercel may parse JSON before invoking the Node handler. Local Node requests
  // expose a stream instead; enforce the same byte limit for both paths.
  if(req.body!==undefined){
    const encoded=Buffer.isBuffer(req.body)?req.body:typeof req.body==='string'?Buffer.from(req.body):Buffer.from(JSON.stringify(req.body));
    if(encoded.length>max)throw Error('Request is too large.');
    return JSON.parse(encoded.toString('utf8'));
  }
  let size=0;const chunks=[];
  for await(const chunk of req){const bytes=Buffer.from(chunk);size+=bytes.length;if(size>max)throw Error('Request is too large.');chunks.push(bytes);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
