// Build TSL graphs once from the game's GLSL3 stages. Going through Three's parser
// keeps the shader edits made by bosses, telegraphs, skins and post effects intact.
// No generated JavaScript is evaluated. The draw loop only updates uniform values.
import { retroGlobals } from './retroMaterial';
import * as TSL from 'three/tsl';
import { DataTexture, InstancedInterleavedBuffer, NodeMaterial } from 'three/webgpu';
import type {
  BufferAttribute,
  BufferGeometry,
  InstancedMesh,
  IUniform,
  Mesh,
  ShaderMaterial,
  Texture,
} from 'three';
import GLSLDecoder from 'three/addons/transpiler/GLSLDecoder.js';
import * as A from 'three/addons/transpiler/AST.js';

// TSL's named constructors and swizzles are selected by the shader's declared GLSL type.
type Bindings = Record<string, any>;
const nodes: Bindings = TSL;
const ops: Record<string, string> = {
  '=': 'assign',
  '+': 'add',
  '-': 'sub',
  '*': 'mul',
  '/': 'div',
  '%': 'mod',
  '<': 'lessThan',
  '>': 'greaterThan',
  '<=': 'lessThanEqual',
  '>=': 'greaterThanEqual',
  '==': 'equal',
  '!=': 'notEqual',
  '&&': 'and',
  '||': 'or',
  '+=': 'addAssign',
  '-=': 'subAssign',
  '*=': 'mulAssign',
  '/=': 'divAssign',
};
type Statement = NonNullable<A.Statement>;
type Scope = Bindings;

function expression(n: Statement, scope: Scope): any {
  if (n instanceof A.Number) return nodes[n.type](Number(n.value));
  if (n instanceof A.Accessor) {
    const [name, ...fields] = n.property.split('.');
    if (!(name in scope)) throw Error('Unbound shader input ' + n.property);
    return fields.reduce((value, field) => value[field], scope[name]);
  }
  if (n instanceof A.AccessorElements) {
    let value = expression(n.object, scope);
    for (const e of n.elements) {
      value =
        e instanceof A.StaticElement
          ? value[(e.value as A.Accessor).property]
          : value.element(expression(e.value!, scope));
    }
    return value;
  }
  if (n instanceof A.Operator) {
    const left = expression(n.left!, scope);
    if (n.type === '.') return left[(n.right as A.Accessor).property];
    if (!ops[n.type]) throw Error('Unsupported shader operator ' + n.type);
    return left[ops[n.type]](expression(n.right!, scope));
  }
  if (n instanceof A.Unary) {
    const x = expression(n.expression!, scope);
    return n.type === '!' ? x.not() : n.type === '-' ? x.negate() : x;
  }
  if (n instanceof A.Ternary)
    return nodes.select(
      expression(n.cond!, scope),
      expression(n.left!, scope),
      expression(n.right!, scope),
    );
  if (n instanceof A.FunctionCall) {
    const p = n.params.map((arg) => expression(arg!, scope));
    if (n.name === 'texture') return p[0].sample(p[1]).level(0);
    if (n.name === 'texelFetch') return p[0].load(p[1]).level(0);
    if (n.name === 'array') return nodes.array(p);
    return (scope[n.name] ?? nodes[n.name])(...p);
  }
  throw Error('Unsupported shader expression ' + n.constructor.name);
}

// The shipped shaders have counted loops and structured branches. For an early
// return, place the continuation in the other branch (the TSL Fn is inlined).
function block(body: A.Statement[], scope: Scope, result: any): void {
  for (let i = 0; i < body.length; i++) {
    const n = body[i];
    if (!n || n instanceof A.Comment) continue;
    if (n instanceof A.VariableDeclaration) {
      for (let d: A.VariableDeclaration | null = n; d; d = d.next) {
        const value = d.value && expression(d.value, scope);
        scope[d.name] = nodes[d.type](...(value ? [value] : [])).toVar();
      }
    } else if (n instanceof A.Return) {
      if (n.value) result.assign(expression(n.value, scope));
      return;
    } else if (n instanceof A.Discard) nodes.Discard();
    else if (n instanceof A.Break) nodes.Break();
    else if (n instanceof A.Continue) nodes.Continue();
    else if (n instanceof A.Conditional) {
      let b: A.Conditional | null = n;
      let branch;
      while (b) {
        const current: A.Conditional = b;
        const run = () => block(current.body, Object.create(scope), result);
        if (!branch) branch = nodes.If(expression(current.cond!, scope), run);
        else if (current.cond) branch.ElseIf(expression(current.cond, scope), run);
        else branch.Else(run);
        b = current.elseConditional;
      }
      if (n.body.some((s) => s instanceof A.Return) && !n.elseConditional) {
        branch.Else(() => block(body.slice(i + 1), Object.create(scope), result));
        return;
      }
    } else if (n instanceof A.For) {
      const init = n.initialization as A.VariableDeclaration,
        cond = n.condition as A.Operator;
      nodes.Loop(
        {
          name: init.name,
          start: expression(init.value!, scope),
          end: expression(cond.right!, scope),
          condition: cond.type,
        },
        (indices: Scope) => {
          block(
            n.body,
            Object.assign(Object.create(scope), { [init.name]: indices[init.name] }),
            result,
          );
        },
      );
    } else expression(n, scope);
  }
}

