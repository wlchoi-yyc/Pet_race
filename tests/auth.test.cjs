const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const code = fs.readFileSync('auth.js','utf8').replace("import('./game.js')",'loadGame()');
const flush = () => new Promise(resolve => setImmediate(resolve));
async function setup({exists=true, fail=false, host='pet-race-wlchoi.web.app', deferred}={}) {
  const nodes={};
  for(const id of ['authGate','experience','authMessage','googleLoginButton','authLogout','switchAccount']) nodes[id]={hidden:false,disabled:true,addEventListener(type,fn){this[type]=fn;}};
  nodes.experience.hidden=true;
  const auth={currentUser:null,useDeviceLanguage(){},onAuthStateChanged(fn){this.changed=fn;},async signOut(){this.currentUser=null;await this.changed(null);},async signInWithPopup(){}};
  const ref={async get(opts){assert.equal(opts.source,'server'); if(deferred) return deferred; if(fail) throw Error('offline');return {exists};},onSnapshot(opts,fn,error){this.snapshot=fn;this.error=error;return ()=>{};}};
  const ctx={document:{getElementById:id=>nodes[id]},window:{dispatchEvent(){}},location:{hostname:host,replace(url){this.redirect=url;},reload(){this.reloaded=true;}},Event:class{},fetch:async()=>({ok:true,json:async()=>({projectId:'mulan-journey'})}),firebase:{initializeApp(){},auth:()=>auth,firestore:()=>({collection(name){assert.equal(name,'authorizedUsers');return {doc(email){assert.equal(email,'teacher@example.com');return ref;}};}})},loads:0,async loadGame(){ctx.loads++;}};
  ctx.window.firebase=ctx.firebase;
  ctx.firebase.auth.GoogleAuthProvider=class{setCustomParameters(){}};
  vm.runInNewContext(code,ctx);await flush();
  async function login(user={uid:'teacher',email:'Teacher@Example.com',emailVerified:true}){auth.currentUser=user;await auth.changed(user);}
  return {ctx,nodes,auth,ref,login};
}
test('signed-out visitor cannot load game',async()=>{const h=await setup();await h.login(null);assert.equal(h.ctx.loads,0);assert.equal(h.nodes.experience.hidden,true);});
test('unknown account cannot load game',async()=>{const h=await setup({exists:false});await h.login();assert.equal(h.ctx.loads,0);assert.equal(h.ctx.window.__petRaceAuthorized,false);});
test('server errors fail closed',async()=>{const h=await setup({fail:true});await h.login();assert.equal(h.ctx.loads,0);assert.equal(h.nodes.authGate.hidden,false);});
test('authorized verified account loads game once',async()=>{const h=await setup();await h.login();assert.equal(h.ctx.loads,1);assert.equal(h.nodes.authGate.hidden,true);assert.equal(h.nodes.experience.hidden,false);});
test('revoked authorization locks loaded game',async()=>{const h=await setup();await h.login();h.ref.snapshot({metadata:{fromCache:false},exists:false});assert.equal(h.ctx.window.__petRaceAuthorized,false);assert.equal(h.nodes.experience.hidden,true);});
test('unverified account fails closed',async()=>{const h=await setup();await h.login({uid:'teacher',email:'teacher@example.com',emailVerified:false});assert.equal(h.ctx.loads,0);});
test('logout while server check pending cannot unlock game',async()=>{let resolve;const deferred=new Promise(r=>resolve=r);const h=await setup({deferred});const pending=h.login();await h.login(null);resolve({exists:true});await pending;assert.equal(h.ctx.loads,0);assert.equal(h.nodes.experience.hidden,true);});
test('old GitHub Pages entry redirects before starting auth or game',async()=>{const h=await setup({host:'wlchoi-yyc.github.io'});assert.equal(h.ctx.location.redirect,'https://pet-race-wlchoi.web.app/');assert.equal(h.ctx.loads,0);});
