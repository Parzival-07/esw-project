// MQTT Configuration - Replace with your HiveMQ cluster details
const MQTT_CONFIG = {
    host: '4809a06803844080a705e76187cf49ce.s1.eu.hivemq.cloud',  // Replace with your cluster URL
    port: 8884,  // WSS port for HiveMQ Cloud
    username: 'DC_Motor',  // Replace with your username
    password: 'EWS_Lab4',  // Replace with your password
    clientId: 'motor-dashboard-' + Math.random().toString(16).substr(2, 8)
};

// MQTT Topics
const TOPICS = {
    MOTOR_DATA: 'esp32/motor/data',
    MOTOR_CONTROL: 'esp32/motor/control',
    MOTOR_STATUS: 'esp32/motor/status'
};

// Global variables
let mqttClient = null;
let rpmChart = null;
let pwmChart = null;
let calibrationChart = null;
let comparisonChart = null;
let pOnlyChart = null;
let piOnlyChart = null;
let pidFullChart = null;
let dataPoints = 0;
let lastUpdateTime = null;
let isCalibrated = false;
let currentMode = 'speed'; // 'speed' or 'position'
let isCalibrating = false; // Track if autotuning is in progress
let currentPIDMode = 'PID'; // 'P', 'PI', or 'PID'
let recordingComparison = false; // Track if we're recording for comparison
let comparisonStartTime = null;

// Chart configuration
const CHART_CONFIG = {
    maxDataPoints: 50,
    updateInterval: 1000
};

// Storage for chart data (for CSV export)
const chartDataStorage = {
    rpm: { labels: [], targetRPM: [], currentRPM: [] },
    pwm: { labels: [], values: [] },
    calibration: { labels: [], targetRPM: [], currentRPM: [] },
    comparison: { 
        labels: [], 
        setpoint: [], 
        pOnly: [], 
        piOnly: [], 
        pidFull: [] 
    },
    pOnly: { labels: [], targetRPM: [], currentRPM: [] },
    piOnly: { labels: [], targetRPM: [], currentRPM: [] },
    pidFull: { labels: [], targetRPM: [], currentRPM: [] }
};

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    initializeMQTT();
    initializeCharts();
    setupEventListeners();
    setupDownloadListeners();
    updateSystemInfo();
});

// MQTT Functions
function initializeMQTT() {
    console.log('Connecting to MQTT broker...');
    
    const options = {
        clientId: MQTT_CONFIG.clientId,
        username: MQTT_CONFIG.username,
        password: MQTT_CONFIG.password,
        connectTimeout: 4000,
        reconnectPeriod: 1000,
    };

    const connectUrl = `wss://${MQTT_CONFIG.host}:${MQTT_CONFIG.port}/mqtt`;
    
    try {
        mqttClient = mqtt.connect(connectUrl, options);
        
        mqttClient.on('connect', function() {
            console.log('Connected to MQTT broker');
            updateConnectionStatus(true);
            subscribeToTopics();
        });
        
        mqttClient.on('error', function(error) {
            console.error('MQTT connection error:', error);
            updateConnectionStatus(false);
        });
        
        mqttClient.on('close', function() {
            console.log('MQTT connection closed');
            updateConnectionStatus(false);
        });
        
        mqttClient.on('message', function(topic, message) {
            handleMQTTMessage(topic, message.toString());
        });
        
    } catch (error) {
        console.error('Failed to connect to MQTT:', error);
        updateConnectionStatus(false);
    }
}

function subscribeToTopics() {
    if (!mqttClient) return;
    
    mqttClient.subscribe([
        TOPICS.MOTOR_DATA,
        TOPICS.MOTOR_STATUS
    ], function(err) {
        if (!err) {
            console.log('Subscribed to MQTT topics');
        } else {
            console.error('Failed to subscribe to topics:', err);
        }
    });
}

function publishMQTTMessage(topic, message) {
    if (!mqttClient || !mqttClient.connected) {
        console.warn('MQTT client not connected');
        showNotification('MQTT not connected', 'error');
        return false;
    }
    
    mqttClient.publish(topic, message, { qos: 1 }, function(err) {
        if (err) {
            console.error('Failed to publish message:', err);
            showNotification('Failed to send command', 'error');
        } else {
            console.log(`Published to ${topic}: ${message}`);
        }
    });
    
    return true;
}

function handleMQTTMessage(topic, message) {
    console.log(`Received message from ${topic}: ${message}`);
    
    try {
        switch (topic) {
            case TOPICS.MOTOR_DATA:
                const motorData = JSON.parse(message);
                updateMotorData(motorData);
                break;
                
            case TOPICS.MOTOR_STATUS:
                const statusData = JSON.parse(message);
                updateMotorStatus(statusData);
                break;
                
            default:
                console.warn('Unknown topic:', topic);
        }
    } catch (error) {
        console.error('Error parsing MQTT message:', error);
    }
}

