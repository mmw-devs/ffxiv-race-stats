"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { TaskStore } = require("./task-store.js");
const { WorkspaceCandidateApplier, WorkspaceCandidateApplierError } = require("./workspace-candidate-applier.js");
const { ContentPrAdapter } = require("./content-pr-adapter.js");
const baseline = { teams: [{ id: "t1", phase: "P3", bossHP: 50, isLive: true }] };
const candidate = { teams: [{ id: "t1", phase: "P3", bossHP: 40, isLive: true }] };
const changes = [{ path: "teams[id=t1].bossHP", from: 50, to: 40, source: "ACTUAL" }];
async function fixture() {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"ops-apply-")), workspace=path.join(root,"workspace"); await fs.mkdir(path.join(workspace,"public"),{recursive:true}); await fs.writeFile(path.join(workspace,"public","data.json"),JSON.stringify(baseline));
 const store=new TaskStore({workspaceRoot:workspace,runtimeRoot:path.join(root,"runtime")});await store.initialize();let state=await store.createTask({lifecycleState:"VALIDATED",operator:{feishuOpenId:"ou_owner"},operation:{action:"updateTeam",target:{type:"team",id:"t1"},planHash:"sha256:plan",baselineDataSha256:"sha256:baseline",plannedChanges:changes}});
 state=await store.updateState(state.taskId,state.documentRevision,d=>{d.confirmations={execution:{status:"CONFIRMED",boundPlanHash:"sha256:plan"}};return d;});state=(await store.saveBaseline(state.taskId,state.documentRevision,baseline,"sha256:baseline")).state;state=(await store.saveCandidateData(state.taskId,state.documentRevision,candidate)).state;state=(await store.saveChangeRecord(state.taskId,state.documentRevision,{actualChanges:changes})).state;
 return {store,state,workspace,applier:new WorkspaceCandidateApplier({taskStore:store,workspaceRoot:workspace}),cleanup:()=>fs.rm(root,{recursive:true,force:true})};
}
test("正常 apply 写入 candidate 并登记 hash",async t=>{const e=await fixture();t.after(e.cleanup);const r=await e.applier.apply(e.state.taskId);assert.equal(r.idempotent,false);assert.deepEqual(JSON.parse(await fs.readFile(path.join(e.workspace,"public/data.json"))),candidate);assert.ok(r.state.execution.workspaceCandidateSha256);});
test("workspace baseline 改变时拒绝 apply",async t=>{const e=await fixture();t.after(e.cleanup);await fs.writeFile(path.join(e.workspace,"public/data.json"),JSON.stringify(candidate));await assert.rejects(e.applier.apply(e.state.taskId),x=>x instanceof WorkspaceCandidateApplierError&&x.code==="WORKSPACE_BASELINE_MISMATCH");});
test("planHash 不匹配时拒绝 apply",async t=>{const e=await fixture();t.after(e.cleanup);const s=await e.store.readTask(e.state.taskId);await e.store.updateState(s.taskId,s.documentRevision,d=>{d.confirmations.execution.boundPlanHash="sha256:old";return d;});await assert.rejects(e.applier.apply(e.state.taskId),x=>x.code==="PLAN_HASH_MISMATCH");});
test("重复 apply 幂等",async t=>{const e=await fixture();t.after(e.cleanup);await e.applier.apply(e.state.taskId);const second=await e.applier.apply(e.state.taskId);assert.equal(second.idempotent,true);});
test("apply 后 content-pr 可以识别已应用 workspace",async t=>{const e=await fixture();t.after(e.cleanup);await e.applier.apply(e.state.taskId);const calls=[];const adapter=new ContentPrAdapter({taskStore:e.store,workspaceRoot:e.workspace,run:(bin,args)=>{calls.push([bin,args]);return bin==="gh"?"https://example.test/pr/1":"";}});const result=await adapter.submit(e.state.taskId);assert.equal(result.state.lifecycle.state,"PR_CREATED");assert.equal(calls.filter(([bin])=>bin==="gh").length,1);});
