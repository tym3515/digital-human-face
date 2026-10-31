// Pose +Z means the person's anatomical front, not the source file's +Z.
// VRoid faces -Z: after its display root turns 180 degrees, this correction
// cancels that turn for pose vectors while preserving the native bone frames.
export function anatomicalBodyFrame(rootWorldQuaternion, nativeFacesNegativeZ) {
  const frame = rootWorldQuaternion.clone();
  if (nativeFacesNegativeZ) frame.multiply(rootWorldQuaternion.clone().set(0, 1, 0, 0));
  return frame.normalize();
}
