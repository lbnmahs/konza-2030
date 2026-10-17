import {
  Color,
  IcosahedronGeometry,
  Mesh,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  WebGLRenderer,
} from "three";

// K8 orb, WebGL layer: a liquid-glass sphere. The vertex shader moves the surface
// along its normal with 3D simplex noise (amplitude from the voice level); the fragment shader adds
// a Fresnel rim and a soft highlight tinted by the state colour. Loaded on demand by Orb.tsx, only
// when WebGL works and motion is allowed; the CSS orb underneath is the fallback and the first
// paint. Draws only while visible, at most 2x pixel ratio.

// Simplex noise by Ian McEwan and Stefan Gustavson (Ashima Arts), MIT licence.
const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.0-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;vec4 s1=floor(b1)*2.0+1.0;vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;

const VERTEX = /* glsl */ `
uniform float uTime;
uniform float uLevel;
varying vec3 vNormal;
varying vec3 vView;
varying float vNoise;
${NOISE}
void main(){
  float n = snoise(normal * 1.6 + vec3(0.0, 0.0, uTime * 0.25));
  float amp = 0.05 + uLevel * 0.14;
  vec3 p = position + normal * n * amp;
  vNoise = n;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vView = normalize(-mv.xyz);
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uBase;
uniform float uTime;
varying vec3 vNormal;
varying vec3 vView;
varying float vNoise;
void main(){
  vec3 n = normalize(vNormal);
  float facing = max(dot(n, vView), 0.0);
  float fres = pow(1.0 - facing, 2.2);
  vec3 body = mix(uBase, uColor, 0.32 + 0.22 * vNoise);
  vec3 light = normalize(vec3(-0.4, 0.7, 0.6));
  float spec = pow(max(dot(reflect(-light, n), vView), 0.0), 28.0);
  float sheen = 0.5 + 0.5 * sin(vNoise * 3.0 + uTime * 0.6);
  vec3 col = body * (0.62 + 0.38 * facing) + fres * mix(uColor, vec3(1.0), 0.35) * 0.85
    + spec * 0.55 + sheen * fres * 0.08;
  gl_FragColor = vec4(col, 0.9 + 0.1 * fres);
}`;

export type OrbHandle = { setColor(hex: string): void; setBase(hex: string): void; dispose(): void };

/** Throws if no WebGL context can be made; onLost fires if the browser later drops it (pages with
 * many contexts), so the caller can show the CSS orb again. */
export function mountOrb(canvas: HTMLCanvasElement, level: () => number, onLost: () => void): OrbHandle {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 1, 0.1, 10);
  camera.position.z = 4.6;
  const target = new Color("#2f9e6b");
  const uniforms = {
    uTime: { value: 0 },
    uLevel: { value: 0 },
    uColor: { value: new Color("#2f9e6b") },
    uBase: { value: new Color("#f4f6f8") },
  };
  const material = new ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms, transparent: true });
  const geometry = new IcosahedronGeometry(1, 40);
  scene.add(new Mesh(geometry, material));

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  let visible = true;
  const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
  io.observe(canvas);

  const lost = (e: Event) => {
    e.preventDefault();
    onLost();
  };
  canvas.addEventListener("webglcontextlost", lost);

  let raf = 0;
  let last = performance.now();
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (!visible || document.hidden) return;
    uniforms.uTime.value += dt;
    // Smooth the voice level and the colour so nothing jumps (restrained transitions).
    uniforms.uLevel.value += (Math.min(Math.max(level(), 0), 1) - uniforms.uLevel.value) * Math.min(dt * 6, 1);
    uniforms.uColor.value.lerp(target, Math.min(dt * 2.5, 1));
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);

  return {
    setColor: (hex) => target.set(hex),
    setBase: (hex) => uniforms.uBase.value.set(hex),
    dispose() {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("webglcontextlost", lost);
      ro.disconnect();
      io.disconnect();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    },
  };
}
