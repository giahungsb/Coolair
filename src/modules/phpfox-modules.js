import { VIS3 } from './events-polls.js';
import { ago, api } from '../lib/core.js';
/* Component: Trắc nghiệm (port module quiz của phpFox) */
const CQuizzes={props:{open:String},emits:['used'],
data:()=>({tab:'all',list:[],total:0,pg:1,quiz:null,form:null,pick:[],results:[],VI:VIS3,busy:false,busyMore:false,err:''}),
created(){if(this.open){const id=this.open;this.$emit('used');this.show(id)}else this.load()},
computed:{hasMore(){return this.list.length<this.total}},
methods:{ago,
 async run(fn){this.err='';try{await fn()}catch(e){this.err=e.message}},
 load(){this.busy=true;this.pg=1;return this.run(async()=>{const d=await api('GET','/quizzes?view='+this.tab+'&page=1');this.list=d.quizzes;this.total=d.total}).finally(()=>this.busy=false)},
 more(){if(this.busyMore)return;this.busyMore=true;return this.run(async()=>{const d=await api('GET','/quizzes?view='+this.tab+'&page='+(this.pg+1));this.pg++;this.total=d.total;const h=new Set(this.list.map(q=>q.id));this.list.push(...d.quizzes.filter(q=>!h.has(q.id)))}).finally(()=>this.busyMore=false)},
 setTab(t){this.tab=t;this.quiz=null;this.load()},
 show(id){this.busy=true;this.form=null;return this.run(async()=>{this.quiz=(await api('GET','/quizzes/'+id)).quiz;this.pick=this.quiz.questions.map(()=>-1);this.results=[]}).finally(()=>this.busy=false)},
 back(){this.quiz=null;this.form=null;this.load()},
 write(){this.form={title:'',desc:'',visibility:'public',questions:[{text:'',options:['',''],answer:0}]}},
 qAdd(){if(this.form.questions.length<50)this.form.questions.push({text:'',options:['',''],answer:0})},
 qDel(i){if(this.form.questions.length>1)this.form.questions.splice(i,1)},
 oAdd(q){if(q.options.length<6)q.options.push('')},
 oDel(q,i){if(q.options.length>2){q.options.splice(i,1);if(q.answer>=q.options.length)q.answer=0}},
 save(){const f=this.form;const qs=f.questions.map(q=>({text:q.text.trim(),options:q.options.map(o=>o.trim()).filter(Boolean),answer:Number(q.answer)||0}));
  if(!f.title.trim()||qs.some(q=>!q.text||q.options.length<2)){this.err='Nhập tiêu đề và điền đủ các câu hỏi (mỗi câu ít nhất 2 đáp án).';return}
  this.busy=true;return this.run(async()=>{const d=await api('POST','/quizzes',{title:f.title,desc:f.desc,visibility:f.visibility,questions:qs});this.form=null;this.show(d.quiz.id)}).finally(()=>this.busy=false)},
 submit(){const q=this.quiz;if(this.pick.some(c=>c<0)){this.err='Bạn chưa trả lời hết các câu hỏi.';return}
  this.run(async()=>{const d=await api('POST','/quizzes/'+q.id+'/take',{choices:this.pick});q.myScore={score:d.score,total:d.total};const r=await api('GET','/quizzes/'+q.id);this.quiz=r.quiz;this.results=(await api('GET','/quizzes/'+q.id+'/results')).results})},
 loadResults(){this.run(async()=>{this.results=(await api('GET','/quizzes/'+this.quiz.id+'/results')).results})},
 del(){if(!confirm('Xóa quiz này cùng toàn bộ kết quả?'))return;this.run(async()=>{await api('DELETE','/quizzes/'+this.quiz.id);this.back()})}},
template:`<div class="space-y-3">
 <p v-if="err" class="text-sm" style="color:#d64545" role="alert">{{ err }}</p>
 <template v-if="quiz">
  <button class="gh" @click="back">« Danh sách quiz</button>
  <article class="card p-4 space-y-3">
   <h2 class="!m-0 text-lg font-bold break-words">❓ {{ quiz.title }}</h2>
   <div class="text-xs text-mute">{{ quiz.owner&&quiz.owner.name }} · {{ ago(quiz.createdAt) }} · {{ VI[quiz.visibility][0] }} · {{ quiz.takes }} lượt làm</div>
   <p v-if="quiz.desc" class="text-sm text-mute break-words">{{ quiz.desc }}</p>
   <c-favrate kind="quiz" :refid="quiz.id" :title="quiz.title"></c-favrate>
   <div v-if="quiz.myScore" class="card p-3 text-center" style="background:var(--soft)"><b class="text-lg">🎯 {{ quiz.myScore.score }}/{{ quiz.myScore.total }}</b><div class="text-xs text-mute">Kết quả của bạn</div></div>
   <div v-for="(q,qi) in quiz.questions" :key="qi" class="card p-3 space-y-2" style="background:var(--soft)">
    <b class="text-sm break-words">Câu {{ qi+1 }}: {{ q.text }}</b>
    <label v-for="(o,oi) in q.options" :key="oi" class="flex items-center gap-2 text-sm p-1.5 rounded cursor-pointer" :class="{'font-bold':q.answer===oi&&quiz.myScore}">
     <input v-if="!quiz.myScore&&!quiz.mine" type="radio" :name="'q'+qi" :checked="pick[qi]===oi" @change="pick[qi]=oi">
     <span>{{ q.answer===oi&&quiz.myScore?'✅ ':'' }}{{ o }}</span>
    </label>
   </div>
   <div class="flex gap-2 flex-wrap">
    <button v-if="!quiz.myScore&&!quiz.mine" class="btn btn-g" @click="submit">Nộp bài</button>
    <button v-if="quiz.myScore||quiz.mine" class="btn !bg-transparent border border-line" @click="loadResults">🏆 Bảng xếp hạng</button>
    <button v-if="quiz.mine" class="btn !bg-transparent border border-line !text-[#d64545]" @click="del">🗑️ Xóa</button>
   </div>
  </article>
  <div v-if="results.length" class="card p-4 space-y-1"><b class="text-sm">🏆 Bảng xếp hạng</b>
   <div v-for="(r,i) in results" :key="r.user.id" class="mi"><span class="w-6 text-mute text-sm">{{ i+1 }}</span><c-av :name="r.user.name" :src="r.user.avatar" :size="28"></c-av><span class="flex-1 truncate text-sm">{{ r.user.name }}</span><b class="text-sm">{{ r.score }}/{{ r.total }}</b></div>
  </div>
 </template>
 <template v-else-if="form">
  <button class="gh" @click="form=null">« Danh sách quiz</button>
  <form class="card p-4 space-y-3" @submit.prevent="save">
   <input v-model="form.title" class="ip" maxlength="120" placeholder="Tiêu đề quiz" aria-label="Tiêu đề">
   <textarea v-model="form.desc" class="ip" rows="2" maxlength="1000" placeholder="Mô tả (không bắt buộc)" aria-label="Mô tả"></textarea>
   <select v-model="form.visibility" class="ip !w-auto text-sm" aria-label="Ai xem được"><option v-for="(v,k) in VI" :key="k" :value="k">{{ v[0] }} {{ v[1] }}</option></select>
   <div v-for="(q,qi) in form.questions" :key="qi" class="card p-3 space-y-2" style="background:var(--soft)">
    <div class="flex items-center gap-2"><b class="text-sm">Câu {{ qi+1 }}</b><button v-if="form.questions.length>1" type="button" class="gh ml-auto !text-xs" @click="qDel(qi)">Xóa câu</button></div>
    <input v-model="q.text" class="ip text-sm" maxlength="300" :placeholder="'Nội dung câu '+(qi+1)" :aria-label="'Câu '+(qi+1)">
    <div v-for="(o,oi) in q.options" :key="oi" class="flex gap-2 items-center">
     <input v-model="q.options[oi]" type="radio" :name="'a'+qi" :value="oi" :checked="q.answer===oi" @change="q.answer=oi" :aria-label="'Đáp án đúng câu '+(qi+1)" title="Đánh dấu đáp án đúng">
     <input v-model="q.options[oi]" class="ip text-sm flex-1" maxlength="120" :placeholder="'Đáp án '+(oi+1)" :aria-label="'Đáp án '+(oi+1)">
     <button v-if="q.options.length>2" type="button" class="gh" @click="oDel(q,oi)">✕</button>
    </div>
    <button v-if="q.options.length<6" type="button" class="gh text-sm" @click="oAdd(q)">＋ Thêm đáp án</button>
    <p class="text-xs text-mute">Tick vào ô tròn trước đáp án đúng.</p>
   </div>
   <button v-if="form.questions.length<50" type="button" class="btn !bg-transparent border border-line" @click="qAdd">＋ Thêm câu hỏi</button>
   <div class="flex gap-2 justify-end"><button type="button" class="btn !bg-transparent border border-line" @click="form=null">Hủy</button><button class="btn btn-g" :disabled="busy">Tạo quiz</button></div>
  </form>
 </template>
 <template v-else>
  <button class="btn btn-g w-full" @click="write">＋ Tạo quiz</button>
  <div class="flex gap-1 flex-wrap"><button v-for="t in [['all','Tất cả'],['friends','Của bạn bè'],['mine','Của tôi']]" :key="t[0]" class="btn !py-1 text-sm" :class="tab===t[0]?'btn-g':'!bg-transparent border border-line'" @click="setTab(t[0])">{{ t[1] }}</button></div>
  <div v-if="!list.length&&!busy" class="card p-4 text-sm text-mute">Chưa có quiz nào.</div>
  <button v-for="q in list" :key="q.id" class="uc-row w-full text-left block" @click="show(q.id)">
   <b class="break-words">❓ {{ q.title }}</b>
   <span class="block text-xs text-mute mt-1">{{ q.owner&&q.owner.name }} · {{ q.questionNum }} câu · {{ q.takes }} lượt làm · {{ ago(q.createdAt) }}</span>
  </button>
  <button v-if="hasMore" class="btn w-full !bg-transparent border border-line" :disabled="busyMore" @click="more">{{ busyMore?'Đang tải…':'Xem thêm' }}</button>
 </template>
</div>`};

