/** Parse width/height from a JPEG buffer by scanning to the SOF marker. Throws if not a JPEG. */
export function jpegSize(buf: Buffer): { width: number; height: number } {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('not a JPEG (bad SOI)');
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1]!;
    const isSOF =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSOF) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    const len = buf.readUInt16BE(i + 2);
    i += 2 + len;
  }
  throw new Error('No SOF marker found');
}

export function isJpeg(buf: Buffer): boolean {
  try {
    jpegSize(buf);
    return true;
  } catch {
    return false;
  }
}
