import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

function normalizeTranscript(text) {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function containsWordSequence(words, sequence) {
  if (sequence.length > words.length) return false;
  return words.some((_, index) =>
    sequence.every((word, sequenceIndex) => words[index + sequenceIndex] === word)
  );
}

function getTranscriptDelta(transcript, committedTranscript) {
  const normalizedTranscript = normalizeTranscript(transcript);
  if (!normalizedTranscript) return "";
  if (!committedTranscript) return transcript;
  if (normalizedTranscript === committedTranscript) return "";

  const transcriptWords = transcript.trim().split(/\s+/);
  const normalizedWords = normalizedTranscript.split(" ");
  const committedWords = committedTranscript.split(" ");
  if (containsWordSequence(committedWords, normalizedWords)) return "";

  const maxOverlap = Math.min(normalizedWords.length, committedWords.length);

  for (let overlap = maxOverlap; overlap > 0; overlap--) {
    const committedSuffix = committedWords.slice(-overlap).join(" ");
    const transcriptPrefix = normalizedWords.slice(0, overlap).join(" ");
    if (committedSuffix === transcriptPrefix) {
      return transcriptWords.slice(overlap).join(" ");
    }
  }

  return transcript;
}

function appendNormalizedTranscript(current, next) {
  const normalizedNext = normalizeTranscript(next);
  if (!normalizedNext) return current;
  return current ? `${current} ${normalizedNext}` : normalizedNext;
}

const VoiceInput = forwardRef(function VoiceInput({
  onTranscript,
  onInterimTranscript,
  onListeningChange,
  disabled,
  language = "es-US",
}, ref) {
  const [supported, setSupported] = useState(true);
  const [listening, setListening] = useState(false);
  const [message, setMessage] = useState("");
  const recognitionRef = useRef(null);
  const onTranscriptRef = useRef(onTranscript);
  const onListeningChangeRef = useRef(onListeningChange);
  const stopCallbackRef = useRef(null);
  const emittedFinalsRef = useRef(new Set());
  const committedFinalTranscriptRef = useRef("");
  const secureOrigin =
    window.isSecureContext ||
    ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    onListeningChangeRef.current = onListeningChange;
  }, [onListeningChange]);

  useEffect(() => {
    onListeningChangeRef.current?.(listening);
  }, [listening]);

  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    setSupported(!!SpeechRecognition);
    if (!secureOrigin) {
      setMessage("Voice input requires HTTPS or localhost.");
      return;
    }
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = language;
    recognition.onresult = (e) => {
      const nextFinals = [];
      let interimText = "";
      let committedTranscript = committedFinalTranscriptRef.current;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const transcript = e.results[i][0]?.transcript?.trim() || "";
        if (e.results[i].isFinal) {
          if (!transcript) continue;
          const normalizedTranscript = normalizeTranscript(transcript);
          if (emittedFinalsRef.current.has(normalizedTranscript)) continue;
          const nextTranscript = getTranscriptDelta(transcript, committedTranscript);
          if (!nextTranscript) {
            emittedFinalsRef.current.add(normalizedTranscript);
            continue;
          }
          emittedFinalsRef.current.add(normalizedTranscript);
          nextFinals.push(nextTranscript);
          committedTranscript = appendNormalizedTranscript(committedTranscript, nextTranscript);
        } else {
          interimText += transcript;
        }
      }
      committedFinalTranscriptRef.current = committedTranscript;
      if (onInterimTranscript) onInterimTranscript(interimText.trim());
      if (nextFinals.length > 0) {
        setMessage("");
        onTranscriptRef.current(nextFinals.join(" "));
      }
    };
    recognition.onend = () => {
      emittedFinalsRef.current.clear();
      committedFinalTranscriptRef.current = "";
      setListening(false);
      if (onInterimTranscript) onInterimTranscript("");
      stopCallbackRef.current?.();
      stopCallbackRef.current = null;
    };
    recognition.onerror = (event) => {
      emittedFinalsRef.current.clear();
      committedFinalTranscriptRef.current = "";
      setListening(false);
      if (onInterimTranscript) onInterimTranscript("");
      stopCallbackRef.current?.();
      stopCallbackRef.current = null;
      const messages = {
        "not-allowed": "Microphone permission was blocked.",
        "service-not-allowed": "Speech recognition is blocked for this origin.",
        "audio-capture": "No microphone was detected.",
        network: "Speech recognition service is unreachable.",
        "no-speech": "No speech was detected.",
      };
      setMessage(messages[event.error] || "Voice input failed.");
    };
    recognitionRef.current = recognition;
    return () => recognition.abort();
  }, []);

  useImperativeHandle(ref, () => ({
    stop(afterStop) {
      if (!recognitionRef.current || !listening) {
        afterStop?.();
        return;
      }
      stopCallbackRef.current = afterStop || null;
      recognitionRef.current.stop();
    },
  }), [listening]);

  const unavailableReason = !secureOrigin
    ? "Voice input requires HTTPS or localhost"
    : !supported
      ? "Speech recognition is not supported by this browser"
      : "";
  const voiceDisabled = disabled || !!unavailableReason;

  return (
    <div className="voice-control">
      {message && <div className="voice-message">{message}</div>}
      {listening && (
        <div className="voice-wave" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      )}
      <button
        type="button"
        className={`composer-icon-btn ${listening ? "active" : ""}`}
        onClick={() => {
          if (voiceDisabled || !recognitionRef.current) {
            if (unavailableReason) setMessage(`${unavailableReason}.`);
            return;
          }
          if (listening) recognitionRef.current.stop();
          else {
            try {
              setMessage("");
              emittedFinalsRef.current.clear();
              committedFinalTranscriptRef.current = "";
              setListening(true);
              recognitionRef.current.start();
            } catch (error) {
              setListening(false);
              setMessage(error.message || "Voice input could not start.");
            }
          }
        }}
        disabled={disabled}
        title={listening ? "Stop voice input" : unavailableReason || "Voice input"}
        aria-label={listening ? "Stop voice input" : "Voice input"}
      >
        {listening ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M7 7h10v10H7z" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z" />
          </svg>
        )}
      </button>
    </div>
  );
});

export default VoiceInput;
