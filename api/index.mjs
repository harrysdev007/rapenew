let api;

function startupError(error){
  const code=typeof error?.code==='string'&&/^[A-Z_]+$/.test(error.code)?error.code:error instanceof Error?error.name:'Error';
  let detail=error instanceof Error?error.message:'Server initialization failed.';
  for(const [name,value] of Object.entries(process.env)){
    if(/SECRET|TOKEN|PASSWORD|PRIVATE|KEY|RPC_URL/i.test(name)&&value&&value.length>=8)detail=detail.split(value).join('[redacted]');
  }
  detail=detail.replace(/https?:\/\/\S+/g,'[service]').slice(0,350);
  return {error:`API could not initialize (${code}): ${detail}`,code:'API_STARTUP_FAILED',commit:process.env.VERCEL_GIT_COMMIT_SHA?.slice(0,7)||'local'};
}

export default async function handler(req,res){
  // Load the server inside the invocation, so runtime import failures return a
  // useful JSON response rather than crashing Vercel's function bootstrap.
  let handleApi;
  try{
    api??=import('../server/index.mjs');
    ({handleApi}=await api);
  }catch(error){
    api=undefined;
    res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});
    return res.end(JSON.stringify(startupError(error)));
  }
  const route=req.query?.__api??new URL(req.url||'/','http://localhost').searchParams.get('__api')??undefined;
  return handleApi(req,res,route);
}
