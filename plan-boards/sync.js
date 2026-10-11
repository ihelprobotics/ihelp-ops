/* ---------- live sync (Vercel + Redis) ---------- */
// API (this board's store endpoint) is defined by build.py ahead of this file.
let signedOut=false;
let B=null, rev=null, queue=[], inflight=false, syncErr=false, writeSeq=0, renderLater=false, pollT=null, retryMs=2000;
const snap=x=>JSON.parse(JSON.stringify(x));
const sv=v=>String(v==null?"":v);
async function api(method,body,q,path){
  const r=await fetch((path||API)+(q||""),{method,headers:body?{"Content-Type":"application/json"}:{},body:body?JSON.stringify(body):undefined,cache:"no-store"});
  // A lapsed session is redirected to the sign-in page, which fetch follows.
  if(r.status===401||(r.redirected&&/\/login/.test(r.url))){signedOut=true;renderTop();throw new Error("You are signed out of iHelp Ops. Reload the page to sign in again.");}
  let j=null; try{j=await r.json();}catch(e){}
  if(!r.ok){const e=new Error((j&&j.error)||("The server answered "+r.status+"."));e.status=r.status;e.body=j;throw e;}
  return j;
}
function diffKind(kind,list,base){
  const seen=new Set();
  list.forEach(x=>{
    seen.add(x.id); const b=base.get(x.id);
    if(!b){const f=Object.assign({},x);delete f.id;queue.push({op:"patch",kind,id:x.id,create:true,order:Date.now()+queue.length,fields:f});base.set(x.id,snap(x));return;}
    const f={};let n=0;
    Object.keys(x).forEach(k=>{if(k!=="id"&&sv(x[k])!==sv(b[k])){f[k]=x[k];n++;}});
    if(n){queue.push({op:"patch",kind,id:x.id,fields:f});Object.assign(b,f);}
  });
  [...base.keys()].forEach(id=>{if(!seen.has(id)){queue.push({op:"del",kind,id});base.delete(id);}});
}
function syncQueue(){
  revertLinked();
  diffKind("t",S.tasks,B.t); diffKind("d",S.decisions,B.d);
  if(queue.length){writeSeq++;flush();}
  renderTop();
}
function reId(op){
  if(op.kind!=="t"){B.d.delete(op.id);return;}
  const t=byId(op.id); B.t.delete(op.id); if(!t)return;
  const pref=op.id.split("-")[0]; let n=+op.id.split("-")[1]||1, id;
  do{n++;id=pref+"-"+String(n).padStart(2,"0");}while(byId(id));
  t.id=id; toast(`${op.id} was just taken by someone else. Your task is now ${id}.`);
  if(ui.open===op.id)openTask(id); else renderMain();
  syncQueue();
}
async function flush(){
  if(inflight||!queue.length)return;
  inflight=true; const ops=queue.splice(0,100); renderTop();
  let r;
  try{ r=await api("POST",{ops}); }
  catch(e){
    queue=ops.concat(queue); syncErr=true; renderTop();
    setTimeout(()=>{inflight=false;flush();},retryMs); retryMs=Math.min(retryMs*2,30000); return;
  }
  syncErr=false; retryMs=2000; inflight=false; writeSeq++;
  (r.results||[]).forEach((res,i)=>{
    if(!res.ok&&res.error==="id_taken")reId(ops[i]);
    if(!res.ok&&res.error==="linked"){rev=null;toast(`${ops[i].id} is started in Ops as a GitHub issue, so it can't be deleted here. Close the issue instead.`);}
  });
  if(queue.length)flush(); else {renderTop(); poll();}
}
function mergeList(list,remote){
  const byid=new Map(list.map(x=>[x.id,x])); let any=remote.length!==list.length;
  const out=remote.map((rx,i)=>{
    const lx=byid.get(rx.id);
    if(!lx){any=true;return rx;}
    Object.keys(rx).forEach(k=>{if(sv(lx[k])!==sv(rx[k])){lx[k]=rx[k];any=true;}});
    if(list[i]!==lx)any=true;
    return lx;
  });
  list.length=0; out.forEach(x=>list.push(x));
  return [any,new Map(out.map(x=>[x.id,snap(x)]))];
}
function busy(){const a=document.activeElement;return !!document.querySelector(".drawer")||!!(a&&a.closest&&a.closest("#main")&&a.matches("input,textarea,select"));}
function applyRemote(r){
  const [a,bt]=mergeList(S.tasks,r.tasks||[]), [b,bd]=mergeList(S.decisions,r.decisions||[]);
  B={t:bt,d:bd};
  applyLive();
  if(ui.open&&!byId(ui.open)){closeDrawer();toast("That task was deleted by someone else.");return;}
  if(a||b)renderLater=true;
}
function schedule(){clearTimeout(pollT);pollT=setTimeout(poll,document.hidden?30000:4000);}
async function poll(){
  clearTimeout(pollT);
  if(queue.length||inflight){schedule();return;}
  const seq=writeSeq;
  try{
    const r=await api("GET",null,rev!=null?"?rev="+rev:"");
    syncErr=false;
    if(!r.unchanged&&seq===writeSeq&&!queue.length&&!inflight){applyRemote(r);rev=r.rev;}
  }catch(e){syncErr=true;}
  if(renderLater&&!busy()){renderLater=false;renderMain();}
  renderTop(); schedule();
}
function restoreDraftLive(state){
  const orig=JSON.parse(raw);
  [["tasks"],["decisions"]].forEach(([k])=>{
    const om=new Map((orig[k]||[]).map(x=>[x.id,x])), dm=new Map((state[k]||[]).map(x=>[x.id,x]));
    (state[k]||[]).forEach(x=>{
      const o=om.get(x.id), cur=S[k].find(y=>y.id===x.id);
      if(!o){if(!cur)S[k].push(snap(x));return;}
      if(!cur)return;
      Object.keys(x).forEach(f=>{if(sv(x[f])!==sv(o[f]))cur[f]=x[f];});
    });
    om.forEach((o,id)=>{if(!dm.has(id))S[k]=S[k].filter(y=>y.id!==id);});
  });
}
async function goLive(){
  try{
    let r=await api("GET");
    if(!r.seeded){const seed=JSON.parse(raw);await api("POST",{seed:{tasks:seed.tasks,decisions:seed.decisions}});r=await api("GET");}
    if(dirty){staleDraft={state:S};dirty=false;}
    const base=JSON.parse(raw); base.tasks=[]; base.decisions=[]; S=base;
    applyRemote(r); rev=r.rev; renderLater=false;
    writeMode="live"; const eb=$("#expBtn"); if(eb)eb.hidden=false;
    renderTop(); renderNotices(); renderMain(); schedule(); opsBoot();
  }catch(e){writeMode="local";renderTop();renderNotices();opsBoot();}
}
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&writeMode==="live")poll();});
window.addEventListener("beforeunload",e=>{if(writeMode==="live"&&(queue.length||inflight)){e.preventDefault();e.returnValue="";}});
