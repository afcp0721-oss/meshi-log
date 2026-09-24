import {generateKeyPair, exportJWK, SignJWT} from 'jose';
const {publicKey, privateKey} = await generateKeyPair('RS256');
export const jwks = {keys: [{...await exportJWK(publicKey), kid:'test-key', alg:'RS256', use:'sig'}]};
export const project = 'meshi-auth-test';
export async function signedToken(overrides = {}, headers = {}) {
  const now = Math.floor(Date.now()/1000);
  return new SignJWT({sub:'alice', aud:project, iss:'https://securetoken.google.com/'+project,
    iat:now, exp:now+3600, auth_time:now, phone_number:'+819000000000', firebase:{sign_in_provider:'phone'}, ...overrides})
    .setProtectedHeader({alg:'RS256',kid:'test-key',...headers}).sign(privateKey);
}
export const tokens = {alice:await signedToken(), bob:await signedToken({sub:'bob'})};
export const phoneUsers = JSON.stringify(Object.fromEntries(['alice','bob'].map(id=>[id,{userId:id,expiresAt:'2099-01-01',validAfter:0}])));
