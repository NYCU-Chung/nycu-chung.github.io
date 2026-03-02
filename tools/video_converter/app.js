/**
 * 影片/音訊轉換器
 * 使用 FFmpeg.wasm 在瀏覽器中進行轉換
 */

// 格式設定
const FORMAT_CONFIG = {
    // 影片格式
    mp4: { type: 'video', codec: '-c:v libx264 -c:a aac', ext: 'mp4' },
    webm: { type: 'video', codec: '-c:v libvpx-vp9 -c:a libopus', ext: 'webm' },
    avi: { type: 'video', codec: '-c:v mpeg4 -c:a mp3', ext: 'avi' },
    mkv: { type: 'video', codec: '-c:v libx264 -c:a aac', ext: 'mkv' },
    mov: { type: 'video', codec: '-c:v libx264 -c:a aac', ext: 'mov' },
    gif: { type: 'video', codec: '-vf "fps=10,scale=480:-1:flags=lanczos"', ext: 'gif' },
    // 音訊格式
    mp3: { type: 'audio', codec: '-c:a libmp3lame', ext: 'mp3' },
    wav: { type: 'audio', codec: '-c:a pcm_s16le', ext: 'wav' },
    aac: { type: 'audio', codec: '-c:a aac', ext: 'aac' },
    ogg: { type: 'audio', codec: '-c:a libvorbis', ext: 'ogg' },
    flac: { type: 'audio', codec: '-c:a flac', ext: 'flac' },
    m4a: { type: 'audio', codec: '-c:a aac', ext: 'm4a' },
};

const QUALITY_SETTINGS = {
    high: { video: '-crf 18 -preset slow', audio: '-b:a 320k' },
    medium: { video: '-crf 23 -preset medium', audio: '-b:a 192k' },
    low: { video: '-crf 28 -preset fast', audio: '-b:a 128k' },
};

// 狀態
let ffmpeg = null;
let currentFile = null;
let outputBlob = null;
let outputFileName = null;

// DOM 元素
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

// 將遠端 JS 轉為 Blob URL
async function toBlobURL(url, mimeType) {
    const response = await fetch(url);
    const blob = new Blob([await response.text()], { type: mimeType });
    return URL.createObjectURL(blob);
}

// 將遠端二進位檔轉為 Blob URL
async function toBlobURLBinary(url, mimeType) {
    const response = await fetch(url);
    const blob = new Blob([await response.arrayBuffer()], { type: mimeType });
    return URL.createObjectURL(blob);
}

// 讀取檔案為 Uint8Array
async function fetchFile(file) {
    return new Uint8Array(await file.arrayBuffer());
}

