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
