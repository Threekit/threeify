import { IDisposable } from "../../core/types";
import { transformGeometry } from "../../geometry/Geometry.Functions";
import { planeGeometry } from "../../geometry/primitives/planeGeometry";
import { ShaderMaterial } from "../../materials/ShaderMaterial";
import { ceilPow2 } from "../../math/Functions";
import {
  makeMatrix4Orthographic,
  makeMatrix4OrthographicSimple,
  makeMatrix4Scale,
  makeMatrix4Translation,
} from "../../math/Matrix4.Functions";
import { Vector2 } from "../../math/Vector2";
import { Vector3 } from "../../math/Vector3";
import { UniformValueMap } from "../../renderers";
import { BufferGeometry, makeBufferGeometryFromGeometry } from "../../renderers/webgl/buffers/BufferGeometry";
import { ClearState } from "../../renderers/webgl/ClearState";
import { Attachment } from "../../renderers/webgl/framebuffers/Attachment";
import { Framebuffer } from "../../renderers/webgl/framebuffers/Framebuffer";
import { renderBufferGeometry } from "../../renderers/webgl/framebuffers/VirtualFramebuffer";
import { makeProgramFromShaderMaterial, Program } from "../../renderers/webgl/programs/Program";
import { RenderingContext } from "../../renderers/webgl/RenderingContext";
import { DataType } from "../../renderers/webgl/textures/DataType";
import { PixelFormat } from "../../renderers/webgl/textures/PixelFormat";
import { TexImage2D } from "../../renderers/webgl/textures/TexImage2D";
import { makeTexImage2DFromTexture } from "../../renderers/webgl/textures/TexImage2D.Functions";
import { TexParameters } from "../../renderers/webgl/textures/TexParameters";
import { TextureFilter } from "../../renderers/webgl/textures/TextureFilter";
import { TextureTarget } from "../../renderers/webgl/textures/TextureTarget";
import { TextureWrap } from "../../renderers/webgl/textures/TextureWrap";
import { fetchImage, isImageBitmapSupported } from "../../textures/loaders/Image";
import { Texture } from "../../textures/Texture";
import fragmentSource from "./fragment.glsl";
import { copySourceBlendState, Layer, LayerBlendMode, LayerMask } from "./Layer";
import { makeMatrix3FromViewToLayerUv } from "./makeMatrix3FromViewToLayerUv";
import vertexSource from "./vertex.glsl";

function releaseImage(image: ImageBitmap | HTMLImageElement | undefined): void {
  if (isImageBitmapSupported() && image instanceof ImageBitmap) {
    image.close();
  }
  // if HTMLImageElement do nothing, just ensure there are no references to it.
}
export class LayerImage implements IDisposable {
  disposed = false;
  renderId = -1;

  constructor(
    readonly url: string,
    public texImage2D: TexImage2D,
    public image: ImageBitmap | HTMLImageElement | undefined,
  ) {
    // console.log(`layerImage.load: ${this.url}`);
  }

  dispose(): void {
    if (!this.disposed) {
      this.texImage2D.dispose();
      releaseImage(this.image);
      this.image = undefined;
      this.disposed = true;
      // console.log(`layerImage.dispose: ${this.url}`);
    }
  }
}

export type LayerImageMap = { [key: string]: LayerImage | undefined };
export type TexImage2DPromiseMap = { [key: string]: Promise<TexImage2D> | undefined };

export function makeColorMipmapAttachment(
  context: RenderingContext,
  size: Vector2,
  dataType: DataType | undefined = undefined,
  options: {
    wrapS?: TextureWrap;
    wrapT?: TextureWrap;
  } = {},
): TexImage2D {
  const texParams = new TexParameters();
  texParams.generateMipmaps = true;
  texParams.anisotropyLevels = 1;
  texParams.wrapS = options.wrapS ?? TextureWrap.ClampToEdge;
  texParams.wrapT = options.wrapT ?? TextureWrap.ClampToEdge;
  texParams.magFilter = TextureFilter.Linear;
  texParams.minFilter = TextureFilter.LinearMipmapLinear;
  return new TexImage2D(
    context,
    [size],
    PixelFormat.RGBA,
    dataType ?? DataType.UnsignedByte,
    PixelFormat.RGBA,
    TextureTarget.Texture2D,
    texParams,
  );
}

export enum ImageFitMode {
  FitWidth,
  FitHeight,
}

export class LayerCompositor {
  context: RenderingContext;

  layerImageCache: LayerImageMap = {}; // images that are ready to be used
  texImage2DPromiseCache: TexImage2DPromiseMap = {}; // images that are being loaded
  desiredImages = new Set<string>(); // ground truth for whether an image should be discarded vs fetched and loaded
  autoDiscard = false;
  renderId = 0;