// 初始化 FFmpeg
async function initFFmpeg() {
    try {
        const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
        const ffmpegURL = 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/umd';

        // 載入 FFmpeg 類別
        const classWorkerURL = await toBlobURL(`${ffmpegURL}/814.ffmpeg.js`, 'text/javascript');
        const classURL = await toBlobURL(`${ffmpegURL}/ffmpeg.js`, 'text/javascript');

        // 動態載入 ffmpeg.js
        await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = classURL;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });

        // 等待 FFmpegWASM 可用
        await new Promise(resolve => setTimeout(resolve, 100));

        const { FFmpeg } = FFmpegWASM;
        ffmpeg = new FFmpeg();

        ffmpeg.on('log', ({ message }) => {
            console.log('[FFmpeg]', message);
        });

        ffmpeg.on('progress', ({ progress, time }) => {
            const percent = Math.round(progress * 100);
            elements.progressFill.style.width = `${percent}%`;
            elements.progressText.textContent = `轉換中... ${percent}%`;
            if (time > 0) {
                const seconds = Math.round(time / 1000000);
                elements.progressDetail.textContent = `已處理: ${formatDuration(seconds)}`;
            }
        });

        // 載入 core
        const coreURL = await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript');
        const wasmURL = await toBlobURLBinary(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm');

        await ffmpeg.load({
            coreURL,
            wasmURL,
            workerURL: classWorkerURL,
        });

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

// 格式化檔案大小
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 格式化時間
function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
        return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// 判斷檔案類型
function getFileType(file) {
    if (file.type.startsWith('video/')) return 'video';
    if (file.type.startsWith('audio/')) return 'audio';
    const ext = file.name.split('.').pop().toLowerCase();
    if (['mp4', 'webm', 'avi', 'mkv', 'mov', 'flv', 'wmv', 'mpeg', 'mpg'].includes(ext)) return 'video';
    if (['mp3', 'wav', 'aac', 'ogg', 'flac', 'm4a', 'wma'].includes(ext)) return 'audio';
    return 'unknown';
}

// 處理檔案選擇
function handleFile(file) {
    const fileType = getFileType(file);
    if (fileType === 'unknown') {
        showError('不支援的檔案格式');
        return;
    }

    currentFile = file;

    // 更新 UI
    elements.fileIcon.textContent = fileType === 'video' ? '📹' : '🎵';
    elements.fileName.textContent = file.name;
    elements.fileMeta.textContent = `${formatFileSize(file.size)} • ${file.type || '未知格式'}`;

    elements.dropzone.parentElement.classList.add('hidden');
    elements.fileInfo.classList.remove('hidden');
    elements.convertSection.classList.remove('hidden');

    // 根據檔案類型預選輸出格式
    if (fileType === 'audio') {
        elements.outputFormat.value = 'mp3';
    }

    hideError();
    hideDownload();
}

// 移除檔案
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

// 建構 FFmpeg 命令參數
function buildFFmpegArgs(inputName, outputName, options) {
    const args = ['-i', inputName];
    const formatConfig = FORMAT_CONFIG[options.format];
    const qualityConfig = QUALITY_SETTINGS[options.quality];

    const isOutputAudio = formatConfig.type === 'audio';
    const isExtractAudio = options.extractAudio;

    if (isOutputAudio || isExtractAudio) {
        // 輸出音訊
        args.push('-vn'); // 移除影片

        const codecParts = formatConfig.codec.split(' ');
        args.push(...codecParts);

        if (options.audioBitrate) {
            args.push('-b:a', options.audioBitrate);
        } else {
            args.push(...qualityConfig.audio.split(' '));
        }
    } else {
        // 輸出影片
        if (options.format === 'gif') {
            // GIF 特殊處理
            let scale = '480:-1';
            if (options.resolution) {
                const [w] = options.resolution.split('x');
                scale = `${w}:-1`;
            }
            const fps = options.fps || '10';
            args.push('-vf', `fps=${fps},scale=${scale}:flags=lanczos`);
            args.push('-loop', '0');
        } else {
            // 一般影片
            const codecParts = formatConfig.codec.split(' ');
            args.push(...codecParts);

            args.push(...qualityConfig.video.split(' '));

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

// 執行轉換
async function convert() {
    if (!currentFile || !ffmpeg) return;

    const options = {
        format: elements.outputFormat.value,
        quality: elements.quality.value,
        resolution: elements.resolution.value,
        fps: elements.fps.value,
        audioBitrate: elements.audioBitrate.value,
        extractAudio: elements.extractAudio.checked,
    };

    // 如果勾選提取音訊，強制輸出為音訊格式
    if (options.extractAudio && FORMAT_CONFIG[options.format].type === 'video') {
        options.format = 'mp3';
    }

    const inputExt = currentFile.name.split('.').pop();
    const inputName = `input.${inputExt}`;
    const outputExt = FORMAT_CONFIG[options.format].ext;
    const baseName = currentFile.name.replace(/\.[^/.]+$/, '');
    outputFileName = `${baseName}_converted.${outputExt}`;
    const outputName = `output.${outputExt}`;

    // 顯示進度
    showProgress();
    elements.convertBtn.disabled = true;
    elements.convertBtn.querySelector('.btn-text').classList.add('hidden');
    elements.convertBtn.querySelector('.btn-loading').classList.remove('hidden');

    try {
        // 寫入輸入檔案
        elements.progressText.textContent = '準備檔案...';
        await ffmpeg.writeFile(inputName, await fetchFile(currentFile));

        // 建構並執行命令
        const args = buildFFmpegArgs(inputName, outputName, options);
        console.log('FFmpeg args:', args.join(' '));

        elements.progressText.textContent = '轉換中... 0%';
        await ffmpeg.exec(args);

        // 讀取輸出檔案
        elements.progressText.textContent = '完成處理...';
        const outputData = await ffmpeg.readFile(outputName);

        // 建立 Blob
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
        await ffmpeg.deleteFile(inputName);
        await ffmpeg.deleteFile(outputName);

        // 顯示下載
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

// 下載檔案
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

// UI 輔助函數
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

// 提取音訊選項變更時自動切換格式
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
