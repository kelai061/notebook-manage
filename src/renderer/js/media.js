import {escapeHtml} from './noteFormat.js';
const svgCache=new Map(),svgByUrl=new Map(),resolvedSvgs=new Map(),pageIndexes=new WeakMap(),sourceCache=new WeakMap(),previewCache=new WeakMap(),assetCache=new Map();let svgBytes=0,assetBytes=0;const cropPages=new Map(),visibleLoads=new WeakMap();let mediaObserver;
function onVisible(img,load,immediate=false){if(immediate||typeof IntersectionObserver==='undefined'){load();return;}visibleLoads.set(img,load);mediaObserver ||= new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){mediaObserver.unobserve(entry.target);visibleLoads.get(entry.target)?.();visibleLoads.delete(entry.target);}else if(!entry.target.isConnected)mediaObserver.unobserve(entry.target);}),{rootMargin:'100px'});mediaObserver.observe(img);}
function pageFor(state,id){const pages=state.pages||[];let index=pageIndexes.get(pages);if(!index){index=new Map(pages.map(p=>[p.pageId,p]));pageIndexes.set(pages,index);}return index.get(id);}

function resolveAssetUrl(value){
 if(typeof value!=='string'||!value.trim())return '';let s=value.trim();
 if(/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=\r\n]+$/i.test(s))return s;
 if(/^data:image\/svg\+xml[,;]/i.test(s)){try{const pos=s.indexOf(',');if(pos<0)return '';const body=s.slice(pos+1);return svgUrl(/;base64/i.test(s.slice(0,pos))?atob(body):decodeURIComponent(body));}catch{return '';}}
 if(s.startsWith('app://local/')){try{const u=new URL(s);if(u.hostname==='local'&&!decodeURIComponent(u.pathname).split('/').includes('..'))return s;}catch{}return '';}
 s=s.replace(/\\/g,'/');const match=s.match(/(?:^|\/)(crops|pages)\/(.+)$/i);if(!match)return '';
 const parts=match[2].split('/');if(parts.some(p=>p==='..'||p==='.'||!p))return '';
 try{return `app://local/${match[1].toLowerCase()}/${parts.map(p=>encodeURIComponent(decodeURIComponent(p))).join('/')}`;}catch{return '';}
}
export function assetUrl(value){if(typeof value!=='string')return '';if(assetCache.has(value)){const result=assetCache.get(value);assetCache.delete(value);assetCache.set(value,result);return result;}const result=resolveAssetUrl(value);if(value.length+result.length<24000000){assetCache.set(value,result);assetBytes+=value.length+result.length;while(assetCache.size>256||assetBytes>24000000){const key=assetCache.keys().next().value;assetBytes-=key.length+assetCache.get(key).length;assetCache.delete(key);}}return result;}
export function svgUrl(svg){
 if(typeof svg!=='string'||!/<svg[\s>]/i.test(svg))return '';
 if(svgCache.has(svg)){const value=svgCache.get(svg);svgCache.delete(svg);svgCache.set(svg,value);return value.url;}
 let clean=svg.replace(/<(script|foreignObject|iframe|object|embed)\b[\s\S]*?<\/\1\s*>/gi,'').replace(/\s+on[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,'').replace(/(?:javascript|vbscript):/gi,'');
 // An image SVG needs intrinsic dimensions; percentage dimensions alone collapse in img.
 clean=clean.replace(/<svg\b([^>]*)>/i,(_all,attrs)=>{let a=attrs;const box=a.match(/viewBox\s*=\s*["']([^"']+)["']/i)?.[1].trim().split(/[ ,]+/).map(Number);const w=box?.length===4&&box[2]>0?box[2]:Number(a.match(/\bwidth\s*=\s*["']([\d.]+)(?:px)?["']/i)?.[1])||800;const h=box?.length===4&&box[3]>0?box[3]:Number(a.match(/\bheight\s*=\s*["']([\d.]+)(?:px)?["']/i)?.[1])||450;if(!/\bxmlns\s*=/.test(a))a+=' xmlns="http://www.w3.org/2000/svg"';if(!box)a+=' viewBox="0 0 '+w+' '+h+'"';a=a.replace(/\s(?:width|height)\s*=\s*(?:"[^"]*"|'[^']*')/gi,'');return '<svg'+a+' width="'+w+'" height="'+h+'">';});
 const url=clean.length>16000&&typeof window!=='undefined'&&typeof URL.createObjectURL==='function'?URL.createObjectURL(new Blob([clean],{type:'image/svg+xml'})):'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(clean);const item={url,clean};svgCache.set(svg,item);svgByUrl.set(url,clean);svgBytes+=svg.length+url.length;
 while(svgCache.size>256||svgBytes>24000000){const key=svgCache.keys().next().value,value=svgCache.get(key);svgBytes-=key.length+value.url.length;svgCache.delete(key);svgByUrl.delete(value.url);resolvedSvgs.delete(value.url);if(value.url.startsWith('blob:'))URL.revokeObjectURL(value.url);}
 return url;
}
export function hasRedraw(figure={}){return [figure.redrawSvg,figure.vectorPreview,figure.customSvg,figure.svgData].some(s=>typeof s==='string'&&/<(?:path|rect|circle|ellipse|line|polyline|polygon|text|image|use|foreignObject)\b/i.test(s.replace(/<defs\b[\s\S]*?<\/defs>/gi,'').replace(/<!--[\s\S]*?-->/g,'')))||Boolean(assetUrl(figure.redrawPath||figure.redrawDataPath||figure.vectorPreviewPath||figure.redrawDataUrl||figure.customSvgPath||figure.vectorPreview));}
// A data: URL is self-describing, so a cache eviction must not leave the crop
// unresolved (that showed up as a blank 原截图 box after browsing many cards).
function svgTextFromUrl(url){
 if(!/^data:image\/svg\+xml[,;]/i.test(url))return '';
 try{const head=url.slice(0,url.indexOf(',')),body=url.slice(url.indexOf(',')+1);return /;base64/i.test(head)?atob(body):decodeURIComponent(body);}catch{return '';}
}
export function resolveSvgMediaUrl(url){
 let raw=svgByUrl.get(url);if(!raw)raw=svgTextFromUrl(url);if(!raw&&/^app:\/\/local\/[^?#]+\.svg(?:[?#]|$)/i.test(url)){if(resolvedSvgs.has(url))return resolvedSvgs.get(url);const promise=fetch(url).then(r=>{if(!r.ok)throw new Error('SVG资源未找到');return r.text();}).then(text=>resolveSvgMediaUrl(svgUrl(text)));resolvedSvgs.set(url,promise);return promise;}if(!raw||!/<image\b[^>]*(?:href|xlink:href)\s*=\s*["'](?!data:)/i.test(raw))return Promise.resolve(url);
 if(resolvedSvgs.has(url))return resolvedSvgs.get(url);
 const promise=(async()=>{let text=raw;const matches=[...raw.matchAll(/(<image\b[^>]*?\s(?:xlink:)?href\s*=\s*)(["'])([^"']+)\2/gi)];for(const match of matches){if(match[3].startsWith('data:'))continue;const safe=assetUrl(match[3]);if(!safe)throw new Error('图像资源路径不可用');const response=await fetch(safe);if(!response.ok)throw new Error('图像资源未找到');const bytes=new Uint8Array(await response.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));const mime=response.headers.get('content-type')?.split(';')[0]||(/\.svg(?:$|\?)/i.test(safe)?'image/svg+xml':/\.png(?:$|\?)/i.test(safe)?'image/png':'image/jpeg');const embedded='data:'+mime+';base64,'+btoa(binary);text=text.replace(match[0],match[1]+match[2]+embedded+match[2]);}return svgUrl(text);})();resolvedSvgs.set(url,promise);return promise;
}
export function figureSources(card,state={}){
 const f=card.figureInfo||{};const page=pageFor(state,card.pageId);const region=page?.regions?.find(r=>r.regionId===card.regionId);const signature=[f.enabled,f.redrawSvg,f.vectorPreview,f.customSvg,f.svgData,f.redrawPath,f.redrawDataPath,f.vectorPreviewPath,f.redrawDataUrl,f.cropSvg,f.cropPath,f.originalPath,page,region?.cropSvg,region?.cropPath];const cached=sourceCache.get(card);if(cached&&signature.every((v,i)=>cached.signature[i]===v)&&[cached.result.redraw,cached.result.crop].every(url=>!url?.startsWith('blob:')||svgByUrl.has(url)))return cached.result;
 const rawRedrawSvg=f.redrawSvg||f.vectorPreview||f.customSvg||f.svgData||'';
 const redraw=f.enabled===false||!hasRedraw(f)?'':(svgUrl(rawRedrawSvg)||assetUrl(f.redrawPath||f.redrawDataPath||f.vectorPreviewPath||f.redrawDataUrl||f.customSvgPath||f.vectorPreview));
 const rawSvg=f.cropSvg||region?.cropSvg||'';
 const external=/<image\b[^>]*(?:href|xlink:href)\s*=\s*["'](?!data:)/i.test(rawSvg);
 const flat=((page?.rotation||0)%360)===0;
 const pageRaster=page?.pageAssetUrl||page?.sourcePath||page?.imagePath||page?.assetPath||'';
 const hasPageRaster=Boolean(pageRaster);
 const cropPathIsSvg=/\.svg(?:[?#]|$)/i.test(f.cropPath||region?.cropPath||'');
 const windowCrop=Boolean(flat&&region?.bbox&&hasPageRaster);
 const rasterOriginal=/\.(?:png|jpe?g|webp)(?:[?#]|$)/i.test(f.originalPath||'')?assetUrl(f.originalPath):'';
 const crop=(windowCrop||external||(cropPathIsSvg&&hasPageRaster&&region?.bbox))?rasterOriginal:(svgUrl(rawSvg)||assetUrl(f.cropPath||region?.cropPath)||assetUrl(f.originalPath));
 const result={redraw,crop,page,region};sourceCache.set(card,{signature,result});return result;
}
function buildFigurePreviewHtml(card,state={},options={}){
 const {redraw,crop,page,region}=figureSources(card,state);const original=options.original||!redraw;
 if(page){cropPages.set(page.pageId,page);while(cropPages.size>256)cropPages.delete(cropPages.keys().next().value);}const source=page&&(assetUrl(page.pageAssetUrl||page.sourcePath||page.imagePath||page.assetPath)||svgUrl(page.svgPreview)||assetUrl(page.svgPreviewPath));const b=region?.bbox;
 if(!crop&&source&&b){const points=region.points||region.polygon;const clip=points?.length?'clip-path:polygon('+points.map(p=>((p.x-b.x)/b.w*100)+'% '+((p.y-b.y)/b.h*100)+'%').join(',')+');':'';const ratio=((b.w*(page.width||1))/(b.h*(page.height||1)));return '<div class="figure-preview figure-cropped" data-figure-url="'+escapeHtml(redraw||source)+'" data-redraw="'+escapeHtml(redraw)+'" data-original="'+escapeHtml(source)+'">'+(redraw?'<img class="figure-redraw-main" src="'+escapeHtml(redraw)+'" alt="重绘预览" '+(original?'hidden':'')+'>':'')+'<div class="figure-crop-window" '+(!original?'hidden':'')+' style="'+clip+'--crop-ratio:'+ratio+';aspect-ratio:'+ratio+';overflow:hidden;position:relative"><img data-page-crop="'+escapeHtml(page.pageId)+'" src="'+escapeHtml(source)+'" data-original-src="'+escapeHtml(source)+'" alt="原纸分区" decoding="async" style="position:absolute;max-width:none;width:'+(100/b.w)+'%;left:'+(-100*b.x/b.w)+'%;top:'+(-100*b.y/b.h)+'%"></div><div class="figure-preview-actions"><span class="figure-label">'+(original?'原截图':'重绘矢量')+'</span>'+(redraw?'<button type="button" data-figure-toggle>切换原图 / 重绘</button>':'')+'<button type="button" data-figure-zoom>放大</button></div></div>';}
 const url=original?crop:redraw;
 if(!url){
   if(source&&b){const ratio=((b.w*(page.width||1))/(b.h*(page.height||1)));return '<div class="figure-preview figure-cropped" data-figure-url="'+escapeHtml(source)+'" data-original="'+escapeHtml(source)+'"><div class="figure-crop-window" style="--crop-ratio:'+ratio+';aspect-ratio:'+ratio+';overflow:hidden;position:relative"><img data-page-crop="'+escapeHtml(page.pageId)+'" src="'+escapeHtml(source)+'" data-original-src="'+escapeHtml(source)+'" alt="原纸分区" decoding="async" style="position:absolute;max-width:none;width:'+(100/b.w)+'%;left:'+(-100*b.x/b.w)+'%;top:'+(-100*b.y/b.h)+'%"></div><div class="figure-preview-actions"><span class="figure-label">原截图</span><button type="button" data-figure-zoom>放大</button></div></div>';}
   return '<div class="figure-preview figure-placeholder" data-figure-empty="true"><div class="figure-placeholder-inner"><span class="figure-placeholder-icon">📐</span><span class="figure-placeholder-text">原纸分区切片</span><span class="figure-placeholder-sub">暂无可用切片或矢量图，可在原纸排版中重新框选</span></div></div>';
 }
 return '<div class="figure-preview" data-figure-url="'+escapeHtml(url)+'" data-figure-label="'+(original?'原截图':'重绘矢量')+'" data-redraw="'+escapeHtml(redraw)+'" data-original="'+escapeHtml(crop)+'"><img src="'+escapeHtml(url)+'" alt="'+(original?'原截图':'重绘矢量')+'" loading="lazy" decoding="async"><div class="figure-preview-actions"><span class="figure-label">'+(original?'原截图':'重绘矢量')+'</span>'+(crop&&redraw?'<button type="button" data-figure-toggle>切换原图 / 重绘</button>':'')+'<button type="button" data-figure-zoom>放大</button></div></div>';
}
export function figurePreviewHtml(card,state={},options={}){const sources=figureSources(card,state);const old=previewCache.get(card);if(old&&old.sources===sources&&old.original===Boolean(options.original))return old.html;const html=buildFigurePreviewHtml(card,state,options);previewCache.set(card,{sources,original:Boolean(options.original),html});return html;}
export const cachedFigurePreviewHtml=figurePreviewHtml;
export function bindFigurePreview(container){
 container.querySelectorAll('.figure-preview').forEach(box=>{
  if(box.dataset.mediaBound)return;box.dataset.mediaBound='1';
  const prepare=async img=>{const before=img.getAttribute('src');try{const after=await resolveSvgMediaUrl(before);if(img.getAttribute('src')===before&&after!==before){img.src=after;box.dataset.figureUrl=after;}if(box.dataset.original===before)box.dataset.original=after;if(box.dataset.redraw===before)box.dataset.redraw=after;}catch{img.alt='图像资源不可用，可调整原截图或替换图像';box.dataset.mediaError='1';}};
  box.querySelectorAll('img').forEach(img=>onVisible(img,()=>{if(img.dataset.pageCrop){const page=cropPages.get(img.dataset.pageCrop);import('./pageMedia.js').then(m=>m.getPageMedia(page,box.closest('#cardEditorModal')?'preview':'thumbnail')).then(result=>{if(img.isConnected&&result?.url)img.src=result.url;}).catch(()=>{if(img.dataset.originalSrc&&!img.src)img.src=img.dataset.originalSrc;});}else prepare(img);},Boolean(box.closest('#cardEditorModal'))));
  box.querySelector('[data-figure-toggle]')?.addEventListener('click',e=>{
   e.stopPropagation();
   const crop=box.querySelector('.figure-crop-window');
   const main=box.querySelector('.figure-redraw-main');
   const label=box.querySelector('.figure-label');
   if(crop&&main){
     crop.hidden=!crop.hidden;
     main.hidden=!crop.hidden;
     if(label)label.textContent=crop.hidden?'重绘矢量':'原截图';
     box.dataset.figureUrl=crop.hidden?box.dataset.redraw:(crop.querySelector('img')?.src||box.dataset.original);
     return;
   }
   const img=box.querySelector('img');
   if(img){
     const next=img.getAttribute('src')===box.dataset.original?box.dataset.redraw:box.dataset.original;
     img.src=next;
     box.dataset.figureUrl=next;
     if(label)label.textContent=next===box.dataset.original?'原截图':'重绘矢量';
     prepare(img);
   }
  });
  const zoom=e=>{
   e.stopPropagation();
   const dialog=document.createElement('dialog');
   dialog.className='figure-lightbox';
   const close=document.createElement('button');
   close.textContent='关闭';
   close.onclick=()=>dialog.close();
   const crop=box.querySelector('.figure-crop-window');
   if(crop&&!crop.hidden){
     const enlarged=crop.cloneNode(true);
     enlarged.hidden=false;
     enlarged.querySelectorAll('img[data-original-src]').forEach(image=>{image.src=image.dataset.originalSrc;});
     enlarged.style.width='min(85vw, calc(80vh * var(--crop-ratio,1)))';
     enlarged.style.maxHeight='none';
     dialog.append(enlarged,close);
   }else{
     const activeImg=box.querySelector('.figure-redraw-main:not([hidden]), img:not([hidden])');
     const img=document.createElement('img');
     img.src=activeImg?.src||box.dataset.figureUrl;
     img.alt='图像放大';
     dialog.append(img,close);
   }
   dialog.addEventListener('close',()=>dialog.remove());
   dialog.addEventListener('click',ev=>{if(ev.target===dialog)dialog.close();});
   document.body.append(dialog);
   dialog.showModal();
  };
  box.querySelector('[data-figure-zoom]')?.addEventListener('click',zoom);
  box.querySelector('img')?.addEventListener('click',zoom);
 });
}


