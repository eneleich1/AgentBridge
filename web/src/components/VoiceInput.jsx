import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { api } from "../services/api";
import {
  ContinuousAudioCapture,
  blobToBase64,
  createTurnDetector,
  getAudioCaptureUnavailableReason,
} from "../services/audioCapture";

const VoiceInput = forwardRef(function VoiceInput({
  onTranscript,
  onInterimTranscript,
  onListeningChange,
  disabled,
  language = "es-US",
}, ref) {
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [message, setMessage] = useState("");
  const captureRef = useRef(null);
  const detectorRef = useRef(null);
  const stoppingRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);
  const onInterimTranscriptRef = useRef(onInterimTranscript);
  const onListeningChangeRef = useRef(onListeningChange);
  const languageRef = useRef(language);
  const secureOrigin =
    window.isSecureContext ||
    ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  const unsupportedReason = getAudioCaptureUnavailableReason();

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    onInterimTranscriptRef.current = onInterimTranscript;
  }, [onInterimTranscript]);

  useEffect(() => {
    onListeningChangeRef.current = onListeningChange;
  }, [onListeningChange]);

  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  useEffect(() => {
    onListeningChangeRef.current?.(listening);
  }, [listening]);

  useEffect(() => {
    onInterimTranscriptRef.current?.(transcribing ? "…" : "");
  }, [transcribing]);

  // Unmounting mid-dictation (e.g. navigating away) must still release the
  // microphone; a plain unmount gives the turn detector no chance to do it.
  useEffect(() => () => {
    detectorRef.current?.stop();
    captureRef.current?.close();
  }, []);

  async function transcribeSegment(blob) {
    setTranscribing(true);
    setMessage("");
    try {
      const audio = await blobToBase64(blob);
      const { text } = await api.transcribeAudio({ audio, language: languageRef.current });
      if (text) onTranscriptRef.current?.(text);
    } catch (error) {
      setMessage(error.message || "Could not transcribe audio.");
    } finally {
      setTranscribing(false);
    }
  }

  async function startListening() {
    if (!secureOrigin) {
      setMessage("Voice input requires HTTPS or localhost.");
      return;
    }
    if (unsupportedReason) {
      setMessage(`${unsupportedReason}.`);
      return;
    }

    setMessage("");
    const capture = new ContinuousAudioCapture();
    try {
      await capture.open();
    } catch (error) {
      setMessage(
        error?.name === "NotAllowedError"
          ? "Microphone permission was blocked."
          : error.message || "Could not access the microphone."
      );
      return;
    }

    captureRef.current = capture;
    setListening(true);
    detectorRef.current = createTurnDetector(capture, {
      onSegment: transcribeSegment,
    });
  }

  async function stopListening(afterStop) {
    if (stoppingRef.current) {
      afterStop?.();
      return;
    }
    stoppingRef.current = true;
    try {
      await detectorRef.current?.stop();
      detectorRef.current = null;
      await captureRef.current?.close();
      captureRef.current = null;
      setListening(false);
    } finally {
      stoppingRef.current = false;
      afterStop?.();
    }
  }

  useImperativeHandle(ref, () => ({
    stop(afterStop) {
      if (!listening) {
        afterStop?.();
        return;
      }
      void stopListening(afterStop);
    },
  }), [listening]);

  const unavailableReason = !secureOrigin
    ? "Voice input requires HTTPS or localhost"
    : unsupportedReason || "";
  const voiceDisabled = disabled || !!unavailableReason;

  return (
    <div className="voice-control">
      {message && <div className="voice-message">{message}</div>}
      {listening && (
        <div className={`voice-wave ${transcribing ? "processing" : ""}`} aria-hidden="true">
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
          if (voiceDisabled) {
            if (unavailableReason) setMessage(`${unavailableReason}.`);
            return;
          }
          if (listening) void stopListening();
          else void startListening();
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
