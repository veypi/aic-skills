import test from 'node:test';
import assert from 'node:assert/strict';
import {BrowserViewer} from './viewer.js';
class Node extends EventTarget {
  value='';width=0;height=0;
  getBoundingClientRect(){return {left:10,top:20,width:640,height:360}}
  focus(){} setPointerCapture(){}
  getContext(){return {drawImage:()=>{this.drawn=true}}}
  emit(type,properties={}){const e=new Event(type,{cancelable:true});for(const [k,v]of Object.entries(properties))Object.defineProperty(e,k,{value:v});this.dispatchEvent(e)}
}
function setup(){
  const canvas=new Node(),keyboard=new Node(),sent=[],changes=[];
  let callbacks;
  const stream={ready:Promise.resolve(),send:m=>sent.push(m),close(){this.closed=true}};
  const viewer=new BrowserViewer(canvas,keyboard,{connection:{openBrowserStream:o=>(callbacks=o,stream)},changed:m=>changes.push(m)});
  return {canvas,keyboard,sent,changes,stream,viewer,callbacks};
}
test('ACK is sent after image decode and drawing; disconnect removes DOM input handlers',async t=>{
  const s=setup();t.after(()=>s.viewer.close());let decode;
  const previous=globalThis.createImageBitmap;
  t.after(()=>{globalThis.createImageBitmap=previous});
  globalThis.createImageBitmap=()=>new Promise(r=>decode=r);
  s.callbacks.onMessage({type:'frame',seq:17,data:'AAAA',metadata:{deviceWidth:1280,deviceHeight:720}});
  assert.deepEqual(s.sent,[]);
  let closed=false;decode({width:640,height:360,close(){closed=true}});
  await new Promise(r=>setImmediate(r));
  assert.equal(s.canvas.drawn,true);assert.equal(closed,true);assert.deepEqual(s.sent,[{type:'ack',seq:17}]);
  s.viewer.close();s.keyboard.value='ignored';s.keyboard.emit('input');assert.equal(s.sent.length,1);
});
test('scaled pointer, committed IME/paste, modifier releases preserve upstream input order',t=>{
  const s=setup();t.after(()=>s.viewer.close());s.viewer.metadata={deviceWidth:1280,deviceHeight:720};s.canvas.getBoundingClientRect=()=>({left:10,top:20,width:640,height:288.5});
  s.canvas.emit('pointerdown',{clientX:330,clientY:200,button:0,pointerId:1,detail:1});
  assert.equal(s.sent[0].x,640);assert.equal(s.sent[0].y,360);
  s.keyboard.emit('compositionstart');s.keyboard.value='中文';s.keyboard.emit('input',{isComposing:true});assert.equal(s.sent.length,1);
  s.keyboard.emit('compositionend');s.keyboard.emit('input');
  assert.deepEqual(s.sent.slice(1).map(m=>[m.eventType,m.key]),[['keyDown','中'],['keyUp','中'],['keyDown','文'],['keyUp','文']]);
  s.keyboard.value='🙂a';s.keyboard.emit('input');assert.equal(s.sent[5].text,'🙂');assert.equal(s.keyboard.value,'');
  s.keyboard.emit('keydown',{key:'Control',code:'ControlLeft',keyCode:17,ctrlKey:true});s.keyboard.emit('blur');
  assert.equal(s.sent.at(-2).eventType,'keyUp');assert.equal(s.sent.at(-2).modifiers,0);assert.equal(s.sent.at(-1).eventType,'mouseReleased');
});
