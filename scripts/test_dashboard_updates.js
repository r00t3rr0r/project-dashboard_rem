const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');

function harness(options={}){
  const host={hidden:true,innerHTML:''};
  const requests=[];
  let generated=0;
  const window={LocalOllama:{generate:async(path,payload)=>{
    generated++;
    assert.equal(path,'/api/ai/dashboard-updates');
    assert.match(payload.promptConfig.prompt,/Commit-Nachrichten/);
    return options.result||{features:[{title:'<script>Neu</script>',description:'Eine Verbesserung'}]};
  }},addEventListener(){},setInterval(){}};
  const document={getElementById:()=>host,addEventListener(){}};
  const fetch=async(url,init)=>{
    requests.push({url,init});
    if(url.endsWith('daily-commits'))return {ok:true,json:async()=>({date:'2026-11-25',commits:options.commits||['Neue Übersicht']})};
    if(init.method==='POST'){
      const input=JSON.parse(init.body);
      if(options.saveError)return {ok:false,status:500,json:async()=>({error:'Speichern fehlgeschlagen'})};
      return {ok:true,json:async()=>({update:input})};
    }
    return {ok:true,json:async()=>({update:options.existing||null})};
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../modules/dashboard-updates.js'),'utf8'),{window,document,fetch});
  return {api:window.DashboardUpdates,host,requests,get generated(){return generated;}};
}

test('generates, publishes and safely displays shared updates',async()=>{
  const h=harness();
  const result=await h.api.generate();
  assert.equal(result.count,1);
  assert.equal(h.host.hidden,false);
  assert.match(h.host.innerHTML,/25\.11\.2026/);
  assert.match(h.host.innerHTML,/&lt;script&gt;Neu&lt;\/script&gt;/);
  assert.equal(h.requests.filter(request=>request.init.method==='POST').length,1);
});

test('no commits keeps the existing update without calling AI or publishing',async()=>{
  const h=harness({commits:[],existing:{date:'2026-11-24',features:[{title:'Vorher',description:'Alt'}]}});
  await h.api.refresh();
  await assert.rejects(h.api.generate(),/keine Commits/);
  assert.match(h.host.innerHTML,/Vorher/);
  assert.equal(h.generated,0);
  assert.equal(h.requests.filter(request=>request.init.method==='POST').length,0);
});

test('invalid AI output or a failed save leaves the existing update untouched',async()=>{
  for(const options of [{result:{features:[{title:'',description:'Text'}]}},{saveError:true}]){
    const h=harness({...options,existing:{date:'2026-11-24',features:[{title:'Vorher',description:'Alt'}]}});
    await h.api.refresh();
    await assert.rejects(h.api.generate());
    assert.match(h.host.innerHTML,/Vorher/);
  }
});
