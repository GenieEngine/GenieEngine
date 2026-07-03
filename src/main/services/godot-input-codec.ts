/**
 * Encodes browser input events into Godot's compact InputEvent byte format
 * (core/input/input_event_codec.cpp, Godot 4.7) for the embedded game's
 * `embed:event` debugger message. Positions are in points relative to the
 * game view; the game multiplies by its screen scale.
 */

// InputEventType (core/input/input_enums.h)
const TYPE_KEY = 0
const TYPE_MOUSE_BUTTON = 1
const TYPE_MOUSE_MOTION = 2
const TYPE_PAN_GESTURE = 8

// BoolShift bit positions (input_event_codec.cpp)
const B_SHIFT = 1 << 0
const B_CTRL = 1 << 1
const B_ALT = 1 << 2
const B_META = 1 << 3
const B_ECHO = 1 << 4
const B_PRESSED = 1 << 5
const B_DOUBLE_CLICK = 1 << 6

export interface ModifierState {
  shift: boolean
  ctrl: boolean
  alt: boolean
  meta: boolean
}

function modifierBits(m: ModifierState): number {
  return (m.shift ? B_SHIFT : 0) | (m.ctrl ? B_CTRL : 0) | (m.alt ? B_ALT : 0) | (m.meta ? B_META : 0)
}

// --- Godot Key enum (core/os/keyboard.h) ------------------------------------

const SPECIAL = 1 << 22
const KEY: Record<string, number> = {
  ESCAPE: SPECIAL | 0x01,
  TAB: SPECIAL | 0x02,
  BACKSPACE: SPECIAL | 0x04,
  ENTER: SPECIAL | 0x05,
  KP_ENTER: SPECIAL | 0x06,
  INSERT: SPECIAL | 0x07,
  DELETE: SPECIAL | 0x08,
  HOME: SPECIAL | 0x0d,
  END: SPECIAL | 0x0e,
  LEFT: SPECIAL | 0x0f,
  UP: SPECIAL | 0x10,
  RIGHT: SPECIAL | 0x11,
  DOWN: SPECIAL | 0x12,
  PAGEUP: SPECIAL | 0x13,
  PAGEDOWN: SPECIAL | 0x14,
  SHIFT: SPECIAL | 0x15,
  CTRL: SPECIAL | 0x16,
  META: SPECIAL | 0x17,
  ALT: SPECIAL | 0x18,
  CAPSLOCK: SPECIAL | 0x19,
  F1: SPECIAL | 0x1c
}

/** Map a DOM KeyboardEvent.key to a Godot logical keycode. */
function domKeyToGodot(key: string): number {
  if (key.length === 1) {
    // Printable: Godot keycodes for letters are the uppercase codepoints.
    return key.toUpperCase().codePointAt(0) ?? 0
  }
  switch (key) {
    case 'Escape':
      return KEY.ESCAPE
    case 'Tab':
      return KEY.TAB
    case 'Backspace':
      return KEY.BACKSPACE
    case 'Enter':
      return KEY.ENTER
    case 'Insert':
      return KEY.INSERT
    case 'Delete':
      return KEY.DELETE
    case 'Home':
      return KEY.HOME
    case 'End':
      return KEY.END
    case 'ArrowLeft':
      return KEY.LEFT
    case 'ArrowUp':
      return KEY.UP
    case 'ArrowRight':
      return KEY.RIGHT
    case 'ArrowDown':
      return KEY.DOWN
    case 'PageUp':
      return KEY.PAGEUP
    case 'PageDown':
      return KEY.PAGEDOWN
    case 'Shift':
      return KEY.SHIFT
    case 'Control':
      return KEY.CTRL
    case 'Meta':
      return KEY.META
    case 'Alt':
      return KEY.ALT
    case 'CapsLock':
      return KEY.CAPSLOCK
    default: {
      const fn = key.match(/^F(\d{1,2})$/)
      if (fn) return KEY.F1 + (Number(fn[1]) - 1)
      return 0
    }
  }
}

/** Map a DOM KeyboardEvent.code (physical key) to a Godot physical keycode. */
function domCodeToGodot(code: string): number {
  if (/^Key[A-Z]$/.test(code)) return code.codePointAt(3) ?? 0
  if (/^Digit\d$/.test(code)) return code.codePointAt(5) ?? 0
  switch (code) {
    case 'Space':
      return 0x20
    case 'Minus':
      return 0x2d
    case 'Equal':
      return 0x3d
    case 'BracketLeft':
      return 0x5b
    case 'BracketRight':
      return 0x5d
    case 'Backslash':
      return 0x5c
    case 'Semicolon':
      return 0x3b
    case 'Quote':
      return 0x27
    case 'Comma':
      return 0x2c
    case 'Period':
      return 0x2e
    case 'Slash':
      return 0x2f
    case 'Backquote':
      return 0x60
    case 'ShiftLeft':
    case 'ShiftRight':
      return KEY.SHIFT
    case 'ControlLeft':
    case 'ControlRight':
      return KEY.CTRL
    case 'MetaLeft':
    case 'MetaRight':
      return KEY.META
    case 'AltLeft':
    case 'AltRight':
      return KEY.ALT
    default:
      return domKeyToGodot(code)
  }
}

