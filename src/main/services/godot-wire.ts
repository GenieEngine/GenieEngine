/**
 * Minimal implementation of Godot's binary Variant serialization and the
 * remote-debugger TCP framing, ported from core/io/marshalls.cpp and
 * core/debugger/remote_debugger_peer.cpp (Godot 4.7). Only the Variant types
 * that flow over an embedded-game debug session are implemented.
 *
 * Wire format: each packet is a uint32-LE length followed by one encoded
 * Variant, which is always `[String message, int thread_id, Array data]`.
 */

// Variant type ids (core/variant/variant.h).
const T_NIL = 0
const T_BOOL = 1
const T_INT = 2
const T_FLOAT = 3
const T_STRING = 4
const T_VECTOR2 = 5
const T_VECTOR2I = 6
const T_RECT2 = 7
const T_RECT2I = 8
const T_COLOR = 20
const T_STRING_NAME = 21
const T_DICTIONARY = 27
const T_ARRAY = 28
const T_PACKED_BYTE_ARRAY = 29
const T_PACKED_INT32_ARRAY = 30
const T_PACKED_INT64_ARRAY = 31
const T_PACKED_FLOAT32_ARRAY = 32
const T_PACKED_FLOAT64_ARRAY = 33
const T_PACKED_STRING_ARRAY = 34

const HEADER_DATA_FLAG_64 = 1 << 16

/** Marker classes so encode() can distinguish Godot types from JS numbers. */
export class GdVector2i {
  constructor(
    public x: number,
    public y: number
  ) {}
}

export class GdFloat {
  constructor(public value: number) {}
}

export type GdValue =
  | null
  | boolean
  | number // encoded as INT
  | bigint
  | string
  | GdVector2i
  | GdFloat
  | Uint8Array // encoded as PACKED_BYTE_ARRAY
  | GdValue[]
  | Map<GdValue, GdValue>

class Writer {
  private chunks: Buffer[] = []

  u32(value: number): void {
    const b = Buffer.alloc(4)
    b.writeUInt32LE(value >>> 0)
    this.chunks.push(b)
  }

  i32(value: number): void {
    const b = Buffer.alloc(4)
    b.writeInt32LE(value | 0)
    this.chunks.push(b)
  }

  i64(value: bigint): void {
    const b = Buffer.alloc(8)
    b.writeBigInt64LE(value)
    this.chunks.push(b)
  }

  f32(value: number): void {
    const b = Buffer.alloc(4)
    b.writeFloatLE(value)
    this.chunks.push(b)
  }

  f64(value: number): void {
    const b = Buffer.alloc(8)
    b.writeDoubleLE(value)
    this.chunks.push(b)
  }

  raw(data: Uint8Array): void {
    this.chunks.push(Buffer.from(data))
  }

  /** Strings and byte arrays are padded to 4-byte boundaries on the wire. */
  pad4(length: number): void {
    if (length % 4) this.chunks.push(Buffer.alloc(4 - (length % 4)))
  }

  buffer(): Buffer {
    return Buffer.concat(this.chunks)
  }
}

