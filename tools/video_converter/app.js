/**
 * 影片/音訊轉換器
 * 使用 FFmpeg.wasm 0.12.x 在瀏覽器中進行轉換
 */

const SIZE_THRESHOLDS = {
    WARN: 100 * 1024 * 1024,
    FORCE_720P: 200 * 1024 * 1024,
    FORCE_480P: 400 * 1024 * 1024,
    MAX: 800 * 1024 * 1024,
};

const FORMAT_CONFIG = {
    mp4: { type: 'video', ext: 'mp4', vcodec: 'libx264', acodec: 'aac' },
    webm: { type: 'video', ext: 'webm', vcodec: 'libvpx', acodec: 'libvorbis' },
    avi: { type: 'video', ext: 'avi', vcodec: 'mpeg4', acodec: 'mp3' },
    mkv: { type: 'video', ext: 'mkv', vcodec: 'libx264', acodec: 'aac' },
    mov: { type: 'video', ext: 'mov', vcodec: 'libx264', acodec: 'aac' },
    gif: { type: 'video', ext: 'gif' },
    mp3: { type: 'audio', ext: 'mp3', acodec: 'libmp3lame' },
    wav: { type: 'audio', ext: 'wav', acodec: 'pcm_s16le' },
    aac: { type: 'audio', ext: 'aac', acodec: 'aac' },
    ogg: { type: 'audio', ext: 'ogg', acodec: 'libvorbis' },
    flac: { type: 'audio', ext: 'flac', acodec: 'flac' },
    m4a: { type: 'audio', ext: 'm4a', acodec: 'aac' },
};