/* Component: Trang cộng đồng (port module pages của phpFox) */
const CPages={props:{open:String},emits:['used'],
data:()=>({tab:'all',list:[],total:0,pg:1,cat:'',cats:[],q:'',page:null,pform:null,admins:[],busy:false,busyMore:false,err:''}),
created(){this.loadCats();if(this.open){const id=this.open;this.$emit('used');this.show(id)}else this.load()},
computed:{hasMore(){return this.list.length<this.total}},
methods:{ago,
 async run(fn){this.err='';try{await fn()}catch(e){this.err=e.message}},
 async loadCats(){try{this.cats=(await api('GET','/page-cats')).cats}catch(e){}},
 load(){this.busy=true;this.pg=1;const p=new URLSearchParams({page:1,sort:'likes'});if(this.tab==='mine')p.set('mine','1');if(this.tab==='liked')p.set('liked','1');if(this.cat)p.set('cat',this.cat);if(this.q.trim())p.set('q',this.q.trim());
  return this.run(async()=>{const d=await api('GET','/pages?'+p);this.list=d.pages;this.total=d.total}).finally(()=>this.busy=false)},
 more(){if(this.busyMore)return;this.busyMore=true;const p=new URLSearchParams({page:this.pg+1,sort:'likes'});if(this.tab==='mine')p.set('mine','1');if(this.tab==='liked')p.set('liked','1');if(this.cat)p.set('cat',this.cat);if(this.q.trim())p.set('q',this.q.trim());
  return this.run(async()=>{const d=await api('GET','/pages?'+p);this.pg++;this.total=d.total;const h=new Set(this.list.map(x=>x.id));this.list.push(...d.pages.filter(x=>!h.has(x.id)))}).finally(()=>this.busyMore=false)},
 setTab(t){this.tab=t;this.page=null;this.load()},
 show(id){this.busy=true;return this.run(async()=>{this.page=(await api('GET','/pages/'+id)).page}).finally(()=>this.busy=false)},
 back(){this.page=null;this.pform=null;this.load()},
 write(){this.pform={name:'',desc:'',cat:'',pic:'',cover:''}},
 save(){const f=this.pform;if(!f.name.trim()){this.err='Nhập tên trang.';return}
  this.busy=true;return this.run(async()=>{const d=await api('POST','/pages',{name:f.name,desc:f.desc,cat:f.cat||undefined,pic:f.pic,cover:f.cover});this.pform=null;this.show(d.page.id)}).finally(()=>this.busy=false)},
 togLike(){const p=this.page;this.run(async()=>{const d=p.liked?await api('DELETE','/pages/'+p.id+'/like'):await api('POST','/pages/'+p.id+'/like');p.liked=d.liked;p.likeNum+=d.liked?1:-1})},
 del(){if(!confirm('Xóa trang này?'))return;this.run(async()=>{await api('DELETE','/pages/'+this.page.id);this.back()})},
 edit(){const p=this.page;this.pform={name:p.name,desc:p.desc,cat:p.cat?p.cat.id:'',pic:p.pic,cover:p.cover,edit:true}},
 saveEdit(){const f=this.pform,p=this.page;this.busy=true;
  return this.run(async()=>{await api('PATCH','/pages/'+p.id,{name:f.name,desc:f.desc,cat:f.cat||undefined,pic:f.pic,cover:f.cover});this.pform=null;this.show(p.id)}).finally(()=>this.busy=false)}},
template:`<div class="space-y-3">
 <p v-if="err" class="text-sm" style="color:#d64545" role="alert">{{ err }}</p>
 <template v-if="page">
  <button class="gh" @click="back">« Danh sách trang</button>
  <div class="card overflow-hidden">
   <div v-if="page.cover" class="h-32 bg-cover bg-center" :style="{backgroundImage:'url('+page.cover+')'}"></div>
   <div class="p-4 space-y-2">
    <div class="flex items-center gap-3"><c-av :name="page.name" :src="page.pic" :size="64" sq></c-av>
     <div class="min-w-0"><b class="text-lg break-words">{{ page.name }}<span v-if="page.verified" title="Trang đã xác thực"> ✔️</span></b>
     <div class="text-xs text-mute"><span v-if="page.cat">{{ page.cat.name }} · </span>👍 {{ page.likeNum }} người thích</div></div></div>
    <p v-if="page.desc" class="text-sm whitespace-pre-wrap break-words">{{ page.desc }}</p>
    <div class="flex gap-2 flex-wrap">
     <button class="btn !h-9 text-sm" :class="page.liked?'!bg-transparent border border-line':'btn-g'" @click="togLike">{{ page.liked?'✓ Đã thích':'👍 Thích trang' }}</button>
     <button v-if="page.canAdmin" class="btn !bg-transparent border border-line !h-9 text-sm" @click="page._edit=!page._edit">{{ page._edit?'Đóng':'⚙️ Quản lý' }}</button>
     <button v-if="page.canAdmin" class="btn !bg-transparent border border-line !h-9 text-sm !text-[#d64545]" @click="del">🗑️ Xóa trang</button>
    </div>
    <c-favrate kind="page" :refid="page.id" :title="page.name"></c-favrate>
    <div v-if="page._edit&&page.canAdmin" class="card p-3 space-y-2" style="background:var(--soft)">
     <b class="text-sm">Quản trị trang</b>
     <button class="btn !bg-transparent border border-line !h-8 text-sm" @click="edit">✏️ Sửa thông tin</button>
     <div class="text-xs text-mute">Quản trị viên: {{ page.admins.map(a=>a.name).join(', ') }}</div>
    </div>
    <form v-if="pform&&pform.edit" class="card p-3 space-y-2" style="background:var(--soft)" @submit.prevent="saveEdit">
     <input v-model="pform.name" class="ip text-sm" maxlength="80" placeholder="Tên trang" aria-label="Tên trang">
     <div class="flex gap-2"><input v-model="pform.pic" class="ip flex-1 text-sm" maxlength="300" placeholder="URL ảnh đại diện" aria-label="Ảnh đại diện"><input v-model="pform.cover" class="ip flex-1 text-sm" maxlength="300" placeholder="URL ảnh bìa" aria-label="Ảnh bìa"></div>
     <select v-model="pform.cat" class="ip !w-auto text-sm" aria-label="Chuyên mục"><option value="">— Chuyên mục —</option><option v-for="c in cats" :key="c.id" :value="c.id">{{ c.name }}</option></select>
     <textarea v-model="pform.desc" class="ip text-sm" rows="3" maxlength="2000" placeholder="Giới thiệu" aria-label="Giới thiệu"></textarea>
     <div class="flex gap-2 justify-end"><button type="button" class="btn !bg-transparent border border-line !h-8 text-sm" @click="pform=null">Hủy</button><button class="btn btn-g !h-8 text-sm" :disabled="busy">Lưu</button></div>
    </form>
   </div>
  </div>
 </template>
 <template v-else-if="pform&&!pform.edit">
  <button class="gh" @click="pform=null">« Danh sách trang</button>
  <form class="card p-4 space-y-3" @submit.prevent="save">
   <input v-model="pform.name" class="ip" maxlength="80" placeholder="Tên trang" aria-label="Tên trang">
   <div class="flex gap-2"><input v-model="pform.pic" class="ip flex-1 text-sm" maxlength="300" placeholder="URL ảnh đại diện (không bắt buộc)" aria-label="Ảnh đại diện"><input v-model="pform.cover" class="ip flex-1 text-sm" maxlength="300" placeholder="URL ảnh bìa (không bắt buộc)" aria-label="Ảnh bìa"></div>
   <select v-model="pform.cat" class="ip !w-auto text-sm" aria-label="Chuyên mục"><option value="">— Chuyên mục —</option><option v-for="c in cats" :key="c.id" :value="c.id">{{ c.name }}</option></select>
   <textarea v-model="pform.desc" class="ip" rows="3" maxlength="2000" placeholder="Giới thiệu về trang…" aria-label="Giới thiệu"></textarea>
   <div class="flex gap-2 justify-end"><button type="button" class="btn !bg-transparent border border-line" @click="pform=null">Hủy</button><button class="btn btn-g" :disabled="busy">Tạo trang</button></div>
  </form>
 </template>
 <template v-else>
  <button class="btn btn-g w-full" @click="write">＋ Tạo trang</button>
  <div class="flex gap-1 flex-wrap">
   <button v-for="t in [['all','Nổi bật'],['mine','Trang của tôi'],['liked','Đã thích']]" :key="t[0]" class="btn !py-1 text-sm" :class="tab===t[0]?'btn-g':'!bg-transparent border border-line'" @click="setTab(t[0])">{{ t[1] }}</button>
   <select v-model="cat" class="ip !w-auto !h-8 text-sm" @change="load" aria-label="Chuyên mục"><option value="">Tất cả chuyên mục</option><option v-for="c in cats" :key="c.id" :value="c.id">{{ c.name }}</option></select>
   <input v-model="q" class="ip flex-1 text-sm !h-8" maxlength="40" placeholder="Tìm trang…" @keydown.enter="load" aria-label="Tìm trang">
  </div>
  <div v-if="!list.length&&!busy" class="card p-4 text-sm text-mute">Chưa có trang nào.</div>
  <button v-for="p in list" :key="p.id" class="uc-row w-full text-left block" @click="show(p.id)">
   <span class="flex items-center gap-2"><c-av :name="p.name" :src="p.pic" :size="40" sq></c-av><span class="min-w-0"><b class="break-words">{{ p.name }}<span v-if="p.verified"> ✔️</span></b><span class="block text-xs text-mute mt-0.5">👍 {{ p.likeNum }} người thích</span></span></span>
  </button>
  <button v-if="hasMore" class="btn w-full !bg-transparent border border-line" :disabled="busyMore" @click="more">{{ busyMore?'Đang tải…':'Xem thêm' }}</button>
 </template>
</div>`};

