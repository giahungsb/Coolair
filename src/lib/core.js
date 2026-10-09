import * as Vue from 'vue';
import twemoji from 'twemoji';   // tự host qua npm (Vite bundle), không dùng CDN -> bỏ jsdelivr khỏi script-src trong CSP
const {createApp,ref,reactive,computed,nextTick,watch}=Vue;
const I={cloud:'M7 19a5 5 0 0 1-.6-10A6 6 0 0 1 18 8.5 4.8 4.8 0 0 1 17.5 19z',home:'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',users:'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm7 1a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM9 13c-3.3 0-7 1.7-7 4.5V20h14v-2.5C16 14.7 12.3 13 9 13zm7.5.1c2.8.4 5.5 1.8 5.5 4.4V20h-4v-2.5c0-1.7-.7-3.2-1.5-4.4z',game:'M7 8h10a5 5 0 0 1 5 5v1.5a3 3 0 0 1-5.3 1.9L15.5 15h-7l-1.2 1.4A3 3 0 0 1 2 14.5V13a5 5 0 0 1 5-5zm0 2.5V12H5.5v1.6H7v1.5h1.6v-1.5h1.5V12H8.6v-1.5zm9 .5a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2z',bell:'M12 22a2.2 2.2 0 0 0 2.2-2h-4.4A2.2 2.2 0 0 0 12 22zm6-6v-5a6 6 0 0 0-5-5.9V4a1 1 0 0 0-2 0v1.1A6 6 0 0 0 6 11v5l-2 2v1h16v-1z',chat:'M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',search:'M10 2a8 8 0 1 0 4.9 14.3l5.4 5.4 1.4-1.4-5.4-5.4A8 8 0 0 0 10 2zm0 2a6 6 0 1 1 0 12 6 6 0 0 1 0-12z',user:'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-4.4 0-8 2.2-8 5v3h16v-3c0-2.8-3.6-5-8-5z',plus:'M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z',lock:'M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5zm-3 8V7a3 3 0 0 1 6 0v3z',mail:'M3 5h18a1 1 0 0 1 1 1v.5l-10 6-10-6V6a1 1 0 0 1 1-1zm-1 3.8l10 6 10-6V18a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z'};
const SSO_TRY='coolair_sso_try',SSO_NONE='coolair_sso_none';
/* Token đăng nhập nằm trong cookie HttpOnly `ca_tk` (server đặt/xóa, JS không đọc được -> XSS không cắp được).
   credentials:'include' để trình duyệt gửi cookie theo mọi request API. */
