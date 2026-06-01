function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export interface LoginPageProps {
  oauthEnabled: boolean;
  oauthLabel: string;
  error?: string;
}

/** Self-contained login page (no external assets). Submits credentials as JSON. */
export function loginPage({ oauthEnabled, oauthLabel, error }: LoginPageProps): string {
  const errMsg = error === 'oauth' ? 'OAuth2 sign-in failed or not allowed.' : error ? 'Invalid credentials.' : '';
  const oauthBlock = oauthEnabled
    ? `<div class="divider"><span>or</span></div>
       <a class="oauth" href="/auth/oauth2/start">${esc(oauthLabel)}</a>`
    : '';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SmallTV Admin — Sign in</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    font-family: system-ui, -apple-system, Segoe UI, sans-serif;
    background: radial-gradient(1200px 600px at 50% -10%, #1b2740, #0b0f1a); color:#e8edf5; }
  .card { width: 340px; background:#121826; border:1px solid #243049; border-radius:16px;
    padding:28px; box-shadow: 0 20px 60px rgba(0,0,0,.45); }
  h1 { font-size:18px; margin:0 0 4px; }
  p.sub { margin:0 0 20px; color:#8aa0c0; font-size:13px; }
  label { display:block; font-size:12px; color:#9fb2cf; margin:14px 0 6px; }
  input { width:100%; padding:10px 12px; border-radius:9px; border:1px solid #2b3a57;
    background:#0c1422; color:#e8edf5; font-size:14px; }
  input:focus { outline:none; border-color:#3f6fd6; }
  button { width:100%; margin-top:20px; padding:11px; border:0; border-radius:9px;
    background:#3f6fd6; color:#fff; font-weight:600; font-size:14px; cursor:pointer; }
  button:hover { background:#3461c4; }
  .err { background:#3a1620; border:1px solid #7a2230; color:#ffb4bf; padding:9px 12px;
    border-radius:8px; font-size:13px; margin-bottom:6px; ${errMsg ? '' : 'display:none;'} }
  .divider { display:flex; align-items:center; gap:10px; color:#5e7193; margin:18px 0; font-size:12px; }
  .divider::before, .divider::after { content:''; flex:1; height:1px; background:#243049; }
  a.oauth { display:block; text-align:center; padding:10px; border-radius:9px;
    border:1px solid #2b3a57; color:#cfe0ff; text-decoration:none; font-size:14px; }
  a.oauth:hover { background:#0c1422; }
</style></head>
<body>
  <form class="card" id="f">
    <h1>SmallTV Admin</h1>
    <p class="sub">Sign in to manage your screens.</p>
    <div class="err" id="err">${esc(errMsg)}</div>
    <label for="u">Username</label>
    <input id="u" name="username" autocomplete="username" autofocus required>
    <label for="p">Password</label>
    <input id="p" name="password" type="password" autocomplete="current-password" required>
    <button type="submit">Sign in</button>
    ${oauthBlock}
  </form>
  <script>
    const f = document.getElementById('f'), err = document.getElementById('err');
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.style.display = 'none';
      const res = await fetch('/login', {
        method:'POST', headers:{'content-type':'application/json'},
        body: JSON.stringify({ username: f.username.value, password: f.password.value })
      });
      if (res.ok) { location.href = '/admin/ui'; }
      else { err.textContent = 'Invalid credentials.'; err.style.display = 'block'; }
    });
  </script>
</body></html>`;
}
