import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../services/api";
import {
  ContinuousAudioCapture,
  blobToBase64,
  createTurnDetector,
  getAudioCaptureUnavailableReason,
} from "../services/audioCapture";

function normalizeSpokenText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanTextForSpeech(text) {
  return normalizeSpokenText(
    String(text || "")
      .replace(/```[\s\S]*?```/g, " bloque de codigo omitido. ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/https?:\/\/\S+/gi, " enlace omitido ")
      .replace(/[#*_>~|]+/g, " ")
      .replace(/\s([-+])\s/g, " $1 ")
  );
}

function getVoiceForLanguage(language) {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  return (
    voices.find((voice) => voice.lang?.toLowerCase() === language.toLowerCase()) ||
    voices.find((voice) => voice.lang?.toLowerCase().startsWith("es")) ||
    null
  );
}

// While the reply is being read out loud, this is how loud the mic has to
// get to count as the person cutting in rather than an echo of the speaker.
const BARGE_IN_LEVEL = 0.05;
const BARGE_IN_POLL_MS = 120;

/**
 * The full live-voice loop: listen for a turn (continuous mic capture, cut on
 * silence), transcribe it locally, send it to the agent, read the reply out
 * loud, allow interrupting either the reply or the agent, and go back to
 * listening - all without touching the microphone permission again until the
 * button is pressed to stop.
 */
export default function LiveVoiceButton({
  disabled,
  running,
  liveReply,
  onSubmit,
  onInterrupt,
  language = "es-US",
}) {
  const [active, setActive] = useState(false);
  const [phase, setPhase] = useState("idle");
  const [error, setError] = useState("");

  const activeRef = useRef(false);
  const phaseRef = useRef("idle");
  const onSubmitRef = useRef(onSubmit);
  const onInterruptRef = useRef(onInterrupt);
  const languageRef = useRef(language);
  const captureRef = useRef(null);
  const detectorRef = useRef(null);
  const bargeInTimerRef = useRef(null);
  const lastReplyIdRef = useRef(null);
  const waitingForLiveReplyRef = useRef(false);

  const secureOrigin =
    window.isSecureContext ||
    ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);

  const unavailableReason = useMemo(() => {
    if (!secureOrigin) return "Live voice requires HTTPS or localhost";
    const audioReason = getAudioCaptureUnavailableReason();
    if (audioReason) return audioReason;
    if (!window.speechSynthesis) return "Speech output is not supported by this browser";
    return "";
  }, [secureOrigin]);

  useEffect(() => {
    onSubmitRef.current = onSubmit;
  }, [onSubmit]);

  useEffect(() => {
    onInterruptRef.current = onInterrupt;
  }, [onInterrupt]);

  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  function setLivePhase(nextPhase) {
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
  }

  function cancelSpeech() {
    window.speechSynthesis?.cancel?.();
  }

  function stopBargeInWatch() {
    if (bargeInTimerRef.current) {
      window.clearInterval(bargeInTimerRef.current);
      bargeInTimerRef.current = null;
    }
  }

  async function teardown() {
    stopBargeInWatch();
    const detector = detectorRef.current;
    detectorRef.current = null;
    if (detector) await detector.stop().catch(() => {});
    cancelSpeech();
    const capture = captureRef.current;
    captureRef.current = null;
    if (capture) await capture.close().catch(() => {});
  }

  function stopLiveMode() {
    activeRef.current = false;
    waitingForLiveReplyRef.current = false;
    setActive(false);
    setError("");
    setLivePhase("idle");
    void teardown();
  }

  function watchForBargeIn() {
    stopBargeInWatch();
    bargeInTimerRef.current = window.setInterval(() => {
      if (!activeRef.current || phaseRef.current !== "speaking" || !captureRef.current) return;
      if (captureRef.current.getLevel() >= BARGE_IN_LEVEL) {
        stopBargeInWatch();
        cancelSpeech();
        void startListening();
      }
    }, BARGE_IN_POLL_MS);
  }

  function speak(text, { afterSpeech, listenForInterrupt = false } = {}) {
    const spoken = cleanTextForSpeech(text);
    if (!spoken || !window.speechSynthesis) {
      afterSpeech?.();
      return;
    }

    cancelSpeech();
    const utterance = new SpeechSynthesisUtterance(spoken);
    utterance.lang = languageRef.current;
    utterance.rate = 1.02;
    utterance.pitch = 1;
    utterance.voice = getVoiceForLanguage(languageRef.current);
    setLivePhase("speaking");

    const finish = () => {
      stopBargeInWatch();
      // Cancelling speech for a barge-in fires this same event; that path
      // already starts the next turn itself, so this would otherwise start
      // it a second time and collide with the segment it just opened.
      if (activeRef.current && phaseRef.current === "speaking") afterSpeech?.();
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    window.speechSynthesis.speak(utterance);

    if (listenForInterrupt && captureRef.current) {
      watchForBargeIn();
    }
  }

  async function handleTurn(blob) {
    setLivePhase("processing");

    let text = "";
    try {
      const audio = await blobToBase64(blob);
      const result = await api.transcribeAudio({ audio, language: languageRef.current });
      text = normalizeSpokenText(result?.text);
    } catch (transcribeError) {
      setError(transcribeError.message || "Could not transcribe your voice.");
      if (activeRef.current) void startListening();
      return;
    }

    if (!text) {
      if (activeRef.current) void startListening();
      return;
    }

    waitingForLiveReplyRef.current = true;
    try {
      await onSubmitRef.current?.(text);
    } catch (submitError) {
      waitingForLiveReplyRef.current = false;
      setError(submitError?.message || "Could not send the live prompt.");
      if (activeRef.current) void startListening();
    }
  }

  async function startListening() {
    if (!activeRef.current || !captureRef.current) return;
    if (phaseRef.current === "listening") return; // already on a fresh turn
    setError("");
    setLivePhase("listening");
    detectorRef.current = createTurnDetector(captureRef.current, {
      speechThreshold: 0.02,
      silenceMs: 700,
      minSpeechMs: 200,
      maxSegmentMs: 20000,
      onSegment: async (blob) => {
        // This turn is done; the detector would otherwise reopen the mic for
        // another one immediately, but the next phase (processing/speaking)
        // manages listening on its own.
        detectorRef.current?.haltAutoResume();
        await handleTurn(blob);
      },
    });
  }

  useEffect(() => {
    if (!activeRef.current || !liveReply?.id || liveReply.id === lastReplyIdRef.current) return;
    lastReplyIdRef.current = liveReply.id;
    waitingForLiveReplyRef.current = false;

    const replyText = liveReply.text?.trim();
    if (!replyText) {
      void startListening();
      return;
    }

    speak(replyText, {
      listenForInterrupt: true,
      afterSpeech: () => {
        if (activeRef.current) void startListening();
      },
    });
  }, [liveReply]);

  useEffect(() => {
    if (running && activeRef.current && waitingForLiveReplyRef.current) {
      setLivePhase("processing");
    }
  }, [running]);

  useEffect(() => () => {
    void teardown();
  }, []);

  async function handleClick() {
    if (disabled || unavailableReason) {
      if (unavailableReason) setError(`${unavailableReason}.`);
      return;
    }

    if (activeRef.current) {
      if (phaseRef.current === "processing") {
        await onInterruptRef.current?.();
      }
      stopLiveMode();
      return;
    }

    setError("");
    const capture = new ContinuousAudioCapture();
    try {
      await capture.open();
    } catch (openError) {
      setError(
        openError?.name === "NotAllowedError"
          ? "Microphone permission was blocked."
          : openError.message || "Could not access the microphone."
      );
      return;
    }

    captureRef.current = capture;
    activeRef.current = true;
    setActive(true);
    speak("Hola, dime en que te puedo ayudar.", { afterSpeech: startListening });
  }

  async function handleInterrupt() {
    stopBargeInWatch();
    cancelSpeech();
    if (running || phaseRef.current === "processing") {
      await onInterruptRef.current?.();
    }
    waitingForLiveReplyRef.current = false;
    if (activeRef.current) void startListening();
  }

  const labelByPhase = {
    idle: "Live voice",
    speaking: "Hablando",
    listening: "Escuchando",
    processing: "Procesando",
  };
  const title = active
    ? "Stop live voice"
    : unavailableReason || "Start live voice";

  return (
    <div className="live-voice-control">
      {(active || error) && (
        <div className={`live-voice-status ${error ? "error" : phase}`}>
          <span className="live-voice-dot" />
          <span>{error || labelByPhase[phase]}</span>
          {active && (phase === "speaking" || phase === "processing") && (
            <button
              type="button"
              className="live-voice-interrupt"
              onClick={handleInterrupt}
              title="Interrupt"
              aria-label="Interrupt live voice"
            >
              Interrumpir
            </button>
          )}
        </div>
      )}
      <button
        type="button"
        className={`live-voice-btn ${active ? "active" : ""} ${phase}`}
        onClick={handleClick}
        disabled={disabled}
        title={title}
        aria-label={title}
      >
        {phase === "processing" ? (
          <span className="live-voice-spinner" aria-hidden="true" />
        ) : active ? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M7 7h10v10H7z" />
          </svg>
        ) : (
          <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z" />
          </svg>
        )}
      </button>
    </div>
  );
}
