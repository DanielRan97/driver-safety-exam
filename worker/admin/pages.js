// Admin HTML is built server-side (not a static asset) so the auth check
// in worker/index.js always runs before any admin markup is ever sent.

const BRAND_CSS = `
  :root{
    --almog-purple:#1E0080; --almog-blue:#1450E0; --almog-light-blue:#10A5FD;
    --almog-gradient: linear-gradient(90deg, var(--almog-purple) 0%, var(--almog-blue) 55%, var(--almog-light-blue) 100%);
    --almog-tint:#EEF2FF; --white:#FFFFFF; --ink:#1A1D29; --muted:#64708C;
    --line:#E1E5F0; --bg:#F5F7FB; --danger:#C6432A; --danger-bg:#FBEAE6;
    --success:#2E7D4F; --success-bg:#E9F3EC; --radius:12px;
    --font:'Heebo', system-ui, -apple-system, 'Segoe UI', Arial, sans-serif;
  }
  *{box-sizing:border-box;}
  body{margin:0;font-family:var(--font);background:var(--bg);color:var(--ink);}
  input,select,button{font-family:var(--font);}
  .btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:10px 16px;font-size:14px;font-weight:700;border-radius:9px;border:none;cursor:pointer;}
  .btn-primary{background:var(--almog-gradient);color:#fff;}
  .btn-outline{background:#fff;color:var(--almog-blue);border:2px solid var(--almog-blue);}
  .btn-outline:hover{background:var(--almog-tint);}
  .btn:disabled{opacity:.5;cursor:not-allowed;}
  input[type=text],input[type=password],select{padding:9px 12px;border-radius:8px;border:2px solid var(--line);font-size:14px;background:#fff;color:var(--ink);}
  input:focus,select:focus{outline:none;border-color:var(--almog-blue);box-shadow:0 0 0 3px var(--almog-tint);}
  table{width:100%;border-collapse:collapse;font-size:13.5px;background:#fff;}
  th,td{padding:9px 10px;text-align:right;border-bottom:1px solid var(--line);}
  th{color:var(--muted);font-weight:700;background:var(--bg);position:sticky;top:0;}
  tr:hover td{background:var(--almog-tint);}
  .card{background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:16px;}
  .kpi{background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:16px 18px;}
  .kpi .num{font-size:26px;font-weight:800;color:var(--almog-purple);}
  .kpi .lbl{font-size:12.5px;color:var(--muted);margin-top:2px;}
  .badge{display:inline-block;padding:2px 9px;border-radius:6px;font-size:12px;font-weight:700;}
  .badge.pass{background:var(--success-bg);color:var(--success);}
  .badge.fail{background:var(--danger-bg);color:var(--danger);}
  .badge.done{background:var(--almog-tint);color:var(--almog-purple);}
  .badge.pending{background:var(--bg);color:var(--muted);border:1px solid var(--line);}
  .badge.retry{background:#FFF7E6;color:#B8790A;}
  .clickable{cursor:pointer;color:var(--almog-blue);text-decoration:underline;}
`;

