// ═══════════════════════════════════════════════════════
// SUPABASE CONFIG
// ═══════════════════════════════════════════════════════
const SUPA_URL = 'https://hfoytfqtbuwnsxuiydgt.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhmb3l0ZnF0YnV3bnN4dWl5ZGd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MDQ1OTksImV4cCI6MjA5MDA4MDU5OX0.NKrKIW0Bl8rxZSCQDWhTzrV580ycYBtMbyACq2Y_e3U';
const supa = supabase.createClient(SUPA_URL, SUPA_KEY);
let UID = null;
let CURRENT_USER = null;

// ═══════════════════════════════════════════════════════
// AUTH — usuarios en Supabase
// ═══════════════════════════════════════════════════════
let _usersCache = []; // caché local para evitar queries repetidos
function hashPass(p){ return btoa(encodeURIComponent(p)) }
function unhashPass(h){ try{ return decodeURIComponent(atob(h)) }catch(e){ return '***' } }

async function getUsers(){
  try {
    const {data, error} = await supa.from('usuarios').select('*').order('created_at');
    if(error) throw error;
    _usersCache = (data||[]).map(r=>({
      id:r.id, username:r.username, pass:r.pass,
      nombre:r.nombre||'', apellido:r.apellido||'',
      rol:r.rol||'user', nacimiento:r.nacimiento||'',
      activo:r.activo!==false, creadoEl:r.created_at
    }));
  } catch(e){
    console.warn('getUsers from Supabase failed, using cache:', e);
  }
  return _usersCache;
}

async function saveUserDB(u){
  try {
    const payload = {
      id:u.id, username:u.username, pass:u.pass,
      nombre:u.nombre||'', apellido:u.apellido||'',
      rol:u.rol||'user', nacimiento:u.nacimiento||'',
      activo:u.activo!==false
    };
    await supa.from('usuarios').upsert(payload, {onConflict:'id'});
  } catch(e){ console.warn('saveUserDB:', e); }
}

async function deleteUserDB(uid){
  try { await supa.from('usuarios').delete().eq('id', uid); }
  catch(e){ console.warn('deleteUserDB:', e); }
}

async function initUsers(){
  const users = await getUsers();
  if(!users.length){
    const admin = {
      id:'admin-1', username:'atorres', pass:hashPass('A0109e0907'),
      nombre:'Angel', apellido:'Torres', rol:'admin',
      nacimiento:'', activo:true, creadoEl:new Date().toISOString()
    };
    _usersCache.push(admin);
    await saveUserDB(admin);
  }
}

async function loginLocal(){
  const username = id('login-user').value.trim().toLowerCase();
  const pass = id('login-pass').value;
  const errEl = id('login-error');
  if(!username||!pass){ errEl.style.display='block'; errEl.textContent='Ingresa usuario y contraseña'; return; }
  const users = await getUsers();
  const user = users.find(u=>u.username.toLowerCase()===username);
  if(!user||user.pass!==hashPass(pass)){
    errEl.style.display='block'; errEl.textContent='Usuario o contraseña incorrectos'; return;
  }
  if(!user.activo){
    errEl.style.display='block'; errEl.textContent='Tu cuenta está deshabilitada. Contacta al administrador.'; return;
  }
  errEl.style.display='none';
  UID = user.id;
  CURRENT_USER = user;
  localStorage.setItem('mf_session', user.id);
  registrarSessionListeners();
  mostrarApp();
  cargarDatosUsuario();
}

