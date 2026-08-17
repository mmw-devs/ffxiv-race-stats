"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { TaskStore } = require("./task-store.js");
const { ContentPrAdapter, ContentPrAdapterError } = require("./content-pr-adapter.js");
const base = { teams: [{ id: "t1", phase: "P3", bossHP: 50, isLive: true, region: "JP" }] };
const changed = { teams: [{ id: "t1", phase: "P3", bossHP: 40, isLive: true, region: "JP" }] };
const actualChanges = [{ path: "teams[id=t1].bossHP", from: 50, to: 40, source: "ACTUAL" }];
async function fixture({ workspaceData = changed, lifecycle = "VALIDATED" } = {}) {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"ops-pr-")), workspace=path.join(root,"workspace"); await fs.mkdir(path.join(workspace,"public"),{recursive:true}); await fs.writeFile(path.join(workspace,"public","data.json"),JSON.stringify(workspaceData));
 const store=new TaskStore({workspaceRoot:workspace,runtimeRoot:path.join(root,"runtime")}); await store.initialize(); let state=await store.createTask({lifecycleState:lifecycle,operator:{feishuOpenId:"ou_allowed"},operation:{action:"updateTeam",target:{type:"team",id:"t1"},plannedChanges:actualChanges}});
 state=await store.updateState(state.taskId,state.documentRevision,(draft)=>{draft.confirmations={execution:{status:"CONFIRMED"}};return draft;});
 state=await store.saveBaseline(state.taskId,state.documentRevision,base,"sha256:test"); state=state.state;
 state=(await store.saveValidationReport(state.taskId,state.documentRevision,{success:true,actualChanges})).state;
 state=(await store.saveChangeRecord(state.taskId,state.documentRevision,{actualChanges})).state;
 const commands=[]; const adapter=new ContentPrAdapter({taskStore:store,workspaceRoot:workspace,run:(file,args)=>{commands.push([file,args]); return file==="gh"?"https://github.test/pr/1\n":"";}});
 return {store,state,adapter,commands,cleanup:()=>fs.rm(root,{recursive:true,force:true})};
}
test("validated task 创建一个 PR，且 adapter 不写 data.json",async(t)=>{const e=await fixture();t.after(e.cleanup);const before=await fs.readFile(path.join(e.adapter.workspaceRoot,"public/data.json"),"utf8");const r=await e.adapter.submit(e.state.taskId);assert.equal(r.state.lifecycle.state,"PR_CREATED");assert.equal(r.opLog.operator,"ou_allowed");assert.deepEqual(r.opLog.changes,[{field:"teams[id=t1].bossHP",from:50,to:40}]);assert.equal(await fs.readFile(path.join(e.adapter.workspaceRoot,"public/data.json"),"utf8"),before);assert.equal(e.commands.filter(([f])=>f==="gh").length,1);});
test("未验证 task 拒绝提交",async(t)=>{const e=await fixture({lifecycle:"EXECUTING"});t.after(e.cleanup);await assert.rejects(e.adapter.submit(e.state.taskId),(x)=>x instanceof ContentPrAdapterError&&x.code==="SUBMISSION_NOT_VALIDATED");});
test("workspace changes 与已验证记录不一致时拒绝",async(t)=>{const bad=structuredClone(changed);bad.teams[0].bossHP=35;const e=await fixture({workspaceData:bad});t.after(e.cleanup);await assert.rejects(e.adapter.submit(e.state.taskId),(x)=>x.code==="WORKSPACE_DIFF_MISMATCH");assert.equal(e.commands.length,0);});
test("重复提交不创建第二个 PR",async(t)=>{const e=await fixture();t.after(e.cleanup);await e.adapter.submit(e.state.taskId);await assert.rejects(e.adapter.submit(e.state.taskId),(x)=>x.code==="PR_ALREADY_CREATED");assert.equal(e.commands.filter(([f])=>f==="gh").length,1);});
