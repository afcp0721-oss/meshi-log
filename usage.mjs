export const DAILY_LIMIT = 5;
export const RESERVE_SQL = `INSERT INTO ai_daily_usage (day,user_id,requests,units)
 SELECT ?,?,1,? WHERE (SELECT COALESCE(SUM(units),0) FROM ai_daily_usage WHERE day=?) + ? <= ?
 ON CONFLICT(day,user_id) DO UPDATE SET requests=requests+1,units=units+excluded.units
 WHERE requests < 5 RETURNING requests`;
function unavailable() {return Object.assign(new Error('usage unavailable'),{httpStatus:503,publicMessage:'AIの利用設定を確認中です。時間をおいて再試行してください。'});}
export function usageDay(now=Date.now()) {return new Date(now+9*3600000).toISOString().slice(0,10);}
export async function dailyUsage(env,userId,now=Date.now()) {
 const day=usageDay(now);
 const row=await env.DB.prepare('SELECT requests FROM ai_daily_usage WHERE day=? AND user_id=?').bind(day,userId).first();
 return {limit:DAILY_LIMIT,remaining:Math.max(0,DAILY_LIMIT-(row?.requests||0)),resetAt:new Date(Date.parse(day+'T00:00:00+09:00')+86400000).toISOString()};
}
export async function reserveGeneration(env,userId,units,now=Date.now()) {
 const cap=Number(env.GLOBAL_DAILY_AI_UNITS);
 if(!Number.isSafeInteger(cap)||cap<1||!Number.isInteger(units)||units<1||units>3) throw unavailable();
 const day=usageDay(now);
 let row;
 try {
  // One atomic write on D1's primary: parallel requests/devices cannot race past either cap.
  row=await env.DB.prepare(RESERVE_SQL).bind(day,userId,units,day,units,cap).first();
 } catch {throw unavailable();}
 if(!row) throw Object.assign(new Error('quota exhausted'),{httpStatus:429,publicMessage:'本日分のAI利用上限です（1人5回、またはサービス全体の上限）。日本時間の午前0時以降にお試しください。保存と過去ログの閲覧はできます。'});
 return DAILY_LIMIT-row.requests;
}
