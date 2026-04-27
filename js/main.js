// ESTADO GLOBAL (cache local para rendimiento)
// ═══════════════════════════════════════════════════════
// Normaliza el día de la semana al formato canónico ('Viernes', 'Miércoles', etc.)
// Acepta 'VIERNES', 'viernes', 'Viernes', 'MIERCOLES', 'miercoles', etc.
function normalizarDiaSem(s){
  if(!s || typeof s !== 'string') return 'Viernes';
  const map = {
    'DOMINGO':'Domingo', 'LUNES':'Lunes', 'MARTES':'Martes',
    'MIERCOLES':'Miércoles', 'MIÉRCOLES':'Miércoles',
    'JUEVES':'Jueves', 'VIERNES':'Viernes',
    'SABADO':'Sábado', 'SÁBADO':'Sábado'
  };
  const upper = s.toUpperCase();
  return map[upper] || s; // Si ya viene en formato correcto, devuelve igual
}

const DEF = {
  modo:'QUINCENAL', diaSem:'Viernes', tema:'clasico',
  secciones:{principal:true,servicios:true,extras:true,tdc:true,msi:true,deudas:true,otros:true,ahorro:true},
  periodoIdx:0, sueldo:0, sueldoFijo:true, sueldoPorPeriodo:{},
  ahoModo:'pct', ahoPct:10, ahoFijo:0, ahoMonto:0,
  servicios:[], extras:[], tarjetas:[], movimientos:[], msis:[], deudas:[],
  otrosGastos:[],
  fontSize:0,
  historial:[], periodoCerrado:false
};
let S = {...DEF}; // Se carga desde Supabase en init()
let periodosExtra = 0; // Periodos extra agregados manualmente

// ── LOADING OVERLAY ──────────────────────────────────────
function showLoading(msg='Sincronizando...'){
  let el = document.getElementById('loading-overlay');
  if(!el){
    el = document.createElement('div');
    el.id='loading-overlay';
    el.style.cssText='position:fixed;inset:0;background:rgba(13,17,23,.85);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;font-family:var(--font)';
    el.innerHTML=`<div style="width:36px;height:36px;border:3px solid var(--border);border-top-color:var(--blue);border-radius:50%;animation:spin .7s linear infinite"></div><div id="loading-msg" style="font-size:14px;color:var(--text2)"></div>`;
    const style=document.createElement('style');
    style.textContent='@keyframes spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(style);
    document.body.appendChild(el);
  }
  document.getElementById('loading-msg').textContent=msg;
  el.style.display='flex';
}
function hideLoading(){ const el=document.getElementById('loading-overlay'); if(el) el.style.display='none'; }

// ── MODO TEST: todas las funciones de DB son no-ops ────
// Save solo en localStorage
async function save(){
  // Track current period label for auto-guardado on next init
  const p = PERIODOS[S.periodoIdx];
  if(p) S.ultimoPeriodoLabel = p.lbl;
  localStorage.setItem('finanzas_'+UID, JSON.stringify(S));
  // Persist config to Supabase
  saveConfigDB().catch(console.warn);
}

// ── CARGAR DESDE SUPABASE ─────────────────────────────────
async function loadFromSupabase(silencioso=false){
  if(!silencioso) showLoading('Cargando tus datos...');
  
  // Cargar cada tabla por separado para que si una falla, las demás sí carguen
  // CONFIG
  try {
    const {data, error} = await supa.from('config').select('*').eq('user_id', UID).maybeSingle();
    if(data && !error){
      const c = data;
      S.modo = c.modo || 'QUINCENAL';
      // Normalizar día: la BD puede tener 'VIERNES' (legacy) o 'Viernes'.
      // El código y el array diasSem usan 'Viernes' (primera letra mayúscula).
      const diaRaw = c.dia_sem || 'Viernes';
      S.diaSem = normalizarDiaSem(diaRaw);
      S.periodoIdx = 0;
      S.sueldo = parseFloat(c.sueldo) || 0;
      S.sueldoFijo = c.sueldo_fijo !== false;
      S.ahoModo = c.aho_modo || 'pct';
      S.ahoPct = parseFloat(c.aho_pct) || 10;
      S.ahoFijo = parseFloat(c.aho_fijo) || 0;
      S.ahoMonto = parseFloat(c.aho_monto) || 0;
      // Si está en modo porcentaje y aún no se ha calculado el monto,
      // calcularlo de inmediato (caso típico: cuenta nueva con default 10%)
      if(S.ahoModo === 'pct' && S.sueldo > 0){
        const baseCalc = Math.round(S.sueldo * (S.ahoPct||10) / 100);
        if(!S.ahoMonto || S.ahoMonto === 0) S.ahoMonto = baseCalc;
      }
      S.periodoCerrado = c.periodo_cerrado || false;
      if(c.tema) S.tema = c.tema;
      if(c.zona_horaria) S.zonaHoraria = c.zona_horaria;
      if(c.secciones) try { S.secciones = JSON.parse(c.secciones); } catch(e){}
      if(c.sueldo_por_periodo) try { S.sueldoPorPeriodo = JSON.parse(c.sueldo_por_periodo); } catch(e){}
      if(c.otros_gastos) try { S.otrosGastos = JSON.parse(c.otros_gastos); } catch(e){}
      if(c.sexo) S.sexo = c.sexo;
      // IMPORTANTE: asignar SIEMPRE (incluso si viene false). La BD es la verdad.
      S.onboardingDone = c.onboarding_done === true;
    } else {
      // No hay fila en config para este usuario → es nuevo, no completó onboarding
      S.onboardingDone = false;
    }
    if(error) console.warn('config load error:', error.message);
  } catch(e){ console.warn('config load fail:', e); }

  // SERVICIOS
  try {
    const {data} = await supa.from('servicios').select('*').eq('user_id', UID).order('created_at');
    if(data) S.servicios = data.map(r=>({
      id:r.id, concepto:r.concepto, monto:parseFloat(r.monto),
      cadacuanto:r.cadacuanto||1, fecha:r.fecha||'',
      diaPago:r.dia_pago||1, fechaAgregado:r.fecha||'',
      proxPago:r.prox_pago||'',
      freqSvc: r.freq_svc || 'MENSUAL',
      diaSemana: r.dia_semana || '',
      periodoAgregadoLbl: r.periodo_agregado_lbl || ''
    }));
  } catch(e){ console.warn('servicios load fail:', e); }

  // EXTRAS
  try {
    const {data} = await supa.from('extras').select('*').eq('user_id', UID).order('created_at');
    if(data) S.extras = data
      .filter(r=>r.periodo_idx===S.periodoIdx)
      .map(r=>({
        id:r.id, concepto:r.concepto, monto:parseFloat(r.monto),
        desc:r.descripcion||'', fecha:r.fecha||''
      }));
  } catch(e){ console.warn('extras load fail:', e); }

  // TARJETAS
  try {
    const {data} = await supa.from('tarjetas').select('*').eq('user_id', UID).order('created_at');
    if(data) S.tarjetas = data.map(r=>({
      id:r.id, nombre:r.nombre, corte:r.corte||5,
      pago:r.pago||25, modo:r.modo||'DÍA DEL MES', color:r.color||'tdc-b'
    }));
  } catch(e){ console.warn('tarjetas load fail:', e); }

  // MOVIMIENTOS
  try {
    const {data} = await supa.from('movimientos').select('*').eq('user_id', UID).order('created_at');
    if(data) S.movimientos = data
      .map(r=>({
        id:r.id, tarjeta:r.tarjeta, concepto:r.concepto,
        monto:parseFloat(r.monto), fecha:r.fecha||'',
        incluir:r.incluir||'SI', periodo_idx:r.periodo_idx
      }))
      .filter(r=>r.periodo_idx===S.periodoIdx);
  } catch(e){ console.warn('movimientos load fail:', e); }

  // MSIS
  try {
    const {data} = await supa.from('msis').select('*').eq('user_id', UID).order('created_at');
    if(data) S.msis = data.map(r=>({
      id:r.id, tarjeta:r.tarjeta, concepto:r.concepto,
      monto:parseFloat(r.monto)||0, plazo:r.plazo||12,
      pago:parseFloat(r.pago)||0, incluir:r.incluir||'SI',
      pagoActual:r.pago_actual||1, saldoPendiente:parseFloat(r.saldo_pendiente)||0
    }));
  } catch(e){ console.warn('msis load fail:', e); }

  // DEUDAS
  try {
    const {data} = await supa.from('deudas').select('*').eq('user_id', UID).order('created_at');
    if(data) S.deudas = data.map(r=>({
      id:r.id, concepto:r.concepto, monto:parseFloat(r.monto)||0,
      plazo:r.plazo||12, pago:parseFloat(r.pago)||0,
      freq:r.freq||'MENSUAL',
      ini:r.ini||'', adq:r.adq||'',
      fechaAgregado: r.fecha_agregado || r.ini || '',
      // Campos tanda (opcionales)
      tipo: r.tipo || 'normal',
      numAsignado: r.num_asignado || null
    }));
  } catch(e){ console.warn('deudas load fail:', e); }

  // HISTORIAL
  try {
    const {data} = await supa.from('historial').select('*').eq('user_id', UID).order('guardado_el');
    if(data) S.historial = data.map(r=>({
      id:r.id, periodo:r.periodo, ini:r.ini, fin:r.fin,
      sueldo:parseFloat(r.sueldo)||0, extras:parseFloat(r.extras)||0,
      totalPerc:parseFloat(r.total_perc)||0, totalDedu:parseFloat(r.total_dedu)||0,
      disponible:parseFloat(r.disponible)||0, ahorro:parseFloat(r.ahorro)||0,
      guardadoEl:r.guardado_el
    }));
  } catch(e){ console.warn('historial load fail:', e); }

  localStorage.setItem('finanzas_'+UID, JSON.stringify(S));
  if(typeof aplicarTema === 'function') aplicarTema(S.tema || 'clasico');
  hideLoading();
}

// ── SAVE COLLECTIONS ─────────────────────────────────────
// ── DB FUNCTIONS: Supabase persistence ────────────────

async function saveConfigDB(){
  if(!UID) return;
  try {
    const payload = {
      user_id: UID, modo: S.modo, dia_sem: S.diaSem,
      sueldo: S.sueldo, sueldo_fijo: S.sueldoFijo,
      aho_modo: S.ahoModo, aho_pct: S.ahoPct,
      aho_fijo: S.ahoFijo, aho_monto: S.ahoMonto,
      periodo_cerrado: S.periodoCerrado,
      tema: S.tema || 'clasico',
      secciones: JSON.stringify(S.secciones || {}),
      zona_horaria: S.zonaHoraria || '',
      sueldo_por_periodo: JSON.stringify(S.sueldoPorPeriodo || {}),
      otros_gastos: JSON.stringify(S.otrosGastos || []),
      sexo: S.sexo || null,
      onboarding_done: !!S.onboardingDone,
      username: (typeof CURRENT_USER !== 'undefined' && CURRENT_USER) ? CURRENT_USER.username : null
    };
    const {error} = await supa.from('config').upsert(payload, {onConflict:'user_id'});
    if(error){
      console.error('❌ saveConfigDB error:', error.message, error.details);
      // Si falla por columnas faltantes, intentar solo con campos base
      const base = {
        user_id: UID, modo: S.modo, dia_sem: S.diaSem,
        sueldo: S.sueldo, sueldo_fijo: S.sueldoFijo,
        aho_modo: S.ahoModo, aho_pct: S.ahoPct,
        aho_fijo: S.ahoFijo, aho_monto: S.ahoMonto,
        periodo_cerrado: S.periodoCerrado
      };
      const {error:e2} = await supa.from('config').upsert(base, {onConflict:'user_id'});
      if(e2) console.error('❌ saveConfigDB fallback also failed:', e2.message);
    }
  } catch(e){ console.error('❌ saveConfigDB exception:', e); }
}

async function saveSvc(s){
  try {
    const {data} = await supa.from('servicios').insert({
      user_id: UID, concepto: s.concepto, monto: s.monto,
      cadacuanto: s.cadacuanto||1, fecha: s.fechaAgregado||'',
      dia_pago: s.diaPago||1, prox_pago: s.proxPago||'',
      freq_svc: s.freqSvc || 'MENSUAL',
      dia_semana: s.diaSemana || '',
      periodo_agregado_lbl: s.periodoAgregadoLbl || ''
    }).select().single();
    if(data) s.id = data.id;
  } catch(e){ console.warn('saveSvc:', e); }
}
async function delSvcDB(sid){
  try { await supa.from('servicios').delete().eq('id', sid); }
  catch(e){ console.warn('delSvcDB:', e); }
}

async function saveExt(e){
  try {
    const {data} = await supa.from('extras').insert({
      user_id: UID, concepto: e.concepto, monto: e.monto,
      descripcion: e.desc||'', fecha: e.fecha||'',
      periodo_idx: S.periodoIdx
    }).select().single();
    if(data) e.id = data.id;
  } catch(er){ console.warn('saveExt:', er); }
}
async function delExtDB(eid){
  try { await supa.from('extras').delete().eq('id', eid); }
  catch(e){ console.warn('delExtDB:', e); }
}

async function saveTar(t){
  try {
    const {data} = await supa.from('tarjetas').insert({
      user_id: UID, nombre: t.nombre, corte: t.corte,
      pago: t.pago, modo: t.modo, color: t.color
    }).select().single();
    if(data) t.id = data.id;
  } catch(e){ console.warn('saveTar:', e); }
}
async function delTarDB(tid){
  try { await supa.from('tarjetas').delete().eq('id', tid); }
  catch(e){ console.warn('delTarDB:', e); }
}

async function saveMov(m){
  try {
    const {data} = await supa.from('movimientos').insert({
      user_id: UID, tarjeta: m.tarjeta, concepto: m.concepto,
      monto: m.monto, fecha: m.fecha||'', incluir: m.incluir||'SI',
      periodo_idx: S.periodoIdx
    }).select().single();
    if(data) m.id = data.id;
  } catch(e){ console.warn('saveMov:', e); }
}
async function delMovDB(mid){
  try { await supa.from('movimientos').delete().eq('id', mid); }
  catch(e){ console.warn('delMovDB:', e); }
}
async function updateMovDB(m){
  if(!m.id) return;
  try {
    await supa.from('movimientos').update({
      incluir: m.incluir, concepto: m.concepto,
      monto: m.monto, fecha: m.fecha||''
    }).eq('id', m.id);
  } catch(e){ console.warn('updateMovDB:', e); }
}

async function saveMsiDB(m){
  try {
    const {data} = await supa.from('msis').insert({
      user_id: UID, tarjeta: m.tarjeta, concepto: m.concepto,
      monto: m.monto, plazo: m.plazo, pago: m.pago,
      incluir: m.incluir||'SI', pago_actual: m.pagoActual||1,
      saldo_pendiente: m.saldoPendiente||0
    }).select().single();
    if(data) m.id = data.id;
  } catch(e){ console.warn('saveMsiDB:', e); }
}
async function delMsiDB(mid){
  try { await supa.from('msis').delete().eq('id', mid); }
  catch(e){ console.warn('delMsiDB:', e); }
}
async function updateMsiDB(m){
  if(!m.id) return;
  try {
    await supa.from('msis').update({
      incluir: m.incluir, pago_actual: m.pagoActual,
      saldo_pendiente: m.saldoPendiente
    }).eq('id', m.id);
  } catch(e){ console.warn('updateMsiDB:', e); }
}

async function saveDeuDB(d){
  try {
    const {data} = await supa.from('deudas').insert({
      user_id: UID, concepto: d.concepto, monto: d.monto,
      plazo: d.plazo, pago: d.pago, freq: d.freq,
      ini: d.ini, adq: d.adq||'',
      fecha_agregado: d.fechaAgregado||todayStr(),
      tipo: d.tipo||'normal',
      num_asignado: d.numAsignado||null
    }).select().single();
    if(data) d.id = data.id;
  } catch(e){ console.warn('saveDeuDB:', e); }
}
async function delDeuDB(did){
  try { await supa.from('deudas').delete().eq('id', did); }
  catch(e){ console.warn('delDeuDB:', e); }
}

async function saveHistDB(h){
  try {
    const {data} = await supa.from('historial').insert({
      user_id: UID, periodo: h.periodo, ini: h.ini, fin: h.fin,
      sueldo: h.sueldo, extras: h.extras,
      total_perc: h.totalPerc, total_dedu: h.totalDedu,
      disponible: h.disponible, ahorro: h.ahorro,
      guardado_el: new Date().toISOString()
    }).select().single();
    if(data) h.id = data.id;
  } catch(e){ console.warn('saveHistDB:', e); }
}

// ═══════════════════════════════════════════════════════
// PERIODOS
// ═══════════════════════════════════════════════════════
const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

