/* ---------- iHelp Ops: tasks started as GitHub issues ---------- */
// A task with `issue` set (owner/name#n) is a GitHub issue now. Its column and
// assignee are derived by Ops from GitHub and can't be typed here; the server
// drops a typed status or assignee for it too.
//
// Assigning a planned task is how it becomes an issue: the issue opens with
// that person on it. A typed name on a planning row would be a second answer to
// "who has this" next to GitHub's, so the assignee field is not typed here.
const ISSUE=/^([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)#(\d+)$/;
let GH_LIVE={}, liveErr="", START=null, startErr={}, starting=null, BULK=null;
const linkOf=t=>t&&ISSUE.test(t.issue||"")?t.issue:null;
const pendingOf=t=>!!(t&&/^pending:/.test(t.issue||""));
function applyLive(){
  S.tasks.forEach(t=>{
    const l=GH_LIVE[t.id]; if(!linkOf(t)||!l)return;
    const b=B&&B.t.get(t.id);
    if(l.column){t.status=l.column;if(b)b.status=l.column;}
    if(l.assignee!==undefined){const a=l.assignee||"";t.assignee=a;if(b)b.assignee=a;}
  });
}
function revertLinked(){
  if(!B)return;
  S.tasks.forEach(t=>{
    if(!linkOf(t)&&!pendingOf(t))return;
    const b=B.t.get(t.id); if(!b)return;
    if(t.status!==b.status){t.status=b.status;toast(`${t.id} follows ${linkOf(t)||"its GitHub issue"}, so its column can't be changed here.`);}
    if(sv(t.assignee)!==sv(b.assignee)){t.assignee=b.assignee;toast(`${t.id} follows ${linkOf(t)||"its GitHub issue"}. Assign it from its drawer.`);}
  });
}
async function pollLive(){
  clearTimeout(pollLive.t);
  try{const r=await api("GET",null,"",OPS_API+"/live");GH_LIVE=r.live||{};liveErr="";}
  catch(e){liveErr=e.message;}
  // The Done buttons change when the merge record or a read error arrives,
  // even if no column moves, so those are part of what triggers a redraw.
  const sig=()=>S.tasks.map(t=>{const l=GH_LIVE[t.id];return t.status+"/"+t.assignee+"/"+(l?(l.merged&&l.merged.pr)||l.error||"-":"")}).join("|")+liveErr, before=sig();
  applyLive();
  if(sig()!==before){if(busy())renderLater=true;else renderMain();}
  refreshDrawer();
  pollLive.t=setTimeout(pollLive,document.hidden?120000:45000);
}
async function opsBoot(){
  try{START=await api("GET",null,"",OPS_API+"/start");}
  catch(e){START={repos:[],people:[],canStart:false,why:e.message};}
  new MutationObserver(decorate).observe(document.body,{childList:true,subtree:true});
  decorate(); pollLive();
}
function liveTag(t){
  if(pendingOf(t))return `<span class="tag ops">Starting…</span>`;
  const ref=linkOf(t); if(!ref)return "";
  const l=GH_LIVE[t.id], n="#"+ref.split("#")[1];
  return `<span class="tag ops" title="${esc(ref)}">${esc(n)}${l&&l.progress!=null?` · ${l.progress}%`:""}</span>`;
}
function decorate(){
  const bar=document.querySelector(".topbar");
  if(bar&&!bar.querySelector(".opshome")){
    const a=document.createElement("a");a.className="btn ghost opshome";a.href="/";a.textContent="← iHelp Ops";
    bar.insertBefore(a,bar.firstChild);
  }
  if(bar&&START&&START.canPlan&&writeMode==="live"&&!bar.querySelector("#opsBulk")){
    const b=document.createElement("button");b.className="btn";b.id="opsBulk";b.textContent="Make issues";
    b.title="Open a GitHub issue for every planned task in the current filter";
    b.onclick=()=>{BULK=BULK&&!BULK.running?null:BULK||{};renderBulk();};
    const add=bar.querySelector("#addBtn"); bar.insertBefore(b,add||null);
  }
  document.querySelectorAll(".tcard[data-id]:not([data-ops])").forEach(c=>{
    c.dataset.ops="1"; const t=byId(c.dataset.id); if(!t)return;
    if(t.status==="Done")doneLinks(c,t);
    if(!linkOf(t)&&!pendingOf(t))return;
    c.setAttribute("draggable","false"); c.classList.add("linked");
    const m=c.querySelector(".meta"); if(m)m.insertAdjacentHTML("afterbegin",liveTag(t));
  });
  document.querySelectorAll("select[data-f=status][data-id]:not([data-ops])").forEach(el=>{
    el.dataset.ops="1"; const t=byId(el.dataset.id);
    if(t&&(linkOf(t)||pendingOf(t))){el.disabled=true;el.title="Follows "+(linkOf(t)||"its GitHub issue");}
  });
  if(writeMode==="live")document.querySelectorAll("input[data-f=assignee][data-id]:not([data-ops])").forEach(el=>{
    el.dataset.ops="1"; const t=byId(el.dataset.id); el.disabled=true;
    el.title=t&&linkOf(t)?"Follows "+linkOf(t)+". Open the task to reassign it.":"Open the task to assign it. Assigning opens its GitHub issue.";
  });
  const dr=document.querySelector(".drawer");
  if(dr&&!dr.querySelector(".opsbox"))fillDrawer(dr);
  // The filters changed under an open Make issues panel: recount. Guarded by
  // the count, so this observer callback does not feed itself.
  if(BULK&&!BULK.running&&!BULK.done&&bulkTargets().length!==BULK.shown)renderBulk();
}
// A Done card links to the work that finished it: the merge commit and the
// pull request, from the merge Ops recorded. Ops never commits or pushes from
// the web (docs/06), so these open GitHub. When there is nothing to open, the
// buttons stay visible and say why.
function doneWhy(t){
  const ref=linkOf(t), l=GH_LIVE[t.id];
  if(!ref)return "This task was never started in Ops, so no commit or pull request is on record for it.";
  if(!l)return liveErr?"GitHub can't be read right now: "+liveErr:"Reading from GitHub…";
  if(l.error)return "GitHub can't be read for "+ref+": "+l.error;
  if(!l.merged)return "No merged pull request is on record for "+ref+". It was closed without one, or merged before Ops received GitHub's events.";
  return "";
}
// The same reasons, short enough to sit under every Done card.
function doneShort(t){
  const ref=linkOf(t), l=GH_LIVE[t.id];
  if(!ref)return "Not started in Ops, so no commit or PR is on record.";
  if(!l)return liveErr?"GitHub can't be read right now.":"Reading from GitHub…";
  if(l.error)return "GitHub can't be read for "+ref+".";
  return "No merged PR on record for "+ref+".";
}
function doneLinks(c,t){
  const l=GH_LIVE[t.id], m=l&&!l.error&&l.merged, why=doneWhy(t), repo=(linkOf(t)||"").split("#")[0];
  const commit=m&&m.commit?`https://github.com/${repo}/commit/${m.commit}`:null;
  const btn=(href,label,miss)=>href?`<a class="btn opsgo" href="${esc(href)}" target="_blank" rel="noopener">${label}</a>`
    :`<button type="button" class="btn opsgo" disabled title="${esc(miss)}">${label}</button>`;
  const box=document.createElement("div"); box.className="opsdone";
  box.innerHTML=btn(commit,"View commit",why||"The merge is on record but GitHub did not say which commit it made.")+btn(m?m.pr:null,"View PR",why)+
    (why?`<span class="opsdone-why" title="${esc(why)}">${esc(doneShort(t))}</span>`:"");
  // Opening a link must not also open the card's drawer, and Enter on a link
  // must not be swallowed by the card's own keyboard handler.
  box.onclick=e=>e.stopPropagation(); box.onkeydown=e=>e.stopPropagation();
  c.appendChild(box);
}
function refreshDrawer(){const b=document.querySelector(".drawer .opsbox");if(b){b.remove();decorate();}}
function ghUrl(ref){const m=ISSUE.exec(ref);return m?`https://github.com/${m[1]}/issues/${m[2]}`:"#";}
function opsHref(ref){const m=ISSUE.exec(ref);return m?`/task/${m[1]}/${m[2]}`:"/";}
function personLabel(login){const p=(START&&START.people||[]).find(x=>x.login.toLowerCase()===String(login).toLowerCase());return p&&p.name?`${p.name} (@${p.login})`:"@"+login;}
// Who this person may put on a task: anyone, for a lead; otherwise only themselves.
function peopleOptions(sel){
  const s=START||{}, me=s.login, list=s.assignsOthers?(s.people||[]):(s.people||[]).filter(p=>me&&p.login.toLowerCase()===me.toLowerCase());
  return list.map(p=>`<option value="${esc(p.login)}"${sel&&p.login.toLowerCase()===sel.toLowerCase()?" selected":""}>${esc(p.name?`${p.name} (@${p.login})`:"@"+p.login)}</option>`).join("");
}
function fillDrawer(dr){
  const t=byId(ui.open); if(!t)return;
  const title=dr.querySelector(".dr-title"); if(!title)return;
  const box=document.createElement("div"); box.className="opsbox";
  const ref=linkOf(t), l=GH_LIVE[t.id], s=START||{repos:[],people:[]}, err=startErr[t.id];
  const asg=dr.querySelector("[data-k=assignee]");
  if(asg&&writeMode==="live"){asg.disabled=true;asg.title=ref?"Follows the GitHub issue. Reassign it below.":"Assign it below. Assigning opens its GitHub issue.";}
  if(ref||pendingOf(t)){
    const st=dr.querySelector("[data-k=status]"); if(st){st.disabled=true;st.title="Follows the GitHub issue";}
    const del=dr.querySelector("#dDel"); if(del)del.hidden=true;
  }
  if(ref){
    const who=l&&l.assignee!==undefined?l.assignee:null, mine=!!(who&&s.login&&who.toLowerCase()===s.login.toLowerCase());
    const canPick=!!(s.assignsOthers||(!who&&s.login));
    box.innerHTML=`<div class="opshead"><b>Started in Ops</b> as <a href="${esc(opsHref(ref))}">${esc(ref)}</a></div>`+
      (l&&l.error?`<p class="opserr">Its status can't be read right now: ${esc(l.error)}</p>`
       :l?`<p>${esc(l.stage)}${l.progress!=null?` (${l.progress}%)`:""}. The column follows GitHub: branch, pull request, review, merge. Nobody sets it by hand.</p>`
       :liveErr?`<p class="opserr">Status unavailable: ${esc(liveErr)}</p>`:`<p class="muted">Reading its status from GitHub…</p>`)+
      (l&&!l.error?`<p><b>Assigned to:</b> ${who?esc(mine?"you":personLabel(who)):"nobody yet"}</p>`:"")+
      (l&&!l.error&&canPick?`<div class="opsrow"><select class="field" id="opsWho" aria-label="Assign to">${s.assignsOthers?`<option value="">Nobody</option>`:""}${peopleOptions(who||s.login)}</select>
        <button class="btn primary" id="opsAssign"${starting?" disabled":""}>${starting===t.id?"Assigning…":"Assign"}</button></div>`:"")+
      (l&&!l.error&&mine&&!s.assignsOthers?`<div class="opsrow"><button class="btn" id="opsRelease">Hand it back</button></div>`:"")+
      (err?`<p class="opserr">${esc(err)}</p>`:"")+
      (l&&!l.error&&l.merged?`<p><b>Merged:</b> <a href="${esc(l.merged.pr)}" target="_blank" rel="noopener">pull request</a>${l.merged.commit?` · <a href="https://github.com/${esc(ref.split("#")[0])}/commit/${esc(l.merged.commit)}" target="_blank" rel="noopener">commit ${esc(l.merged.commit.slice(0,7))}</a>`:""}</p>`:"")+
      `<p class="small"><a href="${esc(opsHref(ref))}">Open the task in Ops</a> to put an agent on it or see the evidence. · <a href="${esc(ghUrl(ref))}" target="_blank" rel="noopener">View on GitHub</a></p>`;
  }else if(pendingOf(t)){
    box.innerHTML=`<div class="opshead"><b>Being started in Ops…</b></div><p class="muted">The GitHub issue is being opened. This updates in a moment.</p>`;
  }else{
    const can=!!(s.canStart&&writeMode==="live"&&s.repos.length);
    box.innerHTML=`<div class="opshead"><b>Assign and start in Ops</b></div>
      <p>Opens a GitHub issue from this task${s.assignsOthers?", with the person you pick on it":", with you on it"}. From then on it shows on the Ops board, an agent can be put on it, and its column here follows the issue.</p>
      ${!START?`<p class="muted">Checking what you can start…</p>`:!s.canStart?`<p class="opserr">${esc(s.why||"You can't start tasks.")}</p>`:writeMode!=="live"?`<p class="opserr">The shared board isn't reachable, so this can't be linked. Reload to try again.</p>`:""}
      <div class="opsrow"><select class="field" id="opsWho" aria-label="Assign to"${can?"":" disabled"}>${peopleOptions(s.login)}<option value="">Nobody yet</option></select></div>
      <div class="opsrow"><select class="field" id="opsRepo" aria-label="Repository"${can?"":" disabled"}>${(s.repos||[]).map(r=>`<option${r===s.suggested?" selected":""}>${esc(r)}</option>`).join("")}</select>
      <button class="btn primary" id="opsStart"${can&&!starting?"":" disabled"}>${starting===t.id?"Starting…":"Open the issue"}</button></div>
      ${s.canStart&&!s.assignsOthers?`<p class="small muted">Only a lead, the CTO or the founder can give a task to somebody else.</p>`:""}
      ${err?`<p class="opserr">${esc(err)}</p>`:""}`;
  }
  title.insertAdjacentElement("afterend",box);
  const go=box.querySelector("#opsStart"); if(go)go.onclick=()=>startInOps(t.id,box.querySelector("#opsRepo").value,box.querySelector("#opsWho").value);
  const as=box.querySelector("#opsAssign"); if(as)as.onclick=()=>assignLinked(t.id,box.querySelector("#opsWho").value||null);
  const rl=box.querySelector("#opsRelease"); if(rl)rl.onclick=()=>assignLinked(t.id,null);
}
async function startInOps(id,repo,to){
  if(!byId(id)||starting)return;
  starting=id; delete startErr[id]; refreshDrawer();
  // Unsaved edits to the title or text go first, so the issue carries them.
  const a=document.activeElement; if(a&&a.matches&&a.matches(".drawer [data-k]"))a.dispatchEvent(new Event("change"));
  await new Promise(r=>{const w=()=>queue.length||inflight?setTimeout(w,150):r();w();});
  let ref=null;
  try{
    const r=await api("POST",{id,repo,to:to||null},"",OPS_API+"/start");ref=r.issue;
    if(r.assignError)startErr[id]=`${ref} is open, but nobody is on it: ${r.assignError}`;
    toast(r.assignee?`${id} is ${ref}, assigned to @${r.assignee}.`:`${id} started as ${ref}.`);
  }catch(e){
    if(e.status===409&&e.body&&e.body.issue){ref=e.body.issue;toast(e.message);}
    else startErr[id]=e.message;
  }
  starting=null;
  if(ref){const x=byId(id);if(x){x.issue=ref;const b=B&&B.t.get(id);if(b)b.issue=ref;}}
  if(!busy())renderMain(); refreshDrawer(); poll(); pollLive();
}
async function assignLinked(id,to){
  const t=byId(id), m=ISSUE.exec(linkOf(t)||""); if(!m||starting)return;
  starting=id; delete startErr[id]; refreshDrawer();
  try{const r=await api("POST",{action:"assign",to},"",`/api/tasks/${m[1]}/${m[2]}`);toast(r.message||"Assigned.");}
  catch(e){startErr[id]=e.message;}
  starting=null; refreshDrawer(); pollLive();
}

/* ---------- Make issues: every planned task in the current filter ---------- */
// For leads (the server checks too). Deferred, Existing and typed-Done rows
// are left alone: none of them is work anybody is about to do.
function bulkTargets(){return filtered().filter(t=>!linkOf(t)&&!pendingOf(t)&&!["Deferred (v1.1)","Existing","Done"].includes(t.status));}
function renderBulk(){
  let el=$("#opsBulkPanel");
  if(!BULK){if(el)el.remove();return;}
  if(!el){el=document.createElement("div");el.id="opsBulkPanel";el.className="notice opsbulk";const n=$("#notices");n.insertAdjacentElement("afterend",el);}
  const s=START||{repos:[]}, list=bulkTargets(), b=BULK; b.shown=list.length;
  const scope=[ui.epic&&epicName(ui.epic),ui.status,ui.q&&`matching "${ui.q}"`].filter(Boolean).join(", ");
  if(b.running||b.done){
    const fails=(b.results||[]).filter(r=>r.error&&!r.issue);
    el.innerHTML=`<span><b>${b.running?"Opening issues…":"Done."}</b> ${b.ok||0} of ${b.total} opened${b.skipped?`, ${b.skipped} already started`:""}${fails.length?`, ${fails.length} not opened`:""}.</span>
      ${b.stopped?`<span class="opserr">Stopped: ${esc(b.stopped)}</span>`:""}
      ${fails.length&&!b.stopped?`<span class="opserr">${fails.slice(0,5).map(f=>esc(f.id+": "+f.error)).join(" · ")}</span>`:""}
      <span class="spacer"></span>${b.running?"":`<button class="btn ghost" id="opsBulkClose">Close</button>`}`;
  }else{
    el.innerHTML=`<span>Open a GitHub issue for <b>${list.length}</b> planned ${list.length===1?"task":"tasks"}${scope?` in this filter (${esc(scope)})`:" on the whole board"}. Each lands on the Ops board unassigned; deferred, existing and done rows are skipped.</span>
      <select class="field" id="opsBulkRepo" aria-label="Repository">${(s.repos||[]).map(r=>`<option${r===s.suggested?" selected":""}>${esc(r)}</option>`).join("")}</select>
      <button class="btn primary" id="opsBulkGo"${list.length&&s.repos.length?"":" disabled"}>Open ${list.length} ${list.length===1?"issue":"issues"}</button>
      <button class="btn ghost" id="opsBulkClose">Cancel</button>`;
    const g=$("#opsBulkGo"); if(g)g.onclick=()=>runBulk(list.map(t=>t.id),$("#opsBulkRepo").value);
  }
  const c=$("#opsBulkClose"); if(c)c.onclick=()=>{BULK=null;renderBulk();};
}
async function runBulk(ids,repo){
  BULK={running:true,total:ids.length,ok:0,skipped:0,results:[]}; renderBulk();
  for(let i=0;i<ids.length&&!BULK.stopped;i+=10){
    let r;
    try{r=await api("POST",{ids:ids.slice(i,i+10),repo},"",OPS_API+"/start-many");}
    catch(e){BULK.stopped=e.message;break;}
    (r.results||[]).forEach(x=>{
      BULK.results.push(x);
      if(x.issue&&!x.error)BULK.ok++; else if(x.issue)BULK.skipped++;
      if(x.issue){const t=byId(x.id);if(t){t.issue=x.issue;const b=B&&B.t.get(x.id);if(b)b.issue=x.issue;}}
    });
    if(r.stopped)BULK.stopped=r.stopped;
    renderBulk();
  }
  BULK.running=false; BULK.done=true; renderBulk();
  toast(`${BULK.ok} ${BULK.ok===1?"issue":"issues"} opened.`);
  if(!busy())renderMain(); poll(); pollLive();
}
