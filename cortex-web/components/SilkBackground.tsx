"use client";

import { useEffect, useRef } from "react";

/**
 * Animated monochrome "silk smoke" behind the hero and page headers.
 * One full-screen fragment shader (raw WebGL, no three.js bundle), rendered at
 * reduced resolution and upscaled: the subject is soft, so it costs little.
 * Pauses off-screen and in hidden tabs; draws a single still frame for
 * prefers-reduced-motion. Without WebGL the CSS gradient on the wrapper stays.
 */
type Props = {
  /** Overall brightness. 1 for the landing hero, lower for document headers. */
  intensity?: number;
  /** How much the middle is darkened so centred text stays readable (0..1). */
  shade?: number;
  className?: string;
};

const VERTEX = `attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`;

const FRAGMENT = `
precision mediump float;
uniform vec2 u_res;
uniform float u_time;
uniform vec2 u_mouse;
uniform float u_intensity;
uniform float u_shade;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), u.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0., a = .5;
  mat2 r = mat2(.8, .6, -.6, .8);
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = r * p * 2.02; a *= .5; }
  return v;
}

void main(){
  vec2 p = (gl_FragCoord.xy - .5 * u_res) / u_res.y;
  float t = u_time * .045;
  p += u_mouse * .035;
  // Slight diagonal, then bend space with slow noise so the ribbons curl.
  p = mat2(.94, .34, -.34, .94) * p;
  vec2 w = vec2(fbm(p * .8 + vec2(0., t)), fbm(p * .8 + vec2(4.1, -t)));
  vec2 s = p + (w - .5) * .95;

  // Four ribbons of silk: a thin bright highlight on a soft glowing body.
  float c = 0.;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float y = .34 * sin(s.x * (1.05 + .22 * fi) + t * (2.2 + .5 * fi) + fi * 1.9)
            + .15 * sin(s.x * 2.4 - t * 1.4 + fi * 2.3) + (fi - 1.5) * .21;
    float d = abs(s.y - y);
    c += exp(-d * d * 420.) * (.46 - fi * .07) + exp(-d * d * 60.) * .12 + exp(-d * 9.) * .05;
  }
  // A thin layer of smoke between the ribbons.
  c += smoothstep(.5, .95, fbm(s * 1.7 + 2. * w + t)) * .14;

  // Keep the middle calm for the headline and fade toward the edges.
  float d = length(p * vec2(.75, 1.25));
  c *= mix(1. - u_shade, 1., smoothstep(.05, .75, d));
  c *= 1. - smoothstep(.85, 1.55, length(p));
  c *= u_intensity;
  c += (hash(gl_FragCoord.xy + u_time) - .5) * .018;
  gl_FragColor = vec4(vec3(pow(clamp(c, 0., 1.), .78)), 1.);
}`;

export default function SilkBackground({ intensity = 1, shade = .55, className = "" }: Props) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrapper = host.current;
    if (!wrapper) return;
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: "low-power" });
    if (!gl) return;

    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
    };
    const vs = compile(gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT);
    if (!vs || !fs) return;
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "a");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(program, "u_res");
    const uTime = gl.getUniformLocation(program, "u_time");
    const uMouse = gl.getUniformLocation(program, "u_mouse");
    gl.uniform1f(gl.getUniformLocation(program, "u_intensity"), intensity);
    gl.uniform1f(gl.getUniformLocation(program, "u_shade"), shade);

    canvas.className = "silk-canvas";
    canvas.setAttribute("aria-hidden", "true");
    wrapper.appendChild(canvas);

    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // The image is soft: half resolution (a third on phones) is indistinguishable.
    const scale = Math.min(window.devicePixelRatio || 1, 2) * (coarse ? .34 : .5);
    const resize = () => {
      const width = Math.max(1, Math.round(wrapper.clientWidth * scale));
      const height = Math.max(1, Math.round(wrapper.clientHeight * scale));
      if (canvas.width === width && canvas.height === height) return;
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
      gl.uniform2f(uRes, width, height);
      if (still) draw(0);
    };

    const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
    const start = performance.now() - 18_000;
    let frame = 0;
    let visible = true;
    const draw = (now: number) => {
      mouse.x += (mouse.tx - mouse.x) * .04;
      mouse.y += (mouse.ty - mouse.y) * .04;
      gl.uniform2f(uMouse, mouse.x, mouse.y);
      gl.uniform1f(uTime, still ? 18 : (now - start) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const loop = (now: number) => {
      frame = 0;
      draw(now);
      if (visible && !document.hidden) frame = requestAnimationFrame(loop);
    };
    const run = () => { if (!still && !frame && visible && !document.hidden) frame = requestAnimationFrame(loop); };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(wrapper);
    resize();
    const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; run(); });
    intersection.observe(wrapper);
    const onVisibility = () => run();
    document.addEventListener("visibilitychange", onVisibility);
    const onPointer = (event: PointerEvent) => {
      mouse.tx = event.clientX / window.innerWidth - .5;
      mouse.ty = .5 - event.clientY / window.innerHeight;
    };
    if (!coarse && !still) window.addEventListener("pointermove", onPointer, { passive: true });
    if (still) draw(0);
    else run();
    requestAnimationFrame(() => wrapper.classList.add("is-ready"));

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersection.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointermove", onPointer);
      canvas.remove();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [intensity, shade]);

  return <div ref={host} className={`silk ${className}`} aria-hidden="true" />;
}