export function buildLoginPage({ error } = {}) {
  return `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>כניסת מנהל – מבחן בטיחות</title>
<link rel="icon" href="/assets/almog-icon.png">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>${BRAND_CSS}
  body{display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px;}
  .login-card{width:100%;max-width:360px;background:#fff;border-radius:14px;box-shadow:0 12px 32px rgba(20,15,70,.1);overflow:hidden;}
  .login-head{background:var(--almog-gradient);padding:24px;text-align:center;}
  .login-head img{height:34px;}
  .login-body{padding:24px;}
  .login-body label{display:block;font-size:13px;font-weight:700;margin-bottom:6px;}
  .login-body .field{margin-bottom:14px;}
  .login-body input{width:100%;padding:11px 12px;}
  .err{background:var(--danger-bg);color:var(--danger);border:2px solid var(--danger);border-radius:8px;padding:10px 12px;font-size:13px;font-weight:700;margin-bottom:14px;}
</style></head><body>
<div class="login-card">
  <div class="login-head"><img src="/assets/almog-logo.png" alt="ALMOG"></div>
  <div class="login-body">
    <h1 style="font-size:17px;margin:0 0 16px;">כניסת מנהל</h1>
    ${error ? `<div class="err">${error}</div>` : ''}
    <div id="err-box"></div>
    <form id="login-form">
      <div class="field"><label>שם משתמש</label><input type="text" id="username" autocomplete="username" required></div>
      <div class="field"><label>סיסמה</label><input type="password" id="password" autocomplete="current-password" required></div>
      <button class="btn btn-primary" type="submit" id="login-btn" style="width:100%;">כניסה</button>
    </form>
  </div>
</div>
<script>
document.getElementById('login-form').addEventListener('submit', function(e){
  e.preventDefault();
  var btn = document.getElementById('login-btn');
  btn.disabled = true; btn.textContent = 'מתחבר...';
  fetch('/api/admin/login', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({username: document.getElementById('username').value, password: document.getElementById('password').value})
  }).then(function(r){ return r.json(); }).then(function(data){
    if(data.ok){ location.href = '/admin'; return; }
    btn.disabled = false; btn.textContent = 'כניסה';
    var box = document.getElementById('err-box');
    var d = document.createElement('div');
    d.className = 'err';
    d.textContent = data.message || 'שם משתמש או סיסמה שגויים.';
    box.innerHTML = '';
    box.appendChild(d);
  }).catch(function(){
    btn.disabled = false; btn.textContent = 'כניסה';
    alert('שגיאת רשת, נסה שוב.');
  });
});
</script>
</body></html>`;
}

