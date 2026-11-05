import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function harness() {
  const file = process.env.RECONNECT_SOURCE || new URL('../src/server/gateway/backend-registry.ts', import.meta.url);
  const source = fs.readFileSync(file, 'utf8');
  const part = source.slice(source.indexOf('class BackendConfigurationError'), source.indexOf('declare global'));
  const js = ts.transpileModule('const RECONNECT_INITIAL_MS=1000; const RECONNECT_MAX_MS=30000;\n'+part, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const timers = new Map(); const clients=[]; const transports=[];
  let counter=0,fail=false,pause;
  class Transport { constructor(){transports.push(this);} async close(){this.closed=true;} }
  class Client {
    constructor(){clients.push(this);}
    setRequestHandler(){}
    setNotificationHandler(){}
    async connect(){if(pause)await pause;if(fail)throw Error('unreachable');}
    async close(){this.closed=true;this.onclose?.();}
  }
  const context={exports:{},gatewayVersion:"test",Client,StdioClientTransport:Transport,StreamableHTTPClientTransport:Transport,SSEClientTransport:Transport,
    eq:()=>true,backendServers:{id:'id'},getDb:()=>({update:()=>({set:()=>({where:()=>Promise.resolve()})})}),emitGatewayEvent:()=>{},
    BUILTIN_GATEWAY_TOOLS_SERVER_KEY:'builtin',ElicitRequestSchema:{},CreateMessageRequestSchema:{},relayElicitation(){},relaySampling(){},
    ToolListChangedNotificationSchema:{}, ResourceListChangedNotificationSchema:{}, PromptListChangedNotificationSchema:{},
    stdioLaunch:(_key,command,args)=>({command,args}), resolveBackendValues:v=>v, randomInt:(_min,max)=>max-1, setTimeout:(fn,delay)=>{const id=++counter;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id),process:{env:{}}};
  vm.runInNewContext(js,context);
  const connection=new context.exports.BackendConnection({id:'test',key:'plane',connectionType:'stdio',command:'/usr/bin/ssh',args:[],env:{}});
  return {connection,timers,clients,transports,setFail:v=>fail=v,setPause:v=>pause=v};
}

test('failed stdio initialization cleans up and retries with capped backoff',async()=>{
 const h=harness();h.setFail(true);await h.connection.connect();
 assert.equal(h.connection.status,'error');assert.equal(h.timers.size,1);
 assert.ok(h.clients[0].closed);assert.ok(h.transports[0].closed);
 for(const expected of [1000,2000,4000,8000,16000,30000,30000]){
  const [id,timer]=[...h.timers][0];assert.equal(timer.delay,expected);h.timers.delete(id);
  timer.fn();await new Promise(resolve=>setImmediate(resolve));assert.equal(h.timers.size,1);
 }
 await h.connection.close();assert.equal(h.timers.size,0);
});

test('lost connection retries once and success resets backoff',async()=>{
 const h=harness();await h.connection.connect();const old=h.clients[0];old.onclose();old.onclose();
 assert.equal(h.timers.size,1);assert.equal(h.connection.client,null);
 const [id,timer]=[...h.timers][0];h.timers.delete(id);timer.fn();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.connection.status,'connected');assert.equal(h.timers.size,0);
 h.clients.at(-1).onclose();assert.equal([...h.timers.values()][0].delay,1000);
 await h.connection.close();assert.equal(h.timers.size,0);
});

test('closing during initialization cannot resurrect a backend',async()=>{
 const h=harness();let resume;h.setPause(new Promise(resolve=>resume=resolve));
 const connecting=h.connection.connect();await h.connection.connect();assert.equal(h.clients.length,1);
 await h.connection.close();resume();await connecting;
 assert.equal(h.connection.status,'disconnected');assert.equal(h.connection.client,null);assert.ok(h.clients[0].closed);assert.equal(h.timers.size,0);
});
