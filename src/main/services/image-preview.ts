import { imageDimensionsFromData } from 'image-dimensions';
import type { ImagePreview } from '../../shared/contracts/file-preview';

export function imagePreview(bytes: Buffer): ImagePreview {
  // 只读有界字节的头部尺寸；真正解码交给 Chromium，不在 Main 展开像素。
  if (bytes.length > 8 * 1024 * 1024) throw new Error('图片最多 8 MiB');
  const dimensions = imageDimensionsFromData(bytes);
  if (!dimensions || !['png', 'jpeg', 'webp', 'gif'].includes(dimensions.type)) throw new Error('图片格式无效或未开放预览；当前支持 PNG、JPEG、WebP、GIF');
  const { width, height, type } = dimensions;
  if (![width, height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 16384) || width * height > 16 * 1024 * 1024) throw new Error('图片尺寸超限：单边最多 16384 像素，总计最多 16 Mi 像素');
  return { mime: `image/${type}` as ImagePreview['mime'], data: bytes.toString('base64'), width, height };
}
