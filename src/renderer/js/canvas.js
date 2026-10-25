import {forestLayout} from './knowledgeIndex.js';
const esc=v=>String(v||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const W=220,H=82;
export function buildFlowPositions(cards, edges) {
  const ids=new Set(cards.map(c=>c.cardId)), adjacency=new Map(cards.map(c=>[c.cardId,[]])), incoming=new Map(cards.map(c=>[c.cardId,0]));
  for(const edge of edges){if(!ids.has(edge.fromCardId)||!ids.has(edge.toCardId)||edge.fromCardId===edge.toCardId)continue;adjacency.get(edge.fromCardId).push(edge.toCardId);incoming.set(edge.toCardId,incoming.get(edge.toCardId)+1);}
  const depth=new Map(), queue=[];
  const seed=id=>{if(!depth.has(id)){depth.set(id,0);queue.push(id);}};
  const walk=()=>{for(let index=0;index<queue.length;index++){const id=queue[index];for(const next of adjacency.get(id)){if(depth.has(next))continue;depth.set(next,depth.get(id)+1);queue.push(next);}}queue.length=0;};
  cards.filter(c=>incoming.get(c.cardId)===0&&adjacency.get(c.cardId).length).forEach(c=>seed(c.cardId));walk();
  for(const c of cards){if(!depth.has(c.cardId)&&(incoming.get(c.cardId)||adjacency.get(c.cardId).length)){seed(c.cardId);walk();}}
  const columns=Math.max(2,Math.min(6,Math.ceil(Math.sqrt(cards.length*1.4)))), rows=Array(columns).fill(0), result=new Map();
  for(const c of cards){let col;if(depth.has(c.cardId)){col=depth.get(c.cardId)%columns;const minimum=Math.min(...rows);if(rows[col]>minimum+3)col=rows.indexOf(minimum);}else col=rows.indexOf(Math.min(...rows));result.set(c.cardId,{x:60+col*285,y:60+rows[col]++*125,w:W,h:H});}
  return result;
}
export function buildTaxonomyPositions(cards){
  const groups=new Map();for(const c of cards){const subject=c.subject||'未分类';if(!groups.has(subject))groups.set(subject,[]);groups.get(subject).push(c);}
  const result=new Map(),columns=Math.max(1,Math.min(6,Math.ceil(Math.sqrt(cards.length*1.4))));let index=0;
  // Consecutive subject groups share the compact grid, avoiding one column per subject.
  for(const group of groups.values())for(const c of group){result.set(c.cardId,{x:60+(index%columns)*285,y:60+Math.floor(index/columns)*125,w:W,h:H});index++;}
  return result;
}
export function initCanvasController(options={}){
 const get=id=>document.getElementById(id),viewport=options.viewportEl||get('freeCanvasViewport'),world=options.worldEl||get('canvasWorld'),nodes=options.nodesLayerEl||get('canvasNodesLayer'),links=options.linksSvgEl||get('canvasLinksSvg');
 const controls=options.controls||{fit:get('canvasZoomFitBtn'),zoomIn:get('canvasZoomInBtn'),zoomOut:get('canvasZoomOutBtn'),zoomText:get('canvasZoomText'),tree:get('layoutByTreeBtn'),grid:get('layoutByTaxonomyBtn'),extra:get('canvasExtraRelationsBtn')};
 let state=options.state||{},positions=new Map(),zoom=1,pan={x:40,y:40},forest={edges:[],extras:[]},selected=[],edgeElements=new Map(),dragFrame=0;
 const transform=()=>{world.style.transform=`translate(${pan.x}px,${pan.y}px) scale(${zoom})`;if(controls.zoomText)controls.zoomText.textContent=Math.round(zoom*100)+'%';};
 const relations=()=>state.knowledgeRelations||state.synthesis?.relations||[];
 function sync(){forest=forestLayout(state.cards||[],relations());const saved=new Map((state.canvasLayout||[]).map(p=>[p.cardId,p]));positions=new Map(forest.positions.map(p=>[p.cardId,{...p,...saved.get(p.cardId),w:W,h:H}]));}
 function curve(r){const a=positions.get(r.fromCardId),b=positions.get(r.toCardId);if(!a||!b)return '';const x=a.x+W,y=a.y+H/2,tx=b.x,ty=b.y+H/2,mid=(x+tx)/2;if(Math.abs(y-ty)<1)return `M${x} ${y} H${tx}`;return `M${x} ${y} H${mid-8} Q${mid} ${y} ${mid} ${y+(ty>=y?8:-8)} V${ty+(ty>=y?-8:8)} Q${mid} ${ty} ${mid+8} ${ty} H${tx}`;}
 function renderLinks(){edgeElements.clear();links.innerHTML=forest.edges.map((r,i)=>`<path data-edge="${i}" d="${curve(r)}" fill="none" stroke="#7caa98" stroke-width="1.5"/>`).join('');links.querySelectorAll('[data-edge]').forEach(el=>{const r=forest.edges[Number(el.dataset.edge)];for(const id of [r.fromCardId,r.toCardId]){if(!edgeElements.has(id))edgeElements.set(id,[]);edgeElements.get(id).push({el,r});}});if(controls.extra){controls.extra.hidden=!forest.extras.length;controls.extra.textContent=`另 ${forest.extras.length} 条关系`;controls.extra.onclick=()=>options.onExtraRelations?.(forest.extras);}}
 function save(){options.onLayoutChange?.([...positions].map(([cardId,p])=>({cardId,...p})));}
 function render(){nodes.innerHTML=(state.cards||[]).map(c=>{const p=positions.get(c.cardId),snippet=String(c.summary||c.previewContent||c.editableContent||'').replace(/<[^>]*>|\$|\\[a-z]+|[#>*]/gi,' ').replace(/\s+/g,' ').slice(0,55);return `<button class="canvas-node" data-card-id="${esc(c.cardId)}" style="transform:translate(${p.x}px,${p.y}px);width:${W}px;height:${H}px"><span class="node-title">${esc(c.title||'未命名')}</span><span class="node-snippet-clean">${esc(snippet||c.subject||'点击打开')}</span></button>`;}).join('');nodes.querySelectorAll('.canvas-node').forEach(el=>{el.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();const id=el.dataset.cardId,p=positions.get(id),start={x:e.clientX,y:e.clientY},old={...p};let moved=false;el.setPointerCapture(e.pointerId);selected=[id];el.onpointermove=v=>{const dx=(v.clientX-start.x)/zoom,dy=(v.clientY-start.y)/zoom;if(Math.abs(dx)+Math.abs(dy)>4)moved=true;if(!moved)return;p.x=old.x+dx;p.y=old.y+dy;if(dragFrame)return;dragFrame=requestAnimationFrame(()=>{dragFrame=0;el.style.transform=`translate(${p.x}px,${p.y}px)`;for(const edge of edgeElements.get(id)||[])edge.el.setAttribute('d',curve(edge.r));});};el.onpointerup=()=>{el.onpointermove=null;el.onpointerup=null;if(moved){if(dragFrame)cancelAnimationFrame(dragFrame);dragFrame=0;el.style.transform=`translate(${p.x}px,${p.y}px)`;for(const edge of edgeElements.get(id)||[])edge.el.setAttribute('d',curve(edge.r));save();}else options.onCardEdit?.(state.cards.find(c=>c.cardId===id));};};});renderLinks();transform();const empty=options.emptyEl||get('graphEmpty');if(empty)empty.hidden=!!state.cards?.length;}
 function fitToContent(){if(!positions.size){pan={x:40,y:40};zoom=1;transform();return;}const p=[...positions.values()],x=Math.min(...p.map(p=>p.x)),y=Math.min(...p.map(p=>p.y)),w=Math.max(...p.map(p=>p.x+W))-x,h=Math.max(...p.map(p=>p.y+H))-y;zoom=Math.min(1.2,Math.max(.02,Math.min((viewport.clientWidth-100)/w,(viewport.clientHeight-100)/h)));pan={x:(viewport.clientWidth-w*zoom)/2-x*zoom,y:(viewport.clientHeight-h*zoom)/2-y*zoom};transform();}
 viewport.addEventListener('wheel',e=>{e.preventDefault();const rect=viewport.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top,next=Math.max(.02,Math.min(3,zoom*Math.exp(-e.deltaY*.001)));pan.x=x-(x-pan.x)*next/zoom;pan.y=y-(y-pan.y)*next/zoom;zoom=next;transform();},{passive:false});viewport.onpointerdown=e=>{if(e.button!==0||e.target.closest('.canvas-node,button,input,select'))return;const start={x:e.clientX-pan.x,y:e.clientY-pan.y};viewport.setPointerCapture(e.pointerId);viewport.onpointermove=v=>{pan={x:v.clientX-start.x,y:v.clientY-start.y};transform();};viewport.onpointerup=()=>viewport.onpointermove=null;};
 function layoutSolutionFlow(){forest=forestLayout(state.cards||[],relations());positions=new Map(forest.positions.map(p=>[p.cardId,p]));render();save();fitToContent();}
 function layoutTaxonomy(){positions=buildTaxonomyPositions(state.cards||[]);render();save();fitToContent();}
 if(controls.fit)controls.fit.onclick=fitToContent;if(controls.zoomIn)controls.zoomIn.onclick=()=>{zoom=Math.min(3,zoom*1.2);transform();};if(controls.zoomOut)controls.zoomOut.onclick=()=>{zoom=Math.max(.02,zoom/1.2);transform();};if(controls.tree)controls.tree.onclick=layoutSolutionFlow;if(controls.grid)controls.grid.onclick=layoutTaxonomy;
 sync();render();return{updateState(next){state=next;sync();render();},fitToContent,layoutSolutionFlow,layoutTaxonomy,setSelectedCards(ids){selected=ids;},getSelectedCards:()=>selected};
}
const CanvasController={initCanvasController};window.CanvasController=CanvasController;export default CanvasController;
