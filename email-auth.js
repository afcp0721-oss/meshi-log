// Passwords go directly to Firebase, never to the app Worker or browser storage.
(() => {
 let initialized,auth,sdk,nextMailAt=0;
 const generic='メールアドレス・パスワードを確認してください。登録済みの場合はログインか再設定をお試しください。';
 function explain(error) {
  if(error?.code==='auth/too-many-requests') return new Error('操作が続いています。少し待って再試行してください。');
  if(error?.code==='auth/network-request-failed') return new Error('接続を確認して再試行してください。');
  return new Error(generic);
 }
 async function init(base) {
  if(!initialized) initialized=(async()=>{
   const response=await fetch(base+'/api/auth-config');
   if(!response.ok) throw new Error('メールログインは準備中です。');
   const config=await response.json();
   const [app,module]=await Promise.all([import('https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js'),import('https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js')]);
   sdk=module;auth=sdk.getAuth(app.initializeApp(config));auth.languageCode='ja';
   await sdk.setPersistence(auth,sdk.browserLocalPersistence);await auth.authStateReady();
  })().catch(error=>{initialized=null;throw error;});
  return initialized;
 }
 function mailWait(){if(Date.now()<nextMailAt) throw new Error('メールの再送は1分ほど待ってください。');nextMailAt=Date.now()+60000;}
 async function verified(){
  if(!auth.currentUser) throw new Error('設定からメールでログインしてください。');
  if(!auth.currentUser.emailVerified) throw new Error('確認メールのリンクを開き「メール確認が済んだら押す」を押してください。');
 }
 window.meshiAuth={
  async token(base){await init(base);await verified();try{return await auth.currentUser.getIdToken();}catch(e){throw explain(e);}},
  async register(base,email,password){
   if(!email.includes('@')||password.length<12) throw new Error('メールアドレスと12文字以上のパスワードを入力してください。');
   await init(base);mailWait();
   let user;
   try{({user}=await sdk.createUserWithEmailAndPassword(auth,email,password));}catch(e){throw explain(e);}
   try{await sdk.sendEmailVerification(user);}catch{throw new Error('登録できましたが確認メールを送れませんでした。少し待って「確認メールを再送する」を押してください。');}
   return '確認メールを送りました。メール内のリンクを開いてから、この画面に戻ってください。';
  },
  async login(base,email,password){await init(base);try{await sdk.signInWithEmailAndPassword(auth,email,password);}catch(e){throw explain(e);}await verified();return 'ログインしました。';},
  async refresh(base){await init(base);if(!auth.currentUser) throw new Error('先にメールでログインしてください。');try{await sdk.reload(auth.currentUser);await auth.currentUser.getIdToken(true);}catch(e){throw explain(e);}await verified();return 'メール確認が完了し、ログインしました。';},
  async resend(base){await init(base);if(!auth.currentUser) throw new Error('先にメールでログインしてください。');mailWait();try{await sdk.sendEmailVerification(auth.currentUser);}catch(e){throw explain(e);}return '確認メールを送りました。迷惑メールフォルダもご確認ください。';},
  async reset(base,email){
   if(!email.includes('@')) throw new Error('メールアドレスを入力してください。');
   await init(base);mailWait();
   try{await sdk.sendPasswordResetEmail(auth,email);}catch(e){if(e.code!=='auth/user-not-found') throw explain(e);}
   return '登録がある場合、再設定メールが届きます。メールをご確認ください。';
  },
  async logout(base){await init(base);await sdk.signOut(auth);return 'ログアウトしました。';}
 };
})();
