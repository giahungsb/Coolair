import { ago, api } from '../lib/core.js';
import { fdt } from './events-polls.js';
/* Component: Tìm kiếm toàn site – người, bài viết, nhật ký, sự kiện, bình chọn, nhóm, chủ đề nhóm */
const CSearch={props:{init:String},emits:['pick'],
data(){return{q:this.init||'',shown:'',type:'all',res:null,page:1,busy:false,busyMore:false,err:'',blog:null,
 TYPES:[['all','Tất cả'],['users','Người'],['posts','Bài viết'],['blogs','Nhật ký'],['events','Sự kiện'],['polls','Bình chọn'],['groups','Nhóm'],['threads','Chủ đề'],['doings','Trạng thái'],['shares','Chia sẻ'],['topics','Chủ đề nóng'],['forum_threads','Diễn đàn'],['songs','Nhạc'],['videos','Video'],['quizzes','Quiz'],['pages','Trang']],
 TITLE:{users:'Người dùng',posts:'Bài viết',blogs:'Nhật ký',events:'Sự kiện',polls:'Bình chọn',groups:'Nhóm',threads:'Chủ đề nhóm',doings:'Trạng thái',shares:'Chia sẻ',topics:'Chủ đề nóng',forum_threads:'Chủ đề diễn đàn',songs:'Bài hát',videos:'Video',quizzes:'Quiz',pages:'Trang cộng đồng'},
 PICK:{users:'user',posts:'user',blogs:'blog',events:'event',polls:'poll',groups:'group',threads:'thread',doings:'user',shares:'user',topics:'topic',forum_threads:'forum_thread',songs:'song',videos:'video',quizzes:'quiz',pages:'page'}}},
created(){if(this.q.trim().length>=2)this.run()},
computed:{
 sections(){if(!this.res)return[];return Object.keys(this.TITLE).filter(k=>this.res[k]&&this.res[k].items.length).map(k=>({k,title:this.TITLE[k],total:this.res[k].total,items:this.res[k].items.map(it=>this.norm(k,it))}))},
 total(){return this.sections.reduce((n,s)=>n+s.total,0)},
 hasMore(){const s=this.sections[0];return this.type!=='all'&&!!s&&this.page*10<s.total}},
methods:{ago,
 norm(k,it){switch(k){
  case'users':return{id:it.id,av:it,title:it.name,sub:'@'+it.username+(it.location?' · '+it.location:'')+(it.friend?' · bạn bè':'')};
  case'posts':return{id:it.author.id,av:it.author,title:it.author.name,sub:it.excerpt+' · '+ago(it.createdAt)};
  case'blogs':return{id:it.id,title:'📓 '+it.title,sub:it.owner.name+' · '+it.excerpt};
  case'events':return{id:it.id,title:'📅 '+it.title,sub:fdt(it.start)+(it.location?' · '+it.location:'')+' · '+it.goingNum+' tham gia'+(it.past?' · đã qua':'')};
  case'polls':return{id:it.id,title:'📊 '+it.question,sub:it.owner.name+' · '+it.voterNum+' người đã chọn'+(it.expired?' · hết hạn':'')};
  case'groups':return{id:it.id,title:'🏷️ '+it.name,sub:it.memberNum+' thành viên · '+it.threadNum+' chủ đề'};
  case'doings':return{id:it.author.id,av:it.author,title:'💬 '+String(it.text||'').slice(0,60),sub:it.author.name+' · '+ago(it.createdAt)};
  case'shares':return{id:it.author.id,av:it.author,title:'🔁 '+String(it.note||it.targetTitle||'').slice(0,60),sub:it.author.name+' · '+ago(it.createdAt)};
  case'topics':return{id:it.id,title:'🏷️ '+it.title,sub:it.joinNum+' tham gia · '+it.postNum+' nội dung'};
  case'forum_threads':return{id:it.id,title:'💬 '+it.title,sub:it.author.name+' · '+it.replyNum+' trả lời · '+ago(it.lastAt)};
  case'songs':return{id:it.id,title:'🎵 '+it.title,sub:(it.artist?it.artist+' · ':'')+'▶ '+it.plays+' lượt nghe'};
  case'videos':return{id:it.id,title:'🎬 '+it.title,sub:it.owner.name+' · 👁 '+it.views+' lượt xem'};
  case'quizzes':return{id:it.id,title:'❓ '+it.title,sub:it.owner.name+' · '+it.takes+' lượt làm'};
  case'pages':return{id:it.id,title:'📄 '+it.name,sub:'👍 '+it.likeNum+' người thích'+(it.verified?' · ✔️':'')};
  default:return{id:it.id,title:'💭 '+it.subject,sub:it.group+' · '+it.author.name+' · '+it.replyNum+' trả lời'}}},
 async run(){const t=this.q.trim();if(t.length<2){this.err='Nhập ít nhất 2 ký tự để tìm.';return}this.err='';this.busy=true;this.page=1;this.blog=null;
  try{const d=await api('GET','/search?q='+encodeURIComponent(t)+'&type='+this.type+'&page=1');this.res=d.results;this.shown=d.q}catch(e){this.err=e.message}finally{this.busy=false}},
 setType(t){this.type=t;this.run()},
 async more(){if(this.busyMore)return;this.busyMore=true;this.err='';
  try{const d=await api('GET','/search?q='+encodeURIComponent(this.shown)+'&type='+this.type+'&page='+(this.page+1));this.page++;const k=this.sections[0].k,have=new Set(this.res[k].items.map(x=>x.id+(x.createdAt||'')));this.res[k].items.push(...d.results[k].items.filter(x=>!have.has(x.id+(x.createdAt||''))))}catch(e){this.err=e.message}finally{this.busyMore=false}},
 async choose(k,it){const p=this.PICK[k];if(p==='blog'){this.err='';try{this.blog=(await api('GET','/blogs/'+it.id)).blog}catch(e){this.err=e.message}}else this.$emit('pick',{t:p,id:it.id})}},
template:`<div class="space-y-3">
 <form class="flex gap-2" @submit.prevent="run"><input v-model="q" class="ip" maxlength="40" placeholder="Tìm người, bài viết, nhật ký, sự kiện, bình chọn, nhóm…" aria-label="Từ khóa tìm kiếm"><button class="btn btn-g" :disabled="busy">Tìm</button></form>
 <div class="flex gap-1 flex-wrap"><button v-for="t in TYPES" :key="t[0]" class="btn !py-1 text-sm" :class="type===t[0]?'btn-g':'!bg-transparent border border-line'" @click="setType(t[0])">{{ t[1] }}</button></div>
 <p v-if="err" class="text-sm" style="color:#d64545" role="alert">{{ err }}</p>
 <div v-if="busy" class="card p-4 text-sm text-mute">Đang tìm…</div>
 <template v-else-if="blog">
  <button class="gh" @click="blog=null">« Kết quả tìm kiếm</button>
  <article class="card p-4 space-y-2"><h2 class="!m-0 text-lg font-bold break-words">📓 {{ blog.title }}</h2><div class="text-xs text-mute">{{ blog.owner&&blog.owner.name }} · {{ ago(blog.createdAt) }}</div><div class="whitespace-pre-wrap break-words leading-relaxed">{{ blog.text }}</div></article>
 </template>
 <template v-else-if="res">
  <div v-if="!total" class="card p-4 text-sm text-mute">Không tìm thấy kết quả nào cho “{{ shown }}”.</div>
  <section v-for="s in sections" :key="s.k" class="card p-3 space-y-1">
   <div class="flex items-center"><b class="text-sm">{{ s.title }} ({{ s.total }})</b><button v-if="type==='all'&&s.total>s.items.length" class="gh ml-auto text-sm" @click="setType(s.k)">Xem tất cả »</button></div>
   <button v-for="(it,i) in s.items" :key="s.k+i+it.id" class="uc-row w-full text-left flex gap-2 items-start" @click="choose(s.k,it)"><c-av v-if="it.av" :name="it.av.name" :src="it.av.avatar" :size="36"></c-av><span class="min-w-0 flex-1"><b class="block break-words">{{ it.title }}</b><span class="block text-sm text-mute break-words">{{ it.sub }}</span></span></button>
  </section>
  <button v-if="hasMore" class="btn w-full !bg-transparent border border-line" :disabled="busyMore" @click="more">{{ busyMore?'Đang tải…':'Xem thêm kết quả' }}</button>
 </template>
</div>`};

