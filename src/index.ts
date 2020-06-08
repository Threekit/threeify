import { BlendState } from "./renderers/webgl2/BlendState";
import { ClearState } from "./renderers/webgl2/ClearState";
import { Color } from "./math/Color";
import { DepthTestState } from "./renderers/webgl2/DepthTestState";
import { MaskState } from "./renderers/webgl2/MaskState";
import { Mesh } from "./nodes/Mesh";
import { Node } from "./nodes/Node";
import { PerspectiveCamera } from "./nodes/cameras/PerspectiveCamera";
import { PointLight } from "./nodes/lights/PointLight";
import { Program } from "./renderers/webgl2/Program";
import { RenderingContext } from "./renderers/webgl2/RenderingContext";
import { ShaderCodeMaterial } from "./materials/ShaderCodeMaterial";
import { TexImage2D } from "./renderers/webgl2/TexImage2D";
import { Texture } from "./textures/Texture";
import { VertexArrayObject } from "./renderers/webgl2/VertexArrayObject";
import { VertexAttributeGeometry } from "./renderers/webgl2/VertexAttributeGeometry";
import { boxGeometry } from "./geometry/BoxGeometry";
import { fetchImage } from "./io/loaders/Image";
import debug_fragment from "./renderers/webgl2/shaders/materials/debug/fragment.glsl";
import debug_vertex from "./renderers/webgl2/shaders/materials/debug/vertex.glsl";

async function test(): Promise<void> {
  // setup webgl2
  const canvasElement = document.querySelector("#rendering-canvas") as HTMLCanvasElement;
  const context = new RenderingContext(canvasElement);

  //
  // create scene graph
  //

  const rootNode = new Node();

  const light = new PointLight();
  rootNode.children.add(light);

  const mesh = new Mesh(boxGeometry(1, 1, 1, 1, 1, 1));
  rootNode.children.add(mesh);

  const camera = new PerspectiveCamera(60, 1, 10);
  camera.position.x -= 5;
  rootNode.children.add(camera);

  const texture = new Texture(await fetchImage("./exocortex-logo.jpg"));
  console.log(texture);

  const texImage2D = new TexImage2D(context, texture.image);
  console.log(texImage2D);

  const boxVertexAttributeGeometry = VertexAttributeGeometry.FromGeometry(context, mesh.geometry);
  console.log(boxVertexAttributeGeometry);

  // source code definition of material
  const shaderCodeMaterial = new ShaderCodeMaterial(debug_vertex, debug_fragment);
  console.log(shaderCodeMaterial);
  const program = new Program(context, shaderCodeMaterial);
  console.log(program);

  // using uniform set structures
  const materialUniforms = {
    albedo: new Color(1, 0.5, 0.5),
    albedoUvIndex: 0,
    albedoMap: texImage2D,
  };
  console.log(materialUniforms);
  const sceneUniforms = {
    localToWorldTransform: mesh.localToParentTransform,
    worldToViewTransform: camera.parentToLocalTransform,
    viewToScreenProjection: camera.getProjection(canvasElement.width / canvasElement.height),
  };
  console.log(sceneUniforms);
  program.setUniformValues(materialUniforms);
  program.setUniformValues(sceneUniforms);

  // bind to program
  const vertexArrayObject = new VertexArrayObject(program, boxVertexAttributeGeometry);
  console.log(vertexArrayObject);

  // test if states work
  context.blendState = new BlendState();
  context.clearState = new ClearState();
  context.depthTestState = new DepthTestState();
  context.maskState = new MaskState();
}

test();

console.log( debug_vertex);
console.log( debug_fragment);
