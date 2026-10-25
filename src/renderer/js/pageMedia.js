import {assetUrl,svgUrl,resolveSvgMediaUrl} from './media.js';
import {escapeHtml} from './noteFormat.js';
const pages=new Map(),requests=new Map(),rootObservers=new WeakMap();let viewportObserver;
const sourceVersions=new Map();let version=0;
function keyFor(page,variant){const values=[page.pageAssetUrl,page.imagePath,page.rotation,page.width,page.height,page.updatedAt,page.svgPreviewPath,page.svgPreview];let previous=sourceVersions.get(page.pageId);if(!previous||values.some((v,i)=>previous.values[i]!==v)){previous={values,version:++version};sourceVersions.set(page.pageId,previous);while(sourceVersions.size>256)sourceVersions.delete(sourceVersions.keys().next().value);}return page.pageId+'|'+previous.version+'|'+variant;}
export function getPageMedia(page,variant='preview'){
 const key=keyFor(page,variant);if(requests.has(key))return requests.get(key);
 const promise=(async()=>{let result;try{const response=await window.papercard.call('image:get',{pageId:page.pageId,variant});if(response?.ok===false)throw new Error(response.error);result=response?.image||response?.data||response;}catch{result={fallback:true};}
  if(result?.url&&!result.fallback)return {...result,url:assetUrl(result.url)};
  // Source SVG carries the application's exact rotation/viewBox; never rotate it twice.
  if(page.svgPreview||page.svgPreviewPath){const url=svgUrl(page.svgPreview)||assetUrl(page.svgPreviewPath);if(url)return {url:await resolveSvgMediaUrl(url),width:page.width,height:page.height,rotation:0,fallback:true};}
  return {url:assetUrl(result?.url||page.pageAssetUrl||page.imagePath),width:page.width,height:page.height,rotation:page.rotation||0,fallback:true};})();requests.set(key,promise);while(requests.size>256)requests.delete(requests.keys().next().value);promise.catch(()=>requests.delete(key));return promise;
}
function markup(page,variant){pages.set(page.pageId,page);const ratio=(page.width||3)/(page.height||4);const style=variant==='original'?`width:min(84vw,calc(78vh * ${ratio}));aspect-ratio:${ratio};height:auto;`:'width:100%;height:100%;';return `<div class="page-media-frame" style="${style}" data-page-frame="${escapeHtml(page.pageId)}"><img data-page-media="${escapeHtml(page.pageId)}" data-variant="${variant}" alt="${escapeHtml(page.title||'原纸')}" decoding="async" ${variant==='thumbnail'?'loading="lazy"':''} style="position:absolute;left:50%;top:50%;max-width:none;max-height:none;object-fit:fill;margin:0"></div>`;}
export const pageThumbMarkup=page=>markup(page,'thumbnail');
export const pageMediaMarkup=(page,{variant='preview'}={})=>markup(page,variant);
function fit(img,page,media){const frame=img.parentElement;if(!frame)return;const w=frame.clientWidth,h=frame.clientHeight;if(!w||!h)return;const angle=((media.rotation||0)%360+360)%360,odd=angle===90||angle===270;const ratio=(page.width||3)/(page.height||4);const fittedW=Math.min(w,h*ratio),fittedH=fittedW/ratio;img.style.width=((odd?fittedH:fittedW)/w*100)+'%';img.style.height=((odd?fittedW:fittedH)/h*100)+'%';img.style.transform=`translate(-50%,-50%) rotate(${angle}deg)`;}
async function load(img){if(img.dataset.pageLoading)return;img.dataset.pageLoading='1';const page=pages.get(img.dataset.pageMedia);if(!page)return;try{const media=await getPageMedia(page,img.dataset.variant);if(!img.isConnected)return;if(media.url){fit(img,page,media);img.src=media.url;img.dataset.mediaEtag=media.etag||'';img.onload=()=>{fit(img,page,media);img.parentElement.classList.add('is-loaded');};if(img.complete&&img.naturalWidth)img.onload();}else img.alt='原图不可用';}catch{img.alt='原图暂不可用';delete img.dataset.pageLoading;}}
export function bindPageMedia(container,{root=null,immediate=false}={}){
 const images=container.querySelectorAll('img[data-page-media]:not([data-page-loading])');if(immediate||typeof IntersectionObserver==='undefined'){images.forEach(load);return;}
 let observer=root?rootObservers.get(root):viewportObserver;if(!observer){observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){observer.unobserve(entry.target);load(entry.target);}else if(!entry.target.isConnected)observer.unobserve(entry.target);}),{root,rootMargin:'80px',threshold:0.01});if(root)rootObservers.set(root,observer);else viewportObserver=observer;}images.forEach(img=>observer.observe(img));
}
