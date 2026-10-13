// Morceaux GLSL partagés par la passe de composition (scène), les matières et la couche des signaux : une seule
// définition de la courbe de tons, de l'étalonnage, du vignettage, du brouillard et des tests de profondeur.

export const MAX_FOG_LIGHTS = 12

// Alpha de la scène sur les pixels d'un mort (E8 ; SCENE_TAG, post.ts). Les morts sont dans la scène éclairée ; cet
// alpha dit à la composition de leur garder un grain immobile (B2.O5 : aucun mouvement sur un cadavre) et aux
// télégraphes de passer par-dessus eux (§30.13). 1/16, exact en demi-flottant.
export const MORT_TAG = 0.0625

// Courbe ACES ajustée (Narkowicz/Hill, celle de three) : linéaire scène → linéaire affichage [0, 1].
export const TONEMAP_GLSL = /* glsl */ `
vec3 e1RRTAndODTFit( vec3 v ) {
  vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
  vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
  return a / b;
}
vec3 e1Aces( vec3 color ) {
  const mat3 ACESInputMat = mat3(
    vec3( 0.59719, 0.07600, 0.02840 ),
    vec3( 0.35458, 0.90834, 0.13383 ),
    vec3( 0.04823, 0.01566, 0.83777 )
  );
  const mat3 ACESOutputMat = mat3(
    vec3(  1.60475, -0.10208, -0.00327 ),
    vec3( -0.53108,  1.10813, -0.07276 ),
    vec3( -0.07367, -0.00605,  1.07602 )
  );
  color = ACESInputMat * color;
  color = e1RRTAndODTFit( color );
  color = ACESOutputMat * color;
  return clamp( color, 0.0, 1.0 );
}
vec3 e1LinearToSrgb( vec3 c ) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow( max( c, vec3( 0.0 ) ), vec3( 1.0 / 2.4 ) ) - 0.055;
  return mix( hi, lo, vec3( lessThanEqual( c, vec3( 0.0031308 ) ) ) );
}
`

// Étalonnage : désaturation partielle, ombres tirées vers le froid, lumières vers la chaleur des flammes, contraste.
// neutral = 1 : seulement la courbe de luminance (un gris reste un gris).
// model (0 à 1, E3) : part du pixel qui appartient à un personnage vivant de la Forge (masque de la scène, post.ts).
// Le décor garde l'étalonnage froid et désaturé ; un personnage garde la couleur de sa matière : ni désaturation des
// tons ternes, ni teinte froide des ombres (uModelSaturation, uModelTint), le contraste et le vignettage restent.
export const GRADE_GLSL = /* glsl */ `
uniform float uSaturation;
uniform float uContrast;
uniform vec3 uShadowTint;
uniform vec3 uHighlightTint;
uniform float uTintAmount;
uniform float uVignette;
uniform float uModelSaturation;
uniform float uModelTint;
vec3 e1GradeMix( vec3 c, float neutral, float model ) {
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  // Selective desaturation: dull tones (mud, earth, stone) lose their colour, saturated tones (living flesh,
  // flames, blood) keep it; reading the bodies (B2.O1) comes before the grade.
  float mx = max( c.r, max( c.g, c.b ) );
  float sat = ( mx - min( c.r, min( c.g, c.b ) ) ) / max( mx, 1e-4 );
  float keep = smoothstep( 0.3, 0.65, sat );
  float dull = mix( uSaturation, uModelSaturation, model );
  vec3 g = mix( vec3( l ), c, mix( mix( dull, 1.0, keep ), 1.0, neutral ) );
  float lc = clamp( 0.18 * pow( max( l, 0.0 ) / 0.18, uContrast ), 0.0, 1.0 );
  g *= ( l > 1e-5 ) ? lc / l : 1.0;
  float w = smoothstep( 0.0, 0.5, l );
  vec3 tint = mix( uShadowTint, uHighlightTint, w );
  g = mix( g, g * tint, mix( uTintAmount, uModelTint, model ) * ( 1.0 - neutral ) );
  return clamp( g, 0.0, 1.0 );
}
vec3 e1Grade( vec3 c, float neutral ) {
  return e1GradeMix( c, neutral, 0.0 );
}
float e1VignetteAt( vec2 uv, vec2 res ) {
  vec2 d = ( uv - 0.5 ) * vec2( res.x / res.y, 1.0 );
  return 1.0 - uVignette * smoothstep( 0.45, 1.15, length( d ) );
}
`

