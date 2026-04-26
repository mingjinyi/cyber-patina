// ==========================================
// 赛博包浆引擎 v2.1：修复视频与静态图切换冲突
// ==========================================

const statusDiv = document.getElementById('status');
const canvas = document.getElementById('outputCanvas'); // 主展示画布(视频用)
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const resultImage = document.getElementById('resultImage'); // 最终静态图(长按保存用)

const sliderContainer = document.getElementById('sliderContainer');
const intensityRange = document.getElementById('intensityRange');
const intensityValue = document.getElementById('intensityValue');

const videoElement = document.getElementById('videoElement');
const startVideoBtn = document.getElementById('startVideoBtn');
const switchCameraBtn = document.getElementById('switchCameraBtn');

let session;
const originalCanvas = document.createElement('canvas');
const originalCtx = originalCanvas.getContext('2d', { willReadFrequently: true });
const onnxCanvas = document.createElement('canvas');
const onnxCtx = onnxCanvas.getContext('2d', { willReadFrequently: true });

let currentTargetW = 0;
let currentTargetH = 0;

let isVideoMode = false;
let isAiProcessing = false; 
let currentFacingMode = 'user'; 
let videoStream = null;
let animationFrameId = null;

// 【关键修复 1】任务令牌：每次切换模式或传图，生成新令牌，旧 AI 任务结果直接丢弃
let processToken = 0; 

// 1. 初始化模型
async function initModel() {
    try {
        statusDiv.innerText = '模型加载中... (约 40MB，首次加载请耐心等待)';
        ort.env.wasm.numThreads = 4; 
        const modelUrl = 'https://ghproxy.net/https://raw.githubusercontent.com/mingjinyi/cyber-patina/main/cyber_patina_lite0.onnx';
        session = await ort.InferenceSession.create(modelUrl, { executionProviders: ['wasm'] });
        
        statusDiv.innerText = '✅ 引擎就绪！请上传图片或开启摄像头。';
        statusDiv.style.color = '#00ffcc';
    } catch (e) {
        statusDiv.innerText = '❌ 模型加载失败: ' + e.message;
        statusDiv.style.color = 'red';
    }
}
initModel();

// ==========================================
// 模块 A：静态图片处理 
// ==========================================
document.getElementById('imageInput').addEventListener('change', (e) => {
    if (!session) return alert('引擎还在预热，请稍等！');
    const file = e.target.files[0];
    if (!file) return;

    stopVideoMode(); 
    processToken++; // 【关键修复 2】销毁残留的后台视频 AI 任务

    // UI 重置：隐藏所有内容，避免旧图残留
    sliderContainer.style.display = 'none';
    resultImage.style.display = 'none';
    canvas.style.display = 'none';

    const img = new Image();
    img.src = URL.createObjectURL(file);
    img.onload = () => {
        statusDiv.innerText = '⚙️ 正在注入静态包浆...';
        setupCanvasSize(img.width, img.height, 1024);
        originalCtx.drawImage(img, 0, 0, currentTargetW, currentTargetH);
        setTimeout(() => executeONNXInference(true), 50); 
    };

    e.target.value = ''; // 【关键修复 3】清空 input 值，确保连续传同一张图也能触发
});

// ==========================================
// 模块 B：实时视频处理控制
// ==========================================
startVideoBtn.addEventListener('click', async () => {
    if (!session) return alert('引擎还在预热，请稍等！');
    if (isVideoMode) {
        stopVideoMode();
        return;
    }
    await startCamera(currentFacingMode);
});

switchCameraBtn.addEventListener('click', async () => {
    currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
    await startCamera(currentFacingMode);
});

async function startCamera(facingMode) {
    stopVideoMode(); 
    try {
        videoStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: facingMode, width: { ideal: 640 }, height: { ideal: 480 } }
        });
        videoElement.srcObject = videoStream;
        videoElement.play();

        videoElement.onloadedmetadata = () => {
            isVideoMode = true;
            processToken++; // 切到视频，分配新令牌

            startVideoBtn.innerText = '🛑 关闭视觉';
            switchCameraBtn.style.display = 'inline-block';
            
            // 确保显示视频画布，隐藏静态图片
            sliderContainer.style.display = 'block';
            resultImage.style.display = 'none';
            canvas.style.display = 'inline-block';
            
            setupCanvasSize(videoElement.videoWidth, videoElement.videoHeight, 512);
            statusDiv.innerText = '🎥 实时视觉已连接！AI 正在后台拼命追赶帧率...';
            
            requestAnimationFrame(videoDisplayLoop); 
            videoInferenceLoop(); 
        };
    } catch (e) {
        alert("无法访问摄像头: " + e.message);
    }
}

function stopVideoMode() {
    isVideoMode = false;
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        videoStream = null;
    }
    videoElement.srcObject = null; // 【关键修复 4】彻底切断视频源
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    startVideoBtn.innerText = '🎥 开启实时视觉';
    switchCameraBtn.style.display = 'none';
}

