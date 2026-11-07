export function assertShardedUnsealed(experiment) {
  const frozenHash = 'a2fe9499ec853c2e5a3d6e2ececef9ca30410adb7454ed39a211c2fdf072a78c';
  if (experiment.sealed || experiment.preregistration?.input_sha256 === frozenHash) {
    throw new Error('Sealed sharding disabled: committed claim, frozen engine and single-attempt merge enforcement are not implemented. Do not dispatch the sealed set.');
  }
}
