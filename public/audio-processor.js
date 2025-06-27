class MicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.port.onmessage = () => {};
  }

  process(inputs) {
    const input = inputs[0][0]; // mono channel
    if (input) {
      const ulawData = new Uint8Array(input.length);
      for (let i = 0; i < input.length; i++) {
        ulawData[i] = encodeULaw(input[i] * 32767);
      }
      this.port.postMessage(ulawData.buffer, [ulawData.buffer]);
    }
    return true;
  }
}

function encodeULaw(sample) {
  const BIAS = 0x84;
  const CLIP = 32635;
  let sign = sample < 0 ? 0x80 : 0;
  if (sample < 0) sample = -sample;
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;

  let exponent = 7;
  for (
    let expMask = 0x4000;
    (sample & expMask) === 0 && exponent > 0;
    expMask >>= 1
  ) {
    exponent--;
  }

  const mantissa = (sample >> (exponent === 0 ? 4 : exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

registerProcessor("mic-processor", MicProcessor);
