import { ago, api } from '../lib/core.js';
/* Component: Nhiệm vụ tân thủ + điểm tín dụng (task/credit của UCHome) */
/* Component: Đạo cụ (magic của UCHome): cửa hàng, túi đồ, sử dụng, tặng bạn bè */
const CMagic={
data:()=>({shop:[],mine:[],credit:0,busy:false,err:'',tab:'shop',useMid:'',useTarget:'',useText:'',useAmount:10,
 TABS:[['shop','Cửa hàng'],['mine','Túi của tôi'],['log','Nhật ký']],logs:[]}),

created(){this.load()},
methods:{ago,
 async run(fn){this.err='';try{await fn()}catch(e){this.err=e.message}},
 load(){this.busy=true;return this.run(async()=>{const d=await api('GET','/magics');this.shop=d.magics;this.credit=d.credit;const m=await api('GET','/magics/mine');this.mine=m.items}).finally(()=>this.busy=false)},
 loadLog(){return this.run(async()=>{this.logs=(await api('GET','/magics/log')).logs})},
 setTab(t){this.tab=t;if(t==='log')this.loadLog()},
 buy(m){const n=parseInt(prompt('Mua mấy cái "'+m.name+'"? (giá '+m.charge+' điểm/cái)', '1'),10);if(!n||n<1)return;this.run(async()=>{await api('POST','/magics/'+m.mid+'/buy',{n});await this.load()})},
 gift(m){const uid=prompt('Tặng "'+m.name+'" cho ai? (dán ID người dùng — cần Giấy phép)');if(!uid||!uid.trim())return;if(!confirm('Tặng "'+m.name+'" cho người này? Sẽ tiêu hao 1 Giấy phép.'))return;this.run(async()=>{await api('POST','/magics/'+m.mid+'/gift',{userId:uid.trim()});await this.load();alert('Đã tặng!')})},
 openUse(m){this.useMid=m.mid;this.useTarget='';this.useText='';this.useAmount=10},
 needTarget(mid){return['gift','call','updateline','downdateline','hot'].includes(mid)},
 needText(mid){return['thunder','call'].includes(mid)},
 doUse(){const mid=this.useMid;const body={};
  if(this.needTarget(mid))body.target=this.useTarget.trim();
  if(this.needText(mid))body.text=this.useText.trim();
  if(mid==='gift')body.amount=this.useAmount;
  if(this.needTarget(mid)&&!body.target){this.err='Hãy nhập ID đối tượng.';return}
  this.run(async()=>{const d=await api('POST','/magics/'+mid+'/use',body);this.useMid='';await this.load();if(d.detail)alert(d.detail)})}},
template:`<div class="space-y-3">
 <p v-if="err" class="text-sm" style="color:#d64545" role="alert">{{ err }}</p>
 <div class="card p-3 flex items-center gap-2 text-sm"><b class="flex-1">🪄 Đạo cụ</b><span class="text-mute">Điểm của bạn: <b class="text-ink">{{ credit }}</b></span><button class="gh text-xs" @click="load">↻</button></div>
 <div class="flex gap-1 flex-wrap"><button v-for="t in TABS" :key="t[0]" class="btn !py-1 text-sm" :class="tab===t[0]?'btn-g':'!bg-transparent border border-line'" @click="setTab(t[0])">{{ t[1] }}</button></div>
 <template v-if="tab==='shop'">
  <div v-if="busy&&!shop.length" class="card p-4 text-sm text-mute">Đang tải…</div>
  <div v-for="m in shop" :key="m.mid" class="card p-3 flex items-center gap-3">
   <span class="text-3xl">{{ m.icon }}</span>
   <div class="flex-1 min-w-0"><b class="text-sm">{{ m.name }}</b><span v-if="m.mine" class="ml-2 text-xs px-1.5 rounded-full text-white" style="background:#2f8f4e">có {{ m.mine }}</span><div class="text-xs text-mute break-words">{{ m.desc }}</div></div>
   <div class="text-right"><div class="text-sm font-bold">{{ m.charge }} điểm</div><button class="btn btn-g !h-8 text-sm mt-1" @click="buy(m)">Mua</button></div>
  </div>
 </template>
 <template v-else-if="tab==='mine'">
  <div v-if="!mine.length" class="card p-4 text-sm text-mute">Bạn chưa có đạo cụ nào. Hãy vào Cửa hàng mua bằng điểm nhé!</div>
  <div v-for="m in mine" :key="m.mid" class="card p-3 space-y-2">
   <div class="flex items-center gap-3"><span class="text-3xl">{{ m.icon }}</span><div class="flex-1 min-w-0"><b class="text-sm">{{ m.name }} <span class="text-mute">× {{ m.count }}</span></b><div class="text-xs text-mute break-words">{{ m.desc }}</div></div>
   <button class="btn !h-8 text-sm !bg-transparent border border-line" @click="openUse(m)">Dùng</button><button v-if="m.mid!=='license'" class="btn !h-8 text-sm !bg-transparent border border-line" @click="gift(m)">Tặng</button></div>
   <div v-if="useMid===m.mid" class="space-y-2 pt-1 border-t border-line">
    <input v-if="needTarget(m.mid)" v-model="useTarget" class="ip text-sm" :placeholder="m.mid==='gift'||m.mid==='call'?'ID người nhận…':'ID bài viết…'" aria-label="Đối tượng">
    <input v-if="m.mid==='gift'" v-model.number="useAmount" type="number" min="1" max="500" class="ip text-sm" aria-label="Số điểm tặng">
    <input v-if="needText(m.mid)" v-model="useText" class="ip text-sm" maxlength="200" placeholder="Lời nhắn (tùy chọn)…" aria-label="Lời nhắn">
    <div class="flex gap-2"><button class="btn btn-g !h-8 text-sm" @click="doUse">Xác nhận dùng</button><button class="btn !h-8 text-sm !bg-transparent border border-line" @click="useMid=''">Hủy</button></div>
   </div>
  </div>
 </template>
 <template v-else>
  <div v-if="!logs.length" class="card p-4 text-sm text-mute">Chưa có lịch sử.</div>
  <div v-for="(l,i) in logs" :key="i" class="card p-3 text-sm"><b>{{ {buy:'Mua',use:'Dùng',gift:'Tặng',recv:'Được tặng'}[l.action] }}</b> {{ l.mid }}<span v-if="l.target"> → {{ l.target }}</span><div class="text-xs text-mute">{{ l.detail }} · {{ ago(l.at) }}</div></div>
 </template>
</div>`};

