type RouteApp = {
  get: (path: string, handler: (c: any) => unknown) => void;
  put: (path: string, handler: (c: any) => unknown) => void;
};

const EXCEPTION_STATUSES = ['not_applicable','cannot_verify','alternative_evidence'];

async function addColumnIfMissing(db: D1Database, sql: string) {
  try { await db.prepare(sql).run(); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.toLowerCase().includes('duplicate column')) throw error;
  }
}

async function ensureMappingSchema(db: D1Database) {
  await addColumnIfMissing(db, "ALTER TABLE governing_items ADD COLUMN source_note TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing(db, "ALTER TABLE governing_item_activity_links ADD COLUMN mapping_source TEXT NOT NULL DEFAULT 'manual'");
  await addColumnIfMissing(db, 'ALTER TABLE governing_item_activity_links ADD COLUMN confidence INTEGER');
  await addColumnIfMissing(db, "ALTER TABLE governing_item_activity_links ADD COLUMN mapping_comment TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing(db, 'ALTER TABLE governing_item_activity_links ADD COLUMN confirmed_at TEXT');
  await db.prepare(`
    UPDATE governing_item_activity_links
       SET mapping_source=COALESCE(NULLIF(mapping_source,''),'manual'),
           confirmed_at=COALESCE(confirmed_at,created_at)
     WHERE mapping_source IS NULL OR mapping_source='' OR confirmed_at IS NULL
  `).run();
}

function normalized(value: unknown) {
  return String(value || '').toLocaleLowerCase('sv-SE')
    .replace(/[–—]/g,'-').replace(/[^a-zåäö0-9+\-/ ]/g,' ').replace(/\s+/g,' ').trim();
}

const STOP_WORDS = new Set([
  'enligt','eller','samt','skall','ska','utförd','utföras','kontroll','kontrollera','dokumentation',
  'upprättad','beaktad','genomför','genomförd','erforderlig','erforderliga','byggnaden','byggnadens','projektet'
]);

function words(value: unknown) {
  return normalized(value).split(/\s+/).filter(word => word.length >= 4 && !STOP_WORDS.has(word));
}

type ConceptRule = { code:string; patterns:RegExp[] };
const CONCEPTS: ConceptRule[] = [
  {code:'setout',patterns:[/utsätt/,/referenshöjd/]},
  {code:'location_control',patterns:[/lägeskontroll/,/kontrollmät/,/mätintyg/,/byggnadens placering/]},
  {code:'bas_p',patterns:[/bas-p/,/bas p/]},
  {code:'bas_u',patterns:[/bas-u/,/bas u/]},
  {code:'work_environment',patterns:[/arbetsmiljö/]},
  {code:'start_meeting',patterns:[/startmöte/]},
  {code:'ka_ground_visit',patterns:[/besök.*grundbotten/,/grundbotten.*ka/]},
  {code:'ka_frame_visit',patterns:[/besök.*stomm.*rest/,/stomm.*rest.*ka/]},
  {code:'authority_site_visit',patterns:[/arbetsplatsbesök/,/byggnadsnämnd.*besök/]},
  {code:'permit_conformance',patterns:[/överensstämmelse.*bygglov/,/bygglov.*överensstämmelse/,/färdig.*mot.*lov/]},
  {code:'geotechnical',patterns:[/geotekn/]},
  {code:'radon',patterns:[/radon/]},
  {code:'structural_control',patterns:[/bärande stom/,/konstruktionshandling/,/stomkontroll/]},
  {code:'fire_description',patterns:[/brandskyddsbeskriv/]},
  {code:'fire_documentation',patterns:[/brandskyddsdokument/]},
  {code:'fire',patterns:[/brandskydd/,/brandvarn/,/rökkanal/,/sotar/,/eldstad/]},
  {code:'stormwater',patterns:[/dagvatten/,/markfall/,/\blod\b/]},
  {code:'wetroom_method',patterns:[/byggkeramik/,/våtrumsmetod/,/tätskikt/]},
  {code:'moisture',patterns:[/fuktsäker/,/fuktskydd/,/fukt/]},
  {code:'vvs_pressure',patterns:[/provtryck/,/täthets.*vvs/,/vvs.*täthet/]},
  {code:'vvs',patterns:[/\bvvs\b/,/spillvatten/,/vatteninstallation/,/\bva\b/]},
  {code:'electrical_contractor',patterns:[/elinstallationsföretag/,/registrerat.*el/]},
  {code:'electrical_insulation',patterns:[/isolationsprov/]},
  {code:'electrical_rcd',patterns:[/jordfelsbryt/]},
  {code:'electrical',patterns:[/elinstallation/,/elarbet/,/elintyg/,/elsäker/]},
  {code:'architect_control',patterns:[/arkitektens egenkontroll/]},
  {code:'accessibility',patterns:[/tillgänglighet/,/användbarhet/]},
  {code:'broadband',patterns:[/bredband/,/fiberanslut/,/fiber/]},
  {code:'final_docs',patterns:[/slutdokument/,/relationshandling/,/intyg.*protokoll/]}
];

function concepts(value: unknown) {
  const text = normalized(value);
  const result = new Set<string>();
  for (const rule of CONCEPTS) if (rule.patterns.some(pattern => pattern.test(text))) result.add(rule.code);
  return result;
}

function broadDomain(code: string) {
  if (['setout','location_control'].includes(code)) return 'location';
  if (['bas_p','bas_u','work_environment','start_meeting'].includes(code)) return 'administration';
  if (['ka_ground_visit','geotechnical','radon'].includes(code)) return 'ground';
  if (['ka_frame_visit','structural_control'].includes(code)) return 'structure';
  if (['authority_site_visit','permit_conformance'].includes(code)) return 'authority';
  if (code.startsWith('fire')) return 'fire';
  if (code === 'stormwater') return 'stormwater';
  if (code === 'wetroom_method') return 'wetroom';
  if (code === 'moisture') return 'moisture';
  if (code.startsWith('vvs')) return 'vvs';
  if (code.startsWith('electrical')) return 'electrical';
  if (['architect_control','accessibility'].includes(code)) return 'architecture';
  if (code === 'broadband') return 'broadband';
  return code;
}

function overlap<T>(a:Set<T>,b:Set<T>) { for (const x of a) if (b.has(x)) return true; return false; }

function similarity(item: any, activity: any) {
  const sourceText = `${item.description} ${item.section_title} ${item.source_note || ''}`;
  const targetText = `${activity.title} ${activity.description || ''} ${activity.task_title} ${activity.section_name} ${activity.area_name}`;
  const sourceConcepts = concepts(sourceText);
  const targetConcepts = concepts(targetText);
  const sourceDomains = new Set([...sourceConcepts].map(broadDomain));
  const targetDomains = new Set([...targetConcepts].map(broadDomain));

  // A known subject area must never be matched to another known subject area.
  if (sourceDomains.size && targetDomains.size && !overlap(sourceDomains,targetDomains)) return 0;

  const sourceWords = new Set(words(sourceText));
  const targetWords = new Set(words(targetText));
  let wordHits = 0;
  for (const word of sourceWords) if (targetWords.has(word)) wordHits += 1;
  const lexical = sourceWords.size && targetWords.size
    ? Math.round(35 * wordHits / Math.max(2,Math.min(sourceWords.size,targetWords.size))) : 0;

  const exactConcept = overlap(sourceConcepts,targetConcepts);
  const sameDomain = overlap(sourceDomains,targetDomains);
  let score = lexical;
  if (exactConcept) score += 62;
  else if (sameDomain) score += 36;

  // If the source has a clear concept but the activity cannot even be classified,
  // only lexical evidence is allowed and it must be strong.
  if (sourceConcepts.size && !targetConcepts.size) score = Math.min(score, lexical >= 24 ? 48 : 0);

  return Math.max(0,Math.min(98,score));
}

export function registerGoverningMappingRoutes(app: RouteApp) {
  app.get('/api/studio/projects/:projectId/governing-mapping', async c => {
    await ensureMappingSchema(c.env.DB);
    const projectId = c.req.param('projectId');

    const documents = await c.env.DB.prepare(`
      SELECT d.id,d.document_type,d.title,d.issuer,d.reference,
             COUNT(i.id) AS item_count,
             SUM(CASE WHEN i.handling_status NOT IN ('not_applicable','cannot_verify','alternative_evidence') AND EXISTS(
               SELECT 1 FROM governing_item_activity_links l WHERE l.governing_item_id=i.id
             ) THEN 1 ELSE 0 END) AS mapped_count,
             SUM(CASE WHEN i.handling_status IN ('not_applicable','cannot_verify','alternative_evidence') THEN 1 ELSE 0 END) AS exception_count,
             SUM(CASE WHEN i.handling_status NOT IN ('not_applicable','cannot_verify','alternative_evidence') AND NOT EXISTS(
               SELECT 1 FROM governing_item_activity_links l WHERE l.governing_item_id=i.id
             ) THEN 1 ELSE 0 END) AS uncovered_count
        FROM governing_documents d
        LEFT JOIN governing_items i ON i.governing_document_id=d.id
       WHERE d.project_id=?
       GROUP BY d.id
       ORDER BY CASE d.document_type WHEN 'control_plan' THEN 0 ELSE 1 END,d.imported_at,d.title
    `).bind(projectId).all();

    const items = await c.env.DB.prepare(`
      SELECT i.id,i.governing_document_id,i.code,i.description,i.section_code,i.section_title,
             i.item_type,i.responsible_role,i.handling_status,i.source_note,
             COUNT(l.id) AS mapped_activity_count,
             GROUP_CONCAT(a.title,' || ') AS mapped_activity_titles
        FROM governing_items i
        JOIN governing_documents d ON d.id=i.governing_document_id
        LEFT JOIN governing_item_activity_links l ON l.governing_item_id=i.id
        LEFT JOIN activities a ON a.id=l.activity_id
       WHERE d.project_id=?
       GROUP BY i.id
       ORDER BY d.imported_at,i.sort_order,i.id
    `).bind(projectId).all();

    const activities = await c.env.DB.prepare(`
      SELECT a.id,a.title,a.description,a.activity_type,
             t.title AS task_title,ws.name AS section_name,wa.name AS area_name,
             COUNT(l.id) AS governing_item_count
        FROM activities a
        JOIN tasks t ON t.id=a.task_id
        JOIN work_sections ws ON ws.id=t.work_section_id
        JOIN work_areas wa ON wa.id=ws.work_area_id
        LEFT JOIN governing_item_activity_links l ON l.activity_id=a.id
       WHERE wa.project_id=?
       GROUP BY a.id
       ORDER BY wa.sort_order,ws.sort_order,t.sort_order,a.sort_order
    `).bind(projectId).all();

    const activityRows = activities.results as any[];
    const suggestions: Record<string,any[]> = {};
    for (const item of items.results as any[]) {
      if (Number(item.mapped_activity_count || 0) > 0 || EXCEPTION_STATUSES.includes(String(item.handling_status || ''))) continue;
      const ranked = activityRows
        .map(activity => ({ activity, confidence: similarity(item,activity) }))
        .filter(candidate => candidate.confidence >= 48)
        .sort((a,b) => b.confidence-a.confidence)
        .slice(0,3)
        .map(candidate => ({
          activity_id: candidate.activity.id,title:candidate.activity.title,task_title:candidate.activity.task_title,
          section_name:candidate.activity.section_name,area_name:candidate.activity.area_name,confidence:candidate.confidence
        }));
      if (ranked.length) suggestions[String(item.id)] = ranked;
    }

    const documentRows = (documents.results as any[]).map(row => {
      const itemCount=Number(row.item_count||0),mappedCount=Number(row.mapped_count||0),exceptionCount=Number(row.exception_count||0),uncoveredCount=Number(row.uncovered_count||0);
      const coveredCount=mappedCount+exceptionCount;
      return {...row,item_count:itemCount,mapped_count:mappedCount,exception_count:exceptionCount,covered_count:coveredCount,uncovered_count:uncoveredCount,coverage_percent:itemCount?Math.round(coveredCount*100/itemCount):100};
    });
    const total=documentRows.reduce((s,r)=>s+r.item_count,0),mapped=documentRows.reduce((s,r)=>s+r.mapped_count,0),exceptions=documentRows.reduce((s,r)=>s+r.exception_count,0),uncovered=documentRows.reduce((s,r)=>s+r.uncovered_count,0),covered=mapped+exceptions;
    return c.json({ok:true,summary:{item_count:total,mapped_count:mapped,exception_count:exceptions,covered_count:covered,uncovered_count:uncovered,coverage_percent:total?Math.round(covered*100/total):100},documents:documentRows,items:items.results,activities:activityRows,suggestions});
  });

  app.put('/api/studio/governing-items/:itemId/mappings/:activityId', async c => {
    await ensureMappingSchema(c.env.DB);
    const itemId=c.req.param('itemId'),activityId=c.req.param('activityId');
    const body=await c.req.json<Record<string,unknown>>().catch(()=>({}));
    const pair=await c.env.DB.prepare(`
      SELECT i.id AS item_id,a.id AS activity_id FROM governing_items i
      JOIN governing_documents d ON d.id=i.governing_document_id JOIN activities a
      JOIN tasks t ON t.id=a.task_id JOIN work_sections ws ON ws.id=t.work_section_id
      JOIN work_areas wa ON wa.id=ws.work_area_id WHERE i.id=? AND a.id=? AND d.project_id=wa.project_id
    `).bind(itemId,activityId).first();
    if(!pair)return c.json({ok:false,error:'Posten och aktiviteten tillhör inte samma projekt.'},409);
    const rawConfidence=Number(body.confidence);const confidence=Number.isFinite(rawConfidence)?Math.max(0,Math.min(100,Math.round(rawConfidence))):null;
    const source=String(body.mappingSource||'manual')==='suggested'?'suggested':'manual';const comment=typeof body.comment==='string'?body.comment.trim():'';
    await c.env.DB.prepare(`INSERT INTO governing_item_activity_links(id,governing_item_id,activity_id,link_type,mapping_source,confidence,mapping_comment,created_at,confirmed_at)
      VALUES(?,?,?,'supports',?,?,?,datetime('now'),datetime('now'))
      ON CONFLICT(governing_item_id,activity_id) DO UPDATE SET mapping_source=excluded.mapping_source,confidence=excluded.confidence,mapping_comment=excluded.mapping_comment,confirmed_at=datetime('now')`).bind(crypto.randomUUID(),itemId,activityId,source,confidence,comment).run();
    return c.json({ok:true});
  });
}