// Brouillard bas : densité σ(y) = σ0 · exp(−k · max(y, 0)), plus dense au fond de la fosse. Transmittance exacte le
// long du rayon ; diffusion de la lumière ambiante (lune) et des lumières ponctuelles par l'intégrale analytique de
// 1/d² le long du rayon (halo autour de chaque flamme), sans marche de rayon.
export const FOG_GLSL = /* glsl */ `
uniform float uFogDensity;
uniform float uFogFalloff;
uniform vec3 uFogAmbient;
uniform float uFogScatter;
float e1FogDepth( vec3 c, vec3 p ) {
  float len = length( p - c );
  float k = uFogFalloff;
  float ya = max( c.y, 0.0 );
  float yb = max( p.y, 0.0 );
  float dyy = ya - yb;
  float avg = abs( k * dyy ) < 1e-3 ? exp( - k * ya ) : ( exp( - k * yb ) - exp( - k * ya ) ) / ( k * dyy );
  return max( uFogDensity * len * avg, 0.0 );
}
// Light scattered by a point source of intensity I (colour x candela) along [c, p].
vec3 e1Airlight( vec3 c, vec3 p, vec3 lp, vec3 I, float range ) {
  vec3 rd = p - c;
  float D = length( rd );
  rd /= max( D, 1e-4 );
  vec3 cl = lp - c;
  float t0 = dot( cl, rd );
  float h = max( sqrt( max( dot( cl, cl ) - t0 * t0, 0.0 ) ), 0.25 );
  float integral = ( atan( ( D - t0 ) / h ) + atan( t0 / h ) ) / h;
  float win = range > 0.0 ? pow( clamp( 1.0 - pow( h / range, 4.0 ), 0.0, 1.0 ), 2.0 ) : 1.0;
  float sigma = uFogDensity * exp( - uFogFalloff * max( lp.y * 0.5, 0.0 ) );
  return I * sigma * integral * win * 0.0795775; // 1 / (4 pi): isotropic scattering
}
`

// Test de profondeur manuel de la couche des signaux contre la profondeur de la scène (même caméra) : un fragment
// de signal ne passe que s'il n'est pas derrière la surface de la scène à ce pixel. Trois variantes, partagées par
// la passe couleur et la passe d'identification (B2 I1 : même test, même tolérance) :
// - e1DepthTest : signaux du jalon 1, sol (halo de prière, sceau ; 2 cm + 0,1 % de la distance) ;
// - e2RimDepthTest : liseré des modèles (E2), sans tolérance : la coque n'apparaît que hors du corps. Avec la
//   tolérance du jalon 1 (pensée pour des boîtes convexes), les faces arrière de la coque d'un vêtement mince ou d'un
//   pli passeraient devant la surface du corps et dessineraient des lignes à l'intérieur de la silhouette ;
// - e2MarkDepthTest : marques dorées, collées à leur propre corps (même géométrie) ; 1 cm de tolérance, pas plus,
//   sinon les marques d'un corps à terre transparaîtraient à travers une créature debout qui l'enjambe.
export const DEPTH_TEST_GLSL = /* glsl */ `
uniform sampler2D uSceneDepth;
uniform sampler2D uSceneTag;
uniform vec2 uViewport;
uniform float uCamNear;
uniform float uCamFar;
float e1ViewDist( float d ) {
  float z = d * 2.0 - 1.0;
  return ( 2.0 * uCamNear * uCamFar ) / ( uCamFar + uCamNear - z * ( uCamFar - uCamNear ) );
}
void e1DepthTest() {
  float sd = texture2D( uSceneDepth, gl_FragCoord.xy / uViewport ).x;
  float sceneDist = e1ViewDist( sd );
  float fragDist = e1ViewDist( gl_FragCoord.z );
  if ( fragDist > sceneDist + 0.02 + 0.001 * sceneDist ) discard;
}
void e2RimDepthTest() {
  float sd = texture2D( uSceneDepth, gl_FragCoord.xy / uViewport ).x;
  if ( e1ViewDist( gl_FragCoord.z ) > e1ViewDist( sd ) ) discard;
}
void e2MarkDepthTest() {
  float sd = texture2D( uSceneDepth, gl_FragCoord.xy / uViewport ).x;
  if ( e1ViewDist( gl_FragCoord.z ) > e1ViewDist( sd ) + 0.01 ) discard;
}
`

// Test contre la profondeur de la scène d'un objet de la couche des signaux (aucun : objet de la scène).
export type SceneDepth = 'aucun' | 'signal' | 'liseré' | 'marque'
export const SCENE_DEPTH_CALL: Readonly<Record<SceneDepth, string>> = {
  aucun: '',
  signal: 'e1DepthTest();',
  liseré: 'e2RimDepthTest();',
  marque: 'e2MarkDepthTest();',
}

