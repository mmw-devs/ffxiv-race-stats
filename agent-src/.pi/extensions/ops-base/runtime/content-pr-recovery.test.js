"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { TaskStore } = require("./task-store.js");
const { ContentPrRecovery } = require("./content-pr-recovery.js");
async function fixture(response) {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"ops-pr-recover-")),workspace=path.join(root,"workspace");await fs.mkdir(workspace);const store=new TaskStore({workspaceRoot:workspace,runtimeRoot:path.join(root,"runtime")});await store.initialize();let state=await store.createTask({lifecycleState:"SUBMITTING"});state=await store.updateState(state.taskId,state.documentRevision,d=>{d.control.pendingEffect={kind:"CREATE_PR",stage:"PUSHED",branch:"content/update-t1-aaaaaa"};return d;});return {store,state,cleanup:()=>fs.rm(root,{recursive:true,force:true}),recovery:new ContentPrRecovery({taskStore:store,workspaceRoot:workspace,run:()=>response})};
}
test("启动恢复找到唯一 PR 时补写 PR_CREATED",async t=>{const e=await fixture('[{"url":"https://example/pr/1","number":1,"state":"OPEN"}]');t.after(e.cleanup);const [result]=await e.recovery.recoverAll();assert.equal(result.kind,"recovered");assert.equal(result.state.lifecycle.state,"PR_CREATED");assert.equal(result.state.control.pendingEffect,null);});
test("找不到 PR 时标记人工处理且不自动重试",async t=>{const e=await fixture('[]');t.after(e.cleanup);const result=await e.recovery.recoverTask(e.state.taskId);assert.equal(result.kind,"manual");assert.equal(result.state.lifecycle.state,"SUBMITTING");assert.equal(result.state.control.pendingEffect.stage,"MANUAL_RECONCILIATION_REQUIRED");});
