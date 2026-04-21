// ESTADO GLOBAL (cache local para rendimiento)
// ═══════════════════════════════════════════════════════
const DEF = {
  modo:'QUINCENAL', diaSem:'VIERNES', tema:'clasico',
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
      S.diaSem = c.dia_sem || 'VIERNES';
      S.periodoIdx = 0;
      S.sueldo = parseFloat(c.sueldo) || 0;
      S.sueldoFijo = c.sueldo_fijo !== false;
      S.ahoModo = c.aho_modo || 'pct';
      S.ahoPct = parseFloat(c.aho_pct) || 10;
      S.ahoFijo = parseFloat(c.aho_fijo) || 0;
      S.ahoMonto = parseFloat(c.aho_monto) || 0;
      S.periodoCerrado = c.periodo_cerrado || false;
      if(c.tema) S.tema = c.tema;
      if(c.zona_horaria) S.zonaHoraria = c.zona_horaria;
      if(c.secciones) try { S.secciones = JSON.parse(c.secciones); } catch(e){}
      if(c.sueldo_por_periodo) try { S.sueldoPorPeriodo = JSON.parse(c.sueldo_por_periodo); } catch(e){}
      if(c.otros_gastos) try { S.otrosGastos = JSON.parse(c.otros_gastos); } catch(e){}
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
      proxPago:r.prox_pago||''
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
      esTanda: r.es_tanda||false,
      tandaNum: r.tanda_num||null,
      tandaTotal: r.tanda_total||null
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
      otros_gastos: JSON.stringify(S.otrosGastos || [])
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
      dia_pago: s.diaPago||1, prox_pago: s.proxPago||''
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
      user_id: UID, concepto: d.concepto, monto: d.monto||0,
      plazo: d.plazo, pago: d.pago, freq: d.freq,
      ini: d.ini, adq: d.adq||'',
      fecha_agregado: d.fechaAgregado||new Date().toISOString().split('T')[0],
      es_tanda: d.esTanda||false,
      tanda_num: d.tandaNum||null,
      tanda_total: d.tandaTotal||null
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
  document.getElementById(mid).classList.add('open');
  const fi = document.querySelector(`#${mid} input[type=date]`);
  if(fi && !fi.value) fi.value = todayStr();
}
function closeModal(mid){ document.getElementById(mid).classList.remove('open') }
document.querySelectorAll('.overlay').forEach(o=>{
  o.addEventListener('click',e=>{ if(e.target===o) o.classList.remove('open') });
});
function todayStr(){ return new Date().toISOString().split('T')[0] }

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
      id('close-sub').textContent = hoy > p.fin
        ? `El periodo ${lbl} ya terminó. Guárdalo para avanzar.`
        : `Periodo activo — faltan ${dias} día${dias===1?'':'s'}. Guarda cuando quieras.`;
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
  let corteIni = new Date(ref.getFullYear(), ref.getMonth(), tar.corte);
  if(corteIni > ref) corteIni = new Date(ref.getFullYear(), ref.getMonth()-1, tar.corte);
  let siguienteCorte = new Date(corteIni.getFullYear(), corteIni.getMonth()+1, tar.corte);
  let corteFin = new Date(siguienteCorte); corteFin.setDate(corteFin.getDate()-1);
  let limite;
  if(tar.modo === 'DÍA DEL MES'){
    limite = new Date(siguienteCorte.getFullYear(), siguienteCorte.getMonth(), tar.pago);
    if(limite <= siguienteCorte) limite = new Date(siguienteCorte.getFullYear(), siguienteCorte.getMonth()+1, tar.pago);
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
  const corteIniVisible = new Date(cicloActivo.corteIni.getFullYear(), cicloActivo.corteIni.getMonth()-1, tar.corte);
  let corteFin = new Date(cicloActivo.corteIni); corteFin.setDate(corteFin.getDate()-1);
  let limiteVisible;
  if(tar.modo === 'DÍA DEL MES'){
    limiteVisible = new Date(cicloActivo.corteIni.getFullYear(), cicloActivo.corteIni.getMonth(), tar.pago);
    if(limiteVisible <= cicloActivo.corteIni) limiteVisible = new Date(cicloActivo.corteIni.getFullYear(), cicloActivo.corteIni.getMonth()+1, tar.pago);
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
// calcDeuEnPeriodo — Deudas con lógica tipo MSI
// ═══════════════════════════════════════════════════════
// Lógica:
// - La deuda genera fechas de pago: ini, ini+1freq, ini+2freq...
// - Primer contabilizado: de fechaAgregado a fechaPago[0] (ini). ini PUEDE ser futuro.
// - Segundo contabilizado en adelante: de fechaPago[N-1] a fechaPago[N]
// - En cada rango se cuentan quincenas de cobro y se divide el pago.
// - Si 0 quincenas en un rango, el plazo se consume sin mostrarse.
function calcDeuEnPeriodo(d){
  const p = PERIODOS[S.periodoIdx];
  if(!p) return null;
  const pIni = new Date(p.ini+'T12:00:00'); pIni.setHours(0,0,0,0);
  const pFin = new Date(p.fin+'T12:00:00'); pFin.setHours(0,0,0,0);

  if(!d.ini) return null;
  const fIni = new Date(d.ini+'T12:00:00'); fIni.setHours(0,0,0,0);
  const fAgre = d.fechaAgregado ? new Date(d.fechaAgregado+'T12:00:00') : new Date(fIni);
  fAgre.setHours(0,0,0,0);

  // N-esima fecha de pago (n=0 = fIni)
  function getNthFechaPago(n){
    if(d.freq === 'MENSUAL'){
      const diaPago = fIni.getDate();
      const f = new Date(fIni.getFullYear(), fIni.getMonth()+n, diaPago);
      const maxDia = new Date(f.getFullYear(), f.getMonth()+1, 0).getDate();
      if(f.getDate() !== diaPago) f.setDate(Math.min(diaPago, maxDia));
      return f;
    } else if(d.freq === 'QUINCENAL'){
      let y=fIni.getFullYear(), m=fIni.getMonth(), half=fIni.getDate()<=15?1:2, cnt=0;
      for(let i=0;i<200;i++){
        const fin=new Date(y,m+1,0).getDate();
        const f=half===1?new Date(y,m,15):new Date(y,m,fin);
        if(f>=fIni){ if(cnt===n) return f; cnt++; }
        half++; if(half>2){half=1;m++;if(m>11){m=0;y++;}}
      }
      return fIni;
    } else { // SEMANAL - dia extraido de fIni
      const f = new Date(fIni);
      f.setDate(f.getDate() + n*7);
      return f;
    }
  }

  // Conteo especifico por frecuencia de deuda
  function contarDiasDeuda(hastaStr, desdeStr2){
    if(d.freq === 'SEMANAL'){
      const diaIdx = fIni.getDay();
      const desde2 = new Date(desdeStr2+'T12:00:00'); desde2.setHours(0,0,0,0);
      const hasta2 = new Date(hastaStr+'T12:00:00'); hasta2.setHours(0,0,0,0);
      if(hasta2 < desde2) return 0;
      let cnt=0; const cur=new Date(desde2);
      while(cur<=hasta2){ if(cur.getDay()===diaIdx) cnt++; cur.setDate(cur.getDate()+1); }
      return cnt;
    }
    return contarDiasCobro(hastaStr, desdeStr2);
  }

  // Auto-calcular pagoActual contando fechas vencidas
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  let pagoActual = 1;
  for(let n=0; n<d.plazo; n++){
    const fp = getNthFechaPago(n); fp.setHours(0,0,0,0);
    if(fp <= hoy) pagoActual = n+2; else break;
  }
  pagoActual = Math.max(1, Math.min(pagoActual, d.plazo));
  const ultimaFecha = getNthFechaPago(d.plazo-1); ultimaFecha.setHours(0,0,0,0);
  if(ultimaFecha < hoy) return null;

  let plazoActual = pagoActual;

  for(let safety=0; safety<500; safety++){
    if(plazoActual > d.plazo) return null;

    const limitePago = getNthFechaPago(plazoActual-1); limitePago.setHours(0,0,0,0);

    let desdeConteo;
    if(plazoActual === pagoActual) desdeConteo = new Date(fAgre);
    else desdeConteo = getNthFechaPago(plazoActual-2);
    desdeConteo.setHours(0,0,0,0);

    const nTotal = Math.max(1, contarDiasDeuda(_isoStr(limitePago), _isoStr(desdeConteo)));
    const pIniMenos1 = new Date(pIni); pIniMenos1.setDate(pIniMenos1.getDate()-1);
    const cobrosAntes = contarDiasDeuda(_isoStr(pIniMenos1), _isoStr(desdeConteo));
    const quincenasEnRango = contarDiasDeuda(_isoStr(limitePago), _isoStr(desdeConteo));

    if(quincenasEnRango===0 || cobrosAntes>=nTotal){ plazoActual++; continue; }
    if(limitePago < pIni){ plazoActual++; continue; }

    const effectiveEnd = pFin < limitePago ? _isoStr(pFin) : _isoStr(limitePago);
    const cobrosHastaFin = contarDiasDeuda(effectiveEnd, _isoStr(desdeConteo));
    const quincenaActual = Math.min(nTotal, Math.max(1, cobrosHastaFin));

    // SEMANAL: pago x semanas acumuladas; MENSUAL/QUINCENAL: pago/nTotal x quincenas
    const pagoQuincena = d.freq==='SEMANAL'
      ? d.pago * quincenaActual
      : d.pago / nTotal * quincenaActual;

    // Para SEMANAL: lista de numeros de semana/numero que caen en este periodo
    let semanasEnPeriodo = null;
    if(d.freq==='SEMANAL'){
      semanasEnPeriodo = [];
      const base = plazoActual - quincenaActual + 1;
      for(let s=0; s<quincenaActual; s++) semanasEnPeriodo.push(base+s);
    }

    return { plazoActual, nTotal, quincenaActual, pagoMensual:d.pago, pagoQuincena, limitePago, liquidado:false, semanasEnPeriodo };
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
// calcSvcEnPeriodo — Servicios con quincenas, como deudas pero sin plazo
// ═══════════════════════════════════════════════════════
function calcSvcEnPeriodo(s){
  const p = PERIODOS[S.periodoIdx];
  if(!p) return null;
  const pIni = new Date(p.ini); pIni.setHours(0,0,0,0);
  const pFin = new Date(p.fin); pFin.setHours(0,0,0,0);

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
    let d = new Date(from.getFullYear(), from.getMonth(), diaPago);
    if(d < from) d = new Date(from.getFullYear(), from.getMonth()+1, diaPago);
    const maxD = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
    if(diaPago > maxD) d.setDate(maxD);
    if(offset > 0){
      d = new Date(d.getFullYear(), d.getMonth() + offset * cadaMeses, diaPago);
      const maxD2 = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
      if(diaPago > maxD2) d.setDate(maxD2);
    }
    return d;
  }

  let desdeConteo = new Date(fAgre);
  let ciclo = 0;

  for(let safety = 0; safety < 200; safety++){
    const limitePago = getNextPayDate(fAgre, ciclo);

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
  id('m-disp').textContent = mxn(disp);
  id('m-ano-g').textContent = mxn(ganAnio);
  id('m-ano-r').textContent = mxn(gasAnio);
  id('m-acum').textContent = mxn(ganAnio-gasAnio);

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
}

// ═══════════════════════════════════════════════════════
// RENDER SERVICIOS
// ═══════════════════════════════════════════════════════
function freqLabel(n){
  const labels = {1:'mensual',2:'bimestral',3:'trimestral',6:'semestral',12:'anual'};
  return labels[n] || `cada ${n} meses`;
}
function calcProxPagoSvc(s){
  if(!s.diaPago) return '';
  // Usar el fin del periodo que estamos viendo como referencia
  const p = PERIODOS[S.periodoIdx];
  const ref = p ? new Date(p.fin) : new Date();
  ref.setHours(0,0,0,0);
  const dia = s.diaPago;
  const cadaMeses = s.cadacuanto || 1;
  if(cadaMeses === 1){
    // Mensual: próximo día X después del fin del periodo actual
    let prox = new Date(ref.getFullYear(), ref.getMonth(), dia);
    if(prox <= ref) prox = new Date(ref.getFullYear(), ref.getMonth()+1, dia);
    const maxD = new Date(prox.getFullYear(), prox.getMonth()+1, 0).getDate();
    if(dia > maxD) prox.setDate(maxD);
    return prox.toLocaleDateString('es-MX',{day:'numeric',month:'long',year:'numeric'});
  } else {
    if(s.proxPago){
      let prox = new Date(s.proxPago+'T12:00:00'); prox.setHours(0,0,0,0);
      while(prox <= ref){
        prox = new Date(prox.getFullYear(), prox.getMonth()+cadaMeses, prox.getDate());
      }
      return prox.toLocaleDateString('es-MX',{day:'numeric',month:'long',year:'numeric'});
    }
    return '';
  }
}
function renderSvc(){
  const list = id('svc-list');
  const label = S.modo==='QUINCENAL'?'quincena':'semana';
  if(!S.servicios.length){
    list.innerHTML='<div class="empty"><div class="empty-icon">—</div>Sin servicios — agrega el primero</div>';
    id('tot-svc').textContent='$0.00'; return;
  }
  list.innerHTML = S.servicios.map((s,i)=>{
    const calc = calcSvcEnPeriodo(s);
    const freq = freqLabel(s.cadacuanto||1);
    const sublbl = calc ? `Q${calc.quincenaActual}/${calc.nTotal}` : '';
    const proxFecha = calcProxPagoSvc(s);
    return `<div class="svc">
      <div class="svc-info">
        <div class="svc-name">${s.concepto}</div>
        <div class="svc-sub">${freq}${s.diaPago?' · día '+s.diaPago:''}${sublbl?' · '+sublbl:''}</div>
        ${proxFecha?`<div style="font-size:10px;color:var(--text3);margin-top:1px">Próx. pago: ${proxFecha}</div>`:''}
      </div>
      <div class="svc-right">
        <div style="font-size:13px;font-weight:700;font-family:var(--mono);color:var(--text2)">${mxn(s.monto)}/${(s.cadacuanto||1)>1?s.cadacuanto+'m':'mes'}</div>
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

    const {plazoActual, nTotal, quincenaActual, pagoQuincena, semanasEnPeriodo} = calc;
    const restantes = Math.max(0, d.plazo - plazoActual + 1);
    const pct = d.plazo>0 ? Math.round(plazoActual/d.plazo*100) : 0;
    let sublbl;
    if(d.freq==='SEMANAL' && semanasEnPeriodo){
      const p=PERIODOS[S.periodoIdx];
      const pLabel=p?new Date(p.ini+'T12:00:00').toLocaleDateString('es-MX',{day:'numeric',month:'short'})+' - '+new Date(p.fin+'T12:00:00').toLocaleDateString('es-MX',{day:'numeric',month:'short'}):'';
      const tipo=d.esTanda?'Tanda':'Pago';
      sublbl='Periodo '+pLabel+' · '+tipo+(semanasEnPeriodo.length>1?'s':'')+' '+semanasEnPeriodo.join(', ')+' / '+d.plazo;
    } else {
      const label=S.modo==='QUINCENAL'?'Quincena':'Semana';
      sublbl=label+' '+quincenaActual+'/'+nTotal+' · '+(d.esTanda?'Tanda':'Pago')+' '+plazoActual+'/'+d.plazo;
    }


    const pagosYaHechos=Math.max(0,plazoActual-1);
    const saldoActual=Math.max(0,totalPagar-pagosYaHechos*d.pago);
    const esDiaPremio=d.esTanda&&semanasEnPeriodo&&semanasEnPeriodo.includes(d.tandaNum);
    const pagosACobrar=esDiaPremio?semanasEnPeriodo.filter(n=>n!==d.tandaNum):(semanasEnPeriodo||null);
    const montoCobrar=esDiaPremio?(pagosACobrar.length*d.pago):pagoQuincena;
    const premioPeriodo=esDiaPremio?((d.tandaTotal-1)*d.pago):0;
    let pagoRow;
    if(esDiaPremio){
      const cobStr=pagosACobrar.length>0?'Cobros: '+pagosACobrar.join(', ')+' = '+mxn(montoCobrar):'Sin cobros este periodo';
      pagoRow='<div class="deu-pago-row" style="flex-direction:column;align-items:flex-start;gap:4px">'
        +'<span style="font-size:12px;font-weight:700;color:var(--green)">FELICIDADES — TANDA '+d.tandaNum+'/'+d.tandaTotal+' HOY TE TOCA PREMIO, NO PAGAS TU NUMERO</span>'
        +'<span style="font-size:11px;color:var(--text2)">'+cobStr+'</span>'
        +'<div style="display:flex;align-items:center;gap:8px">'
        +(montoCobrar>0?'<span style="font-size:13px;font-weight:700;color:var(--amber);font-family:var(--mono)">-'+mxn(montoCobrar)+'</span>':'<span style="font-size:13px;font-weight:700;color:var(--green)">$0.00</span>')
        +'<span style="font-size:12px;color:var(--green);font-weight:600">+'+mxn(premioPeriodo)+' en percepciones</span>'
        +'<span class="ch-del" onclick="delDeu('+i+')">x</span></div></div>';
    } else if(d.esTanda){
      const numStr=semanasEnPeriodo?'Tanda'+(semanasEnPeriodo.length>1?'s':'')+' '+semanasEnPeriodo.join(', ')+'/'+d.tandaTotal:'Tanda '+plazoActual+'/'+d.tandaTotal;
      pagoRow='<div class="deu-pago-row"><span style="font-size:11px;color:var(--text2)">'+numStr+'</span>'
        +'<span style="font-size:13px;font-weight:700;color:var(--amber);font-family:var(--mono)">-'+mxn(montoCobrar)+'</span>'
        +'<span class="ch-del" onclick="delDeu('+i+')">x</span></div>';
    } else {
      pagoRow='<div class="deu-pago-row"><span style="font-size:11px;color:var(--text2)">Pago '+d.freq.toLowerCase()+': '+mxn(d.pago)+' → este periodo:</span>'
        +'<span style="font-size:13px;font-weight:700;color:var(--amber);font-family:var(--mono)">-'+mxn(pagoQuincena)+'</span>'
        +'<span class="ch-del" onclick="delDeu('+i+')">x</span></div>';
    }
    return '<div class="deu">'
      +'<div class="deu-hdr"><div class="deu-name">'+d.concepto+(d.esTanda?' <span style="font-size:10px;color:var(--teal)">[TANDA]</span>':'')+'</div>'
      +'<span class="badge a">'+d.freq+'</span></div>'
      +'<div class="deu-stats"><div class="deu-stat">'+(d.esTanda?'Numero:':'Pago:')+' <span>'+plazoActual+' de '+d.plazo+'</span></div>'
      +'<div class="deu-stat">Faltan: <span>'+restantes+' '+(d.esTanda?'numeros':'pagos')+'</span></div></div>'
      +'<div style="font-size:10px;color:var(--teal);font-weight:600;margin-bottom:4px">'+sublbl+'</div>'
      +'<div class="prog"><div class="prog-f" style="width:'+pct+'%;background:var(--green)"></div></div>'
      +(interes>0?'<div class="deu-rates"><div class="rate-item"><div class="rate-l">Tasa anual aprox.</div><div class="rate-v">'+tasa.toFixed(1)+'%</div></div>'
        +'<div class="rate-item"><div class="rate-l">Interes total</div><div class="rate-v r">'+mxn(interes)+'</div></div>'
        +'<div class="rate-item"><div class="rate-l">Se debe aun</div><div class="rate-v r" style="color:var(--amber)">'+mxn(saldoActual)+'</div></div></div>':'')
      +pagoRow+'</div>';

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
  onModoChange();
  // Font size buttons
  aplicarFontSize(S.fontSize || 0);
  // Set section checkboxes
  const secs = S.secciones || {};
  ['servicios','extras','tdc','msi','deudas','otros','ahorro'].forEach(k=>{
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
  const tabMap = {servicios:1,extras:2,tdc:3,msi:4,deudas:5,otros:6,ahorro:7};
  const tabs = document.querySelectorAll('.tab');
  const sbTabs = document.querySelectorAll('.sb-tab');

  Object.keys(tabMap).forEach(k=>{
    const visible = secs[k] !== false;
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
  });

  // If current tab is hidden, go to principal
  const currentScr = document.querySelector('.scr.on');
  if(currentScr && currentScr.style.display === 'none'){
    goTabBtn('principal');
  }
}
function guardarConfig(){
  S.modo = id('cfg-modo').value;
  S.diaSem = id('cfg-dia').value;
  S.tema = id('cfg-tema').value;
  S.zonaHoraria = id('cfg-tz').value;
  // Read section checkboxes
  ['servicios','extras','tdc','msi','deudas','otros','ahorro'].forEach(k=>{
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
  const n = parseInt(id('svc-n').value)||1;
  // Mensual: solo día de pago. Bimestral+: solo fecha del próximo pago
  id('svc-dia-wrap').style.display = n === 1 ? 'block' : 'none';
  id('svc-prox-wrap').style.display = n > 1 ? 'block' : 'none';
  if(n === 1) id('svc-prox').value = '';
  if(n > 1) id('svc-dia').value = '';
}

async function guardarSvc(){
  const c=id('svc-c').value.trim(), m=parseFloat(id('svc-m').value)||0;
  const n=parseInt(id('svc-n').value)||1;
  const proxPago=id('svc-prox').value||'';
  if(!c||!m){alert('Concepto y monto son requeridos');return;}
  
  let dia;
  if(n === 1){
    // Mensual: usa el campo de día
    dia=parseInt(id('svc-dia').value)||0;
    if(!dia||dia<1||dia>31){alert('Día de pago requerido (1-31)');return;}
  } else {
    // Bimestral+: saca el día de la fecha del calendario
    if(!proxPago){alert('Indica la fecha del próximo pago');return;}
    const proxDate = new Date(proxPago+'T12:00:00');
    dia = proxDate.getDate();
  }
  
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const fechaAgregado = hoy.toISOString().split('T')[0];
  const svc={concepto:c, monto:m, cadacuanto:n, diaPago:dia, fechaAgregado, proxPago};
  S.servicios.push(svc);
  await saveSvc(svc);
  save();
  id('svc-c').value=''; id('svc-m').value=''; id('svc-n').value='1'; id('svc-dia').value='';
  id('svc-prox').value=''; id('svc-prox-wrap').style.display='none'; id('svc-dia-wrap').style.display='block';
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
  const fechaAgregado = hoy.toISOString().split('T')[0];
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
  const freq=(id('deu-freq')&&id('deu-freq').value)||'MENSUAL';
  const pl=parseInt((id('deu-pl')&&id('deu-pl').value)||60);
  const box=id('deu-fnote'); if(!box) return;
  box.style.display='block';
  if(!v){box.className='ibox';box.textContent='Ingresa la fecha del primer pago.';return;}
  const hoy=new Date(); hoy.setHours(0,0,0,0);
  const fIni=new Date(v+'T12:00:00'); fIni.setHours(0,0,0,0);
  if(fIni>hoy){box.className='ibox';box.textContent='Primer pago a futuro — se calculará desde esa fecha.';return;}
  // Contar pagos vencidos
  function getNthF(n){
    if(freq==='MENSUAL'){
      const f=new Date(fIni.getFullYear(),fIni.getMonth()+n,fIni.getDate()); return f;
    } else if(freq==='QUINCENAL'){
      let y=fIni.getFullYear(),m=fIni.getMonth(),half=fIni.getDate()<=15?1:2,cnt=0;
      for(let i=0;i<200;i++){
        const fin=new Date(y,m+1,0).getDate();
        const f=half===1?new Date(y,m,15):new Date(y,m,fin);
        if(f>=fIni){if(cnt===n)return f;cnt++;}
        half++;if(half>2){half=1;m++;if(m>11){m=0;y++;}}
      }
      return fIni;
    } else {
      const f=new Date(fIni); f.setDate(f.getDate()+n*7); return f;
    }
  }
  let vencidos=0;
  for(let n=0;n<(pl||60);n++){
    const fp=getNthF(n); fp.setHours(0,0,0,0);
    if(fp<=hoy) vencidos=n+1; else break;
  }
  if(vencidos===0){box.className='obox';box.textContent='Primer pago hoy — se contabiliza en este periodo.';}
  else{box.className='wbox';box.textContent='Fecha pasada — se detectan automaticamente '+vencidos+' pago'+(vencidos>1?'s':'')+' ya realizados. No necesitas ingresar nada mas.';}
}
function setDeuFreq(){
  const v=id('deu-freq').value;
  if(id('deu-dia-n-w')) id('deu-dia-n-w').style.display=v==='SEMANAL'?'none':'block';
  if(id('deu-dia-s-w')) id('deu-dia-s-w').style.display=v==='SEMANAL'?'block':'none';
  const lbl=id('deu-pg-lbl');
  if(lbl){
    if(v==='SEMANAL') lbl.textContent='Pago semanal con intereses $';
    else if(v==='QUINCENAL') lbl.textContent='Pago quincenal con intereses $';
    else lbl.textContent='Pago mensual con intereses $';
  }
}
function setDeuTipo(){
  const tipo=id('deu-tipo')?id('deu-tipo').value:'normal';
  if(id('deu-campos-normal')) id('deu-campos-normal').style.display=tipo==='tanda'?'none':'block';
  if(id('deu-campos-tanda')) id('deu-campos-tanda').style.display=tipo==='tanda'?'block':'none';
  if(id('deu-campos-fecha-normal')) id('deu-campos-fecha-normal').style.display=tipo==='tanda'?'none':'block';
}
function setDeuFreqTanda(){
  const v=id('deu-freq-tan')?id('deu-freq-tan').value:'SEMANAL';
  if(id('deu-dia-s-w-tan')) id('deu-dia-s-w-tan').style.display=v==='SEMANAL'?'block':'none';
}
function calcTandaInfo(){
  const total=parseInt(id('tan-total')&&id('tan-total').value)||0;
  const num=parseInt(id('tan-num')&&id('tan-num').value)||0;
  const pg=parseFloat((id('deu-pg-tan')&&id('deu-pg-tan').value)||(id('deu-pg')&&id('deu-pg').value))||0;
  const box=id('deu-info');
  if(!total||!num||!pg){if(box)box.style.display='none';return;}
  const totalPagar=(total-1)*pg;
  if(box){box.style.display='block';box.className='obox';
    box.innerHTML='Pagas '+(total-1)+' números × '+mxn(pg)+' = <strong>'+mxn(totalPagar)+'</strong> &middot; Premio cuando te toque: <strong>+'+mxn(totalPagar)+'</strong>';}
}
function toggleDeuPrev(){ id('deu-prev-b').style.display=id('deu-prev').value==='si'?'block':'none'; }
function calcDeuInfo(){
  const tipo=id('deu-tipo')?id('deu-tipo').value:'normal';
  if(tipo==='tanda'){calcTandaInfo();return;}
  const m=parseFloat(id('deu-m').value)||0, pl=parseInt(id('deu-pl').value)||0, pg=parseFloat(id('deu-pg').value)||0;
  const box=id('deu-info');
  if(!m||!pl||!pg){box.style.display='none';return;}
  const total=pg*pl, int=Math.max(0,total-m);
  const tasa=int>0?(int/m/(pl/12)*100):0;
  box.style.display='block'; box.className='ibox';
  box.innerHTML='Total a pagar: <strong>'+mxn(total)+'</strong> &middot; Inter&eacute;s: <strong>'+mxn(int)+'</strong> &middot; Tasa aprox: <strong>'+tasa.toFixed(1)+'% anual</strong>';
}
function calcDeuSaldo(){
  const pg=parseFloat(id('deu-pg').value)||0, n=parseInt(id('deu-np').value)||0, m=parseFloat(id('deu-m').value)||0;
  const saldo=Math.max(0,m-pg*n);
  if(!document.activeElement.isSameNode(id('deu-sl'))) id('deu-sl').value=saldo||'';
  const box=id('deu-saldo-info'); box.style.display='block';
  box.textContent=`${n} pagos × ${mxn(pg)} = ${mxn(pg*n)} pagados · Saldo est.: ${mxn(saldo)}`;
}
function guardarDeu(){
  const tipo=id('deu-tipo')?id('deu-tipo').value:'normal';
  const freq=id('deu-freq').value;
  const ini=id('deu-ini').value, adq=(id('deu-adq')&&id('deu-adq').value)||'';
  const pg=parseFloat(id('deu-pg').value)||0;

  if(tipo==='tanda'){
    const nombre=(id('tan-nombre')&&id('tan-nombre').value.trim())||'';
    const tanTotal=parseInt(id('tan-total')&&id('tan-total').value)||0;
    const tanNum=parseInt(id('tan-num')&&id('tan-num').value)||0;
    const pgTan=parseFloat(id('deu-pg-tan')&&id('deu-pg-tan').value)||0;
    const freqTan=(id('deu-freq-tan')&&id('deu-freq-tan').value)||'SEMANAL';
    const iniTan=(id('deu-ini')&&id('deu-ini').value)||'';
    if(!nombre||!tanTotal||!tanNum||!pgTan){alert('Completa todos los campos de la tanda');return;}
    if(!iniTan){alert('La fecha de inicio de la tanda es requerida');return;}
    if(tanNum>tanTotal){alert('Tu n\u00famero no puede ser mayor al total');return;}
    const fechaAgregadoTan = iniTan; // usar fecha ini para que el calculo auto sea correcto
    const deu={concepto:nombre,monto:0,plazo:tanTotal,pago:pgTan,freq:freqTan,ini:iniTan,adq:'',fechaAgregado:fechaAgregadoTan,esTanda:true,tandaNum:tanNum,tandaTotal:tanTotal};
    S.deudas.push(deu); saveDeuDB(deu).catch(console.warn); save();
  } else {
    const c=id('deu-c').value.trim(), m=parseFloat(id('deu-m').value)||0, pl=parseInt(id('deu-pl').value)||0;
    if(!c||!m||!pl||!pg){alert('Completa todos los campos requeridos');return;}
    if(!ini){alert('La fecha del primer pago es requerida');return;}
    const fechaAgregadoDeu = ini; // usar fecha ini para que el calculo auto sea correcto
    const deu={concepto:c,monto:m,plazo:pl,pago:pg,freq,ini,adq,fechaAgregado:fechaAgregadoDeu};
    S.deudas.push(deu); saveDeuDB(deu).catch(console.warn); save();
  }
  ['deu-c','deu-m','deu-pl','deu-pg','deu-pg-tan','tan-nombre','tan-total','tan-num'].forEach(fid=>{const el=id(fid);if(el)el.value='';});
  if(id('deu-tipo'))id('deu-tipo').value='normal';
  setDeuTipo();
  if(id('deu-fnote'))id('deu-fnote').style.display='none';
  if(id('deu-info'))id('deu-info').style.display='none';
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
function guardarOtro(){
  const c=id('otros-c').value.trim(), m=parseFloat(id('otros-m').value)||0;
  const fecha=id('otros-f').value;
  if(!c||!m){alert('Concepto y monto son requeridos');return;}
  if(!fecha){alert('La fecha es requerida');return;}
  const hoy=new Date(); hoy.setHours(0,0,0,0);
  const f=new Date(fecha+'T12:00:00'); f.setHours(0,0,0,0);
  if(f>hoy){alert('La fecha no puede ser futura');return;}
  const fijoMode=id('otros-fijo').value;
  const gasto={
    concepto:c, monto:m, fecha,
    periodoIdx: S.periodoIdx, // periodo donde se creó
    fijo: fijoMode !== 'no',
    fijoHasta: fijoMode==='fecha' ? id('otros-hasta').value : null,
    fijoIndef: fijoMode==='indef'
  };
  S.otrosGastos.push(gasto);
  save();
  id('otros-c').value=''; id('otros-m').value=''; id('otros-f').value='';
  id('otros-fijo').value='no'; id('otros-fijo-fecha').style.display='none';
  closeModal('m-otros'); window.renderOtros(); renderPrincipal();
}
function delOtro(i){
  S.otrosGastos.splice(i,1); save(); window.renderOtros(); renderPrincipal();
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
    return `<div class="ext-item">
      <div class="ext-dot" style="background:var(--amber)"></div>
      <div class="ext-info">
        <div class="ext-name">${g.concepto}</div>
        <div class="ext-desc">${g.fecha||''} · <span style="cursor:pointer;color:${g.fijo||g.fijoIndef?'var(--teal)':'var(--text3)'}" onclick="toggleOtroFijo(${i})">${fijoLabel}</span></div>
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
  list.innerHTML = S.servicios.map((s,i)=>{
    const calc = calcSvcEnPeriodo(s);
    const freq = freqLabel(s.cadacuanto||1);
    const sublbl = calc ? `Q${calc.quincenaActual}/${calc.nTotal}` : '';
    const proxFecha = calcProxPagoSvc(s);
    return `<div class="svc">
      <div class="svc-info">
        <div class="svc-name">${s.concepto}</div>
        <div class="svc-sub">${freq}${s.diaPago?' · día '+s.diaPago:''}${sublbl?' · '+sublbl:''}</div>
        ${proxFecha?`<div style="font-size:10px;color:var(--text3);margin-top:1px">Próx. pago: ${proxFecha}</div>`:''}
      </div>
      <div class="svc-right">
        <div style="font-size:13px;font-weight:700;font-family:var(--mono);color:var(--text2)">${mxn(s.monto)}/${(s.cadacuanto||1)>1?s.cadacuanto+'m':'mes'}</div>
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

    const {plazoActual, nTotal, quincenaActual, pagoMensual, pagoQuincena, semanasEnPeriodo} = calc;
    const restantes=Math.max(0,d.plazo-plazoActual+1);
    const pct=d.plazo>0?Math.round(plazoActual/d.plazo*100):0;
    // Label dinamico segun frecuencia
    let sublbl;
    if(d.freq==='SEMANAL' && semanasEnPeriodo){
      const p=PERIODOS[S.periodoIdx];
      const pLabel=p?new Date(p.ini+'T12:00:00').toLocaleDateString('es-MX',{day:'numeric',month:'short'})+' - '+new Date(p.fin+'T12:00:00').toLocaleDateString('es-MX',{day:'numeric',month:'short'}):'';
      const tipo=d.esTanda?'Tanda':'Pago';
      sublbl='Periodo '+pLabel+' · '+tipo+(semanasEnPeriodo.length>1?'s':'')+' '+semanasEnPeriodo.join(', ')+' / '+d.plazo;
    } else {
      const label=S.modo==='QUINCENAL'?'Quincena':'Semana';
      sublbl=label+' '+quincenaActual+' de '+nTotal+' · '+(d.esTanda?'Tanda':'Pago')+' '+plazoActual+' de '+d.plazo;
    }
    const pagosYaHechos=Math.max(0,plazoActual-1);
    const saldoActual=Math.max(0,totalPagar-pagosYaHechos*d.pago);
    // Tanda logic
    const esDiaPremio=d.esTanda&&semanasEnPeriodo&&semanasEnPeriodo.includes(d.tandaNum);
    const pagosACobrar=esDiaPremio?semanasEnPeriodo.filter(n=>n!==d.tandaNum):(semanasEnPeriodo||null);
    const montoCobrar=esDiaPremio?(pagosACobrar.length*d.pago):pagoQuincena;
    const premioPeriodo=esDiaPremio?((d.tandaTotal-1)*d.pago):0;
    let pagoRowM;
    if(esDiaPremio){
      const cobStr=pagosACobrar.length>0?'Cobros: '+pagosACobrar.join(', ')+' = '+mxn(montoCobrar):'Sin cobros este periodo';
      pagoRowM='<div class="deu-pago-row" style="flex-direction:column;align-items:flex-start;gap:4px;margin-top:10px">'
        +'<span style="font-size:12px;font-weight:700;color:var(--green)">FELICIDADES — TANDA '+d.tandaNum+'/'+d.tandaTotal+' HOY TE TOCA PREMIO</span>'
        +'<span style="font-size:11px;color:var(--text2)">'+cobStr+'</span>'
        +'<div style="display:flex;align-items:center;gap:8px">'
        +(montoCobrar>0?'<span style="font-size:15px;font-weight:800;color:var(--amber);font-family:var(--mono)">-'+mxn(montoCobrar)+'</span>':'<span style="font-size:15px;font-weight:800;color:var(--green)">$0.00</span>')
        +'<span style="font-size:12px;color:var(--green);font-weight:600">+'+mxn(premioPeriodo)+'</span>'
        +'<span class="ch-del" onclick="borrarDeu('+i+')">×</span></div></div>';
    } else if(d.esTanda){
      const numStr=semanasEnPeriodo?'Tanda'+(semanasEnPeriodo.length>1?'s':'')+' '+semanasEnPeriodo.join(', ')+'/'+d.tandaTotal:'Tanda '+plazoActual+'/'+d.tandaTotal;
      pagoRowM='<div class="deu-pago-row" style="margin-top:10px"><span style="font-size:13px;color:var(--text2);font-weight:500">'+numStr+'</span>'
        +'<span style="font-size:15px;font-weight:800;color:var(--amber);font-family:var(--mono)">-'+mxn(montoCobrar)+'</span>'
        +'<span class="ch-del" onclick="borrarDeu('+i+')">×</span></div>';
    } else {
      pagoRowM='<div class="deu-pago-row" style="margin-top:10px"><span style="font-size:13px;color:var(--text2);font-weight:500">Pago '+d.freq.toLowerCase()+': '+mxn(d.pago)+' → este periodo:</span>'
        +'<span style="font-size:15px;font-weight:800;color:var(--amber);font-family:var(--mono)">-'+mxn(pagoQuincena)+'</span>'
        +'<span class="ch-del" onclick="borrarDeu('+i+')">×</span></div>';
    }
    return '<div class="deu">'
      +'<div class="deu-hdr"><div class="deu-name" style="font-size:15px;font-weight:700;color:var(--text)">'+d.concepto+(d.esTanda?' <span style="font-size:10px;color:var(--teal)">[TANDA]</span>':'')+'</div>'
      +'<span class="badge a" style="font-size:11px">'+d.freq+'</span></div>'
      +'<div class="deu-stats" style="margin:6px 0;gap:12px">'
      +'<div class="deu-stat" style="font-size:13px;color:var(--text2)">'+(d.esTanda?'Número':'Pago')+' <span style="color:var(--text);font-weight:700">'+plazoActual+'</span> de <span style="color:var(--text);font-weight:700">'+d.plazo+'</span></div>'
      +'<div class="deu-stat" style="font-size:13px;color:var(--text2)">Faltan <span style="color:var(--green);font-weight:700">'+restantes+'</span></div></div>'
      +'<div style="font-size:12px;color:var(--teal);font-weight:600;margin-bottom:6px">'+sublbl+'</div>'
      +'<div class="prog"><div class="prog-f" style="width:'+pct+'%;background:var(--green)"></div></div>'
      +(interes>0?'<div class="deu-rates" style="margin-top:8px">'
        +'<div class="rate-item"><div class="rate-l" style="font-size:12px;color:var(--text2)">Tasa anual</div><div class="rate-v" style="font-size:13px;color:var(--text);font-weight:700">'+tasa.toFixed(1)+'%</div></div>'
        +'<div class="rate-item"><div class="rate-l" style="font-size:12px;color:var(--text2)">Interes total</div><div class="rate-v r" style="font-size:13px;font-weight:700">'+mxn(interes)+'</div></div>'
        +'<div class="rate-item"><div class="rate-l" style="font-size:12px;color:var(--text2)">Se debe aun</div><div class="rate-v r" style="font-size:13px;font-weight:700;color:var(--amber)">'+mxn(saldoActual)+'</div></div></div>':'')
      +pagoRowM+'</div>';
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

    const {plazoActual, nTotal, quincenaActual, pagoMensual, pagoQuincena} = calc;
    const label = S.modo==='QUINCENAL'?'Quincena':'Semana';
    const sublbl = `${label} ${quincenaActual} de ${nTotal} · Pago mensual ${plazoActual} de ${m.plazo}`;

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


// ═══════════════════════════════════════════════════════
// INIT — maneja auth y carga datos
// ═══════════════════════════════════════════════════════