// Data Update Functions
function updateMotorData(data) {
    // Update metric displays
    updateElement('current-rpm', data.currentRPM, 1);
    updateElement('display-target-rpm', data.targetRPM, 1);
    updateElement('pwm-value', data.pwmValue);
    updateElement('current-angle', data.currentAngle ?? 0, 1);
    updateElement('display-target-angle', data.targetAngle ?? 0, 1);
    
    // Update PID gains if present
    if (data.Kp !== undefined) updateElement('pid-kp', data.Kp, 4);
    if (data.Ki !== undefined) updateElement('pid-ki', data.Ki, 4);
    if (data.Kd !== undefined) updateElement('pid-kd', data.Kd, 4);
    
    // Update position PID gains if present
    if (data.posKp !== undefined) updateElement('pid-pos-kp', data.posKp, 4);
    if (data.posKi !== undefined) updateElement('pid-pos-ki', data.posKi, 4);
    if (data.posKd !== undefined) updateElement('pid-pos-kd', data.posKd, 4);
    
    // Update PID mode display if received from ESP32
    if (data.pidMode && data.pidMode !== currentPIDMode) {
        currentPIDMode = data.pidMode;
        document.querySelectorAll('[id^="pid-mode-"]').forEach(btn => btn.classList.remove('active'));
        document.getElementById(`pid-mode-${data.pidMode.toLowerCase()}`)?.classList.add('active');
        const activeModeEl = document.getElementById('active-pid-mode');
        if (activeModeEl) {
            activeModeEl.textContent = data.pidMode;
            activeModeEl.style.color = data.pidMode === 'P' ? '#ef4444' : data.pidMode === 'PI' ? '#f59e0b' : '#a855f7';
        }
    }
    
    // Calculate and display error percentages
    const speedErr = (Math.abs(data.targetRPM) > 0.0001) ?
        Math.abs((data.targetRPM - data.currentRPM) / data.targetRPM * 100) : 0;
    const posErr = (Math.abs(data.targetAngle) > 0.0001) ?
        Math.abs((data.targetAngle - data.currentAngle) / data.targetAngle * 100) : 0;
    updateElement('speed-error-percent', speedErr, 1);
    updateElement('position-error-percent', posErr, 1);
    
    // Update motor direction
    updateMotorDirection(data.targetRPM);
    
    // Update charts
    updateCharts(data);
    
    // Update system info
    dataPoints++;
    lastUpdateTime = new Date();
    updateSystemInfo();
}

function updateMotorStatus(data) {
    const statusText = data.status || 'Unknown';
    const statusEl = document.getElementById('esp32-status');
    if (statusEl) statusEl.textContent = statusText;
    const calibEl = document.getElementById('calibration-status');
    if (calibEl && statusText) {
        calibEl.textContent = statusText;
        
        // Detect autotuning start
        if (/autotuning/i.test(statusText) && !/complete/i.test(statusText)) {
            isCalibrating = true;
            console.log('Autotuning started - recording calibration data');
        }
        
        // Detect autotune completion - check for Kp/Ki/Kd in status message
        if (/autotuning complete/i.test(statusText) || /Kp=/i.test(statusText)) {
            isCalibrating = false;
            isCalibrated = true;
            enableControls();
            showNotification('Calibration completed! ' + statusText, 'success');
            console.log('Autotuning complete - stopped recording calibration data');
        }
        // Show other status updates
        if (/autotune/i.test(statusText) || /position reached/i.test(statusText)) {
            showNotification(statusText, 'info');
        }
    }
}

function updateElement(elementId, value, decimals = 0) {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = typeof value === 'number' ? 
            value.toFixed(decimals) : value;
        element.classList.add('updating');
        setTimeout(() => element.classList.remove('updating'), 300);
    }
}

function updateMotorDirection(targetRPM) {
    const directionElement = document.getElementById('motor-direction');
    let direction, color;
    
    if (Math.abs(targetRPM) < 0.1) {
        direction = 'STOPPED';
        color = '#64748b';
    } else if (targetRPM > 0) {
        direction = 'FORWARD';
        color = '#10b981';
    } else {
        direction = 'REVERSE';
        color = '#f59e0b';
    }
    
    directionElement.textContent = direction;
    directionElement.style.color = color;
}

function updateConnectionStatus(connected) {
    const statusElement = document.getElementById('mqtt-status');
    const statusText = statusElement.querySelector('span');
    
    if (connected) {
        statusElement.className = 'status-indicator connected';
        statusText.textContent = 'Connected';
    } else {
        statusElement.className = 'status-indicator disconnected';
        statusText.textContent = 'Disconnected';
    }
}

