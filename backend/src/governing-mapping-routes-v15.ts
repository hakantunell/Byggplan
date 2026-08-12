import { registerGoverningMappingRoutesV14 } from './governing-mapping-routes-v14';

type RouteApp={get:(path:string,handler:(c:any)=>unknown)=>void;put:(path:string,handler:(c:any)=>unknown)=>void};
type RequirementKind='work'|'control'|'administration'|'condition'|'operation'|'evidence'|'deadline';

function norm(v:unknown){return String(v||'').toLocaleLowerCase('sv-SE').replace(/[–—]/g,'-').replace(/\s+/g,' ').trim()}
function unique<T>(xs:T[]){return [...new Set(xs)]}
function activityTitleIndex(data:any){const m=new Map<string,any>();for(const a of Array.isArray(data.activities)?data.activities:[]){const key=norm(a.title);if(key&&!m.has(key))m.set(key,a)}return m}

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

function refineSuggestions(data:any,item:any,index:Map<string,any>){
 const wanted=exactTitlesFor(item);if(wanted.length){const found=wanted.map(title=>index.get(norm(title))).filter(Boolean);if(found.length)return found.map((a:any)=>asSuggestion(a));}
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
    data.items=data.items.map((item:any)=>refineSemantics(item));const index=activityTitleIndex(data);
    if(data.suggestions&&typeof data.suggestions==='object')for(const item of data.items)data.suggestions[item.id]=refineSuggestions(data,item,index);
    data.runtime='mapping-v16';return c.json(data,response.status)});
  },
  put(path,handler){app.put(path,async c=>{const response:any=await handler(c);if(!response||typeof response.clone!=='function'||!response.ok)return response;const data:any=await response.clone().json().catch(()=>null);if(!data)return response;data.runtime='mapping-v16';return c.json(data,response.status)})}
 };
 registerGoverningMappingRoutesV14(proxy);
}
