export const GlobeMaterial = {

    vertex: /* glsl */`
        varying vec3 vNormal;
        varying vec3 vViewDir;

        void main() {
            vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
            vNormal  = normalize(normalMatrix * normal);
            vViewDir = normalize(-mvPos.xyz);       // fragment → camera (view-space)
            gl_Position = projectionMatrix * mvPos;
        }
    `,

    fragment: /* glsl */`
        varying vec3 vNormal;
        varying vec3 vViewDir;

        void main() {
            float NdotV = clamp(dot(normalize(vNormal), normalize(vViewDir)), 0.0, 1.0);

            // ── Schlick Fresnel (F0 = 0.04 for glass, power 7) ─────────────
            float fresnel = 0.04 + 0.96 * pow(1.0 - NdotV, 7.0);

            // ── Color ───────────────────────────────────────────────────────
            vec3 color = mix(
                vec3(0.01,  0.015, 0.04),   // near-void center
                vec3(0.82,  0.90,  1.00),   // cool glass-white rim
                fresnel
            );

            // ── Alpha ───────────────────────────────────────────────────────
            float alpha = fresnel * 0.88 + 0.012;

            gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
        }
    `
};

export const VisualizerMaterial = {

    vertex: /* glsl */`
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,

    fragment: /* glsl */`
        uniform sampler2D uFreqData;   // 128×1 RGBA — FFT bins in .r, 0→1
        uniform float     uMode;       // 0=polar  1=bars  2=ring  (float — Three.js sends floats)
        uniform float     uPalette;    // 0=accent 1=cyan  2=plasma 3=mono
        uniform float     uTime;
        uniform float     uOpacity;

        varying vec2 vUv;

        #define PI      3.14159265359
        #define TWO_PI  6.28318530718

        // ── Palette ─────────────────────────────────────────────────────────────
        vec3 pal(float amp) {
            if (uPalette < 0.5) return mix(vec3(0.9,  0.22, 0.0),  vec3(1.0,  0.62, 0.15), amp); // Accent
            if (uPalette < 1.5) return mix(vec3(0.0,  0.58, 0.85), vec3(0.4,  0.95, 1.0),  amp); // Cyan
            if (uPalette < 2.5) {                                                                  // Plasma
                vec3 lo  = vec3(0.45, 0.0,  0.75);
                vec3 mid = vec3(0.85, 0.0,  0.45);
                vec3 hi  = vec3(1.0,  0.45, 0.0);
                return amp < 0.5 ? mix(lo, mid, amp * 2.0) : mix(mid, hi, (amp - 0.5) * 2.0);
            }
            return mix(vec3(0.55, 0.60, 0.68), vec3(1.0), amp);                                   // Mono
        }

        void main() {
            vec2  p = (vUv - 0.5) * 2.0;   // -1..1, center at origin
            float r = length(p);
            if (r > 1.0) discard;

            float angle = atan(p.y, p.x);              // -PI to PI
            float t     = (angle + PI) / TWO_PI;       // 0→1 around circle

            float intensity = 0.0;
            float amp       = 0.0;

            // ── Mode 0: Polar ────────────────────────────────────────────────────
            if (uMode < 0.5) {
                amp = texture2D(uFreqData, vec2(t, 0.5)).r;

                float innerR  = 0.26;
                float outerR  = innerR + amp * 0.68;

                float bar     = step(innerR, r) * step(r, outerR);
                float ring    = smoothstep(0.022, 0.0, abs(r - innerR)) * 0.38;
                float tipDist = r - outerR;
                float glow    = max(0.0, 1.0 - tipDist / 0.1) * step(0.0, tipDist) * amp * 0.65;

                intensity = max(bar, ring) + glow;

            // ── Mode 1: Bars ─────────────────────────────────────────────────────
            } else if (uMode < 1.5) {
                amp        = texture2D(uFreqData, vec2(vUv.x, 0.5)).r;
                float fill = step(vUv.y, amp * 0.92);
                float edge = max(0.0, 1.0 - abs(vUv.y - amp * 0.92) / 0.055);
                float clip = step(r, 0.98);

                intensity = (fill * 0.70 + edge * 0.95) * clip;

            // ── Mode 2: Ring Wave ────────────────────────────────────────────────
            } else {
                amp = texture2D(uFreqData, vec2(t, 0.5)).r;

                float ringR = 0.48 + amp * 0.36;
                float dist  = abs(r - ringR);
                float rim   = smoothstep(0.03, 0.0, dist);
                float bloom = smoothstep(0.16, 0.0, dist) * amp * 0.5;
                float quiet = smoothstep(0.018, 0.0, abs(r - 0.48)) * 0.28;

                intensity = max(rim + bloom, quiet);
            }

            if (intensity < 0.004) discard;

            gl_FragColor = vec4(pal(amp) * intensity * uOpacity, 1.0);
        }
    `
};

// ── SHARED PALETTE (injected into each visualizer fragment shader) ────────────
const PALETTE_GLSL = `
uniform float uPalette;

vec3 getPalette(float t) {
    vec3 c = vec3(0.0);
    if (uPalette < 0.5) {
        c = mix(vec3(1.0, 0.1, 0.0), vec3(1.0, 0.8, 0.2), t);       // Accent (Orange/Fire)
    } else if (uPalette < 1.5) {
        c = mix(vec3(0.0, 0.4, 0.9), vec3(0.4, 0.9, 1.0), t);        // Cyan (Data)
    } else if (uPalette < 2.5) {
        c = mix(vec3(0.3, 0.0, 0.6), vec3(1.0, 0.0, 0.4), t);        // Plasma (Purple/Pink)
    } else {
        c = vec3(t * 0.9 + 0.1);                                       // Mono
    }
    return c;
}
`;

// ── MODE 0: SCAN (Holographic Core) ──────────────────────────────────────────
export const ScanMaterial = {
    vertex: /* glsl */`
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragment: /* glsl */`
        uniform sampler2D uFreqData;
        uniform float uTime;
        uniform float uOpacity;
        varying vec2 vUv;

        ${PALETTE_GLSL}

        void main() {
            vec2 p = (vUv - 0.5) * 2.0;
            float r = length(p);
            float a = atan(p.y, p.x);
            float t = (a + 3.14159) / 6.28318;

            float freq = texture2D(uFreqData, vec2(abs(t - 0.5) * 2.0, 0.5)).r;

            // Concentric scan rings
            float rings = fract(r * 6.0 - uTime * 0.1);
            float ringLine = smoothstep(0.0, 0.05, rings) * smoothstep(0.1, 0.05, rings);

            // Radar sweep arm
            float sweep = smoothstep(0.0, 0.3, 1.0 - abs(mod(t - uTime * 0.2, 1.0) - 0.5) * 2.0);

            // Audio-reactive wave
            float wave = smoothstep(0.01, 0.0, abs(r - (0.3 + freq * 0.4)));

            float alpha = (ringLine * 0.1 + wave + sweep * 0.1) * smoothstep(1.0, 0.8, r);
            vec3 col = getPalette(freq);

            if (alpha < 0.01) discard;
            gl_FragColor = vec4(col, alpha * uOpacity);
        }
    `
};