/* Component: Feed (nhóm theo ngày, timeline, xem thêm) */
/* Timeline kiểu Zalo: mỗi ngày một nút tròn trên đường kẻ dọc + thẻ ngày ("1 tháng 1 - Tết Dương Lịch"). Ngày lễ dương lịch cố định; Tết Âm lịch cần bảng lịch âm riêng nên chưa có. */
const HOL={'1/1':['🥂','Tết Dương Lịch'],'14/2':['💝','Valentine'],'8/3':['🌹','Quốc tế Phụ nữ'],'30/4':['🎆','Giải phóng miền Nam'],'1/5':['🛠️','Quốc tế Lao động'],'1/6':['🧒','Quốc tế Thiếu nhi'],'2/9':['🇻🇳','Quốc khánh'],'20/10':['🌸','Phụ nữ Việt Nam'],'20/11':['📚','Nhà giáo Việt Nam'],'24/12':['🎄','Đêm Giáng Sinh'],'25/12':['🎄','Giáng Sinh']};
const tzInfo=(g,bd)=>{const d=new Date(g.items[0].d),h=HOL[d.getDate()+'/'+(d.getMonth()+1)],rel=g.k==='Hôm nay'||g.k==='Hôm qua';
 const b=/^\d{4}-\d{2}-\d{2}$/.test(bd||'')&&+bd.slice(5,7)===d.getMonth()+1&&+bd.slice(8,10)===d.getDate()&&d.getFullYear()>=+bd.slice(0,4);   // trùng ngày/tháng sinh (từ năm sinh trở đi)
 let t=rel?g.k:d.getDate()+' tháng '+(d.getMonth()+1)+(d.getFullYear()!==new Date().getFullYear()?', '+d.getFullYear():'');
 if(b)t+=' - Ngày Sinh Nhật';else if(h)t+=' - '+h[1];
 return{t,i:b?'🎂':h?h[0]:'',h:!b&&!!h,b}};