function updateSystemInfo() {
    document.getElementById('data-points').textContent = dataPoints;
    document.getElementById('last-update').textContent = 
        lastUpdateTime ? lastUpdateTime.toLocaleTimeString() : 'Never';
}

// Chart Functions
function initializeCharts() {
    // RPM Chart with auto-scaling (integer steps)
    const rpmCtx = document.getElementById('rpm-chart').getContext('2d');
    rpmChart = new Chart(rpmCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Target RPM',
                    data: [],
                    borderColor: '#667eea',
                    backgroundColor: 'rgba(102, 126, 234, 0.1)',
                    tension: 0.4,
                    pointRadius: 2
                },
                {
                    label: 'Actual RPM',
                    data: [],
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    tension: 0.4,
                    pointRadius: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    // Auto-scale to show oscillations clearly with integer steps of 1
                    beginAtZero: false,
                    grid: { color: 'rgba(0, 0, 0, 0.1)' },
                    ticks: {
                        stepSize: 1,
                        callback: function(value) {
                            return Math.round(value);
                        }
                    }
                },
                x: {
                    grid: { color: 'rgba(0, 0, 0, 0.1)' }
                }
            },
            plugins: {
                legend: {
                    position: 'top'
                }
            }
        }
    });
    
    // PWM Chart
    const pwmCtx = document.getElementById('pwm-chart').getContext('2d');
    pwmChart = new Chart(pwmCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'PWM Value',
                data: [],
                borderColor: '#f59e0b',
                backgroundColor: 'rgba(245, 158, 11, 0.1)',
                tension: 0.4,
                pointRadius: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    min: 0,
                    max: 255,
                    grid: { color: 'rgba(0, 0, 0, 0.1)' }
                },
                x: {
                    grid: { color: 'rgba(0, 0, 0, 0.1)' }
                }
            },
            plugins: {
                legend: {
                    position: 'top'
                }
            }
        }
    });

    // Calibration Oscillation Chart (150 RPM base)
    const calibrationCtx = document.getElementById('calibration-chart').getContext('2d');
    calibrationChart = new Chart(calibrationCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: '150 RPM Baseline',
                    data: [],
                    borderColor: '#ef4444',
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    borderDash: [10, 5],
                    pointRadius: 0,
                    fill: false,
                    tension: 0
                },
                {
                    label: 'Target RPM',
                    data: [],
                    borderColor: '#667eea',
                    backgroundColor: 'rgba(102, 126, 234, 0.1)',
                    tension: 0.4,
                    pointRadius: 2
                },
                {
                    label: 'Actual RPM',
                    data: [],
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    tension: 0.4,
                    pointRadius: 2,
                    fill: true
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    min: 100,  // Base around 150 RPM
                    max: 200,  // Show range 100-200 to capture oscillations
                    grid: { color: 'rgba(0, 0, 0, 0.1)' },
                    ticks: {
                        callback: function(value) {
                            return value.toFixed(1);
                        }
                    }
                },
                x: {
                    grid: { color: 'rgba(0, 0, 0, 0.1)' }
                }
            },
            plugins: {
                legend: {
                    position: 'top'
                }
            }
        }
    });

    // PID Comparison Chart (for comparing P, PI, and PID responses) - AUTO-SCALED with integer steps
    const comparisonCtx = document.getElementById('comparison-chart').getContext('2d');
    comparisonChart = new Chart(comparisonCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Setpoint (Target)',
                    data: [],
                    borderColor: '#3b82f6',
                    backgroundColor: 'transparent',
                    borderWidth: 3,
                    borderDash: [10, 5],
                    pointRadius: 0,
                    fill: false,
                    tension: 0
                },
                {
                    label: 'P-only (Red)',
                    data: [],
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    tension: 0.4,
                    pointRadius: 1,
                    fill: false
                },
                {
                    label: 'PI-only (Orange)',
                    data: [],
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                    tension: 0.4,
                    pointRadius: 1,
                    fill: false
                },
                {
                    label: 'Full PID (Purple)',
                    data: [],
                    borderColor: '#a855f7',
                    backgroundColor: 'rgba(168, 85, 247, 0.1)',
                    tension: 0.4,
                    pointRadius: 1,
                    fill: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    // Auto-scale to show oscillations clearly with integer steps of 1
                    beginAtZero: false,
                    grid: { color: 'rgba(0, 0, 0, 0.1)' },
                    ticks: {
                        stepSize: 1,
                        callback: function(value) {
                            return Math.round(value);
                        }
                    }
                },
                x: {
                    grid: { color: 'rgba(0, 0, 0, 0.1)' }
                }
            },
            plugins: {
                legend: {
                    position: 'top'
                }
            }
        }
    });

    // P-only Individual Chart - AUTO-SCALED with integer steps
    const pOnlyCtx = document.getElementById('p-only-chart').getContext('2d');
    pOnlyChart = new Chart(pOnlyCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Target RPM',
                    data: [],
                    borderColor: '#667eea',
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    borderDash: [10, 5],
                    pointRadius: 0,
                    fill: false,
                    tension: 0
                },
                {
                    label: 'P-only Response',
                    data: [],
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    tension: 0.4,
                    pointRadius: 2,
                    fill: true
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: false,
                    grid: { color: 'rgba(0, 0, 0, 0.1)' },
                    ticks: {
                        stepSize: 1,
                        callback: function(value) {
                            return Math.round(value);
                        }
                    }
                },
                x: {
                    grid: { color: 'rgba(0, 0, 0, 0.1)' }
                }
            },
            plugins: {
                legend: {
                    position: 'top'
                }
            }
        }
    });

    // PI-only Individual Chart - AUTO-SCALED with integer steps
    const piOnlyCtx = document.getElementById('pi-only-chart').getContext('2d');
    piOnlyChart = new Chart(piOnlyCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Target RPM',
                    data: [],
                    borderColor: '#667eea',
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    borderDash: [10, 5],
                    pointRadius: 0,
                    fill: false,
                    tension: 0
                },
                {
                    label: 'PI-only Response',
                    data: [],
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                    tension: 0.4,
                    pointRadius: 2,
                    fill: true
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: false,
                    grid: { color: 'rgba(0, 0, 0, 0.1)' },
                    ticks: {
                        stepSize: 1,
                        callback: function(value) {
                            return Math.round(value);
                        }
                    }
                },
                x: {
                    grid: { color: 'rgba(0, 0, 0, 0.1)' }
                }
            },
            plugins: {
                legend: {
                    position: 'top'
                }
            }
        }
    });

    // Full PID Individual Chart - AUTO-SCALED with integer steps
    const pidFullCtx = document.getElementById('pid-full-chart').getContext('2d');
    pidFullChart = new Chart(pidFullCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Target RPM',
                    data: [],
                    borderColor: '#667eea',
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    borderDash: [10, 5],
                    pointRadius: 0,
                    fill: false,
                    tension: 0
                },
                {
                    label: 'Full PID Response',
                    data: [],
                    borderColor: '#a855f7',
                    backgroundColor: 'rgba(168, 85, 247, 0.1)',
                    tension: 0.4,
                    pointRadius: 2,
                    fill: true
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: false,
                    grid: { color: 'rgba(0, 0, 0, 0.1)' },
                    ticks: {
                        stepSize: 1,
                        callback: function(value) {
                            return Math.round(value);
                        }
                    }
                },
                x: {
                    grid: { color: 'rgba(0, 0, 0, 0.1)' }
                }
            },
            plugins: {
                legend: {
                    position: 'top'
                }
            }
        }
    });
}

