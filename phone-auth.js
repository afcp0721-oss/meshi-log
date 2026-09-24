// Only Firebase Authentication is loaded. Gemini keys and prompts never enter this module.
(() => {
  let initialized, auth, sdk, verifier, confirmation;
  let nextSendAt = 0;
  function message(error) {
    const messages = {
      'auth/invalid-verification-code': '確認コードが違います。SMSをご確認ください。',
      'auth/code-expired': '確認コードの期限が切れました。もう一度SMSを送ってください。',
      'auth/too-many-requests': '送信回数が多いため、時間をおいて再試行してください。',
      'auth/quota-exceeded': 'SMS送信の上限です。運営者へお問い合わせください。',
      'auth/invalid-phone-number': 'SMSを受け取れる携帯番号を確認してください。',
      'auth/captcha-check-failed': '本人確認をやり直してください。',
      'auth/network-request-failed': '通信できません。接続を確認して再試行してください。',
    };
    return new Error(messages[error?.code] || '電話番号の確認ができませんでした。時間をおいて再試行してください。');
  }
  async function init(base) {
    if (!initialized) initialized = (async () => {
      const response = await fetch(base + '/api/auth-config');
      if (!response.ok) throw new Error('電話ログインは準備中です。運営者へお問い合わせください。');
      const config = await response.json();
      const [app, authModule] = await Promise.all([
        import('https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js'),
      ]);
      sdk = authModule;
      auth = sdk.getAuth(app.initializeApp(config));
      auth.languageCode = 'ja';
      await sdk.setPersistence(auth, sdk.browserLocalPersistence);
      await auth.authStateReady();
    })().catch(error => { initialized = null; throw error; });
    return initialized;
  }
  window.meshiAuth = {
    async token(base) {
      await init(base);
      if (!auth.currentUser) throw new Error('設定から電話番号でログインしてください。');
      try { return await auth.currentUser.getIdToken(); } catch (error) { throw message(error); }
    },
    async send(base, value) {
      let phone = value.trim().replace(/[\s()-]/g, '');
      if (/^0[789]0\d{8}$/.test(phone)) phone = '+81' + phone.slice(1);
      if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error('携帯番号を入力してください。海外の番号は国番号（+）から入力します。');
      if (Date.now() < nextSendAt) throw new Error('再送は1分ほど待ってからお試しください。');
      await init(base);
      nextSendAt = Date.now() + 60000;
      confirmation = null;
      try {
        verifier?.clear();
        verifier = new sdk.RecaptchaVerifier(auth, 'phoneRecaptcha', {size: 'normal'});
        confirmation = await sdk.signInWithPhoneNumber(auth, phone, verifier);
      } catch (error) { verifier?.clear(); verifier = null; throw message(error); }
    },
    async confirm(code) {
      if (!confirmation) throw new Error('先にSMSで確認コードを送ってください。');
      if (!/^\d{6}$/.test(code.trim())) throw new Error('6桁の確認コードを入力してください。');
      try { await confirmation.confirm(code.trim()); confirmation = null; verifier?.clear(); verifier = null; }
      catch (error) { throw message(error); }
    },
    async logout(base) {
      await init(base);
      await sdk.signOut(auth);
      confirmation = null; verifier?.clear(); verifier = null;
    },
  };
})();
