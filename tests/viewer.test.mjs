import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizeViewer, viewerOrigins, isViewerRoute } from '../src/server/http/viewer.ts';
import { viewerEvent } from '../src/server/viewer/events.ts';

function request(host='viewer.example.invalid', method='GET', headers={}) {
  return new Request('https://'+host+'/view', {method,headers:{host,...headers}});
}

test('viewer is disabled unless an exact origin is explicitly configured', () => {
  const prior=process.env.MCP_GATEWAY_VIEWER_ORIGINS;
  try {
    delete process.env.MCP_GATEWAY_VIEWER_ORIGINS;
    assert.equal(authorizeViewer(request()).status,404);
    process.env.MCP_GATEWAY_VIEWER_ORIGINS='https://*.example.invalid,https://viewer.example.invalid/path,https://user:pass@viewer.example.invalid';
    assert.equal(viewerOrigins().length,0);
    process.env.MCP_GATEWAY_VIEWER_ORIGINS='https://viewer.example.invalid';
    assert.equal(authorizeViewer(request()),null);
    assert.equal(authorizeViewer(request('other.example.invalid','GET',{'x-forwarded-host':'viewer.example.invalid','x-forwarded-for':'100.64.1.1','tailscale-user-login':'owner@example.invalid'})).status,403);
    assert.equal(authorizeViewer(request('viewer.example.invalid','GET',{origin:'https://foreign.invalid'})).status,403);
    assert.equal(authorizeViewer(request('viewer.example.invalid','GET',{'sec-fetch-site':'cross-site','sec-fetch-mode':'cors'})).status,403);
    assert.equal(authorizeViewer(request('viewer.example.invalid','GET',{'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate'})),null);
    for(const method of ['POST','PATCH','DELETE','PUT','OPTIONS'])assert.equal(authorizeViewer(request('viewer.example.invalid',method)).status,405);
  } finally { if(prior===undefined)delete process.env.MCP_GATEWAY_VIEWER_ORIGINS;else process.env.MCP_GATEWAY_VIEWER_ORIGINS=prior; }
});

test('viewer routing grants only exact visualization paths and known icon assets', () => {
  for(const path of ['/view','/api/viewer/snapshot','/api/viewer/events','/client-icons/hermes.svg'])assert.equal(isViewerRoute(path),true);
  for(const path of ['/view/admin','/api/servers','/api/viewer/snapshot/extra','/client-icons/../../api/settings/config','/client-icons/unknown.svg'])assert.equal(isViewerRoute(path),false);
});

test('viewer event projections drop raw errors, session identifiers and future admin fields', () => {
  const source={type:'call.started',callId:'call-1',endpointId:'ep',endpointName:'My endpoint',backendServerId:'server',backendServerKey:'demo',itemName:'demo__ping',operationType:'tools/call',sessionId:'private-session',clientId:'codex',args:{secret:'private-args'},headers:{Authorization:'private-token'}};
  const event=viewerEvent(source);
  assert.equal(event.sessionId,null);
  const text=JSON.stringify(event);
  for(const secret of ['private-session','private-args','private-token','Authorization'])assert.ok(!text.includes(secret));
  assert.deepEqual(viewerEvent({type:'call.finished',callId:'call-1',status:'error',durationMs:15,error:'private-error-with-credentials'}),{type:'call.finished',callId:'call-1',status:'error',durationMs:15});
  assert.deepEqual(viewerEvent({type:'server.status_changed',serverId:'s',serverKey:'demo',status:'error',lastError:'private-url'}),{type:'server.status_changed',serverId:'s',serverKey:'demo',status:'error'});
  assert.equal(viewerEvent({type:'audit.appended',entryId:1}),null);
  assert.equal(viewerEvent({type:'rule.updated',endpointId:'ep',backendServerId:'s'}),null);
});


test('private viewer proxy key rejects alternate ingress and forwarded identity spoofing', () => {
  const origin=process.env.MCP_GATEWAY_VIEWER_ORIGINS;
  const key=process.env.MCP_GATEWAY_VIEWER_PROXY_KEY;
  try {
    process.env.MCP_GATEWAY_VIEWER_ORIGINS='https://viewer.example.invalid';
    process.env.MCP_GATEWAY_VIEWER_PROXY_KEY='synthetic-private-proxy-key';
    assert.equal(authorizeViewer(request()).status,403);
    assert.equal(authorizeViewer(request('viewer.example.invalid','GET',{'x-forwarded-for':'100.64.1.1','tailscale-user-login':'owner@example.invalid'})).status,403);
    assert.equal(authorizeViewer(request('viewer.example.invalid','GET',{'x-mcp-gateway-viewer-key':'wrong'})).status,403);
    assert.equal(authorizeViewer(request('viewer.example.invalid','GET',{'x-mcp-gateway-viewer-key':'synthetic-private-proxy-key'})),null);
  } finally {
    if(origin===undefined)delete process.env.MCP_GATEWAY_VIEWER_ORIGINS;else process.env.MCP_GATEWAY_VIEWER_ORIGINS=origin;
    if(key===undefined)delete process.env.MCP_GATEWAY_VIEWER_PROXY_KEY;else process.env.MCP_GATEWAY_VIEWER_PROXY_KEY=key;
  }
});
