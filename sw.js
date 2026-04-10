const CACHE_NAME = 'patina-engine-v1';
// 这里填入你需要离线冻结的所有文件
const urlsToCache = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './0009.jpeg',
  './cyber_patina_lite0.onnx', // 👈 你的 40M 模型在这里被永久缓存！
  // 为了彻底断网运行，我们也把微软的库缓存下来
  'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js' 
];

// 安装阶段：把上面列表里的文件全部下载到本地
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('离线缓存注入中...');
        return cache.addAll(urlsToCache);
      })
  );
});

// 运行阶段：只要断网，就直接从缓存里把模型和代码掏出来
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // 如果缓存里有，直接返回缓存（秒开）；没有才去联网请求
        return response || fetch(event.request);
      })
  );
});