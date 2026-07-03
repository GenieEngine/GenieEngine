import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AssetPreview, ChatAttachment, ChatPartUpdate, ChatToolStatus } from '../../../shared/types'
import { FileIcon, PlusIcon, SearchIcon, SendIcon, SparkIcon, StopIcon, TerminalIcon, XIcon } from './Icons'

marked.setOptions({ gfm: true, breaks: true })

/** Sanitized GitHub-flavored markdown — the assistant writes reports, tables, code. */
function Markdown({ source }: { source: string }): React.JSX.Element {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(source, { async: false }) as string), [source])
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />
}

interface AssistantPart {
  id: string
  kind: 'text' | 'reasoning' | 'tool' | 'image' | 'asset'
  text: string
  tool?: { name: string; status: ChatToolStatus; title?: string }
  dataUrl?: string
  /** For kind 'asset': the generated 2D/3D asset preview the user can react to. */
  asset?: AssetPreview
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'error'
  content: string
  /** Assistant messages are a sequence of parts (text, tools, images). */
  parts?: AssistantPart[]
  /** Files the user attached to this message (chat-only, not project files). */
  attachments?: ChatAttachment[]
  streaming?: boolean
}

// Attachments cap: data URLs ride the message to the model; keep them sane.
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

interface Props {
  opencodeAvailable: boolean
  onAssistantDone: () => void
}

const SUGGESTIONS = [
  'Make a 2D platformer with a player that moves and jumps',
  'Add a score counter to the screen',
  'Give the game a title screen with a start button'
]

interface SlashCommand {
  name: string
  description: string
}

const SLASH_COMMANDS: SlashCommand[] = [{ name: 'clear', description: 'Clear the chat history' }]

/**
 * The text qualifies as a slash-command query only while it looks like one:
 * starts with "/", single token, no second slash (so pasting paths like
 * "/root/Main" never hijacks the input).
 */
function slashQueryOf(input: string): string | null {
  if (!input.startsWith('/') || input.length > 24) return null
  const rest = input.slice(1)
  if (/[\s/]/.test(rest)) return null
  return rest.toLowerCase()
}

function toolIcon(name: string): React.JSX.Element {
  if (name === 'bash') return <TerminalIcon size={11} />
  if (name === 'glob' || name === 'grep' || name === 'list' || name === 'webfetch') return <SearchIcon size={11} />
  if (name === 'read' || name === 'write' || name === 'edit' || name === 'patch') return <FileIcon size={11} />
  return <SparkIcon size={11} />
}

/** Compact label for a tool chip: the tool name plus a shortened target. */
function toolLabel(tool: { name: string; title?: string }): string {
  let title = tool.title ?? ''
  if (title.includes('/')) {
    title = title.split('/').filter(Boolean).slice(-2).join('/')
  }
  if (title.length > 40) title = title.slice(0, 39) + '…'
  const name = tool.name.replace(/^opengenie_/, '')
  return title ? `${name} · ${title}` : name
}

function ToolChip({ part }: { part: AssistantPart }): React.JSX.Element {
  const status = part.tool?.status ?? 'running'
  return (
    <span className={`tool-chip ${status}`}>
      <span className="tool-chip-icon">{toolIcon(part.tool?.name ?? '')}</span>
      <span className="tool-chip-label">{toolLabel(part.tool ?? { name: 'tool' })}</span>
      <span className="tool-chip-status">
        {status === 'completed' ? '✓' : status === 'error' ? <XIcon size={9} /> : <span className="spinner" />}
      </span>
    </span>
  )
}

/**
 * Renders one assistant message as flowing content (no bubble): markdown
 * text, compact tool-activity rows, live test screenshots.
 */
