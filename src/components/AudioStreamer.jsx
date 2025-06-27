import React, { useRef, useState } from "react";

const AudioStreamer = () => {
  const [isStreaming, setIsStreaming] = useState(false);

  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const workletNodeRef = useRef(null);
  const playbackQueue = useRef([]);
  const isPlayingRef = useRef(false);
  const wsUrl =
    process.env.NODE_ENV === "development"
      ? "ws://127.0.0.1:8000/twilio/media-stream"
      : "wss://callvio-backend-242251286144.asia-south1.run.app/twilio/media-stream";

  // === Audio decoding utilities ===
  const decodeULaw = (uVal) => {
    uVal = ~uVal;
    const sign = uVal & 0x80;
    const exponent = (uVal >> 4) & 0x07;
    const mantissa = uVal & 0x0f;
    let sample = ((mantissa << 3) + 0x84) << exponent;
    sample = sign ? 0x84 - sample : sample - 0x84;
    return sample / 32768;
  };

  const ulawToPCM = (ulawData) => {
    const pcm = new Float32Array(ulawData.length);
    for (let i = 0; i < ulawData.length; i++) {
      pcm[i] = decodeULaw(ulawData[i]);
    }
    return pcm;
  };

  // === Playback logic ===
  const enqueuePCM = (pcmData) => {
    playbackQueue.current.push(pcmData);
    processQueue();
  };

  const processQueue = () => {
    if (isPlayingRef.current || !playbackQueue.current.length) return;

    const context = audioContextRef.current;
    const pcmData = playbackQueue.current.shift();
    const buffer = context.createBuffer(1, pcmData.length, 8000);
    buffer.copyToChannel(pcmData, 0);

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    isPlayingRef.current = true;

    source.start();
    source.onended = () => {
      isPlayingRef.current = false;
      processQueue();
    };
  };

  // === Streaming logic ===
  const startStreaming = async () => {
    if (isStreaming) return; // 🛡️ Prevent multiple starts

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = async () => {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        const audioContext = new (window.AudioContext ||
          window.webkitAudioContext)({ sampleRate: 8000 });
        audioContextRef.current = audioContext;

        await audioContext.audioWorklet.addModule("/audio-processor.js");

        const micSource = audioContext.createMediaStreamSource(stream);
        const workletNode = new AudioWorkletNode(audioContext, "mic-processor");
        workletNodeRef.current = workletNode;

        workletNode.port.onmessage = ({ data }) => {
          const ulaw = new Uint8Array(data);
          const base64 = btoa(String.fromCharCode(...ulaw));

          // ✅ Check WebSocket state before sending
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                event: "media",
                media: { payload: base64, timestamp: Date.now() },
              })
            );
          }
        };

        micSource.connect(workletNode);
        workletNode.connect(audioContext.destination);

        ws.send(
          JSON.stringify({
            event: "start",
            start: { streamSid: "react-worklet-stream" },
          })
        );

        setIsStreaming(true);
      };

      ws.onmessage = ({ data }) => {
        const msg = JSON.parse(data);
        if (msg.event === "media" && msg.media?.payload) {
          const ulaw = Uint8Array.from(atob(msg.media.payload), (c) =>
            c.charCodeAt(0)
          );
          enqueuePCM(ulawToPCM(ulaw));
        }
      };

      ws.onerror = (e) => {
        console.error("WebSocket error:", e); // 🔥 Error handler
        stopStreaming();
      };

      ws.onclose = stopStreaming;
    } catch (err) {
      console.error("Error starting stream:", err);
      stopStreaming();
    }
  };

  const stopStreaming = () => {
    wsRef.current?.close();
    workletNodeRef.current?.disconnect();

    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close();
    }

    // 🧹 Reset all refs
    wsRef.current = null;
    workletNodeRef.current = null;
    audioContextRef.current = null;
    playbackQueue.current = [];
    isPlayingRef.current = false;

    setIsStreaming(false);
  };

  return (
    <div className="p-6 rounded-lg border max-w-md mx-auto mt-10 shadow bg-white">
      <p>ENV: {process.env.NODE_ENV}</p>
      <h2 className="text-xl font-bold mb-4">Smart AI Receptionist</h2>
      <button
        onClick={isStreaming ? stopStreaming : startStreaming}
        className={`px-4 py-2 rounded text-white ${
          isStreaming ? "bg-red-600" : "bg-green-600"
        }`}
      >
        {isStreaming ? "Stop" : "Start"}
      </button>
    </div>
  );
};

export default AudioStreamer;
