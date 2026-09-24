import { createLocalJWKSet, jwtVerify } from 'jose';

const KEY_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let cachedKeys;
let keysExpire = 0;
let pendingKeys;
function denied(message = '設定からメールでログインしてください。', status = 401) {
  return Object.assign(new Error(message), {publicMessage: message, httpStatus: status});
}
async function signingKeys() {
  if (cachedKeys && Date.now() < keysExpire) return cachedKeys;
  if (!pendingKeys) pendingKeys = (async () => {
    const response = await fetch(KEY_URL, {redirect: 'manual', signal: AbortSignal.timeout(10000)});
    if (!response.ok) throw denied('本人確認サービスに接続できません。時間をおいて再試行してください。', 503);
    const keys = await response.json();
    const resolver = createLocalJWKSet(keys);
    const maxAge = Number((response.headers.get('cache-control') || '').match(/max-age=(\d+)/)?.[1] || 60);
    cachedKeys = resolver;
    keysExpire = Date.now() + Math.min(maxAge, 3600) * 1000;
    return resolver;
  })().finally(() => { pendingKeys = null; });
  return pendingKeys;
}
export async function verifyEmailToken(token, projectId) {
  if (typeof token !== 'string' || token.length > 8192) throw denied();
  let payload;
  try {
    ({payload} = await jwtVerify(token, await signingKeys(), {
      algorithms: ['RS256'], issuer: 'https://securetoken.google.com/' + projectId,
      audience: projectId, requiredClaims: ['exp', 'iat', 'auth_time', 'sub'],
    }));
  } catch (error) {
    if (error.httpStatus) throw error;
    throw denied();
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128 ||
      !Number.isInteger(payload.iat) || payload.iat > now ||
      !Number.isInteger(payload.auth_time) || payload.auth_time > now || payload.auth_time < 0 ||
      payload.firebase?.sign_in_provider !== 'password' || payload.email_verified !== true ||
      typeof payload.email !== 'string' || !payload.email.includes('@')) throw denied();
  return payload;
}
export async function emailIdentity(token, env) {
  const claims = await verifyEmailToken(token, env.FIREBASE_PROJECT_ID);
  const users = JSON.parse(env.EMAIL_USERS);
  const user = Object.hasOwn(users, claims.sub) ? users[claims.sub] : null;
  // IDs are assigned by the operator. Never attach records using client-supplied IDs or email addresses.
  if (!user || user.disabled || typeof user.userId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(user.userId) ||
      !Number.isFinite(Date.parse(user.expiresAt)) || Date.parse(user.expiresAt) <= Date.now() ||
      !Number.isInteger(user.validAfter) || claims.auth_time < user.validAfter) {
    throw denied('メールを確認しました。利用開始には運営者の承認が必要です。', 403);
  }
  return {userId: user.userId};
}
export function publicAuthConfig(env) {
  const config = JSON.parse(env.FIREBASE_WEB_CONFIG || '{}');
  if (!env.FIREBASE_PROJECT_ID || config.projectId !== env.FIREBASE_PROJECT_ID ||
      typeof config.apiKey !== 'string' || !config.apiKey || typeof config.appId !== 'string' || !config.appId ||
      config.authDomain !== config.projectId + '.firebaseapp.com') return null;
  // Firebase browser configuration is public; never return other environment variables.
  return {apiKey: config.apiKey, authDomain: config.authDomain, projectId: config.projectId, appId: config.appId};
}
