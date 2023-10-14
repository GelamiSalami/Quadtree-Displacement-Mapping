
const vsText = `#version 300 es
in vec4 aPosition;
in vec2 aUv;

out vec2 uUv;

void main() {
	gl_Position = aPosition;
	uUv = aUv;
}
`;

const fsCommonText = `

const float MAX_DIST = 100.0;

const float EPS = 1e-4;

const float PI = acos(-1.);
const float TAU = PI * 2.0;

mat3 getCameraMatrix(vec3 ro, vec3 lo)
{
	vec3 cw = normalize(lo - ro);
	vec3 cu = normalize(cross(cw, vec3(0, 1, 0)));
	vec3 cv = cross(cu, cw);

	return mat3(cu, cv, cw);
}

mat2 rot2D(float a)
{
	float c = cos(a);
	float s = sin(a);
	return mat2(c, s, -s, c);
}

// https://iquilezles.org/articles/palettes/
vec3 palette(float t)
{
	return .5 + .5 * cos(TAU * (vec3(1, 1, 1) * t + vec3(0, .33, .67)));
}

vec3 palette2(float t)
{
    return .45 + .55 * cos(TAU * (vec3(1, 0.95, 1) * t + vec3(0.3, 0.6, 0.8)));
}

float hash12(vec2 p)
{
	vec3 p3  = fract(vec3(p.xyx) * .1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

float hash13(vec3 p3)
{
	p3  = fract(p3 * .1031);
	p3 += dot(p3, p3.zyx + 31.32);
	return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p)
{
	vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973));
	p3 += dot(p3, p3.yzx+33.33);
	return fract((p3.xx+p3.yz)*p3.zy);
}

vec2 hash23(vec3 p3)
{
	p3 = fract(p3 * vec3(.1031, .1030, .0973));
	p3 += dot(p3, p3.yzx+33.33);
	return fract((p3.xx+p3.yz)*p3.zy);
}

// RNG
uint state;
void initState(vec2 coord, int frame)
{
	state = uint(coord.x) * 1321u + uint(coord.y) * 4123u + uint(frame) * 4123u*4123u;
}

// From Chris Wellons Hash Prospector
// https://nullprogram.com/blog/2018/07/31/
// https://www.shadertoy.com/view/WttXWX
uint hashi(inout uint x)
{
	x ^= x >> 16;
	x *= 0x7feb352dU;
	x ^= x >> 15;
	x *= 0x846ca68bU;
	x ^= x >> 16;
	return x;
}

float hash(inout uint x)
{
	return float( hashi(x) ) / float( 0xffffffffU );
}

vec2 hash2(inout uint x)
{
	return vec2(hash(x), hash(x));
}

vec3 hash3(inout uint x)
{
	return vec3(hash(x), hash(x), hash(x));
}

vec4 hash4(inout uint x)
{
	return vec4(hash(x), hash(x), hash(x), hash(x));
}

// Random unit vector
// Generate a random unit circle and scaled the z with a circular mapping
vec3 randomUnitVector()
{
	vec2 rand = hash2(state);
	rand.y = rand.y*2.-1.;
	rand.x *= PI*2.;
	
	float r = sqrt(1. - rand.y*rand.y);
	vec2 xy = vec2(cos(rand.x), sin(rand.x)) * r;
	
	return vec3(xy, rand.y);
}

// Random cosine-weighted unit vector on a hemisphere
// Unit vector + random unit vector
vec3 randomCosineHemisphere(vec3 n)
{
	return normalize(randomUnitVector() + n);
}

vec3 randomUnitInCone(float alpha)
{
	vec2 r = hash2(state);
	float u = TAU * r.x;
	float v = r.y;
	float z = 1.0 - v * (1.0 - cos(alpha));
	float rad = sqrt(1.0 - z*z);
	return vec3(rad * cos(u), rad * sin(u), z);
}

// Orthonormal Basis
// https://www.shadertoy.com/view/tlVczh
// MBR method 2a variant
mat3 getBasis(in vec3 n)
{
	float sz = n.z >= 0.0 ? 1.0 : -1.0;
	float a  =  n.y/(1.0+abs(n.z));
	float b  =  n.y*a;
	float c  = -n.x*a;

	vec3 xp = vec3(n.z+sz*b, sz*c, -n.x);
	vec3 yp = vec3(c, 1.0-b, -sz*n.y);

	return mat3(xp, yp, n);
}

vec3 sRGBToLinear(vec3 col)
{
	return mix(pow((col + 0.055) / 1.055, vec3(2.4)), col / 12.92, lessThan(col, vec3(0.04045)));
}
`;

