import { COL, ago, api, full, map } from '../lib/core.js';
/* Component: Avatar */
/* Ảnh đại diện Cloudinary: chèn phép biến đổi (cắt vuông theo mặt, đúng cỡ hiển thị) vào URL. URL lạ -> dùng nguyên. */
const AVU=(u,s)=>{const m=u&&u.match(/^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.+)$/);if(!m)return u||'';const need=s*Math.min(2,window.devicePixelRatio||1),n=[48,96,160,320,512].find(x=>x>=need)||512;return m[1]+'c_fill,g_face,w_'+n+',h_'+n+',q_auto,f_auto/'+m[2]};
/* Ảnh album: cỡ theo nhu cầu hiển thị (sq = cắt vuông cho ảnh nhỏ; không sq = giữ tỉ lệ, tối đa n px). URL lạ -> dùng nguyên. */
const PH=(u,w,sq)=>{const m=u&&u.match(/^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.+)$/);if(!m)return u||'';const need=w*Math.min(2,window.devicePixelRatio||1),n=[200,400,800,1200,1600].find(x=>x>=need)||1600;return m[1]+(sq?'c_fill,w_'+n+',h_'+n:'c_limit,w_'+n)+',q_auto,f_auto/'+m[2]};
/* Video đã tải lên Cloudinary: mp4/m4v phát nguyên bản; mov/webm đổi sang mp4 (H.264) khi xem. VP = ảnh bìa lấy từ giây đầu tiên. URL lạ -> bỏ qua. */
const VU=u=>{const m=u&&u.match(/^(https:\/\/res\.cloudinary\.com\/[^/]+\/video\/upload\/)(v\d+\/.+)\.(mp4|mov|webm|m4v)$/);if(!m)return '';return /^(mp4|m4v)$/.test(m[3])?u:m[1]+'vc_h264,ac_aac/'+m[2]+'.mp4'};
const VP=(u,w)=>{const m=u&&u.match(/^(https:\/\/res\.cloudinary\.com\/[^/]+\/video\/upload\/)(v\d+\/.+)\.(mp4|mov|webm|m4v)$/);return m?m[1]+'so_0,c_limit,w_'+w+',q_auto/'+m[2]+'.jpg':''};
/* Giới hạn dung lượng (byte) theo loại tệp; server cũng trả `maxBytes` và trình duyệt lấy số nhỏ hơn. */
const MB=1048576,LIM={avatar:5*MB,cover:10*MB,album:20*MB,post:20*MB,postvideo:500*MB,video:500*MB,music:50*MB},LIMT={avatar:'5MB',cover:'10MB',album:'20MB',post:'20MB',postvideo:'500MB',video:'500MB',music:'50MB'};
/* Ảnh > 8MB (không phải GIF) được thu nhỏ ngay trên máy trước khi tải: Cloudinary gói miễn phí chỉ nhận ảnh ≤ 10MB mà ảnh vẫn được thu về 1600px khi lưu */
const shrink=async f=>{if(f.size<=8*MB||f.type==='image/gif'||!window.createImageBitmap)return f;
 try{const b=await createImageBitmap(f),k=Math.min(1,2400/Math.max(b.width,b.height)),c=document.createElement('canvas');c.width=Math.round(b.width*k);c.height=Math.round(b.height*k);
  const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);x.drawImage(b,0,0,c.width,c.height);if(b.close)b.close();
  const o=await new Promise(r=>c.toBlob(r,'image/jpeg',0.88));return o&&o.size<f.size?new File([o],'photo.jpg',{type:'image/jpeg'}):f}catch(e){return f}};
