/* ---------- standalone copy: no GitHub, no sign-in ---------- */
// This copy of the board edits the same store as the one in iHelp Ops, but it
// has no session and no GitHub token, so it cannot read where a started task
// is. A row with `issue` set follows its GitHub issue in Ops; here it is marked
// as such, its status and assignee are not editable, and the server drops a
// typed status or assignee for it anyway (api/board.js).
const ISSUE=/^([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)#(\d+)$/;
const linkOf=t=>t&&ISSUE.test(t.issue||"")?t.issue:null;
const pendingOf=t=>!!(t&&/^pending:/.test(t.issue||""));
function applyLive(){}
function revertLinked(){
  if(!B)return;
  S.tasks.forEach(t=>{
    if(!linkOf(t)&&!pendingOf(t))return;
    const b=B.t.get(t.id); if(!b)return;
    if(t.status!==b.status||sv(t.assignee)!==sv(b.assignee)){
      t.status=b.status;t.assignee=b.assignee;
      toast(`${t.id} is ${linkOf(t)||"being started as a GitHub issue"}. Its column and assignee follow GitHub and are changed in iHelp Ops.`);
    }
  });
}
function opsBoot(){new MutationObserver(decorate).observe(document.body,{childList:true,subtree:true});decorate();}
function decorate(){
  document.querySelectorAll(".tcard[data-id]:not([data-ops])").forEach(c=>{
    c.dataset.ops="1"; const t=byId(c.dataset.id); if(!t||(!linkOf(t)&&!pendingOf(t)))return;
    c.setAttribute("draggable","false");
    const ref=linkOf(t), m=c.querySelector(".meta");
    if(m)m.insertAdjacentHTML("afterbegin",`<span class="tag ops" title="${esc(ref?"Follows "+ref+" in iHelp Ops. The column shown here may be out of date.":"Being started in iHelp Ops")}">${ref?esc("#"+ref.split("#")[1])+" in Ops":"Starting…"}</span>`);
  });
  document.querySelectorAll("select[data-f=status][data-id]:not([data-ops]),input[data-f=assignee][data-id]:not([data-ops])").forEach(el=>{
    el.dataset.ops="1"; const t=byId(el.dataset.id);
    if(t&&(linkOf(t)||pendingOf(t))){el.disabled=true;el.title="Follows "+(linkOf(t)||"its GitHub issue")+" in iHelp Ops";}
  });
  const dr=document.querySelector(".drawer"), t=dr&&byId(ui.open);
  if(dr&&t&&(linkOf(t)||pendingOf(t))&&!dr.querySelector(".opsbox")){
    ["status","assignee"].forEach(k=>{const el=dr.querySelector(`[data-k=${k}]`);if(el){el.disabled=true;el.title="Follows the GitHub issue";}});
    const del=dr.querySelector("#dDel"); if(del)del.hidden=true;
    const title=dr.querySelector(".dr-title"), ref=linkOf(t);
    if(title)title.insertAdjacentHTML("afterend",`<div class="opsbox"><b>Started in iHelp Ops</b>${ref?` as <a href="https://github.com/${esc(ISSUE.exec(ref)[1])}/issues/${esc(ISSUE.exec(ref)[2])}" target="_blank" rel="noopener">${esc(ref)}</a>`:""}. Its column follows GitHub — branch, pull request, review, merge — and this copy of the board can't read that, so the column shown here may be out of date. Open the board in iHelp Ops for where it actually is.</div>`);
  }
}
