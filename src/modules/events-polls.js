import { ago, api } from '../lib/core.js';
/* Helpers ngày giờ cho sự kiện / bình chọn */
const fdt=iso=>iso?new Date(iso).toLocaleString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'';
const dtl=iso=>{if(!iso)return'';const d=new Date(iso),p=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':'+p(d.getMinutes())};
const VIS3={public:['🌐','Công khai'],friends:['👥','Bạn bè'],private:['🔒','Chỉ mình tôi']};

/* Component: Sự kiện (event của UCHome): danh sách (4 tab) -> xem (tham gia / có thể / bình luận) -> tạo / sửa */
const CEvents={props:{open:String},emits:['used'],
data:()=>({tab:'upcoming',list:[],total:0,pg:1,busy:false,busyMore:false,err:'',cur:null,form:null,ctxt:'',cats:[],catFilter:'',
 mShow:false,mTab:'going',mList:[],mTotal:0,mPg:1,mBusy:false,VI:VIS3,TABS:[['upcoming','Sắp diễn ra'],['going','Tôi tham gia'],['mine','Của tôi'],['past','Đã qua']]}),
created(){if(this.open){const id=this.open;this.$emit('used');this.show(id)}else this.load();this.loadCats()},
computed:{hasMore(){return this.list.length<this.total}},
methods:{ago,fdt,
 async run(fn){this.err='';try{await fn()}catch(e){this.err=e.message}},
 load(){this.busy=true;this.pg=1;return this.run(async()=>{const d=await api('GET','/events?view='+this.tab+'&page=1'+(this.catFilter?'&cat='+this.catFilter:''));this.list=d.events;this.total=d.total}).finally(()=>this.busy=false)},
 more(){if(this.busyMore)return;this.busyMore=true;return this.run(async()=>{const d=await api('GET','/events?view='+this.tab+'&page='+(this.pg+1)+(this.catFilter?'&cat='+this.catFilter:''));this.pg++;this.total=d.total;const have=new Set(this.list.map(x=>x.id));this.list.push(...d.events.filter(x=>!have.has(x.id)))}).finally(()=>this.busyMore=false)},
 setTab(t){this.tab=t;this.load()},
 loadCats(){api('GET','/event-cats').then(d=>{this.cats=d.cats}).catch(()=>{})},
 setCatFilter(id){this.catFilter=id;this.load()},
 show(id){this.busy=true;this.form=null;this.mShow=false;return this.run(async()=>{this.cur=(await api('GET','/events/'+id)).event;this.ctxt=''}).finally(()=>this.busy=false)},
 back(){this.cur=null;this.form=null;this.mShow=false;this.load()},
 write(e){this.err='';const t=new Date(Date.now()+864e5);t.setMinutes(0,0,0);this.form=e?{id:e.id,title:e.title,detail:e.detail||'',location:e.location,start:dtl(e.start),end:dtl(e.end),limit:e.limit||0,visibility:e.visibility,cat:e.cat?e.cat.id:''}:{id:'',title:'',detail:'',location:'',start:dtl(t),end:'',limit:0,visibility:'public',cat:''}},
 save(){const f=this.form;if(!f.title.trim()||!f.start){this.err='Hãy nhập tên sự kiện và thời gian bắt đầu.';return}
  const body={title:f.title,detail:f.detail,location:f.location,start:new Date(f.start).toISOString(),end:f.end?new Date(f.end).toISOString():'',limit:Number(f.limit)||0,visibility:f.visibility,cat:f.cat||''};
  this.busy=true;return this.run(async()=>{const d=await api(f.id?'PATCH':'POST',f.id?'/events/'+f.id:'/events',body);this.form=null;this.cur=d.event}).finally(()=>this.busy=false)},
 del(){if(!confirm('Xóa sự kiện này? Danh sách người tham gia và bình luận cũng sẽ bị xóa.'))return;this.run(async()=>{await api('DELETE','/events/'+this.cur.id);this.cur=null;await this.load()})},
 join(st){this.run(async()=>{this.cur=(await api('POST','/events/'+this.cur.id+'/join',{status:st})).event})},
 leave(){this.run(async()=>{this.cur=(await api('DELETE','/events/'+this.cur.id+'/join')).event})},
 send(){const t=this.ctxt.trim();if(!t)return;this.run(async()=>{this.cur=(await api('POST','/events/'+this.cur.id+'/comments',{text:t})).event;this.ctxt=''})},
 delC(c){this.run(async()=>{this.cur=(await api('DELETE','/events/'+this.cur.id+'/comments/'+c.id)).event})},
 mOpen(tab){this.mShow=true;this.mTab=tab||'going';this.mLoad(1)},
 mLoad(p){if(!this.cur)return;this.mBusy=true;return this.run(async()=>{const d=await api('GET','/events/'+this.cur.id+'/members?status='+this.mTab+'&page='+(p||1));this.mList=d.users;this.mTotal=d.total;this.mPg=d.page}).finally(()=>this.mBusy=false)}},
template:`<div class="space-y-3">
 <p v-if="err" class="text-sm" style="color:#d64545" role="alert">{{ err }}</p>
 <div v-if="busy&&!list.length&&!cur&&!form" class="card p-4 text-sm text-mute">Đang tải…</div>
 <form v-else-if="form" class="card p-4 space-y-3" @submit.prevent="save">
  <input v-model="form.title" class="ip" maxlength="80" placeholder="Tên sự kiện" aria-label="Tên sự kiện">
  <div class="grid gap-2 sm:grid-cols-2"><label class="text-sm text-mute">Bắt đầu<input v-model="form.start" type="datetime-local" class="ip mt-1"></label><label class="text-sm text-mute">Kết thúc (tùy chọn)<input v-model="form.end" type="datetime-local" class="ip mt-1"></label></div>
  <input v-model="form.location" class="ip" maxlength="80" placeholder="Địa điểm" aria-label="Địa điểm">
  <textarea v-model="form.detail" rows="6" maxlength="2000" class="ip resize-y" placeholder="Mô tả sự kiện" aria-label="Mô tả"></textarea>
  <select v-model="form.cat" class="ip text-sm" aria-label="Phân loại"><option value="">— Chưa phân loại —</option><option v-for="c in cats" :key="c.id" :value="c.id">{{ c.name }}</option></select>
  <div class="flex items-center gap-2 flex-wrap"><select v-model="form.visibility" class="ip !w-auto text-sm" aria-label="Ai xem được"><option v-for="(v,k) in VI" :key="k" :value="k">{{ v[0] }} {{ v[1] }}</option></select>
   <label class="text-sm text-mute flex items-center gap-1">Tối đa <input v-model.number="form.limit" type="number" min="0" max="5000" class="ip !w-24" aria-label="Giới hạn người"> người (0 = không giới hạn)</label>
   <button type="button" class="btn !bg-transparent border border-line ml-auto" @click="form=null">Hủy</button><button class="btn btn-g" :disabled="busy">{{ form.id?'Lưu thay đổi':'Tạo sự kiện' }}</button></div>
 </form>
 <template v-else-if="cur">
  <button class="gh" @click="back">« Danh sách sự kiện</button>
  <article class="card p-4 space-y-3">
   <h2 class="!m-0 text-lg font-bold break-words">📅 {{ cur.title }}</h2>
   <div class="text-sm space-y-1"><div>🕐 {{ fdt(cur.start) }}<span v-if="cur.end"> → {{ fdt(cur.end) }}</span><b v-if="cur.past" class="text-mute"> · đã kết thúc</b></div><div v-if="cur.location" class="break-words">📍 {{ cur.location }}</div>
    <div class="text-mute"><span v-if="cur.cat">🏷️ {{ cur.cat.name }} · </span>Tạo bởi {{ cur.owner&&cur.owner.name }} · {{ VI[cur.visibility][0] }} · ✅ {{ cur.goingNum }}<span v-if="cur.limit">/{{ cur.limit }}</span> tham gia · 🤔 {{ cur.maybeNum }} quan tâm</div></div>
   <div v-if="cur.detail" class="whitespace-pre-wrap break-words leading-relaxed">{{ cur.detail }}</div>
   <div v-if="!cur.past" class="flex gap-2 flex-wrap">
    <button class="btn" :class="cur.my==='going'?'btn-g':'!bg-transparent border border-line'" @click="join('going')">✅ Tham gia</button>
    <button class="btn" :class="cur.my==='maybe'?'btn-g':'!bg-transparent border border-line'" @click="join('maybe')">🤔 Có thể</button>
    <button v-if="cur.my&&!cur.mine" class="btn !bg-transparent border border-line" @click="leave">Rút lui</button></div>
   <div v-if="cur.mine" class="flex gap-2"><button class="btn !bg-transparent border border-line" @click="write(cur)">✏️ Sửa</button><button class="btn !bg-transparent border border-line" @click="del">🗑️ Xóa</button></div>
  </article>
  <div v-if="cur.going.length" class="card p-4 space-y-2"><b class="text-sm">Người tham gia ({{ cur.goingNum }})</b><div class="flex gap-2 flex-wrap"><span v-for="u in cur.going" :key="u.id" class="flex items-center gap-1 text-sm"><c-av :name="u.name" :src="u.avatar" :size="28"></c-av>{{ u.name }}</span></div>
   <div class="flex gap-2"><button class="gh text-xs" @click="mOpen('going')">Xem tất cả {{ cur.goingNum }} người tham gia »</button><button v-if="cur.maybeNum" class="gh text-xs" @click="mOpen('maybe')">🤔 {{ cur.maybeNum }} người quan tâm »</button></div></div>
  <div v-if="mShow" class="card p-4 space-y-2">
   <div class="flex items-center gap-2"><b class="text-sm flex-1">{{ mTab==='going'?'Người tham gia':'Người quan tâm' }} ({{ mTotal }})</b><button class="gh text-xs" @click="mShow=false">Đóng ✕</button></div>
   <div class="flex gap-1"><button class="btn !py-1 text-xs" :class="mTab==='going'?'btn-g':'!bg-transparent border border-line'" @click="mOpen('going')">✅ Tham gia</button><button class="btn !py-1 text-xs" :class="mTab==='maybe'?'btn-g':'!bg-transparent border border-line'" @click="mOpen('maybe')">🤔 Quan tâm</button></div>
   <div v-if="mBusy&&!mList.length" class="text-sm text-mute">Đang tải…</div>
   <div v-for="u in mList" :key="u.id" class="flex items-center gap-2 text-sm"><c-av :name="u.name" :src="u.avatar" :size="32"></c-av>{{ u.name }}</div>
   <div v-if="mTotal>30" class="flex items-center justify-between text-sm"><button class="btn !h-8 !bg-transparent border border-line" :disabled="mBusy||mPg<=1" @click="mLoad(mPg-1)">‹ Trước</button><span class="text-mute">Trang {{ mPg }}/{{ Math.ceil(mTotal/30) }}</span><button class="btn !h-8 !bg-transparent border border-line" :disabled="mBusy||mPg>=Math.ceil(mTotal/30)" @click="mLoad(mPg+1)">Sau ›</button></div>
  </div>
  <div class="card p-4 space-y-3">
   <b class="text-sm">Bình luận ({{ cur.commentNum }})</b>
   <div v-for="c in cur.comments" :key="c.id" class="flex gap-2 items-start"><c-av :name="c.name" :src="c.av" :size="32"></c-av><div class="min-w-0 flex-1"><div class="text-sm"><b>{{ c.name }}</b> <span class="text-xs text-mute">{{ ago(c.createdAt) }}</span></div><div class="text-sm whitespace-pre-wrap break-words"><c-tx :t="c.text"/></div></div><button v-if="c.canDel" class="gh text-xs" aria-label="Xóa bình luận" @click="delC(c)">✕</button></div>
   <div class="flex gap-2"><input v-model="ctxt" class="ip" maxlength="500" placeholder="Viết bình luận…" aria-label="Bình luận" @keyup.enter="send"><button class="btn btn-g" @click="send">Gửi</button></div>
  </div>
 </template>
 <template v-else>
  <button class="btn btn-g w-full" @click="write()">＋ Tạo sự kiện</button>
  <div class="flex gap-1 flex-wrap"><button v-for="t in TABS" :key="t[0]" class="btn !py-1 text-sm" :class="tab===t[0]?'btn-g':'!bg-transparent border border-line'" @click="setTab(t[0])">{{ t[1] }}</button></div>
  <div v-if="cats.length" class="flex gap-1 flex-wrap items-center"><button class="btn !py-1 text-xs" :class="!catFilter?'btn-g':'!bg-transparent border border-line'" @click="setCatFilter('')">Tất cả</button><button v-for="c in cats" :key="c.id" class="btn !py-1 text-xs" :class="catFilter===c.id?'btn-g':'!bg-transparent border border-line'" @click="setCatFilter(c.id)">🏷️ {{ c.name }} ({{ c.count }})</button></div>
  <div v-if="!list.length" class="card p-4 text-sm text-mute">Chưa có sự kiện nào.</div>
  <button v-for="e in list" :key="e.id" class="uc-row w-full text-left block" @click="show(e.id)">
   <b class="block break-words">{{ e.title }}</b><span class="block text-sm text-mute">🕐 {{ fdt(e.start) }}<span v-if="e.location"> · 📍 {{ e.location }}</span></span>
   <span class="block text-xs text-mute mt-1"><span v-if="e.cat">🏷️ {{ e.cat.name }} · </span>{{ e.owner&&e.owner.name }} · ✅ {{ e.goingNum }}<span v-if="e.limit">/{{ e.limit }}</span> · 💬 {{ e.commentNum }}<span v-if="e.past"> · đã qua</span></span>
  </button>
  <button v-if="hasMore" class="btn w-full !bg-transparent border border-line" :disabled="busyMore" @click="more">{{ busyMore?'Đang tải…':'Xem thêm' }}</button>
 </template>
</div>`};

