const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

test('update waits for the restarted server and target commit before reloading', async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../modules/app.js'),'utf8');
  const setup=source.slice(source.indexOf('function setupDashboardUpdate(){'),source.indexOf('function setupExportImport(){'));
  const buttons={};
  function button(id){
    return buttons[id]||(buttons[id]={disabled:false,addEventListener(event,fn){this[event]=fn;}});
  }
  const body={innerHTML:'',textContent:'',insertAdjacentHTML(){}};
  const overlay={style:{},addEventListener(){},querySelector(selector){return selector==='.update-body'?body:button(selector);}};
  const timers=[],requests=[];
  let reloaded=false,versionCalls=0;
  const oldVersion={startedAt:'old',shortCommit:'old1234'};
  const window={location:{reload(){reloaded=true;}},setTimeout(fn){timers.push(fn);}};
  const document={getElementById:()=>button('open'),createElement:()=>overlay,body:{appendChild(){}}};
  const fetch=async(url)=>{
    requests.push(url);
    let data;
    if(url.endsWith('/version')){
      versionCalls++;
      data=versionCalls<3?oldVersion:{startedAt:'new',shortCommit:'new1234'};
    }else if(url.endsWith('/check')){
      data={version:oldVersion,check:{updateAvailable:true,behind:1,commits:[]}};
    }else{
      data={version:oldVersion,update:{ok:true,commits:1,to:'new1234',message:'Neustart'}};
    }
    return {ok:true,json:async()=>data};
  };
  vm.runInNewContext(setup+';setupDashboardUpdate();',{window,document,fetch,confirm:()=>true});
  button('open').click();
  await new Promise(resolve=>setImmediate(resolve));
  button('.update-check').click();
  await new Promise(resolve=>setImmediate(resolve));
  button('.update-apply').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(reloaded,false);
  assert.equal(timers.length,1);
  timers.shift()();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(reloaded,true);
  assert.equal(requests.filter(url=>url.endsWith('/version')).length,3);
});