const CTasks={
data:()=>({me:null,tasks:[],log:[],lTotal:0,lPg:1,busy:false,busyLog:false,busyMore:false,err:'',tab:'tasks',
 TABS:[['tasks','Nhiệm vụ'],['log','Lịch sử điểm']]}),
created(){this.load()},
computed:{hasMoreLog(){return this.log.length<this.lTotal}},
methods:{ago,
 async run(fn){this.err='';try{await fn()}catch(e){this.err=e.message}},
 load(){this.busy=true;return this.run(async()=>{const[cm,ts]=await Promise.all([api('GET','/credit/me'),api('GET','/tasks')]);this.me=cm;this.tasks=ts.tasks;await this.loadLog()}).finally(()=>this.busy=false)},
 loadLog(){this.busyLog=true;this.lPg=1;return this.run(async()=>{const d=await api('GET','/credit/log?page=1');this.log=d.log;this.lTotal=d.total}).finally(()=>this.busyLog=false)},
 moreLog(){if(this.busyMore)return;this.busyMore=true;return this.run(async()=>{const d=await api('GET','/credit/log?page='+(this.lPg+1));this.lPg++;this.lTotal=d.total;const have=new Set(this.log.map(x=>x.id+x.createdAt));this.log.push(...d.log.filter(x=>!have.has(x.id+x.createdAt)))}).finally(()=>this.busyMore=false)},
 setTab(t){this.tab=t},
 claim(t){this.run(async()=>{const d=await api('POST','/tasks/'+t.id+'/claim');t.claimed=true;this.me.credit=d.credit;this.me.experience=d.experience;this.me.level=d.level;await this.loadLog()})},
 ruleLabel(a){const r=(this.me.rules||[]).find(x=>x.action===a);return r?r.label:a}},
template:`<div class="space-y-3">
 <p v-if="err" class="text-sm" style="color:#d64545" role="alert">{{ err }}</p>
 <div v-if="busy&&!me" class="card p-4 text-sm text-mute">Đang tải…</div>
 <template v-else-if="me">
  <div class="card p-4">
   <div class="flex items-stretch gap-2 text-center">
    <div class="flex-1"><div class="text-2xl font-bold">🏆 {{ me.credit }}</div><div class="text-xs text-mute">Điểm tín dụng</div></div>
    <div class="flex-1"><div class="text-2xl font-bold">✨ {{ me.experience }}</div><div class="text-xs text-mute">Kinh nghiệm</div></div>
    <div class="flex-1"><div class="text-2xl font-bold">🎖️</div><div class="text-xs text-mute">{{ me.level }}</div></div>
   </div>
  </div>
  <div class="flex gap-1 flex-wrap"><button v-for="t in TABS" :key="t[0]" class="btn !py-1 text-sm" :class="tab===t[0]?'btn-g':'!bg-transparent border border-line'" @click="setTab(t[0])">{{ t[1] }}</button></div>
  <template v-if="tab==='tasks'">
   <div v-if="!tasks.length" class="card p-4 text-sm text-mute">Chưa có nhiệm vụ nào.</div>
   <div v-for="t in tasks" :key="t.id" class="card p-4 flex gap-3 items-center">
    <div class="min-w-0 flex-1">
     <b class="block">{{ t.done?'✅ ':'' }}{{ t.name }}</b>
     <span class="block text-sm text-mute">{{ t.desc }}</span>
     <span class="block text-xs mt-1 text-mute">Thưởng: +{{ t.credit }} điểm · +{{ t.exp }} kinh nghiệm</span>
    </div>
    <button v-if="t.done&&!t.claimed" class="btn btn-g shrink-0" @click="claim(t)">Nhận thưởng</button>
    <span v-else-if="t.claimed" class="text-xs text-mute shrink-0">Đã nhận</span>
    <span v-else class="text-xs text-mute shrink-0">Chưa xong</span>
   </div>
  </template>
  <template v-else>
   <div v-if="busyLog&&!log.length" class="card p-4 text-sm text-mute">Đang tải…</div>
   <div v-else-if="!log.length" class="card p-4 text-sm text-mute">Chưa có lịch sử điểm.</div>
   <div v-for="l in log" :key="l.id+l.createdAt" class="uc-row block">
    <span class="flex justify-between gap-2"><b class="break-words">{{ ruleLabel(l.action) }}</b><b class="shrink-0">+{{ l.credit }}</b></span>
    <span class="block text-xs text-mute mt-1"><span v-if="l.note">{{ l.note }} · </span>{{ ago(l.createdAt) }}</span>
   </div>
   <button v-if="hasMoreLog" class="btn w-full !bg-transparent border border-line" :disabled="busyMore" @click="moreLog">{{ busyMore?'Đang tải…':'Xem thêm' }}</button>
  </template>
 </template>
</div>`};


export { CMagic, CTasks };