const fsRenderText = `#version 300 es
precision highp float;

uniform float uTime;
uniform int uFrame;
uniform vec2 uResolution;
uniform vec4 uMouse;
uniform bool uMousePressed;
uniform bool uResetAccumulation;
uniform int uMaxBounces;
uniform int uMaxSteps;
uniform bool uIsVoxels;
uniform int uMinLod;
uniform bool uSmoothShading;
uniform int uLodLevels;

uniform vec3 uCameraPosition;
uniform vec3 uCameraPivotPosition;
uniform mat3 uCameraMatrix;
uniform float uInvTanFov;

uniform vec3 uSunDirection;
uniform float uSunAngle;
uniform vec3 uSunColor;
uniform float uSunStrength;
uniform float uEnvmapStrength;

uniform float uTextureScale;
uniform float uHeightScale;
uniform vec2 uTextureOffset;
uniform vec3 uTextureColor;
uniform bool uFlatColor;

uniform bool uDebugColor;
uniform bool uShowIterations;
uniform bool uShowNormals;

uniform sampler2D uTexture;
uniform sampler2D uNormalsTexture;
uniform sampler2D uMipmapTexture;
uniform sampler2D uEnvTexture;
uniform sampler2D uPrevTexture;
uniform sampler2D uDiffuseTexture;

` + fsCommonText + `

in vec2 uUv;

out vec4 fragColor;

float maxHeight;

// https://iquilezles.org/articles/intersectors/
vec2 boxIntersect( in vec3 ro, in vec3 rd, vec3 boxSize, out vec3 normal ) 
{
	vec3 m = 1.0/rd; // can precompute if traversing a set of aligned boxes
	vec3 n = m*ro;   // can precompute if traversing a set of aligned boxes
	vec3 k = abs(m)*boxSize;
	vec3 t1 = -n - k;
	vec3 t2 = -n + k;
	float tN = max( max( t1.x, t1.y ), t1.z );
	float tF = min( min( t2.x, t2.y ), t2.z );
	if( tN>tF || tF<0.0) return vec2(MAX_DIST); // no intersection
	normal = (tN>0.0) ? step(vec3(tN), t1) : // ro ouside the box
						step(t2, vec3(tF));  // ro inside the box
	normal *= -sign(rd);
	return vec2( tN, tF );
}

vec3 triIntersect( in vec3 ro, in vec3 rd, in vec3 v0, in vec3 v1, in vec3 v2, out vec3 normal )
{
	vec3 v1v0 = v1 - v0;
	vec3 v2v0 = v2 - v0;
	vec3 rov0 = ro - v0;
	vec3 n = cross( v1v0, v2v0 );
	vec3  q = cross( rov0, rd );
	float d = 1.0/dot( rd, n );

	// if (d > 0.0) return vec3(MAX_DIST, 0, 0);

	float u = d*dot( -q, v2v0 );
	float v = d*dot(  q, v1v0 );
	float t = d*dot( -n, rov0 );

	if( u<0.0 || v<0.0 || (u+v)>1.0 ) return vec3(MAX_DIST, 0, 0);

	normal = -sign(d) * normalize(n);

	return vec3( t, u, v );
}

struct HitInfo
{
	bool isHit;
	float t;
	vec3 normal;
	int i;
	vec3 id;
};

HitInfo trace(vec3 ro, vec3 rd, float tMax, vec3 id)
{
	HitInfo hit;

	float boxH = maxHeight * uHeightScale * 0.5;

	vec3 boxNormal;
	vec2 boxT = boxIntersect(ro - vec3(0, boxH, 0), rd, vec3(0.5 - 1e-3, boxH + 1e-3, 0.5 - 1e-3), boxNormal);

	if (boxT.x >= MAX_DIST)
	{
		return hit;
	}

	float bt = max(boxT.x, 0.0);
	ro = ro + rd * bt;
	tMax = boxT.y - bt;

	ro.xz += uTextureOffset;

	vec3 ird = 1.0 / rd;
	if (rd.x == 0.0) ird.x = EPS;
	if (rd.y == 0.0) ird.y = EPS;
	if (rd.z == 0.0) ird.z = EPS;

	vec3 iro = ro * ird;
	vec3 srd = sign(ird);
	vec3 ard = abs(ird);

	int lod = uLodLevels;

	float s = 1.0 / uTextureScale;
	float res = 1.0 / s;
	vec2 pos = (floor(ro.xz * res) + 0.5) * s;
	vec2 ppos = pos;

	for (int i = 0; i < uMaxSteps; i++)
	{
		hit.i = i;
		vec2 h = textureLod(uMipmapTexture, pos * uTextureScale, float(lod)).xy * uHeightScale;

		vec3 n = iro - vec3(pos.x, (h.x + h.y) * 0.5, pos.y) * ird;
		vec3 k = ard * vec3(s, h.y - h.x, s) * 0.5;

		vec3 t0 = -n - k;
		vec3 t1 = -n + k;

		float tN = max(max(t0.x, t0.y), t0.z);
		float tF = min(min(t1.x, t1.y), t1.z);

		if (tF >= 0.0 && tN < tF)
		{
			if (lod == uMinLod)
			{
				vec2 nid = floor(pos * res);
				if (uIsVoxels)
				{
					if (tN > tMax)
					{
						break;
					}

					if (!(nid == id.xy && id.z > 0.0))
					{
						hit.isHit = true;
						if (tN < 0.0)
						{
							hit.normal = boxNormal;
						} else
						{
							hit.normal = -srd * step(vec3(tN), t0);
						}
						hit.id = vec3(floor(pos * res), 1);
						hit.t = tN + bt;
						break;
					}
				} else
				{
					vec2 p00 = pos + vec2(-0.5, -0.5) * s;
					vec2 p10 = pos + vec2( 0.5, -0.5) * s;
					vec2 p01 = pos + vec2(-0.5,  0.5) * s;
					vec2 p11 = pos + vec2( 0.5,  0.5) * s;

					float h00, h10, h01, h11;

					h00 = textureLod(uTexture, p00 * uTextureScale, float(lod)).y * uHeightScale;
					h10 = textureLod(uTexture, p10 * uTextureScale, float(lod)).y * uHeightScale;
					h01 = textureLod(uTexture, p01 * uTextureScale, float(lod)).y * uHeightScale;
					h11 = textureLod(uTexture, p11 * uTextureScale, float(lod)).y * uHeightScale;
				
					vec3 v00 = vec3(p00.x, h00, p00.y);
					vec3 v10 = vec3(p10.x, h10, p10.y);
					vec3 v01 = vec3(p01.x, h01, p01.y);
					vec3 v11 = vec3(p11.x, h11, p11.y);

					vec3 n0, n1;
					vec3 tri0 = triIntersect(ro, rd, v00, v01, v10, n0);
					vec3 tri1 = triIntersect(ro, rd, v10, v01, v11, n1);

					vec3 v0, v1, v2;
					vec3 n;
					float t = MAX_DIST;

					if (!(nid == id.xy && id.z == 0.0))
						if (tri0.x < tri1.x)
						{
							t = tri0.x;
							n = n0;
							hit.id.z = 0.0;
							v0 = v00;
							v1 = v01;
							v2 = v10;
						}
					if (!(nid == id.xy && id.z == 1.0))
						if (tri1.x < t) {
							t = tri1.x;
							n = n1;
							hit.id.z = 1.0;
							v0 = v10;
							v1 = v01;
							v2 = v11;
						}

					if (t > 0.0 && t < tMax)
					{
						hit.isHit = true;
						hit.normal = n;
						hit.t = t + bt;
						hit.id.xy = floor(pos * res);
						break;
					}
				}
			} else
			{
				s *= 0.5;
				res *= 2.0;
				lod--;
				vec2 pHit = ro.xz + rd.xz * tN;
				pos += sign(pHit - pos) * s * 0.5;
				continue;
			}
		}

		float tSide = min(t1.x, t1.z);

		float y = ro.y + rd.y * tSide;

		if (tSide > tMax)
		{
			break;
		}

		if (rd.y < 0.0 && y < 0.0)
		{
			break;
		}

		if (rd.y > 0.0 && y > maxHeight * uHeightScale)
		{
			break;
		}

		vec2 ns = t1.x <= t1.z ? vec2(srd.x, 0) : vec2(0, srd.z);
		ppos = pos;
		pos += ns * s;

		vec2 ip = (pos * res);
		vec2 ipp = (ppos * res);

		if (floor(ip*0.5) != floor(ipp*0.5) && lod < uLodLevels)
		{
			s *= 2.0;
			res *= 0.5;
			lod++;
			pos = (floor(ip*0.5) + 0.5) * s;
			ppos = pos;
		}
	}
	return hit;
}

vec3 getSky(vec3 rd)
{
	float u = atan(rd.z, rd.x) / TAU + 0.5;
	float v = asin(rd.y) / PI + 0.5;

	return texture(uEnvTexture, vec2(u, v)).rgb * uEnvmapStrength;
}

vec3 offsetRay(vec3 p, vec3 n) {
	float s = exp2(float(uLodLevels - uMinLod));
	return uIsVoxels ? p + n * min(0.1 / s, 1e-4) : p;
}

void main() {
	initState(gl_FragCoord.xy, uFrame);

	vec2 o = hash2(state);
	vec2 pv = (2.0 * (gl_FragCoord.xy + o) - uResolution) / uResolution.y;

	vec3 ro = uCameraPosition;
	vec3 lo = uCameraPivotPosition;

	mat3 cmat = getCameraMatrix(ro, lo);

	vec3 rd = normalize(cmat * vec3(pv, uInvTanFov));

	vec3 color = vec3(0);
	vec3 throughput = vec3(1);

	vec2 boxMinmax = texelFetch(uMipmapTexture, ivec2(0), uLodLevels).xy;
	maxHeight = boxMinmax.y - boxMinmax.x;

	bool hasDiffuseTexture = textureSize(uDiffuseTexture, 0).x > 0;

	HitInfo hit = trace(ro, rd, MAX_DIST, vec3(0,0,-1));

	if (hit.isHit)
	{
		if (uShowIterations)
		{
			color = palette(float(hit.i) / float(uMaxSteps));
		} else if (uShowNormals)
		{
			color = hit.normal;

			if (!uIsVoxels && uSmoothShading)
			{
				vec3 p = ro + rd * hit.t;
				vec3 shadingNormal = textureLod(uNormalsTexture, (p.xz + uTextureOffset) * uTextureScale, float(uMinLod)).xyz;
				shadingNormal.xy *= -uHeightScale;
				shadingNormal = normalize(shadingNormal.xzy);

				color = vec3(dot(shadingNormal, rd) > 0.0 ? -shadingNormal : shadingNormal);
			}
		} else
		{
			vec3 lightDir = getBasis(uSunDirection) * randomUnitInCone(uSunAngle);
			vec3 lightColor = uSunColor * uSunStrength;

			vec3 p = ro;

			for (int i = 0; i < uMaxBounces; i++)
			{
				vec3 normal = hit.normal;
				vec3 shadingNormal = normal;
				vec3 pNext = p + rd * hit.t;

				if (!uIsVoxels && uSmoothShading)
				{
					shadingNormal = textureLod(uNormalsTexture, (pNext.xz + uTextureOffset) * uTextureScale, float(uMinLod)).xyz;
					shadingNormal.xy *= -uHeightScale;
					shadingNormal = normalize(shadingNormal.xzy);
					if (dot(normal, shadingNormal) < 0.0)
					{
						shadingNormal = -shadingNormal;
					}
					if (dot(rd, shadingNormal) > 0.0)
					{
						shadingNormal = normal;
					}
				}

				float cosTheta = max(dot(-rd, shadingNormal), 0.0);
				float r0 = 0.08;
				float fresnel = r0 + (1.0 - r0) * pow(1.0 - cosTheta, 5.0);

				vec3 rdNext = hash(state) < fresnel ? reflect(rd, shadingNormal) : randomCosineHemisphere(shadingNormal);
				// vec3 rdNext = randomCosineHemisphere(shadingNormal);

				HitInfo hitNext = trace(offsetRay(pNext, normal), rdNext, MAX_DIST, hit.id);

				vec3 albedo = uTextureColor;

				if (uDebugColor)
				{
					float r = hash13(hit.id);
					albedo = palette2(r);
				} else if (hasDiffuseTexture && !uFlatColor)
				{
					vec2 puv = uIsVoxels ? hit.id.xy / (uTextureScale * exp2(float(uLodLevels - uMinLod))) - uTextureOffset : pNext.xz;
					albedo = sRGBToLinear(textureLod(uDiffuseTexture, (puv + uTextureOffset) * uTextureScale, 0.0).rgb);
					albedo *= uTextureColor;
				}

				throughput *= albedo;

				float cosThetaL = dot(normal, lightDir);
				if (cosThetaL > 0.0)
				{
					HitInfo hitL = trace(offsetRay(pNext, normal), lightDir, MAX_DIST, hit.id);

					float dif = max(dot(shadingNormal, lightDir), 0.0) * float(!hitL.isHit);

					color += dif * lightColor * throughput;
				}

				if (!hitNext.isHit)
				{
					color += getSky(rdNext) * throughput;
					break;
				}

				hit = hitNext;
				rd = rdNext;
				p = pNext;
			}
		}
	} else
	{
		color = getSky(rd);
	}

	vec4 prevColor = texture(uPrevTexture, uUv);

	float blend = uResetAccumulation ? 1.0 : 1.0 / (1.0 + 1.0 / prevColor.a);

	color = max(color, vec3(0));
	color = mix(prevColor.rgb, color, blend);

	fragColor = vec4(color, blend);
}
`;

