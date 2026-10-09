import { ago, api } from '../lib/core.js';
import { cloudUp } from './post.js';
/* Component: Âm nhạc (port module music của phpFox) – bài hát, album, playlist, thể loại */
const CMusic={
data:()=>({tab:'songs',songs:[],stotal:0,spg:1,genre:'',q:'',genres:[],song:null,albums:[],album:null,aform:null,
 pls:[],pl:null,plform:null,sform:null,upBusy:false,upErr:'',busy:false,busyMore:false,err:''}),
created(){this.loadGenres();this.loadSongs()},
computed:{hasMore(){return this.songs.length<this.stotal}},
methods:{ago,
 async run(fn){this.err='';try{await fn()}catch(e){this.err=e.message}},
 async loadGenres(){try{this.genres=(await api('GET','/music/genres')).genres}catch(e){}},
 loadSongs(){this.busy=true;this.spg=1;const p=new URLSearchParams({page:1});if(this.genre)p.set('genre',this.genre);if(this.q.trim())p.set('q',this.q.trim());
  return this.run(async()=>{const d=await api('GET','/music?'+p);this.songs=d.songs;this.stotal=d.total}).finally(()=>this.busy=false)},
 moreSongs(){if(this.busyMore)return;this.busyMore=true;const p=new URLSearchParams({page:this.spg+1});if(this.genre)p.set('genre',this.genre);if(this.q.trim())p.set('q',this.q.trim());
  return this.run(async()=>{const d=await api('GET','/music?'+p);this.spg++;this.stotal=d.total;const h=new Set(this.songs.map(s=>s.id));this.songs.push(...d.songs.filter(s=>!h.has(s.id)))}).finally(()=>this.busyMore=false)},
 setTab(t){this.tab=t;this.song=null;this.album=null;this.pl=null;if(t==='songs')this.loadSongs();if(t==='albums')this.loadAlbums();if(t==='playlists')this.loadPls()},
 showSong(id){this.busy=true;return this.run(async()=>{this.song=(await api('GET','/music/'+id)).song}).finally(()=>this.busy=false)},
 togLike(s){this.run(async()=>{const d=s.liked?await api('DELETE','/music/'+s.id+'/like'):await api('POST','/music/'+s.id+'/like');s.liked=d.liked;s.likes+=d.liked?1:-1})},
 delSong(s){if(!confirm('Xóa bài hát này?'))return;this.run(async()=>{await api('DELETE','/music/'+s.id);this.songs=this.songs.filter(x=>x.id!==s.id);this.stotal--;if(this.song&&this.song.id===s.id)this.song=null})},
 write(){this.sform={title:'',artist:'',genre:'',url:'',duration:0,desc:'',album:''}},
 async pickFile(e){const f=e.target.files[0];e.target.value='';if(!f)return;this.upBusy=true;this.upErr='';
  try{this.sform.url=await cloudUp('music',f);this.sform.title=this.sform.title||f.name.replace(/\.[^.]+$/,'')}catch(x){this.upErr=x.message}finally{this.upBusy=false}},
 saveSong(){const f=this.sform;if(!f.title.trim()||!f.url){this.err='Nhập tên bài hát và tải file nhạc lên (hoặc dán URL).';return}
  this.busy=true;return this.run(async()=>{await api('POST','/music',{title:f.title,artist:f.artist,genre:f.genre||undefined,album:f.album||undefined,url:f.url,duration:f.duration,desc:f.desc});this.sform=null;this.loadSongs()}).finally(()=>this.busy=false)},
 loadAlbums(){this.busy=true;return this.run(async()=>{this.albums=(await api('GET','/music/albums')).albums}).finally(()=>this.busy=false)},
 showAlbum(id){this.busy=true;return this.run(async()=>{const d=await api('GET','/music/albums/'+id);this.album={...d.album,songs:d.songs}}).finally(()=>this.busy=false)},
 saveAlbum(){const f=this.aform;if(!f.title.trim()){this.err='Nhập tên album.';return}
  this.busy=true;return this.run(async()=>{await api('POST','/music/albums',{title:f.title,desc:f.desc,year:f.year||undefined,cover:f.cover});this.aform=null;this.loadAlbums()}).finally(()=>this.busy=false)},
 delAlbum(a){if(!confirm('Xóa album này? (bài hát giữ lại)'))return;this.run(async()=>{await api('DELETE','/music/albums/'+a.id);this.albums=this.albums.filter(x=>x.id!==a.id);if(this.album&&this.album.id===a.id)this.album=null})},
 loadPls(){this.busy=true;return this.run(async()=>{this.pls=(await api('GET','/music/playlists')).playlists}).finally(()=>this.busy=false)},
 showPl(id){this.busy=true;return this.run(async()=>{this.pl=(await api('GET','/music/playlists/'+id)).playlist}).finally(()=>this.busy=false)},
 savePl(){if(!this.plform.title.trim()){this.err='Nhập tên playlist.';return}
  this.busy=true;return this.run(async()=>{await api('POST','/music/playlists',{title:this.plform.title});this.plform=null;this.loadPls()}).finally(()=>this.busy=false)},
 addToPl(sid,pid){if(!pid)return;this.run(async()=>{await api('POST','/music/playlists/'+pid+'/songs',{song:sid});this.showPl(pid)})},
 rmFromPl(sid){this.run(async()=>{await api('DELETE','/music/playlists/'+this.pl.id+'/songs/'+sid);this.showPl(this.pl.id)})},
 delPl(){if(!confirm('Xóa playlist này?'))return;this.run(async()=>{await api('DELETE','/music/playlists/'+this.pl.id);this.pl=null;this.loadPls()})}},
template:`<div class="space-y-3">
 <p v-if="err" class="text-sm" style="color:#d64545" role="alert">{{ err }}</p>
 <div class="flex gap-1 flex-wrap">
  <button v-for="t in [['songs','Bài hát'],['albums','Album'],['playlists','Playlist']]" :key="t[0]" class="btn !py-1 text-sm" :class="tab===t[0]?'btn-g':'!bg-transparent border border-line'" @click="setTab(t[0])">{{ t[1] }}</button>
 </div>
 <template v-if="tab==='songs'">
  <template v-if="song">
   <button class="gh" @click="song=null">« Danh sách bài hát</button>
   <div class="card p-4 space-y-3">
    <b class="text-lg break-words">🎵 {{ song.title }}</b>
    <div class="text-xs text-mute">{{ song.artist||'Chưa rõ ca sĩ' }}<span v-if="song.genre"> · {{ song.genre.name }}</span><span v-if="song.album"> · {{ song.album.title }}</span> · {{ song.plays }} lượt nghe</div>
    <audio :src="song.url" controls preload="none" class="w-full"></audio>
    <p v-if="song.desc" class="text-sm text-mute break-words">{{ song.desc }}</p>
    <div class="flex gap-2 items-center">
     <button class="btn !bg-transparent border border-line !h-8 text-sm" @click="togLike(song)">{{ song.liked?'❤️':'🤍' }} {{ song.likes }}</button>
     <button v-if="song.mine" class="btn !bg-transparent border border-line !h-8 text-sm !text-[#d64545]" @click="delSong(song)">🗑️ Xóa</button>
     <select v-if="pls.length" class="ip !w-auto !h-8 text-sm" @change="addToPl(song.id,$event.target.value);$event.target.value=''" aria-label="Thêm vào playlist"><option value="">＋ Playlist…</option><option v-for="p in pls" :key="p.id" :value="p.id">{{ p.title }}</option></select>
    </div>
    <c-favrate kind="song" :refid="song.id" :title="song.title"></c-favrate>
   </div>
  </template>
  <template v-else>
   <button v-if="!sform" class="btn btn-g w-full" @click="write">＋ Đăng bài hát</button>
   <form v-else class="card p-4 space-y-3" @submit.prevent="saveSong">
    <input v-model="sform.title" class="ip" maxlength="100" placeholder="Tên bài hát" aria-label="Tên bài hát">
    <input v-model="sform.artist" class="ip" maxlength="80" placeholder="Ca sĩ (không bắt buộc)" aria-label="Ca sĩ">
    <div class="flex gap-2 items-center flex-wrap">
     <label class="btn !bg-transparent border border-line cursor-pointer !h-9 text-sm">{{ upBusy?'Đang tải…':'📤 Chọn file nhạc' }}<input type="file" accept="audio/*" class="hidden" @change="pickFile"></label>
     <input v-model="sform.url" class="ip flex-1 text-sm" maxlength="300" placeholder="…hoặc dán URL file mp3" aria-label="URL file nhạc">
    </div>
    <p v-if="upErr" class="text-sm" style="color:#d64545">{{ upErr }}</p>
    <div class="flex gap-2 flex-wrap">
     <select v-model="sform.genre" class="ip !w-auto text-sm" aria-label="Thể loại"><option value="">— Thể loại —</option><option v-for="g in genres" :key="g.id" :value="g.id">{{ g.name }}</option></select>
     <select v-model="sform.album" class="ip !w-auto text-sm" aria-label="Album"><option value="">— Album —</option><option v-for="a in albums" :key="a.id" :value="a.id">{{ a.title }}</option></select>
     <input v-model.number="sform.duration" type="number" min="0" class="ip !w-28 text-sm" placeholder="Giây" aria-label="Thời lượng (giây)">
    </div>
    <textarea v-model="sform.desc" class="ip" rows="2" maxlength="500" placeholder="Mô tả (không bắt buộc)" aria-label="Mô tả"></textarea>
    <div class="flex gap-2 justify-end"><button type="button" class="btn !bg-transparent border border-line" @click="sform=null">Hủy</button><button class="btn btn-g" :disabled="busy||upBusy">Đăng</button></div>
   </form>
   <div class="flex gap-2 flex-wrap">
    <select v-model="genre" class="ip !w-auto text-sm" @change="loadSongs" aria-label="Lọc thể loại"><option value="">Tất cả thể loại</option><option v-for="g in genres" :key="g.id" :value="g.id">{{ g.name }}</option></select>
    <input v-model="q" class="ip flex-1 text-sm" maxlength="40" placeholder="Tìm bài hát, ca sĩ…" @keydown.enter="loadSongs" aria-label="Tìm bài hát">
    <button class="btn !bg-transparent border border-line !h-9 text-sm" @click="loadSongs">Tìm</button>
   </div>
   <div v-if="!songs.length&&!busy" class="card p-4 text-sm text-mute">Chưa có bài hát nào.</div>
   <button v-for="s in songs" :key="s.id" class="uc-row w-full text-left block" @click="showSong(s.id)">
    <b class="break-words">🎵 {{ s.title }}</b><span class="block text-xs text-mute mt-1">{{ s.artist||'Chưa rõ ca sĩ' }} · ▶ {{ s.plays }} · ❤️ {{ s.likes }} · {{ ago(s.createdAt) }}</span>
   </button>
   <button v-if="hasMore" class="btn w-full !bg-transparent border border-line" :disabled="busyMore" @click="moreSongs">{{ busyMore?'Đang tải…':'Xem thêm' }}</button>
  </template>
 </template>
 <template v-else-if="tab==='albums'">
  <template v-if="album">
   <button class="gh" @click="album=null;loadAlbums()">« Album</button>
   <div class="card p-4 space-y-2"><b class="text-lg break-words">💿 {{ album.title }}</b>
    <div class="text-xs text-mute">{{ album.owner&&album.owner.name }}<span v-if="album.year"> · {{ album.year }}</span></div>
    <p v-if="album.desc" class="text-sm text-mute break-words">{{ album.desc }}</p>
    <div v-if="!album.songs.length" class="text-sm text-mute">Album chưa có bài hát nào.</div>
    <button v-for="s in album.songs" :key="s.id" class="uc-row w-full text-left block" @click="tab='songs';showSong(s.id)"><b class="break-words">🎵 {{ s.title }}</b><span class="block text-xs text-mute mt-1">{{ s.artist||'' }} · ▶ {{ s.plays }}</span></button>
   </div>
  </template>
  <template v-else>
   <button v-if="!aform" class="btn btn-g w-full" @click="aform={title:'',desc:'',year:'',cover:''}">＋ Tạo album</button>
   <form v-else class="card p-4 space-y-3" @submit.prevent="saveAlbum">
    <input v-model="aform.title" class="ip" maxlength="80" placeholder="Tên album" aria-label="Tên album">
    <div class="flex gap-2"><input v-model="aform.year" class="ip !w-28 text-sm" maxlength="4" placeholder="Năm" aria-label="Năm"><input v-model="aform.cover" class="ip flex-1 text-sm" maxlength="300" placeholder="URL ảnh bìa (không bắt buộc)" aria-label="Ảnh bìa"></div>
    <textarea v-model="aform.desc" class="ip" rows="2" maxlength="500" placeholder="Mô tả" aria-label="Mô tả"></textarea>
    <div class="flex gap-2 justify-end"><button type="button" class="btn !bg-transparent border border-line" @click="aform=null">Hủy</button><button class="btn btn-g" :disabled="busy">Tạo</button></div>
   </form>
   <div v-if="!albums.length&&!busy" class="card p-4 text-sm text-mute">Chưa có album nào.</div>
   <div v-for="a in albums" :key="a.id" class="card p-3 flex items-center gap-3">
    <button class="flex-1 text-left min-w-0" @click="showAlbum(a.id)"><b class="break-words">💿 {{ a.title }}</b><span class="block text-xs text-mute mt-1">{{ a.owner&&a.owner.name }} · {{ a.songNum }} bài</span></button>
    <button v-if="a.owner&&a.mine!==false" class="gh !text-xs" @click="delAlbum(a)">Xóa</button>
   </div>
  </template>
 </template>
 <template v-else>
  <template v-if="pl">
   <button class="gh" @click="pl=null;loadPls()">« Playlist</button>
   <div class="card p-4 space-y-2"><div class="flex items-center justify-between"><b class="text-lg break-words">🎧 {{ pl.title }}</b><button class="btn !bg-transparent border border-line !h-8 text-sm !text-[#d64545]" @click="delPl">Xóa playlist</button></div>
    <div v-if="!pl.songs.length" class="text-sm text-mute">Playlist trống. Mở một bài hát rồi chọn “＋ Playlist…” để thêm.</div>
    <div v-for="s in pl.songs" :key="s.id" class="uc-row flex items-center gap-2"><button class="flex-1 text-left min-w-0" @click="tab='songs';showSong(s.id)"><b class="break-words">🎵 {{ s.title }}</b><span class="block text-xs text-mute mt-1">{{ s.artist||'' }}</span></button><button class="gh !text-xs" @click="rmFromPl(s.id)">Gỡ</button></div>
   </div>
  </template>
  <template v-else>
   <button v-if="!plform" class="btn btn-g w-full" @click="plform={title:''}">＋ Tạo playlist</button>
   <form v-else class="card p-3 flex gap-2" @submit.prevent="savePl"><input v-model="plform.title" class="ip flex-1" maxlength="80" placeholder="Tên playlist" aria-label="Tên playlist"><button type="button" class="btn !bg-transparent border border-line" @click="plform=null">Hủy</button><button class="btn btn-g" :disabled="busy">Tạo</button></form>
   <div v-if="!pls.length&&!busy" class="card p-4 text-sm text-mute">Chưa có playlist nào.</div>
   <button v-for="p in pls" :key="p.id" class="uc-row w-full text-left block" @click="showPl(p.id)"><b class="break-words">🎧 {{ p.title }}</b><span class="block text-xs text-mute mt-1">{{ p.songNum }} bài</span></button>
  </template>
 </template>
</div>`};