  #bufferGeometry: BufferGeometry;
  #program: Program;
  imageSize = new Vector2(0, 0);
  imageFitMode: ImageFitMode = ImageFitMode.FitHeight;
  zoomScale = 1.0; // no zoom
  panPosition: Vector2 = new Vector2(0.5, 0.5); // center
  #layers: Layer[] = [];
  #layerVersion = 0;
  #offlineLayerVersion = -1;
  firstRender = true;
  clearState = new ClearState(new Vector3(1, 1, 1), 0.0);
  offscreenSize = new Vector2(0, 0);
  offscreenWriteFramebuffer: Framebuffer | undefined;
  offscreenWriteColorAttachment: TexImage2D | undefined;
  offscreenReadFramebuffer: Framebuffer | undefined;
  offscreenReadColorAttachment: TexImage2D | undefined;

  constructor(canvas: HTMLCanvasElement) {
    this.context = new RenderingContext(canvas, {
      alpha: true,
      antialias: false,
      depth: false,
      premultipliedAlpha: true,
      stencil: false,
      preserveDrawingBuffer: true,
    });
    this.context.canvasFramebuffer.devicePixelRatio = window.devicePixelRatio;
    this.context.canvasFramebuffer.resize();
    const plane = planeGeometry(1, 1, 1, 1);
    transformGeometry(plane, makeMatrix4Translation(new Vector3(0.5, 0.5, 0.0)));
    this.#bufferGeometry = makeBufferGeometryFromGeometry(this.context, plane);
    this.#program = makeProgramFromShaderMaterial(this.context, new ShaderMaterial(vertexSource, fragmentSource));
  }

  snapshot(mimeFormat = "image/jpeg", quality = 1.0): string {
    const canvas = this.context.canvasFramebuffer.canvas;
    if (canvas instanceof HTMLCanvasElement) {
      return canvas.toDataURL(mimeFormat, quality);
    }
    throw new Error("snapshot not supported");
  }
  set layers(layers: Layer[]) {
    this.#layers = layers;
    this.#layerVersion++;
  }
  updateOffscreen(): void {
    // but to enable mipmaps (for filtering) we need it to be up-rounded to a power of 2 in width/height.
    const offscreenSize = new Vector2(ceilPow2(this.imageSize.x), ceilPow2(this.imageSize.y));
    if (
      this.offscreenWriteFramebuffer === undefined ||
      this.offscreenReadFramebuffer === undefined ||
      !this.offscreenSize.equals(offscreenSize)
    ) {
      this.offscreenSize.copy(offscreenSize);
      // console.log("updating framebuffer");

      // write buffer

      if (this.offscreenWriteFramebuffer !== undefined) {
        this.offscreenWriteFramebuffer.dispose();
        this.offscreenWriteFramebuffer = undefined;
      }
      this.offscreenWriteFramebuffer = new Framebuffer(this.context);

      if (this.offscreenWriteColorAttachment !== undefined) {
        this.offscreenWriteColorAttachment.dispose();
        this.offscreenWriteColorAttachment = undefined;
      }
      this.offscreenWriteColorAttachment = this.makeColorMipmapAttachment();
      this.offscreenWriteFramebuffer.attach(Attachment.Color0, this.offscreenWriteColorAttachment);

      // read buffer

      if (this.offscreenReadFramebuffer !== undefined) {
        this.offscreenReadFramebuffer.dispose();
        this.offscreenReadFramebuffer = undefined;
      }
      this.offscreenReadFramebuffer = new Framebuffer(this.context);

      if (this.offscreenReadColorAttachment !== undefined) {
        this.offscreenReadColorAttachment.dispose();
        this.offscreenReadColorAttachment = undefined;
      }
      this.offscreenReadColorAttachment = this.makeColorMipmapAttachment();
      this.offscreenReadFramebuffer.attach(Attachment.Color0, this.offscreenReadColorAttachment);

      // frame buffer is pixel aligned with layer images.
      // framebuffer view is [ (0,0)-(framebuffer.with, framebuffer.height) ].
    }
  }
  makeColorMipmapAttachment() {
    return makeColorMipmapAttachment(this.context, this.offscreenSize);
  }