// ── MODE 1: ORBIT (Equatorial Carrier Wave) ───────────────────────────────────
export const OrbitMaterial = {
    vertex: /* glsl */`
        uniform sampler2D uFreqData;
        varying float vAmp;
        varying vec2 vUv;

        void main() {
            vUv = uv;
            float amp = texture2D(uFreqData, vec2(uv.x, 0.5)).r;
            vAmp = amp;

            vec3 pos = position;
            pos.z += amp * 12.0;  // spike outward perpendicular to ring plane

            gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
    `,
    fragment: /* glsl */`
        uniform float uOpacity;
        varying float vAmp;
        varying vec2 vUv;

        ${PALETTE_GLSL}

        void main() {
            float rim = 1.0 - abs(vUv.y - 0.5) * 2.0;
            float alpha = smoothstep(0.0, 0.2, rim);

            vec3 col = getPalette(vAmp);
            col += vec3(0.5) * step(0.8, vAmp);  // brighten frequency peaks

            gl_FragColor = vec4(col, alpha * vAmp * uOpacity * 1.5);
        }
    `
};

// ── MODE 2: FLUX (Ionosphere Shield) ─────────────────────────────────────────
export const FluxMaterial = {
    vertex: /* glsl */`
        varying vec3 vNormal;
        varying vec3 vPos;    // object-space position — seam-free noise input
        void main() {
            vNormal = normalize(normalMatrix * normal);
            vPos    = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragment: /* glsl */`
        uniform sampler2D uFreqData;
        uniform float uTime;
        uniform float uOpacity;
        varying vec3 vNormal;
        varying vec3 vPos;

        ${PALETTE_GLSL}

        // ── 2D value noise (used per-face in triplanar below) ─────────────────
        float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(
                mix(hash2(i + vec2(0.0, 0.0)), hash2(i + vec2(1.0, 0.0)), f.x),
                mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x),
                f.y
            );
        }

        // ── Triplanar noise — no UV seam ─────────────────────────────────────
        // Projects object-space position onto YZ / XZ / XY planes,
        // blends by surface normal so no discontinuity exists anywhere on the sphere.
        float triNoise(vec3 p, float t) {
            // Scale: sphere r=105, scale * 105 ≈ 10 → similar cell density to old vUv*10
            float s = 0.095;
            float nx = vnoise(p.yz * s + vec2(t * 0.20, t * 0.05));
            float ny = vnoise(p.xz * s + vec2(t * 0.15, t * 0.07));
            float nz = vnoise(p.xy * s + vec2(t * 0.18, t * 0.04));

            // Blend weights — sharpen to reduce transition zones
            vec3 w = pow(abs(normalize(p)), vec3(6.0));
            w /= w.x + w.y + w.z;
            return nx * w.x + ny * w.y + nz * w.z;
        }

        void main() {
            // Average low-frequency (bass) bins
            float bass = 0.0;
            for (int i = 0; i < 10; i++) bass += texture2D(uFreqData, vec2(float(i) / 128.0, 0.5)).r;
            bass /= 10.0;

            float n = triNoise(vPos, uTime);

            // Fresnel rim — view-space normal dot view direction (0,0,1)
            float NdotV  = abs(dot(vNormal, vec3(0.0, 0.0, 1.0)));
            float fresnel = pow(1.0 - NdotV, 2.5);

            // Pull the peak inward so alpha returns to ~0 before the geometry hard-stops.
            // smoothstep(1.0, 0.6, fresnel) = 1 near centre, 0 at the silhouette.
            float rimGlow = fresnel * smoothstep(1.0, 0.60, fresnel);

            float alpha = (n * bass * 0.8 + rimGlow * 0.55) * uOpacity;
            vec3  col   = getPalette(bass * n + 0.2);

            gl_FragColor = vec4(col, alpha);
        }
    `
};

export const BackgroundMaterial = {

    vertex: /* glsl */`
        varying vec2 vUv;
        varying vec3 vWorldDir; // 3D direction for seamless noise
        
        void main() {
            vUv = uv;
            // On a sphere centered at (0,0,0), position is the direction.
            vWorldDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,

    fragment: /* glsl */`
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vWorldDir;

        // ── 3D NOISE UTILITIES (SEAMLESS) ───────────────────────────────────
        
        vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
        vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

        // Simplex Noise 3D
        float snoise(vec3 v) { 
            const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
            const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);

            // First corner
            vec3 i  = floor(v + dot(v, C.yyy) );
            vec3 x0 = v - i + dot(i, C.xxx) ;

            // Other corners
            vec3 g = step(x0.yzx, x0.xyz);
            vec3 l = 1.0 - g;
            vec3 i1 = min( g.xyz, l.zxy );
            vec3 i2 = max( g.xyz, l.zxy );

            //   x0 = x0 - 0.0 + 0.0 * C.xxx;
            //   x1 = x0 - i1  + 1.0 * C.xxx;
            //   x2 = x0 - i2  + 2.0 * C.xxx;
            //   x3 = x0 - 1.0 + 3.0 * C.xxx;
            vec3 x1 = x0 - i1 + C.xxx;
            vec3 x2 = x0 - i2 + C.yyy; // 2.0*C.x = 1/3 = C.y
            vec3 x3 = x0 - D.yyy;      // -1.0+3.0*C.x = -0.5 = -D.y

            // Permutations
            i = mod289(i); 
            vec4 p = permute( permute( permute( 
                        i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
                    + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) 
                    + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));

            // Gradients: 7x7 points over a square, mapped onto an octahedron.
            // The ring size 17*17 = 289 is close to a multiple of 49 (49*6 = 294)
            float n_ = 0.142857142857; // 1.0/7.0
            vec3  ns = n_ * D.wyz - D.xzx;

            vec4 j = p - 49.0 * floor(p * ns.z * ns.z);  //  mod(p,7*7)

            vec4 x_ = floor(j * ns.z);
            vec4 y_ = floor(j - 7.0 * x_ );    // mod(j,N)

            vec4 x = x_ *ns.x + ns.yyyy;
            vec4 y = y_ *ns.x + ns.yyyy;
            vec4 h = 1.0 - abs(x) - abs(y);

            vec4 b0 = vec4( x.xy, y.xy );
            vec4 b1 = vec4( x.zw, y.zw );

            //vec4 s0 = vec4(lessThan(b0,0.0))*2.0 - 1.0;
            //vec4 s1 = vec4(lessThan(b1,0.0))*2.0 - 1.0;
            vec4 s0 = floor(b0)*2.0 + 1.0;
            vec4 s1 = floor(b1)*2.0 + 1.0;
            vec4 sh = -step(h, vec4(0.0));

            vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
            vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;

            vec3 p0 = vec3(a0.xy,h.x);
            vec3 p1 = vec3(a0.zw,h.y);
            vec3 p2 = vec3(a1.xy,h.z);
            vec3 p3 = vec3(a1.zw,h.w);

            //Normalise gradients
            vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
            p0 *= norm.x;
            p1 *= norm.y;
            p2 *= norm.z;
            p3 *= norm.w;

            // Mix final noise value
            vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
            m = m * m;
            return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), 
                                        dot(p2,x2), dot(p3,x3) ) );
        }

        // Fractal Brownian Motion (3D)
        float fbm(vec3 x) {
            float v = 0.0;
            float a = 0.5;
            // Rotate to reduce axial bias
            mat3 rot = mat3(
                0.00,  0.80,  0.60,
                -0.80,  0.36, -0.48,
                -0.60, -0.48,  0.64 
            );
            for (int i = 0; i < 3; ++i) {
                v += a * snoise(x);
                x = rot * x * 2.0; 
                a *= 0.5;
            }
            return v;
        }

        // ── STAR SYSTEM (2D - Kept 2D for sharpness, but fixed logic) ───────
        float hash12(vec2 p) {
            vec3 p3  = fract(vec3(p.xyx) * .1031);
            p3 += dot(p3, p3.yzx + 33.33);
            return fract((p3.x + p3.y) * p3.z);
        }

        vec3 starLayer(vec2 uv, float scale, float thresh, float falloff, vec3 tint) {
            vec2 st = uv * scale;
            vec2 id = floor(st);
            vec2 f  = fract(st);

            float h = hash12(id);
            if (h < thresh) return vec3(0.0);

            vec2 pos = vec2(hash12(id + 154.45), hash12(id + 92.2));
            vec2 diff = f - pos;

            float twinkle = 0.5 + 0.5 * sin(uTime * (1.0 + h * 4.0) + h * 100.0);
            
            float dist = length(diff);
            float brightness = max(0.0, 1.0 - dist * 2.0); 
            brightness = pow(brightness, falloff); 

            return tint * brightness * twinkle;
        }

        // ── MAIN ────────────────────────────────────────────────────────────
        
        void main() {
            vec2 st = vUv;
            // Use 3D coords for seamless nebula
            vec3 pos = vWorldDir; 
            
            // 1. DEEP VOID BACKGROUND
            // Gradient based on Y (vertical), but allow it to wrap fully 
            // without hard edges. simple vertical gradient is safe.
            vec3 bg = mix(vec3(0.001, 0.002, 0.005), vec3(0.005, 0.008, 0.015), smoothstep(-1.0, 1.0, pos.y));

            // 2. DOMAIN WARPING NEBULA (3D)
            // Using 3D noise eliminates the seam completely.
            float t = uTime * 0.02;
            
            vec3 q = vec3(0.);
            q.x = fbm(pos + vec3(0.0, 0.0, 0.0) + 0.05*t);
            q.y = fbm(pos + vec3(5.2, 1.3, 2.8) + 0.08*t);
            q.z = fbm(pos + vec3(1.2, 5.4, 2.1) + 0.06*t);

            vec3 r = vec3(0.);
            r.x = fbm(pos + 4.0*q + vec3(1.7, 9.2, 0.5) + 0.15*t);
            r.y = fbm(pos + 4.0*q + vec3(8.3, 2.8, 1.1) + 0.126*t);
            r.z = fbm(pos + 4.0*q + vec3(2.1, 5.1, 7.8) + 0.11*t);

            float f = fbm(pos + 4.0*r);

            // Coloring
            vec3 gasColor = mix(
                vec3(0.0, 0.12, 0.18),      // Darkest gas (richer teal shadow)
                vec3(0.20, 0.0, 0.35),      // Midtone (richer royal purple)
                clamp(f*f*4.0, 0.0, 1.0)
            );

            vec3 hotGas = mix(
                vec3(0.25, 0.0, 0.08),      // Dark wine-red
                vec3(0.70, 0.20, 0.0),      // Amber (no white-hot)
                clamp(length(q), 0.0, 1.0)
            );

            vec3 nebula = mix(gasColor, hotGas, length(r) * f);
            bg += nebula * 0.55;

            // 3. STAR FIELD
            // (Stars use 2D UVs. The seam is technically present in the grid, 
            // but without the black vignette line, it is invisible to the eye 
            // unless a star sits exactly on the pixel line)
            bg += starLayer(st, 150.0, 0.90, 8.0, vec3(0.6, 0.7, 1.0)) * 0.8;
            bg += starLayer(st, 80.0, 0.95, 12.0, vec3(0.9, 0.9, 1.0)) * 1.0;
            bg += starLayer(st, 25.0, 0.98, 20.0, vec3(1.0, 0.85, 0.6)) * 1.5;

            // 4. VIGNETTE (REMOVED)
            // The black line was caused by uv.x * (1.0 - uv.x).
            // A sky sphere should not have corners.
            // If we want a slight top/bottom fade:
            float poleFade = 1.0 - abs(pos.y); // Fade only at extreme poles if needed
            // bg *= smoothstep(0.0, 0.2, poleFade); // Optional, usually not needed in space

            // 5. DITHERING
            // Prevents banding in dark gradients
            float dither = fract(sin(dot(vUv * 1000.0, vec2(12.9898, 78.233))) * 43758.5453);
            bg += (dither - 0.5) / 255.0;

            gl_FragColor = vec4(bg, 1.0);
        }
    `
};