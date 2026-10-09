import { VIS3 } from './events-polls.js';
import { ago, api } from '../lib/core.js';
/* Component: Trạng thái ngắn (doing của UCHome): dòng trạng thái 200 ký tự kèm tâm trạng, trả lời lồng nhau 1 cấp */
const CDoings={
data:()=>({tab:'feed',list:[],total:0,pg:1,busy:false,busyMore:false,err:'',cur:null,
 txt:'',mood:'',vis:'public',moods:[],VI:VIS3,rtxt:'',rparent:null,
 TABS:[['feed','Bảng tin'],['mine','Của tôi']]}),
created(){this.load()},
computed:{hasMore(){return this.list.length<this.total},
 threads(){if(!this.cur||!this.cur.replies)return[];const rs=this.cur.replies,byId={};rs.forEach(r=>byId[r.id]=1);
  const tops=rs.filter(r=>!r.parent||!byId[r.parent]),kids={};
  rs.forEach(r=>{if(r.parent&&byId[r.parent])(kids[r.parent]=kids[r.parent]||[]).push(r)});
  return tops.map(t=>({t,kids:kids[t.id]||[]}))}},
methods:{ago,
 async run(fn){this.err='';try{await fn()}catch(e){this.err=e.message}},
 load(){this.busy=true;this.pg=1;this.cur=null;return this.run(async()=>{const d=await api('GET','/doings?view='+this.tab+'&page=1');this.list=d.doings;this.total=d.total;if(d.moods&&d.moods.length)this.moods=d.moods}).finally(()=>this.busy=false)},
 more(){if(this.busyMore)return;this.busyMore=true;return this.run(async()=>{const d=await api('GET','/doings?view='+this.tab+'&page='+(this.pg+1));this.pg++;this.total=d.total;const have=new Set(this.list.map(x=>x.id));this.list.push(...d.doings.filter(x=>!have.has(x.id)))}).finally(()=>this.busyMore=false)},
 setTab(t){this.tab=t;this.load()},
 show(id){this.busy=true;return this.run(async()=>{this.cur=(await api('GET','/doings/'+id)).doing;this.rtxt='';this.rparent=null}).finally(()=>this.busy=false)},
 back(){this.cur=null;this.rtxt='';this.rparent=null},
 post(){const t=this.txt.trim();if(!t){this.err='Hãy viết gì đó đã.';return}
  this.busy=true;return this.run(async()=>{const d=await api('POST','/doings',{text:t,mood:this.mood,visibility:this.vis});this.txt='';this.mood='';this.list.unshift(d.doing);this.total++}).finally(()=>this.busy=false)},
 del(id){if(!confirm('Xóa trạng thái này?'))return;this.run(async()=>{await api('DELETE','/doings/'+id);this.list=this.list.filter(x=>x.id!==id);this.total=Math.max(0,this.total-1);if(this.cur&&this.cur.id===id)this.cur=null})},
 replyTo(r){this.rparent=r},
 send(){const t=this.rtxt.trim();if(!t||!this.cur)return;
  this.run(async()=>{const d=await api('POST','/doings/'+this.cur.id+'/replies',{text:t,parent:this.rparent?this.rparent.id:undefined});this.cur=d.doing;const i=this.list.findIndex(x=>x.id===d.doing.id);if(i>=0)this.list[i].replyNum=d.doing.replyNum;this.rtxt='';this.rparent=null})},
 delR(r){if(!confirm('Xóa trả lời này?'))return;this.run(async()=>{const d=await api('DELETE','/doings/'+this.cur.id+'/replies/'+r.id);this.cur=d.doing;const i=this.list.findIndex(x=>x.id===d.doing.id);if(i>=0)this.list[i].replyNum=d.doing.replyNum})}},
template:`<div class="space-y-3">
 <p v-if="err" class="text-sm" style="color:#d64545" role="alert">{{ err }}</p>
 <div v-if="busy&&!list.length&&!cur" class="card p-4 text-sm text-mute">Đang tải…</div>
 <template v-else-if="cur">
  <button class="gh" @click="back">« Danh sách trạng thái</button>
  <article class="card p-4 space-y-2">
   <div class="flex gap-2 items-start">
    <c-av :name="cur.author&&cur.author.name" :src="cur.author&&cur.author.avatar" :size="40"></c-av>
    <div class="min-w-0 flex-1">
     <div class="text-sm"><b>{{ cur.author&&cur.author.name }}</b><span v-if="cur.mood" class="text-xs"> · {{ cur.mood }}</span><span class="text-xs text-mute"> · {{ ago(cur.createdAt) }} · {{ VI[cur.visibility][0] }}</span></div>
     <div class="whitespace-pre-wrap break-words leading-relaxed">{{ cur.text }}</div>
    </div>
    <button v-if="cur.mine" class="gh text-xs" aria-label="Xóa trạng thái" @click="del(cur.id)">✕</button>
   </div>
  </article>
  <div class="card p-4 space-y-3">
   <b class="text-sm">Trả lời ({{ cur.replyNum }})</b>
   <div v-if="!threads.length" class="text-sm text-mute">Chưa có trả lời nào. Hãy là người đầu tiên!</div>
   <div v-for="th in threads" :key="th.t.id" class="space-y-2">
    <div class="flex gap-2 items-start">
     <c-av :name="th.t.name" :size="32"></c-av>
     <div class="min-w-0 flex-1">
      <div class="text-sm"><b>{{ th.t.name }}</b> <span class="text-xs text-mute">{{ ago(th.t.createdAt) }}</span></div>
      <div class="text-sm whitespace-pre-wrap break-words">{{ th.t.text }}</div>
      <div class="flex gap-3 mt-1"><button class="gh text-xs" @click="replyTo(th.t)">Trả lời</button><button v-if="th.t.canDel" class="gh text-xs" @click="delR(th.t)">Xóa</button></div>
     </div>
    </div>
    <div v-for="k in th.kids" :key="k.id" class="flex gap-2 items-start ml-8 pl-2" style="border-left:2px solid var(--line)">
     <c-av :name="k.name" :size="28"></c-av>
     <div class="min-w-0 flex-1">
      <div class="text-sm"><b>{{ k.name }}</b> <span class="text-xs text-mute">{{ ago(k.createdAt) }}</span></div>
      <div class="text-sm whitespace-pre-wrap break-words">{{ k.text }}</div>
      <div v-if="k.canDel" class="mt-1"><button class="gh text-xs" @click="delR(k)">Xóa</button></div>
     </div>
    </div>
   </div>
   <div v-if="rparent" class="text-xs text-mute flex items-center gap-2">Đang trả lời <b>{{ rparent.name }}</b><button class="gh" aria-label="Hủy trả lời" @click="rparent=null">✕</button></div>
   <div class="flex gap-2"><input v-model="rtxt" class="ip" maxlength="200" placeholder="Viết trả lời…" aria-label="Trả lời" @keyup.enter="send"><button class="btn btn-g" @click="send">Gửi</button></div>
  </div>
 </template>
 <template v-else>
  <form class="card p-4 space-y-2" @submit.prevent="post">
   <textarea v-model="txt" rows="3" maxlength="200" class="ip resize-y" placeholder="Bạn đang nghĩ gì? (tối đa 200 ký tự)" aria-label="Trạng thái mới"></textarea>
   <div class="flex items-center gap-2 flex-wrap">
    <select v-model="mood" class="ip !w-auto text-sm" aria-label="Tâm trạng"><option value="">Không đặt tâm trạng</option><option v-for="m in moods" :key="m" :value="m">{{ m }}</option></select>
    <select v-model="vis" class="ip !w-auto text-sm" aria-label="Ai xem được"><option v-for="(v,k) in VI" :key="k" :value="k">{{ v[0] }} {{ v[1] }}</option></select>
    <span class="text-xs text-mute ml-auto">{{ txt.length }}/200</span>
    <button class="btn btn-g" :disabled="busy">Đăng</button>
   </div>
  </form>
  <div class="flex gap-1 flex-wrap"><button v-for="t in TABS" :key="t[0]" class="btn !py-1 text-sm" :class="tab===t[0]?'btn-g':'!bg-transparent border border-line'" @click="setTab(t[0])">{{ t[1] }}</button></div>
  <div v-if="!list.length" class="card p-4 text-sm text-mute">Chưa có trạng thái nào.</div>
  <button v-for="d in list" :key="d.id" class="uc-row w-full text-left block" @click="show(d.id)">
   <span class="flex items-center gap-2"><c-av :name="d.author&&d.author.name" :src="d.author&&d.author.avatar" :size="32"></c-av><b class="break-words">{{ d.author&&d.author.name }}</b><span v-if="d.mood" class="text-xs">{{ d.mood }}</span></span>
   <span class="block break-words mt-1"><c-tx :t="d.text"/></span>
   <span class="block text-xs text-mute mt-1">{{ ago(d.createdAt) }} · 💬 {{ d.replyNum }} trả lời</span>
  </button>
  <button v-if="hasMore" class="btn w-full !bg-transparent border border-line" :disabled="busyMore" @click="more">{{ busyMore?'Đang tải…':'Xem thêm' }}</button>
 </template>
</div>`};

