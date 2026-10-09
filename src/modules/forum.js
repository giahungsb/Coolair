import { ago, api } from '../lib/core.js';
import { fdt } from './events-polls.js';
/* Component: Diễn đàn độc lập (port module forum của phpFox) – chuyên mục -> box -> chủ đề -> trả lời */
const CForum={props:{open:String},emits:['used'],
data:()=>({page:'cats',cats:[],forum:null,threads:[],total:0,pg:1,thread:null,posts:[],ptotal:0,ppg:1,
 tform:null,rtext:'',busy:false,busyMore:false,err:''}),
created(){if(this.open){const id=this.open;this.$emit('used');this.showThread(id)}else this.loadCats()},
computed:{hasMore(){return this.threads.length<this.total},pHasMore(){return this.posts.length<this.ptotal}},
methods:{ago,fdt,
 async run(fn){this.err='';try{await fn()}catch(e){this.err=e.message}},
 loadCats(){this.busy=true;this.page='cats';return this.run(async()=>{this.cats=(await api('GET','/forums')).cats}).finally(()=>this.busy=false)},
 openForum(id){this.busy=true;this.pg=1;return this.run(async()=>{const d=await api('GET','/forums/'+id+'?page=1');this.forum=d.forum;this.threads=d.threads;this.total=d.total;this.page='forum'}).finally(()=>this.busy=false)},
 moreForum(){if(this.busyMore)return;this.busyMore=true;return this.run(async()=>{const d=await api('GET','/forums/'+this.forum.id+'?page='+(this.pg+1));this.pg++;this.total=d.total;const h=new Set(this.threads.map(t=>t.id));this.threads.push(...d.threads.filter(t=>!h.has(t.id)))}).finally(()=>this.busyMore=false)},
 showThread(id){this.busy=true;this.ppg=1;return this.run(async()=>{const d=await api('GET','/forums/threads/'+id+'?page=1');this.thread=d.thread;this.posts=d.posts;this.ptotal=d.total;this.page='thread'}).finally(()=>this.busy=false)},
 morePosts(){if(this.busyMore)return;this.busyMore=true;return this.run(async()=>{const d=await api('GET','/forums/threads/'+this.thread.id+'?page='+(this.ppg+1));this.ppg++;this.ptotal=d.total;const h=new Set(this.posts.map(p=>p.id));this.posts.push(...d.posts.filter(p=>!h.has(p.id)))}).finally(()=>this.busyMore=false)},
 back(){if(this.page==='thread'&&this.forum)this.openForum(this.forum.id);else{this.thread=null;this.forum=null;this.loadCats()}},
 write(){this.tform={title:'',text:''}},
 saveThread(){const f=this.tform;if(!f.title.trim()||!f.text.trim()){this.err='Nhập tiêu đề và nội dung.';return}
  this.busy=true;return this.run(async()=>{const d=await api('POST','/forums/'+this.forum.id+'/threads',{title:f.title,text:f.text});this.tform=null;await this.showThread(d.thread.id)}).finally(()=>this.busy=false)},
 reply(){if(!this.rtext.trim())return;this.run(async()=>{await api('POST','/forums/threads/'+this.thread.id+'/posts',{text:this.rtext});this.rtext='';const d=await api('GET','/forums/threads/'+this.thread.id+'?page='+this.ppg);this.posts=d.posts;this.ptotal=d.total;this.thread.replyNum=d.thread.replyNum})},
 togSub(){const t=this.thread;this.run(async()=>{const d=t.subbed?await api('DELETE','/forums/threads/'+t.id+'/sub'):await api('POST','/forums/threads/'+t.id+'/sub');t.subbed=d.subbed})},
 togSubF(){const f=this.forum;this.run(async()=>{const d=f.subbed?await api('DELETE','/forums/'+f.id+'/sub'):await api('POST','/forums/'+f.id+'/sub');f.subbed=d.subbed})},
 modSet(k,v){const t=this.thread;this.run(async()=>{await api('PATCH','/forums/threads/'+t.id,{[k]:v});t[k]=v})},
 delThread(){if(!confirm('Xóa chủ đề này cùng toàn bộ trả lời?'))return;this.run(async()=>{await api('DELETE','/forums/threads/'+this.thread.id);this.back()})},
 delPost(p){if(!confirm('Xóa bài trả lời này?'))return;this.run(async()=>{await api('DELETE','/forums/posts/'+p.id);this.posts=this.posts.filter(x=>x.id!==p.id);this.ptotal--;this.thread.replyNum--})}},
template:`<div class="space-y-3">
 <p v-if="err" class="text-sm" style="color:#d64545" role="alert">{{ err }}</p>
 <div v-if="busy&&page==='cats'&&!cats.length" class="card p-4 text-sm text-mute">Đang tải…</div>
 <template v-if="page==='cats'">
  <div v-for="c in cats" :key="c.id" class="card p-3 space-y-2"><b class="text-sm">📁 {{ c.name }}</b>
   <button v-for="f in c.forums" :key="f.id" class="uc-row w-full text-left block" @click="openForum(f.id)">
    <b class="break-words">💬 {{ f.name }}</b><span class="block text-xs text-mute mt-1 break-words">{{ f.desc||'Không có mô tả.' }}</span>
    <span class="block text-xs text-mute mt-1">{{ f.threadNum }} chủ đề · {{ f.postNum }} bài viết<span v-if="f.lastAt"> · mới nhất {{ ago(f.lastAt) }} ({{ f.lastBy }})</span></span>
   </button>
   <p v-if="!c.forums.length" class="text-xs text-mute">Chưa có box nào.</p>
  </div>
  <p v-if="!cats.length&&!busy" class="card p-4 text-sm text-mute">Chưa có diễn đàn nào. Quản trị viên tạo ở Quản trị → Danh mục.</p>
 </template>
 <template v-else-if="page==='forum'&&forum">
  <button class="gh" @click="back">« Diễn đàn</button>
  <div class="card p-3"><div class="flex items-start justify-between gap-2"><div><b class="break-words">💬 {{ forum.name }}</b><p class="text-xs text-mute mt-1 break-words">{{ forum.desc||'' }}</p><p class="text-xs text-mute mt-1">{{ forum.threadNum }} chủ đề · {{ total }} đang hiện</p></div>
   <button class="btn !bg-transparent border border-line !h-8 text-sm shrink-0" @click="togSubF">{{ forum.subbed?'🔕 Bỏ theo dõi':'🔔 Theo dõi box' }}</button></div></div>
  <button v-if="!tform" class="btn btn-g w-full" @click="write">＋ Đăng chủ đề mới</button>
  <form v-else class="card p-4 space-y-3" @submit.prevent="saveThread">
   <input v-model="tform.title" class="ip" maxlength="120" placeholder="Tiêu đề chủ đề" aria-label="Tiêu đề">
   <textarea v-model="tform.text" class="ip" rows="5" maxlength="10000" placeholder="Nội dung chủ đề…" aria-label="Nội dung"></textarea>
   <div class="flex gap-2 justify-end"><button type="button" class="btn !bg-transparent border border-line" @click="tform=null">Hủy</button><button class="btn btn-g" :disabled="busy">Đăng</button></div>
  </form>
  <div v-if="!threads.length&&!busy" class="card p-4 text-sm text-mute">Chưa có chủ đề nào.</div>
  <button v-for="t in threads" :key="t.id" class="uc-row w-full text-left block" @click="showThread(t.id)">
   <b class="break-words"><span v-if="t.sticky">📌 </span><span v-if="t.locked">🔒 </span><span v-if="t.digest">🌟 </span>{{ t.title }}</b>
   <span class="block text-xs text-mute mt-1">{{ t.author&&t.author.name }} · {{ t.replyNum }} trả lời · {{ t.views }} lượt xem · {{ ago(t.lastAt) }}<span v-if="t.lastBy"> · {{ t.lastBy }}</span></span>
  </button>
  <button v-if="hasMore" class="btn w-full !bg-transparent border border-line" :disabled="busyMore" @click="moreForum">{{ busyMore?'Đang tải…':'Xem thêm' }}</button>
 </template>
 <template v-else-if="page==='thread'&&thread">
  <button class="gh" @click="back">« {{ forum?forum.name:'Diễn đàn' }}</button>
  <article class="card p-4 space-y-2">
   <h2 class="!m-0 text-lg font-bold break-words"><span v-if="thread.sticky">📌 </span>{{ thread.title }}</h2>
   <div class="text-xs text-mute">{{ thread.author&&thread.author.name }} · {{ ago(thread.createdAt) }} · {{ thread.views }} lượt xem · {{ thread.replyNum }} trả lời</div>
   <p class="text-sm whitespace-pre-wrap break-words"><c-tx :t="thread.text"/></p>
   <div class="flex gap-2 flex-wrap">
    <button class="btn !bg-transparent border border-line !h-8 text-sm" @click="togSub">{{ thread.subbed?'🔕 Bỏ theo dõi':'🔔 Theo dõi' }}</button>
    <template v-if="thread.mod">
     <button class="btn !bg-transparent border border-line !h-8 text-sm" @click="modSet('sticky',!thread.sticky)">{{ thread.sticky?'Bỏ ghim':'📌 Ghim' }}</button>
     <button class="btn !bg-transparent border border-line !h-8 text-sm" @click="modSet('locked',!thread.locked)">{{ thread.locked?'🔓 Mở khóa':'🔒 Khóa' }}</button>
     <button class="btn !bg-transparent border border-line !h-8 text-sm" @click="modSet('digest',!thread.digest)">{{ thread.digest?'Bỏ tinh hoa':'🌟 Tinh hoa' }}</button>
    </template>
    <button v-if="thread.mine||thread.mod" class="btn !bg-transparent border border-line !h-8 text-sm !text-[#d64545]" @click="delThread">🗑️ Xóa chủ đề</button>
   </div>
  </article>
  <div class="space-y-2">
   <div v-for="p in posts" :key="p.id" class="card p-3">
    <div class="flex items-center gap-2 text-xs text-mute"><c-av :name="p.author.name" :src="p.author.avatar" :size="28"></c-av><b class="text-ink text-sm">{{ p.author.name }}</b><span>{{ ago(p.createdAt) }}</span>
     <button v-if="p.mine||thread.mod" class="gh ml-auto !text-xs" @click="delPost(p)">Xóa</button></div>
    <p class="text-sm mt-1 whitespace-pre-wrap break-words"><c-tx :t="p.text"/></p>
   </div>
   <p v-if="!posts.length" class="text-sm text-mute">Chưa có trả lời nào.</p>
   <button v-if="pHasMore" class="btn w-full !bg-transparent border border-line" :disabled="busyMore" @click="morePosts">{{ busyMore?'Đang tải…':'Xem thêm trả lời' }}</button>
  </div>
  <form v-if="!thread.locked" class="card p-3 space-y-2" @submit.prevent="reply">
   <textarea v-model="rtext" class="ip" rows="3" maxlength="10000" placeholder="Viết trả lời…" aria-label="Trả lời"></textarea>
   <div class="text-right"><button class="btn btn-g" :disabled="busy">Gửi trả lời</button></div>
  </form>
  <p v-else class="text-sm text-mute">🔒 Chủ đề đã bị khóa.</p>
 </template>
</div>`};


export { CForum };
