import { registerGoverningMappingRoutesV14 } from './governing-mapping-routes-v14';

type RouteApp={get:(path:string,handler:(c:any)=>unknown)=>void;put:(path:string,handler:(c:any)=>unknown)=>void};
type RequirementKind='work'|'control'|'administration'|'condition'|'operation'|'evidence'|'deadline';

function norm(v:unknown){return String(v||'').toLocaleLowerCase('sv-SE').replace(/[–—]/g,'-').replace(/\s+/g,' ').trim()}
function unique<T>(xs:T[]){return [...new Set(xs)]}

function refineSemantics(item:any){
 const t=norm(item.description);let kinds=(Array.isArray(item.handling_kinds)?[...item.handling_kinds]:[item.handling_kind||'work']) as RequirementKind[];let primary=(item.handling_kind||'work') as RequirementKind;
 const deadline=kinds.includes('deadline');const withDeadline=(base:RequirementKind[])=>unique(deadline?[...base,'deadline']:base);
 if(/utsättning|utstakning/.test(t)){kinds=withDeadline(['work','control']);primary='work'}
 if(/överensstämmelse med bygglov/.test(t)){kinds=withDeadline(['control']);primary='control'}
 if(/^elinstallation$/.test(t)){kinds=withDeadline(['work','control']);primary='work'}
 if(/isolationsprovning utförd/.test(t)){kinds=withDeadline(['control']);primary='control'}
 if(/förberedelse för bredbandsanslutning/.test(t)){kinds=withDeadline(['work']);primary='work'}
 if(/fuktskydd under byggtid/.test(t)){kinds=withDeadline(['work','control']);primary='control'}
 if(/installationer för dagvatten/.test(t)){kinds=withDeadline(['work','control']);primary='control'}
 if(/tak- och väggtäckning/.test(t)){kinds=withDeadline(['work','control']);primary='control'}
 if(/geoteknisk utredning utförd/.test(t)){kinds=withDeadline(['control','administration']);primary='control'}
 if(/geotekniskt utlåtande beaktat/.test(t)){kinds=withDeadline(['control']);primary='control'}
 if(/brandskyddsbeskrivning beaktad i projekteringen/.test(t)){kinds=withDeadline(['control']);primary='control'}
 if(/fuktsäkerhetsprojektering beaktad i projekteringen/.test(t)){kinds=withDeadline(['control']);primary='control'}
 if(/kontrollmätning|lägeskontroll/.test(t)){kinds=withDeadline(['control']);primary='control'}
 if(/elinstallationsföretaget registrerat/.test(t)){kinds=withDeadline(['control','administration']);primary='control'}
 if(/\bta\b.*\bbild\b|fotografera|fotodokumentation/.test(t)){
   if(/skicka bilder|lämna.*foto|fotodokumentation.*skick/.test(t)){kinds=withDeadline(['administration','evidence']);primary='administration'}
   else{kinds=withDeadline(['control','evidence']);primary='control'}
 }
 return{...item,handling_kind:primary,handling_kinds:unique(kinds)};
}

