(() => {
    const panel = document.getElementById('archiveGpsPanel');
    const startButton = document.getElementById('gpsStartButton');
    const stopButton = document.getElementById('gpsStopButton');
    const status = document.getElementById('gpsStatus');
    const liveBadge = document.getElementById('gpsLiveBadge');
    const historyBody = document.getElementById('gpsHistoryBody');
    const recordCount = document.getElementById('gpsRecordCount');
    const fields = {
        latitude: document.getElementById('gpsLatitude'),
        longitude: document.getElementById('gpsLongitude'),
        speed: document.getElementById('gpsSpeed'),
        speedSource: document.getElementById('gpsSpeedSource'),
        accuracy: document.getElementById('gpsAccuracy'),
        altitude: document.getElementById('gpsAltitude'),
        heading: document.getElementById('gpsHeading')
    };

    if (!panel || !startButton || !historyBody) return;

    let watchId = null;
    let sampleTimer = null;
    let latestPosition = null;
    let previousFix = null;
    let calculatedSpeed = null;
    let records = [];

    const numberOrNull = (value) => Number.isFinite(value) ? value : null;
    const display = (value, digits = 1) => value === null ? '—' : value.toFixed(digits);

    function setBadge(state, label) {
        liveBadge.dataset.state = state;
        liveBadge.querySelector('span').textContent = label;
    }

    function distanceMeters(a, b) {
        const radius = 6371000;
        const toRadians = (degrees) => degrees * Math.PI / 180;
        const latitudeDelta = toRadians(b.latitude - a.latitude);
        const longitudeDelta = toRadians(b.longitude - a.longitude);
        const latitude1 = toRadians(a.latitude);
        const latitude2 = toRadians(b.latitude);
        const haversine = Math.sin(latitudeDelta / 2) ** 2
            + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(longitudeDelta / 2) ** 2;
        return 2 * radius * Math.asin(Math.sqrt(haversine));
    }

    function updatePosition(position) {
        const currentFix = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            timestamp: position.timestamp
        };

        calculatedSpeed = null;
        if (previousFix && currentFix.timestamp > previousFix.timestamp) {
            const seconds = (currentFix.timestamp - previousFix.timestamp) / 1000;
            calculatedSpeed = distanceMeters(previousFix, currentFix) / seconds;
        }
        previousFix = currentFix;
        latestPosition = position;
        renderCurrent();
        status.textContent = '定位已连接，正在每秒记录。';
        setBadge('live', '实时更新');
    }

    function getSpeed() {
        const nativeSpeed = numberOrNull(latestPosition?.coords.speed);
        if (nativeSpeed !== null && nativeSpeed >= 0) return { metersPerSecond: nativeSpeed, source: '设备速度 · km/h' };
        if (calculatedSpeed !== null && calculatedSpeed >= 0) return { metersPerSecond: calculatedSpeed, source: '估算速度 · km/h' };
        return { metersPerSecond: null, source: 'km/h' };
    }

    function renderCurrent() {
        if (!latestPosition) return;
        const coords = latestPosition.coords;
        const speed = getSpeed();
        fields.latitude.textContent = coords.latitude.toFixed(6);
        fields.longitude.textContent = coords.longitude.toFixed(6);
        fields.speed.textContent = display(speed.metersPerSecond === null ? null : speed.metersPerSecond * 3.6);
        fields.speedSource.textContent = speed.source;
        fields.accuracy.textContent = display(numberOrNull(coords.accuracy), 0);
        fields.altitude.textContent = display(numberOrNull(coords.altitude), 1);
        fields.heading.textContent = display(numberOrNull(coords.heading), 0);
    }

    function renderHistory() {
        recordCount.textContent = `${records.length} / 10`;
        if (!records.length) {
            historyBody.innerHTML = '<tr class="gps-empty-row"><td colspan="5">正在等待第一条定位数据…</td></tr>';
            return;
        }
        historyBody.innerHTML = records.map((record) => `
            <tr>
                <td>${record.time}</td>
                <td>${record.latitude}</td>
                <td>${record.longitude}</td>
                <td>${record.speed}</td>
                <td>${record.accuracy}</td>
            </tr>`).join('');
    }

    function captureRecord() {
        if (!latestPosition) return;
        const coords = latestPosition.coords;
        const speed = getSpeed().metersPerSecond;
        records.unshift({
            time: new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date()),
            latitude: coords.latitude.toFixed(6),
            longitude: coords.longitude.toFixed(6),
            speed: speed === null ? '—' : `${(speed * 3.6).toFixed(1)} km/h`,
            accuracy: `${display(numberOrNull(coords.accuracy), 0)} m`
        });
        records = records.slice(0, 10);
        renderHistory();
    }

    function handleError(error) {
        const messages = {
            1: '定位权限被拒绝，请在浏览器设置中允许此网站访问位置。',
            2: '暂时无法获取位置，请确认设备定位服务已开启。',
            3: '获取位置超时，正在继续尝试。'
        };
        status.textContent = messages[error.code] || '获取位置时出现错误，请稍后重试。';
        setBadge('error', error.code === 3 ? '等待信号' : '定位失败');
        if (error.code === 1) stopTracking(false);
    }

    function startTracking() {
        if (watchId !== null) return;
        if (!window.isSecureContext) {
            status.textContent = '浏览器只允许 HTTPS 网站使用定位，请通过安全地址访问。';
            setBadge('error', '需要 HTTPS');
            return;
        }
        if (!('geolocation' in navigator)) {
            status.textContent = '当前浏览器或设备不支持地理定位。';
            setBadge('error', '不受支持');
            return;
        }

        status.textContent = '正在请求定位权限并搜索 GPS 信号…';
        setBadge('idle', '正在连接');
        startButton.disabled = true;
        stopButton.disabled = false;
        watchId = navigator.geolocation.watchPosition(updatePosition, handleError, {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 15000
        });
        sampleTimer = window.setInterval(captureRecord, 1000);
    }

    function stopTracking(showMessage = true) {
        if (watchId !== null) navigator.geolocation.clearWatch(watchId);
        if (sampleTimer !== null) window.clearInterval(sampleTimer);
        watchId = null;
        sampleTimer = null;
        latestPosition = null;
        previousFix = null;
        calculatedSpeed = null;
        startButton.disabled = false;
        stopButton.disabled = true;
        if (showMessage) {
            status.textContent = '定位已停止，可以随时重新开始。';
            setBadge('idle', '已停止');
        }
    }

    startButton.addEventListener('click', startTracking);
    stopButton.addEventListener('click', () => stopTracking());
    document.addEventListener('archiveappopen', (event) => {
        if (event.detail?.app === 'gps') startTracking();
    });
    document.addEventListener('archiveappclose', (event) => {
        if (event.detail?.app !== 'gps') return;
        stopTracking(false);
        setBadge('idle', '等待授权');
        status.textContent = '打开应用后将请求定位权限。';
    });
})();