/* Gửi một phần (hoặc cả) tệp lên Cloudinary bằng XHR; hdr = tiêu đề thêm cho tải theo khúc. Trả về JSON phản hồi. */
let cspV='';document.addEventListener('securitypolicyviolation',e=>{cspV=e.violatedDirective+' -> '+e.blockedURI});
const cldSend=(s,blob,name,hdr,onp)=>new Promise((ok,no)=>{const fd=new FormData();fd.append('file',blob,name);fd.append('api_key',s.apiKey);fd.append('signature',s.signature);for(const k in s.params)fd.append(k,s.params[k]);
 const x=new XMLHttpRequest();x.open('POST',s.url);for(const h in hdr||{})x.setRequestHeader(h,hdr[h]);if(onp)x.upload.onprogress=e=>{if(e.lengthComputable)onp(e.loaded)};
 x.onload=()=>{let j={};try{j=JSON.parse(x.responseText)}catch(e){}x.status>=200&&x.status<300?ok(j):no(Object.assign(new Error((j.error&&j.error.message)||'Tải lên thất bại.'),{http:x.status}))};
 x.onerror=()=>setTimeout(()=>no(Object.assign(new Error('Lỗi mạng khi tải lên. '+(cspV?'[CSP chặn: '+cspV+']':'[Không phải CSP: kiểm tra mạng / adblock / CORS]')),{http:0})),80);x.send(fd)});
/* Tải một tệp thẳng lên Cloudinary bằng chữ ký server cấp (kind = avatar | album | post | postvideo) -> trả về secure_url. onp(0..1) = tiến độ.
   Tệp > 90MB (video) tải theo từng khúc 20MB (Cloudinary giới hạn 100MB mỗi request): cùng chữ ký + tiêu đề X-Unique-Upload-Id / Content-Range; khúc lỗi mạng thử lại tối đa 3 lần. */
