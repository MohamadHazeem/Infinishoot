import * as THREE from 'three';
import { readableMaterial } from '../render/noiseGovernor';
import { commit, instanceMatrix } from '../render/instancing';

/** One late draw for every warning of a family. The shader paints the ink and core in one pass. */
export class ThreatGlyphs {
  private mesh?: THREE.InstancedMesh;
  private highContrast = false;
  private params!: THREE.InstancedBufferAttribute;
  private material!: THREE.ShaderMaterial;

  constructor(private scene: THREE.Scene, private capacity: number, private order: number, private fragment: string) {}

  // Three uses Math.random for resource UUIDs. Leave the existing pre-run RNG stream alone
  // when this scene has never drawn a patterned threat (also saves the title's unused buffers).
  private createMesh(): THREE.InstancedMesh {
    const { scene, capacity, order, fragment } = this;
    const geometry = new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2);
    this.params = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2).setUsage(
      THREE.DynamicDrawUsage,
    );
    geometry.setAttribute('glyph', this.params);
    const mat = (this.material = readableMaterial(this.highContrast ? '#ffffff' : '#ff3df0'));
    mat.vertexShader = mat.vertexShader.replace(
      'void main() {',
      'in vec2 glyph; flat out vec2 glyphData; void main() { glyphData = glyph;',
    );
    mat.fragmentShader =
      'uniform vec3 uColor; in vec2 vUvP; flat in vec2 glyphData; layout(location = 0) out vec4 outColor;\n' +
      fragment;
    const mesh = new THREE.InstancedMesh(geometry, mat, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    scene.add(mesh);
    return mesh;
  }
  begin(highContrast: boolean): void {
    this.highContrast = highContrast;
    if (!this.mesh) return;
    this.material.uniforms.uColor.value.setHex(highContrast ? 0xffffff : 0xff3df0);
    this.mesh.count = 0;
  }
  add(matrix: THREE.Matrix4, kind: number, progress = 0): void {
    const mesh = this.mesh ??= this.createMesh();
    const i = mesh.count++;
    instanceMatrix(mesh, i, matrix);
    this.params.setXY(i, kind, progress);
  }
  end(): void {
    if (!this.mesh?.count) return;
    commit(this.mesh.instanceMatrix, this.mesh.count);
    commit(this.params, this.mesh.count);
  }
}

// Distances to bold shapes on the XZ plane. Positive local Y points along the velocity.
export const shotGlyph = `
float segment(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b-a;
  return length(p-a-ab*clamp(dot(p-a,ab)/dot(ab,ab),0.0,1.0));
}
void main() {
  vec2 p = (vUvP-0.5)*2.0;
  float k = glyphData.x;
  float d;
  if (k < 1.5) { // hourglass, with a longer forward tip
    d = max(abs(p.x)-0.13-abs(p.y)*0.63, max(p.y-0.79,-0.56-p.y));
  } else if (k < 2.5) { // hollow square
    d = abs(max(abs(p.x),abs(p.y))-0.48)-0.16;
  } else if (k < 3.5) { // crescent
    d = max(length(p)-0.70, 0.55-length(p-vec2(-0.38,0.22)));
  } else if (k < 4.5) { // fork, tips point to the two outgoing lanes
    d = min(segment(p,vec2(0,-0.62),vec2(0,0)),segment(vec2(abs(p.x),p.y),vec2(0),vec2(0.48,0.62)))-0.16;
  } else { // swept-back V
    d = segment(vec2(abs(p.x),p.y),vec2(0,0.48),vec2(0.67,-0.42))-0.20;
  }
  if (d > 0.15) discard;
  outColor = vec4(d > 0.0 ? vec3(0.102,0.110,0.173) : uColor,1.0);
}
`;
