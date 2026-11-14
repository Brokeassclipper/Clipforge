
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
import './style.css';

const upload = document.getElementById('upload');
const video = document.getElementById('video');
const start = document.getElementById('start');
const end = document.getElementById('end');
const clips = document.getElementById('clips');
const status = document.getElementById('status');
const videoInfo = document.getElementById('videoInfo');
const transcriptInput = document.getElementById('transcript');
const findHighlights = document.getElementById('findHighlights');
const highlightStatus = document.getElementById('highlightStatus');
const suggestions = document.getElementById('suggestions');

let videoURL = null;
let clipList = [];
let activeClip = null;
let ffmpeg = null;
let ffmpegLoading = false;
let ffmpegReady = false;
let exporting = false;

function setStatus(message) {
  status.textContent = message;
}

upload.addEventListener('change', () => {
  const file = upload.files?.[0];
  if (!file) return;

  if (videoURL) URL.revokeObjectURL(videoURL);
  videoURL = URL.createObjectURL(file);
  video.src = videoURL;
  video.hidden = false;
  videoInfo.textContent = `${file.name} • ${(file.size / 1048576).toFixed(1)} MB`;
  clipList = [];
  activeClip = null;
  renderClips();
  setStatus('Video loaded successfully. Add a clip to begin.');
});

document.getElementById('setStart').addEventListener('click', () => {
  if (!videoURL) return alert('Upload a video first.');
  start.value = video.currentTime.toFixed(1);
});

document.getElementById('setEnd').addEventListener('click', () => {
  if (!videoURL) return alert('Upload a video first.');
  end.value = video.currentTime.toFixed(1);
});

document.getElementById('addClip').addEventListener('click', () => {
  if (!videoURL) return alert('Upload a video first.');
  const s = Number(start.value);
  const e = Number(end.value);

  if (!Number.isFinite(s) || !Number.isFinite(e) ||
      s < 0 || e <= s || e > video.duration) {
    return alert('Please enter valid start and end times within the video.');
  }

  clipList.push({ start: s, end: e });
  renderClips();
  setStatus(`Clip ${clipList.length} added to your list.`);
});

// Convert timestamps into seconds.
function parseTimestamp(value) {
  const parts = value.split(':').map(Number);

  if (parts.some(part => !Number.isFinite(part))) return null;

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  return null;
}

// Detect exciting moments using simple local rules.
function scoreMoment(text) {
  const lower = text.toLowerCase();
  let score = 0;
  const reasons = [];

  const excitement = [
    'what', 'no way', 'oh my god', 'omg', 'wait',
    'holy', 'insane', 'crazy', 'unbelievable',
    'amazing', 'wow', 'bro', 'dude'
  ];

  const reactions = [
    'laugh', 'hahaha', 'lmao', 'screaming',
    'shocked', 'surprised', 'suddenly'
  ];

  const strongEvents = [
    'died', 'killed', 'explosion', 'crashed',
    'destroyed', 'won', 'lost', 'betrayed',
    'clutch', 'jump scare', 'jumped'
  ];

  for (const word of excitement) {
    if (lower.includes(word)) {
      score += 10;
      reasons.push('Exciting reaction');
      break;
    }
  }

  for (const word of reactions) {
    if (lower.includes(word)) {
      score += 15;
      reasons.push('Emotional reaction');
      break;
    }
  }

  for (const word of strongEvents) {
    if (lower.includes(word)) {
      score += 20;
      reasons.push('Major event');
      break;
    }
  }

  if (text.includes('!')) {
    score += 10;
    reasons.push('Exclamation');
  }

  if (text.includes('?')) {
    score += 5;
    reasons.push('Curiosity');
  }

  if (text.length > 60) score += 5;

  return {
    score: Math.min(score, 100),
    reasons: [...new Set(reasons)]
  };
}

