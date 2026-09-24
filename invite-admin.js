'use strict';
const id=localStorage.getItem('meshi_user_id') || '';
document.getElementById('identity').value=id;
const valid=/^usr_[A-Za-z0-9_-]{8,96}$/.test(id);
document.getElementById('notice').textContent=valid?'記録IDが見つかりました。この端末の記録を引き継ぎます。':'記録IDが見つかりません。普段使っている端末でめしログを開いてから、このページを開き直してください。';
document.getElementById('generate').disabled=!valid;
document.getElementById('generate').addEventListener('click',async()=>{
 const bytes=crypto.getRandomValues(new Uint8Array(32));
 const token=Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),x=>x.toString(16).padStart(2,'0')).join('');
 document.getElementById('code').value=token;
 document.getElementById('config').value=JSON.stringify({[hash]:{userId:id,expiresAt:new Date(Date.now()+30*86400000).toISOString()}},null,2);
 document.getElementById('result').hidden=false;
 document.getElementById('generate').disabled=true;
});
