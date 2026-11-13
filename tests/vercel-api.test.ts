import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
// @ts-expect-error Shared request policy is plain JavaScript.
import {sameOrigin,readJsonBody} from '../server/request-policy.mjs';
// @ts-expect-error Vercel entry point is plain JavaScript.
import handler from '../api/index.mjs';

test('API cold start works without TypeScript loading or experimental require(ESM), matching Vercel Node',()=>{
  const source=`import handler from './api/index.mjs';
    let status,body;await handler({method:'GET',url:'/api?__api=health',query:{__api:'health'},headers:{host:'127.0.0.1:5188'}},{writeHead(s){status=s},end(b){body=JSON.parse(b)}});
    if(status!==200||body.version!=='1.0.0')throw Error('API health failed');`;
  const result=spawnSync(process.execPath,['--no-experimental-strip-types','--no-experimental-require-module','--input-type=module','-e',source],{cwd:new URL('..',import.meta.url),encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
});

test('missing deployment files return a JSON startup error instead of crashing the function',()=>{
  const directory=mkdtempSync(join(tmpdir(),'rapelaunch-cold-start-'));
  mkdirSync(join(directory,'api'));copyFileSync(new URL('../api/index.mjs',import.meta.url),join(directory,'api/index.mjs'));
  const source=`import handler from ${JSON.stringify(pathToFileURL(join(directory,'api/index.mjs')).href)};
    let status,body;await handler({method:'GET',url:'/api/health',headers:{}},{writeHead(s){status=s},end(b){body=JSON.parse(b)}});
    if(status!==503||body.code!=='API_STARTUP_FAILED'||!body.error.includes('ERR_MODULE_NOT_FOUND'))throw Error('Expected safe startup response');`;
  const result=spawnSync(process.execPath,['--input-type=module','-e',source],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
});

test('production API accepts configured HTTPS origins and previews, rejects arbitrary hosts and cross-origin requests',()=>{
  const env={APP_ORIGIN:'https://rapelaunch.xyz',VERCEL_URL:'rape-preview.vercel.app'};
  assert.equal(sameOrigin({headers:{host:'rapelaunch.xyz',origin:'https://rapelaunch.xyz'}},env),true);
  assert.equal(sameOrigin({headers:{host:'rape-preview.vercel.app'}},env),true);
  assert.equal(sameOrigin({headers:{host:'evil.example',origin:'https://evil.example'}},env),false);
  assert.equal(sameOrigin({headers:{host:'rapelaunch.xyz',origin:'https://evil.example'}},env),false);
  assert.equal(sameOrigin({headers:{host:'127.0.0.1:5188',origin:'http://127.0.0.1:5188'}},{}),true);
});

test('project domains work without Vercel system variables while other hosts and cross-origin requests stay blocked',()=>{
  for(const host of ['rapelaunch.xyz','www.rapelaunch.xyz','rapenew.vercel.app']){
    assert.equal(sameOrigin({headers:{host,origin:`https://${host}`}},{}),true);
  }
  for(const host of ['rapenew.vercel.app.evil.example','evil.vercel.app','evil.example']){
    assert.equal(sameOrigin({headers:{host,origin:`https://${host}`}},{}),false);
  }
  assert.equal(sameOrigin({headers:{host:'rapelaunch.xyz',origin:'https://rapenew.vercel.app'}},{}),false);
});

test('JSON body limits work for native streams and Vercel-parsed objects, strings and buffers',async()=>{
  const value={method:'getGenesisHash',params:[]},json=JSON.stringify(value);
  for(const req of [Readable.from([Buffer.from(json)]),{body:value},{body:json},{body:Buffer.from(json)}])assert.deepEqual(await readJsonBody(req,100),value);
  for(const req of [Readable.from(['x'.repeat(101)]),{body:{value:'x'.repeat(101)}}])await assert.rejects(readJsonBody(req,100),/too large/);
  await assert.rejects(readJsonBody({body:'invalid'}),SyntaxError);
});

function response(){
  let status=0,body:Record<string,unknown>={};
  return {writeHead(code:number){status=code;},end(value:string){body=JSON.parse(value);},result:()=>({status,body})};
}

test('Vercel rewrite dispatches health and rejects parsed invalid RPC methods before contacting a provider',async()=>{
  const health=response();await handler({method:'GET',url:'/api?__api=health',query:{__api:'health'},headers:{host:'127.0.0.1:5188'}},health);
  assert.equal(health.result().status,200);assert.equal(health.result().body.version,'1.0.0');
  const invalid=response();await handler({method:'POST',url:'/api?__api=rpc',query:{__api:'rpc'},headers:{host:'127.0.0.1:5188'},body:{method:'sendTransaction',params:[]}},invalid);
  assert.equal(invalid.result().status,400);assert.match(String(invalid.result().body.error),/not allowed/);
  const unknown=response();await handler({method:'GET',url:'/api?__api=..%2F.env',query:{__api:'../.env'},headers:{host:'127.0.0.1:5188'}},unknown);
  assert.equal(unknown.result().status,404);
});

test('production image pinning requires a verified Privy session',async()=>{
  const previous=process.env.VERCEL;process.env.VERCEL='1';
  try{
    const denied=response();await handler({method:'POST',url:'/api?__api=image',query:{__api:'image'},headers:{host:'127.0.0.1:5188'},body:{base64:'not-an-image'}},denied);
    assert.ok([401,503].includes(denied.result().status));
  }finally{if(previous===undefined)delete process.env.VERCEL;else process.env.VERCEL=previous;}
});
