import { PH, cloudUp } from './post.js';
import { ago, api } from '../lib/core.js';
/* Component: Album (danh sách album -> ảnh -> khung xem ảnh có cảm xúc + bình luận). mine = trang của chính mình (được tạo / sửa / xóa / chuyển ảnh) */
const CAlbum={props:{uid:String,mine:Boolean,jump:Object},emits:['jumped'],
data:()=>({list:[],total:0,pg:1,cur:null,more:false,busy:false,busyMore:false,err:'',up:{n:0,done:0},form:false,t:'',v:'public',lb:-1,d:null,dBusy:false,ctxt:'',sel:null,dlg:null,
 EM:['👍','😍','😂','😮','😢'],VI:{public:['🌐','Công khai'],friends:['👥','Bạn bè'],private:['🔒','Chỉ mình tôi']}}),
watch:{jump(){this.goJump()},uid(){this.cur=null;this.lb=-1;this.sel=null;this.dlg=null;this.load()},lb(){this.d=null;this.ctxt='';if(this.ph)this.detail()}},
created(){this.load().then(()=>this.goJump())},
computed:{ph(){return this.cur&&this.lb>=0?this.cur.photos[this.lb]||null:null},hasMore(){return this.list.length<this.total}},
methods:{PH,ago,
 async goJump(){const j=this.jump;if(!j||!j.a)return;await this.open(j.a);const i=this.cur?this.cur.photos.findIndex(x=>x.id===j.p):-1;if(i>=0)this.lb=i;this.$emit('jumped')},   // mở thẳng ảnh từ thông báo
 async run(fn){this.err='';try{await fn()}catch(e){this.err=e.message}},
 /* --- danh sách album (phân trang: "Xem thêm album") --- */
 load(){this.busy=true;this.pg=1;return this.run(async()=>{const d=await api('GET','/users/'+this.uid+'/albums?page=1');this.list=d.albums;this.total=d.total}).finally(()=>this.busy=false)},
 loadMoreAlbums(){if(this.busyMore)return;this.busyMore=true;return this.run(async()=>{const d=await api('GET','/users/'+this.uid+'/albums?page='+(this.pg+1));this.pg++;this.total=d.total;const have=new Set(this.list.map(a=>a.id));this.list.push(...d.albums.filter(a=>!have.has(a.id)))}).finally(()=>this.busyMore=false)},
 open(id){this.busy=true;this.sel=null;this.dlg=null;return this.run(async()=>{const d=await api('GET','/albums/'+id);this.cur={album:d.album,photos:d.photos};this.more=d.more}).finally(()=>this.busy=false)},
 /* --- ảnh trong album (phân trang: "Xem thêm ảnh" theo con trỏ _id) --- */
 async loadMorePhotos(){if(this.busyMore||!this.more||!this.cur)return;this.busyMore=true;const id=this.cur.album.id,ps=this.cur.photos;await this.run(async()=>{const d=await api('GET','/albums/'+id+'?before='+ps[ps.length-1].id);if(!this.cur||this.cur.album.id!==id)return;const have=new Set(ps.map(p=>p.id));ps.push(...d.photos.filter(p=>!have.has(p.id)));this.more=d.more});this.busyMore=false},
 back(){this.cur=null;this.lb=-1;this.sel=null;this.dlg=null;this.load()},
 create(){const t=this.t.trim();if(!t){this.err='Hãy nhập tên album.';return}this.run(async()=>{const d=await api('POST','/albums',{title:t,visibility:this.v});this.form=false;this.t='';this.list.unshift(d.album);this.total++;await this.open(d.album.id)})},
 sync(a){if(a&&this.cur&&a.id===this.cur.album.id)Object.assign(this.cur.album,a)},
 rename(){const t=prompt('Tên album mới:',this.cur.album.title);if(t===null||!t.trim())return;this.run(async()=>this.sync((await api('PATCH','/albums/'+this.cur.album.id,{title:t})).album))},
 setVis(e){this.run(async()=>this.sync((await api('PATCH','/albums/'+this.cur.album.id,{visibility:e.target.value})).album))},
 /* --- xóa album: xóa luôn ảnh, hoặc chuyển ảnh sang album khác (như UCHome) --- */
 async targets(){const d=await api('GET','/users/'+this.uid+'/albums?per=50');return d.albums.filter(a=>a.id!==this.cur.album.id)},
 delAlbum(){this.run(async()=>{const ts=await this.targets();this.dlg={k:'del',ts,to:''}})},
 doDelAlbum(){const a=this.cur.album,to=this.dlg.to;if(!confirm(to?'Chuyển ảnh sang album đã chọn rồi xóa album “'+a.title+'”?':'Xóa album “'+a.title+'” và toàn bộ '+a.photoNum+' ảnh trong đó?'))return;this.run(async()=>{await api('DELETE','/albums/'+a.id+(to?'?moveTo='+to:''));this.dlg=null;this.back()})},
 /* --- tải ảnh lên --- */
 async add(ev){const fs=[...ev.target.files].slice(0,10);ev.target.value='';if(!fs.length||this.up.n)return;this.err='';this.up={n:fs.length,done:0};const bad=[],id=this.cur.album.id;
  for(const f of fs){try{const url=await cloudUp('album',f),d=await api('POST','/albums/'+id+'/photos',{url});if(this.cur&&this.cur.album.id===id){this.cur.photos.unshift(d.photo);this.sync(d.album)}}catch(e){bad.push(f.name+': '+e.message)}this.up.done++}
  this.up={n:0,done:0};if(bad.length)this.err=bad.join(' · ')},
 /* --- chọn nhiều ảnh: chuyển / xóa --- */
 toggleSel(){this.sel=this.sel?null:[];this.dlg=null},
 pick(p){const i=this.sel.indexOf(p.id);i<0?this.sel.push(p.id):this.sel.splice(i,1)},
 selMove(){if(!this.sel.length)return;this.run(async()=>{const ts=await this.targets();if(!ts.length){this.err='Bạn chưa có album nào khác. Hãy tạo album mới trước.';return}this.dlg={k:'move',ts,to:ts[0].id}})},
 doMove(){const id=this.cur.album.id,to=this.dlg.to;this.run(async()=>{const d=await api('POST','/albums/'+id+'/move',{ids:this.sel,to});this.cur.photos=this.cur.photos.filter(p=>!d.moved.includes(p.id));this.sync(d.album);this.sel=null;this.dlg=null;if(this.more&&this.cur.photos.length<8)this.loadMorePhotos()})},
 selDel(){if(!this.sel.length||!confirm('Xóa '+this.sel.length+' ảnh đã chọn?'))return;const id=this.cur.album.id;this.run(async()=>{const d=await api('POST','/albums/'+id+'/photos/delete',{ids:this.sel});this.cur.photos=this.cur.photos.filter(p=>!d.deleted.includes(p.id));this.sync(d.album);this.sel=null})},
 /* --- khung xem ảnh --- */
 cover(p){this.run(async()=>this.sync((await api('PATCH','/albums/'+this.cur.album.id,{cover:p.id})).album))},
 caption(p){const t=prompt('Chú thích ảnh (tối đa 100 ký tự):',p.caption);if(t===null)return;this.run(async()=>{p.caption=(await api('PATCH','/photos/'+p.id,{caption:t})).photo.caption})},
 delPhoto(p){if(!confirm('Xóa ảnh này?'))return;this.run(async()=>{const d=await api('DELETE','/photos/'+p.id),i=this.cur.photos.indexOf(p);this.cur.photos.splice(i,1);this.sync(d.album);this.lb=this.cur.photos.length?Math.min(i,this.cur.photos.length-1):-1})},
 show(i){if(this.sel){this.pick(this.cur.photos[i]);return}this.lb=i;this.$nextTick(()=>this.$refs.lb&&this.$refs.lb.focus())},
 async step(n){const len=this.cur.photos.length;if(len<2&&!this.more)return;if(n>0&&this.lb===len-1&&this.more){await this.loadMorePhotos();if(this.cur.photos.length>len){this.lb=len;return}}this.lb=(this.lb+n+this.cur.photos.length)%this.cur.photos.length},
 key(e){if(/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))return;if(e.key==='Escape')this.lb=-1;else if(e.key==='ArrowLeft')this.step(-1);else if(e.key==='ArrowRight')this.step(1)},
 /* --- cảm xúc + bình luận (tải khi mở ảnh; bỏ kết quả cũ nếu đã chuyển sang ảnh khác) --- */
 async detail(){const p=this.ph;if(!p)return;this.dBusy=true;try{const d=(await api('GET','/photos/'+p.id)).photo;if(this.ph&&this.ph.id===p.id)this.d=d}catch(e){if(this.ph&&this.ph.id===p.id)this.err=e.message}finally{this.dBusy=false}},
 apply(d){if(!this.ph||this.ph.id!==d.id)return;this.d=d;this.ph.likes=d.likes+(d.reaction?1:0);this.ph.comments=d.comments.length},
 react(e){const p=this.ph;if(!p||!this.d)return;this.run(async()=>this.apply((await api('POST','/photos/'+p.id+'/reaction',{emoji:e})).photo))},
 send(){const t=this.ctxt.trim(),p=this.ph;if(!t||!p||!this.d)return;this.run(async()=>{const d=(await api('POST','/photos/'+p.id+'/comments',{text:t})).photo;this.ctxt='';this.apply(d)})},
 delC(c){if(!confirm('Xóa bình luận này?'))return;const p=this.ph;this.run(async()=>this.apply((await api('DELETE','/photos/'+p.id+'/comments/'+c.id)).photo))}},