/* Component: Video (port module video của phpFox) – tải lên / nhúng link, chuyên mục, nổi bật, bình luận */
const CVideos={props:{open:String},emits:['used'],
data:()=>({tab:'all',list:[],total:0,pg:1,cat:'',cats:[],q:'',video:null,comments:[],ctext:'',vform:null,upBusy:false,upPct:0,upErr:'',busy:false,busyMore:false,err:''}),
created(){this.loadCats();if(this.open){const id=this.open;this.$emit('used');this.show(id)}else this.load()},
computed:{hasMore(){return this.list.length<this.total}},
methods:{ago,
 async run(fn){this.err='';try{await fn()}catch(e){this.err=e.message}},
 async loadCats(){try{this.cats=(await api('GET','/video/cats')).cats}catch(e){}},
 load(){this.busy=true;this.pg=1;const p=new URLSearchParams({page:1,sort:this.tab==='hot'?'views':'new'});if(this.cat)p.set('cat',this.cat);if(this.q.trim())p.set('q',this.q.trim());if(this.tab==='featured')p.set('featured','1');
  return this.run(async()=>{const d=await api('GET','/videos?'+p);this.list=d.videos;this.total=d.total}).finally(()=>this.busy=false)},
 more(){if(this.busyMore)return;this.busyMore=true;const p=new URLSearchParams({page:this.pg+1,sort:this.tab==='hot'?'views':'new'});if(this.cat)p.set('cat',this.cat);if(this.q.trim())p.set('q',this.q.trim());if(this.tab==='featured')p.set('featured','1');
  return this.run(async()=>{const d=await api('GET','/videos?'+p);this.pg++;this.total=d.total;const h=new Set(this.list.map(v=>v.id));this.list.push(...d.videos.filter(v=>!h.has(v.id)))}).finally(()=>this.busyMore=false)},
 setTab(t){this.tab=t;this.video=null;this.load()},
 show(id){this.busy=true;return this.run(async()=>{const d=await api('GET','/videos/'+id);this.video=d.video;this.comments=d.video.comments||[]}).finally(()=>this.busy=false)},
 back(){this.video=null;this.vform=null;this.load()},
 togLike(){const v=this.video;this.run(async()=>{const d=v.liked?await api('DELETE','/videos/'+v.id+'/like'):await api('POST','/videos/'+v.id+'/like');v.liked=d.liked;v.likes+=d.liked?1:-1})},
 del(){if(!confirm('Xóa video này?'))return;this.run(async()=>{await api('DELETE','/videos/'+this.video.id);this.back()})},
 comment(){if(!this.ctext.trim())return;this.run(async()=>{const d=await api('POST','/videos/'+this.video.id+'/comments',{text:this.ctext});this.ctext='';this.video.commentNum=d.commentNum;const v=(await api('GET','/videos/'+this.video.id)).video;this.comments=v.comments||[]})},
 delComment(c){if(!confirm('Xóa bình luận này?'))return;this.run(async()=>{await api('DELETE','/videos/'+this.video.id+'/comments/'+c.id);this.comments=this.comments.filter(x=>x.id!==c.id);this.video.commentNum--})},
 write(){this.vform={title:'',desc:'',cat:'',kind:'upload',url:'',site:'',vid:'',thumb:''}},
 async pickFile(e){const f=e.target.files[0];e.target.value='';if(!f)return;this.upBusy=true;this.upErr='';this.upPct=0;
  try{this.vform.url=await cloudUp('video',f,p=>{this.upPct=Math.min(100,Math.round(p*100))});this.vform.title=this.vform.title||f.name.replace(/\.[^.]+$/,'')}catch(x){this.upErr=x.message}finally{this.upBusy=false}},
 async grab(){const m=/youtu\.?be|vimeo|tiktok|dailymotion|dai\.ly/.test(this.vform.url);if(!m){this.upErr='Dán link YouTube / Vimeo / TikTok / Dailymotion để nhúng.';return}
  this.upBusy=true;this.upErr='';try{const d=(await api('GET','/video/grab?url='+encodeURIComponent(this.vform.url.trim()))).video;this.vform.kind='embed';this.vform.site=d.site;this.vform.vid=d.vid;this.vform.title=this.vform.title||d.title||'';this.vform.thumb=d.thumb||''}catch(x){this.upErr=x.message}finally{this.upBusy=false}},
 save(){const f=this.vform;if(!f.title.trim()){this.err='Nhập tiêu đề video.';return}
  if(f.kind==='upload'&&!f.url){this.err='Hãy tải file video lên.';return}if(f.kind==='embed'&&(!f.site||!f.vid)){this.err='Hãy lấy thông tin link nhúng trước.';return}
  this.busy=true;return this.run(async()=>{const d=await api('POST','/videos',{title:f.title,desc:f.desc,cat:f.cat||undefined,kind:f.kind,url:f.url,site:f.site,vid:f.vid,thumb:f.thumb});this.vform=null;this.show(d.video.id)}).finally(()=>this.busy=false)}},
template:`<div class="space-y-3">
 <p v-if="err" class="text-sm" style="color:#d64545" role="alert">{{ err }}</p>
 <template v-if="video">
  <button class="gh" @click="back">« Danh sách video</button>
  <article class="card p-4 space-y-3">
   <h2 class="!m-0 text-lg font-bold break-words">🎬 {{ video.title }}<span v-if="video.featured" class="text-xs ml-2 px-1.5 py-0.5 rounded" style="background:gold">Nổi bật</span></h2>
   <div class="text-xs text-mute">{{ video.owner&&video.owner.name }} · {{ ago(video.createdAt) }} · 👁 {{ video.views }}<span v-if="video.cat"> · {{ video.cat.name }}</span></div>
   <video v-if="video.kind==='upload'" :src="video.url" controls preload="metadata" class="w-full rounded"></video>
   <div v-else-if="video.site==='youtube'" class="aspect-video w-full"><iframe :src="'https://www.youtube-nocookie.com/embed/'+encodeURIComponent(video.vid)" class="w-full h-full rounded" allowfullscreen loading="lazy" title="Video"></iframe></div>
   <div v-else-if="video.site==='vimeo'" class="aspect-video w-full"><iframe :src="'https://player.vimeo.com/video/'+encodeURIComponent(video.vid)" class="w-full h-full rounded" allowfullscreen loading="lazy" title="Video"></iframe></div>
   <div v-else-if="video.site==='dailymotion'" class="aspect-video w-full"><iframe :src="'https://www.dailymotion.com/embed/video/'+encodeURIComponent(video.vid)" class="w-full h-full rounded" allowfullscreen loading="lazy" title="Video"></iframe></div>
   <div v-else-if="video.site==='tiktok'" class="flex justify-center"><iframe :src="'https://www.tiktok.com/embed/v2/'+encodeURIComponent(video.vid)" class="w-full rounded" style="max-width:325px;height:740px;border:0" allowfullscreen loading="lazy" title="Video"></iframe></div>
   <a v-else :href="video.url||('#')" target="_blank" rel="noopener" class="btn !bg-transparent border border-line">▶ Mở video ({{ video.site }})</a>
   <p v-if="video.desc" class="text-sm text-mute whitespace-pre-wrap break-words">{{ video.desc }}</p>
   <div class="flex gap-2"><button class="btn !bg-transparent border border-line !h-8 text-sm" @click="togLike">{{ video.liked?'❤️':'🤍' }} {{ video.likes }}</button>
    <button v-if="video.mine" class="btn !bg-transparent border border-line !h-8 text-sm !text-[#d64545]" @click="del">🗑️ Xóa</button></div>
   <c-favrate kind="video" :refid="video.id" :title="video.title"></c-favrate>
  </article>
  <div class="card p-4 space-y-2"><b class="text-sm">💬 Bình luận ({{ video.commentNum }})</b>
   <div v-for="c in comments" :key="c.id" class="text-sm"><b>{{ c.user&&c.user.name }}</b> <span class="break-words"><c-tx :t="c.text"/></span> <span class="text-xs text-mute">{{ ago(c.createdAt) }}</span></div>
   <p v-if="!comments.length" class="text-sm text-mute">Chưa có bình luận.</p>
   <form class="flex gap-2" @submit.prevent="comment"><input v-model="ctext" class="ip flex-1 text-sm" maxlength="500" placeholder="Viết bình luận…" aria-label="Bình luận"><button class="btn btn-g !h-9 text-sm" :disabled="busy">Gửi</button></form>
  </div>
 </template>
 <template v-else>
  <button v-if="!vform" class="btn btn-g w-full" @click="write">＋ Đăng video</button>
  <form v-else class="card p-4 space-y-3" @submit.prevent="save">
   <input v-model="vform.title" class="ip" maxlength="120" placeholder="Tiêu đề video" aria-label="Tiêu đề">
   <div class="flex gap-2 flex-wrap text-sm">
    <label class="flex items-center gap-1"><input v-model="vform.kind" type="radio" value="upload" @change="vform.url='';vform.site='';vform.vid='';vform.thumb='';upErr=''"> Tải lên</label>
    <label class="flex items-center gap-1"><input v-model="vform.kind" type="radio" value="embed" @change="vform.url='';vform.site='';vform.vid='';vform.thumb='';upErr=''"> Nhúng link</label>
   </div>
   <div v-if="vform.kind==='upload'" class="flex gap-2 items-center flex-wrap">
    <label class="btn !bg-transparent border border-line cursor-pointer !h-9 text-sm">{{ upBusy?'Đang tải… '+upPct+'%':'📤 Chọn file video' }}<input type="file" accept="video/*" class="hidden" @change="pickFile"></label>
    <span v-if="vform.url" class="text-xs text-mute truncate">Đã tải lên ✓</span>
   </div>
   <div v-else class="flex gap-2">
    <input v-model="vform.url" class="ip flex-1 text-sm" placeholder="Dán link YouTube / Vimeo / TikTok…" aria-label="Link video">
    <button type="button" class="btn !bg-transparent border border-line !h-9 text-sm" :disabled="upBusy" @click="grab">{{ upBusy?'…':'Lấy thông tin' }}</button>
   </div>
   <p v-if="upErr" class="text-sm" style="color:#d64545">{{ upErr }}</p>
   <select v-model="vform.cat" class="ip !w-auto text-sm" aria-label="Chuyên mục"><option value="">— Chuyên mục —</option><option v-for="c in cats" :key="c.id" :value="c.id">{{ c.name }}</option></select>
   <textarea v-model="vform.desc" class="ip" rows="2" maxlength="2000" placeholder="Mô tả (không bắt buộc)" aria-label="Mô tả"></textarea>
   <div class="flex gap-2 justify-end"><button type="button" class="btn !bg-transparent border border-line" @click="vform=null">Hủy</button><button class="btn btn-g" :disabled="busy||upBusy">Đăng</button></div>
  </form>
  <div class="flex gap-1 flex-wrap">
   <button v-for="t in [['all','Mới nhất'],['hot','Xem nhiều'],['featured','Nổi bật']]" :key="t[0]" class="btn !py-1 text-sm" :class="tab===t[0]?'btn-g':'!bg-transparent border border-line'" @click="setTab(t[0])">{{ t[1] }}</button>
   <select v-model="cat" class="ip !w-auto !h-8 text-sm" @change="load" aria-label="Chuyên mục"><option value="">Tất cả chuyên mục</option><option v-for="c in cats" :key="c.id" :value="c.id">{{ c.name }}</option></select>
   <input v-model="q" class="ip flex-1 text-sm !h-8" maxlength="40" placeholder="Tìm video…" @keydown.enter="load" aria-label="Tìm video">
  </div>
  <div v-if="!list.length&&!busy" class="card p-4 text-sm text-mute">Chưa có video nào.</div>
  <button v-for="v in list" :key="v.id" class="uc-row w-full text-left block" @click="show(v.id)">
   <b class="break-words">🎬 {{ v.title }}<span v-if="v.featured" class="text-xs ml-1">⭐</span></b>
   <span class="block text-xs text-mute mt-1">{{ v.owner&&v.owner.name }} · 👁 {{ v.views }} · ❤️ {{ v.likes }} · 💬 {{ v.commentNum }} · {{ ago(v.createdAt) }}</span>
  </button>
  <button v-if="hasMore" class="btn w-full !bg-transparent border border-line" :disabled="busyMore" @click="more">{{ busyMore?'Đang tải…':'Xem thêm' }}</button>
 </template>
</div>`};


export { CMusic, CVideos };