const QUALITY_SETTINGS = {
    high: { crf: '23', preset: 'fast', audioBitrate: '192k' },
    medium: { crf: '28', preset: 'veryfast', audioBitrate: '128k' },
    low: { crf: '32', preset: 'ultrafast', audioBitrate: '96k' },
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

async function initFFmpeg() {
    try {
        const { FFmpeg } = FFmpegWASM;
        const { toBlobURL } = FFmpegUtil;

        ffmpeg = new FFmpeg();

        ffmpeg.on('progress', ({ progress }) => {
            const percent = Math.round(progress * 100);
            elements.progressFill.style.width = `${percent}%`;
            elements.progressText.textContent = `轉換中... ${percent}%`;
        });

        ffmpeg.on('log', ({ message }) => {
            console.log('[FFmpeg]', message);
        });

        elements.loadingOverlay.querySelector('p').textContent = '正在載入 FFmpeg 核心...';

        // 使用單執行緒核心並將所有資源轉為 Blob URL 避免跨域問題
        const coreBaseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
        const ffmpegBaseURL = 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm';

        await ffmpeg.load({
            coreURL: await toBlobURL(`${coreBaseURL}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${coreBaseURL}/ffmpeg-core.wasm`, 'application/wasm'),
            classWorkerURL: await toBlobURL(`${ffmpegBaseURL}/worker.js`, 'text/javascript'),
        });

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

    const sizeMB = (file.size / (1024 * 1024)).toFixed(0);

    if (file.size > SIZE_THRESHOLDS.MAX) {
        showError(`檔案大小 ${sizeMB}MB 超過上限 (800MB)。\n\n請使用桌面版 FFmpeg 處理超大檔案。`);
        return;
    }

    let autoResolution = '';
    if (file.size > SIZE_THRESHOLDS.FORCE_480P) {
        if (!confirm(`檔案大小 ${sizeMB}MB，將自動降低至 480p。\n\n確定要繼續嗎？`)) {
            return;
        }
        autoResolution = '854x480';
    } else if (file.size > SIZE_THRESHOLDS.FORCE_720P) {
        if (!confirm(`檔案大小 ${sizeMB}MB，將自動降低至 720p。\n\n確定要繼續嗎？`)) {
            return;
        }
        autoResolution = '1280x720';
    } else if (file.size > SIZE_THRESHOLDS.WARN) {
        if (!confirm(`檔案大小 ${sizeMB}MB，瀏覽器轉換可能較慢。\n\n確定要繼續嗎？`)) {
            return;
        }
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

    if (autoResolution && fileType === 'video') {
        elements.resolution.value = autoResolution;
        elements.quality.value = 'low';
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
        if (formatConfig.acodec) {
            args.push('-c:a', formatConfig.acodec);
        }
        args.push('-b:a', options.audioBitrate || qualityConfig.audioBitrate);
    } else if (options.format === 'gif') {
        let scale = '480:-1';
        if (options.resolution) {
            const [w] = options.resolution.split('x');
            scale = `${w}:-1`;
        }
        const fps = options.fps || '10';
        args.push('-vf', `fps=${fps},scale=${scale}:flags=lanczos`);
        args.push('-loop', '0');
    } else {
        args.push('-c:v', formatConfig.vcodec);
        args.push('-c:a', formatConfig.acodec);

        if (formatConfig.vcodec === 'libx264') {
            args.push('-crf', qualityConfig.crf);
            args.push('-preset', qualityConfig.preset);
            args.push('-pix_fmt', 'yuv420p');
            args.push('-profile:v', 'baseline');
            args.push('-level', '3.0');
        } else if (formatConfig.vcodec === 'libvpx') {
            args.push('-crf', qualityConfig.crf);
            args.push('-b:v', '0');
        } else if (formatConfig.vcodec === 'mpeg4') {
            args.push('-q:v', '5');
        }

        args.push('-b:a', options.audioBitrate || qualityConfig.audioBitrate);

        if (options.resolution) {
            args.push('-s', options.resolution);
        }

        if (options.fps) {
            args.push('-r', options.fps);
        }
    }

    args.push('-y', outputName);
    return args;
}

async function convert() {
    if (!currentFile || !ffmpegLoaded) return;

    const { fetchFile } = FFmpegUtil;

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

    const inputExt = currentFile.name.split('.').pop().toLowerCase();
    const inputName = `input.${inputExt}`;
    const outputExt = FORMAT_CONFIG[options.format].ext;
    const baseName = currentFile.name.replace(/\.[^/.]+$/, '');
    outputFileName = `${baseName}_converted.${outputExt}`;
    const outputName = `output.${outputExt}`;

    showProgress();
    elements.convertBtn.disabled = true;
    elements.convertBtn.querySelector('.btn-text').classList.add('hidden');
    elements.convertBtn.querySelector('.btn-loading').classList.remove('hidden');

    const startTime = Date.now();

    try {
        elements.progressText.textContent = '準備檔案...';
        elements.progressDetail.textContent = `讀取 ${formatFileSize(currentFile.size)}...`;

        await ffmpeg.writeFile(inputName, await fetchFile(currentFile));

        const args = buildFFmpegArgs(inputName, outputName, options);
        console.log('FFmpeg args:', args.join(' '));

        elements.progressText.textContent = '轉換中... 0%';

        await ffmpeg.exec(args);

        elements.progressText.textContent = '讀取輸出...';

        let outputData;
        try {
            outputData = await ffmpeg.readFile(outputName);
        } catch (e) {
            throw new Error('轉換失敗：無法生成輸出檔案');
        }

        if (outputData.length === 0) {
            throw new Error('轉換失敗：輸出檔案為空');
        }

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

        // 清理
        try {
            await ffmpeg.deleteFile(inputName);
            await ffmpeg.deleteFile(outputName);
        } catch (e) {
            console.warn('清理暫存檔案失敗:', e);
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`轉換完成，耗時 ${elapsed} 秒`);

        showDownload();
    } catch (error) {
        console.error('Conversion failed:', error);

        try {
            await ffmpeg.deleteFile(inputName);
            await ffmpeg.deleteFile(outputName);
        } catch (e) {}

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
