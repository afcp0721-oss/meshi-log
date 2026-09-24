import test from 'node:test';
import assert from 'node:assert/strict';
import {phoneIdentity, verifyPhoneToken, publicAuthConfig} from '../phone-auth.mjs';
import {jwks, signedToken, tokens, project, phoneUsers} from './phone-fixture.mjs';
const env = {FIREBASE_PROJECT_ID:project, PHONE_USERS:phoneUsers};
function mockKeys(t) { t.mock.method(globalThis, 'fetch', async (url, options) => {
  assert.equal(url, 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  assert.equal(options.redirect,'manual');
  return Response.json(jwks, {headers:{'cache-control':'max-age=3600'}});
}); }
test('signed phone identity maps to the same existing ID on another device', async t => {
  mockKeys(t);
  assert.deepEqual(await phoneIdentity(tokens.alice,env),{userId:'alice'});
  assert.deepEqual(await phoneIdentity(await signedToken(),env),{userId:'alice'});
});
for (const [name, claims] of Object.entries({
  expired:{exp:1}, futureIssued:{iat:9999999999}, futureAuth:{auth_time:9999999999},
  wrongAudience:{aud:'another-project'}, wrongIssuer:{iss:'https://evil.test'},
  missingExpiry:{exp:undefined}, missingIssued:{iat:undefined}, missingAuth:{auth_time:undefined},
  missingSubject:{sub:''}, wrongProvider:{firebase:{sign_in_provider:'anonymous'}},
  missingPhone:{phone_number:undefined}, malformedPhone:{phone_number:'09012345678'},
})) test('reject '+name,async t=>{mockKeys(t);await assert.rejects(verifyPhoneToken(await signedToken(claims),project),e=>e.httpStatus===401);});
test('reject tampered signature, wrong key ID and unsigned tokens',async t=>{
 mockKeys(t);
 const parts=tokens.alice.split('.'); parts[2]=(parts[2][0]==='a'?'b':'a')+parts[2].slice(1);
 for(const token of [parts.join('.'),await signedToken({}, {kid:'attacker'}),'eyJhbGciOiJub25lIn0.e30.']) await assert.rejects(verifyPhoneToken(token,project),e=>e.httpStatus===401);
});
test('approval revocation and authentication cutoff reject a previously valid token',async t=>{
 mockKeys(t);
 for(const entry of [null,{userId:'alice',expiresAt:'2099-01-01',validAfter:0,disabled:true}, {userId:'alice',expiresAt:'2099-01-01',validAfter:9999999999}])
  await assert.rejects(phoneIdentity(tokens.alice,{...env,PHONE_USERS:JSON.stringify({alice:entry})}),e=>e.httpStatus===403);
 await assert.rejects(phoneIdentity(await signedToken({sub:'stranger'}),env),e=>e.httpStatus===403);
});
test('auth configuration publishes only the four public Firebase web fields',()=>{
 const config={apiKey:'public-browser-key',projectId:project,authDomain:project+'.firebaseapp.com',appId:'app',GEMINI_API_KEY:'never-output'};
 assert.deepEqual(publicAuthConfig({...env,FIREBASE_WEB_CONFIG:JSON.stringify(config)}),{apiKey:config.apiKey,projectId:project,authDomain:config.authDomain,appId:'app'});
 assert.equal(publicAuthConfig({...env,FIREBASE_WEB_CONFIG:JSON.stringify({...config,projectId:'wrong'})}),null);
});
