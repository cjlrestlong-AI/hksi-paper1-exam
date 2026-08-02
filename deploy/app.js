(function(){
  'use strict';
  const KEY='hksi_qbank_v1';
  let QBANK=null, USING_SAMPLE=false, KEY2Q={};
  let curChId=null, curChFilter='unanswered', lastChList=[], qlExpanded=false;
  let state=load();
  let quiz=null;

  function load(){ try{return JSON.parse(localStorage.getItem(KEY))||{};}catch(e){return {};} }
  function save(){ try{localStorage.setItem(KEY,JSON.stringify(state));}catch(e){} schedulePush(); }

  // ===== 跨裝置雲端同步：支援「自架伺服器」與「Supabase（零自託管）」兩種後端 =====
  const SYNC_KEY='hksi_sync_uid';
  const BASE_KEY='hksi_sync_base';
  const SUPA_KEY='hksi_supabase';
  let syncOn = !window.QBANK_FULL;     // file:// 離線單檔不啟用同步
  let syncUid = '';
  let syncBase = '';                   // 自架伺服器網址（https）
  let syncMode = '';                   // '' | 'server' | 'supabase'
  let supaUrl = '', supaKey = '';      // Supabase 專案設定
  let saveTimer=null, pushing=false, curTab='home';
  let curView='home', pullTimer=null;   // curView 記錄當前畫面，用於「無感自動下拉」判斷是否安全重渲染
  // 靜態面板（答題/結果/講義/計劃除外）才允許自動下拉後靜默重渲染
  const SAFE_VIEWS=['home','practice','stats','me','wrong','fav'];
  let _lastPull=0,_lastPush=0,_cloudAns=-1;   // 同步診斷用：最近下拉/上傳時間、雲端題數
  function getSupa(){try{return JSON.parse(localStorage.getItem(SUPA_KEY)||'null');}catch(e){return null;}}
  function setSupa(o){try{localStorage.setItem(SUPA_KEY,JSON.stringify(o));}catch(e){}}
  function readCookie(n){try{const m=document.cookie.match(new RegExp('(?:^|; )'+n+'=([^;]*)'));return m?decodeURIComponent(m[1]):'';}catch(e){return '';}}
  function writeCookie(n,v,d){try{const e=new Date(Date.now()+d*864e5).toUTCString();document.cookie=n+'='+encodeURIComponent(v)+'; expires='+e+'; path=/; SameSite=Lax';}catch(e){}}
  function getUid(){return (localStorage.getItem(SYNC_KEY)||readCookie(SYNC_KEY)||'').trim();}
  function setUid(u){try{localStorage.setItem(SYNC_KEY,u);}catch(e){} writeCookie(SYNC_KEY,u,365);}
  function getBase(){try{return (localStorage.getItem(BASE_KEY)||'').trim();}catch(e){return '';}}
  function setBase(b){try{localStorage.setItem(BASE_KEY,b);}catch(e){}}
  function schedulePush(){ if(!syncOn||!syncUid)return; if(saveTimer)clearTimeout(saveTimer); saveTimer=setTimeout(pushSync,1200); }
  function pushSync(){
    if(!syncOn||!syncUid||pushing)return; pushing=true;
    if(syncMode==='supabase'){
      supaUpsert({uid:syncUid,data:state,updated_at:Date.now()})
        .then(()=>{state._syncedAt=Date.now();_lastPush=Date.now();})
        .catch(err=>{ toast('☁️ 上傳失敗（'+(err&&err.message||'網路錯誤')+'）— 請檢查 Supabase RLS/權限'); })
        .then(()=>{pushing=false;});
      return;
    }
    fetch((syncBase||'')+'/api/progress',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid:syncUid,data:state,updatedAt:Date.now()})})
      .then(r=>r.ok?r.json():null).then(j=>{ if(j&&j.updatedAt){state._syncedAt=j.updatedAt;_lastPush=Date.now();} })
      .catch(()=>{}).then(()=>{pushing=false;});
  }
  function mergeState(R){
    let changed=false;
    const L=state;
    // 已作答題目（object: id -> {correct,ts}），取較新者
    L.answered=L.answered||{}; R.answered=R.answered||{};
    const ba=Object.keys(L.answered).length;
    const a={...L.answered};
    Object.keys(R.answered).forEach(k=>{ if(!a[k]||(R.answered[k].ts||0)>=(a[k].ts||0)) a[k]=R.answered[k]; });
    L.answered=a;
    if(Object.keys(L.answered).length!==ba)changed=true;
    // 陣列型集合（錯題/收藏/打卡日）
    ['wrong','fav','checkins'].forEach(f=>{
      const b=(L[f]||[]).length;
      const s=new Set((L[f]||[]).concat(R[f]||[])); L[f]=[...s];
      if((L[f]||[]).length!==b)changed=true;
    });
    // planDone 為 object（打卡任務 id -> true），物件合併
    const bp=Object.keys(L.planDone||{}).length;
    L.planDone=Object.assign({}, L.planDone||{}, R.planDone||{});
    if(Object.keys(L.planDone||{}).length!==bp)changed=true;
    if(changed)save();   // 僅在真的合併到新資料時才寫入與上傳，避免無謂刷新閃爍
    return changed;
  }
  function pullSync(cb, notify){
    if(!syncOn||!syncUid){cb&&cb();return;}
    const finish=()=>{cb&&cb();};
    // 僅在「安全靜態面板」且資料有變動時，靜默重渲染並保留滾動位置，做到完全無感
    const rerender=()=>{
      if(!SAFE_VIEWS.includes(curView))return;
      const st=el('screen').scrollTop;
      if(curView==='home')goHome();
      else if(curView==='practice')goPractice();
      else if(curView==='stats')goStats();
      else if(curView==='me')goMe();
      else if(curView==='wrong')goWrong();
      else if(curView==='fav')goFav();
      el('screen').scrollTop=st;
    };
    // 套用雲端資料：成功拉取即記錄時間與雲端題數；有變動才重渲染
    const apply=obj=>{
      const dd = (obj&&!Array.isArray(obj)) ? obj.data : (obj&&obj[0]?obj[0].data:null);
      if(dd){
        _lastPull=Date.now();
        _cloudAns = dd.answered?Object.keys(dd.answered).length:-1;
        if(mergeState(dd)){
          rerender();
          if(notify)toast('☁️ 已從雲端同步新進度（本機已更新）');
        }
        return true;
      }
      return false;
    };
    if(syncMode==='supabase'){
      supaSelect(syncUid).then(arr=>{ if(!apply(arr)) pushSync(); finish(); })
        .catch(()=>{finish();});
      return;
    }
    fetch((syncBase||'')+'/api/progress?uid='+encodeURIComponent(syncUid)).then(r=>r.ok?r.json():null).then(j=>{ if(!apply(j)) pushSync(); finish(); })
      .catch(()=>{finish();});
  }
  // 每 15 秒無感自動下拉：任何視圖都會「拉取並合併」資料（保證資料永遠收斂）；
  // 只有「靜態面板」才靜默重渲染，答題/結果/講義/計劃等臨時畫面絕不打斷。
  function startAutoPull(){
    if(pullTimer)clearInterval(pullTimer);
    pullTimer=setInterval(()=>{
      if(syncOn&&syncUid) pullSync(null,true);
    },15000);
  }
  // 手動「立即雙向同步」：先下拉合併雲端，再上傳本機，確保兩邊完全一致
  function fullSync(){
    if(!syncOn||!syncUid){toast('尚未連接雲端，請先於「我的 › 雲端同步」設定');return;}
    toast('同步中…');
    pullSync(()=>{ pushSync(); toast('☁️ 已與雲端雙向同步'); }, false);
  }
  function syncStatus(){
    const mode = syncMode==='supabase'?'Supabase 雲端':(syncMode==='server'?'同步伺服器':'—');
    const lp = _lastPull?Math.max(0,Math.round((Date.now()-_lastPull)/1000))+' 秒前':'從未';
    const lpu = _lastPush?Math.max(0,Math.round((Date.now()-_lastPush)/1000))+' 秒前':'從未';
    const la = Object.keys(state.answered||{}).length;
    const ca = _cloudAns>=0?_cloudAns:'—';
    return '模式：'+mode+'<br>本機 <b>'+la+'</b> 題　·　雲端 <b>'+ca+'</b> 題<br>最近下拉 '+lp+'　·　最近上傳 '+lpu;
  }
  function supaSelect(code){
    const url=supaUrl.replace(/\/+$/,'')+'/rest/v1/progress?uid=eq.'+encodeURIComponent(code)+'&select=*';
    return fetch(url,{headers:{'apikey':supaKey,'Authorization':'Bearer '+supaKey}}).then(r=>{ if(!r.ok)throw new Error('sel '+r.status); return r.json(); });
  }
  function supaUpsert(rec){
    const url=supaUrl.replace(/\/+$/,'')+'/rest/v1/progress?on_conflict=uid';
    return fetch(url,{method:'POST',headers:{'apikey':supaKey,'Authorization':'Bearer '+supaKey,'Content-Type':'application/json','Prefer':'resolution=merge-duplicates'},body:JSON.stringify(rec)}).then(r=>{ if(!r.ok)throw new Error('upd '+r.status); return r; });
  }
  function initSync(){
    if(!syncOn)return;            // file:// 離線單檔不啟用
    const supa=getSupa();
    if(supa&&supa.url&&supa.key){ // Supabase 模式（零自託管，靜態部署也能用）
      syncMode='supabase'; supaUrl=supa.url; supaKey=supa.key;
      const u=getUid();
      if(u){ syncUid=u; pullSync(); }
      else { showSyncSetup(false); }
      return;
    }
    syncBase=getBase();          // 讀取已儲存的遠端伺服器網址
    if(syncBase){
      syncMode='server';
      fetch((syncBase||'')+'/api/health').then(r=>r.ok?r.json():null).then(j=>{
        if(j&&j.ok){
          const u=getUid();
          if(u){ syncUid=u; pullSync(); }
          else { showSyncSetup(false); }
        } else { syncOn=false; if(curTab==='me')goMe(); }
      }).catch(()=>{ syncOn=false; });
      return;
    }
    // 靜態部署、尚未設定任何同步：不主動彈窗，等使用者於「我的 › 雲端同步」點開設定
    syncOn=false;
  }
  function showSyncSetup(linkMode){
    const sug = linkMode?'':'hksi-'+Math.random().toString(36).slice(2,8);
    const supa=getSupa()||{}; supaUrl=supa.url||''; supaKey=supa.key||'';
    const ov=document.createElement('div'); ov.className='sync-modal';
    ov.innerHTML=`<div class="sync-card">
      <div class="sync-h">${linkMode?'🔗 連結雲端同步碼':'☁️ 跨裝置雲端同步'}</div>
      <p class="sync-p">設定一組<b>同步碼</b>，在所有手機／微信／瀏覽器輸入<b>相同</b>同步碼，答題與打卡進度即自動雲端統一、隨處接續。</p>
      <div class="sync-row"><input id="syncInput" class="sync-in" maxlength="40" value="${sug}" placeholder="例如 stephen2026"></div>
      <div class="sync-err" id="syncErr"></div>
      <button class="primary wide" id="syncCreate">${linkMode?'連結並同步':'建立並開始同步'}</button>
      ${linkMode?'':'<button class="ghost wide" id="syncLink">我已有同步碼 ›</button>'}
      <div class="sync-note">請選一組好記且不易被猜到的碼並自行記下；更換裝置時輸入同一碼即可還原進度。</div>
      <div class="sync-adv"><div class="sync-adv-h" id="syncAdvH">▸ 進階：指定同步伺服器網址</div>
        <div class="sync-adv-b" id="syncAdvB" style="display:none">
          <div class="sync-row"><input id="syncBaseInput" class="sync-in" value="${esc(syncBase)}" placeholder="https://你的伺服器網址"></div>
          <button class="ghost wide" id="syncBaseSet">連線此伺服器</button>
          <div class="sync-err" id="syncBaseErr"></div>
        </div>
      </div>
      <div class="sync-adv"><div class="sync-adv-h" id="syncSupaH">▸ 進階：使用 Supabase 雲端（零自託管，推薦）</div>
        <div class="sync-adv-b" id="syncSupaB" style="display:none">
          <div class="sync-row"><input id="supaUrlInput" class="sync-in" value="${esc(supaUrl)}" placeholder="https://xxxx.supabase.co"></div>
          <div class="sync-row"><input id="supaKeyInput" class="sync-in" value="${esc(supaKey)}" placeholder="anon key（公開金鑰）"></div>
          <button class="ghost wide" id="supaSet">連線 Supabase</button>
          <div class="sync-err" id="supaErr"></div>
        </div>
      </div>
    </div>`;
    document.body.appendChild(ov);
    const input=ov.querySelector('#syncInput'), err=ov.querySelector('#syncErr'), btn=ov.querySelector('#syncCreate');
    btn.onclick=()=>{ const v=input.value.trim(); if(!/^[A-Za-z0-9_-]{3,40}$/.test(v)){err.textContent='同步碼須為 3–40 位英文、數字、_ 或 -';return;} syncUid=v; setUid(v); syncOn=true; ov.remove(); pushSync(); toast('已開啟雲端同步 ☁️ 進度自動備份'); };
    if(!linkMode){ const link=ov.querySelector('#syncLink'); if(link)link.onclick=()=>{ input.value=''; err.textContent=''; btn.textContent='連結並同步'; link.style.display='none'; input.focus(); }; }
    const advH=ov.querySelector('#syncAdvH'), advB=ov.querySelector('#syncAdvB');
    if(advH)advH.onclick=()=>{ advB.style.display = advB.style.display==='none'?'block':'none'; };
    const baseSet=ov.querySelector('#syncBaseSet');
    if(baseSet)baseSet.onclick=()=>{
      const b=ov.querySelector('#syncBaseInput').value.trim().replace(/\/+$/,'');
      const berr=ov.querySelector('#syncBaseErr');
      if(!/^https:\/\//.test(b)){berr.textContent='請輸入 https:// 開頭的伺服器網址';return;}
      berr.textContent='連線中…';
      fetch(b+'/api/health').then(r=>r.ok?r.json():null).then(j=>{
        if(j&&j.ok){ setBase(b); syncBase=b; syncMode='server'; berr.textContent=''; if(getUid()){syncUid=getUid();pullSync();} ov.remove(); toast('已連線同步伺服器 ☁️'); }
        else { berr.textContent='無法連線該伺服器（請確認網址與 HTTPS）'; }
      }).catch(()=>{ berr.textContent='無法連線該伺服器（跨域或網址錯誤）'; });
    };
    const supaH=ov.querySelector('#syncSupaH'), supaB=ov.querySelector('#syncSupaB');
    if(supaH)supaH.onclick=()=>{ supaB.style.display = supaB.style.display==='none'?'block':'none'; };
    const supaSet=ov.querySelector('#supaSet');
    if(supaSet)supaSet.onclick=()=>{
      const u=ov.querySelector('#supaUrlInput').value.trim().replace(/\/+$/,'').replace(/\/rest\/v1\/?$/,'');
      const k=ov.querySelector('#supaKeyInput').value.trim();
      const e=ov.querySelector('#supaErr');
      if(!/^https:\/\/.+\.supabase\.co$/.test(u)){e.textContent='請輸入 https://xxxx.supabase.co 格式網址';return;}
      if(!k){e.textContent='請貼上 anon key';return;}
      e.textContent='連線中…';
      fetch(u.replace(/\/+$/,'')+'/rest/v1/progress?select=uid&limit=1',{headers:{'apikey':k,'Authorization':'Bearer '+k}}).then(r=>{
        if(r.ok||r.status===200){
          setSupa({url:u,key:k}); supaUrl=u; supaKey=k; syncMode='supabase'; syncOn=true; e.textContent='✅ Supabase 已連線，請設定下方同步碼';
          const uid=getUid(); if(uid){syncUid=uid;pullSync();ov.remove();toast('已連線 Supabase ☁️');}
          else { toast('Supabase 已連線，請設定同步碼'); }
        } else { e.textContent='連線失敗（'+r.status+'）— 請確認網址/key，且資料表 progress 已建立'; }
      }).catch(()=>{ e.textContent='連線失敗（跨域/CORS）— 請到 Supabase 設定允許此網站來源'; });
    };
  }

  if(!state.answered)state.answered={};
  if(!state.wrong)state.wrong=[];
  if(!state.fav)state.fav=[];
  if(!state.checkins)state.checkins=[];
  if(!state.planDone)state.planDone={};

  function todayStr(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
  function esc(s){return (s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
  function pad(n){return String(n).padStart(2,'0');}
  function fmtTime(sec){sec=Math.max(0,sec|0);const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;return h>0?h+':'+pad(m)+':'+pad(s):pad(m)+':'+pad(s);}
  function arraysEqual(a,b){if(a.length!==b.length)return false;const x=[...a].sort(),y=[...b].sort();return x.every((v,i)=>v===y[i]);}
  function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
  function daysLeft(){const t=new Date('2026-09-15T00:00:00');const d=Math.ceil((t-new Date())/864e5);return Math.max(0,d);}
  function el(id){return document.getElementById(id);}
  function setScreen(html){const s=el('screen');s.innerHTML=html;s.scrollTop=0;}
  function setActive(tab){document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===tab));}

  function buildIndex(){
    KEY2Q={};
    QBANK.chapters.forEach(c=>c.questions.forEach(q=>{KEY2Q[q.id]=q;q._ch=c.id;}));
    QBANK.mockExam.forEach(q=>{const k='mock:'+q.id;KEY2Q[k]=q;q._mock=true;});
  }
  function sessionKey(q){return q._mock?('mock:'+q.id):q.id;}
  function getQ(k){return KEY2Q[k];}

  function boot(){
    // standalone / file:// 模式：直接读取内联全量题库
    if(window.QBANK_FULL){QBANK=window.QBANK_FULL;USING_SAMPLE=false;afterLoad();return;}
    fetch('data/questions.json').then(r=>{if(!r.ok)throw 0;return r.json();})
      .then(d=>{QBANK=d;USING_SAMPLE=false;afterLoad();})
      .catch(()=>{QBANK=window.QBANK_SAMPLE||null;USING_SAMPLE=true;afterLoad();});
  }
  function afterLoad(){
    if(!QBANK){setScreen('<p style="padding:20px;color:#8b9bb0">題庫載入失敗</p>');return;}
    buildIndex();goHome();initSync();startAutoPull();
  }

  function computeStats(){
    let total=0,correct=0;const byCh={};for(let i=1;i<=9;i++)byCh[i]={answered:0,correct:0};
    const daily={};
    Object.keys(state.answered).forEach(k=>{
      const r=state.answered[k];total++;if(r.correct)correct++;
      if(k.indexOf('mock:')===0)return;
      const ch=parseInt(k.split('-')[0],10);
      if(byCh[ch]){byCh[ch].answered++;if(r.correct)byCh[ch].correct++;}
      const d=new Date(r.ts);const ds=d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
      daily[ds]=(daily[ds]||0)+1;
    });
    return {total,correct,acc:total?correct/total:0,byCh,daily};
  }
  function longestStreak(dates){if(!dates.length)return 0;let best=1,cur=1;const s=[...dates].sort();for(let i=1;i<s.length;i++){const a=new Date(s[i-1]),b=new Date(s[i]);const diff=(b-a)/864e5;if(diff===1)cur++;else if(diff>1)cur=1;if(cur>best)best=cur;}return best;}

  function ring(pct){
    const r=42,c=2*Math.PI*r,off=c*(1-pct);
    return `<svg width="120" height="120" viewBox="0 0 120 120">
      <circle cx="60" cy="60" r="${r}" stroke="#26303c" stroke-width="11" fill="none"/>
      <circle cx="60" cy="60" r="${r}" stroke="#07c160" stroke-width="11" fill="none" stroke-linecap="round"
        stroke-dasharray="${c}" stroke-dashoffset="${off}" transform="rotate(-90 60 60)" style="transition:stroke-dashoffset .6s"/>
      <text x="60" y="56" text-anchor="middle" fill="#e6edf3" font-size="22" font-weight="700">${Math.round(pct*100)}%</text>
      <text x="60" y="76" text-anchor="middle" fill="#8b9bb0" font-size="11">總正確率</text>
    </svg>`;
  }
  function trend(daily){
    const days=[];const today=new Date();
    for(let i=13;i>=0;i--){const d=new Date(today);d.setDate(today.getDate()-i);
      const ds=d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());days.push({ds,v:daily[ds]||0});}
    const max=Math.max(1,...days.map(x=>x.v));
    const w=300,h=80,n=days.length,step=w/(n-1);
    const pts=days.map((x,i)=>`${(i*step).toFixed(1)},${(h-(x.v/max)*h).toFixed(1)}`).join(' ');
    return `<svg class="trend" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <polygon points="0,${h} ${pts} ${w},${h}" fill="rgba(7,193,96,.12)"/>
      <polyline points="${pts}" fill="none" stroke="#07c160" stroke-width="2"/>
    </svg>`;
  }

  // ---------- 7-week plan (in-app) ----------
  const PLAN=[
    {phase:"階段一 · 基礎鞏固",range:"W1 · 7/26–8/1",days:[
      {d:"07-26",wd:"日",ch:"總覽+第1章",p:"lo",t:"精讀第1章：SFC/HKMA/強積金局監管架構與職能"},
      {d:"07-27",wd:"一",ch:"第2章",p:"lo",t:"相關香港法例及新公司條例要點"},
      {d:"07-28",wd:"二",ch:"第3章(上)",p:"hi",t:"SFO：條例目的、證監會職能、註冊制基礎"},
      {d:"07-29",wd:"三",ch:"第3章(下)",p:"hi",t:"SFO 核心條文：市場失當、披露義務、紀律處分"},
      {d:"07-30",wd:"四",ch:"第4章(上)",p:"hi",t:"發牌及註冊：10類受規管活動、RO"},
      {d:"07-31",wd:"五",ch:"第4章(下)",p:"hi",t:"發牌條件、持續責任、操守準則"},
      {d:"08-01",wd:"六",ch:"第5章(上)",p:"hi",t:"KYC、風險承受能力評估 ★週測驗W1"}]},
    {phase:"階段一 · 基礎鞏固",range:"W2 · 8/2–8/8",days:[
      {d:"08-02",wd:"日",ch:"第5章(下)",p:"hi",t:"客戶資產保管、利益衝突、冷靜期"},
      {d:"08-03",wd:"一",ch:"第6章",p:"mid",t:"業務運作與常規：內控、風險管理、合規"},
      {d:"08-04",wd:"二",ch:"第7章",p:"mid",t:"聯交所/結算所、交易所參與者類別"},
      {d:"08-05",wd:"三",ch:"第8章",p:"mid",t:"上市規則、招股章程、收購合併守則"},
      {d:"08-06",wd:"四",ch:"第9章(上)",p:"hi",t:"內幕交易、虛假交易、操控市場定義"},
      {d:"08-07",wd:"五",ch:"第9章(下)",p:"hi",t:"AML/CFT、失當審裁處"},
      {d:"08-08",wd:"六",ch:"階段複習",p:"mid",t:"1–9章思維導圖 ★週測驗W2"}]},
    {phase:"階段二 · 專題突破",range:"W3 · 8/9–8/15",days:[
      {d:"08-09",wd:"日",ch:"第3章專題",p:"hi",t:"SFO 專題刷題＋錯題標記"},
      {d:"08-10",wd:"一",ch:"第3章錯題",p:"hi",t:"重做錯題，歸納高頻考點"},
      {d:"08-11",wd:"二",ch:"第4章專題",p:"hi",t:"發牌/RO/持續責任專題刷題"},
      {d:"08-12",wd:"三",ch:"第4章錯題",p:"hi",t:"整理「牌照 vs 註冊」對照表"},
      {d:"08-13",wd:"四",ch:"第5章專題",p:"hi",t:"操守準則/KYC/客戶資產刷題"},
      {d:"08-14",wd:"五",ch:"第5章錯題",p:"hi",t:"背誦關鍵數值（冷靜期、期限）"},
      {d:"08-15",wd:"六",ch:"模擬測驗",p:"hi",t:"★限時模考W3（60題/90分鐘）"}]},
    {phase:"階段二 · 專題突破",range:"W4 · 8/16–8/22",days:[
      {d:"08-16",wd:"日",ch:"第9章專題",p:"hi",t:"市場失當/AML 專題刷題"},
      {d:"08-17",wd:"一",ch:"第9章錯題",p:"hi",t:"梳理各類失當行為要件"},
      {d:"08-18",wd:"二",ch:"第1/2章補強",p:"lo",t:"中低優先章節查漏補缺"},
      {d:"08-19",wd:"三",ch:"第6/7/8章補強",p:"mid",t:"運作常規/交易所/上市規則補強"},
      {d:"08-20",wd:"四",ch:"混合刷題",p:"hi",t:"高優先章（3/4/5/9）混合刷題"},
      {d:"08-21",wd:"五",ch:"混合刷題",p:"mid",t:"全章節混合，統計分章正確率"},
      {d:"08-22",wd:"六",ch:"階段評估",p:"hi",t:"★週測驗W4，鎖定最弱章節"}]},
    {phase:"階段三 · 刷題強化",range:"W5 · 8/23–8/29",days:[
      {d:"08-23",wd:"日",ch:"混合A",p:"mid",t:"全章節混合刷題A卷"},
      {d:"08-24",wd:"一",ch:"錯題二刷A",p:"hi",t:"錯題二刷，標記不穩定題目"},
      {d:"08-25",wd:"二",ch:"混合B",p:"mid",t:"全章節混合刷題B卷"},
      {d:"08-26",wd:"三",ch:"錯題二刷B",p:"hi",t:"建立「高頻錯題本」"},
      {d:"08-27",wd:"四",ch:"2ce練習",p:"mid",t:"做2ce練習題，對照考點"},
      {d:"08-28",wd:"五",ch:"歷屆試題",p:"hi",t:"做歷屆試題，感受真題語感"},
      {d:"08-29",wd:"六",ch:"模擬測驗",p:"hi",t:"★週測驗W5（限時60題）"}]},
    {phase:"階段三 · 刷題強化",range:"W6 · 8/30–9/5",days:[
      {d:"08-30",wd:"日",ch:"弱項專攻",p:"hi",t:"專攻最弱章節（通常3/4/9）"},
      {d:"08-31",wd:"一",ch:"弱項專攻",p:"hi",t:"繼續弱項，背誦條文數值"},
      {d:"09-01",wd:"二",ch:"混合C",p:"mid",t:"全章節混合刷題C卷"},
      {d:"09-02",wd:"三",ch:"錯題三刷",p:"hi",t:"目標正確率 ≥ 85%"},
      {d:"09-03",wd:"四",ch:"補漏",p:"mid",t:"2ce/歷屆補漏，掃清盲點"},
      {d:"09-04",wd:"五",ch:"速記",p:"mid",t:"速記濃縮筆記與思維導圖"},
      {d:"09-05",wd:"六",ch:"階段評估",p:"hi",t:"★週測驗W6，確認達80%+"}]},
    {phase:"階段四 · 模考衝刺",range:"W7 · 9/6–9/15",days:[
      {d:"09-06",wd:"日",ch:"官網模考",p:"hi",t:"★官網60題模考（嚴格限時90分鐘）"},
      {d:"09-07",wd:"一",ch:"模考檢討",p:"hi",t:"逐題檢討，錯題回歸章節"},
      {d:"09-08",wd:"二",ch:"弱項回補",p:"hi",t:"針對模考弱項回補"},
      {d:"09-09",wd:"三",ch:"速記3/4/5",p:"hi",t:"第3/4/5章高頻考點速記"},
      {d:"09-10",wd:"四",ch:"速記9/其他",p:"mid",t:"第9章＋其餘章節速記"},
      {d:"09-11",wd:"五",ch:"第二次模考",p:"hi",t:"★限時模考，目標 ≥ 85%"},
      {d:"09-12",wd:"六",ch:"模考檢討",p:"hi",t:"最後清錯題"},
      {d:"09-13",wd:"日",ch:"總回顧",p:"mid",t:"濃縮筆記總回顧"},
      {d:"09-14",wd:"一",ch:"調整狀態",p:"lo",t:"輕鬆複習，調整作息心態"},
      {d:"09-15",wd:"二",ch:"應試",p:"hi",t:"🎯 應試日！帶身份證與準考通知"}]}
  ];

  // ---------- 複習進度即時監控 ----------
  function planDate(mmdd){const p=mmdd.split('-').map(Number);return new Date(2026,p[0]-1,p[1]);}
  const PLAN_FLAT=(()=>{const a=[];PLAN.forEach((w,wi)=>w.days.forEach((d,di)=>a.push({wi,di,id:'w'+wi+'d'+di,date:planDate(d.d),ch:d.ch,t:d.t,p:d.p})));return a;})();
  const PLAN_TOTAL=PLAN_FLAT.length;
  function estHours(d){
    const s=(d.ch||'')+(d.t||'');
    if(/模考|模擬|週測驗|測驗|應試/.test(s)) return 2;
    if(/速記|回顧|調整|狀態/.test(s)) return 1;
    if(/專題|錯題|混合|刷題|補強|補漏|二刷|三刷/.test(s)) return 1.5;
    return 2;
  }
  function doneId(id){return !!state.planDone[id];}
  function planRing(pct){
    const r=34,c=2*Math.PI*r,off=c*(1-pct);
    return `<svg width="92" height="92" viewBox="0 0 92 92">
      <circle cx="46" cy="46" r="${r}" stroke="#26303c" stroke-width="9" fill="none"/>
      <circle cx="46" cy="46" r="${r}" stroke="#4aa8ff" stroke-width="9" fill="none" stroke-linecap="round"
        stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 46 46)" style="transition:stroke-dashoffset .6s"/>
      <text x="46" y="44" text-anchor="middle" fill="#e6edf3" font-size="18" font-weight="700">${Math.round(pct*100)}%</text>
      <text x="46" y="60" text-anchor="middle" fill="#8b9bb0" font-size="9">計畫完成</text>
    </svg>`;
  }
  function renderMonitor(){
    const today=new Date(); today.setHours(0,0,0,0);
    const start=PLAN_FLAT[0].date, end=PLAN_FLAT[PLAN_FLAT.length-1].date;
    const badge=(cls,txt)=>`<span class="mon-status ${cls}">${txt}</span>`;
    if(today<start){
      return `<section class="monitor">
        <div class="mon-head"><span class="mon-title">📊 複習進度即時監控</span>${badge('st-up','尚未開始')}</div>
        <div class="mon-row"><div class="mon-label">應複習進度</div><div class="mon-val">計畫將於 ${start.getMonth()+1}/${start.getDate()} 開始</div></div>
        <div class="mon-note">距離開始還有 ${Math.round((start-today)/864e5)} 天，可先熱身閱讀講義。</div>
      </section>`;
    }
    if(today>end){
      const done=PLAN_FLAT.filter(x=>doneId(x.id)).length;
      return `<section class="monitor">
        <div class="mon-head"><span class="mon-title">📊 複習進度即時監控</span>${badge('st-done','計畫已完成')}</div>
        <div class="mon-row"><div class="mon-label">應複習進度</div><div class="mon-val">${PLAN_TOTAL} 天計畫已結束，9/15 應試 🎯</div></div>
        <div class="mon-summary"><div class="mon-ring">${planRing(done/PLAN_TOTAL)}</div>
          <div class="mon-stats"><div class="mon-stat"><b>${done}</b><span>/${PLAN_TOTAL} 天已打卡</span></div>
          <div class="mon-stat"><b>${Math.round(done/PLAN_TOTAL*100)}%</b><span>計畫完成度</span></div></div></div>
      </section>`;
    }
    const idx=PLAN_FLAT.findIndex(x=>x.date.getTime()===today.getTime());
    const todayDay=idx>=0?PLAN_FLAT[idx]:null;
    const missed=PLAN_FLAT.filter(x=>x.date<today && !doneId(x.id));
    const lag=missed.length;
    const baseH=todayDay?estHours(todayDay):0;
    const catchH=missed.reduce((s,x)=>s+estHours(x),0);
    const totalH=baseH+catchH;
    let stCls,stTxt;
    if(lag===0){stCls='st-ok';stTxt='🟢 進度正常';}
    else if(lag<=2){stCls='st-mid';stTxt='🟡 輕微落後 '+lag+' 天';}
    else{stCls='st-bad';stTxt='🔴 嚴重落後 '+lag+' 天';}
    const posTxt=todayDay?`第 ${idx+1}/${PLAN_TOTAL} 天 · W${todayDay.wi+1}D${todayDay.di+1} · ${esc(todayDay.ch)}`:'—';
    let lagHtml;
    if(lag===0){lagHtml=`<div class="mon-ok">🟢 進度順利跟進，保持節奏！</div>`;}
    else{
      lagHtml='<div class="mon-laglist">';
      missed.forEach(x=>{const behind=Math.round((today-x.date)/864e5);
        lagHtml+=`<div class="mon-lagitem"><span class="mon-lagch">${esc(x.ch)}</span>
          <span class="mon-lagdate">${x.date.getMonth()+1}/${x.date.getDate()}</span>
          <span class="mon-lagbehind">落後 ${behind} 天</span>
          <span class="mon-lagbtn" data-act="plan">去補完 ›</span></div>`;});
      lagHtml+='</div>';
    }
    let listHtml='';
    if(todayDay){
      const chNum=(todayDay.ch.match(/第\s*(\d+)\s*章/)||[])[1];
      const goAct=chNum?`data-act="start-chapter" data-ch="${chNum}"`:`data-act="plan"`;
      listHtml+=`<div class="mon-titem today"><div class="mon-tmain">
        <div class="mon-tch">${esc(todayDay.ch)} <span class="mon-tag">今日原定</span></div>
        <div class="mon-tt">${esc(todayDay.t)}</div></div>
        <div class="mon-th">${baseH} h</div>
        <button class="mon-tgo" ${goAct}>▶ 練習</button></div>`;
    }
    if(lag>0){
      missed.forEach(x=>{const behind=Math.round((today-x.date)/864e5);
        listHtml+=`<div class="mon-titem catch"><div class="mon-tmain">
          <div class="mon-tch">${esc(x.ch)} <span class="mon-tag catch">追趕 · 落後${behind}天</span></div>
          <div class="mon-tt">${esc(x.t)}</div></div>
          <div class="mon-th">${estHours(x)} h</div>
          <span class="mon-tgo ghost" data-act="plan">去補完 ›</span></div>`;});
    }
    const doneAll=PLAN_FLAT.filter(x=>doneId(x.id)).length;
    const summary=`<div class="mon-summary">
      <div class="mon-ring">${planRing(doneAll/PLAN_TOTAL)}</div>
      <div class="mon-stats">
        <div class="mon-stat"><b>${doneAll}</b><span>/${PLAN_TOTAL} 天已打卡</span></div>
        <div class="mon-stat ${lag>0?'bad':''}"><b>${lag}</b><span>落後天數</span></div>
      </div>
    </div>`;
    return `<section class="monitor">
      <div class="mon-head"><span class="mon-title">📊 複習進度即時監控</span>${badge(stCls,stTxt)}
        <a class="mon-link" data-act="plan">查看完整計畫 ›</a></div>
      <div class="mon-row"><div class="mon-label">應複習進度</div><div class="mon-val">${posTxt}</div></div>
      <div class="mon-row"><div class="mon-label">進度落差</div><div class="mon-val">${lag===0?'無延誤':'落後 '+lag+' 天'}</div>${lagHtml}</div>
      <div class="mon-today">
        <div class="mon-label">今日複習清單 <span class="mon-sub">${today.getMonth()+1}/${today.getDate()}</span></div>
        <div class="mon-tlist">${listHtml}</div>
        <div class="mon-hours">預計今日總複習時數：<b>${totalH} 小時</b> <span class="mon-sub">（原定 ${baseH} ＋ 追趕 ${catchH}）</span></div>
      </div>
      ${summary}
    </section>`;
  }

  function goPlan(){
    curView='plan';
    setActive('home');
    let total=0,done=0,html='';
    PLAN.forEach((w,wi)=>{
      let rows='';let wdone=0;
      w.days.forEach((d,di)=>{
        total++;const id='w'+wi+'d'+di;const ok=!!state.planDone[id];
        if(ok){done++;wdone++;}
        const pc=d.p==='hi'?'php':d.p==='mid'?'ppm':'ppl';
        const pt=d.p==='hi'?'高':d.p==='mid'?'中':'低';
        rows+=`<div class="prow ${ok?'pdone':''}" data-act="plan-day" data-pid="${id}">
          <div class="pck">${ok?'✓':''}</div>
          <div class="pbody"><div class="pmeta"><b>${d.d}</b> 週${d.wd} <span class="pch">${esc(d.ch)}</span> <span class="pp ${pc}">${pt}</span></div>
          <div class="pt">${esc(d.t)}</div></div></div>`;
      });
      html+=`<div class="pweek"><div class="pwh"><span>${esc(w.phase)}</span><span class="pwr">${esc(w.range)}</span><span class="pwc">${wdone}/${w.days.length}</span></div>${rows}</div>`;
    });
    const pct=total?Math.round(done/total*100):0;
    setScreen(`
      <div class="phead"><a data-act="tab" data-tab="home" class="pback">‹ 返回</a> 7 週打卡計劃表</div>
      <div class="pprog"><div class="pprog-l">總進度 ${done}/${total}（${pct}%）</div>
        <div class="pbar"><span style="width:${pct}%"></span></div></div>
      ${html}
      <div class="pnote">目標考試日 2026-09-15 · 點任務行即可打卡（自動儲存）</div>`);
  }

  // ---------- chapter notes (講義) ----------
  function goNotes(){
    curView='notes';
    setActive('home');
    const N=window.NOTES||[];
    if(!N.length){setScreen('<div class="phead"><a data-act="tab" data-tab="home" class="pback">‹ 返回</a> 章節講義</div><div class="empty">講義資源未載入</div>');return;}
    let rows='';
    N.forEach(n=>{
      const hi=[3,4,5,9].indexOf(n.id)>=0;
      rows+=`<div class="chrow" data-act="note" data-ch="${n.id}">
        <div class="chn">第${n.id}章</div>
        <div class="cht">${esc(n.title)}${hi?' <span class="pp php">高</span>':''}</div>
        <div class="chev">›</div></div>`;
    });
    setScreen(`<div class="phead"><a data-act="tab" data-tab="home" class="pback">‹ 返回</a> 章節講義（9 章）</div>
      <div class="chlist">${rows}</div>
      <div class="pnote">建議流程：先讀講義 → 再刷本章練習題</div>`);
  }
  function goNote(ch){
    curView='note';
    setActive('home');
    const N=window.NOTES||[];const n=N.find(x=>x.id===ch);
    if(!n){goNotes();return;}
    setScreen(`<div class="phead"><a data-act="notes" class="pback">‹ 講義</a> 第${ch}章講義</div>
      <div class="notewrap"><h1>第${ch}章 ${esc(n.title)}</h1>${n.html}</div>
      <button class="primary wide" data-act="start-chapter" data-ch="${ch}" style="margin-top:14px">📝 本章題目列表（全 ${(QBANK.chapters.find(x=>x.id===ch)||{questions:[]}).questions.length} 題）</button>
      <button class="ghost wide" data-act="notes" style="margin-bottom:16px">返回講義目錄</button>`);
  }

  // ---------- chapter question list (題目列表 + 作答進度) ----------
  function isAnswered(q){return !!state.answered[sessionKey(q)];}
  function goChapterList(ch, presetFilter){
    curView='chlist';
    setActive('practice');
    curChId=ch; qlExpanded=false;
    const c=QBANK.chapters.find(x=>x.id===ch);
    if(!c){goPractice();return;}
    const all=c.questions, total=all.length;
    let answered=0;all.forEach(q=>{if(isAnswered(q))answered++;});
    const unanswered=total-answered;
    if(presetFilter)curChFilter=presetFilter;
    else curChFilter = unanswered>0?'unanswered':'all';
    let list = curChFilter==='all'?all.slice()
             : curChFilter==='answered'?all.filter(q=>isAnswered(q))
             : all.filter(q=>!isAnswered(q));
    lastChList=list;
    const fCount={all:total,answered:answered,unanswered:unanswered};
    const cfg=[['unanswered','未作答'],['answered','已作答'],['all','全部']];
    let tabs='';
    cfg.forEach(([f,label])=>{tabs+=`<div class="qftab ${f===curChFilter?'on':''}" data-act="chapter-filter" data-f="${f}" data-ch="${ch}">${label} <b>${fCount[f]}</b></div>`;});
    const pct=total?Math.round(answered/total*100):0;
    let items='';
    if(!list.length){items=`<div class="empty">此篩選下沒有題目 🎉</div>`;}
    else{
      list.forEach((q,i)=>{
        const done=isAnswered(q);
        const tag=q.source==='notes'&&q.category?(' · '+q.category):'';
        items+=`<div class="qlitem" data-act="ql-item" data-ch="${ch}" data-idx="${i}">
          <div class="qlidx">${i+1}</div>
          <div class="qlbody"><div class="qlstem">${esc(q.stem.slice(0,42))}${q.stem.length>42?'…':''}${tag?`<span class="qlcat">${esc(tag)}</span>`:''}</div></div>
          <div class="qlbadge ${done?'done':''}">${done?'✓':'○'}</div>
        </div>`;
      });
    }
    const btnLabel = curChFilter==='all'?('▶ 開始練習（全部 ' + total + ' 題）')
                  : curChFilter==='answered'?('▶ 重練已作答（' + answered + ' 題）')
                  : ('▶ 繼續練習（未作答 ' + unanswered + ' 題）');
    setScreen(`
      <div class="phead"><button class="back" data-act="tab" data-tab="practice">←</button>第${ch}章 題目列表
        <span class="qlcount">共 ${total} 題</span></div>
      <div class="qlinfo">已作答 <b>${answered}</b> / ${total}　·　進度 ${pct}%</div>
      <div class="qfilter">${tabs}</div>
      <!-- 行動按鈕置頂，無需滾動即可點擊 -->
      <button class="primary wide" data-act="start-filtered" data-ch="${ch}" ${list.length?'':'disabled'} style="margin-top:4px">${btnLabel}</button>
      <button class="ghost wide" data-act="start-random20" data-ch="${ch}" style="margin-bottom:10px">🎲 隨機抽 20 題練習</button>
      <!-- 折疊式題目清單 -->
      <div class="qltoggle" data-act="ql-toggle">
        <span class="qlt-icon">▸</span><span class="qlt-text">展開題目列表（${list.length} 題）</span>
      </div>
      <div class="qlist ql-collapsed">${items}</div>
      <div class="pnote">點題目可直接從該題開始；作答狀態自動儲存，重整不流失。</div>`);
  }

  // ---------- 每日名人名言（熱血/行動導向，按日期輪換，每日不重複） ----------
  // 風格篩選：只收熱血、燃起鬥志、激發行動力的真實名人語錄，排除沉思/哲理型人生感悟。
  const QUOTES = [
    {zh:"我討厭訓練的每一分鐘，但我告訴自己：別放棄。現在吃苦，往後餘生你就能以冠軍之姿活著。", en:"I hated every minute of training, but I said, 'Don't quit. Suffer now and live the rest of your life as a champion.'", author:"穆罕默德·阿里 (Muhammad Ali)"},
    {zh:"我職業生涯投失了超過 9,000 球，輸了近 300 場比賽，有 26 次被託付致勝一擊卻失手。我這一生失敗了一次又一次——而這正是我成功的原因。", en:"I've missed more than 9,000 shots in my career. I've lost almost 300 games. 26 times, I've been trusted to take the game-winning shot and missed. I've failed over and over and over again in my life. And that is why I succeed.", author:"麥可·喬丹 (Michael Jordan)"},
    {zh:"成功者與他人的差別，不在於力量不足，也不在於知識缺乏，而在於意志的欠缺。", en:"The difference between a successful person and others is not a lack of strength, not a lack of knowledge, but rather a lack of will.", author:"文斯·隆巴迪 (Vince Lombardi)"},
    {zh:"成功不是終點，失敗也非末日：真正重要的是繼續前進的勇氣。", en:"Success is not final; failure is not fatal: It is the courage to continue that counts.", author:"溫斯頓·邱吉爾 (Winston Churchill)"},
    {zh:"所有負面的事物——壓力、挑戰——對我而言都是崛起的機會。", en:"Everything negative – pressure, challenges – is all an opportunity for me to rise.", author:"柯比·布萊恩 (Kobe Bryant)"},
    {zh:"我沒有失敗。我只是找到了一萬種行不通的方法。", en:"I have not failed. I've just found 10,000 ways that won't work.", author:"湯瑪斯·愛迪生 (Thomas Edison)"},
    {zh:"成功絕非偶然。它是苦幹、堅持、學習、鑽研、犧牲，以及——最重要的是——對你所做之事的熱愛。", en:"Success is no accident. It is hard work, perseverance, learning, studying, sacrifice and most of all, love of what you are doing or learning to do.", author:"比利 (Pelé)"},
    {zh:"懂得不夠，還必須去實踐；心願不夠，還必須去行動。", en:"Knowing is not enough; we must apply. Willing is not enough; we must do.", author:"李小龍 (Bruce Lee)"},
    {zh:"相信自己能做到，你就已經成功了一半。", en:"Believe you can and you're halfway there.", author:"西奧多·羅斯福 (Theodore Roosevelt)"},
    {zh:"『不可能』只是小人物用來掩飾懶惰的大字眼——他們寧願活在被給予的世界裡，也不願去發掘改變它的力量。", en:"Impossible is just a big word thrown around by small men who find it easier to live in the world they've been given than to explore the power they have to change it.", author:"穆罕默德·阿里 (Muhammad Ali)"},
    {zh:"有些人盼望它發生，有些人但願它發生，其他人則讓它發生。", en:"Some people want it to happen, some wish it would happen, others make it happen.", author:"麥可·喬丹 (Michael Jordan)"},
    {zh:"你的身體幾乎能承受任何折磨。你真正要說服的，是你自己的心智。", en:"Your body can stand almost anything. It's your mind that you have to convince.", author:"大衛·戈金斯 (David Goggins)"},
    {zh:"吾志所向，一往無前，愈挫愈奮，再接再厲。", en:"Where my will is set, I press forward without turning back; the more I am thwarted, the more fervent I grow.", author:"孫中山 (Sun Yat-sen)"},
    {zh:"成就偉大工作的唯一方法，就是熱愛你所做的事。", en:"The only way to do great work is to love what you do.", author:"史提夫·賈伯斯 (Steve Jobs)"},
    {zh:"你越努力，就越難投降。", en:"The harder you work, the harder it is to surrender.", author:"文斯·隆巴迪 (Vince Lombardi)"},
    {zh:"拖垮你的不是前方待攀的高山，而是鞋裡那顆小石子。", en:"It isn't the mountains ahead to climb that wear you out; it's the pebble in your shoe.", author:"穆罕默德·阿里 (Muhammad Ali)"},
    {zh:"要成為最強，就必須最努力。你必須一遍又一遍地去追逐一個看似不可能的目標。", en:"To be the best, you have to work the hardest. You have to chase what seems impossible over and over and over again.", author:"勒布朗·詹姆斯 (LeBron James)"},
    {zh:"無論你認為自己行，還是認為自己不行，你都是對的。", en:"Whether you think you can or think you can't, you're right.", author:"亨利·福特 (Henry Ford)"},
    {zh:"生命最大的光榮，不在於從不跌倒，而在於每次跌倒都能重新站起。", en:"The greatest glory in living lies not in never falling, but in rising every time we fall.", author:"納爾遜·曼德拉 (Nelson Mandela)"},
    {zh:"你放棄的那一刻，就是把勝利讓給別人的那一刻。", en:"The moment you give up is the moment you let someone else win.", author:"柯比·布萊恩 (Kobe Bryant)"},
    {zh:"今天我要做別人不願做的事，明天我才能成就別人做不到的事。", en:"Today I will do what others won't, so tomorrow I can accomplish what others can't.", author:"傑瑞·賴斯 (Jerry Rice)"},
    {zh:"勝利屬於最能堅持的人。", en:"Victory belongs to the most persevering.", author:"拿破崙·波拿巴 (Napoleon Bonaparte)"},
    {zh:"你連出手都沒出手，就 100% 錯失了所有機會。", en:"You miss 100% of the shots you don't take.", author:"韋恩·格雷茨基 (Wayne Gretzky)"},
    {zh:"如果你正穿越地獄，那就繼續走下去。", en:"If you're going through hell, keep going.", author:"溫斯頓·邱吉爾 (Winston Churchill)"},
    {zh:"我不懼怕練過一萬種踢法一次的人，我只懼怕把一種踢法練過一萬次的人。", en:"I fear not the man who has practiced 10,000 kicks once, but I fear the man who has practiced one kick 10,000 times.", author:"李小龍 (Bruce Lee)"},
    {zh:"沒有什麼能取代努力工作。", en:"There is no substitute for hard work.", author:"湯瑪斯·愛迪生 (Thomas Edison)"},
    {zh:"勝利越是艱難，贏得時的喜悅就越巨大。", en:"The more difficult the victory, the greater the happiness in winning.", author:"比利 (Pelé)"},
    {zh:"永遠別讓怕三振的恐懼，阻止你上場揮棒。", en:"Never let the fear of striking out keep you from playing the game.", author:"貝比·魯斯 (Babe Ruth)"},
    {zh:"贏家永不退縮，退縮者永不獲勝。", en:"Winners never quit and quitters never win.", author:"文斯·隆巴迪 (Vince Lombardi)"},
    {zh:"你必須先對自己有所期待，才能去做得到。", en:"You have to expect things of yourself before you can do them.", author:"麥可·喬丹 (Michael Jordan)"},
    {zh:"樂觀是引領成就的信念。沒有希望與信心，將一事無成。", en:"Optimism is the faith that leads to achievement. Nothing can be done without hope and confidence.", author:"海倫·凱勒 (Helen Keller)"},
    {zh:"如果你連夢想打敗我都不敢，最好趁早醒來跟我道歉。", en:"If you even dream of beating me you'd better wake up and apologize.", author:"穆罕默德·阿里 (Muhammad Ali)"},
    {zh:"如果你害怕失敗，那你大概就會失敗。", en:"If you're afraid to fail, then you're probably going to fail.", author:"柯比·布萊恩 (Kobe Bryant)"},
    {zh:"當一切都看似與你作對時，請記住：飛機是逆風起飛的，而非順風。", en:"When everything seems to be going against you, remember that the airplane takes off against the wind, not with it.", author:"亨利·福特 (Henry Ford)"},
    {zh:"革命尚未成功，同志仍須努力。", en:"The revolution is not yet accomplished; comrades must still strive.", author:"孫中山 (Sun Yat-sen)"},
    {zh:"預測未來最好的方法，就是去創造它。", en:"The best way to predict the future is to create it.", author:"彼得·杜拉克 (Peter Drucker)"},
    {zh:"最大的成就不在於從不跌倒，而在於每次跌倒後都能重新站起。", en:"The greatest accomplishment is not in never falling, but in rising again after you fall.", author:"文斯·隆巴迪 (Vince Lombardi)"},
    {zh:"人之所以成功，是因為努力不懈。運氣與成功毫不相干。", en:"When people succeed, it is because of hard work. Luck has nothing to do with success.", author:"迪亞哥·馬拉度納 (Diego Maradona)"},
    {zh:"你的時間有限，所以別浪費時間去活別人的人生。", en:"Your time is limited, so don't waste it living someone else's life.", author:"史提夫·賈伯斯 (Steve Jobs)"},
    {zh:"從你所在之處開始，用你擁有的一切，做你力所能及的事。", en:"Start where you are. Use what you have. Do what you can.", author:"亞瑟·艾許 (Arthur Ashe)"},
    {zh:"如果我們不把事情視為不可能，就能成就更多。", en:"We would accomplish many more things if we did not think of them as impossible.", author:"文斯·隆巴迪 (Vince Lombardi)"},
    {zh:"如果你看到我和一頭熊打架，替那頭熊祈禱吧。", en:"If you see me in a fight with a bear, pray for the bear.", author:"柯比·布萊恩 (Kobe Bryant)"},
    {zh:"別盯著時鐘看；學它一樣，繼續前進。", en:"Don't watch the clock; do what it does. Keep going.", author:"山姆·雷文森 (Sam Levenson)"},
    {zh:"不惜一切代價奪取勝利——不懼任何恐怖奪取勝利——不論前路多麼漫長艱險，都要奪取勝利，因為沒有勝利就無以生存。", en:"Victory at all costs—victory in spite of all terrors—victory, however long and hard the road may be, for without victory there is no survival.", author:"溫斯頓·邱吉爾 (Winston Churchill)"},
    {zh:"別害怕放下『好』，去追求『卓越』。", en:"Don't be afraid to give up the good to go for the great.", author:"約翰·洛克菲勒 (John D. Rockefeller)"},
    {zh:"我所知道的只有一件事：我絕不甘於平庸。", en:"All I knew was that I NEVER wanted to be AVERAGE.", author:"麥可·喬丹 (Michael Jordan)"},
    {zh:"成功，是帶著同樣的熱情，從一次失敗走向另一次失敗。", en:"Success is walking from failure to failure with no loss of enthusiasm.", author:"溫斯頓·邱吉爾 (Winston Churchill)"},
    {zh:"勝利不是偶一為之的事，而是無時無刻的事。你不該偶爾把事情做對，而要永遠把事情做對。勝利是一種習慣。", en:"Winning is not a sometime thing; it's an all the time thing. You don't win once in a while... you do them right all the time. Winning is habit.", author:"文斯·隆巴迪 (Vince Lombardi)"},
    {zh:"實現明天的唯一限制，是我們今天的疑慮。", en:"The only limit to our realization of tomorrow is our doubts of today.", author:"富蘭克林·羅斯福 (Franklin D. Roosevelt)"},
    {zh:"你唯一的極限，是你自己相信的那個極限。", en:"The only limits you have are the limits you believe.", author:"韋恩·格雷茨基 (Wayne Gretzky)"},
    {zh:"重點不在於你是否被擊倒，而在於你是否重新站起。", en:"It's not whether you get knocked down; it's whether you get up.", author:"文斯·隆巴迪 (Vince Lombardi)"},
    {zh:"冠軍不是在健身房裡練成的。冠軍源於內心深處的一股渴望、一個夢想、一種願景。", en:"Champions aren't made in the gyms. Champions are made from something they have deep inside them – a desire, a dream, a vision.", author:"穆罕默德·阿里 (Muhammad Ali)"},
    {zh:"當天賦不願努力，勤奮終將擊敗天賦。", en:"Hard work beats talent when talent fails to work hard.", author:"提姆·諾特克 (Tim Notke)"},
    {zh:"重要的不是求勝的意志——每個人都有。重要的是備戰求勝的意志。", en:"It's not the will to win that matters – everyone has that. It's the will to prepare to win that matters.", author:"保羅·「熊」·布萊恩特 (Paul 'Bear' Bryant)"},
    {zh:"別讓你做不到的事，妨礙了你做得到的事。", en:"Don't let what you cannot do interfere with what you can do.", author:"約翰·伍登 (John Wooden)"}
  ];
  function renderDailyQuote(){
    const EPOCH=new Date(2026,0,1).getTime();
    const dayIdx=Math.floor((Date.now()-EPOCH)/86400000);
    const q=QUOTES[((dayIdx%QUOTES.length)+QUOTES.length)%QUOTES.length];
    return `<div class="qcard-quote">
      <div class="qq-head"><span class="qq-badge">🔥 每日金句</span><span class="qq-date">${todayStr()}</span></div>
      <div class="qq-mark">“</div>
      <div class="qq-text">${esc(q.zh)}</div>
      <div class="qq-en">${esc(q.en)}</div>
      <div class="qq-author">— ${esc(q.author)}</div>
    </div>`;
  }
  // ---------- screens ----------
  function goHome(){
    curView='home';
    setActive('home');
    const st=computeStats();const streak=longestStreak(state.checkins);const today=todayStr();
    const checked=state.checkins.includes(today);
    setScreen(`
     <div class="hero">
       <div class="hero-h">HKSI 卷一 · 學習打卡</div>
       <div class="hero-s">距離 2026-09-15 考試倒數 ${daysLeft()} 天</div>
       <button class="checkin ${checked?'done':''}" data-act="checkin">${checked?'✓ 今日已打卡':'今日打卡'}</button>
     </div>
     ${renderDailyQuote()}
     ${renderMonitor()}
     <div class="ov">
       <div class="ovc"><div class="ovn">${st.total}</div><div class="ovl">總答題</div></div>
       <div class="ovc"><div class="ovn">${Math.round(st.acc*100)}%</div><div class="ovl">正確率</div></div>
       <div class="ovc"><div class="ovn">${streak}</div><div class="ovl">連續打卡</div></div>
     </div>
     <div class="quick">
       <div class="qcard" data-act="start-random"><div class="qi">🎲</div><div>隨機練習</div><div class="qs">15 題</div></div>
       <div class="qcard" data-act="tab" data-tab="practice"><div class="qi">📚</div><div>章節練習</div><div class="qs">9 章</div></div>
       <div class="qcard" data-act="start-mock"><div class="qi">⏱️</div><div>模考模式</div><div class="qs">60題/90min</div></div>
     </div>
     ${USING_SAMPLE?'<div class="note">⚠️ 目前為示範題庫（每章 2 題＋完整模考）。完整 1595 題請透過本地伺服器開啟本頁。</div>':''}
     <div class="notesentry" data-act="notes"><span class="qi">📖</span><div><b>章節講義</b><div class="qs">9 章知識點 · 重點難點 · 考點速記</div></div><span class="chev">›</span></div>
     <div class="planlink"><a data-act="plan">📋 查看 7 週打卡計劃表</a></div>`);
  }
  function goPractice(){
    curView='practice';
    setActive('practice');
    const st=computeStats();let rows='';
    QBANK.chapters.forEach(c=>{
      const s=st.byCh[c.id];const m=s.answered?(s.correct/s.answered):0;
      rows+=`<div class="chrow" data-act="start-chapter" data-ch="${c.id}">
        <div class="chn">第${c.id}章</div>
        <div class="cht">${esc(c.title)}</div>
        <div class="chm">掌握 ${s.answered?Math.round(m*100):0}%<span class="chc">${s.answered||0}/${c.questions.length}</span></div>
        <div class="chnote" data-act="note" data-ch="${c.id}" title="看講義">📖</div>
        <div class="chev">›</div></div>`;
    });
    setScreen(`<div class="phead">章節練習</div><div class="chlist">${rows}</div>`);
  }
  function goStats(){
    curView='stats';
    setActive('stats');
    const st=computeStats();
    const total=st.total, correct=st.correct, wrong=total-correct;
    const mb=state.mockBest?state.mockBest.score+'/60':'—';
    const streak=longestStreak(state.checkins);
    // 頂部：環形圖 + 指標網格
    let kgrid='';
    const si=(label,val)=>`<div class="stats-si"><b>${val}</b><span>${label}</span></div>`;
    kgrid+=si('總答題',total+' 題');
    kgrid+=si('正確',correct+' 題');
    kgrid+=si('錯誤',wrong+' 題');
    kgrid+=si('連續打卡',streak+' 天');
    if(state.mockBest)kgrid+=si('模考最佳',mb);  // 奇數項時多一行
    // 分章掌握度 – 兩行卡片佈局（標題行 + 進度條）
    let chrows='';
    for(let i=1;i<=9;i++){
      const s=st.byCh[i];
      const m=s.answered?(s.correct/s.answered):0;
      const pct=Math.round(m*100);
      const fillPct=Math.max(0,Math.min(100,pct));
      chrows+=`<div class="chrow">
        <div class="chrow-head">
          <span class="chrow-num">第 ${i} 章</span>
          <span class="chrow-pct">${pct}%</span>
        </div>
        <div class="chrow-track">
          <div class="chrow-fill" style="width:${fillPct}%"></div>
        </div>
      </div>`;
    }
    // 趨勢圖（含今日/最高摘要）
    const daysArr=[];const today=new Date();
    for(let i=13;i>=0;i--){const d=new Date(today);d.setDate(today.getDate()-i);
      const ds=d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());daysArr.push(st.daily[ds]||0);}
    const todayV=daysArr[daysArr.length-1], maxV=Math.max(1,...daysArr);
    setScreen(`<div class="phead">學習統計</div>
      <div class="card stats-hero">
        <div class="stats-ring">${ring(st.acc)}</div>
        <div class="stats-kgrid">${kgrid}</div>
      </div>
      <div class="card"><div class="ct">📊 分章掌握度</div>${chrows}</div>
      <div class="card trend-card"><div class="ct">📈 近 14 日趨勢</div>
        ${trend(st.daily)}
        <div class="trend-summary"><span>今日 ${todayV} 題</span><span>最高 ${maxV>0?maxV:'—'} 題</span></div>
      </div>
      ${state.mockBest?'':'<div class="card" style="text-align:center;padding:16px;color:var(--mut);font-size:13px">完成一次模考後，這裡會顯示你的最佳成績 🎯</div>'}`);
  }
  function goMe(){
    curView='me';
    setActive('me');
    setScreen(`<div class="phead">我的</div>
      <div class="card">
        <div class="mlink" data-act="tab" data-tab="wrong"><span>📕 錯題本</span><b>${state.wrong.length} 題 ›</b></div>
        <div class="mlink" data-act="tab" data-tab="fav"><span>⭐ 收藏夾</span><b>${state.fav.length} 題 ›</b></div>
      </div>
      <div class="card">
        <div class="mlink" data-act="sync-settings"><span>☁️ 雲端同步</span><b>${syncUid?('已連線 · '+esc(syncUid)):'點此設定 ›'}</b></div>
        ${syncOn&&syncUid?'<div class="mlink" data-act="sync-now"><span>🔄 立即雙向同步</span><b>›</b></div>':''}
        ${syncOn&&syncUid?'<div class="mlink" data-act="sync-diag"><span>🔍 同步診斷</span><b>›</b></div>':''}
        ${syncOn&&syncUid?'<div class="sync-stat">'+syncStatus()+'</div>':''}
        ${syncUid?'<div class="sync-code">同步碼：<code>'+esc(syncUid)+'</code> <span class="sync-copy" data-act="sync-copy">複製</span></div>':''}
        ${!syncUid?'<div class="sync-note">首次請點上方「雲端同步」設定：選 Supabase（零自託管，推薦）或自架伺服器。</div>':''}
      </div>
      <div class="card"><div class="mlink" data-act="reset"><span>🗑️ 重置進度</span><b>›</b></div></div>
      <div class="about">
        <div>HKSI 卷一 學習打卡 · H5 原型</div>
        <div>題庫來源：證券考試內容 IMA 知識庫（1595 題）</div>
        <div>${syncOn&&syncUid?('進度已統一儲存於'+(syncMode==='supabase'?'Supabase 雲端':'同步伺服器')+'，跨裝置不流失。'):(syncUid?'已設定同步碼，下次進入將自動同步。':'未連接雲端同步，進度僅存本機，清除快取會遺失。')}</div>
      </div>`);
  }
  function goWrong(){
    curView='wrong';
    setActive('me');
    if(!state.wrong.length){setScreen(`<div class="phead"><button class="back" data-act="tab" data-tab="me">←</button>錯題本</div><div class="empty">暫無錯題，繼續練習吧！</div>`);return;}
    let items='';state.wrong.forEach(k=>{const q=getQ(k);if(!q)return;items+=`<div class="witem">${esc(q.stem.slice(0,64))}${q.stem.length>64?'…':''}</div>`;});
    setScreen(`<div class="phead"><button class="back" data-act="tab" data-tab="me">←</button>錯題本（${state.wrong.length}）</div>
      <button class="primary wide" data-act="start-wrong">重練錯題</button>
      <div class="wlist">${items}</div>`);
  }
  function goFav(){
    curView='fav';
    setActive('me');
    if(!state.fav.length){setScreen(`<div class="phead"><button class="back" data-act="tab" data-tab="me">←</button>收藏夾</div><div class="empty">暫無收藏。</div>`);return;}
    let items='';state.fav.forEach(k=>{const q=getQ(k);if(!q)return;items+=`<div class="witem">${esc(q.stem.slice(0,64))}${q.stem.length>64?'…':''}</div>`;});
    setScreen(`<div class="phead"><button class="back" data-act="tab" data-tab="me">←</button>收藏夾（${state.fav.length}）</div>
      <button class="primary wide" data-act="start-fav">重練收藏</button>
      <div class="wlist">${items}</div>`);
  }

  // ---------- quiz ----------
  function startQuiz(list,mode,title,startIdx){
    startIdx=startIdx||0;
    curView='quiz';
    quiz={mode,title,questions:list,idx:startIdx,selections:[],answeredFlags:list.map(()=>false),results:list.map(()=>null),startTs:Date.now(),remain:5400,timer:null};
    if(mode==='mock'){
      quiz.timer=setInterval(()=>{
        quiz.remain--;const t=el('qtimer');if(t)t.textContent=fmtTime(quiz.remain);
        if(quiz.remain<=0){clearInterval(quiz.timer);renderSummary();}
      },1000);
    }
    renderQuiz(false);
  }
  function renderQuiz(){
    curView='quiz';
    const q=quiz.questions[quiz.idx];const isMulti=q.type==='multiple';const answered=quiz.answeredFlags[quiz.idx];
    let opts='';
    q.options.forEach(o=>{
      let cls='opt';const sel=quiz.selections.includes(o.key);
      if(sel)cls+=' sel';
      if(answered){if(q.answer.includes(o.key))cls+=' correct';else if(sel)cls+=' wrong';cls+=' locked';}
      opts+=`<div class="${cls}" data-act="option" data-key="${o.key}"><span class="ok">${o.key}</span><span class="ot">${esc(o.text)}</span></div>`;
    });
    const key=sessionKey(q);const favOn=state.fav.includes(key);const total=quiz.questions.length;const idx=quiz.idx+1;
    const timerHtml=quiz.mode==='mock'?`<span class="qtimer" id="qtimer">${fmtTime(quiz.remain)}</span>`:'';
    let fbHtml='';
    if(answered){
      const ok=quiz.results[quiz.idx];
      const topicHtml=q.topic?`<div class="qtopic">🏷 知識點：${esc(q.topic)}</div>`:'';
      const oralHtml=q.oral?`<div class="oral"><b>💬 大白話解析：</b><p>${esc(q.oral)}</p></div>`:'';
      const trapHtml=(!ok&&q.trap)?`<div class="trapbox">🔍 <b>這題的陷阱：</b>${esc(q.trap)}</div>`:'';
      fbHtml=`<div class="feedback ${ok?'ok':'no'}">${ok?'✓ 答對了':'✗ 答錯了'}　正確答案：${q.answer.join('、')}</div>
        ${topicHtml}
        ${oralHtml}
        ${q.explanation?`<details class="exp"><summary>📖 原版解析（條文／課本說法）</summary>${esc(q.explanation)}</details>`:''}
        ${trapHtml}
        <button class="favbtn ${favOn?'on':''}" data-act="fav-toggle" data-key="${key}">${favOn?'★ 已收藏':'☆ 收藏'}</button>`;
    }
    const actionBtn=answered
      ? (idx<total?`<button class="primary" data-act="next">下一題 (${idx}/${total})</button>`:`<button class="primary" data-act="finish">查看結果</button>`)
      : `<button class="primary" data-act="submit" ${quiz.selections.length?'':'disabled'}>提交答案</button>`;
    setScreen(`
      <div class="qhead">
        <button class="back" data-act="quiz-exit">←</button>
        <span class="qtitle">${esc(quiz.title)}</span>
        ${timerHtml}
        <span class="qprog">${idx}/${total}</span>
      </div>
      ${q.source==='notes'?`<div class="qtags"><span class="qcat qcat-${({'考點':'exam','易錯點':'trap','難點':'hard','純記憶':'mem'})[q.category]||'exam'}">${esc(q.category||'講義題')}</span><span class="qref">📖 ${esc(q.noteRef||'')}</span></div>`:''}
      <div class="qstem">${esc(q.stem)}</div>
      <div class="opts">${opts}</div>
      ${fbHtml}
      <div class="qaction">${actionBtn}</div>`);
  }
  function submitAnswer(){
    const q=quiz.questions[quiz.idx];if(!quiz.selections.length)return;
    const key=sessionKey(q);const correct=arraysEqual(q.answer,quiz.selections);
    quiz.answeredFlags[quiz.idx]=true;quiz.results[quiz.idx]=correct;
    state.answered[key]={correct,ts:Date.now()};
    if(!correct){if(!state.wrong.includes(key))state.wrong.push(key);}else{state.wrong=state.wrong.filter(k=>k!==key);}
    save();renderQuiz();
  }
  function nextQ(){quiz.idx++;quiz.selections=[];if(quiz.idx>=quiz.questions.length)renderSummary();else renderQuiz();}
  function renderSummary(){
    curView='summary';
    if(quiz.timer)clearInterval(quiz.timer);
    let c=0;quiz.results.forEach(r=>{if(r)c++;});
    const n=quiz.questions.length;const acc=n?c/n:0;const sec=Math.round((Date.now()-quiz.startTs)/1000);
    let extra='';
    if(quiz.mode==='mock'){
      if(!state.mockBest||c>state.mockBest.score)state.mockBest={score:c,ts:Date.now()};
      save();const pass=c>=42;extra=`<div class="sum-pass ${pass?'p':'f'}">${pass?'🎉 合格（≥42/60）':'未達 70%，繼續加油'}</div>`;
    }
    setScreen(`<div class="phead">練習結果</div>
      <div class="card center">
        ${ring(acc)}
        <div class="sum-meta">答對 <b>${c}</b> / ${n} 題　用時 ${fmtTime(sec).replace(/^00:/,'')}</div>
        ${extra}
      </div>
      <button class="primary wide" data-act="restart">再練一次</button>
      ${quiz.mode==='chapter'&&curChId?`<button class="ghost wide" data-act="back-list">返回題目列表</button>`:''}
      <button class="ghost wide" data-act="tab" data-tab="home">返回首頁</button>`);
  }

  // ---------- events ----------
  function toast(m){let t=el('toast');if(!t){t=document.createElement('div');t.id='toast';t.className='toast';el('phone').appendChild(t);}t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),1600);}

  document.addEventListener('click',e=>{
    const a=e.target.closest('[data-act]');if(!a)return;
    const act=a.dataset.act;
    if(act==='notes'){goNotes();return;}
    if(act==='note'){goNote(+a.dataset.ch);return;}
    if(act==='plan'){goPlan();return;}
    if(act==='plan-day'){const id=a.dataset.pid;if(state.planDone[id])delete state.planDone[id];else state.planDone[id]=true;save();goPlan();return;}
    if(act==='checkin'){const t=todayStr();if(!state.checkins.includes(t)){state.checkins.push(t);save();}goHome();toast('打卡成功 🎉');return;}
    if(act==='tab'){const t=a.dataset.tab;curTab=t;if(t==='home')goHome();else if(t==='practice')goPractice();else if(t==='stats')goStats();else if(t==='me')goMe();else if(t==='wrong')goWrong();else if(t==='fav')goFav();return;}
    if(act==='start-chapter'){goChapterList(+a.dataset.ch);return;}
    if(act==='chapter-filter'){goChapterList(+a.dataset.ch,a.dataset.f);return;}
    if(act==='ql-item'){const ch=+a.dataset.ch;const i=+a.dataset.idx;const c=QBANK.chapters.find(x=>x.id===ch);startQuiz(lastChList,'chapter',c.title+' · 練習',i);return;}
    if(act==='start-filtered'){const ch=+a.dataset.ch;const c=QBANK.chapters.find(x=>x.id===ch);if(!lastChList.length){toast('此篩選沒有題目');return;}startQuiz(lastChList,'chapter',c.title+' · 練習',0);return;}
    if(act==='start-random20'){const ch=+a.dataset.ch;const c=QBANK.chapters.find(x=>x.id===ch);const arr=shuffle(c.questions.slice());startQuiz(arr.slice(0,20),'chapter',c.title+' · 練習',0);return;}
    if(act==='ql-toggle'){qlExpanded=!qlExpanded;const lst=el('screen').querySelector('.qlist');const tgl=el('screen').querySelector('.qltoggle .qlt-icon');if(lst){lst.classList.toggle('ql-collapsed',!qlExpanded);}if(tgl){tgl.textContent=qlExpanded?'▾':'▸';}const txt=el('screen').querySelector('.qlt-text');if(txt)txt.textContent=qlExpanded?'收起題目列表':'展開題目列表（'+lastChList.length+' 題）';return;}
    if(act==='back-list'){if(curChId)goChapterList(curChId);else goPractice();return;}
    if(act==='start-random'){const all=[];QBANK.chapters.forEach(c=>c.questions.forEach(q=>all.push(q)));startQuiz(shuffle(all).slice(0,15),'random','隨機練習');return;}
    if(act==='start-mock'){startQuiz(QBANK.mockExam.slice(),'mock','模考模式 · 官網 60 題');return;}
    if(act==='start-wrong'){const arr=state.wrong.filter(k=>KEY2Q[k]).map(k=>KEY2Q[k]);if(!arr.length){toast('暫無錯題');return;}startQuiz(shuffle(arr),'wrong','錯題重練');return;}
    if(act==='start-fav'){const arr=state.fav.filter(k=>KEY2Q[k]).map(k=>KEY2Q[k]);if(!arr.length){toast('暫無收藏');return;}startQuiz(shuffle(arr),'fav','收藏重練');return;}
    if(act==='option'){if(quiz.answeredFlags[quiz.idx])return;const k=a.dataset.key;const q=quiz.questions[quiz.idx];if(q.type==='multiple'){const i=quiz.selections.indexOf(k);if(i>=0)quiz.selections.splice(i,1);else quiz.selections.push(k);}else{quiz.selections=[k];}renderQuiz();return;}
    if(act==='submit'){submitAnswer();return;}
    if(act==='next'){nextQ();return;}
    if(act==='finish'){renderSummary();return;}
    if(act==='restart'){startQuiz(quiz.questions,quiz.mode,quiz.title);return;}
    if(act==='fav-toggle'){const k=a.dataset.key;if(state.fav.includes(k))state.fav=state.fav.filter(x=>x!==k);else state.fav.push(k);save();renderQuiz();return;}
    if(act==='quiz-exit'){if(quiz&&quiz.timer)clearInterval(quiz.timer);goHome();return;}
    if(act==='reset'){if(confirm('確定重置所有答題 / 打卡 / 錯題 / 收藏？')){state={answered:{},wrong:[],fav:[],checkins:[]};save();goMe();toast('已重置');}return;}
    if(act==='sync-settings'){ showSyncSetup(!!syncUid); return; }
    if(act==='sync-now'){ fullSync(); return; }
    if(act==='sync-diag'){ showSyncDiag(); return; }
    if(act==='sync-copy'){ const v=syncUid; if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(v).then(()=>toast('已複製同步碼')).catch(()=>toast('複製失敗，請手動選取'));}else{toast('請長按同步碼手動複製');} return; }
  });

  // 回到頁面 / 切回分頁時立即下拉一次，讓同步「近乎即時」而非等 15 秒
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden&&syncOn&&syncUid) pullSync(null,false); });
  window.addEventListener('focus',()=>{ if(syncOn&&syncUid) pullSync(null,false); });

  function showSyncDiag(){
    const ov=document.createElement('div'); ov.className='sync-modal';
    ov.innerHTML=`<div class="sync-card">
      <div class="sync-h">🔍 同步診斷</div>
      <div id="diagOut" class="diag-out">測試中…</div>
      <button class="ghost wide" id="diagClose">關閉</button>
    </div>`;
    document.body.appendChild(ov);
    ov.querySelector('#diagClose').onclick=()=>ov.remove();
    const out=ov.querySelector('#diagOut'); const set=s=>out.innerHTML=s;
    if(!syncOn||!syncUid){set('❌ 尚未連接：請先於「我的 › 雲端同步」設定同步碼與後端');return;}
    set('同步碼：<code>'+esc(syncUid)+'</code><br>模式：'+(syncMode==='supabase'?'Supabase':'自架伺服器')+'<br>測試連線中…');
    if(syncMode==='supabase'){
      supaSelect(syncUid).then(arr=>{
        if(arr&&arr.length&&arr[0]&&arr[0].data){
          const d=arr[0].data||{}; const n=d.answered?Object.keys(d.answered).length:0;
          set('✅ 連線成功<br>雲端儲存題數：<b>'+n+'</b><br>本機題數：<b>'+Object.keys(state.answered||{}).length+'</b><br><br>若兩者不同，點「立即雙向同步」或等 15 秒自動下拉即可收斂。<br>⚠️ 兩台裝置的「同步碼」必須完全相同才會同步到同一份資料。');
        } else {
          set('⚠️ 連線成功，但雲端尚無此同步碼的資料（本機尚未上傳過）。點「立即雙向同步」上傳本機進度。');
        }
      }).catch(e=>{ set('❌ 連線失敗：'+(e&&e.message||e)+'<br>請檢查 Supabase 網址/金鑰，並確認 progress 表已建且 RLS 已關閉。'); });
    } else {
      fetch((syncBase||'')+'/api/progress?uid='+encodeURIComponent(syncUid)).then(r=>r.ok?r.json():null).then(j=>{
        if(j&&j.data){const n=Object.keys(j.data.answered||{}).length;set('✅ 連線成功<br>雲端題數：<b>'+n+'</b>　本機題數：<b>'+Object.keys(state.answered||{}).length+'</b>');}
        else set('⚠️ 連線成功但雲端無此碼資料，點「立即雙向同步」上傳。');
      }).catch(()=>set('❌ 連線失敗：請檢查同步伺服器網址/HTTPS。'));
    }
  }

  boot();
})();