/* Component: Chia sẻ (share của UCHome): hiển thị nội dung được chia sẻ (form tạo sẽ gắn vào nút Share của bài viết) */
const CShares={
data:()=>({tab:'feed',list:[],total:0,pg:1,busy:false,busyMore:false,err:'',VI:VIS3,
 TABS:[['feed','Bảng tin'],['mine','Của tôi']]}),
created(){this.load()},
computed:{hasMore(){return this.list.length<this.total}},
methods:{ago,
 async run(fn){this.err='';try{await fn()}catch(e){this.err=e.message}},
 load(){this.busy=true;this.pg=1;return this.run(async()=>{const d=await api('GET','/shares?view='+this.tab+'&page=1');this.list=d.shares;this.total=d.total}).finally(()=>this.busy=false)},
 more(){if(this.busyMore)return;this.busyMore=true;return this.run(async()=>{const d=await api('GET','/shares?view='+this.tab+'&page='+(this.pg+1));this.pg++;this.total=d.total;const have=new Set(this.list.map(x=>x.id));this.list.push(...d.shares.filter(x=>!have.has(x.id)))}).finally(()=>this.busyMore=false)},
 setTab(t){this.tab=t;this.load()},
 del(s){if(!confirm('Xóa chia sẻ này?'))return;this.run(async()=>{await api('DELETE','/shares/'+s.id);this.list=this.list.filter(x=>x.id!==s.id);this.total=Math.max(0,this.total-1)})},
 cToggle(s){s.cOpen=!s.cOpen;if(s.cOpen&&!s.comments)this.cLoad(s)},
 cLoad(s){s.cBusy=true;return this.run(async()=>{s.comments=(await api('GET','/shares/'+s.id+'/comments')).comments}).finally(()=>s.cBusy=false)},
 cSend(s){const t=(s.cTxt||'').trim();if(!t)return;s.cBusy=true;return this.run(async()=>{await api('POST','/shares/'+s.id+'/comments',{text:t});s.cTxt='';await this.cLoad(s);s.commentNum=(s.comments||[]).length}).finally(()=>s.cBusy=false)},
 cDel(s,c){if(!confirm('Xóa bình luận này?'))return;this.run(async()=>{await api('DELETE','/shares/'+s.id+'/comments/'+c.id);await this.cLoad(s);s.commentNum=(s.comments||[]).length})},
 kindIcon(k){return{post:'📝',blog:'📓',photo:'🖼️',event:'📅',poll:'📊',doing:'💬',link:'🔗'}[k]||'🔁'}},
template:`<div class="space-y-3">
 <p v-if="err" class="text-sm" style="color:#d64545" role="alert">{{ err }}</p>
 <div v-if="busy&&!list.length" class="card p-4 text-sm text-mute">Đang tải…</div>
 <template v-else>
  <div class="flex gap-1 flex-wrap"><button v-for="t in TABS" :key="t[0]" class="btn !py-1 text-sm" :class="tab===t[0]?'btn-g':'!bg-transparent border border-line'" @click="setTab(t[0])">{{ t[1] }}</button></div>
  <div v-if="!list.length" class="card p-4 text-sm text-mute">Chưa có chia sẻ nào.</div>
  <article v-for="s in list" :key="s.id" class="card p-4 space-y-2">
   <div class="flex gap-2 items-start">
    <c-av :name="s.author&&s.author.name" :src="s.author&&s.author.avatar" :size="36"></c-av>
    <div class="min-w-0 flex-1">
     <div class="text-sm"><b>{{ s.author&&s.author.name }}</b><span class="text-xs text-mute"> đã chia sẻ · {{ ago(s.createdAt) }} · {{ VI[s.visibility][0] }}</span></div>
     <div v-if="s.note" class="text-sm whitespace-pre-wrap break-words mt-1">{{ s.note }}</div>
    </div>
    <button v-if="s.mine" class="gh text-xs" aria-label="Xóa chia sẻ" @click="del(s)">✕</button>
   </div>
   <div class="rounded p-3 space-y-1" style="background:var(--soft)">
    <div class="text-sm"><b>{{ kindIcon(s.kind) }} {{ s.targetTitle||'Nội dung được chia sẻ' }}</b></div>
    <div v-if="s.targetOwner" class="text-xs text-mute">bởi {{ s.targetOwner.name }}</div>
    <img v-if="s.image" :src="s.image" class="rounded max-h-48 object-cover" alt="Ảnh được chia sẻ">
    <a v-if="s.kind==='link'&&s.url" :href="s.url" target="_blank" rel="noopener" class="text-sm break-all underline">{{ s.url }}</a>
   </div>
   <div><button class="gh text-xs" @click="cToggle(s)">💬 {{ s.commentNum }} bình luận {{ s.cOpen?'▾':'▸' }}</button></div>
   <div v-if="s.cOpen" class="space-y-2 pt-1">
    <div v-if="s.cBusy&&!s.comments" class="text-xs text-mute">Đang tải…</div>
    <div v-for="c in (s.comments||[])" :key="c.id" class="flex gap-2 items-start"><c-av :name="c.name" :src="c.av" :size="28"></c-av><div class="min-w-0 flex-1 rounded p-2" style="background:var(--soft)"><div class="text-xs"><b>{{ c.name }}</b> <span class="text-mute">{{ ago(c.createdAt) }}</span></div><div class="text-sm whitespace-pre-wrap break-words"><c-tx :t="c.text"/></div></div><button v-if="c.mine" class="gh text-xs" aria-label="Xóa bình luận" @click="cDel(s,c)">✕</button></div>
    <div v-if="s.comments&&!s.comments.length" class="text-xs text-mute">Chưa có bình luận nào.</div>
    <div class="flex gap-2"><input v-model="s.cTxt" class="ip text-sm" maxlength="500" placeholder="Viết bình luận…" aria-label="Bình luận" @keyup.enter="cSend(s)"><button class="btn btn-g !h-9 text-sm" :disabled="s.cBusy" @click="cSend(s)">Gửi</button></div>
   </div>
  </article>
  <button v-if="hasMore" class="btn w-full !bg-transparent border border-line" :disabled="busyMore" @click="more">{{ busyMore?'Đang tải…':'Xem thêm' }}</button>
 </template>
</div>`};

