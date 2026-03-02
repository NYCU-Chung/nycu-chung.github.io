/**
 * 影片/音訊轉換器 - 前端
 * 使用後端 API 進行轉換
 */

// API 端點
const API_BASE = 'https://video-converter.duckdns.org';

const SIZE_THRESHOLDS = {
    WARN: 100 * 1024 * 1024,      // 100MB
    MAX: 500 * 1024 * 1024,        // 500MB
};

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

let currentFile = null;
let currentTaskId = null;
let pollInterval = null;

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

async function checkApiHealth() {
    try {
        const response = await fetch(`${API_BASE}/api/health`);
        if (response.ok) {
            elements.loadingOverlay.classList.add('hidden');
            return true;
        }
    } catch (e) {
        console.error('API health check failed:', e);
    }

    elements.loadingOverlay.innerHTML = `
        <div class="loading-content">
            <div class="error-icon">⚠</div>
            <p>無法連接到轉換伺服器</p>
            <p class="loading-hint">請確認伺服器已啟動</p>
            <button onclick="location.reload()" class="btn-new" style="margin-top: 1rem;">重試</button>
        </div>
    `;
    return false;
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
        showError(`檔案大小 ${sizeMB}MB 超過上限 (500MB)`);
        return;
    }

    if (file.size > SIZE_THRESHOLDS.WARN) {
        if (!confirm(`檔案大小 ${sizeMB}MB，上傳和轉換可能需要較長時間。\n\n確定要繼續嗎？`)) {
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

    hideError();
    hideDownload();
}

function removeFile() {
    currentFile = null;
    currentTaskId = null;
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }
    elements.fileInput.value = '';
    elements.fileInfo.classList.add('hidden');
    elements.convertSection.classList.add('hidden');
    elements.dropzone.parentElement.classList.remove('hidden');
    hideProgress();
    hideDownload();
    hideError();
}

async function convert() {
    if (!currentFile) return;

    const options = {
        format: elements.outputFormat.value,
        quality: elements.quality.value,
        resolution: elements.resolution.value,
        fps: elements.fps.value,
        audio_bitrate: elements.audioBitrate.value,
        extract_audio: elements.extractAudio.checked,
    };

    if (options.extract_audio && FORMAT_CONFIG[options.format].type === 'video') {
        options.format = 'mp3';
    }

    showProgress();
    elements.convertBtn.disabled = true;
    elements.convertBtn.querySelector('.btn-text').classList.add('hidden');
    elements.convertBtn.querySelector('.btn-loading').classList.remove('hidden');

    // 建立 FormData
    const formData = new FormData();
    formData.append('file', currentFile);
    formData.append('format', options.format);
    formData.append('quality', options.quality);
    if (options.resolution) formData.append('resolution', options.resolution);
    if (options.fps) formData.append('fps', options.fps);
    if (options.audio_bitrate) formData.append('audio_bitrate', options.audio_bitrate);
    formData.append('extract_audio', options.extract_audio ? 'true' : 'false');

    // 使用 XMLHttpRequest 以支援上傳進度
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100);
            elements.progressFill.style.width = `${percent * 0.5}%`; // 上傳佔 50%
            elements.progressText.textContent = `上傳中... ${percent}%`;
            elements.progressDetail.textContent = `${formatFileSize(e.loaded)} / ${formatFileSize(e.total)}`;
        }
    });

    xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
            try {
                const result = JSON.parse(xhr.responseText);
                currentTaskId = result.task_id;
                elements.progressText.textContent = '轉換中... 0%';
                elements.progressDetail.textContent = '';
                pollInterval = setInterval(checkTaskStatus, 1000);
            } catch (e) {
                showError('伺服器回應格式錯誤');
                resetConvertButton();
                hideProgress();
            }
        } else {
            try {
                const error = JSON.parse(xhr.responseText);
                showError(`上傳失敗: ${error.error || '未知錯誤'}`);
            } catch {
                showError(`上傳失敗: HTTP ${xhr.status}`);
            }
            resetConvertButton();
            hideProgress();
        }
    });

    xhr.addEventListener('error', () => {
        showError('網路錯誤，請檢查連線');
        resetConvertButton();
        hideProgress();
    });

    xhr.addEventListener('abort', () => {
        resetConvertButton();
        hideProgress();
    });

    xhr.open('POST', `${API_BASE}/api/convert`);
    xhr.send(formData);
}

async function checkTaskStatus() {
    if (!currentTaskId) return;

    try {
        const response = await fetch(`${API_BASE}/api/status/${currentTaskId}`);
        const status = await response.json();

        if (status.status === 'converting') {
            // 轉換佔進度條的 50%-100%
            const displayProgress = 50 + (status.progress * 0.5);
            elements.progressFill.style.width = `${displayProgress}%`;
            elements.progressText.textContent = `轉換中... ${status.progress}%`;
        } else if (status.status === 'completed') {
            clearInterval(pollInterval);
            pollInterval = null;

            elements.progressFill.style.width = '100%';
            elements.progressText.textContent = '轉換完成！';

            // 顯示下載
            showDownload(status.output_filename, status.output_size);
            resetConvertButton();
            hideProgress();

        } else if (status.status === 'failed') {
            clearInterval(pollInterval);
            pollInterval = null;

            showError(`轉換失敗: ${status.error || '未知錯誤'}`);
            resetConvertButton();
            hideProgress();
        }

    } catch (error) {
        console.error('Status check failed:', error);
    }
}

function resetConvertButton() {
    elements.convertBtn.disabled = false;
    elements.convertBtn.querySelector('.btn-text').classList.remove('hidden');
    elements.convertBtn.querySelector('.btn-loading').classList.add('hidden');
}

function download() {
    if (!currentTaskId) return;
    window.location.href = `${API_BASE}/api/download/${currentTaskId}`;
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

function showDownload(filename, size) {
    elements.downloadSection.classList.remove('hidden');
    elements.outputInfo.textContent = `${filename} (${formatFileSize(size)})`;
}

function hideDownload() {
    elements.downloadSection.classList.add('hidden');
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
checkApiHealth();