const CFeed={props:{groups:Array,tl:Boolean,zl:Boolean,bd:String,more:Boolean,busy:Boolean,first:Boolean},emits:['del','more'],
methods:{zi(g){return tzInfo(g,this.bd)}},
template:`<div class="space-y-3 min-w-0" :class="{tl,tz:zl}">
<div v-if="first" class="card p-4 animate-pulse"><div class="flex gap-3"><i class="w-[42px] h-[42px] rounded-full bg-line"></i><div class="flex-1 space-y-2 pt-1"><i class="block h-3 w-1/3 rounded bg-line"></i><i class="block h-2 w-1/4 rounded bg-line"></i></div></div><i class="block h-3 w-5/6 rounded bg-line mt-4"></i></div>
<template v-else>
 <template v-for="g in groups" :key="g.k"><div v-if="zl" class="tzh"><i class="tzn">{{ zi(g).i }}</i><span class="tzp" :class="{h:zi(g).h,b:zi(g).b}">{{ zi(g).t }}</span></div><div v-else class="dd">{{ g.k }}</div>
  <div v-for="p in g.items" :key="p.id" class="relative"><i v-if="tl" class="dot"></i><i v-if="zl" class="tzd"></i><c-post :post="p" @del="$emit('del',$event)"></c-post></div></template>
 <div v-if="!groups.length" class="card p-6 text-center text-mute"><slot></slot></div>
 <button v-if="more&&groups.length" class="btn w-full !bg-card !text-zb2 border border-line" :disabled="busy" @click="$emit('more')">{{ busy?'Đang tải…':'Xem thêm bài viết cũ hơn' }}</button>
 <p v-else-if="groups.length" class="text-center text-xs text-mute py-2">Bạn đã xem hết bài viết 🎉</p>
</template></div>`};


export { CFeed, CSearch };