// Découpe du décor (§20) : un fragment entre la caméra et le joueur, près de l'axe, est écarté selon un tramage
// (fondu). Même fonction dans la passe couleur et dans la passe d'identification.
export const CUT_GLSL = /* glsl */ `
uniform vec3 uCutTarget;
uniform vec3 uCutCam;
uniform float uCutRadius;
void e1Cut( vec3 world ) {
  vec3 axis = uCutTarget - uCutCam;
  float L = length( axis );
  axis /= L;
  vec3 rel = world - uCutCam;
  float s = dot( rel, axis );
  float r = length( rel - axis * s );
  float k = smoothstep( uCutRadius, uCutRadius * 0.55, r ) * smoothstep( L - 0.4, L - 1.6, s );
  vec2 q = floor( gl_FragCoord.xy );
  float bayer = fract( dot( q, vec2( 0.5, 0.25 ) ) + fract( q.y * 0.5 ) * 0.5 );
  if ( k > bayer + 0.02 ) discard;
}
`

// Bruit de valeur 2D (taches de brume, flaques), stable dans le monde.
export const NOISE_GLSL = /* glsl */ `
float e1Hash( vec2 p ) {
  p = fract( p * vec2( 123.34, 456.21 ) );
  p += dot( p, p + 45.32 );
  return fract( p.x * p.y );
}
float e1Noise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( e1Hash( i ), e1Hash( i + vec2( 1.0, 0.0 ) ), u.x ),
              mix( e1Hash( i + vec2( 0.0, 1.0 ) ), e1Hash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
float e1Fbm( vec2 p ) {
  float s = 0.0;
  float a = 0.5;
  for ( int i = 0; i < 4; i ++ ) {
    s += a * e1Noise( p );
    p = p * 2.03 + vec2( 17.1, 9.2 );
    a *= 0.5;
  }
  return s;
}
`

