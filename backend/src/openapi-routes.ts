type RouteApp={get:(path:string,handler:(c:any)=>unknown)=>void};

const projectId={name:'projectId',in:'path',required:true,schema:{type:'string'},description:'Projektets UUID'};
const activityId={name:'activityId',in:'path',required:true,schema:{type:'string'},description:'Aktivitetens UUID'};
const documentId={name:'id',in:'path',required:true,schema:{type:'string'},description:'Styrdokumentets UUID'};
const jsonBody=(description:string,example:any)=>({required:true,content:{'application/json':{schema:{type:'object'},example,description}}});
const ok={description:'OK',content:{'application/json':{schema:{type:'object'}}}};

export function registerOpenApiRoutes(app:RouteApp){
  app.get('/api/openapi.json',c=>c.json({
    openapi:'3.1.0',
    info:{
      title:'ByggPlan API',
      version:'2026-09-12',
      description:'Intern OpenAPI-specifikation för ByggPlan Studio. API Browser i Studio använder samma-origin-transporten, vilket gör att anrop fungerar även på nätverk som blockerar synliga URL-sökvägar.'
    },
    servers:[{url:'/',description:'ByggPlan Studio same-origin transport'}],
    tags:[
      {name:'Projekt'},{name:'Struktur'},{name:'Projektstyrning'},{name:'Styrdokument'},{name:'Master'},{name:'Fältmetadata'},{name:'Diagnostik'}
    ],
    paths:{
      '/api/projects':{get:{tags:['Projekt'],summary:'Lista projekt',responses:{'200':ok}}},
      '/api/studio/structure':{get:{tags:['Struktur'],summary:'Läs projektets redigerbara struktur',parameters:[{name:'projectId',in:'query',required:true,schema:{type:'string'}}],responses:{'200':ok}}},
      '/api/studio/projects/{projectId}/structure-audit':{get:{tags:['Diagnostik'],summary:'Strukturrevision',description:'Read-only revision av hela projektträdet med metadata och misstänkta strukturproblem/dubletter.',parameters:[projectId],responses:{'200':ok}}},
      '/api/studio/projects/{projectId}/project-conditions':{
        get:{tags:['Projektstyrning'],summary:'Lista projektvillkor',parameters:[projectId],responses:{'200':ok}},
        post:{tags:['Projektstyrning'],summary:'Skapa projektspecifikt projektvillkor',parameters:[projectId],requestBody:jsonBody('Projektvillkor',{title:'Fuktskydd under byggtid',description:'Material och konstruktion ska skyddas mot nederbörd och byggfukt under hela byggtiden.'}),responses:{'201':ok}}
      },
      '/api/studio/projects/{projectId}/project-conditions/from-activity/{activityId}':{post:{tags:['Projektstyrning'],summary:'Flytta aktivitet till projektvillkor',parameters:[projectId,activityId],responses:{'200':ok}}},
      '/api/studio/project-administration':{
        get:{tags:['Projektstyrning'],summary:'Lista administrativa kontrollpunkter',parameters:[{name:'projectId',in:'query',required:true,schema:{type:'string'}}],responses:{'200':ok}},
        post:{tags:['Projektstyrning'],summary:'Skapa administrativ kontrollpunkt',requestBody:jsonBody('Ny administrativ kontrollpunkt',{projectId:'{projectId}',title:'Ny punkt',valueText:'',note:'',completed:false}),responses:{'201':ok}}
      },
      '/api/studio/projects/{projectId}/context':{
        get:{tags:['Projekt'],summary:'Läs projektkontext',parameters:[projectId],responses:{'200':ok}},
        put:{tags:['Projekt'],summary:'Ändra projektkontext',parameters:[projectId],requestBody:jsonBody('Projektkontext',{deliveryMode:'self_build'}),responses:{'200':ok}}
      },
      '/api/studio/projects/{projectId}/governing-documents':{get:{tags:['Styrdokument'],summary:'Lista styrdokument i projekt',description:'Visar projektets styrdokument och deras dokument-ID. Använd dokument-ID:t för att läsa samtliga analyserade poster i ett dokument.',parameters:[projectId],responses:{'200':ok}}},
      '/api/studio/governing-documents/{id}':{get:{tags:['Styrdokument'],summary:'Läs styrdokument med alla poster',description:'Returnerar styrdokumentets metadata och alla analyserade styrposter i sorteringsordning, inklusive antal kopplade aktiviteter.',parameters:[documentId],responses:{'200':ok}}},
      '/api/studio/governing-documents/{id}/analysis':{delete:{tags:['Styrdokument'],summary:'Nollställ styrdokumentanalys',description:'Tar bort dokumentets befintliga styrposter och deras aktivitetskopplingar så att analysen kan köras om. Originalfilen och själva styrdokumentet behålls.',parameters:[documentId],responses:{'200':ok,'404':ok}}},
      '/api/studio/governing-documents/{id}/analyze-generic':{post:{tags:['Styrdokument'],summary:'Starta generell AI-analys av styrdokument',description:'Köar den generella AI-analysen och returnerar direkt ett analysisRunId. Själva analysen körs asynkront.',parameters:[documentId],responses:{'202':ok,'400':ok,'404':ok,'409':ok,'500':ok,'503':ok}}},
      '/api/studio/governing-documents/{id}/analysis-status':{get:{tags:['Diagnostik','Styrdokument'],summary:'Läs status för senaste AI-analysen',description:'Visar status för den senaste asynkrona dokumentanalysen: not_started, queued, processing, completed eller failed. Vid completed finns analysresultatet i result.',parameters:[documentId],responses:{'200':ok,'403':ok,'404':ok}}},
      '/api/studio/governing-documents/{id}/conversion-diagnostics':{post:{tags:['Diagnostik','Styrdokument'],summary:'Diagnostisera dokumentkonvertering',description:'Konverterar originalfilen med Workers AI toMarkdown utan att köra AI-analysen eller ändra styrposter. Returnerar tokenantal, tecken/linjer och upp till 30 000 tecken av den Markdown som analysmodellen faktiskt får.',parameters:[documentId],responses:{'200':ok,'404':ok,'500':ok,'503':ok}}},
      '/api/studio/governing-documents/{id}/vision-conversion-diagnostics':{post:{tags:['Diagnostik','Styrdokument'],summary:'Diagnostisera PDF-bildtolkning sida för sida',description:'Renderar PDF-sidor till bilder med samma Browser Run-väg som analysens fallback och kör Workers AI toMarkdown på varje sida separat. Returnerar Markdown, tokenantal, tecken och rader per sida samt sammanslagen Markdown. Ändrar inte analysresultat eller styrposter.',parameters:[documentId],responses:{'200':ok,'400':ok,'404':ok,'500':ok,'503':ok}}},
      '/api/studio/projects/{projectId}/governing-mapping':{get:{tags:['Styrdokument'],summary:'Läs kartläggning mot styrdokument',parameters:[projectId],responses:{'200':ok}}},
      '/api/studio/projects/{projectId}/project-activity-placement-options':{get:{tags:['Struktur'],summary:'Lista möjliga placeringar för projektspecifik aktivitet',parameters:[projectId],responses:{'200':ok}}},
      '/api/project-field-metadata':{get:{tags:['Fältmetadata'],summary:'Läs fältmetadata för aktiviteter',parameters:[{name:'projectId',in:'query',required:true,schema:{type:'string'}}],responses:{'200':ok}}},
      '/api/project-execution-contexts':{get:{tags:['Fältmetadata'],summary:'Läs utförandekontext',parameters:[{name:'projectId',in:'query',required:true,schema:{type:'string'}}],responses:{'200':ok}}},
      '/api/studio/projects/{projectId}/master-diagnostics':{get:{tags:['Master'],summary:'Masterdiagnostik för projekt',parameters:[projectId],responses:{'200':ok}}},
      '/api/studio/projects/{projectId}/repair-from-master':{post:{tags:['Master'],summary:'Reparera/synka projekt från Master',description:'Skrivande åtgärd. Använd med försiktighet.',parameters:[projectId],responses:{'200':ok}}},
      '/api/studio/work-areas':{post:{tags:['Struktur'],summary:'Skapa arbetsområde',requestBody:jsonBody('Arbetsområde',{projectId:'{projectId}',name:'Nytt arbetsområde'}),responses:{'201':ok}}},
      '/api/studio/work-sections':{post:{tags:['Struktur'],summary:'Skapa arbetsavsnitt',requestBody:jsonBody('Arbetsavsnitt',{workAreaId:'',name:'Nytt arbetsavsnitt'}),responses:{'201':ok}}},
      '/api/studio/tasks':{post:{tags:['Struktur'],summary:'Skapa moment',requestBody:jsonBody('Moment',{workSectionId:'',title:'Nytt moment',description:''}),responses:{'201':ok}}},
      '/api/studio/activities':{post:{tags:['Struktur'],summary:'Skapa aktivitet',requestBody:jsonBody('Aktivitet',{taskId:'',title:'Ny aktivitet',description:'',activityType:'work'}),responses:{'201':ok}}}
    }
  }));
}