  // returns null if discardTexImage2D is called before the image is done loading
  async loadTexImage2D(
    url: string,
    image: HTMLImageElement | ImageBitmap | undefined = undefined,
  ): Promise<TexImage2D | null> {
    this.desiredImages.add(url);

    const existingValue = this.texImage2DPromiseCache[url];
    if (existingValue) return existingValue;

    return await (this.texImage2DPromiseCache[url] =
      this.texImage2DPromiseCache[url] ??
      ((async () => {
        let hadToFetch = false;
        if (image === undefined) {
          image = await fetchImage(url);
          hadToFetch = true;
        }
        if (!this.desiredImages.has(url)) {
          delete this.texImage2DPromiseCache[url];
          // can assume that url has already been deleted from layerImageCache as well
          if (hadToFetch) releaseImage(image);
          return null;
        }
        return (this.layerImageCache[url] = createTexture(this.context, url, image)).texImage2D;
      })() as Promise<TexImage2D>));
  }

  discardTexImage2D(url: string): boolean {
    if (!this.desiredImages.has(url)) return false;
    this.desiredImages.delete(url);

    this.layerImageCache[url]?.dispose();
    delete this.layerImageCache[url];

    delete this.texImage2DPromiseCache[url];

    return true;
  }

  // ask how much memory is used
  // set max size
  // draw() - makes things fit with size of div assuming pixels are square
  render(): void {
    this.renderId++;
    // console.log(`render id: ${this.renderId}`);

    this.renderLayersToFramebuffer();

    const offscreenColorAttachment = this.offscreenWriteColorAttachment;
    if (offscreenColorAttachment === undefined) {
      return;
    }

    const canvasFramebuffer = this.context.canvasFramebuffer;
    const canvasSize = canvasFramebuffer.size;
    const canvasAspectRatio = canvasSize.width / canvasSize.height;

    const imageToCanvasScale =
      this.imageFitMode === ImageFitMode.FitWidth
        ? canvasSize.width / this.imageSize.width
        : canvasSize.height / this.imageSize.height;

    const canvasImageSize = this.imageSize.clone().multiplyByScalar(imageToCanvasScale);
    const canvasImageCenter = canvasImageSize.clone().multiplyByScalar(0.5);

    if (this.zoomScale > 1.0) {
      // convert from canvas space to image space
      const imagePanPosition = this.panPosition
        .clone()
        .multiplyByScalar(1 / imageToCanvasScale)
        .multiplyByScalar(this.context.canvasFramebuffer.devicePixelRatio);
      const imageCanvasSize = canvasSize.clone().multiplyByScalar(1 / imageToCanvasScale);

      // center pan
      const imagePanOffset = imagePanPosition.clone().sub(imageCanvasSize.clone().multiplyByScalar(0.5));
      // clamp to within image.
      imagePanOffset.x = Math.sign(imagePanOffset.x) * Math.min(Math.abs(imagePanOffset.x), this.imageSize.x * 0.5);
      imagePanOffset.y = Math.sign(imagePanOffset.y) * Math.min(Math.abs(imagePanOffset.y), this.imageSize.y * 0.5);

      // convert back to
      const canvasPanOffset = imagePanOffset.clone().multiplyByScalar(imageToCanvasScale);

      // ensure zoom is at point of contact, not center of screen.
      const centeredCanvasPanOffset = canvasPanOffset.clone().multiplyByScalar(1 - 1 / this.zoomScale);

      canvasImageCenter.add(centeredCanvasPanOffset);
    }

    const imageToCanvas = makeMatrix4OrthographicSimple(
      canvasSize.height,
      canvasImageCenter,
      -1,
      1,
      this.zoomScale,
      canvasAspectRatio,
    );
    /* console.log(
      `Canvas Camera: height ( ${canvasSize.height} ), center ( ${scaledImageCenter.x}, ${scaledImageCenter.y} ) `,
    );*/

    const planeToImage = makeMatrix4Scale(new Vector3(canvasImageSize.width, canvasImageSize.height, 1.0));

    const offscreenScaledSize = this.offscreenSize.clone().multiplyByScalar(imageToCanvasScale);
    const viewToLayerUv = makeMatrix3FromViewToLayerUv(offscreenScaledSize, undefined, true);

    canvasFramebuffer.clearState = new ClearState(new Vector3(0, 0, 0), 0.0);
    canvasFramebuffer.clear();

    let uniforms: UniformValueMap;
    uniforms = {
      localToView: planeToImage,
      viewToScreen: imageToCanvas,

      mipmapBias: 0,

      layerMap: offscreenColorAttachment!,
      viewToLayerUv,

      maskMode: 0,
      blendMode: 0,
      opacity: 1,
    };

    //console.log(`drawing layer #${index}: ${layer.url} at ${layer.offset.x}, ${layer.offset.y}`);
    renderBufferGeometry(
      canvasFramebuffer,
      this.#program,
      uniforms,
      this.#bufferGeometry,
      undefined,
      copySourceBlendState,
    );

    if (this.autoDiscard) {
      for (const url in this.layerImageCache) {
        const layerImage = this.layerImageCache[url];
        if (layerImage !== undefined && layerImage.renderId < this.renderId) {
          this.discardTexImage2D(url);
        }
      }
    }
  }