// Garde du rouge vif (E7, §17, §30.10, audit de la clause 10) : le rouge vif ne dit que le danger imminent et le
// sang des 2 dernières secondes. Une lumière chaude (torche, chandelle du Bourreau) sur une chair, un sac aux stades
// 0 à 2 ou du sang séché pousse le produit vers le primaire rouge de l'écran, que la courbe ACES rend tel quel : le
// rouge vif. La garde agit sur la couleur de sortie (linéaire d'affichage, après tons, étalonnage, vignettage et
// grain) : si le pixel tombe à moins de uReservedDE (CIEDE2000) du rouge vif de la palette, sa chroma CIELAB est
// réduite juste assez pour en sortir. La clarté ne bouge pas : la lumière reçue n'est ni retirée ni affaiblie
// (décision du concepteur), seule la teinte cesse de se lire « rouge vif ». Les pixels qui ont le droit au rouge vif
// (sang frais, sac au stade 3) ne passent pas par la garde.
export const GUARD_GLSL = /* glsl */ `
uniform vec3 uReservedLab;
uniform float uReservedDE;
float e7LabF( float t ) { return t > 0.008856452 ? pow( t, 1.0 / 3.0 ) : 7.787037 * t + 0.137931; }
vec3 e7Lab( vec3 c ) {
  float x = 0.4124564 * c.r + 0.3575761 * c.g + 0.1804375 * c.b;
  float y = 0.2126729 * c.r + 0.7151522 * c.g + 0.0721750 * c.b;
  float z = 0.0193339 * c.r + 0.1191920 * c.g + 0.9503041 * c.b;
  float fx = e7LabF( x / 0.95047 );
  float fy = e7LabF( y );
  float fz = e7LabF( z / 1.08883 );
  return vec3( 116.0 * fy - 16.0, 500.0 * ( fx - fy ), 200.0 * ( fy - fz ) );
}
vec3 e7LabToLinear( vec3 lab ) {
  float fy = ( lab.x + 16.0 ) / 116.0;
  float fx = fy + lab.y / 500.0;
  float fz = fy - lab.z / 200.0;
  float x3 = fx * fx * fx;
  float z3 = fz * fz * fz;
  float xr = x3 > 0.008856452 ? x3 : ( 116.0 * fx - 16.0 ) / 903.2963;
  float yr = lab.x > 8.0 ? fy * fy * fy : lab.x / 903.2963;
  float zr = z3 > 0.008856452 ? z3 : ( 116.0 * fz - 16.0 ) / 903.2963;
  vec3 xyz = vec3( xr * 0.95047, yr, zr * 1.08883 );
  return vec3(
    3.2404542 * xyz.x - 1.5371385 * xyz.y - 0.4985314 * xyz.z,
    -0.9692660 * xyz.x + 1.8760108 * xyz.y + 0.0415560 * xyz.z,
    0.0556434 * xyz.x - 0.2040259 * xyz.y + 1.0572252 * xyz.z );
}
float e7Hue( float b, float a ) {
  if ( a == 0.0 && b == 0.0 ) return 0.0;
  float h = atan( b, a );
  return h < 0.0 ? h + 6.2831853 : h;
}
// CIEDE2000 (Sharma 2005), kL = kC = kH = 1, angles en radians.
float e7De00( vec3 p, vec3 q ) {
  float cm = 0.5 * ( length( p.yz ) + length( q.yz ) );
  float cm7 = pow( cm, 7.0 );
  float g = 0.5 * ( 1.0 - sqrt( cm7 / ( cm7 + 6103515625.0 ) ) );
  float a1 = ( 1.0 + g ) * p.y;
  float a2 = ( 1.0 + g ) * q.y;
  float c1 = length( vec2( a1, p.z ) );
  float c2 = length( vec2( a2, q.z ) );
  float h1 = e7Hue( p.z, a1 );
  float h2 = e7Hue( q.z, a2 );
  float dL = q.x - p.x;
  float dC = c2 - c1;
  float dh = 0.0;
  if ( c1 * c2 != 0.0 ) {
    dh = h2 - h1;
    if ( dh > 3.1415927 ) dh -= 6.2831853;
    else if ( dh < -3.1415927 ) dh += 6.2831853;
  }
  float dH = 2.0 * sqrt( c1 * c2 ) * sin( dh * 0.5 );
  float lb = 0.5 * ( p.x + q.x );
  float cb = 0.5 * ( c1 + c2 );
  float hb = h1 + h2;
  if ( c1 * c2 != 0.0 ) {
    if ( abs( h1 - h2 ) <= 3.1415927 ) hb = 0.5 * ( h1 + h2 );
    else hb = h1 + h2 < 6.2831853 ? 0.5 * ( h1 + h2 + 6.2831853 ) : 0.5 * ( h1 + h2 - 6.2831853 );
  }
  float t = 1.0 - 0.17 * cos( hb - 0.5235988 ) + 0.24 * cos( 2.0 * hb ) + 0.32 * cos( 3.0 * hb + 0.1047198 )
    - 0.20 * cos( 4.0 * hb - 1.0995574 );
  float hd = ( hb * 57.2957795 - 275.0 ) / 25.0;
  float dTh = 0.5235988 * exp( - hd * hd );
  float cb7 = pow( cb, 7.0 );
  float rc = 2.0 * sqrt( cb7 / ( cb7 + 6103515625.0 ) );
  float l50 = ( lb - 50.0 ) * ( lb - 50.0 );
  float sl = 1.0 + 0.015 * l50 / sqrt( 20.0 + l50 );
  float sc = 1.0 + 0.045 * cb;
  float sh = 1.0 + 0.015 * cb * t;
  float rt = - sin( 2.0 * dTh ) * rc;
  float x = dL / sl;
  float y = dC / sc;
  float z = dH / sh;
  return sqrt( max( 0.0, x * x + y * y + z * z + rt * y * z ) );
}
// Clarté CIELAB seule, depuis la luminance linéaire (test rapide : un écart de clarté suffit à sortir du rouge vif).
float e7Lightness( vec3 c ) { return 116.0 * e7LabF( dot( c, vec3( 0.2126729, 0.7151522, 0.0721750 ) ) ) - 16.0; }
// Couleur linéaire d'affichage, gardée hors du rouge vif : chroma réduite par dichotomie, clarté inchangée. Un pixel
// dont la clarté est à 1,25 × uReservedDE ou plus de celle du rouge vif (L* 49,3) est sûr sans calcul de plus :
// ΔE00 ≥ ΔL / SL (le terme de rotation est nul loin des bleus) et, à cet écart, SL ≤ 1,07, puis ΔL / SL croît avec ΔL.
vec3 e7Guard( vec3 c ) {
  vec3 lin = clamp( c, 0.0, 1.0 );
  if ( abs( e7Lightness( lin ) - uReservedLab.x ) >= 1.25 * uReservedDE ) return c;
  vec3 lab = e7Lab( lin );
  if ( e7De00( lab, uReservedLab ) >= uReservedDE ) return c;
  float lo = 0.0;
  float hi = 1.0;
  for ( int i = 0; i < 12; i ++ ) {
    float m = 0.5 * ( lo + hi );
    if ( e7De00( vec3( lab.x, lab.yz * m ), uReservedLab ) >= uReservedDE ) lo = m;
    else hi = m;
  }
  return clamp( e7LabToLinear( vec3( lab.x, lab.yz * lo ) ), 0.0, 1.0 );
}
`
