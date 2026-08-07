type RouteApp = {
  get: (path: string, handler: (c: any) => unknown) => void;
  post: (path: string, handler: (c: any) => unknown) => void;
};

type SeedActivity = { title: string; type: string; description?: string };
type SeedTask = { title: string; description?: string; activities: SeedActivity[] };
type SeedSection = { number: string; name: string; tasks: SeedTask[] };
type SeedArea = { number: string; name: string; sections: SeedSection[] };

const FRITIDSHUS_AREAS: SeedArea[] = [
  { number:'10', name:'Etablering och byggstart', sections:[
    { number:'10.10', name:'Startförutsättningar', tasks:[{ title:'Starta byggarbetsplatsen', activities:[
      {title:'Kontrollera att startbesked finns',type:'check'},
      {title:'Kontrollera gällande ritningar och handlingar',type:'check'},
      {title:'Registrera BAS-P',type:'document'},
      {title:'Registrera BAS-U',type:'document'},
      {title:'Genomför startmöte med byggherre och KA',type:'approval'},
      {title:'Kontrollera utsättning och referenshöjd',type:'check'},
      {title:'Sätt upp arbetsmiljöplan där det krävs',type:'perform'},
      {title:'Dokumentera tomten före byggstart',type:'document'}
    ]}] }
  ]},
  { number:'20', name:'Mark och grund', sections:[
    { number:'20.10', name:'Förbered markarbete', tasks:[{ title:'Förbered markarbete', activities:[
      {title:'Kontrollera situationsplan och grundritning',type:'check'},
      {title:'Märk ut byggnad och kritiska nivåer',type:'perform'},
      {title:'Genomför lägeskontroll och spara mätunderlag',type:'measurement'},
      {title:'Kontrollera ledningar och anslutningspunkter i mark',type:'check'},
      {title:'Planera masshantering och upplag',type:'perform'},
      {title:'Förbered tillfällig dagvattenhantering',type:'perform'}
    ]}]},
    { number:'20.20', name:'Schakt', tasks:[{ title:'Utför schakt', activities:[
      {title:'Kontrollera utsättning',type:'check'},
      {title:'Kontrollera höjdfix och schaktnivåer',type:'check'},
      {title:'Fotografera marken före schakt',type:'document'},
      {title:'Schakta till projekterad nivå',type:'perform'},
      {title:'Kontrollera schaktmått',type:'check'},
      {title:'Kontrollera schaktdjup',type:'measurement'},
      {title:'Kontrollera avvikande markförhållanden',type:'choice'},
      {title:'Rensa schaktbotten',type:'perform'},
      {title:'Kontrollera schaktbotten',type:'check'},
      {title:'Fotografera färdig schaktbotten',type:'document'},
      {title:'Genomför KA-kontroll vid grundbotten före gjutning',type:'approval'}
    ]}]},
    { number:'20.30', name:'Undergrund', tasks:[{ title:'Förbered undergrund', activities:[
      {title:'Lägg geotextil där konstruktionen kräver det',type:'perform'},
      {title:'Kontrollera geotextil före täckning',type:'check'},
      {title:'Fotografera geotextil före täckning',type:'document'},
      {title:'Lägg dränerande och kapillärbrytande material',type:'perform'},
      {title:'Packa undergrund',type:'perform'},
      {title:'Kontrollera nivå och planhet',type:'measurement'},
      {title:'Fotografera färdig undergrund',type:'document'}
    ]}]},
    { number:'20.40', name:'Grundkonstruktion', tasks:[{ title:'Bygg grundkonstruktion', description:'Kompletteras av vald grundmodul.', activities:[
      {title:'Kontrollera grundens mått och nivåer före montage eller gjutning',type:'check'},
      {title:'Montera form där det krävs',type:'perform'},
      {title:'Montera armering där det krävs',type:'perform'},
      {title:'Kontrollera armering före gjutning',type:'check'},
      {title:'Fotografera armering före gjutning',type:'document'},
      {title:'Kontrollera genomföringar före gjutning eller igenbyggnad',type:'check'},
      {title:'Fotografera genomföringar före gjutning eller igenbyggnad',type:'document'},
      {title:'Utför gjutning eller montage av grundkonstruktion',type:'perform'},
      {title:'Kontrollera färdiga grundnivåer',type:'measurement'},
      {title:'Fotografera färdig grundkonstruktion',type:'document'}
    ]}]},
    { number:'20.50', name:'Dränering och återfyllnad', tasks:[{ title:'Dränera och återfyll', activities:[
      {title:'Montera dränering där det krävs',type:'perform'},
      {title:'Kontrollera dränering före återfyllnad',type:'check'},
      {title:'Fotografera dränering före återfyllnad',type:'document'},
      {title:'Montera grundisolering och skydd där det krävs',type:'perform'},
      {title:'Fotografera grund innan återfyllnad',type:'document'},
      {title:'Återfyll med föreskrivet material',type:'perform'},
      {title:'Packa återfyllning etappvis där det krävs',type:'perform'},
      {title:'Forma markfall från byggnaden',type:'perform'},
      {title:'Kontrollera färdig marknivå intill grund',type:'measurement'}
    ]}]}
  ]},
  { number:'30', name:'Bärande stomme', sections:[
    { number:'30.10', name:'Bottenbjälklag och syll', tasks:[{ title:'Bygg bottenbjälklag och syll', activities:[
      {title:'Kontrollera grundens mått och nivå innan stomstart',type:'check'},
      {title:'Montera fuktskydd eller syllisolering',type:'perform'},
      {title:'Montera syll och bärlinor',type:'perform'},
      {title:'Kontrollera förankring och upplag',type:'check'},
      {title:'Montera bjälklag',type:'perform'},
      {title:'Kontrollera avväxlingar och förstärkningar',type:'check'},
      {title:'Fotografera bärande konstruktion före igenbyggnad',type:'document'}
    ]}]},
    { number:'30.20', name:'Ytterväggar', tasks:[{ title:'Bygg ytterväggar', activities:[
      {title:'Kontrollera väggplacering och öppningsmått',type:'check'},
      {title:'Bygg ytterväggsstomme',type:'perform'},
      {title:'Kontrollera lod, mått och stabilisering',type:'check'},
      {title:'Montera förstärkningar och avväxlingar',type:'perform'},
      {title:'Kontrollera bärande anslutningar',type:'check'},
      {title:'Fotografera bärande ytterväggskonstruktion',type:'document'},
      {title:'Genomför KA-kontroll när stommen är rest',type:'approval'}
    ]}]},
    { number:'30.30', name:'Mellanbjälklag, loft och invändigt bärverk', tasks:[{ title:'Bygg invändigt bärverk', activities:[
      {title:'Kontrollera upplag och avväxlingar',type:'check'},
      {title:'Montera bärande balkar och bjälkar',type:'perform'},
      {title:'Kontrollera infästningar och stabilitet',type:'check'},
      {title:'Kontrollera öppningar och frihöjder',type:'measurement'},
      {title:'Fotografera bärverk före igenbyggnad',type:'document'}
    ]}]}
  ]},
  { number:'40', name:'Tak', sections:[
    { number:'40.10', name:'Takstomme', tasks:[{ title:'Bygg takstomme', activities:[
      {title:'Kontrollera takgeometri och upplag',type:'check'},
      {title:'Montera takbärverk',type:'perform'},
      {title:'Kontrollera förankring och stabilisering',type:'check'},
      {title:'Kontrollera avväxlingar vid öppningar och genomföringar',type:'check'},
      {title:'Fotografera takstomme före igenbyggnad',type:'document'}
    ]}]},
    { number:'40.20', name:'Undertak och tätskikt', tasks:[{ title:'Montera undertak', activities:[
      {title:'Montera råspont eller annat föreskrivet undertak',type:'perform'},
      {title:'Kontrollera underlag före tätskikt',type:'check'},
      {title:'Montera underlagstäckning',type:'perform'},
      {title:'Kontrollera skarvar, anslutningar och genomföringar',type:'check'},
      {title:'Fotografera färdigt undertak och kritiska detaljer',type:'document'}
    ]}]},
    { number:'40.30', name:'Yttertak', tasks:[{ title:'Montera yttertak', activities:[
      {title:'Kontrollera montageunderlag',type:'check'},
      {title:'Montera yttertak',type:'perform'},
      {title:'Montera beslag och tätningar',type:'perform'},
      {title:'Montera taksäkerhetsanordningar där det krävs',type:'perform'},
      {title:'Kontrollera takgenomföringar',type:'check'},
      {title:'Fotografera färdigt yttertak',type:'document'}
    ]}]}
  ]},
  { number:'50', name:'Klimatskal', sections:[
    { number:'50.10', name:'Fönster och ytterdörrar', tasks:[{ title:'Montera fönster och ytterdörrar', activities:[
      {title:'Kontrollera öppningsmått före montage',type:'check'},
      {title:'Montera fönster och ytterdörrar',type:'perform'},
      {title:'Kontrollera infästning och funktion',type:'check'},
      {title:'Täta anslutningar mot stomme',type:'perform'},
      {title:'Kontrollera luft- och regntäthet vid anslutningar',type:'check'},
      {title:'Fotografera kritiska anslutningar före inklädnad',type:'document'}
    ]}]},
    { number:'50.20', name:'Fasad och yttre väggskikt', tasks:[{ title:'Färdigställ fasad', activities:[
      {title:'Kontrollera vindskydd och anslutningar',type:'check'},
      {title:'Montera luftning och spikläkt där det krävs',type:'perform'},
      {title:'Montera fasadbeklädnad eller färdigställ ytterväggens utsida',type:'perform'},
      {title:'Montera bleck och utvändiga anslutningsdetaljer',type:'perform'},
      {title:'Kontrollera färdigt regnskydd',type:'check'}
    ]}]},
    { number:'50.30', name:'Isolering och lufttäthet', tasks:[{ title:'Isolera och lufttäta klimatskal', activities:[
      {title:'Kontrollera installations- och isoleringsförutsättningar',type:'check'},
      {title:'Montera isolering',type:'perform'},
      {title:'Kontrollera isolering och kritiska anslutningar',type:'check'},
      {title:'Fotografera isolering före lufttätning och beklädnad',type:'document'},
      {title:'Montera luft- och ångtätningsskikt',type:'perform'},
      {title:'Täta skarvar och genomföringar',type:'perform'},
      {title:'Kontrollera lufttäthet visuellt',type:'check'},
      {title:'Fotografera kritiska lufttätningsdetaljer',type:'document'}
    ]}]}
  ]},
  { number:'60', name:'Installationer', sections:[
    { number:'60.10', name:'Spillvatten och vatten', tasks:[
      { title:'Förbered VVS-installationer', activities:[
        {title:'Kontrollera placering av tappställen och avloppsanslutningar',type:'check'},
        {title:'Kontrollera rörvägar och genomföringar',type:'check'},
        {title:'Såga eller borra nödvändiga urtag innan konstruktionen stängs',type:'perform'},
        {title:'Beställ eller avropa saknade VVS-komponenter',type:'note'}
      ]},
      { title:'Montera spillvatten och vatten', activities:[
        {title:'Montera spillvattenledningar',type:'perform'},
        {title:'Kontrollera dimensioner och fall på spillvatten',type:'measurement'},
        {title:'Montera vattenledningar',type:'perform'},
        {title:'Kontrollera infästningar och genomföringar',type:'check'},
        {title:'Fotografera dolda VVS-ledningar',type:'document'},
        {title:'Utför erforderlig täthets- eller tryckkontroll',type:'measurement'}
      ]}
    ]},
    { number:'60.20', name:'El', tasks:[
      { title:'Förbered elinstallation', activities:[
        {title:'Kontrollera att elinstallationsföretaget är registrerat',type:'check'},
        {title:'Kontrollera placering av central, uttag, brytare och fasta anslutningar',type:'check'},
        {title:'Kontrollera kabelvägar, dosor och genomföringar',type:'check'},
        {title:'Samordna elinstallation med VVS och ventilation',type:'check'}
      ]},
      { title:'Utför dold elinstallation', activities:[
        {title:'Montera dosor och kabelvägar',type:'perform'},
        {title:'Kontrollera placering och höjder före igenbyggnad',type:'check'},
        {title:'Fotografera dold elinstallation',type:'document'},
        {title:'Utför erforderliga kontroller före igenbyggnad',type:'check'}
      ]}
    ]},
    { number:'60.30', name:'Ventilation', tasks:[{ title:'Montera ventilation', activities:[
      {title:'Kontrollera kanaldragning och genomföringar',type:'check'},
      {title:'Montera kanaler, ventiler och fläktar',type:'perform'},
      {title:'Kontrollera isolering och kondensskydd där det krävs',type:'check'},
      {title:'Fotografera dolda ventilationsdelar',type:'document'}
    ]}]},
    { number:'60.40', name:'Uppvärmning, eldstad och rökkanal', tasks:[{ title:'Installera eldstad och rökkanal', activities:[
      {title:'Kontrollera placering och avstånd till brännbart',type:'check'},
      {title:'Kontrollera genomföringar och brandskydd före montage',type:'check'},
      {title:'Montera eldstad och rökkanal',type:'perform'},
      {title:'Fotografera dolda brandskyddsdetaljer före igenbyggnad',type:'document'},
      {title:'Genomför föreskriven besiktning',type:'approval'},
      {title:'Registrera besiktningsprotokoll eller intyg',type:'document'}
    ]}]},
    { number:'60.50', name:'Samordning före igenbyggnad', tasks:[
      { title:'Frigör golv för igenbyggnad', activities:[
        {title:'Kontrollera att relevanta installationer i golvet är klara',type:'check'},
        {title:'Kontrollera att obligatorisk dokumentation finns',type:'check'},
        {title:'Fotografera hela konstruktionen före igenbyggnad',type:'document'},
        {title:'Frigör golvkonstruktionen för nästa steg',type:'approval'}
      ]},
      { title:'Frigör väggar för igenbyggnad', activities:[
        {title:'Kontrollera att relevanta installationer i väggarna är klara',type:'check'},
        {title:'Kontrollera förstärkningar, genomföringar och brandtätningar',type:'check'},
        {title:'Säkerställ myndighetens arbetsplatsbesök innan allt byggs igen',type:'approval'},
        {title:'Kontrollera att obligatorisk dokumentation finns',type:'check'},
        {title:'Fotografera väggar före igenbyggnad',type:'document'},
        {title:'Frigör väggarna för nästa steg',type:'approval'}
      ]},
      { title:'Frigör innertak för igenbyggnad', activities:[
        {title:'Kontrollera att installationer ovan innertak är klara',type:'check'},
        {title:'Kontrollera genomföringar och lufttäthet',type:'check'},
        {title:'Fotografera ovan innertak före igenbyggnad',type:'document'},
        {title:'Frigör innertaket för nästa steg',type:'approval'}
      ]}
    ]}
  ]},
  { number:'70', name:'Invändiga konstruktioner', sections:[
    { number:'70.10', name:'Golv', tasks:[{ title:'Färdigställ golvkonstruktion', activities:[
      {title:'Kontrollera att golvet är frigivet för igenbyggnad',type:'check'},
      {title:'Montera isolering och kompletterande skikt',type:'perform'},
      {title:'Kontrollera isolering och installationer före stängning',type:'check'},
      {title:'Montera undergolv',type:'perform'},
      {title:'Kontrollera nivå, planhet och genomföringar',type:'check'}
    ]}]},
    { number:'70.20', name:'Innerväggar', tasks:[{ title:'Bygg innerväggar', activities:[
      {title:'Märk ut innerväggar och öppningar',type:'perform'},
      {title:'Bygg innerväggsstomme',type:'perform'},
      {title:'Montera förstärkningar för fast inredning',type:'perform'},
      {title:'Kontrollera mått, lod och öppningar',type:'check'},
      {title:'Fotografera förstärkningar och stomme före igenbyggnad',type:'document'},
      {title:'Genomför KA-kontroll under pågående invändiga arbeten',type:'approval'},
      {title:'Kontrollera att väggen är frigiven för igenbyggnad',type:'check'},
      {title:'Isolera väggen där det krävs',type:'perform'},
      {title:'Montera väggbeklädnad',type:'perform'}
    ]}]},
    { number:'70.30', name:'Innertak', tasks:[{ title:'Montera innertak', activities:[
      {title:'Kontrollera att innertaket är frigivet för igenbyggnad',type:'check'},
      {title:'Kontrollera glespanel och infästningspunkter',type:'check'},
      {title:'Montera innertak',type:'perform'},
      {title:'Kontrollera genomföringar och avslutningar',type:'check'}
    ]}]}
  ]},
  { number:'80', name:'Våtrum', sections:[
    { number:'80.10', name:'Förbered våtrum', tasks:[{ title:'Kontrollera våtrumsförutsättningar', activities:[
      {title:'Kontrollera våtrumsritning och vald systemlösning',type:'check'},
      {title:'Kontrollera golvbrunn och placering',type:'check'},
      {title:'Kontrollera väggförstärkningar och genomföringar',type:'check'},
      {title:'Kontrollera godkända underlag för valt tätskiktssystem',type:'check'},
      {title:'Registrera behörighet eller redovisa vald våtrumsmetod',type:'document'}
    ]}]},
    { number:'80.20', name:'Golv och väggunderlag', tasks:[{ title:'Bygg våtrumsunderlag', activities:[
      {title:'Bygg golvunderlag',type:'perform'},
      {title:'Skapa föreskrivet fall mot golvbrunn',type:'perform'},
      {title:'Kontrollera fall och brunnshöjd',type:'measurement'},
      {title:'Bygg väggunderlag',type:'perform'},
      {title:'Kontrollera underlag före tätskikt',type:'check'},
      {title:'Fotografera färdigt underlag före tätskikt',type:'document'}
    ]}]},
    { number:'80.30', name:'Tätskikt', tasks:[{ title:'Utför tätskikt', activities:[
      {title:'Kontrollera material och systemkomponenter',type:'check'},
      {title:'Montera manschetter och förstärkningar',type:'perform'},
      {title:'Täta genomföringar och hörn',type:'perform'},
      {title:'Utför tätskikt enligt systemanvisning',type:'perform'},
      {title:'Kontrollera tätskikt före ytskikt',type:'check'},
      {title:'Fotografera tätskikt, golvbrunn och genomföringar',type:'document'},
      {title:'Frigör våtrummet för ytskikt',type:'approval'}
    ]}]},
    { number:'80.40', name:'Ytskikt och färdigställande', tasks:[{ title:'Färdigställ våtrum', activities:[
      {title:'Montera våtrummets ytskikt',type:'perform'},
      {title:'Montera sanitetsutrustning och inredning',type:'perform'},
      {title:'Kontrollera tätningar och anslutningar',type:'check'},
      {title:'Kontrollera golvfall och funktion',type:'check'},
      {title:'Samla tätskiktsdokumentation och intyg',type:'document'},
      {title:'Fotografera färdigt våtrum',type:'document'}
    ]}]}
  ]},
  { number:'90', name:'Invändiga ytskikt och inredning', sections:[
    { number:'90.10', name:'Ytskikt', tasks:[{ title:'Färdigställ invändiga ytskikt', activities:[
      {title:'Kontrollera underlag före ytskikt',type:'check'},
      {title:'Färdigställ väggytor',type:'perform'},
      {title:'Färdigställ takytor',type:'perform'},
      {title:'Lägg färdiga golv',type:'perform'},
      {title:'Kontrollera färdiga ytor och anslutningar',type:'check'}
    ]}]},
    { number:'90.20', name:'Kök och fast inredning', tasks:[{ title:'Montera fast inredning', activities:[
      {title:'Kontrollera förstärkningar och installationspunkter',type:'check'},
      {title:'Montera kök och fast inredning',type:'perform'},
      {title:'Montera vitvaror och anslutningar genom behörig installatör där det krävs',type:'perform'},
      {title:'Kontrollera funktion och infästning',type:'check'}
    ]}]},
    { number:'90.30', name:'Trappor, räcken och säkerhet', tasks:[{ title:'Montera trappor och skydd', activities:[
      {title:'Kontrollera trappmått och frihöjd',type:'measurement'},
      {title:'Montera trappa',type:'perform'},
      {title:'Montera räcken och handledare',type:'perform'},
      {title:'Kontrollera stabilitet och personsäkerhet',type:'check'},
      {title:'Kontrollera barnsäkerhetsåtgärder där det krävs',type:'check'}
    ]}]}
  ]},
  { number:'100', name:'Utvändiga arbeten och tomt', sections:[
    { number:'100.10', name:'Dagvatten och mark', tasks:[{ title:'Färdigställ dagvatten och mark', activities:[
      {title:'Kontrollera dagvattenlösning mot beslutad handling',type:'check'},
      {title:'Montera eller färdigställ dagvattenledningar och utlopp',type:'perform'},
      {title:'Fotografera dolda dagvattenlösningar före täckning',type:'document'},
      {title:'Forma slutliga marknivåer och markfall',type:'perform'},
      {title:'Kontrollera markfall från byggnaden',type:'measurement'}
    ]}]},
    { number:'100.20', name:'VA utvändigt', tasks:[{ title:'Färdigställ utvändigt VA', activities:[
      {title:'Kontrollera ledningssträckning och anslutningspunkter',type:'check'},
      {title:'Montera utvändiga vatten- och spillvattenledningar',type:'perform'},
      {title:'Kontrollera bädd, dimensioner, fall och frostskydd',type:'measurement'},
      {title:'Fotografera ledningar och anslutningar före återfyllnad',type:'document'},
      {title:'Genomför VA-inspektion före övertäckning',type:'approval'},
      {title:'Utför föreskrivna prov och kontroller',type:'measurement'},
      {title:'Återfyll ledningsschakt',type:'perform'}
    ]}]}
  ]},
  { number:'110', name:'Provning och driftsättning', sections:[
    { number:'110.10', name:'Installationer', tasks:[{ title:'Prova och driftsätt installationer', activities:[
      {title:'Driftsätt vatten och kontrollera läckage',type:'check'},
      {title:'Funktionsprova spillvatten',type:'check'},
      {title:'Registrera provtryckningsprotokoll VA',type:'document'},
      {title:'Genomför och dokumentera isolationsprovning el',type:'document'},
      {title:'Funktionskontrollera jordfelsbrytare',type:'check'},
      {title:'Funktionsprova ventilation',type:'measurement'},
      {title:'Funktionsprova uppvärmning',type:'check'},
      {title:'Registrera övriga protokoll och intyg',type:'document'}
    ]}]},
    { number:'110.20', name:'Byggnadens funktion', tasks:[{ title:'Kontrollera färdig byggnad', activities:[
      {title:'Kontrollera fönster och dörrars funktion',type:'check'},
      {title:'Kontrollera takavvattning och dagvattenfunktion',type:'check'},
      {title:'Kontrollera brand- och personsäkerhetsdetaljer',type:'check'},
      {title:'Dokumentera kvarstående avvikelser',type:'document'}
    ]}]}
  ]},
  { number:'120', name:'Slutkontroll och slutbesked', sections:[
    { number:'120.10', name:'Samlad dokumentation', tasks:[{ title:'Samla slutdokumentation', activities:[
      {title:'Kontrollera att alla obligatoriska aktiviteter är slutförda',type:'check'},
      {title:'Kontrollera att styrande poster är mappade eller hanterade som undantag',type:'check'},
      {title:'Kontrollera att obligatoriska foton och mätvärden finns',type:'check'},
      {title:'Upprätta relationshandlingar för dagvatten och utvändigt VA',type:'document'},
      {title:'Upprätta slutlig brandskyddsdokumentation där det krävs',type:'document'},
      {title:'Kontrollera färdig byggnad mot bygglov och upprätta byggherreintyg',type:'document'},
      {title:'Samla intyg, protokoll och produktdokumentation',type:'document'},
      {title:'Hantera kvarstående avvikelser',type:'check'}
    ]}]},
    { number:'120.20', name:'Slutbesked', tasks:[{ title:'Förbered och avsluta slutbesked', activities:[
      {title:'Förbered underlag inför slutsamråd eller slutbesked',type:'document'},
      {title:'Genomför slutsamråd eller motsvarande avslutande kontroll',type:'approval'},
      {title:'Komplettera efter eventuella krav från kommunen',type:'perform'},
      {title:'Registrera slutbesked',type:'document'},
      {title:'Avsluta projektet i ByggPlan',type:'approval'}
    ]}]}
  ]}
];