template:`<div class="space-y-3 min-w-0">
<p v-if="err" class="borderbox text-sm" style="color:#d64545" role="alert">{{ err }}</p>
<template v-if="!cur">
 <div v-if="mine" class="flex items-center gap-2 flex-wrap"><button class="btn btn-g" @click="form=!form">＋ Tạo album</button></div>
 <form v-if="mine&&form" class="card p-3 flex gap-2 flex-wrap items-center" @submit.prevent="create"><input v-model="t" maxlength="50" class="ip flex-1 min-w-[160px]" placeholder="Tên album (tối đa 50 ký tự)" aria-label="Tên album"><select v-model="v" class="ip !w-auto" aria-label="Quyền riêng tư"><option v-for="(x,k) in VI" :key="k" :value="k">{{ x[0] }} {{ x[1] }}</option></select><button class="btn">Tạo</button></form>
 <div v-if="busy&&!list.length" class="card p-6 text-center text-mute">Đang tải…</div>
 <div v-else-if="!list.length" class="card p-6 text-center text-mute">{{ mine?'Bạn chưa có album nào. Bấm “Tạo album” để bắt đầu.':'Chưa có album nào để xem.' }}</div>
 <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
  <button v-for="a in list" :key="a.id" class="card overflow-hidden text-left" @click="open(a.id)">
   <span class="block aspect-square bg-bg"><img v-if="a.cover" :src="PH(a.cover,240,true)" alt="" loading="lazy" referrerpolicy="no-referrer" class="w-full h-full object-cover"><span v-else class="grid place-items-center w-full h-full text-3xl text-mute">🖼️</span></span>
   <span class="block p-2"><b class="block truncate">{{ a.title }}</b><small class="text-mute">{{ a.photoNum }} ảnh<template v-if="mine"> · {{ VI[a.visibility][0] }}</template></small></span>
  </button>
 </div>
 <button v-if="hasMore" class="btn w-full !bg-card !text-zb2 border border-line" :disabled="busyMore" @click="loadMoreAlbums">{{ busyMore?'Đang tải…':'Xem thêm album ('+(total-list.length)+')' }}</button>
</template>
<template v-else>
 <div class="flex items-center gap-2 flex-wrap"><button class="gh" @click="back">« Tất cả album</button><b class="truncate">{{ cur.album.title }}</b><small class="text-mute">{{ cur.album.photoNum }} ảnh</small></div>
 <div v-if="cur.album.mine" class="card p-3 flex gap-2 flex-wrap items-center">
  <label class="btn btn-g cursor-pointer" :class="{'opacity-60 pointer-events-none':up.n}"><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple class="sr-only" @change="add">{{ up.n?'Đang tải '+(up.done+1>up.n?up.n:up.done+1)+'/'+up.n+'…':'＋ Thêm ảnh' }}</label>
  <select :value="cur.album.visibility" class="ip !w-auto" aria-label="Quyền riêng tư" @change="setVis"><option v-for="(x,k) in VI" :key="k" :value="k">{{ x[0] }} {{ x[1] }}</option></select>
  <button class="gh" :class="{on:sel}" @click="toggleSel">☑️ {{ sel?'Thôi chọn':'Chọn ảnh' }}</button>
  <button class="gh" @click="rename">✏️ Đổi tên</button><button class="gh !text-[#d64545]" @click="delAlbum">🗑️ Xóa album</button>
  <small class="text-mute w-full">Chọn tối đa 10 ảnh một lượt, mỗi ảnh ≤ 5MB (JPG, PNG, WEBP, GIF).</small>
 </div>
 <div v-if="dlg&&dlg.k==='del'" class="card p-3 space-y-2" role="group" aria-label="Xóa album">
  <b>Xóa album “{{ cur.album.title }}”</b>
  <label class="block text-sm">Ảnh trong album ({{ cur.album.photoNum }}):<select v-model="dlg.to" class="ip mt-1"><option value="">🗑️ Xóa luôn tất cả ảnh</option><option v-for="a in dlg.ts" :key="a.id" :value="a.id">Chuyển sang “{{ a.title }}”</option></select></label>
  <div class="flex gap-2 justify-end"><button class="btn !bg-transparent !text-mute border border-line" @click="dlg=null">Hủy</button><button class="btn" style="background:#d64545" @click="doDelAlbum">Xóa album</button></div>
 </div>
 <div v-if="sel" class="card p-3 flex gap-2 flex-wrap items-center">
  <b class="text-sm">Đã chọn {{ sel.length }} ảnh</b>
  <button class="gh" @click="sel=cur.photos.map(p=>p.id)">Chọn hết</button>
  <button class="gh" :disabled="!sel.length" @click="selMove">📂 Chuyển sang album…</button><button class="gh !text-[#d64545]" :disabled="!sel.length" @click="selDel">🗑️ Xóa</button>
  <div v-if="dlg&&dlg.k==='move'" class="w-full flex gap-2 items-center flex-wrap"><select v-model="dlg.to" class="ip flex-1 min-w-[150px]" aria-label="Album đích"><option v-for="a in dlg.ts" :key="a.id" :value="a.id">{{ a.title }} ({{ a.photoNum }})</option></select><button class="btn btn-g" @click="doMove">Chuyển</button><button class="gh" @click="dlg=null">Hủy</button></div>
 </div>
 <div v-if="busy" class="card p-6 text-center text-mute">Đang tải…</div>
 <div v-else-if="!cur.photos.length" class="card p-6 text-center text-mute">Album này chưa có ảnh.</div>
 <div class="grid grid-cols-3 sm:grid-cols-4 gap-2">
  <button v-for="(p,i) in cur.photos" :key="p.id" class="relative aspect-square bg-bg overflow-hidden rounded" :class="{'ring-2 ring-zb2':sel&&sel.includes(p.id)}" :aria-label="p.caption||('Ảnh '+(i+1))" :aria-pressed="sel?sel.includes(p.id):undefined" @click="show(i)">
   <img :src="PH(p.url,200,true)" alt="" loading="lazy" referrerpolicy="no-referrer" class="w-full h-full object-cover" :class="{'opacity-60':sel&&sel.includes(p.id)}">
   <i v-if="p.url===cur.album.cover" class="absolute left-1 top-1 not-italic text-xs px-1 rounded bg-black/60 text-white">Bìa</i>
   <i v-if="sel" class="absolute right-1 top-1 not-italic w-5 h-5 rounded-full grid place-items-center text-xs text-white border border-white" :style="{background:sel.includes(p.id)?'var(--zb2)':'rgba(0,0,0,.4)'}">{{ sel.includes(p.id)?'✓':'' }}</i>
   <i v-if="p.likes||p.comments" class="absolute left-1 bottom-1 not-italic text-xs px-1 rounded bg-black/60 text-white"><template v-if="p.likes">👍{{ p.likes }} </template><template v-if="p.comments">💬{{ p.comments }}</template></i>
  </button>
 </div>
 <button v-if="more" class="btn w-full !bg-card !text-zb2 border border-line" :disabled="busyMore" @click="loadMorePhotos">{{ busyMore?'Đang tải…':'Xem thêm ảnh' }}</button>
</template>
<div v-if="ph" ref="lb" tabindex="0" class="fixed inset-0 z-[120] bg-black/90 flex flex-col" role="dialog" aria-modal="true" @keydown="key">
 <div class="flex items-center gap-2 p-3 text-white text-sm"><span>{{ lb+1 }}{{ more?'+':'/'+cur.photos.length }}</span><span class="flex-1 truncate">{{ ph.caption }}</span>
  <template v-if="cur.album.mine"><button class="gh !text-white" @click="caption(ph)">✏️</button><button v-if="ph.url!==cur.album.cover" class="gh !text-white" @click="cover(ph)">🖼️ Bìa</button><button class="gh !text-white" @click="delPhoto(ph)">🗑️</button></template>
  <button class="gh !text-white text-xl" aria-label="Đóng" @click="lb=-1">✕</button></div>
 <div class="flex-1 min-h-0 flex items-center justify-center gap-2 px-2 pb-2">
  <button v-if="cur.photos.length>1||more" class="gh !text-white text-2xl" aria-label="Ảnh trước" @click="step(-1)">‹</button>
  <img :src="PH(ph.url,900)" :alt="ph.caption" referrerpolicy="no-referrer" class="max-w-full max-h-full object-contain min-w-0">
  <button v-if="cur.photos.length>1||more" class="gh !text-white text-2xl" aria-label="Ảnh sau" @click="step(1)">›</button></div>
 <div class="bg-card text-ink max-h-[42%] overflow-y-auto p-3 space-y-2 text-sm">
  <div class="flex items-center gap-1 flex-wrap">
   <button v-for="e in EM" :key="e" class="gh !px-2 text-lg" :class="d&&d.reaction===e&&'on !shadow-none'" :disabled="!d" :aria-label="'Cảm xúc '+e" :aria-pressed="d?d.reaction===e:false" @click="react(e)">{{ e }}</button>
   <span class="text-mute ml-1">{{ d?d.likes+(d.reaction?1:0):ph.likes }} lượt thích · {{ d?d.comments.length:ph.comments }} bình luận</span></div>
  <p v-if="dBusy&&!d" class="text-mute">Đang tải bình luận…</p>
  <div v-for="c in (d?d.comments:[])" :key="c.id" class="flex gap-2"><c-av :name="c.name" :src="c.av" :size="28"></c-av>
   <div class="bg-bg rounded-lg px-3 py-1.5 min-w-0 flex-1"><b>{{ c.name }}</b> <small class="text-mute">{{ ago(c.createdAt) }}</small><button v-if="c.canDel" class="float-right text-mute" aria-label="Xóa bình luận" @click="delC(c)">✕</button><div class="whitespace-pre-wrap break-words"><c-tx :t="c.text"/></div></div></div>
  <input v-model="ctxt" :disabled="!d" maxlength="500" class="ip text-sm" placeholder="Viết bình luận, nhấn Enter..." aria-label="Bình luận" @keydown.enter.prevent="send">
 </div>
</div>
</div>`};


export { CAlbum };