const placeholder = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
placeholder.needsUpdate = true;
const globals = new WeakSet<IUniform>(Object.values(retroGlobals));
const bound = new WeakMap<IUniform, Map<string, any>>();
function binding(slot: IUniform, type: string, size: number): any {
  let byType = bound.get(slot);
  if (!byType) bound.set(slot, (byType = new Map()));
  const key = type + size;
  if (byType.has(key)) return byType.get(key);
  let node;
  if (type === 'sampler2D') {
    node = nodes.texture(slot.value ?? placeholder);
    Object.defineProperty(node, 'value', { get: () => slot.value ?? placeholder });
  } else if (size) {
    node = ArrayBuffer.isView(slot.value)
      ? nodes.buffer(slot.value, type, size)
      : nodes.uniformArray(slot.value, type);
  } else {
    node = nodes.uniform(slot.value, slot.value?.isColor ? 'color' : type);
    Object.defineProperty(node, 'value', { get: () => slot.value });
  }
  if (globals.has(slot)) node.setGroup(nodes.renderGroup);
  byType.set(key, node);
  return node;
}

const matrices = new WeakMap<BufferGeometry, WeakMap<BufferAttribute, any>>();
export function instanceMatrixNode(mesh: InstancedMesh): any {
  const attr = mesh.instanceMatrix;
  // Three releases node vertex buffers with their geometry. Skin swaps retain
  // the CPU instanceMatrix, but the replacement must own a fresh GPU buffer.
  const geometry = mesh.geometry;
  let cache = matrices.get(geometry);
  if (!cache) {
    matrices.set(geometry, (cache = new WeakMap()));
    const release = () => {
      matrices.delete(geometry);
      geometry.removeEventListener('dispose', release);
    };
    geometry.addEventListener('dispose', release);
  }
  if (cache.has(attr)) return cache.get(attr);
  const buf = new InstancedInterleavedBuffer(attr.array, 16);
  buf.setUsage(attr.usage);
  const node = nodes.Fn(() => {
    nodes.OnBeforeFrameUpdate(() => {
      if (buf.version === attr.version) return;
      buf.clearUpdateRanges();
      for (let i = 0; i < attr.updateRanges.length; i++)
        buf.updateRanges.push(attr.updateRanges[i]);
      buf.version = attr.version;
    });
    return nodes.mat4(
      ...[0, 4, 8, 12].map((offset) => nodes.instancedBufferAttribute(buf, 'vec4', 16, offset)),
    );
  })();
  cache.set(attr, node);
  return node;
}

type Declaration = { kind: string; type: string; name: string; size: number };
type Stage = { inputs: Declaration[]; functions: A.FunctionDeclaration[]; arrays: Scope };
const stages = new Map<string, Stage>();
function decode(source: string, macros: string): Stage {
  const key = macros + source;
  const cached = stages.get(key);
  if (cached) return cached;
  // The decoder's bundled gl_FragCoord polyfill uses normalized Y. Our shader
  // takes integer pixel coordinates with OpenGL's lower-left origin instead.
  const decoder = new GLSLDecoder() as GLSLDecoder & {
    keywords: unknown[];
    preprocess(s: string): string;
  };
  decoder.keywords.length = 0;
  const inputs: Declaration[] = [];
  const arrays: Scope = {};
  const code = decoder
    .preprocess(key)
    .replace(/\/\/[^\n]*/g, '')
    .replace(
      /(?:layout\s*\([^)]*\)\s*)?(?:flat\s+)?\b(in|out|uniform)\s+(\w+)\s+(\w+)\s*(?:\[(\d+)\])?\s*;/g,
      (_, kind, type, name, size) => {
        inputs.push({ kind, type, name, size: Number(size) || 0 });
        return '';
      },
    )
    .replace(
      /const (float|int) (\w+)\[\d+\]\s*=\s*\w+\[\d+\]\(([^)]*)\);/g,
      (_, type, name, values: string) => {
        arrays[name] = nodes.array(values.split(',').map((v) => nodes[type](Number(v))));
        return '';
      },
    );
  const stage = {
    inputs,
    arrays,
    functions: decoder
      .parse(code)
      .body.filter((s): s is A.FunctionDeclaration => s instanceof A.FunctionDeclaration),
  };
  stages.set(key, stage);
  return stage;
}

