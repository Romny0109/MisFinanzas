// ═══════════════════════════════════════════════════════
// SUPABASE CONFIG
// ═══════════════════════════════════════════════════════
const SUPA_URL = 'https://hfoytfqtbuwnsxuiydgt.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhmb3l0ZnF0YnV3bnN4dWl5ZGd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MDQ1OTksImV4cCI6MjA5MDA4MDU5OX0.NKrKIW0Bl8rxZSCQDWhTzrV580ycYBtMbyACq2Y_e3U';
const supa = supabase.createClient(SUPA_URL, SUPA_KEY);
let UID = null;
let CURRENT_USER = null;

// ═══════════════════════════════════════════════════════
// HASH SEGURO — SHA-256 + salt único por usuario
// ═══════════════════════════════════════════════════════
// El hash es UNA VÍA: no se puede revertir. Distinto de btoa() que era
// solo encoding y se desencriptaba con atob().
// Cada usuario tiene su propio salt aleatorio, así dos personas con el
// mismo password tienen hashes distintos. Esto bloquea ataques de
// rainbow tables.

async function _sha256(str){
  const buf = new TextEncoder().encode(str);
  const hashBuf = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2,'0'))
    .join('');
}

function _randomSalt(len=16){
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2,'0')).join('');
}

// Genera un hash NUEVO (al crear usuario o cambiar password)
// Formato guardado en BD: "v2$<salt>$<hash>"
async function hashPasswordNew(password){
  const salt = _randomSalt(16);
  const hash = await _sha256(salt + ':' + password);
  return `v2$${salt}$${hash}`;
}

// Verifica si un password coincide con un hash guardado
// Soporta el formato nuevo (v2$salt$hash) y rechaza el viejo (btoa)
async function verifyPassword(password, stored){
  if(!stored) return false;
  // Formato nuevo: v2$salt$hash
  if(stored.startsWith('v2$')){
    const parts = stored.split('$');
    if(parts.length !== 3) return false;
    const [, salt, hashSaved] = parts;
    const hashCheck = await _sha256(salt + ':' + password);
    // Comparación constante (no early-exit por longitud variable)
    return _constantTimeEq(hashCheck, hashSaved);
  }
  // Formato viejo no aceptado — fuerza re-hashing externo (vía SQL)
  return false;
}

