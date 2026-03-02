/**
 * 影片/音訊轉換器
 * 使用 FFmpeg.wasm 在瀏覽器中進行轉換
 */

// 格式設定
const FORMAT_CONFIG = {
    mp4: { type: 'video', ext: 'mp4' },
    webm: { type: 'video', ext: 'webm' },
    avi: { type: 'video', ext: 'avi' },
    mkv: { type: 'video', ext: 'mkv' },
    mov: { type: 'video', ext: 'mov' },
    gif: { type: 'video', ext: 'gif' },
    mp3: { type: 'audio', ext: 'mp3' },
    wav: { type: 'audio', ext: 'wav' },
    aac: { type: 'audio', ext: 'aac' },
    ogg: { type: 'audio', ext: 'ogg' },
    flac: { type: 'audio', ext: 'flac' },
    m4a: { type: 'audio', ext: 'm4a' },
};

const QUALITY_SETTINGS = {
    high: { video: '-crf 18', audio: '-b:a 320k' },
    medium: { video: '-crf 23', audio: '-b:a 192k' },
    low: { video: '-crf 28', audio: '-b:a 128k' },
};

let ffmpeg = null;
let currentFile = null;
let outputBlob = null;
let outputFileName = null;
let ffmpegLoaded = false;

const elements = {
    loadingOverlay: document.getElementById('loadingOverlay'),
    dropzone: document.getElementById('dropzone'),
    fileInput: document.getElementById('fileInput'),
    fileInfo: document.getElementById('fileInfo'),
    fileIcon: document.getElementById('fileIcon'),
    fileName: document.getElementById('fileName'),
    fileMeta: document.getElementById('fileMeta'),
    removeFile: document.getElementById('removeFile'),
    convertSection: document.getElementById('convertSection'),
    outputFormat: document.getElementById('outputFormat'),
    quality: document.getElementById('quality'),
    resolution: document.getElementById('resolution'),
    fps: document.getElementById('fps'),
    audioBitrate: document.getElementById('audioBitrate'),
    extractAudio: document.getElementById('extractAudio'),
    convertBtn: document.getElementById('convertBtn'),
    progressSection: document.getElementById('progressSection'),
    progressFill: document.getElementById('progressFill'),
    progressText: document.getElementById('progressText'),
    progressDetail: document.getElementById('progressDetail'),
    downloadSection: document.getElementById('downloadSection'),
    outputInfo: document.getElementById('outputInfo'),
    downloadBtn: document.getElementById('downloadBtn'),
    newConvert: document.getElementById('newConvert'),
    errorSection: document.getElementById('errorSection'),
    errorMessage: document.getElementById('errorMessage'),
    retryBtn: document.getElementById('retryBtn'),
};

async function toBlobURL(url, mimeType) {
    const response = await fetch(url);
    const buf = await response.arrayBuffer();
    const blob = new Blob([buf], { type: mimeType });
    return URL.createObjectURL(blob);
}