/* Component: Khám phá (network/top của UCHome): nội dung công khai của cộng đồng + bảng xếp hạng */
const CDiscover={emits:['user'],
data:()=>({tab:'posts',list:[],total:0,pg:1,busy:false,busyMore:false,err:'',tops:[],topBy:'credit',topBusy:false,hot:[],featured:[],boosted:[],
 TABS:[['posts','Bài viết'],['blogs','Nhật ký'],['doings','Trạng thái']],
 TTABS:[['credit','Điểm'],['experience','Kinh nghiệm'],['friends','Bạn bè']]}),
created(){this.load();this.loadTop();this.loadHot()},
computed:{hasMore(){return this.list.length<this.total}},
methods:{ago,
 async run(fn){this.err='';try{await fn()}catch(e){this.err=e.message}},
 load(){this.busy=true;this.pg=1;return this.run(async()=>{const d=await api('GET','/discover?type='+this.tab+'&page=1');this.list=d.items;this.total=d.total;this.featured=d.featured||[];this.boosted=d.boosted||[]}).finally(()=>this.busy=false)},
 more(){if(this.busyMore)return;this.busyMore=true;return this.run(async()=>{const d=await api('GET','/discover?type='+this.tab+'&page='+(this.pg+1));this.pg++;this.total=d.total;const have=new Set(this.list.map(x=>x.kind+x.id));this.list.push(...d.items.filter(x=>!have.has(x.kind+x.id)))}).finally(()=>this.busyMore=false)},
 setTab(t){this.tab=t;this.load()},
 setTop(b){this.topBy=b;this.loadTop()},
 loadTop(){this.topBusy=true;return this.run(async()=>{this.tops=(await api('GET','/discover/top?by='+this.topBy)).users}).finally(()=>this.topBusy=false)},
 loadHot(){this.run(async()=>{this.hot=(await api('GET','/hotusers')).hotusers}).catch(()=>{})},
 openUser(id){if(id)this.$emit('user',id)}},
template:`<div class="space-y-3">
 <p v-if="err" class="text-sm" style="color:#d64545" role="alert">{{ err }}</p>
 <div class="flex gap-1 flex-wrap"><button v-for="t in TABS" :key="t[0]" class="btn !py-1 text-sm" :class="tab===t[0]?'btn-g':'!bg-transparent border border-line'" @click="setTab(t[0])">{{ t[1] }}</button></div>
 <div v-if="busy&&!list.length" class="card p-4 text-sm text-mute">Đang tải…</div>
 <template v-else>
  <div v-if="featured.length" class="card p-3"><b class="text-sm">🌟 Siêu sao đang tỏa sáng</b><div class="flex gap-3 flex-wrap mt-2"><button v-for="u in featured" :key="u.id" class="flex flex-col items-center gap-1" @click="$emit('user',u.id)"><c-av :name="u.name" :src="u.avatar" :size="48"></c-av><span class="text-xs font-semibold">🌟 {{ u.name }}</span></button></div></div>
  <div v-if="!list.length" class="card p-4 text-sm text-mute">Chưa có nội dung công khai nào để khám phá.</div>
  <button v-for="it in list" :key="it.kind+it.id" class="uc-row w-full text-left block" @click="openUser(it.author&&it.author.id)">
   <span class="flex items-center gap-2"><c-av :name="it.author&&it.author.name" :src="it.author&&it.author.avatar" :size="32"></c-av><b class="break-words">{{ it.author&&it.author.name }}</b><span class="text-xs text-mute">{{ ago(it.createdAt) }}</span></span>
   <b v-if="it.title" class="block break-words mt-1">{{ it.kind==='blog'?'📓 ':'' }}{{ it.title }}</b>
   <span class="block text-sm text-mute break-words mt-1">{{ it.kind==='blog'?it.excerpt:((it.mood?it.mood+' ':'')+it.text) }}</span>
   <span v-if="it.tags&&it.tags.length" class="block text-xs mt-1"><button v-for="tg in it.tags" :key="tg" class="mr-1 hover:underline" @click.stop="$root.openTag(tg)">#{{ tg }}</button></span>
  </button>
  <button v-if="hasMore" class="btn w-full !bg-transparent border border-line" :disabled="busyMore" @click="more">{{ busyMore?'Đang tải…':'Xem thêm' }}</button>
 </template>
 <div class="card p-4 space-y-2">
  <b class="text-sm">🌟 Thành viên nổi bật</b>
  <div v-if="!hot.length" class="text-sm text-mute">Chưa có.</div>
  <div class="flex gap-3 overflow-x-auto pb-1"><button v-for="u in hot" :key="u.id" class="flex flex-col items-center gap-1 shrink-0 w-16" @click="openUser(u.id)"><c-av :name="u.name" :src="u.avatar" :size="48"></c-av><b class="text-xs text-center break-words leading-tight">{{ u.name }}</b></button></div>
 </div>
 <div class="card p-4 space-y-2">
  <b class="text-sm">🏆 Bảng xếp hạng thành viên</b>
  <div class="flex gap-1 flex-wrap"><button v-for="t in TTABS" :key="t[0]" class="btn !py-1 text-sm" :class="topBy===t[0]?'btn-g':'!bg-transparent border border-line'" @click="setTop(t[0])">{{ t[1] }}</button></div>
  <div v-if="topBusy" class="text-sm text-mute">Đang tải…</div>
  <div v-else-if="!tops.length" class="text-sm text-mute">Chưa có dữ liệu.</div>
  <button v-for="(u,i) in tops" :key="u.id" class="uc-row w-full text-left flex gap-2 items-center" @click="openUser(u.id)">
   <b class="w-6 text-center shrink-0">{{ i+1 }}</b><c-av :name="u.name" :src="u.avatar" :size="32"></c-av>
   <b class="min-w-0 flex-1 break-words">{{ u.name }}</b><span class="text-sm text-mute shrink-0">{{ u.score }}</span>
  </button>
 </div>
</div>`};

