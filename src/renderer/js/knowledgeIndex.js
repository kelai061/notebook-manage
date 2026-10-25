export const pathOf=c=>[c.subject||'未分类',c.course||'通用笔记',c.chapter||'未分章'];
export function createKnowledgeIndex(cards){
 const byId=new Map(),text=new Map(),folders=new Map();
 for(const card of cards){byId.set(card.cardId,card);const path=pathOf(card);text.set(card.cardId,[card.title,card.editableContent,...path].join(' ').toLowerCase());for(let n=1;n<=3;n++){const parts=path.slice(0,n),key=JSON.stringify(parts);if(!folders.has(key))folders.set(key,{key,path:parts,title:parts[n-1],search:parts.join(' ').toLowerCase(),cardIds:[]});folders.get(key).cardIds.push(card.cardId);}}
 return{byId,text,folders,query(query='',path=[]){const q=query.trim().toLowerCase();return cards.filter(c=>path.every((part,i)=>pathOf(c)[i]===part)&&(!q||text.get(c.cardId).includes(q)));},children(path=[]){return [...folders.values()].filter(f=>f.path.length===path.length+1&&path.every((p,i)=>f.path[i]===p));}};
}
export function forestLayout(cards,relations){
 const ids=new Set(cards.map(c=>c.cardId)),children=new Map(cards.map(c=>[c.cardId,[]])),incoming=new Map(cards.map(c=>[c.cardId,0])),edges=[],extras=[],used=new Set(),seen=new Set();
 const valid=relations.filter(r=>ids.has(r.fromCardId)&&ids.has(r.toCardId)&&r.fromCardId!==r.toCardId);
 for(const r of valid)incoming.set(r.toCardId,incoming.get(r.toCardId)+1);
 const outgoing=new Map(cards.map(c=>[c.cardId,[]]));valid.forEach(r=>outgoing.get(r.fromCardId).push(r));
 const roots=[];
 function walk(id){used.add(id);for(const r of outgoing.get(id)){const key=r.fromCardId+'>'+r.toCardId;if(seen.has(key))continue;seen.add(key);if(used.has(r.toCardId)){extras.push(r);continue;}children.get(id).push(r.toCardId);edges.push(r);walk(r.toCardId);}}
 for(const c of [...cards.filter(c=>incoming.get(c.cardId)===0),...cards])if(!used.has(c.cardId)){roots.push(c.cardId);walk(c.cardId);}
 const positions=new Map();let leaf=0;
 function place(id,depth){const kids=children.get(id);let y;if(kids.length){const ys=kids.map(k=>place(k,depth+1));y=(ys[0]+ys[ys.length-1])/2;}else y=60+leaf++*116;positions.set(id,{cardId:id,x:60+depth*310,y,w:220,h:82});return y;}
 // Cards with no relation at all are not a "tree": stacking them in one column wastes
 // the canvas, so they fill a compact grid under the trees instead.
 const isolated=cards.filter(c=>!children.get(c.cardId).length&&incoming.get(c.cardId)===0).map(c=>c.cardId),isolatedSet=new Set(isolated);
 const treeRoots=roots.filter(id=>!isolatedSet.has(id));
 for(const root of treeRoots){place(root,0);leaf+=.5;}
 if(isolated.length){
   const columns=Math.max(2,Math.min(6,Math.ceil(Math.sqrt(isolated.length*1.2)))),startY=treeRoots.length?60+Math.ceil(leaf)*116+40:60;
   isolated.forEach((id,i)=>{positions.set(id,{cardId:id,x:60+(i%columns)*300,y:startY+Math.floor(i/columns)*116,w:220,h:82});});
 }
 return{positions:[...positions.values()],edges,extras};
}