function videoDisplayLoop() {
    if (!isVideoMode) return;

    originalCtx.save();
    if (currentFacingMode === 'user') {
        originalCtx.translate(currentTargetW, 0);
        originalCtx.scale(-1, 1);
    }
    originalCtx.drawImage(videoElement, 0, 0, currentTargetW, currentTargetH);
    originalCtx.restore();

    renderBlendedImage(intensityRange.value, false);
    animationFrameId = requestAnimationFrame(videoDisplayLoop);
}


async function videoInferenceLoop() {
    if (!isVideoMode) return;
    if (isAiProcessing) return; 
    
    isAiProcessing = true;
    await executeONNXInference(false); 
    isAiProcessing = false;

    if (isVideoMode) setTimeout(videoInferenceLoop, 50); 
}

// ==========================================
// 模块 C：核心底层逻辑
// ==========================================
function setupCanvasSize(w, h, maxDim) {
    let scale = Math.min(maxDim / w, maxDim / h, 1);
    currentTargetW = Math.round((w * scale) / 32) * 32;
    currentTargetH = Math.round((h * scale) / 32) * 32;

    canvas.width = currentTargetW; canvas.height = currentTargetH;
    originalCanvas.width = currentTargetW; originalCanvas.height = currentTargetH;
    onnxCanvas.width = currentTargetW; onnxCanvas.height = currentTargetH;
}

async function executeONNXInference(isStatic) {
    // 【关键修复 5】将全局尺寸在函数一开始就锁定为局部变量，防止 await 期间被意外修改
    const w = currentTargetW;
    const h = currentTargetH;
    if (w === 0 || h === 0) return;

    const myToken = processToken; // 认领当前任务令牌

    try {
        const imageData = originalCtx.getImageData(0, 0, w, h);
        const data = imageData.data; 

        const floatData = new Float32Array(3 * h * w);
        for (let i = 0; i < h * w; i++) {
            floatData[i] = (data[i * 4] / 127.5) - 1.0;                 
            floatData[h * w + i] = (data[i * 4 + 1] / 127.5) - 1.0; 
            floatData[2 * h * w + i] = (data[i * 4 + 2] / 127.5) - 1.0; 
        }
        
        const tensor = new ort.Tensor('float32', floatData, [1, 3, h, w]);
        const feeds = { 'input_image': tensor };

        const start = performance.now();
        const results = await session.run(feeds);
        
        // 【核心防御】如果执行期间令牌变了（说明用户传了新图或切了模式），直接扔掉计算结果！
        if (myToken !== processToken) return;

        const time = (performance.now() - start).toFixed(0);
        const outputData = results['output_image'].data;
        const outImgData = onnxCtx.createImageData(w, h);
        
        for (let i = 0; i < h * w; i++) {
            outImgData.data[i * 4] = Math.max(0, Math.min(255, (outputData[i] + 1.0) * 127.5));
            outImgData.data[i * 4 + 1] = Math.max(0, Math.min(255, (outputData[h * w + i] + 1.0) * 127.5));
            outImgData.data[i * 4 + 2] = Math.max(0, Math.min(255, (outputData[2 * h * w + i] + 1.0) * 127.5));
            outImgData.data[i * 4 + 3] = 255; 
        }
        onnxCtx.putImageData(outImgData, 0, 0);

        if (isStatic) {
            statusDiv.innerText = `✅ 包浆完成！耗时: ${time}ms。拖动滑块调节程度。`;
            sliderContainer.style.display = 'block';
            intensityRange.value = 100; intensityValue.innerText = "100";
            
            // 静态图处理完毕后，隐藏 canvas，显示 img 供用户长按保存
            canvas.style.display = 'none'; 
            renderBlendedImage(100, true);
        } else {
            if (Math.random() < 0.1) statusDiv.innerText = `🎥 视觉连接中... (AI处理单帧: ${time}ms)`;
        }
    } catch (e) {
        if (myToken === processToken) console.error("计算出错", e);
    }
}

intensityRange.addEventListener('input', (e) => {
    const val = e.target.value;
    intensityValue.innerText = val;
    if (!isVideoMode) renderBlendedImage(val, true);
});

function renderBlendedImage(intensity, updateResultImageElement = false) {
    const w = currentTargetW;
    const h = currentTargetH;
    if (w === 0 || h === 0) return;

    const ratio = intensity / 100.0; 

    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = 1.0;
    ctx.drawImage(originalCanvas, 0, 0); 
    ctx.globalAlpha = ratio;
    ctx.drawImage(onnxCanvas, 0, 0);     
    ctx.globalAlpha = 1.0;

    if (updateResultImageElement) {
        resultImage.src = canvas.toDataURL('image/jpeg', 1.0);
        resultImage.style.display = 'inline-block';
    }
}