/* Component: Quà tặng ảo (port module egift của phpFox) */
const CGifts={
data:()=>({tab:'shop',cats:[],received:[],rtotal:0,rpg:1,sent:[],friends:[],sendFor:null,to:'',msg:'',busy:false,err:''}),
created(){this.loadCats();this.loadFriends()},
methods:{ago,
 async run(fn){this.err='';try{await fn()}catch(e){this.err=e.message}},
 async loadCats(){try{this.cats=(await api('GET','/gifts')).cats}catch(e){}},
 async loadFriends(){try{this.friends=(await api('GET','/friends')).friends||[]}catch(e){this.friends=[]}},
 setTab(t){this.tab=t;if(t==='received')this.loadReceived();if(t==='sent')this.loadSent()},
 loadReceived(){this.busy=true;this.rpg=1;return this.run(async()=>{const d=await api('GET','/gifts/received?page=1');this.received=d.gifts;this.rtotal=d.total}).finally(()=>this.busy=false)},
 loadSent(){this.busy=true;return this.run(async()=>{this.sent=(await api('GET','/gifts/sent')).gifts}).finally(()=>this.busy=false)},
 openSend(g){this.sendFor=g;this.to='';this.msg=''},
 doSend(){if(!this.to){this.err='Hãy chọn bạn để tặng.';return}
  this.run(async()=>{await api('POST','/gifts/'+this.sendFor.id+'/send',{to:this.to,message:this.msg});this.sendFor=null;this.msg='';this.tab='sent';this.loadSent()})},
 delReceived(g){if(!confirm('Gỡ quà này khỏi trang của bạn?'))return;this.run(async()=>{await api('DELETE','/gifts/received/'+g.id);this.received=this.received.filter(x=>x.id!==g.id);this.rtotal--})}},
template:`<div class="space-y-3">
 <p v-if="err" class="text-sm" style="color:#d64545" role="alert">{{ err }}</p>
 <div class="flex gap-1 flex-wrap"><button v-for="t in [['shop','Cửa hàng quà'],['received','Quà được tặng'],['sent','Đã tặng']]" :key="t[0]" class="btn !py-1 text-sm" :class="tab===t[0]?'btn-g':'!bg-transparent border border-line'" @click="setTab(t[0])">{{ t[1] }}</button></div>
 <template v-if="tab==='shop'">
  <div v-for="c in cats" :key="c.id" class="card p-3 space-y-2"><b class="text-sm">🎁 {{ c.name }}</b>
   <div class="grid grid-cols-2 min-[520px]:grid-cols-3 gap-2">
    <div v-for="g in c.gifts" :key="g.id" class="card p-3 text-center space-y-1" style="background:var(--soft)">
     <div class="text-4xl">{{ g.icon }}</div><b class="text-sm block">{{ g.name }}</b>
     <button class="btn btn-g !h-8 text-sm w-full" @click="openSend(g)">Tặng</button>
    </div>
   </div>
  </div>
  <p v-if="!cats.length&&!busy" class="card p-4 text-sm text-mute">Chưa có quà nào. Quản trị viên thêm ở Quản trị → Danh mục.</p>
  <div v-if="sendFor" class="card p-4 space-y-3">
   <b>Tặng {{ sendFor.icon }} {{ sendFor.name }}</b>
   <select v-model="to" class="ip text-sm" aria-label="Chọn bạn"><option value="">— Chọn bạn —</option><option v-for="f in friends" :key="f.id" :value="f.id">{{ f.name }}</option></select>
   <input v-model="msg" class="ip text-sm" maxlength="200" placeholder="Lời nhắn (không bắt buộc)" aria-label="Lời nhắn">
   <div class="flex gap-2 justify-end"><button class="btn !bg-transparent border border-line" @click="sendFor=null">Hủy</button><button class="btn btn-g" :disabled="busy" @click="doSend">Gửi quà</button></div>
  </div>
 </template>
 <template v-else-if="tab==='received'">
  <div v-if="!received.length&&!busy" class="card p-4 text-sm text-mute">Bạn chưa được tặng quà nào.</div>
  <div v-for="g in received" :key="g.id" class="card p-3 flex items-center gap-3">
   <span class="text-4xl">{{ g.gift.icon }}</span>
   <div class="flex-1 min-w-0"><b class="text-sm">{{ g.gift.name }}</b><div class="text-xs text-mute">từ {{ g.from.name }} · {{ ago(g.createdAt) }}</div><p v-if="g.message" class="text-sm break-words">“{{ g.message }}”</p></div>
   <button class="gh !text-xs" @click="delReceived(g)">Gỡ</button>
  </div>
 </template>
 <template v-else>
  <div v-if="!sent.length&&!busy" class="card p-4 text-sm text-mute">Bạn chưa tặng quà cho ai.</div>
  <div v-for="g in sent" :key="g.id" class="card p-3 flex items-center gap-3">
   <span class="text-4xl">{{ g.gift.icon }}</span>
   <div class="flex-1 min-w-0"><b class="text-sm">{{ g.gift.name }}</b><div class="text-xs text-mute">tặng {{ g.to.name }} · {{ ago(g.createdAt) }}</div></div>
  </div>
 </template>
</div>`};

