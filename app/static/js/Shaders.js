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
            for (int i = 0; i < 5; ++i) {
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
                vec3(0.0, 0.1, 0.15),       // Darkest gas (Teal shadow)
                vec3(0.15, 0.05, 0.25),     // Midtone (Royal Purple)
                clamp(f*f*4.0, 0.0, 1.0)
            );
            
            vec3 hotGas = mix(
                vec3(0.3, 0.0, 0.05),       // Dark Red
                vec3(1.0, 0.6, 0.3),        // Orange Gold
                clamp(length(q), 0.0, 1.0)
            );

            vec3 nebula = mix(gasColor, hotGas, length(r) * f);
            bg += nebula * 0.45;

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