import { registerGoverningMappingRoutesV15 } from './governing-mapping-routes-v15';

type RouteApp={get:(path:string,handler:(c:any)=>unknown)=>void;put:(path:string,handler:(c:any)=>unknown)=>void};
type RequirementKind='work'|'control'|'administration'|'condition'|'operation'|'evidence'|'deadline';
function norm(v:unknown){return String(v||'').toLocaleLowerCase('sv-SE').replace(/[–—]/g,'-').replace(/\s+/g,' ').trim()}
function unique<T>(xs:T[]){return [...new Set(xs)]}
function asSuggestion(a:any,confidence=98){return{activity_id:a.id,title:a.title,task_title:a.task_title,section_name:a.section_name,area_name:a.area_name,confidence,lifecycle_stage:a.lifecycle_stage,surface:a.surface,applicability:a.applicability,condition_text:a.condition_text}}

function refineSemantics(item:any){
 const t=norm(item.description);let kinds=(Array.isArray(item.handling_kinds)?[...item.handling_kinds]:[item.handling_kind||'work']) as RequirementKind[];let primary=(item.handling_kind||'work') as RequirementKind;const deadline=kinds.includes('deadline');const withDeadline=(base:RequirementKind[])=>unique(deadline?[...base,'deadline']:base);
 if(/översiktsbild/.test(t)){kinds=withDeadline(['control','evidence']);primary='control'}
 if(/sotare.*besiktigat/.test(t)){kinds=withDeadline(['control','administration']);primary='control'}
 if(/godkänt protokoll.*lämnas för slutbesked/.test(t)){kinds=withDeadline(['administration']);primary='administration'}
 if(/relationsritningar.*lämnas för slutbesked/.test(t)){kinds=withDeadline(['administration']);primary='administration'}
 return{...item,handling_kind:primary,handling_kinds:unique(kinds)};
}

