import { registerGoverningMappingRoutesV12 } from './governing-mapping-routes-v12';

type RouteApp={get:(path:string,handler:(c:any)=>unknown)=>void;put:(path:string,handler:(c:any)=>unknown)=>void};
type RequirementKind='work'|'control'|'administration'|'condition'|'operation'|'evidence'|'deadline';

function norm(v:unknown){return String(v||'').toLocaleLowerCase('sv-SE').replace(/[–—]/g,'-').replace(/\s+/g,' ').trim()}
function add(xs:RequirementKind[],x:RequirementKind){if(!xs.includes(x))xs.push(x)}
function requirementSemantics(item:any,allItems:any[]){
 const t=norm(item.description),it=String(item.item_type||'');const kinds:RequirementKind[]=[];
 const takesPhoto=/ta (en )?bild|ta bild|fotografera|bild på|översiktsbild/.test(t);
 const operation=/slamtöm|skötas|sköta och underhålla|drift|underhåll|överlämnas till ny ägare|överlåtelse av fastigheten|hållas fri från växtlighet/.test(t);
 const administration=it==='administration'||it==='documentation'||/lämnas|skickas|beställ|bokas|rapport|relationshandling|relationsritning|upprättas|upprättad|registrera|anmälan till|kontakta .*nämnd/.test(t);
 const control=it==='measurement'||it==='visit'||it==='control'||/kontroll|verifier|mät|besiktig|provning|överensstämmelse|bedöm|radon|utsätt|utstakn|sakkunnig|fackmannamäss/.test(t);
 const work=/installation|installera|montera|anlägga|anläggas|utföras|utför |förberedas|förbered |ordna |sorteras|grundläggning|stomme|bjälklag|takkonstruk|täckning|fönster och dörrar|ventilation|värmeisolering|eldstad|imkanal|vatten och avlopp|våtrum/.test(t);
 const condition=it==='condition'||it==='information'||/får inte|ska bestå|ska vara tät|ska placeras|ska hållas|ska förväntas|risk för smitta|avståndet mellan|marknivå vid tomtgräns|om .*påträffas|om .*behöver|där .*förekommer/.test(t);
 const deadline=/inom \d+ år|inom \d+ (dag|vecka|månad)|före byggstart|innan startbesked|före startbesked|före gjutning|innan .*läggs igen|före övertäckning|så snart|snarast efter|till slutbesked|före slutbesked|i god tid|två veckor i förväg/.test(t);
 if(operation)add(kinds,'operation');if(work)add(kinds,'work');if(control)add(kinds,'control');if(administration)add(kinds,'administration');if(condition)add(kinds,'condition');if(takesPhoto)add(kinds,'evidence');if(deadline)add(kinds,'deadline');
 if(!kinds.length)add(kinds,(item.handling_kind||'work') as RequirementKind);
 // Fotografering ute på bygget är en kontroll med beviskrav, inte bara kontorsadministration.
 if(takesPhoto){add(kinds,'control');const i=kinds.indexOf('administration');if(i>=0&&!/skickas|lämnas|rapport/.test(t))kinds.splice(i,1)}
 // Några korta kontrollplanrubriker behöver tolkas semantiskt.
 if(/^elinstallation$/.test(t)){add(kinds,'work');add(kinds,'control');const i=kinds.indexOf('administration');if(i>=0)kinds.splice(i,1)}
 if(/förberedelse för bredbandsanslutning/.test(t)){add(kinds,'work');const i=kinds.indexOf('control');if(i>=0)kinds.splice(i,1)}
 if(/isolationsprovning utförd/.test(t)){add(kinds,'control');const i=kinds.indexOf('administration');if(i>=0)kinds.splice(i,1)}
 if(/överensstämmelse med bygglov/.test(t)){add(kinds,'control')}
 let primary:RequirementKind='work';if(kinds.includes('operation'))primary='operation';else if(kinds.includes('control'))primary='control';else if(kinds.includes('work'))primary='work';else if(kinds.includes('administration'))primary='administration';else if(kinds.includes('condition'))primary='condition';
 let timing_label='';if(/innan .*läggs igen|före övertäckning/.test(t))timing_label='Före övertäckning';else if(/före gjutning/.test(t))timing_label='Före gjutning';else if(/innan startbesked|före startbesked/.test(t))timing_label='Före startbesked';else if(/före byggstart/.test(t))timing_label='Före byggstart';else if(/till slutbesked|före slutbesked/.test(t))timing_label='Före slutbesked';else if(/snarast efter|så snart/.test(t))timing_label='Direkt efter färdigställande';else if(/inom 2 år.*5 år|2 år.*5 år/.test(t))timing_label='Tillståndsfrist: start inom 2 år, klart inom 5 år';
 let context_exception:any=null;
 if(/infiltration|markbädd/.test(t)&&(/gropen.*tom|lager av sand|lager.*grus|spridningsledningar/.test(t))){const sibling=allItems.some(x=>String(x.governing_document_id)===String(item.governing_document_id)&&/befintlig.*gemensam.*infiltration/.test(norm(x.description)));if(sibling)context_exception={status:'not_applicable',reason:'Dokumentet anger att projektet ansluter till en befintlig gemensam infiltration. Punkten avser arbete/fotografering när en ny infiltration eller markbädd anläggs.'}}
 let interpretation_note='';if(/dokumenterat sakkunnig person/.test(t))interpretation_note='Verifiera och dokumentera den utförande personens sakkunskap. Kravet är formulerat på personnivå och inte som krav på viss företagsform.';
 return{handling_kind:primary,handling_kinds:kinds,evidence_type:takesPhoto?'photo':null,timing_label,context_exception,interpretation_note};
}

export function registerGoverningMappingRoutesV13(app:RouteApp){
 const proxy:RouteApp={
  get(path,handler){
   if(path!=='/api/studio/projects/:projectId/governing-mapping'){app.get(path,handler);return}
   app.get(path,async c=>{const response:any=await handler(c);if(!response||typeof response.clone!=='function'||!response.ok)return response;const data:any=await response.clone().json().catch(()=>null);if(!data||!Array.isArray(data.items))return response;const original=data.items;data.items=original.map((item:any)=>({...item,...requirementSemantics(item,original)}));data.runtime='mapping-v13';return c.json(data,response.status)});
  },
  put(path,handler){app.put(path,async c=>{const response:any=await handler(c);if(!response||typeof response.clone!=='function'||!response.ok)return response;const data:any=await response.clone().json().catch(()=>null);if(!data)return response;data.runtime='mapping-v13';return c.json(data,response.status)})}
 };
 registerGoverningMappingRoutesV12(proxy);
}
