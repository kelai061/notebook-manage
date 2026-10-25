// Narrow model/performance smoke only. This does not certify desktop interaction or frame rate.
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const source=fs.readFileSync(path.join(__dirname,'../src/renderer/js/knowledgeIndex.js'),'utf8').replace(/export /g,'');
const scope=vm.createContext({});vm.runInContext(source,scope);
scope.data=Array.from({length:10000},(_,i)=>({cardId:'c'+i,title:'知识 '+i,subject:'学科'+i%10,course:'科目'+i%30,chapter:'章节'+i%100,editableContent:'忠实原文公式 x+y'}));
let start=performance.now();vm.runInContext('idx=createKnowledgeIndex(data)',scope);const buildMs=performance.now()-start;
start=performance.now();const searchCount=vm.runInContext("idx.query('知识 123').length",scope);const searchMs=performance.now()-start;
assert.equal(searchCount,11);
assert.equal(vm.runInContext('idx.children([]).length',scope),10);
assert.ok(vm.runInContext('idx.query("",["学科0","科目0"]).every(c=>c.course==="科目0")',scope));
const forest=vm.runInContext(`(()=>{const cards=Array.from({length:16},(_,i)=>({cardId:'n'+i})),relations=cards.slice(1).map((c,i)=>({fromCardId:'n'+Math.floor(i/2),toCardId:c.cardId}));relations.push({fromCardId:'n15',toCardId:'n0'});const f=forestLayout(cards,relations);return {nodes:f.positions.length,main:f.edges.length,extra:f.extras.length,unique:new Set(f.positions.map(p=>p.x+':'+p.y)).size};})()`,scope);
assert.equal(forest.nodes,16);assert.equal(forest.unique,16);assert.equal(forest.main,15);assert.equal(forest.extra,1);
console.log(JSON.stringify({ok:true,scope:'index and forest model smoke; no desktop timing claim',cards:10000,buildMs:Math.round(buildMs),searchMs:Math.round(searchMs),searchCount,forest},null,2));
