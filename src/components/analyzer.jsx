// acts as rendererer
// gets audioURL from app and handles everything related to sound and graphics
import React, { useEffect, useRef, useState, useMemo, useImperativeHandle, forwardRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Text, Line, Billboard } from "@react-three/drei";
import "./analyzer.css";
import * as THREE from "three";

function ScannerWave({ cubeSize, isPlayingRef, startTimeRef, durationRef, audioCtxRef, historyMatrix }) {
  const groupRef = useRef(null);
  const half = cubeSize / 2;
  const cols = historyMatrix.length > 0 && historyMatrix[0] ? historyMatrix[0].length : 0;
  const rows = historyMatrix.length;

  const maxAmplitude = useMemo(() => {
    let max = 0;
    for (let t = 0; t < rows; t++) {
      for (let f = 0; f < cols; f++) {
        if (historyMatrix[t][f] > max) max = historyMatrix[t][f];
      }
    }
    return max || 1;
  }, [historyMatrix, rows, cols]);

  const pointCount = Math.max(cols, 2);

  const { lineObj, glowObj, curtainMesh } = useMemo(() => {
    const material = new THREE.LineBasicMaterial({
      color: new THREE.Color("#ffffff"),
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const glowMaterial = new THREE.LineBasicMaterial({
      color: new THREE.Color("#88eeff"),
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const positions = new Float32Array(pointCount * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    const line = new THREE.Line(geo, material);
    line.visible = false;
    line.frustumCulled = false;

    const glow = new THREE.Line(geo, glowMaterial);
    glow.visible = false;
    glow.frustumCulled = false;

    const curtainPositions = new Float32Array(pointCount * 2 * 3);
    const curtainGeo = new THREE.BufferGeometry();
    curtainGeo.setAttribute("position", new THREE.BufferAttribute(curtainPositions, 3));

    const indices = [];
    for (let i = 0; i < pointCount - 1; i++) {
      const top = i * 2;
      const bottom = i * 2 + 1;
      const nextTop = (i + 1) * 2;
      const nextBottom = (i + 1) * 2 + 1;
      indices.push(top, bottom, nextTop);
      indices.push(bottom, nextBottom, nextTop);
    }
    curtainGeo.setIndex(indices);

    const curtainMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color("#88eeff"),
      transparent: true,
      opacity: 0.15,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const curtain = new THREE.Mesh(curtainGeo, curtainMat);
    curtain.visible = false;
    curtain.frustumCulled = false;

    return { lineObj: line, glowObj: glow, curtainMesh: curtain };
  }, [pointCount]);

  useFrame(() => {
    if (!isPlayingRef.current || !audioCtxRef.current || rows === 0 || cols === 0) {
      lineObj.visible = false;
      glowObj.visible = false;
      curtainMesh.visible = false;
      return;
    }

    const elapsed = audioCtxRef.current.currentTime - startTimeRef.current;
    const duration = durationRef.current;

    if (elapsed > duration) {
      lineObj.visible = false;
      glowObj.visible = false;
      curtainMesh.visible = false;
      return;
    }

    const progress = elapsed / duration; 
    const timeIndex = Math.min(Math.floor(progress * rows), rows - 1);

    // Wave starts at the front (+half) and moves to the back (-half) along Z
    const currentZ = half - (progress * cubeSize);

    const linePositions = lineObj.geometry.attributes.position.array;
    const curtainPositions = curtainMesh.geometry.attributes.position.array;

    for (let f = 0; f < pointCount; f++) {
      const freqRatio = f / (pointCount - 1);
      const freqIndex = Math.min(Math.floor(freqRatio * (cols - 1)), cols - 1);
      const amplitude = historyMatrix[timeIndex] ? historyMatrix[timeIndex][freqIndex] : 0;
      const normalized = amplitude / maxAmplitude;
      const height = normalized * (cubeSize * 0.7);

      // Frequencies spread left (-half) to right (+half) along X
      const worldX = -half + freqRatio * cubeSize;

      linePositions[f * 3]     = worldX;
      linePositions[f * 3 + 1] = height + 0.05; 
      linePositions[f * 3 + 2] = currentZ;

      const ci = f * 2;
      curtainPositions[ci * 3]     = worldX;
      curtainPositions[ci * 3 + 1] = height + 0.05;
      curtainPositions[ci * 3 + 2] = currentZ;

      curtainPositions[(ci + 1) * 3]     = worldX;
      curtainPositions[(ci + 1) * 3 + 1] = 0;
      curtainPositions[(ci + 1) * 3 + 2] = currentZ;
    }

    lineObj.geometry.attributes.position.needsUpdate = true;
    lineObj.geometry.computeBoundingBox();
    lineObj.geometry.computeBoundingSphere();

    curtainMesh.geometry.attributes.position.needsUpdate = true;
    curtainMesh.geometry.computeBoundingBox();
    curtainMesh.geometry.computeBoundingSphere();

    lineObj.visible = true;
    glowObj.visible = true;
    curtainMesh.visible = true;
  });

  return (
    <group ref={groupRef}>
      <primitive object={lineObj} />
      <primitive object={glowObj} />
      <primitive object={curtainMesh} />
    </group>
  );
}

// Compute spectrogram directly from raw PCM data
function precomputeSpectrogram(audioBuffer) {
  const channelData = audioBuffer.getChannelData(0);
  const fftSize = 1024;          // larger window = smoother
  const binCount = fftSize / 2;
  const sampleCount = 128;
  const hopSize = Math.floor(channelData.length / sampleCount);

  // Downsample frequency bins to match time resolution
  // This makes a square grid (128 × 128) instead of (128 × 512)
  const outputBins = 128;
  const binsPerGroup = Math.floor(binCount / outputBins);

  const rawMatrix = [];

  for (let i = 0; i < sampleCount; i++) {
    const start = i * hopSize;
    const padded = new Float32Array(fftSize);
    const end = Math.min(start + fftSize, channelData.length);
    for (let j = start; j < end; j++) {
      padded[j - start] = channelData[j];
    }

    // Apply Hann window
    for (let n = 0; n < fftSize; n++) {
      padded[n] *= 0.5 * (1 - Math.cos((2 * Math.PI * n) / (fftSize - 1)));
    }

    // Simple DFT to get magnitude spectrum (full resolution)
    const fullMagnitudes = new Array(binCount);
    for (let k = 0; k < binCount; k++) {
      let real = 0;
      let imag = 0;
      for (let n = 0; n < fftSize; n++) {
        const angle = (2 * Math.PI * k * n) / fftSize;
        real += padded[n] * Math.cos(angle);
        imag -= padded[n] * Math.sin(angle);
      }
      const magnitude = Math.sqrt(real * real + imag * imag);
      fullMagnitudes[k] = Math.min(255, Math.log10(magnitude + 1) * 40);
    }

    // Downsample: average groups of frequency bins into outputBins
    const magnitudes = new Array(outputBins);
    for (let b = 0; b < outputBins; b++) {
      let sum = 0;
      const startBin = b * binsPerGroup;
      const endBin = Math.min(startBin + binsPerGroup, binCount);
      for (let k = startBin; k < endBin; k++) {
        sum += fullMagnitudes[k];
      }
      magnitudes[b] = sum / (endBin - startBin);
    }

    rawMatrix.push(magnitudes);
  }

  // Smoothing each row across time using a moving average (blend neighbors)
  const smoothed = [];
  const windowSize = 6; // how many neighbors to average

  for (let i = 0; i < rawMatrix.length; i++) {
    const blended = new Array(outputBins);
    for (let k = 0; k < outputBins; k++) {
      let sum = 0;
      let count = 0;
      for (let offset = -windowSize; offset <= windowSize; offset++) {
        const idx = i + offset;
        if (idx >= 0 && idx < rawMatrix.length) {
          sum += rawMatrix[idx][k];
          count++;
        }
      }
      blended[k] = sum / count;
    }
    smoothed.push(blended);
  }

  // Also smooth across frequency bins to reduce jaggedness
  const finalMatrix = [];
  const freqWindow = 5;

  for (let i = 0; i < smoothed.length; i++) {
    const row = new Array(outputBins);
    for (let k = 0; k < outputBins; k++) {
      let sum = 0;
      let count = 0;
      for (let offset = -freqWindow; offset <= freqWindow; offset++) {
        const idx = k + offset;
        if (idx >= 0 && idx < outputBins) {
          sum += smoothed[i][idx];
          count++;
        }
      }
      row[k] = sum / count;
    }
    finalMatrix.push(row);
  }

  return finalMatrix;
}

// Evenly spaced "nice" tick values from 0 up to max (at most ~6 of them)
function niceTicks(max, steps) {
  if (!max || max <= 0) return [];
  const step = steps.find((st) => max / st <= 6) ?? steps[steps.length - 1];
  const ticks = [];
  for (let v = 0; v <= max + 1e-9; v += step) ticks.push(v);
  return ticks;
}

// 3D axis cage that surrounds the terrain.
// Frequency runs along the front-left edge, time along the front-right edge,
// and every label is a billboard so it always faces the camera.
function AxisCage({ size, duration, maxFrequency }) {
  const half = size / 2;
  const h = size;

  const axisColor = "#d9d3bd";
  const tickColor = "#aaaaaa";
  const lineColor = "#555555";

  const freqTicks = niceTicks(maxFrequency / 1000, [1, 2, 5, 10]);
  const timeTicks = niceTicks(duration, [0.1, 0.2, 0.25, 0.5, 1, 2]);
  const timeDecimals = timeTicks.some((t) => Math.round(t * 100) % 10 !== 0) ? 2 : 1;
  const heightLines = [0.25, 0.5, 0.75, 1];

  return (
    <group>
      <Line points={[[-half, 0, half], [half, 0, half]]} color={axisColor} lineWidth={2} />
      <Line points={[[-half, 0, half], [-half, h, half]]} color={axisColor} lineWidth={2} />
      <Line points={[[half, 0, half], [half, 0, -half]]} color={axisColor} lineWidth={2} />

      <Billboard position={[0, -2.2, half + 3]}>
        <Text fontSize={1.1} color={axisColor} anchorX="center" anchorY="middle">Frequency (kHz)</Text>
      </Billboard>
      <Billboard position={[-half - 1.6, h / 2, half]}>
        <Text fontSize={1.1} color={axisColor} anchorX="center" anchorY="middle" rotation={[0, 0, Math.PI / 2]}>Amplitude</Text>
      </Billboard>
      <Billboard position={[half + 3, -2.2, 0]}>
        <Text fontSize={1.1} color={axisColor} anchorX="center" anchorY="middle">Time (s)</Text>
      </Billboard>

      {freqTicks.map((khz) => {
        const x = -half + (khz / (maxFrequency / 1000)) * size;
        return (
          <group key={`f-${khz}`}>
            <Line points={[[x, 0, half], [x, 0, half + 0.4]]} color={lineColor} lineWidth={1} />
            <Line points={[[x, 0, half], [x, 0, -half]]} color={lineColor} lineWidth={0.5} transparent opacity={0.2} />
            <Billboard position={[x, -0.2, half + 1]}>
              <Text fontSize={0.65} color={tickColor} anchorX="center" anchorY="middle">{khz}</Text>
            </Billboard>
          </group>
        );
      })}

      {heightLines.map((t) => {
        const y = t * h;
        return (
          <Line key={`a-${t}`} points={[[-half, y, half], [half, y, half]]} color={lineColor} lineWidth={0.5} transparent opacity={0.2} />
        );
      })}

      {timeTicks.map((sec) => {
        const z = half - (sec / duration) * size;
        return (
          <group key={`t-${sec}`}>
            <Line points={[[half, 0, z], [half + 0.4, 0, z]]} color={lineColor} lineWidth={1} />
            <Line points={[[half, 0, z], [-half, 0, z]]} color={lineColor} lineWidth={0.5} transparent opacity={0.2} />
            <Billboard position={[half + 1, -0.2, z]}>
              <Text fontSize={0.65} color={tickColor} anchorX="center" anchorY="middle">{sec.toFixed(timeDecimals)}</Text>
            </Billboard>
          </group>
        );
      })}

      <Line points={[[-half, 0, half], [-half, 0, -half]]} color={lineColor} lineWidth={0.5} transparent opacity={0.3} />
      <Line points={[[half, 0, -half], [-half, 0, -half]]} color={lineColor} lineWidth={0.5} transparent opacity={0.3} />
      <Line points={[[-half, h, half], [half, h, half]]} color={lineColor} lineWidth={0.5} transparent opacity={0.3} />
      <Line points={[[-half, h, half], [-half, h, -half]]} color={lineColor} lineWidth={0.5} transparent opacity={0.3} />
      <Line points={[[half, h, half], [half, h, -half]]} color={lineColor} lineWidth={0.5} transparent opacity={0.3} />
      <Line points={[[half, h, -half], [-half, h, -half]]} color={lineColor} lineWidth={0.5} transparent opacity={0.3} />
      <Line points={[[half, 0, half], [half, h, half]]} color={lineColor} lineWidth={0.5} transparent opacity={0.3} />
      <Line points={[[half, 0, -half], [half, h, -half]]} color={lineColor} lineWidth={0.5} transparent opacity={0.3} />
      <Line points={[[-half, 0, -half], [-half, h, -half]]} color={lineColor} lineWidth={0.5} transparent opacity={0.3} />
    </group>
  );
}

function SoundTerrain({ historyMatrix, terrainColors, cubeSize, isPlayingRef, startTimeRef, durationRef, audioCtxRef, revealRef }) {
  const meshRef = useRef(null);

  // Clips away everything the scanner has not passed yet (keeps z >= scanner z)
  const clipPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), []);

  useFrame(() => {
    if (!meshRef.current) return;
    let reveal = revealRef.current;
    if (isPlayingRef.current && audioCtxRef.current && durationRef.current > 0) {
      const elapsed = audioCtxRef.current.currentTime - startTimeRef.current;
      reveal = Math.min(Math.max(elapsed / durationRef.current, 0), 1);
    }
    meshRef.current.visible = reveal > 0;
    const scannerZ = cubeSize / 2 - reveal * cubeSize;
    clipPlane.constant = -scannerZ + 0.01;
  });

  // Dimensions derived from the matrix
  const rows = historyMatrix.length;
  const cols = rows > 0 && historyMatrix[0] ? historyMatrix[0].length : 0;
  const widthSegs = rows > 1 ? rows - 1 : 1;
  const heightSegs = cols > 1 ? cols - 1 : 1;

  const geoKey = `${widthSegs}-${heightSegs}`;

  useEffect(() => {
    if (!meshRef.current) return;
    if (!historyMatrix || historyMatrix.length === 0) return;

    const frame = requestAnimationFrame(() => {
      const geometry = meshRef.current?.geometry;
      if (!geometry) return;

      const vertices = geometry.attributes.position.array;
      let maxAmplitude = 0;
      for (let time = 0; time < rows; time++) {
        for (let freq = 0; freq < cols; freq++) {
          if (historyMatrix[time][freq] > maxAmplitude) {
            maxAmplitude = historyMatrix[time][freq];
          }
        }
      }
      if (maxAmplitude === 0) maxAmplitude = 1;

      const colors = new Float32Array(vertices.length);

      const tempColor = new THREE.Color();
      const baseColor = new THREE.Color();
      const white = new THREE.Color("#ffffff");

      const isDualType = terrainColors.length >= 2;
      const colorA = new THREE.Color(terrainColors[0]);
      const colorB = isDualType ? new THREE.Color(terrainColors[1]) : null;

      for (let time = 0; time < rows; time++) {
        for (let freq = 0; freq < cols; freq++) {
          
          // Plane rows run back to front, so the last row is the start of the cry.
          // That puts time 0 at the front, where the scanner starts.
          const vi = (rows - 1 - time) * cols + freq;
          
          const zIndex = vi * 3 + 2;

          if (zIndex < vertices.length) {
            const amplitude = historyMatrix[time][freq];

            const normalized = maxAmplitude > 0 ? (amplitude / maxAmplitude) : 0;
            const height = normalized * (cubeSize * 0.7);
            vertices[zIndex] = height;

            // Type colour: for dual types, blend across the frequency axis (low freq = type1, high freq = type2)
            baseColor.copy(colorA);
            if (isDualType) {
              baseColor.lerp(colorB, freq / (cols - 1));
            }

            // Ramp from a darker shade on the floor to a lighter tint at the peaks
            const ramp = Math.pow(normalized, 0.8);
            tempColor.copy(baseColor).multiplyScalar(0.5 + 0.5 * ramp);
            tempColor.lerp(white, 0.15 * ramp);

            colors[vi * 3] = tempColor.r;
            colors[vi * 3 + 1] = tempColor.g;
            colors[vi * 3 + 2] = tempColor.b;
          }
        }
      }
      
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      geometry.attributes.position.needsUpdate = true;
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
    });

    return () => cancelAnimationFrame(frame);
  }, [historyMatrix, rows, cols, cubeSize, terrainColors]);

  return (
    <mesh
      key={geoKey}
      ref={meshRef}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0, 0]}
    >
      <planeGeometry
        args={[cubeSize, cubeSize, widthSegs, heightSegs]}
        onUpdate={(geo) => {
          geo.translate(0, 0, 0); 
        }}
      />
      <meshStandardMaterial
        vertexColors={true}
        color="#ffffff"
        side={THREE.DoubleSide}
        clippingPlanes={[clipPlane]}
        metalness={0.1} // Lowered to prevent black mirror effect
        roughness={0.6} // Increased to diffuse the light better
      />
    </mesh>
  );
}

const Analyzer = forwardRef(function Analyzer({ audioUrl, terrainColors }, ref) {
  const audioCtxRef = useRef(null);
  const audioBufferRef = useRef(null);
  const [historyMatrix, setHistoryMatrix] = useState([]);
  // playback ref for a wave
  const isPlayingRef = useRef(false);
  const playbackStartTimeRef = useRef(0);
  const playbackDurationRef = useRef(0);
  const sourceRef = useRef(null);
  // 0 = terrain hidden, 1 = fully revealed (while playing, the scanner position is used instead)
  const revealRef = useRef(0);
  const [hasPlayed, setHasPlayed] = useState(false);
  // real-world extent of the graph, for the axis labels
  const [audioInfo, setAudioInfo] = useState({ duration: 0, maxFrequency: 0 });


  // Single size constant for all 3 axes
  const cubeSize = 18;

  useEffect(() => {
    return () => {
      //cleans up on unmount
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
      }
    };
  }, []);

  // fetch and calculat the graph the moment a new audioURL arrives
  useEffect(() => {
    if(!audioUrl){
      console.log("No audio URL provided to Analyzer.");
      return;
    }
    if(!audioCtxRef.current){
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }

    // clear the old graph while the new one calculates
    setHistoryMatrix([]);
    setHasPlayed(false);
    revealRef.current = 0;
    isPlayingRef.current = false;
    audioBufferRef.current = null;
    if (sourceRef.current) {
      sourceRef.current.onended = null;
      sourceRef.current.stop();
      sourceRef.current = null;
    }

    fetch(audioUrl)
      .then((response) => response.arrayBuffer())
      .then((buffer) => audioCtxRef.current.decodeAudioData(buffer))
      .then((audioBuffer) => {
        // 1. Save the audio to play later
        audioBufferRef.current = audioBuffer; 
        
        // 2. Precompute the graph immediately!
        const matrix = precomputeSpectrogram(audioBuffer);
        setHistoryMatrix(matrix);
        setAudioInfo({ duration: audioBuffer.duration, maxFrequency: audioBuffer.sampleRate / 2 });
      })
      .catch((error) => console.error("Error analyzing the audio:", error));
  }, [audioUrl]); 

  // this function handles playing the sound
  function playAudio() {
    if(!audioBufferRef.current || !audioCtxRef.current){
      console.log("Audio not ready to play.");
      return;
    }

    if(audioCtxRef.current.state === "suspended"){
      audioCtxRef.current.resume();
    }
    
    // restart cleanly if the cry is already playing
    if (sourceRef.current) {
      sourceRef.current.onended = null;
      sourceRef.current.stop();
    }

    const sourceNode = audioCtxRef.current.createBufferSource();
    sourceRef.current = sourceNode;
    sourceNode.buffer = audioBufferRef.current;
    sourceNode.connect(audioCtxRef.current.destination);
    
    // scanner logic
    playbackDurationRef.current = audioBufferRef.current.duration;
    // audioCtx.currentTime keeps a continuous clock of how long the context has existed
    playbackStartTimeRef.current = audioCtxRef.current.currentTime; 
    isPlayingRef.current = true;

    sourceNode.onended = () => {
      isPlayingRef.current = false;
      revealRef.current = 1;
      sourceRef.current = null;
    };
    setHasPlayed(true);
    
    sourceNode.start(0);
  }

  useImperativeHandle(ref, () => ({
    playAudio,
  }));

  const half = cubeSize / 2;

  return (
    <div className="analyzer-wrapper">
      <div className="canvas-wrapper">
        {historyMatrix.length === 0 && (
          <p className="canvas-status">Tuning in to a wild cry…</p>
        )}
        {historyMatrix.length > 0 && !hasPlayed && (
          <p className="canvas-status">Press Play Audio to scan the cry</p>
        )}
        <Canvas
          camera={{
            position: [cubeSize * 1.8, cubeSize * 1.0, cubeSize * 1.8],
            fov: 40,
          }}
          onCreated={({ gl }) => {
            gl.localClippingEnabled = true;
          }}
        >
          <ambientLight intensity={0.9} />
          <directionalLight position={[10, 20, 10]} intensity={1.6} />
          <pointLight position={[-10, 10, -10]} intensity={0.5} />

          <OrbitControls target={[0, cubeSize * 0.35, 0]} />

          <AxisCage size={cubeSize} duration={audioInfo.duration} maxFrequency={audioInfo.maxFrequency} />

          <SoundTerrain
            historyMatrix={historyMatrix}
            terrainColors={terrainColors}
            cubeSize={cubeSize}
            isPlayingRef={isPlayingRef}
            startTimeRef={playbackStartTimeRef}
            durationRef={playbackDurationRef}
            audioCtxRef={audioCtxRef}
            revealRef={revealRef}
          />

          <ScannerWave 
            cubeSize={cubeSize}
            isPlayingRef={isPlayingRef}
            startTimeRef={playbackStartTimeRef}
            durationRef={playbackDurationRef}
            audioCtxRef={audioCtxRef}
            historyMatrix={historyMatrix}
          />
        </Canvas>
      </div>
      <div className="bezel-label" aria-hidden="true">
        <span className="led led-red" />
        <span>Cry scan</span>
      </div>
    </div>
  );
});

export default Analyzer;