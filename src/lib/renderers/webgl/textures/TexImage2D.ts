//
// OpenGL texture representation based on texImage2D function call
// https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/texImage2D
//
// Authors:
// * @bhouston
//

import { IDisposable } from "../../../core/types";
import { isPow2 } from "../../../math/Functions";
import { Vector2 } from "../../../math/Vector2";
import { ArrayBufferImage } from "../../../textures/ArrayBufferImage";
import { TextureSource } from "../../../textures/VirtualTexture";
import { GL } from "../GL";
import { RenderingContext } from "../RenderingContext";
import { DataType } from "./DataType";
import { PixelFormat } from "./PixelFormat";
import { TexParameters } from "./TexParameters";
import { TextureTarget } from "./TextureTarget";

export class TexImage2D implements IDisposable {
  readonly id: number;
  disposed = false;
  glTexture: WebGLTexture;
  size = new Vector2();

  constructor(
    public context: RenderingContext,
    public images: TextureSource[],
    public internalFormat = PixelFormat.RGBA,
    public dataType = DataType.UnsignedByte,
    public pixelFormat = PixelFormat.RGBA,
    public target = TextureTarget.Texture2D,
    public texParameters = new TexParameters(),
  ) {
    const gl = this.context.gl;
    // Create a texture.
    {
      const glTexture = gl.createTexture();
      if (glTexture === null) {
        throw new Error("createTexture failed");
      }
      this.glTexture = glTexture;
    }

    this.loadImages(images);

    gl.texParameteri(this.target, GL.TEXTURE_WRAP_S, texParameters.wrapS);
    gl.texParameteri(this.target, GL.TEXTURE_WRAP_T, texParameters.wrapT);

    gl.texParameteri(this.target, GL.TEXTURE_MAG_FILTER, texParameters.magFilter);
    gl.texParameteri(this.target, GL.TEXTURE_MIN_FILTER, texParameters.minFilter);

    if (texParameters.anisotropyLevels > 1) {
      const tfa = this.context.glxo.EXT_texture_filter_anisotropic;
      if (tfa !== null) {
        // TODO: Cache this at some point for speed improvements
        const maxAllowableAnisotropy = gl.getParameter(tfa.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
        gl.texParameterf(
          this.target,
          tfa.TEXTURE_MAX_ANISOTROPY_EXT,
          Math.min(texParameters.anisotropyLevels, maxAllowableAnisotropy),
        );
      }
    }

    if (texParameters.generateMipmaps) {
      if (isPow2(this.size.width) && isPow2(this.size.height)) {
        gl.generateMipmap(this.target);
      }
    }

    gl.bindTexture(this.target, null);

    this.id = this.context.registerResource(this);
  }

  generateMipmaps(): void {
    const gl = this.context.gl;
    gl.bindTexture(this.target, this.glTexture);
    gl.generateMipmap(this.target);
    gl.bindTexture(this.target, null);
    this.texParameters.generateMipmaps = true;
  }

  get mipCount(): number {
    if (!this.texParameters.generateMipmaps) {
      return 1;
    }
    return Math.floor(Math.log2(Math.max(this.size.width, this.size.height)));
  }

  dispose(): void {
    if (!this.disposed) {
      this.context.gl.deleteTexture(this.glTexture);
      this.context.disposeResource(this);
      this.disposed = true;
    }
  }

  public loadImages(images: TextureSource[]): void {
    const gl = this.context.gl;
    gl.bindTexture(this.target, this.glTexture);
    if (images.length === 1) {
      this.loadImage(images[0]);
    } else if (this.target === TextureTarget.TextureCubeMap) {
      const numLevels = Math.floor(this.images.length / 6);
      for (let level = 0; level < numLevels; level++) {
        for (let face = 0; face < 6; face++) {
          const imageIndex = level * 6 + face;
          const image = images[imageIndex];
          this.loadImage(image, TextureTarget.CubeMapPositiveX + face, level);
        }
      }
    } else {
      throw new Error("Unsupported number of images");
    }
  }

  private loadImage(image: TextureSource, target: TextureTarget | undefined = undefined, level = 0): void {
    const gl = this.context.gl;

    if (image instanceof Vector2) {
      gl.texImage2D(
        target ?? this.target,
        level,
        this.internalFormat,
        image.width,
        image.height,
        0,
        this.pixelFormat,
        this.dataType,
        null,
      );
      if (level === 0) {
        this.size.set(image.width, image.height);
      }
    } else if (image instanceof ArrayBufferImage) {
      gl.texImage2D(
        target ?? this.target,
        level,
        this.internalFormat,
        image.width,
        image.height,
        0,
        this.pixelFormat,
        this.dataType,
        new Uint8Array(image.data),
      );
      if (level === 0) {
        this.size.set(image.width, image.height);
      }
    } else {
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, image instanceof HTMLImageElement); // This doesn't seem to have an effect on ImageBitmaps regardless of what you set it to.
      // The firefox warning about this being deprecated is misleading, this functionality will always remain supported. This was confirmed by their WebGL lead: https://bugzilla.mozilla.org/show_bug.cgi?id=1400077
      gl.texImage2D(target ?? this.target, level, this.internalFormat, this.pixelFormat, this.dataType, image);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); // default
      this.size.set(image.width, image.height);
    }
  }
}

/*
export class TexImage2DPool extends Pool<Texture, TexImage2D> {
  constructor(context: RenderingContext) {
    super(context, (context: RenderingContext, texture: Texture, texImage2D: TexImage2D | undefined) => {
      if (texImage2D === undefined) {
        texImage2D = makeTexImage2DFromTexture(context, texture);
      }
      // TODO: Create a new image here.
      // texImage2D.update(texture);
      return texImage2D;
    });
  }
}
*/
