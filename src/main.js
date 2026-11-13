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
  if (!Number.isFinite(s) || !Number.isFinite(e) || s < 0 || e <= s || e > video.duration) {
    return alert('Please enter valid start and end times within the video.');
  }
  clipList.push({ start: s, end: e });
  renderClips();
  setStatus(`Clip ${clipList.length} added to your list.`);
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
    timing.textContent = `${clip.start.toFixed(1)}s – ${clip.end.toFixed(1)}s (${(clip.end - clip.start).toFixed(1)} seconds)`;

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
  video.play().catch(() => setStatus('Tap play on the video preview to start playback.'));
}

video.addEventListener('timeupdate', () => {
  if (activeClip && video.currentTime >= activeClip.end) {
    video.pause();
    activeClip = null;
  }
});

async function loadFFmpeg() {
  if (ffmpegReady) return ffmpeg;
  if (ffmpegLoading) throw new Error('The video engine is already loading. Please wait.');
  ffmpegLoading = true;
  setStatus('Loading the video engine for the first time (~31 MB). Keep this page open…');

  try {
    ffmpeg = new FFmpeg();
    ffmpeg.on('log', ({ message }) => {
      if (message && /error|failed/i.test(message)) console.warn('FFmpeg:', message);
    });

    const coreBase = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';
    await ffmpeg.load({
      coreURL: await toBlobURL(`${coreBase}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${coreBase}/ffmpeg-core.wasm`, 'application/wasm')
    });
    ffmpegReady = true;
    return ffmpeg;
  } catch (error) {
    ffmpeg = null;
    ffmpegReady = false;
    throw new Error(`Could not load the video engine. Check your connection and try again. (${error.message})`);
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
  if (!file || !clip) return setStatus('Upload a video and select a clip first.');

  exporting = true;
  renderClips();
  button.disabled = true;

  try {
    const engine = await loadFFmpeg();
    setStatus(`Preparing Clip ${index + 1}…`);

    const inputName = `clipforge_input.${safeExtension(file.name)}`;
    const outputName = `clipforge_clip_${index + 1}.mp4`;

    await engine.writeFile(inputName, new Uint8Array(await file.arrayBuffer()));
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
    setStatus(`Clip ${index + 1} exported. Check Safari Downloads or the Files app.`);
  } catch (error) {
    console.error(error);
    setStatus(error.message || 'Export failed. Try a shorter clip or a smaller video.');
  } finally {
    exporting = false;
    renderClips();
  }
}