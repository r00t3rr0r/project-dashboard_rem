const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');

const sha='a'.repeat(40);
const commit={sha,subject:'PRIVATE_SUBJECT',message:'PRIVATE_MESSAGE',files:['private-file.js'],patch:'PRIVATE_SOURCE_CODE'};

function harness(options={}){
  const host={hidden:true,innerHTML:''},requests=[],prompts=[];
  const window={LocalOllama:{
    getProvider:()=>options.provider||'claude',
    generate:async(path,payload)=>{
      assert.equal(path,'/api/ai/dashboard-updates');
      const prompt=payload.promptConfig.prompt;
      prompts.push(prompt);
      if(options.ai)return options.ai(prompt);
      if(prompt.startsWith('Analysiere'))return {topics:[{category:'Neuerung',title:'<script>Neu</script>',description:'Eine Verbesserung'}]};
      const inputs=JSON.parse(prompt.split('Themen: ').at(-1));
      return {features:inputs.map(item=>({id:item.id,title:item.title,description:item.description}))};
    }
  },addEventListener(){},setInterval(){}};
  const document={getElementById:()=>host,addEventListener(){}};
  const fetch=async(url,init)=>{
    requests.push({url,init});
    if(url.endsWith('daily-commits'))return {ok:true,json:async()=>({date:'2026-11-25',commits:options.commits||[commit]})};
    if(init.method==='POST'){
      const input=JSON.parse(init.body);
      if(options.saveError)return {ok:false,status:500,json:async()=>({error:'Speichern fehlgeschlagen'})};
      return {ok:true,json:async()=>({update:input})};
    }
    return {ok:true,json:async()=>({update:options.existing||null})};
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../modules/dashboard-updates.js'),'utf8'),{window,document,fetch});
  return {api:window.DashboardUpdates,host,requests,prompts};
}

function selection(topics){return {topics,audience:'technical',language:'en',detail:'detailed',sourceDetail:'full',hints:'Schwerpunkt Tests'};}

for(const provider of ['claude','openai']){
  test(provider+': analyses only approved text without sending commit contents',async()=>{
    const h=harness({provider});
    const data=await h.api.loadCommits();
    const html=h.api.draftHtml(data);
    assert.match(html,/PRIVATE_SOURCE_CODE/);
    const result=await h.api.analyze({date:data.date,items:[{commit,description:'Freigegebene Beschreibung'}]},provider);
    assert.equal(h.prompts.length,1);
    assert.match(h.prompts[0],/Freigegebene Beschreibung/);
    for(const text of ['PRIVATE_SOURCE_CODE','PRIVATE_MESSAGE','PRIVATE_SUBJECT','private-file.js',sha]){
      assert.ok(!h.prompts[0].includes(text),text+' must not be sent');
    }
    assert.equal(result.topics.length,2);
    assert.equal(result.topics[1].category,'Commit');
    assert.equal(result.topics[1].selected,false);
    assert.match(h.api.selectionHtml(result),/&lt;script&gt;Neu&lt;\/script&gt;/);
    assert.equal(h.requests.filter(request=>request.init.method==='POST').length,0);
  });
}

test('no commits stops before the AI and keeps the existing publication',async()=>{
  const h=harness({commits:[],existing:{date:'2026-11-24',features:[{title:'Vorher',description:'Alt'}]}});
  await h.api.refresh();
  await assert.rejects(h.api.loadCommits(),/keine Commits/);
  assert.match(h.host.innerHTML,/Vorher/);
  assert.equal(h.prompts.length,0);
});

test('publishes all selected topics in batches with options and commit sources',async()=>{
  const h=harness();
  const topics=Array.from({length:7},(_,i)=>({sha,subject:'Original',title:'Thema '+i,description:'Details',category:'Bugfix'}));
  const result=await h.api.generate({date:'2026-11-25'},selection(topics),'claude');
  assert.equal(result.count,7);
  assert.equal(h.prompts.length,2);
  assert.match(h.prompts[0],/Fachpersonal/);
  assert.match(h.prompts[0],/Englisch/);
  assert.match(h.prompts[0],/Schwerpunkt Tests/);
  assert.ok(!h.prompts[0].includes(sha));
  assert.ok(!h.prompts[0].includes('Original'));
  const posted=JSON.parse(h.requests.find(request=>request.init.method==='POST').init.body);
  assert.equal(posted.features.length,7);
  assert.equal(posted.features[6].sources[0].sha,sha);
  assert.equal(posted.features[0].sourceDetail,'full');
  assert.match(h.host.innerHTML,/Commit-Quellen/);
});

test('missing AI results and failed saves never replace the previous publication',async()=>{
  for(const options of [{ai:()=>({features:[]})},{saveError:true}]){
    const h=harness({...options,existing:{date:'2026-11-24',features:[{title:'Vorher',description:'Alt'}]}});
    await h.api.refresh();
    await assert.rejects(h.api.generate({date:'2026-11-25'},selection([{sha,subject:'Original',title:'Neu',description:'Text',category:'Neuerung'}]),'claude'));
    assert.match(h.host.innerHTML,/Vorher/);
    if(options.ai)assert.equal(h.requests.filter(request=>request.init.method==='POST').length,0);
  }
});

test('invalid analysis stops rather than presenting a partial selection',async()=>{
  const h=harness({ai:()=>({topics:[{title:'Neu',description:'Text',category:'unknown'}]})});
  await assert.rejects(h.api.analyze({items:[{commit,description:'Freigegeben'}]},'claude'),/ungültiges Thema/);
});

test('manually added topics are selected and retain their commit association',()=>{
  const h=harness();
  const title={value:'<b>Übersehen</b>'},description={value:'Ein weiterer Fix'};
  const editor={open:true,html:'',querySelector(selector){return selector.endsWith('title')?title:description;},
    insertAdjacentHTML(where,html){this.html=html;}};
  const root={querySelector:()=>editor};
  const analysis={commits:[commit],topics:[]};
  h.api.addManualTopic(root,analysis,0);
  assert.equal(analysis.topics[0].sha,sha);
  assert.equal(analysis.topics[0].selected,true);
  assert.match(editor.html,/&lt;b&gt;Übersehen&lt;\/b&gt;/);
  assert.equal(title.value,'');
  assert.equal(editor.open,false);
});

test('an aborted analysis does not issue AI requests',async()=>{
  const h=harness(),controller=new AbortController();
  controller.abort();
  await assert.rejects(h.api.analyze({items:[{commit,description:'Freigegeben'}]},'claude',controller.signal),/abgebrochen/);
  assert.equal(h.prompts.length,0);
});

test('analysis requires a selected cloud provider and a matching current provider',async()=>{
  const h=harness({provider:'ollama'});
  const draft={items:[{commit,description:'Freigegeben'}]};
  await assert.rejects(h.api.analyze(draft,'ollama'),/Claude oder ChatGPT/);
  await assert.rejects(h.api.analyze(draft,'claude'),/geändert/);
  assert.equal(h.prompts.length,0);
});

test('draft consent and text are required before analysis',()=>{
  const h=harness();
  const checkbox={checked:false},input={getAttribute:()=> '0'},field={value:''};
  const root={querySelector(selector){
    return selector==='.update-draft-approved'?checkbox:field;
  },querySelectorAll:()=>[input]};
  assert.throws(()=>h.api.readDrafts(root,{commits:[commit]}),/bestätigen/);
  checkbox.checked=true;
  assert.throws(()=>h.api.readDrafts(root,{commits:[commit]}),/Beschreibung eingeben/);
  field.value='Freigegebene Beschreibung';
  assert.equal(h.api.readDrafts(root,{commits:[commit]}).items[0].description,field.value);
});

test('oversized descriptions and hints are rejected before contacting AI',async()=>{
  const h=harness();
  await assert.rejects(h.api.analyze({items:[{commit,description:'x'.repeat(3001)}]},'claude'),/zu lang/);
  const selected=selection([{sha,subject:'Original',title:'Neu',description:'Text',category:'Bugfix'}]);
  selected.hints='x'.repeat(1501);
  await assert.rejects(h.api.generate({date:'2026-11-25'},selected,'claude'),/zu lang/);
  assert.equal(h.prompts.length,0);
});

test('large escaped inputs are split into bounded requests without dropping topics',async()=>{
  const h=harness({ai:prompt=>{
    const batch=JSON.parse(prompt.split('Themen: ').at(-1));
    return {features:batch.map(item=>({id:item.id,title:'Neu',description:'Kurz'}))};
  }});
  const topics=Array.from({length:7},(_,i)=>({sha,subject:'Original',title:'Thema '+i,
    description:'\u0000'.repeat(3000),category:'Bugfix'}));
  const options=selection(topics);
  options.hints='\u0000'.repeat(1500);
  const result=await h.api.generate({date:'2026-11-25'},options,'claude');
  assert.equal(result.count,7);
  assert.ok(h.prompts.length>1);
  assert.ok(h.prompts.every(prompt=>prompt.length<=32000));
});

test('publication requires explicit approval for selected topics and notes',()=>{
  const h=harness();
  const approved={checked:false};
  const root={querySelector(selector){return selector==='.update-selection-approved'?approved:{value:''};},
    querySelectorAll:()=>[{getAttribute:()=> '0'}]};
  assert.throws(()=>h.api.readSelection(root,{topics:[{}]}),/bestätigen/);
  approved.checked=true;
  assert.equal(h.api.readSelection(root,{topics:[{title:'Neu'}]}).topics.length,1);
});

test('provider change interrupts analysis before the next request',async()=>{
  const options={provider:'claude'};
  options.ai=()=>{options.provider='openai';return {topics:[]};};
  const h=harness(options);
  await assert.rejects(h.api.analyze({items:[
    {commit,description:'Erster Text'},{commit,description:'Zweiter Text'}]},'claude'),/geändert/);
  assert.equal(h.prompts.length,1);
});