function exactTitlesFor(item:any):string[]{
 const t=norm(item.description);
 if(/tillståndet upphör att gälla.*påbörjas inom 2 år.*avslutas inom 5 år/.test(t))return['Bevaka avloppstillståndets start- och färdigställandefrister'];
 if(/anläggningen ska bestå av slamavskiljare/.test(t))return['Kontrollera att avloppsanläggningen utförs enligt tillstånd, ansökan och tillverkarens anvisningar'];
 if(/placeras och utföras enligt ansökan.*tillverkarens anvisningar/.test(t))return['Kontrollera att avloppsanläggningen utförs enligt tillstånd, ansökan och tillverkarens anvisningar'];
 if(/dokumenterat sakkunnig person/.test(t))return['Dokumentera sakkunskap hos den person som utför avloppsinstallationen'];
 if(/avloppsanläggningen ska vara tät.*infiltrationen/.test(t))return['Kontrollera att avloppsanläggningen är tät fram till efterföljande rening','Planera och dokumentera drift och skötsel av avloppsanläggningen'];
 if(/dag- och dräneringsvatten.*får inte ledas till avloppsanläggningen/.test(t))return['Kontrollera att dag-, dränerings- och annat främmande vatten inte leds till avloppsanläggningen'];
 if(/entreprenörsrapport.*fotodokumentation.*skickas/.test(t))return['Skicka entreprenörsrapport och fotodokumentation till miljö- och byggnämnden'];
 if(/kontrolleras och skötas enligt ansökan/.test(t))return['Planera och dokumentera drift och skötsel av avloppsanläggningen'];
 if(/slamtömmas enligt tillverkarens anvisningar/.test(t))return['Säkerställ slamtömning enligt tillstånd och tillverkarens anvisningar'];
 if(/åtkomlig för slamtömning/.test(t))return['Kontrollera åtkomlighet för slamtömning och uppställningsplats'];
 if(/tillståndet med villkor.*överlämnas till ny ägare/.test(t))return['Bevara avloppstillståndet och överlämna det vid ägarbyte'];
 if(/större ingrepp.*materialbyte.*kan kräva anmälan/.test(t))return['Kontakta miljömyndigheten före större ändring som kan kräva anmälan'];
 if(/fastighetsägaren ansvarar för att sköta och underhålla/.test(t))return['Planera och dokumentera drift och skötsel av avloppsanläggningen','Säkerställ slamtömning enligt tillstånd och tillverkarens anvisningar','Kontrollera åtkomlighet för slamtömning och uppställningsplats'];
 if(/fornlämning påträffas.*arbetet avbrytas.*länsstyrelsen/.test(t))return['Avbryt markarbete och kontakta länsstyrelsen om fornlämning påträffas'];
 if(/bild i varje installerad brunn/.test(t))return['Fotografera varje installerad brunn'];
 if(/bild på ledningarna innan de läggs igen/.test(t))return['Fotografera ledningar före återfyllning'];
 if(/översiktsbild.*brunnens placering/.test(t))return['Ta översiktsbild av avloppsanläggningens placering'];
 if(/skicka bilderna tillsammans med entreprenörsrapporten/.test(t))return['Skicka entreprenörsrapport och fotodokumentation till miljö- och byggnämnden'];
 if(/fuktskydd under byggtid/.test(t))return['Fuktskydda material och konstruktion under byggtid'];
 if(/tak- och väggtäckning/.test(t))return['Montera taktäckning, beslag och tätningar','Utför fasad och väggtäckning enligt handling'];
 if(/^elinstallation$/.test(t))return['Samordna och utför elinstallation'];
 if(/geoteknisk utredning utförd/.test(t))return['Säkerställ att erforderlig geoteknisk utredning finns'];
 if(/geotekniskt utlåtande beaktat i projekteringen/.test(t))return['Kontrollera geotekniskt underlag och markförhållanden'];
 if(/brandskyddsbeskrivning beaktad i projekteringen/.test(t))return['Kontrollera att brandskyddsbeskrivningen har beaktats i projekteringen'];
 if(/installationer för dagvatten/.test(t))return['Utför dagvattenlösning enligt projektering eller gällande handling'];
 if(/fuktsäkerhetsprojektering beaktad i projekteringen/.test(t))return['Kontrollera att fuktsäkerhetsprojektering har beaktats i projekteringen'];
 if(/intyg från sotare för rökkanaler och taksäkerhet/.test(t))return['Spara intyg eller protokoll från sotarbesiktning av rökkanal och taksäkerhet'];
 if(/isolationsprovning utförd/.test(t))return['Genomför och dokumentera isolationsprovning'];
 if(/förberedelse för bredbandsanslutning/.test(t))return['Förbered kanalisation och anslutningspunkt för bredband'];
 return[];
}

function asSuggestion(a:any,confidence=98){return{activity_id:a.id,title:a.title,task_title:a.task_title,section_name:a.section_name,area_name:a.area_name,confidence,lifecycle_stage:a.lifecycle_stage,surface:a.surface,applicability:a.applicability,condition_text:a.condition_text}}

function refineSuggestions(data:any,item:any){
 const wanted=exactTitlesFor(item);if(wanted.length){const found=wanted.map(title=>(data.activities||[]).find((a:any)=>norm(a.title)===norm(title))).filter(Boolean);if(found.length)return found.map((a:any)=>asSuggestion(a));}
 const current=Array.isArray(data.suggestions?.[item.id])?[...data.suggestions[item.id]]:[];const t=norm(item.description);
 const documentation=/intyg|protokoll|relationshandling|relationsritning|lämna in|skicka|samla|spara/.test(t);
 if(documentation){const docs=current.filter((s:any)=>/spara|samla|skicka|lämna|intyg|protokoll|relations|dokument/.test(norm(s.title)));if(docs.length)return docs;}
 return current;
}

export function registerGoverningMappingRoutesV15(app:RouteApp){
 const proxy:RouteApp={
  get(path,handler){
   if(path!=='/api/studio/projects/:projectId/governing-mapping'){app.get(path,handler);return}
   app.get(path,async c=>{const response:any=await handler(c);if(!response||typeof response.clone!=='function'||!response.ok)return response;const data:any=await response.clone().json().catch(()=>null);if(!data||!Array.isArray(data.items))return response;
    data.items=data.items.map((item:any)=>refineSemantics(item));
    if(data.suggestions&&typeof data.suggestions==='object')for(const item of data.items)data.suggestions[item.id]=refineSuggestions(data,item);
    data.runtime='mapping-v15';return c.json(data,response.status)});
  },
  put(path,handler){app.put(path,async c=>{const response:any=await handler(c);if(!response||typeof response.clone!=='function'||!response.ok)return response;const data:any=await response.clone().json().catch(()=>null);if(!data)return response;data.runtime='mapping-v15';return c.json(data,response.status)})}
 };
 registerGoverningMappingRoutesV14(proxy);
}