function updateCharts(data) {
    const currentTime = new Date().toLocaleTimeString();
    
    // Update RPM chart
    rpmChart.data.labels.push(currentTime);
    rpmChart.data.datasets[0].data.push(data.targetRPM);
    rpmChart.data.datasets[1].data.push(data.currentRPM);
    
    // Store for CSV export (keep all data)
    chartDataStorage.rpm.labels.push(currentTime);
    chartDataStorage.rpm.targetRPM.push(data.targetRPM);
    chartDataStorage.rpm.currentRPM.push(data.currentRPM);
    
    // Update PWM chart
    pwmChart.data.labels.push(currentTime);
    pwmChart.data.datasets[0].data.push(data.pwmValue);
    
    chartDataStorage.pwm.labels.push(currentTime);
    chartDataStorage.pwm.values.push(data.pwmValue);
    
    // Update Calibration chart ONLY during autotuning
    if (isCalibrating) {
        calibrationChart.data.labels.push(currentTime);
        calibrationChart.data.datasets[0].data.push(150); // 150 RPM baseline
        calibrationChart.data.datasets[1].data.push(data.targetRPM);
        calibrationChart.data.datasets[2].data.push(data.currentRPM);
        
        chartDataStorage.calibration.labels.push(currentTime);
        chartDataStorage.calibration.targetRPM.push(data.targetRPM);
        chartDataStorage.calibration.currentRPM.push(data.currentRPM);
        
        // No limit on calibration data points - keep all until cleared
        calibrationChart.update('none');
    }
    
    // Limit data points to prevent memory issues (for display only, storage keeps all)
    if (rpmChart.data.labels.length > CHART_CONFIG.maxDataPoints) {
        rpmChart.data.labels.shift();
        rpmChart.data.datasets[0].data.shift();
        rpmChart.data.datasets[1].data.shift();
        
        pwmChart.data.labels.shift();
        pwmChart.data.datasets[0].data.shift();
    }
    
    rpmChart.update('none');
    pwmChart.update('none');
    
    // Update Comparison chart if recording
    if (recordingComparison && data.pidMode) {
        const timeElapsed = ((Date.now() - comparisonStartTime) / 1000).toFixed(1) + 's';
        comparisonChart.data.labels.push(timeElapsed);
        comparisonChart.data.datasets[0].data.push(data.targetRPM); // Setpoint
        
        // Add data to appropriate dataset based on current mode
        const pIdx = 1, piIdx = 2, pidIdx = 3;
        comparisonChart.data.datasets[pIdx].data.push(data.pidMode === 'P' ? data.currentRPM : null);
        comparisonChart.data.datasets[piIdx].data.push(data.pidMode === 'PI' ? data.currentRPM : null);
        comparisonChart.data.datasets[pidIdx].data.push(data.pidMode === 'PID' ? data.currentRPM : null);
        
        // Store for CSV
        chartDataStorage.comparison.labels.push(timeElapsed);
        chartDataStorage.comparison.setpoint.push(data.targetRPM);
        if (data.pidMode === 'P') chartDataStorage.comparison.pOnly.push(data.currentRPM);
        if (data.pidMode === 'PI') chartDataStorage.comparison.piOnly.push(data.currentRPM);
        if (data.pidMode === 'PID') chartDataStorage.comparison.pidFull.push(data.currentRPM);
        
        comparisonChart.update('none');
        
        // Update individual charts based on current mode
        if (data.pidMode === 'P') {
            pOnlyChart.data.labels.push(timeElapsed);
            pOnlyChart.data.datasets[0].data.push(data.targetRPM);
            pOnlyChart.data.datasets[1].data.push(data.currentRPM);
            chartDataStorage.pOnly.labels.push(timeElapsed);
            chartDataStorage.pOnly.targetRPM.push(data.targetRPM);
            chartDataStorage.pOnly.currentRPM.push(data.currentRPM);
            pOnlyChart.update('none');
        } else if (data.pidMode === 'PI') {
            piOnlyChart.data.labels.push(timeElapsed);
            piOnlyChart.data.datasets[0].data.push(data.targetRPM);
            piOnlyChart.data.datasets[1].data.push(data.currentRPM);
            chartDataStorage.piOnly.labels.push(timeElapsed);
            chartDataStorage.piOnly.targetRPM.push(data.targetRPM);
            chartDataStorage.piOnly.currentRPM.push(data.currentRPM);
            piOnlyChart.update('none');
        } else if (data.pidMode === 'PID') {
            pidFullChart.data.labels.push(timeElapsed);
            pidFullChart.data.datasets[0].data.push(data.targetRPM);
            pidFullChart.data.datasets[1].data.push(data.currentRPM);
            chartDataStorage.pidFull.labels.push(timeElapsed);
            chartDataStorage.pidFull.targetRPM.push(data.targetRPM);
            chartDataStorage.pidFull.currentRPM.push(data.currentRPM);
            pidFullChart.update('none');
        }
    }
}