function encodeInto(w: Writer, value: GdValue): void {
  if (value === null || value === undefined) {
    w.u32(T_NIL)
  } else if (typeof value === 'boolean') {
    w.u32(T_BOOL)
    w.u32(value ? 1 : 0)
  } else if (typeof value === 'number') {
    if (Number.isInteger(value) && value >= -0x80000000 && value <= 0x7fffffff) {
      w.u32(T_INT)
      w.i32(value)
    } else if (Number.isInteger(value)) {
      w.u32(T_INT | HEADER_DATA_FLAG_64)
      w.i64(BigInt(value))
    } else {
      w.u32(T_FLOAT | HEADER_DATA_FLAG_64)
      w.f64(value)
    }
  } else if (typeof value === 'bigint') {
    w.u32(T_INT | HEADER_DATA_FLAG_64)
    w.i64(value)
  } else if (typeof value === 'string') {
    w.u32(T_STRING)
    const utf8 = Buffer.from(value, 'utf8')
    w.u32(utf8.length)
    w.raw(utf8)
    w.pad4(utf8.length)
  } else if (value instanceof GdVector2i) {
    w.u32(T_VECTOR2I)
    w.i32(value.x)
    w.i32(value.y)
  } else if (value instanceof GdFloat) {
    // 32-bit float variant (used by Vector2 components elsewhere; rarely needed).
    w.u32(T_FLOAT)
    w.f32(value.value)
  } else if (value instanceof Uint8Array) {
    w.u32(T_PACKED_BYTE_ARRAY)
    w.u32(value.length)
    w.raw(value)
    w.pad4(value.length)
  } else if (Array.isArray(value)) {
    w.u32(T_ARRAY)
    w.u32(value.length & 0x7fffffff)
    for (const element of value) encodeInto(w, element)
  } else if (value instanceof Map) {
    w.u32(T_DICTIONARY)
    w.u32(value.size & 0x7fffffff)
    for (const [k, v] of value) {
      encodeInto(w, k)
      encodeInto(w, v)
    }
  } else {
    throw new Error(`godot-wire: cannot encode value of type ${typeof value}`)
  }
}

export function encodeVariant(value: GdValue): Buffer {
  const w = new Writer()
  encodeInto(w, value)
  return w.buffer()
}

class Reader {
  pos = 0
  constructor(private buf: Buffer) {}

  u32(): number {
    const v = this.buf.readUInt32LE(this.pos)
    this.pos += 4
    return v
  }
  i32(): number {
    const v = this.buf.readInt32LE(this.pos)
    this.pos += 4
    return v
  }
  i64(): bigint {
    const v = this.buf.readBigInt64LE(this.pos)
    this.pos += 8
    return v
  }
  f32(): number {
    const v = this.buf.readFloatLE(this.pos)
    this.pos += 4
    return v
  }
  f64(): number {
    const v = this.buf.readDoubleLE(this.pos)
    this.pos += 8
    return v
  }
  bytes(n: number): Buffer {
    const v = this.buf.subarray(this.pos, this.pos + n)
    this.pos += n
    return v
  }
  skipPad4(length: number): void {
    if (length % 4) this.pos += 4 - (length % 4)
  }
}

export type GdDecoded = null | boolean | number | bigint | string | Uint8Array | GdDecoded[] | { [k: string]: GdDecoded }

function decodeString(r: Reader): string {
  const length = r.u32()
  const s = r.bytes(length).toString('utf8')
  r.skipPad4(length)
  return s
}