function parseTranscript(text) {
  const lines = text.split('\n');
  const entries = [];

  for (const line of lines) {
    const match = line.match(
      /^\s*\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*(?:[-–]\s*)?(.+)$/
    );

    if (!match) continue;

    const time = parseTimestamp(match[1]);
    const words = match[2].trim();

    if (time === null || !words) continue;

    entries.push({ time, text: words });
  }

  return entries.sort((a, b) => a.time - b.time);
}

function detectHighlights(entries) {
  const candidates = [];

  entries.forEach((entry, index) => {
    const result = scoreMoment(entry.text);

    if (result.score < 20) return;

    const previous = entries[index - 1];
    const next = entries[index + 1];

    const contextStart = previous
      ? previous.time
      : Math.max(0, entry.time - 8);

    const contextEnd = next
      ? next.time + 8
      : entry.time + 15;

    const clipStart = Math.max(0, Math.min(contextStart, entry.time - 10));
    const clipEnd = Math.max(entry.time + 10, contextEnd);

    candidates.push({
      start: clipStart,
      end: clipEnd,
      score: result.score,
      title: entry.text,
      reason: result.reasons.join(' • ')
    });
  });

  // Keep the strongest suggestions and remove overlaps.
  candidates.sort((a, b) => b.score - a.score);

  const kept = [];

  for (const candidate of candidates) {
    const overlaps = kept.some(existing => {
      const overlap = Math.min(candidate.end, existing.end) -
        Math.max(candidate.start, existing.start);

      return overlap > 0 &&
        overlap > 0.5 * (candidate.end - candidate.start);
    });

    if (!overlaps) kept.push(candidate);
  }

  return kept.sort((a, b) => a.start - b.start).slice(0, 10);
}

function renderSuggestions(highlights) {
  suggestions.replaceChildren();

  if (!highlights.length) {
    suggestions.textContent =
      'No strong highlights found. Try a transcript with more reactions or exciting moments.';
    return;
  }

  highlights.forEach((item, index) => {
    const card = document.createElement('article');
    card.className = 'clip';

    const title = document.createElement('strong');
    title.textContent = `Highlight ${index + 1}: ${item.title}`;

    const timing = document.createElement('p');
    timing.className = 'small';
    timing.textContent =
      `${item.start.toFixed(1)}s – ${item.end.toFixed(1)}s`;

    const rating = document.createElement('p');
    rating.className = 'small';
    rating.textContent =
      `Excitement score: ${item.score}/100 • ${item.reason}`;

    const button = document.createElement('button');
    button.textContent = 'Use this highlight';

    button.addEventListener('click', () => {
      if (!videoURL) {
        highlightStatus.textContent = 'Upload a video first.';
        return;
      }

      if (Number.isFinite(video.duration) && item.start >= video.duration) {
        highlightStatus.textContent =
          'This timestamp is beyond the uploaded video.';
        return;
      }

      start.value = item.start.toFixed(1);
      end.value = Math.min(item.end, video.duration).toFixed(1);
      video.currentTime = Number(start.value);
      video.scrollIntoView({ behavior: 'smooth', block: 'center' });
      highlightStatus.textContent =
        'Highlight loaded into the clip editor. Preview and add it!';
    });

    card.append(title, timing, rating, button);
    suggestions.append(card);
  });
}

findHighlights.addEventListener('click', () => {
  const entries = parseTranscript(transcriptInput.value);

  if (!entries.length) {
    highlightStatus.textContent =
      'No timestamps found. Use formats like [02:14] or [00:02:14].';
    suggestions.replaceChildren();
    return;
  }

  const highlights = detectHighlights(entries);
  renderSuggestions(highlights);

  highlightStatus.textContent =
    `Analysed ${entries.length} transcript lines. Found ${highlights.length} suggestions.`;
});