const api=async(m,u,b)=>{const r=await fetch('/api'+u,{method:m,credentials:'include',headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});const d=await r.json().catch(()=>({}));if(r.status===401&&!/^\/(auth|sso)\//.test(u))dispatchEvent(new CustomEvent('coolair:expired',{detail:d.banned?d.error:''}));
if(!r.ok){const e=new Error(d.error||'Có lỗi xảy ra.');e.status=r.status;e.fields=d.fields||{};e.data=d;throw e}return d};
const tick=Vue.ref(Date.now());setInterval(()=>tick.value=Date.now(),6e4);
const DAYS=['Chủ nhật','Thứ Hai','Thứ Ba','Thứ Tư','Thứ Năm','Thứ Sáu','Thứ Bảy'],p2=n=>String(n).padStart(2,'0');
const ago=d=>{const x=Math.max(0,(tick.value-new Date(d))/1e3|0),m=x/60|0,h=x/3600|0,D=x/86400|0;return x<60?'Vừa xong':m<60?m+' phút trước':h<24?h+' giờ trước':D<7?D+' ngày trước':D<30?(D/7|0)+' tuần trước':D<365?(D/30|0)+' tháng trước':(D/365|0)+' năm trước'};
const full=d=>{const t=new Date(d);return DAYS[t.getDay()]+', '+p2(t.getDate())+'/'+p2(t.getMonth()+1)+'/'+t.getFullYear()+' lúc '+p2(t.getHours())+':'+p2(t.getMinutes())};
const dayKey=d=>{const t=new Date(d),n=new Date(tick.value),k=Math.round((new Date(n.getFullYear(),n.getMonth(),n.getDate())-new Date(t.getFullYear(),t.getMonth(),t.getDate()))/864e5);return k<=0?'Hôm nay':k===1?'Hôm qua':k<7?DAYS[t.getDay()]:DAYS[t.getDay()]+', '+p2(t.getDate())+'/'+p2(t.getMonth()+1)+(t.getFullYear()!==n.getFullYear()?'/'+t.getFullYear():'')};
const group=l=>{const g=[];l.forEach(p=>{const k=dayKey(p.d);let c=g[g.length-1];if(!c||c.k!==k)g.push(c={k,items:[]});c.items.push(p)});return g};
const map=p=>({id:p.id,n:p.name,a:p.av||'',t:!!p.tick,d:p.createdAt,x:p.text,l:p.likes,k:p.reaction,c:p.comments.map(c=>[c.name,c.text,c.av||'',c.id,c.parent||null,c.canDel,!!c.anon,c.likes||0,c.reaction||null,c.emojis||[],!!c.tick]),mine:p.mine,v:p.visibility||'public',e:p.editedAt,ph:p.photos||[],vd:p.video||null,loc:p.location||null});
const COL=['#2C629E','#E8590C','#6B8E23','#9C36B5','#0C8599','#D6336C'];

/* Component: Icon */
const CIc={props:{n:String,cls:{type:String,default:'w-6 h-6'}},template:'<svg viewBox="0 0 24 24" :class="cls" fill="currentColor"><path :d="d"/></svg>',computed:{d(){return I[this.n]}}};
/* Render emoji đẹp (Twemoji) cho chữ người dùng: escape HTML trước rồi mới thay emoji thành ảnh — an toàn, Vue vẫn cập nhật bình thường */
const TW_BASE='https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/';
const escH=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const emoh=s=>{const e=escH(s);try{return twemoji.parse(e,{base:TW_BASE,size:'72x72'})}catch(_){return e}};
/* @nhắc tên: cùng quy tắc với server/mention.js (tên đăng nhập 3–20 ký tự a-z 0-9 . _). Chạy SAU khi đã escape HTML nên an toàn.
   CẢNH BÁO BẢO MẬT: mentH CHỈ được gọi với chuỗi đã qua escH/emoh. Gọi với input thô + v-html = XSS ngay lập tức. */
const mentH=h=>h.replace(/(^|[^a-z0-9._@\/])@([a-z0-9._]{3,20})/gi,(m,pre,u)=>{const t=u.replace(/\.+$/,'');return t.length<3?m:pre+'<a href="#" class="mt" data-mu="'+t.toLowerCase()+'">@'+t+'</a>'+u.slice(t.length)});
const CTx={props:['t'],methods:{mh:s=>mentH(emoh(s))},template:`<span v-html="mh(t)"></span>`};
/* Bảng chọn emoji (dữ liệu unicode, hiển thị bằng Twemoji cho đẹp đồng nhất mọi máy) */
const EMOCATS=[
{n:'Mặt cười',i:'😀',items:['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😙','😚','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','😐','😑','🙄','😬','😴','🤤','😪','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','😤','😡','😠','🤬','😈','👿','💀','☠️','🤡','👹','👺','👻','👽','👾','🤖','💩','😺','😸','😹','😻','😼','😽','🙀','😿','😾']},
{n:'Con người',i:'👋',items:['👋','🤚','🖐','✋','🖖','👌','🤌','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','👂','👃','🧠','👀','👁','👅','👄','💋','👶','🧒','👦','👧','🧑','👨','👩','🧓','👴','👵','🤰','🤱','👼','🎅','🤶','🦸','🦹','🧙','🧚','🧛','🧜','🧝','🧞','🧟','💆','💇','🚶','🏃','💃','🕺','👯','🧗','🏇','🏂','🏄','🏊','🤸','🤽','🧘']},
{n:'Thiên nhiên',i:'🐶',items:['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🦆','🦅','🦉','🦇','🐺','🐴','🦄','🐝','🦋','🐌','🐞','🐜','🐢','🐍','🦎','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐘','🐪','🦒','🦘','🐎','🐖','🐏','🐑','🐐','🦌','🐕','🐈','🐓','🦚','🦜','🦢','🕊','🐇','🐁','🌵','🎄','🌲','🌳','🌴','🌱','🌿','☘️','🍀','🍃','🍂','🍁','🍄','🌾','💐','🌷','🌹','🥀','🌺','🌸','🌼','🌻','🌞','🌝','🌚','🌕','🌙','🌎','🌍','🌏','🪐','💫','⭐','🌟','✨','⚡','☄️','💥','🔥','🌪','🌈','☀️','⛅','☁️','🌧','⛈','🌨','❄️','☃️','🌬','💨','💧','💦','☔','☂️','🌊']},
{n:'Ẩm thực',i:'🍎',items:['🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🥑','🍆','🥔','🥕','🌽','🌶','🥒','🥬','🥦','🧄','🧅','🍄','🥜','🌰','🍞','🥐','🥖','🥨','🥯','🧇','🥞','🧈','🍳','🥚','🧀','🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕','🥪','🥙','🌮','🌯','🥗','🥘','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🍤','🍙','🍚','🥠','🥮','🍢','🍡','🍧','🍨','🍦','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🥛','🍼','☕','🍵','🧃','🥤','🧋','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🍾','🥄','🍴','🍽','🥢']},
{n:'Hoạt động',i:'⚽',items:['⚽','🏀','🏈','⚾','🎾','🏐','🏉','🎱','🏓','🏸','🏒','🥅','⛳','🏹','🎣','🥊','🥋','🎽','🛹','⛸','🎿','🏂','🏋','🤸','🧘','🏄','🏊','🎯','🎮','🕹','🎰','🎲','🧩','🧸','🎨','🎭','🎪','🤹','🎤','🎧','🎼','🎹','🥁','🎷','🎺','🎸','🎻','🎬']},
{n:'Du lịch',i:'🚗',items:['🚗','🚕','🚙','🚌','🏎','🚓','🚑','🚒','🚚','🚜','🛴','🚲','🛵','🏍','🚨','✈️','🛫','🛬','🪂','🚀','🛸','🚁','🛶','⛵','🚤','🛥','🛳','🚢','⚓','⛽','🚧','🚏','🚦','🗿','🗽','🗼','🏰','🏯','🏟','🎡','🎢','🎠','⛲','⛱','🏖','🏝','🌋','⛰','🏔','🗻','🏕','⛺','🏠','🏡','🏢','🏥','🏦','🏨','🏪','🏫','💒','⛪','🕌','⛩']},
{n:'Đồ vật',i:'💡',items:['⌚','📱','💻','⌨','🖥','🖨','🖱','💽','💾','💿','📀','🧮','🎥','📽','🎞','📞','☎','📠','📺','📻','🎙','🧭','⏱','⏲','⏰','🕰','⌛','⏳','📡','🔋','🔌','💡','🔦','🕯','💸','💵','💴','💶','💷','🪙','💰','💳','💎','⚖','🧰','🔧','🔨','⛏','🔩','⚙','⛓','🧲','🔫','💣','🧨','🪓','🔪','🗡','⚔','🛡','⚰','🏺','🔮','📿','💈','🔭','🔬','💊','💉','🏷','🔖','🚩','🎌']},
{n:'Ký hiệu',i:'❤️',items:['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣','💕','💞','💓','💗','💖','💘','💝','💟','☮','✝','☪','🕉','☸','✡','🔯','☯','🛐','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚛','☢','☣','📴','📳','🈶','✴','🆚','💮','✳','‼','⁉','❓','❔','❕','❗','〰','©','®','™','#️⃣','*️⃣','0️⃣','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟','💯','🔠','🔡','🔢','🅰','🆎','🅱','🆑','🆒','🆓','ℹ','Ⓜ','🆕','🅾','🆗','🅿','🆘','🆙']}];
const CEmo={data:()=>({open:false,cat:0}),methods:{pick(e){this.$emit('pick',e);this.open=false}},
template:`<span class="relative inline-block">
 <button type="button" class="gh !text-xl !px-2" @click.stop="open=!open" aria-label="Chèn emoji" title="Chèn emoji">😀</button>
 <div v-if="open" class="fixed inset-0 z-40" @click="open=false" aria-hidden="true"></div>
 <div v-if="open" class="absolute z-50 bottom-full mb-2 left-0 card p-2 w-[19rem] max-w-[80vw]">
  <div class="flex gap-1 flex-wrap mb-2" role="tablist" aria-label="Nhóm emoji">
   <button v-for="(c,i) in cats" :key="i" type="button" role="tab" :aria-selected="cat===i" class="gh !text-lg !px-1.5" :class="{'!bg-[var(--soft)]':cat===i}" :title="c.n" @click="cat=i">{{ c.i }}</button>
  </div>
  <div class="emo-grid grid grid-cols-8 gap-0.5 overflow-y-auto" style="max-height:220px" role="tabpanel" :aria-label="cats[cat].n">
   <button v-for="(e,j) in cats[cat].items" :key="j" type="button" @click="pick(e)" :aria-label="'Chèn '+e">{{ e }}</button>
  </div>
 </div></span>`,
computed:{cats(){return EMOCATS}}};

export { CEmo, CIc, COL, CTx, SSO_NONE, SSO_TRY, ago, api, computed, createApp, emoh, escH, full, group, map, nextTick, reactive, ref, watch };