function registrarSessionListeners(){
  // Solo cerrar sesión si el usuario cierra/recarga la pestaña de verdad
  // NO cerrar en swipe-up, cambio de app, o cuando la pantalla se apaga
  let isRealClose = false;
  document.addEventListener('visibilitychange', ()=>{
    if(document.visibilityState === 'hidden'){
      // Guardar timestamp de cuando se fue a background
      if(UID) localStorage.setItem('mf_bg_time', Date.now());
    } else {
      // Volvió a la app — verificar si pasaron más de 15 min
      const bgTime = parseInt(localStorage.getItem('mf_bg_time') || '0');
      if(bgTime && UID){
        const elapsed = Date.now() - bgTime;
        if(elapsed > 15 * 60 * 1000){
          cerrarSesion();
          return;
        }
      }
      localStorage.removeItem('mf_bg_time');
    }
  });
  // La sesión persiste en localStorage — sobrevive recargas y swipe-up
  // Solo se elimina al hacer cerrar sesión manualmente o tras 15 min inactivo
  // Inactividad — cerrar sesión tras 15 min sin tocar la app
  let inactivityTimer;
  function resetInactivityTimer(){
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(()=>{
      if(UID) cerrarSesion();
    }, 15*60*1000);
  }
  ['click','keydown','touchstart','mousemove','scroll'].forEach(evt=>{
    document.addEventListener(evt, resetInactivityTimer, {passive:true});
  });
  resetInactivityTimer();
}

function cerrarSesion(){
  CURRENT_USER = null; UID = null;
  localStorage.removeItem('mf_session');
  mostrarPantallaLogin();
}

async function cargarDatosUsuario(){
  PERIODOS = calcPeriodosDesdeHoy();
  const cache = localStorage.getItem('finanzas_'+UID);
  S = JSON.parse(cache||'null') || {...DEF};
  if(!S.otrosGastos) S.otrosGastos = [];
  if(!S.tema) S.tema = 'clasico';
  if(!S.secciones) S.secciones = {principal:true,servicios:true,extras:true,tdc:true,msi:true,deudas:true,otros:true,ahorro:true};
  if(!S.sueldoPorPeriodo) S.sueldoPorPeriodo = {};
  aplicarTema(S.tema);
  aplicarSecciones();
  // Cargar desde Supabase — SIEMPRE tiene prioridad sobre caché local
  try {
    await loadFromSupabase(false);
    // El tema de Supabase ya se aplicó dentro de loadFromSupabase
  } catch(e){ console.warn('Supabase load failed, usando caché:', e); }
  // Re-apply defaults after Supabase load
  if(!S.otrosGastos) S.otrosGastos = [];
  if(!S.secciones) S.secciones = {principal:true,servicios:true,extras:true,tdc:true,msi:true,deudas:true,otros:true,ahorro:true};
  if(!S.sueldoPorPeriodo) S.sueldoPorPeriodo = {};
  aplicarSecciones();
  S.fontSize = parseInt(localStorage.getItem('mf_fontSize_'+UID))||0;
  aplicarFontSize(S.fontSize);
  PERIODOS = calcPeriodosDesdeHoy();
  // Auto-guardado
  const periodoAnteriorLabel = S.ultimoPeriodoLabel || null;
  const periodoActualLabel = PERIODOS[0] ? PERIODOS[0].lbl : null;
  if(periodoAnteriorLabel && periodoActualLabel && periodoAnteriorLabel !== periodoActualLabel){
    if(!S.historial.some(h => h.periodo === periodoAnteriorLabel)){
      // Create snapshot with current data (best effort for past period)
      const snap = crearSnapshot(true);
      snap.periodo = periodoAnteriorLabel;
      snap.ini = ''; snap.fin = '';
      S.historial.push(snap);
      S.extras = []; S.movimientos = [];
    }
  }
  S.periodoIdx = 0;
  S.ultimoPeriodoLabel = periodoActualLabel;
  save();
  window.renderAll();
}

