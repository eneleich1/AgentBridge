import { useEffect, useRef, useState } from "react";
import VoiceInput from "./VoiceInput";
import LiveVoiceButton from "./LiveVoiceButton";

export default function ChatComposer({
  prompt,
  attachments,
  agent,
  mode,
  running,
  duelEnabled = false,
  onPromptChange,
  onAttachmentsChange,
  onAgentChange,
  onModeChange,
  onSend,
  onCancel,
  onLiveSubmit,
  onLiveInterrupt,
  liveReply,
}) {
  const [voicePreview, setVoicePreview] = useState("");
  const [voiceListening, setVoiceListening] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const fileInputRef = useRef(null);
  const voiceInputRef = useRef(null);
  const textareaRef = useRef(null);
  const displayedPrompt = voicePreview
    ? `${prompt}${prompt ? " " : ""}${voicePreview}`
    : prompt;

  function handleSend() {
    voiceInputRef.current?.stop(onSend);
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey && !running) {
      e.preventDefault();
      if (prompt.trim() || attachments.length > 0) handleSend();
    }
  }

  function addImageFiles(files) {
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      const reader = new FileReader();
      reader.onload = () => {
        onAttachmentsChange((current) => [
          ...current,
          {
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            name: file.name || "pasted-image.png",
            mimeType: file.type,
            size: file.size,
            dataUrl: reader.result,
          },
        ]);
      };
      reader.readAsDataURL(file);
    }
  }

  async function addImageDataUrl(dataUrl, name = "pasted-image.png") {
    if (!dataUrl?.startsWith("data:image/")) return false;
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    onAttachmentsChange((current) => [
      ...current,
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name,
        mimeType: blob.type || "image/png",
        size: blob.size,
        dataUrl,
      },
    ]);
    return true;
  }

  async function addImagesFromHtml(html) {
    if (!html) return false;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const imageSources = Array.from(doc.querySelectorAll("img"))
      .map((img) => img.getAttribute("src"))
      .filter((src) => src?.startsWith("data:image/"));

    for (const [index, src] of imageSources.entries()) {
      await addImageDataUrl(src, `pasted-image-${index + 1}.png`);
    }

    return imageSources.length > 0;
  }

  async function handlePaste(e) {
    if (e.__agentBridgePasteHandled) return;
    const files = Array.from(e.clipboardData?.files || []).filter((file) =>
      file.type.startsWith("image/")
    );
    if (files.length > 0) {
      e.__agentBridgePasteHandled = true;
      e.preventDefault();
      e.stopPropagation();
      addImageFiles(files);
      return;
    }

    const imageItems = Array.from(e.clipboardData?.items || [])
      .filter((item) => item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter(Boolean);
    if (imageItems.length > 0) {
      e.__agentBridgePasteHandled = true;
      e.preventDefault();
      e.stopPropagation();
      addImageFiles(imageItems);
      return;
    }

    const html = e.clipboardData?.getData("text/html");
    const hasHtmlImages = html?.includes("data:image/");
    if (hasHtmlImages) {
      e.__agentBridgePasteHandled = true;
      e.preventDefault();
      e.stopPropagation();
      await addImagesFromHtml(html);
    }
  }

  useEffect(() => {
    function onWindowPaste(e) {
      const target = e.target;
      const isInsideComposer = target?.closest?.(".composer-box");
      if (!isInsideComposer) return;
      handlePaste(e);
    }

    window.addEventListener("paste", onWindowPaste);
    return () => window.removeEventListener("paste", onWindowPaste);
  });

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [displayedPrompt, attachments.length]);

  function removeAttachment(id) {
    onAttachmentsChange((current) => current.filter((item) => item.id !== id));
  }

  function focusTextarea() {
    textareaRef.current?.focus();
  }

  function handleClearPrompt() {
    setVoicePreview("");
    onPromptChange("");
    focusTextarea();
  }

  function handleSelectAll() {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.select();
  }

  async function handleCopyPrompt() {
    const textarea = textareaRef.current;
    const textToCopy = displayedPrompt;
    if (!textarea || !textToCopy) return;

    try {
      await navigator.clipboard.writeText(textToCopy);
      textarea.focus();
      return;
    } catch {
      textarea.focus();
      textarea.select();
      document.execCommand("copy");
    }
  }

  const canSend = !running && (prompt.trim() || attachments.length > 0);
  const hasPromptText = Boolean(displayedPrompt.trim());

  return (
    <div className="composer-wrap">
      <div className="composer-toolbar">
        <select value={agent} onChange={(e) => onAgentChange(e.target.value)} disabled={running}>
          <option value="cursor">Cursor</option>
          <option value="codex">Codex</option>
          {(duelEnabled || agent === "duel") && (
            <option value="duel" disabled={!duelEnabled}>
              Agent Duel{duelEnabled ? "" : " (disabled)"}
            </option>
          )}
        </select>
        <select value={mode} onChange={(e) => onModeChange(e.target.value)} disabled={running || agent === "duel"}>
          <option value="ask">Ask</option>
          <option value="plan">Plan</option>
          <option value="execute">Execute</option>
        </select>
      </div>

      <div className="composer-box" onPaste={handlePaste}>
        <div className="composer-input-stack">
          {attachments.length > 0 && (
            <div className="attachment-strip">
              {attachments.map((attachment) => (
                <div className="attachment-thumb" key={attachment.id}>
                  <img src={attachment.dataUrl} alt={attachment.name} />
                  <button
                    type="button"
                    onClick={() => removeAttachment(attachment.id)}
                    aria-label={`Remove ${attachment.name}`}
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            rows={1}
            value={displayedPrompt}
            onChange={(e) => {
              setVoicePreview("");
              onPromptChange(e.target.value);
            }}
            onPaste={handlePaste}
            onKeyDown={handleKeyDown}
            placeholder={running ? "The agent is working. Type your next message here..." : "Message the desktop agent..."}
          />
        </div>
        <div className="composer-box-actions">
          <div className="composer-action-group">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                addImageFiles(Array.from(e.target.files || []));
                e.target.value = "";
              }}
            />
            <VoiceInput
              ref={voiceInputRef}
              disabled={false}
              language="es-US"
              onListeningChange={setVoiceListening}
              onInterimTranscript={setVoicePreview}
              onTranscript={(text) => {
                setVoicePreview("");
                onPromptChange(prompt ? `${prompt} ${text}` : text);
              }}
            />
            <button
              type="button"
              className={`composer-icon-btn composer-more-btn ${toolsOpen ? "active" : ""}`}
              onClick={() => setToolsOpen((current) => !current)}
              title={toolsOpen ? "Hide tools" : "More tools"}
              aria-label={toolsOpen ? "Hide tools" : "More tools"}
              aria-expanded={toolsOpen}
            >
              {toolsOpen ? "−" : "⋯"}
            </button>
            <div className={`composer-extra-tools ${toolsOpen ? "open" : ""}`}>
              <button
                type="button"
                className="composer-icon-btn"
                onClick={() => fileInputRef.current?.click()}
                title="Attach image"
                aria-label="Attach image"
              >
                +
              </button>
              <button
                type="button"
                className="composer-icon-btn"
                onClick={handleClearPrompt}
                disabled={!hasPromptText}
                title="Clear prompt"
                aria-label="Clear prompt"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M5 6h14M9 6V4h6v2m-7 3v8m4-8v8m4-8v8M7 6l1 14h8l1-14"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <button
                type="button"
                className="composer-icon-btn"
                onClick={handleSelectAll}
                disabled={!hasPromptText}
                title="Select all"
                aria-label="Select all"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M9 5H5v4M15 5h4v4M9 19H5v-4M15 19h4v-4"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <rect
                    x="8"
                    y="8"
                    width="8"
                    height="8"
                    rx="1.5"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  />
                </svg>
              </button>
              <button
                type="button"
                className="composer-icon-btn"
                onClick={handleCopyPrompt}
                disabled={!hasPromptText}
                title="Copy prompt"
                aria-label="Copy prompt"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <rect
                    x="9"
                    y="9"
                    width="10"
                    height="10"
                    rx="2"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  />
                  <path
                    d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          </div>
          <div className="composer-live-center">
            <LiveVoiceButton
              disabled={running && !onLiveInterrupt}
              running={running}
              liveReply={liveReply}
              onSubmit={onLiveSubmit}
              onInterrupt={onLiveInterrupt}
            />
          </div>
          <button
            type="button"
            className={`composer-send-btn ${running ? "stop" : ""}`}
            onClick={running ? onCancel : handleSend}
            disabled={!running && !canSend}
            title={running ? "Stop" : voiceListening ? "Stop voice input and send" : "Send"}
            aria-label={running ? "Stop" : voiceListening ? "Stop voice input and send" : "Send"}
          >
            {running ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M7 7h10v10H7z" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M3.4 20.4 22 12 3.4 3.6l1.8 7.2L17 12l-11.8 1.2-1.8 7.2z" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
