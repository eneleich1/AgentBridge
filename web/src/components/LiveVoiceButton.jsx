import { useEffect, useMemo, useRef, useState } from "react";

function getSpeechRecognition() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

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

export default function LiveVoiceButton({
  disabled,
  running,
  liveReply,
  onSubmit,
  onInterrupt,
  language = "es-US",
}) {
  const [supported, setSupported] = useState(true);
  const [active, setActive] = useState(false);
  const [phase, setPhase] = useState("idle");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");

  const recognitionRef = useRef(null);
  const onSubmitRef = useRef(onSubmit);
  const onInterruptRef = useRef(onInterrupt);
  const activeRef = useRef(false);
  const phaseRef = useRef("idle");
  const finalTranscriptRef = useRef("");
  const submitTimerRef = useRef(null);
  const lastReplyIdRef = useRef(null);
  const speakingRef = useRef(false);
  const waitingForLiveReplyRef = useRef(false);

  const secureOrigin =
    window.isSecureContext ||
    ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);

  const unavailableReason = useMemo(() => {
    if (!secureOrigin) return "Live voice requires HTTPS or localhost";
    if (!supported) return "Live voice is not supported by this browser";
    if (!window.speechSynthesis) return "Speech output is not supported by this browser";
    return "";
  }, [secureOrigin, supported]);

  useEffect(() => {
    onSubmitRef.current = onSubmit;
  }, [onSubmit]);

  useEffect(() => {
    onInterruptRef.current = onInterrupt;
  }, [onInterrupt]);

  function setLivePhase(nextPhase) {
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
  }

  function clearSubmitTimer() {
    if (submitTimerRef.current) {
      window.clearTimeout(submitTimerRef.current);
      submitTimerRef.current = null;
    }
  }

  function stopRecognition() {
    clearSubmitTimer();
    try {
      recognitionRef.current?.stop();
    } catch {
      // The browser throws when recognition is already stopped.
    }
  }

  function cancelSpeech() {
    speakingRef.current = false;
    window.speechSynthesis?.cancel?.();
  }

  function stopLiveMode() {
    activeRef.current = false;
    waitingForLiveReplyRef.current = false;
    setActive(false);
    setInterim("");
    setError("");
    setLivePhase("idle");
    finalTranscriptRef.current = "";
    stopRecognition();
    cancelSpeech();
  }

  function speak(text, { afterSpeech, listenForInterrupt = false } = {}) {
    const spoken = cleanTextForSpeech(text);
    if (!spoken || !window.speechSynthesis) {
      afterSpeech?.();
      return;
    }

    cancelSpeech();
    const utterance = new SpeechSynthesisUtterance(spoken);
    utterance.lang = language;
    utterance.rate = 1.02;
    utterance.pitch = 1;
    utterance.voice = getVoiceForLanguage(language);
    speakingRef.current = true;
    setLivePhase("speaking");
    utterance.onend = () => {
      speakingRef.current = false;
      if (activeRef.current) afterSpeech?.();
    };
    utterance.onerror = () => {
      speakingRef.current = false;
      if (activeRef.current) afterSpeech?.();
    };
    window.speechSynthesis.speak(utterance);
    if (listenForInterrupt) {
      window.setTimeout(() => {
        if (!activeRef.current || !speakingRef.current || !recognitionRef.current) return;
        try {
          recognitionRef.current.start();
        } catch {
          // Recognition may already be running.
        }
      }, 350);
    }
  }

  async function submitTranscript() {
    const text = normalizeSpokenText(finalTranscriptRef.current || interim);
    clearSubmitTimer();
    finalTranscriptRef.current = "";
    setInterim("");
    if (!text) {
      if (activeRef.current) startListening();
      return;
    }

    stopRecognition();
    waitingForLiveReplyRef.current = true;
    setLivePhase("processing");
    try {
      await onSubmitRef.current?.(text);
    } catch (submitError) {
      waitingForLiveReplyRef.current = false;
      setError(submitError?.message || "Could not send the live prompt.");
      if (activeRef.current) startListening();
    }
  }

  function scheduleSubmit() {
    clearSubmitTimer();
    submitTimerRef.current = window.setTimeout(submitTranscript, 850);
  }

  function startListening() {
    if (!activeRef.current || !recognitionRef.current) return;
    finalTranscriptRef.current = "";
    setInterim("");
    setLivePhase("listening");
    try {
      recognitionRef.current.start();
    } catch {
      // Recognition may already be active after a browser restart event.
    }
  }

  useEffect(() => {
    const SpeechRecognition = getSpeechRecognition();
    setSupported(Boolean(SpeechRecognition));
    if (!secureOrigin || !SpeechRecognition) return undefined;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = language;

    recognition.onresult = (event) => {
      if (speakingRef.current) {
        cancelSpeech();
      }

      let nextFinal = "";
      let nextInterim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const transcript = event.results[index][0]?.transcript || "";
        if (event.results[index].isFinal) nextFinal += ` ${transcript}`;
        else nextInterim += ` ${transcript}`;
      }

      if (nextFinal.trim()) {
        finalTranscriptRef.current = normalizeSpokenText(
          `${finalTranscriptRef.current} ${nextFinal}`
        );
        setInterim("");
        scheduleSubmit();
        return;
      }

      setInterim(normalizeSpokenText(nextInterim));
    };

    recognition.onerror = (event) => {
      const messages = {
        "not-allowed": "Microphone permission was blocked.",
        "service-not-allowed": "Speech recognition is blocked for this origin.",
        "audio-capture": "No microphone was detected.",
        network: "Speech recognition service is unreachable.",
        "no-speech": "No speech was detected.",
      };
      setError(messages[event.error] || "Live voice failed.");
      if (activeRef.current && phaseRef.current !== "processing") {
        window.setTimeout(startListening, 450);
      }
    };

    recognition.onend = () => {
      if (
        activeRef.current &&
        phaseRef.current === "listening" &&
        !waitingForLiveReplyRef.current
      ) {
        window.setTimeout(startListening, 250);
      }
    };

    recognitionRef.current = recognition;
    return () => {
      recognition.abort();
      clearSubmitTimer();
      cancelSpeech();
    };
  }, []);

  useEffect(() => {
    if (!activeRef.current || !liveReply?.id || liveReply.id === lastReplyIdRef.current) return;
    lastReplyIdRef.current = liveReply.id;
    waitingForLiveReplyRef.current = false;

    const replyText = liveReply.text?.trim();
    if (!replyText) {
      startListening();
      return;
    }

    speak(replyText, {
      listenForInterrupt: true,
      afterSpeech: () => {
        if (activeRef.current) startListening();
      },
    });
  }, [liveReply]);

  useEffect(() => {
    if (running && activeRef.current && waitingForLiveReplyRef.current) {
      setLivePhase("processing");
    }
  }, [running]);

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

    activeRef.current = true;
    setActive(true);
    setError("");
    speak("Hola, dime en que te puedo ayudar.", {
      afterSpeech: startListening,
    });
  }

  async function handleInterrupt() {
    cancelSpeech();
    if (running || phaseRef.current === "processing") {
      await onInterruptRef.current?.();
    }
    waitingForLiveReplyRef.current = false;
    if (activeRef.current) startListening();
  }

  const labelByPhase = {
    idle: "Live voice",
    speaking: "Hablando",
    listening: interim || "Escuchando",
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