// Event Listeners
function setupEventListeners() {
    // Calibration
    const calibSpeedBtn = document.getElementById('calibrate-speed-btn');
    const calibPosBtn = document.getElementById('calibrate-position-btn');
    const skipBtn = document.getElementById('skip-calibration');
    
    calibSpeedBtn?.addEventListener('click', () => {
        const cmd = { command: 'tuneSpeed' };
        if (publishMQTTMessage(TOPICS.MOTOR_CONTROL, JSON.stringify(cmd))) {
            isCalibrating = true;
            document.getElementById('calibration-status').textContent = 'Tuning Speed PID...';
            showNotification('Speed PID Autotune started - recording oscillations around 150 RPM', 'info');
        }
    });
    
    calibPosBtn?.addEventListener('click', () => {
        const cmd = { command: 'tunePosition' };
        if (publishMQTTMessage(TOPICS.MOTOR_CONTROL, JSON.stringify(cmd))) {
            isCalibrating = true;
            document.getElementById('calibration-status').textContent = 'Tuning Position PID...';
            showNotification('Position PID Autotune started - recording oscillations around 150 RPM', 'info');
        }
    });
    
    skipBtn?.addEventListener('click', () => {
        isCalibrated = true;
        enableControls();
        document.getElementById('calibration-status').textContent = 'Skipped';
        showNotification('Calibration skipped. You can calibrate later.', 'warning');
    });

    // PID mode buttons
    document.getElementById('pid-mode-p')?.addEventListener('click', () => setPIDMode('P'));
    document.getElementById('pid-mode-pi')?.addEventListener('click', () => setPIDMode('PI'));
    document.getElementById('pid-mode-pid')?.addEventListener('click', () => setPIDMode('PID'));

    // Mode toggle
    const rpmBtn = document.getElementById('mode-rpm-btn');
    const posBtn = document.getElementById('mode-pos-btn');
    rpmBtn?.addEventListener('click', () => setMode('speed'));
    posBtn?.addEventListener('click', () => setMode('position'));

    // Set RPM button
    document.getElementById('set-rpm-btn').addEventListener('click', function() {
        const targetRPM = parseFloat(document.getElementById('target-rpm').value);
        sendRPMCommand(targetRPM);
    });
    
    // Enter key on RPM input
    document.getElementById('target-rpm').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            const targetRPM = parseFloat(this.value);
            sendRPMCommand(targetRPM);
        }
    });
    
    // Quick RPM buttons
    document.getElementById('quick-rpm-60')?.addEventListener('click', () => setQuickRPM(60));
    document.getElementById('quick-rpm-0')?.addEventListener('click', () => setQuickRPM(0));
    document.getElementById('quick-rpm--60')?.addEventListener('click', () => setQuickRPM(-60));

    // Angle controls
    document.getElementById('set-angle-btn')?.addEventListener('click', () => {
        const angle = parseFloat(document.getElementById('target-angle').value);
        sendAngleCommand(angle);
    });
    document.getElementById('target-angle')?.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            const angle = parseFloat(this.value);
            sendAngleCommand(angle);
        }
    });
    document.getElementById('quick-ang--90')?.addEventListener('click', () => setQuickAngle(-90));
    document.getElementById('quick-ang-0')?.addEventListener('click', () => setQuickAngle(0));
    document.getElementById('quick-ang-90')?.addEventListener('click', () => setQuickAngle(90));
}

