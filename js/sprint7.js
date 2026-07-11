let sprint7AuthStatus=null;
async function sprint7Fetch(url,options={}){const r=await fetch(url,{credentials:'same-origin',...options});let data={};try{data=await r.json()}catch(_){data={ok:false,error:'Resposta inválida'}}if(r.status===401&&url!='/api/auth/login')showSprint7Login();return {r,data}}
function ensureSprint7LoginUI(){if(document.getElementById('s7LoginOverlay'))return;document.body.insertAdjacentHTML('beforeend',`<div id="s7LoginOverlay" class="s7-login-overlay d-none"><div class="card shadow-lg s7-login-card"><div class="card-body p-4"><div class="text-center mb-4"><div class="s7-login-icon"><i class="bi bi-box-seam"></i></div><h1 class="h4 mt-3">Sistema3D</h1><p class="text-secondary mb-0">Entre para acessar o sistema</p></div><form onsubmit="sprint7Login(event)"><div class="mb-3"><label class="form-label">E-mail</label><input id="s7LoginEmail" type="email" class="form-control" required autocomplete="username"></div><div class="mb-3"><label class="form-label">Senha</label><input id="s7LoginPassword" type="password" class="form-control" required autocomplete="current-password"></div><div id="s7LoginError" class="alert alert-danger d-none py-2"></div><button class="btn btn-primary w-100" type="submit"><i class="bi bi-box-arrow-in-right me-2"></i>Entrar</button></form></div></div></div>`)}
function showSprint7Login(){ensureSprint7LoginUI();document.getElementById('s7LoginOverlay').classList.remove('d-none')}
function hideSprint7Login(){document.getElementById('s7LoginOverlay')?.classList.add('d-none')}
async function sprint7CheckAuth(){ensureSprint7LoginUI();const {data}=await sprint7Fetch('/api/auth/status');sprint7AuthStatus=data;updateSprint7UserUI(data);if(data.enabled&&!data.authenticated)showSprint7Login();else hideSprint7Login();return data}
async function sprint7Login(ev){ev.preventDefault();const err=document.getElementById('s7LoginError');err.classList.add('d-none');const {r,data}=await sprint7Fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.getElementById('s7LoginEmail').value,password:document.getElementById('s7LoginPassword').value})});if(!r.ok){err.textContent=data.error||'Falha no login';err.classList.remove('d-none');return}location.reload()}
async function sprint7Logout(){await sprint7Fetch('/api/auth/logout');location.reload()}
function updateSprint7UserUI(st){
  const chip=document.getElementById('s7CurrentUser');
  const btn=document.getElementById('s7LogoutBtn');
  if(chip){
    if(st.authenticated){
      chip.innerHTML=`<i class="bi bi-person-circle me-2 text-primary fs-5"></i><span><strong>${escapeHtml(st.user.name)}</strong><small>${escapeHtml(st.user.role)}</small></span>`;
      chip.classList.remove('d-none');
    }else{
      chip.innerHTML='';
      chip.classList.add('d-none');
    }
  }
  if(btn)btn.classList.toggle('d-none',!st.authenticated);
}
async function loadSprint7Security(){try{const st=await sprint7CheckAuth();const enabled=document.getElementById('s7AuthEnabled');if(enabled)enabled.value=String(st.enabled);const hrs=document.getElementById('s7SessionHours');if(hrs)hrs.value=st.session_hours||12;const msg=document.getElementById('s7AuthStatus');if(msg)msg.textContent=st.enabled?(st.configured?'Autenticação ativa':'Aguardando definição de senha'):'Autenticação desativada';loadSprint7UserOptions();}catch(e){const msg=document.getElementById('s7AuthStatus');if(msg)msg.textContent='Falha ao carregar status de autenticação';console.warn('[Auth]',e);}}
function loadSprint7UserOptions(){if(!window.db)return;const rows=db.exec(`SELECT id,name,email FROM users WHERE active=1 ORDER BY name`)?.[0]?.values||[];const sel=document.getElementById('s7AuthUser');if(sel)sel.innerHTML=rows.length?('<option value="">Selecione um usuário…</option>'+rows.map(r=>`<option value="${r[0]}">${escapeHtml(r[1])} · ${escapeHtml(r[2])}</option>`).join('')):'<option value="" disabled>— Cadastre um usuário primeiro (aba acima) —</option>'}
async function saveSprint7Security(){const user_id=+document.getElementById('s7AuthUser').value,password=document.getElementById('s7AuthPassword').value,enabled=document.getElementById('s7AuthEnabled').value==='true',session_hours=+document.getElementById('s7SessionHours').value;const isConfigured=sprint7AuthStatus?.configured;if(!isConfigured&&(!user_id||password.length<8)){showToast?.('Para ativar, selecione um usuário e informe senha (mín. 8 caracteres)','error');return}if(password&&password.length<8){showToast?.('A senha deve ter pelo menos 8 caracteres','error');return}if(password&&!user_id){showToast?.('Selecione o usuário para definir a senha','error');return}await persistDBNow?.();const payload={enabled,session_hours};if(password){payload.user_id=user_id;payload.password=password}const {r,data}=await sprint7Fetch('/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});showToast?.(r.ok?'Segurança atualizada':data.error,r.ok?'success':'error');if(r.ok)setTimeout(()=>location.reload(),500)}
async function testSprint7Api(){const {r,data}=await sprint7Fetch('/api/v1/summary');const out=document.getElementById('s7ApiResult');if(out)out.textContent=r.ok?JSON.stringify(data,null,2):(data.error||'Erro')}
window.addEventListener('DOMContentLoaded',()=>{setTimeout(sprint7CheckAuth,100)});
