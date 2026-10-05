// Presentation and DOM input only. Frames, tab identities and input messages
// follow agent-browser's upstream stream protocol.
export class BrowserViewer {
  constructor(canvas, keyboard, {connection, changed}) {
    this.canvas=canvas; this.keyboard=keyboard; this.changed=changed;
    this.listeners=[]; this.keys=new Map(); this.buttons=new Map();
    this.stream=connection.openBrowserStream({onMessage:m=>this.message(m),onClose:e=>{if(!this.closed){this.close();changed({error:e?.message || 'Browser disconnected'})}}});
    this.stream.ready.catch(e=>{if(!this.closed)changed({error:e.message})});
    const on=(node,name,fn,options)=>{node.addEventListener(name,fn,options);this.listeners.push(()=>node.removeEventListener(name,fn,options))};
    const mouse=(event,type)=>{
      const r=canvas.getBoundingClientRect(), m=this.metadata;
      if(!m || !r.width || !r.height) return;
      // Image scaling is uniform on both axes, including capped frames.
      // Browser chrome may reduce captured height below the nominal viewport.
      const scale=m.deviceWidth/r.width;
      const x=(event.clientX-r.left)*scale;
      const y=(event.clientY-r.top)*scale;
      const button=['left','middle','right'][event.button] || 'none';
      return {type:'input_mouse',eventType:type,x,y,button,clickCount:type==='mouseMoved'?0:(event.detail || 1),modifiers:modifiers(event)};
    };
    on(canvas,'pointerdown',e=>{e.preventDefault();keyboard.focus({preventScroll:true});canvas.setPointerCapture(e.pointerId);const m=mouse(e,'mousePressed');if(m){this.buttons.set(e.button,m);this.send(m)}});
    on(canvas,'pointerup',e=>{e.preventDefault();const m=mouse(e,'mouseReleased');this.buttons.delete(e.button);if(m)this.send(m)});
    on(canvas,'pointermove',e=>{this.move=mouse(e,'mouseMoved');if(!this.moveTimer)this.moveTimer=setTimeout(()=>{this.moveTimer=null;if(this.move)this.send(this.move);this.move=null},16)});
    on(canvas,'contextmenu',e=>e.preventDefault());
    on(canvas,'wheel',e=>{e.preventDefault();const m=mouse(e,'mouseWheel');if(m)this.send({...m,button:'none',deltaX:e.deltaX*(e.deltaMode===1?16:1),deltaY:e.deltaY*(e.deltaMode===1?16:1)})},{passive:false});
    on(keyboard,'keydown',e=>{
      if(e.isComposing || e.key==='Process' || e.key==='Dead')return;
      if(e.key.length===1 && !e.ctrlKey && !e.metaKey && !e.altKey)return;
      if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='v')return; // native paste → input
      e.preventDefault();const m=keyMessage(e,'keyDown');this.keys.set(e.code,m);this.send(m);
    });
    on(keyboard,'keyup',e=>{const m=this.keys.get(e.code);if(m){e.preventDefault();this.keys.delete(e.code);this.send({...m,eventType:'keyUp',modifiers:modifiers(e)})}});
    const text=()=>{
      if(this.composing || !keyboard.value)return;
      const value=keyboard.value;keyboard.value='';
      // The upstream stream accepts keyboard text one Unicode character at a time.
      // Keep committed IME/paste text on the same ordered path as mouse and keys.
      for(const key of value){
        this.send({type:'input_keyboard',eventType:'keyDown',key,text:key});
        this.send({type:'input_keyboard',eventType:'keyUp',key});
      }
    };
    on(keyboard,'compositionstart',()=>{this.composing=true});
    on(keyboard,'compositionend',()=>{this.composing=false;text()});
    on(keyboard,'input',e=>{if(!e.isComposing)text()});
    on(keyboard,'blur',()=>this.release());
    on(canvas,'lostpointercapture',()=>this.release());
  }
  send(message) {
    if(this.closed)return;
    if(this.move && message!==this.move) {const move=this.move;this.move=null;this.stream.send(move)}
    this.stream.send(message);
  }
  release() {
    for(const message of this.keys.values()) this.send({...message,eventType:'keyUp',modifiers:0});
    for(const message of this.buttons.values()) this.send({...message,eventType:'mouseReleased'});
    this.keys.clear();this.buttons.clear();
  }
  message(message) {
    if(this.closed)return;
    if(message.type==='frame') {
      // Upstream ACK pacing keeps one frame in flight until it is drawn here.
      this.draw(message).catch(e=>{if(!this.closed){this.changed({error:e.message});this.close()}});
    } else if(['tabs','status','url'].includes(message.type)) this.changed(message);
  }
  async draw(frame) {
    const bytes=Uint8Array.from(atob(frame.data),c=>c.charCodeAt(0));
    const bitmap=await createImageBitmap(new Blob([bytes]));
    try {
      if(this.closed)return;
      this.canvas.width=bitmap.width;this.canvas.height=bitmap.height;
      this.canvas.getContext('2d').drawImage(bitmap,0,0);
      this.metadata=frame.metadata;
      this.changed({type:'frame'});
    } finally {bitmap.close();if(!this.closed)this.stream.send({type:'ack',seq:frame.seq})}
  }
  close() {
    if(this.closed)return;
    // Release held input before detaching the ordered transport.
    for(const m of this.keys.values())this.stream.send({...m,eventType:'keyUp',modifiers:0});
    for(const m of this.buttons.values())this.stream.send({...m,eventType:'mouseReleased'});
    this.closed=true;clearTimeout(this.moveTimer);
    for(const remove of this.listeners)remove();
    this.stream.close();this.keyboard.value='';
  }
}
function modifiers(e){return (e.altKey?1:0)|(e.ctrlKey?2:0)|(e.metaKey?4:0)|(e.shiftKey?8:0)}
function keyMessage(e,eventType){return {type:'input_keyboard',eventType,key:e.key,code:e.code,windowsVirtualKeyCode:e.keyCode,modifiers:modifiers(e)}}
