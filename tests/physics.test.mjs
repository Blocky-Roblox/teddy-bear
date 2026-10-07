import test from 'node:test';
import assert from 'node:assert/strict';
import { TeddyWorld, PARTS } from '../src/physics.js';

const run = (toy, seconds) => {for (let i = 0; i < Math.ceil(seconds * 120); i++) toy.step(1 / 120);};
const finite = toy => {
  for (const part of toy.snapshot()) assert.ok([...part.position,...part.quaternion,...part.velocity].every(Number.isFinite), part.id + ' remains finite');
};
const quaternionDistance = (a,b) => 1-Math.abs(a.reduce((n,x,i)=>n+x*b[i],0));

test('each body is independent, falls under gravity, and settles with connected joints', () => {
  const toy = new TeddyWorld(), before = toy.snapshot();
  assert.equal(toy.bodies.size, 12);assert.equal(toy.joints.length,11);
  assert.equal(new Set(toy.bodies.values()).size,12);
  run(toy,7);finite(toy);
  assert.ok(toy.bodies.get('torso').position.y < before.find(p=>p.id==='torso').position[1]-.15);
  assert.ok(Math.max(...toy.jointErrors()) < .03,'sewn joints stay connected');
  assert.ok(toy.snapshot().every(p=>Math.hypot(...p.velocity)<.2),'resting toy loses momentum');
  const velocities=toy.snapshot().filter(p=>p.sleeping);
  assert.ok(velocities.length>=6,'resting bodies sleep instead of performing idle animations');
});

test('holding a hand lifts the toy through joints and moves the other limbs independently', () => {
  const toy=new TeddyWorld();run(toy,3);
  const before=toy.snapshot();
  const hand=toy.bodies.get('handL');
  toy.beginGrab('handL',hand.position.toArray(),7);
  const start=hand.position.toArray(), target=[-.65,2.9,.30];
  for(let i=0;i<180;i++){
    const t=(i+1)/180;toy.moveGrab(7,start.map((x,n)=>x+(target[n]-x)*t));toy.step(1/120);
  }
  const after=toy.snapshot();finite(toy);
  assert.ok(toy.bodies.get('handL').position.y>2.5,'held hand follows the hand target');
  assert.ok(toy.bodies.get('torso').position.y>before.find(p=>p.id==='torso').position[1]+.35,'weight transfers through shoulder and elbow');
  const changing=after.filter(p=>quaternionDistance(p.quaternion,before.find(q=>q.id===p.id).quaternion)>.005);
  assert.ok(changing.length>=6,'several independent limbs rotate while hanging');
  assert.ok(Math.max(...toy.jointErrors())<.16,'lifting never detaches a limb');
  toy.moveGrab(7,[.6,2.4,.2]);run(toy,.2);
  toy.release(7);
  const released=toy.snapshot();run(toy,.35);
  assert.ok(toy.bodies.get('handL').position.distanceTo({x:released.find(p=>p.id==='handL').position[0],y:released.find(p=>p.id==='handL').position[1],z:released.find(p=>p.id==='handL').position[2]})>.05,'release preserves physical motion');
  run(toy,5);finite(toy);assert.ok(Math.max(...toy.jointErrors())<.1);
});

test('ear and foot grabbing transfer motion through their own joints', () => {
  for(const id of ['earL','earR','footL','footR']){
    const toy=new TeddyWorld();run(toy,1);
    const body=toy.bodies.get(id), start=body.position.toArray();
    const before=toy.bodies.get('torso').position.clone();
    assert.equal(toy.beginGrab(id,start,1),true);
    for(let i=0;i<120;i++){
      const t=(i+1)/120;toy.moveGrab(1,[start[0]*.7,start[1]+(2.7-start[1])*t,.15]);toy.step(1/120);
    }
    finite(toy);assert.ok(toy.bodies.get('torso').position.distanceTo(before)>.15,id+' transmits load');
    assert.ok(Math.max(...toy.jointErrors())<.18,id+' does not disconnect');
  }
});

test('two touches can pull separate limbs without tearing seams', () => {
  const toy=new TeddyWorld();run(toy,1);
  toy.beginGrab('handL',toy.bodies.get('handL').position.toArray(),1);
  toy.beginGrab('handR',toy.bodies.get('handR').position.toArray(),2);
  assert.equal(toy.beginGrab('head',toy.bodies.get('head').position.toArray(),3),false);
  for(let i=0;i<120;i++){
    toy.moveGrab(1,[-1.3,2.2,.15]);toy.moveGrab(2,[1.3,2.2,.15]);toy.step(1/120);
  }
  finite(toy);assert.equal(toy.grabs.size,2);assert.ok(Math.max(...toy.jointErrors())<.18);
  toy.releaseAll();assert.equal(toy.grabs.size,0);
  run(toy,3);finite(toy);
});

test('pressure causes real movement, tossing and contacts dissipate energy, reset restores the sewn pose', () => {
  const toy=new TeddyWorld();run(toy,2);
  const torso=toy.bodies.get('torso'), before=torso.position.clone(), head=toy.bodies.get('head');
  const surface=head.position.toArray();surface[2]+=.5;
  toy.press('head',surface,[0,-.3,-.95],1);run(toy,.6);toy.release(1);
  assert.ok(torso.position.distanceTo(before)>.08,'pressing moves the weighted toy');
  toy.impulse('toss');run(toy,.12);
  assert.ok(toy.snapshot().some(p=>Math.hypot(...p.velocity)>1),'throw applies momentum');
  run(toy,5);finite(toy);assert.ok(Math.max(...toy.jointErrors())<.08);
  toy.reset();
  for(const spec of PARTS){
    assert.deepEqual(toy.bodies.get(spec.id).position.toArray(),spec.p);
    assert.equal(toy.bodies.get(spec.id).velocity.length(),0);
  }
  assert.equal(toy.grabs.size,0);assert.equal(toy.presses.size,0);
});
