import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { anatomicalBodyFrame } from './body-frame.mjs';

test('gestures face the same way as avatars imported with either native forward axis', () => {
  for (const negative of [false, true]) {
    const root = new Quaternion().setFromAxisAngle(new Vector3(0,1,0), negative ? Math.PI : 0);
    const nativeFront = new Vector3(0,0,negative ? -1 : 1).applyQuaternion(root);
    const frame = anatomicalBodyFrame(root,negative);
    for (const pose of [[.42,.04,.91], [.64,.02,.77], [0,0,1]]) {
      const direction = new Vector3(...pose).applyQuaternion(frame);
      assert.ok(direction.dot(nativeFront) > .75, 'explain, point and waving palm face the person’s front');
    }
    assert.ok(new Vector3(0,1,0).applyQuaternion(frame).y > .999);
  }
});

test('manual orientation override keeps gestures with the person, including a rotated scene root', () => {
  const root = new Quaternion().setFromAxisAngle(new Vector3(0,1,0), .4);
  const original=root.clone(), frame=anatomicalBodyFrame(root,true);
  const nativeFront = new Vector3(0,0,-1).applyQuaternion(root);
  assert.ok(new Vector3(0,0,1).applyQuaternion(frame).dot(nativeFront) > .999);
  assert.ok(root.equals(original), 'imported display root is not mutated');
});