function renderClips() {
  clips.replaceChildren();

  if (!clipList.length) {
    const empty = document.createElement('p');
    empty.className = 'small';
    empty.textContent = 'Your selected clips will appear here.';
    clips.append(empty);
    return;
  }

  clipList.forEach((clip, index) => {
    const item = document.createElement('article');
    item.className = 'clip';

    const title = document.createElement('strong');
    title.textContent = `Clip ${index + 1}`;

    const timing = document.createElement('p');
    timing.className = 'small';
    timing.textContent =
      `${clip.start.toFixed(1)}s – ${clip.end.toFixed(1)}s (${(clip.end - clip.start).toFixed(1)} seconds)`;

    const preview = document.createElement('button');
    preview.className = 'secondary';
    preview.textContent = '▶ Preview clip';
    preview.addEventListener('click', () => playClip(index));

    const exportButton = document.createElement('button');
    exportButton.className = 'export-button';
    exportButton.textContent = '⬇ Export MP4';
    exportButton.disabled = exporting;
    exportButton.addEventListener('click', () => exportClip(index, exportButton));

    item.append(title, timing, preview, exportButton);
    clips.append(item);
  });
}

function playClip(index) {
  activeClip = clipList[index];
  video.currentTime = activeClip.start;
  video.play().catch(() =>
    setStatus('Tap play on the video preview to start playback.')
  );
}

video.addEventListener('timeupdate', () => {
  if (activeClip && video.currentTime >= activeClip.end) {
    video.pause();
    activeClip = null;
  }
});

async function loadFFmpeg() {
  if (ffmpegReady) return ffmpeg;
  if (ffmpegLoading) {
    throw new Error('The video engine is already loading. Please wait.');
  }

  ffmpegLoading = true;
  setStatus('Loading the video engine for the first time (~31 MB). Keep this page open…');

  try {
    ffmpeg = new FFmpeg();
    ffmpeg.on('log', ({ message }) => {
      if (message && /error|failed/i.test(message)) {
        console.warn('FFmpeg:', message);
      }
    });

    const coreBase =
      'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';

    await ffmpeg.load({
      coreURL: await toBlobURL(`${coreBase}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${coreBase}/ffmpeg-core.wasm`, 'application/wasm')
    });

    ffmpegReady = true;
    return ffmpeg;
  } catch (error) {
    ffmpeg = null;
    ffmpegReady = false;
    throw new Error(
      `Could not load the video engine. Check your connection and try again. (${error.message})`
    );
  } finally {
    ffmpegLoading = false;
  }
}

function safeExtension(filename) {
  const match = filename.toLowerCase().match(/\.([a-z0-9]{2,5})$/);
  return match ? match[1] : 'mp4';
}

async function exportClip(index, button) {
  if (exporting) return;

  const file = upload.files?.[0];
  const clip = clipList[index];

  if (!file || !clip) {
    return setStatus('Upload a video and select a clip first.');
  }

  exporting = true;
  renderClips();
  button.disabled = true;

  try {
    const engine = await loadFFmpeg();
    setStatus(`Preparing Clip ${index + 1}…`);

    const inputName = `clipforge_input.${safeExtension(file.name)}`;
    const outputName = `clipforge_clip_${index + 1}.mp4`;

    await engine.writeFile(
      inputName,
      new Uint8Array(await file.arrayBuffer())
    );

    setStatus(`Exporting Clip ${index + 1}. Keep ClipForge open…`);

    await engine.exec([
      '-i', inputName,
      '-ss', clip.start.toFixed(3),
      '-t', (clip.end - clip.start).toFixed(3),
      '-map', '0:v:0',
      '-map', '0:a?',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '23',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      outputName
    ]);

    const data = await engine.readFile(outputName);
    const blob = new Blob([data], { type: 'video/mp4' });
    const downloadURL = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = downloadURL;
    link.download = `ClipForge-clip-${index + 1}.mp4`;
    document.body.append(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(downloadURL), 60000);

    await engine.deleteFile(inputName).catch(() => {});
    await engine.deleteFile(outputName).catch(() => {});

    setStatus(
      `Clip ${index + 1} exported. Check Safari Downloads or the Files app.`
    );
  } catch (error) {
    console.error(error);
    setStatus(
      error.message || 'Export failed. Try a shorter clip or a smaller video.'
    );
  } finally {
    exporting = false;
    renderClips();
  }
}
