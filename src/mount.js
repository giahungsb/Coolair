import { app } from './app.js';
import { CEmo, CIc, CTx, api, emoh, escH } from './lib/core.js';
import { CAttach, CAv, CPost, CTick } from './modules/post.js';
import { CFeed, CSearch } from './modules/search-feed.js';
import { CAlbum } from './modules/album.js';
import { CMap, AdminMap } from './modules/checkin-map.js';
import { CBlog } from './modules/blog.js';
import { CEvents, CPolls } from './modules/events-polls.js';
import { CDiscover, CDoings, CShares, CTopics } from './modules/social.js';
import { CMagic, CTasks } from './modules/magic-tasks.js';
import { CForum } from './modules/forum.js';
import { CMusic, CVideos } from './modules/music-video.js';
import { CBulletins, CFav, CFavRate, CGifts, CHelp, CLinks, CMail, CPages, CQuizzes, CShout } from './modules/phpfox-modules.js';
app.component('CIc',CIc).component('CAv',CAv).component('CTick',CTick).component('CAttach',CAttach).component('CPost',CPost).component('CFeed',CFeed).component('CAlbum',CAlbum).component('CBlog',CBlog).component('CEvents',CEvents).component('CPolls',CPolls).component('CSearch',CSearch).component('CDoings',CDoings).component('CShares',CShares).component('CDiscover',CDiscover).component('CTopics',CTopics).component('CTasks',CTasks).component('CMagic',CMagic).component('CForum',CForum).component('CMusic',CMusic).component('CVideos',CVideos).component('CQuizzes',CQuizzes).component('CPages',CPages).component('CGifts',CGifts).component('CMail',CMail).component('CBulletins',CBulletins).component('CLinks',CLinks).component('CHelp',CHelp).component('CShout',CShout).component('CMap',CMap).component('CAdminMap',AdminMap).component('CFav',CFav).component('CFavRate',CFavRate).component('CTx',CTx).component('CEmo',CEmo);
app.config.globalProperties.emoh=emoh;
/* v-mention: gõ @ trong ô nhập -> gợi ý bạn bè (tên đăng nhập + tên), chọn xong chèn @tên_đăng_nhập. Hoạt động với input/textarea có v-model (bắn lại sự kiện input). */
app.directive('mention',{created(el){
 let box=null,items=[],idx=0,tok=null,timer=0,seq=0;
 const close=()=>{if(box){box.remove();box=null}items=[];tok=null;idx=0};
 const find=()=>{const c=el.selectionStart;if(c==null)return null;const m=/(^|[^a-z0-9._@\/])@([a-z0-9._]{0,20})$/i.exec(el.value.slice(0,c));return m?{start:c-m[2].length-1,end:c,q:m[2].toLowerCase()}:null};
 const place=()=>{if(!box)return;const r=el.getBoundingClientRect(),h=box.offsetHeight||120,below=innerHeight-r.bottom>h+8;box.style.left=Math.max(4,Math.min(r.left,innerWidth-box.offsetWidth-4))+'px';box.style.top=(below?r.bottom+2:Math.max(4,r.top-h-2))+'px';box.style.minWidth=Math.min(260,r.width)+'px'};
 const draw=()=>{if(!items.length){close();return}
  if(!box){box=document.createElement('div');box.className='card mbox';box.setAttribute('role','listbox');document.body.appendChild(box)}
  box.innerHTML=items.map((u,i)=>'<button type="button" role="option" class="mi w-full '+(i===idx?'sel':'')+'" data-i="'+i+'"><b>'+escH(u.name)+'</b><span class="text-mute text-xs">@'+escH(u.username)+'</span></button>').join('');place()};
 const pick=i=>{const u=items[i];if(!u||!tok)return;const v=el.value,ins='@'+u.username+' ';el.value=v.slice(0,tok.start)+ins+v.slice(tok.end);const pos=tok.start+ins.length;el.setSelectionRange(pos,pos);el.dispatchEvent(new Event('input',{bubbles:true}));close();el.focus()};
 const upd=()=>{const t=find();if(!t){close();return}tok=t;clearTimeout(timer);const my=++seq;
  timer=setTimeout(async()=>{try{const r=await api('GET','/mention/suggest?q='+encodeURIComponent(t.q));if(my!==seq||!tok)return;items=r;idx=0;draw()}catch(e){close()}},150)};
 const onKey=e=>{if(!box)return;
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();idx=(idx+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;draw()}
  else if(e.key==='Enter'||e.key==='Tab'){e.preventDefault();e.stopImmediatePropagation();pick(idx)}
  else if(e.key==='Escape'){e.stopPropagation();close()}};
 const down=e=>{const b=box&&e.target.closest&&e.target.closest('button[data-i]');if(b&&box.contains(b)){e.preventDefault();pick(+b.dataset.i)}};
 el.addEventListener('keydown',onKey,true);el.addEventListener('input',upd);el.addEventListener('click',upd);el.addEventListener('blur',()=>setTimeout(close,180));
 document.addEventListener('mousedown',down,true);document.addEventListener('touchstart',down,{capture:true,passive:false});
 el._mn={close,down};
},unmounted(el){if(el._mn){el._mn.close();document.removeEventListener('mousedown',el._mn.down,true);document.removeEventListener('touchstart',el._mn.down,true)}}});
/* PWA: đăng ký service worker (cache vỏ ứng dụng + nhận thông báo đẩy) */
if('serviceWorker' in navigator)addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
// Lỗi trong lúc render không bắn sự kiện window.error (Vue tự bắt) -> chuyển cho khung báo lỗi khởi động ở static/theme-init.js
app.config.errorHandler=(e,_inst,info)=>{console.error(e);try{window.__bootErr&&window.__bootErr('Vue ['+info+']: '+((e&&(e.stack||e.message))||e))}catch(_){}};
app.mount('#app');
try{window.__bootOk&&window.__bootOk()}catch(_){}