function setQuickRPM(rpm) {
    document.getElementById('target-rpm').value = rpm;
    sendRPMCommand(rpm);
}

function sendRPMCommand(rpm) {
    if (isNaN(rpm)) {
        showNotification('Please enter a valid RPM value', 'error');
        return;
    }
    
    if (rpm < -350 || rpm > 350) {
        showNotification('RPM must be between -350 and 350', 'error');
        return;
    }
    
    const command = { targetRPM: rpm };
    
    if (publishMQTTMessage(TOPICS.MOTOR_CONTROL, JSON.stringify(command))) {
        showNotification(`RPM set to ${rpm}`, 'success');
    }
}

function sendAngleCommand(angle) {
    if (isNaN(angle)) {
        showNotification('Please enter a valid angle value', 'error');
        return;
    }
    if (angle < -1080 || angle > 1080) {
        showNotification('Angle must be between -1080° and 1080°', 'error');
        return;
    }

    const command = { targetAngle: angle };
    if (publishMQTTMessage(TOPICS.MOTOR_CONTROL, JSON.stringify(command))) {
        showNotification(`Angle set to ${angle}°`, 'success');
    }
}

function setQuickAngle(angle) {
    const input = document.getElementById('target-angle');
    input.value = angle;
    sendAngleCommand(angle);
}

function setMode(mode) {
    if (mode !== 'speed' && mode !== 'position') return;
    currentMode = mode;
    const rpmControls = document.getElementById('rpm-controls');
    const posControls = document.getElementById('position-controls');
    const rpmBtn = document.getElementById('mode-rpm-btn');
    const posBtn = document.getElementById('mode-pos-btn');
    if (mode === 'speed') {
        rpmControls.style.display = '';
        posControls.style.display = 'none';
        rpmBtn.classList.add('active');
        posBtn.classList.remove('active');
    } else {
        rpmControls.style.display = 'none';
        posControls.style.display = '';
        rpmBtn.classList.remove('active');
        posBtn.classList.add('active');
    }
}

function setPIDMode(mode) {
    if (!['P', 'PI', 'PID'].includes(mode)) return;
    
    currentPIDMode = mode;
    
    // Update UI buttons
    document.querySelectorAll('[id^="pid-mode-"]').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`pid-mode-${mode.toLowerCase()}`)?.classList.add('active');
    
    // Update active mode display
    const activeModeEl = document.getElementById('active-pid-mode');
    if (activeModeEl) {
        activeModeEl.textContent = mode;
        activeModeEl.style.color = mode === 'P' ? '#ef4444' : mode === 'PI' ? '#f59e0b' : '#a855f7';
    }
    
    // Send MQTT command
    const command = { pidMode: mode };
    if (publishMQTTMessage(TOPICS.MOTOR_CONTROL, JSON.stringify(command))) {
        showNotification(`PID Mode set to ${mode}`, 'success');
        
        // Start recording for comparison when mode changes
        if (!recordingComparison) {
            recordingComparison = true;
            comparisonStartTime = Date.now();
            showNotification('Started recording for comparison graph', 'info');
        }
    }
}