/* Component: Hộp thư đầy đủ (port module mail của phpFox) – hội thoại + thùng rác */
const CMail={
data:()=>({tab:'inbox',convos:[],trash:[],thread:[],other:null,busy:false,err:''}),
created(){this.load()},
methods:{ago,
 async run(fn){this.err='';try{await fn()}catch(e){this.err=e.message}},
 load(){this.busy=true;return this.run(async()=>{this.convos=(await api('GET','/mail')).convos}).finally(()=>this.busy=false)},
 loadTrash(){this.busy=true;return this.run(async()=>{this.trash=(await api('GET','/mail/trash')).convos}).finally(()=>this.busy=false)},
 setTab(t){this.tab=t;this.other=null;this.thread=[];if(t==='trash')this.loadTrash();else this.load()},
 open(c){this.other=c.user;this.busy=true;return this.run(async()=>{this.thread=await api('GET','/messages/'+c.user.id);this.load()}).finally(()=>this.busy=false)},
 back(){this.other=null;this.thread=[];this.setTab(this.tab)},
 trashIt(){if(!confirm('Chuyển hội thoại này vào thùng rác?'))return;this.run(async()=>{await api('POST','/mail/'+this.other.id+'/trash');this.back()})},
 restore(){this.run(async()=>{await api('POST','/mail/'+this.other.id+'/restore');this.back()})},
 delForever(){if(!confirm('Xóa vĩnh viễn các tin đã vào thùng rác ở cả 2 phía?'))return;this.run(async()=>{await api('DELETE','/mail/'+this.other.id);this.back()})}},
template:`<div class="space-y-3">
 <p v-if="err" class="text-sm" style="color:#d64545" role="alert">{{ err }}</p>
 <div class="flex gap-1"><button class="btn !py-1 text-sm" :class="tab==='inbox'?'btn-g':'!bg-transparent border border-line'" @click="setTab('inbox')">📥 Hộp thư</button><button class="btn !py-1 text-sm" :class="tab==='trash'?'btn-g':'!bg-transparent border border-line'" @click="setTab('trash')">🗑️ Thùng rác</button></div>
 <template v-if="other">
  <button class="gh" @click="back">« {{ tab==='trash'?'Thùng rác':'Hộp thư' }}</button>
  <div class="card p-4 space-y-2">
   <div class="flex items-center gap-2"><c-av :name="other.name" :src="other.avatar" :size="36"></c-av><b>{{ other.name }}</b>
    <span class="ml-auto flex gap-2"><button v-if="tab==='inbox'" class="gh !text-xs" @click="trashIt">Vào thùng rác</button><button v-if="tab==='trash'" class="gh !text-xs" @click="restore">Khôi phục</button><button v-if="tab==='trash'" class="gh !text-xs !text-[#d64545]" @click="delForever">Xóa vĩnh viễn</button></span></div>
   <div v-if="tab==='inbox'" class="text-xs text-mute">Nhắn tin trong tab Bạn bè → Tin nhắn.</div>
   <div v-for="m in thread" :key="m.id" class="text-sm" :class="m.mine?'text-right':''"><c-tx class="inline-block px-2 py-1 rounded" style="background:var(--soft)" :t="m.text"/><div class="text-xs text-mute">{{ ago(m.createdAt) }}</div></div>
  </div>
 </template>
 <template v-else-if="tab==='inbox'">
  <div v-if="!convos.length&&!busy" class="card p-4 text-sm text-mute">Hộp thư trống.</div>
  <button v-for="c in convos" :key="c.user.id" class="uc-row w-full text-left" @click="open(c)">
   <span class="flex items-center gap-2"><c-av :name="c.user.name" :src="c.user.avatar" :size="40"></c-av>
   <span class="flex-1 min-w-0"><b class="text-sm">{{ c.user.name }}<span v-if="c.unread" class="ml-1 px-1.5 rounded text-xs" style="background:#d64545;color:#fff">{{ c.unread }}</span></b><span class="block text-xs text-mute truncate">{{ c.mine?'Bạn: ':'' }}{{ c.lastText }}</span></span>
   <span class="text-xs text-mute shrink-0">{{ ago(c.lastAt) }}</span></span>
  </button>
 </template>
 <template v-else>
  <div v-if="!trash.length&&!busy" class="card p-4 text-sm text-mute">Thùng rác trống.</div>
  <button v-for="c in trash" :key="c.user.id" class="uc-row w-full text-left" @click="open(c)">
   <span class="flex items-center gap-2"><c-av :name="c.user.name" :src="c.user.avatar" :size="40"></c-av>
   <span class="flex-1 min-w-0"><b class="text-sm">{{ c.user.name }}</b><span class="block text-xs text-mute truncate">{{ c.lastText }} · {{ c.count }} tin</span></span>
   <span class="text-xs text-mute shrink-0">{{ ago(c.lastAt) }}</span></span>
  </button>
 </template>
</div>`};
/* Component: Bản tin (port module bulletin của phpFox) */
const CBulletins={
data:()=>({list:[],total:0,pg:1,cur:null,form:null,busy:false,busyMore:false,err:''}),
created(){this.load()},
computed:{hasMore(){return this.list.length<this.total}},
methods:{ago,
 async run(fn){this.err='';try{await fn()}catch(e){this.err=e.message}},
 load(){this.busy=true;this.pg=1;return this.run(async()=>{const d=await api('GET','/bulletins?page=1');this.list=d.bulletins;this.total=d.total}).finally(()=>this.busy=false)},
 more(){if(this.busyMore)return;this.busyMore=true;return this.run(async()=>{const d=await api('GET','/bulletins?page='+(this.pg+1));this.pg++;this.total=d.total;const h=new Set(this.list.map(b=>b.id));this.list.push(...d.bulletins.filter(b=>!h.has(b.id)))}).finally(()=>this.busyMore=false)},
 show(id){this.busy=true;return this.run(async()=>{this.cur=(await api('GET','/bulletins/'+id)).bulletin}).finally(()=>this.busy=false)},
 back(){this.cur=null;this.form=null;this.load()},
 write(){this.form={subject:'',text:''}},
 save(){const f=this.form;if(!f.subject.trim()||!f.text.trim()){this.err='Nhập tiêu đề và nội dung.';return}
  this.busy=true;return this.run(async()=>{const d=await api('POST','/bulletins',{subject:f.subject,text:f.text});this.form=null;this.show(d.bulletin.id)}).finally(()=>this.busy=false)},
 del(){if(!confirm('Xóa bản tin này?'))return;this.run(async()=>{await api('DELETE','/bulletins/'+this.cur.id);this.back()})}},
template:`<div class="space-y-3">
 <p v-if="err" class="text-sm" style="color:#d64545" role="alert">{{ err }}</p>
 <template v-if="cur">
  <button class="gh" @click="back">« Bản tin</button>
  <article class="card p-4 space-y-2">
   <h2 class="!m-0 text-lg font-bold break-words">📰 {{ cur.subject }}</h2>
   <div class="text-xs text-mute">{{ cur.author&&cur.author.name }} · {{ ago(cur.createdAt) }} · 👁 {{ cur.views }}</div>
   <p class="text-sm whitespace-pre-wrap break-words">{{ cur.text }}</p>
   <button v-if="cur.mine" class="btn !bg-transparent border border-line !h-8 text-sm !text-[#d64545]" @click="del">🗑️ Xóa</button>
  </article>
 </template>
 <template v-else-if="form">
  <button class="gh" @click="form=null">« Bản tin</button>
  <form class="card p-4 space-y-3" @submit.prevent="save">
   <input v-model="form.subject" class="ip" maxlength="120" placeholder="Tiêu đề bản tin" aria-label="Tiêu đề">
   <textarea v-model="form.text" class="ip" rows="6" maxlength="5000" placeholder="Nội dung bản tin…" aria-label="Nội dung"></textarea>
   <div class="flex gap-2 justify-end"><button type="button" class="btn !bg-transparent border border-line" @click="form=null">Hủy</button><button class="btn btn-g" :disabled="busy">Đăng</button></div>
  </form>
 </template>
 <template v-else>
  <button class="btn btn-g w-full" @click="write">＋ Viết bản tin</button>
  <div v-if="!list.length&&!busy" class="card p-4 text-sm text-mute">Chưa có bản tin nào.</div>
  <button v-for="b in list" :key="b.id" class="uc-row w-full text-left block" @click="show(b.id)">
   <b class="break-words">📰 {{ b.subject }}</b>
   <span class="block text-xs text-mute mt-1">{{ b.author&&b.author.name }} · 👁 {{ b.views }} · {{ ago(b.createdAt) }}</span>
  </button>
  <button v-if="hasMore" class="btn w-full !bg-transparent border border-line" :disabled="busyMore" @click="more">{{ busyMore?'Đang tải…':'Xem thêm' }}</button>
 </template>
</div>`};

