precision highp float;

uniform sampler2D layerMap;

uniform float mipmapBias;

varying vec2 v_uv;

void main() {

  vec4 layerColor = texture2D( layerMap, v_uv, mipmapBias );

  vec4 outputColor = layerColor;

  gl_FragColor = outputColor;

}