const pixel = nodes.vec4(
  nodes.screenCoordinate.x,
  nodes.screenSize.y.sub(nodes.screenCoordinate.y),
  nodes.screenCoordinate.z,
  1,
);
function graph(stage: Stage, global: Scope, vertex: boolean): any {
  return nodes.Fn(() => {
    const scope = Object.assign(Object.create(global), stage.arrays);
    const result = nodes.vec4(0).toVar();
    scope[vertex ? 'gl_Position' : 'outColor'] = result;
    for (const f of stage.functions) {
      if (f.name === 'main') {
        block(f.body, scope, result);
        continue;
      }
      scope[f.name] = (...args: any[]) => {
        const local = Object.create(scope);
        for (let i = 0; i < args.length; i++)
          local[f.params[i].name] = nodes[f.params[i].type](args[i]).toVar();
        const ret = nodes[f.type]().toVar();
        block(f.body, local, ret);
        return ret;
      };
    }
    return result;
  })();
}

export function translateMaterial(mat: ShaderMaterial, mesh: Mesh): NodeMaterial {
  const instance = mesh as InstancedMesh;
  const defs = { ...mat.defines };
  if (instance.isInstancedMesh) defs.USE_INSTANCING = 1;
  if (instance.instanceColor) defs.USE_INSTANCING_COLOR = 1;
  if (mat.vertexColors && mesh.geometry.hasAttribute('color')) defs.USE_COLOR = 1;
  const macros = Object.entries(defs)
    .map(([k, v]) => '#define ' + k + ' ' + (v || 1) + '\n')
    .join('');
  const vertex = decode(mat.vertexShader, macros),
    fragment = decode(mat.fragmentShader, macros);
  const common: Scope = {
    modelMatrix: nodes.modelWorldMatrix,
    viewMatrix: nodes.cameraViewMatrix,
    projectionMatrix: nodes.cameraProjectionMatrix,
    modelViewMatrix: nodes.modelViewMatrix,
    cameraPosition: nodes.cameraPosition,
    position: nodes.positionGeometry,
    normal: nodes.normalGeometry,
    uv: mesh.geometry.hasAttribute('uv') ? nodes.attribute('uv', 'vec2') : nodes.vec2(0),
    color: nodes.attribute('color', 'vec3'),
    gl_InstanceID: nodes.instanceIndex,
    gl_FragCoord: pixel,
    true: nodes.bool(true),
    false: nodes.bool(false),
  };
  if (instance.isInstancedMesh) common.instanceMatrix = instanceMatrixNode(instance);
  if (instance.instanceColor)
    common.instanceColor = nodes.instancedBufferAttribute(instance.instanceColor, 'vec3');
  for (const d of [...vertex.inputs, ...fragment.inputs]) {
    if (d.kind !== 'uniform' || !mat.uniforms[d.name]) continue;
    const uniform = mat.uniforms[d.name];
    const raw = binding(uniform, d.type, d.size);
    // Post shaders use bottom-left UVs. WebGPU render targets have a top-left origin.
    const tex = uniform.value as Texture | null;
    common[d.name] =
      d.type === 'sampler2D' &&
      (tex?.isRenderTargetTexture || d.name === 'tDepth' || d.name === 'uGfxShadowMap')
        ? { sample: (uv: any) => raw.sample(uv.flipY()), load: (p: any) => raw.load(p) }
        : raw;
  }
  for (const d of vertex.inputs) {
    if (d.kind === 'in') common[d.name] = nodes.attribute(d.name, d.type);
    if (d.kind === 'out') common[d.name] = nodes.varyingProperty(d.type, d.name);
  }
  const material = new NodeMaterial();
  material.fog = false;
  material.vertexNode = graph(vertex, common, true);
  material.fragmentNode = graph(fragment, common, false);
  return material;
}