/* Component: Liên kết (port module link của phpFox) – danh bạ website */
const CLinks={
data:()=>({list:[],total:0,pg:1,cat:'',cats:[],q:'',form:null,busy:false,busyMore:false,err:''}),
created(){this.loadCats();this.load()},
computed:{hasMore(){return this.list.length<this.total}},
methods:{ago,
 async run(fn){this.err='';try{await fn()}catch(e){this.err=e.message}},
 async loadCats(){try{this.cats=(await api('GET','/link-cats')).cats}catch(e){}},
 load(){this.busy=true;this.pg=1;const p=new URLSearchParams({page:1});if(this.cat)p.set('cat',this.cat);if(this.q.trim())p.set('q',this.q.trim());
  return this.run(async()=>{const d=await api('GET','/links?'+p);this.list=d.links;this.total=d.total}).finally(()=>this.busy=false)},
 more(){if(this.busyMore)return;this.busyMore=true;const p=new URLSearchParams({page:this.pg+1});if(this.cat)p.set('cat',this.cat);if(this.q.trim())p.set('q',this.q.trim());
  return this.run(async()=>{const d=await api('GET','/links?'+p);this.pg++;this.total=d.total;const h=new Set(this.list.map(l=>l.id));this.list.push(...d.links.filter(l=>!h.has(l.id)))}).finally(()=>this.busyMore=false)},
 write(){this.form={title:'',url:'https://',desc:'',cat:''}},
 save(){const f=this.form;if(!f.title.trim()||!/^https?:\/\//.test(f.url.trim())){this.err='Nhập tên và URL hợp lệ (http/https).';return}
  this.busy=true;return this.run(async()=>{await api('POST','/links',{title:f.title,url:f.url,desc:f.desc,cat:f.cat||undefined});this.form=null;this.load()}).finally(()=>this.busy=false)},
 del(l){if(!confirm('Xóa liên kết này?'))return;this.run(async()=>{await api('DELETE','/links/'+l.id);this.list=this.list.filter(x=>x.id!==l.id);this.total--})}},
template:`<div class="space-y-3">
 <p v-if="err" class="text-sm" style="color:#d64545" role="alert">{{ err }}</p>
 <button v-if="!form" class="btn btn-g w-full" @click="write">＋ Thêm liên kết</button>
 <form v-else class="card p-4 space-y-3" @submit.prevent="save">
  <input v-model="form.title" class="ip" maxlength="120" placeholder="Tên website" aria-label="Tên website">
  <input v-model="form.url" class="ip" maxlength="300" placeholder="https://…" aria-label="URL">
  <div class="flex gap-2"><select v-model="form.cat" class="ip !w-auto text-sm" aria-label="Chuyên mục"><option value="">— Chuyên mục —</option><option v-for="c in cats" :key="c.id" :value="c.id">{{ c.name }}</option></select></div>
  <textarea v-model="form.desc" class="ip" rows="2" maxlength="500" placeholder="Mô tả ngắn" aria-label="Mô tả"></textarea>
  <div class="flex gap-2 justify-end"><button type="button" class="btn !bg-transparent border border-line" @click="form=null">Hủy</button><button class="btn btn-g" :disabled="busy">Thêm</button></div>
 </form>
 <div class="flex gap-2 flex-wrap">
  <select v-model="cat" class="ip !w-auto !h-8 text-sm" @change="load" aria-label="Chuyên mục"><option value="">Tất cả chuyên mục</option><option v-for="c in cats" :key="c.id" :value="c.id">{{ c.name }}</option></select>
  <input v-model="q" class="ip flex-1 text-sm !h-8" maxlength="40" placeholder="Tìm liên kết…" @keydown.enter="load" aria-label="Tìm liên kết">
 </div>
 <div v-if="!list.length&&!busy" class="card p-4 text-sm text-mute">Chưa có liên kết nào.</div>
 <div v-for="l in list" :key="l.id" class="card p-3 flex items-center gap-2">
  <a :href="'/api/links/'+l.id+'/go'" target="_blank" rel="noopener" class="flex-1 min-w-0"><b class="break-words text-sm">🔗 {{ l.title }}</b><span class="block text-xs text-mute truncate">{{ l.url }}</span><span v-if="l.desc" class="block text-xs text-mute mt-0.5 break-words">{{ l.desc }}</span><span class="block text-xs text-mute mt-0.5"><span v-if="l.cat">{{ l.cat }} · </span>{{ l.clicks }} lượt bấm · {{ l.owner }}</span></a>
  <button v-if="l.mine" class="gh !text-xs shrink-0" @click="del(l)">Xóa</button>
 </div>
 <button v-if="hasMore" class="btn w-full !bg-transparent border border-line" :disabled="busyMore" @click="more">{{ busyMore?'Đang tải…':'Xem thêm' }}</button>
</div>`};

/* Component: Trợ giúp (port module help của phpFox) + form liên hệ */
const CHelp={
data:()=>({faqs:[],cform:null,busy:false,err:'',ok:''}),
created(){this.load()},
methods:{ago,
 async run(fn){this.err='';this.ok='';try{await fn()}catch(e){this.err=e.message}},
 load(){this.busy=true;return this.run(async()=>{this.faqs=(await api('GET','/faqs')).faqs}).finally(()=>this.busy=false)},
 send(){const f=this.cform;if(!f.name.trim()||!f.subject.trim()||!f.text.trim()){this.err='Điền đủ họ tên, tiêu đề và nội dung.';return}
  this.busy=true;return this.run(async()=>{await api('POST','/contact',{name:f.name,email:f.email,subject:f.subject,text:f.text});this.cform=null;this.ok='Đã gửi liên hệ. Quản trị viên sẽ phản hồi qua email.'}).finally(()=>this.busy=false)}},
template:`<div class="space-y-3">
 <p v-if="err" class="text-sm" style="color:#d64545" role="alert">{{ err }}</p>
 <p v-if="ok" class="text-sm card p-3" style="color:#1a7f37">{{ ok }}</p>
 <div class="card p-4 space-y-2"><b>❓ Câu hỏi thường gặp</b>
  <div v-if="!faqs.length&&!busy" class="text-sm text-mute">Chưa có nội dung trợ giúp.</div>
  <details v-for="f in faqs" :key="f.id" class="text-sm"><summary class="cursor-pointer font-bold break-words">{{ f.question }}</summary><p class="mt-1 text-mute whitespace-pre-wrap break-words">{{ f.answer }}</p></details>
 </div>
 <div class="card p-4 space-y-3">
  <b>✉️ Liên hệ quản trị viên</b>
  <template v-if="!cform"><button class="btn btn-g" @click="cform={name:'',email:'',subject:'',text:''}">Viết liên hệ</button></template>
  <form v-else class="space-y-3" @submit.prevent="send">
   <div class="flex gap-2"><input v-model="cform.name" class="ip flex-1 text-sm" maxlength="60" placeholder="Họ tên" aria-label="Họ tên"><input v-model="cform.email" type="email" class="ip flex-1 text-sm" maxlength="120" placeholder="Email" aria-label="Email"></div>
   <input v-model="cform.subject" class="ip text-sm" maxlength="150" placeholder="Tiêu đề" aria-label="Tiêu đề">
   <textarea v-model="cform.text" class="ip text-sm" rows="4" maxlength="3000" placeholder="Nội dung…" aria-label="Nội dung"></textarea>
   <div class="flex gap-2 justify-end"><button type="button" class="btn !bg-transparent border border-line" @click="cform=null">Hủy</button><button class="btn btn-g" :disabled="busy">Gửi</button></div>
  </form>
 </div>
</div>`};

/* Component: Shoutbox (port module shoutbox của phpFox) – khung chat nhanh */
const CShout={
data:()=>({list:[],text:'',busy:false,err:''}),
created(){this.load();this._t=setInterval(()=>this.load(true),15000)},
beforeUnmount(){clearInterval(this._t)},
methods:{ago,
 async load(quiet){if(this.busy&&!quiet)return;if(!quiet)this.busy=true;
  try{this.list=(await api('GET','/shoutbox')).shouts}catch(e){if(!quiet)this.err=e.message}finally{this.busy=false}},
 send(){if(!this.text.trim())return;const t=this.text;this.text='';
  api('POST','/shoutbox',{text:t}).then(()=>this.load(true)).catch(e=>{this.err=e.message;this.text=t})},
 del(s){api('DELETE','/shoutbox/'+s.id).then(()=>{this.list=this.list.filter(x=>x.id!==s.id)}).catch(e=>{this.err=e.message})}},
template:`<div class="card p-3 space-y-2">
 <b class="text-sm">📢 Shoutbox</b>
 <p v-if="err" class="text-xs" style="color:#d64545">{{ err }}</p>
 <div class="space-y-1 max-h-56 overflow-y-auto text-sm">
  <div v-if="!list.length&&!busy" class="text-xs text-mute">Chưa có tin nhắn nào. Chào mọi người đi!</div>
  <div v-for="s in list" :key="s.id" class="flex gap-1.5 items-baseline"><c-av :name="s.user.name" :src="s.user.avatar" :size="20"></c-av>
   <span class="min-w-0"><b>{{ s.user.name }}</b> <span class="break-words"><c-tx :t="s.text"/></span> <span class="text-xs text-mute">{{ ago(s.createdAt) }}</span></span>
   <button v-if="s.mine" class="gh ml-auto !text-xs shrink-0" @click="del(s)">✕</button></div>
 </div>
 <form class="flex gap-2 items-center" @submit.prevent="send"><c-emo @pick="e=>text+=e"/><input v-model="text" class="ip flex-1 !h-8 text-sm" maxlength="200" placeholder="Nhắn nhanh…" aria-label="Shoutbox"><button class="btn btn-g !h-8 text-sm">Gửi</button></form>
</div>`};

/* Component: Yêu thích (port module favorite của phpFox) */
const CFav={
data:()=>({list:[],total:0,pg:1,busy:false,busyMore:false,err:''}),
created(){this.load()},
computed:{hasMore(){return this.list.length<this.total}},
methods:{ago,
 async run(fn){this.err='';try{await fn()}catch(e){this.err=e.message}},
 load(){this.busy=true;this.pg=1;return this.run(async()=>{const d=await api('GET','/favorites?page=1');this.list=d.favorites;this.total=d.total}).finally(()=>this.busy=false)},
 more(){if(this.busyMore)return;this.busyMore=true;return this.run(async()=>{const d=await api('GET','/favorites?page='+(this.pg+1));this.pg++;this.total=d.total;const h=new Set(this.list.map(f=>f.id));this.list.push(...d.favorites.filter(f=>!h.has(f.id)))}).finally(()=>this.busyMore=false)},
 goF(f){if(f.kind==='forum_thread')this.$emit('nav',{view:'forum',thread:f.refId});else if(f.kind==='video')this.$emit('nav',{view:'videos',video:f.refId});else if(f.kind==='song')this.$emit('nav',{view:'music',song:f.refId});else if(f.kind==='quiz')this.$emit('nav',{view:'quizzes',quiz:f.refId});else if(f.kind==='page')this.$emit('nav',{view:'pages',page:f.refId});else if(f.kind==='blog')this.$emit('nav',{view:'profile',tab:'bl'});else if(f.kind==='poll')this.$emit('nav',{view:'polls'});else this.$emit('nav',{view:'home'})},
 del(f){this.run(async()=>{await api('DELETE','/favorites/'+f.id);this.list=this.list.filter(x=>x.id!==f.id);this.total--})}},
template:`<div class="space-y-3">
 <p v-if="err" class="text-sm" style="color:#d64545" role="alert">{{ err }}</p>
 <div v-if="!list.length&&!busy" class="card p-4 text-sm text-mute">Chưa lưu mục yêu thích nào.</div>
 <div v-for="f in list" :key="f.id" class="card p-3 flex items-center gap-2">
  <button class="flex-1 text-left min-w-0" @click="goF(f)"><b class="text-sm break-words">⭐ {{ f.title||f.kind }}</b><span class="block text-xs text-mute mt-0.5">{{ f.kind }} · {{ ago(f.createdAt) }}</span></button>
  <button class="gh !text-xs shrink-0" @click="del(f)">Bỏ lưu</button>
 </div>
 <button v-if="hasMore" class="btn w-full !bg-transparent border border-line" :disabled="busyMore" @click="more">{{ busyMore?'Đang tải…':'Xem thêm' }}</button>
</div>`};
/* Yêu thích + đánh giá sao (favorite/rate của phpFox) gắn vào trang chi tiết nội dung */
const CFavRate={
props:['kind','refid','title'],
data:()=>({saved:false,fid:null,avg:0,count:0,my:0,hover:0,err:''}),
created(){this.load()},
methods:{async load(){try{const f=await api('GET','/favorites/check?kind='+encodeURIComponent(this.kind)+'&refId='+encodeURIComponent(this.refid));this.saved=f.saved;this.fid=f.id;const r=await api('GET','/rate/'+encodeURIComponent(this.kind)+'/'+encodeURIComponent(this.refid));this.avg=r.avg;this.count=r.count;this.my=r.my}catch(e){}},
 async toggleFav(){this.err='';try{if(this.saved){await api('DELETE','/favorites/'+this.fid);this.saved=false;this.fid=null}else{const d=await api('POST','/favorites',{kind:this.kind,refId:this.refid,title:this.title||''});this.saved=true;this.fid=d.favorite.id}}catch(e){this.err=e.message}},
 async rate(n){this.err='';try{const d=await api('POST','/rate',{kind:this.kind,refId:this.refid,stars:n});this.my=n;this.avg=d.avg;this.count=d.count}catch(e){this.err=e.message}}},
template:`<div class="space-y-1">
 <div class="flex items-center gap-2 flex-wrap">
  <button class="gh !text-sm" @click="toggleFav" :aria-label="saved?'Bỏ lưu khỏi yêu thích':'Lưu vào yêu thích'">{{ saved?'⭐ Đã lưu':'☆ Lưu' }}</button>
  <span class="flex items-center" role="radiogroup" aria-label="Đánh giá sao">
   <button v-for="n in 5" :key="n" type="button" class="!p-0.5 text-xl leading-none" :style="{color:(hover||my)>=n?'#f5a623':'#c9cfd8'}" @mouseenter="hover=n" @mouseleave="hover=0" @click="rate(n)" :aria-label="n+' sao'">★</button>
  </span>
  <span class="text-xs text-mute">{{ avg }} ({{ count }} lượt)</span>
 </div>
 <p v-if="err" class="text-xs" style="color:#d64545" role="alert">{{ err }}</p>
</div>`};

export { CBulletins, CFav, CFavRate, CGifts, CHelp, CLinks, CMail, CPages, CQuizzes, CShout };
