#!/bin/bash
# 一鍵安裝腳本 - 在 Oracle Cloud Ubuntu VM 上執行
# 使用方式: curl -sSL https://raw.githubusercontent.com/NYCU-Chung/nycu-chung.github.io/main/tools/video_converter/backend/install.sh | bash

set -e

echo "=========================================="
echo "  影片轉換器後端 - 一鍵安裝"
echo "=========================================="

# 更新系統
echo "[1/6] 更新系統..."
sudo apt update && sudo apt upgrade -y

# 安裝依賴
echo "[2/6] 安裝依賴..."
sudo apt install -y python3 python3-pip python3-venv ffmpeg nginx certbot python3-certbot-nginx

# 開放防火牆
echo "[3/6] 設定防火牆..."
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save 2>/dev/null || true

# 建立目錄
echo "[4/6] 建立應用程式..."
sudo mkdir -p /opt/video-converter
sudo chown $USER:$USER /opt/video-converter
cd /opt/video-converter

# 建立 Python 虛擬環境
python3 -m venv venv
source venv/bin/activate

# 安裝 Python 套件
pip install flask flask-cors gunicorn

# 建立 app.py
cat > app.py << 'APPEOF'
import os, uuid, subprocess, threading, time
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from werkzeug.utils import secure_filename

app = Flask(__name__)
CORS(app)

UPLOAD_FOLDER = '/tmp/video_converter/uploads'
OUTPUT_FOLDER = '/tmp/video_converter/outputs'
MAX_FILE_SIZE = 500 * 1024 * 1024
ALLOWED_EXT = ['mp4','webm','avi','mkv','mov','flv','wmv','mpeg','mpg','mp3','wav','aac','ogg','flac','m4a','wma']
FILE_EXPIRY = 3600

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(OUTPUT_FOLDER, exist_ok=True)

tasks = {}

FORMAT_CONFIG = {
    'mp4': {'type': 'video', 'vcodec': 'libx264', 'acodec': 'aac'},
    'webm': {'type': 'video', 'vcodec': 'libvpx', 'acodec': 'libvorbis'},
    'avi': {'type': 'video', 'vcodec': 'mpeg4', 'acodec': 'mp3'},
    'mkv': {'type': 'video', 'vcodec': 'libx264', 'acodec': 'aac'},
    'mov': {'type': 'video', 'vcodec': 'libx264', 'acodec': 'aac'},
    'gif': {'type': 'video'},
    'mp3': {'type': 'audio', 'acodec': 'libmp3lame'},
    'wav': {'type': 'audio', 'acodec': 'pcm_s16le'},
    'aac': {'type': 'audio', 'acodec': 'aac'},
    'ogg': {'type': 'audio', 'acodec': 'libvorbis'},
    'flac': {'type': 'audio', 'acodec': 'flac'},
    'm4a': {'type': 'audio', 'acodec': 'aac'},
}

QUALITY = {
    'high': {'crf': '23', 'preset': 'fast', 'ab': '192k'},
    'medium': {'crf': '28', 'preset': 'veryfast', 'ab': '128k'},
    'low': {'crf': '32', 'preset': 'ultrafast', 'ab': '96k'},
}

def get_ext(f): return f.rsplit('.',1)[-1].lower() if '.' in f else ''

def build_cmd(inp, out, opt):
    cmd = ['ffmpeg', '-i', inp, '-y']
    fc = FORMAT_CONFIG.get(opt['format'], {})
    qc = QUALITY.get(opt.get('quality','medium'), QUALITY['medium'])

    if fc.get('type') == 'audio' or opt.get('extract_audio'):
        cmd += ['-vn']
        if fc.get('acodec'): cmd += ['-c:a', fc['acodec']]
        cmd += ['-b:a', opt.get('audio_bitrate') or qc['ab']]
    elif opt['format'] == 'gif':
        w = opt.get('resolution','').split('x')[0] if opt.get('resolution') else '480'
        fps = opt.get('fps') or '10'
        cmd += ['-vf', f'fps={fps},scale={w}:-1:flags=lanczos', '-loop', '0']
    else:
        cmd += ['-c:v', fc.get('vcodec','libx264'), '-c:a', fc.get('acodec','aac')]
        if fc.get('vcodec') == 'libx264':
            cmd += ['-crf', qc['crf'], '-preset', qc['preset'], '-pix_fmt', 'yuv420p', '-profile:v', 'baseline', '-level', '3.0']
        elif fc.get('vcodec') == 'libvpx':
            cmd += ['-crf', qc['crf'], '-b:v', '0']
        elif fc.get('vcodec') == 'mpeg4':
            cmd += ['-q:v', '5']
        cmd += ['-b:a', opt.get('audio_bitrate') or qc['ab']]
        if opt.get('resolution'): cmd += ['-s', opt['resolution']]
        if opt.get('fps'): cmd += ['-r', opt['fps']]
    cmd.append(out)
    return cmd