async function ensureSchema(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS master_projects(
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    version INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS master_work_areas(
    id TEXT PRIMARY KEY, master_project_id TEXT NOT NULL, number TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, sort_order INTEGER NOT NULL,
    FOREIGN KEY(master_project_id) REFERENCES master_projects(id) ON DELETE CASCADE
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS master_work_sections(
    id TEXT PRIMARY KEY, master_work_area_id TEXT NOT NULL, number TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, sort_order INTEGER NOT NULL,
    FOREIGN KEY(master_work_area_id) REFERENCES master_work_areas(id) ON DELETE CASCADE
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS master_tasks(
    id TEXT PRIMARY KEY, master_work_section_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL,
    FOREIGN KEY(master_work_section_id) REFERENCES master_work_sections(id) ON DELETE CASCADE
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS master_activities(
    id TEXT PRIMARY KEY, master_task_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', activity_type TEXT NOT NULL DEFAULT 'perform', required INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL,
    FOREIGN KEY(master_task_id) REFERENCES master_tasks(id) ON DELETE CASCADE
  )`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_master_area_project ON master_work_areas(master_project_id,sort_order)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_master_section_area ON master_work_sections(master_work_area_id,sort_order)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_master_task_section ON master_tasks(master_work_section_id,sort_order)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_master_activity_task ON master_activities(master_task_id,sort_order)').run();
}

export function registerMasterProjectRoutes(app: RouteApp) {
  app.get('/api/studio/master-projects', async c => {
    await ensureSchema(c.env.DB);
    const rows = await c.env.DB.prepare(`SELECT mp.id,mp.code,mp.name,mp.description,mp.version,mp.status,
      COUNT(DISTINCT a.id) AS area_count,COUNT(DISTINCT s.id) AS section_count,COUNT(DISTINCT t.id) AS task_count,COUNT(DISTINCT ac.id) AS activity_count
      FROM master_projects mp
      LEFT JOIN master_work_areas a ON a.master_project_id=mp.id
      LEFT JOIN master_work_sections s ON s.master_work_area_id=a.id
      LEFT JOIN master_tasks t ON t.master_work_section_id=s.id
      LEFT JOIN master_activities ac ON ac.master_task_id=t.id
      GROUP BY mp.id ORDER BY mp.name`).all();
    return c.json({ ok:true, masterProjects:rows.results });
  });

  app.get('/api/studio/master-projects/:id/tree', async c => {
    await ensureSchema(c.env.DB);
    const id = c.req.param('id');
    const masterProject = await c.env.DB.prepare('SELECT id,code,name,description,version,status FROM master_projects WHERE id=?').bind(id).first();
    if (!masterProject) return c.json({ok:false,error:'Masterprojektet hittades inte.'},404);
    const [areas,sections,tasks,activities] = await Promise.all([
      c.env.DB.prepare('SELECT id,master_project_id,number,name,sort_order FROM master_work_areas WHERE master_project_id=? ORDER BY sort_order').bind(id).all(),
      c.env.DB.prepare(`SELECT s.id,s.master_work_area_id,s.number,s.name,s.sort_order FROM master_work_sections s JOIN master_work_areas a ON a.id=s.master_work_area_id WHERE a.master_project_id=? ORDER BY a.sort_order,s.sort_order`).bind(id).all(),
      c.env.DB.prepare(`SELECT t.id,t.master_work_section_id,t.title,t.description,t.sort_order FROM master_tasks t JOIN master_work_sections s ON s.id=t.master_work_section_id JOIN master_work_areas a ON a.id=s.master_work_area_id WHERE a.master_project_id=? ORDER BY a.sort_order,s.sort_order,t.sort_order`).bind(id).all(),
      c.env.DB.prepare(`SELECT ac.id,ac.master_task_id,ac.title,ac.description,ac.activity_type,ac.required,ac.sort_order FROM master_activities ac JOIN master_tasks t ON t.id=ac.master_task_id JOIN master_work_sections s ON s.id=t.master_work_section_id JOIN master_work_areas a ON a.id=s.master_work_area_id WHERE a.master_project_id=? ORDER BY a.sort_order,s.sort_order,t.sort_order,ac.sort_order`).bind(id).all()
    ]);
    return c.json({ok:true,masterProject,areas:areas.results,sections:sections.results,tasks:tasks.results,activities:activities.results});
  });

  app.post('/api/studio/master-projects/bootstrap-fritidshus', async c => {
    await ensureSchema(c.env.DB);
    const existing = await c.env.DB.prepare("SELECT id FROM master_projects WHERE code='fritidshus'").first<{id:string}>();
    if (existing) return c.json({ok:true,id:existing.id,created:false});
    const masterId=crypto.randomUUID();
    await c.env.DB.prepare(`INSERT INTO master_projects(id,code,name,description,version,status) VALUES(?,?,?,?,1,'active')`).bind(masterId,'fritidshus','Masterprojekt – Fritidshus','Generell byggprocess från startbesked till slutbesked. Byggmetoder kompletteras med moduler.').run();
    let areaOrder=0,areaCount=0,sectionCount=0,taskCount=0,activityCount=0;
    for(const area of FRITIDSHUS_AREAS){
      areaOrder+=10; const areaId=crypto.randomUUID();
      await c.env.DB.prepare('INSERT INTO master_work_areas(id,master_project_id,number,name,sort_order) VALUES(?,?,?,?,?)').bind(areaId,masterId,area.number,area.name,areaOrder).run(); areaCount++;
      let sectionOrder=0;
      for(const section of area.sections){
        sectionOrder+=10; const sectionId=crypto.randomUUID();
        await c.env.DB.prepare('INSERT INTO master_work_sections(id,master_work_area_id,number,name,sort_order) VALUES(?,?,?,?,?)').bind(sectionId,areaId,section.number,section.name,sectionOrder).run(); sectionCount++;
        let taskOrder=0;
        for(const task of section.tasks){
          taskOrder+=10; const taskId=crypto.randomUUID();
          await c.env.DB.prepare('INSERT INTO master_tasks(id,master_work_section_id,title,description,sort_order) VALUES(?,?,?,?,?)').bind(taskId,sectionId,task.title,task.description||'',taskOrder).run(); taskCount++;
          let activityOrder=0;
          for(const activity of task.activities){
            activityOrder+=10;
            await c.env.DB.prepare('INSERT INTO master_activities(id,master_task_id,title,description,activity_type,required,sort_order) VALUES(?,?,?,?,?,1,?)').bind(crypto.randomUUID(),taskId,activity.title,activity.description||'',activity.type,activityOrder).run(); activityCount++;
          }
        }
      }
    }
    return c.json({ok:true,id:masterId,created:true,counts:{areas:areaCount,sections:sectionCount,tasks:taskCount,activities:activityCount}},201);
  });
}
