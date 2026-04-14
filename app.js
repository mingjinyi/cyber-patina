// ==========================================
// 赛博包浆引擎：纯前端 ONNX 推理核心
// ==========================================

const statusDiv = document.getElementById('status');
const canvas = document.getElementById('outputCanvas');
const ctx = canvas.getContext('2d');
let session;

// 1. 初始化并加载 ONNX 模型
async function initModel() {
    try {
        statusDiv.innerText = '模型加载中... (约 40MB，首次加载请耐心等待)';
        // 设置执行后端为 WebAssembly (wasm)，手机浏览器支持最好
        ort.env.wasm.numThreads = 4; 
        // session = await ort.InferenceSession.create('./cyber_patina_lite0.onnx', { executionProviders: ['wasm'] });
        // 使用国内高速镜像节点拉取模型
        const modelUrl = 'https://ghproxy.net/https://raw.githubusercontent.com/mingjinyi/cyber-patina/main/cyber_patina_lite0.onnx';

        session = await ort.InferenceSession.create(modelUrl, { executionProviders: ['wasm'] });
        statusDiv.innerText = '✅ 模型加载完毕！请上传照片。';
        statusDiv.style.color = '#00ffcc';
    } catch (e) {
        statusDiv.innerText = '❌ 模型加载失败: ' + e.message;
        statusDiv.style.color = 'red';
        console.error(e);
    }
}

initModel();

// 2. 监听图片上传
document.getElementById('imageInput').addEventListener('change', (e) => {
    if (!session) {
        alert('模型还没加载完，请稍等！');
        return;
    }
    const file = e.target.files[0];
    if (!file) return;

    const img = new Image();
    img.src = URL.createObjectURL(file);
    img.onload = () => {
        statusDiv.innerText = '⚙️ 正在注入包浆，手机发热是正常现象...';
        // 延迟一小会儿让 UI 刷新，再开始卡顿的推理计算
        setTimeout(() => runInference(img), 100); 
    };
});

// 3. 核心计算：图片转张量 -> 推理 -> 张量转图片
async function runInference(img) {
    try {
        // --- A. 尺寸预处理 ---
        // 限制手机端最大分辨率为 512，防止内存爆炸，且长宽必须是 32 的倍数（U-Net特性）
        const maxSize = 1024;
        let scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
        let targetW = Math.round((img.width * scale) / 32) * 32;
        let targetH = Math.round((img.height * scale) / 32) * 32;

        canvas.width = targetW;
        canvas.height = targetH;
        ctx.drawImage(img, 0, 0, targetW, targetH);
        
        // 提取像素数据
        const imageData = ctx.getImageData(0, 0, targetW, targetH);
        const data = imageData.data; // [R,G,B,A, R,G,B,A...]

        // --- B. 构造 Float32Array 张量输入 (1, 3, H, W) ---
        const floatData = new Float32Array(3 * targetH * targetW);
        for (let i = 0; i < targetH * targetW; i++) {
            // JS 是 RGBA，我们提取 RGB，并做归一化 (x/127.5 - 1.0) 映射到 [-1, 1]
            floatData[i] = (data[i * 4] / 127.5) - 1.0;                 // Red
            floatData[targetH * targetW + i] = (data[i * 4 + 1] / 127.5) - 1.0; // Green
            floatData[2 * targetH * targetW + i] = (data[i * 4 + 2] / 127.5) - 1.0; // Blue
        }
        
        // 我们在导出 ONNX 时叫 'input_image'
        const tensor = new ort.Tensor('float32', floatData, [1, 3, targetH, targetW]);
        const feeds = { 'input_image': tensor };

        // --- C. 执行推理！燃尽手机算力 ---
        const start = performance.now();
        const results = await session.run(feeds);
        const time = (performance.now() - start).toFixed(2);
        
        // --- D. 后处理还原 ---
        // 拿到的输出是 'output_image'，值域是 [-1, 1]
        const outputData = results['output_image'].data;
        const outImgData = ctx.createImageData(targetW, targetH);
        
        for (let i = 0; i < targetH * targetW; i++) {
            // 从 [-1, 1] 映射回 [0, 255]
            let r = (outputData[i] + 1.0) * 127.5;
            let g = (outputData[targetH * targetW + i] + 1.0) * 127.5;
            let b = (outputData[2 * targetH * targetW + i] + 1.0) * 127.5;

            outImgData.data[i * 4] = Math.max(0, Math.min(255, r));
            outImgData.data[i * 4 + 1] = Math.max(0, Math.min(255, g));
            outImgData.data[i * 4 + 2] = Math.max(0, Math.min(255, b));
            outImgData.data[i * 4 + 3] = 255; // Alpha 通道设为不透明
        }

        // 把包浆图画到屏幕上
        ctx.putImageData(outImgData, 0, 0);
        const resultImage = document.getElementById('resultImage');
        resultImage.src = canvas.toDataURL('image/jpeg', 1.0);
        
        // 显示真正的图片
        resultImage.style.display = 'inline-block';

        statusDiv.innerText = `✅ 包浆完成！耗时: ${time} 毫秒。长按下方图片即可保存。`;
        statusDiv.style.color = '#00ffcc';
    } catch (e) {
        statusDiv.innerText = '❌ 计算出错: ' + e.message;
        statusDiv.style.color = 'red';
        console.error(e);
    }
}