/* Component: Bình chọn (poll của UCHome): danh sách -> bình chọn / xem kết quả -> tạo mới */
const CPolls={props:{open:String},emits:['used'],
data:()=>({tab:'all',list:[],total:0,pg:1,busy:false,busyMore:false,err:'',cur:null,form:null,pick:[],VI:VIS3,TABS:[['all','Tất cả'],['friends','Của bạn bè'],['mine','Của tôi']]}),
created(){if(this.open){const id=this.open;this.$emit('used');this.show(id)}else this.load()},
computed:{hasMore(){return this.list.length<this.total}},
methods:{ago,fdt,
 async run(fn){this.err='';try{await fn()}catch(e){this.err=e.message}},
 load(){this.busy=true;this.pg=1;return this.run(async()=>{const d=await api('GET','/polls?view='+this.tab+'&page=1');this.list=d.polls;this.total=d.total}).finally(()=>this.busy=false)},
 more(){if(this.busyMore)return;this.busyMore=true;return this.run(async()=>{const d=await api('GET','/polls?view='+this.tab+'&page='+(this.pg+1));this.pg++;this.total=d.total;const have=new Set(this.list.map(x=>x.id));this.list.push(...d.polls.filter(x=>!have.has(x.id)))}).finally(()=>this.busyMore=false)},
 setTab(t){this.tab=t;this.load()},
 show(id){this.busy=true;this.form=null;return this.run(async()=>{this.cur=(await api('GET','/polls/'+id)).poll;this.pick=[]}).finally(()=>this.busy=false)},
 back(){this.cur=null;this.form=null;this.load()},
 write(){this.err='';this.form={question:'',options:['',''],multiple:false,maxChoice:2,days:7,visibility:'public'}},
 addOpt(){if(this.form.options.length<10)this.form.options.push('')},
 delOpt(i){if(this.form.options.length>2)this.form.options.splice(i,1)},
 save(){const f=this.form,opts=f.options.map(x=>x.trim()).filter(Boolean);if(!f.question.trim()||opts.length<2){this.err='Hãy nhập câu hỏi và ít nhất 2 lựa chọn.';return}
  this.busy=true;return this.run(async()=>{const d=await api('POST','/polls',{question:f.question,options:opts,multiple:f.multiple,maxChoice:f.multiple?Math.min(Number(f.maxChoice)||2,opts.length):1,days:Number(f.days)||0,visibility:f.visibility});this.form=null;this.cur=d.poll;this.pick=[]}).finally(()=>this.busy=false)},
 tog(i){const c=this.cur;if(!c.multiple){this.pick=[i];return}const k=this.pick.indexOf(i);if(k>=0)this.pick.splice(k,1);else if(this.pick.length<c.maxChoice)this.pick.push(i)},
 vote(){if(!this.pick.length){this.err='Hãy chọn một đáp án.';return}this.run(async()=>{this.cur=(await api('POST','/polls/'+this.cur.id+'/vote',{choices:this.pick})).poll;this.pick=[]})},
 del(){if(!confirm('Xóa bình chọn này cùng toàn bộ kết quả?'))return;this.run(async()=>{await api('DELETE','/polls/'+this.cur.id);this.cur=null;await this.load()})}},
template:`<div class="space-y-3">
 <p v-if="err" class="text-sm" style="color:#d64545" role="alert">{{ err }}</p>
 <div v-if="busy&&!list.length&&!cur&&!form" class="card p-4 text-sm text-mute">Đang tải…</div>
 <form v-else-if="form" class="card p-4 space-y-3" @submit.prevent="save">
  <input v-model="form.question" class="ip" maxlength="100" placeholder="Câu hỏi bình chọn" aria-label="Câu hỏi">
  <div v-for="(o,i) in form.options" :key="i" class="flex gap-2"><input v-model="form.options[i]" class="ip" maxlength="60" :placeholder="'Lựa chọn '+(i+1)" :aria-label="'Lựa chọn '+(i+1)"><button v-if="form.options.length>2" type="button" class="gh" aria-label="Xóa lựa chọn" @click="delOpt(i)">✕</button></div>
  <button v-if="form.options.length<10" type="button" class="gh text-sm" @click="addOpt">＋ Thêm lựa chọn</button>
  <div class="flex items-center gap-3 flex-wrap text-sm"><label class="flex items-center gap-1"><input v-model="form.multiple" type="checkbox"> Cho chọn nhiều</label>
   <label v-if="form.multiple" class="flex items-center gap-1">tối đa <select v-model.number="form.maxChoice" class="ip !w-auto text-sm"><option v-for="n in form.options.length-1" :key="n" :value="n+1">{{ n+1 }}</option></select> đáp án</label></div>
  <div class="flex items-center gap-2 flex-wrap"><select v-model.number="form.days" class="ip !w-auto text-sm" aria-label="Hạn bình chọn"><option :value="1">Hạn 1 ngày</option><option :value="3">Hạn 3 ngày</option><option :value="7">Hạn 7 ngày</option><option :value="30">Hạn 30 ngày</option><option :value="0">Không giới hạn</option></select>
   <select v-model="form.visibility" class="ip !w-auto text-sm" aria-label="Ai xem được"><option v-for="(v,k) in VI" :key="k" :value="k">{{ v[0] }} {{ v[1] }}</option></select>
   <button type="button" class="btn !bg-transparent border border-line ml-auto" @click="form=null">Hủy</button><button class="btn btn-g" :disabled="busy">Tạo bình chọn</button></div>
 </form>
 <template v-else-if="cur">
  <button class="gh" @click="back">« Danh sách bình chọn</button>
  <article class="card p-4 space-y-3">
   <h2 class="!m-0 text-lg font-bold break-words">📊 {{ cur.question }}</h2>
   <div class="text-xs text-mute">{{ cur.owner&&cur.owner.name }} · {{ ago(cur.createdAt) }} · {{ VI[cur.visibility][0] }} · {{ cur.voterNum }} người đã chọn<span v-if="cur.multiple"> · chọn tối đa {{ cur.maxChoice }}</span><span v-if="cur.expires"> · {{ cur.expired?'đã hết hạn':'hạn '+fdt(cur.expires) }}</span></div>
   <template v-if="cur.canVote">
    <label v-for="o in cur.options" :key="o.i" class="flex items-center gap-2 p-2 rounded cursor-pointer" style="background:var(--soft)"><input :type="cur.multiple?'checkbox':'radio'" :checked="pick.includes(o.i)" @change="tog(o.i)"><span class="break-words min-w-0">{{ o.text }}</span></label>
    <button class="btn btn-g" @click="vote">Bình chọn</button>
   </template>
   <template v-else>
    <div v-for="o in cur.options" :key="o.i" class="space-y-1"><div class="flex justify-between gap-2 text-sm"><span class="break-words min-w-0">{{ cur.my&&cur.my.includes(o.i)?'✅ ':'' }}{{ o.text }}</span><b class="shrink-0">{{ o.voteNum }} · {{ o.pct }}%</b></div><div class="h-2 rounded-full overflow-hidden" style="background:var(--soft)"><div class="h-full" :style="{width:o.pct+'%',background:'var(--accg)'}"></div></div></div>
    <p v-if="cur.expired&&!cur.my" class="text-sm text-mute">Bình chọn đã hết hạn.</p>
   </template>
   <div v-if="cur.mine" class="flex gap-2"><button class="btn !bg-transparent border border-line" @click="del">🗑️ Xóa</button></div>
  </article>
  <div v-if="cur.voters.length" class="card p-4 space-y-2"><b class="text-sm">Người bình chọn gần đây</b><div class="flex gap-2 flex-wrap"><span v-for="u in cur.voters" :key="u.id" class="flex items-center gap-1 text-sm"><c-av :name="u.name" :src="u.avatar" :size="28"></c-av>{{ u.name }}</span></div></div>
 </template>
 <template v-else>
  <button class="btn btn-g w-full" @click="write()">＋ Tạo bình chọn</button>
  <div class="flex gap-1 flex-wrap"><button v-for="t in TABS" :key="t[0]" class="btn !py-1 text-sm" :class="tab===t[0]?'btn-g':'!bg-transparent border border-line'" @click="setTab(t[0])">{{ t[1] }}</button></div>
  <div v-if="!list.length" class="card p-4 text-sm text-mute">Chưa có bình chọn nào.</div>
  <button v-for="p in list" :key="p.id" class="uc-row w-full text-left block" @click="show(p.id)">
   <b class="block break-words">📊 {{ p.question }}</b>
   <span class="block text-xs text-mute mt-1">{{ p.owner&&p.owner.name }} · {{ ago(p.createdAt) }} · {{ p.optionNum }} lựa chọn · {{ p.voterNum }} người đã chọn<span v-if="p.expired"> · hết hạn</span></span>
  </button>
  <button v-if="hasMore" class="btn w-full !bg-transparent border border-line" :disabled="busyMore" @click="more">{{ busyMore?'Đang tải…':'Xem thêm' }}</button>
 </template>
</div>`};


export { CEvents, CPolls, VIS3, fdt };