function AssistantMessage({
  msg,
  isFirst,
  onAssetFeedback
}: {
  msg: ChatMessage
  isFirst: boolean
  onAssetFeedback: (asset: AssetPreview) => void
}): React.JSX.Element {
  const parts = msg.parts ?? []
  const last = parts[parts.length - 1]

  const blocks: React.JSX.Element[] = []
  let toolGroup: AssistantPart[] = []
  const flushTools = (): void => {
    if (toolGroup.length > 0) {
      blocks.push(
        <div key={`tools-${toolGroup[0].id}`} className="tool-row">
          {toolGroup.map((p) => (
            <ToolChip key={p.id} part={p} />
          ))}
        </div>
      )
      toolGroup = []
    }
  }

  for (const part of parts) {
    if (part.kind === 'tool') {
      toolGroup.push(part)
      continue
    }
    flushTools()
    if (part.kind === 'text' && part.text) {
      blocks.push(<Markdown key={part.id} source={part.text} />)
    } else if (part.kind === 'image' && part.dataUrl) {
      blocks.push(<img key={part.id} className="chat-shot" src={part.dataUrl} alt="Game screenshot from test run" />)
    } else if (part.kind === 'asset' && part.asset) {
      const asset = part.asset
      blocks.push(
        <div key={part.id} className="asset-card">
          <img className="asset-card-img" src={asset.dataUrl} alt={`Generated ${asset.kind} asset: ${asset.label}`} />
          <div className="asset-card-meta">
            <span className={`asset-kind-badge kind-${asset.kind}`}>{asset.kind === '3d' ? '3D' : '2D'}</span>
            <span className="asset-card-name">{asset.label}</span>
            <span className="asset-card-path">{asset.path}</span>
            <button
              className="btn btn-sm btn-ghost asset-feedback-btn"
              title="Describe what to change — the assistant will regenerate this asset"
              onClick={() => onAssetFeedback(asset)}
            >
              Request changes
            </button>
          </div>
        </div>
      )
    } else if (part.kind === 'reasoning' && msg.streaming && part === last) {
      blocks.push(
        <div key={part.id} className="thinking-line">
          <span className="spinner" /> Thinking…
        </div>
      )
    }
  }
  flushTools()

  return (
    <div className={isFirst ? 'msg assistant' : 'msg assistant cont'}>
      {blocks}
      {msg.streaming && parts.length === 0 && (
        <span className="typing-dots">
          <span />
          <span />
          <span />
        </span>
      )}
    </div>
  )
}

