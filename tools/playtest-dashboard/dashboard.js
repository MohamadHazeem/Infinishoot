(() => {
  const $ = s => document.querySelector(s);
  const words = {
    title:['InfiniShoot playtest dashboard','لوحة اختبار إنفيني شوت'],server:['Playtest server','خادم الاختبار'],token:['Admin token','رمز المسؤول'],load:['Load dashboard','تحميل اللوحة'],
    loading:['Loading…','جارٍ التحميل…'],failed:['Could not load data. Check the server, token and connection.','تعذّر تحميل البيانات. تحقق من الخادم والرمز والاتصال.'],
    runs:['Runs','الجولات'],median:['Median run length (s)','وسيط مدة الجولة (ث)'],days:['Runs per day','الجولات يوميًا'],day:['UTC day','اليوم العالمي'],
    stages:['Stage reached','المرحلة الأخيرة'],stage:['Stage','المرحلة'],difficulty:['Difficulty','الصعوبة'],deaths:['Top causes of death per stage','أبرز أسباب الموت حسب المرحلة'],cause:['Cause','السبب'],n:['Count','العدد'],
    bosses:['Boss encounters','مواجهات الزعماء'],boss:['Boss','الزعيم'],kills:['Kills','هزائم الزعيم'],dead:['Deaths','الوفيات'],quit:['Quits','الانسحابات'],ttk:['Median kill (s)','وسيط القتل (ث)'],rate:['Death rate¹','نسبة الموت¹'],
    builds:['Loadouts','العتاد'],heroes:['Heroes','الأبطال'],items:['Level-up cards','بطاقات الترقية'],build:['Loadout','العتاد'],hero:['Hero','البطل'],item:['Item','العنصر'],pick:['Pick rate','نسبة الاختيار'],win:['Win rate','نسبة الفوز'],offers:['Offers','العروض'],picks:['Picks','الاختيارات'],
    frames:['Worst frame times','أطول أزمنة الإطارات'],platform:['Platform','المنصة'],medianWorst:['Median worst (ms)','وسيط الأسوأ (ملث)'],worst:['Worst (ms)','الأسوأ (ملث)'],
    bug:['Bug','خلل'],'too-hard':['Too hard','صعبة جدًا'],'too-easy':['Too easy','سهلة جدًا'],confusing:['Confusing','غير واضحة'],performance:['Performance','الأداء'],other:['Other','أخرى'],
    inbox:['Report inbox','صندوق البلاغات'],date:['Received (UTC)','الاستلام (UTC)'],category:['Category','الفئة'],note:['Player note','ملاحظة اللاعب'],files:['Files','الملفات'],replay:['Replay','الإعادة'],screenshot:['Screenshot','لقطة الشاشة'],
    empty:['No records','لا توجد سجلات'],legend:['¹ Deaths divided by completed fights. Item wins count each run that picked the item once.','¹ الوفيات مقسومة على المواجهات المكتملة. تُحسب كل جولة اختير فيها العنصر مرة واحدة.'],
  };
  let lang = 'en', data, connection;
  const t = key => words[key][lang === 'ar' ? 1 : 0];
  const el = (tag,text) => { const n=document.createElement(tag); if (text !== undefined) n.textContent=text; return n; };
  function labels() {
    document.documentElement.lang=lang; document.documentElement.dir=lang==='ar'?'rtl':'ltr';
    $('h1').textContent=document.title=t('title'); $('#serverLabel').textContent=t('server'); $('#tokenLabel').textContent=t('token'); $('#load').textContent=t('load');
    if (data) render();
  }
  $('#language').onchange=()=>{lang=$('#language').value;labels();};
  try { $('#server').value=sessionStorage.getItem('playtest.server')||''; $('#token').value=sessionStorage.getItem('playtest.token')||''; } catch {}
  function table(host,title,columns,rows,barIndex=-1) {
    host.append(el('h2',t(title)));
    if (!rows.length) { host.append(el('p',t('empty')));return; }
    const tbl=el('table'), head=tbl.createTHead().insertRow();
    columns.forEach(k=>head.append(el('th',t(k)))); const body=tbl.createTBody();
    const max=barIndex>=0 ? rows.reduce((a,r)=>Math.max(a,r[barIndex]),1):1;
    for (const row of rows) {
      const tr=body.insertRow();row.forEach((value,i)=>{
        const td=tr.insertCell(); if(value instanceof Node) td.append(value);else td.textContent=value ?? '—';
        if(i===barIndex) {
          const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),rect=document.createElementNS(ns,'rect');
          svg.setAttribute('viewBox','0 0 70 9');svg.setAttribute('aria-hidden','true');rect.setAttribute('width',String(70*value/max));rect.setAttribute('height','9');rect.setAttribute('fill','#38b764');svg.append(rect);td.append(svg);
        }
      });
    } host.append(tbl);
  }
  const percent=x=>x==null?'—':(100*x).toFixed(1)+'%';
  async function request(params,c) {
    const url=new URL(c.server+'/telemetry/summary');url.search=new URLSearchParams(params);
    const result=await fetch(url,{headers:{Authorization:'Bearer '+c.token},credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',redirect:'error'});
    if (!result.ok) throw Error('request');return result;
  }
  function files(report) {
    const div=el('div');
    for(const part of ['replay','screenshot']) if(report[part]) {
      const b=el('button',t(part));div.append(b);b.onclick=async()=>{
        try {
          const blob=await (await request({report:report.seq,part},connection)).blob();
          const url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='report-'+report.seq+(part==='replay'?'.isr':'.jpg');a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
        }catch{$('#status').textContent=t('failed');}
      };
    }return div;
  }
  function render() {
    const a=playtestStats.aggregate(data.runs),main=$('main');main.replaceChildren();$('#status').textContent=t('legend');
    $('#overview').textContent=t('runs')+' · '+a.count+'     |     '+t('median')+' · '+(a.median?.toFixed(1)??'—');
    const block=(...args)=>{const section=el('section');main.append(section);table(section,...args);};
    block('days',['day','runs'],a.days,1);block('stages',['stage','runs'],a.stages,1);block('difficulty',['difficulty','runs'],a.difficulties,1);
    block('deaths',['stage','cause','n'],a.deaths,2);block('bosses',['boss','kills','dead','quit','ttk','rate'],a.bosses.map(x=>[...x.slice(0,-1),percent(x.at(-1))]));
    for(const [rows,title,id] of [[a.heroes,'heroes','hero'],[a.loadouts,'builds','build']]) block(title,[id,'runs','pick','win'],rows.map(([k,n,p,w])=>[k,n,percent(p),percent(w)]));
    block('items',['item','offers','picks','pick','win'],a.items.map(([k,o,n,p,w])=>[k,o,n,percent(p),percent(w)]));
    block('frames',['platform','runs','medianWorst','worst'],a.frames);
    const inbox=$('#inbox');inbox.hidden=false;inbox.replaceChildren();table(inbox,'inbox',['date','category','note','files'],data.reports.slice().reverse().map(r=>[new Date(r.received*1000).toISOString().slice(0,16).replace('T',' '),t(r.category),r.note,files(r)]));
  }
  $('form').onsubmit=async e=>{
    e.preventDefault(); $('#load').disabled=true;$('#status').textContent=t('loading');
    try{
      const u=new URL($('#server').value);
      if (u.username||u.password||u.search||u.hash||!(u.protocol==='https:' || (u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))) throw Error('server');
      const c={server:u.href.replace(/\/+$/,''),token:$('#token').value.trim()};
      const runs=[],reports=[];let runAfter=0,reportAfter=0;
      for(;;){
        const page=await (await request({runAfter,reportAfter},c)).json();
        for(const r of page.runs){runs.push(r.run);runAfter=r.seq;}for(const r of page.reports){reports.push(r);reportAfter=r.seq;}if(!page.more)break;
      }
      try{sessionStorage.setItem('playtest.server',c.server);sessionStorage.setItem('playtest.token',c.token);}catch{}
      connection=c;data={runs,reports};render();
    }catch{$('#status').textContent=t('failed');}finally{$('#load').disabled=false;}
  };
  labels();
})();