// ── PANTALLA DE LOGIN ─────────────────────────────────────
function mostrarPantallaLogin(){
  const splash = document.getElementById('splash-init');
  if(splash) splash.style.display='none';
  document.getElementById('app-wrapper').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  id('login-user').value=''; id('login-pass').value='';
  id('login-error').style.display='none';
}
function mostrarApp(){
  const splash = document.getElementById('splash-init');
  if(splash) splash.style.display='none';
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-wrapper').style.display = '';
  if(CURRENT_USER){
    const displayName = `${CURRENT_USER.nombre||''} ${CURRENT_USER.apellido||''}`.trim()||CURRENT_USER.username;
    if(id('profile-name-hdr')) id('profile-name-hdr').textContent = displayName;
    if(id('admin-menu-item')) id('admin-menu-item').style.display = CURRENT_USER.rol==='admin'?'block':'none';
    // Sidebar user with dropdown
    const el = document.getElementById('sb-user-info');
    if(el) el.innerHTML = `
      <div style="position:relative;padding:8px 8px 0;border-top:1px solid var(--border);margin-top:auto">
        <button onclick="toggleSbProfileMenu()" style="display:flex;align-items:center;gap:8px;width:100%;border:none;background:transparent;cursor:pointer;padding:4px;border-radius:6px;transition:background .15s" onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background='transparent'">
          <div style="width:28px;height:28px;border-radius:50%;background:var(--border);display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--blue);flex-shrink:0">${(CURRENT_USER.nombre||CURRENT_USER.username)[0].toUpperCase()}</div>
          <div style="flex:1;min-width:0;text-align:left">
            <div style="font-size:11px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${displayName}</div>
            <div style="font-size:10px;color:var(--text3)">${CURRENT_USER.rol==='admin'?'Administrador':'Usuario'}</div>
          </div>
          <span style="font-size:9px;color:var(--text3)">▲</span>
        </button>
        <div id="sb-profile-menu" style="display:none;position:absolute;left:0;bottom:100%;margin-bottom:4px;background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:6px;min-width:100%;z-index:100;box-shadow:0 -4px 20px rgba(0,0,0,.3)">
          <button onclick="abrirCuenta()" class="pm-item">Administrar cuenta</button>
          <button onclick="abrirConfig()" class="pm-item">Configuración</button>
          ${CURRENT_USER.rol==='admin'?'<button onclick="abrirAdmin()" class="pm-item" style="color:var(--amber)">Panel de admin</button>':''}
          <div style="border-top:1px solid var(--border);margin:4px 0"></div>
          <button onclick="cerrarSesion()" class="pm-item" style="color:var(--red)">Cerrar sesión</button>
        </div>
      </div>`;
  }
}

// ── PROFILE MENUS ─────────────────────────────────────
function toggleProfileMenu(){
  const menu = id('profile-menu');
  menu.style.display = menu.style.display==='none'?'block':'none';
  const sbMenu = id('sb-profile-menu');
  if(sbMenu) sbMenu.style.display='none';
}
function toggleSbProfileMenu(){
  const menu = id('sb-profile-menu');
  if(menu) menu.style.display = menu.style.display==='none'?'block':'none';
  const hdrMenu = id('profile-menu');
  if(hdrMenu) hdrMenu.style.display='none';
}
document.addEventListener('click', e=>{
  // Close both profile menus on outside click
  ['profile-menu','sb-profile-menu'].forEach(mid=>{
    const menu = id(mid);
    if(!menu) return;
    const triggers = [id('profile-btn'), document.querySelector('[onclick*="toggleSbProfileMenu"]')];
    const inside = triggers.some(t=>t&&t.contains(e.target)) || menu.contains(e.target);
    if(!inside) menu.style.display='none';
  });
});