/* Component: Chủ đề nóng (topic của UCHome): tham gia chủ đề, gắn nội dung của mình vào */
const CTopics={
data:()=>({list:[],total:0,pg:1,busy:false,busyMore:false,err:'',cur:null,items:[],iTotal:0,iPg:1,
 akind:'post',aid:'',joinBusy:false}),
created(){this.load()},
computed:{hasMore(){return this.list.length<this.total},iHasMore(){return this.items.length<this.iTotal}},
methods:{ago,
 async run(fn){this.err='';try{await fn()}catch(e){this.err=e.message}},
 load(){this.busy=true;this.pg=1;this.cur=null;return this.run(async()=>{const d=await api('GET','/topics?page=1');this.list=d.topics;this.total=d.total}).finally(()=>this.busy=false)},
 more(){if(this.busyMore)return;this.busyMore=true;return this.run(async()=>{const d=await api('GET','/topics?page='+(this.pg+1));this.pg++;this.total=d.total;const have=new Set(this.list.map(x=>x.id));this.list.push(...d.topics.filter(x=>!have.has(x.id)))}).finally(()=>this.busyMore=false)},
 show(id){this.busy=true;return this.run(async()=>{const d=await api('GET','/topics/'+id);this.cur=d.topic;this.items=d.items;this.iTotal=d.total;this.iPg=1;this.aid=''}).finally(()=>this.busy=false)},
 iMore(){if(this.busyMore)return;this.busyMore=true;return this.run(async()=>{const d=await api('GET','/topics/'+this.cur.id+'?page='+(this.iPg+1));this.iPg++;this.iTotal=d.total;const have=new Set(this.items.map(x=>x.id));this.items.push(...d.items.filter(x=>!have.has(x.id)))}).finally(()=>this.busyMore=false)},
 back(){this.cur=null;this.items=[]},
 join(){this.joinBusy=true;return this.run(async()=>{await api('POST','/topics/'+this.cur.id+'/join');this.cur.joined=true;this.cur.joinNum++}).finally(()=>this.joinBusy=false)},
 leave(){if(!confirm('Rời khỏi chủ đề này? Nội dung bạn đã gắn cũng sẽ bị gỡ.'))return;this.joinBusy=true;return this.run(async()=>{await api('DELETE','/topics/'+this.cur.id+'/join');this.cur.joined=false;this.cur.joinNum=Math.max(0,this.cur.joinNum-1);this.show(this.cur.id)}).finally(()=>this.joinBusy=false)},
 attach(){const t=this.aid.trim();if(!t){this.err='Hãy dán ID nội dung cần gắn.';return}
  this.run(async()=>{await api('POST','/topics/'+this.cur.id+'/attach',{kind:this.akind,target:t});this.aid='';await this.show(this.cur.id)})},
 kindIcon(k){return{post:'📝',blog:'📓',doing:'💬'}[k]||'📎'}},
template:`<div class="space-y-3">
 <p v-if="err" class="text-sm" style="color:#d64545" role="alert">{{ err }}</p>
 <div v-if="busy&&!list.length&&!cur" class="card p-4 text-sm text-mute">Đang tải…</div>
 <template v-else-if="cur">
  <button class="gh" @click="back">« Danh sách chủ đề</button>
  <article class="card p-4 space-y-2">
   <h2 class="!m-0 text-lg font-bold break-words"><span v-if="cur.hot">🔥 </span>{{ cur.title }}</h2>
   <div v-if="cur.desc" class="text-sm whitespace-pre-wrap break-words">{{ cur.desc }}</div>
   <div class="text-xs text-mute">👥 {{ cur.joinNum }} tham gia · 📎 {{ cur.postNum }} nội dung</div>
   <div class="flex gap-2 flex-wrap">
    <button v-if="!cur.joined" class="btn btn-g" :disabled="joinBusy" @click="join">＋ Tham gia</button>
    <button v-else class="btn !bg-transparent border border-line" :disabled="joinBusy" @click="leave">Rời chủ đề</button>
   </div>
   <form class="flex gap-2 flex-wrap items-center pt-2" @submit.prevent="attach">
    <select v-model="akind" class="ip !w-auto text-sm" aria-label="Loại nội dung"><option value="post">📝 Bài viết</option><option value="blog">📓 Nhật ký</option><option value="doing">💬 Trạng thái</option></select>
    <input v-model="aid" class="ip flex-1 min-w-[140px]" placeholder="Dán ID nội dung của bạn…" aria-label="ID nội dung">
    <button class="btn btn-g">Gắn vào</button>
   </form>
   <p class="text-xs text-mute">Chỉ gắn được nội dung do chính bạn tạo.</p>
  </article>
  <div v-if="!items.length" class="card p-4 text-sm text-mute">Chưa có nội dung nào được gắn vào chủ đề này.</div>
  <div v-for="it in items" :key="it.id" class="uc-row block">
   <b class="block break-words">{{ kindIcon(it.kind) }} {{ it.title }}</b>
   <span class="block text-xs text-mute mt-1">{{ it.author&&it.author.name }} · {{ ago(it.createdAt) }}</span>
  </div>
  <button v-if="iHasMore" class="btn w-full !bg-transparent border border-line" :disabled="busyMore" @click="iMore">{{ busyMore?'Đang tải…':'Xem thêm' }}</button>
 </template>
 <template v-else>
  <div v-if="!list.length" class="card p-4 text-sm text-mute">Chưa có chủ đề nào. Quản trị viên sẽ tạo chủ đề nóng tại đây.</div>
  <button v-for="t in list" :key="t.id" class="uc-row w-full text-left block" @click="show(t.id)">
   <b class="block break-words"><span v-if="t.hot">🔥 </span>{{ t.title }}<span v-if="t.joined" class="text-xs font-normal text-mute"> · đã tham gia</span></b>
   <span v-if="t.desc" class="block text-sm text-mute break-words">{{ t.desc }}</span>
   <span class="block text-xs text-mute mt-1">👥 {{ t.joinNum }} tham gia · 📎 {{ t.postNum }} nội dung</span>
  </button>
  <button v-if="hasMore" class="btn w-full !bg-transparent border border-line" :disabled="busyMore" @click="more">{{ busyMore?'Đang tải…':'Xem thêm' }}</button>
 </template>
</div>`};


export { CDiscover, CDoings, CShares, CTopics };
