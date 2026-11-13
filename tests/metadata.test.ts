import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error The local HTTP server is plain JavaScript.
import {metadataCheck} from '../server/index.mjs';
const token={name:'Example',symbol:'EX',description:'Test metadata',website:'https://example.com'};
test('optional X links reach the published token metadata alongside the website',()=>{
  for(const twitter of ['https://x.com/example','https://twitter.com/example/status/123','https://x.com/i/communities/123']){
    const metadata=metadataCheck({...token,twitter});assert.equal(metadata.twitter,twitter);assert.equal(metadata.extensions.twitter,twitter);assert.equal(metadata.external_url,token.website);
  }
  assert.equal(metadataCheck(token).twitter,undefined);assert.equal(metadataCheck({...token,twitter:''}).extensions,undefined);
});
test('invalid X links are rejected instead of publishing or silently dropping them',()=>{
  for(const twitter of ['https://example.com/example','http://x.com/example','https://x.com.evil.example/name','https://x.com@evil.example/name','https://user:password@x.com/name','https://x.com/','javascript:alert(1)',123,null])assert.throws(()=>metadataCheck({...token,twitter}));
});

test('the metadata endpoint enforces the form limits on token names and websites', () => {
  const name = '界'.repeat(10) + 'ab';
  assert.equal(metadataCheck({...token, name}).name, name);
  assert.throws(() => metadataCheck({...token, name: name + 'c'}), /Name is too long/);
  assert.throws(() => metadataCheck({...token, website: 'http://example.com'}), /https/);
  assert.throws(() => metadataCheck({...token, website: token.website + '/' + 'x'.repeat(300)}), /300 characters/);
});
