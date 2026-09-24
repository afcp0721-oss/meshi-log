import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {reserveGeneration,dailyUsage,usageDay} from '../usage.mjs';
function setup(t,cap=150){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../migrations/0001_ai_usage.sql',import.meta.url),'utf8'));t.after(()=>db.close());
 return {GLOBAL_DAILY_AI_UNITS:cap,DB:{prepare(sql){return {bind(...args){return {async first(){return db.prepare(sql).get(...args)}}}}}}};
}
test('parallel callers share atomic personal limit and new JST day resets',async t=>{
 const env=setup(t),now=Date.parse('2026-09-24T14:59:59Z');
 const results=await Promise.allSettled(Array.from({length:12},()=>reserveGeneration(env,'a',3,now)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,5);
 assert(results.filter(r=>r.status==='rejected').every(r=>r.reason.httpStatus===429));
 assert.equal((await dailyUsage(env,'a',now)).remaining,0);
 assert.equal((await dailyUsage(env,'a',now+1000)).remaining,5);
 assert.equal(usageDay(now+1000),'2026-09-25');
 assert.equal(await reserveGeneration(env,'a',1,now+1000),4);
});
test('global units bound different users and denied requests do not consume quota',async t=>{
 const env=setup(t,5);
 await reserveGeneration(env,'a',3);
 await assert.rejects(reserveGeneration(env,'b',3),e=>e.httpStatus===429);
 assert.equal((await dailyUsage(env,'b')).remaining,5);
 await reserveGeneration(env,'b',2);
 await assert.rejects(reserveGeneration(env,'c',1),e=>e.httpStatus===429);
});
test('missing budget or database fails closed',async t=>{
 const env=setup(t);
 for(const cap of [undefined,0,-1,'x',1.5]) await assert.rejects(reserveGeneration({...env,GLOBAL_DAILY_AI_UNITS:cap},'a',1),e=>e.httpStatus===503);
 await assert.rejects(reserveGeneration({...env,DB:{prepare(){throw Error('offline')}}},'a',1),e=>e.httpStatus===503);
});