const fsBuildMipmapText = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform sampler2D uTexture;
uniform int uLod;

in vec2 uUv;

out vec4 fragColor;

void main() {

	vec2 ires2 = 1.0 / (2.0 * uResolution);

	if (uLod == 0)
		ires2 *= 2.0;

	vec2 uv00 = uUv + vec2(-0.5, -0.5) * ires2;
	vec2 uv10 = uUv + vec2( 0.5, -0.5) * ires2;
	vec2 uv01 = uUv + vec2(-0.5,  0.5) * ires2;
	vec2 uv11 = uUv + vec2( 0.5,  0.5) * ires2;

	vec2 tex00 = texture(uTexture, uv00).xy;
	vec2 tex10 = texture(uTexture, uv10).xy;
	vec2 tex01 = texture(uTexture, uv01).xy;
	vec2 tex11 = texture(uTexture, uv11).xy;

	float minH = min(min(tex00.x, tex10.x), min(tex01.x, tex11.x));
	float maxH = max(max(tex00.y, tex10.y), max(tex01.y, tex11.y));

	if (uLod == 0 || abs(minH - maxH) < 1e-2)
	{
		float padding = 1e-2;
		minH = max(minH - padding, 0.0);
		maxH = min(maxH + padding, 1.0);
	}

	fragColor = vec4(minH, maxH, 0, 1);
}
`;

const fsBuildNormalsText = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform sampler2D uTexture;

in vec2 uUv;

out vec4 fragColor;

void main() {

	vec2 of = 0.5 / uResolution;
	float h00 = textureLod(uTexture, uUv + vec2(-of.x, -of.y), 0.0).x;
	float h10 = textureLod(uTexture, uUv + vec2( of.x, -of.y), 0.0).x;
	float h01 = textureLod(uTexture, uUv + vec2(-of.x,  of.y), 0.0).x;
	float h11 = textureLod(uTexture, uUv + vec2( of.x,  of.y), 0.0).x;

	vec3 n0 = normalize(vec3(vec2(h10 - h00, h01 - h00) / of, 1));
	vec3 n1 = normalize(vec3(vec2(h11 - h01, h11 - h10) / of, 1));

	fragColor = vec4(normalize(n0 + n1), 1);
}
`;

