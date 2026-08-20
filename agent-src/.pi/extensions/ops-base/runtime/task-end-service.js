"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

class TaskEndService {
  constructor({ taskStore, workspaceRoot, run = (file, args) => execFileSync(file, args, { cwd: workspaceRoot, encoding: "utf8" }) }) { this.taskStore=taskStore;this.workspaceRoot=workspaceRoot;this.run=run; }
  async recoverAll() {
    const tasks = await this.taskStore.scanNonEndedTasks();
    const results = [];
    for (const state of tasks) {
      const effect = state.control?.pendingEffect;
      if (!effect || effect.kind === "CREATE_PR") { results.push({ taskId: state.taskId, kind: "restored" }); continue; }
      try {
        const next = await this.taskStore.transitionState(state.taskId, state.documentRevision, "ERROR", (draft) => { draft.control.pendingEffect = { ...effect, stage: "MANUAL_RECONCILIATION_REQUIRED", reason: "启动恢复遇到未知副作用" }; return draft; });
        results.push({ taskId: state.taskId, kind: "error", state: next });
      } catch (error) { results.push({ taskId: state.taskId, kind: "manual", error: error.message }); }
    }
    return results;
  }
  async end(taskId) {
    let state=await this.taskStore.readTask(taskId);
    if(state.lifecycle.state==="ENDED") return {state,idempotent:true};
    const merged=await this.isMerged(state);
    if(merged) { state=await this.to(state,"MERGED"); return this.clean(state,"merged"); }
    state=await this.to(state,"CANCELLING");
    const hasWorkspaceChange=Boolean(state.execution?.workspaceCandidateSha256);
    if(state.submission?.prUrl) { this.run("gh",["pr","close",state.submission.prUrl]); state=await this.taskStore.updateState(taskId,state.documentRevision,d=>{d.submission={...d.submission,status:"CLOSED_BY_END"};return d;}); }
    if(hasWorkspaceChange) { state=await this.to(state,"RESTORING"); const baseline=await this.taskStore.readBaseline(taskId); this.run("git",["checkout","main"]); await fs.writeFile(path.join(this.workspaceRoot,"public","data.json"),`${JSON.stringify(baseline.baseline,null,2)}\n`); state=await this.taskStore.updateState(taskId,state.documentRevision,d=>{d.execution.workspaceCandidateSha256=null;d.control.pendingEffect=null;return d;}); }
    return this.clean(state,hasWorkspaceChange?"restored":"no_workspace_change");
  }
  async isMerged(state) { if(state.lifecycle.state==="MERGED") return true;if(!state.submission?.prUrl)return false;try { const x=JSON.parse(String(this.run("gh",["pr","view",state.submission.prUrl,"--json","mergedAt"])||"{}"));return Boolean(x.mergedAt); } catch { return false; } }
  async to(state,target) { if(state.lifecycle.state===target)return state; const paths={MERGED:["AWAITING_MERGE","MERGING","MERGED"],CANCELLING:["CANCELLING"],RESTORING:["RESTORING"]};for(const next of paths[target]||[]) { if(state.lifecycle.state===next)continue;state=await this.taskStore.transitionState(state.taskId,state.documentRevision,next); }return state; }
  async clean(state,reason) { if(state.lifecycle.state!=="CLEANING") state=await this.taskStore.transitionState(state.taskId,state.documentRevision,"CLEANING"); state=await this.taskStore.updateState(state.taskId,state.documentRevision,d=>{d.cleanup={...(d.cleanup||{}),status:"COMPLETED",completedAt:new Date().toISOString(),reason};return d;}); return {state:await this.taskStore.transitionState(state.taskId,state.documentRevision,"ENDED"),idempotent:false}; }
}
module.exports={TaskEndService};
