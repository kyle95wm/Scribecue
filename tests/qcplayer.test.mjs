import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQcPlayer } from '../app/js/qcplayer.js';
test('original readings overlap, seek and stop without decoding an entire track', () => {
  const before = globalThis.Audio, made = [];
  class Audio { constructor(){this.duration=4;made.push(this)} pause(){} removeAttribute(){} load(){} play(){return Promise.resolve()} }
  globalThis.Audio=Audio;
  try {
    let t=0; const duck=[];
    const p=createQcPlayer({now:()=>t,duck:v=>duck.push(v),error:assert.fail});
    const source=new Blob([new Uint8Array(244)]);
    p.configure(source,[
      {id:0,key:'first',start:0,secs:3,offset:8,bytes:100,gain:1},
      {id:1,key:'second',dipBy:3,start:1,secs:3,offset:108,bytes:100,gain:1},
    ]);
    p.sync(t,true,1,1);made[0].onloadedmetadata();assert.equal(p.activeCount(),1);
    t=1;p.sync(t,true,1,1);made[1].onloadedmetadata();assert.equal(p.activeCount(),2);assert.equal(p.activeReadings()[1].dipBy,3);
    p.stop();assert.equal(p.activeCount(),0);assert.equal(duck.at(-1),false);
    t=3.5;p.sync(t,true,1,1);made.at(-1).onloadedmetadata();assert.equal(p.activeCount(),1);
    assert.equal(made.at(-1).currentTime,2.5);
    p.sync(t,false,1,1);assert.equal(p.activeCount(),0);
    p.configure(source,[{id:0,key:'first',start:20,secs:3,offset:8,bytes:100,gain:1}]);
    p.sync(t,true,1,1);assert.equal(p.activeCount(),0);
    t=20;p.sync(t,true,1,1);made.at(-1).onloadedmetadata();assert.equal(p.activeCount(),1);assert.equal(made.at(-1).currentTime,0);
    p.configure(null,[]);p.sync(0,true,1,1);assert.equal(p.activeCount(),0);
  } finally {globalThis.Audio=before}
});
test('an extended block is left to its pause, then read whole from the start', () => {
  const before = globalThis.Audio, made = [];
  class Audio { constructor(){this.duration=4;made.push(this)} pause(){} removeAttribute(){} load(){} play(){return Promise.resolve()} }
  globalThis.Audio=Audio;
  try {
    let t=5, ended=0;
    const p=createQcPlayer({now:()=>t,duck:()=>{},error:assert.fail});
    p.configure(new Blob([new Uint8Array(244)]),[{id:0,uid:'a',key:'a',start:5,secs:3,offset:8,bytes:100,gain:1,held:true}]);
    p.sync(t,true,1,1);assert.equal(p.activeCount(),0);assert.equal(made.length,0);
    assert.equal(p.has('a'),true);assert.equal(p.has('b'),false);
    t=5.04;p.hold('a',1,1,()=>ended++);made[0].onloadedmetadata();assert.equal(p.activeCount(),1);assert.equal(made[0].currentTime,0);
    made[0].onended();assert.equal(p.activeCount(),0);assert.equal(ended,1);
    t=6;p.sync(t,true,1,1);assert.equal(p.activeCount(),0);
    p.hold('a',1,1,()=>ended++);p.stop();assert.equal(ended,2); // never left paused
  } finally {globalThis.Audio=before}
});