export function ChatPanel({ opencodeAvailable, onAssistantDone }: Props): React.JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [slashIndex, setSlashIndex] = useState(0)
  const [slashDismissed, setSlashDismissed] = useState(false)
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [attachError, setAttachError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const onDoneRef = useRef(onAssistantDone)
  onDoneRef.current = onAssistantDone

  // "Request changes" on a generated asset: pre-fill the composer so the user
  // just describes what's wrong; the assistant regenerates (AGENTS.md tells it
  // to reuse the same folder/name so the files are replaced).
  const startAssetFeedback = (asset: AssetPreview): void => {
    setInput(`Change the "${asset.label}" asset (${asset.path}): `)
    textareaRef.current?.focus()
  }

  const addFiles = async (files: FileList | null): Promise<void> => {
    if (!files || files.length === 0) return
    setAttachError(null)
    const next = [...attachments]
    for (const file of Array.from(files)) {
      const total = next.reduce((n, a) => n + a.dataUrl.length, 0)
      if (file.size > MAX_ATTACHMENT_BYTES || total + file.size * 1.4 > MAX_ATTACHMENT_BYTES) {
        setAttachError('Attachments are limited to 8 MB per message.')
        break
      }
      next.push({
        name: file.name,
        mime: file.type || 'application/octet-stream',
        dataUrl: await readFileAsDataUrl(file)
      })
    }
    setAttachments(next)
  }

  const slashQuery = slashQueryOf(input)
  const slashMatches = slashQuery !== null ? SLASH_COMMANDS.filter((c) => c.name.startsWith(slashQuery)) : []
  const slashOpen = !slashDismissed && slashMatches.length > 0

  useEffect(() => {
    const offPart = window.api.onChatPart((update: ChatPartUpdate) => {
      setMessages((msgs) => {
        const next = [...msgs]
        // Find (or start) the assistant message this part belongs to.
        let idx = next.findIndex((m) => m.id === update.messageID)
        if (idx === -1) {
          next.push({ id: update.messageID, role: 'assistant', content: '', parts: [], streaming: true })
          idx = next.length - 1
        }
        const msg = { ...next[idx], parts: [...(next[idx].parts ?? [])] }
        const parts = msg.parts!
        const part: AssistantPart = {
          id: update.partID,
          kind: update.kind,
          text: update.text ?? '',
          tool: update.tool
        }
        const existing = parts.findIndex((p) => p.id === update.partID)
        if (existing === -1) parts.push(part)
        else parts[existing] = part
        next[idx] = msg
        return next
      })
    })
    // Appends a part to the newest assistant message (screenshots and asset
    // previews arrive from the main process while the assistant is working).
    const appendToLatestAssistant = (part: AssistantPart): void => {
      setMessages((msgs) => {
        const next = [...msgs]
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].role === 'assistant') {
            const msg = { ...next[i], parts: [...(next[i].parts ?? [])] }
            msg.parts!.push(part)
            next[i] = msg
            return next
          }
        }
        // No assistant message yet — show the part in a message of its own.
        return [...next, { id: crypto.randomUUID(), role: 'assistant', content: '', parts: [part] }]
      })
    }
    // Screenshots taken during AI test runs flow into the conversation.
    const offShot = window.api.onGameTestShot((dataUrl: string) => {
      appendToLatestAssistant({ id: `shot-${Date.now()}-${Math.random()}`, kind: 'image', text: '', dataUrl })
    })
    // Generated 2D/3D asset previews — rendered with a feedback button.
    const offAsset = window.api.onAssetPreview((preview: AssetPreview) => {
      appendToLatestAssistant({ id: `asset-${Date.now()}-${Math.random()}`, kind: 'asset', text: '', asset: preview })
    })
    const offDone = window.api.onChatDone((payload) => {
      setStreaming(false)
      setMessages((msgs) => {
        const finalized = msgs.map((m) => (m.streaming ? { ...m, streaming: false } : m))
        if (payload.cancelled) {
          return [...finalized, { id: crypto.randomUUID(), role: 'error' as const, content: 'Stopped.' }]
        }
        if (!payload.ok && payload.error) {
          return [...finalized, { id: crypto.randomUUID(), role: 'error' as const, content: payload.error }]
        }
        return finalized
      })
      // The assistant may have created or edited game files — refresh views.
      onDoneRef.current()
    })
    return () => {
      offPart()
      offShot()
      offAsset()
      offDone()
    }
  }, [])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, streaming])

  const send = async (text?: string): Promise<void> => {
    const message = (text ?? input).trim()
    if ((!message && attachments.length === 0) || streaming) return
    const outgoing = attachments
    setInput('')
    setAttachments([])
    setAttachError(null)
    setMessages((msgs) => [
      ...msgs,
      { id: crypto.randomUUID(), role: 'user', content: message, attachments: outgoing }
    ])
    setStreaming(true)
    const result = await window.api.chatSend(message, outgoing)
    if (!result.ok) {
      setStreaming(false)
      setMessages((msgs) => [...msgs, { id: crypto.randomUUID(), role: 'error', content: result.error }])
    }
  }

  const runCommand = async (command: SlashCommand): Promise<void> => {
    setInput('')
    setSlashIndex(0)
    if (command.name === 'clear') {
      if (streaming) await window.api.chatCancel()
      await window.api.chatNewSession()
      setMessages([])
      setStreaming(false)
    }
  }

  return (
    <div className="chat-panel">
      <div className="chat-body">
      <div className="chat-messages" ref={listRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            {!opencodeAvailable && (
              <div className="notice">
                The bundled OpenCode assistant is missing. Reinstall OpenGenie, or run{' '}
                <code>npm run setup</code> in development.
              </div>
            )}
            <p className="muted">Describe what you want to build and the assistant will write the game for you.</p>
            <div className="chat-suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="suggestion-chip" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
            <p className="chat-hint">
              Tip: type <code>/</code> for commands — <code>/clear</code> resets the chat.
            </p>
          </div>
        )}

        {messages.map((m, i) => {
          if (m.role === 'assistant') {
            return (
              <AssistantMessage
                key={m.id}
                msg={m}
                isFirst={messages[i - 1]?.role !== 'assistant'}
                onAssetFeedback={startAssetFeedback}
              />
            )
          }
          return (
            <div key={m.id} className={`msg ${m.role}`}>
              {m.attachments && m.attachments.length > 0 && (
                <div className="msg-attachments">
                  {m.attachments.map((a, j) =>
                    a.mime.startsWith('image/') ? (
                      <img key={j} className="attach-thumb" src={a.dataUrl} alt={a.name} title={a.name} />
                    ) : (
                      <span key={j} className="attach-file" title={a.name}>
                        <FileIcon size={11} /> {a.name}
                      </span>
                    )
                  )}
                </div>
              )}
              {m.content && <div className="msg-content">{m.content}</div>}
            </div>
          )
        })}

        {streaming && !messages.some((m) => m.role === 'assistant' && m.streaming) && (
          <div className="msg assistant">
            <span className="typing-dots">
              <span />
              <span />
              <span />
            </span>
          </div>
        )}
      </div>

      <div className="chat-inputbar">
        {slashOpen && (
          <div className="slash-pop">
            {slashMatches.map((command, i) => (
              <button
                key={command.name}
                className={i === slashIndex ? 'slash-item selected' : 'slash-item'}
                onMouseEnter={() => setSlashIndex(i)}
                onClick={() => void runCommand(command)}
              >
                <span className="slash-name">/{command.name}</span>
                <span className="slash-desc">{command.description}</span>
              </button>
            ))}
          </div>
        )}
        <div className="chat-inputbox">
          {(attachments.length > 0 || attachError) && (
            <div className="attach-row">
              {attachments.map((a, i) => (
                <span key={i} className="attach-chip" title={a.name}>
                  {a.mime.startsWith('image/') ? (
                    <img className="attach-chip-thumb" src={a.dataUrl} alt="" />
                  ) : (
                    <FileIcon size={11} />
                  )}
                  <span className="attach-chip-name">{a.name}</span>
                  <button
                    className="attach-remove"
                    title="Remove attachment"
                    onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <XIcon size={9} />
                  </button>
                </span>
              ))}
              {attachError && <span className="attach-error">{attachError}</span>}
            </div>
          )}
          <textarea
            ref={textareaRef}
            className="chat-textarea"
            rows={3}
            placeholder="Build me a game where…  (/ for commands)"
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              setSlashDismissed(false)
              setSlashIndex(0)
            }}
          onKeyDown={(e) => {
            if (slashOpen) {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSlashIndex((i) => (i + 1) % slashMatches.length)
                return
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSlashIndex((i) => (i - 1 + slashMatches.length) % slashMatches.length)
                return
              }
              if (e.key === 'Tab') {
                e.preventDefault()
                setInput(`/${slashMatches[slashIndex].name}`)
                return
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                setSlashDismissed(true)
                return
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void runCommand(slashMatches[slashIndex])
                return
              }
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          />
          <div className="inputbox-bar">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.txt,.md,.json,.gd,.tscn,.cfg,.csv,.log,.pdf"
              style={{ display: 'none' }}
              onChange={(e) => {
                void addFiles(e.target.files)
                e.target.value = ''
              }}
            />
            <button
              className="attach-btn"
              title="Attach files or images (stay in the chat, not added to your game)"
              onClick={() => fileInputRef.current?.click()}
            >
              <PlusIcon size={14} />
            </button>
            {streaming ? (
              <button className="send-btn stop" title="Stop" onClick={() => void window.api.chatCancel()}>
                <StopIcon size={13} />
              </button>
            ) : (
              <button
                className="send-btn"
                title="Send"
                disabled={!input.trim() && attachments.length === 0}
                onClick={() => void send()}
              >
                <SendIcon size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}