async function initFFmpeg() {
    try {
        const { createFFmpeg, fetchFile: ff } = FFmpeg;
        window.fetchFileUtil = ff;

        ffmpeg = createFFmpeg({
            log: true,
            corePath: 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js',
        });

        ffmpeg.setProgress(({ ratio }) => {
            const percent = Math.round(ratio * 100);
            elements.progressFill.style.width = `${percent}%`;
            elements.progressText.textContent = `轉換中... ${percent}%`;
        });

        await ffmpeg.load();
        ffmpegLoaded = true;
        elements.loadingOverlay.classList.add('hidden');
        console.log('FFmpeg loaded successfully');
    } catch (error) {
        console.error('Failed to load FFmpeg:', error);
        elements.loadingOverlay.innerHTML = `
            <div class="loading-content">
                <div class="error-icon">⚠</div>
                <p>FFmpeg 載入失敗</p>
                <p class="loading-hint">${error.message}</p>
                <button onclick="location.reload()" class="btn-new" style="margin-top: 1rem;">重新載入</button>
            </div>
        `;
    }
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
        return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function getFileType(file) {
    if (file.type.startsWith('video/')) return 'video';
    if (file.type.startsWith('audio/')) return 'audio';
    const ext = file.name.split('.').pop().toLowerCase();
    if (['mp4', 'webm', 'avi', 'mkv', 'mov', 'flv', 'wmv', 'mpeg', 'mpg'].includes(ext)) return 'video';
    if (['mp3', 'wav', 'aac', 'ogg', 'flac', 'm4a', 'wma'].includes(ext)) return 'audio';
    return 'unknown';
}

function handleFile(file) {
    const fileType = getFileType(file);
    if (fileType === 'unknown') {
        showError('不支援的檔案格式');
        return;
    }

    currentFile = file;
    elements.fileIcon.textContent = fileType === 'video' ? '📹' : '🎵';
    elements.fileName.textContent = file.name;
    elements.fileMeta.textContent = `${formatFileSize(file.size)} • ${file.type || '未知格式'}`;

    elements.dropzone.parentElement.classList.add('hidden');
    elements.fileInfo.classList.remove('hidden');
    elements.convertSection.classList.remove('hidden');

    if (fileType === 'audio') {
        elements.outputFormat.value = 'mp3';
    }

    hideError();
    hideDownload();
}

function removeFile() {
    currentFile = null;
    elements.fileInput.value = '';
    elements.fileInfo.classList.add('hidden');
    elements.convertSection.classList.add('hidden');
    elements.dropzone.parentElement.classList.remove('hidden');
    hideProgress();
    hideDownload();
    hideError();
}

function buildFFmpegArgs(inputName, outputName, options) {
    const args = ['-i', inputName];
    const formatConfig = FORMAT_CONFIG[options.format];
    const qualityConfig = QUALITY_SETTINGS[options.quality];
    const isOutputAudio = formatConfig.type === 'audio';
    const isExtractAudio = options.extractAudio;

    if (isOutputAudio || isExtractAudio) {
        args.push('-vn');
        if (options.audioBitrate) {
            args.push('-b:a', options.audioBitrate);
        } else {
            args.push('-b:a', qualityConfig.audio.split(' ')[1]);
        }
    } else {
        if (options.format === 'gif') {
            let scale = '480:-1';
            if (options.resolution) {
                const [w] = options.resolution.split('x');
                scale = `${w}:-1`;
            }
            const fps = options.fps || '10';
            args.push('-vf', `fps=${fps},scale=${scale}:flags=lanczos`);
            args.push('-loop', '0');
        } else {
            args.push('-c:v', 'libx264');
            args.push('-c:a', 'aac');
            args.push(qualityConfig.video.split(' ')[0], qualityConfig.video.split(' ')[1]);

            if (options.resolution) {
                args.push('-s', options.resolution);
            }
            if (options.fps) {
                args.push('-r', options.fps);
            }
            if (options.audioBitrate) {
                args.push('-b:a', options.audioBitrate);
            }
        }
    }

    args.push('-y', outputName);
    return args;
}

async function convert() {
    if (!currentFile || !ffmpegLoaded) return;

    const options = {
        format: elements.outputFormat.value,
        quality: elements.quality.value,
        resolution: elements.resolution.value,
        fps: elements.fps.value,
        audioBitrate: elements.audioBitrate.value,
        extractAudio: elements.extractAudio.checked,
    };

    if (options.extractAudio && FORMAT_CONFIG[options.format].type === 'video') {
        options.format = 'mp3';
    }

    const inputExt = currentFile.name.split('.').pop();
    const inputName = `input.${inputExt}`;
    const outputExt = FORMAT_CONFIG[options.format].ext;
    const baseName = currentFile.name.replace(/\.[^/.]+$/, '');
    outputFileName = `${baseName}_converted.${outputExt}`;
    const outputName = `output.${outputExt}`;

    showProgress();
    elements.convertBtn.disabled = true;
    elements.convertBtn.querySelector('.btn-text').classList.add('hidden');
    elements.convertBtn.querySelector('.btn-loading').classList.remove('hidden');

    try {
        elements.progressText.textContent = '準備檔案...';
        ffmpeg.FS('writeFile', inputName, await window.fetchFileUtil(currentFile));

        const args = buildFFmpegArgs(inputName, outputName, options);
        console.log('FFmpeg args:', args.join(' '));

        elements.progressText.textContent = '轉換中... 0%';
        await ffmpeg.run(...args);

        elements.progressText.textContent = '完成處理...';
        const outputData = ffmpeg.FS('readFile', outputName);

        const mimeTypes = {
            mp4: 'video/mp4',
            webm: 'video/webm',
            avi: 'video/x-msvideo',
            mkv: 'video/x-matroska',
            mov: 'video/quicktime',
            gif: 'image/gif',
            mp3: 'audio/mpeg',
            wav: 'audio/wav',
            aac: 'audio/aac',
            ogg: 'audio/ogg',
            flac: 'audio/flac',
            m4a: 'audio/mp4',
        };

        outputBlob = new Blob([outputData.buffer], { type: mimeTypes[outputExt] || 'application/octet-stream' });

        ffmpeg.FS('unlink', inputName);
        ffmpeg.FS('unlink', outputName);

        showDownload();
    } catch (error) {
        console.error('Conversion failed:', error);
        showError(`轉換失敗: ${error.message}`);
    } finally {
        elements.convertBtn.disabled = false;
        elements.convertBtn.querySelector('.btn-text').classList.remove('hidden');
        elements.convertBtn.querySelector('.btn-loading').classList.add('hidden');
        hideProgress();
    }
}

function download() {
    if (!outputBlob || !outputFileName) return;
    const url = URL.createObjectURL(outputBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = outputFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function showProgress() {
    elements.progressSection.classList.remove('hidden');
    elements.progressFill.style.width = '0%';
    elements.progressText.textContent = '準備中...';
    elements.progressDetail.textContent = '';
}

function hideProgress() {
    elements.progressSection.classList.add('hidden');
}

function showDownload() {
    elements.downloadSection.classList.remove('hidden');
    elements.outputInfo.textContent = `${outputFileName} (${formatFileSize(outputBlob.size)})`;
}

function hideDownload() {
    elements.downloadSection.classList.add('hidden');
    outputBlob = null;
    outputFileName = null;
}

function showError(message) {
    elements.errorSection.classList.remove('hidden');
    elements.errorMessage.textContent = message;
}

function hideError() {
    elements.errorSection.classList.add('hidden');
}

function resetAll() {
    removeFile();
}

// 事件監聽
elements.dropzone.addEventListener('click', () => elements.fileInput.click());
elements.dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    elements.dropzone.classList.add('dragover');
});
elements.dropzone.addEventListener('dragleave', () => {
    elements.dropzone.classList.remove('dragover');
});
elements.dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    elements.dropzone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
});
elements.fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFile(file);
});
elements.removeFile.addEventListener('click', removeFile);
elements.convertBtn.addEventListener('click', convert);
elements.downloadBtn.addEventListener('click', download);
elements.newConvert.addEventListener('click', resetAll);
elements.retryBtn.addEventListener('click', () => {
    hideError();
    if (currentFile) {
        elements.convertSection.classList.remove('hidden');
    }
});
elements.extractAudio.addEventListener('change', (e) => {
    if (e.target.checked) {
        const currentFormat = elements.outputFormat.value;
        if (FORMAT_CONFIG[currentFormat].type === 'video') {
            elements.outputFormat.value = 'mp3';
        }
    }
});

// 初始化
initFFmpeg();