const fsBlitText = `#version 300 es
precision highp float;

uniform sampler2D uTexture;

in vec2 uUv;

out vec4 fragColor;

// ACES tone mapping curve fit to go from HDR to LDR
//https://knarkowicz.wordpress.com/2016/01/06/aces-filmic-tone-mapping-curve/
vec3 ACESFilm(vec3 x)
{
	float a = 2.51f;
	float b = 0.03f;
	float c = 2.43f;
	float d = 0.59f;
	float e = 0.14f;
	return clamp((x*(a*x + b)) / (x*(c*x + d) + e), 0.0f, 1.0f);
}

float luminance(vec3 col) { return dot(col, vec3(0.2126729, 0.7151522, 0.0721750)); }

vec3 ReinhardExtLuma(vec3 col, const float w)
{
	float l = luminance(col);
	float n = l * (1.0 + l / (w * w));
	float ln = n / (1.0 + l);
	return col * ln / l;
}

vec3 sRGBToLinear(vec3 col)
{
	return mix(pow((col + 0.055) / 1.055, vec3(2.4)), col / 12.92, lessThan(col, vec3(0.04045)));
}

vec3 linearTosRGB(vec3 col)
{
	return mix(1.055 * pow(col, vec3(1.0 / 2.4)) - 0.055, col * 12.92, lessThan(col, vec3(0.0031308)));
}

void main() {
	vec3 color = texture(uTexture, uUv).rgb;

	color = max(color, vec3(0));

	color = ReinhardExtLuma(color, 50.0);

	fragColor = vec4(linearTosRGB(color), 1);
}
`;