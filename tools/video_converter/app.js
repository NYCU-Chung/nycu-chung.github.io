/**
 * 影片/音訊轉換器
 * 使用 FFmpeg.wasm 0.12.x 在瀏覽器中進行轉換
 */

import { FFmpeg } from 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js';
import { fetchFile, toBlobURL } from 'https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js';

// 檔案大小閾值
const SIZE_THRESHOLDS = {
    WARN: 100 * 1024 * 1024,      // 100MB - 警告
    FORCE_720P: 200 * 1024 * 1024, // 200MB - 強制 720p
    FORCE_480P: 400 * 1024 * 1024, // 400MB - 強制 480p
    MAX: 800 * 1024 * 1024,        // 800MB - 最大限制
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
        ffmpeg = new FFmpeg();

        ffmpeg.on('progress', ({ progress }) => {
            const percent = Math.round(progress * 100);
            elements.progressFill.style.width = `${percent}%`;
            elements.progressText.textContent = `轉換中... ${percent}%`;
        });

        ffmpeg.on('log', ({ message }) => {
            console.log('FFmpeg:', message);
        });

        elements.loadingOverlay.querySelector('p').textContent = '正在載入 FFmpeg 核心...';

        // FFmpeg 類別的 worker (解決 CORS 問題)
        const ffmpegWorkerURL = await toBlobURL(
            'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/worker.js',
            'text/javascript'
        );

        // 檢查是否支援多執行緒 (需要 SharedArrayBuffer)
        const multiThreadSupported = typeof SharedArrayBuffer !== 'undefined';
        console.log('Multi-thread support:', multiThreadSupported);

        let loadedWithMT = false;

        // 嘗試載入多執行緒版本，失敗則降級到單執行緒
        if (multiThreadSupported) {
            try {
                const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.6/dist/esm';
                elements.loadingOverlay.querySelector('.loading-hint').textContent = '嘗試載入多執行緒核心...';

                await ffmpeg.load({
                    classWorkerURL: ffmpegWorkerURL,
                    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
                    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
                    workerURL: await toBlobURL(`${baseURL}/ffmpeg-core.worker.js`, 'text/javascript'),
                });
                loadedWithMT = true;
                console.log('Loaded with multi-threaded core');
            } catch (mtError) {
                console.warn('Multi-threaded core failed, falling back to single-threaded:', mtError);
                // 重新建立 FFmpeg 實例
                ffmpeg = new FFmpeg();
                ffmpeg.on('progress', ({ progress }) => {
                    const percent = Math.round(progress * 100);
                    elements.progressFill.style.width = `${percent}%`;
                    elements.progressText.textContent = `轉換中... ${percent}%`;
                });
                ffmpeg.on('log', ({ message }) => {
                    console.log('FFmpeg:', message);
                });
            }
        }

        // 如果多執行緒失敗或不支援，使用單執行緒
        if (!loadedWithMT) {
            const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm';
            elements.loadingOverlay.querySelector('.loading-hint').textContent = '載入單執行緒核心...';
            await ffmpeg.load({
                classWorkerURL: ffmpegWorkerURL,
                coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
                wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
            });
            console.log('Loaded with single-threaded core');
        }

        ffmpegLoaded = true;
        elements.loadingOverlay.classList.add('hidden');
        console.log('FFmpeg loaded successfully (multi-thread:', multiThreadSupported, ')');
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

    // 檢查檔案大小限制
    if (file.size > SIZE_THRESHOLDS.MAX) {
        showError(`檔案大小 ${sizeMB}MB 超過上限 (800MB)。\n\n請使用桌面版 FFmpeg 處理超大檔案。`);
        return;
    }

    // 大檔案警告和自動調整
    let autoResolution = '';
    if (file.size > SIZE_THRESHOLDS.FORCE_480P) {
        if (!confirm(`檔案大小 ${sizeMB}MB，將自動降低至 480p 以節省記憶體。\n\n轉換可能需要較長時間，建議使用桌面版。\n\n確定要繼續嗎？`)) {
            return;
        }
        autoResolution = '854x480';
    } else if (file.size > SIZE_THRESHOLDS.FORCE_720P) {
        if (!confirm(`檔案大小 ${sizeMB}MB，將自動降低至 720p 以節省記憶體。\n\n確定要繼續嗎？`)) {
            return;
        }
        autoResolution = '1280x720';
    } else if (file.size > SIZE_THRESHOLDS.WARN) {
        if (!confirm(`檔案大小 ${sizeMB}MB，瀏覽器轉換可能較慢。\n\n建議使用桌面版 FFmpeg 處理大檔案。\n\n確定要繼續嗎？`)) {
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

    // 大檔案自動設定解析度
    if (autoResolution && fileType === 'video') {
        elements.resolution.value = autoResolution;
        // 同時降低品質以加速
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
        if (options.audioBitrate) {
            args.push('-b:a', options.audioBitrate);
        } else {
            args.push('-b:a', qualityConfig.audioBitrate);
        }
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

    const options = {
        format: elements.outputFormat.value,
        quality: elements.quality.value,
        resolution: elements.resolution.value,
        fps: elements.fps.value,
        audioBitrate: elements.audioBitrate.value,
        extractAudio: elements.extractAudio.checked,
        isLargeFile: currentFile.size > SIZE_THRESHOLDS.WARN,
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

        // 寫入輸入檔案
        const fileData = await fetchFile(currentFile);
        await ffmpeg.writeFile(inputName, fileData);

        const args = buildFFmpegArgs(inputName, outputName, options);
        console.log('FFmpeg args:', args.join(' '));

        elements.progressText.textContent = '轉換中... 0%';
        elements.progressDetail.textContent = options.isLargeFile ? '大檔案處理中，請耐心等待...' : '';

        // 執行轉換
        await ffmpeg.exec(args);

        elements.progressText.textContent = '讀取輸出...';

        // 讀取輸出檔案
        let outputData;
        try {
            outputData = await ffmpeg.readFile(outputName);
        } catch (e) {
            throw new Error('轉換失敗：無法生成輸出檔案。可能是記憶體不足或格式不支援。');
        }

        if (outputData.length === 0) {
            throw new Error('轉換失敗：輸出檔案為空');
        }

        // 檢查輸出檔案大小是否合理（但對於降解析度的情況放寬限制）
        const isVideoOutput = FORMAT_CONFIG[options.format].type === 'video' && !options.extractAudio;
        const minRatio = options.resolution ? 0.001 : 0.01; // 有降解析度時允許更小
        if (isVideoOutput && outputData.length < currentFile.size * minRatio) {
            console.warn(`輸出檔案異常小: ${outputData.length} bytes (輸入: ${currentFile.size} bytes)`);
            throw new Error('轉換失敗：輸出檔案異常小，可能是記憶體不足或輸入格式不支援。建議使用桌面版 FFmpeg。');
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

        // 清理虛擬檔案系統以釋放記憶體
        elements.progressText.textContent = '清理記憶體...';
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

        // 嘗試清理記憶體
        try {
            await ffmpeg.deleteFile(inputName);
            await ffmpeg.deleteFile(outputName);
        } catch (e) {}

        // 更友善的錯誤訊息
        let errorMsg = error.message;
        if (errorMsg.includes('memory') || errorMsg.includes('OOM') || errorMsg.includes('out of')) {
            errorMsg = '記憶體不足。請嘗試：\n1. 選擇較低的解析度\n2. 使用較小的檔案\n3. 使用桌面版 FFmpeg';
        }
        showError(`轉換失敗: ${errorMsg}`);
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
