// Reads a picked file into an Attachment: images are scaled down (JPEG, longest side 1536px) so
// they stay small in storage and in requests; text files are read as text.
import type { Attachment } from '../types';
import { uid } from './id';

const MAX_SIDE = 1536;
const MAX_TEXT = 200_000;
const TEXT_EXT = /\.(txt|md|markdown|json|csv|html?|xml|ya?ml|rtf|log)$/i;

export async function readAttachment(file: File): Promise<Attachment> {
  if (file.type.startsWith('image/')) return { id: uid(), kind: 'image', name: file.name, mime: 'image/jpeg', dataUrl: await shrink(file) };
  if (file.type.startsWith('text/') || TEXT_EXT.test(file.name)) {
    const text = await file.text();
    if (text.length > MAX_TEXT) throw new Error(`${file.name} is too long (${Math.round(text.length / 1000)}K characters; the limit is 200K).`);
    return { id: uid(), kind: 'file', name: file.name, mime: file.type || 'text/plain', text };
  }
  throw new Error(`${file.name}: only images and text files (.txt, .md and similar) can be attached.`);
}

async function shrink(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c.toDataURL('image/jpeg', 0.85);
}
