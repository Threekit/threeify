attribute vec3 position;

uniform mat4 localToView;
uniform mat4 viewToScreen;

uniform mat3 viewToImageUv;
uniform mat3 viewToLayerUv;
uniform mat3 viewToMaskUv;

varying vec2 v_image_uv;
varying vec2 v_layer_uv;
varying vec2 v_mask_uv;

void main() {

  vec4 viewPos = localToView * vec4( position, 1. );

  vec3 viewPos2d = vec3( viewPos.xy, 1.0 );

  v_image_uv = ( viewToImageUv * viewPos2d ).xy;
  v_layer_uv = ( viewToLayerUv * viewPos2d ).xy;
  v_mask_uv =  ( viewToMaskUv  * viewPos2d ).xy;

  gl_Position = viewToScreen * viewPos;

}