export interface KeyEventInput extends ModifierState {
  key: string
  code: string
  pressed: boolean
  echo: boolean
  location: number // DOM: 0 standard, 1 left, 2 right (3 numpad → 0)
}

/** [type u8][bools u8][keycode u32][physical u32][label u32][unicode u32][location u8] */
export function encodeKeyEvent(e: KeyEventInput): Uint8Array {
  const buf = Buffer.alloc(19)
  buf.writeUInt8(TYPE_KEY, 0)
  buf.writeUInt8(modifierBits(e) | (e.echo ? B_ECHO : 0) | (e.pressed ? B_PRESSED : 0), 1)
  const keycode = domKeyToGodot(e.key)
  buf.writeUInt32LE(keycode >>> 0, 2)
  buf.writeUInt32LE(domCodeToGodot(e.code) >>> 0, 6)
  buf.writeUInt32LE(keycode >>> 0, 10) // key_label: same as keycode for our purposes
  buf.writeUInt32LE(e.key.length === 1 ? (e.key.codePointAt(0) ?? 0) : 0, 14)
  buf.writeUInt8(e.location === 1 || e.location === 2 ? e.location : 0, 18)
  return buf
}

// Godot MouseButton: LEFT=1 RIGHT=2 MIDDLE=3 WHEEL_UP=4 WHEEL_DOWN=5 WHEEL_LEFT=6 WHEEL_RIGHT=7
export function domButtonToGodot(button: number): number {
  return button === 0 ? 1 : button === 1 ? 3 : button === 2 ? 2 : button + 5
}

/** DOM `buttons` bitmask (L=1,R=2,M=4) → Godot mask (bit = button-1: L=1,R=2,M=4). */
export function domButtonsToGodotMask(buttons: number): number {
  return (buttons & 1 ? 1 : 0) | (buttons & 2 ? 2 : 0) | (buttons & 4 ? 4 : 0)
}

export interface MouseButtonInput extends ModifierState {
  button: number // Godot button index
  pressed: boolean
  doubleClick: boolean
  x: number
  y: number
  mask: number // Godot button mask
}

/** [type u8][bools u8][button u8][pos 2×f32][mask u8] */
export function encodeMouseButtonEvent(e: MouseButtonInput): Uint8Array {
  const buf = Buffer.alloc(12)
  buf.writeUInt8(TYPE_MOUSE_BUTTON, 0)
  buf.writeUInt8(modifierBits(e) | (e.pressed ? B_PRESSED : 0) | (e.doubleClick ? B_DOUBLE_CLICK : 0), 1)
  buf.writeUInt8(e.button, 2)
  buf.writeFloatLE(e.x, 3)
  buf.writeFloatLE(e.y, 7)
  buf.writeUInt8(e.mask, 11)
  return buf
}

export interface MouseMotionInput extends ModifierState {
  x: number
  y: number
  relX: number
  relY: number
  mask: number
}

/** [type u8][bools u8][pos 2×f32][pressure f32][tilt 2×f32][relative 2×f32][mask u8] */
export function encodeMouseMotionEvent(e: MouseMotionInput): Uint8Array {
  const buf = Buffer.alloc(31)
  buf.writeUInt8(TYPE_MOUSE_MOTION, 0)
  buf.writeUInt8(modifierBits(e), 1)
  buf.writeFloatLE(e.x, 2)
  buf.writeFloatLE(e.y, 6)
  buf.writeFloatLE(e.mask ? 1 : 0, 10) // pressure: emulate full press while a button is down
  buf.writeFloatLE(0, 14) // tilt x
  buf.writeFloatLE(0, 18) // tilt y
  buf.writeFloatLE(e.relX, 22)
  buf.writeFloatLE(e.relY, 26)
  buf.writeUInt8(e.mask, 30)
  return buf
}

export interface PanGestureInput extends ModifierState {
  x: number
  y: number
  deltaX: number
  deltaY: number
}

/** [type u8][bools u8][pos 2×f32][delta 2×f32] — smooth trackpad scrolling. */
export function encodePanGestureEvent(e: PanGestureInput): Uint8Array {
  const buf = Buffer.alloc(18)
  buf.writeUInt8(TYPE_PAN_GESTURE, 0)
  buf.writeUInt8(modifierBits(e), 1)
  buf.writeFloatLE(e.x, 2)
  buf.writeFloatLE(e.y, 6)
  buf.writeFloatLE(e.deltaX, 10)
  buf.writeFloatLE(e.deltaY, 14)
  return buf
}
