export interface AndroidPackageMetadata {
  packageName?: string;
  versionName?: string;
  versionCode?: string;
}

const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const NO_STRING = 0xffffffff;

function assertRange(bytes: Uint8Array, start: number, length: number): void {
  if (start < 0 || length < 0 || start + length > bytes.length) {
    throw new Error("The Android package archive is incomplete.");
  }
}

function u16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function u32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function readLength8(bytes: Uint8Array, offset: number): [number, number] {
  const first = bytes[offset];
  if (first === undefined) throw new Error("Invalid Android manifest string.");
  if ((first & 0x80) === 0) return [first, offset + 1];
  const second = bytes[offset + 1];
  if (second === undefined) throw new Error("Invalid Android manifest string.");
  return [((first & 0x7f) << 8) | second, offset + 2];
}

function readLength16(view: DataView, offset: number): [number, number] {
  const first = u16(view, offset);
  if ((first & 0x8000) === 0) return [first, offset + 2];
  return [((first & 0x7fff) << 16) | u16(view, offset + 2), offset + 4];
}

function parseStringPool(bytes: Uint8Array, view: DataView, start: number, size: number, headerSize: number): string[] {
  assertRange(bytes, start, size);
  if (headerSize < 28) throw new Error("Invalid Android manifest string pool.");

  const stringCount = u32(view, start + 8);
  const flags = u32(view, start + 16);
  const stringsStart = u32(view, start + 20);
  if (stringCount > 100_000) throw new Error("Android manifest has too many strings.");

  const utf8 = (flags & 0x100) !== 0;
  const strings: string[] = [];
  for (let i = 0; i < stringCount; i++) {
    const stringOffset = u32(view, start + headerSize + i * 4);
    let cursor = start + stringsStart + stringOffset;
    if (utf8) {
      const [, afterCharacters] = readLength8(bytes, cursor);
      const [byteLength, dataStart] = readLength8(bytes, afterCharacters);
      assertRange(bytes, dataStart, byteLength);
      cursor = dataStart;
      strings.push(new TextDecoder("utf-8").decode(bytes.subarray(cursor, cursor + byteLength)));
    } else {
      const [characterLength, dataStart] = readLength16(view, cursor);
      const byteLength = characterLength * 2;
      assertRange(bytes, dataStart, byteLength);
      strings.push(new TextDecoder("utf-16le").decode(bytes.subarray(dataStart, dataStart + byteLength)));
    }
  }
  return strings;
}

function parseBinaryManifest(bytes: Uint8Array): AndroidPackageMetadata {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assertRange(bytes, 0, 8);
  if (u16(view, 0) !== 0x0003) throw new Error("The Android manifest is not binary XML.");

  const totalSize = u32(view, 4);
  assertRange(bytes, 0, totalSize);
  let strings: string[] = [];
  for (let offset = u16(view, 2); offset + 8 <= totalSize;) {
    const type = u16(view, offset);
    const headerSize = u16(view, offset + 2);
    const chunkSize = u32(view, offset + 4);
    if (chunkSize < 8 || offset + chunkSize > totalSize) throw new Error("Invalid Android manifest chunk.");

    if (type === 0x0001) {
      strings = parseStringPool(bytes, view, offset, chunkSize, headerSize);
    } else if (type === 0x0102 && strings.length > 0) {
      const nameIndex = u32(view, offset + 20);
      if (strings[nameIndex] === "manifest") {
        const attributeStart = u16(view, offset + 24);
        const attributeSize = u16(view, offset + 26);
        const attributeCount = u16(view, offset + 28);
        if (attributeSize < 20) throw new Error("Invalid Android manifest attributes.");
        const attrsOffset = offset + 16 + attributeStart;
        const metadata: AndroidPackageMetadata = {};
        for (let i = 0; i < attributeCount; i++) {
          const attr = attrsOffset + i * attributeSize;
          assertRange(bytes, attr, 20);
          const attrName = strings[u32(view, attr + 4)];
          const rawValueIndex = u32(view, attr + 8);
          const valueType = bytes[attr + 15];
          const valueData = u32(view, attr + 16);
          const rawValue = rawValueIndex === NO_STRING ? undefined : strings[rawValueIndex];
          const value = rawValue ?? (valueType === 0x03 ? strings[valueData] : undefined);

          if (attrName === "package" && value) metadata.packageName = value;
          if (attrName === "versionName" && value) metadata.versionName = value;
          if (attrName === "versionCode") {
            metadata.versionCode = value ?? (valueType === 0x10 || valueType === 0x11 ? String(valueData) : undefined);
          }
        }
        return metadata;
      }
    }
    offset += chunkSize;
  }
  return {};
}

async function extractManifest(file: File): Promise<Uint8Array | null> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minEnd = Math.max(0, bytes.length - 65_557);
  let endOffset = -1;
  for (let offset = bytes.length - 22; offset >= minEnd; offset--) {
    if (u32(view, offset) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error("The selected file is not a readable ZIP archive.");

  const entryCount = u16(view, endOffset + 10);
  const centralSize = u32(view, endOffset + 12);
  const centralOffset = u32(view, endOffset + 16);
  if (entryCount === 0xffff || centralOffset === 0xffffffff) return null;
  assertRange(bytes, centralOffset, centralSize);

  const isBundle = file.name.toLowerCase().endsWith(".aab");
  let cursor = centralOffset;
  for (let i = 0; i < entryCount; i++) {
    assertRange(bytes, cursor, 46);
    if (u32(view, cursor) !== 0x02014b50) throw new Error("Invalid ZIP directory entry.");
    const method = u16(view, cursor + 10);
    const compressedSize = u32(view, cursor + 20);
    const uncompressedSize = u32(view, cursor + 24);
    const nameLength = u16(view, cursor + 28);
    const extraLength = u16(view, cursor + 30);
    const commentLength = u16(view, cursor + 32);
    const localOffset = u32(view, cursor + 42);
    assertRange(bytes, cursor + 46, nameLength + extraLength + commentLength);
    const entryName = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    const isManifest = isBundle
      ? entryName === "base/manifest/AndroidManifest.xml"
      : entryName === "AndroidManifest.xml";

    if (isManifest) {
      if (uncompressedSize > MAX_MANIFEST_BYTES) throw new Error("Android manifest exceeds the supported size.");
      assertRange(bytes, localOffset, 30);
      if (u32(view, localOffset) !== 0x04034b50) throw new Error("Invalid ZIP local file entry.");
      const localNameLength = u16(view, localOffset + 26);
      const localExtraLength = u16(view, localOffset + 28);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      assertRange(bytes, dataOffset, compressedSize);
      const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);
      if (method === 0) return compressed;
      if (method !== 8 || typeof DecompressionStream === "undefined") return null;
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }

    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

export async function readAndroidPackageMetadata(file: File): Promise<AndroidPackageMetadata> {
  const manifest = await extractManifest(file);
  return manifest ? parseBinaryManifest(manifest) : {};
}