function decodeInner(r: Reader, depth: number): GdDecoded {
  if (depth > 32) throw new Error('godot-wire: nesting too deep')
  const header = r.u32()
  const type = header & 0xff
  const is64 = (header & HEADER_DATA_FLAG_64) !== 0
  switch (type) {
    case T_NIL:
      return null
    case T_BOOL:
      return r.u32() !== 0
    case T_INT: {
      if (is64) {
        const v = r.i64()
        return v >= Number.MIN_SAFE_INTEGER && v <= Number.MAX_SAFE_INTEGER ? Number(v) : v
      }
      return r.i32()
    }
    case T_FLOAT:
      return is64 ? r.f64() : r.f32()
    case T_STRING:
    case T_STRING_NAME:
      return decodeString(r)
    case T_VECTOR2:
      return [r.f32(), r.f32()]
    case T_VECTOR2I:
      return [r.i32(), r.i32()]
    case T_RECT2:
      return [r.f32(), r.f32(), r.f32(), r.f32()]
    case T_RECT2I:
      return [r.i32(), r.i32(), r.i32(), r.i32()]
    case T_COLOR:
      return [r.f32(), r.f32(), r.f32(), r.f32()]
    case T_DICTIONARY: {
      // Typed dictionaries (header bits 16-19) never appear in debugger
      // traffic we consume; reject rather than misparse.
      if (header >> 16 !== 0) throw new Error('godot-wire: typed dictionary unsupported')
      const count = r.u32() & 0x7fffffff
      const out: { [k: string]: GdDecoded } = {}
      for (let i = 0; i < count; i++) {
        const key = decodeInner(r, depth + 1)
        const value = decodeInner(r, depth + 1)
        out[typeof key === 'string' ? key : JSON.stringify(key)] = value
      }
      return out
    }
    case T_ARRAY: {
      if (header >> 16 !== 0) throw new Error('godot-wire: typed array unsupported')
      const count = r.u32() & 0x7fffffff
      const out: GdDecoded[] = []
      for (let i = 0; i < count; i++) out.push(decodeInner(r, depth + 1))
      return out
    }
    case T_PACKED_BYTE_ARRAY: {
      const count = r.u32()
      const data = new Uint8Array(r.bytes(count))
      r.skipPad4(count)
      return data
    }
    case T_PACKED_INT32_ARRAY: {
      const count = r.u32()
      const out: GdDecoded[] = []
      for (let i = 0; i < count; i++) out.push(r.i32())
      return out
    }
    case T_PACKED_INT64_ARRAY: {
      const count = r.u32()
      const out: GdDecoded[] = []
      for (let i = 0; i < count; i++) out.push(Number(r.i64()))
      return out
    }
    case T_PACKED_FLOAT32_ARRAY: {
      const count = r.u32()
      const out: GdDecoded[] = []
      for (let i = 0; i < count; i++) out.push(r.f32())
      return out
    }
    case T_PACKED_FLOAT64_ARRAY: {
      const count = r.u32()
      const out: GdDecoded[] = []
      for (let i = 0; i < count; i++) out.push(r.f64())
      return out
    }
    case T_PACKED_STRING_ARRAY: {
      const count = r.u32()
      const out: GdDecoded[] = []
      for (let i = 0; i < count; i++) out.push(decodeString(r))
      return out
    }
    default:
      throw new Error(`godot-wire: unsupported variant type ${type}`)
  }
}

export function decodeVariant(buf: Buffer): GdDecoded {
  return decodeInner(new Reader(buf), 0)
}

/** Frame a debugger message: [name, thread_id, data] with length prefix. */
export function frameMessage(name: string, threadId: number | bigint, data: GdValue[]): Buffer {
  const payload = encodeVariant([name, typeof threadId === 'number' ? BigInt(threadId) : threadId, data])
  const header = Buffer.alloc(4)
  header.writeUInt32LE(payload.length)
  return Buffer.concat([header, payload])
}

export interface DebuggerMessage {
  name: string
  threadId: bigint | number
  data: GdDecoded[]
}

/**
 * Incremental splitter for the debugger TCP stream. Feed raw chunks, get
 * parsed messages. Messages that fail to decode are skipped (framing keeps
 * the stream in sync).
 */
export class MessageReader {
  private buffer = Buffer.alloc(0)

  push(chunk: Buffer): DebuggerMessage[] {
    this.buffer = Buffer.concat([this.buffer, chunk])
    const messages: DebuggerMessage[] = []
    for (;;) {
      if (this.buffer.length < 4) break
      const size = this.buffer.readUInt32LE(0)
      if (this.buffer.length < 4 + size) break
      const payload = this.buffer.subarray(4, 4 + size)
      this.buffer = this.buffer.subarray(4 + size)
      try {
        const decoded = decodeVariant(Buffer.from(payload))
        if (Array.isArray(decoded) && decoded.length >= 3 && typeof decoded[0] === 'string') {
          messages.push({
            name: decoded[0],
            threadId: decoded[1] as bigint | number,
            data: (decoded[2] as GdDecoded[]) ?? []
          })
        }
      } catch {
        // Unsupported payload (e.g. full object) — drop just this message.
      }
    }
    return messages
  }
}