// ── ADMINISTRAR CUENTA ─────────────────────────────────
function abrirCuenta(){
  openModal('m-cuenta');
  if(CURRENT_USER){
    id('cuenta-nombre').value = CURRENT_USER.nombre||'';
    id('cuenta-apellido').value = CURRENT_USER.apellido||'';
    id('cuenta-nacimiento').value = CURRENT_USER.nacimiento||'';
  }
}
async function guardarCuenta(){
  if(!CURRENT_USER) return;
  const nombre = id('cuenta-nombre').value.trim();
  const apellido = id('cuenta-apellido').value.trim();
  const nacimiento = id('cuenta-nacimiento').value;
  const pass = id('cuenta-pass').value;
  const pass2 = id('cuenta-pass2').value;
  if(pass && pass!==pass2){ alert('Las contraseñas no coinciden'); return; }
  const users = await getUsers();
  const idx = users.findIndex(u=>u.id===CURRENT_USER.id);
  if(idx<0) return;
  users[idx].nombre = nombre;
  users[idx].apellido = apellido;
  users[idx].nacimiento = nacimiento;
  if(pass) users[idx].pass = hashPass(pass);
  await saveUserDB(users[idx]);
  _usersCache = users;
  CURRENT_USER = users[idx];
  mostrarApp();
  id('cuenta-pass').value=''; id('cuenta-pass2').value='';
  closeModal('m-cuenta');
  alert('¡Datos actualizados correctamente!');
}

// ── ADMIN PANEL ─────────────────────────────────────
async function crearUsuario(){
  if(!CURRENT_USER||CURRENT_USER.rol!=='admin') return;
  const username = id('adm-user').value.trim().toLowerCase();
  const pass = id('adm-pass').value;
  const nombre = id('adm-nombre').value.trim();
  const apellido = id('adm-apellido').value.trim();
  const rol = id('adm-rol').value;
  if(!username||!pass){ alert('Usuario y contraseña requeridos'); return; }
  const users = await getUsers();
  if(users.some(u=>u.username.toLowerCase()===username)){ alert('Ese usuario ya existe'); return; }
  const newUser = {
    id:'user-'+Date.now(), username, pass:hashPass(pass),
    nombre, apellido, rol, nacimiento:'', activo:true,
    creadoEl:new Date().toISOString()
  };
  _usersCache.push(newUser);
  await saveUserDB(newUser);
  id('adm-user').value=''; id('adm-pass').value='';
  id('adm-nombre').value=''; id('adm-apellido').value='';
  renderAdminUsers();
}
async function renderAdminUsers(){
  const el = id('adm-users-list');
  if(!el) return;
  const users = await getUsers();
  el.innerHTML = users.map((u,i)=>{
    const esSelf = CURRENT_USER && u.id===CURRENT_USER.id;
    const pass = unhashPass(u.pass);
    return `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:10px;background:var(--bg3);border-radius:8px;margin-bottom:6px">
      <div style="flex:1;min-width:140px">
        <div style="font-size:12px;font-weight:600;color:var(--text)">${u.nombre||''} ${u.apellido||''} <span style="color:var(--text3);font-weight:400">@${u.username}</span></div>
        <div style="font-size:10px;color:${u.activo?'var(--green)':'var(--red)'}"> ${u.activo?'Activo':'Deshabilitado'} · ${u.rol==='admin'?'Admin':'Usuario'}</div>
        <div style="font-size:10px;color:var(--text3);margin-top:2px">Pass: <span style="font-family:var(--mono);color:var(--text2);user-select:all">${pass}</span></div>
      </div>
      <div style="display:flex;gap:4px;flex-shrink:0">
      ${!esSelf?`
        <button onclick="toggleUsuario(${i})" style="font-size:10px;padding:4px 8px;border-radius:6px;border:1px solid var(--border);background:transparent;color:${u.activo?'var(--amber)':'var(--green)'};cursor:pointer;font-family:var(--font)">${u.activo?'Deshab.':'Activar'}</button>
        <select onchange="changeRolUsuario(${i},this.value)" style="font-size:10px;padding:4px 6px;border-radius:6px;border:1px solid var(--border);background:var(--bg4);color:var(--text);font-family:var(--font)">
          <option value="user" ${u.rol==='user'?'selected':''}>User</option>
          <option value="admin" ${u.rol==='admin'?'selected':''}>Admin</option>
        </select>
        <button onclick="resetPassUsuario(${i})" style="font-size:10px;padding:4px 8px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--blue);cursor:pointer;font-family:var(--font)">Pass</button>
        <button onclick="deleteUsuario(${i})" style="font-size:10px;padding:4px 8px;border-radius:6px;border:1px solid rgba(248,113,113,.3);background:transparent;color:var(--red);cursor:pointer;font-family:var(--font)">×</button>
      `:'<span style="font-size:10px;color:var(--text3)">Tú</span>'}
      </div>
    </div>`;
  }).join('');
}
async function toggleUsuario(i){
  const users = await getUsers();
  users[i].activo = !users[i].activo;
  await saveUserDB(users[i]); renderAdminUsers();
}
async function changeRolUsuario(i,rol){
  const users = await getUsers();
  users[i].rol = rol;
  await saveUserDB(users[i]); renderAdminUsers();
}
async function resetPassUsuario(i){
  const users = await getUsers();
  const newPass = prompt('Nueva contraseña para @'+users[i].username+':');
  if(!newPass) return;
  users[i].pass = hashPass(newPass);
  await saveUserDB(users[i]); alert('Contraseña actualizada');
}
async function deleteUsuario(i){
  const users = await getUsers();
  const u = users[i];
  if(!confirm(`¿Eliminar a @${u.username}? Se perderán todos sus datos.`)) return;
  await deleteUserDB(u.id);
  _usersCache.splice(i,1);
  renderAdminUsers();
}
function abrirAdmin(){
  if(!CURRENT_USER||CURRENT_USER.rol!=='admin') return;
  openModal('m-admin');
  renderAdminUsers();
  // Close all sections initially
  document.querySelectorAll('#m-admin .cfg-section').forEach(s=>{
    s.classList.remove('open');
    const body = s.querySelector('.cfg-section-body');
    if(body) body.style.display='none';
  });
}