def convert_video(tid, inp, out, opt):
    try:
        tasks[tid]['status'] = 'converting'
        cmd = build_cmd(inp, out, opt)

        try:
            dur_cmd = ['ffprobe','-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',inp]
            total = float(subprocess.run(dur_cmd, capture_output=True, text=True, timeout=30).stdout.strip())
        except: total = 0

        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
        for line in proc.stderr:
            if 'time=' in line:
                try:
                    t = line.split('time=')[1].split()[0].split(':')
                    cur = float(t[0])*3600 + float(t[1])*60 + float(t[2])
                    if total > 0: tasks[tid]['progress'] = min(99, int(cur/total*100))
                except: pass
        proc.wait()

        if proc.returncode == 0 and os.path.exists(out) and os.path.getsize(out) > 0:
            tasks[tid]['status'] = 'completed'
            tasks[tid]['progress'] = 100
            tasks[tid]['output_size'] = os.path.getsize(out)
        else:
            tasks[tid]['status'] = 'failed'
            tasks[tid]['error'] = '轉換失敗'
    except Exception as e:
        tasks[tid]['status'] = 'failed'
        tasks[tid]['error'] = str(e)
    finally:
        try: os.remove(inp)
        except: pass

def cleanup():
    while True:
        time.sleep(300)
        now = time.time()
        expired = [k for k,v in tasks.items() if now - v.get('created_at',0) > FILE_EXPIRY]
        for k in expired:
            try: os.remove(tasks[k].get('output_path',''))
            except: pass
            del tasks[k]

threading.Thread(target=cleanup, daemon=True).start()

@app.route('/api/health')
def health(): return jsonify({'status': 'ok'})

@app.route('/api/convert', methods=['POST'])
def convert():
    if 'file' not in request.files: return jsonify({'error': '未提供檔案'}), 400
    f = request.files['file']
    if not f.filename or get_ext(f.filename) not in ALLOWED_EXT:
        return jsonify({'error': '不支援的格式'}), 400

    f.seek(0,2); size = f.tell(); f.seek(0)
    if size > MAX_FILE_SIZE: return jsonify({'error': f'檔案太大'}), 400

    fmt = request.form.get('format', 'mp4')
    if fmt not in FORMAT_CONFIG: return jsonify({'error': '不支援的輸出格式'}), 400

    opt = {
        'format': fmt,
        'quality': request.form.get('quality', 'medium'),
        'resolution': request.form.get('resolution', ''),
        'fps': request.form.get('fps', ''),
        'audio_bitrate': request.form.get('audio_bitrate', ''),
        'extract_audio': request.form.get('extract_audio') == 'true',
    }

    tid = str(uuid.uuid4())[:8]
    inp_ext = get_ext(f.filename)
    inp_path = os.path.join(UPLOAD_FOLDER, f'{tid}_input.{inp_ext}')
    out_path = os.path.join(OUTPUT_FOLDER, f'{tid}_output.{fmt}')
    f.save(inp_path)

    base = secure_filename(f.filename).rsplit('.',1)[0] if '.' in f.filename else 'output'
    tasks[tid] = {
        'status': 'queued', 'progress': 0,
        'output_path': out_path,
        'output_filename': f'{base}_converted.{fmt}',
        'created_at': time.time(),
    }

    threading.Thread(target=convert_video, args=(tid, inp_path, out_path, opt)).start()
    return jsonify({'task_id': tid, 'status': 'queued'})

@app.route('/api/status/<tid>')
def status(tid):
    if tid not in tasks: return jsonify({'error': '任務不存在'}), 404
    t = tasks[tid]
    r = {'status': t['status'], 'progress': t['progress']}
    if t['status'] == 'completed':
        r['output_size'] = t.get('output_size', 0)
        r['output_filename'] = t.get('output_filename', 'output')
    elif t['status'] == 'failed':
        r['error'] = t.get('error', '未知錯誤')
    return jsonify(r)

@app.route('/api/download/<tid>')
def download(tid):
    if tid not in tasks: return jsonify({'error': '任務不存在'}), 404
    t = tasks[tid]
    if t['status'] != 'completed': return jsonify({'error': '檔案未準備好'}), 400
    if not os.path.exists(t['output_path']): return jsonify({'error': '檔案已過期'}), 404
    return send_file(t['output_path'], as_attachment=True, download_name=t['output_filename'])

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
APPEOF

# 建立 systemd 服務
echo "[5/6] 建立系統服務..."
sudo tee /etc/systemd/system/video-converter.service > /dev/null << SVCEOF
[Unit]
Description=Video Converter API
After=network.target

[Service]
User=$USER
WorkingDirectory=/opt/video-converter
ExecStart=/opt/video-converter/venv/bin/gunicorn -w 2 -b 127.0.0.1:5000 app:app
Restart=always

[Install]
WantedBy=multi-user.target
SVCEOF

sudo systemctl daemon-reload
sudo systemctl enable video-converter
sudo systemctl start video-converter

# 設定 Nginx
echo "[6/6] 設定 Nginx..."
sudo tee /etc/nginx/sites-available/video-converter > /dev/null << NGXEOF
server {
    listen 80;
    server_name _;
    client_max_body_size 500M;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_read_timeout 600s;
    }
}
NGXEOF

sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/video-converter /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

echo ""
echo "=========================================="
echo "  安裝完成！"
echo "=========================================="
echo ""
echo "API 網址: http://$(curl -s ifconfig.me)"
echo ""
echo "測試: curl http://$(curl -s ifconfig.me)/api/health"
echo ""
echo "如要設定 SSL，執行:"
echo "  sudo certbot --nginx -d 你的網域.com"
echo ""