// Comparación de strings en tiempo constante (evita timing attacks)
function _constantTimeEq(a, b){
  if(a.length !== b.length) return false;
  let diff = 0;
  for(let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ═══════════════════════════════════════════════════════
// AUTH — usuarios en Supabase
// ═══════════════════════════════════════════════════════
let _usersCache = []; // caché local — solo metadata, NUNCA passwords

// Carga SOLO los datos públicos del usuario (sin password)
// El password nunca se trae al cliente — se valida solo en login
async function getUsersPublic(){
  try {
    const {data, error} = await supa
      .from('usuarios')
      .select('id,username,nombre,apellido,rol,nacimiento,activo,created_at')
      .order('created_at');
    if(error) throw error;
    _usersCache = (data||[]).map(r=>({
      id:r.id, username:r.username,
      nombre:r.nombre||'', apellido:r.apellido||'',
      rol:r.rol||'user', nacimiento:r.nacimiento||'',
      activo:r.activo!==false, creadoEl:r.created_at
    }));
  } catch(e){
    console.warn('getUsersPublic failed:', e);
  }
  return _usersCache;
}

async function saveUserMetaDB(u){
  // Guarda solo metadata (NO password)
  try {
    const payload = {
      id:u.id, username:u.username,
      nombre:u.nombre||'', apellido:u.apellido||'',
      rol:u.rol||'user', nacimiento:u.nacimiento||'',
      activo:u.activo!==false
    };
    await supa.from('usuarios').upsert(payload, {onConflict:'id'});
  } catch(e){ console.warn('saveUserMetaDB:', e); }
}

async function setUserPasswordDB(uid, plainPassword){
  // Guarda SOLO el hash en BD, nunca el password en texto
  const hashed = await hashPasswordNew(plainPassword);
  try {
    await supa.from('usuarios').update({pass:hashed}).eq('id', uid);
  } catch(e){ console.warn('setUserPasswordDB:', e); }
}

async function deleteUserDB(uid){
  try { await supa.from('usuarios').delete().eq('id', uid); }
  catch(e){ console.warn('deleteUserDB:', e); }
}

async function loginLocal(){
  const username = id('login-user').value.trim().toLowerCase();
  const pass = id('login-pass').value;
  const errEl = id('login-error');
  if(!username||!pass){
    errEl.style.display='block';
    errEl.textContent='Ingresa usuario y contraseña';
    return;
  }

  // Traer SOLO el hash del usuario específico (no la lista completa)
  // Esto minimiza la superficie de ataque: aunque alguien intercepte la
  // query, solo ve el hash de UN usuario en cada intento de login.
  let userRow;
  try {
    const {data, error} = await supa
      .from('usuarios')
      .select('id,username,pass,nombre,apellido,rol,nacimiento,activo,created_at')
      .eq('username', username)
      .maybeSingle();
    if(error) throw error;
    userRow = data;
  } catch(e){
    console.warn('login query failed:', e);
    errEl.style.display='block';
    errEl.textContent='Error de conexión. Intenta de nuevo.';
    return;
  }

  // Mensaje genérico: no revelamos si el usuario existe o no
  // (evita enumeración de usuarios por parte de un atacante)
  if(!userRow){
    errEl.style.display='block';
    errEl.textContent='Usuario o contraseña incorrectos';
    return;
  }

  // Verificar password con hash seguro
  const ok = await verifyPassword(pass, userRow.pass);
  if(!ok){
    errEl.style.display='block';
    errEl.textContent='Usuario o contraseña incorrectos';
    return;
  }

  if(!userRow.activo){
    errEl.style.display='block';
    errEl.textContent='Tu cuenta está deshabilitada. Contacta al administrador.';
    return;
  }

  errEl.style.display='none';
  // Guardamos el objeto del usuario en memoria, pero SIN el hash
  CURRENT_USER = {
    id:userRow.id, username:userRow.username,
    nombre:userRow.nombre||'', apellido:userRow.apellido||'',
    rol:userRow.rol||'user', nacimiento:userRow.nacimiento||'',
    activo:userRow.activo!==false, creadoEl:userRow.created_at
  };
  UID = userRow.id;
  localStorage.setItem('mf_session', userRow.id);
  registrarSessionListeners();
  mostrarApp();
  cargarDatosUsuario();
}

function registrarSessionListeners(){
  // Inactividad — cerrar sesión tras 15 min
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
  aplicarTema('clasico');
  document.documentElement.classList.remove('font-sz-1','font-sz-2','font-sz-3','font-sz-4');
  mostrarPantallaLogin();
}

async function cargarDatosUsuario(){
  PERIODOS = calcPeriodosDesdeHoy();
  S = {...DEF};
  if(!S.otrosGastos) S.otrosGastos = [];
  if(!S.tema) S.tema = 'clasico';
  if(!S.secciones) S.secciones = {principal:true,servicios:true,extras:true,tdc:true,msi:true,deudas:true,otros:true,ahorro:true};
  if(!S.sueldoPorPeriodo) S.sueldoPorPeriodo = {};
  try {
    await loadFromSupabase(false);
  } catch(e){
    console.warn('Supabase load failed, usando caché de respaldo:', e);
    const cache = localStorage.getItem('finanzas_'+UID);
    if(cache){
      try { S = {...DEF, ...JSON.parse(cache)}; }
      catch(_){ /* ignore */ }
    }
  }
  if(!S.otrosGastos) S.otrosGastos = [];
  if(!S.secciones) S.secciones = {principal:true,servicios:true,extras:true,tdc:true,msi:true,deudas:true,otros:true,ahorro:true};
  if(!S.sueldoPorPeriodo) S.sueldoPorPeriodo = {};
  aplicarTema(S.tema);
  aplicarSecciones();
  S.fontSize = parseInt(localStorage.getItem('mf_fontSize_'+UID))||0;
  aplicarFontSize(S.fontSize);
  PERIODOS = calcPeriodosDesdeHoy();
  if(typeof calcPeriodosDesdeHoy === 'function'){
    PERIODOS = calcPeriodosDesdeHoy();
  }

  if(typeof checkAutoGuardado === 'function'){
    try { await checkAutoGuardado(); } catch(e){ console.warn('checkAutoGuardado:', e); }
  }

  S.ultimoPeriodoLabel = (PERIODOS[S.periodoIdx] && PERIODOS[S.periodoIdx].lbl) || '';
  localStorage.setItem('finanzas_'+UID, JSON.stringify(S));
  window.renderAll();
  if(typeof mostrarOnboardingSiEsNecesario === 'function'){
    setTimeout(() => mostrarOnboardingSiEsNecesario(), 200);
  }
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
    const el = document.getElementById('sb-user-info');
    if(el) el.innerHTML = `
      <div style="position:relative;padding:8px 8px 0;border-top:1px solid var(--border);margin-top:auto">
        <button onclick="toggleSbProfileMenu(event)" style="width:100%;background:transparent;border:none;color:var(--text);cursor:pointer;text-align:left;padding:6px 8px;border-radius:6px;display:flex;align-items:center;gap:8px;font-family:var(--font)">
          <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,var(--purple),var(--blue));display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:13px">
            ${(CURRENT_USER.nombre||CURRENT_USER.username||'U')[0].toUpperCase()}
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${displayName}</div>
            <div style="font-size:10px;color:var(--text3)">@${CURRENT_USER.username}</div>
          </div>
        </button>
        <div id="sb-profile-menu" style="display:none;position:absolute;bottom:60px;left:8px;right:8px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 20px rgba(0,0,0,.3);overflow:hidden;z-index:100">
          <button onclick="abrirCuenta()" class="pm-item">Administrar cuenta</button>
          ${CURRENT_USER.rol==='admin'?'<button onclick="abrirAdmin()" class="pm-item" style="color:var(--amber)">Panel de admin</button>':''}
          <button onclick="cerrarSesion()" class="pm-item" style="color:var(--red)">Cerrar sesión</button>
        </div>
      </div>
    `;
  }
}

function toggleSbProfileMenu(e){
  if(e) e.stopPropagation();
  const sbMenu = id('sb-profile-menu');
  if(sbMenu){
    sbMenu.style.display = (sbMenu.style.display==='none'||!sbMenu.style.display)?'block':'none';
  }
  const hdrMenu = id('profile-menu');
  if(hdrMenu) hdrMenu.style.display='none';
}
document.addEventListener('click', e=>{
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
  if(pass && pass.length < 6){ alert('La contraseña debe tener al menos 6 caracteres'); return; }

  CURRENT_USER.nombre = nombre;
  CURRENT_USER.apellido = apellido;
  CURRENT_USER.nacimiento = nacimiento;
  await saveUserMetaDB(CURRENT_USER);

  if(pass){
    await setUserPasswordDB(CURRENT_USER.id, pass);
  }

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
  if(pass.length < 6){ alert('La contraseña debe tener al menos 6 caracteres'); return; }

  const existing = await supa.from('usuarios').select('id').eq('username', username).maybeSingle();
  if(existing.data){ alert('Ese usuario ya existe'); return; }

  const newId = 'user-'+Date.now();
  const hashedPass = await hashPasswordNew(pass);
  try {
    await supa.from('usuarios').insert({
      id:newId, username, pass:hashedPass,
      nombre, apellido, rol, nacimiento:'', activo:true
    });
    id('adm-user').value=''; id('adm-pass').value='';
    id('adm-nombre').value=''; id('adm-apellido').value='';
    renderAdminUsers();
    alert('Usuario creado correctamente.');
  } catch(e){
    console.error('crearUsuario error:', e);
    alert('Error al crear usuario. Revisa la consola.');
  }
}
async function renderAdminUsers(){
  const el = id('adm-users-list');
  if(!el) return;
  const users = await getUsersPublic();
  el.innerHTML = users.map((u,i)=>{
    const esSelf = CURRENT_USER && u.id===CURRENT_USER.id;
    return `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:10px;background:var(--bg3);border-radius:8px;margin-bottom:6px">
      <div style="flex:1;min-width:140px">
        <div style="font-size:12px;font-weight:600;color:var(--text)">${u.nombre||''} ${u.apellido||''} <span style="color:var(--text3);font-weight:400">@${u.username}</span></div>
        <div style="font-size:10px;color:${u.activo?'var(--green)':'var(--red)'}"> ${u.activo?'Activo':'Deshabilitado'} · ${u.rol==='admin'?'Admin':'Usuario'}</div>
        <div style="font-size:10px;color:var(--text3);margin-top:2px">Contraseña: <span style="font-family:var(--mono);color:var(--text3);font-style:italic">(oculta — usa "Pass" para resetear)</span></div>
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
  if(!CURRENT_USER||CURRENT_USER.rol!=='admin') return;
  const users = await getUsersPublic();
  users[i].activo = !users[i].activo;
  await saveUserMetaDB(users[i]); renderAdminUsers();
}
async function changeRolUsuario(i,rol){
  if(!CURRENT_USER||CURRENT_USER.rol!=='admin') return;
  const users = await getUsersPublic();
  users[i].rol = rol;
  await saveUserMetaDB(users[i]); renderAdminUsers();
}
async function resetPassUsuario(i){
  if(!CURRENT_USER||CURRENT_USER.rol!=='admin') return;
  const users = await getUsersPublic();
  const newPass = prompt('Nueva contraseña para @'+users[i].username+' (mín. 6 caracteres):');
  if(!newPass) return;
  if(newPass.length < 6){ alert('La contraseña debe tener al menos 6 caracteres'); return; }
  await setUserPasswordDB(users[i].id, newPass);
  alert('Contraseña actualizada. Avisa al usuario su nueva contraseña.');
}
async function deleteUsuario(i){
  if(!CURRENT_USER||CURRENT_USER.rol!=='admin') return;
  const users = await getUsersPublic();
  const u = users[i];
  if(!confirm(`¿Eliminar a @${u.username}? Se perderán TODOS sus datos en la base de datos.`)) return;
  if(!confirm(`Confirmar eliminación de @${u.username}. Esta acción NO se puede deshacer.`)) return;

  const tablas = [
    'config', 'servicios', 'extras', 'tarjetas', 'movimientos',
    'msis', 'deudas', 'historial', 'notificaciones_estado'
  ];
  for(const t of tablas){
    try { await supa.from(t).delete().eq('user_id', u.id); }
    catch(e){ console.warn(`delete from ${t}:`, e); }
  }
  await deleteUserDB(u.id);
  _usersCache.splice(i,1);
  renderAdminUsers();
  alert(`Usuario @${u.username} eliminado completamente.`);
}
function abrirAdmin(){
  if(!CURRENT_USER||CURRENT_USER.rol!=='admin') return;
  openModal('m-admin');
  renderAdminUsers();
  document.querySelectorAll('#m-admin .cfg-section').forEach(s=>{
    s.classList.remove('open');
    const body = s.querySelector('.cfg-section-body');
    if(body) body.style.display='none';
  });
}

// ═══════════════════════════════════════════════════════
// INICIALIZACIÓN
// ═══════════════════════════════════════════════════════
// NOTA: Ya NO se crea ningún admin por defecto desde el código.
// Esto evita exponer credenciales en el cliente. El primer admin
// debe crearse manualmente en Supabase (ver instrucciones).

(async function init(){
  // Intentar restaurar sesión
  const sessionId = localStorage.getItem('mf_session');
  if(sessionId){
    try {
      const {data:userRow} = await supa
        .from('usuarios')
        .select('id,username,nombre,apellido,rol,nacimiento,activo,created_at')
        .eq('id', sessionId)
        .maybeSingle();
      if(userRow && userRow.activo){
        CURRENT_USER = {
          id:userRow.id, username:userRow.username,
          nombre:userRow.nombre||'', apellido:userRow.apellido||'',
          rol:userRow.rol||'user', nacimiento:userRow.nacimiento||'',
          activo:userRow.activo!==false, creadoEl:userRow.created_at
        };
        UID = userRow.id;
        registrarSessionListeners();
        mostrarApp();
        cargarDatosUsuario();

        // Autosave a Supabase cada 10s
        setInterval(()=>{ if(UID) saveConfigDB().catch(console.warn); }, 10000);
        // Timer cambio de periodo
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
    } catch(e){
      console.warn('restore session failed:', e);
    }
    localStorage.removeItem('mf_session');
  }

  aplicarTema('clasico');
  mostrarPantallaLogin();
})();
