try{var __m=localStorage.getItem('coolair_mode');if(__m==='light'||__m==='dark')document.documentElement.dataset.theme=__m}catch(e){}
/* Báo lỗi khởi động: nếu app không lên được (JS lỗi, file module 404/sai MIME, render crash) thì hiện nguyên văn lỗi trên màn hình
   thay vì trang trắng (hữu ích trên điện thoại, không cần mở Console). Chỉ hiện khi #app còn trống; mount.js gọi __bootErr / __bootOk.
   Khi một file <script> không nạp được, tự gọi thử file đó + các file nó import để biết HTTP mấy / MIME gì. */
(function(){
  var errs=[],ok=false,RK='ca_boot_reload';
  function blank(){var a=document.getElementById('app');return !!a&&(a.hasAttribute('v-cloak')||!a.firstElementChild)}
  function wipe(){
    var p=[];
    if(navigator.serviceWorker)p.push(navigator.serviceWorker.getRegistrations().then(function(rs){return Promise.all(rs.map(function(r){return r.unregister()}))}));
    if(window.caches)p.push(caches.keys().then(function(ks){return Promise.all(ks.map(function(k){return caches.delete(k)}))}));
    Promise.all(p).then(function(){location.reload()},function(){location.reload()});
  }
  function show(){
    if(ok||!blank())return;
    var d=document.getElementById('boot-err');
    if(!d){
      d=document.createElement('div');d.id='boot-err';
      var st=d.style;st.position='fixed';st.inset='0';st.zIndex='99999';st.padding='16px';st.overflow='auto';st.background='#fff';
      d._pre=document.createElement('pre');
      var ps=d._pre.style;ps.whiteSpace='pre-wrap';ps.wordBreak='break-word';ps.font='13px/1.45 monospace';ps.color='#b00020';ps.margin='0 0 16px';
      var b=document.createElement('button');b.textContent='Gỡ service worker + xóa cache, tải lại';b.onclick=wipe;
      var bs=b.style;bs.padding='10px 14px';bs.font='14px system-ui,sans-serif';
      d.appendChild(d._pre);d.appendChild(b);
      (document.body||document.documentElement).appendChild(d);
    }
    var sw=navigator.serviceWorker&&navigator.serviceWorker.controller?'có (đang điều khiển trang)':'không';
    d._pre.textContent='CoolAir không khởi động được.\n\n'+errs.join('\n---\n')+'\n\nService worker: '+sw+'\n(Chụp màn hình này gửi lại để được sửa.)';
  }
  function add(m){m=String(m).slice(0,1200);if(errs.indexOf(m)<0&&errs.length<8)errs.push(m);setTimeout(show,0)}
  function short(u){return String(u).replace(location.origin,'')}
  function probe(url){   // gọi thử file hỏng + các file nó import (from"./x.js"), báo HTTP + content-type
    if(!window.fetch)return;
    fetch(url,{cache:'no-store'}).then(function(r){
      var ct=r.headers.get('content-type')||'?';
      add('Thử tải '+short(url)+': HTTP '+r.status+', '+ct);
      if(!r.ok||!/javascript/i.test(ct))return;
      return r.text().then(function(t){
        var re=/(?:from|import)\s*["'](\.{1,2}\/[^"']+)["']/g,m,seen={},list=[];
        while((m=re.exec(t))&&list.length<12){var u=new URL(m[1],url).href;if(!seen[u]){seen[u]=1;list.push(u)}}
        return Promise.all(list.map(function(u){
          return fetch(u,{cache:'no-store'}).then(function(r2){return short(u)+' -> HTTP '+r2.status+', '+(r2.headers.get('content-type')||'?')},function(e){return short(u)+' -> '+e});
        })).then(function(rows){if(rows.length)add('File phụ thuộc:\n'+rows.join('\n'))});
      });
    }).catch(function(e){add('Thử tải '+short(url)+' thất bại: '+e)});
  }
  window.__bootErr=add;
  window.__bootOk=function(){if(!blank()){ok=true;try{sessionStorage.removeItem(RK)}catch(_){}var d=document.getElementById('boot-err');if(d)d.remove()}};
  addEventListener('error',function(e){
    var t=e.target;
    if(t&&t!==window&&(t.src||t.href)){
      // file /assets/*.js (tên có hash, đổi mỗi lần deploy) không nạp được = rất có thể trình duyệt đang giữ index.html cũ -> tự gỡ SW + xóa cache + tải lại ĐÚNG 1 lần
      if(t.src&&/\/assets\//.test(t.src)){try{if(!sessionStorage.getItem(RK)){sessionStorage.setItem(RK,'1');wipe();return}}catch(_){}}
      add('Không nạp được: '+(t.src||t.href));if(t.src)probe(t.src);
    }   // <script>/<link> 404, sai MIME, bị chặn
    else add((e.message||'Lỗi JS')+(e.filename?'\n'+e.filename+':'+e.lineno+':'+e.colno:''));
  },true);
  addEventListener('unhandledrejection',function(e){
    var r=e.reason,m=String((r&&(r.message||r.stack))||r);
    // chunk JS nạp động bị 404 (trình duyệt giữ bản cũ sau deploy) -> tự gỡ SW + xóa cache + tải lại ĐÚNG 1 lần
    if(/dynamically imported module|Importing a module script failed|Failed to fetch dynamically/i.test(m)){try{if(!sessionStorage.getItem(RK)){sessionStorage.setItem(RK,'1');wipe();return}}catch(_){}}
    add('Promise: '+((r&&(r.stack||r.message))||r))});
  setTimeout(function(){if(!ok&&blank()){try{if(!sessionStorage.getItem(RK)){sessionStorage.setItem(RK,'1');wipe();return}}catch(_){}if(!errs.length)errs.push('Sau 10 giây app vẫn chưa hiện (file JS có thể bị 404 / sai MIME / mạng chậm).');show()}},10000);
})();