function enableControls() {
    // Enable inputs and buttons for both modes
    ['target-rpm','set-rpm-btn','quick-rpm-60','quick-rpm-0','quick-rpm--60',
     'target-angle','set-angle-btn','quick-ang--90','quick-ang-0','quick-ang-90',
     'pid-mode-p','pid-mode-pi','pid-mode-pid']
        .forEach(id => {
            const el = document.getElementById(id);
            if (el) el.disabled = false;
        });
}

// Utility Functions
function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    // Style the notification
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 12px 20px;
        border-radius: 8px;
        color: white;
        font-weight: 500;
        z-index: 1000;
        transition: all 0.3s ease;
        transform: translateX(100%);
    `;
    
    // Set background color based on type
    switch (type) {
        case 'success':
            notification.style.background = 'linear-gradient(45deg, #10b981, #059669)';
            break;
        case 'error':
            notification.style.background = 'linear-gradient(45deg, #f56565, #e53e3e)';
            break;
        default:
            notification.style.background = 'linear-gradient(45deg, #667eea, #764ba2)';
    }
    
    document.body.appendChild(notification);
    
    // Animate in
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 100);
    
    // Remove after 3 seconds
    setTimeout(() => {
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 300);
    }, 3000);
}

// Download Functions
function downloadChartAsPNG(chart, filename) {
    const url = chart.toBase64Image();
    const link = document.createElement('a');
    link.download = filename;
    link.href = url;
    link.click();
    showNotification(`Downloaded ${filename}`, 'success');
}

function downloadChartAsCSV(data, filename) {
    let csvContent = '';
    
    // Different CSV formats based on data type
    if (data.targetRPM !== undefined) {
        // RPM data
        csvContent = 'Time,Target RPM,Current RPM\n';
        for (let i = 0; i < data.labels.length; i++) {
            csvContent += `${data.labels[i]},${data.targetRPM[i]},${data.currentRPM[i]}\n`;
        }
    } else if (data.values !== undefined) {
        // Single value data (PWM, Kp, Ki, Kd)
        csvContent = 'Time,Value\n';
        for (let i = 0; i < data.labels.length; i++) {
            csvContent += `${data.labels[i]},${data.values[i]}\n`;
        }
    }
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showNotification(`Downloaded ${filename}`, 'success');
}

// Clear calibration chart
function clearCalibrationChart() {
    calibrationChart.data.labels = [];
    calibrationChart.data.datasets[0].data = []; // Baseline
    calibrationChart.data.datasets[1].data = []; // Target RPM
    calibrationChart.data.datasets[2].data = []; // Actual RPM
    chartDataStorage.calibration.labels = [];
    chartDataStorage.calibration.targetRPM = [];
    chartDataStorage.calibration.currentRPM = [];
    calibrationChart.update();
    showNotification('Calibration chart cleared', 'info');
}

// Clear comparison chart
function clearComparisonChart() {
    comparisonChart.data.labels = [];
    comparisonChart.data.datasets.forEach(dataset => dataset.data = []);
    chartDataStorage.comparison.labels = [];
    chartDataStorage.comparison.setpoint = [];
    chartDataStorage.comparison.pOnly = [];
    chartDataStorage.comparison.piOnly = [];
    chartDataStorage.comparison.pidFull = [];
    comparisonChart.update();
    recordingComparison = false;
    comparisonStartTime = null;
    showNotification('Comparison chart cleared', 'info');
}

// Clear individual PID mode charts
function clearIndividualCharts() {
    // Clear P-only chart
    pOnlyChart.data.labels = [];
    pOnlyChart.data.datasets.forEach(dataset => dataset.data = []);
    chartDataStorage.pOnly.labels = [];
    chartDataStorage.pOnly.targetRPM = [];
    chartDataStorage.pOnly.currentRPM = [];
    pOnlyChart.update();
    
    // Clear PI-only chart
    piOnlyChart.data.labels = [];
    piOnlyChart.data.datasets.forEach(dataset => dataset.data = []);
    chartDataStorage.piOnly.labels = [];
    chartDataStorage.piOnly.targetRPM = [];
    chartDataStorage.piOnly.currentRPM = [];
    piOnlyChart.update();
    
    // Clear PID full chart
    pidFullChart.data.labels = [];
    pidFullChart.data.datasets.forEach(dataset => dataset.data = []);
    chartDataStorage.pidFull.labels = [];
    chartDataStorage.pidFull.targetRPM = [];
    chartDataStorage.pidFull.currentRPM = [];
    pidFullChart.update();
    
    recordingComparison = false;
    comparisonStartTime = null;
    showNotification('Individual PID charts cleared', 'info');
}

// Download comparison chart as CSV
function downloadComparisonCSV() {
    let csvContent = 'Time,Setpoint,P-only,PI-only,Full PID\n';
    const maxLen = Math.max(
        chartDataStorage.comparison.labels.length,
        chartDataStorage.comparison.pOnly.length,
        chartDataStorage.comparison.piOnly.length,
        chartDataStorage.comparison.pidFull.length
    );
    
    for (let i = 0; i < maxLen; i++) {
        const time = chartDataStorage.comparison.labels[i] || '';
        const setpoint = chartDataStorage.comparison.setpoint[i] || '';
        const p = chartDataStorage.comparison.pOnly[i] || '';
        const pi = chartDataStorage.comparison.piOnly[i] || '';
        const pid = chartDataStorage.comparison.pidFull[i] || '';
        csvContent += `${time},${setpoint},${p},${pi},${pid}\n`;
    }
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'pid-comparison.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showNotification('Downloaded pid-comparison.csv', 'success');
}

// Setup download button listeners
function setupDownloadListeners() {
    // RPM chart downloads
    document.getElementById('download-rpm-png')?.addEventListener('click', () => {
        downloadChartAsPNG(rpmChart, 'rpm-chart.png');
    });
    document.getElementById('download-rpm-csv')?.addEventListener('click', () => {
        downloadChartAsCSV(chartDataStorage.rpm, 'rpm-data.csv');
    });
    
    // PWM chart downloads
    document.getElementById('download-pwm-png')?.addEventListener('click', () => {
        downloadChartAsPNG(pwmChart, 'pwm-chart.png');
    });
    document.getElementById('download-pwm-csv')?.addEventListener('click', () => {
        downloadChartAsCSV(chartDataStorage.pwm, 'pwm-data.csv');
    });
    
    // Calibration chart downloads
    document.getElementById('download-calibration-png')?.addEventListener('click', () => {
        downloadChartAsPNG(calibrationChart, 'calibration-oscillations.png');
    });
    document.getElementById('download-calibration-csv')?.addEventListener('click', () => {
        downloadChartAsCSV(chartDataStorage.calibration, 'calibration-data.csv');
    });
    document.getElementById('clear-calibration-btn')?.addEventListener('click', () => {
        clearCalibrationChart();
    });
    
    // Comparison chart downloads
    document.getElementById('download-comparison-png')?.addEventListener('click', () => {
        downloadChartAsPNG(comparisonChart, 'pid-comparison.png');
    });
    document.getElementById('download-comparison-csv')?.addEventListener('click', () => {
        downloadComparisonCSV();
    });
    document.getElementById('clear-comparison-btn')?.addEventListener('click', () => {
        clearComparisonChart();
    });
    
    // Individual PID charts downloads
    document.getElementById('download-p-only-png')?.addEventListener('click', () => {
        downloadChartAsPNG(pOnlyChart, 'p-only-response.png');
    });
    document.getElementById('download-p-only-csv')?.addEventListener('click', () => {
        downloadChartAsCSV(chartDataStorage.pOnly, 'p-only-data.csv');
    });
    
    document.getElementById('download-pi-only-png')?.addEventListener('click', () => {
        downloadChartAsPNG(piOnlyChart, 'pi-only-response.png');
    });
    document.getElementById('download-pi-only-csv')?.addEventListener('click', () => {
        downloadChartAsCSV(chartDataStorage.piOnly, 'pi-only-data.csv');
    });
    
    document.getElementById('download-pid-full-png')?.addEventListener('click', () => {
        downloadChartAsPNG(pidFullChart, 'pid-full-response.png');
    });
    document.getElementById('download-pid-full-csv')?.addEventListener('click', () => {
        downloadChartAsCSV(chartDataStorage.pidFull, 'pid-full-data.csv');
    });
    
    document.getElementById('clear-individual-btn')?.addEventListener('click', () => {
        clearIndividualCharts();
    });
}

// Simulate data for testing (remove when using real MQTT data)
function simulateData() {
    const data = {
        currentRPM: Math.random() * 700 - 350,
        targetRPM: 100,
        pwmValue: Math.floor(Math.random() * 255)
    };
    updateMotorData(data);
}

// Uncomment the line below for testing without ESP32
// setInterval(simulateData, 2000);