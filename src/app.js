import appRender from 'virtual:app-template';   // template của #app (index.html) được biên dịch lúc build bởi scripts/vite-vue-precompile.mjs
import * as Vue from 'vue';
import { SSO_NONE, SSO_TRY, ago, api, computed, createApp, group, map, nextTick, reactive, ref, watch } from './lib/core.js';
import { cloudUp } from './modules/post.js';
import { IMG } from './lib/images.js';
const app=createApp({render:appRender,setup(){
  const booting=ref(true),busy=ref(false),me=ref(''),uid=ref(''),authed=ref(false),mode=ref('in'),err=ref(''),f=reactive({u:'',p:'',n:'',s:'',e:'',w:'',i:''}),t=reactive({}),srv=reactive({}),show=reactive({p:false,w:false});
 const RX=/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
 const rules={
  u:v=>!v.trim()?'Nhập tên đăng nhập hoặc email.':v.includes('@')?(RX.test(v.trim())?'':'Email chưa đúng định dạng.'):/^[A-Za-z0-9._]{3,20}$/.test(v.trim())?'':'Tên đăng nhập 3–20 ký tự, gồm chữ, số, dấu . hoặc _',
  p:v=>v?'':'Nhập mật khẩu.',
  s:v=>!v.trim()?'Nhập tên đăng nhập.':/^[A-Za-z0-9._]{3,20}$/.test(v.trim())?'':'Tên đăng nhập 3–20 ký tự, gồm chữ, số, dấu . hoặc _ (không dấu, không khoảng trắng).',
  n:v=>!v.trim()?'Nhập tên hiển thị.':v.trim().length<2?'Tên hiển thị cần ít nhất 2 ký tự.':v.trim().length>30?'Tên hiển thị tối đa 30 ký tự.':'',
  e:v=>!v.trim()?'Nhập email.':RX.test(v.trim())?'':'Email chưa đúng định dạng (vd: ban@email.com).',
  i:v=>!v||/^[A-Fa-f0-9]{12}$/.test(v.trim())?'':'Mã mời gồm 12 ký tự (chữ a–f và số).',
  w:v=>!v?'Nhập mật khẩu.':v.length<8?'Mật khẩu cần ít nhất 8 ký tự.':!/[A-Za-z]/.test(v)||!/\d/.test(v)?'Mật khẩu cần có cả chữ và số.':new TextEncoder().encode(v).length>72?'Mật khẩu tối đa 72 ký tự.':''};
 const er=computed(()=>Object.fromEntries(Object.keys(rules).map(k=>[k,rules[k](f[k])])));
 const sc=computed(()=>rules.w(f.w)?1:(f.w.length>=12||/[^A-Za-z0-9]/.test(f.w)?3:2));
 const focusBad=c=>nextTick(()=>{const el=document.querySelector('.au .'+c+' [aria-invalid="true"]');if(el)el.focus()});
 const clear=()=>{[t,srv].forEach(o=>Object.keys(o).forEach(k=>delete o[k]));err.value='';show.p=show.w=false};
 const sw=m=>{mode.value=m;clear();f.p=f.w=''};
 const inv=reactive({by:''});   // tên người mời (khi mã mời hợp lệ)
 const invCheck=async()=>{inv.by='';const c=f.i.trim().toLowerCase();if(!c||er.value.i)return;try{const d=await api('GET','/invites/check?code='+encodeURIComponent(c));inv.by=d.inviter.name}catch(e){srv.i=e.message;t.i=1}};
 {const c=(new URLSearchParams(location.search).get('invite')||'').trim().toLowerCase();   // liên kết mời: /?invite=<mã>
  if(c&&/^[a-f0-9]{12}$/.test(c)){f.i=c;try{sessionStorage.setItem('coolair_invite',c)}catch(e){}{const u=new URLSearchParams(location.search);u.delete('invite');history.replaceState(null,'',location.pathname+(u.toString()?'?'+u:'')+location.hash)}}
  else{try{const k=sessionStorage.getItem('coolair_invite');if(k)f.i=k}catch(e){}}
  if(f.i&&!authed.value){mode.value='up';Promise.resolve().then(invCheck)}}
 /* Upload avatar: xin chữ ký -> tải thẳng lên Cloudinary -> báo server lưu URL */
 const av=reactive({busy:false,err:''});
 const pickAv=async ev=>{const f=ev.target.files[0];ev.target.value='';if(!f||av.busy)return;av.err='';
  av.busy=true;try{const url=await cloudUp('avatar',f),d=await api('PUT','/me/avatar',{url});acct.avatar=d.user.avatar||''}catch(e){av.err=e.message}finally{av.busy=false}};
 const rmAv=async()=>{if(av.busy||!acct.avatar||!confirm('Gỡ ảnh đại diện?'))return;av.busy=true;av.err='';try{const d=await api('DELETE','/me/avatar');acct.avatar=d.user.avatar||''}catch(e){av.err=e.message}finally{av.busy=false}};
 const cv=reactive({busy:false,err:'',imgErr:false,repos:false,tx:50,ty:50});const cvBox=ref(null);
 const phv=reactive({src:'',kind:''});
 const openPv=kind=>{phv.kind=kind;phv.src=kind==='cover'?acct.cover:acct.avatar};
 const closePv=()=>{phv.src='';phv.kind=''};
 const pvPick=async e=>{const k=phv.kind;await (k==='cover'?pickCv(e):pickAv(e));const u=k==='cover'?acct.cover:acct.avatar;if(u)phv.src=u;else closePv()};
 const pvRemove=async()=>{if(phv.kind==='cover')await rmCv();else await rmAv();closePv()};
 const pickCv=async ev=>{const f=ev.target.files[0];ev.target.value='';if(!f||cv.busy)return;cv.err='';cv.imgErr=false;
  cv.busy=true;try{const url=await cloudUp('cover',f),d=await api('PUT','/me/cover',{url});acct.cover=d.user.cover||''}catch(e){cv.err=e.message}finally{cv.busy=false}};
 const rmCv=async()=>{if(cv.busy||!acct.cover||!confirm('Gỡ ảnh bìa? Bìa sẽ trở về mặc định theo giao diện.'))return;cv.busy=true;cv.err='';try{const d=await api('DELETE','/me/cover');acct.cover=d.user.cover||''}catch(e){cv.err=e.message}finally{cv.busy=false}};
 let cvDrag=null;
 const cvReposStart=()=>{const m=(acct.coverPos||'50% 50%').match(/^(\d{1,3})% (\d{1,3})%$/);cv.tx=m?+m[1]:50;cv.ty=m?+m[2]:50;cvDrag=null;cv.repos=true};
 const cvReposDown=e=>{if(!cv.repos)return;e.preventDefault();try{e.target.setPointerCapture(e.pointerId)}catch(_){}cvDrag={y:e.clientY,tx:cv.tx,ty:cv.ty}};
 const cvReposMove=e=>{if(!cv.repos||!cvDrag)return;const box=cvBox.value;if(!box)return;const r=box.getBoundingClientRect();cv.ty=Math.min(100,Math.max(0,cvDrag.ty+(e.clientY-cvDrag.y)/r.height*100));};
 const cvReposUp=()=>{cvDrag=null};
 const cvReposSave=async()=>{if(cv.busy)return;cv.busy=true;cv.err='';try{const pos=Math.round(cv.tx)+'% '+Math.round(cv.ty)+'%';const d=await api('PATCH','/me/cover/pos',{pos});acct.coverPos=d.user.coverPos||pos;cv.repos=false}catch(e){cv.err=e.message}finally{cv.busy=false}};
 const loadAll=async()=>{startRt();gInvN();loadFr();loadPokes();ntCount();posts.splice(0);more.all=more.mine=true;first.value=true;api('GET','/guestbook/'+uid.value).then(g=>{gb.value=g.map(x=>[x.name,x.gift,x.text,x.av||''])}).catch(e=>alert(e.message));await loadMore('all');await loadMore('mine');first.value=false};
 const acct=reactive({avatar:'',cover:'',coverPos:'50% 50%',verified:true,blueTick:false,email:'',username:'',phone:'',birthday:'',age:null,location:'',bio:'',joined:'',theme:{id:'',bg:'',accent:''},noTheme:false,admin:false,extra:{}}),sg=reactive({name:'',username:'',phone:'',birthday:'',location:'',bio:'',extra:{},err:{},msg:'',busy:false,vErr:''});
 const pf=reactive({list:[],loaded:false}),pa=reactive({f:null,id:'',err:{},busy:false,order:{}});
 const loadPf=async()=>{try{pf.list=(await api('GET','/profile-fields')).fields;pf.loaded=true;pa.order=Object.fromEntries(pf.list.map(f=>[f.id,f.displayorder]));pf.list.forEach(f=>{if(sg.extra[f.id]===undefined)sg.extra[f.id]=acct.extra[f.id]||''})}catch(e){}};
 const paEdit=f=>{pa.err={};pa.id=f?f.id:'';pa.f=f?{title:f.title,note:f.note,formtype:f.formtype,choice:f.choice.join('\n'),maxsize:f.maxsize,displayorder:f.displayorder,required:f.required,invisible:f.invisible,allowsearch:f.allowsearch}:{title:'',note:'',formtype:'text',choice:'',maxsize:50,displayorder:pf.list.length+1,required:false,invisible:false,allowsearch:false}};
 const paSave=async()=>{if(pa.busy)return;pa.busy=true;pa.err={};try{const b=Object.assign({},pa.f,{allowsearch:pa.f.invisible?false:pa.f.allowsearch});await api(pa.id?'PATCH':'POST','/admin/profile-fields'+(pa.id?'/'+pa.id:''),b);pa.f=null;await loadPf()}catch(e){pa.err=Object.assign({},e.fields,{all:e.fields&&Object.values(e.fields).some(Boolean)?'':e.message})}finally{pa.busy=false}};
 const paDel=async f=>{if(!confirm('Xóa trường "'+f.title+'"? Giá trị mà mọi người đã điền cho trường này cũng bị xóa.'))return;try{await api('DELETE','/admin/profile-fields/'+f.id);await loadPf()}catch(e){alert(e.message)}};
 const paOrder=async()=>{if(pa.busy)return;pa.busy=true;try{await api('PUT','/admin/profile-fields/order',{order:pa.order});await loadPf()}catch(e){alert(e.message)}finally{pa.busy=false}};
 /* ===== Nhóm (port từ mtag của UCHome) ===== */
 const GN={'-2':'Chờ duyệt','-1':'Bị cấm','0':'Thành viên','1':'Thành viên sao','8':'Phó nhóm','9':'Chủ nhóm'},GFT={text:'Tự đặt tên nhóm',select:'Chọn một nhóm',multi:'Chọn nhiều nhóm'};
 const GTABS=[['hot','🔥 Nổi bật'],['recommend','⭐ Đề cử'],['me','📌 Nhóm của tôi'],['manage','🛡️ Tôi quản lý'],['invites','✉️ Lời mời']];
 const gr=reactive({page:'list',tab:'hot',cat:'',q:'',orderby:'threadNum',list:[],total:0,pg:1,per:20,cats:[],invites:[],invN:0,busy:false,err:'',msg:'',
  g:null,gtab:'threads',threads:[],tTotal:0,tPg:1,tper:30,tq:'',members:[],mTotal:0,mPg:1,mq:'',inv:{list:[],sel:{},q:''},
  newT:{open:false,subject:'',text:'',err:{}},th:null,reply:{text:'',quote:'',qname:'',err:''},edit:{id:'',text:'',subject:'',err:''},
  set:{pic:'',announcement:'',joinperm:0,viewperm:0,threadperm:0,postperm:0,closeapply:false,recommend:false,closed:false},c:{cat:'',name:'',names:[],err:{}}});
 const ga=reactive({f:null,id:'',del:null,err:{},busy:false,order:{}});
 const gCat=computed(()=>gr.cats.find(c=>c.id===gr.c.cat)||null);
 const gTabs=computed(()=>{const g=gr.g;if(!g)return[];const t=[['threads','💬 Chủ đề'],['digest','💎 Tinh hoa'],['members','👥 Thành viên']];if(g.allowinvite)t.push(['invite','✉️ Mời bạn']);if(g.manager)t.push(['manage','⚙️ Quản lý']);return t});
 const gT=d=>new Date(d).toLocaleString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
 const gFail=e=>{gr.err=e.message||'Có lỗi xảy ra.'};
 const gInvN=async()=>{try{gr.invN=(await api('GET','/group-invites')).invites.length}catch(e){}};
 const gCats=async()=>{try{gr.cats=(await api('GET','/group-categories')).categories;ga.order=Object.fromEntries(gr.cats.map(c=>[c.id,c.displayorder]))}catch(e){}};
 const gGo=()=>{go('groups');gr.page='list';gr.err=gr.msg='';gCats();gLoad(1);gInvN()};
 const gLoad=async(pg)=>{gr.err='';gr.pg=pg||1;gr.busy=true;try{
   if(gr.tab==='invites'){gr.invites=(await api('GET','/group-invites')).invites;gr.invN=gr.invites.length;return}
   if(gr.tab==='admin')return;
   const p=new URLSearchParams({view:gr.tab,orderby:gr.orderby,page:gr.pg});if(gr.cat)p.set('category',gr.cat);if(gr.q.trim())p.set('q',gr.q.trim());
   const d=await api('GET','/groups?'+p);gr.list=d.groups;gr.total=d.total;gr.per=d.per}catch(e){gFail(e)}finally{gr.busy=false}};
 const gBack=()=>{gr.err=gr.msg='';if(gr.page==='thread'&&gr.th){gOpen(gr.th.group.id);return}gr.page='list';gLoad(gr.pg);gInvN()};
 const gOpen=async id=>{go('groups');gr.page='group';gr.g=null;gr.err=gr.msg='';gr.gtab='threads';gr.tq='';gr.newT={open:false,subject:'',text:'',err:{}};scrollTo(0,0);
   try{gr.g=await api('GET','/groups/'+id);await gThreads(1)}catch(e){gFail(e)}};
 const gReload=async()=>{try{gr.g=await api('GET','/groups/'+gr.g.id)}catch(e){gFail(e)}};
 const gThreads=async pg=>{gr.tPg=pg||1;try{const p=new URLSearchParams({page:gr.tPg});if(gr.gtab==='digest')p.set('digest','1');if(gr.tq.trim())p.set('q',gr.tq.trim());
   const d=await api('GET','/groups/'+gr.g.id+'/threads?'+p);gr.threads=d.threads;gr.tTotal=d.total;gr.tper=d.per}catch(e){gFail(e)}};
 const gTab=async t=>{gr.gtab=t;gr.err=gr.msg='';if(t==='threads'||t==='digest')await gThreads(1);else if(t==='members'){gr.mq='';await gMembers(1)}else if(t==='invite'){gr.inv={list:[],sel:{},q:''};await gInviteLoad()}
   else if(t==='manage'){const g=gr.g;Object.assign(gr.set,{pic:g.pic||'',announcement:g.announcement||'',joinperm:g.joinperm,viewperm:g.viewperm,threadperm:g.threadperm,postperm:g.postperm,closeapply:g.closeapply,recommend:g.recommend,closed:g.closed})}};
 const gMembers=async pg=>{gr.mPg=pg||1;try{const p=new URLSearchParams({page:gr.mPg});if(gr.mq.trim())p.set('q',gr.mq.trim());const d=await api('GET','/groups/'+gr.g.id+'/members?'+p);gr.members=d.members;gr.mTotal=d.total}catch(e){gFail(e)}};
 const gSetGrade=async(m,grade)=>{if(grade===-9&&!confirm('Mời '+m.name+' ra khỏi nhóm?')){await gMembers(gr.mPg);return}gr.err='';try{await api('POST','/groups/'+gr.g.id+'/members',{ids:[m.id],grade});await Promise.all([gMembers(gr.mPg),gReload()])}catch(e){gFail(e);await gMembers(gr.mPg)}};
 const gJoin=async()=>{if(gr.busy)return;gr.busy=true;gr.err=gr.msg='';try{const d=await api('POST','/groups/'+gr.g.id+'/join');gr.msg=d.pending?'Đã gửi đơn xin vào nhóm, hãy chờ chủ nhóm duyệt.':'Bạn đã vào nhóm.';await gReload();await gThreads(1)}catch(e){gFail(e)}finally{gr.busy=false}};
 const gLeave=async()=>{if(!confirm('Rời khỏi nhóm "'+gr.g.name+'"?'))return;try{await api('POST','/groups/'+gr.g.id+'/leave');gr.page='list';gLoad(1)}catch(e){gFail(e)}};
 const gCreate=async()=>{if(gr.busy||!gCat.value)return;gr.busy=true;gr.err='';gr.c.err={};const c=gCat.value;try{
   const d=await api('POST','/groups',c.formtype==='text'?{category:c.id,name:gr.c.name}:{category:c.id,names:gr.c.names});
   if(d.group){if(d.pending)gr.msg='Đã gửi đơn xin vào nhóm, hãy chờ chủ nhóm duyệt.';await gOpen(d.group.id)}
   else{gr.page='list';gr.tab='me';gr.msg='Đã tham gia '+d.groups.length+' nhóm.'+(d.errors&&d.errors.length?' '+d.errors.join(' '):'');gLoad(1)}
  }catch(e){gr.c.err=e.fields||{};gr.err=e.fields&&Object.values(e.fields).some(Boolean)?'':e.message}finally{gr.busy=false}};
 const gImgErr=e=>{const i=e.target;if(!i.src.endsWith('/img/nologo.jpg'))i.src='/img/nologo.jpg'};
 const gSave=async()=>{if(gr.busy)return;gr.busy=true;gr.err=gr.msg='';const s=gr.set,b={announcement:s.announcement,pic:(s.pic||'').trim()};
   if(gr.g.owner)Object.assign(b,{joinperm:s.joinperm,viewperm:s.viewperm,threadperm:s.threadperm,postperm:s.postperm});if(acct.admin)Object.assign(b,{recommend:s.recommend,closed:s.closed});
   try{await api('PATCH','/groups/'+gr.g.id,b);gr.msg='Đã lưu.';await gReload()}catch(e){gFail(e)}finally{gr.busy=false}};
 const gDelGroup=async()=>{if(!confirm('Xóa vĩnh viễn nhóm "'+gr.g.name+'" cùng mọi chủ đề, bài viết và thành viên?'))return;try{await api('DELETE','/groups/'+gr.g.id);gr.page='list';gLoad(1)}catch(e){gFail(e)}};
 const gInviteLoad=async()=>{try{const d=await api('GET','/groups/'+gr.g.id+'/invitable'+(gr.inv.q.trim()?'?q='+encodeURIComponent(gr.inv.q.trim()):''));gr.inv.list=d.friends}catch(e){gFail(e)}};
 const gInviteSend=async()=>{if(gr.busy)return;gr.busy=true;gr.err=gr.msg='';try{const ids=Object.keys(gr.inv.sel).filter(k=>gr.inv.sel[k]);const d=await api('POST','/groups/'+gr.g.id+'/invite',{ids});gr.msg='Đã gửi '+d.invited+' lời mời.';gr.inv.sel={};await gInviteLoad()}catch(e){gFail(e)}finally{gr.busy=false}};
 const gInvAcc=async i=>{gr.err=gr.msg='';try{await api('POST','/group-invites/'+i.group.id+'/accept');gOpen(i.group.id);gInvN()}catch(e){gFail(e);gLoad(1)}};
 const gInvDec=async i=>{try{await api('DELETE','/group-invites/'+(i?i.group.id:'all'));await gLoad(1)}catch(e){gFail(e)}};
 const gOpenThread=async(id,pg)=>{go('groups');if(!gr.th||gr.th.thread.id!==id)gr.th=null;gr.page='thread';gr.err=gr.msg='';gr.edit.id='';scrollTo(0,0);try{gr.th=await api('GET','/threads/'+id+'?page='+(pg||1))}catch(e){gFail(e)}};
 const gPostThread=async()=>{if(gr.busy)return;gr.busy=true;gr.newT.err={};try{const d=await api('POST','/groups/'+gr.g.id+'/threads',{subject:gr.newT.subject,text:gr.newT.text});gr.newT={open:false,subject:'',text:'',err:{}};await gOpenThread(d.id,1)}
   catch(e){gr.newT.err=Object.assign({},e.fields,{all:e.fields&&Object.values(e.fields).some(Boolean)?'':e.message})}finally{gr.busy=false}};
 const gReply=async()=>{if(gr.busy)return;gr.busy=true;gr.reply.err='';try{await api('POST','/threads/'+gr.th.thread.id+'/posts',{text:gr.reply.text,quoteId:gr.reply.quote||undefined});
   gr.reply={text:'',quote:'',qname:'',err:''};const last=Math.max(1,Math.ceil((gr.th.total+1)/gr.th.per));await gOpenThread(gr.th.thread.id,last);nextTick(()=>{const e=document.getElementById('g-reply');e&&e.scrollIntoView({behavior:'smooth',block:'end'})})}
   catch(e){gr.reply.err=e.message}finally{gr.busy=false}};
 const gEditStart=p=>{gr.edit={id:p.id,text:p.text,subject:p.isThread?gr.th.thread.subject:'',err:''}};
 const gEditSave=async()=>{if(gr.busy)return;gr.busy=true;gr.edit.err='';try{const b={text:gr.edit.text};if(gr.th.content&&gr.edit.id===gr.th.content.id)b.subject=gr.edit.subject;await api('PATCH','/group-posts/'+gr.edit.id,b);gr.edit.id='';await gOpenThread(gr.th.thread.id,gr.th.page)}catch(e){gr.edit.err=(e.fields&&Object.values(e.fields)[0])||e.message}finally{gr.busy=false}};
 const gDelPost=async p=>{if(!confirm(p.isThread?'Xóa cả chủ đề này và mọi trả lời?':'Xóa bài trả lời này?'))return;try{const d=await api('DELETE','/group-posts/'+p.id);if(d.threadDeleted)await gOpen(gr.th.group.id);else await gOpenThread(gr.th.thread.id,gr.th.page)}catch(e){gFail(e)}};
 const gFlag=async k=>{try{await api('PATCH','/threads/'+gr.th.thread.id,{[k]:!gr.th.thread[k]});await gOpenThread(gr.th.thread.id,gr.th.page)}catch(e){gFail(e)}};
 const gaEdit=c=>{ga.err={};ga.id=c?c.id:'';ga.f=c?{title:c.title,note:c.note,formtype:c.formtype,choice:c.choice.join('\n'),inputnum:c.inputnum,mtagminnum:c.mtagminnum,manualmoderator:c.manualmoderator,manualmember:c.manualmember,displayorder:c.displayorder}:{title:'',note:'',formtype:'text',choice:'',inputnum:0,mtagminnum:0,manualmoderator:false,manualmember:false,displayorder:gr.cats.length+1}};
 const gaSave=async()=>{if(ga.busy)return;ga.busy=true;ga.err={};try{await api(ga.id?'PATCH':'POST','/admin/group-categories'+(ga.id?'/'+ga.id:''),ga.f);ga.f=null;await gCats()}catch(e){ga.err=Object.assign({},e.fields,{all:e.fields&&Object.values(e.fields).some(Boolean)?'':e.message})}finally{ga.busy=false}};
 const gaDel=async()=>{if(ga.busy||!ga.del)return;if(!ga.del.to){ga.err={all:'Hãy chọn chuyên mục nhận các nhóm.'};return}ga.busy=true;ga.err={};try{await api('DELETE','/admin/group-categories/'+ga.del.id+'?to='+ga.del.to);ga.del=null;await gCats()}catch(e){ga.err={all:e.message}}finally{ga.busy=false}};
 const gaOrder=async()=>{if(ga.busy)return;ga.busy=true;try{await api('PUT','/admin/group-categories/order',{order:ga.order});await gCats()}catch(e){alert(e.message)}finally{ga.busy=false}};
 const setAcct=u=>{Object.assign(acct,{avatar:u.avatar||'',cover:u.cover||'',coverPos:u.coverPos||'50% 50%',verified:u.verified,blueTick:!!u.blueTick,email:u.email,username:u.username,totpEnabled:!!u.totpEnabled,phone:u.phone,birthday:u.birthday,age:u.age,location:u.location,bio:u.bio,joined:u.joined,theme:u.theme,noTheme:u.noTheme,admin:!!u.admin,extra:u.extra||{},mood:u.mood||''});blk.mood=u.mood||'';if(!blk.moods.length)loadMoods();syncTh(u);Object.assign(sg,{name:u.name,username:u.username,phone:u.phone,birthday:u.birthday,location:u.location,bio:u.bio,extra:Object.assign({},...pf.list.map(f=>({[f.id]:(u.extra||{})[f.id]||''})),{}),err:{},msg:'',vErr:''});pf.loaded?0:loadPf()};
 const enter=d=>{try{sessionStorage.removeItem('coolair_invite')}catch(e){}me.value=d.user.name;uid.value=d.user.id;setAcct(d.user);authed.value=true;clear();view.value=d.user.verified?'home':'settings';scrollTo(0,0);if(d.user.verified)loadAll()};
 const saveSg=async()=>{if(sg.busy)return;sg.busy=true;sg.err={};sg.msg='';try{const d=await api('PATCH','/settings',{name:sg.name,username:sg.username,phone:sg.phone,birthday:sg.birthday,location:sg.location,bio:sg.bio,extra:sg.extra});me.value=d.user.name;setAcct(d.user);sg.msg='Đã lưu thay đổi.'}catch(e){sg.err=Object.assign({},e.fields,{all:e.fields&&Object.values(e.fields).some(Boolean)?'':e.message})}finally{sg.busy=false}};
 const sendVerify=async()=>{if(sg.busy)return;sg.busy=true;sg.vErr='';try{const d=await api('POST','/settings/send-code');if(d.verified){acct.verified=true;loadAll()}else openVf(d.email,1)}catch(e){sg.vErr=e.message}finally{sg.busy=false}};
 /* Chặn + ẩn khỏi bảng tin + tâm trạng (mở rộng từ UCHome blacklist) */
 const blk=reactive({list:[],hidden:[],mood:'',moods:[],feedPrefs:{},feedLabels:{},busy:false,err:''});
 const loadBlk=async()=>{blk.busy=true;blk.err='';try{const [b,h,f]=await Promise.all([api('GET','/blacklist'),api('GET','/me/feed-hidden'),api('GET','/me/feed-prefs')]);blk.list=b.blacklist;blk.hidden=h.feedHidden;blk.feedPrefs=f.prefs;blk.feedLabels=f.labels}catch(e){blk.err=e.message}finally{blk.busy=false}};
 const unblockId=async id=>{try{await api('DELETE','/blacklist/'+id);blk.list=blk.list.filter(x=>x.user.id!==id)}catch(e){alert(e.message)}};
 const unhideId=async id=>{try{const ids=blk.hidden.map(x=>x.id).filter(x=>x!==id);await api('PUT','/me/feed-hidden',{ids});blk.hidden=blk.hidden.filter(x=>x.id!==id)}catch(e){alert(e.message)}};
 const setMood=async m=>{try{await api('PUT','/me/mood',{mood:m});blk.mood=m;acct.mood=m}catch(e){alert(e.message)}};
 const setFeedPref=async(k,v)=>{try{await api('PUT','/me/feed-prefs',{prefs:{[k]:v}});blk.feedPrefs[k]=v}catch(e){alert(e.message)}};
 const pv=reactive({privacy:{},sections:null,values:null,busy:false,err:''});
 const pw=reactive({cur:'',nw:'',cf:'',busy:false,err:'',ok:''});
 const dev=reactive({list:[],busy:false,err:''});
 const loadDev=async(force)=>{if(dev.busy&&!force)return;dev.busy=true;dev.err='';try{const d=await api('GET','/sessions');dev.list=d.sessions||[]}catch(e){dev.err=e.message}finally{dev.busy=false}};
 const revokeDev=async(sid)=>{if(!confirm('Thu hồi phiên đăng nhập này?'))return;dev.busy=true;try{const d=await api('DELETE','/sessions/'+encodeURIComponent(sid));if(d.current){logout();return}await loadDev(true)}catch(e){dev.err=e.message}finally{dev.busy=false}};
 const revokeOthers=async()=>{if(dev.list.length<2||!confirm('Đăng xuất mọi thiết bị khác?'))return;dev.busy=true;try{await api('DELETE','/sessions');await loadDev(true)}catch(e){dev.err=e.message}finally{dev.busy=false}};
 /* Xác thực 2 bước trong Cài đặt -> Bảo mật */
 const tfa2=reactive({busy:false,err:'',ok:'',showSetup:false,showOff:false,showBk:false,qr:'',secret:'',code:'',pw:'',backup:[],bkSaved:false});
 const tfaSetup=async()=>{tfa2.busy=true;tfa2.err='';tfa2.ok='';try{const d=await api('POST','/auth/totp/setup');Object.assign(tfa2,{qr:d.qr,secret:d.secret,code:'',backup:[],bkSaved:false,showSetup:true})}catch(e){tfa2.err=e.message}finally{tfa2.busy=false}};
 const tfaEnable=async()=>{const c=tfa2.code.replace(/[\s-]/g,'');if(!/^\d{6}$/.test(c)){tfa2.err='Nhập mã 6 số đang hiện trong app Authenticator.';return}tfa2.busy=true;tfa2.err='';try{const d=await api('POST','/auth/totp/enable',{code:c});tfa2.backup=d.backupCodes||[];tfa2.bkSaved=false;acct.totpEnabled=true;tfa2.err=''}catch(e){tfa2.err=e.message}finally{tfa2.busy=false}};
 const tfaCloseSetup=()=>{if(tfa2.backup.length&&!tfa2.bkSaved)return;tfa2.showSetup=false;tfa2.backup=[];tfa2.code=''};
 const tfaDisable=async()=>{const c=tfa2.code.replace(/[\s-]/g,'');if(!tfa2.pw){tfa2.err='Nhập mật khẩu hiện tại.';return}if(!/^\d{6}$/.test(c)&&!/^[0-9a-fA-F]{8}$/.test(c)){tfa2.err='Nhập mã 6 số từ app, hoặc 1 mã dự phòng.';return}tfa2.busy=true;tfa2.err='';try{await api('POST','/auth/totp/disable',{password:tfa2.pw,code:c});Object.assign(tfa2,{showOff:false,pw:'',code:'',ok:'Đã tắt xác thực 2 bước.'});acct.totpEnabled=false}catch(e){tfa2.err=(e.fields&&e.fields.password)||e.message}finally{tfa2.busy=false}};
 const tfaNewBackup=async()=>{const c=tfa2.code.replace(/[\s-]/g,'');if(!/^\d{6}$/.test(c)){tfa2.err='Nhập mã 6 số đang hiện trong app.';return}tfa2.busy=true;tfa2.err='';try{const d=await api('POST','/auth/totp/backup-codes',{code:c});Object.assign(tfa2,{backup:d.backupCodes||[],bkSaved:false,showBk:false,qr:'',secret:'',showSetup:true})}catch(e){tfa2.err=e.message}finally{tfa2.busy=false}};
 const chPw=async()=>{pw.err='';pw.ok='';if(!pw.cur){pw.err='Nhập mật khẩu hiện tại.';return}if(pw.nw.length<8||!/[A-Za-z]/.test(pw.nw)||!/\d/.test(pw.nw)){pw.err='Mật khẩu mới cần ít nhất 8 ký tự, có cả chữ và số.';return}if(pw.nw!==pw.cf){pw.err='Hai lần nhập mật khẩu mới chưa khớp.';return}pw.busy=true;try{await api('POST','/settings/password',{current:pw.cur,new:pw.nw});pw.ok='Đã đổi mật khẩu. Hãy đăng nhập lại.';pw.cur=pw.nw=pw.cf='';setTimeout(()=>{logout()},1500)}catch(e){pw.err=(e.fields&&(e.fields.current||e.fields.new))||e.message}finally{pw.busy=false}};
 const pvTab=async()=>{tab.value='spv';if(pv.sections||pv.busy)return;pv.busy=true;pv.err='';try{const d=await api('GET','/me/privacy');pv.privacy=d.privacy;pv.sections=d.sections;pv.values=d.values}catch(e){pv.err=e.message}finally{pv.busy=false}};
 const setPrivacy=async(k,v)=>{try{await api('PUT','/me/privacy',{privacy:{[k]:v}});pv.privacy[k]=v}catch(e){alert(e.message);pvTab()}};
 const blkTab=t=>{tab.value=t;if(t==='sblk'&&!blk.list.length&&!blk.busy)loadBlk()};
 const loadMoods=()=>{api('GET','/doings?view=mine&page=1').then(d=>{blk.moods=d.moods||[]}).catch(()=>{})};
 const check=(ks,c)=>{ks.forEach(k=>t[k]=1);if(!ks.some(k=>er.value[k]))return true;focusBad(c);return false};
 const send=async(url,body,c)=>{busy.value=true;err.value='';try{const d=await api('POST',url,body);d.needVerify?openVf(d.email,1):d.needTotp?openTfa(d.totpToken):enter(d)}catch(e){if(e.data&&e.data.needVerify)return openVf(e.data.email);const fl=Object.entries(e.fields||{}).filter(x=>x[1]);fl.forEach(([k,v])=>{const m={name:'n',username:'s',email:'e',password:'w',invite:'i'}[k];if(m){srv[m]=v;t[m]=1}});if(!fl.length)err.value=e.message;focusBad(c)}finally{busy.value=false}};
 /* Đăng nhập bước 2 (2FA): nhập mã 6 số từ app Authenticator, hoặc 1 mã dự phòng */
 const tfa=reactive({show:false,token:'',code:'',err:'',busy:false});
 const openTfa=tok=>{Object.assign(tfa,{show:true,token:tok,code:'',err:'',busy:false});busy.value=false};
 const closeTfa=()=>{tfa.show=false;tfa.token=''};
 const doTfa=async()=>{const c=tfa.code.replace(/[\s-]/g,'');if(!/^\d{6}$/.test(c)&&!/^[0-9a-fA-F]{8}$/.test(c)){tfa.err='Nhập mã 6 số từ app, hoặc 1 mã dự phòng (8 ký tự).';return}tfa.busy=true;tfa.err='';try{const d=await api('POST','/auth/login/totp',{totpToken:tfa.token,code:c});closeTfa();enter(d)}catch(e){tfa.err=e.message}finally{tfa.busy=false}};
 const login=()=>{if(check(['u','p'],'fi')&&!busy.value)send('/auth/login',{id:f.u,password:f.p},'fi')};
 const register=()=>{if(check(['s','e','w','i'],'fu')&&!busy.value)send('/auth/register',{username:f.s,email:f.e,password:f.w,invite:f.i.trim().toLowerCase()},'fu')};
 const fp=reactive({show:false,step:1,email:'',code:'',pw:'',show2:false,err:'',ok:'',busy:false,wait:0});let ft2;
  const openFp=()=>{Object.assign(fp,{show:true,step:1,email:f.u&&f.u.includes('@')?f.u:'',code:'',pw:'',err:'',ok:'',busy:false,wait:0})};
  const closeFp=()=>{fp.show=false;clearInterval(ft2)};
  const fpSend=async()=>{if(fp.busy||fp.wait>0)return;const em=fp.email.trim();if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)){fp.err='Email chưa đúng định dạng.';return}fp.busy=true;fp.err=fp.ok='';try{await api('POST','/auth/forgot',{email:em});fp.email=em;fp.step=2;fp.code='';fp.wait=60;clearInterval(ft2);ft2=setInterval(()=>{if(--fp.wait<=0)clearInterval(ft2)},1000)}catch(e){fp.err=e.message}finally{fp.busy=false}};
  const fpReset=async()=>{if(fp.busy)return;if(!/^\d{10}$/.test(fp.code)){fp.err='Nhập đủ 10 chữ số.';return}if(fp.pw.length<8||!/[A-Za-z]/.test(fp.pw)||!/\d/.test(fp.pw)){fp.err='Mật khẩu cần ít nhất 8 ký tự, có cả chữ và số.';return}if(new TextEncoder().encode(fp.pw).length>72){fp.err='Mật khẩu tối đa 72 ký tự.';return}fp.busy=true;fp.err='';try{await api('POST','/auth/reset',{email:fp.email,code:fp.code,password:fp.pw});closeFp();sw('in');f.u=fp.email;f.p='';err.value='Đã đặt lại mật khẩu. Hãy đăng nhập bằng mật khẩu mới.'}catch(e){fp.err=(e.fields&&e.fields.password)||e.message}finally{fp.busy=false}};
 const vf=reactive({show:false,email:'',code:'',err:'',busy:false,wait:0});let vt;
  const tickVf=()=>{clearInterval(vt);vf.wait=60;vt=setInterval(()=>{if(--vf.wait<=0)clearInterval(vt)},1000)};
  const openVf=(em,fresh)=>{Object.assign(vf,{show:true,email:em,code:'',err:'',busy:false,wait:0});clearInterval(vt);if(fresh)tickVf()};
  const closeVf=()=>{vf.show=false;clearInterval(vt)};
  const doVerify=async()=>{const c=vf.code.trim();if(!/^\d{10}$/.test(c)){vf.err='Nhập đủ 10 chữ số.';return}vf.busy=true;vf.err='';try{const d=await api('POST','/auth/verify',{email:vf.email,code:c});closeVf();enter(d)}catch(e){vf.err=e.message}finally{vf.busy=false}};
  const resend=async()=>{if(vf.wait>0||vf.busy)return;vf.busy=true;vf.err='';try{await api('POST','/auth/resend',{email:vf.email});vf.code='';tickVf()}catch(e){vf.err=e.message}finally{vf.busy=false}};
  const clearSession=()=>{endCall();stopRt();authed.value=false;posts.splice(0);F.splice(0);fx.sub='list';fx.g=-1;fx.vs.items=[];fx.tr.items=[];fx.iv.list=[];fx.visitorNew=0;fr.incoming=[];fr.sent=[];fr.unread=0;pk.list=[];pk.show=false;ntReset();closeChat();sw('in');scrollTo(0,0)};
 const logout=async()=>{await pushDrop();api('POST','/auth/logout').catch(()=>{});clearSession()};   // thu hồi phiên -> các domain còn lại tự bị đăng xuất
 const expired=e=>{if(!authed.value)return;clearSession();err.value=(e&&e.detail)||'Phiên đăng nhập đã kết thúc (có thể bạn đã đăng xuất ở domain khác). Vui lòng đăng nhập lại.'};
 addEventListener('coolair:expired',expired);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&authed.value)api('GET','/me').catch(()=>{})});   // quay lại tab -> kiểm tra phiên ngay
 /* Đăng nhập một lần giữa domain chính và domain phụ (xem server/sso.js). Hai hàm trả true khi đang chuyển trang đi nơi khác. */
 const ssoServe=async()=>{   // Domain chính: domain phụ nhờ kiểm tra đăng nhập (?sso_req=<domain phụ>)
  const q=new URLSearchParams(location.search).get('sso_req');if(!q)return false;
  history.replaceState(null,'',location.pathname);
  try{await api('GET','/me').catch(()=>null);   // có cookie phiên -> /me tự làm mới token nếu cần
   const d=await api('POST','/sso/issue',{origin:q});location.replace(d.url);return true}catch(e){return false}};
 const ssoAsk=async()=>{   // Domain phụ, chưa có token: hỏi domain chính
  const m=location.hash.match(/^#sso=([a-f0-9]{64}|none)$/);
  if(m){history.replaceState(null,'',location.pathname+location.search);
   if(m[1]==='none'){sessionStorage.setItem(SSO_NONE,'1');return false}
   try{enter(await api('POST','/sso/exchange',{code:m[1]}))}catch(e){sessionStorage.setItem(SSO_NONE,'1')}return false}
  if(sessionStorage.getItem(SSO_NONE))return false;   // domain chính đã trả lời "chưa đăng nhập" trong tab này
  if(Date.now()-(+sessionStorage.getItem(SSO_TRY)||0)<15000)return false;            // chống lặp vô hạn nếu domain chính không chuyển về
  let i;try{i=await api('GET','/sso/info')}catch(e){return false}
  if(!i.enabled||i.isMain)return false;
  sessionStorage.setItem(SSO_TRY,String(Date.now()));location.replace(i.main+'/?sso_req='+encodeURIComponent(location.origin));return true};
 const boot=async()=>{let go=false;try{
  api('GET','/site-config').then(d=>{siteCfg.name=d.site_name;siteCfg.announcement=d.announcement}).catch(()=>{});
  api('GET','/themes').then(d=>{thAdm.disabled=d.disabled||[];thAdm.def=d.def||''}).catch(()=>{});
  if(go=await ssoServe())return;
  try{const d=await api('GET','/me');enter(d);return}catch(e){if(e.status!==401)return}   // 401 = chưa đăng nhập -> hiện form
  go=await ssoAsk()}finally{if(!go)booting.value=false}};
 const view=ref('home'),tab=ref('nk'),q=ref(''),sf=ref(false),fq=ref(''),draft=ref(''),st=ref(null),cm=ref(null);
 const siteCfg=reactive({name:'CoolAir',announcement:''});
 const F=reactive([]),fr=reactive({incoming:[],sent:[],unread:0}),fsq=ref(''),found=ref([]);
  const loadFr=async()=>{try{const d=await api('GET','/friends');F.splice(0,F.length,...d.friends.map(x=>({id:x.id,n:x.name,a:x.avatar||'',on:onl[x.id]?1:0,u:x.unread,g:x.g||0})));if(d.groups)fx.names=d.groups;fx.hidden=d.hidden||[];fx.visitorNew=d.visitorNew||0;const fk=d.friends.map(x=>x.id).sort().join();if(rt&&frKey&&fk!==frKey)rt.auth.authorize().catch(()=>{});frKey=fk;fr.incoming=d.incoming;fr.sent=d.sent;fr.unread=d.friends.reduce((a,x)=>a+x.unread,0)}catch(e){}};
  const find=async()=>{const v=fsq.value.trim();if(v.length<2){found.value=[];return}try{found.value=await api('GET','/users?q='+encodeURIComponent(v))}catch(e){}};
  let ft;const onFind=()=>{clearTimeout(ft);ft=setTimeout(find,300)};
  const act=async(m,u)=>{try{await api(m,u);await loadFr();await find()}catch(e){alert(e.message)}};
  const pu=reactive({u:null,posts:[],busy:false,err:'',from:'bb',mutual:{count:0,users:[]}});
  const puFeed=computed(()=>group(pu.posts));
  const fmtDate=d=>new Date(d).toLocaleDateString('vi-VN');
  const fmtBirth=b=>b.split('-').reverse().join('/');
  const openUser=async id=>{if(id===uid.value)return go('profile');closeChat();Object.assign(pu,{u:null,posts:[],err:'',busy:true,blocked:false,mutual:{count:0,users:[]}});view.value='user';scrollTo(0,0);try{const [u,l]=await Promise.all([api('GET','/users/'+id),api('GET','/posts?limit=20&author='+id)]);if(view.value!=='user')return;pu.u=u;pu.posts=l.map(map);api('GET','/users/'+id+'/mutual').then(m=>{if(pu.u&&pu.u.id===id)pu.mutual=m}).catch(()=>{});api('GET','/blacklist').then(d=>{if(pu.u&&pu.u.id===id)pu.blocked=d.blacklist.some(b=>b.user.id===id)}).catch(()=>{})}catch(e){pu.err=e.message}finally{pu.busy=false}};
  const backFromUser=()=>{view.value='profile';tab.value='bb';scrollTo(0,0)};
  const userAct=async(m,suffix='',msg)=>{if(msg&&!confirm(msg))return;const id=pu.u.id;try{await api(m,'/friends/'+id+(suffix||''));await loadFr();const u=await api('GET','/users/'+id);pu.u=u}catch(e){alert(e.message)}};
  const blockU=async()=>{if(!confirm('Chặn '+pu.u.name+'? Hai bên sẽ không xem trang và tương tác được với nhau.'))return;try{await api('POST','/blacklist',{user:pu.u.id});pu.blocked=true;alert('Đã chặn.')}catch(e){alert(e.message)}};
  const unblockU=async()=>{try{await api('DELETE','/blacklist/'+pu.u.id);pu.blocked=false;alert('Đã bỏ chặn.')}catch(e){alert(e.message)}};
  const reportU=()=>{const r=prompt('Lý do tố cáo '+pu.u.name+':');if(!r||!r.trim())return;api('POST','/reports',{kind:'user',target:pu.u.id,reason:r.trim().slice(0,300)}).then(()=>alert('Đã gửi tố cáo. Cảm ơn bạn.')).catch(e=>alert(e.message))};
  const reqF=id=>act('POST','/friends/'+id+'/request'),accF=async id=>{try{await api('POST','/friends/'+id+'/accept');await loadFr();openUser(id)}catch(e){alert(e.message)}},delF=(id,msg)=>{if(!msg||confirm(msg))act('DELETE','/friends/'+id)};
  /* Bạn bè nâng cao: nhóm bạn, gợi ý, khách ghé thăm, dấu chân, mã mời */
  const DEFG=['Khác','Bạn bè Online','Sự kiện gặp gỡ','Bạn bè của bạn','Người thân','Đồng nghiệp','Bạn cùng lớp','Người lạ'];
  const fx=reactive({sub:'list',g:-1,names:DEFG.slice(),hidden:[],visitorNew:0,org:false,sel:[],moveTo:0,ren:false,rn:[],msg:'',err:'',
   sug:{fof:[],active:[],busy:false},vs:{items:[],total:0,page:1,per:20,busy:false},tr:{items:[],total:0,page:1,per:20,busy:false},iv:{list:[],max:20,busy:false,err:'',copied:'',email:'',okMsg:''}});
  const fxCount=computed(()=>{const c={};F.forEach(x=>{c[x.g]=(c[x.g]||0)+1});return c});
  const Fshow=computed(()=>fx.g<0?F:F.filter(x=>x.g===fx.g));
  const puG=computed(()=>{const x=pu.u&&F.find(y=>y.id===pu.u.id);return x?x.g:0});
  const sugSecs=computed(()=>[{t:'👥 Bạn của bạn bè',l:fx.sug.fof,e:'Chưa có gợi ý nào — khi bạn bè của bạn có thêm bạn, họ sẽ hiện ở đây.'},{t:'🌟 Thành viên hoạt động gần đây',l:fx.sug.active,e:'Chưa có thành viên nào khác hoạt động gần đây.'}]);
  const fxList=computed(()=>fx.sub==='trace'?fx.tr:fx.vs);
  const fxFail=e=>{fx.err=e.message||'Có lỗi xảy ra.'};
  const loadSug=async()=>{fx.sug.busy=true;try{const d=await api('GET','/friends/suggest');fx.sug.fof=d.fof.map(u=>({...u,sent:false}));fx.sug.active=d.active.map(u=>({...u,sent:false}))}catch(e){fxFail(e)}finally{fx.sug.busy=false}};
  const loadVis=async(kind,pg)=>{const o=kind==='trace'?fx.tr:fx.vs;o.busy=true;try{const d=await api('GET',(kind==='trace'?'/me/trace':'/me/visitors')+'?page='+(pg||1));Object.assign(o,{items:d.items.map(x=>({...x})),total:d.total,page:d.page,per:d.per});if(kind==='visitors'&&d.page===1)fx.visitorNew=0}catch(e){fxFail(e)}finally{o.busy=false}};
  const loadIv=async()=>{fx.iv.busy=true;fx.iv.err='';try{const d=await api('GET','/invites');fx.iv.list=d.invites;fx.iv.max=d.max}catch(e){fx.iv.err=e.message}finally{fx.iv.busy=false}};
  const fxSub=k=>{fx.sub=k;fx.err='';if(k==='find')loadSug();else if(k==='visitors')loadVis('visitors',1);else if(k==='trace')loadVis('trace',1);else if(k==='invite')loadIv()};
  const fxPage=d=>{const o=fxList.value,pg=o.page+d;if(pg<1||pg>Math.ceil(o.total/o.per))return;loadVis(fx.sub,pg)};
  const sugReq=async u=>{try{await api('POST','/friends/'+u.id+'/request');u.sent=true;u.rel&&(u.rel='sent');loadFr()}catch(e){alert(e.message)}};
  const setG=async(ids,g)=>{try{await api('POST','/friends/group',{ids,group:g});await loadFr()}catch(e){alert(e.message)}};
  const fxMove=async()=>{if(!fx.sel.length)return;await setG(fx.sel,fx.moveTo);fx.sel=[]};
  const fxToggle=id=>{const i=fx.sel.indexOf(id);i<0?fx.sel.push(id):fx.sel.splice(i,1)};
  const fxRen=()=>{fx.ren=!fx.ren;fx.msg='';fx.rn=fx.names.slice(1)};
  const fxRenSave=async()=>{try{const d=await api('PUT','/me/friend-groups',{names:fx.rn});fx.names=d.names;fx.ren=false;fx.msg='Đã đổi tên nhóm.'}catch(e){alert(e.message)}};
  const fxHide=async g=>{const h=fx.hidden.includes(g)?fx.hidden.filter(x=>x!==g):[...fx.hidden,g];try{const d=await api('PUT','/me/friend-groups/hidden',{hidden:h});fx.hidden=d.hidden;posts.splice(0);more.all=true;first.value=true;await loadMore('all');first.value=false}catch(e){alert(e.message)}};   // đổi nhóm ẩn -> tải lại bảng tin
  const fxRandom=async()=>{try{const d=await api('GET','/friends/random');openUser(d.id)}catch(e){alert(e.message)}};
  const newIv=async()=>{if(fx.iv.busy)return;fx.iv.busy=true;fx.iv.err='';try{const d=await api('POST','/invites');fx.iv.list.unshift(d.invite)}catch(e){fx.iv.err=e.message}finally{fx.iv.busy=false}};
  const sendIvEmail=async()=>{const em=(fx.iv.email||'').trim();if(!em){fx.iv.err='Hãy nhập email người được mời.';return}if(fx.iv.busy)return;fx.iv.busy=true;fx.iv.err='';fx.iv.okMsg='';try{const d=await api('POST','/invites/email',{email:em});fx.iv.list.unshift(d.invite);fx.iv.email='';fx.iv.okMsg='Đã gửi lời mời tới '+em+'.'}catch(e){fx.iv.err=e.message}finally{fx.iv.busy=false}};
  const delIv=async i=>{if(!confirm('Xóa mã mời này?'))return;try{await api('DELETE','/invites/'+i.id);fx.iv.list=fx.iv.list.filter(x=>x.id!==i.id)}catch(e){fx.iv.err=e.message}};
  const ivLink=i=>location.origin+'/?invite='+i.code;
  const copyIv=async i=>{const l=ivLink(i);try{await navigator.clipboard.writeText(l);fx.iv.copied=i.id;setTimeout(()=>{if(fx.iv.copied===i.id)fx.iv.copied=''},2000)}catch(e){prompt('Sao chép liên kết mời:',l)}};
  setInterval(()=>{if(authed.value&&acct.verified&&!document.hidden)loadFr()},15000);
 const posts=reactive([]);
 const mine=computed(()=>posts.filter(p=>p.mine));
  const PG=20,more=reactive({all:true,mine:true}),busyM=ref(false),first=ref(true);
  const feed=computed(()=>group(posts)),mineFeed=computed(()=>group(mine.value));
  const merge=l=>{l.map(map).forEach(n=>{const o=posts.find(p=>p.id===n.id);o?Object.assign(o,n):posts.push(n)});posts.sort((a,b)=>new Date(b.d)-new Date(a.d))};
  const loadMore=async k=>{if(busyM.value)return;busyM.value=true;try{const s=k==='mine'?mine.value:posts,b=s.length?s[s.length-1].d:'';const l=await api('GET','/posts?limit='+PG+(k==='mine'?'&mine=1':'')+(b?'&before='+encodeURIComponent(b):''));more[k]=l.length>=PG;merge(l)}catch(e){alert(e.message)}finally{busyM.value=false}};
  const del=async p=>{if(!confirm('Xóa bài viết này? Hành động không thể hoàn tác.'))return;try{await api('DELETE','/posts/'+p.id);const i=posts.findIndex(x=>x.id===p.id);if(i>=0)posts.splice(i,1)}catch(e){alert(e.message)}};
 const online=computed(()=>F.filter(f=>f.n.toLowerCase().includes(fq.value.toLowerCase())));
 const sug=computed(()=>F.filter(f=>f.n.toLowerCase().includes(q.value.trim().toLowerCase())).slice(0,6));

  /* ===== Giao diện kiểu Instagram (mobile) ===== */
  const IGI={phone:'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z',video:'M15 8.5V7a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-1.5l6 3.5V5z',back:'M15 5l-7 7 7 7',plus:'M12 5v14M5 12h14',chev:'M6 9l6 6 6-6',menu:'M3 6h18M3 12h18M3 18h18',x:'M6 6l12 12M18 6L6 18',bell:'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',at:'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.6 7.2',userplus:'M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19 8v6M16 11h6',grid:'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',image:'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM3 16l5-5 4 4 3-3 6 6M9 9.5h.01',people:'M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM20 20v-1.5a3.5 3.5 0 0 0-2.5-3.4M15.5 4.2a3.5 3.5 0 0 1 0 6.6',home:'M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6.5H9V21H4a1 1 0 0 1-1-1z',groups:'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM10 8.5v7l6-3.5z',msg:'M22 3L2 10.2l7.5 3.3L12.8 21zM22 3L9.5 13.5',find:'M11 3a8 8 0 1 1 0 16 8 8 0 0 1 0-16zM21 21l-4.3-4.3'};
  const igHide=reactive([]),cmpOpen=ref(false);
  const igSugs=computed(()=>[...fx.sug.fof,...fx.sug.active].filter((u,i,a)=>!igHide.includes(u.id)&&a.findIndex(y=>y.id===u.id)===i).slice(0,12));
  const igFind=()=>{mm.value=false;go('profile');tab.value='bb';fxSub('find')};
  const igStats=computed(()=>[
   {n:mine.value.length+(more.mine&&mine.value.length?'+':''),l:'bài viết',go:()=>{tab.value='nk'}},
   {n:F.length,l:'bạn bè',go:()=>{tab.value='bb';fxSub('list')}},
   {n:fr.incoming.length,l:'lời mời',go:()=>{tab.value='bb';fxSub('list')}}]);
  const igTabs=[{t:'nk',i:'grid',l:'Bài viết'},{t:'al',i:'image',l:'Album'},{t:'bb',i:'people',l:'Bạn bè'}];
  const igNav=computed(()=>{const v=view.value,t=tab.value,bb=v==='profile'&&t==='bb',fd=bb&&fx.sub==='find';return[
   {k:'home',l:'Trang chủ',on:v==='home'},
   {k:'groups',l:'Nhóm',on:v==='groups',b:gr.invN},
   {k:'msg',l:'Tin nhắn',on:bb&&!fd,b:fr.unread},
   {k:'find',l:'Tìm bạn',on:fd},
   {k:'me',l:'Trang cá nhân',on:v==='profile'&&!bb}]});
  const igGo=k=>{mm.value=false;closeChat();if(k==='home')go('home');else if(k==='groups')gGo();else if(k==='msg'){go('profile');tab.value='bb';fxSub('list')}else if(k==='find')igFind();else{go('profile');tab.value='nk'}};
  const shareProfile=async()=>{const d={title:me.value+' trên CoolAir',text:'Kết bạn với '+me.value+' trên CoolAir',url:location.origin};try{if(navigator.share)await navigator.share(d);else{await navigator.clipboard.writeText(d.url);alert('Đã sao chép liên kết.')}}catch(e){}};
 const tagV=reactive({tag:'',list:[],total:0,pg:1,busy:false,err:''});
 const openTag=t=>{tagV.tag=t;tagV.pg=1;tagV.list=[];tagLoad(1);go('tag')};
 const tagLoad=p=>{tagV.busy=true;tagV.err='';return api('GET','/tags/'+encodeURIComponent(tagV.tag)+'?page='+(p||1)).then(d=>{tagV.list=p>1?tagV.list.concat(d.blogs):d.blogs;tagV.total=d.total;tagV.pg=d.page}).catch(e=>tagV.err=e.message).finally(()=>tagV.busy=false)};
 const toTop=()=>window.scrollTo(0,0);   // liên kết TOP ở chân trang (template Vue không gọi được scrollTo toàn cục)
 const go=v=>{if(v){view.value=acct.verified?v:'settings';if(view.value==='profile'&&/^s/.test(tab.value))tab.value='nk';if(view.value==='profile'&&matchMedia('(max-width:767px)').matches&&!fx.sug.busy&&!fx.sug.fof.length&&!fx.sug.active.length)loadSug();scrollTo(0,0)}};
 const vis=ref('public'),att=reactive({ph:[],up:0,vid:null,vp:null,err:'',loc:null});   // ảnh / video đính kèm bài đang soạn
 const info=computed(()=>[acct.birthday&&'🎂 Sinh nhật: '+fmtBirth(acct.birthday),acct.location&&'📍 Sống tại '+acct.location,acct.bio&&'💬 “'+acct.bio+'”',...pf.list.filter(f=>acct.extra[f.id]).map(f=>f.title+': '+acct.extra[f.id]+(f.invisible?' (ẩn)':'')),'📅 Tham gia '+fmtDate(acct.joined)].filter(Boolean));
 /* Tên check-in chi tiết: đường, ấp/khu phố, xã/phường, huyện/quận, tỉnh/thành (nhỏ -> lớn). Tối đa 100 ký tự (giới hạn server): dài quá thì bỏ dần phần nhỏ nhất. */
 const geoName=(j,lat,lng)=>{const a=(j&&j.address)||{},seen=new Set();let l=[a.road,a.hamlet,a.quarter||a.neighbourhood,a.village||a.suburb,a.town||a.city_district||a.municipality,a.county||a.district,a.city,a.state].filter(x=>{const k=String(x||'').trim().toLowerCase();if(!k||seen.has(k))return false;seen.add(k);return true});
  if(!l.length&&j&&j.display_name)l=j.display_name.split(',').slice(0,3).map(x=>x.trim());
  while(l.length>1&&l.join(', ').length>100)l.shift();
  return l.length?l.join(', ').slice(0,100):('Vị trí '+lat.toFixed(4)+', '+lng.toFixed(4))};
 /* Check-in GPS: lấy tọa độ thật từ thiết bị, reverse-geocode qua Nominatim (OSM, miễn phí, không cần key) */
 const checkIn=()=>{if(!navigator.geolocation)return alert('Thiết bị không hỗ trợ GPS.');att.loc={busy:true};navigator.geolocation.getCurrentPosition(async(pos)=>{const{latitude:lat,longitude:lng}=pos.coords;try{const r=await fetch('https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&addressdetails=1&lat='+lat+'&lon='+lng+'&accept-language=vi',{headers:{'Accept':'application/json'}});const j=await r.json();const name=geoName(j,lat,lng);att.loc={name:String(name).slice(0,100),lat:+lat.toFixed(6),lng:+lng.toFixed(6)}}catch(e){att.loc={name:'Vị trí '+lat.toFixed(4)+', '+lng.toFixed(4),lat:+lat.toFixed(6),lng:+lng.toFixed(6)}}},()=>{att.loc=null;alert('Không lấy được vị trí. Hãy bật GPS và cho phép trình duyệt truy cập vị trí.')},{enableHighAccuracy:true,timeout:15000})};
 const pub=async()=>{const v=draft.value.trim();if(att.up||att.vp!==null)return alert('Đang tải tệp lên, vui lòng đợi tải xong rồi đăng.');if(!v&&!att.ph.length&&!att.vid)return st.value&&st.value.focus();try{posts.unshift(map(await api('POST','/posts',{text:v,visibility:vis.value,photos:att.ph.length?[...att.ph]:undefined,video:att.vid?{kind:att.vid.kind,url:att.vid.url}:undefined,location:att.loc&&att.loc.name?{name:att.loc.name,lat:att.loc.lat,lng:att.loc.lng}:undefined})));draft.value='';att.ph=[];att.vid=null;att.err='';att.loc=null}catch(e){alert(e.message)}};
 const emoPick=e=>{const ta=st.value,s=ta?ta.selectionStart??draft.value.length:draft.value.length;draft.value=draft.value.slice(0,s)+e+draft.value.slice(s);cmpOpen.value=true;nextTick(()=>{if(ta){ta.focus();const p=s+[...e].length;try{ta.setSelectionRange(p,p)}catch(_){}}})};
 /* chat */
 /* realtime (Ably): nhận tin ngay, "đang gõ", trạng thái online. Mất kết nối / chưa cấu hình thì tự quay về hỏi lại định kỳ */
 const onl=reactive({}),rtOn=ref(false),rtErr=ref('');let rt=null,frKey='',pch=null;
 const syncOn=l=>{Object.keys(onl).forEach(k=>delete onl[k]);l.forEach(m=>{if(m.clientId!==uid.value)onl[m.clientId]=1});F.forEach(f=>f.on=onl[f.id]?1:0)};
 const stopRt=()=>{if(rt){try{rt.close()}catch(e){}}rt=null;pch=null;frKey='';rtOn.value=false;rtErr.value='';Object.keys(onl).forEach(k=>delete onl[k])};
 const startRt=async()=>{
  if(rt)return;let first,Ably;
 try{const m=await import('ably');Ably=m.Realtime?m:m.default}catch(e){rtErr.value='không tải được thư viện realtime';return}   // chunk riêng của Vite (ghim theo package-lock), chỉ tải khi đăng nhập; lỗi -> dùng polling
  try{first=await api('GET','/realtime/token')}catch(e){rtErr.value=e.status===503?'server chưa có ABLY_API_KEY (hoặc chưa deploy lại)':(e.message||'lỗi token');return}      // 503 = server chưa bật Ably -> dùng polling
  if(rt||!authed.value)return;
  const c=rt=new Ably.Realtime({authCallback:(p,cb)=>{if(first){const t=first;first=null;return cb(null,t)}api('GET','/realtime/token').then(t=>cb(null,t),e=>cb(e.message||'auth'))}});
  c.connection.on(st=>{const was=rtOn.value;rtOn.value=st.current==='connected';rtErr.value=rtOn.value?'':(st.reason&&st.reason.message)||(st.current==='connecting'?'':st.current);if(rtOn.value&&!was){chat.id&&pull();loadFr();loadPokes();ntCount()}});
  const ib=c.channels.get('inbox:'+uid.value);ib.subscribe('msg',m=>{const d=m.data||{};if(chat.id&&d.from===chat.id)pull();else loadFr()});ib.subscribe('sig',onSig);ib.subscribe('poke',()=>loadPokes());ib.subscribe('notif',()=>{ntCount();if(view.value==='notifications')ntPage(1,true)});
  pch=c.channels.get('presence:all');
  const refresh=()=>pch&&pch.presence.get().then(syncOn).catch(()=>{});
  pch.presence.subscribe(refresh);pch.presence.enter().then(refresh).catch(()=>{});
 };
 const chat=reactive({id:'',name:'',msgs:[],txt:'',last:'',typing:false,on:false});let ct,cch=null,tyT,tyAt=0,n4=0;
  const scrollChat=()=>nextTick(()=>{if(cm.value)cm.value.scrollTop=1e5});
  const add=(l,own)=>{if(!own&&l.length)chat.last=l[l.length-1].id;const n=l.filter(m=>!chat.msgs.some(x=>x[2]===m.id));if(!n.length)return false;chat.msgs.push(...n.map(m=>[m.mine?'me':'them',m.text,m.id]));if(n.some(m=>!m.mine)){chat.typing=false;clearTimeout(tyT)}scrollChat();return n.some(m=>!m.mine)};
  const pull=async()=>{const id=chat.id;if(!id)return;try{const l=await api('GET','/messages/'+id+(chat.last?'?after='+chat.last:''));if(chat.id===id&&add(l))loadFr()}catch(e){}};
  const leaveCh=()=>{if(cch){try{cch.unsubscribe();cch.detach()}catch(e){}}cch=null;chat.typing=false;clearTimeout(tyT)};
  const closeChat=()=>{leaveCh();chat.id=chat.name='';clearInterval(ct)};
  const openChat=f=>{
   clearInterval(ct);leaveCh();Object.assign(chat,{id:f.id,name:f.n,msgs:[],txt:'',last:'',typing:false});pull().then(loadFr);
   if(rt){cch=rt.channels.get('chat:'+[uid.value,f.id].sort().join('_'));cch.subscribe('typing',m=>{if(m.data&&m.data.from===f.id&&chat.id===f.id){chat.typing=true;clearTimeout(tyT);tyT=setTimeout(()=>chat.typing=false,3000);scrollChat()}}).catch(()=>{})}
   n4=0;ct=setInterval(()=>{if(!document.hidden&&(!rtOn.value||++n4%8===0))pull()},4000)};   // có realtime: chỉ hỏi lại ~30 giây/lần để dự phòng
  const typing=()=>{if(!cch||!rtOn.value||Date.now()-tyAt<2000)return;tyAt=Date.now();cch.publish('typing',{from:uid.value}).catch(()=>{})};
  const sendChat=async()=>{const v=chat.txt.trim(),id=chat.id;if(!v||!id)return;chat.txt='';try{add([await api('POST','/messages/'+id,{text:v})],1)}catch(e){chat.txt=v;alert(e.message)}};
 /* gọi thoại: WebRTC, báo hiệu qua server -> Ably ('sig'), TURN Cloudflare lấy từ /realtime/ice */
 const call=reactive({st:'idle',id:'',name:'',muted:false,secs:0,err:'',video:false,cam:true,front:true});
 let pc=null,ls=null,rs=null,qIce=[],ringT,secT,ring=null,ra=null,ice=null,ac=null;
 const rv=ref(null),lv=ref(null);
 const attach=()=>nextTick(()=>{if(lv.value&&lv.value.srcObject!==ls)lv.value.srcObject=ls;if(rv.value&&rs&&rv.value.srcObject!==rs){rv.value.srcObject=rs;rv.value.play().catch(()=>{})}});
 const fmtSecs=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
 const sigTo=(id,type,data)=>api('POST','/call/'+id+'/signal',{type,data}).catch(()=>{});
 const ringTone=on=>{clearInterval(ring);ring=null;if(!on)return;const b=()=>{try{const a=ac||(ac=new AudioContext()),o=a.createOscillator(),g=a.createGain();o.frequency.value=440;g.gain.value=.08;o.connect(g);g.connect(a.destination);o.start();o.stop(a.currentTime+.4)}catch(e){}};b();ring=setInterval(b,2000)};
 const endLocal=err=>{clearTimeout(ringT);clearInterval(secT);ringTone(0);if(pc){try{pc.close()}catch(e){}}pc=null;if(ls)ls.getTracks().forEach(t=>t.stop());ls=null;if(ra){ra.srcObject=null;ra=null}rs=null;qIce=[];ice=null;Object.assign(call,{st:'idle',id:'',name:'',muted:false,secs:0,err:err||'',video:false,cam:true,front:true});if(err)setTimeout(()=>{if(call.st==='idle')call.err=''},6000)};
 const endCall=()=>{const id=call.id;if(id&&call.st!=='idle')sigTo(id,'end');endLocal()};
 const failCall=()=>{const id=call.id;if(id)sigTo(id,'end');endLocal('Không kết nối được cuộc gọi. Hãy thử đổi mạng (wifi / 4G) rồi gọi lại.')};
 const mic=async()=>{try{ls=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:call.video?{width:{ideal:640},height:{ideal:480},frameRate:{ideal:24},facingMode:'user'}:false});return true}catch(e){endLocal(call.video?'Không dùng được camera/micro. Hãy cho phép quyền camera và micro cho trang này.':'Không dùng được micro. Hãy cho phép quyền micro cho trang này.');return false}};
 const capBr=()=>{try{pc.getSenders().forEach(x=>{if(x.track&&x.track.kind==='video'){const q=x.getParameters();if(!q.encodings||!q.encodings.length)q.encodings=[{}];q.encodings[0].maxBitrate=8e5;x.setParameters(q).catch(()=>{})}})}catch(e){}};   // giới hạn ~0,8 Mbps cho đỡ giật và đỡ tốn dữ liệu
 const makePc=async()=>{
  if(!ice){try{ice=(await api('GET','/realtime/ice')).iceServers}catch(e){ice=[{urls:'stun:stun.l.google.com:19302'}]}}
  const p=pc=new RTCPeerConnection({iceServers:ice}),id=call.id;
  ls.getTracks().forEach(t=>p.addTrack(t,ls));
  p.onicecandidate=e=>{if(e.candidate)sigTo(id,'ice',e.candidate.toJSON())};
  p.ontrack=e=>{if(call.video){rs=e.streams[0];attach()}else{if(!ra){ra=new Audio();ra.autoplay=true}ra.srcObject=e.streams[0];ra.play().catch(()=>{})}};
  p.onconnectionstatechange=()=>{if(pc!==p)return;const s=p.connectionState;if(s==='connected'&&call.st!=='live'){clearTimeout(ringT);call.st='live';call.secs=0;secT=setInterval(()=>call.secs++,1000)}else if(s==='failed')failCall();else if(s==='disconnected'){setTimeout(()=>{if(pc===p&&p.connectionState!=='connected'&&call.st!=='idle')endLocal('Cuộc gọi bị ngắt kết nối.')},6000)}};
  clearTimeout(ringT);ringT=setTimeout(()=>{if(call.st==='connecting')failCall()},25000);
 };
 const addIce=async c=>{if(pc&&pc.remoteDescription){try{await pc.addIceCandidate(c)}catch(e){}}else qIce.push(c)};
 const flushIce=async()=>{for(const c of qIce.splice(0)){try{await pc.addIceCandidate(c)}catch(e){}}};
 const onSig=async m=>{
  const d=m.data||{},t=d.type,from=d.from;if(!from)return;
  try{
   if(t==='invite'){
    if(call.st!=='idle'){sigTo(from,'reject',{busy:1});return}
    Object.assign(call,{st:'ringing',id:from,name:d.name||'Bạn bè',err:'',muted:false,video:!!(d.data&&d.data.video),cam:true,front:true});ringTone(1);if(navigator.vibrate)navigator.vibrate([300,200,300]);
    ringT=setTimeout(()=>{if(call.st==='ringing'){sigTo(from,'end');endLocal()}},45000);return}
   if(from!==call.id||call.st==='idle')return;
   if(t==='accept'&&call.st==='calling'){ringTone(0);call.st='connecting';await makePc();const o=await pc.createOffer();await pc.setLocalDescription(o);capBr();sigTo(from,'offer',pc.localDescription.toJSON())}
   else if(t==='offer'&&pc){await pc.setRemoteDescription(d.data);await flushIce();const a=await pc.createAnswer();await pc.setLocalDescription(a);capBr();sigTo(from,'answer',pc.localDescription.toJSON())}
   else if(t==='answer'&&pc){await pc.setRemoteDescription(d.data);await flushIce()}
   else if(t==='ice'&&d.data)addIce(d.data);
   else if(t==='reject')endLocal(d.data&&d.data.busy?call.name+' đang bận.':call.name+' đã từ chối cuộc gọi.');
   else if(t==='end')endLocal(call.st==='ringing'?'Cuộc gọi nhỡ từ '+call.name+'.':call.st==='live'?'':'Cuộc gọi đã kết thúc.');
  }catch(e){failCall()}
 };
 const tryCall=(video)=>{
  if(!rtOn.value)return alert('Chưa kết nối realtime'+(rtErr.value?': '+rtErr.value:'')+'. Kiểm tra ABLY_API_KEY trên Vercel (đúng môi trường Production/Preview) rồi deploy lại.');
  if(!onl[chat.id])return alert(chat.name+' chưa online nên chưa gọi được. Hãy nhờ bạn ấy mở CoolAir.');
  startCall({id:chat.id,n:chat.name},video)};
 const startCall=async(f,video)=>{
  if(call.st!=='idle'||!rt||!rtOn.value||!window.RTCPeerConnection)return;
  Object.assign(call,{st:'calling',id:f.id,name:f.n,err:'',muted:false,video:!!video,cam:true,front:true});
  if(!await mic())return;
  attach();ringTone(1);sigTo(f.id,'invite',{video:!!video});
  ringT=setTimeout(()=>{if(call.st==='calling'){sigTo(f.id,'end');endLocal(f.n+' không trả lời.')}},45000);
 };
 const answerCall=async()=>{
  if(call.st!=='ringing')return;const id=call.id;clearTimeout(ringT);ringTone(0);
  if(!await mic()){sigTo(id,'reject');return}
  call.st='connecting';attach();await makePc();sigTo(id,'accept');
 };
 const rejectCall=()=>{const id=call.id;sigTo(id,'reject');endLocal()};
 /* tải lại trang (F5) khi đang gọi: WebRTC không giữ được qua lần tải lại -> báo bên kia ngay (khỏi treo), rồi gợi ý gọi lại */
 const rc=ref(null),RCK='coolair_recall';
 const bye=()=>{if(call.st==='idle'||!call.id)return;try{sessionStorage.setItem(RCK,JSON.stringify({id:call.id,n:call.name,v:call.video,t:Date.now()}));fetch('/api/call/'+call.id+'/signal',{method:'POST',keepalive:true,credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'end'})}).catch(()=>{})}catch(e){}};
 addEventListener('pagehide',bye);
 addEventListener('beforeunload',e=>{if(call.st==='live'||call.st==='connecting'||call.st==='calling'){e.preventDefault();e.returnValue=''}});
 try{const o=JSON.parse(sessionStorage.getItem(RCK)||'null');sessionStorage.removeItem(RCK);if(o&&o.id&&Date.now()-o.t<180000)rc.value=o}catch(e){}
 const redial=()=>{const o=rc.value;rc.value=null;if(o)startCall({id:o.id,n:o.n},!!o.v)};
 const dismissRc=()=>{rc.value=null};
 const toggleCam=()=>{call.cam=!call.cam;if(ls)ls.getVideoTracks().forEach(t=>t.enabled=call.cam)};
 const flipCam=async()=>{
  if(!ls||!call.video)return;const want=call.front?'environment':'user';
  try{
   const ns=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:480},frameRate:{ideal:24},facingMode:{ideal:want}}}),nt=ns.getVideoTracks()[0],old=ls.getVideoTracks()[0];
   nt.enabled=call.cam;const sd=pc&&pc.getSenders().find(x=>x.track&&x.track.kind==='video');if(sd)await sd.replaceTrack(nt);
   if(old){ls.removeTrack(old);old.stop()}ls.addTrack(nt);call.front=!call.front;if(lv.value)lv.value.srcObject=ls;
  }catch(e){}
 };
 const toggleMute=()=>{call.muted=!call.muted;if(ls)ls.getAudioTracks().forEach(t=>t.enabled=!call.muted)};
 /* lưu bút */
 const gb=ref([]),gift=ref('🎁'),gbTxt=ref('');
 const sendGb=async()=>{const v=gbTxt.value.trim();if(!v)return;try{const g=await api('POST','/guestbook/'+uid.value,{text:v,gift:gift.value});gb.value.unshift([g.name,g.gift,g.text,g.av||'']);gbTxt.value=''}catch(e){alert(e.message)}};
 /* giao diện trang cá nhân (theme) – port từ UCenter Home (cp_theme.php). Màu/ảnh của theme có sẵn nằm ở đây, server chỉ lưu mã. */
 const TH=[
  {id:'t3',n:'Thanh hương nhẹ',bg:'#E6EBE3',img:'t3/body_bg.gif',zb:'#2C629E',zb2:'#2C629E',zg:'#6B9A5B',tb:'#CED4CA'},
  {id:'t4',n:'Nhà nhỏ Phi Phi',bg:'#C9B79F',img:'t4/body_bg.gif',zb:'#5D422E',zb2:'#B5532A',zg:'#8A6A4F',tb:'#5D422E'},
  {id:'t5',n:'Hương hoa nhẹ',bg:'#EFD5B2',img:'t5/body_bg.gif',cv:'t5/header.gif',cvs:'center/cover',zb:'#C9484F',zb2:'#F05961',zg:'#E0A458',tb:'#EFD5B2'},
  {id:'t10',n:'Nhà nhỏ',bg:'#3A434C',img:'t10/body_bg.gif',zb:'#333A44',zb2:'#2C629E',zg:'#E8590C',tb:'#333333'},
  {id:'t11',n:'Công nghệ',bg:'#5778A1',cv:'t11/header.gif',zb:'#3F5F88',zb2:'#2C629E',zg:'#5FA8D3',tb:'#94B5DE'},
  {id:'t12',n:'Tết Trung Hoa',bg:'#F5E1A8',img:'t12/body_bg.gif',cv:'t12/header.gif',zb:'#900000',zb2:'#B00000',zg:'#D4A017',tb:'#EDC18A'},
  {id:'t13',n:'Mèo con',bg:'#6A8FA1',cv:'t13/header.gif',zb:'#4F7284',zb2:'#5778A1',zg:'#7FB7A4',tb:'#9DB7C1'},
  {id:'t14',n:'Trung Hoa đỏ',bg:'#6B0000',img:'t14/body_bg.gif',zb:'#7A0000',zb2:'#B01010',zg:'#D4A800',tb:'#333333'}];
 const thAdm=reactive({disabled:[],def:'',busy:false});
 const THL=computed(()=>[{id:'',n:'Mặc định'},...TH.filter(t=>!thAdm.disabled.includes(t.id)),{id:'custom',n:'Tự chọn màu'}]);
 const th=reactive({sel:'',bg:'#f4f0e6',accent:'#0066cc',no:false,dirty:false,busy:false,msg:'',err:''});
 const syncTh=u=>{if(th.dirty||!u.theme)return;Object.assign(th,{sel:u.theme.id,bg:u.theme.bg||th.bg,accent:u.theme.accent||th.accent,no:!!u.noTheme})};
 const hx=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)),lum=h=>{const[r,g,b]=hx(h);return(.299*r+.587*g+.114*b)/255};
 const shade=(h,k)=>'#'+hx(h).map(v=>Math.round(v*(1-k)).toString(16).padStart(2,'0')).join('');
 const resolve=o=>{
  if(!o||!o.id)return null;
  if(o.id==='custom'){if(!/^#[0-9a-f]{6}$/i.test(o.bg)||!/^#[0-9a-f]{6}$/i.test(o.accent))return null;const a=lum(o.accent)>.62?shade(o.accent,.4):o.accent;return{bg:o.bg,zb:shade(a,.25),zb2:a,zg:a,tb:shade(o.bg,.15)}}
  return TH.find(t=>t.id===o.id)||null};
 const pal=computed(()=>{
  if(!authed.value)return null;const v=view.value;
  if(v==='user')return pu.u&&!acct.noTheme?resolve(pu.u.theme):null;      // trang người khác: dùng giao diện của họ, trừ khi mình tắt
  if(v==='profile')return resolve(acct.theme);
  if(v==='settings')return resolve({id:th.sel,bg:th.bg,accent:th.accent});   // xem thử khi đang chọn
  return null});
 const themed=computed(()=>!!pal.value);
 const layers=(p,cover)=>[p.cv&&'url(/img/theme/'+p.cv+') '+(p.cvs||'left bottom/auto 100%')+' no-repeat',p.img&&'url(/img/theme/'+p.img+')',p.bg].filter(Boolean).join(',');
 const cover=computed(()=>{if(acct.cover&&!cv.imgErr)return{backgroundImage:'url('+JSON.stringify(acct.cover).slice(1,-1)+')'};const p=pal.value;if(!p)return{};return{background:p.cv?layers(p):'linear-gradient(135deg,'+p.zb+','+p.zb2+' 60%,'+p.zg+')'}});
 const swStyle=t=>t.id===''?{background:'var(--bg)'}:t.id==='custom'?{background:'linear-gradient(135deg,'+th.accent+' 0 45%,'+th.bg+' 45%)'}:{background:layers(t)};
 const puCover=computed(()=>{const u=pu.u;if(!u)return{};if(u.cover)return{backgroundImage:'url('+JSON.stringify(u.cover).slice(1,-1)+')'};return{background:'linear-gradient(135deg,#1d4ed8,#6d28d9 55%,#be185d)'}});
 /* :class đặt trên chính #app (container) không được Vue biên dịch -> gắn class bằng tay: neo = đã đăng nhập (giao diện NEO) */
 Vue.watchEffect(()=>{const a=document.getElementById('app');if(a){a.classList.toggle('neo',!!authed.value);a.classList.toggle('thm',!!themed.value)}});
 Vue.watchEffect(()=>{const p=pal.value,r=document.documentElement.style,b=document.body.style;
  ['--zb','--zb2','--zg','--tb'].forEach(k=>r.removeProperty(k));b.backgroundColor=b.backgroundImage='';
  if(!p)return;r.setProperty('--zb',p.zb);r.setProperty('--zb2',p.zb2);r.setProperty('--zg',p.zg);r.setProperty('--tb',p.tb);
  b.backgroundColor=p.bg;if(p.img)b.backgroundImage='url(/img/theme/'+p.img+')'});
 const openTheme=()=>{go('settings');tab.value='sth'};
  const menu=computed(()=>[...(acct.admin?[['Quản trị','admin','','setting']]:[]),['Thông báo','notifications','','event'],['Nhóm','groups','','mtag'],['Sự kiện','events','','event'],['Bình chọn','polls','','poll'],['Trạng thái','doings','','doing'],['Khám phá','discover','','topic'],['Bản đồ check-in','map','','topic'],['Chủ đề','topics','','mtag'],['Nhiệm vụ','tasks','','poll'],['Đạo cụ','magic','','gift'],['Diễn đàn','forum','','discuz'],['Âm nhạc','music','','default'],['Video','videos','','supev'],['Trắc nghiệm','quizzes','','poll'],['Trang','pages','','mtag'],['Quà tặng','gifts','','default'],['Hộp thư','mail','','default'],['Bản tin','bulletins','','thread'],['Liên kết','links','','share'],['Yêu thích','fav','','topic'],['Trợ giúp','help','','setting'],['Tìm kiếm','search','','topic'],['Bài viết','profile','nk','blog'],['Nhật ký','profile','bl','blog'],['Bạn bè & lời mời','profile','bb','share'],['Chọc','profile','ch','event'],['Lưu bút','profile','lb','thread'],['Cài đặt','settings','','setting']]);
  // ----- Mobile (phpFox mobile theme) -----
  const mm=ref(false);
  // ----- Sự kiện / Bình chọn / Tìm kiếm -----
  const sq=ref(''),sN=ref(0),evNav=reactive({id:'',n:0}),poNav=reactive({id:'',n:0}),foNav=reactive({id:'',n:0}),vdNav=reactive({id:'',n:0}),qzNav=reactive({id:'',n:0}),pgNav=reactive({id:'',n:0});
  const favNav=t=>{if(t.view==='forum'){foNav.id=t.thread||'';foNav.n++;go('forum')}else if(t.view==='videos'){vdNav.id=t.video||'';vdNav.n++;go('videos')}else if(t.view==='quizzes'){qzNav.id=t.quiz||'';qzNav.n++;go('quizzes')}else if(t.view==='pages'){pgNav.id=t.page||'';pgNav.n++;go('pages')}else{go(t.view);if(t.tab)tab.value=t.tab}};
  const sGo=t=>{t=(t||'').trim();if(t.length<2)return;sq.value=t;sN.value++;go('search')};
  const sPick=p=>{if(p.t==='user')openUser(p.id);else if(p.t==='event'){evNav.id=p.id;evNav.n++;go('events')}else if(p.t==='poll'){poNav.id=p.id;poNav.n++;go('polls')}else if(p.t==='group')gOpen(p.id);else if(p.t==='thread')gOpenThread(p.id);else if(p.t==='forum_thread'){foNav.id=p.id;foNav.n++;go('forum')}else if(p.t==='video'){vdNav.id=p.id;vdNav.n++;go('videos')}else if(p.t==='quiz'){qzNav.id=p.id;qzNav.n++;go('quizzes')}else if(p.t==='page'){pgNav.id=p.id;pgNav.n++;go('pages')}else if(p.t==='song')go('music')};
  watch([view,tab],()=>{mm.value=false;if(chat.id)closeChat()});
  watch(mm,v=>{document.documentElement.style.overflow=v?'hidden':''});
  const MME={'events:':'📅','polls:':'📊','search:':'🔎','admin:':'🛡️','notifications:':'🔔','groups:':'👥','profile:nk':'📝','profile:bb':'🤝','profile:ch':'👋','profile:lb':'📖','settings:':'⚙️','forum:':'💬','music:':'🎵','videos:':'🎬','quizzes:':'❓','pages:':'📄','gifts:':'🎁','mail:':'✉️','bulletins:':'📰','links:':'🔗','fav:':'⭐','help:':'❓'};
  const mmItems=computed(()=>[{k:'home',l:'Trang chủ',e:'🏠',v:'home',t:'',n:0},...menu.value.map(m=>{const k=m[1]+':'+m[2];return{k,l:m[0],e:MME[k]||'📌',v:m[1],t:m[2],n:k==='notifications:'?nt.unseen:k==='groups:'?gr.invN:k==='profile:bb'?fr.incoming.length:k==='profile:ch'?pk.list.length:0}}),{k:'theme',l:'Giao diện',e:'🎨',v:'theme',t:'',n:0},{k:'out',l:'Thoát',e:'🚪',v:'out',t:'',n:0}]);
  const mmGo=m=>{mm.value=false;closeChat();if(m.v==='groups')gGo();else if(m.v==='theme')openTheme();else if(m.v==='out')logout();else{go(m.v);if(m.t)tab.value=m.t}};
  const mBack=()=>{mm.value=false;if(view.value==='user')backFromUser();else if(view.value==='groups'&&gr.page!=='list')gGo();else go('home')};
  const mTitle=computed(()=>view.value==='user'&&pu.u?pu.u.name:({home:'CoolAir',profile:'Trang cá nhân',notifications:'Thông báo',groups:'Nhóm',events:'Sự kiện',polls:'Bình chọn',search:'Tìm kiếm',settings:'Cài đặt',admin:'Quản trị',forum:'Diễn đàn',music:'Âm nhạc',videos:'Video',quizzes:'Trắc nghiệm',pages:'Trang',gifts:'Quà tặng',mail:'Hộp thư',bulletins:'Bản tin',links:'Liên kết',fav:'Yêu thích',help:'Trợ giúp'}[view.value]||'CoolAir'));
 /* màu chủ đề toàn ứng dụng (kiểu Muse): chỉ lưu trên thiết bị, không đụng tới giao diện trang cá nhân */
 const ACS=[{n:'Xanh dương',c:'#3a6fd8'},{n:'Xanh ngọc',c:'#14b8a6'},{n:'Xanh trời',c:'#4a9be0'},{n:'Tím oải hương',c:'#8b78e0'},{n:'Hồng',c:'#e0709f'},{n:'Cam đào',c:'#e8895a'},{n:'Xanh lá',c:'#4fa876'},{n:'Xám',c:'#6b6f76'},{n:'Đen',c:'#1c1c1e'}];
 /* chế độ sáng / tối / tự động (theo hệ thống) */
 const MODES=[['auto','Tự động','🌓'],['light','Sáng','☀️'],['dark','Tối','🌙']],MK='coolair_mode';
 const dmode=ref((()=>{try{const v=localStorage.getItem(MK);return v==='light'||v==='dark'?v:'auto'}catch(e){return 'auto'}})());
 const setMode=m=>{dmode.value=m;try{m==='auto'?localStorage.removeItem(MK):localStorage.setItem(MK,m)}catch(e){}
  if(m==='auto')delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=m};
 const ACK='coolair_accent',acc=ref((()=>{try{const v=localStorage.getItem(ACK);return ACS.some(x=>x.c===v)?v:''}catch(e){return ''}})());
 const setAcc=c=>{acc.value=c;try{localStorage.setItem(ACK,c)}catch(e){}};
 const isDk=()=>{const d=document.documentElement.dataset.theme;return d==='dark'||(d!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches)},dk=ref(isDk());
 const accEff=computed(()=>acc.value||(dk.value?'#14b8a6':'#3a6fd8'));
 try{matchMedia('(prefers-color-scheme:dark)').addEventListener('change',()=>{dk.value=isDk()});new MutationObserver(()=>{dk.value=isDk()}).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']})}catch(e){}
  /* NEO: giao diện sáng — #app.neo.lt khi chế độ hiệu lực là sáng (Sáng, hoặc Tự động + điện thoại đang sáng) */
  Vue.watchEffect(()=>{const a=document.getElementById('app');if(a)a.classList.toggle('lt',!dk.value)});
 Vue.watchEffect(()=>{const r=document.documentElement.style,themed=!!pal.value;let a=accEff.value;
  if(dk.value&&lum(a)<.45){a='#'+hx(a).map(v=>Math.round(v+(255-v)*.55).toString(16).padStart(2,'0')).join('')}
  const rl=h=>{const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)};const[r,g,b]=hx(h);return .2126*f(r)+.7152*f(g)+.0722*f(b)},cr=(x,y)=>{const A=rl(x),B=rl(y);return(Math.max(A,B)+.05)/(Math.min(A,B)+.05)};
  const on=cr(a,'#ffffff')>=4.5?'#fff':'#042f2e';
  let t=a;const bgc=dk.value?'#18181b':'#ffffff';for(let i=0;i<12&&cr(t,bgc)<4.5;i++)t=dk.value?'#'+hx(t).map(v=>Math.round(v+(255-v)*.12).toString(16).padStart(2,'0')).join(''):shade(t,.1);
  r.setProperty('--acct',t);
  ['--acc1','--acc2','--onacc'].forEach(k=>r.setProperty(k,k==='--onacc'?on:a));r.setProperty('--accg','linear-gradient('+a+','+a+')');
  if(!themed)['--zb','--zb2','--zg','--hl'].forEach(k=>r.setProperty(k,a))});
 const saveTheme=async()=>{if(th.busy)return;th.busy=true;th.err=th.msg='';try{const d=await api('PUT','/theme',{theme:th.sel,noTheme:th.no,...(th.sel==='custom'?{bg:th.bg,accent:th.accent}:{})});Object.assign(acct,{theme:d.user.theme,noTheme:d.user.noTheme});th.dirty=false;th.msg='Đã lưu giao diện.'}catch(e){th.err=e.message}finally{th.busy=false}};
 /* chọc (poke) – port từ UCenter Home. Server chỉ lưu id 0..13; emoji/nhãn nằm ở đây */
 const PK=[['👋','Chỉ chào thôi',''],['','Bước đi','cyx'],['','Bắt tay','wgs'],['','Cười','wx'],['','Cố lên','jy'],['','Nháy mắt','pmy'],['','Ôm','yb'],['','Hôn','fw'],['','Véo','nyy'],['','Đấm nhẹ','gyq'],['','Giật điện','dyx'],['','Ôm hôn','yw'],['','Vỗ vai','ppjb'],['','Cắn','yyk']];
 const pkImg=a=>a[2]?'/img/poke/'+a[2]+'.gif':'';
 const pk=reactive({list:[],busy:false,show:false,to:null,reply:false,icon:0,note:'',err:'',toast:''});let pkT;
 const loadPokes=async()=>{try{pk.list=await api('GET','/pokes')}catch(e){}};
 const openPoke=(u,reply)=>{if(!u||u.id===uid.value)return;Object.assign(pk,{show:true,to:u,reply:!!reply,icon:0,note:'',err:'',busy:false})};
 const closePoke=()=>{pk.show=false};
 const sendPoke=async()=>{if(pk.busy)return;pk.busy=true;pk.err='';try{await api('POST','/pokes/'+pk.to.id,{icon:pk.icon,note:pk.note.trim(),reply:pk.reply});const n=pk.to.n;closePoke();pk.toast='Đã chọc '+n+' 👋';clearTimeout(pkT);pkT=setTimeout(()=>{pk.toast=''},3000);loadPokes()}catch(e){pk.err=e.message}finally{pk.busy=false}};
 const ignorePoke=async id=>{try{await api('DELETE','/pokes'+(id?'/'+id:''));await loadPokes()}catch(e){alert(e.message)}};
 const pkFriend=async p=>{try{await api('POST','/friends/'+p.id+(p.rel==='received'?'/accept':'/request'));await Promise.all([loadFr(),loadPokes()])}catch(e){alert(e.message)}};
 setInterval(()=>{if(authed.value&&acct.verified&&!document.hidden)loadPokes()},30000);   // dự phòng khi chưa bật realtime

 /* ---------- Trung tâm thông báo (port logic từ phpFox notification) ---------- */
 const nt=reactive({open:false,busy:false,unseen:0,items:[],mid:''}),np=reactive({items:[],total:0,page:1,pages:1,busy:false,err:''}),nj=ref(null);
 const ntCount=async()=>{if(!authed.value||!acct.verified)return;try{nt.unseen=(await api('GET','/notifications/count')).unseen}catch(e){}};          // getNewCount
 const ntToggle=async()=>{                                                                                                                       // mở menu = lấy 5 nhóm mới nhất + đánh dấu đã xem
  if(nt.open){nt.open=false;return}
  nt.mid='';nt.open=true;nt.busy=true;
  try{const d=await api('POST','/notifications/recent');nt.items=d.items;nt.unseen=d.unseen}catch(e){nt.items=[]}finally{nt.busy=false}};
 const ntGo=it=>{nt.open=false;const l=it.link||{};
  if(l.view==='profile'){go('profile');if(l.tab)tab.value=l.tab;if(l.album)nj.value={a:l.album,p:l.photo||''}}
  else if(l.view==='user'&&l.user)openUser(l.user);
  else if(l.view==='events'){evNav.id=l.event||'';evNav.n++;go('events')}
  else if(l.view==='groups'){if(l.thread)gOpenThread(l.thread);else if(l.group)gOpen(l.group);else gGo()}
  else if(l.view==='forum'){foNav.id=l.thread||'';foNav.n++;go('forum')}
  else if(l.view==='videos'){vdNav.id=l.video||'';vdNav.n++;go('videos')}
  else if(l.view==='quizzes'){qzNav.id=l.quiz||'';qzNav.n++;go('quizzes')}
  else if(l.view==='pages'){pgNav.id=l.page||'';pgNav.n++;go('pages')}
  else if(l.view==='gifts')go('gifts')
  else if(['doings','discover','topics','tasks'].includes(l.view))go(l.view)};
 const ntPage=async(p,reset)=>{if(np.busy)return;np.busy=true;np.err='';
  try{const d=await api('GET','/notifications?page='+(p||1));np.items=reset?d.items:[...np.items,...d.items];Object.assign(np,{total:d.total,page:d.page,pages:d.pages});ntCount()}
  catch(e){np.err=e.message}finally{np.busy=false}};
 const dayLabel=iso=>{const d=new Date(iso),n=new Date(),k=x=>x.getFullYear()*400+x.getMonth()*32+x.getDate(),y=new Date(n);y.setDate(n.getDate()-1);
  return k(d)===k(n)?'Hôm nay':k(d)===k(y)?'Hôm qua':String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+(d.getFullYear()!==n.getFullYear()?'/'+d.getFullYear():'')};
 const npGroups=computed(()=>{const out=[];np.items.forEach(it=>{const l=dayLabel(it.at);let g=out[out.length-1];if(!g||g.label!==l){g={label:l,items:[]};out.push(g)}g.items.push(it)});return out});   // nhóm theo ngày như phpFox
 const ntDel=async it=>{try{const d=await api('DELETE','/notifications/'+it.id);np.items=np.items.filter(x=>x.id!==it.id);np.total--;nt.unseen=d.unseen}catch(e){np.err=e.message}};      // hide
 const ntDelD=async it=>{nt.mid='';try{const d=await api('DELETE','/notifications/'+it.id);nt.items=nt.items.filter(x=>x.id!==it.id);np.items=np.items.filter(x=>x.id!==it.id);nt.unseen=d.unseen}catch(e){}};   // xóa từ menu thả xuống
 /* ---------- Quản trị: quản lý thành viên ---------- */
 const adm=reactive({tab:'stats',ss:null,sbusy:false,q:'',f:'all',page:1,pages:1,total:0,items:[],stats:null,busy:false,err:'',open:'',det:null,reason:'',ugList:[],ugSel:''});
 const admStats=async()=>{if(adm.sbusy)return;adm.sbusy=true;adm.err='';try{adm.ss=await api('GET','/admin/stats')}catch(e){adm.err=e.message}finally{adm.sbusy=false}};
 const admTab=t=>{adm.tab=t;adm.err='';if(t==='stats')admStats();else if(t==='reports')rpLoad(1);else if(t==='mod')mxLoad(1);else if(t==='censor')cxLoad();else if(t==='credit')crLoad();else if(t==='hot')hotLoad();else if(t==='ip')ipLoad();else if(t==='logs')lgLoad(1);else if(t==='cfg'){cfLoad();evcLoad();tgLoad();cronLoad();thmLoad()}else if(t==='grp')grLoad();else if(t==='topics')tpLoad(1);else if(t==='magic')mgLoad();else if(t==='pfx')pfxLoad('forum');else if(t==='cmap'){}else admLoad(1)};
 /* Duyệt tố cáo (admincp_report của UCHome) */
 const rpLoad=async p=>{adm.rp.busy=true;adm.err='';try{const d=await api('GET','/admin/reports?status='+adm.rp.st+'&page='+(p||1));Object.assign(adm.rp,{items:d.reports,total:d.total,page:d.page,pages:Math.max(1,Math.ceil(d.total/d.per))})}catch(e){adm.err=e.message}finally{adm.rp.busy=false}};
 const rpAct=async(r,action)=>{const acts={dismiss:'bỏ qua',delete:'XÓA NỘI DUNG',ban:'KHÓA TÀI KHOẢN'};if(!confirm('Xác nhận '+acts[action]+' tố cáo này?'))return;adm.rp.busy=true;try{await api('PATCH','/admin/reports/'+r.id,{action});adm.rp.items=adm.rp.items.filter(x=>x.id!==r.id)}catch(e){alert(e.message)}finally{adm.rp.busy=false}};
 /* Sao lưu dữ liệu */
 const dlBackup=async()=>{if(!confirm('Tải về bản sao lưu toàn bộ dữ liệu (JSON)?'))return;try{const r=await fetch('/api/admin/backup',{credentials:'include'});if(!r.ok)throw new Error('Không tải được bản sao lưu.');const blob=await r.blob();const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='coolair-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000)}catch(e){alert(e.message)}};
 adm.rp={st:'open',items:[],total:0,page:1,pages:1,busy:false};
 /* Quản trị mở rộng */
 const ax=reactive({mod:{kind:'posts',q:'',items:[],total:0,page:1,pages:1,busy:false,cOpen:'',cItems:null,cBusy:false},cx:{items:[],word:'',rep:'***',busy:false},cr:{rules:[],tasks:[],clicks:'',busy:false},hot:{items:[],uid:'',note:'',busy:false},ip:{items:[],addr:'',reason:'',busy:false},lg:{items:[],total:0,page:1,pages:1,busy:false,action:'',q:''},cf:{keys:[],busy:false},gr:{groups:[],permKeys:[],name:'',perms:{},busy:false},evc:{items:[],name:'',busy:false},tg:{items:[],from:'',to:'',busy:false},
 tp:{items:[],title:'',desc:'',hot:false,busy:false,page:1,pages:1,editId:'',etitle:'',edesc:'',ehot:false,eclosed:false},
 cron:{jobs:[],lastAll:null,busy:false},mg:{items:[],busy:false,logs:[],logTotal:0,logPg:1,logBusy:false,logTab:false},
 thm:{busy:false}});
 const MODKINDS=[['posts','Bài viết'],['blogs','Nhật ký'],['doings','Trạng thái'],['shares','Chia sẻ'],['photos','Ảnh'],['albums','Album'],['events','Sự kiện'],['polls','Bình chọn'],['threads','Chủ đề nhóm'],['forum_threads','Chủ đề diễn đàn'],['songs','Bài hát'],['videos','Video'],['quizzes','Quiz'],['pages','Trang'],['bulletins','Bản tin'],['links','Liên kết']];
 /* Quản trị danh mục phpFox parity (diễn đàn, nhạc, video, trang, quà, link, thông báo, newsletter, faq, liên hệ) */
 const pfx=reactive({sec:'forum',busy:false,err:'',
  forumCats:[],forums:[],fcName:'',fName:'',fCat:'',fDesc:'',
  musicGenres:[],mgName:'',videoCats:[],vcName:'',pageCats:[],pcName:'',
  giftCats:[],gifts:[],gcName:'',gName:'',gIcon:'🎁',gCat:'',gDesc:'',
  linkCats:[],lcName:'',anncs:[],anTitle:'',anText:'',news:[],nwSub:'',nwText:'',faqs:[],fqQ:'',fqA:'',contact:[],cDet:null});
 const pfxRun=async fn=>{pfx.err='';pfx.busy=true;try{await fn()}catch(e){pfx.err=e.message}finally{pfx.busy=false}};
 const pfxLoad=sec=>{pfx.sec=sec;pfx.cDet=null;
  if(sec==='forum')pfxRun(async()=>{pfx.forumCats=(await api('GET','/admin/forum-cats')).cats;pfx.forums=(await api('GET','/admin/forums')).forums});
  else if(sec==='music')pfxRun(async()=>{pfx.musicGenres=(await api('GET','/admin/music-genres')).genres});
  else if(sec==='video')pfxRun(async()=>{pfx.videoCats=(await api('GET','/admin/video-cats')).cats});
  else if(sec==='page')pfxRun(async()=>{pfx.pageCats=(await api('GET','/admin/page-cats')).cats});
  else if(sec==='gift')pfxRun(async()=>{pfx.giftCats=(await api('GET','/admin/gift-cats')).cats;pfx.gifts=(await api('GET','/admin/gifts')).gifts});
  else if(sec==='link')pfxRun(async()=>{pfx.linkCats=(await api('GET','/admin/link-cats')).cats});
  else if(sec==='annc')pfxRun(async()=>{pfx.anncs=(await api('GET','/admin/announcements')).announcements});
  else if(sec==='news')pfxRun(async()=>{pfx.news=(await api('GET','/admin/newsletters')).newsletters});
  else if(sec==='faq')pfxRun(async()=>{pfx.faqs=(await api('GET','/admin/faqs')).faqs});
  else if(sec==='contact')pfxRun(async()=>{pfx.contact=(await api('GET','/admin/contact')).items})};
 const pfxAdd={ // thêm nhanh các loại danh mục đơn giản
  forumCat:()=>pfxRun(async()=>{await api('POST','/admin/forum-cats',{name:pfx.fcName});pfx.fcName='';pfxLoad('forum')}),
  musicGenre:()=>pfxRun(async()=>{await api('POST','/admin/music-genres',{name:pfx.mgName});pfx.mgName='';pfxLoad('music')}),
  videoCat:()=>pfxRun(async()=>{await api('POST','/admin/video-cats',{name:pfx.vcName});pfx.vcName='';pfxLoad('video')}),
  pageCat:()=>pfxRun(async()=>{await api('POST','/admin/page-cats',{name:pfx.pcName});pfx.pcName='';pfxLoad('page')}),
  giftCat:()=>pfxRun(async()=>{await api('POST','/admin/gift-cats',{name:pfx.gcName});pfx.gcName='';pfxLoad('gift')}),
  linkCat:()=>pfxRun(async()=>{await api('POST','/admin/link-cats',{name:pfx.lcName});pfx.lcName='';pfxLoad('link')})};
 const pfxDel=(url,id,sec)=>{if(!confirm('Xóa mục này?'))return;pfxRun(async()=>{await api('DELETE',url+'/'+id);pfxLoad(sec)})};
 const forumAdd=()=>{if(!pfx.fName.trim()||!pfx.fCat){pfx.err='Nhập tên box và chọn chuyên mục.';return}
  pfxRun(async()=>{await api('POST','/admin/forums',{name:pfx.fName,cat:pfx.fCat,desc:pfx.fDesc});pfx.fName='';pfx.fDesc='';pfxLoad('forum')})};
 const forumToggle=f=>pfxRun(async()=>{await api('PATCH','/admin/forums/'+f.id,{closed:!f.closed});pfxLoad('forum')});
 const giftAdd=()=>{if(!pfx.gName.trim()){pfx.err='Nhập tên quà.';return}
  pfxRun(async()=>{await api('POST','/admin/gifts',{name:pfx.gName,icon:pfx.gIcon||'🎁',cat:pfx.gCat||undefined,desc:pfx.gDesc});pfx.gName='';pfx.gDesc='';pfx.gIcon='🎁';pfxLoad('gift')})};
 const giftToggle=g=>pfxRun(async()=>{await api('PATCH','/admin/gifts/'+g.id,{enabled:!g.enabled});pfxLoad('gift')});
 const anncAdd=()=>{if(!pfx.anTitle.trim()||!pfx.anText.trim()){pfx.err='Nhập tiêu đề và nội dung thông báo.';return}
  pfxRun(async()=>{await api('POST','/admin/announcements',{title:pfx.anTitle,text:pfx.anText});pfx.anTitle='';pfx.anText='';pfxLoad('annc')})};
 const anncToggle=a=>pfxRun(async()=>{await api('PATCH','/admin/announcements/'+a.id,{active:!a.active});pfxLoad('annc')});
 const newsAdd=()=>{if(!pfx.nwSub.trim()||!pfx.nwText.trim()){pfx.err='Nhập tiêu đề và nội dung newsletter.';return}
  pfxRun(async()=>{await api('POST','/admin/newsletters',{subject:pfx.nwSub,text:pfx.nwText});pfx.nwSub='';pfx.nwText='';pfxLoad('news')})};
 const newsSend=n=>{if(!confirm('Gửi newsletter này tới toàn bộ thành viên?'))return;
  pfxRun(async()=>{const d=await api('POST','/admin/newsletters/'+n.id+'/send');alert('Đã gửi tới '+d.sent+' người.');pfxLoad('news')})};
 const faqAdd=()=>{if(!pfx.fqQ.trim()||!pfx.fqA.trim()){pfx.err='Nhập câu hỏi và trả lời.';return}
  pfxRun(async()=>{await api('POST','/admin/faqs',{question:pfx.fqQ,answer:pfx.fqA});pfx.fqQ='';pfx.fqA='';pfxLoad('faq')})};
 const contactView=m=>pfxRun(async()=>{pfx.cDet=(await api('GET','/admin/contact/'+m.id)).msg;pfxLoad('contact')});
 const mxLoad=async p=>{const m=ax.mod;m.busy=true;m.cOpen='';m.cItems=null;try{const d=await api('GET','/admin/mod/'+m.kind+'?q='+encodeURIComponent(m.q.trim())+'&page='+(p||1));Object.assign(m,{items:d.items,total:d.total,page:d.page,pages:Math.max(1,Math.ceil(d.total/d.per))})}catch(e){adm.err=e.message}finally{m.busy=false}};
 const mxDel=async it=>{if(!confirm('Xóa vĩnh viễn nội dung này?'))return;try{await api('DELETE','/admin/mod/'+ax.mod.kind+'/'+it.id);ax.mod.items=ax.mod.items.filter(x=>x.id!==it.id)}catch(e){alert(e.message)}};
 const mcToggle=async it=>{const m=ax.mod;if(m.cOpen===it.id){m.cOpen='';m.cItems=null;return}m.cOpen=it.id;m.cItems=null;m.cBusy=true;try{m.cItems=(await api('GET','/admin/mod/'+m.kind+'/'+it.id+'/comments')).comments}catch(e){adm.err=e.message}finally{m.cBusy=false}};
 const mcDel=async(it,c)=>{if(!confirm('Xóa bình luận này?'))return;try{await api('DELETE','/admin/mod/'+ax.mod.kind+'/'+it.id+'/comments/'+c.id);ax.mod.cItems=ax.mod.cItems.filter(x=>x.id!==c.id);if(it.comments)it.comments--;if(it.replies)it.replies--}catch(e){alert(e.message)}};
 const cxLoad=async()=>{ax.cx.busy=true;try{ax.cx.items=(await api('GET','/admin/censor')).words}catch(e){adm.err=e.message}finally{ax.cx.busy=false}};
 const cxAdd=async()=>{const w=ax.cx.word.trim();if(w.length<2){alert('Từ cấm cần ít nhất 2 ký tự.');return}try{const d=await api('POST','/admin/censor',{word:w,replacement:ax.cx.rep.trim()||'***'});ax.cx.items.push(d.word);ax.cx.items.sort((a,b)=>a.word.localeCompare(b.word));ax.cx.word=''}catch(e){alert(e.message)}};
 const cxDel=async id=>{try{await api('DELETE','/admin/censor/'+id);ax.cx.items=ax.cx.items.filter(x=>x.id!==id)}catch(e){alert(e.message)}};
 const crLoad=async()=>{ax.cr.busy=true;try{const[r,t,c]=await Promise.all([api('GET','/admin/credit-rules'),api('GET','/admin/tasks'),api('GET','/admin/clicks')]);ax.cr.rules=r.rules;ax.cr.tasks=t.tasks;ax.cr.clicks=c.clicks.join(' ')}catch(e){adm.err=e.message}finally{ax.cr.busy=false}};
 const crSaveRule=async r=>{try{await api('PATCH','/admin/credit-rules/'+r.id,{credit:+r.credit||0,exp:+r.exp||0,max:+r.max||0,cycle:r.cycle,enabled:r.enabled});alert('Đã lưu.')}catch(e){alert(e.message)}};
 const crSaveTask=async t=>{try{await api('PATCH','/admin/tasks/'+t.id,{name:t.name,desc:t.desc,credit:+t.credit||0,exp:+t.exp||0,enabled:t.enabled});alert('Đã lưu.')}catch(e){alert(e.message)}};
 const crSaveClicks=async()=>{const arr=ax.cr.clicks.split(/\s+/).filter(Boolean);if(!arr.length){alert('Cần ít nhất 1 cảm xúc.');return}try{await api('PUT','/admin/clicks',{clicks:arr});alert('Đã lưu.')}catch(e){alert(e.message)}};
 const hotLoad=async()=>{ax.hot.busy=true;try{ax.hot.items=(await api('GET','/admin/hotusers')).hotusers}catch(e){adm.err=e.message}finally{ax.hot.busy=false}};
 const hotAdd=async()=>{const u=ax.hot.uid.trim();if(!/^[0-9a-fA-F]{24}$/.test(u)){alert('ID người dùng không hợp lệ (24 ký tự hex).');return}try{await api('POST','/admin/hotusers',{user:u,note:ax.hot.note.trim()});ax.hot.uid='';ax.hot.note='';hotLoad()}catch(e){alert(e.message)}};
 const hotDel=async id=>{if(!confirm('Gỡ nổi bật?'))return;try{await api('DELETE','/admin/hotusers/'+id);ax.hot.items=ax.hot.items.filter(x=>x.id!==id)}catch(e){alert(e.message)}};
 const ipLoad=async()=>{ax.ip.busy=true;try{ax.ip.items=(await api('GET','/admin/ipbans')).ipbans}catch(e){adm.err=e.message}finally{ax.ip.busy=false}};
 const ipAdd=async()=>{const a=ax.ip.addr.trim();if(a.length<3){alert('IP không hợp lệ.');return}try{await api('POST','/admin/ipbans',{ip:a,reason:ax.ip.reason.trim()});ax.ip.addr='';ax.ip.reason='';ipLoad()}catch(e){alert(e.message)}};
 const ipDel=async id=>{if(!confirm('Gỡ chặn IP này?'))return;try{await api('DELETE','/admin/ipbans/'+id);ax.ip.items=ax.ip.items.filter(x=>x.id!==id)}catch(e){alert(e.message)}};
 const lgLoad=async p=>{const l=ax.lg;l.busy=true;try{let u='/admin/logs?page='+(p||1);if(l.action)u+='&action='+encodeURIComponent(l.action);if(l.q.trim())u+='&q='+encodeURIComponent(l.q.trim());const d=await api('GET',u);Object.assign(l,{items:d.logs,total:d.total,page:d.page,pages:Math.max(1,Math.ceil(d.total/d.per))})}catch(e){adm.err=e.message}finally{l.busy=false}};
 const cfLoad=async()=>{ax.cf.busy=true;try{ax.cf.keys=(await api('GET','/admin/site-config')).keys}catch(e){adm.err=e.message}finally{ax.cf.busy=false}};
 const cfSave=async()=>{try{const body={};ax.cf.keys.forEach(k=>body[k.key]=k.value);await api('PUT','/admin/site-config',body);alert('Đã lưu cấu hình.')}catch(e){alert(e.message)}};
 /* Phân loại sự kiện */
 const evcLoad=async()=>{ax.evc.busy=true;try{ax.evc.items=(await api('GET','/admin/event-cats')).cats}catch(e){adm.err=e.message}finally{ax.evc.busy=false}};
 const evcAdd=async()=>{const n=ax.evc.name.trim();if(n.length<2){alert('Tên phân loại cần ít nhất 2 ký tự.');return}try{await api('POST','/admin/event-cats',{name:n});ax.evc.name='';evcLoad()}catch(e){alert(e.message)}};
 const evcRen=async c=>{const n=prompt('Đổi tên phân loại:',c.name);if(!n||!n.trim()||n.trim()===c.name)return;try{await api('PATCH','/admin/event-cats/'+c.id,{name:n.trim()});evcLoad()}catch(e){alert(e.message)}};
 const evcDel=async c=>{if(!confirm('Xóa phân loại "'+c.name+'"? Sự kiện trong đó sẽ về "Chưa phân loại".'))return;try{await api('DELETE','/admin/event-cats/'+c.id);evcLoad()}catch(e){alert(e.message)}};
 /* Quản lý tag */
 const tgLoad=async()=>{ax.tg.busy=true;try{ax.tg.items=(await api('GET','/admin/tags')).tags}catch(e){adm.err=e.message}finally{ax.tg.busy=false}};
 const tgMerge=async t=>{const to=(ax.tg.to||'').trim()||prompt('Gộp tag "'+t.name+'" vào tag nào?',t.name);if(!to||!to.trim()||to.trim()===t.name)return;try{const d=await api('POST','/admin/tags/merge',{from:t.name,to:to.trim()});alert('Đã gộp vào "'+to.trim()+'" ('+d.updated+' bài).');ax.tg.to='';tgLoad()}catch(e){alert(e.message)}};
 const tgDel=async t=>{if(!confirm('Xóa tag "'+t.name+'" khỏi mọi nhật ký?'))return;try{await api('DELETE','/admin/tags/'+encodeURIComponent(t.name));tgLoad()}catch(e){alert(e.message)}};
 /* Quản lý chủ đề nóng */
 const tpLoad=async p=>{ax.tp.busy=true;try{const d=await api('GET','/topics?all=1&page='+(p||1));ax.tp.items=d.topics;ax.tp.page=d.page;ax.tp.pages=Math.max(1,Math.ceil(d.total/d.per))}catch(e){adm.err=e.message}finally{ax.tp.busy=false}};
 const tpAdd=async()=>{const t=ax.tp.title.trim();if(!t){alert('Cần tên chủ đề.');return}try{await api('POST','/topics',{title:t,desc:ax.tp.desc.trim(),hot:ax.tp.hot});ax.tp.title='';ax.tp.desc='';ax.tp.hot=false;tpLoad(1)}catch(e){alert(e.message)}};
 const tpEdit=t=>{ax.tp.editId=t.id;ax.tp.etitle=t.title;ax.tp.edesc=t.desc||'';ax.tp.ehot=!!t.hot;ax.tp.eclosed=!!t.closed};
 const tpSave=async t=>{try{await api('PATCH','/topics/'+t.id,{title:ax.tp.etitle.trim(),desc:ax.tp.edesc.trim(),hot:ax.tp.ehot,closed:ax.tp.eclosed});ax.tp.editId='';tpLoad(ax.tp.page)}catch(e){alert(e.message)}};
 const cronLoad=async()=>{ax.cron.busy=true;try{const d=await api('GET','/admin/cron');ax.cron.jobs=d.jobs;ax.cron.lastAll=d.lastAll}catch(e){adm.err=e.message}finally{ax.cron.busy=false}};
 const cronRun=async()=>{if(!confirm('Chạy ngay các tác vụ dọn dẹp?'))return;ax.cron.busy=true;try{await api('POST','/admin/cron/run');cronLoad()}catch(e){alert(e.message)}finally{ax.cron.busy=false}};
 const thmLoad=async()=>{ax.thm.busy=true;try{const d=await api('GET','/admin/themes');thAdm.disabled=d.disabled||[];thAdm.def=d.def||''}catch(e){adm.err=e.message}finally{ax.thm.busy=false}};
 const thmSave=async()=>{ax.thm.busy=true;try{await api('PUT','/admin/themes',{disabled:thAdm.disabled,default:thAdm.def});alert('Đã lưu cấu hình giao diện.')}catch(e){alert(e.message)}finally{ax.thm.busy=false}};
 const mgLoad=async()=>{ax.mg.busy=true;try{ax.mg.items=(await api('GET','/admin/magics')).magics}catch(e){adm.err=e.message}finally{ax.mg.busy=false}};
 const mgSave=async m=>{try{await api('PATCH','/admin/magics/'+m.mid,{charge:m.charge})}catch(e){alert(e.message);mgLoad()}};
 const mgToggle=async m=>{try{await api('PATCH','/admin/magics/'+m.mid,{enabled:!m.enabled});m.enabled=!m.enabled}catch(e){alert(e.message)}};
 const mgLog=async p=>{const m=ax.mg;m.logBusy=true;try{const d=await api('GET','/admin/magiclog?page='+(p||1));m.logs=d.logs;m.logTotal=d.total;m.logPg=d.page}catch(e){adm.err=e.message}finally{m.logBusy=false}};
 const thmToggle=id=>{const i=thAdm.disabled.indexOf(id);if(i>=0)thAdm.disabled.splice(i,1);else thAdm.disabled.push(id)};
 const tpDel=async t=>{if(!confirm('Xóa chủ đề "'+t.title+'"? Mọi lượt tham gia và nội dung gắn vào sẽ bị gỡ.'))return;try{await api('DELETE','/topics/'+t.id);tpLoad(ax.tp.page)}catch(e){alert(e.message)}};
 const grLoad=async()=>{ax.gr.busy=true;try{const d=await api('GET','/admin/user-groups');ax.gr.groups=d.groups;ax.gr.permKeys=d.permKeys}catch(e){adm.err=e.message}finally{ax.gr.busy=false}};
 const grAdd=async()=>{const n=ax.gr.name.trim();if(!n){alert('Cần tên nhóm.');return}try{await api('POST','/admin/user-groups',{name:n,perms:ax.gr.perms});ax.gr.name='';ax.gr.perms={};grLoad()}catch(e){alert(e.message)}};
 const grSave=async g=>{try{await api('PATCH','/admin/user-groups/'+g.id,{name:g.name,perms:g.perms});alert('Đã lưu.')}catch(e){alert(e.message)}};
 const grDel=async g=>{if(!confirm('Xóa nhóm "'+g.name+'"?'))return;try{await api('DELETE','/admin/user-groups/'+g.id);grLoad()}catch(e){alert(e.message)}};
 const fmtN=n=>(n||0).toLocaleString('vi-VN');
 const admCards=computed(()=>{const t=adm.ss&&adm.ss.totals;if(!t)return[];return[
  [fmtN(t.users),'Thành viên','+'+fmtN(t.today)+' hôm nay',1],[fmtN(t.online),'Đang online','5 phút qua',1],[fmtN(t.active24),'Hoạt động 24 giờ','7 ngày: '+fmtN(t.active7)],[fmtN(t.unverified),'Chưa xác thực','Đã xác thực: '+fmtN(t.verified)],
  [fmtN(t.banned),'Bị khóa',''],[fmtN(t.friends),'Cặp bạn bè',''],[fmtN(t.posts),'Bài viết','Bình luận: '+fmtN(t.comments)],[fmtN(t.messages),'Tin nhắn',''],
  [fmtN(t.albums),'Album','Ảnh: '+fmtN(t.photos)],[fmtN(t.groups),'Nhóm','Chủ đề: '+fmtN(t.threads)],[fmtN(t.replies),'Trả lời trong nhóm',''],[fmtN(t.guestbook),'Lưu bút','']]});
 const admCharts=computed(()=>{const s=adm.ss&&adm.ss.series;if(!s)return[];const mk=(k,t,c)=>{const a=s[k];return{k,t,c,s:a,max:Math.max(0,...a.map(x=>x.n)),sum:a.reduce((p,x)=>p+x.n,0)}};return[mk('users','Thành viên mới','#3B5998'),mk('posts','Bài viết mới','#6BBA70'),mk('messages','Tin nhắn mới','#e8a317')]});
 const admLoad=async p=>{if(adm.busy)return;adm.busy=true;adm.err='';
  try{const d=await api('GET','/admin/users?q='+encodeURIComponent(adm.q.trim())+'&filter='+adm.f+'&page='+(p||1));Object.assign(adm,{items:d.items,total:d.total,page:d.page,pages:d.pages,stats:d.stats})}
  catch(e){adm.err=e.message}finally{adm.busy=false}};
 const admDet=async id=>{try{adm.det=(await api('GET','/admin/users/'+id)).user}catch(e){adm.err=e.message}};
 const admOpen=async u=>{if(adm.open===u.id){adm.open='';return}adm.open=u.id;adm.det=null;adm.reason='';adm.err='';adm.ugSel='';ugLoad().then(()=>{if(adm.det&&adm.det.userGroup)adm.ugSel=adm.det.userGroup});await admDet(u.id);if(adm.det&&adm.det.userGroup)adm.ugSel=adm.det.userGroup};
 /* Gán nhóm quyền cho thành viên */
 const ugSet=async u=>{try{await api('POST','/admin/users/'+u.id+'/group',{group:adm.ugSel||''});alert('Đã cập nhật nhóm quyền.');admDet(u.id)}catch(e){alert(e.message)}};
 const ugLoad=async()=>{try{adm.ugList=(await api('GET','/admin/user-groups')).groups}catch(e){adm.ugList=[]}};
 const admAct=async(u,act)=>{if(adm.busy)return;
  if(act==='ban'&&!confirm('Khóa tài khoản "'+u.username+'"? Người này sẽ bị đăng xuất và không đăng nhập lại được.'))return;
  adm.err='';adm.busy=true;
  try{await api('POST','/admin/users/'+u.id+'/'+act,act==='ban'?{reason:adm.reason}:{});adm.reason='';adm.busy=false;await admLoad(adm.page);await admDet(u.id)}
  catch(e){adm.err=e.message}finally{adm.busy=false}};
 const admDel=async u=>{if(adm.busy)return;
  const n=prompt('XÓA VĨNH VIỄN tài khoản "'+(u.username||u.name||u.id)+'" cùng toàn bộ bài viết, ảnh, tin nhắn, bạn bè... Không thể khôi phục.\nGõ '+(u.username?'tên đăng nhập':'tên hiển thị')+' để xác nhận:');
  if(n===null)return;adm.err='';adm.busy=true;
  try{await api('DELETE','/admin/users/'+u.id,{username:n.trim()});adm.open='';adm.busy=false;await admLoad(adm.items.length>1?adm.page:Math.max(1,adm.page-1))}
  catch(e){adm.err=e.message;alert(e.message)}finally{adm.busy=false}};
 Vue.watch(view,v=>{if(v==='admin'&&acct.admin)admTab(adm.tab)});

 const ntClear=async reset=>{if(!reset&&!confirm('Xóa tất cả thông báo?'))return;try{await api('DELETE','/notifications');np.items=[];np.total=0;nt.items=[];nt.unseen=0}catch(e){np.err=e.message}};   // deleteAll / removeAll
 const ntReset=()=>{nt.open=false;nt.unseen=0;nt.items=[];Object.assign(np,{items:[],total:0,page:1,pages:1,err:''});nj.value=null};
 Vue.watch(view,v=>{if(v==='notifications')ntPage(1,true)});
 /* Thông báo chung (announcement của phpFox): banner đầu trang chủ */
 const anncs=ref([]);
 const loadAnncs=async()=>{try{anncs.value=(await api('GET','/announcements')).announcements}catch(e){}};
 Vue.watch(view,v=>{if(v==='home'&&authed.value)loadAnncs()});
 Vue.watch(authed,v=>{if(v)loadAnncs()});
 Vue.watchEffect(()=>{const base='CoolAir – Kết nối bạn bè';document.title=authed.value&&nt.unseen>0?'('+nt.unseen+') '+base:base});                                    // "(n) Tiêu đề" như $Core.notification.setTitle
 document.addEventListener('click',()=>{nt.open=false});
 document.addEventListener('keydown',e=>{if(e.key==='Escape')nt.open=false});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)ntCount()});
 setInterval(()=>{if(authed.value&&acct.verified&&!document.hidden)ntCount()},120000);
 setInterval(()=>{if(authed.value&&acct.verified&&!document.hidden&&!rtOn.value)ntCount()},30000);   // realtime chưa bật / mất kết nối -> hỏi lại mỗi 30 giây thay vì 2 phút   // notify_ajax_refresh = 2 phút; có realtime thì cập nhật ngay
 boot();
 /* ----- Thông báo đẩy (Web Push) ----- */
 const pushUi=reactive({sup:('serviceWorker' in navigator)&&('PushManager' in window)&&('Notification' in window),on:false,busy:false,err:'',denied:false});
 const b64u8=b=>{const s=(b+'='.repeat((4-b.length%4)%4)).replace(/-/g,'+').replace(/_/g,'/'),r=atob(s),o=new Uint8Array(r.length);for(let i=0;i<r.length;i++)o[i]=r.charCodeAt(i);return o};
 const pushInit=async()=>{if(!pushUi.sup)return;pushUi.err='';try{pushUi.denied=Notification.permission==='denied';const reg=await navigator.serviceWorker.ready;pushUi.on=!!(await reg.pushManager.getSubscription())&&Notification.permission==='granted'}catch(e){}};
 const pushOn=async()=>{if(pushUi.busy)return;pushUi.busy=true;pushUi.err='';
  try{const perm=await Notification.requestPermission();pushUi.denied=perm==='denied';if(perm!=='granted'){if(perm==='default')pushUi.err='Bạn chưa cho phép thông báo.';return}
   const key=(await api('GET','/push/key')).key,reg=await navigator.serviceWorker.ready;
   let sub=await reg.pushManager.getSubscription();if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64u8(key)});
   await api('POST','/push/subscribe',{subscription:sub.toJSON()});pushUi.on=true}
  catch(e){pushUi.err=e&&e.message?e.message:'Không bật được thông báo đẩy.'}finally{pushUi.busy=false}};
 const pushOff=async()=>{if(pushUi.busy)return;pushUi.busy=true;pushUi.err='';
  try{const reg=await navigator.serviceWorker.ready,sub=await reg.pushManager.getSubscription();if(sub){await api('POST','/push/unsubscribe',{endpoint:sub.endpoint}).catch(()=>{});await sub.unsubscribe()}pushUi.on=false}
  catch(e){pushUi.err=e&&e.message?e.message:'Không tắt được.'}finally{pushUi.busy=false}};
 const pushDrop=async()=>{if(!pushUi.sup)return;try{await Promise.race([pushOffQuiet(),new Promise(r=>setTimeout(r,1500))])}catch(e){}};   // đăng xuất: gỡ thuê bao của thiết bị này để người dùng sau trên cùng máy không nhận nhầm thông báo
 const pushOffQuiet=async()=>{const reg=await navigator.serviceWorker.getRegistration(),sub=reg&&await reg.pushManager.getSubscription();if(sub){await api('POST','/push/unsubscribe',{endpoint:sub.endpoint}).catch(()=>{});await sub.unsubscribe()}pushUi.on=false};
 watch(()=>tab.value,t=>{if(t==='ssec'){pushInit();loadDev()}});
 /* mở từ thông báo đẩy: ?chat=<id> -> mở khung chat; ?n=... -> mở danh sách thông báo */
 const deepLink=async url=>{try{const q=new URL(url,location.origin).searchParams,c=q.get('chat');if(!authed.value)return;if(c){const u=await api('GET','/users/'+c);openChat({id:c,n:u.name})}else if(q.get('n')){go('notifications');ntPage(1,true)}}catch(e){}};
 if(/[?&](chat|n)=/.test(location.search)){const u=location.href;history.replaceState(null,'',location.pathname);let tries=0;const t=setInterval(()=>{if(authed.value||++tries>20){clearInterval(t);if(authed.value)deepLink(u)}},500)}
 if('serviceWorker' in navigator)navigator.serviceWorker.addEventListener('message',e=>{if(e.data&&e.data.type==='open')deepLink(e.data.url)});
 /* bấm @tên_đăng_nhập trong bài / bình luận -> mở hồ sơ */
 document.addEventListener('click',async e=>{const a=e.target.closest&&e.target.closest('a.mt');if(!a)return;e.preventDefault();try{const u=await api('GET','/users/by-username/'+encodeURIComponent(a.dataset.mu));openUser(u.id)}catch(err){alert(err.message)}});
 const fxCls=fx=>[(fx&&fx.color?'fx-color':''),(fx&&fx.flicker?'fx-flicker':'')].filter(Boolean).join(' ');
 const fxIcon=fx=>(fx&&fx.icon?'⭐ ':'');
 return{pushUi,pushOn,pushOff,sq,sN,sGo,sPick,evNav,poNav,foNav,vdNav,qzNav,pgNav,favNav,pfx,pfxLoad,pfxAdd,pfxDel,forumAdd,forumToggle,giftAdd,giftToggle,anncAdd,anncToggle,newsAdd,newsSend,faqAdd,contactView,anncs,MODES,dmode,setMode,ACS,acc:accEff,setAcc,rc,redial,dismissRc,IGI,cmpOpen,igHide,igSugs,igFind,igStats,igTabs,igNav,igGo,shareProfile,inv,invCheck,fx,fxCount,Fshow,puG,sugSecs,fxList,fxSub,fxPage,sugReq,setG,fxMove,fxToggle,fxRen,fxRenSave,fxHide,fxRandom,newIv,sendIvEmail,delIv,ivLink,copyIv,nt,np,nj,npGroups,ntToggle,ntGo,ntPage,ntDel,ntDelD,ntClear,adm,admLoad,admOpen,admAct,admDel,admStats,admTab,rpLoad,rpAct,ugSet,ugLoad,dlBackup,ax,MODKINDS,mcToggle,mcDel,evcAdd,evcRen,evcDel,tgMerge,tgDel,tpAdd,tpEdit,tpSave,tpDel,tpLoad,TH,toTop,cronLoad,cronRun,thmLoad,thmSave,thmToggle,thAdm,mgLoad,mgSave,mgToggle,mgLog,mxLoad,mxDel,cxLoad,cxAdd,cxDel,crLoad,crSaveRule,crSaveTask,crSaveClicks,hotLoad,hotAdd,hotDel,ipLoad,ipAdd,ipDel,lgLoad,cfLoad,cfSave,grLoad,grAdd,grSave,grDel,admCards,admCharts,av,pickAv,rmAv,cv,pickCv,rmCv,cvBox,phv,openPv,closePv,pvPick,pvRemove,cvReposStart,cvReposDown,cvReposMove,cvReposUp,cvReposSave,gr,ga,gCat,gTabs,gT,GN,GFT,GTABS,gGo,gLoad,gBack,gOpen,gThreads,gTab,gMembers,gSetGrade,gJoin,gLeave,gCreate,gSave,gImgErr,gDelGroup,gInviteLoad,gInviteSend,gInvAcc,gInvDec,gOpenThread,gPostThread,gReply,gEditStart,gEditSave,gDelPost,gFlag,gaEdit,gaSave,gaDel,gaOrder,uid,pf,pa,paEdit,paSave,paDel,paOrder,tagV,openTag,tagLoad,puCover,tryCall,rtErr,rv,lv,toggleCam,flipCam,call,fmtSecs,startCall,answerCall,rejectCall,endCall,toggleMute,onl,typing,rtOn,vis,att,pu,puFeed,fmtDate,fmtBirth,openUser,backFromUser,mm,mmItems,mmGo,mBack,mTitle,userAct,blockU,unblockU,reportU,fp,openFp,closeFp,fpSend,fpReset,acct,sg,fxCls,fxIcon,saveSg,sendVerify,tfa,openTfa,closeTfa,doTfa,blk,loadBlk,pv,pvTab,setPrivacy,pw,chPw,dev,loadDev,revokeDev,revokeOthers,tfa2,tfaSetup,tfaEnable,tfaCloseSetup,tfaDisable,tfaNewBackup,fxCls,fxIcon,unblockId,unhideId,setMood,setFeedPref,blkTab,loadMoods,vf,doVerify,resend,closeVf,booting,fr,fsq,found,onFind,reqF,accF,delF,closeChat,siteCfg,busy,me,authed,mode,err,f,t,srv,show,er,sc,sw,enter,login,register,logout,IMG,view,tab,q,sf,fq,draft,st,cm,F,posts,mine,feed,mineFeed,more,busyM,first,loadMore,del,online,sug,go,pub,emoPick,checkIn,chat,openChat,sendChat,gb,gift,gbTxt,sendGb,pk,PK,pkImg,th,THL,themed,cover,swStyle,openTheme,saveTheme,ago,openPoke,closePoke,sendPoke,ignorePoke,pkFriend,
  nav:computed(()=>[{l:'Trang chủ',i:'home',v:'home'},{l:'Lời mời kết bạn',i:'bell',b:fr.incoming.length,t:'bb'},{l:'Tin nhắn',i:'chat',b:fr.unread,t:'bb'},{l:'Chọc',e:'👋',b:pk.list.length,t:'ch'},{l:'Nhóm',e:'👥',b:gr.invN,v:'groups'}]),
  bnav:computed(()=>[{l:'Trang chủ',i:'home',v:'home'},{l:'Tin nhắn',i:'chat',t:'bb',b:fr.unread},{plus:1},{l:'Lời mời',i:'bell',t:'bb',b:fr.incoming.length},{l:'Cá nhân',i:'user',v:'profile'}]),
  menu,
  TB:[['nk','📝 Bài viết'],['bl','📓 Nhật ký'],['gt','ℹ️ Giới thiệu'],['bb','👥 Bạn bè'],['al','🖼️ Album'],['ch','👋 Chọc'],['lb','🎁 Lưu bút']],
  info,
  gifts:['🎁','🌹','🍰','🧸'],
};
}});

export { app };
