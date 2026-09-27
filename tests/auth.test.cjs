const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createNativeGoogleAuth } = require('../dist/native-auth');
const { createWebGoogleAuth } = require('../dist/web-auth');
const { DRIVE_SCOPE, ReconnectRequired } = require('../dist');
test('native auth requests app-data only, rejects account changes, and signs out',async t=>{
  const fetch=global.fetch;t.after(()=>global.fetch=fetch);global.fetch=async()=>Response.json({sub:'one',email:'one@example.com'});
  let configured,current='one',signedOut=false;
  const sdk={configure:options=>configured=options,hasPlayServices:async()=>true,signIn:async()=>({type:'success',data:{scopes:[DRIVE_SCOPE],user:{id:'one'}}}),signInSilently:async()=>({type:'success',data:{user:{id:'one'}}}),getCurrentUser:()=>({user:{id:current}}),getTokens:async()=>({accessToken:'fake-token'}),signOut:async()=>{signedOut=true;},clearCachedAccessToken:async()=>{}};
  const auth=createNativeGoogleAuth({webClientId:'test',loadSDK:async()=>sdk});
  assert.deepEqual(await auth.connect(),{id:'one',email:'one@example.com'});assert.deepEqual(configured.scopes,[DRIVE_SCOPE]);assert.equal(configured.offlineAccess,false);
  current='two';await assert.rejects(auth.accessToken(),ReconnectRequired);await auth.disconnect();assert.equal(signedOut,true);
});
test('missing iOS configuration and Expo Go fail without loading the native module',async()=>{
  let loaded=false;const loadSDK=async()=>{loaded=true;throw Error('unexpected');};
  const ios=createNativeGoogleAuth({webClientId:'web',isIOS:true,loadSDK});assert.equal(ios.configured,false);assert.equal(await ios.restore(),null);
  const go=createNativeGoogleAuth({webClientId:'web',isExpoGo:true,loadSDK});await assert.rejects(go.connect(),/Expo Go/);assert.equal(loaded,false);
});
test('web auth uses nonce-bound same-origin channels and keeps tokens only until disconnect',async t=>{
  const old={fetch:global.fetch,window:global.window,BroadcastChannel:global.BroadcastChannel};
  t.after(()=>{global.fetch=old.fetch;global.window=old.window;global.BroadcastChannel=old.BroadcastChannel;});
  let channel,fragment,closed=false;
  global.BroadcastChannel=class{constructor(name){this.name=name;channel=this;}close(){closed=true;}};
  global.window={open(url){fragment=new URL(url,'https://example.test').hash.slice(1);queueMicrotask(()=>{const params=new URLSearchParams(fragment);assert.equal(channel.name,`drive-sync-google-${params.get('nonce')}`);channel.onmessage({data:{nonce:'wrong',access_token:'bad'}});channel.onmessage({data:{nonce:params.get('nonce'),access_token:'fake-token',expires_in:3600,scope:DRIVE_SCOPE}});});return {};}};
  global.fetch=async(_url,init)=>{assert.equal(init.headers.Authorization,'Bearer fake-token');return Response.json({sub:'one',email:'one@example.com'});};
  const auth=createWebGoogleAuth({webClientId:'test.apps.googleusercontent.com'});await assert.rejects(auth.accessToken(),ReconnectRequired);
  assert.equal((await auth.connect()).id,'one');assert.equal(closed,true);assert.equal(await auth.accessToken(),'fake-token');
  await auth.disconnect();await assert.rejects(auth.accessToken(),ReconnectRequired);assert.equal(await auth.restore(),null);
});
test('web popup denial closes its channel and reports a useful error',async t=>{
  const old={window:global.window,BroadcastChannel:global.BroadcastChannel};t.after(()=>{global.window=old.window;global.BroadcastChannel=old.BroadcastChannel;});let closed=false;
  global.BroadcastChannel=class{close(){closed=true;}};global.window={open:()=>null};
  await assert.rejects(createWebGoogleAuth({webClientId:'test'}).connect(),/popup/);assert.equal(closed,true);
});
