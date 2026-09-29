// Local-only UI checks. API responses are simulated; no real exam is submitted.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const vm = require('node:vm');
const assert = require('node:assert/strict');

(async () => {
  const { default: puppeteer } = await import('puppeteer');
  const root = path.resolve(__dirname, '../public');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const content = {};
  vm.createContext(content);
  vm.runInContext(html.slice(html.indexOf('  var QUESTIONS_HE ='), html.indexOf('  var currentLang =')), content);
  let submitted = [];
  let failVerify = false;
  let failSubmit = false;
  let requireEmployeeNumber = false;
  const adminContext = {};
  vm.createContext(adminContext);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../worker/admin/pages.js'),'utf8').replace(/^export /gm,''),adminContext);
  const server = http.createServer(async (req, res) => {
    if(req.url === '/admin' || req.url === '/admin/guests') {
      res.setHeader('Content-Type','text/html; charset=utf-8');
      res.end(req.url === '/admin' ? adminContext.buildLoginPage() : adminContext.buildDashboardPage({displayName:'בדיקה',csrfToken:'local-test',initialRoute:'guests'}));return;
    }
    if(req.url === '/api/admin/guests') {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,attempts:[]}));return;}
    if (req.url.startsWith('/api/')) {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      res.setHeader('Content-Type', 'application/json');
      if (req.url.includes('/verify')) {
        if (failVerify) { res.statusCode=503; res.end('{}'); return; }
        if(requireEmployeeNumber){
          const status=!body.empnum?'employee_number_required':body.empnum==='9000'?'ok':'employee_number_mismatch';
          res.statusCode=status==='ok'?200:400;
          res.end(JSON.stringify({status,...(status==='ok'?{employee:{firstName:'Test',lastName:'Driver',employeeNo:'9000'}}:{})}));return;
        }
        res.end(JSON.stringify({status:'guest'})); return;
      }
      submitted.push(body);
      if (failSubmit) { failSubmit=false; res.statusCode=503; res.end('{}'); return; }
      const correctCount=body.answers.filter((a,i)=>a===content.QUESTIONS_HE[i].correct).length;
      res.end(JSON.stringify({ok:true,score:correctCount*5,correctCount,passed:correctCount===20,passingScore:100,isGuest:true}));
      return;
    }
    const file=path.resolve(root, '.' + (req.url === '/' ? '/index.html' : req.url.split('?')[0]));
    if (!file.startsWith(root+path.sep) || !fs.existsSync(file)) { res.statusCode=404;res.end();return; }
    const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript','.png':'image/png','.woff2':'font/woff2'};
    res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'driver-exam-ui-'));
  try {
    browser=await puppeteer.launch({headless:true,executablePath:process.env.EXAM_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',timeout:30000});
    const page=await browser.newPage();
    const errors=[];
    page.on('pageerror',err=>errors.push(err.message));
    page.on('request',req=>assert.ok(req.url().startsWith('http://127.0.0.1:')||req.url().startsWith('data:')||req.url().startsWith('blob:'),'Unexpected external request: '+req.url()));
    const client=await page.createCDPSession();
    await client.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:out});
    const url=`http://127.0.0.1:${server.address().port}/`;
    for (const lang of ['he','en','ar','ru','zh','pt']) {
      await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
      await page.goto(url,{waitUntil:'networkidle0'});
      await page.select('#lang-select',lang);
      assert.equal(await page.$$eval('.qblock',els=>els.length),20);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,lang+' mobile overflow');
      await page.evaluate(()=>{
        for(const[id,v]of Object.entries({'f-first':'李','f-last':'王','f-email':'guest@example.com','f-id':'11010519491231002x'}))document.getElementById(id).value=v;
      });
      requireEmployeeNumber=true;
      await page.click('#btn-to-quiz');
      await page.waitForFunction(()=>document.querySelector('#f-empnum').getAttribute('aria-invalid')==='true');
      assert.equal(await page.$eval('#details-alert',e=>e.textContent),content.T[lang].ui.employeeNumberRequired);
      assert.equal(await page.$eval('#screen-quiz',e=>e.classList.contains('hidden')),true);
      await page.$eval('#f-empnum',e=>e.value='9999');
      await page.click('#btn-to-quiz');
      await page.waitForFunction(()=>!document.querySelector('#btn-to-quiz').disabled);
      assert.equal(await page.$eval('#details-alert',e=>e.textContent),content.T[lang].ui.employeeNumberMismatch);
      assert.equal(await page.$eval('#f-empnum',e=>e.value),'9999');
      await page.$eval('#f-empnum',e=>e.value='9000');
      await page.click('#btn-to-quiz');
      await page.waitForFunction(()=>!document.querySelector('#screen-quiz').classList.contains('hidden'));
      assert.equal(await page.$eval('#participant-status',e=>e.textContent),content.T[lang].ui.driverNotice);
      requireEmployeeNumber=false;
      await page.goto(url,{waitUntil:'networkidle0'});
      await page.select('#lang-select',lang);
      await page.evaluate(()=>{
        for(const[id,v]of Object.entries({'f-first':'李','f-last':'王','f-email':'guest@example.com','f-id':'11010519491231002x'}))document.getElementById(id).value=v;
      });
      if (lang==='he') {
        failVerify=true;
        await page.click('#btn-to-quiz');
        await page.waitForFunction(()=>document.querySelector('#details-alert').classList.contains('show'));
        assert.equal(await page.$eval('#screen-quiz',e=>e.classList.contains('hidden')),true);
        failVerify=false;
      }
      await page.click('#btn-to-quiz');
      await page.waitForFunction(()=>!document.querySelector('#screen-quiz').classList.contains('hidden'));
      assert.equal(await page.$eval('#participant-status',e=>e.textContent),content.T[lang].ui.guestNotice);
      await page.click('#btn-finish');
      assert.equal(await page.$eval('#quiz-alert',e=>e.classList.contains('show')),true);
      await page.evaluate(correct=>correct.forEach((value,i)=>document.querySelector(`input[name="q${i}"][value="${value}"]`).click()),content.QUESTIONS_HE.map(q=>q.correct));
      const order=await page.$$eval('input[name="q0"]',els=>els.map(e=>e.value).join(','));
      await page.select('#lang-select',lang==='he'?'en':'he');
      await page.select('#lang-select',lang);
      assert.equal(await page.$$eval('input[name="q0"]',els=>els.map(e=>e.value).join(',')),order);
      assert.equal(await page.$$eval('input:checked',els=>els.length),20);
      if(lang==='he')failSubmit=true;
      await page.click('#btn-finish');
      if(lang==='he'){
        await page.waitForFunction(()=>!document.querySelector('#btn-retry-submit').classList.contains('hidden'));
        assert.equal(await page.$$eval('.qblock input',els=>els.every(e=>e.disabled)),true);
        await page.select('#lang-select','en');
        await page.click('#btn-retry-submit');
        await page.waitForFunction(()=>!document.querySelector('#screen-result').classList.contains('hidden'));
        assert.deepEqual(submitted[0].answers,submitted[1].answers);
        assert.equal(submitted[0].submissionToken,submitted[1].submissionToken);
        assert.equal(submitted[0].lang,submitted[1].lang);
        await page.select('#lang-select','he');
      } else await page.waitForFunction(()=>!document.querySelector('#screen-result').classList.contains('hidden'));
      assert.equal(await page.$eval('#score-num',e=>e.textContent),'100');
      assert.ok((await page.$eval('#submit-status',e=>e.textContent)).includes(content.T[lang].ui.guestNotice));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,lang+' result overflow');
      if(lang==='zh')await page.screenshot({path:path.join(out,'chinese-result.png'),fullPage:true});
      if(lang==='he'){
        await page.click('#btn-pdf');
        await page.waitForFunction(()=>!document.querySelector('#email-step').classList.contains('hidden'),{timeout:30000});
        await page.screenshot({path:path.join(out,'hebrew-result.png'),fullPage:true});
      }
      console.log(lang+': mobile layout, names, guest notice, answers, language switching, score OK');
    }
    assert.deepEqual(errors,[]);
    await page.goto(url+'admin',{waitUntil:'networkidle0'});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Admin login overflow');
    await page.goto(url+'admin/guests',{waitUntil:'networkidle0'});
    await page.waitForFunction(()=>document.querySelector('#content').textContent.includes('תוצאות האורחים נשמרות בנפרד'));
    await page.screenshot({path:path.join(out,'admin-guests-mobile.png'),fullPage:true});
    await page.setViewport({width:1366,height:900});
    await page.screenshot({path:path.join(out,'admin-guests-desktop.png'),fullPage:true});
    assert.deepEqual(errors,[]);
    console.log('PDF download and retry checks OK. Screenshots: '+out);
  } finally {
    if(browser)await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
