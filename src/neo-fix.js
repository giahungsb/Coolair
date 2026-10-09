/* NEO: nếu CSS giao diện mới chưa áp dụng (--neo != 1) thì nạp lại neo.css một lần, sau Tailwind. Không hiển thị gì ra màn hình. */
(function(){
 function run(){var a=document.getElementById('app');if(!a||!a.classList.contains('neo'))return;
  if(getComputedStyle(a).getPropertyValue('--neo').trim()!=='1'&&!document.getElementById('neo-fix')){try{var l=document.createElement('link');l.rel='stylesheet';l.id='neo-fix';l.href='/neo.css?r='+Date.now();document.head.appendChild(l)}catch(x){}}}
 window.addEventListener('load',function(){setTimeout(run,800);setInterval(run,3000)});
})();

