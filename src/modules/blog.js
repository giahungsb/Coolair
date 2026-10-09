import { ago, api } from '../lib/core.js';
/* Component: Nhật ký (blog của UCHome): danh sách -> đọc (+ bình luận) -> viết / sửa. mine = trang của chính mình */
const CBlog={props:{uid:String,mine:Boolean},
data:()=>({list:[],total:0,pg:1,busy:false,busyMore:false,err:'',cur:null,form:null,ctxt:'',clicks:[],ctxtRp:null,hidden:false,
 cats:[],catFilter:'',catMgr:false,newCat:'',impShow:false,impUrl:'',impVis:'private',impBusy:false,
 VI:{public:['🌐','Công khai'],friends:['👥','Bạn bè'],private:['🔒','Chỉ mình tôi']}}),
watch:{uid(){this.cur=null;this.form=null;this.load()}},
created(){this.load();this.loadCats();api('GET','/blogs/clicks').then(d=>{this.clicks=d.clicks}).catch(()=>{})},
computed:{hasMore(){return this.list.length<this.total}},
methods:{ago,
 async run(fn){this.err='';try{await fn()}catch(e){this.err=e.message}},
 load(){this.busy=true;this.pg=1;this.hidden=false;return this.run(async()=>{const d=await api('GET','/users/'+this.uid+'/blogs?page=1'+(this.catFilter?'&cat='+this.catFilter:''));this.list=d.blogs;this.total=d.total;this.hidden=!!d.hidden}).finally(()=>this.busy=false)},
 loadCats(){api('GET','/blog-cats?user='+this.uid).then(d=>{this.cats=d.cats}).catch(()=>{})},
 catName(id){const c=this.cats.find(x=>x.id===id);return c?c.name:''},
 sugTags(){const f=this.form;if(!f.title.trim()&&!f.text.trim())return;this.run(async()=>{const d=await api('GET','/blogs/suggest-tags?title='+encodeURIComponent(f.title)+'&text='+encodeURIComponent(f.text.slice(0,2000)));const cur=new Set(f.tags.split(/[\s,]+/).filter(Boolean));d.tags.forEach(t=>cur.add(t));f.tags=[...cur].slice(0,5).join(' ')})},
 setCatFilter(id){this.catFilter=id;this.load()},
 addCat(){const n=this.newCat.trim();if(n.length<2){this.err='Tên chuyên mục cần ít nhất 2 ký tự.';return}this.run(async()=>{const d=await api('POST','/blog-cats',{name:n});this.cats.push(d.cat);this.cats.sort((a,b)=>a.name.localeCompare(b.name));this.newCat=''})},
 renCat(c){const n=prompt('Đổi tên chuyên mục:',c.name);if(!n||!n.trim()||n.trim()===c.name)return;this.run(async()=>{await api('PATCH','/blog-cats/'+c.id,{name:n.trim()});c.name=n.trim()})},
 doImport(){const u=this.impUrl.trim();if(!/^https?:\/\//i.test(u)){this.err='URL RSS không hợp lệ.';return}this.impBusy=true;
  return this.run(async()=>{const d=await api('POST','/import/rss',{url:u,visibility:this.impVis});this.impUrl='';this.impShow=false;this.loadCats();await this.load();alert('Đã nhập '+d.imported+' bài viết'+(d.skipped?' ('+d.skipped+' bài trùng/bỏ qua)':'')+'.')}).finally(()=>this.impBusy=false)},
 delCat(c){if(!confirm('Xóa chuyên mục "'+c.name+'"? Nhật ký trong đó sẽ về "Chưa phân loại".'))return;this.run(async()=>{await api('DELETE','/blog-cats/'+c.id);this.cats=this.cats.filter(x=>x.id!==c.id);if(this.catFilter===c.id)this.setCatFilter('')})},
 more(){if(this.busyMore)return;this.busyMore=true;return this.run(async()=>{const d=await api('GET','/users/'+this.uid+'/blogs?page='+(this.pg+1)+(this.catFilter?'&cat='+this.catFilter:''));this.pg++;this.total=d.total;const have=new Set(this.list.map(b=>b.id));this.list.push(...d.blogs.filter(b=>!have.has(b.id)))}).finally(()=>this.busyMore=false)},
 open(id){this.busy=true;this.form=null;return this.run(async()=>{this.cur=(await api('GET','/blogs/'+id)).blog;this.ctxt=''}).finally(()=>this.busy=false)},
 back(){this.cur=null;this.form=null;this.load()},
 write(b){this.err='';this.form=b?{id:b.id,title:b.title,text:b.text,visibility:b.visibility,tags:(b.tags||[]).join(' '),cat:b.cat?b.cat.id:''}:{id:'',title:'',text:'',visibility:'public',tags:'',cat:''}},
 save(){const f=this.form;if(!f.title.trim()||!f.text.trim()){this.err='Hãy nhập tiêu đề và nội dung.';return}this.busy=true;
  const tags=f.tags.split(/[\s,]+/).filter(Boolean).slice(0,5);
  return this.run(async()=>{const d=await api(f.id?'PATCH':'POST',f.id?'/blogs/'+f.id:'/blogs',{title:f.title,text:f.text,visibility:f.visibility,tags,cat:f.cat||''});this.form=null;this.cur=d.blog;this.loadCats()}).finally(()=>this.busy=false)},
 del(){if(!confirm('Xóa nhật ký này? Bình luận cũng sẽ bị xóa.'))return;this.run(async()=>{await api('DELETE','/blogs/'+this.cur.id);this.cur=null;await this.load()})},
 send(){const t=this.ctxt.trim();if(!t)return;this.run(async()=>{this.cur=(await api('POST','/blogs/'+this.cur.id+'/comments',{text:t,parent:this.ctxtRp||undefined})).blog;this.ctxt='';this.ctxtRp=null})},
 click(i){this.run(async()=>{const d=await api('POST','/blogs/'+this.cur.id+'/click',{clickId:i});this.cur.clickNums=d.clickNums;this.cur.myClick=d.myClick})},
 replyC(c){this.ctxtRp=c.id},cancelRp(){this.ctxtRp=null},
 tops(){return (this.cur?.comments||[]).filter(c=>!c.parent)},kids(id){return (this.cur?.comments||[]).filter(c=>c.parent===id)},
 delC(c){this.run(async()=>{this.cur=(await api('DELETE','/blogs/'+this.cur.id+'/comments/'+c.id)).blog})}},
template:`<div class="space-y-3">
 <p v-if="err" class="text-sm" style="color:#d64545" role="alert">{{ err }}</p>
 <div v-if="busy&&!list.length&&!cur&&!form" class="card p-4 text-sm text-mute">Đang tải…</div>
 <form v-else-if="form" class="card p-4 space-y-3" @submit.prevent="save">
  <input v-model="form.title" class="ip" maxlength="80" placeholder="Tiêu đề nhật ký" aria-label="Tiêu đề">
  <textarea v-model="form.text" rows="10" maxlength="6000" class="ip resize-y" placeholder="Hôm nay bạn muốn viết gì?" aria-label="Nội dung"></textarea>
  <div class="flex gap-2"><input v-model="form.tags" class="ip text-sm flex-1" maxlength="120" placeholder="Tag: cách nhau bằng dấu cách hoặc dấu phẩy (tối đa 5)" aria-label="Tag"><button type="button" class="btn !h-10 text-sm !bg-transparent border border-line whitespace-nowrap" @click="sugTags" title="Gợi ý tag từ tiêu đề và nội dung">✨ Gợi ý</button></div>
  <select v-model="form.cat" class="ip text-sm" aria-label="Chuyên mục"><option value="">— Chưa phân loại —</option><option v-for="c in cats" :key="c.id" :value="c.id">{{ c.name }}</option></select>
  <div class="flex items-center gap-2 flex-wrap"><select v-model="form.visibility" class="ip !w-auto text-sm" aria-label="Ai xem được"><option v-for="(v,k) in VI" :key="k" :value="k">{{ v[0] }} {{ v[1] }}</option></select><span class="text-xs text-mute">{{ form.text.length }}/6000</span>
   <button type="button" class="btn !bg-transparent border border-line ml-auto" @click="form=null">Hủy</button><button class="btn btn-g" :disabled="busy">{{ form.id?'Lưu thay đổi':'Đăng nhật ký' }}</button></div>
 </form>
 <template v-else-if="cur">
  <button class="gh" @click="back">« Danh sách nhật ký</button>
  <article class="card p-4 space-y-3">
   <h2 class="!m-0 text-lg font-bold break-words">{{ cur.title }}</h2>
   <div class="text-xs text-mute">{{ cur.owner&&cur.owner.name }} · {{ ago(cur.createdAt) }} · {{ VI[cur.visibility][0] }} · 👁 {{ cur.viewNum }}<span v-if="cur.cat"> · 📁 {{ cur.cat.name }}</span><span v-if="cur.updatedAt!==cur.createdAt"> · đã sửa</span></div>
   <div class="whitespace-pre-wrap break-words leading-relaxed">{{ cur.text }}</div>
   <div v-if="cur.tags&&cur.tags.length" class="flex gap-1 flex-wrap"><button v-for="t in cur.tags" :key="t" class="text-xs px-2 py-0.5 rounded-full bg-bg text-mute hover:underline" @click="$root.openTag(t)">#{{ t }}</button></div>
   <div v-if="clicks.length" class="flex gap-1 flex-wrap items-center pt-1 border-t border-line">
    <button v-for="(n,i) in clicks" :key="i" class="gh !px-2 text-sm" :class="cur.myClick===i&&'on !shadow-none'" :title="n" @click="click(i)">{{ n }} <b>{{ (cur.clickNums||[])[i]||0 }}</b></button>
   </div>
   <div v-if="cur.mine" class="flex gap-2"><button class="btn !bg-transparent border border-line" @click="write(cur)">✏️ Sửa</button><button class="btn !bg-transparent border border-line" @click="del">🗑️ Xóa</button></div>
  </article>
  <div class="card p-4 space-y-3">
   <b class="text-sm">Bình luận ({{ cur.commentNum }})</b>
   <template v-for="c in tops()" :key="c.id">
    <div class="flex gap-2 items-start"><c-av :name="c.name" :src="c.av" :size="32"></c-av><div class="min-w-0 flex-1"><div class="text-sm"><b>{{ c.name }}</b> <span class="text-xs text-mute">{{ ago(c.createdAt) }}</span></div><div class="text-sm whitespace-pre-wrap break-words"><c-tx :t="c.text"/></div>
     <div class="flex gap-2 text-xs text-mute mt-0.5"><button class="gh !px-1 !py-0" @click="replyC(c)">Trả lời</button><button v-if="c.canDel" class="gh !px-1 !py-0" @click="delC(c)">Xóa</button></div></div></div>
    <div v-for="k in kids(c.id)" :key="k.id" class="flex gap-2 items-start ml-10"><c-av :name="k.name" :src="k.av" :size="28"></c-av><div class="min-w-0 flex-1"><div class="text-sm"><b>{{ k.name }}</b> <span class="text-xs text-mute">{{ ago(k.createdAt) }}</span></div><div class="text-sm whitespace-pre-wrap break-words">{{ k.text }}</div>
     <div class="flex gap-2 text-xs text-mute mt-0.5"><button v-if="k.canDel" class="gh !px-1 !py-0" @click="delC(k)">Xóa</button></div></div></div>
   </template>
   <div v-if="ctxtRp" class="text-xs text-mute">↩️ Đang trả lời bình luận <button class="gh !px-1 !py-0" @click="cancelRp">Hủy</button></div>
   <div class="flex gap-2"><input v-model="ctxt" class="ip" maxlength="500" placeholder="Viết bình luận…" aria-label="Bình luận" @keyup.enter="send"><button class="btn btn-g" @click="send">Gửi</button></div>
  </div>
 </template>
 <template v-else>
  <div v-if="hidden" class="card p-4 text-sm text-mute">🔒 Chủ trang đã đặt nhật ký ở chế độ riêng tư.</div>
  <div class="flex items-center gap-2 flex-wrap"><button v-if="mine" class="btn btn-g" @click="write()">＋ Viết nhật ký</button><a :href="'/api/rss/user/'+uid+'.xml'" target="_blank" rel="noopener" class="gh text-xs" title="Đăng ký RSS nhật ký của trang này">📡 RSS</a></div>
  <div class="flex gap-1 flex-wrap items-center">
   <button class="btn !py-1 text-xs" :class="!catFilter?'btn-g':'!bg-transparent border border-line'" @click="setCatFilter('')">Tất cả</button>
   <button v-for="c in cats" :key="c.id" class="btn !py-1 text-xs" :class="catFilter===c.id?'btn-g':'!bg-transparent border border-line'" @click="setCatFilter(c.id)">📁 {{ c.name }} ({{ c.count }})</button>
   <button v-if="mine" class="gh text-xs" @click="catMgr=!catMgr">{{ catMgr?'Đóng':'⚙️ Chuyên mục' }}</button>
  </div>
  <div v-if="mine&&catMgr" class="card p-3 space-y-2">
   <div class="flex gap-2"><input v-model="newCat" class="ip text-sm" maxlength="40" placeholder="Tên chuyên mục mới…" aria-label="Tên chuyên mục" @keyup.enter="addCat"><button class="btn btn-g text-sm" @click="addCat">Thêm</button></div>
   <div v-for="c in cats" :key="c.id" class="flex items-center gap-2 text-sm"><b class="flex-1">📁 {{ c.name }}</b><span class="text-xs text-mute">{{ c.count }} bài</span><button class="gh text-xs" @click="renCat(c)">Đổi tên</button><button class="gh text-xs" @click="delCat(c)">Xóa</button></div>
  </div>
  <div class="flex gap-1 flex-wrap items-center">
   <button v-if="mine" class="gh text-xs" @click="impShow=!impShow">{{ impShow?'Đóng':'📥 Nhập từ RSS' }}</button>
  </div>
  <div v-if="mine&&impShow" class="card p-3 space-y-2">
   <p class="text-xs text-mute">Dán URL nguồn RSS/Atom (vd: blog cá nhân, báo mạng). Hệ thống nhập tối đa 20 bài mới nhất, bỏ qua bài trùng tiêu đề.</p>
   <div class="flex gap-2"><input v-model="impUrl" class="ip text-sm flex-1" placeholder="https://…/rss.xml" aria-label="URL RSS" @keyup.enter="doImport">
   <select v-model="impVis" class="ip !w-auto text-sm" aria-label="Chế độ xem"><option value="private">🔒 Chỉ mình tôi</option><option value="friends">👥 Bạn bè</option><option value="public">🌐 Công khai</option></select>
   <button class="btn btn-g text-sm" :disabled="impBusy" @click="doImport">{{ impBusy?'Đang nhập…':'Nhập' }}</button></div>
  </div>
  <div v-if="!list.length" class="card p-4 text-sm text-mute">{{ mine?'Bạn chưa viết nhật ký nào.':'Chưa có nhật ký nào.' }}</div>
  <button v-for="b in list" :key="b.id" class="uc-row w-full text-left block" @click="open(b.id)">
   <b class="block break-words">{{ b.title }}</b><span class="block text-sm text-mute break-words">{{ b.excerpt }}</span>
   <span class="block text-xs text-mute mt-1"><span v-if="b.cat">📁 {{ b.cat.name }} · </span>{{ ago(b.createdAt) }} · {{ VI[b.visibility][0] }} · 👁 {{ b.viewNum }} · 💬 {{ b.commentNum }}</span>
  </button>
  <button v-if="hasMore" class="btn w-full !bg-transparent border border-line" :disabled="busyMore" @click="more">{{ busyMore?'Đang tải…':'Xem thêm nhật ký' }}</button>
 </template>
</div>`};


export { CBlog };