function exactTitlesFor(item:any):string[]{
 const t=norm(item.description);
 if(/^besök vid slutsamråd$/.test(t))return['Beställ och genomför slutsamråd när det krävs'];
 if(/relationshandlingar för lod och utvändigt va/.test(t))return['Samla relationshandlingar för dagvatten och utvändigt VA'];
 if(/egenkontroller och intyg för el, va och brandskydd.*slutbesked/.test(t))return['Samla egenkontroller och intyg för installationer och brandskydd'];
 if(/fotografier för grund, va-anslutning och dränering.*lämnas in/.test(t))return['Samla erforderlig fotodokumentation för dolda arbeten och myndighetskrav'];
 if(/avståndet mellan infiltrationsnivån och grundvattenytan/.test(t))return['Verifiera att tillståndets krav på avstånd mellan infiltrationsnivå och grundvatten är uppfyllt'];
 if(/reducera totalfosfor.*70 procent.*organiska ämnen/.test(t))return['Verifiera att avloppslösningen uppfyller tillståndets reningskrav'];
 if(/risk för smitta, lukt eller annan olägenhet/.test(t))return['Kontrollera att avloppslösningen inte medför risk för smitta, lukt eller annan olägenhet'];
 if(/byggnadsarbetena får inte påbörjas innan startbesked/.test(t))return['Säkerställ att startbesked har erhållits före byggstart'];
 if(/arbetsmiljöplan ska upprättas och anslås före byggstart/.test(t))return['Kontrollera att arbetsmiljöorganisation och arbetsmiljöplan är ordnade','Sätt upp arbetsmiljöplan på arbetsplatsen före byggstart'];
 if(/bas-p och bas-u ska utses.*teoretiska och praktiska kunskaper/.test(t))return['Registrera BAS-P','Registrera BAS-U','Dokumentera att BAS-P och BAS-U har erforderlig kompetens för uppdraget'];
 if(/byggavfall ska förvaras.*sorteras.*eldning/.test(t))return['Ordna sortering och säker förvaring av byggavfall','Säkerställ att byggavfall inte eldas på fastigheten'];
 if(/ledningar och kablar i mark bör märkas ut före markarbeten/.test(t))return['Lokalisera och märk ut befintliga ledningar och kablar före schaktning'];
 if(/infart anläggs över samfällt dike/.test(t))return['Kontrollera dikesfunktion och dimensionera vägtrumma vid infart över dike'];
 if(/risker för skador på byggnad.*markarbeten/.test(t))return['Bedöm och förebygg skaderisker vid markarbeten'];
 if(/fuktmätning ska genomföras på betongplatta.*relativ fuktighet/.test(t))return['Mät och verifiera relativ fuktighet i betong före beläggning'];
 if(/dubbla ångtäta skikt mot yttervägg undvikas/.test(t))return['Kontrollera att våtrummets ångtätningslösning inte ger olämpliga dubbla täta skikt'];
 if(/kolfilterfläkt i kök.*tillräcklig frånluft/.test(t))return['Säkerställ tillräcklig frånluft ovanför matlagningsplats vid kolfilterfläkt'];
 if(/fönster avsedda för utrymning/.test(t))return['Kontrollera utrymningsfönsters öppningsmått, fri öppning och höjd över golv'];
 if(/till slutbesked ska sotare ha besiktigat/.test(t))return['Beställ och genomför föreskriven sotarbesiktning','Spara intyg eller protokoll från sotarbesiktning av rökkanal och taksäkerhet'];
 if(/imkanal i kök ska utföras enligt/.test(t))return['Utför och kontrollera imkanal enligt brandskyddsunderlag'];
 if(/rekommenderar brandvarnare.*pulversläckare.*brandfilt/.test(t))return['Montera och kontrollera brandvarnare och övrig brandsäkerhetsutrustning'];
 if(/takskydd och tillträdesanordningar ska utföras.*snörasskydd/.test(t))return['Montera och kontrollera taksäkerhet och tillträdesanordningar','Montera och kontrollera erforderligt snörasskydd'];
 if(/reviderad kontrollplan med kontrollpunkt för barnsäkerhet/.test(t))return['Lämna reviderad kontrollplan inför startbesked när det krävs'];
 if(/utlåtande från kontrollansvarig.*intyg om att byggnadsåtgärderna överensstämmer/.test(t))return['Samla KA-utlåtande och byggherreintyg inför slutbesked'];
 if(/komplett ifylld och signerad kontrollplan.*byggherrens egenkontroller/.test(t))return['Samla ifylld och signerad kontrollplan','Samla byggherrens egenkontroller för slutbesked'];
 if(/provtryckningsprotokoll för rör ska lämnas för slutbesked/.test(t))return['Spara provtryckningsprotokoll för VA/VVS'];
 if(/elintyg ska lämnas för slutbesked/.test(t))return['Samla elintyg och provningsunderlag'];
 if(/godkänt protokoll för imkanal ska lämnas för slutbesked/.test(t))return['Samla imkanalprotokoll eller motsvarande dokumentation'];
 if(/relationsritningar ska lämnas för slutbesked/.test(t))return['Samla relationsritningar när projektet avviker från beviljade handlingar'];
 return[];
}

function refineSuggestions(data:any,item:any){const wanted=exactTitlesFor(item);if(!wanted.length)return Array.isArray(data.suggestions?.[item.id])?data.suggestions[item.id]:[];const found=wanted.map(title=>(data.activities||[]).find((a:any)=>norm(a.title)===norm(title))).filter(Boolean);return found.length?found.map((a:any)=>asSuggestion(a)):Array.isArray(data.suggestions?.[item.id])?data.suggestions[item.id]:[]}

export function registerGoverningMappingRoutesV16(app:RouteApp){
 const proxy:RouteApp={
  get(path,handler){if(path!=='/api/studio/projects/:projectId/governing-mapping'){app.get(path,handler);return}app.get(path,async c=>{const response:any=await handler(c);if(!response||typeof response.clone!=='function'||!response.ok)return response;const data:any=await response.clone().json().catch(()=>null);if(!data||!Array.isArray(data.items))return response;data.items=data.items.map((item:any)=>refineSemantics(item));if(data.suggestions&&typeof data.suggestions==='object')for(const item of data.items)data.suggestions[item.id]=refineSuggestions(data,item);data.runtime='mapping-v16';return c.json(data,response.status)})},
  put(path,handler){app.put(path,async c=>{const response:any=await handler(c);if(!response||typeof response.clone!=='function'||!response.ok)return response;const data:any=await response.clone().json().catch(()=>null);if(!data)return response;data.runtime='mapping-v16';return c.json(data,response.status)})}
 };
 registerGoverningMappingRoutesV15(proxy);
}