const cloudUp=async(kind,f,onp)=>{const vid=kind==='postvideo'||kind==='video',aud=kind==='music',nm=vid?'Video':aud?'File nhạc':'Ảnh',ext=((f.name||'').split('.').pop()||'').toLowerCase();
 /* kind=video (trang Video) và music (trang Âm nhạc) trước đây rơi vào nhánh ảnh nên luôn báo "Chỉ nhận ảnh JPG, PNG, WEBP hoặc GIF". Một số điện thoại không gửi f.type -> dự phòng theo đuôi tệp. */
 if(vid){if(!(/^video\/(mp4|quicktime|webm|x-m4v)$/.test(f.type)||(!f.type&&/^(mp4|mov|webm|m4v)$/.test(ext))))throw new Error('Chỉ nhận video MP4, MOV hoặc WEBM.')}
 else if(aud){if(!(/^(mp3|m4a|wav|ogg|aac|flac|opus)$/.test(ext)&&(!f.type||/^audio\//.test(f.type))))throw new Error('Chỉ nhận file nhạc MP3, M4A, WAV, OGG, AAC, FLAC hoặc OPUS.')}
 else if(!/^image\/(jpeg|png|webp|gif)$/.test(f.type))throw new Error('Chỉ nhận ảnh JPG, PNG, WEBP hoặc GIF.');
 if(!vid&&!aud&&kind!=='avatar')f=await shrink(f);
 if(f.size>LIM[kind])throw new Error(nm+' tối đa '+LIMT[kind]+'.');
 const s=await api('GET','/upload/sign?kind='+kind);if(s.maxBytes&&f.size>s.maxBytes)throw new Error(nm+' vượt giới hạn của máy chủ ('+Math.floor(s.maxBytes/MB)+'MB).');
 const bad=e=>new Error(e.http===400&&/size|large/i.test(e.message)?nm+' vượt giới hạn của gói Cloudinary hiện tại.':e.message||('Tải '+nm.toLowerCase()+' lên thất bại.'));
 try{
  if(f.size<=90*MB){const j=await cldSend(s,f,f.name||'file',null,l=>onp&&onp(l/f.size));if(!j.secure_url)throw new Error('Tải lên thất bại.');return j.secure_url}
  const id=Date.now().toString(36)+Math.random().toString(36).slice(2,10),CH=20*MB;let last={};
  for(let st=0;st<f.size;st+=CH){const en=Math.min(st+CH,f.size),part=f.slice(st,en);
   for(let t=1;;t++){try{last=await cldSend(s,part,f.name||'video',{'X-Unique-Upload-Id':id,'Content-Range':'bytes '+st+'-'+(en-1)+'/'+f.size},l=>onp&&onp((st+l)/f.size));break}
    catch(e){if(e.http!==0&&e.http<500||t>=3)throw e;await new Promise(r=>setTimeout(r,1500*t))}}}
  if(!last.secure_url)throw new Error('Tải lên thất bại.');return last.secure_url
 }catch(e){throw bad(e)}};
/* Component: Attach – đính kèm ảnh (tối đa 10) hoặc 1 video (tải lên / dán link YouTube, Vimeo, TikTok, Dailymotion) khi soạn bài. Trạng thái nằm ở `att` của trang chủ. */
const discard=url=>api('POST','/post-media/discard',{url}).catch(()=>{});
const CAttach={props:{att:Object},data:()=>({link:'',linkOpen:false,gb:false}),
methods:{PH,say(m){this.att.err=m},
 async pickPh(e){const fs=[...e.target.files];e.target.value='';this.att.err='';if(!fs.length)return;
  if(this.att.vid||this.att.vp!==null)return this.say('Mỗi bài chỉ đăng ảnh hoặc video. Hãy bỏ video trước.');
  const room=10-this.att.ph.length-this.att.up;if(room<=0)return this.say('Mỗi bài tối đa 10 ảnh.');
  const pick=fs.slice(0,room);if(fs.length>room)this.say('Chỉ thêm được '+room+' ảnh nữa, các ảnh còn lại bị bỏ qua.');
  this.att.up+=pick.length;
  const r=await Promise.all(pick.map(async f=>{try{return await cloudUp('post',f)}catch(x){this.say(x.message);return ''}finally{this.att.up--}}));
  this.att.ph.push(...r.filter(Boolean).filter(u=>!this.att.ph.includes(u)))},
 rmPh(i){const u=this.att.ph.splice(i,1)[0];if(u)discard(u)},
 async pickVid(e){const f=e.target.files[0];e.target.value='';this.att.err='';if(!f)return;
  if(this.att.ph.length||this.att.up)return this.say('Mỗi bài chỉ đăng ảnh hoặc video. Hãy bỏ ảnh trước.');
  if(this.att.vid||this.att.vp!==null)return this.say('Mỗi bài chỉ có một video. Hãy bỏ video hiện tại trước.');
  this.att.vp=0;try{const url=await cloudUp('postvideo',f,p=>{this.att.vp=p});this.att.vid={kind:'upload',url,title:f.name}}catch(x){this.say(x.message)}finally{this.att.vp=null}},
 async grab(){const u=this.link.trim();this.att.err='';if(!u)return;
  if(this.att.ph.length||this.att.up)return this.say('Mỗi bài chỉ đăng ảnh hoặc video. Hãy bỏ ảnh trước.');
  if(this.att.vid||this.att.vp!==null)return this.say('Mỗi bài chỉ có một video. Hãy bỏ video hiện tại trước.');
  this.gb=true;try{this.att.vid=(await api('GET','/video/grab?url='+encodeURIComponent(u))).video;this.link='';this.linkOpen=false}catch(x){this.say(x.message)}finally{this.gb=false}},
 rmVid(){const v=this.att.vid;this.att.vid=null;if(v&&v.kind==='upload')discard(v.url)}},
template:`<div class="mt-2">
 <div v-if="att.ph.length||att.up" class="grid grid-cols-5 gap-1.5 mb-2">
  <div v-for="(u,i) in att.ph" :key="u" class="relative aspect-square"><img :src="PH(u,200,true)" alt="" class="w-full h-full object-cover rounded"><button type="button" class="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/65 text-white text-xs leading-5 text-center" aria-label="Bỏ ảnh này" @click="rmPh(i)">✕</button></div>
  <div v-for="n in att.up" :key="'u'+n" class="aspect-square rounded bg-bg grid place-items-center text-xs text-mute animate-pulse">Đang tải…</div>
 </div>
 <div v-if="att.vp!==null" class="mb-2 text-sm text-mute">🎬 Đang tải video lên… {{ Math.round(att.vp*100) }}%<div class="h-1 mt-1 rounded bg-bg overflow-hidden"><div class="h-full bg-zb2" :style="{width:Math.round(att.vp*100)+'%'}"></div></div></div>
 <div v-if="att.vid" class="mb-2 flex items-center gap-2 p-1.5 border border-line rounded text-sm">
  <img v-if="att.vid.thumb" :src="att.vid.thumb" alt="" referrerpolicy="no-referrer" class="w-16 h-10 object-cover rounded shrink-0">
  <span v-else class="w-16 h-10 grid place-items-center rounded bg-bg shrink-0">🎬</span>
  <span class="min-w-0 flex-1"><b class="block truncate">{{ att.vid.title||(att.vid.kind==='upload'?'Video tải lên':'Video') }}</b><small class="text-mute">{{ att.vid.kind==='upload'?'Tải lên từ máy':att.vid.site }}</small></span>
  <button type="button" class="gh !px-2" aria-label="Bỏ video này" @click="rmVid">✕</button>
 </div>
 <div v-if="linkOpen" class="flex gap-2 mb-2"><input v-model="link" class="ip text-sm" maxlength="300" placeholder="Dán link YouTube, Vimeo, TikTok hoặc Dailymotion" aria-label="Link video" @keydown.enter.prevent="grab"><button type="button" class="btn shrink-0" :disabled="gb" @click="grab">{{ gb?'Đang kiểm tra…':'Thêm' }}</button></div>
 <p v-if="att.err" class="text-xs text-red-600 mb-1" role="alert">{{ att.err }}</p>
 <div class="flex flex-wrap items-center gap-1">
  <label class="gh cursor-pointer" title="Thêm ảnh (tối đa 10, mỗi ảnh ≤ 20MB)"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM3 16l5-5 4 4 3-3 6 6M9 9.5h.01"/></svg><span class="lb">Ảnh</span><input type="file" class="hidden" multiple accept="image/jpeg,image/png,image/webp,image/gif" @change="pickPh"></label>
  <label class="gh cursor-pointer" title="Tải video lên (MP4, MOV, WEBM, ≤ 500MB)"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM10 9l5 3-5 3z"/></svg><span class="lb">Video</span><input type="file" class="hidden" accept="video/mp4,video/quicktime,video/webm" @change="pickVid"></label>
  <button type="button" class="gh" title="Dán link video" @click="linkOpen=!linkOpen"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg><span class="lb">Link video</span></button>
 </div>
</div>`};
const CAv={props:{name:String,src:String,size:{type:Number,default:40},on:Boolean,sq:Boolean,fx:Object},data:()=>({bad:false}),watch:{src(){this.bad=false}},
computed:{ini(){return this.name.split(' ').pop()[0]},col(){return COL[this.name.length%6]},img(){return this.src&&!this.bad?AVU(this.src,this.size):''}},
template:`<span class="av relative inline-grid place-items-center shrink-0 text-white font-semibold" :class="[sq?'rounded':'rounded-full',fx&&fx.frame?'fx-frame':'']" :style="{width:size+'px',height:size+'px',fontSize:size/2.6+'px',background:col}"><img v-if="img" :src="img" alt="" loading="lazy" referrerpolicy="no-referrer" class="absolute inset-0 w-full h-full object-cover" :class="sq?'rounded':'rounded-full'" @error="bad=true"><template v-else>{{ ini }}</template><i v-if="on" class="absolute z-10 rounded-full bg-zg ring-2 ring-card" style="width:22%;height:22%;min-width:10px;min-height:10px;right:4%;bottom:4%"></i></span>`};
/* Component: Tick xanh xác thực (hiển thị cạnh tên) */
const CTick={props:{on:Boolean,size:{type:Number,default:14}},
template:`<span v-if="on" class="inline-flex items-center justify-center rounded-full shrink-0 align-middle" :style="{width:size+'px',height:size+'px',background:'#1d9bf0'}" title="Tài khoản đã xác thực" role="img" aria-label="Đã xác thực"><svg :width="Math.round(size*0.62)" :height="Math.round(size*0.62)" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg></span>`};
/* Component: Post (like / reaction / comment) */
const CPost={props:{post:Object},emits:['del'],data:()=>({menu:false,lb:-1,play:false,raw:false,open:false,txt:'',anon:false,editing:false,etxt:'',busy:false,replyTo:null,shOpen:false,shNote:'',shVis:'public',rpOpen:false,rpTxt:'',R:['😍','😂','😮','😢'],CR:['👍','😍','😂','😮','😢'],VI:{public:['🌐','Công khai'],friends:['👥','Bạn bè'],private:['🔒','Chỉ mình tôi']}}),
computed:{emb(){const v=this.post.vd;if(!v||v.kind!=='embed')return '';const id=encodeURIComponent(v.vid);return({youtube:'https://www.youtube-nocookie.com/embed/'+id+'?autoplay=1&rel=0&playsinline=1',vimeo:'https://player.vimeo.com/video/'+id+'?autoplay=1',dailymotion:'https://www.dailymotion.com/embed/video/'+id+'?autoplay=1',tiktok:'https://www.tiktok.com/embed/v2/'+id})[v.site]||''},
 thumb(){const v=this.post.vd;return v?(v.site==='youtube'?'https://i.ytimg.com/vi/'+encodeURIComponent(v.vid)+'/hqdefault.jpg':v.thumb||''):''},
 tops(){return this.post.c.filter(c=>!c[4])},kids(){const m={};this.post.c.filter(c=>c[4]).forEach(c=>{(m[c[4]]=m[c[4]]||[]).push(c)});return m},replyName(){const c=this.post.c.find(x=>x[3]===this.replyTo);return c?c[0]:''}},
methods:{PH,VU,VP,openLb(i){this.lb=i;this.$nextTick(()=>this.$refs.lbx&&this.$refs.lbx.focus())},step(d){const n=this.post.ph.length;this.lb=(this.lb+d+n)%n},ago,full,setVis(n){if(n===this.post.v)return;api('PATCH','/posts/'+this.post.id,{visibility:n}).then(p=>Object.assign(this.post,map(p))).catch(e=>{alert(e.message);this.$forceUpdate()})},startEdit(){this.etxt=this.post.x;this.editing=true},saveEdit(){const v=this.etxt.trim();if(!v&&!this.post.ph.length&&!this.post.vd){alert('Bài viết không được để trống.');return}if(v===this.post.x){this.editing=false;return}this.busy=true;api('PATCH','/posts/'+this.post.id,{text:v}).then(p=>{Object.assign(this.post,map(p));this.editing=false}).catch(e=>alert(e.message)).finally(()=>{this.busy=false})},react(r){api('POST','/posts/'+this.post.id+'/react',{emoji:r}).then(p=>Object.assign(this.post,map(p))).catch(e=>alert(e.message))},
creact(c,r){api('POST','/posts/'+this.post.id+'/comments/'+c[3]+'/react',{emoji:r}).then(p=>Object.assign(this.post,map(p))).catch(e=>alert(e.message))},
reply(c){this.replyTo=c[3];this.open=true;this.$nextTick(()=>this.$refs.cin&&this.$refs.cin.focus())},cancelRp(){this.replyTo=null},
send(){const v=this.txt.trim();if(!v)return;this.txt='';const rp=this.replyTo;this.replyTo=null;const an=this.anon;this.anon=false;api('POST','/posts/'+this.post.id+'/comments',{text:v,parent:rp||undefined,anonymous:an||undefined}).then(p=>Object.assign(this.post,map(p))).catch(e=>alert(e.message))},
delC(c){if(!confirm('Xóa bình luận này?'))return;api('DELETE','/posts/'+this.post.id+'/comments/'+c[3]).then(p=>Object.assign(this.post,map(p))).catch(e=>alert(e.message))},
reveal(c){if(!confirm('Dùng 1 lượt Chiếu yêu để xem danh tính người này?'))return;api('POST','/magics/reveal/check',{postId:this.post.id,commentId:c[3]}).then(d=>alert('Người bình luận ẩn danh là: '+d.name)).catch(e=>alert(e.message))},
doShare(){const n=this.shNote.trim();api('POST','/shares',{kind:'post',target:this.post.id,note:n,visibility:this.shVis}).then(()=>{this.shOpen=false;this.shNote='';alert('Đã chia sẻ lên tường của bạn.')}).catch(e=>alert(e.message))},
doReport(){const r=this.rpTxt.trim();if(!r){alert('Hãy nhập lý do tố cáo.');return}api('POST','/reports',{kind:'post',target:this.post.id,reason:r}).then(()=>{this.rpOpen=false;this.rpTxt='';alert('Đã gửi tố cáo. Cảm ơn bạn.')}).catch(e=>alert(e.message))}},
template:`<article class="card p-4 pst">
<div class="flex gap-3"><c-av :name="post.n" :src="post.a" :size="46"></c-av><div class="flex-1 min-w-0"><b>{{ post.n }}</b> <c-tick :on="post.t"></c-tick><div class="text-xs text-mute"><time :datetime="post.d" :title="full(post.d)">{{ ago(post.d) }}</time><span v-if="post.e" :title="'Đã chỉnh sửa lúc '+full(post.e)"> · đã chỉnh sửa</span> · <select v-if="post.mine" :value="post.v" class="bg-transparent border border-line rounded px-1 py-0.5 text-xs text-mute" aria-label="Ai xem được bài này" @change="setVis($event.target.value)"><option value="public">Công khai</option><option value="friends">Bạn bè</option><option value="private">Chỉ mình tôi</option></select><span v-else :title="VI[post.v][1]">{{ VI[post.v][0] }}</span></div></div><div v-if="post.mine" class="relative self-start"><button type="button" class="gh !px-2" aria-label="Tùy chọn bài viết" aria-haspopup="menu" :aria-expanded="menu" @click="menu=!menu"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h.01M12 12h.01M19 12h.01"/></svg></button><template v-if="menu"><button type="button" class="fixed inset-0 z-30 cursor-default" tabindex="-1" aria-label="Đóng menu" @click="menu=false"></button><div class="absolute right-0 top-9 z-40 w-40 card p-1" role="menu"><button type="button" role="menuitem" class="mi w-full" @click="menu=false;startEdit()">Sửa bài viết</button><button type="button" role="menuitem" class="mi w-full" style="color:#e5484d" @click="menu=false;$emit('del',post)">Xóa bài viết</button></div></template></div></div>
<div v-if="editing" class="mt-3 space-y-2"><textarea v-mention v-model="etxt" rows="4" maxlength="2000" class="ip resize-none" aria-label="Sửa nội dung bài viết" @keydown.esc="editing=false"></textarea><div class="flex gap-2 justify-end"><button class="btn !bg-transparent !text-mute border border-line" :disabled="busy" @click="editing=false">Hủy</button><button class="btn btn-g" :disabled="busy" @click="saveEdit">{{ busy?'Đang lưu…':'Lưu' }}</button></div></div>
<p v-else-if="post.x" class="mt-3 whitespace-pre-wrap break-words pst-t"><c-tx :t="post.x"/></p>
<p v-if="post.loc&&post.loc.name" class="mt-1 text-sm text-mute">📍 tại {{ post.loc.name }}</p>
<div v-if="post.ph.length" class="mt-3 grid gap-0.5 rounded overflow-hidden" :class="post.ph.length>1?'grid-cols-2':''">
 <button v-for="(u,i) in post.ph.slice(0,4)" :key="u" type="button" class="relative block bg-bg overflow-hidden" :class="[post.ph.length>1?'aspect-[4/3]':'',post.ph.length===3&&i===0?'col-span-2':'']" :aria-label="'Xem ảnh '+(i+1)+' trên '+post.ph.length" @click="openLb(i)">
  <img :src="PH(u,post.ph.length>1?400:800,post.ph.length>1)" alt="" loading="lazy" class="w-full" :class="post.ph.length>1?'h-full object-cover':'max-h-[480px] object-contain mx-auto'">
  <span v-if="i===3&&post.ph.length>4" class="absolute inset-0 grid place-items-center bg-black/55 text-white text-2xl font-semibold">+{{ post.ph.length-4 }}</span>
 </button>
</div>
<div v-if="post.vd&&emb" class="mt-3 relative rounded overflow-hidden bg-black mx-auto" :style="post.vd.site==='tiktok'?'aspect-ratio:9/16;max-width:340px':'aspect-ratio:16/9'">
 <iframe v-if="play" :src="emb" class="absolute inset-0 w-full h-full border-0" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" :title="post.vd.title||'Video'"></iframe>
 <button v-else type="button" class="absolute inset-0 w-full h-full" :aria-label="'Phát video '+(post.vd.title||'')" @click="play=true">
  <img v-if="thumb" :src="thumb" alt="" referrerpolicy="no-referrer" loading="lazy" class="w-full h-full object-cover opacity-90">
  <span class="absolute inset-0 grid place-items-center"><span class="w-14 h-14 rounded-full bg-black/65 text-white text-2xl grid place-items-center pl-1">▶</span></span>
  <span v-if="post.vd.title" class="absolute bottom-0 inset-x-0 p-2 text-left text-white text-sm truncate bg-gradient-to-t from-black/70 to-transparent">{{ post.vd.title }}</span>
 </button>
</div>
<video v-else-if="post.vd&&post.vd.kind==='upload'&&VU(post.vd.url)" class="mt-3 w-full max-h-[480px] rounded bg-black" controls preload="none" playsinline :poster="VP(post.vd.url,800)" :src="raw?post.vd.url:VU(post.vd.url)" @error="raw=true"></video>
<teleport to="body"><div v-if="lb>=0" ref="lbx" tabindex="-1" role="dialog" aria-modal="true" aria-label="Xem ảnh" class="fixed inset-0 z-[1000] bg-black/90 flex items-center justify-center outline-none" @click.self="lb=-1" @keydown.esc="lb=-1" @keydown.left="step(-1)" @keydown.right="step(1)">
 <button type="button" class="absolute top-2 right-4 text-white text-3xl" aria-label="Đóng" @click="lb=-1">✕</button>
 <button v-if="post.ph.length>1" type="button" class="absolute left-1 text-white text-4xl px-3 py-6" aria-label="Ảnh trước" @click="step(-1)">‹</button>
 <img :src="PH(post.ph[lb],1200)" alt="" class="max-w-[96vw] max-h-[90vh] object-contain">
 <button v-if="post.ph.length>1" type="button" class="absolute right-1 text-white text-4xl px-3 py-6" aria-label="Ảnh sau" @click="step(1)">›</button>
 <span class="absolute bottom-3 text-white text-sm">{{ lb+1 }} / {{ post.ph.length }}</span>
</div></teleport>
<div class="flex items-center gap-1 mt-3 pt-2 border-t border-line text-sm pst-a">
 <span class="relative group"><span class="hidden group-hover:flex absolute -top-11 left-0 card px-2 py-1 gap-2 text-xl z-10"><button v-for="r in R" :key="r" @click="react(r)">{{ r }}</button></span>
 <button class="gh" :class="post.k&&'on !shadow-none'" @click="react('👍')">{{ post.k||'👍' }} Thích · {{ post.l+(post.k?1:0) }}</button></span>
 <button class="gh" @click="open=!open">💬 Bình luận · {{ post.c.length }}</button>
 <button class="gh" @click="shOpen=!shOpen" title="Chia sẻ lên tường của bạn">🔁 Chia sẻ</button>
 <button v-if="!post.mine" class="gh" @click="rpOpen=!rpOpen" title="Tố cáo bài viết">⚠️</button>
</div>
<div v-if="shOpen" class="mt-2 card p-3 space-y-2">
 <textarea v-model="shNote" rows="2" maxlength="200" class="ip text-sm resize-none" placeholder="Viết lời bình của bạn (tùy chọn)…" aria-label="Lời bình khi chia sẻ"></textarea>
 <div class="flex items-center gap-2"><select v-model="shVis" class="ip !w-auto text-sm" aria-label="Ai xem được"><option value="public">🌐 Công khai</option><option value="friends">👥 Bạn bè</option><option value="private">🔒 Chỉ mình tôi</option></select>
 <span class="flex-1"></span><button class="btn !bg-transparent border border-line text-sm" @click="shOpen=false">Hủy</button><button class="btn btn-g text-sm" @click="doShare">Chia sẻ</button></div>
</div>
<div v-if="rpOpen" class="mt-2 card p-3 space-y-2">
 <textarea v-model="rpTxt" rows="2" maxlength="300" class="ip text-sm resize-none" placeholder="Lý do tố cáo (vd: spam, nội dung xấu…)…" aria-label="Lý do tố cáo"></textarea>
 <div class="flex gap-2 justify-end"><button class="btn !bg-transparent border border-line text-sm" @click="rpOpen=false">Hủy</button><button class="btn text-sm" style="background:#e5484d;color:#fff" @click="doReport">Gửi tố cáo</button></div>
</div>
<div v-if="open||post.c.length" class="mt-2 space-y-2">
 <template v-for="c in tops" :key="c[3]">
  <div class="flex gap-2"><c-av :name="c[0]" :src="c[2]" :size="36"></c-av><div class="min-w-0 flex-1"><div class="bg-bg rounded-lg px-3 py-1.5 text-sm pst-c"><b>{{ c[0] }}</b> <c-tick :on="c[10]" :size="12"></c-tick> <c-tx :t="c[1]"/></div>
   <div class="flex gap-2 text-xs text-mute mt-0.5 px-1 items-center"><span class="relative group"><span class="hidden group-hover:flex absolute -top-9 left-0 card px-2 py-1 gap-2 text-lg z-10"><button v-for="r in CR" :key="r" type="button" @click="creact(c,r)">{{ r }}</button></span><button class="gh !px-1 !py-0" :class="c[8]&&'on !shadow-none'" @click="creact(c,'👍')">{{ c[8]||'Thích' }}</button></span><span v-if="c[7]+(c[8]?1:0)" class="px-1" :title="(c[7]+(c[8]?1:0))+' lượt cảm xúc'">{{ (c[9]||[]).join('') }} {{ c[7]+(c[8]?1:0) }}</span><button class="gh !px-1 !py-0" @click="reply(c)">Trả lời</button><button v-if="c[5]" class="gh !px-1 !py-0" @click="delC(c)">Xóa</button><button v-if="c[6]" class="gh !px-1 !py-0" @click="reveal(c)" title="Dùng đạo cụ Chiếu yêu">🔍 Chiếu yêu</button></div></div></div>
  <div v-for="k in (kids[c[3]]||[])" :key="k[3]" class="flex gap-2 ml-11"><c-av :name="k[0]" :src="k[2]" :size="30"></c-av><div class="min-w-0 flex-1"><div class="bg-bg rounded-lg px-3 py-1.5 text-sm pst-c"><b>{{ k[0] }}</b> <c-tx :t="k[1]"/></div>
   <div class="flex gap-2 text-xs text-mute mt-0.5 px-1 items-center"><span class="relative group"><span class="hidden group-hover:flex absolute -top-9 left-0 card px-2 py-1 gap-2 text-lg z-10"><button v-for="r in CR" :key="r" type="button" @click="creact(k,r)">{{ r }}</button></span><button class="gh !px-1 !py-0" :class="k[8]&&'on !shadow-none'" @click="creact(k,'👍')">{{ k[8]||'Thích' }}</button></span><span v-if="k[7]+(k[8]?1:0)" class="px-1" :title="(k[7]+(k[8]?1:0))+' lượt cảm xúc'">{{ (k[9]||[]).join('') }} {{ k[7]+(k[8]?1:0) }}</span><button class="gh !px-1 !py-0" @click="reply(c)">Trả lời</button><button v-if="k[5]" class="gh !px-1 !py-0" @click="delC(k)">Xóa</button></div></div></div>
 </template>
 <div v-if="replyTo" class="flex items-center gap-2 text-xs text-mute"><span>↩️ Đang trả lời <b>{{ replyName }}</b></span><button class="gh !px-1 !py-0" @click="cancelRp">Hủy</button></div>
 <div v-if="open" class="flex gap-2 items-center"><input ref="cin" v-mention v-model="txt" @keydown.enter="send" class="ip text-sm pst-in flex-1" placeholder="Viết bình luận, nhấn Enter..."><label class="text-xs text-mute flex items-center gap-1 whitespace-nowrap" title="Dùng đạo cụ Ẩn danh"><input type="checkbox" v-model="anon">🎭 Ẩn danh</label></div>
</div></article>`};


export { CAttach, CAv, CPost, CTick, PH, cloudUp };