export function buildDashboardPage({ displayName, csrfToken, initialRoute }) {
  return `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>לוח בקרה – מבחן בטיחות</title>
<link rel="icon" href="/assets/almog-icon.png">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>${BRAND_CSS}
  .shell{display:flex;min-height:100vh;}
  .sidebar{width:220px;flex:0 0 auto;background:#fff;border-left:1px solid var(--line);padding:18px 14px;}
  .sidebar img{height:28px;margin-bottom:18px;}
  .nav-item{display:block;width:100%;text-align:right;padding:10px 12px;border-radius:8px;border:none;background:none;font-size:14px;font-weight:600;color:var(--ink);cursor:pointer;margin-bottom:2px;}
  .nav-item:hover{background:var(--bg);}
  .nav-item.active{background:var(--almog-tint);color:var(--almog-purple);}
  .main{flex:1;min-width:0;padding:20px 24px;}
  .topbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;}
  .topbar h1{font-size:19px;margin:0;}
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px;}
  .filters{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;}
  .table-wrap{overflow:auto;border:1px solid var(--line);border-radius:var(--radius);background:#fff;}
  .section-title{font-size:15px;font-weight:800;margin:0 0 10px;}
  .muted{color:var(--muted);font-size:13px;}
  .modal-backdrop{position:fixed;inset:0;background:rgba(10,15,30,.45);display:flex;align-items:flex-start;justify-content:center;padding:30px 16px;overflow:auto;z-index:20;}
  .modal{background:#fff;border-radius:12px;max-width:640px;width:100%;padding:22px;}
  .qa-item{border:1px solid var(--line);border-radius:9px;padding:12px 14px;margin-bottom:10px;}
  .qa-item .qt{font-weight:700;font-size:13.5px;margin-bottom:8px;}
  .qa-line{font-size:12.5px;padding:5px 8px;border-radius:6px;margin-bottom:3px;}
  .qa-line.correct{background:var(--success-bg);color:var(--success);font-weight:700;}
  .qa-line.wrong{background:var(--danger-bg);color:var(--danger);font-weight:700;}
  @media (max-width:760px){ .shell{flex-direction:column;} .sidebar{width:100%;display:flex;overflow-x:auto;gap:4px;align-items:center;} .nav-item{white-space:nowrap;width:auto;} }
</style></head><body>
<div class="shell">
  <div class="sidebar">
    <img src="/assets/almog-logo.png" alt="ALMOG">
    <button class="nav-item" data-view="overview">סקירה כללית</button>
    <button class="nav-item" data-view="drivers">נהגים</button>
    <button class="nav-item" data-view="incomplete">טרם השלימו</button>
    <button class="nav-item" data-view="stats">סטטיסטיקות</button>
    <button class="nav-item" data-view="guests">אורחים</button>
    <button class="nav-item" data-view="testers">טסטרים</button>
    <button class="nav-item" id="logout-btn">יציאה</button>
  </div>
  <div class="main">
    <div class="topbar">
      <h1 id="page-title">סקירה כללית</h1>
      <div class="muted">מחובר/ת: <b>${displayName}</b></div>
    </div>
    <div id="content"></div>
  </div>
</div>
<div id="modal-root"></div>
<script>
var CSRF = ${JSON.stringify(csrfToken)};
var LANG_NAMES = {he:'עברית',en:'אנגלית',ar:'ערבית',ru:'רוסית',zh:'סינית',pt:'פורטוגזית'};
var STATUS_LABELS = {not_done:'טרם ביצע', completed:'הושלם', retry_approved:'ניסיון נוסף מאושר'};

function api(path, opts){
  opts = opts || {};
  opts.headers = Object.assign({'Content-Type':'application/json'}, opts.headers||{});
  if(opts.method && opts.method !== 'GET') opts.headers['X-CSRF-Token'] = CSRF;
  return fetch(path, opts).then(function(r){
    if(r.status === 401){ location.href = '/admin'; throw new Error('unauthorized'); }
    return r.json();
  });
}
function esc(s){ var d=document.createElement('div'); d.textContent = s==null?'':s; return d.innerHTML; }
function fmtDate(iso){ if(!iso) return ''; var d = new Date(iso); return d.toLocaleDateString('he-IL') + ' ' + d.toLocaleTimeString('he-IL', {hour:'2-digit',minute:'2-digit'}); }

var titles = {overview:'סקירה כללית', drivers:'נהגים', incomplete:'טרם השלימו את המבחן', stats:'סטטיסטיקות', guests:'אורחים', testers:'טסטרים'};

function setActiveNav(view){
  document.querySelectorAll('.nav-item[data-view]').forEach(function(b){ b.classList.toggle('active', b.dataset.view === view); });
  document.getElementById('page-title').textContent = titles[view] || '';
}

function showView(view, opts){
  opts = opts || {};
  setActiveNav(view);
  if(!opts.skipPush) history.pushState({view:view}, '', '/admin' + (view === 'overview' ? '' : '/' + view));
  var renderers = {overview: renderOverview, drivers: renderDrivers, incomplete: renderIncomplete, stats: renderStats, guests: renderGuests, testers: renderTesters};
  (renderers[view] || renderOverview)();
}

function renderOverview(){
  var el = document.getElementById('content');
  el.innerHTML = '<div class="muted">טוען...</div>';
  api('/api/admin/overview').then(function(d){
    if(!d.ok) return;
    el.innerHTML =
      '<div class="kpis">' +
        kpi(d.totalRequired, 'נהגים נדרשים') +
        kpi(d.completed, 'סיימו') +
        kpi(d.remaining, 'טרם סיימו') +
        kpi(d.completionPercent + '%', 'השלמה') +
        kpi(d.averageScore, 'ציון ממוצע') +
        kpi(d.passedCount, 'עברו') +
        kpi(d.failedCount, 'נכשלו') +
        kpi(d.passPercent + '%', 'אחוז מעבר') +
      '</div>';
  });
}
function kpi(num, lbl){ return '<div class="kpi"><div class="num">' + esc(num) + '</div><div class="lbl">' + esc(lbl) + '</div></div>'; }

function renderDrivers(){
  var el = document.getElementById('content');
  el.innerHTML =
    '<div class="filters">' +
      '<input type="text" id="f-q" placeholder="חיפוש: שם / מספר עובד / ת.ז.">' +
      '<select id="f-status"><option value="">כל הסטטוסים</option><option value="not_done">טרם ביצע</option><option value="completed">הושלם</option><option value="retry_approved">ניסיון נוסף מאושר</option></select>' +
      '<select id="f-passed"><option value="">עבר/נכשל</option><option value="passed">עבר</option><option value="failed">נכשל</option></select>' +
      '<select id="f-lang"><option value="">כל השפות</option><option value="he">עברית</option><option value="en">אנגלית</option><option value="ar">ערבית</option><option value="ru">רוסית</option><option value="zh">סינית</option><option value="pt">פורטוגזית</option></select>' +
      '<select id="f-sort"><option value="employee_no">מיון: מס׳ עובד</option><option value="name">מיון: שם</option><option value="score">מיון: ציון</option><option value="date">מיון: תאריך</option><option value="status">מיון: סטטוס</option></select>' +
    '</div>' +
    '<div class="table-wrap"><table><thead><tr>' +
      '<th>שם פרטי</th><th>שם משפחה</th><th>מס׳ עובד</th><th>ת.ז.</th><th>סטטוס</th><th>ציון</th><th>עבר/נכשל</th><th>תאריך</th><th>שעה</th><th>שפה</th><th>PDF</th><th></th>' +
    '</tr></thead><tbody id="drivers-tbody"></tbody></table></div>';

  function load(){
    var qs = new URLSearchParams({
      q: document.getElementById('f-q').value,
      status: document.getElementById('f-status').value,
      passed: document.getElementById('f-passed').value,
      lang: document.getElementById('f-lang').value,
      sort: document.getElementById('f-sort').value,
    });
    api('/api/admin/drivers?' + qs.toString()).then(function(d){
      if(!d.ok) return;
      document.getElementById('drivers-tbody').innerHTML = d.drivers.map(function(r){
        var dt = r.submittedAt ? new Date(r.submittedAt) : null;
        return '<tr>' +
          '<td>' + esc(r.firstName) + '</td><td>' + esc(r.lastName) + '</td><td>' + esc(r.employeeNo) + '</td><td>' + esc(r.nationalId) + '</td>' +
          '<td><span class="badge ' + (r.status==='completed'?'done':r.status==='retry_approved'?'retry':'pending') + '">' + STATUS_LABELS[r.status] + '</span></td>' +
          '<td>' + (r.score==null?'—':r.score) + '</td>' +
          '<td>' + (r.passed==null?'—':'<span class="badge '+(r.passed?'pass':'fail')+'">'+(r.passed?'עבר':'נכשל')+'</span>') + '</td>' +
          '<td>' + (dt?dt.toLocaleDateString('he-IL'):'—') + '</td><td>' + (dt?dt.toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'}):'—') + '</td>' +
          '<td>' + (r.lang?LANG_NAMES[r.lang]||r.lang:'—') + '</td>' +
          '<td>' + (r.attemptId ? (r.pdfStatus==='stored' ? '<a href="/api/admin/attempts/'+r.attemptId+'/pdf" target="_blank">צפה ב-PDF</a>' : r.pdfStatus==='failed' ? '<span class="muted">נכשל</span>' : '<span class="muted">בהכנה</span>') : '—') + '</td>' +
          '<td><span class="clickable" data-emp="' + r.employeeId + '">פרטים</span></td>' +
        '</tr>';
      }).join('');
      document.querySelectorAll('#drivers-tbody [data-emp]').forEach(function(el2){
        el2.addEventListener('click', function(){ openDriverDetail(el2.dataset.emp); });
      });
    });
  }
  ['f-q','f-status','f-passed','f-lang','f-sort'].forEach(function(id){
    document.getElementById(id).addEventListener('input', load);
    document.getElementById(id).addEventListener('change', load);
  });
  load();
}

function renderIncomplete(){
  var el = document.getElementById('content');
  el.innerHTML = '<div class="muted">טוען...</div>';
  api('/api/admin/incomplete').then(function(d){
    if(!d.ok) return;
    el.innerHTML =
      '<div class="section-title">' + d.count + ' נהגים טרם השלימו את המבחן</div>' +
      '<div class="table-wrap"><table><thead><tr><th>שם פרטי</th><th>שם משפחה</th><th>מס׳ עובד</th></tr></thead><tbody>' +
      d.drivers.map(function(r){ return '<tr><td>'+esc(r.firstName)+'</td><td>'+esc(r.lastName)+'</td><td>'+esc(r.employeeNo)+'</td></tr>'; }).join('') +
      '</tbody></table></div>';
  });
}

function renderStats(){
  var el = document.getElementById('content');
  el.innerHTML = '<div class="muted">טוען...</div>';
  api('/api/admin/statistics').then(function(d){
    if(!d.ok) return;
    var s = d.stats;
    var top = function(list){ return list.map(function(q,i){ return '<div>'+(i+1)+'. '+esc(q.text.slice(0,70))+(q.text.length>70?'…':'')+' — '+q.missedCount+' טעויות ('+q.missedPercent+'%)</div>'; }).join(''); };
    var topCorrect = function(list){ return list.map(function(q,i){ return '<div>'+(i+1)+'. '+esc(q.text.slice(0,70))+(q.text.length>70?'…':'')+' — '+q.correctCount+' נכון</div>'; }).join(''); };
    var dist = s.scoreDistribution.map(function(b){ return '<div>'+b.label+': '+b.count+'</div>'; }).join('');
    var langs = Object.keys(s.languageCounts).map(function(k){ return '<div>'+esc(k)+': '+s.languageCounts[k]+'</div>'; }).join('');
    el.innerHTML =
      '<div class="kpis">' +
        kpi(s.totalCompleted,'סה"כ הושלמו') + kpi(s.averageScore,'ציון ממוצע') + kpi(s.medianScore,'ציון חציוני') +
        kpi(s.highestScore,'ציון גבוה') + kpi(s.lowestScore,'ציון נמוך') + kpi(s.passedCount,'עברו') +
        kpi(s.failedCount,'נכשלו') + kpi(s.passPercent+'%','אחוז מעבר') + kpi(s.perfectScoreCount,'ציון מושלם') +
        kpi(s.averageIncorrectAnswers,'ממוצע טעויות') +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">' +
        '<div class="card"><div class="section-title">שאלות עם הכי הרבה טעויות</div>' + top(s.mostMissedQuestions) + '</div>' +
        '<div class="card"><div class="section-title">שאלות שנענו הכי הרבה נכון</div>' + topCorrect(s.mostCorrectlyAnsweredQuestions) + '</div>' +
        '<div class="card"><div class="section-title">התפלגות ציונים</div>' + dist + '</div>' +
        '<div class="card"><div class="section-title">שפות מבחן</div>' + langs + '</div>' +
      '</div>';
  });
}

function renderAttemptsTable(attempts, showEmpNo){
  return '<div class="table-wrap"><table><thead><tr><th>שם פרטי</th><th>שם משפחה</th>' + (showEmpNo?'<th>מס׳ עובד</th>':'') + '<th>ציון</th><th>עבר/נכשל</th><th>תאריך</th><th>שפה</th><th>PDF</th></tr></thead><tbody>' +
    attempts.map(function(a){
      var dt = a.submittedAt ? new Date(a.submittedAt) : null;
      return '<tr><td>'+esc(a.firstName)+'</td><td>'+esc(a.lastName)+'</td>' + (showEmpNo?'<td>'+esc(a.employeeNo||'')+'</td>':'') +
        '<td>'+a.score+'</td><td><span class="badge '+(a.passed?'pass':'fail')+'">'+(a.passed?'עבר':'נכשל')+'</span></td>' +
        '<td>'+(dt?dt.toLocaleDateString('he-IL'):'')+'</td><td>'+(LANG_NAMES[a.lang]||a.lang||'')+'</td>' +
        '<td>' + (a.pdfStatus==='stored' ? '<a href="/api/admin/attempts/'+a.attemptId+'/pdf" target="_blank">צפה</a>' : '<span class="muted">'+(a.pdfStatus==='failed'?'נכשל':'בהכנה')+'</span>') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
}

function renderGuests(){
  var el = document.getElementById('content');
  el.innerHTML = '<div class="muted">טוען...</div>';
  api('/api/admin/guests').then(function(d){ if(d.ok) el.innerHTML = renderAttemptsTable(d.attempts, false); });
}
function renderTesters(){
  var el = document.getElementById('content');
  el.innerHTML = '<div class="muted">טוען...</div>';
  api('/api/admin/testers').then(function(d){ if(d.ok) el.innerHTML = renderAttemptsTable(d.attempts, true); });
}

function openDriverDetail(employeeId){
  history.pushState({view:'driver', id:employeeId}, '', '/admin/drivers/' + employeeId);
  api('/api/admin/drivers/' + employeeId).then(function(d){
    if(!d.ok){ alert('שגיאה בטעינת פרטי הנהג'); return; }
    renderDriverModal(employeeId, d);
  });
}

function renderDriverModal(employeeId, d){
  var e = d.employee, a = d.latestAttempt;
  var qaHtml = a ? a.questions.map(function(q, i){
    return '<div class="qa-item"><div class="qt">שאלה '+(i+1)+': '+esc(q.questionText)+'</div>' +
      (q.correctText ? '<div class="qa-line correct">נכון: '+esc(q.correctText)+'</div>' : '') +
      (!q.isCorrect && q.chosenText ? '<div class="qa-line wrong">נבחר: '+esc(q.chosenText)+'</div>' : '') +
      '</div>';
  }).join('') : '<div class="muted">אין ניסיון עדיין.</div>';

  var historyHtml = d.attemptHistory.map(function(h){
    return '<div>' + fmtDate(h.submittedAt) + ' — ציון ' + h.score + ' (' + (h.passed?'עבר':'נכשל') + ')</div>';
  }).join('') || '<div class="muted">אין היסטוריה.</div>';

  document.getElementById('modal-root').innerHTML =
    '<div class="modal-backdrop" id="modal-backdrop"><div class="modal">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">' +
        '<div><h2 style="margin:0;font-size:18px;">' + esc(e.firstName) + ' ' + esc(e.lastName) + '</h2>' +
        '<div class="muted">מס׳ עובד: ' + esc(e.employeeNo) + ' · ת.ז.: ' + esc(e.nationalId) + '</div></div>' +
        '<button class="btn btn-outline" id="modal-close">סגור</button>' +
      '</div>' +
      (a ? ('<div class="muted" style="margin-bottom:10px;">ציון: <b>'+a.score+'</b> (' + (a.passed?'עבר':'נכשל') + ') · ' + a.correctCount + ' נכון, ' + a.incorrectCount + ' שגוי · שפת מבחן: ' + esc(a.langName) + ' · ' + fmtDate(a.submittedAt) + '</div>') : '') +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;">' +
        (a && a.pdfStatus === 'stored' ? '<a class="btn btn-outline" href="/api/admin/attempts/'+a.attemptId+'/pdf" target="_blank">צפה ב-PDF</a>' : '') +
        (a && a.pdfStatus === 'failed' ? '<button class="btn btn-outline" id="retry-pdf-btn">נסה שוב ליצור PDF</button>' : '') +
        (!e.canDoAgain ? '<button class="btn btn-primary" id="allow-retry-btn">אפשר ניסיון נוסף</button>' : '<span class="badge retry">ניסיון נוסף כבר מאושר</span>') +
      '</div>' +
      '<div class="section-title">היסטוריית ניסיונות</div>' + historyHtml +
      '<div class="section-title" style="margin-top:14px;">שאלות ותשובות</div>' + qaHtml +
    '</div></div>';

  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-backdrop').addEventListener('click', function(e2){ if(e2.target.id === 'modal-backdrop') closeModal(); });
  var allowBtn = document.getElementById('allow-retry-btn');
  if(allowBtn) allowBtn.addEventListener('click', function(){
    if(!confirm('לאפשר לנהג/ת ' + e.firstName + ' ' + e.lastName + ' ניסיון נוסף?')) return;
    api('/api/admin/drivers/' + employeeId + '/can-do-again', {method:'POST'}).then(function(r){
      if(r.ok){ openDriverDetail(employeeId); } else { alert('שגיאה'); }
    });
  });
  var retryBtn = document.getElementById('retry-pdf-btn');
  if(retryBtn) retryBtn.addEventListener('click', function(){
    retryBtn.disabled = true; retryBtn.textContent = 'מנסה...';
    api('/api/admin/attempts/' + a.attemptId + '/retry-pdf', {method:'POST'}).then(function(r){
      openDriverDetail(employeeId);
    });
  });
}
function closeModal(){ document.getElementById('modal-root').innerHTML = ''; history.pushState({}, '', '/admin/drivers'); }

document.getElementById('logout-btn').addEventListener('click', function(){
  api('/api/admin/logout', {method:'POST'}).then(function(){ location.href = '/admin'; });
});

document.querySelectorAll('.nav-item[data-view]').forEach(function(b){
  b.addEventListener('click', function(){ showView(b.dataset.view); });
});
window.addEventListener('popstate', function(){ boot(true); });

function boot(fromPop){
  var path = location.pathname.replace(/^\\/admin\\/?/, '');
  if(path.indexOf('drivers/') === 0){
    showView('drivers', {skipPush:true});
    openDriverDetail(path.slice('drivers/'.length));
  } else if(path && titles[path]){
    showView(path, {skipPush:true});
  } else {
    showView('overview', {skipPush:true});
  }
}
boot();
</script>
</body></html>`;
}
