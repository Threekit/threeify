//
// based on https://webgl2fundamentals.org/webgl/lessons/webgl-render-to-texture.html
//
// Authors:
// * @bhouston
//

import { PixelFormat, numPixelFormatComponents } from "../../textures/PixelFormat";
import { Color } from "../../math/Color";
import { IDisposable } from "../../model/interfaces";
import { Program } from "./Program";
import { ProgramUniform } from "./ProgramUniform";
import { RenderingContext } from "./RenderingContext";
import { TexImage2D } from "./TexImage2D";
import { VertexArrayObject } from "./VertexArrayObject";
import { sizeOfDataType } from "../../textures/DataType";

const GL = WebGLRenderingContext;

export enum AttachmentPoints {
  Color0 = GL.COLOR_ATTACHMENT0,
  Depth = GL.DEPTH_ATTACHMENT,
  DepthStencil = GL.DEPTH_STENCIL_ATTACHMENT,
  Stencil = GL.STENCIL_ATTACHMENT,
}

export enum AttachmentFlags {
  Color = GL.COLOR_BUFFER_BIT,
  Depth = GL.DEPTH_BUFFER_BIT,
  Stencil = GL.STENCIL_BUFFER_BIT,
}

export class FramebufferAttachment {
  constructor(public attachmentPoint: number, public texImage2D: TexImage2D) {}
}

export class Framebuffer implements IDisposable {
  disposed = false;
  context: RenderingContext;
  attachments: Array<FramebufferAttachment>;
  glFramebuffer: WebGLFramebuffer;

  constructor(context: RenderingContext, attachments: Array<FramebufferAttachment>) {
    this.context = context;
    this.attachments = attachments;

    const gl = this.context.gl;
    {
      const glFramebuffer = gl.createFramebuffer();
      if (!glFramebuffer) {
        throw new Error("createFramebuffer failed");
      }

      this.glFramebuffer = glFramebuffer;
    }

    attachments.forEach((attachment) => {
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        attachment.attachmentPoint,
        gl.TEXTURE_2D,
        attachment.texImage2D,
        0,
      );
    });
  }

  dispose(): void {
    if (!this.disposed) {
      const gl = this.context.gl;
      gl.deleteFramebuffer(this.glFramebuffer);
      this.disposed = true;
    }
  }

  clear(
    color: Color,
    alpha: number,
    attachmentFlags: AttachmentFlags = AttachmentFlags.Color | AttachmentFlags.Depth,
  ): void {
    const gl = this.context.gl;

    // render to our targetTexture by binding the framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.glFramebuffer);

    gl.clearColor(color.r, color.g, color.b, alpha); // clear to blue
    gl.clear(attachmentFlags);
  }

  render(program: Program, vao: VertexArrayObject, uniforms: Array<ProgramUniform>) {
    throw new Error("not implemented");
  }

  readPixels(pixelBuffer: ArrayBufferView): ArrayBufferView {
    const attachment = this.attachments.find(
      (attachment) => attachment.attachmentPoint == AttachmentPoints.Color0,
    );
    if (!attachment) {
      throw new Error("can not find Color0 attachment");
    }

    const texImage2D = attachment.texImage2D;
    const dataType = texImage2D.dataType;
    const pixelFormat = texImage2D.pixelFormat;
    if (pixelFormat !== PixelFormat.RGBA) {
      throw new Error(`can not read non-RGBA color0 attachment: ${pixelFormat}`);
    }

    const oldFramebuffer = this.context.framebuffer;
    this.context.framebuffer = this;
    try {
      const status = this.context.gl.checkFramebufferStatus(GL.FRAMEBUFFER);
      if (status !== GL.FRAMEBUFFER_COMPLETE) {
        throw new Error(`can not read non-complete Framebuffer: ${status}`);
      }

      const pixelByteLength =
        sizeOfDataType(dataType) *
        numPixelFormatComponents(pixelFormat) *
        texImage2D.size.width *
        texImage2D.size.height;
      if (pixelBuffer.byteLength < pixelByteLength) {
        throw new Error(`pixelBuffer too small: ${pixelBuffer.byteLength} < ${pixelByteLength}`);
      }

      this.context.gl.readPixels(
        0,
        0,
        texImage2D.size.width,
        texImage2D.size.height,
        pixelFormat,
        dataType,
        pixelBuffer,
      );

      return pixelBuffer;
    } finally {
      this.context.framebuffer = oldFramebuffer;
    }
  }
}
