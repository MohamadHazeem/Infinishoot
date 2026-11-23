// One set of equations for the WebGL2 vertex path and the WebGPU compute path.
// Each launch record drives one large fragment and a fan of smaller satellites.
export const PARTICLE_COPIES = 10;
export const PARTICLE_GROUPS = 2048;
export const PARTICLE_STRIDE = 16;
export const enum ParticleKind {
  Chip,
  Splat,
  Flake,
  Spark,
  Smoke,
  Dust,
}

// The shader functions only differ in scalar declarations and vector constructors.
export function particleMotion(wgsl: boolean): string {
  const f = wgsl ? 'let' : 'float';
  const v = wgsl ? 'vec4f' : 'vec4';
  const signature = wgsl
    ? 'fn particleMotion(o: vec4f, v: vec4f, s: vec4f, clock: f32, child: f32) -> vec4f'
    : 'vec4 particleMotion(vec4 o, vec4 v, vec4 s, float clock, float child)';
  return `${signature} {
    ${f} age = max(0.0, clock-o.w);
    ${f} k = clamp(age/max(0.001,v.w),0.0,1.0);
    ${f} satellite = step(0.5,child);
    ${f} seed = fract(dot(v.xyz,${wgsl ? 'vec3f' : 'vec3'}(0.71,0.23,0.47))+o.w*0.37);
    ${f} fan = satellite*(fract(child*0.618+seed)-0.5)*1.8;
    ${f} scale = 1.0-satellite*fract(child*0.37+seed)*0.65;
    ${f} travel = (1.0-exp(-max(0.001,s.z)*age))/max(0.001,s.z)*scale;
    ${f} dx = v.x*cos(fan)-v.z*sin(fan);
    ${f} dz = v.x*sin(fan)+v.z*cos(fan);
    ${f} up = v.y*(1.0+satellite*(fract(child*0.73+seed)-0.5));
    ${f} g = max(0.001,s.y);
    ${f} hitSpeed = sqrt(max(0.0,up*up+2.0*g*max(0.0,o.y-0.04)));
    ${f} groundTime = max(0.0,age-(up+hitSpeed)/g);
    ${f} afterBounce = max(0.0,groundTime-0.68*hitSpeed/g);
    ${f} bounce = max(0.0,groundTime*(0.34*hitSpeed-0.5*g*groundTime))
      + max(0.0,afterBounce*(0.10*hitSpeed-0.5*g*afterBounce));
    ${f} y = max(0.04,o.y+up*age-0.5*s.y*age*age)+bounce;
    ${f} puff = step(3.5,s.w);
    ${f} radius = s.x*mix(1.0,0.48,satellite)*mix(min(1.0,(1.0-k)*3.0),1.0+1.4*k,puff);
    return ${v}(o.x+dx*travel,y,o.z+dz*travel,radius);
  }`;
}

export function particlePaint(wgsl: boolean): string {
  const f = wgsl ? 'let' : 'float';
  const v = wgsl ? 'vec4f' : 'vec4';
  const signature = wgsl
    ? 'fn particlePaint(uv: vec2f, tint: vec4f, kind: f32) -> vec4f'
    : 'vec4 particlePaint(vec2 uv, vec4 tint, float kind)';
  return `${signature} {
    ${f} edge = abs(uv.x)*0.82 + abs(uv.y);
    ${f} puff = step(3.5,kind);
    ${f} rounded = 1.0-smoothstep(0.67,1.0,length(uv));
    ${f} mask = mix(1.0-step(1.28,edge),rounded,puff);
    ${f} facet = mix(0.80+0.20*step(uv.x*0.45,uv.y),1.0,puff);
    return ${v}(tint.rgb*facet,tint.a*mask);
  }`;
}
