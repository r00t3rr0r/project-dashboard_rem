const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

function harness(updates){
  const source=fs.readFileSync(path.join(__dirname,'../modules/app.js'),'utf8');
  const setup=source.slice(source.indexOf('function setupDashboardUpdate(){'),source.indexOf('function setupExportImport(){'));
  const nodes={};
  function node(id){
    return nodes[id]||(nodes[id]={disabled:false,hidden:false,textContent:'',innerHTML:'',style:{},attributes:{},
      addEventListener(event,fn){this[event]=fn;},setAttribute(key,value){this.attributes[key]=value;},
      insertAdjacentHTML(){},focus(){}});
  }
  const overlay={style:{},addEventListener(){},querySelector:node};
  const timers=[],requests=[];
  let reloaded=false,versionCalls=0,resolveApply;
  const oldVersion={startedAt:'old',shortCommit:'old1234'};
  const window={location:{reload(){reloaded=true;}},setTimeout(fn){timers.push(fn);},DashboardUpdates:updates};
  const document={getElementById:()=>node('open'),createElement:()=>overlay,body:{appendChild(){}}};
  const fetch=async(url,options)=>{
    requests.push({url,options});
    let data;
    if(url.endsWith('/version')){
      versionCalls++;
      data=versionCalls<3?oldVersion:{startedAt:'new',shortCommit:'new1234'};
    }else if(url.endsWith('/check')){
      data={version:oldVersion,check:{updateAvailable:true,behind:1,commits:[]}};
    }else if(url.endsWith('/progress')){
      const request=requests.find(item=>item.url.endsWith('/apply'));
      data={runId:request.options.headers['X-Update-Run-Id'],status:'running',percent:55,logs:['Datenbank-Backup erstellen.']};
    }else{
      return new Promise(resolve=>{resolveApply=payload=>resolve({ok:payload.update.ok,json:async()=>payload});});
    }
    return {ok:true,json:async()=>data};
  };
  vm.runInNewContext(setup+';setupDashboardUpdate();',{window,document,fetch,confirm:()=>true});
  return {node,timers,requests,resolveApply:payload=>resolveApply(payload),get reloaded(){return reloaded;}};
}

async function openAndStart(h){
  h.node('open').click();
  await new Promise(resolve=>setImmediate(resolve));
  h.node('.update-check').click();
  await new Promise(resolve=>setImmediate(resolve));
  h.node('.update-apply').click();
  await new Promise(resolve=>setImmediate(resolve));
}

test('shows live action output and completes only after the new server starts',async()=>{
  const h=harness();
  await openAndStart(h);
  assert.equal(h.node('.update-progress-value').textContent,'55 %');
  assert.match(h.node('.update-console').textContent,/Datenbank-Backup/);
  assert.equal(h.node('.update-close').disabled,true);
  assert.equal(h.reloaded,false);
  h.resolveApply({
    version:{startedAt:'old'},update:{ok:true,commits:1,to:'new1234',message:'Neustart'},
    progress:{status:'restarting',percent:90,logs:['Fast-forward','Neustart']}
  });
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.node('.update-progress-value').textContent,'90 %');
  assert.equal(h.reloaded,false);
  while(h.timers.length){
    h.timers.shift()();
    await new Promise(resolve=>setImmediate(resolve));
  }
  assert.equal(h.node('.update-progress-value').textContent,'100 %');
  assert.match(h.node('.update-console').textContent,/Neustart bestaetigt/);
  assert.equal(h.reloaded,false);
  h.node('.update-apply').click();
  assert.equal(h.reloaded,true);
});

test('update failures show the server error without reporting success',async()=>{
  const h=harness();
  await openAndStart(h);
  h.resolveApply({version:{},update:{ok:false,message:'Backup fehlgeschlagen'},
    progress:{status:'error',percent:55,logs:['Fehler: Backup fehlgeschlagen']}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.node('.update-progress-value').textContent,'55 %');
  assert.match(h.node('.update-console').textContent,/Backup fehlgeschlagen/);
  assert.equal(h.node('.update-close').disabled,false);
  assert.equal(h.reloaded,false);
});

test('generation button reports publication success and restores controls',async()=>{
  const h=harness({generate:async()=>({count:3})});
  h.node('open').click();
  await new Promise(resolve=>setImmediate(resolve));
  h.node('.update-generate').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(h.node('.update-ai-status').textContent,/3 Neuerungen/);
  assert.equal(h.node('.update-generate').disabled,false);
  assert.equal(h.node('.update-close').disabled,false);
});

test('generation errors are visible without affecting update controls',async()=>{
  const h=harness({generate:async()=>{throw new Error('Keine Commits');}});
  h.node('open').click();
  await new Promise(resolve=>setImmediate(resolve));
  h.node('.update-generate').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(h.node('.update-ai-status').textContent,/Keine Commits/);
  assert.equal(h.node('.update-check').disabled,false);
});
