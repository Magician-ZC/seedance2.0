/**
 * 纯 JS 实现的 ZIP 打包工具（Store 模式，不压缩）
 * 适用于纯文本文件的打包下载，无需第三方依赖
 */

interface ZipEntry {
  name: string;
  content: Uint8Array;
}

function strToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function writeU16(arr: Uint8Array, offset: number, val: number) {
  arr[offset] = val & 0xff;
  arr[offset + 1] = (val >> 8) & 0xff;
}

function writeU32(arr: Uint8Array, offset: number, val: number) {
  arr[offset] = val & 0xff;
  arr[offset + 1] = (val >> 8) & 0xff;
  arr[offset + 2] = (val >> 16) & 0xff;
  arr[offset + 3] = (val >> 24) & 0xff;
}

const crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = crc32Table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * 将多个文本文件打包为 ZIP Blob
 * @param files - { name: 文件名, text: 文件内容 } 数组
 * @returns ZIP 格式的 Blob
 */
export function createZipBlob(files: Array<{ name: string; text: string }>): Blob {
  const entries: ZipEntry[] = files.map(f => ({
    name: f.name,
    content: strToBytes(f.text),
  }));

  // 计算总大小
  const localHeaders: Uint8Array[] = [];
  const centralHeaders: Uint8Array[] = [];
  const offsets: number[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const nameBytes = strToBytes(entry.name);
    const crc = crc32(entry.content);
    const size = entry.content.length;

    // Local file header (30 bytes + name + content)
    const local = new Uint8Array(30 + nameBytes.length);
    writeU32(local, 0, 0x04034b50);   // signature
    writeU16(local, 4, 20);            // version needed
    writeU16(local, 6, 0x0800);        // flags: UTF-8
    writeU16(local, 8, 0);             // compression: store
    writeU16(local, 10, 0);            // mod time
    writeU16(local, 12, 0);            // mod date
    writeU32(local, 14, crc);
    writeU32(local, 18, size);         // compressed size
    writeU32(local, 22, size);         // uncompressed size
    writeU16(local, 26, nameBytes.length);
    writeU16(local, 28, 0);            // extra field length
    local.set(nameBytes, 30);

    // Central directory header (46 bytes + name)
    const central = new Uint8Array(46 + nameBytes.length);
    writeU32(central, 0, 0x02014b50);  // signature
    writeU16(central, 4, 20);           // version made by
    writeU16(central, 6, 20);           // version needed
    writeU16(central, 8, 0x0800);       // flags: UTF-8
    writeU16(central, 10, 0);           // compression: store
    writeU16(central, 12, 0);           // mod time
    writeU16(central, 14, 0);           // mod date
    writeU32(central, 16, crc);
    writeU32(central, 20, size);        // compressed size
    writeU32(central, 24, size);        // uncompressed size
    writeU16(central, 28, nameBytes.length);
    writeU16(central, 30, 0);           // extra field length
    writeU16(central, 32, 0);           // file comment length
    writeU16(central, 34, 0);           // disk number start
    writeU16(central, 36, 0);           // internal file attributes
    writeU32(central, 38, 0);           // external file attributes
    writeU32(central, 42, localOffset); // relative offset
    central.set(nameBytes, 46);

    offsets.push(localOffset);
    localHeaders.push(local);
    centralHeaders.push(central);
    localOffset += local.length + size;
  }

  // End of central directory (22 bytes)
  const centralDirOffset = localOffset;
  const centralDirSize = centralHeaders.reduce((s, h) => s + h.length, 0);
  const eocd = new Uint8Array(22);
  writeU32(eocd, 0, 0x06054b50);
  writeU16(eocd, 4, 0);
  writeU16(eocd, 6, 0);
  writeU16(eocd, 8, entries.length);
  writeU16(eocd, 10, entries.length);
  writeU32(eocd, 12, centralDirSize);
  writeU32(eocd, 16, centralDirOffset);
  writeU16(eocd, 20, 0);

  // 将 Uint8Array 转为精确的 ArrayBuffer（避免底层 buffer 偏移问题）
  const toAB = (u: Uint8Array): ArrayBuffer =>
    (u.buffer as ArrayBuffer).slice(u.byteOffset, u.byteOffset + u.byteLength);

  // 组装
  const parts: BlobPart[] = [];
  for (let i = 0; i < entries.length; i++) {
    parts.push(toAB(localHeaders[i]));
    parts.push(toAB(entries[i].content));
  }
  for (const ch of centralHeaders) {
    parts.push(toAB(ch));
  }
  parts.push(toAB(eocd));

  return new Blob(parts, { type: 'application/zip' });
}