// ═══════════════════════════════════════════════════════

(async function init(){
  // Aplicar tema guardado en caché local INMEDIATAMENTE para evitar flash
  const sessionId = localStorage.getItem('mf_session');
  if(sessionId){
    const cachedData = localStorage.getItem('finanzas_'+sessionId);
    if(cachedData){
      try{
        const cached = JSON.parse(cachedData);
        if(cached.tema && window.aplicarTema) aplicarTema(cached.tema);
        else if(cached.tema){
          // aplicarTema aún no existe, aplicar clase directo
          document.body.classList.remove('theme-oscuro','theme-claro');
          if(cached.tema==='oscuro') document.body.classList.add('theme-oscuro');
          else if(cached.tema==='claro') document.body.classList.add('theme-claro');
        }
      }catch(e){}
    }
  }

  // Inicializar usuarios (crea admin por defecto si no existen)
  await initUsers();

  // Intentar restaurar sesión
  if(sessionId){
    const users = await getUsers();
    const user = users.find(u=>u.id===sessionId && u.activo);
    if(user){
      UID = user.id;
      CURRENT_USER = user;
      registrarSessionListeners();
      mostrarApp();
      cargarDatosUsuario();

      // Autosave silencioso a Supabase cada 10 segundos
      setInterval(()=>{ if(UID) saveConfigDB().catch(console.warn); }, 10000);

      // Timer cambio de periodo cada 60s
      setInterval(()=>{
        updateDates();
        const p = PERIODOS[S.periodoIdx];
        const hoy = new Date(); hoy.setHours(0,0,0,0);
        if(p && hoy > p.fin && !S.historial.some(h=>h.periodo===p.lbl)){
          S.historial.push(crearSnapshot(true));
          S.extras=[]; S.movimientos=[];
          S.periodoIdx=0; PERIODOS=calcPeriodosDesdeHoy();
          S.ultimoPeriodoLabel=PERIODOS[0]?PERIODOS[0].lbl:'';
          save(); renderAll();
        }
      }, 60000);

      return;
    }
  }

  // No hay sesión — mostrar login
  mostrarPantallaLogin();
})();