function calcPeriodosDesdeHoy(){
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const periodos = [];
  // Generar suficientes: actual + 4 base + extra + margen
  const totalNecesarios = 4 + periodosExtra + 5;

  if(S.modo === 'QUINCENAL'){
    let y = hoy.getFullYear(), m = hoy.getMonth();
    let half = hoy.getDate() <= 15 ? 1 : 2;
    for(let i=0; i<totalNecesarios; i++){
      const last = new Date(y, m+1, 0).getDate();
      let ini, fin, lbl;
      if(half===1){
        ini = new Date(y,m,1); fin = new Date(y,m,15);
        lbl = `1-15 ${MESES[m]} ${y}`;
      } else {
        ini = new Date(y,m,16); fin = new Date(y,m,last);
        lbl = `16-${last} ${MESES[m]} ${y}`;
      }
      periodos.push({lbl, ini, fin});
      half++; if(half>2){ half=1; m++; if(m>11){m=0;y++;} }
    }
  } else {
    // SEMANAL: el día configurado (día de cobro) es el ÚLTIMO día del periodo
    // Ej: si cobras miércoles → periodo va de jueves a miércoles
    const diasSem=['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
    const diaIdx = diasSem.indexOf(S.diaSem||'Viernes');
    // Encontrar el PRÓXIMO día de cobro (hoy o adelante) = fin del periodo actual
    let finActual = new Date(hoy);
    let diff = diaIdx - finActual.getDay();
    if(diff < 0) diff += 7;
    finActual.setDate(finActual.getDate() + diff);
    // ini del periodo actual = fin - 6
    let iniActual = new Date(finActual); iniActual.setDate(finActual.getDate() - 6);
    for(let i=0; i<totalNecesarios; i++){
      const ini = new Date(iniActual); ini.setDate(iniActual.getDate() + i*7);
      const fin = new Date(ini); fin.setDate(ini.getDate()+6);
      const lbl = `${ini.getDate()} ${MESES[ini.getMonth()]} — ${fin.getDate()} ${MESES[fin.getMonth()]} ${fin.getFullYear()}`;
      periodos.push({lbl, ini, fin});
    }
  }
  return periodos;
}

let PERIODOS = calcPeriodosDesdeHoy();

// El periodo actual es siempre el índice 0 ya que generamos desde hoy
function calcPeriodoActualIdx(){
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  for(let i=0; i<PERIODOS.length; i++){
    if(hoy >= PERIODOS[i].ini && hoy <= PERIODOS[i].fin) return i;
  }
  return 0;
}

function fmtDate(d){ return d.toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'}) }

// Offset entre periodo actual real y el que se está viendo
function getOffsetPeriodo(){
  return Math.max(0, S.periodoIdx - calcPeriodoActualIdx());
}

// Genera label de sub-periodo para MSI/deudas
// Y = quincenas/semanas hasta fecha límite de pago
// Z = número de plazo mensual (no cambia dentro del ciclo)
function subPeriodoLabel(pagoActual, fechaLimite){
  if(!fechaLimite) return null;
  const n = contarDiasCobro(fechaLimite); // total cobros en este ciclo
  const offset = getOffsetPeriodo();
  // Dentro del ciclo actual: cobro #1, #2... de n
  const cobroEnCiclo = (offset % n) + 1;
  // El plazo mensual = pagoActual + cuántos ciclos completos han pasado
  const ciclosCompletos = Math.floor(offset / n);
  const plazoMensual = pagoActual + ciclosCompletos;
  if(S.modo === 'QUINCENAL'){
    return `Quincena ${cobroEnCiclo} de ${n} · Pago mensual ${plazoMensual}`;
  } else {
    return `Semana ${cobroEnCiclo} de ${n} · Pago mensual ${plazoMensual}`;
  }
}

// ═══════════════════════════════════════════════════════
// TABS
// ═══════════════════════════════════════════════════════
function goTab(tabId, btn){
  document.querySelectorAll('.scr').forEach(s=>s.classList.remove('on'));
  document.querySelectorAll('.tab').forEach(b=>b.classList.remove('on'));
  const scr = document.getElementById('scr-'+tabId);
  if(scr) scr.classList.add('on');
  if(btn) btn.classList.add('on');
  // Update desktop topbar title
  const names={principal:'Principal',servicios:'Servicios',extras:'Extras',tdc:'TDC',msi:'MSI',deudas:'Deudas',otros:'Otros Gastos',ahorro:'Ahorro'};
  if(id('dt-section-name')) id('dt-section-name').textContent = names[tabId]||tabId;
  renderAll();
}
function goTabBtn(tabId){
  const btns = document.querySelectorAll('.tab');
  const map = {principal:0,servicios:1,extras:2,tdc:3,msi:4,deudas:5,otros:6,ahorro:7};
  goTab(tabId, btns[map[tabId]]);
}

// ═══════════════════════════════════════════════════════
// MODALES
// ═══════════════════════════════════════════════════════
function openModal(mid){
  const el = document.getElementById(mid);
  el.classList.add('open');
  // Si es onboarding, marcamos como bloqueado (no se cierra al picar fuera)
  if(mid === 'm-onboard') el.setAttribute('data-blocked','1');
  const fi = document.querySelector(`#${mid} input[type=date]`);
  if(fi && !fi.value) fi.value = todayStr();
}
function closeModal(mid){
  const el = document.getElementById(mid);
  // Onboarding bloqueado: solo se cierra desde dentro (onbFinish lo libera)
  if(mid === 'm-onboard' && el && el.getAttribute('data-blocked') === '1') return;
  if(el) el.classList.remove('open');
}
document.addEventListener('click', function(e){
  document.querySelectorAll('.overlay.open').forEach(o => {
    // Si el modal está bloqueado (onboarding sin terminar), ignorar click fuera
    if(o.getAttribute('data-blocked') === '1') return;
    if(e.target === o) o.classList.remove('open');
  });
});
function todayStr(){
  // Fecha LOCAL del usuario (no UTC), para evitar desfase de timezone
  // Ej: a las 11pm en GMT-6, toISOString() da el día siguiente en UTC.
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

// ═══════════════════════════════════════════════════════
// FORMAT
// ═══════════════════════════════════════════════════════
function mxn(n){ return '$'+Math.abs(n||0).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2}) }
function id(i){ return document.getElementById(i) }

// ═══════════════════════════════════════════════════════
// PERIODO NAVIGATION
// ═══════════════════════════════════════════════════════
// Periodos extra agregados manualmente (más allá de los 4 base)
function totalPeriodosDisponibles(){
  // Siempre: actual + 4 base + extra
  return 4 + periodosExtra;
}

function navPeriod(d){
  const actualIdx = calcPeriodoActualIdx();
  const maxIdx = actualIdx + totalPeriodosDisponibles();
  const nuevo = S.periodoIdx + d;
  if(nuevo < 0) return;
  if(nuevo > maxIdx) return;
  // Asegurarse de que PERIODOS tiene suficientes entradas
  while(PERIODOS.length <= nuevo + 1){
    PERIODOS = calcPeriodosDesdeHoy();
    break;
  }
  S.periodoIdx = nuevo;
  save();
  window.renderAll();
}

function puedeAvanzar(){
  const actualIdx = calcPeriodoActualIdx();
  return S.periodoIdx < actualIdx + totalPeriodosDisponibles();
}

function puedeBorrarPeriodo(){
  // Solo se puede borrar si hay más de 4 periodos extra
  // Y solo se borra el último
  return periodosExtra > 0;
}

function agregarPeriodo(){
  periodosExtra++;
  // Regenerar periodos para asegurar que hay suficientes
  PERIODOS = calcPeriodosDesdeHoy();
  window.renderAll();
}

function borrarPeriodo(){
  if(!puedeBorrarPeriodo()) return;
  // Si estamos en el último periodo, retroceder uno
  const actualIdx = calcPeriodoActualIdx();
  const maxIdx = actualIdx + totalPeriodosDisponibles() - 1;
  if(S.periodoIdx >= maxIdx) S.periodoIdx = Math.max(0, maxIdx - 1);
  periodosExtra--;
  save();
  window.renderAll();
}

function puedeMostrarSiguiente(){
  const actualIdx = calcPeriodoActualIdx();
  return S.periodoIdx <= actualIdx;
}

function renderPeriodoNav(){
  const actualIdx = calcPeriodoActualIdx();
  const maxIdx = actualIdx + totalPeriodosDisponibles();
  const p = PERIODOS[S.periodoIdx] || PERIODOS[PERIODOS.length-1];
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const lbl = p.lbl;

  // Sync ALL periodo labels across all sections
  const esActual = S.periodoIdx === actualIdx;
  document.querySelectorAll('[id^=pnav-lbl]').forEach(el=>{
    el.textContent=lbl;
    el.classList.toggle('pnav-activo', esActual);
  });

  // Sync ALL prev/next buttons
  document.querySelectorAll('.pnav-btn-prev').forEach(b=>b.disabled=S.periodoIdx===0);
  document.querySelectorAll('.pnav-btn-next').forEach(b=>b.disabled=!puedeAvanzar());

  // Legacy button IDs
  ['btn-prev','btn-prev-dt','btn-prev-deu'].forEach(bid=>{
    const b=id(bid); if(b) b.disabled=S.periodoIdx===0;
  });
  ['btn-next','btn-next-dt','btn-next-deu'].forEach(bid=>{
    const b=id(bid); if(b) b.disabled=!puedeAvanzar();
  });

  // +/× buttons
  document.querySelectorAll('.pnav-btn-add').forEach(b=>{
    b.style.display='';
    b.title='Agregar periodo futuro';
  });
  document.querySelectorAll('.pnav-btn-del').forEach(b=>{
    b.disabled=!puedeBorrarPeriodo();
    b.title=puedeBorrarPeriodo()?'Borrar último periodo':'Mínimo 4 periodos futuros';
  });

  // Modo labels
  document.querySelectorAll('[id^=modo-lbl]').forEach(el=>el.textContent=S.modo==='QUINCENAL'?'Quincenal':'Semanal');

  // Alerta cobro (solo en principal)
  const alertEl = id('cobro-alert');
  const txt = id('cobro-txt');
  if(alertEl && txt){
    const diasHastaIni = Math.round((p.ini - hoy)/(1000*60*60*24));
    if(hoy < p.ini){
      alertEl.className='alert pending';
      txt.textContent=`Próximo cobro en ${diasHastaIni} día${diasHastaIni===1?'':'s'} — ${fmtDate(p.ini)}`;
    } else if(hoy <= p.fin){
      alertEl.className='alert active';
      const diasRestantes = Math.round((p.fin - hoy)/(1000*60*60*24));
      txt.textContent=`Periodo activo ✓ — quedan ${diasRestantes} día${diasRestantes===1?'':'s'}`;
    } else {
      alertEl.className='alert closed';
      txt.textContent=`Periodo terminado — guárdalo para continuar`;
    }
  }

  // Banner cierre
  const banner = id('close-banner');
  if(banner){
    const esActual = S.periodoIdx === actualIdx;
    if(esActual && !S.periodoCerrado && hoy >= p.ini){
      banner.classList.add('show');
      const dias = Math.round((p.fin-hoy)/(1000*60*60*24));
      const titleEl = id('close-title');
      if(hoy > p.fin){
        // Sí terminó
        if(titleEl) titleEl.textContent = 'Periodo terminado';
        id('close-sub').textContent = `El periodo ${lbl} ya terminó. Guárdalo para avanzar.`;
      } else {
        // Sigue activo, falta para terminar
        if(titleEl) titleEl.textContent = 'Periodo activo';
        id('close-sub').textContent = `Faltan ${dias} día${dias===1?'':'s'} para que termine. Guarda cuando quieras.`;
      }
    } else {
      banner.classList.remove('show');
    }
  }

  // Info desktop
  if(id('disp-fin')) id('disp-fin').textContent = fmtDate(p.fin);
  if(id('disp-next') && S.periodoIdx < PERIODOS.length-1){
    id('disp-next').textContent = fmtDate(PERIODOS[S.periodoIdx+1].ini);
  }
  if(id('disp-ahorro')) id('disp-ahorro').textContent = mxn(S.ahoMonto||0);
  if(id('disp-ahorro-acum')){
    const acumHist = S.historial.reduce((a,h)=>a+(h.ahorro||0),0);
    id('disp-ahorro-acum').textContent = mxn(acumHist + (S.ahoMonto||0));
  }

  // Desktop topbar
  const isDesktop = window.innerWidth >= 1080;
  document.querySelectorAll('.desktop-topbar').forEach(t=>t.style.display='none');
  if(isDesktop){
    document.querySelectorAll('.scr.on .desktop-topbar').forEach(t=>t.style.display='');
  }
}

// Crea un snapshot completo del periodo actual con desglose
function crearSnapshot(auto){
  const p = PERIODOS[S.periodoIdx];
  if(!p) return null;
  return {
    periodo: p.lbl, ini: p.ini.toISOString(), fin: p.fin.toISOString(),
    sueldo: getSueldoPeriodo(), extras: calcTotalExtras(),
    totalPerc: calcTotalPerc(), totalDedu: calcTotalDedu(),
    disponible: calcDisponible(), ahorro: S.ahoMonto||0,
    guardadoEl: new Date().toISOString(),
    auto: !!auto,
    // Desglose detallado
    desglose: {
      servicios: S.servicios.map(s=>{
        const c = calcSvcEnPeriodo(s);
        return {concepto:s.concepto, monto:s.monto, cadacuanto:s.cadacuanto||1, diaPago:s.diaPago,
          pagoQuincena:c?c.pagoQuincena:0, nTotal:c?c.nTotal:1, quincenaActual:c?c.quincenaActual:1};
      }),
      deudas: S.deudas.map(d=>{
        const c = calcDeuEnPeriodo(d);
        return {concepto:d.concepto, pago:d.pago, freq:d.freq, dia:d.dia, plazo:d.plazo,
          pagoQuincena:c?c.pagoQuincena:0, plazoActual:c?c.plazoActual:1, nTotal:c?c.nTotal:1, quincenaActual:c?c.quincenaActual:1};
      }),
      msis: S.msis.map(m=>{
        const tar = S.tarjetas.find(t=>t.nombre===m.tarjeta);
        const c = tar ? calcMsiEnPeriodo(m, tar) : null;
        return {concepto:m.concepto, monto:m.monto, plazo:m.plazo, tarjeta:m.tarjeta, incluir:m.incluir,
          pagoQuincena:c?c.pagoQuincena:0, plazoActual:c?c.plazoActual:1, nTotal:c?c.nTotal:1, quincenaActual:c?c.quincenaActual:1};
      }),
      extras: S.extras.map(e=>({concepto:e.concepto, monto:e.monto, fecha:e.fecha})),
      otrosGastos: S.otrosGastos.filter(g=>gastoVisibleEnPeriodo(g)).map(g=>({concepto:g.concepto, monto:g.monto, fecha:g.fecha})),
      movimientos: S.movimientos.map(m=>({concepto:m.concepto, monto:m.monto, tarjeta:m.tarjeta, incluir:m.incluir}))
    }
  };
}

// Busca un snapshot guardado para el periodo que se está viendo
function getSnapshotActual(){
  const p = PERIODOS[S.periodoIdx];
  if(!p) return null;
  return S.historial.find(h=>h.periodo===p.lbl) || null;
}

function cerrarPeriodo(){
  if(S.periodoCerrado) return;
  const p = PERIODOS[S.periodoIdx];
  if(S.historial.some(h=>h.periodo===p.lbl)) {
    if(S.periodoIdx < PERIODOS.length-1){
      S.periodoIdx++; S.periodoCerrado=false;
      S.extras=[]; S.movimientos=[];
    }
    save(); renderAll(); return;
  }
  const snap = crearSnapshot(false);
  S.historial.push(snap);
  saveHistDB(snap).catch(console.warn);
  S.periodoCerrado = true;

  // Avanzar MSI
  S.msis = S.msis.map(m=>{
    const nuevo = Math.min((m.pagoActual||1)+1, m.plazo);
    const saldoNuevo = Math.max(0,(m.plazo-nuevo)*(m.pago||0));
    if(m.id) supa.from('msis').update({pago_actual:nuevo,saldo_pendiente:saldoNuevo}).eq('id',m.id).catch(console.warn);
    return {...m, pagoActual:nuevo, saldoPendiente:saldoNuevo};
  }).filter(m=>m.pagoActual<=m.plazo);

  // Avanzar deudas
  S.deudas = S.deudas.map(d=>{
    const nuevo=(d.pagoActual||1)+1;
    const restantes=Math.max(0,d.pagosRestantes-1);
    const saldoNuevo=Math.max(0,restantes*(d.pago||0));
    if(d.id) supa.from('deudas').update({pago_actual:nuevo,pagos_restantes:restantes,saldo_pendiente:saldoNuevo}).eq('id',d.id).catch(console.warn);
    return {...d, pagoActual:nuevo, pagosRestantes:restantes, saldoPendiente:saldoNuevo};
  });

  if(S.periodoIdx < PERIODOS.length-1){
    S.periodoIdx++;
    S.periodoCerrado = false;
    S.extras=[]; S.movimientos=[];
  }
  save(); renderAll();
}

function editarAntesCerrar(){
  id('close-banner').classList.remove('show');
}

// ═══════════════════════════════════════════════════════
// AUTO-GUARDADO — guarda periodos pasados automáticamente
// ═══════════════════════════════════════════════════════
function checkAutoGuardado(){
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const actualIdx = calcPeriodoActualIdx();
  let autoGuardados = 0;

  // Si el periodo actual real está más adelante que S.periodoIdx,
  // auto-guardar los periodos intermedios
  while(S.periodoIdx < actualIdx){
    const p = PERIODOS[S.periodoIdx];
    if(!p) break;

    // Solo guardar si no está ya en historial
    if(!S.historial.some(h => h.periodo === p.lbl)){
      const snap = {
        periodo: p.lbl,
        ini: p.ini.toISOString(),
        fin: p.fin.toISOString(),
        sueldo: getSueldoPeriodo(),
        extras: calcTotalExtras(),
        totalPerc: calcTotalPerc(),
        totalDedu: calcTotalDedu(),
        disponible: calcDisponible(),
        ahorro: S.ahoMonto||0,
        guardadoEl: new Date().toISOString(),
        auto: true
      };
      S.historial.push(snap);
      autoGuardados++;
    }

    // Avanzar al siguiente periodo
    S.periodoIdx++;
    S.periodoCerrado = false;
    S.extras = [];
    S.movimientos = [];
  }

  if(autoGuardados > 0){
    save();
    console.log(`Auto-guardado: ${autoGuardados} periodo(s) guardados automáticamente`);
  }
}

// ══════════════════════════════════════════════════════
// LÓGICA DE CICLOS TDC
// ══════════════════════════════════════════════════════

// Cuenta quincenas/semanas desde una fecha hasta fecha límite (inclusive hoy si es día de cobro)
function contarDiasCobro(fechaLimiteStr, desdeStr=null){
  const desde = desdeStr ? new Date(desdeStr+'T12:00:00') : new Date();
  desde.setHours(0,0,0,0);
  const limite = new Date(fechaLimiteStr+'T12:00:00');
  if(limite < desde) return 0;
  let count = 0;
  if(S.modo === 'QUINCENAL'){
    const d = new Date(desde);
    while(d <= limite){
      const dia = d.getDate();
      const finMes = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
      if(dia === 15 || dia === finMes) count++;
      d.setDate(d.getDate()+1);
    }
  } else {
    const diasSem=['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
    const diaIdx = diasSem.indexOf(S.diaSem||'Viernes');
    const d = new Date(desde);
    while(d <= limite){
      if(d.getDay() === diaIdx) count++;
      d.setDate(d.getDate()+1);
    }
  }
  return count;
}

// Calcula el ciclo activo de una tarjeta según la fecha REAL de hoy
// Retorna { corteIni, corteFin, limite, cicloLabel }
function cicloActualTarjeta(tar, refFecha=null){
  const ref = refFecha ? new Date(refFecha) : new Date();
  ref.setHours(0,0,0,0);
  // Helper: fecha segura para día del mes (ajusta al último día si no existe)
  function fechaSegura(y, m, dia){
    const maxD = new Date(y, m+1, 0).getDate();
    const d = new Date(y, m, Math.min(dia, maxD));
    d.setHours(0,0,0,0);
    return d;
  }
  let corteIni = fechaSegura(ref.getFullYear(), ref.getMonth(), tar.corte);
  if(corteIni > ref) corteIni = fechaSegura(ref.getFullYear(), ref.getMonth()-1, tar.corte);
  let siguienteCorte = fechaSegura(corteIni.getFullYear(), corteIni.getMonth()+1, tar.corte);
  let corteFin = new Date(siguienteCorte); corteFin.setDate(corteFin.getDate()-1);
  let limite;
  if(tar.modo === 'DÍA DEL MES'){
    limite = fechaSegura(siguienteCorte.getFullYear(), siguienteCorte.getMonth(), tar.pago);
    if(limite <= siguienteCorte) limite = fechaSegura(siguienteCorte.getFullYear(), siguienteCorte.getMonth()+1, tar.pago);
  } else {
    limite = new Date(siguienteCorte); limite.setDate(siguienteCorte.getDate()+(tar.pago||20));
  }
  return {
    corteIni, corteFin, limite,
    limiteStr: limite.toISOString().split('T')[0],
    cicloLabel: `${corteIni.toLocaleDateString('es-MX',{day:'2-digit',month:'short'})} → ${corteFin.toLocaleDateString('es-MX',{day:'2-digit',month:'short'})}`
  };
}

// Ciclo VISIBLE = ciclo anterior al activo en tiempo real (siempre HOY)
function cicloVisibleTarjeta(tar){
  const cicloActivo = cicloActualTarjeta(tar); // HOY
  function fechaSegura(y, m, dia){
    const maxD = new Date(y, m+1, 0).getDate();
    const d = new Date(y, m, Math.min(dia, maxD));
    d.setHours(0,0,0,0);
    return d;
  }
  const corteIniVisible = fechaSegura(cicloActivo.corteIni.getFullYear(), cicloActivo.corteIni.getMonth()-1, tar.corte);
  let corteFin = new Date(cicloActivo.corteIni); corteFin.setDate(corteFin.getDate()-1);
  let limiteVisible;
  if(tar.modo === 'DÍA DEL MES'){
    limiteVisible = fechaSegura(cicloActivo.corteIni.getFullYear(), cicloActivo.corteIni.getMonth(), tar.pago);
    if(limiteVisible <= cicloActivo.corteIni) limiteVisible = fechaSegura(cicloActivo.corteIni.getFullYear(), cicloActivo.corteIni.getMonth()+1, tar.pago);
  } else {
    limiteVisible = new Date(cicloActivo.corteIni); limiteVisible.setDate(cicloActivo.corteIni.getDate()+(tar.pago||20));
  }
  return {
    corteIni: corteIniVisible, corteFin,
    limite: limiteVisible,
    limiteStr: limiteVisible.toISOString().split('T')[0],
    cicloLabel: `${corteIniVisible.toLocaleDateString('es-MX',{day:'2-digit',month:'short'})} → ${corteFin.toLocaleDateString('es-MX',{day:'2-digit',month:'short'})}`
  };
}

// ═══════════════════════════════════════════════════════
// HELPERS MSI — encontrar n-ésimo día de cobro y siguiente periodo
// ═══════════════════════════════════════════════════════
function _isoStr(d){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

// Encuentra la fecha del n-ésimo día de cobro desde 'desde' (inclusive)
function findNthCobro(desde, n){
  const d = new Date(desde); d.setHours(0,0,0,0);
  let count = 0;
  if(S.modo === 'QUINCENAL'){
    for(let i=0; i<730; i++){
      const dia = d.getDate();
      const finMes = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
      if(dia === 15 || dia === finMes){ count++; if(count === n) return new Date(d); }
      d.setDate(d.getDate()+1);
    }
  } else {
    const diasSem=['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
    const diaIdx = diasSem.indexOf(S.diaSem||'Viernes');
    for(let i=0; i<730; i++){
      if(d.getDay()===diaIdx){ count++; if(count===n) return new Date(d); }
      d.setDate(d.getDate()+1);
    }
  }
  return new Date(desde);
}

// Encuentra el inicio del periodo SIGUIENTE al que contiene 'date'
function findNextPeriodStart(date){
  const d = new Date(date); d.setHours(0,0,0,0);
  if(S.modo === 'QUINCENAL'){
    return d.getDate() <= 15
      ? new Date(d.getFullYear(), d.getMonth(), 16)
      : new Date(d.getFullYear(), d.getMonth()+1, 1);
  } else {
    const diasSem=['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
    const diaIdx = diasSem.indexOf(S.diaSem||'Viernes');
    const next = new Date(d);
    next.setDate(next.getDate()+1);
    while(next.getDay() !== diaIdx) next.setDate(next.getDate()+1);
    return next;
  }
}

// Avanza al siguiente ciclo de la tarjeta
function avanzarCiclo(cicloActual, tar){
  const siguienteCorteIni = new Date(cicloActual.corteFin);
  siguienteCorteIni.setDate(siguienteCorteIni.getDate()+1);
  return cicloActualTarjeta(tar, siguienteCorteIni);
}

// ═══════════════════════════════════════════════════════
// calcMsiEnPeriodo — LÓGICA COMPLETA
// ═══════════════════════════════════════════════════════
// El plazo avanza cuando se agotan las quincenas del plazo anterior.
// Primer plazo: nTotal se cuenta desde fechaAgregado hasta el límite del ciclo de la compra.
// Segundo plazo en adelante: nTotal se cuenta desde el inicio del periodo donde arranca
// el nuevo plazo hasta el nuevo límite.
function calcMsiEnPeriodo(m, tar){
  const p = PERIODOS[S.periodoIdx];
  if(!p) return null;
  const pIni = new Date(p.ini); pIni.setHours(0,0,0,0);
  const pFin = new Date(p.fin); pFin.setHours(0,0,0,0);

  const fComp = new Date((m.fechaCompra||todayStr())+'T12:00:00'); fComp.setHours(0,0,0,0);
  const fAgre = new Date((m.fechaAgregado||todayStr())+'T12:00:00'); fAgre.setHours(0,0,0,0);

  // Ciclo de la compra (primer plazo)
  const cicloPrimero = cicloActualTarjeta(tar, fComp);

  let plazoActual = m.pagoActual || 1;
  let cicloActual = cicloPrimero;
  let desdeConteo = new Date(fAgre); // primer plazo: desde fechaAgregado
  let esPrimerContabilizado = true;

  // Iterar plazos hasta encontrar el que cubre el periodo navegado
  for(let safety = 0; safety < 300; safety++){
    const nTotal = Math.max(1, contarDiasCobro(cicloActual.limiteStr, _isoStr(desdeConteo)));

    // ¿Cuántos cobros hay ANTES del periodo navegado? (desdeConteo hasta pIni-1)
    const pIniMenos1 = new Date(pIni); pIniMenos1.setDate(pIniMenos1.getDate()-1);
    const cobrosAntes = contarDiasCobro(_isoStr(pIniMenos1), _isoStr(desdeConteo));

    if(cobrosAntes >= nTotal){
      // Este plazo se agotó ANTES del periodo navegado → avanzar plazo Y ciclo
      plazoActual++;
      if(plazoActual > m.plazo) return null; // liquidado

      // Siguiente ciclo de la tarjeta (cada plazo = un ciclo)
      cicloActual = avanzarCiclo(cicloActual, tar);

      // El nuevo plazo empieza en el periodo siguiente al que tiene la última quincena
      const ultimaQuincena = findNthCobro(desdeConteo, nTotal);
      desdeConteo = findNextPeriodStart(ultimaQuincena);
      desdeConteo.setHours(0,0,0,0);
      continue;
    }

    // El periodo navegado CAE dentro de este plazo
    // quincenaActual = cobros desde desdeConteo hasta pFin, limitado por nTotal
    const effectiveEnd = pFin < cicloActual.limite ? _isoStr(pFin) : cicloActual.limiteStr;
    const cobrosHastaFin = contarDiasCobro(effectiveEnd, _isoStr(desdeConteo));
    const quincenaActual = Math.min(nTotal, Math.max(1, cobrosHastaFin));

    const pagoMensual = (m.monto||0) / (m.plazo||1);
    const pagoQuincena = pagoMensual / nTotal;

    return { plazoActual, nTotal, quincenaActual, pagoMensual, pagoQuincena, cicloActual };
  }

  return null; // fallback
}

// Quincenas para calcTotalMsi (usa el periodo actual, no HOY)
function quincenasMsiDesdeHoy(tar, fechaCompra, fechaAgregado){
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const fComp = fechaCompra ? new Date(fechaCompra+'T12:00:00') : hoy;
  const fAgre = fechaAgregado ? new Date(fechaAgregado+'T12:00:00') : hoy;
  fComp.setHours(0,0,0,0); fAgre.setHours(0,0,0,0);
  const ciclo = cicloActualTarjeta(tar, fComp);
  const desde = fAgre > hoy ? hoy : fAgre;
  return Math.max(1, contarDiasCobro(ciclo.limiteStr, _isoStr(desde)));
}

// ═══════════════════════════════════════════════════════
// calcDeuSemanalOQuincenal — Nueva lógica para SEMANAL y QUINCENAL
// ═══════════════════════════════════════════════════════
function calcDeuSemanalOQuincenal(d){
  const p = PERIODOS[S.periodoIdx];
  if(!p || !d.ini) return null;
  const pIni = new Date(p.ini); pIni.setHours(0,0,0,0);
  const pFin = new Date(p.fin); pFin.setHours(0,0,0,0);
  const hoy  = new Date(); hoy.setHours(0,0,0,0);

  const fIni = new Date(d.ini+'T12:00:00'); fIni.setHours(0,0,0,0);
  const fechasPago = [];
  if(d.freq === 'SEMANAL'){
    for(let n=0; n<d.plazo; n++){
      const f = new Date(fIni);
      f.setDate(fIni.getDate() + n*7);
      fechasPago.push(f);
    }
  } else { // QUINCENAL
    let y = fIni.getFullYear(), m = fIni.getMonth();
    let half = fIni.getDate() <= 15 ? 1 : 2;
    let count = 0;
    for(let i=0; i<500 && count<d.plazo; i++){
      const finMes = new Date(y, m+1, 0).getDate();
      const f = half === 1 ? new Date(y,m,15) : new Date(y,m,finMes);
      f.setHours(0,0,0,0);
      if(f >= fIni){ fechasPago.push(f); count++; }
      half++; if(half>2){ half=1; m++; if(m>11){m=0;y++;} }
    }
  }

  // REQ 1: si el último pago quedó antes del periodo actual, desaparece
  const ultimoPago = fechasPago[fechasPago.length-1];
  if(ultimoPago < pIni) return null;

  // ── DEUDA SEMANAL (igual que tanda sin premio) ──
  if(d.freq === 'SEMANAL'){
    const plazosEnPeriodo = [];
    fechasPago.forEach((fp, idx) => {
      if(perteneceAlPeriodoTanda(fp, pIni, pFin)){
        plazosEnPeriodo.push({ plazoNum: idx+1, fecha: fp });
      }
    });
    if(plazosEnPeriodo.length === 0) return null;

    const pagoPeriodo = plazosEnPeriodo.length * d.pago;
    const plazoActual = plazosEnPeriodo[0].plazoNum;
    const pagosYaHechos = plazoActual - 1;
    const totalPagar = d.pago * d.plazo;
    const saldoRestante = Math.max(0, totalPagar - pagosYaHechos * d.pago);

    return {
      modoRender: 'SEMANAL',
      plazosEnPeriodo,
      pagoPeriodo,
      pagoQuincena: pagoPeriodo,
      plazoActual,
      plazoFinalEnPeriodo: plazosEnPeriodo[plazosEnPeriodo.length-1].plazoNum,
      saldoRestante,
      totalPagar,
      fechaFinDeuda: ultimoPago
    };
  }

  // ── DEUDA QUINCENAL ──
  // Sueldo QUINCENAL: 1 pago completo en el periodo que contiene la fecha.
  if(S.modo === 'QUINCENAL'){
    let plazoActual = null;
    for(let i=0; i<fechasPago.length; i++){
      if(fechasPago[i] >= pIni && fechasPago[i] <= pFin){
        plazoActual = i+1;
        break;
      }
    }
    if(plazoActual === null) return null;
    const pagosYaHechos = plazoActual - 1;
    const totalPagar = d.pago * d.plazo;
    const saldoRestante = Math.max(0, totalPagar - pagosYaHechos * d.pago);

    return {
      modoRender: 'QUINCENAL_SUELDO_Q',
      pagoPeriodo: d.pago,
      pagoQuincena: d.pago,
      plazoActual,
      semanaEnPlazo: 1,
      semanasTotalesPlazo: 1,
      saldoRestante,
      totalPagar,
      fechaFinDeuda: ultimoPago,
      fechaPlazoActual: fechasPago[plazoActual-1]
    };
  }

  // Sueldo SEMANAL, deuda QUINCENAL: prorrateo por días de cobro
  function diasCobroEnRango(inicio, fin){
    if(inicio > fin) return [];
    const dias = [];
    for(let k=0; k<PERIODOS.length; k++){
      const f = new Date(PERIODOS[k].fin); f.setHours(0,0,0,0);
      if(f >= inicio && f <= fin) dias.push(f);
    }
    return dias;
  }

  let plazoActivoEnPeriodo = null;

  for(let i=0; i<fechasPago.length; i++){
    const plazoNum = i+1;
    const fechaPlazo = fechasPago[i];
    let inicioSeg;
    if(i === 0){
      inicioSeg = new Date(hoy);
    } else {
      inicioSeg = new Date(fechasPago[i-1]);
      inicioSeg.setDate(inicioSeg.getDate()+1);
    }
    inicioSeg.setHours(0,0,0,0);

    if(fechaPlazo < pIni) continue;
    if(inicioSeg > fechaPlazo) continue; // plazo sin ventana → saltar

    const diasCobro = diasCobroEnRango(inicioSeg, fechaPlazo);
    if(diasCobro.length === 0) continue; // sin días de cobro → saltar

    const enPeriodoActual = diasCobro.some(f => f >= pIni && f <= pFin);
    if(enPeriodoActual){
      plazoActivoEnPeriodo = { plazoNum, fechaPlazo, inicioSeg, diasCobro };
      break;
    }
  }

  if(!plazoActivoEnPeriodo) return null;

  const { plazoNum, fechaPlazo, diasCobro } = plazoActivoEnPeriodo;
  const semanasTotales = diasCobro.length;
  const idxCobroPeriodoActual = diasCobro.findIndex(f => f >= pIni && f <= pFin);
  const semanaActual = idxCobroPeriodoActual + 1;
  const pagoPeriodo = Math.round((d.pago / semanasTotales) * 100) / 100;
  const pagosYaHechos = plazoNum - 1;
  const totalPagar = d.pago * d.plazo;
  const saldoRestante = Math.max(0, totalPagar - pagosYaHechos * d.pago);

  return {
    modoRender: 'QUINCENAL_SUELDO_S',
    pagoPeriodo,
    pagoQuincena: pagoPeriodo,
    plazoActual: plazoNum,
    semanaEnPlazo: semanaActual,
    semanasTotalesPlazo: semanasTotales,
    saldoRestante,
    totalPagar,
    fechaFinDeuda: ultimoPago,
    fechaPlazoActual: fechaPlazo
  };
}

// ═══════════════════════════════════════════════════════
// calcDeuEnPeriodo — Router: MENSUAL → lógica original; SEM/QUIN → nueva
// ═══════════════════════════════════════════════════════
function calcDeuEnPeriodo(d){
  if(d.freq === 'SEMANAL' || d.freq === 'QUINCENAL'){
    const r = calcDeuSemanalOQuincenal(d);
    if(!r) return null;
    return {
      pagoQuincena: r.pagoQuincena,
      pagoActual: r.plazoActual,
      plazoActual: r.plazoActual,
      nTotal: r.semanasTotalesPlazo || 1,
      quincenaActual: r.semanaEnPlazo || 1,
      _nuevo: r
    };
  }
  return _calcDeuMensualOriginal(d);
}

// Lógica MENSUAL original (intacta)
function _calcDeuMensualOriginal(d){
  const p = PERIODOS[S.periodoIdx];
  if(!p) return null;
  const pIni = new Date(p.ini); pIni.setHours(0,0,0,0);
  const pFin = new Date(p.fin); pFin.setHours(0,0,0,0);

  if(!d.ini) return null;
  const fIni = new Date(d.ini+'T12:00:00'); fIni.setHours(0,0,0,0);
  const fAgre = d.fechaAgregado ? new Date(d.fechaAgregado+'T12:00:00') : new Date(fIni);
  fAgre.setHours(0,0,0,0);

  // Genera la N-ésima fecha de pago a partir de ini (n=0 → primer pago = ini)
  function getNthFechaPago(n){
    if(d.freq === 'MENSUAL'){
      const diaPago = fIni.getDate();
      const targetYear = fIni.getFullYear();
      const targetMonth = fIni.getMonth() + n;
      // Calcular primero el máximo día del mes destino (evita el desborde de JS)
      const maxDia = new Date(targetYear, targetMonth+1, 0).getDate();
      const diaFinal = Math.min(diaPago, maxDia);
      const f = new Date(targetYear, targetMonth, diaFinal);
      f.setHours(0,0,0,0);
      return f;
    } else if(d.freq === 'QUINCENAL'){
      let y = fIni.getFullYear(), m = fIni.getMonth();
      let half = fIni.getDate() <= 15 ? 1 : 2;
      let count = 0;
      for(let i=0; i<200; i++){
        const finMes = new Date(y, m+1, 0).getDate();
        const f = half === 1 ? new Date(y,m,15) : new Date(y,m,finMes);
        if(f >= fIni){ if(count === n) return f; count++; }
        half++; if(half>2){ half=1; m++; if(m>11){m=0;y++;} }
      }
      return fIni;
    } else { // SEMANAL
      const diasSem=['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
      const diaIdx = diasSem.indexOf(d.dia||'Viernes');
      const cursor = new Date(fIni);
      while(cursor.getDay() !== diaIdx) cursor.setDate(cursor.getDate()+1);
      cursor.setDate(cursor.getDate() + n*7);
      return cursor;
    }
  }

  // ── CALCULAR pagoActual AUTOMÁTICAMENTE ──────────────────
  // Cuenta cuántas fechas de pago han llegado desde ini hasta hoy.
  // El pagoActual es el número del pago cuya fecha de vencimiento
  // es hoy o futura más próxima (el pago que se está cursando o próximo).
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  let pagoActual = 1;
  for(let n = 0; n < d.plazo; n++){
    const fp = getNthFechaPago(n);
    fp.setHours(0,0,0,0);
    if(fp <= hoy){
      // Esta fecha ya venció → este es como mínimo el pago actual
      pagoActual = n + 2; // el siguiente es el pendiente
    } else {
      break;
    }
  }
  pagoActual = Math.max(1, Math.min(pagoActual, d.plazo));

  // Si ya pasaron todos los pagos → liquidada
  if(getNthFechaPago(d.plazo - 1) < hoy) return null;

  // ── ITERAR DESDE pagoActual para encontrar el periodo navegado ──
  let plazoActual = pagoActual;

  for(let safety = 0; safety < 500; safety++){
    if(plazoActual > d.plazo) return null;

    // limitePago: fecha de vencimiento de este pago (índice base-0 = plazoActual-1)
    const limitePago = getNthFechaPago(plazoActual - 1);
    limitePago.setHours(0,0,0,0);

    // desdeConteo:
    // - Para el primer pago contabilizado (pagoActual) → desde fechaAgregado
    // - Para pagos siguientes → desde la fecha del pago anterior
    let desdeConteo;
    if(plazoActual === pagoActual){
      desdeConteo = new Date(fAgre);
    } else {
      desdeConteo = getNthFechaPago(plazoActual - 2);
    }
    desdeConteo.setHours(0,0,0,0);

    const nTotal = Math.max(1, contarDiasCobro(_isoStr(limitePago), _isoStr(desdeConteo)));

    // ¿Este plazo ya quedó antes del periodo navegado?
    const pIniMenos1 = new Date(pIni); pIniMenos1.setDate(pIniMenos1.getDate()-1);
    const cobrosAntes = contarDiasCobro(_isoStr(pIniMenos1), _isoStr(desdeConteo));
    const quincenasEnRango = contarDiasCobro(_isoStr(limitePago), _isoStr(desdeConteo));

    if(quincenasEnRango === 0 || cobrosAntes >= nTotal){
      plazoActual++;
      continue;
    }

    // ¿Este plazo empieza después del periodo navegado?
    if(limitePago < pIni){
      plazoActual++;
      continue;
    }

    // El periodo navegado cae dentro de este plazo
    const effectiveEnd = pFin < limitePago ? _isoStr(pFin) : _isoStr(limitePago);
    const cobrosHastaFin = contarDiasCobro(effectiveEnd, _isoStr(desdeConteo));
    const quincenaActual = Math.min(nTotal, Math.max(1, cobrosHastaFin));
    const pagoQuincena = d.pago / nTotal;

    return {
      plazoActual,
      nTotal,
      quincenaActual,
      pagoMensual: d.pago,
      pagoQuincena,
      limitePago,
      fechaFinDeuda: getNthFechaPago(d.plazo - 1),
      liquidado: false
    };
  }
  return null;
}

// ═══════════════════════════════════════════════════════
// debenLimpiarse — 3 condiciones para limpiar movimientos TDC
// ═══════════════════════════════════════════════════════
// 1. Fecha límite del ciclo visible ya pasó O está dentro del periodo
// 2. corteFin del ciclo activo está dentro del periodo navegado
// 3. Fecha límite del ciclo visible ya no tiene quincenas desde el inicio del periodo
function debenLimpiarse(tar){
  const p = PERIODOS[S.periodoIdx]; if(!p) return false;

  // Usar inicio del periodo como referencia para simular el estado en ese momento
  const refDate = p.ini;
  const cicloActivo = cicloActualTarjeta(tar, refDate);

  // Ciclo visible = el anterior al activo
  const dayBeforeCorte = new Date(cicloActivo.corteIni);
  dayBeforeCorte.setDate(dayBeforeCorte.getDate()-1);
  const cicloVisible = cicloActualTarjeta(tar, dayBeforeCorte);

  // Condición 1: límite del ciclo visible ≤ fin del periodo (ya pasó o está dentro)
  const c1 = cicloVisible.limite <= p.fin;

  // Condición 2: corteFin del ciclo activo dentro del periodo navegado
  const c2 = cicloActivo.corteFin >= p.ini && cicloActivo.corteFin <= p.fin;

  // Condición 3: 0 quincenas desde el inicio del periodo hasta el límite visible
  const c3 = contarDiasCobro(cicloVisible.limiteStr, _isoStr(p.ini)) === 0;

  return c1 && c2 && c3;
}

function movPerteneceAlCicloVisible(tar, fechaMov){
  if(!fechaMov) return true;
  const cv = cicloVisibleTarjeta(tar);
  const f = new Date(fechaMov+'T12:00:00');
  return f >= cv.corteIni && f <= cv.corteFin;
}

// Validar fecha de movimiento: debe estar dentro del ciclo visible
// ═══════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════
// calcSvcSemanal — Servicio semanal (ej: pasajes L-V)
// ═══════════════════════════════════════════════════════
// Basado en día de la semana (Lunes, Martes, etc.)
// Sueldo QUINCENAL: acumula las veces que cae ese día en el periodo
// Sueldo SEMANAL:   regla de anticipación (pFin, pFin+7]
function calcSvcSemanal(s, pIni, pFin, fechaBaseOverride){
  const diasSem = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const diaIdx = diasSem.indexOf(s.diaSemana || 'Lunes');
  if(diaIdx < 0) return null;

  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const fAgre = s.fechaAgregado ? new Date(s.fechaAgregado+'T12:00:00') : new Date(hoy);
  fAgre.setHours(0,0,0,0);

  // Si vino fechaBaseOverride (caso: agregado en periodo futuro), úsala como base.
  // Si no, usa el comportamiento normal: max(pIni, fAgre).
  const base = fechaBaseOverride
    ? new Date(fechaBaseOverride)
    : (fAgre > pIni ? fAgre : pIni);
  base.setHours(0,0,0,0);
  // El "no antes de agregar" deja de aplicar cuando hay override (porque fAgre estaría en futuro)
  const minPermitido = fechaBaseOverride ? base : fAgre;

  // Encontrar todas las fechas del día de la semana dentro de [base, pFin]
  // + para modo SEMANAL, rango extendido (pFin, pFin+7]
  const fechasEnPeriodo = [];
  const cursor = new Date(base);
  // Avanzar hasta el primer día-de-semana >= base
  while(cursor.getDay() !== diaIdx) cursor.setDate(cursor.getDate()+1);

  const rangoMax = new Date(pFin);
  if(S.modo === 'SEMANAL'){
    rangoMax.setDate(rangoMax.getDate()+7);
  }

  while(cursor <= rangoMax){
    const cur = new Date(cursor); cur.setHours(0,0,0,0);
    if(S.modo === 'QUINCENAL'){
      if(cur >= pIni && cur <= pFin && cur >= minPermitido) fechasEnPeriodo.push(cur);
    } else {
      // SEMANAL: anticipación (pFin, pFin+7]
      if(cur > pFin && cur <= rangoMax && cur >= minPermitido) fechasEnPeriodo.push(cur);
    }
    cursor.setDate(cursor.getDate()+7);
  }

  if(fechasEnPeriodo.length === 0) return null;

  const pagoPeriodo = fechasEnPeriodo.length * s.monto;
  return {
    pagoTotal: s.monto,
    pagoQuincena: pagoPeriodo,
    nTotal: fechasEnPeriodo.length,
    quincenaActual: 1,
    proxPago: fechasEnPeriodo[0],
    _esSemanal: true,
    _count: fechasEnPeriodo.length
  };
}

// ═══════════════════════════════════════════════════════
// calcSvcQuincenal — Servicio quincenal (15 y último del mes)
// ═══════════════════════════════════════════════════════
// Sueldo QUINCENAL: 1 pago por periodo (siempre coincide)
// Sueldo SEMANAL:   divide entre los días de cobro que caen entre HOY/quincena
//                   anterior y la fecha del pago
function calcSvcQuincenal(s, pIni, pFin, fechaBaseOverride){
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const fAgre = s.fechaAgregado ? new Date(s.fechaAgregado+'T12:00:00') : new Date(hoy);
  fAgre.setHours(0,0,0,0);

  // Si vino fechaBaseOverride (agregado en periodo futuro), usarla como base
  const base = fechaBaseOverride ? new Date(fechaBaseOverride) : fAgre;
  base.setHours(0,0,0,0);

  // Generar fechas quincenales (15 y último del mes) a partir de base
  // hasta unos meses adelante
  const fechasPago = [];
  let y = base.getFullYear(), m = base.getMonth();
  let half = base.getDate() <= 15 ? 1 : 2;
  for(let i=0; i<60; i++){
    const finMes = new Date(y, m+1, 0).getDate();
    const f = half === 1 ? new Date(y, m, 15) : new Date(y, m, finMes);
    f.setHours(0,0,0,0);
    if(f >= base) fechasPago.push(f);
    half++; if(half>2){ half=1; m++; if(m>11){m=0; y++;} }
    if(fechasPago.length > 30) break;
  }

  // Buscar qué fecha quincenal cae en el periodo actual
  if(S.modo === 'QUINCENAL'){
    const f = fechasPago.find(d => d >= pIni && d <= pFin);
    if(!f) return null;
    return {
      pagoTotal: s.monto,
      pagoQuincena: s.monto,
      nTotal: 1,
      quincenaActual: 1,
      proxPago: f,
      _esQuincenal: true
    };
  }

  // Sueldo SEMANAL: dividir entre días de cobro disponibles
  function diasCobroEnRango(ini, fin){
    if(ini > fin) return [];
    const dias = [];
    for(let k=0; k<PERIODOS.length; k++){
      const f = new Date(PERIODOS[k].fin); f.setHours(0,0,0,0);
      if(f >= ini && f <= fin) dias.push(f);
    }
    return dias;
  }

  // Para cada fecha de pago, definir la ventana de cobro:
  //   inicioSeg = max(HOY, fechaPago[n-1] + 1) ... o HOY si es primera vez
  // Buscar el primer pago activo cuya ventana incluya el periodo actual.
  let plazoActivo = null;
  for(let i=0; i<fechasPago.length; i++){
    const fechaPago = fechasPago[i];
    let inicioSeg;
    if(i === 0){
      // Si tenemos override (agregado en futuro), no se considera HOY como mínimo
      inicioSeg = fechaBaseOverride
        ? new Date(base)
        : new Date(Math.max(hoy.getTime(), fAgre.getTime()));
    } else {
      inicioSeg = new Date(fechasPago[i-1]);
      inicioSeg.setDate(inicioSeg.getDate()+1);
    }
    inicioSeg.setHours(0,0,0,0);
    if(fechaPago < pIni) continue;
    if(inicioSeg > fechaPago) continue;
    const diasCobro = diasCobroEnRango(inicioSeg, fechaPago);
    if(diasCobro.length === 0) continue;
    const enActual = diasCobro.some(f => f >= pIni && f <= pFin);
    if(enActual){
      plazoActivo = { fechaPago, diasCobro };
      break;
    }
  }

  if(!plazoActivo) return null;
  const semanasTotales = plazoActivo.diasCobro.length;
  const idxActual = plazoActivo.diasCobro.findIndex(f => f >= pIni && f <= pFin);
  const semanaActual = idxActual + 1;
  const pagoPeriodo = Math.round((s.monto / semanasTotales) * 100) / 100;
  return {
    pagoTotal: s.monto,
    pagoQuincena: pagoPeriodo,
    nTotal: semanasTotales,
    quincenaActual: semanaActual,
    proxPago: plazoActivo.fechaPago,
    _esQuincenal: true
  };
}

// ═══════════════════════════════════════════════════════
// calcSvcEnPeriodo — Servicios con quincenas, como deudas pero sin plazo
// ═══════════════════════════════════════════════════════
function calcSvcEnPeriodo(s){
  const p = PERIODOS[S.periodoIdx];
  if(!p) return null;
  const pIni = new Date(p.ini); pIni.setHours(0,0,0,0);
  const pFin = new Date(p.fin); pFin.setHours(0,0,0,0);

  // ── LÓGICA DE FECHA DE INICIO PARA EL CÁLCULO ──
  // Caso especial: si el usuario AGREGÓ el servicio estando en un periodo
  // futuro al de HOY, no debe aparecer en periodos anteriores a ese.
  // Para detectar esto, guardamos `periodoAgregadoLbl` (el lbl del periodo
  // que estaba seleccionado al crear el servicio).
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  let fechaBase = null;
  if(s.periodoAgregadoLbl){
    // Buscar el índice del periodo donde se agregó
    const idxAgreg = PERIODOS.findIndex(per => per.lbl === s.periodoAgregadoLbl);
    if(idxAgreg >= 0){
      // Si el periodo VISIBLE (S.periodoIdx) es ANTERIOR al periodo en que se agregó,
      // el servicio NO debe aparecer (todavía no existía en ese momento).
      if(S.periodoIdx < idxAgreg) return null;
      // Si el periodo visible es EL MISMO o POSTERIOR al de agregado:
      //   - Si es el periodo de agregado y ese periodo es futuro a HOY: base = pIni
      //   - Si es periodo posterior al de agregado: base = pIni (lógica normal)
      //   - Si el periodo de agregado contiene a HOY (caso normal): base = HOY (lógica vieja)
      let idxHoy = -1;
      for(let i=0; i<PERIODOS.length; i++){
        const pi = new Date(PERIODOS[i].ini); pi.setHours(0,0,0,0);
        const pf = new Date(PERIODOS[i].fin); pf.setHours(0,0,0,0);
        if(hoy >= pi && hoy <= pf){ idxHoy = i; break; }
      }
      // Solo si el periodo de agregado es POSTERIOR al periodo de hoy:
      // usar inicio del periodo visible como base
      if(idxHoy >= 0 && idxAgreg > idxHoy){
        fechaBase = new Date(pIni);
      }
    }
  }

  // ── NUEVO: Servicios SEMANAL y QUINCENAL ──
  if(s.freqSvc === 'SEMANAL'){
    return calcSvcSemanal(s, pIni, pFin, fechaBase);
  }
  if(s.freqSvc === 'QUINCENAL'){
    return calcSvcQuincenal(s, pIni, pFin, fechaBase);
  }

  // Legacy: servicios sin diaPago usan el cálculo viejo
  if(!s.diaPago){
    const n = s.fecha ? contarDiasCobro(s.fecha) : (S.modo==='QUINCENAL'?2:4.33)*s.cadacuanto;
    return { pagoTotal: s.monto, pagoQuincena: s.monto/Math.max(1,n), nTotal: Math.max(1,Math.round(n)), quincenaActual: 1 };
  }

  const diaPago = s.diaPago;
  const cadaMeses = s.cadacuanto || 1;
  const fAgre = s.fechaAgregado ? new Date(s.fechaAgregado+'T12:00:00') : new Date();
  fAgre.setHours(0,0,0,0);

  function getNextPayDate(from, offset){
    // Fecha candidata: mismo mes de 'from', día = diaPago (ajustado al max del mes)
    const y = from.getFullYear(), m = from.getMonth();
    const maxMesActual = new Date(y, m+1, 0).getDate();
    const diaActual = Math.min(diaPago, maxMesActual);
    let d = new Date(y, m, diaActual);
    d.setHours(0,0,0,0);
    if(d < from){
      // Mover al siguiente mes (con ajuste al max del mes siguiente)
      const maxSig = new Date(y, m+2, 0).getDate();
      const diaSig = Math.min(diaPago, maxSig);
      d = new Date(y, m+1, diaSig);
      d.setHours(0,0,0,0);
    }
    if(offset > 0){
      // Avanzar N ciclos, recalculando el max del mes destino cada vez
      const dY = d.getFullYear(), dM = d.getMonth();
      const targetM = dM + offset * cadaMeses;
      const maxTarget = new Date(dY, targetM+1, 0).getDate();
      const diaTarget = Math.min(diaPago, maxTarget);
      d = new Date(dY, targetM, diaTarget);
      d.setHours(0,0,0,0);
    }
    return d;
  }

  let desdeConteo = fechaBase ? new Date(fechaBase) : new Date(fAgre);
  desdeConteo.setHours(0,0,0,0);
  // Para getNextPayDate, también usar la base correcta (fechaBase si vino, sino fAgre)
  const baseParaCiclo = fechaBase ? new Date(fechaBase) : new Date(fAgre);
  baseParaCiclo.setHours(0,0,0,0);
  let ciclo = 0;

  for(let safety = 0; safety < 200; safety++){
    const limitePago = getNextPayDate(baseParaCiclo, ciclo);

    if(limitePago <= desdeConteo){
      ciclo++;
      continue;
    }

    const nTotal = Math.max(1, contarDiasCobro(_isoStr(limitePago), _isoStr(desdeConteo)));

    const pIniMenos1 = new Date(pIni); pIniMenos1.setDate(pIniMenos1.getDate()-1);
    const cobrosAntes = contarDiasCobro(_isoStr(pIniMenos1), _isoStr(desdeConteo));

    const quincenasEnRango = contarDiasCobro(_isoStr(limitePago), _isoStr(desdeConteo));
    if(quincenasEnRango === 0 || cobrosAntes >= nTotal){
      desdeConteo = new Date(limitePago);
      ciclo++;
      continue;
    }

    const effectiveEnd = pFin < limitePago ? _isoStr(pFin) : _isoStr(limitePago);
    const cobrosHastaFin = contarDiasCobro(effectiveEnd, _isoStr(desdeConteo));
    const quincenaActual = Math.min(nTotal, Math.max(1, cobrosHastaFin));

    return {
      pagoTotal: s.monto,
      pagoQuincena: s.monto / nTotal,
      nTotal,
      quincenaActual,
      proxPago: limitePago
    };
  }
  return { pagoTotal: s.monto, pagoQuincena: s.monto/2, nTotal: 2, quincenaActual: 1 };
}

function calcTotalSvc(){
  return S.servicios.reduce((a,s)=>{
    const calc = calcSvcEnPeriodo(s);
    return a + (calc ? calc.pagoQuincena : 0);
  },0);
}

function calcTotalExtras(){ return S.extras.reduce((a,e)=>a+e.monto,0) }

// MSI: pago mensual ÷ quincenas desde HOY. Solo los míos van a deducciones.
function calcTotalMsi(){
  return S.msis.filter(m=>m.incluir==='SI').reduce((a,m)=>{
    const tar = S.tarjetas.find(t=>t.nombre===m.tarjeta);
    if(!tar) return a;
    const n = quincenasMsiDesdeHoy(tar, m.fechaCompra, m.fechaAgregado);
    const pagoMensual = (m.monto||0)/(m.plazo||1);
    return a + pagoMensual/n;
  },0);
}

// Movimientos: total de la tarjeta dividido entre quincenas hasta límite del ciclo visible
// Solo si NO deben limpiarse
function calcTotalMovPorTarjeta(tar){
  if(debenLimpiarse(tar)) return 0;
  const cv = cicloVisibleTarjeta(tar);
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const n = Math.max(1, contarDiasCobro(cv.limiteStr));
  const total = S.movimientos
    .filter(m=>m.tarjeta===tar.nombre && m.incluir==='SI' && movPerteneceAlCicloVisible(tar, m.fecha))
    .reduce((a,m)=>a+m.monto,0);
  return total/n;
}

function calcTotalMov(){
  return S.tarjetas.reduce((a,t)=>a+calcTotalMovPorTarjeta(t),0);
}

function calcTotalTDC(){ return calcTotalMov() }  // MSI va separado
function calcTotalTDCConMSI(){ return calcTotalMov()+calcTotalMsi() }

function calcTotalDeu(){
  return S.deudas.reduce((a,d)=>{
    if(d.tipo==='tanda'){
      const ct = calcTandaEnPeriodo(d);
      if(!ct) return a;
      return a + ct.pagoPeriodo;
    }
    const calc = calcDeuEnPeriodo(d);
    if(!calc) return a;
    return a + calc.pagoQuincena;
  },0);
}
function calcTotalPerc(){ return getSueldoPeriodo()+calcTotalExtras() }
function calcTotalDedu(){ return calcTotalSvc()+calcTotalMov()+calcTotalMsi()+calcTotalDeu()+calcTotalOtros()+(S.ahoMonto||0) }
function calcDisponible(){ return calcTotalPerc()-calcTotalDedu() }

// ═══════════════════════════════════════════════════════
// RENDER PRINCIPAL
// ═══════════════════════════════════════════════════════
function renderPrincipal(){
  const snap = getSnapshotActual();
  const label = S.modo==='QUINCENAL'?'quincena':'semana';

  // Use snapshot data if viewing a past saved period, otherwise live data
  let sueldo, extras, totalPerc, svc, tdc, msiTotal, deu, otros, aho, totalDedu, disp;
  if(snap){
    sueldo = snap.sueldo||0;
    extras = snap.extras||0;
    totalPerc = snap.totalPerc||0;
    svc = (snap.desglose?.servicios||[]).reduce((a,s)=>a+s.pagoQuincena,0);
    deu = (snap.desglose?.deudas||[]).reduce((a,d)=>a+d.pagoQuincena,0);
    msiTotal = (snap.desglose?.msis||[]).filter(m=>m.incluir==='SI').reduce((a,m)=>a+m.pagoQuincena,0);
    tdc = (snap.desglose?.movimientos||[]).filter(m=>m.incluir==='SI').reduce((a,m)=>a+m.monto,0)/2;
    otros = (snap.desglose?.otrosGastos||[]).reduce((a,g)=>a+g.monto,0);
    aho = snap.ahorro||0;
    totalDedu = snap.totalDedu||0;
    disp = snap.disponible||0;
  } else {
    sueldo = getSueldoPeriodo();
    extras = calcTotalExtras();
    totalPerc = sueldo+extras;
    svc = calcTotalSvc();
    tdc = calcTotalMov();
    msiTotal = calcTotalMsi();
    deu = calcTotalDeu();
    otros = calcTotalOtros();
    aho = S.ahoMonto||0;
    totalDedu = svc+tdc+msiTotal+deu+otros+aho;
    disp = totalPerc-totalDedu;
  }

  id('p-sueldo').textContent = mxn(sueldo);
  id('p-extras').textContent = mxn(extras);
  id('tot-perc').textContent = mxn(totalPerc);
  id('d-svc').textContent = '-'+mxn(svc);
  id('d-tdc').textContent = '-'+mxn(tdc);
  if(id('d-msi')) id('d-msi').textContent = '-'+mxn(msiTotal);
  id('d-deu').textContent = '-'+mxn(deu);
  if(id('d-otros')) id('d-otros').textContent = '-'+mxn(otros);
  id('d-aho').textContent = '-'+mxn(aho);
  id('tot-dedu').textContent = '-'+mxn(totalDedu);
  id('disponible').textContent = (disp<0?'-':'')+mxn(disp);
  if(id('disponible-m')) id('disponible-m').textContent = (disp<0?'-':'')+mxn(disp);
  // REQ 4: pintar en rojo cuando el disponible del periodo es negativo
  const dispEl = id('disponible');
  if(dispEl) dispEl.style.color = disp<0 ? 'var(--red)' : '';
  const dispElM = id('disponible-m');
  if(dispElM) dispElM.style.color = disp<0 ? 'var(--red)' : '';
  if(id('disp-ahorro')) id('disp-ahorro').textContent = mxn(aho);

  // Desglose de periodo guardado
  const desgloseEl = id('periodo-desglose');
  if(desgloseEl){
    if(snap && snap.desglose){
      const d = snap.desglose;
      let html = `<div class="card" style="border-left:3px solid var(--blue)">
        <div class="card-hdr"><span>Desglose del periodo ${snap.auto?'(auto-guardado)':''}</span>
          <span style="font-size:10px;color:var(--text3)">${snap.guardadoEl?new Date(snap.guardadoEl).toLocaleDateString('es-MX'):''}  — solo lectura</span>
        </div>`;

      // Servicios
      if(d.servicios?.length){
        html += `<div class="sec-l">Servicios</div>`;
        d.servicios.forEach(s=>{
          html += `<div class="row"><div class="row-l">${s.concepto} <span style="color:var(--text3);font-size:10px">Q${s.quincenaActual}/${s.nTotal} · ${mxn(s.monto)}/${(s.cadacuanto||1)>1?s.cadacuanto+'m':'mes'}</span></div><div class="row-a neg">-${mxn(s.pagoQuincena)}</div></div>`;
        });
      }

      // Deudas
      if(d.deudas?.length){
        html += `<div class="sec-l">Deudas</div>`;
        d.deudas.forEach(dd=>{
          html += `<div class="row"><div class="row-l">${dd.concepto} <span style="color:var(--text3);font-size:10px">Q${dd.quincenaActual}/${dd.nTotal} · Plazo ${dd.plazoActual}/${dd.plazo} · ${mxn(dd.pago)}/${dd.freq?.toLowerCase()||'mes'}</span></div><div class="row-a neg">-${mxn(dd.pagoQuincena)}</div></div>`;
        });
      }

      // MSI
      if(d.msis?.length){
        html += `<div class="sec-l">MSI</div>`;
        d.msis.forEach(m=>{
          html += `<div class="row"><div class="row-l">${m.concepto} <span style="color:var(--text3);font-size:10px">${m.tarjeta} · Q${m.quincenaActual}/${m.nTotal} · Plazo ${m.plazoActual}/${m.plazo}</span></div><div class="row-a neg">-${mxn(m.pagoQuincena)}</div></div>`;
        });
      }

      // Extras
      if(d.extras?.length){
        html += `<div class="sec-l">Extras</div>`;
        d.extras.forEach(e=>{
          html += `<div class="row"><div class="row-l">${e.concepto} <span style="color:var(--text3);font-size:10px">${e.fecha||''}</span></div><div class="row-a pos">+${mxn(e.monto)}</div></div>`;
        });
      }

      // Otros gastos
      if(d.otrosGastos?.length){
        html += `<div class="sec-l">Otros gastos</div>`;
        d.otrosGastos.forEach(g=>{
          html += `<div class="row"><div class="row-l">${g.concepto}</div><div class="row-a neg">-${mxn(g.monto)}</div></div>`;
        });
      }

      // Movimientos TDC
      if(d.movimientos?.length){
        html += `<div class="sec-l">Movimientos TDC</div>`;
        d.movimientos.forEach(m=>{
          html += `<div class="row"><div class="row-l">${m.concepto} <span style="color:var(--text3);font-size:10px">${m.tarjeta}${m.incluir==='NO'?' (excluido)':''}</span></div><div class="row-a neg">-${mxn(m.monto)}</div></div>`;
        });
      }

      html += `</div>`;
      desgloseEl.innerHTML = html;
      desgloseEl.style.display = 'block';
    } else {
      desgloseEl.style.display = 'none';
      desgloseEl.innerHTML = '';
    }
  }

  // Métricas de mes y año basadas en periodos del historial
  const p = PERIODOS[S.periodoIdx];
  const mesActual = p ? p.ini.getMonth() : new Date().getMonth();
  const anioActual = p ? p.ini.getFullYear() : new Date().getFullYear();

  // Filtrar historial por mes y año
  let ganMes = 0, gasMes = 0, ganAnio = 0, gasAnio = 0;
  S.historial.forEach(h=>{
    // Parsear el periodo label para obtener mes/año
    // Intentar extraer fecha del campo ini o del label
    let fecha = null;
    if(h.ini) fecha = new Date(h.ini+'T12:00:00');
    if(!fecha || isNaN(fecha)){
      // Intentar parsear del label (ej: "16-30 Abr 2026" o "16 Abr — 22 Abr 2026")
      const parts = (h.periodo||'').match(/(\d{4})/);
      const mesMatch = (h.periodo||'').match(/(Ene|Feb|Mar|Abr|May|Jun|Jul|Ago|Sep|Oct|Nov|Dic)/);
      if(parts && mesMatch){
        const yr = parseInt(parts[1]);
        const mi = MESES.indexOf(mesMatch[1]);
        fecha = new Date(yr, mi, 1);
      }
    }
    if(!fecha || isNaN(fecha)) return;

    const hMes = fecha.getMonth();
    const hAnio = fecha.getFullYear();

    // Año
    if(hAnio === anioActual){
      ganAnio += (h.totalPerc||0);
      gasAnio += (h.totalDedu||0);
    }
    // Mes (mismo mes Y mismo año)
    if(hMes === mesActual && hAnio === anioActual){
      ganMes += (h.totalPerc||0);
      gasMes += (h.totalDedu||0);
    }
  });

  // Sumar periodo actual solo si NO tiene snapshot (no está cerrado)
  if(!snap){
    ganMes += totalPerc;
    gasMes += totalDedu;
    ganAnio += totalPerc;
    gasAnio += totalDedu;
  }

  id('m-mes-g').textContent = mxn(ganMes);
  id('m-mes-r').textContent = mxn(gasMes);
  // REQ 4: Disponible nunca muestra negativo (si disp<0 → 0). Acumulado año igual.
  id('m-disp').textContent = mxn(Math.max(0, disp));
  id('m-ano-g').textContent = mxn(ganAnio);
  id('m-ano-r').textContent = mxn(gasAnio);
  id('m-acum').textContent = mxn(Math.max(0, ganAnio-gasAnio));

  // Ahorro acumulado = solo periodos cerrados del historial
  const ahorroAcum = S.historial.reduce((a,h)=>a+(h.ahorro||0),0);
  if(id('m-ahorro-acum')) id('m-ahorro-acum').textContent = mxn(ahorroAcum);

  if(id('disp-ahorro-acum')){
    const acumHist = S.historial.reduce((a,h)=>a+(h.ahorro||0),0);
    id('disp-ahorro-acum').textContent = mxn(acumHist + (snap?0:(S.ahoMonto||0)));
  }

  // Sueldo input — readonly si período guardado o fijo
  const inpSueldo = id('inp-sueldo');
  const esReadOnly = !!snap || S.sueldoFijo;
  if(inpSueldo && !document.activeElement.isSameNode(inpSueldo)){
    inpSueldo.value = sueldo || '';
  }
  if(inpSueldo){
    inpSueldo.readOnly = esReadOnly;
    inpSueldo.style.opacity = esReadOnly ? '0.6' : '1';
    inpSueldo.style.cursor = esReadOnly ? 'not-allowed' : '';
  }
  if(snap){
    id('fijo-note').textContent = 'Periodo guardado — navegas en modo lectura';
    id('fijo-note').className = 'ibox';
  } else {
    id('fijo-note').textContent = S.sueldoFijo
      ? 'Sueldo fijo — desactiva el toggle para editar'
      : 'Sueldo editable — cambia el monto y se guarda para este periodo';
    id('fijo-note').className = S.sueldoFijo ? 'ibox' : 'wbox';
  }

  const togFijo = id('tog-fijo');
  if(togFijo) togFijo.classList.toggle('on', S.sueldoFijo);
  const togFijoDt = id('tog-fijo-dt');
  if(togFijoDt) togFijoDt.classList.toggle('on', S.sueldoFijo);

  // Actualizar tarjeta de USD del dashboard si la sección Divisas está activa
  if(S.secciones && S.secciones.divisas === true && typeof renderDivisas === 'function'){
    renderDivisas().catch(()=>{});
  }
}

// ═══════════════════════════════════════════════════════
// RENDER SERVICIOS
// ═══════════════════════════════════════════════════════
function freqLabel(n){
  const labels = {1:'mensual',2:'bimestral',3:'trimestral',6:'semestral',12:'anual'};
  return labels[n] || `cada ${n} meses`;
}
// Devuelve string con la fecha del próximo pago de un servicio, o '' si no aplica
// regla "no se muestra próximo pago si caen varios eventos por periodo".
// Si quieres el objeto Date crudo, usa calcProxPagoSvcDate(s).
function calcProxPagoSvc(s){
  const r = calcProxPagoSvcDate(s);
  if(!r) return '';
  // Regla: si cae más de un evento en el periodo (semanal+sueldo quincenal),
  // no se muestra próxima fecha (igual que deudas semanal+quincenal).
  if(s.freqSvc === 'SEMANAL' && S.modo === 'QUINCENAL') return '';
  return fmtTandaFecha(r);
}

// Devuelve la fecha (Date) del próximo pago de un servicio según el periodo
// actual visible. Maneja MENSUAL, BIMESTRAL+, SEMANAL y QUINCENAL.
function calcProxPagoSvcDate(s){
  const p = PERIODOS[S.periodoIdx];
  const refFin = p ? new Date(p.fin) : new Date();
  refFin.setHours(0,0,0,0);
  let refIni = p ? new Date(p.ini) : new Date();
  refIni.setHours(0,0,0,0);
  const hoy = new Date(); hoy.setHours(0,0,0,0);

  // Si el servicio se agregó ESTANDO EN UN PERIODO FUTURO, la base mínima
  // para buscar es el INICIO de ese periodo (no hoy ni el periodo visible).
  // Esto evita que aparezcan notificaciones / próximos pagos para fechas
  // anteriores al inicio del primer periodo "real" del servicio.
  let baseMinima = null;
  if(s.periodoAgregadoLbl){
    const idxAgreg = PERIODOS.findIndex(per => per.lbl === s.periodoAgregadoLbl);
    if(idxAgreg >= 0){
      const pAgreg = PERIODOS[idxAgreg];
      const pIniAgreg = new Date(pAgreg.ini); pIniAgreg.setHours(0,0,0,0);
      // Solo aplicar si el periodo de agregado es posterior al periodo visible
      // y/o posterior a HOY (para evitar afectar comportamiento normal)
      // Buscar idx del periodo que contiene HOY
      let idxHoy = -1;
      for(let i=0; i<PERIODOS.length; i++){
        const pi = new Date(PERIODOS[i].ini); pi.setHours(0,0,0,0);
        const pf = new Date(PERIODOS[i].fin); pf.setHours(0,0,0,0);
        if(hoy >= pi && hoy <= pf){ idxHoy = i; break; }
      }
      if(idxHoy >= 0 && idxAgreg > idxHoy){
        // Sí, fue agregado en un periodo futuro al de hoy.
        // La fecha más temprana del próximo pago debe ser >= pIniAgreg.
        baseMinima = pIniAgreg;
      }
    }
  }

  // Helper: fecha segura ajustada al último día del mes si excede
  function fechaSegura(y, m, dia){
    const maxD = new Date(y, m+1, 0).getDate();
    const d = new Date(y, m, Math.min(dia, maxD));
    d.setHours(0,0,0,0);
    return d;
  }

  // Compute "desde" para iniciar la búsqueda: max(hoy, refIni, baseMinima)
  function calcDesde(){
    let desde = hoy;
    if(refIni > desde) desde = refIni;
    if(baseMinima && baseMinima > desde) desde = baseMinima;
    return new Date(desde);
  }

  // ── SEMANAL: próximo día de la semana ──
  if(s.freqSvc === 'SEMANAL'){
    const diasSem = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
    const diaIdx = diasSem.indexOf(s.diaSemana || 'Lunes');
    if(diaIdx < 0) return null;
    const desde = calcDesde();
    const cur = new Date(desde);
    while(cur.getDay() !== diaIdx) cur.setDate(cur.getDate()+1);
    cur.setHours(0,0,0,0);
    return cur;
  }

  // ── QUINCENAL: 15 y último día del mes ──
  if(s.freqSvc === 'QUINCENAL'){
    const desde = calcDesde();
    desde.setHours(0,0,0,0);
    let y = desde.getFullYear(), m = desde.getMonth();
    let half = desde.getDate() <= 15 ? 1 : 2;
    for(let i=0; i<10; i++){
      const finMes = new Date(y, m+1, 0).getDate();
      const f = half === 1 ? new Date(y, m, 15) : new Date(y, m, finMes);
      f.setHours(0,0,0,0);
      if(f >= desde) return f;
      half++; if(half>2){ half=1; m++; if(m>11){m=0; y++;} }
    }
    return null;
  }

  // ── Legacy MENSUAL/Bimestral/etc ──
  if(!s.diaPago) return null;
  const dia = s.diaPago;
  const cadaMeses = s.cadacuanto || 1;
  if(cadaMeses === 1){
    // Si el servicio se agregó en periodo futuro: la primera fecha válida
    // es el día N estrictamente DESPUÉS del inicio del periodo de agregado.
    // (Si el día N coincide con el inicio del periodo, ese día NO se cobra,
    //  porque el servicio "apenas inició" — el primer pago real es el siguiente)
    if(baseMinima){
      let y = baseMinima.getFullYear(), m = baseMinima.getMonth();
      let prox = fechaSegura(y, m, dia);
      // Avanzar mientras prox <= baseMinima (estricto > para excluir el día de inicio)
      while(prox <= baseMinima){
        m++;
        prox = fechaSegura(y, m, dia);
        if(prox.getFullYear() > y + 5) break; // safety
      }
      return prox;
    }
    let prox = fechaSegura(refFin.getFullYear(), refFin.getMonth(), dia);
    if(prox <= refFin) prox = fechaSegura(refFin.getFullYear(), refFin.getMonth()+1, dia);
    return prox;
  } else {
    if(s.proxPago){
      let prox = new Date(s.proxPago+'T12:00:00'); prox.setHours(0,0,0,0);
      const minRef = baseMinima || refFin;
      while(prox <= minRef){
        const newM = prox.getMonth() + cadaMeses;
        prox = fechaSegura(prox.getFullYear(), newM, prox.getDate());
      }
      return prox;
    }
    return null;
  }
}
function renderSvc(){
  const list = id('svc-list');
  const label = S.modo==='QUINCENAL'?'quincena':'semana';
  if(!S.servicios.length){
    list.innerHTML='<div class="empty"><div class="empty-icon">—</div>Sin servicios — agrega el primero</div>';
    id('tot-svc').textContent='$0.00'; return;
  }
  // Filtrar servicios que no aplican a este periodo (creados en periodo posterior)
  const visibles = S.servicios.map((s,i)=>({s,i,calc:calcSvcEnPeriodo(s)})).filter(o=>o.calc!==null);
  if(!visibles.length){
    list.innerHTML='<div class="empty"><div class="empty-icon">—</div>Sin servicios activos en este periodo</div>';
    id('tot-svc').textContent='$0.00'; return;
  }
  list.innerHTML = visibles.map(({s,i,calc})=>{
    const freq = s.freqSvc==='SEMANAL' ? 'Semanal'+(s.diaSemana?' · '+s.diaSemana:'')
              : s.freqSvc==='QUINCENAL' ? 'Quincenal'
              : freqLabel(s.cadacuanto||1);
    const subLetra = S.modo==='SEMANAL' ? 'S' : 'Q';
    // Mostrar S/Q solo cuando aporta info: NO mostrar si freq y modo coinciden trivialmente
    // (servicio semanal + modo semanal = siempre 1/1, redundante)
    const ocultarSub = (s.freqSvc==='SEMANAL' && S.modo==='SEMANAL') ||
                       (s.freqSvc==='QUINCENAL' && S.modo==='QUINCENAL');
    const sublbl = (!ocultarSub && calc && calc.nTotal>=1) ? `${subLetra}${calc.quincenaActual}/${calc.nTotal}` : '';
    const proxFecha = calcProxPagoSvc(s);
    const diaInfo = (s.freqSvc!=='SEMANAL' && s.freqSvc!=='QUINCENAL' && s.diaPago) ? ' · día '+s.diaPago : '';
    return `<div class="svc">
      <div class="svc-info">
        <div class="svc-name">${s.concepto}</div>
        <div class="svc-sub">${freq}${diaInfo}${sublbl?' · '+sublbl:''}</div>
        ${proxFecha?`<div style="font-size:11px;color:var(--text2);margin-top:3px">Próximo pago: <strong style="color:var(--text)">${proxFecha}</strong></div>`:''}
      </div>
      <div class="svc-right">
        <div style="font-size:13px;font-weight:700;font-family:var(--mono);color:var(--text2)">${mxn(s.monto)}</div>
        <div style="font-size:11px;color:var(--teal);margin-top:2px">-${mxn(calc?calc.pagoQuincena:0)} / ${label}</div>
      </div>
      <span class="ch-del" onclick="borrarSvc(${i})">×</span>
    </div>`;
  }).join('');
  id('tot-svc').textContent = '-'+mxn(calcTotalSvc());
}

// ═══════════════════════════════════════════════════════
// RENDER EXTRAS
// ═══════════════════════════════════════════════════════
function renderExt(){
  const list = id('ext-list');
  if(!S.extras.length){
    list.innerHTML='<div class="empty"><div class="empty-icon">—</div>Sin ingresos extra este periodo</div>';
    id('tot-ext').textContent='$0.00'; return;
  }
  list.innerHTML = S.extras.map((e,i)=>`
    <div class="ext-item">
      <div class="ext-dot"></div>
      <div class="ext-info">
        <div class="ext-name">${e.concepto}</div>
        <div class="ext-desc">${e.fecha||''} · ${e.desc||''}</div>
      </div>
      <div class="ext-right">
        <div class="ext-a">+${mxn(e.monto)}</div>
        <span class="ch-del" onclick="delExt(${i})">×</span>
      </div>
    </div>`).join('');
  id('tot-ext').textContent = '+'+mxn(calcTotalExtras());
}

// ═══════════════════════════════════════════════════════
// RENDER TDC
// ═══════════════════════════════════════════════════════
function renderTDC(){
  // Tarjetas
  const cardsEl = id('tdc-cards-list');
  if(!S.tarjetas.length){
    cardsEl.innerHTML='<div class="empty" style="margin-bottom:12px"><div class="empty-icon">—</div>Sin tarjetas — agrega la primera</div>';
  } else {
    cardsEl.innerHTML = S.tarjetas.map((t,i)=>{
      const dias = t.modo==='DÍA DEL MES'
        ? (t.pago>=t.corte ? t.pago-t.corte : 30+t.pago-t.corte)
        : t.pago;
      const totalMov = S.movimientos.filter(m=>m.tarjeta===t.nombre && m.incluir==='SI').reduce((a,m)=>a+m.monto,0);
      const totalMsi = S.msis.filter(m=>m.tarjeta===t.nombre && m.incluir==='SI').reduce((a,m)=>a+m.pago/(S.modo==='QUINCENAL'?2:4.33),0);
      const porPeriodo = totalMov + totalMsi;
      return `<div class="tdc-card ${t.color||'tdc-b'}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:2px">
          <div class="tdc-name">${t.nombre}</div>
          <div class="tdc-tag">Corte ${t.corte} · Pago ${t.modo==='DÍA DEL MES'?'día '+t.pago:t.pago+' días'}</div>
        </div>
        <div class="tdc-det">${dias} días para pagar</div>
        <div class="tdc-amts">
          <div class="tdc-bl"><div class="tdc-bll">Total mov.</div><div class="tdc-blv">${mxn(totalMov)}</div></div>
          <div class="tdc-bl"><div class="tdc-bll">MSI</div><div class="tdc-blv">${mxn(totalMsi)}</div></div>
          <div class="tdc-bl"><div class="tdc-bll">Por periodo</div><div class="tdc-blv">${mxn(porPeriodo)}</div></div>
        </div>
        <div class="tdc-actions">
          <button class="btn btn-danger btn-sm" onclick="delTar(${i})" style="font-size:10px">× eliminar</button>
        </div>
      </div>`;
    }).join('');
  }

  // Actualizar selector de tarjeta en modales
  const opts = S.tarjetas.map(t=>`<option>${t.nombre}</option>`).join('');
  id('mov-tar').innerHTML = opts||'<option>Sin tarjetas</option>';
  id('msi-tar').innerHTML = opts||'<option>Sin tarjetas</option>';

  // Movimientos
  const movEl = id('mov-list');
  if(!S.movimientos.length){
    movEl.innerHTML='<div class="empty"><div class="empty-icon">—</div>Sin movimientos — agrega el primero</div>';
  } else {
    movEl.innerHTML = S.movimientos.map((m,i)=>`
      <div class="chi" id="chi-${i}">
        <div class="chk ${m.incluir==='SI'?'on':'off'}" onclick="toggleMov(${i})">${m.incluir==='SI'?'✓':'✕'}</div>
        <div class="ch-info">
          <div class="ch-name ${m.incluir==='NO'?'x':''}">${m.concepto}</div>
          <div class="ch-sub">${m.fecha||''} · ${m.tarjeta}</div>
        </div>
        <div class="ch-a ${m.incluir==='NO'?'x':''}">${mxn(m.monto)}</div>
        <span class="ch-del" onclick="delMov(${i})">×</span>
      </div>`).join('');
  }

  // MSI
  const msiEl = id('msi-list');
  if(!S.msis.length){
    msiEl.innerHTML='<div class="empty" style="font-size:11px;padding:10px 0">Sin MSI registrados</div>';
  } else {
    const div = S.modo==='QUINCENAL'?2:4.33;
    msiEl.innerHTML = S.msis.map((m,i)=>{
      const ppp = m.pago/div;
      const excl = m.incluir==='NO';
      return `<div class="msi ${excl?'x':''}">
        <div class="msi-hdr">
          <div>
            <div class="msi-name ${excl?'x':''}">${m.concepto}</div>
            <div class="msi-sub">Pago ${m.pagoActual||1} de ${m.plazo} · ${m.tarjeta}</div>
          </div>
          <div style="text-align:right">
            <div class="msi-a ${excl?'x':''}">${mxn(m.pago)}/mes</div>
          </div>
        </div>
        <div class="prog"><div class="prog-f" style="width:${Math.round((m.pagoActual||1)/m.plazo*100)}%;background:${excl?'var(--red)':'var(--purple)'}"></div></div>
        <div class="msi-actions">
          <span class="badge ${excl?'r':'g'}" style="cursor:pointer" onclick="toggleMsi(${i})">${excl?'✕ excluido':'✓ incluido'}</span>
          <span style="font-size:11px;color:var(--text2)">→ ${mxn(ppp)}/periodo</span>
          <span class="ch-del" onclick="delMsi(${i})">×</span>
        </div>
      </div>`;
    }).join('');
  }

  // Total
  const totalTDC = calcTotalTDC();
  id('tot-tdc').textContent = '-'+mxn(totalTDC);
  const movInc = S.movimientos.filter(m=>m.incluir==='SI');
  const movExc = S.movimientos.filter(m=>m.incluir==='NO');
  const breakdown = [];
  if(movInc.length) breakdown.push(`Movimientos: ${mxn(calcTotalMov())}`);
  if(S.msis.filter(m=>m.incluir==='SI').length) breakdown.push(`MSI: ${mxn(calcTotalMsi())}`);
  if(movExc.length) breakdown.push(`Excluidos: ${mxn(movExc.reduce((a,m)=>a+m.monto,0))}`);
  id('tdc-breakdown').textContent = breakdown.join(' · ') || '—';
}

// ═══════════════════════════════════════════════════════
// RENDER DEUDAS
// ═══════════════════════════════════════════════════════
function renderDeu(){
  const list = id('deu-list');
  if(!S.deudas.length){
    list.innerHTML='<div class="empty"><div class="empty-icon">—</div>Sin deudas registradas</div>';
    id('tot-deu').textContent='$0.00'; return;
  }
  list.innerHTML = S.deudas.map((d,i)=>{
    const calc = calcDeuEnPeriodo(d);
    const totalPagar = d.pago*d.plazo;
    const interes = Math.max(0,totalPagar-(d.monto||0));
    const tasa = d.monto&&d.plazo ? ((interes/d.monto)/(d.plazo/(d.freq==='MENSUAL'?12:d.freq==='QUINCENAL'?24:52))*100) : 0;

    if(!calc){
      return `<div class="deu" style="opacity:.5">
        <div class="deu-hdr"><div class="deu-name">${d.concepto}</div><span class="badge a">${d.freq}</span></div>
        <div class="prog"><div class="prog-f" style="width:100%;background:var(--green)"></div></div>
        <div class="deu-pago-row">
          <span style="font-size:11px;color:var(--green)">Liquidada</span>
          <span class="ch-del" onclick="delDeu(${i})">×</span>
        </div>
      </div>`;
    }

    const {plazoActual, nTotal, quincenaActual, pagoQuincena} = calc;
    const restantes = Math.max(0, d.plazo - plazoActual + 1);
    const pct = d.plazo>0 ? Math.round(plazoActual/d.plazo*100) : 0;
    const label = S.modo==='QUINCENAL'?'Quincena':'Semana';
    const sublbl = `${label} ${quincenaActual}/${nTotal} · Pago ${plazoActual}/${d.plazo}`;
    // Saldo actual = total con intereses − pagos ya realizados (plazoActual-1 pagos completados)
    const pagosYaHechos = Math.max(0, plazoActual - 1);
    const saldoActual = Math.max(0, totalPagar - pagosYaHechos * d.pago);

    return `<div class="deu">
      <div class="deu-hdr">
        <div class="deu-name">${d.concepto}</div>
        <span class="badge a">${d.freq}</span>
      </div>
      <div class="deu-stats">
        <div class="deu-stat">Pago: <span>${plazoActual} de ${d.plazo}</span></div>
        <div class="deu-stat">Faltan: <span>${restantes} pagos</span></div>
      </div>
      <div style="font-size:10px;color:var(--teal);font-weight:600;margin-bottom:4px">${sublbl}</div>
      <div class="prog"><div class="prog-f" style="width:${pct}%;background:var(--green)"></div></div>
      ${interes>0?`<div class="deu-rates">
        <div class="rate-item"><div class="rate-l">Tasa anual aprox.</div><div class="rate-v">${tasa.toFixed(1)}%</div></div>
        <div class="rate-item"><div class="rate-l">Interés total</div><div class="rate-v r">${mxn(interes)}</div></div>
        <div class="rate-item"><div class="rate-l">Se debe aún</div><div class="rate-v r" style="color:var(--amber)">${mxn(saldoActual)}</div></div>
      </div>`:''}
      <div class="deu-pago-row">
        <span style="font-size:11px;color:var(--text2)">Pago ${d.freq.toLowerCase()}: ${mxn(d.pago)} → este periodo:</span>
        <span style="font-size:13px;font-weight:700;color:var(--amber);font-family:var(--mono)">-${mxn(pagoQuincena)}</span>
        <span class="ch-del" onclick="delDeu(${i})">×</span>
      </div>
    </div>`;
  }).join('');
  id('tot-deu').textContent = '-'+mxn(calcTotalDeu());
}

// ═══════════════════════════════════════════════════════
// RENDER AHORRO
// ═══════════════════════════════════════════════════════
function renderAhorro(){
  const hist = id('aho-hist');
  if(!S.historial.length){
    hist.innerHTML='<div class="empty">Sin periodos guardados aún — guarda tu primer periodo.</div>'; return;
  }
  let acum = 0;
  hist.innerHTML = S.historial.map(h=>{
    acum += h.ahorro||0;
    const autoTag = h.auto ? ' <span style="font-size:9px;color:var(--text3)">(auto)</span>' : '';
    return `<div class="aho-row">
      <span class="aho-per">${h.periodo}${autoTag}</span>
      <span class="aho-monto">+${mxn(h.ahorro||0)}</span>
      <span class="aho-acum">${mxn(acum)} total</span>
    </div>`;
  }).join('');
}

function renderAhorroConfig(){
  const perc = calcTotalPerc();
  const pct = S.ahoPct||10;
  const base = Math.round(perc*pct/100);
  // Si modo porcentaje, recalcular automáticamente
  if(S.ahoModo === 'pct'){
    S.ahoMonto = base;
  }
  id('aho-amt').textContent = mxn(S.ahoMonto||0);
  id('aho-sub').textContent = `de ${mxn(perc)} percepciones`;
  id('pct-sl').value = pct;
  id('pct-lbl').textContent = pct+'%';
  id('ring-lbl').textContent = pct+'%';
  const dash=163.4;
  id('ring-arc').setAttribute('stroke-dashoffset', (dash-(dash*pct/30)).toFixed(1));
  if(!document.activeElement.isSameNode(id('aho-inp')))
    id('aho-inp').value = S.ahoMonto||0;
  id('aho-inp').min = base;
}

// ═══════════════════════════════════════════════════════
// RENDER ALL
// ═══════════════════════════════════════════════════════
function renderAll(){
  renderPeriodoNav();
  renderPrincipal();
  renderSvc();
  renderExt();
  renderTDC();
  renderDeu();
  renderAhorro();
  renderAhorroConfig();
  bloquearSiSnapshot();
  id('modo-lbl').textContent = S.modo==='QUINCENAL'?'Quincenal':'Semanal';
  id('hdr-date').textContent = new Date().toLocaleDateString('es-MX',{weekday:'short',day:'numeric',month:'short'});
}

// Bloquea botones de agregar/eliminar si vemos un periodo ya guardado
function bloquearSiSnapshot(){
  const snap = getSnapshotActual();
  const bloqueado = !!snap;
  // Botones de agregar en todas las secciones
  document.querySelectorAll('.add-btn').forEach(b=>{
    b.disabled = bloqueado;
    b.style.opacity = bloqueado ? '.3' : '';
    b.style.pointerEvents = bloqueado ? 'none' : '';
  });
  // Botón agregar tarjeta
  const tarBtn = document.querySelector('[onclick*="openModal(\'m-tar\')"]');
  if(tarBtn){ tarBtn.disabled = bloqueado; tarBtn.style.opacity = bloqueado?'.3':''; tarBtn.style.pointerEvents = bloqueado?'none':''; }
  // Botones de eliminar dentro de listas (× eliminar, × limpiar)
  document.querySelectorAll('.btn-danger, .ch-del, [onclick*="limpiar"], [onclick*="borrarSvc"], [onclick*="borrarExt"], [onclick*="borrarMov"], [onclick*="borrarMsi"], [onclick*="borrarDeu"], [onclick*="delTar"], [onclick*="delOtro"], [onclick*="toggleMov"], [onclick*="toggleMsi"], [onclick*="confirmarDelMsi"]').forEach(b=>{
    b.disabled = bloqueado;
    b.style.opacity = bloqueado ? '.3' : '';
    b.style.pointerEvents = bloqueado ? 'none' : '';
  });
  // Sueldo input
  const sueldoInput = id('sueldo-input');
  if(sueldoInput) sueldoInput.readOnly = bloqueado;
}

// ═══════════════════════════════════════════════════════
// ACCIONES
// ═══════════════════════════════════════════════════════
function getSueldoPeriodo(){
  if(S.sueldoFijo) return S.sueldo||0;
  const p = PERIODOS[S.periodoIdx];
  return p ? (S.sueldoPorPeriodo[p.lbl]||0) : 0;
}
function toggleFijo(){
  const p = PERIODOS[S.periodoIdx];
  if(S.sueldoFijo){
    // Turning OFF — save current sueldo only to this period
    if(p) S.sueldoPorPeriodo[p.lbl] = S.sueldo||0;
  } else {
    // Turning ON — take current period value as the fixed value
    if(p) S.sueldo = S.sueldoPorPeriodo[p.lbl]||0;
  }
  S.sueldoFijo = !S.sueldoFijo;
  save().catch(console.warn);
  renderPrincipal(); renderAhorroConfig();
}
function onSueldoChange(){
  const v = parseFloat(id('inp-sueldo').value)||0;
  const p = PERIODOS[S.periodoIdx];
  if(S.sueldoFijo){
    S.sueldo = v;
  } else {
    if(p) S.sueldoPorPeriodo[p.lbl] = v;
  }
  save().catch(console.warn);
  renderPrincipal(); renderAhorroConfig();
}

// CONFIG
function toggleCfgSection(el){
  const body = el.querySelector('.cfg-section-body');
  if(!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  el.classList.toggle('open', !isOpen);
}

function abrirConfig(){
  openModal('m-cfg');
  id('cfg-modo').value=S.modo;
  id('cfg-tema').value=S.tema||'clasico';
  id('cfg-tz').value=S.zonaHoraria||'auto';
  // Cargar día de cobro actual normalizado
  const diaActual = normalizarDiaSem(S.diaSem || 'Viernes');
  if(id('cfg-dia')) id('cfg-dia').value = diaActual;
  onModoChange();
  // Sincronizar checkboxes de secciones con el estado actual
  if(!S.secciones) S.secciones = {extras:true,servicios:true,tdc:true,msi:true,deudas:true,otros:true,divisas:false,ahorro:true};
  ['servicios','extras','tdc','msi','deudas','otros','divisas','ahorro'].forEach(key => {
    const chk = document.getElementById('sec-' + key);
    if(chk) chk.checked = S.secciones[key] !== false;
  });
  // Font size buttons
  aplicarFontSize(S.fontSize || 0);
  // Set section checkboxes
  const secs = S.secciones || {};
  ['servicios','extras','tdc','msi','deudas','otros','divisas','ahorro'].forEach(k=>{
    const cb = id('sec-'+k);
    if(cb) cb.checked = secs[k] !== false;
  });
  // Close all sections initially
  document.querySelectorAll('#m-cfg .cfg-section').forEach(s=>{
    s.classList.remove('open');
    const body = s.querySelector('.cfg-section-body');
    if(body) body.style.display='none';
  });
}
function onModoChange(){
  id('cfg-dia-wrap').style.display = id('cfg-modo').value==='SEMANAL'?'block':'none';
}
function aplicarTema(tema){
  document.body.classList.remove('theme-oscuro','theme-claro');
  if(tema==='oscuro') document.body.classList.add('theme-oscuro');
  else if(tema==='claro') document.body.classList.add('theme-claro');
  const metaTC = document.querySelector('meta[name="theme-color"]');
  if(metaTC){
    const colors = {clasico:'#0F1117', oscuro:'#000000', claro:'#F4F6F9'};
    metaTC.content = colors[tema]||colors.clasico;
  }
}

function setFontSize(level){
  S.fontSize = level;
  aplicarFontSize(level);
  localStorage.setItem('mf_fontSize_'+UID, level);
}
function aplicarFontSize(level){
  const html = document.documentElement;
  html.classList.remove('font-sz-1','font-sz-2','font-sz-3','font-sz-4');
  if(level > 0) html.classList.add('font-sz-'+level);
  const scales = [1, 1.25, 1.50, 2.00, 2.50];
  const scale = scales[level] || 1;
  // En desktop con zoom > 1, forzar layout mobile para que no se corte
  const wrapper = document.getElementById('app-wrapper');
  if(wrapper){
    if(scale > 1){
      // Forzar layout mobile: desactivar desktop flex, habilitar scroll
      wrapper.style.zoom = scale;
      html.classList.add('force-mobile');
    } else {
      wrapper.style.zoom = '';
      html.classList.remove('force-mobile');
    }
  }
  // Highlight active button
  document.querySelectorAll('.font-sz-btn').forEach(b=>{
    b.classList.toggle('on', parseInt(b.dataset.sz)===level);
  });
}
function aplicarSecciones(){
  const secs = S.secciones || {};
  // Indices según el orden actualizado de los .tab en HTML mobile:
  // (principal=0, extras=1, divisas=2, servicios=3, tdc=4, msi=5, deudas=6, otros=7, ahorro=8)
  const tabMap = {extras:1,divisas:2,servicios:3,tdc:4,msi:5,deudas:6,otros:7,ahorro:8};
  const tabs = document.querySelectorAll('.tab');
  const sbTabs = document.querySelectorAll('.sb-tab');

  Object.keys(tabMap).forEach(k=>{
    // Para divisas: por defecto OFF (opt-in)
    const visible = k === 'divisas' ? (secs[k] === true) : (secs[k] !== false);
    // Mobile tabs
    if(tabs[tabMap[k]]) tabs[tabMap[k]].style.display = visible ? '' : 'none';
    // Sidebar tabs
    sbTabs.forEach(sb=>{
      if(sb.dataset.tab === k) sb.style.display = visible ? '' : 'none';
    });
    // Screen
    const scr = document.getElementById('scr-'+k);
    if(scr) scr.style.display = visible ? '' : 'none';
    // Dashboard deduction/perception rows
    const rowMap = {servicios:'d-svc',tdc:'d-tdc',msi:'d-msi',deudas:'d-deu',otros:'d-otros',ahorro:'d-aho',extras:'p-extras'};
    const el = id(rowMap[k]);
    if(el){
      const row = el.closest('.row');
      if(row) row.style.display = visible ? '' : 'none';
    }
    // Tarjeta chiquita de USD en dashboard
    if(k === 'divisas'){
      const dCard = document.getElementById('dash-usd-card');
      if(dCard && !visible) dCard.style.display = 'none';
    }
  });

  // Ocultar sub-encabezados del sidebar cuando todas las secciones de su grupo
  // están ocultas. Grupos:
  const grupos = {
    percepciones: ['extras','divisas'],
    deducciones: ['servicios','tdc','msi','deudas','otros'],
    ahorro: ['ahorro']
  };
  Object.keys(grupos).forEach(grp => {
    const claves = grupos[grp];
    const algunaVisible = claves.some(k => {
      const v = k === 'divisas' ? (secs[k] === true) : (secs[k] !== false);
      return v;
    });
    document.querySelectorAll(`[data-section-group="${grp}"]`).forEach(el => {
      el.style.display = algunaVisible ? '' : 'none';
    });
  });

  // If current tab is hidden, go to principal
  const currentScr = document.querySelector('.scr.on');
  if(currentScr && currentScr.style.display === 'none'){
    goTabBtn('principal');
  }
}
function guardarConfig(){
  S.modo = id('cfg-modo').value;
  S.diaSem = normalizarDiaSem(id('cfg-dia').value);
  S.tema = id('cfg-tema').value;
  S.zonaHoraria = id('cfg-tz').value;
  // Read section checkboxes
  ['servicios','extras','tdc','msi','deudas','otros','divisas','ahorro'].forEach(k=>{
    const cb = id('sec-'+k);
    if(cb) S.secciones[k] = cb.checked;
  });
  aplicarTema(S.tema);
  aplicarSecciones();
  PERIODOS = calcPeriodosDesdeHoy();
  S.periodoIdx = 0;
  closeModal('m-cfg');
  save();
  saveConfigDB().catch(console.warn);
  renderAll();
}

// SERVICIOS
function onSvcFreqChange(){
  const v = id('svc-n').value;
  const wrapDia = id('svc-dia-wrap');
  const wrapProx = id('svc-prox-wrap');
  const wrapSem = id('svc-diasem-wrap');

  if(v === 'semanal'){
    if(wrapSem) wrapSem.style.display = 'block';
    if(wrapDia) wrapDia.style.display = 'none';
    if(wrapProx) wrapProx.style.display = 'none';
    id('svc-dia').value = '';
    id('svc-prox').value = '';
    return;
  }
  if(v === 'quincenal'){
    if(wrapSem) wrapSem.style.display = 'none';
    if(wrapDia) wrapDia.style.display = 'none';
    if(wrapProx) wrapProx.style.display = 'none';
    id('svc-dia').value = '';
    id('svc-prox').value = '';
    return;
  }
  const n = parseInt(v)||1;
  if(wrapSem) wrapSem.style.display = 'none';
  wrapDia.style.display = n === 1 ? 'block' : 'none';
  wrapProx.style.display = n > 1 ? 'block' : 'none';
  if(n === 1) id('svc-prox').value = '';
  if(n > 1) id('svc-dia').value = '';
}

async function guardarSvc(){
  const c=id('svc-c').value.trim(), m=parseFloat(id('svc-m').value)||0;
  const v = id('svc-n').value;
  if(!c||!m){alert('Concepto y monto son requeridos');return;}

  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const fechaAgregado = todayStr();
  // Capturar el periodo en el que está parado el usuario al agregar el servicio
  const periodoAgregadoLbl = (PERIODOS[S.periodoIdx] && PERIODOS[S.periodoIdx].lbl) || '';

  let svc;
  if(v === 'semanal'){
    const diaSem = id('svc-diasem').value || 'Lunes';
    svc = { concepto:c, monto:m, cadacuanto:0, diaPago:0, diaSemana: diaSem,
            freqSvc:'SEMANAL', fechaAgregado, periodoAgregadoLbl, proxPago:'' };
  } else if(v === 'quincenal'){
    svc = { concepto:c, monto:m, cadacuanto:0, diaPago:0, diaSemana:'',
            freqSvc:'QUINCENAL', fechaAgregado, periodoAgregadoLbl, proxPago:'' };
  } else {
    const n = parseInt(v)||1;
    const proxPago = id('svc-prox').value || '';
    let dia;
    if(n === 1){
      dia = parseInt(id('svc-dia').value)||0;
      if(!dia||dia<1||dia>31){alert('Día de pago requerido (1-31)');return;}
    } else {
      if(!proxPago){alert('Indica la fecha del próximo pago');return;}
      const proxDate = new Date(proxPago+'T12:00:00');
      dia = proxDate.getDate();
    }
    svc = { concepto:c, monto:m, cadacuanto:n, diaPago:dia, diaSemana:'',
            freqSvc:'MENSUAL', fechaAgregado, periodoAgregadoLbl, proxPago };
  }

  S.servicios.push(svc);
  await saveSvc(svc);
  save();
  id('svc-c').value=''; id('svc-m').value=''; id('svc-n').value='1'; id('svc-dia').value='';
  id('svc-prox').value=''; id('svc-prox-wrap').style.display='none';
  id('svc-dia-wrap').style.display='block';
  if(id('svc-diasem-wrap')) id('svc-diasem-wrap').style.display='none';
  closeModal('m-svc'); window.renderSvc(); renderPrincipal();
}
async function delSvc(i){
  if(confirm('¿Eliminar este servicio?')){
    const svc=S.servicios[i];
    try {
      if(svc.id){
        await supa.from('servicios').delete().eq('id', svc.id);
      } else {
        // Borrar la más reciente con mismo concepto
        const {data} = await supa.from('servicios').select('id')
          .eq('user_id', UID).eq('concepto', svc.concepto).limit(1);
        if(data && data[0]) await supa.from('servicios').delete().eq('id', data[0].id);
      }
    } catch(e){ console.error('delSvc error:', e); }
    S.servicios.splice(i,1);
    localStorage.setItem('finanzas_'+UID, JSON.stringify(S));
    window.renderSvc(); renderPrincipal();
  }
}
async function limpiarServicios(){
  if(confirm('¿Eliminar todos los servicios?')){
    try {
      const {error} = await supa.from('servicios').delete().eq('user_id', UID);
      if(error){
        alert('Error borrando de Supabase: ' + error.message);
        return;
      }
    } catch(e){
      alert('Error: ' + e.message);
      return;
    }
    S.servicios=[];
    localStorage.setItem('finanzas_'+UID, JSON.stringify(S));
    window.renderSvc(); renderPrincipal();
    alert('Servicios borrados correctamente');
  }
}

function guardarExt(){
  const c=id('ext-c').value.trim(), m=parseFloat(id('ext-m').value)||0, d=id('ext-d').value, f=id('ext-f').value;
  if(!c||!m){alert('Concepto y monto son requeridos');return;}
  const ext={concepto:c,monto:m,desc:d,fecha:f};
  S.extras.push(ext);
  saveExt(ext).catch(console.warn);
  save();
  id('ext-c').value=''; id('ext-m').value=''; id('ext-d').value=''; id('ext-f').value='';
  closeModal('m-ext'); window.renderExt(); renderPrincipal(); renderAhorroConfig();
}
function delExt(i){
  if(confirm('¿Eliminar este ingreso extra?')){
    const ext=S.extras[i];
    if(ext.id) delExtDB(ext.id).catch(console.warn);
    S.extras.splice(i,1); save(); window.renderExt(); renderPrincipal(); renderAhorroConfig();
  }
}
function limpiarExtras(){
  if(confirm('¿Eliminar todos los ingresos extra?')){
    supa.from('extras').delete().eq('user_id', UID).catch(console.warn);
    S.extras=[]; save(); window.renderExt(); renderPrincipal(); renderAhorroConfig();
  }
}

// MOVIMIENTOS
function guardarMov(){
  const tar=id('mov-tar').value, c=id('mov-c').value.trim(), m=parseFloat(id('mov-m').value)||0, f=id('mov-f').value, inc=id('mov-inc').value;
  if(!c||!m){alert('Concepto y monto son requeridos');return;}
  // Validar fecha después del corte
  if(f){
    const v = validarFechaMovimiento(tar, f);
    if(!v.ok){alert(v.msg);return;}
  }
  const mov={tarjeta:tar,concepto:c,monto:m,fecha:f,incluir:inc};
  S.movimientos.push(mov);
  saveMov(mov).catch(console.warn);
  save();
  id('mov-c').value=''; id('mov-m').value='';
  closeModal('m-mov'); window.renderTDC(); renderPrincipal();
}
function toggleMov(i){
  S.movimientos[i].incluir=S.movimientos[i].incluir==='SI'?'NO':'SI';
  updateMovDB(S.movimientos[i]).catch(console.warn);
  save(); window.renderTDC(); renderPrincipal();
}
function delMov(i){
  const mov=S.movimientos[i];
  if(mov.id) delMovDB(mov.id).catch(console.warn);
  S.movimientos.splice(i,1); save(); window.renderTDC(); renderPrincipal();
}
function limpiarMovimientos(){
  if(confirm('¿Limpiar todos los movimientos?')){
    supa.from('movimientos').delete().eq('user_id', UID).catch(console.warn);
    supa.from('msis').delete().eq('user_id', UID).catch(console.warn);
    S.movimientos=[]; S.msis=[]; save(); window.renderTDC(); renderPrincipal();
  }
}

// MSI
function setMsiTipo(t){
  id('msi-btn-n').classList.toggle('on',t==='nuevo');
  id('msi-btn-p').classList.toggle('on',t==='previo');
  id('msi-prev-f').style.display=t==='previo'?'block':'none';
}
function toggleMsiManual(){ id('msi-man-f').style.display=id('msi-nc').checked?'block':'none'; }
function calcMsiInfo(){
  const m=parseFloat(id('msi-m').value)||0, pl=parseInt(id('msi-pl').value)||0, pg=parseFloat(id('msi-pg').value)||0, f=id('msi-f').value;
  if(!f||!m||!pl||!pg){id('msi-info').textContent='Completa todos los campos para calcular.';return;}
  const inicio=new Date(f+'T12:00:00'), hoy=new Date();
  const mesesTransc=Math.max(0,Math.floor((hoy-inicio)/(1000*60*60*24*30.4)));
  const pagosH=Math.min(mesesTransc,pl);
  const saldo=Math.max(0,(pl-pagosH)*pg);
  id('msi-info').textContent=`Pago ${pagosH} de ${pl} · Pagado: ${mxn(pagosH*pg)} · Saldo: ${mxn(saldo)} · Faltan ${pl-pagosH} pagos`;
}
function calcMsiPago(){
  const m=parseFloat(id('msi-m').value)||0, pl=parseInt(id('msi-pl').value)||0;
  const box=id('msi-pago-info');
  if(!m||!pl){box.className='ibox';box.textContent='Ingresa monto y plazo para ver el pago mensual.';return;}
  const pago=m/pl;
  box.className='obox';
  box.textContent=`✓ Pago mensual: ${mxn(pago)} (${mxn(m)} ÷ ${pl} meses, sin intereses)`;
}

function toggleMsiPrev(val){
  id('msi-prev-f').style.display = val==='previo' ? 'block' : 'none';
}

function guardarMsi(){
  const tar=id('msi-tar').value, c=id('msi-c').value.trim();
  const m=parseFloat(id('msi-m').value)||0;
  const pl=parseInt(id('msi-pl').value)||0;
  const inc=id('msi-inc').value;
  const fechaCompra=id('msi-f').value;
  if(!c||!m||!pl){alert('Concepto, monto y plazo son requeridos');return;}
  if(!fechaCompra){alert('La fecha de compra es requerida');return;}
  const hoy=new Date(); hoy.setHours(0,0,0,0);
  const fComp=new Date(fechaCompra+'T12:00:00'); fComp.setHours(0,0,0,0);
  if(fComp>hoy){alert('No puedes agregar una fecha de compra futura');return;}
  const pago = m/pl;
  const esPrevio = id('msi-btn-p').value === 'previo';
  let pagoActual=1, saldoPendiente=m;
  if(esPrevio){
    if(id('msi-nc').checked){
      pagoActual=parseInt(id('msi-pa').value)||1;
      saldoPendiente=parseFloat(id('msi-sl').value)||m;
    } else {
      pagoActual=Math.min(pl,Math.max(1,Math.floor((hoy-fComp)/(1000*60*60*24*30.4))+1));
      saldoPendiente=Math.max(0,(pl-pagoActual+1)*pago);
    }
  }
  const fechaAgregado = todayStr();
  const msi={tarjeta:tar,concepto:c,monto:m,plazo:pl,pago,incluir:inc,
    pagoActual,saldoPendiente,fechaCompra,fechaAgregado};
  S.msis.push(msi);
  saveMsiDB(msi).catch(console.warn);
  save();
  id('msi-c').value=''; id('msi-m').value=''; id('msi-pl').value=''; id('msi-f').value='';
  id('msi-btn-p').value='nuevo'; id('msi-prev-f').style.display='none';
  closeModal('m-msi'); window.renderMsi(); window.renderTDC(); renderPrincipal();
}
function toggleMsi(i){
  S.msis[i].incluir=S.msis[i].incluir==='SI'?'NO':'SI';
  updateMsiDB(S.msis[i]).catch(console.warn);
  save(); window.renderTDC(); renderPrincipal();
}
function delMsi(i){
  const msi=S.msis[i];
  if(msi.id) delMsiDB(msi.id).catch(console.warn);
  S.msis.splice(i,1); save(); window.renderTDC(); renderPrincipal();
}

// TARJETAS
function guardarTar(){
  const n=id('tar-n').value.trim(), c=parseInt(id('tar-c').value)||5, p=parseInt(id('tar-p').value)||25;
  const modo=id('tar-modo').value, col=id('tar-col').value;
  if(!n){alert('Nombre requerido');return;}
  const tar={nombre:n,corte:c,pago:p,modo,color:col};
  S.tarjetas.push(tar);
  saveTar(tar).catch(console.warn);
  save();
  id('tar-n').value=''; id('tar-c').value=''; id('tar-p').value='';
  closeModal('m-tar'); window.renderTDC();
}
function delTar(i){
  if(confirm('¿Eliminar esta tarjeta y TODOS sus movimientos y MSI?')){
    const tar=S.tarjetas[i];
    const nombre=tar.nombre;
    // Borrar tarjeta de DB
    if(tar.id) delTarDB(tar.id).catch(console.warn);
    // Borrar todos los movimientos de esta tarjeta
    const movsDel = S.movimientos.filter(m=>m.tarjeta===nombre);
    movsDel.forEach(m=>{ if(m.id) supa.from('movimientos').delete().eq('id',m.id).catch(console.warn); });
    S.movimientos = S.movimientos.filter(m=>m.tarjeta!==nombre);
    // Borrar todos los MSI de esta tarjeta
    const msisDel = S.msis.filter(m=>m.tarjeta===nombre);
    msisDel.forEach(m=>{ if(m.id) supa.from('msis').delete().eq('id',m.id).catch(console.warn); });
    S.msis = S.msis.filter(m=>m.tarjeta!==nombre);
    // Borrar tarjeta del estado
    S.tarjetas.splice(i,1);
    // Reset filtro si era la tarjeta eliminada
    if(tdcFiltro===nombre) tdcFiltro='todas';
    save(); window.renderTDC(); renderPrincipal();
  }
}

// DEUDAS
function checkDeuFecha(){
  const v=id('deu-ini').value;
  const freq=id('deu-freq').value||'MENSUAL';
  const pl=parseInt(id('deu-pl').value)||0;
  const box=id('deu-fnote'); box.style.display='block';
  if(!v){ box.className='ibox'; box.textContent='Ingresa la fecha del primer pago.'; return; }
  const hoy=new Date(); hoy.setHours(0,0,0,0);
  const fIni=new Date(v+'T12:00:00'); fIni.setHours(0,0,0,0);

  if(fIni > hoy){
    box.className='ibox';
    box.textContent='Primer pago a futuro — se dividirá en quincenas hasta esa fecha.';
    return;
  }

  // Contar cuántos pagos ya han vencido
  function getNthFecha(n){
    if(freq==='MENSUAL'){
      const dia=fIni.getDate();
      const f=new Date(fIni.getFullYear(), fIni.getMonth()+n, dia);
      return f;
    } else if(freq==='QUINCENAL'){
      let y=fIni.getFullYear(), m=fIni.getMonth();
      let half=fIni.getDate()<=15?1:2, count=0;
      for(let i=0;i<200;i++){
        const finMes=new Date(y,m+1,0).getDate();
        const f=half===1?new Date(y,m,15):new Date(y,m,finMes);
        if(f>=fIni){ if(count===n) return f; count++; }
        half++; if(half>2){half=1;m++;if(m>11){m=0;y++;}}
      }
      return fIni;
    } else {
      const cursor=new Date(fIni);
      cursor.setDate(cursor.getDate()+n*7);
      return cursor;
    }
  }

  let pagosVencidos=0;
  for(let n=0; n<(pl||60); n++){
    const fp=getNthFecha(n); fp.setHours(0,0,0,0);
    if(fp<=hoy) pagosVencidos=n+1;
    else break;
  }

  if(pagosVencidos===0){
    box.className='obox'; box.textContent='Primer pago hoy — se contabiliza en este periodo.';
  } else {
    box.className='wbox';
    box.textContent=`Fecha pasada — se detectan automáticamente ${pagosVencidos} pago${pagosVencidos>1?'s':''} ya realizados. No necesitas ingresar nada más.`;
  }
}
function setDeuFreq(){
  const v=id('deu-freq').value;
  id('deu-dia-s-w').style.display=v==='SEMANAL'?'block':'none';
}
function toggleDeuPrev(){ id('deu-prev-b').style.display=id('deu-prev').value==='si'?'block':'none'; }
function calcDeuInfo(){
  const m=parseFloat(id('deu-m').value)||0, pl=parseInt(id('deu-pl').value)||0, pg=parseFloat(id('deu-pg').value)||0;
  const box=id('deu-info');
  if(!m||!pl||!pg){box.style.display='none';return;}
  const total=pg*pl, int=Math.max(0,total-m);
  const tasa=int>0?(int/m/(pl/12)*100):0;
  box.style.display='block'; box.className='ibox';
  box.innerHTML=`Total a pagar: <strong>${mxn(total)}</strong> · Interés: <strong>${mxn(int)}</strong> · Tasa aprox: <strong>${tasa.toFixed(1)}% anual</strong>`;
}
function calcDeuSaldo(){
  const pg=parseFloat(id('deu-pg').value)||0, n=parseInt(id('deu-np').value)||0, m=parseFloat(id('deu-m').value)||0;
  const saldo=Math.max(0,m-pg*n);
  if(!document.activeElement.isSameNode(id('deu-sl'))) id('deu-sl').value=saldo||'';
  const box=id('deu-saldo-info'); box.style.display='block';
  box.textContent=`${n} pagos × ${mxn(pg)} = ${mxn(pg*n)} pagados · Saldo est.: ${mxn(saldo)}`;
}
function guardarDeu(){
  const tipo = (id('deu-tipo')?.value)||'normal';

  if(tipo === 'tanda'){
    guardarTanda();
    return;
  }

  const c=id('deu-c').value.trim(), m=parseFloat(id('deu-m').value)||0, pl=parseInt(id('deu-pl').value)||0;
  const pg=parseFloat(id('deu-pg').value)||0, freq=id('deu-freq').value;
  const ini=id('deu-ini').value, adq=id('deu-adq').value;
  if(!c||!m||!pl||!pg){alert('Completa todos los campos requeridos');return;}
  if(!ini){alert('La fecha del primer pago es requerida');return;}
  const fechaAgregado = todayStr();
  // El día de pago se extrae directo de la fecha ini
  const deu={concepto:c, monto:m, plazo:pl, pago:pg, freq, ini, adq, fechaAgregado, tipo:'normal'};
  S.deudas.push(deu);
  saveDeuDB(deu).catch(console.warn);
  save();
  id('deu-c').value=''; id('deu-m').value=''; id('deu-pl').value=''; id('deu-pg').value='';
  id('deu-fnote').style.display='none'; id('deu-info').style.display='none';
  closeModal('m-deu'); window.renderDeu(); renderPrincipal();
}
function delDeu(i){
  if(confirm('¿Eliminar esta deuda?')){
    const deu=S.deudas[i];
    if(deu.id) delDeuDB(deu.id).catch(console.warn);
    S.deudas.splice(i,1); save(); window.renderDeu(); renderPrincipal();
  }
}
function limpiarDeudas(){
  if(confirm('¿Eliminar todas las deudas?')){
    supa.from('deudas').delete().eq('user_id', UID).catch(console.warn);
    S.deudas=[]; save(); window.renderDeu(); renderPrincipal();
  }
}

// ═══════════════════════════════════════════════════════
// OTROS GASTOS — gastos del periodo, opcionales fijos
// ═══════════════════════════════════════════════════════
function toggleOtrosFijo(){
  id('otros-fijo-fecha').style.display = id('otros-fijo').value==='fecha' ? 'block' : 'none';
}

// Abre el modal "Nuevo gasto" decidiendo si se muestra la sección de pago en USD
function abrirOtros(){
  // La sección USD aparece solo si Divisas está activa.
  // Y si NO hay USD acumulados, mostramos un avisito en lugar del checkbox.
  const sec = document.getElementById('otros-usd-section');
  const divisasActiva = !!(S.secciones && S.secciones.divisas === true);
  if(sec){
    if(!divisasActiva){
      sec.style.display = 'none';
    } else {
      sec.style.display = '';
      // Si no hay USD acumulados, deshabilitar el checkbox y mostrar nota
      const acum = (typeof divisasAcumuladoUSD === 'function') ? divisasAcumuladoUSD() : 0;
      const chk = document.getElementById('otros-usd-chk');
      const wrap = document.getElementById('otros-usd-wrap');
      if(chk){
        if(acum <= 0){
          chk.checked = false;
          chk.disabled = true;
          chk.parentElement.style.opacity = '.5';
          chk.parentElement.title = 'No tienes dólares acumulados';
          if(wrap) wrap.style.display = 'none';
          // Asegurar nota
          if(!document.getElementById('otros-usd-nodisp')){
            const nota = document.createElement('div');
            nota.id = 'otros-usd-nodisp';
            nota.style.cssText = 'font-size:10.5px;color:var(--text3);margin-top:-6px;margin-bottom:8px;padding-left:24px';
            nota.textContent = 'Sin dólares acumulados — agrégalos primero en la sección Divisas.';
            chk.parentElement.parentElement.parentElement.appendChild(nota);
          }
        } else {
          chk.disabled = false;
          chk.parentElement.style.opacity = '';
          chk.parentElement.title = '';
          // Quitar nota si existía
          const nota = document.getElementById('otros-usd-nodisp');
          if(nota) nota.remove();
        }
      }
    }
  }
  // Resetear campos al abrir
  const today = todayStr();
  if(id('otros-c')) id('otros-c').value = '';
  if(id('otros-m')) id('otros-m').value = '';
  if(id('otros-f')) id('otros-f').value = today;
  if(id('otros-fijo')) id('otros-fijo').value = 'no';
  if(id('otros-fijo-fecha')) id('otros-fijo-fecha').style.display = 'none';
  // Limpiar campos USD
  const usdChk = document.getElementById('otros-usd-chk');
  if(usdChk && !usdChk.disabled) usdChk.checked = false;
  const usdWrap = document.getElementById('otros-usd-wrap');
  if(usdWrap) usdWrap.style.display = 'none';
  if(document.getElementById('otros-usd-pago')) document.getElementById('otros-usd-pago').value = '';
  if(document.getElementById('otros-usd-cambio')) document.getElementById('otros-usd-cambio').value = '';
  const prev = document.getElementById('otros-usd-preview');
  if(prev) prev.style.display = 'none';

  openModal('m-otros');
}

// Toggle "Pagué con dólares"
function toggleOtrosUsd(){
  const chk = document.getElementById('otros-usd-chk');
  const wrap = document.getElementById('otros-usd-wrap');
  if(!wrap) return;
  wrap.style.display = chk && chk.checked ? '' : 'none';
  // Asegurar TC actualizado al activar
  if(chk && chk.checked && typeof divisasFetchTC === 'function'){
    divisasFetchTC().then(actualizarPreviewOtrosUsd).catch(()=>{});
  }
}

function actualizarPreviewOtrosUsd(){
  const m = parseFloat(document.getElementById('otros-m').value)||0;
  const usd = parseFloat(document.getElementById('otros-usd-pago').value)||0;
  const cambio = parseFloat(document.getElementById('otros-usd-cambio').value)||0;
  const prev = document.getElementById('otros-usd-preview');
  const totalEl = document.getElementById('otros-usd-total');
  const tcEl = document.getElementById('otros-usd-tc');
  const merEl = document.getElementById('otros-usd-mercado-info');
  if(!m || !usd || usd<=0){ if(prev) prev.style.display='none'; return; }
  // Total en MXN = monto del gasto + cambio recibido
  const totalMxn = m + cambio;
  const tcAplicado = totalMxn / usd;
  if(prev) prev.style.display = '';
  if(totalEl) totalEl.textContent = `MXN $${totalMxn.toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  if(tcEl) tcEl.textContent = `$${tcAplicado.toFixed(4)} MXN/USD`;
  if(merEl){
    const tcMercado = (typeof TC_USD_MXN !== 'undefined' && TC_USD_MXN) ? TC_USD_MXN : 0;
    if(tcMercado){
      const dif = (tcAplicado - tcMercado);
      const signo = dif >= 0 ? '+' : '';
      const color = dif >= 0 ? 'var(--green)' : 'var(--red)';
      merEl.innerHTML = ` · Mercado: <strong>$${tcMercado.toFixed(4)}</strong> · Diferencia: <strong style="color:${color}">${signo}$${dif.toFixed(4)} MXN</strong>`;
    } else { merEl.innerHTML = ''; }
  }
}

async function guardarOtro(){
  const c=id('otros-c').value.trim(), m=parseFloat(id('otros-m').value)||0;
  const fecha=id('otros-f').value;
  if(!c||!m){alert('Concepto y monto son requeridos');return;}
  if(!fecha){alert('La fecha es requerida');return;}
  // Comparar como strings YYYY-MM-DD para evitar problemas de zona horaria
  const hoyStr = (function(){
    const h = new Date();
    const y = h.getFullYear();
    const m2 = String(h.getMonth()+1).padStart(2,'0');
    const d = String(h.getDate()).padStart(2,'0');
    return `${y}-${m2}-${d}`;
  })();
  if(fecha > hoyStr){alert('La fecha no puede ser futura');return;}

  // ── Validar pago en USD ──
  const usdChk = document.getElementById('otros-usd-chk');
  const divisasActiva = !!(S.secciones && S.secciones.divisas === true);
  // Solo procesar pago en USD si Divisas está activa Y el checkbox está marcado
  const pagaUsd = !!(divisasActiva && usdChk && usdChk.checked && !usdChk.disabled);
  let usdPago = 0, mxnCambio = 0, tcAplicado = 0;
  if(pagaUsd){
    usdPago = parseFloat(document.getElementById('otros-usd-pago').value)||0;
    mxnCambio = parseFloat(document.getElementById('otros-usd-cambio').value)||0;
    if(usdPago <= 0){ alert('Indica cuántos USD entregaste'); return; }
    if(mxnCambio < 0){ alert('El cambio no puede ser negativo'); return; }
    // Validar que tengas suficientes USD acumulados
    if(typeof divisasAcumuladoUSD === 'function'){
      const acum = divisasAcumuladoUSD();
      if(usdPago > acum){
        alert(`Fondos insuficientes en dólares.\n\nIntentas usar USD $${usdPago.toFixed(2)} pero solo tienes USD $${acum.toFixed(2)} acumulados.`);
        return;
      }
    }
    // TC aplicado = (monto del gasto + cambio) / usd entregado
    tcAplicado = (m + mxnCambio) / usdPago;
  }

  const fijoMode=id('otros-fijo').value;
  const gasto={
    id: 'otro_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
    concepto:c, monto:m, fecha,
    periodoIdx: S.periodoIdx,
    fijo: fijoMode !== 'no',
    fijoHasta: fijoMode==='fecha' ? id('otros-hasta').value : null,
    fijoIndef: fijoMode==='indef'
  };

  // ── Si se pagó con USD: crear movimiento de divisas + extra de cambio (si aplica) ──
  let divisaMovId = null;
  let extraCambioId = null;
  if(pagaUsd){
    const periodoLbl = (PERIODOS[S.periodoIdx] && PERIODOS[S.periodoIdx].lbl) || '';
    const tcMercado = (typeof TC_USD_MXN !== 'undefined' && TC_USD_MXN) ? TC_USD_MXN : null;

    // 1) Si hay cambio devuelto en MXN, crear EXTRA de percepción
    if(mxnCambio > 0){
      try {
        const extraConcepto = `Cambio del gasto "${c}" (USD $${usdPago.toFixed(2)} a $${tcAplicado.toFixed(2)} MXN/USD)`;
        const {data:extraData, error:extraErr} = await supa.from('extras').insert({
          user_id: UID, concepto: extraConcepto, monto: mxnCambio,
          descripcion: '', fecha: fecha,
          periodo_idx: S.periodoIdx
        }).select().single();
        if(extraErr) throw extraErr;
        if(extraData){
          extraCambioId = extraData.id;
          if(!S.extras) S.extras = [];
          S.extras.push({ id: extraCambioId, concepto: extraConcepto, monto: mxnCambio, desc: '', fecha });
        }
      } catch(e){ console.warn('crear extra cambio:', e); alert('Error al guardar el extra del cambio'); return; }
    }

    // 2) Crear movimiento "cambio" en divisas_movs (negativo en USD)
    try {
      const movConcepto = `Gasto en MXN "${c}" pagado con USD`;
      const {data:movData, error:movErr} = await supa.from('divisas_movs').insert({
        user_id: UID, tipo: 'cambio',
        concepto: movConcepto,
        monto_usd: -Math.abs(usdPago),
        monto_mxn: m + mxnCambio,  // total que valió el cambio
        tc_aplicado: tcAplicado,
        tc_mercado: tcMercado,
        fecha: fecha,
        periodo_lbl: periodoLbl,
        extra_id: extraCambioId != null ? String(extraCambioId) : null,
        periodo_idx: S.periodoIdx
      }).select().single();
      if(movErr) throw movErr;
      if(movData) divisaMovId = movData.id;
    } catch(e){
      console.warn('crear mov divisa:', e);
      // ROLLBACK del extra
      if(extraCambioId != null){
        try {
          await supa.from('extras').delete().eq('id', extraCambioId);
          if(S.extras) S.extras = S.extras.filter(x => x.id !== extraCambioId);
        } catch(rb){}
      }
      alert('Error al guardar el movimiento de divisas. Se canceló todo.');
      return;
    }

    // Vincular el gasto con el mov de divisas y el extra (para borrado en cascada)
    gasto.divisaMovId = divisaMovId;
    gasto.extraCambioId = extraCambioId;
    gasto.usdPago = usdPago;
    gasto.mxnCambio = mxnCambio;
    gasto.tcAplicado = tcAplicado;
  }

  S.otrosGastos.push(gasto);
  save();

  // Limpiar form
  id('otros-c').value=''; id('otros-m').value=''; id('otros-f').value='';
  id('otros-fijo').value='no'; id('otros-fijo-fecha').style.display='none';
  if(usdChk) usdChk.checked = false;
  document.getElementById('otros-usd-wrap').style.display = 'none';
  document.getElementById('otros-usd-pago').value = '';
  document.getElementById('otros-usd-cambio').value = '';

  closeModal('m-otros');
  window.renderOtros();
  if(typeof window.renderExt === 'function') window.renderExt();
  if(typeof renderDivisas === 'function') renderDivisas().catch(()=>{});
  renderPrincipal();
}
async function delOtro(i){
  const g = S.otrosGastos[i];
  if(!g){ return; }
  // Si el gasto tiene pago en USD vinculado, preguntar
  if(g.divisaMovId || g.extraCambioId){
    const r = confirm(
      `Este gasto se pagó con dólares. Al borrarlo:\n\n` +
      `• Se devolverán USD $${(g.usdPago||0).toFixed(2)} a tu acumulado\n` +
      (g.extraCambioId ? `• Se eliminará el extra del cambio (MXN $${(g.mxnCambio||0).toFixed(2)})\n` : '') +
      `\n¿Continuar?`
    );
    if(!r) return;
    // Borrar mov divisa
    if(g.divisaMovId){
      try { await supa.from('divisas_movs').delete().eq('id', g.divisaMovId); } catch(e){ console.warn('del mov:', e); }
    }
    // Borrar extra del cambio
    if(g.extraCambioId){
      try { await supa.from('extras').delete().eq('id', g.extraCambioId); } catch(e){ console.warn('del extra:', e); }
      if(S.extras) S.extras = S.extras.filter(x => x.id !== g.extraCambioId);
    }
  }
  S.otrosGastos.splice(i,1);
  save();
  window.renderOtros();
  if(typeof window.renderExt === 'function') window.renderExt();
  if(typeof renderDivisas === 'function') renderDivisas().catch(()=>{});
  renderPrincipal();
}
function toggleOtroFijo(i){
  const g = S.otrosGastos[i];
  if(g.fijo || g.fijoIndef){
    g.fijo = false; g.fijoIndef = false; g.fijoHasta = null;
  } else {
    g.fijo = true; g.fijoIndef = true;
  }
  save(); window.renderOtros(); renderPrincipal();
}
function limpiarOtros(){
  if(confirm('¿Eliminar todos los gastos extra del periodo?')){
    // Solo eliminar los del periodo actual (no los fijos de otros periodos)
    S.otrosGastos = S.otrosGastos.filter(g => !gastoVisibleEnPeriodo(g));
    save(); window.renderOtros(); renderPrincipal();
  }
}
function gastoVisibleEnPeriodo(g){
  const idx = S.periodoIdx;
  // ¿Se creó en este periodo?
  if(g.periodoIdx === idx) return true;
  // ¿Es fijo?
  if(!g.fijo && !g.fijoIndef) return false;
  // ¿Creado antes de este periodo?
  if(g.periodoIdx > idx) return false;
  // Si tiene fecha límite, ¿ya pasó?
  if(g.fijoHasta){
    const p = PERIODOS[idx];
    if(!p) return false;
    const hasta = new Date(g.fijoHasta+'T12:00:00'); hasta.setHours(0,0,0,0);
    return p.ini <= hasta;
  }
  // Indefinido
  return true;
}
function calcTotalOtros(){
  return S.otrosGastos.filter(g => gastoVisibleEnPeriodo(g)).reduce((a,g)=>a+g.monto,0);
}
window.renderOtros = function(){
  const list = id('otros-list');
  if(!list) return;
  const visibles = S.otrosGastos.filter((g,i)=>gastoVisibleEnPeriodo(g));
  if(!visibles.length){
    list.innerHTML='<div class="empty"><div class="empty-icon">—</div>Sin gastos extra — agrega el primero</div>';
    if(id('tot-otros')) id('tot-otros').textContent='$0.00';
    return;
  }
  list.innerHTML = visibles.map(g=>{
    const i = S.otrosGastos.indexOf(g);
    const fijoLabel = g.fijoIndef ? 'Fijo indefinido' : g.fijo ? `Fijo hasta ${g.fijoHasta}` : 'Solo este periodo';
    const usdInfo = g.usdPago ? `<div style="font-size:10.5px;color:var(--green);margin-top:2px">💵 Pagado con USD $${g.usdPago.toFixed(2)} · TC $${(g.tcAplicado||0).toFixed(2)}${g.mxnCambio>0?` · Cambio: $${g.mxnCambio.toFixed(2)} MXN`:''}</div>` : '';
    return `<div class="ext-item">
      <div class="ext-dot" style="background:var(--amber)"></div>
      <div class="ext-info">
        <div class="ext-name">${g.concepto}</div>
        <div class="ext-desc">${g.fecha||''} · <span style="cursor:pointer;color:${g.fijo||g.fijoIndef?'var(--teal)':'var(--text3)'}" onclick="toggleOtroFijo(${i})">${fijoLabel}</span></div>
        ${usdInfo}
      </div>
      <div class="ext-right">
        <div class="ext-a" style="color:var(--amber)">-${mxn(g.monto)}</div>
      </div>
      <span class="ch-del" onclick="delOtro(${i})">×</span>
    </div>`;
  }).join('');
  if(id('tot-otros')) id('tot-otros').textContent='-'+mxn(calcTotalOtros());
};

// AHORRO
function setAhoModo(m){
  S.ahoModo=m; save();
  id('msw-pct').classList.toggle('on',m==='pct');
  id('msw-fix').classList.toggle('on',m==='fix');
  id('aho-pct-block').style.display=m==='pct'?'block':'none';
  id('aho-fix-block').style.display=m==='fix'?'block':'none';
}
function onPctChange(v){
  v=parseInt(v); S.ahoPct=v; save();
  id('pct-lbl').textContent=v+'%';
  id('ring-lbl').textContent=v+'%';
  const dash=163.4;
  id('ring-arc').setAttribute('stroke-dashoffset',(dash-(dash*v/30)).toFixed(1));
  const perc=calcTotalPerc(), base=Math.round(perc*v/100);
  S.ahoMonto=base; save();
  id('aho-amt').textContent=mxn(base);
  id('aho-inp').value=base;
  id('aho-inp').min=base;
  id('aho-box').className='ibox';
  id('aho-box').textContent='Presiona Enter en el campo de abajo para confirmar o ajustar.';
  renderPrincipal();
}
function validarAho(el){
  const perc=calcTotalPerc(), pct=S.ahoPct||10;
  const base=Math.round(perc*pct/100), val=parseInt(el.value)||0;
  if(val<base){
    el.value=base;
    id('aho-box').className='wbox';
    id('aho-box').textContent=`— No puede ser menor al mínimo de ${mxn(base)} (${pct}%)`;
  } else {
    S.ahoMonto=val; save();
    const extra=val-base;
    id('aho-box').className='obox';
    id('aho-box').textContent=extra>0
      ? `✓ Guardas ${mxn(val)} — incluyes ${mxn(extra)} extra vs tu mínimo del ${pct}%`
      : `✓ Monto exacto del ${pct}% — perfecto`;
    renderPrincipal();
  }
}
function onAhoFijoChange(){
  const v=parseFloat(id('aho-fijo').value)||0;
  S.ahoMonto=v; save();
  const perc=calcTotalPerc();
  id('aho-pct-eq').value=perc>0?(v/perc*100).toFixed(1)+'% de percepciones':'—';
  renderPrincipal();
}

// ═══════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════
// SIDEBAR DESKTOP
// ═══════════════════════════════════════════════════════
function goSidebar(tabId, btn){
  goTab(tabId, null);
  document.querySelectorAll('.sb-tab').forEach(b=>b.classList.remove('on'));
  document.querySelectorAll('.tab').forEach(b=>b.classList.remove('on'));
  if(btn) btn.classList.add('on');
  const tabMap={principal:0,servicios:1,extras:2,tdc:3,msi:4,deudas:5,otros:6,ahorro:7};
  const mTabs=document.querySelectorAll('.tab');
  if(mTabs[tabMap[tabId]]) mTabs[tabMap[tabId]].classList.add('on');
  // Show desktop topbar for current screen — solo en desktop
  document.querySelectorAll('.desktop-topbar').forEach(t=>t.style.display='none');
  setTimeout(()=>{
    if(window.innerWidth >= 1080){
      document.querySelectorAll('.scr.on .desktop-topbar').forEach(t=>t.style.display='');
    }
  },10);
}

function syncSidebarAlert(){
  const sbAlert = id('sb-alert');
  if(!sbAlert) return;
  const alertEl = id('cobro-alert');
  const cls = alertEl.className.replace('alert','').trim();
  sbAlert.className = 'sb-alert ' + cls;
  sbAlert.textContent = id('cobro-txt').textContent;
}

function updateDates(){
  const fmt = new Date().toLocaleDateString('es-MX',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
  const short = new Date().toLocaleDateString('es-MX',{weekday:'short',day:'numeric',month:'short'});
  if(id('hdr-date')) id('hdr-date').textContent = short;
  if(id('sb-date')) id('sb-date').textContent = fmt;
  document.querySelectorAll('[id^=dt-date]').forEach(el=>el.textContent=fmt);
}

// ═══════════════════════════════════════════════════════
// BORRADO GLOBAL — funciones onclick directas
// ═══════════════════════════════════════════════════════
window.borrarSvc = async function(i){
  const item = S.servicios[i];
  if(item && item.id){
    const {error} = await supa.from('servicios').delete().eq('id', item.id);
    if(error) console.error('borrarSvc error:', error.message);
  }
  S.servicios.splice(i,1);
  localStorage.setItem('finanzas_'+UID, JSON.stringify(S));
  window.renderSvc(); renderPrincipal();
};
window.borrarExt = async function(i){
  const item = S.extras[i];
  if(item && item.id) await supa.from('extras').delete().eq('id', item.id);
  S.extras.splice(i,1);
  localStorage.setItem('finanzas_'+UID, JSON.stringify(S));
  window.renderExt(); renderPrincipal(); renderAhorroConfig();
};
window.borrarMov = async function(i){
  const item = S.movimientos[i];
  if(item && item.id) await supa.from('movimientos').delete().eq('id', item.id);
  S.movimientos.splice(i,1);
  localStorage.setItem('finanzas_'+UID, JSON.stringify(S));
  window.renderTDC(); renderPrincipal();
};
window.borrarMsi = async function(i){
  const item = S.msis[i];
  if(item && item.id) await supa.from('msis').delete().eq('id', item.id);
  S.msis.splice(i,1);
  localStorage.setItem('finanzas_'+UID, JSON.stringify(S));
  window.renderTDC(); renderPrincipal();
};
window.borrarDeu = async function(i){
  if(!confirm('¿Eliminar esta deuda?')) return;
  const item = S.deudas[i];
  if(item && item.id) await supa.from('deudas').delete().eq('id', item.id);
  S.deudas.splice(i,1);
  localStorage.setItem('finanzas_'+UID, JSON.stringify(S));
  window.renderDeu(); renderPrincipal();
};
window.toggleMov = async function(i){
  S.movimientos[i].incluir = S.movimientos[i].incluir==='SI'?'NO':'SI';
  if(S.movimientos[i].id) await supa.from('movimientos').update({incluir:S.movimientos[i].incluir}).eq('id',S.movimientos[i].id);
  save(); window.renderTDC(); renderPrincipal();
};
window.toggleMsi = async function(i){
  S.msis[i].incluir = S.msis[i].incluir==='SI'?'NO':'SI';
  if(S.msis[i].id) await supa.from('msis').update({incluir:S.msis[i].incluir}).eq('id',S.msis[i].id);
  save(); window.renderTDC(); renderPrincipal();
};

// ═══════════════════════════════════════════════════════
// EVENT DELEGATION — fallback for any remaining data-action buttons
// ═══════════════════════════════════════════════════════
document.addEventListener('click', function(e){
  const t = e.target;
  // data-action attribute approach
  const action = t.dataset.action || t.closest('[data-action]')?.dataset.action;
  const idx = parseInt(t.dataset.idx ?? t.closest('[data-action]')?.dataset.idx);

  if(!action) return;

  if(action==='del-svc'){
    const item=S.servicios[idx];
    if(item&&item.id) supa.from('servicios').delete().eq('id',item.id).catch(console.warn);
    S.servicios.splice(idx,1);
    localStorage.setItem('finanzas_'+UID, JSON.stringify(S));
    window.renderSvc();renderPrincipal();
  }
  else if(action==='del-ext'){
    const item=S.extras[idx];
    if(item&&item.id) supa.from('extras').delete().eq('id',item.id).catch(console.warn);
    S.extras.splice(idx,1);
    localStorage.setItem('finanzas_'+UID, JSON.stringify(S));
    window.renderExt();renderPrincipal();renderAhorroConfig();
  }
  else if(action==='del-mov'){
    const item=S.movimientos[idx];
    if(item&&item.id) supa.from('movimientos').delete().eq('id',item.id).catch(console.warn);
    S.movimientos.splice(idx,1);
    localStorage.setItem('finanzas_'+UID, JSON.stringify(S));
    renderTDC();renderPrincipal();
  }
  else if(action==='del-msi'){
    const item=S.msis[idx];
    if(item&&item.id) supa.from('msis').delete().eq('id',item.id).catch(console.warn);
    S.msis.splice(idx,1);
    localStorage.setItem('finanzas_'+UID, JSON.stringify(S));
    renderTDC();renderPrincipal();
  }
  else if(action==='del-tar'){ delTar(idx); }
  else if(action==='del-deu'){
    if(confirm('¿Eliminar esta deuda?')){
      const item=S.deudas[idx];
      if(item&&item.id) supa.from('deudas').delete().eq('id',item.id).catch(console.warn);
      S.deudas.splice(idx,1);
      localStorage.setItem('finanzas_'+UID, JSON.stringify(S));
      renderDeu();renderPrincipal();
    }
  }
  else if(action==='tog-mov'){
    S.movimientos[idx].incluir=S.movimientos[idx].incluir==='SI'?'NO':'SI';
    if(S.movimientos[idx].id) supa.from('movimientos').update({incluir:S.movimientos[idx].incluir}).eq('id',S.movimientos[idx].id).catch(console.warn);
    save();renderTDC();renderPrincipal();
  }
  else if(action==='tog-msi'){
    S.msis[idx].incluir=S.msis[idx].incluir==='SI'?'NO':'SI';
    if(S.msis[idx].id) supa.from('msis').update({incluir:S.msis[idx].incluir}).eq('id',S.msis[idx].id).catch(console.warn);
    save();renderTDC();renderPrincipal();
  }
});

// Override old inline-onclick render functions to use data-action instead
// Patch renderSvc
const _origRenderSvc = renderSvc;
window.renderSvc = function(){
  const list = id('svc-list');
  const label = S.modo==='QUINCENAL'?'quincena':'semana';
  if(!S.servicios.length){
    list.innerHTML='<div class="empty"><div class="empty-icon">—</div>Sin servicios — agrega el primero</div>';
    id('tot-svc').textContent='$0.00'; return;
  }
  // Filtrar servicios que no aplican a este periodo (creados en periodo posterior)
  const visibles = S.servicios.map((s,i)=>({s,i,calc:calcSvcEnPeriodo(s)})).filter(o=>o.calc!==null);
  if(!visibles.length){
    list.innerHTML='<div class="empty"><div class="empty-icon">—</div>Sin servicios activos en este periodo</div>';
    id('tot-svc').textContent='$0.00'; return;
  }

  list.innerHTML = visibles.map(({s,i,calc})=>{
    // Respetar freqSvc: SEMANAL / QUINCENAL / MENSUAL+
    const freq = s.freqSvc==='SEMANAL' ? 'Semanal'+(s.diaSemana?' · '+s.diaSemana:'')
              : s.freqSvc==='QUINCENAL' ? 'Quincenal'
              : freqLabel(s.cadacuanto||1);
    // Sub-label: usar S/Q según el modo del usuario
    const subLetra = S.modo==='SEMANAL' ? 'S' : 'Q';
    // Mostrar S/Q solo cuando aporta info: NO mostrar si freq y modo coinciden trivialmente
    // (servicio semanal + modo semanal = siempre 1/1, redundante)
    const ocultarSub = (s.freqSvc==='SEMANAL' && S.modo==='SEMANAL') ||
                       (s.freqSvc==='QUINCENAL' && S.modo==='QUINCENAL');
    const sublbl = (!ocultarSub && calc && calc.nTotal>=1) ? `${subLetra}${calc.quincenaActual}/${calc.nTotal}` : '';
    const proxFecha = calcProxPagoSvc(s);
    // Solo mostrar día N en MENSUAL+ (no en SEMANAL ni QUINCENAL)
    const diaInfo = (s.freqSvc!=='SEMANAL' && s.freqSvc!=='QUINCENAL' && s.diaPago) ? ' · día '+s.diaPago : '';
    // Monto a la derecha: SEMANAL/QUINCENAL no es "/mes"
    const montoLbl = s.freqSvc==='SEMANAL' ? '/sem'
                  : s.freqSvc==='QUINCENAL' ? '/quinc'
                  : ((s.cadacuanto||1)>1?'/'+s.cadacuanto+'m':'/mes');
    return `<div class="svc">
      <div class="svc-info">
        <div class="svc-name">${s.concepto}</div>
        <div class="svc-sub">${freq}${diaInfo}${sublbl?' · '+sublbl:''}</div>
        ${proxFecha?`<div style="font-size:11px;color:var(--text2);margin-top:3px">Próximo pago: <strong style="color:var(--text)">${proxFecha}</strong></div>`:''}
      </div>
      <div class="svc-right">
        <div style="font-size:13px;font-weight:700;font-family:var(--mono);color:var(--text2)">${mxn(s.monto)}${montoLbl}</div>
        <div style="font-size:11px;color:var(--teal);margin-top:2px">-${mxn(calc?calc.pagoQuincena:0)} / ${label}</div>
      </div>
      <span class="ch-del" onclick="borrarSvc(${i})">×</span>
    </div>`;
  }).join('');
  id('tot-svc').textContent = '-'+mxn(calcTotalSvc());
};

const _origRenderExt = renderExt;
window.renderExt = function(){
  const list = id('ext-list');
  if(!S.extras.length){
    list.innerHTML='<div class="empty"><div class="empty-icon">—</div>Sin ingresos extra este periodo</div>';
    id('tot-ext').textContent='$0.00'; return;
  }
  list.innerHTML = S.extras.map((e,i)=>`
    <div class="ext-item">
      <div class="ext-dot"></div>
      <div class="ext-info">
        <div class="ext-name">${e.concepto}</div>
        <div class="ext-desc">${e.fecha||''} · ${e.desc||''}</div>
      </div>
      <div class="ext-right">
        <div class="ext-a">+${mxn(e.monto)}</div>
      </div>
      <span class="ch-del" onclick="borrarExt(${i})" title="Eliminar">×</span>
    </div>`).join('');
  id('tot-ext').textContent = '+'+mxn(calcTotalExtras());
};

const _origRenderTDC = renderTDC;
let tdcFiltro = 'todas';
function setTdcFiltro(val){ tdcFiltro=val; window.renderTDC(); }

window.renderTDC = function(){
  const cardsEl = id('tdc-cards-list');
  const hoy = new Date(); hoy.setHours(0,0,0,0);

  if(!S.tarjetas.length){
    cardsEl.innerHTML='<div class="empty" style="margin-bottom:12px"><div class="empty-icon">—</div>Sin tarjetas — agrega la primera</div>';
    if(id('tdc-filtro-tabs')) id('tdc-filtro-tabs').innerHTML='';
  } else {
    cardsEl.innerHTML = S.tarjetas.map((t,i)=>{
      const cicloAct = cicloActualTarjeta(t);
      const cicloVis = cicloVisibleTarjeta(t);
      const limpiar = debenLimpiarse(t);
      const fmtCorteAct = cicloAct.corteIni.toLocaleDateString('es-MX',{day:'2-digit',month:'short'});
      const fmtLimAct = cicloAct.limite.toLocaleDateString('es-MX',{day:'2-digit',month:'short'});
      const diasPago = Math.max(0,Math.round((cicloAct.limite-hoy)/(1000*60*60*24)));
      const nCobros = Math.max(1, contarDiasCobro(cicloAct.limiteStr));
      // Movimientos del ciclo visible (solo si no deben limpiarse)
      const movsTar = limpiar ? [] : S.movimientos.filter(m=>m.tarjeta===t.nombre && movPerteneceAlCicloVisible(t,m.fecha));
      const totalMovTodo = movsTar.reduce((a,m)=>a+m.monto,0);
      const totalMovMio = movsTar.filter(m=>m.incluir==='SI').reduce((a,m)=>a+m.monto,0);
      // MSI de esta tarjeta (todos, en tiempo real)
      const msisTar = S.msis.filter(m=>m.tarjeta===t.nombre);
      const totalMsiTodo = msisTar.reduce((a,m)=>a+(m.monto/m.plazo/nCobros),0);
      const totalMsiMio = msisTar.filter(m=>m.incluir==='SI').reduce((a,m)=>a+(m.monto/m.plazo/nCobros),0);
      // Totales
      const totalTarjeta = totalMovTodo/nCobros + totalMsiTodo;
      const totalMio = totalMovMio/nCobros + totalMsiMio;
      return `<div class="tdc-card ${t.color||'tdc-b'}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:2px">
          <div class="tdc-name">${t.nombre}</div>
          <div class="tdc-tag">Corte ${fmtCorteAct} · Pago ${fmtLimAct}</div>
        </div>
        <div class="tdc-det">${diasPago} días · ${nCobros} ${S.modo==='QUINCENAL'?'quincena':'semana'}${nCobros===1?'':'s'} · Movs: ${cicloVis.cicloLabel}${limpiar?' · Nuevo ciclo':''}</div>
        <div class="tdc-amts">
          <div class="tdc-bl"><div class="tdc-bll">Total tarjeta</div><div class="tdc-blv">${mxn(totalTarjeta)}</div></div>
          <div class="tdc-bl"><div class="tdc-bll">Solo lo mío</div><div class="tdc-blv">${mxn(totalMio)}</div></div>
          <div class="tdc-bl"><div class="tdc-bll">MSI total</div><div class="tdc-blv">${mxn(totalMsiTodo)}</div></div>
        </div>
        <div style="margin-top:8px">
          <span class="ch-del" data-action="del-tar" data-idx="${i}" style="font-size:11px;padding:3px 8px;border:1px solid rgba(248,113,113,.3);border-radius:6px;cursor:pointer;color:var(--red)">× eliminar</span>
        </div>
      </div>`;
    }).join('');

    if(id('tdc-filtro-tabs')){
      const tabs=[{n:'Todas',v:'todas'},...S.tarjetas.map(t=>({n:t.nombre,v:t.nombre}))];
      id('tdc-filtro-tabs').innerHTML=tabs.map(t=>`
        <button onclick="setTdcFiltro('${t.v}')" style="
          padding:5px 12px;border-radius:20px;cursor:pointer;
          border:1px solid ${tdcFiltro===t.v?'var(--blue)':'var(--border)'};
          background:${tdcFiltro===t.v?'rgba(79,142,247,.15)':'transparent'};
          color:${tdcFiltro===t.v?'var(--blue)':'var(--text2)'};
          font-family:var(--font);font-size:11px;font-weight:600;white-space:nowrap;
        ">${t.n}</button>`).join('');
    }
  }

  // Label del corte visible (se muestra el corte ANTERIOR al actual)
  const lblEl = id('mov-corte-lbl');
  if(lblEl){
    const tarFiltro = tdcFiltro && tdcFiltro!=='todas' ? S.tarjetas.find(t=>t.nombre===tdcFiltro) : (S.tarjetas[0]||null);
    if(tarFiltro){
      const cv = cicloVisibleTarjeta(tarFiltro);
      const fIni = cv.corteIni.toLocaleDateString('es-MX',{day:'numeric',month:'long'});
      const fFin = cv.corteFin.toLocaleDateString('es-MX',{day:'numeric',month:'long'});
      const fLim = cv.limite.toLocaleDateString('es-MX',{day:'numeric',month:'long'});
      const tarLabel = tdcFiltro && tdcFiltro!=='todas' ? '' : ` · ${tarFiltro.nombre}`;
      lblEl.innerHTML = `Corte: <strong style="color:var(--text)">${fIni} – ${fFin}</strong> · Límite de pago: <strong style="color:var(--amber)">${fLim}</strong>${tarLabel}`;
    } else {
      lblEl.innerHTML = '';
    }
  }

  const opts=S.tarjetas.map(t=>`<option>${t.nombre}</option>`).join('');
  id('mov-tar').innerHTML=opts||'<option>Sin tarjetas</option>';
  id('msi-tar').innerHTML=opts||'<option>Sin tarjetas</option>';

  // Movimientos: mostrar del ciclo visible, bloqueados si vista global
  const esGlobal = tdcFiltro==='todas';
  const movVisibles = S.movimientos.filter(m=>{
    const tar=S.tarjetas.find(t=>t.nombre===m.tarjeta);
    if(!tar) return false;
    if(debenLimpiarse(tar)) return false;
    return movPerteneceAlCicloVisible(tar, m.fecha);
  });
  const movF = esGlobal ? movVisibles : movVisibles.filter(m=>m.tarjeta===tdcFiltro);
  const movEl=id('mov-list');

  // Botones: bloqueados en vista global
  const addMovBtn = document.querySelector('[onclick*="m-mov"]');
  const limpiarBtn = document.querySelector('[onclick*="limpiarMov"]');
  if(addMovBtn) addMovBtn.disabled = esGlobal;
  if(limpiarBtn) limpiarBtn.disabled = esGlobal;

  if(!movF.length){
    movEl.innerHTML=`<div class="empty"><div class="empty-icon">—</div>${esGlobal?'Selecciona una tarjeta para agregar movimientos':'Sin movimientos para '+tdcFiltro}</div>`;
  } else {
    movEl.innerHTML=movF.map(m=>{
      const i=S.movimientos.indexOf(m);
      return `<div class="chi">
        <div class="chk ${m.incluir==='SI'?'on':'off'}" onclick="toggleMov(${i})" style="cursor:${esGlobal?'default':'pointer'}">${m.incluir==='SI'?'✓':'✕'}</div>
        <div class="ch-info">
          <div class="ch-name ${m.incluir==='NO'?'x':''}">${m.concepto}</div>
          <div class="ch-sub">${m.fecha||''} · ${m.tarjeta}</div>
        </div>
        <div class="ch-a ${m.incluir==='NO'?'x':''}">${mxn(m.monto)}</div>
        ${!esGlobal?`<span class="ch-del" onclick="borrarMov(${i})">×</span>`:''}
      </div>`;
    }).join('');
  }

  // MSI en TDC: aparece cuando debenLimpiarse es true (o fue true en un periodo anterior)
  // Para persistir el MSI cuando 3/3 no se cumple pero sí se cumplió antes,
  // buscamos hacia atrás el periodo más reciente donde sí se cumplió.
  const msiVisEl = id('msi-list');

  // Helper: encontrar el periodo más reciente (≤ actual) donde debenLimpiarse fue true
  function findLastLimpioIdx(tar){
    const saved = S.periodoIdx;
    for(let i=saved; i>=0; i--){
      S.periodoIdx = i;
      if(debenLimpiarse(tar)){ S.periodoIdx = saved; return i; }
    }
    S.periodoIdx = saved;
    return -1;
  }

  // Helper: calcular MSI para un periodo específico
  function calcMsiEnPeriodoIdx(m, tar, idx){
    const saved = S.periodoIdx;
    S.periodoIdx = idx;
    const r = calcMsiEnPeriodo(m, tar);
    S.periodoIdx = saved;
    return r;
  }

  const msiVis = S.msis.filter(m=>{
    const tar=S.tarjetas.find(t=>t.nombre===m.tarjeta);
    if(!tar||!m.fechaCompra) return false;
    return findLastLimpioIdx(tar) >= 0;
  }).filter(m=>tdcFiltro==='todas'||m.tarjeta===tdcFiltro);

  if(!msiVis.length){
    msiVisEl.innerHTML=`<div class="empty" style="font-size:11px;padding:6px 0;color:var(--text3)">Sin MSI del ciclo visible</div>`;
  } else {
    msiVisEl.innerHTML = msiVis.map(m=>{
      const excl = m.incluir==='NO';
      const tar = S.tarjetas.find(t=>t.nombre===m.tarjeta);
      // Calcular MSI con el periodo del último limpio (para que TDC refleje el estado congelado)
      const lastIdx = tar ? findLastLimpioIdx(tar) : -1;
      const calc = (tar && lastIdx>=0) ? calcMsiEnPeriodoIdx(m, tar, lastIdx) : null;
      const pagoMensual = (m.monto||0)/(m.plazo||1);
      const sublbl = calc ? `Plazo ${calc.plazoActual} de ${m.plazo} · Q${calc.quincenaActual}/${calc.nTotal}` : `Plazo ${m.pagoActual||1} de ${m.plazo}`;
      const ppp = calc ? calc.pagoQuincena : pagoMensual;
      return `<div class="msi ${excl?'x':''}" style="opacity:.85">
        <div class="msi-hdr">
          <div>
            <div class="msi-name ${excl?'x':''}">${m.concepto} <span style="font-size:10px;color:var(--text3)">(solo lectura)</span></div>
            <div class="msi-sub" style="color:var(--teal)">${sublbl}</div>
          </div>
          <div style="text-align:right">
            <div class="msi-a ${excl?'x':''}">${mxn(pagoMensual)}/mes</div>
            <div style="font-size:10px;color:var(--text2)">→ ${mxn(ppp)}/quincena</div>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  const totalMovs = calcTotalMov();
  id('tot-tdc').textContent='-'+mxn(totalMovs);
  const bd=[];
  if(totalMovs) bd.push(`Movimientos míos: ${mxn(totalMovs)}`);
  const excluidos=S.movimientos.filter(m=>m.incluir==='NO').reduce((a,m)=>a+m.monto,0);
  if(excluidos) bd.push(`Excluidos: ${mxn(excluidos)}`);
  id('tdc-breakdown').textContent=bd.join(' · ')||'—';
};

const _origRenderDeu = renderDeu;
window.renderDeu = function(){
  const list=id('deu-list');
  if(!S.deudas.length){
    list.innerHTML='<div class="empty"><div class="empty-icon">—</div>Sin deudas registradas</div>';
    id('tot-deu').textContent='$0.00'; return;
  }
  list.innerHTML=S.deudas.map((d,i)=>{
    const calc = calcDeuEnPeriodo(d);

    const totalPagar=d.pago*d.plazo, interes=Math.max(0,totalPagar-(d.monto||0));
    const tasa=d.monto&&d.plazo?((interes/d.monto)/(d.plazo/(d.freq==='MENSUAL'?12:d.freq==='QUINCENAL'?24:52))*100):0;

    if(!calc){
      const pct = d.plazo>0 ? 100 : 0;
      return `<div class="deu" style="opacity:.5">
        <div class="deu-hdr">
          <div class="deu-name" style="font-size:15px;font-weight:700;color:var(--text)">${d.concepto}</div>
          <span class="badge a" style="font-size:11px">${d.freq}${d.dia?' · día '+d.dia:''}</span>
        </div>
        <div class="prog"><div class="prog-f" style="width:100%;background:var(--green)"></div></div>
        <div class="deu-pago-row" style="margin-top:10px">
          <span style="font-size:13px;color:var(--green);font-weight:700">Liquidada</span>
          <span class="ch-del" onclick="borrarDeu(${i})">×</span>
        </div>
      </div>`;
    }

    const {plazoActual, nTotal, quincenaActual, pagoMensual, pagoQuincena} = calc;
    const restantes = Math.max(0, d.plazo - plazoActual + 1);
    const pct = d.plazo>0 ? Math.round(plazoActual/d.plazo*100) : 0;
    const label = S.modo==='QUINCENAL'?'Quincena':'Semana';
    const sublbl = `${label} ${quincenaActual} de ${nTotal} · Pago ${plazoActual} de ${d.plazo}`;
    const pagosYaHechos = Math.max(0, plazoActual - 1);
    const saldoActual = Math.max(0, totalPagar - pagosYaHechos * d.pago);

    return `<div class="deu">
      <div class="deu-hdr">
        <div class="deu-name" style="font-size:15px;font-weight:700;color:var(--text)">${d.concepto}</div>
        <span class="badge a" style="font-size:11px">${d.freq}</span>
      </div>
      <div class="deu-stats" style="margin:6px 0;gap:12px">
        <div class="deu-stat" style="font-size:13px;color:var(--text2)">Pago <span style="color:var(--text);font-weight:700">${plazoActual}</span> de <span style="color:var(--text);font-weight:700">${d.plazo}</span></div>
        <div class="deu-stat" style="font-size:13px;color:var(--text2)">Faltan <span style="color:var(--green);font-weight:700">${restantes}</span></div>
      </div>
      <div style="font-size:12px;color:var(--teal);font-weight:600;margin-bottom:6px">${sublbl}</div>
      <div class="prog"><div class="prog-f" style="width:${pct}%;background:var(--green)"></div></div>
      ${interes>0?`<div class="deu-rates" style="margin-top:8px">
        <div class="rate-item"><div class="rate-l" style="font-size:12px;color:var(--text2)">Tasa anual</div><div class="rate-v" style="font-size:13px;color:var(--text);font-weight:700">${tasa.toFixed(1)}%</div></div>
        <div class="rate-item"><div class="rate-l" style="font-size:12px;color:var(--text2)">Interés total</div><div class="rate-v r" style="font-size:13px;font-weight:700">${mxn(interes)}</div></div>
        <div class="rate-item"><div class="rate-l" style="font-size:12px;color:var(--text2)">Se debe aún</div><div class="rate-v r" style="font-size:13px;font-weight:700;color:var(--amber)">${mxn(saldoActual)}</div></div>
      </div>`:''}
      <div class="deu-pago-row" style="margin-top:10px">
        <span style="font-size:13px;color:var(--text2);font-weight:500">Pago ${d.freq.toLowerCase()}: ${mxn(d.pago)} → este periodo:</span>
        <span style="font-size:15px;font-weight:800;color:var(--amber);font-family:var(--mono)">-${mxn(pagoQuincena)}</span>
        <span class="ch-del" onclick="borrarDeu(${i})">×</span>
      </div>
    </div>`;
  }).join('');
  id('tot-deu').textContent='-'+mxn(calcTotalDeu());
};

// Override renderAll to include sidebar + desktop topbar sync
window.renderAll = function(){
  renderPeriodoNav();
  renderPrincipal();
  window.renderSvc();
  window.renderExt();
  window.renderTDC();
  window.renderMsi();
  window.renderDeu();
  window.renderOtros();
  renderAhorro();
  renderAhorroConfig();
  if(id('modo-lbl')) id('modo-lbl').textContent=S.modo==='QUINCENAL'?'Quincenal':'Semanal';
  updateDates();
  syncSidebarAlert();
  aplicarSecciones();
};

// ═══════════════════════════════════════════════════════
// RENDER MSI — sección independiente, en tiempo real
// ═══════════════════════════════════════════════════════
window.renderMsi = function(){
  const list = id('msi-section-list');
  if(!list) return;
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const p = PERIODOS[S.periodoIdx];

  if(!S.msis.length){
    list.innerHTML='<div class="empty"><div class="empty-icon">—</div>Sin MSI registrados — agrega el primero</div>';
    if(id('tot-msi-section')) id('tot-msi-section').textContent='$0.00';
    return;
  }

  list.innerHTML = S.msis.map((m,i)=>{
    const tar = S.tarjetas.find(t=>t.nombre===m.tarjeta);
    const excl = m.incluir==='NO';

    if(!tar){
      return `<div class="msi ${excl?'x':''}">
        <div class="msi-name">${m.concepto} <span style="color:var(--red);font-size:11px">(tarjeta eliminada)</span></div>
      </div>`;
    }

    const calc = calcMsiEnPeriodo(m, tar);

    if(!calc){
      return `<div class="msi" style="opacity:.4">
        <div class="msi-name">${m.concepto} <span style="font-size:11px;color:var(--green)">Liquidado</span></div>
      </div>`;
    }

    const {plazoActual, nTotal, quincenaActual, pagoMensual, pagoQuincena, cicloActual} = calc;
    const label = S.modo==='QUINCENAL'?'Quincena':'Semana';
    const sublbl = `${label} ${quincenaActual} de ${nTotal} · Pago mensual ${plazoActual} de ${m.plazo}`;

    // Próximo pago = límite del ciclo actual del MSI
    let proxStr = '', finStr = '';
    if(cicloActual && cicloActual.limite){
      proxStr = fmtTandaFecha(cicloActual.limite);
      // Fecha final = límite + (plazo - plazoActual) meses, ajustando por día válido
      const restantes = (m.plazo||1) - plazoActual;
      const lim = new Date(cicloActual.limite);
      const fY = lim.getFullYear(), fM = lim.getMonth() + restantes;
      const maxD = new Date(fY, fM+1, 0).getDate();
      const fechaFinMsi = new Date(fY, fM, Math.min(lim.getDate(), maxD));
      fechaFinMsi.setHours(0,0,0,0);
      finStr = fmtTandaFecha(fechaFinMsi);
    }
    const footerFechasMsi = (proxStr || finStr) ? `<div style="font-size:11px;color:var(--text2);margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
      ${proxStr ? `Próximo pago: <strong style="color:var(--text)">${proxStr}</strong><br>` : ''}
      ${finStr ? `Fin de pagos: <strong style="color:var(--text)">${finStr}</strong>` : ''}
    </div>` : '';

    return `<div class="msi ${excl?'x':''}">
      <div class="msi-hdr">
        <div>
          <div class="msi-name ${excl?'x':''}">${m.concepto}</div>
          <div class="msi-sub">${m.tarjeta}${m.fechaCompra?' · Compra: '+m.fechaCompra:''}</div>
          ${m.fechaAgregado&&m.fechaAgregado!==m.fechaCompra?`<div class="msi-sub" style="color:var(--amber)">Agregado: ${m.fechaAgregado}</div>`:''}
          <div class="msi-sub" style="color:var(--teal);font-weight:600;margin-top:2px">${sublbl}</div>
        </div>
        <div style="text-align:right">
          <div class="msi-a ${excl?'x':''}">${mxn(pagoMensual)}/mes</div>
          <div style="font-size:11px;color:var(--text2)">→ ${mxn(pagoQuincena)}/${S.modo==='QUINCENAL'?'quincena':'semana'}</div>
        </div>
      </div>
      <div class="prog"><div class="prog-f" style="width:${Math.round(plazoActual/m.plazo*100)}%;background:${excl?'var(--red)':'var(--purple)'}"></div></div>
      <div class="msi-actions">
        <span class="badge ${excl?'r':'g'}" onclick="toggleMsiSec(${i})" style="cursor:pointer">${excl?'✕ no mío':'✓ mío'}</span>
        <span class="ch-del" onclick="confirmarDelMsi(${i})">×</span>
      </div>
      ${footerFechasMsi}
    </div>`;
  }).join('');

  const totalMsi = calcTotalMsi();
  if(id('tot-msi-section')) id('tot-msi-section').textContent = '-'+mxn(totalMsi);
};

function toggleMsiSec(i){
  S.msis[i].incluir = S.msis[i].incluir==='SI'?'NO':'SI';
  save(); window.renderMsi(); window.renderTDC(); renderPrincipal();
}

async function confirmarDelMsi(i){
  if(confirm('¿Eliminar este MSI?')){
    if(confirm('¿Estás seguro? Esta acción no se puede deshacer.')){
      const item = S.msis[i];
      if(item && item.id) await supa.from('msis').delete().eq('id', item.id);
      S.msis.splice(i,1);
      localStorage.setItem('finanzas_'+UID, JSON.stringify(S));
      window.renderMsi(); window.renderTDC(); renderPrincipal();
    }
  }
}


// ═══════════════════════════════════════════════════════════════
// ═══ TANDAS ════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════

// Helper: formato fecha largo "sábado, 30 de mayo de 2026"
function fmtTandaFecha(d){
  return d.toLocaleDateString('es-MX',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
}

// Helper: obtiene fecha del número N de la tanda (N base 1). SEMANAL.
function tandaFechaNum(tanda, n){
  const base = new Date(tanda.ini+'T12:00:00');
  base.setHours(0,0,0,0);
  const f = new Date(base);
  f.setDate(base.getDate() + (n-1)*7);
  return f;
}

// Toggle entre campos de deuda normal y campos de tanda
function setDeuTipo(){
  const t = id('deu-tipo').value;
  const boxNormal = id('deu-campos-normal');
  const boxTanda  = id('deu-campos-tanda');
  const title     = id('m-deu-title');
  const btn       = id('deu-btn-save');
  if(t==='tanda'){
    boxNormal.style.display='none';
    boxTanda.style.display='block';
    title.textContent='Nueva tanda';
    btn.textContent='Registrar tanda';
  } else {
    boxNormal.style.display='block';
    boxTanda.style.display='none';
    title.textContent='Nueva deuda';
    btn.textContent='Registrar deuda';
  }
}

// Preview informativo del formulario de tanda
function calcTandaInfo(){
  const pago = parseFloat(id('tan-pago').value)||0;
  const nums = parseInt(id('tan-nums').value)||0;
  const asig = parseInt(id('tan-asignado').value)||0;
  const ini  = id('tan-ini').value;
  const box  = id('tan-info');
  if(!pago||!nums||!ini){ box.style.display='none'; return; }
  const recibe = pago*(nums-1);
  let info = `Pagos efectivos: <strong>${nums-1}</strong> · Total que recibirás: <strong>${mxn(recibe)}</strong>`;
  if(asig>=1 && asig<=nums){
    const fPrem = tandaFechaNum({ini}, asig);
    info += ` · Premio: <strong>${fmtTandaFecha(fPrem)}</strong>`;
  }
  if(asig>nums){
    info = `<span style="color:var(--red)">El número asignado no puede ser mayor a la cantidad de números.</span>`;
  }
  box.style.display='block';
  box.className='ibox';
  box.innerHTML=info;
}

// Guardar tanda
function guardarTanda(){
  const nombre = id('tan-nombre').value.trim();
  const freq   = id('tan-freq').value || 'SEMANAL';
  const pago   = parseFloat(id('tan-pago').value)||0;
  const nums   = parseInt(id('tan-nums').value)||0;
  const asig   = parseInt(id('tan-asignado').value)||0;
  const ini    = id('tan-ini').value;

  if(!nombre){ alert('Nombre de la tanda requerido'); return; }
  if(!pago){ alert('Monto de pago requerido'); return; }
  if(!nums||nums<2){ alert('Cantidad de números debe ser al menos 2'); return; }
  if(!asig||asig<1||asig>nums){ alert('Número asignado inválido'); return; }
  if(!ini){ alert('Fecha de inicio requerida'); return; }

  const fechaAgregado = todayStr();
  const tanda = {
    concepto: nombre,
    monto: pago*(nums-1),   // premio = aportes de los demás
    plazo: nums,            // cantidad de números
    pago,                    // aporte por número
    freq: 'SEMANAL',
    ini,                     // fecha del número 1
    adq: ini,
    fechaAgregado,
    tipo: 'tanda',
    numAsignado: asig
  };
  S.deudas.push(tanda);
  saveDeuDB(tanda).catch(console.warn);
  save();

  // Limpiar form tanda
  id('tan-nombre').value=''; id('tan-pago').value='';
  id('tan-nums').value=''; id('tan-asignado').value=''; id('tan-ini').value='';
  id('tan-info').style.display='none';
  id('deu-tipo').value='normal'; setDeuTipo();

  closeModal('m-deu');
  // Dar tiempo a que saveDeuDB asigne el id antes de sincronizar
  setTimeout(()=>{
    syncTandaExtras();
    window.renderDeu();
    window.renderExt();
    renderPrincipal();
  }, 500);
}

// Decide si la fecha de un número de tanda pertenece al periodo actual.
// QUINCENAL: cae dentro de [pIni, pFin]
// SEMANAL: regla de anticipación. El pago se aparta en el periodo cuyo
//   fin es estrictamente anterior a la fecha del número, pero dentro de 7 días.
//   → fechaNum está en (pFin, pFin + 7 días]
function perteneceAlPeriodoTanda(fechaNum, pIni, pFin){
  if(S.modo === 'QUINCENAL'){
    return fechaNum >= pIni && fechaNum <= pFin;
  } else {
    const rangoMax = new Date(pFin); rangoMax.setDate(rangoMax.getDate()+7);
    return fechaNum > pFin && fechaNum <= rangoMax;
  }
}

// LÓGICA PRINCIPAL: calcTandaEnPeriodo
// Retorna:
//   numerosEnPeriodo: [{num, fecha, esPremio}]
//   pagoPeriodo: monto a deducir (excluye el número premio)
//   fechaFin: fecha del último número
//   hayPremio: boolean
//   fechaPremio: fecha del número asignado
//   premioMonto: pago × (plazo-1)
//   pagoQuincena: alias de pagoPeriodo para compatibilidad con snapshots
function calcTandaEnPeriodo(d){
  const p = PERIODOS[S.periodoIdx];
  if(!p || !d.ini) return null;

  const pIni = new Date(p.ini); pIni.setHours(0,0,0,0);
  const pFin = new Date(p.fin); pFin.setHours(0,0,0,0);

  const fechaFin = tandaFechaNum(d, d.plazo);
  fechaFin.setHours(0,0,0,0);
  const fechaPremio = tandaFechaNum(d, d.numAsignado);
  fechaPremio.setHours(0,0,0,0);

  // Si la tanda ya terminó completamente antes de este periodo
  if(fechaFin < pIni && S.modo === 'QUINCENAL') return null;
  if(S.modo !== 'QUINCENAL'){
    const finAntic = new Date(fechaFin); finAntic.setDate(finAntic.getDate()-6);
    if(finAntic < pIni) return null;
  }

  const numerosEnPeriodo = [];
  for(let n=1; n<=d.plazo; n++){
    const fn = tandaFechaNum(d, n);
    fn.setHours(0,0,0,0);
    if(perteneceAlPeriodoTanda(fn, pIni, pFin)){
      numerosEnPeriodo.push({
        num: n,
        fecha: fn,
        esPremio: n === d.numAsignado
      });
    }
  }

  if(numerosEnPeriodo.length === 0) return null;

  const numsAPagar = numerosEnPeriodo.filter(x=>!x.esPremio).length;
  const pagoPeriodo = numsAPagar * d.pago;
  const hayPremio = numerosEnPeriodo.some(x=>x.esPremio);
  const premioMonto = d.pago * (d.plazo - 1);

  return {
    numerosEnPeriodo,
    pagoPeriodo,
    fechaFin,
    hayPremio,
    fechaPremio,
    premioMonto,
    pagoQuincena: pagoPeriodo
  };
}

// Render de la tarjeta de una tanda
function renderTandaCard(d, i){
  const calc = calcTandaEnPeriodo(d);
  const fechaFin = tandaFechaNum(d, d.plazo);
  const fechaFinStr = fmtTandaFecha(fechaFin);
  const freqLabel = d.freq === 'SEMANAL' ? 'Semanal' : d.freq;

  // REQ 1: si la tanda ya terminó estrictamente antes del periodo actual,
  // ocultarla (no mostrar tarjeta)
  const p = PERIODOS[S.periodoIdx];
  if(p){
    const pIni = new Date(p.ini); pIni.setHours(0,0,0,0);
    const ffin = new Date(fechaFin); ffin.setHours(0,0,0,0);
    if(ffin < pIni) return '';
  }

  // Tanda sin actividad en este periodo (pero aún futura o en curso sin números en este periodo)
  if(!calc){
    return `<div class="deu" style="opacity:.7">
      <div class="deu-hdr">
        <div class="deu-name" style="font-size:15px;font-weight:700;color:var(--text)">🎲 ${d.concepto}</div>
        <span class="badge a" style="font-size:11px">TANDA · ${freqLabel}</span>
      </div>
      <div style="font-size:13px;color:var(--text2);margin:8px 0">Sin números en este periodo</div>
      <div class="deu-pago-row" style="margin-top:6px">
        <span style="font-size:11px;color:var(--text2)">Número asignado: <strong style="color:var(--text)">${d.numAsignado}</strong> de ${d.plazo}</span>
        <span class="ch-del" onclick="borrarDeu(${i})">×</span>
      </div>
      <div style="font-size:11px;color:var(--text2);margin-top:6px">${freqLabel} · Fin de la tanda: ${fechaFinStr}</div>
    </div>`;
  }

  const { numerosEnPeriodo, pagoPeriodo, hayPremio, premioMonto } = calc;

  // Label de números: "1, 2" o "4, 5, ⭐6" si hay premio
  const numsLabel = numerosEnPeriodo.map(x =>
    x.esPremio
      ? `<span style="color:var(--amber);font-weight:800">⭐${x.num}</span>`
      : `<strong>${x.num}</strong>`
  ).join(', ');

  const esSoloPremio = numerosEnPeriodo.length === 1 && hayPremio;
  const ultimoNum = numerosEnPeriodo[numerosEnPeriodo.length-1].num;
  const pct = Math.round((ultimoNum / d.plazo) * 100);

  let premioMsg = '';
  if(hayPremio){
    if(esSoloPremio){
      premioMsg = `<div style="font-size:13px;color:var(--green);font-weight:700;margin:8px 0 4px">🎉 ¡FELICIDADES, hoy te toca!</div>
        <div style="font-size:12px;color:var(--text2);margin-bottom:6px">No realizas ningún pago. Recibes en extras: <strong style="color:var(--green)">+${mxn(premioMonto)}</strong></div>`;
    } else {
      premioMsg = `<div style="font-size:13px;color:var(--green);font-weight:700;margin:8px 0 4px">🎉 ¡Felicidades, tanda ${d.numAsignado}: hoy te toca premio!</div>
        <div style="font-size:12px;color:var(--text2);margin-bottom:6px">No pagas ese número, solo los anteriores. Recibes en extras: <strong style="color:var(--green)">+${mxn(premioMonto)}</strong></div>`;
    }
  }

  return `<div class="deu">
    <div class="deu-hdr">
      <div class="deu-name" style="font-size:15px;font-weight:700;color:var(--text)">🎲 ${d.concepto}</div>
      <span class="badge a" style="font-size:11px">TANDA · ${freqLabel}</span>
    </div>
    <div style="font-size:13px;color:var(--text);margin:6px 0 4px">
      Número de tanda: ${numsLabel} de <strong>${d.plazo}</strong> números disponibles
    </div>
    <div class="prog"><div class="prog-f" style="width:${pct}%;background:var(--teal)"></div></div>
    ${premioMsg}
    <div class="deu-pago-row" style="margin-top:10px">
      <span style="font-size:13px;color:var(--text2);font-weight:500">Pago de este periodo:</span>
      <span style="font-size:15px;font-weight:800;color:${pagoPeriodo>0?'var(--amber)':'var(--green)'};font-family:var(--mono)">${pagoPeriodo>0?'-':''}${mxn(pagoPeriodo)}</span>
      <span class="ch-del" onclick="borrarDeu(${i})">×</span>
    </div>
    <div style="font-size:11px;color:var(--text2);margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
      ${freqLabel} · Número asignado: <strong style="color:var(--text)">${d.numAsignado}</strong>
      <br>Fin de la tanda: <strong style="color:var(--text)">${fechaFinStr}</strong>
    </div>
  </div>`;
}

// Override final de renderDeu — mezcla deudas normales y tandas
(function(){
  window.renderDeu = function(){
    syncTandaExtras();

    const list = id('deu-list');
    if(!S.deudas.length){
      list.innerHTML='<div class="empty"><div class="empty-icon">—</div>Sin deudas registradas</div>';
      id('tot-deu').textContent='$0.00'; return;
    }

    const htmls = S.deudas.map((d,i)=>{
      if(d.tipo === 'tanda'){
        return renderTandaCard(d, i);
      }

      const calc = calcDeuEnPeriodo(d);
      const totalPagar = d.pago*d.plazo, interes=Math.max(0,totalPagar-(d.monto||0));
      const tasa = d.monto&&d.plazo?((interes/d.monto)/(d.plazo/(d.freq==='MENSUAL'?12:d.freq==='QUINCENAL'?24:52))*100):0;

      // ── SEMANAL / QUINCENAL: tarjeta con formato nuevo ──
      if(d.freq === 'SEMANAL' || d.freq === 'QUINCENAL'){
        if(!calc || !calc._nuevo){
          // Liquidada o sin actividad → NO mostrar (REQ 1)
          return '';
        }
        const n = calc._nuevo;
        const plazoActual = n.plazoActual;
        const restantes = Math.max(0, d.plazo - plazoActual + 1);
        const pct = d.plazo>0 ? Math.round(plazoActual/d.plazo*100) : 0;

        // Sub-label
        let sublbl = '';
        if(n.modoRender === 'SEMANAL'){
          // Si hay varios plazos en el periodo (sueldo quincenal): "Plazos 1,2 de 12"
          if(n.plazosEnPeriodo && n.plazosEnPeriodo.length > 1){
            const nums = n.plazosEnPeriodo.map(x=>x.plazoNum).join(',');
            sublbl = `Plazos ${nums} de ${d.plazo}`;
          } else {
            sublbl = `Plazo ${plazoActual} de ${d.plazo}`;
          }
        } else if(n.modoRender === 'QUINCENAL_SUELDO_Q'){
          sublbl = `Plazo ${plazoActual} de ${d.plazo}`;
        } else { // QUINCENAL_SUELDO_S
          sublbl = `S ${n.semanaEnPlazo}/${n.semanasTotalesPlazo} · Plazo ${plazoActual} de ${d.plazo}`;
        }

        const ratesBox = interes>0
          ? `<div class="deu-rates" style="margin-top:8px">
              <div class="rate-item"><div class="rate-l" style="font-size:12px;color:var(--text2)">Tasa anual</div><div class="rate-v" style="font-size:13px;color:var(--text);font-weight:700">${tasa.toFixed(1)}%</div></div>
              <div class="rate-item"><div class="rate-l" style="font-size:12px;color:var(--text2)">Interés total</div><div class="rate-v r" style="font-size:13px;font-weight:700">${mxn(interes)}</div></div>
              <div class="rate-item"><div class="rate-l" style="font-size:12px;color:var(--text2)">Se debe aún</div><div class="rate-v r" style="font-size:13px;font-weight:700;color:var(--amber)">${mxn(n.saldoRestante)}</div></div>
            </div>`
          : `<div style="margin-top:8px;font-size:12px;color:var(--text2)">Se debe aún: <strong style="color:var(--amber);font-family:var(--mono)">${mxn(n.saldoRestante)}</strong></div>`;

        // Próxima fecha visible: solo si hay UN solo evento por periodo
        // SEMANAL+sueldoQUINCENAL → varios plazos → NO mostrar próxima
        // SEMANAL+sueldoSEMANAL → 1 plazo → SÍ
        // QUINCENAL+sueldoQUINCENAL → 1 plazo → SÍ
        // QUINCENAL+sueldoSEMANAL → 1 plazo → SÍ
        let proximaStr = '';
        if(n.modoRender !== 'SEMANAL' || S.modo === 'SEMANAL'){
          const fProx = n.modoRender === 'SEMANAL'
            ? (n.plazosEnPeriodo && n.plazosEnPeriodo[0] && n.plazosEnPeriodo[0].fecha)
            : n.fechaPlazoActual;
          if(fProx) proximaStr = fmtTandaFecha(fProx);
        }
        const fechaFinStr = n.fechaFinDeuda ? fmtTandaFecha(n.fechaFinDeuda) : '';
        const footerFechas = `<div style="font-size:11px;color:var(--text2);margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
          ${proximaStr ? `Próximo pago: <strong style="color:var(--text)">${proximaStr}</strong><br>` : ''}
          ${fechaFinStr ? `Fin de pagos: <strong style="color:var(--text)">${fechaFinStr}</strong>` : ''}
        </div>`;

        return `<div class="deu">
          <div class="deu-hdr">
            <div class="deu-name" style="font-size:15px;font-weight:700;color:var(--text)">${d.concepto}</div>
            <span class="badge a" style="font-size:11px">${d.freq}</span>
          </div>
          <div class="deu-stats" style="margin:6px 0;gap:12px">
            <div class="deu-stat" style="font-size:13px;color:var(--text2)">Pago <span style="color:var(--text);font-weight:700">${plazoActual}</span> de <span style="color:var(--text);font-weight:700">${d.plazo}</span></div>
            <div class="deu-stat" style="font-size:13px;color:var(--text2)">Faltan <span style="color:var(--green);font-weight:700">${restantes}</span></div>
          </div>
          <div style="font-size:12px;color:var(--teal);font-weight:600;margin-bottom:6px">${sublbl}</div>
          <div class="prog"><div class="prog-f" style="width:${pct}%;background:var(--green)"></div></div>
          ${ratesBox}
          <div class="deu-pago-row" style="margin-top:10px">
            <span style="font-size:13px;color:var(--text2);font-weight:500">Pago ${d.freq.toLowerCase()}: ${mxn(d.pago)} → este periodo:</span>
            <span style="font-size:15px;font-weight:800;color:var(--amber);font-family:var(--mono)">-${mxn(n.pagoPeriodo)}</span>
            <span class="ch-del" onclick="borrarDeu(${i})">×</span>
          </div>
          ${footerFechas}
        </div>`;
      }

      // ── MENSUAL: tarjeta original intacta ──
      if(!calc){
        return `<div class="deu" style="opacity:.5">
          <div class="deu-hdr">
            <div class="deu-name" style="font-size:15px;font-weight:700;color:var(--text)">${d.concepto}</div>
            <span class="badge a" style="font-size:11px">${d.freq}${d.dia?' · día '+d.dia:''}</span>
          </div>
          <div class="prog"><div class="prog-f" style="width:100%;background:var(--green)"></div></div>
          <div class="deu-pago-row" style="margin-top:10px">
            <span style="font-size:13px;color:var(--green);font-weight:700">Liquidada</span>
            <span class="ch-del" onclick="borrarDeu(${i})">×</span>
          </div>
        </div>`;
      }

      const {plazoActual, nTotal, quincenaActual, pagoQuincena} = calc;
      const restantes = Math.max(0, d.plazo - plazoActual + 1);
      const pct = d.plazo>0 ? Math.round(plazoActual/d.plazo*100) : 0;
      const label = S.modo==='QUINCENAL'?'Quincena':'Semana';
      const sublbl = `${label} ${quincenaActual} de ${nTotal} · Pago ${plazoActual} de ${d.plazo}`;
      const pagosYaHechos = Math.max(0, plazoActual - 1);
      const saldoActual = Math.max(0, totalPagar - pagosYaHechos * d.pago);

      // MENSUAL: próxima fecha = limitePago, fin = fechaFinDeuda
      const proxStrM = calc.limitePago ? fmtTandaFecha(calc.limitePago) : '';
      const finStrM  = calc.fechaFinDeuda ? fmtTandaFecha(calc.fechaFinDeuda) : '';
      const footerFechasM = `<div style="font-size:11px;color:var(--text2);margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
        ${proxStrM ? `Próximo pago: <strong style="color:var(--text)">${proxStrM}</strong><br>` : ''}
        ${finStrM ? `Fin de pagos: <strong style="color:var(--text)">${finStrM}</strong>` : ''}
      </div>`;

      return `<div class="deu">
        <div class="deu-hdr">
          <div class="deu-name" style="font-size:15px;font-weight:700;color:var(--text)">${d.concepto}</div>
          <span class="badge a" style="font-size:11px">${d.freq}</span>
        </div>
        <div class="deu-stats" style="margin:6px 0;gap:12px">
          <div class="deu-stat" style="font-size:13px;color:var(--text2)">Pago <span style="color:var(--text);font-weight:700">${plazoActual}</span> de <span style="color:var(--text);font-weight:700">${d.plazo}</span></div>
          <div class="deu-stat" style="font-size:13px;color:var(--text2)">Faltan <span style="color:var(--green);font-weight:700">${restantes}</span></div>
        </div>
        <div style="font-size:12px;color:var(--teal);font-weight:600;margin-bottom:6px">${sublbl}</div>
        <div class="prog"><div class="prog-f" style="width:${pct}%;background:var(--green)"></div></div>
        ${interes>0?`<div class="deu-rates" style="margin-top:8px">
          <div class="rate-item"><div class="rate-l" style="font-size:12px;color:var(--text2)">Tasa anual</div><div class="rate-v" style="font-size:13px;color:var(--text);font-weight:700">${tasa.toFixed(1)}%</div></div>
          <div class="rate-item"><div class="rate-l" style="font-size:12px;color:var(--text2)">Interés total</div><div class="rate-v r" style="font-size:13px;font-weight:700">${mxn(interes)}</div></div>
          <div class="rate-item"><div class="rate-l" style="font-size:12px;color:var(--text2)">Se debe aún</div><div class="rate-v r" style="font-size:13px;font-weight:700;color:var(--amber)">${mxn(saldoActual)}</div></div>
        </div>`:`<div style="margin-top:8px;font-size:12px;color:var(--text2)">Se debe aún: <strong style="color:var(--amber);font-family:var(--mono)">${mxn(saldoActual)}</strong></div>`}
        <div class="deu-pago-row" style="margin-top:10px">
          <span style="font-size:13px;color:var(--text2);font-weight:500">Pago ${d.freq.toLowerCase()}: ${mxn(d.pago)} → este periodo:</span>
          <span style="font-size:15px;font-weight:800;color:var(--amber);font-family:var(--mono)">-${mxn(pagoQuincena)}</span>
          <span class="ch-del" onclick="borrarDeu(${i})">×</span>
        </div>
        ${footerFechasM}
      </div>`;
    }).filter(x => x); // filtrar vacíos (deudas liquidadas ocultas)

    if(htmls.length === 0){
      list.innerHTML='<div class="empty"><div class="empty-icon">—</div>Sin deudas registradas</div>';
    } else {
      list.innerHTML = htmls.join('');
    }
    id('tot-deu').textContent='-'+mxn(calcTotalDeu());
  };
})();

// Sincronización de extras automáticos (premios de tandas)
// Inserta un extra en el periodo donde cae el número asignado del usuario.
// Si la tanda ya no toca premio en este periodo, lo elimina.
function syncTandaExtras(){
  if(!S.extras) S.extras = [];

  // Tandas cuyo premio cae en este periodo
  const tandasConPremio = S.deudas
    .filter(d => d.tipo === 'tanda' && d.id)
    .map(d => {
      const calc = calcTandaEnPeriodo(d);
      if(!calc || !calc.hayPremio) return null;
      return { tandaId: d.id, monto: calc.premioMonto, concepto: d.concepto, fecha: calc.fechaPremio };
    })
    .filter(Boolean);

  // Eliminar extras autoTanda que ya no corresponden
  const extrasAEliminar = [];
  S.extras = S.extras.filter(e => {
    if(!e.autoTanda) return true;
    const aun = tandasConPremio.find(t => t.tandaId === e.tandaId);
    if(!aun){
      extrasAEliminar.push(e);
      return false;
    }
    return true;
  });
  extrasAEliminar.forEach(e => {
    if(e.id) supa.from('extras').delete().eq('id', e.id).catch(console.warn);
  });

  // Agregar los extras que falten
  tandasConPremio.forEach(t => {
    const ya = S.extras.find(e => e.autoTanda && e.tandaId === t.tandaId);
    if(ya) return;
    const fechaStr = t.fecha.toISOString().split('T')[0];
    const ext = {
      concepto: `🎲 Tanda: ${t.concepto}`,
      monto: t.monto,
      desc: 'Premio de tanda recibido',
      fecha: fechaStr,
      autoTanda: true,
      tandaId: t.tandaId
    };
    S.extras.push(ext);
    supa.from('extras').insert({
      user_id: UID,
      concepto: ext.concepto,
      monto: ext.monto,
      descripcion: ext.desc,
      fecha: ext.fecha,
      periodo_idx: S.periodoIdx,
      auto_tanda: true,
      tanda_id: t.tandaId
    }).select().single()
      .then(({data}) => { if(data) ext.id = data.id; })
      .catch(err => console.warn('insert extra tanda:', err));
  });
}

// Hooks en borrado de deudas: limpiar extras automáticos asociados
(function(){
  window.borrarDeu = async function(i){
    const item = S.deudas[i];
    if(!item) return;
    const esTanda = item.tipo === 'tanda';
    const msg = esTanda ? '¿Eliminar esta tanda? También se limpiará el premio automático en extras.' : '¿Eliminar esta deuda?';
    if(!confirm(msg)) return;

    if(esTanda && item.id){
      const extrasALimpiar = S.extras.filter(e => e.autoTanda && e.tandaId === item.id);
      for(const e of extrasALimpiar){
        if(e.id){
          try { await supa.from('extras').delete().eq('id', e.id); } catch(err){ console.warn(err); }
        }
      }
      S.extras = S.extras.filter(e => !(e.autoTanda && e.tandaId === item.id));
    }

    if(item.id) await supa.from('deudas').delete().eq('id', item.id);
    S.deudas.splice(i,1);
    save();
    window.renderDeu(); window.renderExt(); renderPrincipal();
  };

  window.delDeu = function(i){
    const item = S.deudas[i];
    if(!item) return;
    const esTanda = item.tipo === 'tanda';
    const msg = esTanda ? '¿Eliminar esta tanda? También se limpiará el premio automático en extras.' : '¿Eliminar esta deuda?';
    if(!confirm(msg)) return;

    if(esTanda && item.id){
      const extrasALimpiar = S.extras.filter(e => e.autoTanda && e.tandaId === item.id);
      extrasALimpiar.forEach(e => {
        if(e.id) supa.from('extras').delete().eq('id', e.id).catch(console.warn);
      });
      S.extras = S.extras.filter(e => !(e.autoTanda && e.tandaId === item.id));
    }

    if(item.id) delDeuDB(item.id).catch(console.warn);
    S.deudas.splice(i,1);
    save();
    window.renderDeu(); window.renderExt(); renderPrincipal();
  };
})();

// Override de renderExt: marcar extras autoTanda y bloquear su eliminación manual
(function(){
  window.renderExt = function(){
    const list = id('ext-list');
    if(!S.extras || !S.extras.length){
      list.innerHTML='<div class="empty"><div class="empty-icon">—</div>Sin ingresos extra este periodo</div>';
      id('tot-ext').textContent='$0.00'; return;
    }
    list.innerHTML = S.extras.map((e,i)=>{
      const auto = !!e.autoTanda;
      const dotColor = auto ? 'background:var(--teal)' : '';
      const delBtn = auto
        ? `<span style="font-size:11px;color:var(--text2);padding:0 6px" title="Automático por tanda — no editable">🔒</span>`
        : `<span class="ch-del" onclick="borrarExt(${i})" title="Eliminar">×</span>`;
      return `
      <div class="ext-item">
        <div class="ext-dot" style="${dotColor}"></div>
        <div class="ext-info">
          <div class="ext-name">${e.concepto}</div>
          <div class="ext-desc">${e.fecha||''} · ${e.desc||''}${auto?' · auto':''}</div>
        </div>
        <div class="ext-right">
          <div class="ext-a">+${mxn(e.monto)}</div>
        </div>
        ${delBtn}
      </div>`;
    }).join('');
    id('tot-ext').textContent = '+'+mxn(calcTotalExtras());
  };
})();

// Hook en limpiarDeudas: también limpiar extras automáticos
(function(){
  window.limpiarDeudas = function(){
    if(!confirm('¿Eliminar todas las deudas y tandas? Los premios automáticos en extras también se limpiarán.')) return;
    const extrasAutos = S.extras.filter(e => e.autoTanda);
    extrasAutos.forEach(e => {
      if(e.id) supa.from('extras').delete().eq('id', e.id).catch(console.warn);
    });
    S.extras = S.extras.filter(e => !e.autoTanda);

    supa.from('deudas').delete().eq('user_id', UID).catch(console.warn);
    S.deudas = [];
    save();
    window.renderDeu(); window.renderExt(); renderPrincipal();
  };
})();

// Patch: recuperar flags autoTanda/tandaId desde DB una vez que UID exista
// Patch: cargar perfil desde DB para sincronizar entre dispositivos
// Patch: cargar perfil desde DB - ya no se usa, los datos vienen de tabla `config`
// vía loadFromSupabase. Función dejada como no-op por compatibilidad.
(async function cargarPerfilDesdeDB(){
  // No-op: ahora todo se lee de la tabla `config` en loadFromSupabase
  return;
})();

(async function patchExtrasLoad(){
  const waitUID = () => new Promise(r => {
    const t = setInterval(() => { if(typeof UID !== 'undefined' && UID){ clearInterval(t); r(); } }, 100);
    setTimeout(() => { clearInterval(t); r(); }, 15000);
  });
  await waitUID();
  if(typeof UID === 'undefined' || !UID) return;
  try {
    const {data} = await supa.from('extras').select('*').eq('user_id', UID);
    if(!data) return;
    S.extras.forEach(e => {
      const match = data.find(r => r.id === e.id);
      if(match){
        e.autoTanda = !!match.auto_tanda;
        e.tandaId = match.tanda_id || null;
      }
    });
    if(window.renderExt) window.renderExt();
    if(window.renderDeu) window.renderDeu();
  } catch(err){ console.warn('patch extras autoTanda:', err); }
})();


// ═══════════════════════════════════════════════════════
// INIT — maneja auth y carga datos
// ═══════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════
// ═══ ONBOARDING (PRIMERA VEZ) ═════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// Estado temporal durante el onboarding
const ONB = {
  sexo: null,       // 'M' | 'F' | 'X'
  theme: 'dark',
  modo: null,       // 'QUINCENAL' | 'SEMANAL'
  diaCobro: 'Miércoles',
  sueldo: 0,
  fijo: false,
  secciones: { extras:true, servicios:true, tdc:true, msi:true, deudas:true, otros:true, ahorro:true }
};

function onbNext(step){
  for(let s=0; s<=5; s++){
    const el = id('onb-step-'+s);
    if(el) el.style.display = (s===step) ? 'block' : 'none';
  }
  // Al entrar al paso 1 (bienvenida), actualizar saludo según sexo
  if(step === 1){
    onbActualizarSaludo();
  }
  // Llegando al paso 4, actualizar label del periodo
  if(step === 4){
    try {
      const p = PERIODOS[S.periodoIdx];
      if(p){
        const f1 = new Date(p.ini).toLocaleDateString('es-MX',{day:'2-digit',month:'short'});
        const f2 = new Date(p.fin).toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'});
        id('onb-periodo-lbl').textContent = `(${f1} – ${f2})`;
      }
    } catch(e){}
  }
}

function onbSexo(s){
  ONB.sexo = s;
  document.querySelectorAll('.onb-sexo').forEach(b=>{
    b.classList.toggle('sel', b.dataset.sexo === s);
  });
}

// Actualiza el saludo según sexo elegido + nombre del usuario
async function onbActualizarSaludo(){
  let nombre = '';
  try {
    // Tu app usa sistema de auth custom (CURRENT_USER en auth.js), no Supabase Auth
    if(typeof CURRENT_USER !== 'undefined' && CURRENT_USER){
      const n = CURRENT_USER.nombre || '';
      const a = CURRENT_USER.apellido || '';
      nombre = (n + ' ' + a).trim() || CURRENT_USER.username || '';
    }
    // Fallback a Supabase Auth si existiera (compat)
    if(!nombre && typeof supa !== 'undefined'){
      try {
        const {data} = await supa.auth.getUser();
        const u = data && data.user;
        if(u){
          nombre = u.user_metadata?.full_name || u.user_metadata?.name || (u.email||'').split('@')[0] || '';
        }
      } catch(e){}
    }
  } catch(e){}
  let saludo;
  if(ONB.sexo === 'M') saludo = 'Bienvenido';
  else if(ONB.sexo === 'F') saludo = 'Bienvenida';
  else saludo = 'Bienvenid@';
  const nombreTxt = nombre ? (' '+nombre) : '';
  const el = id('onb-hola');
  if(el) el.textContent = `¡${saludo}${nombreTxt}!`;
}

function onbTheme(t){
  ONB.theme = t;
  document.querySelectorAll('.onb-theme').forEach(b=>{
    b.classList.toggle('sel', b.dataset.theme === t);
  });
  // Aplicar en vivo para preview
  try {
    document.body.classList.remove('theme-dark','theme-light','theme-classic');
    document.body.classList.add('theme-'+t);
    if(typeof aplicarTema === 'function') aplicarTema(t);
  } catch(e){}
}

function onbModo(m){
  ONB.modo = m;
  document.querySelectorAll('.onb-modo').forEach(b=>{
    b.classList.toggle('sel', b.dataset.modo === m);
  });
  const extra = id('onb-modo-extra');
  const diaRow = id('onb-dia-row');
  if(extra) extra.style.display = 'block';
  if(diaRow) diaRow.style.display = (m === 'SEMANAL') ? 'block' : 'none';
}

async function onbFinish(){
  // Capturar datos del form
  ONB.sueldo = parseFloat(id('onb-sueldo').value) || 0;
  ONB.fijo = id('onb-fijo').checked;
  if(ONB.modo === 'SEMANAL'){
    ONB.diaCobro = id('onb-dia').value || 'Miércoles';
  }
  document.querySelectorAll('.onb-sec-chk').forEach(chk => {
    ONB.secciones[chk.dataset.sec] = chk.checked;
  });

  // Validación mínima
  if(!ONB.sexo){
    alert('Selecciona tu sexo al inicio.');
    onbNext(0); return;
  }
  if(!ONB.modo){
    alert('Selecciona tu modo de sueldo (quincenal o semanal) antes de continuar.');
    onbNext(3); return;
  }

  // Aplicar al estado global S
  try {
    S.sexo = ONB.sexo;
    S.tema = ONB.theme;
    S.modo = ONB.modo;
    if(ONB.modo === 'SEMANAL'){
      S.diaSem = normalizarDiaSem(ONB.diaCobro || 'Miércoles');
    }
    S.sueldo = ONB.sueldo;
    S.sueldoFijo = ONB.fijo;

    // Secciones visibles
    if(!S.secciones) S.secciones = {};
    Object.assign(S.secciones, ONB.secciones);

    // Marcar onboarding completado
    S.onboardingDone = true;

    // Regenerar PERIODOS según modo nuevo
    try {
      if(typeof calcPeriodosDesdeHoy === 'function'){
        PERIODOS = calcPeriodosDesdeHoy();
        S.periodoIdx = 0;
        // Guardar sueldo del periodo actual si NO es fijo
        if(!S.sueldoFijo){
          if(!S.sueldoPorPeriodo) S.sueldoPorPeriodo = {};
          const lblPeriodo = PERIODOS[0]?.lbl;
          if(lblPeriodo) S.sueldoPorPeriodo[lblPeriodo] = ONB.sueldo;
        }
      }
    } catch(e){ console.warn('regen periodos onb:', e); }

    // Persistir local + DB
    if(typeof save === 'function') save();
    localStorage.setItem('finanzas_'+UID, JSON.stringify(S));
    try {
      await saveConfigDB();
    } catch(e){ console.warn('saveConfigDB onb:', e); }

    // Aplicar tema y visibilidad
    if(typeof aplicarTema === 'function') aplicarTema(S.tema);
    if(typeof aplicarSecciones === 'function') aplicarSecciones();
  } catch(e){ console.warn('onbFinish:', e); }

  // Liberar el bloqueo antes de cerrar
  const onb = document.getElementById('m-onboard');
  if(onb) onb.removeAttribute('data-blocked');
  closeModal('m-onboard');
  // Refrescar todo
  try {
    if(typeof renderAll === 'function') renderAll();
    else if(typeof renderPrincipal === 'function') renderPrincipal();
  } catch(e){}
}

// Lanzar onboarding si es primera vez. Confía en S.onboardingDone que viene de
// loadFromSupabase → tabla `config`. La BD es la única fuente de verdad.
function mostrarOnboardingSiEsNecesario(){
  if(!S) return;
  if(S.onboardingDone === true) return;
  // Inicializar en paso 0 (sexo) y mostrar
  onbNext(0);
  openModal('m-onboard');
}

// Hook viejo basado en intervalo: deshabilitado.
// Ahora mostrarOnboardingSiEsNecesario se llama directamente desde
// cargarDatosUsuario en auth.js, garantizando que ya cargó la config de Supabase.

// Persistir flag al cerrar manualmente el onboarding (escape / fuera de modal)
// y al completarlo
(function(){
  const origCloseModal = window.closeModal;
  window.closeModal = function(idModal){
    if(idModal === 'm-onboard' && S && S.onboardingDone){
      localStorage.setItem('onboarding_done_'+UID, '1');
    }
    if(typeof origCloseModal === 'function') return origCloseModal(idModal);
    const el = id(idModal); if(el) el.classList.remove('show');
  };
})();


// ═══════════════════════════════════════════════════════════════
// ═══ NOTIFICACIONES (PRÓXIMOS PAGOS) ═══════════════════════════
// ═══════════════════════════════════════════════════════════════
//
// Reglas:
//  - Aparecen 5 días antes de la fecha límite del pago.
//  - Tanda premio: solo aparece el día del premio, desaparece el día siguiente.
//  - Pagos semanales (deuda/tanda) en sueldo QUINCENAL → agrupados.
//    Resto: una notificación por evento.
//  - NO se muestran:
//      · Servicios SEMANALES rutinarios
//      · TDC (la lógica TDC tiene su propio sistema de cortes)
//      · Pagos liquidados / fechas pasadas sin marcar (estos se ven como VENCIDO)
//  - Marcar como pagado → al fondo con flag ✓ → desaparece 3 días después.
//  - Desmarcar → reinicia el contador (vuelve a no pagado).
//  - Sincronizado con Supabase tabla `notificaciones_estado`.
//    Cada notificación tiene un "key" único: tipo|id|fechaISO
//
// Estado persistido por notificación:
//  { key, pagado: bool, fechaPago: ISO (cuando se marcó), oculto: bool }

let _notifEstado = {};   // map key -> {pagado, fechaPago, oculto}
let _notifCacheLista = [];  // última lista calculada

// Cargar estados desde Supabase
async function cargarNotifEstado(){
  if(typeof UID === 'undefined' || !UID) return;
  try {
    const {data} = await supa.from('notificaciones_estado').select('*').eq('user_id', UID);
    if(!data) return;
    _notifEstado = {};
    data.forEach(r => {
      _notifEstado[r.notif_key] = {
        pagado: !!r.pagado,
        fechaPago: r.fecha_pago || null,
        oculto: !!r.oculto
      };
    });
  } catch(e){ console.warn('cargar notif estado:', e); }
}

async function guardarNotifEstado(key, estado){
  _notifEstado[key] = estado;
  if(typeof UID === 'undefined' || !UID) return;
  try {
    await supa.from('notificaciones_estado').upsert({
      user_id: UID,
      notif_key: key,
      pagado: !!estado.pagado,
      fecha_pago: estado.fechaPago || null,
      oculto: !!estado.oculto
    }, { onConflict: 'user_id,notif_key' });
  } catch(e){ console.warn('guardar notif estado:', e); }
}

// Helpers de fecha
function _diasEntre(a, b){
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / 86400000);
}
function _isoDate(d){
  return d.toISOString().split('T')[0];
}

// Genera todas las notificaciones potenciales (sin filtrar por ventana de 5 días)
function generarNotificacionesRaw(){
  const lista = [];
  const hoy = new Date(); hoy.setHours(0,0,0,0);

  // Helper para meter una notif
  function add(tipo, refId, fecha, titulo, sub, monto, extra){
    if(!fecha) return;
    const f = new Date(fecha); f.setHours(0,0,0,0);
    const key = `${tipo}|${refId}|${_isoDate(f)}`;
    lista.push({
      key, tipo, refId,
      fecha: f,
      titulo, sub: sub||'', monto: monto||0,
      ...(extra||{})
    });
  }

  // Helper: obtiene la fecha desde la cual una deuda/tanda empieza a generar notifs
  // Usa fechaAgregado si existe, si no usa ini. Pagos anteriores se ignoran (eran "históricos").
  function fechaCorteNotif(d){
    const baseStr = d.fechaAgregado || d.ini;
    if(!baseStr) return null;
    const f = new Date(baseStr+'T12:00:00');
    f.setHours(0,0,0,0);
    return f;
  }

  // ── DEUDAS ──
  S.deudas.forEach(d => {
    const fCorte = fechaCorteNotif(d);

    if(d.tipo === 'tanda'){
      // Tanda: una notif por número (excepto el premio, que es noti aparte)
      // Generar fechas de números próximos (los siguientes 60 días para no saturar)
      const fIni = new Date(d.ini+'T12:00:00'); fIni.setHours(0,0,0,0);
      for(let n=1; n<=d.plazo; n++){
        const f = new Date(fIni);
        f.setDate(fIni.getDate() + (n-1)*7);
        f.setHours(0,0,0,0);
        // Ignorar pagos anteriores a la fecha en que se agregó la deuda
        if(fCorte && f < fCorte) continue;
        // Solo nos interesan las cercanas (60 días en cada dirección por margen)
        const dDias = _diasEntre(hoy, f);
        if(dDias < -30 || dDias > 60) continue;
        if(n === d.numAsignado){
          // Es el premio
          add('tanda_premio', d.id, f,
            `🎲 Premio de tanda: ${d.concepto}`,
            `Hoy recibes el premio. NO pagas este número.`,
            d.pago * (d.plazo - 1),
            { esPremio:true, recibe:true });
        } else {
          add('tanda_pago', `${d.id}|${n}`, f,
            `🎲 Tanda: ${d.concepto}`,
            `Aporte número ${n} de ${d.plazo}`,
            d.pago,
            { plazoNum: n, deudaId: d.id });
        }
      }
      return;
    }

    // Deuda normal
    if(d.freq === 'SEMANAL' || d.freq === 'QUINCENAL'){
      // Generar fechas de pago próximas
      const fIni = new Date(d.ini+'T12:00:00'); fIni.setHours(0,0,0,0);
      let fechas = [];
      if(d.freq === 'SEMANAL'){
        for(let n=0; n<d.plazo; n++){
          const f = new Date(fIni);
          f.setDate(fIni.getDate() + n*7);
          fechas.push(f);
        }
      } else {
        let y = fIni.getFullYear(), m = fIni.getMonth();
        let half = fIni.getDate() <= 15 ? 1 : 2;
        let count = 0;
        for(let i=0; i<500 && count<d.plazo; i++){
          const finMes = new Date(y, m+1, 0).getDate();
          const f = half === 1 ? new Date(y, m, 15) : new Date(y, m, finMes);
          f.setHours(0,0,0,0);
          if(f >= fIni){ fechas.push(f); count++; }
          half++; if(half>2){ half=1; m++; if(m>11){m=0; y++;} }
        }
      }
      fechas.forEach((f, idx) => {
        // Ignorar pagos anteriores a fechaAgregado
        if(fCorte && f < fCorte) return;
        const dDias = _diasEntre(hoy, f);
        if(dDias < -30 || dDias > 60) return;
        const plazoNum = idx + 1;
        add('deuda_pago', `${d.id}|${plazoNum}`, f,
          `${d.concepto}`,
          `${d.freq} · Plazo ${plazoNum} de ${d.plazo}`,
          d.pago,
          { plazoNum, deudaId: d.id, freq: d.freq });
      });
    } else if(d.freq === 'MENSUAL'){
      // Generar fechas mensuales con fix día 31
      const fIni = new Date(d.ini+'T12:00:00'); fIni.setHours(0,0,0,0);
      const diaPago = fIni.getDate();
      for(let n=0; n<d.plazo; n++){
        const tY = fIni.getFullYear();
        const tM = fIni.getMonth() + n;
        const maxD = new Date(tY, tM+1, 0).getDate();
        const f = new Date(tY, tM, Math.min(diaPago, maxD));
        f.setHours(0,0,0,0);
        // Ignorar pagos anteriores a fechaAgregado
        if(fCorte && f < fCorte) continue;
        const dDias = _diasEntre(hoy, f);
        if(dDias < -30 || dDias > 60) continue;
        const plazoNum = n + 1;
        add('deuda_pago', `${d.id}|${plazoNum}`, f,
          `${d.concepto}`,
          `MENSUAL · Plazo ${plazoNum} de ${d.plazo}`,
          d.pago,
          { plazoNum, deudaId: d.id, freq: d.freq });
      }
    }
  });

  // ── SERVICIOS (excluyendo SEMANALES rutinarios) ──
  S.servicios.forEach(s => {
    if(s.freqSvc === 'SEMANAL') return; // omitir semanales
    const f = calcProxPagoSvcDate(s);
    if(!f) return;
    // calcProxPagoSvcDate ya respeta periodoAgregadoLbl internamente.
    const dDias = _diasEntre(hoy, f);
    if(dDias < -30 || dDias > 60) return;
    const freqStr = s.freqSvc === 'QUINCENAL' ? 'Quincenal' : freqLabel(s.cadacuanto||1);
    add('servicio', s.id, f,
      `${s.concepto}`,
      `${freqStr}`,
      s.monto,
      { svcId: s.id });
  });

  // ── MSI ──
  S.msis.forEach(m => {
    if(m.incluir === 'NO') return;
    const tar = S.tarjetas.find(t => t.nombre === m.tarjeta);
    if(!tar) return;
    const calc = calcMsiEnPeriodo(m, tar);
    if(!calc || !calc.cicloActual) return;
    const f = new Date(calc.cicloActual.limite);
    f.setHours(0,0,0,0);
    const dDias = _diasEntre(hoy, f);
    if(dDias < -30 || dDias > 60) return;
    add('msi', `${m.id}|${calc.plazoActual}`, f,
      `MSI: ${m.concepto}`,
      `${m.tarjeta} · Pago ${calc.plazoActual} de ${m.plazo}`,
      calc.pagoMensual,
      { msiId: m.id, plazoNum: calc.plazoActual });
  });

  return lista;
}

// Aplica reglas de visibilidad: ventana 5 días, agrupación, marcado pagado, etc.
function generarNotificacionesVisibles(){
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const raw = generarNotificacionesRaw();

  // Agrupar pagos semanales (deuda/tanda) cuando sueldo es QUINCENAL.
  // Regla: TODAS las semanales del mismo objeto (deuda/tanda) que caigan en
  // la misma quincena se agrupan, AUNQUE sea solo 1. La fecha de vencimiento
  // de la notificación es el FIN de la quincena (15 o último día del mes),
  // que es cuando se acumula y debe pagarse al cobrar.
  let lista = raw;
  if(S.modo === 'QUINCENAL'){
    const grupos = {};
    const noAgrupables = [];
    raw.forEach(n => {
      const esSemanal = (n.tipo === 'deuda_pago' && n.freq === 'SEMANAL')
                     || (n.tipo === 'tanda_pago');
      if(!esSemanal){ noAgrupables.push(n); return; }
      // Encontrar inicio Y fin de quincena que contiene n.fecha
      const f = n.fecha;
      const y = f.getFullYear(), m = f.getMonth();
      const finMes = new Date(y, m+1, 0).getDate();
      const quincIni = f.getDate() <= 15
        ? new Date(y, m, 1)
        : new Date(y, m, 16);
      const quincFin = f.getDate() <= 15
        ? new Date(y, m, 15)
        : new Date(y, m, finMes);
      quincIni.setHours(0,0,0,0);
      quincFin.setHours(0,0,0,0);
      const grupoKey = `${n.tipo === 'tanda_pago' ? 'tanda' : 'deuda'}|${n.deudaId}|${_isoDate(quincIni)}`;
      if(!grupos[grupoKey]){
        grupos[grupoKey] = {
          items: [], grupoKey,
          fechaCierre: quincFin,
          deudaId: n.deudaId, tipo: n.tipo
        };
      }
      grupos[grupoKey].items.push(n);
    });

    // Convertir TODOS los grupos en notificaciones agrupadas (incluso 1 solo item)
    Object.values(grupos).forEach(g => {
      g.items.sort((a,b) => a.fecha - b.fecha);
      const primero = g.items[0];
      const nums = g.items.map(it => it.plazoNum).join(', ');
      const monto = g.items.reduce((a,b) => a + b.monto, 0);
      const isTanda = g.tipo === 'tanda_pago';
      const labelTipo = isTanda ? (g.items.length>1 ? 'Números' : 'Número') : (g.items.length>1 ? 'Plazos' : 'Plazo');
      noAgrupables.push({
        key: `grupo|${g.grupoKey}`,
        tipo: isTanda ? 'tanda_grupo' : 'deuda_grupo',
        refId: g.deudaId,
        fecha: g.fechaCierre, // FIN de la quincena = fecha límite
        titulo: primero.titulo,
        sub: `${labelTipo} ${nums}`,
        monto,
        plazos: g.items.map(it => it.plazoNum),
        items: g.items
      });
    });
    lista = noAgrupables;
  }

  // Filtrar por ventana de visibilidad (5 días antes + reglas de pagado/vencido)
  const visibles = [];
  lista.forEach(n => {
    const dDias = _diasEntre(hoy, n.fecha);
    const estado = _notifEstado[n.key] || {};
    n.pagado = !!estado.pagado;
    n.fechaPago = estado.fechaPago || null;
    n.oculto = !!estado.oculto;

    if(n.oculto) return;

    // Tanda premio: solo aparece el día exacto, desaparece al día siguiente
    if(n.tipo === 'tanda_premio'){
      if(dDias === 0) visibles.push(n);
      return;
    }

    // Si está pagado → quitar 3 días después de la fecha de marcado
    if(n.pagado && n.fechaPago){
      const fp = new Date(n.fechaPago); fp.setHours(0,0,0,0);
      const desdePago = _diasEntre(fp, hoy);
      if(desdePago > 3) return; // desaparece
      visibles.push(n);
      return;
    }

    // No pagado: aparece 5 días antes; si pasa la fecha sin marcar → VENCIDO (sigue visible)
    if(dDias <= 5) visibles.push(n);
  });

  // Ordenar: no-pagados-no-vencidos primero (más cercanos), luego vencidos, luego pagados
  visibles.sort((a, b) => {
    const aPag = a.pagado ? 1 : 0;
    const bPag = b.pagado ? 1 : 0;
    if(aPag !== bPag) return aPag - bPag;
    return a.fecha - b.fecha;
  });

  _notifCacheLista = visibles;
  return visibles;
}

// Cuenta para el badge: cosas urgentes (≤3 días, no pagadas)
function contarNotifBadge(){
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  return _notifCacheLista.filter(n => {
    if(n.pagado) return false;
    const d = _diasEntre(hoy, n.fecha);
    return d <= 3;
  }).length;
}

// Texto de "cuándo es": HOY, MAÑANA, EN N DÍAS, VENCIDO, etc.
function notifEtiquetaTiempo(n){
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const d = _diasEntre(hoy, n.fecha);
  if(n.pagado) return '✓ PAGADO';
  if(n.tipo === 'tanda_premio' && d === 0) return '⭐ ¡HOY TE TOCA!';
  if(d < 0) return `VENCIDO HACE ${-d} DÍA${-d===1?'':'S'}`;
  if(d === 0) return 'HOY';
  if(d === 1) return 'MAÑANA';
  return `EN ${d} DÍAS`;
}

function notifClaseColor(n){
  if(n.pagado) return 'pagado';
  if(n.tipo === 'tanda_premio') return 'premio';
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const d = _diasEntre(hoy, n.fecha);
  if(d < 0 || d <= 1) return 'urgente';
  if(d <= 3) return 'pronto';
  return '';
}

// Render del modal
function renderNotificaciones(){
  const visibles = generarNotificacionesVisibles();
  const list = id('notif-list');
  if(!list) return;

  if(!visibles.length){
    list.innerHTML = `<div class="notif-empty">No tienes pagos próximos.<br><span style="font-size:11px;color:var(--text3)">Las notificaciones aparecen 5 días antes de la fecha límite.</span></div>`;
    return;
  }

  list.innerHTML = visibles.map(n => {
    const claseColor = notifClaseColor(n);
    const eti = notifEtiquetaTiempo(n);
    const fechaTxt = n.fecha.toLocaleDateString('es-MX', {weekday:'long', day:'2-digit', month:'long'});
    const recibe = n.recibe ? '+' : '';
    const montoColor = n.recibe ? 'var(--green)' : 'var(--text)';

    let acciones;
    if(n.pagado){
      acciones = `<button class="notif-btn gray" onclick="desmarcarNotif('${n.key.replace(/'/g,"\\'")}')">Desmarcar (revertir)</button>`;
    } else {
      acciones = `<button class="notif-btn green" onclick="marcarNotifPagado('${n.key.replace(/'/g,"\\'")}')">✓ Marcar como pagado</button>`;
    }

    return `<div class="notif-card ${claseColor}">
      <div class="notif-hdr">
        <div class="notif-fecha ${claseColor}">${eti} · ${fechaTxt}</div>
        <div class="notif-monto" style="color:${montoColor}">${recibe}${mxn(n.monto)}</div>
      </div>
      <div class="notif-titulo">${n.titulo}</div>
      ${n.sub ? `<div class="notif-sub">${n.sub}</div>` : ''}
      <div class="notif-actions">${acciones}</div>
    </div>`;
  }).join('');
}

// Actualiza el badge de la campana
function actualizarBadgeNotif(){
  generarNotificacionesVisibles(); // refresca cache
  const n = contarNotifBadge();
  ['notif-badge', 'notif-badge-sb'].forEach(bid => {
    const badge = id(bid);
    if(!badge) return;
    if(n > 0){
      badge.textContent = n;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  });
}

// Acciones
async function marcarNotifPagado(key){
  await guardarNotifEstado(key, {
    pagado: true,
    fechaPago: _isoDate(new Date()),
    oculto: false
  });
  renderNotificaciones();
  actualizarBadgeNotif();
}

async function desmarcarNotif(key){
  await guardarNotifEstado(key, {
    pagado: false,
    fechaPago: null,
    oculto: false
  });
  renderNotificaciones();
  actualizarBadgeNotif();
}

function abrirNotificaciones(){
  renderNotificaciones();
  openModal('m-notif');
}

// Inicialización: cargar estado y refrescar badge
(async function initNotifs(){
  const waitUID = () => new Promise(r => {
    const t = setInterval(() => { if(typeof UID !== 'undefined' && UID){ clearInterval(t); r(); } }, 100);
    setTimeout(() => { clearInterval(t); r(); }, 15000);
  });
  await waitUID();
  await cargarNotifEstado();
  actualizarBadgeNotif();
  // Refrescar cada 60 segundos por si pasa el día
  setInterval(actualizarBadgeNotif, 60000);
})();


// ═══════════════════════════════════════════════════════════════
// ═══ DIVISAS (Dólares) ═══════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
//
// Movimientos:
//  - 'ingreso': agrega USD al acumulado (propinas, regalos, etc.)
//  - 'cambio':  resta USD del acumulado y registra MXN recibidos.
//               El monto MXN se agrega también como Extra del periodo actual.
//
// Tipo de cambio en tiempo real: APIs públicas con CORS habilitado.
// Primaria: open.er-api.com (gratis, sin key, CORS OK)
// Fallback: exchangerate.host (gratis, CORS OK)

let DIVISAS_MOVS = [];     // movimientos cargados desde Supabase
let TC_USD_MXN  = null;    // tipo de cambio actual
let TC_LAST_FETCH = 0;     // timestamp del último fetch (cache 30 min)
let TC_FUENTE = '';        // qué fuente se usó

async function divisasFetchTC(){
  // Cache: 30 minutos
  const ahora = Date.now();
  if(TC_USD_MXN && ahora - TC_LAST_FETCH < 30*60*1000) return TC_USD_MXN;

  // Intento 1: open.er-api.com (CORS OK, sin key)
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/USD');
    if(r.ok){
      const j = await r.json();
      if(j && j.rates && j.rates.MXN){
        TC_USD_MXN = j.rates.MXN;
        TC_LAST_FETCH = ahora;
        TC_FUENTE = 'open.er-api.com';
        return TC_USD_MXN;
      }
    }
  } catch(e){ console.warn('TC fetch (open.er-api):', e); }

  // Intento 2: exchangerate.host (CORS OK)
  try {
    const r = await fetch('https://api.exchangerate.host/latest?base=USD&symbols=MXN');
    if(r.ok){
      const j = await r.json();
      if(j && j.rates && j.rates.MXN){
        TC_USD_MXN = j.rates.MXN;
        TC_LAST_FETCH = ahora;
        TC_FUENTE = 'exchangerate.host';
        return TC_USD_MXN;
      }
    }
  } catch(e){ console.warn('TC fetch (exchangerate.host):', e); }

  return TC_USD_MXN;
}

async function cargarDivisasMovs(){
  if(typeof UID === 'undefined' || !UID) return;
  try {
    const {data} = await supa.from('divisas_movs').select('*').eq('user_id', UID).order('fecha', {ascending:false}).order('created_at', {ascending:false});
    DIVISAS_MOVS = data || [];
  } catch(e){ console.warn('cargar divisas:', e); }
}

function divisasAcumuladoUSD(){
  return DIVISAS_MOVS.reduce((a, m) => a + parseFloat(m.monto_usd||0), 0);
}

function divisasFmtUSD(v){
  return 'USD $' + (parseFloat(v)||0).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
}

function divisasFmtMXN(v){
  return 'MXN $' + (parseFloat(v)||0).toLocaleString('es-MX', {minimumFractionDigits:2, maximumFractionDigits:2});
}

async function renderDivisas(){
  // Asegurar TC y movimientos cargados
  await divisasFetchTC();
  await cargarDivisasMovs();

  const acum = divisasAcumuladoUSD();
  const tc = TC_USD_MXN || 0;
  const acumMxn = acum * tc;

  // Tarjeta principal en sección Divisas
  const elU = document.getElementById('div-acum-usd');
  const elM = document.getElementById('div-acum-mxn');
  const elT = document.getElementById('div-tc-info');
  if(elU) elU.textContent = divisasFmtUSD(acum);
  if(elM) elM.textContent = '≈ ' + divisasFmtMXN(acumMxn);
  if(elT) elT.textContent = tc ? `Tipo de cambio: $${tc.toFixed(4)} MXN/USD (${TC_FUENTE||'API'})` : 'Tipo de cambio: no disponible';

  // Tarjeta chiquita en dashboard
  const dCard = document.getElementById('dash-usd-card');
  const dM = document.getElementById('dash-usd-monto');
  const dX = document.getElementById('dash-usd-mxn');
  if(dCard){
    const visible = S.secciones && S.secciones.divisas && acum > 0;
    dCard.style.display = visible ? '' : 'none';
    if(visible){
      if(dM) dM.textContent = divisasFmtUSD(acum);
      if(dX) dX.textContent = '≈ ' + divisasFmtMXN(acumMxn);
    }
  }

  // Historial
  const list = document.getElementById('div-hist-list');
  if(!list) return;
  if(!DIVISAS_MOVS.length){
    list.innerHTML = '<div class="empty"><div class="empty-icon">—</div>Sin movimientos aún</div>';
    return;
  }
  list.innerHTML = DIVISAS_MOVS.map(m => {
    const f = new Date(m.fecha+'T12:00:00');
    const fechaStr = f.toLocaleDateString('es-MX', {weekday:'short', day:'2-digit', month:'short', year:'numeric'});
    const usd = parseFloat(m.monto_usd||0);
    if(m.tipo === 'ingreso'){
      return `<div style="border-left:3px solid var(--green);background:var(--card);padding:10px 12px;border-radius:0 8px 8px 0;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;gap:10px">
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;color:var(--green);font-weight:700">🟢 Ingreso · ${fechaStr}</div>
          <div style="font-size:13px;color:var(--text);margin-top:2px">${m.concepto || 'Ingreso de dólares'}</div>
          ${m.periodo_lbl ? `<div style="font-size:11px;color:var(--text2);margin-top:2px">Periodo: ${m.periodo_lbl}</div>` : ''}
        </div>
        <div style="text-align:right">
          <div style="font-size:14px;font-weight:800;color:var(--green);font-family:var(--mono)">+${divisasFmtUSD(usd)}</div>
          <span class="ch-del" style="font-size:14px;cursor:pointer" onclick="borrarDivisaMov(${m.id})">×</span>
        </div>
      </div>`;
    }
    // Cambio
    const mxn = parseFloat(m.monto_mxn||0);
    const tcAp = parseFloat(m.tc_aplicado||0);
    const tcMer = parseFloat(m.tc_mercado||0);
    const dif = tcMer && tcAp ? (mxn - (Math.abs(usd) * tcMer)) : null;
    return `<div style="border-left:3px solid var(--blue);background:var(--card);padding:10px 12px;border-radius:0 8px 8px 0;margin-bottom:6px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;color:var(--blue);font-weight:700">💱 Cambio a MXN · ${fechaStr}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:3px">Cambiaste: <strong style="color:var(--text)">${divisasFmtUSD(Math.abs(usd))}</strong></div>
          <div style="font-size:11px;color:var(--text2)">Recibiste: <strong style="color:var(--green)">${divisasFmtMXN(mxn)}</strong></div>
          <div style="font-size:11px;color:var(--text2)">Tipo aplicado: <strong>$${tcAp.toFixed(4)}</strong> MXN/USD ${tcMer?` · Mercado ese día: <strong>$${tcMer.toFixed(4)}</strong>`:''}</div>
          ${dif !== null ? `<div style="font-size:11px;color:${dif>=0?'var(--green)':'var(--red)'};margin-top:2px">Diferencia: <strong>${dif>=0?'+':''}${divisasFmtMXN(dif).replace('MXN $','$')} MXN</strong></div>` : ''}
          ${m.periodo_lbl ? `<div style="font-size:11px;color:var(--text2);margin-top:3px">Agregado a extras del periodo: ${m.periodo_lbl}</div>` : ''}
        </div>
        <div style="text-align:right">
          <div style="font-size:13px;color:var(--red);font-family:var(--mono);font-weight:700">${divisasFmtUSD(usd)}</div>
          <span class="ch-del" style="font-size:14px;cursor:pointer" onclick="borrarDivisaMov(${m.id})">×</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

function abrirAgregarDivisa(){
  document.getElementById('div-add-concepto').value = '';
  document.getElementById('div-add-monto').value = '';
  document.getElementById('div-add-fecha').value = todayStr();
  openModal('m-divisa-add');
}

async function guardarDivisaIngreso(){
  const c = document.getElementById('div-add-concepto').value.trim();
  const m = parseFloat(document.getElementById('div-add-monto').value)||0;
  const f = document.getElementById('div-add-fecha').value;
  if(!c){ alert('Concepto requerido'); return; }
  if(!m || m<=0){ alert('Monto debe ser mayor a 0'); return; }
  if(!f){ alert('Fecha requerida'); return; }
  // Validar que la fecha no sea futura
  const hoyStr = todayStr();
  if(f > hoyStr){ alert('La fecha no puede ser futura'); return; }

  const periodoLbl = (PERIODOS[S.periodoIdx] && PERIODOS[S.periodoIdx].lbl) || '';
  try {
    await supa.from('divisas_movs').insert({
      user_id: UID, tipo: 'ingreso', concepto: c, monto_usd: m,
      fecha: f, periodo_lbl: periodoLbl
    });
    closeModal('m-divisa-add');
    await renderDivisas();
    renderPrincipal();
  } catch(e){ console.warn('guardar divisa:', e); alert('Error al guardar'); }
}

async function abrirCambioDivisa(){
  await divisasFetchTC();
  const acum = divisasAcumuladoUSD();
  if(acum <= 0){ alert('No tienes dólares acumulados para cambiar'); return; }
  document.getElementById('cb-acum').textContent = divisasFmtUSD(acum);
  document.getElementById('cb-usd').value = '';
  document.getElementById('cb-mxn').value = '';
  document.getElementById('cb-fecha').value = todayStr();
  document.getElementById('cb-preview').style.display = 'none';
  openModal('m-divisa-cambio');
}

function actualizarPreviewCambio(){
  const usd = parseFloat(document.getElementById('cb-usd').value)||0;
  const tc = TC_USD_MXN || 0;
  const preview = document.getElementById('cb-preview');
  if(usd > 0 && tc > 0){
    preview.style.display = '';
    document.getElementById('cb-tc-mercado').textContent = `$${tc.toFixed(4)} MXN/USD`;
    document.getElementById('cb-aprox').textContent = divisasFmtMXN(usd * tc);
  } else {
    preview.style.display = 'none';
  }
}

async function guardarDivisaCambio(){
  const usd = parseFloat(document.getElementById('cb-usd').value)||0;
  const mxn = parseFloat(document.getElementById('cb-mxn').value)||0;
  const f   = document.getElementById('cb-fecha').value;
  const acum = divisasAcumuladoUSD();
  if(!usd || usd<=0){ alert('Indica cuántos USD vas a cambiar'); return; }
  if(usd > acum){ alert(`Solo tienes ${divisasFmtUSD(acum)} acumulados`); return; }
  if(!mxn || mxn<=0){ alert('Indica cuántos MXN te dieron realmente'); return; }
  if(!f){ alert('Fecha requerida'); return; }
  const hoyStr = todayStr();
  if(f > hoyStr){ alert('La fecha no puede ser futura'); return; }

  const tcAplicado = mxn / usd;
  const tcMercado  = TC_USD_MXN || null;
  const periodoLbl = (PERIODOS[S.periodoIdx] && PERIODOS[S.periodoIdx].lbl) || '';
  const extraConcepto = `Cambio de dólares (${divisasFmtUSD(usd)} a $${tcAplicado.toFixed(2)} MXN/USD)`;

  // 1) PRIMERO: guardar el Extra para obtener su ID
  let extraId = null;
  try {
    const {data:extraData, error:extraErr} = await supa.from('extras').insert({
      user_id: UID, concepto: extraConcepto, monto: mxn,
      descripcion: '', fecha: f,
      periodo_idx: S.periodoIdx
    }).select().single();
    if(extraErr) throw extraErr;
    if(extraData) extraId = extraData.id;
    // Reflejar en S.extras (memoria)
    if(!S.extras) S.extras = [];
    S.extras.push({
      id: extraId,
      concepto: extraConcepto,
      monto: mxn,
      desc: '',
      fecha: f
    });
  } catch(e){
    console.error('Error al crear extra:', e);
    alert('Error al guardar el extra. El cambio NO se registró.');
    return;
  }

  // 2) DESPUÉS: registrar el cambio en divisas_movs con el extra_id vinculado
  try {
    // Convertir extraId a string por si la columna es TEXT
    const extraIdStr = extraId != null ? String(extraId) : null;
    const {error:movErr} = await supa.from('divisas_movs').insert({
      user_id: UID, tipo: 'cambio',
      concepto: `Cambio USD→MXN`,
      monto_usd: -Math.abs(usd),
      monto_mxn: mxn,
      tc_aplicado: tcAplicado,
      tc_mercado: tcMercado,
      fecha: f,
      periodo_lbl: periodoLbl,
      extra_id: extraIdStr,
      periodo_idx: S.periodoIdx
    });
    if(movErr) throw movErr;
  } catch(e){
    console.error('Error al guardar movimiento de divisas:', e);
    // ROLLBACK: borrar el extra que ya se había creado, para que no quede huérfano
    try {
      if(extraId != null){
        await supa.from('extras').delete().eq('id', extraId);
        if(S.extras) S.extras = S.extras.filter(x => x.id !== extraId);
      }
    } catch(rb){ console.warn('rollback extra falló:', rb); }
    alert('Error al guardar el cambio. Se canceló todo (incluyendo el extra) para no descuadrar tus cuentas.\n\nDetalles en la consola (F12).');
    return;
  }

  closeModal('m-divisa-cambio');
  await renderDivisas();
  if(typeof window.renderExt === 'function') window.renderExt();
  renderPrincipal();
  alert(`✅ Cambio registrado:\n${divisasFmtUSD(usd)} → ${divisasFmtMXN(mxn)}\nAgregado a tus Extras del periodo ${periodoLbl}`);
}

async function borrarDivisaMov(id){
  // Buscar el movimiento en cache para saber si es 'cambio' y tiene extra vinculado
  const mov = DIVISAS_MOVS.find(m => m.id === id);

  // ¿Está vinculado a un gasto en "Otros"? (caso "Pagué con dólares")
  const otroVinculado = S.otrosGastos ? S.otrosGastos.find(g => g.divisaMovId === id) : null;

  if(otroVinculado){
    const r = confirm(
      `Este movimiento está vinculado al gasto "${otroVinculado.concepto}" en Otros.\n\n` +
      `Al borrarlo:\n` +
      `• Los USD $${(otroVinculado.usdPago||0).toFixed(2)} volverán a tu acumulado\n` +
      `• El gasto en Otros también se eliminará\n` +
      (otroVinculado.extraCambioId ? `• El extra del cambio (MXN $${(otroVinculado.mxnCambio||0).toFixed(2)}) también se eliminará\n` : '') +
      `\n¿Continuar?`
    );
    if(!r) return;
    try {
      // Borrar mov divisa
      await supa.from('divisas_movs').delete().eq('id', id);
      // Borrar extra del cambio si existe
      if(otroVinculado.extraCambioId){
        await supa.from('extras').delete().eq('id', otroVinculado.extraCambioId);
        if(S.extras) S.extras = S.extras.filter(x => x.id !== otroVinculado.extraCambioId);
      }
      // Borrar el gasto de Otros
      const idx = S.otrosGastos.indexOf(otroVinculado);
      if(idx >= 0) S.otrosGastos.splice(idx, 1);
      save();
      await renderDivisas();
      if(typeof window.renderOtros === 'function') window.renderOtros();
      if(typeof window.renderExt === 'function') window.renderExt();
      renderPrincipal();
    } catch(e){ console.warn('borrar mov+otro:', e); alert('Error al borrar'); }
    return;
  }

  if(!mov){
    if(!confirm('¿Eliminar este movimiento?')) return;
  } else if(mov.tipo === 'cambio' && mov.extra_id){
    // Es un cambio con extra vinculado: preguntar qué hacer con el extra
    const periodoTxt = mov.periodo_lbl ? ` del periodo ${mov.periodo_lbl}` : '';
    const monto = parseFloat(mov.monto_mxn||0).toLocaleString('es-MX',{minimumFractionDigits:2});
    const r = confirm(
      `Vas a borrar este cambio. Los ${divisasFmtUSD(Math.abs(mov.monto_usd))} volverán a tu acumulado.\n\n` +
      `⚠️ También se agregó un extra de MXN $${monto}${periodoTxt}.\n\n` +
      `¿Quieres ELIMINAR también ese extra?\n\n` +
      `Aceptar = borrar también el extra (recomendado)\n` +
      `Cancelar = solo borrar el movimiento (el extra queda)`
    );
    try {
      if(r){
        // Borrar también el extra vinculado
        await supa.from('extras').delete().eq('id', mov.extra_id);
        // Quitar de S.extras en memoria
        if(S.extras){
          S.extras = S.extras.filter(e => e.id !== mov.extra_id);
        }
      }
      await supa.from('divisas_movs').delete().eq('id', id);
      await renderDivisas();
      if(typeof window.renderExt === 'function') window.renderExt();
      renderPrincipal();
    } catch(e){ console.warn('borrar mov divisa:', e); alert('Error al borrar'); }
    return;
  } else if(mov.tipo === 'ingreso'){
    if(!confirm(`¿Eliminar este ingreso de ${divisasFmtUSD(mov.monto_usd)}?`)) return;
  } else {
    if(!confirm('¿Eliminar este movimiento?')) return;
  }

  // Caso simple: ingreso o movimiento sin vínculo
  try {
    await supa.from('divisas_movs').delete().eq('id', id);
    await renderDivisas();
    renderPrincipal();
  } catch(e){ console.warn('borrar mov divisa:', e); }
}

// Inicialización: cargar al inicio y refrescar TC cada 30 min
(async function initDivisas(){
  const waitUID = () => new Promise(r => {
    const t = setInterval(() => { if(typeof UID !== 'undefined' && UID){ clearInterval(t); r(); } }, 100);
    setTimeout(() => { clearInterval(t); r(); }, 15000);
  });
  await waitUID();
  await cargarDivisasMovs();
  await divisasFetchTC();
  // Render inicial si está visible
  if(typeof renderDivisas === 'function') renderDivisas().catch(console.warn);
  // Refrescar TC cada 30 min
  setInterval(() => { divisasFetchTC().then(() => renderDivisas().catch(()=>{})); }, 30*60*1000);
})();

// Re-render divisas al entrar a la sección
document.addEventListener('click', function(e){
  const btn = e.target.closest('[data-tab="divisas"], button[onclick*="\'divisas\'"]');
  if(btn){ setTimeout(() => renderDivisas().catch(()=>{}), 50); }
});

// ═══════════════════════════════════════════════════════════════
// Toggle ver/ocultar contraseña
// ═══════════════════════════════════════════════════════════════
window.togglePass = function(inputId, eyeId){
  const inp = document.getElementById(inputId);
  const eye = document.getElementById(eyeId);
  if(!inp) return;
  // SVGs minimalistas trazados (ojo abierto / ojo tachado)
  const ojoAbierto = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>';
  const ojoCerrado = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-6.5 0-10-7-10-7a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="2" y1="2" x2="22" y2="22"/></svg>';
  if(inp.type === 'password'){
    inp.type = 'text';
    if(eye) eye.innerHTML = ojoCerrado;
  } else {
    inp.type = 'password';
    if(eye) eye.innerHTML = ojoAbierto;
  }
};

// ═══════════════════════════════════════════════════════════════
// CUMPLEAÑOS
// ═══════════════════════════════════════════════════════════════
function esCumpleHoy(fechaNacISO){
  if(!fechaNacISO) return false;
  const hoy = new Date();
  const f = new Date(fechaNacISO + 'T12:00:00');
  return hoy.getMonth() === f.getMonth() && hoy.getDate() === f.getDate();
}

function calcularEdad(fechaNacISO){
  if(!fechaNacISO) return null;
  const hoy = new Date();
  const f = new Date(fechaNacISO + 'T12:00:00');
  let edad = hoy.getFullYear() - f.getFullYear();
  const m = hoy.getMonth() - f.getMonth();
  if(m < 0 || (m === 0 && hoy.getDate() < f.getDate())) edad--;
  return edad;
}

function diasParaCumple(fechaNacISO){
  if(!fechaNacISO) return null;
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const f = new Date(fechaNacISO + 'T12:00:00');
  // Cumpleaños este año
  let cumpleEsteAno = new Date(hoy.getFullYear(), f.getMonth(), f.getDate());
  cumpleEsteAno.setHours(0,0,0,0);
  if(cumpleEsteAno < hoy){
    // Ya pasó, calcular para el año siguiente
    cumpleEsteAno = new Date(hoy.getFullYear()+1, f.getMonth(), f.getDate());
  }
  return Math.round((cumpleEsteAno - hoy) / (1000*60*60*24));
}

function mostrarSaludoCumpleSiCorresponde(){
  if(typeof CURRENT_USER === 'undefined' || !CURRENT_USER) return;
  if(!CURRENT_USER.nacimiento) return;
  if(!esCumpleHoy(CURRENT_USER.nacimiento)) return;
  // Una vez al día
  const key = `bday_shown_${CURRENT_USER.id}_${todayStr()}`;
  if(localStorage.getItem(key)) return;
  localStorage.setItem(key, '1');

  const edad = calcularEdad(CURRENT_USER.nacimiento);
  const nombre = CURRENT_USER.nombre || CURRENT_USER.username || 'amig@';
  // Crear overlay especial
  const ov = document.createElement('div');
  ov.id = 'm-cumple';
  ov.className = 'overlay';
  ov.style.cssText = 'display:flex;align-items:center;justify-content:center;z-index:9999';
  ov.innerHTML = `
    <div class="modal" style="background:linear-gradient(135deg, #fef3c7, #fde68a, #fbbf24);color:#78350f;text-align:center;max-width:420px;padding:30px 24px;border-radius:18px">
      <div style="font-size:50px;line-height:1.2;margin-bottom:8px">🎂🎉🥳</div>
      <div style="font-size:22px;font-weight:800;margin-bottom:8px">¡Felices ${edad} años, ${nombre}!</div>
      <div style="font-size:14px;line-height:1.5;color:#92400e;margin-bottom:18px">
        Que este año esté lleno de logros, salud y buenas finanzas 💛<br>
        Hoy te toca brindar y disfrutar — ¡las cuentas las cuidamos juntos otro día!
      </div>
      <button onclick="document.getElementById('m-cumple').remove()" style="
        background:#78350f;color:#fef3c7;border:none;padding:12px 28px;border-radius:10px;
        font-size:14px;font-weight:700;cursor:pointer;font-family:inherit
      ">¡Gracias, sigamos! 🚀</button>
    </div>`;
  document.body.appendChild(ov);
}

// Disparar saludo después del login
setTimeout(() => {
  if(typeof CURRENT_USER !== 'undefined' && CURRENT_USER){
    mostrarSaludoCumpleSiCorresponde();
  }
}, 1500);