  renderLayersToFramebuffer(): void {
    this.updateOffscreen();

    if (this.#offlineLayerVersion >= this.#layerVersion) {
      return;
    }
    this.#offlineLayerVersion = this.#layerVersion;

    const offscreenWriteFramebuffer = this.offscreenWriteFramebuffer;
    const offscreenReadFramebuffer = this.offscreenReadFramebuffer;
    if (offscreenWriteFramebuffer === undefined || offscreenReadFramebuffer === undefined) {
      return;
    }

    // clear to black and full alpha.
    offscreenWriteFramebuffer.clearState = new ClearState(new Vector3(0, 0, 0), 0.0);
    offscreenWriteFramebuffer.clear();

    offscreenReadFramebuffer.clearState = new ClearState(new Vector3(0, 0, 0), 0.0);
    offscreenReadFramebuffer.clear();

    const imageToOffscreen = makeMatrix4Orthographic(0, this.offscreenSize.width, 0, this.offscreenSize.height, -1, 1);
    /* console.log(
      `Canvas Camera: height ( ${this.offscreenSize.height} ), center ( ${offscreenCenter.x}, ${offscreenCenter.y} ) `,
    );*/

    // const offscreenLocalToView = makeMatrix4Scale(new Vector3(this.offscreenSize.x, this.offscreenSize.y, 1.0));
    const viewToImageUv = makeMatrix3FromViewToLayerUv(this.offscreenSize, undefined, true);

    this.#layers.forEach((layer, idx) => {
      const layerImage = this.layerImageCache[layer.url];
      if (layerImage !== undefined) {
        layerImage.renderId = this.renderId;
      }

      const mask = layer.mask;
      const maskImage = mask && this.layerImageCache[mask.url];
      if (maskImage !== undefined) {
        maskImage.renderId = this.renderId;
      }

      // Can't be accomplished with blendState alone, so we need to copy a section of the writeBuffer to the read buffer
      if (!layer.isTriviallyBlended) {
        const uniforms: UniformValueMap = {
          // Only copies the section the layer needs for compositing
          localToView: layer.planeToImage,
          viewToScreen: imageToOffscreen,

          mipmapBias: 0,

          imageMap: this.offscreenWriteColorAttachment!, // Not used, but avoids framebuffer loop
          viewToImageUv,

          layerMap: this.offscreenWriteColorAttachment!,
          viewToLayerUv: viewToImageUv,

          maskMode: 0,
          blendMode: 0,
          opacity: 1,
        };

        renderBufferGeometry(
          this.offscreenReadFramebuffer!,
          this.#program,
          uniforms,
          this.#bufferGeometry,
          undefined,
          copySourceBlendState,
        );
      }

      // Layering
      {
        let uniforms: UniformValueMap = {
          localToView: layer.planeToImage,
          viewToScreen: imageToOffscreen,

          mipmapBias: 0,

          imageMap: this.offscreenReadColorAttachment!,
          viewToImageUv,

          layerMap: layer.texImage2D,
          viewToLayerUv: layer.viewToLayerUv,

          maskMode: 0,
          blendMode: layer.blendModeUniformValue,
          opacity: layer.opacity,
        };

        if (mask) {
          uniforms = {
            ...uniforms,
            maskMode: mask.mode,
            maskMap: mask.texImage2D,
            maskOpacity: mask.opacity || 0,
            viewToMaskUv: mask.viewToLayerUv,
          };
        }

        // console.log(`drawing layer #${index}: ${layer.url} at ${layer.offset.x}, ${layer.offset.y}`);
        renderBufferGeometry(
          this.offscreenWriteFramebuffer!,
          this.#program,
          uniforms,
          this.#bufferGeometry,
          undefined,
          layer.blendModeBlendState,
        );
      }
    });

    this.offscreenWriteColorAttachment!.generateMipmaps();
  }
}

function createTexture(ctx: RenderingContext, url: string, image: HTMLImageElement | ImageBitmap) {
  const texture = new Texture(image);
  texture.wrapS = TextureWrap.ClampToEdge;
  texture.wrapT = TextureWrap.ClampToEdge;
  texture.minFilter = TextureFilter.Nearest;
  texture.generateMipmaps = false;
  texture.anisotropicLevels = 1;
  texture.name = url;

  const texImage2D = makeTexImage2DFromTexture(ctx, texture);
  return new LayerImage(url, texImage2D, image);
}
