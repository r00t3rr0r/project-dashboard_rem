const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');

function makeClient(hostname,config={}){
  const calls=[];
  const models=[{name:'qwen3-embedding:0.6b',capabilities:['embedding']},{name:'text-a',capabilities:['completion']},{name:'text-b'}];
  const window={location:{hostname,origin:'http://'+hostname},AIConfModule:{getConfiguration:()=>config},dispatchEvent(){}};
  const sandbox={
    window,console,AbortController,TextEncoder,CustomEvent:function(){},setInterval:()=>1,clearInterval(){},
    fetch:async(url,init)=>{
      if(init.method==='GET')return {ok:true,json:async()=>({models})};
      const body=JSON.parse(init.body);
      calls.push({url,body});
      if(body.model==='missing')return {ok:false,status:404,json:async()=>({error:'model missing not found'})};
      if(body.model==='incompatible')return {ok:false,status:400,json:async()=>({error:'model incompatible does not support generate'})};
      return {ok:true,json:async()=>hostname==='127.0.0.1'?{response:'Hallo'}:{markdown:'Hallo',model:body.model}};
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../modules/local-ollama.js'),'utf8'),sandbox);
  return {api:window.LocalOllama,window,sandbox,calls,models};
}

for(const hostname of ['127.0.0.1','178.105.213.50']){
  test(hostname+': automatic routing and model selectors exclude embeddings',async()=>{
    const client=makeClient(hostname);
    const health=await client.api.health();
    assert.equal(health.body.models.map(model=>model.name).join(','),'text-a,text-b');
    await client.api.generate('/api/ai/meeting-to-concept',{});
    assert.equal(client.calls[0].body.model,'text-a');
  });

  test(hostname+': configured primary is forwarded to generation',async()=>{
    const client=makeClient(hostname,{routing:'fallback',primaryModel:'text-b',fallbackModel:'text-a'});
    await client.api.generate('/api/ai/meeting-to-concept',{});
    assert.equal(client.calls.length,1);
    assert.equal(client.calls[0].body.model,'text-b');
    if(hostname!=='127.0.0.1'){
      assert.equal(client.calls[0].body.promptConfig.model,'text-b');
      assert.equal(client.calls[0].url,'http://178.105.213.50/api/ai/meeting-to-concept');
    }
  });

  for(const primaryModel of ['missing','incompatible']){
    test(hostname+': configured fallback handles '+primaryModel+' primary',async()=>{
      const client=makeClient(hostname,{routing:'fallback',primaryModel,fallbackModel:'text-b'});
      await client.api.generate('/api/ai/meeting-to-concept',{});
      const expected=hostname==='127.0.0.1'?client.api.bases.map(()=>primaryModel).concat('text-b'):[primaryModel,'text-b'];
      assert.equal(client.calls.map(call=>call.body.model).join(','),expected.join(','));
      if(hostname!=='127.0.0.1')assert.equal(client.calls.at(-1).body.promptConfig.model,'text-b');
    });
  }

  test(hostname+': fixed routing never falls back to another model',async()=>{
    const client=makeClient(hostname,{routing:'fixed',primaryModel:'missing',fallbackModel:'text-b'});
    await assert.rejects(client.api.generate('/api/ai/meeting-to-concept',{}),/not found/);
    assert(client.calls.every(call=>call.body.model==='missing'));
  });

  test(hostname+': automatic routing handles legacy model metadata and embedding-only instances',async()=>{
    const client=makeClient(hostname);
    client.models.splice(0,client.models.length,{name:'qwen3-embedding:0.6b'},{name:'bge-m3:latest'},{name:'text-legacy'});
    await client.api.generate('/api/ai/meeting-to-concept',{});
    assert.equal(client.calls[0].body.model,'text-legacy');
    const empty=makeClient(hostname);
    empty.models.splice(1);
    await assert.rejects(empty.api.generate('/api/ai/meeting-to-concept',{}),/textgenerierendes/);
    assert.equal(empty.calls.length,0);
  });
}

test('routing waits for stored selection to finish hydration',async()=>{
  const config={};
  const client=makeClient('178.105.213.50',config);
  let ready;
  client.window.DataLayer={ready:new Promise(resolve=>{ready=resolve;})};
  const pending=client.api.generate('/api/ai/meeting-to-concept',{});
  assert.equal(client.calls.length,0);
  Object.assign(config,{routing:'fixed',primaryModel:'text-b'});
  ready();
  await pending;
  assert.equal(client.calls[0].body.model,'text-b');
});

test('local dashboard updates request structured JSON with the supplied prompt',async()=>{
  const client=makeClient('127.0.0.1',{routing:'fixed',primaryModel:'text-a'});
  let request;
  client.sandbox.fetch=async(url,init)=>{
    request=JSON.parse(init.body);
    return {ok:true,json:async()=>({response:'{"features":[{"title":"Neu","description":"Einfacher"}]}'})};
  };
  const result=await client.api.generate('/api/ai/dashboard-updates',{promptConfig:{prompt:'Commit-Nachrichten'}});
  assert.equal(request.format,'json');
  assert.match(request.prompt,/Commit-Nachrichten/);
  assert.equal(result.features[0].title,'Neu');
});

test('selected cloud provider generates dashboard updates as JSON',async()=>{
  const client=makeClient('127.0.0.1',{providerModels:{openai:{primaryModel:'gpt-4o-mini'}}});
  client.window.localStorage={getItem:()=> 'openai'};
  client.window.AuthManager={getCurrentUser:()=>({aiKeys:{openai:'test-key'}})};
  let url,request;
  client.sandbox.fetch=async(target,init)=>{
    url=target;
    request=JSON.parse(init.body);
    return {ok:true,json:async()=>({choices:[{message:{content:'{"features":[{"title":"Neu","description":"Einfacher"}]}'}}]})};
  };
  const result=await client.api.generate('/api/ai/dashboard-updates',{promptConfig:{prompt:'Commit-Nachrichten'},privateContext:'not to be sent'});
  assert.equal(url,'https://api.openai.com/v1/chat/completions');
  assert.equal(request.response_format.type,'json_object');
  assert.equal(request.messages[0].content,'Commit-Nachrichten');
  assert.equal(result.features[0].title,'Neu');
});

test('Claude dashboard requests send the supplied prompt only',async()=>{
  const client=makeClient('127.0.0.1',{providerModels:{claude:{primaryModel:'claude-test'}}});
  client.window.localStorage={getItem:()=> 'claude'};
  client.window.AuthManager={getCurrentUser:()=>({aiKeys:{claude:'test-key'}})};
  let url,request;
  client.sandbox.fetch=async(target,init)=>{
    url=target;request=JSON.parse(init.body);
    return {ok:true,json:async()=>({content:[{text:'{"topics":[]}'}]})};
  };
  await client.api.generate('/api/ai/dashboard-updates',{promptConfig:{prompt:'Freigegebener Text'},privateContext:'not to be sent'});
  assert.equal(url,'https://api.anthropic.com/v1/messages');
  assert.equal(request.messages[0].content,'Freigegebener Text');
});

test('Claude lists all pages with the employee key and rejects broken pagination',async()=>{
  const client=makeClient('127.0.0.1');
  client.window.localStorage={getItem:()=> 'claude'};
  client.window.AuthManager={getCurrentUser:()=>({aiKeys:{claude:'test-key'}})};
  const calls=[];
  client.sandbox.fetch=async(url,init)=>{
    calls.push({url,init});
    return {ok:true,json:async()=>calls.length===1
      ?{data:[{id:'claude-a'}],has_more:true,last_id:'claude-a'}
      :{data:[{id:'claude-b'}],has_more:false}};
  };
  const result=await client.api.health();
  assert.equal(result.body.models.map(model=>model.name).join(','),'claude-a,claude-b');
  assert.equal(calls[0].init.headers['x-api-key'],'test-key');
  assert.equal(calls[1].url,'https://api.anthropic.com/v1/models?after_id=claude-a');
  client.sandbox.fetch=async()=>({ok:true,json:async()=>({data:[{id:'claude-a'}],has_more:true,last_id:'claude-a'})});
  await assert.rejects(client.api.health(),/Seitennavigation/);
});

test('OpenAI model listing is real and errors never masquerade as available models',async()=>{
  const client=makeClient('127.0.0.1');
  client.window.localStorage={getItem:()=> 'openai'};
  client.window.AuthManager={getCurrentUser:()=>({aiKeys:{openai:'test-key'}})};
  let init;
  client.sandbox.fetch=async(_url,options)=>{init=options;return {ok:true,json:async()=>({data:[{id:'text-embedding-3-small'},{id:'gpt-5'}]})};};
  const result=await client.api.health();
  assert.equal(result.body.models.map(model=>model.name).join(','),'gpt-5,text-embedding-3-small');
  assert.equal(init.headers.Authorization,'Bearer test-key');
  client.sandbox.fetch=async()=>({ok:false,status:401,json:async()=>({error:{message:'Invalid API key'}})});
  await assert.rejects(client.api.health(),/Invalid API key/);
  client.window.AuthManager.getCurrentUser=()=>({aiKeys:{}});
  await assert.rejects(client.api.health(),/kein API-Schluessel/);
});

test('automatic cloud routing selects a discovered model instead of a previous Ollama model',async()=>{
  const client=makeClient('127.0.0.1');
  let provider='ollama',generated;
  client.window.localStorage={getItem:()=>provider};
  client.window.AuthManager={getCurrentUser:()=>({aiKeys:{openai:'test-key'}})};
  await client.api.health();
  provider='openai';
  client.sandbox.fetch=async(_url,init)=>{
    if(init.method==='GET')return {ok:true,json:async()=>({data:[{id:'gpt-5'}]})};
    generated=JSON.parse(init.body);
    return {ok:true,json:async()=>({choices:[{message:{content:'Antwort'}}]})};
  };
  await client.api.generate('/api/ai/meeting-to-concept',{});
  assert.equal(generated.model,'gpt-5');
});

for(const provider of ['claude','openai']){
  test(provider+': selected primary and fallback control cloud generation',async()=>{
    const config={routing:'fallback',providerModels:{ollama:{primaryModel:'local'},[provider]:{primaryModel:'missing',fallbackModel:provider==='claude'?'claude-opus-5-5':'gpt-5'}}};
    const client=makeClient('127.0.0.1',config),requests=[];
    client.window.localStorage={getItem:()=>provider};
    client.window.AuthManager={getCurrentUser:()=>({aiKeys:{[provider]:'test-key'}})};
    client.sandbox.fetch=async(_url,init)=>{
      const body=JSON.parse(init.body);requests.push(body);
      if(body.model==='missing')return {ok:false,status:404,json:async()=>({error:provider==='claude'?{type:'not_found_error',message:'model: missing'}:{code:'model_not_found',message:'model missing not found'}})};
      return {ok:true,json:async()=>provider==='claude'?{content:[{text:'Antwort'}]}:{choices:[{message:{content:'Antwort'}}]}};
    };
    const result=await client.api.generate('/api/ai/meeting-to-concept',{});
    assert.equal(requests.map(request=>request.model).join(','),'missing,'+config.providerModels[provider].fallbackModel);
    assert.equal(result.model,config.providerModels[provider].fallbackModel);
    assert.equal(requests[1].temperature,undefined);
    if(provider==='openai')assert.equal(requests[1].max_completion_tokens,3200);
    config.routing='fixed';requests.length=0;
    await assert.rejects(client.api.generate('/api/ai/meeting-to-concept',{}),/model/);
    assert.equal(requests.length,1);
  });
}

test('remote Ollama health errors and malformed model lists are explicit',async()=>{
  const client=makeClient('178.105.213.50');
  client.sandbox.fetch=async()=>({ok:true,json:async()=>({status:'error',error:'Ollama offline'})});
  await assert.rejects(client.api.health(),/Ollama offline/);
  client.sandbox.fetch=async()=>({ok:true,json:async()=>({status:'ok'})});
  await assert.rejects(client.api.health(),/Modellliste/);
});

test('private analysis forces local model resolution without remote fallback',async()=>{
  const client=makeClient('178.105.213.50');
  const calls=[];
  client.sandbox.fetch=async(url,init)=>{
    calls.push({url,init});
    if(url.endsWith('/api/tags'))return {ok:true,json:async()=>({models:[{name:'text-a:latest'},{name:'example:cloud'},{name:'remote:latest',remote_host:'https://remote.invalid'}]})};
    return {ok:true,json:async()=>({response:'{"topics":[]}',done_reason:'stop'})};
  };
  const models=await client.api.privateLocalModels();
  assert.equal(models.join(','),'text-a:latest');
  await client.api.privateLocalGenerate('private source','text-a:latest');
  assert.equal(calls[1].url,'http://127.0.0.1:11434/api/generate');
  assert.equal(calls[1].init.redirect,'error');
  const request=JSON.parse(calls[1].init.body);
  assert.equal(request.model,'text-a:latest:local');
  assert.equal(request.truncate,false);
  await assert.rejects(client.api.privateLocalGenerate('private source','example:cloud'),/Cloud-Modelle/);
  assert.equal(calls.length,2);
});

test('private analysis rejects truncated output and never retries on a remote server',async()=>{
  const client=makeClient('178.105.213.50');
  const urls=[];
  client.sandbox.fetch=async(url)=>{
    urls.push(url);
    return {ok:true,json:async()=>({response:'{"topics":[]}',done_reason:'length'})};
  };
  await assert.rejects(client.api.privateLocalGenerate('private source','text-a:latest'),/abgeschnitten/);
  assert.equal(urls.join(','),'http://127.0.0.1:11434/api/generate');
});

test('project knowledge preserves the selected Ollama model and rejects truncated answers',async()=>{
  const client=makeClient('127.0.0.1',{routing:'fixed',primaryModel:'text-b'});
  client.sandbox.fetch=async(url,init)=>{
    const request=JSON.parse(init.body);
    assert.equal(request.model,'text-a');
    assert.equal(request.prompt,'Abschnitt');
    return {ok:true,json:async()=>({response:'Unvollstaendig',done_reason:'length'})};
  };
  await assert.rejects(client.api.generate('/api/ai/project-knowledge',{model:'text-a',knowledgePrompt:'Abschnitt'}),/abgeschnitten/);
});

test('remote Ollama project knowledge sends the requested section to the backend',async()=>{
  const client=makeClient('178.105.213.50',{routing:'fixed',primaryModel:'text-b'});
  let url,request;
  client.sandbox.fetch=async(target,init)=>{
    url=target;request=JSON.parse(init.body);
    return {ok:true,json:async()=>({markdown:'# Wissen',model:'text-a'})};
  };
  const result=await client.api.generate('/api/ai/project-knowledge',{
    model:'text-a',analysisOnly:true,knowledgePrompt:'Abschnitt'
  });
  assert.equal(url,'http://178.105.213.50/api/ai/project-knowledge');
  assert.equal(request.model,'text-a');
  assert.equal(request.knowledgePrompt,'Abschnitt');
  assert.equal(request.analysisOnly,true);
  assert.equal(result.markdown,'# Wissen');
});

test('cloud project knowledge rejects truncated output',async()=>{
  const client=makeClient('127.0.0.1',{providerModels:{openai:{primaryModel:'gpt-4o-mini'}}});
  client.window.localStorage={getItem:()=> 'openai'};
  client.window.AuthManager={getCurrentUser:()=>({aiKeys:{openai:'test-key'}})};
  client.sandbox.fetch=async()=>({ok:true,json:async()=>({choices:[{finish_reason:'length',message:{content:'unvollstaendig'}}]})});
  await assert.rejects(client.api.generate('/api/ai/project-knowledge',{knowledgePrompt:'Abschnitt'}),{code:'AI_OUTPUT_TRUNCATED'});
});

for(const hostname of ['127.0.0.1','178.105.213.50']){
  test(hostname+': scoped knowledge budget overrides a low global budget',async()=>{
    const client=makeClient(hostname,{maxTokens:200,temperature:0.9});
    let request;
    client.sandbox.fetch=async(url,init)=>{
      request=JSON.parse(init.body);
      return {ok:true,json:async()=>hostname==='127.0.0.1'?{response:'Wissen'}:{markdown:'Wissen'}};
    };
    await client.api.generate('/api/ai/project-knowledge',{model:'test',knowledgePrompt:'Abschnitt',
      promptConfig:{maxTokens:4096,temperature:0.2,contextTokens:8192}});
    if(hostname==='127.0.0.1'){
      assert.equal(request.options.num_predict,4096);
      assert.equal(request.options.num_ctx,8192);
      assert.equal(request.options.temperature,0.2);
    }else{
      assert.equal(request.promptConfig.maxTokens,4096);
      assert.equal(request.promptConfig.contextTokens,8192);
    }
  });
}

test('remote knowledge retains structured context limit errors',async()=>{
  const client=makeClient('178.105.213.50');
  client.sandbox.fetch=async()=>({ok:false,status:400,json:async()=>({error:'Kontextlimit',code:'AI_CONTEXT_LIMIT'})});
  await assert.rejects(client.api.generate('/api/ai/project-knowledge',{model:'test',knowledgePrompt:'Abschnitt'}),{code:'AI_CONTEXT_LIMIT'});
});

test('aborted local knowledge requests do not retry other Ollama endpoints',async()=>{
  const client=makeClient('127.0.0.1');
  let calls=0;
  client.sandbox.fetch=async()=>{calls++;throw Object.assign(new Error('Abbruch'),{name:'AbortError'});};
  await assert.rejects(client.api.generate('/api/ai/project-knowledge',{model:'test',knowledgePrompt:'Abschnitt'}),{name:'AbortError'});
  assert.equal(calls,1);
});

for(const provider of ['claude','openai']){
  test(provider+': project knowledge uses the selected provider and returns markdown',async()=>{
    const client=makeClient('127.0.0.1');
    client.window.AIConfModule={getConfiguration:()=>({maxTokens:200,providerModels:{[provider]:{primaryModel:'test-model'}}})};
    client.window.localStorage={getItem:()=>provider};
    client.window.AuthManager={getCurrentUser:()=>({aiKeys:{[provider]:'test-key'}})};
    let url,request;
    client.sandbox.fetch=async(target,init)=>{
      url=target; request=JSON.parse(init.body);
      return {ok:true,json:async()=>provider==='claude'
        ?{stop_reason:'end_turn',content:[{text:'# Wissen'}]}
        :{choices:[{finish_reason:'stop',message:{content:'# Wissen'}}]}};
    };
    const result=await client.api.generate('/api/ai/project-knowledge',{knowledgePrompt:'Abschnitt',promptConfig:{maxTokens:4096}});
    assert.match(url,provider==='claude'?/anthropic\.com/:/openai\.com/);
    assert.equal(request.messages[0].content,'Abschnitt');
    assert.equal(request[provider==='claude'?'max_tokens':'max_completion_tokens'],4096);
    assert.equal(result.markdown,'# Wissen');
    assert(result.bytes>0);
  });
}