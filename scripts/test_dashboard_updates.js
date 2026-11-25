const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');

const sha='a'.repeat(40);
const commit={sha,subject:'Feature: Übersicht',message:'Beschreibung',files:['app.js'],patch:'A'.repeat(24001)};

function harness(options={}){
  const host={hidden:true,innerHTML:''},requests=[],prompts=[];
  const window={LocalOllama:{
    privateLocalModels:async()=>['test'],
    privateLocalGenerate:async(prompt)=>{
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

test('analyses every patch chunk and exposes topics and raw commit details safely',async()=>{
  const h=harness();
  const result=await h.api.analyze('test');
  assert.equal(h.prompts.length,3);
  const parts=h.prompts.map(prompt=>JSON.parse(prompt.slice(prompt.indexOf('{"subject"'))).patchPart);
  assert.equal(parts.join(''),commit.patch);
  assert.equal(result.topics.length,4);
  assert.equal(result.topics[3].category,'Commit');
  assert.equal(result.topics[3].selected,false);
  const html=h.api.selectionHtml(result);
  assert.match(html,/&lt;script&gt;Neu&lt;\/script&gt;/);
  assert.match(html,/app\.js/);
  assert.match(html,/Commit-Inhalt und Änderungen anzeigen/);
  assert.equal(h.requests.filter(request=>request.init.method==='POST').length,0);
});

test('no commits stops before the AI and keeps the existing publication',async()=>{
  const h=harness({commits:[],existing:{date:'2026-11-24',features:[{title:'Vorher',description:'Alt'}]}});
  await h.api.refresh();
  await assert.rejects(h.api.analyze('test'),/keine Commits/);
  assert.match(h.host.innerHTML,/Vorher/);
  assert.equal(h.prompts.length,0);
});

test('publishes all selected topics in batches with options and commit sources',async()=>{
  const h=harness();
  const topics=Array.from({length:7},(_,i)=>({sha,subject:'Original',title:'Thema '+i,description:'Details',category:'Bugfix'}));
  const result=await h.api.generate({date:'2026-11-25'},selection(topics),'test');
  assert.equal(result.count,7);
  assert.equal(h.prompts.length,2);
  assert.match(h.prompts[0],/Fachpersonal/);
  assert.match(h.prompts[0],/Englisch/);
  assert.match(h.prompts[0],/Schwerpunkt Tests/);
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
    await assert.rejects(h.api.generate({date:'2026-11-25'},selection([{sha,subject:'Original',title:'Neu',description:'Text'}]),'test'));
    assert.match(h.host.innerHTML,/Vorher/);
    if(options.ai)assert.equal(h.requests.filter(request=>request.init.method==='POST').length,0);
  }
});

test('invalid analysis stops rather than presenting a partial selection',async()=>{
  const h=harness({ai:()=>({topics:[{title:'Neu',description:'Text',category:'unknown'}]})});
  await assert.rejects(h.api.analyze('test'),/ungültiges Thema/);
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

test('an aborted analysis does not issue local AI requests',async()=>{
  const h=harness(),controller=new AbortController();
  controller.abort();
  await assert.rejects(h.api.analyze('test',controller.signal),/abgebrochen/);
  assert.equal(h.prompts.length,0);
});
